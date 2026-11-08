#!/usr/bin/env node
/**
 * 门禁：全局层只许放镜像，不许发明新动作（P10 §7 R3）
 * ==================================================
 *
 * ## 规则一句话
 *
 * 托盘项 / 全局热键 / 应用菜单项引用的动作，**必须**同时能在应用内某处找到它的
 * "归属地"（视图层或对象层的入口）。否则红 —— 那说明这个动作**只能从全局层到达**，
 * 它在产品里没有家。
 *
 * ## 为什么必须由脚本判
 *
 * 往回装一个托盘项是**几行代码、零测试、零报错**的事，而它的症状要等到
 * "托盘里有个我看不懂的项"或者"这个功能在应用里怎么找都找不到"才出现。
 * 更要紧的是反过来的那半：**只要允许全局层发明动作，全局层就会慢慢变成一个
 * 没人敢删的垃圾场**（滴答 29 个业务菜单项能成立的前提，就是它有这条纪律）。
 *
 * ## 判据（三条）
 *
 * | # | 判据 | 它抓什么 |
 * |---|---|---|
 * | R1 | 源码里每个全局动作**都**有归属（`MIRRORS` 或 `EXCEPTIONS` 里各一行） | 往托盘加第 5 项而不登记 ⇒ 红 |
 * | R2 | `MIRRORS` 每一条的**锚点必须仍在**那个文件里 | 应用内入口被删/改名后，"有归属"这句话就变成永久的假话 |
 * | R3 | 表里不许有**过期的行**（源码里已经不存在那个动作了） | 托盘项删了、表里还留着 ⇒ 表开始腐 |
 *
 * ## 为什么动作清单从源码里**解析**，而不是抄在脚本里
 *
 * 抄一份 `['today','quickAdd','showMainWindow','quit']` 进脚本，就等于给"托盘有几项"
 * 造了第二个事实源 —— 加一项时改源码不改脚本，门禁全绿而它已经瞎了。
 * 所以这里用正则从 `summon-commands.ts` 的 `TRAY_TARGETS` / `SUMMON_TARGETS`
 * 两个 `Record` 字面量里把动作名抽出来；抽不到就**红**（正则失效要吵，不能静默空跑）。
 *
 * ## 已知射程
 *
 * · 只覆盖桌面壳的托盘 + 全局热键（`apps/desktop/src/summon-commands.ts`）。
 *   应用菜单模板若将来另立一张表，需要把它也加进 `parseGlobalTargets()` ——
 *   加的时候**必须**同时加一条自检臂，否则它是一段没人验证的代码。
 *
 * ```
 * node scripts/check-global-mirror.mjs              # 判一次
 * node scripts/check-global-mirror.mjs --self-test  # 自检
 * ```
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.HEYTA_CHECK_ROOT ?? process.cwd();

/** 全局动作表的唯一来源。 */
const COMMANDS_FILE = 'apps/desktop/src/summon-commands.ts';

/**
 * 全局动作 → 它在应用内的**归属地**（视图层或对象层的一个可见入口）。
 *
 * ⚠️ 锚点必须是源码里的**字面量**，且写窄一点 —— 宽到 `today` 这种词会到处命中，
 * 那条"锚点还在"就变成了永远成立的空话。
 */
const MIRRORS = [
  {
    target: 'showToday',
    file: 'apps/web/src/features/shell/view-tabs.ts',
    anchor: "filter: { kind: 'today' }",
    why: '侧栏「今天」这一格就是它的归属地：托盘只是同一件事的第二条路',
  },
  {
    target: 'openQuickAdd',
    file: 'apps/web/src/App.tsx',
    anchor: '<CaptureComposer destination=',
    why: '快速添加在应用内的落点是顶栏 composer；托盘/热键都指向同一个入口',
  },
];

/**
 * 允许"全局层即归属地"的动作 —— **只有一类**：窗口与进程生命周期。
 *
 * 它们不是任务语义里的动作，用户对它们的预期就是"系统级"：
 * 关窗、切前台、退出，这四件事在任何应用里都不从任务列表里进去。
 * 🔴 这一档**不许扩容到业务动作**：一旦"清空回收站"能进来，这条规则就废了。
 */
const EXCEPTIONS = [
  {
    target: 'quit',
    why: 'J4 例外：退出是进程生命周期，归属地就是窗口/系统菜单本身，不在任务语义里',
  },
  {
    target: 'showMainWindow',
    why: 'J4 例外：把窗口调出来是 OS 级窗口管理，Dock / Alt-Tab / 点 Dock 图标都是它的入口',
  },
  {
    target: 'toggleMainWindow',
    why: 'J4 例外：同上，显示/隐藏主窗是窗口可见性，不是任务动作',
  },
];

/* ─────────────────────────────── 解析 ─────────────────────────────── */

/**
 * 从 `summon-commands.ts` 里抽出全部全局动作名。
 *
 * 认的形状：`Record<..., keyof SummonTargetNames> = { ... 'name', ... }`。
 * 只在 `TRAY_TARGETS` / `SUMMON_TARGETS` 两个块里抽，取每个 `: '<ident>'` 的值。
 */
function parseGlobalTargets(source) {
  const names = new Set();
  const blocks = source.split(/export const (?:TRAY_TARGETS|SUMMON_TARGETS)\b/).slice(1);
  if (blocks.length === 0) {
    return { names, problem: '在 summon-commands.ts 里找不到 TRAY_TARGETS / SUMMON_TARGETS 两张表' };
  }
  for (const chunk of blocks) {
    // 只取到下一个顶层 `};` 为止，避免把后面整个文件都扫进来。
    const body = chunk.split(/^\};/m)[0] ?? chunk;
    for (const m of body.matchAll(/:\s*'([A-Za-z_$][\w$]*)'/g)) {
      names.add(m[1]);
    }
  }
  if (names.size === 0) {
    return { names, problem: '两张表解析出来了，但一个动作名都没抽到（正则失效了）' };
  }
  return { names, problem: undefined };
}

/**
 * 🔴 **判据只有这一份实现**，主扫描与自检共用。
 *
 * @param files `{ 相对路径 → 内容 }`；自检喂假数据，主扫描喂真文件。
 * @param targets 全局动作名集合（同样由调用方给，自检可以给小集合）。
 */
function judge(files, targets) {
  const errors = [];

  const mirrorByTarget = new Map(MIRRORS.map((m) => [m.target, m]));
  const exceptionByTarget = new Map(EXCEPTIONS.map((e) => [e.target, e]));

  // R1：每个全局动作都要有归属，且**只能有一种**（镜像或例外，不能两边都登记）
  for (const target of targets) {
    const inMirror = mirrorByTarget.has(target);
    const inException = exceptionByTarget.has(target);
    if (inMirror && inException) {
      errors.push({
        rule: 'R1',
        message: `全局动作 ${target} 同时登记进了 MIRRORS 与 EXCEPTIONS —— 必须二选一`,
      });
    } else if (!inMirror && !inException) {
      errors.push({
        rule: 'R1',
        message:
          `全局动作 ${target} 没有归属：它只能从托盘/热键到达，应用里找不到入口。` +
          '要么给它一个应用内入口并登记进 MIRRORS，要么说明它属于窗口/进程生命周期（EXCEPTIONS）',
      });
    }
  }

  // R2：镜像的锚点必须仍在（否则"有归属"是一句假话）
  for (const m of MIRRORS) {
    const content = files.get(m.file);
    if (content === undefined) {
      errors.push({ rule: 'R2', message: `镜像 ${m.target} 指向的文件不存在：${m.file}` });
    } else if (!content.includes(m.anchor)) {
      errors.push({
        rule: 'R2',
        message: `镜像 ${m.target} 的锚点已不在 ${m.file} 里：\`${m.anchor}\` —— 应用内入口被删或改名了`,
      });
    }
  }

  // R3：表里不许有过期的行
  for (const m of MIRRORS) {
    if (!targets.has(m.target)) {
      errors.push({
        rule: 'R3',
        message: `MIRRORS 里 ${m.target} 这一行过期了：源码里已经没有这个全局动作 —— 删掉它`,
      });
    }
  }
  for (const e of EXCEPTIONS) {
    if (!targets.has(e.target)) {
      errors.push({
        rule: 'R3',
        message: `EXCEPTIONS 里 ${e.target} 这一行过期了：源码里已经没有这个全局动作 —— 删掉它`,
      });
    }
  }

  return { errors };
}

/* ─────────────────────────────── 自检 ─────────────────────────────── */

function selfTest() {
  /** 基线：两张表齐全，镜像锚点都在，例外覆盖窗口类动作。 */
  const baseFiles = () => {
    const files = new Map();
    for (const m of MIRRORS) files.set(m.file, `…\n  ${m.anchor}\n…\n`);
    return files;
  };
  const baseTargets = () => new Set([...MIRRORS.map((m) => m.target), ...EXCEPTIONS.map((e) => e.target)]);

  const arms = [];
  const run = (mutateFiles, mutateTargets) => {
    const files = baseFiles();
    const targets = baseTargets();
    if (mutateFiles) mutateFiles(files);
    if (mutateTargets) mutateTargets(targets);
    return judge(files, targets);
  };

  // 臂 1：托盘新增一项、没登记 ⇒ R1 红（这条规则存在的理由）
  arms.push({
    name: '臂 1 全局层发明新动作（托盘加"清空回收站"）',
    rule: 'R1',
    detail: (() => {
      const { errors } = run(null, (t) => t.add('emptyTrash'));
      return errors.some((e) => e.rule === 'R1') ? '' : '没有红在 R1';
    })(),
  });

  // 臂 2：镜像锚点消失 ⇒ R2 红
  arms.push({
    name: '臂 2 应用内入口被删（composer 那行没了）',
    rule: 'R2',
    detail: (() => {
      const { errors } = run((f) => {
        const m = MIRRORS.find((x) => x.target === 'openQuickAdd');
        f.set(m.file, '// <CaptureComposer 被删了\n');
      });
      return errors.some((e) => e.rule === 'R2') ? '' : '没有红在 R2';
    })(),
  });

  // 臂 3：过期行 ⇒ R3 红
  arms.push({
    name: '臂 3 表里留着已删除的全局动作（R3 腐化）',
    rule: 'R3',
    detail: (() => {
      const { errors } = run(null, (t) => t.delete('showToday'));
      return errors.some((e) => e.rule === 'R3') ? '' : '没有红在 R3';
    })(),
  });

  // 臂 4：同一动作两边都登记 ⇒ R1 红（"我又给入口又给例外"是含糊的）
  arms.push({
    name: '臂 4 同一动作既在 MIRRORS 又在 EXCEPTIONS',
    rule: 'R1',
    detail: (() => {
      const exception = EXCEPTIONS[0];
      const mirror = MIRRORS[0];
      // 临时把 exception 的目标改成 mirror 的目标来构造冲突
      const saved = exception.target;
      exception.target = mirror.target;
      try {
        const { errors } = run();
        return errors.some((e) => e.rule === 'R1') ? '' : '没有红在 R1';
      } finally {
        exception.target = saved;
      }
    })(),
  });

  // 臂 5：阳性对照 —— 干净形状必须全绿
  arms.push({
    name: '臂 5 阳性对照（干净形状全绿）',
    rule: '—',
    detail: (() => {
      const { errors } = run();
      return errors.length === 0 ? '' : `应为绿但红了 ${String(errors.length)} 处`;
    })(),
  });

  console.log('\n【自检】4 条臂 + 1 条阳性对照\n');
  let bad = 0;
  for (const a of arms) {
    if (a.detail === '') {
      console.log(`  ✅ ${a.name} → 按预期${a.rule === '—' ? '全绿' : `红在 ${a.rule}`}`);
    } else {
      bad += 1;
      console.log(`  ❌ ${a.name} → ${a.detail}`);
    }
  }
  if (bad > 0) {
    console.error(`\n❌ 自检失败：${String(bad)} 条臂没按预期。**形状门禁失效比没有门禁更糟** —— 先修门禁。`);
    process.exitCode = 1;
    return;
  }
  console.log('\n✅ 自检通过：每条臂都真的能红，且干净形状全绿。\n');
}

/* ─────────────────────────────── 入口 ─────────────────────────────── */

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const commandsPath = join(ROOT, COMMANDS_FILE);
  let source;
  try {
    source = readFileSync(commandsPath, 'utf8');
  } catch {
    console.error(`\n❌ 读不到全局命令表：${COMMANDS_FILE}`);
    process.exitCode = 1;
    process.exit();
  }

  const { names, problem } = parseGlobalTargets(source);
  if (problem !== undefined) {
    console.error(`\n❌ 解析失败：${problem}`);
    console.error('   —— 解析不到就等于门禁瞎了，所以这里必须红。');
    process.exitCode = 1;
  } else {
    const files = new Map();
    for (const f of new Set([...MIRRORS.map((m) => m.file)])) {
      try {
        files.set(f, readFileSync(join(ROOT, f), 'utf8'));
      } catch {
        /* 缺文件由 R2 报 */
      }
    }
    const { errors } = judge(files, names);
    console.log(`  · 全局动作 ${String(names.size)} 个：${[...names].sort().join(', ')}`);
    console.log(`  · 镜像 ${String(MIRRORS.length)} · 例外 ${String(EXCEPTIONS.length)}（窗口/进程生命周期）`);
    if (errors.length > 0) {
      console.error(`\n❌ 全局层只许放镜像（P10 §7 R3）：${String(errors.length)} 处不通过\n`);
      for (const e of errors) console.error(`  [${e.rule}] ${e.message}\n`);
      process.exitCode = 1;
    } else {
      console.log('\n✅ 每个全局动作都有归属地；镜像锚点都在；表里没有过期的行。');
    }
  }
}
