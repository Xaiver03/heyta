# 客户端持久化键登记表

> 它是什么：**本机存储上每一个 `heyta.*` 键的唯一登记处**，以及它属于哪一档。
> 为什么要有它：[ADR-0085](../adr/0085-appearance-is-device-local-and-never-an-op.md) 第 4 条 ——
> 外观类是**设备属性**（写本机、**不产生 op**），行为类是**账号属性**（走 op）；
> 两档混存就会出现"换台机器外观被同步走"或"同一个偏好两处存"。
> 谁该维护：**谁加键谁登记**（`check:persistence-keys` 会红，见 §4）。

---

## 1. 口径（先看这段，否则表会被读歪）

**这份表登记的是"本机存储上的键"，不是"所有偏好"。** 判据是**写在哪**：
`localStorage` / `AsyncStorage` / 设备配置文件里的 `heyta.*` 字面量。

⚠️ **它不是"用户偏好"的全集**：账号侧的偏好（周起始、默认提醒…）按 ADR-0085 走 op，
落在 op-log 与实体上，**不在这张表里**。所以"表里只有 6 个外观键"不等于"产品只有 6 个外观设置" ——
它等于"本机只存了 6 个"。

**现量命令**（2026-11-06，四个档的划分是我读每个声明点定的，不是按名字猜的）：

```sh
grep -rnoE "'heyta\.[A-Za-z0-9._]+'" apps/web/src apps/mobile/src packages/*/src \
  | sed "s/'//g" | awk -F: '{print $3"  "$1":"$2}' | sort -u
```

**这不是字面量下界之外的完备性证明**：拼出来的键（模板串、`'heyta.' + x`）扫不到。
目前源码里没有拼出来的键（这也是那条 `grep` 的读数之一），但**新加键时必须用字面量**，
否则 `check:persistence-keys` 会看不见它 —— 那条门禁只认字面量，这是它的已知射程。

---

## 2. 四档（ADR-0085 的两档 + 两档"根本不是偏好"）

| 档 | 含义 | 产生的 op | 跨端 |
|---|---|---|---|
| **A 表达** | 同一份数据的**表达**：主题、语言、显示格式、布局开合 | **零** | 不同步（各端各自记） |
| **B 视图状态** | 某个视图**怎么看**（排序档位）。它不是外观，也不是数据 | **零** | 不同步 |
| **C 本机数据** | 存在本机、但**是用户的数据或功能开关**（已存视图、AI 设置、公告已读、本地对话历史） | 视具体而定（见备注） | 多数不同步（v1 裁决） |
| **D 基础设施** | 根本不是偏好：库名、op-log 派生状态、生成产物名、凭据、托管端点 | 不适用 | 不适用 |

🔴 **A 与 C 的区别不是"哪个更重要"**，而是 ADR-0085 那一句：**改的是表达，还是初值/数据**。
把 A 误登记成 C ⇒ 外观会被当成数据同步；把 C 误登记成 A ⇒ 用户的数据被当成"这台机器的样子"丢掉。

---

## 3. 登记表

### A · 表达（零 op）

| 键 | 写在哪 | 谁读 | 备注 |
|---|---|---|---|
| `heyta.theme` | `apps/web/src/lib/theme.ts` | `App.tsx` 的 `data-theme` | **显式**明暗选择（`light` / `dark`）。R13b 起三态：**「跟随系统」= 删掉这个键**（与"从没选过"同形），不存 `system` |
| `heyta.themePreset` | `apps/web/src/lib/theme.ts` | `App.tsx` 的 `data-theme-preset` | R13b 表面色系预设（`warm` / `mist`）。`default` 不存键、也不写属性 —— 基准那套 token 一个像素都不变 |
| `heyta.locale` | `apps/web/src/lib/locale.ts:30` | i18n provider | 界面语言 |
| `heyta.dueDisplay` | `apps/web/src/features/tasks/due-display-pref.ts:18` | 任务行 / 面单的截止显示 | 截止时间的**显示格式**（不是日期值） |
| `heyta.detailPane` | `apps/web/src/features/shell/detail-pane-pref.ts:24` | 详情栏开合 | 布局状态 |
| `heyta.shell.rail` | `apps/web/src/features/shell/rail-pref.ts:16` | `splitRailTabs` 的主段/更多 | rail 编排 |

### B · 视图状态（零 op）

| 键 | 写在哪 | 谁读 | 备注 |
|---|---|---|---|
| `heyta.taskSort` | `apps/web/src/features/tasks/sort-pref.ts:19` | 任务列表排序 | 四档：`display` / `addedAt` / `priority` / `manual`（`TASK_SORT_KEYS` 是唯一真源） |
| `heyta.projectTaskSort` | `apps/web/src/features/projects/project-sort-pref.ts:9` | 按清单的排序 | 与上一行**不是**同一个键：清单内的排序可以不同 |

⚠️ 这两个键与 **R4 手动排序**相邻但不同层：`taskSort` 存的是"看哪一档"，`Task.order` 存的是"数据里的顺序"。
后者**是数据、产生 op**；前者**是视图状态、零 op**。改 `Task.order` 时别把 `taskSort` 也写进去。

### C · 本机数据（按自己的裁决）

| 键 | 写在哪 | 谁读 | 备注 |
|---|---|---|---|
| `heyta.filters.saved` | `apps/web/src/features/tasks/saved-filters.ts:17` | 已存视图面板 | D1 裁决：**v1 本地不同步、不产生 op**（见该文件头） |
| `heyta.ai.settings` | `apps/web/src/features/settings/aiStore.ts:42` | AI 设置面 | 行为类。是否应上服务端按 AI 架构那一份，不在本表裁决 |
| `heyta.shell.modules` | `apps/web/src/features/shell/modules.ts:131` | 功能模块开关 | **功能开关**（行为），不是外观 —— 别放进 A 档 |
| `heyta.announcements.dismissed` | `apps/web/src/features/announcements/store.ts:25` | 公告 | 已读状态 |
| `heyta.ai.assistant.history` | `packages/app-host/src/assistant-local-history.ts:60` | 助手本地历史 | 用户数据，**本机** |
| `heyta.vault.root.v1` | `apps/web/src/lib/vault-root-cache.ts:21` | vault 根缓存 | 敏感；见 vault 那一份 |
| `heyta.vault.keyPlacement.v1` | `apps/web/src/lib/vault-root-preference.ts:18` | 密钥存放位置偏好 | 敏感 |

### D · 基础设施（不是偏好）

| 键 | 写在哪 | 是什么 |
|---|---|---|
| `heyta.sqlite` | `apps/web/src/worker/storage.worker.ts:47` | 本地库名（不是键值偏好） |
| `heyta.entityVersions` | `packages/op-log/src/state.ts:178` | op-log 派生状态 |
| `heyta.fieldVersions` | `packages/op-log/src/state.ts:179` | op-log 派生状态 |
| `heyta.auth.remembered.v1` | `apps/web/src/features/auth/remembered-credentials.ts:17` | 凭据（加密后） |
| `heyta.sync.credentials` | `apps/web/src/features/sync/credential-storage.ts:32` | 同步凭据 |
| `heyta.gtk.css` | `packages/design-system/src/generate-cli.ts:48` | 生成产物名 |
| `heyta.waytofuture.cn` | `packages/ai/src/managed-endpoints.ts:90` | 托管端点常量（不是存储键，但同前缀，登记以免下次被当成漏登记） |

---

## 4. 门禁：`pnpm check:persistence-keys`

`scripts/check-persistence-keys.mjs`。三条断言 + 一条自检：

| # | 断言 | 怎么才会红 |
|---|---|---|
| A | 源码里的每个 `heyta.*` 字面量键都在本表里出现过 | 新加一个键不登记 ⇒ 红 |
| B | 本表里的每个键都在源码里出现过 | 删了键却不删表（鬼键）⇒ 红 |
| C | 每个键恰好登记**一次**（四档不许重叠） | 同一个键既写 A 档又写 C 档 ⇒ 红 |
| D | `--self-test`：三条臂各注一次，断言该红的那条真红了 | 臂本身写错 ⇒ 自检红 |

⚠️ **它的射程**：只认**字面量**（见 §1）。拼出来的键、以及**键值**（不是键）都不在射程内。
这一句写在这里是因为一条"看起来在检查全部"的门禁比没有更糟（traps #666）。

---

## 5. 已知缺口

1. **移动端还没有 `heyta.*` 键**（`grep apps/mobile/src` = 0）—— 所以这张表目前只有 web。
   移动端加键时**同一个键名要复用**（同偏好不同名 = 跨端行为不一致），别发明 `heyta.mobile.*`。
2. **拼出来的键扫不到**（§1 末）—— 现在没有，规矩是"新键必须字面量"。
3. **账号侧偏好不在这张表**（§1 第二段）—— 那份在 op-log/实体上，要另一张表；本轮没建。
4. **`heyta.ai.settings` 该不该上服务端**没有裁决（AI 架构那份与 ADR 的关系未定），本表只登记现状。
