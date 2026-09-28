/**
 * golden fixture 的**唯一真源**
 * =================================
 *
 * 这个文件同时被两处使用：
 *
 *   1. `tests/fixtures.spec.ts` —— 校验/重建 `fixtures/*.golden.json`
 *   2. `tests/golden.spec.ts` —— 四端解析器的锁（解密、深比较、判别用例）
 *
 * ## 🔴 夹具的明文由**真实选择器**产出，不是手写数据
 *
 * `buildPlaintext()` 调的是 `selectors.buildWidgetPayload()` —— 就是应用真正写快照时
 * 调的**同一个**函数。所以：
 *
 *   - 契约里的示例数据**不可能是**"计划要的样子"而与实际输出不符；
 *   - 哪天选择器改了（多一个字段、换个排序），夹具校验会红，
 *     逼着人**重新生成** —— 而重新生成会改密文，于是四端的期望值也必须同步。
 *     这条链路是刻意要它存在的：四端解析器要跟着契约走，不能各自漂移。
 *
 * 如果夹具是手写的，上面这条链路就断了：手写数据永远"符合契约"，
 * 因为它就是照着契约写的，而真实选择器跑出什么它管不着。
 *
 * ## 🔴 时区：`localNoon()` 保证**日期语义**稳定，`TZ=UTC` 保证**字节**稳定
 *
 * 这两件事必须分开讲，因为它们是两件不同的事 —— 这一节以前把它们混成了一件，
 * 于是写出了一句**错话**（"在任何时区跑出的字节完全一致"），
 * 而 CI 在 UTC 上跑时 `check:widgets` 直接红。
 *
 * **第一件（`localNoon()` 解决的）：日期语义。**
 * `Task.dueDate` 是 epoch 毫秒，而 heyta 用**本地日历日**解释它
 * （`toLocalDate` → `YYYY-MM-DD`）。一个写死的 epoch 在不同时区会是**不同的日期**，
 * 夹具就会"在这台机器上对、在另一台上错"。
 * 解法是 `localNoon()`：先 `parseLocalDate('2026-09-27')` 得到本机时区的零点，
 * 再加 12 小时。于是无论本机是 UTC+8 还是 UTC-5，
 * `toLocalDate(localNoon('2026-09-27')) === '2026-09-27'` **恒成立**。
 * 取正午而不是零点，是为了离两边的日界都最远：夏令时切换（可能让某个本地零点不存在
 * 或出现两次）最多偏移 1 小时，正午仍然稳稳落在同一天。
 *
 * **第二件（`TZ=UTC` 解决的）：字节。**
 * `localNoon()` 让**日期**稳定，但它给出的 **epoch 数值本身是随时区变的** ——
 * 同一个"本地正午"，在 UTC+8 和在 UTC 是两个不同的毫秒数。
 * 夹具里凡是**直接存 epoch**的字段（专注会话的 `endsAt`）就跟着变，
 * 而密文是对明文整体加密的，于是**整个 `ciphertext` 一起变**。
 * 实测差异正好是 8 小时（`1790536320000` vs `1790565120000`）。
 *
 * 所以字节的一致性**不来自** `localNoon()`，而来自 `vitest.config.ts` 里的
 * `env: { TZ: 'UTC' }`：生成与校验都在同一个时区下进行，谁来跑都一样。
 * 这一点由 `fixtures.spec.ts` 的"重建后逐字节相同"断言钉住。
 *
 * ⚠️ 换掉那个 `TZ` 前请先想清楚：它一松，夹具就重新变成"只在生成者那台机器上对"。
 */

import { createCipheriv, createHash } from 'node:crypto';

import {
  parseLocalDate,
  type FocusState,
  type Habit,
  type HabitLog,
  type Project,
  type Task,
} from '@heyta/domain';

import { WIDGET_CONTRACT_VERSION, envelopeAad, type WidgetEnvelope } from '../src/contract.js';
import { buildWidgetPayload, type WidgetSelectorInput } from '../src/selectors.js';

// ─────────────────────────────────────────────────────────────
// 固定密钥材料：**故意写死**，这样夹具可复现。
// 这不是"密钥管理"，是测试夹具 —— 真实设备密钥由原生模块派生（见 D1 与 ADR）。
// ─────────────────────────────────────────────────────────────
export const TEST_KEY = createHash('sha256').update('heyta-widget-golden-key-v1').digest();
export const TEST_NONCE = createHash('sha256')
  .update('heyta-widget-golden-nonce-v1')
  .digest()
  .subarray(0, 12);
const TAG_LENGTH = 16;

/** 夹具的"今天"。2026-09-27 是**周日**（用于习惯的周频率判定）。 */
export const TEST_DAY = '2026-09-27';
/** 夹具的"现在"：当天本地 15:00。从 `TEST_DAY` 派生 → 时区无关。 */
export const TEST_NOW = localNoon(TEST_DAY) + 15 * 60 * 60 * 1000;
/** 快照失效时刻。只参与 AAD 与 `validUntil`，**不**做本地日期解释。 */
export const TEST_VALID_UNTIL = 1_790_000_000_000;

/**
 * `LocalDate` → **本机时区**的当天正午（epoch ms）。
 * 见文件头"时区无关性"。
 */
export function localNoon(date: string): number {
  return parseLocalDate(date).getTime() + 12 * 60 * 60 * 1000;
}

const CREATED = localNoon('2026-09-01');

function task(over: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return { createdAt: CREATED, updatedAt: CREATED, ...over };
}

function habit(over: Partial<Habit> & Pick<Habit, 'id' | 'name'>): Habit {
  return { createdAt: CREATED, updatedAt: CREATED, ...over };
}

function log(date: string, over: Partial<HabitLog> & Pick<HabitLog, 'habitId'>): HabitLog {
  return { id: `${over.habitId}:${date}`, date, createdAt: CREATED, updatedAt: CREATED, ...over };
}

function project(over: Partial<Project> & Pick<Project, 'id' | 'name'>): Project {
  return { createdAt: CREATED, updatedAt: CREATED, ...over };
}

/**
 * 夹具覆盖的**每一类分支**（这是它作为"锁"的价值所在）。
 * 括号里是"如果四端某端实现错了，会在哪一条上暴露"。
 */
export function buildSampleInput(): WidgetSelectorInput {
  const tasks: Task[] = [
    // ── 今日任务：未完成 ──────────────────────────────────────
    task({
      // 今天到期 + 高优先级（High 会被判定为"重要"）
      id: 't_write_report',
      title: '写周报',
      dueDate: localNoon('2026-09-27'),
      priority: 3,
      projectId: 'p_work',
    }),
    task({
      // **已逾期**（3 天）→ 仍属"今天该做的"；无优先级、未标重要 → 落在象限 3
      id: 't_rent',
      title: '交房租',
      dueDate: localNoon('2026-09-24'),
      projectId: 'p_life',
    }),
    task({
      // 今天到期 + 显式重要 → 象限 1（与今日列表**重叠**，这是刻意的）
      id: 't_fix_incident',
      title: '修复线上故障',
      dueDate: localNoon('2026-09-27'),
      priority: 3,
      important: true,
      projectId: 'p_work',
    }),
    task({
      // 今天到期 + 不重要 + 低优先级 → 象限 3
      id: 't_buy_tape',
      title: '买胶带',
      dueDate: localNoon('2026-09-27'),
      priority: 1,
    }),
    task({
      // 🔴 **被引用了、但这个清单没设过色** → 今日列表里带 `projectId: "p_plain"`，
      //    而 `projectColors` 里**必须没有** `p_plain` 这个键。
      //    这是给四端的一条负例：查不到颜色时要用自己的中性色，而不是显示空白/崩溃。
      id: 't_photo',
      title: '整理相册',
      dueDate: localNoon('2026-09-27'),
      projectId: 'p_plain',
    }),

    // ── 今日任务：今天已完成（要出现在今日列表里，但**不在**象限里）──
    task({
      id: 't_milk',
      title: '买牛奶',
      dueDate: localNoon('2026-09-27'),
      completedAt: localNoon('2026-09-27'),
      projectId: 'p_life',
    }),

    // ── 不在今日，但在象限 ────────────────────────────────────
    task({
      // 明天到期（在默认 2 天窗口内 → 紧急）+ 重要 → 象限 1
      id: 't_read_paper',
      title: '读论文',
      dueDate: localNoon('2026-09-28'),
      important: true,
    }),
    task({
      // 无截止日 + 重要 → 不紧急 → 象限 2
      id: 't_checkup',
      title: '体检预约',
      important: true,
    }),
    task({
      // 无截止日 + 低优先级 → 象限 4。🔴 关键负例：它**不在**今日列表里
      id: 't_someday',
      title: '有空再整理照片',
      priority: 1,
    }),

    // ── 两个视图都**不该**出现 ────────────────────────────────
    task({
      // 截止日是今天，但**昨天就完成了** → 不占今天的位置；已完成 → 象限也排除
      id: 't_archive',
      title: '归档旧文件',
      dueDate: localNoon('2026-09-17'),
      completedAt: localNoon('2026-09-22'),
    }),
    task({
      // 已删除 → 所有视图都排除
      id: 't_deleted',
      title: '已删除的差事',
      dueDate: localNoon('2026-09-27'),
      deletedAt: CREATED,
    }),
  ];

  const habits: Habit[] = [
    habit({
      // 每天；今天已达目标（3 杯）→ doneToday true；连续 3 天
      id: 'h_water',
      name: '喝水',
      target: 3,
      unit: '杯',
      goalType: 'atLeast',
      frequency: { type: 'daily' },
    }),
    habit({
      // 🔴 周频率 [周二, 周四, 周日] → 今天是周日，**排期**
      //   但今天**还没打卡**。连续天数不该因此归零（"今天还没过完"）。
      id: 'h_run',
      name: '跑步',
      target: 1,
      frequency: { type: 'weekly', daysOfWeek: [2, 4, 7] },
    }),
    habit({
      // 🔴 只在周三 → 今天（周日）**不排期** → 不出现在组件里
      id: 'h_review',
      name: '周三复盘',
      frequency: { type: 'weekly', daysOfWeek: [3] },
    }),
    habit({
      // 🔴 **interval 不命中今天的排除用例**。
      //    判定是 `diffDays('1970-01-01', '2026-09-27') % 3`，实测
      //    20723 % 3 = 2 → 不排期 → 不出现在组件里。
      //    （20723 = 17×23×53，≤14 的约数只有 1，所以没法用一个真实间隔让它命中今天。
      //     interval 分支本身是 domain 的职责，在 domain 自己的测试里正向覆盖；
      //     这里只需要它作为"不排期的习惯被排除"的证据。）
      id: 'h_gym',
      name: '健身',
      frequency: { type: 'interval', everyNDays: 3 },
    }),
    habit({
      id: 'h_deleted',
      name: '已删除的习惯',
      frequency: { type: 'daily' },
      deletedAt: CREATED,
    }),
  ];

  const logs: HabitLog[] = [
    // h_water：连续三天达标（今天 3 杯 → 达成）
    log('2026-09-25', { habitId: 'h_water', value: 3 }),
    log('2026-09-26', { habitId: 'h_water', value: 3 }),
    log('2026-09-27', { habitId: 'h_water', value: 3 }),
    // h_run：上周日 + 本周二 + 本周四都跑了，今天（周日）还没跑
    log('2026-09-20', { habitId: 'h_run', value: 1 }),
    log('2026-09-22', { habitId: 'h_run', value: 1 }),
    log('2026-09-24', { habitId: 'h_run', value: 1 }),
    // 🔴 已删除的打卡记录 = 没发生（撤销语义）
    log('2026-09-27', { habitId: 'h_gym', value: 1, deletedAt: CREATED }),
  ];

  const projects: Project[] = [
    project({ id: 'p_work', name: '工作', color: '3' }),
    project({ id: 'p_life', name: '生活', color: '7' }),
    // 🔴 没设过色 → **不该**出现在 projectColors 里（原生查不到就用中性色）
    project({ id: 'p_plain', name: '没设色的清单' }),
  ];

  // 正在跑的番茄钟：剩余 12 分钟
  const focus: FocusState = {
    phase: 'running',
    kind: 'work',
    plannedMs: 25 * 60 * 1000,
    endsAt: TEST_NOW + 12 * 60 * 1000,
    startedAt: TEST_NOW - 13 * 60 * 1000,
    completedWorkCount: 1,
    taskId: 't_write_report',
  };

  return {
    tasks,
    habits,
    logs,
    projects,
    focus,
    today: TEST_DAY,
    now: TEST_NOW,
    // ⚠️ 这里**没有** `validUntil` —— 它属于信封，不属于载荷。
    // 选择器只产出载荷；`dayStr` / `validUntil` 由组装快照的一方（`@heyta/app-host`）决定，
    // 因为它要参与的是刷新策略（D-day 与推送时机），而不是领域投影。
    // 夹具在 `buildEnvelope()` 里单独用它。
  };
}

/** 夹具明文 = **真实选择器**的输出。 */
export function buildPlaintext(): unknown {
  return buildWidgetPayload(buildSampleInput());
}

/** 用固定密钥加密一段 compact JSON。 */
function encrypt(compactJson: string, aad: string): string {
  const cipher = createCipheriv('aes-256-gcm', TEST_KEY, TEST_NONCE, { authTagLength: TAG_LENGTH });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(compactJson, 'utf8'), cipher.final()]);
  // 约定：密文 = body || authTag（WebCrypto / CryptoKit / Java 都是这个顺序）
  return Buffer.concat([body, cipher.getAuthTag()]).toString('base64');
}

/** 造一个信封（`v` 可变，用于制造判别用例）。 */
export function buildEnvelope(v: number): WidgetEnvelope {
  const envelope: WidgetEnvelope = {
    v,
    dayStr: TEST_DAY,
    validUntil: TEST_VALID_UNTIL,
    alg: 'AES-GCM-256',
    nonce: Buffer.from(TEST_NONCE).toString('base64'),
    ciphertext: '',
  };
  // 🔴 AAD 用的是**契约自己的** `envelopeAad()` —— 不是这里手写的字符串。
  // 这样生成侧与契约侧一旦分叉，解密会立刻失败而不是安静地用一个"另一套 AAD"。
  envelope.ciphertext = encrypt(JSON.stringify(buildPlaintext()), envelopeAad(envelope));
  return envelope;
}

/** 当前应写入 `fixtures/` 的三份内容（文件名 → 文件正文）。 */
export function buildFixtureFiles(): Record<string, string> {
  const pretty = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
  return {
    'v1.golden.json': pretty(buildEnvelope(WIDGET_CONTRACT_VERSION)),
    'v1.golden.plaintext.json': pretty(buildPlaintext()),
    // 🔴 判别用例：`v` 未知，但**密文是有效的**（用的是同一份明文）。
    // 这样"先判 v 再拒绝"的正确实现与"无视 v 直接解密并显示"的错误实现结果不同。
    'v99.unknown.golden.json': pretty(buildEnvelope(99)),
  };
}
