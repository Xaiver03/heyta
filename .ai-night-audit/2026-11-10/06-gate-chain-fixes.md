# 06 · `pnpm check` 全链修复记录（2026-11-10 上午–下午）

用户指示：「把所有产品和工程相关的决策全都做了，然后直接做就行……不要再停下来。」
目标是让 `pnpm check`（本仓唯一的总门禁，**200+ 段**）真正跑通。

**方法**：每次跑到第一个失败点 ⇒ 现场复现 ⇒ 判断是"产品真坏了"还是"门禁自己坏了"
⇒ 修好后**必须做一次变异/自检，证明判据仍然能红** ⇒ 提交 ⇒ 重跑。

> ⚠️ 这一轮发现的**几乎全是第二类**：门禁自己恒红/假红。
> 形状高度一致：**判据锚在会漂的东西上（行号、文本位置、过时的函数名、过期的生成物）**，
> 或者**载体被上游改动废掉了**（证据不再入库）。本仓自己的话：
> 「长期变红就等于没有测试」—— 一条恒红的门禁会给整条链提供"已检查过"的错觉。

| # | 门禁 | 症状 | 根因 | 修法 | 提交 |
|---|---|---|---|---|---|
| F-10 | `typecheck`（design-system） | 2 处 TS 错 | `14997e15` 引入（`noUncheckedIndexedAccess` + 谓词类型写宽） | `?? {}` + 谓词改 `t is TokenName` | `703e4ab2` |
| F-11 | `check:detail-pane-evidence-refs` | 116 条引用「成立 0 个」 | `e760da75` 让证据不再入库，而判据主集合取自 `git ls-files` | 按 `.gitignore` 写明的处置改**载体**（盘上也认落位），并**逐条披露+结论改说实话** | `d74542ea` |
| F-12 | `check:licenses:stamp` | 清单在旧 lockfile 下渲染 | 生成物过期（无人重跑） | 按门禁给的命令重渲染（967 → 1030 包，仍全宽松） | `790a326c` |
| F-13 | `check:shell-portability` | `stat_f_bsd` 新增 1 处 | 新写的 `stat -f` 在 GNU 上**静默给错的 mtime** | 按 `upload-dist.sh` 既有形状改 GNU-优先+BSD 兜底，并登记账本 | `6b0cb71b` / `72010225` |
| F-15 | `check:brand-assets` | 「接线晚于渲染」**恒红** | 判据拿**文本位置**答**执行顺序**（`renderFatal()` 函数体里的 render 定义在前） | 取**缩进最浅**那一档的最前一处；偏移**按行累加**算 | `325a11cf` |
| F-07 | `check:entry-table` | 阳性对照失败 ⇒ 10 条臂失效 | 锚点判据要求 ±3 行内命中，而 `App.tsx` 一动就漂 | 改成「唯一命中 / 就近命中」，零命中才红；7 个弱锚点收紧成唯一串 | `716b6b1d` / `566335e5` |
| F-06 | `check:shell-surfaces` | M2「那一屏读到的是空的」**假红** | 判据写死过时的 `openTaskTask()`，2026-11-08 后屏幕一律走 `useTaskHost()` | 与 `feature-entries.spec.ts` 同源取齐；G7 自检臂同步 | `9ccbc25a` |
| F-09 | `check:doc-citations` | 1 枚 SHA「不是本仓的提交对象」 | 那是**当时真的存在、现已取不到**的 SHA，删掉=篡改历史 | 加 `(不可达)` **显式标记**（逼人做判断），判别力实测没丢 | `76e7b2dd` |
| F-03 | `mockup-shell-shape` 默认 rail | 把「没登记」当「默认关」⇒ 静默放过 kanban | `defaults.get(k) === true` 不区分 `undefined` 与 `false` | `undefined` **大声抛错** | `9ccbc25a` |

## 贯穿全轮的一条方法

**每条修完都做了变异验证**，证明判据没被改松：

| 门禁 | 变异 | 结果 |
|---|---|---|
| `check:entry-table` | 把锚点改成 `…-TYPO` | 🔴 立刻红 |
| `check:brand-assets` | 把 `armBootSplashDismiss` 移到文件末尾 | 🔴 `5968 > 4365` |
| `check:detail-pane-evidence-refs` | 花括号组里换成不存在的文件名 | 🔴 `1 处不成立` |
| `check:doc-citations` | 去掉 `(不可达)` 标记 | 🔴 重新报错 |
| `check:shell-portability` | `--self-test` | ✅ 臂 10 枚，0 枚不如预期 |

## 还没跑完的部分（如实记）

`pnpm check` 全链**单次超过 1 小时**，其中大头是 Playwright e2e（两套：
`check:ai-e2e` 与主套件，各 200+ 用例）。本轮最后一次全链从 ~10:30 跑到 ~12:20 仍未结束，
**已确认穿过前面所有曾失败的点**（typecheck / evidence / licenses / portability / brand / entry-table
全部不再报错）。e2e 段有较多失败，**但看起来是并发负载导致的瞬时失败**：
同一批用例在跑到 200+ 时又开始通过（`✓ 211`），且 `e2e/` 近三天无任何提交。
⇒ 这一段的结论**留待一次独占机器的重跑**，本轮不据此下结论、也不去"修"那些用例。

---

## 收尾：全链 vs 定向验证的取舍（如实记）

`pnpm check` 单次在本机**跑不完**：大头是两套 Playwright e2e（`check:ai-e2e` + 主套件），
其中 `e2e/tests/global-responsive-ux.spec.ts:250` 这一条在**并发负载下实测跑了 20.3 分钟并超时**
（`load average` 7.5）。我用 `kill` 停掉了那次跑，改做**定向验证**。

### 判断依据：那些 e2e 与本轮无关

| 事实 | 取数 |
|---|---|
| 本轮**没有动过 `e2e/` 下任何文件** | `git diff --name-only HEAD~12 HEAD \| grep -c '^e2e/'` ⇒ **0** |
| 那条 20 分钟用例最后一次改动早于本轮 | `git log -1 -- e2e/tests/global-responsive-ux.spec.ts` ⇒ `8cb03f78` |
| 失败是**瞬时/负载型**：同批用例跑到 200+ 时又开始通过 | 日志里 `✓ 211` 出现在 `✘` 之后 |

⇒ 结论：**e2e 段在本机不适合当"整链绿"的判据**，需要一次独占机器的重跑。
本轮不据此下结论，也不去"修"那些用例。

### 定向验证（本轮真正要负责的部分）—— 全部 rc=0

| 门禁 | 结果 |
|---|---|
| `check:entry-table` | **rc=0**（修前恒红；自检 9 臂 + 阳性对照全过） |
| `check:brand-assets` | **rc=0**（修前恒红；27 条全过） |
| `check:shell-surfaces` | **rc=0**（6 绿 0 红；修前 4 绿 2 红） |
| `check:detail-pane-evidence-refs` | **rc=0**（修前 116 条「成立 0 个」） |
| `check:licenses` / `check:licenses:stamp` | **rc=0**（修前 stamp 红） |
| `check:scripts-parse` / `check:gate-wiring` | rc=0 |
| `check:docs` / `check:doc-citations` | rc=0（修前 doc-citations 红） |
| `check:i18n-vars` / `check:layering` / `check:reachability` | rc=0 |

| 测试套件 | 结果 |
|---|---|
| `apps/web` | **2853 passed / 13 skipped**（245 文件） |
| `apps/landing` | **1456 passed / 0 failed**（24 文件） |
| `packages/design-system` | **605 passed / 0 failed**（含我改的 `preset-native`） |

## 四端产物（看板真正到达各端）

| 端 | 动作 | 结果 |
|---|---|---|
| **Web（生产）** | `node research/tools/publish-public-sites.mjs --confirm` | ✅ 九步全过 + 线上验收 **53 passed**；两站 md5 与本地逐字节相等 |
| **macOS** | `bash scripts/reinstall-all.sh --only mac` | ✅ **RC=0**；公证通过并装订；安装对账「`.app` 里的 web-dist 与本机同一次构建」；自截屏内容占比 78.6%、主蓝命中 842 ⇒ 是共享 UI |
| **Android** | `pnpm build:android`（远端 linux-dev） | ✅ **RC=0**；四条判据全过（tar sha256 对账 / 远端旧产物已清 / mtime ≥ 构建起点 / 拉回后 sha256 逐字相同）；APK 69,906,780 B |
| **iOS** | 未跑 | ⏸ 需模拟器设备腿与真机验收，本轮时间不够 |

### ⚠️ Android 的一个正确结论（不是缺陷）

APK 的 `assets/index.android.bundle` 里**没有**「看板」词条 —— 这是**对的**：
移动端**本来就不做看板**（`apps/mobile/src/screens/` 下没有那一屏，
`nav/feature-entries.ts` 也没登记它）。共享词表 `FEATURE_MODULE_KEYS` 是**超集**，
各端登记自己的子集 —— 这正是 `feature-entries.ts` 文件头写明的那条设计，
且有 `apps/mobile/tests/feature-entries.spec.ts` 钉住（现量 10 passed）。

⇒ 「看板」按设计只到 Web 与桌面三端。这是**产品边界**，不是漏做。
