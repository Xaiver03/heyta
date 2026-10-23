# 浮层与反馈规范适配层（heyta）

> **真源指针**：选型判据（五条轴 / 打断强度 0–5 级 / 18 类速查）、关闭策略矩阵、时长与堆叠、危险三档与撤销的 7 条工程前提、移动端分档规则、T1–T8 整改分档，**全部住在全局 Skill `overlay-feedback-patterns`**，本机权威路径 `/Users/rocalight/.skill-catalog/personal/overlay-feedback-patterns/`（`SKILL.md` + `references/{taxonomy,dismissal-and-timing,destructive-actions,mobile-sheets,audit-checklist,glossary-zh-en}.md`）。
> **本文件只是 heyta 的适配层**：本仓对着那套判据现在有什么、缺什么、按什么顺序改。两条规则打架时**以通用 Skill 为准**；下面的读数只是现状，不是规范。
> 相邻本仓真源：[设计系统行为规范](design-system-behavior.md) §1（Sheet 那一行）、[ADR-0048 删除四态](../adr/0048-deletion-four-states-and-the-no-physical-erase-boundary.md)、[ADR-0037 桌面内嵌共享 Web UI](../adr/0037-desktop-ui-falls-back-to-webview.md)。

## 1. 现状基线

> 🔴 **本表是 2026-10-23 的一次现量读数，引用前先重跑下面的命令。**

| 探针 | 读数 | 判定 |
|---|---|---|
| 浮层底座 | Radix **0**、antd/MUI/vant/element-plus **0** | 全自绘、**单一底座**（RN 原语 + CSS token） |
| 共享包边界 | `@heyta/ui`（RN 原语，四端共用）+ `@heyta/design-system`（token 唯一真源）；`packages/ui/src/overlay/` **只有 `model.ts`**，**没有任何浮层原语导出** | 缺原语层 |
| Web 自绘模态层 | `aria-modal` **17 处 / 10 文件**；`role="dialog"` **21 文件** | 散落自绘 |
| 原生对话框 | **8 处 / 5 文件**：web `window.confirm` 1（`apps/web/src/features/sync/VaultSettingsPanel.tsx:188`）、管理后台 `confirm` 3（`server/public/app.js:239,297,345`，英文硬编码）、RN `Alert.alert` 4（`apps/mobile/src/screens/SecurityScreen.tsx:285`、`VaultSettingsSection.tsx:240`、`SessionsSection.tsx:129,159`） | >0，必须清 |
| 关闭策略显式约定 | 库式开关（`onEscapeKeyDown` 等）**0 处**；自写 Esc 监听 **26 处**；统一装置 `useModalDismiss` **只有 1 个消费者**（`AuthPanel.tsx:224`）；完全没有 Esc 的模态 2 文件（`features/share/ShareFeature.tsx`、`JoinSharedListDialog.tsx`） | 无约定，逐处自判 |
| 焦点陷阱 / 背景 inert | 陷阱 **2 处**（`PrivacyConsentSheet.tsx:87`、`App.tsx:1060`）、`inert` **1 处** → 17 个模态层里 15 个没有 | 半套模态 |
| 轻反馈套数 | toast 库 **0 套**、自动消失的成功回执 **0 处**；就地提示行 **24 处**（`ht-settings__notice` / `ht-inbox__notice`）、`role="alert"` **34 处** | 无 toast 层（是选型，不是缺） |
| 时长配置 | `duration:` **0 处**；撤销窗口硬编码 **5000ms × 3 处**（`App.tsx:437`、`TasksScreen.tsx:707,715`） | 不合通用规则（应 ≥7s + hover/聚焦暂停） |
| 撤销链路 | **有**：批量删除 / 四象限移动（`App.tsx:493`、`TasksScreen.tsx:1249,1587`）；软删除 `deletedAt`（`packages/op-log/src/state.ts:586-600`）；`purge` 拒绝恢复（`packages/app-host/src/actions.ts:635`） | 成立但有边界，见 §3 |
| 行内报错 | `aria-invalid` **16 处 / 4 文件**，大头在共享层 `packages/ui/src/auth/AuthForm.tsx`（12） | 有正确样板，覆盖窄 |
| 危险操作统一入口 | `useConfirm` / `resolveDangerTier` / `DangerZone` **0 处** | 无 |
| 移动端 sheet 分档 | **T7 开工后**：把手/拖拽/分档/记忆 **1 处**（共享原语 `packages/ui/src/overlay/BottomSheet.tsx`，已迁 `TaskDetailSheet`）；`maxHeight:'90%'` 单档剩 **5 处**（`TasksScreen.tsx:245,360`、`ConflictSheet.tsx:91`、`PrivacyConsentSheet.tsx:87`、`LegalReconfirmSheet.tsx:61`）；居中 `justifyContent:'center'` 仍在 `TrashScreen.tsx:96`、`ConflictSheet.tsx:86`、两块法律面板 | 已开工，法律闸门**刻意不迁** |
| 层级档位 | **有 9 档** token（`packages/design-system/src/tokens.ts:122`、`tokens.css:308-319`：base…splash）；裸 `z-index:` 数字 **0 处** | 已达标 |
| 自绘覆盖层 | CSS `inset: 0` **13 处**（`sheets.css` 5、`auth-dialog.css` 2、trash/habits/base/assistant/category 各 1）+ RN 手工遮罩 `material.scrim` **7 处** + 绕开 React 树的 DOM 浮层 1 枚（`features/auth/desktop-handoff.ts:102-112`，占用 `z.toast` 档） | 债务在遮罩，不在层级 |

**复现命令**（仓库根执行）：

```sh
rg -o "@radix-ui/react-[a-z-]+" -g'*.tsx' -g'!**/node_modules/**' | wc -l     # 底座
rg -o "aria-modal" -g'*.tsx' apps/web/src packages/ui/src | wc -l             # 自绘模态层
rg -n "window\.(confirm|alert)\(" -g'*.ts' -g'*.tsx' -g'*.js' -g'!**/node_modules/**' -g'!**/dist/**'
rg -c "^\s*const confirmed = confirm\(" server/public/app.js                  # 后台原生框
rg -o "Alert\.alert\(" -g'*.tsx' apps/mobile/src | wc -l                      # RN 原生框
rg -o "'Escape'" -g'*.tsx' apps/web/src apps/mobile/src packages/ui/src | wc -l
rg -o "ht-settings__notice|ht-inbox__notice" -g'*.tsx' apps/web/src | wc -l   # 就地提示行
rg -n "5000" apps/web/src/App.tsx apps/mobile/src/screens/TasksScreen.tsx     # 撤销时长
rg -o "maxHeight: '90%'" -g'*.tsx' apps/mobile/src | wc -l                    # 移动端单档
rg -n "^  --ht-z-" packages/design-system/src/tokens.css                      # 层级档位
rg -n "z-index:\s*[0-9]" -g'*.css' -g'*.tsx' apps packages -g'!**/node_modules/**' -g'!**/dist/**'
rg -o "inset: 0" -g'*.css' apps/web/src packages/design-system/src | wc -l    # 自绘覆盖层
```

## 2. 通用 18 类 → 本仓落点

| # | 类型 | 本仓有什么 | 缺什么 |
|---|---|---|---|
| 1 | Tooltip | `data-cell-title` + 宿主 CSS `::after`（`packages/ui/src/motivation/ActivityHeatmap.tsx:336`、`categories/CategoryReport.tsx:159`）；窄屏已有「不许把名字收进 tooltip」判据（`apps/web/src/styles/app/narrow.css:271`） | 无统一原语；`CategoryReport.tsx:180` 明写**只有 web 宿主传 `cellTooltip`** ⇒ 原生端这一类信息直接不存在 |
| 2 | Hover Card | 无 | 暂无需求，不补 |
| 3 | Popover | 共享算术 `placeAnchoredPanel()`（`packages/ui/src/overlay/model.ts:64`）+ 宿主各自渲染（`shell/AccountMenu.tsx`、`calendar/CalendarCapturePopover.tsx`） | 算术共用、渲染没共用；`z.popover(500) > z.modal(400)` 是本仓刻意例外，别当 bug |
| 4 | Menu / Dropdown | `shell/AccountMenu.tsx`、`shell/CompactRailNavigation.tsx`、`apps/web/src/features/categories/ColorSlotPicker.tsx` | 「选择即关闭」与 Esc 归属无契约测试 |
| 5 | Modal / Dialog | 17 处自绘 `aria-modal`（trash / habits / categories / share / sync / auth / ai / legal / privacy） | **无共享原语**：滚动锁、焦点陷阱、`inert`、焦点归还各抄一份 |
| 6 | AlertDialog | `features/trash/TrashView.tsx:251-333`：遮罩 `role="presentation"` **不响应点击** ✓、Esc=取消（`:198`）✓、正文写范围 ✓ | 给了 ✕（`:302-308`）、主按钮用 `--primary` 而非 danger（`:323`）、初始焦点不在「取消」 |
| 7 | Popconfirm | 事实存在但是**行内替换**不是气泡：`confirmingId` 模式（`TrashView.tsx:109`、`settings/PasskeyPanel.tsx:157`、`apps/mobile/src/lib/trash-display.ts:176`） | 没有封装，三处各写一套状态机 |
| 8 | Drawer / Side Sheet | `shell/ScopeDrawer.tsx`、详情面（`App.tsx:1060` 那圈焦点逻辑） | 抽屉与模态共用自绘遮罩，档位归属没写清 |
| 9 | Bottom Sheet | **名不符实**：4 个 `apps/mobile/src/screens/*Sheet.tsx` 都是 RN `Modal` + 居中卡片 + 单档 90% | 分档、把手、跟手拖拽、记忆档位全缺 |
| 10 | Full-screen Overlay | `screens/NoteEditScreen.tsx`（全屏 `Modal`）、`SearchScreen.tsx`（贴底） | 与 #9 的边界未定：长内容仍塞 sheet |
| 11 | Toast | **0 套**；复制反馈用按钮文案切换，`features/inbox/InviteActivityCard.tsx:37` 明写「不做成全局 toast」 | 不需要补，见 §4 T3 |
| 12 | Snackbar | 半个：撤销按钮挂页头（`App.tsx:2497-2508`）/ 移动 bulk 工具条（`TasksScreen.tsx:1249,1412`），5s 自消、无 hover 暂停 | 时长与暂停不合规则；位置不是拇指区/角落 |
| 13 | Notification | 真系统通知（提醒投递）+ 应用内通知中心（`features/inbox/InboxBell.tsx`、`apps/mobile/src/screens/NotificationsScreen.tsx`） | 与「操作回执」混用同一批文案键，无并发上限 |
| 14 | Alert（页面内） | 24 处就地提示行 + 34 处 `role="alert"`；样板 `features/tasks/TaskActionError.tsx`（不自消 ✓、给重试 ✓、不贴 `error.message` ✓） | 靠 CSS class `ht-settings__danger` 跨目录复用，**无组件** |
| 15 | Inline Alert / Field Error | `packages/ui/src/auth/AuthForm.tsx` 字段下方常驻 + 12 处 `aria-invalid` ✓ | 其余表单只贡献 4 处；面板级 danger 行在替字段级报错说话 |
| 16 | Banner | 几乎没有（仅法务 draft 两处：`AuthPanel.tsx:782`、`apps/mobile/src/screens/AuthScreen.tsx:1077`） | 「关过不再打扰」的持久化机制缺 |
| 17 | Progress | 同步状态条 `packages/ui/src/sync/SyncStatusBar.tsx:126` + `apps/web/src/features/sync/SyncBar.tsx:62`；导出有超时预算（`apps/mobile/src/lib/card-export-units.ts:120`） | 无已知总量的任务没有统一形状 |
| 18 | Skeleton / Spinner | Spinner 有（`ActivityIndicator` / `RefreshCw`）；**Empty State 是正式资产**（`packages/ui/src/empty-state/EmptyState.tsx` + `pnpm check:empty-state`） | Skeleton **0** 处 |

## 3. 危险档位判定（本仓真实动作）

| 动作 | 落点 | 现状 | 应属档 |
|---|---|---|---|
| 批量删除任务 | `App.tsx:483-496`、`TasksScreen.tsx:707` | 直接做 + 5s 撤销 | 轻 ✓（唯一已落对的） |
| 单条删除任务 / 清单 | `App.tsx:1574`、`projects/ProjectsPanel.tsx:335`、`apps/mobile/src/screens/ListsSection.tsx:354` | **静默删除、无撤销** | 轻（该补，见 T6） |
| 彻底删除 purge | `TrashView.tsx:251-333`、`TrashScreen.tsx:373` | 就地确认，后果三条齐全 | 重 ✓（不可撤销：`actions.ts:635`） |
| 撤销设备授权 / 注销全部会话 | `VaultSettingsPanel.tsx:188`、`SessionsSection.tsx:129,159`、`server/public/app.js:239,297,345` | **原生对话框** | 重 ✗ → T1 |
| 删除 Passkey | `PasskeyPanel.tsx:157`、`SecurityScreen.tsx:285` | 行内确认 / 原生框；另有「最后一个 passkey」硬闸门（ADR-0029、ADR-0041） | 中→重，两端形状不一致 |
| 注销账号 | `CloseAccountPanel.tsx:144-176`（勾选 + danger 主按钮）、`AccountClosureScreen.tsx:239` | 勾选确认 | 重 **+ 输入名称**（现无逐字键入） |
| 对外可见 / 出网：分享发布、AI 出网、TickTick 导入 | `packages/app-host/src/share-publish.ts`、`settings/AiSettings.tsx:1447`、`settings/TickTickImportPanel.tsx:286` | 各有面板内确认 | 重——按 destructive-actions §4，**即使能撤销也必须保留确认** |
| 本地数据销毁 | `apps/web/src/lib/local-data-destruction.ts` | 面板内确认 | 重 + 不可撤销 |

**「撤销」这一档在 heyta 成不成立**（逐条对通用 7 前提）：① 软删除 ✓（`op-log/src/state.ts:586-600`，回收站恢复 = `UPD {deletedAt:null}`，`actions.ts:630`）；② 保留期 ⚠️ [ADR-0048](../adr/0048-deletion-four-states-and-the-no-physical-erase-boundary.md) §3.2 明写**不设自动保留期** ⇒ 文案不许出现「N 天内可恢复」；③ 幂等 ✓ [ADR-0009](../adr/0009-duplicate-op-idempotent-success.md)；④ 无外部副作用 ✗ 两处破口：已软删任务的提醒**仍会投递**（ADR-0048 §1 缺陷 D1）、分享发布与授权撤销的对外动作撤不回；⑤ 审计留痕 ✓（op-log 只追加、唯一写入口）；⑥ 下游一致 ✓ 读路径统一按 `deletedAt` 过滤（`domain/src/habit-streak.ts:367`、`memory.ts:203`、`milestones.ts:88`），反例是**归档**对 AI/MCP/CLI 全可见（ADR-0048 §1）；⑦ 权限一致 ✓ 撤销复用 restore。
⇒ 结论：撤销对「任务 / 便签 / 清单 / 习惯的删除」这一族**成立**；对 **purge、注销账号、授权撤销、分享发布、AI 出网、数据销毁**六格**不成立**，那几格保留重档确认框是正确结论而不是欠账。

## 4. T1–T8 的本仓对应与影响面

| 档 | 本仓具体做什么 | 影响面（现量） | 风险 |
|---|---|---|---|
| **T1** 清原生对话框 | 8 处 / 5 文件归零。RN 那 4 处**不能先删**（`Alert.alert` 是当前移动端唯一确认形态）→ 必须先有 T2 的 RN 原语；后台三处顺带违反 i18n 唯一真源 | 5 文件 | 低 |
| **T2** 统一危险入口 | `resolveDangerTier()` 落 `packages/`（业务语义不许写进 `apps/*`，AGENTS §3.5，建议 `packages/domain`）；浮层原语补进 `packages/ui/src/overlay/`（现在只有 `model.ts`）；AlertDialog 默认禁 scrim、初始焦点在取消、主按钮 destructive | 新建 1 + 2 端 | 低 |
| **T3** 轻反馈归一 | 本仓**没有 toast 库可合**，方向相反：把 24 处就地提示行 + 34 处 `role="alert"` 收成一个共享 Alert 组件。🔴 别为了「有 toast」新造一套——那是把第 3 级压成第 2 级 | ~30 文件 | 中 |
| **T4** 行内报错归位 | 以 `AuthForm.tsx` 为样板铺 `CategoryCreateDialog` / `PasswordPanel` / `EmailChangePanel`（现共 4 处 `aria-invalid`）；提交失败的面板级 danger 行不许替字段说话 | 3–5 表单 | 中 |
| **T5** 关闭策略显式化 | 先解 `use-modal-dismiss.ts` 文件头写明的边界（「面板开在设置浮层里，一次 Esc 连着关两层」），再推给其余 15 个模态层；补 `ShareFeature.tsx` / `JoinSharedListDialog.tsx` 的 Esc；补焦点陷阱与 `inert` | 10 文件 | 中 |
| **T6** 撤销链路 | 把 bulk 撤销铺到单条删除；5000ms → ≥7000ms 并加 hover/聚焦暂停（`App.tsx:437`、`TasksScreen.tsx:707,715`）；§3 那六格**明确排除**。涉数据模型与文案，是唯一能推翻 §3 判断的一档 | 2 端 + i18n | **高** |
| **T7** 移动端形态 | 4 个 `*Sheet.tsx` + 13 处 `<Modal`：居中 → 按视口切底部，引入分档（30/60/90）+ 把手 + 记忆档位；返回键已有分层接管可接（`TasksScreen.tsx:733`、`nav/navigation.tsx:59`）。⚠️ 本仓 **Android 构建不在本机跑**，设备验证走 iOS 模拟器或远端打包机。**2026-10-23 进度**：`TaskDetailSheet` 已迁（新增 `BottomSheet` + `sheet-detents`，把手 36×5 新进 `size.grabber-*` 两个 token） | 10 文件（已完 1） | 中高 |
| **T7 例外** | 🔴 **法律闸门不迁**：`PrivacyConsentSheet` / `LegalReconfirmSheet` 保持居中模态 —— 把合规面板变成能一把划走的底部面板，等于给"同意/不同意"旁边加一条"划掉"。理由与"不能照抄"那张表同源 | — | — |
| **T8** 层级与自绘收敛 | 层级在 heyta **已基本达标**（9 档 token、裸值 0）；剩 13 处 `inset: 0` + 7 处 `material.scrim` 遮罩迁到 T2 原语，以及 `desktop-handoff.ts:102-112` 那枚挂 DOM 的浮层 | ~20 处 | 低中 |

**建议顺序**：T2（原语先存在）→ T1（可机械验证）→ T5 → T4 → T3 → T6 → T7 → T8。每档做完留 §1 同一条命令的读数，别一次改全仓。

## 5. 多端要点

| 端 | 载体 | 要点 |
|---|---|---|
| Web | `apps/web`（React + `react-native-web@0.21.3`，`packages/ui` 的 RN 组件在此渲染成 DOM） | 模态语义全靠手写 `aria-modal`；**Esc 必须挂捕获阶段**（RN-web `TextInput` 无条件 `stopPropagation`，见 `use-modal-dismiss.ts` 文件头与 AGENTS §7 #80） |
| 桌面 | [ADR-0037](../adr/0037-desktop-ui-falls-back-to-webview.md)：原生壳（`desktop-macos` / `-windows` / `-linux`）**内嵌同一份 Web UI** | 浮层缺陷与 Web 端**同源**，修一次三端受益；`apps/desktop`（Electron）是被替换路线 |
| iOS / Android / HarmonyOS | `apps/mobile`（RN 0.84 + RNOH，[ADR-0004](../adr/0004-ui-stack.md)） | `Alert.alert` 4 处 = 系统框，放不下后果说明、测不了焦点；sheet 全部居中单档；🔴 **`role="alert"` 与 `aria-live` 各 0 处** —— 移动端轻反馈完全没有播报语义 |
| 管理后台 | `server/public/app.js`（无框架） | 3 处 `confirm()` + 硬编码英文，唯一没进 i18n 与 token 体系的浮层 |
| 落地页 | `apps/landing`（静态站） | 本规范不适用于它，只受动效与无障碍约束 |

## 6. 已有资产（不要重复造）

- `packages/ui/src/overlay/model.ts:64` `placeAnchoredPanel()` —— 锚点弹层的宿主无关算术（web 取 rect、RN 取 `measureInWindow`），新 Popover/Menu 直接复用。
- `apps/web/src/lib/use-modal-dismiss.ts` —— Esc + 焦点入内 + 关闭归还触发者，**已写好但只有 1 个消费者**（`AuthPanel.tsx:224`）。
  🔴 **T2 之后它不再是"现成装置"，而是待退役的那一份**：`OverlayModal` 地基是 react-native-web 自己的 `Modal`，
  焦点入内/归还/`role="dialog"`/`aria-modal` 由 `ModalFocusTrap` 与 `ModalContent` 白送，
  而且它自带模态栈只让最顶层响应 —— 也就是这个 hook 文件头写的那条已知边界
  （"面板开在设置浮层里时，一次 Esc 会连着关掉两层"）在原语这一侧**由结构消掉**。
  T5 的动作是把 `AuthPanel` 迁到 `OverlayModal`、随后删掉这个 hook；**不要**再把它推给其余 15 层（那是在固化第二份实现）。
- `packages/ui/src/auth/LegalDocumentSheet.tsx:350-356` —— ⚠️ **共享层里既存的第二份模态外壳**
  （RN `Modal` + `transparent` + `onRequestClose` + `accessibilityViewIsModal` + `color.overlay` 遮罩）。
  它是本文件 §1「浮层底座 = 全自绘」读数的一部分，**归宿是 `OverlayModal`**（T5/T8），不是可照抄的样板。
  两处几何差异要在迁移时定一个答案：它用 `color.surface` + `maxHeight:'88%'`，`OverlayModal` 用 `color.surface-raised`。
- 🔴 **`packages/ui` 没有共享 Button** —— 仓内按钮色板目前有四份：`apps/mobile/src/ui/kit.tsx:746-753`（唯一带 `tone` 词表的）、
  `packages/ui/src/sync/ShareConsentModal.tsx:128-144`、`LegalDocumentSheet` 的 × 、`apps/web/src/styles/app/controls.css` 的 `.ht-btn--*`
  （⚠️ `.ht-btn--danger` 孤悬在 `trash.css:56-60`，消费方 5+ 处）。
  `DangerDialog` 那两个动作按钮**是内联的**，tone 口径逐字对齐 `kit.tsx:750`（`color.danger` + `color.foreground-inverse`）
  与 `:753`（禁用用 `state.disabled-opacity`，不另配灰底灰字）。**缺的是共享 `Button` 这一枚，不是第 5 份 tone 表** ——
  补它属于独立一档（要同时收 web 的 CSS class 与 mobile 的 kit），不要塞进 T2。
- ⚠️ 命名陷阱：`packages/ui/src/sync/ShareConsentModal.tsx` 名字叫 Modal，**不含 `Modal`、不含遮罩**，
  是纯内容块（遮罩与关闭归宿主）。别把它当浮层原语的样板。
- `apps/web/src/features/privacy/PrivacyConsentSheet.tsx:75-100` —— 全站唯一完整的焦点陷阱 + 强制阅读型浮层样板。
- `apps/web/src/features/tasks/TaskActionError.tsx` —— 不自消、给重试、不贴内部 `error.message` 的失败行样板。
- `packages/ui/src/empty-state/` 与 `apps/mobile/src/nav` 的 `BackHandler` 分层接管（`TasksScreen.tsx:733`）。
- token 与门禁：`design-system` 的 9 档 `z` + `material.scrim` 语义名（`packages/ui/src/material/material-surface.ts`）；`pnpm check:design`（裸值）、`check:ui-provider`（共享组件必须挂在 `<HeytaUiProvider>` 内）、`check:layering`（分层）。新增浮层原语先看这三道能否复用。
- 测试样板：`e2e/tests/category-dialog-ux.spec.ts`、`apps/web/tests/auth-panel-modal-dismiss.spec.tsx`、`e2e/tests/p0-remediation.spec.ts`。
