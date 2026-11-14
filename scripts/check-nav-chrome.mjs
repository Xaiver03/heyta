#!/usr/bin/env node
/**
 * check:nav-chrome —— 分页体系的顶栏判据
 * =====================================
 *
 * ## 为什么
 *
 * 2026-11-15 实测 29 个归档界面，顶栏有三种形态：
 *
 * | 模式 | 屏数 |
 * |---|---|
 * | 只有 `←` | 12 |
 * | `←` + `×` | 7 |
 * | 都没有 | 9 |
 *
 * 硬伤：**同样是二级页，一半有 `×`、一半没有**。
 * 「设置 → 提醒与通知」退到主界面按一次 `×`；
 * 「设置 → 功能与 AI → 习惯」要连按三次返回。**两条路径成本差三倍。**
 *
 * 另一处：页面标题 y 有三种（162 / 180 / 198）。
 *
 * ## 规则
 *
 * | 层级 | 顶栏 |
 * |---|---|
 * | 根页（底部 tab 那五屏） | `标题`，**不得有 `←` 或 `×`** |
 * | 二级页 | `← 标题` |
 * | Modal 内的二级页 | `← 标题 ×` |
 *
 * ## 判据（这一版只判能机械化判的两条）
 *
 * ① **根页不得出现 `action.back` / `action.close`** —— 根页没有"上一级"。
 * ② **非根页的 `Screen` 必须有 `action.back`** —— 二级页必须能退回。
 *
 * 🔴 `×` 的判据（"在不在 Modal 栈里"）这一版**没做**：它需要分析导航栈，
 * 静态扫不出来。硬判会误报，误报的尺会被关掉。文档里写明它是人工判据。
 *
 * ## 自测
 *
 * `--self-test` 造两种违规样本，断言都能红。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 根页：底部 tab 的那五个。它们的 `Screen` 不该有返回/关闭。
 *
 * 这份名单是**枚举**而不是猜 —— 底部 tab 有几个是产品决定，
 * 多一个少一个都要改这里，那正是我们要的"改的时候有人看得见"。
 */
const ROOT_SCREENS = new Set([
  'apps/mobile/src/screens/TasksScreen.tsx',
  'apps/mobile/src/screens/CalendarScreen.tsx',
  'apps/mobile/src/screens/FocusScreen.tsx',
  'apps/mobile/src/screens/StatsScreen.tsx',
  // key 叫 `categories`、底栏显示「统计」的，就是这一屏。
  'apps/mobile/src/screens/CategoriesScreen.tsx',
  /*
   * ⚠️ `ProfileScreen` **不在名单里**：同一个文件里既有根页（底部 tab 那一屏）
   * 又有 feature 子页（成长 / 习惯 / 倒数日…的 `case` 分支），静态扫不出哪一个是根页。
   * 硬判会把子页的 `action.back` 报成违规。
   * 它的根页形态由人工判据看着（文档 §一 的表），不交给这条尺。
   */
]);

/** 不参与判据的路径：营销页的假界面、共享层的同名组件。 */
const SKIP = [/^apps\/landing\//, /^packages\/ui\/src\/task-list\//];

/**
 * 剥掉注释再扫。
 *
 * 🔴 2026-11-15 踩到：我在 `ListsSection` 的注释里写了"这一屏的顶栏已经写着
 * 「清单」（`<Screen title=…>`）"作为解释，门禁把这段**注释**当成了真的标签，
 * 报"二级页没有 action.back"。
 *
 * 扫源码的尺必须先剥注释 —— 否则任何在注释里举例的人都会撞上它。
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function collect() {
  const out = [];
  const visit = (d) => {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      const p = join(d, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) visit(p);
      else if (name.endsWith('.tsx')) out.push(p);
    }
  };
  visit('apps');
  visit('packages');
  return out;
}

/** 抽每个 `<Screen ...>...</Screen>` 开标签（跨行）。 */
export function findScreenTags(source) {
  const tags = [];
  const re = /<Screen\b/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    let i = m.index;
    let depth = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) break;
      i += 1;
    }
    tags.push(source.slice(m.index, i + 1));
  }
  return tags;
}

/**
 * 把 `<Screen {...header}>` 里的 `header` 展开成它的对象字面量。
 *
 * 🔴 不加这一层会误报：`CountdownScreen` 的三处 `<Screen {...header}>` 的
 * `header` 里明明有 `action.back`，但扫的是开标签字面量，扫不到。
 * **误报的尺会被下一个人关掉** —— 这条展开是为了让它别误报，不是放宽。
 */
function expandSpreads(tag, source) {
  let expanded = tag;
  /*
   * 两种"动作被变量带走"的写法都要展开，否则会误报：
   *   ① `<Screen {...header}>`            —— spread 一个对象
   *   ② `actions={[backAction]}`          —— 数组里放一个变量
   * ② 是 `ShareSpaceScreen` 撞出来的：它明明有返回，但门禁只认字面量 `action.back`。
   * **误报的尺会被下一个人关掉。**
   */
  const names = new Set();
  for (const m of tag.matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of tag.matchAll(/actions=\{\[([^\]]*)\]\}/g)) {
    for (const id of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) names.add(id[1]);
  }
  for (const name of names) {
    const def = source.match(new RegExp(`const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\n  \\};`));
    if (def) expanded += ` ${def[1]}`;
  }
  return expanded;
}

export function findViolations({ rel, source }) {
  const out = [];
  const rawTags = findScreenTags(source);
  const tags = rawTags.map((tag) => expandSpreads(tag, source));
  if (tags.length === 0) return out;

  /*
   * 根页判定两种：
   *   ① 整个文件都是根页（`ROOT_SCREENS`）；
   *   ② 文件里**混着**根页与子页（`ProfileScreen` 的 feature 路由）——
   *      那种按 title 认：`mobile.profile.title` 那一处是根页「我的」。
   */
  const isMixedRoot = rel === 'apps/mobile/src/screens/ProfileScreen.tsx';
  for (const [i, tag] of tags.entries()) {
    const isRoot =
      ROOT_SCREENS.has(rel) ||
      (isMixedRoot && rawTags[i] !== undefined && rawTags[i].includes('mobile.profile.title'));
    const hasBack = tag.includes('action.back');
    const hasClose = tag.includes('action.close');
    const compact = tag.replace(/\s+/g, ' ').slice(0, 80);

    if (isRoot) {
      // 根页没有"上一级"
      if (hasBack) out.push(`${rel}: 根页出现了 action.back —— 根页没有上一级。${compact}`);
      if (hasClose) out.push(`${rel}: 根页出现了 action.close —— 根页不需要关闭。${compact}`);
    } else if (!hasBack) {
      out.push(`${rel}: 非根页的 Screen 没有 action.back —— 二级页必须能退回。${compact}`);
    }
  }
  return out;
}

function main() {
  const selfTest = process.argv.includes('--self-test');

  if (selfTest) {
    // 违规 A：根页带返回
    const a = findViolations({
      rel: 'apps/mobile/src/screens/TasksScreen.tsx',
      source: `<Screen title="任务" actions={[{ icon: 'action.back', label: 'x', onPress: () => {} }]}>`,
    });
    if (a.length === 0) {
      console.error('🔴 self-test A 失败：根页带 action.back 没被报红');
      process.exit(1);
    }
    // 违规 B：非根页没有返回
    const b = findViolations({
      rel: 'apps/mobile/src/screens/HabitsScreen.tsx',
      source: `<Screen title="习惯">`,
    });
    if (b.length === 0) {
      console.error('🔴 self-test B 失败：非根页缺 action.back 没被报红');
      process.exit(1);
    }
    // 合规：非根页带返回
    const c = findViolations({
      rel: 'apps/mobile/src/screens/HabitsScreen.tsx',
      source: `<Screen title="习惯" actions={[{ icon: 'action.back', label: 'x', onPress: () => {} }]}>`,
    });
    if (c.length !== 0) {
      console.error('🔴 self-test C 失败：合规样本被误报');
      process.exit(1);
    }
    console.log('✅ self-test：根页带返回、二级页缺返回都判红；合规放行（3 臂）');
    return;
  }

  const problems = [];
  for (const f of collect()) {
    const rel = f.replace(/^\.\//, '');
    if (SKIP.some((re) => re.test(rel))) continue;
    problems.push(...findViolations({ rel, source: stripComments(readFileSync(f, 'utf8')) }));
  }

  if (problems.length === 0) {
    console.log(`✅ 顶栏：根页无返回关闭、${ROOT_SCREENS.size} 个根页以外的 Screen 都有返回。`);
    return;
  }

  console.error(`🔴 顶栏：${problems.length} 处`);
  for (const p of problems) console.error(`  · ${p}`);
  console.error('');
  console.error('  规则见 docs/agents/design-体系-分页配速配色.md §一。');
  console.error('  根页 = 底部 tab 那五屏；其余每一屏都必须能退回上一级。');
  process.exit(1);
}

main();
