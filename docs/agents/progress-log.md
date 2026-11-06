<!-- 由 heyta/AGENTS.md 按作用域拆分而来（2026-10-12）。内容零删除。
     本文件是「当前进度」的完整规则（原文 §9 当前进度）。返回入口：[`AGENTS.md`](../../AGENTS.md)。
     原始单体文件备份：`AGENTS.md.bak-full-2026-10-12`。 -->

## 9. 当前进度

| 阶段 | 状态 |
|---|---|
| P0 奠基 | ✅ 已完成（协议已跑通，Docker 实测通过） |
| P1 单端闭环 | ✅ **已完成**。**冲突解决闭环已实测跑通**：`pnpm verify:p1` 自带真实服务端跑 11 条零 mock E2E，含"真实点击 `ConflictDialog` → 双端收敛"两条（`keep-local` / `keep-remote` 各一）→ [`详细计划`](../../docs/plans/archive/phase-1-single-client-loop.md) |
| P2 多端补齐 | 🔄 **进行中**（**外壳 IA：rail = 任务/日历/四象限/习惯/时间线/搜索 + 回收站 + 头像（设置/统计/退出登录）+ 帮助** —— 功能模块开关（默认关掉番茄钟/成长/便签，关掉的**不进 DOM**）、共享 `CalendarBoard`（web 此前**一个日历都没有**）、共享 `SearchPanel`（便签此前**没有任何搜索入口**）、提醒的**投递路径**（`due` 早算好了但没人读，全仓一个 `new Notification(` 都没有）、实时同步在 web 的接线（`realtime.ts` 450 行 + 自带测试齐全，而**没有任何宿主 `createRealtimeClient()`**）；13 项幻觉复核 **12 项已修 / 1 项外部阻塞** ✅ / 存储契约 ✅ / SQLite ✅ / token 生成器 ✅ / **RN token 产物（含暗色合并 + 类型安全）** ✅ / **ArkTS 产物真编译器验证** ✅ / **RNOH 依赖链实测打通** ✅ / 非 Web 宿主 ✅ / **移动壳（Android 实机跑通）** ✅ / **移动端任务可编辑 + 冲突解决闭环 + 专注闭环 + 日历 + 重复任务（真模拟器零 mock E2E：`pnpm verify:mobile-edit`、`pnpm verify:mobile-conflict`、`pnpm verify:mobile-focus`、`pnpm verify:mobile-calendar`、`pnpm verify:mobile-repeat`、**`pnpm verify:mobile-autosync`（全程不点任何同步按钮，写入也必须自己出去；变异：拿掉写入信号 ⇒ 3 红）**）** ✅ / ✅ **自动同步（前台 + 本地写入去抖）**：此前同步**只能靠手点** —— 建完任务数据一直躺在本地，而界面全绿。核心/平台两层拆分（纯决策逻辑 16 条单测 + 变异验证），三个并发陷阱逐个处理（代际计数防丢写、失败退避防热循环、`ready()` 必须地址与令牌同时具备）；**§7 第 66/67/68 条**，计划 §3.27 ✅ / ✅ **顺手修掉两条陈旧判据**（是自动同步**当场**把它们照出来的）：① `verify-mobile-focus` 的 **delta 基线取晚了**，把"传得更快"读成"没传" —— A/B：关自动同步 26/26、开 25/26，而**同一次运行**又打印笔记本读到了那条记录（**假红**）；② `verify-mobile-edit` **自 i18n 迁移起就是红的**（脚本找「任务标题」，界面词条是「标题」）＋「优先级」区块在首屏之外被当成"没渲染"。修完 **28/28** ✅ / **移动端四个标签全部为真实屏幕**（占位文件已删除）✅ / **iOS 壳已跑通到交互级**（Release 模拟器构建 → 安装 → 启动 → 真图标 + 真中文 + 真 SQLite 建库；`pnpm verify:mobile-ios` **36 项零 mock**，含"点 FAB → 输中文 → 提交 → op 落库 → 同步到另一台设备"全链路，**并含「零点击自动同步」这一条**（第 6 步；变异：关掉 `startAutoSync()` ⇒ **恰好 2 红**，而同一轮里「点按钮」那条仍然绿）；**从"我的页 + 键盘立着"这个曾经判红的初始状态跑起也能全绿**）✅/ ✅ **P0 已修：一条硬被拒的 op 会让设备同步永久卡死**（§7 第 34 条，**ADR-0009**；线级 + 反证 + 真机界面四层验收）/ ✅ **P0 已修：读侧解不开的 op 会让**别的**设备同步永久卡死**（§7 第 41 条，**ADR-0016**；变异验证 + 真服务端复验；配套修掉 legacy 密文在 Hermes 上无纯 JS 兜底）✅ / **清单（PROJECT）跨设备闭环**（`pnpm verify:mobile-lists` 零 mock：手机建清单 → 任务归入 → 笔记本读到**同一条清单、同一个 `projectId`**；业务逻辑复用 `packages/app-host`，未 bump schema）✅ / ✅ **P0 已修：手机"只能推、不能拉"** —— 上传响应搭车回来的 op 里有一条解不开，整次同步就死在 **upload 阶段**，`download()` **从不执行**（界面只显示"同步失败"，本地库远端 op 数 = 0）。（**ADR-0016 §6**，§7 第 46/47 条；变异验证 + 真机复验 + 判据补强：必须**数出**远端 op ≥ 1）✅ / **标签（TAG）跨设备闭环** —— 在此之前 `tagIds` **全仓库没有一处读写**（零件都在、产品里没有这个功能）。`TaskActions.setTags`（整组覆盖、写入侧校验悬空 id）、清单/标签共用 `OrganizerSection`、`pnpm verify:mobile-tags` 零 mock 四层判据（标签实体 + 任务引用 × 手机 + 笔记本）（399 单测 +2 处变异验证）✅ / **Web 端也接上「清单 + 标签」** —— 同一个空洞的另一半：`moveToProject` 在 `apps/web` **零调用点**，于是侧栏里建出来的清单和标签一个都用不上。新增 `TaskOrganizer`（原生控件、chip 常驻 + `<details>` 编辑），浏览器套件 13/13，判据是**刷新后仍在**（变异可复现：只写本地态 ⇒ 2 红）✅ / **三端同步验收 `pnpm verify:multi-end`**（Web ↔ 服务端 ↔ 笔记本，真浏览器 + 真服务端 + 真 SQLite）—— 补上此前**没人覆盖**的那条接缝（手机脚本没有浏览器、浏览器套件刻意离线）。第 3 相开在**全新 context = 空 IndexedDB**（= 一台刚装好的新设备），18/18。顺带查出三个真问题：**自建栈 CORS 默认只放行上游域名**（症状是「离线」而服务端零请求）、**服务端只存密文所以不能按内容断言**、**两设备共用 clientId 会让双方都同步不了**✅ / **鸿蒙：从 JS 源码到自包含 release HAP 的整条构建链已实测打通**（`verify:harmony-toolchain` 17/17、`verify:harmony-rnoh` 17/17、`verify:harmony-rnoh-js` 13/13：真 codegen + 真 autolinking + `hermes_bundle.hbc`（魔数已验）→ **20 MB release HAP**，含全部原生库，双 ABI。**但没跑起来**：缺模拟器系统镜像 + 签名（产物 unsigned）→ §3.24 / §3.25）→ [`详细计划`](../../docs/plans/archive/phase-2-multi-platform.md) |
| P3 平台特性 | ⏸ |

总路线图：[`docs/plans/roadmap.md`](../../docs/plans/roadmap.md)

### 并行轨道：滴答清单对标（2026-11-06 开工，🔄 进行中）

**它不是什么**：不是"抄一个竞品"。是拿两端已装的滴答（macOS 8.2.03 原生 Swift / Windows 8.2.5.0 .NET+WPF，
**都不是 Electron**）做逆向取证，产出一份**需求对齐清单**，再按那份清单补齐我们自己的缺口。
🔴 口径是**不照抄**：不抄它的文案、图标、字体、像素布局、命名。

| 入口 | 是什么 |
|---|---|
| [`ticktick-parity-prd-2026-11.md`](../../docs/plans/ticktick-parity-prd-2026-11.md) | R1–R14 需求清单（P0 四条 / P1 六条 / P2 五条 / 明确不做五条） |
| [`ticktick-parity-handoff-2026-11.md`](../../docs/plans/ticktick-parity-handoff-2026-11.md) | **现状与顺序的唯一真源**（§0 一页现状会随进度改） |
| [`ticktick-teardown-index.md`](../../docs/research/ticktick-teardown-index.md) | 十条取证线的总目录 + §3 **勘误台账**（引用任何数字前先读它） |
| [`r14-entry-table.md`](../../docs/plans/r14-entry-table.md) | 入口契约：38 行的"动作 × 层级 × 主入口"账本，`pnpm check:entry-table` 盯着 |

**已落库（六个提交）**：E 入口契约（账本 + 11 条规则的门禁）· A 数据可信（本机库归属 / 登出即销毁 / 撤销栈 / 同步可见）·
C-① 全局唤出（托盘 + 热键 + 快速添加面板）· D-① 暗色 token 族 ·
另清掉两笔既有债（`check:layering` 一行、`.ht-accountmenu` 收族 ⇒ 族数回 28，**没抬基线**）。

**已完成并入库（12 笔）**：E 入口账本 + 门禁 · A 数据可信 · D-① 暗色族 · C-① 全局唤出 ·
**B 的四条**（R3 跳过这一次 / R4 手动排序接通 / R8 标签管理页 / R1 字段单点收敛）·
**A 的四条边界证据**（待上传>0 真浏览器 / 归属红条 / `rejected` 计数 / R5「≤3 层」现量）·
另加一笔"合并别名计数"（侧栏标签数不再偏低）。

**R10「明天」也已落地**（`e3c25e6c0`：领域一档 + 侧栏一行，不新开 ViewKey）。
**就剩两格**：**C-② 的 R13a 那半**（设置树与「我的」页）与 **D-②**（R11 四态 + R5 附件 + R13b 主题/字号/行着色）——
工单已就绪（[`c2-d2-work-orders-2026-11.md`](../../docs/plans/c2-d2-work-orders-2026-11.md)，含三处已拍板的分歧与两包文件边界）；
以及**移动端设备腿**（前置条件在工单 §5）。

⚠️ **两笔已登记的已知红，别当成新问题**：`check:l4`（看板 4 处内联样式，`BLOCKED.md` B274，
要重建在 `TaskRow` 上才一次修净）；`rejected` 行永不清除 ⇒ "待上传"单调不减（需"丢弃被拒 op"语义）。

---

### 并行轨道：协作与共享清单（🟡 **M2 已收尾并进 `main`（2026-10-23，读数在本线计划 §9.11）；同日 M4 逐 op 签名已落地（读数 §9.12）；M5 三格 + M6 移动端接入已落地并**有设备腿读数**（2026-10-26，逐格读数和逐张看过的截图指针在本线计划 §9.14 —— 那条腿判的是"手机和 web 一样真的能用"这一整句，复量命令是 `pnpm verify:mobile-collab:ios`；**所有者那一侧也在设备上走过了**（2026-10-26 第 35 跑 L7：手机自己建清单 → 设为共享 → 签发邀请 → 服务端认 `role=owner` 且所有者行带签名公钥 → 撤销，读数在同一节「第 35 跑新增的两格」那张表））**；**「收得到实时信号并按本机偏好打扰用户」那一半在 2026-10-26 第九批才真正接上消费面**（此前投递有生产者、界面无消费者）：通知中心第三档「共享动态」+ 入口徽标相加 + 设备腿 L8 两半相反，读数在 §9.15；同日第 39 跑再补 L9（便签那一族的下行）⇒ **三族的下行在设备上都有读数**（`56 通过 / 0 失败`）。还欠的是 Android 那一侧的界面腿（载体**半装**（`adb` 与一枚 AVD 在、**缺两枚**：`Sdk\emulator` 主程序与 `system-images` 整目录）、无真机接入；⚠️ 2026-10-27 19:0x 连加速那一档也量了：三枚虚拟化可选组件全未启用、VT-x 被 VBS／内核隔离占住 ⇒ x86_64 镜像只剩 WHPX 一条加速路，而启用它要**管理员 + 重启这台共享装机**（Java／网络／磁盘／内存都不拦）；读数、取法、那条"未判定"实验的断言在 **§9.29**，格位在 §9.14 与 §9.28 ③。不是没排期，也不是"装一枚就好"（2026-10-27 把原先那句「载体不存在」按现量两次改准））；✅ 同日 19:28–19:57 本线那三把尺**与设备腿都在当前树上重取过**（第 53 跑 `63 通过 / 0 失败`，起建 `a9366282f`，逐臂读数与那把差集命令在计划 §9.30／§9.31，跑次台账在 §9.24 那张表末尾）；与两格归产品负责人的取向题（同一张表）；✅ **那句「三族与另一台设备双向同步」到 2026-10-27 第十批在手机上补齐**：新建时的落点控件（`CaptureComposer` 的 `projectPicker`，默认收集箱、选中才交 `projectId`）接在任务面板与便签板上，设备腿 **L10**（任务）/**L11**（便签）各判到 owner 侧从共享日志读回并验签，两族各配一枚变异臂（任务那一族退化成"丢掉落点"⇒ 整链只有 L10 红；便签那一族把宿主那行退化成永远交 `{}` ⇒ 只有 L11 红）⇒ 形状、判据与逐趟读数在 §9.16。⚠️ 这一整段里那些"多少通过"的读数各自只代表**它自己那一跑起建的那枚提交**；最新一趟在 §9.24 那张表的**末行**（第 53 跑，起建 `a9366282f`，逐格读数在 §9.31；同日 22:0x 对 §9.28 那几格"现状原话"又只读复取一遍，读数与那把打空的尺在 §9.32）。🔴 台账里**没有"当前产物的设备腿读数"这一档**，只有带戳的读数 —— 要把带戳的读数用到此刻的树上，跑 §9.24 末尾那把两端钉死的差集命令自己量（原因与教训见环境陷阱 #600）。🔴 **还开着的是相邻那一格**：把一条**已有**便签挪进别的清单（`setNoteProject`）在两壳仍零调用点（现量 `git grep -n setNoteProject -- 'apps/**/src/**' 'packages/**/src/**'` ⇒ 只剩接口声明与实现两处） —— 那是"事后改归属"，别拿 §9.16 的绿读成它做完；四端重装 2026-10-22 15:0x 已跑绿，读数在本计划 14:5x/15:0x 两节；✅ **六段的变异臂到 2026-10-27 第十一批补齐**——同意闸三层那副四臂首跑零漂移（读数在计划 §9.18–§9.19，收口对账表在 §9.17：按任务书的措辞下探针会打空，要按表里的真落点取）；⚠️ `main` 上整条 `pnpm check` 到 2026-10-27 14:3x 那趟读到的「只剩**一枚**红，落在 `apps/web` 的 `task-sort` 批量选择那一格」**当日 18:5x 已被现量否证**（`cd apps/web && npx vitest run tests/task-sort.spec.tsx tests/task-selection.spec.tsx` ⇒ 2 passed / rc=0，同一棵树上整包 `-r test` 也 rc=0）—— 那句当时是**截断链只暴露第一个红**的读数，被当成红集全集抄了下来（截断的读数不是全集）；今日那趟 `check` 断在更早的第 102／132 段 `check:ai-e2e`，红是别线在册的 `rail-roving`（归 `apps/web` 那条线，本线只登记不替它定性；读数与现量命令在同一计划 §9 末尾那几节（节号每次现量：`grep -nE '^#{3,4} (§)?9\.[0-9]+' docs/plans/collaboration-shared-lists.md | tail -1`））；✅ **M5 那三格的最后一格（两枚谓词的"数据面"）到 2026-10-27 第十三批按"今天接不上"结案**——裁决没变、两枚谓词仍零命中，变的是那句"没有输入"从此不靠人记着：`packages/ui/tests/notification-model.spec.ts` 里那枚判据做成了**双向**（加档位没输入会红，输入出现而档位没回来也会红），理由与三枚臂的形状在计划 §9.26、口径在 [ADR-0062](../adr/0062-shared-list-key-distribution.md) 第 8 条那一戳

> 这一节的标题以前写的是「本地成笔、全链门禁被别线绊线挡着」（2026-10-11）。那是**瞬时读数**，它说的两件事现在都不是那个形状：
> 本线的笔早已 push（判据见下面那条 `git rev-list` 命令），那四枚绊线也全部由各自的主人闭合。
> 标题留着会让下一位先去等别人。还欠的两格都不必等别人**改本线的东西**：
> ① 装到四端（§6.1.1）—— 预检 exit 3；**12:0x 复量：负载那一格已转绿（读数 6 ≤ 阈值 12），剩下的只有两枚设备项**
> （iOS 0 台已启动 / Android 0 枚在线），而两枚脚本都明确不代起设备，归停止点 ③；
> ⚠️ 两条瞬时性：负载会随别的会话再起而关上；**载体新鲜那一腿**（打包输入面差集）会因别线往输入面提交而重新打开 ⇒ 追平是**点火前最后一秒**的动作；
> ② `pnpm check` 那 122 段链上两枚红（`check:selection-single-source`、`check:image-license`）—— 相关文件对 HEAD 干净、
> 都不是本线碰出来的，按"别人门的豁免表属判卷口径"不代改；语义结论与可直接粘贴的修法已写进 goal 计划交接·四 10:2x 那一节。

E2EE 下的**清单共享**基础设施（ADR-0062）已实现并**已在 `main` 上、且已 push**（`git log` 现量，标题以「协作共享清单 W4/W6 接线」起）：
邀请凭证 + 成员角色 + **所有权转让**（两步确认、立即生效、原 owner 降 editor）+ **入群链接**落点（`?shareToken=`，
点开进加入流程、消费后摘参）+ 换钥时身份种子随 listKey 一起落盘。真实旅程 `pnpm verify:collab-journey`
**`RESULT=OK steps=3`**；本线三枚门禁红当场查并修绿 —— `check:layering`（把外壳里那份合成 AAD 的 op 形状构造
提进 `@heyta/app-host`）与 `check:ui-language`（`web.share.invite.emailPlaceholder` 补进门禁白名单，与 i18n
`catalog.spec` 既有同一判断对齐，**不改文案**），以及 **`apps/landing` 复刻对账**（本线 W4 接线 `a923f7fa` 往
`.ht-header__actions` 加了 `share-open-button`，落地页登记处没跟着补 ⇒ 已按既有 `mockedInLanding:false` 约定补登记、
阳性对照按真源码补项，**不放宽判据**；作用域已穷举，其余钉页头的判据停在不进共享按钮的默认视图）。`pnpm -r typecheck` 全仓绿。

🔴 **那一版"仍红四枚 + 未 push"已经过期，按 2026-10-20 现量改写**（红集会被人修掉，所以下面每条都带复量命令，别抄读数）：

- **那四枚绊线全部闭合，且都不是本线修的**：`packages/ai`（分母那格改成从 `MODELED_ENTITY_TYPES` 派生）、`check:reachability`（评论有了写路径与宿主调用点）、`packages/shared-schema` 的口令路径封闭词表补齐、`packages/domain` 权益拒绝理由契约由自动收集线拆回自己那张表。复量：`cd packages/{ai,shared-schema,domain} && npx vitest run` 各 rc=0 ＋ `pnpm check:reachability` rc=0。
- **`capability-manifest.generated.ts` 已入库**（`git status --porcelain -- packages/ai/src/capability-manifest.generated.ts` 现量 = 空），"跨线混物留工作树待协调"那一格从此不再有对象；它当初被推迟的理由（重生成会同时带别线的 4 枚 TASK 工具）由别线自己把它们提交掉而消解。
- **push 已发生**：`git rev-list --left-right --count refs/remotes/origin/main...main` 现量 `0 0`。所以"本线不代推、押在跨线协调"这句不再成立；下一位要推的是**别人新落的笔**，那条边界照旧有效（判据就是上面这条命令）。
- **W4 残余从三件变两件，但产品定性变坏了**：评论**已挂载并有写路径**（`apps/web/src/features/tasks/TaskDetailCard.tsx` 里 `ShareCommentsSection` 的 import 与渲染两处命中），不再是"已建模不可达"；指派与动态照旧（`Task.assigneeUserId` 全仓零写点、只有通知过滤在读；动态流仍只有通知偏好开关）。
  🔴 **下面那一格到 2026-10-21 已经改了一半，别按原句读**（原句留在这里是因为它还剩另一半是真的）：
  **评论这条腿通了** —— `downloadOps` 现在有人消费（复量：`grep -rn "downloadOps" --include=*.ts packages/app-host/src apps/web/src | grep -v spec` 有命中），
  游标落盘、进评论区先拉一次、`verify:collab-sync` 的宿主层那一格经真宿主验过（步数由脚本自己打印，别在这里抄）。
  当时仍然断的是**任务与清单的写路径**（2026-10-21 的读数；今天已接通，见本节末 ④）：`packages/app-host/src/project-actions.ts` 里唯一的 share 相关方法照旧只有 `setProjectShareId`，
  没有任何 share 分流 ⇒ **界面上今天成员之间什么都看不到**：评论那一族在**宿主层**能互拉（`verify:collab-sync` 那"两台"是两个无界面宿主实例），
  但成员那侧的共享清单行只有 `addProject` + `setProjectShare` 两步 ⇒ 是一条**空清单**，而评论区在 web 只挂在任务详情上
  （现量：`grep -rn ShareCommentsSection apps` 只回 `TaskDetailCard.tsx` 一处）⇒ 没有任务就没有评论区可点。任务那一族连宿主层都搬不到（那是 M2，要先立 ADR）。
  实时信号 `new_share_ops` **已经接上了**（2026-10-21 M5：客户端认下、宿主判断该不该拉、`@heyta/ui` 那条谓词决定响不响，5 秒轮询已撤）——
  但它今天搬运得到的仍然只有评论那一族，理由与上面那格同一个：`TASK` 的 op 还没进 share log。
  ⇒ 逐条见本线计划 `docs/plans/collaboration-shared-lists.md` §9.1 那张现状表与 §9.7–§9.10（M7 / M1 / M3 / M5 各一批读数）。

状态与逐项读数见 [`docs/plans/goal-collaboration-shared-lists.md`](../../docs/plans/goal-collaboration-shared-lists.md) **文末那几节**（末节号现量：`grep -n '^## ' docs/plans/goal-collaboration-shared-lists.md | tail -2`，本行不写节名因为它会长）；PIPL 同意面的视觉层级（旧停止点 ①）已按最佳实践落地并配判据（`apps/web/tests/share-consent-modal-theme.spec.tsx`）；**所有权转让语义（旧停止点 ②）已由产品负责人把判定权交下来、本轮按产品判断定案保留现语义**（两步确认 → 立即生效 → 原 owner 降 editor，服务端单事务原子），翻案条件写在计划那一节。
🔴 **但"语义已定"不等于"这条路径是对的"**：2026-10-22 复核那一格时发现一条待修的正确性洞，登记为本线计划 §6 的 **B-10** —— 转让那一步**不校验接收方手里有没有清单钥**，而"刚接受邀请的成员信封为空、世代却与当前对齐"是**默认态**（不是边角），于是转给他之后新 owner 解不开内容、补发信封又是 owner 专属写路径 ⇒ 客户端一格都修不了。修法（资格门两半 + 具名错误 + 面板灰态 + 三头验收臂）写在 B-10 那一行。**2026-10-22 04:1x 已做完并复绿**（服务端 `share-routes.spec` 35 条含两头失法臂、界面 `share-panel-transfer.spec` 10 条、两半各拆一次只红对应那一条）；原来那句"排在四端重装之后做"**撤掉了** —— 重装那一格被停止点 ③ 卡住三天以上，把一条已经能走到的生产路径上的正确性洞押在等授权后面不划算，而重装还没跑过 ⇒ 这一改自然进下一批产物，顺序提前没有代价。

🔴 **2026-10-22 18:2x/18:3x 两处更新（读现状时以这两句为准，别再按上面 10-20/10-21 的句子推断"能用了"）**：
① **两处停止点都闭合**——同意面视觉层级那格的前提已被现量否证（8 条常驻判据），转让语义由负责人把判定权交下来后**定为甲**（两步确认 → 一次事务立即生效 → 原 owner 降 `editor`；翻案条件写在计划那一节）。
② **内容面在界面上今天零可达**：评论那一族 2026-10-21 通的是**宿主层**（两个无界面宿主实例互拉），成员那侧的共享清单是一条**空清单**、评论区又只挂在任务详情上 ⇒ 谁都没有可点的内容（现量命令与九格改口见 `docs/plans/goal-collaboration-shared-lists.md` 17:0x 那节，教训是环境陷阱 #535）。
③ 本线"完成"的算法换成两把能自算的尺（本线判据全绿 + 别线每一枚红逐枚定成因入库）；`pnpm check` 那串没动，链该红还红 —— 逐枚红集在计划 14:0x/16:4x/17:3x/17:5x/18:0x 五节。下一步 **M2**，判据两格：`TASK/PROJECT` 进 share log **且** 两台真浏览器里 B 看得见 A 改的任务；开工前先立那份承接 0062 的新 ADR。冷启动读计划文末**接手点 v3**。
④ **2026-10-23 M2 收尾：上面那两句"零可达 / 连宿主层都搬不到"不再成立**（它们是当时的读数，留着是为了说明"为什么会需要一把量得到界面的尺"）。写侧：任务/便签/评论三族的意图先过 `packages/app-host/src/share-routing.ts` 那**一处**判据（ADR-0067 裁决一 + 一·补三格），清单这条记录本身按 ADR-0068 裁决一仍走个人 log；读侧 `currentState()` 交的是**合并视图**，共享条目挂到**本机**那条清单行。用户可见那一格由 `verify:collab-journey` 的「两台真浏览器互见」常驻钉着 —— **它第一趟就是红的**，抓到的是 M5 那道信号闸门只认"这份日志在本机落过盘"（刚入群那台一次都没拉过 ⇒ 索引空 ⇒ 第一份内容被丢掉，而判据自锁），已修并留两臂。P-1 那枚"入口默认隐藏"按它自己写的翻案条件撤掉，门禁翻成钉「可达」（`check:share-entry-visible`，五判 + 阳性对照 + 5 臂）。逐格读数在本线计划 §9.11；下一步 **M4（逐 op 签名，不可逆层）** 与 **M6（移动端六段）**。冷启动读计划文末**接手点**与 §9.1 那张现状表。
⑤ **2026-10-23 M4 落地：共享日志里每一条 op 现在说得出"是谁写的、有没有被动过"**。口径在 [ADR-0069](../../docs/adr/0069-share-op-per-op-signing-keys-and-disposition.md)（签名域 = 除 `serverSeq`/`receivedAt` 之外全部服务端可见字段；`keyEpoch` 刻意不进域 —— 它在那枚被签的信封头 9 字节里）；逐格读数在计划 §9.12，四把尺（typecheck / test / build / journey）当天全绿。三层判据各有能红的装置：纯函数层的逐字节翻转臂、服务端层 `verify:collab-sync` 第 13 步那六臂（含"验不过就**不落库**、游标停在那条之前 ⇒ 报警会自己赖在盘上"）、宿主层盘上改一枚签名另一台读到的是具名失败而不是静默错数据。🔴 **两处如实登记的没做到**：库里存量 op 不追签（所以"每一条都可验"只对新写入成立）、移动端今天**一条都签不出来**（M6 那条腿还没接）—— 别把这一格读成"签名这条线做完了"。下一步只剩 **M6（移动端六段）**。



分支 `feat/motivation-system`（worktree `.worktrees/motivation`）。L1 即时反馈 / L2 连续性 /
L3 叙事三层**已实现**，**并已落到 `main`**（merge commit `84cc7f5`，2026-09-27，
75 文件 / +11008 行）。分支与 worktree **已删除**（相关提交仍是 `main` 的祖先，随时可达）。

📄 落地程序、验证矩阵与回退点在
[`激励与成长体系设计`](../../docs/plans/archive/motivation-and-progression.md) **§12**。

同批落地的还有**活动分类与分类着色** —— 成长视图里的分类泳道图 + 周堆叠条，
入口是清单与习惯编辑处的色槽取色器（1–8，**调色板由我们给、含义由用户赋**）。
🔴 核心裁决：**颜色由用户自己赋义，App 永不判断某个活动"健康／不健康"、也永不自动上色**。
分层清单见 [`docs/plans/roadmap.md`](../../docs/plans/roadmap.md) §1.2。

> ⚠️ 下面这段是**历史记录，不是现状** —— 分支当初确实被挡过，挡它的两件事都已消失：
> 主检出的 200+ 未提交改动由各自的所有者提交并推送；`main` 自己 build / typecheck / test
> 的那批红灯（消费者已提交、生产者在路上）也随同一批提交补齐。**留在这里是为了让后来者
> 认出"分几笔落地"这个形状**，而不是照它行动。

设计红线：**不发行任何货币**（没有金币/积分/商店，也不卖"后悔"）、
**只与自己的过去比**（排行榜/联赛/自习室/组队打 Boss 在 E2EE 下结构上不可能）、
**从不制造愧疚**。关键裁决见下面 ADR-0022 与
[`docs/plans/roadmap.md`](../../docs/plans/roadmap.md) §1.2。

### 并行轨道：提醒唤醒与系统通知（🟡 代码级已落地，欠的证据以 ADR 那份逐条清单为准）

状态真源在 [`ADR-0051`](../../docs/adr/0051-mobile-reminder-delivery.md) 末尾那三节
（2026-10-24「桌面四端接上系统通知 + 移动端把拒绝说到明处」与
2026-10-25「提醒面那一行补上了」+ 其下的「设备腿：当前构建上那一帧」）——
「实测到哪一步」那张表 + 「没关掉的边界」那份逐条清单 + 设备腿逐条读数。
**本节不复述它的读数**（同一事实存两处一定会漂，这条在本仓已经吃过一次）。

要现量"还剩几格"，跑这一条。口径两句话：**范围只取那一节**（旧写法 `awk …,0` 一路跑到文件末尾，
把后面小节里的编号列表也数进来 —— 2026-10-25 现量：同一份文件两种取法读数是 12 与 3，差的九行全在别的节里）；
**"已关"只认逐字的 `本条已关`**（半关的那种，比如 iOS 取到而 Android 没取到，标题里带 🟢 但**仍算没关**；
别拿 🟢 当过滤词，它既标全关也标半关）：

```sh
sed -n '/^#### 没关掉的边界/,/^#### /p' docs/adr/0051-mobile-reminder-delivery.md \
  | grep -E '^[0-9]+\. \*\*' | grep -vc '本条已关'
```

三句话的定位：**桌面端的投递住在页侧不住在壳侧**（三壳跑的是存储宿主模式，
壳侧 `deliverReminders()` 必抛"宿主还没打开"——实测逼出来的，不是取向）；
**Android 的开机/改权限重排只做一件事：作废 `scheduled` 缓存**（绝不动 `delivered`/`posted`，
否则会把已投过的提醒再响一次）；**iOS 通知授权弹窗的正文按设备状态有两种**
（同一台模拟器、同一枚二进制、同一份 plist，两种都取到过：一轮逐字＝plist 里那句自定义目的串，
另一轮是系统自带那句 —— 所以**对外不许写"iOS 会显示 heyta 的理由"**，
要让用户一定看到理由只能靠应用内那一行降级状态。取证与逐轮对照见
`apps/mobile/evidence/ios-notification-purpose-20261024/`，判据是"截图正文＝设备容器里现读的那份 plist"）。
装置踩到的坑与否证掉的归因登记在 [`environment-traps.md`](../reference/environment-traps.md) §7 #547、#548。

### 并行轨道：表单 / 对话框的「解剖」（✅ 代码层收口 2026-10-24；还欠两枚别线的红）

**一句话**：把"每个填表界面各画一套"收敛成**一套判断 + 两个渲染器**，并让"结构"这一层能被判红。

| 事 | 读数 |
|---|---|
| 原则文档 | [`ux-principles.md`](ux-principles.md) —— 九节，每条带**可判红的判据**与出处（GOV.UK / Apple HIG / WCAG / ui-ux-pro-max） |
| 一份判断 | `packages/ui/src/form/anatomy.ts`（`resolveFieldChrome` / `fieldDescribedById`）—— web 的 `FormField` 与移动端 `kit.TextField` **各消费同一个函数** |
| web 收敛 | 手写字段标签 **72 → 0**（账本 `scripts/form-anatomy-ledger.json` 现量 0 处 / 0 文件） |
| 移动端收敛 | 文本 / 数字 / 多行备注全走 `kit.TextField`；裸 `<TextInput>` 只剩 **3 处非字段**（搜索框 / 聊天输入条 / Fabric focus 竞态那一格），由 `mobile-text-field.spec.ts` **M5** 记账 |
| 结构门禁 | `check:form-anatomy`（R1 账本只减不增 + R2 解剖定义处唯一）+ e2e `assertFormRhythm`（一档控件高度、≥43px）；**5 次注入验证过能红** |
| 看图 | `apps/web/evidence/habit-create-alignment/`、`…/settings-form-alignment/`、`…/form-alignment-sweep/`、`…/admin-holiday/admin-holiday-form.png` |

**这一批最贵的三条教训**（都记在 ux-principles §8 的未闭合格里，因为下一位迁移时一定还会踩）：

1. **看图才看得见形状**：习惯目标编辑器"数值 + 单位并排"在**宽度由内容决定**的面板里会裁掉占位符；
   加宽度下限又会**溢出右边框**（面板宽 = 最宽的孩子，循环依赖）。几何判据当时全绿。
2. **原语必须自己顶住宿主的遗留样式**：后台「年份」那一格被老的 `.ht-settings__admin-input { flex: 1 }`
   压成 **17px** —— 纵向 flex 里 `flex-basis: 0%` 压过 `block-size`。原语现在带 `flex: none`，
   判据加在 `admin-console.spec.ts`（注入：去掉 `flex: none` ⇒ 红在「17 / 42 / 84 三档」）。
3. **别写第三份实现**：第一版我在 `packages/ui` 写了个 RN 渲染器 `Field.tsx`，零消费者 ——
   而移动端本来就有 `kit.TextField`。**判断归共享层，渲染器归各端 kit。**

**还欠的（不是本线的活）**：`pnpm check` 全链此刻仍被别线的存量红挡着
（`check:selection-single-source` 的 `ShareSpaceScreen.selfMemberId` 是**门禁词表缺一档**：
它既不是"当前看哪一条"也不是 5 类瞬态，而是从钥匙口取回来的"我是哪一行"；
另有 `check:empty-state` / `check:mobile-renew-shape` / `check:text-color` / `check:rn-aria`
与平台类红）。本线自己的闸门逐道绿。

### 并行轨道：全局 UX 分层整改 P0–P8（✅ 九批全部收口 2026-10-28；P6 意思表示层那两枚 2026-10-29 补迁完）

**一句话**：把"每个界面各画一套控件档位 / 各定一套关闭策略"收敛成**共享层一张表 + 各端一个渲染器**，
并且每一档都能被四档尺（源码尺 / 语义测 / 真浏览器 / 人看截图）各自判红。

| 事 | 落点（读数一律现量，别把这里当抄件） |
|---|---|
| 计划真身与逐批状态 | [`docs/plans/global-ux-system-remediation.md`](../plans/global-ux-system-remediation.md) §8 那张表（九行全 ✅，每行带完成证据） |
| 一份判断 | `packages/ui/src/control/states.ts`（色调 × 重量档）、`control/menu.ts`、`overlay/dismissal.ts`、`feedback/receipt-timing.ts`、`empty-state/model.ts` |
| 两端渲染 | Web `apps/web/src/styles/app/controls.css` + `lib/dialog/WebModalShell.tsx`；移动端 `apps/mobile/src/ui/kit.tsx`（薄壳，读同一张表） |
| 本线门禁 | `check:control-semantics` / `check:chip-typing` / `check:z-ladder` / `check:ux-coverage`（四档覆盖矩阵；族数与每族四档齐不齐**由脚本自己打印**，别在这里抄）；全部在 `check` 链上，`check:gate-wiring` 守这一条 |
| 真浏览器腿 | `e2e/tests/` 里本线那批 spec（本线清单在计划 §8 的 P8 行与四档台账那张表里；整套枚数现量看 `pnpm check:ux-coverage` 自己打印的那行），另加 `e2e/vault/conflict-dialog.spec.ts`（两台真设备真并发） |
| 设备腿 | `apps/mobile/evidence/global-ux-control-tiers-20261028/RESULT.md`（载体 `linux-dev`，装机语言要显式设 `zh-CN`） |

现量入口：`pnpm check:ux-coverage`（矩阵与门禁在不在链上）·
`grep -rn 'className="ht-btn"' apps/web/src --include='*.tsx' | wc -l`（裸档必须 0）·
`node scripts/check-chip-typing.mjs --self-test`（九枚臂，含"未知旗标必须拒跑"那一枚）。

**还欠的两格不是没做完，是外送口径**：`LegalReconfirmSheet` 的 Esc 该不该有反应、
`PrivacyConsentSheet` 的强制阅读档 —— 都是对外法律表征口径，按规矩归人拍，
逐格理由写在该计划 §8 的 P6 行末段。


### 仓库体积与远端（2026-10-25 收口，**不需要人工操作**）

**现状**：`gitee` 这个远端已经**拒绝一切推送**，原因不是这次的改动，是仓库本身超了它的配额：

```
remote: Repo size: 1209.512MB, exceeds quota 1024MB
remote: Push rejected for repository [size exceeds limit]
```

实测过：连一个**指向已存在提交**的空分支都被同样拒绝（`probe-*` → `probe-test`），
所以这不是"某一次 push 太大"，是仓库级的死锁。

**体积构成**（`git rev-list --objects --all` 的现量，按 blob 大小排）：
排在最前的是历史上被误提交的 `.pnpm-store/**`、`research/standalone/.npm-cache/**`
（单个 10–39 MB，几十枚），其次是证据目录里的构建日志与 Playwright `trace.zip`。
这些路径**今天都已在 `.gitignore` 里**，但历史里还在。

**当前的处理（不需要人工）**：

- `remote.pushDefault = origin`（GitHub）。⇒ 平时 `git push` 直接走 GitHub，
  不会再去撞 Gitee 的那面墙；
- `gitee` 远端**保留**（`git fetch gitee` 仍然可用），只是不再作为推送目标；
- 要恢复 Gitee 镜像，只有一条路：**在 Gitee 侧把仓库 GC 一次**（或让历史瘦身到 1 GB 以内
  后 force-push）。前者是对方的运维动作，后者要重写全部历史 —— 都不是 agent 能替它做的。

⚠️ 别把"push 成功"读成"两边同步了"：**GitHub 是唯一在推进的远端**。


### 注册 / 登录：移动端改用共享表单 + 一屏展开（2026-10-26 收口）

**起因**（产品负责人两句原话）：**「手机上的注册登录页面非常的混乱」**、
**「为什么我们现在的注册、登录竟然分为好几个页面？这太离谱了」**。

**根因不是样式，是两份实现**：Web 用 `@heyta/ui` 的 `AuthForm`（四端共用），
移动端 `AuthScreen.tsx` 自己又写了一整张表单（1088 行、`Animated` 出现 0 次）。
于是 Web 的布局与动效**从来没有到过手机**，而且一次登录被拆成四屏
（欢迎页 → 认证页 → 验证码 → 口令）。

**这一轮做了什么**

| 改动 | 判据 / 读数 |
|---|---|
| 移动端改用同一份 `AuthForm`（壳只剩宿主那一半） | `apps/mobile/tests/auth-screen-password.spec.ts` 35 条 + `auth-screen-shape.spec.ts` 9 条 |
| 欢迎页**一屏**：主视觉留存、认证**就地展开**（`<AuthScreen embedded>`） | `mobile-first-run-gate` 绿；J1「冷启动 ≤1 次点击到认证屏」 |
| 主视觉 `PlanHero`（自有 SVG + token，沿用 Web `AuthPlanScene` 的语言） | `check:design` / `check:l4` 绿（L4 73 处，未新增） |
| 出门动作清单从 5 条扩到 **10 条**（找回通行密钥、注册码确认/重发等新接入） | `privacy-consent-gate.spec.ts` 38 条 |
| `check:i18n-vars` 修好（`statSync` 跟随断链 ⇒ 整条门禁崩成一行栈） | `--self-test` 13 臂全过；正式跑 `缺参数=0` |
| `verify-mobile-auth.sh` 修好（过期文案、到不了的步骤、写死坐标、真机无 `10.0.2.2`） | 陷阱 §7 #618 / #619 |

**读数（本轮现量）**：移动端 vitest **93 文件 / 1190 条全绿**；`@heyta/mobile` typecheck 通过；
`check:design` / `check:l4` / `check:rn-aria` / `check:form-anatomy` / `check:text-color` /
`check:ux-coverage` / `check:control-semantics` / `check:i18n-vars` 全绿；
web 认证相关 5 个 spec **126 条**全绿（web 端一个字没改）。

**遗留（写在这里，不要以为已经做完）**

- `AuthForm` 仍是**一份组件的两份外壳**：Web 的 `AuthPanel` 是两栏品牌 + 表单，
  移动端是一屏内嵌。**表单本体**已经单源，**外壳**按平台各一份 —— 那是有意的
  （一屏与两栏是两种版面），但"外壳里有没有偷偷长回第二张表单"这条只能靠
  `auth-screen-shape.spec.ts` 的「壳里只有一个输入框」守着。
- 参考产品那套插画**没有**、也不该有：本轮主视觉是自己用 SVG 画的。
  真要做品牌插画，需要设计侧出素材并过 `check:image-license`。

#### 同一天的界面返工（产品负责人逐条指出，2026-10-26 晚）

| 原话 | 改动 | 判据 / 门禁 |
|---|---|---|
| 「导航上面怎么会有个上划线？把这个上划线去掉，只需要按钮变色」 | `TabBar` 删掉选中标签顶端的短指示条，选中只剩**颜色**（图标+文字同时变主色） | `check:design` / `check:l4` 绿；文件头的设计说明同步改写（不留"代码没有、注释还说有"） |
| 「分类应该是分类时长，应该把它改成统计」 | tab 标签 `分类 → 统计`（en `Categories → Stats`）；页内标题保留「分类时长」 | `check:ui-language`、`check:i18n-vars` 绿 |
| 「空状态也应该有良好的空状态……绝对不允许单屏全都是文字」 | 统计页空态从「图标 + 两行字」换成共享层矢量空态（`illustration="calendar"`，这一页画的是近 12 周时间分布） | 与任务/成长/共享三屏同一族；`packages/ui` 的 `StateIllustration` 是唯一来源 |
| 「tooltip 有点泛滥了……能凭 UX 和名字理解的就不要用」 | 删掉 **8 条**自解释 hint（设置/消息/安全/回收站/导入导出/AI 工具箱/成长/习惯/倒计时/分享/订阅），**保留 6 条讲后果的**（删号、反馈、锁屏小组件、设密码、找回通行密钥）。死字段 `hintKey` 一并删除，并改掉一条**假信号测试**（它原来在校验没人渲染的 tooltip 文案） | `check:settings-prose` 仍是 0 处；mobile 1190 条绿 |
| 「去掉所有说明文字，现在严禁有任何说明文字，除了必要的」 | 认证面删掉登录框上方那两句话与加密口令的长 hint；死词条 `mobile.auth.intro` 删除；判据改成"认证面不许有 subtitle" | `auth-screen-password.spec.ts` 35 条 |
| 「这里的 !1 是什么，要去掉吧」 | `!1`（优先级快捷写法）从 **4 处** placeholder 变体的中英里清掉；解析功能保留 | web `capture-composer` 22 条绿（`!1` 仍作为**输入**被测） |

### 首屏（WelcomeScreen）第三版：生成图 + 整屏动效（2026-10-26 深夜）

产品负责人连着给了四条方向，最后一条把前三条都推翻了，记下来免得再走回头路：

1. 「把注册登录放到最底部，背景作为动效，用滚动的动效展示各个功能」；
2. 「还是要有文字跟着动效走」——没有标题就不知道那张图是什么；
3. 「为什么是左右相同的内容在这儿滚动呢」——**两列并排跑马灯**被否掉（同一批卡左右各滚一遍，没有信息量）；
4. 「上下是割裂的……注册登录那个地方背景是完全黑色的……整个动效都应该作为背景图」。

**现在的形状**：柔光 + 当前功能的一张"应用画面"浮在中间偏上 + **底部六级平滑渐隐**
（0.06→0.72，每级 ≤0.15）+ 跟随画面的标题与圆点 + 浮在背景上的底部动作区。

🔴 **为什么上一版必然割裂**：那四张素材是**方形卡片图**，`cover` 铺到 9:19.5 只裁出
一块放大的局部，下半部本来就是空的 —— 无论加几段压暗，屏幕上都会出现"上半截有东西、
下半截纯黑"。真正的解法是**竖版整屏背景图**（主体在上 2/3、底部 1/3 自带渐隐）。

⚠️ 当晚生成路由中途断过一次（3 次 `Connection error`，只成功 1 张），
**后来恢复并补齐了全部四张**：1024×1792 → 900px JPEG（q72），四张合计 ~138 KB。
方形那批素材已删除，`provenance.json` 只记竖版这四张的提示词与后处理。
代码侧：整屏 `cover` 交叉淡入 + 整层极缓慢放大（Ken Burns），底部渐隐收到
**从 0 起**的六级（0→0.55），不再有横带。

**素材**：`assets/illustrations/onboarding/`（4 张 512px JPEG，共 77 KB，`provenance.json`
记着模型、路由、提示词与后处理；提示词硬约束"不许出现文字"——带字的图会在两种语言下同时错）。

### Web / 桌面：手机浏览器要落到移动版式（2026-10-26）

原来的窄屏档是 `@media (max-width: 30rem)`（480px），只覆盖竖屏小手机 ——
**横屏手机（844×390）、折叠屏外屏、部分 WebView 全都落进两栏桌面版**。

现在改成两条并集：`@media (max-width: 48rem), (pointer: coarse)`
（窄屏 **或** 粗指针），并在这一档里把品牌栏**整块隐藏**（移动端认证面本来就没有它；
上一版把它压成一条横带留在表单顶上，正是"上下割裂"的另一个来源）。
`(pointer: coarse)` 与 `AuthPanel` 里判断"口令要不要默认遮住"用的是同一条依据。

🔴 **顺带量到的问题（未改，留给下一轮）**：`apps/web/src` 里混着 **9 种断点**
（30/36/40/48/64rem 与 768/1023/1024px）。"整个项目做好响应式"的真障碍不是缺规则，
是**没有一把统一的尺**。要做的是先把断点收敛成 2–3 档写进 design-system 文档
（`@media` 用不了 CSS 变量，所以只能靠约定 + 门禁），再逐屏迁移。

### 设置页 IA 迁移：第一批落地（2026-10-27）

产品负责人：**「IA 必须马上迁移掉」「哪怕做得跟创业OS一模一样都可以」**。
这一批只做**移动端**（web / 「我的」页 / 文档并行交给子 Agent）。

**已落地**（`apps/mobile/src/screens/SettingsScreen.tsx`）：

| 改前（7 个"技术桶"） | 改后（7 个"用户意图"） |
|---|---|
| 个人资料 | **账号**（并入原「账号安全」：登录方式 / 会话 / 危险区） |
| 订阅 | 订阅 |
| 常规（5 种东西 4 种频率混装） | 拆成 **提醒与通知** / **外观与语言** / **关于与帮助** 三组 |
| 同步与隐私 | 并入 **数据与同步**（+ 导入导出、回收站） |
| AI 与集成 | **功能与 AI** |
| 数据管理 | 并入 **数据与同步** |
| 账号安全 | 并入 **账号** |

配套：`LEGACY_SECTION` 把旧 key（`profile`/`security`/`sync`/`general`/`ai`）映射到新组，
**深链与宿主不用改**；七组图标改成两两不同（原来三组共用两枚图标）。

**同时补掉一道在撒谎的门禁**：`check-settings-no-prose` 的第二臂（按文案长度）原来
**只跑 web**，而移动端设置面真实存在 15 段整句说明，门禁却打印"一句都没有"。
现在白名单扩到移动端设置面，**如实报出 15 处**，并开始逐条处置（问号气泡 / 删 / 标为反馈）。

### 设置页 IA 迁移：第二批 —— e2e 追平 + 两处「在错屏幕上通过」的假绿（2026-10-27 深夜）

第一批把三个端的分组改完了，**e2e 没跟着改**，于是四个文件还在点
`settings-group-sync` / `settings-group-account` —— 那两枚按钮已经不在左栏。
症状不是红，是**更坏的那种绿**（见下）。

| 件 | 落地 | 判据 |
|---|---|---|
| 两个逐组遍历的套件不再抄字面量 | `e2e/tests/helpers.ts` 新增 `SETTINGS_SLUGS`；`settings-category-ux` / `settings-row-grammar` 从它**派生**（后者原来写死 6 个 id，其中 2 个已失效） | 新门禁臂 2b |
| 旧后缀别名保留 | `LEGACY_SETTINGS_SLUGS`（`sync`→`data`、`account`→`profile`…）⇒ **33 处调用点一行没动**，语义仍是"我要操作同步那一块" | 臂 3 集合相等 |
| `e2e/vault/*` 三支 | `settings-group-sync` → `-data`（`sync-settings-panel` 现在住在 G3） | 8 条 vault 用例真跑（真 PG + 真服务端） |
| `widget-journey-host` | 「桌面小组件」已搬进 **G4 提醒与通知**，原来点的 `-appearance` 组还在、按钮也在 ⇒ 不报"找不到选择器"，红在下一行 | 4 条 widget 用例 |
| 新门禁 `check:e2e-settings-ids` | 左栏 ↔ 面板同集合 / e2e 只许引用**现行** id / 两个套件必须派生。**7 臂自检**（臂 0 阳性对照） | 进 `pnpm check` |

**跑起来才浮出来的两处（原清单里没有）**：

1. **`settings-row-grammar` 的 appearance 格：行距中位数 72（判据 44–56）**。
   外观组把整层 `.ht-settings`（页面级容器，`gap: space-4`）当行组用 ⇒ 四行之间各多
   16px 空隙；同时分段控件四边内缩把轨道撑到 52（比别的组的 44 高一档）。
   ⇒ 修内容不修阈值：`.ht-settings__rows { gap: 0 }` + 轨道 `padding: 0 var(--ht-space-1)`。
   改后 **heights `[44]` 单档 / 中位 53 / 左缘 441 不变**。
2. **`e2e/vault/ai-egress`**：① `AiBreakdown` 已搬进**任务详情的自动化槽**（要有
   `selectedTaskId`），行里再也不会有那枚按钮；② 披露字段一直是 `today、title`
   （日历锚点，不写模型会瞎填日期），断言停在 `title`。
   ⇒ ① 先点 `task-row-` 选中再点 `ai-breakdown-`；② 期望改 `today、title`，
   用户消息改判「首行是锚点 + 末行逐字标题」，**`forbidden` 那一串密文/密钥判据一条没动**。

**读数**：主套件 **13 条全过 / 35.2s**（独占机器时；同一批在有 `pnpm -r build` 并跑时
要 6 分钟且出一条 flaky —— 那条 flaky 就是 #634 第 3 条）；vault **8 条全过**；
web 侧与本次改动相关的 5 个 spec **66/66**（`--testTimeout=60000`）。

⚠️ **全量 `pnpm --filter @heyta/web test` 在本机是红的（154–210 条
`Test timed out in 5000ms`），与本次改动无关** —— 根因是 vitest 没开 transform 缓存，
每次重转译整棵树，5s 上限不够。取证与处置见陷阱 **#634**（含"不要用改上限来消红"）。

### 🔴 未完成：真机旅程的第二段

`scripts/verify-mobile-auth.sh` 已在真机上跑到：

- 0 装包冷启动 ✅ / 0.5 首启隐私同意 ✅（G-11）/ 1 J1「1 次点击到认证屏」✅

**设置路径那一段（填服务端地址 → 登录 → 会话 → 加密口令 → 同步）没有跑通**，
原因是设备中途断开（`adb: no devices/emulators found`）。这一轮已按下述三处修脚本，
但**修完还没在设备上验过**：

1. 进设置前必须先点「我的」，且按 `tab-profile` 的 **testID** 定位 ——
   标签栏的 `content-desc` 在部分机型上会被合成（`"我的, …"`），`xy_desc` 是精确匹配；
2. 服务端地址必须**先填在设置表单里**再进认证屏：认证屏自己按 `serverUrl` 判
   `centralMode`，初值还是官方 origin 时它渲染「使用统一身份登录」，**邮箱表单根本不存在**；
3. 同意项改按 `mobile-auth-form-terms` 的 testID 点（按文案点有概率点到旁边的说明文字，
   "勾了但没勾上"，下一步提交被本地拦住，而日志只会说"没进入验证码阶段"）。

⇒ **下一次设备接回来（解锁、`svc power stayon true`、`adb reverse tcp:3210 tcp:3210`）要跑的就是这一段。**

**这一轮补上的静态闸**：`pnpm check:mobile-e2e-labels`（已挂进 `pnpm check` 链，
判据在 `scripts/check-mobile-e2e-labels.mjs`）。它把**所有** `verify-mobile-*.sh` 里的
界面锚点与真源逐字比对：`L_*`（含中文的文案）必须逐字出现在 `zh-CN.ts` 的某个值里；
`ID_*`（testID）必须指向真实存在的 testID（支持共享层合成的
「字面量前缀 + 模板后缀」，例如 `mobile-auth-form` + `-submit`）。
现量：**41 个脚本 / 19 个锚点，全绿**；`--self-test` 4 枚臂（过期文案必红、
现存文案不红、改名 testID 必红、现存 testID 不红）。

它存在的理由就是这次那条事故：脚本里那句服务条款原文一年前就改掉了，
而**没有任何检查盯着脚本与词条表之间**，于是它从没绿过，报出来还像产品坏了。

**2026-10-27 凌晨：设备侧跑通了认证那一段（第 0–5 步全绿）**

真机被拿走后换了载体：用 `linux-dev` 上的 `heyta_boot_api36` 模拟器，通过两条隧道接回本机
（`ssh -L 5556 → adb 5555`、`ssh -R 3210 → 本机服务端`），APK / 脚本 / 服务端 / 数据库
**都留在本机**，只借它的模拟器。读数：

| 步 | 判据 | 结果 |
|---|---|---|
| 0 | 装包冷启动 | ✅ |
| 0.5 | 首启隐私同意（G-11）+ 点「同意并联网」 | ✅ |
| 1 | J1：冷启动 0 击可见入口、**1 次点击**到认证屏 | ✅ |
| 1.5 | 设置→同步：填服务端地址 → 进自托管档的**邮箱表单** | ✅ |
| 2 | A4：未勾同意 → **本地拦住** + 服务端**没建号** | ✅ |
| 3 | 勾同意 + 两次密码 → 注册请求出门 → **「验证邮箱」阶段** | ✅ |
| 4 | 邮箱+口令登录 → **已登录** → 加密口令 → 保存并启用同步 → **回到主界面** | ✅ |
| 5 | 令牌真的落进同步配置（281 字符，且**不是**手填的建号令牌） | ✅ |
| 6 | 另一台设备读到手机建的任务 | ✅（**第 1 轮**就读到） |
| 7 | force-stop 后再启动不重复征求、欢迎页不回来 | ✅ |

**最终读数：通过 41 项，失败 0 项。**

同一轮的**四端门禁读数**（全部真跑）：

| 面 | 读数 |
|---|---|
| 设备腿 `verify-mobile-auth.sh` | **41 通过 / 0 失败**（第 0–7 步全绿，第 6 步第 1 轮就读到） |
| 移动端 vitest | **94 文件 / 1202 条** |
| Web vitest | **223 文件 / 2711 条**（2 文件 skip；此前那条 `local-data-destruction` 撞悬空软链的红已消失） |
| 共享层 `@heyta/ui` | **55 文件 / 825 条** |
| 词表 `@heyta/i18n` | **4 文件 / 30 条** |
| typecheck | `apps/mobile` / `apps/web` 均 0 错 |
| 门禁 | `check:design` / `check:l4` / `check:rn-aria` / `check:form-anatomy` / `check:i18n-vars` / `check:breakpoints` / `check:mobile-e2e-labels` / `check:gate-wiring` 全绿 |


**第 6 步红过两次，两次都不是"同步协议坏了"**

1. 先修掉一个**环境**真因：E2E 库 `heyta_mobile_smoke` 落后于代码，服务端在 sync 里抛
   `The column user_sync_state.payload_mode does not exist` ⇒ 手机的 op 一条都没上去。
   用仓库自己的 `server/scripts/migrate-deploy.sh` 补迁移后 `latestSeq` 从 0 变 1（陷阱 #632）。
2. 迁移之后仍红。最小复现：**同一个探针库里放 2 条 op（1 条远端 `CRT_TASK` + 1 条本地 `add`），
   `list --all` 只列出本地那条**。远端那条在 `ops` 表里 `applyStatus=applied`、
   `payload` 与本地逐字同形（`{"title":…,"priority":0}`）、`lastServerSeq=1`，
   但它没进投影（`ctx.getState().tasks` 里没有它）。
3. 继续挖到**最后一个真因**：远端 op 的 `payload` 落盘后是**字符串**，本地 op 是**对象**，
   reducer 拿到字符串自然物化不出任务。而 `packages/sync-client/src/client.ts:750` 那段
   **早就写好了**这条修复（把明文 payload `JSON.parse` 回对象，注释写着由
   `plain-payload-mode.spec.ts` 抓出来）。
   ⇒ 真正的原因是 **`apps/node-host/dist` 比源码旧** —— 探针跑的是产物，不是源码。
   `pnpm --filter "@heyta/node-host..." build` 重建之后，同一条 op 立刻物化成功
   （`tasks: ['auth-e2e-025651']`），整条旅程随之全绿。
   **这就是陷阱 #615 那一族**（"改了 `packages/*` 不 build，读的是旧产物"），
   只不过这次踩它的不是门禁，是**验收载体**。

这一轮修掉的**脚本侧**六处（都登记进了陷阱账本）：中文锚点 × 英文模拟器（#624）、
`adb reverse` 重启即失效（#625，脚本现在自己建）、无限循环动画毁掉 `uiautomator dump`（#626）、
`EXIT` trap 覆盖共享库的 `restore_ime`、`settings-section-sync` 落在折叠线以下、
系统"保存密码"弹窗偷走一击。

第二轮又补了两臂（`--self-test` 从 4 枚涨到 **6 枚**）：

- **引用了但没定义**的锚点 ⇒ 红。最典型的半截改名（把 `L_PASSWORD` 改成
  `L_LOGIN_PASSWORD`，只改引用没改定义）：它在 shell 里展开成**空串**，
  `xy_desc ""` 返回第一个节点 ⇒ 点下去的是别的东西，日志只说"没反应"。
  锚点的定义允许来自 `scripts/lib/*.sh`（脚本会 source 它们），所以不会误报。
- 覆盖面因此从 **19 个锚点涨到 41 个**（41 个脚本全绿）。
在那之前，移动端这些界面改动只有单测与门禁作证，**没有真机截图**。

---

## 界面控件预算（2026-11-02）：页头 9 件 → 3 件，动作搬出列表体

产品负责人拿滴答的桌面对照图逐屏比完之后的一句裁决：
「把所有这种铺开式组件全都删掉，全都收拢进来」。**计划与全部读数**：
[`surface-budget.md`](../plans/surface-budget.md)。

先用读数否证了"是不是设计系统不够全"这个猜想：`apps/web` 132 处字号声明**全部**是 token、
裸 px **0 处**、裸 hex **0 处**（CSS 与 TSX 都是 0）。**词表是满分的** ——
病灶是"没有一条门禁在量**件数**"：每加一个功能页头长一寸，而几何/对比度/行距全都合规。

三件事：

1. **页头**：9 件（分享 / 选择任务 / 批量完成 / 重复警告 / 撤销 / 排序标签+原生下拉 /
   助手 / 详情开关）→ **3 件**（助手图标 / 一枚 `⋯` / 详情开关）。排序三档、
   「选择任务」、共享入口都进了 `⋯`；批量栏改成**模式态**（不选任务时页面上没有它）。
2. **列表体**：「AI 排优先级」搬进对话助手正文顶端的新插槽 `orgActions`
   （常驻，不是空态的一部分）—— 产品负责人的原话是"应该直接在对话助手里面有"，
   上一版只搬了 `AiBreakdown` 并写注释为它辩护，这一版兑现。
3. **字号层级**：`row-title` 400→**500**、`row-meta` 14→**12**（比值 1.14 → 1.33）。
   判据改钉**关系**（≥1.33）而不是某个像素值。

新门禁 `check:surface-budget`（7 臂 + 阳性对照）进 `pnpm check`：判**源码形状**
（页头只有一枚 `⋯`、非模式段没有 `<select>`/`<label>`、排序不许以常驻控件形状回来、
`<AiPrioritize` 只许在助手槽里）。渲染层那两道判据仍在，两道一起改坏要付两次代价。

顺带做了两件去重与两件修尺（都不在本轮清单里，是跑测试时才浮出来的）：
`AnchoredMenu` 把"门户 + 定位 + 点外面关"收成唯一一份（键盘本来就有唯一一份）、
`TaskRowMenu` 的手写键盘（仓里**第四份**）接回 `useMenuKeyboard`；
`apps/landing` 的页头对账锚点从整串 JSX 改成 `className="..."`（排版一变就断）、
`packages/ui` 的目录遍历改用 `Dirent` 不跟符号链接（陷阱 #635 那一族的第二例）。

读数：`apps/web` **223 文件 / 2714 通过**、`apps/landing` **1455 通过**、
`design-system` **546 通过**（含新增的 1.33 关系判据）、`packages/ui` **825 通过**。
