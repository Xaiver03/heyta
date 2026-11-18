# UI/UX 逐条改进清单（一条一条来）

> 原则见 [`GLOBAL-LAYOUT-PRINCIPLES.md`](GLOBAL-LAYOUT-PRINCIPLES.md)。这份是**执行队列**：
> 一条一条做、每条都带"改哪、怎么验"，做完打勾。**不贪大、不并单**。
> 状态：⬜ 待做 / 🔄 进行中 / ✅ 完成。

| # | 状态 | 改什么 | 依据（原则/Apple） | 落点 | 验收 |
|---|---|---|---|---|---|
| C0 | ✅ | 重装到 iPhone 真机（Release/dev 签名，已验证启动+截图） | — | `scripts/ios-device-install.sh` | 真机截图 `img/on-device-iphone-20261118.png` |
| C1 | ✅ | **全局排版布局原则**：顶部锚定 + IA 分层 + 动作分层 + 三组件职责 | Apple Wayfinding/Familiarity/Simplicity；`screen-chrome.md`/`entry-layers.md` | 本目录 `GLOBAL-LAYOUT-PRINCIPLES.md` | 文档评审 |
| C2 | ⬜ | **顶部导航栏抽象**：统一 `TopBar`（leading/title/tabs/actions/overflow 槽），`apps/mobile` AppBar 改薄包装 | P3/P4、Apple Familiarity | `packages/ui/src/layout/TopBar.tsx`（另一会话已起草，**接手评审勿另起**）+ `apps/mobile/src/ui/kit.tsx` AppBar | `check:nav-chrome`；各屏顶栏一致截图 |
| C3 | ⬜ | **底部导航栏抽象**：抽出 TabBar 的形态/组合契约（items/active/badge/安全区），材质留各端 | P3、`tab-bar-ios`/`bottom-nav-limit` | `apps/mobile/src/nav/TabBar.tsx` + 共享契约 | 5 tab 一致、Badge、材质 |
| C4 | ⬜ | **登录屏 IA**：从「我的」未登录点"注册登录"→ 跳**统一全屏登录屏**（L2：TopBar 返回 + 顶锚一栏到底 + 单主 CTA），不再在 tab 内整屏替换；与 WelcomeScreen 全屏登录档同形态 | P1/P5、Wayfinding、`modal-vs-navigation` | `apps/mobile/src/screens/ProfileScreen.tsx`（`authOpen` 分支 1313-1323）+ `AuthScreen.tsx`（整屏档布局）+ 导航栈 | 真机：点"注册登录"进全屏登录屏截图；层级/主 CTA 检查 |
| C5 | ⬜ | **登录屏排版**：标题贴顶、字段一栏、主按钮不贴底不居中漂浮、次级路径折叠、错误就近、返回常驻 | P1/P5/P6、`input-labels`/`error-placement` | `AuthScreen.tsx` + 共享 `@heyta/ui` `AuthForm` | 真机截图 + `check:form-anatomy` |
| C6 | ⬜ | **日历「回到今天」行太重**：`CalendarToolbar` 重排为轻量；视图切档进抽象 TopBar `tabs`，「今天」降为次要动作/图标 | P4/P5、Apple 顶栏"标题说在哪、箭头说怎么移" | `packages/ui/src/calendar/CalendarToolbar.tsx` + `CalendarScreen.tsx` | 日历截图；顶栏动作 ≤3 |
| C7 | ⬜ | **逐屏"按顶排版"审计**：找出默认垂直居中/漂浮的内容，改顶锚；确认每屏单一主标题 | P1/P2 | `apps/mobile/src/screens/*` | 逐屏截图对照 |
| C8 | ⬜ | 任务列表 **分组标题移到卡外**（inset grouped 惯例） | P6 | `packages/ui/src/task-list/TaskList.tsx` `renderItem` | 列表截图（有内容时） |
| C9 | ⬜ | 任务补两个**智能列表**：计划（有日期全部）/ 旗标 | 功能 | `TasksScreen.tsx` `sectionTasks`/`view` + `@heyta/domain` | 入口+筛选判据 |
| C10 | ⬜ | **Apple Design 细节批**：按压即时反馈、勾选/完成弹簧、触感、`prefers-reduced-motion` 降级 | `apple-design` §1/§4/§13/§14 | `TaskRow`/`TabBar`/sheet/专注 | 交互实测 |
| C11 | ⬜ | 无障碍与 Dynamic Type 全列表/表单 reflow + VoiceOver 标签 | P8、`dynamic-type`/`voiceover-sr` | 全组件 | 大字号+读屏实测 |

## 推荐顺序（按依赖）
C2（顶栏地基）→ C3（底栏）→ **C4/C5（登录，直接命中你的痛点）** → C6（日历）→ C7（逐屏审计）→ C8/C9 → C10/C11。
每做完一条：跑对应门禁 + 真机/模拟器截图，再动下一条。

## 备注
- `packages/ui/src/layout/TopBar.tsx` 目前是**另一会话未提交**的草稿（`git status` 显示 `?? packages/ui/src/layout/TopBar.tsx`）。C2 要**接它**，不新建第二份；动手前先看它做到哪、避免覆盖对方未提交成果（AGENTS §6）。
- 不改不可逆层；新 token 先加 `tokens.css` 再用。
