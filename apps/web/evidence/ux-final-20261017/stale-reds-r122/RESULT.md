# r122：复量两格"在案红"——都用现量关掉，而且都补了牙

跑于 2026-10-17 23:1x，载体 = 主检出 `HEAD=90bafb87`（`git rev-parse HEAD` 现量）。
两格都是台账里挂着 `- [ ]` 的"在案红"，登记时成立、之后归属线自己提交了东西，但没人回来把格子关掉。

## 格 A：`docs/plans/product-ux-optimization.md:1458`（HEAD 里那份 spec 的 import 断链）

登记的原话是：`c04e34e4` 提交的 `e2e/tests/account-email-change-and-sessions.spec.ts`
import 并在 4 处调用 `selectSettingsSection`，而 HEAD 的 `helpers.ts` 里没有这枚 export
⇒ 干净检出上这份套件必红（Playwright 只转译不做类型检查，取到 `undefined` 就 `is not a function`）。

现量三条：

| 取法 | 登记时 | 现在 |
|---|---|---|
| `git show HEAD:e2e/tests/helpers.ts \| grep -c 'function selectSettingsSection'` | 0 | **1**（形状是 `export async function selectSettingsSection(`，在 `:405`） |
| `git grep -c selectSettingsSection HEAD -- e2e/tests/account-email-change-and-sessions.spec.ts` | 5 | 8 |
| 是哪一笔补上的 | — | `63e61f23 feat(web): 产品体验线 + 全局响应式 + 认证/法务冻结 + 证据与测试` |

⇒ **坏形状已不在 HEAD 里**。更要紧的是这一族现在有一枚门在守：`pnpm check:e2e-helper-exports`
（接在 `pnpm check` 链里），主检出上跑是 `射程 177 份文件 / 对账 581 个导入名 / 缺失 0 个`、`rc=0`。

### 那枚门有没有牙（变异对照，两臂差集）

在只含 HEAD 内容的临时树里（`git archive HEAD e2e scripts packages/sync-core/src` 解到空目录，
无 `.git` ⇒ 门禁自己退回文件系统遍历，输出里带那句 ⚠️ 限定）：

- **基线臂**（未变异）：`selectSettingsSection` 命中 **0** 条，`缺失 5 个`。
- **变异臂**（把那行 `export` 摘成 `async function selectSettingsSection_MUTATED_(`）：
  命中 **11** 条，`缺失 16 个`。差集里第一行就是
  `🔴 e2e/tests/account-email-change-and-sessions.spec.ts → ./helpers selectSettingsSection：目标文件没有这个导出`。

⚠️ **两臂的 `rc` 都是 1，所以结论只能取差集**：基线那 5 条缺失是
`e2e/vault/ai-egress.spec.ts → ../../packages/sync-core/dist/index.mjs` 这一族 ——
`dist` 是**构建产物**，`git archive` 永远解不出来。这正是台账 2265 那格早先记过的
"部分解包会自己造红"，也是 §7 #460 那一族（拿 rc 当结论会被一条无关噪声顶掉）。
⇒ 要拿 `rc=0` 的读数，得在主检出（已构建）上跑，就是上面那条 `缺失 0 个`。

## 格 B：`docs/plans/product-ux-optimization.md:2265`（干净检出上 `check:locator-labels` 红 14 条）

登记的原话是：把三份真源一起解到仓外空树，用 HEAD 自己的 checker 跑 HEAD 那五枚旅程脚本 ⇒
`HEAD_TREE_RC=1`，红的是 `tasks-ux-android.py` 与 `tasks-ux-ios.py` 各 7 条，
归因是"脚本已入库、它们断言的标签所依赖的产品代码还没入库"。

复量（同一把尺、同样三源一起解：`scripts` + `packages/i18n/src/locales` + `apps/mobile/src`）：

```
HEAD_TREE_RC=0
词条真源分母：zh 4110 键 / en 4110 键 / 移动端读走的键 1348 个
```

对照登记时那行分母 `zh 3951 / en 3951 / 移动端读走的键 1294` ⇒ 词表与移动端读走的键都涨上去了，
那两枚脚本现在**在只含 HEAD 的树上也过**。当时缺的那批键确实在 HEAD 里了，例如：

```
git show HEAD:packages/i18n/src/locales/zh-CN.ts | grep -n "viewOptions"
  3132:  'mobile.tasks.viewOptions.title': '视图选项',
  3134:  'mobile.tasks.viewOptions.close': '关闭视图选项',
  3135:  'mobile.tasks.viewOptions.dueMode': '日期显示',
git grep -n "viewOptions" HEAD -- apps/mobile/src
  HEAD:apps/mobile/src/screens/TasksScreen.tsx:370  …t('mobile.tasks.viewOptions.title')…
```

⚠️ **本线自己在这格上先踩了一次探针坑，写下来免得下一个人复现时误判**：
第一次取现量用的是 `grep -c "'viewOptions.title'"` ⇒ 回 0，看着像"键还是没入库"。
实际键名带前缀（`mobile.tasks.viewOptions.title`），**锚点要按整键取**，
或直接 `grep -n viewOptions` 不锚引号。上面那三条才是真形状。

输出里剩下的都是 `⚠️ 披露（**不判红**）`：`tasks-ux-android.py` 21 条、`tasks-ux-ios.py` 3 条、
`ai-assistant-atomic-android.py` 1 条单语定位 —— 那三枚脚本是任务旅程与对话助手那两条线的资产，
闭合判据按登记原话是"改完之后那行 ⚠️ 自己消失"，**不由本线代改**。

## 这一趟不证什么

1. 不证那两枚 `tasks-ux-*.py` 在英文设备上点得到 —— 单语定位那一档仍开着，归该线。
2. 不证 Playwright 那 177 份 e2e 在真浏览器上全绿；本趟只证**命名导入对账**这一层
   （`is not a function` 那一类），跑 e2e 要载体与构建，不在这一趟。
3. 不证 `check` 整链在干净检出上全绿 —— 台账里那几格"装不起来 / 打不出包 / `check:layering`"
   的归属没变，本趟没重测它们。
4. 变异只在临时树里做，主检出与真实索引没被改（`git status` 那两枚文件不在本批里）。
