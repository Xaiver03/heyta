#!/usr/bin/env node
/**
 * 「选中态只有一个所有者」—— 结构性门禁
 * =====================================
 *
 * 判据出处：`docs/plans/detail-pane-alignment.md` W1，证据在
 * `docs/research/detail-pane-alignment-and-spaced-review.md` A0/A2。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么需要这一道（不是风格检查）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * "当前选中了哪一条"这件事，在本仓库**曾经有三份实现**：
 *
 * | 位置 | 原来长什么样 | 回落规则 |
 * |---|---|---|
 * | web 任务侧 | **没有**（行体不可点，`onOpenTask` 没传） | —— |
 * | web 习惯侧 | `HabitsView` 自己的 `useState` | 选中没了 → `?? rows[0]` 落第一条 |
 * | 移动任务侧 | `TasksScreen` 自己的 `useState` | 选中没了 → `find()` 得 undefined，详情层关掉 |
 * | 移动习惯侧 | `HabitsScreen` 自己的 `useState` | 同上，但**刻意不**落第一条（层级会说话） |
 *
 * 三份 = 三套回落规则。这类重复的危险不是"多写了几行"，而是**边界条件各答各的**：
 * 同一条"选中的东西被另一台设备删掉了"，在四个地方有四种表现。
 *
 * 🔴 而且这正是本仓库反复记过的那个形状的第四次：
 * **抽出一个共享实现 ≠ 重复被消除了**。收尾动作是"删掉旧的那份 + 加门禁"，
 * 不是"再写一个更好的新版本"（AGENTS.md §3.5 末尾那段教训）。没有这道门禁，
 * 下一次加详情面的人会在自己的面板里再写一个 `useState` —— 共享那份不会报错，
 * 它只是从此多一个没人读的所有者。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三条断言
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A. **宿主各有一份实例，且只有那一份**：`createSelectionStore(` 在 `各宿主的 src 目录`
 *    里恰好出现 2 次（web / mobile），且都落在 `lib/selection.ts`。
 *    🔴 扫不到 2 次**也算红** —— "把函数改名就能绿"是这类门禁最常见的死法。
 *
 * B. **宿主里不许重新长出本地选中态**：`const [detailTaskId, setX] = useState<...>(null)`
 *    这种"选中形状"的声明在 `各宿主的 src 目录` 里必须为 0。
 *    ⚠️ 判据刻意窄：只认 `detail|selected|open|active` + 实体名 + `Id` 这个组合，
 *    所以 `renamingId`（改名编辑器）、`busyId`（防连点）、`draft` 都不算 ——
 *    它们不是"当前选中了哪一条"。把范围放宽会淹死在噪音里，然后被人整片注释绕过。
 *
 * C. **词表只有一个家**：`SelectableKind` 的**定义**只许出现在 `packages/app-host`。
 *    宿主里出现一份同名的联合类型 = 第二套"哪些东西可以被选中"，
 *    新增一类时必然漏改一处，症状是那一类的选中态静默失效。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 怎么确认它能失败（不要删这一段）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 实测（一趟跑五条正臂 + 一条负向对照，跑完复原并复跑确认回到绿）：
 *
 * | 注入 | 结果 |
 * |---|---|
 * | A 把 mobile 那份实例换成 `undefined`（少接一个宿主） | 红：断言 A |
 * | B 在 `App.tsx` 注入 `const [detailTaskId] = useState<string \| null>(null)` | 红：断言 B |
 * | B2 同上但**带** setter（`const [selectedTaskId, setSelectedTaskId] = …`） | 红：断言 B |
 * | C 在宿主里 `type SelectableKind = 'task' \| 'habit'` | 红：断言 C |
 * | D 实例建在 `App.tsx` 而不是 `lib/selection` | 红：断言 A ×2（数量 + 落点） |
 * | **负向对照**：把这些字样**只写进注释** | 绿（剥注释生效，不误伤） |
 *
 * 🔴 **B 第一版是存活的**：那时 setter 被写成必需，无 setter 的
 * `const [detailTaskId] = useState(...)` 直接漏过去 —— 而"只读不写"恰恰是
 * 面板从 props 拿 id 的常见形状。判据能不能回答，只有变异臂说了算；
 * 上面 B 与 B2 两条分开留，是因为它们测的是正则的两个不同分支。
 *
 * ⚠️ 这道门禁**不拦**的形状（如实登记，别把它当成"选中态再也回不去了"）：
 * 模块级 `let selectedTaskId: string | null = null`、`useReducer` 里的选中、
 * 以及"多选取中"（`selectedIds` 复数 —— 那是筛选范围，不是"当前看哪一条"）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');

/** 只扫这两个宿主（它们才有"详情面/详情层"）。node-host 是 CLI，没有选中态。 */
const HOSTS = ['apps/web', 'apps/mobile'];

/** 断言 A 要求的最小出现次数：每个宿主恰好一份实例。 */
const REQUIRED_STORE_INSTANCES = HOSTS.length;

const SELECTION_NAME = /^(?:detail|selected|open|active)(?:Task|Habit|Note|Project|Tag|Event)Id$/;

/**
 * A 认的"实例化"：**赋值左边**才算。
 * ⚠️ 只写 `createSelectionStore(` 会撞上多行 import 里那一行
 * （`createSelectionStore,` 没有左括号，但注释里那句"别处再 createSelectionStore()"有），
 * 于是接线全对的项目报红 —— 判据一旦恒红，它活不过下一轮。
 */
const STORE_INSTANTIATION =
  /(?:const|let|var)\s+[A-Za-z0-9_$]+\s*(?::\s*[\w.<>\[\]| ]+)?\s*=\s*createSelectionStore\s*\(/;

/**
 * B 认的声明形状：`const [x] = useState(...)` 与 `const [x, setX] = useState(...)` **都算**。
 *
 * 🔴 setter 是**可选**的。第一版把它写成必需，注入 `const [detailTaskId] = useState<...>(null)`
 * 时门禁**当场存活** —— 而"只读不写"的正是一个面板从 props 拿 id、自己不再往下传的
 * 常见形状，恰好是最该被拦的那一种。判据能红只靠变异臂回答，不靠看起来对。
 */
const LOCAL_STATE_DECL =
  /const\s*\[\s*([A-Za-z0-9_$]+)\s*(?:,\s*set[A-Za-z0-9_$]+\s*)?\]\s*=\s*useState\s*(?:<[^>]*>)?\s*\(/g;

/** C 认的"第二个词表定义"：只有**带 `=` 的定义**才算。
    ⚠️ 不带 `=` 的那行是 `import { type SelectableKind, ... }` —— 它是**转发**，
    不是第二个定义。少写这个等号，门禁会在接线正确的项目上恒红，
    然后被人加一行 `// eslint-disable` 绕过（本仓库记过的那种死法）。 */
const KIND_DEFINITION = /(?:^|\s)(?:export\s+)?type\s+SelectableKind\s*=/;

/**
 * 先把注释剥掉再匹配。
 *
 * 🔴 这不是可选的整洁：本仓库的门禁吃过两次"注释里的字样被当成代码"的亏 ——
 * 症状是**接线全对的项目报红**，而下一个人为了跑下去会去改判据而不是改注释。
 * 剥块注释 + 剥整行注释（`// ...`、`* ...`、`/* ...`），保留行号（换行符不删），
 * 这样报告出来的 `文件:行` 仍然指得到人写的那一行。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*(?:\/\/|\*|\/\*)/.test(line) ? line.replace(/\S/g, ' ') : line))
    .join('\n');
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'build' || entry.startsWith('.')) continue;
    const abs = path.join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walk(abs));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(abs);
  }
  return out;
}

const files = [];
for (const host of HOSTS) {
  const src = path.join(ROOT, host, 'src');
  if (!statSync(src, { throwIfNoEntry: false })) {
    console.error(`✗ 宿主的源码目录不存在：${host}/src —— 这道门禁的锚点没了，判红而不是跳过`);
    process.exit(1);
  }
  files.push(...walk(src));
}

const instances = [];
const localSelection = [];
const localKindDefs = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    if (STORE_INSTANTIATION.test(line)) {
      instances.push(`${rel}:${i + 1}`);
    }
    LOCAL_STATE_DECL.lastIndex = 0;
    let m;
    while ((m = LOCAL_STATE_DECL.exec(line)) !== null) {
      if (SELECTION_NAME.test(m[1])) localSelection.push(`${rel}:${i + 1}  ${m[1]}`);
    }
    if (KIND_DEFINITION.test(line)) {
      localKindDefs.push(`${rel}:${i + 1}`);
    }
  });
}

const failures = [];

// A：数量要对，而且必须落在各宿主的 lib/selection.* 里。
if (instances.length !== REQUIRED_STORE_INSTANCES) {
  failures.push(
    `断言 A：选中态实例应有 ${REQUIRED_STORE_INSTANCES} 份（每宿主一份），实际 ${instances.length} 份：\n` +
      `  ${instances.join('\n  ') || '（一处都没扫到 —— 那不是"干净"，是接线没了）'}`,
  );
}
for (const at of instances) {
  if (!/\/lib\/selection\.(ts|tsx):\d+$/.test(at)) {
    failures.push(`断言 A：选中态实例应建在各宿主的 lib/selection 里，实际在 ${at}`);
  }
}

// B：宿主里不许重新长出本地选中态。
if (localSelection.length > 0) {
  failures.push(
    `断言 B：宿主里出现了本地选中态（应有 0 处）。它和 @heyta/app-host 的 selection 是两份所有者，\n` +
      `  同一句"选中的实体没了怎么办"会被再答一遍：\n  ${localSelection.join('\n  ')}`,
  );
}

// C：词表只能在 packages/app-host 定义。
if (localKindDefs.length > 0) {
  failures.push(
    `断言 C：宿主里重新定义了 SelectableKind（词表只有一个家）：\n  ${localKindDefs.join('\n  ')}`,
  );
}

if (failures.length > 0) {
  console.error('✗ 选中态的所有者不唯一：\n');
  for (const f of failures) console.error(f + '\n');
  console.error('  改法：读 `@heyta/app-host` 的 `selection.ts`，宿主只留 lib/selection 那一层胶水。');
  process.exit(1);
}

console.log(
  `✅ 选中态只有一个所有者：${REQUIRED_STORE_INSTANCES} 份实例（${HOSTS.join(', ')}）` +
    `，宿主内本地选中态 0 处，词表定义 0 处`,
);
