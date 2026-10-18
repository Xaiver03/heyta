#!/usr/bin/env node
/**
 * iOS 那一行的"翻牌"：TestFlight 外部审核通过之后，把 `channels.ios` 写进发布清单。
 *
 * ## 为什么需要它
 *
 * 下载页的 iOS 行是 `via: 'store'`：**只有清单 `channels.ios` 存在时**才给入口
 * （`apps/landing/src/site/downloads.ts` 的 `resolveRows`）。而那个入口在审核通过前
 * **必须是空的** —— 链接点进去只会写着 "This beta isn&#39;t accepting any new testers right now."
 * 一个点了是死路的按钮，比没有按钮更糟。
 *
 * ⇒ 所以这条"翻牌"被做成**两个独立信号同时成立才动手**，而不是靠人记得：
 *
 *   ① API 枚举值：`asc testflight distribution view` 的 `externalBuildState === 'BETA_APPROVED'`
 *   ② 链接旁证：`https://testflight.apple.com/join/hmMPsDdc` 里**不再**出现
 *      `accepting any new testers`
 *
 * ## 为什么是两个信号
 *
 * 🔴 **2026-10-18 实测过教训（环境陷阱 §7 #468）**：只按 ② 那条文字判，会踩 HTML 实体 ——
 * 页面里写的是 `isn&#39;t`，用字面 `isn't` 去 grep **必然 0 命中**，于是"0 命中"被误读成
 * "已经通过了"。**一个方向不明的读数不能当肯定结论用**，所以这里两条都要过，且 API 那条说了算。
 *
 * ## 用法
 *
 *   node research/tools/flip-ios-channel.mjs              # 只翻牌 + 提交（不发布）
 *   node research/tools/flip-ios-channel.mjs --publish     # 翻牌 + 提交 + 推 + 重发 + 线上验收
 *   node research/tools/flip-ios-channel.mjs --check       # 只报信号，什么都不改
 *
 * 未通过审核时**退出码 3**、零改动 —— 这一条可以当场验：现在跑它就该拒绝。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILD_ID = '8b857f09-de7b-4bb9-83ae-e6b9fac196fb';
const JOIN_URL = 'https://testflight.apple.com/join/hmMPsDdc';
const GROUP_NAME = 'TestFlight 公开内测';
const BUCKET = 'heyta-dist-1445543984';
const MANIFEST_KEY = 'app-releases/heyta/latest/latest.json';
const COSCLI_CONFIG =
  process.env.HEYTA_COSCLI_CONFIG ?? join(process.env.HOME ?? '/root', '.config/heyta/coscli-waytofuture.yaml');
/** 旁证用**不带标点**的长片段（HTML 实体、语言、A/B 都改不了它）。 */
const REFUSAL_MARKER = 'accepting any new testers';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const doPublish = args.includes('--publish');

const run = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();

/** 信号 ①：Apple 的权威枚举值。读不到 ⇒ 返回 undefined（**不猜**）。 */
function externalBuildState() {
  try {
    const raw = run('asc', ['testflight', 'distribution', 'view', '--build-id', BUILD_ID]);
    const json = JSON.parse(raw.slice(raw.indexOf('{')));
    return json?.data?.[0]?.attributes?.externalBuildState;
  } catch {
    return undefined;
  }
}

/** 信号 ②：链接旁证。返回 true 表示"仍在拒绝新测试者"。 */
function linkStillRefuses() {
  try {
    const html = run('curl', ['-s', '--max-time', '30', '-A', 'Mozilla/5.0', JOIN_URL]);
    return html.includes(REFUSAL_MARKER);
  } catch {
    return undefined;
  }
}

function readManifest() {
  const tmp = '/tmp/heyta-latest-manifest.json';
  run('coscli', ['-c', COSCLI_CONFIG, 'cp', `cos://${BUCKET}/${MANIFEST_KEY}`, tmp, '-e', 'cos.ap-guangzhou.myqcloud.com']);
  return { tmp, manifest: JSON.parse(readFileSync(tmp, 'utf8')) };
}

function writeManifest(tmp, manifest) {
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  run('coscli', ['-c', COSCLI_CONFIG, 'cp', tmp, `cos://${BUCKET}/${MANIFEST_KEY}`, '-e', 'cos.ap-guangzhou.myqcloud.com']);
}

const state = externalBuildState();
const refuses = linkStillRefuses();
console.log(`  信号 ① externalBuildState = ${state ?? '（读不到）'}`);
console.log(`  信号 ② 链接仍在拒绝新测试者 = ${refuses === undefined ? '（读不到）' : refuses}`);

if (checkOnly) process.exit(0);

// 🔴 两个信号都要明确成立才动手；任何一个"读不到"都算不成立（fail-closed）。
const approved = state === 'BETA_APPROVED' && refuses === false;
if (!approved) {
  console.log('  ⏸️  还没通过外部审核 ⇒ 零改动。这一页此刻**不该**有 iOS 入口。');
  process.exit(3);
}

console.log('  ✅ 两个信号都说通过了 ⇒ 开始翻牌');
const { tmp, manifest } = readManifest();
if (manifest.channels?.ios !== undefined) {
  console.log('  ↩️  清单里已经有 channels.ios ⇒ 只做校验与后续步骤');
} else {
  manifest.channels = {
    ...(manifest.channels ?? {}),
    ios: { url: JOIN_URL, name: GROUP_NAME, addedAt: new Date().toISOString().slice(0, 10) },
  };
  writeManifest(tmp, manifest);
  console.log('  ✅ 已写入 channels.ios');
}

run('pnpm', ['--filter', '@heyta/landing', 'exec', 'node', 'scripts/gen-downloads.mjs']);
run('pnpm', ['--silent', 'check:downloads']);
run('pnpm', ['--silent', 'verify:downloads-live']);
run('git', ['add', '-A']);
run('git', ['commit', '-m', 'feat(download): iOS 外部审核通过 —— 挂上 TestFlight 入口（channels.ios）']);
run('git', ['push', 'origin', 'main']);
console.log('  ✅ 已提交并推送');

if (doPublish) {
  run('node', ['research/tools/publish-public-sites.mjs', '--confirm'], { stdio: 'inherit' });
  console.log('  ✅ 已重发（九步含线上验收）');
} else {
  console.log('  ℹ️  没有 --publish ⇒ 站点尚未重发。加 --publish 再跑一次即可。');
}
