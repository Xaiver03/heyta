/**
 * **非 JS 宿主**（第一个消费者：WinUI 3 / C#）与 heyta 逻辑之间的唯一契约。
 *
 * ## 为什么这一层必须存在（可维护性，不是形式主义）
 *
 * Windows 原生壳是 C#，而 heyta 的**全部业务与存储逻辑**在 TS 里
 * （`@heyta/app-host` 就是为"宿主无关的应用接线"抽出来的，ADR-0003 §2.1）。
 * 如果 C# 直接读 schema、拼 op、算派生视图，就会立刻长出**第二份领域逻辑** ——
 * 那正是本仓反复记为"同一条规则两个实现，然后漂移"的形状。
 *
 * 边界划在这里：
 *
 *     C# 只认识 **几个函数名 + JSON**；"应用是什么"全在 TS 这一侧。
 *
 * ## 为什么它住在 `packages/app-host`，而不是 `apps/desktop-windows/`
 *
 * 试过后者，**行不通**：facade 要 `import '@heyta/app-host'`，而
 * `apps/desktop-windows/` 不是 workspace 包（没有 `package.json`），
 * 它下面没有 `node_modules`，esbuild 从那里往上走也解析不到 `@heyta/*`。
 * 三个选项里选了最省事且最不容易漂移的：
 *
 *   1. ❌ 给 `apps/desktop-windows` 建 `package.json` + `pnpm install`
 *      —— 要动 lockfile，而此时**另一个会话正在同一个仓库里改 package.json**，
 *         冲突代价大于收益；
 *   2. ❌ 在 bundler 里用 `nodePaths` 指向别的 app 的 `node_modules`
 *      —— 那是把 A 的依赖树借给 B 用，比问题本身更难维护；
 *   3. ✅ **放进 `packages/app-host`** —— 天然解析得到 `@heyta/*`，
 *      而且**自动进入本包既有的 `typecheck`**（`tsconfig` 覆盖 `src/**`）。
 *      代价是它在共享包里；所以文件名与这段说明都写明"它是宿主门面"。
 *
 * ## 纪律
 *
 *   1. **每个函数只收一个对象、只返回可 JSON 化**的数据 ⇒ 跨语言类型映射只存在一处。
 *   2. **写操作一律走 `createTaskActions`**，宿主不许绕过
 *      （与 Web 宿主的 `dispatchIntent()` 同一条纪律，AGENTS.md §3.4）。
 *   3. **派生逻辑（排序、完成态）留在这里**，不下沉到 XAML ——
 *      原生 UI 只负责"把给它的数组画出来"。
 *   4. ⚠️ 目前**不接同步**：不传 `serverUrl` ⇒ `openAppHost` 不建同步客户端。
 *      要接的时候是**在这里加一个函数**，不是把同步逻辑写进 C#。
 *
 * ⚠️ 已知缺口（不要假装没有）：`TaskView` 目前只覆盖"列出来 + 勾完成 + 新建 + 删"。
 * 象限、清单、标签、重复、备注编辑都**还没有**门面 —— 那些要一个一个加，
 * 每加一个都要问"原生界面真的渲染它吗"。
 */

import { sortTasksForDisplay } from '@heyta/domain';
import {
  decodeOpLogWire,
  encodeOpLogWire,
  handleOpLogWorkerRequest,
  type OpLogStore,
  type OpLogWorkerRequest,
} from '@heyta/storage';
import type { Operation } from '@heyta/sync-core';

import { createTaskActions } from './actions.js';
import { openAppHost, openOpLogStore, type AppHost } from './host.js';

/** 原生列表真正需要的字段。**故意很小**。 */
export interface TaskView {
  id: string;
  title: string;
  done: boolean;
  /** 完成时间（epoch ms）。原生侧显示"已完成"用它，不自己造一个布尔。 */
  completedAt: number | null;
  note: string | undefined;
  projectId: string | undefined;
  dueDate: number | undefined;
}

let host: AppHost | null = null;

const requireHost = (): AppHost => {
  if (host === null) {
    throw new Error('应用宿主还没打开 —— 先调 open({ dbPath })');
  }
  return host;
};

/**
 * 原生侧驱动的形状：只有这 4 个方法，参数与行都是 JSON 文本。
 *
 * ⚠️ 返回值刻意写成 `unknown`：**两端在"怎么报错"上不一样**
 *   · Windows（Jint）：方法抛 CLR 异常，Jint 的 `CatchClrExceptions` 把它变成
 *     JS 错误 ⇒ 这里什么都不用做。
 *   · macOS（JavaScriptCore）：native 方法里抛 `NSException` **不会**变成 JS 异常，
 *     而且 Swift 接不住 ObjC 异常（直接抛 = 终止进程）⇒ 那边改成**返回信封**
 *     `{"__heytaDriverError":"…"}`，由下面的 `throwIfDriverError` 拆开并 `throw`。
 *
 * 两端因此共用**这一个**包装：有信封就拆，没有就当普通返回值/异常走。
 */
interface NativeSqliteDriver {
  exec(sql: string): unknown;
  run(sql: string, paramsJson: string): unknown;
  all(sql: string, paramsJson: string): unknown;
  close(): void;
}

/** 信封的键。⚠️ 改它必须同步改 `apps/desktop-macos/.../SqliteBridge.swift`。 */
const DRIVER_ERROR_KEY = '__heytaDriverError';

/**
 * 拆驱动信封：只有"看起来就是信封"的输入才会被当成错误。
 *
 * 🔴 判据刻意收得很紧 —— `all()` 返回的是**行数组**（以 `[` 开头），
 * 而某个字段的值完全可能**恰好**是 `"__heytaDriverError"` 这个字符串。
 * 所以必须是"以 `{` 开头 + 能 parse 成对象 + 该键是字符串"三者同时成立。
 * 松一点的写法会把"某一行数据里刚好有这个字符串"误判成驱动出错。
 */
const throwIfDriverError = (payload: unknown): void => {
  if (typeof payload !== 'string' || !payload.startsWith('{')) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return; // 不是 JSON ⇒ 不是信封
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  const message = (parsed as Record<string, unknown>)[DRIVER_ERROR_KEY];
  if (typeof message === 'string') throw new Error(message);
};

/**
 * 把原生侧的同步驱动包成契约里的 `SqliteDriver`。
 *
 * 🔴 **这一层包装必须在这里（JS 侧），不能把原生对象直接交给适配器。**
 *
 * 第一版就是直接 `driverFactory: () => clrDriver`，结果一跑就炸：
 *
 *     HeytaApp.open 失败：'c' is an invalid start of a value. LineNumber: 0
 *       at all (native-bridge.js:11966)   ← 适配器在 JSON.parse 行数据
 *
 * 原因：契约里的 `driver.all(sql, params)` 第二个参数是**参数数组**
 * （`SqlValue[]`），而原生侧的 `all` 收的是**JSON 文本**。引擎会把 JS 数组
 * 塞给 `string` 形参（得到垃圾字符串），于是拿回来的东西不是 JSON。
 *
 * ⇒ 参数与行的编组**只在 JS 这一侧发生一次**；两端都只看见字符串。
 *
 * ⚠️ 当前用 JSON 文本过边界，实测代价约 4.9 µs/行（见 spike README 的编组基准）。
 *    也就是说：**这是一条已知性能取舍**，不是疏忽 —— 它换的是"类型映射只有一处"。
 */
const wrapDriver = (native: NativeSqliteDriver) => ({
  exec: (sql: string): void => throwIfDriverError(native.exec(sql)),
  run: (sql: string, params?: readonly unknown[]): void =>
    throwIfDriverError(native.run(sql, JSON.stringify(params ?? []))),
  all: <T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): T[] => {
    const payload = native.all(sql, JSON.stringify(params ?? []));
    throwIfDriverError(payload);
    return JSON.parse(payload as string) as T[];
  },
  close: (): void => native.close(),
});

/**
 * 打开（或确认已打开）应用宿主。幂等。
 *
 * 🔴 驱动的来源是宿主注入的 `globalThis.__heytaDriverFactory` ——
 * C# 侧把同步 `SqliteDriver` 挂在那里。facade **不自己实现驱动**，
 * 所以存储引擎仍然是 `packages/storage` 那一份。
 */
/**
 * 取宿主注入的同步驱动工厂。
 *
 * 抽成一处：`open()` 与 `openOpLog()` **都必须**从这里拿，
 * 而"宿主忘了挂驱动"是一句要能一眼认出来的话 —— 写两遍就会漂成两种说法。
 */
function requireDriverFactory(): () => NativeSqliteDriver {
  const factory = (globalThis as { __heytaDriverFactory?: () => NativeSqliteDriver })
    .__heytaDriverFactory;
  if (typeof factory !== 'function') {
    throw new Error('宿主没有注入 __heytaDriverFactory —— 原生壳忘了挂同步驱动');
  }
  return factory;
}

export async function open(input: { dbPath: string }): Promise<{ clientId: string }> {
  if (host !== null) {
    return { clientId: host.clientId };
  }
  host = await openAppHost({
    driverFactory: () => wrapDriver(requireDriverFactory()()),
    dbPath: input.dbPath,
  });
  return { clientId: host.clientId };
}

/**
 * 列出任务。
 *
 * 🔴 **排序用共享的那一份，不在这里自己写**（G5 修的就是这一处）。
 *
 * 这里原先写的是 `(createdAt, id)`，理由是"`TaskActions` 的文档写明列表按它排序"。
 * 那话本身没错，但**它说的是引擎的落盘顺序，不是用户该看到的顺序**。
 * 用户该看到的顺序（完成态 → 截止日升序 → 原序）当时只存在于
 * `packages/ui` 里，而 app-host **够不到那个包**（ui 的 peer 是 react/react-native，
 * 让 app-host 依赖它会把 React 拖进一个零框架依赖的包）。
 *
 * ⇒ 结果是**同一个账号在桌面壳与 web/mobile 上任务顺序不同**，
 * 且两边都不报错。现在规则搬到了 `@heyta/domain`（两个包都依赖、零框架依赖），
 * 这里直接调它，**只有一份实现**。
 *
 * ⚠️ 仍然**不在原生侧排序**：C# / Swift / C 各排一次就是 N 个真相源。
 */
export async function listTasks(): Promise<{ tasks: TaskView[] }> {
  const current = requireHost();
  const alive = Object.values(current.getState().tasks).filter(
    (task) => task.deletedAt === undefined,
  );
  return {
    tasks: sortTasksForDisplay(alive).map((task) => ({
      id: task.id,
      title: task.title,
      done: task.completedAt !== undefined,
      completedAt: task.completedAt ?? null,
      note: task.note,
      projectId: task.projectId,
      dueDate: task.dueDate,
    })),
  };
}

/**
 * 🔴 **完整任务实体**（不是上面那个窄化的 `TaskView`）。
 *
 * ## 为什么需要它，以及它回答了什么
 *
 * `TaskView` 是**为"原生 ListView 只显示标题 + 勾选框"那个需求**裁出来的窄视图
 * （文件头第 41 行记着这个已知缺口）。而**共享 UI（`packages/ui` 的 `TaskList`）
 * 要的是完整 `Task`** —— 它要画优先级、截止、标签、重复等等。
 *
 * 这直接回答了方案 §4.4 的 **G4**（"窄门面的缺口在接共享 UI 之后会不会消失"）：
 * **不会自动消失，而且缺口是真实存在的。** 实测形态就是这一条：
 * 窄门面能驱动"手写的 3 列 ListView"，**驱动不了共享 UI**。
 * 所以共享 UI 上桌面时，门面**必须**补出实体级出口 —— 就是本方法。
 *
 * ⚠️ 它是**只读**的：写方向（共享 UI 的交互回到壳）还没有设计，
 * 别在这里顺手加写方法 —— 那会把"写通道长什么样"这个未决问题偷偷定下来。
 *
 * ⚠️ 返回的是 `Task` 的**原样 JSON**（含 `createdAt` / `updatedAt` / `opSeq` 等）。
 * 壳**不需要**在 C# 侧为它建模：直接把这个字符串转发给 WebView 即可 ——
 * 壳越薄越好（`apps/desktop-windows/README.md` 的纪律）。
 *
 * ⚠️ 返回类型是 `readonly unknown[]`（**不是**可变的 `unknown[]`）：值直接来自
 * 领域层的 `sortTasksForDisplay()`，其签名是 `readonly Task[]`。门面只需要说
 * "这是一个不透明的 JSON 数组"，而声明成可变数组会让 `tsc` 直接红
 * （`TS4104: 'readonly Task[]' is 'readonly' and cannot be assigned to 'unknown[]'`）。
 */
export async function listTaskEntities(): Promise<{ tasks: readonly unknown[] }> {
  const current = requireHost();
  const alive = Object.values(current.getState().tasks).filter(
    (task) => task.deletedAt === undefined,
  );
  return { tasks: sortTasksForDisplay(alive) };
}

/** 新建任务。空标题**抛错**（`TaskActions.create` 的既定语义，不在这里改）。 */
export async function addTask(input: { title: string }): Promise<{ id: string }> {
  const actions = createTaskActions(requireHost());
  return { id: await actions.create(input.title) };
}

/** 显式设置完成态（幂等，不像 toggle 依赖当前状态）。 */
export async function setTaskDone(input: {
  id: string;
  done: boolean;
}): Promise<Record<string, never>> {
  const actions = createTaskActions(requireHost());
  await actions.setCompleted(input.id, input.done);
  return {};
}

/** 软删除（发 `DEL` op，由 reducer 转成墓碑）。 */
export async function removeTask(input: { id: string }): Promise<Record<string, never>> {
  const actions = createTaskActions(requireHost());
  await actions.remove(input.id);
  return {};
}

/** 当前 clientId —— 界面用它显示"这台设备是谁"，也是"库真的打开了"的证据。 */
export async function clientId(): Promise<{ clientId: string }> {
  return { clientId: requireHost().clientId };
}

/**
 * 壳侧为**页侧的真应用**托管的那一份存储（**没有引擎**）。
 *
 * 🔴 为什么无引擎：桌面壳（M2）的 `app` 模式里，**引擎属于页侧的真应用**
 * （它才有 feature store / 冲突解决 / 实时通道）。壳只提供"一个跑在原生
 * SQLite 上的 store"。两个引擎同库会各自为政（`appliedOpIds` 与向量时钟漂移），
 * 所以壳那条路刻意**不**走 `open()`（那会建引擎）。
 *
 * ⚠️ 因此壳在 `app` 模式下**不得再调 `open()`** —— 那会在同一个库上多出一个引擎。
 */
let opLogStore: OpLogStore<Operation> | null = null;
let opLogClientId: string | null = null;
/** adapter 的关闭只能走它自己（`OpLogStore` 接口上没有 close）。 */
let closeOpLogAdapter: (() => void) | null = null;

/**
 * 为页侧的真应用打开存储（无引擎）。幂等。
 *
 * 返回的 `clientId` 由**这个库**给出（`resolveClientId`），壳拿到它之后
 * 给页侧推一条 `ready` 交握 —— 页侧的引擎必须用**库里那个** id，
 * 不能自己再算一个（它是 LWW 冲突的决胜依据）。
 */
export async function openOpLog(_input: { dbPath: string }): Promise<{ clientId: string }> {
  if (opLogStore !== null && opLogClientId !== null) {
    return { clientId: opLogClientId };
  }
  const { adapter, store, clientId } = await openOpLogStore<Operation>({
    driverFactory: () => wrapDriver(requireDriverFactory()()),
  });
  opLogStore = store;
  opLogClientId = clientId;
  closeOpLogAdapter = () => adapter.close();
  return { clientId };
}

/**
 * 处理**页侧经宿主边界发来的一条消息**，返回**要发回去的那些消息**。
 *
 * ## 为什么是"收一条、回多条"，而不是"一请求一响应"
 *
 * 🔴 `ready` 交握是**推**给页侧的，而**推的时机壳控制不了**：页侧的
 * `initOpLog()` 可能在壳推 ready 之后才挂上监听 —— 那条 ready 就丢在空气里，
 * 而症状是**永久卡在启动**（不是报错）。所以页侧会反复发 `oplog-hello` 来催，
 * 壳每次都回一条 ready。把"要回什么"交给 TS 决定，C# 就只需要
 * **把返回的每一串原样发出去** —— 它不必认识 `ready`、`hello` 或任何协议字段。
 *
 * ## C# 侧对这里的所有字符串**不做任何解释**
 *
 * 不解析、不改写、不建模。协议与线码都只在 TS 侧一份实现 ——
 * 那是"壳不许多业务/schema 知识"的落点（`apps/desktop-windows/README.md` §1）。
 *
 * ## 线码在这里成对应用
 *
 * 入站 `decodeOpLogWire`、出站 `encodeOpLogWire`，与页侧的
 * `createOpLogWirePort` 对称。宿主边界只过 JSON，而 `markUploaded` 传的是 `Map`
 * —— 少了这一步，13 条存储契约会同时红（`serverSeqsByOpId is not iterable`）。
 * 而 `handleOpLogWorkerRequest` **与 Worker 桥是同一个函数** ⇒ 没有第二份协议实现。
 */
export async function handleHostMessage(input: {
  messageJson: string;
}): Promise<{ outboundJson: string[] }> {
  // 幂等：任何一条消息到达都保证 store 已经打开，于是"先 hello 还是先请求"不再重要。
  const { clientId } = await openOpLog({ dbPath: '' });

  const decoded = decodeOpLogWire(JSON.parse(input.messageJson)) as
    | (OpLogWorkerRequest & { type?: undefined })
    | { type: string };

  if ('type' in decoded && decoded.type === 'oplog-hello') {
    return { outboundJson: [JSON.stringify({ type: 'ready', clientId })] };
  }

  const store = opLogStore;
  if (store === null) {
    // 走到这里说明 openOpLog 刚返回但没落下 store —— 那是接线 bug，必须响亮。
    throw new Error('op-log 存储没打开（openOpLog 返回了却没建 store）—— 接线 bug');
  }
  const response = await handleOpLogWorkerRequest(store, decoded as OpLogWorkerRequest);
  return { outboundJson: [JSON.stringify(encodeOpLogWire(response))] };
}

/** 关闭 SQLite 连接。之后不可再用。 */
export function close(): void {
  if (host !== null) {
    host.close();
    host = null;
  }
  if (closeOpLogAdapter !== null) {
    closeOpLogAdapter();
    closeOpLogAdapter = null;
    opLogStore = null;
    opLogClientId = null;
  }
}
