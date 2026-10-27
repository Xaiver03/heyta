#!/usr/bin/env node
/**
 * 变异装置：M6 移动端「密钥落盘端口」与「载荷密钥接线」那几格判据各自有没有牙
 * =================================================================
 *
 * 它不改产品行为，只回答一句质疑：`apps/mobile/tests/share-key-store.spec.ts` 与
 * `apps/mobile/tests/share-session.spec.ts` 绿了，是因为
 * ① 密钥料落在 **vault root key 之外的兄弟槽**（不覆盖 root key），
 * ② `remove` 真的摘键、摘到最后一枚把整槽删掉，
 * ③ 键不存在时如实回 `null`（core 靠 `null` 与空串区分"没存过"），
 * ④ 会话建出来时**载荷密钥真的被取走并交进共享上下文**
 * 这四件事各自被盯着，还是其中任何一条谁都拦不住。
 *
 * 为什么这一格值得单独一副臂：设备腿 L4 证的是"手机写出的 op 在 owner 侧重验 = verified"，
 * 它一次covers了①–④ 整条链的**结果**；而链上任何一环退化（比如密钥料落回 root key 那一格、
 * 或者 `getPayloadCipher()` 再没人调）都可能被另一环兜住而**在设备腿上看不出来**。
 * 计划 §9.17 登记过同一族的教训：按任务书名字下的探针会打空，绿也不等于有牙。
 *
 * 四臂、两个载具（都在 `apps/mobile`，各跑自己那份 spec）：
 *
 *  A `slot-suffix-gone`   accountId 不拼 `#share-keys` 后缀 ⇒ 密钥料与 root key 抢同一格
 *  B `remove-noop`        `remove()` 里的 `delete` 打空 ⇒ 摘掉的键还在盘上、整槽永不删
 *  C `null-as-empty`      键不存在时回空串 ⇒ "没存过"被读成"存过一枚空值"
 *  D `cipher-not-taken`   不再调 `getPayloadCipher()`，恒交 `undefined` ⇒ 共享上下文没有载荷密钥
 *
 * 口径按 `research/tools/mutation-rigs/README.md`：① 每个载具基线必须先绿且那份 spec 真跑到
 * （否则退 2）；② 每臂**红集精确匹配**（条数 + 缺席 + 多红三条都过）；
 * ③ 还原后 md5 逐字节比对，最后逐载具复跑基线。
 *
 * 🔴 原地改工作树（四枚目标文件都归协作线）。动手前逐枚验相对 HEAD 干净；脏且不在册 ⇒ 退 **3**
 * （不拿别人的未提交改动当实验台）。
 * ⚠️ 这副臂会往 `apps/mobile/src/**` 注入病灶，**跑之前必须确认同一棵检出里没有别的
 * `pnpm check` / `pnpm -r test` 在飞**（2026-10-27 实测：邻会话那条 130 段链会把注入态读成自己的红）。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-mobile-keywiring.mjs
 * 读数：`ARMS=pass (4/4)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
 * 首跑读数：见同目录 README 那一行与本线计划 §9.17。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');

const MARK = 'MUTATED-BY-RIG：这一处是装置注入的病灶，跑完即还原';

const CARRIERS = {
  keystore: { dir: 'apps/mobile', spec: 'tests/share-key-store.spec.ts' },
  session: { dir: 'apps/mobile', spec: 'tests/share-session.spec.ts' },
};

const NEEDLE_SUFFIX = "const SHARE_KEYS_SLOT_SUFFIX = '#share-keys';";
const NEEDLE_DELETE = '      delete map[key];\n';
const NEEDLE_NULLISH =
  "      return Object.prototype.hasOwnProperty.call(map, key) ? (map[key] as string) : null;\n";
const NEEDLE_CIPHER = '    vaultCipher = await session?.getPayloadCipher();\n';

const ARMS = [
  {
    id: 'slot-suffix-gone',
    carrier: 'keystore',
    target: 'apps/mobile/src/lib/share-key-store.ts',
    needle: NEEDLE_SUFFIX,
    why: '密钥料落回 root key 那一格（同 origin 同 accountId）⇒ 两把钥匙抢同一槽',
    rep: `const SHARE_KEYS_SLOT_SUFFIX = ''; // ${MARK}\n`,
    mustInclude: ['兄弟槽'],
    expect: 1,
  },
  {
    id: 'remove-noop',
    carrier: 'keystore',
    target: 'apps/mobile/src/lib/share-key-store.ts',
    needle: NEEDLE_DELETE,
    why: '`remove()` 只查不删 ⇒ 摘掉的键还在盘上，最后一枚也永远删不掉整槽',
    rep: `      void map[key]; // ${MARK}\n`,
    mustInclude: ['get/set/remove 往返', '最后一个键'],
    expect: 2,
  },
  {
    id: 'null-as-empty',
    carrier: 'keystore',
    target: 'apps/mobile/src/lib/share-key-store.ts',
    needle: NEEDLE_NULLISH,
    why: '键不存在时回空串 ⇒ core 分不清"没存过"与"存过一枚空值"（ADR-0062 那条口径）',
    rep: `      return ''; // ${MARK}\n`,
    // ⚠️ 首跑预测 2 红、实测 **4** 红。逐条读后确认四条**都该红**：它们各从一条入路断言同一件事
    //    （"没存过 ⇒ 如实 null"）——往返那一枚是摘键之后、幂等那一枚是压根没写过、
    //    整槽删除那一枚是删空之后回读、坏槽那一枚是被污染过之后当空槽。
    //    ⇒ 这一臂的牙不是只咬"往返"那一枚，是把这一条口径的四条入路一起咬住。改的是**预测**不是判据。
    mustInclude: ['往返', '最后一个键', '幂等', '坏槽'],
    expect: 4,
  },
  {
    id: 'cipher-not-taken',
    carrier: 'session',
    target: 'apps/mobile/src/share/share-session.ts',
    needle: NEEDLE_CIPHER,
    why: '不再取载荷密钥，恒交 `undefined` ⇒ 共享上下文建得出来但加不了密',
    rep: `    void session; // ${MARK}\n    vaultCipher = undefined;\n`,
    // ⚠️ 首跑预测的是那枚**静态装配**断言（名字里写着"入口真的被武装且带着真实端口"）红，
    //    实测它**不红**、红的是另外四枚行为断言（单例 / 换账号 / 登出摘掉 / reset 重问）——
    //    四枚都要真的建出一份共享上下文，密钥取不到就建不出来 ⇒ 行为那一侧有牙。
    //    静态那一枚数的是调用点存在性，它本来就不该负责"取到没取到"这一格，留原样。
    //    ⇒ 同样只改预测，不改判据。
    mustInclude: ['同一登录态问十次', '换账号', '登出清空凭据', 'reset（离场'],
    expect: 4,
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
  const failedToken = /(\d+) failed/.exec(sum ?? '');
  const failed = failedToken === null ? 0 : Number(failedToken[1]);
  const ran = Number(/\((\d+)\)\s*$/.exec(sum ?? '')?.[1] ?? 0);
  const titles = [...out.matchAll(/^\s*×\s+(.+?)\s+\d+ms\s*$/gm)].map((m) => m[1]);
  const files = /^\s*Test Files\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  return { sum, failed, titles, files, ran };
}

/* ── 守卫 ─────────────────────────────────────────────────────────────── */

const originals = new Map();
let guardFail = false;
for (const a of ARMS) {
  const abs = join(ROOT, a.target);
  if (!existsSync(abs)) {
    say(`ARMS=FAIL reason=target-missing ${a.target}`);
    guardFail = true;
    continue;
  }
  const dirty = git(['status', '--porcelain', '--', a.target]).trim();
  if (dirty !== '') {
    say(`ARMS=ENV dirty-worktree —— ${a.target} 脏着，装置不在别人的未提交改动上动刀。\n   ${dirty}`);
    process.exit(3);
  }
  const src = readFileSync(abs, 'utf8');
  const hits = src.split(a.needle).length - 1;
  if (hits !== 1) {
    say(`ARMS=FAIL reason=needle-hits=${String(hits)} arm=${a.id} —— 锚点必须恰好一处，否则注病灶的位置不确定`);
    guardFail = true;
    continue;
  }
  if (!originals.has(a.target)) originals.set(a.target, src);
}
if (guardFail) process.exit(1);
say(`GUARD ✅ ${String(ARMS.length)} 臂的 needle 各命中 1 次，${String(originals.size)} 枚目标相对 HEAD 全干净`);

const restoreAll = () => {
  for (const [rel, original] of originals) {
    const abs = join(ROOT, rel);
    if (readFileSync(abs, 'utf8') === original) continue;
    writeFileSync(abs, original, 'utf8');
    if (md5(readFileSync(abs, 'utf8')) !== md5(original)) {
      say(`ARMS=FAIL reason=RESTORE=DIRTY ${rel} md5=${md5(original)} -> ${md5(readFileSync(abs, 'utf8'))}`);
      process.exit(4);
    }
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

/* ── 基线 ─────────────────────────────────────────────────────────────── */

for (const [name, c] of Object.entries(CARRIERS)) {
  const base = sh(c.dir, `npx vitest run ${c.spec}`);
  const bp = parseVitest(`${base.stdout ?? ''}${base.stderr ?? ''}`);
  say(`BASELINE[${name}] RC=${String(base.status)} Tests=${bp.sum ?? '?'} TestFiles=${bp.files ?? '?'}`);
  if (base.status !== 0 || bp.ran <= 0 || bp.failed !== 0) {
    say(`ARMS=ABORT reason=baseline-not-green[${name}]（基线红、或那份 spec 压根没跑到 ⇒ 台架自己坏了，拒绝读数）`);
    process.exit(2);
  }
}

/* ── 逐臂 ─────────────────────────────────────────────────────────────── */

let failures = 0;
for (const a of ARMS) {
  const carrier = CARRIERS[a.carrier];
  const abs = join(ROOT, a.target);
  writeFileSync(abs, originals.get(a.target).replace(a.needle, a.rep), 'utf8');
  const run = sh(carrier.dir, `npx vitest run ${carrier.spec}`);
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const p = parseVitest(out);
  const survived = run.status === 0;
  const ranOk = p.ran > 0;
  const missing = a.mustInclude.filter((tag) => !p.titles.some((t) => t.includes(tag)));
  const extra = p.titles.filter((t) => !a.mustInclude.some((tag) => t.includes(tag)));
  const match = ranOk && !survived && p.failed === a.expect && missing.length === 0 && extra.length === 0;
  say(
    `[${a.id}] ${a.why}\n      → RC=${String(run.status)} 红 ${String(p.failed)}/${String(a.expect)} ran=${String(p.ran)} ${
      !ranOk
        ? '🔴 这一臂压根没跑起来（`ran = 0` ⇒ 与"判据没牙"同形）'
        : survived
          ? '🔴 存活（判据没牙）'
          : match
            ? '红集精确匹配'
            : '⚠️ 红集漂移'
    }`,
  );
  for (const t of p.titles.slice(0, 8)) say(`      · ${t}`);
  if (missing.length > 0) say(`      🔴 预期红的用例缺席: ${missing.join(' | ')}`);
  if (extra.length > 0) say(`      ⚠️ 额外红的用例: ${extra.map((t) => t.slice(0, 46)).join(' | ')}`);
  restoreAll();
  if (!match) failures += 1;
}

for (const [name, c] of Object.entries(CARRIERS)) {
  const recheck = sh(c.dir, `npx vitest run ${c.spec}`);
  const rp = parseVitest(`${recheck.stdout ?? ''}${recheck.stderr ?? ''}`);
  say(`RECHECK[${name}] RC=${String(recheck.status)} Tests=${rp.sum ?? '?'}`);
  if (recheck.status !== 0 || rp.ran <= 0) failures += 1;
}

say(
  `\nARMS=${failures === 0 ? 'pass' : 'FAIL'} (${String(ARMS.length - failures)}/${String(ARMS.length)})  ` +
    '载具 cd apps/mobile && npx vitest run tests/share-key-store.spec.ts|tests/share-session.spec.ts',
);
process.exit(failures === 0 ? 0 : 1);
