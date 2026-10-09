# 整族 `check:ai-e2e` 的第一份可用读数（隔离副本 `b081811c`，2026-10-09）

**这是什么**：`pnpm check:ai-e2e`（289 条 Playwright 用例）第一次跑在一棵**只含已提交内容、能装能建**的
隔离检出上。之前那些趟要么跑在带别人未提交改动的主检出（只能当失败清单），要么根本没跑成。

```bash
# 载体与这棵树怎么来的，见 docs/plans/product-ux-optimization.md 里"载体这棵树怎么钉的"那一格
cd /Users/rocalight/heyta-carriers/heyta-uxhead-1009
NO_COLOR=1 pnpm check:ai-e2e          # 52.6 分钟，rc=1
```

## 结论（逐条都能对着 `run-summary.json` 复核，别照本文散文）

`289 tests` → **266 passed / 21 failed / 2 skipped / 0 flaky**，`E2E_FAMILY_RC=1`。

- **红集不是本线的**：10 枚 spec（`narrow-sweep` 5、`pages-sweep` 4、`ai-row-layout` 2、`ai-tool-run` 2、
  `detail-pane-task` 2、`quadrant-layout` 2、`ai-assistant` 1、`countdown` 1、`detail-pane-collapse` 1、
  `detail-pane-overlay` 1）。本线在这棵树里能被收集到的 `account-menu` / `inbox` / `settings-exit` 全绿。
- **负载不是解释（至少对红集整体不是）**：42 个红标记 ÷ 21 条唯一用例 = **每一条都首跑与 retry 双红，`flaky` 计数 0**。
  抖动会长出一红一绿。⚠️ 这句只对"形状"成立；那 9 条 `click/fill` 超时到底是不是负载，**这趟没回答**（见下"没闭合的那格"）。
- 错误类型：**13 timeout / 6 `expect(...)` 断言 / 2 自定义文案**（`界面上没有详情列`、`界面上找不到这个元素`）。

## 数失败用例的正确姿势（这里踩过一次）

`NO_COLOR=1` 在这条 `pnpm → playwright` 链上**会被顶掉**——日志里原句印着
`Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.`（pnpm 设了 `FORCE_COLOR`）。
⇒ 按旧处方直接 `grep '✘'` 会数出 **0**。先剥 ANSI 再数：

```bash
python3 -c "import re;print(re.sub(r'\x1b\[[0-9;]*m','',open('<日志>')).read().count(' ✘'))"
```

## 这格读数不证明的三件事

1. **不是当日 HEAD 的行为**：载体钉在 `b081811c`，比 `c04e34e4` 早 3 笔
   （`git merge-base --is-ancestor c04e34e4 b081811c` = NO）。HEAD 上那枚
   "已提交 spec import 了 HEAD 里不存在的 helper export ⇒ 干净检出必红"的地雷，这趟**走不到**。
   当前 HEAD 也装不上、打不出包（台账里 `fee83a90` / `9fa53ab9` 那两格），所以这不是"暂时没跑"，是结构上取不到。
2. **不覆盖主检出**：那棵树上别人在飞的未提交改动一个都不在这里，反过来这趟的红也不能记到他们头上。
3. **那 9 条 `click/fill` 超时是不是负载**：这一问当场被**静态证据链**关掉了，不需要等安静窗口
   （先记一条反面：本线曾按老规矩去发定向复跑，起跑时 `load1=44.54` 而前置立的是 **12** ——
   那一趟跑到第 23 条被我主动停掉并**按无效读数处理**，它没有回答任何问题）。
   链条四步，每步都可复跑：
   ① 失败调用日志写的是 `waiting for getByRole('tab', { name: '番茄钟' })`，
      也就是**元素从来没出现**，不是被别的层拦住；
   ② 同一目录里 Playwright 自己存的 `test-results/narrow-sweep-塌缩态扫描：番茄钟-chromium/error-context.md`
      在那一刻的 a11y 快照里只有 `tab "任务" / 日历 / 习惯 / 搜索 / 回收站` 五枚 —— **低频视图根本不在主段**；
   ③ 被测那棵树的设计裁决就在 `apps/web/src/App.tsx:2140`：「主段最多 5 个按钮（四个高频目的地 +「更多」），
      低频目的地通过「更多」保持可达」，而 overflow 那批渲染成 `role="menuitem"`、
      装在一个 `role="menu"` 里，**且只在 `moreOpen` 为真时存在**（`App.tsx:2206–2226`）；
   ④ 顺带否证掉我自己两个第一猜想：词条没改名（`web.shell.views.*` 的中文值逐字就是 番茄钟/成长/便签/时间线），
      `enableAllModules` 写的键与 registry **逐字一致**、`STORAGE_KEY` 也同名（`modules.ts:78–131`）
      ⇒ 不是"模块没被打开"，是"打开了也不会在主段出现"。
   ⇒ 这 9 条是**用例定位符与那格「最多 5 个按钮」裁决之间的漂移**，确定性失败，与负载无关 ——
   这也正是 `42 个红标记 ÷ 21 条用例、flaky=0` 那个形状该给出的解释。
   ⚠️ **没有查的一项**：为什么 `四象限` 在宽档（`pages-sweep`）过、在 660 窄档不过。
   候选是 `splitRailTabs` 会把**当前视图顶进主段**（`view-tabs.ts:317/332`）加上窄档另有一条 collapse 分支，
   但这一条本线没有单独取读数，别当成结论。
   **归属**：`narrow-sweep` / `pages-sweep` 与 rail 那一片都不是本线资产（这套收纳是 UX-S9-22/23 那两格落的机制），
   本线只交这条链和复跑口径；修法在他们那一行（先展开「更多」再点 `menuitem`，或改按 testID 定位），本线不代改。


## 基线（要复核这趟是不是同一棵树，取这几枚现量）

| 项 | 值 |
|---|---|
| commit | `b081811c691a17ff57ed0379a005d1a175fe393d` |
| tree | `5dceff75d44e57d7e87d680ffc0b90afe496bb09` |
| 未提交路径数 | `git status --porcelain \| wc -l` = **0** |
| `e2e/pnpm-lock.yaml` | sha256 前缀 `021a9df4add85253` |
| `apps/web/dist/index.html` | sha256 前缀 `f9c1b85615f63e4e5a4e98c2` |
| 负载 | 起跑 `load1=7.68` / 途中现量 `36.94` / 收尾 `12.23` |

⚠️ `dist` 那枚哈希只是"这棵树打过包"的证据：这套件的界面由 **vite dev 现编译源码**，不走 `dist`，
所以 AGENTS §7 第 27 条那一族（旧 bundle 冒充新代码）在这趟里的形状是"给 `packages/*` 的构建用"，
界面侧新鲜度由**起跑那一刻** `git status --porcelain | wc -l` = 0 担保。
⚠️ 09 日复量时发现这句要加一个时间限定，因为**这趟运行本身会把树改脏**（见下面那一节）——"跑完之后 status 为空"从来不成立，能担保的只有"起跑前为空"。


## 🔴 复量查出一条比红集更影响"下一位怎么用这份证据"的事：整族运行会**就地改写仓库里已跟踪的证据图**

取数时刻 2026-10-09 12:0x（UTC），全部现量：

| 读数 | 值 |
|---|---|
| 载体里被改写的**已跟踪**证据文件 | `git status --porcelain -- apps/web/evidence \| wc -l` = **152** |
| 字节量 | HEAD 侧合计 10,544,925 B → 运行后 10,718,650 B（**+173,725**），逐枚清单见 [`carrier-evidence-churn.txt`](carrier-evidence-churn.txt) |
| 谁在写 | `grep -rln "apps/web/evidence" e2e/tests/*.ts` ⇒ **20+ 枚 spec**（calendar / detail-pane / habits / admin / countdown / assistant …），跨好几条线 |
| 主检出此刻 | `git status --porcelain -- apps/web/evidence \| wc -l` = **330**，mtime 落在 14:21–14:30（**不是本线那趟**，是别线的运行） |

为什么这条比"哪 21 条红了"更要紧：**证据一旦由"提交进仓库的截图"变成"最近一次跑出来的截图"，它就再也不指认任何一棵树**。
任何一次 `pnpm check:ai-e2e`（它在 `pnpm check` 里）都会覆盖它们，而覆盖动作没有归属、没有门禁、也不需要谁同意；
下一次有人宽 `git add` 就会把 330 枚截图连同别人的改动一起提交，提交信息里不会提到这件事。
这与 §7 第 83 条那一族（探针会改变被测对象的状态）同型，只是被改变的不是应用状态而是**仓库里的证据**。

✅ **本线自己那一份已经修掉了**（同日）：`scripts/qa/reminders-data-responsive.mjs` 原先默认落在已跟踪的
`apps/web/evidence/reminders-data-responsive`（47 枚），现在**目标目录里有已跟踪文件就在起跑前响亮拒绝**，
要覆盖必须显式 `HEYTA_ALLOW_TRACKED_EVIDENCE=1`。五臂读数（零浏览器）：无 flag **rc=1** ×2、
带 flag **rc=0**、未跟踪落点 **rc=0**、未知腿 **rc=1**（腿校验先于落点校验）。
⚠️ 这只收掉**一枚写图者**；那 20+ 枚 spec 的行为没变，本仓的证据覆盖问题仍然开着。

载体侧已做的处置（可复跑、可回退）：`cd <载体> && git restore -- apps/web/evidence` ⇒ `git status --porcelain | wc -l` 回到 **0**、
`git rev-parse --short HEAD` 仍是 `b081811c`。**主检出那 330 枚没动**（那是别线运行的产物与在飞状态，归属不在本线）。

修法方向写在这里但不代改（写图的 spec 分属多条线，且"证据要不要由运行自动覆盖"是判据口径，得负责人拍）：
① 运行期截图只落 `e2e/test-results/**`（未跟踪），入库证据改成**显式**的"采集/晋升"动作；
② 或给每条 spec 一个 `--evidence-dir` 旋钮，默认指向临时目录，CI 与门禁永不写跟踪路径；
③ 无论哪种，都该有一条能红的门：**跑完整族之后 `git status --porcelain -- apps/web/evidence` 必须为空**，
非空就报出枚数与清单（上面那条命令就是它的取现量版本，152 / 330 可当基线，只应减不应增）。
