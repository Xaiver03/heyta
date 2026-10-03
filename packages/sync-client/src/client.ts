/**
 * 同步客户端
 * ============
 *
 * 把本地 op-log 接到 P0 已验证的服务端协议。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 两条**实测发现**直接落进这个实现（见 docs/runbooks/local-server-verification.md）：
 *
 *   1. **服务端强制 E2EE 且没有开关。** 明文上传一律 400 E2EE_REQUIRED。
 *      所以每条 op 都必须 `isPayloadEncrypted: true`，且 payload 是
 *      **base64 密文字符串**（不是对象）。少任何一个都失败。
 *
 *   2. **线协议 schema 不校验实体成员。** `entityType` 在契约里只是
 *      `z.string()`，拼错要通过上传才暴露 —— 而且是一条一条地暴露。
 *      所以上传前必须用 `isEntityType()` **本地自查**。
 * ═════════════════════════════════════════════════════════════════════════
 *
 * 加密与向量时钟都来自 `@heyta/sync-core`（vendored, MIT），**不重写**。
 */

import { isEntityType, isHeytaFullStatePayload, SUPER_SYNC_SNAPSHOT_OP_TYPES } from '@heyta/shared-schema';
import {
  compareVectorClocks,
  compactVectorClockAgainstFrontier,
  isEncryptedPayloadTransportShape,
  suggestConflictResolution,
} from '@heyta/sync-core';
import type { Operation } from '@heyta/sync-core';
import { createPasswordPayloadCipher, type SyncPayloadCipher, type SyncEncryptionOptions } from './payload-cipher.js';

/** 服务端单次上传/下载的上限（契约里的常量，声明在此以便分页）。 */
const MAX_OPS_PER_UPLOAD = 500;
const DOWNLOAD_PAGE_SIZE = 200;

/**
 * 服务端**永久拒绝**的错误码 —— 这条 op 重试多少次都不会被接受。
 *
 * 🔴 为什么必须区分"永久拒绝"和"暂时被挡"，而不是一律 throw：
 *
 * 抛错发生在 `sync()` 的**下载阶段之前**。于是一条永远传不上去的 op 会让
 * 这台设备**每一次同步都在上传段抛错**，`download()` 永远不执行 ——
 * 它再也拉不到任何远端数据，而界面上只是一句"同步失败"。
 * 实测复现：本地队列里混进一条 `clientId` 属于别的设备的 op 之后，
 * 连续两次同步都是 `error`、待上传数永远是 1、设备再没下载过东西。
 *
 * 所以永久拒绝要**移出队列**（`markRejected`），并且**不阻断下载**。
 *
 * ⚠️ 名单只收"重试无意义"的码。**拿不准的一律留在暂时那一类** ——
 * 判成永久会**丢掉一条本来能上去的改动**，那比多试几次严重得多。
 * 而"多试几次"也不再会卡死设备了：下载已经不再依赖上传是否干净。
 */
const PERMANENT_REJECTION_CODES: readonly string[] = [
  // 这条 op 本身就有问题，重传同一份内容结果不会变。
  'VALIDATION_FAILED',
  'INVALID_OP_ID',
  'INVALID_OP_TYPE',
  'INVALID_ENTITY_TYPE',
  'INVALID_ENTITY_ID',
  'INVALID_PAYLOAD',
  'PAYLOAD_TOO_LARGE',
  'INVALID_VECTOR_CLOCK',
  // A maintenance snapshot's fixed base cannot become current by retrying it.
  'REPAIR_STALE',
  'INVALID_TIMESTAMP',
  'MISSING_ENTITY_ID',
  'INVALID_SCHEMA_VERSION',
  // op 的 clientId 与本次请求的 clientId 不一致 —— 它压根不属于本机。
  'INVALID_CLIENT_ID',
  // 服务端已经有这个 opId 了（幂等重试走 accepted 分支，走到这里说明
  // 同批里重复出现，或内容不一致 —— 两者都不该无限重传）。
  'DUPLICATE_OPERATION',
  // 加密配置层面的不匹配：客户端与服务端口径不一致，重传同一份内容无用。
  'ENCRYPTED_OPS_NOT_SUPPORTED',
  'E2EE_REQUIRED',
];

/**
 * 一次上传里被服务端以"冲突"拒绝的 op。
 *
 * 服务端在 CONCURRENT / 相等时钟异客户端 / 被取代 时拒绝，并给出
 * `existingClock` —— 那是它用来判定冲突的**既有版本时钟**。
 */
interface ConflictReport {
  op: Operation<string>;
  reason: string;
  errorCode: string;
  existingClock?: Record<string, number>;
}

/** 冲突的一方（本地或远端）。只暴露 UI 需要的部分，不外泄整个 op。 */
export interface ConflictSide {
  opId: string;
  clientId: string;
  timestamp: number;
  opType: string;
  payload: unknown;
}

/**
 * 一处**需要用户决定**的冲突。
 *
 * 🔴 为什么要把双方都带出来，而不是只报"有冲突"：
 * 用户没法对着一句"需要手动选择保留哪一边"做选择 —— 他得**看见两边分别是什么**。
 * 我第一版只上报了一个数量，等于把一个必然需要人判断的问题变成了死路：
 * 数据两边都没丢，但谁也没法往下走。
 *
 * `remote` 可能是 `undefined` —— 例如 op 缺少 entityId、或下载后仍找不到对端那条。
 * 这种情况下 UI 必须**明确显示"取不到对端版本"**，而不是显示成空白让人以为对端是空的。
 */
export interface ConflictInfo {
  /** 稳定标识，UI 用它做 key 与"已处理过"判定。 */
  id: string;
  entityType: string;
  entityId: string;
  /**
   * 服务端那句**人类可读**的诊断（英文），如
   * `Concurrent modification detected for TASK:task-...`。
   *
   * 🔴 **不要把它显示给用户。** 它只用于日志与排查；界面文案要用 `errorCode`。
   * 移动端真机验收实测：直接显示 `reason` 会把一整句英文漏进一个全中文的界面里。
   */
  reason: string;
  /**
   * 服务端给的**机器可读**错误码：`CONFLICT_CONCURRENT` / `CONFLICT_SUPERSEDED`。
   *
   * 来自 `sync-core` LWW 自动判定的冲突**没有**这个字段 —— 那种情况下
   * `reason` 本身就是 `LwwConflictResolutionReason`（如 `remote-archive`），
   * 也是一个可查表的编码。所以界面取文案的顺序是
   * `errorCode ?? reason`，两者共用同一张表。
   */
  errorCode?: string;
  local: ConflictSide;
  remote: ConflictSide | undefined;
  /** 服务端判定冲突时给出的既有版本时钟（诊断用）。 */
  existingClock?: Record<string, number>;
}

/**
 * 冲突载荷的**结构化**摘要：只说"这是什么"，不说"怎么说"。
 *
 * ## 为什么要有它
 *
 * `describeConflictPayload` 返回的是一句**中文**，而且其中一支会把载荷的**字段名**
 * 直接拼进去（`completedAt: 123`）。这对单语时代能用，但它有两个问题：
 *
 *   1. 它没法按别的语言渲染 —— 任何要显示英文的壳只能自己再判断一遍载荷形状；
 *   2. `completedAt` 是**内部标识符**。界面语言门禁明确禁止用户可见文案里出现
 *      内部标识符（原始技术信息要放进"技术细节"这类标注字段），
 *      而这段文字是**绕过门禁**直接进界面的 —— 门禁扫不到跨包的返回值。
 *
 * 所以把"判断"和"措辞"拆开：这里的 `kind` 由 `packages/sync-client` 决定
 * （它是唯一知道载荷形状的地方），措辞交给壳。
 * 与 `recurrenceParts`（`packages/domain`）是同一个套路。
 *
 * ## 三种 kind 的取舍
 *
 * - `text`：载荷里能当标题用的**用户自己的字**（任务标题、项目名…）。**不翻译** ——
 *   那不是我们的文案，是用户的数据。
 * - `fields`：载荷是结构化的、但没有可读标题。这里**只报数量**，不列字段名 ——
 *   列出来的就是 `completedAt` 那种内部标识符。用户在这个界面上要判断的是
 *   "哪一条冲突、要不要保留"，"有 3 个字段被改过"足够支撑这个判断。
 * - `empty`：`null` / `undefined` / `{}`。空就是空，绝不拼一个空字符串冒充。
 *
 * ⚠️ 与 `describeConflictPayload` 的关系：后者现在**建立在它之上**（先要 kind，
 * 再拼中文），所以两条路径对同一种载荷永远给同一个判断 ——
 * 既有的 web 断言因此原样通过，而新壳不必复制那段判断逻辑。
 */
export type ConflictPayloadSummary =
  | { kind: 'text'; text: string }
  | { kind: 'fields'; fields: readonly { name: string; value: string }[] }
  | { kind: 'empty' };

/** 载荷里按优先级找"能当标题"的字段。顺序即优先级。 */
const CONFLICT_TITLE_KEYS = ['title', 'name', 'text', 'content', 'note'] as const;

/** 一个 op 的载荷 → 结构化摘要。判断规则见 {@link ConflictPayloadSummary}。 */
export function summarizeConflictPayload(payload: unknown): ConflictPayloadSummary {
  if (payload === null || payload === undefined) return { kind: 'empty' };
  if (typeof payload !== 'object') return { kind: 'text', text: String(payload) };

  const record = payload as Record<string, unknown>;
  for (const key of CONFLICT_TITLE_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return { kind: 'text', text: value };
  }

  const fields = Object.keys(record).map((name) => ({
    name,
    // `JSON.stringify` 对函数/符号返回 `undefined`；显式补成 `'undefined'` 是为了
    // 让类型是 `string` —— 拼出来的字符串与原来 `${...}` 的隐式转换**逐字相同**。
    value: JSON.stringify(record[name]) ?? 'undefined',
  }));
  if (fields.length === 0) return { kind: 'empty' };
  return { kind: 'fields', fields };
}

/**
 * 一个 op 里最能代表"用户改了什么"的字段，用于在界面上给出简短标题（**中文**）。
 *
 * ⚠️ 新的壳请用 {@link summarizeConflictPayload} + 自己的词条，不要用这个：
 * 它是给门禁改造之前就存在的调用方留的（`apps/web` 的 `ConflictDialog` 与
 * `apps/mobile` 的 `conflict-view` 正在分头迁）。两条路径的判断是同一份
 * （都走 `summarizeConflictPayload`），所以不会漂移。
 */
export function describeConflictPayload(payload: unknown): string {
  const summary = summarizeConflictPayload(payload);
  switch (summary.kind) {
    case 'text':
      return summary.text;
    case 'empty':
      return '（空）';
    case 'fields':
      // 没有可读标题就把字段列出来，总比显示"对象"强。
      // 上限 4 个：再多会把冲突面板的标题栏撑成一堵墙，而用户真正要看的
      // 是"哪一条冲突"，不是整份载荷。
      return summary.fields
        .slice(0, 4)
        .map((f) => `${f.name}: ${f.value}`)
        .join('、');
  }
}

/**
 * 冲突双方的「谁较新」标记。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 为什么这**必须**是共享函数，而不是两端各写一个三元式
 *
 * 这条规则原本只存在于 Web 端 `ConflictDialog`：
 * `conflict.remote === undefined || local.timestamp > remote.timestamp`。
 * 做移动端冲突界面时如果照着再写一遍，就是本项目已经吃过两次亏的那个形状
 * （AGENTS.md §3.5：两份实现 + 一处真实漂移），
 * 而这次漂移的后果是**同一个冲突在两个平台上"较新"标在不同的一侧** ——
 * 用户会以为是两件事，且没有任何测试会发现。
 *
 * 🔴 **规则本身也修过一次。** 原来的三元式在**时间戳相等**时为 false，
 * 于是"较新"被标到**对端**头上 —— 而 AGENTS.md #19 明确记着
 * "同一台设备连续两次编辑经常落在同一毫秒里"。也就是说，
 * 在一个专门帮用户判断的界面上，一个高频且毫无依据的标记。现在：
 *
 *   - 严格更晚才标较新
 *   - 时间戳相等 → 两边都不标（分不出先后就如实说分不出）
 *   - 拿不到对端 → 两边都不标（没有可比对象）
 *
 * ⚠️ **这个标记永远不是裁决依据。** 真正的裁决在 `sync-core` 的 LWW；
 * "分不出来"的那些正是被刻意交到人手上的（`suggestConflictResolution` 返回 `manual`）。
 * 它只影响哪个按钮被高亮，**不影响任何一个字节的数据**。
 * ═════════════════════════════════════════════════════════════════════════
 */
export function compareConflictFreshness(
  local: Pick<ConflictSide, 'timestamp'>,
  remote: Pick<ConflictSide, 'timestamp'> | undefined,
): { localNewer: boolean; remoteNewer: boolean } {
  if (remote === undefined) return { localNewer: false, remoteNewer: false };
  return {
    localNewer: local.timestamp > remote.timestamp,
    remoteNewer: remote.timestamp > local.timestamp,
  };
}

function toConflictSide(op: Operation<string>): ConflictSide {
  return {
    opId: op.id,
    clientId: op.clientId,
    timestamp: op.timestamp,
    opType: String(op.opType),
    payload: op.payload,
  };
}

export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'syncing'; phase: 'upload' | 'download' }
  | { kind: 'synced'; at: number }
  | { kind: 'offline'; since: number }
  /**
   * 有冲突**需要用户决定**。
   *
   * 单独一种状态，而不是塞进 `error`：冲突不是故障，是两边的改动都合法。
   * 混进 error 的话，UI 只能显示一句报错，用户既不知道冲突的是什么、
   * 也没有地方去选，问题就永久卡住了。
   */
  | { kind: 'conflict'; conflicts: ConflictInfo[] }
  | ({ kind: 'error'; retryable: boolean } & SyncFailure);

/**
 * 同步失败的**结构化原因**。
 *
 * 🔴 为什么必须有它，而不是只有 `message`：壳里原来只能把 `message` 原样插进
 * 一句本地化好的框里（`'同步出错：{message}'` / `'Sync error: {message}'`），
 * 而 `message` 曾经是**这个包里的中文**。于是英文界面的用户读到的是
 * `Sync error: 未设置端到端加密口令，已停止同步（不会以明文上传）` —— 中英混排。
 * 门禁永远扫不到：壳渲染的是**变量**，不是字面量。
 *
 * ⚠️ 加一个新原因，**界面上的句子必须跟着加**，否则它显示成空白或退化成通用那句。
 *
 * 🔴 这里原本写着"两边都用 `switch (status.reason)` 穷尽，漏一个就编译不过" ——
 * **那句是错的**（2026-10-01 逐条核过）：壳里没有任何 `switch (status.reason)`，
 * 词条映射是一张查表 `SYNC_FAILURE_MESSAGE_KEY`（`packages/ui/src/sync/model.ts`），
 * 而它的类型是 `Record<string, SyncFailureMessageKey>` —— **用字符串索引，
 * 漏一个成员编译器不会说话**（`packages/ui` 刻意不 import 本包，所以它看不见这个联合）。
 *
 * ⚠️ 说"完全没有强制力"也不准确，得说清**哪一侧有**：
 *   · `apps/mobile/src/sync/status-text.ts` 有一份
 *     `KNOWN_FAILURE_REASON_COVERAGE ... satisfies Record<Exclude<SyncFailureReason,'unexpected'>, true>`
 *     —— 新增成员**会**让移动端编译报错，但它只保证"被意识到一次"，**不登记句子**。
 *     加 `'consent-required'` 时它就是靠这条被抓出来的（漏登记 ⇒ tsc 红）。
 *   · `apps/web` 此前**什么都没有**。
 *
 * ✅ 现在 web 侧补上了显式断言：`apps/web/tests/sync-reason-coverage.spec.ts`
 * 用一张 `Record<SyncFailureReason, SyncFailureMessageKey | undefined>` 的**对象字面量**
 * 要求每个成员都表态（给 key 或明确写 `undefined`），并逐条查两份词条表里真有那句中英。
 */
export type SyncFailureReason =
  /** 还没配同步服务。由宿主/壳判断，不是这个包。 */
  | 'not-configured'
  /** 没有访问令牌。 */
  | 'not-signed-in'
  /** 有令牌但没有端到端加密口令 —— 宁可停下，也**绝不明文上传**。 */
  | 'no-encryption-password'
  /** 解决冲突时，本地那条 op 已经不在待上传队列里了。 */
  | 'local-op-missing'
  /** 解决冲突时拿不到对端版本，没法"保留远端"。 */
  | 'remote-version-unavailable'
  /**
   * 服务端上有一批 op 用**当前口令解不开**，它们被跳过了。
   *
   * 详见 `download()` 里那段注释：这些 op 大概率是在**另一个口令**下写入的
   * （换过口令、或某台设备用旧口令传过东西）。重试永远不会让它们变得可读，
   * 所以它**不可重试** —— 但也不能因此让设备永远同步不了。
   */
  | 'undecryptable-ops'
  /**
   * 服务端返回的**整页** op 都用当前口令解不开 —— 同步停在这一页。
   *
   * 与 `'undecryptable-ops'`（部分解不开、其余已同步、游标已推进）是**两种处置**，
   * 所以必须是两个原因：
   *   - 这里**一条都没应用、游标也没推进**（ADR-0016 的 fail-closed）；
   *   - 最常见的原因是**口令不匹配**（口令打错，或这一页全是在另一个口令下写入的）。
   *
   * 🔴 为什么不能让它落进 `'unexpected'`：那条通道渲染的是**原始 `message`**，
   * 而这里抛出的是一句我们写的中文说明。英文界面的用户会读到
   * `Sync error: 这一页 12 条 op 一条都解不开……` —— 中英混排，而且"意外异常"
   * 这个分类本身就在骗人：这是一个已知的、可行动的诊断（去核对口令）。
   *
   * `retryable: false`：同样的口令重试多少次都解不开；用户改对口令后的下一次
   * 手动同步会从**同一个位点**重新拉到这一页，不会跳过任何历史。
   */
  | 'undecryptable-page'
  /**
   * 服务端**拒绝了本机上传的 op**，这些改动不在云上。
   *
   * 🔴 单独一种原因，因为它和"网络不好"是**完全相反**的处置：
   * 网络问题该重试，而永久拒绝重试一万次也还是拒绝。
   * 混进 `'unexpected'` 的话，用户只会看到一句"同步出错"，既不知道
   * **有改动没上去**，也没有任何地方能看是哪些改动。
   *
   * 其中 `retryable` 由调用方按"有没有永久拒绝"决定：
   *   - 全是永久拒绝（`INVALID_CLIENT_ID` 这类）→ `false`，重试无意义；
   *   - 只是暂时被挡（限流、配额）→ `true`，队列还留着，下次会重传。
   */
  | 'upload-rejected'
  /**
   * 服务端**拒绝了这枚访问令牌**（401 / 403）。
   *
   * 🔴 为什么必须单独一种原因，而不是落进 `'unexpected'`：
   * `'unexpected'` 那条通道是 `retryable: true`，而 `createRetryScheduler`
   * 见可重试就继续退避（上限 60s）—— 于是**拿着一枚已经作废的令牌永远重试
   * 一个永远不可能成功的请求**，界面上是一句和网络抖动无法区分的"同步失败"。
   *
   * 而"作废"不是理论情形，是本仓库已有的三个正常功能会产生的**日常状态**：
   * 在别的设备点「登出所有设备」（`tokenVersion` 前进）、改口令（同样前进）、
   * 令牌自然过期。用户做完这三件事里的任何一件，这台设备的同步就该**停下**，
   * 并且说"请重新登录"。
   *
   * ⚠️ 它与 `not-signed-in` **不合并**，尽管用户动作相同：后者是**本地**发现
   * 根本没有令牌（一个请求都没发），这条是**服务端**说这枚令牌不行。
   * 两句话给用户的信息量不同 —— 后者还可能是"这台设备还没配过账号"，
   * 前者说明"配过，但凭据过期了"，而后者才是"数据在云上，我需要重新证明身份"。
   *
   * 🔴 **绝不清本地数据**，也**绝不静默重新认证**。本地数据仍然是唯一可读的事实源
   * （D5），这条原因存在的意义就是让界面有得可选。
   */
  | 'unauthorized'
  /**
   * 🔴 **用户还没有同意隐私规则，所以一个请求都不许发**（计划 G-12）。
   *
   * 由宿主判断，不是这个包 —— 与 `'not-configured'` 同一类。
   *
   * 为什么必须单独一种原因，而不是复用 `'not-configured'` 或 `'offline'`：
   * 那两种都让用户去做**错的那件事**。
   *   · `'not-configured'` 的句子是"去填服务端地址"，可他配得好好的，
   *     缺的是同意 —— 按那句改一遍地址，回来还是不同步。
   *   · `'offline'` 的句子暗示网络坏了，而这里**一个字节都没发出去**，
   *     那是"界面在说谎"（本仓库记过多次的那一类）。
   *
   * ⚠️ `retryable: false`：重试不会让同意出现。界面对这条唯一正确的反应是
   * **把隐私面板再打开一次**，不是"再试一次"。
   */
  | 'consent-required'
  /**
   * 🔴 **条款文本已经更新，而这个账号还没重新确认**（G-27 补签）。
   *
   * 与 `'consent-required'` **不是一回事**，两句也必须分开：
   *   · `'consent-required'` = 这台**设备**从没被问过，动作是"去作出隐私选择"；
   *   · 这一条 = 设备早就同意过了，缺的是**这个账号**对现在这一版文本的确认，
   *     动作是"读完并确认"。把两者合成一个原因，界面就会对一个已经同意过联网的人
   *     再说一遍"请同意隐私规则" —— 那是重复索取同意，本仓库记过的那类"界面在说谎"。
   *
   * ⚠️ 同样是 `retryable: false`：重试不会让确认出现。
   */
  | 'legal-reconfirm-required'
  /** 意外异常：只有 `message` 有意义，它里面是技术细节。 */
  | 'unexpected';

/**
 * 失败信息。**已知原因不需要 `message`。**
 *
 * 这样"已知原因"那几个分支里根本不存在可以被误当成文案渲染的中文；
 * `message` 只留给真正意外的那一类 —— 那里它是**诊断数据**，
 * 本来也不该翻译（用户看到的是本地化的框 + 这段细节）。
 */
export type SyncFailure =
  | { reason: 'unexpected'; message: string }
  | { reason: Exclude<SyncFailureReason, 'unexpected'>; message?: string };

/**
 * 上传结果。字段名以**真实服务端**为准（SuperSyncUploadResultSchema）：
 * `opId` + `accepted`，不是 `id` + `status`。
 *
 * 我第一版按直觉写成了 `id`/`status`/`message`，于是 `accepted: false`
 * 的**逐条拒绝**被完全忽略 —— 客户端会报"已同步"，而服务端一条都没收。
 * 这是最坏的一类 bug：用户以为数据上云了，其实没有。
 */
interface UploadResult {
  opId: string;
  accepted: boolean;
  serverSeq?: number;
  error?: string;
  errorCode?: string;
  /** 服务端判定冲突时给出的**既有版本**时钟，用于解决后重试。 */
  existingClock?: Record<string, number>;
}

interface UploadResponse {
  results?: UploadResult[];
  latestSeq?: number;
  newOps?: ServerOperation[];
  gapDetected?: boolean;
  /**
   * 搭车返回的 `newOps` **只是第一页**（服务端达到 `PIGGYBACK_LIMIT` 且后面还有）。
   * 见 `sync.routes.ops-handler.ts`：设了它就不能把游标推到 `latestSeq`，
   * 否则剩下的 op 会被紧跟的 `download()` 跳过。
   */
  hasMorePiggyback?: boolean;
}

/**
 * 一条**用当前口令解不开**的服务端 op。
 *
 * 带上 `opId` 与 `serverSeq` 是为了让上报的信息**可定位** ——
 * 只说"有 2 条解不开"无从下手；带上序号才查得到是哪两条。
 */
interface UnreadableOp {
  serverSeq: number;
  opId: string;
  errorName: string;
}

/**
 * 服务端返回的**整页** op 一条都解不开。
 *
 * 🔴 用**类型**（而不是错误文案）承载"这是哪一类失败"，是因为 `sync()` 的
 * `catch` 只能看类型来决定归类。若这里抛普通 `Error`，它会被归进
 * `'unexpected'` —— 而那条通道把 `message` 当诊断数据**原样渲染**，
 * 于是我们写的中文说明会出现在英文界面里。归属到
 * `'undecryptable-page'` 后，壳用**词条**渲染，`message` 只进日志。
 *
 * `message` 因此只放**可机器定位**的非中文诊断（序号 + opId + 错误名）。
 */
class UndecryptablePageError extends Error {
  override readonly name = 'UndecryptablePageError';

  constructor(
    readonly count: number,
    readonly first: UnreadableOp,
  ) {
    super(
      `${String(count)} op(s) undecryptable in one page; ` +
        `first=${String(first.serverSeq)}:${first.opId}(${first.errorName})`,
    );
  }
}

/** 线协议里的 op 本体（不含 serverSeq，那个在外面）。 */
interface WireOperation {
  id: string;
  clientId: string;
  actionType: string;
  opType: string;
  entityType: string;
  entityId?: string;
  entityIds?: string[];
  payload: unknown;
  vectorClock: Record<string, number>;
  timestamp: number;
  schemaVersion: number;
  isPayloadEncrypted?: boolean;
  vectorClockEncoding?: 'full' | 'frontier-delta';
}

/**
 * 服务端返回的一条 op。
 *
 * 🔴 **op 是嵌套的**：`{serverSeq, op, receivedAt}`（SuperSyncServerOperationSchema）。
 * 我第一版把它当扁平结构读，于是 `op.id` 全是 undefined ——
 * 而下载路径上没有任何断言会因此失败，数据只是"静静地没进来"。
 */
interface ServerOperation {
  serverSeq: number;
  op: WireOperation;
  receivedAt?: number;
}

interface DownloadResponse {
  ops?: ServerOperation[];
  hasMore?: boolean;
  latestSeq?: number;
  gapDetected?: boolean;
  /** Causal frontier for history compacted before this download page. */
  snapshotVectorClock?: Record<string, number>;
  causalFrontier?: {
    token: string;
    vectorClock: Record<string, number>;
  };
  capabilities?: { causalFrontierDelta?: boolean };
}

interface CausalFrontier {
  token: string;
  vectorClock: Record<string, number>;
}


export type SyncClientOptions = SyncEncryptionOptions & {
  /** 服务端根地址，例如 http://127.0.0.1:3000 */
  baseUrl: string;
  /** 取当前访问令牌。返回 undefined 表示未登录。 */
  getToken: () => Promise<string | undefined>;
  /** 读取/写入下载游标（serverSeq）。 */
  getLastServerSeq: () => Promise<number>;
  setLastServerSeq: (seq: number) => Promise<void>;

  /** 本设备的 clientId。 */
  clientId: string;
  /** E2EE 口令。未配置时必须**拒绝同步**而不是降级成明文。 */
  getPassword: () => Promise<string | undefined>;

  /** 取待上传的本地 op（来自存储的上传状态索引，不是内存列表）。 */
  getLocalOps: () => Promise<Array<Operation<string>>>;
  /**
   * 上传成功后标记 op 已同步，并回写服务端分配的 seq。
   *
   * 是**必填**的：没有它，上传成功这件事只存在于内存里，
   * 下次同步会把同一批 op 再传一遍。
   */
  markUploaded: (serverSeqsByOpId: ReadonlyMap<string, number>) => Promise<void>;

  /** 把解密后的远程 op 交给 op-log 引擎。 */
  applyRemote: (ops: Operation<string>[]) => Promise<void>;

  /**
   * Merge a server-provided causal frontier even when its individual ops were
   * compacted and therefore absent from this page.
   */
  mergeRemoteClock?: (clock: Record<string, number>) => Promise<void> | void;
  /** Persist skipped history before committing a cursor beyond it. */
  markHistoryIncomplete?: () => Promise<void>;

  /**
   * 冲突判定为"本地胜出"时，把这条改动**重新派发**成一条新 op。
   *
   * 为什么要重新派发而不是改旧 op 的时钟：op 是**不可变**的。
   * 而且下载阶段已经把远程时钟并进了本地时钟，所以新 op 的时钟
   * 天然压过服务端既有版本，重传即被接受。
   */
  redispatch: (op: Operation<string>) => Promise<void>;

  /** 冲突判定为"远端胜出"时，把本地这条移出上传队列（不删除）。 */
  discardLocal: (opIds: string[]) => Promise<void>;

  /**
   * 服务端**永久拒绝**时，把这些 op 移出上传队列（不删除、**不标成已上传**）。
   *
   * 与 {@link discardLocal} 分开，因为语义不同：那个是"我们决定不上传了"，
   * 这个是"服务端永远不会接受"。后者必须可观测，否则界面会一直显示
   * "已同步"而那条改动其实没上去。
   */
  markRejected: (opIds: string[]) => Promise<void>;

  /** 按 op id 取回本地 op（用户手动解决冲突时要用它重新派发）。 */
  getOpById: (opId: string) => Promise<Operation<string> | undefined>;

  /**
   * 用给定载荷派发一条新的本地 op。
   *
   * 用户选择"保留远端"时用它：把**远端的载荷**重新表达成本地的一条新 op。
   * 这样本地状态才会真的变成用户选的那个值 —— 只丢弃本地待上传项是不够的，
   * 因为本地那条 op 的 seq 更大，重放时仍然压过远端值。
   */
  redispatchPayload: (intent: {
    entityType: string;
    entityId: string;
    opType: string;
    payload: unknown;
  }) => Promise<void>;

  /** 取某实体的全部本地 op（冲突解决要比对时间戳）。 */
  getOpsForEntity: (entityType: string, entityId: string) => Promise<Operation<string>[]>;

  /** 网络实现，便于测试注入。默认用 globalThis.fetch。 */
  fetchImpl?: typeof fetch;
  /** 时间源，便于测试。 */
  now?: () => number;
}

/**
 * 解析"服务端 op" → 本地 Operation。
 *
 * ⚠️ 解密失败的 op **不能被静默丢弃**：那等于用户数据凭空消失。
 * 这里抛错并让上层把状态置为 error —— 可见的失败远好于无声的数据丢失。
 */
async function decodeServerOp(
  envelope: ServerOperation,
  payloadCipher: SyncPayloadCipher,
): Promise<Operation<string>> {
  const op = envelope.op;
  if (op === undefined || typeof op !== 'object') {
    throw new Error(
      `服务端返回的 op 缺少嵌套的 op 本体（serverSeq=${String(envelope.serverSeq)}）—— ` +
        `线协议是 {{serverSeq, op, receivedAt}}，不是扁平结构`,
    );
  }

  let payload: unknown = op.payload;

  if (op.isPayloadEncrypted === true) {
    if (typeof op.payload !== 'string') {
      throw new Error(
        `op ${op.id} 标记为加密但 payload 不是字符串 —— 服务端数据可能损坏`,
      );
    }
    const plain = await payloadCipher.decrypt(op.payload, op);
    payload = JSON.parse(plain) as unknown;
  }

  return {
    id: op.id,
    clientId: op.clientId,
    actionType: op.actionType,
    // 线协议词表（CRT/UPD/DEL）与本地 OpType 是同一套 —— 直接透传
    opType: op.opType,
    entityType: op.entityType,
    ...(op.entityId !== undefined ? { entityId: op.entityId } : {}),
    ...(op.entityIds !== undefined ? { entityIds: op.entityIds } : {}),
    payload,
    vectorClock: op.vectorClock,
    timestamp: op.timestamp,
    schemaVersion: op.schemaVersion,
  };
  // 注意：**不**在这里塞 serverSeq。
  // `Operation` 是线协议类型，没有 seq 字段；服务端游标由
  // getLastServerSeq/setLastServerSeq 单独维护。
  // 往 op 上加协议外的字段，下次上传会把它原样发给服务端 —— 凭空造字段。
}

export class SyncClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  /**
   * 本次同步里**解不开**的 op（详见 `download()`）。
   *
   * ⚠️ 是**每次 `sync()` 开头清空**的实例字段，不是跨次累积的历史 ——
   * 否则一次口令手滑之后，界面会永远挂着"有数据解不开"。
   */
  private unreadableOps: UnreadableOp[] = [];

  /**
   * 本次同步里被服务端**永久拒绝**的 op（已随之移出待上传队列）。
   *
   * 与 `unreadableOps` 同样是**每次 `sync()` 开头清空**的实例字段：
   * 这些 op 已经被移出队列，不该在后续每一次同步里继续被报出来。
   */
  private rejectedOps: { opId: string; errorCode: string; error: string }[] = [];

  /**
   * 本次同步里**暂时**被挡的 op（限流、配额……）。它们**留在队列里**，下次重传。
   *
   * 和永久拒绝分开记，是因为两者的 `retryable` 相反 ——
   * 合成一类的话，界面要么劝用户"重试"（永久拒绝重试没用），
   * 要么劝用户"别试了"（限流其实等一会儿就好）。
   */
  private transientRejects: { opId: string; errorCode: string; error: string }[] = [];

  /** Last server-issued frontier for this account/device. Kept outside the
   * op-log because it is a transport hint; absence simply disables compaction. */
  private causalFrontier?: CausalFrontier;
  private frontierSession?: string;

  constructor(private readonly options: SyncClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  /**
   * 完整同步：先上传本地，再下载远端。
   *
   * 顺序**不能反**：先下载的话，本地那些还没上传的 op 会在
   * 冲突判定里被当成"我们已经知道的"，而服务端其实还没见过它们。
   */
  async sync(onStatus?: (s: SyncStatus) => void): Promise<SyncStatus> {
    const report = (s: SyncStatus): SyncStatus => {
      onStatus?.(s);
      return s;
    };

    const token = await this.options.getToken();
    if (token === undefined) {
      return report({ kind: 'error', reason: 'not-signed-in', retryable: false });
    }

    // A transport hint is scoped to this authenticated client instance. Losing
    // it is safe: logs always retain complete clocks, never transport deltas.
    if (this.frontierSession !== token) this.causalFrontier = undefined;
    this.frontierSession = token;

    let payloadCipher: SyncPayloadCipher | undefined;
    try {
      payloadCipher = await this.getPayloadCipher();
    } catch {
      // Secure-storage and package validation errors must remain an observable
      // locked state. Do not expose secret-bearing exception messages to logs/UI.
      return report({ kind: 'error', reason: 'no-encryption-password', retryable: false });
    }
    if (payloadCipher === undefined) {
      // 🔴 绝不降级成明文。服务端会 400，但更糟的是"看起来同步成功"。
      // 宁可明确失败，也不让用户以为数据安全地上云了。
      return report({
        kind: 'error',
        reason: 'no-encryption-password',
        retryable: false,
      });
    }

    try {
      this.unreadableOps = [];
      this.rejectedOps = [];
      this.transientRejects = [];
      const conflicts: ConflictReport[] = [];

      report({ kind: 'syncing', phase: 'upload' });
      // ⚠️ 这里**不会再因为"服务端拒绝了某条 op"而抛错** —— 拒绝被记进
      // `rejectedOps` / `transientRejects`，下面照常下载。
      //
      // 🔴 这一条是"设备再也不会拉不到数据"的保证。原来它抛错，而抛出点在
      // 下载之前，于是**一条永远传不上去的 op 就能让这台设备永久失去下载能力**：
      // 每次同步都在上传段失败，`download()` 一次都不执行，界面只显示"同步失败"。
      // 实测：队列里混进一条 `INVALID_CLIENT_ID` 的 op 后，连续两次同步都是
      // error、待上传数恒为 1、设备再没拉到过任何远端数据。
      // 上传的问题只该影响"能不能上传"，不该影响"能不能下载"。
      await this.upload(token, payloadCipher, conflicts);

      // 🔴 顺序：上传 → 下载 → 解决冲突 → 再上传。
      //
      // 冲突解决必须在**下载之后**：判定"谁更新"要用到远端那条 op 的
      // 时间戳，而下载之前我们手上根本没有它。
      // 我第一版没有这一步，于是 CONCURRENT 会被当成硬错误 ——
      // 离线改一次就永远同步不上去。
      report({ kind: 'syncing', phase: 'download' });
      await this.download(token, payloadCipher);

      if (conflicts.length > 0) {
        const unresolved = await this.resolveConflicts(conflicts, token, payloadCipher);
        if (unresolved.length > 0) {
          // 结构化上报，不是一句文案 —— 用户得看见两边分别是什么才能选
          return report({ kind: 'conflict', conflicts: unresolved });
        }
      }

      /**
       * 🔴 **被拒的改动要排在"解不开的 op"之前报。**
       *
       * 两者都是"你的数据没全在这台设备上"，但**被拒是一次性信息**：
       * 永久拒绝的 op 已经被移出队列，下一次同步就不会再提它了 ——
       * 如果这次被 `undecryptable-ops` 挡住，用户**再也没有机会知道**有改动没上去。
       * 而解不开的 op 是持久状态，下次同步照样会报，晚一轮不损失信息。
       *
       * 判据优先级 = "错过就再也看不到的" 优先。
       */
      if (this.rejectedOps.length > 0 || this.transientRejects.length > 0) {
        const parts: string[] = [];
        if (this.rejectedOps.length > 0) {
          parts.push(
            `永久拒绝 ${String(this.rejectedOps.length)} 条（已移出待上传队列，不会重传）：` +
              this.rejectedOps
                .map((r) => `${r.opId}(${r.errorCode}: ${r.error})`)
                .join(', '),
          );
        }
        if (this.transientRejects.length > 0) {
          parts.push(
            `暂时被挡 ${String(this.transientRejects.length)} 条（仍在队列里，下次会重传）：` +
              this.transientRejects
                .map((r) => `${r.opId}(${r.errorCode}: ${r.error})`)
                .join(', '),
          );
        }

        return report({
          kind: 'error',
          reason: 'upload-rejected',
          // 只要还有"下次会重传"的，就值得重试；全是永久拒绝则重试无意义。
          retryable: this.transientRejects.length > 0,
          message: parts.join('；'),
        });
      }

      /**
       * 🔴 有 op 解不开时**不能报 `synced`**。
       *
       * 数据确实同步了一部分，但只要有 op 被跳过，用户的完整数据就不在这台设备上。
       * 报"已是最新"会让他以为全都同步了 —— 那是无声的数据丢失。
       *
       * 顺序上放在冲突之后：冲突是"需要用户做决定"，优先级更高、更可行动；
       * 解不开的 op 用户**当下做不了任何事**（重试也不会变好），所以 `retryable: false`。
       */
      if (this.unreadableOps.length > 0) {
        return report({
          kind: 'error',
          reason: 'undecryptable-ops',
          retryable: false,
          message: this.unreadableOps
            .map((u) => `${String(u.serverSeq)}:${u.opId}(${u.errorName})`)
            .join(', '),
        });
      }

      return report({ kind: 'synced', at: this.now() });
    } catch (error: unknown) {
      /**
       * 🔴 整页解不开要**有分类地**上报，不能落进 `'unexpected'`。
       *
       * `'unexpected'` 通道渲染的是原始 `message`（那是意外异常的技术细节），
       * 而这里是一个已知、可行动的诊断：口令不匹配。落进 `'unexpected'` 会有
       * 两个后果 —— 英文界面读到我们写的中文长句（中英混排），以及用户只看到
       * 一句和网络抖动无法区分的"同步失败"。归类到 `'undecryptable-page'`
       * 之后，壳用词条渲染整句，`message` 只作日志。
       *
       * 语义不变：这条路仍然是在 `download()` 里**抛**出来的，游标没有推进、
       * 一条 op 都没应用（ADR-0016 的 fail-closed）。
       */
      if (error instanceof UndecryptablePageError) {
        return report({
          kind: 'error',
          reason: 'undecryptable-page',
          retryable: false,
          message: error.message,
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      /**
       * 🔴 令牌被拒**先于**离线判定，且**不可重试**。
       *
       * 落到下面那条通用通道意味着 `retryable: true` —— 退避调度器会拿着
       * 一枚服务端已经不认的令牌，每 60 秒敲一次一个永远不可能成功的请求，
       * 而界面上是一句"同步失败"，与网络抖动长得一模一样。
       * 详见 `SyncFailureReason` 里 `'unauthorized'` 那一段。
       */
      if (isUnauthorizedFailure(error)) {
        return report({ kind: 'error', reason: 'unauthorized', retryable: false, message });
      }
      const offline = isNetworkError(error);
      return report(
        offline
          ? { kind: 'offline', since: this.now() }
          : { kind: 'error', reason: 'unexpected', message, retryable: true },
      );
    }
  }

  /** 上传本地 op。分批，避免超过服务端单次上限。 */
  private async upload(
    token: string,
    payloadCipher: SyncPayloadCipher,
    conflicts: ConflictReport[],
  ): Promise<void> {
    const pending = await this.options.getLocalOps();
    if (pending.length === 0) return;

    const batches: Operation<string>[][] = [];
    for (const op of pending) {
      const previous = batches.at(-1);
      if (op.opType === 'REPAIR' || previous === undefined ||
          previous[0]?.opType === 'REPAIR' || previous.length === MAX_OPS_PER_UPLOAD) {
        batches.push([op]);
      } else previous.push(op);
    }
    for (const batch of batches) {

      const ops = await Promise.all(
        batch.map(async (op) => {
          // 🔴 本地自查实体类型。线协议不校验成员，
          // 拼错要到上传后才暴露，而且是一条一条地暴露。
          if (!isEntityType(op.entityType)) {
            throw new Error(
              `拒绝上传未知实体类型 "${op.entityType}"（op ${op.id}）。` +
                `线协议不会校验它，所以必须在本地拦住。`,
            );
          }

          const cipher = await payloadCipher.encrypt(JSON.stringify(op.payload ?? {}), op);

          // 自检：服务端会检查形状，本地先确认我们真的产出了合规密文。
          // 这里失败说明加密层出了问题，而不是网络问题。
          if (!isEncryptedPayloadTransportShape(cipher)) {
            throw new Error(
              `op ${op.id} 的密文不满足服务端传输形状要求 —— 加密层异常`,
            );
          }

          const frontier = this.causalFrontier;
          const relation = frontier ? compareVectorClocks(op.vectorClock, frontier.vectorClock) : undefined;
          const canCompact = frontier !== undefined && (relation === 'EQUAL' || relation === 'GREATER_THAN');
          return {
            id: op.id,
            clientId: op.clientId,
            actionType: op.actionType,
            opType: op.opType,
            entityType: op.entityType,
            ...(op.entityId !== undefined ? { entityId: op.entityId } : {}),
            ...(op.entityIds !== undefined ? { entityIds: op.entityIds } : {}),
            payload: cipher,
            ...(op.opType === 'REPAIR' && isHeytaFullStatePayload(op.payload)
              ? { repairBaseServerSeq: op.payload.repairBaseServerSeq }
              : {}),
            // 服务端要求**显式 true**；缺失算违规，不是"当作 false"
            isPayloadEncrypted: true,
            vectorClock: canCompact
              ? compactVectorClockAgainstFrontier(
                  op.vectorClock,
                  frontier.vectorClock,
                  [op.clientId],
                )
              : op.vectorClock,
            ...(canCompact ? { vectorClockEncoding: 'frontier-delta' as const } : {}),
            timestamp: op.timestamp,
            schemaVersion: op.schemaVersion,
          };
        }),
      );

      const usesDelta = ops.some((op) => op.vectorClockEncoding === 'frontier-delta');
      const lastKnownServerSeq = await this.options.getLastServerSeq();
      const send = (compact: boolean) => this.fetchImpl(
        `${this.options.baseUrl}/api/sync/${compact ? 'ops/causal' : 'ops'}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({
            ops: compact ? ops : ops.map((op, index) => {
              const { vectorClockEncoding: _encoding, ...full } = op;
              return { ...full, vectorClock: batch[index]!.vectorClock };
            }),
            clientId: this.options.clientId,
            lastKnownServerSeq,
            ...(compact ? { causalFrontierToken: this.causalFrontier!.token } : {}),
          }),
        },
      );
      let res = await send(usesDelta);
      // Server downgrade or rotated signing key: retry the SAME operations
      // with their original complete clocks. No extra op or re-encryption.
      if (usesDelta && (res.status === 404 || res.status === 400)) {
        this.causalFrontier = undefined;
        res = await send(false);
      }

      if (!res.ok) {
        throw await toHttpError(res);
      }

      const body = (await res.json()) as UploadResponse;
      if (body.gapDetected === true) await this.markHistoryIncomplete();

      // 🔴 逐条检查 accepted。
      // HTTP 200 **不代表** op 被接受 —— 服务端会对单条 op 返回
      // `accepted: false` + errorCode，而响应整体仍是 200。
      // 只看 res.ok 的话，客户端会报"已同步"而数据一条都没上云。
      const localOpById = new Map(batch.map((op) => [op.id, op]));
      const rejected: UploadResult[] = [];

      for (const result of body.results ?? []) {
        if (result.accepted === true) continue;
        rejected.push(result);

        // 冲突**不是**普通失败：它是需要解决的分歧，不是要重试的错误。
        // 混在一起的话，"冲突"会被无限重试，永远解不开。
        if (result.errorCode?.startsWith('CONFLICT') === true || result.errorCode === 'CONFLICT') {
          const op = localOpById.get(result.opId);
          if (op !== undefined) {
            conflicts.push({
              op,
              reason: result.error ?? '未知冲突',
              errorCode: result.errorCode ?? 'CONFLICT',
              ...(result.existingClock !== undefined
                ? { existingClock: result.existingClock }
                : {}),
            });
          }
        }
      }

      // 🔴 先把"已上传"落盘，**再**决定要不要抛硬拒绝。
      //
      // 顺序反过来会造成一台设备**永久同步不了**，而且症状极难归因：
      // 一批里只要有一条被硬拒，整个 throw 就会把**已被服务端接受的那些**
      // 也一起挡在落盘之前。它们于是永远留在待上传队列里
      // → 下次同步重传整批 → 服务端回"已存在" → 又一次硬拒 → 永远循环。
      // 用户看到的是"同步一直失败 + 待上传数永远不减"，而数据其实一条没丢。
      //
      // 先落盘则队列会收敛到"只剩那条真被拒的 op"，下次只重传它。
      //
      // 🔴 但游标**不在这里推进**（见下面那段）：游标记的是"下载到哪里了"，
      // 而这条路径下面可能还有 piggyback 的 newOps 没应用；先推进会跳过它们。
      const seqsByOpId = new Map<string, number>();
      for (const result of body.results ?? []) {
        if (result.accepted === true && typeof result.serverSeq === 'number') {
          seqsByOpId.set(result.opId, result.serverSeq);
        }
      }
      if (seqsByOpId.size > 0) {
        await this.options.markUploaded(seqsByOpId);
      }

      // 🔴 非冲突的拒绝分两类，**都不在这里抛错**（抛错会连下载一起挡掉）：
      //
      //   永久拒绝（INVALID_CLIENT_ID / INVALID_OP_ID / 校验类……）
      //     → 这条 op 重试多少次都不会被接受，**移出待上传队列**并如实上报。
      //       不移出的话，它会每次同步都被重传、每次都被拒，设备永远卡在
      //       "同步失败 + 待上传数不减"，而且**再也拉不到任何远端数据**。
      //
      //   暂时被挡（限流 / 配额 / 服务端内部错）
      //     → **留在队列里**，下次同步重传。绝不能把它们也移出队列：
      //       那等于把一条本来会成功的改动丢掉。
      //
      // 判据名单见 `PERMANENT_REJECTION_CODES`。拿不准的一律算"暂时"。
      const hardRejects = rejected.filter(
        (r) => r.errorCode?.startsWith('CONFLICT') !== true,
      );

      for (const r of hardRejects) {
        const entry = {
          opId: r.opId,
          errorCode: r.errorCode ?? '(未给出错误码)',
          error: r.error ?? '未知原因',
        };
        if (PERMANENT_REJECTION_CODES.includes(entry.errorCode)) {
          this.rejectedOps.push(entry);
        } else {
          this.transientRejects.push(entry);
        }
      }

      if (this.rejectedOps.length > 0) {
        // 先移出队列再上报 —— 顺序反了的话，上报之后进程若中断，
        // 这些 op 下次还会被重传并被拒（不会丢数据，但会白白多跑一轮）。
        await this.options.markRejected(this.rejectedOps.map((r) => r.opId));
      }

      /**
       * 🔴 搭车返回的 op 也必须**逐条解密，一条解不开不能拖垮整次同步**。
       *
       * 这里原来是无保护的 `await Promise.all(body.newOps.map(decodeServerOp))`。
       * 它和 `download()` 里被 ADR-0016 修掉的那处是**同一个形状**，但更隐蔽：
       *
       *   1. `upload()` 在 `pending.length === 0` 时**直接 return**（见本方法开头），
       *      所以"没有待上传 op"的设备永远走不到这一行。用干净数据库复现，
       *      会得出"解密路径没问题"的结论 —— **必须有待上传的 op 才会踩到**。
       *   2. 抛错发生在 `sync()` 的 upload 阶段，于是 `download()` **根本不会执行**。
       *      设备其实一条远端数据都没拉下来，却只显示"同步失败"，而且被
       *      `sync()` 归类成 `unexpected` + `retryable: true` —— 用户重试多少次都一样。
       *      实测：手机上传成功（服务端确实收到了），本地库里远端 op 数为 **0**。
       *
       * 修法与 ADR-0016 一致：跳过读不了的，应用能读的，如实上报。
       */
      let piggybackAllUndecodable = false;
      if (body.newOps !== undefined && body.newOps.length > 0) {
        const attempts = await Promise.all(
          body.newOps.map(async (o) => {
            try {
              return { ok: true as const, op: await decodeServerOp(o, payloadCipher) };
            } catch (error: unknown) {
              return {
                ok: false as const,
                serverSeq: o.serverSeq,
                opId: o.op?.id ?? '(未知)',
                errorName: error instanceof Error ? error.name : 'Error',
              };
            }
          }),
        );

        const decoded = attempts.filter((a) => a.ok).map((a) => a.op);
        const failed = attempts.filter((a) => !a.ok);

        const failedSnapshot = failed.find((failure) => body.newOps!.some((envelope) =>
          envelope.op?.id === failure.opId && (SUPER_SYNC_SNAPSHOT_OP_TYPES as readonly string[]).includes(envelope.op.opType)));
        if (failedSnapshot !== undefined) throw new UndecryptablePageError(body.newOps.length, failedSnapshot);

        if (decoded.length > 0) await this.options.applyRemote(decoded);

        if (failed.length === 0) {
          // 全部解开 —— 正常情况
        } else if (decoded.length === 0) {
          /**
           * 整批都解不开 —— 与 `download()` 一样，这多半是"口令不对"的信号。
           * **不在这里抛**，也不推进游标：交给紧接着的 `download()` 去判。
           * 理由是这个判断只该有一份策略（ADR-0016），在这里再写一套迟早会漂移；
           * 而不推进游标能让 `download()` 从旧位点重新看到这批 op，
           * 从而给出"口令不对"还是"历史里混着别的口令"的正确区分。
           */
          piggybackAllUndecodable = true;
        } else {
          // 有的解开、有的解不开 = 口令是对的，只是历史里混着别的口令写的数据。
          await this.markHistoryIncomplete();
          for (const f of failed) this.unreadableOps.push(f);
        }
      }

      /**
       * 🔴 上传成功、且搭车 op 没有整批解不开时才推进游标。
       *
       * 反过来的话，游标前进了却不知道哪些 op 传过 —— 下次会重传整批。
       * 而"整批解不开"时推进游标，等于把这段历史静默跳过（ADR-0016 明确禁止）。
       *
       * 🔴 搭车页也可能**只是第一页**：`newOps` 达到 `PIGGYBACK_LIMIT`(500)
       * 且服务端后面还有 op 时会带 `hasMorePiggyback: true`
       * （`sync.routes.ops-handler.ts:346-355,370`），剩下的靠紧跟其后的
       * `download()` 拉。这时候推进到 `latestSeq` 会让下载从**全局水位**开始，
       * 搭车页之后、`latestSeq` 之前的 op 就被永久静默跳过
       * —— 与上面 `download()` 里被修掉的是同一个形状。
       * 实测探针：`latestSeq=600`、`newOps=2..501`、`hasMorePiggyback=true`
       * → 游标变成 600，502..600 全丢。
       *
       * 所以 `hasMorePiggyback=true` 时只推进到**最后一条已应用的搭车 op**；
       * 只有搭完一页（或没有搭车 op）时才用 `latestSeq`。
       * 同 `download()`：用最大 `serverSeq` 归约，不依赖返回顺序假设。
       */
      if (
        !piggybackAllUndecodable &&
        typeof body.latestSeq === 'number'
      ) {
        if (body.hasMorePiggyback === true) {
          let lastPiggybackSeq: number | undefined;
          for (const o of body.newOps ?? []) {
            if (lastPiggybackSeq === undefined || o.serverSeq > lastPiggybackSeq) {
              lastPiggybackSeq = o.serverSeq;
            }
          }
          // hasMorePiggyback 只可能由「取满一页」推出，理论上必有 newOps；
          // 万一没有，就没有可推进的位点，原地不动好过跳到水位。
          if (lastPiggybackSeq !== undefined) {
            await this.options.setLastServerSeq(lastPiggybackSeq);
          }
        } else {
          await this.options.setLastServerSeq(body.latestSeq);
        }
      }
    }
  }

  /**
   * 解决上传时被判定的冲突。
   *
   * 策略**不是自己发明**，而是复用 sync-core 的 `suggestConflictResolution`：
   * 它已经编码了 LWW（一小时窗口内比时间戳）、删除优先、
   * 创建与更新不对称等规则，以及判不出来时的 `manual` 兜底。
   * 自己再写一套迟早与它对不上，而两套冲突策略不一致是最难查的一类 bug。
   *
   * 返回**未能自动解决**的冲突（需要用户手动选择）。
   */
  private async resolveConflicts(
    conflicts: ConflictReport[],
    token: string,
    payloadCipher: SyncPayloadCipher,
  ): Promise<ConflictInfo[]> {
    const unresolved: ConflictInfo[] = [];
    const toRedispatch: Operation<string>[] = [];
    const toDiscard: string[] = [];

    for (const conflict of conflicts) {
      const { op } = conflict;

      // 没有 entityId 就没法比对实体级历史 —— 只能交给人判断
      if (op.entityId === undefined) {
        unresolved.push({
          id: op.id,
          entityType: String(op.entityType),
          entityId: '(未知)',
          reason: conflict.reason,
          ...( conflict.errorCode !== undefined ? { errorCode: conflict.errorCode } : {}),
          local: toConflictSide(op),
          remote: undefined,
          ...(conflict.existingClock !== undefined
            ? { existingClock: conflict.existingClock }
            : {}),
        });
        continue;
      }

      // 下载之后，本地日志里已经有了远端那条
      const history = await this.options.getOpsForEntity(op.entityType, op.entityId);
      const theirs = history.filter((o) => o.clientId !== this.options.clientId);

      /**
       * 🔴 传给 `suggestConflictResolution` 的必须是**真正并发的那几条**，
       * 不是实体的全部历史。
       *
       * `EntityConflict.localOps/remoteOps` 的语义是"这个冲突涉及的两组 op"。
       * 我第一版传了整个实体历史，于是 A 当初创建该任务的那条 Create 也在里面，
       * 而 B 那边没有 Create —— 直接命中"本地有 Create 就本地赢"的规则。
       * 结果：**创建者的编辑永远自动胜出，另一台的编辑被静默丢掉**，
       * 而且看起来像"同步成功"。这正是整个冲突机制要避免的结果。
       *
       * 并发判定用 `compareVectorClocks`：只有 CONCURRENT 才是"两边各自改了"
       * 的那种真冲突，GREATER_THAN/LESS_THAN 是版本先后关系，不是冲突。
       */
      const concurrentTheirs = theirs.filter(
        (o) => compareVectorClocks(op.vectorClock ?? {}, o.vectorClock ?? {}) === 'CONCURRENT',
      );

      // 找不到并发的对端（例如服务端判定的是同客户端重复提交）时，
      // 退回到"最新的一条远端 op"而不是空数组 —— 空数组会被判成"本地赢"，
      // 那等于在信息不足时武断地丢掉对端。
      const counterpart = concurrentTheirs.length > 0 ? concurrentTheirs : theirs;

      const suggestion = suggestConflictResolution([op], counterpart);

      if (suggestion === 'local') {
        toRedispatch.push(op);
        // 🔴 原来的那条必须**丢弃**（移出上传队列，但不删 op）。
        //
        // 我第一版只重新派发、没丢弃，于是那条被服务端拒过的 op 永远留在
        // 待上传队列里，每次同步都再撞一次冲突 —— 同步被**永久卡死**，
        // 而且看起来像"服务端老是无缘无故拒绝我"。
        // 它已经被重新表达成一条新 op 了，旧的那条没有任何理由再上传。
        toDiscard.push(op.id);
        continue;
      }
      if (suggestion === 'remote') {
        toDiscard.push(op.id);
        continue;
      }

      // manual（或策略判不出来）：把**双方**都交给用户，而不是只报一个数量。
      // 取时间戳最大的那条作为"远端版本" —— 那正是用户要对比的那个值。
      const latestRemote =
        counterpart.length === 0
          ? undefined
          : counterpart.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));

      unresolved.push({
        id: op.id,
        entityType: String(op.entityType),
        entityId: op.entityId,
        reason: conflict.reason,
        ...( conflict.errorCode !== undefined ? { errorCode: conflict.errorCode } : {}),
        local: toConflictSide(op),
        remote: latestRemote === undefined ? undefined : toConflictSide(latestRemote),
        ...(conflict.existingClock !== undefined
          ? { existingClock: conflict.existingClock }
          : {}),
      });
    }

    if (toDiscard.length > 0) await this.options.discardLocal(toDiscard);

    if (toRedispatch.length > 0) {
      for (const op of toRedispatch) {
        await this.options.redispatch(op);
      }
      // 重新派发产生了新 op（时钟已压过服务端），再传一次。
      //
      // 🔴 **不要再递归调用 resolveConflicts。**
      // 我改结构化上报时顺手把这里写成了递归，于是"重传仍冲突"会一层层
      // 套下去 —— 配合上面"旧 op 没被丢弃"的问题，就是无限循环。
      // 重传仍然冲突说明自动判定不成立，那正是**该交给用户**的情况，
      // 而不是我们自己再猜一轮。
      const retryConflicts: ConflictReport[] = [];
      await this.upload(token, payloadCipher, retryConflicts);
      if (retryConflicts.length > 0) {
        const history = await this.options.getOpsForEntity(
          retryConflicts[0]!.op.entityType,
          retryConflicts[0]!.op.entityId ?? '(未知)',
        );
        for (const c of retryConflicts) {
          const theirs = history.filter((o) => o.clientId !== this.options.clientId);
          const latestRemote =
            theirs.length === 0
              ? undefined
              : theirs.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
          unresolved.push({
            id: c.op.id,
            entityType: String(c.op.entityType),
            entityId: c.op.entityId ?? '(未知)',
            reason: c.reason,
            ...( c.errorCode !== undefined ? { errorCode: c.errorCode } : {}),
            local: toConflictSide(c.op),
            remote: latestRemote === undefined ? undefined : toConflictSide(latestRemote),
            ...(c.existingClock !== undefined ? { existingClock: c.existingClock } : {}),
          });
        }
      }
    }

    return unresolved;
  }

  /**
   * 用户手动解决一处冲突。
   *
   * 两条路径**都通过重新派发**，因为 op 是不可变的、op-log 是唯一写入口。
   *
   * `keep-remote` 为什么也要重新派发本地一条：
   * 远端那条虽然已经下载并应用了，但本地这条待上传 op 的 `seq` 更大，
   * 重放时仍然是本地值胜出 —— 界面会显示用户**已经放弃**的那个值。
   * 把远端载荷重新表达成一条新的本地 op（时钟压过双方），
   * 本地状态才会真的变成用户选的那个值，而且这是一次真实的用户意图。
   */
  async resolveConflict(
    conflict: ConflictInfo,
    choice: 'keep-local' | 'keep-remote',
  ): Promise<SyncStatus> {
    const token = await this.options.getToken();
    let payloadCipher: SyncPayloadCipher | undefined;
    try {
      payloadCipher = await this.getPayloadCipher();
    } catch {
      return { kind: 'error', reason: 'no-encryption-password', retryable: false };
    }
    if (token === undefined || payloadCipher === undefined) {
      // 分成两条精确原因，而不是原来那句"未登录或缺少加密口令" ——
      // 用户能做的事完全不同（去登录 vs 去填口令），混着说等于没说。
      if (token === undefined) {
        return { kind: 'error', reason: 'not-signed-in', retryable: false };
      }
      return { kind: 'error', reason: 'no-encryption-password', retryable: false };
    }

    try {
      if (choice === 'keep-local') {
        // 本地这条重新派发（时钟已含下载阶段并入的远端时钟）
        const op = await this.options.getOpById(conflict.local.opId);
        if (op === undefined) {
          return {
            kind: 'error',
            reason: 'local-op-missing',
            retryable: true,
          };
        }
        await this.options.redispatch(op);
      } else {
        if (conflict.remote === undefined) {
          // 拿不到对端版本就没法"保留对端" —— 明确失败，不要猜
          return {
            kind: 'error',
            reason: 'remote-version-unavailable',
            retryable: false,
          };
        }
        // 把**远端载荷**表达成本地的一条新 op
        await this.options.redispatchPayload({
          entityType: conflict.entityType,
          entityId: conflict.entityId,
          opType: conflict.remote.opType,
          payload: conflict.remote.payload,
        });
      }

      // 原始的待上传 op 不该再传了 —— 用户已经做出了选择
      await this.options.discardLocal([conflict.local.opId]);

      return await this.sync();
    } catch (error: unknown) {
      return {
        kind: 'error',
        reason: 'unexpected',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }
  }

  private async getPayloadCipher(): Promise<SyncPayloadCipher | undefined> {
    if (this.options.encryptionMode === 'vault') {
      // Runtime guard as well: JS/native callers do not all pass through tsc.
      return this.options.getPayloadCipher ? this.options.getPayloadCipher() : undefined;
    }
    const password = await this.options.getPassword();
    return password ? createPasswordPayloadCipher(password) : undefined;
  }

  private async markHistoryIncomplete(): Promise<void> {
    if (this.options.markHistoryIncomplete === undefined) {
      throw new Error('Skipping history requires durable incomplete-history storage');
    }
    await this.options.markHistoryIncomplete();
  }

  /** 增量下载。按 serverSeq 游标分页，直到 hasMore 为 false。 */
  private async download(token: string, payloadCipher: SyncPayloadCipher): Promise<void> {
    for (;;) {
      const since = await this.options.getLastServerSeq();
      const url = new URL(`${this.options.baseUrl}/api/sync/ops`);
      url.searchParams.set('sinceSeq', String(since));
      url.searchParams.set('limit', String(DOWNLOAD_PAGE_SIZE));
      // 排除自己：我们的 op 已经应用过了，拉回来纯属浪费
      url.searchParams.set('excludeClient', this.options.clientId);

      const res = await this.fetchImpl(url.toString(), {
        headers: { authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw await toHttpError(res);

      const body = (await res.json()) as DownloadResponse;
      const ops = body.ops ?? [];
      if (body.gapDetected === true) await this.markHistoryIncomplete();

      if (body.capabilities?.causalFrontierDelta === true && body.causalFrontier !== undefined) {
        this.causalFrontier = body.causalFrontier;
      } else if (body.capabilities?.causalFrontierDelta !== true) {
        // A legacy server may silently strip the new request fields. Drop the
        // cached token before the next upload so its compact clock is never
        // interpreted as a complete clock by that server.
        this.causalFrontier = undefined;
      }

      if (ops.length > 0) {
        /**
         * 🔴 逐条解密，**一条解不开不能拖垮整页**。
         *
         * 实测（iPhone 17 Pro 模拟器 + 真实服务端）：服务端上有两条 op 是用
         * **另一个口令**写入的（换口令之前传上去的）。`decodeServerOp` 对它们抛
         * `OperationError`（AES-GCM 认证失败），而这里是
         * `await Promise.all(ops.map(decodeServerOp))` —— 于是：
         *
         *   1. 整页**一条都应用不上**（后面那 7 条明明是好的）；
         *   2. `setLastServerSeq` 在抛错**之后**，游标**永远不推进**；
         *   3. 下一次同步从同一个位点开始，**撞上同样两条，再抛**。
         *
         * 结果：这台设备**永久**无法同步，而界面只显示"同步失败"。
         * 换过口令的用户会以为同步坏了，其实只是历史里有两条解不开的。
         *
         * 这与第 34 条（上传侧：一条被硬拒的 op 让设备永久卡死）是**同一个形状**，
         * 只是发生在读侧。修法也必须一致：**跳过读不了的，应用能读的，并如实上报。**
         *
         * ⚠️ 但不能无脑跳过。**整页一条都解不开**时，最常见的原因是
         * **用户把口令打错了** —— 那时候推进游标等于把整段历史静默跳过，
         * 比卡死更糟。所以只在"有的解开、有的解不开"时才跳过。
         */
        const attempts = await Promise.all(
          ops.map(async (o) => {
            try {
              return { ok: true as const, op: await decodeServerOp(o, payloadCipher) };
            } catch (error: unknown) {
              return {
                ok: false as const,
                serverSeq: o.serverSeq,
                opId: o.op?.id ?? '(未知)',
                errorName: error instanceof Error ? error.name : 'Error',
              };
            }
          }),
        );

        const decoded = attempts.filter((a) => a.ok).map((a) => a.op);
        const failed = attempts.filter((a) => !a.ok);

        // A full-state op may be the only copy of the purged server prefix.
        // Unlike an isolated unreadable delta, skipping it loses that prefix.
        const failedSnapshot = failed.find((failure) => ops.some((envelope) =>
          envelope.op?.id === failure.opId && (SUPER_SYNC_SNAPSHOT_OP_TYPES as readonly string[]).includes(envelope.op.opType)));
        if (failedSnapshot !== undefined) throw new UndecryptablePageError(ops.length, failedSnapshot);

        if (decoded.length > 0) await this.options.applyRemote(decoded);

        if (failed.length > 0) {
          if (decoded.length === 0) {
            /**
             * 整页一条都解不开 —— 最常见的原因是**口令打错**。
             *
             * 🔴 抛出的是**有类型的** `UndecryptablePageError`，不是普通 `Error`：
             * 普通 `Error` 会被 `sync()` 归进 `'unexpected'`，而那条通道渲染原始
             * `message`。这里中断的语义必须保留（不推进游标、不静默跳过整段历史，
             * 见 ADR-0016），但分类必须准确 —— 用户看到的是"口令不匹配、同步已暂停"
             * 这条可行动的词条，而不是和网络抖动无法区分的"同步失败"。
             */
            const first = failed[0];
            if (first !== undefined) {
              throw new UndecryptablePageError(ops.length, first);
            }
            // `failed.length > 0` 保证 `first` 一定存在；这里只是让控制流对
            // `noUncheckedIndexedAccess` 收敛，并**绝不**退化成"跳过整页"。
            throw new Error('internal: failed page reported without a first failure');
          }
          // 有的解开、有的解不开 = 口令确实是对的，只是历史里混着别的口令写的数据。
          // 跳过它们（重试也不会变好），但要**如实上报**，不能装作没这回事。
          await this.markHistoryIncomplete();
          for (const f of failed) this.unreadableOps.push(f);
        }
      }

      // Persist snapshot-only history only after its materialization succeeds,
      // and before the cursor commits. A failed payload must not grant causality.
      if (body.snapshotVectorClock !== undefined) {
        if (this.options.mergeRemoteClock === undefined) {
          throw new Error('Snapshot frontier requires durable clock storage');
        }
        await this.options.mergeRemoteClock(body.snapshotVectorClock);
      }

      /**
       * 🔴 游标推进要和「这一页真的消费到哪里」对齐 —— **分页时绝不能跳到 `latestSeq`**。
       *
       * `latestSeq` 是**全局**水位（服务端此刻已分配的最大序号），而本页只覆盖到
       * 本页最后一条 op。旧实现无条件推进到 `latestSeq`，于是 `hasMore=true` 时
       * 下一轮从 `sinceSeq=latestSeq` 开始 —— **本页之后、`latestSeq` 之前的 op
       * 一次都没拉取，被永久静默跳过**（服务端的空洞检测恰好因为
       * `excludeClient` 被关掉，所以连警告都没有，见 `operation-download.service.ts`）。
       * 实测探针：第 1 页 seq 4..203 / `hasMore=true` / `latestSeq=600`
       * → 第 2 次下载的 `sinceSeq` 变成 600，204..600 全丢。
       *
       * 正确规则分两种：
       *   - `hasMore=true`（还有下一页）：只推进到**本页已消费的最后一条**，
       *     剩下的交给下一轮循环 —— 这正是 AGENTS §7:797「游标不提前推进」。
       *   - 最后一页（`hasMore !== true`）：才用 `latestSeq`。此时并发写入者
       *     可能分配了比本页末条更大的序号，而 (本页末, latestSeq] 里的 op
       *     要么被 `excludeClient` 过滤（本机自己的，早已应用过），要么根本不存在；
       *     用末条 seq 反而让游标落后、下次重复下载（test:434 约束的就是这一页）。
       *
       * ⚠️ 分页那一支取的是「本页消费到的**最大** `serverSeq`」，而不是
       * 「最后一条**解开**的 op」：服务端取数是 `sinceSeq` 之后**升序**取
       * （`orderBy: { serverSeq: 'asc' }`，`operation-download.service.ts:211-213`），
       * 所以正常情况下两者相同。但某条 op 解不开时它会被记入 `unreadableOps`
       * 并**有意跳过**（ADR-0016：重试也不会变好）；拿「最后一条解开的」会退回到
       * 那条坏 op 之前，下一轮又从它开始 —— 若那一页恰好只剩它一条，就会误报
       * 「整页解不开 = 口令不对」。取本页最大 seq 才与「这一页都处理完了
       * （应用，或如实上报后跳过）」的语义一致。这里用 max 归约而非取下标，
       * 以免把「服务端升序」这个假设写死在客户端。
       */
      if (typeof body.latestSeq === 'number') {
        if (body.hasMore === true) {
          let pageMaxSeq: number | undefined;
          for (const o of ops) {
            if (pageMaxSeq === undefined || o.serverSeq > pageMaxSeq) pageMaxSeq = o.serverSeq;
          }
          // 空页 + hasMore（线上的服务端不会这样发：hasMore 由「取到 limit+1 条」推出，
          // 但测试覆盖了这个形状）没有已消费的位点 —— 原地不动，别把游标推到水位。
          if (pageMaxSeq !== undefined) {
            await this.options.setLastServerSeq(pageMaxSeq);
          }
        } else {
          await this.options.setLastServerSeq(body.latestSeq);
        }
      }

      // 用 latestSeq 判定终止，而不是 ops.length ——
      // 服务端可能返回空页但仍标记 hasMore（例如全部被 excludeClient 过滤）
      if (body.hasMore !== true || ops.length === 0) return;
    }
  }
}

/**
 * 非 2xx 响应，**带着状态码**。
 *
 * 🔴 状态码不能只进文案不进类型：`sync()` 的 catch 只有 `message` 可看时，
 * 想区分"令牌被拒"和"服务端挂了"就只剩对着一句中文做正则 —— 而那句是服务端
 * 随时会改的文案。实测这类匹配的下场写在 `isNetworkError` 的注释里
 * （一个裸 `network` 子串把"平台拦明文"读成"设备没网"）。
 */
export class SyncHttpError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`同步请求失败：HTTP ${String(status)}${detail === '' ? '' : ` — ${detail}`}`);
    this.name = 'SyncHttpError';
    this.status = status;
  }
}

/** 把非 2xx 响应变成带服务端信息的错误。 */
async function toHttpError(res: Response): Promise<SyncHttpError> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    detail = body.error ?? body.message ?? '';
  } catch {
    // 响应体不是 JSON —— 不要因为解析失败而丢掉状态码
    detail = '';
  }
  return new SyncHttpError(res.status, detail);
}

/**
 * 这次失败是不是"服务端不认这枚令牌"。
 *
 * 🔴 只认 401 / 403，**不认整个 4xx**。403 服务端目前留给"该实例不允许这个邮箱"
 * 这类**授权**判断，同步路径上出现它同样意味着"这枚凭据不被允许继续"；
 * 而 400（E2EE_REQUIRED、payload 非法）和 429 的处置完全不同 —— 把它们报成
 * "请重新登录"是让人去做一件解决不了问题的事。
 *
 * 导出它是因为宿主/壳可能想在**别**的调用点（手动同步按钮）给同一句话；
 * 但**分类本身只有一份**，`sync()` 的 catch 是唯一产出该原因的地方。
 */
export function isUnauthorizedFailure(error: unknown): boolean {
  return error instanceof SyncHttpError && (error.status === 401 || error.status === 403);
}

/**
 * 平台/传输**策略**拦截，而不是"没网"。
 *
 * 实测来源：Android 在 `usesCleartextTraffic=false` 时，对 `http://` 请求抛
 *
 *     CLEARTEXT communication to 10.0.2.2 not permitted by network security policy
 *
 * iOS 的 ATS 同形状：App Transport Security policy requires the use of a secure connection。
 */
const TRANSPORT_POLICY_ERROR = /cleartext|app transport security|network security policy/i;

/**
 * 判断是否网络层错误（→ 离线），区别于服务端拒绝（→ 错误）。
 *
 * 🔴 注意顺序：**必须先排除策略拦截**。原来的写法是
 * `/failed to fetch|network|offline|ECONNREFUSED/i`，其中的 `network` 会命中
 * "network **security policy**" —— 于是"平台不允许明文 HTTP"被报成「当前离线」。
 * 用户看到的是"我没网吗？"，而真相是"这个地址的协议被系统拦了"。
 * 一个正则里的裸子串就把两类完全不同的问题合并成了一个，且合并错了方向。
 */
export function isNetworkError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  // 策略拦截：网络是通的，重试也不会好。必须先判，顺序不能换。
  if (TRANSPORT_POLICY_ERROR.test(message)) return false;
  if (error instanceof TypeError) return true; // fetch 在断网时抛 TypeError
  return /failed to fetch|network request failed|\boffline\b|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH/i.test(
    message,
  );
}

/**
 * 指数退避的离线重试。
 *
 * 只对**可重试**错误退避；服务端明确拒绝（如 E2EE 违规、未登录）
 * 重试再多次也不会成功，只会浪费配额。
 */
export function createRetryScheduler(
  run: () => Promise<SyncStatus>,
  options: { baseDelayMs?: number; maxDelayMs?: number } = {},
): { start: () => void; stop: () => void } {
  const base = options.baseDelayMs ?? 2000;
  const max = options.maxDelayMs ?? 60_000;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = (): void => {
    if (stopped) return;
    const delay = Math.min(base * 2 ** attempt, max);
    attempt += 1;
    timer = setTimeout(() => {
      void run().then((status) => {
        // 成功或不可重试 → 停止；
        // 离线/可重试错误 → 继续退避
        if (status.kind === 'synced') {
          attempt = 0;
          return;
        }
        if (status.kind === 'error' && !status.retryable) return;
        schedule();
      });
    }, delay);
  };

  return {
    start: () => {
      stopped = false;
      attempt = 0;
      schedule();
    },
    stop: () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
