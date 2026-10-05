/**
 * 助手会话跨设备实体（ADR-0045 D-4 (ii)）的**变异验证**
 * =====================================================
 *
 * 为什么需要它：这七条臂摘掉的每一样东西，症状都是"界面看起来照样对"——
 * 少写 `originClientId` 之后，跨设备的提案**照样**显示成过期（因为任何提案都不可确认）；
 * 把清除 fan-out 成 N 条 op，两台设备**照样**都清空。
 * 也就是说这些判据默认是"永远通过"的形状（AGENTS §7 元规则第 2 条），
 * 只有把它们各自打红一次，才知道它们真的在守什么。
 *
 * 用法：`node packages/app-host/tests/mutate-assistant-session.mjs`
 * 每臂用完立刻还原并**逐字节校验**；中途抛错也会在 finally 里还原。
 *
 * 🔴 读数口径：一臂只有在"预期红数命中"时才算通过。
 *    0 红 = 那条承诺没有任何一层在守（这本身就是要报的发现，不是"变异没生效"）。
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const ACTIONS = resolve(ROOT, 'packages/app-host/src/assistant-session-actions.ts');
const DOMAIN = resolve(ROOT, 'packages/domain/src/assistant-turn.ts');
const STATE = resolve(ROOT, 'packages/op-log/src/state.ts');

// ⚠️ spec 用**相对包根**的路径：`pnpm --filter <包> test -- <相对路径>` 会把它
// 原样交给 vitest 当过滤器，绝对路径在有些过滤实现下会匹配不到任何文件
// —— 那会得到一个 rc=0 / 0 红，读起来像"这条变异没生效"。
const APP_PKG = '@heyta/app-host';
const APP_SPEC = 'tests/assistant-session-actions.spec.ts';
const OPLOG_PKG = '@heyta/op-log';
const OPLOG_SPEC = 'tests/assistant-turn-convergence.spec.ts';
const DOMAIN_PKG = '@heyta/domain';
const DOMAIN_SPEC = 'tests/assistant-turn.spec.ts';

const ARMS = [
  {
    file: ACTIONS,
    pkg: APP_PKG,
    spec: APP_SPEC,
    name: 'M1 落库的消息不带「写它的那台设备」（originClientId）',
    from: '        destinationKind,\n        originClientId: localClientId,\n',
    to: '        destinationKind,\n',
    expectRed: 3,
  },
  {
    file: ACTIONS,
    pkg: APP_PKG,
    spec: APP_SPEC,
    name: 'M2 可确认性判定只留在界面，写侧不设闸',
    from: '      if (!assistantTurnIsConfirmableHere(current, localClientId)) {',
    to: '      if (false) {',
    expectRed: 1,
  },
  {
    file: ACTIONS,
    pkg: APP_PKG,
    spec: APP_SPEC,
    name: 'M3 目的地档位改成"没给就不写"（省略 = 对端永远不知道是谁答的）',
    from: '        destinationKind,\n        originClientId: localClientId,\n',
    to: '        ...(input.destinationKind === undefined ? {} : { destinationKind }),\n        originClientId: localClientId,\n',
    expectRed: 1,
  },
  {
    file: ACTIONS,
    pkg: APP_PKG,
    spec: APP_SPEC,
    name: 'M4 清除一段会话 fan-out 成 N 条 DEL（AGENTS §3.4 的反面）',
    from:
      '      await ctx.dispatch({\n' +
      "        entityType: 'ASSISTANT_TURN' as EntityType,\n" +
      '        entityId: ids[0]!,\n' +
      '        opType: OpType.Delete,\n' +
      '        entityIds: ids,\n' +
      '        payload: {},\n' +
      '      });\n',
    to:
      '      for (const id of ids) {\n' +
      '        await ctx.dispatch({\n' +
      "          entityType: 'ASSISTANT_TURN' as EntityType,\n" +
      '          entityId: id,\n' +
      '          opType: OpType.Delete,\n' +
      '          payload: {},\n' +
      '        });\n' +
      '      }\n',
    expectRed: 1,
  },
  {
    file: ACTIONS,
    pkg: APP_PKG,
    spec: APP_SPEC,
    name: 'M5 会话级实体的形状（同一段会话复用同一个 entityId）',
    from: '      const entityId = makeTurnId();',
    to: "      const entityId = `aturn-sess-${String(input.sessionId ?? 'none')}`;",
    expectRed: 4,
  },
  {
    file: DOMAIN,
    pkg: APP_PKG,
    spec: APP_SPEC,
    name: 'M6 过期写成粗规则："未确认就是过期"（本机的确认按钮一起摘掉）',
    from: '  return !assistantTurnIsConfirmableHere(turn, localClientId);',
    to: '  return true;',
    expectRed: 1,
  },
  {
    file: STATE,
    pkg: OPLOG_PKG,
    spec: OPLOG_SPEC,
    name: 'M7 新实体进了 ENTITY_TYPES 却没接物化（桶缺失 = 静默丢数据）',
    from: "  ASSISTANT_TURN: 'assistantTurns',\n",
    to: '',
    expectRed: 5,
  },
];

const files = [...new Set(ARMS.map((a) => a.file))];
// 🔴 备份目录住在系统 tmp，**不在工作树里**：仓库内的临时目录会被
// `git ls-files -co --exclude-standard` 形状的打包/对账集合当未跟踪文件收走（§7 #196 同族）。
const backupDir = mkdtempSync(join(tmpdir(), 'mutate-assistant-session-'));
const backups = new Map();
for (const [index, file] of files.entries()) {
  const copy = join(backupDir, `backup-${String(index)}`);
  copyFileSync(file, copy);
  backups.set(file, { copy, text: readFileSync(file, 'utf8') });
}

function runSpec(pkgFilter, specRelPath) {
  // 🔴 经 `pnpm --filter <包> test` 跑，**不要**直接 npx vitest：
  // 这个仓库的测试入口上挂着一枚内存闸门（并发测试会把机器推到内存不足），
  // 绕开它 = 在别人的验收跑到一半时把机器打满。
  try {
    const out = execFileSync('pnpm', ['--filter', pkgFilter, 'test', '--', specRelPath], {
      encoding: 'utf8',
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { red: 0, note: out };
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    // ⚠️ 数失败条数必须先确认输出里真解析得出（§7 #163：不带 NO_COLOR 时这里恒 0，
    // 一条"永远 0 红"的变异读数比没有读数更误导）。
    const counted = /Tests\s+(\d+) failed/.exec(out);
    if (!counted) {
      return { red: -1, note: out.split('\n').filter((l) => l.trim() !== '').slice(-10).join('\n     ') };
    }
    // 把**红的是哪几条**也带回来：只有计数会看不出"红错了地方"——
    // 摘掉一条判据却红了另一条不相干的用例，计数照样对得上，而那条承诺其实没被守住。
    const names = [
      ...new Set(
        [...out.matchAll(/^\s*FAIL\s+\S+\s+>\s+(.+?)$/gm)].map((m) => m[1].trim()),
      ),
    ];
    return { red: Number(counted[1]), note: '', names };
  }
}

let violations = 0;
try {
  for (const arm of ARMS) {
    const source = backups.get(arm.file);
    const hits = source.text.split(arm.from).length - 1;
    if (hits !== 1) {
      console.log(`❌ ${arm.name}\n     锚点命中 ${String(hits)}（必须是 1）⇒ 读数无效，先修脚本`);
      violations += 1;
      continue;
    }
    writeFileSync(arm.file, source.text.replace(arm.from, arm.to));
    const { red, note, names = [] } = runSpec(arm.pkg, arm.spec);
    if (red === -1) {
      console.log(`❌ ${arm.name}\n     无法解析失败数（判据没跑起来）：\n     ${note}`);
      violations += 1;
    } else if (red === 0) {
      console.log(`❌ ${arm.name}\n     摘掉它 **0 红** ⇒ 这条承诺没有任何一层在守`);
      violations += 1;
    } else if (red !== arm.expectRed) {
      console.log(
        `❌ ${arm.name}\n     红了 ${String(red)} 条，预期 ${String(arm.expectRed)} 条` +
          `（不符就说不清这条判据到底守的是什么）` +
          names.map((n) => `\n     - ${n}`).join(''),
      );
      violations += 1;
    } else {
      console.log(
        `✅ ${arm.name}\n     恰好 ${String(red)} 条红（与登记的预期一致）` +
          names.map((n) => `\n     - ${n}`).join(''),
      );
    }

    // 立刻还原并逐字节校验。
    const after = readFileSync(arm.file, 'utf8');
    const restored =
      after === source.text
        ? true
        : (writeFileSync(arm.file, source.text), readFileSync(arm.file, 'utf8') === source.text);
    if (!restored) {
      console.log(`❌ ${arm.file} 未能逐字节还原`);
      violations += 1;
    }
  }
} finally {
  for (const [file, { text }] of backups) writeFileSync(file, text);
  rmSync(backupDir, { recursive: true, force: true });
}

if (violations > 0) {
  console.log(`\n结论：${String(violations)} 臂读数无效 ❌`);
  process.exit(1);
}
console.log(`\n结论：${String(ARMS.length)} 臂变异全部按预期转红 ✅`);
