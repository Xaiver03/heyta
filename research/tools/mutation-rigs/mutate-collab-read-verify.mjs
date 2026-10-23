#!/usr/bin/env node
/**
 * 变异装置：M4 读侧那几条判据（不物化 / 游标 / 存量 / 名单 / 界面报警 / 通知）能不能红
 * ============================================================================
 *
 * 它不改产品行为，只回答一句质疑：`share-read-verify.spec.ts` 与
 * `share-signature-notice.spec.tsx` 绿了，是因为这六格**各自**被盯着，
 * 还是其中某一格谁都拦不住？
 *
 * 为什么这一格值得单独一副臂：读侧这条链有六个**方向各不同**的判断点，
 * 而它们的症状在界面上长得一样（"对面写的内容没出现"）：
 *
 *  1 `cursor-over-forgery` 游标越过被拒那条 ⇒ 那条以后再也拉不到，报警随第二轮一起消失。
 *  2 `always-accept` 验不过照样物化 ⇒ 服务端塞的伪造件被画成"同事写的"。
 *  3 `legacy-as-forgery` 存量行当成伪造 ⇒ 老清单全量报成事故，用户学不会读这条报警。
 *  4 `roster-silent` 拿不到名单就当验过 ⇒ "没验证"与"验证通过"在界面上同一个样子。
 *  5 `emit-removed` / 6 `emit-on-added` 壳里那行通知摘掉或挂回 `added > 0` ⇒
 *     被拒那条**本来就没落盘**，`added` 恰好是 0 —— 旧条件正好漏掉这一族（本轮要防的静默）。
 *  7 `notice-always-renders` 没拒也渲染 ⇒ 空日志被报成"有内容被拒"。
 *
 * 七臂互不覆盖：2 挡不住 3、5 挡不住 6 ⇒ 少任何一臂都不知道另一半有没有牙。
 *
 * 口径按 `research/tools/mutation-rigs/README.md`：① 基线必须先绿且那两份 spec 真跑到
 * （否则退 2）；② 每臂**红集精确匹配**（条数 + 缺席 + 多红三条都过）；③ 还原后逐字节比对，
 * 最后复跑基线。
 *
 * 🔴 原地改工作树（目标文件归本线），动手前验它们相对 HEAD 干净，脏就退 **3**。
 *
 * 首跑读数（2026-10-23，基线 `7f1de7af4`）：`ARMS=pass (7/7)`，两份 spec 各自
 * `11 passed` / `9 passed`，还原后 `RECHECK` 两头 RC=0 且目标文件相对 HEAD 干净。
 *
 * ⚠️ 预测红集 vs 实测红集的两处**对账**（首跑漂移，都改的是预测，没动判据）：
 *  1 `always-accept` 预测 4 枚、实测 **5** 枚：多出来的那枚是"换一份 share 去验同一条 ⇒ invalid"。
 *    我漏数了它 —— 这一臂把"拒"这一整个分支抹掉，跨清单搬条那条走的也是同一个分支。
 *  2 `emit-removed` 预测 2 枚、实测 **1** 枚：少的那枚是界面用例"重画信号让这一节自己重读"。
 *    它直接敲 `emitShareRepaint()`，验的是**订阅**，不经过 `comment-actions.ts` 那一行 ——
 *    两枚各有归属是刻意的（订阅与接线是两处会各自坏掉的缝），所以这不是判据没牙，
 *    而是本轮预测把两件事当一件事数了。反向证据：`emit-on-added` 红 2 枚
 *    （接线那枚 + "没拒就不该敲"的对照臂），说明这一族的两个方向都真的被盯着。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-read-verify.mjs
 * 读数：`ARMS=pass (7/7)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');

const HOST = 'packages/app-host';
const WEB = 'apps/web';
const VERIFY_SRC = `${HOST}/src/share-verify.ts`;
const COMMENTS_SRC = `${HOST}/src/share-comments.ts`;
const ACTIONS_SRC = `${WEB}/src/features/share/comment-actions.ts`;
const NOTICE_SRC = `${WEB}/src/features/share/ShareSignatureNotice.tsx`;
const HOST_SPEC = 'tests/share-read-verify.spec.ts';
const WEB_SPEC = 'tests/share-signature-notice.spec.tsx';

const MARK = 'MUTATED-BY-RIG：这一处是装置注入的病灶，跑完即还原';

const ARMS = [
  {
    id: 'cursor-over-forgery',
    pkg: HOST,
    specs: HOST_SPEC,
    file: COMMENTS_SRC,
    needle: '    const cursor = rejected.length > 0 ? acceptedUpTo : after;\n',
    rep: `    // ${MARK}\n    const cursor = after;\n`,
    why: '游标推过被拒那条 ⇒ 那一条永远不会再被拉到，报警第二轮就消失',
    mustInclude: ['游标停在它之前', '再拉一轮'],
    expect: 2,
  },
  {
    id: 'always-accept',
    pkg: HOST,
    specs: HOST_SPEC,
    file: VERIFY_SRC,
    needle: "  if (outcome === 'verified' || outcome === 'unsigned') return { accepted: true };\n",
    rep: `  // ${MARK}\n  return { accepted: true };\n`,
    why: '验不过照样物化 ⇒ 服务端塞进来的伪造件被画成"同事写的"',
    mustInclude: ['具名 invalid', 'signer-unregistered（与', '换一份 share', '伪造那条不物化', '再拉一轮'],
    expect: 5,
  },
  {
    id: 'legacy-as-forgery',
    pkg: HOST,
    specs: HOST_SPEC,
    file: VERIFY_SRC,
    needle: '  if (signerMemberId === null) return { accepted: true };\n',
    rep:
      `  // ${MARK}\n  if (signerMemberId === null) {\n` +
      '    return { accepted: false, rejection: { shareId, opId: row.id, serverSeq: row.serverSeq, clientId: row.clientId, outcome: \'signer-unregistered\', signerMemberId } };\n' +
      '  }\n',
    why: '把存量行（从没进过签名协议）当成伪造 ⇒ 老清单全量报成事故',
    mustInclude: ['存量行（没有作者列）', '存量行不需要名单'],
    expect: 2,
  },
  {
    id: 'roster-silent',
    pkg: HOST,
    specs: HOST_SPEC,
    file: VERIFY_SRC,
    needle: '  if (args.roster === undefined) throw new ShareSignatureRosterUnavailableError(shareId);\n',
    rep: `  // ${MARK}\n  if (args.roster === undefined) return { accepted: true };\n`,
    why: '取不到名单就当验过了 ⇒ "没验证"与"验证通过"在界面上同一个样子',
    mustInclude: ['需要验却没有名单', '名单取不到而日志里有署名行'],
    expect: 2,
  },
  {
    id: 'emit-removed',
    pkg: WEB,
    specs: WEB_SPEC,
    file: ACTIONS_SRC,
    needle: '    if ((result.rejections?.length ?? 0) > 0) emitShareRepaint();\n',
    rep: `    // ${MARK}\n`,
    why: '壳里那行通知整个摘掉 ⇒ 拒了东西而界面停在打开那一刻',
    mustInclude: ['仍然敲一次重画'],
    expect: 1,
  },
  {
    id: 'emit-on-added',
    pkg: WEB,
    specs: WEB_SPEC,
    file: ACTIONS_SRC,
    needle: '    if ((result.rejections?.length ?? 0) > 0) emitShareRepaint();\n',
    rep: `    // ${MARK}\n    if (result.added > 0) emitShareRepaint();\n`,
    why: '把通知挂回"真拿到新内容" ⇒ 被拒那条根本没落盘、added 恰好是 0，正好漏掉这一族',
    mustInclude: ['仍然敲一次重画', '只敲引擎通知'],
    expect: 2,
  },
  {
    id: 'notice-always-renders',
    pkg: WEB,
    specs: WEB_SPEC,
    file: NOTICE_SRC,
    needle: '  if (rejections.length === 0 || key === dismissedKey) return null;\n',
    rep: `  // ${MARK}\n  if (key === dismissedKey) return null;\n`,
    why: '没有拒也渲染那一行 ⇒ 空日志被报成"有内容被拒"，报警立刻失去意义',
    mustInclude: ['宿主没报任何拒', '重画信号让这一节自己重读'],
    expect: 2,
  },
];

const md5 = (s) => createHash('md5').update(s).digest('hex');
const say = (line) => process.stdout.write(`${line}\n`);
const git = (args) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).stdout ?? '';

const sh = (cwdRel, cmd) =>
  spawnSync(cmd, {
    cwd: join(ROOT, cwdRel),
    shell: '/bin/sh',
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 1 << 28,
  });

function parseVitest(out) {
  const sum = /^\s*Tests\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  const failed = Number(/(\d+) failed/.exec(sum ?? '')?.[1] ?? NaN);
  const titles = [...out.matchAll(/^\s*×\s+(.+?)\s+\d+ms\s*$/gm)].map((m) => m[1]);
  const files = /^\s*Test Files\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  return { sum, failed, titles, files };
}

const run = (arm) => {
  const r = sh(arm.pkg, `./node_modules/.bin/vitest run ${arm.specs}`);
  return { code: r.status, parsed: parseVitest(`${r.stdout ?? ''}${r.stderr ?? ''}`) };
};

// ── 前置守卫：目标存在 + 相对 HEAD 干净 + 每臂 needle 恰好命中一次 ──────────
const targets = [...new Set(ARMS.map((a) => a.file))];
for (const t of targets) {
  if (!existsSync(join(ROOT, t))) {
    say(`ARMS=FAIL reason=target-missing ${t}`);
    process.exit(1);
  }
  const dirty = git(['status', '--porcelain', '--', t]).trim();
  if (dirty !== '') {
    say(`ARMS=ENV dirty-worktree —— ${t} 相对 HEAD 有未提交改动，装置不在别人的改动上动刀。\n   ${dirty}`);
    process.exit(3);
  }
}

const originals = new Map(targets.map((t) => [t, readFileSync(join(ROOT, t), 'utf8')]));
const backups = new Map();
for (const t of targets) backups.set(t, `${join(ROOT, t)}.mut-bak`);

for (const a of ARMS) {
  const hits = originals.get(a.file).split(a.needle).length - 1;
  if (hits !== 1) {
    say(`ARMS=FAIL reason=needle-hits=${String(hits)} arm=${a.id} —— 锚点必须恰好一处，否则注病灶的位置不确定`);
    process.exit(1);
  }
}
say(`GUARD ✅ ${ARMS.length} 臂的 needle 各命中 1 次，${targets.length} 枚目标文件相对 HEAD 干净`);

// 备份带上前置状态（"等于 HEAD"只是代理尺）：记下每枚文件当时的 HEAD 版本与 mtime。
const headOf = (t) => git(['rev-parse', `HEAD:${t}`]).trim();
for (const t of targets) {
  writeFileSync(backups.get(t), originals.get(t), 'utf8');
  say(`  · ${t} HEAD=${headOf(t).slice(0, 9)} md5=${md5(originals.get(t) ?? '')}`);
}

function restoreAll() {
  for (const t of targets) {
    const abs = join(ROOT, t);
    const from = readFileSync(backups.get(t), 'utf8');
    if (readFileSync(abs, 'utf8') === from) continue;
    writeFileSync(abs, from, 'utf8');
    if (md5(readFileSync(abs, 'utf8')) !== md5(from)) {
      say(`ARMS=FAIL reason=RESTORE=DIRTY ${t}（只从 ${t}.mut-bak 还原，不拿 git 当变量）`);
      process.exit(4);
    }
  }
}
process.on('exit', () => {
  restoreAll();
  for (const t of targets) {
    const bak = backups.get(t);
    if (existsSync(bak)) unlinkSync(bak);
  }
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    say(`🔴 收到 ${sig} —— 先还原再退出`);
    process.exit(130);
  });
}

// ── 基线：两份 spec 都必须真跑到且全绿 ─────────────────────────────────────
const baselines = [];
for (const spec of [
  { pkg: HOST, specs: HOST_SPEC },
  { pkg: WEB, specs: WEB_SPEC },
]) {
  const b = run(spec);
  say(`BASELINE ${spec.specs} RC=${String(b.code)} Tests=${b.parsed.sum ?? '?'}`);
  if (b.code !== 0 || !/^1 passed/.test(b.parsed.files ?? '')) {
    say('ARMS=ABORT reason=baseline-not-green（基线红、或那份 spec 压根没跑到 ⇒ 台架自己坏了，拒绝读数）');
    process.exit(2);
  }
  baselines.push(b);
}

let failures = 0;
for (const a of ARMS) {
  const abs = join(ROOT, a.file);
  writeFileSync(abs, originals.get(a.file).replace(a.needle, a.rep), 'utf8');
  const r = run(a);
  const p = r.parsed;
  const survived = r.code === 0;
  const missing = a.mustInclude.filter((tag) => !p.titles.some((t) => t.includes(tag)));
  const extra = p.titles.filter((t) => !a.mustInclude.some((tag) => t.includes(tag)));
  const match = !survived && p.failed === a.expect && missing.length === 0 && extra.length === 0;
  say(`[${a.id}] ${a.why}\n      → RC=${String(r.code)} 红 ${String(p.failed)}/${String(a.expect)} ${
    survived ? '🔴 存活（判据没牙）' : match ? '红集精确匹配' : '⚠️ 红集漂移'
  }`);
  for (const t of p.titles.slice(0, 8)) say(`      · ${t}`);
  if (missing.length > 0) say(`      🔴 预期红的用例缺席: ${missing.join(' | ')}`);
  if (extra.length > 0) say(`      ⚠️ 额外红的用例: ${extra.map((t) => t.slice(0, 40)).join(' | ')}`);
  restoreAll();
  if (!match) failures += 1;
}

let recheckFail = 0;
for (const spec of [
  { pkg: HOST, specs: HOST_SPEC },
  { pkg: WEB, specs: WEB_SPEC },
]) {
  const rc = run(spec);
  say(`RECHECK ${spec.specs} RC=${String(rc.code)} Tests=${rc.parsed.sum ?? '?'}`);
  if (rc.code !== 0) recheckFail += 1;
  for (const t of targets) {
    const diff = git(['status', '--porcelain', '--', t]).trim();
    if (diff !== '') {
      say(`🔴 ${t} 还原后相对 HEAD 仍不干净：${diff}`);
      recheckFail += 1;
    }
  }
}
if (recheckFail > 0) failures += 1;

const armFailures = failures - (recheckFail > 0 ? 1 : 0);
say(
  `\nARMS=${failures === 0 ? 'pass' : 'FAIL'} (红集匹配 ${String(ARMS.length - armFailures)}/${String(ARMS.length)})` +
    (recheckFail > 0 ? ' + 复跑基线红' : '') +
    `  载具：cd ${HOST} && npx vitest run ${HOST_SPEC} / cd ${WEB} && npx vitest run ${WEB_SPEC}`,
);
process.exit(failures === 0 ? 0 : 1);
