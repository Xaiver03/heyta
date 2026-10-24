<!-- 由 heyta/AGENTS.md 按作用域拆分而来（2026-10-12）。内容零删除。
     本文件是「常用命令」的完整规则（原文 §6 常用命令）。返回入口：[`AGENTS.md`](../../AGENTS.md)。
     原始单体文件备份：`AGENTS.md.bak-full-2026-10-12`。 -->

## 6. 常用命令

```bash
pnpm install                    # 安装（工作区）
pnpm -r build                   # 全量构建
pnpm -r typecheck               # 全量类型检查。⚠️ 它**不会先 build** —— 改过 `packages/i18n` 的词条要先
                                #    `pnpm --filter @heyta/i18n build`，否则各壳会红在"这个键不存在"
                                #    （红因是陈旧的 `dist/*.d.ts`，不是代码：见 §7 #514）
pnpm -r test                    # 全量测试。⚠️ **条数不写在这里**（这里曾写"2592 个通过 + 12 个跳过"，
                                #    那是会漂的值 —— 与 §7 开头"本文件不写条数"同一个理由）。
                                #    取现量：逐包的 `Tests  N passed (N)` 汇总行相加；跳过看 `N passed | M skipped`。
                                # 🔴 收尾必须对一次数：**有 `test` 脚本的包数 == 打了 `Tests` 汇总行的包数**。
                                #    不相等就说明有一层从来没被跑过，而 `pnpm -r` 的 rc=0 不会告诉你
                                #    （2026-10-05 实测：19 个包有 test 脚本、19 行汇总，这才敢说没漏层）。
                                # ⚠️ 沙箱里跑不了 `@heyta/sync-server`（`prisma generate` EPERM），
                                #    用 `pnpm -r --filter '!@heyta/sync-server' test` 复现其余各包。
                                #    🔴 **这一档是瞬时属性，每次收口重新现量，别沿用这句结论**。
                                #    2026-10-11 实测：`pnpm --filter @heyta/sync-server test` **rc=0（158 文件全过）**——
                                #    那条 EPERM 只在生成物尚未落盘的窗口出现，client 一旦生成 `pretest` 就是 no-op。
                                #    只有**当场真的跑不动**才用上面那个 `--filter` 摘层，且必须如实记"那一层没测"
                                #    （否则对数审计的分母自己就是错的，见 §7 第 408 条）。
                                # 🔴 那条 `--filter` 有两种读数都不指向被测命令：**包名写错**（真名带 `sync-` 前缀）
                                #    时它打一行 `No projects matched the filters` 然后**退 0**（假绿）；
                                #    包存在但**没有该 script** 时打 `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` **退 1**
                                #    （假红 —— `@heyta/sync-server` 根本没有 `typecheck` 这一步）。

pnpm verify:sync                # P0 验收：真实同步闭环（需要服务端在跑）
pnpm verify:sync:dry            # 不需要服务端，只校验 op 形状
pnpm verify:p1                  # P1 验收：**自带真实服务端**，跑零 mock 的端到端同步（11 条）
pnpm verify:p2                  # P2 验收：**自带真实服务端**，非 Web 壳（Node+SQLite）真实读写+同步

# 协作 / 共享清单线（ADR-0062）—— 五套验收，两种载具
pnpm verify:collab-keys         # 密钥协议闭环（真 WebCrypto + 真构建产物，零服务端，实测 0.3s）
                                #   🔴 它**已在 `pnpm check` 链里**，这里列一次是让人知道它在
pnpm verify:collab-suite        # 那四套**要真 PostgreSQL / 真浏览器**的按序跑一遍
                                #   （sync / revoke / conflict / journey；串行，一次一条）
                                #   每套验收必须有载具（进链 或 进上面那四名册），
                                #   判据在 scripts/check-collab-carrier.mjs —— 加验收不加载具会红

# 真浏览器验收（Playwright）。⚠️ 它在 `e2e/` 里，**刻意不在根 pnpm 工作区内**
#   （理由见 `e2e/pnpm-workspace.yaml`，别把它的依赖并回根 lockfile）。
#   依赖要单独装：`cd e2e && pnpm install`（它自己一份 lockfile）
pnpm check:ai-e2e               # 跑整个 e2e 套件（起 vite dev + 假端点，零 mock）
                                #   激励体系的设计契约：e2e/tests/motivation.spec.ts（6 条）

# 移动端验收：真模拟器（emulator-5554）+ 真服务端 + 真笔记本设备（node-host），全部零 mock
pnpm verify:mobile-edit         # 任务可编辑（截止时间/优先级/重命名/删除）
pnpm verify:mobile-conflict     # 冲突解决闭环（真的造出并发冲突，再在界面上解决）
pnpm verify:mobile-autosync     # 🔴 自动同步：**全程不点任何同步按钮**，建一条任务
                                #   也必须自己出去（判据 a：服务端日志出现请求；
                                #   判据 b：另一台设备读到那条任务）。见 §7 第 66 条
pnpm verify:mobile-focus        # 专注（番茄钟）闭环
pnpm verify:mobile-calendar     # 日历（判断的期望值来自宿主机的 Python，不是本仓库的日历代码）
pnpm verify:mobile-repeat       # 重复任务（设规则 → 同步 → 勾选顺延 → 反向再从笔记本完成；六个预设含「每年」，第 15 步专测跨年那一档）
pnpm verify:mobile-organizer-confirm
                                # 归档/移除确认框（3 处）在真模拟器上"会先问"。⚠️ 它**离线**：不起服务端，
                                #   所以故意**没**登记进 `scripts/check-journey-coverage.mjs` 那张表 ——
                                #   那张表的纳入条件第 ② 条要求"真服务端 + 零 mock"，它不满足

# iOS 验收：真 iPhone 17 Pro 模拟器 + 真服务端 + 真笔记本设备。
# 走 AX 树点击（不依赖窗口 z-order / 焦点，见 §7 第 34 条）
pnpm verify:mobile-ios          # iOS 输入侧全链路：点 FAB → 输入 → 提交 → op 落库 → 同步到另一台设备
                                # **并含「零点击自动同步」**（第 6 步：凭据配好后再写一条，一下都不点）
                                #   §1.0 会先验"无障碍树有没有内容"；为空则**自动重启模拟器**自愈
                                #   （见 §7 第 63 条）。变异复现（验证那条自愈真的会触发）：
                                #   cd scripts && HEYTA_IOS_FORCE_AX_EMPTY=1 bash verify-mobile-ios.sh
pnpm verify:ios-lan-http        # iOS 连**私有 IP 字面量**（自建服务器）的明文 HTTP 可用性
                                #   三个地址单变量对照：错端口 / 错 IP 都失败，真 LAN 地址成功
                                #   ⚠️ 需要 Simulator 窗口在**当前 Space**（见 §7 第 37 条）
pnpm verify:mobile-collab:ios   # 🔴 共享清单在**手机上**是不是真的能用（M6 那条旅程的验收载体）
                                #   真 Release 包 + 真 iPhone 模拟器 + 真服务端（TEST_MODE，零 mock），
                                #   "另一台设备"那侧是同仓的生产装配件（`scripts/lib/collab-owner-step.mjs`
                                #   里的 `createShareOpDispatcher`），不是手搓 HTTP。六档判据：
                                #   L1 手机走自己的界面加入（贴凭证→同意→界面自己说「加入成功」）；
                                #   L2 owner 写的任务在手机上**不点同步**就出现；
                                #   L3 手机发评论→这条评论回到界面上；
                                #   L4 🔴 owner 把手机那行写回的 op 下载回来、用名册公钥重验 = `verified`
                                #      （服务端"收下了"不算 —— ADR-0069 那句承诺要在移动端也成立）；
                                #   L5 owner 再写一条→手机靠 `new_share_ops` 自己重画（全程没碰同步按钮）；
                                #   L6 通知偏好面只有活动那三档（没有输入的档位不许画）。
                                #   每档都留截图（失败也留）在 `apps/mobile/evidence/collab-ios-<戳>/`；
                                #   Release 产物与 DerivedData 住临时目录，收尾删。
                                #   凭据那一侧走的是**登录**那条规定路径（同族装置 `sign_in_with_password`）：
                                #     自托管表单 →「注册 / 登录」→ AuthScreen 填地址/邮箱/登录密码 →
                                #     「用邮箱和密码登录」→ 会话卡之后**才有**「加密口令」栏 →「保存并启用同步」。
                                #   ⚠️ 全新设备上 AuthScreen 默认落在「统一身份登录」那一档（`centralMode`），
                                #     那一代整段不渲染邮箱/地址两栏 ⇒ 装置先按「使用自建服务端」切档再填。
                                #   ⚠️ 登录之后还有一步**必须做**：设置 → 账号安全 → 创建「加密数据钥匙」。
                                #     同步读的密文来自 `readVaultSession()`（`host.ts:609`），**不是**
                                #     `readSyncConfig().password` ⇒ 只在 AuthScreen 填口令，界面会一直停在
                                #     「还没设置端到端加密口令」（2026-10-25 第 10/11 跑实测）。
                                #   ⚠️ 它开头有一道**并行闸**：读到别的 `verify-mobile-*` 在跑就退 3，
                                #     不跟别人抢同一台模拟器（两趟设备腿互相拆现场时红都归错人）。
                                #   退出码：0 全绿 / 1 有判据红 / 3 **前提不成立**（装置问题，别照着改产品）。
                                #   已登记进 `scripts/check-journey-coverage.mjs` 那张表（真设备 + 真服务端）。
pnpm verify:mobile-ios-subscription
                                # 移动端「订阅」独立一节 + `?` 气泡的**设备读数**（无头模拟器，零服务端）
                                #   四条判据全读 AX 树：①设置目录里 `profile-entry-subscription` 到得了
                                #   ②hint 默认**不在**树上 ③点 `?` 展开、再点收起（自校准 x 偏移，
                                #   11 个候选逐个试，都不成才红）④订阅页有 lead/两档标价/CTA/脚注，
                                #   未登录按下说「先登录你的 heyta 账号，才能下单。」
                                #   证据图落 `apps/mobile/evidence/subscription-<日期>/`
                                #   ⚠️ 它**不**证明"能买到"：真下单要真服务端 + 真账号
                                #   （那两条各有自己的腿：renew-sellable / verify:mobile-ios）
                                #   🔴 它存在的理由：`check:settings-prose` 只扫**调用点**，
                                #   把 `SettingsRow` 里的 hint 改成 `<Text>` 直出时它照样绿 ——
                                #   2026-10-24 实测过这条缝，只有这条设备腿抓到了。
                                #   零成本的那一道是 `packages/ui/tests/settings-hint-through-tip.spec.ts`
pnpm verify:android-subscription
                                # 同一件事的 **Android 载具**（远端 `linux-dev` 上的 headless 模拟器）
                                #   `uiautomator dump` 给每个节点 `resource-id` + `bounds` ⇒ `?` 是**独立节点**
                                #   （`<row-testID>-tip`），点它中心即可，**不用猜坐标**（比 iOS 那版硬）
                                #   ⚠️ 远端宿主与 SDK 路径走 `ANDROID_HOST` / `ANDROID_SDK_ON_HOST`
                                #   ⚠️ 界面语言由**这个包**的 per-app locale 决定（本镜像系统 locale 是 en-US）：
                                #      `adb shell cmd locale set-app-locales com.heyta --locales zh-CN`
                                #   ⚠️ 同样**不**证明"能买到"

# 鸿蒙验收：用 DevEco **自带**的工具链（cmake/ninja/ohpm/hvigorw 都不在 PATH 上）
pnpm verify:harmony-toolchain   # 工具链 → 最小 ArkTS 工程 → 真 HAP（17 项）
pnpm verify:harmony-rnoh        # RNOH 原生侧 → 37MB HAP（含 librnoh_core/app/reactnative.so，17 项）
                                #   ⚠️ 只到"原生编得出包"，JS 侧用桩（见下一条）
pnpm verify:harmony-rnoh-js     # 鸿蒙 JS 侧全链路（零桩）：真 codegen + 真 autolinking
                                #   + Metro/Hermes bundle（验魔数）+ 20MB release HAP（含 hbc）
                                #   ⚠️ 只到"编得出包"：不验运行（缺模拟器镜像+签名）
                                #   需要 Node ≥ 20.12（DevEco 自带的 18 会报 styleText，见 §7 第 59 条）

pnpm check                      # 全部门禁 + **全量单元测试**：类型 + 迁移 + 分层 + 界面文案 + 许可证 + 文档 + 设计变量 + iOS 原生依赖 + `pnpm -r test`
                                # 🔴 **2026-10-16 实测：这条链当天停在第 6 步**（对账件 **B22**）——
                                #    `check` 是 `&&` 串联的一串步骤，**遇到第一处红就停**；
                                #    当日停在第 6 步 `check:reachability` ⇒ 它后面的每一步一次都不跑，
                                #    其中包含 `pnpm -r test` 与 `check:payment-entry`。
                                #    ⇒ **别把 `pnpm check` 绿读成「全部门禁都过了」**：那天它连单测都没跑到。
                                #    想验某一道：单独敲 `pnpm check:<名字>`；想跑单测：`pnpm -r test`。
                                # ⚠️ 步数与每一步的**位序**都会随门禁增删漂，所以这里不存数字。
                                #    要读数就跑：`node -e "const s=require('./package.json').scripts.check.split(' && ');console.log(s.length)"`
                                #    （`check:gate-wiring` 钉的是"定义过的门禁必须真的在链里"，不是位序。）
                                # 🔴 末尾的 `pnpm -r test` 是后补的：在此之前 `check` **不跑任何单元测试**，
                                #    于是 `apps/web` 的测试套件红了很久都没有任何东西会失败（原因见下）。
pnpm check:checkout-tier-gates  # 收银台两道新闸门（②′ "这台实例交付得了吗"、④′ "不许把已付费的能力判小"）
                                #   的**变异验证**：逐臂把 `server/src/billing/checkout.routes.ts` 改坏，
                                #   要求 `server/tests/billing-checkout.routes.spec.ts` 里**具名**用例变红。
                                #   它存在是因为"拒单"这类判据坏得最安静的形状就是**整段被删掉**：
                                #   没有一条用例会为"我少了一条判据"报错，只有一批 409 悄悄变成 200。
                                #   臂数由脚本自己打印；红集合读 vitest 的 json reporter，不解析彩色输出。
                                #   同族先例：`check:op-log-semantics`、`check:egress-wording`。
pnpm doctor:billing             # 🔴 **这台实例到底能卖什么**（只读：不发请求、不碰库）。
                                #   打印解析后的配置事实（支付中心 / 托管 AI 上游在不在）、
                                #   真的注册成功的收款通道、以及每个 SKU 按闸门顺序先撞上哪一道。
                                #   它**不**重新判断"能不能卖" —— 那是 `checkout.routes.ts` 的闸门，
                                #   写第二份一定会漂；这里只把运营看不见的那几格事实摊开。
                                #   在容器里看**实际生效**的那份：`docker compose exec server npm run doctor:billing:dist`
                                #   （`doctor:billing` 会先 `tsc` —— `ts-node` 解析不了源码里 `./x.js` 那种后缀；
                                #   而运行镜像按 `npm pkg delete devDependencies` 构建，容器里没有 ts-node）。
                                #   `--strict` 时有档卖不了就退 1（部署前自检用）。
                                #   由来：产品负责人 2026-10-24 按下 ¥12 拿到「这一档现在还不能卖」，
                                #   问的是"现在不应该接了中央支付吗？" —— 收款确实已走支付中心，
                                #   挡住那一单的是 ②′（这台实例没配托管 AI 上游）。
pnpm check:mobile-renew-shape   # 移动壳续费那一屏的**形状判据**的变异验证（`apps/mobile/tests/renew-entry.spec.ts`
                                #   全是源码正则，没有 render 载体 —— 这类断言最阴的坏法是被**注释**满足、
                                #   或写成恒真，所以四条臂各注入一次真实坏法：删同意闸门 / 壳里抄 priceId /
                                #   屏上写死 `¥` 金额 / 把 `web.*` 键读进移动壳）。
                                #   与上一条的分工：那套管"服务端该不该卖"，这套管"壳有没有自己抄一份收银台"。
pnpm check:settings-prose       # **设置界面禁止内联说明文字**（2026-10-24 产品负责人的禁令）。
                                #   账本制：账本外新增 / 某文件读数涨了 / 掉了却没改账本，三种都红。
                                #   账本 `scripts/settings-prose-ledger.json`；清理时
                                #   `node scripts/check-settings-no-prose.mjs --update`（只许变小）。
                                #   例外只有三种：反馈（alert/aria-live/danger）、
                                #   ADR-0054 §7 的出境披露（`data-settings-disclosure`）、
                                #   「个人资料」概览那一句副句。规则正文在 design-system.md。
pnpm check:design               # 只跑设计变量硬编码检查
pnpm check:layering             # 只跑分层边界检查（apps/* 不得重新长出业务/接线）
pnpm check:ui-language          # 界面文案必须全是中文（见 §5）
pnpm check:android-widget-copy-parity
                                # Android 小组件那批 `widget_*` 原生资源的中英两表对账：键集合相等 +
                                #   英文表不许残留中文。它存在是因为小组件的文字**不走 `packages/i18n`**
                                #   （原生 `Context` 渲染），所以上面那条和词条对账都摸不到它。
                                #   三条判据各自的注入臂写在脚本头部，实测 `A/B/C_RC=1`。
pnpm check:adr-numbering        # ADR 编号唯一 + 裸写的 `ADR-NNNN` 只指向一枚文件
                                #   🔴 它挡的是 2026-10-05 那次"两条会话同一天各占 0053"：
                                #      文件名不同 ⇒ git 不报冲突，死链检查也不报（链接各指各的），
                                #      而正文里的 `ADR-0053 §5 第 11 条` 从此有两种读法。
pnpm check:tokens               # 原生 token 产物（Swift/ArkTS/JSON/RN）是否与 tokens.css 同步
pnpm check:arkts                # 用**真 ArkTS 编译器**编译生成的 .ets 产物
pnpm check:native-deps          # iOS 原生依赖对账（package.json ↔ Podfile.lock，见 §7 第 32 条）

# ── 🔴 "这些检查真的会失败吗" —— 故障注入验证器 ────────────────────────────
#
# AGENTS §8.3：「测试要能失败……不能失败的检查没有价值」。这一条把那句话变成**可复跑**的：
# 逐个把被测的东西改坏一处，断言对应检查**真的变红**，再改回去。**离线、确定性，约 141 秒。**
#
# ⚠️ **它不在 `pnpm check` 链里** —— 进不进链是"链耗时 vs 保护强度"的取舍（实测 +141 秒），
#    那个决定还没做。在那之前，**它只能靠你记得敲**；改过任何门禁之后尤其该敲一次。
#    对账件把这条记在 `docs/plans/launch-blockers.md` 的 B13。
pnpm verify:i18n-failures        # 全跑：14 组 / 117 个用例（2026-10-16 修到 117/117 全绿）
pnpm verify:i18n-failures pricing # 只跑一组（组名见脚本里的 `GROUPS`）
#
# 🔴 两种 ❌ 不是一回事，别混读（脚本的总结里也这么写）：
#   · 退出码 **0** ⇒ 变异注进去了、检查**照样绿** ⇒ **这条检查没有在保护它声称保护的东西**
#   · 退出码 **-1** ⇒ **探针自己抛了异常**（锚点失效 / 锚点不唯一）⇒ 这一条**没有被证明**，
#     但**不能**读成"检查坏了"。2026-10-16 实测过一次反向的例子：同一条检查手工变异会让 8 条测试红，
#     而探针报的是 ❌ —— 因为它的锚点撞上了**注释**（`String.replace` 只替第一处）。
#     ⇒ 所以 `withMutation` 现在要求**锚点唯一**，不唯一就响亮失败。

# ── 构建残留清理（`/tmp` 里 heyta 的中间物） ──────────────────────────────
# 各验收/重装装置把 iOS 派生数据、macOS 分发目录、跨机源码包、归档产物写在 `/tmp`，
# 路径**各自有旋钮**（HEYTA_REINSTALL_TMP_DIR / HEYTA_IOS_DERIVED / HEYTA_MACOS_DIST_DIR），
# 但默认值都指向共享 `/tmp`（**默认值逐字不变**是硬纪律），于是**没有任何一层会清它**。
# 本入口就是补上"无人清理"这一环 —— 不是门禁，不进 `check` 链。
bash scripts/clean-build-tmp.sh                    # 🔴 默认 dry-run：只列可清项与体量，不动任何文件
bash scripts/clean-build-tmp.sh --apply            # 真删（凭据与证据仍受保护）
bash scripts/clean-build-tmp.sh --age-hours 1      # 只算 1 小时未改的（默认 24）
bash scripts/clean-build-tmp.sh --dir /tmp/heyta-knob   # 换落点目录
bash scripts/clean-build-tmp.sh --self-test        # 分类器 + **端到端**自检（臂数由它自己打印）
                                #   三条安全边界：默认 dry-run / 凭据白名单永不删且**显式列出**
                                #   （不静默跳过 —— 静默跳过在读数上和"没扫到"一样）/
                                #   证据类 `*.png` 默认保留（界面验收的唯一证据载体，§6.2 规定一）
                                #   ⚠️ 见 §7 第 434 条：macOS 上 `find` 有两个会**安静**出错的地方
```

---

## 6.1 腾讯云账号与凭据（**多个账号，别假设是同一个**）

🔴 **本机 `tccli` 同时登着三个账号，而它们不是同一个账号。** 涉及腾讯云的操作（DNS / 证书 / COS / CDN）
**先问"这件事属于哪个账号"**，再选 profile。选错的症状不是报错，而是**接口回 200 而事情没生效**
（例如把自定义域名绑到另一个账号的桶上 —— 详见 §7 第 461 条）。

| profile | 账号（UIN） | 这台机器上它管着什么 | 凭据形态 |
|---|---|---|---|
| `waytofuture` | **100050005585** | `waytofuture.cn` 的 DNS（DNSPod）· 该域的证书 | OAuth |
| `default` | **100044381704** | `finlaw.cloud` · `litopia.space` · `openpenpal.com` · `x-creative.team` · `xiaolihub.team` 的 DNS；**分发桶 `heyta-dist-1380503169` 也在这个账号** | OAuth |
| `opp` | （另有账号） | 见 `~/.tccli/opp.credential` | OAuth |

⚠️ **`sanjiaozhou`（`root@VM-0-14-ubuntu`）上还有一个 `tccli`，profile `ssos-distribution` = 账号 `100050003573`**。
那台机器上有 `coscli` 但**未配置**。

### 凭据形态决定"能做什么"

* `~/.tccli/<profile>.credential` 在本机是 **OAuth 型**（`type: oauth`、带 `token`、`secretId` 68 字符）
  ⇒ **能调 tccli 的云 API，但签不了 COS**（会回 `SignatureDoesNotMatch`）。
* 能签 COS 的是 **36 字符的 AKID**，住在 `~/.cos.yaml`（`cos.base.secretID/secretKey`）与 `~/.coscli/config.yaml`。
* ⇒ **"换个域名就能下发 APK"这类事，卡的不是命令，是"那个账号有没有 COS 密钥"**。

### 量账号（别猜）

```bash
# 每个 profile 各属哪个账号
for p in default waytofuture opp; do printf '%s → ' "$p"; tccli sts GetCallerIdentity --profile "$p" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["AccountId"])'; done

# COS 桶属于哪个账号（用 COS 密钥，经环境变量传给 tccli）
TENCENTCLOUD_SECRET_ID=<cos.yaml 里的 secretID> TENCENTCLOUD_SECRET_KEY=<...> \
  tccli sts GetCallerIdentity
```

### 已知边界（省下重新踩的时间）

* `tccli` **没有 `cos` service**；`coscli` **没有域名子命令**（只有 `bucket-acl/policy/tagging/versioning/encryption`）
  ⇒ 绑自定义域名要自己签 COS XML API（签名四步写在 §7 第 461 条）。
* `tccli ssl ApplyCertificate --DvAuthMethod DNS_AUTO` **不保证**自动写验证 TXT ⇒ 手动补 `_dnsauth.<子域>`。
* 免费 DV 证书本次是 **TrustAsia DV Free，3 个月**（`CertId bf4wtvOI`，`dl.waytofuture.cn`，2026-10-18 → 2027-01-16）。
