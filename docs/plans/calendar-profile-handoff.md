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
> ⑫ **E 已落地**：`check:md-tables` 进了 `pnpm check`（链 63 段、条目 1 次；⚠️ 03:0x 复跑段数已是 **75**（别人又加了一段链），本线条目仍 **1 次**、脚本 rc=**0** —— 段数不是属性，是瞬时读数、JSON 解析通过），
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

> 🔴 **23:1x 增量（其中 ④ 与 ⑥ 已被上面那段取代，② 的 md5 与"图是当前态"已被 05:3x 取代，其余仍有效）**：
> ① §5 第 1 步体检**已跑**（14 包里只有 `i18n` 落后 115s；值层对照证明它不影响本线任何判据 —— 读数在过程账 §3·补 ①②）。
> ② ✅ **H 已闭合**（23:19 那一趟 `RUN_RC=0`）：两张图都在 `apps/web/evidence/calendar-view-options/`
> （`view-select-closed.png` `bf594d6a…`、`view-tabs-year.png` `def6cc66…`），**两张都被人打开看过**，README 已写"看见了什么"。
> 途中修掉那条 spec 自己的缺陷（拼装 testID 被写成精确等值 ⇒ `Received: 0`），并补了一条内建对照。
> ⚠️ 唯一留下的：summary 是 **`1 flaky / 1 passed`** —— ① 首趟红在 `spec.ts:114` 的 `VIEW_SELECT` 可见性、重试 1.8s 过。
> 图出自重试那次所以是当前态，但那枚不稳**没有被解释**，已单独挂账（过程账 §3·补 ⑨ 带三趟重查命令）。
> 🔴 **05:3x 更正 ② 里那两枚 md5**：它们已经**不是盘上那两枚图**（现量 `d2c5cbfd…` / `6fcbf2aa…`，mtime 10-04 01:34，
> 是另一条线的 e2e 运行重写的，图上"今天"已从 10/3 变 10/4）⇒ "人看过"这件事按**新字节**重做过一遍，
> README 的表与指纹都已改写，并补了一条常驻对账 `research/tools/r17-evidence-md5-check.sh`（平态 / `--selftest` 四臂 / `--all` 分母 / 自然实验腿的读数见 §5 第 2 项）。
> 留原句是为了认形状：**闭合过的取证交付物也会烂**，而它烂的时候没有任何门禁会红。
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
⚠️ 13:3x 另有一条**装置侧**想法登记在此但**不排进下一批**：窗口闸门的 `src` 格按 `--target` 分范围。
读了代码之后它**不是一个免费的收窄**：闸门 §2 那一格是
`scripts/verify-mobile-window-gate.sh:127` 的 `git status --porcelain -- packages apps server | grep -E '^ ?M'`
（**通用前置**，排在 `case "$TARGET"` 之前），而 `??`（未跟踪）那一档在 `:136` 原句写明不判 ——
理由跟着它：未跟踪文件进不了包，打包走 `git ls-files`。
它的职责正是 §7 第 82 条那条根判据的现场证据（"装进四端的是别人 WIP 而判据全绿"）。
⇒ 要按 target 分范围，先得逐 target **枚举打包输入集合**（b 装的是四端产物，输入远不止 `packages/ui`），
枚举不全是把那条唯一现场证据改成假绿。**登记为"要么带枚举要么不做"，不排进下一批**
（下一批只有上面那两条是产品负责人拍的数，加第三条要他改口）。
> ⚠️ 这一段我第一版写过两个错的东西，留着让下一个人认出这类错：① 把那一行写成 `:126`（那是 §2 的**标题行**，
> 差一行）；② 更贵的一句 —— 我写下"两次 `sed -n` 之间那个文件被别人动过，行号已经漂了一次"来解释①。
> 现量否证：文件 mtime 仍是 `12:59:29`（那两次读之间**没人写过它**），两次 `sed` 的输出**逐行一致**，
> 是我自己数错了行。**结论反过来才成立**：写行号前用 `grep -n` 现取，而不是先猜一个、再给猜错编一个
> "文件漂了"的外部理由 —— 后者是把自己的错包装成别人查不动的原因（§7 元规则一：先怀疑探针；这次探针就是我）。

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


### 4.05 13:2x 现量：看守那一趟的归因**撤回**，三条装置缺陷当场修掉，B/C 的持有者写明

**(1) 撤回一句本会话写下的话。** 原来记的是：
"上一趟 `r14c-window-retry` 于 07:54 后 4h20m 零写入、停在第 21 轮中途、后台任务报 exit 143 ⇒ 被 SIGTERM 收掉"。
按次日志现量否证了它：`/tmp/ht-r14c-window.20261004-073739.80863.log` **2949 行 / 81 轮 /
`WINDOW=timeout（7200s 用尽）09:38:21` / `ALL_DONE final_rc=3`** —— 它跑满预算、按设计以"环境无效"收尾，
没有任何东西杀它。我读的是**稳定名 `/tmp/ht-r14c-window.log`，而它是一枚悬空软链**
（`readlink` 指向 `$TMPDIR` 里一枚已被删掉的 `mktemp`；那是"显式 LOG 也去挪稳定名"那个**已修的产生侧**留下的旧指针）。
✅ 已把稳定名重指到真实那一趟（`ln -sf` 现量：解析得到 2949 行），并把这一族入档 **§7 第 241 条**。
⚠️ 那句 143 属于别的后台任务，不属于本装置 —— 引用"上一趟怎么没的"之前，先 `ls -t` 按次文件，别读指针。

**(2) 三条装置缺陷当场修掉，每条都带回跑读数（不是"改了"，是"改了且先验绿"）。**

| 缺陷 | 症状 | 修法 | 复跑读数（13:2x） |
|---|---|---|---|
| 臂的"让路"判据读活机器 | 臂 6/7/9 rc=3、桩链调用 0，看着像自愈逻辑坏 | `run_once` 钉 `CO_PATTERN='ht-healfire-none[$]'`（`SELF_GUARD=0` 只关"C 让 C"，"C 让 H"是另一道） | `bash research/tools/r14c-heal-fire-arms.sh` ⇒ **臂 5–9 全绿**（夹具=`docs/plans/goal-multi-end-coverage.md`，跨度 HEAD~2） |
| `EXP_RI` 从未赋值 | `set -u` 下**只在"现场真有别人在跑"那一档**崩：rc=1 而日志零 ❌（死在判决之前） | 基线捕获处补 `EXP_RI="$BASE_RI"` + 写明"基线中途退出会让逐字相等报集合不符"这一档 | `bash research/tools/r14c-gate-b-exclusive-arms.sh` ⇒ **T1–T5 全绿**，第二道 `[93817 ] == 基线 [93817 ]` |
| 载体判据覆盖清单少两枚 lib | 闸门 `source` 三枚 lib，清单只有 `wedged-runner`；`apk-freshness.sh` **载体那份根本不存在** ⇒ "动设备那一刻"的 APK 新鲜度读数会悄悄不见 | 规则改成"闸门 source 的每一枚 lib 都要同列"，补 `apk-freshness.sh` + `wait-for-quiet-host.sh` | `bash research/tools/r14c-chain-overlay-arms.sh` ⇒ **rc=0**：依赖对偶"共 3 枚逐枚都在"、C0 覆盖前后逐枚 md5 相同 + 载体 porcelain 逐行相同、`OVERLAY 行数=8`（枚数由链源码现读） |

同一轮顺带把本线**其余四把**先验也复跑了一遍（改了闸门输出契约就要全跑）：
`r14c-boot-avd-arms` rc=0（9 绿）、`r14c-window-retry-arms` rc=0（13 绿）、
`r14c-signal-trap-arms` rc=0（3 绿）、`r14c-install-guard-arms` rc=0（8 绿）、`r14c-gate-hint-arms` rc=0（6 绿）。
文档侧：`node scripts/check-md-table-rows.mjs` rc=0、`node research/tools/docs-link-check.mjs` rc=0。

**(3) B / C 现在为什么不能起 —— 逐条写明在谁手里 + 可复跑命令。**

闸门 13:2x 现量 `REDS=load,src,dev,apk`（`NO_COLOR=1 bash scripts/verify-mobile-window-gate.sh --target c`，dry-run）：

- `dev`：**在对话式 AI 助手那条线手里**（它的台账是 `BLOCKED.md` **B76**，不是我这边）。
  占着设备面的是 `reinstall-all` pid **93817**，其 macOS 段叶子 **98934** =
  `notarytool submit … Heyta-1.0.0.dmg` 已活 **10h06m 而累计 CPU 0:00.03**。
  🔴 **等它是零产出**：那一趟起跑 03:15，**早于** `run_bounded()`（`694c05e3`，05:15）两小时 ⇒ 它带的是**无上限**那份，
  不会自己断（这条正证在 B76 补记 #6，我这边用 `scripts/lib/wedged-runner.sh` 的读数独立复现了"楔住"那一档）。
  **放不放由它的主人拍板，本线不杀、不接管。** 复跑：
  `ps -p 98934 -o pid=,etime=,time=,command=; pgrep -f 'scripts/[.]?reinstall-all[.]sh'`
- `load`：1 分钟均现量 **21.34**（阈值 ≤12）。这一条**是**等待可解的，但它单独可解也没用 —— `dev` 不放，窗就不开。
- `apk`：APK 12:00:04 < 最新源码 13:14:25。修法就是 C 的第一步（`pnpm --filter @heyta/ui build && pnpm build:android`），
  但它在**同一台 emulator-5554** 上要等 `dev` 放，所以不单独抢。
- `src`：并行会话的未提交源码；本线自有那份走 `research/tools/calendar-line-commit-plan.sh`。
- ✅ 已经不再是红的：**设备在线**（`emulator-5554 device`）、凭据三件套齐、`scripts/check-script-snapshot.mjs` 的 MANIFEST 有本线那条脚本。
  `:3100/health` 现量 200（链自己在空闲端口起栈，不计入前置）。

⇒ **看守不再重挂**（这是与上一轮相反的决定，理由就是上面那句"等它是零产出"）：
`r14c-window-retry.sh` 的预算只会以 `final_rc=3` 用尽，而它每轮都要读一次活机器。
下一条有产出的动作是 **`dev` 放窗之后**按 §5 的顺序起 `BOOT_AVD` 那一趟（或设备已在线时不带它）。
H 那把 flaky 看守（pid 27489）此刻仍挂着等负载，与本条无关，不要与 B/C 抢同一张设备面 ——
两把的互斥由 `SELF_GUARD` + `CO_PATTERN` 那两道守（本表第 2 行刚补了它们进臂里的形状）。

**(4) 🔴 没有做"一键放窗"，因为读了代码之后那个动作是反的。**
`scripts/reinstall-all.sh` 现量：段序 `mac windows android ios`（`:161`），mac 段判失败只是
`RESULT_mac=FAIL` 而**没有 exit**（`:198`），失败在**文件末尾**才汇总（`:489-504`）。
⇒ 把那枚楔住的叶子（98934 `notarytool`）放掉，那一趟**不会停**，它会继续走到 android 段 ——
而 android 段做的事是 `adb uninstall` + `adb install` 同一枚包、同一台 emulator-5554。
**"放窗"会把共享面从"被一个不动的东西占着"换成"被一个真在写的东西用着"**，对 B/C 反而更坏：
现在这个楔住状态是**保护**，不是阻塞。唯一真的释放是停整趟（root 93817），
那会中断别人四条端的运行 —— 那不是本线能替他拍的板，所以**交出去的是这句判断，不是一个开关**。
入档 **§7 第 244 条**（规矩：任何"替别人解阻塞"的开关，先读那一趟接下来的代码，
回答"它醒来第一件事是不是动同一个对象"）。

**(5) 13:4x 证据对账复跑（`r17-evidence-md5-check.sh --all`）：一处红关掉了，另一处红是**真账**，故意留着。**

开跑现量 `dirs_scanned=12 dirs_with_mismatch=2` rc=1。逐档处置：

- ✅ **`profile-panel/r15b-3-ready-dark.png` 的 md5 红已按"换判据类"关掉，不是把值改抄一遍。**
  现量：这一张 10-03→10-04 换了 **4 次字节**（`c2801cf0…`→`66534fd7…`→`cadfbb3a…`→`5ddcbf4f…`），
  而**同一趟**拍的另外三张跨这四趟**逐字节不变** ⇒ 漂的不是界面内容，是暗色那一帧拍在动画中途
  （13:4x 人打开当前字节复核：暗色真切过 / 圈里是那张浅色亮白圆 / 「换一张」+「移除头像」都在 /
  「头像已更新」/ 昵称「小鹿」+「保存昵称」/ 邮箱 `deer@example.test` —— **主张逐条仍成立**，
  并且这次在图里看到了那条半透明横幅残影，给 README 挂了很久的候选②第一次有了图内证据）。
  ⇒ 按 `r17-evidence-md5-check.sh` 文件头那条规则（"给每跑必红的图钉 md5 = 造一条训练人忽略红的判据"）
  把它从 md5 形状改成 **`UIPIN` 代码锚点**（钉 `39032107`，理由是按四条决定路径 `git log -1` 现取，
  且拍图 12:43 **晚于**那一笔 10:11）。复跑：本目录 `entries=3 mismatch=0 pins=1 pinbad=0`。
- 🔴 **`calendar-day/` 五枚 `UISTALE` 是真过期，故意留红，不许改钉糊过去。**
  先按"探针坏"查过：那五张字节是 **10-03 11:09:12**，而锚点路径集合里 `main-area.css` 在
  **10-04 10:11**（`390321074d`）动过 —— 动的正是 `.ht-header`（`block-size`→`min-block-size`、
  加了纵向 padding、动作区改可换行），**页头条就画在这五张顶上**。
  ⇒ 把 `5e23b7bf` 直接改成 `39032107` 等于用一次改字把"这张图画的是当前交付形状"变成没有字节支撑的话。
  **在谁手里**：浏览器窗口（与 H/R17 同一个门 —— 4318/4319 空闲 + 负载落回个位；现量负载 21.34、
  H 那把看守 pid 27489 正挂在同一个门上，所以这一条**排在它后面**，不另起一趟抢窗口）。
  **关闭命令**：`cd e2e && npx playwright test tests/calendar-day.spec.ts` → 人打开那五张 →
  按 `git log -1 -- <五条决定路径>` 现取的时刻重钉。全部写在 `apps/web/evidence/calendar-day/README.md` 末尾那一节。
  ⚠️ 同目录那三张 `day-en-*.png`（R16）**不在这条账上**：字节 10-04 12:41 晚于那一笔，锚点成立，
  工具打的是 `UIOC` 信息行 —— **五张红、三张不红是同目录内的真实差别**，别一把改成绿。
  复跑读数：`dirs_scanned=12 entries_parsed=8 pins_parsed=11 dirs_with_mismatch=1`、rc=**1**（这一格的红是账，不是噪声）。

**(6) 13:5x 又补了两处"根本没有常驻判据"的证据目录（R13 / R14 各一处），并人逐张看过。**

同一把装置复跑（`r17-evidence-md5-check.sh --all`）现量：`calendar-year` **连 README 都没有**、
`calendar-day-time` 有 README 但 `EMPTY（解析到 0 条 md5 条目、0 条 UIPIN）`
—— 也就是说 R13 那四张年视图与 R14 那三张时刻轴**从来没有被任何一层守过**
（"这张图是当前交付形状"这句话不会为它们变红）。

- ✅ `apps/web/evidence/calendar-year/README.md`（**新建**）：四张逐张写了"人看到的" + 四行 `UIPIN`。
  复跑 `DIRCHECK … calendar-year entries=0 mismatch=0 pins=4 pinbad=0`。
- ✅ `apps/web/evidence/calendar-day-time/README.md`（追加一节）：三张各是一条**不同状态**的主张
  （空日的小时刻度 / 「全天」那句"定到具体时刻的在下面那条轴上" / 那条任务**正好落在 16:00 那一行**），
  三行 `UIPIN`。复跑 `DIRCHECK … calendar-day-time pins=3 pinbad=0`。
- 两处都钉 `39032107` 而**不钉 md5**，理由是同一条现量：图里的任务名带每趟随机后缀
  （`挂在十六点-867223`、`钻取不被劫持-897025`）⇒ md5 是"每跑必红"的判据。
  锚点成立的前提也现量核过：五条决定路径里最后一次动过的提交是 `39032107`（10:11），
  而这七张的字节是 **12:41**（`stat`）⇒ **拍图晚于决定形状的代码**；字节是别人那一趟跑的，
  13:5x 由本线逐张打开看过（§6.2 规定一）。
- 🔴 顺手得到一条**互相印证**的读数：这七张（12:41）的页头是**两行**（标题一行、动作区换到第二行），
  而第 (5) 条里留红的那五张（10-03 11:09）页头还是**一行** ⇒ 同一处 CSS 改动在两个目录里给出
  一红一绿两种读数，**五张红不是探针坏**。
- ⚠️ 撞见但**不归本线**（登记 + 现量命令，不动它们）：`apps/web/evidence/calendar-cells`、
  `apps/web/evidence/calendar-week` 同样是 `EMPTY`（0 条 md5 / 0 条 UIPIN）—— 那是更早一批日历取证的目录，
  不在 R13–R17 这七项里。复跑：`bash research/tools/r17-evidence-md5-check.sh --all | grep '^EMPTY'`。
  现在量的总账：`dirs_scanned=13 entries_parsed=8 pins_parsed=18 dirs_with_mismatch=1`、rc=1
  （那 1 处就是第 (5) 条故意留的红）。

**(7) 13:55 现量：C 的产物那一半已经就位，而 `apk` 那一格在"别人持续写源码"的现场不可能长期绿。**

- ✅ `bash research/tools/r14c-bundle-testid-preflight.sh` rc=**0**：盘上那份 APK
  （`app-release.apk`，mtime **13:23:39**、sha256 前 12 `17488a311036`、bundle 5,973,344 字节）里
  **C 那两枚 resource-id 的拼装碎片全在场**（`task-due` ×1、`-time-input` ×1、`-time-all-day` ×1），
  且负对照 `task-due-time-inputZZz` 命中 **0** ⇒ 这几条 grep 有牙。
  ⚠️ 它证明的是**产物**，不是**界面** —— 设备上画没画出来仍只有真机腿能答（§6.2 规定一）。
- 🔴 同一分钟闸门现量 `REDS=load,src,dev,apk`：`src` 已涨到 **81 枚**、`APK 13:23:39 / 最新源码 13:54:23`。
  ⇒ **`apk` 这一格不是"谁去重打一次"能关掉的**：只要还有并行会话在写 `packages/apps/server`，
  刚打完的 APK 下一分钟就又被判旧 —— 这是"开窗动作自己造红"那一族的**第三种面目**（造红的是别人的正常活动，
  既不是我、也不是被验的那个产物）。
  ⇒ **C 只能走载体那条路**（`research/tools/r14c-carrier-chain.sh`：先把载体 `checkout` 到主检出当前提交、
  在载体里打包，`src` 与 `apk` 两格才在同一个时刻上自洽），不能在 main 检出里"趁空打一发"。
  ⇒ 窗口条件因此是三条**同时**成立：`dev` 放（B76 那一趟）、`load` 落回 ≤12、以及载体同步那一刻 `src` 干净
  （不干净就走 `r14c-carrier-heal.sh` 的有界自愈，判据是"字节逐字等于目标提交那一版"）。

- (8) **14:0x–14:1x：`r17-evidence-md5-check.sh` 从"只比 md5"扩成"每张截图都得有一条常驻判据"，
  并且当场被自己的新臂抓出一个让新判据**永远数到 0** 的缺陷。**

  上面 (5)(6) 那三处是"我这条线的图没判据"。把它们补完之后回头问一句：
  **这个洞的形状在这里存在多久了？** 现量结果是**两档更大的**：

  | 档 | 14:0x 现量 | 为什么以前看不见 |
  |---|---|---|
  | 有图、**连 README 都没有** | 21 枚目录 | `ALL_GLOB` 走 `apps/*/evidence/*/README.md` ⇒ 没 README 的目录**连被扫的资格都没有**，`dirs_scanned` 反而看着很健康 |
  | 有 README、**里面 0 条锚点**、而有图 | 5 枚目录 / **20 张图** | `check_one_dir` 对这种目录返回 **rc=4**，而 `--all` 只把 **rc=1** 计进 `dirs_with_mismatch` ⇒ 这一档**既不进红、也不进任何计数** |

  加了两档判据 + **棘轮基线**（存量债不归本线，新增立刻红；两档各自能红，14:1x 实测：
  `NOREADME_MAX=20` ⇒ 红，`UNPINNED_MAX=4` ⇒ 红），并新增第三档 **`PINBROKEN`**
  （锚点解析到了但**判不了**：钉的提交不存在／不在 HEAD 祖先链／路径集恒空）——
  这一档**不给基线**，因为现量本来就是 0，而"看起来有判据其实是空的"比没写更坏。

  🔴 **新臂 10（`--all --root <合成树>`）第一次跑就把新写的 UNPINNED 计数打回 0**，根因不在计数那行：
  `check_one_dir` 在 `EMPTY` 那一支**直接 return，根本没打 `DIRCHECK`**，
  而 UNPINNED 是从 `DIRCHECK` 的 `entries=/pins=` 两个字段读的 ——
  **字段不存在 ⇒ 那一档永远数到 0，判据看着装了牙其实一条没接住。**
  修法是把约定写死：`check_one_dir` 只要跑到底就**必须**打 `DIRCHECK`（判决走返回值、账目走这一行），
  `EMPTY`/`SKIP` 两支各补一行零值。入档 `docs/reference/environment-traps.md` #246。

  本线偿掉的三枚（逐张打开看过、写了"人看到的"、钉的是**拍图那一刻**的源码锚点）：

  | 目录 | 图 | 之前 | 现在 |
  |---|---|---|---|
  | `apps/web/evidence/calendar-cells/` | 5 | 有 README、0 条锚点 | 5 条 `UIPIN`（pin `5340c126`）⇒ 报 UISTALE |
  | `apps/web/evidence/calendar-week/` | 3 | 有 README、0 条锚点 | 3 条 `UIPIN`（pin `401bbcd6`）⇒ 报 UISTALE |
  | `apps/web/evidence/calendar-capture/` | 1 | **连 README 都没有** | 新建 README + 1 条 `UIPIN`（pin `51d828c5`）⇒ 报 UISTALE |

  ⚠️ **报 UISTALE 是这次补判据的**产出**，不是回退**：`39032107`（10-04 10:11「主区头部可换行」）
  动了 `apps/web/src/styles/app/main-area.css`，而这九张图里的页头是换行**之前**的形状 ——
  逐张看图确认过（那三枚目录的页头**互不相同**，`calendar-cells*` 里没有档位下拉，
  `calendar-capture` 里那颗 `+` 带着焦点环）。**没有把 pin 改成 `39032107` 来消红**：
  那会把"我看过的字节"和"当前形状"混成一件事。处置是重拍，窗口前置同 §5 的 H，登记在 §4.1 J。
  现量（14:1x）：`ALLCHECK dirs_scanned=14 entries_parsed=8 pins_parsed=27 dirs_with_mismatch=4
  dirs_without_readme=20 dirs_unpinned=3 dirs_with_broken_pin=0`，`--selftest` **十臂全绿**。

  🔴 **同一轮把 A 那格（入库清单）也照出是瞎的**：`research/tools/calendar-line-commit-plan.sh`
  的 `PATHS` 里**这五枚证据 README 一枚都没有**（`calendar-year` / `calendar-day-time` /
  `calendar-cells` / `calendar-week` / `calendar-capture`），而它的 1b 防漏格**也没抓到**——
  因为命名空间正则写的是 `(calendar-day|calendar-view-options|profile-panel)/`，
  `calendar-day` 后面**紧跟一个 `/`** ⇒ `calendar-day-time/README.md` 从来就不匹配。
  也就是说"命名空间命中全部已点名 ✅"这句话，**对五个目录根本没看过**。
  ✅ 已扩：PATHS 补五枚（只点 `README.md`，**不点那些目录里的 png** —— 字节是别人的 e2e 趟写的、
  工作树相对 HEAD 干净），NS_RE 另加一条交替式只管这五个目录的 `README.md`。
  读数：未变异跑 `命名空间命中 27 枚全部已点名` / `待入库 28 枚（改动 25 / 新增 3）`；
  **变异腿**（用脚本自带的 `PATHS_OVERRIDE` 测试缝，把 `calendar-cells/README.md` 从清单里摘掉一枚）
  ⇒ 1b 精确点名它并 `exit 1` ⇒ 这条交替式**有牙**，不是把名字抄进清单就完事。
  ⚠️ ~~该脚本第 2 格现在报 `❌ 索引里有 2 枚已暂存路径`…也正是 A 不能在这一轮 `--confirm` 的原因~~
  🔴 **这句在 16:0x 作废，留着是为了让后来者认出那个形状**：它写的是**旧 §2 的前置**（「索引必须空」），而那条前置来自一次裸 `git commit` 的事故、对本工具走的 `--only` 根本不成立，16:0x 已换成「记录别人的暂存 → 提交后逐字节对账」（§5b，牙在 `calendar-line-commit-only-arms.sh`，16:0x 三臂 → 17:3x **五臂**，见本节末尾 (12)；§7 #247 —— 🔴 那条与 #241/#255/#256 一样**只在工作树里，HEAD 尚无**，现量命令见下面那一行）。A 也在同一天落了 `b4033742` / `f0afe884` / `8c4cbf1e` / `eb97471a` 四笔，其中 `eb97471a` 那一趟**现场**验到 2 枚别人的暂存项事后 blob 逐字不变（复跑 `bash research/tools/calendar-line-commit-plan.sh`）。
  📌 `docs/reference/environment-traps.md` **刻意不进清单**（共用台账，14:1x 现量 ` M` +318/−7）；
  点名它 = 把别人几百行未提交内容一起提交。**本线占哪几条别抄区间**（17:5x 就漂了一次：写「#241–#246 六条」时
  只有六条，之后 #247、#255、#256 陆续落进去，而 #248–#254 是别人的）—— 现量命令（本行唯一口径）：
  `for n in 241 242 243 244 245 246 247 255 256; do printf '#%s HEAD=%s 工作树=%s ' "$n" "$(git show HEAD:docs/reference/environment-traps.md | grep -cE "^$n\. ")" "$(grep -cE "^$n\. " docs/reference/environment-traps.md)"; done`
  🔴 **17:4x 现量：这九条全是 `HEAD=0 工作树=1`**（台账最后一次入库是 `876d49a` 10:30，之后 **+699/−7 一直未提交**）。
  ⇒ 本文件里那句"已入 §7 第 247 条"的准确含义是**写进了这本活台账**，**不是**"在 HEAD 里" ——
  干净检出上 grep 不到这些号，那不是丢条目，是这本台账正被多条并行会话共写、由持有者入库（与 `AGENTS.md` §7 索引行同一件事）。
  （**点必须写成 `\.`，不能写成 `[.]`** —— 本轮实测（原写 18:0x 是把压缩摘要里的时刻当成了现取读数，见 (13)）：`"$n[.] "` 在 bash 里对、在 zsh 里被当数组下标，
  报 `bad floating point constant` 并把计数打成空 ⇒ 一条"每条应为 1"的自检会全体读成空。
  本行是**给人复制**的，所以按两个 shell 都能跑的那个写。）
  ⇒ 每条应为 1；新取号前再跑一次 `grep -oE '^[0-9]+[.] ' … | sort -n | tail -1`（**别按区间推，别按行号读**）。
  ⚠️ 另记一条**不归本线改**的账：`AGENTS.md` §7 那张号段索引表最后一行仍停在 `177–240`，
  #241–#247、#255、#256 未入索引（号段不连续：#248–#254 是别人的）；`AGENTS.md` 当前是 ` M`（别人正在编辑），而 §8 明写"不改 AGENTS 的规则部分
  除非用户当场要求"⇒ 本线不代改。现量命令：
  `grep -oE '^[0-9]+\. ' docs/reference/environment-traps.md | tr -d '. ' | sort -n | tail -1`。

  🔴 **本线自己承认的一条边界（不排进 §5 F，因为 F 只有两条是拍过的）**：
  `r17-evidence-md5-check.sh` 至今**没有自动消费者** —— 它不在 `pnpm check`、不在 CI、不在 git hook，
  只有文档里那句"引用任何截图前先跑它"。也就是说这一轮装的牙**只在有人手动跑的时候咬人**。
  现在不接进 `pnpm check` 的理由是具体的、不是拖：现场有 **4 份 README / 14 枚 UISTALE** 待重拍，
  一接就是常驻红（§8.3 那条元规则）。**开工判据**：那 14 枚重拍完、`--all` 的
  `dirs_with_mismatch` 归零之后，接的时候还要给"接线"本身立一条变异门
  （把 `--all` 从 `check` 里摘掉必须能红），而不是只加一行 script。
  ⚠️ 接线要动 `package.json`，而它**当前正被并行会话占着**（`docs/plans/README.md` 那格 §4.1 I 同源）。

  ✅ **重拍这一步已落成参数化脚本**：`research/tools/r17-reshoot-stale.sh`
  （默认 dry-run，`--confirm` 才动；前置不达标 **exit 3** = 环境无效，不是产品失败）。
  它现量取 `--all` 的过期集合 → 查"目录→spec"映射（**表里没有就 exit 1，不猜**）→
  过窗口门（写这段时是四格：4318/4319 空闲、负载、`dist-freshness --strict`、`e2e/node_modules`；**16:0x 起是五格**，多了下面 (9) 那条「载体」）→
  逐 spec 跑 Playwright → **只有 rc=0 才把图放回证据目录**（失败的趟里哪些图完整没有记录，
  拿它们覆盖 = 用一次不确定的运行替换已知的那一份）→ 复跑 `--all` 对账。
  🔴 它**不自动重钉 UIPIN**：脚本只放回字节并打印改前/改后 md5，
  "人看到的"那一行与 pin 必须由**真的打开看过图的人**改 —— 没有"人看过"的锚点就是没锚点。
  读数（14:2x 三趟）：
  ① 第一趟 `GATES=dev`（4318=node/93264、4319=node/93252）+ `待重拍 4 个目录` 全部映射成功；
  ② 第二趟 `GATES=load`（load1=33 > 12），而**同一分钟 `lsof` 复查两端口已经空了**
  （curl 两枚都 `000`）⇒ 又一次证明这些前置全是**瞬时读数**，引用前要复跑（本线 §4.1 那条纪律）；
  ③ `LOAD_MAX=999` 那一趟报 ✅（比较方向对）+ `--only calendar-nope` 报 **exit 1**
  （参数写错不许被读成"无事可做"）。
  ⚠️ 这个脚本的负载格**第一版是坏的，而且坏成永远绿**：我用了
  `sysctl -n vm.loadavg | tr -d '{} '` —— 那正是 `scripts/lib/wait-for-quiet-host.sh:39` 的注释
  点名**别再犯**的坑（§7 #168：`tr` 把分隔符连花括号一起删，三个数粘成 `31.4729.0034.04`），
  同一格里还叠了第二条错（`sort -g | head -1 != 阈值` 的比较方向反）。
  现场负载 33 时它打印 `✅ ≤ 12`。⇒ 教训写进脚本头部：**抄现成实现前先读它注释里那句
  "为什么不用另一种写法"**；新写的门第一次 dry-run 就要喂一个**必然超阈值**的现场。




- (9) **16:0x：重拍那条路上补了第五格「载体」，而它当场把真正的阻塞照出来了**。
  起因不是我想加格子，是 15:5x 想把 (8) 那把脚本跑成真事：`--all` 的过期集合从 4 个目录涨到 **5 个**
  （`profile-panel` 新红 —— 它钉在 `39032107`，而 HEAD 之后 profile 面的判据源码动了），
  脚本于是停在第 2 格 `❌ profile-panel：映射表里没有它`。映射是**查出来的不是猜的**：
  `grep -rln 'profile-panel' e2e/tests/*.ts` 只命中 `profile-avatar-e2ee.spec.ts`，
  它第 58 行 `SHOT()` 写的就是 `../apps/web/evidence/profile-panel/<name>.png` ⇒ 补进 `spec_for()`。
  🔴 补完之后四格全绿（4318/4319 空闲、负载 11 ≤ 12、dist 新鲜、依赖在），**而这四次重拍都不该跑**：
  `packages/i18n/src/locales/{zh-CN,en}.ts` 正被另一条线改着（现量 +116 / −60，是「已连接设备 /
  撤销设备 / 旧格式的加密口令」那批词条），而 vite dev server 渲染的是**工作树**。
  这一刻拍出来的图里是别人未提交的文案，而我要钉的锚点写的是 `packages/i18n@<某个提交>` ⇒
  锚点会从「这张图对应那份代码」悄悄变成「这张图对应一份我当时说不清是谁的树」。
  这与 `scripts/reinstall-all.sh` 的 src 不变量是同一件事，也是 §7 第 82 / 178 条那一族
  （「装的是不是当前产物」要有判据），只是产物换成了截图。
  ✅ 新格子的判据范围**只取本线锚点自己列出的那些判据路径**（不吞整仓 100+ 枚脏行）：
  谁的改动会改掉这张图，由锚点说了算。现量读数（`LOAD_MAX=999` 放开负载那一格，专测这一格）：
  `GATES=src`、exit 3，点名 5 个目录各 2 条（en.ts / zh-CN.ts），**且另外四条判据路径
  （`packages/ui/src/calendar`、`apps/web/src/features/calendar`、
  `apps/web/src/styles/app/main-area.css`、`packages/design-system/src/tokens.css`）
  一条都没被误报** —— 这一格同时自带了负对照。
  ⚠️ 两条出路，都不在本轮里做：① 等 i18n 的所有者把那两枚提交掉（**默认走这条**：
  截图本来就该来自团队真正在跑的那一份树）；② 在 HEAD 的隔离 worktree 里重跑整套 e2e
  —— 那条要 `pnpm -r build`（载体里没有 dist），负载 11/12 时自己把门顶回去，
  而且拍出来的就不是共享树的样子。**代价与语义都不同，不是「绕开阻塞」的免费门**。
  ⚠️ **同一轮里我自己把 §7 已登记的坑又犯了一次**：新写的载体那行 `SRC_HIT="…（未提交：$f）"` 里 `$f` 紧跟全角括号 ⇒ 16:0x 入库时 `check-shell-unicode-vars` rc=1 抓到（本线今天第三次：负载格那次是 `tr` 的 #168，这次是全角字符的 #64）。改成 `${f}` 后 rc=0，两趟之间工作树没有别的改动 ⇒ **这条门禁对新增代码确实有牙**；而「抄自己旧写法」这种失误恰恰是它存在的理由，不是「别人不小心」。同一趟 `bash -n` 是过的 —— 这类坑全属「语法对、内容错」那一族，语法检查挡不住。
- (10) **17:1x–17:3x：C 的看守挂上了；挂上第一趟就照出两个装置缺陷（都在本线自己手里），
  而我顺手写的一条"外部根因"被自己的复测否证 —— 三条都记在这里。**
  ✅ **挂载**（用户第二次授权"解决阻塞"之后）：
  `CARRIER="…/heyta-wt-r14c" BUDGET=7200 INTERVAL=60 bash research/tools/r14c-window-retry.sh`，
  pid **84884**，日志 `/tmp/ht-r14c-window.20261004-171301.84884.log`（稳定名 `/tmp/ht-r14c-window.log` 已指过来）。
  挂前复跑 `r14c-window-retry-arms.sh` ⇒ **过 13 / 红 0**；`SELF_GUARD` 现量无同类、`CO_PATTERN` 现量无 H 看守，
  emulator-5554 在线。它只在四格全绿（或只红 apk）时才动设备，**不在窗口之外动设备**。
  🔴 **缺陷一（混树，本线的闸门）**：闸门被看守用 `--repo <载体>` 调用时，
  三行 `. scripts/lib/*.sh` 用的是**相对路径**，而脚本自己在第 51 行 `cd "$REPO"` ⇒ cwd 已经是载体，
  于是 `wedged-runner.sh`（载体那个提交里还没有它）与 `apk-freshness.sh`（**根本未跟踪**，任何提交里都没有）
  报 `No such file or directory`，往下 `heyta_apk_pair` 成 `command not found`，
  `APK_MT/NEWEST` 取空 ⇒ 打印 `APK 1970-01-01 08:00:00 / 最新源码 1970-01-01 08:00:00` 并判
  **"APK 比源码旧"**。也就是**探针缺席被写成了一条产品缺陷**，而那条红会让人去重打一个不必重打的 APK。
  ✅ 修法把两件事分开钉死：**闸门自己的代码按 `$0` 所在那棵树取（`GATE_SELF_DIR`），被测量的东西按 `$REPO` 取**；
  缺席改成响亮 + fail-closed："APK 新鲜度**测不了** … 这不是一句产品读数"，仍然计一条 `apk` 红（不新增 `REDS=` 词元）。
  读数（三条腿都跑了）：主检出直跑 = 真读数不变；`--repo 载体` = 两行 `No such file` 消失且 APK 那格给出真时刻
  （`01:05:18 / 06:53:58`）；把闸门与 lib 拷进 /tmp **故意抽掉 `apk-freshness.sh`** ⇒ 打出 ⚠️+❌、
  日志里 `1970` 出现 **0** 次、`REDS=load,src,apk`、rc=3。改完把消费闸门的四把一起复跑：
  `gate-hint` 6 好 / `gate-b-exclusive` 8 好 / `boot-avd` 9 好 / `heal-fire`（见缺陷二）全 rc=0。
  🔴 **缺陷二（本线 rig 的一条假红）**：`r14c-heal-fire-arms.sh` 的收尾格断言的是
  "**全仓 worktree 计数回到基线**"，17:2x 现量 `基线 16 → 现在 15` —— 差那一枚不是我建的
  （我建的那枚清单与盘上都已消失），是另一条会话在同一次运行中间摘掉了它自己的 worktree
  （同趟 `git worktree list` 里那枚标着 `prunable` 的 `/private/tmp/ht-mdt-arm` 下一趟就不见了）。
  文件第 70 行的注释**早就写着**"13 这种全仓数字本身没有判据力"，断言却还在比计数 —— 这是注释与判据不一致。
  ✅ 改成直接对**自己的产物**断言：清单里 0 命中 **且** 那个目录不存在；计数降级为打印读数。
  牙（变异一趟）：把副本里的 `git worktree remove` 那行摘掉 ⇒ 该格转红
  "本装置自己漏了 —— 清单命中 1 次，目录存在=1"、rc=4；真 rig 复跑 rc=0（`15 → 15（差 0，只打印不判定）`）。
  ⚠️ **我自己写的一条"外部根因"当场被自己否证，必须留撤回**：看到 98934 挂在 `notarytool submit` 上，
  我探到 `notary.apple.com` 在 223.5.5.5 / 1.1.1.1 / 8.8.8.8 下都**解析不到**（同环境 `www.apple.com` 三台都解析得到），
  于是 17:1x 我在对话里写下"找到一条对 B 更硬的外因：公证通道不可达"。**这句是错的**：
  `xcrun notarytool history`（同一份凭据、只读、不提交任何东西）**rc=0 并返回了真实历史**，
  而 `appstoreconnect.apple.com` 解析得到并回 302 —— notarytool 用的根本不是 `notary.apple.com` 那个父域
  （它没有 A 记录是常态）。⇒ 教训：**判"某外部服务不可用"要用该服务自己的只读入口取证，不能拿域名猜**；
  我那条"阳性对照"只对照了探针（换个域名能解析），没对照**被测服务本身**，所以对照过了而结论仍是错的。
  🟢 顺带量到一条让 B 变轻的事实：`package-app.sh` 从 `694c05e3`（10-04 05:15「公证那一步给上限，超时不判通过」）起
  有 `HEYTA_NOTARY_TIMEOUT:-900` + `run_bounded` ⇒ "`--wait` 楔 12 小时"这个形状在新脚本下**不可能重现**；
  那一趟之所以楔住，是它跑的是 `/tmp/heyta-reinstall` 里**快照形态的旧脚本**（自带 03:40 那一刻的行为）。
  两枚无主占用（18h 满转的 vitest worker pid 29644、12h 的重装链 81007→98934）**在我动手前已被各自的持有者收掉**
  —— 本会话**没有 kill 任何进程**，17:3x 现量两者都不在。
  ⚠️ 17:3x 现场换成**活跃占用**：`load1` 15–19（阈值 12）、pid 49211 正在跑 `verify-mobile-card-export-ios.sh`
  （倒数纪念日线，worktree `heyta-wt-batch2`）、`:3000` 被一枚 PPID=1 的 `node dist/src/index.js`（15:45 起）占着
  ⇒ 闸门按自己的口径报"那**不是**本线起的服务端"。这些都是别人的活忙，**没有可清的占用**，只有可等的窗口 ——
  所以这一轮对 B/C 的正确交付是那把看守，不是再切一轮闸门读数。
  📌 一条**顺带量到的好消息**：`--repo 载体` 那一趟的 `src` 格是**绿的**（载体干净）⇒ 之前"src 独立挡住 B/C"这句
  只对共享树成立，隔离载体这一路确实把那一格消掉了（这正是 (9) 里那条出路的现量）。
- (11) **17:5x：这笔入库第一次在**真共享树**上把 §5b 走通了，也顺带把三枚图带进 HEAD —— 后者要写明。**
  ✅ `eb97471a`（7 枚 / +91 −9）提交前 §2 现量到 **2 枚别人的暂存项**
  （`apps/mobile/evidence/android-vault-revocation-20261004.txt` 索引 blob `53deb7d7…`、
  `ios-reminder-ax-companion-20261004.txt` `1108f244…`），提交后 §5b 打出
  「2 枚别人的暂存一条不少、索引 blob 逐字不变、且不在本笔的树里」⇒ b4033742 那一趟靠的是夹具证明，
  **这一趟是现场证明**（同一份代码路径，外来暂存枚数 1 → 2）。
  🔴 **同一笔把三枚 png 一起带进了 HEAD，而那三枚的字节不是我看过的那一份**：
  `view-select-closed.png` / `day-en-full.png` / `day-en-no-timed.png` 的 mtime 都是 **16:54:30–48**
  （本线那一趟 e2e 早就结束，是别人的一趟重跑），逐枚与我 15:4x 提交的那版比 md5 全不同
  （`273d6cb8→64fabbde`、`d62f9f1f→96746c9c`、`0bc36cf7→25a15ebe`）。
  它们在本线 PATHS 里是**刻意的**（§6.2 规定一：README 记的就是图的字节，只提 README 不提图 = 提交出一个
  自相矛盾的 HEAD），但这不等于"这三枚新图有人看过"。当前状态由判据自己说：
  `bash research/tools/r17-evidence-md5-check.sh --all` 现量 rc=**1**、
  `dirs_scanned=14 entries_parsed=8 pins_parsed=27 dirs_with_mismatch=5 dirs_without_readme=20
  noreadme_baseline=20 dirs_unpinned=3 unpinned_baseline=3 dirs_with_broken_pin=0`、UISTALE **14** 行
  ⇒ 形状主张仍标着过期，关闭动作就是 §5 的 11) 那一单（重拍 + 人看 + 重钉）。
  📌 **可迁移的一句话**：把脏字节带进 HEAD 有两种，"我拍的图随我的文档一起落"和
  "别人重跑的图被我的点名清单顺路收走" —— 前者正常，后者**必须留字面**，
  否则下一位会把"HEAD 里有这张图"读成"有人看过这张图"（§6.2 规定一的那半句话：印着"人眼复核"不等于复核过）。
- (12) **17:2x–17:4x：§3 那条前置的**范围**改对了（判据没放宽），而这次入库**刻意没把那四枚图带走**。
  🔴 改的是"量哪个集合"，不是"要不要量"。原样是"仓库里 md-tables / shell-unicode 有任何红 ⇒ exit 3"，
  可这一腿走的是 `git commit --only -- <NAMES>`，**它的提交集合恰好等于 NAMES** ⇒ 别人树上的红
  **结构上进不了这一笔**，却被这条前置当成了本线的红。现场两趟都是这个形状：
  第一趟红在 `scripts/verify-mobile-ios-reminder.sh:867`（别人正在编辑的那枚文件，
  现量 `grep -c verify-mobile-ios-reminder` 在本清单 = 0，带不走）；上一趟同一条门禁的红落在 `tmp/*.sh`
  （被 gitignore，同样带不走）。⇒ 现在的口径是**这一笔带得走的文件里不许有红**：
  带得走的红 ⇒ exit 3（与原来同样响亮），带不走的红 ⇒ 逐枚打印归属 + 继续（与 docs-link 那格同口径）。
  牙：`bash research/tools/calendar-line-commit-only-arms.sh` 从三臂扩成**五臂**，
  新增的那一对是**方向**（缺一臂就不知道收窄往哪边漂）：
  臂 4 把带 `$var`+全角括号的 `.sh` **点名城进来** ⇒ 期望 rc=3、零提交、两枚仍脏（下界：不许放行）；
  臂 5 同一种红落在**没点名**的 `.sh` 上 ⇒ 期望 rc=0、点名路径照常进 HEAD、那枚既没进本笔也没被顺手带走
  （上界：不许过挡 —— 收窄前它在这里 exit 3，A 就是被这种挡法永久做不动的）。
  🔴 夹具里 `check-shell-unicode-vars.mjs` 现在是**原样拷进去跑真的**（它的 ROOT = 自己所在目录的上一级，
  放进 `<夹具>/scripts/` 就自然量那棵小树，零改动）；另外两道仍是桩，理由逐字写在文件头。
  现量：`== 合计 pass=5 fail=0 ==`、rig rc=**0**。
  ⚠️ 收窄那两行注释**自己两次被这道门禁判红**（先 `$R1RC）`、再"把 `$IOS_MODE` 紧跟冒号的那个形状
  原样抄进注释里"）—— 门禁**不跳注释**，而 scoped 版上线头两趟抓到的正是我这一枚自己。
  记下来是因为它是一次**真的自我纠正**：如果 §3 还按"仓库有红就挡"，我会把自己的注释红读成"别人挡住了 A"。
  🟢 同一时刻现场翻转一格：`node scripts/check-shell-unicode-vars.mjs` 现在 **rc=0**（扫 112 枚 .sh）——
  持有者把自己那枚 `verify-mobile-ios-reminder.sh` 修掉了。**旧引用作废**：本线 17:5x 之后任何"shell-unicode rc=1"的说法都要重跑这一条才算。
  🔴 **这一笔没带走的四枚图（现量，别读成"漏了"）**：`view-select-closed.png` + `calendar-day/day-en-{empty,full,no-timed}.png`
  的 mtime 都是 **17:25**（同一趟 e2e，`/tmp/heyta-e2e-server.log` 17:33 还在写 ⇒ 那一趟还活着），
  而盘上字节与 README 不一致：`r17 --dir apps/web/evidence/calendar-day` ⇒ `entries=1 mismatch=6 md5bad=1 pins=8 pinbad=5`，
  其中 md5bad 那枚就是 `day-en-empty.png`（README=`57d2d008…`==HEAD，盘上=`d64c4994…`）；
  `calendar-view-options` 那边 `mismatch=0 pinbad=0` 但 README 第 11 行那句"盘上此刻 =`52174907…`"（11:55 那趟的记录值）
  现在盘上是 `14e74b5e…` ⇒ **记录漂了**（它 12:1x 已被降级成记录值、不是锚点，所以 r17 不响）。
  另记一笔：`day-en-full.png` 与 `day-en-no-timed.png` 现在 `cmp -s` **逐字节相同**（都是 `bac2e331…`）——
  这与该目录 README 第 147 行原本那句"⚠️ **与上一张是同一屏**（人眼看内容相同，md5 不同）"不矛盾，
  只是这次连字节也相同了；那张图在这个视口下**不构成独立证据**这件事早就登记过。
  ⇒ 带走它们会造出 (11) 那句警告里的那个 HEAD：**README 记的字节与图里的字节不是同一份**。
  所以这一笔只带 3 枚本线文件（本段 + `calendar-line-commit-plan.sh` + `calendar-line-commit-only-arms.sh`），
  四枚图留在工作树里由**跑那趟 e2e 的会话或 §5 的 11) 那一单**处置（重拍 + 人看 + 重钉）。
  复跑口径：`bash research/tools/calendar-line-commit-plan.sh`（现量待入库 **4 枚**、全在上图上、rc=0）、
  `bash research/tools/r17-evidence-md5-check.sh --all`。
  ⚠️ **上面那句"rc=0 / 待入库 4 枚"在 (13) 之后过期** —— 那 4 枚图现在有了自己的登记格（第 1c 格），
  待入库那行只数**这一笔真的会带走**的枚数。引用这一格的读数请改跑 (13) 里那条命令。
- (13) **17:4x–18:2x：C 的窗口**真的开过一次**，链停在 `stack_up`，根因是"运行输入由主检出隐提供"；顺带查出两处装置缺陷。**
  🔴 **开火与停点（现量，`/tmp/ht-r14c-window.20261004-171301.84884.log` 第 1180 行往后）**：
  `WINDOW=open 17:46:22（FIRE=apk-deferred）` → `SYNC rc=0（目标 a5d11125）` → `install rc=0` → `build_all rc=0`
  → **`stack_up rc=1`** → `CHAIN_STOPPED_AT=stack_up` → `ALL_DONE final_rc=1`（看守 29 轮 ATTEMPT 后开火、按设计退出）。
  ⇒ 那两格"恒红的开窗前置"修完之后，窗口确实能开；**开起来之后才露出下一层**，这正是等待类装置的价值。
  🔴 **根因不是产品**：链的 `stack_up` 调 `scripts/mobile-e2e-up.sh`，而它启动服务端的那个 env 块里**没有 `JWT_SECRET`** ——
  主检出能起来，靠的是 `server/src/index.ts:1` 的 `import 'dotenv/config'` 去读**未跟踪**的 `server/.env`；
  linked worktree 不带来未跟踪文件 ⇒ 载体里那棵服务端在 `getJwtSecret()` 直接抛（`server/src/auth.ts:34`）。
  ⇒ **这是"打包/运行输入由'主检出里恰好有那个文件'隐提供"那一族**（本文件头那条 `packages/*/dist` 与 §7 第 82 条同形）。
  修法 = 链的第 **0b** 格：从主检出那枚真源**显式带** `JWT_SECRET` 与 `PASSWORD_PEPPER` 两枚、排在 `install` 之前
  （纯文件读，窗口是稀缺资源，不许白烧）、**只打长度不打值**（AGENTS §8.10）。
  ⚠️ **不许就地随机生成**：`PASSWORD_PEPPER` 进的是**库里已存账号的口令哈希**（`server/src/password/hash.ts:47`），
  换一枚 ⇒ 验收脚本拿老账号登录失败，那个红长得像"功能坏了"，不像"你把 pepper 换了"。
  腿（都在盘上跑过）：正腿 `SERVER_ENV_ONLY=1` ⇒ `ok jwt_len=58 pepper_len=70`、rc=0；
  反腿 `SERVER_ENV_SRC=` 指空 ⇒ `rc=4` 且停在 `CHAIN_STOPPED_AT=server_env`（读数带两枚的长度）；
  抛点直证（不起栈、不动库）：载体里 `env -u JWT_SECRET -u PASSWORD_PEPPER node -e 'require("./dist/src/auth.js")'`
  ⇒ **复现 17:46 那句 throw**（rc=1）；带上那两枚 ⇒ `AUTH_MODULE_OK`（rc=0）。
  🔴 **查第一个缺陷时当场照出第二个**：链给 `mobile-e2e-up.sh` 传了新旋钮 `HEYTA_E2E_PIDFILE/LOGFILE`，
  而**载体跑的是已提交副本**（现量：载体那份 `PIDFILE=` 写死在 `:46`）⇒ 参数没人接，
  那一趟照样去写跨树共享的 `/tmp/heyta-e2e-server.{pid,log}`：pidfile 从**死 pid 95105** 变成我这趟的 34466，
  而此刻 :3000 上真正的监听者（70256）**没有任何地方记下** ⇒ 那一棵的主人跑 `mobile-e2e-down.sh` 会"成功退出而什么都没停"；
  同一枚 logfile 被截断覆盖 ⇒ 前一棵的服务端日志（判据读数）没了。
  两处一起修：① `scripts/mobile-e2e-up.sh` / `-down.sh` 的默认值**逐字不变**、只加 env 旋钮；
  ② 这两枚**并入链的 `JUDG_PATHS`**（规则与闸门 lib 同一条：**链依赖的东西必须与 dependent 同列**）；
  ③ 新增后置断言 `stack_isolation` —— "传了参数"不等于"接住参数的代码被跑了"，三条一起判才算隔离住：
  pidfile 在 / 里面那枚 pid 活着 / 它就是 `$PORT` 的监听者。
  牙：`bash research/tools/r14c-stack-isolation-arms.sh` ⇒ rc=**0**（四臂：A 正 / B 死 pid / C 没 pidfile /
  **D 那枚 pid 活着但不是监听者** —— 少了 D，B/C 用"文件在不在"一个条件就能同时糊过去）。
  变异读数（把条件摘成 `[ -z "$ISO_PID" ] && [ -f "$E2E_PIDFILE" ]`）⇒ A 仍绿、**B/C/D 三臂转红**、rig rc=1；
  还原后复跑 4/4 绿。**我这趟起栈留下的那棵服务端已停**（`kill 34466`，先 `ps -o pid,command` 确认那是本线那棵；
  共享 pidfile 里现在是一枚死 pid —— 与我接手前同一类状态，那本账不在本线手里）。
  🟡 顺带把 `r14c-chain-overlay-arms.sh` 的 **A4 过期前提**改了：它原来钉着"这一枚覆盖前不存在、那一枚该被 REMOVED"，
  而 17:46 看守把载体从 `2ac93e54` 同步到 `a5d11125` ⇒ `r14c-bundle-testid-preflight.sh` 变成"本来就存在"，
  A4 红在**前提**上而链的行为一字未变（正是这把 rig 自己文件头写的那一族）。
  现在：跑之前逐枚现量存在性与字节，跑之后按那份现量逐枚核（E 枚回到原字节、A 枚摘干净），
  枚数仍从链源码推导。现量：`覆盖前现量：已存在 9 枚 / 不存在 1 枚（合计应为 10）`、`OVERLAY 行数=10`、rig rc=**0**。
  🔴 **入库这一格补了第三层：第 1c 格「刻意不带」**（`calendar-line-commit-plan.sh`）。
  加它的原因不是想放行，是**原来没有可达的出口**：§1b 写着"确认不归本线的，就在这里写明为什么不加"，
  可 NS_RE 连证据 png 一起反查 ⇒ 只要它们脏着，就只剩"§1b 判红"（把别人重跑的字节读成本线被挡住）
  和"`--confirm` 带走"（提交一个 README 与图字节不同步的 HEAD）两条错路。
  现在那 4 枚图各自带着**理由 + 处置路**挂在册子里，逐枚现量状态；三条断言：理由非空、在册必配 PATHS、
  已经不脏的打「待摘」。牙：`calendar-line-commit-only-arms.sh` 从五臂扩成**八臂**（新增 6 = **动作腿**：
  在册的那枚真的没进 HEAD 且仍脏；7 = 漏理由 ⇒ rc=1；8 = 在册却不在 PATHS ⇒ rc=1）。
  ⚠️ 臂 1–5 现在都显式传 `UNCARRIED_OVERRIDE=''` —— **不传**会掉回脚本里那 4 枚真路径，
  迷你树里没有它们 ⇒ §1b 先 exit 1，17:5x 那一趟是**五臂整片转红**、红的还不是被测那段
  （判"有没有传"因此用 `${…+set}` 而不是 `-n`）。
  ⚠️ 在册理由**一度含反引号**：双引号数组元素里的 `` ` `` 就是命令替换 ⇒ 理由里的 md5 全部消失，
  症状是"值没了"而不是报错（本仓那条老坑，第五次命中）。
  🔴 本轮**自己又被自家门禁抓一次**：`r14c-chain-overlay-arms.sh:156` 写了 `$p（` ——
  这是收窄后的 §3 上线后**第一次**把"会进这一笔"判红判在我自己头上（前两趟它抓的分别是我的注释行与别人的文件）。
  🟡 现量（18:2x）：`bash research/tools/calendar-line-commit-plan.sh` ⇒ 待入库 **8 枚**（改动 7 / 新增 1）
  + 在册 **4 枚**、`md-tables rc=0 / shell-unicode rc=0 / docs-link rc=0`、rc=**0**；
  窗口 `bash scripts/verify-mobile-window-gate.sh --target c` ⇒ rc=3、`REDS=load,src,apk`（**`dev` 又绿了**，
  17:4x 那格报的 pid 90200 已退）；楔住那趟重装整条**已消失**（`pgrep -fl 'reinstall-all|notarytool|queue-reinstall'` 空）
  ⇒ B 的 `dev` 阻塞自解，剩 load（13–42 之间抖）+ 载体。🔴 **19:15:43 那个看守真的开火、链第一次过了 `stack_up`**（`STACK_ISOLATION_OK pid=75311`），C 拿到**第一份真设备读数：通过 27 / 失败 10** —— 逐条归因后**没有一条是产品缺陷**（三条=空框 `text` 回占位符的读数通道混淆 + ①与②④两条不同通道；七条=⑧ 之后界面漂到「我的」页的下游，其中 ⑨ 换日子那条**根本没跑到**，是"没测"不是"没通过"），探针修五处含一处"整步判据被静默跳过"⇒ 全部明细与现量命令在 §4.05 (14)；R14c 的主张（`time` 进共享层并落到 `dueDate`）这趟在真设备上被读到了（⑤⑥b⑦b 绿 + 笔记本侧逐毫秒 16:00）。🔴 **20:03 第二发：闸门与链都按设计走（regate 第一次报负载 22 就**没动设备**，60 秒后负载 12 才开跑），但这一趟**一条产品判据都没跑到** —— 第 2 步起读数通道死（`uiautomator` 连续 10 次抓不到、`/tmp/ui.xml` 成空文件）而前台是 **SIM Toolkit** ⇒ 那 8 条红一条都不算产品结论（为什么被顶走没有证据，不写因果）。已把"无效"落成两道会红的停止条件（第 1 步的承重判据换成仓内既有的 `settle_foreground`；判据集起点新增 `assert_channel`：hierarchy 非空且前台归属，否则 exit 3），牙是 `r14c-channel-arms.sh` 八臂 `pass=8 fail=0` ⇒ 明细 §4.05 (16)；看守已重挂 pid 74502
  ⏭️ 下一步就一条：**重挂看守**让修好的链去吃下一个窗口**（`CARRIER=…heyta-wt-r14c BUDGET=… INTERVAL=60 bash research/tools/r14c-window-retry.sh`）
  —— 链已经修到能过 `stack_up`，而 B 不许由等待序列自动起（载体落后 main 就是把已装产物降级）。
- (14) **19:1x–19:3x：C 的真设备腿第一次跑到设备（27 过 / 10 红）——逐条归因后发现 10 条红里没有一条是产品缺陷，
  但探针自己坏了五处，其中一处让整步判据被静默跳过。**
  🔴 **开火与停点（现量，`/tmp/ht-r14c-window.20261004-182454.83401.log:1763` 起、链日志 `/tmp/ht-r14c-chain.83401.log`）**：
  `WINDOW=open 19:15:43（FIRE=apk-deferred）` → `SYNC rc=0（目标 b18379fc）` → `OVERLAY 10 枚` →
  **`stack_up rc=0`**（(13) 那格修完之后真的过了）→ `STACK_ISOLATION_OK pid=75311` →
  `verify rc=1`，「通过 27 项，失败 10 项」，19:21:40 收尾、10 枚逐枚还原。
  ⇒ **这一趟是 C 的第一份真设备读数**，也是它第一次被允许对产品下结论。
  🔴 **10 条红分成三组，每组都有日志里的自相矛盾，不是我推的**：
  ① **①/②/④b 三条 = 读数通道**：
    · `① 时刻输入框不在无障碍树里` 与下一行 `②`（它拿到了可点坐标才会报"填进了字"）**互相打脸** ——
      ①用 `rid_count` 读**上一次没滚动的 dump**，②④走 `scroll_to_rid`，同一个节点两条通道（§7 #239 同族：
      "没滚进可点区"被说成"没画"）。
    · `④b 清空后框里还剩 '时:分'` 把根因直接印出来了：无障碍的 `text` 在**空框**回的是**占位符**
      （词条 `common.due.timePlaceholder`）而不是空串 ⇒ 判"框里为空"的 ② 与判"清空生效"的 ④b **结构上恒红**，
      而 ④（填进"1"）与 ⑥a/⑦a 恰好都绿 —— 因为一旦有字，占位符就没了。这条通道混淆与产品无关。
  ② **⑧ 之后那七条 = 一条状态漂移的下游**：日志里 ⑧ 报"重开后面板上找不到时刻输入框"，紧接着 ⑨ 的
     `screen_txt` 显示界面停在**「我的」页**（清单/标签/便签那一段），⑩⑪c 读到的是
     `2026-10-04 16:00` = 第 6 步点「今天」+ 第 8 步填 16:00 的那次提交，而期望值里的"明天"从未发生
     （⑨ 那一步根本没跑到点击）。**换日子的搬运判据因此没有被判过** —— 是"没测"，不是"没通过"。
  ③ **两条 `同步按钮既不空闲也不在忙`** 也落在同一张已漂走的界面上（`ensure_phone_sync` 找的是「我的」页那颗按钮，
     而当时那两条里笔记本第 1 轮就拉到了任务 ⇒ 上传其实发生了，红的是那一步的读数形状）。
  🔴 **反而被这趟证明成立的产品结论（要记，别让探针的坏掩盖掉）**：`⑤ 只到日仍算全天` / `⑥b 半截 16:0 不提交` /
  `⑦b 补成 16:00 后「全天」出现` 三条全绿，且 ⑩ 在笔记本侧读到**逐毫秒的 16:00**
  ⇒ R14c 主张的那条缝（移动端把 `time` prop 传进共享层，并真的落到 `dueDate`）**在真设备上第一次被读到**。
  🟡 **探针当场修五处**（`scripts/verify-mobile-due-time.sh`，全部只动判据侧、没动产品代码）：
  1. **空框锚点自校准**：第 5 步开跑前（任何敲字之前）把此刻的读数记成 `TIME_EMPTY`，之后凡等于它的归一成空串。
     ⚠️ **不把「时:分」这个字面值抄进脚本**（本文件那条"抄件一定会漂"）—— 词条改一次这里就静默失效；
     若某台设备空框真回空串，`TIME_EMPTY` 就是空串，归一成为**无操作** ⇒ 两个方向都不会引入假绿。
  2. **① 换成与 ②④ 同一条腿**（`scroll_to_rid`），原始枚数**另打一行**做归因：
     数得出却没滚到 = 探针/布局；一枚都数不出 = 共享层真的没画。
  3. **② 与 ④ 各读一次**（原来 `if` 里读、bad 分支里再读一遍 ⇒ 打印的值与被判的值不是同一份 dump）。
  4. **⑧ 的两个 bad 分支加 `screen_txt` + 枚数**：红必须**当场**记下停在哪一屏，别让下一轮再靠"隔两步的那条读数"反推。
  5. 🔴 **第 12 步原来根本没有 `else`** —— `open_sheet` 失败时 ⑪a/⑪b **一条都不打印**，脚本一路跑到汇总，
     读起来像"⑪ 判过了"。日志现量就是这件事：第 12 步只有"笔记本已下载"和 `⑪c`，两条判据被**静默跳过**
     （§7 #46 那一族：没跑到的那段不会报错，它只是不在输出里）。现在补一条 `⑪ 判不了：……一条都没跑到` + `screen_txt`。
  ⚠️ **仍然未闭合的一条（不写成结论）**：⑧ 那一步**为什么**会跳到「我的」页 —— 现有证据只支持"发生在 ⑧ 的
  6 次滚动期间"，不支持任何具体机制（`scroll_to_desc` 用的是共享库里带 sane 守卫的那条，见 `lib/mobile-e2e.sh:626`，
  所以我原先"点到折叠线以下 ⇒ 误点标签栏"的猜测**没有依据**）。修法就是上面第 4 条：下一轮的 `screen_txt` 落在
  出事那一步，届时才有原文可归因。**这一条不在本轮继续猜，也不动共享库**（它被六条 `verify-mobile-*` 共用）。
  ✅ 静态门（现量 19:3x）：`bash -n scripts/verify-mobile-due-time.sh` OK；
  `node scripts/check-shell-unicode-vars.mjs` ⇒ 扫了 115 个 `.sh`、rc=**0**（本轮新写的中文注释里
  每一处 `$VAR` 后面都紧跟全角字符，全部带花括号 —— 这个门是第三次抓我了）。
  🔴 **本轮没有归因到的红 = 0**：10 条红逐条有归属（三条通道 / 七条状态漂移），且**没有一条**被写成产品缺陷。
  ⏭️ 下一步仍是那一条：**重挂看守**吃下一个窗口（`CARRIER=…heyta-wt-r14c BUDGET=… INTERVAL=60 bash research/tools/r14c-window-retry.sh`），
  让**修过的判据集**在设备上重跑；判据改了但不重跑 = 这五条修改本身没有牙（本仓 §8.7）。
  现量命令：`grep -n '❌' /tmp/ht-r14c-chain.83401.log`（那 10 条红的原文）、
  `sed -n '1084,1112p' /tmp/ht-r14c-chain.83401.log`（⑧ 之后停在「我的」页那份 dump）。
- (15) **19:3x–19:4x：归一这把刀自己补了一道闸门 + 一把五臂 rig；看守已重挂；顺带现量到一道**别人手里**的门禁红。**
  🔴 **为什么修完假红还要再写一段**：`TIME_EMPTY` 归一如果**方向错**（锚点取晚了、或某设备上这条新任务真带默认时刻），
  它就把**真空**吞成空串 ⇒ ② 与 ④b 从"恒红"变成"**恒绿**"，那比原来的假红贵一个量级。
  所以补 `calibrate_time_empty()`：锚点不许与本轮任何一步"要填进去的值"（`1` / `16:0` / `16:00`）同形，
  撞上就 `exit 3`（读数无效，不是产品失败）并当场 `screen_txt`。
  牙：`bash research/tools/r14c-time-empty-arms.sh` ⇒ rc=**0**、`pass=7 fail=0`
  （A 归一生效 / **B 反向腿：锚点是占位符时框里真有 `1` 输出仍是 `1`，证明只吃锚点不吃内容** /
  C 无操作腿 / D 三喂（`1`、`16:0`、`16:00`）全部被闸门拒 rc=1 /
  **E 变异对照：只在副本上摘掉归一那行（先断言恰好摘 1 行、摘后 0 行）**，A 腿随即读到 `[时:分]`
  ⇒ A 那条绿是被测那段给的、不是桩自己给的）。
  ⚠️ **本线自己第四次被 `check:shell-unicode` 抓**：rig 里写了 `（$OUT）` ⇒ 已花括号化。
  🔴 **更该记的是抓它的那次读数被我自己吃掉了**：`node scripts/…mjs | tail -3; echo RC=$?` 里那个 `$?`
  是 `tail` 的（§7 #45 原文），于是门禁报红被我读成 rc=0 并打印了一句"修法"当背景噪音 ——
  改成像现在这样**先重定向、再取退出码**。这条不是新坑，是我在同一个坑里第四次踩。
  🔴 **现量到一道不归本线的门禁红（登记，不动他们的文件）**：
  `node scripts/check-script-snapshot.mjs` ⇒ rc=**1**，两处都指向**未跟踪**的
  `scripts/verify-mobile-account-erasure.sh` / `scripts/verify-mobile-ios-account-erasure.sh`
  （`git status --porcelain` 现量两枚都是 `??`），而 `scripts/check-script-snapshot.mjs` **自己**也是 ` M`
  ⇒ 那是账户清除那条线正在成形的东西。`check:script-snapshot` 挂在 `pnpm check` 上（`package.json:66` 现量）
  ⇒ 它会挡"全量 check 绿"那一句，**但挡的原因是他们在飞，不是本线的洞**；处置＝等他们提交，
  复跑命令就是上面那条 `node scripts/check-script-snapshot.mjs`。
  ✅ **看守已按 (14) 那条重挂**（现量：pid **71648**、`BUDGET=7200 INTERVAL=60`、
  日志 `/tmp/ht-r14c-window.20261004-193742.71648.log`，稳定指针 `/tmp/ht-r14c-window.log` 已指过来）。
  开窗前后判据仍只有闸门那一个来源；**这轮带去的判据集是修过的**（链的覆盖清单里本来就有
  `scripts/verify-mobile-due-time.sh`，所以不必等入库也能生效 —— 但已入库才谈得上"载体落后也不是旧判据"）。
  19:3x 现量窗口闸门：rc=3、`REDS=load,src,dev,apk`（18:2x 那次是 `load,src,apk` ⇒ **`dev` 又红了**，
  设备面又有人在跑；`apk` 那格由链自己在窗口里补）。
- (16) **20:0x：第二次开窗 —— 装置按设计工作，而这一趟**一条产品判据都没跑到**（通道死 + 前台不是本应用）。**
  🔴 **链这一段是对的，要记**：`WINDOW=open 20:03:57` → `SYNC 目标 671020ac` → `install/build_all/stack_up/build_android/preflight` 全 rc=0 →
  **`REGATE try=1 rc=3 REDS=load`（负载 22 > 12）⇒ 链没有动设备，等 60 秒重问 → `try=2 rc=0`（负载 12）⇒
  `REGATE_OK —— 下面是第一次也是最后一次动设备`**。
  这正是 (13) 之后补的那道"打完包再问一次闸门"的现场价值：Gradle 自己把负载抬到 22，而窗口在开跑**之前**就已经不是开窗那个状态了。
  🔴 **读数本身无效，且无效得毫无争议（两条原文，不是推断）**：
  第 2 步 `⚠️ uiautomator 连续 10 次抓不到界面` + `**/tmp/ui.xml 已被截成空文件** —— 接下来任何断言都会报「找不到 X」，
  那是假红，不是产品缺陷`（这一句是共享库自己打的）；第 3 步 `screen_txt` 打出来的前台是
  **`SIM Toolkit / USIM Card / TMoble`** —— 设备前台此刻根本不属于本应用。
  ⇒ 那一趟的 8 条红**一条都不算产品结论**，而判据集（第 5 步起）从未开始。**为什么被顶走没有证据**，
  不写因果（并行会话在动这台模拟器 / 镜像自己的弹窗 / uiautomator 自己挂了，三种都还没排除）。
  🔴 **本轮修两处，两处都是"让无效来得早、来得响亮"**（都不是新装置，是仓内既有那把）：
  1. **第 1 步的"应用已启动"换了承重判据**。原来只有 `has_text "任务"`，而共享库那段注释
     （`lib/mobile-e2e.sh:1497` 起）**早就写着这一句是假绿**：欢迎页说明文字里也有「任务」二字，
     窗口归属只能读 `mCurrentFocus`。现量：`verify-mobile-notes.sh:240` / `verify-mobile-trash.sh`
     用的是 `settle_foreground`（6 次拉起仍不进前台就停），我的脚本一条都没有 ⇒ 补上，
     排在 `dismiss_welcome_if_present` **前后各一次**（照 notes 那两行的顺序），停法是 `exit 3`（读数无效 ≠ 产品失败）。
  2. **新增 `assert_channel <在哪一步之前>`，卡在第 5 步头上**——判据集从这里开始，所以从这里开始
     必须先满足两件事：`hierarchy` 非空（`require_screen`，空则它自己 exit 3）且 `mCurrentFocus == PKG`。
     理由就是这一趟：`dump()` 重试 10 次之后**不退出**，只把 `/tmp/ui.xml` 留成空文件，
     脚本于是继续往下收红。红要落在"通道死了"那一行，不能落在"移动端没把 time prop 传下去"那种话上。
  🟡 现量（20:1x）：`bash -n` rc=0；`node scripts/check-shell-unicode-vars.mjs` rc=**0**（扫 116 个 `.sh`）；
  `bash research/tools/r14c-time-empty-arms.sh` rc=**0**、`pass=7 fail=0`（新加的 `assert_channel` 不在抽取范围内，
  那把 rig 量的仍是归一那对，没有因为这次改动失去牙）。
  ⏭️ **仍然没闭合的两件事，都不许在这一格被读成"已验"**：
  ① **修过的判据集至今没有被任何一趟真设备跑到**（19:1x 那趟用的是修之前的判据，20:0x 那趟在判据集之前就废了）
  ⇒ 它的现场证明还欠着，下一发窗口才谈得上；
  ② (14) 那条"⑧ 之后停在「我的」页"仍未定性（这一趟连第 4 步都没到，`screen_txt` 那条新取证腿**也没被喂到**）。
  ✅ 看守已按新的判据集**重挂**（现量 20:2x：pid **74502**、`20:22:07` 起跑、
  日志 `/tmp/ht-r14c-window.20261004-202207.74502.log`，稳定名已指过来、目标存在）。
  下一发带过去的是**三笔的形状**：`85427dae`（判据五处）+ `60d3234f`（锚点闸门 + 五臂）+ `c09a6a7a`（两道停止条件 + 八臂），
  而链的第 0 步覆盖清单里本来就有这枚脚本 ⇒ 载体落后也不会退成旧判据。
  现量命令：`grep -n '❌\|REGATE\|SIM Toolkit' /tmp/ht-r14c-chain.71648.log`、
  `sed -n '1035,1064p' /tmp/ht-r14c-chain.71648.log`（第 2 步通道死的原文与第 3 步的前台）。
  🔴 **这两道新的"停止条件"不当它们只有静态级**：新 rig `research/tools/r14c-channel-arms.sh`
  现量 `pass=8 fail=0`（A 放过 / B 别人的包 ⇒ rc=3 且读数带"是谁的前台" / **C 取不到前台 ⇒ 也 rc=3** /
  D hierarchy 空时由**真的** `require_screen` 先停 / **E 变异**：把那条比较摘成恒假后 B 形与 C 形两腿都不再停
  ⇒ 那两臂的 rc=3 是被测那段给的；G/H/I 抽**共享库**的 `settle_foreground` 原文跑三条腿：
  前 2 次别人的包第 3 次对上 ⇒ rc=0 且重试 2 次留痕 / 6 次全错 ⇒ rc=1 / 🔴 前台行恒空 ⇒ 也 rc=1）。
  ⚠️ **写这把 rig 时自己造的三个坏读数**（都记下来，因为它们第一眼的样子都像"被测的东西不会停"）：
  ① 桩 adb 是**另一个进程**，`FAKE_FOCUS=` 没 export ⇒ 三臂齐读"取不到"，症状是正向腿红、负向腿反而绿；
  ② 夹具尾部只 `echo "rc=$?"` 而**没有把码转成脚本退出码** ⇒ 脚本的码是那句 echo 的（恒 0）；
  ③ 桩回的 `mCurrentFocus` 帧形状是自己编的（少一个空格）⇒ 被测那两级 `sed` 裁出来的不是包名。
  ③ 的更正方式是先拿真设备打一帧原话照抄（`adb -s emulator-5554 shell dumpsys window | grep -m1 mCurrentFocus`
  ⇒ `Window{424eb1a u0 com.heyta/com.heytamobile.MainActivity}`）。
  🟡 三条腿都补了**"桩真的被问过"的前提**（读计数文件，`<3`/`<6` 直接判前提不成立而不是判绿）——
  少了这条，①那种坏会表现成"库里的函数不会停"，而那是装置坏了。
- (17) **20:2x–20:4x：把那两条欠账变成"一次开窗就能同时答"的形态 —— 顺手查出本脚本自己有一处"半套现场"（dump 通道两个所有者）。**
  🔴 **现量：`scripts/verify-mobile-*.sh` 里 29 枚共用默认的 `/tmp/ui.xml`**，只有 `verify-mobile-account-erasure.sh`
  改成每跑私有（它给的理由更硬：dump 会把输入框里的令牌抄进本机明文）。本脚本原来也共用那一枚，
  而**真正的问题是它自己就是 lib 注释里那句"半套现场"**：`rid_count/rid_xy/rid_attr` 三枚助手写死字面量
  `/tmp/ui.xml`，而同一个脚本里的 `dump`/`require_screen`/`screen_txt` 读的是 `$UI_XML`
  （lib 在 `mobile-e2e.sh:38-48` 留的旋钮）。今天两边取值相同所以看不出来；
  **一旦有人给这趟设了 `HEYTA_E2E_UI_XML`，一半判据就去读别人的界面而不报错。**
  ✅ 改成单一所有者：`UI_XML=/tmp/heyta-duetime-ui.$$.xml`（**必须在 source lib 之后直接改**，lib 读 env 是在 source 那一刻）、
  三枚助手只传 `"$UI_XML"`、EXIT trap 连带删它、第 0 步把**读数落点**打进日志。
  🔴 **一条把 ⑧ 那条未定性**收窄**的推理（范围论证，不是定性，别读成"已解释"）**：
  一台设备只有一个前台 ⇒ "本机文件里是别人的界面"与"设备正在别人的屏上"**不是两个独立世界**：
  对方的 `cat` 要落到同一个本机路径，他必须**也在同一台模拟器上跑**。而 lib 的 `dump()` 是
  **先 `rm -f /sdcard/ui.xml`、失败时不覆盖远端、再 `cat > 本机`**（`:219/:225`）
  ⇒ 并发写同一枚本机文件留下的形状是**空文件**，这正是 20:0x 那一趟的形状；
  19:1x 的 ⑧ 读到的却是一份**内容完整的「我的」页** ⇒ 那不是"我的 dump 失败、读到了过去"，
  而是**那一刻设备的前台确实不在这棵应用上**。**谁把它弄走的仍未定性** —— 定性要等下面那枚读数。
  ✅ 于是给三条红各装上**判决读数**：新 `who_else()` 并排打两枚 ——
  **窗口级** `mCurrentFocus`（分得开"是我们的应用但走错屏"与"整个前台不是我们的应用"）
  与**进程级** `another_mobile_e2e_running`（告诉你谁在跑）；挂在 `assert_channel` 与 ⑧ 的三条 bad 分支上。
  ⚠️ 那枚探针**返回的是 awk 的码（恒 0），判据是输出非空**（这条写在 `verify-mobile-account-erasure.sh:108`，我照了）。
  现量它真的会输出东西：`67974 … scripts/.verify-mobile-ios-reminder.sh.snap.67974`（20:4x）
  ⇒ **`dev` 那格此刻又是红的**，C 的下一发要等它让位。
  ✅ 牙扩成**九臂**：`bash research/tools/r14c-channel-arms.sh` ⇒ `pass=9 fail=0`。新臂 J 是"通道只有一个所有者"的静态不变式
  （代码行里字面 `/tmp/ui.xml` 必须 0 处、三枚助手必须都传 `"$UI_XML"`；**注释里的历史说明不计**——删掉反而毁掉理由）。
  臂 J 的变异对照：把 `rid_xy` 改回字面量 ⇒ **恰好臂 J 红**（读数 `还有 1 处字面 /tmp/ui.xml、助手带变量的只有 2/3`）、
  rig rc=1；变异体是 `/tmp` 里的副本，用完即删，原脚本字节未变。
  ⏭️ 这一格之后，(16) 的两件欠账**一次开窗即可同答**：判据集第一次在真设备上跑（①），
  而 ⑧ 若再红，日志自带窗口级 + 进程级两枚读数（②）—— 不用再靠下一位读者推断。

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

**I. `check:docs` 那处红：02:1x 现量是红的，四分钟后在 HEAD 侧还没闭合。**（登记一次瞬时读数，重点是它的形状）
02:1x 现量：`NO_COLOR=1 node research/tools/docs-link-check.mjs` ⇒ rc=**1**，唯一一条
`docs/plans/multi-end-coverage-handoff.md:317 -> goal-multi-end-coverage.md §7.30`「该章节号不存在」，
而同一个检查器自己列出的实际号段最大到 **§7.29**；那两处文件**当时都是干净的**（`git status --porcelain` 对
两个路径 0 行）⇒ 那枚红**在 HEAD 里**，由 `47c7b17d`（02:11「记账落点改回 Goal 台账 §7.30」）落下 —— 它指向
§7.30 而那一节还不存在。🟢 02:1x 复跑 ⇒ rc=**0**：不是有人提交了什么，而是**对方把 `### 7.30 §5 四段的记账槽`
写进了工作树**（现量 `git show HEAD:docs/plans/goal-multi-end-coverage.md | grep -c "^### 7\.30"` = **0**，
而 `git status` 显示那两枚文件都是 ` M`）。
📌 **可迁移的形状：`check:docs` 量的是工作树，所以一条"来自 HEAD 的红"可以在零提交的情况下消失** ——
报"这处红归别人、已闭合"之前要分清它闭合在**哪一侧**；只闭在工作树的红，对方一次 `git checkout` 就会回来。
⇒ 仍**不归本线**：不代改、不为它放宽判据。复跑：
`NO_COLOR=1 node research/tools/docs-link-check.mjs > /tmp/docs.out 2>&1; echo rc=$?; grep -F "§7.30" /tmp/docs.out`
🔴 **同一条性质的反方向现量（02:4x）**：这道门禁也能在**零提交的情况下新增一条红**。别人 02:38 新写了
`scripts/verify-ios-vault-keychain.sh`（状态 `??`）并在 `docs/adr/0050-e2ee-key-lifecycle-and-recovery.md:122`
加了指向它的 markdown 链接 ⇒ 本线那道静态检查点从 rc=**0**（02:32 还是绿的）变成 rc=**1**（**1** 处死链）。
⚠️ 归属已钉死，而且**对方自己已经登记过这条**：`docs/plans/multi-end-coverage-handoff.md:554` 那段写的就是它
（"修法在他们手里是一行：把脚本点名 `git add`；我不去改那个文件，也不放宽判据"）。
⇒ 本线按同一条纪律处理：**不代改、不吸收、不放宽、不写进本线待办**。
📌 一般形状：**这一道的红条数是工作树的瞬时读数** —— "我这轮检查点 0 红"和"下轮 1 红"可以在本线一行代码没改的情况下
同时成立，所以每条引用前必须重跑，且**红要先做归属再决定碰不碰它**。复跑：
`NO_COLOR=1 node research/tools/docs-link-check.mjs > /tmp/ht-g2.out 2>&1; echo rc=$?; grep -c -- '->' /tmp/ht-g2.out`
⇒ 现量 rc=**1** / 计数 **1**（那一处 = `scripts/verify-ios-vault-keychain.sh`）。
🔴 **同一趟 5 分钟后再复跑变成 rc=1 / 计数 6**：来源全部落在同一份 `docs/adr/0050-e2ee-key-lifecycle-and-recovery.md`
的 122 / 132 / 132 / 133 / 133 / 134 行（1 枚脚本 + 5 枚 `apps/mobile/evidence/ios-keychain-probe-*.json` 证据文件），
那份 ADR 此刻仍是 ` M` ⇒ **一处都不归本线**的判断不变，但"计数 1"这个数本身已经过期。
📌 由此给这条门禁的用法下一句结论：**它只能当趟读数，不能当结论被下一轮引用** —— 写"计数 N"必须带上跑它的那一分钟，
否则本文件就多出一份会过期的清单（同一件事本篇今天已经记过第四次）。归因命令（分来源、分目标各数一次）：
`grep -B1 -- '->' /tmp/ht-g2e.out | grep -cE '^   docs/'`。
同批的另两道静态检查点仍是 0：`node scripts/check-md-table-rows.mjs` rc=**0**（"4 个文件，列数、断行与是不是表都一致"）、
`node scripts/check-shell-unicode-vars.mjs` rc=**0**（89 个 .sh）。
⚠️ 一次自伤读数（本轮第三次同形状，都写在这条里免得下一个人重踩）：我复核时把 `git show HEAD:<文件>` 管道给
`grep -o` 一个**不带反引号**的 needle，得到空，差点写成"检查器行号是坏的"—— 原文那一行里文件名两侧带反引号。
**检查器的行号是对的，坏的是我的 needle。**

🔴 **03:3x：`docs-link` 第三次因别人而红，这次的红是"会自己出现又自己消失"的那种**。
03:2x 现量它还是 rc=**0**（本线两份文档零命中），03:3x 变 rc=**1**、**28 条红**，逐条归属：
`tmp/mutant-pipe.md` **14** 条 + `tmp/trap-head.md` **14** 条，**本线两份文档命中 0**。
这两枚不是文档，是**别人那套变异装置的一次性夹具**，写在 `docs/plans/tmp/` 下面；
我复核时（相隔约 60 秒）`ls docs/plans/tmp/` 已经报 `No such file or directory`，
而再跑一次检查器 28 条**仍在** ⇒ 它是在**反复创建/删除**的循环里被扫到的。
⚠️ 两个可迁移的点：① **把一次性夹具写进 `docs/` 之下，就会被常驻文档门禁扫到** ——
这条红不指向我改过的任何文件，却会在别人那一轮的 `pnpm check` 里出现；
② `docs/plans/tmp/` **不在 `.gitignore` 覆盖范围内**（现量 `git check-ignore -v` 无输出、`git ls-files` 0 枚）
⇒ 只要那套装置中断一次，夹具就会以未跟踪文件留在仓库里，**下一次谁 `git add -A` 就把夹具提交进去**
（本线 §4 A 记过的"19 枚判据漏入库"是同一族的反面）。
⇒ 处置仍是那条纪律：**不代改、不吸收、不放宽、不写进本线待办**；复跑与归属：
`NO_COLOR=1 node research/tools/docs-link-check.mjs >/tmp/ht-dl.out 2>&1; echo rc=$?; awk '/^   [^ ]+\.md:[0-9]+$/{print $1}' /tmp/ht-dl.out | cut -d: -f1 | sort | uniq -c`
（期望：命中文件名只剩 `tmp/*` ⇒ 不归本线；出现 `calendar-*` ⇒ 才轮到本线）。
📌 待入 traps（取号按当时活树尾号 +1）：**"验证装置的临时夹具不许落在被扫描的目录里"** ——
判据是常驻门禁的扫描根，夹具应该落 `/tmp` 或 `research/tools/.scratch/`（并在 `.gitignore` 里）。

**J. 全仓库还有 23 个证据目录里的 129 张截图**没有一条常驻判据（14:1x 现量），**逐枚都不归本线。**

`r17-evidence-md5-check.sh --all` 现在会点名它们（见 §4.05 (8)），但**基线是棘轮不是零**：
存量 23 枚是别的条线的债，本线一上来把它们变成常驻红 = 教人忽略红（§8.3），
所以两档基线钉在现量（`NOREADME_MAX=20`、`UNPINNED_MAX=3`），**新增一枚立刻红**。

- **本线偿掉的**：`calendar-year`、`calendar-day-time`（13:5x）、
  `calendar-cells`、`calendar-week`、`calendar-capture`（14:1x）—— 共 5 枚目录 / 18 张图。
- **剩下的按大头看**：`apps/web/evidence/vault-panel` 33 张（账号注销与 vault 那条线）、
  `row-tail-fold` 10 张、`auth-journey` 8 张（有 README 但 0 锚点）、
  `password-web-journey` 7 张、`desktop-windows/evidence/journey` 7 张、`ui-review-r7-r8` 6 张 …
- 🔴 **本文件不抄那张 23 行表** —— 抄件一定会漂，而且这条**本来就有生成器**。
  要清单（目录 → 引入它的提交 → 图数 → 有没有 README）现取：

```bash
cd "$(git rev-parse --show-toplevel)" && {
  bash research/tools/r17-evidence-md5-check.sh --all 2>/dev/null \
    | grep -E '^(NOREADME|UNPINNED) ' | sed -E 's/^(NOREADME|UNPINNED) ([^（]+)（.*/\2/'
} | sort -u | while read -r d; do
  printf '%s\t%s\t%s\n' "$d" \
    "$(git log --diff-filter=A -1 --format='%h %ad %s' --date=short -- "$d" | cut -c1-58)" \
    "$([ -f "$d/README.md" ] && echo 有README || echo 无README)"
done
```

  ⚠️ **归属只能按"哪条线引入的"判，不能按 `git log` 的作者判** —— 这台机器上所有并行会话
  共用一个 git 身份（14:1x 实测：23 枚的引入提交**作者全是同一个人**），
  所以"作者 = 谁"在这条线上**没有分辨力**，能用的只有提交主题 + 那条线的计划文件。
- **偿一枚的代价**（写清楚，别让人以为很大）：打开那几张图 → 在同目录 README 逐张写"人看到的" →
  钉 `md5`（字节稳定）或 `UIPIN`（图里有每趟随机的任务名时**必须**用后者，
  判据 = 看产出那张图的 spec 里有没有 `Date.now()` / `Math.random()` 的 STAMP）→
  复跑 `--all` 看 `dirs_without_readme` / `dirs_unpinned` 是否各减一。
  🔴 **基线要跟着现量改小，而且注释里写明偿掉的是哪一枚**（两个旋钮旁边都留了现量命令）。
- **另有一枚本线内的缺口**：`e2e/tests/calendar-capture.spec.ts` 的**第 2 条**
  （"输入里写『后天』时以输入为准"）**没有截图** —— 整个 spec 只有第 1 条 `page.screenshot`。
  那条主张现在只有 DOM 断言撑着。补图与上面那九张 UISTALE 的重拍共用同一个窗口前置（§5 的 H）。

---

## 5. 下一步（有序，每条带开工判据）

**一眼表**（10:2x 首版；六项各自的状态 / 在谁手里 / 现量命令 —— 下面各条是账，这张表是目录；
每格都是**瞬时读数**、各自带取数时刻（最近一轮 12:2x：H/B 两格换了新读数，C/A 仍是 11:2x/11:39 那批），开工前重跑第三列，别抄本表）：

| 项 | 状态 | 在谁手里 | 现量命令 |
|---|---|---|---|
| H | 交付物在 HEAD 且字节可复验（10:4x rc=0/12 条）；🔴 但**主张只到 `39032107`**（见 n 格）—— 12:1x 起这句话**有一条会自己响的判据**了：`UIPIN` 代码锚点，现量 `--dir apps/web/evidence/calendar-view-options` ⇒ `entries=1 mismatch=0 pins=2` rc=**0**（两枚 UIOC）。🔴 同刻 `view-select-closed.png` 的常驻 md5 **降级为记录值**：11:55 别人那趟在**同一笔代码**下把它改了 4982 枚像素（全在左侧 rail，肉眼并排无差、原因未定性）⇒ 见 bb) 格与 §6 第 34 条；flaky **未定性**——(a) 仍没喂到，且 10:5x 借来的那趟红**里没有洪泛**（见 q 格）；看守已装自快照 bootstrap（11:1x，见 x 格），11:2x 起**每趟自动打一行 `RUN_<i>_DISTFRESH`**（§5 第 1 条搬进装置，见 y 格） | 整机负载 + 往树里写的并行会话（11:2x 现量负载 69，看守 pid 38951 在等） | ~~`tail -3 /tmp/ht-h-flaky.*.log`（稳定名软链已没，用每趟唯一那份）~~ 🔴 11:1x 起**稳定名软链又在了**（允许名单只有 `run` 会挂，现量 `lrwxr-xr-x /tmp/ht-h-flaky.log -> …112757.38951.log`）⇒ 读 `tail -3 /tmp/ht-h-flaky.log`；`bash research/tools/r17-evidence-md5-check.sh --all`；`git log -1 --format='%h %ad' --date=format:'%H:%M' -- apps/web/evidence/calendar-view-options/view-tabs-year.png` |
| B | 未闭合；🔴 **12:2x 复跑 `bash scripts/verify-mobile-window-gate.sh --target b` ⇒ rc=3、`REDS=load,src,dev`**（负载 66、66 枚未提交源码、pid 9178 在跑移动端验收、pid 93817 那趟 reinstall 还楔着 —— `notarytool submit --wait` 此刻 etime **09:10:36 / CPU 0:00.03**）。与 11:2x 那格相比 `apk` 那一档**已经不红了** ⇒ 阻塞集从四减到三，但三条里两条是别人的动作，不是等待可解。**第二条路已有装置**（四段身份对账，10:4x 复跑三段仍 `DIFFER`）⇒ 🔴 对账只有在**自己刚 build 完的那一刻**之后跑才算数（本机 `apps/web/dist` 是并行共写件，见 p 格）；闭合序列已钉成①build→②reinstall→③reconcile。🔴 **14:2x 复跑：rc=3、`REDS=load,src,dev,apk`** —— `apk` 那一格**又红了**（12:2x 那次它是唯一不红的），负载现量 **27.55**，93817 那趟 etime **11:10:39 / CPU 0:00.01**、叶子 98934 **11:09:42 / CPU 0:00.03** ⇒ 楔住更深，结论不变：这条**不是等待可解** | 🔴 **16:0x 复跑：rc=3、`REDS=src,dev`**（`load` 与 `apk` 两格转绿：负载现量在阈值 12 上下抖、`APK 不比源码旧`）。剩下两格的**性质都查清了**：`dev`＝93817 那趟整链是**孤儿** —— `/tmp/queue-reinstall-all.sh`（pid 81007）的 **PPID=1**，启动它的会话早就不在了；叶子 98934 `notarytool submit --wait` etime **12:20:27 / CPU 0:00.03**，而 `lsof -nP -p 98934 -a -i` **一条 socket 都没有** ⇒ 不是「正在轮询的等待」：0.03s CPU 撑不起 12 小时的轮询握手（⚠️ 从前那句「非等待可解」是拿 CPU 推的，这次补上了直接证据）。`src`＝**100 枚**别人未提交源码（现量含 `apps/mobile/ios/Heyta/*.swift`、`apps/mobile/src/screens/*.tsx`、`packages/i18n`、`apps/landing/docs/*.html`）。🔴 **不动那枚孤儿**，三条理由，而且第①条**只对一半**：① 对**共享树**这一路，`src` 那格独立就把 B 和 C 都挡住了，砍一棵不解决任何一条 —— ⚠️ 但这句对「在 HEAD 的隔离 worktree 里跑重装」那一路**不成立**（那条载体天生干净、`src` 根本不适用于它），所以杀链确实能开那扇门；不走它的原因是 ②③，不是 ①。（我 16:0x 第一版把 ① 写成了通用结论，被本文件 §4.05(9) 自己那条「隔离载体」出路否证 ⇒ 就地改成限定式，留这句自我更正的理由是让后来者认出「归因写成断言、范围却比证据宽」这个形状。）② 杀掉链会让那趟从 mac 段继续往 windows / android 走，`adb uninstall` 落在共享模拟器上（§7 第 244 条预告的形状），而四端重装本身就包含「卸掉别人刚装上去的那一份」这种动作；③ 它已被另一条会话登记在案（B76 补记 #11/#12）⇒ 拍板权在那条线，本线不代拍。复跑：`ps -o pid,ppid,etime,command -p 81007`（PPID=1 即孤儿）· `lsof -nP -p 98934 -a -i` · `bash scripts/verify-mobile-window-gate.sh --target b`。🟢 **17:3x 更正上面这一格的两处**：① 那两枚无主占用（81007 整链、29644 那枚 18h 满转的 vitest worker）**在我动手前已被各自持有者收掉**，本会话没有 kill 任何进程；② 我当时说"公证通道解析不到是对 B 更硬的外因"，**那句被自己否证**（`notarytool history` rc=0、`appstoreconnect.apple.com` 302，notarytool 不用 `notary.apple.com`），撤回并记在 §4.05 (10)。另外 `package-app.sh` 自 `694c05e3` 起有 900s 公证上界 ⇒ 楔 12h 这一形不会重现。旧账：楔住的重装叶子 `notarytool submit`（pid 98934，CPU 0s）要**持有者拍板**；设备面被别人占（10:4x 现量还有 `verify-mobile-ios-reminder` pid 79158 在跑 —— 11:1x 复跑它已退出，11:2x 现量占面的是 pid 41138，11:4x 复跑是 **56364** —— **连续换班，没有"等这一个"的终点**） | `IOS_DEVICE_NAME="heyta-iphone-17pro" bash research/tools/b-batch-reconcile.sh`；`bash scripts/verify-mobile-window-gate.sh --target b`（取 rc 用 `OUT=$(…); rc=$?`，别接管道） |
| C | 未闭合；10:4x 复跑 ⇒ **rc=3、`REDS=load,src,dev,apk`**（5 条 ❌，两条共用 `WHY_DEV`，这是第 307 行注释预告过的形状、不是新缺陷）；载体链与四层判据都在，等同一张设备面。🔴 **11:2x 复跑同一条命令：rc=3、`REDS` 逐字相同，但三格内容变了** —— 凭据三件套现量**都在**、模拟器**在线**（旧账那两行"全无/要起栈"过期），设备面运行者**连续换班**（10:4x 79158 → 11:2x 41138 → 11:4x **56364**，前两个都已退出 ⇒ 没有"等这一个就好"的终点）；`src` 那格量化过，**且量的是会翻的比例**（逐树 M 行 ≠ 逐消费者源码：11:2x 是 21 枚里 evidence 2 枚，11:3x 复算成 38 枚里 evidence **21** 枚 ⇒ 那格的红有多少"只是别人的取证图"取决于谁刚跑了一趟 e2e，别抄本表）；不改判据的两条理由与"按 target 分范围"这条下一批边界在第 4 条末。🔴 **14:2x 复跑：rc=3、`REDS=load,src,dev,apk`**（与 10:4x 逐字相同），`src` 那格现量含 `packages/i18n`、`packages/legal`、`packages/shared-schema`、`server/src/legal.generated.ts` 等**多条并行线正在写**；同一分钟 `lsof` 现量 4318/4319 由 node **93264 / 93252** 占着 ⇒ H 与 C 共用的是**同一张窗口**，不是两张。🔴 **17:3x 再复跑：rc=3、`REDS=load,src,dev,apk`**（四格全红回去：负载 15–19、`src` 101 枚、dev=pid 49211 正在跑 `verify-mobile-card-export-ios.sh`、APK 15:02 比源码 15:36 旧）。🔴 **17:46:22 那个看守真的开火了一次**（`FIRE=apk-deferred`），链跑到 `stack_up rc=1` 停住 —— 根因与修法、四臂牙、变异读数全在 §4.05 (13)：**载体没有未跟踪的 `server/.env`，而 `mobile-e2e-up.sh` 的启动 env 块里没有 `JWT_SECRET`**（主检出靠 dotenv 读那个文件，链依赖的东西必须与 dependent 同列）。现量 18:2x：`REDS=load,src,apk`（`dev` 又绿，17:4x 报的 pid 90200 已退）⇒ **C 离闭合只差一次重挂看守 + 负载落位**。**上一把看守**：pid 84884、`CARRIER=…heyta-wt-r14c BUDGET=7200`、日志 `/tmp/ht-r14c-window.20261004-171301.84884.log`；而同一趟 `--repo 载体` 那一路现量 `REDS=load,dev,apk` —— **`src` 在隔离载体里是绿的**（见 §4.05 (10) 最后一条）。上一次 16:0x 的读数：rc=3、`REDS=src,dev`，设备面前置**四条同时绿**（本线第一次见到这个组合）：粗筛没有别的移动端验收在抢 emulator-5554、emulator-5554 在线、凭据三件套都在、APK 不比源码旧，负载与 apk 两格都不再红。挡住它的还是那两格，且都不归本线：`src`＝100 枚别人未提交源码（含 `packages/i18n`、`apps/mobile/src/screens/ProfileScreen.tsx`），`dev`＝上面那趟孤儿重装（性质与「不动它」的两条理由见 B 格）。⚠️ **本批刻意不给 C 挂 `r14c-window-retry.sh`**（开窗即打 APK 会把 H 的负载门顶回去，而 C 的 blocker 是"要人拍板"不是"没排队"） | 18:0x 现量：楔住那趟重装（`reinstall-all` / `notarytool` / `queue-reinstall`）**整条已消失** ⇒ `dev` 那格自解，本线没有要等的外部拍板了；剩下的是负载 + 别人未提交源码（`src`）+ apk 那格由链自己补 | `bash scripts/verify-mobile-window-gate.sh --target c`；`bash research/tools/r14c-bundle-testid-preflight.sh`；`src` 差集（表格里不放管道符，那要转义且复制下来不能跑）：`git status --porcelain -- packages apps server >/tmp/ht-dirty.txt; grep -cE '^ ?M' /tmp/ht-dirty.txt; grep -c '/evidence/' /tmp/ht-dirty.txt` |
| A | ✅ **10-04 16:0x 闭合**（用户当场授予提交权 —— 这同时是本线**第一次真跑** `--confirm` 那一腿）：`b4033742`，32 枚点名路径 / +2706 −88，`git show --name-only` 逐条都在本线 PATHS 里、别人的路径 0 枚被带走，**没有 push**；复跑 `bash research/tools/calendar-line-commit-plan.sh` ⇒ 「A 此刻**无待办**」、命名空间 0 枚未点名、md-tables / shell-unicode / docs-link 三声 rc=0。🔴 入库当场把那条**自锁的前置**换掉了：旧 §2「索引必须是空的」来自一次**裸 `git commit`** 的事故（实测吞掉别人 109 枚暂存），而本工具走 `git commit --only -- <点名路径>` —— 15:0x 手工一趟 + 15:4x rig 臂 1 一趟（两次外来暂存枚数都是 1）实测：别人那枚的索引 blob 提交前后**逐字相同**、且不在本笔的树里 ⇒ 前置换成**提交后逐字节对账**（§5b），牙落在新 rig `research/tools/calendar-line-commit-only-arms.sh`（当时三臂，**现五臂** —— 新增那一对量 §3 收窄的两个方向，见 §4.05 (12)：正向 / 把 `--only` 摘成裸 commit ⇒ §5b 点名 foreign.txt 且 rc=1 / 把**我方点名路径**暂存成别的内容 ⇒ §2 拒绝、零提交、那份暂存原样留着）。已入 §7 第 **247** 条。⚠️ 本线那枚 `r17-evidence-md5-check.sh` 的十臂版**没等到自己那笔**：15:2x 被并行会话的 `8590ae02`（「r17 证据校验脚本的 $var+中文 写法收敛」）连工作树整文件提交掉 ⇒ 内容在 HEAD、署名在别处（同族事故已在项目 memory 里）。下面那句是当时的账，留着是因为它记的是一条**性质**（这条闸门的颜色与别人的动作同源，不是本线的属性），不是当前读数：🔴 **此刻没有提交权**；11:0x 复跑 ⇒ **rc=1**：别人的三枚 `apps/landing/evidence/*.png` 进了索引，闸门拒绝在它上面动刀（v 格）。本线待入库 **8 枚**（改动 7 + 新增 1 枚 `f-boundary-scope-count.sh`，先 add 才进得了 `--only`）。🟢 **11:39 复跑 ⇒ rc=0、`✅ 索引为空（0 枚）`、三门禁 rc=0、待入库点名 8 枚、工作树脏行分母 78** —— ⚠️ 这格的红是**别人把自己那三枚提交掉**才消的，与 o 格那句"绿此刻挂在别人的暂存区上"是同一件事的两个方向：**这条闸门的颜色与别人的动作同源，不是本线的属性**；🟢 **17:4x 复跑：A 仍然闭合，但"闭合"的含义要说清** —— 待入库 **4 枚**且**全是图**（`view-select-closed.png` + `calendar-day/day-en-{empty,full,no-timed}.png`，mtime 17:25 = 别人那一趟 e2e 的产物），本线这一笔只带 3 枚文档/装置（账在 §4.05 (12)），**这四枚刻意不带走**：盘上字节与其 README 记的不是同一份（`r17 --dir …calendar-day` ⇒ `md5bad=1`）。带走 = 造出一个自相矛盾的 HEAD，也正是 (11) 那句警告点名的形状。同刻 `shell-unicode` 由 rc=1 翻成 **rc=0**（持有者修掉了自己那枚），所以 17:5x 之后任何"这道门禁红"的引用都要重跑才算 | 索引那三枚＝落地页/凭据线的会话（**已提交，本格关闭**）；🔴 11:4x 起**全局 `check:docs` 又红**（3 处指向一枚未跟踪的 vault 取证件，来源 `PROGRESS.md` ×1 + `ADR-0050` ×2）＝端到端加密密钥生命周期那条线，本线不代改（z 格）；本线＝若有授权的一轮 | `bash research/tools/calendar-line-commit-plan.sh`（默认 dry-run，`MSG=… --confirm` 才动）；~~关到关的判据是回到 `✅ 索引为空`~~ 🔴 **那句随 §2 前置一起作废**（它量的是本工具不走的那条路）：现在的关闭判据 = 「待入库 0 枚」+ §5b 那句「别人的暂存一条不少、索引 blob 逐字不变」，见 §4.05 (12) 与 §7 第 247 条 |
| E | ✅ 闭合，且闭合形状是**属性**不是段数 | — | `git show HEAD:package.json` 解析链里 `check:md-tables` 恰 1 段；`node scripts/check-md-table-rows.mjs` rc=0 |
| F | ✅ 只登记两条下一批边界，本轮不做；🔴 但第二条现在有**自己的现量脚本**了（11:0x：`处=235 行=234 文件=16 去重键=222`，与 03:0x 逐字相同 ⇒ 8 小时没动；仍**不是**常驻门禁，见 u 格） | — | 英文规则表那条见本节第 6 条与过程账 §3·补 ⑧；改名这条跑 `bash research/tools/f-boundary-scope-count.sh`（三臂 `--selftest` rc=0） |

⚠️ 第三列里凡是 `/tmp/ht-h-flaky*` 的：那是看守的**一次性现场日志**（重启即没，且每趟路径带 pid），
本表与下面 j)/k) 两格已经把要留的读数**抄进正文**了 —— 下一位**不要**把"打不开那个文件"读成"读数丢了"，
要重取就重挂装置（`BUDGET=… RUNS=3 STRICT_MAX=9 bash research/tools/h-flaky-window-watcher.sh`），别去翻旧 /tmp。

1. 🔴 **任何 e2e / 界面判据开跑前先跑一次体检**：`node scripts/dist-freshness.mjs --only <这次真的读了哪些包>`。
   这是 D 那条查出来的**通用前置动作**，不是它的一次性收尾 —— vite dev 与 vitest 都读 `packages/*/dist`，
   产物落后时判据打的是旧代码（AGENTS §7 第 27 条一族），症状是"我改了、判据红/绿得说不通"。
   ✅ **11:2x：这条对 H 已经不再靠"人记得"** —— 看守 `research/tools/h-flaky-window-watcher.sh`
   每一趟开跑前自己打一行 `RUN_<i>_DISTFRESH pkgs=… behind=… missing=…`（范围从 `apps/web/package.json`
   的 `@heyta/*` 现取，体检是**记录**不是门禁），取不到范围时自报 `check=unavailable`。
   ⚠️ 其余**没有装置包裹**的判据（手工跑的 vitest / 单条 e2e / 设备脚本）**仍是手动动作**，别把这句读成"已经自动化了"。
   形状与两条取舍的理由写在 §5 第 3 条 y) 格与 §6 第 32 条（**一条没被执行过的前置，输出上与被执行过的逐字相同**）。
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
   🟢 **05:5x 复跑（同一形状、8 个包）**：`node scripts/dist-freshness.mjs --only ui,domain,i18n,app-host,shared-schema,storage,op-log,sync-client`
   ⇒ rc=**0**、表头 `8 个包：--only 请求 8 个，命中 8 个`（**命中数必须等于请求数**，否则就是 00:1x 那次"五个名字一个没匹配上却退 0"）；
   **落后 3 个**：`app-host` 旧 25s（`src/reminder-actions.ts`）、`storage` 旧 1119s（`src/db-op-log-store.ts`）、
   `op-log` 旧 1118s（`src/engine.ts`）—— 三枚源文件**都是别人正在改的那几枚**，与 §5 第 3 条 B 的前置
   （"`packages/op-log` 干净"）是**同一个事实的两种读法** ⇒ B 仍未解锁，且这条读数每次引用都要重取。
   ✅ **H 那一半不受影响**：`ui` 新 1s、`i18n` 新 67s ⇒ 05:3x 重看两张图所依据的产物是当前产物。
   🔴 **C 的链不需要在这里等**：`r14c-carrier-chain.sh` 第 148 行 `run build_all pnpm -r build` 在打包之前，
   所以主检出 dist 落后**不会**漏进载体 APK（载体是从 HEAD 重编的）—— 这一格容易误判成"必须先补 dist 再跑链"，
   实际那条前置只作用于**主检出里直接读 dist 的判据**（e2e / vitest），不作用于链。
2. ✅ **H（R17 的那张浏览器截图）已闭合（23:19）—— 只剩一枚 flaky 待追，见 §4 H 末与过程账 §3·补 ⑨。**
   🔴 **05:3x 这条"已闭合"自己烂过一次并已修回**：README 记的两枚 md5 与盘上字节对不上（别人 01:34 那趟 e2e 重写了同名 png），
   连带"四张逐字节相同 ⇒ 确定性渲染"那句也不再成立；人已按**新字节**重看、指纹与说明改写，并补了常驻对账
   `research/tools/r17-evidence-md5-check.sh`（`--all` 现量：12 份证据 README / 9 条 md5 / 其中 4 条曾坏）。
   完整读数与那条**取证可靠性缺口**在下面第 2 项末尾。
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
   🔴 **05:3x 复跑发现 H 的交付物自己烂了一格，而且烂的方式很典型**：
   `apps/web/evidence/calendar-view-options/README.md` 里记的两枚 md5（23:19 现取）与盘上字节**已经对不上** ——
   `md5 -r` 现量 `d2c5cbfd…` / `6fcbf2aa…`，README 写的是 `bf594d6a…` / `def6cc66…`。
   成因不是有人改图，是**日期过了午夜**：01:34 另一条线的 e2e 运行把同名 png 重写，
   图上的"今天"从 **10/3 星期六** 变成 **10/4 星期日**（月格里高亮格换列、日档标题与计数都变）。
   ⇒ 两个后果，都不是"改个数字"那么轻：
   ① README 那张"看见了什么"表**逐条失效**（它描述的是另一张图）—— §6.2 规定一要求"人看过那张图"，
      前提是**看的和记的是同一份字节**；05:3x 人重新打开这两枚新字节、表已按新字节改写（含"那块「日历」小框还在"这条复核）。
   ② "图本身是当前的"那句更正也一并作废，换成两条**可核**的弱主张：
   盘上字节 == HEAD 里那两枚（`git status` 对该目录为空 + `git show HEAD:<png> | md5 -r` 逐字节相同），
   以及 05:3x 重看过 —— ⚠️ **那一趟 01:34 运行的退出码本会话没有取证，所以这里不主张它跑绿**。
   🟢 **给这一族补了一条常驻对账**：`research/tools/r17-evidence-md5-check.sh`（默认对 R17 那枚 README，
   `--dir` 可换载体）。三条读数：
   平态 rc=**0**（`entries=2 mismatch=0`）；`--selftest` rc=**0**（一次性副本：未变异腿 rc=0/0 枚，
   给一枚 png 追加 1 字节的变异腿 rc=**1** 且**恰好 1 枚**、另一枚仍 OK ⇒ 它认得出"是哪一枚变了"）；
   🔴 **自然实验腿** rc=**1**、**2 枚**：把 README 换成"旧 md5 + 当前 png"（就是 05:3x 现场那个状态）
   再跑 ⇒ 它准确报出"记的与被记的不是同一份字节"。**也就是说这条判据若早就存在，本仓库不会带着坏指纹过 6 小时。**
   前提档：README 里解析到 0 条 md5 ⇒ **exit 4**（探针坏，不冒充"没有不一致"，§8.3）。
   复跑：`bash research/tools/r17-evidence-md5-check.sh --selftest` ＋ `bash research/tools/r17-evidence-md5-check.sh`。
   ⚠️ 它**没有进 `pnpm check`**（本线不擅自改链；且 `package.json` 此刻正被别人写着）。
   📌 可迁移的形状：**截图的 md5 不是恒定属性，它是"哪一趟运行"的身份** ——
   凡是"人看过 X"的取证，X 被重写那一刻那句话就自动作废，而**没有任何一层会报错**。
   🔴 **05:4x 把这条从"一枚"扩成"一片"：同一次覆盖打穿了本线三份证据 README**。
   对全仓扫一遍（`grep -E` 认两种形状）现量：**12 份证据 README 里 3 份记 md5，共 9 条，其中 4 条已坏** ——
   `calendar-day/`（R16 那三张：`46d2e2fb…`/`51926322…`/`eb50b404…` 全部对不上）与
   `profile-panel/`（R15b 的 `r15b-3-ready-dark.png`：`c2801cf0…` → `66534fd7…`）。
   四张 r15b 的 mtime **都是 01:36**（同一趟重写），但**只有暗色那张变了字节** ⇒
   原台账那句"四张的 md5 在两趟之间逐字节相同 ⇒ 确定性渲染"**现在只对三张成立**。
   ⚠️ 这条**不写成结论**：两个候选因子里，"界面内容变了（条款重确认横幅 / 昵称字段）"被**现量否证**
   （那两样都在**没变**的浅色那张里），"主题色有 CSS transition、拍在过渡中途"在
   `apps/web/src/styles/**` 里 **grep 不到 `transition:`** —— 都没坐实。
   但有一条是**读源码得到的结构事实**：`e2e/tests/profile-avatar-e2ee.spec.ts:295-299` 在
   `setAttribute('data-theme','dark')` 之后唯一的等待是 `expect(AVATAR_IMG).toBeVisible()`，
   而那个元素**翻主题之前就已可见** ⇒ 这条等待恒不阻塞，那一帧**没有任何落位判据**。
   ⇒ 登记为**本线一条未闭合的取证可靠性缺口**（不是产品缺陷）：修法形状是仓内现成的
   `waitForOverlaySettled(page, 'settings-sheet')`（`e2e/tests/helpers.ts:339`，取元素自己的动画、
   `prefers-reduced-motion` 下立即返回），**但接完必须连跑两趟比对四枚 md5 才算它管用**，那要 e2e 窗口。
   🔴 **06:3x 把那条"未验证"核成了三条已核事实，并且把缺口的范围改宽了**：
   ① `data-testid="settings-sheet"` **真的存在**（`apps/web/src/App.tsx:2277`）⇒ 那条调用可以直接接，
   我上午写"未验证别照抄"是因为没去读那一行；
   ② `.ht-sheet` 的入场动画是 **`opacity: 0 → 1`**（`apps/web/src/styles/app/sheets.css:68-77`），
   而 `toBeVisible()` **不看透明度** ⇒ 缺落位判据的**不只是暗色那张**，四张里"刚打开浮层就拍"的都算
   （原来那条登记把范围写窄了，只盯在主题切换那一处）；
   ③ 那条 helper **有消费者，但不在这份 spec 里**（`e2e/tests/*.spec.ts` 命中 1 个文件、不是 `profile-avatar-e2ee`）
   ⇒ "仓里有这个装置"≠"这条线用了它"，这是 §7 那一族"零件都在、产品里没接"的第五次。
   ⚠️ **本轮不动它**：`git status --porcelain` 现量 ` M e2e/tests/helpers.ts` +
   ` M e2e/tests/profile-avatar-e2ee.spec.ts` + `?? apps/web/src/features/settings/CloseAccountPanel.tsx`
   —— 有人正在往设置面加东西。**撞车的判据是同一文件的未提交 diff**，不是"这条面归谁"。
   移交口径与四处截图的行号（244 / 292 / 299 / 320）已写进
   `apps/web/evidence/profile-panel/README.md`，含复验命令（连跑两趟比 md5 + `r17-evidence-md5-check.sh --dir`）。
   🟢 顺带一条**否证**：怀疑过这两张暗色图是 `calendar-cells.spec.ts:384-394` 记的那种"假暗色"
   （`setAttribute` 只翻 CSS 变量、共享层色板不跟）。**人看图判成不是**：面板/卡片底色两档确实不同，
   因为设置面是 CSS 变量驱动的 web 侧组件，不是 RN 侧那批 `HeytaUiProvider` 解析的色板。
   登记这条是为了让下一个看图的人**不必再怀疑一遍**，而不是新增缺陷。
   🟢 常驻对账已扩到两种形状并带分母：`bash research/tools/r17-evidence-md5-check.sh --all`
   ⇒ `dirs_scanned=12 entries_parsed=9 dirs_with_mismatch=0`，rc=**0**。
   它的牙是 `--selftest` **四臂**（对照 0 枚 / 裸形状注入恰好 1 枚 / 表格形状解析到 1 条 / **表格形状注入恰好 1 枚**），rc=**0**。
   ⚠️ **12:1x 这条已经过期**：形状从两种变三种（新增 `UIPIN` 代码锚点）、牙从四臂变**八臂**、八臂全部改跑合成夹具，且 `--all` 现量 rc=**1**（五枚 UISTALE）。上面那组读数只描述 06:1x 那一刻；改写的原因与逐像素证据在 §5 bb) 格与 §6 第 34 条。
   ⚠️ 第三臂**第一次是红的**，而红因是**臂自己**：夹具写成 `| md5 |`（少了包 md5 的那对反引号）⇒ 解析 0 条 ⇒
   `rc=4`。真 README 能解析、夹具不能 —— 差别就是那对反引号。**这类"臂错被当成判据错"今天已经是第三次**
   （前两次：假臂名字里带数字不匹配正则、glob 匹配不到点开头文件），所以臂红之后**先读臂**再动判据。
   已把两枚路径补进 `calendar-line-commit-plan.sh` 的点名清单（现量待入库 **17 枚** = 9 ` M` + 8 `??`；
   上一格 15 枚是 05:2x 的读数，多的两枚就是这条新装置与那份被改写的 README）。

   🔴 **06:1x 那把三趟连跑的装置改完重挂，一趟就出了读数**（`BUDGET=1800`、pid 25162，
   日志 `/tmp/ht-h-flaky.20261004-060210.25162.log`，稳定名 `/tmp/ht-h-flaky.log` 挂上=1）。本轮改五处：
   ① 每趟输出**单独落一份再拼回主日志**（原来 `grep "$LOG"` 扫整份 ⇒ 第 2 趟会把第 1 趟的 summary 再报一遍）；
   ② 每趟现取两枚截图的 md5（`RUN_${i}_EVIDENCE_MD5=`）；③ **退出码语义换掉**：原来"跑完就 0"，
   现在 0 = 三趟全绿 / 1 = 复现过 flaky —— 一台专门抓 flaky 的装置跑完两趟红过却退 0，
   就是一条永远不会失败的判据（AGENTS §8.3）；④ `RUN_$i_RC` → `RUN_${i}_RC`（`set -u` 下前者解析成
   `i_RC`，是个**从没被执行过**的潜在崩点 —— 前两趟都死在负载门，它一直没机会暴露）；
   ⑤ 开跑那一刻现取 `r14c-carrier-chain.sh` 的 pid 让路（C 是这条线的硬缺口，H 只是收窄一枚已登记的 flaky）。
   ✅ **读数：三趟全绿**（每趟 `2 passed`，4.7 / 4.2 / 4.2s），`ALL_DONE runs=3 非零趟=0`，装置 rc=**0**
   ⇒ 23:19 那枚 `1 flaky` **在本窗口内未复现**。等窗口等了 8 次（严格层负载 10/11 > 9 三次、
   4318/4319 被占五次），06:10:38 才同时满足"负载 8 ≤ 9 + 两端口无人监听 + 对照端口有数（lsof 可信）"。
   ⚠️ 这只回答"这个窗口里没再出现"，**不回答"修好了"** —— 那条等待逻辑没有任何一层被改动，
   §3·补 ⑨ 那格继续挂着；新增的是"复现率"这一维现在有 3/3 的样本。
   🟢 **顺带量到一条**：三趟的字节**逐趟相同** ⇒ 这一屏是确定性渲染（与 `profile-panel` 那三张同类、
   与 `calendar-day` 那三张带 `STAMP` 的不同类）。用处是：以后同一屏出现不同字节可以直接判"界面变了"。
   🔴 **而"界面变了"当场就发生了一次，是被自己的对账工具照出来的**：06:11 `--all` 报
   `dirs_with_mismatch=1`、rc=**1**，唯一那份就是本目录 —— 顶掉指纹的是**我自己那趟运行**。
   旧字节（HEAD 里那两枚）与新字节的差**不是编码噪声**（96,095 → 72,077 字节）：把两枚并排看，
   年板从 **4 列**（1–8 月全在）变成 **2 列**（只到 1–4 月，右侧约 380px 是空的详情列），
   页头折成两行，月格里多出「休／班」标记。归属现量：`git diff -- apps/web/src/styles/app/main-area.css`
   16 行、注释原文「详情列与可拖宽侧栏会缩小主区」⇒ **别人未提交的三栏详情面**（本线不动它）。
   ⇒ 这两张图现在记的是**某个瞬间的工作树界面**，README 里写明"等 A 落笔后要重取一次"，
   并把 05:3x 那句"4 列月卡阵列"就地划线留原句。
   📌 **这是 §7 第 82 条那一族在截图取证上的面目**：门禁 §2 数"别人未提交的源码"是为了别让**产物**装了
   别人的 WIP，而同一件事在证据上是**图里画着别人的 WIP** —— 且只有把两枚图并排看才看得出来。
   ⚠️ 本条两处 rc 都经非管道复核：`| tail` 之后 `${PIPESTATUS[0]}` 在 zsh 是空串（§7 #184 又一次现场命中）。

   🔴 **07:0x 现量：证据指纹换了一整批（八个 png），这是那条对账门禁第一次靠"现场真的变了"报红，不是注入**。
   - 抓到面：`apps/web/evidence/calendar-day/` 3 枚、`calendar-view-options/` 1 枚、`profile-panel/` 4 枚。
   - 处置：三份 README 的 md5 全部重登（`d9916538…`/`40e71764…`/`57d2d008…`／`d4e80762…`／
     `18243706…`（两枚同值）/`c78de436…`/`cadfbb3a…`），并按 §6.2 规定一**逐张打开看过**；
     看图之后**撤掉两条位置型断言**（"1:00 与 2:00 之间有一条红色 now 线"、"轴只到 5:00"）——
     那两句对 06:46 那一批的新帧**不成立**，原句划线留在 README 本体里。
   - 顺手把一条**误读风险**写进 README：这一趟里 `view-tabs-year.png` 与上一趟**逐字节相同**，
     而同一趟别的帧变了 ⇒ 变的不是渲染环境而是 **UI 内容**（W4b 的休/班标记：10/1–10/3、10/5–10/7 绿休，10/10 橙班）；
     同理 `profile-panel` 里 `r15b-1 == r15b-4` 那对**同趟**逐字节相同仍然成立，
     但跨趟比 md5 只对"同一趟里的一对"有效 —— 后台层（别人提交的界面）一动，所有旧 md5 都是过期读数。
   - 复跑读数：`bash research/tools/r17-evidence-md5-check.sh` 回到 `rc=0`（`dirs_scanned=12 entries_parsed=9 dirs_with_mismatch=0`）；
     `node scripts/check-md-table-rows.mjs` `rc=0`（9 个文件行列一致）；
     `node research/tools/docs-link-check.mjs` `rc=0`（无死链）；
     `bash research/tools/calendar-line-commit-plan.sh` 当时 待入库 **37 枚**（改动 22 / 新增 15）、
     命名空间 **35 枚全部已点名**（工作树脏行分母 212）、`CP_RC=1` 的原因是**别人暂存里的路径**，不是本线漏点名。
     ⚠️ 这四个数都是**当时那一格 HEAD 的活树读数**（HEAD 在 07:1x 已动过三格），引用前逐条现量。
   - 🟢 **00:2x 复跑并补了覆盖面**：`bash research/tools/r17-evidence-md5-check.sh --all` 现量
     `rc=0`、`dirs_scanned=12 entries_parsed=12 dirs_with_mismatch=0` —— 上面那句 `entries_parsed=9`
     是 07:1x 那一格的读数，**已被这一格顶掉**（新增的 3 条来自下面两个目录）。
     本线另外两枚证据此前**没有**字节级对账，现在有了（都先核过"工作树 == `git show HEAD:` 逐字节相同"才钉）：
     `apps/web/evidence/due-editor-placement/`（2 枚）、`apps/web/evidence/calendar-view-family/`（1 枚）。
   - 🔴 **`calendar-day-time/` 这一目录是故意留在 EMPTY 的**（不是漏登记，别去"修好"它）：
     它的三张图按构造**不可能有常驻 md5** —— 图里既渲染了随机任务名
     （`e2e/tests/calendar-day.spec.ts:49` 的 `STAMP = Date.now().toString().slice(-6)`，第 306 行拼成
     `挂在十六点-${STAMP}`），又渲染了"今天"的日期（页头 + 侧栏迷你月历）。钉上去就是**下一趟必然 MISMATCH**
     的常驻判据 —— 那是 §8.3 那条元规则的对偶：一条永远红的判据会把人训练成忽略它。
     理由与"要让它可常驻需要先做什么"写在 `apps/web/evidence/calendar-day-time/README.md` 本体里。
     ⚠️ 这一目录的三枚 png 现在是 ` M`（06:46 被一趟未归因的 e2e 重写，见上面那条"撤掉两条位置型断言"），
     00:2x 我把三张都打开看过，与 README 那张表逐条对得上 —— 但**这条主张只对 06:46 那一批字节有效**。
   🟢 **11:46 复跑常驻对账 `bash research/tools/r17-evidence-md5-check.sh --all` ⇒ rc=0、
   `dirs_scanned=12 entries_parsed=12 dirs_with_mismatch=0`**：本线那两枚**字节仍与 README 逐条相同**
   （`view-select-closed.png` = `d4e80762…`、`view-tabs-year.png` = `ae8ad61d…`）——
   也就是说 11:41 那一整族 `apps/web/evidence/vault-panel/*.png` 被重写**没有碰到本线这两枚**。
   ⚠️ 这一条**只更新"字节没过期"那一半**："图 == `39032107` 的界面"那句主张（n 格）没有因此变新，
   重取仍欠、仍挂在窗口看守上 —— **"字节过期"与"主张过期"分开记**正是 §6 第 28 条要的形状。

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
   🟢 **02:1x 四条的现量刷新（这次确实往好的方向走）**：设备运行者探针 `mobile_e2e_runner_lines` 输出**空**
   （几个小时以来第一次）；负载 **31.06**（1 分钟）/ 78.87（5 分钟）/ 128.25（15 分钟）—— 在往下掉，阈值是 12；
   ⚠️ **02:2x 复跑：负载又回 239.27** —— 上面那句"在往下掉"只对那 90 秒成立。
   🔴 一般形状：**这台机器的负载轨迹不能当计划依据，只有瞬时值可以**，而 1 分钟均值连"接下来一分钟"都不保证。
   写这类读数时要么当次就用掉、要么写明"引用前必须重取"，别让它长成一句"马上要开窗了"。
   booted 仍是 **3 台**含目标名 `heyta-iphone-17pro`；windows 打包机 `WIN_OK`。
   🔴 **但 B 在主检出仍然欠一条，别读成"只剩负载"**：脏集合从 86 降到 **7**（4 枚 `M` + 3 枚 `??`，全归
   vault / 账号注销那条线），其中**含 `packages/i18n/src/locales/{en,zh-CN}.ts` 两份词条表 —— 它们是打包输入**，
   在主检出打产物会把别人未提交的词条一起打进去（§7 第 82 条那一族）。⇒ **B 的正解与 C 同一个：干净载体**，
   而载体要在开窗时先同步到主检出的当前提交（`r14c-window-retry.sh` 第二版做的就是这件事）。
   ⚠️ 另一条不是前置但要知道的共享面：B 的 mac 段写 `/Applications/Heyta.app`（现量 mtime `10-03 23:05:40`），
   另一条会话的 mac 壳判据读的就是那份安装副本。
   🔴 **02:2x 把 B 被点名的两条前置拆开报（一条实测过、一条明确没跑）**：
   ① `packages/op-log` 干净 —— **实测成立**：`git status --porcelain -- packages/op-log` 输出 **0 行**。
   ② `@heyta/op-log build exit 0` —— **这一段没跑，原因是环境**：tsup 的 `clean: true` 会**先删 `dist/`**，
   而现量此刻负载 **268**、`4318/4319` 上有 **70 个进程**（别人正在跑浏览器取证），
   那 1–2 秒的空窗会让别人读 dist 的判据拿到缺失产物 —— 那是本机记过的"并发把不相干的一方打成假红"那一族
   （`PROGRESS.md` 里三条门禁各红过一次、单跑全绿就是它）。
   只读的替身读数已经拿到：`node scripts/dist-freshness.mjs --only op-log,ui,i18n` ⇒ rc=**0**，
   三包产物分别比源码新 **107s / 1s / 199s**，**落后 0 个、缺 0 个** ⇒ "构建做过没有"这件事当前是成立的，
   但**它不等于 `build exit 0` 这条判据被跑过**，所以 B 开跑前那一腿仍要现取一次（在窗口里、由载体那条链顺带做：
   链的第 3 步就是 `pnpm -r build`，里面含 op-log）。复跑：`pnpm --filter @heyta/op-log build; echo rc=$?`
   🟢 **02:4x 复跑（B 的两条前置一条没变、替身读数变了）**：① `git status --porcelain -- packages/op-log` 仍 **0 行**
   （02:0x 那轮是 7 枚，这是它第一次成立并在复跑后仍成立）。② 仍**没跑**，但**理由换了**：
   `4318/4319` 此刻各 0 个监听者、负载 17（不再是我 02:2x 写的那两个数），挡住它的是
   **别人正在跑设备腿**（02:36 闸门数到 pid 34829，而凭据三件套与 `:3000` 服务正是那一趟留下的现场），
   tsup 的 `clean: true` 删的是**主检出的共享 `dist/`** ⇒ 这一刻跑会把别人 Metro 打包的输入抽掉 1–2 秒。
   ⚠️ **替身读数别再引用 02:2x 那份**：现量 `node scripts/dist-freshness.mjs --only op-log,ui,i18n` ⇒
   op-log **+107s ✅**，但 **ui 落后 1043s、i18n 落后 1387s**（别人 02:2x 改了 `packages/ui/src/index.ts`
   与 `packages/i18n/src/locales/en.ts` 之后没重打），rc 仍 **0**（没传 `--strict`）。
   🔴 这条对 B 的读法要说准：`reinstall-all.sh` 四段都是"从当前源码重打"，所以主检出的 dist 落后
   **不会**让 B 装成旧产物；它只说明一件事 —— **在主检出打任何东西之前都欠一次同步**（02:1x 那次撤回就是这件事）。
   🔴 **03:2x 复跑：B 的前置①又翻回红了** —— `git status --porcelain -- packages/op-log` 现量 **2 行**
   （` M packages/op-log/src/engine.ts` + `?? packages/op-log/tests/op-log-count-reads.spec.ts`）。
   这条判据在本会话里已经**红了→绿了→又红了**三轮（07:51 红 / 02:0x 红 / 02:3x·02:4x 绿 / 03:2x 红），
   所以它只能作为"此刻"的读数存在，**在谁手里 = 改 op-log 的那条会话**，复跑命令就是那一句
   `git status --porcelain -- packages/op-log`（0 行才算成立）。
   ⚠️ 前置②（`@heyta/op-log build` exit 0）**仍未跑**，理由与 02:4x 那条相同且当下更硬：
   C 的 rig 正持有设备窗口（03:2x 现量负载 **22.28**、pid 78674 已跑 1h00m、末趟仍 rc=3），
   而 tsup 的 `clean: true` 删的是主检出共享 `dist/` ⇒ 这一刻起 build 会抽掉别人 Metro 的输入。
   🔴 **B 与 C 是同一条设备面上的两个申请者**（AGENTS §8.9）：本轮的次序是"C 的窗口先、B 后"，
   不是"两条并行"。B 的开工判据仍是那三条同时成立 + `IOS_DEVICE_NAME="heyta-iphone-17pro" bash scripts/reinstall-all.sh; echo "EXIT=$?"`。
   🟢 **04:2x 现量（闸门 `--target b` 干跑）：拦 B 的又换了一格，而且这格原来是空的。**
   - §1 负载 ✅（`vm.loadavg` 10.88，阈值 12）/ §3 `reinstall-all.sh` 自身干净 ✅ / §4 booted 三台 ✅
     —— 上一批记的"负载 17–21"与"op-log 干净度"这次**都不是拦路的**。
   - §2 ❌：**66 枚**别人未提交的产品源码（`apps/web` 29 / `apps/mobile` 20 / `packages/legal` 9 /
     `packages/app-host` 8 / `packages/storage` 5 / `apps/node-host` 4 / `packages/ui` 3 /
     `packages/{sync-client,op-log,i18n}` 各 2 / `server` 2）。前几批记的是 22 → 26 → 28 枚 ——
     **枚数与主人每批都换**，所以这条只能现取，不能引用"上次那 28 枚"。
   - 🔴 **本轮给 `--target b` 补了一道它原来根本没有的门（§3b 设备面独占）**：
     b 分支以前只看"被执行的那个脚本自己干净不干净"，**完全没看设备面上有没有别人在跑** ——
     而 B 的三条动作（`simctl uninstall`、`adb uninstall`、覆盖 `/Applications/Heyta.app`）
     拆的全是别人正在量的现场。这属于"闸门按 target 分岔时漏了一半"：c 分支一直有 §3，b 分支没有。
   - 🟢 **这道门补上不到十分钟就抓到一次真实撞车**（04:2x 现量 argv）：
     `bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817` ——
     **另一条会话此刻正在隔离载体里跑 B**。⇒ 本会话**不起第二趟**（两趟并行 = 互相卸装，AGENTS §8.9），
     B 的归属从"等别人提交"改成"**等那一趟跑完并核对它装的是哪个载体、四端判据各是什么**"。
     这也解释了为什么 B 的前置在自己手里永远凑不齐：它已经有人在跑了，而我要的不是"再跑一遍"，
     是"这一轮四端确实装上了当前产物"这件事有读数。
   - 🔴 **抽共用函数时发现的第二处盲区（同一趟）**：设备独占探针 `lib/mobile-e2e-runner-probe.sh`
     的正则是 `verify-mobile-[a-z-]+\.sh` ⇒ 它对 `reinstall-all` **永久失明**。
     现量证据：c 分支的 §3 打印"✅ 粗筛没有别的移动端验收在抢 emulator-5554"，
     而同一秒那台设备上有一趟 reinstall 正在跑（它会 `adb uninstall` 同一枚包）。
     也就是说 **C 的链差一点就往一台正在被卸装的模拟器上装 APK**。
     ⇒ `reinstall_other_pids()` 抽成 b/c **共用**（两侧各自点名，不各抄一份 pgrep 正则），
     并由 `research/tools/r14c-gate-b-exclusive-arms.sh` 的 **T5 臂**钉住"c 分支也认得这一形"
     —— 抽成函数这件事本身没有判据，除非两侧各测一次。
   - 🟢 **新门与共用函数的有牙先验（同一枚装置，合计 rc=0，六臂）**：
     开跑先取**基线**（外部 `verify-mobile` 与 `reinstall-all` 的 pid 集合，各排除自己这一棵树）——
     🔴 这是被现量逼出来的形状：第一版臂假设"现场真空"，结果 04:2x 那一刻另一条会话真在跑 B，
     "T1 该绿""T4 该绿"同时红 —— **那是门在对真实撞车报警，不是门坏了**。
     T1 基线一致性（报出的集合恰好等于基线）✅ / T2 注入外部 `verify-mobile` ⇒ 第一道点名到它 ✅ /
     T3 注入普通形态 reinstall ⇒ 第二道点名 ✅ / **T3b 注入真实快照形态 `scripts/.reinstall-all.sh.snap.<pid>` ⇒ 也点名** ✅
     （🔴 第一版正则 `scripts/reinstall-all[.]sh` 对快照形态**失明**，而快照才是 `reinstall-all.sh`
     文件头 14-16 行的**现场运行形态** —— 假臂用的是不带点的形状，所以那一次"绿"是臂自己造的假象）/
     T5 c 分支同点 ✅ / T4 自己这一棵树带着那个串 ⇒ **不许把自己算成外部**（否则"等窗口就起 B"的看守
     会把自己锁死，造出一条永远不绿的门，§8.3）✅。
   - 复跑：`bash research/tools/r14c-gate-b-exclusive-arms.sh`（臂）＋
     `NO_COLOR=1 bash scripts/verify-mobile-window-gate.sh --target b`（现场）＋
     `pgrep -f 'scripts/[.]?reinstall-all[.]sh'`（那一形有没有人在跑，逐枚现取）。
   - ⚠️ 本轮又同族犯了一次 `$var（` （第五次，全部由 `check:shell-unicode-vars` 抓到，改后 rc=0，扫 98 个 .sh）；
     另记一次**自伤**：批量替换脚本里 `r"""…""""`（多打一个引号）会让 Python 把后面的源码吞进替换串，
     落盘后 shell 少一个闭引号 ⇒ `bash -n` 当场报 line 77 syntax error。
     **规则：改完 .sh 的第一件事是 `bash -n`，第二件才是跑它** —— 这次就是靠这两步拦住了一次坏装置。
   - 🟢 **05:2x 复跑（`NO_COLOR=1 bash scripts/verify-mobile-window-gate.sh --target b`，非管道）rc=3**，
     四格读数与 04:2x **逐格不同**（这就是这条线"前置是瞬时读数"的第六次实证）：
     §1 负载 **61 > 12**（04:2x 那趟是 10.88 ✅ ⇒ 上一批"负载落回阈值内"这句**已过期**）/
     §2 别人未提交源码 **71 枚**（04:2x 是 66 枚）/ §3 `reinstall-all.sh` 自身干净 ✅ /
     §3b 「✅ 没有别的移动端验收在跑」+「❌ 有另一趟 reinstall-all 在跑（pid：93817，已 **2h15m** 仍在跑）」/
     §4 booted 三台 ✅ 且**带空格的真名字逐字保留**
     （`heyta-iphone-17pro; heyta-ios-isolated; iPhone Duo heyta` —— 上一轮那条"不加引号会被分词成
     `iPhone; Duo; heyta`"的修法**在真机名字上兑现了**，这是它第一次有真载体，不是只过了臂）。
     ⚠️ 同一趟又现 §7 #184：`| tail -30` 之后 `${PIPESTATUS[0]}` 在 zsh 是**空串**，改非管道才拿到 rc=3。
     ⇒ **B 的归属不变**：不是"我再起一趟"，是等 93817 那趟跑完并核对它装的载体与四端判据读数。
   🔴 **06:0x 把"为什么挡着"取到了根**（原来只记到"pid 93817 在跑"）：
   `ps -p 93817` → `bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817`，etime **02:49:17**；
   逐层 `pgrep -P` 追下去是 `95477 bash apps/desktop-macos/scripts/package-app.sh` →
   `98934 …/Xcode-27.1.0-Beta.app/…/usr/bin/notarytool submit Heyta-1.0.0.dmg … --wait`（etime 02:48:42）
   ⇒ **整趟重装卡在 Apple 公证的 `--wait` 上将近 3 小时**（06:15 复看 etime 已到 **03:03:40**），
   外层还有一个 `sh /tmp/queue-reinstall-all.sh`（pid 81007 → 93771）在排队。
   📌 三条可复用的：① 判"别人占着"要占到**它卡在哪一步** —— "在跑"和"卡在外部服务"对下一步的安排
   完全不同；② 追法就是 `pgrep -P` 逐层 + `ps -o pid,ppid,stat,etime,command`，**不需要 `pstree`**
   （这台机器上没有，第一次尝试空跑了一趟）；③ 那趟是**别人的**、等的又是**外部服务** ⇒
   不 kill、不降级、不插队，本线继续登记等待。
   ✅ **本轮新加的那格设备独占门第一次在真撞车上工作**：`--target b` 打出「✅ 没有别的移动端验收在跑」
   +「❌ 有另一趟 reinstall-all 在跑（pid：93817）」—— 原来这一格对 `reinstall-all` 是**永久失明**的
   （探针正则只认 `verify-mobile-*`）。🔴 06:0x 现量（`NO_COLOR=1 bash scripts/verify-mobile-window-gate.sh --target b`，
   非管道）rc=**3**：负载 **31 > 12**（一分钟后同一脚本读到 **7** ⇒ "负载达标"只是那一秒的读数）/
   别人未提交源码 **74 枚**（05:2x 71、04:2x 66）/ `reinstall-all.sh` 自身干净 ✅ / booted 三台 ✅。
   🟢 **顺手修掉门禁自己的一处不对应**：结论那五行"下一步"原来**无条件全打印** —— 实测负载已 ✅ 却仍输出
   "等负载落回 7 → ≤12"，而当天真正同时挡住 B 和 C 的「另一趟 reinstall 在跑」在清单里**一个字都没有**。
   改成按旗标只列真红的（五个 `WHY_*` 挂在九处 red 分支上），并落成一把**抽原文**跑的臂：
   `bash research/tools/r14c-gate-hint-arms.sh` ⇒ 五臂全过 rc=**0**（四臂各"正向命中 1 + 反向缺席 0"，
   第五臂断"旗标全 0 时只剩收尾那一行"）。⚠️ 臂刻意不重抄那五行：重抄一份就变成"臂在测臂自己抄的那份"，
   真文件改了臂还绿 —— 那是本会话今天已经踩过三次的形状。
   🔴 **06:3x B 第一次有了自己的开工体检器**（在此之前 B 只有"等窗口"这句散文）：
   `bash research/tools/b-reinstall-readiness.sh` —— 默认 dry-run，前置当时是五格（有没有别的 reinstall 在场 /
   负载 / 目标树里别人未提交的**打包输入** / 载体的 `node_modules` 不许是软链 / iOS 目标名现取）。
   ⚠️ 现已是七格：第 6 格（安卓可达）与第 7 格（载体新鲜度）各见下面两段增量，
   而第 7 格的**形状**在 00:1x 那段又被改过一次 —— 别按"五格/七格"这个数推断它现在的判据。
   全绿才打印确切命令，`--confirm` 才执行。现量（06:3x 那趟）：**rc=3，三项不成立** ——
   93817 那趟还在跑（etime **03:23:12**，其子 `package-app.sh` 累计 CPU **0:00.04** ⇒ 不是快跑完，是挂住）、
   主检出 **76 枚**未提交的打包输入、三台 booted 而没传目标名。
   载体那一手不是新发明：台账与记忆里都记着"共享树有别人 WIP 时改用 detached worktree 从 HEAD 打包，
   四段实测跑绿"，这里只是把它做成**带前置的默认路线** ——
   软链来的 `node_modules` 直接 exit 1，因为把它"修绿"的开关（`CI=true` / `confirmModulesPurge=false`）
   等于授权 pnpm 去清别人正在用的那棵树。
   🟢 **"必须全绿才执行"这条承重判据是自测出来的**：`--selftest` 拿桩命令冒充 reinstall，
   在体检不成立时照样传 `--confirm` ⇒ rc=**3** 且**桩一次都没被起**。没有这一臂，那句承诺就只是文案。
   🔴 **写它的过程中撞出一条"永远不可能通过的判据"，形状值得单独留**：
   `grep -fxq -- "$IOS"` 里 `-f` 的语义是"模式文件"，getopt 把同一簇后面的 `xq` 整个吞成文件名 ⇒
   `grep: xq: No such file or directory`、退出码非零 ⇒ 匹配对**任何**设备名都报"不在已启动列表里"，
   而输出的口吻完全像在说现场有问题。把它照出来的是三条腿里那两条**正向**腿（两个真名应当匹配）——
   **只测负向不测正向，就会把探针的坏读成环境的坏**（AGENTS §8.3 与 §7 元规则"先怀疑探针"的第五次现场）。
   ⚠️ 同一次还撞出 BSD sed 的 BRE 里 `+` 是**字面加号**不是量词 ⇒ 三台 booted 解析成 **0 台**
   （比截断更坏：`0 台`读起来像现场事实）。现在解析数与原始 `(Booted)` 行数不等就 exit 4，
   并且模拟器名一律**整名**取（现场真有一台叫 `iPhone Duo heyta`）。

   🟢 **07:1x–07:3x 增量（B 侧）**：

   1. **补了第六条前置：Android 段的目标可达性**。`research/tools/b-reinstall-readiness.sh` 原来只体检
      负载 / 工作树 / iOS 设备名，**看不出安卓那一端根本没有可达设备** —— 而 `reinstall-all.sh` 的
      android 段会对 `emulator-5554` 做 `adb uninstall`（§7 第 169 条那一族：目标取不到就停，不许拿旧的继续）。
      现在那一腿三态：`adb -s <serial> get-state` 通 ⇒ ✅；不通 ⇒ 枚举 `EM_BIN -list-avds` 里名字含 `heyta`
      的 AVD 并**打出可复制的启动命令**；本机连 `adb` 都没有 ⇒ `exit 4`（装置坏，不是现场坏）。
      现量：干跑 `rc=3`（三条不成立），`--selftest` 臂 2 `rc=0`（桩 adb 两型：✅ 行恰好 1 次 / ❌ 行出现且码非 0）。
      复跑：`bash research/tools/b-reinstall-readiness.sh`（干跑）／`bash research/tools/b-reinstall-readiness.sh --selftest`。
   2. **93817 那一趟重装卡在苹果公证上，不是卡在打包上**。07:18 现量：`bash …/.reinstall-all.sh.snap.93817`
      etime **04:05:39**，其子 `notarytool submit … --wait` etime **04:04:42**，外层还有两枚
      `sh /tmp/queue-reinstall-all.sh`（81007 / 93771）。⇒ B 的窗不在"别人跑得快不快"，
      而在**这一趟会不会自己结束**；它同时在 §3 里挡住 C 的设备独占判据。
      复跑：`ps -eo pid,etime,command | grep -E '[r]einstall-all|[n]otarytool'`。
   3. **主检出的 HEAD 在这一段里走了三格**（`0a8a5fd7` → `2ac93e54` → `5edb21dc`，07:18 现量），
      载体 `heyta-wt-r14c` 落在 `2ac93e54` 且 `status --porcelain` **0 行**（干净）。
      ⚠️ 这条不是仪式：`calendar-line-commit-plan.sh` 的"待入库"枚数与命名空间分母都是从**当时那一格**量的
      （07:0x 现量 37 枚 = 改动 22 / 新增 15，命名空间 35 枚全部已点名，工作树脏行分母 212），
      HEAD 一动这些数就要重取 —— 引用前照 §0.5 的规矩现量：`bash research/tools/calendar-line-commit-plan.sh`。

   🟢 **00:1x–00:2x 增量（B 侧：补第七条前置，并把第一版的错形状改掉）**：

   1. **新增第 7 格：载体新鲜度**。`CARRIER=` 那条隔离载体路是"主检出有别人 WIP"时的正解，
      但它自带一个此前**没有任何一层在问**的问题：载体停在旧提交 ⇒ reinstall 从那里打包，
      而 §6.1.1 给四端配的那四条判据**一条都不答"装的是不是这一批"**（§7 第 178 条原话）。
      现量（00:2x，主检出 HEAD 已走到 `5459b988`）：载体 `heyta-wt-r14c` 停在 `2ac93e54`、落后 **24 个提交**，
      其中**打包输入面差 3 个文件**，逐枚点名：`scripts/lib/mobile-e2e.sh`、`scripts/lib/msix-install-facts.sh`、
      `scripts/mobile-e2e-up.sh` —— 前两枚是 C 那条设备验收的夹具、第三枚是它的起栈脚本，
      所以拿这棵载体跑 B 或 C 都在**验旧夹具**。修法打在输出里：
      `git -C <载体> checkout --detach <主检出 HEAD>`（载体脏则先 `bash research/tools/r14c-carrier-heal.sh`）。
   2. 🔴 **第一版的形状是错的，现量把它照了出来**：原来写成"sha 不等就判红"。同一趟实测：
      主检出前进了 20 个提交而全仓只差 **7 个文件** ⇒ 裸 sha 判据会把"只动 docs/台账"的漂移也判红 ——
      那是 §6 第 20 条说的**恒红的开窗前置**（HEAD 每几分钟动一次，这条会把隔离载体那一路长期关死），
      同时又把真正该拦的东西压成一句不指名的"旧提交"。⇒ 改成**按打包输入面差集判**：
      差集非空才红（并逐枚列出）；差集为空就如实判绿、写明"落后 N 个提交、差异只在非输入面"；
      **差集算不出来按红处理**（独立克隆的载体没有对方提交的对象 —— "取不到差异"不等于"没有差异"）。
      输入面 = `packages apps server scripts` + 根 `package.json` / `pnpm-workspace.yaml` / `pnpm-lock.yaml`，
      与第 3 格、`verify-mobile-window-gate.sh:116`、`r14c-carrier-chain.sh:119` 同一套面（不另起一份，抄件必漂）。
   3. **这台执行器能不能失败由九条读数回答**（`bash research/tools/b-arm3-mutation-arms.sh`，
      00:3x 现量 **rc=0**：对照 + 八条变异臂）。新鲜度那条有**四条腿**（同提交／只差非输入面／差输入面／差异取不到），
      三个分支各被问一次"恒成立"和"恒不成立"：
      A 恒新鲜 ⇒ 腿1红1+腿2红2+腿4红1；B 恒不等 ⇒ 只有腿3红1；C 差集恒判红（过严）⇒ 腿1红2；
      F 差集恒不判红（过松）⇒ 腿2红2；D 恒走 fail-closed ⇒ 腿1红2+腿2红1；E 摘掉 fail-closed ⇒ 腿4红1。
      🔴 另外两条门各问一次，而且**只有这一趟问得出来**：G「窗口恒算没开」（永久拒启）⇒ 只有**臂 1b** 红 1；
      H「体检失效」（红着也照样执行）⇒ **臂 1 红 1 + 臂 2 红 1**（两道门共用同一个 `FAILS` 判据，一起烂）。
      变异只在一次性副本上做，末了断原件 md5 逐字节未动（现量 `0acbb7e85b6b43f9c4162dc56e2dd6c4`，
      与臂外独立一次 `md5 -q` 相同）。⚠️ 这一臂**总共跑了四趟**，前两趟断的 `e300dcd7…`／`049f705e…`
      都不是当前字节 —— 中间我给它补了"已知边界"六行、改了 `--help` 的窗口、又重排了 `--selftest` 的汇总出口。
      引用 md5 必须带"哪一趟"，否则就是在拿旧指纹担保新文件。
      ⚠️ 这一臂自己也修过三处，都是"读数长得对、含义不对"那一族：
      ① 变异点原来写 `"$MAIN_SHA_ZZZ"`（未定义变量）⇒ 撞 `set -u` 把内层跑炸、两条腿一起红，
      测到的是**装置炸**不是判据红 —— 现在臂里断 `unbound variable` 命中必须为 0；
      ② 上一版末了无条件 `rm -f` 日志 ⇒ 读数对不上时证据已被删，只能整臂重跑；
      现在有坏读数就**保留副本与日志**并把路径打在输出里；
      ③ 期望值是按"我以为哪条腿会红"写的，不是按被改谓词的**真值表**写的 ——
      `[ "$NDIFF" != "999999" ]` 看着像"恒不判红"，实际是**恒判红**（真实值只有 0 与 >0 两档）。
      这一条是 H 那一臂把我照出来的：它期望"臂 1 红"，实际红的是"臂 2"，而两者都对，我写错了预期。
   4. `--selftest` 现量：**rc=0**，四臂逐条绿（臂 1 该拒必拒 / 臂 1b 全绿必起 / 臂 2 安卓正负两腿 /
      臂 3 新鲜度四腿共 7 条断言），收尾打一行「四臂逐条成立」。夹具收尾无残留：worktree 数 **14 → 14**。
      复跑：`bash research/tools/b-reinstall-readiness.sh --selftest`。
      ⚠️ 修掉臂 3 自己的两处生命周期错（"这条臂永远走不到却看起来在跑"）：它原来放在 dry-run 分支里，
      而 `--selftest` 分支必先 `exit` ⇒ **永远不执行**；且它复用臂 2 已在自己收尾里 `rm` 掉的 adb 桩 ⇒
      拿到的是不存在的路径，第 6 格判"探针坏 exit 4"，读数长得像"新鲜度这条挂了"。现在臂 3 自带桩、自带夹具。
      🔴 又查出**同一族的第三处**，这一处更贵：`--selftest` 的汇总出口原来写在臂 1 的判定**之前**，
      于是任何一条先红的臂都会把臂 1 自己的发现**整条吞掉**（rig 的 H 那一型现场：臂 1 本该报
      "红着也照样执行"，输出里却只有臂 2 的一行 —— 看的人会以为拒启判据仍然是好的）。
      现在四条臂各自先记账（`ARM1_BAD`/`ARM1B_BAD`/`ARM2_BAD`/`ARM3_BAD`），汇总出口排在最后并**四个数一起打**。
      🟢 新增**臂 1b（全绿⇒真执行）**：原来只有臂 1（该拒必须拒），而"这台执行器永远拒启"那种坏法
      臂 1 **完全无感**（它看到的就是"没起"）—— 而"拒启"长得完全安全，所以缺陷可以永久存在。
      为了让"全绿"这一现场可造，三个环境探针（别的 reinstall 在场 / 负载 / 已启动模拟器）改成可注入，
      **默认值逐字等于原命令**（`RI_PRODUCER` / `LOAD_SRC` / `SIM_LIST`），注入点只换数据来源、不换判定路径；
      干跑复验：注入前后同一趟现场读数一致（93817 仍被探到、负载/未提交枚数/四台 booted 全同形状）。
   5. ⚠️ 两趟干跑的**现场读数**（00:2x，全是瞬时值，引用前重跑同一条命令）：
      主检出 `rc=3`／4 条红（93817 那趟 etime **05:10:10**、其子 `package-app.sh` 累计 CPU **0:00.04**、
      负载 **26 > 12**、未提交打包输入 **130 枚**、4 台 booted 而没传目标名）；
      载体那趟 `rc=3`／3 条红（格 1、格 2 同现场 + 第 7 格差 3 枚，其余四格全 ✅）。
      ⇒ **B 的窗仍然不在这条线手里**：挡它的是 93817 那一趟（持有者：并行重装会话）与主检出 130 枚未提交（各自的作者）。

6. 🟢 **08:4x–09:0x 增量**（这一段全部是本轮现量；上面 00:2x 那几个数已被逐条顶掉，别混引）：

   a) **两条腿当场翻转**，正好证明前置只能现量：负载从 00:2x 的 **26** 掉到 **11 ≤ 12**（08:40）；
      闸门那条"有移动端验收在跑（pid 2899）"到 08:41 那枚进程已自己退出。
      ⚠️ 08:56 重跑又回到 `REDS=load,src,dev`（b 路）/ `REDS=load,src,dev,apk`（c 路）—— 同一条门在 16 分钟内红绿各两轮。
   b) 🔴 **93817 的持有者查清了，而且它不是"在跑"，是楔住**。发起者是**自托管分发线的 item #8**
      （`/tmp/queue-reinstall-all.sh`，03:08 建：等三条链 → 从 `feat/self-host-merge-main` 开 `/tmp/heyta-reinstall` 这个 worktree → 跑 `reinstall-all.sh`）。
      叶子 pid **98934** = `notarytool submit Heyta-1.0.0.dmg`，08:4x 现量 **etime 20786s 而累计 CPU 0s**；
      它自己的两个日志 mtime **停在 03:12**（`/tmp/reinstall-all.log` 1337 B、`-out.txt` 221 B，此后一字未增）。
      ⇒ 台账原来那句"等那趟重装跑完"对 B/C **不成立** —— 等的是一个不会开的窗。
      登记改成这一档：**要持有者拍板**（本线不杀、不接管，那是别人的进程与别人的公证提交）。
      🔴 由此推出一条做序决定：现有看守（`r14c-window-retry.sh`，pid 80863，预算到 ~09:37）
      **用尽后不再重挂** —— 重挂的前提是"它可能自己结束"，而 b) 这条读数否证了这个前提；
      下一次挂它之前先跑 `bash research/tools/b-reinstall-readiness.sh`，仍报楔住就到此为止（等它是零产出）。
      复跑：`ps -p 93817 -o pid=,etime=; pgrep -P 93817 | xargs -I{} ps -p {} -o pid=,etime=,time=,command=`
   b′) 🔴 **09:49 把那条楔住的重装的归属链一次量到底**（原来只记到 93817 那一层）：
      `/tmp/queue-reinstall-all.sh`（pid **81007**，ppid **1** ⇒ 已从任何会话脱管）→ 93771（同一个脚本）
      → 93772（`pnpm reinstall:all`）→ **93817**（`/tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817`）
      → 95477（`apps/desktop-macos/scripts/package-app.sh`）→ **98934**（`notarytool submit`，etime 06:36:30 / 累计 CPU **0:00.03**）。
      两件事因此改变了读法，不是补充细节：
      ① **它跑的正是 B 这一条命令**（`pnpm reinstall:all`，在隔离检出 `/tmp/heyta-reinstall` 里，
        自托管线 item #8）⇒ B 的阻塞不是"没人做这件事"，而是"**同一件事正被另一个会话卡在 macOS 公证那一步**"。
        所以 B 的闭合有**第二条路**：那趟若醒并跑完，本线要的不是"再跑一遍"，而是
        一条 `装上的产物 == 本批源码` 的对账（§7 第 178 条那一族）—— 它装的是**它那一批**。
      ② 队列脚本自己写着"等前三条链结束，最多 100 分钟，等满就 exit 3 不并发"，
        而它**已经越过那一步进到设备段** ⇒ 醒来后会直接 uninstall/reinstall。
        ⇒ 本线**不能**并行开跑 B（AGENTS §8.9 的原文就是这一种），也只能由持有者处置。
      复跑（整条链一步看全）：`pgrep -f 'queue-reinstall-all[.]sh|reinstall-all[.]sh[.]snap|notarytool submit' `
      `| xargs -I{} ps -p {} -o pid=,ppid=,etime=,time=,command=; head -8 /tmp/queue-reinstall-all.sh`
   b″) 🟢 **10:0x：b′) ① 那条"第二条路"现在有装置、有第一批读数了** ——
      新增 `research/tools/b-batch-reconcile.sh`（170 行 / md5 `9e8e2967d792b3bed9e5d67dff851b45`；
      现量 `bash research/tools/b-batch-reconcile.sh --selftest` **rc=0、四臂**：
      unknown→3 / 有 DIFFER→1 / 全 same→0 / 混在一起仍→1）。它只判**第一段**
      「已装的字节 == 本机这一批产物」；"本机产物 == 本批源码"那一段**不在这儿重写**，逐端指向仓里已有的那三把
      （`scripts/dist-freshness.mjs` / `research/tools/r14c-bundle-testid-preflight.sh` /
      `scripts/reinstall-all.sh` 的 `sync_windows_sources()`）—— 刻意不复制对账实现（§7 第 174 条那族：
      两份会漂）。全程只读（不装、不卸、不杀、不写被测端），取不到一律 `unknown`、**不猜成"不一样"**
      （猜反的方向就是假红）。⚠️ 它**不进** `check:script-snapshot` 的自快照清单 —— 该门禁自己打印的口径是
      **38 个脚本 + `.gitignore`**（现量 `node scripts/check-script-snapshot.mjs` ⇒ rc=0），38 条全在 `scripts/` 下、
      本工具在 `research/tools/` 且秒级返回，不受 traps #110/#113 那个"跑到一半被编辑 ⇒ 假语法错误"的坑。
      🔴 **这里先记我一处刚犯的**：我第一版用 `node -e` 正则数 `MANIFEST` 得到的是 **39**，多出来的那一条是
      数组里的**注释文本**（`'新增长跑 .sh 要加进来'`）被我的引号正则当成条目 —— 门禁自己的打印才是权威口径。
      这句写出来是为了让下一位**重量范围**而不是照抄豁免，也是为了把"数出来的条目要先喂已知形状"这条纪律
      记在我自己的账上（§7 那族"自写计数判据要先喂必然命中的样本"）。
      🔴 **现量**（`IOS_DEVICE_NAME="heyta-iphone-17pro" bash research/tools/b-batch-reconcile.sh` ⇒ **RECON_RC=1**）：
      mac `DIFFER`（装 `387b2d6a…` / 本机 `ff02f97b…`）、ios `DIFFER`（装 `8d879b97…` / 本机 `72453ede…`，
      `bid=com.heyta` 由 `simctl listapps` 现认）、android `DIFFER`（设备 `0ecdc445…` / 本机 APK `c5427f90…`）、
      windows `unknown` —— **按设计不在本机判**：本机唯一读得到的是远端带回来的
      `apps/desktop-windows/evidence/reinstall-20261002-1958-windows-install-capture.txt`，
      里面那四格 `ADD_APPX=OK M2D=OK PAYLOAD_WEBDIST=True RESULT=OK` 是**壳级**判据
      （装上了 + 带 web-dist + 起了窗），**回答不了"是不是这一批"**（§7 第 178 条原文那一族）。
      ⇒ 这批读数的正确读法**不是**"B 失败了"，而是"**B 那一格现在装的不是本机这一批**"：
      所以即使楔住的那趟醒来跑完，它装的也是**它那一批** ⇒
      **没有任何一条路能让 B 在别人那趟里闭合**，本线要么自己跑一次，要么让这把量到 `same`。
      两处探针**先修再读**（都属"取不到"与"不一样"长得逐字相同那一族）：`get_app_container` 的类型实参要
      `app` 不是 `bundle`（`scripts/reinstall-all.sh:444` 用的就是 `app`），`simctl listapps` 的行形状是
      `"com.heyta" =     {`（`=` 后多个空格）⇒ 按单空格写的正则恒 0 命中，第一版把整段 ios 报成 unknown。
      复跑：`IOS_DEVICE_NAME="heyta-iphone-17pro" bash research/tools/b-batch-reconcile.sh; echo RECON_RC=$?`
   c) 🟢 **把 b) 从"靠人来查"变成装置自己会说**：新增 `scripts/lib/wedged-runner.sh`
      —— 四档 `wedged / busy / fresh / unknown`，阈值 `WEDGE_AGE_S=3600`、`WEDGE_CPU_S=2`，
      🔴 **只打印、不参与红绿，也不进 `REDS=` 机器通道**：楔住≠可以放行（它随时可能醒过来 `adb uninstall`），
      楔住也不等于"可以杀它"。它改变的只是**登记方式**。两个消费者共用同一份：闸门 b)/c) 两路 + 体检器格 1。
      判据能红：`bash research/tools/b-wedge-mutation-arms.sh` 现量 **rc=0、八条读数**（对照 + A–E 五条变异臂
      + F1/F2 那对守卫臂），末了断原件 md5 逐字节未动（`66c990af…`）。
   d) ⚠️ **本轮三处都是我先写坏、再被自己的臂照出来**（同一族："读数长得对、含义不对"）：
      ① `local root="$1" frontier="$root"` —— **bash 3.2 里同一条 `local` 后面的赋值看不到前面的**
        （`set -x` 现量印 `local root=31694 frontier=`），于是"取不到叶子"，
        症状与"现场根本没有子进程"逐字相同。正解是拆成两条 `local`。
      ② 🔴 lib 文件底直接写 `case "${1:-}"` —— **被 source 时 `$1` 是宿主的参数**，
        于是 `b-reinstall-readiness.sh --selftest` 被 lib 截走：打完 lib 自己的 26 条就 `exit 0`，
        **宿主那四臂一条没跑而整条报绿**。这一处比 ① 贵得多：它把"没跑"伪装成"跑过了"（§8.3 那一族的最贵形态）。
        修法 = `if [ "${BASH_SOURCE[0]:-}" = "$0" ]`，并由 F2（摘掉守卫 ⇒ 宿主必须走不到）证明这臂有牙。
      ③ lib 的解析路径第一版按 `$MAIN` 拼 —— 自测臂把 `MAIN` 指到一次性夹具仓库，那里没有 `scripts/lib/`
        ⇒ 变异 rig **连对照都 rc=4**（看起来像"新鲜度那条挂了"，其实挂的是探针）。
        现在是"旋钮 `WEDGE_LIB` → 自身位置 → `${MAIN}` → 三处全落空才响亮地 exit 4"，并把自己解析到的路径 export 给子进程。
   e) 三条**瞬时**读数（08:4x–09:0x；引用前重跑同一条命令）：
      主检出 `packages apps server` 未提交 **135 → 136 → 141 枚**（86 枚在 `apps/web`）；
      别人暂存 **9 枚**（iOS keychain / AGC 那批，含 `apps/desktop-macos/scripts/package-app.sh`）⇒ **A 仍不能点名**，
      而且这 9 枚里就有 b) 那一趟正在跑的打包脚本 —— 它的主人此刻既在暂存它又在被它卡住；
      4318/4319 的占用者 = **detail-pane 那条线的实跑**（`vite --config vite.tmp-e2e-allow.config.ts --port 4318` pid 99252
      + `stub-provider.mjs` pid 67695）⇒ **H 的三条 flaky 修法今夜不能落手**（那一跑要 `reuseExistingServer:false`，
      起我的趟就是 SIGKILL 别人的 vite，AGENTS §8.9 + 本机"串行"纪律都不许）。
   f) 一次**看着像抄件漂移、其实不是**：闸门报"packages/apps/server 没有未提交修改"而体检器报"135 枚"，
      两边表达式逐字相同（`git status --porcelain -- packages apps server | grep -E '^ ?M'`），
      差别是**量的树不同**（闸门带 `--target c --repo <载体>`，体检器默认主检出）
      ⇒ 这不是第 2 份抄件，**别去"合并"它**；真要合的是"同一棵树上的两条门"，而它俩量的本来就不是同一棵。
   g) 本轮复跑的其余读数：体检器 `--selftest` **rc=0**（四臂逐条成立）、
      `b-arm3-mutation-arms.sh` **rc=0**（九条）、`b-wedge-mutation-arms.sh` **rc=0**（八条）、
      `r17-evidence-md5-check.sh --all` **rc=0**（`dirs_scanned=12 entries_parsed=12 dirs_with_mismatch=0`）、
      `check:md-tables` **rc=0**（9 个文件）、`docs-link-check` **rc=0**（无死链）、
      `check:script-snapshot` **rc=0**（38 个脚本 + `.gitignore`；lib 不在它的清单口径里）；
      `check:shell-unicode` 整条仍 rc=1，但**本线四枚文件命中 0**，余下全在 `tmp/`（别人那条线的收尾脚本，不吸收）。
   h) 🔴 **一条连带发现：c) 那道新依赖差点在开火那一刻缺席**。C 链第 0 步会把主检出工作树里的
      判据文件**点名覆盖**进载体（07:2x 为"载体那份闸门看不见正在跑的重装"而加），而闸门现在
      `source` 了这枚新 lib —— 不并列就是：载体里没有它 ⇒ 闸门只 `set -u` 不 `set -e` ⇒
      **不崩，只在"动设备那一刻"悄悄少一条读数**。已把 `scripts/lib/wedged-runner.sh` 加进 `JUDG_PATHS`，
      并在 `r14c-chain-overlay-arms.sh` 里加了**两条**它原来没有的判据：
      ① 期望枚数改为**从链源码的清单推导**（原来两处把"4"写死，而清单早已涨到 **6** ⇒
        臂自己变红、症状与"链坏了"逐字相同 —— 就是"别把上游当前状态写进断言"那一族，本轮又现形一次）；
      ② 依赖对偶不变式（闸门被列 ⇒ 它在载体里拿不到当前那份的每枚 lib 也必须被列）。
      两条都做过有牙验证：临时副本里摘掉那枚 lib ⇒ 不变式**恰好抓到 1 枚**；
      现量 `bash research/tools/r14c-chain-overlay-arms.sh` **rc=0**（推导枚数 6、"载体拿不到的依赖共 2 枚"逐枚在列）。
      ⚠️ 这条不变式第一版有两处自曝：扫全文把注释里"刻意不 source `lib/mobile-e2e.sh`"那句话当成依赖（假红），
      以及循环里 ❌ 之后还无条件打 ✅（读数自己 contradict 自己）—— 两版都修了，判定式以条目原文为准。
   i) 🟡 **09:3x：H 那枚 flaky 的归因换了对象——从"本篇收窄出来的一条候选"改成"另一条线已经 trace 实证过的同族机制"**，
      于是上一版写下的**那条收窄与那个修法都被就地撤回**（全过程与读数在过程账 §3·补 ⑨·附二）。三句话版本：
      ① 03:4x 那句"候选只剩一条（vite 首趟重新预打包）"错在**只在单篇文档内做收窄** ——
        `admin-console.md` §7.4 早就用 trace 数出过约 90 条 `[vite] hot updated` + `Could not Fast Refresh … invalidate`
        ⇒ 整页 reload ⇒ SPA 状态清空，本线这枚的四个特征（一次性、低负载趟、断言"某元素可见而它整块不在"、
        重试秒级过）与它逐条对得上；② 由此**warm-up 那个修法不针对当前最可能的机制**（reload 发生在页面已加载之后，
        由别人往树里写触发）⇒ 撤回；③ 09:2x 现量到失败趟前约 30–60 秒，共享树里 `apps/web/src/features/trash/TrashView.tsx`
        与 `apps/mobile/src/screens/TrashScreen.tsx` 的 mtime 都是 **23:18:42**（复跑：扫 mtime 落在
        23:16:00–23:21:30 的源码文件，脚本原样抄在 §3·补 ⑨·附二 一.5）。
      🔴 **本轮顺手差点写出一条装饰判据**：`RUN_i_SIG optdeps=0` 本来要"排除冷启动那一支"，
      而 `e2e/playwright.config.ts:74-93` 的 vite 那条 `webServer` **没有 `stdout:'pipe'`**（假端点那条有）
      ⇒ "数到 0"与"这一路压根没转发"在输出上逐字相同。已加 `devLines=` / `viteChannel=yes|no`（按**只有 vite 才会打的横幅**判，不按共用的 `[WebServer] ` 前缀判 ——
      前缀那条判法我自己先写错了一次：两条 `webServer` 共用前缀，拿它判通道是一条**会假阳**的判据）。
      三档形状由 selftest 钉住：臂1 无横幅 ⇒ `no`、臂2 有 vite 横幅 ⇒ `yes`、🔴 臂5 只有前缀行 ⇒ 仍须 `no`。
      ⚠️ 因此那条"下一次用 `DEBUG=pw:webserver` 跑就行了"的旧指引也作废：取证现在**由装置自动留并自动扫**。
      09:4x 又补了两层（都是"载体本身不够"照出来的，不是加功能）：
      ① 每趟 `--trace=on` —— 配置里是 `retain-on-failure` ⇒ **绿趟本来根本不留 trace**，
        于是"这一趟有没有洪泛"只有红趟能答，而红不由我定 ⇒ 那条"连续 N 窗全绿且无洪泛"的闭合判据
        **结构上取不到读数**（写一条永远满足不了的判据，与写一条永远通过的判据是 §8.3 的对偶两端）。
      ② 每趟扫自己的 trace，打 `RUN_i_TRACE scan=ok traces=N connect=C hotUpdated=H fastRefreshInvalidate=I viteInTrace=yes|no`
        —— `connect` 是**这条扫描自己的阳性对照**：它数不到 ⇒ `hotUpdated=0` 只能读成"扫描没看见"。
      🔴 载体这件事有一次**现场证明**（09:3x 只读盘、没跑东西）：另一条线 06:51 那趟的
      `trace.zip` 里数得出 `[vite] connecting...` ×3 与 `[vite] connected.` ×3，
      而本线三轮绿趟的 stdout 里 `[vite]` **一行都没有** ⇒ 承重面放 trace，不放 stdout。
      复跑：`bash research/tools/h-flaky-window-watcher.sh --selftest` **09:4x rc=0**（六臂；md5 `c116d2ae…`）。
      ⚠️ 本轮在这把自测里又踩了一次**点位打 vs 逐点打**：给臂3 写期望时按臂号写成 `RUN_3_TRACE`，
      而那条前缀是**跑次序号**（该臂 `RUNS=1`）⇒ 扫描跑得好、期望恒假红。已把这条写在臂旁边。
      ⚠️ 顺带修掉本轮第二枚自伤：`--selftest` 会把稳定名 `/tmp/ht-h-flaky.log` 重指向一份**不存在**的文件
      （实测 `No such file or directory`）⇒ 加 selftest 守卫并把稳定名指回真读数（060210 那份，三跑全绿）。
      🔴 **状态不是"已定性"，而且原来那两条"择一"混了两件事** —— 可复现性与机制不是同一个问题，
      关于"还复不复现"的证据永远证不出"机制是什么"。现在分开设（原文在 §3·补 ⑨·附二 第六节）：
      (a) 机制 = 任一非零趟 `viteInTrace=yes` 且 `hotUpdated>0`（或 `fastRefreshInvalidate>0`）⇒ 那一支坐实，
      `viteInTrace=yes` 而 `hotUpdated=0` ⇒ 那一趟不是洪泛；(b) 可复现性 = 真跑三趟全绿**且每趟 `viteInTrace=yes`**
      （后半句是新加的：没有它，"三趟全绿"可能只是"三趟都没取证"）。
      09:3x–09:4x 现量的窗口状态：4318/4319 **空着**、对照端口 4358 有人监听（探针可信）、
      负载门刚落到 9 的**同一分钟** `loadavg` 1 分钟均值冲到 **121.3** ⇒ 这一晚挡 H 的是负载与那条楔住的重装
      （叶子 pid=98934 累计 CPU 仍是 **0s**、已活 22768s，卡在 `notarytool submit`），不是端口、也不是产品。
      🟢 **09:43 已把新装置挂上去等窗口**（pid 34372，`BUDGET=1800 RUNS=3 STRICT_MAX=9`，
      日志 `/tmp/ht-h-flaky.20261004-094257.34372.log`，稳定名已指向它）。这一趟的意义不是"再试一次"，
      而是**第一次每一趟都会自动产出 trace 洪泛计数**（旧装置只有 stdout，而 stdout 那一路够不够得着 vite 从未被证明）。
      ⚠️ 别把包装命令的 `exit 0` 读成"跑完了"（§7 第 164 条）：那是不等式里 `&` 后面那条 shell 的码；
      跑没跑完只认日志里的 `ALL_DONE`/`FLAKY=` 与 `RUN_i_TRACE`。
   j) 🟡 **10:0x 四条现量（全是瞬时读数，引用前重跑同一条命令）**：
      ① 窗口闸门两路各跑一趟：`bash scripts/verify-mobile-window-gate.sh --target b` ⇒ **rc=3、`REDS=load,src,dev`**；
        `… --target c` ⇒ **rc=3、`REDS=load,src,dev,apk`** ⇒ B 与 C 仍抢同一张设备面，两把都**响亮地不肯开跑**
        （这是它们该有的行为，不是装置坏了）。同一趟里 `wedged-runner` 那格自己打出来了：
        `🔴 这一趟很可能已经楔住：叶子 pid=98934 已活 24602s 而累计 CPU=0s` —— c) 那一格从"靠人来查"
        变成"闸门自己会说"，本轮第一次在**真实现场**产出读数（此前只有变异臂）。
      ② 负载 `vm.loadavg` = **42.2 / 34.8 / 33.4**（阈值 12）。
      ③ H 的看守（pid 34372）到 10:0x 累计 **35 次判定 / 990s**，**每次都是"负载 > 12 等 30s"，一趟 e2e 都没开跑**
        （峰值读到 123）⇒ 到此刻为止它**零新证据**，i) 那两条判据（(a) 机制 / (b) 可复现性）
        **一支都还没被喂到**。预算 1800s，等满按契约以 `rc=3` 收尾 = 环境无效 ≠ 产品失败。
        复跑读法：`tail -3 /tmp/ht-h-flaky.log` 加 `grep -c '负载' /tmp/ht-h-flaky.log`
        （🔴 别看包装命令的退出码，理由见上一条 ⚠️）。
      ④ 证据面**逐字复现**：`bash research/tools/r17-evidence-md5-check.sh --all` ⇒ **rc=0、
        `dirs_scanned=12 entries_parsed=12 dirs_with_mismatch=0`**，其中
        `DIRCHECK apps/web/evidence/calendar-view-options entries=2 mismatch=0` —— 与 09:0x 那一格完全相同
        ⇒ H 那两张图此刻仍是盘上那份，**可以引用**。门禁三面同趟复跑：`check:md-tables` **rc=0**（9 个文件）、
        `docs-link-check` **rc=0**、`check:claims` **rc=0**、`check:script-snapshot` **rc=0**（38 个脚本 + `.gitignore`）。
   k) 🔴 **10:1x 复跑：B/C 的红少了一格、窗口仍没开，而"本机这一批"自己也在动**（这一格是本轮最值钱的读数）：
      ① 树被并行会话整片提交之后 `bash scripts/verify-mobile-window-gate.sh --target b` ⇒ **rc=3、`REDS=load,dev`**
        （10:0x 那趟是 `load,src,dev`），`… --target c` ⇒ **rc=3、`REDS=load,dev,apk`**（原来 `load,src,dev,apk`）
        ⇒ **`src` 那一格是别人替本线清掉的**，不是本线做的；剩下的两格各有各的持有者：
        `dev` = 设备面被占（闸门印的下一步是 `pgrep -f 'scripts/[.]?reinstall-all[.]sh'`），
        `load` 见 ②，`apk` 只挡 c)。
      ② H 的看守**等满了**：`GATE=timeout rc=3`，末行『❌ 等满 1800s 负载仍是 68 —— 本轮不跑（环境无效，不是产品失败）』，
        全程 **60 次判定、零趟 e2e**，负载峰值读到 **215**（10:1x 那几分钟正在 184–215 之间）。
        ⇒ i) 里那两条判据（(a) 机制 / (b) 可复现性）**到此刻一支都没被喂到**，H 的 flaky 仍是"未定性"，
        而"再挂一趟"在负载 200 的机器上是零产出 —— 这一段现在就停在**登记**，不重挂。
      ③ 🔴 `IOS_DEVICE_NAME="heyta-iphone-17pro" bash research/tools/b-batch-reconcile.sh` 复跑 ⇒ 仍 `RECON_RC=1`，
        但 **mac 那一段的本机哈希换了**：`ff02f97b…`（10:0x）→ `94ed463a…`（10:1x），
        而**装上的那枚 `387b2d6a…` 一字未动**；ios/android 两侧两个哈希都逐字未变。
        ⇒ 这把量的是"已装 vs 本机产物"，而**本机那一侧也会被别人的构建挪走** ——
        所以 §3·补 ㉑ 那句"要么本线自己产一次产物、要么让这把量到 `same`"**仍然成立，但不能抄上一趟的哈希**，
        跑之前先做交接 §5 第 1 步那条通用前置 —— **这一格是它第一次落在 B 这条路上**，而且我先把命令写错了才发现：
        🔴 `node scripts/dist-freshness.mjs --only web` **不是合法参数**（那把体检只覆盖 `packages/*/dist`，
        `apps/web` 不在其中），现量 **rc=1** 并列出 14 个合法目录名 —— 它**响亮地拒绝了**，这正是 03:2x 那次
        给 `--only` 补上"名字没匹配到就 exit 1"之后该有的样子。正确形状（现量 **rc=0**）：
        `node scripts/dist-freshness.mjs --only ui,i18n,design-system` ⇒ `3 个包…落后 0 / 缺 0`
        （mac 那一段比的是 `apps/web/dist/index.html`，它的**上游**是这三包；`apps/web/dist` 自身的新鲜度
        不在那把工具的口径里，这一段仍由 `pnpm -r build` + §6.1.1 负责 —— **别把两件事写成一件**）。
        复跑对照（**不依赖 /tmp 里那两份旧输出** —— 它们是一次性现场，重启即没）：
        `IOS_DEVICE_NAME="heyta-iphone-17pro" bash research/tools/b-batch-reconcile.sh | grep '^MAC|'`
        拿打出来的本机侧哈希与本条记的两枚（`ff02f97b…` / `94ed463a…`）对照 —— 两枚都不同就是第三个读数。
   l) 🟡 **10:2x：B 的两条**具名**前置第一次各有了自己的读数（一条转绿、一条量出来是红的，都不算闭合）**：
      ① `git status --porcelain -- packages/op-log` ⇒ **0 行**（本轮之前它红→绿→红来回过三轮，
        03:5x 那趟现量 2 行）。这是 B 原写法里"packages/op-log 干净"那一半**本会话第一次读到绿**，
        但它是**别人提交带绿的**（§6 第 26 条同一条读法），而且它是瞬时读数 ⇒ 开窗那一刻还得重跑。
      ② 另一半 `pnpm --filter @heyta/op-log build` **本会话没跑**，理由是实测而不是推测：
        `node scripts/dist-freshness.mjs --only op-log` ⇒ **rc=0 但 `🔴 op-log 产物比源码旧 29s`
        （src `packages/op-log/src/state.ts` / dist `dist/index.js`）** —— 也就是那条前置**当前不成立**，
        补它要写 `packages/op-log/dist`，而那是**别的会话正在读的共享产物**（AGENTS §8.9），
        负载此刻 35 ⇒ 不在这一刻动它。
        ⇒ 正确的开窗序列因此是**两条命令**，不是一条：
        `node scripts/dist-freshness.mjs --only op-log` 若报"旧"则先 `pnpm --filter @heyta/op-log build`（独占窗内），
        再 `IOS_DEVICE_NAME="heyta-iphone-17pro" bash scripts/reinstall-all.sh`。
        复跑：`git status --porcelain -- packages/op-log; node scripts/dist-freshness.mjs --only op-log; sysctl -n vm.loadavg`

   m) 🟡 **10:4x 五项复跑（本表所有格子的现行量；引用前再重跑一遍）**：
      ① B 前置①：`git status --porcelain -- packages/op-log` ⇒ **0 行**（与 10:2x ① 同向，仍绿）。
      ② B 前置②：`node scripts/dist-freshness.mjs --only op-log` ⇒ `🔴 op-log 产物比源码旧 35s
        —— src packages/op-log/src/engine.ts / dist dist/index.js`，汇总 `落后 1 / 缺 0`。
        🔴 **这一格纠正了 l) ② 的一条归因**：10:2x 指的是 `src/state.ts`，10:4x 指的是 `src/engine.ts`，
        而**两次都在"packages/op-log 零脏行"的前提下发生** ⇒ "产物比源码旧"**不是**"别人 WIP 会被打进产物"
        的读数（那一半由 ① 判），它只说明**这台机器上的 dist 落后于已提交源码，补它 = 跑一次 build**。
        我之前把它写成"要写共享产物所以不动"，理由仍然成立（§8.9 独占），但它成立的原因是
        **写 `packages/op-log/dist` 会影响并行会话正在读的 dist**，不是"那里有别人的 WIP"。
      ③ C 的窗口：`bash scripts/verify-mobile-window-gate.sh --target c` ⇒ **exit 3**、
        `REDS=load,src,dev,apk`、5 条 ❌（两条共用 `WHY_DEV`，所以 `FAIL=5 > REDS 4 格` ——
        这是第 307 行注释里预告过的形状，不是新缺陷）。`dev` 那两条此刻的主体：
        pid **79158** = `scripts/.verify-mobile-ios-reminder.sh.snap.79158`（提醒线，起 1 分 22 秒前）、
        pid **93817** = `/tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817`（已 7h27m，仍卡在 notarytool）。
        ⚠️ **我自己在这条上踩了第二次同一行**：第一次跑我写成 `… | tail -12; echo rc=$?` ⇒ 打出 **0**，
        真实是 3（traps #45/#179 那一族）。⇒ 本文件里凡"复跑某脚本取其 rc"都写成
        `OUT=$(cmd); rc=$?` 或不带管道，**不要**写 `cmd | tail; echo $?`。
      ④ H 的证据仍然对得上盘：`bash research/tools/r17-evidence-md5-check.sh --all` ⇒ **rc=0**、
        `dirs_scanned=12 entries_parsed=12 mismatch=0`，其中 `calendar-view-options` 两枚
        `d4e80762…` / `ae8ad61d…` 与 README 逐字相同 ⇒ **自 06:46 那趟之后没有别人的 e2e 运行重写过它们**
        （这条不是"永远成立"—— 它每被别人的趟顶一次就要重取，见上面 README 里那两段日期）。
        🔴 但 README 自己那句"等 A 落笔后这两枚要重取一次"**仍未满足**：图上画的是当前工作树（含别人 16 行未提交 CSS）。
      ⑤ E 的闭合形状复跑：`pnpm --silent check:md-tables` ⇒ **rc=0**（`✔ 9 个文件…`）；
        `node -e` 解析 `package.json` 的 `check` 链 ⇒ `segments=76`、`check:md-tables` **恰 1 段**。
        🔴 B 那条命令里的设备名此刻**有现量背书**：`simctl list devices` 显示 booted **4 台**
        （`heyta-batch2-closeout` / `heyta-iphone-17pro` / `heyta-ios-isolated` / `iPhone Duo heyta`），
        `heyta-iphone-17pro` 在列 ⇒ `IOS_DEVICE_NAME=` 传得对；⚠️ 同一行也说明"取 booted 第一台"这类
        写法在今天必然选错（traps #169），闸门里那个 `head -1` 回落只在**显式名字缺失**时才走。

   n) 🔴 **10:4x：H 的证据从"字节对不上"换成了"主张对不上"，而后者没有任何东西会报红**（已回写证据 README 本体）。
      现场：`git log -1 -- …/calendar-view-options/view-tabs-year.png` ⇒ **`39032107` 10:11**（并行那笔把
      本线那 16 行 CSS **和**本会话 06:46 那两枚图一起进了 HEAD），`git status` 对该目录**空**，
      `git show HEAD:… | md5 -r` ⇒ 工作树与 HEAD **逐字节相同**。
      ⇒ README 里原写的那两句**按字面都过期了**（"那对旧字节还在 HEAD 里" / "拍到的不是 HEAD 的界面"），
      已划掉就地更正；但**欠的那一次重取没消**，因为 10:11 之后 HEAD 又进了 **2 笔动 `apps/web` 的提交**
      （`1cf3be7b` 10:12、`5481b3cb` 10:24，都在注销模块），所以此刻严格能主张的只有
      **"这两枚图 == `39032107` 的界面"**。⚠️ 那 2 笔会不会改日历面上画的东西**没有取证** ——
      不许写成"无关模块所以像素不变"。
      📌 一般形状（写进证据 README 的那条纪律）：**截图会两种过期**：
      ① **字节过期**（别人重跑同名趟顶掉图）—— `r17-evidence-md5-check.sh --all` 抓得到，本轮 10:4x 现量 rc=0/12 条全对；
      ② **主张过期**（字节没动，支撑"这张图画的是当前交付"的现场动了）—— **所有门禁都不会报红**，
      唯一的防线是把"这张图对应哪一笔提交"当成图的一部分写进 README。本线从今天起把 `39032107` 记在正文里。

   o) 🔴 **10:4x 第二笔"不在本线手里"的门禁红**（登记，不代改、不放宽）：
      `pnpm --silent check:docs` ⇒ **rc=1**，3 处死链**全部**在 `docs/adr/0051-mobile-reminder-delivery.md:202/203/205`，
      指向 3 枚**未跟踪**的 `apps/mobile/evidence/ios-reminder-pending-{before,after,after-delete}.png`。
      归属现量：该 ADR 是 `M`（未提交），且 `git show HEAD:docs/adr/0051-mobile-reminder-delivery.md | grep -c 'ios-reminder-pending'`
      ⇒ **0** —— 也就是**这 3 条链接只活在活树里**，干净检出（CI 形态）上这个门禁仍绿。
      ⚠️ 同一趟 `10:3x` 我跑的是 rc=**0**，10:41 变 1 ⇒ 红出现在这两分钟之间，是那一条线刚落笔的编辑。
      三条出路（门禁自己打印的）由**它的持有者**选：`git add` 那 3 枚 png / 把链接改成纯文字 /
      登记 `research/tools/docs-link-check.mjs` 的 `UNTRACKED_LINK_OK`。本线不碰（§8.9 归属 + 硬约束"不 git add"）。
      复跑：`OUT=$(pnpm --silent check:docs 2>&1); echo rc=$?; printf '%s\n' "$OUT" | head -12`
      🟢 **10:4x 三分钟后这格自己绿了，但绿的位置要说清**：`pnpm --silent check:docs` ⇒ **rc=0**，
      而 `git status --porcelain -- apps/mobile/evidence` 现量那 3 枚是 **`A `（已暂存、未提交）**，
      `git show HEAD:docs/adr/0051-mobile-reminder-delivery.md | grep -c 'ios-reminder-pending'` 仍是 **0**，
      HEAD 也仍没动（`406fa52b` 10:42 是一笔 docs）。
      ⇒ 机制：这一半判据走的是 **`git ls-files`（索引 + HEAD）**（该工具第 121/130 行注释写明），
      所以**"绿"此刻挂在别人的暂存区上** —— 他们若 `reset` 掉索引，红会原样回来。
      📌 这条比"红是瞬时读数"更进一步：**绿也可以是瞬时读数，且它的支撑可以在第三份状态（索引）里**。
      同族：AGENTS §7 那一族"工作树/HEAD/索引三份会互相落后"。

   p) 🔴 **10:4x B 的对账复跑：三段仍全 `DIFFER`，而"本机侧"这 30 分钟里换了两次 —— 换它的不是本线**
      （`IOS_DEVICE_NAME="heyta-iphone-17pro" bash research/tools/b-batch-reconcile.sh` ⇒ **rc=1**）：

      | 段 | 已装 | 本机 | 本机侧现量 |
      |---|---|---|---|
      | MAC | `387b2d6a…` | `f85771e5…` | `apps/web/dist/index.html` mtime **10:34**（10:1x 那格是 `94ed463a…`） |
      | iOS | `8d879b97…` | `72453ede…` | 已装 `main.jsbundle` vs 本机 |
      | ANDROID | `0ecdc445…` | `c5427f90…` | 设备上那份 vs 本机 APK |

      🔴 **由此定下 B 的操作形状**（这是这格唯一有用的产出）：该工具比较的是
      「已装字节」与 **`$REPO/apps/web/dist` 当前的字节**（`b-batch-reconcile.sh:22` 写死这个默认路径），
      而 `apps/web/dist` 是**并行会话共写的产物** —— 10:34 那一笔就是别人的一次 `web build` 换掉了它，
      与本线无关。⇒ **对账只有在"本线自己刚 build 完"的那一刻之后立刻跑才有意义**；
      任何别的时刻跑出来的 `DIFFER` 都只说明"装的不是别人 10:34 那批"，**不说明**"装的不是本线这批"。
      所以 B 的闭合序列钉成三段、不许拆开：
      ① 独占窗内 `pnpm -r build`（+ 需要时 `pnpm --filter @heyta/op-log build`）
      ② **紧接着** `IOS_DEVICE_NAME="heyta-iphone-17pro" bash scripts/reinstall-all.sh`
      ③ **紧接着同一次** `bash research/tools/b-batch-reconcile.sh`（期望 rc=**0**，四段 same/交棒）
      —— 中间只要有人 build 过 web，③ 的读数就作废重跑。
      ⚠️ 这一段仍然**没有闭合 B**：它只把"什么时候跑才算数"定下来了。

   q) 🔴 **10:5x H 的 flaky：借来的那趟红**没有**洪泛，而"扫描自己瞎了"在这一格里被当场抓出两次**
      （新档 `--scan` 现量；判据 (a) 仍未被喂到）：
      `bash research/tools/h-flaky-window-watcher.sh --scan "$PWD/e2e/test-results/list-folder-…-chromium" "…-retry1"`
      ⇒ 两枚都 `scan=ok traces=1 **connect=6 hotUpdated=0 fastRefreshInvalidate=0** viteInTrace=yes`（rc=0）。
      这两枚是**另一条线 06:51 那趟红**留下的 trace（`retain-on-failure` 只在红时留）。读数是两头用的：
      ① **正向**：trace 确实看得见浏览器的 `[vite]` 行 ⇒ 扫描这条路是活的（阳性对照成立）；
      ② **否定**：那趟红里**一条 `[vite] hot updated` 与 `Could not Fast Refresh` 都没有**
      ⇒ §7.4 那支机制**不是这台机上"红"的唯一解释**，也就**不能拿它当本线 (a) 的现量** ——
      (a) 要的是"本线这枚 flaky 复现的那一趟里看见洪泛"，仍然没有。
      🔴 这一格真正的产出是**修掉两处扫描自己的瞎**：`ht_trace_scan` 原来
      ① `( cd "$_x" && unzip "$_f" )` —— `find` 交回**相对**路径时子 shell 换了 cwd 就找不到文件；
      ② `for _f in $_z` —— **本仓绝对路径里本来就有空格**（`Desktop/All in one Data/…`），
      一枚 zip 被拆成 4 个"文件"。两种失败都被 `-q` + `2>/dev/null` 吞掉，症状逐字是
      `connect=0 / viteInTrace=no` —— 也就是**"扫描没看见"被读成"那趟没有洪泛"**。
      我先在 `--scan` 上撞见 connect=0，而同一条 zip 在 09:3x 手扫过是 3 条 ⇒ 先怀疑探针是对的。
      ⇒ 已改成 `unzip … -d "$_x"` + `while IFS= read -r`，并解不出 `.trace` 时**响亮地**报
      `scan=unavailable`（不再让 0 冒充读数）；`--selftest` 从六臂加到**七臂**，
      新臂用**自造夹具**（带空格的目录里一枚含三条 needle 的 zip + 一枚空 zip）做正负两腿：
      `bash research/tools/h-flaky-window-watcher.sh --selftest` ⇒ **rc=0**（10:5x 现量，臂7 真执行）。
      ⚠️ 顺带一条现场变更：看守的**稳定名软链 `/tmp/ht-h-flaky.log` 已经不在了**（别人清 /tmp 或重启），
      而进程还活着 ⇒ 读它要用**每趟唯一**的那份 `/tmp/ht-h-flaky.<日期-时间>.<pid>.log`。
      本表 H 行第三列已按此改。

   r) 🟡 **10:5x 一条我差点登记成缺陷的东西，现量之后它不是缺陷**（写下来是为了让下一位不必再怀疑一遍）：
      看守 pid 32016 已跑 **26 分钟**，而它自己声明 `总预算=1500s` ⇒ 第一反应是"预算没生效、它会永远等下去"。
      读代码 + 看日志之后的结论：`BUDGET` 的检查在**每轮循环末尾**（第 335 行），而一轮里
      `wait_for_quiet_host` 自己最多可以等 `HEYTA_LOAD_GATE_WAIT=$BUDGET`，所以
      **墙钟过冲的上界是 2×BUDGET，不是"无限"**；09:42 那趟正是在 1800s 处 `GATE=timeout rc=3` 收的。
      日志里那些"累计 0s"也不是计数器坏了 —— 那是**每次进门**都要重新数的内部计数（外层 START 一直在走）。
      📌 形状：**"看起来是 bug" 与 "是 bug" 之间隔着一次读码**。这一格没花 CPU，只花了 20 行 `sed`，
      而如果直接登记成缺陷，就得由下一位来否证它（本线 §6 第 27 条同族：写进台账的诊断本身也是断言）。
      ⚠️ 但有一条**确实是它的真实行为**：`STRICT_MAX`（≤9，对应 objective 那句"负载落回个位"）
      比规范门（`hw.ncpu×3/4`=12）更严，本趟到 10:5x 现量规范门**过了 4 次**（负载 12 三次、**负载 10 一次**），
      四次全被严格层退回 —— 所以"窗口一直没开"这一句要写成**"严格层没开"**，不能写成"负载从没落下来过"。
      这两种写法给下一位的行动完全不同（前者可以商量阈值，后者会让他继续干等）。
      ⚠️ 而且"负载 10"那一次说明差距只有 **1**：这台机上 9 与 12 之间经常有读数，
      严格层不是摆设，但它挡掉的次数**比"从没落下来"这种说法强得多** —— 报数要报"几次、各是多少"。

   s) 🟡 **10:5x A 的现量：待入库 6 枚，全是我这一小时写的东西；两个计数器看着不一致，读了源码才知各数什么**：
      `bash research/tools/calendar-line-commit-plan.sh` ⇒ **rc=0**、`待入库 6 枚（改动 6 / 新增 0）`、
      `OUTSIDE_NS=1`（`scripts/lib/legal-stale-families.mjs`，不归本线）、`索引为空 0 枚`、
      三道静态门禁 `md-tables rc=0 / shell-unicode rc=0 / docs-link rc=0`，
      点名列出的正是本会话改的 6 枚（两份计划 + `docs/plans/README.md` + 证据 README +
      `r14c-bundle-testid-preflight.sh` + `h-flaky-window-watcher.sh`）。
      ⚠️ 同一趟还打了一句 `命名空间命中 5 枚全部已点名` —— **6 与 5 不是漏登记**：
      `TOTAL` 数的是 PATHS 清单（含 `docs/plans/README.md`），`NS_HIT` 数的是 NS_RE 命中的脏行
      （那条正则**按文件名精确列** `docs/plans/…md`，不含 README）。两个数各自答两个问题，
      不一致是设计如此；下一位若把它们对成一条等式，就会去"修"一个不存在缺陷的地方。
      🔴 A 本身**仍未走过一遍**：此刻没有提交权（硬约束"不 git add/commit"），
      所以"点名提交"这条纪律至今是**未被执行过的程序**，不是成绩。

   t) 🔴 **11:0x：我新加 `--scan` 那一档，把正在等的看守的现场摘走了**（同一事故的第二次，肇事者是我自己；当场发现、当场修、当场加臂）。
      发现方式不是跑出来的，是**读文件头注释时认出了自己踩的坑**：那几行写着
      "`--selftest` 不许挂稳定名，因为它也会先跑到那段 `ln`；09:2x 跑完 selftest 后
      `/tmp/ht-h-flaky.log` 指向了一份空文件"，而我加 `--scan` 时照抄进分支、
      **没意识到同一句"先跑到那段 `ln`"对新档位一样成立**。
      现量：`ls -l /tmp/ht-h-flaky.log` ⇒ 指向 `…105328.92112.log`（我自己那次 scan 建的近乎空的日志），
      而真看守 pid 32016 的现场在 `…102956.32016.log` 里活着。
      ⇒ 做了三件，每件都有读数：
      ① 接线从**排除名单**（`--selftest`、`--scan` 各记一笔）改成**允许名单**（只有 `run` 挂）
        ⇒ 以后再加任何档位，默认就摘不走别人的现场；
      ② `STABLE_LOG` 从写死改成 `${STABLE_LOG:-/tmp/ht-h-flaky.log}` —— **没有这一条，"不许摘走"根本无法在 selftest 里测**；
      ③ `--selftest` 六臂→七臂→**八臂**（11:0x 现量 **rc=0**）：新臂负向腿 `--scan` 跑完 `readlink` 必须没变，
        正向腿 run 档（`SKIP_GATE=1 RUNS=0 PW_CMD=true`）必须**真的挂上** ——
        缺正向对照时，"负向通过"和"接线整个坏了"长得一模一样。
      收尾：把稳定名指回 32016 那份、删掉我自己建的那枚空日志，复跑 selftest 后稳定名**没再被摘走**（现量）。
      📌 可迁移的一句：**新加的调用路径要先回答"它在到达自己的分支之前执行了什么"** ——
      脚本顶部的接线（建日志、挂软链、export 环境变量）对每一档都成立，
      而"我这一档只是查一下、不会有副作用"这种感觉恰好就是漏的原因。

   u) 🟢 **11:0x F 的第二条边界有了自己的现量清点器**（此前它只有台账里的一个数）：
      新增 `research/tools/f-boundary-scope-count.sh`（只读；`SRC_DIR` 可传参以便夹具自测）。
      现量：`bash research/tools/f-boundary-scope-count.sh` ⇒ rc=**0**、
      `处=235 行=234 文件=16 去重键=222 阳性对照 common=130` —— **与 03:0x 那趟逐字相同**
      ⇒ 8 小时里这条边界没动；台账 §6 第 21 条那句"至今没有门禁"现在改成
      "有现量脚本、仍无常驻门禁"（这两件事不一样，别读成已进 `pnpm check`）。
      三臂 `--selftest` rc=**0**（夹具四列对得上 / 对照为 0 必报 exit 4 / 目录缺失必报 exit 1）。
      🔴 写它的原因正是台账记过的那次探针自坏（grep 塞进 `$( )` 时 `\"` 进了 pattern ⇒
      处数与对照**同时为 0**）：落成文件就没有那一层引号嵌套。
      同时把它**两处一起**登记进 A 的清单（PATHS + NS_RE 加 `f-boundary-`，不写裸 `f-` 以免撞别人的命名空间）——
      这条清单今天已经是**第三次**需要手补，只补一处就会静默漏件。

   v) 🔴 **11:0x A 那把"索引必须为空"的闸门第一次抓到真实的外来暂存**（不是注入、不是夹具）：
      `bash research/tools/calendar-line-commit-plan.sh` ⇒ **rc=1**、
      `❌ 索引里有 3 枚已暂存路径，其中不属于本线的：apps/landing/evidence/{reminder-capabilities-zh,vault-recovery-en,vault-recovery-zh}.png`。
      时间线：10:5x 同一条命令还是 **rc=0 / ✅ 索引为空**，六分钟后别人 `git add` 了三枚图 ⇒
      红是新出现的，不是工具版本变化。同一趟 `工作树脏行分母` 从 29 涨到 **52** ——
      这台机上的现场以分钟为单位在动，这就是"引用旧读数必须先复跑"的量化理由。
      ⇒ 本工具**不代改、不在别人的索引上动刀**（它的输出原文就写了这句）；
      持有者＝落地页/凭据那两条线的会话；关闭判据＝同一条命令回到 `✅ 索引为空` 且 rc 回到 0。
      📌 §8.3 的另一半在这一格有了现量：**"这条判据能不能失败"以前只有"历史上抓过 4 次"，
      这是它第一次在真实并行下报红** —— 从这一刻起它算有牙，而不是"写着像有牙"。
      🟢 **11:39 复跑同一条命令 ⇒ rc=0、`✅ 索引为空（0 枚）`、待入库点名 8 枚、静态三门禁 rc=0、脏行分母 78**。
      红消失的原因是**别人把自己那三枚提交了**，不是本线动了索引 —— 这一句当场可验：
      `git diff --cached --name-only` 现量空，且本会话从未 `git add`（那句"不代改、不在别人的索引上动刀"
      在这一刻不是姿态，是可核对的事实）。⇒ 挂在别人动作上的闸门，**它的颜色变化本身就是别人的读数**，
      写进账里才不会让下一位以为是本线关掉的（同一件事的反方向记在 o 格）。

   w) 🟡 **11:0x 看守换成了修好之后那份（旧的那必须停，不是"能跑就留着"）**：
      我这一小时改的正是 `h-flaky-window-watcher.sh` **本身**，而旧看守 pid 32016 是从 10:29 起、
      按**当时的字节偏移**惰性读脚本的 —— 我往它前面的函数与分支里插了几十行，
      它下一次读到新偏移就是错位文本（bash 不会把改动"吸进"已在执行的进程）。
      ⇒ `kill 32016`（它是等待器，没碰设备、没跑 e2e，停它零代价），
      重新挂上：**pid 96461**、日志 `/tmp/ht-h-flaky.20261004-110740.96461.log`、
      `BUDGET=2700 RUNS=3 STRICT_MAX=9`，启动行现量 `稳定名=/tmp/ht-h-flaky.log(挂上=1)`。
      📌 这一条同时是 t) 那个"允许名单"改动的**线上正向对照**：selftest 只能证明桩路径，
      真 run 档挂上稳定名这件事现在有一次真实读数（旧的那次是我手工 `ln -sf` 指回去的，不算）。
      ⚠️ 另：改一个**正在被后台执行**的脚本之前，先问"谁在按旧偏移读它"——
      本轮的顺序其实是反过来了我才补救（先改后停），正确顺序是**先停再改**。

   x) 🔴 **11:1x 把 traps #110/#113 的自快照机制装到看守上，结果当场炸出这条机制本身的一个坑**：
      看守是"等几十分钟的长跑装置"，正是 #113 说该上 bootstrap 的那类，所以我照 `verify-mobile-due-time.sh`
      的**逐字形状**装了 `HEYTA-SNAPSHOT-BOOTSTRAP v1`（先停旧看守再改，顺序这次是对的），
      并在 `.gitignore` 补了 `research/tools/.*.snap.*`（原来只有 `scripts/` 那一行 ⇒ 快照会污染 `git status`）。
      🔴 装完 `--selftest` 从 rc=0 变 **rc=4 / 17 条臂红 / 子进程 127**。根因不是 bootstrap 本身，
      是它带来的那句无条件 `trap 'rm -f -- "$0"' EXIT` 与**本装置的递归自调用**冲突：
      selftest 的各臂用 `bash "$0"` 起子进程，子进程跳过 bootstrap 时 `$0` 就是**父进程那份快照的名字**，
      于是第一个子进程退出时把父亲的脚本删了 —— 症状是 127 与"臂的日志文件根本没被创建"，
      而 `bash -n` 全绿（文件当时还在）。⇒ 已改成**只有创建者清自己那份**
      （快照名尾巴是创建者 PID ⇒ `case "$0" in *.snap.*) [ "${0##*.snap.}" = "$$" ] && trap … esac`），
      现在 `--selftest` **rc=0（八臂）**、`check:script-snapshot` **rc=0**、`research/tools` 里快照残留 **0 枚**。
      现成的排查动作：`ps -p <pid> -o command` 打出的是 `.h-flaky-window-watcher.sh.snap.<pid>` ⇒ 机制真生效
      （11:1x 重挂的看守 pid **15002**，日志 `/tmp/ht-h-flaky.20261004-111205.15002.log`）。
      ⚠️ 顺带量了一条**边界**：这个坑不是全仓的 —— `grep -rln 'bash "\$0"' scripts research/tools` 命中的
      六枚里，`scripts/` 那批（有 bootstrap、在 MANIFEST 里）**没有一枚**递归自调用，
      所以"父亲的脚本被儿子删掉"这一类今天在仓里只在我这一枚装置上成立过，已修；
      要把它变成常驻判据得改 `check-script-snapshot.mjs` 的判据形状（它现在只查标记+三处结构+gitignore 一行），
      **登记给那把门禁的持有者**，本线不代改别人的判据。
      📌 一般规律：**引入别人的机制时，机制的隐含前提要当成断言来测** ——
      #113 那套的隐含前提是"这个脚本不会自己调自己"，我的 selftest 恰好违反它。
      🔴 **这条待入 traps #113 的补充**（同类事故扩充原条，不占新号），**此刻不落台账本体**：
      现量 `git diff --numstat HEAD -- docs/reference/environment-traps.md` = **103 增 / 7 删，未提交**、
      索引里 0 枚 —— 台账正被并行会话整片改着，往里插行的代价是要么被他们的整文件 `git add` 抹回去、
      要么替他们承担那 103 行的归属（同一棵树上的老账，见本文件 §6 第 20 条与 07:4x 那格）。
      取号请按**工作树**，别按 HEAD、也别按行号推断：现量编号行 **241** 条而最大号 **232**
      （两数不等 = 历史上有重复号），`grep -oE '^[0-9]+\. ' docs/reference/environment-traps.md | tr -d '. ' | sort -n | tail -1`。

   y) 🔴 **11:2x：本线 §5 第 1 条那句"任何读 dist 的判据开跑前先跑一次体检"搬进了看守本体**（`ht_dist_report`）。
      起因是现量到的一个**结构差**：那条纪律写在文档里，而 H 的开跑者从 09:4x 起就是这个**自动装置**本身
      —— 一条只约束"人记得"的前置，对自动化路径**没有任何约束力**（`grep -n dist-freshness` 在看守与两道 lib 里
      命中 **0**，这就是证据）。
      做法与两条刻意的取舍：
      ① **记录，不当门禁**：`scripts/dist-freshness.mjs` 的文件头自己写明"默认永远 exit 0 —— 并行会话正在改
      源码时『落后』是正常状态"，把它变成红等于本线摘走一条不属于本线的判据（AGENTS §8.3）。
      ② **范围不手抄**：包清单从 `apps/web/package.json` 的 `@heyta/*` 现取（手抄一份一定会漂，
      而漂了的体检只覆盖子集，打印出来却长得像"全新鲜"）。取不到一律打 `check=unavailable`，绝不打成 `behind=0`。
      现量：13 个包、`落后 1`（`app-host` 落后 **1 秒** —— 别人此刻正在写 `packages/app-host/src/index.ts`）、`缺产物 0`。
      判据两腿：臂1 正向钉**形状**（`pkgs=[0-9]+ behind=[0-9]+ missing=[0-9]+`，**刻意不断具体值**，
      否则 selftest 就把上游现场写死了）；臂4 负向用**现成的最小树**（那棵树里没有 `apps/web/package.json`）
      ⇒ 必须自报 `check=unavailable`。变异读数：把那一句改成 `pkgs=0 behind=0 missing=0` ⇒ selftest
      **rc=4、红集恰好 1 条**（就是臂4 这条新腿），复原后 **rc=0**；`check:script-snapshot` rc=0（38 脚本）、
      `check:shell-unicode` rc=0（109 个 .sh）、快照残留 0 枚。
      ⚠️ 顺带一枚免费的正向对照：停旧看守（pid 15002）用的是 `kill`（TERM），而 `SIGTERM` 下
      EXIT trap 照样把**它自己那份**快照清掉了（现量 `no matches found` / 残留 0）⇒ 11:1x 那句
      "清理只归创建者"在真实信号路径上过了一次，不只在 selftest 里。
      看守重挂：pid **38951**、日志 `/tmp/ht-h-flaky.20261004-112757.38951.log`、参数**逐字未放宽**
      （`BUDGET=2700 RUNS=3 STRICT_MAX=9`），启动行现量 `稳定名=…(挂上=1)`，第一趟负载 **69**。

   z) 🔴 **11:4x 第二条不属于本线的 `check:docs` 红 —— o 格那一族的第二次命中**：
      现量 `pnpm --silent check:docs` ⇒ rc=**1**，"本机有、仓库里没有" **3** 处，全部指向同一枚
      `apps/mobile/evidence/android-vault-cold-start.txt`（盘上 1136 B、mtime **11:41:18**、状态 `??` 未跟踪）。
      来源归属就用 A 那把工具**自己印出来的那条 awk 形状**跑了一遍：`1 PROGRESS.md` + `2 docs/adr/0050-e2ee-….md`。
      🔴 **本线不动它**，三条依据都是现量而非推断：① 两个引用文件在工作树里都是 `M`（别人正在飞的这笔）；
      ② `git show HEAD:docs/adr/0050-e2ee-key-lifecycle-and-recovery.md` 里那条 needle **0 命中**
      ⇒ 干净检出/CI 仍是绿的，这是**活树红**（与 o 格同形）；
      ③ 目标是 `??`（`git ls-tree -r HEAD` 也 0 命中），而本会话没有 `git add` 授权，
      也不该替别人判断这枚 cold-start 取证能不能入库 —— 门禁给的三条出路（入库 / 改成纯文字 /
      登记 `UNTRACKED_LINK_OK`）选哪一条要**它的所有者**拍，尤其这里可能含设备侧数据。
      持有者＝端到端加密密钥生命周期那条线（ADR-0050 与 PROGRESS.md 的当前写者）。
      复跑（只读）：`pnpm --silent check:docs; git status --porcelain -- PROGRESS.md docs/adr/0050-e2ee-key-lifecycle-and-recovery.md apps/mobile/evidence/android-vault-cold-start.txt`。
      ⚠️ 顺带记一条**别读成"工具不一致"的读数差**：同一趟 `calendar-line-commit-plan.sh` 打出
      `docs-link rc=1` 而**整体 rc=0** —— 那是 10:1x 就写进设计的（这道门禁量的是工作树、按来源文件归属、
      不替别人放宽判据、也不因此停下），不是它瞎了。**"全局 docs 门禁红" 与 "本线这笔提交不会把红一起带走"
      两句同时成立**，只引其中一句都会让下一位读错。

   aa) 🔴 **11:5x 把同一条"把提交号当作图的一部分来记"的纪律补到 R16 那目录**（n 格那套只给了 `calendar-view-options`）：
      `apps/web/evidence/calendar-day/` 里**上面那五张 `calendar-day-*.png` 从来没有形状主张的锚点** ——
      现量 `git log -1 … -- calendar-day-full.png` ⇒ **`5e23b7bf` 10-03 23:58**，
      而把页头改成"动作整体可换行"的那笔 CSS 是 **`39032107`（10-04 10:11）** 才进 HEAD。
      我这次**真的把那五张打开看了**（此前那张表只写"是什么/它证明什么"，**没有一条"人看过"**，
      而 §6.2 规定一 要的是第 4 条）：`calendar-day-full.png` 页头**一行排满、没有折行**
      （`日历 · ‹ 10月3日 星期六 › · 回到今天 · + · 视图[日] · 未同步 · ⟳ ·  · 中文/English · 月亮`），
      全天带一条 `日视图-947421`，轴 `0:00`→`7:00`。⇒ 三条已写进那份 README 本体：
      ① 图里的"今天"是 **10-03 星期六**（不是读图日）；
      ② 这五张**不证明**今天的 HEAD 在日档下也画一行页头 —— 折行那个现象的前提是主区被挤窄，
      而日档通常不开详情列 ⇒ **这一处既不能说一致也不能说不一致，是没取证**。
      离线为什么判不出来，这次是**读过 HEAD 的 CSS** 才写的：`git show HEAD:apps/web/src/styles/app/main-area.css`
      里 `.ht-header{ flex-wrap: wrap; }`（第 11 行）与 `.ht-header__actions{ flex-wrap: wrap; }`（第 34 行）
      都是**无条件允许换行** —— 允许 ≠ 一定换，真换不换取决于内容宽度与容器宽度，静态读规则判不出来，
      只有把那一屏渲染出来才知道（⇒ 判据只能回到"重跑 + 人看"）。
      ③ 把它变成读数的唯一路径 = 等窗口重跑 `cd e2e && npx playwright test tests/calendar-day.spec.ts`、
      人看过、按新字节改表并**带上提交号**。
      ⚠️ 顺带量出一处**敞口**：`r17-evidence-md5-check.sh --all` 对本目录打的是 `entries=3 mismatch=0` ——
      钉住的只有 `day-en-*` 那三枚（11:46 复跑：盘 == README == HEAD 三方一致，
      `d9916538…` / `40e71764…` / `57d2d008…`），**那五枚没有常驻 md5 ⇒ 它们的"字节过期"不会被任何对账报红**。
      这一条与 ② 是两种不同的敞口（一个看不见字节动了，一个看不见主张旧了），都登记在本体里，没写成"已闭合"。
   bb) 🔴 **12:0x–12:2x 那两处"敞口"里的一处当场被实测兑现，另一处换成了有牙的形状**（aa) 格写的两半，一半已闭合、一半改成常驻红以外的东西）：
      **① 现场先红了，而且红的是我自己那把装置的对照腿。** 12:0x 给 `r17-evidence-md5-check.sh` 加完新臂跑 `--selftest`
      ⇒ `SELFTEST_RC=4`：`MISMATCH view-select-closed.png：README=d4e80762… 盘上=52174907…`。
      成因是**装置设计缺陷**：第一版的对照腿 `cp` 的是**现场那份 README + 那两枚 png** ⇒ 现场一红，
      对照腿就"自杀在 exit 4"，**后面六臂一条都没跑**。⇒ 八臂现在全部跑在**自己造的合成夹具**上
      （裸形状/表格形状/代码锚点各一个临时目录），现场状态只由 default 与 `--all` 那两条路报。
      📌 一般规律：**"牙的检查"不能由它要保护的那份现场卡住** —— 否则现场一坏，装置就从"报红"退化成"不跑"，
      而"不跑"在输出上长得像"没跑到"（§8.3 那一族第三种面目）。
      **② 归因先做再动笔。** 那枚 11:55 的重写**不是本会话起的**：看守 pid 38951 的日志里
      **一条 `----- 第 n 趟` 都没有**（11:27:57 起到 12:12:57 预算用尽 rc=3，全程卡在负载门，
      只在 12:12 出现过一次"负载 12 ≤ 12"通过规范门、被本线自加的严格层 ≤9 挡下）。
      **③ 逐像素量，不靠眼睛猜。** 把两批字节 `magick … RGBA:-` 拉平后自己按行成带比对：
      `day-en-full.png` 差 **468/3686400** 枚像素、**唯一那条带 `57x14+447+224` 就是任务名那一行**
      （`en-day-589776` → `en-day-083090`，aa) 格说的 STAMP）；`view-select-closed.png` 差 4982 枚，
      两条带 `47x44+8+68`、`99x43+9+121` **全在左侧 rail 的图标与那条「日历」提示条上**，
      页头/下拉/月格/日档详情/侧栏**逐字节相同**；两批的这一区域我 12:1x 裁出来上下并排看过，肉眼无差。
      🔴 **12:2x 一处自我更正（写下来是因为它换了根因方向）**：把这张图历史上进过 HEAD 的字节逐枚枚举后，发现 `52174907…` **在 06:10 与 11:55 各出现过一次（逐字节相同）** ⇒ 准确说法不是"每趟一个新值"，而是"同一笔代码下至少四个稳定形态、且会复现"（23:19→`bf594d6a`、01:34→`d2c5cbfd`、10:0x→`d4e80762`、06:10/11:55→`52174907`）。**"不能钉常驻 md5"的结论不变**（10:11 与 11:55 是同一笔代码下的两个形态），但候选原因从随机种子改成运行态（提示条淡入帧 / `selectOption` 后焦点 ⇒ `:focus-visible`），**未定性、本轮不再往下查**。顺带一枚可复用的探针 tell：zsh 里 `git show $c:path` 的 `:a` 会被当**修饰符**吃掉 ⇒ 输出空 ⇒ `md5 -q` 得到 `d41d8cd98f00b204e9800998ecf8427e`（**空输入的标准 md5**）—— 看到这一串就知道探针根本没读到字节，而不是"文件是空的"。跨 shell 一律写 `"${c}:path"`。
      ⚠️ **原因未定性**（候选：截图没等动画收敛 / 字体次像素抖动），本轮**不写因果**，只写量到的事实。
      `view-tabs-year.png` 与 `day-en-empty.png` 重跑后**字节与 HEAD 相同** ⇒ 这两枚的稳定是**量出来的**。
      **④ 于是锚点规则改写成两条，写进两份 README 本体**：
      常驻 md5 **只给"同一笔代码下两趟字节相同"的图**（其余降级为记录值，值仍留在表里，只是不再是对账锚点）；
      形状主张改钉 **`UIPIN <文件> <提交> <决定这张图形状的路径…>`** = 代码锚点，判据是
      "那些路径里最后一次动它们的提交 ≤ 钉的那笔"。🔴 第一版这里是 `COMMITPIN <png> <sha>`
      （比"最后一次动这张**图**的提交"），**同一轮实测否证**：它把"有人重跑了 e2e"与"界面形状变了"
      混成同一个读数，而前者在这个仓库里每天几十次 ⇒ 常驻红。selftest 臂 6 专门钉这件事
      （**图字节一个字没变、源码动了一笔 ⇒ 仍然恰好 1 枚红**，现量 `x.png 字节与臂5 那趟相同=yes`）。
      **⑤ 读数（12:1x，全部现量）**：`--selftest` 八臂 rc=**0**；
      `--dir apps/web/evidence/calendar-view-options` ⇒ `entries=1 mismatch=0 pins=2` rc=**0**（`view-tabs-year` 的 md5 保住，两枚都 UIOC）；
      `--dir apps/web/evidence/calendar-day` ⇒ `entries=1 mismatch=5 pins=8 md5bad=0 pinbad=5 pinunknown=0` rc=**1**
      —— **那五枚红是"要重拍"这条欠账的机器读数**（aa) 格 ② 那句"没取证"从等人读的话变成会自己响的判据），不是事故；
      `--all` ⇒ `dirs_scanned=12 entries_parsed=9 pins_parsed=10 dirs_with_mismatch=2` rc=**1**。
      **⑥ 又抓到一枚（这次不归我动）**：12:16 复跑 `--all` 时 `apps/web/evidence/profile-panel/r15b-2-ready.png`
      报 MISMATCH（README=`c78de436…` 盘上=`dbcd1a1b…`），mtime 12:09:42 —— 同目录另外三枚 `r15b-*.png` 字节未变。
      持有者：**正在跑 R15b 那条会话**（本线之外，12:09 起它还在动这个面）。
      我**没有**去改那份 README（它正被别的写者动，改判据测试文件也算抢面），只登记：
      复跑 `bash research/tools/r17-evidence-md5-check.sh --dir apps/web/evidence/profile-panel`。
      ⚠️ 上面这句里"它正被别的写者动"是**当时没核的推断**：12:4x 现量 `git status --porcelain -- …profile-panel/README.md` **空**、
      mtime **07:14:44** ⇒ 那份 README 是干净的，脏的只有那一枚 png。没去改它的真实理由是：**那是 R15b 那条线的证据账本，
      而它 12:09 还在跑这个面**（改别人的账本 = 抢面；改判据测试文件也算）。
      🔴 **12:4x 把这枚红量到了像素级：结论是"噪声"不是"形状变了"，但它翻出本线自己的一条规则缺口**（三件现量，逐件可复跑）：
      ⑴ 复跑上面那条命令 ⇒ `entries=4 mismatch=1 pins=0 md5bad=1 pinbad=0 pinunknown=0` rc=**1**（读数没翻绿，不是瞬时）。
      ⑵ HEAD 那份（`git show <HEAD>:…r15b-2-ready.png`，68,114 B）vs 盘上那份（68,118 B）都是 **1280×900**；
          `magick … -depth 8 RGBA:` 后逐像素比 ⇒ **diffPixels=3**，两条带 `1x1+101+148` 与 `1x2+101+152`；
          三个点的取值 `245,247,249→244,246,249` / `245,247,250→245,247,249`×2 —— **单通道差 1、近白底（`#F5F7F9` 一带）**
          ⇒ 字形边缘的抗锯齿抖动，不是布局或内容变化。**我判的是字节差的位置与幅度，没有重看 R15b 的界面主张**（那句话归持有者）。
      ⑶ 按 bb) ④ 本线自己定下的规则（常驻 md5 只给"**同一笔代码下两趟字节相同**"的图），这枚红恰好是那条规则的**前置检验现量**：
          同目录 `r15b-1/3/4` 三枚 mtime 也是 12:09:41–44（确实被同一趟重写过）**逐字节复现**，这一枚复现不了
          ⇒ `r15b-2-ready.png` **没通过字节稳定性检验**，它的 md5 不该当锚点，形状主张应改钉 `UIPIN`。
          登记给 R15b 持有者（**不是我这轮的活**）：把这张图的 md5 降级成"记录值"，另加一行
          `UIPIN r15b-2-ready.png <提交> <决定这张图形状的路径…>`；复跑工具已经认这一形状（会把 `pins=` 数进读数）。
      📌 一般规律：**"两趟字节不同"只有两种成因（洪泛 / 这张图天生不稳定），对锚点的处置相反，分不开时别猜 —— 去数差几个像素、差在哪个通道**：
      单通道 ±1 的孤立点 = 噪声 ⇒ 改钉代码锚点；整带/整块位移 = 界面真变了 ⇒ 重拍 + 人重看。
      **⑦ 两处我自己差点读错的读数**（都留原句，因为它们是"命令跑错"而不是"产品坏了"那一族）：
      ⑦-a 在 **zsh** 里写 `git log -1 --format=%H -- $SRC`（`SRC` 是三条空格分隔的路径）⇒ **不词分割**，
      三条路径被当成一条 pathspec ⇒ `NEWEST` 为空 ⇒ 两个 pin 都判成 UISTALE（**假读数，而且方向是"更坏"**）。
      改成 `sh -c '…'` 后同一组路径的真实读数是 `newest=39032107 10-04 10:11`。
      ⑦-b `node scripts/check-md-tables.mjs` 这个路径**不存在** ⇒ `MODULE_NOT_FOUND` 的 rc=1 被我读成"门禁红"；
      真门禁是 `scripts/check-md-table-rows.mjs`（`pnpm check:md-tables`），现量 rc=**0**。
      📌 一条通用纪律：**rc 要先证明它是被测那条命令的 rc** —— 打错路径的 rc=1 与门禁的 rc=1 在输出上长得一样。
      **⑧ 看守换班**：pid 38951 于 12:12:57 `GATE=预算用尽 rc=3` 退出（H 的判据 (a)/(b) 仍未喂到），
      12:18:49 起重跑一把 **pid 27489**（`BUDGET=5400 RUNS=3 STRICT_MAX=9`，日志
      `/tmp/ht-h-flaky.20261004-121849.27489.log`，稳定名 `/tmp/ht-h-flaky.log` 挂上=1，
      快照 bootstrap 生效 ⇒ 运行体是 `.h-flaky-window-watcher.sh.snap.27489`）。
      **严格层没有为了开窗降级**（12:12 那次"规范门过、严格层挡"就是降级的诱惑现场）。
      **⑨ 待入 traps（现在不插行）**：本轮两条可迁移的坑按台账纪律登记在这里，等 `docs/reference/environment-traps.md`
      干净时由收口的人按**当时工作树**的最大号往后取（12:2x 现量：该文件 ` M`、最大号 **235**、编号行 **244** ——
      两数不等=历史重复号，取号要 `sort -n`）。
      候选甲：**"牙"的检查跑在现场上 ⇒ 现场一坏，装置从"报红"退化成"不跑"**（对账装置的 selftest 对照腿复制被保护对象，
      对象一红它自己 `exit 4`，后面的臂一条没跑；输出上长得像"没跑到"）。
      候选乙：**常驻指纹要钉给被约束对象，不是钉给噪声**（给"每趟带随机值"的截图钉 md5 或钉"图片自己的提交号"
      ⇒ 别人重跑一次就红；正解钉**决定那张图形状的源码路径**的最后一次提交。两问：被约束对象什么都没改的那一趟它会不会红？
      我凭什么说这份字节稳定——有没有一次"重跑后逐字节相同"的读数？）。

   cc) 🔴 **12:3x 把"推迟的重验证"捡回来一半，另一半被一道既有闸门正确地挡住**（这是完成度审计里
      "这条线交付的东西在当前树上仍然成立"那一格，不是新工单）：
      ① 先按 §5 第 1 条量产物新鲜度 —— `node scripts/dist-freshness.mjs --only ui` ⇒ rc=**0**
      （`ui 产物比源码新 31064s`、落后 0 / 缺 0）。⚠️ 同一趟我先试了 `--only ui,web,mobile` ⇒ rc=**1**，
      而它红得**正确**：`web`/`mobile` 是 `apps/` 不是 `packages/`，体检器**响亮拒绝**而不是打印"0 个包 ⇒ 全新鲜"
      再退 0 —— 这条守卫就是本线当初为"空集合冒充绿"加的，本轮是它第一次被自己的误用触发。
      ② `pnpm --filter @heyta/ui test` ⇒ **exit 0**，`Test Files 31 passed (31)`、Duration 1.19s
      —— 年视图分桶 / 档位步进 / 日档算术那几族判据在**当前工作树**上仍然全过（此前最后一次读数是 03:2x 之前）。
      ③ `pnpm --filter @heyta/web test` ⇒ **exit 1，但一条用例都没跑**：日志 442 字节，
      内容是既有内存闸门 `tfa-shield` 拒绝启动 —— `已有测试在跑（pid=32680，锁 /tmp/tfa-test.lock；
      它是：pnpm --dir e2e exec playwright test tests/ai-breakdown.spec.ts）`。
      🔴 **没有用 `TFA_ALLOW_CONCURRENT_TEST=1` 绕过去**：那道闸的理由是并发测试会把整机推到 OOM（它自己写的），
      绕它 = 拿别人的运行换自己的一格读数，属于"为了让测试变绿而改测试"的同一族，只是换了对象。
      复跑（等那趟 e2e 结束）：`NO_COLOR=1 pnpm --filter @heyta/web test`，
      读数看 `Test Files`/`Tests` 两行 + `WEB_TEST_EXIT`（⚠️ 计数前必须 `NO_COLOR=1`，§7 #163）。
      📌 顺带一条与 H 直接相关的现量：**12:3x 有别人的 e2e 在跑**（`ai-breakdown.spec.ts`）⇒
      这既是 4318/4319 不空闲的原因之一，也是"证据 png 会被同名趟重写"的下一个来源。
      ⚠️ 同刻 `--selftest` 之外还量到 `@heyta/mobile` 没跑（同一道闸会同样挡）⇒ 记在同一格里，别当成已完成。

   dd) 🔴 **12:4x 楔住读数的"点名"会翻脸：那趟重装卡在什么上，两趟之间换了一枚进程**（本线装置的一处真缺陷，已修、有臂）：
      ① 现场：`research/tools/b-reinstall-readiness.sh` 在 12:41:57 打的是
         `叶子 pid=98935 … 卡在: tail -8`；同一时刻 `ps -o pid,ppid,stat,etime,time -p 98934,98935,98936`
         显示 `package-app.sh`(95477) 名下有**三枚同龄叶子** —— `notarytool submit … .dmg --wait`(98934) |
         `tail -8`(98935) | `awk`(98936)，etime 逐秒相同。12:42:42 我直接调 `ht_wedge_leaf 93817` ⇒ 点名 **98934 notarytool**。
      ② 为什么这不是措辞问题：那一句是**登记方式的唯一依据** ——
         `tail -8` 楔住 ⇒ 没有东西需要人拍板；`notarytool` 楔住 **9h29m**（累计 CPU 0:00.03，被公证的 dmg mtime 03:13）
         ⇒ 要持有者决定放不放弃这一次公证。同一个 🔴 档、两种下一步，而档位本身分不出它们。
      ③ 根因：`ht_wedge_leaf` 原来只有 `es -gt best_e`（**严格大于**）⇒ 同龄兄弟之间退化成
         "`pgrep -P` 先返回谁赢"，而返回顺序是实现细节不是现场事实。
         修成三级比较器 `ht_leaf_better`：**① 不是管道消费者 ② 龄更大 ③ pid 更小**，三级都显式比。
         消费者词表只认 argv[0]（`tail head cat awk grep sed sort uniq wc cut tr tee xargs jq`）；
         `sleep` **故意不在表里** —— 一次退避等待是合法的阻塞点，不是管道噪声。
         ⚠️ 因为分类器读 argv[0]，夹具里那枚 `tail` **不许 `exec -a` 改名**（改完它就不被判成消费者，
         臂会测不到它想测的那一格）—— 这句写进了 selftest 注释，注释掉的是"看起来一样的夹具"。
      ④ 有牙：`bash research/tools/b-wedge-mutation-arms.sh` ⇒ rc=**0**，**十条**读数
         （对照 + A–E 五臂 + 新增 **G/H** 两臂 + F1/F2 那对 source 守卫臂）；selftest 现量 `自检 29 条：全绿`。
         新增三腿 = 两条真进程腿（管道夹具：消费者更老也必须点名非消费者；反向腿：**全场只有消费者时不许变成"没有叶子"**
         —— 挡"整枚剔除"那种写反）+ 一条**纯函数腿**（比较器三级，期望串 `0101`）。
         🔴 纯函数腿不是装饰：**第三级 pid tie-break 在真进程上是隐形的** —— `pgrep -P` 本就升序返回，
         现场永远"先来者 == 小 pid"，把它摘掉两条真进程腿都不红（臂 H 现量只红 **1** 条，就是那串 `0101`）。
         三处期望条数都是**推出来再跑的**，且推中了实测：C 由 2 改 **4**（两条新腿都吃"取到叶子"）、
         G=**2**（管道夹具 + 比较器串）、H=**1**（只有串会红）。
      ⑤ 修完在真实现场连点两趟（12:4x）都点名 98934 ⇒ "要持有者拍板"那句登记第一次有可复现的点名。
         复跑：`bash -c 'source scripts/lib/wedged-runner.sh; ht_wedge_leaf 93817 >/dev/null; echo "$HT_LEAF_PID $HT_LEAF_CMD"'`
      📌 一般规律：**"取最深/最老的那一枚"这类选择必须写成完整比较器** —— 少比一级，那一级的结果就是工具的输出顺序。
         同族第一种面目是"恒绿判据"，这是第二种：**同一现场两趟给出不同的名字，而红/绿没变 ⇒ 没有任何门禁会报**，
         只有人把两趟输出并排看才发现。

   ee) 🔴🔴 **13:0x 本轮最贵的一条：本线的 C 链看守 `research/tools/r14c-window-retry.sh` 在工作树里被 revert 回 HEAD，
      我未提交的六项特征整片消失**（不是判据坏，是**被测代码没了**）：
      ① 现场形状：开跑 dd) 那批臂时 `r14c-boot-avd-arms` 打 `好 0 / 坏 8 rc=4`、
         `r14c-window-retry-arms` 打 `过 5 / 红 8`、`r14c-heal-fire-arms` 臂 9 `rc=3（要 4）`。
         三条一起红的共同原因不是负载、不是让路守卫（那两个我都查过并逐条否证），而是
         **现件只剩 118 行，而本线的实现是 293 行**。
      ② 三本账命中数（这是判定"我的未提交工作还在不在"的最低成本探针，复跑）：
         `for pat in regate 'BOOT=start' STABLE_TIED; do
             h=$(git show 'HEAD:research/tools/r14c-window-retry.sh' | grep -c "$pat")
             i=$(git show ':research/tools/r14c-window-retry.sh' | grep -c "$pat")
             w=$(grep -c "$pat" research/tools/r14c-window-retry.sh); echo "$pat HEAD=$h 索引=$i 工作树=$w"; done`
         ⇒ 13:1x 现量 `regate HEAD=0 索引=0 工作树=1`、`BOOT=start 0/0/1`、`STABLE_TIED 0/0/3`；
         行数 **HEAD=108 / 索引=108 / 恢复前工作树=118（=那 108 行 + 我 12:5x 刚加的那句 CO_PATTERN）/ 恢复后=293**。
         `git log -S 'BOOT_AVD' -- research/tools/r14c-window-retry.sh` **一条都没有** ⇒ 这一整层从未进过任何提交，
         所以"HEAD 里没有"不是证据，"工作树里没有"才是事故。
      ③ 丢掉的六项（都在 293 行那一版里，逐项现量）：开窗判据第二版（读 `REDS=` 机器通道 +
         `FIRE=apk-deferred`）、`maybe_boot_avd`（只红 dev/dev,apk 时起本线自己的 AVD，`-no-window`、不建 AVD、不起第二台）、
         开窗后 `regate` 重问闸门、载体自愈 `HEAL` 与 `exit 5`（窗口开了但同步失败 ⇒ 不起链）、
         `GATE`/`HEAL` 默认取**主检出**那份（10:4x 那条"载体 checkout 不同步工作树判据"的更正）、
         稳定日志名的 `STABLE_TIED` 守卫（11:3x task #6）。
         ⇒ 这一版一旦被 revert，C 链的行为退化成"永远等不到只红 apk 的窗、也不会有人起设备"——
           **正是我 07:2x 查出来并修掉的那两处自锁**，被 revert 悄悄装回去，而没有任何门禁会红。
      ④ 恢复路径（本会话唯一可用的源）：上一会话 transcript
         `/Users/rocalight/.qoder-cn/projects/…/bde4bb0b-1664-43c2-87d8-eaffcf8ef0f2.jsonl` 里
         那次 `wc -l` + 全文 cat 的读数（296 行 blob，**先验过无截断标记**），去掉两行头部噪声得到正文 ⇒
         `bash -n` 过、三个特征 needle 齐 ⇒ 备份现件到 `/tmp/ht-r14c-window-retry.pre-restore.sh`，
         再**同目录临时名 + `mv -f`** 原子替换（不 in-place 覆写：这文件会被 bash 逐行读，跑着的时候覆写会执行到半截坏码；
         替换前 `pgrep -fl r14c-window-retry` 现量为空）。
      ⑤ 恢复**没有**回退别人那三处：`35dbffe9` 的 `${MAIN_SHA}`/`${GATE_RC}` 大括号修正在 293 行那一版里已在
         （第 254/266/275 行现量都带括号）⇒ 那份 dump 晚于那笔 ⇒ 零行为回退。
      ⑥ 🔴 我自己的一条更正：dd) 之前我先写了一句"`CO_PATTERN` 是硬赋值 ⇒ 臂装置传的旋钮一直空转"。
         那句对**当时那份被降级的 108 行件**是真描述，但把它当成设计缺陷来"修"是错的 ——
         正确版本里那一行本来就是 `${CO_PATTERN:-…}`，还带 `CO_NAME` 派生的阳性对照。
         **是 revert 让旋钮看起来坏了**；恢复后我没有保留那处改写（它已被本版覆盖）。
         📌 顺序教训：**臂成片红，先问"被测代码还在不在"，再问"判据坏没坏"** —— 我这轮先修了三处臂/判据（dd)、T1/T2 基数契约、
         夹具跨度），那些修法各自也成立，但**真根因排在它们后面**；如果先做②那三行命中数对账，会一次到位。
      ⑦ 未闭合的一条（登记，不代做）：**这一版必须入库，否则下一次 revert 又会把它带走**（本会话无 `git add` 授权）。
         复跑判定：②的那条命令打出 `HEAD=0 工作树>0` 的每一行就是"还悬着"的一层。

4. **C（R14c 的 Android 真机腿）**。🟢 **23:5x 更新：那条脚本已经写出来了** ——
   `scripts/verify-mobile-due-time.sh`（604 行 / 14 step / 11 判据 + 3 对照，离线先验读数见过程账 §3·补 ⑩）。
   原写法仍然有效：bootstrap 在前 15 行（实测在第 3 行），`MANIFEST` 那一行**待插**
   （`scripts/check-script-snapshot.mjs` 正被并行会话 `M`；漏插**不会**让任何门禁红，
   该文件头自己写明它不查漏登记）。
   🔴 **12:3x 复跑 `bash scripts/verify-mobile-window-gate.sh --target c` ⇒ rc=3、`REDS=load,src,dev,apk`**
   （与 11:2x 那格**集合相同、内容不同**：dev 那格的 pid 已经从 9178 换成 16157 —— 设备面上是一条**接力**，
   不是一趟长活）。这一轮顺手把 dev 那格的**适用范围**量清了，因为它决定「能不能只等对的那件事」：
   现量 `pgrep -fl verify-mobile` ⇒ 只有 `scripts/verify-mobile-ios-reminder.sh`（`IOS_UDID=9DC7F824…`，
   **iOS 模拟器**），而 `adb devices` 里 `emulator-5554` **在线且空闲** ⇒
   **闸门的 dev 探针按 `verify-mobile-[a-z-]+\.sh` 认名字，把一趟 iOS 验收算成了安卓设备面的债**。
   ⚠️ 但**别把它读成「C 其实能开窗」**：同一格里 `reinstall-all`（pid 93817）是真冲突 ——
   它自己的提示原文就写着「它的 android 段会对同一台设备 adb uninstall」，而那一趟此刻卡在 mac 段的
   `notarytool submit --wait`（pid 98934，etime 09:10+ / CPU 0s），android 段**还没跑、排队中**
   （`/tmp/queue-reinstall-all.sh` 有两枚：81007 / 93771）。
   ⇒ 结论：**按平台分格不会解开今天的 C**，它的价值只是「别让 iOS 的趟给安卓的账背债」，
   归到下一批边界 #8（与 `src` 那格同族：措辞比取值范围宽）。C 的真 blocker 仍然是**要持有者拍板的那趟楔住的重装**。
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
   🔴 **02:1x 撤回上面那句"不必重打包"——同一条差集判据复跑一次就把它否证了。** 主检出那之后又走了
   若干笔（`93113e30 → 59f0ab45`），现量 `git diff --name-only 93113e30..HEAD -- <APK 输入面>` =
   **33 个文件**：`packages/i18n/src/locales/{en,zh-CN}.ts`、`packages/app-host/src/*`（6 枚）、
   `packages/storage/src/**`（8 枚）、`packages/sync-client/src/client.ts`、`packages/ui/src/sync/model.ts`、
   `apps/mobile/src/{db/op-sqlite-driver.ts,screens/VaultSettingsSection.tsx,sync/status-text.ts}` 与 iOS 原生两枚。
   ⇒ 01:05 那枚 APK **不再等于当前已提交代码**，直接装它就是 §7 第 27 条那个形状（验收对旧 bundle 报绿）。
   🔴 **更值钱的一点是闸门自己看不见这件事**：它比的 mtime 是"载体里的 APK vs 载体里的源码"，
   载体落后时两边一起旧 ⇒ `APK 不比源码旧` 仍然 ✅。**这道判据的作用域是一棵树，不是"当前代码"** ——
   所以第二版装置在开窗后**先把载体 checkout 到主检出的当前提交**，再走链（install → build → build:android → verify）。
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
   ⚠️ 一处**决定不改**的事（免得下一个人以为漏做了）：`:159-161` 那三个 `rid_*` helper 仍把 dump 路径写死成
   `/tmp/ui.xml`。不参数化的理由有两条现量：① 这是**仓内约定而不是本脚本的毛病** ——
   `grep -rl 'ui\.xml' scripts/*.sh | wc -l` = **9 个脚本**，`grep -rn 'ui\.xml' scripts/*.sh | wc -l` = **25 行**
   （两个数各报各的单位，别混）；只把本脚本这三个读端改成旋钮，等于把一条约定劈成两条。
   ② **写端不在本脚本里**：`dump()` 来自 `scripts/lib/mobile-e2e.sh`（同一串在该文件 **12 行**命中），
   而那条 lib 正被并行会话重构（00:2x 现量它的工作树 blob == HEAD blob，但那句话的保质期只到下一次有人落盘）。残留的并发覆盖风险已被**设备运行者探针**挡住（有别的移动端验收在跑时
   装置不会开火）。⇒ 真要统一，动作是"连写端一起改 + 一条门禁"，那属于 lib 那条线的范围，不记在本线债里。
   🔴 **02:1x：装置改到第二版**（就是上面那句"不必重打包"被否证逼出来的），四臂 + 同步臂 **6 条全绿**。
   新形状是开窗后**先同步再打**：`git checkout <主检出当前提交>` → install → `pnpm -r build` → `build_android` → verify。
   牙的读数（`bash research/tools/r14c-window-retry-arms.sh` ⇒ rc=**0**，「过 6 条 / 红 0 条」）：
   缺 `CARRIER` ⇒ **1**；`BUDGET=0` ⇒ **3** 且日志写 `WINDOW=timeout`；桩闸门回 **7** ⇒ 原样交出去（不洗白）；
   桩闸门回 0 ⇒ 载体**真的**落在目标提交（测试载体的 `marker` 从 `v1` 变 `v2`）+ `SYNC rc=0` + 同步之后才叫链。
   🔴 **第四臂的第一版是假绿，值得单独记**：我把测试里的 `MAIN` 也指回载体自己 ⇒ 两边 SHA 恒相等，
   「先同步」这条性质**根本没被走到**，而装置照样报绿。改成 **linked worktree 形状**（另一条路径、同一个对象库，
   与生产同形：真实载体就是主检出的 linked worktree，所以载体能 checkout 主检出的 SHA）之后才真的测到。
   ✅ 让路判据在真实压力下抓过一次：另一把看守（H 那条 Playwright）活着时，臂 3/4 各烧满 60s、日志写
   `CO_RUNNER=alive pid=92878 92881 —— 让路，本轮不起设备腿` ⇒ 串行是靠**观察对方进程**实现的，不需要对方也改代码
   （这就是边界任务 #7 的落地方式；#6 同时落了：日志名每跑唯一 + 稳定软链 `/tmp/ht-r14c-window.log`）。
   ⚠️ 那一趟超时转后台后**通知写 exit code 0**，日志里实际是 `ARMS_RC=1 / 过 2 条 红 4 条` —— 以日志为准（§7 #164）。
   🔴 **02:2x 又补了一道锁（第二版 v2.1）**：上一段那个 v2 在 `git checkout` **被拒**时照样往下走链 ——
   那时载体仍是旧树，接着打包 = 把 §7 第 27 条那个假绿重做一遍。现在同步失败直接 **exit 5**，
   日志写 `FIRE=aborted`，**不叫链、不动设备**。今天就同步得过（现量：载体那份 `scripts/verify-mobile-due-time.sh`
   与主检出当前提交那份 `cmp -s` **相同**），但载体工作树正带着这枚 ` M`，别人一改这个文件就会翻。
   六臂 ⇒ **八臂全绿**（`bash research/tools/r14c-window-retry-arms.sh` ⇒ rc=**0**，「过 8 条 / 红 0 条」）：
   新增第五臂要求"同步被拒 ⇒ rc=5 且链没被叫"。⚠️ 这一臂**第一版是假红，红在测试自己**：它写的是
   `checkout --detach "$V1" 2>/dev/null` 且**没取码**，而那次 checkout 被第四臂留下的状态拒了 ⇒
   载体根本没退回 V1，装置走的是"无需同步"分支 ⇒ 失败路径压根没被走到。补三条 setup 断言
   （丢弃改动成功 / 退回 V1 成功 / `HEAD==V1` 且 marker 已脏）之后才真的在测它。
   📌 一般形状：**测"失败路径"的臂，必须先断言那个失败前提确实成立** —— 否则它测的是另一条正常路径还报绿。
   现跑（第二版，3 小时预算）：`CARRIER="<载体>" BUDGET=10800 bash research/tools/r14c-window-retry.sh`。
   🔴 **02:3x 抓到一条会让整轮判据"绿在别人身上"的缺陷（链 + 闸门各改一处）**：
   `scripts/lib/mobile-e2e.sh:144` 是 `E2E_PORT="${PORT:-3000}"`，而现量 **:3000 上是别人的一枚 node 进程
   （pid 70256）**，:3100 空。于是原来那条链（`run stack_up bash scripts/mobile-e2e-up.sh` 不带端口）会
   在 3000 上起不来，而验收脚本只问 `${HOST_SERVER}/health` 有没有 `"status":"ok"` ——
   **别人的服务端照样回 ok** ⇒ 整轮四层判据是对着别人的服务端跑绿的。
   🔗 同一条假 pass 在闸门里也存在（`verify-mobile-window-gate.sh` 原来那段 `pass "服务端就绪（:3000/health）"`），
   而且它比链更阴：假 ✅ 不会让人去查，只会让人以为前置齐了。
   两处都改了：① 链现在按候选 `3100 3120 3140 3160` 挑**真的没人在听**的端口（`lsof -nP -iTCP:<p> -sTCP:LISTEN -t`），
   显式传入的端口被占就 `CHAIN_STOPPED_AT=port` **exit 4**，起栈后还要**断言该端口确实在听**（阳性对照），
   并把同一个 `PORT` **同时**传给起栈与验收（两边必须同源，否则一个起在 3100、一个去问 3000）；
   起栈失败也从原来的"只 `echo NOTE` 然后继续"改成停在 `CHAIN_STOPPED_AT=stack_up`（那 NOTE 等于白烧一个窗口）。
   ② 闸门里"服务端就绪"**不再计入前置**（默认只打一行 ℹ️ 并把 `:3000` 的监听者 pid 印出来）；
   要探某个端口就显式传 `HEYTA_GATE_SERVER_PORT`，那时 pass 的文案里会带上 `监听者 pid=`，让人能否证。
   三臂 + 两臂实测（全部用现场的真实占用做对照，装置 `PORT_ONLY=1`）：
   候选含 3000 ⇒ `候选 3000 已被占（pid=70256），跳过` 后选到 **3100**；显式 `PORT=3000` ⇒ **rc=4**；
   默认候选 ⇒ **3100**；闸门干跑（载体）⇒ rc=**3**、结论仍是 **2 条前置不成立**（负载 + 设备），
   而显式 `HEYTA_GATE_SERVER_PORT=3000` 那一臂打出 `✅ 服务端就绪（:3000/health，监听者 pid=70256）`
   —— 这一行就是旧代码会不加说明地给出的那条假 ✅。
   ⚠️ 归属仍要说准：窗口里那一趟跑的是 **HEAD 的产品码 + 未提交的链与闸门**（链调的是主检出那份
   `research/tools/r14c-carrier-chain.sh`）⇒ A 的点名清单现在多一份 `scripts/verify-mobile-window-gate.sh`、
   `research/tools/r14c-carrier-chain.sh`（两枚都已从"干净"变回 ` M`）。
   🟢 **02:3x 现量（窗口仍未开，但三条前置自己翻绿了）**：闸门五段逐条 ——
   §2 载体工作树 ✅、§4 凭据三件套 ✅（02:2x 还写"三者全无"，现在**有人起过栈并建过号**）、
   `:3000/health` ✅、`APK 不比载体源码旧` ✅；红的仍两条：**负载 20（复跑 33）** 与
   **设备上有运行者 pid=34829**。⚠️ 那条 pid **几秒后就退出且没留下名字**，此刻无法回查它是真验收还是别人的闸门 ——
   这不是空话：查它的时候发现了下面两个探针缺陷，**修完才分得开这两种**。
   🔴 **探针缺陷一（当场修，`scripts/lib/mobile-e2e-runner-probe.sh`）：自检末行"真实探针当前的读数"读的是那六行夹具文件**
   ⇒ 它**恒非空**，那一刻印 `11111`（夹具第一行），而设备上没有任何验收在跑 —— 一行永远报"有人占着"的读数
   比没有读数更坏（AGENTS §8.3）。改成读活 `ps`，夹具那行另加标签。两臂现量：喂一条真运行者
   （`bash /tmp/verify-mobile-probecontrol.sh`，脚本体只有 `sleep 20`）⇒ 印 **33395**，正是它自己的 pid；杀掉再跑 ⇒ 印 **''**。
   🔴 **探针缺陷二（同一枚文件）：`verify-mobile-[a-z-]+\.sh` 把 `verify-mobile-window-gate.sh` 也算成设备运行者**
   —— 而那份是**只体检、默认不动设备**的 dry-run 闸门 ⇒ 两条互相体检的腿会把对方看成"设备被占"，
   彼此等一个永远不开的窗口。加排除并给自检补第 7 条夹具（期望**不**命中）。变异现量：把排除摘掉（一次性副本
   `/tmp/ht-mut/probe-excl-off.sh`）⇒ 自检 **7 绿 / 1 红**、真退出码 **1**；未变异 **8 绿 / 0 红**、退出码 **0**。
   ⚠️ 改动只在 `--self-check` 那个分支里（`mobile_e2e_runner_lines` 对真验收的行为除上面第 2 条外零变化），
   且写盘走 `tempfile + os.replace` 原子替换 —— C 的 rig 每 60s source 这枚 lib，不许让它读到半截文件。
   ⚠️ 三处读数差点记错，形状都值得记：`${$?}` 在 zsh 里**不是**退出码（实测印 46546），要 `VAR=$?` 再读（§7 #45 同族）；
   `git status --porcelain` 的对齐看着像"本线文档被别人暂存了"，实际 `git diff --cached --name-only` = **0 枚** ⇒ 索引是空的；
   取负载写成 `sysctl -vm.loadavg` 会被 BSD 判 illegal option ⇒ 负载读数为**空**，正解 `sysctl -n vm.loadavg`。
   📌 **待入 traps**（03:1x 现量复跑：HEAD 尾号 **207**、活树尾号 **208**（那 22 行是别人刚追加的 #208，
   `git diff --numstat` = 22/0 ⇒ 台账**正在被写**）⇒ 落地时取**当时**活树尾号 +1，别照这里写的号）：
   ①"自检输出里那句'当前读数'必须读活现场，不许复用夹具变量"；②"只体检的 dry-run 闸门不许被算进资源运行者，
   否则 N 条互相体检的腿互锁"；③**新**："git porcelain 的前两列是 XY，用 `${line%% *}` 取状态码会在**第一个空格**处切断 ⇒
   `' M …'` 得到**空串**，`case` 里那条 `'M'` 分支**永远走不到**。它不会报错，只会让那一档分类**静默落到 `*)` 兜底**，
   枚数还可能恰好对（我第一版就是这样：印 `状态码 []` 却把 8 枚都算成"改动"）。正解取 `${line:0:2}` 并把 XY 原形打进输出
   —— **把不可达分支变成可见证据**；④**新**："一把变异/守卫臂若没打印出自己的判据段，它的退出码就不是读数"
   （本轮一把臂报 rc=0，而输出里连'索引'那一节都没有 ⇒ 臂根本没跑到那一腿；重做时打整份 stdout，别只 grep 关键词）。判"分支可达"的成本是一行输出，收益是这条判据从装饰变成判据（§8.3 同族）。
   ⑤**新（04:0x）**："不带引号的 heredoc 会把里面的反引号当命令替换执行" —— `cat >> "$LOG" <<HDR` 里写 `` `git checkout <主检出当前提交>` ``，bash 真的去执行它，报 `syntax error near unexpected token 'newline'` 到 stderr，而**脚本继续跑、退出码不变**，日志里那一行变成"开窗后先  再打产物"（命令文本被吞）。⇒ 与"双引号里的 grep pattern 含反引号会被命令替换"同族，这是**第三种载体**（heredoc 定界符）；它不会自己报案，只有读 stderr 或读那一行本身才发现。规则：**说明性 heredoc 一律 `<<'EOF'`**。   ⑥**新（04:0x）**："'脚本正在被人执行'不构成'现在不能改它'" —— bash 确实增量读脚本文件（原地改长度会打断运行中的那一趟，这条线为此等过一趟），但正解不是等它退出：**`cp` 出副本 → 改副本 → `mv -f` 原子替换**。运行中的 bash 握着**旧 inode** 的 fd 继续读完整旧文件，目录项被换掉不影响它。现量：swap 后真 rig（pid 78674）继续跑到 etime 1h36m 未中断，而新进程立刻用上了修好的两处；⇒ 同一形状适用于任何"别人 source 我的文件"的场景，写共享文件也要 tmp + `os.replace`。   ⚠️ 现在**不**直接追加进 `docs/reference/environment-traps.md`：它是多人台账，
   本会话里它的号段已被别人推过（#200–#203，现在到 #208），往正被写的台账里追加是本线踩过的形状。
   🟢 **H 的那条看守到期**：`GATE=timeout rc=3`，末行"等满 3600s 负载仍是 13" —— **有界窗口第四趟零新证据**，
   所以既不写"flaky 已确认"也不写"已排除"。**不再重挂第五趟**（等待本身不产出判据，而 C 才是这条线的硬缺口）；🟢 **03:4x 改由读代码推进，收获比四趟等待大** ——
"17.7s"是 attempt 时长不是渲染耗时（`expect` 默认 15_000，`e2e/playwright.config.ts:56`），
那一趟闸门 `load=9` ⇒ 持续性负载被削弱、`reuseExistingServer:false`（:77/:91）的每趟冷启动被加强，
而"日历分支模块树太大"这一支**被我数出来否证**（`packages/ui/src/calendar` 7 枚 + design-system 11 枚，`apps/web` 无 `React.lazy(`）；
剩下唯一待观测的是 vite 重新预打包 + 整页 reload（判别：`grep -c 'optimized dependencies changed' <那一趟 vite stdout>`），
修法定成"一次无断言 warm-up，不动 15s 预算"，并排除了两条捷径（`reuseExistingServer:true` 与调大全局 expect）。
全文在过程账 §3·补 ⑨·附；三条修法**都没落手**，因为 03:3x 现量别人一趟 `admin-console.spec.ts` 正占着 4318/4319。
   复挂命令：`cd <主检出> && BUDGET=3600 bash research/tools/h-flaky-window-watcher.sh`
   （日志 `/tmp/ht-h-flaky.log`，上一趟留在 `.prev`）。
   ⚠️ 顺带说清一件容易读反的事：C 的 rig 每轮打的 `CO_RUNNER=alive pid=92878 92881 —— 让路` **不是探针坏了** ——
   `CO_PATTERN` 默认值就是 `h-flaky-window-watche[r]`，那是**我写的互斥**（同一时刻只跑一条重验证，AGENTS §8.9）。
   看守退出后这一臂自己消失（02:36 起 §3 报的已经是别的 pid）。
   ⚠️ 还有一条别读成"C 可以直接开跑了"：`APK 不比载体源码旧` 那条绿的是**载体内部**的 mtime，
   而载体此刻停在 `93113e30`、主检出已经到 `27017ef0` ⇒ rig 在开火前先 `checkout --detach 主检出 HEAD` 再重打，
   这一条在 02:1x 已经撤回过一次，别再照着闸门那行的 ✅ 念。
   🔴 **02:4x：预检把第 4 层查出一个真缺陷，当场修在主检出这一份**（不占设备也不占 CPU —— 窗口随时会开，
   开火时才发现就白浪费一整趟）：`verify-mobile-due-time.sh:623` 那条"直接查 Postgres"原来写的是
   `psql … -U rocalight -d heyta_mobile_smoke … 2>/dev/null | sed`。两件事叠在一起：
   ① 库名与用户名是**字面量**，而仓内早有 env 约定、两处同级脚本已经在用（`verify-mobile-lists.sh:386`、
   `verify-mobile-notes.sh:460`），理由就写在 `lib/mobile-e2e.sh:57-61`；
   ② `2>/dev/null` 把失败吞成"什么都没打印"，而这一格**没有任何 `ok`/`bad` 依赖它** ⇒ 它是 §7 元规则二那一族
   **永远不会红的"判据"**，可台账此前把它算作四层里的"服务端那一层"。
   现在四参数走 env（默认值与原来逐字相同）+ `2>&1` + 形状断言（`数字|数字` 才算读到），读不到就 `bad` 并带出原始错误。
   两臂现场读数（只读 SELECT，没动设备）：默认 ⇒ `OK 服务端现场 ops|devices = 87|71（库 heyta_mobile_smoke @ 127.0.0.1:5432，用户 rocalight）`；
   `HEYTA_E2E_DB=heyta_mobile_smokf` ⇒ `BAD … FATAL: database "heyta_mobile_smokf" does not exist`
   （打一个字符的变异，与 `mutate-closeout-gates.sh:295` 用的同一个 typo）。
   ⚠️ 只断"读得到"、**不断条数**：这枚库是多条会话共用的（87 ops / 71 devices 里绝大部分不是本线写的），
   把具体数字写进判据就是把别人的现场当自己的前提。
   🔴 **但这条修复此刻到不了那趟开窗的运行**：载体（`93113e30`，开火时先 `checkout --detach 主检出 HEAD`）里那份 `:623`
   **仍是旧形状**（现量命中 1），而主检出 HEAD 也还没收这笔 ⇒ 开窗那一趟打印的第 4 层仍是旧形态，
   台账要把它记成**"打印，不是判据"**；判据形态的第 4 层要等 A 落笔之后才成立。这也是本线"代码链闭合 ≠ 产物/运行闭合"
   那条老形状的第三种面目。
   ✅ 顺带把最浪费窗口的那种红预检掉了：`git show HEAD:apps/mobile/src/screens/TaskDetailSheet.tsx` 在 `:710` 传
   `testID="task-due"`，`packages/ui/src/date-picker/DatePicker.tsx:328/346/370` 拼出 `-time-row` / `-time-input` /
   `-time-all-day`，两枚文件与 HEAD **零差异** ⇒ 拼装值 `task-due-time-input` 成立，不需要任何人的 WIP。
   ⚠️ 同趟静态门禁复跑：md-tables **0**、shell-unicode **0**（它当场抓到我新写那行的 `$PG_SERVER_STATS（` ⇒ 已补花括号 ——
   本会话**第二次**被这道门禁抓到同一族）、docs-link **1**（那 1 处不归本线，见 §4.1 的 02:4x 追加）。
   ⇒ **A 的清单第五次变**：现量 **7 枚 ` M` + 1 枚 `??`**，多出来的是 `scripts/verify-mobile-due-time.sh`
   （它是本线判据本体，必须与两份文档、探针 lib 同一笔，否则台账描述的判据与工作树里的判据不是同一份）。
   🔴 **同一族还有一个会在开窗那一刻咬人的假阳性，已经写进链头**：探针那条"闸门不算运行者"的排除只活在主检出，
   载体那份**没有**（02:4x 现量：`rest !~ /verify-mobile-window-gate` 载体命中 **0** / 主检出命中 **1**），
   而 `verify-mobile-due-time.sh:234` 正是用它做破坏性动作前的门 ⇒ **刚开窗就报"有别的验收在跑"时，
   先看那枚 pid 的 argv**：是 `verify-mobile-window-gate.sh` 就重跑第 6 步，既不是环境坏了也不是产品红了。
   ⚠️ 这条没有 env 逃生门（`another_mobile_e2e_running` 就是 `mobile_e2e_runner_lines` 的薄封装，无参 ⇒ 每次现跑 `ps`，
   快照文件也不能预置，因为无参那支总是重写它）—— 所以唯一的修法是让排除本体进 HEAD，也就是 A。
   🟢 **03:0x 现量：窗口第一次只剩一条前置**。第 38 次尝试五段全读数 ——
   负载 **12 ≤ 12 ✅**（本会话从头到尾第一次达标）、载体工作树 ✅、凭据三件套 ✅、`:3000/health` ✅、
   `APK 不比源码旧` ✅、MANIFEST ✅；红的只剩 **§3「设备上有运行者 pid=53342」**，而那一趟几秒后就退出了
   （03:02 现量：`ps -p 53342` 空、`pgrep -f 'verify-mobile-[a-z-]*\.sh'` 空）。
   ⚠️ 这句不许读成"设备没人用"：它读成"**有一条腿正在这台机器上跑，我的轮询恰好错过它**"。
   而 §3 报的是**真运行者** —— 闸门跑在主检出、用的正是刚修好的那份探针，dry-run 闸门已经不占这一格了。
   🔴 **同刻记一次差点读错的事，它比上面那条值钱**：我 tail `/tmp/ht-r14c-window.log` 读到
   `SYNC rc=1 / FIRE=aborted / ALL_DONE final_rc=5`，第一反应是"开窗了但载体同步失败"。
   真相是**变异臂把这枚稳定软链挪走了**：`ls -l` 现量它指向 `/tmp/ht-rigtest/l5`，
   里面那两个 SHA（`f45d8d1` / `aaaecea`）是迷你树夹具自己的提交号；真那趟一直在带 pid 的独有文件里
   （`/tmp/ht-r14c-window.20261004-022500.78674.log`，此刻仍在追加，44 KB）。
   📌 一般形状：**"每跑唯一 + 一枚稳定软链"这套命名，只要任何一把臂也走同一个默认路径，臂就成了稳定名的所有者** ——
   读的人分辨不出，因为两份文件格式一模一样，而臂的输出看起来比真跑更像"有结论"（它真的打印了 FIRE 与 final_rc）。
   ⇒ 临时动作：`ln -sf` 把软链指回真日志（只动指针，不动脚本本体）。
   🔴 **一条待办，此刻刻意不做**：`research/tools/r14c-window-retry.sh:28-30` 现在是"显式传 LOG 也照样挪软链"，
   正确形状是**只有用默认路径那一趟才允许 `ln -sf`**。真 rig 正在执行这枚脚本（pid 78674），
   而 bash 是**增量读脚本文件**的 ⇒ 现在改它会把正在等窗口的那一趟打断（§7 那一族），
   所以留到它跑完或到期再改；改完要在 `r14c-window-retry-arms.sh` 补第 9 条断言
   "跑完臂之后稳定软链没被挪走" —— 这条判据本身就是这次近失该换来的东西，而不是靠人记得。
   🟢 **03:3x：第 9 臂已写进 `r14c-window-retry-arms.sh` 并取到"修复前"基线** —— 现量 **过 10 条 / 红 1 条**：
   ①**臂 9 红**（"显式传了 LOG，装置仍然创建了稳定名"）⇒ 这条判据**确实会因那个缺陷转红**，不是装饰；
   ②**臂 9b 绿**（不传 LOG 时稳定名必须建，现量它指到 `…033408.63980.log` 并随即被这一臂自己删掉）⇒
   防止"改成永远不 `ln`"骗过臂 9；③**臂 9c 绿**（生产那枚 `/tmp/ht-r14c-window.log` 全程指向真 rig 的
   `…022500.78674.log`，2012 行仍在追加）—— 这是靠整套臂把 `STABLE_LOG` 改到夹具目录换来的，
   🔴 半边**不足以**证明装置修好了，所以臂 9 用夹具内的 `STABLE_LOG` 单独判装置行为。
   ⚠️ 装置本体 `r14c-window-retry.sh:28-30` 的那三行**仍未改**（真 rig pid 78674 正在执行同一枚文件，
   改长度会打断 bash 的增量读）⇒ 等它退出（预算 7200s，04:2x 前后）再改，改后臂 9 应从红转绿、合计 11 绿 0 红。
   ⚠️ 另记一次**我自己的 Edit 自伤**（同刻发生，如实写）：想以 `5. **A（入库）**` 那行当锚插内容，
   `old_string` 多吃了下一行的开头半句 ⇒ "把工作树整片吸了进去"被静默删掉、下一行以"，"开头。
   已按 `git show HEAD:` 的原文补回，现量 `git diff` 对该段**删除行数 0**、`check-md-table-rows` rc=0。
   📌 这条已在记忆里有过同族教训（`old_string` 含相邻块边界时 `new_string` 必须原样带回），
   本轮又犯一次 ⇒ 正确的做法是**插段用"上一段结尾 + 下一段开头"这种两侧都完整带回的锚**，或干脆走 python 的行号插入并断言前后行。
   🔴 **同一族的第三种面目（03:3x 又犯，代价最小但同样该记）**：`old_string` 末尾**带了一个换行**而 `new_string` 没带 ⇒
   正文一个字没丢，但**两行被并成一行**（这次是那两句自伤记录被接在了一起）。
   ⇒ 规则要写成形状而不是事故：**锚点两侧的行数必须相等** —— 少一个换行就是少一行结构，
   它不会被 `check:md-tables` 抓到（那是段落，不是表格），只会在人读的时候露出来。
   🟢 **04:0x 上面那条"刻意不做"当天闭合，而且闭合方式否证了我自己写下的理由**：
   原句写"真 rig 正在执行这枚脚本 ⇒ 现在改它会把正在等窗口的那一趟打断，留到它跑完再改" ——
   前半句对（bash 增量读），后半句错：**`cp` 出副本、在副本上改、`mv -f` 原子替换**就够了 ——
   运行中的 bash 握着**旧 inode** 的 fd 继续读完整旧文件，目录项换掉不影响它。
   ⇒ 现量：swap 后立刻复跑 `r14c-window-retry-arms.sh` ⇒ **过 11 条 / 红 0 条**（03:3x 基线是 10/1，
   臂 9 由红转绿，臂 9b/9c 仍绿，臂 9c 打印生产软链全程指向 `…022500.78674.log`）；
   真 rig pid 78674 改后仍在跑（etime 1h36m，未被打断）。
   🔴 同一枚文件里还查出**第二处同族缺陷**（是被这次复跑照出来的，不是先找再改）：
   `cat >> "$LOG" <<HDR` 的定界符**不带引号** ⇒ 里面那句 `` `git checkout <主检出当前提交>` `` 被当成命令替换执行，
   真实 rig 的 stderr 里就是 `syntax error near unexpected token 'newline'`，而日志第 2 行写成
   "开窗后先  再打产物"（**命令文本被吞了**）。修成 `<<'HDR'`。
   📌 记忆里那条"双引号里的 grep pattern 含反引号会被命令替换"至此有了第三种载体：**不带引号的 heredoc**；
   而且它**不影响退出码**（rig 照常跑了 90 次），所以只有去读 stderr 或读日志那一行本身才会发现 —— 这类缺陷不会自己报案。
   ⚠️ 一次**我自己读错文件**的读数（登记以免下一个人重踩）：我去 tail 后台任务的 stdout 文件数"第 N 次"行数，
   得到 **0**，差点写成"rig 一次都没跑"。看守把每次尝试写在**它自己的 `$LOG`**（`/tmp/ht-r14c-window.<ts>.<pid>.log`），
   任务输出只收 stderr。现量真日志：**2672 行 / `ATTEMPT` 80 条 / 全 rc=3 / `WINDOW=open` 0 条 / `CO_RUNNER=alive` 10 条**，
   最后一次 `第 90 次 03:53:53`。
   🟢 **04:0x 现量（第 89–90 次）**：红的仍只有两格 —— §3 设备独占（**pid 24578 = `scripts/.verify-mobile-ios-reminder.sh.snap.24578`**，
   即并行那条线正在跑 iOS 提醒的设备验收）与 §1 负载（03:53 现量 `vm.loadavg` = **11.31** 11.29 13.47，阈值 12，**此刻恰好压线**）；
   §2 载体工作树 / §4 三条外部前置 / §5 MANIFEST **全绿**。同刻另一条线在 `heyta-wt-reinstall` 里跑 Playwright（pid 23472 等）
   ⇒ B 与 C 抢的是**同一张设备面**，顺序仍按第 3 条写的 C→B。
   🔴 **本轮把 C 的证据强度补了一层，而且它不是"再等 A"**：`r14c-window-retry.sh` 开窗时只把**载体**
   `checkout --detach <主检出 HEAD>` ⇒ APK 打的是当前提交，**但 `scripts/verify-mobile-due-time.sh` 在载体里是那个提交的已提交副本**，
   本线这轮写进主检出**工作树**的四层判据一条都不在里面。03:5x 逐字节现量（载体 93113e30 工作树副本 vs 主检出工作树）：
   载体独有 **3 行**、主检出独有 **14 行**，而载体那 3 行正是第 4 层的**纯打印版**
   （`psql … 2>/dev/null | sed 's/^/      ops|devices = /'` —— 读不到也照样绿），主检出那段（`:626-635`）才是带 `ok/bad` 与退出码的判据版。
   ⇒ 链新增**第 0 步点名覆盖**（`research/tools/r14c-carrier-chain.sh`）：4 枚判据/探针脚本从主检出工作树 `cp` 进载体、
   逐枚 md5 对账、覆盖前先备份、**跑完逐枚还原**（还原用备份而不是 `git checkout --`，后者会连别人在载体里的未提交状态一起抹）；
   覆盖清单点名 `packages/` `apps/` `server/` 会被第 0 步自己拒绝；打包前先断载体产品目录**零脏**（否则就是 §7 #27 那一族）。
   这把 §7 第 82 条的"远端字节 == 本地工作树"搬到了载体上，形状相同、只是距离短了一台机器。
   🔴 **原句撤回（写在链文件头里，也写在这里）**：链头 02:4x 曾写"排除本体在主检出，**要等 A 落笔才进得了载体**" ——
   被第 0 步否证：不必等提交也能让那一趟用当前判据。留原句是为了认形状：**"这件事必须等入库"多半是"我没找到不动索引的办法"**。
   🟢 **第 0 步的有牙先验（新增 `research/tools/r14c-chain-overlay-arms.sh`，合计 rc=0）**：
   C0 对照（真实载体 + `PORT_ONLY=1`，跑到挑端口就退出、不打包不动设备）⇒ rc=**0**、`OVERLAY` **4** 行、`RESTORE_DONE` **1** 行、
   **覆盖前后逐枚 md5 相同**（`87a7f4bf…` 未变）、载体 `status --porcelain` **逐行相同**；
   三臂都在 `git clone` 出来的隔离副本里跑（真实载体不碰）：
   A1 清单点名一枚主检出不存在的文件 ⇒ rc=**5** 且哨兵指名"主检出缺 …⇒ 清单过期"；
   A2 清单点名**产品代码** `packages/domain/src/index.ts` ⇒ rc=**5** 且 `OVERLAY` 行数 **0**（拒绝发生在动手之前，这条腿是"它没顺手先拷"的证据）；
   A3 克隆的 `packages/` 注入一行脏 ⇒ rc=**5** `carrier_dirty` 并列出"仍脏："那一行（只停不报现场 = 下一个人还得重新找）；
   A4 还原后克隆里对照 ⇒ rc=**0**、`OVERLAY`=4、`RESTORED|REMOVED`=4，且**已存在的那枚没被删**、覆盖前不存在的那枚没留下。
   为让这三臂能在隔离副本里试，第 0 步的清单加了 `JUDG_PATHS_OVERRIDE`；
   🔴 但"点名产品代码"那条守卫**不认来源**，覆盖也越不过去（A2 就是测这件事）。
   🟢 **判据拷贝对账现在有牙了**（新增 `research/tools/r14c-drift-teeth.sh`，rc=**0**）：未变异对照 rc=0 且对账行 = `OK 两份逐字相同`；
   D1 只改第二份的 SQL ⇒ rc=**1** 且归因 `内容漂移在:SQL`；D2 只改形状正则 ⇒ rc=**1** 且归因 `内容漂移在:形状正则`；
   D3 删掉第二份文件 ⇒ rc=**4**「前提不成立」而**不冒充漂移**。
   🔴 这是对上一轮那次"刀没落地却写下转红结论"的**直接更正**：每条臂现在有**两道**落地断言
   （替换前 `count(needle)==1`、写后回读 `count(repl)==1 && count(needle)==0`），不成立就 **exit 4 并整臂跳过**，
   既不计绿也不计红 —— 上一轮的结论就是这么被静默造出来的。
   🟢 **04:0x 三道静态门禁现量**：`check-shell-unicode-vars.mjs` 首跑 **rc=1，8 处**，
   而且**全部落在我这几轮新写的 4 枚脚本里**（`$p（` / `$NO（` / `$CTRL_RC）` / `$PWD（` 这些形状，同族第四次犯）⇒
   逐处改 `${var}`（原子替换、每处 `count==1` 前提断言、任何一处不符就两份都不写）后 **rc=0**（扫 96 个 .sh）；
   `check-md-table-rows.mjs` **rc=0**（9 个文件）；改完把三套 rig（drift-teeth / chain-overlay-arms / install-guard-arms）
   **各重跑一遍**都 rc=0 —— 门禁绿不等于装置没被自己改坏。
   ⚠️ `install-guard-arms` 的对账探针补了一条**前提档**：开跑时逐个 `[ -f ]` 验两枚拷贝在不在，缺 ⇒ exit 4。
   上一轮"探针坏了报成被测物坏了"的形状就是靠 stdout 为空反推出来的，那是**归因**不是**判据**；
   D3 臂就是这条新档的阳性对照（它现在稳定回 rc=4 而不是 rc=1）。
   🔴 **04:0x 现量（A 那一格，前一读数已过期）**：`bash research/tools/calendar-line-commit-plan.sh` 干跑 rc=**1** ——
   待入库 **14 枚**（` M` 8 / `??` 6，比 03:2x 的"12 枚"多了本轮两枚新 rig 与本体自记），
   而索引里 **7 枚**已暂存路径（上一读数 8 枚：iOS 钥匙串那条线自己提交掉了一枚 ⇒ **枚数每次现取，别抄**），
   剩余 7 枚逐一点名归属：5 枚 `apps/mobile/evidence/ios-keychain-probe-*.json` + `scripts/check-ios-native-bridge-names.mjs`
   + `scripts/verify-ios-vault-keychain.sh` ⇒ 全部在 **iOS 原生桥 / 钥匙串那条线**手里。
   本工具不动别人的索引（exit 1 是设计）；有提交权那一轮的动作仍由它自己打印，且 `--confirm` 需要显式 `MSG`。
   🟢 04:0x 现量（B 的前置①，第三次翻回红）：`git status --porcelain -- packages/op-log` =
   ` M packages/op-log/src/engine.ts` + `?? packages/op-log/tests/op-log-count-reads.spec.ts` ⇒ **仍在别人手里**。
   🔴 **04:2x：C 那一侧的 §3 也有同一个空档，同一趟补上了。**设备独占探针的正则只认
   `verify-mobile-[a-z-]+\.sh` ⇒ 对 `reinstall-all` **失明**。现量就是那一刻：c 分支打印
   「✅ 粗筛没有别的移动端验收在抢 emulator-5554」，而同一台模拟器上有一趟真 reinstall 正在
   `adb uninstall` 同一枚包（pid 93817）。**C 的链差一点就往一台正在被卸装的设备上装 APK。**
   ⇒ `reinstall_other_pids()` 抽成 b/c 共用（不各抄一份 pgrep 正则），补臂 T5 钉住「c 分支也认得这一形」；
   补完现量：c 分支 §3 = 「粗筛 ✅（无 verify-mobile 运行者）」+「❌ 有另一趟 reinstall-all 在跑（pid：93817）」
   +「emulator-5554 在线 ✅」⇒ **C 现在被那一趟 B 挡着**，而这正是这道门该报的东西。
   📌 形状上值得留一句：**「探针没报东西」不等于「设备面是空的」** —— 前者是某条正则的搜索结果，
   后者才是判据；用前者的字面去断后者，换一种运行者名字就会静默失效（本线同一天第三次撞这个形状：
   testID 是拼装的、mtime 不等于产物对、探针正则不等于设备面）。
   🔴 **05:2x 那句话已按它自己的判据兑现**：看守（pid 78674）**预算用尽、窗口从未开过** ⇒
   `WINDOW=timeout（10800s 用尽，共 181 次）05:25:19` + `ALL_DONE final_rc=3`（exit 3 = 环境无效，不是产品失败）。
   收尾时两个账对不上：`----- 第 N 次` 轮头 **181** 行而 `ATTEMPT` 只 **171** 行 —— 差的 **10** 行是
   `CO_RUNNER=alive`（让路给另一条重验证，那一轮**不跑闸门**所以不发 ATTEMPT），**171 + 10 = 181 逐条对上** ⇒
   那句"共 $N 次"数的是**轮**，不是"跑过闸门的次数"；引用它的人若按 ATTEMPT 行数反推会少算 10 轮。
   05:28 用本轮 `mv -f` 换上的那份**重挂**（`CARRIER=heyta-wt-r14c BUDGET=7200 INTERVAL=120`，
   间隔从 60s 放到 120s 是为了把探针自己的负载减半 —— 负载这一格本来就长期压线）。
   重挂前现量（`bash scripts/verify-mobile-window-gate.sh --target c`，**不用管道**）：rc=**3**、4 条前置不成立 ——
   §1 负载 `{ 14.92 18.36 20.12 }`（阈值 12）、§3 外部 reinstall pid 93817 已跑 **2h15m** 仍在跑、
   §4 APK `02:46:37` 比最新源码 `03:44:27` 旧（mtime 判据，§7 #27 那一格）+ 载体工作树一批别人未提交文件、
   §5 MANIFEST ✅。⚠️ 这一趟又当场复现了 §7 #184：`... | tail -30; echo ${PIPESTATUS[0]}` 在 zsh 里输出**空串**
   （不是 bash 的数组下标），补跑不带管道才拿到真 rc=3。
   🟢 **03:2x 现量（第 42–44 次尝试）**：红的仍是同两格 —— §1 负载 **13/17/19 > 12** 与 §3 设备运行者
   （pid 在 30 秒内轮换 `65645 → 4450 → 6868`，说明**有一条腿正在连续跑设备验收**，不是"错过一次"）；
   而 §2 载体工作树、§4 三条外部前置、§5 MANIFEST **全绿** ⇒ 窗口只差"负载 + 别人停手"两件事。
   🔴 **本轮给 C 补了一条它原来没有的判据**：闸门 §4 那条 `APK 不比源码旧` 量的是 **mtime**，
   而 mtime 只证"打的时间在后面"，不证"产物里确实有这次判据要选的东西" —— 正是 §7 #27 那一族的空档。
   新增 `research/tools/r14c-bundle-testid-preflight.sh`：从 APK 解出 `assets/index.android.bundle`
   （现量 **5,931,080 B**，APK sha256 前 12 `fb1c05ef8eb1`、mtime 02:46），
   判**拼装三碎片同时在场 + 一枚负对照必须 0 命中**。现量读数：
   `task-due`=1、`-time-input`=1、`-time-all-day`=1、负对照 `task-due-time-inputZZz`=0 ⇒ **主跑 rc=0**；
   四条臂各红各的档：缺碎片 ⇒ rc=**1**（并指名缺哪枚）；把负对照换成在场的串 ⇒ rc=**3**（"探针什么都命中"这条腿有牙）；
   APK 不存在 ⇒ rc=**2**；`BUNDLE_ENTRY` 写错（解出 0 字节）⇒ rc=**2**（输入不成立，不冒充判据红）。
   🟢 **10:3x 逐字复现**：主跑仍 rc=**0**，APK `sha256 前 12=fb1c05ef8eb1` / `mtime 02:46:37` / bundle 5,931,080 B
   三个数与上面那份**完全相同** ⇒ 这段产物腿到此刻没有被别人的构建挪走（对照：同一天 mac 那侧 dist 哈希换过一次）。
   🔴 **同一次复跑照出这个文件自己的头注释在撒谎**（已就地修，判据逻辑一字未动）：
   第 22 行写着"自检：`NEEDLE_MISSING=task-due …` 必须让它 exit 1"，而 `NEEDLE_MISSING` **全仓只出现在那行注释里**
   （代码读的旋钮是 `FRAGMENTS`，第 31 行）⇒ 照文档跑那条自检会得到 **rc=0 且照样打印"三枚碎片都在"**，
   也就是一条**永远不会被跑到的假自检**。真旋钮的形状现量 **exit 1** 并指名缺的那枚：
   `FRAGMENTS='task-due|-time-input|task-due-NOPE-9f3' bash research/tools/r14c-bundle-testid-preflight.sh`。
   文件新 md5 `c0023a0c47f5b331b4471978a3ef5f59`；改前后平态都 rc=0、注入臂都 rc=1；
   载体链臂 `bash research/tools/r14c-chain-overlay-arms.sh` 复跑 **rc=0**（推导枚数 6 == 实量 6）。
   📌 与 §6 第 27 条同一条：**台账/文件头里每条"照这句做会得到 X"都是一条断言，写之前当场跑一遍。**
   ⚠️ **为什么判碎片而不是判整串**：整串 `task-due-time-input` 在源码里**根本不存在** ——
   `apps/mobile/src/screens/TaskDetailSheet.tsx:710` 只给 base `testID="task-due"`，
   后缀由 `packages/ui/src/date-picker/DatePicker.tsx:346/370` 拼（`-time-input` / `-time-all-day`）。
   本轮我先按整串 grep bundle ⇒ **0 命中**，差点据此判"APK 里没有"（待入 traps #190 那一族的**第二次**撞法：
   上一次是 grep 源码字面串假阴性，这次是 grep 产物字面串假阴性）。
   脚本里因此补了一条**拼装等式自检**：若整串反而直接在场，就改判整串并打 ⚠️；
   若某枚碎片缺席，那行等式**不打印**（第一版照样打了"靠上面碎片在场"，那是一行在缺件时会说谎的话）。
   ⚠️ **这条预检替代不了真机腿**：它证的是**产物**，界面上画没画只有设备能答（§6.2 规定一）。
   🔴 **也刻意还没把它接进闸门 §4**：gate 每 60s 被 rig 拉起一次，虽然单次调用是短命进程、
   原子替换原则上安全，但新判据若有 bug 就会把 C **永久**挡在窗口外 ⇒ 等 rig 退出（预算到 04:2x）后再接，
   接线时同批补 `r14c-install-guard-arms.sh` 的对应臂。复跑：`bash research/tools/r14c-bundle-testid-preflight.sh`
   ⇒ **A 此刻 8 枚 ` M` + 2 枚 `??`**（⚠️ 03:1x 已是 **8 枚 ` M` + 4 枚 `??` = 12**，现量命令与归属见下面第 5 条）：两份文档、`scripts/lib/mobile-e2e-runner-probe.sh`、
   `scripts/verify-mobile-window-gate.sh`、`scripts/verify-mobile-due-time.sh`、
   `research/tools/{r14c-carrier-chain.sh,r14c-window-retry.sh,r14c-install-guard-arms.sh}` 这 8 枚 ` M`，
   加 `r14c-window-retry-arms.sh` 与 `shell-unicode-independent-scan.py` 这 2 枚 `??`。
   🔴 **06:0x 现量（`NO_COLOR=1 bash scripts/verify-mobile-window-gate.sh --target c`，非管道）rc=3**，
   五 ✅ 三 ❌：负载 **7 ≤ 12 ✅**（05:2x 那趟是 61 ❌ ⇒ 这一格真的在漂，45 分钟就反向）/
   emulator-5554 在线 ✅ / 凭据三件套 ✅ / 粗筛无别的移动端验收 ✅ / MANIFEST 已登记 ✅；
   ❌ 别人未提交源码 74 枚、❌ **另一趟 reinstall-all（pid 93817）在跑**（c 那格的措辞是
   "它的 android 段会对同一台设备 adb uninstall"，与 b 同源不同句）、❌ APK 比源码旧。
   ⇒ **C 的阻塞与 B 是同一个根**（那趟卡在公证的重装），不是两件事；那一个解开，这两条同时松开，
   剩下"重打 `@heyta/ui` + `build:android`"才是本线自己的活。
   ⚠️ 负载这一格现在**不再是** C 的前置阻碍 —— 05:2x 那份"负载 61"已过期，别照它排下一步。
   🔴 **06:2x 查出一条洞，而且它长在"我这轮刚补的互斥"旁边**：本会话把**同一把 C 看守挂了两次**
   （05:28 那把 `BUDGET=7200 INTERVAL=120` 还活着，06:19 我又起了一把 `BUDGET=5400`），
   而让路判据的 `CO_PATTERN` 里只有 **H 那把看守**（`h-flaky-window-watche[r]`），**不含自己** ⇒
   两把都会各自等到开窗、各自起一次设备链 = 同一台 emulator-5554 上并发 install、同一载体里并发 checkout
   （AGENTS §8.9 禁止的那种互抢）。📌 我补了「H 让 C」，却没想到「C 也要让 C」——
   **判"谁在跑同一份资源"要按资源枚举，不是按"另一种装置"枚举**。
   处置：停掉 06:19 那把（本会话自己的进程，不动别人的现场），把稳定名 `/tmp/ht-r14c-window.log`
   指回那把活着的（`ht-r14c-window.20261004-052841.28660.log`），并给装置补一条**同类独占**前提：
   `SELF_GUARD`（默认开）+ `PEER_PATTERN`（默认 `r14c-window-retry[.]sh`），排除自己 `$$` 与包装父进程 `$PPID`，
   见到同类就 **exit 6**（新增退出码，文件头码表同批补一行）。三腿现量：
   A 真同类在场 ⇒ rc=**6** 并点名 pid 28658 28660；B `SELF_GUARD=0` ⇒ rc=**3**（进到了轮询循环）；
   C 守卫开着、模式换成必不命中那枚 ⇒ rc=**3**（证明拦下来靠的是模式，不是一条无条件失败）。
   ⚠️ 三腿都显式传 `LOG=`，所以都没动稳定名 —— 那条旋钮本轮是第二次救场（第一次是别臂的夹具差点顶掉台账指针）。
   ⚠️ ~~现在等窗口的只有 05:28 那把（预算到 07:2x），而它跑的 `GATE=$CARRIER/scripts/verify-mobile-window-gate.sh`
   是**载体里那份旧闸门**（载体停在 `93113e30`）⇒ 它打印的"下一步"仍是无条件那版。
   **不影响判据，只影响建议文案**；按旗标那版要等载体同步之后才在这条链上生效。~~
   🔴 **这三句在 06:5x 被逐字对照否证，留原句是为了让后来者认出这个形状**：
   载体那份缺的不是文案，是 `reinstall_other_pids` 那一整条探针（它认 `.reinstall-all.sh.snap.<pid>` 那形 argv）——
   也就是说**开窗判据本身看不见"正有一趟重装在同一台设备上 `adb uninstall`"**，
   这正是 §8.9 禁的那件事。⇒ 已把 `GATE`/`HEAL`/`CHAIN` 三个默认值都指到**主检出**那份，
   理由与"链为什么拿主检出那份"是同一条：**前置判据也在载体同步范围之外**（§6 第 19 条）。
   🟢 **07:1x–07:3x 增量（C 侧），五条**：

   1. **`BOOT_AVD` 那一手在真机器上跑通过一次**（不是臂）。07:0x 现量：看守在"只红设备"那一趟真的把
      `heyta-w3-yearly` 以 `-no-window -no-boot-anim -no-audio -no-snapshot-save` 起起来了
      （07:18 现场 `pgrep -fl emulator` 里那枚 `qemu-system-aarch64-headless -avd heyta-w3-yearly …` 就是它，
      pid 83033），`adb devices` 随后报 `emulator-5554 device`。
      ⚠️ 这是一笔**探针留下的状态**（§7 第 83 条那一族）：那台模拟器现在还在跑，
      下一个用这张设备面的人读到的"设备在线"是本线起的。核：`pgrep -fl 'emulator -avd'`。
   2. **查到并修掉两处"开窗条件结构性永假"的自锁**（都属于 §8.3「永远不通过的判据」一族，
      但成因不是解析坏，是**把开窗动作自己造出来的红当成别人的红**）：
      - ① 载体每 `checkout` 一次，它自己的源码 mtime 就刷成"现在"，而 APK 是上一次打的 ⇒ 闸门恒红 `apk`；
        而链只在闸门回 0 时才起 ⇒ 永远开不了窗、也永远打不出那个 APK。
        ⇒ 看守的开窗判据改成 `rc=0` **或** `rc=3 且红集恰好只有 apk`（日志打 `FIRE=apk-deferred`）。
      - ② 起模拟器那一手原来要求"红集里除设备之外没有别的"，可 `apk` 那一红恰恰只有开窗之后才消得了
        ⇒ 设备离线 + 载体同步过的现场里这个环闭上了。⇒ 允许与 `dev` 并存的红**只有 `apk`**；
        `load`/`src`/`cred` 仍一律"没到门口，不动设备"。
   3. **红集换成了机器可读通道**：闸门在结论处打一行 `REDS=load,src,dev,cred,apk` 的子集
      （由那五条 `WHY_*` 旗标投影，**不是第二套判据**），看守与链都读这一行，不再数 `❌`。
      现量 07:3x：`REDS=load,dev,apk` 而 ❌ 有 **4** 条（`有移动端验收在跑` 与 `有另一趟 reinstall-all 在跑`
      同挂 dev）⇒ **条数天生不能互推**，这也是文档里那条"建议清单要按旗标输出"的另一半。
      缺 `REDS=` 行 = 拿的是旧版判据 ⇒ 看守 `exit 4`，不当成"没有红"。
   4. **链里加了第 6 步 `regate`（动设备那一刻再问一次同一条闸门）**：开窗判据量的是几分钟前，
      中间隔着 `pnpm -r build` + `pnpm build:android`；而 `FIRE=apk-deferred` 那句承诺
      （"链会自己把 APK 打新"）**只有在这里被同一条判据再量一次才算数**。
      红就停在 `CHAIN_STOPPED_AT=regate`，不进设备面；只有 `load` 一条红时给它最多 3 次、每次 60s 的落位机会
      （那一分钟负载里有我自己刚打的那一发 build —— 阈值不动，动的是"等谁"）。
      闸门那份走**第 0 步的点名覆盖清单**（`JUDG_PATHS` 新增 `scripts/verify-mobile-window-gate.sh`），
      于是"哪一份判据在跑"是带 md5 对账与跑完还原的，不是靠调用路径隐式决定。
      ✅ 加完这一步**静态查过它不会变成第三处自锁**（第 20 条那一族的自查）：
      §2 只扫 `packages apps server`（`verify-mobile-window-gate.sh:116`），而第 0 步的覆盖件全在
      `scripts/` 与 `research/tools/` ⇒ 覆盖状态不会让它恒红；§3 的 dev 探针在 `verify` 之前不会命中链自己；
      §4 的 APK 腿正是这一步要消掉的那条红（`build_android` 排在它前面）。
   5. **读数**：`r14c-boot-avd-arms.sh` 好读数 **8 条 / 坏 0**（新增臂 3c：`dev,apk` 并存时必须仍进启动分支）；
      `r14c-heal-fire-arms.sh` 五臂（5–9）全过、临时 worktree 收到基线 14；
      `r14c-carrier-heal.sh --selftest` 改完 unicode 后复跑 `rc=0`（臂读数 1=1 2=1 3=1 4=1）；
      **变异一趟**：把 `"$GATE_REDS" = apk` 换成恒真 ⇒ 五臂里**恰好臂 8 转红**且它三条读数全翻
      （`rc=0（要 3）链调用=1（要 0）apk-deferred 命中=1（要 0）`），文件 md5 事后逐字回到变异前。
      ⇒ `FIRE=apk-deferred` 不是万能钥匙，`dev`/`cred`/`load`/`src` 任何一条红都照样不开窗。
      复跑：`bash research/tools/r14c-boot-avd-arms.sh; echo RC=$?` ／
      `bash research/tools/r14c-heal-fire-arms.sh; echo RC=$?`（后者会建一次性 worktree，链是桩，不碰设备）。
   6. 🔴 **改判据要按"谁引用了这份输出"枚举一遍**（§7 第 167 条那一族，07:5x 现量扫的）：
      `REDS=` 那一行插进结论块之后，把闸门的三个消费者全跑了一遍 ——
      `r14c-gate-hint-arms.sh` 与 `r14c-gate-b-exclusive-arms.sh` 当场 rc=0（它们抽的是建议行原文，加一行不影响），
      但 **`r14c-window-retry-arms.sh` 六臂转红**。红因**不在被测装置，在夹具过期**，而且是三处叠的：
      ① 迷你载体里没有 `r14c-carrier-heal.sh` ⇒ 装置进循环**之前**的存在性检查 `exit 4`；
      ② 桩闸门没打 `REDS=` ⇒ 新的"缺通道按装置坏"腿把它判成 `exit 4`；
      ③ 这套臂没传 `SELF_GUARD=0` ⇒ 与 07:3x 重挂的那把活看守撞互斥，`exit 6` 且**一个日志文件都不建**
      （`tail: l4: No such file` 就是它的指纹；boot-avd 那套臂 07:07 栽过同一处，当时修在那一套里，**没扫这一套**）。
      ⇒ 三处补齐（夹具加 heal 桩、桩打 `REDS=${STUB_REDS-load}`、七处臂统一 `SELF_GUARD=0`），
      并新增**臂 10/10b**：闸门 rc=3 而不打 `REDS=` ⇒ 装置 `exit 4` 且链一次都不叫。
      现量 `合计：过 13 条 / 红 0 条`，`rc=0`。⚠️ 臂跑之前先把载体清回 V1 再 detach ——
      顺序反了会撞上本线那条老账（工作树脏着且两提交之间会变 ⇒ `checkout --detach` 直接拒）。
   ⚠️ **07:2x 现量：三条红还在**（`REDS=load,dev,apk`；负载 29>12、`verify-mobile-*` pid 45615 与
   重装 93817 都在跑、APK 01:05 比源码 06:53 旧），看守已按新判据重挂（`b48ic6gdc`，
   `CARRIER=<heyta-wt-r14c> BOOT_AVD=heyta-w3-yearly BUDGET=7200 INTERVAL=90`）。
   🔴 重挂的理由（07:4x 更正过一次，原句在 §6 第 22 条）：我在它活着的时候改了 `r14c-window-retry.sh`，
   而**换 inode + rename** 那一种改法不会打断它 —— 它只是还在跑**改之前那一份**（日志末行当时仍是旧串就是这个意思）。
   ⇒ 改了要生效就得**重挂**，并读新日志第一趟确认是新形状；不需要"等它跑完才敢改"（§6 第 22 条）。
   ⚠️ **本批刻意不往 `docs/plans/calendar-year-time-and-mobile-profile.md` §4 那张表追加行**：
   07:4x 现量那张表所在文件带 **91 行未提交新增 / 5 行删除**（别人正在写，其中 07:05/07:22/07:30 三行是刚落的），
   往一张正在被别人整片改的表里塞一行，代价是"要么被他们的整文件 `git add` 抹回去、要么替他们承担归属"。
   那一条判断的正文已经在本文件 §6 第 20 条（恒红的前置 = 结构上开不了窗），
   **等 A 落笔之后**由收口的人补那张表的行，命令形态照旧：先在文件里找表格末行、按行 splice、
   补完立刻 `node scripts/check-md-table-rows.mjs`（列数判据），别手拼在行尾竖线之后。
   🔴 同批一条自伤，记下来是因为它**跑起来是对的**：新写的 `research/tools/r14c-gate-hint-arms.sh`
   被 unicode 门禁抓到 5 处 `$var` 紧跟全角（`$SRC）`、`$HIT（`、`$MISS（`、`$a：`），
   而本机 `LANG` 为空 ⇒ 臂实际打印出「抽到 5 行建议原文…」完全正常。
   这正是 §6 第 17 条那句「这一族的触发条件是 locale」的**第二次现场命中**：
   "在我这个 shell 里跑对了"不构成不修的理由，门禁红就要修（已改 `${...}`，复跑 rc=0、五臂仍全过）。
   🟢 **00:3x 修掉闸门一条"合法调用被判成根错"**：`scripts/verify-mobile-window-gate.sh --repo <相对路径>`
   会被判 `exit 1`，报的是「脚本推导的根与 git 根不一致」，而 `cd "$REPO"` 其实**成功**了 ——
   `REPO` 还是调用方给的相对串、`GIT_TOP` 是 git 给的绝对串，那条比的是**字形**不是"是不是同一棵树"。
   改法：`cd` 成功后立刻 `REPO="$(pwd)"`（那条比对留着，它挡的是真的根算错）。
   现量（同一棵载体、同一个 cwd，只换 `--repo` 的写法）：
   `cd .. && bash heyta/scripts/verify-mobile-window-gate.sh --target c --repo heyta-wt-r14c`
   ⇒ `GATE_RC=3`、首行 `仓库根：…/heyta-wt-r14c（与 git 根一致）`、「根不一致」命中 **0**、`REDS=dev,apk`。
   ⚠️ 这条的形状值得留：**"相对路径会被拒"很容易被后来者记成现场规矩**（本会话就一度准备改用绝对路径绕过去），
   而它其实是探针自己把两个不同字形的字符串当身份比。复跑同一条命令即可验，别去改调用方。
   🔴 **11:2x 复跑（`bash scripts/verify-mobile-window-gate.sh --target c` ⇒ rc=3、`REDS=load,src,dev,apk`），
   三件事在这格里换状态**：
   ① 上面 1418–1419 那格的"凭据三件套全无"已过期 —— 现量 `✅ 凭据三件套都在`、`✅ emulator-5554 在线`；
      引用前请重跑，别按那两行建"要先起栈建号"的计划。
   ② `dev` 那格比 07:2x 多了一枚运行者（现量 pid **41138**），而 93817/98934 那对**仍楔住**
      （闸门现量 etime 28989s / 累计 CPU **0s**）⇒ 与 §5 第 3 条同一结论：**C 的窗口不是等出来的**，
      要持有者拍板；本线不杀、不接管。
   ③ `src` 那格量化了一次，因为它的**措辞比判据范围窄**：闸门那条是
      `git status --porcelain -- packages apps server | grep -E '^ ?M' | wc -l`，逐树取 M 行、
      **不看消费者**。现量 21 枚里落在 `/evidence/` 的 **2** 枚
      （`apps/mobile/evidence/ios-reminder-cancelled.png`、本线自己那份 `apps/web/evidence/calendar-view-options/README.md`），
      其余 19 枚中 `.md/.png/.jpg/.svg/.json` **0 枚** ⇒ "这些会被打进产物"对那 19 枚成立、
      对这 2 枚不成立。**不改闸门**：一是它此刻不是-binding（红的还有 load/dev/apk 三条），
      二是收窄范围会让"取证文件被别人那趟 e2e 重写"这一族真的进了产物时不再报红 ——
      而 Windows 那条通道（`git ls-files` + 未跟踪非忽略）确实会把 `apps/*/evidence/*.png` 送进打包集合。
      📌 读 `REDS=src` 时要知道的：**它是"逐树 M 行"，不是"逐消费者源码行"**，差集现量就上面那条命令。
   🔴 **本批刻意不给 C 挂 `research/tools/r14c-window-retry.sh`**（它活着过，07:2x 那格就是它）：
   开窗即跑 `@heyta/ui build` + `build:android`（66 MB APK，数分钟满载），会把 H 等的负载门顶回去
   —— 两把抢**同一个**窗口，而 C 真正的 blocker 是楔住的那对 pid（要人拍板），排队不产生进度、只产生竞争。
   开窗判据仍写在这：`dev` 与 `load` 同消（复跑同一条闸门，读 `REDS=`）。
   🔴 **11:4x 补一条现量，它把"等这一个跑完就开窗"这个读法否证了**：`--target b` ⇒ rc=3、`REDS=load,src,dev`
   （`src` 那格已从 21 涨到 **39**），设备面运行者是 pid **56364** —— 而我 11:2x 记的 41138、10:4x 记的 79158
   **都已退出**。⇒ 占设备面的不是"某一只长跑进程"，是**连续换班的一串移动端验收**（三个 pid、间隔约半小时）。
   这一格对后来者的意义：`dev` 红了**没有"等它就好"的终点读数**，只能按"下一次真出现空闲窗口"处理，
   并且**不要为了挤进那个窗口去调低阈值**（AGENTS §8.9 独占验收；§6 第 20 条那一族是"恒红的前置"，
   这一条是它的兄弟："排队等一场换班"同样不产生进度）。
   另记一笔 11:4x 现量：**已启动的模拟器有 5 台**（`heyta-batch2-closeout; heyta-bc-reminders;
   heyta-iphone-17pro; heyta-ios-isolated; iPhone Duo heyta`）⇒ B 必须显式带 `IOS_DEVICE_NAME`，
   这台机器上"猜目标"会卸错设备的包（§6.1.1 那条纪律的现场理由）。
   🔴 **11:3x 复算同一组数，比例整个翻了过来**：M 行 **38** 枚，其中落在 `/evidence/` 的 **21** 枚
   （全是 `apps/web/evidence/vault-panel/*.png` 那一族）—— 而 11:2x 那格是 **21 枚里 2 枚**。
   ⇒ 上面那句"evidence 只有 2 枚，所以 `src` 那格基本是真源码"**只在取数那一秒成立**，别读成性质；
   同一时刻负载从 15 涨到 **109**。⚠️ **这里不写因果**：这 21 枚 png 与负载同时出现，但"谁写的它们、
   负载高在什么上"我没测 —— 口径沿用 §5 第 2 条里那格对同名事件的写法（"被一趟**未归因的** e2e 重写"），
   并同时记一句反证压力：**同等并发下仍全绿既不支持也不否证**，所以这条只写"未定性"。
   于是"不改判据"那条理由要换成站得住的两条：① 它此刻**非-binding**（红的还有 load 109 / dev / apk 三条，
   收窄 `src` 一格开不了窗）；② 真正的修法**不是"排除 evidence"，是按 target 分范围** ——
   C 的 APK 不装 `apps/web/evidence/**`（那些 png 对 C 是虚警），而 B 的 mac/win 载荷**确实**会把它们带走
   （Windows 走 `git ls-files` + 未跟踪非忽略）⇒ 同一批文件对两个 target 的正确回答相反。
   登记成**下一批边界**（本轮刻意不做，不是漏）：成本现量 = 消费 `REDS=` 的文件 **5 枚** / `REDS=` 行 **14 行**
   （`r14c-window-retry-arms.sh` 2、`-boot-avd-arms.sh` 3、`-heal-fire-arms.sh` 4、`r14c-carrier-chain.sh` 4、
   `lib/wedged-runner.sh` 1，另闸门自身 8）⇒ **改输出契约要把这五把全跑一遍**，不是加一句 `grep -v`。
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
   ⚠️ **02:1x：这份清单又过期了一次**（它本来就是活树瞬时读数，不是提交属性）。现量本线未入库 =
   **2 枚 ` M` 文档**（我这轮又各写了一段）+ **2 枚装置**（`research/tools/r14c-window-retry.sh` 改到第二版是 ` M`、
   `research/tools/r14c-window-retry-arms.sh` 是 `??`），而**上一版点名的 8 枚里 6 枚已被别人吸走**：
   两枚脚本与四枚装置早已在 HEAD（`102d064f` 等笔），我 02:0x 新写的 `r14c-install-guard-arms.sh` 连同两份文档
   01:5x/02:0x 那几段被 02:10–02:11 的三笔（`95ac4662` / `73b36a6d` / `47c7b17d`）整片提交带走。
   ⇒ 提交权到手时**先重跑上面那条清单命令**再点名 `git add`，不要照本文件里任何一份历史清单抄 ——
   这已经是同一张表**第三次**过期（00:0x / 01:3x / 02:1x），而且第一次是别人替我们补做的。
   🔴 **02:4x 第四次过期，而且方向是"变多"**：现量 **6 枚 ` M` + 1 枚 `??`**。比上一版多的两枚是我 02:3x 动的
   `scripts/lib/mobile-e2e-runner-probe.sh`（两处探针缺陷，读数在 §5 第 4 条）和 `research/tools/r14c-window-retry.sh` 第二版；
   少的方向也现量取过：`h-flaky-window-watcher.sh`、`calendar-line-judgment-rerun.sh` **已被别人吸进 HEAD**
   （`git ls-tree HEAD --name-only --` 那两枚都命中）。
   ⚠️ 探针那枚的归属要说准：它是**别人也在用的 lib**（`lib/mobile-e2e.sh` 的运行者门、各条 `verify-mobile-*`
   与窗口闸门都 source 它），所以它**必须与两份文档同一笔**——否则得到的正是本线反复记过的那个形状：
   "文档描述了修好的判据，判据本身还在工作树外"。
   点名最小集（提交权到手时**先重跑这条**再决定 `git add` 的清单）：

   ```bash
   git status --porcelain -- docs/plans/calendar-year-time-and-mobile-profile.md docs/plans/calendar-profile-handoff.md \
     scripts/lib/mobile-e2e-runner-probe.sh scripts/verify-mobile-window-gate.sh scripts/verify-mobile-due-time.sh \
     research/tools/r14c-carrier-chain.sh research/tools/r14c-window-retry.sh research/tools/r14c-window-retry-arms.sh
   ```
   ⚠️ 02:4x 现量这一份是 **7 枚 ` M` + 1 枚 `??`**（`verify-mobile-due-time.sh` 是刚因第 4 层那条判据改动才回到 ` M` 的，
   上一版清单里没有它 —— 那正是 §4 A 记过两次的"描述了判据、判据本体还在工作树外"的形状）。
   🔴 **03:1x 第六次过期，并且这次把清单变成了工具**：散文清单的保质期已实测是**几十分钟**（同一张表六次过期），
   所以它落成 `research/tools/calendar-line-commit-plan.sh` —— **每次运行重新现量**，默认 dry-run，
   `--confirm` 才动，缺 `MSG` 就 exit 1。**现量 8 枚 ` M` + 3 枚 `??` = 待入库 11 枚**
   （⚠️ **03:2x 复跑已是 12**：8 ` M` + 4 `??`，多的那枚是刚写的 `r14c-bundle-testid-preflight.sh` —— 同一张表第七次过期，
   距离它写下来不到十分钟。这正是"清单必须是命令而不是散文"的证据）。
   🔴 **A 新增一条外部前置（不是"等提交权"那一类）**：**此刻索引里有 8 枚别人已暂存的路径**
   （`apps/mobile/evidence/ios-keychain-probe-{clean,empty,invalid,remove,verify}.json` 5 枚 +
   `docs/plans/multi-end-coverage-handoff.md` + `scripts/check-ios-native-bridge-names.mjs` +
   `scripts/verify-ios-vault-keychain.sh`）。**在谁手里**：iOS keychain / vault 那条并行会话（他们正把这笔提交出去）。
   本工具的判据在这种状态下 **exit 1 拒绝动刀**（共享工作树里 `git commit --only` 会整片吸别人暂存，
   本机实测过一次带走 109 枚），臂读数：跑前 `git diff --cached --name-only | wc -l` = **8**、跑完仍 = **8**。
   复跑（提交权到手时先跑这条，不要抄本文件任何一份历史清单）：`bash research/tools/calendar-line-commit-plan.sh`
   四条守卫的**有牙**读数（都是本会话现量，不靠读代码）：未知参数 ⇒ rc=**1** 并回显那枚参数；
   `--confirm` 无 `MSG` ⇒ rc=**1**；点名路径在磁盘上不存在 ⇒ rc=**1** 且**指名是哪一枚**（变异体：把清单里一枚
   换成不存在的路径，一次性副本、跑完 `rm`，残留 0）；索引非空 ⇒ rc=**1** 并列出**不属于本线**的那 8 枚。
   把索引守卫摘掉的旁路臂跑到第 3/4 段 ⇒ rc=**0**，`md-tables`/`shell-unicode`/`docs-link` 三道**这一趟全 0**
   （`docs-link` 与 02:5x 的 6 红、03:0x 的 0 红是同一族读数 —— 只属于那一趟，别当属性引用）。
   ⚠️ 03:3x 再复跑：`docs-link` 这趟 rc=**1**、**28 条**，按来源文件归好后是
   `tmp/mutant-pipe.md` 14 + `tmp/trap-head.md` 14（**本线两份文档 0 命中**）⇒ 别人变异装置的临时夹具，归属见 §4.1 那条。
   同刻把工具**打印的那行归因命令**换成实测跑通的 awk 形状，并且**把它打印出来的那一行原样复制执行过一次**
   （输出就是上面那两个 14）—— 工具印给下一个人的命令若跑不通，和 §4 A 记过的"反引号里的死引用"是同一件事。
   🔴 **自查出的一处分层缺陷（第一版没有牙）**：取 porcelain 状态码写成 `${line%% *}`，而 `' M 路径'` 的
   第一个空格在状态码**中间** ⇒ 切出**空串**，`case` 里那条 `'M'` 分支**永远走不到**（不可达分支 = 那一档根本没有判据，
   只是恰好被 `*)` 兜住才让枚数看起来对）。改成取前两列 `${line:0:2}`，输出把 `[ M]` 原形打出来当证据；
   改后现量 **8 条 `[ M]` + 3 条 `??`**。
   ⚠️ **一条如实登记的局限（03:2x 已把它从"局限"变成"读数"）**：`--confirm` 那条腿原来没跑过（要真提交，本会话无授权），
   于是在 `/tmp` 起**一次性迷你 git 树**跑了三条臂（迷你树里第 3 段的三道门禁是 `process.exit(0)` 的桩 ——
   桩只中和第 3 段，被测的是第 5 段的 git 行为，这点必须写清，别让桩的存在把"提交这一腿有证据"夸大）：
   C1 `--confirm` 有 `MSG` ⇒ rc=**0**，`git show --stat` 那笔**只带点名的 1 枚**（`docs/plans/a.md`），
   而迷你树里同时脏着的 `research/`、`scripts/`（装置副本与三个桩）**留在未跟踪** ⇒ 这就是 `--only` 不吞全树的正面证据；
   C2 `--confirm` 无 `MSG` ⇒ rc=**1** 且 `git rev-parse HEAD` **未变**（缺参不动刀）；
   C3 索引里放着别人一枚（`notes/c.md`）⇒ rc=**1** 并指名那一枚。
   🔴 **C3 第一次那把臂作废**：它报 rc=**0** 且输出里连"索引"那一段都没有 —— 那不是"守卫没牙"，
   是**臂根本没跑到那一腿**。形状值得入档：**一把臂如果没打印出它自己的判据段，它的 rc 就不是读数**；
   重做时把整份 stdout 打出来（不是只 grep 关键词）才能区分"绿"和"没跑"。
   复跑（不碰本仓库）：`T=$(mktemp -d) && cd "$T" && git init -q && …`，或直接读上面三条读数后
   `bash research/tools/calendar-line-commit-plan.sh`（本会话内它只到 dry-run）。
   🔴 **05:2x 复跑（`bash research/tools/calendar-line-commit-plan.sh`）rc=1**，两处读数与 04:2x 不同：
   - 待入库仍是 **15 枚**（8 ` M` + 7 `??`）—— 但**构成换了三枚**：这轮新写的 `r14c-drift-teeth.sh`、
     `r14c-chain-overlay-arms.sh`、`r14c-gate-b-exclusive-arms.sh` 进列，而 04:2x 那份里没有它们。
     ⇒ "枚数相同"不等于"清单相同"，引用时要带**是哪几枚**，不然下一个人会照旧清单去 `git add` 而漏掉三枚。
   - **索引里别人的暂存从 7 枚涨到 8 枚**，新进来的那枚是 `apps/desktop-macos/scripts/package-app.sh`
     （mac 打包脚本，属 macOS 那条线；其余 7 枚仍是 iOS keychain/vault 那五枚证据 json + 两枚脚本）。
     ⇒ A 的前置仍然不成立（工具在这种状态下按判据 exit 1 拒绝动刀，这是设计不是失败）。
   - ⚠️ **本线此刻在工作树里改了一枚不属于本线的文件**：`scripts/verify-mobile-notes.sh:533`
     （一行 `$f（` → `${f}（`，见 §6 第 17 条；红灯在别人 05:29 那笔 `99ea54c1` 的 HEAD 上）。
     它**没有**进上面的点名清单（`grep -c verify-mobile-notes research/tools/calendar-line-commit-plan.sh` = **0**）
     —— 本工具只提交本线点名的路径，代别人提交一行是**归属越界**，即使那一行是我改的。
     **移交口径**：notes 那条线的下一次提交会把这行一起带走；核对命令
     `git diff -- scripts/verify-mobile-notes.sh`（应只看到那一行的 `${f}`），或
     `node scripts/check-shell-unicode-vars.mjs`（rc=0 即门禁已不再红，无论谁提交）。

   🔴 **06:1x 这条清单本身长出牙了**（在此之前它是**一条没有牙的清单**）：`PATHS` 是手维护的，
   而"枚数归零"那条收尾自检只在**已点名范围内**归零 —— 漏的那枚从来不在自检的输入里，
   所以它**永远不会让任何东西变红**。今天这份清单漏过三枚，全是补上反查闸门**之后当场**照出来的：
   ① `research/tools/h-flaky-window-watcher.sh`（` M`，改了一整轮没进清单）；② `docs/plans/README.md`
   （` M`，脏的只有本线那一行 —— `git diff --numstat` = 1/1 才敢点名）；
   ③ **`research/tools/r14c-server-readability-judgment.sh`** —— 这枚最贵：03:45 就写好、被同命名空间
   三枚工具与台账文档引用，而清单里没有它，**闸门第一次运行就把它抓了出来**；
   ④ 之后又抓到**刚写出来的** `r14c-gate-hint-arms.sh`（写完没点名 ⇒ ❌ 当场）
   ⇒ 它挡的不是"今天那一次遗漏"，是"以后每一枚新装置"。
   形状：`== 1b ==` 从"本线自己创建的文件名"反查 `git status --porcelain`，脏而未点名即 exit 1，
   带分母（`命名空间命中 21 枚全部已点名（工作树脏行分母 155）`）。两腿读数：**平态 rc=1**
   （1b ✅，红在 §2 —— 索引里 8 枚别人的暂存，与 05:2x 同一组）；**注入腿 rc=1**
   （`PATHS_OVERRIDE` 从清单里抽掉一枚已脏的命名空间文件 ⇒ 恰好报 1 枚、指名道姓）。
   ⚠️ 边界写在文件头，别读多：它按**名字**判归属（别人用同前缀会误报），
   而且**挡不住"我改了别人的文件"** —— `scripts/verify-mobile-notes.sh` 那一枚顺带修就是这种，
   按移交口径**故意不点名**（代别人提交一行是归属越界，即使那一行是我改的）。
   ✅ 现量：**待入库 25 枚（改动 15 / 新增 10）**（05:2x 15、05:5x 19、06:1x 23 —— 涨的十枚全是这两小时新写的装置）。
   🔴 **06:2x 又补了两枚，补的理由值得单独记**：`apps/web/evidence/calendar-view-options/*.png`
   —— 06:1x 那趟三连同跑改了它们的字节（`52174907…` / `ae8ad61d…`），而清单里只有那份 README。
   **只提 README 不提图 = 提交出一个自相矛盾的 HEAD**：README 记的那对指纹在干净检出里取不到，
   下一个人跑 `r17-evidence-md5-check.sh` 当场红，而红因是我这笔提交。
   ⇒ 命名空间正则的证据那一支同时反查 `*.md` 与 `*.png`（现量：`命名空间命中 23 枚全部已点名`）。
   ⚠️ 代价是**噪声**：别人一趟 e2e 重写同名图也会让这一支红 —— 但那**不是误报**，
   它问的是"图与 README 是不是同一趟"，答案要么"连图一起提"要么"按新字节重看再改 README"。
   🔴 **10:1x：A 的"待入库"归零了，而且**不是**本会话提交的** ——
   现量 `bash research/tools/calendar-line-commit-plan.sh` ⇒ **rc=0**、
   `命名空间命中 0 枚全部已点名（工作树脏行分母 1）`、`OUTSIDE_NS=0`，
   步 1 对本线文件逐条打 `✅ 已在 HEAD 且工作树与 HEAD 一致`（两份台账 +
   `scripts/lib/mobile-e2e-runner-probe.sh` + `scripts/lib/wedged-runner.sh` + 三枚 `b-*` 装置）。
   把那 36 枚带走的是并行会话的 `35dbffe9`（提交信息自己写着"r14c/b 族变异臂、卡死跑者自愈、证据 md5 对账"），
   随后 `f37ade5b` / `785f2d70` / `8a254bcd` 各又扫走一段。
   ⇒ 必须写准的两句：**本线从头到尾没有执行过一次点名 `git add`**，
   所以 §4 A 那条归属纪律**没有被走过一遍**；这一次的结果是好的，不代表机制成立 ——
   同一支笔也完全可能把别人的半成品一起带走（00:0x 那笔 `2f735392` 就是这种形状）。
   ⚠️ 顺带一条**我自己的近失**（如实入档）：10:1x 为了验 1b 那格的牙，我把工具 `cp` 成
   `research/tools/.tmp-plan-mut.sh` 在**仓内**跑了约 20 秒，而那段时间正好有一次整目录 `git add` 在飞。
   现量 `git ls-tree -r --name-only HEAD | grep -c tmp-plan-mut` = **0** ⇒ 没被扫走，**但这是运气不是机制**。
   🔴 工具本来就有没有副作用的接缝：`PATHS_OVERRIDE`（第 89 行，注释写明"其余逻辑一字不改"）——
   下一次**先 grep 现成接缝再决定建不建临时文件**（§7 那族"手写探针前先找仓内现成装置"，本线第二次踩）。
   🔴 而那一趟臂**没有红**，原因不是判据坏，是**它的前提在我两次运行之间被别人拿走了**：
   臂要把"命名空间内一枚已脏文件"从清单里抽掉，而 `scripts/lib/wedged-runner.sh` 在 10:1x 已被提交（不再脏）
   ⇒ 同一把工具的分母从 166 掉到 19。⇒ **这条臂只能靠夹具喂状态**（`PATHS_OVERRIDE` + 一次性迷你 git 树），
   不能依赖活树。1b 的牙本轮**不重证**，引用它 06:1x 那四次真抓（①–④，那四次都是活树自己给的）。
6. **E（接门禁）** —— ✅ **00:01 已落地**（`package.json` 在那笔提交之后是干净的，前置满足）：
   新增 `"check:md-tables": "node scripts/check-md-table-rows.mjs"`，并把 `pnpm check:md-tables`
   插在 `pnpm check` 链的 `pnpm check:docs` 之后（链现量 **63 段**、该条目出现 **1 次**、`require('./package.json')` 解析通过）。 ⚠️ **03:0x 复跑**：链段数已是 **75**（别人又往链上加了段）、本线条目仍出现 **1 次**、脚本平态 rc=**0** ⇒ "63 段"只是那一趟的读数，**别当属性引用**（这条链的段数由所有并行会话共同决定）。
   **它有牙**：在台账第 664 行注入一枚错位表行 ⇒ `pnpm check:md-tables` rc=**1** 并指到行号
   （报的是"表头下面没有分隔行"那一档，不是列数那一档 —— 两条都是它自己的判据，这里如实写）；
   用 `cp` 复原后 `cmp -s` 字节级相同、复跑 rc=**0**。改动**只有 package.json 两行**，未 `git add`。
   🟢 **01:5x 现量收口：那两行现在已在 HEAD，不再在工作树里。** 复跑读数：`package.json`
   `git status --porcelain` 为空且 `git diff --quiet HEAD` ⇒ SAME；`git show HEAD:package.json`
   里 `check:md-tables` 命中 **2 行**（定义行 + `check` 长串中 `pnpm check:docs &&` 之后那一处，idx=879）；
   `git ls-tree HEAD` 里 `scripts/check-md-table-rows.mjs` 与 `scripts/dist-freshness.mjs` **两枚都被跟踪**
   ⇒ 过程账 §5 第 6 行那条"接进 `check` 之前必须先把两枚脚本 `git add`"的前置**由别人那笔
   `102d064f`（10-04 00:46，vault 那条线）替本线完成了** —— 它提交 `package.json` 时把我那两行整行吸了进去；
   🟢 **04:0x 补上「接线」这一半的牙**（原来只量了脚本本身能不能红，没量'漏接进链会不会有人发现'）：现成装置 `scripts/check-gate-wiring.mjs` 支持 `--pkg`，所以变异**不碰真实 `package.json`**（它此刻正被别人写着：` M`、4+/2-，加的是他们那条 `check:ios-native-bridges`）——把同一份字节写到 `/tmp` 再摘掉链里那一段 `&& pnpm check:md-tables`：对照体（未变异）rc=**0**（72 道定义 / 75 段 / 链外 1 道允许），变异体 rc=**1** 且原话是「`check:md-tables`: 定义还在，但**不在这次的 check 链里** —— 它不会再被跑，而链子照样绿」，段数读数同步从 75 掉到 **74**、链外从 1 变 **2**（允许表只有 1）⇒ **漏接线会被自己的门禁抓住**，这一条不再依赖人记得。`pnpm check:gate-wiring` 在真实链上 rc=**0**。
   **归属记在那笔提交名下，不记本线**。平态现量：`node scripts/check-md-table-rows.mjs` ⇒ rc=**0**
   「4 个文件，列数、断行与"是不是表"都一致」。
   ⚠️ 一条读数形状（与 §6 第 10 条同族）：这脚本的报错走 **stderr**，所以 `> out 2>/dev/null`
   在 rc=1 时留下的是**空 stdout** —— 它与"跑了且干净"长得一模一样，判成败只认退出码。
   🟢 **05:2x 复跑（E 的前置与结论都要带载体）**：
   - **`package.json` 又回到 ` M`** —— 这次加的是别人的两道（`check:ios-native-bridges` + `verify:ios-vault-keychain`，
     正是索引里那两枚暂存脚本），与本线无关。⇒ **"package.json 干净"这一格是瞬时的，永远不能引用**。
   - 🔴 **段数要分两个载体报**：`git show HEAD:package.json` 解析出链 **74 段**、`pnpm check:md-tables` **恰好 1 段**，
     而活树是 **75 段**（那 +1 就是上面别人那两道里进链的一道）。本文件历史里"63 段"（00:0x）、"72 道定义 / 75 段"
     （04:0x 变异装置的对照体）与"75 段"（03:0x）**都是活树瞬时读数**；
     **E 是否闭合只有一个能长期引用的形状：`git show HEAD:package.json` 里 `check:md-tables` 出现 1 次** ——
     这是一条**属性**（已提交），而段数不是。复跑（本轮实测 rc=**0**，输出 `HEAD_SEGS=74 MDT=1`）：
     ```bash
     git show HEAD:package.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s).scripts.check.split(" && ");console.log("HEAD_SEGS="+c.length+" MDT="+c.filter(x=>x==="pnpm check:md-tables").length)})'
     ```
   - `node scripts/check-gate-wiring.mjs`（真实链、非变异）rc=**0**；
     `node scripts/check-md-table-rows.mjs` rc=**0**，**9 个文件**（上面那句"4 个文件"是 04:0x 那趟的读数，
     此后别人新登记的 md 也归它扫 ⇒ 引用它同样要带哪一趟）。
   - ⚠️ 又踩一次 §7 #45 的**近亲**：`bash scripts/check-shell-unicode-vars.sh` 得 rc=**127**（不存在这个文件，
     正解是 `node scripts/check-shell-unicode-vars.mjs`）。**127 不是判据红**，是命令名错；
     把它记在这里是因为它长得像"这一族又坏了"。
   ⚠️ **06:3x 一条不属于本线的红**：`node scripts/check-shell-unicode-vars.mjs` 现在 rc=**1**，
   红点是 **`tmp/w07-recapture.sh:38 / :51`** 两处 `$cmd）` / `$rc）` —— 倒数纪念日那条线的 W7 取证脚本，
   住在 `tmp/` 里（未跟踪）。**本线不代改**（同一文件的未提交 diff 就是撞车判据，`tmp/` 整片是别人的现场），
   但它会让本线两处读数不能写成"全仓绿"：`calendar-line-commit-plan.sh` 的第 3 格、以及任何"静态门禁全绿"的说法。
   现量命令：`node scripts/check-shell-unicode-vars.mjs`（红点归属看输出里的路径前缀，`tmp/` 一律不是本线）。
   📌 顺带一条形状：这道门禁扫的是**全仓 .sh**，所以 `tmp/` 里的一次性脚本也会让它红 ——
   "我的文件都干净"与"门禁绿"是两件事，报数的时候要分清是哪一层。
7. 边界 F 里**只有两条值得排下一批**：捕获语法的英文规则表（要先拍"规则表归 domain 还是归 i18n"），
   和 `web.*` 被移动壳读的那笔纯改名（🔴 **这里不写条数** —— 23:06 现量是 188 处 / 13 文件 / 187 行 / 180 个去重键；**03:0x 复跑已是 235 处 / 16 文件 / 234 行 / 222 个去重键**（同趟阳性对照 `common.` = 130 ⇒ 四小时涨 47 处，这条边界至今只有台账里的一个数、没有门禁）。🔴 这次复跑还先坏了一枚探针，形状值得留给下一个复跑它的人：把命令直接写进 `$( )` 时，为了嵌引号用的 `\"` 让 grep 的 pattern **真带上了那两个引号字符** ⇒ 处数与**阳性对照同时为 0** —— 0 的对照就是"探针根本没跑对"的信号，不是"代码干净"；正解是把台账里那份原文落成一个脚本文件再 `bash` 它，
   但同一个格子在 19:3x 之前写的是 179：**这条边界没有门禁，只有台账里的一个数**，所以引用前必须重跑
   `grep -rho -- "'web\.[a-zA-Z0-9._-]*'" apps/mobile/src | wc -l`，阳性对照同趟跑 `'common\.'`。要先给 `check:l4` 挣出余量）。其余留在台账里不动。
   🔴 **01:5x 按上面那句规矩复跑了一遍（这条边界没有门禁，只有台账里的一个数）**：现量
   **188 处 / 13 个文件 / 180 个去重键** —— 与上一段那组数字逐字相同（所以这次不需要改文档）；
   同趟阳性对照 `'common\.'` = **111** 处 ⇒ 扫描器接得上，188 不是探针坏出来的空读数。
   🟢 **05:2x 第三次复跑（同一形状、四格同趟）**：**235 处 / 16 个文件 / 222 个去重键**，阳性对照 `'common\.'` = **130** 处
   ⇒ 与 03:0x 那趟**逐字相同**（4.5 小时里这条边界没动），而 19:3x/01:5x 记的 188/13/180 确认已过期。
   ⚠️ 这两组数不是矛盾也不是漂移的两种说法，就是"没有门禁、只有台账里的数"的后果：
   **`'web.'` 的处数由所有并行会话共同决定**，所以引用它的句子必须带上"哪一趟"，
   而"这条边界要不要做"的判断**不能建立在这个数上**（它随时会变），只能建立在
   "移动壳读的是 `web.*` 而 web 侧改名会静默断"这个结构事实上。
   复跑：**`bash research/tools/f-boundary-scope-count.sh`**（只读，四格含阳性对照，三臂 `--selftest` rc=0）。
   ⚠️ 这里原来抄的是一条**手写的四段 inline grep**（`A=$(…); B=$(…); C=$(…); P=$(…); echo …`）——
   同一条判断落两份就有第二份会漂，而这一枚的教训写在上面 u) 格那格里：
   grep 塞进 `$( )` 时 `\"` 会进 pattern ⇒ 处数与对照**同时为 0**，看起来像"这条边界没了"。
   11:0x 起**这条边界的读数只有脚本那一份**，不要再往本文件抄第二遍命令；
   现量 **11:3x 复跑与 11:0x 逐字相同**：`处=235 行=234 文件=16 去重键=222 阳性对照common=130`（脚本比原来那条 inline 多打"行"一列）。
   🔴 **同批新增一条下一批边界，登记在这里以免静默消失**：窗口闸门 `REDS` 的 `src` 那格应**按 target 分范围**
   （C 的 APK 不装 `apps/web/evidence/**`；B 的 mac/win 载荷确实会带走它们）。
   它属于**闸门装置**、不属于上面那两条界面/词表边界，形状与成本现量写在 §5 第 4 条末（11:3x 那格）。

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
    ⚠️ 07:4x 又漂一次（本轮补三段增量之后，**写这句说明自己又把行数动了** ⇒ 这句里不写目标值，
    目标值只写在 README 那一格且**最后一步取** —— 这就是"别在中间取"的理由）。
    顺手把 README 那个格子里
    "已漂过 N 次"这句**摘掉**了 —— 它自己就是一份手抄的次数，而它守的那个数字没有任何门禁；
    留"引用命令，别引用数字"这一条就够（与本文件 §7 号段那句"不写条数"同一个理由）。
12. 🔴 **写"某道门禁管到哪一层"之前，先把那支臂也从门禁那一侧跑一遍**（22:1x，R17）。
    我把「`check:ui-language` 只比键集」当作两条判据存在的**理由**写进了三份文件（用例标题、e2e 文件头、台账），
    而**这句话我一次都没量过**。V4 一跑就否证：把 en 的值抄成中文，它自己 rc=1 并指名那一条。
    🔴 更难受的是结论没错 —— E2/E3 那种「组件里写死中文」它确实看不见（V5 实测 rc=0），
    所以如果我不是你恰好补一支臂去问"那门禁红不红"，这条**错理由会一直替我对的结论背书**。
    配方：**判据的存在理由里凡是提到别的门禁的覆盖面，那一句本身就是一支臂** ——
    把同一种病喂给那道门禁，读数写进臂表。顺带量到两件新事实：`translate()` 对缺键是**抛**
    `词条不存在`（不是返回键名），而键名↔词条表的耦合**只有判据在守**（V4c 门禁 rc=0）。
13. 🔴 **把「载体 `checkout` 到主检出 HEAD」读成「那一趟跑的是当前判据」**（04:0x 现量才看见）：
    `checkout` 只带**提交**，而本线这几轮把四层判据写进的是主检出的**工作树** ——
    逐字节差就是证据（载体独有 3 行 = 第 4 层纯打印版，主检出独有 14 行 = 带 `ok/bad` 与退出码的判据版）。
    正解写在 §5 第 4 条（链第 0 步点名覆盖 + 逐枚 md5 + 覆盖前备份 + 跑完还原）。
    🔴 更深一层的死路形状是那句我自己写了两次的话：**「要等 A 落笔才进得了载体」** ——
    它把「我没找到不动索引的办法」包装成了「这件事客观上还不能做」。判法很简单：
    凡是写成"必须等提交/等别人"的步骤，先问一遍"不改 HEAD 能不能等价完成"，多数时候能。
14. ⚠️ **「脚本正被别的进程执行 ⇒ 现在不能改它」是半句对半句错**（04:0x）：
    bash 确实增量读脚本（原地改长度会打断那一趟，这条线为此等过一趟），
    但正解是 `cp` 副本 → 改副本 → **`mv -f` 原子替换**：运行中的进程握着**旧 inode** 的 fd 读完旧文件，
    目录项换掉不影响它。现量：替换后真 rig 继续跑到 etime 1h36m 未中断，而修好的两处当场复跑出 **11 绿 0 红**。
    代价的不对称在这里：**推迟的那 90 分钟里它每 60 秒写一次坏日志**，而每次都要有人再发现一遍。
    同源规则：别人会 source 的文件（脚本、生成的 ts、词条表）也一律 tmp + 原子 rename，不要原地截断重写。
15. 🔴 **不带引号的 heredoc 里的反引号会被真的执行**（04:0x，在我自己写的看守脚本里）：
    `cat >> "$LOG" <<HDR` 里写 `` `git checkout <主检出当前提交>` `` ⇒ bash 去跑它，stderr 得到
    `syntax error near unexpected token 'newline'`，**而退出码不变**（那把 rig 之后又跑了 90 次没人察觉），
    日志里那一行变成"开窗后先  再打产物"（命令文本被吞）。这是"反引号在 shell 里会被展开"那族的
    **第四种载体**（前三种：双引号里的 grep pattern、`echo` 里的说明句、`node -e` 的正则字面量）。
    规则：说明性 heredoc 一律 `<<'EOF'`；复扫形状加一条 `grep -n '<<[A-Z]' <我的脚本>` 命中数必须为 0。
16. ⚠️ **数"看守跑了多少次"要读它自己的 `$LOG`，不是后台任务的 stdout**（04:0x 我自己读错）：
    看守把每次尝试写在 `/tmp/ht-r14c-window.<ts>.<pid>.log`，任务输出文件只收 stderr ⇒ 我去数后者得到 **0 行**，
    差点写下"一次都没跑"（真读数 **80 条 `ATTEMPT` 全 rc=3**）。
    与 §7 第 45 条同族：**读错流得到的空值，和"没有"长得一模一样**。
    ⚠️ 上面第 15 条那句"又跑了 90 次"是**04:0x 那一刻**的读数；同一趟跑到预算用尽时是
    **181 轮 / 171 次真跑闸门**（差的 10 轮是 `CO_RUNNER=alive` 让路，不跑闸门就不发 `ATTEMPT`）⇒ 引用它要带哪一趟。
17. 🔴 **`$var（` 这一族的触发条件是 locale，而门禁的说明里没写**（05:2x 实测，取证脚本 `/tmp/ht-uv-test.sh`）：
    同一行 `A="evidence/$f（123 bytes）"` 与 `B="evidence/${f}（123 bytes）"` 逐字对比 ——
    `LANG` 为空 ⇒ **SAME**、`LANG=C` ⇒ **SAME**、`LANG=en_US.UTF-8` ⇒ **DIFFER**、`LANG=zh_CN.UTF-8` ⇒ **DIFFER**。
    坏形在 UTF-8 下的**逐字节**读数（`od -c`）：`evidence/` + `274 210` + `123 bytes）` ——
    也就是说 U+FF08（`（`，三字节 `357 274 210`）的**首字节 `357` 被并进了变量名**（名字变成
    `f\xef` ⇒ 未定义 ⇒ 值整段消失），剩下两个字节作为 mojibake 打印出来。
    **这个读数不是推理**：复现脚本 `/tmp/ht-uv-probe.sh` 只有 3 行，同一份在四种 locale 各跑一遍。
    ⇒ 两个推论：① **"我手动跑了一遍没看到乱码"不构成否证** —— 本会话的交互 shell `LANG` 恰好是空的，
    而验收脚本被别的会话/别的终端（或 CI）以 UTF-8 locale 调起来时就会坏；
    ② 门禁报红**不等于当场可见**，但修法是零风险的（`SAME` 的两种 locale 下两种写法逐字等价）。
    这一条的红灯**不在本线**：`scripts/verify-mobile-notes.sh:533` 由别的会话 **05:29 提交**（`99ea54c1`），
    工作树里该文件**干净** ⇒ 红灯**就在 HEAD 上**，`pnpm check` 的 `check:shell-unicode` 段对全仓是红的。
    按"撞见的 bug 当场修完"改了这一行（`$f（` → `${f}（`）：`bash -n` rc=**0**、
    `node scripts/check-shell-unicode-vars.mjs` rc=**0**（扫 **99** 个 .sh，上一批是 98 —— 别人又加了一枚）。
    ⚠️ **这个门禁的正确调用是 `pnpm check:shell-unicode` / `node scripts/check-shell-unicode-vars.mjs`** ——
    我先按 `.sh` 去跑（`scripts/check-shell-unicode-vars.sh`）得到 rc=**127**（文件不存在），
    那一次"红"是命令名的锅，不是判据的锅（§7 #191 那一族：0 命中/非零码先问探针）。
    📌 **待入 traps**（取号按当时活树尾号 +1，05:2x 现量 `grep -oE '^[0-9]+\. '` 末三枚 **212/213/214**，
    HEAD 版最大号 **211** ⇒ 下一枚**至少 215**；`docs/reference/environment-traps.md` 正被并行会话 `M`，
    所以本轮**不往它插行**，先登记在这里）：
    **"判据说明里只写症状、不写触发条件"会让下一位把"本地没复现"当成"门禁误报"从而摘掉判据** ——
    这条尤其贵，因为这一族的复现条件（UTF-8 locale）在开发机上恰好经常不成立。


18. 🔴 **手维护的清单不会自己变红 —— 它只挡得住"已经知道的那些"**（06:1x，
    `research/tools/calendar-line-commit-plan.sh` 的 `== 1b ==`）。
    一份"要点名哪些文件"的清单，配一条"点名的范围内枚数归零"的自检 —— 这两件合起来**看起来**是闭环的，
    实际上漏件的那枚从来不在自检的输入里，所以它**永远不会让任何东西变红**。
    今天这份清单漏过三枚（其中一枚 03:45 就写好、被三枚同命名空间工具引用），
    补上"从命名空间反查工作树"之后，**第一次运行抓到一枚旧的、第二次抓到刚写出来的新装置**。
    📌 一般规律：**凡是"我维护一个集合"的判据，都要问一句"集合少一项时谁会喊"** ——
    如果答案是"没有人"，那这份清单只是备忘录，不是判据；补的方向不是更仔细的手抄，
    是**从集合声称覆盖的那个命名空间反查现场**。
    ⚠️ 同时把**挡不住的**写清：按名字判归属会误报别人的同名前缀文件，
    而"我改了别人的文件"这一族它天然够不着（那种只能显式不点名 + 移交口径）。
    🔴 另一条同族的自伤：给这条闸门写"下一步建议清单"时，我把建议写成了**无条件全打印**，
    于是它会在负载已 ✅ 时教人"等负载" —— 一份和现场不对应的建议清单比没有建议更费时间，
    判据数得出的量，人眼在单张图上看不出来（同 §7 第 82 条那一族）。
19. 🔴 **前置判据本身也在"载体同步"的范围之外**（06:5x 现量，07:2x 补齐）：
    把载体 `checkout` 到主检出 HEAD 只保住**被测产物**，它同时会把你依赖的**判据脚本**换成那一格的已提交副本。
    这条线在一天里为同一个成因栽了两次：第一次是 `verify-mobile-due-time.sh`（判据版在主检出工作树、
    载体里是纯打印版），第二次是 `verify-mobile-window-gate.sh` 自己 ——
    载体那份**没有 `reinstall_other_pids` 那一整条探针**，于是"开窗判据"看不见正有一趟重装在同一台设备上
    `adb uninstall`（§8.9 禁的正是这件事）。
    📌 一般规律：**凡是"把执行环境切到某个提交"的动作，收尾要逐个问一句"判据读的是哪一棵"**；
    两条出路都要留痕 —— 默认值指向**主检出**那份（`GATE`/`HEAL`/`CHAIN`），
    或在链里用**点名覆盖 + 逐枚 md5 对账 + 跑完还原**把它搬进执行环境（链的第 0 步 `JUDG_PATHS`）。
    不要的形态是：靠调用路径隐式决定用哪一份 —— 那正是"看起来在保护 A，其实在保护 B"。
20. 🔴 **恒红的开窗前置 = 结构上开不了窗**（07:2x 现量两处，都是我自己写的装置）。形状：
    **开窗动作自己造出来的红，被当成了别人的红。**
    - ① 载体每 `checkout` 一次，它的源码 mtime 就刷成"现在"，APK 还是上一次打的 ⇒ 闸门恒红 `apk`；
      而链只在闸门回 0 时才起 ⇒ 链里那个 `build:android` 永远轮不到。
    - ② "起模拟器"要求红集里除设备外没有别的 ⇒ 在"设备离线 + 载体同步过"的常态里，`apk` 那条永远在，
      于是永远不到门口。
    📌 每条前置都要问：**这条红能被哪一步消掉，而那一步在开窗前还是开窗后**。
    消掉它的那一步在开窗之后 ⇒ 这条前置不能当门闩，只能改成"开窗后同一条判据再量一次"（链的第 6 步 `regate`）。
    ⚠️ 这一族和"永远通过的判据"（§8.3）是**对偶的两个失败**：那条让假绿进来，这条让真绿永远进不来。
21. 🔴 **消费方读"给人看的那份清单"，通道就会自己漂**（07:2x 落地）：看守原来 `grep -c '❌'` 数红，
    而它真正要区分的是"**哪几条**红"（只红 `apk` ⇒ 该开窗；还红 `load` ⇒ 该等）——
    一个数分不开两种决定完全相反的情形。现量：`REDS=load,dev,apk` 而 ❌ 有 **4** 条
    （`有移动端验收在跑` 与 `有另一趟 reinstall-all 在跑` 同挂 dev 一条旗标）⇒ **条数天生不能互推**。
    ⇒ 闸门在结论处打一行 `REDS=load,src,dev,cred,apk` 的子集，由同一批 `WHY_*` 旗标投影
    （不是第二套判据），缺这一行按**装置坏**处理（`exit 4`），不当成"没有红"。
    ⚠️ 也不要反过来写成 `条数 == FAIL` 那种假等式：`FAIL` 还数着没有旗标的提示行。
22. 🔴 **这条本来写错了，就地撤回、原句留在这儿**（07:3x 写下，07:4x 被一枚夹具否证）。
    ~~原地改写一把正在跑的 bash 看守 = 改它的字节偏移：bash 是**增量读脚本文件**的，
    循环体还在下一轮就会从新文件的对应偏移接着吃；当时日志末行仍打旧字符串 ⇒ 说明跑的是旧代码。~~
    **停与重挂那一步是对的，给它的理由是错的**，而错的理由会把人推向"永远不敢动正在跑的东西"。
    现量（一次性夹具 `/tmp/inode-test.sh`，改前 inode `249893442` → 改后 `249893561`；
    复测形状：`stat -f %i f` → 用编辑工具改一行 → 再 `stat -f %i f`）：编辑工具与
    `cp → 改 → mv -f` 走的是**换 inode + rename**，运行中的 bash 握着**旧 inode** 的 fd，
    继续读完整的那一份旧文件 —— 所以"日志末行还是旧串"的正确读法是
    "**它还在跑改之前那一份**"（正常），不是"读到错位的新内容"。
    ⚠️ 真会吃到错位的形状是**同一个 inode 上截断重写**：`python open(p,'w')`、`>` 重定向、`cat x > x`。
    📌 规则因此分成两条：① **改了要生效就得重挂**，并读新日志第一趟确认是不是新形状
    —— 不要靠"等它跑完"去躲一个本来不存在的风险（推迟本身是会累积成本的决策）；
    ② **写盘形状选 rename，不选原地截断**。
    停的时候 TERM 与 KILL 不等价（TERM 会跑 trap、KILL 什么都不跑）—— 实测装置在
    `research/tools/r14c-signal-trap-arms.sh`（三臂），结论写在 `research/tools/r14c-carrier-chain.sh` 的文件头注释里。
23. 🔴 **"把候选收窄到只剩一条"这一步，收窄的范围必须是整个仓，不是当前这一篇文档**（09:3x 现量）。
    一枚 flaky 的机制在 §3·补 ⑨·附 里被逐条否证到"只剩一条候选"，四条事实全部来自**本篇内部**的代码与日志；
    而同一台机器、同一套 dev server 上的**另一条线**（`admin-console.md` §7.4）早已用 trace 实证过另一支同族机制。
    后果不是"少了一条候选"这么轻：那份收窄**直接决定了修法**（warm-up 只打冷启动那一支），
    于是差点花一次界面改动的代价去买一个不针对当前最可能机制的保险。
    📌 规律：**同类随机红在本仓是共享机制的**（同一载体、同一 dev server、同一共享工作树）。
    凡"把 X 收窄到只剩一条候选"的句子，落笔前先做一次跨文档检索
    （`grep -rn 'flaky\|随机红\|根因' docs/plans | grep -v 本篇`），
    并且把"查过哪几篇"写在收窄那句旁边 —— 没写检索范围的收窄，下一位无法判断它是**收窄**还是**漏看**。
24. 🔴 **门禁的"看不见"可能是探针自己站在 C locale 上 —— 同一个缺陷在本会话的 shell 里恒不发作**（10:2x 现量）。
    ⚠️ **先纠一处我自己写错的**：我一度以为这是一条该入台账的新坑，**其实不是** ——
    §7 **#69**（`$VAR` 紧跟全角字符 ⇒ `LC_ALL/LANG=UTF-8` 下 `unbound variable`，带四行 locale 对照表）
    与 **#40**（同类，UTF-8 locale 下 bash 3.2 把多字节首字节并进变量名）**早已各写过一次**。
    本轮真正新增的只有一个**观测条件**：`Bash` 工具这边的 shell 是 `LANG=""`、`LC_CTYPE="C"`，
    所以 ① 那些写法在 agent 里跑**一百趟都不会现形**，② 我 `b-batch-reconcile.sh` 两趟"中文读数逐字未变"
    **不构成"那三处写法没问题"**（实测对照：`LANG=zh_CN.UTF-8` 下 `display=：/tmp/x.png`，值与右括号一起被吞；
    `LC_ALL=C` 下正常）。
    📌 一般规律：**探针所在的环境本身是一个变量**。凡"我复跑了、症状没出现"式的否证，
    落笔前先答一句"在哪个 locale 下量的"——这与 §7 三条元规则里的"先怀疑探针"是同一件事的具体化。
    复跑：`LANG=zh_CN.UTF-8 bash -c 'X=6; echo "display=$X）：y"'` 与 `LC_ALL=C` 同一行对照。
25. 🔴 **依赖活树状态的变异臂不可复现 —— 它的前提会在两次运行之间被别人提交拿走**（10:1x 现量）。
    给 A 的 1b 那格做注入臂时，我把工具 `cp` 进仓内改成"抽掉一枚已脏的命名空间文件"再跑；
    结果臂**没红**，而判据没坏：那一枚（`scripts/lib/wedged-runner.sh`）在两次运行之间被并行会话提交了 ⇒ 不再脏，
    同一把工具的脏行分母从 **166 掉到 19**。
    📌 两条推论：① 这类臂只能用**夹具**喂状态（`PATHS_OVERRIDE` 接缝 + 一次性迷你 git 树），
    不能靠"现在恰好有一枚脏文件"；② **不要往仓里落临时件** —— 那一刻正有一次整目录 `git add` 在飞，
    这次没被扫走（现量 `git ls-tree -r --name-only HEAD | grep -c tmp-plan-mut` = 0）是**运气不是机制**。
    正确顺序是先 `grep -n OVERRIDE` 找现成接缝（本线今天第二次踩这条）。
26. 🔴 **"结果对了"不等于"机制走过一遍"**（10:1x，A 的闭合方式）。
    本线的 36 枚待入库被并行会话的 `35dbffe9` 整片提交，`calendar-line-commit-plan.sh` 现量 **rc=0、命中 0 枚** ——
    数字上 A 闭合了，但**本会话从未执行过一次点名 `git add` / `commit --only`**，
    所以 §4 A 那条归属纪律（防"一笔吞掉别人 109 枚暂存"）没有接受过检验；
    而同一支笔完全可能把别人的半成品一起带走（00:0x 的 `2f735392` 就是这个形状）。
    📌 同一条也适用于 `src` 那格红：10:1x 它消失是**别人替本线清掉了**，不是我证明了打包输入干净。
    ⇒ 汇报里凡"这一项现在绿了"，都要能答"是**谁**用什么动作让它绿的"；答不出的，登记成状态而不是成绩。

27. 🔴 **文档/文件头里每一条"照这句做会得到 X"都是一条断言 —— 本轮第三次现形，这次是一条恒不过的假自检**（10:3x）。
    形状：`r14c-bundle-testid-preflight.sh` 的头注释写着"`NEEDLE_MISSING=task-due …` 必须让它 exit 1"，
    而那个旋钮**只存在于那行注释里**（代码读的旋钮是 `FRAGMENTS`，第 31 行）⇒ 照文档跑那条自检得到
    **rc=0 且照样打印"三枚碎片都在"**。前两次同一形状：`dist-freshness.mjs --only web`（不是合法参数，
    工具 rc=1 当场拒收）与 `docs-link` 印给下一位的那行归因 awk（跑不通，已换成实测跑通的形状）。
    📌 为什么值得单列：AGENTS §8.3 拦的是**不能失败的判据**；而**永远不会被跑到的自检不会让任何红灯亮** ——
    它只让下一位**以为自己验过了**，危害方向相反、检出难度更高。
    纪律：**写"复跑命令 / 自检步骤"之前当场跑一遍**，并把"此刻的 rc 与应有的那一次红"写在旁边；
    只改文档不改判据时也要跑（本轮正是这么发现的）。

28. 🔴 **截图有两种过期：字节过期会被 md5 对账抓到，主张过期没有任何东西会报红**（10:4x，H 的证据）。
    本轮实测的两笔：① 字节过期 —— 01:34 / 06:46 别人的 e2e 趟重写了同名 PNG，`r17-evidence-md5-check.sh --all`
    能抓到（10:4x 现量 rc=0、12 条全对）；② **主张过期** —— 图一个字节都没变，但支撑"这张图画的是当前交付"
    的现场动了：并行那笔 `39032107`（10:11）把日历 CSS **和**这两枚图一起放进 HEAD，之后 HEAD 又进了 2 笔
    动 `apps/web` 的提交 ⇒ README 里"拍到的不是 HEAD 的界面"按字面过期，而此刻能主张的只有
    **"图 == `39032107` 的界面"**。第 ② 类**门禁全绿、md5 全对、文件时间戳也不变**。
    📌 纪律：**把"这张图对应哪一笔提交"当成图的一部分写进证据 README**（本线从今天起这么写），
    并留一条 `git log -1 --format='%h' -- <该图路径>` 的复跑命令 —— "哪一笔"是可现取的，不该靠记忆。

29. 🔴 **"产物比源码旧"在"源码零脏行"的前提下照样发生 —— 它不是"别人 WIP 要进产物"的读数，别混用这两条判据**（10:4x）。
    B 的两条具名前置实测长这样：`git status --porcelain -- packages/op-log` ⇒ **0 行**（内容 == HEAD），
    同一时刻 `node scripts/dist-freshness.mjs --only op-log` ⇒ `🔴 产物比源码旧 35s —— src packages/op-log/src/engine.ts`。
    而且 10:2x 那一次指的是 `src/state.ts`、10:4x 这一次指 `src/engine.ts` —— **两条都在零脏行下发生**，
    因为提交/覆盖式解包都会刷新源码 mtime，而 dist 只在有人 build 时才动。
    ⇒ 后果不是措辞问题：我原先把它写成"要写共享产物所以不能动，因为那里面有别人的 WIP"，
    真实理由是 **写 `packages/op-log/dist` 会影响并行会话正在读的 dist**（§8.9 独占），两者动作完全不同
    （前者要"等别人提交"，后者只要"独占窗里跑一次 build"）。
    📌 **每条读数只回答它自己那个问题**：脏行回答"进产物的是不是别人的未提交代码"，
    mtime 回答"这台机器上的 dist 是不是当前源码"。混用会把一条只需 build 的前置登记成需要等别人。

30. 🔴 **扫描类判据打出的 `0` 有两种来源，而症状逐字相同：现场真的没有 / 扫描自己够不着**（10:5x，H 的 trace 扫描）。
    一枚 `ht_trace_scan` 里同时藏着两处够不着：`( cd "$x" && unzip "$f" )`（`find` 给**相对**路径时 cwd 一变就找不到文件）、
    `for f in $z`（**本仓绝对路径里有空格** —— `Desktop/All in one Data/…`，一枚 zip 被拆成 4 个"文件"），
    而两处失败都被 `-q` + `2>/dev/null` 吞掉 ⇒ 输出永远是 `connect=0 viteInTrace=no`，
    读起来正好等于"那一趟没有 HMR 洪泛"。**发现方式不是推理，是同一枚 zip 换个写法重扫了一遍**：
    09:3x 手扫是 3 条，10:5x 装置扫是 0 条 ⇒ 先怀疑探针（§7 元规则 1）。
    📌 三条纪律：① **任何"数出来是 0"的判据要自带阳性对照**（这里就是那条 `connect` 列）；
    ② 够不着时必须**响亮地换一个词**报（`scan=unavailable`），不许复用 `0` 那个形状；
    ③ 夹具要**故意覆盖本机路径的形状**（带空格），否则判据只在你没踩到的那类路径上有牙。
    同批还有一条：**别人那趟红的 trace 不能拿来当自己判据的现量** ——
    它连"这台机上红=洪泛"都没成立（那两枚 trace 里 `hotUpdated=0`、`fastRefreshInvalidate=0`），
    只能证明扫描这条路是通的。**借来的证据最多当阳性对照，不能当闭合。**

31. 🔴 **新增一档（子命令）之前，先回答"它在到达自己的分支之前执行了什么"**（11:0x，我自己造的第二次同一事故）。
    形状：脚本顶部的接线段（建每跑唯一的日志、`ln -sf` 挂稳定名、export 环境变量）在**所有分支之前**，
    所以"我只是加一个只查不跑的 `--scan`"这句感觉是错的 —— 它照样把稳定名摘走了，
    而摘走的是**另一条正在等窗口的现场**（看守 pid 32016）。
    上一次同一形状是 `--selftest`（09:2x），当时的修法是往那行 `if` 里加一个排除项 ——
    **排除名单本身就是下一次的事故来源**：它要求每个新档位都有人记得改那行。
    已改成允许名单（只有 `run` 挂），并把 `STABLE_LOG` 做成参数好让这件事**能被测**；
    `--selftest` 八臂里新臂两腿：`--scan` 后 `readlink` 没变（负向）+ run 档确实挂上（正向）——
    **没有正向腿，"接线坏了"和"接线正确地没动"是同一个读数。**
    📌 一般化：**副作用的守卫要写成"谁可以做"，不是"谁已经被抓到过"**；
    每加一档就去读脚本第一段，而不是只读自己那一档。

32. 🔴 **写进文档的前置动作，如果它实际的执行者是自动装置，就必须搬进装置本体**（11:2x，本线自己那条 §5 第 1 条）。
    形状最容易骗人："开跑前先跑一次体检"这句话读起来像是**已经在流程里**了，实际上它只约束
    "坐在终端前记得跑一下的那个人"。而 H 从 09:4x 起开跑者是看守脚本，
    `grep -n dist-freshness` 在那条脚本与两道等待 lib 里命中 **0** —— **一条从未被执行过的前置，
    输出上与被执行过的逐字相同**（日志里根本不会出现它，所以也没有"缺失"可看）。
    这不等于"判据不能失败"那一族（#33/#58），它是第三种：**判据没有执行者**。
    ⇒ 自查动作：文档里每一条祈使句（"开跑前先…""引用前必须…"），问一遍
    **"这句话被机器执行过吗，还是只被我引用过？"**；执行者是脚本的，把它变成脚本的一行输出。
    落地时两条取舍要显式写出来，否则会被读成偷懒：
    ① **记录不当门禁**——被搬进来的那个工具自己的文件头就声明"默认永远 exit 0，并行会话正在改源码时
    落后是正常状态"，把它升级成红等于本线摘走一条不属于本线的判据（AGENTS §8.3）；
    ② **判据钉形状不钉值**——selftest 只断 `pkgs=[0-9]+ behind=[0-9]+ missing=[0-9]+` 这个形状，
    断具体数字就把**上游现场**写进了判据（那是"别把上游当前状态写死"那一族，本仓已为此付过学费）。
    负向腿不必新建开关：臂4 那份**最小树夹具**里没有 `apps/web/package.json`，
    天然造得出"范围取不到"，装置必须自报 `check=unavailable` 而不是打一个像读数的 `behind=0`；
    变异（把 unavailable 那句改成 `pkgs=0 behind=0 missing=0`）⇒ selftest **rc=4、红集恰好 1 条**。

33. 🔴 **边界事故是双向的：Edit 也能"多吐一根分隔符"**（11:3x，我把一句话劈成了表格的第 5 列）。
    正方向那一半（`old_string` 吃到相邻块的边界行 ⇒ **静默删除**）只在本机的协作记忆里记过，
    **本文件此前没有这一条** —— 这次是**反向**：
    `new_string` 结尾多写了一根 `|`，同一个单元格里的一句话变成独立一列，工具不报错、渲染只是"多一栏"。
    ⇒ 改表格行的动作要把两边的**分隔符数量**当对齐项逐字数，改完立刻跑列数门禁，别靠肉眼。
    ✅ 顺带把"这条门禁能不能失败"也答了（AGENTS §8.3 要的是变异，不是代码阅读）：
    一次性脚本在唯一锚点上造一个错位 ⇒ `check:md-table-rows` rc=**1**，
    报的正是 `calendar-profile-handoff.md:485 列数 5（本表表头是 4）`，还原后 rc=0。
    📌 在**共享工作树**上做这种"改真文件再改回来"的变异，必须带防自伤阀，三件缺一不可：
    ① 锚点命中数≠1 就**放弃并退出**（这一趟不构成读数，而不是"门禁没抓到"）；
    ② **还原前先回读**：盘上已不是自己变异的那份字节 ⇒ 窗口内有人写过 ⇒ **不覆盖**
       （把自己的原件强写回去 = 抹掉别人那一笔，那才是真正的事故）；
    ③ 断言"还原一致=true"并把临时脚本删掉。本轮现量：`还原一致=true`、脚本已 `rm`。
    ✅ **35 秒后同一把门禁自己抓到了一次真实的（非注入的）外来错位**，值得留作这一条的正向半段：
    11:47:xx `node scripts/check-md-table-rows.mjs` ⇒ rc=**1**，报
    `docs/plans/trash-and-archive.md:2425 列数 4（本表表头是 3）`，成因与上面完全同族 ——
    别人在一格里写了 `` `closeAccount|close-account` ``，**反引号里的竖线照样分列**。
    那一行的所有者在 11:48:19 自己改掉了（同一趟 `md-tables` 复跑回到 rc=0）。
    ⚠️ 这一格差点被记成"我自己的工具瞎了"：`calendar-line-commit-plan.sh` 同一分钟打的是 `md-tables rc=0`，
    看起来与独立跑的 rc=1 矛盾。**把两次测量放进同一口气重跑**（standalone×2 + 工具×1 连发）才知道
    矛盾是**时间**造成的，不是代码造成的 —— 红集是活树的瞬时读数，两把门禁读的是同一份盘上的字。
    这正是 §5 里"引用旧读数前必须复跑"那条纪律的**最小可用版本**：先同口气复测，再谈谁的探针坏了。

34. 🔴 **一条"每跑必红"的判据不是判据；而"能不能钉常驻指纹"这件事本身要被量出来**（12:1x，同一份证据目录上连着撞到）。
    aa) 格登记的"那五枚没有常驻 md5"敞口，第一版答案是**给它们补一枚锚点**（`COMMITPIN`，比图片自己的提交号）。
    加完当场就被实测否证：11:55 那趟重跑把 `view-select-closed.png` 的字节换了（**同一笔代码**，差异只在左侧 rail 的 4982 枚像素），
    `day-en-full.png` 也换了（差异只在 `en-day-<6 位随机>` 那一行，468 枚像素）⇒ 任何以"这张图的字节"为锚的常驻判据
    在这个仓库里**每跑必红**。而 §8.3 那条元规则说的是：**永远红的判据会把人训练成忽略它**，
    它比没有判据更糟 —— 我差点亲手造出这样一条，并且是在一份已经写明"值每趟都换，所以它不能当指纹用"的 README 上。
    ✅ 正确的拆法是把两件事分开钉：
    **字节过期**只钉给**量出来跨趟相同**的图（本轮 `view-tabs-year.png` 与 `day-en-empty.png` 在重跑后与工作树/HEAD 逐字节相同 ⇒ 有资格）；
    **主张过期**钉**代码锚点**（`UIPIN <文件> <提交> <决定形状的路径…>`，判据 = 那些路径里最后一次动它们的提交 ≤ 钉的那笔）——
    重跑不红，界面代码动了才红。selftest 臂 6 就是这条的证据：**图字节一个字没变、源码动一笔 ⇒ 恰好 1 枚红**。
    📌 可迁移的两问：**这条判据在被约束对象"什么都没改"的那一趟会不会红？**（会 ⇒ 它钉错了对象）
    与 **"我凭什么说它稳定？"**（凭一次重跑后逐字节相同这个读数，不凭"看起来是同一屏"）。
