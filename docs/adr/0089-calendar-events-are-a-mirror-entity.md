# ADR-0089：外部日历事件是只读镜像实体（`CALENDAR_EVENT`）

> 状态：**待确认**
> 日期：2026-11-24
> 取舍来源：Hub 仓（`飞书日历聚合`）的 `docs/heyta-integration.md` §2 / §8 / §9（设计稿，同月同日）。它不在本仓内，故不写成相对链接。
> 相关：[ADR-0044](0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md)（倒数日是日历的第二个源）、[ADR-0052](0052-public-facts-are-deployer-supplied.md)（外部公共事实的通道形态）、[ADR-0081](0081-encryption-is-opt-in-not-default.md)（默认 `readable`，不是端到端加密）、[ADR-0085](0085-appearance-is-device-local-and-never-an-op.md)（什么东西不该进 op-log）。

## 1. 背景与约束

飞书侧已经有 4 个组织的日程，经 Hub 归一化后可以按窗口取全量快照（`GET /api/v1/events?from&to&org`）。heyta 的日历板今天只有两个源：任务 + 倒数日。要让"我的会"出现在日历上，必须先回答**它是什么**——实体、还是别的什么。

硬约束（逐条都能指着文件读）：

- **schema 默认不 bump**；给持久化模型加"必填"字段会在 hydration 时炸，而 TS 与构建都会绿（`docs/agents/hard-constraints.md` §3.3）。
- **op-log 是唯一写入口**，一条 op = 一个用户意图（同上 §3.4）。⛔ 因此"外部世界多了一条日程"这种事实不能被当成用户的意图去重放。
- **`apps/*` 不许有任何一行决定"业务上该怎么做"**（同上 §3.5）。
- **实体清单是客户端与服务端共享的单一来源**，服务端白名单从 `ENTITY_TYPES` 派生（`server/src/sync/services/validation.service.ts` 的 `ALLOWED_ENTITY_TYPES = new Set(ENTITY_TYPES)`）。⇒ 老服务端认不得新实体，会判 `INVALID_ENTITY_TYPE` **永久拒绝**：这不是 schema 版本问题，是**上线顺序**问题。
- **`EVENT` 不是它**：`EVENT` 是倒数日 / 纪念日（`title` + `date: LocalDate` + 农历/闰月口径 + 归档），**没有"几点"**（`packages/domain/src/entities.ts` 的 `CountdownEvent`）。
- **视图不建实体**：四象限 / 今天 / 日历都由字段派生（`packages/shared-schema/src/entity-types.ts` 文件头第 2 条）。

## 2. 选项

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| A. 新增 `CALENDAR_EVENT` 实体 | 事件与任务在**数据层**就是两类；跨设备一致、可导出、可还原 | 多一条要长期维护的实体（白名单 / 导出 / 还原 / AI 覆盖统计各多一格） | 本 ADR |
| B. 复用 `EVENT`（倒数日） | 不加实体、不动白名单 | 语义不同（有/无时刻）、字段不同（时区/外部 id/参会人）、生命周期不同。`EntityModelMap` 的类型被迫变联合，`eventOccurrencesInRange` 等"每个日期问一次"的纯函数全要对两种形状分支；"改标题"与"改时区"在同一实体上 LWW 互斥 | `entities.ts` 的 `CountdownEvent`；Hub 设计稿 §2.1 |
| C. 投影成 `Task` | 复用全部既有能力 | 得到四个具体错误：会议能被"完成"、能被计入完成率/象限、能出现在"今日任务"清单、拖拽会走任务的排期语义 | `docs/agents/hard-constraints.md` §3.5；Hub 设计稿 §2.1 |
| D. 只在壳里画，不落 op-log | 通道最干净 | 每台设备各自拉 Hub ⇒ 每台都要配 token、离线看不到、备份里没有它。而"在所有设备上看到自己的会"是这功能的全部意义 | Hub 设计稿 §8 Q1 |
| E. 走 `GLOBAL_CONFIG` 存一个 events 数组 | 不加实体 | 数组在 LWW 下是**覆盖**语义，两条并发写入互相吞；且单条 op 要承载整个窗口的外部行（实测 9~20 条），每轮同步重传 | `entity-types.ts` 的 `ASSISTANT_TURN` / `COMMENT` 同一条推理 |
| F. 用 `packages/sync-core` 承载轮询 | 少一处接线 | 那是 vendored 的 op 传输原语（`PROVENANCE.md` 管辖），不该知道第三方 API；且它不持有实体语义 | Hub 设计稿 §4.5 |
| G. 不做窗口交集，直接"上轮在、这轮不在即删" | 实现最短 | 窗口每滑一格就误删边界上的一天，而症状只在少数几次滑动里出现 | Hub 设计稿 §4.3 |

## 3. 结论

**新增 `CALENDAR_EVENT` 实体承载外部日历（当前是飞书，经 Hub 归一化）的只读镜像；它不复用倒数日实体 `EVENT`，自有字段全部可选，不 bump `CURRENT_SCHEMA_VERSION`。**

具体六条：

1. **实体**：`CALENDAR_EVENT` 进 `ENTITY_TYPES`（`packages/shared-schema/src/entity-types.ts`）、进 `EntityModelMap` 与 `MODELED_ENTITY_TYPES`（`packages/domain/src/entities.ts`），并物化到 `calendarEvents` 桶（`packages/op-log/src/state.ts`）。字段见 `CalendarEvent`。
   🔴 **一行 = 外部源返回的一条**（带 RRULE 的母事件，或一条已具体化的实例行）；**RRULE 不展开成实体行** —— 实例在渲染时算，否则一条 `FREQ=DAILY` 无 `UNTIL` 的日程会往 op-log 里写进上千条实体。
   🔴 **自有字段全部可选**：身份不靠必填字段，靠 `id` —— 由幂等键确定性派生。任何一格做成必填，症状都是"某条老数据在 hydration 时炸掉整个日历"，而 typecheck 与构建都会绿。

2. **幂等**：实体 id 由 `(accountId, calendarId, sourceEventId, originalTime)` 规范化后取 sha256 派生；投影结果与物化状态逐字段相同时**不写 op**（`inbound-core` 的 `inboundTaskDigest` 是同形成例）。

3. **写入方**：只有宿主管道（`packages/app-host`）里的 connector 写这个实体，阶段 A 用户对它只读。op-log 只负责落 op，**不负责轮询**；轮询不在 `packages/sync-core`，也不在 `packages/op-log`。

4. **不进 op-log 的三样**：账户（含 Hub 凭据）与日历元数据落本机 `STORES.META`，形态照 ADR-0052（公共事实由部署方下发、不进 op-log、不跨设备）；预置智能视图是派生常量，不建实体（"视图不建实体"）。

5. **删除**：只在相邻两轮拉取窗口的**交集**内判定（"上一轮在、这一轮不在"），窗口边缘滑出不算删除；母事件不参与删除判定；外部复活时清 `deletedAt`（与回收站还原同形）。

6. **不回写**：本 ADR 只覆盖读。写回飞书需要另一份 ADR，前置是 Hub 写接口、可写日历（`role` 为 `writer`/`owner`）、跨系统冲突规则、失败落点四件事。

**与"需求清单"不同的四处**（照设计稿 §2.2 的裁决，理由都在实体注释里）：`updatedAt` → `sourceUpdatedAt`（`EntityBase.updatedAt` 已是"这条 op 什么时候被写入"，同名会造出两个语义的同一字段）；`deleted` → 用 `EntityBase.deletedAt`（再加一个并行布尔会出现"`deleted=true` 但 `deletedAt` 为空"的第三态）；`uid` 保留但现阶段填不出来（Hub 的 JSON 里没有）；飞书原始 JSON 不落 op（形状随上游漂，且会进每一次全量快照）。

## 4. 后果

**接受的代价**：

- **两台设备各自拉 Hub**：同一行会得到两次内容相同的投影 ⇒ 靠"内容不变不写 op"消掉；若一边落后，LWW 会短暂显示旧内容，下一轮收敛。这是刻意选的（比"指定一台设备当镜像机"多一个隐式角色）。
- **例外实例在阶段 A 不完整**：Hub 阶段 2 才会输出 RECURRENCE-ID 例外。在那之前"某次会议被单独改过"在 heyta 里看起来仍是原时间。
- **`uid`、事件级更新时间在阶段 A 缺席**：Hub 的 JSON 目前没有它们，实体字段留了位置但填不出来。在它们到位之前，唯一能用来定位一行外部日程的仍然是 `(accountId, calendarId, sourceEventId, originalTime)`。
- **多一条需要长期维护的实体**：它进 `ENTITY_TYPES` 就意味着服务端白名单、导出、还原、AI 覆盖统计（`ENTITY_COVERAGE_DEBT`）都多一格。
  ⚠️ **上线前必须做的两件事**（本轮的改动边界只到实体核心）：① **服务端先于客户端发布**（白名单从 `ENTITY_TYPES` 派生，老服务端会永久拒绝）；② 在 `scripts/check-ai-coverage.mjs` 的 `ENTITY_COVERAGE_DEBT` 登记这个实体的读写缺口 —— 它进了 `EntityModelMap` 却没有任何 AI 读写工具，`pnpm check:ai-coverage` 与 `packages/ai/tests/capability-manifest.spec.ts` 的分母基线与"无工具实体"名单都会因此红，那正是这条纪律要求的"回来重新判断一次"。
- **重复日程的展开是新代码**：现有 `packages/domain/src/recurrence.ts` 是 floating 语义（无时区），不能直接用于带时区的事件。

**换来的东西**：

- 事件与任务在**数据层**就是两类，不靠界面上小心避让。"事件能被勾完成""拖拽改事件时间走了任务的排期语义""事件出现在今日任务清单""事件计入完成率与象限"四条混淆风险各有一条能红的判据。
- 外部数据进不了"用户的意图"通道：账户 / 凭据 / 日历元数据都不进 op-log，导出与快照里不会出现 token。
- 幂等键的四个组成都在实体字段里，不必反解哈希也能认出是哪一条外部行；且不需要第七处映射表。
- 删错可以恢复：`deletedAt` 是回收站语义，与任务回收站同一套。
- 加第二家日历源（Google / CalDAV）时，改的是 connector，不动实体、不动 op-log、不动日历板。

**本轮边界（明确不做）**：不写 connector、不写 UI（含共享板第三源与详情面板）、不回写飞书、不建账户 / 日历实体、不做模糊去重。三个形态选择里，"进 op-log 还是纯本机"（设计稿 §8 Q1）由本 ADR 定为**进 op-log**；"等 Hub 补 `uid` 还是先上"（Q2）定为**先上**（字段可选，缺就是缺）；"事件上板要不要动共享板"（Q3）**仍是开放问题**，属 UI 那一步。

## 5. 未核实项

1. `originalTime` 的**单位**：Hub 的文档写"Unix 秒"，而它的解析正则同时接受 10 位与 13 位（毫秒）。消费方按位数判单位是否安全，未验证 —— 它直接影响例外对齐。
2. 飞书侧"例外改母事件"时 `event_id` 是否变化：普通更新不变已实测，这一档未实测。
3. 两台设备在同一窗口、一边落后一轮时的收敛速度：未实测。
4. `attendees` / `reminders` 的稳定形状：Hub 现在透传飞书原始对象（`snake_case`），未收窄。本实体的窄形状是按 Hub 已公布的键名定的，上游换键名时映射会在 connector 里断，而**实体不会跟着变形**。
5. 共享板加第三源对移动端的影响面：未在两端的真机 / 模拟器上验。
6. `start_time.timezone` 缺失时 Hub 兜底 `Asia/Shanghai`：日程实际时区与兜底值不同时会得到一个"看起来对、跨零点错一天"的读数，是否需要 `timezoneInferred` 一类的标记未确认。
