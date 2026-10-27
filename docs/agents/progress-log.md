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

### 并行轨道：协作与共享清单（🟡 **M2 已收尾并进 `main`（2026-10-23，读数在本线计划 §9.11）；同日 M4 逐 op 签名已落地（读数 §9.12）；M5 三格 + M6 移动端接入已落地并**有设备腿读数**（2026-10-26，逐格读数和逐张看过的截图指针在本线计划 §9.14 —— 那条腿判的是"手机和 web 一样真的能用"这一整句，复量命令是 `pnpm verify:mobile-collab:ios`；**所有者那一侧也在设备上走过了**（2026-10-26 第 35 跑 L7：手机自己建清单 → 设为共享 → 签发邀请 → 服务端认 `role=owner` 且所有者行带签名公钥 → 撤销，读数在同一节「第 35 跑新增的两格」那张表））**；**「收得到实时信号并按本机偏好打扰用户」那一半在 2026-10-26 第九批才真正接上消费面**（此前投递有生产者、界面无消费者）：通知中心第三档「共享动态」+ 入口徽标相加 + 设备腿 L8 两半相反，读数在 §9.15；同日第 39 跑再补 L9（便签那一族的下行）⇒ **三族的下行在设备上都有读数**（`56 通过 / 0 失败`）。还欠的是 Android 那一侧的界面腿（载体**半装**（`adb` 与一枚 AVD 在、缺 `Sdk\emulator` 主程序、无真机接入），不是没排期；三条取法与归属写在 §9.14 那一格（2026-10-27 把原先那句「载体不存在」按现量改准））与两格归产品负责人的取向题（同一张表）；✅ **那句「三族与另一台设备双向同步」到 2026-10-27 第十批在手机上补齐**：新建时的落点控件（`CaptureComposer` 的 `projectPicker`，默认收集箱、选中才交 `projectId`）接在任务面板与便签板上，设备腿 **L10**（任务）/**L11**（便签）各判到 owner 侧从共享日志读回并验签，两族各配一枚变异臂（任务那一族退化成"丢掉落点"⇒ 整链只有 L10 红；便签那一族把宿主那行退化成永远交 `{}` ⇒ 只有 L11 红）⇒ 形状、判据与逐趟读数在 §9.16。⚠️ 这一整段里那些"多少通过"的读数各自只代表**它自己那一跑起建的那枚提交**；最新一趟在 §9.24（第 52 跑，起建 `0cdaf8fdf`）。🔴 台账里**没有"当前产物的设备腿读数"这一档**，只有带戳的读数 —— 要把带戳的读数用到此刻的树上，跑 §9.24 末尾那把两端钉死的差集命令自己量（原因与教训见环境陷阱 #600）。🔴 **还开着的是相邻那一格**：把一条**已有**便签挪进别的清单（`setNoteProject`）在两壳仍零调用点（现量 `git grep -n setNoteProject -- 'apps/**/src/**' 'packages/**/src/**'` ⇒ 只剩接口声明与实现两处） —— 那是"事后改归属"，别拿 §9.16 的绿读成它做完；四端重装 2026-10-22 15:0x 已跑绿，读数在本计划 14:5x/15:0x 两节；✅ **六段的变异臂到 2026-10-27 第十一批补齐**——同意闸三层那副四臂首跑零漂移（读数在计划 §9.18–§9.19，收口对账表在 §9.17：按任务书的措辞下探针会打空，要按表里的真落点取）；⚠️ `main` 上整条 `pnpm check` 到 2026-10-27 14:3x 那趟只剩**一枚**红，落在 `apps/web` 的 `task-sort` 批量选择那一格（归 `apps/web` 那条线，本线只登记不替它定性；读数与现量命令在同一计划 §9 末尾那几节（节号每次现量：`grep -nE '^#{3,4} (§)?9\.[0-9]+' docs/plans/collaboration-shared-lists.md | tail -1`））

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
