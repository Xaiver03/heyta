/**
 * 同步 / 冲突（共享模型）
 * ========================
 *
 * M3 第四刀（sync）的**判断层**：同步状态 → 严重度 / 颜色 token / 字形 /
 * 可用动作，失败原因 → 共享词条 key，以及冲突解决里那几个"人不需要重新想一遍"
 * 的判定（哪一侧较新、默认强调哪一边、"保留远端"为什么点不了、
 * 载荷摘要该说哪一句）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这些判断要从两端收上来（这里有一次**真实的、已存在的漂移**）
 *
 * 迁之前两端各有一套：
 *
 *   | 状态      | web `store.statusColorToken` | mobile `status-text.statusTone` |
 *   |-----------|------------------------------|---------------------------------|
 *   | `offline` | `color.warning`（警示）       | `'muted'`（不是错误）            |
 *   | `syncing` | `color.info`                 | `'default'`（普通前景）          |
 *   | `conflict`| `color.warning`              | `'danger'`                      |
 *
 * 三行里有**三行对不上**，而且没有任何测试会红 —— 同一个同步状态
 * 在浏览器和手机上呈现成"要紧 / 不要紧 / 是故障"三种不同的态度。
 * 这正是 `docs/research/dida-view-unification.md` §1.4 说的那件事：
 * **统一来自契约，不是来自把样式表合并。**
 *
 * 本文件把语义定死一遍（`syncStatusSeverity`），两端都从它派生。
 *
 * ✅ M3 第四刀（sync）的**收尾**（本轮）：移动端 `status-text.ts` 的
 * `statusTone` 已改成 `syncStatusSeverity` 的**纯投影**，本地那份 `switch`
 * 与重复的失败原因表都删了；实体名 / 冲突原因两张表也从
 * `ConflictDialog.tsx` 与 `conflict-view.ts` 收进本文件（见第四节）。
 * 共享层给出的答案选的是移动端那一版语义（`offline` **不是**错误），理由见下。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件**不 import `react-native`，也不 import `@heyta/i18n` / `@heyta/sync-client`**
 *
 *   · `react-native`：`packages/ui/vitest.config.ts` 跑在 **node** 环境，
 *     它解析不了 RN 的 Flow 源码。这条约束顺带钉住了"model 必须宿主无关"。
 *   · `@heyta/i18n`：那个包曾自带一份 React，四端会同时中招
 *     （见 `TaskList.tsx` 文件头）。所以这里只产出**词条 key 的字面量**，
 *     不 import 任何取词函数。
 *   · `@heyta/sync-client`：`packages/ui` 的 `package.json` 里没有这条依赖，
 *     而引一条新依赖要过 AGENTS.md §3.1–3.2 两道门 + 许可证登记。
 *     所以这里定义**结构上兼容**的输入类型（`ConflictInfo` / `SyncStatus`
 *     天然可赋值给它），并且**不重写** `compareConflictFreshness` /
 *     `summarizeConflictPayload` —— 那两条规则仍然只有 `@heyta/sync-client`
 *     一份实现，由宿主调用后把结果传进来。
 */

/* ========================================================================
 * 一、同步状态 → 严重度 / 颜色 / 字形 / 可用动作
 * ====================================================================== */

/** 与 `@heyta/sync-client#SyncStatus` 的 `kind` 逐字同源。 */
export type SyncStatusKind = 'idle' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error';

/**
 * 状态的最少形状。
 *
 * 🔴 刻意**不是** `SyncStatus`：那样就要 import `@heyta/sync-client`（见文件头）。
 * 结构上兼容意味着宿主可以直接把 `SyncStatus` 传进来，而 `kind` 上多一个成员
 * 会让宿主**编译失败** —— 新增同步状态时必须回来改这里，而不是安静地
 * 落到某个 `default` 分支上（本仓库反复吃过的形状）。
 */
export interface SyncStatusLike {
  readonly kind: SyncStatusKind;
  readonly phase?: 'upload' | 'download' | undefined;
  /**
   * 失败原因。
   *
   * ⚠️ 类型是 `string` 而不是 `SyncFailureReason` 的字面量联合：`SyncStatus`
   * 的 `reason` 是穷尽联合，够窄了；这里宽一格是为了不让共享层复制一份
   * 那份联合（复制出来的联合**不会**跟着 sync-client 更新）。
   * 查表未命中一律返回 `undefined`（= 走宿主自己的诊断通道），不编一句。
   */
  readonly reason?: string | undefined;
  /**
   * 意外异常的技术细节（只有 `reason === 'unexpected'` 时才有意义）。
   *
   * 🔴 它是**诊断数据**，不是文案：宿主把它当参数插进自己那句本地化好的话里
   * （`Sync error: {message}`），不翻译、也不映射成词条。
   */
  readonly message?: string | undefined;
  readonly conflicts?: readonly unknown[] | undefined;
}

/**
 * 语义严重度。**颜色、图标、动作全部从它派生**，不再各判一次。
 *
 *   · `neutral`：正常但用户不需要动作（`idle` / `offline`）。
 *     🔴 `offline` **不是错误** —— 本地优先的应用离线是正常工作状态，
 *     标成警示色会让用户以为出了问题（移动端原注释记的就是这条）。
 *   · `progress`：正在进行。
 *   · `success`：达成了。
 *   · `attention`：需要用户做一件事（选一边），但它不是故障。
 *   · `failure`：真的出错了，用户要去看/去修。
 */
export type SyncSeverity = 'neutral' | 'progress' | 'success' | 'attention' | 'failure';

/**
 * 同步界面会用到的**颜色 token 名**。
 *
 * 🔴 刻意不是 `TokenName`（那是全部 token 的联合，含间距/圆角等数字 token）。
 * 标成 `TokenName` 会让 `tokens[token]` 的类型变成 `string | number`，
 * 喂给 `color` 直接编译不过 —— 而下面这个联合每一项都是**颜色**。
 *
 * 🔴 用 `*-strong` 而不是 `color.success` / `color.info` 那一档：
 * `design-system` 的对比度测试只登记了 `*-strong` 作为**正文文字色**
 * （见 `tokens.ts` 的 CONTRAST_PAIRS：「错误文字」「成功文字」「警告文字」「信息文字」）。
 * 同步状态条里的字是**小号正文**，用图形色是"能渲染但可能不达标"。
 */
export type SyncColorToken =
  | 'color.foreground-muted'
  | 'color.info-strong'
  | 'color.success-strong'
  | 'color.warning-strong'
  | 'color.danger-strong';

const SEVERITY_COLOR: Record<SyncSeverity, SyncColorToken> = {
  neutral: 'color.foreground-muted',
  progress: 'color.info-strong',
  success: 'color.success-strong',
  attention: 'color.warning-strong',
  failure: 'color.danger-strong',
};

/** 状态 → 严重度。**唯一的一处**。 */
export function syncStatusSeverity(status: SyncStatusLike): SyncSeverity {
  switch (status.kind) {
    case 'idle':
      // 还没配 / 还没跑过。不是错误，也不催用户。
      return 'neutral';
    case 'syncing':
      return 'progress';
    case 'synced':
      return 'success';
    case 'offline':
      // 🔴 不是 warning：离线是本地优先应用的**正常工作状态**。
      return 'neutral';
    case 'conflict':
      // 需要用户做一个选择，但两边数据都在 —— 是 attention，不是 failure。
      return 'attention';
    case 'error':
      return 'failure';
    default: {
      // 穷尽性检查：`SyncStatusKind` 新增成员时**编译报错**，
      // 而不是安静地给一个默认色。
      const never: never = status.kind;
      return String(never) as SyncSeverity;
    }
  }
}

/** 状态 → 文字颜色 token 名。 */
export function syncStatusColorToken(status: SyncStatusLike): SyncColorToken {
  return SEVERITY_COLOR[syncStatusSeverity(status)];
}

/**
 * 状态 → 字形族。
 *
 * 🔴 刻意是**语义名**而不是某个图标组件：图标数据来自 `lucide`，
 * 由宿主/组件映射（web 与 RN 用的是同一份 `lucide` 数据，见 `icon/Icon.tsx`），
 * 而"这个状态该画什么"只有这里一处。返回组件会把这个文件拖进 React。
 */
export type SyncGlyph = 'check' | 'spinner' | 'cloud-off' | 'alert';

export function syncStatusGlyph(status: SyncStatusLike): SyncGlyph {
  switch (status.kind) {
    case 'synced':
      return 'check';
    case 'syncing':
      return 'spinner';
    case 'offline':
      return 'cloud-off';
    case 'conflict':
    case 'error':
      // 冲突与错误共用警示字形（措辞由文案区分）—— 两者都需要用户注意。
      return 'alert';
    case 'idle':
      // 还没同步过：云被划掉比"打个勾"诚实 —— 打勾会让人以为数据已经上云。
      return 'cloud-off';
    default: {
      const never: never = status.kind;
      return String(never) as SyncGlyph;
    }
  }
}

/** 同步状态条上有哪些动作是**有意义**的。 */
export interface SyncStatusAffordances {
  /**
   * 「立即同步」此刻能不能点。
   *
   * 🔴 `syncing` 时必须禁用：`SyncClient` 没有为并发调用设计，
   * 两条并行同步会互相推进游标。点了没有反馈的按钮比没有按钮更糟。
   */
  readonly canSyncNow: boolean;
  /**
   * 要不要给「处理冲突」的**看得见入口**。
   *
   * 冲突对话框关掉之后仍然要有入口 —— 否则问题从"没法解决"变成"看不见了"。
   */
  readonly needsResolution: boolean;
  /**
   * 要不要给「查看帮助」。
   *
   * 🔴 只在 `error` 时给：`idle` / `offline` 旁边本来就有能点的出路
   * （设置 / 重试），再给一条帮助链接会稀释真正的出路。
   */
  readonly showsHelp: boolean;
}

export function syncStatusAffordances(status: SyncStatusLike): SyncStatusAffordances {
  return {
    canSyncNow: status.kind !== 'syncing',
    needsResolution: status.kind === 'conflict',
    showsHelp: status.kind === 'error',
  };
}

/** 正在同步（用于禁用一切会并发触发同步的按钮）。 */
export function syncStatusBusy(status: SyncStatusLike): boolean {
  return status.kind === 'syncing';
}

/* ========================================================================
 * 二、失败原因 → 共享词条 key
 * ====================================================================== */

/**
 * 已知同步失败原因的**共享词条 key**。
 *
 * 🔴 这些 key 住在 `common.sync.error.*`，**不是** `web.*` / `mobile.*`：
 * 两端对同一种失败说的是同一句话，本来就该只有一份词条。
 * 而这条"原因 → key"的路由此前在两个壳里各写了一份
 * （`apps/web/src/features/sync/sync-failure-copy.ts` 与
 * `apps/mobile/src/sync/status-text.ts`，连注释都互相引用），
 * 现在收在这里一份。
 *
 * ⚠️ 为什么不放进 `packages/i18n`：那个包是**领域无关**的，
 * 让它 import `@heyta/sync-client` 的 `SyncFailureReason` 会把词条表
 * 和一个业务包焊死。这里只写**字符串字面量**，key 由词条表的类型系统在宿主侧校验。
 */
export type SyncFailureMessageKey =
  | 'common.sync.error.notConfigured'
  | 'common.sync.error.notSignedIn'
  | 'common.sync.error.noPassword'
  | 'common.sync.error.localOpMissing'
  | 'common.sync.error.remoteVersionUnavailable'
  | 'common.sync.error.undecryptableOps'
  | 'common.sync.error.undecryptablePage'
  | 'common.sync.error.uploadRejected'
  | 'common.sync.error.unauthorized';

const SYNC_FAILURE_MESSAGE_KEY: Record<string, SyncFailureMessageKey> = {
  'not-configured': 'common.sync.error.notConfigured',
  'not-signed-in': 'common.sync.error.notSignedIn',
  'no-encryption-password': 'common.sync.error.noPassword',
  'local-op-missing': 'common.sync.error.localOpMissing',
  'remote-version-unavailable': 'common.sync.error.remoteVersionUnavailable',
  'undecryptable-ops': 'common.sync.error.undecryptableOps',
  'undecryptable-page': 'common.sync.error.undecryptablePage',
  'upload-rejected': 'common.sync.error.uploadRejected',
  // 令牌被服务端拒了：句子必须同时说"为什么停下"和"本地数据没事"，
  // 否则用户的第一反应是删库重装 —— 而那才是真的会丢东西的动作。
  'unauthorized': 'common.sync.error.unauthorized',
};

/**
 * 已知原因 → 词条 key；**认不出来就返回 `undefined`，不编一句**。
 *
 * `'unexpected'` 走的是另一条通道（`message` 是真正的诊断数据，
 * 由宿主拼进它自己的那句话里），所以它也返回 `undefined`。
 */
export function syncFailureMessageKey(reason: string | undefined): SyncFailureMessageKey | undefined {
  if (reason === undefined) return undefined;
  return SYNC_FAILURE_MESSAGE_KEY[reason];
}

/* ========================================================================
 * 三、冲突解决
 * ====================================================================== */

/** 用户能做的两个选择。与 `SyncClient.resolveConflict` 的第二个参数同形。 */
export type ConflictChoice = 'keep-local' | 'keep-remote';

/** 一侧的标识。 */
export type ConflictSideKind = 'local' | 'remote';

/** 冲突的一方。与 `@heyta/sync-client#ConflictSide` 结构兼容（少即是多）。 */
export interface ConflictSideLike {
  readonly timestamp: number;
  readonly payload: unknown;
}

/**
 * 一处需要用户决定的冲突。与 `@heyta/sync-client#ConflictInfo` 结构兼容。
 *
 * 🔴 这里**刻意不复制 `opId` / `clientId` 等字段的类型**：宿主把真实的
 * `ConflictInfo` 传进来、共享层原样交回去（`onResolve`），
 * 所以"解决冲突时必须带着真 `opId`"这条纪律不会被视图模型截断
 * （移动端 `ConflictSheet` 的注释记过一次真实事故：拿视图模型去凑一个对象
 * 会让解决**必然失败**）。
 */
export interface ConflictLike {
  readonly id: string;
  readonly entityType: string;
  readonly reason: string;
  readonly errorCode?: string | undefined;
  readonly local: ConflictSideLike;
  readonly remote?: ConflictSideLike | undefined;
}

/**
 * 「谁较新」。
 *
 * ⚠️ **不由本文件计算**：规则只有 `@heyta/sync-client#compareConflictFreshness`
 * 一份实现（含"时间戳相等 → 两边都不标"那条修正）。宿主调用它，
 * 把结果传进来；这里只消费。
 */
export interface ConflictFreshness {
  readonly localNewer: boolean;
  readonly remoteNewer: boolean;
}

/** 拿不到对端时两边都不标 —— 与 `compareConflictFreshness` 的返回同形。 */
export const NO_CONFLICT_FRESHNESS: ConflictFreshness = { localNewer: false, remoteNewer: false };

/** 一侧 → 该侧的选择值。顺序只有这一处定义。 */
export function conflictChoiceForSide(side: ConflictSideKind): ConflictChoice {
  return side === 'local' ? 'keep-local' : 'keep-remote';
}

/**
 * **默认强调哪一边**（= 较新的那一边）。平手或拿不到对端时 `undefined`
 * （"分不出来就如实说分不出来"，不硬挑一个）。
 *
 * ⚠️ 它**只影响视觉强调**（哪个按钮是主色），**不是裁决依据** ——
 * 真正的裁决在 `sync-core` 的 LWW；"分不出来"的那些正是刻意交到人手上的。
 * 用自动选边代替用户点击 = 静默丢掉另一边。
 */
export function preferredConflictSide(
  freshness: ConflictFreshness,
): ConflictSideKind | undefined {
  if (freshness.localNewer === freshness.remoteNewer) return undefined;
  return freshness.localNewer ? 'local' : 'remote';
}

/**
 * 为什么某个选择**点不了**。`undefined` = 可以点。
 *
 * 只把按钮置灰不给理由，用户唯一能做的是反复点它 —— 与 `SyncStatus`
 * 那种"每种失败都要说清是哪一种"是同一条纪律。
 */
export type ConflictBlockedReason = 'remote-missing';

export function conflictBlockedReason(
  remoteAvailable: boolean,
  choice: ConflictChoice,
): ConflictBlockedReason | undefined {
  if (choice === 'keep-remote' && !remoteAvailable) return 'remote-missing';
  return undefined;
}

/** 某个选择此刻能不能点。 */
export function conflictCanChoose(remoteAvailable: boolean, choice: ConflictChoice): boolean {
  return conflictBlockedReason(remoteAvailable, choice) === undefined;
}

/**
 * 查"冲突原因"该用哪个码。
 *
 * 🔴 `errorCode ?? reason` 这条顺序此前只在移动端有（且注释记着一次真实事故：
 * 只传 `reason` 时那张表**一次都没命中过**，界面上漏出一整句英文）。
 * 共享层把它定成唯一的一处：服务端冲突有 `errorCode`；
 * `sync-core` 的 LWW 自动判定没有错误码，但它的 `reason` 本身就是编码
 * （`remote-archive` 等）。两者共用同一张表。
 */
export function conflictLookupCode(conflict: Pick<ConflictLike, 'errorCode' | 'reason'>): string {
  return conflict.errorCode ?? conflict.reason;
}

/**
 * 载荷摘要。与 `@heyta/sync-client#ConflictPayloadSummary` 结构兼容。
 *
 * ⚠️ **判断不在这里**：哪个字段能当标题，由
 * `@heyta/sync-client#summarizeConflictPayload` 决定（那是唯一知道载荷形状的
 * 地方）。所以视图接收的是**已经算好的**摘要，只负责"怎么摆"。
 * 这一点是刻意的：把 `summarizeConflictPayload` 在共享层再写一遍，
 * 就是本仓库已经吃过两次亏的那种漂移。
 */
export type ConflictPayloadSummaryLike =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'fields'; readonly fields: readonly unknown[] }
  | { readonly kind: 'empty' };

/**
 * 摘要 → 用哪一句措辞。
 *
 *   · `text` → **用户自己的字**（任务标题、清单名…），直接显示、不翻译；
 *   · `fields` → 只报**数量**，绝不列字段名（`completedAt` 那种内部标识符
 *     出现在用户可见文案里正是门禁要拦的东西）；
 *   · `empty` → 专门词条。空载荷与"取不到这一侧"是**两回事**，不能混。
 */
export type ConflictSummaryStyle =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'fieldCount'; readonly count: number }
  | { readonly kind: 'empty' };

export function conflictSummaryStyle(summary: ConflictPayloadSummaryLike): ConflictSummaryStyle {
  switch (summary.kind) {
    case 'text':
      return { kind: 'text', text: summary.text };
    case 'fields':
      return { kind: 'fieldCount', count: summary.fields.length };
    case 'empty':
      return { kind: 'empty' };
    default: {
      const never: never = summary;
      // 走到这里说明 `ConflictPayloadSummaryLike` 新增了成员而这里没跟上。
      // 返回一个**不可能被当成正常摘要**的值，而不是悄悄当成 `empty`。
      return String(never) as unknown as ConflictSummaryStyle;
    }
  }
}

/* ========================================================================
 * 四、实体名 / 冲突原因 → 共享词条 key
 * ====================================================================== */

/**
 * 实体类型 → 名称词条 key。
 *
 * 🔴 **为什么这两张表必须收上来**（这是本轮的第二个真实漂移面）：
 *
 * 迁之前"哪些实体有名字"这件事在仓库里有**两份**：
 *   · `apps/web/src/features/sync/ConflictDialog.tsx` 的 `ENTITY_LABEL_KEYS`；
 *   · `apps/mobile/src/sync/conflict-view.ts` 的 `ENTITY_LABEL_KEYS` / `REASON_KEYS`。
 *
 * 两者的**词条 key 相同**，所以同一句文案不会漂移；会漂移的是**集合本身** ——
 * 加一个新实体（或一条新冲突原因）只改一端时，另一端**不会报错、也没有测试会红**，
 * 只会静默地把它显示成 `AI_FEEDBACK` 这种内部标识符。这正是
 * `docs/research/dida-view-unification.md` 反复说的那个形状：**规则只有一份，
 * 它在哪里，答案就在哪里。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么 key 用 `common.*` 而不是继续借 `mobile.*`
 *
 * 实体名与冲突原因是**两个端对同一件事的同一句话**，本来就该只有一份词条。
 * 之前 web 借 `mobile.entity.*` 是"能用但命名空间是错的"
 * （`ConflictDialog.tsx` 的旧注释自己记着这条债）。本轮把两端一起切到
 * `common.entity.*` / `common.conflict.reason.*` —— 共享层从此不再出现
 * 任何宿主专属命名空间的字面量。
 *
 * ⚠️ **旧 key 不删**：`mobile.entity.*` / `mobile.conflict.reason.*` 仍在词条表里
 * （那两张表是"只许追加"的共享文件，删键是别人的改动）。它们今天已无调用点，
 * 属于一笔**已登记的死词条债** —— 最小的一步是下次有人动 i18n 时顺手删掉，
 * 而不是在本轮越界改别人的块。
 *
 * ⚠️ 取值来自 `@heyta/shared-schema` 的 `ENTITY_TYPES`（那一份是唯一的）。
 * 这里**不 import 它**（共享层不能为一张查表引一条新依赖），
 * 有测试把本表的键集合与 `@heyta/op-log` 的
 * `MODELED_ENTITY_TYPES` / `UNMODELED_ENTITY_TYPES`（那份清单由
 * `entity-coverage` 测试钉在 `ENTITY_TYPES` 上）对齐 —— 漏一个会红。
 */
export type EntityLabelKey =
  | 'common.entity.TASK'
  | 'common.entity.PROJECT'
  | 'common.entity.TAG'
  | 'common.entity.NOTE'
  | 'common.entity.TASK_REPEAT_CFG'
  | 'common.entity.REMINDER'
  | 'common.entity.HABIT'
  | 'common.entity.HABIT_LOG'
  | 'common.entity.FOCUS_SESSION'
  | 'common.entity.AI_FEEDBACK'
  | 'common.entity.PREFERENCE_CORRECTION'
  | 'common.entity.GLOBAL_CONFIG'
  | 'common.entity.MIGRATION'
  | 'common.entity.RECOVERY'
  | 'common.entity.ALL';

/** 唯一的实体 → 名称 key 表。 */
export const ENTITY_LABEL_KEYS: Record<string, EntityLabelKey> = {
  TASK: 'common.entity.TASK',
  PROJECT: 'common.entity.PROJECT',
  TAG: 'common.entity.TAG',
  NOTE: 'common.entity.NOTE',
  TASK_REPEAT_CFG: 'common.entity.TASK_REPEAT_CFG',
  REMINDER: 'common.entity.REMINDER',
  HABIT: 'common.entity.HABIT',
  HABIT_LOG: 'common.entity.HABIT_LOG',
  FOCUS_SESSION: 'common.entity.FOCUS_SESSION',
  // 🔴 AI 记忆实体。**冲突面板需要它们的名字** —— 这两种实体也会同步、也会冲突，
  // 用户看到 `AI_FEEDBACK` 不可能知道是什么东西，也就没法在冲突里做选择。
  AI_FEEDBACK: 'common.entity.AI_FEEDBACK',
  PREFERENCE_CORRECTION: 'common.entity.PREFERENCE_CORRECTION',
  GLOBAL_CONFIG: 'common.entity.GLOBAL_CONFIG',
  MIGRATION: 'common.entity.MIGRATION',
  RECOVERY: 'common.entity.RECOVERY',
  ALL: 'common.entity.ALL',
};

/** 实体类型 → key；**认不出来返回 `undefined`，不编一个名字**。 */
export function entityLabelKey(entityType: string): EntityLabelKey | undefined {
  return ENTITY_LABEL_KEYS[entityType];
}

/**
 * 宿主注入的取词函数最小形状。
 *
 * 🔴 参数是**收窄后的 key 联合**而不是 `string`：宿主传进来的 `t` 只接受
 * `MessageKey`，写成 `(key: string) => string` 反而**接不上**
 * （`string` 比 `MessageKey` 宽，函数参数是逆变的）。收窄成这里的联合之后，
 * 宿主调用点会顺带校验"这些字面量真的在词条表里"。
 */
export type EntityLabelText = (key: EntityLabelKey) => string;

/**
 * 实体类型 → 当前语言的实体名。
 *
 * 认不出来的实体**原样返回类型名**（不编一个名字，也不吞掉）——
 * 编一个"未知实体"会让用户以为那是一个真的东西，而原样显示至少能被搜到。
 */
export function entityLabelOf(entityType: string, text: EntityLabelText): string {
  const key = ENTITY_LABEL_KEYS[entityType];
  return key === undefined ? entityType : text(key);
}

/**
 * 冲突原因（服务端错误码 **或** LWW 判定的编码）→ 词条 key。
 *
 * 🔴 查表用哪个字段由 `conflictLookupCode`（`errorCode ?? reason`）决定；
 * 这里只负责"编码 → key"。枚举刻意不完备 —— `reason` 还有服务端那句英文诊断，
 * 认不出来就走兜底，绝不回落成原始字符串。
 */
export type ConflictReasonKey =
  | 'common.conflict.reason.concurrent'
  | 'common.conflict.reason.superseded'
  | 'common.conflict.reason.timestampOrTie'
  | 'common.conflict.reason.localTimestamp'
  | 'common.conflict.reason.remoteDeleteWins'
  | 'common.conflict.reason.localDeleteWins'
  | 'common.conflict.reason.remoteArchive'
  | 'common.conflict.reason.localArchive'
  | 'common.conflict.reason.fallback';

/** 唯一的"原因编码 → key"表。 */
export const CONFLICT_REASON_KEYS: Record<string, ConflictReasonKey> = {
  CONFLICT_CONCURRENT: 'common.conflict.reason.concurrent',
  CONFLICT_SUPERSEDED: 'common.conflict.reason.superseded',
  'remote-timestamp-or-tie': 'common.conflict.reason.timestampOrTie',
  'local-timestamp': 'common.conflict.reason.localTimestamp',
  'remote-delete-wins': 'common.conflict.reason.remoteDeleteWins',
  'local-delete-wins': 'common.conflict.reason.localDeleteWins',
  'remote-archive': 'common.conflict.reason.remoteArchive',
  'local-archive': 'common.conflict.reason.localArchive',
  'local-archive-sibling': 'common.conflict.reason.localArchive',
};

/**
 * 认不出来时用的兜底 key。
 *
 * 🔴 **不能回落成原始字符串**（那是英文诊断），也不能什么都不说 ——
 * "两边到底发生了什么"是用户做选择的前提。兜底句必须**通用但仍然准确**：
 * 它确实描述了所有进入这张表的冲突的共同点（两边对同一处做了不同改动）。
 * 真正的诊断信息在 `ConflictInfo.reason` 里，留给日志。
 */
export const CONFLICT_REASON_FALLBACK_KEY = 'common.conflict.reason.fallback' as const;

/** 原因编码 → key；认不出来返回 `undefined`（由调用方决定兜底）。 */
export function conflictReasonKey(codeOrReason: string): ConflictReasonKey | undefined {
  return CONFLICT_REASON_KEYS[codeOrReason];
}

/** 宿主注入的取词函数最小形状（理由同 `EntityLabelText`）。 */
export type ConflictReasonText = (key: ConflictReasonKey) => string;

/** 原因编码 → 当前语言的文案。查不到走兜底句，**绝不回落成原始字符串**。 */
export function conflictReasonLabelOf(
  codeOrReason: string,
  text: ConflictReasonText,
): string {
  return text(CONFLICT_REASON_KEYS[codeOrReason] ?? CONFLICT_REASON_FALLBACK_KEY);
}
