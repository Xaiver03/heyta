#!/usr/bin/env node
/**
 * 变异装置：ADR-0071「共享通知的正文口径」那五条判据各自有没有牙
 * ================================================================
 *
 * 它不改产品行为，只回答一句质疑：`packages/ui` 与 `apps/web` 两份 spec 都绿了，
 * 是因为**口径真的有人守着**，还是因为"闸门在 ui 测过、投递在壳里测过，
 * 而接起来那一行没人测"——本仓最高发的失效形状。
 *
 * 四臂分打两个载具：
 *  1 `gate-skipped`      接线时跳过同意 + 偏好闸门，把到达的活动直接投出去
 *  2 `name-from-content` 🔴 正文里"名字"那一格被换成**条目内容**（任务标题）——
 *                        这一臂就是口径的牙齿：端到端加密下本机解得开明文，
 *                        症状又只是"通知更好读了"，只有判据能看出它破了边界。
 *                        ⚠️ 首跑预测 3 红、实测 **2**：④ 那一枚没红是**对的** ——
 *                        病灶只在"本机有清单行"时才把名字换成标题，而 ④ 问的是
 *                        "没有行时回落不回落"，那是另一件事（它的反向证据是 `no-fallback`）。
 *                        收紧的是预测，不是判据。
 *  3 `consent-ignored`   同意那道门在模型里被摘掉（偏好闸门照旧 ⇒ 只红同意那两枚）
 *  4 `no-fallback`       拿不到名字时不回落到不带名字那句，硬拼一个空名字
 *
 * 口径按 `research/tools/mutation-rigs/README.md`：① 基线必须先绿且那份 spec 真跑到
 * （否则退 2）；② 每臂**红集精确匹配**（条数 + 缺席 + 多红三条都过）；③ 还原只从
 * `.mut-bak` 取并 md5 逐字节比对，最后复跑基线。
 *
 * 🔴 原地改工作树（目标文件全归本线），动手前逐枚验它相对 HEAD 干净，脏就退 **3**。
 *    ⚠️ **本批实现本身还没提交**（这一格的判据钉的就是刚写的那几行，交给人 commit 之前
 *    必须能验证），所以装置带一张**自持登记表** `OWNED`：登记在册的文件脏着照样跑，
 *    并打出 `GUARD ⚠️`；登记外的文件一旦脏 ⇒ 退 3（不在别人的改动上动刀）。
 *    提交之后把登记表清空即可回到全强度守卫 —— 这一条欠账登记在计划 §9.10 那一节。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-notif-content.mjs
 * 读数：`ARMS=pass (4/4)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');
const MARK = 'MUTATED-BY-RIG：这一处是装置注入的病灶，跑完即还原';

const CARRIERS = {
  web: { pkg: 'apps/web', spec: 'tests/share-notification-content.spec.tsx' },
  ui: { pkg: 'packages/ui', spec: 'tests/notification-content-boundary.spec.ts' },
};

/** 本批正在写、还没提交的文件 —— 脏着允许跑，登记表外一律退 3。 */
const OWNED = new Set([
  'apps/web/src/features/share/use-share-activity-signal.ts',
  'packages/ui/src/sync/notification-model.ts',
]);

const ARMS = [
  {
    id: 'gate-skipped',
    carrier: 'web',
    file: 'apps/web/src/features/share/use-share-activity-signal.ts',
    why: '接线时跳过同意 + 偏好闸门 ⇒ 到达什么就投什么（两半闸门一起没牙）',
    needle: `      const toSurface = selectShareActivitiesToNotify(
        loadShareNotificationPrefs(window.localStorage),
        reading.activities,
        loadShareConsent(window.localStorage),
      );
`,
    rep: `      // ${MARK}\n      const toSurface = reading.activities;\n`,
    mustInclude: ['① 有同意 + 偏好开', '② 从没同意过', '③ 同意过但偏好关', '④ 拿不到清单名'],
    expect: 4,
  },
  {
    id: 'name-from-content',
    carrier: 'web',
    file: 'apps/web/src/features/share/use-share-activity-signal.ts',
    why: '名字那一格被换成交付内容（任务标题）⇒ 正文里躺进条目文本而界面一句不报',
    needle: `      const rowId = localRowIdForShare(personal, shareId);
      const listName = rowId === undefined ? undefined : personal.projects[rowId]?.name;
`,
    rep: `      // ${MARK}
      const rowId = localRowIdForShare(personal, shareId);
      const listName = rowId === undefined ? undefined : Object.values(personal.tasks)[0]?.title;
`,
    mustInclude: ['① 有同意 + 偏好开', '🔴 ⑤ 本机状态里躺着任务标题'],
    expect: 2,
  },
  {
    id: 'consent-ignored',
    carrier: 'ui',
    file: 'packages/ui/src/sync/notification-model.ts',
    why: '模型里同意那道门被摘掉（偏好闸门照旧）⇒ 只有同意的两枚该红',
    needle: '  hasShareConsent(consent) ? selectNotifiedActivities(prefs, kinds) : [];\n',
    rep: `  // ${MARK}\n  selectNotifiedActivities(prefs, kinds);\n`,
    mustInclude: ['从没同意过', '连同意记录都没有'],
    expect: 2,
  },
  {
    id: 'no-fallback',
    carrier: 'ui',
    file: 'packages/ui/src/sync/notification-model.ts',
    why: '拿不到名字不回落到无名那句，硬拼一个空名字 ⇒ 通知说出一句没有来源的话',
    needle: "  return name === '' ? copy.anonymous(kind) : copy.named(name, kind);\n",
    rep: `  // ${MARK}\n  return copy.named(name, kind);\n`,
    mustInclude: ['名字拿不到'],
    expect: 1,
  },
];

const md5 = (s) => createHash('md5').update(s).digest('hex');
const say = (line) => process.stdout.write(`${line}\n`);
const git = (args) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).stdout ?? '';

const sh = (pkgRel, cmd) =>
  spawnSync(cmd, {
    cwd: join(ROOT, pkgRel),
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

const run = (carrier) => {
  const c = CARRIERS[carrier];
  const r = sh(c.pkg, `./node_modules/.bin/vitest run ${c.spec}`);
  return { code: r.status, parsed: parseVitest(`${r.stdout ?? ''}${r.stderr ?? ''}`) };
};

// ── 前置守卫：目标存在 + 相对 HEAD 干净（登记自持的除外）+ 每臂 needle 恰好一处 ──
const targets = [...new Set(ARMS.map((a) => a.file))];
for (const t of targets) {
  if (!existsSync(join(ROOT, t))) {
    say(`ARMS=FAIL reason=target-missing ${t}`);
    process.exit(1);
  }
  const dirty = git(['status', '--porcelain', '--', t]).trim();
  if (dirty !== '' && !OWNED.has(t)) {
    say(`ARMS=ENV dirty-worktree —— ${t} 相对 HEAD 有未提交改动且不在本装置的自持登记表里，装置不在别人的改动上动刀。\n   ${dirty}`);
    process.exit(3);
  }
  if (dirty !== '') {
    say(`GUARD ⚠️ ${t} 脏着 —— 本批实现尚未提交，该文件已在 OWNED 登记表内，照跑（提交后请清空登记表）`);
  }
}

const originals = new Map(targets.map((t) => [t, readFileSync(join(ROOT, t), 'utf8')]));
const backups = new Map(targets.map((t) => [t, `${join(ROOT, t)}.mut-bak`]));

for (const a of ARMS) {
  const hits = originals.get(a.file).split(a.needle).length - 1;
  if (hits !== 1) {
    say(`ARMS=FAIL reason=needle-hits=${String(hits)} arm=${a.id} —— 锚点必须恰好一处，否则注病灶的位置不确定`);
    process.exit(1);
  }
}
say(`GUARD ✅ ${ARMS.length} 臂的 needle 各命中 1 次，${targets.length} 枚目标文件全部在本线名下`);

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
for (const carrier of Object.keys(CARRIERS)) {
  const b = run(carrier);
  say(`BASELINE[${carrier}] RC=${String(b.code)} Tests=${b.parsed.sum ?? '?'}`);
  if (b.code !== 0 || !/^1 passed/.test(b.parsed.files ?? '')) {
    say(`ARMS=ABORT reason=baseline-not-green/${carrier}（基线红、或那份 spec 压根没跑到 ⇒ 台架自己坏了，拒绝读数）`);
    process.exit(2);
  }
}

let failures = 0;
for (const a of ARMS) {
  const abs = join(ROOT, a.file);
  writeFileSync(abs, originals.get(a.file).replace(a.needle, a.rep), 'utf8');
  const r = run(a.carrier);
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
  if (extra.length > 0) say(`      ⚠️ 额外红的用例: ${extra.map((t) => t.slice(0, 48)).join(' | ')}`);
  restoreAll();
  if (!match) failures += 1;
}

let recheckFailures = 0;
for (const carrier of Object.keys(CARRIERS)) {
  const recheck = run(carrier);
  say(`RECHECK[${carrier}] RC=${String(recheck.code)} Tests=${recheck.parsed.sum ?? '?'}`);
  if (recheck.code !== 0) recheckFailures += 1;
}
if (recheckFailures > 0) failures += 1;

say(
  `\nARMS=${failures === 0 ? 'pass' : 'FAIL'} (${String(ARMS.length - failures)}/${String(ARMS.length)})  ` +
    `载具=${Object.keys(CARRIERS).map((c) => `${c}:${CARRIERS[c].spec}`).join(' , ')}`,
);
process.exit(failures === 0 ? 0 : 1);
