# 交接：日历（年视图 + 时刻输入侧）与移动端 Profile（R13–R16 + R14c）

> 交接日期：**2026-10-03**（CST，约 20:5x）
> 给**全新会话**用：不从聊天记录继承任何前提。每条断言都带可复现命令或实测读数。
> 过程账（批次表 / 判据 / 变异臂逐支读数 / 计划变更记录 / 外部阻塞台账 / 已知边界）在
> [`calendar-year-time-and-mobile-profile.md`](calendar-year-time-and-mobile-profile.md)，
> 本文件**只记"现在停在哪、下一步按什么顺序做"**，不重复它的内容。
> 复盘（为什么当时那样判断）在 [`calendar-profile-reflection.md`](calendar-profile-reflection.md)。

---

## 0. 一句话现状

> 🔴 **00:0x 增量（只两件事，细节在 §5 第 5、6 行）**：
> ⑫ **E 已落地**：`check:md-tables` 进了 `pnpm check`（链 63 段、条目 1 次、JSON 解析通过），
> 并当场证明它有牙 —— 注入一枚错位表行 rc=1 指到行号，`cp` 复原后字节级相同、复跑 rc=0。
> 前置（`package.json` 干净）是别人那笔提交替我们满足的，不是等的，是**当时正好干净**。
> ⑬ 🔴 **A 被并行会话那笔 `2f735392` 整片吸走：本线 19 枚判据里 17 枚 + 29 枚证据 png 已在 HEAD，
> `check:docs` 指向本线的红归零**（现量 2 红全在 `countdown-anniversary.md`，不归本线）。
> 剩两枚仍在仓库外（`e2e/_probe/probe-reload-crash.spec.ts`、`e2e/playwright.probe.config.ts`），
> 而**本文件自己此刻是 ` M`** —— 上面 ⑦–⑪ 与 §4.1 的 H 条都还没进 HEAD。
> ⚠️ 不要把"别人提交了"读成"入库完成了"：§4 A 那份点名清单仍是下一次提交的最小集。
> ⑭ 🔴 **00:1x 又变了一次**：MANIFEST 那一行**已插**（那个文件在别人提交后干净了；门禁 rc=0，"36 个脚本"），
> 并新增一条 `scripts/verify-mobile-window-gate.sh --target b|c [--confirm]` —— 它把"B/C 能不能开跑"
> 从文档里每小时过期的读数变成一条命令（0 = 窗口开 / 1 = 用法错 / 3 = 现场不成立，默认 dry-run）。
> 现量：B 的两条前置里 `reinstall-all.sh` 已干净、booted 模拟器**正是** `heyta-iphone-17pro`；
> 拦着 B/C 的现在收敛成**一件事**——vault 密钥迁移那条线的 **26 枚**未提交源码（负载 19–21 是第二件）。
> 细节与两条刻意的设计（不 source 那个带 `trap restore_ime EXIT` 的共享 lib；负载用规范实现但不替人睡觉）在过程账 §3·补 ⑫。


> 🔴 **23:5x 增量（这一段取代下面 23:1x 那段的 ④ 和 ⑥）**：
> ⑦ **C 缺的那条脚本已经写出来并做了离线先验** —— `scripts/verify-mobile-due-time.sh`
> （604 行 / 14 step / 11 判据 + 3 对照；bootstrap 实测落在第 3 行，`.gitignore:184` 覆盖快照名）。
> 上面 ④ 那句"要先写一条"到此闭合；`MANIFEST` 那一行仍**待插**（该门禁不查漏登记，漏了不会红）。
> 🔴 写它的时候否证掉三条"应该有"：行上**看不到**时刻（`formatCompactDate` 只出 `MM-DD`，
> 全仓 `localTimeOf` 只有详情面板一个消费者）；判据 ② 从 `enabled="false"` 改成**行为**
> （属性名没实测过，赌错就是恒红）；`attr` 读数**不能**走 sane 门 —— 走了会让"被裁掉的框读成空串"
> 恰好等于"填不进字"的通过读数，那是一条因探针位置而恒绿的判据。全部读数在过程账 §3·补 ⑩。
> ⑧ **C 的七条前置现量：五条不满足**，而且四条是同一条命令能一起补的（`mobile-e2e-up.sh` 起服务端 + 建号
> → `pnpm build:android` → 等负载 → 等并行会话提交）。新数：负载 **73**（原 ⑥ 写的 16–35 已过期），
> `:3000`/`:3100` **都没人监听**，`/tmp/heyta_mobile_{token,email,e2ee}.txt` **三个都不存在**，
> APK `23:24:49` < 最新源码 `23:46:47`。设备独占这一条此刻**满足**（`bash -n` 那种预检不算运行者）。
> ⑨ 顺带量出一条**不归本轮的真缺陷**并登记：`dueDateToEpoch` 是「本地零点 ms + 时刻 ms」朴素相加，
> `America/Los_Angeles / 2026-11-01` 那天用户写 16:00 会落成 **15:00**（差 `3 600 000 ms`；
> `Asia/Shanghai` 差 `0` ⇒ 本机模拟器今晚不触发）。验收脚本的判据断的是产品结论，所以那天该红 —— 别当 flaky 改断言。
> ⑩ 🔴 **A 的清单再加一枚**：判据文件从 18 枚变 **19 枚**（新脚本本身）。
> ⑪ ⚠️ 一条自我更正：我第一次跑 `check-shell-unicode-vars` 写成 `… | tail -6; echo rc2=$?`，
> 拿到的是 `tail` 的 0 而真 rc 一直是 1（**§7 第 45 条同一个坑，我今天第二次踩**）；
> 它点名的是本文件一行**注释**里的 `$PORT（`，修后 rc=0。而本机 A/B 里 `$SCREEN，` 与 `${SCREEN}，`
> **打印完全一样** —— 所以那次改动是"照既有纪律与门禁做"，**不是**"修掉一条观测到的乱码"，这么写才诚实。

> 🔴 **23:1x 增量（其中 ④ 与 ⑥ 已被上面那段取代，其余仍有效）**：
> ① §5 第 1 步体检**已跑**（14 包里只有 `i18n` 落后 115s；值层对照证明它不影响本线任何判据 —— 读数在过程账 §3·补 ①②）。
> ② ✅ **H 已闭合**（23:19 那一趟 `RUN_RC=0`）：两张图都在 `apps/web/evidence/calendar-view-options/`
> （`view-select-closed.png` `bf594d6a…`、`view-tabs-year.png` `def6cc66…`），**两张都被人打开看过**，README 已写"看见了什么"。
> 途中修掉那条 spec 自己的缺陷（拼装 testID 被写成精确等值 ⇒ `Received: 0`），并补了一条内建对照。
> ⚠️ 唯一留下的：summary 是 **`1 flaky / 1 passed`** —— ① 首趟红在 `spec.ts:114` 的 `VIEW_SELECT` 可见性、重试 1.8s 过。
> 图出自重试那次所以是当前态，但那枚不稳**没有被解释**，已单独挂账（过程账 §3·补 ⑨ 带三趟重查命令）。
> ③ 三条**交接自身**的错/漏已就地更正：§4 A 的 `git add` 清单**漏了 18 枚本线判据文件**；
> §4 B 的前置只看 op-log、**没看工作树整体和被执行脚本自己**；§3 那行"`adb devices` 为空"已过期（`emulator-5554` 在）。
> ④ **C 不是一条现成命令**：仓里没有覆盖时刻那一腿的验收脚本，要先写一条（且必须带自快照 bootstrap + 进 MANIFEST）。
> ⑤ 两条待入 traps（#190 拼装 testID 的字面 grep 假阴性 / #191 静态预验挡不住选择器语义）
> 正文已写好放在过程账 §3·补 ⑧·附，**因为共享 traps 文件此刻正被别人 `M` 着**，不往里追加。
> ⑥ 今晚 B/C/A/E 全部**不在可执行状态**：`apps/mobile` 58 枚未提交、`scripts/reinstall-all.sh` 与
> `check-script-snapshot.mjs` 都在别人手里、根 `package.json` 脏、负载 16–35 抖、且本会话被明令不许提交。

产品负责人交的四项（① 日历年视图 ② 任务时刻输入侧 ③ 移动端 Profile 昵称+头像 ④ 日档英文界面取证）
**代码侧全部做完**，且每项都有能因注入转红的判据 + 逐支变异臂读数 + 真浏览器截图（人已看过）。
**没做完的不是产品，是收尾**：§4 逐条那些件（标题原来写「六件」，22:2x 起不写条数）—— 入库（A）、四端重装（B）、Android 真机腿（C）、
`check:md-tables` 接进 `pnpm check`（E）、已知边界的登记（F，其中"档位声明两处"那条已被 R17 闭合）、以及 **H**：收口后追加的一批 R17（档位表单一事实源）**代码/判据/六支变异臂/九条门禁全部有读数**，欠的只有 §6.2 那张真浏览器截图 —— 载体被别人的 Playwright 占着（见 §4 H）。
`check:md-tables` 接进 `pnpm check`（E）、九条已知边界的登记（F）。
本文件 §5 把它们排成可做顺序，每条带开工判据。

🔴 **本会话被明令不许 `git add`/`git commit`/`git stash`**（共享工作树），所以下面凡是"入库"类
的收尾都**只是命令**，不是已执行的动作。

---

## 0.5 本轮 goal 的**完整范畴**（产品负责人原文要求，逐条）

🔴 这一节是**验收口径**，不是进度。下一个会话如果新开批次，下面每一行都仍然成立；
不要因为"四项已交付"就把它们读成已归档的历史。

### 四项（顺序即做序）

| 项 | 原文范畴（含它自带的限定条件） | 本轮实际做到哪 |
|---|---|---|
| ① | 日历**年视图** —— §9.4 批四的另一半：12 个月缩略、**复用月格**；🔴 **「下拉里只有真的能用的档位」这条立场不许破** | ✅ R13 落地（`CalendarYearBoard` + 列数规则进共享层）。档位立场守住：四档逐档有名，判据 `apps/web/tests/calendar-view-tabs.spec.tsx` |
| ② | 给任务一个**时刻**的输入侧 —— `DueEditor` 加时间档 + `parseCapture` 解析 `16:00`；⚠️ 会牵动 `dueDateToEpoch` 的「本地零点」约定，属**领域与输入侧**；🔴 **须论证不 bump `CURRENT_SCHEMA_VERSION`**，且**新增持久化字段一律可选并带运行时默认** | ✅ R14（共享层 + web）+ R14c（移动端接线）。零新增字段（同一个 `dueDate` 数字的两种精度，时刻用 payload marker）⇒ schema 未动，论证在台账 §2 R14 那格 |
| ③ | **移动端 Profile** 的昵称/头像读写界面 —— R10 剩下的那半（web 已交付，`ProfileScreen` 当时**零 UI**） | ✅ R15a 昵称 + R15b 头像（含 Android 原生 base64 读通道）。🔴 唯一没跑的是**真机取证**（§4 C），界面与判据都在 |
| ④ | 日历日档**英文界面**的真浏览器取证 —— §9.12 登记的**边界 3** | ✅ R16（`e2e/tests/calendar-day-en.spec.ts` 2 条 + jsdom 英文会话腿 + 三张人看过图）。顺带多要来一层判据：变异臂 E2 现量出「把中文字面量写死进组件时只有英文腿会红」 |

### 每批固定动作（一步不许省 —— 新开批次照样照它走）

1. 先读相关 ADR / 计划与**既有判据**；
2. 在计划文档登记「要做什么 / 为什么 / 会撞谁」；
3. 实现：游标、文案、判断这类跨端规则**一律进 `packages/*` 共享层**，`apps/*` 只留平台差异（AGENTS §3.5）；
4. 写判据：等待条件必须是**该功能唯一产出的串**；断言**产品结论**不断言显示形态；console error 进断言；
5. **配变异臂证明它能红**，并逐支记录读数（存活的那几条才是这单真正产出的判据）；
6. 门禁：`check:design` / `layering` / `ui-language` / `rn-aria` / `empty-state` / `row-single-source` /
   `ui-provider` / `l4` / `docs` + `@heyta/ui` / `@heyta/web` / `@heyta/mobile` 三端测试 + typecheck；
7. AGENTS §6.2 规定一：**真浏览器截图**、落到受版本控制的 `apps/*/evidence/`、**人必须打开那张图**；
8. 台账写明现量读数、未闭合项与**闭合命令**。

🔴 本轮踩过的两处"步骤看着走了其实没走"：第 3 步（R14 把判断放进了共享层，但**移动端没接**，
于是第 6 步的门禁全绿 —— 见复盘第 1 条）与第 7 步（图拍了但没逐张看，看了才发现两张同屏 —— 台账 §4 18:4x）。

### 硬约束（全程有效，下一个会话继续受它管）

- 🔴 **不 `git add` / `git commit` / `git stash`** —— 共享工作树，另一条会话正在改 `packages/op-log`；
  它的墓碑/字段合并 WIP 会让 `apps/web` 的 `trash.spec.tsx` 红 ⇒ **不代改、不吸收、不为它改判据**。
- **不新增第三方依赖**，除非先过 AGENTS §3.1 可维护性与 §3.2 许可证两道门并**逐项登记**。
- **不 bump `CURRENT_SCHEMA_VERSION`**、不改已应用迁移、不改已接受 ADR 的结论（要变更就新写一份）。
- 界面文案一律走 `packages/i18n`，**中英同步**并重建（§7 第 79 条：改完不 build 会静默用旧表）。
- 组件内**不许裸 hex / px / ms / z-index**（`check:design`），要新值先加 token。
- GUI 与验收**一律后台跑、不抢前台**；e2e 前现量 4318/4319 为空；
  🔴 **不跑** `check:ai-e2e` / 全量 `pnpm check` / `pnpm reinstall:all`（它们会 SIGKILL 别人的 dev server）。
- 被外部阻塞的收尾（四端重装、移动端真机取证、证据目录入库）**逐条登记「在谁手里 + 可复跑命令」，不许静默消失**。
- 🔴 **不再向产品负责人发任何需求表单或问句，直接做**（2026-10-03 他睡前明确；
  需要人拍板的值就交付一条**参数化脚本**（缺参 exit 1、默认 dry-run、`--confirm` 才动），既不发问也不代拍）。

### 文档与指针要求（已满足，改动时保持）

计划文档 `docs/plans/calendar-year-time-and-mobile-profile.md`（批次表 / 每批判据与变异臂清单 /
执行记录 / 「计划变更记录」）✅；指针在 `ui-review-fill-zh-timeline.md` §9.4 与 §9.13 ✅、
索引在 `docs/plans/README.md` 第 21 行 ✅；🔴 **每批收口时按实际迭代计划，被否证的判断原地写 ⚠️ 更正、不删原句**
—— 这条是纪律，不是格式，下一个会话继续受它管。

---

## 1. 这条线的文件都在哪

| 用途 | 路径 |
|---|---|
| 过程账（唯一真源） | `docs/plans/calendar-year-time-and-mobile-profile.md`（§2 批次表 / §3 执行记录与变异臂 / §4 计划变更 / §5 外部阻塞 / §6 已知边界） |
| 上级台账的指针 | `docs/plans/ui-review-fill-zh-timeline.md` §9.4 四行、§9.13 边界 3、§9.6 那条"剩两半"的更正 |
| 索引行 | `docs/plans/README.md` 第 21 行（过程账）、本文件与复盘文件在 §二 那张表里 |
| 新加的门禁脚本 | `scripts/check-md-table-rows.mjs`（列数 / 断行 / "这一块到底算不算表"，**尚未接进 `pnpm check`**，见 §5 第 4 步）。21:4x 把清单从 2 份**扩到 4 份**：过程账 + 上级台账 + **本文件** + 复盘文件 —— 也就是它现在守着自己这两份交接物（两支变异臂 M9/M10 现量各红一次，见 §2 门禁那行）。🔴 **`docs/plans/README.md` 刻意不进清单**，原因写在脚本头与下面 §4.1 |
| 新加的**体检**命令（刻意不是门禁） | `scripts/dist-freshness.mjs` —— 打印每个包**实际被消费的运行时产物**比源码新/旧多少秒。默认 exit 0；`--strict` 才判定；`--only a,b` 把范围收到"我这次判据真的读了哪些包"。为什么不是门禁：见 §4 D |
| 一次性探针（**不在 e2e 收集范围内**） | `e2e/_probe/probe-reload-crash.spec.ts` —— 目录在 `testDir: './tests'` 之外，主配置 `--list` 对它 **0** 命中。它的桩是**逐字复制**自 `e2e/tests/profile-avatar-e2ee.spec.ts:87-211`，那条 spec 改了它必须跟着改 |
| 探针专用配置 | `e2e/playwright.probe.config.ts`（展开主配置，只换 `testDir` 与 `retries: 0`）。跑法：`cd e2e && NO_COLOR=1 npx playwright test -c playwright.probe.config.ts` |

---

## 2. 已完成（事实，每条带一条读数）

| 项 | 落到哪 | 一条读数（可复跑） |
|---|---|---|
| ① R13 年视图（12 月缩略、复用 `monthGrid` 数据形状） | `packages/ui/src/calendar/CalendarYearBoard.tsx` + `calendarYearColumns()` 在共享层 | `NO_COLOR=1 pnpm --filter @heyta/ui exec vitest run tests/calendar-year-model.spec.ts`；14 支变异臂逐支读数在台账 §3「R13 的 14 支变异臂」 |
| ② R14 时刻输入侧（`DueEditor` 时间档 + `parseCapture` 认 `16:00`） | `packages/domain/src/capture.ts`（`HH:MM` 那条规则语言中立）、`packages/ui` 的 `DatePicker` 时刻行、web 接线 | `NO_COLOR=1 pnpm --filter @heyta/domain exec vitest run tests/capture.spec.ts`（72 passed）；18 支变异臂在台账 §3 |
| ② R14c 移动端接上时刻那一行（R14 现场否证"两端都接了"之后重开的一批） | `apps/mobile/src/screens/TaskDetailSheet.tsx` 两处 `<DatePicker>` 传 `time`；`lib/date-picker-labels.ts` | `NO_COLOR=1 pnpm --filter @heyta/mobile exec vitest run tests/task-due-time.spec.ts` = **8 passed**；T5 那条"两个键的值必须逐字相同"有变异臂 M6 |
| ③ R15a 移动端昵称 | `apps/mobile/src/screens/ProfileScreen.tsx`；词条从 `web.settings.profile.*` **改名**进 `common.profile.*`（19 键） | `NO_COLOR=1 pnpm --filter @heyta/mobile exec vitest run tests/profile-nickname-entry.spec.ts` = 9 passed；11 支变异臂在台账 §3 |
| ③ R15b 移动端头像（含 web 的端到端往返） | `packages/shared-schema` 的 `avatarInitialFromEmail`/`avatarDataUri`（首字母从两份并成一份）、`apps/mobile/src/ui/avatar.tsx`（mobile 第一个 RN `<Image>`）、`prepareAvatarBase64` 进 Kotlin | `NO_COLOR=1 pnpm --filter @heyta/app-host exec vitest run tests/hosted-account-profile.spec.ts`；E2EE 那三条有 M15a（failed=1）/M15b（failed=5）两支读数 |
| ④ R16 日档英文界面取证 | `e2e/tests/calendar-day-en.spec.ts`（2 条）+ jsdom 英文会话腿 `apps/web/tests/calendar-day-view.spec.tsx` | `cd e2e && NO_COLOR=1 npx playwright test tests/calendar-day-en.spec.ts tests/profile-avatar-e2ee.spec.ts` = **3 passed (9.1s) / rc=0**（18:53）；E1/E2/E3 三支臂现量出"只有英文腿会红" |
| R17 档位表单一事实源（收口后追加的一批：把「有哪些档 + 每档叫什么」从两端各一份收成共享一份） | `packages/ui/src/calendar/model.ts` 的 `CALENDAR_VIEW_LABEL_KEYS`（`Record<CalendarViewKind, CalendarViewLabelKey>` ⇒ 加一档不给键名是**编译不过**）+ `CALENDAR_VIEW_ORDER`；两端各自**删掉**本地那张表（`CalendarHeaderToolbar.tsx`、`CalendarScreen.tsx`），`timeline` 仍留宿主 | 22:2x 现量：`@heyta/ui` `calendar-view-step` **13 passed**、`@heyta/web` tabs+day-view+family **29 passed**、`@heyta/mobile` `calendar-view-entry` **11 passed**；**六支变异臂全跑**（V1 集合一致 / V2 两端各红一条 / V3 `TS2741` 编译红 / V4+V4b 值层 / V4c 键名耦合 / V5 源码写死），逐支读数与还原 md5 在原台账 §3「R17 的六支变异臂」。🔴 **V4 顺手否证了我自己写的一句断言**（「`check:ui-language` 只比键集」—— 它其实也比值层语言方向，两趟各 rc=1），三处原句已就地补 ⚠️ 更正 |
| 日历 e2e 家族整批复跑（六文件 + 那条头像用例） | — | 20:1x：**19 passed / 1 failed / rc=1**，日历 6 个文件全绿；唯一那枚红 = 下面 §4 D |
| 门禁 | — | `node scripts/check-md-table-rows.mjs` rc=0，**21:4x 起守 4 个文件**（含本文件与复盘）；**能否红已现量**：M9 在本文件 §3 表里插一枚 2 列行 ⇒ rc=1 并指到行号，M10 在复盘表里插一枚 3 列行 ⇒ rc=1 且报「列数 3（本表表头是 5）」，两次复原后字节级相同、复跑 rc=0（⇒ "把文件加进清单"不是空操作）。`@heyta/web` 全量 **1552 passed / 12 skipped / 0 failed**；`check:ui-language` rc=0、词条 zh/en 各 **2851** ；🔴 **22:2x 复跑九条门禁**：design / layering / ui-language / rn-aria / empty-state / row-single-source / ui-provider **七条 rc=0**，而 **l4 rc=1**、**docs rc=1** —— 两条都不是本线造成的，也都不许代改（l4 的红点是别人 22:18:52 刚落盘的未跟踪文件 `apps/web/src/features/sync/VaultSettingsPanel.tsx`，12 行内联样式把 `apps/web/src/features` 顶到 110 > 基线 104；按门禁自己的单位现量 HEAD = **100 ≤ 104** ⇒ 干净检出是绿的；docs 的 45 站里 12 条的目标是本线三份未跟踪文档，关闭动作是一句被明令不许的 `git add`）。同趟 **typecheck ui/web/mobile 全 rc=0** —— §5 第 8 行那个"mobile rc=2"已由对方关闭 ⇒ 那类读数只能写成命令，不能写成数。⚠️ 词条计数也已漂：现量 **zh-CN 2875 / en 2875**（本文件原来那个 2851 是 21:4x 的）。 |

🟡 上表的读数**取于各自那一趟**（07:5x–20:1x 之间，逐条时间戳在原台账 §3/§4），
不是"现在仍然是这个数"。共享工作树里别人一直在提交 ⇒ 引用前先复跑那条命令。

🟡 **假设，不是事实**：web 全量 0 红量的是 `packages/op-log/dist/index.js`（mtime 15:20:43），
而他的 `src/engine.ts` 最后改于 15:23:14 ⇒ 磁盘 dist 比他的源码旧。所以"op-log 那条线的红已解决"
**不能宣布**，只能说"这一趟复跑没出现"。

---

## 3. 当前现场（20:5x 现量，每条都是命令）

| 事项 | 读数 | 命令 |
|---|---|---|
| 本机负载 | `23.31 / 41.28 / 52.84`（19:33 那趟是 `108 / 126 / 101`） | `sysctl -n vm.loadavg` |
| e2e 端口 | 4318、4319 **都空闲**（各 0 条 LISTEN） | `for p in 4318 4319; do lsof -nP -iTCP:$p -sTCP:LISTEN; done` |
| `packages/op-log` | 仍脏：`src/engine.ts`、`src/state.ts`、`tests/engine.spec.ts` 三个 `M` + 三个未跟踪 spec | `git status --porcelain packages/op-log` |
| 根 `package.json` | 仍脏（**3+/1-**：`check:op-log-semantics`、`verify:mobile-notes`、`verify:mobile-aed`） | `git diff --stat -- package.json` |
| mobile typecheck | 🔴 **rc=2**，1 条 `TrashScreen.tsx(180,47) TS2322`（`<Text>` 收到 `testID`）—— **不是本会话的文件** | `NO_COLOR=1 pnpm --filter @heyta/mobile typecheck; echo rc=$?` |
| mobile 测试 | 🔴 2 failed（`tests/trash-display.spec.ts` 的「便签 / 笔记」叫法）—— **回收站那条线** | `NO_COLOR=1 pnpm --filter @heyta/mobile test` |
| `check:docs` | 🔴 rc=1，**44 处**（21:4x 复跑；20:1x 是 27、20:5x 是 42 —— 这张表本身就在漂，引用前重跑）。**本会话 13**（台账 10 + `calendar-profile-handoff.md` 1 + `calendar-profile-reflection.md` 1 + `apps/web/evidence/calendar-day/README.md` 1）/ **其他会话 31**（`docs/adr/0047` 8、`research/trash-and-archive-best-practice` 6、`adr/0051` 4、`research/aed-implementation-evidence` 3、`plans/trash-and-archive` 2、`adr/0048` 2、`adr/0046` 2、`research/op-log-e1-semantic-spec` 1、`research/e2ee-key-lifecycle-threat-model` 1、`plans/trash-and-archive-execution-brief` 1、`adr/0050` 1）。⚠️ 20:5x 那次记的"其他 29"到 21:4x 变 31 ⇒ **涨的两处全在别人那侧**，本会话这一趟没新增任何链接 | `NO_COLOR=1 node research/tools/docs-link-check.mjs > /tmp/docs.out 2>&1; echo rc=$?`，分归属：`grep -o "解析到 [^，]*" /tmp/docs.out \| sort \| uniq -c \| sort -rn` |
| 证据 png | 四个目录合计**未跟踪 19 枚 png**（`calendar-day` 8、`calendar-day-time` 4、`calendar-year` 4、`profile-panel` 4，另 1 枚 README 已跟踪） | `git status --porcelain -uall apps/web/evidence/calendar-day apps/web/evidence/calendar-day-time apps/web/evidence/calendar-year apps/web/evidence/profile-panel` |
| **产物新鲜度**（D 那条的取证入口） | 21:1x 现量：**3 个包的运行时产物比自己的源码旧** —— `app-host` 落后 444s、`domain` 157s、`ui` 2718s；`storage`/`op-log` 已追平（`op-log` 是 21:00:41 被重建的）。这是正常态（并行会话正在改源码），**不是缺陷读数**，它只回答"我这趟判据读的是哪一份字节" | `node scripts/dist-freshness.mjs`（只打印，永远 exit 0）；`node scripts/dist-freshness.mjs --only ui,storage,op-log` 把范围收到被测的那几个包 |
| C 那条 Android 真机腿的三重门（21:46 复测） | 🔴 **三门里现在只成立一门**：① 负载 `{19.38 23.42 23.16}` **仍 > 12**；② `pgrep -fl "verify-mobile\|playwright\|vite"` **为空**（没人正在跑验收 —— 这是三条里唯一成立的）；③ `adb devices` **列表是空的 = 模拟器根本没起**，所以阻塞的性质从"设备被别人占着"变成"载体不存在"。⚠️ **本会话不去自己起模拟器 + 不重打 APK**，理由不是懒：重打要走 `pnpm -r build`，而 `packages/storage` 五个文件、`packages/op-log` 三个文件此刻是别人未提交的 `M` ⇒ 重建出来的 `dist` 是**别人 WIP 的产物**，会被同时读 `dist` 的判据当成"当前提交的行为"（§4 D 那条崩溃的方向就是这个）。设备验收的运行窗口要**由做移动端壳的那一侧协调**（AGENTS §8.9） | `sysctl -n vm.loadavg` · `pgrep -fl "verify-mobile\|playwright\|vite"` · `adb devices`（三条各是独立命令，别用 `&&` 串——见 §6 第 4、7 条） |

⚠️ 这几行的读数**只属于 20:5x 那一趟**。共享工作树里别人一直在提交，引用前重跑。

---

## 4. 未闭合的事（逐条带主语；⚠️ 标题原来写着「只有六件」—— 那个数本身就是会漂的抄件，22:2x 起不写条数）

**A. 台账与证据没入库。** 本会话不许 `git add`。后果是 `check:docs` 那 **13** 处红（⚠️ 22:2x 复跑现量：**12** 处，且口径这次说清了 —— 它们是**指向本线三份未跟踪文档的链接**，而本线三份文档自己作为来源的站点是 **0**；其余 **33** 处不归本线）+ 19 枚 png 不在仓库里，
而**本轮新加的两条脚本也不在**（`scripts/check-md-table-rows.mjs` 与 `scripts/dist-freshness.mjs` 现在都是 `??`）
—— 🔴 漏了它们，§4 E 那条"接进 `pnpm check`"就成了一条指向不存在文件的命令，而**门禁指向不存在的脚本是响亮失败**，
会在别人那侧变成一次莫名红。闭合命令（**点名路径，不用 `-A`**）：
`git add docs/plans/calendar-year-time-and-mobile-profile.md docs/plans/calendar-profile-handoff.md docs/plans/calendar-profile-reflection.md scripts/check-md-table-rows.mjs scripts/dist-freshness.mjs apps/web/evidence/calendar-day apps/web/evidence/calendar-day-time apps/web/evidence/calendar-year apps/web/evidence/profile-panel apps/web/evidence/calendar-view-options`
⚠️ **23:04 现量更正：上面那份清单不完整 —— 本线还有判据文件从未入库；00:1x 现量是 20 枚**
（5 枚 e2e spec + 11 枚测试 + 2 枚探针 + **2 枚新脚本**：`scripts/verify-mobile-due-time.sh`、
`scripts/verify-mobile-window-gate.sh`），
⚠️ 下面那份 `git add` 里第三条 `scripts/check-script-snapshot.mjs` **不计进这 20 枚** —— 它是**已跟踪文件的修改**
（自快照 MANIFEST 那一行），但它必须与那两条脚本**同一笔**落地，否则门禁报"清单里的文件不存在"。
漏了它们会得到"描述判据的文档入库了、判据还在工作树外"，而 `check:docs` 只查链接可达、**不查链接指向的文件在不在 HEAD**。
补的那一条（逐条点名，同一目录里还有别人的 `M`，所以不许用 glob）：

```bash
git add e2e/tests/calendar-day.spec.ts e2e/tests/calendar-year.spec.ts e2e/tests/calendar-day-en.spec.ts \
  e2e/tests/calendar-view-options.spec.ts e2e/tests/profile-avatar-e2ee.spec.ts \
  e2e/_probe/probe-reload-crash.spec.ts e2e/playwright.probe.config.ts \
  apps/mobile/tests/task-due-time.spec.ts apps/mobile/tests/profile-nickname-entry.spec.ts \
  apps/mobile/tests/profile-avatar-entry.spec.ts apps/mobile/tests/calendar-view-entry.spec.ts \
  apps/web/tests/calendar-day-view.spec.tsx apps/web/tests/calendar-drag-day.spec.tsx \
  apps/web/tests/calendar-view-tabs.spec.tsx apps/web/tests/calendar-year-board.spec.tsx \
  packages/ui/tests/calendar-year-model.spec.ts packages/ui/tests/calendar-day-buckets.spec.ts \
  packages/domain/tests/date-year.spec.ts \
  scripts/verify-mobile-due-time.sh scripts/verify-mobile-window-gate.sh scripts/check-script-snapshot.mjs \
  package.json
```

🔴 **00:3x 现量：上面这份清单原来漏了 `package.json` 本身**（末行已补）。
漏它的后果与 §4 A 开头那条"漏两条脚本"是同一个形状：`check:md-tables` 的**接线就写在 `package.json` 里**，
按旧清单提交 ⇒ 门禁脚本入库、E 那条"已接进 `pnpm check`"的描述落空，而**没有任何门禁会红**
（`check:docs` 不看这个，`check:md-tables` 不看自己有没有被调用）。

🟢 **00:3x 点名 27 枚的逐枚现量**（命令：对每枚跑 `git ls-files --error-unmatch` + `git status --porcelain -- <路径>`；
⚠️ 我第一版把这条写成 `for f in $FILES` 直接跑在 zsh 里，**zsh 不做词分割 ⇒ 循环只跑了一次、
把 27 个名字当成一个字符串**，报出"未跟踪 1 / 脏 0"这种一看就少的读数。用 `sh -c` 重跑才得到下面这份 ——
这是 AGENTS §7 第 61–79 号段那条"批量门禁在 zsh 下必须 `sh -c`"的**本会话第二次命中**）：

- **未跟踪 3 枚**：`e2e/_probe/probe-reload-crash.spec.ts`、`e2e/playwright.probe.config.ts`、
  `scripts/verify-mobile-window-gate.sh`
- **已跟踪但脏 5 枚**：两份台账（本篇 + 过程账）、`scripts/dist-freshness.mjs`（00:2x 那笔 `--only` 参数语义修复）、
  `scripts/check-script-snapshot.mjs`（MANIFEST 行）、`package.json`（E 的接线）
- **已在 HEAD 且干净 19 枚**：5 枚 e2e spec + 11 枚测试 + `scripts/verify-mobile-due-time.sh`
- **五张证据目录 29 枚全部已跟踪**（9+4+4+9+3），未跟踪 png **0** 枚


🔴 **刻意不含** `e2e/tests/vault-settings.spec.ts`（vault 那条线的）。枚举命令与逐枚归属在过程账 §3·补 ⑧·附三。
🟢 **00:5x 现量：A 的债基本清了，但清法和我原来写的不一样，而且我那份点名清单里有一条是错的。**
- 已在 HEAD 且**工作树与 HEAD 一致**（我 00:2x–00:4x 写的所有内容都被并行会话的提交带走了，含我自己那两笔修复）：
  `scripts/verify-mobile-window-gate.sh`、`scripts/dist-freshness.mjs`（`resolveOnly` 在 HEAD 里 **2 处命中**）、
  `package.json`（`check:md-tables` 在 HEAD 里 **2 处命中**，链中那段 `check:docs && pnpm check:md-tables` 原样在）、
  `scripts/check-script-snapshot.mjs`、本文件（我 00:3x/00:4x 那四段新写的句子逐段在 HEAD 里核到）。
  只剩**过程账本篇**此刻是 ` M` —— 因为它正在被我写。
- 🔴 **上面那份 `git add` 清单里的 `e2e/_probe/probe-reload-crash.spec.ts` 与 `e2e/playwright.probe.config.ts` 两条是错的，别照着跑。**
  它们从 **23:58 的 `2f735392`** 起就被 `.gitignore:196-197` 明文登记为
  "调查探针与运行残留，勿提交（2026-10-03 收口）"。
  我 00:0x–00:3x 三次用 `git ls-files --error-unmatch` 得到 "OUT" 就把它们记成"该入库而没入"，
  并写进了闭合命令 —— 而 `git add` 对 ignored 路径默认**直接失败**，加 `-f` 又违背仓库已经拍过的决定。
  ⇒ 判"该入库而没入"之前必须先 `git check-ignore -v <路径>`；**被 .gitignore 带理由登记过的文件不是债**。
  （这正是本篇 §3 那条"断言'没有 X'的取证门槛"的又一种面目：我查的是"在不在索引"，
  而那句结论要的是"该不该在仓库里"。）
- 因此 **A 现在没有待办**：本线没有任何"该入库而未入库"的文件。
之后 `NO_COLOR=1 node research/tools/docs-link-check.mjs > /tmp/docs.out 2>&1; echo rc=$?`。
🔴 **00:3x 现量（原来那段"13 处 / 31 处 / 33 处"的读数全部作废，一个都不许引用）**：
那道门现在是 **6 处红，本线 0 处** ——
① 2 处失效章节引用在 `docs/plans/countdown-anniversary.md:1091/1295`（该文件**干净** ⇒ 红在 HEAD 里，
1091 指向的 `docs/plans/countdown-w7-device-export.md` **本机都不存在**，是 W7 那条线写了一条还没落地的引用）；
② 4 处"本机有、仓库里没有"的链接在 `docs/adr/0050-e2ee-key-lifecycle-and-recovery.md:93/94/95/98`，
指向 `apps/web/evidence/vault-panel/pg-*.png`（该 ADR 此刻 ` M` ⇒ vault 那条线在飞；四枚 png **没被 ignore** = 该入库而没入）。
**两条都不归本线：不代改、不吸收、不替它们写进 `UNTRACKED_LINK_OK`**
（那等于替所有人宣称"这些文档刻意不进仓库"）。
🔴 **00:41 同一条门再跑：6 处掉到 2 处，而那 4 处是假闭合。**
HEAD 仍是 `f6478fad`（没有新提交），四枚 `vault-panel/pg-*.png` 只是被**暂存**了：
`git ls-files` 命中 4 / `git ls-tree HEAD` 命中 **0**。
⇒ 门禁那句"本机有、仓库里没有 —— 它们在**干净检出**（CI 的唯一形态）上是死链"**量的不是它说的那件事**：
`check:docs` 用 `git ls-files`（索引）判"仓库里有没有"，所以**别人一次 `git add` 就能让一处红变绿，
而干净检出上那张图仍然 404**。⇒ 引用这条门的时候要说清它读索引不读 HEAD；
要问"CI 上会不会死"得自己补一条 `git ls-tree HEAD`（本线那 19 枚两种都复核过：**19/19 都在 HEAD**，读数不变）。
🔴 **00:44 再跑：rc=0，剩下那 2 处也没了 —— 原因还是别人在工作树里改，仍然一个提交都没有**：
`countdown-anniversary.md:1091` 被改写成"在 `feat/countdown-w7` 分支的 …"（不再指向本机没有的文件），
`:1295` 的锚点从 `§1` 改成 `#1a-勘误段…`。⇒ **六分钟内 6→2→0。**
所以这条门量的是**活的工作树 + 索引**，不是 HEAD：
① 报"docs 几处红"必须带时间戳与载体，过了十分钟就不许再引；
② 判"CI 上会不会死链"只能自己取 `git ls-tree -r HEAD`；
③ 此刻 rc=0 **不保证**别人下一次 `git checkout` 之后还绿。
⚠️ 本线那批未跟踪文件**不会**出现在这道门的红里 —— 因为文档引用它们时写的是反引号而不是 markdown 链接，
而 `check:docs` 只扫链接。这就是上面"window-gate 6 处死引用门禁不报"那条的同一件事，两头都对上了。
旧读数的原始句子留在原处（189 行那句"13 处红"与它下面的 12/33/31）—— 它们当时的现量是真的，
只是**每个数都只活了几小时**；要引用就现跑上面那一条命令。

**B. 四端重装（AGENTS §6.1.1 固定收尾）没跑。** 前置：`git status --porcelain packages/op-log` 为空
**且** `pnpm --filter @heyta/op-log build` exit 0。然后
`IOS_DEVICE_NAME="heyta-iphone-17pro" bash scripts/reinstall-all.sh; echo "EXIT=$?"`。
⚠️ 别在本机跑 `pnpm reinstall:all` 之外的 `pnpm check` / `check:ai-e2e`（会 SIGKILL 别人的 dev server）。

**C. R14c 的移动端真机腿**（时刻栏在 Android 上真的画出来、填 `16:00` 落库并同步到另一台设备）没跑。
环境三重门：`sysctl -n vm.loadavg` 三段都 **< 12** + `pgrep -f verify-mobile` 为空 + `emulator-5554`
的 `mCurrentFocus` 不是别人的验收。装进去的 APK **没有**本批改动 ⇒ 必须 `pnpm --filter @heyta/ui build`
→ `pnpm build:android` → `adb -s emulator-5554 install -r <apk>` 再验，判据走 testID
`task-due-time-input` / `task-due-time-all-day`，照 `pnpm verify:mobile-edit` 的四层形状。

**D. ⚠️ `e2e/tests/profile-avatar-e2ee.spec.ts` 第 ③ 段（刷新之后落崩溃屏「无法初始化本地存储」）— 21:0x 已不可复现，但不是"已修复"。**
🔴 已排除三件事（见下面这条的取证列）。21:0x 三趟复跑：同一批七文件 `20 passed / rc=0`、单文件 `1 passed / rc=0`、
复刻完整旅程的探针两条腿都不崩（IndexedDB 前后都是 `heyta@2`）。现量到的**唯一状态差**是
`packages/op-log/dist/index.js` 在 **21:00:41 被重建**（此前它比自己的 `src/engine.ts`(19:01) 旧），
而 `packages/storage` 五个文件是 `M` ⇒ 崩的那一趟跑在「新 storage 产物 + 旧 op-log 产物」这种
**任何一次提交都不存在的组合**上。🔴 **机制是假设，不是结论**（没人能回到那一刻），
但它把方向从"并发"挪到了"读的是哪一份产物"（AGENTS §7 第 27 条那一族的第五次露面）。
✅ 由此新增一条体检命令：`node scripts/dist-freshness.mjs`（默认永远 exit 0，只打印矩阵；
`--strict` 才判定；`--only ui,storage` 把范围收到"我这次判据真的读了哪些包"）。
🔴 它**刻意不是门禁**：21:1x 现量有三个包的产物落后（`app-host` 444s、`domain` 157s、`ui` 2718s），
而"落后"在并行会话正在改源码时是正常态 —— 一条天生红的门禁等于没有门禁（AGENTS §8.3）。
**重开判据**：任何 e2e 再报这个崩溃屏，先跑体检，有落后的包就先重建再看红是否随之消失；拿到
`[data-testid="error-message"]` 的原文之前不写归因（那串文字在 `<details>` 里，折叠时 a11y 快照读不到、`textContent` 读得到）。

**E. `check:md-table-rows` 没接进 `pnpm check`。** 补丁一行：`"check:md-tables": "node scripts/check-md-table-rows.mjs",`
放在 `"check:docs"` 旁边，并在 `check` 长串里 `pnpm check:docs &&` 之后插 `pnpm check:md-tables &&`。
挡的是 `package.json` 现在脏（§3 那行）——两条线改同一行会互相覆盖。

**F. 已知边界（条数不写，照台账 §6 那张表）**（不是阻塞，是"知道却没顺手改"）全在台账 §6：月份键的命名空间名不副实、
年档月卡与侧栏迷你月历是"同形状的第二次"、现在线横穿时刻标签列、测试助手的 16 份 `flush` 抄件、
`web.*` 键被移动壳读（条数不写在这里 —— 现量命令与 23:06 的读数在 §5 第 5 条那一行，同一条边界在 19:3x 前记的是 179）、**捕获语法只有中文那一套**（界面语言 ≠ 输入语法）、
"~~哪些档位存在"仍声明两处~~ → 🔴 **本条已由 R17 闭合**（22:1x：两份合成 `packages/ui` 那一份、两端各自删掉本地表、六支变异臂逐支有读数 —— 台账 §6 第 7 行已就地标注，判据是"把表加回去就两端同时红"那一支）、全仓 markdown 表格 27 文件 73 处没人守、两个「全天」键。
⚠️ 第八条在 21:4x **部分收敛**：清单已从 2 份扩到 4 份（本线与两份交接物都在守），
剩下的是其余 23 个文件 —— **不改口的口径**：这条边界的闭合判据是"谁写谁收 + 显式清单"，不是"全仓 0 处"。

**H. R17 的真浏览器截图（§6.2 规定一）欠着 —— 载体被占，不是产品。** 22:18 现量：`4318` 上是别人的一趟
Playwright（node **74885** `vite --port 4318 --strictPort`，ELAPSED 00:24），`4319` 上是对话式 AI 那条线的假端点
（node **56995** `stub-provider.mjs`，ELAPSED 05:20），`loadavg` = **22.43 / 48.54 / 64.09**。
🔴 硬约束明令不许 SIGKILL 别人的 dev server ⇒ 只能等窗口，不降级成"用 jsdom 那张图交差"。
**内容那一层已经钉住**（jsdom：`@heyta/web` 29 passed，逐档比的是词条表里的值），欠的是浏览器里**它长什么样**：
一条「页头下拉数得出四个 `<option>`、第四个的文本 == `t('common.calendar.view.year')`」的用例 +
截图落 `apps/web/evidence/calendar-view/view-tabs-4-options.png` + 同目录 README 一句"看见了什么"与 md5。
**开工判据**：`lsof -nP -iTCP:4318 -iTCP:4319 -sTCP:LISTEN` 为空 **且** 负载落回个位。
> 🔴 **22:3x 现场更新（写这份交接的人停手前最后一趟）**：载体**已经写好了** ——
> 新文件 `e2e/tests/calendar-view-options.spec.ts`（两条用例，档位顺序/键/词条文本三样都从真源现读：
> `CALENDAR_VIEW_ORDER`、`CALENDAR_VIEW_LABEL_KEYS`、zh 词条表、`MONTHS_PER_YEAR`；四档逐个选过去并比标题）。
> **它一次都没跑过**：22:33 现量 `4318` 又被别人的 Playwright 占了（22:29 那一趟空窗只有几十秒），
> 而 `e2e/playwright.config.ts` 把 4318/baseURL 写死、没有环境变量旋钮 ⇒ 不换端口、不改他的配置，就等窗口。
> 跑法：`cd e2e && npx playwright test tests/calendar-view-options.spec.ts`；
> 截图落 `apps/web/evidence/calendar-view-options/{view-select-closed,view-tabs-year}.png`，
> 跑完**人必须打开那两张图**并在该目录 README 写一句"看见了什么"+ md5（现在那个目录与 README 都还不存在）。
> ⚠️ 顺带一条载体事实：`packages/i18n/dist/index.js` 里**搜不到** `common.calendar.view.year` 这个字面串
> （`grep -c` = 0），但 `translate('zh-CN', …)` 四条都取得到（月/周/日/年）⇒ 产物里键的存储形态与源码不同，
> **不要用"dist 里 grep 到键名"当新鲜度判据**，要用体检脚本或实际取值。
> 🔴 **22:4x 现场更新（新会话接手，窗口仍没等到）**：载体两条门**一条成立一条不成立** ——
> `lsof -nP -iTCP:4318 -iTCP:4319 -sTCP:LISTEN` 返回空（22:37 / 22:44 / 22:47 三趟都空），
> 但 `sysctl -n vm.loadavg` 走的是 **181 → 46 → 29** 这条下降曲线的后两个数，**负载门按 §5 那条不许省**。
> 同趟现量到负载来自别人那一侧（NDK `clang` 98.7% CPU + 两枚 node 153%/134% ⇒ 有人正在打 Android 包），
> 所以这条线**不抢窗口**，只在窗口成立且连续两次采样都达标时才开跑。
> ✅ **等的这段时间把那条从没跑过的 spec 做了静态预验**（动机：`e2e/tests/helpers.ts:352` 自己写着
> "Playwright 走 esbuild 只转译、不做类型检查" ⇒ `--list` 绿不保证调用形状对）：
> `--list` = **2 tests in 1 file**；`calendar-view-select` 在 `apps/web/src/features/calendar/CalendarHeaderToolbar.tsx:123`、
> 年板/日板 testID 在 `packages/ui/src/calendar/`；`openApp(page, APP_ZH)` 与 `switchView(page, '日历')`
> 的调用形状逐字对上 helper 签名（`'日历'` 在 label 联合第 2 项，且已被三条在跑的 spec 用过）；
> 三段"从真源现读"的正则离线复刻通过（order=`month,week,day,year`、四档→键、`MONTHS_PER_YEAR=12`）；
> 宿主没再长出第二张本地档位表（R17 的重复没回流）。全部读数在过程账 §3·补 ③。
> ⚠️ 顺带两处**交接本身的漂**已在过程账 §3·补 ⑤ 就地更正：`adb devices` 现在**有** `emulator-5554`
> （§3 那行 21:46 的"列表为空/载体不存在"不再成立，C 的阻塞性质回到"被正在打包的一侧占着"），
> 而"会 SIGKILL 别人的 dev server"这件事实住了 **`scripts/check-ai-e2e-preflight.mjs:83`** 一行，
> `e2e/playwright.config.ts` 与 `tests/helpers.ts` 里 kill/pkill **0 处** —— 但**不要**据此推出
> "直接 `npx playwright test` 一定不伤人"，端口被占时那份配置怎么失败**本轮未实测**。

> 🔴 **22:5x 状态（只放指针，长文在过程账，避免再造一份会漂的抄件）**：
> 窗口等到 22:52:16 真的开跑了一次 —— **① 过并出图**（`view-select-closed.png`，md5 `f096b90d…`），
> **② 红**，红因是这条 spec 自己的选择器把**拼装出来的** testID 写成精确等值（`Received: 0`）。
> 已改成前缀 + `role=button`，并把"`role` 那一维是承重的"写成了一条内建对照断言。
> 逐条读数、根因行号与那条"静态预验挡不住选择器语义"的边界，写在过程账 **§3·补 ⑧**。
> ⚠️ 复跑读数在 **§3·补 ⑨**（本行写的时候还没跑）。

同一件事在原台账 §5 第 14 行也有一行 —— 🔴 那是抄件，改一处必须同步另一处。


### 4.1 撞见但不归本线的缺陷（登记 + 现量命令，不许静默消失）

**G. `docs/plans/README.md` 第 17 行是一张错位行。** 「一、权威入口」那张表表头是 3 列
（我想知道 / 看这一份 / 说明），而 `| [countdown-anniversary.md](countdown-anniversary.md) | …`
那一行只有 **2** 列 ⇒ GFM 会给它补一个空单元格：**长整段状态文字落在"看这一份"列，"说明"列是空的**。
不是渲染报错，是静默错位 —— 正是这条门禁存在的理由。

- **归属**：倒数纪念日那条线（那行是它写的）。
- **不是别人的半成品**：`git show HEAD:docs/plans/README.md` 里**同样命中**，所以它在已提交状态里就坏。
- **不在本会话修**：① 它是别的条线的行；② `docs/plans/README.md` 当前**正被并行会话改动**（§3 那行 `check:docs` 的 29 处即来自他们），
  我在一个他们正在整文件提交的文件里改第 17 行，最可能的结果是**被他们那笔覆盖掉**（本机今天实测过这个形状）。
- **现量命令**（谁收这条都能一条复现，21:4x 已实跑过：读数 **1 处，行 17，列数 2（表头 3）**）：

```bash
python3 - <<'PY'
import re, pathlib, subprocess
src = pathlib.Path('scripts/check-md-table-rows.mjs').read_text()
tmp = pathlib.Path('/tmp/mdrows-readme.mjs')
tmp.write_text(re.sub(r"const FILES = \[[^\]]*\];",
                      "const FILES = ['docs/plans/README.md'];", src, count=1))
r = subprocess.run(['node', str(tmp)], capture_output=True, text=True)
print('rc =', r.returncode)
print('stderr =', r.stderr.strip())   # 🔴 报错在 stderr，见 §6 第 10 条
PY
```

- 修法是**一个单元格**：把那行拆成「主题名 | 链接 | 状态说明」三列（主题名如「倒数纪念日：批次一已落地」，
  状态文字整段搬进第三列）。修完之后才可以把 README 加进门禁清单。

**H. `dueDateToEpoch` 在 DST 换日那天会把时刻挪一小时**（写 C 的验收脚本时离线量出来的，23:5x）。

`packages/domain/src/capture.ts:604` 是「本地零点 ms + `timeOfDayMs(time)`」的**朴素相加**，
而"用户写 16:00"指的是**本地墙上时钟 16:00**。两者只在当天没有闰秒式增减时相等。

- **现量**（两条独立实现交叉核对：`zoneinfo` 与 BSD `date -j`，非 DST 日逐位相同）：
  `America/Los_Angeles / 2026-11-01`（回拨那天）用户输入的 16:00 = `1793577600000`，
  而零点 + 16h = `1793574000000` → 折回墙上时钟是 **15:00**，差 **3 600 000 ms**。
  `Asia/Shanghai` 同一天差 `0`。本机模拟器 `persist.sys.timezone=Asia/Shanghai` ⇒ **今晚的验收不会撞上**。
- **后果不是显示问题**：提醒算的是 `dueDate - offset`，差一小时就是差一小时；而跨换日界的那次编辑
  在界面上完全看不出来（框里回读还是 16:00 —— 因为它读的是 `localTimeOf`，同一个朴素算法反着算回去）。
- **归属**：领域层的日历算术，**不归本线**（本线只做输入侧接线）。修法是把 epoch 构造改成
  按 `LocalDate + LocalTime` 在宿主时区里**构造** Date，而不是加毫秒 —— 要一并决定"跨日界那天
  重复的 01:30 算哪一次"（fold），所以这是一次需要拍板的改动，不是顺手修。
- **本线已经做的那一步**：`scripts/verify-mobile-due-time.sh` 的判据 ⑩ 断的是**产品结论**
  （写几点就是几点），所以这个缺陷一旦出现就会红；脚本文件头第 4 条实测事实把它连同读数写了下来，
  就是为了防止下一个人在那天把它当 flaky 改回"实现的样子"。
- **现量命令**：

```bash
TZ= python3 -c '
import datetime
from zoneinfo import ZoneInfo
tz=ZoneInfo("America/Los_Angeles")
midnight=int(datetime.datetime(2026,11,1,0,0,tzinfo=tz).timestamp()*1000)
wall=int(datetime.datetime(2026,11,1,16,0,tzinfo=tz).timestamp()*1000)
print("墙上 16:00 =",wall,"  零点+16h =",midnight+57600000,"  差 ms =",wall-(midnight+57600000))'
```

---

## 5. 下一步（有序，每条带开工判据）

1. 🔴 **任何 e2e / 界面判据开跑前先跑一次体检**：`node scripts/dist-freshness.mjs --only <这次真的读了哪些包>`。
   这是 D 那条查出来的**通用前置动作**，不是它的一次性收尾 —— vite dev 与 vitest 都读 `packages/*/dist`，
   产物落后时判据打的是旧代码（AGENTS §7 第 27 条一族），症状是"我改了、判据红/绿得说不通"。
   ⚠️ 已经做掉的：原第 1 步"先拿 D 的原始 message"**在 21:0x 结束了**，两个原因 ——
   ① 探针的 B 腿当时是**探针自己坏了**（桩是我简写的，`GET /api/account/avatar` 回 `{avatar: null}`，
   与真 spec 形状不一致 ⇒ 停在上传、根本没走到 reload）。已改成**逐字复制**真 spec 的 `fakeServer`。
   ② 修好之后**崩溃不可复现**（三趟全绿）。剩下的是 §4 D 那条重开判据，不是待办。

   ✅ **22:4x 新会话已跑这一步，读数在过程账 §3·补**（`node scripts/dist-freshness.mjs` 14 包里只有 `i18n` 的产物旧 115s；
   `--only ui,domain,i18n,app-host,shared-schema,storage,op-log,sync-client` 同一结论）。
   🔴 并且**这次把"落后到底影不影响判据"量到了值层**：`src` 的 2858 个键 dist **全部解得出**，值只差 1 处
   （`site.docs.reminders.s2p3`，W9 那条线的落地页文案，不在本线断言路径），四档标签 src/dist 逐字相同，
   而旧键 `web.calendar.view.*` 已**不在 dist** ⇒ 那份产物是 rename 之后的 ⇒ **H 可以在当前 dist 上跑，不会假红**。
   ⚠️ 交接 §3 那行 21:1x 记的 `app-host/domain/ui` 三个落后包此刻已全部追平 —— 那张表照它自己说的在漂。
   🔴 **00:2x：本会话 00:1x 那条"0 个落后"读数作废**，因为 `--only` 吃的是 `packages/` 下的**目录名**，
   而我当时传的是 `@heyta/ui` 这种**规范包名** —— 五个名字一个都没匹配上，脚本打印
   "0 个包 ⇒ 本机判据读的都是当前产物"并**退 0**。修法与五臂实测在过程账 §3·补 ⑬ 第 1 节
   （两种写法现在都认，匹配不上的一律 exit 1，并把"请求 N / 命中 N"打进表头）。
   ✅ 修完的真读数（HEAD `f6478fad`）：`ui` 产物旧 35s、`app-host` 旧 337s（两条都是别人正在改的文件：
   `packages/ui/src/projects/*`、`packages/app-host/src/vault-session.ts`），`i18n`/`domain`/`storage` 产物新；
   **本线自有源作用域 7 个全部已进当前产物（落后 0）** —— 这一问整包读数答不了，只能按作用域量。
   ✅ 本线 15 枚判据文件在新载体上复跑：**130 passed / 0 failed，逐组 rc=0**（读数在 §3·补 ⑬ 第 3 节）。
2. ✅ **H（R17 的那张浏览器截图）已闭合（23:19）—— 只剩一枚 flaky 待追，见 §4 H 末与过程账 §3·补 ⑨。**
   ✅ 用例早就写好了（`e2e/tests/calendar-view-options.spec.ts`，两条），22:52 第一次真跑：
   **① 过并出图** `view-select-closed.png`（人已看过，md5 `f096b90d…`），**② 红**，红因是 spec 自己
   把**拼装出来的** testID 写成精确等值（`Received: 0`）—— 已改成前缀 + `[role="button"]`，
   并补了一条内建对照（同前缀不带 role 必须 > 12）。逐条读数在过程账 §3·补 ⑧。
   ✅ **23:19 已复跑并闭合**：`RUN_RC=0`，两张图 + README（含"看见了什么"与两枚 md5）都在
   `apps/web/evidence/calendar-view-options/`，两张图人都打开看过。
   ⚠️ 但 summary 是 `1 flaky / 1 passed` —— 那枚 flaky 单独挂账，重查命令在过程账 §3·补 ⑨。
   🔴 **00:33 复测读数：窗口没等到，本轮没跑。** 看守在 00:18:51 起，等满 900s 预算负载**不降反升**
   （127→16 之间反复，最后四档 112 / 110 / 105 / 77），日志末行 `GATE=timeout rc=3`
   —— 而**包装命令退的是 0**（traps #164 的形状，读数只能看日志哨兵）。
   ⇒ 已用 `BUDGET=3600` 重启同一看守（预算现在是旋钮，上一趟日志留在 `/tmp/ht-h-flaky.log.prev`）。
   这不是产品结论，也不是"flaky 已解释"：解释它需要**连跑三趟的 flaky 计数**，那个数还不存在。
   🔴 **同一条门上还挂着本线另外 4 枚 e2e 读数，本轮（00:2x–00:4x）没有重跑，不许被当成"刚验过"**。
   逐枚带**原文记录的时间与读数**（我第一版把这里写成"20:5x–22:5x 那两趟"，那是凭印象 ——
   现查台账真值是 06:15 / 07:49 / 18:53，正好是本篇 §3 自己警告过的那个错，写在下一行）：
   - `e2e/tests/calendar-year.spec.ts` = **3 passed (8.0s)**（06:15，§3·补 R13·补 那行）
   - `e2e/tests/calendar-day.spec.ts` = **5 passed (9.4s)**（07:49，R14 那行）
   - `e2e/tests/calendar-day-en.spec.ts` + `e2e/tests/profile-avatar-e2ee.spec.ts` = **3 passed (9.1s) / rc=0**（18:53，日志 `/tmp/r15b-r16-e2e.out`）
   ✅ 本轮**不需要端口的那一半已经复跑**：
   `cd e2e && NO_COLOR=1 npx playwright test tests/calendar-year.spec.ts tests/calendar-day.spec.ts tests/calendar-day-en.spec.ts tests/profile-avatar-e2ee.spec.ts --list`
   ⇒ `Total: 11 tests in 4 files`（rc=0）。这条挡住"导入被别人的重构打坏 / 用例收集不到"，
   🔴 **挡不住选择器语义与真渲染**（见本篇待入的那条"静态预验能挡形状挡不住语义"）——
   所以 11 这个数字**不是**这四枚 spec 的通过读数，只是它们还站得住。
   ⚠️ 这 4 枚是 **jsdom 那 130 条挡不住的一层**（真浏览器 + 真 TLS + 英文会话 + 头像 E2EE 往返），
   两组读数不许混着引。
   开工判据（**用仓内 canonical 门，不要自己剥 `vm.loadavg` 的花括号** —— traps #168）：
   `. scripts/lib/wait-for-quiet-host.sh` 给 `wait_for_quiet_host || exit 3`（阈值 `hw.ncpu×3/4`），
   再过本线加严那一层（`uptime` 那个数落回个位），且 `lsof -nP -iTCP:4318 -iTCP:4319 -sTCP:LISTEN` 为空 ——
   🔴 **端口判据每次采样都要配一条阳性对照**（拿一个已知在听的端口验 lsof 没坏；本会话第一版看守就漏了这条）。
   跑法：`cd e2e && NO_COLOR=1 npx playwright test tests/calendar-view-options.spec.ts`。
   🔴 不许为了赶这一步 SIGKILL 别人的 vite，也不许降级成"用 jsdom 那张图交差"。
   ⚠️ 原文那句"再按 §4 H 那条**写用例**"作废 —— 用例已存在，欠的是跑与看图。

3. **B（四端重装）**。⚠️ **前置比原来那条宽**（理由与现量在过程账 §3·补 ⑦/⑦·附）：
   原来只写"`packages/op-log` 干净 + 它的 build exit 0"，但 `reinstall-all.sh` 打的是**工作树**，
   23:03 现量 `apps/mobile` 有 **58 枚**未提交文件（`VaultSettingsSection/SettingsScreen/ProfileScreen` 是一分钟前刚写的）、
   `packages/i18n` 两份词条表在别人手里、**`scripts/reinstall-all.sh` 自己也是 `M`**。
   ⇒ 开工判据改成三条同时成立：① `git status --porcelain packages apps/mobile apps/web` 里没有不属于本线的 `M`；
   ② `git status --porcelain scripts/reinstall-all.sh` 为空；③ canonical 负载门过。
   然后 `IOS_DEVICE_NAME="heyta-iphone-17pro" bash scripts/reinstall-all.sh; echo "EXIT=$?"`。
   ⚠️ 别把"等闸门跑完"和"重装"串进同一条后台命令（会撞 10 分钟上限，中途 ssh 被杀会把远端构建打断在半路）。
   ⚠️ `IOS_DEVICE_NAME` 这个值本身要现量：22:5x 现量 booted 的是 `heyta-ios-isolated` 与 `iPhone Duo heyta`，
   **没有** `heyta-iphone-17pro` ⇒ 用 `xcrun simctl list devices booted` 现取，别照抄这个名字。
   🟢 **00:1x：那三条判据现在有了一条命令在替人跑** —— `scripts/verify-mobile-window-gate.sh --target b`
   （默认 dry-run，只体检并列出会被打进产物的未提交文件；`--confirm` 才执行，退出码 0/1/3 分开：
   0 窗口开、1 用法错、3 现场不成立 = 环境无效**不是产品失败**）。它用规范实现 `wait-for-quiet-host.sh` 的阈值，
   且**不 source `lib/mobile-e2e.sh`** —— 那个 lib 文件尾挂着 `trap restore_ime EXIT`，
   一次"只是看看窗口开没开"的 dry-run 不该动设备状态。
   同一趟现量（00:12）：`scripts/reinstall-all.sh` 已**干净**（②成立），
   booted 模拟器**正是** `heyta-iphone-17pro`（原来那个名字这次不用改了，但它是现取的、不是抄的），
   ①不成立：**26 枚**未提交源码，整片是 vault 密钥迁移那条线（`app-host/vault-*`、`server/sync/*`、两份词条表、`ui/projects/*`）；
   ③不成立：负载 19–21（阈值 12）。⇒ **B 仍不可执行，但拦它的只剩"别人的 26 枚提交"**。
   🔴 **00:2x 现量：⑫/上面那句"拦它的只剩别人的 26 枚提交"被否证 —— 那 26 枚的一部分已经入库了，
   而 B 仍然不可执行，拦它的换成了另外三件事。** 同一趟读数：
   - `git status --porcelain packages/op-log` = **空**，`-- scripts/reinstall-all.sh` = **空**
     ⇒ 原来那两条前置（op-log 干净 + 脚本本身干净）**现在成立**（载体 HEAD `f6478fad`）。
   - ①仍然不成立，只是换了数字与主人：`git status --porcelain packages apps` = **28 枚 `M` + 7 枚 `??`**
     （apps/web 11 / `packages/app-host` 7 / apps/mobile 7 / packages/ui 5 / sync-client 2 / i18n 2 / storage 1）。
     在共享检出里跑就是**把这些 WIP 装进四端而判据照样全绿**（§7 第 82 条那一族）。
   - ③仍然不成立且**更坏**：负载从 40 涨到 77–112（阈值 12），`apps/mobile/android` 上有活着的
     Gradle/Kotlin 守护进程（同一构建目录，AGENTS §8.9）。
   - `IOS_DEVICE_NAME` 现量：booted 三台 = `heyta-iphone-17pro` / `heyta-ios-isolated` / `iPhone Duo heyta`
     ⇒ 名字对，但**归属没协调过**。`windows-pc` 此刻 `ssh` 可达（`WIN=OK`）。
   ⇒ **B 唯一可执行的形态**：按提交 SHA 切**干净检出**来跑（本线先例见记忆「四端重装改在隔离检出里跑」），
   且等负载与设备窗口。⚠️ 切干净检出有一条**必须先知道的坑**（本轮实测）：
   `heyta-wt-verify-integration/node_modules` 是指向**另一个 worktree** 的软链，
   而 pnpm 的 workspace 软链是**相对**路径 ⇒ **00:4x 实测**（不是推演）：
   在那棵树里 `realpath apps/mobile/node_modules/@heyta/ui` = **`…/heyta-wt-ai-closeout/packages/ui`**
   ⇒ "在 X 检出里打包"实际打的是 **Y 的源码**，而所有判据照样绿。
   ⇒ 载体里必须真跑 `pnpm install`，**不要软链 node_modules**。
   开跑前的验收一行（已实测可用）：
   `node -e 'console.log(require("fs").realpathSync(require("path").resolve("apps/mobile/node_modules/@heyta/ui")))'`
   打出的路径必须落在这棵检出里。🔴 别拿 `require.resolve("@heyta/ui")` 当配方 —— 该包无 `main`、只有 `exports`，
   CJS 解析器当场报错；要按"链接真实存在的位置"验。
   复跑：`bash scripts/verify-mobile-window-gate.sh --target b`（dry-run）→ `--confirm`。
   🔴 **00:5x：这三条判据不够，现场教出来的第四条已经写进闸门了。** 见过程账 §3·补 ⑭ 全时间线，摘要三句：
   ① 00:48:37 现量 `packages`/`apps` **0 枚脏** + 服务端 `:3000/health` ok + 凭据三件套齐 + APK `00:36:59`，
   ② 我据此起了 B，40 秒后 `ps` 查出 **`88869 .verify-mobile-ios-reminder.sh.snap.88869` 正在跑** ——
   我的闸门当时打印 ✅"没有别人在抢设备"，因为那份 pgrep 抄件跨不过路径空格、也看不见 `.snap` 形态
   （`ad9dce8e` 00:47:53 刚修完公开函数并点名了我这份抄件；`eb03420a` 00:50 把它接上共用探针），
   ③ 我随即停掉；日志证明它停在段 1 的 `package-app.sh`（`Terminated: 15`），
   **`simctl uninstall` / `adb uninstall` 都没执行过**：`/Applications/Heyta.app` 仍在（mtime 23:05）、
   `pm list packages | grep -c heyta` = 2、对方进程未受影响。
   ⇒ **第四条开工判据 = 设备与模拟器上没有别人的验收在跑**（`lib/mobile-e2e-runner-probe.sh` 的
   `mobile_e2e_runner_lines`）。🔴 **`reinstall-all.sh` 自己不查这一条** —— 它只查"工作树干净"，
   而"干净"与"没人正在用这台设备"是两件事（AGENTS §8.9 在打包输入那一侧有门禁、设备状态那一侧没有）。
   现跑（00:5x）该段读数：**❌ 有移动端验收在跑（pid 16583）** ⇒ B 与 C 仍不可开跑。
   ⚠️ 我这趟还留下一笔要如实说的副作用：段 0 把共享检出**全部 `packages/*/dist` 重建了一遍**（约 00:49:2x）。
   源码未动、产物与提交后源码一致，但当时正在读 dist 的并行会话读到的是我刷新的那一份。
   🔴 **01:2x 现量复跑：B 的前置从四条变成五条，而且第五条是代码侧的红，不是现场。**
   `sh -c 'NO_COLOR=1 bash scripts/verify-mobile-window-gate.sh --target b > /tmp/x 2>&1; echo rc=$?'`
   ⇒ **rc=3**，负载 **89**（1 分钟值，15 分钟前还是 13.79 —— 单点读数不是窗口）、脏源码 **45 枚**（00:2x 是 28 枚，
   涨在 vault/提醒那条线：`packages/{app-host,storage,i18n,ui,sync-client}`、`apps/{web,mobile}`、6 枚 vault-panel png、`server/tests/*`）。
   **新第五条 = `pnpm -r build` 此刻在主检出是红的**：
   `packages/i18n/src/locales/en.ts(74,3) TS1117 同一对象字面量里重复键`，
   只读扫描现量 `common.sync.error.accountClosed` **第 73 行与第 74 行相邻重复**（工作树 en 2982 键 / 重复 1 处；
   zh-CN 重复 **0** 处 —— 日志里那条 `zh-CN.ts(97,3)` 已被对方改走，引用它要带趟）；
   阴性对照 `git show HEAD:` 两本表各 2980 键、重复 **0** ⇒ **HEAD 建得出，红的这截在未提交改动里**。
   为什么原先那句"只有 tsup 的 dts 阶段会报、typecheck 放过"**不成立并已撤回**：
   一次性夹具（相邻两个同名键）跑 `npx tsc --noEmit --target ES2022` ⇒ **照样报 TS1117**，
   所以 `pnpm -r typecheck` 覆盖这一类；而 01:27/01:28 两次 `pnpm --filter @heyta/i18n typecheck` **rc=0**
   的正确读法是**那枚重复键在那之前已被所有者改掉**（01:28 现量：en 0 处 / zh-CN 0 处，各 2982 键）。
   ⇒ 🔴 **这条"第五条前置"的有效期只有四分钟**，现在大概率已经不成立。
   全量 `pnpm -r build` 本会话**没有重测**：重测的代价是再重写一遍 7 枚 dist，
   而这本来就是 B 自己第 0 步的岗位 —— 由它来量，不在这里预先宣布它过了。
   ⚠️ 另一件不属于本线、由这轮顺带量到的红：`pnpm check:ui-language` **rc=1**，6 处全在
   `apps/web/src/lib/local-data-destruction.ts`（未跟踪新文件，HEAD 里没有）—— 别人的在飞文件，不由本会话改。
   **不归本会话改**（AGENTS §8.2 不为跑绿动别人半成品），归 vault/账号关闭那条线，复跑命令：
   `node /tmp/ht-guard/dupkeys.js`（只读扫；它是本轮的一次性夹具，若要长期守应落成 `scripts/` 里的门禁）。
   ⚠️ 同时如实登记本会话的一次自伤：为测闸门"取哪台 iOS 设备"抽行配桩时**多抽了末行**，
   于是主检出里真跑了两次 `reinstall-all.sh`。两臂都停在它自己的第 0 步（rc=1）：
   `/Applications/Heyta.app` mtime 仍 23:05、`pm list packages` heyta 计数仍 2、焦点仍 `com.heyta`、booted 仍 3 台 ——
   **没有卸载/安装发生**；但 **7 枚 `packages/*/dist/index.js` 在 01:24–01:25 被重写**，
   含 `i18n/dist`（它的源码此刻带重复键，JS 取后者 ⇒ 现在读 i18n 产物的人取到的是第 74 行那版英文）。
   ✅ 闸门本身这一轮修了两处（都不是为了跑绿）：`$BOOTED` 未加引号导致模拟器名被分词显示成
   `iPhone; Duo; heyta`；以及三台 booted 时静默取第一台 —— 现在外部 `IOS_DEVICE_NAME` 优先、
   取到的整名与来源都会打印、列表为空则 exit 3 不猜目标。
   🔴 **01:5x 逐段现量：B 的"受阻"不是一条，是四条，各自卡在不同资源上**——
   ① **mac**：`/Applications/Heyta.app` mtime `10-03 23:05:40`（比当前源码旧三小时，正是 B 要修的那件事）；
   它写的是全机共享的 `/Applications`，而另一条会话的 mac 壳判据读的就是那份安装副本。
   ② **ios**：`xcrun simctl list devices booted` 现量 **3 台 Booted**（`heyta-iphone-17pro` /
   `heyta-ios-isolated` / `iPhone Duo heyta`），目标设备名在列 ⇒ 闸门那条 ✅；🔴 但同一时刻
   `.verify-mobile-ios-reminder.sh.snap.36041` 正在跑（pid **36041**，W9 那条线的 iOS 验收），
   而 ios 段的动作序列里就有 `simctl uninstall` —— 那会把对方那趟的界面连数据一起卸掉（AGENTS §8.9）。
   ③ **android**：`emulator-5554` 在线，`pm list packages` 里只有 `com.heyta` + `com.heyta.test`
   （焦点 `com.heyta/com.heytamobile.MainActivity`，Java 包名与 applicationId 不同是预期的），
   但同一台 emulator 也正是 C 的载体，android 段的 `adb uninstall` 会把 C 待射那一趟的重装掉
   ⇒ 与 ② 同一个运行者阻塞。
   ④ **windows**：打包机可达（`ssh -o BatchMode=yes windows-pc "echo WIN_OK"` ⇒ `WIN_OK`）⇒ 这一段不缺主机；
   缺的是"送过去的字节 == 当前源码"：主检出 `packages`/`apps`/`server` 现量 **86 枚脏**（全归 vault 那条线），
   而 `sync_windows_sources()` 送的就是在作工作树 ⇒ 在主检出跑等于把别人的 WIP 打成产物。
   ✅ ④ 有现成的干净载体：`heyta-wt-r14c`（闸门五节里工作树那节 ✅）。
   ⚠️ 如实记一次自伤读数：我这轮第一条数 booted 的命令写成小写 `grep -c 'booted'` ⇒ 报 **0**，
   而 simctl 的状态串是 `(Booted)`（仓内 `reinstall-all.sh:368` 用的就是 `grep Booted`）——
   打印原始输出才发现是探针坏了、不是模拟器全关，这是 AGENTS §7 元规则一（先怀疑探针）的又一次现量复现。
4. **C（R14c 的 Android 真机腿）**。🟢 **23:5x 更新：那条脚本已经写出来了** ——
   `scripts/verify-mobile-due-time.sh`（604 行 / 14 step / 11 判据 + 3 对照，离线先验读数见过程账 §3·补 ⑩）。
   原写法仍然有效：bootstrap 在前 15 行（实测在第 3 行），`MANIFEST` 那一行**待插**
   （`scripts/check-script-snapshot.mjs` 正被并行会话 `M`；漏插**不会**让任何门禁红，
   该文件头自己写明它不查漏登记）。
   判据 testID 是**拼装值**：`task-due` + `-time-input` / `-time-all-day`（见过程账 §3·补 ⑥，别按字面 grep 判它"不存在"）；
   设备侧走 `resource-id`（RN 的 testID 在 Android 落这一位，`verify-mobile-quadrant-fill.sh:115` 已实测）。
   🔴 **行上看不到时刻**（`formatCompactDate` 只出 `MM-DD`）—— 别在这条腿上写"行上出现 16:00"，那是恒红。
   现量：C 的七条前置里**五条不满足**，四条是同一条命令能一起补的：
   `bash scripts/mobile-e2e-up.sh`（起服务端 + 建号写 `/tmp/heyta_mobile_{token,email,e2ee}.txt`，此刻三者全无）
   → `pnpm --filter @heyta/ui build && pnpm build:android`（APK 现量 `23:24:49`，最新源码 `23:46:47` ⇒ 脚本第 0 步会 exit 3）
   → 负载落回个位（现量 73）
   → **且等并行会话把 `apps/mobile`(30 M+25 ??) 与 `packages`(85 M) 提交**，否则装的是别人 WIP 而判据全绿。
   设备独占这一条此刻**是满足的**（`another_mobile_e2e_running` 输出空；`bash -n` 那种预检不算运行者）。
   🔴 **00:2x 更正上面最后那条，它把 C 的阻塞写重了**：现量 `git diff HEAD` 对本线那三枚源
   （`apps/mobile/src/screens/TaskDetailSheet.tsx`、`packages/ui/src/date-picker/DatePicker.tsx`、
   `apps/mobile/src/lib/date-picker-labels.ts`）**零差异**，且 HEAD 里
   `TaskDetailSheet.tsx:709/713` 有 `testID="task-due"` + `time={{…}}`、`DatePicker.tsx` 里有
   `-time-row` / `-time-input` / `-time-all-day` 三个合成 testID。
   ⇒ **C 验的东西全是已提交代码，不需要任何人的 WIP**；"等别人提交"那一条对 C 不成立（对 B 成立，见上一条）。
   00:2x 现量 C 的七条前置：设备在线 `emulator-5554`（焦点 = `com.heyta/MainActivity`，无人跑设备验收）、
   `bash -n` 三个脚本全过、`lib/mobile-e2e.sh` 工作树 blob == HEAD blob（`0f2b502f`，那条在重构 lib 的线**此刻没落盘**）、
   MANIFEST 已登记。🔴 不满足的四条：`:3100` 与 `:3000` 的 `/health` 都 **rc=7（连接被拒，无服务）**、
   凭据三件套全无、APK mtime `10-03 23:24` 落后于 `apps/mobile/src/screens/{Tags,VaultSettings}*` 与
   `packages/ui/src/projects/*`（**这些是别人的改动** ⇒ 从共享检出重打会把它们打进 APK），负载 40→112。
   ⇒ C 的正解与 B 同一个：**从 HEAD 切干净检出 + 真 `pnpm install`（不软链 node_modules）+ 在那里 build**，
   打完的 APK 只含已提交代码；设备腿本身仍要等 emulator 窗口与负载门。
   复跑（干跑体检，不动设备）：`bash scripts/verify-mobile-window-gate.sh --target c`。
   🟢 **01:1x 现量：上面那句"正解 = 切干净检出 + 真 install + 在那里 build"已经做完了，不是建议。**
   载体 `heyta-wt-r14c`（detached **`93113e30`**）里 `research/tools/r14c-carrier-chain.sh` 六步跑了五步全 rc=0：
   install → **解析自证**（`realpath apps/mobile/node_modules/@heyta/ui` = 载体内的 `packages/ui`，
   这条就是 00:4x 那个软链事故的正面反证）→ `pnpm -r build` → 起栈 → **`build_android` rc=0，
   `app-release.apk` 66 785 752 B / 01:05:18**。第六步 `verify` **exit 3**，原因是它自己第 0 节的
   设备体检当场数出**别人那一趟在跑**（`2227 bash …/scripts/.verify-mobile-auth.sh.snap.2227`，etime 43s）——
   🔴 这是运行者探针**第一次抓到外部运行者**（00:4x 那次抓到的是我自己的盲副本），而且我这趟
   **零设备动作就退出**，没动过 `pm clear`/安装。
   ⇒ 闸门对载体干跑：**rc=3，6 ✅ / 2 ❌**，红的只剩 **负载 49 > 12** 与 **设备上有运行者**；
   而 `APK 不比源码旧` 这条**自己从红翻绿**（APK 01:05:18 > 最新源码 01:00:54）——
   它测的就是"打包做没做"，所以载体打了一次包它就该绿。
   ⚠️ 原来那四条"不满足的前置"（`:3000`/`:3100` 无服务、凭据全无、APK 落后、需要别人的 WIP）
   现在只剩**环境两条**：负载与设备独占。代码侧一条都不欠。
   🔴 **01:5x 复跑（"引用前必须复跑"这条规矩现量过了）**：窗口重试装置已到第 **40** 趟
   （`/tmp/ht-r14c-window.log`，01:46:43 那一趟），闸门五节与上面**逐节相同**——
   工作树 ✅ / 凭据三件套 ✅ / `:3000/health` ✅ / **APK 不比源码旧** ✅ / MANIFEST ✅，
   红的仍是同样两条：负载（那趟现量 **268**，阈值 12）与设备独占
   （**运行者 pid 在轮换**：67993 → 87967 ⇒ 别人那趟设备验收收了又起了一趟新的，
   不是同一趟跑了四十分钟）。
   ⇒ "代码侧一条都不欠"到 01:5x 仍成立，且**不必重打包**：闸门自己数的 APK `01:05:18`
   仍晚于载体内最新源码 `01:00:54`。
   **可复跑命令（等窗口并自动射，不重复实现任何前置）**：
   `CARRIER="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-r14c" BUDGET=3600 bash research/tools/r14c-window-retry.sh`
   （日志 `/tmp/ht-r14c-window.log`，哨兵 `ATTEMPT rc=` / `WINDOW=open|timeout` / `ALL_DONE final_rc=`；
   四臂自测：缺载体 exit 1、预算 0→3 且写 `WINDOW=timeout`、桩闸门退 0→0、桩闸门退 7→**7** 不被洗白）。
   🔴 **02:0x：那两条新守卫已经先验到有牙了（零设备、零窗口 —— PATH 里的桩 adb）**。做法是把
   `scripts/verify-mobile-due-time.sh:336-348` **逐字节**抽出（`cmp -s` 与源相同；抽完先 `tail -2` 确认末行是
   `ok` 而不是紧接着那句 `pm clear` —— 上一轮"多抽一行副作用"的教训照做了），套上 `ok` / `bad` / `screen_txt`
   三个 helper 桩与 `$ADB`、`$APK_SHA` 两个变量，三臂各跑一次、退出码单独取：**ok** ⇒ rc=**0** + `OK_LINE`
   （句中带回 `APK sha256=…`，即产物归属被打进了绿线）+ 走到块尾；**fail**（桩回 `Failure [INSTALL_FAILED_ABORTED]`
   且 rc=1）⇒ rc=**1** + `BAD_LINE: adb install 退出码 1 ⇒ 停…` + `SCREEN_TXT_CALLED`（第一条红会 dump 屏幕）；
   **quiet**（桩 **rc=0 但输出里没有 `Success`**）⇒ rc=**1** + `BAD_LINE: …退出码 0 但输出里没有 Success…`，
   且**没有** `SCREEN_TXT_CALLED` —— 第二条红不 dump，这是形状差异不是缺陷，如实记着。
   ⚠️ 第一趟三臂**全部塌成同一条"退出码 126"的红**：桩忘了 `chmod +x`。红的是我的探针，不是判据
   （AGENTS §7 元规则一）。修的是装置 —— 加一句前提断言 `[ -x "$ADB" ] || exit 4`，三臂这才分开。
   🔴 **顺带量清一件之前没人写过的事：窗口开时那一趟跑的到底是哪份判据。** 装置调的是**载体那份**
   （`r14c-window-retry.sh:25` `GATE="$CARRIER/scripts/verify-mobile-window-gate.sh"`）。载体（detached `93113e30`）现量：
   `scripts/verify-mobile-due-time.sh` 是 ` M` 且与主检出工作树**逐字节相同**（⇒ 带着上面这两条新守卫）；
   `scripts/verify-mobile-window-gate.sh` 是 `SAME_as_HEAD`，**没有** 01:2x 那两处修复（与主检出 diff **25 行**，逐条读过：
   一处是 booted 名字的显示分词、一处是 `--confirm` 取 iOS 目标）。⇒ **对 `--target c` 的裁决没有影响**
   （那两处只作用于 iOS 那一侧的显示与 `--target b` 的取设备），但归属必须写准：**这一趟如果绿了，
   绿的是"HEAD 的产物 + 尚未提交的判据守卫"** ⇒ A 那份点名清单里"两枚脚本与两份文档同一笔"不是仪式，
   否则下一个人拿不到同一条判据。载体那份 ` M` **不会**被闸门第二节拦住，因为第二节只
   `git status --porcelain -- packages apps server`（`verify-mobile-window-gate.sh:87`），`scripts/` 不在范围里。
   判"这一趟用的是带守卫的那份"的现量命令：
   `cd <载体> && git status --porcelain -- scripts/verify-mobile-due-time.sh`（应打 ` M`）`&& grep -c INSTALL_RC` ≥ 1。
   ✅ 另清一处疑点：脚本里剩下的那枚 `tail -1 | sed`（`:250`）**不是漏网的管道判据** —— 它取的是 `wm size` 的**值**，
   紧跟 `case "$SW$SH" in ''|*[!0-9]*)` 拒空值/非数字并 exit 3，还会把原始串打出来（`:252-254`）。
5. **A（入库）** —— 🟢 **00:0x 现量：本会话没有 `git add`，但别人那笔 `2f735392`（"并行批次的总接线 —— 门禁注册、词条表、包清单与证据归位"）
   把工作树整片吸了进去，本线 **19 枚判据文件里 17 枚已在 HEAD**（含 23:5x 刚写的 `scripts/verify-mobile-due-time.sh` 与台账整段），
   五张证据目录合计 **29 枚 png 已在 HEAD**，`check:docs` 指向本线的红 **归零**（现量 2 红全在 `countdown-anniversary.md:1091/1295`，不归本线）。
   ⚠️ 两条仍然成立：① **`e2e/_probe/probe-reload-crash.spec.ts` 与 `e2e/playwright.probe.config.ts` 两枚仍在仓库外**（现量 `git ls-files` OUT）；
   ② 本文件（handoff）自己此刻是 ` M` —— 我 23:5x/00:0x 写的 §0、§4 A 的 19 枚清单、§4.1 的 H 条、§5 这几行**都还没进 HEAD**。
   🟢 **00:2x 现量更新（三处数字都漂了）**：OUT 是 **3 枚**（上面两枚 + **`scripts/verify-mobile-window-gate.sh`**，
   它是 00:1x 新写的那条窗口闸门；`verify-mobile-due-time.sh` 已在 HEAD）；
   `scripts/dist-freshness.mjs` 此刻是 ` M`（我 00:2x 修的 `--only` 参数语义，属"修改"不计入 OUT 枚数）；
   `check:docs` 的红从 2 涨到 **6**：`countdown-anniversary.md:1091/1295`（两枚**干净** ⇒ 红在 HEAD 里，W7 那条线）
   + `docs/adr/0050-e2ee-key-lifecycle-and-recovery.md:93/94/95/98` 四条指向**未跟踪 png**（该文件本身 ` M` ⇒ vault 那条线在飞）。
   🔴 **6 条一条不归本线，不代改、不吸收、不为它放宽判据**。
   ⚠️ 而 OUT 那三枚里，window-gate 这一枚的后果比"缺一个文件"大：
   **本文件与过程账合起来引用它的复跑命令 6 次**（`grep -c` 现量 4+2），
   而 `check:docs` **只扫 markdown 链接，不扫反引号里的路径**（本轮实测：那 6 处一条都没报）
   ⇒ 在干净检出上这些"可复跑命令"是死引用，**没有任何门禁会红**。⇒ 入库时它必须与两份文档同一笔走。
   复现：`git show --stat 2f735392 | head`、`git ls-files --error-unmatch <那两枚>`、
   `NO_COLOR=1 node research/tools/docs-link-check.mjs > /tmp/docs.out 2>&1; echo rc=$?; grep -c '\->' /tmp/docs.out`（=2）。
   🔴 **别把"别人已经提交了"读成"本线入库完成"**：上面那份点名清单（19 枚 + 三份文档 + 五张证据目录）
   是**下一次真有提交权时的最小集**，因为它同时覆盖 §4 A 原来漏 18 枚那件事 —— 现在只是有人替我们做掉了一部分。
   🟢 **00:5x：这一条现在可以判闭合了**，闭合方式与上面那句警告不冲突 —— 不是"我以为好了"，是**逐枚现量**：
   `git ls-tree HEAD` + `git status --porcelain` 两边都取过，本线点名的文件里除过程账本篇（正在被写）之外**全部在 HEAD 且工作树一致**；
   那两枚 `e2e/_probe` 探针**本来就不是债**（`.gitignore:196-197` 从 23:58 起带理由登记为"勿提交"，
   我把它记成债并写进 `git add` 清单，那是错的，纠正见 §4 A）。⇒ **A 无待办。**
   🔴 **01:3x 更正：上面那句"A 无待办"此刻不成立了** —— 它成立的前提是"本线点名的文件全在 HEAD"，
   而我随后又写了四枚新装置、改了两枚已跟踪脚本。**旧范围的完成证据不覆盖新增项**（AGENTS §8.7）。
   现量未入库对象 = **4 枚 `M` + 4 枚 `??`**，全部属于本线（同目录下筛过，`research/tools/` 里没有别人的未跟踪文件），
   下一次有提交权时的**点名最小集**：

   ```bash
   git add docs/plans/calendar-year-time-and-mobile-profile.md docs/plans/calendar-profile-handoff.md \
     scripts/verify-mobile-due-time.sh scripts/verify-mobile-window-gate.sh \
     research/tools/r14c-carrier-chain.sh research/tools/r14c-window-retry.sh \
     research/tools/h-flaky-window-watcher.sh research/tools/calendar-line-judgment-rerun.sh
   ```

   ⚠️ 两枚脚本与两份文档**必须同一笔**：`verify-mobile-due-time.sh` 的新守卫（安装退出码 + `Success` +
   APK sha256）和 `verify-mobile-window-gate.sh` 的 iOS 目标选择改动，都是台账里引用的判据本体；
   只提交文档会得到"描述了判据、判据还在工作树外"那个老形状（§4 A 原来漏 18 枚判据就是同一件事）。
   四枚 `research/tools/*.sh` 是本线的**运行装置**（载体链 / 窗口重试 / flaky 看守 / 判据复跑），
   台账按路径引用它们 —— 不入库的后果与漏 png 一样：**干净检出上那些"可复跑命令"是死引用，
   而 `check:docs` 只扫 markdown 链接、不扫反引号里的路径**（本轮实测：报 0 处）。
   复跑这份清单：`git status --porcelain -- docs/plans/calendar-year-time-and-mobile-profile.md docs/plans/calendar-profile-handoff.md scripts/verify-mobile-due-time.sh scripts/verify-mobile-window-gate.sh research/tools/`

6. **E（接门禁）** —— ✅ **00:01 已落地**（`package.json` 在那笔提交之后是干净的，前置满足）：
   新增 `"check:md-tables": "node scripts/check-md-table-rows.mjs"`，并把 `pnpm check:md-tables`
   插在 `pnpm check` 链的 `pnpm check:docs` 之后（链现量 **63 段**、该条目出现 **1 次**、`require('./package.json')` 解析通过）。
   **它有牙**：在台账第 664 行注入一枚错位表行 ⇒ `pnpm check:md-tables` rc=**1** 并指到行号
   （报的是"表头下面没有分隔行"那一档，不是列数那一档 —— 两条都是它自己的判据，这里如实写）；
   用 `cp` 复原后 `cmp -s` 字节级相同、复跑 rc=**0**。改动**只有 package.json 两行**，未 `git add`。
   🟢 **01:5x 现量收口：那两行现在已在 HEAD，不再在工作树里。** 复跑读数：`package.json`
   `git status --porcelain` 为空且 `git diff --quiet HEAD` ⇒ SAME；`git show HEAD:package.json`
   里 `check:md-tables` 命中 **2 行**（定义行 + `check` 长串中 `pnpm check:docs &&` 之后那一处，idx=879）；
   `git ls-tree HEAD` 里 `scripts/check-md-table-rows.mjs` 与 `scripts/dist-freshness.mjs` **两枚都被跟踪**
   ⇒ 过程账 §5 第 6 行那条"接进 `check` 之前必须先把两枚脚本 `git add`"的前置**由别人那笔
   `102d064f`（10-04 00:46，vault 那条线）替本线完成了** —— 它提交 `package.json` 时把我那两行整行吸了进去；
   **归属记在那笔提交名下，不记本线**。平态现量：`node scripts/check-md-table-rows.mjs` ⇒ rc=**0**
   「4 个文件，列数、断行与"是不是表"都一致」。
   ⚠️ 一条读数形状（与 §6 第 10 条同族）：这脚本的报错走 **stderr**，所以 `> out 2>/dev/null`
   在 rc=1 时留下的是**空 stdout** —— 它与"跑了且干净"长得一模一样，判成败只认退出码。
7. 边界 F 里**只有两条值得排下一批**：捕获语法的英文规则表（要先拍"规则表归 domain 还是归 i18n"），
   和 `web.*` 被移动壳读的那笔纯改名（🔴 **这里不写条数** —— 23:06 现量是 188 处 / 13 文件 / 187 行 / 180 个去重键，
   但同一个格子在 19:3x 之前写的是 179：**这条边界没有门禁，只有台账里的一个数**，所以引用前必须重跑
   `grep -rho -- "'web\.[a-zA-Z0-9._-]*'" apps/mobile/src | wc -l`，阳性对照同趟跑 `'common\.'`。要先给 `check:l4` 挣出余量）。其余留在台账里不动。
   🔴 **01:5x 按上面那句规矩复跑了一遍（这条边界没有门禁，只有台账里的一个数）**：现量
   **188 处 / 13 个文件 / 180 个去重键** —— 与上一段那组数字逐字相同（所以这次不需要改文档）；
   同趟阳性对照 `'common\.'` = **111** 处 ⇒ 扫描器接得上，188 不是探针坏出来的空读数。

---

## 6. 别重复的死路（每条都付过学费）

1. 🔴 **端口空闲判据**：`lsof -ti -i tcp:4318` 这种写法**对任何端口都返回同一个数**（现量六档全 59），
   它量的是"本机所有网络进程"。用它等端口 = 永远等不到，而且会让你把"我没做"记成"别人做了"。
   正解 `lsof -nP -iTCP:4318 -sTCP:LISTEN`，并且**必须先拿一个已知在听的端口做阳性对照**。
   `bash` 的 `/dev/tcp` 在这台机器上**根本不可用**（对活着的监听回 `closed`），比坏 lsof 更糟。
2. 🔴 **英文界面别用 `openApp`**（`e2e/tests/helpers.ts`）：它第一件事是 `pinChineseUi()`，
   写 `localStorage['heyta.locale']` = 解析链第 1 层，胜过 `?lang=`。照 `language-first-launch.spec.ts` 的
   "中立启动"形状做。另外**播种不能用英文的 `today`** —— `packages/domain/src/capture.ts` 的 `RULES`
   目前只有中文那一套，界面语言换成 en 不会把输入语法换成英文。
3. 🔴 **变异臂不要改词条表的值**：这套判据的期望串与界面读的是同一本表 ⇒ 改表两边一起变 ⇒ **永远不红**。
   牙齿在消费侧（组件写死字面量 / 换错键），见台账 §3「R16 的三支变异臂」那支 ⚠️ 更正。
4. ⚠️ **`grep -c` 命中 0 时 exit 1** ⇒ 在 `A && B && C` 链里当场断链，后面的命令根本没跑，
   而"没输出"和"跑了但 0 命中"长得一模一样（本文件 §1 那次就是这样）。数 0 的读数写成独立命令。
5. ⚠️ **往 markdown 表格行尾追加文本**：先剥掉行尾竖线、接完再补回去。直接拼在 `|` 后面 = 凭空多一列，
   而"缺一个结尾"会让"多一个分隔"变得看不见（两条结构缺陷互相抵消）。
6. 🔴 **`e2e/tests/shims.ts:127` 在 `page.reload()` 时会抛 `apiResponse.text: Response has been disposed`**
   （20:5x 实测，让一条本来就绿的用例被判成 flaky，重跑一次就过）。这是**脚手架**，不是产品缺陷 ——
   看到它别归因给界面。
7. ⚠️ **`python3 a.py && node gate.mjs; echo rc=$?` 这个形状会把前一条命令的退出码记到门禁头上** ——
   20:5x 我差点写下"`check:md-table-rows` 红了"，实际是 python 脚本的 assert 失败、node 那一趟**根本没跑**
   （单独复跑它 ⇒ rc=0）。链式命令里每个退出码都要各自取，别共用一个 `$?`（与上面第 4 条同族，方向相反：
   那条是"断链看着像 0 命中"，这条是"前一条的失败被记到后一条头上"）。
8. 🔴 **`page.reload()` 之后先等落位再取状态** —— 探针里那句 dump 我写在 reload 的下一行，
   拿到的是 `crashed:false + 捕获框:false + rootLen:0`：React **还没渲染**，不是"没崩"。
   差点把它记成"这条旅程不崩"，那是**假绿**（比假红贵）。正见 `e2e/_probe/probe-reload-crash.spec.ts`
   的 `settle()`：等 `'[role="alert"], input[placeholder^="添加任务"]'` 二者之一出现再 dump。
   ⚠️ 这是**当天第二次**犯同一个错（第一次是把 `flush` 当成"已经写完"，见复盘第 5 条）——
   同一形状换个载体就会重新踩，所以写成死路而不是教训。
9. ⚠️ **两条"命令压根没跑"的新面目**：
   ① `npx playwright test ../_probe/x.spec.ts` 恒报 `No tests found` —— CLI 参数是**正则**，
   只在配置里 `testDir`（本项目 `./tests`）**内部**匹配文件名，给它一个目录外的路径不是"绕过"，是"匹配不到"。
   正解是另开一份配置（已加：`e2e/playwright.probe.config.ts`，只换 `testDir` 与 `retries: 0`），
   而不是把探针挪回 `tests/`（那会让并行会话的套件继承一枚已知红的文件）。
   ② **块注释里写了 `packages/*/dist`** —— JS 注释里 `*/` 是内容就是终点，注释当场结束、
   后面半句变成代码，`node scripts/dist-freshness.mjs` 直接 `SyntaxError`。
   文档型脚本里的路径 glob 一律写成 `packages/<pkg>/dist`；每加一个 `.mjs` 先 `node --check` 再看它跑不跑。
10. 🔴 **`check-md-table-rows` 的报错打在 stderr，stdout 是空的**（21:4x 现量：变异臂 rc=1 时
    `stdout=''`、`stderr='✖ markdown 表格行错位 1 处…'`）。所以 `node scripts/check-md-table-rows.mjs > /tmp/out.txt`
    会留下一个**空文件**，它和"跑了且干净"长得一模一样 —— 要么 `2>&1` 一起收，要么只认退出码。
    （与 AGENTS §7 第 45 条"管道后 `$?` 是 tail 的"、上面第 4、7 条同族：**读数的载体和你的取法不匹配时，
    失败与成功在输出上不可区分**。）
11. ⚠️ **`docs/plans/README.md` 那张表的「行数」列是一条会漂的抄件** —— 本文件这一个格子在收口这半小时里
    漂了五次（213 → 269 → 271 → 273 → 278 → 279，每次都是一次正常补写）。仓里**没有任何门禁**守它
    （21:4x 现量：`grep -rln "行数" scripts/*.mjs` 命中的那几份管的是别的东西）。
    所以：**改完这两份交接物，最后一步再取 `wc -l` 并回写 README**，别在中间取；
    写 README 时它是最后一个被改的数字。
12. 🔴 **写"某道门禁管到哪一层"之前，先把那支臂也从门禁那一侧跑一遍**（22:1x，R17）。
    我把「`check:ui-language` 只比键集」当作两条判据存在的**理由**写进了三份文件（用例标题、e2e 文件头、台账），
    而**这句话我一次都没量过**。V4 一跑就否证：把 en 的值抄成中文，它自己 rc=1 并指名那一条。
    🔴 更难受的是结论没错 —— E2/E3 那种「组件里写死中文」它确实看不见（V5 实测 rc=0），
    所以如果我不是你恰好补一支臂去问"那门禁红不红"，这条**错理由会一直替我对的结论背书**。
    配方：**判据的存在理由里凡是提到别的门禁的覆盖面，那一句本身就是一支臂** ——
    把同一种病喂给那道门禁，读数写进臂表。顺带量到两件新事实：`translate()` 对缺键是**抛**
    `词条不存在`（不是返回键名），而键名↔词条表的耦合**只有判据在守**（V4c 门禁 rc=0）。
