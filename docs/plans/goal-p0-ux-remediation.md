# Goal：P0 体验整改（审计合并稿 §8「一周内」批）

> 状态：**进行中 → 收尾**（2026-10-06 立项，同日实现完毕；整族 e2e 终验在跑）
> 依据（唯一工单来源）：[product-level-ia-ux-audit.md](../research/product-level-ia-ux-audit.md) §8。
> 本文档只记**执行状态与证据**，不复制审计论证。

## 0. 撞车登记（开工前置第 3 步的现量读数，2026-10-06 16:35）

| 文件 | 状态 | 判定 |
|---|---|---|
| `apps/web/src/App.tsx` | M，mtime **25 分钟前**（并行会话**实时写着**，diff 111 行） | 🔴 W1/W2/W3 ⇒ **换序等待**；静默 ≥45 分钟后由主会话接管实现 |
| `packages/i18n/src/locales/{zh-CN,en}.ts` | M，mtime **22 分钟前** | 🔴 新词条工单（W6/W8b）⇒ 同上换序；开工时改为**锚点 Edit**（并行 diff 逐字保留） |
| `apps/web/src/features/tasks/store.ts` | M，mtime **7.2 小时前**（陈旧线） | 🟡 允许叠加编辑（W7 叠加成功，并行 hunk 逐字未动） |
| view-tabs.ts / narrow.css / TaskDetailCard.tsx / TaskRepeat.tsx / quadrant / notes | 干净 | ✅ 第一批并行开工 |

插曲：因子 Agent 配额 5 小时上限，W1+W2+W3 与 W6 两个在途子任务 17:0x 被打断，
**主会话接管续做**（它们留下了约 80% 成品；W6 只剩一条 authoring bug，见 W6 行）。

## 1. 工单台账（判据见审计稿 §8；证据列 = 收尾回填）

| # | 工单 | 状态 | 证据（读数） |
|---|---|---|---|
| W1 | IA 收敛：实现"4+1 更多" | ✅ | `view-tabs.ts` 新增 `splitRailTabs`（pinned: tasks/calendar/habits/search；激活视图提升进主段），两代裁决注释收敛成一代（历史注记保留）；`App.tsx` 「更多」弹出层（aria-haspopup/expanded、打开聚焦首项、Esc 关闭焦点归还——容器 onKeyDown + effect）；词条 `web.shell.views.groupMore`（zh '更多'/en 'More'）。**接线测试** `tests/rail-more-menu.spec.ts`（纯函数 3 条）+ `tests/shell-more-and-settings.spec.tsx`（App 级：全开 ≤4+更多 / ≤5 无更多 / 键盘三连）。e2e 契约随新 IA 更新：`motivation.spec.ts` 两条（9 标签→4+6 菜单；默认 7 tab→4+更多+回收站，全部断言保留重述）+ `helpers.ts` `switchView` 收口（找不到 tab ⇒ 走「更多」菜单真路径，免逐 spec 修）。截图 w1-more-open-{light,dark}.png 人看过 |
| W2 | 设置浮层遮蔽详情列 | ✅ | `App.tsx`：`.ht-app` 加 `data-detail-suppressed`（view==='settings'）+ aside `hidden`；`base.css` 第三条归零规则（与 collapsed/empty 两条**故意不合并**，理由在注释）+ `.ht-app__detail[hidden]{display:none}`。单测 `shell-more-and-settings.spec.tsx` W2 条（hidden/轨道信号/关闭后 selection store 原选中）。**变异**：拿掉 hidden ⇒ 恰 1 红，复原 4/4。设计取舍：hidden 而非卸载——detailRef 的 MutationObserver 挂在节点上（effect 依赖 []），卸载重挂会冻结构造。截图 w2-settings-suppresses-detail.png 人看过（对照旧图 settings-sheet.png） |
| W3 | AI 工具调用默认收起 | ✅ | `App.tsx`：aiPanels 包进 `<details class="ht-ai-drawer" data-testid="ai-drawer">`（summary=`web.ai.tools.title`）；样式 `ai-panels.css:642+`。单测：`shell-more-and-settings.spec.tsx` W3 条（默认无 open / summary 可读 / 点开后 ai-tool-input 在场）+ 既有 7 个 AI 测试文件改挂载后 **99/99 绿**（不改断言）。截图 w1w3-tasks-1440-light.png（抽屉收起一行）人看过 |
| W4 | 窄屏底部导航 | ✅ | `narrow.css` ≤768 块重写（+136/−59）：rail=底栏单行横滑（每条标签 nowrap+`flex:0 0 auto`，竖排根因消除）；sidebar=范围筛选区（chip 行横滑 + 面板封顶纵滚）；布局模型注释 :8-43。`check:design` 过、postcss 解析过。几何判据进 e2e（每枚 `.ht-rail__label`/`.ht-nav__item` 宽>高）。截图 w4-narrow-375-tasks.png 人看过（对照 MW01：竖排消失）。⚠️ 登记未修：375px 行尾控件组折行占高（row-tail-fold 既有债） |
| W5 | 四象限空态整改 | ✅（🔴 一半当晚被产品负责人推翻，已执行） | 首版：共享层加第四个插槽 `renderHeaderTrailing` + `cellEmptyCompact`（空格塌缩）+ 占位去重/计数徽标/帮助折叠，7 判据全绿 + 三组变异 + 回归 149。**2026-10-06 晚裁决**：产品负责人看过实装（附滴答桌面截图）拍板"**四象限本来就应该铺满**" ⇒ `cellEmptyCompact` 当天撤除（历史注记在 `QuadrantBoard.tsx`），ui 10/10 + web 7/7 复绿、W5 e2e 重拍截图人看过。**最终保留三样**：占位去重（同屏 ≤1）、计数徽标（quadrant-count-{slot}，slot 从 1 起）、规则说明收进 `<details data-testid="quadrant-help">`。裁决已同步回审计稿 §4-5 |
| W6 | 详情列四分组 + RRULE 高级化 | ✅ | `TaskDetailCard.tsx`：基本信息/时间/组织/自动化四组（组头 h3 testID=task-detail-group；**优先级归「组织」不归「时间」**，裁决在文件头）；`TaskRepeat.tsx`：RRULE 输入进 `<details data-testid="task-repeat-advanced">` 默认折叠。词条 5 枚（section.{basic,time,organize,automation} + detail.advanced，zh/en 成对）。测试：新 `task-detail-groups.spec.tsx` 4 条 + 既有 36 条 + W7 8 条全绿。⚠️ 主会话修掉一条 authoring bug：组序断言 `follows(member,next)` 期望值写反（其语义=组员在下一组头之前，与同文件全部正向断言一致），首跑即红、从未绿过 |
| W7 | Web 标题 + 手动优先级接线 | ✅ | `store.renameTask`（store.ts:97/:278-283 → app-host `rename`，并行会话 hunk 逐字未动）；TitleField（TaskDetailCard.tsx，点 h2 改名、Esc 还原、空/未变不发 op、settled 闸）；优先级 select（接既有 `setPriority`——此前唯一调用方是 AI 批量写入）。词条零新增（titleAria + priority 现成）。8+36=44/44；变异 MUT1 删 rename 接线⇒2 红、MUT2 删 priority 接线⇒1 红。⚠️ 实测发现 React 19.3 keyed 字段换选中留旧节点（两只 h2 并存）——id 锚绕开 + 回归钉，**候选环境陷阱条目** |
| W8 | 便签静默失败 | ✅ | **W8a**：`notes/model.ts` 提交结局状态机（失败保草稿+alert；成功只清"仍是所提交内容"那份——在途新敲的字不吞）；NotesBoard alert（仿 FocusPanel 先例）+ 必填 `labels.saveFailed`（陷阱 #195：可选 prop 会把"宿主没接"伪装成完成）。20/20 + 两轮变异各恰 2 红。**W8b**：词条 `notes.error.saveFailed`（zh：没存上，内容还在输入框里，请重试）；web store re-throw（原先 catch-all 进**没人读的** error 字段）、mobile `runAdd` + actions===null 抛错（原先静默 return 会被判 saved 清草稿）。18/18 + web 真链路 7/7（超长 ⇒ reject ⇒ 提示亮 + 草稿逐字保留 + 0 条落库）+ 变异（退回 void ⇒ 恰 1 红）；两端 typecheck notes 错误清零 |
| W9 | 视觉基线重取证 | ✅ | `e2e/tests/p0-remediation.spec.ts` 6/6；7 张截图入 `apps/web/evidence/p0-remediation/`，**逐张人看过**，结论登记在该目录 README；每条含几何/DOM 断言不只靠看图。教训两枚：slot 从 1 起不是 0；本 shell 无 pnpm ⇒ corepack 垫片 `/tmp/pnpm-shim`（webServer 起 vite 需要） |

## 2. 收尾门禁读数（2026-10-06 晚）

| 门禁 | 读数 |
|---|---|
| `pnpm --filter '!@heyta/sync-server' -r typecheck` | **rc=0**（全包 Done） |
| apps/web 全量单测 | **2030 passed / 0 failed**（156 文件，13 skipped；基线 2028+2 红 = W1 打到的两条旧 IA 契约，已按"断言保留、挂载适配/契约重述"修平） |
| 三门禁 | `check:design` ✅ 无裸值；`check:ui-language` ✅ zh 3261 = en 3261（含本轮新增 6 枚）；`docs-link-check` 3 处红 = **并行会话未跟踪文件**（ci-proxy ×2 + product-ux-optimization），本轮改动 0 新增（期间修掉自己 evidence README 的 2 条层级错误链接） |
| e2e | **整族分批跑毕（2026-10-06 深夜）**：字母序 a→habit-frequency 150 条（四象限 reverted 后）+ 批1 habit 余量/inbox/keyboard 53 + 批2 language→rail-trash 32 + 批3 renew→vault 29 + `p0-remediation` 6 + `motivation` 7（两次）+ 修复复验 20 + 3。全天 6 处红**全部根因闭环、零产品回归**：① smoke `toHaveCount(11)` / motivation 两条 rail 契约 / focus-detail-pane + gantt-chart 挂载 / timeline-p2 直点 tab = 旧 IA 契约，按"断言保留、契约重述"适配；② habit-icon-picker I3 / habit-month R2 / habit-frequency Q2 Q3 = **我在 switchView 引入的 TOCTOU 竞态**（reload 后启动期 `count()===0` 把主段目的地误判进菜单）——改为带 5s auto-wait 的点击、失败才走菜单，复验全绿 |
| `reinstall:all` | ✅ **四端全绿（2026-10-06 深夜，产品负责人授权加负载）**：**mac** ✅ 打包+装 /Applications+web-dist 同构建对账+主蓝命中 1127"是共享 UI"；**windows** ✅ 源码包 80M sha256 对账+远端新鲜度+**5 条判据全在位**（ADD_APPX/RESULT/PAYLOAD_WEBDIST/M2D…）；**ios** ✅（`IOS_DEVICE_NAME=heyta-iphone-17pro` 显式指定——脚本拒绝猜设备名）全新安装+新鲜度判据+主蓝 4152；**android** ✅ release APK 67,115,944 B 四判据绿+模拟器全新安装+前台 com.heyta 确认+主蓝 4001。⚠️ 两笔如实登记：① android 首趟 gradle 失败（日志只留尾部，根因未捕获）、直跑复验 **BUILD SUCCESSFUL** 后步骤 5 出现一次**不可复现**的假"陈旧产物"判读（mtime 比远端自己记的 begin 早 20s，两端时钟逐秒同步）——第三趟四判据全绿，疑点留给 `run-gradle.mjs` 的所有者，未改门禁；② iOS 段 `pod install` 把 `Podfile.lock` 改了 2 行（沙盒同步副作用，工作树未提交，是否入库由移动端所有者裁决） |

## 3. 过程经验（按 AGENTS §8.8 应写回的）

1. **撞车纪律实测有效**：App.tsx/i18n 实时占用 ⇒ 换序等静默，主会话接管后并行 hunk 逐字无损。
2. **配额打断的子任务会留下"约 80% 成品"**：接管前先 `git diff --stat` 盘点 + 跑目标测试定位断点，比重写省一半；但 authoring bug（从未绿过的断言）要靠"语义与同文件其它断言自洽"审出来。
3. **React 19.3 keyed 字段**（候选 §7 条目）：`key={task.id}` 的受控字段在切换选中后旧 DOM 节点残留（`querySelector` 命中旧只），改渲染期派生 id 锚规避。
4. **IA 变更的 e2e 冲击面在 helper 收口点**：`switchView` 一处改，全部 spec 免修；契约型断言（rail 数量/顺序）按"断言保留、契约重述、注明裁决来源"更新。⚠️ 收口点自己的判据要防 **TOCTOU**：`count()` 快照在页面 reload 后的启动窗口会读 0，把主段目的地误判进菜单——判定必须是带 auto-wait 的点击、超时才走另一条路（§2 e2e 行的实测）。
5. 沙箱 shell 无 pnpm ⇒ `corepack pnpm` 垫片可顶（playwright webServer 起 vite 依赖它）。
6. **产品裁决的响应路径**：负责人看实装截图当场推翻 W5 一半（"四象限本来就应该铺满"）——当天撤 `cellEmptyCompact`、重拍截图、三处文档（audit §4-5 / evidence README / 本表）同步，历史注记写在实现文件里防再摆回。

## 4. 遗留与移交

- ~~reinstall:all~~ ✅ 已补跑（见 §2 表）——**"四端都装上了当前源码的产物"这一定义本轮闭合**。
- **产品拍板项**（攒着，见审计稿 §3.3 三条）：① 专注提一级；② 搜索提一级；③ 清单的清单级属性（每清单默认视图 / 过滤器实体——滴答「添加清单」对话框两问的下游，对标登记见 dida365-feature-benchmark §2.2 #2.11 + P2-13）。
- **范围外登记未动**：能力密度清单（undo/批量/右键/手势/下拉刷新）、375px 行尾折行债、web notes store `error` 字段零读取点（W8b 登记留主线裁决）。
