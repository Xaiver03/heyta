# 手机日历 · 照 Apple 日历改造（融合滴答视图选项）

## 状态总览（2026-11-19）
- ✅ 顶部胶囊导航（← 2026年11月 / 今天 / 视图 / ⋯）
- ✅ 周历条：星期 + 大日期 + 农历 + 今天蓝 + 周末红
- ✅ 单日：居中日期 + 按小时时间轴（扁平）+ 红「现在」线
- ✅ 一周：周议程（7 天分段）
- ✅ 月：大标题 + 网格 + 农历 + 周末红（表头与数字）+ 今天蓝
- ✅ 视图切换：单日 / 一周 / 月（+年）；文案「单日/一周/月」
- ✅ 删除冗余说明（footnote、空全天文案）
- ✅ 全绿：移动 1361 / web 2834 / i18n / typecheck；每档模拟器截图验证
- ⏳ 可选细节：格内事件药丸样式、星期起始（周一 vs Apple 周日）、今天胶囊底部黑底

## 目标（产品负责人口径）
- 手机端日历照 **Apple 日历（iOS）** 做成"几乎一模一样"：顶部胶囊导航、横向周历条（日历条）、单日按小时时间轴、月网格。
- 唯一不同的地方：顶部视图切换做成滴答式 —— **单日 / 今天 / 一周 / 月**。
- 删除冗余说明文字（footnote 等）。

## 参考截图（模拟器里的 Apple 日历，同一 App）
- 单日：`tmp/ticktick-android/applecal_day.png`（顶部胶囊「‹ 十一月」+ 右侧[视图/搜索/+]胶囊；周历条含农历；居中日期标题；小时轴；底部「今天 + [格]/[收件箱]」胶囊）
- 视图菜单：`tmp/ticktick-android/applecal_viewmenu.png`（**单日 / 多日 / 列表**）
- 月：`tmp/ticktick-android/applecal_month.png`（顶部「‹ 2026年」胶囊；大号「十一月」；月网格含农历副标 + 事件药丸）
- 我当前实现（单日）：`tmp/ticktick-android/cal_v2_day2.png`

## 已完成
1. 新增 `apps/mobile/src/screens/CalendarWeekStrip.tsx` —— Apple 式横向周历条：周一…周日 + 大日期，今天实心主色圆，选中淡主色底，点某天切到那天。语义只上报点击，游标/选中仍走 `CalendarScreen.pickDay`。
2. `CalendarScreen` 接入：`view` 为 `day`/`week` 时在顶部导航与内容之间渲染周历条；默认档改为 **单日**（与 Apple 打开时一致）。截图 `tmp/ticktick-android/cal_v3_day.png`。
3. **视图菜单改成滴答式文案**：`order` 仍取共享 `CALENDAR_VIEW_ORDER`（R17：本地不许自建档位表，`calendar-view-entry.spec` 钉着），`labelOf` 改文案为「单日 / 一周 / 月 / 年」。⚠️ 因此菜单里**保留「年」**（共享顺序含 year）；若要彻底去掉「年」，须改共享 `CALENDAR_VIEW_ORDER` 或该守卫，属产品+架构决策。截图 `tmp/ticktick-android/cal_r16_menu.png`。
4. `@heyta/i18n` 重建 + `@heyta/mobile` typecheck 绿；`@heyta/i18n` 测试 30 通过。
5. **顶部胶囊导航**：新增 `apps/mobile/src/screens/CalendarCapsuleHeader.tsx`（左「‹ 2026年11月」胶囊 + 右「[视图图标] ⋯」胶囊），并给 `Screen` 增加可选 `header` 槽（不传时行为完全不变）。截图 `tmp/ticktick-android/cal_v4_capsule.png`。
6. **去掉日视图带框「‹ › 回到今天」卡片**：手机端 `CalendarBoard` 传 `toolbar="external"`（web 本就 external，不受影响）。截图 `tmp/ticktick-android/cal_v5_external.png`。
7. **单日主体扁平化**：`CalendarDayBoard` 加 `appearance:'card'|'flat'`（默认 card，web 不变），`CalendarBoard` 透传 `boardAppearance`，手机端传 `flat` —— 全天带与小时轴不再各套一张卡，直接铺白页。web 全量测试仍绿。截图 `tmp/ticktick-android/cal_v6_flat.png`。
8. **周历条下方居中日期标题**（Apple 形态）`11月19日 星期四`；红色「现在」线沿用共享板。截图 `tmp/ticktick-android/cal_v8_dayfix.png`。
9. **修 bug**：`cursor` 初值原为 `startOfMonth(today)`，默认进日档会渲染"月初那天"而非今天；改为初始=今天（月档仍正确，`calendarCursorFor('month', x)` 会归一到月初）。
10. **月档扁平化 + 删 footnote**：`CalendarBoard` 在 `boardAppearance==='flat'` 时月卡/当天卡不描边、不铺底，脚注整段不渲染；web 默认 card、全量测试仍绿。截图 `tmp/ticktick-android/cal_r3_month2.png`。
11. **周历条只留在单日档**：一周档本身是整周列，叠加日历条会重复（曾出现两条 16–22）。截图 `tmp/ticktick-android/cal_r4_week.png`。
12. **一周档 = 周议程（Apple「列表」形态）**：新增 `apps/mobile/src/screens/CalendarWeekAgenda.tsx`——7 段竖排「星期几 + 几号（今天高亮）」+ 各天任务（复用共享 `TaskList`），替代共享周板（其无 N 列时间轴、空时空白）。手机端在 `view==='week'` 时渲染它。截图 `tmp/ticktick-android/cal_r5_weekagenda.png`。
13. **「今天」胶囊**：`CalendarCapsuleHeader` 加 `onToday`/`todayLabel`，右侧多了「今天」胶囊（回今天）；i18n `mobile.calendar.today`（中英）。截图 `tmp/ticktick-android/cal_r7_day.png`。
14. **月档大号月份标题**：月档在网格上方用 `screen-title` 显示「2026年11月」（Apple 顶部「十一月」）。截图 `tmp/ticktick-android/cal_r7_month.png`。
15. **周末色**：设计系统新增 `color.weekend` token（`tokens.css` 明暗各一条，借红色档、语义独立；`tokens.ts` 登记，已 regen+build）。周历条周六/周日数字与星期用该色（今天仍主色）。截图 `tmp/ticktick-android/cal_r9_weekend.png`。
16. **单日无全天事项时隐藏「全天」带**：`CalendarDayBoard` 在 `flat` 且全天为空（无任务/倒数日）时整块不画，时间轴从 0:00 起——Apple 一致。web 走 card 分支不受影响、全量测试绿。截图 `tmp/ticktick-android/cal_r10_flatday.png`。
17. **月档去掉网格下的日期头+当天清单**：手机端月档传 `showSelectedDayList={false}`（复用已有开关，未新增 API）。月格内已有任务条，Apple 也是只在格内画。截图 `tmp/ticktick-android/cal_r12_month.png`。
18. **月格周末色**：`DayCell` 加 `isWeekend`、`CalendarBoard` 加默认 false 的 `weekendAccent`（web 不变），手机端开启；月格六/日数字用 `color.weekend` 红。截图 `tmp/ticktick-android/cal_r13_month_weekend.png`。
19. **周历条农历副标**：`CalendarWeekStrip` 用 `@heyta/domain` 的 `solarToLunar` 在每格数字下显示农历日名（初一…三十），对齐 Apple 日历条。截图 `tmp/ticktick-android/cal_r14_lunar.png`。
20. **月格农历副标 + 单一事实源**：`@heyta/domain` 新增 `lunarDayLabel(date)`；`DayCell` 数字改为列布局（数字上、农历下），`CalendarBoard` 加默认 false 的 `showLunar`（web 不变），手机端月档开启。截图 `tmp/ticktick-android/cal_r18_month_lunar.png`。
21. **视图菜单文案「单日 / 一周 / 月 / 年」**：R17 守卫禁止在 `apps/mobile/src` 写档位键字面量；解法是把「档位→i18n 键」映射放到共享包 `@heyta/ui` 的 `CALENDAR_VIEW_LABEL_KEYS_MOBILE`（值指向 `mobile.calendar.view.*`），mobile 只引用常量。菜单顺序仍取共享 `CALENDAR_VIEW_ORDER`（月/一周/单日/年）。截图 `tmp/ticktick-android/cal_r19_menu_labels.png`。
22. **月档星期表头周末色**：列头 六/日 用 `color.weekend`（`weekendAccent` 门控，web 不变）。三档整体验收截图 `tmp/ticktick-android/final_day.png` / `final_week.png` / `final_month.png`。

## 待办（按依赖排序）
1. 月格内更接近 Apple 的**事件药丸**（当前是色块条 bars，Apple 是小圆胶囊）——共享 `DayCell`。
2. 星期起始：Apple 周日开头（日一二…），我们周一开头；要一致需评估 domain 与全端（影响月网格）。
3. 「今天」胶囊视觉更贴 Apple（底部左浮动、黑底选中态）。

## 约束
- 优先 `apps/mobile`；共享 `CalendarBoard` / i18n 改动要评估 web 影响并跑 `pnpm --filter @heyta/web test`。
- 模拟器验证：`4C1B456B-…`，bundle `com.heyta`，`idb ui tap` 用**点（像素÷3）**；tab 坐标从 `idb ui describe-all` 取（日历 tab 中心 =(120,808)）。
