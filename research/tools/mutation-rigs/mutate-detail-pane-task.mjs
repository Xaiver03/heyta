#!/usr/bin/env node
/**
 * 任务面单落进那一栏（工单 §8.138）的变异臂。
 *
 * 这台问的是 §8.138 那一句不变量的**每一档各由哪一层守着**："每个字段任何时刻只有一个
 * 编辑器所有者"，以及"那一格画的是选中的那一条"。臂数由 `--list` 现量（`node 本文件 --list`），
 * 这里**不抄分档计数** —— 上一版写着"十二臂里 6 档两层都看得见"，加一臂就得重数一遍，
 * 而没人会在加的时候重数（漂移就是这么来的）。每臂的盲区/有牙都写在各臂自己的注释里。
 *
 *   A1 面单"没选中就猜第一条"        → jsdom 1 红 + e2e T1 红
 *   A2 栏里的正文框不跟着换 key       → jsdom 1 红 + e2e T2 红
 *      （上一条**没落盘的草稿**会跟着人走：标题换了而框里还是甲的内容。
 *       🔴 第一版 A2 **存活**：jsdom 那条用例在换选中时又 `mount()` 了一次，新建的 root
 *       本身就给一只新框 —— 探针把要测的坏抹掉了。改成"同一枚 root 里换 selection"之后
 *       它按预期红。这一档留在这里是因为它是本仓反复撞的那一族：**臂存活先查探针**。）
 *   A3 行尾那支换回 `<NoteEditor/>`   → jsdom 1 红（源码形状）+ e2e **T1/T2/T3 三条**红
 *      🔴 第一版只点名 T1，实测多红两条 ⇒ **改的是这一条主张，不是判据**：
 *       三只用例都按**整机**数那只正文框，而"两处可编辑"本身就是全局的坏
 *       （T3 还先撞 Playwright 的 strict mode）。这一臂顺手量到：坏在装配处时红集比坏
 *       在面单里宽。它是那条不变量的**阳性对照** —— 没有它，"两处可编辑"只活在注释里。）
 *   A4 落点布尔少一个视图             → jsdom 1 红 + **e2e 盲区**（e2e 只走列表视图）
 *   A5 徽标不判"有没有备注"           → jsdom 1 红 + **e2e 盲区**（没备注的行不画徽标，
 *       界面上没有反例可看 —— 这一档现在是**契约**不是**观感**）
 *   A6 撤掉 `deletedAt` 那道判断      → jsdom 1 红 + **e2e 盲区**（e2e 不删任务）
 *   B1 表里的落点串与生产者不同名      → jsdom 1 红（"三面同串"那条）+ e2e T3 红
 *      （🔴 jsdom 那 5 条 Enter 用例测的是自己插的假元素，它**永远看不见**真渲染里
 *       根本没有这个 testid —— 与 §8.137 的 A4 同一族）
 *   B2 栏内边距拿掉                   → **jsdom 全绿**（它没有布局）+ e2e T1 红
 *
 * ── §8.141（第二个字段：重复）四臂 ─────────────────────────────────────
 *   R1 宽档行尾还挂 `<TaskRepeat/>`    → jsdom 1 红（源码形状）+ e2e T6 红
 *   R2 自定义框 testid 改名            → jsdom 2 红 + e2e T6/T7 红
 *      （这一臂是"两层吃同一枚钩子"的**阳性对照**：它不测产品语义，测的是
 *       如果那枚钩子换了名，两层是否**同时**失去对象。答案是同时。）
 *   R3 徽标不判"有没有规则"            → jsdom 1 红 + **e2e 盲区**（同 A5：T6/T7 量的
 *       那两条任务都有规则，界面上不存在"没设重复"那一格的反例）
 *   R4 浮层外壳跟着本体搬进栏里        → jsdom 1 红（pane 级那一条）+ **e2e T10 红**
 *      🔴 本档原记"e2e 盲区"，§8.145 那一趟把它照成**有牙**：T10 数的是
 *      `pane.locator('.ht-material')` 等于 0，而注入落在同一个 pane 里 ⇒ 与在哪一格无关。
 *      同趟还把"栏里不许有 `<details>` / `.ht-material`"从三格各自的用例**合成一条 pane 级
 *      判据** —— 抄三遍时一次注入红三条，红集会被读成"判据变多了"（AGENTS §3.2 同族形状）。
 *
 * ── §8.144（第三个字段：子任务）五臂 ─────────────────────────────────
 *   S1 宽档行尾还挂 `<SubtaskPicker/>` → jsdom 1 红（源码形状）+ e2e T8 红
 *   S2 栏里那只 select 的 testid 改名   → jsdom 3 红 + e2e T8 红（**阳性对照**，见臂内注释）
 *   S3 徽标不判"有没有父"               → jsdom 1 红 + e2e T8 红（与 A5/R3 **不同档**，原因写在臂内）
 *   S4 展开机关跟着本体搬进栏里         → jsdom 1 红 + e2e T8 红（与 R4 **不同档**：壳藏东西才看得见）
 *   S5 预过滤退化成"只排除自己"         → jsdom 1 红 + e2e T8 红（T8 里"反向那一段"就是为它加的）
 *
 * ── §8.145（第四个字段：提醒）五臂 ───────────────────────────────────
 *   M1 宽档行尾还挂 `<ReminderPanel/>`  → jsdom 1 红（源码形状）+ e2e T10 红
 *   M2 宿主再叠一枚「提醒」区块头        → jsdom 1 红 + e2e T10 红（共享列表**自带**区块头）
 *   M3 徽标不判"有没有提醒"             → jsdom 1 红 + e2e T10 红
 *      （🔴 与 A5/R3 **不是同一档**：T10 里刻意多建了一条**没挂提醒**的任务，
 *       整机判据"徽标等于 1"才有对象可数。A5/R3 那一趟没有这一条，所以它们是盲区。
 *       规律写在 S3 那里：**"盲区"取决于判据怎么写，不取决于这一档是什么**。）
 *   M4 玻璃浮层跟着本体搬进栏里          → jsdom 1 红 + e2e T10 红（与 R4 **同一档**：
 *       两条判据都是 pane 级的，注入在哪一格都红）
 *   M5 展开机关跟着本体搬进栏里          → jsdom 1 红 + e2e T10 红（同 S4：`<details>` 收起时
 *       里面**不画**，`toBeVisible()` 挡不住）
 *
 * ── §8.147（第六个字段：清单 + 标签）六臂 ───────────────────────────
 *   O1 宽档行尾仍挂编辑本体（两处可编辑）  → jsdom 1 红（源码形状）+ e2e T14 红
 *   O2 窄档不回落（恒只剩只读 chip）        → jsdom 1 红（同一枚布尔的另一侧）+ e2e **T15** 红
 *   O3 宿主在栏里再叠「清单」区块头          → jsdom 1 红 + e2e T14 红（这一格自带两个头）
 *   O4 展开机关跟着本体搬进栏里             → jsdom 1 红 + e2e T14 红
 *   O5 玻璃浮层跟着本体搬进栏里             → jsdom 1 红 + e2e **T10** 红（同 D4：pane 级
 *       那条在 e2e 层只有一个消费者）
 *   O6 TagChips 不判有没有标签（零标签占位） → jsdom 1 红 + e2e T14 红（"起始态不许有 chip"
 *       那一档就是这一臂的消费者；没有它，"勾了才长出"在占位实现下照样为真）
 *
 * ── §8.146（第五个字段：截止）五臂 ─────────────────────────────────
 *   D1 宽档行尾还挂 `<DueEditor/>`（两处可编辑）→ jsdom 1 红（源码形状）+ e2e T12 红
 *   D2 栏里那一支少挂 key                → jsdom 1 红 + e2e T12 红（这一格带本地 state）
 *   D3 展开机关跟着本体搬进栏里           → jsdom 1 红 + e2e T12 红（同 S4/M5）
 *   D4 玻璃浮层跟着本体搬进栏里           → jsdom 1 红 + e2e **T10** 红（见臂内：pane 级判据
 *       在 e2e 层只有一个消费者，塞哪一格都红那一格）
 *   D5 栏里那一格没有区块头               → jsdom 1 红 + e2e T12 红（宿主给的标题，与提醒相反）
 *
 * ⚠️ 载体是 `vite preview` + `apps/web/dist`（`e2e/playwright.detail-pane.config.ts`，端口 4371），
 *    所以**每一臂都必须重打 `apps/web`**（§7 第 27 条那一族：改了源码没重建 ⇒ 被测的那一份
 *    里根本没有变异 ⇒ 判据会被读成"没有牙"）。jsdom 那层由 vitest 直接读源码，不需要构建。
 *
 * 跑法（仓库根）：
 *   node research/tools/mutation-rigs/mutate-detail-pane-task.mjs --list   # 臂名册 + 每臂点名的红集
 *   node research/tools/mutation-rigs/mutate-detail-pane-task.mjs          # 全部臂
 *   node research/tools/mutation-rigs/mutate-detail-pane-task.mjs A3 B1    # 只点名那两臂
 * ⚠️ 它会占 4371 端口、起 Chromium，且**原地改下面这些源文件**（收尾逐文件复原并核对 md5；
 *    清单由 `FILES` 现量，别在这里抄枚数）：
 *    `apps/web/src/features/tasks/{TaskDetailCard,NoteEditor,TaskRepeat,SubtaskPicker,TaskOrganizer}.tsx`、
 *    `apps/web/src/features/reminders/ReminderPanel.tsx`、
 *    `apps/web/src/App.tsx`、`apps/web/src/lib/keyboard-cursor.ts`、`apps/web/src/styles/app/base.css`。
 *    跑之前确认这些文件没有别人的在飞改动。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const CARD = 'apps/web/src/features/tasks/TaskDetailCard.tsx';
const NOTE = 'apps/web/src/features/tasks/NoteEditor.tsx';
const APP = 'apps/web/src/App.tsx';
const CURSOR = 'apps/web/src/lib/keyboard-cursor.ts';
const CSS = 'apps/web/src/styles/app/base.css';
const REPEAT = 'apps/web/src/features/tasks/TaskRepeat.tsx';
const SUBTASK = 'apps/web/src/features/tasks/SubtaskPicker.tsx';
const REMINDER = 'apps/web/src/features/reminders/ReminderPanel.tsx';
const ORG = 'apps/web/src/features/tasks/TaskOrganizer.tsx';
const JSDOM_SPECS = ['tests/task-detail-card.spec.tsx', 'tests/keyboard-cursor.spec.tsx'];
const E2E_SPEC = 'tests/detail-pane-task.spec.ts';
const BIN = (rel) => path.join(ROOT, 'apps/web', 'node_modules', '.bin', rel);

const ARMS = [
  {
    name: 'A1 面单"没选中就猜第一条"',
    file: CARD,
    from: `  const selectedId = useSelected('task');`,
    to: `  const selectedId = useSelected('task') ?? Object.keys(store.entities.tasks)[0] ?? null;`,
    expectJs: ['未选中却画了面单'],
    expectE: ['T1'],
  },
  {
    name: 'A2 栏里的正文框不跟着换 key（上一条的未落盘草稿跟着人走）',
    file: CARD,
    from: `      <NoteField
        key={task.id}
        task={task}`,
    to: `      <NoteField
        task={task}`,
    expectJs: ['上一条的未落盘草稿'],
    expectE: ['T2'],
  },
  {
    name: 'A3 行尾那支换回 `<NoteEditor/>`（备注长出第二个编辑器）',
    file: APP,
    from: `<NoteBadge task={task} />`,
    to: `<NoteEditor task={task} onSetNote={() => undefined} />`,
    expectJs: ['栏里那一支与行尾那两支'],
    /* 🔴 第一版只点名 T1，实测红集是 T1/T2/T3 三条 ⇒ **改的是这一条主张，不是判据**：
       三只用例都用 `getByTestId('task-note-input')` 取整机计数，而"两处可编辑"这件事
       本身就是全局的（T3 那条 `toHaveValue` 还会先撞 Playwright 的 strict mode）。
       顺手量到的有用读数：这一臂的红集比 A1/A2 宽，因为坏在**装配处**而不是在面单里。 */
    expectE: ['T1', 'T2', 'T3'],
  },
  {
    name: 'A4 落点布尔少一个视图（时间线那一面按 Enter 落空）',
    file: APP,
    from: `(contentView === 'tasks' || contentView === 'quadrant' || contentView === 'timeline');`,
    to: `(contentView === 'tasks' || contentView === 'quadrant');`,
    expectJs: ['这枚布尔只有一个定义处'],
    expectE: [],
  },
  {
    name: 'A5 徽标不判"有没有备注"（record 档变成常驻）',
    file: NOTE,
    from: `  if (!hasNote) return null;`,
    to: `  if (!hasNote) return <span className="ht-chip ht-chip--on" data-testid={'task-note-badge-' + task.id} />;`,
    expectJs: ['没备注 ⇒ 不占位'],
    expectE: [],
  },
  {
    name: 'A6 撤掉 `deletedAt` 那道判断（任务删了、栏里还画着它）',
    file: CARD,
    from: `picked !== undefined && picked.deletedAt === undefined ? picked : undefined`,
    to: `picked`,
    expectJs: ['那条任务在别处被删掉'],
    expectE: [],
  },
  {
    name: 'B1 表里的落点串与生产者不同名（只有真渲染知道）',
    file: CURSOR,
    from: `    tasks: { kind: 'task', prefix: 'task-item', enterTarget: '[data-testid="task-note-input"]' },`,
    to: `    tasks: { kind: 'task', prefix: 'task-item', enterTarget: '[data-testid="task-note-box"]' },`,
    expectJs: ['表里五面', '任务那一族的落点是'],
    expectE: ['T3'],
  },
  {
    name: 'B2 栏内边距拿掉（控件贴住窗口边，圆角被裁）',
    file: CSS,
    append: `
/* 变异臂 B2（本文件跑完即复原）：把这一格的栏内间距抹掉。 */
.ht-app__detail-task {
  --dp-arm-b2: 1;
  padding: 0;
}
`,
    expectJs: [],
    expectE: ['T1'],
    cssMarker: '--dp-arm-b2:1',
  },
  /* ── §8.141「重复」这一字段的两臂 + 两档盲区 ─────────────────────────
     这一单搬的是**第二个**字段，所以它守的东西和 §8.138 不是同一件：
     §8.138 立的是不变量，§8.141 要证的是"同一套纪律第二次也没漏"。     */
  {
    name: 'R1 宽档行尾那支还挂 `<TaskRepeat/>`（重复长出第二个编辑器）',
    file: APP,
    from: `<RepeatChip task={task} now={store.now} />`,
    to: `<TaskRepeat task={task} now={store.now} onSetRepeat={() => undefined} />`,
    expectJs: ['重复两处可编辑'],
    /* T6 两条都撞：`task-repeat-summary` 在宽档必须 count 0，而整页那只自定义输入框
       必须**在栏里**（行尾再长一只就变成两只）。 */
    expectE: ['T6'],
  },
  {
    name: 'R2 自定义框的 testid 改名（两层不再吃同一枚钩子）',
    file: REPEAT,
    from: `data-testid="task-repeat-custom-input"`,
    to: `data-testid="task-repeat-rule-input"`,
    expectJs: ['整栏只有一份', '自定义 RRULE 输入框没画出来'],
    expectE: ['T6', 'T7'],
  },
  {
    name: 'R3 徽标不判"有没有重复规则"（record 档变成常驻）',
    file: REPEAT,
    from: `  if (chipText === undefined) return null;`,
    to: `  if (chipText === undefined) return <span style={chipStyle} data-testid="task-chip-repeat" />;`,
    expectJs: ['没设重复却占了位'],
    /* 🔴 e2e **盲区**（与 A5 同一档）：T6/T7 量的那两条任务都**有**规则，界面上
       没有"没设重复"那一格可看 ⇒ 反例不存在。这一档现在是**契约**不是**观感**。 */
    expectE: [],
  },
  {
    name: 'R4 浮层外壳跟着编辑本体搬进栏里（栏里漂着一块板子）',
    file: CARD,
    from: `      <RepeatField
        key={\`repeat-\${task.id}\`}
        task={task}
        now={store.now}
        onSetRepeat={(rule) => {
          void store.setRepeat(task.id, rule);
        }}
      />`,
    to: `      <div className="ht-material" style={{ position: 'absolute' }}>
        <RepeatField
          key={\`repeat-\${task.id}\`}
          task={task}
          now={store.now}
          onSetRepeat={(rule) => {
            void store.setRepeat(task.id, rule);
          }}
        />
      </div>`,
    /* 🔴 两条期望都被 §8.145 这一趟**改写了**，改的是主张不是判据：
       ① jsdom 从"1 条（§8.141 那一格）"变成"1 条（pane 级那一条）"—— 因为"栏里不许有
          浮层外壳"量的对象是整个 pane，四格各抄一遍时**任何一格**被注入都会同时红四条；
          合成一条之后一次注入红一条（这条合成就是本臂头一趟 NOT_AS_EXPECTED 照出来的）。
       ② e2e 从**盲区**变成 T10 有牙：T10 新加了 `pane.locator('.ht-material')` 等于 0，
          而注入落点在同一个 pane 里 ⇒ 与注入在哪一格无关。 ⇒ 又一例"盲区取决于判据怎么写"。 */
    expectJs: ['不许有行尾的两层外壳'],
    expectE: ['T10'],
  },

  /* ── §8.144（第三个字段：子任务）五臂 ──────────────────────────────── */
  {
    name: 'S1 宽档行尾还挂 `<SubtaskPicker/>`（同一字段两处可编辑）',
    file: APP,
    from: `<SubtaskBadge task={task} />`,
    to: `<SubtaskPicker task={task} onSetParent={(parentId) => store.setParent(task.id, parentId)} />`,
    expectJs: ['子任务两处可编辑'],
    expectE: ['T8'],
  },
  {
    name: 'S2 栏里那只 select 的 testid 改名（两层不再吃同一枚钩子）',
    file: SUBTASK,
    from: 'data-testid={`subtask-select-${task.id}`}',
    to: 'data-testid={`subtask-parent-${task.id}`}',
    expectJs: ['整栏只有一只', '候选的预过滤在栏里', '真的写进 op-log'],
    /* 🔴 这一臂是 §8.144 这一族的**阳性对照**（与 R2 同一档）：它不测产品语义，测的是
       两层吃的是不是同一枚钩子。答案是**同时失去对象**（jsdom 3 红 + e2e T8 红）。
       ⚠️ T9 不在红集里，而且**不是盲区**：它走的是 `aria-label`（界面自己声明的可访问名），
       换 testid 动不到它 —— 同一格里两种定位通道各自独立，这正是要记下来的差别。 */
    expectE: ['T8'],
  },
  {
    name: 'S3 徽标不判"有没有父"（record 档变成常驻）',
    file: SUBTASK,
    from: `  if (parent === undefined) return null;`,
    to: `  if (parent === undefined) return <span className="ht-chip" data-testid={\`task-subtask-badge-\${task.id}\`} />;`,
    expectJs: ['顶级任务却占了位'],
    /* 🔴 与 A5/R3 **不是同一档**：那两臂 e2e 盲区，这一臂 T8 会红 ——
       因为 T8 的徽标判据是**整机数** `[data-testid^="task-subtask-badge-"]` 等于 1，
       而这一趟另一条顶级任务多长出一枚 ⇒ 数到 2。
       ⇒ 一般规律：**"盲区"取决于判据怎么写，不取决于这一档是不是徽标**。
       A5/R3 那两臂写的是"某一条任务上的徽标在不在"，所以看不见；这里写的是"整页几枚"，就看见了。 */
    expectE: ['T8'],
  },
  {
    name: 'S4 行尾的展开机关跟着编辑本体搬进栏里（栏里那一格自己收起来了）',
    file: CARD,
    from: `      <SubtaskField
        key={\`subtask-\${task.id}\`}
        task={task}
        onSetParent={(parentId) => store.setParent(task.id, parentId)}
      />`,
    to: `      <details>
        <SubtaskField
          key={\`subtask-\${task.id}\`}
          task={task}
          onSetParent={(parentId) => store.setParent(task.id, parentId)}
        />
      </details>`,
    expectJs: ['不许有行尾的两层外壳'],
    /* ⚠️ 与 R4 **不是同一档**：R4 套的是一块 `<div>` 壳（DOM 多一层，只有数类名那条判据看得见），
       这里套的是 `<details>` —— 收起时里面**不画**，于是 T8 那句 `toBeVisible()` 直接红。
       记下来是因为它给了一条一般规律：**"多套一层壳"是否可观察，取决于那层壳会不会藏东西**。
       🔴 T10 **不红**（本趟读数）：注入的 `<details>` 不带 `ht-compose--popover` 类，
       而 T10 那两句分别数的是 `.ht-material` 与 `details.ht-compose--popover` ⇒ 都躲得过。
       ⇒ 同一格里"壳"有两种可观察性，别把一条臂的红集外推给另一条。 */
    expectE: ['T8'],
  },
  {
    name: 'S5 候选的预过滤退化成"排除自己"（后代进了候选 ⇒ 界面上能造出环）',
    file: SUBTASK,
    from: `        .filter((t2) => canSetParent(allTasks, task.id, t2.id))`,
    to: `        .filter((t2) => t2.id !== task.id || canSetParent(allTasks, task.id, t2.id))`,
    /* `||` 那一支不是笔误：它让"自己"仍被 `canSetParent` 挡掉（同一条 ⇒ false），
       而"后代"被前一支放进来 ⇒ 正好是"用土办法预过滤"的行为，且不引入未使用导入。 */
    expectJs: ['候选的预过滤在栏里'],
    /* 🔴 T8 有牙靠的是**反向那一段**（换选 甲 之后要求 乙 不在候选里）：
       只量"自己不在候选里"的话，这一臂在 e2e 层是盲区 —— 而 `id !== task.id` 那种土办法
       恰好过得了正向那一半。这就是 T8 里多那一段的全部理由。 */
    expectE: ['T8'],
  },

  /* ── §8.145（第四个字段：提醒）五臂 ─────────────────────────────────
     这一族的落点在**三处**：`App.tsx` 的装配、`TaskDetailCard` 的栏内、
     `ReminderPanel` 自己的 record 判定。所以臂也按这三处分。          */
  {
    name: 'M1 宽档行尾还挂 `<ReminderPanel/>`（提醒长出第二个编辑器）',
    file: APP,
    from: `<ReminderBadge task={task} />`,
    to: `<ReminderPanel task={task} />`,
    expectJs: ['提醒两处可编辑'],
    /* T10 两条都撞：整页那份 `reminder-list-*` 必须只有一份（行尾再长一份就是两份），
       而 `details.ht-compose--popover` 必须 count 0。 */
    expectE: ['T10'],
  },
  {
    name: 'M2 宿主再叠一枚「提醒」区块头（共享列表自带，于是同一格说了两遍）',
    file: CARD,
    from: `      <ReminderField task={task} />`,
    to: `      <h3 style={blockLabelStyle}>{t('reminder.title')}</h3>
      <ReminderField task={task} />`,
    expectJs: ['「提醒」区块头不止一处'],
    /* 🔴 这一臂钉的是本单**唯一一处"少写 vs 多写"**的坏：其余各臂都是"撤掉某道判断"，
       这一臂是"多加一枚标题"。判据必须写成**存在性计数**（"说这个词的地方只许有一处"），
       写成"标题在不在"就永远抓不到多写。 */
    expectE: ['T10'],
  },
  {
    name: 'M3 徽标不判"有没有提醒"（record 档变成常驻）',
    file: REMINDER,
    from: `  if (count === 0) return null;`,
    to: `  if (count === 0) return <span className="ht-chip" data-testid={\`task-reminder-badge-\${task.id}\`} />;`,
    expectJs: ['零条提醒却占了位'],
    /* 🔴 与 A5/R3 **不是同一档**（那两臂 e2e 盲区）：T10 里多建了一条**没挂提醒**的任务，
       整机判据"徽标 count 等于 1"于是有了可数的反例 ⇒ 这一臂会红。
       一般规律仍与 S3 同一条：**盲区取决于判据怎么写，不取决于这一档是什么**。
       而"要不要为一条臂多建一条夹具任务"这件事，答案是建 —— A5/R3 那两臂的盲区本来是可以不存在的。 */
    expectE: ['T10'],
  },
  {
    name: 'M4 玻璃浮层跟着编辑本体搬进栏里（栏里漂着一块板子）',
    file: CARD,
    from: `      <ReminderField task={task} />`,
    to: `      <div className="ht-compose-panel ht-material">
        <ReminderField task={task} />
      </div>`,
    expectJs: ['不许有行尾的两层外壳'],
    /* 与 R4 同一档（同一块 pane 级判据、同一个 T10 牙）：注入带 `ht-material`，
       而 T10 数的是 `pane.locator('.ht-material')` 等于 0 ⇒ 与注入落在哪一格无关。 */
    expectE: ['T10'],
  },
  {
    name: 'M5 行尾的展开机关跟着编辑本体搬进栏里（栏里那一格自己收起来了）',
    file: CARD,
    from: `      <ReminderField task={task} />`,
    to: `      <details>
        <ReminderField task={task} />
      </details>`,
    expectJs: ['不许有行尾的两层外壳'],
    /* 同 S4：`<details>` 收起时里面**不画**，T10 那句 `toBeVisible()` 直接红。 */
    expectE: ['T10'],
  },

  /* ── §8.146（第五个字段：截止）五臂 ────────────────────────────────
     这一格与前四格**不同形**（宽档行尾不留徽标），所以臂的形状也不同：
     D1 打的不是"徽标 vs 编辑器"，而是"宿主那一支到底读不读同一枚布尔"。   */
  {
    name: 'D1 宽档行尾还挂着 `<DueEditor/>`（截止长出第二个编辑器）',
    file: APP,
    from: `          {taskPaneInColumn ? null : (
            <DueEditor`,
    to: `          {(taskPaneInColumn && false) ? null : (
            <DueEditor`,
    expectJs: ['截止两处可编辑'],
    /* 两条都撞 T12：整页那份 `date-picker` 数到 2，而行尾那颗 `due-editor-summary` 又在。 */
    expectE: ['T12'],
  },
  {
    name: 'D2 栏里那一支少挂 key（上一条**浏览到的那个月**跟着人走）',
    file: CARD,
    from: `      <DueField
        key={\`due-\${task.id}\`}
        task={task}`,
    to: `      <DueField
        task={task}`,
    expectJs: ['栏里还停在上一条浏览到的那个月'],
    /* 🔴 与 A2（备注那一格的同一档）不同：A2 头一趟**存活**过，因为探针自己 `mount()` 了
       一次新 root 把坏抹掉了。这一臂两层的靶子都是"同一枚 root 里换选中"，
       jsdom 那三条与 T12 最后那一段都照这个形状写。 */
    expectE: ['T12'],
  },
  {
    name: 'D3 行尾的展开机关跟着编辑本体搬进栏里（栏里那一格自己收起来了）',
    file: CARD,
    from: `      <DueField
        key={\`due-\${task.id}\`}
        task={task}
        now={store.now}
        onSetDueDate={(due) => {
          void store.setDueDate(task.id, due);
        }}
      />`,
    to: `      <details>
        <DueField
          key={\`due-\${task.id}\`}
          task={task}
          now={store.now}
          onSetDueDate={(due) => {
            void store.setDueDate(task.id, due);
          }}
        />
      </details>`,
    expectJs: ['不许有行尾的两层外壳'],
    expectE: ['T12'],
  },
  {
    name: 'D4 玻璃浮层跟着编辑本体搬进栏里（栏里漂着一块板子）',
    file: CARD,
    from: `      <DueField
        key={\`due-\${task.id}\`}
        task={task}
        now={store.now}
        onSetDueDate={(due) => {
          void store.setDueDate(task.id, due);
        }}
      />`,
    to: `      <div className="ht-compose-panel ht-material">
        <DueField
          key={\`due-\${task.id}\`}
          task={task}
          now={store.now}
          onSetDueDate={(due) => {
            void store.setDueDate(task.id, due);
          }}
        />
      </div>`,
    expectJs: ['不许有行尾的两层外壳'],
    /* ⚠️ 红集里出现 T10 不是笔误：pane 级那条"栏里不许有 `.ht-material`"在 e2e 层的**唯一
       消费者就是 T10**（一条不变量一个所有者），所以往**任何一格**里塞这块壳都红 T10。
       这一臂顺手把那条纪律的射程量出来了：它是**整栏**的，不是提醒那一格的。 */
    expectE: ['T10'],
  },
  {
    name: 'D5 栏里那一格没有区块头（共享 DatePicker 不自带，宿主漏给）',
    file: CARD,
    from: `      <h3 style={blockLabelStyle}>{t('web.due.trigger')}</h3>
      <DueField`,
    to: `      <DueField`,
    expectJs: ['「截止」区块头在栏里不是恰好一处'],
    expectE: ['T12'],
  },
  /* ── §8.147（第六个字段：清单 + 标签）六臂 ────────────────────────────
     这一格的形状与前五格有一处不同：**留下的那半是 chip，不是"整块不画"**
     （标签在共享层没有对应槽），所以 O1/O2 两支分别打在三元表达式的两侧 ——
     少任何一侧，"两处可编辑"或"窄档归不了类"就没人守。 */
  {
    name: 'O1 宽档行尾仍挂着整理的编辑本体（同一字段两处可编辑）',
    file: APP,
    from: `          {taskPaneInColumn ? (
            <TagChips task={task} />
          ) : (`,
    to: `          {false ? (
            <TagChips task={task} />
          ) : (`,
    expectJs: ['宿主两支读同一枚布尔'],
    /* 栏里那一份照旧在 ⇒ 整页出现两只清单下拉，T14 那条"只有一份"当场红。 */
    expectE: ['T14'],
  },
  {
    name: 'O2 窄档不回落（行尾恒只剩只读 chip ⇒ 那一档根本归不了类）',
    file: APP,
    from: `          {taskPaneInColumn ? (
            <TagChips task={task} />
          ) : (`,
    to: `          {true ? (
            <TagChips task={task} />
          ) : (`,
    expectJs: ['宿主两支读同一枚布尔'],
    expectE: ['T15'],
  },
  {
    name: 'O3 宿主在栏里给整理再叠一枚「清单」区块头（同一个词说两遍）',
    file: CARD,
    from: `      <OrganizerField
        task={task}`,
    // ⚠️ 这里是**变异夹具**，字面量「清单」不会进任何提交物（收尾按 md5 复原）。
    // 写成字面量而不是 `t(...)` 是因为这一臂要量的正是"多出来一个区块头"，
    // 而词条里那句带参数（渲染出来不是 exact 的「清单」，探针就抓不到了）。
    to: `      <h3 style={blockLabelStyle}>清单</h3>
      <OrganizerField
        task={task}`,
    expectJs: ['「清单」「标签」各恰好一处'],
    expectE: ['T14'],
  },
  {
    name: 'O4 行尾的展开机关跟着编辑本体搬进栏里（栏里那一格自己收起来了）',
    file: CARD,
    from: `      <OrganizerField
        task={task}
        onMoveToProject={(projectId) => {
          void store.moveToProject(task.id, projectId);
        }}
        onSetTags={(tagIds) => {
          void store.setTags(task.id, tagIds);
        }}
      />`,
    to: `      <details>
        <OrganizerField
          task={task}
          onMoveToProject={(projectId) => {
            void store.moveToProject(task.id, projectId);
          }}
          onSetTags={(tagIds) => {
            void store.setTags(task.id, tagIds);
          }}
        />
      </details>`,
    expectJs: ['不许有行尾的两层外壳'],
    expectE: ['T14'],
  },
  {
    name: 'O5 玻璃浮层跟着编辑本体搬进栏里（栏里漂着一块板子）',
    file: CARD,
    from: `      <OrganizerField
        task={task}
        onMoveToProject={(projectId) => {
          void store.moveToProject(task.id, projectId);
        }}
        onSetTags={(tagIds) => {
          void store.setTags(task.id, tagIds);
        }}
      />`,
    to: `      <div className="ht-compose-panel ht-material">
        <OrganizerField
          task={task}
          onMoveToProject={(projectId) => {
            void store.moveToProject(task.id, projectId);
          }}
          onSetTags={(tagIds) => {
            void store.setTags(task.id, tagIds);
          }}
        />
      </div>`,
    expectJs: ['不许有行尾的两层外壳'],
    /* 与 D4 同一档读数：pane 级那条"栏里不许有 `.ht-material`"在 e2e 层的唯一消费者
       是 T10（一条不变量一个所有者），往整理这一格塞壳也红在 T10 身上。 */
    expectE: ['T10'],
  },
  {
    name: 'O6 TagChips 不判"有没有标签"（零标签也占一位）',
    file: ORG,
    from: `  if (assignedTags.length === 0) return null;`,
    to: `  if (assignedTags.length === 0)
    return (
      <span style={chipStyle} data-testid="task-chip-tag" aria-hidden="true">
        <TagIcon size={CHIP_ICON_SIZE} aria-hidden="true" />
      </span>
    );`,
    expectJs: ['TagChips 是只读的'],
    /* T14 里那条"起始态行上不该有 chip"就是这一臂的消费者 —— 没有它，
       "勾了标签才长出 chip"在"一直占位"的实现下照样为真（假绿）。 */
    expectE: ['T14'],
  },
];

const FILES = [CARD, NOTE, APP, CURSOR, CSS, REPEAT, SUBTASK, REMINDER, ORG];
const orig = new Map(FILES.map((f) => [f, readFileSync(path.join(ROOT, f), 'utf8')]));
const md5 = (s) => createHash('md5').update(s).digest('hex');
const origMd5 = new Map([...orig].map(([f, s]) => [f, md5(s)]));

/**
 * `--list`：把臂名册打出来就退出。
 *
 * 存在的理由和电池那枚 `--list` 同一个：**臂数是会漂的值**。文件头以前写着
 * "十二臂里 6 档两层都看得见"，加一臂就得回头重数一次 —— 而加臂的人不会重数，
 * 于是那句话在下一笔提交里就变成一条假主张。现在它是一条现量命令。
 * 顺带把每臂点名的红集打出来，"哪些臂是盲区"不必读源码。
 */
if (process.argv.includes('--list')) {
  for (const a of ARMS) {
    console.log(
      `${a.name.split(' ')[0]}\t${a.file}\tjsdom 点名 ${String(a.expectJs.length)} 条\te2e ${a.expectE.length === 0 ? '盲区（成立）' : `点名 ${a.expectE.join('/')}`}`,
    );
  }
  console.log(`ARMS=${String(ARMS.length)}`);
  process.exit(0);
}

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, {
    cwd: path.join(ROOT, cwd),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 128 * 1024 * 1024,
  });
  return { rc: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
};

/**
 * vitest 与 Playwright 的汇总行**不能共用一个正则**（Playwright 打 `  5 passed (…)`，
 * 行首没有 `Tests` ⇒ 永远读到 -1，于是"基线不干净"那条恒不成立 = 一条永远通过的基线）。
 */
const tallyVitest = (out) => {
  const line = (out.match(/^[ \t]*Tests[ \t].*$/m) || [''])[0].trim();
  return {
    line,
    passed: Number(/(\d+) passed/.exec(line)?.[1] ?? -1),
    failed: Number(/(\d+) failed/.exec(line)?.[1] ?? -1),
  };
};

const tallyPlaywright = (out) => {
  const grab = (word) => {
    const hits = [...out.matchAll(new RegExp(`^[ \\t]*(\\d+) ${word}(?:[ \\t(]|$)`, 'gm'))];
    return hits.length === 0 ? -1 : Number(hits[hits.length - 1][1]);
  };
  return {
    passed: grab('passed'),
    failed: grab('failed'),
    line: `passed=${String(grab('passed'))} failed=${String(grab('failed'))}`,
  };
};

/** 产物摘要：证明注入真的进了 `dist`，而不只是进了源码。 */
const distDigest = () => {
  const root = path.join(ROOT, 'apps/web/dist');
  const walk = (dir, prefix = '') => {
    const acc = [];
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = `${prefix}/${name}`;
      if (statSync(full).isDirectory()) acc.push(...walk(full, rel));
      else acc.push(`${rel}:${md5(readFileSync(full))}`);
    }
    return acc;
  };
  return createHash('sha256').update(walk(root).join('|')).digest('hex').slice(0, 16);
};

const builtCss = () => {
  const dir = path.join(ROOT, 'apps/web/dist/assets');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(path.join(dir, f), 'utf8'))
    .join('')
    .replace(/\s+/g, '');
};

const build = () => {
  const t = run(BIN('tsc'), ['-b'], 'apps/web');
  if (t.rc !== 0) return { rc: t.rc, out: `tsc -b 失败：\n${t.out.slice(-1500)}` };
  return { rc: 0, out: run(BIN('vite'), ['build'], 'apps/web').out };
};

const jsdom = () => {
  const r = run(BIN('vitest'), ['run', ...JSDOM_SPECS], 'apps/web');
  return { ...tallyVitest(r.out), rc: r.rc, out: r.out };
};

const e2e = () => {
  const r = run(
    path.join(ROOT, 'e2e', 'node_modules', '.bin', 'playwright'),
    ['test', '-c', 'playwright.detail-pane.config.ts', E2E_SPEC],
    'e2e',
  );
  return { ...tallyPlaywright(r.out), rc: r.rc, out: r.out };
};

const restore = () => {
  for (const [f, s] of orig) writeFileSync(path.join(ROOT, f), s);
};

const fail = (msg) => {
  restore();
  console.log(`VERDICT=PROBE_BROKEN ${msg}`);
  process.exit(2);
};

/** Playwright 失败行的标题（`… › T1 选中一条 ⇒ …`）。
 *  ⚠️ 必须容得下用例名前面那枚 `🔴`（T3/T4/T5 的名字就以它开头）—— 第一版不容，
 *      于是 B1 那一趟明明 `failed=1` 却打印"红集=(无)"，红被读成了"没有红"。 */
const titlesOf = (out, prefix) => [
  ...new Set(
    [...out.matchAll(new RegExp(`✘[^\\n]*?›\\s*(?:[\\u{1F300}-\\u{1FAFF}✅⚠️]\\s*)?(${prefix}\\d[^\\n]*?)\\s*$`, 'gmu'))].map(
      (m) => (m[1] ?? '').trim().slice(0, 24),
    ),
  ),
];
/** 一条"该红几条"的对账：红的标题集合必须**逐条等于**点名那几条。 */
const redSetMatches = (out, prefix, expected) => {
  const titles = titlesOf(out, prefix);
  return (
    titles.length === expected.length &&
    expected.every((p) => titles.some((t) => t.startsWith(p))) &&
    titles.every((t) => expected.some((p) => t.startsWith(p)))
  );
};

// ── 基线：两层都必须绿，否则臂台没有资格判红 ─────────────────────────
for (const [f, s] of orig) {
  if (md5(s) !== origMd5.get(f)) fail(`基线读取时 ${f} 就变了`);
}
const b = build();
if (b.rc !== 0) fail(`干净态打不出包：\n${b.out.slice(-1500)}`);
const cleanDigest = distDigest();
const bj = jsdom();
if (bj.rc !== 0 || bj.passed < 70) fail(`干净态 jsdom 层不干净（要 >=70 passed）：${bj.line}`);
const be = e2e();
if (be.rc !== 0 || be.passed < 15 || be.failed > 0) {
  fail(
    `干净态 e2e 层不干净（要 >=15 passed / 0 failed）：${be.line}｜红集=${titlesOf(be.out, 'T').join(' ｜ ')}`,
  );
}
console.log(`基线：jsdom=${bj.line}｜e2e=${be.line}（T1..T15）｜dist=${cleanDigest}`);

/* 只跑点名的臂：`node … A3 B1`。存在的理由是**改完一条主张之后不必把八臂全部重跑** ——
   否则"改臂"这个动作的成本会把人推回去改判据（那才是真正要避免的）。
   基线与收尾复原**不受影响**：臂台照旧先验两层都绿、跑完照旧逐文件核 md5。 */
const ONLY = process.argv.slice(2).map((a) => a.toUpperCase());
const SELECTED =
  ONLY.length === 0
    ? ARMS
    : ARMS.filter((a) => ONLY.includes(a.name.split(' ')[0].toUpperCase()));
if (SELECTED.length === 0) {
  fail(
    `点名 ${ONLY.join(',')} 一枚都没匹配上（臂名=${ARMS.map((a) => a.name.split(' ')[0]).join('/')}）`,
  );
}
if (SELECTED.length !== ARMS.length) {
  console.log(
    `⚠️ 只跑 ${SELECTED.map((a) => a.name.split(' ')[0]).join('/')}（其余 ${String(ARMS.length - SELECTED.length)} 臂本轮没有读数，写进文档时不许当成全绿）`,
  );
}

let ok = 0;
const bad = [];
for (const arm of SELECTED) {
  const source = orig.get(arm.file);
  if (arm.append !== undefined) {
    writeFileSync(path.join(ROOT, arm.file), source + arm.append);
  } else {
    const hits = source.split(arm.from).length - 1;
    if (hits !== 1) {
      fail(
        `${arm.name}：源码里 \`from\` 那段命中 ${String(hits)} 次（要恰好 1 次）⇒ 0 次是臂打在不存在的地方，>1 次是 \`replace\` 只改第一处、可能改到的正是注释`,
      );
    }
    writeFileSync(path.join(ROOT, arm.file), source.replace(arm.from, arm.to));
  }

  const mb = build();
  if (mb.rc !== 0) {
    fail(`${arm.name}：变异态打不出包（注入不该导致构建失败）：\n${mb.out.slice(-1200)}`);
  }
  const mutated = distDigest();
  if (mutated === cleanDigest) {
    restore();
    fail(`${arm.name}：产物与干净态逐字节相同 ⇒ 注入没进 dist，两腿读数都无意义（§7 第 27 条那一族）`);
  }
  if (arm.cssMarker !== undefined && !builtCss().includes(arm.cssMarker.replace(/\s+/g, ''))) {
    restore();
    fail(
      `${arm.name}：产物 CSS 里找不到那枚标记 ⇒ 注入没有落到产物（被层叠吃掉 / 被压缩改写），这种臂会被读成"判据没牙"`,
    );
  }

  const mj = jsdom();
  const me = e2e();
  const jsBlind = mj.failed <= 0 && mj.passed === bj.passed;
  const eBlind = me.failed <= 0 && me.passed === be.passed;
  const jsOk =
    arm.expectJs.length === 0
      ? jsBlind
      : mj.rc !== 0 &&
        mj.failed === arm.expectJs.length &&
        arm.expectJs.every((p) => mj.out.includes(p));
  const eOk =
    arm.expectE.length === 0
      ? eBlind
      : me.rc !== 0 && redSetMatches(me.out, 'T', arm.expectE) && me.failed === arm.expectE.length;

  console.log(`── ${arm.name}`);
  console.log(
    `   jsdom：${mj.line} rc=${mj.rc} → ${arm.expectJs.length === 0 ? (jsBlind ? '盲区（成立）' : '也抓到了') : `应红 ${arm.expectJs.length} 条：${arm.expectJs.join('/')}`}`,
  );
  console.log(
    `   e2e ：${me.line} rc=${me.rc} 红集=${titlesOf(me.out, 'T').join(' ｜ ') || '(无)'} → ${arm.expectE.length === 0 ? (eBlind ? '盲区（成立）' : '也抓到了') : `应红=${arm.expectE.join('/')}`}`,
  );
  if (jsOk && eOk) ok += 1;
  else bad.push(`${arm.name}（jsdom ${jsOk ? 'ok' : 'NOT_AS_EXPECTED'} / e2e ${eOk ? 'ok' : 'NOT_AS_EXPECTED'}）`);

  restore();
  for (const f of FILES) {
    if (md5(readFileSync(path.join(ROOT, f))) !== origMd5.get(f)) {
      fail(`${arm.name}：复原失败，${f} 与基线 md5 不同，必须手工核对`);
    }
  }
}

const rb = build();
if (rb.rc !== 0) fail(`复原后打不出包：\n${rb.out.slice(-1500)}`);
if (distDigest() !== cleanDigest) fail('复原后产物摘要与基线不同 ⇒ 复原没落到产物上');
const rj = jsdom();
const re = e2e();
console.log(`复原：BACK_TO_CLEAN=${rj.rc === 0 && re.rc === 0} 复跑 jsdom=${rj.line}｜e2e=${re.line}`);

if (bad.length || rj.rc !== 0 || re.rc !== 0) {
  console.log(
    `RIG_RESULT=FAIL 未如预期=${bad.join(' | ') || '(无)'} 复原复跑绿=${rj.rc === 0 && re.rc === 0}`,
  );
  process.exit(1);
}
/* 盲区清单**由臂名册算出来**，不手写：上一版写着"A4/A5/A6/R3/R4 只 jsdom 红"，
   加一臂就得回头重数 —— 而 §8.145 这一批恰恰改了归属（M3 从"盲区"变成"有牙"）。
   算出来的那一行永远不会漂。 */
const jsOnly = ARMS.filter((a) => a.expectE.length === 0).map((a) => a.name.split(' ')[0]);
const eOnly = ARMS.filter((a) => a.expectJs.length === 0).map((a) => a.name.split(' ')[0]);
console.log(
  `RIG_RESULT=${ok}/${SELECTED.length}（每臂的红集**逐条等于**点名那几条；e2e 盲区=${jsOnly.join('/') || '无'}｜jsdom 盲区=${eOnly.join('/') || '无'}）`,
);
