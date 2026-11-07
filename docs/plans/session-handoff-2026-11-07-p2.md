# 交接 · 2026-11-07 P2 对标那一轮（R13a / R13b / R11 / 挂账）

> 零上下文可读。**状态在各自的计划文档里**，本文只回答三件事：
> 这轮关了哪几格、**现在卡在哪**、下一步按什么顺序做。

---

## 1. 这轮关了哪些格（都在 main 上）

| 格 | 提交 | 一句话 |
|---|---|---|
| 看板重建在 `TaskRow` 上（B274） | `68c2330e7` | `check:l4` 78→**74 恰在基线**、族仍 **33**、kanban 立场升 `selects` |
| 标签合并三个读点 | `abf535b18` | 移动筛 / 桌面筛（新增只读别名表 IPC）/ 导出名 |
| 附件接进 web 详情面 | `6013662c7` | 展示层抽 `packages/ui/src/attachments` |
| 空态第四档 `card` | `df4f1b7be` | 词汇表补齐（三支注入臂都真红） |
| R13a 个性化分区 + 我的页版本/退出 | `7c0f90119` | 组 id 不变；退出单入口 |
| R13b 表面色系预设 + 自动深浅 | `b6e389d59` | **零 op**；逐预设 × 逐明暗算 WCAG |
| R11 `ErrorState` / `Skeleton` + 首消费者 | `0bfca488e` | 加载画骨架且空态不在 |
| 移动端上传失败词表 | `4250dcc8a` | 两条永不命中的原因键 |
| **新门禁** `check:tag-resolution` | `70019c84a` | 补上 `tags.ts` 引用了却**不存在**的那道形状门禁 |
| **新门禁** `check:state-tiers` | `02be9c81f` | 空态**档位**账本（30 行） |

`pnpm typecheck` rc=0；`apps/web` **2793 passed / 0 failed**；`packages/ui` 921；
`design-system` 583（含 135 条 token 契约）；`apps/mobile` 1327；
**19 道门禁逐条 rc=0**（含新开的两道）。

---

## 2. 现在卡在哪（两条，都不是代码问题）

### 2.1 四端重装：**被一个不是我们的进程占着端口**
`localhost:3000` 有监听（`lsof` 可见 PID，`ps` 取不到命令行 —— 本会话里 `ps` 被策略禁止），
但它**不认 `/health` 也不认 `/api/health`**（两个都 `Cannot GET`）⇒ 那不是 heyta 的服务端。
👉 先确认它是谁、能不能停；停掉之后按 [`multi-end-build.md`](../agents/multi-end-build.md) §6.1.1
跑 `pnpm reinstall:all`（iOS 段必须带 `IOS_DEVICE_NAME="iPhone Duo heyta"`）。

### 2.2 移动端设备腿：**机器不安静**
三条前置里两条已满足：模拟器 `iPhone Duo heyta` **在**（`Booted`）、重装脚本可跑；
但 load average 刚测是 **10.49 / 26.27 / 39.35** —— 这正是陷阱 #634 记的形状
（重负载下 `apps/web` 的 5s 用例批量假红），而设备腿跑起来本身就是重负载。
👉 等负载降到个位数再跑 `pnpm verify:mobile-ios-account-erasure`；否则你会得到一批假红，
然后去改不该改的东西。

---

## 3. 下一步的顺序（按依赖）

1. **查清 3000 端口** → 停掉 → `pnpm reinstall:all`（四端）。这一步不能与别的工作并行。
2. **设备腿**（负载降下来之后）。
3. 之后才是新的功能格。**候选与各自的判据入口**：
   - `card` 档真的用起来（5 处本该是卡片档仍借 `page`）：[`r11-state-tiers-ledger.md`](r11-state-tiers-ledger.md) §3；
   - R11 铺开到其余 27 个"没有加载分支"的容器：[`r11-error-and-loading-2026-11.md`](r11-error-and-loading-2026-11.md) §4；
   - 字号档 / 密度 / 行着色三态 / 应用图标：[`r13b-appearance-presets-2026-11.md`](r13b-appearance-presets-2026-11.md) §5；
   - 树外 3 项（任务排序 / rail 编排 / 日历范围）：[`r13a-settings-tree-2026-11.md`](r13a-settings-tree-2026-11.md) §4。

---

## 4. 这一轮踩出来、值得记住的四条

1. **合并纪律**：合任何一笔之前，先把这笔改到的 workspace 包 build 掉再 typecheck。
   `apps/desktop` 读 `@heyta/node-host` 的 dist 类型 —— 两个 worktree 各自绿、合并后红过一次。
2. **`ps` 在本会话被禁**：查进程用 `lsof -nP -iTCP:<port> -sTCP:LISTEN`，不要指望 `ps`。
3. **账本记现量，不记理想**。`check:state-tiers` 里 `card` 档 0 个消费者是**如实登记**，
   不是"已经做完了"。把理想写进账本，账本就变成第二份愿望清单。
4. **引用前先核脚本在不在**。`tags.ts` 里那句 `scripts/check-tag-resolution.mjs` 挂了一轮，
   而脚本从来不存在 —— 一条"看起来在盯着"的判据比没有判据更糟。
