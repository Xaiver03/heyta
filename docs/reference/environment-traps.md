# 环境陷阱（实测踩过，会复现）
> 状态：**长期参考**（`AGENTS.md` §7 的正文在这里；本文件是唯一全文，**编号只增不改**）。
>
> 引用方式：正文里写「§7 #N」或「环境陷阱 #N」；每条都是**实测踩过、且会复现**的，
> 不是理论风险。新条目追加到文件末尾，编号连续递增。

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

44. 🔴 **iOS 模拟器上目前没有可用的滚动办法 —— 于是 iOS 验收只能覆盖首屏。**

    三条路都实测过，全部不可用：

    | 调用 | 结果 |
    |---|---|
    | `idb ui swipe X1 Y1 X2 Y2 --duration 800` | **会滚，但 60 秒不返回（rc=124），内容只挪 30px**（行程 600px）。不传 `--duration` 能返回，但一点都不滚。 |
    | `idb ui scroll down`（不带目标） | 先做坐标探针，报 `the point is empty` / `found no element`，然后**什么都不做**；退出码还可能是 1。 |
    | `idb ui scroll down <坐标\|标记>` | 落在空白 View 上报 `the point is empty`；落在 `TextInput` 上报 `element had moved by the time the write reached it`。都不滚。 |

    另外 **`idb ui set-value` 对滚出屏幕的元素不生效，而且不报错**：
    元素在 y=1357（屏高 874）时 `--set` 返回 `{"detail":"<placeholder>"}` ——
    回读是占位符，即写入没发生。**回读是唯一能发现这件事的判据。**

    需要滚动才能到达的元素，去 Android 侧验，或者把它挪进首屏。

    ⚠️ 我**一度"测出" `idb ui scroll` 有效**（「清单名称」的 y 862 → 542），
    并据此写了一段"它是走 AXScrollAction、方向与手势相反"的解释。
    后来复测发现：**不带目标时它纹丝不动**，那次位移的真正来源是
    之前被 `timeout` 杀掉的 `ui swipe` 在 companion 侧继续跑完了。
    → 先有机制猜想、再去找证据，就会把巧合读成因果（第 38 条同族）。
    **怀疑和解释都要能重复：换个初态再测一次，它就不成立了。**

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
