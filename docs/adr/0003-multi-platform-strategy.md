# ADR-0003：多端策略

- **状态**：已接受
- **日期**：2026-09-25
- **决策者**：产品负责人
- **影响层**：`apps/`、`packages/storage`、`packages/domain`（**不可逆层**）

---

## 1. 背景

产品负责人已确认具备：

- **Apple Developer 账号** ✅
- **鸿蒙（HarmonyOS）开发者账号** ✅
- **Android**：账号暂未提及；**备案暂不处理**（明确指示）

目标平台（按优先级）：

| 平台 | 状态 | 备注 |
|---|---|---|
| Web | 进行中 | P1 已开建，`apps/web` |
| iOS / iPadOS | 待开 | 已有开发者账号 |
| HarmonyOS | 待开 | 已有开发者账号 |
| Android | 待开 | 不阻塞，暂不处理备案 |
| 桌面（macOS/Windows/Linux） | 待定 | 可由 Web 或 Tauri 覆盖 |

**明确要求（原话）**：「一开始的话，就需要做好多端适配的工作。」

---

## 2. 决策

### 2.1 架构分层必须让多端只写"壳"

**所有业务逻辑必须在 `packages/` 里，`apps/*` 只允许放平台外壳与 UI 绑定。**

```
packages/domain       纯业务逻辑，零框架依赖     ← 三端共用
packages/sync-core    同步内核（vendored MIT）   ← 三端共用
packages/shared-schema 线协议契约                ← 三端共用
packages/storage      存储接口 + 各平台实现       ← 接口共用，实现分平台
packages/design-system 设计变量                  ← Web 共用；原生需另做映射
apps/web               React 19 + Vite          ← 平台壳
apps/ios               待定                      ← 平台壳
apps/harmony           待定                      ← 平台壳
```

**这不是"以后重构"，而是从第一天就是硬的**：`packages/domain` 在 P1 第一轮就已经是纯函数包
（无 React、无 DOM、无 Node），不是后来拆出来的。

### 2.2 存储必须是可替换的，且两端实现都要真的存在

🔴 **IndexedDB 只在浏览器有。iOS 与鸿蒙必须用 SQLite。**

这不是"性能优化"，是**硬约束**：没有 SQLite 实现，原生端根本跑不起来。

因此 P1 起就要求：

1. `DbAdapter` / `OpLogStore` **只暴露最小必要操作**，不做 ORM（已如此，见 `db.types.ts`）
2. **同一套契约测试跑遍所有实现** —— 换后端时上层一行不用改
3. 先做两个实现：
   - `InMemoryDbAdapter`：参考实现 + 测试基座
   - `IndexedDbAdapter`：Web 端生产实现
   - `SqliteAdapter`：原生端（P2 起，接口已就位）

### 2.3 同步与加密必须跨语言可验证

端到端加密与向量时钟在不同平台上由不同语言实现（TS / Swift / ArkTS）。
**必须有一份跨语言互操作测试**，否则会出现"Web 能解密、iOS 解不开"这类只在真机上暴露的问题。

> 已有基础：P0 阶段已建立跨语言加密互操作验证，见 `research/tools/crypto-interop/`。
> **新增平台时必须扩展这份测试**，不是重新造一套。

### 2.4 设计系统在多端的边界（诚实说明）

`packages/design-system` 是 **CSS 变量**。它**不能**直接给 SwiftUI / ArkUI 用。

| 平台 | 设计变量怎么落地 |
|---|---|
| Web | 直接用 `tokens.css` |
| React Native | 需要一层 tokens.css → JS 对象的导出（P2） |
| SwiftUI / ArkUI | 需要**生成器**把 tokens 导出为 Swift / ArkTS 常量（P2） |

**但"唯一事实源"不变**：值只在 `tokens.css` 定义一次，其余平台由它**生成**。
不许各端各写一份色值 —— 那就是漂移的开始。

> **尚未决定**：具体跨平台 UI 技术栈（React Native / 各端原生 / Capacitor）。
> 这决定 2.4 的生成器形态，也决定 UI 能否复用。**保持开放，不预先写死。**

---

## 3. 被否决的方案

### 3.1 先只做 Web，之后再考虑多端

**否决理由**：这正是本项目要避免的路径。若 P1 把逻辑写进 React 组件，
多端时就要**重写**而不是**复用** —— 而 heyta 的差异化功能（四象限、习惯连续天数、
番茄钟）恰好都在这一层。

**成本对比**：现在保持分层只是"别把纯函数写进组件"的纪律；事后拆分是重写。

### 3.2 用 IndexedDB 到处跑（例如给原生套 WebView）

**否决理由**：WebView 里的 IndexedDB 在 iOS 上会被系统在存储压力下清理，
且后台同步能力受限。本地优先应用**丢本地数据是不可接受的**。
原生端必须用系统级数据库（SQLite）。

### 3.3 各平台各写一份业务逻辑

**否决理由**：四条同步路径的实现不可能保持一致，而同步逻辑的不一致 =
**数据损坏**。这正是 op-log 那 5 万行上游代码存在的理由。

---

## 4. 后果

### 正面

- P1 的领域层与存储层**直接可复用**，多端只是写壳
- 行为一致：三端跑同一份业务逻辑与同一份契约测试
- 数据模型一致：同一套 op 格式，服务端不需要按平台分叉

### 负面 / 需要接受的成本

- `packages/` 的接口变更**会跨端传导**，改起来比单端应用慢 —— 这是刻意的
- 原生端需要维护 SQLite 适配器与设计变量生成器（P2 工作量）
- 跨语言加密互操作测试必须随平台扩展而维护

### 待定（不阻塞 P1）

- 跨平台 UI 技术栈选型（见 §2.4）
- Android 备案（明确指示：暂不处理）

---

## 5. 证据与依据

| 结论 | 依据 |
|---|---|
| 领域层已经是纯函数包 | `packages/domain/package.json` 的 dependencies 只有 `@heyta/shared-schema`；`src/` 无任何框架 import |
| 存储接口已是可替换设计 | `packages/storage/src/db.types.ts` 顶部注释：并发串行化关在适配器内部，"换存储实现时，上层一行都不用改" |
| 跨语言加密互操作已验证 | `research/tools/crypto-interop/run.sh`（P0 阶段已跑通） |
| op-log 跨端一致性风险 | 上游 `src/app/op-log/` 166 文件 / 51,708 行，单是 `conflict-resolution.service.ts` 就有 4,838 行 |
