#!/usr/bin/env node
/**
 * 变异装置：共享「同意闸」三层各自有没有牙（模型 / web 入群对话框 / 移动端入群屏）
 * =================================================================
 *
 * 它不改产品行为，只回答一句质疑：`share-consent-model.spec.ts`（模型 6 枚）、
 * `apps/web/tests/share-join-consent-gate.spec.tsx`（web 5 枚）、以及移动端那两枚
 * `shouldShowConsent` 调用点，绿了是因为
 * ① **fail-closed 方向**（没记录 / 半条记录 ⇒ 必须弹）、
 * ② 「确认过但没勾不再提示 ⇒ 还会弹」这条 repeat 纪律、
 * ③ **每一壳真的把闸接在自己的入口上**（装配存在且有调用点）
 * 这三件事各自被盯着，还是其中任何一条谁都拦不住。
 *
 * 为什么要单独问③：同意闸的判断只在 `@heyta/ui` 一处，两壳各只有一个调用点。
 * 模型那 6 枚全绿**不排斥**某一壳的调用点整行被摘掉 —— 摘掉之后那一壳直接进表单，
 * 而"这条共享被打开过"这件事在界面上少了一道同意，纯逻辑判据一条都不会红。
 * 这正是本仓反复登记过的形状：`mutate-collab-open-pull.mjs` 里最值钱的臂是
 * **摘调用点**那两枚，不是本体那两枚。
 *
 * 三臂、三个载具：
 *
 *  A `fail-open`                   模型：没记录也返回"不弹" ⇒ 红 fail-closed 那几条
 *  B `web-call-site-gone`          web 入群对话框的闸整行摘掉 ⇒ 红 web 那几条"必须弹"
 *  C `mobile-call-site-gone`       移动端入群屏的闸整行摘掉
 *  D `mobile-owner-call-site-gone` 移动端「开启共享」那一侧的闸整行摘掉
 *
 * 🔴 C 与 D 的牙不是白来的：写这副臂时现量 `grep -rn shouldShowConsent apps/mobile/tests/` ⇒ **零命中**
 * —— 那一壳的调用点在当时**没有任何常驻判据指着它**，C/D 两臂会直接"存活（判据没牙）"。
 * 所以先补判据（`apps/mobile/tests/share-ui-assembly.spec.ts` 的 ⑨ 组两枚），再让臂打上去。
 *
 * 口径按 `research/tools/mutation-rigs/README.md`：基线必须先绿且那份 spec 真跑到（否则退 2）；
 * 每臂红集**精确匹配**（条数 + 缺席 + 多红）；还原后 md5 逐字节比对，最后逐载具复跑基线。
 *
 * 🔴 原地改工作树（四枚目标文件都归协作线）。动手前逐枚验相对 HEAD 干净；脏 ⇒ 退 **3**。
 * ⚠️ 跑之前确认同一棵共享检出里没有别人的 `pnpm check` / `pnpm -r test` 正读到这几份源码。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-consent-gate.mjs
 * 读数：`ARMS=pass (3/3)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
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
  model: { dir: 'packages/ui', spec: 'tests/share-consent-model.spec.ts' },
  web: { dir: 'apps/web', spec: 'tests/share-join-consent-gate.spec.tsx' },
  mobile: { dir: 'apps/mobile', spec: 'tests/share-ui-assembly.spec.ts' },
};

const NEEDLE_MODEL = `  return {
    show: true,
    reason: store.consentAcceptedAt !== undefined ? 'repeat' : 'first-time',
  };
`;
const NEEDLE_WEB = "    shouldShowConsent(loadShareConsent(localStorage)).show ? { kind: 'consent' } : { kind: 'input' },\n";
const NEEDLE_MOBILE = '    const decision = shouldShowConsent(loadMobileShareConsent());\n';
const NEEDLE_MOBILE_OWNER = '      const decision = shouldShowConsent(consentStore);\n';

const ARMS = [
  {
    id: 'fail-open',
    carrier: 'model',
    target: 'packages/ui/src/sync/share-consent-model.ts',
    needle: NEEDLE_MODEL,
    why: '没有任何记录也返回"不弹" ⇒ 同意闸变成默认放行（ADR-0071 那条 fail-closed 反了）',
    rep: `  // ${MARK}\n  return { show: false, reason: 'opted-out' };\n`,
    // 「取消不是同意」那一枚在同一个 it 里复查 `shouldShowConsent(result.store)` ⇒ 被一起顶红：4 而不是 3
    mustInclude: ['没有任何记录', '半条记录', '还会弹', '取消不是同意'],
    expect: 4,
  },
  {
    id: 'web-call-site-gone',
    carrier: 'web',
    target: 'apps/web/src/features/share/JoinSharedListDialog.tsx',
    needle: NEEDLE_WEB,
    why: 'web 那一壳的闸整行摘掉 ⇒ 模型全绿而界面上少一道同意',
    rep: `    { kind: 'input' }, // ${MARK}\n`,
    // 四枚而不是三枚：`press()` 在 DOM 里找不到同意面的按钮就抛，
    // 所以「确认 + 勾不再提示 ⇒ 直接到表单」那一枚也走不到它的断言
    mustInclude: ['先弹同意面', '直接到表单', '下一次仍然弹', '取消不是同意'],
    expect: 4,
  },
  {
    id: 'mobile-call-site-gone',
    carrier: 'mobile',
    target: 'apps/mobile/src/screens/JoinShareScreen.tsx',
    needle: NEEDLE_MOBILE,
    why: '移动端那一壳的闸整行摘掉 ⇒ 手机上"没确认过也直接进表单"',
    // 🔴 替换文本里不许出现那枚函数名加左括号：调用点判据按 token 命中，写了就等于没摘。
    rep: `    const decision = { show: false, reason: 'opted-out' } as const; // ${MARK}\n`,
    mustInclude: ['入群屏先问'],
    expect: 1,
  },
  {
    id: 'mobile-owner-call-site-gone',
    carrier: 'mobile',
    target: 'apps/mobile/src/screens/ShareSpaceScreen.tsx',
    needle: NEEDLE_MOBILE_OWNER,
    why: '移动端「开启共享」那一侧的闸整行摘掉 ⇒ 点一下就把清单变成共享，不问一句',
    rep: `      const decision = { show: false, reason: 'opted-out' } as const; // ${MARK}\n`,
    mustInclude: ['开启共享前先问'],
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
    '载具 cd packages/ui|apps/web|apps/mobile && npx vitest run <各自那份 spec>',
);
process.exit(failures === 0 ? 0 : 1);
