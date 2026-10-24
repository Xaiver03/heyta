#!/usr/bin/env node
/**
 * 变异装置：ADR-0070「成员面信号」那四层判据能不能红
 * =====================================================
 *
 * 它不改产品行为，只回答一句质疑：`server` / `sync-client` / `app-host` / `web` 四层
 * 各自绿了，是因为**这条腿真的每一环都有人盯着**，还是因为其中某一环谁都拦不住？
 *
 * 为什么这一格值得单独一副臂：这条链的失效形状是"对面动了而我这边不动"——
 * 不报错、不红、类型全过。而它换掉的是一枚**每 3s 一次的轮询**：轮询在的时候
 * 任何一环断了都会被下一次 GET 掩盖，撤掉之后断环就是永久的。
 *
 * 七臂各钉一处断环（四个载具，逐臂各自的 spec）：
 *  1 `gate-off`        闸门放开 ⇒ 本机没有的清单也去重取（等于让服务端决定本机取什么）
 *  2 `no-tail`         尾巴不补 ⇒ 在途期间来的信号被吞掉，面板停在旧名册上
 *  3 `throw-propagates` 重取抛错抛穿 ⇒ 一次坏的重取把信号消费者整个带走
 *  4 `shared-lock`     在途锁不按 shareId 分 ⇒ 别的清单的信号被误合并掉
 *  5 `accept-dropped`  服务端接受邀请那一条不发信号 ⇒ 新人出现在谁的面板上都是问题
 *  6 `roster-ignored`  客户端不认这一类事件 ⇒ 上面全部白做（老客户端那一支是**故意**忽略的，
 *                      所以只有本仓的消费者该红，红集正好是这两枚）
 *  7 `poll-reintroduced` 把 3s 轮询装回面板 ⇒ 撤轮询这条决定被人悄悄推回去
 *
 * 口径按 `research/tools/mutation-rigs/README.md`：① 基线必须先绿且那份 spec 真跑到
 * （否则退 2）；② 每臂**红集精确匹配**（条数 + 缺席 + 多红三条都过）；③ 还原后 md5
 * 逐字节比对，最后复跑基线。
 *
 * 🔴 原地改工作树（目标文件全归本线），动手前逐枚验它相对 HEAD 干净，脏就退 **3**。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-roster-signal.mjs
 * 读数：`ARMS=pass (7/7)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');
const MARK = 'MUTATED-BY-RIG：这一处是装置注入的病灶，跑完即还原';

/** 载具：cd 到哪、跑哪份 spec。四个载具各自一条命令，互不重叠。 */
const CARRIERS = {
  appHost: { cwd: join(ROOT, 'packages/app-host'), spec: 'tests/share-roster-signals.spec.ts' },
  syncClient: { cwd: join(ROOT, 'packages/sync-client'), spec: 'tests/realtime.spec.ts' },
  server: { cwd: join(ROOT, 'server'), spec: 'tests/share-routes.spec.ts' },
  web: { cwd: join(ROOT, 'apps/web'), spec: 'tests/share-roster-signal.spec.tsx' },
};

const ARMS = [
  {
    id: 'gate-off',
    carrier: 'appHost',
    target: 'packages/app-host/src/share-roster-signals.ts',
    why: '闸门放开 ⇒ 为本机根本没有的清单出网重取',
    needle: `      if (!ports.knownShareIds().includes(shareId)) {
        return { shareId, knownLocally: false, refreshed: false, coalesced: false, failed: false };
      }
`,
    rep: `      // ${MARK}\n`,
    // 实测比预测多一枚：闸门放开后，"名单每次现取"那一臂也一起红 ——
    // 它断言的是"先不认得、绑定之后才认得"，闸门恒真时前半句就塌了。两处都是真检出。
    mustInclude: ['A 不认得', '名单是每次现取'],
    expect: 2,
  },
  {
    id: 'no-tail',
    carrier: 'appHost',
    target: 'packages/app-host/src/share-roster-signals.ts',
    why: '在途期间的信号被吞掉，事后不补 ⇒ 面板停在旧名册上',
    needle: `      if (trailing.has(shareId)) {
        trailing.delete(shareId);
        await runRefresh(shareId);
      }
`,
    rep: `      // ${MARK}\n`,
    // 实测多一枚「尾巴那一次也炸」：那一臂数的就是"在途 + 尾巴"两次调用，
    // 尾巴不补 ⇒ 它必然一起红。
    mustInclude: ['B 在途时', 'C 尾巴必须跑', '尾巴那一次也炸'],
    expect: 3,
  },
  {
    id: 'throw-propagates',
    carrier: 'appHost',
    target: 'packages/app-host/src/share-roster-signals.ts',
    why: '一次坏的重取把整条信号消费面带走（而不是只留一条读数）',
    needle: `    } catch {
      // 一次成员面重取失败不等于信号没处理过 —— 留个读数，尾巴照跑。
      failed.add(shareId);
`,
    rep: `    } catch (error) {
      // ${MARK}
      throw error;
`,
    // 实测多一枚「G 失败之后成功」：病灶把 failed 那一格也带走了（异常逃逸 ⇒ 永远记不上失败），
    // 而那一臂钉的正是"失败要留读数、且成功后如实回落"。
    mustInclude: ['D 抛穿', '尾巴那一次也炸', 'G 失败之后成功'],
    expect: 3,
  },
  {
    id: 'shared-lock',
    carrier: 'appHost',
    target: 'packages/app-host/src/share-roster-signals.ts',
    why: '在途锁不按 shareId 分 ⇒ 任何一份清单的在途都把所有清单并掉',
    needle: '      if (inFlight.has(shareId)) {\n',
    rep: `      // ${MARK}\n      if (inFlight.size > 0) {\n`,
    mustInclude: ['E 不同 shareId'],
    expect: 1,
  },
  {
    id: 'accept-dropped',
    carrier: 'server',
    target: 'server/src/shares/share.routes.ts',
    why: '接受邀请这一条不扇 ⇒ 撤掉轮询之后，owner 那台永远不会自己出现新人',
    needle: `    // 名册在这一刻真的多了一个人 —— owner 那台（以及他**另一台**设备）的面板等着这条。
    await notifyShareRoster(share.id);
`,
    rep: `    // ${MARK}\n`,
    mustInclude: ['接受邀请 ⇒ 发'],
    expect: 1,
  },
  {
    id: 'roster-ignored',
    carrier: 'syncClient',
    target: 'packages/sync-client/src/realtime.ts',
    why: '客户端不认这一类事件 ⇒ 服务端与宿主全部白做（本仓的消费者该红，老宿主那两枚不该红）',
    needle: "    if (message.type === 'share_roster_changed') {\n",
    rep: `      // ${MARK}\n      if (message.type === 'share_roster_changed__never') {\n`,
    mustInclude: ['合格的信号', '宿主回调抛错'],
    expect: 2,
  },
  {
    id: 'poll-reintroduced',
    carrier: 'web',
    target: 'apps/web/src/features/share/ShareFeature.tsx',
    why: '把 3s 轮询装回面板 ⇒ 撤轮询这个决定被悄悄推回去（运行时什么都对，只有源码形状知道）',
    needle: '    return registerShareRosterTarget(phase.shareId, async () => { await reload(phase.shareId); });\n',
    rep: `      // ${MARK}
      window.setInterval(() => { void reload(phase.shareId); }, 3000);
`,
    mustInclude: ['ShareFeature.tsx 里没有 setInterval'],
    expect: 1,
  },
];

const md5 = (s) => createHash('md5').update(s).digest('hex');
const say = (line) => process.stdout.write(`${line}\n`);
const git = (args) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).stdout ?? '';

const sh = (cwd, cmd) =>
  spawnSync(cmd, {
    cwd,
    shell: '/bin/sh',
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 1 << 28,
  });

const vitest = (carrier) => sh(CARRIERS[carrier].cwd, `./node_modules/.bin/vitest run ${CARRIERS[carrier].spec}`);

function parseVitest(out) {
  const sum = /^\s*Tests\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  const failed = Number(/(\d+) failed/.exec(sum ?? '')?.[1] ?? NaN);
  const titles = [...out.matchAll(/^\s*×\s+(.+?)\s+\d+ms\s*$/gm)].map((m) => m[1]);
  const files = /^\s*Test Files\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  return { sum, failed, titles, files };
}

const absOf = (target) => join(ROOT, target);

// ── 前置守卫：目标存在、needle 恰好一处、相对 HEAD 干净 ──────────────────────
const originals = new Map();
for (const a of ARMS) {
  const abs = absOf(a.target);
  if (!existsSync(abs)) {
    say(`ARMS=FAIL reason=target-missing ${a.target} arm=${a.id}`);
    process.exit(1);
  }
  const dirty = git(['status', '--porcelain', '--', a.target]).trim();
  if (dirty !== '') {
    say(`ARMS=ENV dirty-worktree —— ${a.target} 相对 HEAD 有未提交改动，装置不在别人的改动上动刀。\n   ${dirty}`);
    process.exit(3);
  }
  const source = readFileSync(abs, 'utf8');
  const hits = source.split(a.needle).length - 1;
  if (hits !== 1) {
    say(`ARMS=FAIL reason=needle-hits=${String(hits)} arm=${a.id} —— 锚点必须恰好一处，否则注病灶的位置不确定`);
    process.exit(1);
  }
  if (!originals.has(a.target)) originals.set(a.target, source);
}
say(`GUARD ✅ ${ARMS.length} 臂的 needle 各命中 1 次，${originals.size} 枚目标文件相对 HEAD 干净`);

const restoreAll = () => {
  for (const [target, source] of originals) {
    const abs = absOf(target);
    if (readFileSync(abs, 'utf8') === source) continue;
    writeFileSync(abs, source, 'utf8');
    if (md5(readFileSync(abs, 'utf8')) !== md5(source)) {
      say(`ARMS=FAIL reason=RESTORE=DIRTY ${target} md5=${md5(source)} -> ${md5(readFileSync(abs, 'utf8'))}`);
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

// ── 基线：四个载具各自必须先绿，且那份 spec 真跑到 ───────────────────────────
for (const carrier of Object.keys(CARRIERS)) {
  const base = vitest(carrier);
  const bp = parseVitest(`${base.stdout ?? ''}${base.stderr ?? ''}`);
  say(`BASELINE[${carrier}] RC=${String(base.status)} Tests=${bp.sum ?? '?'} TestFiles=${bp.files ?? '?'}`);
  if (base.status !== 0 || !/passed/.test(bp.files ?? '')) {
    say(`ARMS=ABORT reason=baseline-not-green/${carrier}（基线红、或那份 spec 压根没跑到 ⇒ 台架自己坏了，拒绝读数）`);
    process.exit(2);
  }
}

let failures = 0;
for (const a of ARMS) {
  const abs = absOf(a.target);
  const source = originals.get(a.target);
  writeFileSync(abs, source.replace(a.needle, a.rep), 'utf8');
  const run = vitest(a.carrier);
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const p = parseVitest(out);
  const survived = run.status === 0;
  const missing = a.mustInclude.filter((tag) => !p.titles.some((t) => t.includes(tag)));
  const extra = p.titles.filter((t) => !a.mustInclude.some((tag) => t.includes(tag)));
  const match = !survived && p.failed === a.expect && missing.length === 0 && extra.length === 0;
  say(`[${a.id}] ${a.why}\n      → RC=${String(run.status)} 红 ${String(p.failed)}/${String(a.expect)} ${
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
  const recheck = vitest(carrier);
  const rp = parseVitest(`${recheck.stdout ?? ''}${recheck.stderr ?? ''}`);
  say(`RECHECK[${carrier}] RC=${String(recheck.status)} Tests=${rp.sum ?? '?'}`);
  if (recheck.status !== 0) recheckFailures += 1;
}
if (recheckFailures > 0) failures += 1;

say(
  `\nARMS=${failures === 0 ? 'pass' : 'FAIL'} (${String(ARMS.length - (recheckFailures > 0 ? failures : failures))}/${String(ARMS.length)})  ` +
    `载具=${Object.keys(CARRIERS).join(',')}`,
);
process.exit(failures === 0 ? 0 : 1);
