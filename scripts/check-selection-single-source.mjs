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
 * 五条断言
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A. **宿主各有一份实例，且只有那一份**：`createSelectionStore(` 在 `各宿主的 src 目录`
 *    里恰好出现 2 次（web / mobile），且都落在 `lib/selection.ts`。
 *    🔴 扫不到 2 次**也算红** —— "把函数改名就能绿"是这类门禁最常见的死法。
 *
 * B. **宿主里不许重新长出本地选中态**：`const [detailTaskId, setX] = useState<...>(null)`
 *    这种"选中形状"的声明在 `各宿主的 src 目录` 里必须为 0。
 *    ⚠️ 判据刻意窄：认 `detail|selected|open|active|edit(ing)` + 实体名 + `Id`，
 *    以及**不带实体名**的 `detailId` / `selectedId` / `editingId`（见下面 `SELECTION_NAME`
 *    那段：为什么 `activeId` 与裸 `editingId` 的两种既有写法不能被扫进来），
 *    所以 `renamingId`（改名编辑器）、`busyId`（防连点）、`draft` 都不算 ——
 *    它们不是"当前选中了哪一条"。把范围放宽会淹死在噪音里，然后被人整片注释绕过。
 *    🔴 `edit(ing)` 与"裸名"两个分支都是 2026-10-03 被**变异臂**逼出来的：
 *    `NotesSection.editingId` 与 `TasksScreen.editingNoteId` 是同一个问题
 *    （"现在在编辑哪条便签"）的两份本地状态，旧正则一个都不认；
 *    把 web 便签改回裸名 `useState` 的那条臂**第一次跑时活着**，才有第二个分支。
 *
 * C. **词表只有一个家**：`SelectableKind` 的**定义**只许出现在 `packages/app-host`。
 *    宿主里出现一份同名的联合类型 = 第二套"哪些东西可以被选中"，
 *    新增一类时必然漏改一处，症状是那一类的选中态静默失效。
 *
 * D. **词表里每一类都得有宿主真的选中过它**：逐类扫 `select('kind'` / `useSelected('kind'`，
 *    零消费者的那一类判红。词表从 `selection.ts` 的**数组字面量**现读（不抄清单）。
 *    🔴 这一条防的是"槽位建了、界面上没有这个功能"：`SelectableKind` 里曾写着
 *    `project | tag | event`，`pruneSelection` 的谓词也照着写了 project/tag，
 *    而**没有任何一处界面会选中一条清单或标签** —— 于是"支持六类"读起来像已完成，
 *    实际只有三类活着。加一类之前先让某个宿主选中它。
 *
 * E. **接线不许断在中转层**：任何**声明**了 `readonly activeTaskId?` / `readonly onOpenTask?`
 *    的文件，必须在同一文件里把它**用起来** —— 三选一：当 JSX 属性传下去（`NAME={`）、
 *    调用它（`NAME(` / `NAME?.(`）、或读它（`NAME ===` / `!==`，即自己就是终点）。
 *    扫描范围比 A–D **多一层**：两个宿主的 `src` 加上 `packages/ui/src`，
 *    因为断点恰恰出现在中间那层。
 *
 * 🔴 这条不是预防性的，是 2026-10-03 现场补的：`apps/web/src/features/quadrant/QuadrantBoard.tsx`
 * 把 `onOpenTask` 与 `activeTaskId` 两个 prop 都声明了、也都解构了，**唯独没往
 * `<SharedQuadrantBoard>` 传**。于是"任务的三种投影接同一个选中"实际只有两种接上，
 * 而当时 A/B/C/D 四条全绿、`pnpm -r typecheck` 全绿（两个 prop 都是**可选**的），
 * 界面只是"四象限不跟随选中" —— 没有任何一层会失败。
 * **可选 prop 会把"宿主没接"伪装成"做完了"**，这是本仓库共享层惯用法自带的盲区，
 * 只有把声明与使用放在同一个文件里比一次才拦得住。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 怎么确认它能失败（不要删这一段）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 实测（2026-10-03 两趟 rig：正臂 + 负向对照 + 分母自检，每臂跑完复原并复跑确认回到绿；
 * 终态 Z2 = web / mobile / 本门禁三处 RC=0）。**下面每一行都是跑过的**，不是设想：
 *
 * | 注入 | 结果 |
 * |---|---|
 * | A 把 mobile 那份实例换成 `undefined`（少接一个宿主） | 红：断言 A |
 * | B 在 `App.tsx` 注入 `const [detailTaskId] = useState<string \| null>(null)` | 红：断言 B |
 * | B2 同上但**带** setter（`const [selectedTaskId, setSelectedTaskId] = …`） | 红：断言 B |
 * | B3 `const [editingNoteId] = useState<string \| null>(null)` | 红：断言 B（`edit(ing)` 分支） |
 * | **H1** 把 web 便签的 `useSelected('note')` 换回**裸名** `const [editingId] = useState(…)` | 🔴 **第一次跑存活**（裸名当时不在判据里）→ 补第二个分支后重跑：**红：断言 B** |
 * | **H2** 注入裸名 `const [selectedId] = useState<string \| null>(null)` | 红：断言 B（第二个分支的另一形状） |
 * | C 在宿主里 `type SelectableKind = 'task' \| 'habit'` | 红：断言 C |
 * | A2 实例建在 `App.tsx` 而不是 `lib/selection` | 红：断言 A ×2（数量 + 落点） |
 * | D 往词表数组里加一项 `'widget'`（宿主里没有） | 红：断言 D |
 * | E 删掉 web 四象限那两行 `onOpenTask={…}` / `activeTaskId={…}`（**现场那次事故**） | 红：断言 E（一段里点名两行）+ 四象限真 DOM 判据 2 条 |
 * | E2 同上但**只删** `activeTaskId` 那一行 | 红：断言 E 一行（逐 prop 判，不是"整文件没用才算"） |
 * | E3 把 `WIRE_DIRS` 清空（扫描层没了） | 红：断言 E 的**分母自检** —— "没有断线"与"没在线可断"是两件事 |
 * | **负向对照 N1**：把这些字样**只写进注释** | 绿（剥注释生效，不误伤） |
 * | **负向对照 N2**：树上本来就活着 `const [activeId] = useState(…)`（dnd-kit 正在拖）与改名编辑器的 `editingRowId` | 绿（第二条不在 `WIRE_PROPS`，第一条不在裸名分支的词表里） |
 *
 * 与本门禁**同一批**跑的行为臂（红的是判据而不是门禁，记在这里因为它们是同一条接线）：
 * TaskList 的 `{ active: activeTaskId === row.id }` → `false` ⇒ 列表与四象限底色各红 1 条；
 * TimelineBoard 两处 `activeTaskId === row.taskId ? […rowActive] : …` 各摘一次 ⇒ 时间线底色红；
 * TimelineBoard 两处 `onPress` 一起摘 ⇒ 时间线"点一行通知宿主"红；
 * NotesView 退回裸名 `useState` ⇒ 便签三条行为判据**全红**；
 * `App.tsx` 的 `selection.select('note', noteId)` 摘掉 ⇒ 搜索入口那条红；
 * `App.tsx` 四处投影里断掉一处 ⇒ A 组计数红（这条正是"期望值跟着覆盖面走"的牙）；
 * NotesSection 摘掉 `pruneSelectionAgainst` ⇒ mobile 回落那条红；
 * TasksScreen 三处 `activeTaskId={detailTaskId}` 全摘 ⇒ mobile 组 5 计数红。
 *
 * 🔴 **B 第一版是存活的**：那时 setter 被写成必需，无 setter 的
 * `const [detailTaskId] = useState(...)` 直接漏过去。**H1 是同一个死的第二次**：
 * `edit(ing)` 分支补上了**带实体名**的形状，裸名 `editingId` 仍然漏 ——
 * 我是靠把真代码改回去那条臂发现的，不是靠读正则。
 * 判据能不能回答，只有变异臂说了算。
 *
 * ⚠️ 这道门禁**不拦**的形状（如实登记，别把它当成"选中态再也回不去了"）：
 * 模块级 `let selectedTaskId: string | null = null`、`useReducer` 里的选中、
 * 以及"多选取中"（`selectedIds` 复数 —— 那是筛选范围，不是"当前看哪一条"）。
 * E 还有一条**已知边界**：它比的是"同一个文件里声明了有没有用"，所以
 * 用 `{...props}` 整体转发会被判红（现在没有这种写法）。真要用就得把名字
 * 加进 `WIRE_PROPS` 旁边那条说明里并改掉这条的判法 —— 不要靠注释绕过。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');

/** 响亮失败：锚点没了就红，不许静默跳过（跳过 = 这道门禁从此只是装饰）。 */
function fail(message) {
  console.error(`✗ 选中态门禁：${message}`);
  process.exit(1);
}

/** 只扫这两个宿主（它们才有"详情面/详情层"）。node-host 是 CLI，没有选中态。 */
const HOSTS = ['apps/web', 'apps/mobile'];

/** 断言 A 要求的最小出现次数：每个宿主恰好一份实例。 */
const REQUIRED_STORE_INSTANCES = HOSTS.length;

/**
 * B 认的"选中形状"的名字。**两个分支**：
 *
 * 1. `前缀 + 实体名 + Id`（`detailTaskId` / `editingNoteId` / …）—— 一直都有。
 * 2. `前缀 + Id`（**不带实体名**），但只认 `detail|selected|edit(ing)` 三个前缀。
 *
 * 🔴 第 2 个分支是 2026-10-03 由**变异臂**逼出来的：把 web 便签的选中换回
 * `const [editingId] = useState<string | null>(null)` 时门禁**当场存活** ——
 * 而 `selectedId` 正是移动端 `HabitsScreen` 删掉的那份本地状态用过的名字，
 * 也就是说这条缺口不是假想，是"同一个问题曾经就在这里、判据看不见它"。
 *
 * ⚠️ 第 2 个分支**不含** `active` 与 `open`，这不是遗漏：
 * `apps/web/src/features/quadrant/QuadrantBoard.tsx` 的 `const [activeId] = useState(...)`
 * 是 dnd-kit 的"**正在拖**哪一颗"，不是"当前看的是哪一条"。把它扫进来会让门禁
 * 在接线全对的树上恒红，而恒红的判据活不过下一轮。
 *
 * 🔴 为了腾出裸名 `editingId`，`PasskeyPanel` 里那份行内改名编辑器的状态
 * 已改名 `editingRowId`（2026-10-03）。它原本就叫 `editingId`，而**这个词表里它是合法的**
 * —— 但"哪个词合法"这件事不能靠两个人各猜一次：改名之后，`editingId` 这个名字
 * 从此只表示"选中/正在编辑的那一条"，而改名编辑器那种一次性、单屏、跨屏不需要保持的
 * 状态必须带自己的名字（第一次改名我撞上了 store 里已有的 `renamingId` —— 那个是
 * "**请求在途**的那条"，与"开着输入框的那一行"是两件事，两个概念不能并成一个名字）。
 * 仍未覆盖：模块级 `let editingId = null`、`useReducer` 里的选中（见下面那段）。
 */
const SELECTION_NAME =
  /^(?:(?:detail|selected|open|active|edit(?:ing)?)(?:Task|Habit|Note|Project|Tag|Event)Id|(?:detail|selected|edit(?:ing)?)Id)$/;

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

/** D 的词表来源：唯一的那个家。**清单抄在这里就会开始漂**，所以读真身。 */
const VOCAB_FILE = path.join(ROOT, 'packages/app-host/src/selection.ts');

/** 词表项必须长这样；出现别的形状就响亮地红，不让它变成"解析不到⇒判据空跑"。 */
const KIND_WORD = /^[a-z][A-Za-z0-9]*$/;

/**
 * 从 `SELECTABLE_KINDS` 的**数组字面量**里取词表。
 *
 * 🔴 取数组而不是取联合类型：数组是运行时唯一被 `for (const kind of …)` 消费的
 * 那份（`pruneSelection` 遍历的就是它），联合类型只是它的类型侧影子。
 * ⚠️ 解析要允许换行 —— 词表被人排成多行是迟早的事，写死单行会在那一天静默取到空集。
 */
function readVocab() {
  const source = readFileSync(VOCAB_FILE, 'utf8');
  const block = /export const SELECTABLE_KINDS(?::[^=]*)?=\s*\[([\s\S]*?)\]/.exec(source);
  if (block === null) {
    fail(`断言 D：在 ${path.relative(ROOT, VOCAB_FILE)} 里找不到 SELECTABLE_KINDS 的数组字面量`);
  }
  const kinds = [...block[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  if (kinds.length === 0) {
    fail('断言 D：词表解析出 0 项 —— 解析器坏了，不是"没有类别"');
  }
  for (const kind of kinds) {
    if (!KIND_WORD.test(kind)) fail(`断言 D：词表项「${kind}」不是合法标识符，消费方正则无法安全构造`);
  }
  return kinds;
}

/** 某类的消费方写法：`select('kind'` 或 `useSelected('kind'`。 */
const consumerOf = (kind) => new RegExp(`\\b(?:select|useSelected)\\(\\s*'${kind}'\\s*[,)]`);

/**
 * E 管的两个"接线名"：宿主管选中的两个出口 —— 一个是值（现在看的是哪一条），
 * 一个是回调（点某一条时通知宿主）。
 * 🔴 以后再有第三个跨层转发的选中 prop，要加进这里，否则它断在中间层没人知道。
 */
const WIRE_PROPS = ['activeTaskId', 'onOpenTask'];

/**
 * E 的扫描范围：两个宿主的 `src` **加上 `packages/ui/src`**。
 * ⚠️ 比 A–D 多一层是有原因的：A–D 判的是"宿主里别长出第二份"，只看宿主；
 * 而 E 判的那类缺陷恰好长在中间那层（宿主 → 共享板子 → 行）。
 */
const WIRE_DIRS = [...HOSTS.map((host) => path.join(ROOT, host, 'src')), path.join(ROOT, 'packages/ui/src')];

/** 声明形状：`readonly NAME?:` 和 `readonly NAME:` —— 必填的那一种更该拦。 */
const declOf = (name) => new RegExp(`readonly\\s+${name}\\??\\s*:`);

/**
 * 使用形状：传下去（`NAME={`）/ 调用（`NAME(`、`NAME?.(`）/ 读它（`===`、`!==`）。
 *
 * 🔴 **解构那一行刻意不算使用**：`const { tasks, onOpenTask } = props;` 只证明
 * 有人把它从 props 里取出来，而那正是事故现场做的事。所以每条 pattern 都要求
 * 名字后面**紧跟** `={` / `(` / `===`，中间不许有别的 token ——
 * 类型标注 `NAME?: (taskId: string) => void` 里那个 `(` 前面隔着 `:`，不会被误认。
 */
const useOf = (name) => [
  new RegExp(`\\b${name}=\\{`),
  new RegExp(`\\b${name}\\s*\\?\\.\\(`),
  new RegExp(`\\b${name}\\s*\\(`),
  new RegExp(`\\b${name}\\s*===`),
  new RegExp(`\\b${name}\\s*!==`),
];

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

const vocab = readVocab();
const consumerRegex = vocab.map((kind) => [kind, consumerOf(kind)]);
/** 每个词表项的消费点（`文件:行`）。空的那一类就是"槽位建了、没人选中过它"。 */
const consumersByKind = new Map(vocab.map((kind) => [kind, []]));

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
    for (const [kind, re] of consumerRegex) {
      if (re.test(line)) consumersByKind.get(kind).push(`${rel}:${i + 1}`);
    }
  });
}

/**
 * E：扫"声明了却没往下传/没读"的死接线。
 * `declared` 是这条判据的分母 —— 它若为 0，说明扫描层坏了（目录没了/正则不认了），
 * 那种情况下"零断线"是假的绿，所以单独判红。
 */
const declaredWires = [];
const brokenWires = [];
for (const dir of WIRE_DIRS) {
  if (!statSync(dir, { throwIfNoEntry: false })) {
    console.error(`✗ E 的扫描目录不存在：${path.relative(ROOT, dir)} —— 判红而不是跳过`);
    process.exit(1);
  }
  for (const file of walk(dir)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const name of WIRE_PROPS) {
      if (!declOf(name).test(src)) continue;
      declaredWires.push(`${path.relative(ROOT, file)}  ${name}`);
      if (!useOf(name).some((re) => re.test(src))) {
        brokenWires.push(`${path.relative(ROOT, file)}  ${name}`);
      }
    }
  }
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
  failures.push(`断言 C：宿主里重新定义了 SelectableKind（词表只有一个家）：\n  ${localKindDefs.join('\n  ')}`);
}

// D：词表里**每一类**都得有宿主真的选中过它。
const orphans = vocab.filter((kind) => consumersByKind.get(kind).length === 0);
if (orphans.length > 0) {
  failures.push(
    `断言 D：这些类别在两个宿主里没有任何一处 select/useSelected（每类应 ≥1）：\n  ${orphans.join(', ')}\n` +
      `  「槽位建了、界面上没有这个功能」是本仓库记过四次的形状（tagIds 那段是原件）。\n` +
      `  要么让某个宿主真的选中它，要么从 SELECTABLE_KINDS 删掉 —— 等真有详情面再加回来。`,
  );
}

if (declaredWires.length === 0) {
  failures.push(
    `断言 E：在 ${WIRE_DIRS.map((d) => path.relative(ROOT, d)).join(', ')} 里一处 ${WIRE_PROPS.join('/')} 的声明都没扫到。\n` +
      `  「没有断线」和「没在线可断」是两件事 —— 判红，让下一个来看的人先修扫描而不是庆祝。`,
  );
}
if (brokenWires.length > 0) {
  failures.push(
    `断言 E：这些文件**声明**了选中接线却没用起来（既不传下去、也不读）：\n  ${brokenWires.join('\n  ')}\n` +
      `  两个 prop 都是可选的 ⇒ typecheck 不会失败，症状只是"这一块不跟随选中"。\n` +
      `  改法：把该名字作为 JSX 属性传给这一层渲染的板子（NAME=\{NAME\}）；这一层若确实不该管，就把声明删掉。`,
  );
}

if (failures.length > 0) {
  console.error('✗ 选中态的所有者不唯一：\n');
  for (const f of failures) console.error(f + '\n');
  console.error('  改法：读 `@heyta/app-host` 的 `selection.ts`，宿主只留 lib/selection 那一层胶水。');
  process.exit(1);
}

const counts = vocab.map((kind) => `${kind} ${consumersByKind.get(kind).length}`).join(' / ');
console.log(
  `✅ 选中态只有一个所有者：${REQUIRED_STORE_INSTANCES} 份实例（${HOSTS.join(', ')}）` +
    `，宿主内本地选中态 0 处，词表定义 0 处，词表 ${vocab.length} 类全有消费者（${counts}）` +
    `，接线声明 ${declaredWires.length} 处全部用起来`,
);
