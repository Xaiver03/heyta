## 2026-10-12 09:4x · 第 105 道那八条红在新 HEAD 上重取（别线动了 `apps/web` 就得重取），顺带把 `ac8-matrix` 这枚漏网的装置第一次量了

**为什么要这一趟**：上一节那句"八条红里没有一条是本线的"取在载体 `422db1b2`，而 `422db1b2 → HEAD` 的差集里
有 **5 枚别线的 `apps/web` 代码文件**（`RailNavigation.tsx`、`inbox/InboxBell.tsx`、`lib/tab-roving.ts`、
`styles/app/inbox.css`，外加它们新加的 `tests/tab-roving.spec.tsx`）。⇒ 那句话描述的是"当时的树"，
必须在新树上重量，不能沿用。载体：`.worktrees/inb-t8` `checkout --detach` 到当前 HEAD，起跑脏条目 **0**（只有 `.run-logs/` 未跟踪）。

```
$ bash .run-logs/recheck-105-set.sh          # 串行，一条跑完立刻 echo RC=$?
CARRIER_HEAD=372068796dce35ce3a602fe567053339fc38418c   起跑 loadavg { 12.54 12.15 24.52 }
packages/ai            RC=1  Test Files 1 failed | 10 passed (11) / Tests 5 failed | 260 passed (265)
packages/legal         RC=1  Test Files 1 failed |  3 passed (4)  / Tests 2 failed |  74 passed (76)
packages/shared-schema RC=1  Test Files 1 failed | 10 passed (11) / Tests 1 failed | 172 passed (173)
apps/web               RC=0  Test Files 177 passed | 2 skipped (179) / Tests 2266 passed | 13 skipped (2279)
e2e 本线两份           RC=1  2 failed / 4 passed (2.3m)
```

- **八条红的形状逐包与 08:2x 那趟相同**（5 + 2 + 1 = 8，都不是本线的文件），`packages/ai` 那五条的根因行就是
  `Error: Command failed: … scripts/gen-ai-capability-manifest.mjs --check` —— 清单产物与上游目录不同步，仍属 AI 工具线。
- **`apps/web` 从 2247 passed 涨到 2266、失败仍 0、跳过仍 13** ⇒ 别线那笔 rail 键盘只是加了用例，没把这一包弄红；
  "测试数只许 ≥ 基线"这一格在新树上是**涨**的那一侧。
- **e2e 那两条红的还是同一格**（`tests/inbound-automation.spec.ts:8:3 encrypted date draft review and Vault invalidation`，
  1280 / 390 各一条，`locator.click: Test timeout of 60000ms exceeded`），另外四条（显式重试 ×2 + 面板排版取证 ×2）都过。
  ⇒ AC-6 那一格没有新缺陷，也**仍然**不开在 B140 的挂载点上。
- 🔴 **这一趟自己有一处探针错，如实记**：驱动脚本用 `grep -E '^(Test Files|Tests)'` 收汇总行，
  而 vitest 那两行**行首带空格**，于是当场什么都没打出来——读数靠重新 grep 磁盘上的 `.out` 才捞回来。
  这与下面 B185 那一类是同一个形状（判据静默空转），区别是这次**当天就发现**：日志里"RC=1 后面没有读数"这件事本身就是线索。

### `verify-inbound-ac8-matrix.py` 第一次在当前 HEAD 上量到读数（此前那 15 枚复账表里根本没有它）

```
$ python3 research/tools/verify-inbound-ac8-matrix.py
读数　表头行=1098　行数=34　有尺行=27　无尺行=7　尺枚=67　窗=13/13　平台=10/10　权益=9/9　设备状态=9/9
结论：矩阵与 HEAD 逐格对账成立                                                  → rc=0
$ python3 research/tools/verify-inbound-ac8-matrix.py --self-test
臂 1 尺路径不存在 ⇒ 红（R4）：成立　臂 2 用例名换造 ⇒ 红（R4）：成立　臂 3 删 W13 两行 ⇒ 红（R3）：成立
臂 4 证据归属掏成占位 ⇒ 红（R5）：成立　臂 5 平台写成散文值 ⇒ 红（R2）：成立　臂 6 静止对照 ⇒ 保持绿：成立
SELF_TEST=OK（六臂各自成立）                                                    → rc=0
```

这格补的是"**AC-8 那张矩阵表会不会读起来像有证据**"——矩阵引用的是用例名与文件路径，改名/删文件/维值写漂/无尺格没人认领
这四种都会安静地烂掉，而 markdown 表格自己永远不会失败。它此前不在任何复账表里，是因为那几趟按 `verify-inbound-*.py`
列清单时把它漏在"15 枚装置"的分母之外（现量：盘上 `verify-inbound-*` 正好 15 枚，其中这一枚从没被跑过）。
