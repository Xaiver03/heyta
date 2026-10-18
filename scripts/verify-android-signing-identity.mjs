#!/usr/bin/env node
/**
 * `verify:android-signing-identity` —— 发出去的那枚 APK，**签的是我们那张证书吗**。
 * ==================================================================================
 *
 * ## 它补的是哪一半
 *
 * `scripts/upload-dist.sh` 的 `assert_android_release_signature()` 已经在挡一件事：
 * **调试签名**（`apksigner verify --print-certs` 的 DN 里出现 `Android Debug` 就拒绝）。
 * 那挡的是"**忘了配发布签名**"。
 *
 * 🔴 但它**不挡**"**签的不是我们那张**"：任何非调试证书都通过 —— 另一个人的、
 * 另一台机器生成的、或者换过一张的，统统放行。而症状与它害怕的那件事**一模一样**：
 * 已装用户升级时签名不匹配 ⇒ **必须先卸载** ⇒ 本地优先的应用那等于丢数据。
 *
 * ## 为什么"期望身份"不需要新造一个密件存放处
 *
 * 发布机上本来就有那张 keystore —— `apps/mobile/android/app/build.gradle` 从
 * `HEYTA_RELEASE_STORE_FILE` / `…_KEY_ALIAS` 读它（住在 `~/.gradle/gradle.properties`，
 * **刻意不进仓库**）。所以本判据只是把同一个来源再读一次，比对**证书 SHA-256**
 * （不比对 DN：DN 可以同名不同钥）。
 *
 * ## 两个方向都不能静默
 *
 * - 找不到 `apksigner` ⇒ 读不出 APK 的身份 ⇒ **报红**（"证明不了"不是"通过"）；
 * - 读不到期望 keystore ⇒ 算不出期望身份 ⇒ **报红**；
 * - 两边都读到、但不相等 ⇒ **报红**，并把两个指纹都打出来。
 *
 * ⇒ 与 `check:crosslang-contract` 那个"跳过 = 退出 0"的坑刻意反着写（对账件 B14）。
 *
 * ## 用法
 *
 *   node scripts/verify-android-signing-identity.mjs [apk 路径]
 *   node scripts/verify-android-signing-identity.mjs --self-test
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(HERE);
const DEFAULT_APK = join(ROOT, 'apps/mobile/android/app/build/outputs/apk/release/app-release.apk');
const GRADLE_PROPS = join(homedir(), '.gradle/gradle.properties');

/** 把 `C4:6D:03:…` 与 `c46d03…` 归一成同一种写法。 */
export function normalizeSha256(raw) {
  return String(raw).replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

/**
 * 纯判据：给两边的指纹，返回问题列表。
 *
 * `expected` 是**本机那张发布 keystore** 的证书指纹，`actual` 是**这枚 APK** 的。
 */
export function identityProblems({ apk, expected, actual }) {
  const problems = [];
  if (expected === undefined || expected === '') {
    problems.push(
      '算不出**期望身份**：读不到发布 keystore（`HEYTA_RELEASE_STORE_FILE`）。' +
        '⇒ 没有它就没法证明这枚 APK 是我们的 —— **证明不了不等于通过**。',
    );
  }
  if (actual === undefined || actual === '') {
    problems.push(`读不出 ${apk} 的签名身份（apksigner 缺失或产物未签名）—— 同样不许静默通过`);
  }
  if (problems.length > 0) return problems;

  if (normalizeSha256(expected) !== normalizeSha256(actual)) {
    problems.push(
      `🔴 这枚 APK **不是**我们那张发布证书签的：\n` +
        `       期望（发布 keystore）：${normalizeSha256(expected)}\n` +
        `       实际（这枚 APK）    ：${normalizeSha256(actual)}\n` +
        '       直链发出去之后，已装用户升级会遇到签名不匹配 ⇒ **必须先卸载** ⇒ ' +
        '本地优先的应用那等于丢数据。\n' +
        '       修法：用发布 keystore 重签（`apksigner sign --ks <发布库> --ks-key-alias <别名>`），' +
        '或确认这台机器的 `HEYTA_RELEASE_STORE_FILE` 指向的是对的那张。',
    );
  }
  return problems;
}

/** 与 `upload-dist.sh` 的 `find_apksigner()` 同一组搜索路径。 */
function findApksigner() {
  const fromPath = (() => {
    try {
      return execFileSync('/bin/sh', ['-c', 'command -v apksigner'], { encoding: 'utf8' }).trim();
    } catch {
      return undefined;
    }
  })();
  if (fromPath && existsSync(fromPath)) return fromPath;

  const bases = [
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'build-tools'),
    join(homedir(), 'Library/Android/sdk/build-tools'),
    '/opt/homebrew/share/android-commandlinetools/build-tools',
  ].filter(Boolean);
  for (const base of bases) {
    if (!existsSync(base)) continue;
    // 版本目录名排序后取**最高的那个**（`35.0.0` > `34.0.0`），与修法无关但更可预期。
    const versions = readdirSync(base).sort((a, b) =>
      a.localeCompare(b, 'en', { numeric: true }),
    );
    for (const v of versions.reverse()) {
      const candidate = join(base, v, 'apksigner');
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/** 从 `~/.gradle/gradle.properties` 读一项（`HEYTA_RELEASE_STORE_FILE` 等）。 */
export function gradleProp(name, text) {
  const m = new RegExp(`^${name}\\s*=\\s*(.*)$`, 'm').exec(text);
  return m === null ? undefined : m[1].trim();
}

function main() {
  const apk = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? DEFAULT_APK;
  if (!existsSync(apk)) {
    console.error(`🔴 找不到 APK：${apk}`);
    process.exit(1);
  }

  let props = '';
  try {
    props = readFileSync(GRADLE_PROPS, 'utf8');
  } catch {
    /* 交给纯判据报"算不出期望身份" */
  }
  // 🔴 **环境变量优先**（2026-10-16 实测纠正）：第一版把 `gradle.properties` 放在前面，
  //    于是 `HEYTA_RELEASE_STORE_FILE=…` **根本注入不进去** —— 我做反例时判据仍然报绿，
  //    也就是说**这条判据当时不可反证**。与 `research/tools/publish-public-sites.mjs` 的
  //    `process.env.HEYTA_SITE_DOMAIN || '默认值'` 同一条优先序。
  const store = process.env.HEYTA_RELEASE_STORE_FILE || gradleProp('HEYTA_RELEASE_STORE_FILE', props);
  const alias = process.env.HEYTA_RELEASE_KEY_ALIAS || gradleProp('HEYTA_RELEASE_KEY_ALIAS', props) || 'heyta';
  const storePass =
    process.env.HEYTA_RELEASE_STORE_PASSWORD || gradleProp('HEYTA_RELEASE_STORE_PASSWORD', props);

  let expected;
  if (store && existsSync(store)) {
    try {
      const out = execFileSync(
        'keytool',
        ['-list', '-v', '-keystore', store, '-alias', alias, '-storepass', storePass ?? '', '-J-Duser.language=en'],
        { encoding: 'utf8' },
      );
      expected = /SHA256:\s*([0-9A-Fa-f:]+)/.exec(out)?.[1];
    } catch (error) {
      console.error(`🔴 keytool 读不出发布 keystore 的证书：${String(error).split('\n')[0]}`);
    }
  }

  let actual;
  const apksigner = findApksigner();
  if (apksigner) {
    try {
      const out = execFileSync(apksigner, ['verify', '--print-certs', apk], { encoding: 'utf8' });
      actual = /SHA-256 digest:\s*([0-9a-fA-F]+)/.exec(out)?.[1];
    } catch (error) {
      console.error(`🔴 apksigner 读不出这枚 APK 的签名：${String(error).split('\n')[0]}`);
    }
  }

  const problems = identityProblems({ apk, expected, actual });
  if (problems.length > 0) {
    console.error('🔴 Android 签名身份对不上：');
    for (const p of problems) console.error(`   · ${p}`);
    process.exit(1);
  }
  console.log(`✅ 这枚 APK 签在发布证书上：${normalizeSha256(actual)}`);
  console.log('   （比对的是**证书 SHA-256**，不是 DN —— DN 可以同名不同钥。）');
}

/* ── 自检：三臂 ─────────────────────────────────────────────────────── */

function selfTest() {
  const A = 'C4:6D:03:86:17:9C:3C:EF:12:58:2D:13:47:ED:2F:87:1E:B0:3A:64:AA:A2:BF:F9:65:11:C1:CB:76:06:25:56';
  const B = 'aa'.repeat(32);
  const arms = [
    ['A 同一种指纹、两种写法（带冒号 uppercase vs 裸 lowercase）⇒ 不报', () => identityProblems({ apk: 'x.apk', expected: A, actual: A.replace(/:/g, '').toLowerCase() }), 0],
    ['B 🔴 换了另一张证书 ⇒ 报，并印出两个指纹', () => identityProblems({ apk: 'x.apk', expected: A, actual: B }), 1],
    ['C 算不出期望身份（没有 keystore）⇒ 报', () => identityProblems({ apk: 'x.apk', expected: undefined, actual: A }), 1],
    ['D 读不出 APK 身份 ⇒ 报', () => identityProblems({ apk: 'x.apk', expected: A, actual: undefined }), 1],
  ];
  let failures = 0;
  for (const [label, run, expect] of arms) {
    const problems = run();
    const hit = problems.length === expect || (expect > 0 && problems.length > 0);
    console.log(`${hit ? '✅' : '❌'} ${label}${hit ? '' : `（${problems.join(' / ') || '(无)'}）`}`);
    if (!hit) failures += 1;
  }
  // 阳性对照：臂 B 必须真的把**两个指纹**都印出来，否则人无法判断差异
  const bText = identityProblems({ apk: 'x.apk', expected: A, actual: B }).join('\n');
  const both = bText.includes(normalizeSha256(A)) && bText.includes(normalizeSha256(B));
  console.log(`${both ? '✅' : '❌'} 阳性对照：不匹配时**两个指纹都印出来**`);
  if (!both) failures += 1;

  console.log(`\n臂数 ${arms.length}（由本脚本自己打印）+ 阳性对照，失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
