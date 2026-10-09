# 这一趟在隔离副本上跑"本机有、仓库里没有"的六份界面测试 —— 载体与前置读数

取数时刻：2026-10-09 12:58 UTC（跑之前逐条现取，不沿用整族那一趟的读数）

| 项 | 读数 |
|---|---|
| 载体 | `/Users/rocalight/heyta-carriers/heyta-uxhead-1009` |
| 基线 | commit `b081811c`（= `9fa53ab9^`，**最近一棵能装能建的已提交树**；取法见台账 12:0x 那一格） |
| 起跑前载体工作树 | `git status --porcelain \| wc -l` = **0**（只有下面复制进去的 6 枚未跟踪 spec） |
| 专用端口 | 4318 / 4319 起跑前 `lsof` 均 **0 监听**；前置门 `PREFLIGHT_RC=0` 并打印「✅ 4318 / 4319 都是空的」 |
| 机器负载 | 起跑前 `vm.loadavg` 1 分钟 = **11.31**（本线自定的起跑阈值是 **12**；上一趟尝试时是 44，没起） |
| 命令 | `cd <载体> && node scripts/check-ai-e2e-preflight.mjs && cd e2e && npx playwright test tests/<六枚>.spec.ts` |
| 日志 | `/tmp/heyta-six-specs-run.log`（`SIX_SPECS_RC` 是这套件的退出码，**不是**包装命令的） |

## 复制进载体的六枚 spec（sha256 前 16 位，取自**主检出**那份）

```
borderless-ux.spec.ts        61436fa60b0a9a08
category-dialog-ux.spec.ts   645203d70ba5c352
data-transfer-ux.spec.ts     feb55bba5a589cd8
help-entry-ux.spec.ts        519ae3687bdcac1e
settings-category-ux.spec.ts 65fb637ef1edb9f6
ux-viewport-matrix.spec.ts   499527699a695e23
```

🔴 **为什么这六枚是"复制"而不是"载体自带的"**：它们此刻在主检出里是未跟踪状态（从没进过仓库），
所以任何一棵只含已提交内容的树上都没有它们。这一趟证的不是"仓库里那套件的通过情况"，
而是**这六份用例放到只含已提交代码的树上跑，会是什么结果** —— 两件事别读混。

## 起跑前先核对过的一件事（它决定这趟是不是"能跑成"的形状）

六份用例都从 `./helpers` 取公共函数。逐个问载体那份 `e2e/tests/helpers.ts`：
需要的是 `openApp / switchTheme / switchView / addTask / showDetailColumnContent / waitForOverlaySettled` 六个，
**载体里六个全有**（缺 0 个）。这一步不是仪式：账号面那枚已提交的用例正是因为 `helpers.ts` 里没有
`selectSettingsSection` 而在干净检出上收集就红（台账里那一格），所以"复制过来能不能被收集"必须先证，
否则跑出来的红会被误读成"界面有缺陷"。

---

# 读数（2026-10-09 13:15 UTC 收尾）

**`SIX_SPECS_RC=1`，`17 failed / 0 passed`，红标记 34 枚 ÷ 17 条 = 每一条都是首跑 + retry 双红、`flaky` 计数 0。**
起跑负载 11.31（阈值 12）、收尾 22.17 —— 那个"全双红 + flaky 0"的形状与整族那一趟一致，
指向**结构成因而不是机器慢**（同一条形状证据的第二独立实例）。

## 逐枚的失败原因，以及它属于哪一类

| spec | 条数 | 首条错误 | 这一红说的是 |
|---|---|---|---|
| `borderless-ux` | 1 | `expect(received).toBe('0px')` 收到 `'2px'`（`outline`） | 用例要求控件**无描边**，载体那棵树还画着 2px 描边 |
| `category-dialog-ux` | 7 | `locator.fill` 等 `#ht-category-create-name` 60s 超时；四档视口那 4 条等 `getByTestId('category-create-dialog')` 不可见 | 载体上**根本没有"新建清单弹窗"这个组件** |
| `data-transfer-ux` | 2 | `locator.click` 等 `[aria-controls="settings-group-data"]` 60s 超时 | 设置的分组导航在载体上是 `<a href="#…">`，不是带 `aria-controls` 的 `<button>` |
| `help-entry-ux` | 4 | `expect(...).toHaveCount(1)` 收到 **27**（`settings-sheet` 里的 `heading`） | 载体那份设置面是**一整页 27 个标题**，不是"一组一个标题"的分类 IA |
| `settings-category-ux` | 2 | `locator.click` 等 `settings-sheet` 内 `[aria-controls="settings-group-appearance"]` 60s 超时 | 同 `data-transfer-ux` 那一格 |
| `ux-viewport-matrix` | 1 | `600×800 不应横向溢出`：`docWidth` **742** vs 视口 600 | 🔴 **这一条不是定位符问题，是载体那棵树上量出来的一处真布局缺陷**（下面单列） |

## 这一趟真正关掉的那句话：闭合条件①在任何一棵已提交的树上都不可满足

台账里那格的闭合条件写的是「① 在一棵**能装能建**的已提交树上把这 20 条跑到绿」。**这一趟把①否证了**，
而且不是"没跑到绿"，是**结构上跑不到绿** —— 这六枚用例判的东西有 5 枚压根不在任何已提交的树里：

```
CategoryCreateDialog.tsx        主检出 `??`（未跟踪）   b081811c 里 `git cat-file -e` = NO
category-create-dialog.css      主检出 `??`             同上
borderless-controls.css         主检出 `??`             同上
apps/web/src/styles/**          主检出 vs b081811c：16 枚文件 +1864/−206（无描边/窄屏 rail/两栏 IA 全在这批里）
HelpPanel 的 about-link-feedback  b081811c 命中 0（台账另两格已量过 HEAD 也是 0）
App.tsx 的 aria-controls 分组导航  b081811c 命中 0；`href="#settings-group-` 命中 14
```

⇒ 所以"这六枚没入库"的成因**不是质量、不是归属犹豫，是取证口和产品代码本来就是一笔**：
把它们单独收进仓库 = 得到六枚在任何干净检出上必红的用例。台账那句"闭合条件是两条"要改写成
**"每一枚必须与它判的那半源码同一方同一笔落地"**，而不是"先跑到绿再提交"。

## 唯一那条不是"用例跑不到绿"的红：600×800 横向溢出

载体 `b081811c` 上，视口矩阵跑到 **600×800** 这一档时文档宽 **742**（阈值 601），
溢出 **142px**，`offenders` 前三名逐字是：

```
DIV    .ht-rail__sync              testId=sync-rail   left 699 → right 784
BUTTON .ht-rail__tab .ht-rail__sync…                 left 699 → right 784
SPAN   .ht-rail__label .ht-type-cap                  left 732 → right 775
```

也就是**底部那条导航横栏在 600px 下排不下，把"同步"那一块整个顶到屏幕右侧之外，并顺带把页面撑出横向滚动**。
失败那一刻的截图（Playwright 自动采集，已收进本目录
[`six-specs-viewport-600x800-overflow.png`](six-specs-viewport-600x800-overflow.png)）人打开看过：
底栏从左到右是 任务 / 日历 / 习惯 / 搜索 / 更多 / 回收站，**最后一项「通知」只剩半个词被右边缘切掉** ——
与量出来的 142px 对得上。

⚠️ **这一条不登记成本线的新缺陷，两条理由都要写清**：
① 它量的是 `b081811c` 那棵**旧树**，不是当前源码；
② 当前源码里已经有一批管这件事的未提交规则（`git diff --numstat b081811c` 现量：
`apps/web/src/styles/app/narrow.css` **+150/−7**、`inbox.css` **+184/−18**、`rail.css` **+18/−4**；
narrow.css 里 3 处 `.ht-compact-rail … .ht-rail__sync` 规则 + 1 处裸 `.ht-rail__sync`，
inbox.css 从 `@media (max-width: 768px)` 起也有一条 `.ht-rail__sync`），
而**本线已入库的那份 `apps/web/evidence/settings-finish/viewport-metrics.json`（29 行、由同一枚用例在主检出的工作树上跑出来）
在 600×800 那一档写的是 `docWidth=600`、溢出为 false** ⇒ 这个溢出在**当前源码上不复现**。
🔴 但同一份 json 里，375 / 390 / 600 / 768×400 四档的 `offenders` 都还列着
`.ht-rail__sync` 落在 **left 806 → right 918**（视口只有 375～600）——
"不再撑出横向滚动条"与"这块还在屏幕外"是两件事，前者是后者的**掩盖**。
这一格只登记为**读数**：本线没有一条判据在判"底栏的每一枚项都必须在视口内可达"，
而视口矩阵那枚用例只判 `docWidth` 与"顶部主操作在视口内"（`primaryInViewport`），恰好绕过了它。
