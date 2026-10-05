# 环境陷阱（实测踩过，会复现）
> 状态：**长期参考**（`AGENTS.md` §7 的正文在这里；本文件是唯一全文，**编号只增不改**）。
>
> 引用方式：正文里写「§7 #N」或「环境陷阱 #N」；每条都是**实测踩过、且会复现**的，
> 不是理论风险。新条目追加到文件末尾，编号连续递增。
>
> **取号怎么走**（这条是被两次读错换来的）：
> `grep -oE '^[0-9]+\. ' docs/reference/environment-traps.md | tr -d '. ' | sort -n | tail -1` ——
> 必须 `sort -n`（正文里有整段物理顺序与编号不同序，按行号或按"最后一条"推断会读错），
> 且**取工作树的最大号，不取 HEAD 的**（别人刚追加还没提交时，HEAD 那个号已经被人占了）。
> ⚠️ **并发追加时不抢号**：`git diff HEAD -- <本文件>` 非空 ⇒ 有别人正往末尾写新条，
> 此时先把要入档的条目登记在原计划里、等那一版落进 HEAD 再取号 ——
> 全仓没有任何门禁检查重号（10:29 现量：`scripts/` 下没有针对本文件编号的检查），撞车只会静默留下两条同号。

---
## 7. 环境陷阱（实测踩过，会复现）

### 🔴 `DATABASE_URL` 会污染 docker compose

compose 的变量插值**优先读宿主机环境变量，其次才是 `.env`**。当前 shell 里只要有任何 `DATABASE_URL`，
容器拿到的就是它，而不是 compose 里那个带 `connection_limit`/`pool_timeout` 的默认值，启动即崩：

```
ERROR: DATABASE_URL must include exactly one positive connection_limit and pool_timeout value each.
```

排查**看容器实际收到的值**，不要猜：

```bash
docker inspect <容器> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep DATABASE_URL
```

规避：`env -u DATABASE_URL docker compose ... up`

### 🔴 `minimumReleaseAge` 必须显式声明

否则构建结果**取决于跑的是哪个 pnpm**：本机可能是 0，容器里原生 pnpm 11 默认 24 小时，
同一份 lockfile 本地过、容器报 `lockfile contains entries that the active policies reject`。
已在 `pnpm-workspace.yaml` 钉死，**不要删那行**。

### 🔴 锁文件与 `package.json` 必须同一次提交

`pnpm install --frozen-lockfile` 只有在**两者一致**时才过。
分开提交（哪怕只差一个 commit）会让**每一个新的干净检出**当场失败：

```
ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because
pnpm-lock.yaml is not up to date with <ROOT>/packages/xxx/package.json
```

本仓踩过：一个提交把 `pnpm-lock.yaml` 改成了"含 `@heyta/widget-core`"，
但对应的 `package.json` 和那个包**还没提交**（在另一个会话的工作区里）。
本机因为有 `node_modules` 所以毫无感觉，**CI 从此每次都红**（见
[`docs/runbooks/ci-and-runner.md`](../runbooks/ci-and-runner.md) §6）。

修的时候注意一个 git 陷阱：**`git commit -- <pathspec>` 会绕过索引、提交工作区版本**，
不是你想要的那个 blob。要比对/提交特定内容，先 `git hash-object -w` +
`git update-index --cacheinfo`，再**不带 pathspec** 地 `git commit`。

### 🔴 门禁里的 golden 夹具：时区必须钉死

**症状**：`check:widgets` 在本机（UTC+8）全绿，CI（UTC）全红；差异**只有一个字段**，
而且正好是 8 小时。

**根因**：夹具里存了**绝对 epoch**（`endsAt`），而它是从"本地日历日的正午"推出来的 ——
同一个**本地时刻**在不同时区是**不同的毫秒数**。密文是对明文整体加密的，于是整个
`ciphertext` 跟着变。（`dueDate` 不受影响，因为它在载荷里是 `YYYY-MM-DD` 字符串。）

**修法**：`packages/widget-core/vitest.config.ts` 里 `env: { TZ: 'UTC' }`，
生成与校验在**同一条件**下进行。**不要删那个 `TZ`。**

**验的时候必须用外层 `TZ` 干扰**，否则验不出这个 bug（配置要能压过环境变量）：

```bash
for tz in Asia/Shanghai UTC America/New_York Pacific/Kiritimati; do
  TZ=$tz pnpm --filter @heyta/widget-core test tests/fixtures.spec.ts
done
```

**推广**：凡是被**逐字节比对**的产物（golden 文件、哈希、密文），
都要问一句"它的字节依赖哪些**环境**？"——时区、locale、换行符、文件系统排序都会。
答案必须**显式钉死**，不能让"谁生成的"决定结论。

### 🔴 `pnpm check` 平时**不跑测试**

链路是 `build → typecheck → check:*`。所以"`pnpm check` 全绿"**不等于**"测试都过了"。
CI 里 `pnpm check` 之后还有一步 `全量测试`，两者都绿才算。
写新门禁时如果它依赖某个 spec，要么在那个 `check:*` 里**显式跑那个 spec**
（`check:widgets` 就是这么接的），要么别指望它会被跑到。

### 🔴 测试的默认超时是 5s，而 CI 比本机慢约 3.5 倍

**任何真做 CPU 密集或真 I/O 的用例，都不该用默认超时。** 实测倍率：

| 用例 | 本机（Apple Silicon） | CI runner | 结果 |
|---|---|---|---|
| `sync-client` 整页解不开（真 AES-GCM × 12） | **1.34 s** | **5.12 s** | 🔴 默认 5s → 超时 |
| 同上，对照用例 | 1.24 s | 4.43 s | 贴着线 |
| `node-host` 钥匙串一整套操作 | 1.23 s | ≈ 4.3 s（推算） | 贴着线 |

**判据**：本机单条 > 1.2s 就要显式给超时。
`server/vitest.config.ts` 已经这么做（`testTimeout: 20_000`），
`apps/node-host` 与 `packages/sync-client` 也已跟上。

**怎么快速查出全仓最慢的那些**（不依赖 CI）：

```bash
pnpm -r test > /tmp/alltests.log 2>&1
grep -oE "✓[^│|]*[0-9]{3,}ms" /tmp/alltests.log | grep -v "tests)" | \
  sed 's/^✓ *//' | awk '{n=$NF; sub(/ms$/,"",n); if (n+0>800) print n"\t"$0}' | sort -rn
```

⚠️ `grep -v "tests)"` 那一步不能省：不带括号的是**单条用例**，
带 `(N tests)` 的是**文件级汇总**。超时是按单条算的，混在一起会看错对象。

🔴 **为什么这种红特别危险**：它把"真问题"和"机器慢"混成同一个信号，
于是人开始说"重跑一下就好" —— 而**一个能被重跑哄好的门禁，很快就不再挡得住真问题**。
所以宁可显式写一个有余量的超时（实测最坏值的 ~12 倍），
也不要留着默认值去赌。

### 线协议与运行时不对称

1. 服务端**强制 E2EE 且没有开关**：`isPayloadEncrypted` 必须显式 `true`，明文一律 400 `E2EE_REQUIRED`。
2. 线协议 schema **不校验实体成员**，拼错实体名要到上传后才发现 —— 客户端必须先用 `isEntityType()` 自查。
3. 线协议 schema **接受明文载荷**，但服务端无条件拒绝。**客户端无法从契约推出"必须加密"。**
4. **`opType` 词表是 `CRT`/`UPD`/`DEL`**（`sync-core` 的 `OpType`）。**不要自造
   `CREATE`/`UPDATE`/`DELETE`** —— 服务端会逐条 `INVALID_OP_TYPE` 拒绝每一个 op，
   而本地一切正常。词表只有一份，就该只有一份定义。
5. **HTTP 200 也可能是拒绝。** 上传响应里 `results[].accepted` 才是真相，
   字段名是 `opId`（不是 `id`）。只看 `res.ok` 会报"已同步"而数据一条都没上云。
6. **下载的 op 是嵌套的** `{serverSeq, op, receivedAt}`，不是扁平结构。
7. **向量时钟必须包含本次写入自己的递增。** 写成"写入前的时钟"会让每台设备的
   **第一条 op 时钟为空**，对端 `compareVectorClocks` 判 `EQUAL`（"已见过"）→
   **静默丢弃**：本地正常、服务端收到、对端永远看不到，且不报错。
8. **服务端会拒绝并发修改（`CONFLICT_CONCURRENT`），并附 `existingClock`。**
   客户端必须**先下载、再解决、再重传** —— 判定谁更新要用到远端那条 op 的时间戳，
   而下载之前手上根本没有它。把冲突当普通错误重试会**永远解不开**。
   🔴 **冲突策略不要自己发明**：用 `sync-core` 的 `suggestConflictResolution`。
   它对"同实体 UPDATE、时间戳相近、无删除/创建不对称"返回 **`manual`** ——
   **故意拒绝自动选边**。这是对的：自动择一 = 静默丢掉另一个人的编辑。
   计划里的"冲突可判定"指的是**能识别并上报**，不是"自动收敛"。
9. **`recover()` 必须从整个日志重建，不能只看 `pendingApply`。**
   本地 op 在 dispatch 时就标成 `applied`，因此一条都不会进 `pendingApply`。
   只重放它 → **刷新页面后内存状态为空**：磁盘一条没少，界面一条没有。
10. **冲突上报必须结构化，不能只报一句文案。** 只报"需要手动选择"而界面拿不到
    双方内容，等于把一个必然需要人判断的问题做成死路：数据没丢，但谁也没法往下走。
11. 🔴 **`suggestConflictResolution` 要传"真正并发的那几条"，不是实体全部历史。**
    传全史会让"本地有 Create → 本地赢"这条规则命中（创建者那台永远有 Create），
    于是**创建者的编辑永远自动胜出、另一台的编辑被静默丢掉**，
    而且表现为"同步成功"。用 `compareVectorClocks` 筛出 `CONCURRENT` 的那几条。
12. **判定为"本地胜出"之后，原来那条被拒的 op 必须移出上传队列。**
    只重新派发、不丢弃旧 op，那条会永远留在队列里，每次同步都再撞一次冲突 ——
    同步被**永久卡死**，而且看起来像"服务端无缘无故老拒绝我"。
    配合 `resolveConflicts` 里的递归调用就是无限循环。
    **不要写递归重试**：重传仍冲突说明自动判定不成立，那正是该交给用户的情况。
13. 🔴 **限流会掩盖死循环。** `verify:p1` 曾因测试台架撞上限流而随机报 429，
    表面现象是"冲突没被识别" —— 排查方向直接偏到同步协议上。
    把限流去掉之后，同一批用例变成**超时**，才暴露出真正的无限循环。
    所以：**测试服务端不应限流自己的验收套件**（按 IP 计额，全部设备都来自 127.0.0.1）。
    已在 TEST_MODE 下关闭路由级与按用户两层限流。
14. 🔴 **接口漏声明方法，只有强转能救 —— 而强转会让 TS 彻底静音。**
    `DbOpLogStore` 曾用 `as DbTx & {...}` 才能调用 `addToleratingDuplicate`，
    因为它**只存在于 `IndexedDbAdapter` 上，不在 `DbTx` 接口里**。
    任何新适配器按接口老实实现，就会在运行时炸（内存实现第一次跑契约就炸了）。
    **看到 `as SomeInterface & {...}` 就是接口没表达真实需求的信号**，去补接口。
15. **`export const Alias = SomeClass` 不能当类型用。** 类既是值也是类型，
    而 `const` 只提供值。别名必须写 `export { A as B }`。
16. 🔴 **跨实现的行为分歧必须写下来，不能假装一致。**
    `getAllFromIndex` 的返回顺序：IndexedDB 按**索引键**，内存与 SQLite 按**主键**。
    接口上已注明"顺序未定义"，并有测试钉住实际行为。
    **依赖顺序的调用方必须自己 sort** —— 上传顺序靠这个。
17. **测试台架也会撞自己的限流。** 见第 13 条：按 IP 计额，验收套件全部设备都来自
    127.0.0.1，共用额度，用例越多越容易随机变红。TEST_MODE 下已关闭两层限流。
18. **tsup 默认 `removeNodeProtocol: true` 会把 `node:sqlite` 改写成 `sqlite`**，
    而 `sqlite` 不是可解析的内建模块 → `ERR_MODULE_NOT_FOUND`。
    需要 `removeNodeProtocol: false`。（类型检查与源码运行都不会暴露它，只有构建产物会。）
19. 🔴 **墙上时钟不能裁决因果顺序。** reducer 的 LWW 闸门曾**只**比 `op.timestamp`，
    同毫秒时用 `op.id`（随机 UUID）字典序打破平局。但同一台设备连续两次编辑
    经常落在**同一毫秒**里 —— 于是因果上更新的那条有一半概率被静默丢弃。
    实测症状：完成 → 立刻取消完成 → 重开，「取消完成」约 2/3 失效，而 op 日志里
    两条 op 的向量时钟清清楚楚是 `3` → `4`。**它们根本不并发。**
    现在先比向量时钟（`GREATER_THAN` 接受 / `LESS_THAN` 拒绝），只有
    `EQUAL`/`CONCURRENT` 才回退到时间戳 + `op.id`。
    这是 #7 的同一种形状：**拿墙上时钟去表达因果事实**。
20. 🔴 **合法实体被静默丢弃。** `isModeled` 把两件事混为一谈：**未知的未来实体**
    （老客户端该优雅跳过，合理）与**已知且合法但还没实现的实体**（跳过 = 静默丢用户数据）。
    实测：`NOTE` / `TASK_REPEAT_CFG` / `REMINDER` 都是合法实体（`isEntityType()` 为 true），
    `dispatch` 不报错、op 照常入队上传同步，但**没有任何设备物化它们**。
    用户建一条重复任务 → 同步得到处都是、哪儿也不显示、任何一层都不报错。
    「优雅跳过未知实体」这个正确行为**替它掩盖了**。
    现在 `packages/op-log/src/state.ts` 导出 `MODELED_ENTITY_TYPES` /
    `UNMODELED_ENTITY_TYPES`，`entity-coverage` 测试要求每个 `ENTITY_TYPES` 成员
    要么物化、要么**显式登记并写明原因**。实现后不移除登记会红 —— 清单不会腐烂。
21. 🔴 **"不在 PATH 上"不等于"没装"。** 我探测鸿蒙工具链时只查了 `command -v`，
    没查到就写下"本机没有 HarmonyOS 工具链，也没有 ArkTS 编译器"——
    **这是错的**。DevEco Studio 6.1.1.300 就装在 `/Applications/DevEco-Studio.app`，
    SDK 为 API 24，`hdc` / `ohpm` / `hvigorw` / **ArkTS 编译器 `es2abc`** 全在里面：
    `.../ets/build-tools/ets-loader/bin/ark/build-mac/bin/es2abc`
    （Apple Silicon 用 `build-mac`；SDK 根在 `Contents/sdk/default/openharmony`）。
    结论：**探测工具链要查已知安装位置，不能只查 PATH**；随口断言"本机没有 X"
    会让后续所有推理建立在一个假前提上。现在 `pnpm check:arkts` 用真编译器验证 ArkTS 产物。
    ⚠️ 但**不要反向过度声明**：它验证的是**语法/编译**，不是 ArkTS 语义合规 ——
    当前产物只声明常量，没有 `@ohos` 导入或 `Color` 资源类型。
22. 🔴 **RNOH 的 JS 侧和鸿蒙侧是两个包名、两套 registry —— 查错一边会得到 404。**
    - JS 侧走 **npm**：`@react-native-oh/react-native-harmony`（`0.84.4`）
    - 鸿蒙侧走 **ohpm**：`@rnoh/react-native-openharmony`（`0.84.3`）
    我先拿 `@react-native-oh/...` 去问 ohpm，得到 404，差点据此判定"包不存在"。
    两侧实测均为 **MIT**；`ohpm install` 实测 28.9 秒成功（309 MB / 11975 文件，
    含 2509 个 `.h`、2216 个 `.cpp`）。
    另：官方《环境搭建》文档写"仅支持 RN **0.72.5**"，**该文档已过时** ——
    实测两侧都已在 `0.84.x`，`peerDependencies` 要 `react-native@0.84.1`。
    **官方文档里的版本号必须上网核对，不能照抄。**
23. 🔴 **生成器不能依赖它自己要产出的东西。** `@heyta/design-system` 的
    `generate` 原本是 `tsup && node dist/generate-cli.js` —— 而 `tsup` 会构建
    `src/native.ts`，后者 import 的正是这次生成要写的 `src/generated/tokens.native.ts`。
    于是**产物一旦缺失，生成器就跑不起来** —— 而那恰恰是最需要它的时候。
    现在 `generate` 只构建生成器自身（`tsup src/generate-cli.ts`），完整构建是另一条
    `build`。**已实测：先 `rm -rf src/generated`，`pnpm generate` 仍能产出全部 4 个文件。**
    一般规律：**修复工具不能依赖被修复的东西。**
24. 🔴 **二级构建配置不能带 `clean: true`。** 修 #23 时我把 `generate` 改成
    `tsup src/generate-cli.ts` —— 但 tsup 的 `clean` 来自**主配置**且默认为 `true`，
    于是跑一次生成器就把 `dist/` 清空、只留 `generate-cli.js`，
    `@heyta/design-system` 的 `"."` 入口消失，**所有 `cssVar` 导入全部解析失败**。
    更糟的是生成器**看起来是成功的**（产物确实写了），错误要到别处构建才炸 ——
    实测 `apps/web` 因此从 48 掉到 38 且静默变成 2 个 suite 无法加载。
    现在生成器用独立的 `tsup.generate.config.ts`，`clean: false`：
    **生成器只允许新增文件，绝不删别人的。**
25. 🔴 **随机 id 会让"顺序"断言随机变红 —— flaky 测试比没有测试更糟。**
    写"列表按 (createdAt, id) 排序"的测试时，我先用真实 `Date.now()` + 随机 UUID。
    后果：三条随机 UUID 恰好已是升序的概率是 **1/6**，于是"排序真的生效了吗"
    这条断言**随机变红**（实测 8 次红 4 次）。为了"防止巧合"我又加了
    `expect(listed).not.toEqual(insertionOrder)` —— **那本身才是 flaky 的源头**。
    根治办法不是放宽断言，而是**让 id 与时钟都可注入**（`now` / `newTaskId` 选项），
    然后造一个"按 id 排"与"按创建先后排"必然不同的确定场景。
    **一条会随机失败的测试会教人忽略红色**，那比缺测试危险得多。

26. 🔴 **Hermes 缺 `WebAssembly`，而 Argon2id 是 WASM 实现的 —— 于是移动端一条数据都同步不出去。**
    `packages/sync-core` 的 Argon2id 来自 `hash-wasm`（WASM）。真机实测：
    在「我的」填好服务器地址与令牌、点「立即同步」，得到的是

        WebAssembly is not supported in this environment!

    **这条没有 polyfill 可装**，和 `TextDecoder` / `getRandomValues` 不是一类问题。
    而我此前盘点过 Hermes 的全局量并写进了 `apps/mobile/index.js`，
    那张清单里**恰好漏了 `WebAssembly`** —— 于是"两个 polyfill 都装齐了"
    看起来像"加密路径就绪了"。**盘点运行时能力时漏一项，就等于得出一个假结论。**
    症状也很有欺骗性：界面完全正常，只是同步永远失败，排查方向很容易被带到同步协议上去。

    同时暴露了一个测试缺口：`encryption.spec.ts` **全是往返测试**（加密→解密→得到原文），
    换掉 Argon2 实现只要它自洽就照样全绿 —— 而派生字节与别的平台不同，
    后果是**静默的跨设备不可读**。已补 `tests/argon2-known-answer.spec.ts`，
    用 `hash-wasm` 在生产参数下算出的向量钉住字节（已用"改 memorySize"与"改期望值"
    两种注入验证能失败）。

    **修复**：`argon2.ts` 改成"WASM 优先、纯 JS 兜底"，与 `web-crypto.ts` 里
    AES-GCM 的写法对齐（那边早就是"有 `crypto.subtle` 就用、没有退到 `@noble/ciphers`"）。
    兜底用 `@noble/hashes@^2.4.0`（**MIT**，2026-09-08 仍在提交）。
    `tests/argon2-fallback.spec.ts` 会**删掉 `WebAssembly`** 再跑同一条向量，
    并把"删除真的生效"单独断言 —— 否则用例可能悄悄跑在 WASM 分支上还一路全绿。

    实测（V8 / Apple Silicon，64 MiB / 3 轮 / p=1，三次取样）：

    | 实现 | 耗时 | 向量 |
    |---|---|---|
    | `hash-wasm`（WASM） | 114–151 ms | ✅ |
    | `@noble/hashes` **2.4.0**（纯 JS） | 582–683 ms | ✅ |
    | `@noble/hashes` 1.8.0（纯 JS） | 1464–1783 ms | ✅ |

    🔴 **1.8.0 比 2.4.0 慢 2.5 倍**，而我第一次测 1.8.0 得到 3.9–6.8 秒 ——
    那个数字里混着 JIT 冷启动。**拿单次测量当性能结论，和拿单个探针当结论一样不可靠。**
    选纯 JS 而不是写原生模块，是因为原生绑定要分别写 Android / iOS / 鸿蒙三套，
    而纯 JS 三端零平台工作。

    🔴 **真机（Android 模拟器，Hermes，无 JIT）实测 —— 比 V8 慢约两个数量级：**

    | 场景 | 耗时 |
    |---|---|
    | 应用会话内**第一次**同步（含一次 Argon2id 派生） | **约 30–40 秒** |
    | 同一会话内**后续**同步 | **1–2 秒** |

    也就是说：**那 30–40 秒每次应用会话只付一次**（`sync-core` 的 `session-cache.ts`
    缓存了派生结果）。V8 上纯 JS 是 582–683 ms，Hermes 上是 30 秒量级 ——
    **有 JIT 与没有 JIT 不是"慢一点"，是两回事。**

    这也修正了本条的措辞：修好 `WebAssembly` 缺失**只是让同步能跑**，
    **不等于体验可以接受**。「我的」界面现在会在首次同步前明说这段等待
    （`isArgon2SlowBackend()`），而不是让用户对着一个 40 秒的转圈猜是不是卡死了。
    ⚠️ 若要真正消掉这 30–40 秒，只能走**原生 Argon2 模块**（三端各一套）；
    目前**没做**，不要声称已经很快。

27. 🔴 **只改 `packages/` 时，Android 的 APK 会打进**旧的** JS bundle —— 验收因此对着旧代码报绿。**
    RN 的 Gradle 插件给 `createBundle<变体>JsAndAssets` 声明的输入只覆盖**本工程**
    自己的 JS 源与配置，**不包含 monorepo 里 `packages/*/dist`** —— 而 `@heyta/mobile`
    正是通过 `main` / `exports` 消费那些 `dist`（Metro 没有配别名）。
    于是只改 `packages/` 时打包任务被判 UP-TO-DATE、**根本不调用 Metro**。

    实测：往 `packages/app-host/src/actions.ts` 注入"完成重复任务时**也**写 `completedAt`"
    这个真 bug → `pnpm -r build` → `./gradlew assembleRelease` 报
    **BUILD SUCCESSFUL（12 秒，打包任务被跳过）** → 装到模拟器上跑
    `pnpm verify:mobile-repeat` → **40 项通过 / 0 项失败**。
    同一个注入，只要加 `--rerun-tasks` 强制重打，**立刻红 2 项**
    （`写入了 1 次 completedAt`、`笔记本上它被标成了已完成`）。

    危害不在"某个功能坏了"，而在**它污染所有移动端验收的结论**：
    "重建 → 安装 → 验收"整套流程会对着旧产物报成功，而且每一步都像成功的
    （`gradle BUILD SUCCESSFUL`、`adb install` 打印 `Success`、`pidof` 有值、界面全对）。

    **已修**：`apps/mobile/android/app/build.gradle` 把 `packages` 声明成打包任务的输入
    （`inputs.dir`）。修后实测：**不带任何特殊参数**，改 `packages` 后普通构建会自动重打，
    APK 哈希随之改变。代价是从 ~12 秒变 ~30 秒 —— 不要为省这 20 秒删掉那条声明。

    ⚠️ **验收脚本第一步是"装包"，而"装包"必须证明装的是**这一次**的产物。**
    这条与 Metro 配置里那条 `disableHierarchicalLookup` 是同一个形状：
    **Debug 能跑 ≠ Release 打包正确**；"构建成功"≠"产物是新的"。

28. 🔴 **相对导入带 `.js` 扩展名：单测全绿，Release 打包失败。**
    在 `apps/mobile` 里 `import { x } from './date.js'` 这种写法，
    `vitest` 会把 `.js` 映射回 `.ts`（**所以 `pnpm --filter @heyta/mobile test` 全绿**），
    而 **Metro 不映射**，Release 打包直接：

        error Unable to resolve module ./date.js from .../use-today.ts

    实测：新加的 `use-today.ts` 与其两处引用都写成 `.js`，
    `typecheck` ✅、`test` 73 通过 ✅、`pnpm check` 全绿 ✅ —— 只有
    `./gradlew assembleRelease` 红。**移动端本地模块一律不带扩展名**
    （仓库既有写法就是 `'../lib/date'`、`'../lib/duedisplay'` 这种）。
    与第 27 条同形：**"测试通过 / 门禁全绿"推不出"能打包"。**

29. 🔴 **`NODE_USE_ENV_PROXY=1` 会让 `pod install` 整个挂掉，而报错指向一个**存在**的文件。**
    node 22 在这个变量下每次启动都往 **stderr** 打一行
    `(node:NNNNN) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental...`。
    CocoaPods 的 `Pod::Executable.execute_command` 把它**并进了 stdout**，
    于是 `Podfile` 第 2 行解析出来的路径变成：

        /Users/.../react-native/scripts/react_native_pods.rb
        (node:97394) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental...

    `require` 当然加载不了，报的是
    `[!] Invalid Podfile file: cannot load such file -- <那个路径>`。
    **最误导的地方**：`[ -f <路径> ]` 是**真**的、`node -p require.resolve(...)`
    也**真的**返回那个路径、单独 `ruby -e "require '<路径>'"` 也**真的成功** ——
    三者都指向"文件明明在"，于是排查方向会偏到 pnpm 布局、Ruby 版本、编码上去。
    定位手段是给 `require` 挂一个 `RUBYOPT` 钩子把**实参原样打印**出来
    （`RUBYOPT="-r/tmp/rbshim.rb" pod install`），一眼就看到那条警告混在里面。
    **修法**：`env -u NODE_USE_ENV_PROXY pod install`。

30. 🔴 **仓库路径里的空格会让 RN 0.84 的 prebuilt-core 解析器崩掉。**
    本仓库路径含 `All in one Data`。`react-native/scripts/cocoapods/rncore.rb:146`
    （与 `rndependencies.rb:164/231`，共 4 处）构造 podspec 的 `source` 时写的是
    `URI::File.build(path: destinationDebug).to_s`，而 Ruby 4.0.7 的
    `URI::File.build` **遇到空格直接抛**：

        URI::InvalidComponentError: bad component(expected absolute path component):
          /Users/.../All in one Data/.../reactnative-core-0.84.1-release.tar.gz

    已单独验证：无空格路径 OK，含空格路径抛这个错，**字符串逐字一致**。
    最终表现却是 `pod install` 报
    `The React-Core-prebuilt pod failed to validate due to 1 error: Missing required attribute source`
    —— 和一个叫 `source` 的属性有关，看不出半点"空格"的意思。

    **修法**：`RCT_USE_PREBUILT_RNCORE=0 RCT_USE_RN_DEP=0`（两个都关），
    让 RN core 与 RN dependencies **从源码构建**，绕开全部 4 个调用点。
    代价是首次 iOS 构建慢很多。**实测有效**：这样跑完 `pod install` 退出码 0，
    `RNSVG` 进入 `Podfile.lock`。

    ⚠️ 这个空格还咬了别的地方：`pod install` 期间隐私清单聚合那步会打印
    `find: /Users/rocalight/Desktop/All: No such file or directory`（它把路径按空格切了），
    这次不致命，但**同一个根因会以不同面目出现**。

    → 于是 **iOS 侧一条可用的 `pod install` 命令是**：

    ```bash
    cd apps/mobile/ios
    env -u NODE_USE_ENV_PROXY LANG=en_US.UTF-8 \
        RCT_USE_PREBUILT_RNCORE=0 RCT_USE_RN_DEP=0 pod install
    ```

31. 🔴 **装上原生图标库后 iOS 才能构建，而 Android 从来不受影响。**
    `react-native-svg`（Lucide 图标的底层）的子 pod `RNSVG-RNSVGFilters` 把
    `IPHONEOS_DEPLOYMENT_TARGET` 声明成 **12.4**，而 Xcode 27.1 支持范围是 **15.0–27.1.x**。
    报错发生在**编译开始之前**的 target 校验：

        error: The iOS Simulator deployment target 'IPHONEOS_DEPLOYMENT_TARGET'
        is set to 12.4, but the range of supported deployment target versions
        is 15.0 to 27.1.x. (in target 'RNSVG-RNSVGFilters' from project 'Pods')

    **同形教训（这是本仓库第 27、28 条的老毛病）**：Android 上图标一直完全正常，
    所以"Android 跑通了"推不出"iOS 能构建"；而 iOS 那边上一次"构建通过"是在
    **还没有原生图标库**的时候 —— 一个更早的绿，不能给一个更晚的改动背书。

    已修：`apps/mobile/ios/Podfile` 的 `post_install` 里对**所有** pod target 统一抬高部署目标。
    两条刻意的约束，删掉任何一条都会变成 bug：
     1. **只抬高、不降低**（`current.to_f < min_ios.to_f` 才改）——
        RN 自己的 pod 已经是 `min_ios_version_supported`，无条件覆盖会把它们降下去。
     2. **不写死版本号**，用 RN 的同一个常量 `min_ios_version_supported` ——
        写死 `'15.1'` 会在 RN 抬高最低版本之后**静默漂移**。
    实测：修后 `Pods.xcodeproj` 里 `IPHONEOS_DEPLOYMENT_TARGET = 15.1`，
    **小于 15 的残留条数为 0**，`xcodebuild` 退出码 0（`** BUILD SUCCEEDED **`）。

32. 🔴 **`pod install` 装上了 pod，不等于图标会显示 —— 未链接的原生组件只渲染成 "Unsupported" 占位。**
    `react-native-svg@15.15.5` 明明在 `apps/mobile/package.json` 里，但 `Podfile.lock` 里
    **只有 `react-native-safe-area-context`** —— 因为依赖是在**最后一次 `pod install`
    之后**才加的（实测时间戳：`Podfile.lock` 是 09-25 **18:39**，
    `node_modules/react-native-svg` 的链接是 09-25 **21:54**）。

    后果极具欺骗性：**构建成功、应用能启动、界面布局和文案全对**，只是**每一个图标**
    都变成一个粉红方块里的 `Uni`（RN 对未注册原生组件的占位）。截图取证前，
    我从没在任何一次断言里"看见"过这个 —— 无障碍断言查的是 `content-desc` 和文案，
    它测不出"这个 View 画成了什么"。**这是本仓库第一次靠"真的看一眼"发现的缺陷。**

    启动侧的证据是**假绿**：`xcrun simctl launch` 返回 pid、12 秒后进程仍在、
    `screencapture` 有图 —— 每一步都像成功。**必须看图。**

    **排查手法**：拿 `Podfile.lock` 与 `package.json` 的原生依赖**逐项对账**，
    而不是只看"构建过不过"。对照同一时刻 Android 的截图，才能确认是 iOS 独有。

    ✅ **已加门禁（`pnpm check:native-deps`），因为"排查手法"是靠人读的，而人读过一次
    就不会再读第二遍。** 两条规则，都由 `scripts/check-native-deps.mjs` 机器可查：
      1. **收录**：`package.json` 里每个第三方原生依赖的 pod 名
         （读 podspec 的 `s.name`，不是猜包名 —— 实测 `react-native-svg` → `RNSVG`、
         `@op-engineering/op-sqlite` → `op-sqlite`）必须出现在 `Podfile.lock` 的 PODS 段；
      2. **版本一致**：lock 记的版本必须等于该包 `package.json` 的 `version`
         （实测四个 podspec 全都 `s.version = package['version']`，所以这条是**确定性的**，
         不依赖 mtime —— mtime 在全新 clone 上会假红，而 pnpm 每次 install 都会重写
         `node_modules/<pkg>` 符号链接的 mtime，实测 21:54:40 与 podspec 自身的 21:54:38 差 2 秒）。
    ⚠️ **必须排除 `react-native` 自己的 podspec**：它由 Podfile 的 `use_react_native!`
    声明，且含条件性变体 —— 实测从源码构建时 `React-Core-prebuilt` 与
    `ReactNativeDependencies` **故意不在** lock 里，不排除就立刻假红。
    已用 **5 种注入**验证它会红：删掉 lock 里的 `RNSVG`（= 本条原形状）、
    把 `op-sqlite` 版本改成 `1.0.0`、删掉整个 lock、新增一个 lock 里没有的原生库、
    传一个拼错的 `--flag`（退出码 2，防止参数静默失效）。基线复跑为 0。
    ⚠️ **它看不见 Android** —— 但 Android autolinking 在构建期**从 `node_modules` 现场解析**
    并生成清单，不存在这个"产物与声明脱节"的窗口，所以没有对应的东西可对账。

33. 🔴 **有上限的向量时钟 + "客户端与服务端各自裁剪" = 必然后果是永久拒绝；而且写死数字的边界测试会静默失效。**
    两个缺陷叠在一起，前者是产品的、后者是测试的，都记在这里。

    **产品侧**：`MAX_VECTOR_CLOCK_SIZE` 原为 **20**，`limitVectorClockSize` 超出就丢弃条目。
    但**服务端的 head 自己也被裁到同一个上限，而两边保留条目的规则不同** ——
    服务端保护 `op.clientId + protectedIds`（head 已知的那些），**客户端只保护自己的 clientId**。
    于是只要真实时钟超过上限，客户端就可能少一个 head 里有的键 → 不再支配 head →
    服务端把该设备写的**每一条** op 判成 `CONFLICT_CONCURRENT` 并**永久拒绝**，
    而客户端只表现为"同步不上"。**"两边各自裁剪"这个形状本身就是错的。**
    实测触发点：E2E 验收账号每跑一轮 +2 个 clientId，第 11 轮越过 20 就必红。
    **一个会随运行次数漂移的验收台架本身就是缺陷。**
    已按 **ADR-0008** 把上限提到 **100** 并在真的裁剪时 `console.warn`。
    ⚠️ **这是把墙挪远，不是把墙拆掉**；因果安全压缩**没做**。上限是协议级常量、
    `packages/sync-core/` 是 vendored —— 改动要同步更新 `PROVENANCE.md`（§2）。

    **测试侧（更普遍，值得单独记住）**：上限一提，`sync-core` 6 条 + 服务端 5 条测试
    **就不再超限**，裁剪不再发生 —— 而它们**仍然"通过"**。
    它们用**写死的 20/21/25/35/100** 构造"超过上限"的输入，于是变成
    **静默空转、什么都没测的测试**。已全部改成跟着常量走，并补"输入确实超限"的前提断言。
    **一条'永远通过'的边界测试比没有测试更糟 —— 它占着位置，让人以为这块被覆盖了。**
    写边界测试时，永远让规模**从被约束的那个常量推导**，并断言"前提确实成立"。

34. 🔴 **一条硬被拒的 op 会让这台设备的同步**永久**卡死；而且它是被一条"写错的断言"逼出来的。**

    **产品侧**（`packages/sync-client/src/client.ts` 的上传路径）：

    ```
    上传 → 检查 accepted → 只要有硬拒绝就 throw
                              ↑ 这个 throw 在 markUploaded / setLastServerSeq **之前**
    ```

    于是一条自持的链：同批里**已被服务端接受**的 op 永远不落"已上传"
    → 下次同步重传整批 → 服务端回 `DUPLICATE_OPERATION` → 继续 throw
    → **同步永久失败**。数据在云上没丢，但这台设备再也同步不动了，
    用户看到的是"同步一直失败 + 待上传数永远不减"。

    **`DUPLICATE_OPERATION` 被当成了致命错误，而它的真实含义是"服务端已经有了"
    —— 那正是上传想要的结果。** 与被拒 op 同类的东西本仓库已处理过两次（第 8、12 条），
    但只覆盖了 `CONFLICT*`，没覆盖重复。

    实测取证（iPhone 17 Pro 模拟器 + 127.0.0.1:3000）：应用自己的「状态」区写着**「同步失败」**、
    任务页角标是 5，而**跨设备那一路是通的**；AX 树里应用的原始报错是
    `INVALID_CLIENT_ID`（一条 clientId 不是本机的 op）+ 4 条 `DUPLICATE_OPERATION`。
    ✅ 用宿主 Node 驱动对**手机真库的副本**直接调 `markUploaded`：**完全正常**
    （`pendingUploadCount` 5→4）→ **存储层没问题，是那条调用根本执行不到。**
    ✅ **已修（ADR-0009）**。取证那一轮刻意**只取证、未修**（它动的是同步协议语义，
    需要独立的复现用例与 ADR，**不在长轮末尾顺手改核心同步逻辑**）；随后单独一轮补上：

    - **服务端**：精确重复（`isSameDuplicateOperation` 为真）回 `accepted: true` +
      **原 serverSeq**，不再回 `DUPLICATE_OPERATION`。**`INVALID_OP_ID` 那几条硬拒绝一个字没动** ——
      内容 / 时钟 / 元数据不同、跨用户碰撞、竞态碰撞仍然全拒。
    - **客户端**：`markUploaded(seqsByOpId)` 提到硬拒绝的 `throw` **之前**（第二道防线），
      但**游标不提前推进** —— 那条路径下面还有 piggyback 的 `newOps` 没应用，
      先推进会跳过它们（那是真丢数据）。

    验收（每一层都能真的失败）：

    | 层 | 证据 |
    |---|---|
    | 线级 | 笔记本 `node-host`：把已上传的 op 重置回 `pending` 再 `sync` → **`已同步` / 退出码 0 / pending 1→0** |
    | 线级反证 | 把**已构建的**服务端改回旧行为、重启 → 同一场景 `服务端拒绝了 1/1 条 op：(DUPLICATE_OPERATION)`、**退出码 1、pending 停在 1** |
    | 服务端日志 | `UPLOAD_BATCH_SUMMARY { opsInBatch: 10, accepted: 9, rejected: 1 }` —— 唯一被拒的是 `other-device-x` 的 `INVALID_CLIENT_ID` |
    | 真机界面 | iPhone 模拟器「我的」页原文：`服务端拒绝了 1/10 条 op：(INVALID_CLIENT_ID…)（同批另有 9 条已被接受，已标记为已上传，不会再重传）`，队列 **10 → 1**（余下那条是我自己造的 clientId 毒数据，删掉后 → 0） |

    🔴 反差要记住：修复前同一状态是「**拒绝了 5/5 条**」且队列**永不减少**；
    修复后是「**拒绝了 1/10 条**」且**队列排空**。

    ---

    **残余缺陷（同一条链的最后一环）：上面那次修完，队列仍会**停在 1** ——
    那条 `INVALID_CLIENT_ID` 的毒数据删掉才归零。2026-09-27 单独一轮把它也修了
    （**ADR-0019**）：那条 op 根本不属于本机，重传一万次也不会被接受。

    🔴 但真正的要害不是"毒数据"。把 `upload()` 的 `throw` 去掉之前，
    它挡住的是**下载**：

      ```
      sync() → upload() → ❌ throw
                      ↘ download()   ← 永远走不到
      ```

    也就是说"上传里有一条过不去的 op"这个**局部问题**，
    升级成了"**这台设备永久失去下载能力**"这个**全局故障**。
    实测复现（真服务端 + 真 SQLite，队列里注入一条 `clientId` 属于别机的 op）：
    连续两次同步都是 `error`、待上传数恒为 1、**设备再没下载过任何东西**。

    修法（ADR-0019）：① 上传的失败**永不**阻断下载；② 永久拒绝（显式白名单）
    `markRejected` **移出队列**并如实上报，暂时被挡（限流/配额）留在队列里重传；
    ③ 新增第三种上传状态 `rejected` —— **不并进** `uploaded`
    （并进去等于说"这条在云上"，而服务端刚拒绝了它）；
    ④ 新原因 `upload-rejected`（`retryable` 按有无永久拒绝决定）。

    验收：`pnpm verify:sync-recovery`（零 mock，15/15）+ 存储契约 + 客户端单元。
    变异测试：把 `upload()` 改回"硬拒绝直接抛错" → 脚本在
    **「没拉到对端那条 —— 这台设备变聋了」** 上变红。

    **方法侧（更值得记住）**：这条缺陷是**测试写错反而救了产品**。
    我原来断言"上传后 `uploadStatus` 应从 pending 变成 uploaded"，它红了，
    而我第一反应是"断言写错了" —— **去查真因才发现断言没错、产品错了**。
    如果当时直接删掉那条断言，缺陷会继续躺着。
    **断言红了，先证明"到底谁错"，再决定删谁。**

    **iOS 输入侧验收（`pnpm verify:mobile-ios`）顺带踩到的四条：**

    - ✅ **以前做不到的原因不是"没写脚本"，是三个工具层问题叠在一起**：
      全局点击被上层窗口吃掉（另一个项目的 1696×992 窗口整块盖住目标窗口，
      且满屏叠着七八个、**没有空地能挪**）；`AXRaise`（含完整标题）**返回成功但遮挡关系不变**
      （Xcode 27 的 Simulator 用 window set）——**"工具返回成功"在这里是假的**；
      `mac type` 的 postToPid 返回 `typed N chars` 却**一个字都没进去**。
      **走得通的是走 AX 树**（模拟器把 App 的无障碍节点桥接进了宿主 AX 树），
      **不需要坐标、不需要 z-order、不需要焦点**。工具：`scripts/tools/axpress.swift`。
    - 🔴 **不要按 AX role 筛可点元素。** 同一个「添加」按钮的角色会在 `AXButton` 与
      `AXGenericElement` 之间变（同一台设备、同一个 Composer，只是输入框内容不同）。
      按 role 过滤**时灵时不灵**，症状是"找不到按钮"，看起来像界面没渲染出来。
      用 `--pressable`（支持 `AXPress` 动作）才对。
    - 🔴 **"窗口里有没有文本控件"不能当"Composer 开着"的判据** ——
      「我的」页常驻三个输入框。Composer 的唯一可靠标记是它里面才有的「添加」按钮。
    - 🔴 **`secure` 输入框的 AX 回读是掩码**（一串 `•`），永远不等于原文；
      **且不要用 `grep '^••*$'` 去认它** —— 脚本没有 UTF-8 locale 时 `•` 按 3 字节处理，
      `*` 只绑定到最后一个字节，20 个掩码匹配不上，症状和"写不进去"一模一样。
    - 🔴 **`ops` 表里 op 的 id 在 `ix0_0`，不是 `pk0`**（`pk0` 是数字主键）；
      而 `uploadStatus` 在 **`$.uploadStatus`**，是 `op` 对象的**同级**，不在 `$.op` 里。
      查错的后果是 4 条断言**同时**报空，看起来像 op 写坏了。
    - ⚠️ **按标签猜行为**：任务页头部那个「同步」按钮的 `onPress` 是 `refresh`
      （本地重读 `listTasks()`），**不是网络同步**；真正的同步在「我的」页的「立即同步」。
      我先点了任务页那个，300 秒里一条 op 都没上去。
      **看接线，不要看名字** —— 与第 27、28、31 条同形。
    - 🔴 **软件键盘会把被它遮住的节点从 AX 树里剪掉** —— 于是"读不到状态"看起来像
      "状态没了"。实测：`--set` 填完三个输入框后键盘一直立着，
      而「我的」页的「状态 / 待上传 / 上次成功同步」正好落在键盘下面，
      轮询连续 **333 秒**读到的都是**空字符串**（`grep` 无匹配），
      看起来像界面崩了或同步卡死。**先按一次 `return` 收起键盘，那三行立刻回来。**
      → 判据：`--dump` 里出现 `AXButton desc=「q」/「shift」` = 键盘立着。
      🔴 **收回键盘要按的那个键，会在同一个会话里改名 —— 写死任何一个名字都是错的。**
      实测同一台设备、同一个脚本、相隔几十秒：

      | 时刻 | 同一位置 (963,875) 上那个键 |
      |---|---|
      | 填「服务器地址」时 | `desc=「换行」`（还有「删除」「数字」「表情符号」） |
      | 几十秒后再看 | `desc=「return」`（还有「delete」「numbers」「空格」） |

      切了输入语言 / 键盘模式，**位置不变、名字全变**（数字键盘上又会是「完成」）。
      本文件原先写的是「中文 locale 下叫「换行」」—— 那条**只对了一半**：
      按「换行」在英文键盘上找不到
      （`{"action":"none","found":false,"result":"not_found","visited":719}`），
      而同一屏的 `--dump` 里那个键明明在。
      → 正确做法是**试一组候选名，并以"键盘真的消失了"为准**，而不是以
      "press 返回 success"为准（回执 ≠ 现象，见第 34 条开头那条 `AXRaise`）。
      `"找不到"在这里只等于"没匹配到那个字符串"`，**不等于"那个键不存在"**。
      这也是同一个形状：**先怀疑探针。**
      **不要用"某个节点读不到"推断"那个 UI 不存在"** —— 与 §7 开头那条
      "先怀疑探针"是同一件事。

35. 🔴 **`command -v node` 在封装运行时里解析到的是**不能 spawn 的私有垫片**；
    而一个吞掉自己失败的探针，会把"探针没跑起来"报成"对端没收到数据"。**

    这条是本仓库**已经写过一次的同一个坑**，只不过写在了 `.mjs` 侧
    （见下文「`spawn` 的 ENOENT」一节，以及 `scripts/verify-p1-sync.mjs` 的 `resolveNode()`），
    而 `scripts/lib/mobile-e2e.sh` 里留下的是一句裸的 `NODE=$(command -v node)`。

    实测（`pnpm verify:mobile-ios`，DSH 桌面运行时）：

        NODE=/Users/rocalight/Library/Application Support/DSH Desktop/
             runtime-commands/generations/<hash>/private/node-bin/node

    这个垫片执行 `node apps/node-host/dist/cli.js sync` **没有任何输出**。
    而 `laptop()` 里写着 `2>/dev/null`、`wait_laptop_has` 里又整条
    `>/dev/null 2>&1` —— **失败被连吞两层**。于是：

    | 真实现象 | 报告出来的 |
    |---|---|
    | `$NODE` 不能 spawn，300 秒里服务端**一条请求都没收到** | "笔记本 300 秒内没读到「…」" |

    **怎么确认的**：不看脚本的输出，去看**服务端日志** ——
    整个窗口内只有手机上传那一条，笔记本零请求；
    笔记本库里那条一直 `pending` 的 op 也证明 `sync` 从没执行过。
    **"对端没数据"必须能从对端那一侧被证实，而不是只看轮询函数的返回值。**

    **修了两件事，缺一不可**：
    1. `resolve_real_node()` —— 按候选列表解析**能真的跑**的 node
       （`HEYTA_NODE` → nvm → homebrew → PATH 里跳过 `DSH Desktop` / `runtime-commands`）。
       实测修后 `pnpm exec` 下解析到 `~/.nvm/.../v22.22.3/bin/node`。
    2. `wait_laptop_has` **区分退出码**：`0` 读到 / `1` 探针正常但对端真没有 / `2` 探针自己坏了。
       调用方分别报 `ok` / `bad 对端没读到` / `bad 探针自己坏了`，
       并把 `$NODE` 与最后一条原始输出带进消息里。

    ✅ **判据已用注入验证能失败**：`HEYTA_NODE=/usr/bin/false` → 退出码 **2** 并回显原因；
    正常 node + 不存在的标题 → 退出码 **1**。**两者必须可区分，否则这条修复等于没修。**

    ⚠️ 一般规律（比这条坑本身值钱）：**只要一个检查把子进程的输出丢掉，
    它就无法区分"被测对象失败"与"检查自己的工具链失败"。**
    这不是"少了一条日志"，而是**报告会指向错误的方向** ——
    这里它把排查引到同步协议上，而真因是一个 PATH 解析。
    与 §7 开头那条"先怀疑探针"是同一件事，只是这次**探针坏得完全无声**。

36. 🔴 **`cmd | python3 - <<'PY'` 里 heredoc 会顶掉管道 —— 解析器读到 0 字节，
    然后报告"界面上没有那个值"。**

    这个形状在写 `scripts/verify-ios-lan-http.sh` 时踩到，最小复现：

    ```bash
    printf 'AAA\nBBB\n' | python3 - <<'PY'
    import sys
    print(len(sys.stdin.read()))     # 实测输出 0
    PY
    ```

    **0 字节。** 原因是 `python3 -` 的"程序从 stdin 来"与"数据从管道来"是同一条 stdin，
    而 heredoc 的重定向**优先级更高**：python 把 heredoc 当程序读完之后，
    管道那头的 `AAA/BBB` 一个字节都没进去。
    （`<<` 与管道同时存在时，`<<` 赢 —— 它直接覆盖了 fd 0。）

    **为什么这条值得单独记**：它的症状与"被测对象不存在"**完全一致**。
    脚本第一版因此报「上一步之前在界面上读不到「上次成功同步」的值」，
    而同一时刻手工 `--dump` 那三行**字字俱在**。如果不去手工复核，
    下一步就会去查"是不是键盘立着""是不是界面炸了""是不是同步把 UI 卡死了"——
    **排查方向会被这个探针的失败带偏到产品上**，而真因是一个 shell 重定向。

    **修法**：数据与程序**必须走两条不同的通道**。本仓库现在的写法是
    `scripts/verify-ios-lan-http.sh` 里的单一入口：

    ```bash
    # 共享库 scripts/lib/mobile-e2e.sh 里——名字是 ax_dump，不是 dump：
    # 那里已经有一个 dump() 是 **Android** 的 uiautomator 快照（/tmp/ui.xml），
    # 两种设备、两种格式，不能共用同一个动作名（见第 37 条末尾）。
    AX_DUMP_FILE=/tmp/_heyta-ax-dump.txt
    ax_dump() { ax - --dump > "$AX_DUMP_FILE" 2>/dev/null; }
    # 程序走 heredoc，数据走 argv —— 互不干扰
    python3 - "$AX_DUMP_FILE" <<'PY'
    import sys
    for line in open(sys.argv[1], encoding='utf-8', errors='replace'): ...
    PY
    ```

    ⚠️ 一般规律（与第 35 条同源）：**探针的输出通道被别的重定向顶掉时，
    探针不会报错，只会报"没有"**。而"没有"是一个**看起来像结论**的返回值 ——
    这比崩溃危险得多，崩溃至少指向自己。
    → 所以有一个**唯一的探针入口**（这里是 `ax_dump()`）是有价值的：
    它让"再踩一次"无处藏身。

37. 🔴 **macOS 的 AX 只能看见「当前 Space」的窗口 —— 拿不到时不许抢用户前台。**

    **现象**：`axpress` 的 dump 里只剩菜单栏（`AXApplication` → `AXMenuBarItem` →
    菜单项），**一个输入框、一个按钮都没有**（`（共访问 397 个节点）` 但零输出）。
    而同一时刻 `xcrun simctl io <udid> screenshot` 截出来 App **渲染得好好的**：
    中文、蓝白、任务列表全对。

    **真因不是权限，是 Space。** 排查时先排掉了权限这条：
    `mac ax <pid>` 报 `AXIsProcessTrusted=true`，但同时 `windows=0`；
    工具自己的提示写得很清楚：*「windows=0 常见于目标在别的 Space（AX 只见当前 Space）」*。
    `CGWindowListCopyWindowInfo` 看得到 4 个 Simulator 窗口，全是 `on=0`（不在当前 Space）。
    系统设置里的辅助功能权限**是好的** —— 所以"读不到节点"**不能**推成"权限没了"。

    **我犯的错**：我用 `osascript -e 'tell application "Simulator" to activate'` 去"修"它。
    它确实有用（把窗口带回当前 Space，`on` 从 0 变 1）—— 但那等于**把窗口拽到用户面前**。
    连按几次之后用户直接叫停：**「别跟我抢前台，自己想办法在后台弄」**。

    → **规矩**：AX 读不到内容时，**停下来并把原因说清楚**，让操作者自己决定什么时候
    让窗口可见。**不许用 `activate`**。仓库里现在是这样做的
    （`scripts/lib/mobile-e2e.sh` 的 `require_ax_visible`）：
    它只**检查**（dump 里有没有那句 marker 文案），没有就报
    「AX 树里看不到 App 内容 —— Simulator 窗口不在当前 Space（环境原因，非产品缺陷）」并停。

    ⚠️ **同一形状的第三个变种**：本仓库已经两次因为"探针读不到"而差点把方向带偏
    （§7 第 35 条的 PATH 垫片、第 36 条的 heredoc 顶掉管道）。这条是第三种：
    **探针没坏，是它够不着** —— 而"够不着"和"不存在"在输出上长得一模一样。

    **顺带修掉的一个真问题**：窗口矩形原来是用 `System Events` 取
    （`osascript ... get position of every window`），它依赖**辅助功能权限**；
    而那个权限在会话中途丢失后，System Events 对**每一个**应用都返回
    `count of windows = 0`（实测连明明开着的 Chrome 也是 0）——
    于是 `find_window` 报"期望恰好 1 个窗口，实际 0 个"，看起来像"模拟器窗口没了"。
    现在改用 **`scripts/tools/winrect.swift`**（`CGWindowListCopyWindowInfo`）：
    它只要**屏幕录制**权限（截图本来就要用），**不需要辅助功能权限**。
    实现上必须用 `.optionAll` —— `.optionOnScreenOnly` 对**别的 Space 上**的窗口
    一个都不返回，那正是最初"找不到窗口"的原因。
    两个验收脚本各有一份 `find_window` 的老写法已删除，现在**共享库里有且只有一份**。
    ⚠️ 还有一处同名冲突要记住：共享库里 `dump()` 是 **Android** 的 uiautomator 快照
    （`/tmp/ui.xml`），所以 iOS 的 AX dump 入口**必须叫别的名字**（现在叫 `ax_dump`）——
    两种设备、两种格式、同一个动作名，叫同一个名字就是在制造漂移。

38. 🔴 **一个常量当两种单位用：`grace` 同时被当"日历日"和"漏了几次"，
    于是每 7 天一次的习惯**可以漏 7 次**。**

    **现象**：`computeStreak` 的 `current` 本该在"漏掉一个计划日"后归零。
    实测（`interval / everyNDays: 7`，计划日 9-10 / 9-17 / 9-24 / 10-01）：

    | 场景 | `current` |
    |---|---|
    | 漏 1 个计划日 | 1（**没归零**） |
    | 漏 2 个计划日 | 1（**没归零**） |
    | 漏 7 个计划日 | 0（才归零） |
    | 对照·**每日**习惯漏 1 天 | 0 ✅ |

    **真因**：`isStillAlive` 里 `const grace = daily ? 1 : 7`，然后
    先用它比**日历日**（`if (gap <= grace) return true`），
    再用它比**漏掉的计划日个数**（`missed >= grace` / `return missed < grace`）。
    同一个常量、两种单位。

    **为什么它活了这么久**：grace=1 时两种单位**恰好等价**，所以每日习惯上
    完全看不出来；而本仓库的测试与手动验证几乎都是每日习惯。
    它从 P1（`b59dfb6`）就在，同一条路径上的 `longest` 反倒写对了 ——
    只有"该不该断"这一条是错的。**一个只在非默认频率下才现形的错误，
    会被"默认频率的用例全绿"完整地遮住。**

    **为什么不是"更宽松的有意设计"**：同文件上方的注释写着
    「超过一个完整周期没打，连续就该归零」与「允许**一个**完整周期」——
    实现给了 **7 个**。**代码与它自己的意图矛盾**，这才是判据。
    光看代码是看不出错的（`missed >= 7` 长得很像有意为之），
    要连着注释一起读、再用探针把数字打出来。

    **它真的会到用户面前**：`apps/web/.../selectors.ts` 的 `bestCurrentStreak`
    直接把 `computeStreak(...).current` 喂给 `streakDays` 身份标签（阈值 30）。
    于是"六周没打卡还算连着"会变成**一枚不该发的身份标签** ——
    而身份标签的定位恰恰是"你现在是什么样的人"。

    **修法**：删掉 `grace`，只留一条判据 —— 扫 `(lastDate, today)`、
    **不含今天**（今天没过完），遇到"该打卡却空着"的计划日就断。
    "允许一个完整周期"这句话本来就由**逐日扫描**表达
    （扫完没有落空的计划日 = 下一个计划日还没到），不需要第二个阈值。
    代码因此变短而不是变长 —— **当"两个阈值"能用"一条规则"表达时，
    多余的阈值就是错的来源。**

    **测试侧（与第 33 条同源，更普遍）**：这里**一条测试都没有**钉住它。
    旁边那条「cessation 判定也要按频率」用的场景（9-21 打了、今天 9-25）
    在**两种语义下答案相同**，所以它一直是绿的 —— 它测的是"没漏的情况"。
    ⚠️ **边界测试必须用"能区分两种假设"的输入**；覆盖了那条分支
    不等于覆盖了那个判据。新守卫先跑红
    （`AssertionError: expected 1 to be +0`）再修，并配一条对照组
    （下一个计划日还没到 → 不能归零）防止修过头。

> 第 4、7 条的根因相同：**两套并行定义**（词表 / 时钟语义）。
> 这类 bug 单元测试抓不到 —— mock 是按实现者对协议的理解写的，理解错了 mock 跟着错。
> **所以 `pnpm verify:p1` 是不可省的**：真引擎 → 真 IndexedDB → 真 HTTP → 真服务端。

### 🔴 `spawn` 的 ENOENT 可能不是可执行文件的问题

`new URL('..', import.meta.url).pathname` 会把路径里的**空格转义成 `%20`**。
用它当 `cwd` 时目录不存在，而 `spawn` 抛的是
`ENOENT ... spawn /path/to/node` —— 报错指向一个**明明存在**的二进制，完全误导排查方向。
用 `fileURLToPath()`。

同理，`process.execPath` 在某些封装运行时里指向**不能独立 spawn 的垫片**，
而封装的垫片也在 PATH 最前面。脚本要按候选列表解析真 node，别写死 `'node'`。

### vendored 代码的边界

`packages/sync-core/`、`packages/shared-schema/`、`server/` 都源自 Super Productivity（MIT）。
改动它们时：更新对应的 `PROVENANCE.md`，并在 `THIRD_PARTY_LICENSES.md` 里保持登记。
它们的**包级 `package.json` 没有 `license` 字段**（上游也没有），整体靠仓库级 MIT 覆盖 ——
若要独立抽取子包分发，需先补包级声明。

38. 🔴 **软键盘会把 tap 吞掉，而点工具报的是 `success` —— 于是"点不到"看起来像"点了没反应"，
    最后被写成"客户端根本不会推送"这种根本性误判。**

    实测（iPhone 17 Pro 模拟器 / iOS 26.5，idb 驱动）：
    `verify-mobile-ios.sh` 在「我的」页填完三个输入框后按「立即同步」。
    那时软键盘**立着**，而按钮中心 (201,589) 落在键盘窗口里
    （AutoFill「Passwords」条 y=539..583，按键行从 y=590 起）。
    那一下点在了键盘上，**同步一次都没跑**。

    而 shim 当时报的是 `result=success` —— 因为 **tap 这个系统调用确实成功了**。
    服务端 `operations` 表按标题查 0 命中、日志里 0 行 Upload 属于该用户，
    于是"证据"齐全地推出结论：**"客户端从来没发起过 Upload"**，
    并花掉整整一轮去 `packages/app-host` / `packages/sync-core` 里找
    "决定要不要 push 的那个恒为假的条件"（那个条件**不存在**）。

    → **"没有观测到 X" ≠ "X 没有发生"。** 这里缺的观测是"客户端到底有没有尝试上传"，
      而这个空白被一个**看起来很顺的因果链**填掉了。**漂亮的解释会主动劝你停止调查。**

    正确做法（已落地在 `scripts/tools/ios-ax-shim.py`）：
    **点击之前显式判断目标是否被键盘盖住**，盖住就报 `tap-blocked-by-keyboard`，
    让调用方先收键盘 —— 绝不假装点到了。判据必须是**结构性的**：

    - 键盘按键节点带 `KeyboardKey` trait（实测 `q`/`shift`/`return` 都有）。
      不要靠 `AXLabel`（随语言/输入法变），也不要靠 `role`。
    - ⚠️ **候选/自动填充条带不带 `KeyboardKey` 是不稳定的**，实测两种都有：
      英文键盘上的「Passwords」条**没有**（键盘真实上沿比 `min(KeyboardKey)` 高约 51px），
      中文拼音候选栏**有**（`min(KeyboardKey)` 就是真实上沿）。
      所以**不能**一律减一个固定余量 —— 那会在第二种情形下多减一次，
      把明明够得着的按钮判成"被挡住"（我自己先踩了一次：
      `添加` 中心 y=484，减 60 得 478，于是第 4 步整段红掉）。
      正确做法：取 `min(KeyboardKey)`，**只在真的存在**一条紧贴其上、且接近全宽的
      横条时才抬高上沿。
    - 调用方**必须看 `result`**。同一个脚本里两处 `ax ... --press >/dev/null 2>&1`
      后面跟一句无条件的 `ok "已按下"` —— 那就是这轮假红的入口，两处都改了。

    同族已记过的形状：`AXRaise` 返回成功但遮挡不变（第 34 条）、
    `mac type` 返回 `typed N chars` 却一个字没进去、`idb ui text` 抛异常却不报。
    **回执 ≠ 现象**；这里再加一条：**回执 ≠ 点到了那个元素**。

    ⚠️ **同一件事还害过一次，而且那次是被写进文档当"产品缺陷"的。**
    计划文档里"「我的」页上**底部 tab 根本点不动**，疑似内容层盖住 tab bar，
    **这是产品的真实缺陷**"—— 也是**同一次误诊**：键盘占 `y=539..874`，
    tab 中心 `y=808`，点在了键盘上。A/B 实测（同一台设备、同一个 tab）：
    键盘立着 → `tap-blocked-by-keyboard`，停在「我的」；键盘收起 → `success`，切到任务页。

    它为什么会被写成产品缺陷？因为上一轮**写对了**：「怀疑与键盘遮挡有关 ——
    **但本轮没验**」；下一轮把"**但本轮没验**"删掉，换成一句确定的断言。
    **一个词的删除，就把一个待验证的怀疑变成了"已知的产品缺陷"**，
    此后每一轮都照着它绕路（还付出了"重启 App + 再付 50 秒 Argon2id 派生"的代价）。

    → 纪律：**没验过的怀疑不许升格成结论**，文档里"本轮没验/未核实"这几个字
    **不许顺手删**。要删，就得先拿出 A/B 证据。这与第 36、37 条"先怀疑探针"是同一件事：
    **探针坏了和产品坏了，在输出上长得一模一样。**

39. 🔴 **Hermes 上没有 `crypto.subtle`，而 legacy 密文只有 WebCrypto 一条解码路 ——
    服务端上只要有一条历史 op 是 legacy 格式，手机整次下载就全废。**

    `packages/sync-core` 的 Argon2id 路径早就有纯 JS 兜底（第 26 条），
    但 **legacy PBKDF2 路径没有**：`decryptLegacy` 一旦发现没有 `crypto.subtle`
    就直接抛 `WebCryptoNotAvailableError`，提示"请先在桌面浏览器上同步一次"。

    实测（同一台模拟器）症状是：**上传是好的**（2 条 op 被服务端接受），
    紧接着下载抛错，状态区显示
    `同步失败 · Cannot decrypt legacy data on this device…`。
    失败形状很坏：**不是那一条解不开，而是整次下载中断、后面的 op 一条都应用不上。**
    用户看到的是"多端同步不工作"，方向会被带到同步协议上去。

    **修法**：这条路径完全可以纯 JS 实现 —— PBKDF2-HMAC-SHA256 与 AES-GCM
    `@noble/hashes` / `@noble/ciphers` 都提供了，而且**已经是本包的依赖**
    （`argon2.ts`、`web-crypto.ts` 早在用）。少的不是能力，是那条兜底腿。
    生产参数（password-as-salt、1000 轮、SHA-256、dkLen 32）下两种实现
    **逐字节相同**，由 `tests/encryption.spec.ts` 的已知答案向量钉住。

    ⚠️ 同时注意：那条用例**原先断言的是"抛错"**，而且断言是对的。
    **把一个被记录的缺口补上时，必须同时改掉那条把缺口固化成"预期行为"的断言** ——
    否则测试会替你把缺陷焊死。改完要**做一次变异**验证它真的会红
    （把 `dkLen` 改成 16，两条用例失败，改回来全绿）。

40. 🔴 **`$VAR` 后面紧跟一个非 ASCII 字符时，bash 3.2 在 UTF-8 locale 下会把那个字符
    当成变量名的一部分 —— 报 `unbound variable`，而变量明明存在。**

    实测：`ok "idb companion 已连上（$IDB_COMPANION）"`。
    没有 UTF-8 locale 时一切正常（脚本一直这么跑，所以从来没人发现）；
    一旦 `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`（中文项目里再自然不过），
    bash 3.2 就把 `）` 的高位字节并进标识符，于是第 0 步直接
    `IDB_COMPANION<乱码>: unbound variable` 退出。

    `scripts/` 下这种写法有 22 处，**已全部改成 `${VAR}`**。
    判据：`\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]`（BSD grep 没有 `-P`，
    用 ripgrep 或 python 正则）。
    这与"`${#中文}` 按字节算"是同一条根：**bash 3.2 没有真正的多字节意识。**

41. 🔴 **下载时一条解不开的 op 会让**别的**设备**永久**同步不了；而出问题的那台设备
    看起来最健康。**

    这是第 34 条（上传侧：一条被硬拒的 op 让设备永久卡死）在**读侧的对偶**，
    形状完全一样，只是更难发现。

    实测：服务端上 `user:37` 的 9 条 op 里，**第 6、7 条**是同一台手机更早一次会话
    用**另一个口令**传的（口令只存内存，重启要重填）。逐条解密后边界干净得可疑：
    1–5 OK、**6/7 `OperationError`**（AES-GCM 认证失败）、8/9 OK。

    而原实现是 `await Promise.all(ops.map(decodeServerOp))`：

    1. **整页作废** —— 同页那 7 条明明是好的；
    2. 抛错在 `setLastServerSeq` **之前** → **游标永不推进** → 下次撞同两条，再抛；
    3. 界面只有一句"同步失败"，用户以为同步坏了。

    🔴 **最阴的一点**：下载会带 `excludeClient=<自己>`，所以**写坏数据的那台设备
    永远看不到自己那两条**，界面显示「已是最新」——
    **出问题的机器看起来最健康，坏掉的是所有别的设备。**
    实测就是这样：手机一路绿灯，笔记本 300 秒里一条都读不到。

    **判据**：`reason: 'unexpected'` + `message: "The operation failed for an
    operation-specific reason"` —— 那句是 WebCrypto 的 `OperationError`，
    **它就是 AES-GCM 认证失败**（口令不对/数据损坏），不是网络问题、不是协议问题。
    看到它不要去查同步协议，直接**逐条解密服务端 op 定位是哪几条**。

    **修法**（**ADR-0016**）：逐条解密、能读的 `applyRemote`、读不了的**跳过**、
    游标**推进**，并且只要跳过了任何一条就**不报 `synced`**，改报
    `{reason:'undecryptable-ops', retryable:false, message:'<serverSeq:opId(errorName)>'}`。
    🔴 但**整页一条都解不开时必须抛错且不推进游标** —— 那是"口令打错了"，
    一次手滑推进游标 = **静默跳过用户整段历史**，比卡死更糟。

    加 `SyncFailureReason` 成员时两个壳会被**编译器**逼着改
    （`Record<Exclude<…,'unexpected'>, MessageKey>` 穷尽）—— 这是设计好的，别绕过。

    配套的探针也要一起改：`undecryptable-ops` 是**一次真的执行了的同步**
    （数据搬了、游标走了），不许再被当成"探针自己坏了"。

42. 🔴 **想验证"某句中文文案有没有进产物"，直接 `grep` 中文会得到**假的**答案 ——
    因为 Metro 的 bundle 里**字符串值被转义成 `\uXXXX`，而注释保留原始 UTF-8**。**

    实测：改掉 `mobile.profile.footnote` 之后，在 bundle 里
    `grep "清单与标签管理尚未实现"` **命中了 1 次** —— 差点据此判断"产物是旧的"。
    打开上下文才发现命中的是**我自己写在词条上方的那条注释**，
    而真正的值在 bundle 里长这样：

    ```
    "mobile.profile.footnote": "\u51ED\u636E\u53EA\u4FDD\u7559..."
    ```

    所以对比新旧文案时，`grep 旧句` 和 `grep 新句` **都会命中**（新句是旧句的子串），
    而命中的那条又是注释 —— **两个方向都会骗你**。

    **而且换一种产物，正确的编码还会变。** 实测（2026-09-27，iOS Release）：

    | 产物 | 非 ASCII 存在形式 | 用 `grep` 搜中文 |
    |---|---|---|
    | Metro 的 JS bundle / `packages/i18n/dist` | `\uXXXX` 转义 | 只命中**注释** |
    | **Hermes 的 `main.jsbundle`（bytecode）** | **UTF-16LE** | **一次都命中不了**（假红） |

    同一条 `mobile.profile.footnote` 新文案在 iOS 产物里的实测计数：
    ```
    utf-8     : 0 次      ← 只看这一种，会得出"没进产物"这个**完全相反**的结论
    utf-16-le : 1 次      ← 真相
    utf-16-be : 0 次
    ```

    所以正确做法是**逐种编码都数一遍，取最大值**，并且**新值和旧值都要数**
    （新 1 / 旧 0 才算真的换了）。已经脚本化了，别再手搓：

    ```
    python3 scripts/tools/check-bundle-string.py --expect 1 <产物> '<新文案>'
    python3 scripts/tools/check-bundle-string.py --expect 0 <产物> '<旧文案>'
    ```

    → 与第 27 条（Android 打进旧 JS bundle）、第 39 条
    （Hermes 是字节码、不可 grep）同族：**"grep 不到"既不等于"没有"，也不等于"有"** ——
    它甚至可能把你推向**假红**，而假红会掩盖真问题。

43. 🔴 **`adb shell input text` 发不了非 ASCII，而且它不是"发成乱码"，是直接抛异常。**

    实测（Android 模拟器，`emulator-5554`）传中文清单名：
    ```
    Exception occurred while executing 'text':
    java.lang.NullPointerException: Attempt to get length of null array
        at com.android.server.input.InputShellCommand.sendText(...)
    ```
    `input text` 走 `KeyCharacterMap`，表里没有的字符就炸。
    所以 **Android 侧的验收脚本用 ASCII 名**（`proj-e2e-<时间戳>`），
    中文输入的验证走 iOS（`idb ui set-value` 能写中文，且那条路径上有
    「添加」enabled 的 L3 断言证明应用真的收到了文字）。

    → 与本条同族的还有第 40 条：**平台工具的输入能力是有边界的，
    而"能输入中文"这件事必须在**具体那条路径上**验过，不能从别处推断。

44. 🔴 **iOS 模拟器的滚动能力取决于手势参数和起点；“滚不动”不能直接归因于产品。**

    当前 Xcode 27.1 / iOS 27 runtime 的实测矩阵：

    | 调用 | 结果 |
    |---|---|
    | `idb ui swipe X1 Y1 X2 Y2`（不带 `--duration`） | 命令可返回，但页面通常不移动。 |
    | `idb ui swipe X1 Y1 X2 Y2 --duration 1.0` | **可滚动**；`duration` 单位是秒，1.0 是直接操纵，约等于拖拽距离。 |
    | `idb ui swipe ... --duration 800` | 把 800 当作 800 秒，命令看似挂死；不要使用。 |
    | `idb ui scroll down` | 不提供可靠的目标滚动，可能报 `the point is empty` / `found no element`。 |

    验收脚本通过 AX 树选择死区起点，再用 `--duration 1.0` 分段拖拽并每步复测；起点不能落在
    TextField、按钮或底部 Tab 上。详情页日期网格最后一行的 44px 按钮曾被误识别为 Tab，导致
    后续“截止时刻”字段永远滚不进来；Tab 结构判据现在要求约 64px 的触控行，并保留边缘死区。

    另外 **`idb ui set-value` 对滚出屏幕的元素不生效，而且不报错**：必须先
    `--scroll-into-view`，再 set，并以同一字段的 AX 回读作为唯一写入判据。
    对普通 TextInput，回读必须在键盘仍显示时完成；点击键盘“完成”可能触发
    `onSubmitEditing`，把收键盘误当成任务提交。只有 secure 输入框因聚焦从 AX 树消失时，才收键盘后重读。

45. 🔴 **`cmd | tail -n; echo $?` 里 `$?` 是 `tail` 的 —— 我因此把
    "退出码是 1" 读成了 "退出码是 0"。**

    实测：`idb ... ui scroll down | tail -3; echo "rc=$?"` → 打印 `rc=0`，
    而 `idb ... ui scroll down; echo rc=$?` → `rc=1`。
    这条**恰好和"看到 rc=1 就以为命令失败"的错误合谋**：我先因为管道拿到 rc=0
    而认为命令没报错，又因为回执里那句 `found no element` 以为它只是没找到元素。

    已知受害点：第 12 条（"绝不把门禁管道接 `tail`/`sed`"）讲的是**门禁**，
    这一条补充的是：**任何"我要读这个退出码"的场合都不能接管道**
    （`| sed`、`| tail`、`| head` 都是）。
    要么不接，要么用 `${PIPESTATUS[0]}`（bash 3.2 支持）。

46. 🔴 **"在干净环境里复现不出来" ≠ "不存在" —— 先问这个代码路径的前置条件。**
    `SyncClient.upload()` 开头是 `if (pending.length === 0) return;`。
    所以那个"上传响应里搭车的 op 解不开就拖垮整次同步"的缺陷，
    **只有设备手上真的有东西要传时才会被走到**。

    我因此连着得出过两个**假绿**的结论：

    - 用干净数据库起一个 `node-host` 探针 → 没有待上传的 op → 路径根本没执行
      → "解密路径没问题"；
    - 在 Node 里模拟 Hermes（摘掉 `WebAssembly` + `crypto.subtle`）→ **依然是绿的**，
      因为它根本不是密码学问题，是**控制流**问题。

    真机的证据（手机上传成功、服务端确实收到 op、而本地库里**远端 op 数 = 0**）
    才把方向掰回来。

    配套的动作是**换判据**：`scripts/verify-mobile-lists.sh` 第 7 步原来只判
    「界面说同步完成了」，于是"上传成了、下载整批作废"被判成通过；
    现在必须**真的数出本地库里的远端 op 条数 ≥ 1**。
    **一个只在半瘫状态下才为真的判据，才是这类缺陷的判据。**

    同族提醒（第 38 条）：**"没有观测到 X" ≠ "X 没有发生"**；
    这一条补的是它的近亲 —— **"没复现出来" ≠ "路径没被执行"。**

47. 🔴 **查"拼接出来的状态行"必须用 `has_sub`，不能用 `has_text`。**
    `scripts/lib/mobile-e2e.sh` 里：

    - `has_text` 是**整节点精确匹配**（`grep -q "text=\"$1\""`）；
    - `has_sub` 是子串匹配（`grep -q "text=\"[^\"]*$1"`）。

    界面上的状态行往往是**一句拼接出来的整句**，例如

    > 有部分历史数据用当前口令解不开（…），已跳过 —— 其余数据已同步

    我写 `wait_synced` 时把判据写成 `has_text "其余数据已同步"` ——
    **永远为假**。后果不是"报个错"，而是**空转**：手机其实已经同步成功
    （界面上就写着那句话），`wait_synced` 却老老实实跑满 180 轮 × 5 秒，
    日志一个字都不长。看起来像"同步卡死"，实际上是**探针的判据坏了**。

    ⚠️ 更值得记的是：`has_sub` 上面**早就写着这条注释**（讲冲突状态行
    「有 1 处冲突待你选择」踩过同一个坑）。**规则在同文件里，我还是踩了。**

    验证判据的廉价办法：拿一份**真实 dump** 直接跑一遍 `grep`，
    确认新判据为真、旧判据为假 —— 不要靠"读起来应该能匹配"。

48. 🔴 **`pnpm <名字>` 找不到脚本时，会去跑 PATH 上同名的二进制。**
    本仓库**没有 `lint` 脚本**。我随手在一个门禁循环里加了 `lint`，
    于是 `pnpm lint` 跑起了 **Android SDK 的 `/opt/homebrew/bin/lint`**，
    吐出一堆 gradle 参数说明和 `1 Lint errors detected`。

    它差一点被当成"仓库门禁红了"。**这是自己造出来的假红**：

    - 真正的聚合门禁是 **`pnpm check`**（build + typecheck + 全部 `check:*` 门禁 + 浏览器套件）。
      这里**刻意不写门禁条数** —— 它已经因为"加了门却忘了改这句话"漂过一次
      （`check:mobile-bundle` 加进链里时，本句还写着 13）。要数就直接看 `package.json`
      的 `check` 脚本，那是唯一权威；
    - 加门禁名之前先 `python3 -c "import json;print(json.load(open('package.json'))['scripts'])"`
      看一眼**它到底存不存在**；
    - **自己造出来的红不是产品缺陷**，报之前先问"这个命令是本仓库的吗"。

49. 🔴 **Playwright 的 `check()` / `uncheck()` 断言的是"控件当帧的 DOM 状态"，
    不是"这次操作生效了"。** 受控组件 + 异步派发时它是**假红**。

    `apps/web` 的 op-log 写入是异步的（`lib/oplog.ts`：`await engine.dispatch(intent)`
    之后才 `notify()`）。于是点一下复选框：DOM 原生勾上 → React 手里还是旧的
    `tagIds` → 重渲染把勾按回去 → Playwright 当场报
    `Clicking the checkbox did not change its state`。

    **op 其实已经派出去了。** 换成 `click()` + 断言**结果**（那一行上真的出现了
    标签 chip），`expect` 自带重试，而且断言的是产品契约。

    ⚠️ 前提是那条结果断言**真的会失败** —— 见第 50 条，它当时差点就不会。

50. 🔴 **"操作之后状态是对的"这条断言，在"操作从来没生效过"时也可能是绿的。**
    **先证明它曾经生效过，再断言它被撤销。**

    我写的"取消标签"用例：打上标签 → 断言 chip 在 → 摘掉 → 刷新 → 断言 chip 不在。
    变异测试（把指派改成**只写本地 React 状态**、不派发 op）暴露出：
    第一条用例在「刷新后标签丢了」红了，**而这条用例全绿** ——
    因为"从来没存过"同样满足"刷新后没有"。

    改成 **打上 → 刷新（还在）→ 摘掉 → 刷新（没了）** 之后，同一个变异让它也红了。

    这是本仓库第 N 次遇到同一形状：**一条断言是否"能失败"，只能靠变异测试回答，
    不能靠读它**。顺序本身也是判据的一部分。

51. 🔴 **"变异测试红了"也要看它红在哪儿 —— 红在别的原因上等于没做变异。**

    我给三端验收做变异（强制两台设备共用 `clientId`）时，把变异脚本拷到 `/tmp` 跑。
    脚本里到处是 `$(dirname "$0")/lib/...`，于是它去找 `/tmp/lib/mobile-e2e-fresh-account.sh`
    —— **第 53 行就死了**，`exit 1`。而 `exit 1` 看起来正是"变异成功让验收红了"。

    实际上它那一次**一条断言都没跑到**：既没证明判据有鉴别力，也没证明别的。
    挪到 `scripts/` 旁边之后才真正红在断言处：

      ❌ client 数没有多出新的（1 → 1）—— 无法证明那条是**另一台设备**写的

    判据：变异之后要**读到那条期望的失败**，而不只是"退出码非 0"。
    （同源的坑还有第 45 条：`cmd | tail` 的 `$?` 是 `tail` 的。）

52. 🔴 **服务端读不了 op 的内容 —— 它是密文。别写按内容的服务端断言。**

    `operations.payload` 是 E2EE 之后的载荷（同表有 `is_payload_encrypted`）。
    我写的服务端判据是 `payload->>'title' = '...'`，于是它报
    「服务端没收到」，而**同一轮的最后一步却从服务端把另一台设备建的任务拉了回来**。
    两个判据互相矛盾 —— 这时**探针是首要嫌疑**。

    尊重 E2EE 的服务端判据只有两类：

    1. 某类 op 的**条数增量**（收到没收到）；
    2. **distinct `client_id` 数**（是不是真有两台设备在写）。

    "收到的是不是我想的那一条"**只能**由另一台设备解密后读出来回答。
    顺带一条：`clientId` 不只是 LWW 决胜依据，它还是**设备身份** ——
    变异测试实测，两台设备共用它会**同时**破坏对方的读与写。

53. 🔴 **自建栈上"Web 端同步变离线"，先查 CORS，别查网络。**

    `apps/web` 跑在 vite 自己的端口上，调 API 就是**跨域**。服务端默认只放行
    `DEFAULT_CORS_ORIGINS = ['https://app.super-productivity.com']`
    —— 那是随上游 `super-sync-server` 继承来的域名。预检不通过时：

    - 浏览器**根本不会发出**那个 POST；
    - 界面状态条显示「**离线** · 改动已排队，联网后自动重试」；
    - 服务端日志里**一条请求都没有**。

    看起来完全像网络问题。验收栈（`scripts/mobile-e2e-up.sh`）已显式带上
    `CORS_ORIGINS`；`verify-multi-end-sync.sh` 第 0 步也会**单独验一次预检**，
    不通过就 `exit 3`（环境失败，不是产品失败）。生产上的正解是**同源部署**
    （服务端自己 `@fastify/static` 托管 Web 产物）。

54. 🔴 **生产机的 `server/.env` 里有 `TEST_MODE=true` —— 当前无害，但别给它接上管道。**

    2026-09-26 实测（`ubuntu-jcli` / `124.223.13.226`）：

    ```
    ~/heyta/server/.env:11  TEST_MODE=true
    ~/heyta/server/.env:12  TEST_MODE_CONFIRM=yes-i-understand-the-risks
    ```

    而 `config.ts` 在 `NODE_ENV=production` + `TEST_MODE=true` 时是**抛错拒绝启动**的。
    看起来像一颗定时炸弹，但**实测容器 env 里根本没有 `TEST_MODE`**：

    ```
    docker inspect supersync-server → NODE_ENV=production, PUBLIC_URL=...,
                                      CORS_ORIGINS=...  （没有 TEST_MODE）
    RestartCount=0, Up 18 hours (healthy)
    ```

    原因是 compose 的 `environment:` 是**白名单**，那个文件根本没被读进容器。
    所以：**现在不会炸**；但谁哪天加上 `env_file:` 或 `docker compose --env-file server/.env`，
    容器就会立刻进入 crash-loop。要接之前先把那两行删掉。

    同一台机器上还有两件**容易被误判**的事：

    - **3000 端口不是我们的。** `curl 127.0.0.1:3000/health` 返回的是
      `{"service":"sumei-print",...}` —— 另一个项目的服务。
      我们的容器发布的是 `1900`（`1900/tcp -> 127.0.0.1:1900`），
      公网入口是反代到 `https://heyta.finlaw.cloud`（测试阶段唯一的域名，2026-09-27
      从 `heyta-tmp.litopia.space` 完整迁来；旧域名只留同步端点与入口 301）。
      **在这台机器上按 3000 判"服务端活没活"会得到错误结论。**
    - `CORS_ORIGINS` 生产上设成了自己的 `PUBLIC_URL`（同源），
      所以第 53 条那个上游默认域名在生产上**不生效**。

55. 🔴 **一段流程里 `throw` 了，要问的不是"报了什么错"，而是"**它跳过了哪几步**"。**

    同步是"先上传、再下载"两段。`upload()` 里一个 throw，界面报的是"同步出错"，
    而**真正发生的事是下载一次都没执行** —— 这台设备从此**只写不读**。
    只盯报错文案会得出"错误显示得不好看"，而缺陷是"设备单向聋了"。

    查法：看抛错点**后面**还有什么没跑。凡是"多阶段流程中途抛错"的地方
    （迁移、导入、批量写、上传→下载），都要问一句"跳过的那段是不是比报错重要得多"。
    修法通常是**让各阶段互相独立**：一个阶段的失败只该影响它自己。

56. 🔴 **一次性信息必须排在持久状态之前上报。**

    "有改动被服务端永久拒绝"是**一次性**的：那些 op 已被移出队列，
    **下一次同步不会再提**。而"有历史数据解不开"是**持久**状态，下次照样会报。

    两者同时出现时，如果先报后者，用户**再也没有机会知道**有改动没上去。
    判据优先级 = **"错过就再也看不到的"优先**，而不是"谁更严重"。

57. 🔴 **`pnpm check` 全绿 ≠ 单元测试通过 —— 它根本不跑单元测试。**

    `package.json`：

    ```
    "test":  "pnpm -r build && pnpm -r test"
    "check": "pnpm build && pnpm typecheck && check:migrations && … && check:ai-e2e"
    ```

    `check` 里**没有任何一步是 vitest**。实测：跑完 `pnpm check`（rc=0）之后
    `grep -c vitest <日志>` 等于 **0**。

    本仓库已经因为"测试全绿 ≠ 能打包"吃过一次亏；这是它的镜像：
    **门禁全绿 ≠ 测试全绿**。两者都要跑，顺序无所谓，但不能拿其中一个当另一个。

    改完逻辑之后至少要：`pnpm -r test`（全仓单元）**和** `pnpm check`（构建 + 门禁 + 浏览器）。

58. 🔴 **变异"没复现"时，先确认变异**真的**生效了 —— 否则你会把"变异没写对"读成"判据挡住了"。**

    给 `verify-harmony-rnoh.sh` 写了一个"把 RNOH 从构建里摘掉"的变异，跑完 **rc=0、17/17 全绿**。
    差一点就得出一条**完全错误**的结论（"判据对 RNOH 不敏感"）。

    实际上那次的变异**一行都没改到** —— heredoc 里的正则被转义搞坏了，
    `re.sub` 什么也没匹配上，脚本照旧用了原始的 CMakeLists。

    做法：**变异后先 diff 输入，再解释结果。**
    本次直接改探针工程（不用正则）并 `print(s.count(a))` 确认命中，重跑才得到真结论：
    **rc=255、`ninja: build stopped`、没有 HAP 产出** —— 判据有鉴别力。

    与陷阱 46 是一对：那条是"没复现 ≠ 路径没执行"，这条是
    "**没复现 ≠ 变异生效了**"。两者都会把一次无效实验读成一个技术结论。

59. 🔴 **鸿蒙：RN 0.84 的 CLI 要 Node ≥ 20.12，而 DevEco 自带 Node 18.20.1 —— 报错信息完全指错方向。**

    `react-native codegen-harmony` 会死在 `TypeError: styleText is not a function`
    （`util.styleText` 是 Node 20.12+ 才有的）。**从这句话看不出跟 Node 版本有关。**

    更绕的是**误导链**：第一次失败先弹
    「`react-native` depends on `@react-native-community/cli`」（RN 0.84 不再捆绑它），
    装上那个包**才**露出真正的 `styleText` 错误。

    修法：把 hvigor 的 **`NODE_HOME` 指到 Node ≥ 20.12**（hvigor 会用 PATH 上的 node
    跑 `node_modules/.bin/react-native`，所以子进程也跟着换）。
    `scripts/verify-harmony-rnoh-js.sh` 把「Node 版本」做成了**会红的硬判据** ——
    写成警告的话，脚本只会以 `styleText` 崩掉，而没人知道为什么。

60. 🔴 **`bundle-harmony` 找不到 `hermesc`：它在 `hermes-compiler` 包里，不在 `react-native/sdks/`。**

    默认它会去 `node_modules/react-native/sdks/hermesc/osx-bin/hermesc` 找
    （RN 0.84 里不存在）→ `Couldn't find hermesc`。真身在
    `node_modules/hermes-compiler/hermesc/osx-bin/hermesc`，要显式
    `--hermesc-dir node_modules/hermes-compiler/hermesc`。

    且：**验 Hermes 字节码要验魔数 `0x1F1903C103BC1FC6`，不能验扩展名** ——
    把 JS 改名成 `.hbc` 能骗过所有只看文件名的检查。

61. 🔴 **官方模板是半成品 —— 模板里被 CLI 在 init 阶段填掉的字段，就留在模板里当坑。**

    用 RNOH 官方 CLI 自带的 `templates/harmony` 也不行，以下三处必须按实际环境改写，
    **而它们的失败信息都不指向真正原因**：

    - `entry/src/main/ets/pages/Index.ets` **根本不在模板里**（`pages/` 是空的），
      真货由 CLI 的 `EntryIndexTemplate` 生成 → 不补就报 `Page '...' does not exist`。
      **解法是从官方模板渲染，而不是手抄一份**（手抄必然漂移）。
    - `AppScope/app.json5` 的 `bundleName` 是 `"com.example"`（**两段**），
      过不了 hvigor 的 schema（要求三段以上）。
    - `compatibleSdkVersion` 还是旧的（模板里写着 `5.0.0(12)`）→ **要读 `sdk-pkg.json`，别写死。**

    推论：**装了 DevEco ≠ 能出包**；"官方模板"也不等于"能直接跑"。

62. 🔴 **鸿蒙工程别放在 macOS 的 `$TMPDIR` 下 —— hvigor 会用绝对路径当 pnpm store 文件名，撞 255 字节上限。**

    把 `rnoh-hvigor-plugin-0.84.4.tgz` 接进 `hvigor-config.json5` 后，hvigor 内部的 pnpm 会
    **拿 tarball 的绝对路径**去拼 store 索引名。路径一旦够长：

    ```
    ERR_PNPM_ENAMETOOLONG  name too long, open
    '/Users/.../.hvigor/caches/v10/index/b2/38e7...-file+..+..+..+..+..+..+private+var+folders+
     5n+zvn6...T+heyta-harmony-rnjs+proj+node_modules+...'
    ```

    **而 hvigor 只往外抛一句 `00308002 Operation Error`**，真因埋在它启动的 pnpm 输出里。

    macOS 的 `$TMPDIR` 是 `/var/folders/5n/xxxx/T/`（还常被解析成 `/private/var/...`），
    一个"默认用 `$TMPDIR` 很规范"的脚本就会随机踩中。**工程放 `/tmp/xxx`。**

    这也是"**退出码/错误码不携带原因**"的又一例：`00308002` 什么都说明不了，
    必须去日志里捞 `ENAMETOOLONG`。三个 `verify:harmony-*` 脚本现在都
    （a）默认用 `/tmp` 短路径，（b）失败时**把这一条真因单独打出来**。

63. 🔴 **模拟器跑久了，App 的无障碍注册会卡死 —— "AX 桥不通"会把你整条指向 App，而真因在模拟器。**

    现象：`verify:mobile-ios` 第 1 步红，报"找不到「新建任务」按钮 —— AX 桥不通，
    或 App 不在任务页"。**而 `idb screenshot` 里 App 明明好好停在任务页、FAB 就在那儿。**

    实测把能排的全排掉了（**都不是**原因）：

    | 候选 | 证据 |
    |---|---|
    | companion 没起来 | describe-all 返回合法 JSON，连得上 |
    | companion 馊了 | 换新的也一样；且**主屏能读出 11 个 label** |
    | App 崩了 | 无崩溃报告，`launchctl` 里在，界面对点击有响应 |
    | 整树被无障碍隐藏 | 源码里没有 `accessibilityElementsHidden` 那类写法 |

    真因：**模拟器连续跑了 13 小时后，App 对 AX 只暴露一个零尺寸的 `Application` 节点**
    （`AXFrame: "{{0, 0}, {0, 0}}"`、label 数 0）——**重启模拟器立刻恢复**：
    同一台设备、同一个 App、同一个 companion，label 数 **0 → 42**。

    两条方法论：

    - **判据必须是"App 起来之后树里有没有内容"，不是"companion 连不连得上"。**
      旧的 `companion_ok` 只要求"是合法 JSON 数组"，于是那个
      `[{"role":"AXApplication","frame":{0,0,0,0}}]` **判成了健康** ——
      一条不会失败的检查。
    - **"主屏有 label"不能当对照。** 卡死期间主屏一直读得出 11 个 label，
      拿它做对照会得出"树是好的"的假结论。我第一版就是这么误判的，还先错怪了 companion。

    现在 `verify-mobile-ios.sh` §1.0 会：App 起来后先查 label 数 → 为 0 就
    **重启模拟器 + 重拉 companion + 重启 App**（自动自愈，代价是再付一次 ~50 秒
    Argon2id 派生），恢复不了才报错，且报错文案明确写"**先怀疑工具链，别先怀疑产品**"。

    **推论：`idb` 不会自己拉 companion。** 它只连 `/tmp/idb/<UDID>_companion.sock`，
    没人起就 `[Errno 2] No such file`。脚本现在用官方参数
    （`--grpc-domain-sock <sock> --only simulator`）自己拉。

64. 🔴 **"探针坏了"和"对端没有"之间的分界线，会被一个仓库根相对路径悄悄挪掉。**

    `scripts/lib/mobile-e2e.sh` 里 `CLI="apps/node-host/dist/cli.js"` 是**仓库根相对**的。
    一旦不是从仓库根调用脚本（例如 `cd scripts && bash verify-mobile-ios.sh`，
    这正是"跑变异脚本要 `cd scripts`"那条老习惯）：

    ```
    node:internal/modules/cjs/loader:1433   ← 在 scripts/apps/... 里找不到
    ...
    Node.js v22.22.3                        ← 探针只回报了这最后一行
    ```

    于是笔记本探针**每次都失败**，报告写的是"笔记本探针自己坏了（不是产品问题）"。
    同一份脚本、同一台设备，**从仓库根跑全绿，从 `scripts/` 跑就红**。

    这次没被误导，靠的是探针**早就分开的 rc=2**（探针坏了 ≠ 对端没有）——
    那条分类挡在了同步协议之外。但**根因是路径**：`APK` / `CLI` 现在都用
    `HEYTA_REPO_ROOT`（由 lib 自身位置推出）拼成绝对路径，脚本在哪都能跑。

    教训：**"探针坏了"是个告警，不是结论** —— 它说"这一段没测到"，
    不代表"被测的东西坏了"，也**不代表探针真的坏了**。

65. 🔴 **Android release 构建要 JDK 17 —— 而 `java_home -v 17` 在这台机器上找不到它。**

    现象：`pnpm --filter @heyta/mobile build:android` **十秒**就失败，报

    ```
    Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field
    'org.gradle.jvm.toolchain.JvmVendorSpec IBM_SEMERU'
    ```

    🔴 这个错误**长得像 Gradle 插件版本不兼容**（一个 class 少了个成员字段），
    于是很容易去查 plugin / AGP / wrapper 版本 —— 而**真因是 JDK**：

    `/usr/libexec/java_home -V` 只登记了 temurin-**24**，所以
    `java_home -v 17` **返回空**，构建命令里那句 `|| echo "$JAVA_HOME"` 就兜底到 24，
    而 Gradle 9 + JDK 24 起不来。**唯一可用的 17 在 Homebrew 里**，
    不在 `/Library/Java/JavaVirtualMachines`：

    ```bash
    export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
    ```

    换上去之后同一条命令 `rc=0`，产出 ~65 MB 的 release APK，APK 的 mtime 也随之前进。
    **验证"真的重编了"要看 mtime，不要看 rc** —— 失败时 rc 是 1，但
    **旧的 APK 还在原地**，`ls` 一样能看到文件。

    教训：报错文本里的**类名/字段名**很容易把人钉死在"依赖版本"上，
    而它只是"运行时被换了一个"的副作用。**报错信的是现象，不是原因。**

66. 🔴 **既有验收都"点了那个按钮"，于是"按钮还能用"被当成了"链路是通的"。**

    在自动同步之前，全应用**只有** `ProfileScreen` 那个「立即同步」按钮会调
    `syncNow()`。于是：**用户建完一条任务，它不会自己出去。**
    不报错、界面看不出异常、单测也证明不了 —— `sync/store.ts` 的逻辑是对的，
    缺的是**没人调它**，而"没人调"是**接线**，正是单测照不到的那一层。

    🔴 **为什么两年没被发现：每一条既有移动端验收都点了那个按钮。**
    `verify-mobile-conflict.sh` 建完任务立刻 `xy_text "立即同步"` + tap。
    于是"同步链路是通的"这条结论**永远为真**，而
    "**用户不点它，还通不通**"这件事从来没有人问过。
    **验收点的是按钮，结论下的却是整条链路。**

    所以新判据 `pnpm verify:mobile-autosync` 里**不存在**任何对同步按钮的点击 ——
    加了那一下，整个验收就退化成"按钮还能用"。

    ⚠️ 而且**故意不做**"凭据一填齐就自动同步"这个触发点：那会让
    `verify-mobile-conflict.sh` 的"首次同步"断言**恒真**（测试去点按钮时，
    状态早就结算完了），等于亲手造一条**不能再失败**的检查。见 plan §3.27(b)。

    变异验证（这是这条判据的价值所在）：把 `dispatch` 之后那声
    `emitLocalWrite()` 拿掉 → 重新出 APK → 同一条验收
    **3 红**：判据 (a)「120 秒内服务端一条请求都没有」、
    判据 (b)「另一台设备没读到」、以及
    `❌ 待上传没有归零（text="1 项"）` —— 最后那条正是用户会看到的
    "**数据卡在本地，而界面一切正常**"。

67. 🔴 **"查不到"不是"不存在" —— 按钮在 `loading` 时，它的文字节点根本不存在。**

    自动同步上线后跑回归，`verify-mobile-conflict.sh` 冒出 3 次

    ```
    java.lang.IllegalArgumentException: Argument expected after "tap"
    ```

    **而最终结论照样是 `通过 35 项，失败 0 项`。**

    那脚本里有 4 处手写的 `XY=$(xy_text "立即同步"); $ADB shell input tap $XY`。
    自动同步抢跑之后同步**正在跑**，而 `Button` 在 `loading` 时渲染的是

    ```tsx
    {loading ? <ActivityIndicator/> : <><Icon/><RNText>{label}</RNText></>}
    ```

    —— **只有菊花，没有文字节点**。所以 `text="立即同步"` 查不到；
    而 busy 文案（`正在同步…`）**只挂在 `accessibilityLabel` → `content-desc` 上，
    `text` 里根本没有**。于是 `XY` 为空 → `input tap` 拿空参数执行 → adb 抛异常
    → 而**脚本从不检查 `XY` 是否为空**，一行都不报。

    > **"点了一下同步"和"什么都没点"在报告里长得一模一样。**
    > 冲突断言照样绿 —— 因为冲突是**自动同步**造成的。
    > 结论没错，但它不再是被测的那件事产生的了。

    🔴 **同一个坑有三种变体，一次全修**（不只修被撞到的那一处）：
    静默空操作两种（`input tap $XY`、`[ -n "$XY" ] && tap`），
    以及**假红**一种（`[ -z "$XY" ] → bad`：同步正在正常跑，却报"找不到按钮"）。

    🔴 **而我第一版修错了，错法本身又是这条陷阱**：改用 `has_text "正在同步"`
    判断 → 又误报 3 条 `bad`，而同步正在正常进行。真因就是上面那条：
    busy 文案只在 `content-desc`。本库 `has_desc` 上面那句注释**早就写明了这条规矩**
    （"按钮这类节点的可辨识名在 `content-desc` 上，用 `has_text` 查它们**永远是 0**"），
    我写那个函数时没看它。

    修法：共享库 `ensure_phone_sync()`（三态：真点 / 已在跑就等并**打印说明** /
    真没有才 `bad`）+ `has_desc_sub()`。

    **和 §7 第 63 条、第 64 条是同一个形状**：先排除"我查错了地方"，
    再下"它不存在"的结论。

68. 🔴 **delta 基线取晚了，会把"更快"读成"没发生"。**

    `verify-mobile-focus.sh` 原来这样断言"专注记录到服务端了"：
    在**快要断言之前**取 `SRV_BEFORE`，点同步，再取 `SRV_AFTER`，查增量。

    这在"op 只有点按钮才出去"的年代是对的。**自动同步上线后前提就没了** ——
    业务动作一派发 op，两三秒内就传上去了；等取基线时，基线里**已经含了本次那条**。

    A/B 实测（同一条脚本、同一个 APK，只切自动同步）：

    | 自动同步 | 输出 | 结果 |
    |---|---|---|
    | 关 | `✅ 服务端收到了专注记录（3 → 4）` | **26/26** |
    | 开 | `❌ 服务端没收到专注记录（3 → 3）` | 25/26 |

    而**同一次运行的下一行**打印的是
    `✅ 笔记本（真 SQLite）同步后有了 1 条 FOCUS_SESSION op` ——
    服务端没收到的话笔记本不可能拉到。**这是假红。**

    修法：基线前移到**任何本地写入之前**，断言"相对运行前有增长"。
    它对"谁在什么时候上传"不敏感，但"本次运行确实新增了"仍然为真。

    🔴 **一般化**：任何"前 / 后取两次样、查差值"的判据，
    都要先问一句 **"这两次取样之间，还有谁会写？"** ——
    引入一个后台进程（同步、定时任务、缓存刷新）就会让这类判据失真，
    而且失真的方向**恰好是报假红**。

    🔴 **配套纪律**：改动引入回归时，**先建基线再定罪**。
    这一轮 `verify:mobile-edit` 报了一串失败，看着像"自动同步把编辑面板搞坏了"；
    把自动同步关掉重建 APK 一跑，**失败点一模一样** ——
    真因是 i18n 迁移（`ccf3e50`）留下的陈旧定位符：
    脚本找 `任务标题`，界面上的词条是 **「标题」**。
    **不建基线，我就会去改一段本来正确的同步代码。**

69. 🔴 **`$VAR` 后面紧跟全角字符时必须写成 `${VAR}` —— 否则一旦有 UTF-8 locale 就会炸。**

    本机是 **GNU bash 3.2.57**（macOS 自带）。实测：

    ```bash
    TITLE2=abc
    echo "第二条任务：$TITLE2（基线）"     # 没有 LANG 时正常
    ```

    | 环境 | 结果 |
    |---|---|
    | 默认（无 `LANG`） | ✅ 正常 |
    | `LANG=en_US.UTF-8` | ❌ `TITLE2\xef: unbound variable` |
    | `LC_ALL=en_US.UTF-8` | ❌ 同上 |
    | 写成 `${TITLE2}（` | ✅ 两种环境都正常 |

    **bash 3.2 会把 `（`（U+FF08，字节 `EF BC 88`）的首字节 `EF` 并进变量名**，
    于是报一个**名字里带乱码字节**的 `unbound variable`。

    🔴 **为什么这条很危险**：本仓库 `scripts/` 里这种写法有 **178 处**，
    它们**平时全部正常**（脚本都不设 `LANG`）—— 所以这是一个**潜伏**的坑：
    任何一次"顺手 export LANG"（这次是 iOS 构建需要 `LANG=en_US.UTF-8`，
    而我把 export 留在了同一个 shell 里）都会让 `pnpm verify:mobile-ios`
    在**一条与同步毫无关系的 echo 行**上崩掉（`line 763: TITLE2?: unbound variable`），
    而现场看起来像"新加的那一步有 bug"。

    **纪律**：① 脚本里 `$VAR` 后面跟中文标点，一律加花括号；
    ② 构建用的 `export LANG=…` **只作用于那一条命令**（`env LANG=… cmd`），
    不要留在跑验收的 shell 里。

70. 🔴 **`check:docs` 的绿是"本机绿" —— 干净 checkout 里它是红的。**

    实测（2026-09-27，两个独立 worktree 复现）：

    | 环境 | `check:docs` |
    |---|---|
    | 主工作目录 | ✅ 151 文件 / 777 链接全通 |
    | 干净 worktree / 新克隆 | ❌ exit 1，6 处死链 |

    死链全部指向 `../../research/upstream/super-productivity/...`，
    而 `research/upstream/` 在 `.gitignore:25` 里 —— **它根本不是仓库的一部分**。
    `docs/research/native-widgets.md`（121/309/310/311 行）与
    `docs/research/multi-platform-selection-evidence.md`（36 行）**被跟踪**，
    却链接进一个只存在于某些机器上的目录。

    🔴 **为什么这条危险**：它同时骗两个方向 —— 在别人的机器上，一个**本来正确的改动**
    会看到 `check:docs` 红；而在本机会看到绿，于是没人发现那 6 个链接对读者是坏的。
    这与 §7 第 69 条是同一类毛病：**判据依赖了不该依赖的环境**。

    **纪律**：相对链接的目标必须**在仓库里**。要引用 gitignore 的上游代码，就写路径文本
    或指向可公开访问的 URL，不要写成相对链接。

71. 🔴 **国内主机上 `docker compose build` 会"静默卡死"两次 —— 症状像在编译，其实什么都没发生。**

    两个都不是编译慢，是**默认源连不上**，而两者都**不设超时**：

    | 卡在哪 | 默认源 | 实测 | 绕过 |
    |---|---|---|---|
    | `RUN apk add` | `dl-cdn.alpinelinux.org` | 超时无响应，卡满 40 分钟**零输出** | `APK_MIRROR=mirrors.aliyun.com`（0.26s） |
    | `RUN pnpm install` | `registry.npmjs.org` | 0.79s→几分钟；356/360 后 `TimeoutError`，整层作废 | `NPM_REGISTRY=https://registry.npmmirror.com`（0.79s） |

    `server/Dockerfile` 与 `server/docker-compose.build.yml` 已把两者做成**构建参数，默认仍是官方源**
    （别处的自建者行为不变）。见 `docs/runbooks/deployment.md` §3.8。

    ⚠️ **失败的层不进缓存**，所以 npm 那次是**每次重试都从零开始** ——
    "再跑一次说不定就过了"在这里不成立。

72. 🔴 **`scripts/tools/ios-ax-shim.py --press` 会假成功 —— 点空了也回 `result=success`。**

    它是"读一次 AX 树 → 按**读到的坐标**点一下"。UI 一动坐标就过期，点击落空，
    **但回执照样是 success**。实测在「回收站」上被骗 3 次：每次都报成功，界面一动不动。
    这会让人得出"功能没实现"或"改了没用"的错误结论。

    可靠原语（原子，不靠坐标快照）：

    ```bash
    idb ui tap <label> --match-key AXLabel --api axbridge   # 按标签定位并点
    idb ui tap --api hid X Y                                # 真要按坐标时
    idb ui scroll visible <label> --api ax                  # 先把元素滚进视野
    ```

73. ⚠️ **`pod install` 在路径含空格的 worktree 里必失败（本仓库路径就含空格）。**

    `All in one Data` → CocoaPods 抛
    `ArgumentError - path name contains null byte`
    （`project.rb:452` `Pathname#realdirpath` ← `file_references_installer.rb:228`；
    上游同形 issue：cocoapods/cocoapods#12866）。
    设 `CP_CACHE_DIR`/`CP_HOME_DIR` 只能绕过 `~/Library/Caches` 的沙箱拒绝，**救不了这一条**。
    结论：**原生重建只能在主工作目录做**；在 worktree 里只能换 JS bundle（见下条）。

    ⚠️ 只换 JS bundle 的取证方式（本次用它完成了 iOS 实测）：
    `react-native bundle` 出 Release bundle → `ditto` 进已安装的 `.app` → 换掉 `main.jsbundle`
    → `codesign -f -s -` → `simctl install/launch`。
    **仅在 `ios/`、`package.json`、`pnpm-lock` 都没改时成立**，否则 native 与 JS 会错配。

74. 🔴 **`npm_config_registry` 环境变量会被 pnpm 忽略 —— 换源必须用 `pnpm config set registry`。**

    这是第 71 条的**直接续集**，而且是**更坏的一种**：你明明传了 `NPM_REGISTRY`，
    Dockerfile 里也 `ARG`/展开得好好的（构建日志会把它打印成
    `RUN npm_config_registry="https://registry.npmmirror.com" pnpm install …`），
    但 pnpm **照旧从 `registry.npmjs.org` 取包**，于是还在同一处超时：

    ```
    #17 [WARN] GET https://registry.npmjs.org/prisma/-/prisma-5.22.0.tgz error (23) …
    #17 TimeoutError: The operation was aborted due to timeout
    ```

    "参数传对了"与"真的生效了"是两件事 —— **看日志里的 URL，别看日志里的命令**。

    正确写法（`server/Dockerfile` 已改）：

    ```dockerfile
    RUN pnpm config set registry "$NPM_REGISTRY" \
     && pnpm install --frozen-lockfile --ignore-scripts
    ```

    容器内实测：`pnpm config set registry … && pnpm view zod version` → `4.6.5`，**1.05s**。
    生产层用的是 npm，`--registry=` 显式传即可。

    补充事实：`grep registry.npmjs.org pnpm-lock.yaml` = **0**，锁文件里没有任何硬编码 URL，
    所以"从哪取包"完全由配置决定 —— 配置设上了就真的换源了。

75. 🔴 **镜像里少拷两个根级文件，`server` 其实早就构建不出来了 —— 而本地永远绿。**

    一个**潜伏**了很久的缺口，直到 billing 开始 `import` 才炸：

    | 缺什么 | 症状 | 为什么以前没暴露 |
    |---|---|---|
    | `packages/domain`（清单 / 源码 / build+pack / tarball） | `TS2307: Cannot find module '@heyta/domain'` | 镜像按 2026-09-26 的源码建的，那时 server 还没 import 它 |
    | `tsconfig.base.json` | `TS5083: Cannot read file '/repo/tsconfig.base.json'`（tsup 的 dts 阶段） | sync-core / shared-schema 都**不** `extends` 任何东西，只有 `packages/domain` 要 |

    ⚠️ **核心教训**：`pnpm -r build` 在本地**永远看不出这个问题** ——
    工作区全都在，`@heyta/domain` 与 `tsconfig.base.json` 自然都在。
    "本地全绿"证不了"镜像能构建"；**只有真的 `docker compose build` 才算数**。

    生产层还有一个必须遵守的点：`pnpm pack` 会把 domain 自己的 `workspace:*` 改写成真实版本号，
    所以 `domain.tgz` 必须和 `shared-schema.tgz` 放在**同一条** `npm install` 里，
    npm 才能就地满足它。

76. ⚠️ **`deploy.sh --build` 的"干净输入"守卫在文档写明的部署形态下永远跑不起来**，且它的清单本身是漏的。

    两个独立的毛病：

    - **守不住**：它用 `git diff` 判断输入是否干净，而 `docs/runbooks/deployment.md` §3.2
      写明的部署形态恰恰是**rsync 上来的源码目录**（`~/heyta` 没有 `.git`）。
      于是 `git diff` 必然失败 → 失败被当成"有脏文件" → 报
      `Refusing to build … from dirty tracked input files`，**把一个不存在的原因指给运维**。
      现在：不是 git 仓库就显式跳过并告警（并讲清代价：镜像标签退化成 `local`、不可回溯）。
    - **清单漏了**：守卫检查 `packages/{shared-schema,sync-core}`，却**没有** `packages/domain`
      与 `tsconfig.base.json` —— 正是第 75 条里真正让构建失败的两个文件。
      也就是说旧守卫会**放过**真正破坏构建的改动，却拦住别的一切。

    📌 推论：**守卫的输入清单必须和 Dockerfile 的 `COPY` 清单同源**，
    否则它会稳定地守错方向。改 Dockerfile 时请同时改 `deploy.sh` 里那四份清单。

 77. 🔴 **`instanceof ArrayBuffer` 在 jsdom 测试里是假阴性 —— 8 条测试一起红，报错却在说"字段缺失"。**

     写二进制转换代码（`packages/app-host` 的导出/还原、`apps/web` 的通行密钥）时，
     自然会写 `if (value instanceof ArrayBuffer)`。真浏览器里没问题，**vitest 的 jsdom 环境里必错**：

     - `new TextEncoder().encode('x').buffer` 是 **Node realm** 的 `ArrayBuffer`；
     - `instanceof` 右边是 **jsdom realm** 的 `ArrayBuffer` 构造函数；
     - 两者不是同一个对象 ⇒ **假阴性** ⇒ 代码判定"这个字段不是二进制" ⇒ 报
       `registration credential missing rawId/clientDataJSON/attestationObject`。

     🔴 **最危险的是错误信息指错了方向**：它说"字段缺失"，而字段明明在。
     你会先去改测试数据，而不是改判定方式 —— 实测就是这样绕了一圈（改数据没用，数据是对的）。

     正确写法（都基于**内部槽**，与 realm 无关）：

     ```ts
     function isArrayBuffer(v: unknown): v is ArrayBuffer {
       return Object.prototype.toString.call(v) === '[object ArrayBuffer]';
     }
     if (ArrayBuffer.isView(v)) { /* TypedArray / DataView，跨 realm 也安全 */ }
     ```

     📌 推论：凡是"跨 realm 可能成立"的类型判定，`instanceof` 一律不可信 ——
     包括 **iframe、WebView、worker**（真实产品里同样会踩，不只是测试环境）。

 78. ⚠️ **WebAuthn 的 `challenge` 传成字符串，有些实现不报错、只是验证永远失败。**

     服务端（SimpleWebAuthn 形状）下发的 `challenge` / `user.id` / `excludeCredentials[].id`
     都是 **base64url 字符串**，而 `navigator.credentials.create()` 要 **`ArrayBuffer`**；
     产出的凭据方向上，`clientDataJSON` / `attestationObject` / `signature` / `userHandle`
     又要**反过来**序列化成 base64url 字符串。

     - 在 **Chromium** 上原样传字符串会立刻
       `TypeError: Failed to execute 'create' on 'CredentialsContainer': Failed to read the 'publicKey' prope…`，算走运；
     - 但这个错误**不会在编译期出现**（options 在 app-host 里被刻意声明成 `Record<string, unknown>`，
       以便不引入 `@simplewebauthn`），所以只能靠**运行时**抓。

     📌 可复现的验收方式（本仓库已实测 13/13）：Playwright 开 CDP
     `WebAuthn.enable` + `WebAuthn.addVirtualAuthenticator`，然后在页面里
     `await import('/src/features/auth/passkey-browser.ts')`（Vite dev server 把 TS 编成 ESM；
     该模块只有 `import type`，运行时零依赖）。
     **关键断言不是"调用成功"，而是把产出的 `clientDataJSON` 解出来、`challenge` 必须原样回显** ——
     长度对但内容错也会被它抓住。

 79. 🔴 **`tccli` 在 import 时就无条件写日志 —— 被文件沙箱拒写后，连 `tccli --version` 都跑不了。**

     现象：任何 `tccli` 命令都报

     ```
     PermissionError: [Errno 1] Operation not permitted: '/Users/<you>/.tccli/log/tccli.log'
     ```

     这不是凭据问题，也不是 tccli 坏了。`tccli/log.py` 在**模块导入时**就建了一个
     `RotatingFileHandler`，路径硬编码 `expanduser('~/.tccli/log/tccli.log')`；
     **既没有 `TCCLI_LOG` 之类的环境变量，也没有 `--log-dir` 参数**可改（实测 grep 过整个包）。
     工作区写权限的沙箱只允许写工作区 ⇒ import 直接失败。

     做法：**换一个 `HOME`**（`log.py` 用 `expanduser`，所以 `HOME` 就是唯一的开关）：

     ```bash
     mkdir -p /tmp/tccli-home/.tccli/log
     ln -sf "$HOME/.tccli/default.credential" /tmp/tccli-home/.tccli/default.credential
     cp -f "$HOME/.tccli/default.configure" /tmp/tccli-home/.tccli/default.configure
     HOME=/tmp/tccli-home tccli dnspod DescribeDomainList
     ```

     🔴 **只改 `HOME` 会立刻换成另一个错**：`ModuleNotFoundError: No module named 'tccli'`。
     tccli 装在**原 HOME 的 user-site**（`~/.local/lib/python3.12/site-packages`），
     而 user-site 的搜索路径是从 `HOME` 推出来的 ⇒ 必须同时把 `PYTHONPATH` 指回真实站点目录：

     ```bash
     PYTHONPATH="$REAL_HOME/.local/lib/python3.12/site-packages" HOME=/tmp/tccli-home tccli ...
     ```

     凭据用**软链**（密钥只留一份在原处，不要复制到 `/tmp`）；`default.configure` 是非机密的端点表，复制即可。

 80. 🔴 **`.env` 里"只给一部分加引号"会让 `docker compose` 崩在 build 之前，而且看起来像别的问题。**

     `SMTP_FROM` 在代码里的默认值是 `'"SuperSync" <noreply@example.com>'` —— 这在 **JS 字符串里是对的**。
     照抄进 `.env` 就错了：

     ```ini
     SMTP_FROM="heyta" <noreply@finlaw.cloud>     # ❌
     ```

     compose 的 `.env` 解析器不是 dotenv，它更严，直接报

     ```
     failed to read …/.env: line 22: unexpected character "<" in variable name "<noreply@finlaw.cloud>"
     ```

     🔴 **误导性在于失败点**：这条报错出现在 `docker compose build` 的**最开头**，
     紧挨着的输出是"构建/迁移"，很容易被读成构建失败或镜像源问题，而真凶只是**一行 `.env`**。

     正确写法是**整体**加引号（解析出来的值就是 `heyta <noreply@finlaw.cloud>`，不含外层引号）：

     ```ini
     SMTP_FROM="heyta <noreply@finlaw.cloud>"     # ✅
     ```

     📌 自检一行：`docker compose -f docker-compose.yml [-f …] config | grep SMTP_FROM`。
     `config` **先解析 `.env`**，解析不了立刻报错 —— 比"build 到一半失败"早得多、也清楚得多。
     凡是改完 `.env` 就要 deploy，先跑 `config`。

 81. ⚠️ **腾讯云 SES 的 `SendStatus: 0` 只表示"腾讯云收下了"，不等于"送到了"。**

     排查"邮件到底有没有到"时，只看 `SendStatus`（0 = 处理成功）就下结论会**判错**。
     真正表示投递的是同一条记录里的 **`DeliverStatus`**：

     | 值 | 含义 |
     |---|---|
     | 0 | 被腾讯云接受，**进入发送队列**（还没送出去） |
     | 1 | **递送成功**，`DeliverTime` 是成功时间 |
     | 2 | 邮件被丢弃，原因在 `DeliverMessage` |
     | 3 | **收件方 ESP 拒信**，常见原因是地址不存在 |
     | 8 | 被 ESP 延迟递送，原因在 `DeliverMessage` |

     实测踩到的样子：`SendStatus: 0` 但 `DeliverStatus: 3`，
     `DeliverMessage: dial tcp 121.4.24.238:25: connect: connection timed out` ——
     即**发件侧全对，是收件方那台机器的 25 端口对 SES 不可达**。
     差点被误判成"我们 SMTP 配错了"。

     查询：

     ```bash
     tccli ses GetSendEmailStatus --RequestDate 2026-09-27 --Offset 0 --Limit 20 --ToEmailAddress <addr>
     ```

     ⚠️ `--RequestDate` 是 **`date` 类型，只吃 `YYYY-MM-DD`**：传 epoch 或
     `2026-09-27T00:00:00+08:00` 都报 `参数 RequestDate 取值类型错误。参数类型应为 date`。

     📌 要证明"真的能投递"，**别用自己域名的地址自测** ——
     用带读取 API 的一次性邮箱（如 Guerrilla Mail）走完整旅程，
     才能把"腾讯云收下了"和"用户真的收到了"分开。

 82. 🔴 **`pnpm build` 会"成功"却不产出 `.d.ts` —— 又一个"绿但没产物"。**
     2026-09-27 实测：递归的 `pnpm build` 对 `@heyta/op-log` / `@heyta/ui` /
     `@heyta/app-host` 报了 `Build success`，但 `dist/` 里**只有 `.js`、没有 `index.d.ts`**。
     后果不是构建失败，而是**下游**的 `tsc -b` 报一族
     `TS7016: Could not find a declaration file for module '@heyta/xxx'` ——
     "上游说成功、下游说找不到"，而真正的原因埋在上游的**缺失产物**里，
     很容易被误读成"下游配置坏了"。逐个补建即可恢复：

     ```bash
     pnpm --filter @heyta/op-log build
     ```

     自检（任何一次"干净构建"之后都该跑一遍）：

     ```bash
     for d in packages/*/; do p=$(basename "$d"); \
       [ -f "$d/package.json" ] && [ -d "$d/dist" ] && [ ! -f "$d/dist/index.d.ts" ] \
       && echo "缺 d.ts: $p"; done
     ```

     📌 这与"用干净 worktree 构建"是**两件不同的事**：
     干净是**必要**条件，不是充分条件。干净了还要确认产物真的齐 ——
     这条坑恰恰是在"我已经很小心了"的时候踩到的。

 83. 🔴 **别在主工作树里构建要发布的前端产物。**
     2026-09-27 我图省事直接在主工作树里 `vite build` + rsync，而当时
     `packages/app-host/src/*`、`packages/domain/src/*`、`packages/sync-core/src/*`
     都带着**并行会话未提交**的改动，而 `apps/web` 直接消费它们 ——
     于是别人的半成品上了线（约 6 分钟，直到对方自己重新发布覆盖）。
     证据是可复核的：脏树产物 `index-CvRMfVI6.js` 与干净 HEAD 产物
     `index-DUTAmIT2.js` **hash 不同**，说明内容真的不同；线上最终那份与干净 HEAD
     构建 `cmp` 逐字节相同。

     📌 判据很便宜，发布前跑一下：

     ```bash
     git status --porcelain -- packages/ apps/web/
     ```

     非空就**不要**直接构建。完整做法见 `docs/runbooks/deployment.md` §3.7。
     ⚠️ 发布别人改到一半的同步/加密代码，可能是**上线即静默丢数据**，
     而责任看起来会落在最后部署的人头上。

 84. 🔴 **`200` 不代表拿到了你以为的那个东西 —— 验收必须看 `Content-Type` 和内容开头。**
     2026-09-27 我验收通行密钥找回，写的是"`/recover-passkey` 页面和 `recover-passkey.js`
     **线上实测都是 200**"，并据此判断"恢复这条路是通的"。**两个 200 都是真的，
     但那个 `.js` 返回的是落地页 HTML**（nginx 只代理了页面路径，没代理页面引用的脚本，
     于是 `/*.js` 掉进 `location /` 的 SPA 兜底 → `/var/www/heyta-landing/index.html`）。

     后果不是"少个功能"：丢了通行密钥的用户**收到邮件 → 点开链接 → 按钮不动 → 进不去**；
     同一条缺陷也打死了**魔法登录链接**（`/magic-login-confirm.js` 同样被吞）——
     也就是**主要的登录路径**。而它躲过了此前**所有**验收。

     📌 这一类的形状是**"看着正常、其实是另一个页面"**，只看状态码的门禁**结构上抓不到**。
     服务端渲染页面引用的每个资源，验收都要断言三件事：

     ```bash
     curl -s -o /tmp/a.js -w "%{http_code} %{content_type} %{size_download}\n" \
       https://<域名>/recover-passkey.js   # 还要 head -c 20 确认不是 <!doctype/<html
     ```

     📌 同一条纪律适用于任何"文件真的存在吗"的判断：**存在**、**200**、**内容正确**
     是三件不同的事（对照第 82 条：`pnpm build` 报成功但没产出 `.d.ts`）。

     ⚠️ 这份 nginx 配置**不在仓库里**，只在服务器上 —— 所以修复与完整说明写在
     `docs/runbooks/deployment.md` §3.3.1。改完必须 `nginx -t` 再 `reload`。

 85. 🔴 **两个门禁缺陷可以互相掩护 —— 门禁自己也需要能被验证的用例。**

     `research/tools/docs-link-check.mjs` 曾**同时**带着两个缺陷，共存了很久：

     - **(a)** `SECTION_REF_RE` 写的是 `(\d+(?:\.\d+)?)` —— **只认两级**章节号。
        `§3.3.1` 被截成 `§3.3`，剩下的 `.1。改完必须…` 再被当成"引用者声称的标题"，
       报出一条**假**的"标题对不上"。**编号和标题两个都是对的，是解析器错了。**
     - **(b)** 目标路径只按**引用文件所在目录**解析，解析不到就 `continue`。
        于是 `docs/plans/roadmap.md` 里写的 `docs/runbooks/deployment.md`
        （从仓库根起算）被解析成 `docs/plans/docs/…` → 不存在 → **静默跳过**。

     🔴 关键在于它们**互相掩护**：**(b) 把 (a) 会误报的那些引用全都跳过了**，
     所以谁也没报错。实测数字：修之前门禁报"检查 54 处跨文档章节引用"，
     修之后是 **244 处** —— **78% 的章节引用从来没被检查过**，而门禁一路绿灯。
     只修其中任何一个，另一个都会立刻把门禁变成一片误报（实测一屏，**没有一条是真的**）。

     📌 教训有两层，第二层更重要：

     1. **"解析不到"不能等于"检查通过"**。解析失败必须**报出来**。
        静默跳过给出的是**虚假的安心**，比报错糟得多。
     2. **门禁自己也要有能失败的用例**。这两个缺陷可以共存到天荒地老，
        因为**永远不会有任何测试变红**。所以现在这个检查器**每次运行都先跑自检**
        （`assertSelfTest()`），每条断言钉一个真踩过的形状；自检失败 ⇒ `exit 1`。

     📌 同一轮还顺带修了两个同类问题：正则尾巴 `([^\]\n]{0,24})` **贪心吞掉下一个引用**
     （`docs/plans/roadmap.md` 被匹配成 `ns/roadmap.md` —— 目标文件都认错了）；
     以及"标题比对"原本会把**散文**当标题（`§7 第 74 条`、`§6.1 更新入口`）——
     现在只有"这段文字**确实是目标文档里另一个章节的标题**"才报错，
     那才是这个检查本来要抓的东西（编号对、链接活、只有**意思**错了）。

77. 🔴 **`sed` 在 C locale 下遇到多字节序列会报 `illegal byte sequence` 并"中断整条管道"。**
    本轮在 8 个打包/取证脚本里踩了 27 处，形态都一样：

        sed: RE error: illegal byte sequence

    触发条件不是"文件是二进制"，而是**流里有非 ASCII 字节**——最常见的两个来源是
    **远端 PowerShell 的中文报错**、以及 **`git status` 里的中文文件名**。
    要命的地方在于它是**在管道中间炸的**：你看到的输出像是"命令没跑"或"输出为空"，
    于是很容易去怀疑上游命令。实测当时同一个 `ssh ... powershell` 明明跑成功了，
    只是 `| sed 's/^/  /'` 那一段死了。

    ✅ 修法：给行首加前缀一律用 `awk`（按字节处理，不挑 locale）：

        ... | awk '{print "  " $0}'          # 而不是 | sed 's/^/  /'

    若确实要用 `sed`，至少 `LC_ALL=C sed`。
    📌 一般化：**"给输出加前缀/缩进"这种纯格式化的活，不要用对 locale 敏感的工具。**
    把它当成与内容编码无关的操作。

78. 🔴 **远端 PowerShell 只回一句乱码「命令行太长」时，问题在 `-EncodedCommand` 的长度上限。**
    `-EncodedCommand` 收的是 **UTF-16LE + base64**，体积约为原脚本的 **2.7 倍字符**；
    一个 9KB 的 `.ps1` 编码后约 24K 字符，直接超限。
    远端返回的是 GBK 编码的中文错误，在 UTF-8 终端里显示成 `������̫����` ——
    **完全指不到真正的原因**，很容易误判成"脚本语法错"或"SSH 传参被截断"。

    ✅ 修法：**先 `scp` 过去，再用 `-File` 跑**：

        scp -q script.ps1 host:C:/src/script.ps1
        ssh host "powershell -NoProfile -ExecutionPolicy Bypass -File C:/src/script.ps1"

    📌 顺带一条：`-EncodedCommand` 仍适合**很短**的探针（十来行），
    那时它很省事；一旦脚本超过几行就换 `-File`。**长度不是风格问题，是硬上限。**

79. 🔴 **改了 `packages/i18n` 的词条表之后，必须先 `build` 才能跑测试 —— 否则报「词条不存在」。**
    `apps/web` 的 vitest 经 **`dist/`** 解析 `@heyta/i18n`（不是 `src/`），
    而 tsup 产物带 sourcemap ⇒ 报错栈**指向 `packages/i18n/src/...`**，
    于是症状是"我明明把词条加进去了、`check:ui-language` 也是绿的，测试却说它不存在"。
    实测：`dist/index.js` 停在 `00:42`、源码改在 `01:07` ⇒ 一条键都读不到。
    ✅ 修法：`pnpm --filter @heyta/i18n build`（几秒）。
    📌 **判据**：`check:ui-language` 扫的是**源码**，**它绿不代表运行时有那条键** ——
    这两件事必须分别验证，别用一个的绿去推另一个。

    ⚠️ **同一根因的第二种面目（2026-09-30 实测，比"键不存在"更难读）**：
    `apps/landing` 的 vitest 同样经 `dist/` 解析 `@heyta/i18n`。改了页脚词条、
    没重跑 build，公页文案门禁就报**旧句子**违规 ——
    报错上下文里印着 `THIRD_PARTY_LICENSES.md`，而源码那份**已经改成别的了**。
    症状因此从"键不存在"变成**"我刚修的文案它还在报红"**，
    最自然的误判是"门禁写错了 / 改动没生效"，于是人去改门禁或再改一遍文案。
    📌 **判据**：门禁报红时，先核**报错上下文里的那句在源码里还存在吗**。
    不存在 ⇒ 不是判据错，是**产物陈旧**；`pnpm --filter @heyta/i18n build` 后重跑。

80. 🔴 **`am start -n $PKG/.MainActivity` 在 `applicationId ≠ namespace` 时会静默失败。**
    `apps/mobile/android/app/build.gradle` 是 `applicationId "com.heyta"` +
    `namespace "com.heytamobile"` ⇒ 真实组件名是 `com.heyta/com.heytamobile.MainActivity`，
    而 `$PKG/.MainActivity` 会被解析成**不存在的** `com.heyta.MainActivity`。
    `am start` 失败、输出又被 `>/dev/null` 吞掉，**前台就留在改名前的旧包
    `com.heytamobile` 上** —— 那个包长得一模一样，于是症状是
    "应用没起来 / 找不到新建按钮"，而它其实一直开着。
    ✅ 修法：用 `cmd package resolve-activity --brief <pkg>` 解析出真组件名再 `am start`
    （已落成 `scripts/lib/mobile-e2e.sh` 的 `launch_app()`）。**别再写 `$PKG/.MainActivity`。**

81. 🔴 **RNW 的 CLI 命令"不存在"时，先查 `pwsh.exe` —— RN CLI 会静默丢弃抛异常的依赖。**
    `react-native-windows@0.84.0` 的 `@react-native-windows/find-dotnet-tools`
    **硬依赖 `pwsh.exe`**（PowerShell 7，不是 Windows 自带的 `powershell.exe`）。
    它在 `require` 阶段抛 `Unable to find pwsh.exe`，而 **RN CLI 把抛异常的依赖
    直接丢掉、不报错** —— 于是 `npx react-native init-windows` 得到的是
    `error: unknown command 'init-windows'`：**像"命令改名了"，其实是依赖没加载**。
    判据：`npx react-native config` 里**根本没有** `react-native-windows` 这一节。
    ✅ 修法：装 PowerShell 7（`winget install Microsoft.PowerShell`），之后
    `init-windows` 立刻成功（实测 exit 0 / 12394ms）。
    📌 **通用形状**：报"命令不存在"时，先怀疑**依赖被静默丢弃**，别先怀疑改名。

82. 🔴 **`aka.ms/<短链>` 不存在时会回退到 Bing 搜索页，而那是 `HTTP 200`。**
    实测：`curl -L https://aka.ms/vs/18/release/vs_BuildTools.exe` → `HTTP 200`，
    但**最终 URL 是 `https://www.bing.com/?ref=aka&shorturl=...`**，内容是 HTML
    （看头两个字节：是 `<!` 而不是 `MZ`）。⇒ **只看状态码会把"短链不存在"
    误判成"安装器存在"**，然后在远端拿到一个 15 KB 的 HTML 当 exe 去执行，
    报 `EXITCODE=9020 / 系统无法执行指定的程序`。
    ✅ 判据（两条都要）：`curl -sL -w '%{url_effective}'` 看**最终 URL 含不含 bing**，
    **且**读头两个字节是不是 `MZ`。对照：VS 2022 的 `aka.ms/vs/17/release/vs_BuildTools.exe`
    是真 exe（4,478,032 B / `MZ`）；VS 2026 的真短链是 **`aka.ms/vs/stable/vs_BuildTools.exe`**
    （5,695,056 B / `MZ`）—— 官方下载页把它藏在 `data-downloads` 的 JSON 里，**不在 `vs/18/`**。

---

### 🔴 同名的可执行文件**能力不同** —— 用错那个会得出**反向结论**

本机同时存在两个 `idb`：

| 路径 | 有无 `ui set-value` |
|---|---|
| `~/.local/bin/idb` | **没有**（老版本；`usage: idb ui {describe-all,describe-point,tap,button,text,key,key-sequence,swipe}`） |
| `~/.heyta-tools/idb/venv/bin/idb` | **有**（带 `--value` / `--match-key`），脚本用的就是它 |

实测（2026-09-29）：手工排查时用了前者，于是**每一条 AX 查询都返回 `found: False`** ——
连截图里明明可见的「任务」都一样；据此得出两条**反向**结论
（"树读不到"、"这台机器上没有 `set-value`"），并据此排查了两轮。

**规避**：手工复现一律用脚本自己解析出来的那个 —— `scripts/lib/mobile-e2e.sh` 的 `resolve_idb()`
（它认 `~/.heyta-tools/idb/venv/bin/idb` 与 `/tmp/idb/venv/bin/idb`）。
推而广之：**凡是"工具说没有/读不到"，先确认你用的是不是项目用的那一个**。

### 🔴 `find … -newer /dev/null` **恒假** —— 拿它当"全都要"会做出一个**永远绿的判据**

`/dev/null` 是**设备文件**，它的 mtime 是**当下**（实测 `stat -f '%m' /dev/null` 就是刚才那一刻）。
所以 `-newer /dev/null` **一个文件都匹配不到**：

```bash
find src -name '*.ts' -newer /dev/null | wc -l     # → 0
find src -name '*.ts'                | wc -l       # → 282
```

⚠️ 与之**叠加**的第二个错（本轮同时踩到）：`… | xargs stat -f '%m'` —— `xargs` 默认按**空白**切分，
而本仓库路径含空格（`All in one Data/01_PROJECTS/heyta`），于是 `stat` 收到不存在的路径、
错误被 `2>/dev/null` 吞掉、**输出 0 行**。

两者叠加 ⇒ `SRC_MTIME=0` ⇒ `BUNDLE_MTIME >= 0` **恒真** ——
一个"新鲜度判据"看起来在工作，其实什么都没判（同类教训见 §7「恒真」那两条）。

**规避**：`-print0` + `xargs -0`；不要用 `-newer /dev/null`；
**判据算不出输入时必须红**（`if [ "${X:-0}" -le 0 ]; then bad "判据没在运行，不是通过"`）。

### 🔴 **正在运行的 shell 脚本不能改** —— bash 是**增量读文件**的

实测（2026-09-29）：在 `verify-mobile-ios.sh` **运行期间**编辑它，bash 读到被改过的**中间态**，
在 `line 988: syntax error near unexpected token ')'` 崩掉 —— 而**文件本身 `bash -n` 是通过的**。
症状是"脚本突然语法错误了"，而真因是**边跑边改**。

**规避**：等后台任务结束再改；要迭代就先 `pkill -f <脚本名>`，确认没有残留进程。
⚠️ 这条与 §7 那些"工具返回成功不等于生效"同形：**`bash -n` 通过 ≠ 跑起来的那份没被改过。**

### 🔴 iOS 的「保存密码？」**系统弹窗**会让 AX 树只剩 `AXApplication`

在 iOS 模拟器上往 `secure` 输入框（密码/口令）里填过字之后，系统会弹：

```
保存密码？
安全储存密码，以便下次需要时自动填充。
[以后]  [保存]
```

它有两个后果，**都不会在日志里留下任何痕迹**：

1. 它**盖住整个页面** —— 包括下面还没填的字段，而 `idb ui set-value` 是**按坐标**写的，
   于是报 `The axbridge backend found no element at (201.0, 1018.0); the point is empty`
   （看起来像"字段在屏幕外"）；
2. 它让 `idb ui describe-all` **只剩 `AXApplication` 一个节点** ——
   所有查询都 `found: False`，看起来像"AX 桥断了"或"页面没渲染"。

⚠️ 而且它是**系统**对话框 ⇒ **不在应用的无障碍树里**（按应用的标签找不到），
并且**跨应用重启存活** ⇒ 上一轮留下的弹窗会**污染下一轮**，
症状是"同一份代码时红时绿"。

实测（2026-09-29）：这一条同时解释了追了很久的三件事 —— **字段够不到、树偶尔全空、
以及它为什么时红时绿**。最后是**截图**看出来的：日志和 AX 树里都没有它的影子。

**规避**：填过 `secure` 字段之后、以及**每次冷启动之后**，都按标签点一次「以后」：

```bash
for l in 以后 "Not Now" Later; do
  [ "$(ax "$l" --pressable --list --json | jq -r .found)" = True ] && ax "$l" --pressable --press --json && break
done
```
（`scripts/verify-mobile-ios.sh` 的 `dismiss_ios_save_password()` 就是这个。）

**教训**：**AX 树全空不等于界面没渲染** —— 先截图看一眼，再怀疑桥。

### 🔴 变量名的批量替换**必须带词边界** —— 它会命中共享前缀的更长变量名

实测（2026-09-29）：为修 `$VAR` 紧跟中文那个坑，我写了一句全量替换：

```python
s = s.replace('$' + name, '${' + name + '}')      # ❌ 会命中 $y2、$yy、${FW}x
```

它造成的后果（**`bash -n` 全部通过**，因为语法是合法的）：

| 原意 | 被改成 | 症状 |
|---|---|---|
| `$y2` | `${y}2` | 读到变量 `y`，后面粘一个字面 `2` —— 判据静默判错 |
| `${FW}x${FH}`（宽 × 高，`56x56`） | `${FWx}${FH}` | `FWx: unbound variable`，脚本在第 1 步就崩 |
| `${UDID}_companion` | `${UDID_companion}` | 路径错 |

**正确写法**：`re.sub(r'\$' + name + r'(?![A-Za-z0-9_])', ...)`，
**或者更稳**：别批量改 —— 先 `grep -n` 出每一处，**逐处看 diff**。

⚠️ **`bash -n` 通过 ≠ 改对了**：`${FWx}` 是**未定义变量**，语法上完全合法，
只在**运行时**炸（`set -u` 下）。**批量替换之后必须逐处审 diff，不能只看语法。**

---

### 🔴 用 `tar` 打包工作树会把 `.env` 一起带上服务器，**覆盖生产配置**

**症状**：部署完之后服务端容器起来了，但 `docker compose` 报
`container supersync-postgres is unhealthy`，postgres 日志里刷
`FATAL: role "supersync" does not exist` —— 而**数据库本身是好的**
（用正确的角色仍能查到全部数据）。

**根因**：`server/.env` 是 **gitignored 的本机开发配置**（`POSTGRES_USER=supersync`、
没有 `NODE_ENV` / `SMTP_*`、另一套 `JWT_SECRET`、多几个 `WX_*`）。
`deploy.sh` 的文档流程用

```bash
git archive --format=tar.gz -o /tmp/heyta-server-src.tar.gz HEAD <paths>
```

**`git archive` 只打包已跟踪文件 ⇒ `.env` 天然不在里面**，服务器上那份被保留下来。
而换成对**工作树**打 `tar czf`（为了带上未提交的改动）会**把 `.env` 一起打包**，
解包时就地覆盖了生产 `.env`。

后果里最阴的一条不是 postgres 起不来 —— 而是 **`JWT_SECRET` 被换掉**：
所有已签发的令牌、以及正在途中的邮箱验证 / 魔法登录链接**全部失效**，
而且在容器重启之前**一声不响**。

**正确做法**：按 git 的口径列文件，而不是按目录打树。

```bash
git ls-files -co --exclude-standard -- \
  pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json \
  packages/sync-core packages/shared-schema packages/domain server \
  | tar czf /tmp/heyta-server-src.tar.gz -T -
```

`--exclude-standard` 会排掉 `.gitignore` 里的一切（`.env`、`node_modules/`、`dist/`），
`-co` 的 `o` 保证**未跟踪但未忽略**的新文件（这次新增的 `server/src/admin/*`）仍然进包。

**验收**：解包后**先核对再重启** ——

```bash
tar tzf /tmp/heyta-server-src.tar.gz | grep -E '(^|/)\.env$' && echo '🔴 包里带了 .env，别用！'
```

**兜底**：改 `.env` 之前永远先 `cp .env .env.bak-$(date -u +%Y%m%dT%H%M%SZ)` ——
这次能几分钟内恢复，靠的就是那个备份。

### 🔴 e2e 套件**不能与自己并发**：固定端口 + 共享 `e2e/test-results/` ⇒ 每次红的是不同 spec

e2e 的 webServer 端口是**写死的**（4317-4319），而所有运行共用同一个 `e2e/test-results/`。
两个运行叠在一起时，后起的那个会**清掉前一个的 trace 产物**，前一个会把后一个的 dev server
顶掉 —— 于是两边的失败**都指向不相干的代码**。

2026-09-30 实测（**同一份代码、同一个小时**）：

| 时刻 | 怎么跑的 | 报什么 |
|---|---|---|
| 11:16 | `pnpm check:ai-e2e` 单独跑 | **整组 exit 0**（含 `motivation.spec.ts` 7 条） |
| 11:39 | 全链 `pnpm check`（另一条会话同时在跑 e2e） | `tests/ai-duration.spec.ts` ⇒ `connect ECONNREFUSED 127.0.0.1:4319` / `ERR_CONNECTION_REFUSED at http://127.0.0.1:4318/` |
| 11:44 | `pnpm check:ai-e2e` 单独重跑（仍有并发） | **换了一条 spec**：`tests/admin-console.spec.ts` 两条 `toBeVisible` 失败 + 60s 超时 + `ENOENT … e2e/test-results/.playwright-artifacts-4/….trace` |

**判据**：结构性门禁红了，**先单独重跑那一步再归因**。同一份代码在两次运行里红在**不同的**
spec，且报错里出现 `ECONNREFUSED <本机端口>` 或 `.playwright-artifacts-*` 的 `ENOENT`
⇒ 是并发把对方的产物/服务清掉了，**不是被测代码坏了**（§7 元规则一：先怀疑探针）。

⚠️ 正解是**每次运行用独立端口与独立 `outputDir`**（或把 e2e 串行化）。本轮**没做**：
`e2e/playwright.*.config.ts` 此刻正被另一条会话改，动它会撞车。
登记在这里，是为了下一个人不必再花一次"红两轮才知道"的时间。

### 🔴 负向断言数的是**类名**而不是内容 ⇒ 改名那一刻起，它**永远绿**

`apps/landing/tests/render.spec.tsx` 里曾有一条"公页不许出现内部证据块"的负断言，
实现是**数 `.lp-evidence` 这个 CSS 类出现了几次**（2026-09-29 立那条纪律时补的）。
后来自建区改版用的是 `.lp-note--warn` 与 `.lp-term__line` —— **类名换了，
同一条规则一个字都没拦住，还连着四轮全绿**。
也就是说：**仓库里一直有一条"防开发语域上落地页"的门禁，
而它已经连续四轮什么都没防。**

这与元规则二同形（"一条永远通过的判据比没有判据更糟"），但它的**成因**值得单独记：
写断言的人当时是**对着那一版的 DOM 写的**，不是对着"要防的东西"写的。
内容断言（渲染出的**文本**与**无障碍名**里不许出现 `pnpm` / `Prisma` / `scripts/*.sh`）
不随重构失效，类名断言**必然**随重构失效。

✅ 现在这条判据换成 `apps/landing/tests/public-copy-register.spec.tsx`：
遍历 `SITE_PAGES` 全部页面 × 全部语言，断言**渲染后的文本**，
并且自带三条自查（扫不到页面就红、内置违规样本必须被抓到、内置正当文案必须不被抓到）。

### 🔴 组件文件头**复述 runbook 并给出保留理由** ⇒ 下一任读者把它当成产品决策

这是"为什么开发性语言**总是**回到落地页"的真答案，不是"有人不小心"。

`apps/landing/src/components/SelfHost.tsx` 的旧文件头把部署手册里那段
（Prisma 会把迁移包进事务、所以必须显式跑 `scripts/migrate-deploy.sh`）**抄成了自己的说明**，
后面还跟了一句"这段值得摆在页面上，因为它诚实"。于是那段的**理由**与**内容**一起
进了组件文件，而**组件文件是下一个改这一节的人必读的东西** ——
他读到的是"前人已论证过该保留"，不是"前人把运维笔记放错了地方"。

**判据**：公页组件的文件头只许写**这一屏为什么存在**；
一旦它开始解释"服务端/构建/迁移的机制"，它就在替 runbook 说话，
而 runbook 会随构建变、这一屏不会 —— 两边必然漂移。
留不留一段内容的判据是**"用户下一步是什么"**：
答案是"打开终端"的，留在指南里；答案是"在界面里点哪里"的，才上这一屏。

### 🔴 同树任何会话**写文件**都会打断在飞的 e2e —— 症状是"整块界面没了"，不是"测试失败"

2026-09-30 实测（过程账与完整取证在 [`docs/plans/admin-console.md`](../plans/admin-console.md) §7.4）：
`admin-console.spec.ts` 概览用例首次失败、重试 17s 通过。取证链全在 `trace.zip` 里，**顺序即证据**：

1. `.ht-header__title = 设置` 断言**通过** ⇒ 设置浮层确实打开了。
2. 紧接着涌进**约 90 条 `[vite] hot updated`**，其中 `/src/App.tsx` 出现 **8 次**，
   还有 `AdminPanel.tsx`、`AccountMenu.tsx`、`packages/i18n/dist/*`。
3. 多条 `Could not Fast Refresh … invalidate` —— 组件不兼容 Fast Refresh 时 vite 会**整页 reload**。
4. reload 把 SPA 状态清回初始视图 ⇒ 之后 `admin-panel` 的等待全部超时，
   失败帧的 DOM 与截图都显示**页面在任务视图**（= "设置页根本没实现"的样子）。

⚠️ **这与上一条"e2e 套件不能与自己并发"是两个机制，不要用同一条解释两边**：
那条要**两次 e2e 运行**抢固定端口与共享 `e2e/test-results/`；
这条**一次运行就够** —— 另一个人在编辑代码就够了，
甚至别人跑一次 `pnpm --filter @heyta/i18n build` 往 `dist/` 落盘也算。
理由很朴素：**dev server 服务的是当前工作树**，它没有"这次运行属于谁"的概念。

**判据**：遇到 e2e 随机红，**先在 trace 里找 `[vite] hot updated`**。
有 ⇒ 是被打断，既不是产品坏了也不是判据太弱，重跑即可；没有再走正常排查。
🔴 不要为了让它变绿去动断言 —— 那条断言精确抓到了"界面不在了"，**它是对的**。

📌 **一般规律**：**共享工作树是 e2e 的一条运行时依赖**，而它不受测试自己控制。
"重验证串行跑"只排开了自己这条链，排不开别人往树里写。

**正解：已拍板要做，但门槛是"这次改造必须能被验证"**（2026-09-30 产品负责人裁决）。
两条候选均**未实测**，实施时二选一或组合：让 e2e 跑在**快照**上而不是工作树
（`vite build` + `preview`），或关掉 dev server 的文件监听（vite `server.watch`）；
另外固定端口 / 共享 `outputDir` 也要一起改成按运行分配 —— 那治的是**上一条**（并发运行），
对这条无效，两边不要混为一谈。

改造的验收判据（缺一条就别合）：

1. 先复现假红：一次 e2e 跑到一半时往工作树写一个不兼容 Fast Refresh 的改动，
   旧载体**必须红**（否则你根本不知道自己在修什么）。
2. 同一手法在新载体上**必须绿**。
3. 与另一条会话同时在跑 e2e，两边都不得报 `ECONNREFUSED <本机端口>`
   或 `.playwright-artifacts-*` 的 `ENOENT`（上一条的判据）。

前置条件：`git status` 里 `e2e/` 无脏文件（当前 2026-09-30 满足）、宿主 shell 可用、
且严格按"重验证串行跑"执行。⚠️ **本轮三条判据一条都建立不了**：`spawn EBADF` 让
**任何一次 e2e 都跑不出去**（判据 1、2 需要先有基线，3 需要先有两次运行）——
没有验证载体的改造不合。这正是"能验证时再做"的含义，不是拖延。

86. 🔴 **一条判据里可以同时藏两个缺陷：数错了主题、数错了文件。两轮"安装包假红"，
    产品两次都是好的。**

    `reinstall:all` 的 mac 段连着两次判红，而**装上的东西是对的**：

    | 轮次 | 现场 | 旧判据 | 真相 |
    |---|---|---|---|
    | 22:03 | 窗口截图 262897 B，人眼看 = 真共享 UI（**深色主题**） | `#2563EB` 命中 **0** ⇒ 🔴 | 深色下 `--ht-color-primary` 是 `--ht-blue-400` `#60A5FA`，同一张图命中 **78** |
    | 22:24 | 同一秒两份产物：窗口 48615 B / `colorSpan` **62** / 主蓝 **0**（人眼看 = **空暗窗口 + 三个交通灯**）；`.webview.png` 286735 B / 主蓝 **79**（人眼看 = 真共享 UI） | 仍 🔴 | **窗口截图本来就不该用来判"UI 画出来没有"** |

    🔴 第二层的根因**早就写在被测对象的代码里**：`HeytaMacApp.swift` 的 `captureAndExit`
    注释明说「**WebView 的内容没合成进窗口**是这台机器上的**常态**」，并规定两份产物各证一件事——
    窗口截图证"有一个真的 macOS 窗口"，`OUT.webview.png`（`takeSnapshot`，不走窗口服务器）
    证"那份共享 UI 真的渲染出来了"。判据把主蓝压在窗口截图上，等于**拿壳自己声明为不可靠的
    那一路去验 UI**。而第一轮之所以"看起来是主题问题"，只是因为那次恰好合成了。

    三层一起修（缺一层就还剩一个假红/假绿）：

    1. `png-stats.mjs`：`HEYTA_BLUE_DARK = [96,165,250]` + `countBrandBlue()`（两套主题**相加**）。
       阈值 20 不动 —— 错误屏两个值都是 0。
    2. `reinstall-all.sh` 的 `shot_ok <窗口 png> [webView png]`：非空白/透明仍数窗口，
       **主蓝数 WebView 快照**；`package-app.sh` ④ 段同改。
    3. `shot_ok_logged`：原来调用写作 `shot_ok … | grep -q "✅"`，**判据数字被整个吞掉** ——
       四端全绿的日志里一个命中数都查不到，红了也说不清为什么红。

    变异验证（拿真实证据跑，不是构造）：错误屏窗口 0 ⇒ 🔴、深色真界面快照 79 ⇒ ✅、
    android 9279 ⇒ ✅、ios 9450 ⇒ ✅。

    📌 **可迁移的两条**：① **判据的输入文件本身是一个假设** —— 载体被生产者标注"不可靠"
    时，压在它上面的判据不是在验证产品，是在验证那条不可靠的路径；② **`grep -q` 吞输出**
    是验收脚本的通用失效形态：**绿的运行也要留得下数字**，否则下一轮无从对照。

    ⚠️ **顺带证伪了一句注释**：mac 段写着"清 WebKit 存储 ⇒ 重装 = 首次运行态"。实测只清了
    localStorage，**任务数据在壳的 SQLite 里**，装起来的截图里是另一条会话的探针任务
    （`B-mac-shell-…` / `B-mac-shot-…` / `B-mac-final-…`）。所以"全新安装"目前**只对视图成立，
    不对数据成立** —— 要真首次运行态得连库文件一起清。

87. 🔴 **`pnpm check` 的 e2e 前置脚本会 `SIGKILL` 别人正在用的 dev server —— 一条"看起来只读"的
    验收命令，在共享工作树上其实是有破坏性副作用的动作。**
    上面「e2e 套件不能与自己并发」那条说的是"顶掉"，实际情况更硬：**那是显式杀进程**。

    `scripts/check-ai-e2e-preflight.mjs:83` 就是 `process.kill(Number(pid), 'SIGKILL')`，
    对象是 `lsof` 查到的**任意**占 4318/4319 的进程 —— 它不区分"这个端口上的东西是谁起的、
    是不是我这条链的"。2026-09-30 22:48 实测，两个方向都打到了：

    | 时刻 | 事件 | 证据 |
    |---|---|---|
    | 22:48 | 我的 `check:ai-e2e` **杀掉了对方的 vite** | 我的日志：`⚠️  端口 4318 被占用：pid 39558（node）—— 清掉`；对方日志：`Command was killed with SIGKILL … vite --host 127.0.0.1 --port 4318 --strictPort` |
    | ~35s 后 | **我的 vite 在套件跑过半时消失** | 第 40 段 `57 failed / 2 skipped / 6 passed`，失败信息全是 `net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4318/` |
    | 22:55 | 端口空了、**串行**重跑同一条链 | `check:ai-e2e` **63 passed / 2 skipped**、`check:landing-e2e` 6 passed、整链 `FULL_CHECK_EXIT=0` |

    ⚠️ **谁杀掉了我的 vite，我没抓到 pid** —— 只有"它消失了"这一条。
    这不影响结论（同一份代码、串行重跑就绿），但**别把它写成"已查明"**。

    **判据（比"红两轮再看"更早、更便宜）**：跑任何 e2e 段之前
    `lsof -ti tcp:4318 -sTCP:LISTEN`（landing 还要看 4320），**必须为空**；
    跑完在自己的日志里 `grep '被占用'` —— **那一行出现在你的日志里就是并发实锤**，
    不需要等"两次红在不同 spec"才反推。有那一行 ⇒ 这次的失败数**一个都不属于被测代码**。

    🔴 **"正解"目前只建了一半，别以为改端口号就能并发**：没有任何环境变量可读。
    `e2e/playwright.config.ts` 把 4318 写死在三处（`baseURL` `:53`、`vite … --port 4318 --strictPort` `:82`、
    `webServer.url` `:84`），landing 用的是自己那份 `const PORT = 4320`（`playwright.landing.config.ts:27`），
    而前置脚本只吃**位置参数**（`DEFAULT_PORTS = [4318, 4319]`，argv 覆盖）。
    ⇒ 端口是**每套配置各写各的常量 + 手工对齐的前置参数**，不是配置项：
    **给前置脚本传别的端口只清那个端口，套件仍然去抢它自己写死的那个。**
    同套件的两个并发运行**结构上无法共存**。脚本文件头自己写着"那种情况下的正确修法是让端口可配置"
    —— 那句是**待办**，不是现状。

    📌 **可迁移的一般规律**：**判断一个命令能不能在共享工作树上随手跑，看它有没有副作用，
    不看它名字叫不叫 `check`。** 名字里的"检查"不构成只读承诺 ——
    这条链里的"检查"会杀进程、会删共享 `outputDir`、会 `pkill` 同名可执行文件。

88. 🔴 **用 plumbing（`commit-tree` + `update-ref`）提交"半个文件"之后，真实 index 仍然指着
    提交前的旧 blob —— 这时别人一次普通的整索引提交会把你的内容整个撤回，而且不报任何冲突。**

    共享工作树里要提交一份"别人的改动也躺在里面"的文件时，只能走 plumbing：
    `git show HEAD:<f>` 拷到临时文件 → 只改自己那一段 → `git hash-object -w` →
    用 `GIT_INDEX_FILE=/tmp/idx-$$` 建临时索引 → `write-tree` → `commit-tree` →
    `update-ref refs/heads/main <新> <旧>`（**带旧值就是 CAS**，并发提交时它会失败而不是覆盖别人）。

    这一串都对，但它**只动了 ref，没动 `.git/index`**。实测症状（2026-10-01 00:21）：
    提交并推送成功后 `git status --porcelain` 对那两份文件报 **`MM`**，
    `git diff --cached` 显示"索引相对 HEAD 少了 160 行" —— 那正是我这轮刚提交的内容。
    🔴 此刻任何一次 `git commit -a` / 不带 pathspec 的 `git commit`（**别人很可能就这么提交**）
    都会把旧 blob 当成"当前内容"提交上去 ⇒ **一条已推送的 commit 会被下一条再普通不过的
    整索引提交静默抵消，一个冲突都不会报**。
    而 `git log` 看起来完全正常，所以这个回归不会在任何门禁里现形。

    ✅ 收尾动作是**必须的**，不是可选的：把真实索引里那几条刷成新 HEAD 的 blob ——

    ```
    git update-index --cacheinfo 100644,<blob>,BLOCKED.md --cacheinfo 100644,<blob2>,PROGRESS.md
    git status --porcelain -- BLOCKED.md PROGRESS.md   # 期望：M 消失 / 只剩 ` M <f>`
    git diff --cached --stat                            # 期望：空
    ```

    另外两处 plumbing 的漏项：它**不会跑 `.git/hooks/`**（本仓库的 post-commit 是 Qoder 的
    AI 改动登记，漏跑就是这条 commit 不进账），以及 `git hash-object -w` 产生的游离 blob
    在 gc 前无害、但**不要**指望它等于已提交。

    📌 **可迁移的一般规律**：**绕过高层命令就等于接管它的收尾责任。**
    `git commit` 之所以安全，是因为它在建完 commit 后**顺手把索引刷新到新 tree** ——
    plumbing 没有这一步。用 plumbing 之后必须自己核对"索引 vs HEAD"的差，
    否则你留下的是一个**只对下一次整索引提交有害**的状态，而受害的是别人。

89. 🔴 **把 `overflow-y: auto` 写在"有拖拽把手骑在右边缘外"的那一列上，会同时制造两个
    缺陷，而两个的症状都是"元素在那儿、几何也对、就是没反应"。**

    日历侧栏（`apps/web/src/features/calendar/CalendarSidebar.tsx`）内容比一屏高，
    第一版直接在列上写 `overflow-y: auto`。真浏览器（Playwright，1280×720）实测到两件事：

    1. **这一层永远不滚，滚的是整页。** 外壳 `.ht-app` 是 `min-height: 100dvh`
       **不是固定高** ⇒ grid 项被内容撑到 761px（比视口 720 还高），`overflow-y: auto`
       的滚动条件"内容高度 > 自身高度"从不成立。注释里那句"滚动条只出现在侧栏、
       主区不动"是**假的**，界面上看不出区别，只有 `boundingBox().height` 能看出来。
    2. **拖拽把手被裁掉一半，于是拖不动。** `.ht-resizer` 是 8px 命中带，
       `inset-inline-end: calc(var(--ht-space-2) * -0.5)` ⇒ **4px 骑在这一列 padding box 之外**。
       而 `overflow-y: auto` 会让浏览器把 `overflow-x` 从 `visible` 连带改成 `clip`
       （CSS 规范行为，不是 bug）⇒ 那半边命中区被裁掉。`elementFromPoint(把手几何中心)`
       实测返回的是 `NAV.ht-sidebar`，不是 `.ht-resizer` ——
       所以 `toHaveCount(1)`、`boundingBox()` 非空、`cursor: col-resize` **三条判据全绿**，
       而 `page.mouse.down()/move(+120)/up()` 之后列宽纹丝不动。

    ✅ 修法分三层，缺一层都会回到上面的症状：滚动挂到**里面那一层**
    （`.ht-calendar-side__body { min-block-size: 0; overflow-y: auto }`），
    **把手留在这层之外**；列自己改成**有界且钉住**
    （`position: sticky; inset-block-start: 0; max-block-size: 100dvh`）；
    ≤768px 断点把这三条**显式还原**（塌成底部导航时它不是一列）。

    判据钉在 `e2e/tests/calendar-sidebar.spec.ts`：列高 ≤ 视口、`body` 的
    `overflow-y === 'auto'`、**列本身 `overflow-y !== 'auto'`**、`elementFromPoint(中心)`
    命中 `.ht-resizer`、拖 120px 就宽 120px。**变异验证**：把 `overflow-y: auto`
    加回列上 ⇒ 恰好「滚动不许挂在列本身（会裁掉骑在边缘外的把手）」转红。

    📌 **可迁移的一般规律**：**"元素存在 + 有几何"证明不了"点得到它"。**
    裁剪、遮挡、`pointer-events` 三种情况在 `toHaveCount` / `boundingBox()` 上
    长得一模一样 —— 命中判据只能用 `document.elementFromPoint(x, y)`，
    拖拽判据只能用真 `mouse.down/move/up`。而 `overflow` 是**轴联动**的：
    任何一轴非 `visible` 就把另一轴从 `visible` 拉成 `clip`，
    所以"我只加了纵向滚动"这句话从不成立。

90. 🔴 **`git diff-tree -r --no-commit-id --name-only A B`（两个 commit 参数）比的是
    A 与 B 互相比，不是"各自与父提交"—— 拿它做"我的提交里有没有别人的文件"这道
    自查，会得到一次**空测量**，而空测量的输出和"检查通过"长得一模一样。**

    实测（2026-10-01 文档中心交付轮）：用它比 `544c9894 HEAD`，输出只有一行
    `PROGRESS.md`，于是打出 `OUT_OF_BOUNDS=none` 并当成了"57 个文件全在地界内"。
    🔴 那一行输出的是**两棵树之间的差**（上一轮别人改的 PROGRESS.md），样本里
    **根本不含**本轮主提交的 57 个文件 —— 结论是编的，命令却 exit 0。
    重量之后用 `git diff --name-only <开工前父提交> HEAD` 才量到真样本：
    `DELIVERY_FILE_COUNT=57  OUT_OF_BOUNDS=0`，结论没变，但第一次它是**被量出来的**。

    ✅ 修法：边界自查的**两个操作数必须写对**——"这一轮提交了什么"永远是
    `<本轮开工前的父提交>..<本轮最终 HEAD>`；想要"各自对父"就得跑两次
    单参数 `diff-tree <commit>`（它才默认对父）。收尾再加一道**样本量断言**：
    输出行数必须等于已知交付文件数（57），对不上就红 —— 空样本不许当通过。

    📌 **可迁移的一般规律**：**对账命令先证明自己量到了该量的样本，再谈结论。**
    "输出为空/很短"与"检查通过"是两件事；任何边界/差异类的自查，
    都要有一条"样本量 = 预期量"的断言兜底（同族：本轮同一天还踩过它的
    姊妹款——按 hunk 过滤共享文件时只比对增行，结果对方"改写自己 key 正文"
    的 hunk（有删有增）被误判成我的，暂存 blob 悄悄丢了 HEAD 里的旧值；
    判据改为**删行增行都匹配才算对方的**才闭环）。

91. 🔴 **一个未定义的 CSS 自定义属性会让**整条声明**失效，不是只让那一段失效 ——
    `grid-template-columns` 塌掉时整个应用外壳变成竖排单列，而所有门禁全绿。**

    在隔离检出（`git worktree add --detach HEAD`）里跑首启语言的真浏览器用例，
    截图出来的界面是：rail、sidebar、header、main **从上到下堆成一列**，
    每一块都占满 1280px。第一反应是"这个临时检出缺了构建产物"。
    实测（`getBoundingClientRect` + `getComputedStyle`）：

    ```
    .ht-app    display=grid  1280x1658      ← display:grid 生效了
    .ht-rail   1280x548                     ← 但列宽没生效
    --ht-layout-rail-width = 11rem           ← 变量本身解析得到
    ```

    真正的原因在 `.ht-app--with-sidebar` 那条 `grid-template-columns` 里：
    它除了 `--ht-layout-rail-width` 还吃 `--ht-layout-sidebar-min-width` /
    `--ht-layout-sidebar-max-width`（给 `clamp()` 当上下界），
    而**HEAD 的 `tokens.css` 里没有这两个** —— 它们此刻正躺在另一条会话
    未提交的 `packages/design-system/src/tokens.css` 改动里。
    `var()` 解析到未定义的自定义属性且**没有 fallback** ⇒ 该声明
    *invalid at computed-value time* ⇒ 整条 `grid-template-columns` 按 `unset`
    处理 ⇒ 网格退回单列。A/B 实测：把那两个变量补进临时检出，布局立刻恢复三列。

    ⚠️ **为什么没有任何一道门禁抓到**：`check:design` 查的是"组件里不许出现裸值"
    （方向相反），`check:tokens` 查的是"生成物与 `tokens.css` 同步"（不比消费），
    类型系统看不见 CSS 字符串里的 `var()`。**"引用了不存在的 token"这条缝，
    目前整个工具链是空的。**

    📌 **可迁移的规律**：`var()` 的失败单位是**整条声明**，不是那个值 ——
    所以症状会出现在**离缺陷很远**的地方（这里塌掉的是整个页面布局，
    而缺的是一个侧栏宽度上下界）。排查时先问"这条声明还在不在"
    （`getComputedStyle` 看它是不是 `unset`），再问"值对不对"。

92. 🔴 **给隔离检出 `ln -s` 一份 `node_modules`，会让所有"改 dist 再验会红"的注入探针静默失效。**

    `scripts/verify-i18n-failures.mjs` 有一组探针改的是 `packages/i18n/dist/**`
    （移动端测试解析的是编译产物）。把这套搬到干净检出里跑时，为了省事把
    主工作树的 `node_modules` 软链过去 ⇒ 第一次跑出 2 条"注入没让测试变红"，
    看起来像**门禁坏了**。实际是：探针改的是临时检出里的 dist，
    而 `require('@heyta/i18n')` 顺着软链解析到了**主工作树**那份 dist ——
    改的和测的不是同一个文件。改成在临时检出里真跑一次
    `pnpm install --frozen-lockfile --ignore-scripts` 之后，
    recurrence 组 10/10、全量 114/114 在两处一致。

    📌 **可迁移的规律**：任何"改产物再断言会红"的探针，前提是**解析路径落在
    被改的那份产物上**。软链、`pnpm` 的 workspace 链接、`exports` 指向 `src`
    而不是 `dist`，三种都能让它改到空气上 —— 而且失败表现是"探针没生效"，
    最容易被误读成"判据太松"。

### 🔴 模板字符串**里面**的注释含一个反引号 ⇒ 注释没写成，模板被截断，注释变成代码

2026-10-01 实测（`server/src/design-html.ts` 的表单 CSS 块）。注释写的是
"这一页的路径是 `/reset-password`"这类**用反引号包起来的文件名** —— 而整段 CSS
在一个模板字符串里，那个反引号是**字符串的结束符**，不是注释的一部分：

- 编译期**没有任何人报错**（它仍是合法的 JS：模板提前收尾，后面是一堆裸词）。
- 运行期 `renderPage` 抛 `ReferenceError: reset is not defined`，
  `/reset-password` 直接 500。
- 🔴 抓到它的**不是**任何一条"注释别写错"的判据，而是两条**读渲染出的 `<style>`**
  的断言（"每个色值出自 token 表""零渐变"）—— 因为模板被截断之后样式表整个没了。

📌 **一般规律**：注释是不是无害文本，由**它宿主的语法**决定，不是由 `//` 或 `/*` 决定。
在模板字符串、字符串字面量、以及"会被复制进别的宿主"的代码片段里写注释，
规则是**里面不许出现该宿主的定界符**（反引号、`${`、`*/`）。
同类形状还有下一条。

**正解**：那种注释里要指代标识符，用中文引号或直接裸写，不要用反引号；
并把这条规则**写在那段注释自己里面**（下一个人还会想引用一个文件名）。

### 🔴 块注释里写 `**/`（Markdown 加粗后紧跟斜杠）会提前闭合注释 —— 整份脚本从第一行坏掉

同一天，`/tmp/w3-commit.mjs` 的文件头注释写着"每条都问同一个问题：**把被保护的
那件事做错，**这条判据会不会红？" —— `**/` 里的 `*/` 就是 `/* */` 的结束符，
于是注释在后面那行"先跑一次未变异的基线"处变成**代码**，脚本连语法关都过不了。

📌 与上一条同族但**宿主不同**：这条的宿主是普通块注释，坏在**定界符本身**；
上条的宿主是模板字符串，坏在**字符串结束符**。共同点是：
**注释的内容可以改变代码的结构**，所以写注释时"加粗一个以斜杠结尾的词"是雷。

**正解**：块注释里要加粗，让加粗的右边界**不挨着**斜杠（改词、或把斜杠挪出加粗范围）。

### 🔴 读样式的断言**不剥注释** ⇒ 它匹配到的是解释而不是声明，于是变异验证"看起来不生效"

同一天，W4 的变异矩阵里有一条"删掉 `.input` 的 `width: 100%`"，
判据**没有转红** —— 第一反应是"这条判据是装饰"。实际是：那条判据用
`style.slice(indexOf('.input {'), indexOf('}'))` 取声明块，而**块里的注释正文
就写着 `width: 100%`**（我在解释为什么要加这条声明）。删掉声明，注释还在，
正则照样命中。

同一个选择器上 `[hidden]` 那条也差点踩到（注释里写着 `[hidden]{display:none}`），
只是它断言的是 `!important`，恰好注释里没有，才没在第一次就露馅。

📌 **这是"不能失败的判据比没判据更糟"的一个新面目**：判据本身逻辑正确，
但它读的文本里**混着对被测内容的描述**。假绿不来自断言写松了，
来自"解释"与"声明"在同一个字符流里长得一样。

**正解**：任何"从 CSS/HTML 源文本里断言结构"的判据，先剥注释再匹配
（`raw.replace(/\/\*[\s\S]*?\*\//g, '')`），并把这件事收进一个共用的取值函数
（本次是 `password-reset-page.spec.ts` 的 `styleOf()`），而不是每条判据各自记得剥。

**元判据**：变异验证报"没有转红"时，**先怀疑探针读到的是自己的注释**，
再怀疑判据是装饰 —— 两者的修法完全不同（前者补剥注释，后者要么删掉要么重写）。

93. 🔴 **手写解析器和写死的外部宿主形状，会让探针把自己的故障报告成被测对象的故障。**
    四种面目，症状分别是"永远红""以通过的方式绿""读不回来""端点不存在"。

    2026-10-01 给「账号语言 → 英文邮件」补线级判据（`server/tests/email-locale-wire.spec.ts`）
    和外发判据（`pnpm --filter @heyta/server test:integration:email-live`）时四个全踩到：

    1. **假红指向不存在的宿主**。第一次"读不回来"被记成了环境事实 ——
       「Ethereal 从这台机器不可达（`curl` 返回 000）」，写进了计划文档，据此判这条边界关不掉。
       真相：API 宿主是 **`api.nodemailer.com`**（`nodemailer/lib/nodemailer.js:15` 的默认值），
       `api.ethereal.email` 只是收件域，TLS 根本握不上 ⇒ 000 是**指错地址**。
       同一条 SMTP 通道 `smtp.ethereal.email:587` 当场收下了两封信。
    2. **假红来自线协议会折行**。nodemailer 把顶层 `Content-Type` 写成两行
       （`multipart/alternative;` 换行 + 缩进 + `boundary="…"`），不先 unfold 就取不到 boundary
       ⇒「两个 part 都在」这条永远红。另一个同款：`^content-type:\s*([^;\r\n]+)$` 带 `$`
       锚不住 `text/html; charset=utf-8` ⇒ 同一个假红。
    3. 🔴 **以通过的方式失效**（比假红贵一个数量级）。quoted-printable 的 `=E9\
       97\200` 解出来是**字节**，不重新按 UTF-8 读，中文看成两三个乱码字符 ⇒
       CJK 判据算出 0 ⇒「英文邮件里没有中文」在**实现根本没本地化**时也照样绿。
       修法只有一行：`Buffer.from(v,'binary').toString('utf8')`，
       但前提是想到"字节 ≠ 字符串"。
    4. **桩会被当成产品行为**。`server/tests/setup.ts` 全局 mock 了 `../src/db` 与 `../src/auth`，
       新那条线级用例真打的是 `requestLoginMagicLink` ⇒ 落件恒 0、断言"信发出去了"必红。
       加 `vi.mock('../src/auth', async (io) => ({ ...(await io()) }))` 把**真实现**装回去。
       反向的坑在同一批文档里：`server/package.json` 的 `test` 脚本是 `vitest run`（整个 `tests/`），
       `test:integration:postgres` 那份清单只是**子集** —— 只跑清单会把用例丢掉。
       而 `tests/integration/` 被默认 vitest 配置整段排除（这些用例需要真库、真外发），
       放进去=默认套件里真发信；放外面=默认套件根本不跑它 —— 这个二选一要在**放进目录之前**判。

    还有两条同族的"探针 vs 产品"：ESM 模块命名空间**只读** ⇒ 给 `nodemailer.getTestMessageUrl`
    赋值是静默 no-op（预 URL 列表永远空，看起来像"信没发出去"）；改抓 `Logger.info` 里的
    `Preview URL:` 才拿得到。而 `api.nodemailer.com` 上**没有**列消息/读消息那两个端点
    （`/v1/accounts/:user/messages`、`/v1/messages/:id` 全 404），正文只能从
    `https://ethereal.email/message/<id>` 那个预览页里读回来。

    📌 **可迁移的规律**：外部服务的宿主、端口、URL 形状、响应结构一律取**库里的常量**
    （或读它自己打印出来的日志），不要按域名的"看起来对"手写。
    任何新写的判据在宣布"被测对象有缺陷 / 这条验证本机做不了"之前，
    **先用一个已知正确的输入证明这条判据能给出正确结果** ——
    上面第 1 条那句假的环境结论，只需要"换个宿主再 curl 一次"就被推翻了，
    而它让这条边界多活了一轮。这是 §7 元规则 1（先怀疑探针）的具体作案手法。

94. 🔴 **macOS 的 `base64 -d` 不认 base64url 字母表，会**静默少解一个字节** —— 用它把 JWK 的
    `n` 转成备案要的十六进制模数，得到的是 **510 位而不是 512 位**，而它看起来仍是一条正常的长 hex 串。**

    2026-10-01 实测：苹果发布证书（RSA-2048）的模数，`openssl x509 -modulus` 给 512 个 hex 字符；
    同一条值走

    ```bash
    node -e '… publicKey.export({format:"jwk"}).n' | base64 -d | xxd -p   # ← 错
    ```

    只有 **510** 位。根因：Node 导出的 `n` 是 **base64url**（342 字符，含 `-` 与 `_`），
    BSD `base64 -d` 不接受这两个字符 —— 它不报错、不停下，只是**把那一刻之后的输入丢掉**
    （`| base64 -d | wc -c` = 255，正确应是 256）。同一条 `n` 用
    `Buffer.from(n, "base64url")` 解出来 256 字节、hex 与 openssl 逐字一致。

    **为什么这条比"少一位"更危险**：备案表单只校验"是不是十六进制串"，
    **不校验长度**；一个被截断的模数会照样提交成功，错误要到管局审核（数周后）才暴露 ——
    而那时没人会怀疑到管道里那个 `base64`。

    **正解**：编码转换在**同一个进程内**做完（`Buffer.from(s,"base64url").toString("hex")`），
    不要跨工具拼管道。非要用 shell 就 `tr '_-' '/+'` 再补 `=` 到 4 的倍数。

    📌 **可迁移的规律**：本仓库对备案值的纪律是"两套**独立实现**算同一个值并**比对**"
    （`icp-app-filing-values.mjs` 文件头写明了这条，起因是自写 PEM 切片把三张证书指纹全算错）。
    但"两个工具**串**成一条流水线"不是交叉验证，是**把错误率乘起来** ——
    交叉验证必须是**两条完整独立的路**各算一遍再比，任何一环跨工具传字节都要先量长度。
    所以新加的判据应当包含**位数断言**（512 / 40 / 32），位数是免费的强判据。

95. 🔴 **新镜像 + 旧 `.env` = 容器 crash-loop，而"部署命令退出码 0"照样打印。**
    启动硬要求（fail-closed）的键，**换镜像那一刻**就从"配置项"变成"部署前置条件"。

    2026-10-01 实测：ADR-0040 的口令后端把 `PASSWORD_PEPPER` 做成**启动硬要求**
    （`getPasswordPepper()` 对 <32 字符直接抛，`server/src/index.ts` 启动时跑
    `assertPasswordBackend()` 的字节级已知答案测试）。生产 `.env` 是**换镜像之前**那份，
    里面没有这个键 ⇒ 新容器起来就退 ⇒ `supersync-server` 进 `Restarting (1)`，
    而 `/health`、`/api/login/*`、`/api/register/*` 全部 **502**。

    三个让它特别难归因的性质：

    1. **不是"某个功能坏了"，是整台服务没起来** —— 症状覆盖所有端点，
       看起来像反代或网络问题，而 nginx 与证书都是好的。
    2. **fail-closed 是设计**（pepper 缺失时绝不能退回"没有 pepper 的哈希"），
       所以**没有**"降级启动"这条路可走；把它当 bug 去放松校验 = 取消这层防护。
    3. **compose 的重启策略会把失败藏进循环**，`docker compose up` 的退出码
       不反映"容器最终没活着"。

    ✅ 判据两条：`docker ps` 出现 `Up (healthy)` **且**启动日志里有
    `🔒 Password hashing backend verified (Argon2id, … ms per hash)`。
    第二条是**这条键真的加载了**的证据，`healthcheck` 只告诉你进程活着。
    完整修复动作与"为什么 pepper 一旦定了就不能换"写在
    [`deployment.md`](../runbooks/deployment.md) §3.5。

    📌 **可迁移的规律**：给服务端加**启动期硬校验**时，同时要说清
    **"生产 env 里这条键由谁、在什么时点写进去"**，并且把它登记进部署手册的
    **env 清单**（本仓库那份清单的对账判据就是 `grep -c '^[A-Z]' .env`）。
    否则代码合得越干净，下一次换镜像就越确定会把服务换死。

96. 🔴 **工作树绿 ≠ `HEAD` 绿 —— 有一种具体的作案手法：源码引用了一个未跟踪的文件。**
    `git status` 里它是 `??`，于是它**不进任何提交**，而构建与测试**全都在工作树上跑**，
    所以本地一切正常，干净检出（CI 的唯一形态）从 `pnpm -r build` 第一步就红。

    2026-10-01 实测的形状：`packages/app-host/src/index.ts` 里一行
    `export * from './legal-links.js'`，而 `legal-links.ts` 从来没被 `git add`。
    共享工作树里那个文件**存在** ⇒ 类型检查、构建、`pnpm check` 全绿；
    而任何从 `HEAD` 重建的产物（临时 worktree、CI、别人的机器）报
    `Cannot find module './legal-links.js'`。

    ⚠️ 同一轮还有一次**镜像形状**：为了验证一个结论，从 `git show HEAD:<f>` **重建**了
    一个 blob 去跑 —— 跑绿了，于是写下"HEAD 是好的"。但那次的"产物"是**手工拼出来的**，
    而真实提交物里的其他文件并不与它配套。**测试跑在工作树上**，所以
    "我验过的那份东西"和"仓库里的那份东西"是两件事，除非验证真的从一次干净检出开始。

    ✅ 判法固定两条，别靠推断：
    ```bash
    git status --porcelain | grep '^??'                 # 有没有被引用却没跟踪的文件
    git worktree add --detach /tmp/x HEAD && (cd /tmp/x && pnpm -r build) && git worktree remove /tmp/x
    ```
    第二条是**实测**而不是读代码推断（`git show HEAD:<line>` 只能证明那一行，不能证明整棵树）。

    📌 **共享工作树里这条更凶**：未跟踪文件往往是**另一条会话正在写的东西**，
    所以"它没被跟踪"可能只是"它还没轮到提交"。处置不是替别人 `git add`，
    而是**别让自己的提交引用它** —— 要么把那行 re-export 拿掉（本次的做法），
    要么等它落地。

97. 🔴 **探针会把一整条判据静默截掉，而它的输出看起来是"验过了"。**
    一次正则收紧顺手照出两件事：`Accept-Language` 在无头浏览器里根本不存在，
    以及"链接取全"本身需要一条断言。

    2026-10-01 给 `scripts/verify-email-web-chain.mjs` 加判据时：
    取邮件里那条链接的正则原本停在 `token=[0-9a-f]+`，**`&lang=en` 被丢掉**。
    后果不是"少打印一段"，而是**语言这一整腿从来没进过判据** —— 而脚本每轮都报绿。
    补上"链接必须带 `lang=` 且等于提交时的界面语言"之后，立刻红了一次，
    而红的原因有两层：

    1. **Playwright 的无头 Chromium 不发 `Accept-Language`**（同一次会话里
       `navigator.language` 却是 `en-US`）。⇒ 服务端渲染的页面拿不到任何语言线索，
       落到 `zh-CN` 兜底，而 SPA 自己是英文的 —— **"英文界面 + 中文确认页"**，
       长得极像本地化坏了。实测方式：起一个只回显请求头的本地服务，让无头页去访问，
       `accept-language` **零命中**。
    2. 新正则的字符类只排了 `"'` 和空白 ⇒ 预览页把链接放在转义过的 `href=\"…\"` 里，
       结尾那个反斜杠被**当成链接的一部分**抓回来（`lang=en\`），判据当场红。
       **红得对，但红的是探针** —— 修法是字符类再排 `\\`。

    📌 **三条可迁移的规律**：
    ① **"取字段"的正则要取到边界，不是取到看起来像结尾的地方** —— 截断的判据
    比没有判据更糟，因为它每轮都给出一个绿。
    ② 服务端解析语言时，**`Accept-Language` 在无头浏览器里可能整个不存在** ——
    所以"验证语言链路"必须显式带 `?lang=` 或 `body.locale`，不能指望环境头。
    ③ 客户端已经写了 `document.documentElement.lang` 这类**界面自己声明的语言**，
    跨端比对时读它比重新推导浏览器语言强（推导规则一旦有两份就会漂移）。

98. 🔴 **用带引号的键去 grep 不带引号的写法，会把"整种语言没做"当成实测结论 —— 九份文件齐刷刷报 0，
    而英文正文其实一条不缺。**

    2026-10-01 实测：产品负责人问国际化做完没有，我为了核法务文书有没有英文版，跑了
    `grep -c "'en'" packages/legal/src/documents/*.ts` ⇒ **九份全是 0**。
    据此答了一句"法务九份只有中文，约 1300 处"。**这句是错的，已经当面撤回。**

    真实形状是（`packages/legal/src/types.ts` + 任一文档）：

    ```ts
    readonly sections: Record<Locale, readonly LegalSection[]>;   // 类型要求两把都齐，少一把编译不过
    …
    const en = [ … ] as const;                                    // ← 键在这里根本不存在
    export const minors: LegalDocument = {
      title: { 'zh-CN': '未成年人保护', en: 'Protection of Minors' },   // ← 写的是 en:，不带引号
      sections: { 'zh-CN': zh, en },                               // ← 简写属性，没有 'en' 这个字面量
    };
    ```

    换成按真实语法形态切片后：九份**都有**独立的 `const en` 数组、
    `packages/legal/tests/structure.spec.ts` 的**中英逐条结构对账 56 条全过**、
    英文正文里只剩 **1 处**汉字 —— 隐私政策英文版里的主体名称「晓黎（杭州）人工智能科技有限公司」，
    那是**刻意保留**的（法律主体以登记文字为准）。

    🟥 **第二层坑在同一把探针里**：第一版切片右边界取了 `sections:`，
    于是把导出对象里 **zh 的 title/summary** 也算进了"英文正文"，虚报 **196 处汉字**。
    正确边界是数组自己的结尾 `\n] as const;`。同一份代码改边界后：**196 → 1**。

    📌 **一般规律**：
    ① **断言"某语言/某字段不存在"之前，先读类型定义和一份实例，看清"存在"长什么语法形状** ——
    `Record<K,V>` 的键可以写作 `k:`、`'k':`、也可以被简写属性完全吃掉字面量，
    三种写法里 grep 只认得前两种。
    ② **批量报同一个数（九份全 0）先怀疑探针**（元规则 1），不要先怀疑被测对象。
    ③ 切片类探针的**两个边界都要来自被切对象自己的语法**，不能一个是 `const en`、
    另一个顺手拿"下一节的开头" —— 那会把别人的内容算进来，而且**报出来的方向是"缺陷更多"**。

99. 🔴 **判断"线上是不是当前产物"：只看 sha 会假红，只看状态码会假绿 —— 两种都得换成交对判据。**

    同日实测 `heyta.waytofuture.cn`（`--resolve` 钉真实 IP + `--noproxy`，否则这台机器的代理会给出假 IP）：

    | 做法 | 读数 | 真相 |
    |---|---|---|
    | `shasum -a 256` 比线上首页与本地 `dist/index.html` | **不同**（`ff26f1fb…` vs `d62c26de…`） ⇒ 读成"线上是旧构建" | **假红**。两份大小都是 7022 字节；把 `main-<hash>.js` / `index-<hash>.css` 归一化成 `ASSET.js` 后**逐行 diff = 0 行** —— 内容一样，只是构建换了 hash 名 |
    | `curl -o /dev/null -w "%{http_code}" /legal/privacy/` | **200** ⇒ 读成"法务页已上线" | **假绿**。把返回体与 `/` 的字节做 `cmp`：**IDENTICAL** —— 服务器上没这个文件，nginx 的 `try_files … /index.html` 兜底把首页发了出去 |

    ✅ 两条判据要成对写：

    ```bash
    # ① 内容是不是当前构建：先归一化 asset hash，再逐行比
    norm(){ sed -E 's/(main|index|vendor)-[A-Za-z0-9_-]{6,}\.(js|css)/ASSET.\2/g' "$1"; }
    diff <(norm live.html) <(norm dist/index.html) | grep -c '^[<>]'      # 期望 0

    # ② 这个路径是不是兜底首页：与首页比字节
    cmp -s legal.html home.html && echo "NOT DEPLOYED（拿到的是兜底首页）" || echo "DEPLOYED"
    ```

    ⚠️ 静态站点用 catch-all 兜底（为了 SPA 的前端路由）时，**404 永远不会以 404 出现** ——
    缺失的页面返回 200 + 别的内容。所以"线上验收"里凡是走状态码的判据，
    都必须再问一句**"这份响应体是不是就是首页"**。

    📌 一般规律：**同一件事的两个失败方向要各配一条判据** —— 只有 hash 比对会误报过期，
    只有状态码会误报上线；这两条在本次是同一次取证里互相纠正的。

100. 🔴 **Playwright 的 `outputDir` 默认是共享的 `e2e/test-results/`，而每次运行开始会把整个目录
    删掉重建 —— 于是两条会话的验收互相销毁对方的证据，症状还包括"断言全过却判红"。**

    2026-10-01 实测（同一台开发机、同一个工作树里四条会话同时在写）：

    | 现象 | 真相 |
    |---|---|
    | 刚拍的 `live-legal-terms-zh.png` 下一次跑就没了 | 另一条套件的运行在**开始时**删了 `test-results/`。Playwright 清理的是 `outputDir`，而多条套件都用默认值 |
    | `ls test-results/` 只剩 `glass-*.png` 13 张 | 玻璃那条会话在我之后起跑：我的两张线上截图与另一条会话的 `live-app-pwa.png` 一起没了 |
    | 一条用例**所有断言都过了**却判红：`browserContext.close: ENOENT …/.playwright-artifacts-3/traces/…trace` | 两条 live-site 运行同时在写同一个 `test-results/`，彼此的 trace 被对方删掉。**红的是探针的产物目录，不是被测系统** |

    ✅ 修法（已做在 live-site 上）：每条套件有自己的 `outputDir` **且截图落进同一个自己的目录** ——
    `e2e/playwright.live-site.config.ts` → `live-site-results/`，`playwright.legal-links.config.ts`
    → `legal-links-results/`（那份配置头早就写了这条理由，只是没推广到 live-site）。
    ⚠️ 只改 `outputDir` 而截图仍写 `test-results/` 是**半个修法**：不再删别人的，但自己写的
    那张仍然会被别人的运行删掉（我第一次就踩在这个半成品状态上）。

    📌 一般规律：**共享工作树里，"验收跑一次"会改动磁盘状态**（删目录、占端口、留截图）。
    任何把证据写到公共路径的套件，都要假设**下一次别人的运行就是它的终点** ——
    证据要么进自己的目录，要么当场看完。与第 87 条（门禁 SIGKILL 别人的 dev server）同一家族：
    **验收载体自带破坏性**。

101. 🔴 **跨语言"对等"判据比整句，会红在本地化标签上 —— 九条用例同时红，而线上内容是对的。**

    新写的线上法务验收第一条对等判据是「中英两侧的**版本行文本**必须相等」，
    实跑 **9 failed / 1 passed**。错误信息一句话就定了性：

    ```
    中英版本行不一致（zh「版本 1.0 · 更新于 2026-10-01」/ en「Version 1.0 - updated 2026-10-01」）
    ```

    整句**本来就该不同** —— 它是 `site.legal.meta` 这条词条渲染出来的，标签属于界面语言，
    只有里面的版本号与日期属于事实源。改成抽出两个事实再比：

    ```ts
    const version = raw.match(/\d+\.\d+/u)?.[0];
    const date = raw.match(/\d{4}-\d{2}-\d{2}/u)?.[0];
    expect(version, `版本行里取不出版本号：「${raw}」`).toBeDefined();   // ← 这条不能省
    ```

    🔴 `toBeDefined()` 那两行是判据的一部分，不是装饰：只比"抽出来的值相等"时，
    **两侧都抽不到**（词条改了格式）会得到 `undefined === undefined` ⇒ 一次漂亮的假绿。
    与第 50 条（"状态对"在"没生效"时也绿）同一个形状。

    📌 一般规律：**对等判据要比"事实"，不要比"承载事实的那句话"** —— 凡跨 locale 比较，
    先问一句"这句话里哪些部分是翻译，哪些部分是数据"。

102. 🔴 **"那个页面在线上还在"证明不了"线上那份是我发的" —— 要认 chunk 名与 mtime。**

    同日：法务九页发布后，`live-legal.spec.ts` 10/10 绿。但同一次运行里
    `live-domain.spec.ts` 三条红了（英雄区主按钮 `href="#showcase"` 而不是 `/app`、
    `/app/` 60 秒渲染不出任务输入框）。归因过程值得记：

    | 查的东西 | 结果 | 结论 |
    |---|---|---|
    | 服务器 `/var/www/heyta-landing/**` 的 mtime | **全部同一秒** `23:19:07 +0800` | 有人在发布之后**整片重发**过一次 |
    | 主 chunk 名与字节 | 线上 `main-CSL_7LHx.js` 811 079 B vs 本地 `main-BnOUISMc.js` 813 993 B | 线上跑的**不是**我那份构建（不是我覆盖了谁，也不是谁覆盖了我 —— 是两次不同的构建） |
    | `ls -d …/legal/*/ …/en/legal/*/` | 9 + 9 全在 | 法务页在两次构建之间都活着 ⇒ **"还在"不是"是我发的"** |

    ✅ 所以线上判据要分两层：**内容对不对**（`live-legal.spec.ts` 那种渲染级断言）与
    **是谁的构建**（chunk 名 + 服务器 mtime + 归一化 hash，见第 99 条）。
    只做第一层会把别人的一次重发读成"我发的还在"，只做第二层会把"内容早就错了"读成"部署没问题"。

103. 🔴 **把一次副作用从入口顶层推迟到异步链之后，会让它挂在 `load` 上的监听永远不触发 ——
    生产构建里 service worker 从此不再注册，而且零报错。**

    链 5（首启隐私同意闸门）要求"注册 SW 必须在同意之后"，于是
    `registerWidgetServiceWorker()` 从 `main.tsx` 顶层搬进了 `startupNetwork.arm()`，
    而 `arm()` 跑在 `await initOpLog()` **之后** —— 实测那一刻
    `document.readyState` 已经是 `'complete'`（`load` 早就放完了）。
    `apps/web/src/pwa/register.ts` 的实现是 `window.addEventListener('load', …)`，
    于是**监听器挂在一个已经发生过的事件上**：

    | 观测面 | 结果 |
    |---|---|
    | `navigator.serviceWorker.getRegistration()` | 恒为 `null` |
    | 控制台 | **什么都没有**（`register()` 从没被调用，连那句 `console.warn` 都不会响）|
    | `pnpm -r test`（含 86 条相关单测）| **全绿** —— jsdom 没有 SW，而 dev 构建走 `!PROD` 早退 |
    | Windows 小组件链（`check:widgets` 的宿主入口）| 静默失效 |

    ✅ 修法不是"把注册搬回顶层"（那正是闸门要拦的事），而是**让注册对调用时刻免疫**：
    `readyState === 'complete'` 就当场注册，否则才挂 `load`（`{ once: true }`）。

    ✅ 判据补了两层，缺一层都会再漏一次：
    - `apps/web/tests/pwa-register-readystate.spec.ts`（jsdom，4 条，跑在 `pnpm -r test` 里）
      —— 钉住"complete 时当场注册 / loading 时仍等 load / `?slice=` 与 dev 两条早退"。
      三臂变异实测各红一条（改回只挂 `load` ⇒ 第 1 条红；拿掉 `slice` 早退 ⇒ 第 3 条红；
      拿掉 `PROD` 早退 ⇒ 第 4 条红）。
    - `e2e/tests/privacy-consent-zero-egress.spec.ts`（**生产构建** + Chromium）——
      它在修之前**就是红的**（两条正向对照臂报 `Received string: "NONE"`），修之后 7/7。

    📌 一般规律：**改变一段代码的执行时刻，就等于改变它对外部事件的假设。**
    凡是"挂在某个一次性事件上"的调用被搬到异步链之后，必须当场问一句
    "那个事件有没有可能已经放完了"。而这一条的根因判据只能来自真浏览器 ——
    jsdom 里那句"同意之前零出站"是真的，但它**测不到宿主**（第 46 条"没复现 ≠ 路径没执行"的反面：
    **在假环境里执行过的路径，也不等于在真环境里执行过**）。

104. 🔴 **Chromium 取 service worker 脚本不经过页面的请求流 ——
    拿 `page.on('request')` 去数 `/sw.js` 得到的是一条恒假断言。**

    写"同意前零出站"的反向判据时，按 §7 元规则 2 必须配一条"同一个量在同意之后不为零"的
    正向对照。最自然的写法是"清单里出现 `/sw.js`"，而它**永远不可能成立**：
    实测注册成功（`getRegistration().active` 有值、`scope` 正确）的那一次运行里，
    `page.on('request')` 一条 `/sw.js` 都没收到 —— service worker 脚本由**浏览器**取回，
    不在页面的网络管线里（不是 SW 拦截造成的：`sw-core.ts` 根本没有 `fetch` 处理器）。

    症状差别很关键：恒真的判据会让"零"变得没意义而**看不出来**，
    恒假的判据会**一直红** —— 而红久了的下一条断言往往被删掉，
    删掉的恰好是唯一那条能证明探针在工作的。

    ✅ 改法：正向对照换成 `getRegistration()`（`NONE` → 匹配 `/installing|waiting|active/`），
    另外把"请求分类器"本身做成一条**探针自检** —— 由页面**主动**
    `fetch('/sw.js', {method:'HEAD'})` 与 `fetch('/api/consent-probe')`，
    断言分类器数得出这两类，于是前面那些"清单为空"只可能是"没发"而不是"看不见"。

    📌 一般规律：**"必须不为零"的那一侧，要先确认这个量在当前观测面上真的可见。**
    对照臂的价值取决于它测得到；测不到的对照比没有对照更糟，因为它会教人删判据。

105. 🔴 **探针指着"从来不含那个值的载体"，得到的 0 会被读成结论 —— 以及"还原"同样要按内容验收。**

    链 3 在生产上收尾（G-32 的 L4）那天，两个"0 命中"都不是结论，而它们的症状与
    "生产上确实没做"长得一模一样（第 98/99 条同一个错误类：**探针自己错**）：

    | 我查的东西 | 得到的 | 真相 |
    |---|---|---|
    | 容器里 grep `/app/server/dist` | **0** 命中 | 镜像里的编译产物在 **`/app/dist`**。路径是**猜**的 —— 于是"镜像里没这段代码"是从一个不存在的路径里读出来的 |
    | grep 线上 `/legal/terms/` 的 HTML 找版本指纹 | **0** 命中 | 那一页是 **7259 B 的客户端渲染壳**，整套 `id@version` 只存在于 JS chunk（`/assets/main-W06aXnAC.js`，811 933 B）。不是"没发布"，是**那个载体里从来没有这个值** |

    危险的共同点：**0 恰好与当时想证的结论一致**，所以不会被追查。

    ✅ 判据：取一个**必须不为零**的正向对照。上面第二格改成先 `curl` 那个 chunk、数出
    **9** 组 `id:"…",version:"…"`，再与 `git show HEAD:server/src/legal.generated.ts` 的常量和
    数据库那一行做**三方逐字节比对**。三方对得上，前面那些 0 才开始有意义。

    🔴 同批的第二面：**还原变异体时命中的是另一行。**
    变异是 `input.termsAcceptedAt,` → `undefined,`（委托调用里），还原用
    `perl -0pi -e 's/    undefined,\n/    input.termsAcceptedAt,\n/'`：
    **模式没有行首锚点**，而源码里更早出现的 `new PasswordAuthError(…, undefined, …)` 那行缩进是
    **6 空格** —— `      undefined,` 里**包含** 4 空格那个模式；perl 默认**只替换第一处**，
    于是命中的是它。结果：命令**退出码 0**、`git diff` 却仍有内容，委托那处**从没被还原**。
    靠 md5 才发现（期望 `b69d46aa09505ffcc71626766dfec17f`，实际 `56ce141a…`），最后用精确编辑改回。

    📌 一般规律：**"改回去"与"改上去"共用一条判据 —— 按内容验收（md5 / 逐字节 diff），
    不按命令退出码验收。** 未锚定的缩进子串在 `perl` / `sed` 里是常态命中源；
    要么写成 `^…$` 带行首行尾锚点，要么用精确编辑工具而不是流编辑器做还原。

106. 🔴 **清掉 `ios/build` 后的首次 xcodebuild 必撞 Generate Specs 竞态 —— 报的是"文件不存在"，真因是脚本输出未声明；修法是 pod install 预生成，不是重跑构建。**

    2026-10-02 `reinstall:all` 的 iOS 段：12 个错全是
    `Build input file cannot be found: …/build/generated/ios/ReactCodegen/*.mm|.cpp
    Did you forget to declare this file as an output of a script phase`。
    而构建"失败"后那些文件**全部在盘上**、时间戳就是那次构建的 —— Pods 工程的
    `[CP-User] Generate Specs` 脚本阶段**只声明了 `react-codegen.log` 一个输出**，
    Xcode 不知道"先跑脚本再编译这些文件"，两者被并行调度，编译输给了生成。

    之前从没暴露，是因为 `ios/build/generated`（gitignored）一直留在盘上；
    谁清了它（rm -rf / 换机器 / 干净检出），谁的第一次 xcodebuild 就撞。
    判据：报缺的文件**构建结束后存在** ⇒ 竞态，不是 codegen 坏了。
    ✅ 修法 = `cd apps/mobile/ios && pod install`（安装期就 `run_codegen!` 预生成，
    日志见 `[Codegen] Done.`），与 runbook §2.2 一致；重跑构建只会再撞一次。

    🔴 同轮的第二面：**已提交的预编译版 `Podfile.lock` 在本机无法再生。**
    已提交版用 `ReactNativeDependencies`（预编译聚合 pod）；本机（仓库路径含空格）
    **不带 flags 的 pod install 必失败**（#30：`React-Core-prebuilt … Missing required
    attribute source`），无空格符号链接绕法也被 CocoaPods 解析回真实路径。带
    `RCT_USE_PREBUILT_RNCORE=0 RCT_USE_RN_DEP=0` 跑出来的是**源码构建图**
    （+boost/DoubleConversion/fast_float/fmt/glog/RCT-Folly/SocketRocket 独立 pod，
    lock +1115/−260）。`check:native-deps` 对两个形态都绿（对账的是 4 个业务
    pod 的版本）。一次性代价：切换后首次全量构建明显变慢（RN core 走源码）。

    📌 一般规律：**"文件不存在"类构建错误要先问"它是谁、什么时候生成的"** ——
    生成物缺失有两类病因（真的没人生成 vs 生成输了竞态），修法相反：
    前者补生成步骤，后者把生成挪到构建开始前。判据就是上面那句：
    **构建结束后文件在不在**。

107. 🔴 **引导性提问会让"人眼复核"产出假确认 —— 视觉模型顺着 prompt 编，而客观数字当时就在打脸。**

    2026-10-02 四端验收实测：一张**纯黑屏**（colorSpan 0、modalLuminance 4、主蓝 0）
    被问"这是不是隐私同意面板？"时，视觉分析回答"是，弹窗可见、蓝色按钮、无报错" ——
    **顺着提问的方向把不存在的细节全编了出来**。同轮还两次把**别的截图的 URL**
    当成当前文件喂给分析（结论与被验对象无关）。

    ✅ 判 UI 截图的三重一致（缺一不可）：
    1. **文件自证**：分析的 URL 必须是这次 `screenshot`/`Read` 命令自己产出的那个
       （长任务并行时尤其会拿错）；文件 hash（png-stats 的 `hash` 字段）对得上。
    2. **中性提问**：问"描述你看到的结构"，**不问**"这是不是 X" —— 后者是在
       喂答案。二元问句只允许出现在**失败复诉**里，不允许出现在首次判定里。
    3. **客观指标先于视觉**：png-stats 的 colorSpan / modalLuminance /
       countBrandBlue 与"有内容"的判断矛盾时，**先信数字**去查，不要替图辩解。

    📌 一般规律：**"人真的看了"的结论强度取决于看的方式** —— 引导性提问 +
    错误文件产出的"确认"，比不看更糟，因为它给假结论盖了章（§6.2 规定一
    要求的是"看"，不是"产生了看过的记录"）。

108. 🔴 **验收脚本的屏幕几何魔数要从 Application frame 推导，不能从"上次那台设备"继承 —— 换设备形态（折叠屏/平板/小屏）整批判据一起假。**

    verify-mobile-ios.sh 的滚动三魔数（可见阈值 800、swipe 起点 750、"每次挪
    34–50px"）全部从 iPhone 17 Pro（逻辑屏 402×874）实测得来；换到本机唯一可用的
    折叠屏 Duo（**466×678**）后：y=780 的元素"小于 800"被判可见（假绿）、
    swipe 起点 750 已在屏幕外（手势没人接，滚 14 次纹丝不动）。同族：
    ADB 的 `input swipe 540 …` 写死 1080 宽。

    ✅ 修法：屏幕尺寸的唯一事实源是 AX 树里 `type=Application` 的 frame
    （`ax - --list --json` 的 width/height），可见阈值 = 屏高−120（标签栏），
    swipe 起点 = 屏高−60，终点固定。**判据的阈值必须从被约束对象的当前属性
    推导**（元规则 2 的又一面目："从上次实测借来的常数"就是恒定前提里藏的
    第二台设备）。

109. 🔴 **探针的 label 撞上别的元素的子串 ⇒ 恒真判据 —— "添加" 撞「排序：按添加时间」。**

    verify 第 1 步的 `composer_open` 用「添加」查树，shim 的 find 是
    "精确优先、退化子串"：主界面排序 chip 的 label 是「排序：按添加时间」，
    **子串命中** ⇒ composer_open 恒真 ⇒ "按了取消还开着"的假卡住，
    两轮验收红在同一处。这颗雷一直在，界面长出排序 chip 的那天被踩响。

    ✅ 修法：shim 加 `--exact`（关掉子串退化）。凡"确认某物**不在**"的判据
    （composer_open、关闭确认、残留检查），**一律 --exact** —— 精确打不中
    本身就是判据，子串退化会把撞车元素当成命中。判"某物**在**"时子串退化
    仍有用（label 带动态后缀），但命中后要**核 frame/尺寸**再信。

    📌 一般规律：**探针查询词是某真实元素 label 的子串时，"查不到"永远不可能
    为真** —— 这类恒真判据不会自己报错，要等它第一次被依赖才爆。新增界面
    元素（chip/徽标/标题）时，回头 grep 一遍验收脚本里的 label 探针。

93. 🔴 **Google Prefab CLI 2.1.0 在 JDK 24 下把受限方法告警打上 stderr，而 AGP 的
    prefab 胶水把任何 stderr 行都当错误抛 —— Android 原生构建一旦"全量重配"必挂。**

    症状：`:app:configureCMakeRelWithDebInfo[arm64-v8a]` 失败，异常消息就是一行
    `WARNING: A restricted method in java.lang.System has been called` —— 真身在
    `app/build/intermediates/cxx/RelWithDebInfo/<hash>/logs/arm64-v8a/prefab_stderr.txt`：
    Prefab CLI 的 JNA 调 `System::load`，JDK 24 对未声明 native access 的调用打告警。
    增量构建时该任务 up-to-date 不执行，所以**平时是绿的**；任何让 CMake 缓存失效的
    改动都会让它现形（2026-10-02，批二重建时实测）。`JDK_JAVA_OPTIONS=
    --enable-native-access=ALL-UNNAMED` 治不了 —— "Picked up JDK_JAVA_OPTIONS" 这行
    NOTE 自己也写 stderr，照样被抛（实测）。
    ✅ 修法：装 JDK 21 LTS 到用户目录（brew cask 要 sudo，走 Adoptium tarball 解到
    `~/jdks/`），在**用户级** `~/.gradle/gradle.properties` 钉
    `org.gradle.java.home=…`（机器本地配置，不进仓库），`./gradlew --stop` 后重建。

    📌 一般规律：**"增量构建是绿的"不等于"工具链没坏"** —— 只验增量产物的流程会把
    全量重配的雷留到下一次缓存失效。升级 JDK 这类环境变更，必须触发一次全量原生
    构建才算验过。

94. 🔴 **共享验收助手的假设会过时：IA 把凭据表单搬进设置 Modal 之后，
    `configure_sync_credentials`（`scripts/lib/mobile-e2e.sh`）还在「我的」页找
    输入框 —— 三个字段全部"找不到"，而页面明明就在。**

    症状极难归因：字段不是被折叠，是**真的不在树上**；dump 里唯一的"服务器地址"
    出现在未配置提示语的文案里 —— 一条文案子串。于是脚本红了一大片，看起来像
    "产品没配好"，其实是助手对旧 IA 的记忆（2026-10-02 verify-mobile-inbox 立判据
    时实测；此前未爆只因最近的 schedule 验收全程不需要凭据）。
    ✅ 修法：助手按**稳定锚点**（resource-id `profile-entry-settings`，不走文字）
    先开设置 Modal、填完 keyevent 关回「我的」—— 修一处，所有 `verify:mobile-*`
    受益。

    📌 一般规律：**产品 IA 每挪一次，共享验收助手对屏幕的每个假设都要重对一遍**
    —— 助手不会自己报"我找的东西搬家了"，它只会红给你看。另一个同族坑在
    RN 安卓侧：普通 `View` 加 `accessible` + accessibilityLabel **仍不会**变成
    content-desc，要 `Pressable` 才行（同一天第三坑，一并记此）。

110. 🔴 **运行中的 bash 脚本是被增量读取的 —— 边跑边改它，后半段按字节错位炸出假语法错误。**

    2026-10-02 实测：验收脚本跑到第 6 步时，我在另一个工具调用里"顺手"编辑了
    同一个文件（加个循环），几分钟后运行方炸出
    `line 1610: syntax error near unexpected token ')'` / "` 72); do`" ——
    文件本身 `bash -n` 全绿。bash 按字节偏移**惰性读取**脚本，编辑使偏移整体
    位移，运行中的副本从被改处开始解析的是错位字节。

    ✅ 纪律：长跑脚本**运行期间零编辑** —— 修复排队，等 `pgrep` 确认进程退出
    再动文件；要"立即生效"就重启轮次。同族：`tail -f` 的日志文件可以随便看，
    被执行的脚本不行。

    📌 一般规律：**"正在被执行的文件"与"正在被阅读的文件"是两种东西** ——
    前者的修改是写进运行时语义的，任何"顺手改一下"都要先问一句它现在是否正在跑。

95. 🔴 **Expo 原生模块装不进 pnpm monorepo 的 bare RN 工程 —— `install-expo-modules`
    直接断言崩溃，expo 自己的源码注释写明 includeBuild 不吃 symlink。**

    批三依赖裁决选中 `expo-notifications@57` 后实测：`npx install-expo-modules@latest
    --non-interactive` 以 `ERR_ASSERTION`（actual: null）崩溃，settings.gradle 一字未动；
    手动接线也不可靠——`expo-modules-autolinking` 的 android.ts:49 注释：
    「The plugin source dir ends up in Gradle's `includeBuild`, which must not receive a
    symlink - Android Studio's Tooling API fails to import symlinked included builds」，
    而 **pnpm 的 node_modules 全是 symlink**。 Expo 官方对 pnpm 的建议是
    `node-linker=hoisted`——那是**仓库级** lockfile 布局改判，不是某个批能顺手做的。
    另：pnpm 移除依赖后 `.pnpm` 里会残留孤儿目录（无任何 lockfile 引用），
    `license-inventory`（扫整个 store）会把它们当真依赖报红 —— `rm -rf` 对应目录即绿
    （2026-10-02 node-forge@1.4.0 实测）。

    📌 一般规律：**给 monorepo 选型原生依赖前，先确认它的工具链对包管理器布局的假设**
    —— "npm 里一行装好"的东西，在 pnpm 的 symlink 布局下可能整条 gradle 接线都不成立。

111. 🔴 **同源开第二个标签页去点那条验证链接，那张页面永远启动不完 ——
    OPFS 的 SAH Pool VFS 一个文件只允许一个 access handle。**

    2026-10-02 实测（`e2e/password-web/password-journey.spec.ts` 第 ④ 步）：
    第一张标签页注册完还开着面板与库，用 `context.newPage()` 去点信里的验证链接，
    新页面控制台刷成串的
    `NoModificationAllowedError: Failed to execute 'createSyncAccessHandle' … there is another open Access Handle`，
    而**判据红的是"找不到 `account-menu-avatar`"** —— 读起来像"确认页跳转坏了"。

    根因在存储层：web 用的是 `@sqlite.org/sqlite-wasm` + **SAH Pool VFS，跑在 worker 里**
    （驱动文件头 `packages/storage/src/sqlite/` 警告的就是这件事）。同一份 SQLite 文件
    在浏览器里只能有一个同步 access handle，第一张页面还活着 ⇒ 第二张必然拿不到存储 ⇒
    应用卡在启动，不崩、不报错到界面、日志里只有控制台那串。

    ✅ 修法是**形态问题不是技术问题**：同一个标签页 `page.goto(verifyLink)`。
    那恰好是真实用户的路径 —— 他在邮件客户端里点链接，浏览器把**当前这一页**带到确认页，
    确认之后落到 `/app/`。`scripts/verify-email-web-chain.mjs` 用的也是这一种。

    📌 一般规律：**"再多开一个标签页"在本地优先 + OPFS 的架构下不是免费的夹具**，
    它是一个产品从未支持过的形态。e2e 的载体要选**用户真会走的那条路**；
    当"换一张页面"看起来能让测试更好写时，先问它是不是一个运行时结构性不允许的状态。

112. 🔴 **一个全局开关落进应用，会把所有"要点界面"的套件同时变成红的 —— 而两种红的
    症状都不是产品坏了：整屏遮罩吃指针事件，界面跟着浏览器语言漂成英文。**

    2026-10-01 两件独立的事同时落地：① 首启隐私同意面板（`role="presentation"`、
    `position: fixed; inset: 0`，盖住整棵 `main.ht-main`，rail 也在底下）；
    ② 语言解析链第 3 层 = `navigator.language`。Playwright **每条用例一个新 context**，
    于是每轮都是"没问过的设备"+ Chromium 默认 `en-US` ⇒ 离线套件一次跑出 **46 条红**，
    错误分别是 `… intercepts pointer events`（231 × retrying click）和
    `waiting for input[placeholder^="添加任务"] —— 元素根本不存在`。
    截图里应用渲染得好好的，只是整片是英文。

    ✅ 修在**共享入口**一次（`e2e/tests/helpers.ts` 的 `openApp` = 全模块 + 钉中文 +
    垫片 + `goto` + 等锚 + 真点同意按钮），不逐条补 —— 逐条补的下一批一定会漏。
    三条裁决当时都要想清楚：

    1. **默认 `local-only`，要出门的调用点显式传 `accepted`**：`local-only` 对绝大多数
       判据是最小承诺；而闸门换掉的是**整个** `window.fetch`，回环地址也不例外 ——
       所以 `page.route()` 桩的假服务端**一次都不会被调用**，症状是"面板/后台空着"。
    2. 🔴 **"计数为 0"这类反向判据必须显式 `accepted`**（`ai-unavailable`、
       `admin-console` 的"没登录不发请求"、`inbox` 的空态）：隐私闸门自己就能让
       计数为 0，于是"通过"担保的是"我们没同意联网"，不是被测的那道闸 ——
       **一条在两种根因下都绿的判据等于没有判据**。
    3. **不走 `openApp` 的那两条例外要逐件补，不能整体豁免**：
       `language-first-launch`（判的就是语言协商，绝不能钉中文）与
       `motivation` 的"默认 rail 只有 7 个 tab"（`openApp` 会开全模块，
       "默认几个"在那套配置下永远测不到）—— 但钉语言之外的**遮罩仍然要关**，
       否则前者点语言切换器时卡在同一个 `intercepts pointer events`。

    📌 一般规律：**"这个套件以前是绿的"不构成"它不依赖环境"**。`windows-shell` 那套
    此前一直命中中文锚点，只是因为打包机恰好是中文 Windows；语言假设没人写进判据，
    换一台英文宿主它就在第一行红，而红的是探针。环境假设要么由共享入口显式制造，
    要么由一条断言钉住 —— 不能靠"这台机器恰好如此"。

113. 🔴 **#110 的结构性收口 —— 长跑验收脚本入口"自快照 + exec"：让"运行中被编辑"
    从纪律问题变成不可能事件，靠的是机制不是自觉。**

    #110 记的是失误本身（bash 按字节偏移增量读取，边跑边改炸出假语法错误），
    纪律是"运行期间零编辑"。但**靠自觉的纪律会被下一次赶时间击穿** —— 修法是
    让违反它也不再伤到运行中的验收：

    - **自快照**：脚本入口（前 15 行内）先把整份自己 `cat` 成**同目录**隐藏快照
      `.原名.snap.PID`，再 `exec bash 快照 "$@"`。同目录是为了 `$0` 的
      `dirname` 语义不变（27 个 verify/reinstall 脚本全靠它定位 `lib/`、`tools/`）。
      之后对源文件的任何编辑都影响不到本次运行；快照退出时 `trap` 自清，
      被 kill -9 留下的由下次运行按 `mmin +240` 顺带扫掉，名字进 `.gitignore`。
    - **守卫用 `$0` 的 basename（`.snap.` 前缀）而不是环境变量**：env 会漏给
      子脚本，让它们的自快照被误跳过 —— 那是同一个坑的第二种面目。
    - **门禁 `check:script-snapshot`（进 `pnpm check`）**：显式清单 + 标记 +
      三处结构（case 守卫 / `exec bash "$_snap"` / trap）+ 🔴 **标记必须在前
      15 行**（把块挪到文件尾部 = 标记还在但永远不执行）。变异验证：删块 ⇒ 红；
      挪到尾部 ⇒ 红（4 处）。清单刻意显式枚举 —— 并行会话在途的
      `verify-mobile-account.sh` / `verify-mobile-reminder-ring.sh` 等落地后再加。

    **A/B 实验证据（2026-10-02，~420KB 合成脚本，运行 1 秒后在头部插入 5 行）**：
    无 bootstrap：`line 5204: yyyyy: command not found` —— 第 5204 行是**注释行**，
    注释永远不可能被执行；唯一解释是 bash 的读取位置已与文件的行结构错位
    （错位落在哪决定炸成"执行垃圾"还是"语法错误"，两种都是坏 —— 真实事故
    是后者）。有 bootstrap：同一编辑对运行**零影响**（stderr 干净、尾标记照常
    打出、快照自清）。

    📌 一般规律：**对"人为失误类"的坑，纪律与机制要各修一半** —— traps 登记
    纪律（下次慢一点），机制让击穿纪律的那一下不再产生假信号（红得像产品坏了，
    其实是探针被自己改坏）。判断机制是否到位的标准：**失误发生时系统的表现
    与没发生时不可区分**。

114. 🔴 **模拟器 adbd 挂死时 `adb shell` 会无限挂 —— 而 source 期的探针会把
    source 同一份 lib 的**所有**验收（含 iOS 那份）一起钉死在 0 输出。**

    2026-10-02 实测：Android 模拟器进程活着、`adb devices` 显示 `device`（在线），
    但 `adb -s emulator-5554 shell echo ok` 8 秒超时（exit 124）。`mobile-e2e.sh`
    的 IMES 探针在 **source 期**跑 `adb shell ime list -s` —— iOS 验收脚本
    source 这份 lib 只为复用助手，结果在打印**第一行输出之前**就无限挂起；
    同一台模拟器上另一会话的 Android 验收同样停在 0 CPU。症状（进程活着、
    日志 0 字节、无报错）完全不像"某台模拟器坏了"，第一反应会是怀疑自己
    刚改的东西 —— 那正是最危险的方向。

    ✅ 修法：lib 的探针与 `disable_ime` / `restore_ime` 全部包上
    `timeout 10`（coreutils；缺失时降级为不包，行为同旧版）。超时 ⇒ IMES
    为空 ⇒ 后续对空集是无操作，不放大伤害。已在跑的实例救法：击毙挂住的
    `adb` 子进程，命令替换以空集返回，source 继续。

    📌 一般规律：**source 期执行的任何外部命令探针都要有界** —— 它挂在
    哪里，所有 source 它的脚本就一起挂在哪里；"设备在线"（adb devices）
    与"设备的 shell 能用"（adb shell）是两件事。

115. 🔴 **并行会话跑 `pnpm install` 会让已生成的 CocoaPods 工程"半旧半新"——
    症状是一串同名头文件 redefinition，清构建目录也没用，`pod install` 9 秒即愈。**

    2026-10-02 实测：15:17 我重生成过 Pods（traps #106 那轮）；17:37 另一会话
    刷新了 node_modules（.pnpm 目录重写、文件换 inode）。之后 Release 构建在
    `React-runtimescheduler` / `React-jsinspectortracing` 等多个 pod 上报
    **同名函数 redefinition**：同一个头文件经 node_modules 原路径与
    `Pods/Headers/Private` 软链两条路进同一个 TU。`rm -rf` 构建目录**无效**
    （不是脏中间产物）；重跑 `pod install`（9 秒，依赖图零变化）重新对账
    生成物 ⇒ 干净构建通过。

    误诊方向预警：报错形态像"头文件冲突/React Native 版本坏了"，会把人引去
    动 RN 版本或 Pods 依赖 —— 而它只是**生成物与现实脱节**。同族：#106
    （清 build 后的 codegen 竞态）、#82（"重装了一遍"≠"装的是当前源码"）。

    📌 一般规律：**多会话共享一个工作树时，任何"生成物工程"（Pods、codegen
    产物、dist）都可能被别人的包管理器操作静默作废** —— 构建挂在别人动过
    的时刻之后，先跑对应的生成器对账（pod install / codegen / build），
    再谈别的。

116. 🔴 **两个会话在同一台模拟器 + 同一个 /tmp 构建目录上各跑 iOS 验收 ——
    症状是"输入原语三连同死、AX 树忽空忽有、App 装了却起不来"，全都不是它自己的错。**

    2026-10-02 实测：run15/16/17 三轮全红在"文字送不进应用"（AXSetValue 与 HID
    双路径都'失败'），期间还出现两份 SIGABRT 崩溃报告（TurboModule void 方法抛
    OC 异常）。逐层排查——重启模拟器自愈无效、崩溃栈指向 App——最后发现真相：
    **另一个会话正从它自己的工作树（/tmp/heyta-g5m）对着同一台模拟器、同一个
    `/tmp/heyta-ios-release` 构建目录跑 xcodebuild**。它每次构建-安装都会把
    模拟器上的 com.heyta 换成它的产物：我的"输入失败"其实是 App 正被换掉，
    "AX 树为空"是它的装卸循环，"App 起不来（FBSOpenApplicationService
    code=4）"是它的构建正把 .app 写到一半。崩溃报告则是**双方共用的**
    Heyta.app 的崩溃 —— 单看报告根本分不清是谁的。

    ✅ 修法（两层）：
    1. **资源隔离**：`verify-mobile-ios.sh` 的三个共享路径全部可覆盖
       （`HEYTA_IOS_DERIVED` / `HEYTA_IOS_LAPTOP_DB` / `HEYTA_IOS_BUILD_LOG`，
       默认值不变），加上既有的 `IOS_UDID` —— 另建一台专属模拟器
       （`simctl create … iPhone-Duo iOS27.1`）+ 专属 /tmp 前缀，从此
       两个会话的 iOS 验收互不可见。
    2. **诊断顺序**：iOS 验收"原地三连同死"时，**先 `ps` 查有没有第二个
       xcodebuild 在跑**（看它的工作树路径与 -derivedDataPath），再怀疑自己。

    📌 一般规律：**/tmp 里的固定路径 + 单实例设备（模拟器/adb）都是全局共享
    资源** —— 多会话并行时它们是隐形的交叉点；凡是"行为 inexplicably 变了"，
    先问"这些资源现在还有谁在用"。（同族：#83 探针污染状态、#115 生成物被
    别人的包管理器作废 —— 这是第三种面目：**被别人的构建/安装循环顶掉**。）

117. 🔴 **同一棵工作树、两次全量跑分不同 —— 别急着说"产品 flaky"：漂移源有三个，本轮起作用的是
    最不被查的那一个（别人未提交／未跟踪的源码）。**

    2026-10-02 实测：`cd e2e && npx playwright test` 相隔 12 分钟跑两次，第一次
    **93 passed / 1 flaky**，第二次 **87 passed / 6 failed**。六条红的信息逐字相同
    （`除已登记缺失外不该有非 2xx：["/api/account/legal-consent"]`）。如果只看数字，
    这就是"套件不稳定"；实际是三件不同的事，而且**两次跑之间 HEAD 一笔没动**
    （`git log` 在该窗口内 0 条；最近一笔是 19:14:48，在第一次跑的内部）。

    三个漂移源与各自的查法（按命中成本排序）：

    1. **未提交／未跟踪的源码** ← 本轮就是它。`git status --porcelain <目录>` 看 `M`/`??`，
       再 `stat -f '%Sm %N' -t '%H:%M:%S' <文件>` 把 mtime 对到两次跑的时间窗里。
       这里 `apps/web/src/main.tsx` 的 mtime = **19:29:10**，正好落在第一次结束（19:21）
       与第二次开始（19:33）之间 —— 那 8 分钟里有人把一段新的出站调用接进了启动路径，
       而夹具把 `baseUrl` 塞成 `http://127.0.0.1:4319`（假 AI 端点），它的契约是
       **只实现模型接口**、其余路径一律 404（`e2e/stub-provider.mjs:139-143`），
       各 spec 的 `page.route` 又是**按端点逐个**打桩的 ⇒ 没桩的那条打到 404，
       六条同一原因。**同一棵树的"当前源码"包含别人没提交的东西。**
       ⚠️ 判"这个请求被谁接住了"要看塞进 `baseUrl` 的那个常量，**不是应用自己的 origin** ——
       本条初稿就是按 4318（vite dev）推的，方向对、落点错。
    2. **`packages/*/dist` 被别人的 `pnpm install` / `build` 作废** —— 数 vite 的
       `Pre-transform error` 条数并按次对账（本轮同一次运行里 38 条、另一次 63 条、第三次 0 条）。
       这条已有 **#115**（生成物与现实脱节，症状是同名头文件 redefinition / 模块加载失败），
       本条只补"要**逐次**计数，不是跑完只看结论"。
    3. **HEAD** —— `git log --format='%h %ad %s' --date=format:%H:%M:%S` 看两次跑的时间窗里
       有没有提交进来。本轮它被**先查且是干净的**，所以差点把"HEAD 没变"错当成"什么都没变"。

    误诊方向预警：形态长得像 flaky（同一批用例、不同的跑、结果不同），也会长得像
    "别人改坏了产品"。两者都不对 —— **是探针脚下的地面被换过**。

    📌 一般规律：**共享工作树里"两次跑"之间变过的东西不止提交历史**；判"flaky"之前
    必须把这三样各自证伪或证实，并且把逐次计数写进证据（只有最后一轮的结论会掩盖前一轮的环境）。
    （同族：#115、#82"重装了一遍"≠"装的是当前源码"、#46 没复现 ≠ 路径没执行。
    本轮完整取证在 `BLOCKED.md` **B12**。）

118. 🔴 **同一份判据被两套 Playwright 配置收走，结论可以相反 —— 差别在 webServer 是
    `vite`（dev）还是 `vite preview`（生产构建）。dev 下 Vite 自己会开一条 HMR WebSocket，
    它同时把「零出站」弄成**假红**、把「真的重连了」弄成**恒真**。**

    2026-10-02 实测（G-27 补签那条闸门判据）：`e2e/tests/legal-reconfirm-gate.spec.ts`
    在 `stubRecheck()` 里 `page.on('websocket', s => sockets.push(s.url()))` **来者不拒**，
    然后用同一个计数器判两个方向：

    | 用例 | 断言 | dev（主配置 4318）下的真值 |
    |---|---|---|
    | 待补签 | `sockets` 必须为空 | **红**：里面是 `ws://127.0.0.1:4318/?token=8-cC4f_Ev09e` |
    | 确认之后 | `poll(sockets.length)` > 0 | **绿，但绿得没有意义**：数到的那条就是上面那条 HMR |

    应用的实时端点由 `buildRealtimeUrl` 生成（`packages/sync-client/src/realtime.ts:200`），
    形状是 `ws://<baseUrl>/api/sync/ws?token=…&clientId=…` —— **有路径、有 clientId**。
    HMR 那条是**根路径、无 clientId、令牌是随机 12 位**。所以"是不是应用建的连接"这件事
    在 URL 上写得明明白白，红的纯粹是探针没过滤。

    为什么他们自己看不见这个红：那条线用**专用配置**
    （`playwright.legal-reconfirm.config.ts`：端口 4323 + `vite preview` + 生产构建），
    preview 服务器**没有 HMR**，于是同一份判据 6 passed，取证就存在
    `apps/web/evidence/legal-reconfirm-gate/run.txt`（里面印的正是
    `ws://127.0.0.1:4323/api/sync/ws?token=E2E-TOKEN-123&clientId=…`）。
    而 spec 住在主配置的 `testDir` 里 ⇒ **谁跑 `pnpm check:ai-e2e` 谁就收到一个假红，
    并且那支用例的正向对照在他脚下是恒真的。**

    ✅ 修法：过滤器形状**跟着判据的方向走**，不是一把尺子量两边 ——
    - **正向判据**（"确认之后实时通道真的重开"）⇒ 只认真端点：
      `if (new URL(s.url()).pathname === '/api/sync/ws') sockets.push(...)`。
    - **负向判据**（"同意之前一个 WebSocket 都不许建"，如 `privacy-consent-zero-egress.spec.ts:95`）
      ⇒ **只排掉 HMR 那一条**（同 origin + 根路径），其余一律计入。收成"只数 `/api/sync/ws`"
      会把负向判据变成恒真：将来任何新增的 WS（厂商 SDK、协作通道）都从计数里隐身，
      而那类判据的对象恰恰是"一个都不发"。

    ⚠️ 本轮我一度把负向那支也照正向的形状改了，量过之后**改回来**：它被主配置
    `testIgnore`（`e2e/playwright.config.ts:28`）排除，只由
    `playwright.privacy-consent.config.ts` 收走，而那份配置是 `vite preview` ⇒ 危险当前不成立，
    改了等于用一条更弱的判据换一个不存在的问题。

    同一条"配置决定判据死活"的机制在这一支还有第二个证人：`apps/web/src/pwa/register.ts:48`
    是 `if (!import.meta.env.PROD) return;` —— **dev 下根本不注册 SW**，所以"没有 `/sw.js` 请求"
    这条判据在 dev 里恒真。那支配置的文件头（`:6-11`）写的就是这件事。

    📌 一般规律：**e2e 判据的可信度有一部分长在 webServer 上，不长在 spec 里。**
    复用别人的 spec 前先问三句：① 这套 webServer 是 dev 还是 preview；② 它有没有自己会发
    网络/WS 的**开发期客户端**；③ 这条判据是正向还是负向（它决定过滤器该宽还是该窄）。
    （同族：#46 没复现 ≠ 路径没执行、#50"状态对"在"没生效"时也绿、元规则 2、#117 脚下地面被换过。
    本轮完整取证在 `BLOCKED.md` **B13**。）

119. 🔴 **量几何要等"被量的那两个盒子"停止位移 —— 两条方向相反的入场 transform 会让
    `子.y - 父.y` 不等于 `padding-top`，报出一个 2.68px 的"布局回归"。**

    2026-10-02 实测：`e2e/tests/search-overlay.spec.ts` 的贴顶判据（ⅰ 那条 padding 不吃高度、
    ⅱ `|上隙 − padding-top| ≤ 2`、ⅲ 上隙 < 下隙）报
    **`padding-top 128 / 实测上隙 125.31800746917725`** —— 差 2.682，恰好在容差外面。
    界面没坏：`.ht-search-overlay` 自己挂着 `ht-sheet-in`
    （`apps/web/src/styles/app/sheets.css:123`，`from { transform: translateY(+space-2) }`），
    卡片另挂 `ht-material-in`（同文件 `:154`，`from { transform: translateY(-space-1) }`，
    时长取弹簧参数 `--ht-motion-spring-response-sheet`）。**两条位移方向相反、时长与相位也不同** ⇒
    动画中间帧量到的上隙 = `padding + 卡片位移 − 浮层位移`，与那个被约束的常量根本不是一个量。
    落位之后差值归 0。

    为什么会突然照出来：这一支原先是 `page.goto()`，收口 B9 家族时改成走共享入口
    `openApp()`（它要先把首启隐私同意做完、再把界面钉在中文）⇒ 前面几步的耗时变了，
    量取时机**恰好**从"动画已落位"挪进"动画进行中"。**这不是新缺陷，是新时机把一个一直存在的
    探针脆弱性照出来了**（同一个红在昨天的机器上就是绿的 —— 那种"绿"也不是判据）。

    ✅ 修法（两层，缺一不可）：
    1. **等的是这两个盒子，不是全站动画**。别用 `document.getAnimations()` 判落位 ——
       页面上任何一条无关动画（骨架屏、番茄钟）都会把等待拖成超时，症状又像"界面坏了"。
       这里写一个 `settledGeometry()`：连续两次取 `boundingBox()`，`y` 差 < 0.01 才算落位，
       40 次还不停就**响亮地失败**（那说明界面真的在抖，判据本来就不该过）。
    2. **不动阈值**。`≤ 2` 那条一个字节没改 —— 这条修复的合法性判据是"改的时机不改的牙齿"：
       把 `align-items: center` 塞回去造成的缺口是**永久性**的，落位后照样红（变异方向不变）。

    ⚠️ 反面做法（本轮没采纳，登记在这里因为它看起来很省力）：把容差从 2 放宽到 3。
    那会让 ⅱ 这条**同时**失去抓 `align-items: center` 之外的能力，而且下次弹簧参数一改
    又红 —— 用放宽阈值来掩盖"量早了"，等于把判据改成"跟着我的探针走"。

    📌 一般规律：**几何类判据的隐含前提是被测对象处于静止态**，而 CSS 入场动画让"元素出现"
    与"元素就位"是两个时刻。`toBeVisible()` 只保证前者（`opacity` 从 0 开始时就已经可见）。
    同族：#63（无障碍树为空要先重启）、本文件"等动画落位再截图"那条 e2e 探针陷阱 ——
    **截图要等，量几何同样要等**。

121. 🔴 **iOS 模拟器运行时的行为差：27.0 全量运行时上 `set-value` 不触发 RN 的
    onChangeText、HID 无中文 keycode —— 与 27.1 Duo seed 完全相反，判据脚本
    跨运行时不能共用同一套输入原语。**

    2026-10-02 实测（iPhone 17 Pro / iOS 27.0，App 为干净 HEAD 构建）：
    - `AXSetValue`（idb `set-value`）：rc=0、AXValue 回读正确，但 **RN 表单状态
      没变**（「添加」仍 disabled）—— 这正是 shim 文件头记录的 **secure 框**
      行为，在 27.0 上**普通文本框也一样**；而 27.1（Duo seed）上普通框是好的。
    - `ui text`（HID 键盘）：ASCII 正常进 RN 状态；**中文直接抛
      `No keycode found`**（HID 按键码没有 CJK）。
    - 可用组合：tap 聚焦 → 键盘弹出 → HID 打 ASCII。中文标题要过剪贴板/粘贴，
      或让验收标题可配成 ASCII。

    📌 一般规律：**同为 "iOS 27"，全量运行时与预览 seed 运行时在无障碍/HID
    这类接缝上的行为不同** —— 换运行时 = 换了一套探针语义，输入原语与判据
    都要按运行时各自实测一遍，不能因为"版本号差不多"就复用。

122. 🔴 **宿主 macOS beta 的系统守护进程崩循环会把模拟器无障碍桥整机打死 ——
    症状是"AX 树随机全空、连系统 App 都读不出"，与被测代码零关系。**

    2026-10-02 实测：`intelligencetasksd` 从 20:23 起崩循环约一小时
    （26 份 .ips，Swift XPC `XPCPeerRequirement.hasEntitlement` 断言 ——
    macOS 27.2 beta 的系统 bug），同窗 `AppIntentsLiveEntityService` ×11。
    期间所有 iOS 模拟器（新旧、27.1/27.0、重启与否）的 AX 树**开机即空或
    跑几步就空**；控制实验：App 进程活着、界面在渲染、无 App 崩溃，树照样空。
    崩循环自行停止后，重启模拟器 AX 即恢复。

    ✅ 排查顺序（这条的识别特征）：AX 树空时**先看宿主 DiagnosticReports 里
    有没有系统守护进程在崩循环**（`intelligencetasksd` / `AppIntents*` /
    `dtdeviceinfod`），再看模拟器，最后才怀疑被测 App。

    📌 一般规律：**模拟器栈的故障域有三层（被测 App / 模拟器运行时 / 宿主 OS），
    AX 全空且跨设备复现时，先从宿主层查起** —— 越靠下层的病，越长得像
    "App 坏了"。（同族：#116 把共享资源误判成自己的错 —— 这是它的镜像：
    把宿主的病误判成模拟器/App 的。）

123. 🔴 **三道"债阶梯"门禁在 `main` 上就是红的 —— 你的那笔没让它更红，
    但 `pnpm check` 会把这笔账算到你头上。**

    2026-10-02 23:2x 实测（HEAD `7a255288`，即 `origin/main` `5ab22ec0` 之后）：

    | 门禁 | 干净检出 `HEAD` 上 | 当时的工作树 |
    |---|---|---|
    | `check:l4` | 🔴 `apps/mobile/src/screens` 内联样式 **101 > 基线 90**（web 侧 94 ≤ 104 是绿的） | 113（移动端新增屏又带进 12 处） |
    | `check:empty-state` | 🔴 **1 处**手写空态（`NotificationsScreen.tsx`） | 2 处（`SecurityScreen.tsx` 又一处） |
    | `check:rn-aria` | 🔴 **2 处**对象形态无障碍属性（`packages/ui/src/date-picker/DatePicker.tsx:105`、`:202` 的 `accessibilityState={{ selected }}`） | 同一处，逐字相同 |

    三条都不是"环境坏了"：把 HEAD 拉进 `git worktree add --detach /tmp/x HEAD`
    单独跑，红照样在 —— 这就是分辨"仓库红 vs 我这台机器红"的那一条命令
    （#88 的同一用法）。

    🔴 **为什么它一定会被误算**：`check` 是 `package.json` 里 40 多段的 `&&` 链，
    一次运行**只暴露第一个红**。于是"我修完 A 之后 check 该绿了"在这条链上
    系统性不成立：断点之后的门禁一次都没执行。看到 l4 红的人有两条错路可走 ——
    ① 以为是自己的改动造成的，去改一个自己没碰的文件；② 为了让链过去**把基线
    涨到总数**（门禁自己的话：「让总数降回基线以下，不是让基线涨到总数」）。

    ✅ 正确动作：跑门禁前先在 HEAD 的隔离检出里量一次基线，把"既有债"和
    "我这笔新带的"分开报；既有债**登记、不顺手修**（它有自己的所有者），
    新带的那部分要么消掉、要么在提交信息里明写"这一笔让 X 从 a 涨到 b"。
124. 🔴 **RN 0.84.1 在 Android 上读不出任何本机 URI —— `fetch`、`XHR(responseType:'text')`、
    `XHR(responseType:'blob')` 三条路全废，而症状长得像"没权限"。**

    `content://` 与 `file://` 一律回 `Network request failed`（fetch）或 XHR onerror。
    原生侧的原文异常才是依据：logcat 里失败栈顶是
    `NetworkingModule.sendRequestInternalReal(NetworkingModule.kt:318)` —— 那一段处理
    "本机 URI 的 `UriHandler`"时，为了造一个假的 `okhttp3.Response` 去调
    `Request.Builder().url(...)`，而 OkHttp 的 `HttpUrl` 只接受 http/https ⇒ 直接抛。
    所以 `BlobModule.networkingUriHandler`（它的 `supports()` 要求 `responseType == "blob"`）
    **永远走不到取字节那一步**。⇒ 这条路上没有"换一种 JS 写法"的解法。

    ✅ 落地：读文件是**平台 API**，落在一行原生里
    （`apps/mobile/android/app/src/main/java/com/heytamobile/fs/LocalFsModule.kt`，
    `ContentResolver.openInputStream` + `String(bytes, UTF_8)`，注册同 `WidgetPackage`
    那条 `BaseReactPackage` 路子）。iOS 侧没有对应原生模块（本工程 Xcode 是经典分组，
    加 `.m/.swift` 要改 pbxproj），JS 退到 RN 的 blob 通道 —— **该退路未在模拟器验证过**。

    两条归错因的实测教训，都记在这条里：
    ① 看到 `content://` 失败就怀疑"SAF 没给读权限"是错的 ——
       `keepLocalCopy` 落成的 `file:///data/user/0/com.heyta/cache/.../heyta-backup.json`
       **同样失败**才把它排除（自家缓存不可能没权限）。
    ② 中途那条 `Cannot read property 'readAsText' of null` 是**读取之前**就抛的
       （模块名写错：spec 里注册名是 `FileReaderModule`，不是 `FileReader`），
       它挡住的是"blob 通道到底通不通"这个真正的问题 —— 我一度把它读成"字节已经拿到了"。
       同族小坑：RN 的 `XMLHttpRequest` **没有** `overrideMimeType`，调它就是 Hermes 的
       `undefined is not a function`，而它冒出来的位置恰好是"读文件失败"那一行。

125. 🔴 **设备探针的三种假红面目（都在备份还原判据上实测过）：**

    1. `xy_text` / `xy_desc` / `has_sub` 读的是 `/tmp/ui.xml`，**自己不会重 dump**。
       在等待循环里"只等不看"= 拿**上一屏**找节点 ⇒ "入口找不到"必然红，
       而界面上一切正常（实测报成"选择器里没有 Show roots"）。
    2. 判断"谁在前台"**不能对整份 `dumpsys window` grep 包名**：系统会把已停止的
       Activity 窗口记录留在输出里，于是"选择器还开着"在上一轮用过之后**永远为真** ——
       `pick_file` 据此报"在当前视图里找到了文件"，坐标其实来自一份旧 dump，
       点击全落在应用界面上。只取 `mCurrentFocus=` 那一行才行。
       ⚠️ 反过来也别把 `mCurrentFocus` 当"界面已就绪"：本机负载 40+ 时 DocumentsUI
       冷启动可以超过 15s，等到超时它才出现（实测：判据报"没开到前台"，
       而同一轮的 `screen_txt` 里选择器节点明明在）。
    3. 系统选择器占着前台时，后面每一个坐标都点进它 ⇒ 一层红带出五六条
       "看起来各自独立"的红（实测：判据② 红 → 判据③/④ 报"找不到输入框：服务器地址"）。
       失败分支必须先把选择器关掉、把应用抢回前台，再让后面的判据各自说话。

126. 🔴 **软键盘开着时，脚本的滚动 swipe 会"打字"。**

    `adb shell input swipe 540 1900 540 1000` 从屏幕下半部分**划过键盘按键**，
    Android 把它当成输入送进当前聚焦的输入框 —— 实测粘贴框里长出
    `not-json-garbage GT GT GT … y`，而那正是被划过的键。判据于是把"探针在写字"
    读成"应用没反应"。⚠️ `disable_ime` 换的是**默认输入法**，**不收已经弹起来的那块键盘**；
    要按 `mInputShown` 判在不在再 `KEYCODE_BACK` 收（`hide_keyboard`），
    并且把滚动区间的下界提到键盘上沿以上。

    **第二面目（2026-10-03 实测，比第一面目贵得多）：键盘不只是"会被 swipe 划到"，
    它还会把 `input tap` 整条吃掉。** 键盘盖住屏幕下 ~45%，而**被盖住的节点
    照样在无障碍树里、照样给得出中心点** —— 于是探针拿到坐标、以为点中了按钮，
    实际那一下打在键盘的某个键上：截图里粘贴框多出一个 `v`，而「确认还原」
    根本没被按下。一条键盘状态连锁出四条各自像产品缺陷的红
    （②"没看到还原成功" / ②尾"选择器没开到前台" / ③"任务列表 0/3" /
    ④"找不到输入框：服务器地址" —— 最后那条是因为标签栏也在键盘带里）。

    ✅ 两条一起才收得住：
    1. **会立键盘的那一步放到这块屏的最后做**（本例把"往粘贴框打字"从判据①
       拆出来挪到判据② 之后）。顺序本身就是探针的一部分，不是排版问题。
    2. 其余每一处"点下半屏的节点"之前过一次 `require_keyboard_down`，
       收不掉就 **exit 3**（探针不成立），而不是继续往下点。

    📌 一般规律：**无障碍树给得出坐标 ≠ 那个坐标点得到**。仓库里 `xy_edit_sane`
    已经在防"折叠线以下 bounds 负高度"的同一族问题，键盘带是它的另一种面目 ——
    凡是"节点在树里但被别的东西盖住"的场景（键盘、Modal、悬浮条、系统栏），
    点击前都要重新问一次"此刻它露出来了吗"。

127. 🔴 **DocumentsUI（系统文件选择器）的三条环境相关事实：**

    1. `adb push` 到 `/sdcard/Download` **不进媒体库** ⇒ Recent 视图里没有它
       （只列历史上打开过的旧文件）。要么 `content call --uri
       content://media/external/file --method scan_file --arg <路径>` 登记，
       要么走 根菜单 → Downloads。
    2. **根菜单里有没有 "Downloads" 跟着镜像变**：这台 AVD 的根菜单是
       Images/Audio/Videos/Documents/Recent files，**没有 Downloads**。
       ⇒ 选择器路线要"当前视图"与"根菜单→Downloads"**都试**，并打出实际走了哪条；
       假装只有一条 = 换台机器就随机红。
    3. 焦点在 DocumentsUI 时 `adb shell input tap` 会**抛 Java 异常**
       （`InputShellCommand.runTap` 的栈），不是静默失败 —— 探针要把"点了没反应"
       和"点被拒"分开报。

128. 🔴 **依赖裁决要查到"实际装的那个包"，不是"那个仓库还在更新"。**

    批五第一次按"活跃、MIT、peer 覆盖 RN 0.79+"装了旧包名
    `react-native-document-picker@9.3.1`（末版 2024-08），它在 RN 0.84 上
    `compileReleaseJavaWithJavac` **编不过**：引用的
    `com.facebook.react.bridge.GuardedResultAsyncTask` 已被 RN 删除。
    同项目的活跃后继是 **scoped** 的 `@react-native-documents/picker`，
    换包名 = API 也换（`pick()` + `keepLocalCopy()`，没有 `pickSingle` / `fileCopyUri`）；
    ⚠️ 而它的 **podspec 仍叫旧名**（`RNDocumentPicker`），所以 `check:native-deps` 里
    看到旧名不代表旧包还在。同族：§3.1 的"最后发版时间"必须由那个包回答。

129. 🔴 **移动端首次同步慢到分钟级 —— 服务端命中类判据必须轮询，不能"同步一次就读"。**

    Hermes 上没有 WebAssembly，端到端密钥要**纯 JS 逐批算**，应用自己就写着
    "首次同步可能要等数十秒到数分钟"。实测：判据报 `0/5 命中` 的那一轮，
    之后界面自己变成"已全部上传 + 上次成功同步" —— 不是产品没传，是探针读太早
    （元规则 1）。⇒ 轮询到命中或到时限，并把**等了多久**打出来；
    同时把"还没设置端到端加密口令"这类**可观察的终止态**单独识别，
    否则会把"口令没生效"等成"超时"。

130. 🔴 **后台跑的长脚本继承到的是 C locale —— `pod install` 会崩在 CocoaPods
    自己的错误报告器上，而真正的报错一起被吞掉，只剩一长串 ruby 栈。**

    2026-10-03 实测：四端重装在隔离检出里跑，前三步（`git worktree add` →
    `pnpm install`）都过，到 `pod install` 死了，`CHAIN_EXIT=4(pod)`。日志里能看到的
    全部信息是：

    ```
    UnicodeNormalize.normalize': Unicode Normalization not appropriate for ASCII-8BIT
      (Encoding::CompatibilityError)
      from cocoapods-1.17.0/lib/cocoapods/config.rb:167:in 'Pod::Config#installation_root'
    ```

    两个坑叠在一起，第二个才是贵的：

    1. **成因是 locale，不是路径。** `nohup` 出来的环境里 `LANG`/`LC_ALL` 是空的，
       Ruby 于是把路径当 `ASCII-8BIT` 去做 NFC 归一化。同一份 `Podfile`、同一个目录，
       在交互 shell 里跑就是过的。
    2. **CocoaPods 的 `report_error` 自己也在同一处崩**（栈里
       `error_report.rb:105 markdown_podfile` → 又是 `installation_root`），
       所以**它本来要打印的那条真错误没了**。症状是"只看到栈，看不到事"。

    ✅ 修法：脚本入口显式 `export LANG=en_US.UTF-8` + `export LC_ALL=en_US.UTF-8`
    （`/tmp/heyta-g6-reinstall.sh` 顶部就这么写的，注释指向本条目）。

    📌 可迁移的一条：**凡是 `nohup`/`setsid`/CI 里跑的脚本，环境不等于你的交互 shell。**
    locale 只是其中一格（同族：§7 第 77 条 `sed` 在 C locale 下对中文的行为、
    以及"中文计数判据要先查 `LANG`"）。判据写法：**长脚本的每一步都要把自己的
    退出码打出来**（`CHAIN_EXIT=N(哪一步)`），否则第一现场只剩一个数字，
    人会先怀疑产品。

131. 🔴 **开关类判据必须两个方向各变异一次 —— 单向变异会测出"实现和缺陷恰好同向"。**

    `REQUIRE_EMAIL_VERIFICATION` 那组用例（`server/tests/self-host-email-verification.spec.ts`）
    第一次写变异说明时，我写的是"把判点改回 `config.testMode?.autoVerifyUsers`
    ⇒ 第 1 组两条红"。实测**不成立**：

    | 变异（都改同一个函数） | 实际红的用例 |
    |---|---|
    | 忽略开关、**永远不**验证 | 第 2 组两条 + 判点那条。🔴 **第 1 组两条照样绿** |
    | 忽略开关、**永远要**验证 | 第 1 组两条 + 判点那条 |
    | 发信失败时不说 `emailDelivered: false` | 恰好 2 红（第 2 组） |

    第 1 组的内容是"关掉开关 ⇒ 当场激活、一封都不发"。把判点改成"永远不发"之后，
    这条判据的**期望**被满足了 —— 只是满足它的原因是缺陷本身。也就是说
    **"行为对"的判据挡不住"永远如此"的实现**，除非同一组里还有一条反向判据
    （这里反向那半是第 2 组：信发不出去时必须说出来，而它恰好被第一个变异打红）。

    📌 两条一般规律：**① 一个布尔开关的判据，红/绿名单在两个方向上不重合，
    所以"变异一次全红"不等于"判据有牙齿"；② 写进文档的变异结论必须由变异产生，
    不能由推断产生** —— 本条目第一版那句推断就是错的，改在这里而不是悄悄删掉，
    是为了让下一个人知道"往一个方向变异"这件事本身是个陷阱。

132. 🔴 **对"没问过的路由"也许诺真值的桩，会造出**别人**的红 —— 而且红字指不到桩。**

    2026-10-03 同一轮里踩两次，两次症状都是"我的新功能打不开"：

    | 载体 | 桩的写法 | 真实症状 | 真因 |
    |---|---|---|---|
    | jsdom（`apps/web/tests/account-profile-entry.spec.tsx`） | `fetch` 一律回 `{displayName, avatarHash}` | 测试通过，但控制台一条 `Cannot read properties of undefined (reading 'total')` | 设置浮层里另一个会自己发请求的面板（运营后台）把这份返回值当成了合法 overview |
    | 真浏览器（静态产物 + 无头 Chromium 取证） | `/api/*` 一律 **200** `{}` | `SHEET=NOT-OPEN` / `PANEL=MISSING` + `pageerror` | `AdminPanel.tsx:211` 读 `overview.total` 抛异常 ⇒ React 把**整个设置浮层**卸掉 |

    第二次的红字完全指不到桩：看起来就是"点头像菜单里那项，浮层没开"。

    ✅ 修法（两处同一个形状）：**只回答本用例真的问过的路径，其余一律 404。**
    404 会让那个面板走"取不到 ⇒ 不渲染"这条它本来就有的分支，而不是
    "取到了一个形状不对的东西"。

    📌 一般规律：**桩的默认返回值就是它对未知请求的承诺。** 一个 catch-all 的
    `200 + {}` 等于对全仓库说"这些端点都存在、都返回空对象"，
    而任何一个把 2xx 当成功的面板都会立刻相信这句话。
    与 #46（没复现 ≠ 没执行）、#50（"状态对"在"没生效"时也绿）同族，
    区别是这次被污染的不是被测对象，是**同一个页面里的邻居**。

133. 🔴 **有一条按源码文本解析的界面判据：把 `view-tabs.ts` 里某一项改成多行对象，它会静默丢掉那一项。**

    `apps/landing/tests/mockup-shell-shape.spec.tsx` 不是 import `view-tabs.ts`，
    而是**读它的源码文本**去解析那组声明（它要钉的是"落地页复刻的 rail 与真实 rail 同一份声明"）。
    于是形状的改动会误报成语义的改动：R12 把四象限那条换成
    `{ key, labelKey, Icon: Move }` 并**在对象里写了多行注释** ⇒ 2 条红，
    而红字说的是"rail 少了一个 tab"，完全看不出是换行导致的解析失败。

    ✅ 修法：注释写在数组**外面**，数组里那一项保持单行对象。
    这条约束已经写进 `apps/web/src/features/shell/view-tabs.ts` 的注释里，
    因为它会咬每一个只想"顺手加个说明"的人。

    📌 一般规律：**按文本读的判据对格式的敏感度高于按 import 读的判据**，
    所以重构（换行、加注释、prettier 改风格）会先弄坏它，
    而它的报错总是指向"结构少了东西"这种语义解释。看到这类红，
    第一件事是 diff **形状**而不是 diff 语义。

134. 🔴 **`bodyLimit` 这类"限制型"判据必须两侧都测，且夹具要与生产同值 —— 否则一个错误的默认值会替它作证。**

    与 #131 同族（单向变异），但这里被顶替的不是期望，是**夹具的默认值**：
    头像路由带 `bodyLimit: 2 MiB`（防"头像占满请求体额度"），
    第一版判据只测"3 MiB 被拒 ⇒ 413"。把 `bodyLimit` 从路由选项**挪进 `config`**
    （= 静默失效，生产全局是 20 MB）之后，用例**照样绿** ——
    因为夹具是裸 `Fastify()`，它自己的默认 bodyLimit 是 **1 MiB**，
    恰好也把 3 MiB 挡住了。判据在替一个错误的默认值作证。

    ✅ 两处一起改才对：① 夹具 `Fastify({ bodyLimit: 20 * 1024 * 1024 })`，
    与 `src/server.ts:382` 同值；② 判据两侧都测 —— **1.5 MiB 必须 200**（证明 2 MiB 这道门真的开在那儿）、
    3 MiB 必须 413。改完之后"挪进 config"这条臂精确报红（红在 1.5 MiB 那一侧）。

    📌 一般规律：**任何"上限"判据都要有一条"上限之下必须放行"的同伴。**
    只测被拒的那一半，等于把断言交给"环境恰好也这么严"，
    而环境的严格程度不是你设计的东西。

135. 🔴 **验收栈是"三份产物"拼起来的：APK、服务端进程、数据库迁移。任何一份旧了，
    红都落在"产品缺陷"那一侧 —— 而三份都没有任何一处会自己说自己是旧的。**

    2026-10-03 实测（`verify-mobile-restore` 判据④ 报"服务端只命中 0/5 条备份 opId"）：

    | 件 | 当时的实际状态 | 怎么看出来的 |
    |---|---|---|
    | APK | 23:57 打的，`ExportScreen.tsx` 00:50 又改过 | 文件 mtime 对比；脚本第 0 步装的就是这个旧包 |
    | 服务端进程 | `node dist/src/index.js` 是 **18:56** 起的，dist 是 **00:53** 重建的 | 进程里没有 `/api/account/legal-consent`（curl → **404**），源码里有 |
    | 库 | `heyta_mobile_smoke` 少两条迁移 | 新 dist 起不来就报 `P2022: users.display_name does not exist`；**旧进程反而一切正常** |

    第三条最阴：**旧进程 + 未迁移的库** 是互相掩盖的 —— 旧 Prisma client 不选那一列，
    所以"服务端健康、建号成功、/health ok"全部为真；一旦换成当前 dist 重建的进程，
    同一条建号立刻 500。也就是说"我先手动验过服务端是好的"这句话**替旧产物作了证**。

    这次的实际症状是移动端的**账号级补签闸门（G-27）**：新 APK 里有闸门、旧服务端答不了
    那一问，`syncNow()` 一条 op 都不发，界面写着"数据没有同步出去"。判据读到的
    "0/5 命中"于是长得像"还原毒化了同步队列"，而真正的原因是栈自己的服务端旧了。

    ✅ 三件都改了：`sh scripts/migrate-deploy.sh`（带 macOS sed 垫片 + 显式 `DATABASE_URL`）、
    从当前 dist 在**自己的端口**上起重建的服务端（3100，不动别人占用的 3000），
    并在脚本第 1 步之前加一条**一次不带凭据的探测**：`GET /api/account/legal-consent`
    回 **401 = 路由存在**（继续）、**404 = 服务端比应用旧**（`exit 3`，并把重建命令打出来）。

    📌 可迁移的规律：**跨进程契约两侧都要有"同代"判据，且要在开局花 1 秒验，
    不要花 40 分钟之后靠症状反推。** 401 与 404 的差别就是"路由在不在"，
    它不需要任何凭据就能问出来 —— 便宜的探测该放在最前面。
    ⚠️ 另一条：`ps eww` 能读到**别的进程**的 `DATABASE_URL`，这很方便复用凭据，
    但口令因此进了我的 shell —— 只用变量、不打印，脚本里也别这么写。

136. 🔴 **"谁在前台"的探针把组件名截掉了，于是 `focus_is 包名` 恒假；
    而同一条红里紧挨着的诊断行用的是**另一种解析**，把真相原样打印了出来。**

    `grep -o "mCurrentFocus=Window{[^ ]* [^ ]*"` 取回的是 `Window{174b2bc u0` ——
    `Window{` 后面两段是**窗口 id 和 userId**，包名/组件在第三段。于是判据②
    报"系统选择器没开到前台（焦点里没有 documentsui）"，而它自己下一行印的是
    `mCurrentFocus=Window{ba41dfe u0 com.google.android.documentsui/...PickActivity}`。

    一条坏解析同时打死**三条各自看起来独立的红**：选择器"没开"（其实开着）、
    还原后"焦点没回到应用"（`focus_is $PKG` 同样恒假）、任务列表 0/3（没点到文件）。
    另一半是同一类：`hide_keyboard` 定义在第一次**调用之后**，bash 里就是
    `command not found`，而调用点写成 `hide_keyboard || echo "⚠️ 键盘没能收起"` ——
    探针自己没跑起来，却报成产品侧的一件事。

    ✅ `focus_is`/`current_focus` 现在共用同一支 `focus_line()`（整行 `grep "mCurrentFocus="`），
    helper 全部搬到第一次调用之前。

    📌 两条一般规律：**判据和它的诊断输出必须共用同一支取数函数** —— 分家之后
    "红灯说的话"和"红灯的判断"可以互相矛盾，而人只会信后面那句。
    **`cmd || echo 警告` 这种形状会把"探针不存在"洗成"产品有一件小毛病"**；
    bash 里函数定义顺序错误只有运行时才知道，所以 helper 要集中放在脚本开头。

137. 🔴 **"板高 ≥ 内容区高"在默认视口下是恒真的 —— 两个都由内容决定的量互相比，
    永远成立。撤掉那条 `flex: 1`，一个数字都不变。**

    R11 批一要验收"日历全高"。第一版判据写成
    `board.height >= .ht-content 的 rect.height − 上下 padding`（padding 从 computed style 读，
    不写死数字 —— 看起来是无懈可击的推导）。变异臂（把宿主层的 `flex: 1` 换成 `flex: 0 1 auto`）
    跑出来**全绿**，实测数字一模一样：

    | 视口 | 内容盒 | 板高 | 撤掉 flex:1 之后 |
    |---|---|---|---|
    | 1280×720 | 740 | 740 | **740 / 740**（一字不变） |
    | 1280×1200 | 1096 | 1096 | 1096 / **740** ⇒ 红 |

    根因：`.ht-content` **没有 `overflow`**，它的高度是被这块板撑出来的
    （720 的视口上它涨到 804，文档开始滚）。于是"板高 ≥ 内容盒"两边量的是同一件事。
    而产品负责人说的"只占一半"恰恰只会在**屏幕比内容高**时现形。

    第二层坑更隐蔽：那条"整月要看得全"我先拿**内容区底边**当参照 ——
    变异臂给每行 `minHeight: 200` 之后仍然全绿，因为卡片底边和内容底边
    **一起**掉出屏幕（1427 / 1780）。换成 `window.innerHeight` 才红得下来。

    ✅ 修法：全高那条**在 1280×1200 上量**（注释里写明为什么不能用默认视口），
    "看得全"那条的参照必须是视口；两条各配一支变异臂（A：撤宿主层 flex；D：行定高）。

    📌 一般规律：**布局判据的参照必须是一个不随被约束对象一起变的量。**
    两个都由内容决定的盒子互相比，得到的是一条"永远通过的判据"——
    元规则 2 说它比没有判据更糟，这里补一句它**长得很像一条推导正确的判据**
    （阈值确实是从 computed style 推的，不是写死的）。
    所以布局类判据的**第一步是先把约束撤掉跑一遍**，数字不动就说明参照选错了。

138. 🔴 **一条判据断错了不变量，结果照出了界面上一句假话 —— 修的时候两件事都要修，
    不能只把判据改绿。**

    `verify-mobile-restore` 判据④a 原来断"备份里的 opId 要出现在服务端"。真机跑出来是
    `0/5`，而同屏界面写着**「已是最新」+「上次成功同步 02:09」**。
    两者不可能同时对 —— 一定有一个在说谎。读**被调方本体**之后，说谎的是判据：

    · 还原走 `OpLogStore.appendImported` → `appendBatch(ops, 'import', …)`，
      而 `uploadStatus: source === 'local' ? 'pending' : 'uploaded'`
      （`packages/storage/src/db-op-log-store.ts:161`）⇒ 导入的 op **不进上传队列**；
    · 这是设计，不是疏漏：服务端 `validateOp` 对
      `op.clientId !== requestClientId` 逐条回 `INVALID_CLIENT_ID`
      （`server/src/sync/services/validation.service.ts:75`），
      而备份里的 op 带的是**原设备**的 clientId；
    · 所以"备份 opId 出现在服务端"在产品里**从来不成立** —— 一条因设计而必红的判据
      不是判据，它只是把设计说成了缺陷。

    🔴 **但同一次运行也照出了一个真缺陷**：成功语 `mobile.restore.done` 写的是
    "配置同步后会自动上行" —— 那句话**每个字都是假的**（数据不会上行，
    其他设备看不到这批还原的数据）。它是我这批写文案时**顺着"还原=恢复"的直觉**
    写的，没去读 `appendImported`。判据断错，反而把这句假话逼出来了。

    ✅ 两处一起改：① 判据④a 改断真正的不变量（同步**不落失败态、不卡死**：
    300s 内界面落到「已是最新 / 已全部上传」，出现「同步失败」或一直「正在同步…」才红），
    备份 opId 命中数**只打印不判定**（将来若改成"按本机 clientId 重签"，数字会变而判据不翻）；
    ② 文案改成说清边界（"这批数据只在这台设备上…之后你新写的照常同步"），中英同步，
    并把机制写进 `ExportScreen.tsx` 文件头与 `db-op-log-store` 那条注释互相指。

    📌 一般规律：**"判据红 + 界面说没事"这种组合，必须先判定谁在说谎再动手**，
    而判定只能靠读被调方本体（不是 grep 符号、不是读注释）。
    两边都有错的时候，**只修判据就等于把假文案留在了生产里**。

139. 🔴 **"点了入口"不等于"面板开了"**：`input tap` 会抛 Java 异常而退出码仍 0，
    而"随便找个输入框"这种匹配法会把**上一页**的搜索框当成面板的输入框。

    实测（判据④b）：点 FAB「新建任务」那一次 `adb shell input tap` 打出
    `InputManagerService.onShellCommand` 的异常栈，面板根本没弹；
    紧接着 `xy_edit_any` 命中了任务页的**搜索框**（desc「搜索任务（标题与备注）」），
    标题被打进搜索框，于是后面必然得到"找不到「添加」"——
    一条看起来像"新建流程坏了"的红，实际是**两次探针失误的叠加**。

    ✅ 两处都补：① 点完入口后**验面板自己的锚点**（`xy_desc "新任务标题"` 在不在），
    不在就重点，最多 3 次；② 打字之后**先读回再提交**（`edit_value`），
    读回不符就报"探针无法判定"，而不是报"没上传"。

    📌 一般规律：**每一步点击之后都要有一个"这一步真的发生了"的观测点**，
    而且那个观测点必须是**目标界面独有的**东西。
    "任意输入框 / 任意按钮"这类宽松匹配在跨界面时会静默命中上一页的同类控件，
    把"没打开"伪装成"打开了但没反应"。

140. 🔴 **给出境字段加一道"声明必须覆盖实际发出的键"的对照，它的价值不在拦住未来，
    在于照出已经漏了的现在 —— 它第一跑就抓出一个真的隐私泄漏。**

    多步循环要按"可达工具集的字段并集"做一次性披露，于是必须回答
    "每个工具**实际**送出哪些键"。做法是：从真 `runReadTool()` 的产物里收键，
    与目录声明的 `egressFields` 比子集。**第一次跑就红**：
    `list_tasks` 的列表项带着整块 `body`（备注正文）。

    两个要点：

    1. **修的是代码，不是判据。** 正确修法不是往声明里补一项 `task.body`，
       而是给列表加一条白名单投影（`projectListForTool`）—— 列表本来就不该给正文，
       详情工具 `get_task` 才给。补声明等于把泄漏写成契约。
    2. **同一条对照还顺带纠了一条测试**：`local-api/tests/server.spec.ts` 里
       原本断言"列表文本含『附上图表』"（即含正文），而它**与该工具自己的契约相反**。
       一条一直绿的断言可以是错的 —— 判据换层（从"断言 args"到"断言结果集"）
       才把它照出来。

    📌 一般规律：**"声明 ↔ 实现"型对照优先于"读代码确认过"**。
    读代码只能确认你**想到**的那些路径，而投影层漏掉的东西往往在
    "看起来只是顺手多带了一个字段"的位置上（对照 §3.4 的白名单重建那条纪律）。

141. 🔴 **浮层截图会同时踩两个坑：入场动画中途按快门，以及 `fullPage` 拍不进滚动容器。
    两个坑的症状都是"用例绿、图也在，但图不可读 / 图里没有被断言的东西"。**

    实测（对话助手那批，两张图各自坏法不同）：

    1. `.ht-sheet` 的 `background` 是 `color-mix(… 95%, transparent)`（**故意**让下层透出来），
       而入场动画 `ht-sheet-in` 把**整块**的 `opacity` 从 0 跑到 1。
       点完「设置」立刻截图 ⇒ 拍到过渡帧：下层以接近同等的浓度叠上来，
       读起来像"文字压文字的排版事故"。**人已看图，看的却是错的那张。**
       ✅ `e2e/tests/helpers.ts` 的 `waitForOverlaySettled()`：等**该元素自己的**
       `getAnimations()` 全部 `finished`（不是 `document.getAnimations()` —— 那会把
       页面上其它在跑的动画算进来，永远等不完）。`prefers-reduced-motion` 下
       `animation: none` ⇒ 集合为空、立刻返回，所以它不是"睡 300ms"的假等待。
       它与 #132 那条"几何判据隐含静止态"是同族，但症状不同：那条是**量错尺寸**，
       这条是**看错界面**。
    2. `fullPage: true` 扩的是**文档**高度，而设置浮层自带 `overflow-y: auto` ——
       于是"档位选择器"的判据全过，那张叫 `3-settings-tier.png` 的证据里
       **根本没有档位选择器**（只有浮层第一屏）。
       ✅ 截图前 `scrollIntoViewIfNeeded()`。
       📌 **断言过 ≠ 证据里有**：证据是给人看的那一张，不是那一条 `expect`。

    同批第三种坏法（记在这里免得再犯）：`screenshot({ path: '../../apps/web/…' })`
    这种**相对串**按 Playwright 自己的根解析，会落到仓库外 ——
    测试绿、日志说"已截图"、磁盘上什么都没有。路径一律
    `path.resolve(dirname(fileURLToPath(import.meta.url)), …)`。
142. 🔴 **变异电池和取证验收共用 `packages/*/dist` 与 `e2e/test-results/`：
    两趟叠在一起跑，验收读到的是**变异体**，于是产品被判红。**

    实测（R11 批一/二收尾）：七支变异臂的电池还在跑最后一臂（G = 把 `flexGrow`
    加回月历网格）时我起了"重拍证据图"那一趟。它加载的正是 G 臂刚 build 出来的
    `packages/ui/dist` —— 那条差分判据当场报
    `视口从 720 拉到 1200 之后这些星期行变高了（[44,44,44,44,44] → [69,69,69,69,69]）`，
    而**源码是干净的**（变异臂自己的 sha 对账全绿）。同时 `test-results/` 被两趟
    互相清空，四张证据图只剩两张。

    三个叠加点，每一个都会单独造成"看起来像产品坏了"：

    1. **构建产物**：变异改的是 `packages/ui/src`，但 `apps/web` 吃的是 `dist`。
       变异臂跑完会重建一次，所以**只有"另一趟正好卡在重建之前"**才中招 ——
       这让它比一般的 flaky 更难归因（重跑就好了）。
    2. **证据目录**：Playwright 每趟会清 `test-results/`（#124 同族），
       两趟并行 = 互相删对方的证据。
    3. **退出码**：读到变异体的那一趟是**真红**，所以任何"红了就重跑"的
       自愈逻辑都会把它当成产品回归写进结论。

    ✅ 纪律：**电池没跑完不起第二趟**。判据是"电池进程的退出码已经打出来了"，
       不是"看起来没在动"。要收证据图，先 `pnpm --filter @heyta/ui build`
       再**读一遍 dist 里的那一行**（`grep -o "weekRowBody: {[^}]*}" dist/index.js`）
       —— 产物 = 当前源码这件事也要取证，不能假设（#27 的同一形状）。

143. 🔴 **只给"字色 / 底色"这一对里的一个上 `transition`，主题切换的中间态必然掉到
    不可读 —— 而 §5 那条对比度测试结构上看不见它，因为它量的是稳态。**

    实测（页头那颗语言 chip，`getComputedStyle` + WCAG 公式逐帧量）：
    `.ht-chip` 有 `transition: background 150ms`，而 `color` 没有 ——
    切到暗色时 `color` 瞬切成近白（`#f1f5f9`），`background` 还从**亮色**的
    `--ht-color-primary-subtle`（`#eff6ff`）往暗色爬：

    | 时刻 | 底 | 对比度 |
    |---|---|---|
    | 稳态 | `#eff6ff` | 16.40:1 |
    | +0ms | 还是 `#eff6ff` | **1.01:1** |
    | +30ms | `rgb(153,164,183)` | 2.29:1 |
    | +60ms | `rgb(71,85,115)` | 6.79:1 |
    | +100ms | 落位 | 13.35:1 |

    也就是约 50ms 全程低于正文 AA。症状是"暗色截图里 chip 是一块没有字的白底" ——
    **人看了图，以为是对配色选错了**，实际稳态是合规的。

    ✅ 修法是把这条过渡**删掉**，不是"两个属性一起过渡"：端点各自合规，
    中点是两边各取一半，算出来仍约 1.5:1。成对变化的属性只要有一个被过渡就一定会穿过去。

    📌 两条一般规律：
    1. **稳态判据覆盖不到过渡态**。`pnpm --filter @heyta/design-system test` 算的是
       token 两两配对的对比度（那是它该算的），它既看不见组件里"只过渡一半"，
       也看不见 `color-mix(… 95%, transparent)` 这类合成态。要钉它得在**浏览器里**
       沿祖先链把半透明背景合成到不透明底上再算（见 `e2e/tests/theme-switch-contrast.spec.ts`）。
    2. **看图看到"读不出字"时，先分清是稳态还是过渡帧** —— 两者的修法完全不同，
       而截图本身不会告诉你是哪一种（这张图就是切换后立刻拍的）。
144. 🔴 **一条会失败、会归因、数字全对的布局判据，仍然可以是在证明错的决定 ——
    周视图那一行"吃剩余空间"就是这么被判据一路绿灯放进主分支的。**

    R11 批三第一版给周档那一行加了 `flexGrow: 1`，理由写得很顺：
    "月档的主体是清单，周档的主体是那一行"。判据是差分（视口 720 → 1200 行高必须变），
    实测 `行高 720=292 1200=772` —— **会红**（撤掉 `flexGrow` 就红）、
    **会归因**（红在那一条用例上）、**数字全对**。

    而把 `calendar-week-tall.png` 打开看：那是一根 **772px 的纯蓝立柱**。
    三件事叠出来的：① 行被拉到整屏；② 格子 `alignItems: stretch` 跟着填满；
    ③ 选中格是**实心主蓝**。空日历时屏幕上三分之一是一块蓝。
    判据一个字都没说错 —— 它说的是"行确实长高了"，而那正是**不该**发生的事。

    ✅ 撤回生长决定：两档共用同一条规则（剩余空间归"当天那一格"），
       并把那条差分**反过来写**（`Math.abs(tall - short) ≤ 1`）。
       变异臂 J 就是"把 `flexGrow` 加回去"，它现在必须红。

    📌 **一般规律（这是元规则 2 的第三种失效，前两种是"恒真"和"探针坏"）**：
       变异验证回答的是"这条判据会不会红"，**不回答"它红的时候产品是好是坏"**。
       布局类判据尤其危险：它断言的是"我实现的行为"，而实现本身可能是错的决定。
       所以布局判据旁边必须有一张**人看过的图**，且图上要能看出
       "这块空间到底归了谁" —— 本条那张图是在 1200 高的**空日历**上拍的，
       有数据时立柱被任务条填满，反而看不出来。

    同族：#137（参照与被约束对象同涨 ⇒ 恒真）、#82（"非空白"回答不了"是不是这个界面"）。
145. 🔴 **"阈值从常量推导"的判据，如果期望值和实际值读的是同一个常量，它就是恒真的 ——
    把那个常量改坏，判据跟着一起变，一个字都不会红。**

    实测（R11 批三，变异臂 H）：`MAX_WEEK_CALENDAR_BARS` 从 6 改回 3，
    而 e2e 那条写的是
    `seeded = 读源码得到的上限 + 2` ⇒ `expect(drawn).toBe(读源码得到的上限)` ——
    两边一起变成 3，**4 条判据全绿**。这条判据的立论本来是
    "周视图比月视图画得多，否则这一档白做"，而它把"多"这个信息
    完全交给了它所约束的那个常量。

    ✅ 补的那句才是有牙齿的：`expect(drawn).toBeGreaterThan(monthCap)`
       —— **跨两个常量的关系**，改坏任一个都会红。
       同一批另有一条纯函数判据 `MAX_WEEK_CALENDAR_BARS > MAX_CALENDAR_BARS`
       钉在共享层（`packages/ui/tests/calendar-cell-bars.spec.ts`）。

    📌 **判据"从常量推导"是对的（抄件一定会漂），但推导出来的必须是一个
       *关系*而不是一个*等式***：`x === f(x)` 恒真，`f(x) > g(x)` 才有内容。
       自检方法就一个：**把那个常量改坏，看判据红不红** ——
       这一条正是这么暴露的（第一版臂 H 存活）。

    同族：元规则 2（"一条永远通过的判据比没有判据更糟"）、#144
    （会红、会归因，仍然可能测的是错的决定）。

146. 🔴 **plumbing 提交后"刷真实索引"那一步，会覆盖别人在同一批路径上的暂存条目 ——
    而唯一能照出它的判据是自己写的那条"别人暂存条目数"。**

    共享工作树里用 `commit-tree` + `update-ref` 提交自己那批路径之后，标准收尾是
    `git update-index --add --cacheinfo <我的 blob>,<路径>` 逐文件刷真实索引
    （不刷的话 `git diff --cached` 会把我刚提交的内容显示成"待撤销"）。
    🔴 **但如果某个路径别人也暂存过（`MM`），这一步就是把他们的暂存条目换成我的 blob** ——
    他们的 `git add` 状态无声消失。工作树一个字节都没动，所以内容不丢，
    消失的只是"他们已经暂存"这个事实；他们下一次无 pathspec 的 `git commit`
    提交的就是**我的**版本，而屏幕上显示的仍是**他们的**文件列表。

    本轮实测：4 条路径（`package.json`、`pnpm-lock.yaml`、`BLOCKED.md`、`Podfile.lock`）
    被这样覆盖，信号只有 `别人暂存条目: 提交前=9 提交后=5 丢失=4` 这一行 ——
    也就是脚本里那条本来为了"别带走别人的东西"而写的守卫。

    ✅ **机制修法**：刷索引**之前**先 `git ls-files -s -- <我的路径>` 抓一份暂存前态，
    刷完逐条比对；对"别人已暂存"的路径**不刷**（代价只是我的文件在 `git status` 里
    继续显示 `MM`，那正是它该有的样子）。

    ✅ **复原配方**（本轮 4 条全部无损，判据各不同）：
    1. 我只加了整行的：`grep -v '<我那一行>' <工作树>` 就是他们暂存的内容。
       判据 = 与**旧** HEAD 的 numstat 恰好等于我记录在案的暂存 numstat（`2/0`）。
    2. 我的补丁可逆的：把**工作树副本** `patch -R` 反打我的补丁。
       判据 = 反打之后 `git diff`（索引→工作树）与我原来那份补丁**逐字相同**。
       ⚠️ 反打的基线必须是工作树 —— 打在旧 HEAD 上会撞 `Unreversed (or previously
       applied) patch detected!` 交互提示，非交互模式下它**自己回答 y 并产出垃圾**，
       本轮差点把那份垃圾 `hash-object` 进索引。
    3. 混在一起反推不出来的：`git fsck --unreachable` 按 numstat 签名匹配
       （判据 = 签名唯一命中，本轮 `11/303` 只有一枚）。
       ⚠️ 想省时间用 `head -c 400` 预筛内容会**假阴性** —— 长文件里靠后的标记全漏，
       本轮 `package.json` 的候选就是这么被筛没的；要么全文 grep，要么别筛。

    📌 一般规律：**"不带走别人的改动"和"不改动别人的暂存态"是两条独立的不变量**，
    第一条好判（提交内容里没有他们的行），第二条只有靠**动手前先把索引状态照一份相**。

    ⚠️ **这一条写完当天就又犯了一次**（下一笔提交 `9a0ea6d5`，重叠路径 `package.json` +
    `BLOCKED.md`）—— 因为修法当时只写进了这段文字，没写进脚本。现在它在
    `/tmp/heyta-commit.mjs` 里是**前置快照 + 提交后自动还原**（判据 = 打印
    `↩️ 已把 <路径> 的索引条目还原成别人暂存的那份`），不再依赖人记得。
    📌 元教训：**"写进文档的修法"等于没有修法** —— 一条修法只有在脚本里，
    才会在下一次被同一个人踩到时生效。

147. 🔴 **本机的 `dist/` 会把"生产者还没提交"掩护成 typecheck 全绿 —— 所以 `pnpm check`
    必须在**删掉所有 dist 的检出**里跑一次才算数。**

    机制：`packages/*/dist` 全部 gitignore，而 `apps/*` 解析 workspace 依赖走的是 dist 的
    `.d.ts`。于是"**消费者已提交、生产者在未提交的工作树里**"这个组合在本机**永远绿**
    —— 上一轮构建把生产者的产物留在了磁盘上，typecheck 读的就是那份。

    本轮实测：`OpLogEngine.getAllOps()` 写在工作树里，没跟着 `ExportScreen` 那笔提交走。
    干净检出报 `apps/mobile typecheck: ExportScreen.tsx(275,44): TS2339 Property 'getAllOps'
    does not exist on type 'OpLogEngine'`，而**同一时刻本机 typecheck 全绿**。
    （这是 §6.1.1 那条"打包输入由门禁隐式提供"的第 7 个实例。）

    ✅ 两层修法：
    1. 生产者的 hunk 与消费者的引用**同一笔提交**。本轮拆成两笔是补救，代价是历史里
       留下一笔已知红的检出（`771c35c9` 之前）—— 这个代价要写进提交信息，不是抹掉。
    2. 收尾批的 `pnpm check` 一律在 `git worktree add --detach` 的干净检出里跑，
       且**先 `rm -rf packages/*/dist apps/*/dist`**。⚠️ 只新建 worktree 不够：
       **复用**上一轮的 worktree 时旧 dist 还在原地，那就等于没测。

    同族：traps #27（旧 JS bundle 进 APK）、#135（验收栈三份产物不同代）、
    §6.1.1 元规则 3（"测试全绿 ≠ 这是当前产物"）。

148. 🔴 **`pnpm check` 的第一道门禁需要第二道门禁的产物 —— 干净检出上这条链必红在第一段。**

    `check:entries`（`apps/landing/scripts/gen-entries.mjs`）经 `src/site/pages.ts`
    import `@heyta/i18n/dist/provider.js`，而 dist 是 gitignore 的 ⇒ **没有构建过的检出**
    跑 `pnpm check` 直接 `ERR_MODULE_NOT_FOUND`，链断在第一段，后面 50 多道门禁
    **一道都没执行**。本机因为有 dist，这件事从来没有被看见。

    ✅ 修：把 `pnpm build` 挪到链首。A/B 实测（同一份干净检出、同一时刻）：
    改链前红在第一段（`ERR_MODULE_NOT_FOUND`），改链后同一条命令打印
    「入口文件与注册表一致（75 份）」并继续往下跑。

    📌 一般规律：**串行门禁链的第一段必须只依赖检出里就有的东西** —— 否则
    "链断在哪"这个诊断是**环境的函数**而不是仓库的函数，而 §7 元规则 1 说的
    "先怀疑探针"在这里连探针都还没开始量。

149. 🔴 **单跑 6/6 全绿、放进全量套件就红在"任务没建出来" —— 异步落库的判据不能等
    "我给了它两次 tick"，只能等"这条真的进库了"。**

    `apps/web/tests/calendar-capture.spec.tsx` 提交捕获后只 `await flush()`
    （两次 microtask + 一次 `setTimeout(0)`）。**单独跑这个文件 6/6 绿**；
    放进 `pnpm --filter @heyta/web test`（112 个 jsdom 环境、CPU 打满）就有 3 条红，
    消息是 `任务没建出来: expected undefined to be '评审材料'` ——
    读起来像产品坏了，实际是**判据在赌调度**。

    机制：`addTask` 是异步的（`dispatch` → op-log → store 订阅者）。写还没落地，
    下一个用例的 `beforeEach` 已经跑了 `__resetOpLogForTests()` 把模块级 engine 置空，
    于是那条在途续体抛 `op-log 引擎尚未初始化`（未处理拒绝），任务**永远不会**出现。
    ⚠️ 最误导的地方是归因方向：拒绝栈里那一行 `requireEngine src/lib/oplog.ts:387`
    指向的是**重置它的地方**，而红的是**等它的地方**。

    ✅ 修：等"这条写入的**唯一产出**出现了"再断言 ——
    `await waitSubmitted('评审材料')`（轮询 `lastTask()?.title`，超时 5s 并打印最后一条）。
    超时消息里带上"最后一条是什么"，否则下一次现形时又要重跑一遍才知道。

    📌 一般规律：**负载是判据的一部分**。凡"点一下 → 异步写库 → 断言库里有什么"，
    等待条件必须是那条写入的唯一产出（与 §7 #46/#50 同族）；固定 tick 的 `flush()`
    只适合同步渲染。同一个文件**单跑绿不构成"它不脆"**的证据 —— 只有全量套件算。

151. 🔴 **"干净检出复现不出提交态的 lock" —— 这条结论我差点入档，而它是我自己数错口径
    造出来的。** 计数类判据必须先写明"数的是哪一段、跟谁比"，并且**二次测量对得上**才算事实。

    收尾时实测 `pod install`（隔离检出 `9a0ea6d5`）后的第一组读数：
    `Podfile.lock` 与提交态差 **401 插入 / 1141 删除**，"PODS 条目 216（新）vs 228（提交态）"，
    同 CocoaPods 1.17.0、同 `PODFILE CHECKSUM` ⇒ 我据此写下结论
    **"提交态的 `Podfile.lock` 不是生成器对 HEAD 的输出"**，并准备把它登记成一条陷阱。

    复测两次（热跑 + `rm -rf Pods build` 冷跑）后，**结论被推翻**：

    | 口径 | 提交态 | `pod install` 复现态 |
    |---|---|---|
    | 按 PODS 段解析（`/^  - /` 且未越段） | **146** | **146** |
    | 全文件 `grep -c '^  - '`（PODS + DEPENDENCIES 两段混在一起） | 230 | 230 |
    | `git diff --numstat` | — | **2 插入 / 2 删除** |

    那 2 行是 `SPEC CHECKSUMS` 里的 `hermes-engine` 与 `ReactCodegen` —— 两个**由构建生成**的
    pod 的校验和，跨机器/跨构建态本就会变。`node scripts/check-native-deps.mjs` 在复现态上
    **绿**（5 个原生 pod 全部命中、版本一致）。也就是说提交态**是**可复现的。

    🔴 错在哪：那组 216/228 与 401/1141 **无法复现** —— 同一对文件用任何口径量都对不上它。
    唯一没被排除的差别是**跑生成器时构建产物在不在位**（第一次 `pod install` 跑在该检出的
    `pnpm -r build` 之前）。这条**尚未证实**，登记为待办而不是结论：
    要证它，得在一个只 `pnpm install`、不 `pnpm -r build` 的检出里跑 `pod install` 再比。

    📌 一般规律（与 §7 #86 同族，但方向相反）：#86 是"一条判据里藏两个缺陷"，
    这条是**一次性的、口径没钉死的读数被当成了结构性事实**。区别在于：代码里的判据会天天
    重跑、迟早暴露自己；而**只跑一次的手工读数没有任何一层会替它复核** ——
    所以它必须当场写明口径并留一份可复算的证据（本轮就是靠"再跑一次"才发现的，
    而那次再跑本来不打算做）。


    ⚠️ **编号更正与一次误带（2026-10-03 05:10 实测）**：本条最初登记成 `150`，而另一条会话
    在同一时刻把自己那条（"弹层放得下吗的边界情形"）也登记成 `150` —— 撞号。**本条让位为 151**
    （它更新、且我此刻能改自己这段）。
    🔴 更该记的是**根因**：我在写之前查过一次最大编号（当时量到 149），但构建提交 blob 用的是
    `sliceFrom(/^150\./)` **一直取到 EOF** —— 八分钟里对方把自己的条目追加到了我那条**后面**，
    于是对方那 23 行被我一并带进了 `263cebb6`。**内容没丢、没改**，但归属被我抢了。
    📌 一般规律：共享工作树里"取到文件末尾"这种边界，在并发写入下**必然**吞掉别人的追加 ——
    取自己的段要写**双边界**（起点 + 下一个不属于我的标题）。编号也一样：
    量的那一刻和写的那一刻之间，那个号可能已经不属于我了。
150. 🔴 **弹层"放得下吗"的边界情形，由它**上方有多少块面板**决定，不由弹层自己决定 ——
    所以放置判据必须断"每一格都在视口内"，不能断"某一格点得到"。**

    `e2e/tests/due-date-edit.spec.ts` 在 2026-10-02 交付时是绿的，2026-10-03 全量跑
    **确定性地**红：`element is outside of the viewport`，重试 113 次"scroll into view"全失败。
    没人改过 `DueEditor`。改的是它**上面**：对话助手那一屏在任务列表上方加了约 120px，
    行从 y≈380 掉到 y≈504，而放置判据是
    `openDown = rect.bottom + 500 < innerHeight || rect.top < 500` ——
    第二个 `||` 是"两头都放不下时仍然朝下开"（旧注释："宁低不遮列表头"）。
    跨过那条线的后果不是"难看"：面板 `position: fixed` 且**滚动即关**，
    视口外那三周（含 18 号）**用户也点不到** —— 他一滚列表，面板就关了。

    ✅ 两层修法：① 放置抽成纯函数，三种情形（下 / 上 / 两头都放不下）各一条判据，
    第三种从"宁低不遮"改成**夹进视口**；② 真浏览器那条断言从"这格点得到"改成
    "**每一格的日子都在视口内**"（越界的把 `aria-label` 与 y 一起打出来）。
    变异（把第三支改回旧写法）实测报出 **37 格**在视口外。

    📌 一般规律：**抽样断言在"边界由别人决定"的地方一定会漏** —— 今天漏 120px，
    明天漏一个 i18n 变长的面板。全量断言（"所有格子都在视口内"）不需要知道
    上方有多少东西，所以它**不会随别人的改动过期**。这与 #50（"状态对"在"没生效"时也绿）
    同族：判据要断在**用户能不能做到那件事**上，不是断在"我刚好试了那个位置"上。

    同族：#81（窗口取证三坑，"取不到"必须响亮失败）、#137（判据参照物不能与被约束对象同向变化）。

152. 🔴 **共享判决函数自己 exit ⇒ 全部调用点写的 `summary "X"; exit N` 里那句 `exit N` 是死代码
    —— "环境不成立"与"25 项跑完且通过"在输出上**逐字相同**。**一个函数打印判决，就不能同时决定进程存亡。**

症状（`/tmp/g5-restore-run25.log`，2026-10-03 05:44 实测）：`scripts/verify-mobile-restore.sh` 只跑了
**2 项**就打印「通过 2 项，失败 0 项 / ✅ 移动端备份还原：真机全链路通过」并以 **exit 0** 结束 ——
而它当时是在环境失效（`legal-consent` 404 + web 载体没起）的中止点上被撞过去的。

机制：`scripts/lib/mobile-e2e.sh` 的 `summary()` 末尾自己就有一句 `exit`。所以六个移动端验收脚本里
**16 处** `summary "X"; exit N` 的 `exit N永远不会执行（函数已经不返回了）；而 `summary` 内部
只看 `FAIL`：`FAIL=0` 就一律打印「✅ …真机全链路通过」并返回 0。于是
「前置不成立 → 中途放弃」和「全部判据跑完并通过」**共用同一句结论文本**，
被欺骗的不是某条断言，是**整个脚本的成败** —— 而 CI 和人都会照着 `exit 0` 记账（元规则 2 的最坏面目）。

✅ 修法 `447f9f64`：`summary <验收名> [结尾语] [退出码]` 收**第三个参数** = 这一轮应当以什么码结束
（`FAIL>0` 时 1 优先，"有失败项"永远盖过调用方想报的码），并按码打印**不同**判决行：
3 打「⏭ 本轮在环境上不成立（不是产品失败）」；1 且 `FAIL=0` 打「❌ 未跑完就中止」——
🔴 后一句里**不许出现**"通过"两个字，否则它又会和真通过撞成同一串。

判据 6 条（`/tmp/heyta-summary-probe.sh`：把 lib 里那段函数原文抠出来单测，不 source 整个 lib
以免碰到它的顶层副作用）+ **变异臂**（拿 `HEAD` 那版跑同一条自检 ⇒ 第一条就红；最小复现是
`${BT}summary "X" "" 3${BT}` 在旧函数下 exit 0 + 打印 ✅）+ **设备现场复现**
（`/tmp/g5-restore-run25b.log`：同一条环境失效，修后打印「⏭ …环境上不成立」并以 **EXIT=3** 结束）。

🔴 **它照出的另一半**（`8ecc0575`）：web 载体（`WEB_BASE`，那条判据的输入要从它导出）**不在开局前置里**，
于是没起它就一路跑到第 2 步才 `ERR_CONNECTION_REFUSED`，而第 0 步**已经把设备 `pm clear` 了** ——
白烧一轮，且红字读起来像产品坏了。规律：**开局要把全部外部依赖一次性探测完**；在改变被测对象状态
（清数据 / 装包 / 造并发）之后才发现环境不成立，损失的不只是时间，还有"这条红算谁的"的可判性。

📌 **一般规律**：判决的**打印**与进程的**退出**要分家 —— 共享函数要么只返回码、由调用点 exit，
要么必须**显式接收**"这轮该以什么码结束"。中止点的码靠"函数不返回"来隐式表达，等价于没有表达。
同族：#50（"状态对"在"没生效"时也绿）、#58（阈值要从被约束的常量推导）、#46（没复现 ≠ 路径没执行）。

153. 🔴 **三段式 props → 模型 → 视图 里，中间那条"转发"没有任何一层在判** ⇒ 新加的可选槽位
    会"模型全对、单测全绿、门禁 exit 0，而屏幕上什么都没变"。**加一档的正确收尾是消掉转发层，不是补测试。**

症状（2026-10-03 05:44，android 模拟器实测截图）：给共享 `EmptyState` 加 `size?: 'page' | 'section'`
一档（`c7f0e33a`），模型层判断、4 条新用例、`check:empty-state` exit 0、`@heyta/ui` 442 passed、
`apps/mobile` typecheck 0 + 538 passed —— **全绿**。真机上那行「还没有通行密钥」却被撑成
**居中 + 上方一大片空白**（也就是 `page` 档的样子）。

根因只有一行：组件里仍写
```tsx
const view = toEmptyStateViewModel({ icon, title, hint, detail, detailTone });
```
（逐字段挑着传）—— `size` 根本没进模型。而**这一层没有任何判据**：`packages/ui` 的测试跑在
**node**（不引 DOM 测试栈，理由写在 `vitest.config.ts` 文件头），所以"组件树渲染得对不对"
从来不在自动化覆盖范围内，唯一能判它的是实际渲染（§6.2 规定一）。

✅ 修法 `d25161ce` **不是补一条测试**，是把这条缝从设计上消掉：
```tsx
const view = toEmptyStateViewModel(props);   // 整包转发 ⇒ 以后加槽位不可能漏传
```
修后 `pnpm reinstall:all --only android` + 重跑 `verify-mobile-account`：13 项全绿 / exit 0，
截图里那行回到卡片左侧的一行小字（与改动前同形）。

📌 **一般规律**：**"新增一个可选输入"这类重构，判据要落在"这条输入到不了渲染层就没法被忽略"上**，
不是落在"我测了模型对"上。中间转发层一旦存在，它就必须在结构上不可漏（整包传），
否则要给它加一条"props 的键集合 == 模型入参的键集合"的判据 —— 二选一，**不许什么都不做**。
与 #145（"抽取的收尾动作是删掉旧的那份并加门禁，不是写一个更好的新版本"）同族：
都是"新实现正确"被当成了"旧缺陷已消除"。

154. 🔴 长活的隔离检出里 `pod install` 崩在 CocoaPods 的 "path name contains null byte" ——
    而 `pnpm install --frozen-lockfile` 打印 "Already up to date"。**"依赖树没问题"这句话
    不能由包管理器自己说。**

症状（2026-10-03 06:45，隔离检出 `/tmp/heyta-g5`，HEAD=`840effb1`）：
`bash scripts/reinstall-all.sh --only ios` 在 `pod install` 阶段崩，退出码 1：

```
ArgumentError - path name contains null byte
  cocoapods-1.17.0/lib/cocoapods/project.rb:452  Pathname#realdirpath   # base_path.realdirpath
  cocoapods-1.17.0/lib/cocoapods/project.rb:452  Pod::Project#group_for_path_in_group
  …/file_references_installer.rb:228             add_file_accessors_paths_to_pods_group
  … 崩在 "Generating Pods project"，前面 5 个 pod 全部 Installing 成功
```

### 三条臂，两条是假的"已排除"

| 臂 | 结果 | 当时能得出什么结论 |
|---|---|---|
| `rm -rf Pods` 后重装 | ❌ 同一处崩溃 | 不是沙盒残留 |
| `pnpm install --frozen-lockfile` | 打印 **Already up to date**（176 ms） | ⚠️ **我据此写下"节点树不是变量"—— 这句是错的** |
| `node scripts/check-native-deps.mjs` | ✅ 5 个 pod 全命中 | 不是 lock 与 package.json 不一致 |

真正把它分开的是 **A/B**：同一个 commit `840effb1` 现开新克隆（`git clone --no-hardlinks` +
`pnpm install`，热 store 下 **4.4–4.9 秒**），`pod install` **两次都 exit 0**
（一次放 `/Users/…/heyta-ios-ri`、一次放 `/tmp/heyta-ios-ab`）。
🔴 **路径不是变量**（`/tmp` 那一次也成功），变量是**这棵长活的树本身**。

📌 **一般规律（这条比 bug 本身值钱）**：`pnpm install --frozen-lockfile` 的
"Already up to date" 只拿 lockfile 和**它自己那份状态文件**比，**不扫树**。所以它既不能证明
树是好的，也不能作为"排除依赖树这个变量"的证据 —— 我当时正是拿它做的排除，结论写反了。
**判"这棵树可用"要用下游消费者能不能跑来判**（这里是 `pod install`），
或者干脆换一棵新的 —— 本仓库的克隆 + 安装只要 5 秒，**没有理由在旧树上重试**。

⚠️ **未证实的部分**（别照它行动）：具体是哪个路径让 Ruby 4.0.7 的 `realdirpath` 拿到 NUL，
没有定位到（要扫 `node_modules` 里 1.9 GB 的文件名）。已排除的只有：路径前缀、
`Pods/` 残留、lock 与 package.json 不一致、codegen 产物缺失（两边都**没有**
`build/generated/ios`）。上游对应 CocoaPods #12798 / #12866（都还 open）。

同族：#27（"测试全绿 ≠ 这是当前产物"）、#46（没复现 ≠ 路径没执行）、#146（索引说"已暂存"不等于
待提交的是新增）—— 都是**把工具自己的自检当成了外部真相**。

155. 🔴 **验收脚本自报的"设备 / 端口 / 路径"是手抄字面量时，它会替一台根本没跑过的机器说话。**

    `scripts/lib/mobile-e2e.sh` 里 `$ADB="adb -s ${HEYTA_E2E_SERIAL:-emulator-5554}"`（可覆盖），
    而 17 个 `verify-mobile-*.sh` 的横幅各自写死 `设备: emulator-5554`。本机在线的是 **5556**：
    脚本**驱动的是对的设备、打印的是另一台**。我据此差点把一轮 13/0 的验收判成"跑错机器"，
    还差点因此重跑一遍（`pgrep` + 读 lib 才发现真相）。这类行的症状是"日志与现场对不上"，
    而两边看起来都有理 —— 最后信错的一边会毁掉整轮取证。

    ✅ 修法：值的**唯一住处**是 lib 里的 `$E2E_SERIAL`（`$ADB` 由它拼），横幅打印 `$E2E_SERIAL`。
    判据两栏都验：不带 env ⇒ `默认=[emulator-5554]`，带 ⇒ `覆盖=[emulator-5556]`；
    再 in-situ 跑一次真验收，看横幅真报 5556（`通过 13 项，失败 0 项` 那一轮就是它）。

    📌 **同一条规律的第二种面目**（同一轮踩到）：我数"还有几处硬编码"时读了一份被 `head -10`
    截断的 grep 输出，把 **16** 写成 9 并印进了提交信息。截断样本不是计数 ——
    要计数就用 `git grep -l … HEAD | wc -l`（且明确比的是 HEAD 还是工作树）。

156. 🔴 **提交器只碰索引、不碰工作树 ⇒ 提交态永久领先磁盘态；下一个整文件写的人会把你的段落从历史上抹掉。**

    共享台账（`BLOCKED.md` / `environment-traps.md` / goal 文档）的归属纪律要求"不带走并行会话的 hunk"，
    于是 blob 从 `git show HEAD:<file>` 出发拼、`commit-tree` 落 commit、**磁盘那份原样不动**。
    实测三份文件的落差（2026-10-03 07:30 现量）：`BLOCKED.md` HEAD 2277 行（到 B27）vs 磁盘 2259 行（到 B24）；goal 文档差 27 行；索引里那份 `BLOCKED.md` 只有 1508 行。

    🔴 **它不是"文件不好看"，是会丢内容**：并行会话拿磁盘那份继续写，然后整文件 `git add` + commit
    —— git 只比"磁盘 vs 索引"，看不出它在回退 HEAD，于是我的 B25–B27 从历史上消失，**且不会有任何报错**。
    这跟 #146（暂存条目被别人的 `update-index` 换掉）是同一族：**"我的提交是对的"不等于"我的内容活着"**。

    ✅ 修法：提交完把**同一段纯追加回磁盘**（判据：磁盘里没这段才追加 ⇒ 幂等），
    并给"追加后磁盘段落计数 +1"留一行打印。台账类文件的收尾动作有两个，不是"落 commit"一个。

157. 🔴 **gitignored 的配置把测试依赖长期遮住 ⇒ "开发机上全绿"被当成"这条链是绿的"，而 CI 的唯一形态是干净检出。**

    `pnpm -r test` 在**干净检出**上必红：4 个 server spec 在加载期抛
    `JWT_SECRET environment variable is required`（`src/auth.ts:48` 的 `getJwtSecret()` 跑在**模块顶层**），
    而开发机上有 `server/.env` 兜着（`server/.gitignore:5` 忽略它）—— 所以主工作树**永远量不到**这条红。
    我第一轮就把它记成"取证环境缺配置，不是产品红"，**那句定性是错的**：
    链在干净检出上必红就是链的缺陷，"我这台机器是绿的"不构成排除证据。

    ✅ 修法不是给 CI 造一份 `.env`，而是**跟上仓库自己已有的约定**：需要令牌的 spec 各自用
    `vi.hoisted(() => { process.env.JWT_SECRET ??= '<测试密钥>' })` 在 import 之前放好
    （`password-recovery` / `magic-link-registration` / `replace-token-expiry` 早就这么写）。
    这 4 个文件只是没跟上。用 `??=` 而不是 `=`：自己显式设过值的 spec 不被覆盖。

    🔴 **两个必须一起做的动作，否则这条修法没有牙齿**：
    1. **在干净检出上量**（本机就是 `/tmp` 那棵 detached 克隆）：4 文件 43 条 `rc=0`，
       整段 `pnpm -r test` 从红变 **exit 0**（server 107 文件 / 2048 passed）；
    2. **变异**：把其中一个文件退回提交态（没有那个块）再跑 ⇒ **1 failed**、报回原错。
       没有第 2 步，"补了个 fixture"和"补了个装饰"在输出上长得一样。

    📌 一般规律：**凡是"只在开发机成立"的输入（gitignored env、本机 hosts、已启动的服务、
    装好的全局 CLI），它遮住的缺陷在 CI 上会以"加载期就红"的形态现形** —— 归因时先问
    "这条结论是在哪种形态的树上量的"，再问"另一种形态上量过没有"。没量过就不许写"环境没问题"。


    🔴 **2026-10-03 09:38 同类缺陷长出第 5 个成员**：`server/tests/account-profile.spec.ts`
    （`7e299118`，账号资料那条线）拿测试密钥用的是 `import 'dotenv/config'` —— 开发机上有效，
    干净检出上整个文件在加载期抛，症状是 `Test Files 1 failed` + **`Tests no tests`**
    （27 条一条都没跑）。✅ 改回同一条约定（`vi.hoisted` + `??=`，`a2d0d634`）。
    两件上一轮没量过的事现在量了：
    1. **"跟别的 spec 同跑会不会蹭到环境变量"：不会。** 与 `auth-cache.spec.ts`（它对
       `JWT_SECRET` 是**直接赋值**）同跑、与 `account-locale.spec.ts`（`??=` 约定）同跑，
       都仍然 1 failed ⇒ vitest 每个文件独立 worker，**放置块必须是每个文件自己的**，
       "上一条 spec 顺手把它设好了"这条逃生路线不存在。
    2. 🔴 **约定本身没有门禁，所以"补了 4 个文件"补的是成员，不是产生成员的机制。**
       已补 `server/tests/test-env-contract.spec.ts`（挂在既有的 `pnpm -r test` 段里，不新起一段）：
       读者必须自带放置块、任何 spec 都不许靠 `dotenv` 拿测试输入、外加一条分母断言
       （防止"0 违规"其实是"0 被看见"）。三条变异臂：造"读了没放"的文件 ⇒ 恰好判据 2 红并点名；
       造 `import 'dotenv/config'` 的文件 ⇒ 恰好判据 3 红并点名；只在注释里提那句 import 的文件
       ⇒ **不红**。⚠️ 最后那条臂是要紧的：匹配前必须 `stripComments`，而
       `account-profile.spec.ts` 现在正把那句 import 写在注释里解释它为什么被换掉 ——
       不剥注释的写法会把"我不用它"判成"我在用它"，红一个根本没犯的文件
       （和 `check:l4` 纯 grep 101 vs 门禁 98 是同一个来源）。
158. 🔴 **共享工作树上量到的门禁红，不能直接写成"提交坏了" —— 必须再做两问才允许归因。**
    2026-10-03 08:4x 实测：`pnpm check:docs` 在 `0acc7a71` 的工作树上 exit 1（2 处失效章节引用 +
    7 处"本机有仓库里没有"的链接），第一反应是"仓库多了第 4 段红"。**两条现量把它推回去**：

    1. **活树侧 vs 提交侧**：`git show HEAD:docs/plans/README.md | sed -n '110p'` 打出来是**空行**，
       `git show HEAD:docs/plans/goal-layout-audit.md | sed -n '80,81p'` 是另一段内容 ⇒
       报出来的那些链接行**只活在未提交的工作树里**（同一族：`git diff <提交> -- <路径>` 量的是"那枚提交 vs 此刻的活树"，
       不是两棵提交树）。
    2. **另一种树形态上复量**：`cd /tmp/heyta-ios-ab`（detached `57b0780f` 的干净克隆）
       `node research/tools/docs-link-check.mjs` ⇒ **exit 0** 并打印"✅ 无死链、无'本机有仓库里没有'的链接"。
       同一批对象、没有那些未跟踪文档、没有那些未提交的链接行。

    ⇒ 真实形状是「一条线的链接改动还没提交，它指向的文档也还没 `git add`」——门禁按设计在**提交前**
    把它照出来，这是它在工作，不是仓库坏了。**把它写成"HEAD 坏了"会引出三个无效动作**：
    去 `git add` 别人的未跟踪文档、去删别人刚写的链接、或者去放宽门禁。

    📌 一般规律：**"红段集合"是活树上的瞬时读数，不是提交属性。** 引用它必须带
    **HEAD sha + 时刻 + 树的形态（活树 / 干净检出）**；而"红段的成员会变"这件事本身，
    恰好是 §7.4 那种"两轮集合逐字相同 ⇒ 我这批没引入新红"的论证所**依赖**的前提 ——
    它证明的是"没碰那些文件"，不证明"仓库当时只有这几段红"。

    🔴 **十分钟后同一条门禁命中了我自己**（这一半才是这条目真正要教的东西）：B29 里
    "关闭判据"那行为了说明别人写错了，打了 `docs/adr/README.md` 紧跟 `§1` ——
    **转述坏引用的句子自己成了一处坏引用**。判据是
    `SECTION_REF_RE = /([A-Za-z0-9_./-]+\.md)`?\s*§\s*(\d+(?:\.\d+)*)/`，
    也就是 `.md` 与 `§N` 之间只允许**可选的一对反引号加空白**。干净检出复跑 `d86f0439` ⇒
    `BLOCKED.md:2352 -> docs/adr/README.md ⇒ §1`、exit 1，而 B29 上面那句"HEAD 是干净的"同时变假话。

    ⇒ 两条动作：**转述坏引用时把 `.md` 和 `§N` 隔开**（写作"`docs/adr/README.md` 的那个章节号
    （它写作 §1，实际不存在）"就安全）；**写完立刻在干净检出上复跑同一条命令** ——
    上一秒量到的 exit 0 不担保下一句写完还是 0。同族：门禁命中它自己的夹具，
    以及"把症状原文抄进台账 = 复制一个症状"（#156 那一族 —— 写下的字会被工具再消费一次）。

    🔴 **第一次修补又犯了同一件事**：更正段里我把门禁的报告整句抄进台账，而那一行本身就带着
    `.md` 与 `§1` 的邻接 ⇒ 一次"修一处"变成**三处**（BLOCKED / goal §7.7 / 本条各一；
    干净检出从 `d86f0439` 的 1 处红变成 `81054ba1` 的 3 处红）。
    ⇒ 抄门禁原文之前先拿它的判据量一遍。这一版把邻接打断成 `README.md ⇒ §1`，并把验证搬到
    **提交前**：把候选 blob 拷进干净检出复跑 `docs-link-check` 取 `PRE_EXIT=0`，再提交。
    "提交后再撞"的代价是每撞一次就要再写一段更正，而那段更正本身又是新的输入。

159. 🔴 **`/tmp` 是这台机器上所有会话共用的临时场地，会在你写完引用之后被扫走 —— 落在长文档里的取证引用必须是仓库内的东西。**
    2026-10-03 08:5x 现量：`docs/plans/goal-multi-end-coverage.md` 共引用 **32 条** `/tmp` 路径，
    **16 条已经不在了**（其中 3 条是花括号写法被正则截断成的前缀，用 glob 复核后
    `/tmp/rr-*` 仍有 12 枚、`/tmp/heyta-reinstall-*` 仍有 17 枚、而 **`/tmp/g5-ri-*` 整族 0 枚匹配**）。
    同一台机器上，四小时前的验收日志随叫随到，四小时前的**另一批**日志一片不剩 ——
    清扫的条件不是"旧"，是别人的清理脚本正好按名字模式扫过。

    🔴 **真正的代价不是丢文件，是文档里的句子变成不可证**：下一位读者看到
    「run27：通过 26 项 / 失败 0 项（`/tmp/g5-restore-run27.log`）」时，
    **分不清**"这轮没跑过"和"跑过但日志被扫了"——这两种情况在磁盘上长得一模一样。
    而 `ls` 报"No such file"时人很容易顺手改成"未验证"，把一次真实跑过的证据降级成缺口。

    **修法（写证据的那一刻就做，不要留到事后补救）**：
    1. 需要长期引用的读数，**当场落一份摘要进仓库**（本仓库的约定位置是
       `apps/mobile/evidence/*.txt`，已有 `android-release.txt`、`reinstall-*.txt` 两族先例）。
       摘要只要 20 行：完整命令行 + `HEAD` + 每条 `✅/❌` 判据行 + 通过/失败计数 + 变异三段 sha256 + 两枚 APK md5。
    2. `/tmp` 路径可以留在摘要里当"当场读数出处"，但**不许**当唯一引用。
    3. 引用带时刻与轮次名（`run23` / `08:26–08:35`），并写清"这是哪一趟"，
       因为同一份脚本在不同趟里的执行数本来就会变（见 #158）。

    📌 一般规律：**指针的有效期等于它所住场地的清理策略，而不是文档的寿命。**
    共享工作树里 `git status` 会变、内容哈希会漂（#155/#156 同族）、`/tmp` 会被扫 ——
    凡是"把证据放在别人的领地里"的引用，都要在写下的那一刻复制回自己的领地。

160. 🔴 **给"历史读数"当载体的生成器，不许读实时状态** —— 它会指着另一棵树说"我验的是这棵"。
    2026-10-03 09:16 实测：把变异臂的读数复制进仓库时，生成器里写的是
    `git rev-parse HEAD`（在**验证用的那枚隔离检出**上执行）。M2 臂验的是 `bb1eba75`，
    而摘要生成的那一刻 M1 链已经把**同一枚检出**推进到 `731618ec` ⇒ 摘要落盘的那一行
    把 M2 记成"验了一棵从没验过的树"。数字全对（sha256 三段、两枚 APK md5、23/2 与 26/0），
    只有"这是哪一棵树"是错的 —— 而这正是取证里最不能错的那一项。

    **为什么会写成实时读取**：链跑完到摘要落盘之间通常隔几分钟，人（和我）默认"检出还在那儿"。
    但隔离检出是**可复用的载体**，下一条链会立刻推进它；同一条链里前后两臂共用一枚检出更是常态。

    **修法（两条都要）**：
    1. 被验提交**只从链日志取**（本仓库的链在 S1 打一行 `HEAD=<sha>`），生成器读那一行；
    2. 取不到就抛错，**不许回退到实时 `rev-parse`** —— 回退分支就是让错误结论出厂的那扇门。

    📌 一般规律：**任何"事后补写"的证据，它的每个字段都要标明取自哪一份产物**。
    与 #159（/tmp 会被扫）、#155（自报设备号是手抄字面量）同一族：
    证据的有效期取决于它住在哪里、以及写它的那一刻读的是什么。

161. 🔴 **`lunar-typescript` 的闰月月序是负数（闰五月 = `-5`）。把它当非负数打包，
    `& 0xf` 会得到 11 —— 于是"闰五月"变成"闰十一月"，而且农历生日、春节、中秋会一起错位。**

    批次一 W1 实测：生成器第一版写 `packed = (bits << 4) | (leapMonth & 0xf)`，
    对 2009 年（闰五月）存进去的是 `11`。判据照出来的症状不是"某年差一天"，
    是**公告对账一次报 10 条不一致**（那年之后的端午/中秋全体平移约半年）。

    ✅ 正确形状：`const leap = leapMonth ? Math.abs(leapMonth.getMonth()) : 0`，
    并且**编码前先断言 `0 ≤ leap ≤ 12`**。`getMonth()` 的符号是它的编码约定，
    不是可以从文档里读出来的东西 —— 读它的 `LunarMonth.mjs` 才知道。

    📌 一般规律：**把外部库的整数直接塞进自己的位打包之前，先问一句"这个字段可能为负吗"**。
    位运算不会报错，它只会安静地给出另一个合法-looking 的值。

162. 🔴 **`vitest` 全绿不等于 `pnpm -r build` 绿。** tsup 的 **dts 阶段**按
    `noUncheckedIndexedAccess` 检查，而测试根本不跑那道检查 —— 本轮实测
    `packages/domain/src/lunar.ts` 报 `TS18048: 'packed' is possibly 'undefined'`，
    同一次改动里 65 条单测一条不落全过。

    而这件事**不只是"构建会红"**：`undefined >> 4` 得到的是 **NaN，不是异常**，
    `String(undefined)` 得到的是字符串 `"undefined"`。也就是说裸下标在运行时
    产出的坏值长得像正常值 —— `正月初一 = 2016-NaN-NaN`、`清明 = 2016-04-undefined`。
    表被截断（生成物与代码不同步）时**没有任何一层会报错**。

    ✅ 形状：随包查表代码一律经过一个**会响亮失败的读取函数**（本轮是
    `packedOfYear(year, which)` 与 `qingming()` 里的显式 `undefined` 判），
    而不是在调用点写 `TABLE[i]!`。非空断言只是把红从编译期挪到运行时，
    而这条挪过去的代价就是 NaN。

    📌 与本文件第 27/28 条同族（"测试绿 ≠ 产物对"），但触发点不同：那两条是
    **打包输入是旧产物**，这一条是**类型检查器在两条路径上严苛度不一样**。
    所以本仓库的验证顺序必须是 `pnpm -r build && pnpm -r typecheck && pnpm -r test`，
    少跑前两条就等于没验过。

163. 🔴 **判据脚本里数"失败用例条数"必须先 `NO_COLOR=1`。** vitest 的失败行不是
    `     × 用例名`，而是 `^[[31m     ^[[31m× 用例名^[[31m` —— **ANSI 转义序列占在行首**，
    于是 `^[[:space:]]+×` 恒 0 命中。

    症状是最坏的那种：变异确实红了（`rc=1`），而脚本打印"本次失败用例 0 条"。
    读的人会把它理解成"红了但不是测试红的"，进而怀疑整轮变异验证。
    本轮实测：同一份变异，加 `NO_COLOR=1` 前 5 个臂全打印 0，之后打印 3/1/4/1/4。

    ✅ 两种稳的数法：① 关颜色再数；② 不数标记，直接解析 vitest 的汇总行
    `Tests  3 failed | 11 passed (14)`（本轮用的是 ①+②）。
    📌 与第 45 条（管道后 `$?` 是 `tail` 的）同一形状：**判据读的是被格式化过的
    输出流，而不是它以为自己读的东西**。凡是拿正则数测试输出的脚本，都要问一句
    "关掉颜色还数得到吗"。

164. 🔴 **后台任务通知里的 `exit code 0` 是包装命令的，不是被测命令的。**
    本轮 `pnpm -r build > log 2>&1; echo "BUILD_EXIT=$?"; tail -5 log` 作为后台任务跑，
    通知打印 `completed (exit code 0)` —— 那是 `tail` 的退出码。
    而 `BUILD_EXIT=1` 老老实实写在日志里（`packages/domain` 的 dts 失败，
    见第 138 条），`pnpm -r build` 从那之后**再没往下走**：`packages/op-log` 根本没被构建，
    于是 `pnpm -r typecheck` 又在 `sync-client` 上报三条 `Cannot find module '../../op-log/dist'`
    —— 一个真错误派生出两个假错误，而两个假错误看起来都"跟我的改动无关"。

    ✅ 动作：**读日志里的显式退出码行**（`^BUILD=` / `^TYPECHECK=`），不读通知的 exit code；
    长命令里每个被测步骤都要 `cmd > log 2>&1; echo "NAME=$?" >> log` 这种自记退出码的形状。
    📌 第 45 条的第二种面目：**"看起来绿"来自观测点的选择，不是来自事实。**

165. 🔴 **变异验收里"这条红在复跑里变回绿了"是一句需要配对的断言，而配对有三种类都会静默错配 ——
    错配出来的摘要读起来完整、可信，且没有任何一层会失败。**

    设备级变异臂的收口要说清"变异腿红的这两条，复跑腿里对应的那条绿是不是同一条判据"。
    我先写了两种省事的做法，都被现量证伪（同一轮 M2 臂）：

    1. **核心词配对**（取红句前 4 字去绿句里找）。红句 `找不到「粘贴备份内容（JSON）」输入框`
       与绿句 `粘贴这条路也有入口（输入框在，不点它）` 是脚本里 `if/else` 两支的**两种措辞**，
       共享字面为零 ⇒ 找不到，而"找不到"打印成"要人工核对"就过去了。
    2. **"bad 附近最近的一条 ok"**（不分分支）。M2 的红 `没看到还原成功确认`（530 行）被配到
       `成功语说清了边界`（525 行）—— 那是**上一条判据**的 ok，它自己带一个 `if scroll_to_sub …; then ok; else bad; fi`。
       于是摘要会说"复跑里已变绿"，而它核对的是另一条判据：**这条红其实从未被验证过能变绿**。
    3. **逐字匹配 bad 原文**。带现量变量/数字的文案（`bad "任务列表只见 $SEEN/3 条"`）在输出里是代入后的
       `任务列表只见 0/3 条`，逐字比 ⇒ "脚本里没有这条 bad 原文"，被误报成**输出与代码不同代**。

    ✅ 修法（改在摘要生成器里；它是一次性脚本，不进仓库 —— 要核对的读数与配对行号都在
    `apps/mobile/evidence/verify-mobile-restore-arms-20261003.txt`，见第 #159 条"长文档只引用仓库内的东西"）：
    配对按**分支结构**取 —— bad 在 `else` 分支 ⇒ 回到它自己的 `if`（途中遇 `fi` 计数，把嵌套的
    `if/…/fi` 整块跳掉），取该 `if` 的 then 分支里第一条 `ok`；bad 在一行式 `if … ; then bad …` 的 then 位置
    ⇒ 取随后 `else` 分支里第一条 `ok`。文案两边先**归一化**（`$VAR` 与数字都洗成空格、连续空白并一）再比。
    并把 `bad @行号 → ok @行号` 打进摘要 —— 配对本身要**可复核**，不能只给结论。
    同一条 bad 文案在脚本里出现多处时（347 是"入口判据"、579 是"步骤 6 重新进导出页"）
    **全部列出**，不假装知道本轮 fired 的是哪一处；要知道就看日志顺序：579 那条排在"截断文件"判据之后。

    📌 一般规律：**任何"A 变成了 B"式的断言，A 与 B 之间需要一个配对来源，而那个来源本身就是判据。**
    用启发式（距离最近、前缀相同、逐字相等）替代结构（分支、锚点、显式 ID）时，失败的样子不是报错，
    而是**产出一句完整的错话** —— 比空缺危险得多（元规则 2：一条永远通过的判据比没有判据更糟；
    这里是它的变体：一条"永远能配上对"的配对函数）。
    与第 #160 条同族：给历史读数当载体的生成器，字段要从**结构**取，不能从"看起来像"取。

166. 🔴 **从邮件正文里取链接的正则写到 `token=…` 就停，把发信时写进去的 `&lang=` 截掉了 ——
    探针于是导航到一个"没有任何用户会打开的 URL"，而它产出的错误读数被写成了"这不是缺陷"。**

    `e2e/password-web/password-journey.spec.ts` 取验证链接的正则是
    `/verify-email\?token=[0-9a-f]+`。服务端 `email.ts` 的 `withLocale()` 明确会把语言写进链接
    （`…&lang=zh-CN`），所以**收件人点的那条**与**探针点的那条**不是同一个 URL。
    少了 `lang=` 之后，页面语言落到 `Accept-Language`，而 Playwright 的 `Desktop Chrome`
    设备带 `locale: 'en-US'` ⇒ 确认页整页英文。

    代价不是那张英文截图，是**由它导出的一句结论**：`docs/plans/email-password-auth.md`
    的截图复核表里写着「✅ 排除，不是缺陷：…英文是设计行为」。一句"探针产物"被当成了
    "产品行为"，还带了一条自证理由（引用了当时确实存在的 `Accept-Language` 档）——
    读的人没有任何办法从那句话里看出链接被截过。

    ✅ 修法两层，缺一不可：
    1. 正则取**整条**链接：`…token=[0-9a-f]+(?:&[^\s"'\\]*)?`（`scripts/verify-email-web-chain.mjs:551`
       一直是这个形状 —— 同一件事的三个探针里，只有它带参数，另两个都截了；抄最近的那个之前先比一比）。
    2. 把"链路的参数没丢"本身变成判据：`链里的 lang= == 界面 documentElement.lang`
       且 `确认页的 <html lang> == 界面语言`。这样即使将来有人在别处又截一次参数，
       红的是那条断言，不是一张需要人眼去发现的截图。

    📌 一般规律：**从产物里"抽取"一个 URL/令牌/标识时，抽取表达式定义的就是被测对象。**
    收紧正则去匹配"我预期它长什么样"，等于把不符合预期的那部分**静默删掉**，
    而探针会拿着删剩的东西继续跑并判绿。凡抽取都问一句：**用户点的是不是这一条？**
    另一半教训：**"看图发现异常"之后写下的"排除"，取证门槛和"发现缺陷"一样高** ——
    它要指名"我复现的是用户的哪一次操作"，说不出就把异常登记成待查而不是判成正常
    （元规则 1：先怀疑探针；这里探针没坏在报错上，坏在**安静地换了被测对象**）。

167. 🔴 **改一条共享不变量时，"我改了哪几个文件"不是判据的枚举依据 —— "还有谁引用了这个输入"才是。**

    `ce23d3ab`（10-03 10:16）把 `Accept-Language` 从服务端语言解析里摘掉，提交信息写着
    「判据（**三条**反向断言，各做过一次变异）」并列了三个文件。那三个它确实改了，
    也确实各变异过 —— 但引用同一个输入的判据有**四**份：
    `server/tests/password-reset-page.spec.ts:74` 还写着「缺 token 时按 Accept-Language
    出英文那一句」（那文件 10-01 18:45 就落了，`b87e8844`）。于是 `pnpm check` 的
    最后一段 `pnpm -r test` 在 **main 上、对所有机器形态**都是红的。

    🔴 这个形状最贵的地方是**它自带反证**：三份都翻过来了，"我扫过语言判据"这件事在提交信息里、
    在 diff 里、在变异读数里都成立 —— 只有第四份不在场，而**没有任何一层会报错**。
    一句写成数字的"三条"，读者既没法复核也没法拿去对账。

    ✅ 补上（`c1395bf8`），并且给反向断言配了同页的阳性对照：
    - 反向：`Accept-Language: en` + 无 `?lang=` ⇒ 中文页，且那句英文**不许出现**；
    - 阳性对照：同一张页 `?lang=en` ⇒ 仍然切英文。
    两次变异方向相反、互不掩盖（都在隔离检出里跑）：把 `acceptLanguage` 分支加回
    `resolveLocale` 并让 `localeOf` 传那个头 ⇒ **恰好反向那条红**，阳性对照与其余 22 条不动；
    让 `resolveLocale` 忽略显式参数 ⇒ **恰好阳性对照红**，反向那条不动。
    只有反向断言时，第二个变异会让整套判据**看起来更好**（"英文整个死了"也不会红）——
    这是 §7 元规则 2 的又一副面目：**反向断言必须配一条同页的阳性对照，否则它挡的是旧缺陷回来，
    不挡新功能被摘掉。**

    📌 一般规律：清扫要**按"谁引用了这个输入"枚举**（grep 被摘掉的那个**输入名**本身，
    逐条判它断的是哪个方向），再和"这次动过的文件"做差集 —— 差集非空就是漏项，
    而漏项的默认表现是链上某一段从此常红。把这类数字写进提交信息时，
    写"扫过 N 处引用（列全）"而不是"改了 N 份判据"。

168. 🔴 **等负载的循环里，解析 `vm.loadavg` 的那一步自己坏了，而且坏了 15 轮没人发现；
    守卫本身也是探针，也要先喂阳性对照。**（2026-10-03 实测）
    `sysctl -n vm.loadavg | tr -d '{} ' | cut -d' ' -f1` 看着只是"剥花括号取第一个数"，
    但 **`tr -d ' '` 把分隔符连同三个值一起粘成一个非法整数**（`65.9440.2735`），
    于是 `[ "${L%.*}" -lt 14 ]` **每轮都报 `integer expression expected`、条件恒假、循环恒睡**。
    症状是"窗口永远不清"，真相是**判据从来没比较成功过** —— 恒假的等待条件比没有条件更糟，
    因为它看起来还在等。同一条里连错两次解析：先以为 `awk '{print $1}'` 是对的
    （`vm.loadavg` 输出带花括号，`$1` 就是那个 `{`），后又在 zsh 下用
    `case "$L" in *[!0-9.]*` 做"值可不可信"的守卫，结果它把合法的 `48.05` 判成坏值、
    闸门第一轮就自己关掉。
    🔴 更根本的一条：**这仓库早就有现成的等法** —— `scripts/verify-mobile-restore.sh` 里的
    `wait_for_quiet_host`：`uptime | sed 's/.*load averages: //' | awk '{print int($1)}'`，
    阈值 = **核数 × 3/4**（本机 16 核 ⇒ 12），每 30s 重试，等满 900s 就
    "❌ 本轮不跑（**环境无效，不是产品失败**）" 并 `exit 3`。
    手写等待循环 = 把别人已经踩平的坑重新踩三遍。
    ~~**待办：把它抽进 `scripts/lib/`**（现在是某一个脚本的私有函数，第二个想用的时候就又是一份抄件
    —— 同族教训见 `mobile-e2e.sh` 文件头）。~~
    ✅ **这条待办已过期（2026-10-04 00:5x 现量撤回）**：单一所有者已经存在 ——
    `scripts/lib/wait-for-quiet-host.sh` 提供 `wait_for_quiet_host()`，`grep -rl` 现量有
    **7 个**验收脚本 source 它（`verify-mobile-{notes,repeat,window-gate,trash,restore,due-time}` 与
    `mutate-closeout-gates.sh`）。**待办不撤回 = 下一个人还会去做一遍**；
    台账里的**状态句**也是断言，保质期取决于别人什么时候补上它（同 `BLOCKED.md` 的 B63 同族）。
    顺手扫法：`grep -n '待办' docs/reference/environment-traps.md` 逐条问"现在做了没"。

169. 🔴 **"下一步就是卸载/删除"的脚本，选目标不许靠默认值或 `head -1`。**（2026-10-03 实测）
    `scripts/reinstall-all.sh` 的 ios 段原来这样选设备：先按 `IOS_DEVICE_NAME`（默认
    "iPhone 17 Pro"）在 `simctl list devices | grep Booted` 里找，**找不到就退化成
    `grep Booted | head -1`** —— 而它的下一句是 `simctl uninstall`。
    本机实测同时有三台 Booted：`heyta-iphone-17pro` / `iPhone Duo heyta` /
    `SSOS-Duo-Fresh`，默认名一台都不匹配（真名是连字符小写）⇒ **每次**都走盲选，
    撞上哪台卸哪台，其中一台是**另一个项目**的。
    ✅ 修法：只有一台 Booted 时才认它（打 ⚠️ 说明用的是唯一候选）；多于一台且名字不匹配
    ⇒ 响亮失败，把候选**一行一个**打出来并给出 `IOS_DEVICE_NAME` 的准确填法。
    ⚠️ 候选不许写成 `printf '%s | ' $BOOTED` —— 未加引号的展开会按空格拆词，
    把 "iPhone Duo heyta" 打成三个"候选"，照它填 `IOS_DEVICE_NAME` 永远匹配不上。
    判据：从脚本里**原样抽出**选设备逻辑 + 桩 `xcrun` 跑四种现场 = 7/7
    （含"名字匹配时选中正确那台"的阳性对照，证明不是把判据改成恒不匹配）。

    同一件事在 **android 端**还有第二种面目，而且比 ios 那种更阴 —— 它**不靠默认值也不靠 `head -1`，
    靠一个"看起来是我的"串口**（2026-10-04 00:0x 实测，取证在 `BLOCKED.md` B62 第三份）：
    `scripts/reinstall-all.sh:270` 的 `SERIAL=${HEYTA_E2E_SERIAL:-emulator-5554}` 后面接的是
    `adb uninstall` + `pm clear`，串口对上了就动手。而**串口相同不等于设备相同**：
    `emulator-5554` 是"第一个起来的模拟器"占的号，本机它当时挂的是并行会话的私有 AVD
    `heyta-w3-yearly`。于是四条产物判据**全绿**、负载闸门**全绿**，读数是拿别人的设备量出来的，
    动作也打在别人的设备上（把对方正在跑的验收现场清了）。
    ⇒ 选目标这一步必须**把串口解析到 AVD 名再断言所有权**，三条现量命令：
    `adb devices -l`、`ps -eo pid=,command= | grep -o '\-avd [^ ]*'`、
    `stat -f '%SB' ~/.android/avd/<name>.avd`（创建时刻能区分"我这轮建的"与"别人两小时前建的"）。

    🔴 还有**反向**的那一面，也是本节原来没写的：**这台机器上的设备指针是共享的，
    我"新启一台"就是在改写别人脚本的读数**。对端的 ios 段是
    `grep Booted | head -1` 的盲选回退（`verify-mobile-ios-reminder.sh:74-79`，
    它的默认设备名在本机不存在 ⇒ 每次都会走盲选）。我只要多 boot 一台，Booted 清单的排序就变，
    **他们的验收会静默换一台设备继续跑，并且一句报错都不打**。
    这比"我这边没装上"贵得多 —— 我的失败是显性的，他们被换掉的读数是隐性的。
    ⇒ 所以"起个模拟器来绕过占用"不是逃生门，而是一种共享资源写入；
    要么先拿到那台设备的所有者同意，要么这一端按**环境无效 exit 3** 如实收工。

170. 🔴 **窗口截图当"界面画没画"的载体，会同时产出假红和假绿 —— 该换的是载体，不是阈值。**
    （2026-10-03 实测，macOS 安装包 §6.1.1 判据）
    假红：窗口截图 13 KB / 内容 0.0% ⇒ 🔴 疑似空白，而**同一秒**的 WebView 快照是完整真界面
    （主蓝命中 1269，人已看过）。假绿：09-30 三趟窗口图 205/206/272 KB、内容 ~100% 被放行，
    而那三张主蓝是 4/17/0 —— 拍到的是壳自己的暗底 + 一行诊断文字。
    被验方自己的代码早就写明了（`HeytaMacApp.swift` 的 `captureAndExit` 注释：
    "**WebView 的内容没合成进窗口**是这台机器上的**常态**"，并规定两份产物各证一件事），
    但判据只搬走了对自己方便的那半句（主蓝数快照、非空白仍数窗口）——
    **同一条规定被拆成两半就是矛盾的来源。**
    ✅ 修法：有 WebView 快照时，"非空白/主蓝/糊"全部压在快照上；窗口图只留
    "含不含透明像素"这条真窗口判据，窗口内容比例作为**观测值**打印、不据此判红；
    没有快照时才退回窗口图当载体。
    📌 一般规律：判据报错时先问"它量的这个载体**能不能**回答这个问题"。
    换载体后必须**双向**变异（真产物⇒绿 / 把快照换成空白图⇒红 / 无快照且窗口空白⇒红），
    且变异要跑**从活文件里原样抽出**的判据 —— 手抄的那份绿不证明活的这份绿。
    ⚠️ 抽取的边界坑：`awk '/^fn\(\) \{/,/^\}/'` 会在函数体里那行以 `}` 开头的 JS
    （`}).catch(...)`）处提前截断，得到一份连语法都不通的"判据"。

171. 🔴 **构建产物里的中文有第二种（第三种）字形：Hermes 字节码存的是 UTF-16LE，
    `grep` 恒 0 长得和"没做"一模一样。**（2026-10-03 实测）
    设备上**已装**的 `assets/index.android.bundle` 与 iOS 已装 `main.jsbundle`
    头 8 字节 = `c61fbc03c103191f`（hbc magic）⇒ 它们是 Hermes 字节码不是 JS 文本。
    同一枚中文串在整份文件里的命中：按 UTF-8 = **0**，按 `\uXXXX`（大小写两种）= **0**，
    按 `Buffer.from('每年','utf16le')` = **1**。
    我当时用 utf8 读整份文件，据此写下"装的包里没有本批代码"—— **那是探针读不懂这个格式，
    不是产品没做**；反证就在同一趟输出里（连一定在的 `收集箱` 都是 0），只是没先看对照就下了结论。
    📌 一般规律：① 探产物前先按**头几个字节**判断格式；② 第一枚 needle 选 **ASCII 标识**
    （`FREQ=YEARLY` / 预设 id / 具名常量），它不受字形影响；③ 要断 CJK 就
    UTF-8 + UTF-16LE + `\uXXXX` 三种各量一次，且**同一趟**必须有一枚"一定在里面"的阳性对照；
    ④ 对照也是 0 时，先修探针再修结论 —— 宣布"产物里没有 X"之前，这句话的载体是探针。

172. 🔴 **手势的 `pointermove` / `pointerup` 挂在宿主上 ⇒ "轻轻拖有用、用力拖没反应"，
    而 jsdom 测不出这一层。**（2026-10-03 实测，日历日档横拖换天）
    起手挂在宿主没问题，移动/抬手也挂宿主的话：**指针一旦拖出宿主子树**（横拖 800px 的终点
    落在侧栏里），那些事件从侧栏往上冒泡，永远到不了宿主。症状不是崩、不是报错，
    是**幅度大了反而失灵** —— 这种形状很难从日志认出来。
    ❌ 不要用 `setPointerCapture` 修：它会抢走 react-native-web 自己的指针处理，
    并改变后续 `click` 的目标（本仓的 RN-web 已经因为吞 keydown 记过 §7 #80）。
    ✅ 修法是**起手挂宿主、移动/抬手/取消挂 `window`**，卸载时两边都摘。
    📌 **jsdom 抓不到这个**：测试里 `dispatchEvent` 是在宿主自己身上起的，
    不走"宿主 → 宿主之外 → 冒泡"那条被断掉的路 —— 挂回宿主，那条用例照样绿。
    判据必须**显式让抬手落在宿主之外**（`endOn = document.body`）才有牙齿；
    变异臂 W（两行监听挂回宿主）⇒ 恰好 1 红，这是它不是恒过的唯一证据。
    同族：任何"起手在 A、抬手可能出 A"的交互（拖拽排序、滑块、框选），
    第一版都先问一句"抬手落在宿主外时事件走哪条路"。

173. 🔴 **`pnpm reinstall:all -- --only mac` 里的 `--` 会原样传给脚本**，
    脚本按"未知参数"退 2 —— 而**这条红会被读成"mac 段又失败了"**。（2026-10-03 实测）
    `reinstall-all.sh` 的参数校验是逐字匹配，收到字面量 `--` 直接
    `未知参数：--` 退出，**四端一段都没跑**。我据此又"重试了一次 mac"，
    实际重试的是同一条被 `--` 挡掉的命令。
    ✅ 正确调用：`bash scripts/reinstall-all.sh --only mac`（或 `pnpm reinstall:all --only mac`，
    本仓 `pnpm run` 不吞 `--only`）。
    📌 一般规律：**编排脚本的"未知参数"必须打在它自己那一行的开头**，
    并且**在退出前把收到的完整 argv 原样打印** —— 否则"我没跑"和"跑了但失败"
    在输出里长得一样。看到失败先确认**这条命令到底进没进第一段**。

174. 🔴 **"远端字节 == 本地工作树"的对账如果只哈希两三个文件，它证明的是那两三个文件。**
    （2026-10-03 实测，`reinstall:all` 的 Windows 段）
    `sync_windows_sources()` 的新鲜度对账算的是 `apps/web/dist/index.html` 与
    `native-bridge.js` 的 sha256 —— 两边一致 ⇒ 放行打包。而远端那次构建报
    `CS0103 未能找到名称"WebDistDirectory"`，而**本地工作树 grep 该标识符 0 命中**
    ⇒ 报错的输入不是我这轮送出去的那份源码（是另一处 C# 在飞）。
    对账全绿，构建红。这不是对账坏了，是**它的覆盖面就是那两个文件**。
    📌 一般规律：内容对账的强度 = 它哈希的**文件集合**，不是"有没有对账"这件事。
    跨机构建前要么哈希**整棵送出去的树**（tar 的 sha），要么在文档里写明
    "这条对账只保证 X 与 Y，不保证构建输入"。
    ⚠️ 反向也要防：**"某个远端文件的大小与本地相同"不构成"远端 == 本地"** ——
    这次的定位是靠 `grep` 那个标识符在本地 0 命中（红点不在我送出去的那份脚本里），
    不是靠 size 比对。

175. 🔴 **对"内容哈希命名的构建产物目录"做覆盖式解包 = 只增不减**，而只锚入口文件的哈希
    对账挡不住它。（2026-10-03 实测，Windows 打包机）
    `scripts/lib/sync-windows-sources.sh` 故意**不删远端目录**（那棵树里有 node_modules 与
    dotnet 依赖，整棵重建 = 把"打包"变成"重装工具链"），只对 `apps/web/dist/index.html`
    做 sha256 对账。可是 vite 的 chunk 名带内容哈希、**每次构建都是新文件名、旧的没人删** ⇒
    远端 `apps/web/dist/assets/` 实测躺着 **26 个 `index-*.js`**（本地只有 7 个），
    mtime 跨 9/27 → 10/3 六次构建。而 `package-msix.ps1` 是
    `Remove-Item web-dist` + `Copy-Item $webSrc -Recurse` —— **整份搬进包** ⇒
    装出来的 Windows 包里带着 ~19 枚没人引用的旧构建产物。
    今天行为没坏（`index.html` 按哈希引用当前那枚），坏的是语义：
    **"清旧包"这一环在 Windows 段只到 .appx 层，没到同步源层** —— 一旦有什么按旧哈希去取
    （缓存的 HTML、手工改过的入口、回滚脚本），包里**真躺着**那份旧代码，而且它不会报错。
    ✅ 修法（两处，缺一不可）：解包前先 `Remove-Item -Recurse -Force C:\src\heyta\apps\web\dist`
    （构建产物目录删了必再生，比 node_modules 安全得多），再加一条**按数量**的对账：
    本地与远端 `assets/*.js` 枚数必须相等，**数不到也算红**（数不到 = 对账不成立，不是"没问题"）。
    📌 一般规律：入口文件的哈希只证明"入口是新的"，不证明"目录里没留旧的"。
    凡是**产物文件名带内容哈希**的目录，同步语义只有"先清再解"或"按集合对账"两种是对的，
    "覆盖式解包"是第三种、且是错的那一种。
    🔗 与 #174 同族但**不是同一件事**：那条讲的是这条对账的**覆盖面**只有两三个文件
    （构建红在别的输入上）；本条讲的是**被它覆盖的那个目录本身**在只增不减 ——
    两边哈希一致也可以成立，因为远端多出来的那些旧 chunk 本地根本没有对应文件名可对。

176. 🔴 **桩在函数外面预取的值，会让用例在到达被测判据之前就返回 —— 于是"PASS"是假的。**
    （2026-10-03 实测，测的就是上一条那条新加的对账）
    验证脚本先把 `index.html` 与 `native-bridge.js` 的 sha256 算好存进变量，再喂给桩 `ssh`。
    但被测函数**自己会先跑 `build-native-bridge.mjs` 重写那个 bundle** ⇒ 到对账那一步时
    预取的哈希已经过期，三趟用例全部在**桥哈希**处返回 1，根本没走到新的 chunk 数判据。
    结果：**两条本该是红的用例"PASS"了，而它们红的原因和被测判据无关** ——
    如果只看 PASS/FAIL 汇总，我会宣布"新判据已验证"。
    ✅ 揭穿它的不是运气，是那条**探针调用计数**：桩里对 `Measure-Object).Count` 的调用次数
    断言为 3（三趟各一次），实量 **0** ⇒ 整批读数当场作废。修法是哈希**在桩里现算**
    （`shasum … | awk`），不要在外面快照。
    📌 一般规律：给"多步函数"打桩时，①每条用例都要断言它**走到了**被测那一判据
    （调用计数 / 独有的输出串），②桩回的东西如果是**会被函数自己改写的产物**，必须现取；
    ③"用例返回 1"不等于"判据抓到了违规"，**要读它红在哪一行**。

177. 🔴 **取证复制脚本里"`md5` 失败 ⇒ 判不相等 ⇒ 走复制分支 ⇒ 无条件打印已刷新"** ——
    一条把"没做成"打成"做成了"的三行 shell。（2026-10-03 实测，日历日档证据）
    形状：`a=$(md5 -q "$src"); b=$(md5 -q "$dst"); [ "$a" != "$b" ] && cp "$src" "$dst"; echo 已刷新`。
    `$src` 不存在时 `md5 -q` 打到 stderr 并**留空** `$a` ⇒ 空串 ≠ 目标哈希 ⇒ 分支成立 ⇒
    `cp` 失败 ⇒ 而 `echo` 在分支外面**照样打印成功**。我据此以为五张图"已刷新为最后一趟绿跑的产物"，
    实际那张图**根本没被读出来**。
    真正的根因在上一层：**Playwright 每次运行会清空 `test-results/`**（§7 #142），
    所以我先跑 `calendar-day` 拿到五张图、复制进 `apps/web/evidence/`，
    再跑第二个套件（`calendar-dida` / `-sidebar` / `-wheel` / `-capture`）时
    `test-results/` 里那五张**已经被删了** —— 探针跑第二次就把第一次的现场清了。
    ✅ 两条一起才成立：① 复制要**前置存在性检查 + 后置 `cmp -s`**，
    失败要 `exit 1` 而不是打印；② 证据**必须当场从 `test-results/` 收进受版本控制的目录**，
    不能指望它活到下一次运行（本仓六个 config 共用同一个默认 outputDir）。
    📌 一般规律：**动作的"成功"文案不能由"进了这个分支"来打印** ——
    它要么由动作自己的退出码打印，要么由事后核对打印；两者都没有时，
    输出里那句 ✅ 就是这条脚本最贵的一处假绿。

191. 🔴 **挂在"文件名枚举"上的门禁，会在目标文件被删时安静地不执行 —— 而且它照样打印
    「✅ 写只出现在确认函数里」，那句恰好是描述被删掉的代码的反话。**

    `scripts/check-ai-tools.mjs` 的规则 1/2 遍历 `listWatchedFiles()`（`ai-tool-*.ts`），
    而规则 2 的全部逻辑写在 `if (name === RUN_FILE)` 里。把 `ai-tool-run.ts` **整个删掉**，
    那个分支一次都不执行；"扫描面为空"那道闸要的是 `files.length === 0` —— 也就是
    **三个 `ai-tool-*` 全没**才响，少一个不算。

    实测（载体 `a9e032ac`；**同一份现场**喂两版门禁，假根 `HEYTA_CHECK_ROOT`）：

    | 门禁版本 | 助手入口文件被删之后 |
    |---|---|
    | HEAD 那版（7 条规则） | **rc=0**，输出 `✅ … 写只出现在确认函数里 …`；只有覆盖数 `ai-tool-* 2 个文件 / 规则 6 扫描范围 40 个 .ts` 泄漏了真相 |
    | 补上规则 9 之后 | rc=1，`清单上的写入口没了：packages/app-host/src/ai-tool-run.ts` |

    ✅ 修法是一条**与枚举方向相反**的判据：不是"扫到的文件里不许有 X"，而是
    "必须恰好扫到这几枚"——被检查的集合本身要有一条等值判据（多一枚红、少一枚红、
    扫描根为空也红）。三条腿各有变异臂（8/9/10），读数在
    [`docs/plans/ai-event-tool-contract.md`](../plans/ai-event-tool-contract.md) §15.19。
    ⚠️ 那两列覆盖数（"扫到 2 个文件"）是唯一会自己说话的线索 ——
    所以**枚举型门禁要把扫描面打印出来**，光打印"通过"挡不住空集。
    📌 一般规律：**"遍历集合 + 对每个元素断言"的门禁，防的是"元素坏了"，防不住"元素没了"**；
    而元素消失往往正是最需要响的那种改动（入口被搬走 = 那条不变量没人守了）。
    同族：#168（解析器自己坏了 15 轮）、AGENTS §7 元规则 1「先怀疑探针」。

192. 🔴 **"不该命中"的对照组和"该命中"的对照组共用同一个坏解析层时，前者会**假过**——
    自检里那两条 PASS 就是这么骗过我的。**

    写"等别人跑完"的进程闸门时（`/tmp/heyta-decisive.sh --selftest`），四条样本各配一个方向：
    名字带本仓前缀 ⇒ 该算、vite 且 cwd 在仓内 ⇒ 该算、vite 但 cwd 在别的工程 ⇒ 不该算、
    普通进程 ⇒ 不该算。第一次跑出来是 **两条 FAIL + 两条 PASS**，我差点把"两条 PASS"读成
    "归属过滤有牙"。真实情况是**四条样本全都拿到了空 argv**：

    1. 假进程用 `X=$(start_fake …)` 起 —— 命令替换的子 shell 一退出，里面的后台任务就没了
       （`pgrep` 查不到）。⇒ 取 pid 的下一步取到空。
    2. `pid=${line%% *}` 作用在 `ps -eo pid=,command=` 上：pid 列是**右对齐补空格**的，
       行首是空格 ⇒ `${line%% *}` 得到空串 ⇒ `lsof -p ""` 报错 ⇒ 归属判据整条静默失效。
    3. 更要紧的是判断顺序：`line_is_peer` 拿到空 argv 时返回"不命中"，
       于是"期望不命中"那两条**必然成立**。它们不是证据，是同义反复。

    ✅ 三条一起才修好：① 假进程在**本 shell** 里起（`&` 直接放函数体末尾，别套 `$()`）；
    ② `ps` 之后先 `sed 's/^ */'` 再切 pid；③ **自检里每条样本先断言输入非空**
    （`[ -z "$c" ] && FAIL "argv 取空：这是解析层坏了，别让空串蒙成 no"`）——
    也就是给对照组再加一层"探针真的跑起来了"的对照。
    📌 一般规律：**反方向的样本必须先证"它能被证伪"**。一条"不该命中"的判据，
    如果它在输入为空时也返回"不命中"，那它对**任何**输入都返回"不命中" ——
    它没有方向，只有形状。与 #45/#163/#168 同族（管道的退出码、ANSI 计数、自己写的解析器），
    但与它们不同的是：**这次假过伪装成"自检通过"，而自检本来是用来防假过的**。

193. 🔴 **子进程"退出 0"不等于"它核对了"。判据脚本的入口守卫拿 `import.meta.url`（已过
    realpath）逐字比 `process.argv[1]`，路径里任何一段软链都会让它**零输出、空跑、退出 0**。**

    2026-10-03 实测。`check:ai-tools` 规则 7 用 `spawnSync(node, [生成器, '--check'])`
    然后**只看 `status !== 0`**。在一次故障注入里它打印"能力清单与上游一致 ✅"，
    而那次核对**根本没发生**。同一棵树、同一份文件，只换路径拼法：

    | 拼法 | 输出 | 退出码 |
    |---|---|---|
    | `node /tmp/…/scripts/gen-ai-capability-manifest.mjs --check` | **零字节** | **0** |
    | `node /private/tmp/…/scripts/gen-ai-capability-manifest.mjs --check` | 报「读不到 dist」 | 1 |

    机制：`import.meta.url` 是 **realpath 之后**的 URL，`pathToFileURL(argv[1])` 保留
    调用者拼的形状；`/tmp → /private/tmp` 是软链，故障注入假根里那些"指向真脚本的
    symlink"同理 ⇒ `invokedDirectly === false` ⇒ main 块整个不执行。
    ⚠️ 还有第二种同形空跑，别只修一种：门禁的 `ROOT` 可被 `HEYTA_CHECK_ROOT` 注入，
    而生成器自己的 `ROOT` 取自**它自己文件的位置** ⇒ 注入假根时"核对"发生在假根之外（跨根）。

    ✅ 修两层，缺一不可：① 生成器比较前先 `realpathSync(process.argv[1])`；
    ② 门禁判绿**认它说了什么**（结论行「与上游一致」在不在），不只认退出码 ——
    并把"上游还没构建"与"清单漂移"分开报（它们的修复动作是**相反**的：前者该跑 build，
    后者产物并没有错却被支去重新生成）。判绿只认退出码这件事在这批里已经是第二次
    （#164 后台任务通知的 `exit code 0` 是包装命令的）。

    📌 连带后果（比原缺陷更贵）：**凡是把真脚本 symlink 进假根的注入臂，都可能在
    "以为在测规则 A"的同时让规则 B 静默空跑**，而"期望整体 rc=0"的阳性对照臂正是踩在
    这种空跑上通过的。⇒ 重建那批臂时要把**无关规则显式中性化**（桩打印结论、退出 0），
    不能靠它们碰巧不响。本条的现量复跑：
    `node ~/scratch-heyta/mutate-rule7.mjs`（5 臂）与 `node ~/scratch-heyta/mutate-rule89.mjs`（10 臂）。
    ⚠️ 臂脚本放 `~` 下而不是 `/tmp`：21:32 那次重启把 `/private/tmp` 整个清掉，
    载体 worktree 与上一版臂**连同它"当时通过=10"的可复现性**一起没了 —— 读数留在台账里，
    脚本没了就等于下一次只能重新怀疑。
194. 🔴 **RNW 把样式对象编译成 class，不写内联 `style` —— jsdom 里 `el.style.backgroundColor` 恒为 `''`。**
    用它当"有没有画出来"的判据，会得到一次**看起来像四个真缺陷**的空读数。（2026-10-03 实测，W1 选中高亮）
    形状：`TaskRow` 的 `rowActive`（`backgroundColor: tokens['color.primary-subtle']`）落到 DOM 是
    `class="css-view-… r-backgroundColor-o5e8d5 r-borderRadius-1xfd6ze"`，`getAttribute('style')` 是 `null`。
    四条"选中那条应该有底色"的用例（列表 / 四象限 / 时间线 / 泳道）同时报"expected '' not to be ''"，
    而接线**完全正确** —— 差的是载体，不是产品（§7 元规则 1：探针够不着与没发生长得一样）。
    实测对照：一次性探针里 `cssText` 为空、`getComputedStyle(el).backgroundColor` 回 `rgb(239, 246, 255)`，
    未选中的行回 `rgba(0, 0, 0, 0)`（**不是空串** —— 拿 `''` 当"没底色"的期望值会两头错）。
    ⚠️ 别把它推广成"jsdom 里读不到内联样式"：**运行时算出来的**内联值照样能读，
    本文件的日历/时间线几何判据用的就是 `style.left`（`"23.4%"`）。分界线是
    **`StyleSheet.create` 那批静态样式 → class；渲染期算出来的 style 对象 → 内联**。
    📌 一般规律：**视觉属性判据在 jsdom 里走 `getComputedStyle`**；写这类判据前先用一次性探针
    打印一次 DOM，别把"载体不认"实现成"产品坏了"。

195. 🔴 **共享层的"默认值等于原值的可选 prop"会把"宿主没接"伪装成"做完了"—— typecheck 与既有门禁全绿。**
    （2026-10-03 实测，`apps/web/src/features/quadrant/QuadrantBoard.tsx`）
    形状：包装层声明了 `readonly activeTaskId?: string | null` 与 `readonly onOpenTask?`，
    也在解构里取了这两个值，**唯独没往 `<SharedQuadrantBoard>` 传**。
    于是"任务的三种投影接同一个选中"实际只有两种接上，而：
    ① prop 是可选的 ⇒ 编译期没有任何东西会失败；
    ② 静态判据读的是**调用点**（`App.tsx` 里确实递了 `activeTaskId={selectedTaskId}`）⇒ 绿；
    ③ 共享层自己的用例挂的是共享组件 ⇒ 绿。症状只有一句"四象限不跟随选中"。
    ✅ 修法两层，缺一不可：**行为判据必须从宿主挂下去**（挂 `WebQuadrantBoard` 而不是挂板子，
    那层转发才量得到），并加一条**同文件内比"声明"与"使用"**的静态判据
    （`check:selection-single-source` 断言 E：声明了 `readonly NAME?:` 就必须出现
    `NAME={` / `NAME(` / `NAME ===`；解构那一行不算使用）。
    📌 一般规律：**凡是"可选 + 有默认值"的注入点，都要问一次"有没有人真的在传它"**；
    判据挂在链条的哪一节，就只能证明那一节之后是通的。
178. 🔴 **四端重装的判据回答"装上了、起得来、画的是我们的界面"，不回答"装的是不是含这一批的产物"。**
    （2026-10-03 实测，日历日档 §6.1.1 收尾）
    上一趟 `reinstall:all` 的 mac 段全绿（.app 10:30 装好、截图非空白、主蓝命中），
    而现量它里面的 `Contents/Resources/web-dist/assets`：
    `calendar-day-board` = **0**、`dayNoTimed` = **0**，同批阳性对照 `收集箱` = **1**。
    也就是说**装的是 09:49 那次构建的共享 UI，里面压根没有这一批的功能**。
    根因不是脚本坏了（它第 0 步确实跑 `pnpm -r build`），是**收尾跑在这批代码定稿之前** ——
    而四条判据没有一条问"这一批的东西在不在包里"。
    ✅ 补一条**产物字面量对账**（十行、零依赖）：从这一批新增的源码里取
    **一到两个 ASCII 字面量**（testID 前缀 / i18n key / 具名常量），
    到"装好的那个包"的产物字节里数命中，同时数一枚**一定在**的旧串当阳性对照。
    📌 三个会让这条判据自己骗人的地方：
    ① **CJK 串在产物里可能是转义形态**（§7 #171：Hermes 是 UTF-16LE；web bundle 会写 `\uXXXX`）
      ⇒ 要证中文界面就挑 **ASCII 字面量**（key / testID），别挑文案；
    ② **被 minify 掉的标识符命中 0 不算缺口** —— 同一次测量里 `readDragSegments` = 0
      只是因为函数名被压掉了，`calendar-day-board`（字符串常量）= 1 才是证据；
      ⇒ 选 needle 时先问"它是**值**还是**名字**"，只有值会活到产物里；
    ③ 阳性对照必须**同一趟**跑（`收集箱` 在缺日档的那份包里仍然 = 1），
      否则"0 命中"到底是"没这个功能"还是"我读错了文件"分不开。

179. 🔴 **`cmd > log 2>&1; echo EXIT=$? | tee -a log` 里的退出码是 `tee` 的。**
    （2026-10-03 实测，四端重装收尾）
    后台任务的完成通知报 **exit code 0**，而日志第 2 行写着
    "🔴 全仓构建失败 —— 打包必然打进旧产物，停下" —— 四端**一段都没跑**。
    形状：真实命令的 `$?` 被管道末端吃掉了（§7 #45 同一族的第五种面目），
    而 `| tee` 让"看起来记录了退出码"这件事**必然成功**。
    ✅ 收尾要记**真退出码**：`cmd > log 2>&1; code=$?; printf 'EXIT=%s\n' "$code" >> log; exit "$code"`
    —— 最后一行是关键：**不 `exit` 就还是包装脚本自己的 0**。
    📌 一般规律：**任何"包装 + 记录退出码"的脚本，都要问一句"我打印的那个数字是谁的退出码"**；
    完成通知里的 exit code 属于最外层，不属于被包装的那条命令。

180. 🔴 **共享组件在一个 tick 里连调宿主两个 setter 时，宿主读闭包状态必错 —— 第一个宿主看不出，第二个宿主才现形。**
    （2026-10-03 实测，日历档位入口接进 `apps/mobile`）
    共享板 `CalendarBoard.pickDay` 的实现是 `onSelect(date)` 紧跟 `onCursorChange(date)`。
    Web 那边写的是 zustand 的 `set((state) => ...)` —— **天然读到新鲜状态**，所以这个形状
    在第一个宿主上跑了三批都没事。移动端换成两个 `useState` setter：
    React 批处理这两个更新，而 `calendarSelectedForCursor(view, date, selected)` 里那个
    `selected` 是**上一次渲染**的闭包值 ⇒ 刚点的那一天被写回成旧的。
    症状：**"月档点格子没选中 / 日档点了没反应"** —— 不崩、不报错、控制台干净。
    ✅ 修法：宿主侧凡是"读另一个状态再决定"的 setter 一律走**函数式更新**
    （`setSelected((prev) => rule(view, date, prev))`）。
    📌 一般规律：**共享组件调宿主几个回调、按什么顺序调，是宿主的契约**，
    不是实现细节。第一个宿主（尤其自带"读最新状态"的 store）会把这条契约**掩护成不存在**；
    接第二个宿主时先问一句"这两个回调在同一 tick 里，我这边读到的是谁的值"。
    ⚠️ 本仓移动端测试通道**没有** React 渲染器（加它要过 §3.1/§3.2 两道门），
    所以这条目前只有一条**源码形状**判据钉着（`apps/mobile/tests/calendar-view-entry.spec.ts` 第 5 条，
    变异臂 AJ 会红）。那是缺口的**替代品**，不是解 —— 有渲染器之后应换成行为判据。

181. 🔴 **并行 Agent 回报的"已落盘 N 字节"是它的**意图**，不是磁盘事实 —— 本次实测：一份连路径带符号带毫秒全编的报告，同时声称写成了 32,391 B。**
    （2026-10-03 实测，性能热路径审计，全文见 [性能审计](../research/performance-hotpaths-audit.md) §5）
    一个负责"编排层与支撑包"的子 Agent 交回一条 P0：`packages/shared-schema/src/line.ts:101` 的
    `tryParseOpEnvelope` 每条 op 跑一次 zod 校验，"单条约 180ms、100k op ≈ 5 小时"，
    并明确回报"报告已落盘 32,391 字节"。
    现量：**`line.ts` 不存在**（那个目录是 `supersync-http-contract.ts` / `entity-types.ts` / `schema-version.ts` / …）、
    **`tryParseOpEnvelope` 全仓 0 命中**、**`strictObject` 0 命中**、
    **`packages/sync-client/src/` 里 `.parse`/`safeParse` 0 命中**（客户端根本不逐条校验，
    zod 只在服务端边界每**请求**一发：`sync.routes.ops-handler.ts:96`、`sync.routes.ts:149`）。
    而那份"32,391 B"的文件在 `/tmp` 里**从来没有出现过**。
    代价不是学术性的：**那句话已经被转述进汇报里**，要撤回。
    ✅ 三条判别动作，每条一条命令：
    ① 判"没做完"先 `ls -la` 产物目录，**不要只看回报**（同一天另一条 Agent 反过来 —— 报告落盘了 33.5 KB 但完成通知没送达，也被误判成"还在跑"）；
    ② 采纳任何 `file:line` 前先 `grep -n` 那个符号，命中 0 直接删条目；
    ③ 重派时在任务书里写死"每条引用先自检存在性 + 先落盘再 Read 回读报字节数 + 必须存在'我怀疑过但不成立'那一节"。
    📌 一般规律：**汇报里的数字有三种来源 —— 量出来的、读码推出来的、按常识生成的**，
    而它们在文本上**长得一模一样**（都有冒号都有单位）。只有"能不能一条命令复现"能区分。
    ⚠️ 这条只针对**并行 Agent 的回报**，不改变 §6.2 规定一"人必须真的打开那张图"—— 那是同一族里"声称看过 ≠ 看过"的另一面。

    **B/C 续验补充（2026-10-03）**：分包编译与库函数通过的回报，只能证明对应层级。
    原生提醒尚未完成 OS 投递验收时，计划表曾提前写“已实现”；已改回实施中。
    E2EE 批量加密函数返回成功也不能证明服务端原子发布、旧日志迁移与新设备恢复成立。
    采纳完成回报时，必须沿原计划逐条检查生产调用点、失败恢复、平台实测与产物身份。

    **2026-10-04 隔离收口补充**：共享检出在 build/test 期间被其他会话更新，曾造成产物过期、
    声明文件消失与测试行号对不上。改用固定基线加明确文件哈希的隔离副本；不得把这份读数
    写成主检出后续所有修改也通过。浏览器复验还发现第四列出现后，手势探针的固定起点
    `x=1000` 已落入详情列，根本没在目标任务上按下。修探针时从目标行几何推导起点，
    并用 `elementFromPoint` 正控确认确实命中任务；保留拖出内容区、翻日与不误勾选的原断言。
    同轮 `countdown-export` 在 Node 24.2.0 + Playwright 动态导入真实 CJS 构建时报
    `ERR_INTERNAL_ASSERTION: Unexpected module status 3`，普通 Node 直接导入同一文件正常。
    改读同次构建生成的 ESM `index.mjs` 后加载器正控通过；不是“缺产物”，不能重抄契约常量兜底。

182. 🔴 **形状像 O(N²) 的循环查找，可能被同一个表达式里的短路条件整体废掉 —— 于是"读代码判性能"会自己造出假 P0。**
    （2026-10-03 实测，性能审计：`packages/op-log/src/engine.ts:635`）
    ```ts
    pendingAtStart.every((row) => row.seq > checkpoint.coveredSeq || checkpoint.appliedOpIds.includes(row.op.id));
    ```
    `appliedOpIds` 从 checkpoint 读出来是 **plain array**，`includes` 是线性扫 —— 看着就是 O(pending × N)，
    100k 历史 × 1000 pending 像是几秒钟。我把它写成了 P0 候选。
    实测**不成立**：`coveredSeq` 在正常情况下接近日志末尾，`row.seq > coveredSeq` **短路为真**，
    `includes` 基本不执行；它只在真的出现覆盖空洞时才跑，而那正是这个检查要防的稀有情况。
    （复现只需 5 行微基准，跑完 `array.includes` = 0.0–0.1ms；见审计文档 §5 第 2 条）
    ✅ 判嵌套成本之前先读**求值顺序**：`a || b` 里的 `b`、`a && b` 里的 `b`、
    以及 `if (x) return` 提前走掉的那一支，都可能让下面那行**永不执行**。
    📌 一般规律：这是 §7 #46（"没复现 ≠ 路径没执行"）与 #50（"状态对'在'没生效'时也绿"）的**第三种面目**：
    **静态形状不等于运行时次数**。而它比那两条更危险，因为它产出的是一条**看起来完全合理的 P0**。

183. 🔴 **`grep schema.prisma` 按索引名找，会恒判"缺失" —— Prisma 的 `@@index` 不写名字。**
    （2026-10-03 实测，性能审计服务端那条线；同一条坏探针当场输出 47 条假阳性）
    我为了回答"哪些索引只活在迁移裸 SQL 里"写了这条看起来无害的命令：
    从 `server/prisma/migrations/**/*.sql` 抓 `CREATE INDEX "<name>"` 的名字，逐个去 `schema.prisma` 里数命中。
    **期望 4 条，实际 47 条** —— 因为 `@@unique([email])` 在数据库里叫 `users_email_key`，
    `@@index([userId, receivedAt, serverSeq])` 叫 `operations_user_id_received_at_server_seq_idx`，
    **名字是 Prisma 按约定生成的，schema 文本里根本没有**。
    现量：全 `schema.prisma` 里 `map:` 只出现 **1** 次（就是那个 GIN），
    所以"按名字对账"在这个仓库**结构上不可用**。
    ✅ 正确的对账维度是**列集 + 谓词**，不是名字：
    ```bash
    # 迁移里带 WHERE 谓词的索引（Prisma 表达不了 ⇒ 必然在 schema 之外）→ 实测 4 条
    find server/prisma/migrations -name 'migration.sql' -exec \
      awk 'BEGIN{RS=";"} /CREATE[ \t]+INDEX/ && /WHERE/ {n=$0; gsub(/[ \t\n]+/," ",n); print n}' {} \; \
      | grep -c 'CREATE INDEX'
    awk '/^model Operation /,/^}/' server/prisma/schema.prisma | grep -E '@@index|@@unique'   # 实测 4 行
    grep -c 'map:' server/prisma/schema.prisma                                                # 实测 1
    ```
    📌 顺带一条**项目事实**（不是探针问题）：`operations` 上有 **4 个 partial 索引**只存在于迁移 ——
    `(user_id, server_seq) WHERE is_payload_encrypted = true`、两个同列集但谓词不同的
    `op_type IN (...)` / `... OR (op_type='REPAIR' AND repair_base_server_seq IS NOT NULL)`、
    以及 `(user_id, id) WHERE payload_bytes = 0`。其中三个**列集完全相同、只靠谓词区分**，
    所以连"按列集去重"也会把它们并成一个 —— 判索引覆盖只能读 DDL 原文或问数据库。
    ⚠️ 未闭合：真正的对账是 **`pg_indexes`（生产实况）↔ 仓内声明**，需要一个能连库的门禁，本轮没做。

184. 🔴 **zsh 里 `${PIPESTATUS[0]}` 是空值（不是 bash 的数组下标）—— 于是"退出码"读成一个空串，比读错更危险。**
    （2026-10-03 实测，性能审计收尾跑 `docs-link-check`）
    `cmd 2>&1 | tail -4; echo "EXIT=${PIPESTATUS[0]}"` 打出 **`EXIT=`（空）**，
    而门禁当时其实是**通过**的 —— 空串既不是 0 也不是非 0，任何"`[ -z ... ]` 就重试"的下游逻辑都会误判。
    同一族已经有 #45（管道后 `$?` 是 `tail` 的）和 #179（`echo EXIT=$? | tee` 记的是 `tee` 的）。
    ✅ 要真退出码就别用管道：`cmd > /tmp/x.log 2>&1; echo "EXIT=$?"; tail -4 /tmp/x.log`
    —— **先落盘、再取 `$?`、最后才 tail**。
    📌 一般规律：`$?` 只有一个槽位，**任何"顺手记一下退出码"的写法都要先问"这一刻 `$?` 属于谁"**；
    而在 zsh 下连 `${PIPESTATUS[0]}` 这个写法本身都不存在。

185. 🔴 **歧义引用会让一次复核得出「错误的确证」—— 不是让人开错文件，是让"我已经核过了"这句话本身失效。**

    性能审计里三条重派产物都用裸文件名写 `file:line`（`host.ts:358`、`client.ts:906`、`sqlite-adapter.ts:561`）。我照它们去复核，实际发生三次错：

    | 报的引用 | 真身 | 错在哪 |
    |---|---|---|
    | `host.ts:358` | 命中 `apps/desktop/src` / `apps/node-host/src` / `packages/app-host/src` 三份 | 我读了 **app-host** 那份，看到 `getAllOps()` 就以为确认了那条 P0；真落点在 `apps/web/src/lib/oplog.ts`（两边都不对） |
    | `client.ts:906` | 被归到 `packages/sync-core/`，真身 `packages/sync-client/src/client.ts` | **包名错、行号完全对得上** ⇒ 最坏的一种：错的东西里有一个对的数字 |
    | `sqlite-adapter.ts:561` | 真身 `packages/storage/src/sqlite/sqlite-adapter.ts` | 少一层子目录，按字面路径 `sed` 直接 "No such file"，容易误判成"文件不存在 = 引用是编的" |

    前一轮已经写过 #181（"已落盘 N 字节"是意图不是事实），那条管的是**编造**；这条管的是**真内容配了不可唯一定位的坐标** —— 后者更危险，因为它能通过复核。

    ✅ 判别与修法：复核别人的裸名引用时，先 `git ls-files | grep -E "/?<name>$"` **展开全部候选并逐个看完**，只看第一个等于没核。写的时候一律全路径。
    📌 一般规律：**"我核过了"必须能回答"核的是哪一棵树上的哪个文件"**；定位不唯一的引用把复核变成了掷骰子，而掷骰子多半会命中一个"看起来对"的行。

186. 🔴 **两个"取证装置自己造红/造空"的形态：逐行执行 markdown 代码块的 runner，和 awk 的 `END{print s}`。**

    复跑文档里的每条命令时抓到两处，两处都不是文档的错：

    1. **一个 `D=…` + `echo "P0=$(… $D)"` 的两行块，逐行 `execSync` 会报 `P0=0 P1=0 P2=0`。**
       第二行在**新进程**里，`D` 不存在 ⇒ grep 对空文件名报错、三个计数全 0。我差一点据此宣布"文档的自检判据坏了"。
       ✅ **一个代码块 = 一次执行**（`bash -c '<整块>'`），改完立刻得到 11/16/4。
    2. **`ls -la | awk '$1>300000 {s+=$1} END {print s}'` 恒假，而且失败方式是"印一个空行"。**
       `ls -la` 的 `$1` 是权限串（`-rw-r--r--@`），字节数在 `$5` ⇒ 条件从不成立 ⇒ `s` 从未累加 ⇒ 打印空。
       空值在终端上和"命令跑通了、数据就是这样"**无法区分**。
       ✅ 汇总打印一律写 **`print s+0`**：无命中时给 **0**，那是一个能判断的读数。
    📌 一般规律：**探针报告"没有"之前，要先证明探针在能命中的样本上会报"有"**（对照 #46/#50/#174）；
    而"字段号取错"这类缺陷的产物往往是**空**而不是错 —— 所以宁可我自己的汇总在空集上也要输出一个显式的 0。

187. 🔴 **提醒验收安装失败后仍继续操作，得到的是旧包行为；force-stop 也不是普通进程死亡。**
    （2026-10-03，B/C 续验；入口：[多端覆盖计划](../plans/goal-multi-end-coverage.md) §4）
    `verify-mobile-reminder-ring.sh` 曾卸载 `com.heytamobile`，但 helper 的真实包名为
    `com.heyta`。随后 release 安装报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，输出经过
    `tail` 吞掉状态后继续跑 UI，产生一串无法归因的失败。该轮截图与日志不能作为投递成功证据。
    规则：包身份从构建/共享 helper 对账；安装退出非零立即终止；当前 APK 的安装身份与构建时间
    对上后才验业务。同一模拟器只能由一个执行者安装与操作。源码变异与构建也须独占，避免把
    变异产物装进正常验收。通知判据应检查 active notification，不能 grep 通知历史当成当前弹出。
    Android force-stop 会阻止后台投递，须验证“再次启动后补算”；普通 kill 后的系统排程另测。
    **当前状态**：已定位上述脚本错误，修复及真机复验仍在进行；本条不是验收通过记录。


188. 🔴 **用“当前状态是否匹配”在 reducer 中丢弃提醒回执，会破坏乱序收敛。**
    （2026-10-03，原生提醒 C 续验；契约：[ADR-0051](../adr/0051-mobile-reminder-delivery.md)）
    为阻止旧通知回执把新 snooze 标成 fired，初稿在 reducer 比较当前 effectiveTrigger，
    不相等就 return state。单机队列用例通过，但 fired 先于 CREATE 到达时会永久丢回执，
    同一 op 集合按不同顺序回放得到不同事实。修法是把回执所属的 trigger 作为可选数据字段
    `firedForTriggerAt` 保存，领域读取时与当前 occurrence 比较，不能按当下物化状态丢 op。
    判据是 CREATE/fired/snooze 的全部六种顺序收敛，以及排队 snooze 后旧回执不使新 occurrence fired。
    规则：本地竞态的修法也必须经过 [E 的语义规格](../research/op-log-e1-semantic-spec.md)，
    不能用“本机串行”替代“跨设备乱序”。
    2026-10-04 的 HTTP/PG 续验把该语义接到两台独立 SQLite 宿主，覆盖重开、贪睡与每日重复。首轮共用测试账号，把上一例尚未上传的 fired 留在另一端，下一例正控多出一条 pending；修为逐例独立账号，不能用过滤额外项掩盖串扰。受控通知 port 的取消与排程只证明协议决策，OS 投递证据仍单独关闭。

189. 🔴 **取消通知的负向断言需要仍然活动的正向对照，启动命令也需要读回。**
    （2026-10-03，C 提醒验收；契约：[ADR-0051](../adr/0051-mobile-reminder-delivery.md)）

    原脚本先点击带 `autoCancel` 的通知，再删除提醒、断言通知不存在；即便取消接线失效，
    系统也早在点击时清掉通知，因此这条判据会假绿。修成先从启动器回应用，断言通知仍活动，
    再删除提醒；通知点击另用下一条真实通知验证。截图先展开通知栏、再落盘、最后断言，
    不能拿桌面截图证明通知展示。另一次实测中 `monkey` 输出物理按键检查后退出，应用
    `stopped=true/notLaunched=true`；显式 `am start -W` 才拿到真实 Activity 启动结果。
    规则：操作成功退出不能代替目标状态读回，负向判据必须证明此前对象确实存在。
    同轮截图还确认 Android edge-to-edge Modal 的新建面板被 IME 覆盖：树中的“添加”坐标仍在，
    点击却落在键盘上。Activity 的 `adjustResize` 没有保护这个 Modal；为 Android 的
    `KeyboardAvoidingView` 显式设置 `height` 后，当前 Release 截图显示输入框与添加按钮在键盘上方。
    不能盲发 BACK 收键盘，它可能直接关闭 Modal。夹具日期改用宿主独立计算的 ISO 日期，
    不再假设中文 capture 解析器支持英文 `yesterday`；输入后读回完整值，再点击可见按钮。
    连续跑下一轮时还要先 `cmd statusbar collapse`：截图留下的通知栏不会因 `am start -W`
    自动收起。Activity 已在前台、AX 却只有系统开关时，先排除这个探针留下的覆盖层，
    不要反复重装或把“看不到应用按钮”归为产品未启动。
    续验还发现仅加 `height` 不足以覆盖首次显示的竞态：自动聚焦可能早于原生 Modal
    显示与父级键盘监听就绪。改为在 `Modal.onShow` 后才挂载自动聚焦的输入组件；
    23:26 的当前 Release 截图确认面板、日期/时间预览与添加按钮都在键盘上方，
    实际点击成功创建任务。没有用隐藏键盘的测试开关绕过这个用户可见的问题。
    23:39 续验再把“已展示通知撤回”和“未到期 alarm 取消”拆成独立判据：后者必须先在
    `dumpsys alarm` 中数到该应用的 active alarm，再删除并确认归零；不能匹配 dump 的历史统计项。
    force-stop/整机重启后的补发同样先证明自然跨过 due 且 SQLite 没有 fired，再显式启动；
    “启动后补发”不等于“强停期间仍投递”，不许把这两条产品承诺混写。

190. 🔴 **Xcode 27.1 / iOS 27 上 idb companion 的 Unix socket 失败，不等于 AX 或产品失败；
     但 TCP fallback 也不能掩盖脚本自己的错误判据。**

     本轮真实验收中，`idb_companion --grpc-domain-sock` 报
     `GRPCCore.RuntimeError error 1`；同一二进制用 `--grpc-port 10982` 可连接并返回真实 RN AX 树。
     `scripts/tools/ios-ax-shim.py` 因此接受 `/tmp/...sock` 与 `host:port` 两种传输，验收脚本在 Unix
     socket 失败时切 TCP，并把两种日志留在 `/tmp/heyta-idb-reminder-companion*.log`。

     同时踩到的三个脚本级陷阱也固定为规则：

     - `--scroll-into-view` 只返回 `found/visible`，不会替调用方执行 `--press`；必须滚入后再精确点击。
     - `set-value` 后普通 TextInput 要在键盘仍显示时回读；点击“完成”可能触发
       `onSubmitEditing`，把任务 Composer 误提交并关闭。
     - 详情页日期网格的 44px 按钮不能当作底部 Tab；否则滚动起点被禁在网格上方，后续时间字段永远不可达。

     这些规则已落在 `ios-ax-shim.py`、`verify-mobile-ios-reminder.sh` 和 ADR-0051；新脚本也必须登记
     `check-script-snapshot` 的显式清单。验收截图必须先保存、再人工查看；旧的全黑截图只能作失败证据，
     不能被引用为通知投递成功。

196. 🔴 **`.gitignore` 里带尾斜杠的 `node_modules/` 只匹配目录，挡不住软链** ——
     凡是拿 `git ls-files -co --exclude-standard` 当"打包输入集合"的流程，
     在**软链 node_modules 的检出**里会把软链当"未跟踪且未忽略"整片送出去。（2026-10-04 00:2x 两腿实测）

     触发场景是我为了量"集成态"而建的干净检出：`git worktree add --detach` 出来一棵**只有源码**的树，
     为了复用 pnpm 的 store，把 `node_modules` **软链**回载体。
     随后 `git status --porcelain` 报 **21 项未跟踪**，看着像"这棵检出脏了 / 我污染了现场"，
     实际那 21 枚全是我自己建的软链。

     两腿对照（**同一条规则** `.gitignore:1` 的 `node_modules/`，只换对象类型）：

     | 对象 | `git check-ignore -q node_modules` | `git ls-files -co --exclude-standard` 里的条目数 |
     |---|---|---|
     | 真目录（载体） | rc=**0**（被忽略） | **0** |
     | 软链（干净检出） | rc=**1**（未忽略） | **21** |

     ⇒ gitignore 的尾斜杠语义是"**只匹配目录**"，软链在索引眼里是一个普通文件，
     于是一行规则在同一棵树上给出两种答案。**"忽略规则写了 = 这类路径永远不进集合"是假的**，
     它成立与否取决于那一个路径的**对象类型**。

     🔴 真正贵的是第二跳：Windows 段的源码同步 `sync_windows_sources()` 正是
     `git ls-files -co --exclude-standard` + `tar -T -` 的形状（AGENTS 6.1.1 那条新鲜度对账的实现）。
     在软链检出里跑它，21 枚软链会进 tar；远端解包时它们指向远端不存在的路径，
     **症状会伪装成"远端构建坏了"**，而本地一切都是绿的。
     本轮没让它发生是因为我在**载体**（真目录）里跑打包、只在干净检出里跑门禁 ——
     这是运气不是设计。

     两条落地判据：
     ① **测量装置自己造的未跟踪条目，要在打脏项数时显式排除** ——
        `heyta-integration-verify.sh` 原来那句 `脏项=$(git status --porcelain | wc -l)（应为 0）`
        现在改成"其中**非软链**项必须为 0，否则 exit 4 并列出来的是哪些"，
        下一轮不会再把这 21 读成"检出脏了"；
        🔴 但这条分类判据自己也要用 `-uall`：`git status --porcelain` 默认把
        "目录里只剩未跟踪项"**折叠**成 `?? apps/`，而**目录不是软链** ⇒ 折叠行会被算成非软链脏项
        （独立对照仓库实测：不带 `-uall` 得 `2/2`，带上得期望的 `2/1`；
        真实现场 `heyta-wt-verify-integration` 两腿都是 `21/0`，因为那里的父目录还有已跟踪文件，不折叠）。
        **"按对象类型分类"的判据，必须先确认集合是逐项的还是折叠的**；
     ② 任何"把 `ls-files -co` 的集合送去另一台机器"的流程，起跑前先断言
        `find . -type l -name node_modules | wc -l` **等于 0**（不为 0 就响亮失败，
        别指望解包端报错 —— 它报的将是另一件事）。

197. 🔴 **`sandbox_extension_issue_file_to_process … Operation not permitted` 是一行噪声，不是失败原因** ——
     它在一次**成功**的截图里也出现。（2026-10-03 22:49 与 23:05 两次实测）

     macOS 端的窗口取证（`check:macos-window` 与安装包的自截屏）走 ScreenCaptureKit，
     stderr 会打这一行。而**同一次运行**的 stdout 里同时有 `WINDOW_TITLE=heyta`、
     `WEBVIEW_SNAPSHOT_BYTES=…`，那张快照也过了 `shot_ok`（非空白 + 主蓝命中）
     ⇒ 它连"必要条件"都不是，更不可能是原因。

     事故形状不在那行字，而在**归因**：`reinstall-all.sh` 的 mac 段当时红在**第一段** `swift build`
     （两个当时未跟踪的 Swift 文件），连打包都没走到；而当时的台账把它写成
     "mac 端因环境红：没有屏幕录制权限" —— 因为读日志的人只挑了最像错误的那一行。
     那两个文件后来由它们的所有者提交了，`swift build` 现在报 `Build complete!`。

     ⇒ 两条一般规律：
     ① **"红字出现在失败日志里"不等于"它在失败链路上"** —— 要说"是它导致的"，
        反证是现成的：**同一行在成功运行里也出现 ⇒ 它不可能是充分条件**；
     ② 归因要指到**第一个失败的段**。`reinstall-all.sh` 每段独立置 `RESULT_<端>`、失败也继续，
        所以看汇总行，别看最后一段输出。
     完整对账（含"同一文件里 §4 与 §7 互相矛盾、用 `heyta-reinstall2.txt:6` 判掉那一条"）
     在 `BLOCKED.md` 里第 4 节与第 7 节，以及 `B61`。

198. 🔴 **macOS 没有 `setsid`** —— `nohup setsid bash x.sh &` 只留下一行
     `nohup: setsid: No such file or directory`，**任务当场不存在**；
     而它在日志上的症状与"闸门正在等窗口"**一模一样**（都是"没有新行"）。（2026-10-03 23:0x 实测）

     两个附加坑，都会把这件事推得更远：
     ① 用 `$!` 拿 pid 在这条链上不可靠 —— 那一行 `nohup` 的退出与真正的载荷无关；
        要 pid 就 `pgrep -f <脚本名>` 现取，并把它**打进日志第一行**；
     ② 一旦把"日志还没长"读成"它在等"，就会在**根本没有进程**的情况下等满，
        然后把 `exit 3`（环境无效）当成一笔真实读数记进台账。

     ⇒ 规则：**投放后台任务之后，第一个动作是用 pid 证明它在**。
     "日志没长"不构成任何状态，既不证明在跑、也不证明在等。
     与 #164（后台通知里的 `exit code 0` 是包装命令的）、#46（"没观测到"≠"没发生"）同族 ——
     **观测通道本身的存在性也要有一条判据**。

199. **真实浏览器的网络故障注入必须先证明拦截发生；Service Worker 能绕过 page.route。**

     2026-10-04 Vault 并发迁移验收在静态生产构建上暂停 inventory 响应，准备在暂停期间
     新建任务。前两轮一直等不到屏障，但截图已显示迁移完成：应用的 Service Worker
     转发了请求，Playwright 的 `page.route` 没有介入。这不是“迁移没有发请求”。
     同一份产物在独立 context 明确 `serviceWorkers: 'block'` 后，屏障实际命中，
     随后的真实并发上传让 commit 返回 409、payload generation 保持 1，判据才抓到
     缺少 Web 同步/迁移互斥的缺陷。PWA 自身仍由独立门禁验收，这个控制条件只用于
     Vault 的 HTTP 故障注入。

     `e2e/vault/vault-journey.spec.ts` 每个屏障都须有正向前提（实际到达该请求），
     等待用有限时的 poll，而不是无期限 Promise；失败前截图，恢复码遮挡，关闭 trace/video。
     “没有请求”必须区分排队、错误、Service Worker 代发和探针没有命中。
     同族 fixture 续验：`vault-settings.spec.ts` 原先只在 Vite dev 下运行，切到静态生产产物后，授权注册的 Service Worker 绕过 HTTP fixture，虚拟域名请求得到 503。该用例明确设置 `serviceWorkers: 'block'` 后通过 1/1（3.5 秒），创建、恢复与轮换断言未放宽；PWA 本身仍由独立门禁验证。

     同族取证续验（2026-10-04）：Playwright 1.63 即使关闭 trace/video/screenshot，失败仍自动保存页面 aria 树到 `error-context.md`，截图 mask 不影响它。Vault 专用配置与敏感表单 helper 设置 `PLAYWRIGHT_NO_COPY_PROMPT=1`；输入失败重新抛脱敏错误，秘密断言改为布尔值。`check:vault-diagnostics` 在临时页面放入运行时生成的合成秘密，故意触发断言和输入失败：正常配置诊断无秘密，去掉防线的负向对照可检出秘密。门禁接入 `pnpm check` 和 Vault 旅程入口，临时测试与故障产物结束后清理。
200. 🔴 **"能快进"不是合流判据 —— 它的保质期就是下一笔落进 main 的提交，连我自己的一笔文档提交都算。**
     2026-10-04 实测：00:5x 现量 `git merge-base --is-ancestor main feat/list-parent` 退 **0**，我据此在交接文档
     四处写了"现在是快进 / 届时一次 `--ff-only` 就完事"。01:3x 同一命令退 **1**：main 其后前进 7 笔，
     其中 4 笔**正是我自己那几笔 `docs(handoff)`**，分支侧也领先 7 笔 ⇒ 双向分叉，`--ff-only` 结构上不可能，
     要落的是一笔**合并提交**。最坏的地方不是它红，而是**它绿过一次** —— 那句话读起来像已核实的事实。
     ✅ 稳的两半都不需要检出（因此不会撞进别人正在跑的验收）：
     ① 合并**干净** = `git merge-tree --write-tree --name-only main <分支>`，rc=0 且只打印一棵树 oid；
     ② 落点**没被人占着** = 本笔要改的文件集 ∩ 主检出未提交文件集为空（git 不替你 stash 别人的改动）。
     同一结论句落在几处就要 sweep 几处（本轮 5 处），旧句留原处标注失效时刻，不悄悄删。
201. 🔴 **数"别人的测试/构建是不是正在跑"用 `ps` 的 argv 判不出来** —— 同一件事三种写法读数 34 / 35 / 1，
     而真相是"有一趟 vitest 正在主检出里跑"（2026-10-04 01:5x，为决定能不能落一笔会重写工作树的合并）。
     三种坏法各不同：① 粗 `grep -E '(vitest|playwright|vite|esbuild)'` 把**观察者自己**那条命令行也算进去；
     ② 改 `[v]itest` 括号防自匹配**只防得住正则那一侧**，同一条命令别处写了明文 `esbuild` 就照旧命中；
     ③ 收紧成"必须是 node 可执行 + 路径含 vitest"之后**开始漏**：真 fork worker 的 argv 是
     `…/vitest/dist/workers/forks.js`（`vitest` 后面不是空格），于是"有人正在跑"被读成 1，
     而那 1 个是活了 3 小时 32 分的常驻 esbuild service，与有没有跑套件无关。
     ⇒ 做成硬门**要么恒红要么恒绿，两种都比没有更糟**（§7 元规则第二条）。正确处置：降级成诊断打印，
     "现在能不能动手"交给能决断的读数（负载闸门 + 落点交集为空 + `git diff --cached` 为空）。
     另：路径匹配要带**尾斜杠** `01_PROJECTS/heyta/`，否则平行 worktree（`heyta-wt-*`）的进程会被算进来。
202. 🔴 **"停我自己的那个进程"也不能按名字广播杀** —— 02:03 我为了停一条等窗口的哨兵，跑了
     `pkill -f "verify-mobile-window-gate"`，**之前没有 `pgrep` 列出会打到谁**。那是按名匹配所有会话的
     闸门进程：并行会话那一刻若正好在起跑前跑这道预检就被我掐掉，而它那边只看到"闸门莫名中断"，
     不会指向这里。同族的两次已在别处记过（`check:ai-e2e` 的前置 SIGKILL 别人的 dev server、
     `pm clear` 之前不探测外部依赖）—— 这次是第三种面目：**由头是"清理自己"，动作是全网广播**。
     ✅ 固定顺序：① 先 `pgrep -f <模式>` 列 pid，并看**父链与工作目录**判归属；② 只 `kill <我自己那个 pid>`
     （哨兵启动时就把 pid 打出来，本来就该用它）；③ 确实要按模式杀时带上 `-u "$UID"` 并逐项排除别人的树。
     已经发生的无法回滚，所以这条连同"谁受影响未知"一起登记，不写成"应该没影响到别人"。
203. 🔴 **"分支不在了"有三种成因，探针却把它们印成同一句话** —— 引具名 ref 的脚本必须先答"它为什么不在了"，
    再报它自己认为的原因。

    `git merge-tree --write-tree main feat/list-parent` 退 **1**，stderr 是
    `merge-tree: feat/list-parent - not something we can merge`，而我的脚本紧接着打印
    `VERDICT=有冲突，不合`。真相是那条分支**已被并行会话合进 main 并删了本地分支**：
    `git merge-base --is-ancestor 776fc23c HEAD` 退 **0**，`git branch -a --contains 776fc23c` 里
    `origin/main` 也在。于是那件**已经做完的活**在日志里留下一条假红，
    而下一个读它的人会去解一场**不存在的冲突**（更糟的是他大概率能"解成功"一次，把那笔已存在的工作再解一遍）。

    三种"合不上"必须在读数里分开：① ref 不存在、但那笔提交**在** HEAD 的祖先里 ⇒ **活已完成，别合**；
    ② ref 不存在、且不在祖先里 ⇒ 分支被删而工作没落地（去找 reflog / `--all`，**也不是**找冲突）；
    ③ ref 在、`merge-tree` 退非 0 ⇒ 这才是真有冲突。

    ✅ 修法（换判据，不是加提示语）：先 `git merge-base --is-ancestor <那笔> <rev>`，命中就只打印接线现量、
    跳过合并；不命中才走 `merge-tree` 与那三条门。**`--is-ancestor` 比 `merge-tree` 便宜，
    而且它顺带回答了"我还要不要做这件事"** —— 这是它该排在第一位的真正理由，不是"多一层保险"。

    同一次读数量出来的第二个坑：`git grep -c <rev> -- <path>` 打印的是 `rev:路径:条数`，
    我用 `cut -d: -f2` 取了一轮 ⇒ 拿到的是**文件路径**，输出里 `web=apps/web/src/…/ProjectsPanel.tsx`
    看着完全像个读数。取数只能取末段（`awk -F: '{print $NF}'`）；
    凡多段分隔的 git 输出（`--numstat`、`status --porcelain=v2`）都先原样打一遍再决定切第几段。

204. 🔴 **给已装 payload 取"那枚主包"时用 `ls assets/index-*.js | head -1` —— 挑中的是界面
    根本没加载的那枚 chunk。**

    02:48 现量 `/Applications/Heyta.app/Contents/Resources/web-dist/assets`：9 个文件里
    **有两枚** `index-*.js` —— `index-Da9aaZLq.js` 1.9 MB（`index.html` 引用的就是它）和
    `index-CYIBHm27.js` 215 KB。`ls | head -1` 按字典序拿到的是 215 KB 那枚 ⇒ 我由它得出的
    "已装包里搜不到 X"其实是在读一枚副产物，**方向还正好是错的**（真主包里 X 有 2 处）。

    修：文件名从**加载它的那份清单**里取（`grep -o 'assets/index-[A-Za-z0-9._-]*\.js' index.html`），
    不是从目录列表里取。

    📌 同刻另一条：**两枚 mtime 相同、目录文件数与载体也相同（9 vs 9）**，所以"数量对得上、
    时间也新"完全不构成"装的就是这份构建" —— 探针对payload 的比对只能落在
    **内容哈希**或**引用到的文件名**上（这是第 82 条的第四种面目）。实测那次装的是 23:05 的构建，
    而 `index.html` 引用的文件名与载体现量构建不同 ⇒ 一眼判过期。

205. 🔴 **等窗口的后台链把日志写成 `printf … | tee -a "$LOG"` ⇒ 启动它的那个回合一结束，
    链就死在下一条 `say` 上，而且没有任何错误行。**

    02:31 那一趟：`run.log` 停在 02:41:55 的一条普通"等 60s"等待行，`rc.txt` 是 **0 字节**
    （脚本从没执行到写 RC 那一步），没有 trap、没有 VERDICT、没有报错。成因是 `tee` 的 stdout
    指向已被回收的管道，EPIPE 沿管道回到脚本自己。

    修：等待循环里的日志函数只 `>> "$LOG"`，**不走管道**；起它时
    `nohup bash x.sh </dev/null >"$LOG" 2>&1 &`（macOS 没有 `setsid`，见第 198 条）。

    📌 **可迁移的判据**：一条"给自己记账"的脚本，它的记账通道不能依赖启动者活着 ——
    否则"记录断了"与"环境一直不放行"和"活干完了"在磁盘上长得一模一样（本文件元规则第 1 条）。
    读这类链的日志时，**最后一行没有结论句就要怀疑探针本身**，不要读成"它还在等"。

206. 🔴 **main 每几分钟前进一笔 ⇒ 拿"载体 == main HEAD"当交付门是不可达的；
    过期要按**打包输入集的差集**判。**

    02:46→02:52 六分钟内 main 走了 `2a5c3587 → 4a9de8b6 → 67149961`，三笔全是 docs。
    两种错法各撞一头：按"整棵树有没有 diff"判 ⇒ 这条门**永不放行**；按"有没有人碰过代码"
    的口头印象判 ⇒ 就是第 82 条拦的那个形状（门看起来在，实际不咬）。

    正确形状（现量在 `heyta-deliver-on-window.sh` 的阶段 3/5）：把"会进哪个端的包"的路径写成
    一个正则 —— `^(packages/|apps/|server/|scripts/|e2e/|package\.json|pnpm-lock\.yaml|[^/]*\.ya?ml$)`
    —— 再排掉各端验收会自己重写的 `apps/*/docs/`、`apps/*/evidence/`，然后
    `git diff --name-only <载体> <main> | grep -E … | grep -vcE …` 取条数。
    02:52 那次：全量差集非空（三笔 docs），**打包输入差集 = 0** ⇒ 放行是成立的。

    配套（三条都是同一条不变量的不同时刻）：**起跑前重量一次**（窗口是瞬时读数）、
    **装完再量一次**（重装那 40 分钟里并进一笔代码完全正常，差集≠0 就得说明这一装在落地那一刻已过期）。

207. 🔴 **判据清单已经有单一所有者 lib 了，链里再 `grep` 一遍字面量 = 当场抄出第二份定义** ——
    我在这次会话里抄错了，而且抄少两条。

    `scripts/lib/msix-install-facts.sh` 的文件头**逐字**写着"清单从两处开始就一定会漂"，
    它列的是 `MSIX_REQUIRED_FACTS` **五条**（`ADD_APPX=OK` / `RESULT=OK` / `PAYLOAD_WEBDIST=True` /
    `M2D=OK` / `SHORTCUT_OK=True`）。02:51 我写交付链的 payload 探针时，为了"不再依赖那个 lib 在不在"，
    在链里直接 `grep -aoE 'ADD_APPX=…|PAYLOAD_WEBDIST=…|M2D=…'` ⇒ **只剩三条**，
    用户点名的那条 `SHORTCUT_OK` 在我这条链上永远不会被读到，而 `PAX_WIN=PROVEN` 照样能报出来。
    02:59 才发现（是我自己拿 `grep -n shortcut` 去找"这活儿到底做没做"时撞上那个 lib 的）。

    修：`. "$CARRIER/scripts/lib/msix-install-facts.sh"` 后用 `msix_check_facts <取证文件>`，
    并把清单条数打进日志（`判据清单=5 条（取自单一所有者）`）—— **数量也是判据**，
    读成 0 就说明 lib 不在，那要 `PAX_WIN=LIB-MISSING` 而不是退回我抄的那份。

    📌 两条一般规律：① **仓库里已经有单一所有者的清单时，"我自己 grep 一遍字面量"不是保守做法，
    而是复制做法** —— 保守做法是 source 它，并断言"清单确实从它拿到了 N 条"；
    ② 抄件漂移最早出现在**新写的那一侧**（旧的一侧有门禁、新的那一侧没人比），
    所以新探针要**同时**跑一次"应当判 `STALE`/`LIB-MISSING`"的反向腿（02:59 用两个 `INST_START`
    各跑一次，一腿 `PROVEN` 一腿 `STALE`，才算这条判据有牙）。

208. 🔴 **iOS 模拟器的 `simctl io screenshot` 默认屏幕可能是黑的副显示器，PNG 有效不等于取到了设备画面。**

     2026-10-04 在 iOS 27.1 的 `heyta-ios-isolated`（UDID
     `1EDCFA59-6A9C-428D-8FE2-160B11318648`）上，直接执行
     `xcrun simctl io <udid> screenshot out.png` 成功写出 2007×2853 的合法 PNG，但 `png-stats`
     读到 `contentRatio=1`、`colorSpan=0`，实际是全黑的 `LCD-1`（screen 3）。同一设备先用
     `xcrun simctl io <udid> enumerate` 找到 `Device Name: primary`，再执行
     `screenshot --display=primary` 得到 1398×2034、`colorSpan=255` 的真实主屏。

     因此截图脚本必须显式选择 `--display=primary`（允许环境变量覆盖），并在保存后用仓库的
     `scripts/screenshots/png-stats.mjs` 拒绝 `looksBlank` 的文件；截图存在、PNG 可解析和命令退出 0
     都不能单独作为画面证据。最后仍须人工查看，尤其是通知中心这类系统 UI，不能把锁屏壁纸或应用详情页当通知可见。

     同日 11:42 找到另一个独立取证故障：AX shim 已切到 TCP companion，直接 `idb screenshot`
     和 `ui swipe` 却还传 `--companion-path 127.0.0.1:10982`（此参数要求可执行文件），错误被
     `|| true` 吞掉。改成 `--companion host:port` 后实际下拉成功，人工看到同一已回执任务标题。
     传输方式必须集中给所有 AX/HID/截图调用消费，手势错误必须判红；截图前先清同名旧图，
     否则工具失败后 `-s` / `looksBlank` 检查可能检查的是上一轮留下的成功 PNG。
     通知中心判据还须在系统 AX Button 的组合标签中匹配本轮唯一任务标题；详情输入框包含标题
     不算通知。该 helper 已在同一系统 AX 树验证：真实标题通过，替换成不存在的标题拒绝。

209. 🔴 **AX 按钮返回 success 不等于 React 异步写入已经发生；日期输入格式也可能让探针点错目标。**

     2026-10-04 iOS `pending-cancel` 续验初期，脚本以宿主输入的 `10/4` 寻找实际渲染为 `10-04`
     的删除标签；一次 plain press 还返回 success，结果 SQLite 仍只有 REMINDER `CRT`，ledger 也未清空。
     根因是探针日期格式不等于 UI 格式，且 AX success 本身不是业务完成证据。修复为从 ISO 日期生成
     `MM-DD` 标签后，真实 Release 续验 21/21 通过；并补上了同一 `entityId` 的 `REMINDER DEL` 与
     删除后同一详情页截图。规则仍然保留：异步动作点击后必须回读实际状态，至少证明对应 op 落库、
     行从 AX 消失、或原生 pending/ledger 清空；否则只能报告“点击已发送”。
210. 🔴 **`pnpm --filter <名字>` 报 `No projects matched the filters` 不等于"这个包不在工作区"** —— 先核名字，再下结论。

    我把 `server/` 写成 `pnpm --filter @heyta/server typecheck`，得到那句"没匹配上"，
    读起来就像"服务端不在 `pnpm -r test` 的范围内、它的 spec 要手工接线"。
    现量两处把它否证了：`pnpm-workspace.yaml:3` 就列着 `server`，而
    `node -e "console.log(require('./server/package.json').name)"` 打出来是 **`@heyta/sync-server`**。
    ⇒ 名字错一个词，边界事实整个读反。

    同族的第二种误读，一起记：`server/tsconfig.json` 的 `include` 只有 `src/**/*` 与 `scripts/**/*`，
    **不含 `tests`** ⇒ 在 `server/` 里跑 `tsc --noEmit` 拿到 exit 0，**不能当成"测试文件也没类型问题"**。
    判据：写 spec 之前先看它落不落在 tsconfig 的 `include` 里，不在就单独说明。

211. 🔴 **一个文件如果 `import` 就等于"跑一遍"，它就永远测不到** —— 而"某条路径零测试"的表面理由，往往不是没人想写。

    `server/scripts/recover-user.ts` 头上挂着 `Status: UNVERIFIED against real encrypted data`，
    解密 + 重放那一段确实一条测试都没有。两个形状是原因：
    ① `main()` 挂在模块顶层且没有门 —— `import` 它就等于读 argv、连库、`disconnect()`；
    ② 解密函数用 `require('../../sync-core/src/encryption')` 拿（摸的是**隔壁包的源码路径**，不是包名），
      只有 `ts-node --transpile-only` 解析得动，签名靠一行 `as` 手写，vitest 里根本进不来。

    把这两处修掉（`if (require.main === module)` + `import { decryptBatch } from '@heyta/sync-core'`）之后，
    那条路第一次被**真密码学**跑通，而且当场照出两个静默缺陷：
    脚本自己抄的那份 prisma `select` 少两列 ⇒ 少 `entityIds` 让**批量删除在还原文件里复活**（#8340 的第二份抄件），
    少 `repairBaseServerSeq` 让**用过 REPAIR 的账号根本恢复不了**（报的还是"legacy"）。

    📌 三条一般规律：
    1. 脚本类产物要可测，就先给它**入口门**与**走包名的 import**，这不是"顺手重构"，是让别人能验它。
    2. 缺陷会**互相遮蔽**：同一份日志里先抛错的那条挡住了后面"数据复活"那条 —— 把 REPAIR 摘出去单独跑才量到第二档。
    3. 抄一份列集合 = 埋一份会漂的抄件。修法不是"补两列"，是**取消第二份**（用快照路径导出的那一份）。

213. 🔴 **"落地之后才装"这道顺序门，如果只判"main 有没有前进到载体"，就会放过反方向 ——
    从**落后 main 若干笔的载体**装一遍，而输出一眼看上去就是"四端已交付"。**

    04:59 现量（另一条线的重装队列真的开跑了）：

    ```bash
    git -C <主检出> merge-base --is-ancestor integrate/2026-10-03-closeout d0a81927   # 退 1 ⇒ 不含本线
    git rev-list --count d0a81927..main                                              # 19
    ```

    它的脚本自己印了 `检出 HEAD=d0a81927`，也印了 `install rc=0`，注释里还**专门**处理了
    "main 还没前进到载体"那一支 —— 也就是说这一族缺陷不是"没人想过顺序"，而是
    **只检查了一个方向**。落后 19 笔里含另一条线已经落的整批改动，装完之后四端就是那 19 笔之前的样子，
    而取证图、`ADD_APPX=OK`、`M2D=OK` 全部会绿（第 82 条的老形状，换了个成因）。

    📌 可迁移的一句：**凡"从某个检出打包装到别的机器/另一个目录"的流程，
    要同时量两个方向** —— `载体 ⊆ main`？以及 `main \ 载体 = ?`（后者按**打包输入集**数，
    见第 206 条）。只量一个方向的门，会把它没看的那一侧当成"另一侧已经安全"。

212. 🔴 **别人改了代码，把我写的政策句子改成了反话 —— 而"扫过期句子"的门禁看不见方向。**
    政策里那句"注销后本机当场清掉"有一个**二选一的事实**垫着：桌面壳上到底
    **哪一份**留在盘上。写的时候是"界面那份（WebView 存储）留在盘上"，
    因为那时候界面上的可读数据确实在 WebView 里。

    `3b6d46df`（"壳内存储改真 SQLite"）把这件事整个倒过来：`apps/web/src/lib/oplog.ts`
    现在**先**探 `window.__heytaHostStoragePort`，探测到就走 `resolveStorageBackend() === 'shell'`，
    可读数据从此写进**壳的 `heyta.sqlite`**；而销毁通道注册的仍是页侧那份
    `eraseWebLocalData`（IndexedDB / OPFS / localStorage / SW）。⇒ 政策继续说"清掉的是壳那一份、
    界面那份还在盘上"，就成了**对用户说反**：真清掉的是界面那一份，还在盘上的是壳的库文件。

    🔴 **为什么全仓没有一层会红**（这一问比发现缺陷本身更值钱）：
    · `check:legal-copy` 比的是**生成物与真源**，而 `gen-site-copy` 每份只搬 4 条元数据 ——
      **正文根本不在生成物里**，所以它永远不会因正文而红（这同时是好事：正文只有一份）；
    · `@heyta/legal` 的 `structure.spec.ts` 62 条比的是中英块数与形状，方向反了它照样绿；
    · 我这批那条 `check-legal-closure-truth` 扫的是**"今天还不存在"那一类过期句**，
      对"句子仍然成立但事实换了一端"完全无感。

    ✅ 修法分两层，缺一层都还会漂：
    1. **改正文**（`data-rights` 第五节中英各一处 + 中英两条 1.2 变更表措辞；
       1.2 尚未发布 ⇒ 折进同一版而不是再 bump，版本没变所以指纹与同意记录都不用重做）；
    2. **给门禁加"方向腿"**：运行时读两个代码前提（`oplog.ts` 里有没有 shell 后端 +
       线协议主人 `oplog-worker-bridge.ts` 里有没有 `destroy`），推出三种状态各自要求哪一句，
       **不把"当前是哪一态"写死** —— 写死了下一次倒过来照样没人红。

    读数：`--self-test` 六个合成分支全按预期红/绿；真跑 `方向对账前提现量：壳托管存储 = true /
    销毁够得着壳的库 = false`，正文无一条方向不符（仍红的 3 条是别人文件里的过期句，不代改）。
    **原地变异**（把中英两句换回改之前的措辞、重打 dist、再跑）⇒
    `❌ 2 条方向对账不符 · data-rights zh-CN / en 栏还在说"留在盘上的是界面那一份"`，
    还原后 `cmp` 与变异前逐字节相同、方向不符计数回 0。

    📌 三条可迁移的：
    · **"扫过期句"和"扫方向"是两类判据。** 前者问"这句话还是真的吗"，后者问"这句话指的那一端还是不是这一端"。
      事实是**二选一**的那种承诺（哪一份留在盘上 / 哪一条通道先落地），只会漏在第二类里。
    · **一份文档里有多个宿主时，"哪一个"必须显式写出。** 我当初那句读起来像"桌面壳有个第二存储"，
      没有说清数据此刻住在哪一层 —— 含糊的承诺会被代码改动**悄悄推翻**，明确的承诺才会被门禁抓住。
    · **不抄第二份的那一份不会漂。** 同批写的 `minors` 那句只说"逐端清到哪一层以第五节为准，
      本文件不抄第二份"，所以这次翻转它一个字都不用改 —— 方向腿也**故意**不套到它头上，
      套上去等于奖励它抄第二份。

    **2026-10-04 B/C 同类补例**：落地页浏览器套件 18/18 通过，但打开口令文章截图后发现
    “唯一钥匙／没有恢复途径”仍在正文；提醒文章同时保留“后台只能靠自建推送”的旧句。
    两端功能已变，页面渲染与中英词条形状测试不会判断承诺真假。修复在原 `site.help.a.passphrase`、
    `site.docs.passphrase/account/loss/reminders` 中英词条完成，并重生成四份 FAQ/口令 HTML 的
    JSON-LD 与 SEO 元数据。新旧密文的迁移边界、恢复码与登录重置的区别、原生提醒的权限与
    排程窗口必须明确；不能把“文档更新”缩成只修 ADR 或权限清单。
    后续看设备撤销截图又发现同步设置、集成页和自建文档仍有“忘记口令无法恢复”的旧句，
    已同步修正 5 对词条。能力承诺的检索范围要包含应用内说明与营销/自建文章，不能只检查帮助入口。
    首启隐私面板也保留了“本机模式不投递通知”的旧暗示，但原生提醒 reconcile 不依赖联网同意。
    已在同一中英词条中区分服务器推送与系统授权后的移动本地通知；更新后真实隐私浏览器
    7/7 通过（8.6 秒），首启截图已打开确认文案和布局。零出站断言证明联网边界，不能据此推断
    OS 本地通知被禁用，也不能把这张 Web 图作为移动端投递证据。

214. 🔴 **`notarytool` 会挂在打包脚本的尾巴上挂几个小时：产物早就写完了，进程却还"在场" ——
    "进程存在"不是"在干活"的证据。**

    05:21 现量（本机另一趟四端重装的 mac 段）：`package-app.sh`(pid 95477) 的叶子是
    `/Applications/Xcode-…/usr/bin/notarytool`(98934)，`stat=SN / %cpu=0.0 / time=0:00.03`，
    **8 秒两次采样 CPU 零增量**，而它要公证的 `Heyta-1.0.0.dmg` 早在 **03:13** 就产出完了
    （`/tmp/heyta-macos-dist` 里 mtime 为证）。也就是说这一趟**既不会成功也不会失败**，
    只是把"有人在重装"这个信号一直占着。

    两个后果，都是今晚真遇到的：
    ① 它把别人的交付窗口无限期按住（凡是拿"进程在不在"当现场门的门都会中招）；
    ② 它自己的日志看上去停在"正在公证"，等不到结论行 —— 读这类日志要**先量 CPU 增量**再说"它在跑"。

    判"活"的正确形状（本次落进 `heyta-deliver-on-window.sh`）：对进程树全部 pid 取
    `ps -o time=` 的 CPU 百分秒，**间隔 6–8 秒采两次**，增量 ≥0.5s 才算在干活。
    两腿对照（05:22 本机现跑）：挂死那棵 增量 = `0`（判挂死），
    临时 fork 一个纯计算子进程那棵 增量 = `600` 百分秒（判在干活）。

    ⚠️ 反过来也别走极端：**"挂死"不等于"可以让它"**。它可能只是慢（网络在重试），
    醒来就真会去写 `/Applications` 与设备。所以本线那条门是这么分的 ——
    只读/只算的阶段（取 ② 的链读数）按 CPU 增量放行；
    会动安装包与设备的阶段（③ 重装）**仍按"进程存在"严格挡**，要往下走得由人处置那个进程。

215. 🔴 **把验收搬到隔离检出（worktree）里跑，缺的不止 `node_modules` 和 `dist/` —— 还有
    **gitignore 掉的必需配置**。本机这个的形状是：`server/.env` 不会跟过来，症状写成"服务端 80 秒没起来"。**

    2026-10-04 05:37 实测（载体 `tmp/w6c-run.sh` 第 7 步，隔离检出 `heyta-wt-trash-e2e` @ `99ea54c1`）：
    建库、迁移、`pnpm -r build`、`server/dist`、APK 全部就绪，起服务端却超时，日志尾部是

    ```
    Error: JWT_SECRET environment variable is required.
        at getJwtSecret (…/server/dist/src/auth.js:63:15)
    ```

    机制：服务端 `import 'dotenv/config'`（`server/src/index.ts:1`）读 `server/.env`，而它被
    `server/.gitignore:5` 忽略 ⇒ `git worktree add` 出来的检出里只有 `env.example`。
    主检出上没人碰到这一条，是因为那里 `.env` 一直在（05:4x 现量：`-rw-------@ server/.env`，3541 字节）。

    🔴 **启动自检一次只抛一个**：`JWT_SECRET`（`server/src/auth.ts:34`）之后还有
    `PASSWORD_PEPPER`（`server/src/password/hash.ts:50`，`MIN_PEPPER_LENGTH = 32`，`hash.ts:37`）——
    这句先按 `scripts/lib/auth-journey-server.mjs:275-285` 的注释（"补上后崩在 PASSWORD_PEPPER"）写，
    **06:0x 已实测成立**：同一份载体只加这两个 env 直传，服务端**第 2 秒**就 `/health` 通过（pid 19798）。

    两个容易踩的地方：
    ① 等待循环只看 `/health`，抛错发生在启动那一瞬 ⇒ 读数表现为"超时/起不来"，
       **超时前必须 `tail` 日志**（那条载体的失败分支就带 `tail -20`，所以 60 秒内就看清了）；
    ② 不要为省事把主检出的 `.env` 拷进隔离检出 —— 那里面是**真凭据**，而一次性验收栈
       根本不需要复用它们。仓内已有正确形状：`secretFallback`（`auth-journey-server.mjs:233-236`）
       —— env 与 `server/.env` 两边都没有时现生成 `randomBytes(32).hex`，**直接进 spawn 的 env**
       （dotenv 不覆盖已存在的变量），用完随进程消失。

    📌 一般规律：**"必需但被 gitignore"的文件是隔离检出的第三种缺口**（第一种 `node_modules` 要重装、
    第二种 `dist/`/产物要重打 —— 这两条本线早就当流程步骤在做了）。搬流程前先
    `ls <worktree>/server/.env` 之类逐项确认"这份配置是靠忽略文件提供的吗"，是就把补齐写进那条链的步骤里，
    而不是写进人的记忆里。

216. 🔴 **验收脚本在断言失败的那条路径上根本不写产物 —— 于是"我去看了一眼那张图"
    看到的是上一趟（甚至上一天）的残留，而它的 mtime 是唯一会说谎的东西。**

    重截帮助中心那张回收站配图（W07）时，`scripts/screenshots/capture.mjs` 在
    "点了 tab 但选中态回读没通过"处抛错，而 `page.screenshot()` 在**它之后**（`capture.mjs:225`）
    ⇒ 这一趟**没有产出任何新图**。我随后打开那张 PNG 读界面、并据此判断
    "产物是旧的 / 文案只提任务"，实际读的是**当天 05:29 另一趟留下的文件**，
    而主检出里那张的 mtime 是 9-28（= HEAD 提交物）。两棵树的同名文件 md5 还**逐字节相同**，
    于是"两个载体互相印证"这个习惯在这里恰好把错误加固了一次。

    ✅ 修法不是"更仔细地看图"，是把**产物的时间戳纳入判据**：
    引用任何一张截图之前先 `stat -f '%N %Sm' <png>`，并把它和**这一趟的起跑时刻**比。
    比不过就不许引用。同理适用于 `apps/*/evidence/*.png`（§7 第 82 条那族）。

    📌 一般规律：**"失败时不写产物"是正确的设计，但它让"文件存在"失去了含义** ——
    一个存在且看起来合理的产物，可能既是本轮的，也是上一轮的，也可能是提交物本身。
    所以判断"这是本轮的证据吗"必须靠**时间戳或哈希对账**，不能靠"它在那儿、我看了"。
    与 §7 第 46 条（没复现 ≠ 没执行）、第 176 条（桩在外面预取值）同族：**都是"读数与产生它的过程脱钩"**。

217. 🔴 **落地页的生成物 HTML 里根本没有正文 —— 拿它数"文案覆盖面"必然数错载体。**
    `apps/landing/docs/**/index.html` 由 `scripts/gen-entries.mjs` 生成，内容是
    **SEO 头 + `<div id="root">` + 一个 `<script type="module">`**（实测 `docs/trash/index.html` 全文 6860 B，
    第 119-120 行就是那两行）。正文由客户端从 `packages/i18n` 渲染。

    于是"这一页写没写某几个词"在这份提交物里**永远查不到**，而唯一能查到的那个词
    可能来自 og 卡片 alt（例：`本地优先的任务管理` 里的"任务"），于是
    **一份"只提任务、没提便签/清单/习惯"的读数可以被完整地伪造出来**，
    而真源里四个词全在（`site.docs.trash.s1p1` 中英各一条）。

    🔴 更深的一层：`check:entries` 逐字节比的是这份生成物，**它结构上不可能守住正文** ——
    正文漂移不会让 `index.html` 变。所以"文案覆盖面"的常驻判据只能长在词条表那一侧
    （本仓的形状是 `apps/landing/tests/trash-coverage-copy.spec.ts`：四类被点名 + 不进的三类带理由 +
    注册表↔词条双向对账），而不是长在 HTML 那一侧。

    📌 一般规律：**先问"这句文案真源住在哪一层"再数它** —— 生成物可以是壳，
    壳里没有正文；而"我在文件里搜过了"听起来像取证，其实只证明了载体选错时取证可以为零。

218. 🔴 **`pnpm exec` 在 `node_modules` 是软链的检出里会先跑依赖状态校验，
    校验判定"要清目录"、又因无 TTY 中止 ⇒ 用例一条都没跑就 RC=1 —— 而 RC=1 长得和"产品红了"一模一样。**

    把 e2e 跑在隔离检出（worktree）时，`e2e/node_modules` 是软链到主检出（§7 第 215 条那套做法）。
    `pnpm exec playwright test` 报：

    ```
    [ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY] Aborted removal of modules directory due to no TTY
    Command failed with exit code 1: pnpm install
    ```

    它甚至没进到 playwright。危险在于**这个红会被读成"干净检出里这条用例也红"** ——
    我差一点就这么写进了对账表。认出来的依据只有一条：
    **playwright 自己那行 `Running 1 test using 1 worker` 有没有出现**。
    没出现 = 载体坏了，不是用例坏了。

    ✅ 绕法：`PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm exec playwright test …`。
    ⚠️ **不要用 `confirmModulesPurge=false` 或 `CI=true` 去"顺从"它** ——
    那等于授权 pnpm 清掉一个目录，而这里的 `node_modules` 是**软链**，
    顺着它删下去会把主检出（别人正在用的那份）的依赖一起摘掉。
    📌 与 §7 第 176 条同族但方向不同：那条是"桩在外面预取值 ⇒ 用例没走到判据就返回，PASS 是假的"；
    这条是"**用例根本没走到 ⇒ 却拿到了一个看起来可归因的 FAIL**"。两种都是读数与过程脱钩。

219. 🔴 **隔离载体"显式拷一份未提交文件"这一步，必须拷这条改动跨的**全部**文件 ——
    少拷一个的症状是产品报错，不是载体报错。**

    批次 E 的恢复工具改动跨两个文件：`server/scripts/recover-user.ts`（用它）和
    `server/src/sync/services/snapshot-generation.service.ts`（把 `REPLAY_OPERATION_SELECT`
    从 `const` 改成 `export const`）。演练脚本只拷了前者，于是载体里那个 import 拿到的是
    **`undefined`**（`ts-node --transpile-only` 不查类型，静默通过），
    而 `{...undefined}` 是 `{}` ⇒ prisma 的 select 只剩我额外加的那三列 ⇒

    ```
    ERROR: Operation log starts at seq undefined (not 1) and that op is 'undefined'
    ```

    这句**读起来完全像产品坏了**（"恢复工具认不出操作日志起点"）。真因是载体少拷了一个文件。
    ✅ 修法两半，缺一半都会再踩：
    1. cp 改成**文件清单的循环**（清单由"这条改动碰过哪些路径"决定，不是由"我最近在编辑哪个文件"决定）；
    2. 紧跟一条**前提断言**：`grep -q '^export const REPLAY_OPERATION_SELECT' <载体里的那份>`，
       不成立就响亮 `DIE`。没有第 2 半，第 1 半会在下一次改动跨三个文件时再坏一次。
    📌 一般规律：**"拷贝式载体"把编译期保证换成了运行期拼接**，
    而 TS 的 `import { X } from './y'` 在一个**没有导出 X** 的模块上，转译模式下不报错、只给 `undefined`。
    所以这类载体的自检要问的不是"文件在不在"，而是"**这条改动依赖的那个符号，在载体里真的存在吗**"。
    与 §7 第 215 条（隔离检出缺的不止 `node_modules` 和 `dist`）同族：那条讲**缺文件**，这条讲**文件齐了但版本不是同一套**。

220. 🔴 **一条判据换了修法就可能变成永远红 —— 因为它的载体量的是"旧修法的痕迹"，不是产品的不变量。**

    批次 E 的臂 D 原来写成：数恢复产物文本里 `deletedAt` 出现几次（改前 **0 次** ⇒ 红，看起来正是
    "恢复产物丢墓碑"的直接证据）。修完之后**它仍然是 0 次**：
    `deletedAt` 从来不在 op 的 payload 里，它是客户端 reducer 从 `DEL` op 的 **timestamp 物化**出来的
    （`packages/op-log/src/state.ts`：`addFieldVersion('deletedAt', op.timestamp, false)`），
    而新修法（route B）让产物**只交 op-log**、实体由导入器物化 —— 文本里本来就不该有那个词。

    ⇒ 判据改成问产品真正在乎的那件事：**把这份产物导进一台空设备，回收站里那条还在不在**
    （真 `OpLogEngine` + 真 SQLite `:memory:` + 真 `restoreIntoEmptyTarget`，读数 `记录 3 条｜墓碑 1 条`）。
    📌 可迁移的检查动作：**改修法之后，回头重读每一条为这次修改而写的判据，问它量的还是不是不变量**。
    与 §7 第 82 条（"非空白"挡不住错误屏）、第 216 条（失败那趟不写产物）同族，但这条是第三种：
    **判据跟着旧实现留下了痕迹依赖，实现一变它就永远红 —— 而"永远红"和"还没修好"在输出上一模一样。**

221. 🔴 **界面上新增长驻的全屏浮层，会让整条截图流水线"点不动"，而症状长得像判据太严。**
    遮挡物必须在**导航之前**清 —— 只在就绪门控之后清，等于让"切视图"那一下落在遮罩上。

    10-04 实测：`capture.mjs --only W07` 两趟都报「点了「回收站」但它的 aria-selected 没变成 true」。
    上一轮把它记成了"假失败的候选真因"，并怀疑 `.first()` 命中了同名控件 —— **两条都被现量否证**：

    | 读数 | 结果 |
    |---|---|
    | `.first()` 命中谁 | `BUTTON.ht-rail__tab.ht-rail__tab--tool`，`role=tab`，父 `DIV.ht-rail__tabs` —— **就是该点的那颗** |
    | `elementFromPoint(按钮中心 32,402)` | 一个 `DIV`，`position:fixed; z-index:400; background rgba(15,23,42,.5)` —— **遮罩本身** |
    | 点击后视图（与 aria 无关的独立读数） | `.ht-rail__tab--active` 仍是「任务」、`ht-trash` 不在 DOM ⇒ **视图确实没切** |

    ⇒ 那条回读**报得对**，它拦住的正是一张"盖着同意卡、却命名为回收站"的假证据。
    真因：`PrivacyConsentSheet`（10-02 `881aa92a` 落地）是首启必现的遮罩，而
    `targets.mjs` 里 web 目标的 `dismissTexts` 全是 `[]` —— **清单没跟上界面**。
    而 `dismissTexts` 原先只在就绪门控**之后**跑一趟，那一趟只能清"视图内部"的横幅。

    ⚠️ 为什么现有产物没被污染、这条却仍然致命：zh 那批 mtime `09-28 21:44`、en 那批 `10-01 11:11`，
    都**早于** 10-02。所以缺的不是"图里有遮罩"，而是**10-02 之后任何一张 `openVia:'tab'` 的 web 图都截不出来了**，
    而这件事只有在下一次有人真要重截时才被发现。
    📌 可迁移：**给界面加"首启常驻浮层"是一堵墙** —— 它同时打断所有"点控件式"的验收
    （截图、e2e、设备脚本），而打断方式是一句看起来像"断言太严"的失败。
    加这类浮层时必须同批改：`dismissTexts`、e2e 的前置、设备脚本的首屏处理。

    ⚠️ **同一条上追补的第二层（10-04 08:1x）**：给失败路径加多行诊断之后，**必须复跑一次看它印出来没有**。
    `capture.mjs` 的 `catch` 写的是 `String(error).split('\n')[0]` —— 只取第一行，
    于是"是谁盖住了点击目标"那两行**在真实输出里根本不存在**，等于没修。
    第一趟复跑只看到首句才发现；改成打印前 6 行后，臂 1 的读数才有
    `该控件中心点上实际最靠上的是：DIV. [pos=fixed z=400]`。
    📌 一般规律：**"我加了报错信息"是一条关于代码的陈述，"报错里能看到它"是一条关于输出的陈述** ——
    前者由 Edit 保证，后者只能跑一次去看。判据变异臂要顺手把**新加的那几个字**写进期望式
    （这里把臂 1 收紧成 `…[\s\S]*最靠上的是：DIV[\s\S]*不要放宽`），否则诊断被截掉时臂仍然报"有牙"。


222. 🔴 **截图会把 hover / 焦点态一起截进去 —— 而"非空白 + 尺寸对"两道门禁都看不出多了一个气泡。**

    10-04 第一次截成功的 `W07-回收站.png` 里，回收站那颗导航按钮右侧浮着一个深色气泡写着「回收站」。
    机制不是 bug 而是设计：rail 刻意做成"只显示图标"，名字是**只在 hover / 键盘聚焦时出现**的浮层
    （`apps/web/src/styles/app/inbox.css` 的 `.ht-rail__label`，2026-09-30 产品负责人："侧边栏学习这个，只显示 icon，hover 显示真名"）。
    而 `openVia:'tab'` 的流程**必然**把鼠标和焦点留在那颗按钮上 ⇒ 每张"切视图"的图都带着它。
    那个状态用户平时看不到，拿它当"回收站长什么样"的配图，是在演示一个瞬时态。

    ✅ 修法：截图前 `page.mouse.move(0,0)` + `document.activeElement.blur()`（`capture.mjs` 的 `clearHoverAndFocus`），
    且必须放在"等动画收敛"那 600ms **之前**，否则把淡出留在图里。
    📌 可迁移：**截图类判据要声明"演示的是哪个状态"**。空白/尺寸/内容占比都是"有没有东西"的判据，
    回答不了"这是不是平时那个界面"。同族：第 82 条（错误屏非空白）、第 170 条（浮层当载体同时假红和假绿）。

223. 🔴 **验收脚本的两处"自锚定"会静默失效：探活地址写死 IPv4，以及 `new URL().pathname` 不解码 `%20`。**
    两者都不报"探针坏了"，只报"产品失败 / 窗口没开"，而这次各吃掉一个真实窗口。

    1. **vite 7 的 dev server 默认只绑 `localhost`，在这台 Mac 上解析成 `[::1]` 单栈。**
       探活写 `curl http://127.0.0.1:5173/` ⇒ 恒 `000`，而 `http://localhost:5173/` 是 `200`。
       实测后果：看守脚本在**负载已经让出来**（load1=10.68，阈值 12）那一趟，
       因为 60 次探活全空而判 RC=1"真失败"并停止重试 —— **一次白等的窗口，外加一条假的"链路里真失败"**。
    2. **`new URL('..', import.meta.url).pathname` 不做百分号解码。**
       这个仓库路径带空格（`All in one Data`），于是它拼出 `All%20in%20one%20Data/...` ⇒ `ENOENT`。
       正解是 `fileURLToPath(import.meta.url)`。
       ⚠️ 这条只在**从仓库内的脚本自己算根目录**时暴露；写死绝对路径的脚本永远碰不到它，
       所以换机器/换检出时才会第一次红。

    📌 可迁移：**探活/寻址失败要先当成"探针缺陷"处理**，而不是当成被测对象的状态 ——
    判据是同一趟里给一条 `curl http://localhost:…` 与 `curl http://127.0.0.1:…` 的**对照读数**，
    两者不一致就是探针的问题（§7 元规则第 1 条的第五种面目）。

224. 🔴 **"接线门禁"数的是登记表，不是磁盘上的脚本 —— 所以"写了门禁但从未登记"这一格它是瞎的。**
    判"某条门禁管不管 X"，要先问它**靠什么决定检查范围**；"它 rc=0"不等于"我的东西被它看着"。

    10-04 实测：`scripts/check-gate-wiring.mjs` rc=0，打印
    「门禁定义 **72** 道 ｜ 链里被引用 75 段 ｜ 链外 1 道（允许表 1 道）」——
    而同一时刻 `scripts/check-legal-gdpr.mjs` **确实存在、确实能跑、确实没有任何 `package.json` 条目**。
    它没让这条门禁变红，因为它的枚举来源是 **`package.json` 里的 `check:*` 键**，不是 `scripts/check-*.mjs` 这个目录。

    所以这条门禁的能力边界要按两半读：
    - **挡得住**："定义了但没进链" —— 那种必须进**允许表**，且允许表要求逐条写消费方 + 锚点在场
      （本轮实测输出里就有 `check:web-artifact:app ← docs/runbooks/deployment.md（2 处）` 这样两行）。
    - **挡不住**："实现了但从未登记" —— 一个孤儿 `.mjs` 对它是**不存在**的。

    📌 这**不是**该去扩那条门禁的理由（把目录枚举并进来，会让"半成品脚本"每次 push 都拦人）；
    正解是交付方自己负责：**门禁的"接线"是一格独立的交付项**，没接线就等于没有常驻判据，
    要在计划里写成"待接线的确切 2 行 diff + 为什么现在不能动那一行"。
    与第 217 条（生成物里没有正文 ⇒ 覆盖面判据只能长在真源侧）同一族：**判据的检查范围由它的输入决定，
    而输入往往不是你以为的那份清单。**

225. 🔴 **包装层"顺手补全"一个可选方法，会让上游那句 `=== undefined` 的能力判定失效 ——
    契约里刻意可选的键，只能在被包装对象真的有它时才挂。**

    `packages/storage` 的 `SqliteDriver.removeDatabase?` 是**刻意可选**（`sqlite-driver.ts:61-70` 写明理由：
    必填会让 Swift / C# 那些桥"改不动 → 整条契约被绕过"，所以宁可可选，由 `SqliteAdapter.destroy()`
    在缺失时如实报 `containerRemoved:false` + 原因）。而 `app-host` 的 `wrapDriver()` 要把原生驱动包成契约形状，
    写成 `removeDatabase: () => inner.removeDatabase!()` 看起来"更完整"，实际让
    `driver.removeDatabase === undefined` 永远为假 ⇒ **原生没实现也被报成"文件已删"**，
    而这正是这条契约唯一要防的那类假话（`db.types.ts:249`：漏掉它不会报错，只会继续留着用户的明文）。

    ✅ 修法：条件展开 `...(typeof native.removeDatabase === "function" ? { removeDatabase: … } : {})`。
    判据：`packages/app-host/tests/native-bridge-destroy.spec.ts` 第 ③ 条（驱动没有该方法时必须报"文件仍在"），
    变异臂 A（换成无条件挂键）⇒ **恰好 1 条红**，红的就是那一条。

    📌 一般规律：**给可选方法写适配器时，"转发"和"补全"是两件事** —— 上游用"键在不在"判能力，
    包装层就必须让"没有"在类型和值上仍然是没有。同族的另一种面目：把 `undefined` 显式写成键
    （`{ removeDatabase: undefined }`）在这一条上侥幸无害，但换成 `!= null` 判定的调用方就会翻。

226. 🔴 **往一个共用的 `postMessage` 端口上"也加一个接收方"，只能用多播机制（`addEventListener`）；
    用单槽 `onmessage` 会顶掉被观察者自己的接收能力，而症状出现在别处。**

    原生壳注入的 `window.__heytaHostStoragePort` 今天被两处同时用：引擎的 op-log 会话
    （`createWorkerOpLogSession`）和本机销毁那发 `oplog-destroy`。
    `oplog-wire-codec.ts:170-188` 的 `createOpLogWirePort` 两种机制都支持（它面向"独占端口的 Worker"），
    照搬到共用端口上时，`onmessage` 那一档会把引擎会话的接收方顶掉 ——
    表现是"注销点下去之后那一次写入静默丢失"，而销毁自身的判据**照样绿**。

    ✅ 修法：销毁路径先判 `typeof raw.addEventListener === "function"`，不满足就如实报
    `host-port-single-slot-receiver`，不做"两边都支持一下更保险"。
    判据：`packages/app-host/tests/host-storage-erasure.spec.ts` 第 ③ 条断的是
    **`raw.onmessage` 仍然为空**（不是断"我发的消息收到了"），变异臂 C（去掉那道门）⇒ 恰好 1 条红。

    📌 与第 80 条（react-native-web 在 keydown 里 `stopPropagation()`）同一族：
    **在共享通道上"我也监听一下"之前，先问这个通道是单槽还是多播。**
    单槽接管在输出上长得和成功一模一样，而且坏的是另一条路径。

227. 🔴 **变异臂打印"0 条红"之前，必须先证明那一趟真的跑过 —— 计数为 0 和一条都没跑，在输出上长得一样。**
    2026-10-04 09:1x 在两臂 Windows 销毁探针上连撞两次：第一趟 `A_FAIL_LINES=0 / A_RESULT=`（空）`/ RUN_RC=1`，
    读起来像"变异体存活 = 判据没牙"，实际是我的驱动脚本**没重建远端目录**（上一趟收尾 `rmdir` 掉了），
    只传了被测那一个 `.cs`，于是 csproj 不在、`dotnet` 构建失败、程序一行 `LP_` 都没打。
    同一形状在 `pnpm exec`/内存闸门那一族也见过（RC=1 但没有任何用例结论）。

    ✅ 修法有两条，都要写：
    1. **臂日志尾部必须和计数一起打出来**（`tail -6`）。构建/前置失败只出现在尾部，计数里看不见。
    2. **每臂自带"这一趟跑过了"的正向哨兵**：这个探针是 `LP_RESULT=` 那一行；
       对没有自打哨兵的套件，哨兵就是 `Tests  N passed` 这类汇总行。
       取不到哨兵 ⇒ 判"环境无效"，不判"变异存活"，也不判"通过"。

    📌 与第 46 条（"没复现 ≠ 路径没执行"）同族，但**方向相反**：#46 讲的是被测代码的前置条件没满足；
    这一条讲的是**验证装置自己的前置条件**没满足，而它冒充的是"判据没有牙"这个关于产品的结论 ——
    比假绿更贵，因为它会把人推向"改判据"。

228. 🔴 **"跑过了"只能由那一趟自己打出的摘要行证明 —— `pnpm --filter` 的包名打错会退出 0，而套件有红时摘要行长得不一样。**

    2026-10-04 09:4x–09:5x 同一轮里两个方向相反的骗法各命中一次：

    1. `pnpm --filter @heyta/server exec vitest run tests/…` —— `server/` 的包名是 **`@heyta/sync-server`**。
       pnpm 打印 `No projects matched the filters` 之后**退出 0**，于是 `SPECS_RC=0` 和 `TYPECHECK_RC=0`
       这两条"读数"底下一个用例都没跑、一次类型检查都没做。同一族还有 `pnpm -r typecheck`：
       没有 `typecheck` 脚本的包被静默跳过（server 就没有），所以"`-r typecheck` rc=0"**从来不包含**它。
    2. vitest 有失败时打的是 `Tests  1 failed | 65 passed (66)` —— 紧跟在 `Tests` 后面的那个数字是 **failed** 那一列。
       按 `Tests +N passed` 去抓 passed 会抓空 ⇒ 我的载体脚本把 `ARM1`/`ARM3` 两趟**真红**报成"这一趟没真跑"。
       若不是直接把日志读到底，这轮就少两条变异读数，而且报出来的方向是"那两条判据无效"。

    ✅ 判"跑过了"的写法：只认**这一趟必须同时存在的两行**（`Test Files …` 与 `Tests …`），
    缺任一行就记 `NO_SUMMARY`（环境无效），既不记通过也不记红；取数字按列位分别取，
    不要用"关键字邻接数字"去猜（`grep -oE 'Tests +[0-9]+ passed'` 就是那种猜）。

    📌 与 #227 相邻但不同：那条是 `rc=1` + 零输出被读成"变异存活"；这条是 `rc=0` + 零输出被读成"通过"，
    以及 `rc=1` + **有**输出被自己的解析器读成"没跑"。三条合起来是同一句话 ——
    **退出码属于包装命令，摘要行才属于被测命令。**

229. 🔴 **变异针只替换了三元表达式的第一行 ⇒ 变异体根本编译不过，那一臂只得到 `Tests  no tests`；
    而"针坏了"与"判据没牙"在输出上长得一模一样（都是 0 条红）。**

    2026-10-04 实测（`packages/app-host/src/account-closure.ts` 的臂 B，要把"壳没删成"折成成功）：
    原文是**跨三行的单个 `return`**：

    ```ts
    return reports.some((r) => !r.containerRemoved)
      ? { disposition: 'closed-erase-partial', reports }
      : { disposition: 'closed-and-erased', reports };
    ```

    针的 `from` 只写了 `? { … }` 那一行。替换掉它之后 `: { … };` 成了孤儿表达式 ⇒
    `src/account-closure.ts(75,5): error TS1128: Declaration or statement expected` + tsup 的 dts 阶段失败，
    **两趟**都只报 `Tests  no tests`。第一趟我把它记成"这条判据抓不住"，方向完全反了。

    ✅ 两条修法，缺一不可：

    1. **针替换整个表达式/语句**（这里＝三行一起进 `from`，两个分支都改成 `closed-and-erased`），
       语义与类型同时成立；改完先跑一次 `preflight` 打印每个 `from` 的**命中数**（≠1 就停手）。
    2. **臂脚本里加硬守卫**：`BUILD_RC != 0` ⇒ 立即还原并判 `BUILD_FAILED_INVALID_ARM`，
       **这一臂不进读数**，绝不把它的 0 条红写成"变异存活 = 判据没牙"。

    📌 一般规律：**变异运行有四个失败层 —— 编译 / 用例装载 / 断言 / 判据强度**，只有最后一层才是产品结论。
    与 #176（桩在外面预取值 ⇒ 用例没走到被测判据就返回）同族：症状都是"绿/无红"，根因都在被测之外。

230. 🔴 **提醒验收先等到期、再杀进程 ⇒ 不能证明 killed-process 投递。**

    2026-10-04 核对 `scripts/verify-mobile-ios-reminder.sh` 发现，旧 full 模式固定等待约 180 秒，
    到达提醒时刻后才调用 `simctl terminate`。即使通知最终出现，这条顺序也只能证明前台进程或
    回调路径工作，不能证明 iOS 在 App 已退出时保留并投递 pending request。规则是：从真实的
    从真实 SQLite CRT 回读毫秒 `triggerAt`，在触发前终止；用 `simctl launch --console` 会话的退出
    作为进程退出证据；再精确等待到 `triggerAt`，随后才截取通知中心并回读 receipt/SQLite。实测
    `terminateAt=1791082360426 < triggerAt=1791082380000`，等待到 `1791082380328`，同一
    occurrence 的 exact `firedForTriggerAt` 回读通过，但截图仍是 SpringBoard 主屏，不能算通知中心
    标题可见。固定 sleep 只能作为轮询间隔，不能作为到期、退出或系统通知可见的判据。

231. 🔴 **对账类门禁的对账宇宙是"注册表 × 链"，看不见"文件存在但从没被注册" ——
    于是"我们有这道门禁"是一句主张，不是一次运行。**

    2026-10-04 实测：批次 E 的两份常驻门禁（`scripts/check-legal-gdpr.mjs`、
    `scripts/check-legal-closure-truth.mjs`）随 `fcff5bbb` 进了 HEAD。文件在、单跑 exit 0，
    但 `package.json` 里**没有定义**、`pnpm check` 里**没有那一段** ⇒ 每次全量门禁都从不执行它们。
    而链的对账器 `check:gate-wiring` 报的是 `门禁定义 73 道 ｜ 链里被引用 76 段 ｜ ✅ 对上了` ——
    它比的是**定义集合 vs 链**，孤儿文件既不是定义也不是链段，**落在它的射程之外**。

    现量（一次就够，命令可重跑）：

    ```bash
    for f in scripts/check-*.mjs; do b=$(basename "$f"); \
      grep -q "node scripts/$b" package.json || echo "ORPHAN: $b"; done
    # 实测 52 个 check-*.mjs 里 3 个孤儿：上面那两份 + check-module-boundaries.mjs
    # （第三份是 09-27 的模块写入租约工具，本质是流程装置不是门禁，不在本批范围内动它）
    ```

    ✅ 修法分两层：(1) 把两份接进 `package.json` 与 `check` 链；(2) **用注入臂证明接线有牙** ——
    `check:gate-wiring` 自带 `--pkg <候选 package.json>`，把链里那段删掉再喂给它：

    ```bash
    node scripts/check-gate-wiring.mjs --pkg tmp/pkg-unwired-legal-gdpr.json   # rc=1
    # 🔴 check:legal-gdpr: 定义还在，但不在这次的 check 链里 —— 它不会再被跑，而链子照样绿
    ```

    ⚠️ 但"接线有牙"只覆盖**定义已存在、链里少了**那一种；**文件在、定义从来没有**那一种
    仍然看不见（这次就是靠人工 `for` 循环普查出来的）。要把它钉住，得给 `check:gate-wiring`
    加一维"每个 `scripts/check-*.mjs` 至少被一个定义引用"—— 那是**别人那道门禁的形状**，
    本批不代它改，登记在这里当作现量缺口。

    📌 一般规律：**问"这道门禁在不在"要问两件事 —— 文件在不在，以及谁跑它。**
    与 #191（挂在文件名枚举上的门禁，目标文件被删时安静地不执行还照样打印通过）同族：
    那一族的所有变体都指向同一句话 —— **判据的运行本身也要有消费者**。

232. 🔴 **同一个 `echo` 里混 `$?` 与 `$(…)`：命令替换先跑，打出来的"退出码"是那条 grep 的。**

    2026-10-04 实测：`node … > log 2>&1; echo "rc=$? | $(grep -m1 '🔴' log)"` 打出 `rc=0`，
    而同一命令单独跑是 **rc=1** —— 差点把两臂"摘掉接线"的变异读数记成"门禁没有牙"。
    这是 #179（`echo EXIT=$?` 接在 `tee -a log` 上 ⇒ 那个码是 `tee` 的）与 #184
    （zsh 里 `${PIPESTATUS[0]}` 是空值）的第三张面目：**码属于谁，取决于它前面刚完成的是谁**。

    ✅ 固定写法：先 `rc=$?` 存进变量，再做任何带命令替换的打印。

    ```bash
    node scripts/x.mjs > log 2>&1
    rc=$?
    line=$(grep -m1 '🔴' log)
    echo "rc=$rc | $line"
    ```
233. 🔴 **`git apply` 是原子的，而 `--3way` 会写索引 —— 这两条合起来能把"搬一份补丁"变成两件事故。**
    11:0x 实测（把批次 E 的 route (B) 从隔离载体搬进主检出）：

    1. **原子回滚**：补丁含六个文件，五个打印 `Applied patch to … cleanly`，第六个报
       `index.ts: does not match index`（那文件正被别人 ` M`）⇒ **前五份全部回滚**。
       症状是"我明明打了补丁，grep 关键串却是 0 命中"，长得像载体路径写错或改错了树。
    2. **写进索引**：`--3way` 成功的那几份状态字母是 `M `（暂存）而不是 ` M`。
       在五会话共享工作树里这等于把本批文件放进**别人一笔裸 `git commit` 的射程**
       （`git commit` 提交的是整个索引 —— 同一族事故本项目记过两次）。

    ✅ 修法两半：把已知在别人手里的文件**从补丁里摘出去**（那两处改动按行点名 `Edit`，
    与别人的 hunk 相隔 430 行，互不覆盖），落完立刻
    `git restore --staged <逐条点名路径>`（只退索引、工作树内容不动），
    再复量 `git diff --cached --name-only` —— 剩下的必须**只有别人的**条目。

234. 🔴 **探针写成"看不见就跳过"：界面一折叠，它要么不报红，要么对着错的对象跑完还全绿。**

    `e2e/auth-journey/helpers.ts` 的 `toCredentialStage` 原写
    `if (await serverUrl.isVisible()) await serverUrl.fill(SERVER)`。
    G-28（`4774b07e`）把自建地址与粘贴令牌收进展开入口后，默认 DOM 里根本没有那一栏
    （产品契约钉在 `apps/web/tests/auth-entry-default.spec.tsx` B 段：默认**没有**，点开关才出现且带预填值）。
    于是同一趟里出现两种失效：`verify:legal-links` 里**碰地址栏的 4 条全红**
    （红在 `getByTestId('auth-form-server-url')` 找不到），而**不碰地址栏的第 5 条照样绿**；
    `auth-journey` 那一族更糟 —— 静默不填地址，整条旅程对着**应用自身来源**而不是测试服务端跑完。
    🔴 jsdom 那四套当时都补了 `tap('auth-form-self-host-toggle')`，**只有 e2e 共享 helper 没补**
    ⇒ 改条件渲染的人更新了他能看到的那层判据，看不见的那层就自己漂走。

    ✅ 修法：条件渲染的地方，探针要么**展开并断言出现**，要么响亮失败 ——
    `if (isVisible) doIt()` 只允许出现在"跳过本身就是正常路径"的地方，且那种地方必须写明为什么。
    读数形状：同一套件 4 failed / 1 passed → **5 passed rc=0**，两张关键截图人看过（政策页 + 另一台服务端真 404）。
    📌 一般规律：**"1 passed" 那一枚是分母** —— 它把"整套件坏了"与"探针追不上界面"分开；
    只报红数不报绿数，下一次没人能区分这两件事。

235. 🔴 **内存闸门同样管 Playwright（rc=1 与产品红同形）；把负载当硬门会让浏览器读数永远取不到。**

    `pnpm verify:legal-links` 第一次被拒：`内存闸门拒绝启动：已有测试在跑（pid=…，它是：…node --test …）`
    并退出 **1** —— 症状与"套件真的红了"一模一样，而它连一个浏览器都没起。
    （`~/.tfa-shield/bin/node` 是包在 `--test`/vitest/playwright 外面的 shim，不只管单元测试。）

    载体窗口判据因此改成三条：**别人的 playwright 计数为 0** + **目标端口空闲**
    （`strictPort` 且 `reuseExistingServer:false`，撞上去会把别人的应用当被测对象）+ **`/tmp/tfa-test.lock` 不在**；
    锁**只等不 claim**（claim 之后闸门连自己的回合都拒）。
    负载从门槛降为**记录值**：这台机器上别人的构建长期把 load1 压在 12–17，
    按 `ncpu*3/4=12` 设硬门会让这条浏览器读数永远取不到 —— 改为跑完扫红集，
    出现 `Timeout of` / `waiting for locator` 就打"疑似负载造成，需安静窗口复跑再定性"。

236. 🔴 **iOS 详情页重复 AX 标签必须带出现序号；滚动后按“第一个当前节点”会误点另一张表单。**

    2026-10-04 在专用 iPhone 17 Pro 模拟器的提醒验收中，任务详情同时渲染“截止日期”和
    “排期起点”两张 `DatePicker`，两处快捷项都叫「今天」。初始 AX 树里两处分别在
    `y≈890` 与 `y≈1511`；旧 shim 只取精确标签的第一个节点，滚动过程中前一个节点离开树后，
    可能改拿第二处，或把重复标签报成不可达。点击命令仍可能返回 `success`，但写的是排期起点，
    后续截止时刻与 REMINDER CRT 都不存在。

    ✅ 修法：AX 查询提供从 0 开始的 `--occurrence`，滚动、重新定位、点击全程传递同一个序号；
    提醒验收明确使用第 0 个「今天」并在 SQLite 回读任务/提醒 occurrence。重复标签不能靠
    `exact` 解决，`exact` 只消除子串碰撞，不能消除同名节点。

237. 🔴 **macOS Bash 3.2 的 `set -u` 不接受空数组展开；验收脚本会在构建前假红。**

    2026-10-04 运行 iOS 提醒 Release 验收时，脚本在 `BUILD_OVERRIDES=()` 后展开
    `"${BUILD_OVERRIDES[@]}"`，macOS 自带 Bash 3.2 直接报 `unbound variable`，连
    `xcodebuild` 都没有启动。换成数组初始化或在别的 Bash 版本复跑都不能证明本机验收有效。

    ✅ 可选的单个构建参数应使用空字符串 + 分支调用，或显式关闭 nounset；本脚本已改为
    `BUILD_OVERRIDE=""`，无覆盖项时完全省略参数。若共享工作树另有不可选原生模块编译错误，
    必须用脚本已有的 `HEYTA_IOS_EXCLUDE_CARD_EXPORT=1` 隔离，并在日志中记录这是载体环境限制，
    不能把提醒链误记成产品失败。

238. 🔴 **非 UI 宿主缺少 authenticated `accountId` 会把 Vault 密文误判成服务端损坏。**

    2026-10-04 Android Release 的 root rotation 之后，用真实 Node/SQLite 新设备下载同一任务时，
    初始宿主只传 JWT 与 E2EE 口令，服务端请求成功但解密结果是 `undecryptable-page`。根因不是
    payload 或 root 错了，而是宿主没有 account-bound Vault session，于是选择了 legacy password
    codec。修复为 `NodeHostOptions.accountId` / `--account-id`（或 `HEYTA_ACCOUNT_ID`），并在打开
    非 UI 宿主后显式 unlock key package，随后同一设备真实同步得到 1 条任务、0 pending。
    规则：只粘贴 JWT 只能配置同步，不能产生 Vault authenticated account；Node/SQLite、脚本和其他
    非 UI 宿主都必须传稳定 accountId，并显式解锁，不能静默降级到 legacy cipher。

239. 🔴 **移动端滚动后复用旧 AX bounds 会把“点击成功”写到错误控件。**

    Android Release 真实认证旅程中，登录/保存按钮在 ScrollView 底部；滚动后旧 AX 树的坐标已经失效，
    复用它可能仍返回点击 success，却没有推进 session 或保存同步凭据。每次滚动都必须重新读取
    当前 AX 节点和 bounds，再计算点击；点击后还要回读界面状态与 SQLite/op-log，不能把传输层 success
    当成业务完成。这个规则也适用于解锁、恢复和轮换按钮。

240. 🔴 **服务端 legal-consent 正常而旧的移动状态仍显示“同步停止”，不能把它误判为 Vault 失败。**

    2026-10-04 移动 Profile 曾显示“条款文本已更新、同步停止”，但同一认证绑定下直接请求
    `/api/account/legal-consent` 返回 `needsReconfirm: false`；Node/SQLite Vault 互操作随后真实成功。
    这类读数要拆成两条：服务端当前 legal gate 的响应，以及移动端本地 gate/UI 是否刷新。先确认
    server origin、accountId、tokenVersion 和进程生命周期，再把 stale UI 状态单独记录；不能因为
    “同步停止”文案就宣称密钥轮换、payload generation 或服务端同步失败，也不能用刷新 UI 掩盖真正的
    认证/加密错误。

241. 🔴 **台账里那个"稳定名"指针可以悬空 —— 而"读不到日志"会被写成"装置从没跑过"，
    真读数一直躺在按次文件里。**

    `research/tools/r14c-window-retry.sh` 的日志是两层的：按次唯一名
    `/tmp/ht-r14c-window.<日期-时刻>.<pid>.log` + 稳定名 `/tmp/ht-r14c-window.log`（台账只引用后者）。
    13:2x 现量：稳定名是**软链**，指向 `/var/folders/…/tmp.Yfj2LcsN5X` —— 目标早没了，
    `tail` 它一个字都不出。原因不是链坏了，是**这条规则落地之前的那一趟留下的旧指针**
    （"显式传 LOG 的臂不许挪稳定名"是后补的，补的时候只改了产生侧，**没人回头修那个已经指歪的**）。

    🔴 **代价不是少读一份日志，是归因整个翻掉**。本会话据此写下过：
    "上一趟看守 07:54 后 4h20m 零写入、停在第 21 轮中途、后台任务报 exit 143 ⇒ 它被 SIGTERM 收掉了"。
    拿按次文件复跑读数：`20261004-073739.80863.log` **2949 行、81 轮、
    `WINDOW=timeout（7200s 用尽）09:38:21`、`ALL_DONE final_rc=3`** ——
    它跑满了自己的预算并按设计以"环境无效"收尾，**没有任何东西杀它**。那句 143 属于别的任务。
    ⇒ **撤回写进本条**（§7 的老规矩：被否证的断言留原文并划线，别悄悄删）。

    ✅ 判据/规避（引用稳定名之前，两步都要）：
    ```bash
    readlink /tmp/ht-r14c-window.log                 # 它是软链吗？指向谁？
    [ -e "$(readlink /tmp/ht-r14c-window.log)" ] || echo 悬空
    ls -t /tmp/ht-r14c-window.*.log | head -1        # 悬空时取真实那一趟
    ```
    📌 **一般规律：把"每次唯一 + 稳定名指过去"当设计引入时，就同时引入了"稳定名可以指着
    一个已经不存在的对象"这一档** —— 修法必须带一条"回头把已指歪的指针修掉"，
    否则旧的那一枚会在下一次读证据时冒充"没有证据"。同理适用于 `$TMPDIR`（`var/folders`）
    里的任何被引用对象：macOS 会回收它，而 `/tmp` 里那个软链不会告诉你。

242. 🔴 **验证台的"让路/互斥"那道判据读的是活机器，不是夹具 —— 于是别人挂着时它整条臂红，
    而红的是装置。** 同一趟还抓出一枚 `set -u` 下的未赋值变量：**只在"现场真有别人在跑"
    那一档崩**，而那一档正是最该出读数的一档。

    现场（13:2x，两把都当场复现）：
    - `r14c-heal-fire-arms.sh` 的 `run_once` 传了 `SELF_GUARD=0`（关"C 让 C"），
      **没传 `CO_PATTERN`**（"C 让 H"是另一道独立判据）。那一刻 H 那把 flaky 看守活着
      （`ps` 现量 pid=27489）⇒ 臂 6/7/9 全部走到 `CO_RUNNER=alive ⇒ 让路`：rc=3、桩链调用 0 次，
      看起来像"载体自愈与开窗逻辑坏了"。**关一半 = 没关** —— 两道判据守的是同一张设备面，
      但它们是两个不同的模式串，旋钮也是一个管一个。
    - `r14c-gate-b-exclusive-arms.sh` 全文用 `EXP_RI`（T1 的期望集、T4 的"基线外不许冒 pid"）
      而**从来没有任何一行给它赋值**，文件是 `set -u`：基线为空时走不到那一支 ⇒ 一直"看起来是绿的"；
      基线非空（真有人在跑）时 `echo … [$EXP_RI]` 当场 `unbound variable` 死在**判决之前**。
      症状是 **rc=1 而日志里一个 ❌ 都没有** —— 那既不是红也不是绿，是装置没跑到结论。

    ✅ 三条：① 臂在隔离夹具里跑时，**所有"看现场"的旋钮都要钉死**（钉成一枚必不命中的模式，
    形状带 `[$]`：正控那枚假进程的名字由模式**去方括号**推出，所以它仍能命中自己的夹具）；
    ② "让路那一腿有没有牙"交给装置自己的 `SELFTEST=positive_ok` 那条正控，不在臂里重复测；
    ③ **收工判据里加一条"日志有 ❌ 还是根本没有结论行"** —— `rc!=0` 且末行不是 `结论：…` ⇒ 按装置坏查，
    不要按被测对象红登记。

243. 🔴 **"闸门 source 的每一枚 lib 都要进载体的判据覆盖清单"，而且这条要按闸门文件现读，
    不是漏一枚补一枚。** 漏的那一枚不崩，它只是让一条读数在**最需要它的时刻**悄悄消失。

    现量：`scripts/verify-mobile-window-gate.sh` 的 `source` 行有三枚 lib
    （`wait-for-quiet-host` / `wedged-runner` / `apk-freshness`），而
    `research/tools/r14c-carrier-chain.sh` 第 0 步的 `JUDG_PATHS` 里只有 `wedged-runner` 一枚 ——
    `apk-freshness.sh` 是当天新加的，**载体那份根本不存在**（`cmp` 现量：载体没有 / 载体没有 / 第三枚相同）。
    闸门只 `set -u` 不 `set -e`：缺 lib 就一行 `command not found` 继续跑，
    于是"动设备那一刻"的 APK 新鲜度读数不在，而输出上长得和"读了、没问题"一模一样。

    ✅ 落地形状：清单是**显式**的（每枚都进 md5 对账与跑完还原，按 `existed` 分还原/删除两支），
    对偶不变式由 `research/tools/r14c-chain-overlay-arms.sh` 守着 —— 它只解析**真正的 source 行**
    （第一版扫全文，把注释里"刻意不 source `lib/mobile-e2e.sh`"当成依赖 ⇒ 假红），
    判定式是"载体缺失或与主检出工作树不同才要求并列"。
    ⚠️ 那一档**按 sha 漂**：同一枚 lib 今天相同、明天别人改了工作树那份就变成"要求并列"。
    所以这里把三枚都写进清单（枚数由链源码现读 ⇒ 先验的 `OVERLAY 行数` 会跟着变，不用手改期望值），
    代价是一行注释，换来的是"这条清单等不等于闸门真的依赖什么"不再取决于载体恰好停在哪个提交。

248. 🔴 **Android 恢复/撤销验收里，输入、滚动和 CLI 参数都有“传输成功但业务没发生”的假绿形状。**

    2026-10-04 的 Android Release 设备撤销旅程固定了四条操作规则：恢复码控件在设置页底部时，
    先隐藏键盘再滚动，并在每次滚动后重新抓 AX 节点和 bounds；ADB 连续快速退格会丢按键，清空
    文本框要逐键退格并留出间隔；撤销后的顺序必须是“服务端 token version fence → 重新认证 →
    恢复码解锁 → 新口令/恢复码发布 → package 版本对账”，不能把 UI 点击返回成功当作轮换完成。
    另外，`apps/node-host/dist/cli.js` 的全局参数必须放在命令之前：

    ```bash
    node apps/node-host/dist/cli.js --db "$DB" --server "$SERVER" \
      --token "$TOKEN" --password "$E2EE" --account-id "$ACCOUNT_ID" --json sync
    ```

    把 `--db` 等参数放在 `sync` 之后会报“未知参数”，把 `accountId` 漏掉则会选择 legacy
    password codec，可能得到 `undecryptable-page`。每次 Node 互操作还必须回读 `status.kind`、
    `payloadKeyVersion`、任务列表和 pending 数；当前服务端若已被测试生命周期清空，`synced + 空列表`
    只能证明空历史同步成功，不能写成跨端任务互读。脱敏撤销顺序见 [ADR-0050](../adr/0050-e2ee-key-lifecycle-and-recovery.md)
    与 [Android 证据](../../apps/mobile/evidence/android-vault-revocation-20261004.txt)。

244. 🔴 **把楔住的那枚叶子放掉 ≠ 释放被它占住的共享面 —— 它多半只是让那一趟**
    **走到真的会动共享面的那一段。** 想建"一键放窗"之前先读这条。

    现场（13:3x）：占着设备面的是别人的 `reinstall-all`（root 93817，叶子 98934 =
    `notarytool submit … --wait`，龄 **10h06m** 而累计 CPU **0:00.03**，`scripts/lib/wedged-runner.sh`
    判 `wedged`）。第一反应是"那我把这枚叶子放掉，窗口就开了"。**读了 `scripts/reinstall-all.sh` 本体之后这句是反的**：

    | 事实 | 行号 |
    |---|---|
    | 段序是 `mac windows android ios` | `:161` |
    | mac 段判失败只是 `RESULT_mac=FAIL`，**没有 exit** | `:198` |
    | 失败只在**文件末尾**汇总成退出码 | `:489-504`（`exit "$FAIL"`） |
    | android 段的条件只有"这一端在不在 `WANT` 里" | `:295` 前后 |

    ⇒ 放掉叶子后那一趟会继续往下走，而 **android 段做的是 `adb uninstall` + `adb install`
    同一枚包、同一台 emulator-5554** —— 也就是说：**"放窗"这个动作会把共享面从
    "被一个不动的东西占着"换成"被一个真在写的东西用着"**，对我的窗口反而更坏。
    唯一真的释放是**停整趟**（root），而那会中断别人四条端的运行 —— 那不是本线能替他做的决定。

    ✅ 规矩（补 §8.9 那一族的一条判据）：任何"替别人解阻塞"的开关，动手前先读**那一趟接下来的代码**，
    回答"它醒来之后第一件事是不是动我正要动的同一个对象"。是 ⇒ **这个楔住状态是保护，不是阻塞**，
    登记成"要它的主人拍板"，不许做成一键。

245. 🔴 **自己数错的行号，会被写成"文件漂了" —— 给自己的错配一个外部原因，比错本身贵。**

    13:3x 在交接文档里引闸门那一行，先写成 `:126`（实际是 `:127`，`:126` 是那节的**标题行**）。
    两次 `sed -n` 输出对不上时，我落笔的解释是"那个文件被别人动过，行号已经漂了一次"，
    还顺手把它写成"所以这里故意不写行号"的理由。
    **现量否证**：`stat -f %Sm` = `12:59:29`（那两次读之间没有任何写入），`grep -n` 现取
    `DIRTY_SRC=` 在 `:127`、`?? 不判` 那句在 `:136` —— 两次读逐行一致，是我**数错了**，不是文件漂。

    为什么会写出那种解释：手里已经有"共享工作树里行号会漂"这条真经验（§7 多处），
    它是**现成的、听起来合理的**外因，而"我数错了"需要一个我不愿意付的动作（重新现取）。
    🔴 **可迁移的形状：一个真实存在过的成因，正好能为一个虚构的错误背书。**
    所以判"是不是环境/别人造成的"之前，先做那件最便宜的事 —— `grep -n` 现取 + `stat` 看 mtime ——
    两条命令就能区分"漂了"和"我读错了"。

    ✅ 规矩：**引用行号一律 `grep -n` 现取，不手数**；发现自己已经写了外因解释时，
    先验证它，验证不过就**留在原文里划掉**（别静默删掉 —— 删掉之后下一个人会把这句当没发生过，
    然后重犯同一个）。见 `docs/plans/calendar-profile-handoff.md` §4 F 那一段的同一形状。

246. 🔴 **给一条判据"装牙"的时候，牙长在计数那一层，而计数读的字段在某些分支根本不打印
    ⇒ 新判据永远数到 0，输出看起来完全正常。** 同一条里还有第二个坑：**负对照的对象被自己提前删了**。
    （2026-10-04 14:0x–14:1x，`research/tools/r17-evidence-md5-check.sh`）

    现场：这条工具原来只比"README 里记的 md5 == 盘上字节"。13:5x 发现
    `apps/web/evidence/calendar-year/` 四张真浏览器截图**连 README 都没有** ——
    而它的扫描根是 `apps/*/evidence/*/README.md`，**没 README 的目录连被扫到的资格都没有**，
    `dirs_scanned` 反而看着很健康。于是加了两档计数（有图无 README / 有 README 零锚点）。

    🔴 第二档当场是坏的，而且是**最坏的那种坏**：`check_one_dir` 在"解析到 0 条锚点"那一支
    **直接 `return 4`，压根没打 `DIRCHECK`**，而新计数是从 `DIRCHECK` 的 `entries=`/`pins=`
    两个字段 `sed` 出来的 —— 字段不存在 ⇒ `E` 是空串 ⇒ 条件 `[ "$E" = "0" ]` 不成立 ⇒
    **这一档恒为 0**。它不会报错、不会红、`--all` 照旧打印一行 `dirs_unpinned=0`。
    现量：**5 个目录 / 20 张截图**就这么隐身（`calendar-cells` 5、`auth-journey` 8、`calendar-week` 3 …）。

    修法两层，缺一不可：

    1. **把约定写死**：`check_one_dir` **只要跑到底就必须打 `DIRCHECK`** ——
       判决走返回值，账目走这一行。`EMPTY`/`SKIP` 两支各补一行零值。
       （同一族：`rc=4` 以前在 `--all` 里**既不进红也不进任何计数** —— 分类枚举的成员
       没有归宿，就是静默丢弃。）
    2. **让自测跑到那一层**：给 `--all` 加 `--root <合成树>`，臂 10 用四枚夹具目录
       （有图无 README / 有图零锚点 / 锚点对得上 / **无图**零锚点）断言
       **`ALLCHECK` 整行逐字段相等**。只测 `check_one_dir` 等于没测 ——
       坏的地方在计数与棘轮，不在单目录解析。

    📌 **可迁移的规律**：新加一条"数出来"的判据时，第一件事是问
    **我拿去数的那个字段，在所有分支上都打印了吗**。验证方法不是"跑一遍看是不是 0"
    （恒 0 的判据跑一百遍也是 0），而是**造一枚它本该数到的夹具**，看数不数。

    ⚠️ **第二个坑在同一轮里被同一条臂抓出来**：臂 9 的负对照腿是
    `grep -c tableshape`（那枚目录**有** README，不该被点名），期望 0。
    但臂 4 结束时已经 `rm -rf "$T"` 把整棵夹具树删了，臂 9 又 `mkdir -p` 在同一棵树下重建 ——
    于是 `tableshape` 早就不在场，**负对照恒 0**，和"扫描范围整个坏掉返回空集"**长得一模一样**。
    ✅ 修法：负对照必须配一条**全集计数**（这里 `noreadme_dirs` 在夹具树上恰好返回 1 行）——
    "没点名它"只有和"它确实在被扫的集合里"同时成立才叫负对照。
247. 🔴 **一条前置的保质期，取决于它拦的那条路径还在不在** —— 不核对就会把它写成永久自锁。
    而把前置换成后置对账之后，"这条闸门有没有牙"只能由变异臂回答，不能由"它现在不报了"回答。

    `research/tools/calendar-line-commit-plan.sh`（本线的入库复跑器）第 2 格原来写着
    **"索引必须是空的（共享工作树里非空索引 = 一笔吞掉别人的暂存）"**，非空就 exit 1。
    这句话的来源是一次**真事故**：裸 `git commit` 提交的是整份索引，实测带走别人 109 枚暂存。
    但这个工具**早就没有那条路径了** —— 第 5 格走 `git commit --only -- <点名路径>`，
    语义是"提交树 = HEAD + 点名路径的工作树内容"，别人在索引里那份既进不了这笔、也不会被抹掉。
    于是这条前置拦的是一条**不成立的路径**，代价现场可见：本机索引**长期**挂着并行会话的暂存项，
    A（入库）被它挡了一整个白天 —— 10-04 15:0x 现量 1 枚
    `apps/mobile/evidence/ios-node-vault-interop-20261004.txt`。

    ✅ 实测（一次性 /tmp 小副本；15:0x 手工一趟 + 15:4x rig 臂 1 一趟，外来暂存枚数分别为 1 与 1）：
    `git show --name-only HEAD` 里只有点名路径；别人那条的索引 blob 提交前后**逐字相同**、
    且提交后仍留在索引里。⇒ 前置换成"记录别人的暂存 → 提交后逐条对账"（第 5b 格）。

    🔴 **换完必须证明新那条会红** —— "只打印不判定"和"拦得住事故"在正常路径下输出一模一样。
    `research/tools/calendar-line-commit-only-arms.sh` 三臂：
    臂 1 正向（别人暂存 1 枚 ⇒ `--only` 之后 blob 不变、未进本笔、仍在索引、我的两枚进了 HEAD）；
    臂 2 把副本里的 `git commit --only` 改成裸 `git commit`（**复现那次事故的形状**）
    ⇒ 第 5b 格点名 foreign.txt 并以 rc=1 结束；
    臂 3 把**本线点名路径**暂存成与工作树不同的另一份内容（这才是"非空索引"里真有危险的那一种：
    `--only` 按工作树提交，那份暂存意图会被静默覆盖）⇒ 第 2 格 rc=1 拒绝、没有产生提交、那份暂存原样留着。

    📌 两条一般规律：
    1. **前置里那句"某某会出事"，要连它拦的是哪条代码路径一起读。** 路径换了（裸 commit → `--only`），
       旧结论就变成自锁。判"这条前置还成立吗"的办法是拿**当前那条路径**做一次真实反证，不是回忆事故。
       同族的第二种面目：把"索引脏"这个**表象**当成危险本身 —— 真危险只有一种
       （别人的暂存被带走 / 被覆盖），而它恰好不在"索引脏"这个集合里。
    2. **一条从没执行过的动作腿里的判据是死代码。** `--confirm` 这一腿从前在任何树上都没跑过，
       所以它的第一次执行**不该**发生在真仓库上。先在一次性小副本里用 PATHS_OVERRIDE 跑通，
       并把"它能红"做成臂。
       ⚠️ 副本里会撞到的两件事（都是本轮实测）：仓库特定的门禁在夹具里**必然红**
       （`check-md-table-rows.mjs` 按**文件名**读 `docs/plans/calendar-year-time-and-mobile-profile.md`
       直接 ENOENT、`docs-link-check.mjs` 的自检解析不到 `docs/runbooks/deployment.md` 就报"检查器本身坏了"），
       只能换成会自报的桩，并且**断言流程真的走到了被测那一腿**（这里断日志里出现 `== 5. --confirm`
       和 §3 打印的三个 rc）—— 只断"没红"就等于让桩替你判绿；
       另一件是夹具改动了脚本自己 ⇒ 防漏登记那格先 exit 1，把那条路径一起点名。

249. 🔴 **覆写型 e2e 套件把别人唯一的证据图重写了，而目录里的文件数一根没变 —— "134 张→134 张"这种计数自检在这一面目下恒真。**

    2026-10-04 16:52 那趟全量 `check:ai-e2e`（`157 passed / 2 skipped`、rc=0）跑完后我做了件以前没做过的事：
    把起跑前后各落一份 `e2e/test-results/*.png` 的 md5 清单做逐枚对账。读数：
    **起跑前 134 张、跑完还是 134 张**（不增不减），但**其中 62 张内容变了**。

    | 事实 | 取证 |
    |---|---|
    | 那 134 张**不在版本控制里** | `git ls-files e2e/test-results\|wc -l` = **0** ⇒ 没有任何一层会为"图被换掉"报红 |
    | 它们却被 **5 份文档**当证据引用 | 文档写的是"那批改动之后长这样"，保质期 = 下一次任何人跑任何 e2e |
    | `--output=/tmp/…` **挡不住** | 它只重定向 attachments；`page.screenshot({ path })` 那 **73 处写死路径**（现量 grep）照旧写进共享目录 |
    | 我自己第一版对账差点报"一张没变" | `join` 默认按**第 1 列**连，而两份清单都按名字序排过 ⇒ 拿**哈希**去连，连出 **0 行**。空读数在这一族里长得像"没问题" |

    ✅ 修法（两条，按成本递增）：跑任何覆写型套件前**先落 md5 清单**、跑完再落一份、按**文件名** join 并打印变化枚数；
    或者直接在隔离检出里跑（AGENTS §6.1.1 那条本来就是为这个）。要单条用例时用 `--output=` 只是**半个**修法，
    上面那 73 处写死路径它管不了。

    🔗 **与 #100 不是同一件事**，别合并：那条讲的是 Playwright 在运行**开头删掉整个共享 `outputDir`**（丢图）；
    这条讲的是**同名文件被就地重写**（图还在、名字还在、数量还在，只有字节变了）。
    📌 一般规律：**共享产物的对账要比内容，不能比清单**。枚数/大小/mtime 三个"看起来正常"的读数在这两族事故上都可能是原样不变的，
    📌 **归类**：验证产物目录是共享工作树的**第 4 种互踩面**（前三种：端口、安装包目录、设备）。
    前三类在本仓都有各自的闸门，第四类当时只有"半解"（`playwright.landing.config.ts` 用自己的 `landing-results`，
    而主 config 不设 `outputDir` ⇒ 六个 config 共用同一个默认值）。**分面归类比多写一条判据值钱** ——
    下次新增任何"共享可写产物"时，先问它属于第几面，再决定要不要建闸门。
    而引用了那些产物的文档不会为自己那句话的保质期报红。

250. 🔴 **往文档插一节时，锚点选了"标题 + 标题下面那行"，而替换文本只带回标题 —— 于是那一行被静默吃掉。同一次会话两种面目，第三次隔了 90 分钟又现形。**

    写 `docs/plans/trash-and-archive.md` 的 §10.22 / §10.24 时，两次 Edit 的 `old_string` 都落成了
    ```
    ## 11. 批次 B 执行账（…）      ← 边界行
    <空行>
    ⚠️ **全部未提交**（…）          ← 边界行之后还有一行，也在匹配范围里
    ```
    而 `new_string` 只把标题带回去。第一次丢的是**标题**（"标题集合差"那种自查能抓到），
    第二次丢的是**标题下面那一行**（标题级自查恰好是它的盲区 —— 自查和缺陷不在同一层）。

    🔴 第三次（同一份文件，17:0x）换了一副更小的面目：改逐宿主那张表时 `old_string` 结尾带 `\n` 而 `new_string` 没带
    ⇒ **macOS 那一行与 Windows 那一行被并成一行**。常驻门禁当场报
    `docs/plans/trash-and-archive.md:1217 列数 9（本表表头是 4）`，拆开换行后 rc=0。

    ✅ 三条，缺一不可：
    1. **改整行、两端都不带换行**（唯一动作，没有"只改半行"这种选项）。
    2. 改任何**表**之后立刻跑 `pnpm check:md-tables`（它抓得到"并行"和"单元格里写裸竖线"两种），不要攒到最后。
    3. 对 HEAD 的**整行级**自查只留一条：`comm -23 <(git show HEAD:<file>|sort) <(sort <file>)` 判**差集为空**
       ＝"对 HEAD 是纯插入"。标题级、小节级自查都可以省，这条不能省 —— 它抓到的是"少了一行"，
       而"少了一行"在标题级自查里是不可见的。
       ⚠️ **这条自查的适用面是单写者的那份文件**（比如本文档自己）。多人共享台账上它**一定非空** ——
       2026-10-04 17:2x 实测：追加完自己的 6 条之后 `comm -23` 报**丢失 6 行**，逐条读那 6 行是另一条线
       **在原地重写 #209**（旧措辞删掉、新措辞另起），不是谁删了账。⇒ 在 `M` 的台账上承重读数换成三条：
       **新号唯一 + 原有重号集合没变大 + 每条 needle 命中数 = 1**（幂等复跑必须打印"已在台账里"而不是再追加一遍）。

    📌 一般规律：**自查的粒度必须等于缺陷的粒度。** 三次事故是同一个动作（边界行进了匹配范围）造成的，
    能被它伤到的检查有两种粒度，只配一种就会漏掉另一种面目。

251. 🔴 **过滤型载体的"空输出"和"截断输出"都不构成读数 —— 而它们各自都长得像一种结论。**

    两个实测实例（都是 2026-10-04，都在"取一条套件的摘要行"这一件小事上）：

    | 面目 | 现场 | 为什么危险 |
    |---|---|---|
    | **截断** | `… \| head -12` 想抓摘要，结果 12 行被测试自己打的日志行占满，**摘要那两行根本没进窗口** | 读起来像"这包没跑"，实际跑完了 |
    | **空输出** | 一趟 7 秒返回零输出，第一版写成"套件没问题/没输出" | 实际是**被宿主内存闸门拒绝启动**（`/tmp/tfa-test.lock`）；一条 2234 用例的套件**不可能** 7 秒跑完 |

    ✅ 载体三件套（写成三件套是因为单独任何一条都会漏掉另一种面目）：
    1. 摘要行**行首锚定**抓：`grep -E "^ *(Test Files|Tests) +[0-9]"`（不锚行首会抓到日志正文里的词）；
    2. **空输出自动回落**成"打印原始日志尾部"，让人看到那句拒绝原因，而不是看到一片白；
    3. **耗时也是读数** —— 与用例规模对照一下，几秒返回的"绿"必然是没跑。

    📌 与元规则 1（先怀疑探针）同族，但这条给的是**探针自己的三个静默失效面**：
    计数类判据的失败模式不是"报错"，是**"什么都没报"**，而"什么都没报"在退出码上可以是 0。

252. 🔴 **"作用域非空"不构成判据的承重证明；一行审计要有一条**自己的**阳性对照，而不是全局借一条。**

    2026-10-04 15:1x 那趟逐工单审计（`tmp/s8-audit.mjs`，只读，拿 `git grep -l -E <图案> HEAD -- <范围>` 反查文件）
    里，**W4（清单与习惯进回收站）那一行读成 `HEAD=0 WT=0`**。

    - 🔴 **两头都零的图案等于没在判任何东西**，而它长得像"这功能不在 HEAD"。
    - 我先给的诊断是"`packages/ui/src/trash/` 整个目录已被搬走 ⇒ 作用域不存在"。**现量把它否证了**：
      `git ls-tree -r --name-only HEAD -- packages/ui/src/trash` = **1**（还剩 `TrashBoard.tsx`）。
    - 真实原因是**图案与所有者错位**：那一行找的是大写词 `PROJECT|HABIT`，而类别词表的主人是
      `packages/domain/src/trash-rows.ts` 的 `TRASH_KINDS`（界面组件那份里本来就不含词表）。
      改成命中**词表的所有者符号**后：`W4 HEAD=2 WT=2`（本来就在 main 里）。

    事后补的那条"作用域里零个被跟踪的文件就点名"**只在极端情形有牙**（scope 全空）。
    如实记下边界：**它挡不住"作用域非空，但里面放的不是我要数的那个东西"** —— 挡住那一类靠的是
    每行配一条**必然命中的阳性对照**。同一趟里已经有一条全局的（"政策里 Linux 那句"`HEAD=0 WT=1`），
    但它只对照 legal 那一档作用域，**借不到 W4 那一行上**。

    📌 一般规律：**"这一行读 0"要先证明这一行有能力读非 0**，且证明必须在**同一行**上。
    全局一条对照 + 每行一个 `includes` 形状的自检，就是"账看起来齐、其实整列空洞"的成因
    （同族的另一面见 #174：只哈希两三个文件的对账证明的就是那两个文件）。

253. 🔴 **同一份对外承诺可能由两个通道分别守，而其中一个通道的"全绿"对它结构性失明 —— 所以报"N 道门禁全绿"必须同时报"还剩几条只住在 vitest 里"。**

    2026-10-04 12:1x 那轮：对外条款里"级联硬删"那一格**缺了"其它设备本地数据"这条边界**（一句会被代码否证的话）。
    而我当时手里有 **10 道 `check:*` 全 rc=0** —— 包括 `check:legal-copy`（它比的是生成物与真源）。
    真红在 `packages/legal/tests/structure.spec.ts:568` 一条**语义**判据里（那条要求每一格承诺自带边界）。

    症状组合是这一族最难发现的形态：**门禁绿 + 对外声明"有常驻门禁" + 发布出去的句子仍然是假的**。

    ✅ 两条做法：
    1. 汇报口径：**报"N 道门禁全绿"时必须同时报这套承诺还有几条只住在 vitest 里**，反过来（报"测试全过"）也一样。
       两个通道各自"全绿"合起来不等于"全覆盖" —— 这跟"三本账各自 0 未登记 ≠ 0 未看"是同一个形状。
    2. 关闭命令写成**两条一起跑**：`pnpm check:legal-copy && pnpm --filter @heyta/legal test`。
       `check:legal-copy` 对这一条承诺**零分辨力**，单跑它会把"缺边界"读成"已核验"。

    📌 一般规律：**判据按"哪一层能失败"来分通道，不是按"它归谁管"来分通道。**
    一个只管字节一致的门禁永远拦不住语义级的对外承诺，反之亦然 —— 而两边的退出码都是 0。

254. 🔴 **对账类判据的"覆盖面"= 匹配器接受哪些句子形状，不是你在语料里扫了几栏。**

    2026-10-04 legal 那条"级联数字对账"（把政策里的 N 处级联/N 张表与迁移 SQL 推出的真值比）扫了
    **9 份文档 × 中英两栏**，看似很全。但它的四种正则
    （`共 N 处级联` / `覆盖 N 张表` / `N cascades … total` / `across N tables`）
    **一种都不匹配**英文 GDPR 那一行的实际措辞 —— `16 foreign keys … covering 15 tables`。
    后果：**一个错的数字对外发布，而套件 66 条全绿**。

    ✅ 补法必须两条一起做：
    1. **加形状**（这里是 `covering N tables` / `N foreign keys` 两种英文形状）；
    2. 把"命中总数 ≥ N"换成**逐形状验载体** —— 每一种形状都要被断言"至少命中一次"，
       哪种形状零命中就**点名它**。只做第 1 条的话，"补了形状但那句被改写掉"仍然静默。

    🔴 **三臂里最值钱的那条是负向对照**：`旧判据 + 同一份错数字 ⇒ 66 passed / rc=0`。
    只报"新判据会红"证明不了旧判据没牙；这条才是"补牙前没有任何一层在守"的正证。

    📌 与 #174（只哈希两三个文件的对账）、#217（生成物里没有正文 ⇒ 覆盖面判据只能长在真源侧）同族
    但**不是同一件事**：那两条讲的是**取样范围**（扫哪儿），这条讲的是**同一份取样里匹配器的形状集**（认得出什么）。
    **扫得全 ≠ 认得出** —— 这一区分只能由"逐形状验载体"来表达，由不得用命中总数代替。
255. 🔴 **判据脚本用相对路径 source 自己的 lib，就会被"测哪棵树"的那个旋钮带到别人的树里；
    而 lib 缺席之后它给出的空读数，和"测出来是坏的"在输出上长得一模一样。**

    `scripts/verify-mobile-window-gate.sh` 第 51 行按 `--repo` 的参数 `cd` 到被测量的树（这是设计：
    隔离载体运行时，工作树/APK/源码 mtime 都该读载体），但下面三行写的是
    `. scripts/lib/wait-for-quiet-host.sh` / `. scripts/lib/wedged-runner.sh` / `. scripts/lib/apk-freshness.sh`
    —— **相对路径跟着 cwd 解析**，于是"闸门自己的代码"也跟着进了载体。
    10-04 17:1x 挂上 `r14c-window-retry.sh`（它就是以 `--repo <载体>` 调闸门的）第一趟现量：

    ```
    …/heyta/scripts/verify-mobile-window-gate.sh: line 106: scripts/lib/wedged-runner.sh: No such file or directory
    …/heyta/scripts/verify-mobile-window-gate.sh: line 109: scripts/lib/apk-freshness.sh: No such file or directory
    …/heyta/scripts/verify-mobile-window-gate.sh: line 276: heyta_apk_pair: command not found
          APK 1970-01-01 08:00:00 / 最新源码 1970-01-01 08:00:00
       ❌ APK 比源码旧 —— 跑它验的是旧 bundle（§7 第 27 条）
    ```

    两枚 lib 缺席的原因各不相同，而且都必然发生：`wedged-runner.sh` 是当天 09:0x 新建的，
    **载体那个提交里还没有它**；`apk-freshness.sh` **根本没被跟踪**，任何提交的载体里都没有。
    真正贵的是第三步：函数不存在 ⇒ `read` 取到空 ⇒ `date -r 0` 打印出 1970 ⇒
    判据**报出一条产品缺陷**（"APK 比源码旧"），而下一位会照着建议行去
    `pnpm --filter @heyta/ui build && pnpm build:android` 重打一个**根本不必重打**的 APK。

    ✅ 修法把两个位置钉死，各归各处：**代码按 `$0` 所在那棵树取**（`GATE_SELF_DIR`），
    **测量按 `$REPO` 取**；lib 缺席改成响亮 + fail-closed ——
    `APK 新鲜度**测不了**：heyta_apk_pair 未定义…这不是一句产品读数`，
    仍然计一条 `apk` 红（不新增 `REDS=` 词元，所以消费这条机器通道的五处不用改）。
    三腿读数：主检出直跑不变；`--repo 载体` 两行 `No such file` 消失且给出真时刻（`01:05:18 / 06:53:58`）；
    把闸门与 lib 拷进 /tmp **故意抽掉 `apk-freshness.sh`** ⇒ 打出"测不了"、日志里 `1970` 出现 **0** 次。

    📌 一般规律：**"测不出来"必须产出与"测出来是坏的"不同的字面**，
    否则人会去修一个不存在的产品缺陷 —— 这是 §8.3「一条永远通过的判据比没有判据更糟」的反向形态：
    **一条会失败的判据，如果它失败的原因和被测对象无关，它就是在指挥人做错事。**
    同族还有 #191（按文件名枚举的门禁在文件被删时安静地不执行仍报通过）与 #168（自己手抄解析把负载粘成非法整数）。
256. 🔴 **收尾自检拿"全仓共享计数"当基线对账 = 别人的动作会让你假红。隔离性断言只能建在自己留下的工件上。**

    `research/tools/r14c-heal-fire-arms.sh` 的收尾格是这么写的：跑之前
    `WT_BEFORE=$(git worktree list | wc -l)`，跑完 `git worktree remove` 自己那枚临时 worktree，
    再断 `WT_AFTER = WT_BEFORE 且 清单里搜不到临时那枚`。
    10-04 17:2x 现量：`❌ 收尾：基线 16 → 现在 15，清单里还找得到临时枚 0 次` ——
    **两个读数合起来说的是"我没漏，但全仓少了一枚"**，而少的那一枚不是我建的：
    同一趟 `git worktree list` 里那枚标 `prunable` 的 `/private/tmp/ht-mdt-arm`（别的会话的夹具）
    在下一趟就不见了。**共享检出里 worktree 数是一个由所有人共同决定的量。**
    最讽刺的是这个文件第 70 行的注释**早就写着**"13 这种全仓数字本身没有判据力（别人也有 worktree）"，
    断言却还在比计数 —— 注释与判据不一致，就是从"写注释时知道、写断言时图省事"来的。

    ✅ 改成直接对**自己的工件**断言：`清单里 0 命中` **且** `那个目录不存在`
    （后者挡的是"从清单里摘了但目录还在"这种真漏）。计数降级为打印读数，不参与红绿。
    牙（变异一趟，改的是 /tmp 里的副本）：把 `git worktree remove` 那行摘掉 ⇒
    该格转红「本装置自己漏了 —— 清单命中 1 次，目录存在=1」、rc=4；真 rig 复跑 rc=0（`15 → 15（差 0，只打印不判定）`）。

    📌 可迁移的形状：**任何"我建的东西必须消失"的自检，判据的输入只能是我自己那件产物的标识**
    （路径名、pid、锁文件名、blob 哈希），不能是"这类对象的总数"——
    总数在共享机器上由别人决定，于是它同时会**假红**（别人删了）和**假绿**（别人同一刻建了一枚，抵消了我的漏）。
    同一个错误的第三种面目见 #247（把"索引脏"这个共享状态当成危险本身，而真危险只有一种且不在那个集合里）。

257. 🔴 **清洗/归一化类自检自己会造差异 —— BSD `sed` 的字符类在多字节 UTF-8 上按字节工作：命令成功、输出看着像正常文本，而它把"验证我没有删行"变成"验证 sed 没洗坏"。**

    2026-10-04 12:1x，那条"对 HEAD 是纯插入"的自检**第一次报警**（丢失 1 行）。报警行打印出来是这样：
    `"死链门禁把它们报成""…"` —— **引号被洗没了**。也就是说归一化之后那个"丢失 1 行"已经不代表文件，
    它代表的是 sed 自己造成的破坏。

    🔴 我当时做的错事是**把坏探针的读数当结论**：连同"`norm()` 之后非插入差异 = 1 行"一起写进了计划正文。

    ✅ 换成 node（UTF-8 安全）重做，现量：

        HEAD 2458 行 / 工作树 3356 行 / 归一化后丢失行 0

    ⇒ 真实结论只有一条：**本轮是纯插入、零行丢失**；那 1 行差异是引号**字形**（别人改的），不是破坏。
    ⚠️ 这条改进**不是为了把读数洗绿**：归一化只洗引号字形。上一轮那种"吃掉 `## 11.` 标题整行"的事故，
    用这条命令**仍然会报**（标题整行归一化后依然零配对）。

    ✅ 判据写法：**清洗/归一化步骤必须自带"洗完还能匹配原文某一行"的正向哨兵** —— 否则它制造差异的那一步是无声的，
    而你只会看到"被测对象好像少了东西"。

    📌 与 **#77 是同一条命令的相反两面**：那面是 `sed: RE error: illegal byte sequence` 在管道中间**炸**（响的，能自愈式地把人引向上游）；
    这一面是**不炸、成功、且输出像正常文本**（哑的）。哑的那面更贵 —— 它把自己的破坏伪装成被测对象的缺陷。
    📌 元规则 1（先怀疑探针）的第三种长相：探针坏有三种 —— 报错（#77）、返回空（#251），**返回一段被它自己改坏的正常文本**（本条）。

258. 🔴 **双语政策上的"小句级"判据如果只按中文标点切句，英文栏一整段就是"一句" —— 于是它会把刚刚写对的那句判成假红。**

    2026-10-04 14:4x 给法务失效声明门禁加"逐壳点名句必须与标记同句"这一腿，一跑**红三条**，
    其中一条说的**正是我刚刚改对的那句**。

    机制：英文那一格里 `…cannot remove the file itself` 与下一句 `✅ The macOS and Windows … were wired up`
    被并成**同一句**（切句器只认 `，。；` 这类全角标点）。"标记在同句"这个判据于是对整段成立或整段失败，
    **分辨力 = 0**，而它的输出形态和"抓到违规"完全一样。

    ✅ 正解两条一起做：
    1. 判"谁和标记同句"要 `.` / `;` 再切一层 —— 本质是**按被测文本自己的标点体系切**，不是按我写判据时所用的那一种切；
    2. 把这一支留成 `--self-test` 里**必须绿**的一臂。否则下一轮换措辞、换语言，它又会静默变哑
       （同族教训：一臂的"必须绿"腿就是"匹配器还活着"的哨兵）。

    📌 与 **#254 是一对，别合并**：#254 讲**匹配器接受哪些句子形状**（认不出 ⇒ 漏报，错数字发得出去）；
    这条讲**切句粒度**（切太粗 ⇒ 误报，而且会把正确的那句报成违规）。
    两侧都要有正向哨兵：**一条判据既要能红，也要能绿**，只测其中一侧的自检挡不住另一侧变哑。

259. 🔴 **声称"不抄第二份"的指针只要点了名，它本身就已经是第二份抄件 —— 而它往往是全表里唯一会漂的那一格。**

    2026-10-04 14:4x 普查政策表时发现的一格：`minors` 那格措辞是
    "逐端清到哪一层……**本文件不抄第二份**"，中间却插了一句
    "（macOS 与 Windows 桌面壳上还有一层今天没接进）"。

    那一刻这句已经是**假话**（macOS 那层当天已接进），而它是九份文档的表里**唯一真写了壳名**的一格。
    更要命的是判据口径：方向对账那条腿原先**只对 `data-rights` 要求逐端点名**，其余八份"不该被要求逐端点名"——
    ⇒ **唯一会漂的那份正好落在所有腿的射程之外**，门禁 rc=0 与它无关。

    ✅ 判据口径改成：**判"谁抄了这个事实"不按"谁抄了整句"，按"谁的句子里出现了会被代码否证的具体名字"**
    （壳名、表名、文件名、数字都算）。加上这条腿之后，`minors` 那格被点名，必须二选一：改回纯指针，或在豁免表里写明理由。

    📌 三处对照，都是"抄件"这一个病的不同落点：
    · **#207**：判据清单已经有单一所有者 lib，链里再 `grep` 一遍字面量 = 当场抄第二份；
    · 同批实测的**正例**：整片政策被倒过来时，**唯一没改一个字的那格正是只说"逐端清到哪一层"、一个名字都没点的那句** ——
      指针不抄值就不漂；
    · 本条：**指针的诚实性由它有没有点名决定，不由它前面那句"本文件不抄第二份"决定。**
    写"我不抄第二份"的同时举一个例子，就是抄了第二份。

260. 🔴 **对照组与被测组的退出码相同时，判据只能是「错误类计数」，不是 `$?` —— 这条是在"证明撇号不会静默损坏"那一趟里学到的。**

    2026-10-04 12:5x 那趟要回答的问题很具体：法务词条表里单引号字符串中夹一个英文撇号（`don't`），
    到底是**编译期语法错**（发不出去），还是**静默把字符串截断**（发得出去、内容坏）？
    后者才是要防的事故形状。

    现量（两条臂，同一份 `tsc`）：

    | 臂 | 读数 |
    |---|---|
    | 注入撇号 | `TS1xxx` 语法类 **0 → 6 条** ⇒ 是编译期错，**发不出去**（原假设成立） |
    | **对照组**（没注入） | 退出码**也是 2** —— 它因单文件跑而报 `TS2307`（模块找不到） |

    🔴 所以这一趟**唯一能用的读数是"语法类条数从 0 变成 6"**，退出码在这一档上**没有分辨力**。
    我第一版把"rc 变了"当结论写下来了 —— 那是拿一个恒 2 的数当判据。

    ✅ 判据写法：**两臂退出码可能相同时，断言按错误类别计数**（`TS1` 语法 / `TS2` 解析 / `TS2307` 模块 分档），
    并**同时断言对照组的计数是 0**。少后半句就变成"探针自己坏了也算抓到缺陷"。
    📌 与 #163（数失败用例要先 `NO_COLOR=1`）、#228（按 `Tests +N passed` 抓 passed 会抓空）同族，
    但这三条讲的都是**解析输出**；这一条讲的是**退出码本身在这一档不携带信息** ——
    形状不同：不是"读错了"，是"这个数压根不分辨"。

261. 🔴 **BSD `ps` 的 `-p` 只吃逗号列表：`ps -p A B -o fmt`（空格分隔）会让整条命令失败** —— 而配上 `2>/dev/null || echo "gone"` 就把它读成"那两个进程不在了"。

    2026-10-04 14:2x 判断那两枚 wedged 的重装进程还在不在时现量：

        ps -p 93772 93817 -o pid=   →  ps: illegal argument: -o   rc=1
        ps -p 93772,93817 -o pid=   →  两行都打印                 rc=0

    错的那一版**两个进程都活着**，而输出是"一片空 + rc=1"，被 `|| echo gone` 接住后打成 `93772/93817 gone`。
    🔴 这一族的可怕在于：**"进程不存在"和"探针参数写错"在 stdout 上完全同形**，
    而我拿这个读数做的判断是"设备面前置可以开了"——它一旦读错，代价是拿别人的现场做我的验收。

    ✅ 两条：
    1. 多 pid 一律**逗号**分隔（BSD/GNU 都接受），不要空格；
    2. 判"没了"要有一条**独立的正向证明**（这里用 `pgrep -f <那条脚本名>` 或读 `/proc` 等价物），
       不许由"ps 失败"推出。⚠️ 顺带核过：本仓 `scripts/lib/wedged-runner.sh` 里那几处 `ps -p` 全是
       **单 pid + `-o` 紧跟**的形状 ⇒ 没受影响（这是一次"怀疑别人也坏了"的核查，结论是没有，别照抄成"这里曾经坏过"）。
    📌 元规则 1 的又一副面目：**报错的命令 + `|| echo` 兜底 = 把"我写错了"翻译成一条关于世界的假陈述**。
    同族：#197（`Operation not permitted` 在成功运行里也出现 ⇒ 它连必要条件都不是）、#234（探针"看不见就跳过"）。

262. 🔴 **设备 UI 定位的三个锚点陷阱，症状全都是"产品没有这个按钮"：判屏的串两页都有、可点节点的名字在 `content-desc` 而屏幕上那段同名文字不可点、Modal 里的按钮与背景同名。**

    2026-10-04 17:5x 写移动端注销销毁验收（`verify-mobile-account-erasure.sh`）时三枚一起撞上，
    全部在**进设备窗口之前**靠读源码发现（没有实跑）：

    | 面 | 错的写法 | 为什么它长成"产品坏了" | 对的锚点 |
    |---|---|---|---|
    | 判"这一屏开了" | `has_sub "删除云端账号，并清除这台设备上的数据" 或 has_text "注销账号"` | 那个串是**入口行的副标题**（`ProfileScreen.tsx:680` 的 `hint:`），目标屏根本不渲染；而「注销账号」两页都有 ⇒ 没跳走也算"开了"，下一步"找不到勾选框"被记成产品缺陷 | 用**只有目标屏才有**的句子（`accountClosure.lead`） |
    | 点勾选框 | `xy_text "我确认：…"` | 同一个句子在本屏渲染**两遍**：`Checkbox` 是 `Pressable + accessibilityLabel`（`kit.tsx:400`），名字在 `content-desc`；旁边还有一段**不可点**的说明 `Text`（`AccountClosureScreen.tsx:190（:187 是 label）`）。`xy_text` 拿到的正是后者 ⇒ 点下去勾选不变，而提交按钮是 `acked && …` 条件渲染 ⇒ 报"没有提交按钮" | `xy_desc`（屏外再退回 `scroll_to_desc`），并补一条**行为判据**：等那个按钮出现 |
    | 点模态里的确认 | `xy_text "注销这个账号"`（取第一个） | RN `Modal` 里又把同一个 label 渲染了一遍（`:262`）。整棵树被 dump 时**两个同名节点**，第一个在背景、被 scrim 挡住 ⇒ 点了没反应 | 先用 `grep -c` 数出同名节点数，再按第二参数取**最后一个**（模态渲染在后）；`xy_text <串> <index>` 的那个 index 就是为这个存在的 |

    📌 **一般规律**：
    1. **屏幕上读得到的文字 ≠ 点得动的节点**。凡"勾了没生效 / 按钮不存在"，先问这条句子有几个节点、哪一个带 `content-desc`。
    2. **判据用的串要问"另一屏有没有它"** —— 两页都有的 label/副标题不能当"跳到下一页"的证据（#50 那一族："状态对"在"没生效"时也绿）。
    3. **给"点下去了"配一条行为判据**（等那个只在勾选后才渲染的按钮出现），才能把"探针没点到"和"产品没这个按钮"分开 —— 否则一次设备窗口就烧在探针上。

    ⚠️ 顺带一条同族的**门禁面**（#254 的第三种面目）：常驻对账 `check:verify-script-copy` 的匹配器只认它**列出的 helper 名**。
    现量 `scroll_to_text`(30 处) / `scroll_to_edit`(5) / `settle_for`(18) 根本不在匹配器里 ⇒ 40 枚 needle 从没被对过账；
    补进之后 `needle 247 → 287`、`缺失=0`（零红变化），两枚变异臂分别报 `[exact]` / `[substr]` 缺失才说明扩面有牙。

263. 🔴 **验收器把连接地址和 companion 可执行文件混用，重启自愈会把真实载体失败伪装成产品失败。**

    2026-10-04 在 iOS 27 专用模拟器上，TCP companion `127.0.0.1:11002` 启动成功，并连续返回
    AX/HID 请求；AX 空树触发脚本的 shutdown/boot 后，旧分支却调用只支持 Unix socket 的
    `ensure_idb_companion`。此时变量已经是 `HOST:PORT`，它被传给 `--companion-path` 和二进制
    启动位，结果 companion 没有恢复，日志却长得像“AX 桥仍坏”。

    ✅ 修法：解析 idb 时保存 `IDB_COMPANION_BIN`；TCP 模式全程把 `HOST:PORT` 只传给
    `idb --companion`，重启后用保存的二进制按原端口重启并用真实 gRPC 调用复核；Unix 模式
    才使用 `--companion-path`。变异/验收必须记录目标 UDID、传输方式、端口、进程和重启后日志，
    不能把 companion/AX 载体红灯升级成产品缺陷，也不能在载体失败时宣称 UI 或通知通过。

264. 🔴 **只修 `ios-ax-shim.py` 仍不够：共享 shell helper 若把 `--companion-path` 写死，AX 健康检查会继续把 TCP 地址读成空树。**

    #263 的修复后，重启分支已按端口恢复 companion，直接 `idb --companion 127.0.0.1:11003 ui describe-all`
    能返回合法树；但 `scripts/lib/mobile-e2e.sh` 的 `idb_ui` 与 `_idb_ax_count_raw` 仍硬编码
    `--companion-path`。因此 `ios-ax-shim.py` 的操作已经能通，脚本自己的 `ax_ready` 计数却仍为 0，
    最终把健康的 TCP 载体误报成 AX 空树。

    ✅ 共享入口现在根据 `HOST:PORT` 选择 `--companion`，只有二进制路径才用 `--companion-path`。
    实测同一目标 UDID、TCP `11005`：`AX_LABELS=11`、`JSON_OK=1`。验收载体检查必须同时覆盖
    shim 与所有共享 helper；只测一个调用点不证明整条传输路径正确。

265. 🔴 **登录令牌兑换成功不等于同步凭据已持久化：验收器漏掉“保存并启用同步”会把真实成功伪装成登录失败。**

    当前移动 AuthScreen 的契约是两段式：粘贴登录令牌只得到内存 `session`，界面随后显示
    “保存并启用同步”；只有按下该按钮，才写入 sync config、启动 `syncNow` 并回到 Profile。
    iOS 真实验收曾在令牌兑换后直接轮询 Profile 的“立即同步”，210 秒后报主路径失败，随后
    旧的服务器地址/访问令牌兜底路径又能成功，形成“产品登录坏了”的假象。

    ✅ 主路径必须逐段回读：`验证并登录` → `保存并启用同步` 出现并被按下 → Profile 的同步
    状态可用；不能用后续手工填写凭据的成功覆盖中间步骤。认证 UI 或脚本每次改变阶段边界时，
    先对照 `AuthScreen` 的状态机和 `saveAuthSession` 接线，再更新真机判据。

266. 🔴 **iOS 27 重启后的通知探针可能晚于 120 秒写出：固定短超时会把载体延迟误报成 OS 失败。**

    2026-10-04 的 `restart-recovery` 在真实关机/启动顺序、SQLite 未伪造 fired 的判据均成立后，
    两次 `run_probe` 在 120 秒边界内没有读到文件，于是验收器报红；随后统一日志确认同一个
    probe 进程确实写出了 `authorization=granted`、`pending=[]`、`delivered=[]` 的文件，只是晚于
    原等待上限。这个结果不能回填为原轮成功，也不能直接把产品标成失败。

    ✅ 边界脚本现在把等待上限做成 `HEYTA_IOS_PROBE_WAIT_SECONDS`，默认 240 秒；每轮仍先删除
    旧文件、重新启动只读 probe，并只接受本轮新进程写出的 JSON。超时仍判红，必须结合统一日志
    区分“通知 XPC 慢”与“探针未运行”，并把目标 UDID、Release 产物和截图留在原 ADR 入口。

267. 🔴 **`simctl get_app_container ... data` 返回 Data 根，不是 `Application Support` 目录：漏掉 `Library` 会让探针日志成功而轮询永远失败。**

    2026-10-04 的第二轮 `restart-recovery` 已看到统一日志写出当前进程的 JSON，但脚本仍报
    “无法读取 OS 快照”。逐路径对账后发现实际文件在
    `.../Containers/Data/Application/<id>/Library/Application Support/heyta-reminder-probe.json`，
    原 `probe_path()` 却检查 `.../<id>/Application Support/...`。这不是通知系统或产品回执的失败。

    ✅ `probe_path()` 现在明确插入 `/Library/`，并与生产 SQLite 的 `.../Library/heyta.sqlite`
    形状一致；路径修复必须保留旧文件删除、当前进程写入和 JSON 内容校验，不能直接读取统一日志
    代替文件或把旧 probe 文件算入本轮。

268. 🔴 **AuthScreen 的“保存并启用同步”在表单下方：只做 viewport list 会漏掉真实 session 阶段。**

    iOS 主认证验收在令牌兑换后仍进入手工凭据兜底，源码与 AX 状态机对账确认不是产品没有
    `mobile.auth.enableSync`，而是验证器只调用 `--list`，没有把长表单底部的按钮滚进视口。
    这会把“session 已经拿到、只差保存”伪装成令牌兑换失败。

    ✅ 主路径现在必须用 `--scroll-into-view` 回读“保存并启用同步”，同时确认 `visible=True`，
    再按压并要求 `result=success`，之后才轮询 Profile 的同步状态。认证页面增加字段或改变阶段
    时，先对照 `AuthScreen` 的 phase/session 条件和真实 AX bounds，再更新脚本；不能用后续手工
    凭据成功覆盖这个中间阶段。

269. 🔴 **重启后的提醒验收不能把首次 OS 快照当成最终业务回执：系统 delivered 与 RN reconcile 是两个异步阶段。**

    2026-10-04 的专用 iOS Release 证据显示：重启后 App 按计划把错过的 occurrence 立即排入系统，
    第一次 probe 在通知尚未 delivered 时读取 `pending=[]/delivered=[]`；稍后同一 occurrence
    进入 OS delivered，并在原生 ledger 出现 `posted/receipts`。若脚本在首次 8 秒后直接查 SQLite，
    会把正常投递延迟误判成没有回执。

    ✅ `restart-recovery` 现在轮询本轮 occurrence 的 OS delivered；出现后重新启动生产 RN 进程，
    再等待真 SQLite 中匹配的 `firedAt + firedForTriggerAt`。只读 probe 不写业务 op，原生 ledger
    的 posted/receipts 也不能代替同步事实；任何一层没有当前 occurrence 的证据都必须判红。

270. 🔴 **只读 probe 会短暂占用 App bundle：不先 terminate 就 launch，iOS 可能复用 probe 而不执行 RN reconcile。**

    2026-10-04 的重启旅程已取得 OS delivered 与 ledger receipt，但 SQLite 仍没有 fired op。
    统一日志显示 delivered 后脚本直接 `simctl launch`；probe 进程仍在其 30 秒保活窗口内，系统
    复用了它，生产 JS 没有重新挂载，因此没有消费 delivered。

    ✅ 脚本现在在 delivered 快照后先终止目标 bundle，再启动生产 RN，并等待 SQLite 的当前
    `firedAt + firedForTriggerAt`。probe 的存活窗口、ledger 证据和同步 op 继续分层记录，不能
    把其中任一层代替另一层。

269. 🔴 **Android 口令/登录令牌验收中，输入法状态、服务端端口和一次性令牌会共同制造“已输入但没有登录”的假象。**

    2026-10-04 的 Android Release 续验中，模拟器默认输入法被切到 Google Voice IME；禁用输入法时又留下了
    Voice overlay，后续坐标点击落到系统页面或输入法上。另一次尝试在 `:3000` 请求令牌，而安装包设置页仍指向
    `:3120`；两个端口都返回成功，但令牌只应在安装包实际配置的端口上请求和兑换。最后，登录令牌是一次性的：
    请求新令牌后必须重新从服务端读取它，不能复用请求前的 token，也不能重复点击“验证并登录”来猜测结果。

    ✅ 固定流程：先记录并核对安装包中的 `serverUrl` 与验收服务端端口；输入前用仓库的 bash helper，先把字段滚进
    视口并回读长度，再分块输入、回读完整值，使用 `KEYCODE_ENTER` 收起键盘后重新抓 bounds；只点击一次验证按钮，
    通过脱敏的 session/账号状态确认结果。验收结束恢复模拟器原来的默认输入法和硬键盘设置。不要用 `KEYCODE_BACK`
    或 `KEYCODE_ESCAPE` 收键盘：它们可能关闭 RN Modal/应用并清掉只在内存中的登录凭据。

271. 🔴 **`awk '{print int($1)}'` 会把"探针根本没读出来"折成一个合法数字 —— 于是负载门在探针坏掉那天是大开的。**
    #168 修的是**读法**（`sysctl -n vm.loadavg` 带花括号，`tr -d '{} '` 把分隔符和花括号一起删掉，
    三个数粘成 `31.4729.0034.04`）。但修完之后的**那一步仍然在把坏读数往合法数上折**：
    `int()` 对那串粘连值取 **31**（看着像个正常负载），对 `junk` 和空串取 **0**。
    后者比 #168 更糟 —— 粘连值至少还可能撞到阈值，而"读不出来"被读成 **负载 0 ⇒ 门大开放行**。
    现场：`scripts/lib/wait-for-quiet-host.sh` 里那次比较，消费者是本仓全部设备验收与那条 flaky 看守。

    ✅ 修法（2026-10-05）：**先验字形，再取整数** —— `[[ "$raw" =~ ^[0-9]+(\.[0-9]+)?$ ]]`
    （bash 3.2 实测可用），不匹配就打印"按探针故障处理（不放行）"并 `return 1`。
    三臂现量在 `scripts/mutate-closeout-gates.sh` 的 **M 段**：`junk` / `31.4729.0034.04` / 空
    三种喂法**全部** rc=1 且点名探针故障（同段还钉住内存门的两向 + 探针坏 + 坏旋钮，
    并以"摘掉那次调用就照样起跑"的变异证明那一格真的长在放行路径上）。

    📌 一般规律：**任何"从文本里抠一个数"的探针都要区分「这个数是多少」和「我压根没读到」**。
    `int()` / `parseInt()` / `Number()` 这类兜底会把两种情况压成同一个值，
    而压出来的那个值通常恰好落在"放行"那一侧（0 最小；非数字比较恒假）。
    ⇒ 判据固定三段：验字形 ⇒ 取值 ⇒ 读不出**按不过**处理。

272. 🔴 **"比对抄件"的臂，会在抄件被删掉的那天变成恒真 —— 因为它的 needle 会去匹配臂自己算的那一行。**
    `research/tools/h-flaky-window-watcher.sh` 的臂 9 原本钉的是"同一台机器上三份 `ncpu × 3/4`
    抄件的分数字面必须逐字相同"（装置 / 闸门 / lib）。今天把装置里那两行抄件删掉、改成问 lib 要数之后，
    抽取器 `.*[lL][iI][mM][iI][tT]=\$\(\(` **照样取得到一个分数** —— 命中的是同一臂下方
    `EXP_LIM=$(( $(sysctl -n hw.ncpu) * 3 / 4 ))` 那行，也就是**臂自己为了拼期望字符串算的那个值**。
    于是"三份一致"这件事在少了一份之后**仍然报绿**。

    ✅ 修法：抄件删了，判据就要跟着换形状 —— 从"比对字面"换成**钉委托**：
    按**行首赋值**取 `HT_NORM_LIMIT=` / `LOAD=` 两行，要求它们的右边来自 `HOST_LOAD_LIMIT` /
    `HOST_LOAD_VALUE` 且**不含命令替换**（含了就说明本装置又自己推了一遍），
    并留一条变异：把委托换回 `ncpu×3/4` 抄件 ⇒ 这条腿必须判红（现量：`--selftest` 里臂 9a 那条 ✅）。

    📌 两条可迁移的：① **删重复实现的收尾动作不是"写一份更好的"，而是把盯着重复的那条判据一起换掉**
    （同 §3.5 那条抽取教训，只是这次坏在判据侧）；② 任何"按 needle 在文件里搜"的门，都要问一句
    **这条 needle 会不会正好命中门禁自己的文本**（#191 那一族的另一副面孔：上次是命中夹具，这次是命中臂自己）。
273. 🔴 **iOS AX 的 `press` 是按坐标 tap：被**导航栏**盖住的元素照样回 `result=success`，而那一下什么都没点。**
    10-05 实测（`scripts/verify-mobile-ios-account-erasure.sh` 的判据 C 连红 40 个采样窗）：
    「立即同步」frame `y=72..116`，而导航栏标题「我的」在 `y=80..100` ⇒ tap 落在导航栏上，
    服务端**零请求**、界面文案一字不变、shim 回 success —— 症状与"移动端不渲染那句"**完全同形**。
    `scripts/tools/ios-ax-shim.py` 只为**软键盘**建了遮挡判据（`tap-blocked-by-keyboard`，
    它文件头记的就是同一族事故），而 `scroll_into_view` 的"可见"定义是
    `中心 y < 屏高-120 且 底边 > 0`（:534）—— **只有下沿、没有上沿**，所以它自己不会把按钮让出来。
    ✅ rig 侧修法（不动共享 shim，那件事登记在计划 §10.142 的 #80）：按之前先
    `--scroll-into-view <页面首行>`（首行整块在折叠线上方时 shim 会真的向下拖，实测把按钮从
    y=72 让到 y=552），按之后用**签名变化**当"被接住"的证据。
    ⚠️ **别拿 busy 当证据**：实测「正在同步…」在 12 个 1s 采样里一次都没命中（同步比采样快），
    那样装出来的是一枚**恒红**的腿 —— 与恒同族（§7 元规则二）。
    📌 一般规律：**`result=success` 只证明手势发出去了，不证明那个元素收到了**；遮挡面不止键盘
    （导航栏、悬浮底栏、候选/AutoFill 条都算），所以任何 tap 类动作都要挂一条"被点的东西真的动了"
    的下游证据，而不是读返回值。

274. 🔴 **判语里印着结论，却不由任何变量决定 —— 同一趟输出里两枚红互相否证。**
    （10-05 iOS 注销 rig，`scripts/verify-mobile-ios-account-erasure.sh` 步骤 9/10）

    1. 步骤 9 的红话无条件写「文件的 birth 就是注销那一秒 ⇒ 销毁之后被重建」——
       它**不读 birth**，残留 ≥1 且内容 0 就印。于是"销毁那一发没删掉文件"（birth 比注销早，
       设备级 M1″ 臂的形状）与"销毁跑完之后被重开路径建回来"这两件处置方向完全相反的缺陷，
       共用同一句判语；谁读到那一行都会以为是后者。（现在按 `birth − CLOSE_EPOCH` 分岔。）
    2. 步骤 10 的分支无条件写「销毁那条路压根没跑过」，依据只是"上一档也有残留"。
       而**同一趟**的 ① 恰好证明销毁跑过（`birth=10:23:45`，DELETE 发在 10:23:4x）。
       两枚红在一份日志里彼此否证，而 `通过 29 / 失败 5` 那行什么都看不出来。

    ✅ 修法是把两句话都换成量：`db_forensics` 多打一行 `birth_epoch=%d`，步骤 7 在发 DELETE
    **之前**取 `CLOSE_EPOCH=$(date +%s)`，D 按 `birth − CLOSE_EPOCH` 的正负分岔（正 ⇒ 销毁之后被
    重建；负 ⇒ 销毁那一发没删掉文件），E 按两次 `birth` 之差分岔（>0 ⇒ 每次冷启动都重建）。

    📌 一般规律：**判语里出现"就是 / 压根 / 必然"这类不带数字的因果句，先问它由哪个变量决定**。
    它不依赖任何变量就是恒真的，而恒真判语比没有判语更糟 —— 后来者会以为这一格被看着。
    与 §7 元规则二同族，但那条讲的是"永远通过的绿色"，这条是"**永远成立的红字**"：
    红也会假，而且假的红比假的绿更容易被当成结论抄进文档。

275. 🔴 **`/tmp` 里的证据会在你读它的过程中被下一趟换掉；两本日志只差一个前缀，最容易读错。**
    （10-05 10:3x，同一套 iOS 注销装置）

    `tmp/e2-ios-erasure.sh` 把**判据输出**写到 `/tmp/e2-ios-erasure-<HHMMSS>.log`，
    把**服务端日志**写到 `/tmp/heyta-e2e-erasure-ios-<HHMMSS>.log`（同一个 `$SINCE`，只差前缀）。
    我先在后者里 `grep -n '════ 9'` 拿到行号 1041/1081，几分钟后同一本文件 `wc -l` = 393、
    `grep '════'` 零命中 —— 那本已经被另一个写者写成服务端日志了。两次读数**都真实**，
    只是它们不属于同一时刻的同一棵树。

    ✅ 三条做法（本次已照做）：
    1. 引用一趟读数之前，先读脚本里 `LOG=` / `SRVLOG=` 那两行，确认它到底写进哪本；
    2. 文档里引证据要带**原文那几行**（§10.142 ⑤ 现在就是这么标的），不要只写"见 /tmp/xxx.log"；
    3. 要长期留的证据落到仓库里的 evidence 目录，`/tmp` 只当**当场**的读数。

    📌 同族面目：**判"没有 X"要先确认探针看的是哪棵树 / 哪本文件**（§7 第 46、197 条同一形状），
    而判"证据没了"要先 `ls -l` 看 mtime —— 它多半不是没了，是被写到了别的地方或别的时刻。

276. 🔴 **设备 rig 的 `EVIDENCE` 指向 `$HEYTA_REPO_ROOT` ⇒ 在 linked worktree 里跑出来的截图不在主检出，文档引用必断；而"人已看"若不配那一趟的日志，会把真缺陷看过去。**
    一次 `check:doc-citations --doc docs/plans/trash-and-archive.md` 报"不存在的路径
    `apps/mobile/evidence/ios-account-erasure-2-no-composer.png`"（10-05 11:0x）。两层各有账：

    1. **文件在，在载体那侧**。rig 写的是 `EVIDENCE="$HEYTA_REPO_ROOT/apps/mobile/evidence"`，
       而那一趟跑在 `heyta-wt-trash-e2e/` 里 ⇒ 截图落在那棵树的 evidence 目录，主检出**从来没有过它**。
       症状是"文档引了一张不存在的图"，实质是**证据跟着载体走、载体是会被 `git worktree remove` 的**。
       ✅ 做法：引用设备截图之前两侧都 `ls` 一次；要长期留的那张**复制进主检出**
       （先断言目标不存在再 `cp`，`cp` 后两侧 md5 必须逐字相同 —— 只比 mtime 会被 #72 那族骗过）。
    2. **图与日志要配对回看，单看任一边都会产出错的因果句**。我此前在计划里写"人已看，截图里
       「立即同步」就在画面里、被 iCloud「保存密码？」弹窗整个盖住"，而这张图实际画的是
       **任务页空态 + FAB，没有弹窗**。配对 `/tmp/e2-ios-erasure-085730.log` 才看清全貌：
       弹窗是真的（`底部两个标签都不在树上 ⇒ 按 iOS 系统弹窗态处理` → `✅ 已按坐标关掉…（回读：任务=True 我的=True）`），
       但**摘掉之后界面停在任务页** —— 因为 `sync_now` 开头那一下 `ax "我的" --press` 是在弹窗立着时发的、没落地。
       于是第二轮 `idb_wait_label` 等的是"任务页上永远不会出现的标签" ⇒ 必然再空转满一轮，
       最后剩一条长得像"同步没被触发"的红（真因：探针停在错的页上）。
       🔴 我当时只描述图、没配日志，就把**导航缺陷**登记成了**弹窗缺陷**，修了后者、漏了前者，
       同一趟的 `❌ 找不到便签输入框「写点什么…」` 是它的下游而不是第二件事。

    ✅ 可迁移判据：**任何"摘掉系统弹窗 / 收键盘 / 关浮层"之后还要"等某个标签"的步骤，中间必须重新做一次导航**，
    并把"这一轮在哪个页面上等"打进读数 —— 否则第二轮的等待条件是**在当前页上恒假**的，
    它给出的红与产品缺陷同形（§7 元规则二：一条永远成立的判语比没有判据更糟）。
    📌 同族面目：**"人已看"是一句断言，不是一次动作** —— 写它就要能回答"看的是哪张图、配的是哪本日志、
    两者说的是不是同一件事"（§6.2 规定一要的是图 + 那一趟的读数，不是图）。

277. 🔴 **给 shell 判据写"离线载具"时，读数会被三种方式静默吃掉；每一种的症状都是"修复没生效"。**
    10-05 11:0x 给 `verify-mobile-ios-account-erasure.sh` 的一枚修复配 `research/tools/mutation-rigs/ios-syncnow-order.sh`
    （判 `导航 → 等第一轮 → 摘弹窗 → 再导航 → 等第二轮` 这个**调用顺序**）时，同一趟连撞三枚：

    1. **macOS 的 `/bin/bash` 是 3.2.57**：把桩和 `eval` 写在 `$( … )` 里，而桩内用了 `case … )`
       ⇒ `syntax error near unexpected token ';;'`。命令替换的嵌套解析在 3.2 上不可靠。
       ✅ 载具落成一次性脚本文件（`mktemp` + heredoc `<<'EOF'`），跑它、读它的输出文件。
    2. **`eval "$BODY"` 一个函数定义只是**定义**了它** —— 不调用就什么都没跑。
       读数：序列只剩 `WAIT_CALLS=0`，四条判据三条红。**这看起来完全像"被测的修复没生效"**，
       而实际是装置没走到被测代码（traps #176 的又一副面目）。
       ✅ 载具末尾必须显式调用那个函数；并且**第一条判据应该是"序列非空"**。
    3. **被测代码自己带 `>/dev/null 2>&1`**：真身里 `ax "我的" --pressable --press --json >/dev/null 2>&1`
       把两个流都吞了 ⇒ 靠 stdout 传读数的桩在那一行**静默失声**，序列里看不见那一下重按
       （⇒ 我第二次差点把"修复没生效"写进结论）。
       ✅ 桩写**带全局序号的记录文件**，顺序与重定向无关；
       反过来，`jget` / `sync_signature` 这类**产出被 `$( )` 捕获**的桩必须走 stdout，
       所以它们用 `printf` 而不是已被桩化成"只写记录文件"的 `echo` —— 同一个载具里两条通道要分开定。

    ✅ 配套的形状判据（这台装置因此才算有牙）：**变异对照必须只红被禁止的那一格**。
    拿 `RIG=<git show HEAD:同一文件>`（摘弹窗但不重新导航的旧版）跑同一条 ⇒ `ORDER=fail=1`，
    且"摘弹窗腿被走到""等待腿恰好 2 次""不误判红"三条照旧 ✔。
    📌 一条会把整台装置打红的判据不叫有牙，叫噪声 —— 它分不清"修好了"和"装置坏了"。

    同一条线上又撞两种，前三种是"读数拿不到"，这两种的可怕之处在于**它们能造出绿色**：

    4. **桩把判据要读的输入洗没了** ⇒ 判据的**否定式由桩自我实现**。
       `research/tools/mutation-rigs/android-passive-branch-selftest.sh` 的 curl 桩用 `while` 把 `"$@"` 逐个 `shift` 掉，
       之后才拿 `$*` 去认 URL ⇒ 那时 `$*` 恒为空，探针那一发永远落不进 `sync/status` 分支、
       回兜底的 `000`，**注入的 `LEG_P0=404` 从头到尾没被读到**。
       后果不是空读数，是绿色：腿 3 断言的三件事（P0 判红 / 当场 rc=1 / 没发 `DELETE`）
       在"桩坏"与"代码正确"两个世界里**都成立** ⇒ **假通过**。
       ✅ 循环**之前**捕获 `ALL="$*"`，判据只读 `ALL`（`DELETE` 那一维一直是对的：它由 `-X` 解析成 `method`）。
       ⚠️ 但**别把修法写成"负向腿改好就有牙了"** —— 现量的反证：把两处 `$ALL` 改回坏形状、
       跑一次性副本 ⇒ `PASSIVE=fail=7`，七条红**全部**落在腿 2（5）/ 腿 4（1）/ 腿 5（1），
       **腿 1 与腿 3 一条都没红**。照出桩坏的从来不是那条负向腿，是同趟的**正向腿**。
       未变异对照 `bash research/tools/mutation-rigs/android-passive-branch-selftest.sh` ⇒ `PASSIVE=pass`、rc=**0**。
       📌 一般规律：**桩的完整性只有正向断言能证**（它要求"某个值确实流到了某处"）；
       一条只由负向腿覆盖的通道，桩坏了也永远绿 —— 负向腿必须有同趟正向腿配对，否则它给桩自己打分。
    5. **削平缩进之后再按行首模式找边界，必然命中嵌套层**：
       `awk '/^step "5/{f=1} /^fi$/{exit}'` 停在**内层**零缩进的 `fi`（脚本体里就有），
       而 `sed 's/^[[:space:]]*//' | awk '/^else$/{f=1}'` 会把嵌套的 `else` 当成外层那一档 ——
       两次读数都表现为"行数对不上"，看起来像旧路径被我改坏了。
       ✅ 取证要么用**显式行号区间**（先 `grep -n` 量出 step 边界再 `sed -n A,Bp`），
       要么把判据换成**集合差**（`comm -23 老 新` ⇒ "老档每一行是否原样仍在"），
       并在结论里写清它证到哪一步：集合差证到"没丢、没改字面"，**不证**顺序与语义。
    6. **放在门禁扫不到的目录里，装置连自己的 bug 都躲过去**：
       两台 rig 一直住在 `tmp/`（gitignored），`check:shell-unicode` 的射程不含它 ⇒
       `$RIG）` 与 `$HARNESS_RC）` 三处"`$var` 紧跟全角字符"（#64 那一族）在库里躺了一整个上午；
       搬进 `research/tools/mutation-rigs/` 那一刻门禁就把三处全报了。
       📌 **"入库"这道动作不只是让下一位找得到文件，它同时把装置搬到常驻门禁的覆盖之下** ——
       所以"先写完放 tmp/，以后再收"里的"以后"，实际是"这批 bug 以后也没人扫"。
       代价现量（10-05 12:1x，计划 §10.151）：给 #76 那臂补腿之后自带正则扫本批 6 枚装置，
       照出 **12 处** `$VAR` 紧跟全角字符（实测 `set -u` 下 `echo "载具：$ARM）"` ⇒
       `bash: ARM\xef: unbound variable`，整行当场死）；同形残留在 `tmp/` 其余 19 枚里还有 **67 处**。
       ⇒ 这道扫描的判据不是"锦上添花"，它是**唯一会碰到这些文件的检查**（门刻意不吃 `tmp/`）。
       顺带一条：入库后要**从别的 cwd 跑一次**（`RIG` 若写成相对路径，在家里跑得通、在干净检出跑不通）。

278. 🔴 **在隔离 worktree 里跑的"前置构建"只挑一个包 ⇒ 依赖的 `dist` 不存在，tsup 的 dts 阶段报一整片 implicit `any`；同一行命令在主检出永远绿，所以这一形在本机量不到。**
    10-05 11:0x，B 的窗口**真的开过一次**（10:59:49），看守走到前置那一步
    `pnpm --filter @heyta/op-log build` ⇒ rc=**1**、`DTS Build error`，日志里是
    `src/engine.ts(492,44): error TS7006: Parameter 'op' implicitly has an 'any' type` 一类的 **十二行以上**，
    看起来像 op-log 自己坏了。现量真相：`ls -d ../heyta-wt-reinstall-b/packages/*/dist` ⇒ **只有 `op-log` 那一枚**
    （失败前自己建的），而它 `package.json` 里声明的 `@heyta/{domain,shared-schema,storage,sync-core}`
    **四枚 `dist` 全缺**；同一分钟主检出 `ls -d packages/*/dist | wc -l` ⇒ **16**。
    ⇒ tsup 生成 `.d.ts` 时要读那四枚的类型，读不到就全解成 `any` ⇒ 严格层在 **dts 阶段**炸。
    ⚠️ 边界别说满：那一趟**只跑了 `build`**（`packages/op-log/package.json` 现量
    `build=tsup`、`typecheck=tsc --noEmit -p tsconfig.spec.json`、`test=vitest run`），
    `typecheck` 用的是**另一份 tsconfig**，本趟没在那棵载体里跑过 ⇒ 既不能主张它绿，也不能主张它同样红。
    已证到的只是第 162 条那一族：**"测试层绿"与"包构建绿"读的是两套配置**，缺一枚依赖产物只照在后一半。

    ✅ 两条一起才算修好（`research/tools/b-window-keeper.sh`）：
    1. 选择器带 **`...` 后缀**：`pnpm --filter '@heyta/op-log...' build`。方向是**现量确认**的，不是记得的 ——
       在载体里 `pnpm --filter '@heyta/op-log...' list --depth -1` ⇒ **5 枚**（op-log + 它依赖的四枚），
       `pnpm --filter '...@heyta/op-log' list --depth -1` ⇒ 7 枚且是**依赖它的**那些（mobile / node-host / desktop /
       web / app-host / sync-server）。**后缀=它依赖的，前缀=依赖它的**；记反了等于没改，而且不会红。
    2. 构建 rc=0 之后**再对一次账**：逐枚查依赖的 `dist` 在不在，缺任何一枚 ⇒
       `STOP=oplog-dep-dist-missing` 并点名缺的是哪一枚、重装一次都不起；
       载体里连 `packages/op-log/package.json` 都没有时**必须响亮地打** `DEPDIST=unavailable`，
       不许静默跳过（一条没被执行的前置，输出与被执行过的逐字相同）。

    📌 **可迁移的规律**：凡"在隔离副本里跑、而命令只挑一个包"的前置，都要先问一遍
    **这个包的依赖在副本里有没有产物**。载体越干净，这种红越像"被测代码坏了"，而它其实只在描述载体。
    反过来也成立：这类缺陷**不可能在主检出复现**，所以"我在本机跑过了"不是它的证据 ——
    牙要么长在"副本上真跑一次"（本条靠一次真开窗），要么长在形状臂上
    （`research/tools/b-window-keeper-arms.sh` 的 T/T2/T2b/U/U2；**U 故意不注入桩**才读得到那行真参数）。
    复跑：`bash research/tools/b-window-keeper-arms.sh`（最后一行给 pass/fail，**臂数由它自己打印**）。

279. 🔴 **设备级取证量到的红，先花 3 秒找一条无设备的复现，再决定归因给平台还是共享层。**
    10-05 11:34 iOS 注销销毁那一趟判据 D 读到"文件被删之后 5 秒又以 6 张空表回来"，
    第一归因几乎必然写成"iOS 原生桥没删干净 / op-sqlite 的行为不一样"—— 那是**最贵的**一种归因：
    它会让人去查桥、查 entitlement、查容器路径，而这三样都没错。
    一条 `research/tools/mutation-rigs/e2-destroy-reopen-probe.mjs`（真 `SqliteAdapter` + 真文件驱动 `NodeSqliteDriver`，不开设备）
    量到：`destroy()` 报 `containerRemoved=true`、文件确实消失，随后**一次普通的 `count('ops')`**
    就把 **73728 字节**的空壳建回来 —— 而 iOS 那枚残留也是 **73728 字节、6 张表、行数全 0、明文 0 命中**。
    字节数相同 ⇒ 机制在**共享层**（`sqlite-adapter.ts:299 ensureOpen()` 幂等重建 schema），与平台无关。

    📌 **可迁移的规律**：产物大小 / 表数 / 魔数 / 行数这类**可比较的读数**，是把"平台缺陷"降级成
    "共享层缺陷"的最便宜的证据 —— 设备一趟 8 分钟还要抢窗口，headless 一趟 3 秒且不抢任何资源。
    反过来，**只有当无设备复现失败时，才允许把红归因给平台**。

    ⚠️ 但**别把外推做过界**：这条共享路径"存在"被证到之后，同一格判据在 **Android 读到的是残留 0 枚**
    （§10.127 第 7 趟 / §10.134 ③ 复量）。所以能说的只有"路径存在"，不能说"四端都会红"——
    至少"销毁之后到取证之前有没有再打一次读"（时序）与"驱动在 close+删文件后重开的条件"两个变量没被分离。
    共享层缺陷 ≠ 各宿主等概率命中；**"存在"与"会走到"是两条判据**（同 §8 规则 9）。

280. 🔴 **判据"产出结论的通道"和"被读的通道"不是同一条时，它会静默变成常量。** 三副面目，同一族：
    1. **helper 把结论写进 stdout，调用方读退出码**（§10.119 ③）：
       `elif has_sub "项"` 里那个 helper 是 `echo 1/0` 的，而 `elif` 判的是**退出码** ——
       两条分支里的 `echo` 都成功 ⇒ **分支恒真**，"读不到待上传状态"那一档从此是走不到的死代码。
       它藏了很久，因为整套件的其它腿都在绿，而这枚腿的行为是"永远选第一档"。
    2. **探针用 `2>/dev/null` 把"取不到"洗成"为空"**（§10.134）：`db_ls` 吞掉 adbd 重启期的报错 ⇒
       "命令根本没成"和"目录真的没有"输出逐字相同，于是"残留 0 枚"可以是**一次失败的读数**。
       ✅ 每条读取通道都要有**两个出口**：取不到 ⇒ 响亮退 3（环境无效），为空 ⇒ 才许进判据。
    3. **子 shell 里的赋值传不回父进程**（§10.134）：新加的出口写成 `LISTING=$(db_ls)` ——
       函数里给标志位赋值发生在**子 shell**，父进程永远看不到 ⇒ 那条新出口一次都没被走到，
       而它看起来"已经写好了"。✅ 跨进程边界的读数只能**落盘**（或走 stdout 由父进程取），
       新写的出口先离线喂一枚"该命中它的样本"（阳性对照），别用"代码在位"当"路径被走过"的证据（#46）。
    第 1、3 款都被 §10.101 那道常驻静态门禁 `check:shell-exit-chain` 的形状覆盖了一部分；
    第 2 款只能靠"两个出口"的写法本身，静态门看不见运行时错误。

281. 🔴 **装置的失败信息会替装置许下一个它没有的能力。** 两处（§10.119 ② / ③），形状完全一样：
    - `bail()` 打印"还原源码并尽力把设备交回干净产物"，而函数体只做了一件 `cp` 源码 ⇒
      交回干净 APK 那一步**从来没发生**，失败收尾时设备静默留在**变异产物**上；
      而下一位读到那句"已尽力交回"就不会再去查设备。
      ✅ 修法是把能力真的做出来（抽 `restore_clean()` + 一枚 `INSTALLED` 标志），不是把那句话改短。
    - 失败信息写"已滚过四个方向"，而 `scroll_to_desc` 的循环体是**同一发滚动重复四次** ⇒
      那句"四个方向"描述的是**意图**，不是这次跑过的事。
    📌 一般规律：**装置打印的每条能力，要么在那一刻有对应的调用，要么就别打印** ——
    失败信息是后来者唯一的现场记录，它多写一分，现场就被少查一分。
    同族（不同成因）：#191（文件名枚举型门禁在文件被删时安静不执行）、#279 第 4 款（桩把输入洗没了）。

282. 🔴 **永远拒绝的门和永远通过的门同族，而且更难发现 —— 因为它"每次都在做事"。**
    §10.138：iOS 设备占用门按"模拟器里存在 app 进程"判占用。
    现量四台 Booted **全部装着 Heyta.app**，而模拟器不会因为一轮验收结束就杀进程
    （那四枚进程的 CPU 时间逐字不变）⇒ 门 **4/4 全挡**，我据此把这一格登记成
    "**环境阻塞**，等其他人的设备空出来"，让 iOS 那一格白等了几小时。
    真相是探针读错了信号：占用与否要读 **CPU 增量 / 本轮新出现的进程**，不是"装着且活着"。
    ✅ 两条纪律：**门的合法性由"它会不会放行"回答，不是由它拒了几次回答**；
    改门要配**正反两腿**（同一 argv，一个真烧 CPU ⇒ 必拒；一个纯 sleep ⇒ 必放行）。
    拿不到无人设备就**自建一台**，不许松门（本批那台是 `heyta-e2-ios-erasure`）。

    同批第二种面目（§10.138 ⑦，与 #184 同族）：**对照循环写在会话默认的 zsh 里** ⇒
    `set -- $var` 在 zsh **不做词分割**，`$1` 吞下整串、`$2/$3` 为空，
    `[ "" -lt 300 ]` 报错后**四腿全部落到"没拒 = PASS"**，打印出来的 `4/4 OK` 与真跑过**逐字相同**。
    ✅ 对照装置一律落成脚本文件再 `bash` 跑；输出里要能看出**每一腿的输入非空**
    （只打印结论的装置，坏在输入上是读不出来的）。

283. 🔴 **变异臂把"环境拒绝"读成"判据没牙"，还把"产物变了"当成"产物装上了"。**
    同一趟里两个错，第一个差点变成一句关于产品的结论。

    iOS 那臂（当时在 `tmp/ios-erase-arm-b76.sh`，验判据 B「一次 401 不许清库」自己能不能红；13:0x 转正到 `research/tools/mutation-rigs/ios-erase-arm-b76.sh`，而它调用的判据驱动仍在 gitignored 的 `tmp/` ⇒ 见本节末 #286）
    第 4 步 `pnpm build:ios` 打出变异后的 `Heyta.app`，**却从不 `simctl install`**；
    而 rig 的新鲜度门比的是**设备上**那份 bundle 的 mtime 与载体源码 mtime。
    🔴 更要命的是因果：**落变异这个动作本身**就把 `client.ts` 的 mtime 推到"刚刚"
    ⇒ 任何"只打不装"的臂**必撞这道门**，撞了就是 rc=3。
    12:06 那趟的实际读数：`驱动 rc=3`、`B 文件腿 ❌=0 ✅=0 / 数据腿 ❌=0 ✅=0 / C ✅=0`
    —— 五个数全 0（**一条判据都没执行**），而臂打印的是
    `ARM=DEAD —— 判据 B 在 iOS 上没有牙`。**那不是读数，是把环境拒绝写成产品结论。**

    ✅ 三条修法（都不放宽门）：
    1. **臂自己装**（`simctl install`），且装完回读设备上 `main.jsbundle` 的 md5
       **必须等于刚打的那枚**（`INSTALLED_JS_MD5 == ARM_JS_MD5`）。
       原先那条反作弊只写"产物 md5 与设备上那份**不同**"—— 它只证"变了"，不证"进去了"
       （与 #72 同族：mtime 与差异都不等于身份）。
    2. **结论三档，`NO-RUN` 必须排在 `DEAD` 前面判**：`rc=3` **或** 腿读数合计 0 ⇒ `ARM=NO-RUN` 退 3
       （看守继续等）；只有"判据确实跑过而 B 全绿"才允许写 `ARM=DEAD`。
       🔴 顺序反过来就恒错一次：rc=3 时那五个计数器**天然全是 0**，照字面读就是"一条都没红"。
    3. **复原腿要覆盖状态的全部两半**：旧 `restore()` 只 `cp` 源码，而臂已经改了**设备里的字节**
       ⇒ 下一趟基线会在"源码干净、设备上留着变异产物"的世界里跑，且没有任何一层会报红。
       现在变异前 `cp -a` 存下 app、收尾装回并打印 `RESTORE_APP=OK/PARTIAL/FAIL/SKIPPED`（装不回就响亮说）。

    分岔本身怎么离线证（不碰设备）：`research/tools/mutation-rigs/ios-erase-verdict-arms.sh` 抽第 7 段 + 桩喂五档现场，
    `ARMS=pass (5/5)`；变异读数 = 摘掉 `NO-RUN` 那一档（9 行）后
    `ARMS=FAIL（2 腿不符）`，且**只红 L1/L2**（`rc=3`+全 0、`rc=0`+全 0），L3/L4/L5 逐字不变
    ⇒ 这台装置有牙，红的正是承重的那一格。
    📌 一般规律：**任何"臂存活 ⇒ 判据没牙"的推理，前提必须是"判据执行过"**；
    而"执行过"这件事只能由**读数计数**证明（腿读数 > 0），不能由"rig 退出了"证明
    （退 0 与退 3 都可能一行判据都没跑 —— 见 #280 那两个出口）。

284. 🔴 **验证装置收了参数却不用它 —— 落盘那一步整体消失后，比的是两个不存在的文件，
    而"非空守卫"拿到的是**空串**而不是 0，三道守卫一道都没触发，照样打印结论并退 0。**

    2026-10-05 实测（`docs/plans/trash-and-archive.md` §10.146 那句"step 5 本体逐字存活"的复量装置）：
    函数写成 `block() { awk … | sort -u; }`（结果在 stdout），调用写成 `block FILE OUTFILE` ——
    **`$2` 从头到尾没被使用**，所以两个块文件根本没被创建，接下来每一步都在"没数据"上装作有读数：

    | 环节 | 本该 | 实际 |
    |---|---|---|
    | `grep -c '' 不存在的文件` | 0 | **空串**（计数走了 stderr 报错那条路） |
    | `[ "$HEAD_LINES" = "0" ]` | 触发守卫 | `"" = "0"` 为**假** ⇒ 守卫形同不存在 |
    | `comm -23 不存在 不存在 \| grep -c ''` | 报错可见 | 输出空 ⇒ `MISSING=0` |
    | 最终 | 响亮失败 | `VERBATIM=survives` + **rc=0** |

    🔑 **空串会绕过等值守卫**：`-eq 0` 会直接报语法错（响亮），`= "0"` 却是安静地不相等。
    所以写守卫要 `[ -z "$V" ] && fail` 放在等值判断**之前**，或者干脆判"文件存在且非空"（`[ -s f ]`），
    别拿"读出来的数"当"读到了"的证据。

    ✅ 修法（三条都是给装置加前提，不是放宽门）：
    1. 提取函数把结果 `> "$2"`，并**当场**要求 `[ -s "$2" ]` **且**块里读得到锚点串 —— 锚点读不到
       说明取到的是别的块，直接 `exit 1`（"文件非空"只证明 awk 命中了什么，不证明命中的是对的块）。
    2. 正常读数之后跑**阳性对照**：从新块里删掉一行两边都有的行，要求 `MISSING` 的**增量**
       恰好等于被删掉的行数。⚠️ 我第一版把期望写成"等于删掉的行数"，而基线 `MISSING` 本来就是 1
       ⇒ 一趟**真**读数被自己的对照判成 `UNFAIABLE` —— 装置比我对它的要求严，坏的是那条算术。
    3. 结论分三档（`survives` / `title-only` / `rewritten`），"缺的行是不是标题那一行"由
       `grep -vc '^step "5'` 现量，不靠我读完清单自己归类。

    📌 同趟顺出的一条，影响**装置该放哪**：**`tmp/` 在 `.gitignore:206`**（`git check-ignore -v tmp/x.sh` 现量）。
    放在 `tmp/` 的验证装置不会被下一个人拿到、也不进任何提交 —— 要长期留就得落在
    `research/tools/` 或 `scripts/`。这也给 #89 那笔债定了实际价：那些 `$VAR`+全角残留所在的 67 处
    全是 gitignored 的一次性装置，代价是"下次现编装置时重踩"，不是"仓库里带病"。
    同族：#249（文件数不变 ⇒ 计数自检在这一面目下恒真）、#272（抄件被删那天臂变恒真）、
    #283（"没跑"被读成"没牙"）—— 这一条是**恒真的第三种成因：不是阈值错，是参数没被用**。

285. 🔴 **`VAR=x 命令A | 命令B` 里的前缀赋值只给管道里的**第一条**命令 —— 同一份写法在
    "变量是从 `VAR=x bash 脚本` 继承来的"那个脚本里能读到，在新脚本里就读成空。**

    2026-10-05 实测（给 #76 变异臂加"按 UDID 现量设备名"这一腿时）：

    | 写法 | 出处 | 结果 |
    |---|---|---|
    | `IOS_UDID="$IOS_UDID" xcrun … \| python3 -c 'os.environ["IOS_UDID"]'` | rig 自己的归属腿（`tmp/e2-ios-erasure.sh:60`） | **能成** —— 因为它那个 `IOS_UDID` 是由调用方 `IOS_UDID=… bash 脚本` 传进来的，**在子 shell 里天然带 export**，管道第二段继承得到 |
    | `IOS_UDID="$UDID" xcrun … \| python3 -c 'os.environ["IOS_UDID"]'` | 我在臂里抄的同一形状 | **读成空** —— 臂里 `UDID` 是普通局部变量，前缀赋值只作用于 `xcrun`，python 拿不到 ⇒ 我这一趟直接复现出 `KeyError: 'IOS_UDID'` |

    后果不是报错而是**安静的空值**：拿它去判"这台是不是本线自建的"会恒判"不是"，
    于是那道门的逃生口永远打不开，而读数看起来像"环境在拒绝我"（同 #283 那张脸）。
    ✅ 修法：把值走 **argv**（`python3 -c '… sys.argv[1] …' "$UDID"`），并在装这条腿之前
    用**两腿对照**先验它自己：自家 UDID ⇒ 读出 `heyta-e2-ios-erasure`；一枚不存在的 UDID ⇒ 读出空。
    两腿都按预期，才允许它去决定要不要转旗。

    📌 一般规律：**同一段代码的"能不能读到环境变量"取决于调用它的人怎么把变量传进来**，
    不取决于这段代码本身。所以把别处能跑的管道片段抄进新脚本时，先问一句
    **"这个变量在我这里是 export 的吗"** —— 或者干脆不依赖环境，走 argv/参数。
    同族：#64（`$VAR` 紧跟全角把变量名吞掉）、#164（后台任务的 exit 0 是包装命令的）、
    #284（参数声明了却没用 ⇒ 比的是两个不存在的文件）。

286. 🔴 **拿绿行的字面形状去数红行 ⇒ 红行数成 0 ⇒ 判据"没牙"。** 这是 #283 那句假结论的
    **第二副面目**：上次是 rc=3（连判据都没跑）被折进 `DEAD`，这次是判据**真跑了**、
    summary 明明白白报失败 3 项，而我的计数器一条都没命中。
    同一条判据的两侧印的是**两种形状**（iOS 注销销毁 rig 实测，`scripts/verify-mobile-ios-account-erasure.sh`
    的 `good()` / `bad()` 原文）：

    | 腿 | 绿行长什么样 | 红行长什么样 |
    |---|---|---|
    | 文件腿 | `✅ 判据 B（文件腿）成立` | `判据 B 红：一次 401 就把本机库删了…`（**不带**「（文件腿）」） |
    | 数据腿 | `✅ 判据 B（数据腿）成立` | `❌ 🔴 判据 B 红（数据腿）：401 把 ops 从 …` |

    旧臂数的是 `❌ 判据 B（文件腿）` / `❌ 判据 B（数据腿）` —— 红行里没有"❌ + 括号腿名"这个组合，
    于是四条计数全 0，臂打印 `ARM=DEAD —— 判据 B 在 iOS 上没有牙`（计划 §10.155 ②）。
    同一分钟那份日志第 99 行就印着数据腿转红。

    ✅ 修法有两条，**第二条才承重**：
    1. needle 从**被调方**（`bad()` / `good()`）的原文逐字抄，不许凭记忆构造；
    2. 加一条**计数与 summary 对账**的守卫：`summary 报失败 > 0` 而 `B 的几条计数全 0`
       ⇒ 判"我的针没对准"（`ARM=NEEDLE-MISMATCH`），按**环境/装置无效**那一档退出（3），
       绝不落到"没牙"那一档。理由：**"我读不到"与"它没红"在输出上长得一模一样**，
       而我只能当场否证前者。守卫自己也要有腿：`research/tools/mutation-rigs/ios-erase-verdict-arms.sh`
       的 L5 腿就是 12:51 那个现场，摘掉守卫那段 ⇒ 只红 L5 且逐字复现那句假结论（已实测）。

    📌 一般规律：**任何"数某一行在不在"的判据，两侧（成立/不成立）的字面形状要各自从被调方抄，
    并且要有一条"计数与总量对得上"的对账腿** —— 否则探针坏的时候，它会替你说一句关于产品的假话。
    同族：#283（rc=3 折进 DEAD）、#46（没复现 ≠ 路径没执行）、#197（`Operation not permitted`
    在成功运行里也出现 ⇒ 它连必要条件都不是）。

287. 🔴 **"这个模式不碰设备"的早退分支写在流程末尾 ⇒ 它照样把 0–5 段全跑完。**
    分支的位置不是装饰：bash 从上往下执行，`if [ -n "$RECOUNT" ]; then … fi` 放在文件最后，
    前面那些"落变异 / 重打 / 装进模拟器 / 跑判据"就一句都不会少。

    2026-10-05 实测：给 #76 的臂加"拿新尺重读旧日志"模式时，把该分支追加在原第 6/7 段的位置，
    然后跑 `RECOUNT=/tmp/e2-ios-erasure-124444.log bash 臂` —— 它先过了负载门、又重打了产物、
    又装进设备、又起了一趟真机判据，**直到超时被 `TaskStop` 都没读到那行读数**。
    代价是一趟真机被起来又被停掉（这台设备是**我自己的** `heyta-e2-ios-erasure`，
    而 `trap restore EXIT` 兜住了现场：源与设备产物两侧 md5 都回到变异前那枚）。
    修好之后同一趟耗时 **0.038 s**、零设备调用。

    ⚠️ 这一条容易自我否证，因为"它能重读旧产物"这件事本身只能靠跑一趟来证明 —— 而跑一趟
    恰好就是那件有副作用的事。所以**加任何"只读/重算/演练"模式时，先把它放在所有副作用之前，
    再用一次真实旧产物验证它零副作用**（这里用的证据是时间 + 日志里根本没出现 1–5 段的标题）。

    📌 同族且更常见的一副面目：`--dry-run` / `--check` / `PREFLIGHT=1` 这类开关
    被追加到脚本尾巴上，于是"演练"照样改了东西。判据：**演练模式的输出里不得出现执行段的标题行**。

288. 🔴 **bash 双引号里的反引号是命令替换 —— 判据的"消息"会替自己印出一个空串，外加一行 `command not found`。**
    2026-10-05 实测（Android 注销销毁 rig 的 external 档，`scripts/verify-mobile-account-erasure.sh`）：
    `ok "判据 C（被动通道）成立：界面上出现了词条 \`common.sync.error.accountClosed\` 那句 …"`
    ⇒ 真机日志里先出现
    `scripts/.verify-mobile-account-erasure.sh.snap.4703: line 625: common.sync.error.accountClosed: command not found`，
    紧接着那句读数印成「界面上出现了词条  那句」（**两个空格中间是空的**）。

    两个方向的误读都成立，所以两种都贵：
    ① 看到 `command not found` 就判"这一腿坏了" —— 其实**断言用的是字面中文串**（`has_sub "这个账号已经注销…"`），
       那一腿是真的过了；② 看到"词条 ⟨空⟩"不当回事 —— 那正是" needle 是不是空串"这类问题唯一会露头的形状。
    ✅ 修法：消息里要提词条名就**直接写名字**（不带反引号），或写成 `"\`…\`"`；
       判据的**比较串**永远用变量/字面量，不经过任何会被替换的引号层。
    📌 一般规律：**判据的"结论消息"也是代码**。它能执行命令替换、能吞掉值，
       所以它坏的时候会把一条**好**判据读成坏消息，或把一条**坏**判据的空 needle 读成"匹配到了什么"。
       同族：#64（`$VAR` 紧跟全角把变量名吞掉）、#286（拿绿行形状数红行）、#281（失败信息替装置许能力）。
289. 🔴 **BSD `mktemp` 只替换模板**末尾**的 `XXXXXX` —— `/tmp/x.XXXXXX.sh` 会原样建出一枚固定名文件，
    两台装置共用同一枚，并行时互相覆盖，而且没有任何一步报错。**

    实测（2026-10-05 13:5x，这台 mac，`/usr/bin/mktemp` BSD 版）：

    | 写法 | 返回 | 是否唯一 |
    |---|---|---|
    | `mktemp /tmp/mkX-test-body.XXXXXX.sh` | **字面量** `/tmp/mkX-test-body.XXXXXX.sh` | ❌ 每次同一枚 |
    | `mktemp /tmp/mkX-test-run.XXXXXX` | `/tmp/mkX-test-run.V7zJPo` | ✅ |

    它**不报错、退出码 0、文件真的建出来了**，所以单跑一趟永远看不出问题。代价在并行时兑现：
    离线 rig 的载具（`BODY`）与运行日志（`RUNLOG`）都是固定名 ⇒ 另一趟把载具改写 ⇒
    我这台装置跑的判据本体是**别人那一份**；收尾 `rm -f "$BODY"` 又把对方的载具删掉，
    对方的症状是"跑到一半文件没了"。GNU 版 `mktemp` 支持模板中间插 X，所以这条只在 mac 上现形 ——
    与 #77 那条"同一份脚本两个 OS 语义不同"同族。

    ✅ 抓到它的不是设计，是**把临时路径打进输出**：新 rig 印了 `抽自 /tmp/b90-runlog.XXXXXX.txt`，
    那串字面 X 一眼就不对。⇒ 一次性 sweep：`grep -rn 'mktemp [^ "]*XXXXXX\.' research/tools scripts --include='*.sh'`
    （现在回 **0**）；12 处 / 5 个文件已改成 X 组结尾（需要后缀就写 `/tmp/name.txt.XXXXXX`）。
    改完 4 枚离线 rig 全部复跑：`FILELEG=RIGID`、`ARMS=pass (7/7)`、`ORDER=pass`、`PASSIVE=pass`。

    📌 一般规律：**临时路径要打进输出**。可读的产物路径是这类"只在并行时现形"的缺陷唯一的日常露出头；
       藏在变量里就等于把探针的完整性交给运气。
    同族：#64 / #288（结论消息也是代码）、#196（尾斜杠只匹配目录 ⇒ 语义随写法变）、#179（管道后 `$?` 是 `tail` 的 —— 本条第一趟就栽在这上面：门禁红我用 `| tail` 读成 rc=0）。

290. 🔴 **四端重装的 iOS 段会改写仓库里 tracked 的源码文件**（`Podfile.lock` 与 `project.pbxproj`）—— 跑完之后
    "工作树干净"这句不再成立，而脚本自己只对其中一枚喊了一句。

    实测（2026-10-05 14:2x，在隔离载体里跑 `bash scripts/reinstall-all.sh`）：ios 段的 `pod install` 让
    `Podfile.lock` 与 HEAD 差 4 行（脚本打印了 `⚠️ pod install 改动了 Podfile.lock`），而
    `apps/mobile/ios/Heyta.xcodeproj/project.pbxproj` **也被改写，输出里没有任何一行提到它**。
    现量对照：跑前这棵载体的脏条目 = 30 枚（全是 e2e 改写的 `*/evidence/*.png`），跑后 = **32**，
    多出的两枚都是**源码类** tracked 文件。

    为什么危险：① 在**共享工作树**里跑这条固定收尾流程 = 替别人制造脏行，别人下一轮的"撞车判据"会把我这两枚
    读成"他在飞"；② 凡是拿"载体 = 当前 main 且 0 脏"当前提的说法，**跑过重装之后必须重取**，
    拿跑前那张读数继续引用就是抄件漂移（#289 那个"只在并行时现形"是同族）。

    ✅ 处置：① 这类流程只在隔离检出跑（这是 §6.1.1 要求隔离的**又一条**理由 —— 之前给的理由是"别人的未提交源码"）；
       ② 跑前后各取一次 `git status --porcelain` 的**分类计数**（证据类 / 源码类），不要只数总数 ——
       只数总数会把"多了一枚 pbxproj"混在 30 枚截图里看不出来；
       ③ 该把 `pod install` 那句 ⚠️ 扩成"本轮被改写的 tracked 文件清单"，这条登记给打包脚本的所有者（工单 #92），
       不在本条里顺手改别人的脚本。

    📌 一般规律：**验收流程本身是写者**。它留下的脏行会污染下一次以"干净树"为前提的判断 ——
       #83（探针把应用停在设置页，截图判据接着就在错误视图上打分）是同一族的第一个面目，
       #191（门禁的目标文件被流程自己删掉 ⇒ 安静不执行还报通过）是第二个，这条是第三个。
    同族：#83、#191、#196、#288、#289。

291. 🔴 **`pnpm -r test` 的"第一个失败包"会让整批读数只覆盖前缀** —— 而那个失败可能只是一枚环境类闸门。

    实测（2026-10-05 14:3x，隔离载体）：第一趟 `packages/sync-core test` 打
    `内存闸门拒绝启动：已有测试在跑（pid=70920，锁 /tmp/tfa-test.lock）` ⇒ `[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL]` **递归中止**；
    现量两处把这枚红定性成"环境"：`ps -p 70920` **没有这个进程**、`/tmp/tfa-test.lock` 也已不存在 ⇒ **stale 锁**。
    当天第一趟日志里只有 **3 条** `Test Files` summary（本地 19 个包的量），第二趟（锁自己消失后原样复跑）才是
    **19 个包 / 9126 passed / 13 skipped / `failed` 词频 0**。

    为什么危险：两件事叠在一起 —— ① **闸门类拒绝被算成测试失败**（与 #283/#285 同一族：环境无效 ≠ 产品失败）；
    ② 更要命的是**中止**：读日志的人只会记下"sync-core 红了"，不会注意到其余十几包**一条断言都没跑**，
    于是"我看过全量测试"这句话在**覆盖前缀**的读数上被签掉。

    ✅ 修法：报"全量测试"结论时**数包数**，并把预期包数现量写进同一行
       （`grep -c 'Test Files' 日志` 对比 `pnpm -rl test | wc -l` 的应跑数）；
       环境类拒绝（stale 锁 / 端口被占 / 负载超阈值）一律**等它自己消失后原样复跑**，不改阈值、不放宽闸门。
    📌 一般规律：**递归运行器的失败传播会把"没跑"伪装成"跑过一部分"**；覆盖范围要自己数，不能靠运行器的退出信息。
    同族：#45（管道后 `$?` 是 `tail` 的）、#164（后台通知的 exit 0 是包装命令的）、#179、#283、#287。

292. 🔴 **把 `e2e/node_modules` 软链进主检出，会让隔离载体里所有走 `pnpm --dir e2e exec` 的门禁
    变成"随机红"，而且它的产物写进的是**别人的**树。**

    建隔离载体时我按"`e2e/` 那份 `node_modules` 只有第三方依赖，共用无妨"软链了过去 —— 载体自建的
    `readlink -f` 判据量的是 **workspace 包**（`@heyta/*`），它对这一枚是**瞎的**：`e2e/node_modules`
    不是 workspace 链接，软链照样解析到主检出。

    14:3x 那趟全量 `pnpm check` 里 `check:vault-diagnostics` **是过的**，14:47 第三趟同一载体同一门禁**红了**，
    报的是 `Diagnostic probe did not produce a test report; check the test lock/browser availability`。
    两次之间变的不是我的代码，是主检出 `e2e/` 被并行会话动过 ⇒ pnpm 的依赖状态检查认为这份 modules
    该清装。真凶要自己把被吞的输出挖出来才看得见：

    ```
    [ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY] Aborted removal of modules directory due to no TTY
    ```

    ⇒ `pnpm --dir e2e exec playwright test …` **根本没起跑**（Playwright 是被 pnpm 换掉的，不是被跳过的），
    所以 JSON 报告不存在。这一类有三个各自独立的坑：

    1. **载体隔离的判据要按"谁来 exec"量，不是按"链接解析到哪"量。**
       任何用 `pnpm --dir <子目录> exec` 的门禁，那个 `<子目录>/node_modules` **必须是载体内的真目录**；
       软链在 workspace 判据下是绿的，在 pnpm 眼里却是"和我预期不一致的目录"，而它会想清装。
       修：`rm e2e/node_modules`（不带 `-r`、不带尾斜杠 —— 删的是链接本身）→ `cd e2e && pnpm install --frozen-lockfile`；
       改完载体侧 `ls -ld` 复量成 `drwxr-xr-x … e2e/node_modules`，并当场复量**目标条目数不变**
       （我这两枚数都印了：主检出那枚摘链前后都是 1 项 ⇒ 没伤到别人）。
       改完单跑那枚门禁：`VD2_EXIT=0`，两条臂都印出来（正向 `preserve assertions without the sensitive page tree`
       + 负向 `removing the aria guard exposes the canary`）。
    2. **门禁把子进程的日志吞了，载体缺陷就长得像"环境没备好"。**
       `check-vault-diagnostics.mjs` 已经用 `child.stdout.on('data', …)` 把输出收进 `result.log` 了，
       然后 `catch { throw new Error('…check the test lock/browser availability') }` —— 一个字段都没打印。
       我因此连丢两趟归因（第一趟还错猜成"并行 Playwright 抢共用 `test-results`"，**单独跑仍红 ⇒ 被自己否证**）。
       可迁移的形状：`catch` 里 throw 之前必须打印 **child 退出码 + `result.log` 尾部**；
       只给"可能是 A 或 B"的一句话，等于把归因成本转嫁给下一个读它的人（同族 #197：一条 `Operation not permitted`
       在成功运行里也出现 ⇒ 它连必要条件都不是）。
    3. **共享 `node_modules` 的真实代价不是"产物写进别人的树"（这条我写重了，现量否证），
       而是"载体的一次运行可以**删掉**别人正在用的依赖目录"。** 那句 `ABORTED_REMOVE_MODULES_DIR_NO_TTY`
       说的是 pnpm **已经决定**要清装它，只有"没有 TTY 就拒删"这道自锁救了主检出 —— 同一条命令放进 CI
       （`CI=true`）或有人交互式确认，`heyta/e2e/node_modules` 就会在并行会话脚下消失。
       改完在**主检出**侧复量零残留：`git status --porcelain -- e2e` 空、`ls e2e/test-results` = `total 0`、
       无 `.vault-diagnostics-*`（临时目录建在 `<root>/e2e/` 下，`root` 由脚本自身位置推导 ⇒ 落在载体那棵，
       没顺着链接跑）。所以这一坑的判据是**写权限面**，不是产物面。

    📌 一般规律：**"共用第三方依赖目录是无害优化"这个直觉，只在没有人用包管理器的 exec 语义碰它时成立。**
    隔离载体的判据要写成"每条 `--dir X exec` 路径上 X/node_modules 是真目录"，而不是"workspace 链接解析在载体内"。
    同族：#46（没复现 ≠ 路径没执行）、#176、#191、#277、#283、#290、#291。


293. 🔴 **变异臂的"源码已还原"只说了本地 —— 只要构建会把工作树推到另一台机器，还原就必须覆盖每一台被写过的机器。**

    `scripts/run-gradle.mjs` 的步骤 2 复用 `scripts/lib/sync-windows-sources.sh` 把**当时的工作树**整棵同步到
    `C:\src\heyta`。所以 `trap … EXIT` 里那句 `cp pristine → SRC` + `git diff --quiet` 为空，**并不**意味着共享
    打包机干净。10-05 17:24 实测：本地上 **0 行**脏，远端 `packages/app-host/src/note-actions.ts` md5
    `ca70c6e9…`（=变异体），拉回本地 `diff` 恰好 **1 行**、就是那一发针脚。

    为什么这条判据抓不住它：同步步骤的 sha256 对账比的是**本地 vs 远端**，两边是同一份错的时候照样"一致"
    （第 82 条的形状，而这次残留是自己造的不是别人留的）。下一趟别人的构建会把这发变异打进产物。

    ✅ 修法（已在 `research/tools/mutation-rigs/w6-note-restore-device-arm.sh` 落地）：还原分支里把 pristine
    **推回 `$REMOTE_ROOT/$SRCREL` 再拉回来逐字节对账**，对不上或推不动就印 `REMOTE_RESIDUE=` 大字，绝不静默跳过。
    ⚠️ 两个必须是这样的：`REMOTE_ROOT` 与 `run-gradle` 读**同一个** `HEYTA_ANDROID_REMOTE_ROOT`（写死路径时，
    别人改了根，还原会推到不存在的地方，而"回读对上了"变成**自己跟自己比**的假 ok）；
    自测要 `awk` 把**真函数**eval 出来跑三腿，不要在测试里重写一遍逻辑（那就是第 66 条"给装置写它没有的能力"）。

    📌 可迁移：**"本地 git diff 为空"是"这一台机器干净"的判据，不是"所有被写过的机器干净"的判据。**
    任何把工作树往外推的构建/验收流程，收尾清单的分母 = **被写过的机器数**，不是本机仓库数。

294. 🔴 **把判据从"同实例读回"换成"新实例读回"之前，必须先证明新实例指向同一份存储 —— 否则你造出一条恒绿。**

    共享契约的载具只拿到 `{ name, create }`（`packages/storage/tests/contract/adapter.contract.ts:60`），
    而两份实现的 `create()` **每次返回一套全新的存储**：`memoryDb()` 是新的 `MemoryDbAdapter`，
    `freshIndexedDb()` 连 `globalThis.indexedDB` 都换成新的 `IDBFactory`（`contract.spec.ts:29-40`）。
    所以「destroy 之后每个 store 都是空的」若天真改成再 `create()` 一次，这两档**无论产品怎么做都读得到空** ——
    一条现在会红的判据被换成一条不能失败的（元规则 2）。

    🔴 同族第二发，而且是同一轮自己打自己的：**"删掉的文件重新打开是空的"接近恒真**。
    给 SQLite 文件版补了两条腿（前提正对照 + 新实例读到空，419 passed）之后做变异 ——
    把 `destroy()` 里的逐表 `DROP TABLE` 循环整段跳过（`VACUUM` 与 `removeDatabase()` 照旧）：
    **新实例仍读到空 ⇒ 两条腿全绿**；那一轮唯一的一枚红来自另一条 spec
    （`destroy.spec.ts` 里"驱动没有 `removeDatabase` 时必须报'文件仍在'"那一档）。
    也就是说这条腿**不需要 DROP 真的发生就能绿** —— 它没牙，写完就删掉了，没有留在共享树里。

    ✅ 正确形状：给载具补一个**真指向同一份存储**的重开能力，并让它自带**前提腿**
    ——「**不销毁**时新实例读得到上一实例写的行」；前提不成立就拒绝运行，不许把"读到空"当证据。
    没有持久容器的实现（`MemoryDbAdapter`）那一档**明确跳过**，而不是读一个必然空的新实例。
    持久性与字节残留那一面本来就有更硬的判据：**数目录条目**（不是 `existsSync(主文件)`）+ 删不掉时不许静默成功。

    📌 可迁移：**换判据的读法之前先量载具**。"同一个断言、换一种读法"最常见的失败不是读错，
    而是新读法**够不着被测状态**，于是把红的能力一起换掉了。

295. 🔴 **起跑那一刻成立的闸门，对一条 85 环的长链没有约束力** —— 链越长，被别的会话在**中途**顶掉概率越高；
    而"顶掉"在输出上长得和产品红一模一样。

    同一族两趟（账在 `docs/plans/trash-and-archive.md` §10.168，含现量表）：

    | 趟 | 起跑那一秒 | 死在哪一环 | 闸门自己打的持有者 |
    |---|---|---|---|
    | 第七趟 | 五道门全过 | 第 **83/85** 环 | `pid=21054`（并行会话的让窗看守） |
    | 第八趟 | `WAIT8=cleared tries=3 load1=10.23 vitest=0 playwright=0` | 第 **8/85** 环 | `pid=58812` = `npx vitest --run electron` |

    两趟的拒启行形状**逐字相同**（`grep -cE 'pid=[0-9]+.*tfa-test\.lock'` 各命中 1），只是位置不同 ——
    我之前把它们分成"活锁/失效锁"两种，那个分类是错的。

    ✅ 正确处置**不是调松阈值**（那枚锁是仓库为整机 OOM 装的安全门；`TFA_ALLOW_CONCURRENT_TEST=1` 一次都没用）：

    1. 拒启读数必须**自带持有者**（pid + 命令行）—— 闸门已经打了，归因不用人猜；
    2. 把"环境无效 vs 产品失败"的分界**写成装置**：非零退出的那一趟，只有链尾 120 行里出现
       `pid=<数字> … tfa-test.lock` 才判环境无效并重跑（≤3 趟）；没有那一行 ⇒ 判产品红，
       **立刻停、退出码原样透传**。正对照用两趟真日志各验一次（`refuse_in_tail=1`）；
       反对照（真产品红样本）**没有**，但误判代价有界 —— 最多白重跑 ≤3 趟，**不会把红读成绿**，
       最终结论仍取链自己的退出码。

    📌 可迁移：**闸门量的是"起跑那一秒的世界"，链跑的是"接下来的几十分钟"**。
    任何"前置成立 ⇒ 本轮有效"的判据，都必须要么覆盖整条链的时长，要么在失败时能自证死因是谁。

296. 🔴 **装置把"测试根本没跑"印成"零失败" —— 缺的不是失败判据，是"这次运行存在"的前提腿。**

    `research/tools/mutation-rigs/e2-destroyed-guard-arms.sh` 里抓变异读数是这一行：

    ```bash
    failures=$(grep -oE '[0-9]+ failed' "$log" | tail -1 | grep -oE '[0-9]+')
    say "判据读数：failed=${failures:-0}"
    ```

    这台机器上有一条**内存闸门**（`/tmp/tfa-test.lock`，见 §7 第 87 条那一族）会在别的会话跑套件时
    拒绝启动 vitest：它打印一句中文说明 + 非零退出，输出里**既没有 `failed` 也没有 `×`**。
    于是 `${failures:-0}` 把"根本没跑"翻译成了"零失败"，而下一行还照常打印变异后的探针读数 ——
    整趟看起来像"摘掉修复后判据纹丝不动"，也就是**这条修复没有牙**，而真相是判据一行都没执行。

    两个独立的成因叠在一起才出事，缺一个都不会有假绿：
    ① 汇总行的词序两种都出现过（`6 failed | 412 passed` / `412 passed | 6 failed`），
      只按一种抓 → 读成空；
    ② 空的默认值被写成 **0**（"没观测"到"零失败"只差一个 `:-`）。

    ✅ 修法是把"运行存在"当成一条**前提腿**，而不是默认值：

    ```bash
    if ! grep -q 'Test Files' "$log"; then
      say "ARM=BLOCKED reason=测试根本没跑起来（被闸门挡住），这不等于零失败"; exit 3
    fi
    ```

    📌 可迁移：**任何"从日志抓计数"的判据都要有一条"这份日志属于一次真实运行"的现量**
    （vitest 的 `Test Files`、Playwright 的 `N passed`、`adb` 的 `Success`、远端的 `ADD_APPX=OK`）。
    默认值一律写成一个**会响的状态**（`未跑` / `BLOCKED` / 退出码 3），绝不写成 `0`、`true`、`[]` ——
    `0` 与"零失败"、`[]` 与"全部通过"在下游是同一个值，而这正是 §7 元规则 2
    （"一条永远通过的判据比没有判据更糟"）最省事的实现方式。

    ⚠️ **同一个假绿还有一个不带闸门的原因：`-t` 过滤词没命中。**
    `vitest run <file> -t 'versionchange 让位'` 里我漏了标题中 `versionchange` 后面那个**反引号**，
    输出是 `Tests 15 skipped (15)` 而 **exit 0** —— 没有任何一行红，看起来就是"摘掉修复后判据不动"。
    ⇒ 用了 `-t` 就必须回读 `Tests` 行的**总数与 skipped 数**（`1 passed | 14 skipped` ≠ `15 passed`），
    并且**先跑一次绿运行**确认过滤词命中，再拿它做变异。同族：#191（挂在文件名枚举上的门禁，文件没了就安静不执行）。

297. 🔴 **销毁器另开一个连接去 `deleteDatabase`，而挡住它的是同一个应用自己那几份活连接 ——
    IDB 的 `versionchange` 不接，删除就永远停在 `blocked`，而且界面上看起来像"正在忙"。**

    Web 的注销路径（`apps/web/src/lib/local-data-destruction.ts`）清 `WEB_DATABASE_NAMES`
    （`heyta` / `heyta-vault` / `heyta-widget`）时，主库走"新开一个 `IndexedDbAdapter` 再 `destroy()`"，
    另两个走裸 `deleteDatabase`。而页面上**同时**有人握着这些库的连接：
    `oplog.ts` 的模块级 `db`、`vault-session.ts` 的 `adapterPromise`（`heyta-vault`）。
    `IndexedDbAdapter.open()` 当时只挂了 `onclose`，**没挂 `onversionchange`** ⇒
    浏览器发出 `versionchange` 后没人让位 ⇒ `deleteDatabase` 停在 `blocked` ⇒
    而我们的 `destroy()` 刻意**不在 `onblocked` 里 resolve**（那是另一条判据钉的：
    在 `onblocked` resolve 就是伪造"销毁成功"）⇒ 整条 `eraseLocalData()` 的 await **永不返回**。
    界面上的形状是"注销转圈"，日志一行都不留，`reports` 一个都没写出来。

    三个容易看错的地方：

    1. **真浏览器判据当时是绿的**，因为它跑的是 OPFS/worker 那一档，
       而销毁器先 `releaseStorageWorker()` 把句柄撤掉了（`:146`）。
       **一条绿判据覆盖的是它走的那条路，不是同一个函数体的所有路**。
    2. **"另开实例"看起来更干净**（不碰应用的连接，避免半路拆台），
       在 IDB 上恰恰是**自我阻塞**的做法 —— 同库名的删除必须由**连接持有者自己**让位。
    3. `blocked` 不是失败事件，**它没有 `error`**，也没有超时；
       任何"等它一会儿再看"的探针都会把它读成"慢"。

    ✅ 修法在共享层：`IndexedDbAdapter.open()` 里 `onversionchange = () => { db.close(); 清缓存 }`
    —— 让位是连接持有者的义务，不在每个壳里复制一份"注销前先把我的连接关掉"。

    📌 可迁移：**判据要成对**——"不接 `versionchange` 的裸连接 ⇒ 删除必须停在 `blocked`"
    钉的是"不许伪造成功"；"我们自己这个类 ⇒ 不许挡住那次删除"钉的是"不许自我阻塞"。
    只有前一条，实现可以永远 blocked 也算"没撒谎"；只有后一条，
    把 `onblocked` 改成 resolve 也能蒙过。方向相反的两条腿缺一条，这一格就是半瞎。
    同族：#46（没复现 ≠ 没执行）、#176（桩在用例走到被测判据之前就返回）。

    ⚠️ **修完适配器不等于修完这件事 —— 持有者是一个集合，不是一个。**
    现量枚举产品代码里的 `indexedDB.open(`，除适配器外还有第二处：`apps/web/src/pwa/sw.ts`
    开着 `heyta-widget`（这个库名**在** `WEB_DATABASE_NAMES` 里 ⇒ 注销确实要删它），
    而它的 `tx()` 只在 `transaction.oncomplete` 里 `close()` —— **请求失败走 `onerror`，
    那条路上事务不会 complete**，连接就悬着，于是同一个 `blocked` 形状在另一个持有者上原样复现。
    它躲得过上面那条行为判据（那条只cover适配器自己的连接），所以配了一条**扫全仓**的静态腿：
    每个文件的 `indexedDB.open(` 次数必须等于 `.onversionchange =` 次数（**比数量**，
    比"文件里出现过这个词"多挡一处"同一文件里第二次 open 忘了接"），
    前提腿要求 `apps/` 与 `packages/` **各自**都扫到（只要求总数时，一棵树整个走空也不会红）。
    📌 **行为判据钉住"这一处"，枚举判据钉住"这一类"** —— 只有前者时，第二个持有者出现就是安静的回归。
    ⚠️ 另记：`apps/web/public/sw.js` 是 esbuild 打包物（`gen:pwa` 生成、`check:pwa` 逐字节对账），
    改 `src/pwa/sw.ts` 必须重跑生成，否则产物里带的仍是旧代码。
    🔴 而**这一刀第一次修错了对象**：写成 `request.onversionchange = …`（挂在 `IDBOpenDBRequest` 上）。
    `versionchange` 由 `IDBDatabase` 派发，open 请求上根本没有这个属性 ⇒ 运行时**永不触发**，
    也就是说"修复"是个假动作，而上面那枚静态腿照样绿（它数的是 `.onversionchange =` 这个**文本**）。
    抓到它的是 `pnpm --filter @heyta/web typecheck` 的 `TS2339`。
    📌 **三层腿各挡各的，缺一层就漏一个形状**：行为腿挡"这一处"、枚举腿挡"这一类"、
    **类型检查挡"挂在错误的对象上"** —— 后一层尤其要紧，因为 vitest 只转译不做类型检查，
    而 service worker 源码不被任何用例 import，所以"跑测试"这条最常被依赖的通道**对它完全无感**。
    ⇒ 凡是"只被运行时环境（SW / 原生桥 / worker）消费、不进任何用例 import 图"的产品文件，
    它的成立证据必须是 **typecheck + 产物对账**，不能是"测试绿"。

299. 🔴 **工单里那句"病因"往往是按现象写的推断 —— 照着它改会改一件不存在的东西，而且改完照红。**

    登记（16:36 的我）：「`docs-link-check.mjs` 的章节集合**按 `## ` 取号** ⇒ 三级小节整段不可见」。
    证据看起来很强：缺失的号段 `10.119–10.128` 现量**确实全是 `###`**，而 `## 10.116` 那些都在册。

    开工第一步读源码（`research/tools/docs-link-check.mjs:421`）当场否证：
    正则本来就是 `/^#{2,6}\s+(\d+(?:\.\d+)*)[.、\s]+(.*)$/` —— **`#{2,6}` 一直吃 `###`**。
    真正的拦点是那个 `[.、\s]+`：那十个小节写成 `### 10.119（10-05 03:2x）…`，
    **编号后面直接跟全角括号、一个空格都没有** ⇒ 要求"至少一个分隔符"的那一段匹配失败。
    同一篇里 `## 10.116 …` 被认到，不是因为它层级对，是因为它**写了空格**。

    现量对照（同一条解析只换正则）：`10.11x–10.12x` 被认到的枚数 **10 → 20**，
    补进的恰好是那十枚 `###`。⇒ 相关不是因果：**"缺的那批都是三级"与"缺"之间没有因果关系**，
    它只是同一批文本的另一个属性。把共现抄成因果，这条工单就带着下游去改一个不存在的东西。

    ✅ 两条一起才收得住：
    ① 修因（分隔符可以为空，但**只有紧跟 `(`/`（` 时**允许 —— 不写成"编号后面什么都行"，
      否则 `## 2026-09-30：…` 这种日期开头的标题会被登记成章节 `2026`，
      那是把门禁调松、让 `§2026` 这类错引用从红变绿）；
    ② **正反一对自检腿**钉在检查器自己的自检节里（正：`10.119（…）` 必须解析出号；
      反：日期标题必须**不产号**）。变异只把放宽那截退回旧式 ⇒ 自检当场 `自检失败=True`；
      改后 `False`、`该章节号不存在` 命中 0 条 —— 这条修复是承重的，由这一趟回答，不由"看着对"回答。

    📌 **可迁移**：读工单/陷阱里那句"原因是 X"时，第一步是**去源码里找 X 在不在**，
    而不是按 X 动手。凡"某一类全都缺失"的现象，先问它是不是**另一个属性**的共现
    （层级 / 大小写 / 全半角 / 有没有空格）。同族：#86（一条判据里藏两个缺陷）、#163（先 `NO_COLOR` 再数失败）、
    #296（"没跑"长得像"零失败"）。

298. 🔴 **界面文案门禁只比词条表，比不到"运行时生成的那一段" —— 裸
    `toLocaleString()` 因此在中文界面里排出了英文习惯的日期，四层全绿。**

    2026-10-05 实测：`apps/web` 的续费面板用 `new Date(x).toLocaleString()` 排
    订单失效时刻。真浏览器截图（`apps/web/evidence/renew-panel-order.png`）里印的是
    `10/5/2026, 5:47:10 PM` —— 中文界面 + 英文日期规则。成因不是"翻译漏了"，是
    **裸调用跟的是运行时/浏览器的 locale**（Playwright 的 `Desktop Chrome` 默认 en-US），
    而界面的语言在 `useI18n()` 里，两者从来没接上。

    四层为什么都没拦住：① `check:ui-language` 的判据是"界面里的文案必须来自词条表"，
    这一串是 `Date` 生成的，**结构上不在它的射程里**；② 同一个 spec 里那条「两种语言」
    用例，中文那一支只断言"文本里**有**中文"，日期是英文照样绿；③ typecheck /
    `check:design` 与运行时字符串无关；④ 只有把那张图**打开来看**才看得见
    （§6.2 规定一存在的理由本身）。

    ✅ 修法：`toLocaleString(locale, {...})`，locale 由界面传进来 ——
    仓库里 `TrashView` / `ConflictDialog` / `ReminderPanel` 三处早就是这个写法并各留了
    一句理由，**这一处是漏抄了那条既有约定**（不是需要新发明规则）。

    📌 **判据的写法比判据的存在更要紧**：补的那条用例**不能**写成
    "渲染出的串等于 `toLocaleString('zh-CN', …)`" —— 把系统语言设成中文的机器上，
    **有 bug 的实现照样满足它**。要钉的是"界面语言被**传进去**了"这个动作
    （spy 断言 `Date.prototype.toLocaleString` 每次调用都收到该 locale），
    外加一条"同一时刻在两种语言下排出不同的串"的行为对照。
    ⇒ 凡是"跟着宿主环境漂"的值（locale、时区、系统强调色、`Intl` 的默认宽度），
    判据必须钉**传参动作**或**两侧差异**，不能钉**一个具体排法**。

300. 🔴 **`vi.mock` 没拦到组件那条相对导入，判据就全绿在替空树打分 —— 而且"负向腿"在这种状态下**必然**通过。**

    批次 E 的 #73（Web 注销面板报"本机还有几条没出去"）里，测试替身挂在
    `vi.mock('../src/lib/oplog.js', …)`（从**用例**的角度写路径），而被测组件
    `CloseAccountPanel` 用的是 `../../lib/oplog.js`（从**组件**的角度写同一个文件）。
    跑出来 `opStub.reads` **恒 0**：组件拿到的是**未替换的** `hasEngine()`，jsdom 里返回 false，
    于是"读不到"分支自己成立 —— 三条腿里"0 条不出现""读不到不出现"这**两条负向腿全部通过**，
    只有正向腿红。也就是说：**如果我不加"面板真去读数了"这条前提腿，这一格会被记成
    "两条负向判据已成立 + 一条正向待修"，而那两条其实什么都没证。**

    排除过的两支（都实测过，别重复走）：
    · 登录态/挂载不对 ⇒ `find('[data-testid="close-account-panel"]')` 非 null，排除；
    · React 18 并发根里 passive effect 还没 flush ⇒ 加 `await act(async () => setTimeout(0))` 宏任务后仍 0，排除。

    ✅ 两条纪律：**① 用 stub 测"组件读了一个共享模块的出口"时，探针缝要用这个文件里**已被验证过**的注入机制**
    （本仓的用例靠 `vi.stubGlobal('fetch', …)` 和 `window.__heytaHostStoragePort` 那一类显式端口跑通；
    模块路径 mock 在不同目录层级下写路径极易错开），
    或者干脆把这条读数做成 store/宿主端口的一项，而不是让 UI 直连引擎模块；
    **② 凡是"缺失就不出现"这一类负向腿，必须配一条"探针真被走到"的前提腿**
    （计数器 / `reads` / `calls`），否则"没渲染"和"正确地没渲染"在断言里长得一模一样。
    同族：#46、#191、#296（"没跑"印成"零失败"）、#176（桩在用例走到被测判据之前就返回）。

301. 🔴 **一份被多个消费者重放的契约，表达工具也只能取交集 —— "在最方便的那个消费者那里绿"不是通过。**

    `packages/storage/tests/contract/adapter.contract.ts` 是**一份契约、四个消费者**：
    vitest 跑 Memory / IndexedDB / SqliteAdapter 三套实现，
    `research/spikes/sqlite-driver-csharp`（C# 同步驱动 + Jint 重放器）跑的是**同一个文件原样**。
    批次 E2 里"销毁即死路"那一腿我写成 `expect(…).rejects.toBeInstanceOf(AdapterDestroyedError)` ——
    vitest **全绿**，`pnpm -r test` 全绿，本地没有任何一层会响。
    红是在隔离载体里跑整条 `pnpm check` 时才出现的（§10.199）：
    `断言 67 条，通过 66 条，失败 1 条 … Property 'toBeInstanceOf' of object is not a function`，
    C# 侧以 134 退出。**新写的判据恰好落在唯一不会执行它的那条通道上。**

    两个错叠在一起才出事：
    ① 把 vitest 的 `expect` 当成契约的运行时，其实它只是四个消费者里能力最全的那个（替身只有
      `toBe` / `toEqual` / `toThrow`）；
    ② `instanceof` 在这里本来就是**错的表达** —— Jint 里那个类不是宿主 realm 的同一个类对象，
      跨 realm 的 `instanceof` 会假负，即使替身支持这个匹配子也一样。

    ✅ 修法：只取交集，并把身份写成可跨 realm 的值 ——
    取 `error.name` 与 `AdapterDestroyedError.name` 比（`toBe`），
    而不是拿对象比身份。注释里写清"哪些消费者在跑这一份"，否则下一位还会再犯。

    📌 可迁移：**契约文件顶上的"消费者清单"不是文档，是能力约束的出处**。
    凡新增/改动被多个宿主或重放器共享的断言集，落码前先问"这枚匹配子每个消费者都有吗"；
    答不出来就把"每个消费者都跑过这一份"做成一条门禁（这里是 `check:crosslang-contract`，
    它已在 `pnpm check` 第 34/86 段 —— 也就是说**门禁本来存在，只是我本地没跑到那一段**：
    单包 `pnpm -r test` 绿 ≠ 整链绿，见 §7 元规则 3 与 #296 的同族）。
    同族：#195（默认值等于原值的可选 prop 把"宿主没接"伪装成"做完了"）、
    #174（只哈希两三个文件的对账证明的就是那两个文件）、
    #296（`-t` 没命中也 exit 0）。

302. 🔴 **前提门要按"哪几段真的需要它"分道，不许整趟共用 —— 过宽的门把不相关的段一起挡成"没读数"。**

    批次 E 的补跑装置（`research/tools/mutation-rigs/e2-remaining-gates.sh`）第一版把
    **负载 + 端口 5173/3000 + 同侪**三门套在全部十段上。其中八段壳类门禁
    （`check:macos-shell` / `check:macos-window` / `check:windows-shell` / `check:linux-shell` /
    `check:shell-surfaces` / `check:shell-unicode` / `check:shell-exit-chain` /
    `check:shell-erasure-parity`）**根本不碰那两枚端口**，唯一会 SIGKILL 端口进程的是两枚 e2e 前置。
    结果 19:42–19:46 那三分钟里，别人占着的 :3000 把八格**已有窗口可跑**的读数一起挡死，
    而装置输出的形状是"继续等"——完全看不出被挡的是不相干的前提。
    分道后同一分钟八段就拿到了第一次读数（7 绿 1 红，§10.201）。

    同族错在同一个文件里连着出现：
    ② `local -n LANE=$1` 在 `/bin/bash 3.2.57` **不支持**（nameref 是 4.3+），而
      **`bash -n` 照样过**（3.2 的 `-n` 只查语法、不查运行时是否认这个选项）。
      真跑会当场失败，且失败长得像"门禁红"。
    ③ 我对**正在跑的**排队器改了它自己那份文件（bash 增量读文件；traps 里已有多条同件事）。

    ✅ 三条合起来的写法：**每道前提只声明在它真正约束的那一段上**；
    装置的语法过 ≠ 它能跑 ⇒ 关键分支要在目标解释器版本下**真跑一次**（这里改成立刻起真脚本，
    让八段读数本身充当证明）；改在跑的脚本 = 先按 pid 证明是自己的、停、改、再重起、数条数确认一台。

    📌 可迁移：**"装置在等"和"装置没有读数"是两句不同的话**。
    如果等待的原因与大部分段无关，那一句"在等"就把它们全部伪装成前者。
    排产判据要能回答"这一段现在就能跑吗"，而不是"整趟到点了吗"。
    同族：#296（`-t` 没命中也 exit 0）、#297（判据只覆盖它走的那条路）、
    §7 元规则 2（一条永远通过的判据比没有判据更糟；这里反面：一条永远在等的门比没有门更误导）。

303. 🔴 **变异跑完别用 `git checkout --` 还原未提交的修复 —— HEAD 不是你的基线，那一下会把修复一起退掉。**

    批次 E3 的 #73（Web 注销面板的现量条数）取两刀变异读数的收尾动作是"还原原文件"，
    我写的是 `git checkout -- apps/web/src/features/settings/CloseAccountPanel.tsx`。
    该文件**本轮改动从未提交**（目标明确要求"不提交，等用户明示"）⇒
    `git checkout --` 回到的是 HEAD 那一版（**没有我的修复**），不是变异前的那一版。
    结果修复被连带清除，而命令本身退出 0、没有任何警告。

    抓到它靠的是一件该在**动手之前**就有的东西：变异前我取过 `BASE=$(md5 -q $P)`，
    还原后复量 `NOW_MD5` 与它不等 ⇒ 当场发现，重放后逐字相同、复跑 19 passed。
    所以这条不是"运气好"，是**取证动作的位置**问题：md5 取在变异前才有资格当还原判据。

    ✅ 三种正确形状（按优先级）：
    ① 变异前 `cp $P "$EV/$(basename $P).orig"`，还原用 `cp` 回去并**比 md5**；
    ② 用 `git stash create` 那种自包含对象把"当前未提交状态"钉成一枚 SHA 再回；
    ③ 只在"文件本来就在 HEAD 里、且 HEAD 就是我的基线"时才用 `git checkout --`（先确认这两点）。

    📌 可迁移：**"还原到基线"里的基线是你这一格的起点，不是仓库的 HEAD。**
    在未提交的工作里，HEAD 是别人的状态。与 §10.195（我的切片还原吞掉了相邻一行）、
    traps #296/#297（探针故障被读成产品结论）同族 —— 都是**收尾动作把修复弄丢**那一类，
    区别只在于这次是"退回 HEAD"这个看起来最安全的命令。

304. 🔴 **装置的五种状态必须各印各的：「没跑」「跳过」「跑不了」「跑了但红」「跑了且绿」—— 我把前两种映射成了"没有读数"，两次。**

    `research/tools/mutation-rigs/e2-remaining-gates.sh` 这一轮连着出两种映射错（计划 §10.207）：

    1. **调了个不存在的函数 ⇒ 印出两句权威的 `EXPIRED`**。
       我用 python 做"整块替换"把 `wait_e2e` 换成 `wait_gate`，**没匹配上也照样打印 `patched`**
       （替换后没断言新符号存在）。于是脚本里 `wait_e2e` 的定义还在、`wait_gate` 没人定义，
       `if wait_gate landing …` 当场 `command not found` 走 `else`，
       `rc.txt` 落下 `LANE_LANDING=EXPIRED` / `LANE_AI=EXPIRED` —— 读起来完全像"前提没成立所以没读数"，
       真相是**装置自己坏了**。更糟的是 `nohup … >/dev/null 2>&1` 把那句
       `command not found` 吞了，全仓只有时间戳留下来：从起跑到的 DONE **只用了 8 秒**，
       而任何一次真等待至少 40 秒 —— 这是唯一的线索，而我差点没看。
    2. **`SKIP_LOAD=1` 主动跳过 ⇒ 落进同一个 `else`，被印成 `LANE_LOAD=EXPIRED`**
       （"这一道没有读数"），而那道其实**上一轮已经闭合**（八枚 rc=0）。
       主动跳过与"量不出来"在账上是两回事：前者不需要补跑，后者必须补。

    3. **别人的 rig 把"环境不许我跑"与"我跑出来红了"合并成同一句话**（10-05 21:23，计划 §10.213）。
       `scripts/mutate-op-log-semantics.mjs` 只检查子进程有没有写出 `result.json`，没有就抛
       `Error: <label>: missing assertion report` 并退 1 —— 而仓库的内存闸门（`/tmp/tfa-test.lock`）
       拒启动时**走的也是这一条**：整链 `pnpm check` 第 9 段当场短路，日志里同时印着
       「内存闸门拒绝启动 pid=78326」和那句像产品结论的 Error。
       ⇒ 读的人（和 `&&` 链）分不出「跑不了」与「跑了但红」，后面 77 段还没有读数。
       我的装置侧已按上面①②补了 `env_refusal=YES` 检测 + 重排队 + `NO_CLEAN_RUN`；
       **那条线自己的 rig 只登记不代改**（判据口径不代改），记在计划 #108。

    ✅ 修法三条，都落进了装置本体：
    ① **起跑前自证**：`for fn in …; do typeset -f "$fn" >/dev/null || { say "RIG_BROKEN …"; exit 4; }; done`
      —— 函数/依赖/路径缺任何一件就响亮退出，**绝不往下印任何像读数的东西**；
    ② **每个分支只有一个终态**：`SKIPPED` / `EXPIRED` / `OPEN` 各自独立成支，
      别把"我选择不做"接进"我做了但没结果"那条 `else`；
    ③ **后台任务的 stderr 落文件，不丢 /dev/null**；
      并且给一趟等待留一条**时间下限**判据（这次等没等到，看用了多少秒就知道）。

    📌 可迁移：**改动脚本的"替换成功"不能由替换工具自己宣布**（python 的 `str.replace` 不报错 ≠ 匹配上了）：
    要么断言新符号在文件里存在，要么跑一次函数/变量存在性自检。
    与 #296/#297/#301/#302 同族：**装置的失败模式必须比它保护的判据更响**，
    否则"装置坏了"这件事只会以"某一格一直没读数"的形式出现在账上。

305. 🔴 **一个用例里连跑两档结局、共用同一个会被"销毁"的实例 ⇒ 第二档读到的是已销毁实例。**
    症状看起来像产品坏了（`AdapterDestroyedError` 从 `SqliteAdapter.ensureOpen` 抛出），
    真相是**夹具形状错**，而产品行为正是设计要的（"销毁即死路"）。10-05 21:33 实测（计划 §10.216）。

    `apps/node-host/tests/cli-account.spec.ts` 那条"四种结局里只有一种能声称本机已清"在**同一个 `it`** 里
    先跑注销成功那一档（真的把那份临时 SQLite 销毁），再跑服务端 500 那一档 —— 第二档的命令要读
    `exportDocument()`，读到的是**已销毁的适配器**，当场抛。整链 `pnpm -r test` 因此红。

    判"是夹具还是产品"靠的是**顺序现量**，不是印象：`cli-account.ts:99-101` 里
    `pendingUploadCount()` 与 `exportDocument()` 都排在 `closeAccountAndEraseLocal()` **之前**，
    命令内部销毁之后不再碰适配器，而 CLI 一条命令一个进程 ⇒ 生产路径不存在这条复用。

    ✅ 修法只动形状不动判据：每档自己一个宿主（`beforeEach` 本来就给每个用例独立临时目录 + 独立销毁器注册），
    四条原话逐字保留，**再加一条**：成功那一档之后 `exportDocument()` 必须
    `rejects.toBeInstanceOf(AdapterDestroyedError)` —— 把"这次为什么红"钉成判据，
    谁以后把销毁改成静默重建，这条就红。

    📌 可迁移：**用例的隔离边界要画在"会不会 irreversible 地改掉共享状态"上，不是画在"读起来方便"上。**
    与 #297（销毁器被同一应用的活连接挡住）同族，但那是产品侧，这条是**测试侧**：
    同族的另一半教训是 —— 这种红**不要**用"让 destroy 变得不那么严"来消，
    那等于把 E2 整条产品语义（销毁后的实例拒绝再用，而不是把刚删的容器重建成空壳）删掉。
