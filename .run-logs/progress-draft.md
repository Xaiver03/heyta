## 2026-10-12 09:5x · 查出的一类："本线 15 枚装置零消费者"；地界内接住 5 枚常驻并两臂反向验证，剩下要动别人文件的登记成 B185

- **这一类怎么发现的**：给 T8 复账列装置清单时按 `verify-inbound-*` 数了一遍盘，现量 **15 枚**，
  而我此前那张 15 行复账表里**根本没有 `verify-inbound-ac8-matrix.py`**（它从没被跑过）。
  顺着"还有多少枚也一样没人跑"去量分母：**所有 `package.json`（含各包）0 命中、`scripts/` 0、`.github` 0、
  根 `check` 链正则测 `false`、无 glob 循环**，唯一的引用是两枚测试里的注释行 ⇒ 这批尺坏了没有任何东西会红。
  对照惯例：`research/tools` 在 `scripts/` 里有 41 处命中（`check-linux-shell.mjs:42` 就是这种消费）。
  仓里那枚管"门禁必须真的在链里跑"的 `scripts/check-gate-wiring.mjs` **拦不到这批**，因为它们从未被声明成门禁。
- **地界内做掉的**：新增 `server/tests/inbound-lane-rigs-consumers.spec.ts`（`server/tests/` 在白名单内，零新依赖，
  只 spawn 已在本仓被多处使用的 `python3`）。常驻 5 枚对仓库只读的装置，**11 条用例 `SPEC_RC=0`（整份 59.7 s）**：
  `ac-ticks` / `ac8-matrix` / `doc-tables` / `cjs-require-order` / `producer-seam`，外加两条分母自检
  （盘上多一枚未登记的装置 ⇒ 红；名单里留一枚盘上已不存在的 ⇒ 红；接进来的每一枚要么有 self-test 腿要么写下为什么不跑这条腿）。
  定向 tsc 也过了（`TSC_RC=0`）—— 注意 `server/tsconfig.json` 的 `include` 只有 `src/**` 与 `scripts/**`，
  **server 的测试文件本来就在类型层之外**（B175 末尾记过这一格），所以这一趟是我自己补的定向检查，不等于链上有。
- **两臂反向验证**（`bash .run-logs/teeth-check.sh`，只在隔离副本里造，全部当场还原）：
  臂 A 把 `ac-ticks` 复制成一枚未登记的 `verify-inbound-aa-unregistered-probe.py` ⇒ 分母自检 **RC=1**
  （`AssertionError: expected [ Array(1) ] to deeply equal []`），删掉 ⇒ **RC=0**；
  臂 B 在这只副本的计划工作树副本上把 AC-1 勾成 `[x]` ⇒ `ac-ticks` 打
  `AC 行=8 已勾=1 未勾=7 … 有 1 枚 AC 被勾上 —— 执行者不许自己勾（R2 红）`、spec **RC=1**；
  `git checkout --` 还原后现量 **未勾=8 已勾=0 计划脏条目=0**，spec 回 **RC=0**。
  ⇒ 交付态 AC 仍是 0 勾，这一臂是取证用的临时变异，不是把 AC 勾上。
- **两处"接线名单"在跑之前就被否证掉**（不是读数出来才返工）：① 带引号的 `grep "'--self-test'"` 让我误判
  `producer-seam` 没有反向验证臂 —— 它用双引号写法，引号无关地重量：**除 `worker-identity` 外 14 枚全都支持**；
  ② 三枚牙臂（`queue-teeth`/`quota-teeth`/`ticket-teeth`）我本来要一起接，读实现才看见它们的臂
  **临时改写被跟踪源文件**（`verify-inbound-queue-teeth.py:33` `TARGET = server/src/automation/inbound.routes.ts`，
  备份在 `/private/tmp/…mut-bak`）⇒ 挂进并发套件等于在共享检出里开一段源码被改坏的窗口，按 AGENTS §8.9 只能手跑，
  已从常驻名单里拿掉并写明理由。`producer-seam` 的 `--self-test` 单趟实测 **172 s**（其余四枚合计约 30 s），
  所以只常驻它 normal 那一腿，self-test 腿为什么没跑写死在文件里。
- 🔴 **地界外那一半登记成 B185**（可粘形状与两臂判据都在条目里）：把这 5 枚接进 `pnpm check` 链要改**根 `package.json`**；
  要让三枚变异牙臂也常驻需要一把独占锁/单独串行载体；`plan-audit`（B184）与 `commit-scope`（B169）在这两格裁决前必须留在"不接"名单。
- **第 105 道那八条红在新 HEAD `37206879` 上重取过**（原因：`422db1b2 → HEAD` 差集里有别线 5 枚 `apps/web` 代码文件）：
  `packages/ai` `5 failed | 260 passed`、`packages/legal` `2 failed | 74 passed`、`packages/shared-schema` `1 failed | 172 passed`
  = **8 条，逐包与 08:2x 那趟相同，都不是本线**；`apps/web` **`2266 passed | 13 skipped`、失败 0**（比上趟涨 19 条，是别线新增用例）；
  本线 e2e 仍 `2 failed / 4 passed`，红的仍是 `inbound-automation.spec.ts:8:3` 那两档（`locator.click` 60 s 超时）= B140 那一格，没有新缺陷。
  ⇒ **完成条件 1 里"T7 三条 exit 0"仍不成立**（`TEST_RC=1` 的成因还是别人的红），AC 一格未勾。
- **这一份新 spec 没有把同包别处弄红**（`server` 整包在同一只隔离副本上重跑，日志 `.run-logs/server-all-after-consumers.out`）：
  `Test Files 161 passed (161)` / `Tests 2806 passed | 1 skipped (2807)`、驱动自己回 `SERVER_TEST_RC=0`。
  唯一那 1 条 skip 落在 `tests/migration-sql.spec.ts`（29 tests | 1 skipped），**不是本线那份**：
  `git show HEAD:server/tests/migration-sql.spec.ts | grep -c 'it.skip\|describe.skip\|test.skip\|it.todo'` 现量 **2** ⇒ HEAD 里本来就挂着；
  本线这份 spec 里 `.skip`/`.todo` 现量 **0**。⚠️ 一条代价如实记着：本线这 11 条要 **60.5 s**（占整包 347 s 的 17%），
  因为它们是**真起子进程跑 Python 装置**，这正是"能红"的代价，不改成 mock。
