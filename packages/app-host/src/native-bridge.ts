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

import { createTaskActions } from './actions.js';
import { openAppHost, type AppHost } from './host.js';

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
export async function open(input: { dbPath: string }): Promise<{ clientId: string }> {
  if (host !== null) {
    return { clientId: host.clientId };
  }
  const factory = (globalThis as { __heytaDriverFactory?: () => NativeSqliteDriver })
    .__heytaDriverFactory;
  if (typeof factory !== 'function') {
    throw new Error('宿主没有注入 __heytaDriverFactory —— 原生壳忘了挂同步驱动');
  }
  host = await openAppHost({
    driverFactory: () => wrapDriver(factory()),
    dbPath: input.dbPath,
  });
  return { clientId: host.clientId };
}

/**
 * 列出任务。
 *
 * 排序**在这里**做，不在 C# 里：`TaskActions` 的文档写明列表按
 * `(createdAt, id)` 排序。C# 再排一次就是第二个真相源。
 */
export async function listTasks(): Promise<{ tasks: TaskView[] }> {
  const current = requireHost();
  const alive = Object.values(current.getState().tasks).filter(
    (task) => task.deletedAt === undefined,
  );
  alive.sort((a, b) => {
    const byCreated = (a.createdAt ?? 0) - (b.createdAt ?? 0);
    return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id);
  });
  return {
    tasks: alive.map((task) => ({
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

/** 关闭 SQLite 连接。之后不可再用。 */
export function close(): void {
  if (host !== null) {
    host.close();
    host = null;
  }
}
