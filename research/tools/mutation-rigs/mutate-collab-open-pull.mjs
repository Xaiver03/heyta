#!/usr/bin/env node
/**
 * 变异装置：「打开一份共享 ⇒ 拉一次既有下行」那三枚判据各自有没有牙
 * =================================================================
 *
 * 它不改产品行为，只回答一句质疑：`share-signals.spec.ts` / `share-open-pull.spec.tsx`
 * 绿了，是因为"每次都真发一次拉取""拉不成不抛穿""被拒也要敲重画""装配有调用点"
 * 这四件事各自被盯着，还是其中任何一条谁都拦不住。
 *
 * 这一格的病灶是 2026-10-25 iOS 设备腿 L2 实测抓出来的（计划 §9.14 第 30 跑）：
 * **加入之前就在清单里的东西**没有任何一条路径会带来 —— 而源码级读数当时全绿，
 * 因为它问的是"有没有这条路径"，而那条路径本来就不存在。所以这副臂里最值钱的
 * 不是本体那两枚，是**摘掉调用点**那两枚：装配存在但没有调用点，纯逻辑照样全绿。
 *
 * 五个臂、三个载具（本体 / 移动端装配 / web 装配），臂两两互不替代：
 *
 *  A `no-pull`          本体整条不发请求（"打开过了"就当"拉过了"）⇒ 红 3
 *  B `throw-through`    本体的 `catch` 摘掉（拉不成抛穿到界面）⇒ 只红 1
 *     🔴 A 与 B 是一对：B 单独红那一枚，证明「抛穿」那一格**自己**有牙（不是靠 A 一起红的）；
 *     A 多红的那两枚都断言同一件事 —— `pulled === true` 这个读数本身（其中一枚是**对照臂**，
 *     它的名字就写着"撤掉拉取会红"），所以 A 的红集是 3 而不是 2，逐字对账见臂内注释。
 *  C `added-only-repaint` 移动端重画条件收回只看 `added` ⇒ 只红「有验签拒」那一枚
 *     （被拒那条根本没落盘，`added` 恰好是 0 —— 旧条件正好漏掉这一族）
 *  D `mobile-call-site-gone` 摘掉 `ShareSpaceScreen` 的调用点 ⇒ 只红调用点那一枚
 *  E `web-call-site-gone`    摘掉 `App.tsx` 的调用点 ⇒ 只红 web 那一枚
 *
 * 口径按 `research/tools/mutation-rigs/README.md`：① 每个载具的基线必须先绿且那份 spec
 * 真跑到（否则退 2）；② 每臂**红集精确匹配**（条数 + 缺席 + 多红三条都过）；
 * ③ 还原后 md5 逐字节比对，最后逐载具复跑基线。
 *
 * 🔴 原地改工作树（五枚目标文件都归本线）。动手前逐枚验相对 HEAD 干净；
 * 本批实现**提交之前**它们必然脏着（那正是这批的产物），所以带一张 `OWNED` 自持登记表：
 * 登记在册 ⇒ 照跑并打印警告，登记外脏 ⇒ 退 **3**（不拿别人的未提交改动当实验台）。
 * 提交之后清空 `OWNED` 即回到全强度守卫。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-open-pull.mjs
 * 读数：`ARMS=pass (5/5)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');

const MARK = 'MUTATED-BY-RIG：这一处是装置注入的病灶，跑完即还原';

/** 本批未提交前允许脏着的文件（提交后清空这个集合）。 */
const OWNED = new Set([
  'packages/app-host/src/share-signals.ts',
  'apps/mobile/src/share/share-signals.ts',
  'apps/mobile/src/screens/ShareSpaceScreen.tsx',
  'apps/web/src/App.tsx',
]);

/** 三个载具：各自的 cwd 与那份 spec（只跑单文件，不并跑别的套件）。 */
const CARRIERS = {
  apphost: { dir: 'packages/app-host', spec: 'tests/share-signals.spec.ts' },
  mobile: { dir: 'apps/mobile', spec: 'tests/share-signals.spec.ts' },
  web: { dir: 'apps/web', spec: 'tests/share-open-pull.spec.tsx' },
};

const NEEDLE_APPHOST =
  '  try {\n    const result = await ports.pull(shareId);\n    return { shareId, pulled: true, added: result.added };\n  } catch (error: unknown) {\n    return { shareId, pulled: true, added: 0, error };\n  }\n';
const NEEDLE_MOBILE =
  '  if (reading.pulled && (reading.added > 0 || session.signatureRejections().length > 0)) {\n    emitShareRepaint();\n  }\n';
const NEEDLE_SCREEN = '    void pullSharedContentsOnOpen(selected).catch(() => undefined);\n';
const NEEDLE_WEB = '  useShareOpenPull(currentProject?.shareId);\n';

const ARMS = [
  {
    id: 'no-pull',
    carrier: 'apphost',
    target: 'packages/app-host/src/share-signals.ts',
    needle: NEEDLE_APPHOST,
    why: '本体整条不发请求（"打开过了"当成"拉过了"）⇒ 空清单照旧',
    rep: `  // ${MARK}\n  void ports;\n  return { shareId, pulled: false, added: 0 };\n`,
    // ⚠️ 首跑预测 2 红、实测 **3** 红，多出来那枚是「对照臂：追平那一趟（added=0）照样算"拉过"」。
    //    逐条读后确认它**该红**：那条断言的就是 `pulled === true` 这件事本身（撤掉拉取它就必须红，
    //    它的名字里写着这一句）⇒ 与另两条同一个不变量。改的是**预测**不是判据
    //    （同 `mutate-collab-pull-cursor.mjs` / `mutate-collab-share-routing.mjs` 那两处的对账口径）。
    mustInclude: ['打开 ⇒ 真的发一次拉取', '拉取抛错 ⇒ 不抛穿', '对照臂：追平那一趟'],
    expect: 3,
  },
  {
    id: 'throw-through',
    carrier: 'apphost',
    target: 'packages/app-host/src/share-signals.ts',
    needle: NEEDLE_APPHOST,
    why: '本体的 catch 摘掉 ⇒ 锁着的保险库变成一次抛穿（A 多红那一枚由这一臂单独负责）',
    rep: `  // ${MARK}\n  const result = await ports.pull(shareId);\n  return { shareId, pulled: true, added: result.added };\n`,
    mustInclude: ['拉取抛错 ⇒ 不抛穿'],
    expect: 1,
  },
  {
    id: 'added-only-repaint',
    carrier: 'mobile',
    target: 'apps/mobile/src/share/share-signals.ts',
    needle: NEEDLE_MOBILE,
    why: '重画只看 `added` ⇒ 被验签拒那一条（根本没落盘、added 恰为 0）在界面上什么都不动',
    rep: `  // ${MARK}\n  if (reading.pulled && reading.added > 0) {\n    emitShareRepaint();\n  }\n`,
    mustInclude: ['added = 0 但有验签拒'],
    expect: 1,
  },
  {
    id: 'mobile-call-site-gone',
    carrier: 'mobile',
    target: 'apps/mobile/src/screens/ShareSpaceScreen.tsx',
    needle: NEEDLE_SCREEN,
    why: '装配在、没人调 ⇒ L2 那一格回到实测到的空清单（纯逻辑那 14 枚照样全绿）',
    // 🔴 替换文本里不许出现那枚函数名加左括号：调用点判据按 token 命中，写了就等于没摘。
    rep: `    void selected; // ${MARK}\n`,
    mustInclude: ['界面里有调用点'],
    expect: 1,
  },
  {
    id: 'web-call-site-gone',
    carrier: 'web',
    target: 'apps/web/src/App.tsx',
    needle: NEEDLE_WEB,
    why: '同一枚洞在 web 那一半的调用点摘掉 ⇒ 两壳同形的缺陷只修了一半',
    // 🔴 同上：不许把 hook 名加左括号写进替换文本。
    rep: `  void currentProject; // ${MARK}\n`,
    mustInclude: ['调用点全壳唯一'],
    expect: 1,
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
  // ⚠️ 全绿时那一行是「14 passed (14)」—— **没有** "N failed" 字样。
  //    把它读成 `NaN` 再拿 `NaN !== 0` 去判"基线不绿"，就会让一台好装置在**好基线**上自杀
  //    （本装置第一版正是这样：`BASELINE RC=0 Tests=14 passed` 却 `ARMS=ABORT`）。
  //    ⇒ 缺席就是 0。
  const failedToken = /(\d+) failed/.exec(sum ?? '');
  const failed = failedToken === null ? 0 : Number(failedToken[1]);
  // `ran` 取那一行末尾括号里的总数（README 纪律①：`ran <= 0` 直接抛，
  // 否则"没跑起来的臂"长得和"没牙的判据"一模一样）。
  const ran = Number(/\((\d+)\)\s*$/.exec(sum ?? '')?.[1] ?? 0);
  const titles = [...out.matchAll(/^\s*×\s+(.+?)\s+\d+ms\s*$/gm)].map((m) => m[1]);
  const files = /^\s*Test Files\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  return { sum, failed, titles, files, ran };
}

/* ── 守卫：五枚目标存在、needle 各命中一次、脏只允许登记在册的那几枚 ─────── */

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
  if (dirty !== '' && !OWNED.has(a.target)) {
    say(`ARMS=ENV dirty-worktree —— ${a.target} 脏着且不在 OWNED 登记表里，装置不在别人的改动上动刀。\n   ${dirty}`);
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
const registeredDirty = [...OWNED].filter((f) => git(['status', '--porcelain', '--', f]).trim() !== '');
say(
  `GUARD ✅ ${String(ARMS.length)} 臂的 needle 各命中 1 次；` +
    (registeredDirty.length === 0
      ? '五枚目标相对 HEAD 全干净'
      : `其中 ${String(registeredDirty.length)} 枚脏着，都在 OWNED 登记表里（本批实现未提交，提交后请清空该表）`),
);

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

/* ── 每个载具一次基线：不绿就响亮退出，不静默记成"问不到" ───────────────── */

for (const [name, c] of Object.entries(CARRIERS)) {
  const base = sh(c.dir, `npx vitest run ${c.spec}`);
  const bp = parseVitest(`${base.stdout ?? ''}${base.stderr ?? ''}`);
  say(`BASELINE[${name}] RC=${String(base.status)} Tests=${bp.sum ?? '?'} TestFiles=${bp.files ?? '?'}`);
  if (base.status !== 0 || !/^1 passed/.test(bp.files ?? '') || bp.ran <= 0 || bp.failed !== 0) {
    say(`ARMS=ABORT reason=baseline-not-green[${name}]（基线红、或那份 spec 压根没跑到 ⇒ 台架自己坏了，拒绝读数）`);
    process.exit(2);
  }
}

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
        ? '🔴 这一臂压根没跑起来（`ran = 0` ⇒ 与"判据没牙"同形，见 README 纪律①）'
        : survived
          ? '🔴 存活（判据没牙）'
          : match
            ? '红集精确匹配'
            : '⚠️ 红集漂移'
    }`,
  );
  for (const t of p.titles.slice(0, 8)) say(`      · ${t}`);
  if (missing.length > 0) say(`      🔴 预期红的用例缺席: ${missing.join(' | ')}`);
  if (extra.length > 0) say(`      ⚠️ 额外红的用例: ${extra.map((t) => t.slice(0, 40)).join(' | ')}`);
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
    '载具 cd packages/app-host|apps/mobile|apps/web && npx vitest run <各自那份 spec>',
);
process.exit(failures === 0 ? 0 : 1);
