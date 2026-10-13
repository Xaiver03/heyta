## B185（2026-10-12 09:4x，本会话 · 补"装置零消费者"这一类的自动载体时，现量出来的另一半落在地界外）：本线 15 枚 `research/tools` 装置五路分母全 0；白名单内已经接住 5 枚常驻，剩下要动的是别人的文件

**现量**（这一格成不成立不看正文，看这五行）：

```
$ grep -rn "verify-inbound" --include=package.json . | grep -v node_modules | wc -l   → 0   （含各包在内，一份都没有）
$ grep -rln "verify-inbound" scripts/ .github | wc -l                                  → 0
$ node -e "const p=require('./package.json');console.log(/verify-inbound/.test(Object.values(p.scripts).join(' ')))"  → false
$ grep -rn "verify-inbound-\*" scripts/ package.json .github                           → 空（没有 glob 循环式消费）
$ ls research/tools | grep -c '^verify-inbound'                                        → 15
```

唯一"引用"它们的两处是注释行（`server/tests/integration/inbound-dual-host-fault-windows.integration.spec.ts:23`、
`server/tests/inbound-ticket-rejection-route.spec.ts:28`）——提到 ≠ 跑。**所以这批尺坏掉不会有任何东西变红**，
B184 只是这个类里恰好被点名的一枚。

**对照仓内惯例，这条不是苛求**：`research/tools` 在 `scripts/` 里有 **41** 处命中，别的线就是这么把研究装置变成常驻尺的
（`scripts/check-linux-shell.mjs:42` 消费 `research/tools/check-native-lib-registry.mjs`）。而仓里专门有一枚
`scripts/check-gate-wiring.mjs` 拦"定义过的门禁必须真的在链里跑 / 链外必须有可验消费方"——**它拦不到这批**，
因为它们从未被声明成门禁，只是躺在 `research/tools/` 里。这一格红过之后不会有人知道，正是任务书要反向验证的那一类。

**本会话已经在白名单内做掉的那半**：新增 `server/tests/inbound-lane-rigs-consumers.spec.ts`，把 **5 枚对仓库只读**的装置
（`ac-ticks` / `ac8-matrix` / `doc-tables` / `cjs-require-order` / `producer-seam`）连各自的 `--self-test` 一起接进 `pnpm -r test`，
并钉一条分母自检：盘上多出一枚没登记的 `verify-inbound-*` 就红，名单里留着一枚盘上已不存在的也红。
读数与该 spec 的能红证明写在计划文末与 PROGRESS 当天那一节。

**剩下三件做不动，逐件写清落点**：

1. 🔴 **把这道接进 `pnpm check` 链**要改**根 `package.json`**（白名单外）。可粘的形状：新增
   `"check:inbound-lane": "python3 research/tools/verify-inbound-ac-ticks.py && python3 research/tools/verify-inbound-ac8-matrix.py && python3 research/tools/verify-inbound-doc-tables.py && python3 research/tools/verify-inbound-cjs-require-order.py && python3 research/tools/verify-inbound-producer-seam.py"`，
   再把 `&& pnpm check:inbound-lane` 插进 `check`。注意 `check-gate-wiring` 的判据是"定义了就必须进链或有可验消费方"，
   只加定义不接链会把它惹红 —— 两处要同一笔。
2. 🔴 **三枚变异牙臂（`queue-teeth` / `quota-teeth` / `ticket-teeth`）不能常驻并发的测试套件**：
   它们的臂**临时改写被跟踪的源文件再还原**（现量 `verify-inbound-queue-teeth.py:33`
   `TARGET = server/src/automation/inbound.routes.ts`，备份 `/private/tmp/heyta-inbound-queue-teeth/inbound.routes.ts.mut-bak`）。
   并发窗口里别的用例会读到被改坏的那一份，进程被打断还留不下还原 —— 按 AGENTS §8.9 这类要独占验收。
   要它们也常驻，正确做法是给这一道配一把独占锁或单独一趟串行载体（同族先例：`scripts/reinstall-all.sh` 的宿主门），
   而不是把它们塞进 `-r test`。
3. ⚠️ `verify-inbound-plan-audit.ts`（B184）与 `verify-inbound-commit-scope.py`（B169）在这两格裁决前**必须留在"不接"名单**：
   它们当前 rc=1 且红因都在本线之外，接进来等于让本线的 `-r test` 替别人的红买单。

**反向验证的形状**（谁改这条都过一遍）：① 把 `WIRED` 里任一枚换成盘上不存在的文件名 ⇒ 那条分母自检红；
② 拿一份勾掉某枚 AC 的**计划副本**（不改工作树）跑 `verify-inbound-ac-ticks.py` ⇒ rc=1 并点名那一格，
spec 随之红；③ 还原后整条回绿。
