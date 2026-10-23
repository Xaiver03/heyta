#!/usr/bin/env node
/**
 * 变异装置：M4 上传边界那四格判定，各自有没有牙
 * ==============================================
 *
 * 它不改产品行为，只回答一句质疑：`verify:collab-sync` 第 13 步绿了，是因为
 * 「无签 / 改一字节 / 代签 / 名册漏掉已移除的人」这四格**各自**被盯着，
 * 还是其中某一格谁都拦不住、只是被别的格顺带挡住？
 *
 * 四臂各钉一格（每臂的病灶都是一句"合法但更省事"的写法，也就是这格最容易被顺手改回去的样子）：
 *
 *  A `accept-unsigned`  闸门放开"没签的那一条" ⇒ 13.2 必须红（无签通道重开 = 裁决六作废）。
 *  B `accept-tampered`  闸门放开"验不过的那一条" ⇒ 13.3 必须红（改了字节还收进库 = 完整性是假的）。
 *  C `author-column-dropped` 落库那一步不记作者 ⇒ 13.1 必须红。「不许代签」靠的就是这一格：
 *     作者列一空，读侧就把它当存量行放过（`share-verify.ts` 纪律 3），于是"谁写的"这件事
 *     在协议上消失，而界面什么都不会说。
 *     ⚠️ 首跑试过更直觉的那一形 —— 把作者改成"从载荷自称取"（`raw.signerMemberId`）：
 *     **它不是一臂，是一枚崩溃**。落库那一步在 `accepted.map(...)` 里，`raw` 不在作用域
 *     ⇒ 服务端 500、载具第 5 步就红（`reason=owner 上传失败：internal_error`）。红是红了，
 *     但它证的是"脚本写坏了"，不是"这一格没牙"，所以换成本臂这一形（裁决四那一条纪律
 *     在源码里本来也只可能以"记成别的值 / 不记"两种形状被改掉）。
 *  D `roster-active-only` 名册改成只回现役成员 ⇒ 必须红（把人移出去的那一刻起，
 *     他写过的每一条连同其后的改动一起读不出来 —— 这一臂是 M4-5 期间**实测撞到**的那一形）。
 *
 * 四臂互不覆盖：A 挡不住 B（A 放开 unsigned、B 放开 invalid）、C 与 D 各在写/读两侧。
 *
 * ## 预测红集 vs 实测红集（首跑，2026-10-23）
 *
 * | 臂 | 预测 | 实测 |
 * |---|---|---|
 * | A | step=13 reason=13.2 | step=13 reason=`13.2 无签上传的码不是具名那一枚，实际 undefined` ✅ |
 * | B | step=13 reason=13.3 | step=13 reason=`13.3 改一字节的码不是具名那一枚，实际 undefined` ✅ |
 * | C | step=13 reason=13.1（原病灶=`raw.signerMemberId`） | 🔴 预测落空：第 5 步 500（作用域崩溃，见上）⇒ 换病灶为"不记作者"后复跑 |
 * | D | step=13 reason=13.5 | 🔴 预测偏早：实测**第 10 步**就红（`拉回来的物化状态里没有那条评论`）——同一格、更早的那一腿。臂的判据因此钉成**闭合两形**（10 步那句 / 13.5 那句），不是放宽成"任意红"：第 10 步那一形正是这格在生产里最先咬人的位置（owner 的第二台设备第一次拉取），把它算命中是对的，把它写成"只能红在 13.5"反而会把修法引偏 |
 *
 * 🔴 病灶打在 `server/dist/src/shares/share.routes.js` —— **验收跑起来的那一份**，
 * 不是源码。这样每一臂不必重编服务端（一臂 ~75s 而不是 ~5min）。代价是读数依赖
 * "dist 不比 src 旧"这一条前提，所以动手前先比 mtime，落后就退 **3** 并让操作者先
 * `cd server && pnpm build`。这一条是本仓"测试全绿 ≠ 这是当前产物"那族坑的正面执行。
 *
 * 🔴 原地改工作树里的构建产物（`server/dist` 不入版本控制），还原只从 `.mut-bak` 取，
 * 还原后逐字节 md5 比对；失败退 **4**。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-upload-gate.mjs
 * 读数：`ARMS=pass (4/4)` / `ARMS=FAIL …`
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');
const DIST = join(ROOT, 'server/dist/src/shares/share.routes.js');
const SRC = join(ROOT, 'server/src/shares/share.routes.ts');
const CARRIER = 'scripts/verify-collab-sync.mjs';
const BAK = `${DIST}.mut-bak`;

const MARK = 'MUTATED-BY-RIG：这一处是装置注入的病灶，跑完即还原';

/** 四臂：needle 必须在产物里恰好命中一次（命不中 ⇒ 病灶位置不确定，注入的可能是别处）。 */
const ARMS = [
  {
    id: 'accept-unsigned',
    why: '闸门放开"没签的那一条" ⇒ 无签通道重开（裁决六作废）',
    needle: "            if (outcome !== 'verified') {\n",
    rep: `            // ${MARK}\n            if (outcome !== 'verified' && outcome !== 'unsigned') {\n`,
    expect: [{ step: '13', fragment: '13.2' }],
  },
  {
    id: 'accept-tampered',
    why: '闸门放开"验不过的那一条" ⇒ 改过字节的 op 照样落库',
    needle: "            if (outcome !== 'verified') {\n",
    rep: `            // ${MARK}\n            if (outcome !== 'verified' && outcome !== 'invalid') {\n`,
    expect: [{ step: '13', fragment: '13.3' }],
  },
  {
    id: 'author-column-dropped',
    why: '落库那一步不记作者 ⇒ 读侧把它当存量行放过，"这条是谁写的"从协议上消失',
    needle: '                    signerMemberId: lookup.member.id,\n                    signature,\n',
    rep: `                    // ${MARK}\n                    signerMemberId: null,\n                    signature,\n`,
    expect: [{ step: '13', fragment: '13.1' }],
  },
  {
    id: 'roster-active-only',
    why: '名册只回现役成员 ⇒ 移出一个人就再也读不出他写过的东西',
    needle: '            where: { shareId },\n            select: { id: true, signingPublicKey: true, removedAt: true },\n',
    rep: `            // ${MARK}\n            where: { shareId, removedAt: null },\n            select: { id: true, signingPublicKey: true, removedAt: true },\n`,
    // 闭合两形（首跑实测：第 10 步那一腿最先撞上同一格，见文件头那张对账表）。
    expect: [
      { step: '10', fragment: '物化状态里没有那条评论' },
      { step: '13', fragment: '13.5' },
    ],
  },
];

const md5 = (s) => createHash('md5').update(s).digest('hex');
const say = (line) => process.stdout.write(`${line}\n`);

/** 跑一载具：一次全真的服务端 + 十三步（约 75s/趟）。 */
const runCarrier = (port) =>
  spawnSync(process.execPath, [CARRIER, '--port', String(port)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 1 << 28,
  });

const reading = (out) => {
  const line = out.split('\n').find((l) => l.startsWith('RESULT=')) ?? '(没有 RESULT= 行)';
  const step = /^RESULT=FAIL step=(\d+)/.exec(line)?.[1] ?? null;
  return { line, step };
};

if (!existsSync(DIST)) {
  say(`ARMS=FAIL reason=dist-missing —— 载具跑的是构建产物：cd server && pnpm build`);
  process.exit(1);
}
// 🔴 前置：产物不许落后于源码。否则这一臂验的是旧字节，读数与当前 HEAD 无关。
if (statSync(DIST).mtimeMs < statSync(SRC).mtimeMs) {
  say(`ARMS=ENV stale-dist —— server/dist 比 server/src 旧，先 cd server && pnpm build 再跑装置。`);
  process.exit(3);
}
const original = readFileSync(DIST, 'utf8');
for (const a of ARMS) {
  const hits = original.split(a.needle).length - 1;
  if (hits !== 1) {
    say(`ARMS=FAIL reason=needle-hits=${String(hits)} arm=${a.id} —— 锚点必须恰好一处`);
    process.exit(1);
  }
}
if (existsSync(BAK)) {
  say(`ARMS=FAIL reason=leftover-backup —— ${BAK} 已存在（上一趟没还原干净），不动别人的残留。`);
  process.exit(1);
}
const baseHash = md5(original);
say(`GUARD ✅ ${ARMS.length} 臂的 needle 各命中 1 次；产物不比源码旧；md5=${baseHash.slice(0, 12)}`);

const restoreAll = () => {
  if (!existsSync(BAK)) return;
  renameSync(BAK, DIST);
  if (md5(readFileSync(DIST, 'utf8')) !== baseHash) {
    say(`ARMS=FAIL reason=RESTORE=DIRTY md5=${baseHash.slice(0, 12)} -> ${md5(readFileSync(DIST, 'utf8')).slice(0, 12)}`);
    process.exit(4);
  }
};
process.on('exit', restoreAll);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    say(`🔴 收到 ${sig} —— 先还原再退出`);
    restoreAll();
    process.exit(130);
  });
}

const base = runCarrier(3231);
const baseOut = `${base.stdout ?? ''}${base.stderr ?? ''}`;
const baseReading = reading(baseOut);
say(`BASELINE RC=${String(base.status)} ${baseReading.line}`);
if (base.status !== 0 || !baseOut.includes('RESULT=OK steps=13')) {
  say('ARMS=ABORT reason=baseline-not-green（基线不绿、或第 13 步压根没跑到 ⇒ 台架自己坏了，拒绝读数）');
  process.exit(2);
}

let failures = 0;
let port = 3232;
for (const a of ARMS) {
  renameSync(DIST, BAK);
  writeFileSync(DIST, original.replace(a.needle, a.rep), 'utf8');
  const run = runCarrier(port += 1);
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const { line, step } = reading(out);
  const red = run.status !== 0;
  const hit = a.expect.find((e) => step === e.step && out.includes(e.fragment));
  const match = red && hit !== undefined;
  say(`[${a.id}] ${a.why}\n      → RC=${String(run.status)} ${red ? '红' : '🔴 存活（判据没牙）'}｜${line.slice(0, 150)}`);
  if (!match) {
    failures += 1;
    const shapes = a.expect.map((e) => `step=${e.step} + "${e.fragment}"`).join(' ｜ ');
    say(`      🔴 预期红集（闭合枚举）：${shapes}；实得 step=${String(step)}`);
  }
  restoreAll();
}

const recheck = runCarrier(port += 1);
const recheckOut = `${recheck.stdout ?? ''}${recheck.stderr ?? ''}`;
say(`RECHECK RC=${String(recheck.status)} ${reading(recheckOut).line}`);
if (recheck.status !== 0 || !recheckOut.includes('RESULT=OK steps=13')) failures += 1;
if (existsSync(BAK)) unlinkSync(BAK);

say(
  `\nARMS=${failures === 0 ? 'pass' : 'FAIL'} (${String(ARMS.length - failures)}/${String(ARMS.length)})  ` +
    `载具 node ${CARRIER}（每臂一趟，~75s/趟）`,
);
process.exit(failures === 0 ? 0 : 1);
