/**
 * 通用「数据源连接器」契约（TypeScript）
 * ====================================
 *
 * 参照 WeKnora（Go）`internal/datasource/connector.go` 的成熟设计，抽成 heyta 可用的
 * 最小骨架。用途：把**外部服务**（ICS 订阅、RSS、以后的 Google/Outlook/飞书…）的
 * 数据拉进来，落成 heyta 的实体（`CALENDAR_EVENT` / 任务等）。
 *
 * ## 为什么要有这一层（而不是每个数据源各写一套 fetch）
 *
 * 每个连接器真正不同的只有三件事：**鉴权**、**资源枚举**、**外部数据长什么样**。
 * 其余（增量游标、删除对账、失败不动缓存、限流重试、调度）对所有源都相同。
 * 把「相同的」收敛到契约与调用方，各连接器只实现差异 —— 这是 WeKnora 那套最值钱的点。
 *
 * ## 可选能力接口（不是每个连接器都要实现全套）
 *
 * · `StreamingConnector`：边拉边 `emit`、按页 `checkpoint`，大源可断点续传。
 * · 没有实现的连接器回退到 `fetchAll` / `fetchIncremental`。
 * 用 TS 的可选方法 + 类型守卫（`isStreaming`）表达，等价于 Go 的接口断言。
 *
 * 🔴 **游标必须是「完整可恢复快照」，不是 delta**：中途超时要能从检查点续跑，
 * 全量同步也要能拿旧游标做删除对账（见 WeKnora `StreamHandler.Checkpoint` 注释）。
 */

/** 一次增量同步的游标。`connectorCursor` 由各连接器自定义，但必须是完整快照。 */
export interface SyncCursor {
  /** 上次成功同步的本地毫秒时间戳（仅用于节流/展示，不参与业务裁决）。 */
  readonly lastSyncTime?: number;
  /** 连接器自定义游标（分页 token / 每项指纹表 / 版本号表…）。 */
  readonly connectorCursor: Readonly<Record<string, unknown>>;
  /** 连接器 schema 版本，用于旧游标升级。 */
  readonly schemaVersion?: number;
}

/** 可被同步的外部资源（文档 / 空间 / 文件夹 / 一个 feed…）。 */
export interface ConnectorResource {
  readonly externalId: string;
  readonly name: string;
  readonly type: string;
  readonly parentId?: string;
  readonly hasChildren?: boolean;
  readonly url?: string;
}

/** 拉回来的一项（已归一成连接器无关的形状；调用方再映射成业务实体）。 */
export interface FetchedItem {
  /** 外部唯一 id —— 去重/更新的主键。 */
  readonly externalId: string;
  readonly title: string;
  /** 载荷（通常是 JSON / Markdown 文本）；映射由调用方按 `contentType` 决定。 */
  readonly content: string;
  readonly contentType: string;
  /** 源侧更新时间（毫秒）。没有就省略，绝不拿本机时刻冒充。 */
  readonly updatedAt?: number;
  /** 源侧已删除（软删）。删除对账也可以靠"完整遍历后仍缺席"推断。 */
  readonly isDeleted?: boolean;
  readonly metadata?: Readonly<Record<string, string>>;
}

/** 连接器身份/鉴权元数据 —— 前端据此渲染"怎么连"。 */
export interface ConnectorMetadata {
  readonly type: string;
  readonly name: string;
  readonly description?: string;
  /** `oauth2 | api_key | token | password | none | custom`（与 WeKnora 同词表）。 */
  readonly authType: 'oauth2' | 'api_key' | 'token' | 'password' | 'none' | 'custom';
  readonly capabilities: readonly ('incremental' | 'deletion_sync' | 'hierarchical' | 'streaming')[];
  readonly priority?: number;
}

/**
 * 每个连接器必须实现的核心接口。
 *
 * `C` 是连接器配置类型（凭据 + 非密钥设置 + 已选资源）。调用方负责**在落库前**把
 * 凭据加密、且响应里永不回传凭据（对齐 WeKnora 的三段式 `credentials/settings/resourceIds`）。
 */
export interface Connector<C = unknown> {
  readonly type: string;
  /** 测连通 + 校验证书；抛 `ConnectorError` 即视为配置不可用。 */
  validate(config: C): Promise<void>;
  /** 列可同步资源；`parentId=""` 返回顶层，非空返回其直接子级（懒加载树）。 */
  listResources(config: C, parentId?: string): Promise<readonly ConnectorResource[]>;
  /** 全量拉取指定资源。 */
  fetchAll(config: C, resourceIds: readonly string[]): Promise<readonly FetchedItem[]>;
  /** 增量拉取。返回变更项 + 新游标；游标必须是完整快照。 */
  fetchIncremental(
    config: C,
    cursor: SyncCursor | undefined,
  ): Promise<{ readonly items: readonly FetchedItem[]; readonly cursor: SyncCursor }>;
}

/** 流式回调：逐项摄入 + 分页边界持久化完整游标。 */
export interface StreamHandler {
  emit(item: FetchedItem): Promise<void>;
  checkpoint(cursor: SyncCursor): Promise<void>;
}

/** 可选：支持流式/断点续传的连接器。 */
export interface StreamingConnector<C = unknown> extends Connector<C> {
  fetchStream(
    config: C,
    cursor: SyncCursor | undefined,
    handler: StreamHandler,
  ): Promise<SyncCursor>;
}

/** 类型守卫：等价于 Go 的接口断言。 */
export function isStreaming<C>(connector: Connector<C>): connector is StreamingConnector<C> {
  return typeof (connector as Partial<StreamingConnector<C>>).fetchStream === 'function';
}

/** 连接器错误码（哨兵）。调用方按 code 决定 UI 文案 / 是否重试。 */
export type ConnectorErrorCode =
  | 'invalid_config'
  | 'invalid_credentials'
  | 'resource_not_found'
  | 'fetch_failed'
  | 'bad_shape'
  | 'sync_canceled';

export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ConnectorError';
  }
}

/** 连接器注册表（启动时集中 register；前端用 metadata 渲染列表）。 */
export class ConnectorRegistry {
  private readonly connectors = new Map<string, Connector<unknown>>();
  private readonly metadata = new Map<string, ConnectorMetadata>();

  register<C>(connector: Connector<C>, meta: ConnectorMetadata): void {
    if (this.connectors.has(connector.type)) {
      throw new ConnectorError('invalid_config', `connector already registered: ${connector.type}`);
    }
    this.connectors.set(connector.type, connector as Connector<unknown>);
    this.metadata.set(connector.type, meta);
  }

  get(type: string): Connector<unknown> {
    const found = this.connectors.get(type);
    if (found === undefined) {
      throw new ConnectorError('resource_not_found', `unknown connector: ${type}`);
    }
    return found;
  }

  list(): readonly ConnectorMetadata[] {
    return [...this.metadata.values()].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }
}
