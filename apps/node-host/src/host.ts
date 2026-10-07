/**
 * Node 宿主
 * ==========
 *
 * 目的**不是**做一个 Node 产品，而是给 ADR-0003 §2.1 一个可执行的判据：
 *
 * > 所有业务逻辑必须在 `packages/` 里，`apps/*` 只允许放平台外壳与 UI 绑定。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个文件在本轮被**大幅削薄**了，原因值得记下来。
 *
 * 它原本有 270 行：自己的 `resolveClientId`、自己的游标读写、自己把
 * `SyncClientOptions` 那十几个回调接一遍、自己的任务 op 构造、自己的
 * `crypto.randomUUID()`。当时这是可以接受的 —— 因为只有两个宿主，
 * 而且两端行为分别被 `verify:p1` 与 `verify:p2` 钉着。
 *
 * 但移动端是**第三个**宿主。再抄一遍就意味着：
 *
 *   - 同一套接线有三份，改一处要记得改三处；
 *   - 两边**已经开始漂移**了 —— 这个文件用 `crypto.randomUUID()` 生成 entityId，
 *     而 `apps/web` 用 `Date.now()+counter`；`apps/web` 有 randomUUID 缺失时的回退，
 *     这个文件**没有**（在 Hermes 上会直接抛）。
 *
 * 所以接线与动作都提到了 `@heyta/app-host`。**现在这里只剩平台差异**：
 * 用哪个 SQLite 驱动、库文件在哪。
 *
 * 判断这个文件是否还"薄"的标准很简单：**它有没有任何一行在决定"业务上该怎么做"？**
 * 有，就说明提取得不够。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 与 Web 宿主的唯一区别现在是**一行**：
 *
 *   | 维度     | Web（apps/web/src/lib/oplog.ts） | Node（本文件）            |
 *   |----------|----------------------------------|---------------------------|
 *   | 存储     | IndexedDbAdapter                 | NodeSqliteDriver（文件）  |
 *
 * 设备 id、游标、op 构造、上传/下载编排全部来自 `packages/` ——
 * 所以两端的本地库结构完全一致。这不是巧合。
 */

import {
  createAssistantSessionActions,
  createHabitActions,
  createNoteActions,
  createProjectActions,
  createTaskActions,
  exportDocumentFromHost,
  materializedState,
  openAppHost,
  type NewAssistantTurn,
  type RestoreDocument,
  restoreIntoEmptyTarget,
  type AppHost,
  type ExportDocument,
  type NewTaskFields,
  type RestoreExportResult,
} from '@heyta/app-host';
import type { AssistantTurn, Habit, Note, Project, Tag, Task, TrashItem } from '@heyta/domain';
import { toTrashItems } from '@heyta/domain';
import type { OpIntent } from '@heyta/op-log';
import type { EntityType } from '@heyta/shared-schema';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import type { SyncStatus } from '@heyta/sync-client';

export interface NodeHostOptions {
  /** **真实 SQLite 文件**路径。不要传 `:memory:` —— 那证明不了持久化。 */
  dbPath: string;
  /** 同步服务端根地址。离线只读/只写时可以省略。 */
  serverUrl?: string;
  /** 访问令牌。 */
  token?: string;
  /** 认证账号 id；提供后宿主启用 Vault key-package / payload codec。 */
  accountId?: string;
  /** E2EE 口令。缺失时同步会明确失败，**不会降级成明文**。 */
  password?: string;
  /** 覆盖设备 id。默认 persist 在 meta store 里（跨重启不变）。 */
  clientId?: string;
  /** 网络实现，默认 `globalThis.fetch`。仅用于测试注入。 */
  fetchImpl?: typeof fetch;
}

export interface NodeHost {
  readonly dbPath: string;
  readonly clientId: string;
  readonly engine: AppHost['engine'];

  /**
   * 创建任务。返回新任务的实体 id。
   *
   * `over` 直接透传给 `createTaskActions().create` —— 本壳**不解释**任何字段，
   * 特别是 `dueDate`：它是领域层的时间戳语义，壳只管把参数递进去。
   */
  addTask(title: string, over?: NewTaskFields): Promise<string>;
  /** 改标题（UPD op）。 */
  renameTask(entityId: string, title: string): Promise<void>;
  /** 完成 / 取消完成（UPD op）。 */
  setCompleted(entityId: string, completed: boolean): Promise<void>;
  /**
   * 软删除（`DEL` op ⇒ 墓碑 `deletedAt`，进回收站）。
   *
   * 🔴 这两条动作存在的理由是**取证探针的收尾**。本壳此前只有 create / rename /
   * complete，于是"探针跑完把自己写进真实库的任务清掉"根本没有通道 ——
   * 结果就是 R3 里产品负责人看见的那三行 `B-mac-*`：**没有删除通道的宿主，
   * 探针作者只能让残留留在用户看得见的界面上。**
   * 处置必须走 op-log（直接 SQL DELETE 只动 `state` 表，而物化状态是每次启动
   * 从 `ops` 全量回放的 ⇒ 删了会复活，且让日志与状态永久不一致）。
   */
  removeTask(entityId: string): Promise<void>;
  /**
   * 彻底删除（`purgedAt` 标记）：从回收站消失且不可恢复。
   *
   * 只能对**已软删除**的条目用（`purge` 自己拒绝活着的任务）。它**不**抹掉
   * op-log 里的历史载荷 —— 判据只能落在视图上，不能落在"日志里 grep 不到"上。
   *
   * `false` = 它已经被彻底删过，这一次没有写 op（G-8：四类同一个形状）。
   */
  purgeTask(entityId: string): Promise<boolean>;
  /** 未删除的任务，按创建时间排序。 */
  listTasks(): Task[];
  /**
   * 回收站里的任务（有 `deletedAt` 且未打 `purgedAt`）。
   *
   * 🔴 没有它，"软删除"与"彻底删除"在**这个壳上无法区分** —— 两者都会让
   * `listTasks()` 变空，于是一条"purge 之后"的判据在只做了 `remove` 时**照样绿**。
   * 判据要能区分三个状态（列表 / 回收站 / 都看不到），就必须两个视图都读得到。
   */
  listTrashed(): Task[];
  /**
   * 回收站里的**全部四路**（任务 / 便签 / 清单 / 习惯），顺序与两端界面同源。
   *
   * 🔴 这一条是 W6 的落点。原来本壳只有 `listTrashed()`（任务那一路），
   * 于是"手机删了一条清单，另一台设备的回收站里有没有它"这句话**在这个宿主上
   * 无法断言** —— 而界面两端都画得出它。合并、取标题、判序全在
   * `@heyta/domain#toTrashItems`，这里只把四路递进去（AGENTS §3.5）。
   */
  trashRows(): TrashItem[];
  /**
   * 回收站的**还原与彻底删除**，四类各有一条。
   *
   * 🔴 这一组补的是 CLI 的读宽写窄：`trashRows()` 能把四路都列出来，
   * 但原来只有任务能 purge、四类都不能 restore —— 于是 W6 的判据 ③
   * （"还原之后另一台设备读到它还活着"）在这个宿主上**只能读、不能验**，
   * 而这恰好是本壳存在的理由（把界面之外的宿主真的敲一遍）。
   * 语义（还原发哪种 op、purge 为何必须先软删除）全在 `@heyta/app-host`，
   * 这里一行都不判断（AGENTS §3.5）。
   *
   * 🔴 八个方法**一律 `Promise<boolean>`**：`false` = 这一次没有写 op（要还原的
   * 本来就在回收站外面、要 purge 的早就已经彻底删过）。四类四种形状（任务原来
   * 是 `void`）时，宿主只能在"命令跑完了"和"事情真的发生了"之间任选一个说，
   * 而 CLI 选了后者 —— 见 G-8。
   */
  restoreTask(entityId: string): Promise<boolean>;
  restoreNote(entityId: string): Promise<boolean>;
  restoreProject(entityId: string): Promise<boolean>;
  restoreHabit(entityId: string): Promise<boolean>;
  purgeNote(entityId: string): Promise<boolean>;
  purgeProject(entityId: string): Promise<boolean>;
  purgeHabit(entityId: string): Promise<boolean>;
  /**
   * 归档 / 取消归档一条清单。
   *
   * 🔴 原来这个壳**读得到** `archived` 那个字段，却没有任何一条命令写得了它 ——
   * 于是 W3/W9 那批归档出口在这台非 Web 宿主上只能被"验证读"，不能被"验证写"。
   * 归档的语义（归档清单不进任何出口、和软删除是两件事）全在
   * `@heyta/app-host#archiveProject`，这里不判断（AGENTS §3.5）。
   */
  archiveProject(entityId: string, archived?: boolean): Promise<void>;
  /**
   * 未删除的便签。
   *
   * 🔴 存在理由与 `listProjects()` 同一条：W6 的判据要读"手机上删掉的那条便签，
   * 在笔记本上还原之后是不是真的活着"，而这个壳此前**一个便签命令都没有** ——
   * 没有读通道，那条判据就只能落在"手机上看得到"这一侧，
   * 而那一侧证不了跨设备（§7 那一族"只证了半程"的假绿）。
   */
  listNotes(): Note[];
  /**
   * 未删除的清单，按 (createdAt, id) 升序。
   *
   * 🔴 这是**验收探针能不能看见新数据**的问题，不是功能问题：
   * `listTasks()` 一直不吐 `projectId`、也没有任何命令能列清单，
   * 于是"手机建的清单同步到另一台设备了吗"**无法断言** ——
   * 而没法断言的字段正是最可能在半路上丢掉的（同 `dueDate` 当初的处境）。
   */
  listProjects(): Project[];
  /**
   * 未删除的习惯。
   *
   * 🔴 补这一条不是为了多一个子命令，是因为**三态判据缺了它就退化成两态**：
   * 原来 `habits` 只有回收站那一路读通道，于是"purge 之后列表里读不到它"这一腿
   * 对习惯**永远不可判**（第一次跑的时候我把没通道当成"活着"，那条负向断言就恒不可能成立，
   * 整包当场撞红）。存在理由与 `listNotes()` / `listProjects()` 同一条（AGENTS §3.5：只直通）。
   */
  listHabits(): Habit[];

  /**
   * 未删除的标签，顺序同 `listProjects()`。
   *
   * 与 `listProjects()` 存在的理由完全相同：没有它，"手机建的标签同步到
   * 另一台设备了吗"就只能靠任务上的 `tagIds` 间接推断 ——
   * 而标签实体**自己**有没有过来（名字对不对、有没有变成墓碑）就没人看了。
   */
  listTags(): Tag[];

  /**
   * 便签的无头写入口（建 / 软删除）。
   *
   * 🔴 存在的理由不是"CLI 想多两个命令"：回收站的判据要**四类各有一条本机新建又删除的行**
   * 才能在非浏览器宿主上断言（`trash` 早就能列四类），而此前这个宿主**只能建任务** ——
   * 于是"另一台设备的回收站里有没有这条便签/清单/习惯"在这里根本没法证。
   * 语义全在 `@heyta/app-host` 的动作里，**本壳不判断任何产品语义**，只递参数。
   */
  createNote(content: string): Promise<string>;
  removeNote(entityId: string): Promise<void>;
  createProject(name: string, parentId?: string): Promise<string>;
  removeProject(entityId: string): Promise<void>;
  createHabit(name: string): Promise<string>;
  removeHabit(entityId: string): Promise<void>;

  /**
   * 助手会话的一条消息（ADR-0045 D-4 (ii)）。
   *
   * 🔴 这个壳是它**当前唯一的调用方**，而存在的理由不是"顺手给 CLI 加个命令"：
   * 会话历史跨设备这件事，判据必须是"**另一台真设备读得到**"，
   * 单测里的两台 `:memory:` 引擎证明不了真 SQLite 落盘 + 真 HTTP 上行这条链
   * （AGENTS §8 第 7 条：基础函数、单包测试不能代替功能闭环）。
   * 而 web 面板此刻正被并行会话重写（`AssistantPanel.tsx` / `aiStore.ts` /
   * `ai-assistant.ts`），所以生产 UI 的接线是**已登记的另一格**，不是这一格。
   *
   * ⚠️ 本壳**不判断任何产品语义**：`appendAssistantTurn` 逐参数透传给
   * `@heyta/app-host` 的动作层，可确认性/过期/排序全在 `@heyta/domain`
   * （AGENTS §3.5 那条线）。
   */
  newAssistantSessionId(): string;
  appendAssistantTurn(input: NewAssistantTurn): Promise<string>;
  /** 这一段会话的消息（未删除、展示顺序）。省略 sessionId = 全部会话。 */
  listAssistantTurns(sessionId?: string): AssistantTurn[];
  /** 这一条在**本设备**上算不算过期（跨设备的未确认提案 → `true`）。 */
  assistantTurnExpiredHere(turn: AssistantTurn): boolean;
  /**
   * 记录一条提案的处置（一次点击 = **一条** UPD op）。
   *
   * 🔴 这条通道存在的理由是**让"跨设备不可确认"变成一个可观察的失败**：
   * 只测读侧 `expired=yes` 的话，写侧闸门坏掉（判定被挪进界面）时
   * 这个壳上没有任何一条命令会报错 —— 于是"另一台设备确认了一条它没参与生成的
   * 写提案"这件事在真设备上**没人看得见**。有了这条命令，B 上执行它必须非零退出。
   * 拒绝本体在 `@heyta/app-host` 的 `setDisposition()`，本壳只递参数。
   */
  setAssistantDisposition(entityId: string, disposition: 'confirmed' | 'rejected'): Promise<void>;
  /** 清除一段会话：**一条** DEL op（批量域）。返回被标记的条数。 */
  clearAssistantSession(sessionId: string): Promise<number>;

  /** **唯一写入入口**（AGENTS.md §3.4）。 */
  dispatch(intent: OpIntent): Promise<void>;

  /** 与真实服务端完整同步一次。 */
  sync(): Promise<SyncStatus>;
  /** 待上传队列长度（同步后应该为 0）。 */
  pendingUploadCount(): Promise<number>;

  /**
   * 导出一份**完整保真**的文档（含全部实体、墓碑与完整 op-log）。
   *
   * 这个壳跑在**真 SQLite 文件**上，所以这条命令是"导出真的读到了全部数据"
   * 最硬的证据 —— 导出形状本身由 `@heyta/app-host` 决定，这里只负责读库。
   */
  exportDocument(): Promise<ExportDocument>;

  /**
   * 从一份导出文档**还原到空库**。
   *
   * 🔴 语义与拒绝条件全在 `@heyta/app-host` 的 `restoreIntoEmptyTarget`
   * （含"目标非空就拒绝、且什么都不写"）。**本壳不判断任何产品语义**，
   * 只把 `AppHost` 递进去 —— 它结构上就满足 `ImportTarget`。
   */
  /**
   * 收 `RestoreDocument`（`entities` 可缺省）而不是 `ExportDocument`：
   * 运维恢复工具的产物就是"只交 op-log"那一类，缺省的那一格由客户端 reducer 物化。
   */
  restoreExport(document: RestoreDocument): Promise<RestoreExportResult>;

  /** 关闭 SQLite 连接。之后不可再用。 */
  close(): void;
}

export async function openNodeHost(options: NodeHostOptions): Promise<NodeHost> {
  // 平台差异只有这一处注入。
  const app = await openAppHost({
    dbPath: options.dbPath,
    driverFactory: () => new NodeSqliteDriver(options.dbPath),
    ...(options.serverUrl !== undefined ? { serverUrl: options.serverUrl } : {}),
    ...(options.token !== undefined ? { token: options.token } : {}),
    ...(options.password !== undefined ? { password: options.password } : {}),
    ...(options.accountId !== undefined ? { accountId: options.accountId } : {}),
    ...(options.clientId !== undefined ? { clientId: options.clientId } : {}),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });

  // A non-UI host has no Vault settings screen to perform the first unlock.
  // When an account id is supplied, `openAppHost` deliberately selects the
  // Vault codec and therefore ignores the legacy password cipher. Keep that
  // unlock lazy: opening a local SQLite file and using list/add/export must
  // remain possible while the sync service is unavailable. The password stays
  // in this process only and is consumed immediately before sync.
  let vaultUnlock: Promise<void> | undefined;
  const ensureVaultUnlocked = async (): Promise<void> => {
    if (options.accountId === undefined || options.password === undefined) return;
    if (vaultUnlock !== undefined) return vaultUnlock;
    vaultUnlock = (async () => {
      const vault = await app.getVaultSession();
      if (vault?.keyPackage !== undefined && vault.state !== 'unlocked') {
        await vault.unlockWithPassphrase(options.password!);
      }
    })();
    try {
      await vaultUnlock;
    } catch (error) {
      vaultUnlock = undefined;
      throw error;
    }
  };

  const actions = createTaskActions(app);
  const projectActions = createProjectActions(app);
  const noteActions = createNoteActions(app);
  const habitActions = createHabitActions(app);
  // 🔴 本设备 id 由 `openAppHost` 持久化决定（跨重启同一个），这里只是把它递给动作层。
  // 递错了或留空，"跨设备的未确认提案不可确认"那条判据就会整个失效 ——
  // 所以 `createAssistantSessionActions` 对空值**直接抛**而不是回退。
  const assistantActions = createAssistantSessionActions(app, { clientId: app.clientId });

  return {
    dbPath: app.dbPath,
    clientId: app.clientId,
    engine: app.engine,

    addTask: (title, over) => actions.create(title, over),
    renameTask: (entityId, title) => actions.rename(entityId, title),
    setCompleted: (entityId, completed) => actions.setCompleted(entityId, completed),
    removeTask: (entityId) => actions.remove(entityId),
    purgeTask: (entityId) => actions.purge(entityId),
    listTasks: () => actions.listTasks(),
    listTrashed: () => actions.listTrashed(),
    trashRows: () =>
      toTrashItems({
        tasks: actions.listTrashed(),
        notes: noteActions.listTrashed(),
        projects: projectActions.listTrashedProjects(),
        habits: habitActions.listTrashedHabits(),
      }),
    restoreTask: (entityId) => actions.restore(entityId),
    restoreNote: (entityId) => noteActions.restoreNote(entityId),
    restoreProject: (entityId) => projectActions.restoreProject(entityId),
    restoreHabit: (entityId) => habitActions.restoreHabit(entityId),
    purgeNote: (entityId) => noteActions.purgeNote(entityId),
    purgeProject: (entityId) => projectActions.purgeProject(entityId),
    purgeHabit: (entityId) => habitActions.purgeHabit(entityId),
    archiveProject: (entityId, archived) => projectActions.archiveProject(entityId, archived),
    listNotes: () => noteActions.listNotes(),
    listProjects: () => projectActions.listProjects(),
    listHabits: () => habitActions.listHabits(),
    listTags: () => projectActions.listTags(),

    createNote: (content) => noteActions.createNote(content),
    removeNote: (entityId) => noteActions.removeNote(entityId),
    createProject: (name, parentId) =>
      parentId === undefined
        ? projectActions.createProject(name)
        : projectActions.createProject(name, parentId),
    removeProject: (entityId) => projectActions.removeProject(entityId),
    createHabit: (name) => habitActions.createHabit(name),
    removeHabit: (entityId) => habitActions.removeHabit(entityId),

    newAssistantSessionId: () => assistantActions.newSessionId(),
    appendAssistantTurn: (input) => assistantActions.appendTurn(input),
    listAssistantTurns: (sessionId) =>
      sessionId === undefined
        ? assistantActions.allTurns()
        : assistantActions.turnsOf(sessionId),
    assistantTurnExpiredHere: (turn) => assistantActions.isExpiredHere(turn),
    setAssistantDisposition: (entityId, disposition) =>
      assistantActions.setDisposition(entityId, disposition),
    clearAssistantSession: (sessionId) => assistantActions.clearSession(sessionId),

    dispatch: (intent) => app.dispatch(intent),
    sync: async () => {
      await ensureVaultUnlocked();
      return app.sync();
    },
    pendingUploadCount: () => app.pendingUploadCount(),
    exportDocument: () => exportDocumentFromHost(app, { exportedAt: Date.now(), host: 'node' }),
    restoreExport: (document) => restoreIntoEmptyTarget(app, document),
    close: () => {
      app.close();
    },
  };
}

/** 当前物化状态（诊断用）。 */
export { materializedState };
export type { EntityType };
