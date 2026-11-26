# B 档 8 格补靶子清单（需人工在滴答里开窗切屏后我截图）

> 建立 2026-11-27。背景：覆盖图谱 §3 里 B 档 = **功能已有、但缺滴答一手靶子**，所以「看着有其实凭猜」，不能判 A。
> 滴答当前是菜单栏常驻、**无窗口**；程序化切视图（AXPress / 坐标点击）实测不生效，只能由人在滴答窗口里点。
> 你在滴答里把对应屏点开后停下即可，我用 `screencapture -l<窗口id>` 截图，文件名落到下面的「命名」。

## 每格要什么

| # | 屏 | heyta 现状（代码） | 需要你在滴答里点到 | 截图命名 |
|---|---|---|---|---|
| 5 | 侧栏迷你月历 | `CalendarSidebar.tsx`（仅日历视图侧栏有迷你月历） | 日历视图，点开左侧日历栏（**仅 Android 有；Mac 月视图全宽无左栏，已实拍确认**） | `r3-minimonth.png` |
| 13 | 全部（跨清单平铺） | `task-filter.ts` 的 `all` 分支 | 侧栏「全部」智能清单 | `r3-all.png` |
| 31 | 任务附件 | `AttachmentList.tsx` / `attachment-actions.ts`（上传配额全链） | 打开任一任务的「附件」区并上传/展示一张 | `r3-attachment.png` |
| 39 | 日历侧栏/选择 | `CalendarSidebar.tsx`（所有/清单/标签多选） | 日历视图左侧日历栏展开态（**仅 Android**） | `r3-calsidebar.png` |
| 44 | 看板 | `KanbanView.tsx`（列=清单、跨列拖拽改 projectId） | 任务视图切换到「看板」 | `r3-kanban.png` |
| 58 | 共享清单默认通知 | `ShareNotificationSettings.tsx` / `notification-model.ts` | 设置→共享协作→某共享清单的通知默认值页 | `r3-share-notify.png` |
| 66 | 摘要卡 | `share-summary.ts`（当前只出纯文本卡；图片卡仅倒数日） | 分享→「图片/摘要」产出页（若有） | `r3-summary.png` |
| 75 | 邮件/第三方投递 | `inbound-core/parser.ts`（webhook 已通；IMAP 待确认） | 设置→关联与导入→投递/转发配置页 | `r3-inbound.png` |

## 说明
- 上表 5 格里 #5/#39 是 **Android 端专属**（Mac 月视图无左栏）；其余在 Mac 桌面端即可。
- 每屏一张就够，不需要逐动作录屏；若某屏滴答确实没有独立界面（如 #58/#66/#75 可能只有 web 版），备注「桌面无此独立屏」，我按「无法取证·以 Android/Web 截图或产品裁决收口」处理。
- 截完我补完 §3 的靶子列，把对应格从 B 升 A（或按实际降级说明），并更新现量读数。
