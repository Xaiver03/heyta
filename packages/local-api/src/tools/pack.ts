/**
 * 实体工具包（entity tool pack）—— 一个实体一个文件的接缝
 * =========================================================
 *
 * 加一个工具以前要改**五处**：`tools.ts` 的目录条目、`mcp.ts` 的 `INPUT_SCHEMAS`、
 * `server.ts` 的 `runReadTool()` switch、`server.ts` 的 `toWriteIntent()` switch、
 * 以及 `packages/app-host` 的 `submitIntent()`。五处互相独立、**没有任何一处会报错**，
 * 漏掉哪一处的症状都是同一句"这个工具不存在/不是只读工具"。
 * 本接口把那五处收成一个文件一个实体：目录条目、参数 schema、读分支、写分支
 * 全部长在 `tools/<entity>.ts` 里，聚合与委托在 `tools/registry.ts`。
 *
 * 🔴 判据（不是承诺）：`tests/tool-pack-coverage.spec.ts` 遍历整份目录，
 * 逐个工具用最小合法参数驱动一遍，断言**没有一个**得到 `tool-not-implemented`。
 * 认领不齐 ⇒ 那条测试红，而不是等到用户在界面上问 AI 时才现形。
 */

import type { McpToolDefinition } from '../mcp.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import type { LocalApiTool } from './shared.js';

export interface EntityToolPack {
  /** 这个包负责的领域实体，取值必须是 `packages/shared-schema` 的 `ENTITY_TYPES` 成员（拼写逐字一致）。 */
  readonly entityType: string;

  /**
   * 这个实体的工具（读与写**混在一起**声明即可 —— 目录按 kind 分组，见 `registry.ts`）。
   *
   * ⚠️ 组内顺序是**目录顺序**的一部分：同一实体内先读后写、按能力递进写，
   * 别为了"看起来整齐"去重排已发布工具的位置。
   */
  readonly tools: readonly LocalApiTool[];

  /**
   * 每个工具的 MCP 参数 schema，**按工具名为键**。
   *
   * 🔴 键必须与 `tools` 里的名字**逐字一致**。对不上的那个工具会走
   * `listAuthorizedTools()` 的空 `properties` 回退（那里有说明为什么它还在）。
   */
  readonly schemas: Readonly<Record<string, McpToolDefinition['inputSchema']>>;

  /**
   * 读工具的执行。**返回 `undefined` 表示"这个工具名不是我的"** —— 不是"读失败"。
   *
   * ⚠️ 这两个语义不许混：读失败是 `{ ok: false, kind: … }`（用户能看到消息），
   * `undefined` 是注册不齐（`runReadTool` 会转成 `tool-not-implemented`）。
   * 把"读失败"写成 `undefined` 会让它变成一条谁都看不懂的系统错误。
   *
   * 投影（`projectListForTool` / `readItemForTool`）必须在**这里**做 ——
   * Bear 那条"可列举不可读"的底线只有一个执行点，不在委托层。
   */
  runRead(
    host: LocalApiHost,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolReadOutcome | undefined>;

  /** 写工具的参数 → 写入意图。同样返回 `undefined` 表示"不是我的"。 */
  toIntent(name: string, args: Record<string, unknown>): ToolWriteIntentOutcome | undefined;
}
