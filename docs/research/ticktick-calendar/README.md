# 滴答清单（Android）日历右上角拆解

实测设备：PACM00 / Android 10，TickTick `com.ticktick.task`。取数：`adb exec-out screencap` + `uiautomator dump` 读资源 id。

## 周视图右上角三枚（左→右）
| 控件（真实资源 id） | 作用 | 何时出现 |
|---|---|---|
| `view_week_view_mode` | **周视图形态切换**：时间轴网格 ⇄ 按天列表（左月历+右侧按天两列） | **仅「周」** |
| `select_calendar_mode` | **视图/周期选择器**：列表 / 年 / 月 / 周 / 3日 / 日；按钮文字是当前段（如“十一月”“2026年”） | 所有档 |
| `iv_abc_more_options` | ⋯ 更多 | 所有档 |

- 年/月/日/3日/列表：**只有** `select_calendar_mode` + `⋯`，**没有** `view_week_view_mode`。
- 证据：`uiautomator dump` 里周视图多出 `id/view_week_view_mode`（bounds [594,96][762,264]），点它 → 界面从「时间轴网格」（`tt-week-timeline.png`）变成「按天列表」（`tt-week-agenda.png`）。

## 关系
跨度(span)为主：决定窗口、`< >` 步进、有没有形态按钮；周形态为从：只切换同一段内的呈现，不动窗口/游标。判据：`availableWeekModes(span) = ['timeline','agenda']` 当且仅当 span==='week'，其余单一呈现即不显示。

## 任务页的“分块”从哪来（实测，PACM00/Android10）
两层，都是**用户自建**的，与标签/优先级无关：

| 层 | 是什么 | 证据 |
|---|---|---|
| **清单 List（一级分类）** | 左侧抽屉那串：今天/收集箱（智能清单）+ 工作任务 / 个人备忘 / 购物清单 / 学习安排 / 心愿清单 / 锻炼计划 / 欢迎（自建清单） | `img/tt-drawer-lists.png` |
| **分组 Section（清单内的二级分块）** | “欢迎”清单页把 12 条分成 **新手入门(3) / 功能模块(6) / 探索更多(3)** 三张卡片，每张有标题+计数+折叠 | `img/tt-welcome-sections.png` |

结论：任务页那张“分块卡片”= 按 **分组(Section)** 渲染；分组归属于某个 **清单**；清单就是抽屉里的一级“分类”。
智能清单（今天 / 收集箱 / 最近7天）跨清单聚合，会再按清单或日期分块显示。
