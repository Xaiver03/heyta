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
 * 九组断言（A–E 写在下面，F/G/H/I 各自的理由在各自小节开头）
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
 * I. **每一面都交代过"选中在你这儿是什么"**：分母是 `ViewKey` 的联合类型（`view-tabs.ts`），
 *    解析出 0 项即红；少登记一面即红并点名是哪一面；立场只许六档
 *    （`selects / filters / row-actions-only / no-rows / not-a-route / pending-decision`）；
 *    每条登记挂一枚**证据 needle**（那一行真代码的原样片段），needle 找不到 ⇒ 红。
 *    承重的是**过期**那一腿：登记成非选中立场的面，如果它自己的文件里出现了
 *    `useSelected(…)`/`selection.select(…)`，那条登记就成了谎 ⇒ 红。
 *    🔴 这一条补的是"负向判据的盲区"：A–H 拦的是"多了一份所有者／只声明不接／词表里有死类别"，
 *    而"新加一路由，没人想过选中算不算"这件事**永远不会红** —— 目标第②条要的是跨视图通用，
 *    它的可判形式是"每一面都被迫回答过"，不是"三张面都实现了"。
 *
 * ⚠️ 断言 I 的两条**有意**的边界（别读成"所有面都验过了"）：
 *  1. 射程只有 **web 的 ViewKey**。触屏端那 26 个 `apps/mobile/src/screens/*.tsx` 不在名册里 ——
 *     试过把行族（`` testID={`prefix-${…}`} ``）当分母：两宿主 + 共享层现量 **115 族 / 120 处**，
 *     绝大多数是按钮与图表单元，当"实体行"的分母只会逼出 115 条噪音登记。**否证，没采用。**
 *     触屏端由 H 按"谁读哪一类就得自己喂回落"逐文件钉（那是另一条轴，不要求"没读的屏"作答）。
 *  2. `rail:project` / `rail:tag` 两条是**手写**的：清单/标签是侧栏容器、不是一路由，
 *     今天没有机器可读的"侧栏面全集"源。⇒ 新加一个侧栏容器不会被这条照出来。
 *     词表那一侧由 D/F 守着（往 `SELECTABLE_KINDS` 加一类而没有界面消费它 = 红），
 *     所以"把清单变成可选中"这条路是有牙的；没有的只是"新增一个不选中的容器面"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 怎么确认它能失败（不要删这一段）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 断言 I 单独一趟装置：`research/tools/mutation-rigs/mutate-selection-i.mjs`（臂只改门禁自己那份表，
 * 不碰产品源码 —— 产品文件在共享工作树里正被别人改，往他们手里插变异就是制造别人名下的假红）。
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
 * | **I18** 同一趟里让 G 类红与 I 类红同时成立（摘一行 `ROW_ID_EXEMPT` + 名册少登记一格） | **两条都要打印**。🔴 曾经只打 I：断言 I 用 `fail()` 早退，把前面累积在 `failures` 里的红**整批吞掉**（合流产物上实测：G 那两行 trash `busyId` 一行都没打，于是 §8.47 第 4 步的执行器读不到自己的前提）。I18b 拿"还没有 flush 那一行的那版"（按内容从文件历史认，不按 HEAD）复现这个吞红 ⇒ 这条臂不是白给的 |
 * | **I1** 摘掉 `tasks` 那一格登记 | 红：断言 I，点名缺的是哪一面 |
 * | **I1b** 同一份变异喂"分母改成名册自己"的脱牙版 | 不红（证明 I1 的牙挂在"分母来自真身"那一腿） |
 * | **I2–I8** 词表外立场／类别不在选中词表／needle 过期／登记与代码相反 等 | 各自红在指定那一腿 |
 * | **I9a/I9b** 分母源读不到 / 联合类型写法换了 | 红且点名断言 I —— 🔴 I9a 第一趟**不符合预期**：那时读不到文件抛的是裸 ENOENT 栈，RC=1 但输出里没有"断言 I"，**栈也是红，可它不说明是哪条判据在红**；补 try/catch 才有这条臂 |
 * | **I10** 解析改成读空 | 红在"ViewKey 解析出 0 项"（空分母上的"全部交代过"是永真） |
 * | **I11** 同一份当前代码喂 HEAD 那版门禁 | RC=0 且那版不含断言 I ⇒ 补的是实测存在的缺口，不是顺手加严 |
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
 * E 还有一条**已知边界**：它比的是"同一个文件里声明了有没有用"。对象字面量
 * 转发现在也纳入判定：`const taskListProps = { onOpenTask, ... }` 后以
 * `<TaskList {...taskListProps} />` 传下去，算作真实使用；单纯的
 * `const { onOpenTask } = props` 解构仍然不算。动态 `React.createElement` 仍不在范围内。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');

/** 收集式断言（A–H 与 I 的内容级红）的红都累积在这里，最后一起报。 */
const failures = [];

/** 响亮失败：锚点没了就红，不许静默跳过（跳过 = 这道门禁从此只是装饰）。
 * 🔴 退出前**先把已累积的红打出来**：早退吞掉别人的红，症状是"红得比实际少"，
 *    而下一个人只会看到这一条 —— 合流那一步的前提就这样变成"读不出来"（工单 §8.104）。 */
function fail(message) {
  for (const f of failures) console.error(`✗ 选中态门禁（先前收集的红）：${f}\n`);
  failures.length = 0;
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
 * 对象属性 → JSX spread 的接线形状。
 *
 * 只接受同一文件里可定位的对象字面量：对象本身必须声明了该 wire prop，
 * 并且这个对象名必须出现在 JSX 开标签的 `{...name}` 中。这样不会把 props
 * 解构、普通对象合并或注释里的名字误算成使用。
 */
function objectSpreadUseOf(src, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasTopLevelProperty = (body) => {
    let depth = 0;
    let quote;
    let start = 0;
    const segments = [];
    for (let i = 0; i <= body.length; i++) {
      const char = body[i];
      if (quote !== undefined) {
        if (char === '\\') i++;
        else if (char === quote) quote = undefined;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }
      if (char === '{' || char === '[' || char === '(') {
        depth++;
        continue;
      }
      if (char === '}' || char === ']' || char === ')') {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if ((char === ',' || i === body.length) && depth === 0) {
        segments.push(body.slice(start, i).trim());
        start = i + 1;
      }
    }
    return segments.some((segment) => new RegExp(`^${escapedName}(?:\\s*:|\\s*$)`).test(segment));
  };
  const objectDecl = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z0-9_$]+)\\s*=\\s*\\{`, 'g');
  const objectNames = [];
  let declaration;
  while ((declaration = objectDecl.exec(src)) !== null) {
    const open = declaration.index + declaration[0].lastIndexOf('{');
    let depth = 0;
    let quote;
    let close = -1;
    for (let i = open; i < src.length; i++) {
      const char = src[i];
      if (quote !== undefined) {
        if (char === '\\') i++;
        else if (char === quote) quote = undefined;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }
      if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close < 0) continue;
    const body = src.slice(open + 1, close);
    if (hasTopLevelProperty(body)) objectNames.push(declaration[1]);
  }
  return objectNames.some((objectName) =>
    new RegExp(`<[^>]*\\{\\s*\\.\\.\\.\\s*${objectName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b[^>]*>`).test(src),
  );
}

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
      if (!useOf(name).some((re) => re.test(src)) && !objectSpreadUseOf(src, name)) {
        brokenWires.push(`${path.relative(ROOT, file)}  ${name}`);
      }
    }
  }
}

/**
 * 🔴 **号不占 F**：F 这个号 §8.24 已经预留给"每张有选中态的面必须把选中说出来"的常驻判据
 * （`aria-current` 或 `aria-pressed` 择一 + 豁免浮层型面），那条才是工单等的 F。本节这条按字母顺位取 **G**。
 *
 * G：把"宿主里再没有人自己记着选中"从**一次人工审计**变成一个**余量为 0 的棘轮**。
 *
 * 为什么 B 不够：B 认的是它那张**名字表**。§8.28 逐处读完两端所有"记住某一行的 id"的
 * 本地 `useState`（那一趟现量 15 处），结论是那些都不是选中 —— 但**那是那次读的结果**，
 * 它不会自己守住下一次：下一处写成任何不在 B 词表里的名字，B 就看不见它，
 * 而"界面上悄悄多出第二个所有者"这件事从来不报错（本仓库 tagIds 那段是原件）。
 * ⚠️ 那一趟实测确认这 15 处**没有一处**被 B 命中（读数 `TOTAL=15` 与取法在工单 §8.28，
 * 不在本文件里 —— 本节的常驻值是下面 G 每次跑时打印的命中数）——
 * 也就是说 B 对这一整族**本来就是零射程**，不是"射程小"。
 *
 * 🔴 表按 `文件 + 变量名` 索引，**不按行号**：同一棵树里产品文件与剥掉块注释后的行号
 * 差了 40+ 行（取数时量到的），拿行号当键的话这条门禁会在任何人加一段注释时批量假红。
 * 🔴 类别是**封闭词表**。填一个不在词表里的词**按未登记处理** ——
 * 否则"随便写个理由"就能绕过这条，而绕过判据最省力的写法恰好就是填一张表。
 * ⚠️ 档位会随"读到的真实概念"长：§8.28 立了前四档，第五档 `form-draft` 是 2026-10-05 合流之后
 * 才被迫命名的（移动端 AI 面板那个"这条提案作用在哪条任务上"，见下面那行的注释）——
 * 它**不是**为了让某处变绿而加的口子：加档的同时必须有一行登记 + 一条判据钉住"这一档不许写成 IA 选中态"
 * （`apps/mobile/tests/ai-panel-local-selection.spec.ts`），否则第五档就只是第四个借口。
 * 🔴 **过期豁免也判红**：表里一条在当前代码里找不到对应声明，就是那条豁免已经不再命中。
 *     让它悄悄躺着，等于用一张"看起来很全"的表把真正的覆盖面盖住（元规则二那种病）。
 */
const ROW_ID_CLASSES = ['in-flight', 'inline-rename', 'confirm-gate', 'dragging', 'form-draft'];

/** §8.28 那一趟逐处归类后的结果（条数以断言 G 打印的为准，别在这里抄数）。改名／删掉某处时必须同时改这里，否则 G 报过期豁免。 */
const ROW_ID_EXEMPT = [
  ['apps/web/src/features/calendar/CalendarView.tsx', 'busyId', 'in-flight'],
  // 🔴 §8.133：这两处随面单一起从 `HabitsView.tsx` 搬进 `HabitDetailCard.tsx`
  // （面单落进详情列那一格，视图只剩列表）。语义类别没变，变的是宿主文件 ——
  // 表按「文件 + 变量名」索引，所以搬家必须两行一起改，否则 G 报过期豁免。
  ['apps/web/src/features/habits/HabitDetailCard.tsx', 'busyId', 'in-flight'],
  ['apps/web/src/features/habits/HabitDetailCard.tsx', 'renamingId', 'inline-rename'],
  ['apps/web/src/features/quadrant/QuadrantBoard.tsx', 'activeId', 'dragging'],
  ['apps/web/src/features/settings/PasskeyPanel.tsx', 'confirmingId', 'confirm-gate'],
  ['apps/web/src/features/settings/PasskeyPanel.tsx', 'editingRowId', 'inline-rename'],
  // 后台退款那两枚按钮是**两步式批准**：第一下记下"待批准的是哪一条"，第二下（确认框里那枚）才发请求。
  // 类别按那处代码自己的注释归（`AdminPanel.tsx`：「待确认的那一条退款 id（两步式"批准"）」）。
  ['apps/web/src/features/admin/AdminPanel.tsx', 'pendingApproveId', 'confirm-gate'],
  ['apps/web/src/features/trash/TrashView.tsx', 'busyId', 'in-flight'],
  ['apps/web/src/features/trash/TrashView.tsx', 'confirmingId', 'confirm-gate'],
  ['apps/mobile/src/screens/CalendarScreen.tsx', 'busyId', 'in-flight'],
  ['apps/mobile/src/screens/HabitsScreen.tsx', 'busyId', 'in-flight'],
  ['apps/mobile/src/screens/HabitsScreen.tsx', 'renamingId', 'inline-rename'],
  ['apps/mobile/src/screens/SecurityScreen.tsx', 'busyId', 'in-flight'],
  ['apps/mobile/src/screens/SecurityScreen.tsx', 'renamingId', 'inline-rename'],
  ['apps/mobile/src/screens/SecurityScreen.tsx', 'confirmDeleteId', 'confirm-gate'],
  ['apps/mobile/src/screens/TasksScreen.tsx', 'busyId', 'in-flight'],
  ['apps/mobile/src/screens/TrashScreen.tsx', 'busyId', 'in-flight'],
  ['apps/mobile/src/screens/TrashScreen.tsx', 'confirmingId', 'confirm-gate'],
];

/** 只看**单数** `…Id`：复数 `…Ids` 是筛选范围（"当前看哪几条"），不是"当前看的是哪一条"。 */
const ROW_ID_NAME = /^[A-Za-z0-9_$]*Id$/;

const rowIdSeen = [];
const rowIdKey = (file, name) => `${file}  ${name}`;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  stripComments(readFileSync(file, 'utf8'))
    .split('\n')
    .forEach((line) => {
      LOCAL_STATE_DECL.lastIndex = 0;
      let m;
      while ((m = LOCAL_STATE_DECL.exec(line)) !== null) {
        if (ROW_ID_NAME.test(m[1])) rowIdSeen.push(rowIdKey(rel, m[1]));
      }
    });
}

/** 词表自检：登记表本身先要合法，否则"表里有这条"可能指的是一个根本不存在的类别。 */
for (const [, , tag] of ROW_ID_EXEMPT) {
  if (!ROW_ID_CLASSES.includes(tag)) {
    failures.push(
      `断言 G：豁免登记里有一档类别「${tag}」不在封闭词表 ${ROW_ID_CLASSES.join('/')} 里 —— ` +
        `这条登记按未登记处理（填个词不该能绕过判据）。`,
    );
  }
}

const exemptKeys = new Set(ROW_ID_EXEMPT.map(([f, n]) => rowIdKey(f, n)));
// B 已经管住的那些名字不算 G 的射程：两处判同一件事会各报一遍，改的人不知道先满足哪个。
const unregistered = [...new Set(rowIdSeen)].filter((k) => !exemptKeys.has(k) && !SELECTION_NAME.test(k.split('  ')[1]));
if (unregistered.length > 0) {
  failures.push(
    `断言 G：宿主里有 ${unregistered.length} 处本地 \`…Id\` useState 没有语义登记：\n  ${unregistered.join('\n  ')}\n` +
      `  先问它在这一屏决定什么：是"当前看的是哪一条"⇒ 那是**第二个选中所有者**，删掉它、改用 @heyta/app-host 的 selection；\n` +
      `  是 ${ROW_ID_CLASSES.length} 类瞬态之一（${ROW_ID_CLASSES.join(' / ')}）⇒ 在 ROW_ID_EXEMPT 里登记一行并写明是哪一类。`,
  );
}
const stale = ROW_ID_EXEMPT.filter(([f, n]) => !rowIdSeen.includes(rowIdKey(f, n)));
if (stale.length > 0) {
  failures.push(
    `断言 G：登记表里有 ${stale.length} 条**当前代码里已经不存在**的豁免：\n` +
      `  ${stale.map(([f, n, t]) => `${f}  ${n} (${t})`).join('\n  ')}\n` +
      `  过期豁免和永真判据是同一种病 —— 删掉它，或把改名后的新那条一起登记进来。`,
  );
}
// 分母自检：一个 `…Id` 都没扫到 = 扫描层坏了，"零未登记"就是假的绿。
if (rowIdSeen.length === 0) {
  failures.push(
    `断言 G：在 ${HOSTS.join(' / ')} 的 src 里一处 \`…Id\` 的 useState 都没扫到。\n` +
      `  「全部已登记」和「没东西可登记」是两件事 —— 判红，让下一个来看的人先修扫描。`,
  );
}

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

/**
 * F：§8.24 立项的那一条，也是 W1c 从"一次性判据"变常驻的那一条 ——
 * **「选中态存续期间列表仍可见」的每一处渲染面，必须把选中说出来**，通道按端择一：
 * web / DOM 走 `aria-current`，RN 走 `aria-pressed`（RN 的 `AriaProps` 里**没有** `aria-current`，
 * 写了等于没写 —— 见 `packages/ui/src/habits/HabitProgressList.tsx:252-256` 自己那段说明）。
 *
 * 🔴 §8.28 给 F 立的两条约束在这里落地，两条都是**构造层面**挡住的而不是注释里劝：
 * ① **不许按 `active` 字样认选中**：一个面"说出来了"的判据是那条属性的**值来自一个选中 id 的等值式**
 *   （谓词行里必须出现 `activeTaskId` / `activeNoteId` / `selectedId` 之一并且有 `===`），
 *   而不是"有个 `active` 属性"。`QuadrantBoard.tsx` 那份 dnd 的 `activeId` 不在这三个词里，
 *   所以它**结构上**当不了证据 —— 把 `TaskList` 的谓词换成 `active: true` 会直接红（臂 H4）。
 * ② **豁免面是量出来的不是拍的**：mobile 便签那一处不接 `activeNoteId`，
 *   现量 `NotesSection.tsx` 传它 0 次，而编辑器是全屏 `Modal` ⇒ 列表可见期间那个 id 恒为 null。
 *   这条豁免带**可伪证的基础**：一旦那个文件开始传 `activeNoteId=`，豁免的理由就失效，F 判红（臂 H6）。
 *
 * ⚠️ 覆盖面是 **§8.26 现量的四处渲染**，不是"三张面"：习惯两端各有一份实现（web 本地 DOM 清单、
 * mobile 共享 RN 清单），两边都早就有两种线索 —— 少计一处就会把"本来做对了"读成"没做"。
 */
const SELECTION_ID_PROPS = ['activeTaskId', 'activeNoteId', 'selectedId'];

/** 每一处**说出选中**的渲染面：`file` 发属性，`driver` 是那条属性的值里必须出现的谓词名。 */
const FACES = [
  {
    kind: 'task',
    label: 'web 任务行（列表 / 四象限 / 时间线共用 TaskRow）',
    file: 'packages/ui/src/task-list/TaskRow.tsx',
    channel: 'aria-current',
    driver: 'active',
    // 谓词不在渲染行自己手里算，在上一级 —— 所以这条面的"值来自选中 id"要到 relay 那个文件去验。
    relay: 'packages/ui/src/task-list/TaskList.tsx',
  },
  { kind: 'note', label: 'web 便签', file: 'packages/ui/src/notes/NotesBoard.tsx', channel: 'aria-current', driver: 'active', relay: null },
  { kind: 'habit', label: 'web 习惯（本地 DOM 清单）', file: 'apps/web/src/features/habits/HabitsList.tsx', channel: 'aria-current', driver: 'selected', relay: null },
  {
    kind: 'habit',
    label: 'mobile 习惯（共享 RN 清单）',
    file: 'packages/ui/src/habits/HabitProgressList.tsx',
    channel: 'aria-pressed',
    driver: 'selected',
    relay: null,
  },
  {
    // 🔴 这一枚是 F 原本**看不见**的那种：它自己按 id 等值算、自己上色，却登记在"递送层"里。
    //   共享 RN 组件，两端同一份 ⇒ 通道只能走 `aria-pressed`（§8.26：RN 的 `AriaProps` 没有 `aria-current`）。
    kind: 'task',
    label: '时间线行（共享 RN，web/mobile 两端同一份）',
    file: 'packages/ui/src/timeline/TimelineBoard.tsx',
    channel: 'aria-pressed',
    driver: 'rowSelected',
    relay: null,
  },
];

/**
 * 声明了选中 id、但**本身不发属性**的那些文件 —— 它们的职责是把选中往下递。
 * 这一张表的用途不是描述现状，是让"**新冒出来一个接选中的面、却没人要求它把选中说出来**"变红：
 * 扫描到的声明者凡是不在 FACES 也不在这里，就判红（臂 H5）。
 */
const RELAYS = [
  'apps/mobile/src/screens/QuadrantScreen.tsx',
  'apps/mobile/src/screens/TimelineScreen.tsx',
  'apps/web/src/features/quadrant/QuadrantBoard.tsx',
  'apps/web/src/features/timeline/TimelinePanel.tsx',
  'packages/ui/src/quadrant/QuadrantBoard.tsx',
];

/** 该豁免的面，**带它成立所依赖的那件可测事实**。事实变了就必须重新读这一面。 */
const TRACE_EXEMPT = [
  {
    file: 'apps/mobile/src/screens/NotesSection.tsx',
    prop: 'activeNoteId',
    reason: '编辑器是全屏 Modal，列表可见期间该 id 恒为 null（§8.26 第③条现量）',
  },
];

const readTracked = (rel, who) => {
  const abs = path.join(ROOT, rel);
  if (!statSync(abs, { throwIfNoEntry: false })) {
    fail(`断言 F：${who} 指的文件 ${rel} 不在了 —— 判红而不是跳过（静默跳过等于这条判据从此只描述空气）`);
  }
  return stripComments(readFileSync(abs, 'utf8'));
};

/**
 * 谓词那一行的**右半边**必须同时有 `===` 和一个选中 id —— 这才是"值来自选中"的可判形式。
 *
 * 💥 第一版是"取整行来看"，被自己的臂 H4 当场照出假绿：
 * `TaskList.tsx:280` 原文是 `{...(activeTaskId === undefined ? {} : { active: activeTaskId === row.id })}`，
 * 把 `active:` 后面换成常量 `{ active: true }` 之后，**同一行左半边那句 `activeTaskId === undefined` 还在**，
 * 整行判据照样看见 `===` 与 `activeTaskId` ⇒ 门禁绿，而那一面已经不会跟随选中了。
 * 所以必须只看**右半边**（谓词自己那一段），不能看整行。
 * ⚠️ 边界：右半边按"到行尾"取，把等值式换行写的人会被判红 —— 那是源码级判据的取法，
 *   宁可红得难看，也不留一个能藏常量的口径。
 */
const driverComesFromSelection = (src, driver) => {
  const re = new RegExp(`(?:const\\s+${driver}\\s*=|\\b${driver}\\s*:)`, 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    const rhs = src.slice(m.index + m[0].length).split('\n')[0];
    if (rhs.includes('===') && SELECTION_ID_PROPS.some((p) => rhs.includes(p))) return true;
  }
  return false;
};

const traceFiles = WIRE_DIRS.flatMap((dir) => walk(dir));
const declarers = traceFiles
  .map((f) => path.relative(ROOT, f))
  .filter((rel) => {
    const src = stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));
    return SELECTION_ID_PROPS.some((p) => new RegExp(`readonly\\s+${p}\\??\\s*:`).test(src));
  });

for (const face of FACES) {
  const src = readTracked(face.file, `面「${face.label}」`);
  const other = face.channel === 'aria-current' ? 'aria-pressed' : 'aria-current';
  const carries = (ch) => new RegExp(`${ch}=\\{[^}]*\\b${face.driver}\\b`).test(src);
  if (!carries(face.channel)) {
    failures.push(
      `断言 F：面「${face.label}」（${face.file}）没有用 ${face.channel} 把选中说出来（谓词 ${face.driver} 不在那条属性里）。\n` +
        `  这一面是"选中的那一条正在右边显示"唯一的无障碍通道 —— 只有底色没有属性，读屏用户拿不到这件事。`,
    );
  }
  if (carries(other)) {
    failures.push(
      `断言 F：面「${face.label}」把谓词 ${face.driver} 挂在了 ${other} 上，而它登记的通道是 ${face.channel}。\n` +
        `  🔴 RN 的 AriaProps 里没有 aria-current：在 RN 面写它**不报错、也不生效**，正好是最安静的那种坏。`,
    );
  }
  /**
   * 🔴 **每一处底色都要配一条通道**。只查"这个文件里出现过通道"会漏一种真缺陷：
   *   同一面把选中的行画在**两个地方**（时间线：行区那一行 + 未排期泳道那一条），
   *   只在其中一处说出来，另一处对读屏就是"没有选中"—— 而上面那条 `carries()` 仍然绿。
   *   分母不是手写的，是从"这个文件用了几次选中底色"推出来的。
   */
  const paintSites = (src.match(/styles\.rowActive/g) ?? []).length;
  const channelSites = (src.match(new RegExp(`${face.channel}=\\{[^}]*\\b${face.driver}\\b`, 'g')) ?? []).length;
  if (paintSites > 0 && channelSites < paintSites) {
    failures.push(
      `断言 F：面「${face.label}」有 ${paintSites} 处用选中底色表达选中，却只有 ${channelSites} 处把同一件事用 ${face.channel} 说出来。\n` +
        `  少的那几处不是"样式少了"，是**那一面上的选中对读屏不存在**。`,
    );
  }
  const provSrc = readTracked(face.relay ?? face.file, `面「${face.label}」的谓词来源`);
  if (!driverComesFromSelection(provSrc, face.driver)) {
    failures.push(
      `断言 F：面「${face.label}」的谓词 ${face.driver} **不是从一个选中 id 等值算出来的**（要看到 === 与 ${SELECTION_ID_PROPS.join('/')} 之一）。\n` +
        `  否则"这一面把选中说出来了"只是句字面话：常量、拖拽态、hover 态都能让它有形状没内容。`,
    );
  }
}

const listedDeclarers = new Set([...FACES.map((f) => f.file), ...(FACES.map((f) => f.relay).filter(Boolean)), ...RELAYS]);
const unlisted = declarers.filter((rel) => !listedDeclarers.has(rel));
if (unlisted.length > 0) {
  failures.push(
    `断言 F：有 ${unlisted.length} 个文件**接了选中 id**（声明了 ${SELECTION_ID_PROPS.join('/')} 之一）却没在 F 的任何一张表里：\n  ` +
      `${unlisted.join('\n  ')}\n` +
      `  它要么是一处该发痕迹的面（加进 FACES，并写清端与通道），要么是把选中往下递的一层（加进 RELAYS）。\n` +
      `  "多了一处接选中的面而没人要求它把选中说出来"正是这条断言存在的理由。`,
  );
}
for (const rel of RELAYS) {
  const src = readTracked(rel, '递选中那一层');
  // 🔴 规则在 2026-10-04 收紧过一次：原来"`p={` **或** `p ===`"都算"在递"，
  //   于是**自己按 id 等值算、自己上色**的那一层（共享 `TimelineBoard`）可以合法地躲在"递送层"里，
  //   而递送层不要求发无障碍通道 ⇒ 它有底色、没声音，F 看不见。
  //   "递"和"算"不是一回事：**往下递才算 relay，自己算就是面，面必须说话。**
  const forwards = SELECTION_ID_PROPS.some((p) => new RegExp(`\\b${p}=\\{`).test(src));
  if (!forwards) {
    failures.push(
      `断言 F：登记为"把选中往下递"的 ${rel} 现在**没有把任何一个选中 id 用 JSX 传下去** —— 那条登记过期了。\n` +
        `  如果它其实是**自己拿 id 算痕迹**（上底色 / 加图标），那它是一处面：加进 FACES 并写清端与通道，别留在这张表里。`,
    );
  }
  /**
   * 🔴 **反方向同一格**（2026-10-04，§8.42 的镜像）：递送层不许自己出痕迹。
   *   上面那条只挡住"整个躲进 RELAYS 免检"，挡不住"既往下递、又自己上色" ——
   *   那种写法两条规则都满足（`p={` 在、面表里没有它），于是痕迹那一半永远没人要求它说话。
   *   现量五层今天**零痕迹**（§8.42 第 12 节逐处数过），所以这条是挡未来的；
   *   也正因为它现在没有对应的真缺陷，它**必须**带臂（H14/H15），否则就是一句会慢慢烂掉的装饰。
   */
  const ownTrace = src.match(/\bstyles\.[A-Za-z_$][\w$]*[Ss]elect|\bstyles\.rowActive\b|\baria-(?:current|pressed)=\{/g);
  if (ownTrace !== null) {
    failures.push(
      `断言 F：登记为"递送层"的 ${rel} 现在**自己也在表达选中**（${[...new Set(ownTrace)].join(' / ')}）。\n` +
        `  "递"和"算"同时成立时，"算"那一半必须按面登记：加进 FACES 写清端与通道 ——\n` +
        `  否则它既有底色又没声音，而那正是这次缺陷的形状，只是换了个躲法。`,
    );
  }
}
for (const ex of TRACE_EXEMPT) {
  const src = readTracked(ex.file, '豁免面');
  if (new RegExp(`\\b${ex.prop}=\\{`).test(src)) {
    failures.push(
      `断言 F：豁免面 ${ex.file} 现在**把 ${ex.prop} 传下去了** —— 它豁免的理由（${ex.reason}）不再成立。\n` +
        `  这一面从此要求痕迹：把它加进 FACES，别把这条豁免留着。`,
    );
  }
}
/** 词表是从真身读的（断言 D 读的那份）。加一类选中而不给它在任何端留一处会说话的面 ⇒ 红。 */
const kindsWithoutFace = vocab.filter((kind) => !FACES.some((f) => f.kind === kind));
if (kindsWithoutFace.length > 0) {
  failures.push(
    `断言 F：词表里的 ${kindsWithoutFace.join('/')} 在任何端都没有一处会"说出选中"的面。\n` +
      `  "界面上有这一类"与"读屏用户知道现在看的是哪一条"是两件事 —— 后者要靠这一面的属性。`,
  );
}
// 分母自检：痕迹属性一个都扫不到 = 探针坏了，"四处都有痕迹"就是假的绿。
const anyTrace = traceFiles.filter((f) => /aria-(?:current|pressed)=\{/.test(stripComments(readFileSync(f, 'utf8'))));
if (anyTrace.length < FACES.length) {
  failures.push(
    `断言 F：整棵树只扫到 ${anyTrace.length} 个文件带 aria-current/aria-pressed 属性，少于登记的 ${FACES.length} 处面。\n` +
      `  「每处都有」与「扫不到所以没人缺」是两件事 —— 判红，先修扫描再庆祝。`,
  );
}

/**
 * H：谁**读**某一类的选中，谁就必须把那一类**喂进回落**。
 *
 * 这条是 §8.43 那节课的常驻形态。当时是靠人按"谁在读这一类"去数屏幕，
 * 数出来任务屏是第三个持有便签全集的宿主；但"数"这件事本身会漂 ——
 * 下一位新加一个读 `useSelected('habit')` 的屏，没有任何一层会提醒他回落要一起接。
 *
 * 🔴 触屏端与 Web 端**必须是两套规则**，因为两端的回落**挂载方式**不同（这是现量，不是偏好）：
 *  - `apps/mobile`：回落按屏跑（每个屏各自 `pruneSelectionAgainst(…)`），所以规则是**同文件**配对。
 *  - `apps/web`：一份中央回落挂在 store 上（`lib/selection.ts` 的 `pruneSelectionFromEntities`），
 *    各视图只读不喂 ⇒ 规则改成"中央那份必须覆盖本宿主**读到的每一类**，而且真的被接线调用过"。
 * 把两端写成同一条"同文件配对"会得到一整片假红；反过来写成"整棵树里有喂就算"会得到假绿 ——
 * §8.43 第 7 节那次自我否证就是因为"别的文件也在喂"被当成了"这一屏有人负责"。
 */
const readKindRe = (kind) => new RegExp(`useSelected\\(['"]${kind}['"]\\)`);
/** 取 `调用名(` 之后第一个花括号块的原文（大括号配对，不是"往后找 N 个字符"）。 */
function objectBlocksOf(src, callRe) {
  const out = [];
  let m;
  const re = new RegExp(callRe.source, 'g');
  while ((m = re.exec(src)) !== null) {
    const braceAt = src.indexOf('{', m.index + m[0].length - 1);
    if (braceAt === -1) continue;
    let depth = 0;
    for (let i = braceAt; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          out.push(src.slice(braceAt + 1, i));
          re.lastIndex = i;
          break;
        }
      }
    }
  }
  return out;
}
const feedKeysOf = (blocks) => {
  const fed = new Set();
  for (const block of blocks) {
    for (const kind of vocab) {
      if (new RegExp(`(^|[,{\\s])${kind}\\s*:`).test(block)) fed.add(kind);
    }
  }
  return fed;
};

const readsSeen = [];
for (const file of files) {
  const rel = path.relative(ROOT, file);
  if (/\/lib\/selection\.tsx?$/.test(rel)) continue; // 定义处不算读方
  const src = stripComments(readFileSync(file, 'utf8'));
  const read = vocab.filter((kind) => readKindRe(kind).test(src));
  if (read.length === 0) continue;
  readsSeen.push([rel, read]);
  if (rel.startsWith('apps/mobile/')) {
    const fed = feedKeysOf(objectBlocksOf(src, /pruneSelectionAgainst\(\s*\{/));
    const missing = read.filter((kind) => !fed.has(kind));
    if (missing.length > 0) {
      failures.push(
        `断言 H：${rel} 读了 ${missing.map((k) => `'${k}'`).join('/')} 的选中，却没把这几类喂进自己那一处\n` +
          `  \`pruneSelectionAgainst({ … })\`。触屏端的回落**按屏跑**：这一屏不喂，选中的那条被删掉时\n` +
          `  这一屏的面板就不会自己关 —— 而别的屏在喂**不构成理由**（见工单 §8.43 第 7 节：\n` +
          `  把自己界面的正确性寄在别人的挂载策略上，一次"把浮层改成条件挂载"的重构就会让它当天变成真缺陷，\n` +
          `  且没有任何一层会红）。\n` +
          `  全集从这一屏已经拿得到的动作集里取（` +
          `\`actions.listTasks()\` / \`listHabits()\` / \`createNoteActions(host).listNotes()\`），不许传筛完的那一截。`,
      );
    }
  }
}
// Web：中央回落必须覆盖本宿主读到的每一类，而且真的被调过（挂在 store 变化上，不挂在某个屏的挂载上）。
const webReads = new Set(readsSeen.filter(([rel]) => rel.startsWith('apps/web/')).flatMap(([, r]) => r));
const webGlue = 'apps/web/src/lib/selection.ts';
const webGlueSrc = stripComments(readFileSync(path.join(ROOT, webGlue), 'utf8'));
const webFed = feedKeysOf(objectBlocksOf(webGlueSrc, /pruneSelection\(\s*selection\s*,\s*\{/));
for (const kind of webReads) {
  if (!webFed.has(kind)) {
    failures.push(
      `断言 H：${webGlue} 的中央回落没有覆盖 '${kind}'，但 apps/web 里有视图读它。\n` +
        `  Web 端的规则是"一份中央回落挂在物化状态上"，少一类就是那一类的选中被删掉后面板不自己关。`,
    );
  }
}
const webGlueCallers = files.filter(
  (f) =>
    path.relative(ROOT, f).startsWith('apps/web/') &&
    !path.relative(ROOT, f).endsWith('lib/selection.ts') &&
    /\bpruneSelectionFromEntities\(/.test(stripComments(readFileSync(f, 'utf8'))),
);
if (webGlueCallers.length === 0) {
  failures.push(
    `断言 H：apps/web 里除了 ${webGlue} 自己，没有任何文件调用 \`pruneSelectionFromEntities(\`。\n` +
      `  中央回落存在但没人调 = 一条永真的登记；Web 端的"数据变了才问选中的还在不在"从来没发生过。`,
  );
}
// 分母自检：一个读方都没扫到 = 扫描层坏了，"全部配对"就是假的绿。
if (readsSeen.length === 0) {
  failures.push(
    `断言 H：整棵树没扫到任何 \`useSelected(…)\` 读方。\n` +
      `  那要么选中态没人读了（功能没了），要么正则/剥注释坏了 —— 两种都不是"判据通过"。`,
  );
}

/**
 * I：**每一面都交代过"选中在你这儿是什么"** —— 视图轴的名册（工单 §8.95/§8.96 的机器化）。
 *
 * 为什么 A–H 不够：它们全是**负向**的（不许有第二份所有者、不许只声明不接、词表里不许有死类别），
 * 所以"这一面今天没对选中交代过任何事"永远不会红。目标第②条要的是**跨视图通用**的机制，
 * 而"通用"的可判形式不是"三张面都实现了"，是**"每一面都被迫回答过"**：
 * 回答"选同一份 store"、"点行改的是筛选"、"这面没有实体行"里的哪一个都行，**没回答不行**。
 * 新加一路由时红，就是这条的全部价值。
 *
 * 🔴 分母从真身读，不抄清单：`ViewKey` 的联合类型（`apps/web/src/features/shell/view-tabs.ts`，
 *   它同时是顶栏按钮与页面标题的唯一来源）。解析出 0 项即红 —— "没有缺口"与"没在可查"是两件事。
 *   名册里出现 ViewKey 之外的键**也红**（挡手抖写错名），只有一个例外前缀 `rail:`：
 *   清单/标签是侧栏容器、不是一路由，而"侧栏面全集"今天**没有**机器可读的源 ——
 *   试过拿 `` testID={`prefix-${…}`} `` 的行族当分母：两宿主 + 共享层现量 **115 族 / 120 处**，
 *   绝大多数是按钮与图表单元，用它当"实体行"的分母只会逼出 115 条噪音登记（现量否证，记在这儿）。
 *   所以那两条是手写的，边界如实登记在下面。
 *
 * 立场词表（封闭六档，词表外即红）：
 *   `selects` —— 这一面把选中接进共享 store（必须报是哪几类，且证据文件里真有那一类的消费形状）
 *   `filters` —— 点这一面的行改的是**筛选**而不是选中（必须点名哪一类实体，且该类不许在词表里）
 *   `row-actions-only` —— 有实体行，但行上没有"看哪一条"这回事（回收站：恢复 / 彻底删除）
 *   `no-rows` —— 这一面没有"某一条实体"的概念（日历的"当前"是一天，专注页是计时状态机）
 *   `not-a-route` —— 它是浮层，`contentView` 根本不落在这里
 *   `pending-decision` —— 等拍板（必须带 C1 编号，否则等于用"待定"绕过这条）
 *
 * 承重的是**过期**那一腿：登记成 `filters`/`no-rows` 的面，如果它自己的文件里哪天出现了
 * `useSelected(…)`/`selection.select(…)`，这条登记就成了谎 ⇒ 红。那一腿只在证据文件
 * **不是** `App.tsx` 时生效（App.tsx 是中央宿主，任何视图的 needle 都可能落在它里面，
 * 拿它判"这面没接选中"必然假红 —— 这是设计约束，不是宽松）。
 */
const VIEWKEY_FILE = path.join(ROOT, 'apps/web/src/features/shell/view-tabs.ts');
const STANCE_VOCAB = ['selects', 'filters', 'row-actions-only', 'no-rows', 'not-a-route', 'pending-decision'];

/** 名册。2026-10-04 逐面现量：每条 needle 都是从那一行原样抄下来的，不是描述。 */
const VIEW_STANCES = [
  {
    view: 'tasks',
    stance: 'selects',
    kinds: ['task'],
    locus: 'apps/web/src/App.tsx',
    needle: "const selectedTaskId = useSelected('task');",
    because: '列表是任务的第一个投影，选中就是共享 store 里那一个值。',
  },
  {
    view: 'quadrant',
    stance: 'selects',
    kinds: ['task'],
    locus: 'apps/web/src/App.tsx',
    needle: '<QuadrantBoard onOpenTask={openTask} activeTaskId={selectedTaskId} />',
    because: '同一批任务的第二种投影，接的是同一个值（断言 E 那次事故就出在这一行）。',
  },
  {
    view: 'timeline',
    stance: 'selects',
    kinds: ['task'],
    locus: 'apps/web/src/App.tsx',
    needle: 'onOpenTask={openTask}',
    because: '第三种投影；web 此前时间线行体不可点，是 W1 顺手补齐的端间不一致。',
  },
  {
    view: 'habits',
    stance: 'selects',
    kinds: ['habit'],
    locus: 'apps/web/src/features/habits/HabitsView.tsx',
    needle: "const selectedId = useSelected('habit');",
    because: '习惯板自己读共享选中，不再持有本地态。',
  },
  {
    view: 'notes',
    stance: 'selects',
    kinds: ['note'],
    locus: 'apps/web/src/features/notes/NotesView.tsx',
    needle: "const editingId = useSelected('note');",
    because: '便签的"选中"今天同时就是"在编辑哪一条"—— 那正是拍板 #1 的题面（C1 #1）。',
  },
  {
    view: 'search',
    stance: 'selects',
    kinds: ['task', 'note'],
    locus: 'apps/web/src/App.tsx',
    needle: "selection.select('note', noteId)",
    because: '搜索结果的点击写进同一个 store；它自己那条 ↑↓ 走结果数组而不是 DOM。',
  },
  {
    view: 'calendar',
    stance: 'no-rows',
    locus: 'apps/web/src/features/calendar/store.ts',
    needle: 'selected: LocalDate;',
    because: '这一面的"当前"是**某一天**（日期锚点），不是"选中一行"；把日历做成可走的是另一件事，前置是拍板 C1 #1 的延伸。',
  },
  {
    view: 'focus',
    stance: 'no-rows',
    locus: 'apps/web/src/features/focus/store.ts',
    needle: 'state: FocusState;',
    because: '计时状态机，没有"哪一项"；关联任务只由 start(taskId?) 带进来（工单 §6 明文不许把番茄页塞进列表模型）。',
  },
  {
    view: 'growth',
    stance: 'no-rows',
    locus: 'apps/web/src/features/motivation/GrowthView.tsx',
    needle: 'function heatmapLabels(',
    because: '面本身是图与卡，没有可走的实体行。',
  },
  {
    view: 'trash',
    stance: 'row-actions-only',
    locus: 'apps/web/src/features/trash/TrashView.tsx',
    needle: 'const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);',
    because: '有实体行，但行上的动作是恢复/彻底删除；confirmingId 是"哪条在二次确认"，不是"在看哪一条"（它登记在断言 G 的行 id 类别里）。',
  },
  {
    view: 'countdown',
    stance: 'row-actions-only',
    locus: 'packages/ui/src/countdown/EventBoard.tsx',
    needle: 'const [editingFor, setEditingFor] = useState<string | undefined>(undefined);',
    because:
      '卡片行上是置顶/归档/删除与**就地改**，没有"走哪一条"：整张卡的字段就在网格上，就地编辑器改的就是它自己，' +
      '所以那个 owner 是共享板的 `editingFor`（不是宿主本地态，也不在词表里 —— `event` 作为投机项已在 W1 摘掉，' +
      '依据是"没有任何一处界面会选中一条 EVENT"）。🔴 与便签那一格的区别要说清，别把两条读成同一条：' +
      'NotesView 的列表只显示标题，"在编辑哪条"**就是**"在看哪条"，所以它登记 selects；卡片网格不是。' +
      '把它升成"选中一条 EVENT ⇒ 右栏出该实体面单"属于 C1 #1 那一单（已拍，未实现），不是这条门禁的口径。',
  },
  {
    view: 'settings',
    stance: 'not-a-route',
    locus: 'apps/web/src/App.tsx',
    needle: "const contentView = view === 'settings' || view === 'search' ? settingsBaseView : view;",
    because: '设置是浮层，底下那一栏还挂着 —— 所以它没有自己的选中语义可交代。',
  },
  {
    view: 'rail:project',
    stance: 'filters',
    entity: 'project',
    locus: 'apps/web/src/features/projects/ProjectsPanel.tsx',
    needle: "onFilterWith({ kind: 'project', projectId: item.id });",
    because: '点一行清单 = 给任务列表加筛选。🔴 web 与触屏端在这里是两种语义（移动端刻意不传，ListsSection.tsx 文件头写明），那一格是 C1 #14。',
  },
  {
    view: 'rail:tag',
    stance: 'filters',
    entity: 'tag',
    locus: 'apps/web/src/features/projects/ProjectsPanel.tsx',
    needle: 'toOrganizerNodes(toTagItems(projects.tags))',
    because: '标签行与清单行走同一条 onFilterWith 通道，语义同上（C1 #14）。',
  },
];

function readViewKeys() {
  let src;
  try {
    src = readFileSync(VIEWKEY_FILE, 'utf8');
  } catch {
    fail(
      `断言 I：读不到视图全集的来源 ${path.relative(ROOT, VIEWKEY_FILE)}。\n` +
        '  换地方了还是被删了？判红而不是跳过 —— 读不到分母时，"每一面都交代过"是一句永真的话。',
    );
  }
  const m = src.match(/export type ViewKey =([\s\S]*?);/);
  if (!m) fail('断言 I：在 view-tabs.ts 里找不到 `export type ViewKey = …;` —— 视图全集的来源换地方了，先修扫描');
  const keys = [...m[1].matchAll(/'([a-z][a-z0-9-]*)'/g)].map((x) => x[1]);
  if (keys.length === 0) fail('断言 I：ViewKey 解析出 0 项 —— 解析器坏了，不是"没有视图"');
  return keys;
}

const viewKeys = readViewKeys();
const viewLoci = new Map();

// 🔴 这一块的红一律 `failures.push`（收集后一起报），不 fail() 早退：A–H 的红累积在前面，
//    一 exit 就把它们吞掉。合流产物上实测过 —— I 报 countdown 时 G 那两行 trash `busyId`
//    一行都没打，把 I 变绿后立刻出现（工单 §8.104）。只有"分母/扫描层读不到"那一类才 fail()。
for (const e of VIEW_STANCES) {
  if (viewLoci.has(e.view)) {
    failures.push(`断言 I：视图「${e.view}」被登记了两次（${viewLoci.get(e.view)} 与 ${e.stance}）—— 两个立场等于没有立场`);
  }
  viewLoci.set(e.view, e.stance);
  if (!STANCE_VOCAB.includes(e.stance)) {
    failures.push(`断言 I：视图「${e.view}」的立场「${e.stance}」不在封闭词表 ${STANCE_VOCAB.join('/')} 里`);
  }
  if (e.stance === 'selects') {
    if (!Array.isArray(e.kinds) || e.kinds.length === 0) {
      failures.push(`断言 I：「${e.view}」登记为 selects 却没报是哪几类`);
    } else {
      for (const k of e.kinds) {
        if (!vocab.includes(k)) failures.push(`断言 I：「${e.view}」登记的类别「${k}」不在选中词表 ${vocab.join('/')} 里`);
      }
    }
  } else if (e.stance === 'pending-decision' && !/C1 #\d+/.test(e.because || '')) {
    failures.push(`断言 I：「${e.view}」用 pending-decision 绕过这条，却没写明等哪一格拍板（要写 C1 #N）`);
  }
}
const unknownViews = [...viewLoci.keys()].filter((v) => !viewKeys.includes(v) && !v.startsWith('rail:'));
if (unknownViews.length > 0) {
  failures.push(
    `断言 I：名册里有 ${unknownViews.length} 个键既不是 ViewKey、也没有 rail: 前缀：${unknownViews.join(', ')} —— ` +
      `写错名字的登记不会被任何视图读到，它只会让那条视图看起来"有人交代过了"。`,
  );
}
const missingViews = viewKeys.filter((v) => !viewLoci.has(v));
if (missingViews.length > 0) {
  failures.push(
    `断言 I：视图全集有 ${viewKeys.length} 个 ViewKey，其中 ${missingViews.length} 个没对"选中"交代过立场：${missingViews.join(', ')}。\n` +
      '  新增一路由时必须写明它属于哪一档（selects / filters / row-actions-only / no-rows / not-a-route / pending-decision），\n' +
      '  并挂一条指向那一行真代码的证据 —— 这一条要挡的不是"接错了"，是"新视图没人想过这件事"。',
  );
}

let anchorHits = 0;
for (const e of VIEW_STANCES) {
  const abs = path.join(ROOT, e.locus);
  let src;
  try {
    src = stripComments(readFileSync(abs, 'utf8'));
  } catch {
    // 文件不在 ⇒ 这一条后面没法再读它（读 `undefined` 会变成 TypeError 崩栈，那是"红得不响亮"）。
    failures.push(`断言 I：「${e.view}」的证据文件 ${e.locus} 不在了 —— 判红而不是跳过（静默跳过等于这条只描述空气）`);
    continue;
  }
  if (!src.includes(e.needle)) {
    failures.push(
      `断言 I：「${e.view}」（立场 ${e.stance}）的证据 needle 在 ${e.locus} 里找不到了：\n  ${e.needle}\n` +
        '  名册的牙就长在这上面：登记还在、事实已经没了，就是过期登记。',
    );
  }
  anchorHits += 1;
  if (e.stance === 'selects') {
    for (const k of e.kinds ?? []) {
      const cap = k[0].toUpperCase() + k.slice(1);
      const re = new RegExp(`useSelected\\(['"]${k}['"]\\)|selection\\.select\\(['"]${k}['"]|active${cap}Id=`);
      if (!re.test(src)) {
        failures.push(`断言 I：「${e.view}」登记为选中 ${k}，但 ${e.locus} 里没有该类的消费形状（useSelected / selection.select / active${cap}Id=）`);
      }
    }
  } else {
    if (e.entity && vocab.includes(e.entity)) {
      failures.push(`断言 I：「${e.view}」把「${e.entity}」登记成非选中立场，而它已经在词表 ${vocab.join('/')} 里了 —— 两边必须挑一边`);
    }
    const ownFile = !e.locus.endsWith('App.tsx');
    if (ownFile) {
      const live = vocab.filter((k) => new RegExp(`useSelected\\(['"]${k}['"]\\)|selection\\.select\\(['"]${k}['"]`).test(src));
      if (live.length > 0) {
        failures.push(
          `断言 I：「${e.view}」登记的立场是 ${e.stance}，但 ${e.locus} 现在读/写 ${live.join('/')} 的选中 —— 这条登记过期了。\n` +
            '  要么它已经进了选中机制（改成 selects 并报类别），要么那段接线不该在这里。',
        );
      }
    }
  }
}
if (anchorHits === 0) fail('断言 I：名册一条证据都没落到文件上 —— 扫描层坏了，"全部成立"是假的绿');

if (failures.length > 0) {
  console.error('✗ 选中态的所有者不唯一：\n');
  for (const f of failures) console.error(f + '\n');
  console.error('  改法：读 `@heyta/app-host` 的 `selection.ts`，宿主只留 lib/selection 那一层胶水。');
  process.exit(1);
}

console.log(
  `✅ F：${FACES.length} 处渲染面各按端把选中说出来（` +
    FACES.map((f) => `${path.basename(f.file)} ${f.channel}`).join(' / ') +
    `），接选中的递送层 ${RELAYS.length} 处逐条还在递，豁免 ${TRACE_EXEMPT.length} 处的事实基础未变`,
);

console.log(
  `✅ G：宿主内 …Id 本地态 ${rowIdSeen.length} 处全部有语义登记（${ROW_ID_CLASSES.length} 类：` +
    ROW_ID_CLASSES.map((c) => `${c} ${ROW_ID_EXEMPT.filter(([, , t]) => t === c).length}`).join(' / ') +
    `），过期豁免 0 条`,
);

const readCounts = vocab.map(
  (kind) => `${kind} ${readsSeen.reduce((n, [, r]) => n + (r.includes(kind) ? 1 : 0), 0)}`,
);
console.log(
  `✅ H：${readsSeen.length} 处读选中的宿主文件各自把读到的类别喂进回落（触屏端按屏配对；` +
    `Web 端中央回落覆盖 ${[...webFed].join('/')} 且被 ${webGlueCallers.length} 处调用），` +
    `逐类读方数：${readCounts.join(' / ')}`,
);

const counts = vocab.map((kind) => `${kind} ${consumersByKind.get(kind).length}`).join(' / ');
console.log(
  `✅ 选中态只有一个所有者：${REQUIRED_STORE_INSTANCES} 份实例（${HOSTS.join(', ')}）` +
    `，宿主内本地选中态 0 处，词表定义 0 处，词表 ${vocab.length} 类全有消费者（${counts}）` +
    `，接线声明 ${declaredWires.length} 处全部用起来`,
);

console.log(
  `✅ I：视图全集 ${viewKeys.length} 个 ViewKey 全部对"选中"交代过立场（selects ${
    VIEW_STANCES.filter((e) => e.stance === 'selects').length
  } / 其余 ${VIEW_STANCES.filter((e) => e.stance !== 'selects').length}），侧栏容器手登记 ${
    VIEW_STANCES.filter((e) => e.view.startsWith('rail:')).length
  } 条，证据锚点 ${anchorHits} 条逐条还在文件里（立场词表 ${STANCE_VOCAB.length} 档）`,
);
