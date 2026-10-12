<!-- 由 heyta/AGENTS.md 按作用域拆分而来（2026-10-12）。内容零删除。
     本文件是「常用命令」的完整规则（原文 §6 常用命令）。返回入口：[`AGENTS.md`](../../AGENTS.md)。
     原始单体文件备份：`AGENTS.md.bak-full-2026-10-12`。 -->

## 6. 常用命令

```bash
pnpm install                    # 安装（工作区）
pnpm -r build                   # 全量构建
pnpm -r typecheck               # 全量类型检查
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

# 鸿蒙验收：用 DevEco **自带**的工具链（cmake/ninja/ohpm/hvigorw 都不在 PATH 上）
pnpm verify:harmony-toolchain   # 工具链 → 最小 ArkTS 工程 → 真 HAP（17 项）
pnpm verify:harmony-rnoh        # RNOH 原生侧 → 37MB HAP（含 librnoh_core/app/reactnative.so，17 项）
                                #   ⚠️ 只到"原生编得出包"，JS 侧用桩（见下一条）
pnpm verify:harmony-rnoh-js     # 鸿蒙 JS 侧全链路（零桩）：真 codegen + 真 autolinking
                                #   + Metro/Hermes bundle（验魔数）+ 20MB release HAP（含 hbc）
                                #   ⚠️ 只到"编得出包"：不验运行（缺模拟器镜像+签名）
                                #   需要 Node ≥ 20.12（DevEco 自带的 18 会报 styleText，见 §7 第 59 条）

pnpm check                      # 全部门禁 + **全量单元测试**：类型 + 迁移 + 分层 + 界面文案 + 许可证 + 文档 + 设计变量 + iOS 原生依赖 + `pnpm -r test`
                                # 🔴 末尾的 `pnpm -r test` 是后补的：在此之前 `check` **不跑任何单元测试**，
                                #    于是 `apps/web` 的测试套件红了很久都没有任何东西会失败（原因见下）。
pnpm check:design               # 只跑设计变量硬编码检查
pnpm check:layering             # 只跑分层边界检查（apps/* 不得重新长出业务/接线）
pnpm check:ui-language          # 界面文案必须全是中文（见 §5）
pnpm check:adr-numbering        # ADR 编号唯一 + 裸写的 `ADR-NNNN` 只指向一枚文件
                                #   🔴 它挡的是 2026-10-05 那次"两条会话同一天各占 0053"：
                                #      文件名不同 ⇒ git 不报冲突，死链检查也不报（链接各指各的），
                                #      而正文里的 `ADR-0053 §5 第 11 条` 从此有两种读法。
pnpm check:tokens               # 原生 token 产物（Swift/ArkTS/JSON/RN）是否与 tokens.css 同步
pnpm check:arkts                # 用**真 ArkTS 编译器**编译生成的 .ets 产物
pnpm check:native-deps          # iOS 原生依赖对账（package.json ↔ Podfile.lock，见 §7 第 32 条）
```
