#!/usr/bin/env node
/**
 * 变异装置：M3 换钥那几条判据**到底能不能红**
 * ==========================================
 *
 * 它不改产品行为，只回答一句质疑：「`share-rekey.spec.ts` 绿了，是因为换钥写错会被抓住，
 * 还是因为那几条断言谁都拦不住？」
 *
 * 四臂各注一枚**真实会犯的**病灶（A 是计划 §9.1 点名过的那个现状，B/C/D 是这一片开发
 * 过程里差点犯的）：
 *
 *  A `same-key-resealed`：换钥时把**同一把** listKey 贴个新世代发出去。
 *     症状就是 §9.1 那一行——门牌号换了、屋里没换，被移除的人手里的旧钥照样解得开
 *     "新"内容，而界面与库里都显示已经换过代了。
 *  B `skip-self-envelope`：收件人里漏掉 owner 自己那一行（他的成员行没有 `identityPublicKey`，
 *     只照名册发信封就必然漏——`POST /shares` 不收 owner 的公钥）。
 *     症状是 owner 换设备/重装后再也拿不回这把钥，而面板一切正常。
 *  C `adopt-ignores-epoch`：收新钥时不验"这一行的世代 == 服务端的世代"。
 *     症状是把上一代的信封当新钥存下来，从此以为自己在最前面，实际锁在门外。
 *  D `key-not-stored`：新钥只发信封、不落本地环。
 *     症状是**新钥一把都没留住**：成员手里的旧钥失效、owner 自己也没了新的。
 *
 * 口径按 `research/tools/mutation-rigs/README.md`：
 *   ① 基线对照必须先绿，且那份 spec 真的跑到（分母 = 1 个文件）—— 否则 `PROBE_BROKEN` 退 2；
 *   ② 每臂要求**红集精确匹配**：条数 = `expect`、预期的那几条必须红、且**不许多红**；
 *   ③ 每臂还原后 md5 逐字节比对，还原前后各复跑一次基线。
 *
 * 🔴 它**原地改工作树**（`packages/app-host/src/share-rekey.ts` 归本线），所以动手前先验
 *    该文件相对 HEAD 干净，脏就 `ARMS=ENV dirty-worktree` 退 **3**：本仓多会话共用一个检出，
 *    不能拿别人未提交的改动当实验台。还原用**内存副本**，不是 `git checkout`。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-rekey.mjs
 * 读数：`ARMS=pass (4/4)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');
const PKG = join(ROOT, 'packages/app-host');
const TARGET = join(PKG, 'src/share-rekey.ts');
const REL = 'packages/app-host/src/share-rekey.ts';
const SPEC = 'tests/share-rekey.spec.ts';

const MARK = 'MUTATED-BY-RIG：这一处是装置注入的病灶，跑完即还原';

const ARMS = [
  {
    id: 'same-key-resealed',
    why: '复封同一把 listKey ⇒ 世代号换了、屋里没换',
    needle: '    await options.keys.save(shareId, { keyEpoch: plan.toEpoch, listKey: plan.newListKey });\n',
    rep: `    // ${MARK}\n    await options.keys.save(shareId, { keyEpoch: plan.toEpoch, listKey: local.listKey });\n`,
    mustInclude: [
      '换出来的是**另一把钥**',
      '被移除的人拿旧钥解不开新世代写的内容',
      // 本地存旧钥、信封却发新钥 ⇒ 成员收到的和 owner 盘上那把不是同一把。
      // 这条不是"额外红的"，它钉的正是同一个不变量（发出去的 = 自己留的）。
      '在册成员从自己那行收到**同一把新钥**',
    ],
    expect: 3,
  },
  {
    id: 'skip-self-envelope',
    why: '收件人漏掉 owner 自己 ⇒ 他那把钥只存在于别人的信封里',
    needle: '      { memberId: identity.memberId, publicKey: identity.x25519PublicKey },\n',
    rep: `      // ${MARK}\n`,
    mustInclude: [
      '自己的信封排第一',
      '一枚 PUT 失败不拖垮整轮',
      '名册里有行没有公钥',
      '先移除、后换钥',
      // 那枚真密码学判据红在"旧钥仍解得开"：名册只剩 owner 一人时漏掉自己 ⇒ 收件人为空
      // ⇒ `planShareRekey` 直接抛「Share rekey requires at least one remaining member」
      // （空收件人这一支在 packages/sync-core/dist 现量试过），这一轮换钥根本没做成。
      // 抓的是同一件伤害，不是病灶蔓延到别处。
      '被移除的人拿旧钥解不开新世代写的内容',
    ],
    expect: 5,
  },
  {
    id: 'adopt-ignores-epoch',
    why: '收钥时不验世代 ⇒ 把上一代的信封当新钥存下来',
    needle: '    if (own.memberKeyEpoch !== detail.keyEpoch) {\n',
    rep: `    // ${MARK}\n    if (false) {\n`,
    mustInclude: ['信封在、但那一行的世代与服务端不一致'],
    expect: 1,
  },
  {
    id: 'key-not-stored',
    why: '新钥只发不落环 ⇒ 本机这把钥根本没留住',
    needle: '    await options.keys.save(shareId, { keyEpoch: plan.toEpoch, listKey: plan.newListKey });\n',
    rep: `    // ${MARK}\n`,
    mustInclude: [
      '换出来的是**另一把钥**',
      '新钥先落本地环，再发信封',
      '在册成员从自己那行收到**同一把新钥**',
      '先移除、后换钥',
      '被移除的人拿旧钥解不开新世代写的内容',
    ],
    expect: 5,
  },
];

const md5 = (s) => createHash('md5').update(s).digest('hex');
const say = (line) => process.stdout.write(`${line}\n`);
const git = (args) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).stdout ?? '';

const sh = (cmd) =>
  spawnSync(cmd, {
    cwd: PKG,
    shell: '/bin/sh',
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 1 << 28,
  });

// vitest 默认 reporter 的失败行形状：`     × <title> 12ms`（从真实日志核对，不凭记忆写）。
function parseVitest(out) {
  const sum = /^\s*Tests\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  const failed = Number(/(\d+) failed/.exec(sum ?? '')?.[1] ?? NaN);
  const titles = [...out.matchAll(/^\s*×\s+(.+?)\s+\d+ms\s*$/gm)].map((m) => m[1]);
  const files = /^\s*Test Files\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  return { sum, failed, titles, files };
}

/* ── 前置：文件在场 + 相对 HEAD 干净 + 每枚 needle 恰好命中一次 ─────────── */
if (!existsSync(TARGET)) {
  say(`ARMS=FAIL reason=target-missing ${REL}`);
  process.exit(1);
}
const original = readFileSync(TARGET, 'utf8');
const dirty = git(['status', '--porcelain', '--', REL]).trim();
if (dirty !== '') {
  say(`ARMS=ENV dirty-worktree —— ${REL} 相对 HEAD 有未提交改动，装置不在别人的改动上动刀。\n   ${dirty}`);
  process.exit(3);
}
for (const a of ARMS) {
  const hits = original.split(a.needle).length - 1;
  if (hits !== 1) {
    say(`ARMS=FAIL reason=needle-hits=${String(hits)} arm=${a.id} —— 锚点必须恰好一处，否则注病灶的位置不确定`);
    process.exit(1);
  }
}
say(`GUARD ✅ ${ARMS.length} 臂的 needle 各命中 1 次，且 ${REL} 相对 HEAD 干净`);

let dirtyTarget = false;
const restore = () => {
  writeFileSync(TARGET, original, 'utf8');
  dirtyTarget = false;
  if (md5(readFileSync(TARGET, 'utf8')) !== md5(original)) {
    say(`ARMS=FAIL reason=RESTORE=DIRTY md5 ${md5(original)} -> ${md5(readFileSync(TARGET, 'utf8'))}`);
    process.exit(4);
  }
};
process.on('exit', () => {
  if (readFileSync(TARGET, 'utf8') !== original) restore();
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    say(`🔴 收到 ${sig}${dirtyTarget ? '（正处在变异态）' : ''} —— 先还原再退出`);
    restore();
    process.exit(130);
  });
}

/* ── ① 基线对照 ─────────────────────────────────────────────────────── */
const base = sh(`./node_modules/.bin/vitest run ${SPEC}`);
const bp = parseVitest(base.stdout + (base.stderr ?? ''));
say(`BASELINE RC=${String(base.status)} Tests=${bp.sum ?? '?'} TestFiles=${bp.files ?? '?'}`);
if (base.status !== 0 || !/^1 passed/.test(bp.files ?? '')) {
  say('ARMS=ABORT reason=baseline-not-green（基线红、或那份 spec 压根没跑到 ⇒ 台架自己坏了，拒绝读数）');
  restore();
  process.exit(2);
}

/* ── ② 逐臂注病灶 ───────────────────────────────────────────────────── */
let failures = 0;
for (const a of ARMS) {
  dirtyTarget = true;
  writeFileSync(TARGET, original.replace(a.needle, a.rep), 'utf8');
  const run = sh(`./node_modules/.bin/vitest run ${SPEC}`);
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const p = parseVitest(out);
  const survived = run.status === 0;
  const missing = a.mustInclude.filter((tag) => !p.titles.some((t) => t.includes(tag)));
  const extra = p.titles.filter((t) => !a.mustInclude.some((tag) => t.includes(tag)));
  const match = !survived && p.failed === a.expect && missing.length === 0 && extra.length === 0;
  say(`[${a.id}] ${a.why} → RC=${String(run.status)} 红 ${String(p.failed)}/${String(a.expect)} ${
    survived ? '🔴 存活（判据没牙）' : match ? '红集精确匹配' : '⚠️ 红集漂移'
  }`);
  for (const t of p.titles.slice(0, 8)) say(`      · ${t}`);
  if (missing.length > 0) say(`      🔴 预期红的用例缺席: ${missing.join(' | ')}`);
  if (extra.length > 0) say(`      ⚠️ 额外红的用例: ${extra.map((t) => t.slice(0, 30)).join(' | ')}`);
  restore();
  if (!match) failures += 1;
}

/* ── ③ 还原后复跑基线 ───────────────────────────────────────────────── */
const recheck = sh(`./node_modules/.bin/vitest run ${SPEC}`);
const rp = parseVitest(`${recheck.stdout ?? ''}${recheck.stderr ?? ''}`);
say(`RECHECK RC=${String(recheck.status)} Tests=${rp.sum ?? '?'} md5=${md5(original) === md5(readFileSync(TARGET, 'utf8')) ? 'byte-identical' : 'DIRTY'}`);
if (recheck.status !== 0) failures += 1;

say(`\nARMS=${failures === 0 ? 'pass' : 'FAIL'} (${String(ARMS.length - failures)}/${String(ARMS.length)})  载具 cd packages/app-host && npx vitest run ${SPEC}`);
process.exit(failures === 0 ? 0 : 1);
