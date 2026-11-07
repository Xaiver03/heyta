# R13a · 设置树「个性化」分区 + 「我的」页两锚点（2026-11-07）

> 上游：[PRD](ticktick-parity-prd-2026-11.md) R13a · [ADR-0085](../adr/0085-appearance-is-device-local-and-never-an-op.md) §三/§五 ·
> [C-②/D-② 工单](c2-d2-work-orders-2026-11.md) §1② · [现量测绘](r13a-settings-map-2026-11.md)（71 项逐条 + 三个数）。
> 本文只写**这一轮做了什么、为什么这么缩、判据怎么才会红**；71 项的全表不在这里复述（复述必漂）。

---

## 1. 一句话

按 ADR-0085 把「外观与语言」正名为**「个性化」**（组 id 不动），并给「我的」页补上**版本 / 退出**两个锚点。
**「行为默认值」这一区这一轮没有建** —— 见 §3，这是本单最重要的一条判断。

---

## 2. 做了什么

| # | 动作 | 落点 | 判据 |
|---|---|---|---|
| 1 | 组名「外观与语言」→ **「个性化」** | `apps/web/src/App.tsx` 的 `SETTINGS_NAV_ITEMS` + 该节 `aria-label`；新词条 `mobile.settings.section.personalization`（中英） | 组 **id 仍是** `settings-group-appearance`（深链只认 id）；改 id ⇒ `settings-tree-zones.spec.tsx` 红 |
| 2 | 「我的」页底部加**版本行** | `apps/web/src/features/settings/ProfileOverview.tsx`，`data-testid="profile-center-version"` | 版本号读 `@heyta/app-host` 的 `HEYTA_APP_VERSION`（真源是根 `package.json`，`check:app-version` 盯着）；写死字符串 ⇒ `account-profile-entry.spec.tsx` 红 |
| 3 | 「我的」页底部加**退出登录**（唯一主入口） | 同上，`data-testid="profile-center-signout"`；`onSignOut` 由 `App.tsx` 传入 | 未登录时不渲染（语义上不存在）；菜单里 `account-menu-signout` 必须为 null |
| 4 | 头像菜单**删掉**「退出登录」那一条 | `features/shell/AccountMenu.tsx` + `RailNavigation` / `CompactRailNavigation` 的 `onSignOut` 链路 | 一个动作一个主入口；菜单里仍保留「个人中心」= 打开我的页 |
| 5 | 入口表登记 | [`r14-entry-table.md`](r14-entry-table.md) 新增「退出登录 `signOut`」一行（42 行） | `check:entry-table` 绿 |

**顺序**：身份 → 统计 → 成就 → 打开设置 → **版本** → **退出**。「最后两位」是"找得到"的锚点，上面内容再长也不许把它们挤走。

---

## 3. 为什么「行为默认值」不建组（本单的核心判断）

ADR-0085 把设置分成**表达**（个性化）与**初值**（行为默认值）。工单要求"两类在树上是两个分区"。
但测绘的现量是：

| 区 | 可搬现有项 | 证据 |
|---|---|---|
| 个性化 | **4**（主题 / 语言 / 截止显示 / 详情栏默认，全在 G5，全部 A 档、零 op） | `r13a-settings-map-2026-11.md` 表 D |
| 行为默认值 | **0** | `firstDayOfWeek` / `defaultReminder` / `defaultProject` / `defaultList` / `smartParse` 各 **0 命中**；`weekStart` 那 12 处全是 `packages/ui` 内部函数入参 |

⇒ 硬分两区会交付一个**空组**。空组不是"结构清晰"，它是**对用户说这里本该有东西**。

**决定**：这一轮只落「个性化」；「行为默认值」登记在这里，**等第一个真的初值项**（最可能是「周起始」，
它要新持久化键 + 日历周渲染接线）。到那时再开组，判据不变。

---

## 4. 树外那 3 项（不在本单射程，但要说清）

测绘发现 71 项里树内 66×1 级 / 5×2 级 / **0×3+** —— 「两级内可达」在树内**已经成立**。
够不着的 3 项都在树外：

| 项 | 现在几级 | 卡在哪 |
|---|---|---|
| 任务排序档位 | 3+ | 任务视图页头 `⋯` 菜单 |
| rail 编排 | 3+ | rail「更多」→ 自定义侧栏（键 `heyta.shell.rail` 本身是 A 档表达） |
| 日历显示范围 | 3+ | 日历视图侧栏（连持久化键都没有） |

这三项**不并进设置树**：前两项是"视图自己的控件"，第三项还算不算设置项没定。
它们是 R13a 的**已知例外**，不是漏做。

---

## 5. 判据（每条都要能红）

| # | 判据 | 怎么才会红 | 现量 |
|---|---|---|---|
| 1 | 组 id 不变、显示名换了 | 把 `labelKey` 改回 `…appearance` ⇒ `settings-tree-zones.spec.tsx` 红 | ✅ |
| 2 | 版本号只有一个真源 | 在 `ProfileOverview` 里写死 `'0.1.0'` ⇒ 断言 `textContent === HEYTA_APP_VERSION` 红 | ✅ |
| 3 | 统计与会员解耦（**反向判据**） | 给统计加 `isPro` 门 ⇒ 「未登录/未订阅也看得到统计」那条红 | ✅（现量零 `isPro`、零订阅 store） |
| 4 | 退出登录只有一个主入口 | 头像菜单里再加回一条 ⇒ `account-profile-entry.spec.tsx` 的 `items` 断言红 | ✅ |
| 5 | 未登录不出现退出 | 去掉 `signedIn` 条件 ⇒ 第二条 spec 红 | ✅ |
| 6 | 入口表与代码一致 | 删掉表里那行或改坏锚点 ⇒ `check:entry-table` 红 | ✅（42 行） |

---

## 6. 我知道但没做的

1. **「行为默认值」分区**：0 项可放，不建空组（§3）。
2. **树外 3 项**（§4）没有搬进树。
3. **项级深链**：`?settings=` 仍只认组 id（测绘 §C3），本单没做项级。
4. **12 项条件不渲染**（未登录 / 没配同步 / AI 开关关）：不是级数问题，没动。
5. **首屏可见没量视口**：测绘里 66 个"1 级"含需要滚动才看到的（G3 17 项 / G6 27 项）。若把滚动算一级，这个数会掉 —— 本单没有据此改任何结构。
6. **头像菜单的"打开我的页"**：菜单里本来就有「个人中心」，本单没新增同义项（新增就是第二个入口）。
