# 滴答清单「设置与个性化」逆向取证

> 状态：**调研记录**（归档层，结论有变时新增勘误、不改原文）
> 日期：**2026-11-06**（CST）
> 触发：产品负责人 —— *「UX 上面有非常多可以学习的。重点看它的设置界面和我的界面，这些非常重要，因为这是个个性化的东西。个人设置有哪些设置？有哪些定制化的东西？一定要逆向出来。」*
> 范围：Windows 8.2.5.0（WPF，BAML 反编译）+ macOS arm64（NIB 解码 + 二进制符号 + GRDB schema）。
> 只回答**「有哪些设置 / 哪些可定制」**，不回答"它做得好不好看"。

---

## 0. 这份取证站在什么上面

### 0.1 证据源与它们各自能回答什么

| 证据源 | 本机位置 | 能回答 | **不能**回答 |
|---|---|---|---|
| 反编译 XAML（638 个） | `/tmp/rea-lab/win/xaml/` | 这一屏的**控件结构、资源键、控件 Name、绑定路径**：一屏有哪几行、哪几行是开关/下拉/单选 | 屏上文字的**实际内容**（`{}{StaticResource X}` 的 X 是符号，值在 deferred stream 里） |
| BAML（1296 个） | `/tmp/rea-lab/win/ui/` | **类名、模型名、命名空间**；文件名给出"哪一屏的编译产物存在" | 同左，**且文件名 ≠ 这一屏一定存在且可用**（见 0.3） |
| macOS NIB 名清单（436） | `/tmp/rea-lab/nib-names.txt` | macOS 侧**有哪 49 个设置类**（类名即屏名） | 屏上有哪些行（NIB 里几乎只有占位 label，文案运行时给） |
| macOS nib 二进制 | `/tmp/rea-lab/bundles/b*/Fake.app/Contents/Resources/*.nib` | 容器类型（例如各主题页都是 `UICollectionView` + 左对齐流式布局）、极少数 label | 条目文案、选项值 |
| 本地化词条（en/zh 各 3528） | `/tmp/rea-lab/out/strings.json` | **条目名与选项名的最可靠来源**（键 = 英文源串，值 = 中文） | 哪一屏用它（键与屏无绑定关系） |
| Kotlin 数据模型 | `/tmp/rea-lab/out/w-exe-models.txt` | **"个人设置"到底有哪些字段**（`SettingsModel` 128 列、`UserPreferenceModel` 21 个子配置、`CommonSettings` 32 列） | 字段的默认值 |
| macOS GRDB DDL | `/tmp/rea-lab/out/grdb-ddl.txt` | 设置**落在哪张表、是否随账号同步**（`ZTTUSERSETTINGS` 有 `ZUSER`/`ZACCOUNTID`/`ZSYNCSTATUS`） | 同上 |

### 0.2 复现命令

```sh
# 一屏的结构（Windows）
cat  "/tmp/rea-lab/win/xaml/views/theme/appearancecontrol.xaml"
# 一屏的控件名 / 资源键 / 绑定
grep -oE 'Name="[A-Za-z0-9_]+"' /tmp/rea-lab/win/xaml/views/theme/appearancecontrol.xaml
grep -oE 'Resource [A-Za-z0-9_.]+' /tmp/rea-lab/win/xaml/views/theme/appearancecontrol.xaml | sort -u
# 条目中文名（macOS 两端共用的词条）
python3 -c "import json;S=json.load(open('/tmp/rea-lab/out/strings.json'));print(S['zh']['app_style_flat'])"
# "个人设置"的字段全表（Windows）
grep -A1 'TYPE SettingsModel' /tmp/rea-lab/out/w-exe-models.txt
# 设置落在哪张表（macOS）
sed -n '1019,1045p' /tmp/rea-lab/out/grdb-ddl.txt
```

> ⚠️ **这些产物在 `/tmp`，出不了这台机器也不会被提交。** 本文每条结论都标了证据源与符号名，仓库里的读者仍可据此回到二进制复核；但**复核这件事本身需要重新解包**（步骤见 [dida-view-unification.md](dida-view-unification.md) 同族流程）。这是本文最大的结构性局限，写进 §7 第 1 条。

### 0.3 三条判据（本文自己遵守的）

1. **文件名 ≠ 实现。** `views_theme_prothemegrid.baml` 存在只证明"这一屏被编译过"，**不证明**它被任何入口引用、也不证明这一版还可达。本文凡写"有这一屏"都另给一条**结构证据**（XAML 的控件名/资源键、或 NIB 的容器类型、或模型字段）；只有文件名一条的，标 `C 级`。
2. **符号名 ≠ 屏上文案。** `StaticResource LockAfter` 只能说明"这一行的文案键叫 `LockAfter`"。本文**不把资源键翻译成中文当作它的文案**；需要举例一律用"第 N 类"或我自己的措辞。
3. **不抄它的表达。** 全文**不出现**任何它的色值、图标路径、皮肤资源；**它的 UI 文案**引文一律不超过 6 字，且只用在通用词（主题 / 字体 / 图标 / 便签 / 时区 / 扁平 / 卡片）。凡超过 2 个字的描述都是我的归纳，不是它的原句。（开头那段引文是产品负责人自己的话，不是它的文案。）

### 0.4 证据强度分级（本文每格都标）

| 级 | 含义 | 例子 |
|---|---|---|
| **A** | 数据模型字段 / 控件 Name / 绑定路径 / 词条键 —— 机器可枚举的**标识符** | `sidebarCountNoneItemView`、`SettingsModel.ThemeId`、`complete_style_strike_through` |
| **B** | 结构（容器类型、控件类型、资源键在哪个文件里） | `prothemegrid.xaml` 里三个绑定 `Name`/`Selected`/`Loading` |
| **C** | 只有类名或文件名，没有更细的结构 | `TTThemePreferencesBadgeItem` |
| **D** | 命名推断（我在猜） | "默认字号是 normal，因为它叫 `fontfamilynormal`" |

---

## 1. 设置树全貌（分区 → 界面 → 条目）

> 🔴 **先说清"分区"是谁的分区。** 它自己**没有**本文这种 17 个分区：桌面端的设置是**一个纵向菜单 + 右侧一列长页**（`settingdialog.xaml` 的 `MenuListView` 绑 `MenuTitleList`），菜单项在代码里拼，**顺序未核实**。macOS 侧是**分 tab** 的（`TTSettingsTabModel` / `TTSettingsTabCell`）。
> 本文的 17 个分区是**为组织方便按功能归的**，不是它的信息架构。因此每格证据指向的是**那一屏/那一面板**，不是"菜单里有这一项"。
> 唯一能证明"它自己也把这些串成一列"的硬证据：`views/setting/moresettingsconfig.xaml` 一屏里依次挂了 `GeneralSettings`（语言）、`SmartRecognitionConfig`、`NewTaskDefault`、`MiniCalendarConfig`、`LockSettings`、Network/Proxy 一行、`TemplateControl` —— **语言、智能识别、任务默认值、迷你日历、应用锁、代理、模板，七个不相干的东西在同一列**（A 级，见 §3.3）。

### 1.1 账户

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 账户信息面板 | 头像、昵称/名称、邮箱 | `views/config/accountinfo.xaml` 控件名 `HeadimgImageBrush` `email` `name`（绑定 `displayEmail`）；NIB `TTAccountPreferencesViewController` 内含 `Email` `Name` `Profile` | A |
| 账户信息面板 | 登出 | `accountinfo.xaml` 控件名 `LogoutButton`；NIB 同上含 `Sign Out` | A |
| 账户信息面板 | 会员状态行 + 下次续费日 + 宽限期提示 | `accountinfo.xaml` 控件名 `NextBillingDateTextPanel` `NextBillingDateText` `GraceHelper` `Tips` | A |
| 密码 | 改密码 / 更新密码入口 | `strings.json` 键 `Update Password`、`confirm_current_password` | A |
| 第三方 / 日历账号绑定 | 绑定与解绑、失效态 | `views/config/editbindaccountwindow.xaml`（绑定 `Calendars`、`IsExpired`，文案键 `Edit`） | A |
| 邮件绑定 | 换邮箱的验证流程 | 未核实（macOS NIB 清单里没有 EmailChange 类；`AccountType` 在 `CommonSettings` 里但只表示账号类型） | — |
| 注销账号 | 产品里是否有独立入口 | **未核实**。`SettingsModel` 里有 `NeedResetPassword` / `NeedResetUserId`，从名字看是"需要重置"而不是"注销" | D |

### 1.2 外观与主题

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 外观主页面 | 一页装下：主题区、界面样式、自动夜间、应用图标、显示面板集合 | `views/theme/appearancecontrol.xaml` 控件名 `AppearanceTitle` `ThemeSelectGrid` `ThemePanel` `InterfaceStyleText` `AutoDarkText` `AppIcons` `DisplayPanel` | A |
| 主题区（5 个系列） | 纯色 / 季节 / 城市 / 照片 / 自定义 | 同文件控件名 `PureColorItems` `SeasonItems` `CityItems` `PhotoItems` `CustomPanel`；与 5 个系列卡模板 `resource/themecard/` 的 `colortheme` `seasontheme` `citytheme` `phototheme` `customtheme` **一一对应** | A |
| 预设/照片主题网格 | 一张卡一个主题（缩略图、加载中、选中勾） | `views/theme/prothemegrid.xaml` 绑定 `BackImage` `Loading` `Name` `Selected` | B |
| 纯色主题网格 | 一张卡一个色主题（色、是否深色、是否纯白、选中） | `views/theme/purecolorgrid.xaml` 绑定 `Color` `IsDark` `IsWhite` `Name` `Selected` | B |
| 深色色板 | 深色主题卡 + 自选颜色浮层 | `views/theme/darkcolorgrid.xaml` 控件名 `ChoosePopup` `CustomColorPopup` `CustomColorView` `CustomSelector` | B |
| 自定义主题 | 背景图 + 不透明度 + 模糊 + 亮度 + 主题色 | `views/theme/customthemedialog.xaml` 控件名 `ImageClipper` `ImageOpacitySlider` `ImageBlurSlider` `ShowAreaOpacitySlider` `ChooseImageBtn`；模型 `CustomThemeSetting` 5 字段（`ThemeImageOpacity` `ThemeImageBlurRadius` `ShowAreaOpacity` `CustomThemeLocation` `CustomThemeColor`） | A |
| 界面样式 | 2 档，带实时小预览 | `views/theme/interfacestylewindow.xaml` 两个 `RadioButton`（`FlatRadioButton` `CardRadioButton`）+ 两套 mock；NIB `TTAppStylePickerViewController`（`TTAppStylePickerItemView` 有 `cardView` / `flatView`） | A |
| 自动夜间 | 一个开关 + 选一个夜间主题色 | `views/theme/autodarksettingwindow.xaml` 控件名 `UseSystemThemeCheckBox` `DarkSelector`（文案键 `SwitchAuto` `NightTheme`） | A |
| 应用图标 | 图标网格，单选，会员图标带角标 | `views/theme/appiconitem.xaml` 绑定 `Image` `Width` `BorderRadius` `BorderVisible` `IsPro` `Selected`（会员角标是 `pro_theme_header.png`，绑 `IsPro`）；NIB `TTAppIconPreferencesViewConntroller`（`UICollectionView` + 左对齐流式布局）+ `TTAppIconPreferencesFooterView` | A |
| 图标角标/头部 | 主题页的分组头与角标 | NIB `TTThemePreferencesHeaderView` `TTThemePreferencesBadgeItem` `TTThemePreferencesStyleItem` `TTThemePreferencesViewItem` `TTThemePreferencesCustomView` | C |

### 1.3 显示（密度 · 数量 · 完成行 · 颜色 · 各视图样式）

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 显示偏好页（mac） | 字号、侧边栏数量、已完成行样式 | NIB `TTDisplayPreferencesViewController`（二进制内含 `Font Size`）+ 控件 `fontSizeNormalItemView` `fontSizeLargeItemView` `fontSizeExLargeItemView` `sidebarCountNoneItemView` `sidebarCountTasksItemView` `sidebarCountAllItemView` | A |
| 字号面板 | 3 档 | `views/theme/fontsizesetpanel.xaml`（`FontSizeItems`）+ 资源 `fontresource/font_normal|font_middle|font_large` | A |
| 侧边栏数量 | 3 档（不显示 / 只数任务 / 全显示） | `views/theme/numdisplaysetpanel.xaml`（`MainItems`）+ `sidebarCountNone/Tasks/AllLabel` | A |
| 已完成行样式 | 2 档（标准 / 划线） | `views/theme/completelinedisplaysetpanel.xaml`（`MainItems`）+ `strings.json` 键 `complete_style_default`、`complete_style_strike_through` | A |
| 清单颜色显隐 | 开关（任务行上是否显示所属清单的颜色） | `views/theme/projectlistcolorvissetpanel.xaml`（`MainItems` + 说明浮层 `ShowOrHideListColor`）；词条 `show_or_hide_list_colors` | A |
| 通用显示面板 | 标题运行时给、条目由数据生成 | `views/theme/displaysettingspanel.xaml`（`Title` + `SetNumItems`，无静态条目）→ **条目集合未核实** | B |
| 列表显示（mac） | 未核实条目集合 | NIB `TTListDisplaySettingsVC` `TTListDisplaySettingsWindowController`；Windows 侧疑为 `views/config/switchlistviewcontrol.xaml`（绑定 `SelectedIndex`） | C |
| 看板显示 | 卡片尺寸、日期显示在哪、列颜色、输入框、检查项 | `views/kanban/kanbandisplaysettingwindow.xaml` 控件名 `KanbanSizeComboBox` `ShowDateByComboBox` `ShowColumnColorCheckBox` `ShowInputBoxCheckBox` `ShowCheckItemCheckBox` | A |
| 时间线显示 | 任务块颜色来源、显示星期、显示子任务 | `views/timeline/timelinesettingswindow.xaml` 控件名 `TaskBlocksColorComboBox` `ShowWeekCheckBox` `ShowCheckItemCheckBox`；模型 `TimelineSettingsModel` 3 字段 `Color` `ShowWeek` `ShowGuide` | A |

### 1.4 通知与提醒

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 提醒设置页 | 提醒方式、提醒来源分类、常规提醒（会员）、提醒铃声、音量、完成音、是否显示提醒详情 | `views/config/reminderconfig.xaml` 控件名 `ShowReminderComboBox` `ReminderSourceCombo` `AnnoyingReminderCheckbox` `ProIcon` `RemindSoundComboBox` `CompletionSoundComboBox` `VolumePanel`（滑杆）`ReminderDetailComboBox` | A |
| 邮件提醒 | 开关、邮箱验证态、邮件内容类型 | 同文件控件名 `EmailReminderCheckBox` `VerifiedIcon` `EmailPanel` `EmailNotificationType`；词条 `Email_Notifications` `Email_Notifications_desc`（每日上限写在文案里） | A |
| 共享清单的默认通知 | 默认接收哪几类通知 | `views/config/shareconfig.xaml`（`AutoAcceptCheckbox` + `NotificationSetting`，文案键 `DefaultNotification`）；NIB `TTCollaboratePreferenceViewController` 二进制里带一整段说明（"手动改过某个清单后默认值对它失效"） | A |
| 通知样式 | 消息提示样式 / 提醒通知 | 词条 `settings_notification_style`、`settings_preference_notifications`；**具体档位未核实** | C |
| 提醒页（mac） | 未核实条目 | NIB `TTNotificationPreferenceViewController` | C |
| 应用内提醒的落点 | 今日不再提醒 | 词条 `No_reminders_for_today` → 属"任务级"而非设置项，列此仅为排除 | B |

### 1.5 日期与时间

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 日期与时间页 | 时间格式、每周从哪天开始、农历、其他历法、周数、节假日、时区 | `views/config/datetimeconfig.xaml` 9 个文案键 + 10 个控件名 `TimeFormatComboBox` `WeekStartFromComboBox` `LunarToggle` `OtherCalendarComboBox` `ShowWeekNumToggle` `EnableHolidayToggle`；NIB `TTFuncPreferencesDateTimeViewController` 二进制内含 `Start Week on` | A |
| 其他历法 | 至少 4 种（中国农历、韩国农历、越南农历、波斯历） | `strings.json` 键 `chinese_lunar` `korean_lunar` `Vietnamese Lunar` `persian_calendar` | A |
| 时区 | 当前时区 + 可拖动可删除的附加时区 | `views/calendar/calendartimezoneconfigwindow.xaml`（`AddTimeZone`）+ `calendartimezoneconfigitem.xaml`（绑定 `CanDelete` `CanDrag`）；模型 `CalTimelineTimeZones` 3 字段 `enabled` `current` `additional` | A |
| 时区变更处理 | 检测到时区变了会要求重启 | 词条 `Time zone has changed` 及其整段说明 | B |

### 1.6 快捷键

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 快捷键页 | 4 类分组（导航 / 切换视图 / 快捷添加 / 编辑任务） | 词条 `shortcuts_navigate_title` `shortcuts_switch_view_title` `shortcuts_quick_add_desc` `shortcuts_edit_task_desc`；`views/config/shortcutsconfig.xaml`（`ShortcutList`） | A |
| 快捷键页 | 全局快捷键（应用在后台也生效）单独一类 | 词条 `shortcuts_desc_global` | A |
| 快捷键页 | 重置 | `views/config/shortcutsconfig.xaml`；NIB `TTShortcutsPreferenceViewController` 二进制内含 `Reset` | A |
| 快捷键录制控件 | 点一下再按键；热点被占用时提示 | `views/config/hotkeycontrol.xaml` 绑定 `IsKeyValid` `OriginHotKey` `ToolTip`；词条 `shortcut_change_desc` `shortcut_occupied_tips` | A |
| 分组可折叠 | 8 个可折叠分组 | 模型 `ShortcutModel` 8 字段（`TaskSetFolded` `TaskOperateFolded` `AppGlobalOperateFolded` `GlobalOperateFolded` `SetTimeFolded` `SetPriorityFolded` `QuickJumpFolded` `OpenOperation`） | A |
| 锁定热键 | 锁定/解锁应用的热键 | `views/setting/locksettings.xaml` 控件 `LockHotkey`（`HotkeyControl`） | A |

### 1.7 日历（本地 · 订阅 · 时区）

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 日历显示设置 | 9 类内容的显示开关 + 样式 + 颜色 | `views/calendar/calendardisplaysettingwindow.xaml` 控件名 `ShowWeekend` `ShowComplete` `ShowSubtask` `ShowRecycle` `ShowHabit` `ShowFocus` `ShowCountdown` `ShowCourse` `EnableTimeZoneCheckBox` `SelectedStyle` `ColorGrid`；模型 `CalendarConfig` 9 字段 | A |
| 内容样式 | 2 档（现代 / 经典）+ 任务完成框 + 年视图热力图 | 词条 `calendar_view_item_style_modern` `calendar_view_item_style_classic` `calendar_view_task_checkbox` `calendar_view_year_heatmap` | A |
| 颜色来源 | 按清单 / 标签 / 优先级 / 跟随主题色 / 固定色 | 词条 `colored_by_list` `colored_by_tag` `colored_by_priority` `colored_by_theme` `colored_by_custom_color`；`views/calendar/calendarcolorconfigwindow.xaml`（`FixedColorStr` `IsShowFixColor` `DisplayWayText`）；模型 `CalendarColorConfig`（`Task` `Habit` `Countdown` 三套）+ `CalendarColorConfigItem`（`ColorType` `SharedColor` `ColorMap`） | A |
| 本地日历 | 系统日历授权 + 选哪个 | NIB `TTLocalCalendarPreferenceWindowController` `TTLocalCalendarPreferenceCell`；词条 `add_local_calendar` `Local calendar authorization failed` | A |
| 订阅类型选择 | 本地 / Google / CalDAV / URL 订阅 | `views/config/selectsubscribetypewindow.xaml`（`SelectCalendarType`）；词条 `calDav_calendars_desc` `url_calendars_desc` | A |
| URL 订阅编辑 | 名称、地址、颜色、显示 | `views/config/editurlwindow.xaml` 控件名 `UrlSubscribeAddress` `Color` `Display` `Name` + `IsExpired` | A |
| Google 关联（双向） | 关联哪个日历、默认清单、默认标签、解除 | `views/config/linkgooglecalendarwindow.xaml` 13 个文案键（含 `ChooseCalendar` `ChooseList` `DefaultList` `DefaultTags` `Disintegration`） | A |
| 订阅日历列表（mac） | 订阅项 / 关联项 / 账号 三层 | NIB `TTCalSubscriptionPreferenceViewController` `TTCalSubscriptionProjectPreferenceViewController` `TTCalConnectedAccountPreferenceViewController` `TTCalConnectedAccountPreferenceWindowController` | C |
| 节假日 | 导入节日、编辑节日、订阅失效态 | `views/config/editholidaysubswindow.xaml`（`reminder` `Color` `Display`）+ GRDB 表 `ZTTHOLIDAY`（`ZDATE` `ZNAME` `ZCATEGORY` `ZRESTTYPE`） | A |
| 课程表 | 显示开关 | 同"日历显示设置"的 `ShowCourse`；GRDB 表 `ZTTCOURSE` | A |

### 1.8 集成与导入

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 关联与导入页 | 集成项列表 + 类型选择器 | `views/config/integrationsandimporttypeselectwindow.xaml` `integrationsandimporttypeselector.xaml` `integrationitemscontrol.xaml`（均有类名，条目运行时生成）；词条 `settings_integrations_and_import` | B |
| 已关联账号 | 关联信息 + 失效态 + 新增 | `views/config/calendarconnectinfowindow.xaml`（`AddIntegration` `NoIntegratedCalendar`） | A |
| 单向"把列表订阅到别处" | 给出一个只含未完成且有日期任务的链接 | `views/config/gettickurllinkdialog.xaml`（`EnableTheUrl` `GetListUrlTips`）；词条 `settings_enable_url_hint` | A |
| MCP / CLI 集成（AI 页内） | MCP Servers、CLI、集成入口 | `views/setting/aifeaturesconfig.xaml` 控件名 `McpDescText` `CliTitleText` `CliDescText` + 文案键 `Integrations` `MCPServers` `Privacy` | A |
| 导入（第三方数据） | 未核实（未见独立 import 窗口） | `views/config/integrationsandimporttypeselectwindow.xaml` 是唯一线索 → **导入项清单未核实** | C |

### 1.9 专注 · 番茄

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 专注设置页 | 番茄时长、短休、长休、长休间隔 | `views/pomo/pomosettings.xaml`（`PomoDuration` `ShortBreakDuration` `LongBreakDuration` `LongBreakEvery`）；GRDB 表 `ZTTPOMOSETTINGS` 有 `ZPOMODURATION` `ZSHORTBREAKDURATION` `ZLONGBREAKDURATION` `ZLONGBREAKINTERVAL` | A |
| 专注设置页 | 自动开始下一个 / 自动开始休息 / 自动次数 | `ZTTPOMOSETTINGS.ZAUTOPOMO` `ZAUTOBREAK` `ZAUTOPOMODOROCYCLE`；`PomoLocalSetting` 有 `AutoNextPomo` `AutoBreak` `AutoPomoTimes` | A |
| 专注设置页 | 开始铃声 / 结束铃声 / 休息结束铃声 / 音量 | `views/pomo/selectsoundcontrol.xaml`（`BackSound` `Volume`）；`PomoLocalSetting.FocusEndSound` `BreakEndSound` | A |
| 专注设置页 | 自动打开专注窗、Mini 模式、不透明度、专注窗主题 | `PomoLocalSetting` 的 `AutoShowWidget` `PomoWindowOpacity` `PomoWindowTheme` `PomoTopMost` `PomoWindowTop` `PomoWindowLeft`；NIB `TTFocusSettingsPopWindowController` | A |
| 专注设置页 | 专注多端同步 | 模型 `FocusConfig.keepInSync`；词条 `focus_auto_sync` + 其说明 | A |
| 目标 | 目标番茄数 / 目标专注时长 | `ZTTPOMOSETTINGS.ZDAILYPOMOGOALS` `ZDAILYFOCUSDURATION`；词条 `Pomo Goals` `Focus Duration Goals` | A |
| 预计番茄 / 预计时长 | 在任务上设置预计值 | `views/pomo/pomomodityspanconfig.xaml`（`PomoEstimateSpan`）+ `views/pomo/taskpomosetdialog.xaml` → 属**任务级**，不是设置项 | B |
| 专注统计口径 | 显示哪些统计、默认添加哪种记录 | `PomoLocalSetting.MiniStatisticsTypes` `AddRecordType` `DisplayType` | A |
| 专注设置页（mac） | 未核实条目 | NIB `TTPomoPreferenceViewController` | C |

### 1.10 习惯

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 习惯编辑 | 频率、目标、开始日期、持续天数 / 永久、提醒、自定义提醒 | `views/habit/addoredithabitdialog.xaml` 11 个文案键（`Frequency` `Goal` `StartDate` `DurationDays` `Forever` `reminder` `ConstantReminder` `Custom`）；分控件 `sethabitfrequencycontrol.xaml` `sethabitgoalcontrol.xaml` `sethabitremindercontrol.xaml` `sethabiticoncontrol.xaml` | A |
| 习惯编辑 | 打卡后是否记日志 | 同文件文案键 `RecordAfterCheck`；词条 `Habit Log` | A |
| 习惯设置 | 在「今天」显示、在日历显示、启用、默认分组 | `views/habit/habitsettingwindow.xaml`（`ShowInToday`）；模型 `HabitSettingsModel` 4 字段 `ShowInCalendar` `ShowInToday` `Enabled` `DefaultSection`；GRDB 表 `ZTTHABITSETTINGS` 同名 4 列 + `ZDEFAULTSECTIONMODEL` | A |
| 习惯样式 | 打卡样式 / 记录模式 | 模型 `HabitConfig.style`；词条 `Checked-in Style` `Habit Record` → **档位未核实** | B |
| 习惯图标与颜色 | 按习惯色 / 固定色 | 词条 `colored_by_habit` `colored_by_custom_color_4_habit_desc`；`sethabiticoncontrol.xaml`（`IconColor` `IconText` `TextColor`） | A |
| 习惯（mac） | 窗口存在；桌面端不支持编辑习惯 | NIB `TTHabitSettingsWindowController`；词条 `Edit Habit is not supported on desktop apps right now.` | A |

### 1.11 智能清单

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 智能清单页 | 显示哪几个 + 显示时机 | `views/setting/smartlistconfig.xaml`（`SmartListView` `ExtraView` `BottomView`）；模型 `SmartProjectsOption` + `SmartProjectOption` 4 字段（`Name` `ViewMode` `SortOption` `Timeline`） | A |
| 内置智能清单逐个开关 | 至少 11 个（全部/今天/明天/最近 7 天/分配给我/已完成/已放弃/回收站/标签/收件箱/自定义） | 模型 `SettingsModel` 的 `SmartListAll` `SmartListToday` `SmartListTomorrow` `SmartList7Day` `SmartListForMe` `SmartListComplete` `SmartListAbandoned` `SmartListTrash` `SmartListTag` `SmartListInbox` `ShowCustomSmartList` | A |
| 显示时机 | 3 档 + 提前 N 天 | 词条 `smart_list_always_show` `smart_list_on_the_day` `smart_list_xx_days_early` | A |
| 智能识别 | 日期解析、去掉时间文本、标题里保留标签、网址解析 | `views/setting/smartrecognitionconfig.xaml` 7 个文案键；模型 `GeneralConfig.urlParseEnabled`；GRDB `ZTTUSERSETTINGS.ZSMARTRECOGNITIONCONFIGURATION` | A |

### 1.12 模板

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 模板管理 | 任务模板 / 笔记模板、如何创建、无网络态 | `views/config/templatecontrol.xaml` 4 个文案键（`HowToCreateTemplate` `ManageTemplate` `Template` `TemplateNoNetWork`）；词条 `task_template` `note_template` | A |
| 模板编辑 | 名称重复校验、预览 | `views/config/edittemplatewindow.xaml`（`TemplateNameExist`）+ `previewtemplatewindow.xaml`（`HowToModifyTemplate`） | A |
| 总结模板 | 模板列表、显示项、每种显示项可单独开关与排序 | 模型 `SummaryTemplates.templates` + `SummaryTemplate` 6 字段 + `SummaryDisplayItem` 4 字段（`key` `enabled` `sortOrder` `style`） | A |
| 模板（mac） | 未核实 | NIB 清单里**没有** Template 类 → mac 侧模板入口未核实 | — |

### 1.13 共享协作

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 共享设置 | 自动接受邀请（+ 一句解释） | `views/config/shareconfig.xaml`（`AutoAcceptCheckbox`，文案键 `Collaborate` `AutoAcceptInvite` `AutoAcceptInviteMessage`）；模型 `TeamConfig.autoAcceptInvite` | A |
| 共享清单默认通知 | 默认接收的通知类型 | 同文件 `NotificationSetting`（`DefaultNotification`）；NIB `TTCollaboratePreferenceViewController` 长说明 | A |
| 团队 | 团队会员状态 | NIB `TTAccountSubscriptionPreferenceWindowController`；词条 `Enjoy all Premium features with your team.` `notification_for_team_*` | B |
| 共享（mac） | 未核实条目 | NIB `TTCollaboratePreferenceViewController` | C |
| 共享清单的"对我隐藏" | 每清单级 | 词条 `If enabled, tasks within this list won't be shown...` → 属**清单级**设置，不是全局设置项 | B |

### 1.14 会员与订阅

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 会员页 | 标题/描述、升级按钮、管理订阅、隐私政策与服务条款、订单历史 | `views/setting/premiumconfig.xaml` 控件名 `TitleText` `DescText` `UpgradeBtn` `ManageText` `PrivacyText` `ServiceText` `ItemsControl` + 文案键 `OrderHistory`；NIB `TTPremiumPreferencesViewController` 二进制内含 `Order History` `Privacy Policy` `Terms of Use` | A |
| 付费详情 | 权益清单（至少 5 项）+ 4 种支付方式 + 同意条款 | `views/upgrade/payprowindow.xaml` 14 个文案键（含 `upgrade_item_calendar_view` `upgrade_item_calendar_subscription` `upgrade_item_list_task` `upgrade_item_mobile_widgets` `upgrade_item_statistics`）；`purchasealipaybtn` `purchasepaypalbtn` `purchasestripebtn` `purchasewechatbtn` | A |
| 订阅管理 | 管理订阅、宽限期、支付失败、支付成功 | `views/upgrade/manageprosubscribewindow.xaml` `subscriptiongracedatewindow.xaml` `payfailurewindow.xaml` `paysuccesswindow.xaml` | B |
| 续费信息 | 下次续费日与取消路径 | `views/config/accountinfo.xaml` 的 `NextBillingDateText`；词条 `Your %1$@ Premium (%2$@) will renew...` | A |
| 恢复购买 | 换设备/换账号后恢复会员 | 词条 `Restore` `premium_has_expired` `Your ... Premium membership expires on ...` | A |

### 1.15 锁与安全 · 网络代理

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 应用设置 | 开机自启、启动后最小化到托盘 | `views/setting/locksettings.xaml` 控件 `StartOnWindowsCheckBox` `StartOnWindowsMiniCheckBox`（文案键 `AutomaticallyStart` `AutomaticallyStartToTray`） | A |
| 应用锁 | 设置密码 / 关闭密码、打开时解锁、N 分钟后自动锁、锁定后隐藏组件 | 同文件 `SetPasswordButton` `ClearPasswordButton` `MinLockCheckBox` `LockAfterCheckBox` `LockWidgetCheckBox` + `CountSpinner`（绑定 `MinLock` `LockAfter` `LockInterval` `LockWidget`） | A |
| 代理 | 类型、地址端口、域名、账号密码、测试按钮 | `views/config/proxysettings.xaml` 控件 `ProxyTypeCombox` `AddressText` `PortText` `UserText` `PasswordText` `DomainText` `TestButton`；模型 `CommonSettings` 6 个 `Proxy*` 字段 | A |
| 安全与网络 | 外层容器存在，条目由子面板拼 | `views/config/securitynetworkconfig.xaml`（只有 1 个 Name）→ **条目集合未核实** | C |

### 1.16 组件与迷你日历

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 组件设置 | 主题、不透明度、显示项（完成项 / 输入框 / 日期按 / 天数单位）、分组、排序、方向、置顶、自动隐藏、锁定 | `views/widget/widgetsettings.xaml` 19 个文案键 + 40 个控件名（`ThemeComboBox` `OpacitySlider` `GroupTypeComboBox` `SortTypeComboBox` `OrderDirectionComboBox` `TopmostCheckBox` `AutoHideCheckBox` `ShowCompletedCheckBox` `ShowDateByComboBox` `ShowDayUnitCheckBox`）；模型 `WidgetSettingModel` 18 字段 + `CalendarWidgetModel` 16 字段 | A |
| 组件类型 | 任务 / 日历 / 四象限 / 习惯 / 倒数日 / AI | `views/config/widgetinfo.xaml` 14 个文案键（含 `Matrix` `Habit` `CountdownTitle` `AIAssistant`） | A |
| 倒数日组件 | 组件内可单独选样式 / 颜色 / 日期格式 / 自动隐藏 | 同 `widgetsettings.xaml` 控件 `CountdownStyleMainViewGrid` `CountdownDateDisplayCombo` `CountdownAutoHideCheckBox` `CountdownTypePreview` | A |
| 迷你日历 | 侧边栏是否显示迷你日历 | `views/setting/minicalendarconfig.xaml`（`MiniCalendarSwitch`；文案键 `show_mini_calendar_in_sidebar`）+ `views/mainlistview/projectlist/minicalendar.xaml` | A |
| 组件（mac） | 未核实 | NIB 清单里没有 Widget 类 → mac 侧组件设置未核实 | — |

### 1.17 关于 · 引导

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 关于页 | 应用名、版本号、检查更新、新版本号与新版本说明 | `views/config/aboutinfo.xaml`（`UpdateButton` + 绑定 `CurrentVersion` `IsUpdateEnable` `NewVersionNum` `NewVersionDescription`）；NIB `TTAboutPreferenceViewController` | A |
| 更新流程 | 新版本提醒、下载进度 | `views/update/newversionreminderwindow.xaml`（`NewVersionAvailable`）`downloadwindow.xaml`（`DownloadingUpdate`） | B |
| 引导 | 引导页（含"某些功能不能隐藏""登录后返回"这类提示） | `views/guide/commonguidewindow.xaml`（`CannotHideFeature` `LoginReturn`）；NIB `TTGuidePreferenceView` `TTGuidePreferenceViewController`；模型 `GuideShowView.showGuide` | A |
| 菜单里的「更多设置」 | 见 §3.3（这一屏把 7 个不相干面板串成一列） | `views/setting/moresettingsconfig.xaml` | A |

### 1.18 调试

| 界面 | 条目（我归的类） | 证据 | 级 |
|---|---|---|---|
| 调试页 | 4 个内部开关（强制会员态、日历测试、会员分组、AI 语音分组） | `views/config/debugsettings.xaml` 控件名 `ProSwitchBtn` `CalendarTest` `PremiumGroup` `AIVoiceGroup`；BAML `views_config_debugsettings.baml` | A |

> ⚠️ 这一屏**不能**当产品能力引用：`ProSwitchBtn` 是内部把会员态强制打开/关掉的开关。列出来是为了说明"它的设置树里混着调试页"，不是建议我们做。

---

## 2. 个性化专项（本节最重）

> 读法：每个维度一张表，五列固定为 **选项集合 / 默认值 / 是否会员专享 / 两端是否一致 / 证据**。
> 「会员专享」只认**两类证据**：(a) 文案里明说（`Only available for premium users` / `Premium Only` / `upgrade_for_*`）；(b) 界面上有 Pro 角标（`IsPro` 绑定）。两者都没有的一律写"未找到会员证据"，**不写"免费"**。

### 2.1 ① 主题

| 项 | 内容 |
|---|---|
| **选项集合** | **5 个系列**（纯色 / 季节 / 城市 / 照片 / 自定义），每系列一个网格：<br>· 城市类 **14** 个（`assets_imagesource_themepreview_` 里 14 个城市名）<br>· 季节类 **4** 个（春 / 夏 / 秋 / 冬）<br>· 场景类 **10** 个（`birds` `blacksea` `blossom` `dawn` `desert` `frozen` `leaves` `meadow` `silence` `structure`）<br>· 纯色类：7 个 `dark*` 变体 + 13 个亮色（`black` `blue` `gray` `green` `lilac` `matcha` `mint` `navy` `peach` `pink` `sunshine` `white` `yellow`）<br>· 自定义：背景图 + 3 个滑杆 + 主题色 |
| **默认值** | **未核实**。`resource/themes/default.xaml` 只说明"有一个名叫 default 的调色板"，不等于首启选中它；`CommonSettings` 里没有 `ThemeId` 的初值可读。 |
| **是否会员** | **是（部分）**。文案 `Premium Themes`、`Only available for premium users`，以及"会员能选更多主题"的整段说明；`appiconitem.xaml` 用 `IsPro` 绑一个会员角标。**哪些系列被锁**未核实（锁的边界在代码里）。 |
| **两端一致** | **结构一致、命名不一致**。两端都是"网格卡 + 选中勾 + 缩略图"，mac 侧 `TTThemePreferencesViewController.nib` 是 `UICollectionView` + 左对齐流式布局；Windows 侧是 5 个 `ItemsControl` + 5 个系列卡模板。 |
| **证据** | `views/theme/appearancecontrol.xaml`（`PureColorItems` `SeasonItems` `CityItems` `PhotoItems` `CustomPanel`）、`prothemegrid.xaml`、`purecolorgrid.xaml`、`darkcolorgrid.xaml`、`customthemedialog.xaml`；`resource/themecard/{colortheme,seasontheme,citytheme,phototheme,customtheme}.xaml`；`resource_themes_*.baml` 61 个；NIB `TTThemePreferencesViewController`；模型 `CustomThemeSetting` 5 字段 |

**数量口径**：可机械数出的是 **28 张主题预览图 + 61 个调色板文件 + 16 个主题卡模板**（其中 5 个是系列模板，与 5 个系列一一对应）。"54 套皮肤"这个数字**在两端资源里都对不上**，标未核实（§7 第 4 条）。

### 2.2 ② 界面风格

| 项 | 内容 |
|---|---|
| **选项集合** | **2 档**：扁平 / 卡片 |
| **默认值** | **未核实**。`interfacestylewindow.xaml` 里两个 `RadioButton` 都没有 `IsChecked`，选中态由代码给。 |
| **是否会员** | 未找到会员证据 |
| **两端一致** | **一致（2 档同名）**。Windows：`FlatRadioButton` / `CardRadioButton`；macOS：`TTAppStylePickerItemView` 的 `flatView` / `cardView`；词条 `app_style_flat` / `app_style_card` 两端共用。 |
| **证据** | `views/theme/interfacestylewindow.xaml`（两个 RadioButton + 两套界面 mock）、`theme/appearancecontrol.xaml`（`InterfaceStyleText`）、NIB `TTAppStylePickerViewController`、`strings.json` 键 `app_style` `choose_interface_style` `app_style_flat` `app_style_card` |

> 值得学的一点（与表达无关，是结构）：它把两套 mock **画在同一个 `UniformGrid` 里**（各画一遍真实侧栏 + 内容骨架），所以"选哪个"是**看图**而不是读词。成本是两份重复的 mock，换来的是零解释。

### 2.3 ③ 字体：字体族 + 字号

| 项 | 内容 |
|---|---|
| **选项集合（字体族）** | Windows 有独立面板：**5 个字体族资源文件** `fontfamilynormal` `fontfamilyyahei` `fontfamilysourcehansans` `fontfamilyyozai` `fontfamily975maru`（另有 3 个纯字号资源 `font_normal` `font_middle` `font_large`）；**5 组亮/暗预览图**覆盖 `975maru` `harmonyos` `lxgw` `sourcehansanssc` `yozai`。🔴 **只有预览、没有字体文件的 2 个名字（`harmonyos` / `lxgw`）说明"文件集合 ≠ 可选集合"**，所以精确档数**未核实**。 |
| **选项集合（字号）** | **3 档**。Windows：`font_normal` / `font_middle` / `font_large`；macOS：`fontSizeNormalItemView` / `fontSizeLargeItemView` / `fontSizeExLargeItemView`（每档一个 item + 一个 label）。 |
| **默认值** | 字号 = 第 1 档（最普通那档），依据是资源名 `font_normal` / `fontSizeNormal*` 是三项里的基准项（**D 级推断**）。字体族默认 = 系统默认（`fontfamilynormal`，同为 D 级）。 |
| **是否会员** | 未找到会员证据（`strings.json` 里没有 Font 相关的 premium/gated 键）。字体面板里有一个**授权弹窗**（`fontfamilysetpanel.xaml` 的 `AuthPopup` `AuthRun1` `AuthRun2`）→ 说明字体要授权/下载，但**授权是不是会员权限，未核实**。 |
| **两端一致** | **不一致，而且是硬证据**：字体族面板只有 Windows 有（`views/theme/fontfamilysetpanel.xaml`）；macOS 的 436 个 NIB 名里**没有**任何 FontFamily 类，`strings.json` 里 `Font Size` 有、`Font` 没有 → **mac 侧只有字号，没有字体族**。 |
| **证据** | `views/theme/fontfamilysetpanel.xaml`（`FontFamilyItems` + `AuthPopup`）、`views/theme/fontsizesetpanel.xaml`（`FontSizeItems`）、`resource/fontresource/font_{normal,middle,large}`、`assets_theme_fontfamily_{light,dark}_*.png` 10 张、NIB `TTDisplayPreferencesViewController`、`strings.json` 键 `Font Size` |

**delta 表**：**未核实**。本机产物里没有字号与像素的映射表（3 档的具体像素/增量只存在于可执行文件的数值常量里，`strings` 读不到）。要核需要反汇编 `TTDisplayPrefItemView` 的 `setFontSize*` 调用点。

### 2.4 ④ 显示密度与内容

| 项 | 内容 |
|---|---|
| **选项集合** | 4 个独立面板 + 3 个视图专属窗口：<br>· 字号（3 档，见 2.3）<br>· 侧边栏数量：**3 档**（不显示 / 只数任务 / 全显示）<br>· 已完成行样式：**2 档**（标准 / 划线）<br>· 清单颜色显隐：**开关**<br>· 日历显示：9 类内容开关 + 样式 + 颜色来源（5 档）<br>· 看板显示：5 项<br>· 时间线显示：3 项 |
| **默认值** | **未核实**（三档/两档的初始选中态都在代码里） |
| **是否会员** | 未找到会员证据 |
| **两端一致** | **一致**。字号 / 数量 / 完成行两端都有；日历·看板·时间线在两端各有独立窗口（mac：`TTListDisplaySettingsVC` `TTKanbanDisplaySettingsVC` `TTTimelineSettingsController`；Windows：对应 3 个 XAML）。 |
| **证据** | `views/theme/{numdisplaysetpanel,completelinedisplaysetpanel,projectlistcolorvissetpanel,displaysettingspanel}.xaml`、`sidebarCount{None,Tasks,All}ItemView`、`strings.json` 键 `sidebar_count` `completed_task_style` `complete_style_default` `complete_style_strike_through` `show_or_hide_list_colors` |

> 这里有一个**产品判断**值得单列：把"侧边栏要不要显示数字""已完成的任务要不要划掉"放进**设置**而不是视图菜单，意思是"这是我的长期习惯，不是这一次的看法"。同一批选择里还混着"日历里显示不显示子任务"（更像 per-view），说明它自己也没有把这两类分清（见 §3）。

### 2.5 ⑤ 应用图标

| 项 | 内容 |
|---|---|
| **选项集合** | 一个图标网格，**单选**；至少两级（普通 / 会员）。**具体个数未核实** —— 解包出来的包体被裁成 60 个 nib/包，`Contents/Resources` 里没有任何 `.icns`，数不出来。 |
| **默认值** | **未核实**（`CommonSettings.AppIconKey` 是字段名，初值读不到） |
| **是否会员** | **是（部分图标）**。`appiconitem.xaml` 的会员角标绑 `IsPro`；文案 `Premium App Icons`。 |
| **两端一致** | **一致**。Windows：`theme/appiconitem.xaml`；macOS：`TTAppIconPreferencesViewConntroller.nib`（`UICollectionView` + 左对齐流式布局）+ `TTAppIconPreferencesFooterView`。 |
| **证据** | `views/theme/appiconitem.xaml`（`Image` `Width` `BorderRadius` `IsPro` `Selected`）、NIB `TTAppIconPreferencesViewConntroller`、`strings.json` 键 `App icons` `Premium App Icons` `app_icon_change_failed` |

> 学这一条：它**明说平台限制**——"换的图标只会在应用打开时生效"，并且把"改失败了怎么办"做成一节（`app_icon_go_to_extension_msg` 指到系统设置的具体分栏）。这是把**做不到的事**写进设置页，而不是让用户以为坏了。

### 2.6 ⑥ 自动深色

| 项 | 内容 |
|---|---|
| **选项集合** | **1 个开关 + 1 个颜色选择**（开关开着时，再选一个"夜间主题"用哪个色板）。不是"日落到日出"那种时间窗。 |
| **默认值** | **未核实** |
| **是否会员** | 未找到会员证据 |
| **两端一致** | **一致（形态同名）**。Windows：`autodarksettingwindow.xaml`（`UseSystemThemeCheckBox` + `DarkSelector`）；macOS：词条 `Auto Dark Mode` + `night_theme`。 |
| **证据** | `views/theme/autodarksettingwindow.xaml`（`SwitchAuto` `NightTheme` `OK` `Cancel`）、`theme/appearancecontrol.xaml`（`AutoDarkText`）、`strings.json` 键 `follow_system_dark_mode` `Auto Dark Mode` `night_theme` |

> 关键的**没有**：它没有"定时切换"（起止时间），也没有"按当前壁纸亮度"。跟着系统走 + 自己挑一个夜间色板，是它能接受的最小闭环。

### 2.7 ⑦ 便签 / 倒数日样式

| 项 | 内容 |
|---|---|
| **选项集合（便签）** | 7 项：默认颜色、不透明度、字号、默认置顶、任务栏隐藏（+ 一句解释）、对齐后复位（+ 一句解释）、默认间距<br>另有"便签样式"选择器（`TTTaskStickyThemePickerViewController`），**档位未核实** |
| **选项集合（倒数日）** | 一个样式选择器（`TTCountdownStylePickerViewController`，带颜色 + 取消 + 保存）+ 每个倒数日实例独立存 `Style` `StyleColor` `Background` `DateDisplayFormat` `ShowAge`；颜色可选 **6 组命名色系**（经典 / 蒙德里安 / 孟菲斯 / 莫兰迪 / 马卡龙 / 洛可可），色系分组在**通用颜色选择器**里（`views/misc/colorselector/coloritemselector.xaml`） |
| **默认值** | **未核实**（`DefaultColor` `DefaultPin` 是字段/文案键，初值读不到） |
| **是否会员** | **倒数日样式是会员**：文案 `upgrade_for_more_countdown_style` + 整段说明（"解锁多种样式"）。便签样式**未找到**会员证据。 |
| **两端一致** | **便签：两端都有**（Windows `stickynoteconfig.xaml`；mac `TTStickyPreferenceViewController` + `TTStickySpacingSettingsView`）。**倒数日样式：两端都有选择器**（mac `TTCountdownStylePickerViewController`；Windows 在组件设置里 `CountdownStyleMainViewGrid` + 通用倒数日）。 |
| **证据** | `views/config/stickynoteconfig.xaml`（10 个文案键 + `ColorSelector` `OpacitySlider` `FontSizeComboBox` `PinDefault` `StickySpaceItems`）、GRDB 表 `ZTTCOUNTDOWN`（`ZSTYLE` `ZSTYLECOLOR` `ZBACKGROUND` `ZDATEDISPLAYFORMAT` `ZSHOWAGE`）+ `CountdownStyle` 子对象 7 字段、`views/misc/colorselector/coloritemselector.xaml`、`strings.json` 键 `Sticky_Style` `colored_by_countdown` `upgrade_for_more_countdown_style` |

### 2.8 ⑧ 快捷键

| 项 | 内容 |
|---|---|
| **选项集合** | 4 类 + 全局一类 + 8 个可折叠分组；**单条快捷键的条数未核实**（动作清单在代码里）。改键方式：点右侧按钮 → 按新键；占用时给提示；有"重置"。 |
| **默认值** | **未核实**（默认键位在代码/资源里，本机产物读不到） |
| **是否会员** | 未找到会员证据 |
| **两端一致** | **一致**。Windows：`shortcutsconfig.xaml` + `hotkeycontrol.xaml`；macOS：`TTShortcutsSettingsViewcontroller` + `TTShortcutsPreferenceViewController` + `TTShortcutsPreferenceCell` / `TTShortcutsPreferenceHeaderCell`（有 cell + header = 有分组）。 |
| **证据** | `views/config/shortcutsconfig.xaml`、`views/config/hotkeycontrol.xaml`（`IsKeyValid` `OriginHotKey`）、模型 `ShortcutModel` 8 折叠字段、`strings.json` 键 `shortcuts_navigate_title` `shortcuts_switch_view_title` `shortcuts_quick_add_desc` `shortcuts_edit_task_desc` `shortcuts_desc_global` `shortcut_change_desc` `shortcut_occupied_tips` |

---

## 3. 哪些是「个性化」、哪些是「行为默认值」

### 3.1 先给分类判据

| 类 | 判据（用户会说出口的那句话） | 举例 |
|---|---|---|
| **个性化** | "让它看起来像我" —— 改的是**同一份数据的表达**，不改任何行为 | 主题、界面风格、字体族、字号、应用图标、自动夜间、便签样式、倒数日样式 |
| **行为默认值** | "让我少填几次" —— 改的是**新建/触发时的初值** | 新任务默认日期/优先级/清单/标签、默认提醒、每周从哪天开始、智能识别开关、侧边栏数量、已完成行样式、快捷键 |

> 判据的边界有一档是**灰的**：侧边栏数量、已完成行样式、快捷键都属于"看一眼/按一下的长期习惯"，既不是纯外观也不是纯初值。本文按"**它有没有改变新建对象的初值**"这一条硬线分：没有初值的算**个性化侧的显示偏好**。所以下面表里我把这一档标 `个性化/行为（灰）`。

### 3.2 逐项归类

| 设置项 | 类 | 依据（级） |
|---|---|---|
| 主题（5 系列 + 自定义） | 个性化 | 只改表达（A） |
| 界面风格（扁平/卡片） | 个性化 | 只改表达（A） |
| 字体族 | 个性化 | 只改表达（A） |
| 字号（3 档） | 个性化 | 只改表达（A） |
| 应用图标 | 个性化 | 改应用在外部的身份（A） |
| 自动夜间 | 个性化 | 只改表达（A） |
| 便签样式 / 倒数日样式 | 个性化 | 只改表达（A） |
| 侧边栏数量（3 档） | 个性化/行为（灰） | 改"显示什么"，不改初值（A） |
| 已完成行样式（2 档） | 个性化/行为（灰） | 只改完成行的画法（A） |
| 清单颜色显隐 | 个性化/行为（灰） | 只改显示（A） |
| 快捷键 | 个性化/行为（灰） | 改"怎么按"，不改数据（A） |
| 新任务默认（日期/模式/时长/提醒/优先级/标签/清单/加到哪） | 行为默认值 | `NewTaskDefault` 整块 + `ZDEFAULTCONFIGURATIONFORNEWTASK`（A） |
| 默认提醒（有时间的任务 / 全天任务） | 行为默认值 | 词条 `settings_default_reminder_time` `settings_default_reminder_day`（A） |
| 每周从哪天开始 / 时间格式 / 农历 / 节假日 / 时区 | 行为默认值 | 改日历的语义，不是表达（A） |
| 智能识别（日期解析 / 去掉时间文本 / 保留标签 / 网址解析） | 行为默认值 | 改的是"输入被解析成什么"（A） |
| 提醒方式 / 铃声 / 音量 / 完成音 | 行为默认值 | 改"它怎么找我"（A） |
| 共享清单默认通知 / 自动接受邀请 | 行为默认值 | 改"默认发生什么"（A） |
| 番茄时长 / 休息 / 自动开始 / 目标 | 行为默认值 | 改计时语义（A） |
| 习惯频率 / 目标 / 提醒 / 打卡记日志 | 行为默认值 | 改习惯的语义（A） |
| 智能清单显示时机 | 行为默认值 | 改"什么时候出现在侧栏"（A） |
| 模板 | 行为默认值 | 改"新建时从什么开始"（A） |
| 应用锁 / 自启 / 代理 | 行为默认值（安全侧） | 不改表达也不改初值，属"能力开关"（A） |
| 组件（主题/不透明度/排序/置顶） | 个性化（局部） | 只改桌面上的表达（A） |
| 会员与订阅 / 关于 / 引导 | 都不是 | 不是偏好，是状态与信息（A） |

**计数**：个性化（含灰档）**11** 项；行为默认值 **12** 组；非偏好 **3** 组。

### 3.3 它把两者混在同一个设置树里 —— 三条证据

**证据 1（UI 层，最直观）：一个"外观"页里就混着两类。**
`views/theme/appearancecontrol.xaml` 的控件名从头到尾是：`AppearanceTitle`、`ThemeSelectGrid`、`ThemePanel`、`PureColorItems`、`SeasonItems`、`CityItems`、`PhotoItems`、`CustomPanel`、`InterfaceStyleText`、`AutoDarkText`、`AppIcons`、**`DisplayPanel`**、`FontFamilyCtrl`、`FontSizeCtrl`、`ProjectListColorVisCtrl`、`ProjectNumSetCtrl`、`CompleteLineSetCtrl`。
前 11 个是个性化（主题/风格/夜间/图标），后 5 个是"侧边栏数量、完成行样式、清单颜色"—— §3.2 里那一档**灰的**全被塞在同一个页面里，中间没有任何分节标题把它们分开（只有 `AppearanceTitle` 一个总标题）。

**证据 2（容器层，更硬）：它自己也承认这些是一列。**
`views/setting/moresettingsconfig.xaml` 一个 `StackPanel` 里依次挂：
`GeneralSettings`（语言）→ `SmartRecognitionConfig`（智能识别）→ `NewTaskDefault`（任务默认值）→ `MiniCalendarConfig`（迷你日历）→ `LockSettings`（应用锁）→ `Network` 标题 + 代理一行 → `TemplateControl`（模板）。
**语言（个性化侧）× 智能识别（行为）× 默认值（行为）× 迷你日历（显示）× 锁（安全）× 代理（网络）× 模板（行为）** 七种东西在**一列**里，顺序也没有分节。这就是"一个设置树装全部"的形态证据。

**证据 3（数据层，最硬）：同一个 128 字段的模型里同时装着主题和"每周从哪天开始"。**
Windows `SettingsModel`（128 列）里相邻字段包含：`ThemeId`、`WeekStartFrom`、`TimeFormat`、`EnableHoliday`、`EnableLunar`、`ShowWeek`、`HideComplete`、`ShowSubtasks`、`NotificationOptions`、`PomoDuration`、`ShowHabit`、`ShowCountDown`、`ShowReminder`、`CellColorType`、`ShortcutModel`、`SmartProjects`、`UserPreference`、`Statistics`。
**"主题"和"每周从哪天开始"是同一张表的两个列** —— 这说明它没有在数据层给"个性化"和"行为默认值"划边界，而是一并丢进"用户设置"。

**反过来还有一条**：它**部分**做了区分，但**两端做得不一样**：

| | macOS | Windows |
|---|---|---|
| 外观类（字号、图标、自定义主题参数）落哪 | 不在 `ZTTUSERSETTINGS`（22 列里没有 theme/font/appicon）→ 推断为本地 | `CommonSettings` 32 列里：`BaseFontSize`、`AppIconKey`、`CustomThemeLocation`、`CustomThemeColor`、`ThemeImageOpacity`、`ThemeImageBlurRadius`、`ShowAreaOpacity` |
| 主题**选择**落哪 | 同上，未核到 | `SettingsModel.ThemeId`（与`WeekStartFrom` 同表） |
| 行为默认值落哪 | `ZTTUSERSETTINGS` 7 个 BLOB（`ZCALENDARDISPLAYCONFIGURATION` `ZDAILYREMINDERCONFIGURATION` `ZDEFAULTCONFIGURATIONFORNEWTASK` `ZLISTDISPLAYCONFIGURATION` `ZSHORTCUTS` `ZSMARTPROJECTCONFIGURATIONS` `ZSMARTRECOGNITIONCONFIGURATION`）+ 15 个标量 | `UserPreferenceModel` 的 21 个子配置 |

> 这里能得出一个**对我们有用的判断**（标 B 级，是推断）：它的实际分层是「**外观 = 本机**（图在本地、字体要授权）、**行为默认值 = 账号**（跟着用户走）」，但**主题选择**这一项在 Windows 落进了同步模型、在 mac 侧找不到落点 —— 所以"换台机器主题会不会跟过来"**两端行为可能不同**，这一点**未核实**（§7 第 5 条）。

---

## 4. 「我的」页面

> 🔴 **先纠正一个前提**：桌面端**没有一个叫「我的」的独立 tab**。
> 证据：`TTAccountPreferencesViewController`、`TTPremiumPreferencesViewController`、`TTAboutPreferenceViewController`、`TTGuidePreferenceViewController` 的类名后缀都是 **Preference**（设置项），它们是被 `TTSettingsWindowController`（一个标题为设置的单窗口，`settings` 词条）装进去的若干节。
> "我的"这个**入口**是**左侧栏顶部的头像**：`views/config/accountinfo.xaml` 就是头像菜单里那一块的编译产物。
> ⚠️ 移动端是否有真正的「我的」tab：**未核实**（本机产物只有桌面两端）。
> 顺带：heyta 已经照这个形态做过（头像 → 账号菜单），见 [apps/web/src/features/shell/AccountMenu.tsx](../../apps/web/src/features/shell/AccountMenu.tsx) 文件头（里面直接引了滴答的 rail 做法与产品负责人的原话）。

### 4.1 逐块说明

| 块 | 里面是什么 | 证据 | 级 |
|---|---|---|---|
| **① 身份摘要** | 头像、名称、邮箱；未登录时的登录入口 | `accountinfo.xaml` 控件 `HeadimgImageBrush` `email` `name`；NIB `TTAccountPreferencesViewController` 二进制内含 `Email` `Name` `Profile` `Sign Out` | A |
| **② 会员状态行** | "下次续费日"一行 + 宽限期提示 + 续费按钮 | `accountinfo.xaml` 控件 `NextBillingDateTextPanel` `NextBillingDateText` `GraceHelper` `Tips` `RenewButton` | A |
| **③ 会员卡（升级/管理）** | 标题、描述、升级按钮、管理订阅、隐私政策、服务条款、订单历史 | `views/setting/premiumconfig.xaml` 控件 `TitleText` `DescText` `UpgradeBtn` `ManageText` `PrivacyText` `ServiceText` + 文案键 `OrderHistory`；NIB `TTPremiumPreferencesViewController`（内含 `Order History` `Privacy Policy` `Terms of Use`） | A |
| **④ 统计 / 回顾** | ①专注统计（今日/本周/总计、记录列表、可增删改）②每周回顾/总结（可按模板挑显示项）③年视图热力图 | 专注：`views/pomo/focusstatistics/*`（`addfocusrecordwindow.xaml` `batchfocusrecwindow.xaml` `focusrecdeleteallwindow.xaml`）；总结：模型 `SummaryTemplates` + `SummaryDisplayItem`；热力图：词条 `calendar_view_year_heatmap`；**统计整体是会员项**：文案 `upgrade_item_statistics` | A |
| **⑤ 引导** | 引导页：哪些功能不能隐藏、登录后返回到哪 | `views/guide/commonguidewindow.xaml`（`CannotHideFeature` `LoginReturn`）；NIB `TTGuidePreferenceView` `TTGuidePreferenceViewController`；模型 `GuideShowView.showGuide`；另有 `CheckedNewFeature` / `DontShowProWindow` / `NeedShowTutorial` 三个"别弹了"开关在 `SettingsModel` 里 | A |
| **⑥ 关于** | 应用名、当前版本、检查更新、新版本号与说明 | `views/config/aboutinfo.xaml`（`LogoImage` `UpdateButton`，绑定 `CurrentVersion` `IsUpdateEnable` `NewVersionNum` `NewVersionDescription`）；NIB `TTAboutPreferenceViewController` | A |
| **⑦ 登出** | 退出登录 | `accountinfo.xaml` 的 `LogoutButton`；NIB 同上含 `Sign Out` | A |
| **⑧ 注销账号** | 未核实 | 见 §1.1 最后一行 | — |

### 4.2 这一屏的形状（我的归纳）

它是「**身份 → 钱 → 数据（统计）→ 教我怎么用 → 这是哪个版本 → 走**」一条线，而且**钱在第 2 位**：
- 身份（谁在用）与会员状态（这个账号能不能用全功能）**紧挨着**，中间没有隔断；
- 统计**排在会员卡之后**，且统计本身是会员卖点之一（`upgrade_item_statistics`）—— 于是"我这一年干了多少"与"买不买"在同一个屏上互相解释；
- 引导与关于在最后，都是"低频但必须能找到"的东西。

---

## 5. 与 heyta 的差距表

### 5.1 准数（本节结论的分母）

| 指标 | 滴答清单（本机可数） | heyta（本机可数） |
|---|---|---|
| 设置分组 | 桌面端**一个纵向菜单**，项数在代码里 → 未核实；macOS 侧是 tab（`TTSettingsTabModel`） | **7 组**（`SETTINGS_NAV_ITEMS`，[apps/web/src/App.tsx:297](../../apps/web/src/App.tsx#L297)） |
| 设置面板组件 | macOS **49 个**唯一设置类（50 行命中，1 个类名重复）；Windows **148 个**含 config/setting/theme 的 BAML 文件名，其中 `views_setting_*` **10 个**（交付说明写的是 11 个，实测 10 个）、`views_config_*` 35 个、`views_theme_*` 15 个 | **18 个**（17 个 `*Panel`/`*Settings` + `LanguageSwitcher`，`sed -n '3540,3900p' apps/web/src/App.tsx` 可复现） |
| 「个人设置」字段 | Windows `SettingsModel` **128 列** + `UserPreferenceModel` **21 个子配置** + `CommonSettings` **32 列** + `PomoLocalSetting` **26 列**；macOS `ZTTUSERSETTINGS` **22 列**（15 标量 + 7 BLOB） | 客户端持久化键 **24 个**（`grep -rhn "= 'heyta\." apps/web/src` 可复现）；其中外观类只有 **`heyta.theme` + `heyta.locale` 2 个** |
| 个性化维度 | **8 个**（§2 的 ①–⑧，全部有证据） | **完整的 0 个 / 半有的 4 个 / 没有的 4 个**（见 §5.2） |
| 可选主题数 | 28 张预览 + 61 调色板 + 5 系列 | **2 值**（`light` / `dark`，[apps/web/src/lib/theme.ts:9](../../apps/web/src/lib/theme.ts#L9)） |

### 5.2 逐维差距（①–⑧ 与 §2 的 8 个维度**一一对应**，编号对齐）

| # | 维度 | 滴答清单 | heyta | 判 | heyta 证据 |
|---|---|---|---|---|---|
| ① | 主题（预设 / 纯色 / 深色 / 自定义） | 5 系列 + 自定义（图 + 3 滑杆 + 主题色） | 只有亮 / 暗两态；没有预设、没有纯色组、没有自定义背景 | **半有（1/5 系列，且只有 2 个值）** | `apps/web/src/lib/theme.ts:9`（`type Theme = 'light' \| 'dark'`）；`packages/design-system/src/tokens.css:751`（`[data-theme='dark']`）；`apps/web/src/App.tsx:3775`（唯一一项主题设置） |
| ② | 界面风格 | 2 档（扁平 / 卡片），看图选 | 无 | **无** | `grep -rniE "interfacestyle\|app-style\|appStyle" apps/web/src packages/design-system/src` → **0 命中** |
| ③ | 字体（族 + 字号） | 字体族 Windows 5–6 个（mac 无）；字号 3 档 | 都没有：字体是一个 `--ht-font-sans` 常量，字号是 11 级 token 标尺 | **无** | `packages/design-system/src/tokens.css:280`（`--ht-font-sans` 单值）；`packages/design-system/src/tokens.css:288-305`（`--ht-font-size-2xs` … `-4xl` 全是常量） |
| ④ | 显示密度与内容 | 4 个面板 + 3 个视图窗口（数量 3 档、完成行 2 档、清单颜色开关、日历 9 项…） | 2 项：截止时间的显示方式（日期 / 倒计时）、详情栏默认（展开 / 收起） | **半有（2/7）** | `apps/web/src/App.tsx:3708` 与 `:3744`（两个 `role="radiogroup"`）；`apps/web/src/features/tasks/due-display-pref.ts:18`；`apps/web/src/features/shell/detail-pane-pref.ts:24` |
| ⑤ | 应用图标 | 图标网格 + 会员图标 + 平台限制说明 | 无 | **无** | `grep -rniE "appicon\|app-icon\|iconChoice" apps/web/src` → **0 命中** |
| ⑥ | 自动深色 | 一个开关 + 选夜间色板 | **隐式**：没选过时跟系统，选过以后就再也不跟；没有开关、没有色板 | **半有（半个）** | `apps/web/src/lib/theme.ts:33`（`prefers-color-scheme` 兜底）；`apps/web/src/lib/theme.ts:20-22` 注释明说"不用系统偏好覆盖用户选择" |
| ⑦ | 便签 / 倒数日样式 | 便签 7 项 + 样式选择器；倒数日样式选择器 + 6 组色系（样式是会员项） | 倒数日只有"分类色槽"一维（颜色跟着主题 token 走）；便签完全无 | **半有（倒数日 1 维，便签 0）** | `apps/web/src/features/countdown/CountdownView.tsx:207-209`（`card.template` → `categorySlotToken`）；`grep -rni "sticky" apps/web/src` 只命中图标名 `StickyNote` 与 CSS 的 `position: sticky` |
| ⑧ | 快捷键 | 4 类 + 8 个折叠分组 + 全局 + 重置 + 占用提示 | 无 | **无** | `grep -rniE "shortcut\|hotkey\|keybinding" apps/web/src` → **0 命中** |

**个性化账（本节结论）**：8 个维度里 —— **完整的 0 个**、**半有的 4 个**（①主题 2 值 / ④显示 2 项 / ⑥自动深色半隐式 / ⑦倒数日 1 维）、**没有的 4 个**（②界面风格 / ③字体 / ⑤应用图标 / ⑧快捷键）。4 + 4 = 8 ✔

### 5.3 非个性化维度（同一屏上但不算"个性化"的，也逐格给证据）

| # | 维度 | 滴答清单 | heyta | 判 | heyta 证据 |
|---|---|---|---|---|---|
| ⑨ | 「我的」入口形态 | rail 头像 → 菜单（身份 / 个人中心 / 设置 / 登出） | **已有**（照做的就是这一条） | **有** | `apps/web/src/features/shell/AccountMenu.tsx:1-30`（文件头记了产品负责人原话与外部依据）；`apps/web/src/features/settings/ProfileOverview.tsx:1-8`（身份摘要 + 近期状态 + 成就预览三块） |
| ⑩ | 会员页 | 独立一节 + 权益清单 + 4 种支付 + 订单历史 + 恢复购买 | 有（订阅独立成组） | **有** | `apps/web/src/App.tsx:306`（`settings-group-subscription`）；`apps/web/src/features/subscription/SubscriptionPanel.tsx:52` |
| ⑪ | 统计 / 回顾 | 专注统计 + 每周回顾 + 年视图热力图（部分会员项） | 有（成长/成就 + 周回顾） | **有** | `apps/web/src/features/motivation/GrowthView.tsx`；`apps/web/src/features/settings/ProfileOverview.tsx:38-39`（`selectWeeklyReview` `selectMilestones`） |
| ⑫ | 引导 | 引导页 + 三个"别弹了"开关 | 未核实 | **未核实** | `grep -rli "onboarding" apps/web/src --include='*.tsx'` 只命中 `features/quadrant/QuadrantBoard.tsx` 一处（且是注释） |
| ⑬ | 应用锁 / 代理 | 应用锁 + 自启 + 代理 + 锁定热键 | 未核实（未在本分包展开；安全侧是另一个分包的地界） | **未核实** | 安全侧面板存在（`PasskeyPanel` / `PasswordPanel` / `SessionsPanel`，[apps/web/src/App.tsx:3578](../../apps/web/src/App.tsx#L3578)），但不含"应用锁"与"代理"两类 |

## 6. 可借鉴 5 条 / 明确不借鉴 3 条

### 6.1 可借鉴（每条都给"为什么对我们成立"）

| # | 借鉴什么 | 它的证据 | 为什么对 heyta 成立 |
|---|---|---|---|
| 1 | **把"选风格"做成看图，不做成读词** | `interfacestylewindow.xaml` 把两套真实界面骨架画进同一个 `UniformGrid`，选哪个=点图（A） | heyta 现在只有一行"主题 + 亮/暗"按钮（`apps/web/src/App.tsx:3775`），等于**让用户读词想象**。任何新增外观维度都该先问"能不能画出来"。 |
| 2 | **外观页按"系列"分组，而不是按"开关"排列** | 5 个系列 `PureColorItems`/`SeasonItems`/`CityItems`/`PhotoItems`/`CustomPanel` + 5 个系列卡模板一一对应（A） | 系列是**可扩展的单位**：加一套皮肤 = 加一张卡，不用改页面结构。heyta 若加主题，先定"系列"这一层，否则会变成 100 个平铺开关。 |
| 3 | **平台做不到的事，写进设置页** | 应用图标页直说"图标只在该应用打开时生效"，并把"改失败怎么办"指到系统设置的具体分栏（`app_icon_go_to_extension_msg`）（A） | heyta 是多端（web / desktop 四壳 / mobile），"这一端做不到"会反复出现。把限制写成一句话 + 一条路径，比让用户以为坏了好。 |
| 4 | **改键用"点一下再按"，并把占用讲清楚** | `hotkeycontrol.xaml` 的 `IsKeyValid` `OriginHotKey` + 文案 `shortcut_change_desc` / `shortcut_occupied_tips`（A） | heyta 现在**完全没有快捷键设置**（§5.2 ⑨）。要做就该一次做对：录制器 + 冲突提示 + 重置，三件一起。 |
| 5 | **设置项分"本机"与"跟着账号走"** | Windows：外观参数在 `CommonSettings`（32 列，本地）、行为默认值在 `SettingsModel`（128 列，带 `IsPro`/`SyncPoint`）；macOS：`ZTTUSERSETTINGS` 带 `ZUSER` `ZACCOUNTID` `ZSYNCSTATUS`（A） | heyta 是本地优先 + op-log，**这个分层天然吻合**：外观留本机（不进 op-log），行为默认值进 op-log 并同步。它踩过的形状我们不必再踩 —— 但要**明确写进 ADR**，否则会重演 §3.3 那种混表。 |

### 6.2 明确不借鉴（每条说清"为什么这是**它的**表达"）

| # | 不借鉴 | 为什么是"它的表达"而不是"通用做法" |
|---|---|---|
| 1 | **54 套（或 28/61/任意数）皮肤** | 那批皮肤同时是**会员的卖点**：`Premium Themes` + `Only available for premium users` + 图标上的 Pro 角标（`IsPro`）三者绑在一起。它的皮肤是**营销资产**——存在的理由一半是"让人愿意付钱"，不是"让人好用"。heyta 没有订阅墙要靠皮肤撑，抄过来只剩维护成本。可数的资源量：28 张预览 + 61 个调色板 + 16 个卡模板 + 10 张字体预览 = **115 个资源文件**，全要设计、要发版、要跟着改版重画。 |
| 2 | **把一批裸色值写进每个主题文件** | 每个 `resource/themes/*.xaml` 都是**一整套自包含的色板**（不是引用一份语义 token）。61 个文件 × 每份一整套 = 颜色数量是主题数的乘法。heyta 的对照量：`packages/design-system/src/tokens.css` 里唯一色值 **67 个**（`grep -oE '#[0-9A-Fa-f]{3,8}' | sort -u | wc -l`）。**从 67 涨到 67×N 是这套做法的真实代价** —— 而且改一个语义（比如"警告色"）要改 N 处。 |
| 3 | **一列长页装下全部设置** | `moresettingsconfig.xaml` 把语言、智能识别、任务默认值、迷你日历、应用锁、代理、模板串成**一列**（§3.3 证据 2），且没有分节标题。heyta 已经走了另一条路（7 组左栏 + 每组内是"行"，`App.tsx:297` 与 `docs/plans/settings-information-architecture.md` 的分组理由），**不要退回去**。 |

---

## 7. 未核实清单

| # | 未核实的结论 | 为什么核不到 | 要核需要什么 |
|---|---|---|---|
| 1 | 任何需要"跑起来看一眼"的结论（默认值、选中态、实际可达性） | 本机产物是**静态解包**：XAML/BAML/NIB 只有结构，选中态与默认值在代码里；且解包产物在 `/tmp`，不可提交、不可长期复核 | 实机安装 + 截图/录屏；或重新解包并写进 `research/`（受体积与许可限制） |
| 2 | 它自己的设置**菜单项清单与顺序** | `settingdialog.xaml` 的 `MenuListView` 绑 `MenuTitleList`，列表在代码里拼，XAML 里没有任何静态项 | 反编译 `ticktick_WPF.Views.SettingDialog` 的 VM，或实机截图 |
| 3 | 每个维度的**默认值** | 同上。`font_normal`/`DefaultColor` 这类名字只能做 D 级推断 | 反编译对应 VM 的初值，或实机首启截图 |
| 4 | 主题的**准确套数**（"54 套"对不上） | `resource_themes_*` 61 个文件里混着 `colorbase` `colorderived` `lightnecessarycolor` `probase` 这类**基础字典**（不是主题），按名字分不出哪些是真的可选主题 | 反编译主题注册表（主题 id → 卡片）的初始化代码 |
| 5 | **主题选择是否随账号同步** | Windows 有 `SettingsModel.ThemeId`（同步模型），macOS `ZTTUSERSETTINGS` 里没有主题列 —— 两者的"同步载荷"定义不同；同步载荷是否包含 `ThemeId` 读不到 | 抓一次同步请求，或反编译同步序列化 |
| 6 | 字号 **3 档的 delta 表**（每档差多少像素） | 只存在于可执行文件的数值常量，`strings` 读不到 | 反汇编 `TTDisplayPrefItemView` 的 `setFontSize*`；或实机量三档行高 |
| 7 | **应用图标个数**与会员图标的数量 | 解包出来的 `.app` 被裁成 60 nib/包，`Contents/Resources` 里**没有** `.icns` | 完整包体，或实机打开图标页数 |
| 8 | **字体族真实档数**（是 5 还是 6） | 字体资源文件 5 个，预览图 5 组但其中 `harmonyos` / `lxgw` 没有对应字体文件 → 名字集合与文件集合不一致 | 反编译字体列表构造处；或实机看字体面板 |
| 9 | **快捷键条数**与默认键位 | 动作清单在代码里（`strings.json` 只有分类说明） | 反编译快捷键注册表；或实机滚动截图 |
| 10 | **会员锁的边界**（哪几个主题/图标/样式被锁） | 只有"存在会员概念"的证据（`IsPro`、premium 文案），逐项 gating 在代码里 | 反编译 gating 判定；或用两个账号（会员/非会员）对比截图 |
| 11 | **移动端**是否真有独立的「我的」tab | 本机产物只有桌面两端 | 移动端包体 |
| 12 | **注销账号**入口是否存在 | `NeedResetPassword` / `NeedResetUserId` 从名字看是"重置"，不是"注销" | 实机找；或反编译账号页 VM |
| 13 | 「更多设置」页里那 7 个面板的**上下顺序是否就是渲染顺序** | `StackPanel.Children` 的顺序是静态的，但 `StackPanel` 可能被代码重排/隐藏 | 反编译 `MoreSettingsConfig` 的 `OnLoaded` 一类逻辑 |
| 14 | 本文所有 `B/C` 级格的**可达性**（这一屏是否还有入口） | 文件名与类名只证明"编译过" | 实机逐屏点一遍 |

---

## 8. 一句话结论

它把「**个性化**」（主题 / 风格 / 字体 / 字号 / 图标 / 自动夜间 / 便签 / 倒数日 / 快捷键 —— 9 个维度，其中 3 个跨端形态不完全一样）和「**行为默认值**」（任务默认 / 提醒 / 日历语义 / 智能识别 / 番茄 / 习惯 / 智能清单 / 模板 / 安全 / 组件 —— 12 组）**装进了同一个设置树**，数据层也没分开（`SettingsModel` 128 列里主题与"每周从哪天开始"相邻）；**只有"本机 vs 账号"这一条界线它是真的分了**（外观参数在本地 `CommonSettings`，行为默认值在同步的 `SettingsModel` / `ZTTUSERSETTINGS`）。
heyta 现在 8 个个性化维度**半有 3、无 5**，主题只有 2 值 —— 差距是**结构性的**，但补的路径很清楚：先立"系列"这一层（借鉴 2），再把"选风格=看图"做成形态（借鉴 1），同时把"本机/账号"的分层写进 ADR（借鉴 5）。不必补的是皮肤数量与自带色板（不借鉴 1、2）。
