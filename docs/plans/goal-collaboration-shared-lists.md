# Goal：共享清单（多人协作）—— 试实施（W0 + W1）

> 状态：🟡 **本地成笔（2026-10-11），全链门禁被两枚别线绊线挡着、push 押在跨线协调** —— W0+W1 ✅ / W2 服务端核心 ✅ / W3 纯层+格式统一 ✅ / 法务 ✅ / W4 已接线、W6 已落地、journey 全绿且链接落点断言已补（`RESULT=OK steps=3`）/ **④ 门禁：`pnpm -r typecheck` 全仓绿 + 本线两枚红（`check:layering`、`check:ui-language`）当场修绿；no-bail 全量 test 已做对数审计（21 枚有 test 脚本 / 摘 sync-server 后 20 枚跑 / 20 枚打 `Tests` 汇总，收得平），本线自己那枚下游红（landing `mockup-shell-shape` #7，因 a923f7fa 给页头加了 `share-open-button`）本会话当场修绿销账；整链仍红在三枚别线判断绊线**（`packages/ai`「分母 9→10」= 给 COMMENT 配不配 AI 工具的产品判断；`shared-schema` `AUTH_PASSWORD_PATHS` 9→12 = auth 线口径；`domain subscription.spec` 权益拒绝理由契约 = 计费线，**都不代改**）+ 一枚已知载体抖动（`mobile` 958/958 全过、非零退只在一条 Rolldown `RTEST-UNHANDLED-01`）/ **⑤ 文档写回已做**（benchmark §2.6 的 6.1+6.7、matrix §6、AGENTS §9、P2-10，均带边界如实登记）/ **⑥ 本线已本地提交（见交接·三），push 未独做**（本地 main 领先 origin 的笔多为别线未公开，`git push` 会一起公开）/ 两个 B 类停止点待产品负责人裁决。逐项读数与执行序见文末「2026-10-11 交接·三」；每步现量——共享检出在动。DoD 全清单见 [collaboration-shared-lists.md](collaboration-shared-lists.md) §7。
> 权威计划：[collaboration-shared-lists.md](collaboration-shared-lists.md)（W0–W6 全量分期、判据、验证矩阵、边界登记）
> 决策：[ADR-0062](../adr/0062-shared-list-key-distribution.md)（密钥分发型协作；聚合型红线不动）
> 证据层：[共享清单调研](../research/collaboration-shared-lists.md)

## Goal 原文（产品负责人，2026-10-08，逐条照录）

> 1. 「看一下这个项目怎么做协作功能，先做搜索和调研」（附滴答清单「设置 → 共享协作」页截图）
> 2. 「我发你的是滴答清单的，你还是可以找一下」
> 3. 「你可以给一下建议吗？从用户体验的视角出发」
> 4. 「可以的，然后制定一个完整的计划吧」
> 5. **「启用 goal 开始试试吧实施 可以把 goal 原文贴给我」**

第 5 条 = 本 goal 的授权：**试实施从 W0 开始**；范围以第 4 条认可的计划为准。

## 本轮范围（以用户要求与原计划为准）

| 阶段 | 内容 | 在本轮？ |
|---|---|---|
| W0 | 三处勘误 + `dida-ai-assistant-gap-analysis` 指针；`@noble/curves` + `@noble/hashes` 两道依赖门；ADR-0062（已立） | ✅ |
| W1 | 密钥协议纯函数层（`packages/sync-core` 新增文件）：身份密钥对 / listKey 派生 / 成员信封 seal+open / rekey / 历史重加密批处理 + vitest 判据与变异臂 | ✅ |
| W2–W6 | 服务端表与端点 / 领域层 / 客户端 UI / 通知 / 链接 | ⏸ 另启 |

按 AGENTS §8 第 7 条：完成范围按「设计 / 生产接线 / 失败与恢复 / 平台验收 / 当前产物」分别记证据；**W1 的纯函数与单测不等于 W2 的生产接线**，两者分开记账。

## 判据（照计划 §3 W0/W1，此处只列验收口径）

- W0：`check:adr-numbering` 绿；`check:docs` 本 goal 触碰文件无死链；三处勘误各带指向 ADR-0062 的指针且**不改原文结论**；依赖门两包都有 `ghinfo` 读数（活跃 + MIT）。
- W1：信封只有目标成员私钥可解（变异：换接收者 ⇒ 解封失败）；listKey 派生按 purpose+epoch 域分离；rekey 后旧 listKey 读不了新世代 op；历史重加密**重用同一密文形状**、幂等可续传（变异：随机 nonce 两跑不同 ⇒ 红）；固定 seed 可复现；journal/中间产物不含 root key、口令、恢复码或明文 listKey。
- 收尾：`pnpm -r --filter '@heyta/sync-core' typecheck && test` 绿；本文件与计划状态行同步推进。

## 完成事实（逐条回填）

| 步 | 判据 | 结果 |
|---|---|---|
| W0-1 | 三处勘误 + 指针 | ✅ `ui-review-fill-zh-timeline.md`（共享日历/协作条目后加勘误：聚合型仍不可做、分发型可做）、`countdown-anniversary.md`（排除不变、理由收窄）、`dida-ai-assistant-gap-analysis.md`（评论/指派可做，指向计划 W3/W4）；均不改原文结论、只加 2026-10-08 勘误指针 |
| W0-2 | 依赖门（ghinfo × 2 + MIT 登记） | ✅ `paulmillr/noble-curves`：last commit 2026-09-08、release 2.4.0 @ 2026-08-27、MIT、未归档、audited；`paulmillr/noble-hashes`：last commit 2026-09-08、release 2.4.0、MIT（已是 sync-core 现有依赖）。**另发现 `packages/inbound-core` 已在用 `@noble/curves@2.4.0`（精确 pin）**——本包与其同版同 pin。`license-inventory` 全量跑 =「全部宽松许可 ✅」 |
| W1-1 | `share-keys` 纯函数模块 + 测试 | ✅ `packages/sync-core/src/share-keys.ts`（新文件，未触碰既有导出）：身份密钥对（Ed25519+X25519 从一枚种子 HKDF 域分离）、操作密钥（listKey×shareId×epoch）、成员信封（**ECIES 临时 X25519**，AAD 绑 shareId+epoch+接收者+临时钥指纹）、`planShareRekey`、`encrypt/decrypt/reencryptShareRecord`（**确定性 IV ⇒ 幂等重加密**，AGENTS 规则 16）、op 签名三件套；`index.ts` 增导出；15 条测试 |
| W1-2 | 变异臂登记（每条判据能红） | ✅ M1 信封 AAD 去掉 shareId/epoch 绑定 ⇒ **恰好 2 红**（重放绑定 + rekey 旧信封重放）；M2 重加密 IV 改随机 ⇒ **恰好 1 红**（幂等）；M3 操作密钥忽略 epoch ⇒ **恰好 1 红**（域分离；「旧钥匙拒读」在变异下仍正确拒绝 = fail-closed）。三臂跑完源码还原、复跑全绿 |
| W1-3 | sync-core typecheck + test 绿 | ✅ `tsc --noEmit` rc=0；**20 文件 / 318 passed**（含新 15 条）；tsup 构建 rc=0（陷阱 #162：vitest 绿 ≠ dts 绿，已单独跑） |

## 过程事故（如实记，不包装）

- `pnpm --filter @heyta/sync-core add @noble/curves` 在共享工作树上**挂起 23 分钟**（0% CPU / 累计 8s CPU，registry 实测可达，根因未定——疑 store 锁或并行会话的 lockfile 半更新），已终止改走「手工改 package.json（精确 pin 2.4.0）+ `pnpm install --filter @heyta/sync-core... --prefer-offline`」，秒级完成。期间发现 lockfile 里 +61 行是**并行会话**注册 `packages/inbound-core` 的导入项（非本次改动产生，未被本次提交覆盖）。
- 初版 `openListKeyEnvelope` 的 DH 方向写错（`recipientSecret × 自己公钥`），动手实现时当场发现并改为标准 ECIES（临时密钥对进信封）——单测未落地前被自查抓住，未进过任何绿读数。

## W2 完成事实（2026-10-08，Goal 模式第一段：服务端核心）

| 步 | 判据 | 结果 |
|---|---|---|
| W2-1 | 四张表迁移 + 数据库层不变量证据 | ✅ `20261018120000_add_share_collaboration_tables`（纯 CREATE TABLE + 6 条手写 CHECK：role 词表 / 双 epoch≥1 / token 散列形状 / 接受全有或全无 / 移除时间因果序）；`check:migrations` =「65 个迁移全部合规 ✅」；PGlite 跑**发布中的迁移 SQL** 8 条判据全绿（每条非法都配合法对照行，照 activity-schema 先例） |
| W2-2 | role 硬门路由级测试（401 遍历 + 逐 op 裁决） | ✅ `share-routes.spec.ts` 23 条：**14 条新端点无头 401 逐一遍历**；非成员 404（存在性不外泄）；viewer/commenter 写被拒 `SHARE_ROLE_FORBIDDEN`；editor 写 REMINDER 被拒 `SHARE_ENTITY_TYPE_NOT_SHAREABLE`；未知实体 `INVALID_ENTITY_TYPE`；混合批次各走各的；邀请全生命周期（一次性 token 只出现一次、吊销 410、过期 410、未知 404、29 人上限 403、已成员 409）；owner 专属（移除/退出/改 owner 角色 → 400）；信封下发推进 share.keyEpoch；列表白名单投影（tokenHash 不出响应） |
| W2-3 | 变异臂 | ✅ 拿掉 `decideShareOpWrite` 的 role 判定 ⇒ **恰好 2 红**（viewer、commenter 两条；实体类型判据不受影响 = 刀口对准）；还原复绿 31/31。⚠️ 第一次变异运行被**内存闸门**拒启（立即可用 110MB < 384MB），那次 rc=1 **不是判据红、读数无效**——等内存回落后重做才取到有效读数 |
| W2-4 | 端点族 + entitlement + WS 信号 | ✅ `src/shares/share.routes.ts`（14 端点：创建/列表/详情/邀请×3/接受/成员×4/离开/上传/下载）；`share.membership.ts` 纯裁决；上传=块状发号（`lastServerSeq` 原子 increment）+ 逐 op 两段校验；`notifyShareOps` 只广播 `{type:'new_share_ops', shareId, latestSeq}`（无内容，安全契约延续）；entitlement 闸门挂创建+邀请两端。server.ts 注册与并行会话的 inbound 注册**不同 hunk 干净共存** |
| W2-5 | 类型与邻居 | ✅ `tsc --noEmit` **0 errors**（prisma generate 后）；金丝雀 `activity-routes` + `activity-schema.pglite` **40 passed**（shared-schema 重建未伤邻居） |

### W2 当场踩到并修掉的坑（都进了代码注释）

1. **zod 双实例**：跨包 schema（`@heyta/shared-schema`）只能**调方法**（`safeParse`），不能用自己的 zod 组合它（`z.array(他们的schema)`）——运行时炸 `Cannot read properties of undefined (reading '_zod')` 500。
2. `SuperSyncUploadOperationSchema` 原是模块私有 `const`，server 无法导入 ⇒ **additive 加 export**（`supersync-http-contract.ts` + `index.ts` 两行 + 重建 dist）；落针位置与并行会话的改动不同 hunk。
3. server 消费的是 shared-schema 的 **dist**：src 加导出后必须重建，否则运行时 `undefined`。

### W2 的两处计划偏差（已登记，待产品负责人追认）

- **entitlement 未加 `'sharing'` 词**（计划 §2.6 原文说加）：该词表**四处同源**（定价文档 / `check-pricing-consistency` / schema 注释 / 迁移 CHECK），加一个没有 grant 映射的词 = 为零行为跑一次 CHECK 迁移 + 养第二处真值；D7 的规则「owner 的 hosting 有效即可共享」用既有 `hosting` 精确表达，闸门就挂 `createEntitlementGuard()`（默认 hosting）。将来共享独立计价时再加词，成本不变。
- **B-6 细化**：邀请接受时成员**自带**封装公钥入群（`ShareMember.identityPublicKey`），owner 在线后封信封——「预授权信封」需要按邮箱查公钥的 IdentityKey 目录，W2 没建该目录（也更符合「不做全局身份目录」的纪律）；代价是新成员要等 owner 在线拿信封，客户端如实显示「等待所有者授权」。

## W2 余项：法务第一批（2026-10-08 第二段）

| 项 | 结果 |
|---|---|
| `third-parties.ts` 共享分类 + 升版 | ✅ **v1.3 → v1.4**（中英同步）：s1「四种身份」扩成「五种」（新增「你与其他用户共享」行 + 标题/引言成对改）；新增 **s4b 节**「你与其他用户的共享」——披露内容/元数据/不受影响三行表、单独同意（按 PIPL 23 最严口径，开启前一次明示确认并记录）、撤回边界（移除即换钥匙重加密 + 「无法远程擦除对方本地副本」照实写，与 privacy「其它设备」同一条边界）、注销级联、「共享不改变我们能算的」（激励红线呼应）。**四道门禁绿**：closure-truth（指纹见 `third-parties@1.4`）、gdpr、permissions、backup-retention；`gen-site-copy` 已再生，`--check` 绿 |
| PIPL 23 评估 | ✅ 结论：**按最严口径需要单独同意**。法理：向其他用户披露不是 21 条委托处理（成员不是受托人）；按 23 条「向其他处理者提供」的最严解释处理（成员持有副本后自主决定用途）。落点 = D11 共享前隐私预览升级为**明示确认并留痕**（已写进 third-parties s4b 的承诺）。🔴 **界面形态是 Goal 停止点**：候选 (a) 首次创建共享时模态确认 + 「不再提示」勾选（推荐）；(b) 每次共享都确认（过重）。W4 立共享界面时必须停下来问产品负责人 |
| `privacy.ts` 承诺句改写 + 元数据清单 + `data-rights.ts` 注销边界 + `personal-info-list.ts` | ⏸ **登记推迟（撞车面）**：四个文件正被并行会话改写（他们的法务 1.7→1.8：自动化元数据 + 注册挑战，中英已过 closure 门禁）。**合流配方已探明**：`structure.spec.ts` 有 2 红是这次对账机器在正确工作——真源级联清单里多了 `shares / share_members / share_invitations`（+他们待落齐的 automation 表），需要 privacy 级联段落把 share 四张表数进去、`N 处级联 / N 张表`按 spec 推导现量改写（数字以 spec 失败输出的 expected 为准）、`CATEGORY_NAMES` 加「共享关系」类目——**这两个文件解封后按此配方收口**，中英同步 + privacy 自身版本再升 |
| `legalSetVersion` | ⏳ 随上面 privacy 侧收口一起升（third-parties@1.4 已自动进指纹；单独再动 index.ts 无意义——版本指纹是全部文档拼起来的） |
| app-host share-client | ⏸ **继续推迟**：现量 33 个文件被并行会话占用 |

### 本段踩坑

- TS 单引号字符串里的撇号（`template's`）漏转义 ⇒ esbuild `Expected "}" but found "s"` 构建红——转义后即绿。
- **法务门禁扫的是 dist 产物**（closure-truth 读 `packages/legal/dist`）：改完源必须 `pnpm --filter @heyta/legal build`，否则门禁读的是旧文本——又一处「改完不 build 不算数」（§7 #79 同族）。

## W3 现量（2026-10-08 第三段）：核心落点全被占，COMMENT 扩项已备好待落

**撞车面现量**：`domain/entities.ts`（+22 行）、`op-log/engine.ts`（+162 行）、`op-log/state.ts`（+84 行）、`app-host/src/*`（33+ 文件）全部正被并行会话改写；`shared-schema/entity-types.ts` 干净。

**已探明的 COMMENT 落地地图**（谁解封先落谁；每一步都验证过落点）：

| 序 | 文件 | 改动 | 状态 |
|---|---|---|---|
| 1 | `packages/shared-schema/src/entity-types.ts` | `ENTITY_TYPES` 加 `'COMMENT'`（注释已按 ASSISTANT_TURN 模板写好：一条评论=一个实体的 LWW 数组论证、只活在 share log、服务端先上线、AI 覆盖分母预警） | ⏸ 被 2/3 卡住：`op-log/state.ts` 的 `UNMODELED_ENTITY_TYPES` + `entity-coverage.spec` 把「每个 ENTITY_TYPE 必须登记为已建模/显式不建模」钉死——加值不登记 ⇒ coverage 门禁红；已试落并**回退**（字节恢复） |
| 2 | `packages/op-log/src/state.ts` | `UNMODELED_ENTITY_TYPES` 暂登记 COMMENT（理由：share 域专用，物化随 W3 接线实现后移除登记）；后续 COMMENT 桶进 `BUCKET_BY_ENTITY` | ⏸ 被占（+84 行） |
| 3 | `packages/domain/src/entities.ts` | `Comment` 接口（照 ASSISTANT_TURN 一条一实体）+ `Task.assigneeUserId?` + `Project.shareId?` + `EntityModelMap` 扩项 | ⏸ 被占（+22 行） |
| 4 | `server/src/shares/share.membership.ts` | ✅ **已落（休眠）**：`SHARE_WRITABLE_ENTITY_TYPES` 加 `'COMMENT'`（带 W3 注记）——`decideShareOpWrite` 先查 `ENTITY_TYPES`，COMMENT 进词表前该行不激活，路由测试行为零变化 | ✅ |
| 5 | `server/tests/share-routes.spec.ts` | 待补两用例：commenter 写 COMMENT 被接受（激活后）；viewer 写 COMMENT 被拒（role 门而非实体门） | ⏳ 随 1 落 |
| 6 | `packages/ui/src/sync/model.ts` + i18n 词条表 | `common.entity.COMMENT` 标签键 + 词条（表是"只许追加"的共享文件） | ⏳ 随 1 落（ui/model.ts 现量干净，但等 1 一起） |
| 7 | AI 覆盖分母 | COMMENT 进 `EntityModelMap` 那天 `check:ai-coverage` 分母 +1 ⇒ 先登记 `ENTITY_COVERAGE_DEBT` 台账或同批补评论读写工具（`check-ai-coverage.mjs` 本身也被占） | ⏳ 随 3 落 |
| 8 | share 引擎接线 + 写入路由 + 签名进线协议 | op-log engine（被占）/ sync-client client.ts（被占）/ app-host 路由（被占） | ⏸ 全被占 |

**本段有效产出**：落地地图 + membership 休眠行 + 现量记录。**没有产出假完成**：ENTITY_TYPES 试落后因 coverage 钉子在被占文件而回退，词表恢复字节相同——树里没有因为本轮新增的红。

## W3 纯函数切片（2026-10-08 第四段）：share op 载荷信封 ✅

撞车面复查：legal 四文件 / op-log state.ts+engine.ts / domain entities.ts 仍被占；`sync-client` 仅 `client.ts` 被占 ⇒ **新文件解封**。按指令落了 W3 里不被占的纯函数部分：

| 项 | 结果 |
|---|---|
| `packages/sync-client/src/share-payload-cipher.ts`（新文件） | ✅ `createSharePayloadCipher`：share op 载荷信封，与 vault codec 同构（magic `heyta-share-op/` + 版本字节 + **keyEpoch float64** 头 + GCM 体）；密钥域 = `deriveShareOperationKey(listKey, shareId, keyEpoch)`（W1 纯函数）；**AAD 绑整条 op 身份含 shareId**（vault 的 `identityAAD` 同一姿势——成员都持钥，无绑定则密文可改名重放）；`previous` 世列表承接 rekey 过渡期的旧世代下载页；`isSharePayloadTransportShape` 传输嗅探。index.ts 加一行导出（干净文件） |
| 测试 | ✅ `tests/share-payload-cipher.spec.ts` 7 条：roundtrip / 头部明文世代 / **AAD 绑定（改 id、改 entityType、改 timestamp、翻转密文字节全炸）** / 异钥异 share 不可读 / rekey 过渡（previous 可读旧世代、新 cipher 读不了新信封、缺 previous 报世代不可用）/ 配置 fail-closed（重复世代、钥长、shareId、epoch）/ 非 share 信封拒收 |
| 变异臂 | ✅ AAD 去掉 op 身份只绑 shareId ⇒ **恰好 1 红**（AAD binding 条）；还原复绿 |
| 回归 | ✅ sync-client 全量 **11 文件 / 146 passed**（含并行会话的 inbound-authorization，零破坏）；金丝雀 `payload-cipher.spec`（vault codec）14 条同绿；`tsc --noEmit` **0 错** |
| 边界如实记 | 本切片是**纯函数层**：W3 的引擎接线（下载页里调用它解密、写入路径调用它加密）仍等 op-log/sync-client client.ts/app-host 解封——单测绿 ≠ 生产接线 |

### 本段踩坑（都进了代码注释）

1. **`aesEncrypt` 返回不含 IV 的 ct+tag**——vault codec 不踩这个是因为它走 `encryptVaultRecord`（IV 打在 record 信封内部）。第一版信封漏写 IV，单测当场抓红（这是单测存在的意义）。
2. sync-core 的 `KEY_LENGTH` 不在导出面上 ⇒ import 得到 undefined ⇒ 长度校验恒真 throw——照 vault codec 先例用字面量 32 + 注释。
3. 测试自己的 `expect(await ...).rejects` 把 await 放错位置——rejection 直接炸测试。

## W3 纯函数切片（2026-10-08 第五段）：verify:collab-keys ✅

撞车面第三次现量：legal 四文件 / op-log state+engine / domain entities / app-host 33 文件 **全部仍被占**；根 `package.json` 也被占（`verify:collab-keys` 的一行接线**登记推迟**，脚本先以 `node scripts/verify-collab-keys.mjs` 独立运行）。

| 项 | 结果 |
|---|---|
| `scripts/verify-collab-keys.mjs`（新文件） | ✅ 密钥协议闭环五步，**零 mock**（真实 WebCrypto + sync-core **dist 构建产物**）：①信封只有目标成员可解（owner→alice/bob 各解出同钥，mallory 被拒）②旧世代可读 ③🔴 rekey 后旧 listKey 读不了新 op（且被移除者既无新信封、旧信封重放 epoch2 也被拒）④🔴 历史重加密**双实例逐字节一致 + 中断续传终态收敛 + 迁移后旧钥不可读**（AGENTS 规则 16 形状）⑤🔴 journal JSON 面密钥材料零命中 |
| 首跑 | ✅ `RESULT=OK steps=5`，退出码 0 |
| 变异臂 | ✅ 第一次变异打偏（改 rekey 引用了不存在的变量 ⇒ 脚本 crash——**crash ≠ 判据红，读数无效，如实登记**）；重做：`generateShareListKey` 退化成常量（模拟「rekey 实际没换钥」）⇒ **恰好 `RESULT=FAIL step=3 reason=rekey 后的新钥匙与旧钥匙相同——等于没换`**，其余步绿；还原重建后 `RESULT=OK` 复绿，sync-core 15 条测试无残留 |
| 边界如实记 | 脚本验收的是**密钥协议闭环**（计划 §4 第一行的判据形状）；它不等于「生产接线」——服务端信封下发（W2 已有端点）与客户端引擎调用（被占）之间的链路未验。package.json 接线待解封（一行） |

## W3 验收切片（2026-10-08 第六段）：verify:collab-sync ✅（九步真服务端闭环）

撞车面第四次现量：全仍被占（legal 四文件 / op-log / domain / app-host 33 / 根 package.json）。按指令落 `scripts/verify-collab-sync.mjs`（新文件）——**自带真实服务端**（形状照 `verify-p1-sync.mjs`：本地 PG `heyta_sync_smoke` + 迁移 + `server/dist` TEST_MODE 启动 + `/api/test/create-user` 真实 JWT），九步闭环：

**读数**：`RESULT=OK steps=9` 退出码 0。①双账号真实 JWT；②建共享+邀请（裸 token 一次性）；③bob 凭 token+封装公钥入群（editor）；④owner 封信封下发 → bob 从成员表取**自己的**信封解开 ⇒ 双方同钥；⑤双方并发上传（真实 share 信封载荷，服务端独立发号）；⑥🔴 收敛——owner 第二台设备与 bob 各自下载两条 op 并解密回原文（跨账号跨设备）；⑦🔴 直查 `share_operations` 库——标题明文零命中、信封 base64 前缀全命中；⑧🔴 移除传播——removedMemberships 出现该 share、被移除者上传/下载一律 404；⑨owner rekey epoch2 → share.keyEpoch 推进、新 op 上行、bob 仍在门外。

**变异臂**：拿掉 `requireShareMember` 的 `removedAt: null` 过滤 ⇒ **恰好 `RESULT=FAIL step=8 reason=被移除者上传应 404，实际 200`**；还原复绿 9 步。

**脚本逼出来的两个真发现（都已修）**：

1. **share 上传对重复 op id 只会 500**（应逐 op 拒 `DUPLICATE_OPERATION`）：op id 是全局主键，脚本第一版用静态 id 跨 run 撞库，服务端炸 500 而不是干净拒绝——个人路径有 request-deduplication，share 路由漏了。已修：上传前预检既有 id ⇒ 逐 op `DUPLICATE_OPERATION` 拒绝（不发号、不落库），配 2 条路由测试（重复拒绝 + 无重复不影响正常路径）。真实客户端 op id 是 UUID 不会撞，但"合法的重试"必须得到干净的协议答案而不是 500。
2. **成员没有"取信封"的通道**：GET /members 的白名单投影没带 `keyEnvelope`，bob 拿不到清单密钥——闭环设计当场暴露。已修：成员表投影带 keyEnvelope（它是封给那一行成员的密文、收方指纹绑进 AAD，发给任何人都解不开，无需额外端点）。

**还原事故（如实记）**：变异还原用了 `git checkout --`，它恢复到的是**暂存区**版本——share.routes.ts 今天既有已暂存改动（W2）又有未暂存改动（信封投影 + 重复预检），checkout 把后者一并抹掉，紧跟着的复跑在 step 4 红。已重放两处改动 + 重建 + 双绿收口。**变异还原一律用 cp 备份**（前几轮都做对了，这次付了一次代价）。

**边界如实记**：脚本里"设备"由真实密码学原语 + 原始 HTTP 驱动，站位待接线的客户端引擎（W3 主体）——它验证的是**服务端协议闭环**；引擎接线落地后本脚本应改走真实客户端 SDK，判据不变。

## W3 验收切片（2026-10-08 第七段）：verify:collab-revoke ✅（七步移除全链路）

撞车面第五次现量：全仍被占（app-host 涨到 35 文件）。按指令落 `scripts/verify-collab-revoke.mjs`（新文件，引导自包含照 collab-sync）。

**读数**：`RESULT=OK steps=7` 退出码 0。①双账号；②建共享→邀请→接受→信封（双方持 epoch1 钥）；③基线（bob/owner 各一条 op，bob 下载读回）；④🔴 移除 ⇒ 上传/下载一律 404；⑤owner 下载全部历史 → `reencryptShareRecord` 迁到 epoch2 → 迁移副本作为新 op 上行；⑥🔴 **历史对 bob 不可读的三面证据**——密码学面（迁移副本 bob 旧钥解不开、owner 新钥解得开，**含 bob 自己写的**）、存储面（psql：迁移副本在库、旧密文也在——追加模型不假装消失）、访问面（bob 下载 404，无"再下一次"通道）；⑦bob 端 removedMemberships 如实显示。

**变异臂**：拿掉 `requireShareMember` 的 `removedAt` 过滤（cp 备份还原——checkout 事故后再没用过 checkout）⇒ **恰好 `RESULT=FAIL step=4 reason=被移除者上传应 404，实际 200`**；还原复绿 7 步，路由测试 26/26 无残留。

**本段逼出的一个真设计决策（登记为 W3 第一项，待与产品负责人/引擎接线一起拍）**：**share op 载荷存在两种不可互操作的格式**——sync-client 的 magic wire 信封（全身份 AAD，collab-sync 在用）与 sync-core 的迁移 record 信封（record-id AAD，`reencryptShareRecord` 只吃它，collab-revoke 在用）。两个 verify 脚本各钉一种格式是**诚实的现状**，但客户端引擎落地前必须统一（推荐：统一到 record 格式 + 全身份 AAD——sync-core 的 record 函数改为接 identity，sync-client 的 magic 层退役或变薄壳）。这不是本轮能顺手拍的：它动 AAD 语义，配得上一次显式评审。

**边界如实记**：①「WS 已断」一格未覆盖（W2 移除路由不摘 WS 连接，realtime 接线被撞车面挡住；本脚本无 WS 客户端可断）——接线落地后补；②同 collab-sync：真实原语 + 原始 HTTP 站位客户端引擎。

## W3 验收切片（2026-10-08 第八段）：verify:collab-conflict ✅ + COMMENT 链收口确认

**读数**：`verify:collab-conflict` **首跑即 `RESULT=OK steps=6`**。①双账号+共享建立（同前形状）；②🔴 **同一条任务被两台设备并发编辑**（owner「A 版本」T、bob「B 版本」T+2s）——share op-log 追加式，**两条都接受**（服务端不裁决内容）；③🔴 **收敛判据的强形状**：双方各自下载全量历史、解密、用**真实 op-log reducer**（`replayOperations`，字段级版本账）独立重放——**两种到达顺序（A→B / B→A）+ 双方独立重放，全部物化出同一胜者「B 版本」**（LWW 后写者胜，到达顺序不影响结果）；④历史保留 2 条（被覆盖版本没有消失——可恢复的前提）；⑤🔴 恢复：owner 以更晚时间戳写回「A 版本（已恢复）」⇒ 3 条历史、两种顺序重放一致收敛到恢复版；⑥冲突场景下库里仍零明文。

**变异臂**：op-log LWW 选择反转为"最早者胜" ⇒ **恰好 `RESULT=FAIL step=3 reason=…物化「A 版本」…期望都是「B 版本」`**；还原复绿 6 步，entity-coverage 6/6 无残留。

**COMMENT 链收口**：四包测试终态全绿（op-log coverage 6、ui 28、i18n 14、mobile conflict-keys 17、shared-schema 173、server share 36）——三处 dist（shared-schema / op-log / i18n）按依赖序重建后全链一致。

**五个 verify 的进度**：keys ✅ / sync ✅ / revoke ✅ / **conflict ✅** / journey ⏸（等 W4 UI——范围顺序，非撞车面）。

## W4 UI 模型层（2026-10-09 凌晨续）：三件套 + 组件薄壳 ✅（apps/web 接线待其落地）

| 项 | 结果 |
|---|---|
| `packages/ui/src/sync/share-model.ts` | ✅ 成员投影（owner 优先/按加入时间/isSelf 精确判）、管理与邀请判定（owner-only）、名额（30 含 owner）、角色变更裁决纯函数（NOT_OWNER/TARGET_IS_OWNER/INVALID_ROLE/ROLE_UNCHANGED 四拒）、兜底名（不显裸数字） |
| `share-consent-model.ts`（PIPL 方案 a） | ✅ fail-closed（无记录必弹；半条记录也弹）；**勾选语义精确化**：勾了不再提示=永不再弹，没勾=下次共享还会弹（复选框的价值所在）；取消不留确认记录。变异臂：恒不弹 ⇒ 恰好 4 红/还原 6 绿 |
| `comments-model.ts` | ✅ 线程投影（任务过滤/软删排除/时间排序+id 兜底）、草稿校验（空/超 2000）、作者兜底 key+参数（不显裸数字） |
| 双语词条 | ✅ `common.share.*` 块（成员角色×4/名额/等待授权/评论×3/同意×7）追加进 zh-CN/en（只许追加表；i18n catalog **14/14**） |
| 组件薄壳 | ✅ `SharePanel.tsx`（成员列表/邀请/角色/移除，回调交回宿主走 /api/shares/*，零网络零权限判定）+ `ShareConsentModal.tsx`（方案 a 模态；applyShareConsent 落盘走宿主）。t() 由宿主解析传入（不 import i18n——AuthForm 同一条纪律）；aria 平铺（rn-aria 纪律） |
| 测试与类型 | ✅ 三份模型 spec **24/24**；ui 全包 tsc 仅剩**并行会话的 2 处既有错误**（empty-state/habits 生成 JSON 未列进 tsconfig，非我方）；模型+sync-model **52/52** |
| 仍待 | SharePanel/ConsentModal 接进 apps/web（132 文件撞车面）+ Playwright journey + reinstall；**方案 a 模态的视觉追认**（W4 验收人看图时请产品负责人过目，Goal 停止点转待追认）；W5 通知、W6 链接 |

## W5 模型层（2026-10-09 早）：通知路由本地过滤 ✅

`packages/ui/src/sync/notification-model.ts`（新文件）+ `tests/notification-model.spec.ts`（8 条）。

| 项 | 判据 |
|---|---|
| 活动三类（完成/新增/删除） | 默认全关（防通知风暴）；开一类只响一类 |
| 任务提醒四档 | 所有 / 所有（指派给他人的除外）/ 指派给我的 / 不提醒；默认「指派给我的」；🔴 **自我操作守卫**：自己改自己的任务任何档位都不响——变异臂抹掉守卫 ⇒ 恰好 1 红/还原 8 绿 |
| 自动接受已知合作者 | 默认关；开了后**精确 id 相等**才自动接受（不存在模糊的「认识」），名单外拒绝 |

撞车面第五次确认：apps/web 135 / app-host 37 / legal 8 全部仍被占——W4 入口接线与 journey 继续如实等待。

## W4 评论线程组件（2026-10-09 早续二）：CommentThread ✅

`packages/ui/src/sync/CommentThread.tsx`（新文件）——线程渲染 + 编辑器薄壳，消费 `comments-model.ts` 的排序/过滤/校验。**没有 maxLength**（NIST 禁止静默截断；超长由模型校验给出文字错误，`aria-live` 播报）；作者走兜底名（不显裸数字 id）；错误是文字非红框。已进 ui index 导出 + build 绿。ui tsc 剩 2 错 = 并行会话既有（empty-state/habits 生成 JSON）。

## W5 包内收尾（2026-10-09 早续二）：i18n 12 键×2 + ui index 导出 + 组件类型修正 ✅

NotificationPrefsPanel 的词条（`common.share.notif.*` 12 键×2）追加进 zh-CN/en（catalog **14/14**）；`ui/index.ts` 导出 NotificationPrefsPanel/share-link（增量行）。**类型修正 3 处**：MATCHERS 的 prefs 类型标错（ShareActivityPrefs ≠ ShareNotificationPrefs）→ 面板 `prefs.activities[kind]` 键名不匹配（completed ≠ onCompleted）→ **isActivityEnabled 收进模型层做唯一映射**（组件不许自己拼键名——与 sync-model 的字面量联合同一纪律）。ui tsc 剩 2 错 = 并行会话的 empty-state/habits 生成 JSON 既有问题（非我方）；ui build 绿。通知模型 **8/8** 无残留。

## W5 组件壳 + W6 链接骨架（2026-10-09 早续）

| 项 | 结果 |
|---|---|
| `NotificationPrefsPanel.tsx`（W5 组件壳） | ✅ 三类活动开关（checkbox 平铺 aria-checked）+ 四档任务提醒（radiogroup + ◉/○ 视觉态）+ 自动接受开关**视觉分层**（安全决策单独一块）；判定全部在模型层、组件只传 prefs；labels 宿主 t() 传入 |
| `share-link.ts`（W6 链接模型骨架） | ✅ `buildShareJoinLink`（尾斜杠容忍 + encodeURIComponent）+ `parseShareJoinLink`（异路径/无 token ⇒ undefined；容忍裸 token 由宿主分流）。🔴 链接只有一次性凭证 token，**密钥永不进 URL**（ADR-0062 拒绝的方案第 3 条） |
| 测试 | ✅ 通知 8/8（前段）+ 链接 3/3；**变异臂**：抹掉异路径校验 ⇒ 恰好 1 红/还原 3 绿 |
| 仍待（全部等撞车面或停止点） | 入口接线 + journey（apps/web）；通知偏好面板挂进设置页（同）；**方案 a 视觉追认**（停止点）；GDPR terms 红格（并行在途） |

## W4 传输层（2026-10-09 早）：ShareApiClient ✅

### 下一增量（W4 接线的设计决定，2026-10-09，已按最稳妥选项实施方向记录）

**web 端清单密钥存储**：share op 载荷与成员信封的密钥（listKey 族）不能以明文落
localStorage（等于把 E2EE 的钥匙贴在门上），也不可只存会话内存（刷新即失钥 ⇒ 共享
清单不可用）。方向：**用 vault sync 子钥包裹 listKeys 后落 localStorage**（复用
ADR-0050 的包裹机器；vault 未解锁 ⇒ 共享面板如实显示"需要解锁"），解锁会话内解包
使用。该设计是 ADR-0062「share 密钥是 vault 旁的新层」的直接推论，不与任何在册
裁决冲突；实施时进 `apps/web/src/features/share/share-key-store.ts`（新文件）。

✅ **已实施**（2026-10-09）：`apps/web/src/features/share/share-key-store.ts` +
`tests/share-key-store.spec.ts`（5 条，**真实口令信封**往返——不是 mock 的
encrypt/decrypt 对）：wrap→unwrap 往返还原；落盘密文搜不到 listKey base64；
rekey=同 shareId 覆盖；错误口令（vault 未解锁形状）⇒ undefined；坏 JSON/坏版本
按空存储。

**web 宿主壳**：`apps/web/src/features/share/SharePanelHost.tsx`（新文件）——SharePanel（ui）+ ShareApiClient（传输）+ key-store（密钥）三线汇合的容器：加载详情与成员表、面板回调直通 API（移除/改角色）、listKey 经 `getPayloadCipher`（vault 会话）解包，未解锁 ⇒「需要解锁」如实显示。apps/web tsc：share 两文件零错误（全树剩 3 错全在并行会话 10:44 仍活跃的 features/ai，键 `common.ai.generatedLabel` 类型不匹配——他们的在途 WIP）。

**待接线（等 apps/web 撞车面）**：入口（清单详情的「共享」按钮 ⇒ ShareConsentModal ⇒ createShare ⇒ Project.shareId 回写 + SharePanelHost 挂载）+ Playwright journey（真浏览器走邀请→接受→指派→评论全流程 + 截图人看）。

**`ShareFeature.tsx`**（新文件，自包含接线组件）：App.tsx 解封后一行 import 即挂载。组件内汇合同意 modal + 面板 + API client + 密钥存储；apps/web tsc：ShareFeature 零错误（全树剩 1 错在并行会话的 inbound-runtime.ts）。

## 状态总结（2026-10-09 11:15，本 goal 的所有可独立执行工作已穷尽）

**已完成并提交/暂存**：
- W0 勘误+依赖门 / W1 密钥纯函数 15 测试+变异三臂 / W2 四张表+14 端点+role 硬门 36 测试+变异 2 红 / W3 COMMENT 链四包全绿+格式统一 / W4 传输层+密钥存储+UI 模型×3+组件×4+web 宿主壳+ShareFeature 接线组件 / W5 通知模型+组件壳+i18n / W6 链接模型 / 四个 verify 脚本（5/9/7/6 步全 OK 各有变异臂）/ 法务合流（third-parties 1.4 + privacy 1.9 并行会话闭合 structure.spec 63/63） / PIPL 23 评估（结论=需单独同意，方案 a 已实现待追认）

**等待撞车面解封后可立即执行**（配方与落地表全部在案）：
- apps/web 入口接线（`ShareFeature` 一行 import 进 App.tsx + 清单详情「共享」按钮）⇒ Playwright journey + reinstall
- W3 引擎接线（op-log engine.ts share 分区重放走真实引擎——20+ 小时稳定的成品待提交）
- legal share 类目收口（privacy/data-rights/personal-info 的 share 类目收口配方已在案——并行会话 1.8 已闭合大半）

**需要产品负责人过目的停止点**：
- 方案 a 同意 modal 视觉（组件已按 a 落地，W4 验收时请过目）
- W6 owner 转让语义（调研未确证滴答行为）

**🔴 新增跨会话集成缺陷（2026-10-09 发现，有主=并行会话）**：
`server/dist` 启动即崩 `Cannot access 'inbound_core_1' before initialization`——
`@heyta/inbound-core` 的循环依赖或初始化序问题导致 `entitlement.js`/`entitlement-ticket.js`
在 inbound-core 模块完成初始化之前就引用了它。**影响**：server 起不来 ⇒ 三个需
服务端的 verify 脚本（sync/revoke/conflict）暂不能跑；keys（纯函数不需服务端）不受影响。
**并行会话修复后我方立即复跑四脚本取读数**。此前四脚本曾全绿（server dist 尚未包含
并行会话最新 inbound-core 时），所以这是新引入的集成回归，不是既有缺陷。
- check:legal-gdpr terms 1.3 → 并行会话已自行修复（10-09 复验绿）
- check:ai-coverage 7 处 inbound-automation → 并行会话在途
- apps/web features/ai 3 处 TS 错 → 并行会话 10:44 仍在编辑

`packages/sync-client/src/share-api-client.ts`（新文件）：`/api/shares/*` 全部 14 端点的类型化客户端——`ShareApiClient`（`fetchImpl` 注入、Bearer JWT、非 2xx 归一 `ShareApiError`（稳定错误码镜像）、网络异常归 `network`）；**纯传输**——载荷信封与信封密文原样透传，密码学在 sync-core/薄层（单一所有者）。规格 8 条（URL/方法/头/体形状、错误码镜像、network 归类、密文透传）+ **变异臂**：丢鉴权头 ⇒ 恰好 2 红（401 遍历 + 带令牌调用）；sync-client 全量 **155/155**。已导出（index.ts）。

## W3 主体（2026-10-09 凌晨）：域模型 + 物化桶 + AI 债务登记 ✅

| 项 | 结果 |
|---|---|
| `domain/entities.ts` | ✅ `Comment` 接口（一条一实体，ASSISTANT_TURN 模板）+ `EntityModelMap.COMMENT` + `Task.assigneeUserId?` + `Project.shareId?`（全部可选、不 bump schema）；`MODELED_ENTITY_TYPES` 枚举补 COMMENT（编译期兜底 `AllModeledAreListed` 先红后绿——门禁在工作） |
| `op-log/state.ts` 物化 | ✅ `comments` 桶 + `BUCKET_BY_ENTITY.COMMENT` + `emptyState()` + import；UNMODELED 移除 COMMENT（清单文件头："移除登记 = 物化已实现"）。**reducer 零改动**——通用桶机制直接物化 COMMENT 的字段账 |
| AI 覆盖债务 | ✅ `ENTITY_COVERAGE_DEBT` 登记 `COMMENT=AI-COV-8`（分母 9→10，9/10 + 已登记缺口 1）；台账文档 `ai-event-tool-contract.md` §5.1 同步。⚠️ 该门禁另有 **7 处红全部属于并行会话的 inbound-automation 在途批**（数量与本轮前一致，非本链引入） |
| 回归纵队 | ✅ domain **1023/1023**、op-log **147/147**、shared-schema 173/173（前段）、四个 verify 脚本（5/9/7/6 步）在模型变更后**全部复绿**、conflict 补接线实测 OK |
| 仍待 | W3 引擎接线（share 分区重放走真实引擎——payload-cipher 解密后进 `comments` 桶的通路在 sync-client/app-host，等撞车面）；W4 UI 全量 + journey + PIPL 形态；W5/W6；GDPR terms 红格（并行在途） |

## W4 前置决策（2026-10-09，AskUserQuestion 未获答复 ⇒ 按推荐项继续，标注待追认）

| 决策 | 采纳（推荐项） | 状态 |
|---|---|---|
| PIPL 23 同意界面形态 | **方案 a：首次「共享此清单」模态确认**（列明可见范围与元数据类别）+ 「不再提示」勾选（默认不勾）；后续共享不再打扰 | 🔴 停止点**转待追认**：W4 验收人看图时必须请产品负责人过目；如否决，改 form 只动一个组件 |
| share 载荷格式统一 | **统一到 record 格式 + 全身份 AAD**：sync-core record 函数升级为绑全 op 身份（AAD = shareId + 全部身份字段），sync-client magic 层退役；`reencryptShareRecord`（确定性 IV 幂等）直接消费线上格式 | W3 引擎接线的**前置**，接下来立即实施 |

## 法务收口 + COMMENT 链落地（2026-10-08 晚，产品负责人指令「做完，不要停」后转激进模式）

**撞车面性质复核（mtime 实证，替代一刀切的"被占即等待"）**：legal 四文件 21:57-58 活跃 ⇒ 不碰；op-log state/engine 与 domain/entities 已稳定 8-9 小时（并行会话的**成品未提交**）⇒ 按「增量、远 hunk、不扰动」原则直接在其上落针。

| 项 | 结果 |
|---|---|
| 🔴 法务合流 | ✅ **由并行会话自行完成**（21:57-58 那轮）：privacy 1.9 草稿条目补齐 share 三类（分享记录/分享成员/分享邀请）+ automation 四类 + 计数重算 34 处/33 张表 + spec CATEGORY_NAMES 七行——`structure.spec` **63/63 全绿**（此前的 2 红已消）。closure-truth ✅ / **gdpr ✅**（terms 1.3 在途回归已自行修复——10-09 10:34 复验）/ permissions ✅ / backup-retention ✅ / legal-copy ✅。`legalSetVersion` 指纹自动含 privacy@1.9 草稿。**法务余项就此关闭** |
| 🔴 COMMENT 实体进 `ENTITY_TYPES` | ✅ **八步表第 1/2/6 步全落**：`entity-types.ts` 扩项（ASSISTANT_TURN 模板注释）→ `op-log/state.ts` `UNMODELED_ENTITY_TYPES` 登记（share 域专用，物化随引擎接线）→ ui `EntityLabelKey`/`ENTITY_LABEL_KEYS` → i18n zh/en 词条（『评论』/『Comment』，只许追加表的设计用法）→ 全链测试绿：op-log coverage **6/6**、ui sync-model **28/28**、i18n catalog **14/14**、mobile conflict-keys **17/17**（共享 schema/ui/i18n 三处 dist 重建后）、shared-schema 全量 **173/173** |
| server 侧 COMMENT role 门 | ✅ 两条新测试：commenter 写 COMMENT 被接受（词表激活）、viewer 写 COMMENT 仍被拒（role 门非实体门）——share 路由+schema **36/36** |
| 第三段落过的 | `verify:collab-keys/sync/revoke` 三脚本接线进根 package.json（package.json 已稳定 8 小时，增量落针）并实测：**5/9/7 步各自 RESULT=OK** |
| 仍待 | W3 引擎接线细节（COMMENT 物化桶 + share 引擎——engine.ts 现量稳定可落，下一轮）；**格式统一**（W3 第一项设计决策）；verify:collab-conflict（不被占，下一轮）；journey（等 W4 UI）；**GDPR terms 红格**（并行会话在途）；PIPL 同意界面形态（W4 停止点） |

## 格式统一实施 + 四脚本全绿（2026-10-09 凌晨续）

| 项 | 结果 |
|---|---|
| 🔴 格式统一**已实施**（按推荐项） | ✅ `sync-core/share-keys.ts`：record 三件套（encrypt/decrypt/reencryptShareRecord）**升全身份 AAD**（与 wire 层同一份规范化字段清单）+ **信封自描述世代**（version + keyEpoch float64 + IV + body）+ `shareRecordEpoch` 导出；`sync-client/share-payload-cipher.ts` 重写为**薄委托层**（magic 信封退役；世代→钥选路；新增 `reencrypt` 薄方法，确定性 IV 幂等保留）。**share op 载荷从此只有一种格式** |
| 回归 | ✅ sync-core **318/318**（share-keys 15 条更新后全绿）、sync-client **147/147**（share spec 重写 8 条）、四个 verify 脚本 **5/9/7/6 步全 OK** |
| 本段事故（如实） | ① python 补丁的 stray `write(src)` 先截断文件再抛 NameError ⇒ **share-keys.ts 被清空**——从 git 暂存区 `git show :path` 恢复 W1 完整版后重放全部改动（暂存区第二次救场）；② 恢复版测试照跑才发现脚本还有多处旧调用——**恢复后必须全量重跑而不是只跑改动点**；③ 变异还原的 cp 备份纪律再次生效（checkout 事故后未再犯） |
| 五个 verify 进度 | keys ✅ / sync ✅ / revoke ✅ / conflict ✅ / journey ⏸（等 W4 UI）|

## 2026-10-10 交接（会话中断，交给下一个 AI；本节是唯一权威交接面）

> 背景一句话：产品负责人授权「按产品角度/PM 思维/用户旅程最佳实践完整合并」。上一会话完成
> 大提交推送（`d8d6a783..8bbc50b1`，5 笔+merge）后，继续做了 **W4 入口接线 + W5 挂载 +
> journey 三件套**，**代码全部落盘但未提交**，`verify:collab-journey` **一次都还没跑过**，
> 随后按产品负责人指令停止并写本交接。

### 一、本段已完成（有读数）

| 项 | 结果 | 读数 |
|---|---|---|
| 🔴 server 循环依赖修复 | ✅ `entitlement-ticket.ts` 的 `@heyta/inbound-core` import 原写在**使用点之后**——ESM 提升使 typecheck 绿，但 CJS 编译时 require 按源码顺序落位 ⇒ dist 里 `inbound_core_1` before initialization。修法=把 import 块挪到文件顶部。**该修复已随某笔并行提交进 HEAD**（工作树与 HEAD diff 为空，勿重复修） | 三脚本复跑全绿：`verify:collab-sync` RESULT=OK steps=9 / `revoke` 7 / `conflict` 7→6（6） |
| app-host `setProjectShareId` | ✅ `packages/app-host/src/project-actions.ts`（接口+实现，一个意图一条 op：载荷只有 shareId）+ 3 条测试 | project-actions.spec 通过（同轮 run 里 checkout/entitlement/keepalive 的红是**并行会话在途**，见下） |
| ui 面板自识别按 memberId | ✅ `share-model.ts` `SharePanelData.selfMemberId?`（有它按 memberId 判 isSelf，否则回落 userId）+ `SharePanel.tsx` `selfUserId?` 可省 + 3 条测试 | ui 全量 **664 passed** |
| share-key-store 身份持久化 | ✅ 新增 `wrappedIdentitySeed?` / `ownMemberId?` 字段 + `storeShareIdentity` / `getShareKeyEntry` / `unwrapShareIdentitySeed` / `deleteShareKey`。🔴 upsert 契约：`wrapAndStoreShareKey` **不保留**旧身份字段，换钥调用必须回传（测试钉住） | 测试**已写未跑**（用户中止了那次 run） |
| W4 入口接线（web） | ✅ `ShareFeature.tsx` **全量重写**为旅程对话框（同意模态→createShare→自封信封→Project.shareId 回写→面板+邀请+一次性凭证+自动封信封轮询+改角色+移除+离开）；`JoinSharedListDialog.tsx` 新建（贴 token→accept→等信封→解钥→建清单落侧栏）；`ProjectsPanel` 加「加入共享清单」入口；`App.tsx` 清单头部「共享」按钮+双对话框挂载 | web typecheck **绿**（ui/i18n/app-host/shared-schema dist 重建后） |
| W5 通知偏好挂载 | ✅ `ShareNotificationSettings.tsx` 新建（设置→同步与隐私组内、`syncConfigured` 才渲染、localStorage 落盘零网络）+ `ui/index.ts` 补 notification-model 导出 | typecheck 绿；e2e 断言未写 |
| i18n 中英同步 | ✅ `web.share.*` ~50 键（zh+en 镜像）+ `common.share.panel.membersTitle` | i18n build 绿 |
| journey 三件套 | ✅ `e2e/playwright.collab.config.ts`（无 webServer、baseURL 走 env、trace/video 关——口令与 token 不进自动产物）+ `e2e/tests/collab-journey.spec.ts`（双 context 全旅程、截图固定路径 `e2e/test-results/collab-journey/`、console/pageerror 挂在页面创建时）+ `scripts/verify-collab-journey.mjs`（起真服务端+vite+Playwright，`pnpm verify:collab-journey` 已接线进 package.json） | 🔴 **从未运行**——首跑大概率要调试 |
| 顺手替并行会话补的半截活 | ✅ `packages/app-host/src/checkout.ts` 给 `CheckoutResponseBody` 补 `code?: unknown`（他们的消费端已改读 `payload.code`，类型侧差这一行，dts 构建红挡了我）；`apps/web/tests/app-mount.spec.tsx` mailto[0] 加守卫；ui/web 两处测试的索引非空断言 | app-host build 恢复绿 |

### 二、🔴 工作树状态（下一个 AI 的第一件事：分清两条线）

全树 **86 个未提交路径**，两条线混居（并行会话在做「api-error 全局信封迁移 + 邮箱验证码登录」，他们的文件**不要**打进协作线的提交）：

**协作线（建议单独一笔 commit）**：
```
apps/web/src/App.tsx
apps/web/src/features/projects/ProjectsPanel.tsx
apps/web/src/features/projects/store.ts
apps/web/src/features/share/ShareFeature.tsx
apps/web/src/features/share/share-key-store.ts
apps/web/src/features/share/JoinSharedListDialog.tsx   (新)
apps/web/src/features/share/ShareNotificationSettings.tsx (新)
apps/web/tests/share-key-store.spec.ts
packages/app-host/src/project-actions.ts
packages/app-host/tests/project-actions.spec.ts
packages/i18n/src/locales/zh-CN.ts
packages/i18n/src/locales/en.ts
packages/ui/src/index.ts
packages/ui/src/sync/SharePanel.tsx
packages/ui/src/sync/share-model.ts
packages/ui/tests/share-model.spec.ts
e2e/playwright.collab.config.ts   (新)
e2e/tests/collab-journey.spec.ts  (新)
scripts/verify-collab-journey.mjs (新)
package.json   (只加了一行 verify:collab-journey)
```

**我替并行会话补的（协作提交里捎带或在提交信息里注明归属）**：
`packages/app-host/src/checkout.ts`（+1 行 code 字段）、`apps/web/tests/app-mount.spec.tsx`（mailto 守卫）。

**并行会话的（不碰、不代提交）**：`packages/shared-schema/src/{auth-http-contract,index}.ts`、`api-error-contract.ts`(新)、`server/src/api-error.ts`(新)、全部 server 路由文件、`packages/sync-client/src/share-api-client.ts`、`server/src/shares/share.routes.ts`、`packages/app-host/src/inbound-entitlement-tickets.ts`、BLOCKED/PROGRESS、web evidence png 等。

**已知红（并行会话在途，非协作线）**：app-host 测试 `checkout.spec.ts` 2 红 / `inbound-entitlement-tickets.spec.ts` 1 红 / `inbound-session-keepalive.spec.ts` 4 红——全是他们 api-error 迁移的爆炸半径（mock 还是旧 `{error}` 形状）。协作线收尾跑 `pnpm check` 前**先现量**这些是否已被他们修掉；若他们已收工（文件 mtime 停滞数小时）仍红，按产品负责人既有授权「直接把别的会话应该做的工作做掉」补完（把 mock 更新为 `{code,message}` 信封）。

### 三、剩余工作（按优先级，下一个 AI 的执行序）

1. **首跑 journey（最可能出活的调试点）**：`pnpm verify:collab-journey`。spec 的未验证假设：① zh 占位符 `input[placeholder^="添加任务"]`；② 真 vault 建立流（`vault-create-passphrase`→恢复码回显→`vault-publish`→`vault-ready`）在**真服务端**下 publish 走真 key-package 端点；③ RNW 的 `testID` → `data-testid` 映射（SharePanel 是 RN 组件）；④ `share-join-entry` 只在 `syncConfigured` 时渲染；⑤ bob 入群后标题切到自己起的本机名。截图落在 `e2e/test-results/collab-journey/`，**人必须看图**（§6.2 规定一）。变异臂在脚本头：注释掉 `ShareFeature.tsx` 的 autoSeal useEffect ⇒ bob 卡「等待所有者分发密钥」⇒ 恰好该断言红。
2. **补跑被中止的测试**：`pnpm --filter @heyta/web test -- tests/share-key-store.spec.ts`。
3. **W6 两个真缺口**：① **分享链接落点**——`buildShareJoinLink(baseUrl, token)` 拼的是**同步服务器**的 `/share/join?token=…`，服务端**没有**这个路由页面；点链接会 404。改法二选一：服务端加一页跳转（到 app URL 带 token），或链接改拼应用地址（需要 app URL 可得——`apps/landing` 的 `VITE_APP_URL` 先例）。v1 诚实态：token 手动粘贴可用，链接复制是「给朋友的凭证载体」，页面路由登记为缺口。② **owner 转让**：计划 W6「转让=换 owner + 原 owner 降 editor」；服务端无端点（`PATCH members` 明确拒改 owner 角色），要加 `POST /shares/:id/transfer` + 面板入口。🔴 语义是 B 类停止点：**验收时请产品负责人过目**（滴答行为未确证）。
4. **W4 残余（如实登记，不包装）**：评论/指派/动态 UI **未建**（`CommentThread` 组件在 ui 包但没挂载；任务指派选择器没做；**共享任务的写路径路由**——共享清单里的任务 CRUD 应走 share 通道而非个人 op-log——是最大的剩余架构件）。这些做完之前，「协作」的实际内容只有成员管理+密钥分发；计划 §4 journey 行的「指派→评论→通知→动态」覆盖登记为部分完成。
5. **B 类待产品负责人过目**：PIPL 方案 a 模态视觉（02-owner-consent-modal.png 那张图）；owner 转让语义。
6. **收尾固定动作**：`pnpm -r typecheck && pnpm -r test`（注意 app-host 在途红）→ `pnpm check` 全绿 → `pnpm reinstall:all` 四端 → 写回（`dida365-feature-benchmark.md` §2.6 的 6.1/6.2/6.3 按实际完成度翻✅带证据、`feature-matrix.md`、`roadmap.md`、AGENTS §9、本计划状态行）→ 分线 commit + push。
7. **法务联动检查**：共享 UI 上线后按 AGENTS 规则 18 核对 privacy 帮助文案是否需要更新（并行会话已把 share 三类进 privacy 1.9，本次 UI 措辞与那版一致性顺带核对）。

### 四、下一个 AI 的 Goal 原文（创建 Goal 时逐字用这份）

> 【Goal】收口 heyta 共享清单（多人协作）功能：上一会话已把 W4 入口接线 / W5 通知偏好挂载 / verify:collab-journey 三件套的代码全部写完但**未提交、journey 未跑过**（交接面：`docs/plans/goal-collaboration-shared-lists.md` 的「2026-10-10 交接」节，从那里接）。目标：① 跑绿 `pnpm verify:collab-journey`（首跑需调试，变异臂在脚本头）并人工查看 `e2e/test-results/collab-journey/` 全部截图；② 补跑被中止的 `apps/web` share-key-store 测试；③ W6 两缺口：分享链接落点（服务端 `/share/join` 无路由，二选一改法见交接节）+ owner 转让端点与 UI（语义=转让后原 owner 降 editor；🔴 停止点：验收时请产品负责人过目）；④ `pnpm -r typecheck && test` + `pnpm check` 全绿（app-host 有并行会话在途红测试，处置规则见交接节二）+ `pnpm reinstall:all` 四端；⑤ 写回 dida365-feature-benchmark §2.6 / feature-matrix / roadmap / AGENTS §9 / 计划状态行，评论/指派/共享任务写路径路由如实登记为 W4 残余；⑥ 按交接节的文件清单**分线提交**（协作线一笔、并行会话的不碰）并 push。
> 纪律：AGENTS.md 全文有效（尤其 §3.5 op 构造归 app-host、§6.2 截图人看、§8.7 完成范围逐项对账、§8.8 写回原入口）；每个新判据至少一个变异臂；汇报带 A（活跃撞车）/B（需拍板）/C（纯执行）三分类。
> 停止点（只有这两个要问用户）：PIPL 方案 a 模态视觉追认；owner 转让语义。其余一律连续推进不问。

### 五、本段事故与教训（如实）

- 我一度以为 entitlement-ticket.ts 修复未提交；现量发现**已随并行会话某笔提交进 HEAD**（教训照旧：交接前必须 `git status`/`git diff HEAD` 现量，不凭记忆）。
- 并行会话这 10 小时又落了 7+ 笔提交（含一条「跨线提交」自报）——工作树是共享的、活的；**每一步动文件前重新现量撞车面**（mtime >8h=稳定成品可增量落针；分钟级=活跃改写真等待）。
- `cssVar` 的 token 名两处写错（`border.width`→`border-width.thin`、`color.surface-muted`→`color.surface-subtle`）：**TokenName 是类型检查的，写错编译期就红**——这正是设计系统三条硬规则的价值，照单全收即可。
- e2e spec 初稿的成员计数选择器 `[data-testid^="share-member-"]` 会被 `share-member-actions-*` 污染（数成 3）——已改 `:not()` 排除；下一个 AI 首跑若还遇到计数不对，先查这类前缀包含。

---

## 2026-10-10 交接·二（Goal ①②③已闭环、④⑤⑥未做；本节取代上一节的执行序）

> 上一节（交接·一）描述的状态已被本会话推进：journey 从未跑 → **全绿**，W6 两缺口 → **全栈落地**。
> 本节是**新的唯一权威执行面**；上一节保留作背景（其中「二、工作树状态」已过时——并行 auth
> 会话已把他们的线全部提交掉，工作树现在很干净）。

### 一、本会话完成（逐项带读数）

| 项 | 结果 | 读数 |
|---|---|---|
| ① journey 全绿 | ✅ 八轮调试（脚本模板串语法错 → server CJS 循环依赖 → 设置浮层导航 → 证据目录被并行套件清掉 → CORS → sticky 层叠上下文拦点击 → 成功屏时序） | `RESULT=OK steps=3`，`JOURNEY_EXIT=0`；证据 **7 张**在 `e2e/collab-journey-results/`（⚠️ 路径已改，见下），**全部人工看过**（07 号可见成员 529·所有者（我）+ 530·可编辑；04 号凭证+链接双展示；06 号成功文案） |
| ① journey 变异臂 | ✅ 脚本头规定的臂已执行：注释 `ShareFeature.tsx` autoSeal useEffect → bob 卡「等待密钥」→ **恰好 `share-join-done` 一条红**；还原后复绿 | 红跑日志 `share-join-done` 超时定位 spec:198；绿跑 `.last-run.json = passed` |
| ② share-key-store 补跑 | ✅ 与两个新 spec 同轮跑 | 三文件 **25 passed**（`npx vitest run tests/share-key-store.spec.ts tests/join-link.spec.ts tests/share-panel-transfer.spec.tsx`） |
| ③ W6-1 链接落点 | ✅ 选了「链接拼应用地址」那一条改法：`share-link.ts` 重写为 `buildShareJoinLink(appBaseUrl, token) → {app}/?shareToken=…`（尾斜杠归一）；`ShareFeature` 用 `origin+BASE_URL` 拼链接并在票据区**明文展示**（`share-invite-link` + `linkTitle` 词条）；`JoinSharedListDialog` 加 `initialToken` 预填 + **createPortal 到 document.body**（sticky 侧栏的层叠上下文困住 fixed 后代，点击被拦——探针二分定位，附注释）；`ProjectsPanel` mount 时消费 `?shareToken=`（摘参数 replaceState + 开对话框）；解析抽成纯函数 `apps/web/src/features/share/join-link.ts` | `tests/join-link.spec.ts` **8 条**（取/摘/round-trip/源码级棘轮「ProjectsPanel 不许自带第二套解析」）；**变异臂已执行**：把 ProjectsPanel 改回内联解析 ⇒ 恰好棘轮那条红 ⇒ 还原复绿 |
| ③ W6-2 owner 转让 | ✅ 全栈：服务端 `POST /api/shares/:shareId/transfer`（requireShareOwner；目标须活跃成员非自己非 owner；`$transaction` 三写：share.ownerUserId + 目标→owner + 原 owner→editor；响应含 `demotedRole:'editor'`）；`sync-client.transferOwnership` + 契约测试；`SharePanel` 两步确认（armed 单行状态，testID `share-transfer-{id}` / `-confirm-` / `-accept-` / `-cancel-`）；`ShareFeature` 接 `onTransferOwnership` + transfer 四词条 + linkTitle；i18n 中英各 5 键 | 服务端 33/33（新增 5 条 + **变异臂**：去掉降级写 ⇒ 恰好 1 红）；web `tests/share-panel-transfer.spec.tsx` **7 条**（B 前置词条后果句 / C 入口如实×2 / A 两步×4）；**变异臂已执行**：首次按改直发回调 ⇒ 恰好 4 条 A 判据红（C/B 仍绿）⇒ 还原经 `@heyta/ui` 重建后复绿 |
| ④ 现量（替下一会话省两趟） | ✅ web 全量：**172 文件 2216 passed**（0 红）；app-host 全量：**94 文件 1775 passed**（0 红） | 🔴 交接·一登记的 app-host 在途红（checkout 2 / inbound 1 / keepalive 4）**已被并行会话修掉**——处置规则不需要了 |

### 二、本会话的调试产物（都已落树，别重复做）

- `scripts/verify-collab-journey.mjs`：修模板字符串引号语法错；服务端 env 加 `CORS_ORIGINS: http://127.0.0.1:${WEB_PORT}`（默认白名单只放行上游域名，症状是 bob 页面「离线」+ 服务端零请求）；证据路径改 `e2e/collab-journey-results/`。
- 🔴 `server/src/automation/entitlement-ticket.ts`：**交接·一说「已随并行提交进 HEAD」是错的**——首跑 server 直接起不来（`inbound_core_1 before initialization`，CJS require 按源码顺序落位而 import 写在使用点后）。本会话已修（import 挪文件顶部 + 注释）。**教训：交接面的「已修」也要现量。**
- `e2e/playwright.collab.config.ts`：outputDir 改 `./collab-journey-results`（Playwright **每次运行开始整树删除 outputDir**，共享 `test-results/` 会被其他套件互删——先例 `playwright.landing.config.ts`）；timeout 120s→180s。`.gitignore` 已加该目录。
- `e2e/tests/collab-journey.spec.ts`：vault 建立前加 `selectSettingsSection(page, 'sync')`（设置浮层默认开在「显示」组）；应用就绪断言放宽到 30s。
- `apps/web/src/features/share/JoinSharedListDialog.tsx` 的 createPortal：**position:sticky 总是创建层叠上下文**，后代 fixed+z-index 出不来 ⇒ 元素命中测试被侧栏拦。层叠问题先查 sticky/fixed 祖先，别先怀疑 z-index 数值。

### 三、剩余工作（下一个 AI 的执行序）

1. **journey 补链接落点断言**（小事，10 分钟）：spec 里 owner 邀请后断言 `[data-testid="share-invite-link"]` 文本含 `http://127.0.0.1:${WEB_PORT}` 且含 `shareToken=`（07 号截图已证链接真实在场，断言是把可见事实钉进判据），然后 `pnpm verify:collab-journey` 复跑绿。
2. **④ 收尾**：`pnpm -r typecheck && pnpm -r test`（⚠️ `pnpm --filter @heyta/web test -- tests/…` 的 `--` **不过滤**、整套件跑；单测直接在 apps/web 里 `npx vitest run tests/…`）→ `pnpm check` 全绿 → `pnpm reinstall:all` 四端（web/i18n/ui/sync-client dist 已重建过，重打包前照例再 `pnpm -r build`）。
3. **⑤ 写回**：`dida365-feature-benchmark.md` §2.6 / `feature-matrix.md` / `roadmap.md` / AGENTS §9 / 本计划状态行；W4 残余如实登记（评论/指派/动态 UI 未建；**共享任务写路径路由**是最大架构件）。
4. **⑥ 分线提交 + push**：现行未提交清单见 `git status`（22 M + 3 ?? + 1 D），**协作线一笔可全收**：
   ```
   .gitignore  apps/web/src/features/projects/ProjectsPanel.tsx
   apps/web/src/features/share/{JoinSharedListDialog.tsx,ShareFeature.tsx,join-link.ts}  (join-link.ts 新)
   apps/web/src/features/share/SharePanelHost.tsx  (D——零消费者死代码删除)
   apps/web/tests/{join-link.spec.ts,share-panel-transfer.spec.tsx}  (均新)
   e2e/{playwright.collab.config.ts,tests/collab-journey.spec.ts}
   packages/i18n/src/locales/{zh-CN,en}.ts  ← 现量 diff 只含协作线 5 键（并行会话的 loginCode 已随他们自己的提交走），整文件可提交；提交前再 grep 一次 diff 确认
   packages/sync-client/{src/share-api-client.ts,tests/share-api-client.spec.ts}
   packages/ui/{src/sync/SharePanel.tsx,src/sync/share-link.ts,tests/share-link.spec.ts}
   scripts/verify-collab-journey.mjs
   server/{src/automation/entitlement-ticket.ts,src/shares/share.routes.ts,tests/share-routes.spec.ts}
   ```
   **不碰**：`BLOCKED.md`、`packages/legal/src/documents/third-parties.ts`、`scripts/qa/macos-installed-widget-help.sh`、`scripts/verify-mobile-ios-account-email-sessions.sh`、`.agents/context/`（全是并行线的）。
5. **两停止点（B 类，带证据问产品负责人）**：① PIPL 方案 a 模态视觉——02 号图已人工核验，**发现：主按钮「确认共享」无视觉强调（与次按钮同权重），且无「不再询问」勾选可见位**（词条里有 dontAskAgain 但视觉层级待追认）；② owner 转让语义——已实现为「转让后原 owner 降 editor、立即生效、两步确认」，确认文案即 `web.share.transfer.confirmHint`（验收时请过目）。

### 四、本会话新增教训

- `pnpm --filter @heyta/web test -- <file>` 的 `--` 后参数**没有过滤生效**（整套件 174 文件全跑）——不是假绿来源但浪费 80s；直接 `cd apps/web && npx vitest run tests/<file>` 才是真过滤。
- vitest jsdom 环境里 `import.meta.url` 不是 `file:` scheme（`fileURLToPath(new URL(...))` 直接炸）——读源码文件用 `join(process.cwd(), 'src/…')`（vitest 以包目录为 cwd）。
- 测试文件里**有测试不渲染组件**时，afterEach 的 `root.unmount()` 要可空守卫（`'root' is possibly 'undefined'` 会被 typecheck 拦，但运行时炸法是 `Cannot read properties of undefined`）。
- 变异臂打红后的**红集形状本身就是判据**：transfer 变异的 4 红恰好全是 A 类两步判据、C 类可见性 3 条不受影响——说明变异只打在它声称的那一层；若红集溢出到 C 类，说明组件耦合有问题，要先查组件再还原因果。

## 2026-10-11 交接·三（Goal 第 1 步闭环、第 2 步卡在两枚预存红；本节取代交接·二的执行序）

> 本节是**新的唯一权威执行面**。交接·二记录的完成事实仍成立（journey 全绿、W6 落地、变异臂已执行）。
> 交接·二「三、剩余工作」的第 1 项（journey 补链接断言）**本会话已完成**，其余未做。
> ⚠️ **共享检出在动**：本会话期间 HEAD 从 `14e1e322` 漂到 `eefe118b`（并行"自动收集 T8"线在提交），
> 且一枚 typecheck 红被并行 auth 会话**中途自己修掉**（见下）。下一个 AI **每步都要现量，别照抄本节的号**。

### 一、本会话完成（逐项带读数）

| 项 | 结果 | 读数 |
|---|---|---|
| 第 1 步 journey 补链接落点断言 | ✅ | `e2e/tests/collab-journey.spec.ts` 票据区（04 号截图处）新增 4 条：`inviteLink` `toContain('shareToken=')`、`new URL(inviteLink).origin === 应用 origin`、`!== API_BASE origin`（落点是应用不是同步服务器）、`searchParams.get('shareToken') === inviteToken`（链接里的 token 与展示凭证同一个）。`pnpm verify:collab-journey` 复跑 **`RESULT=OK steps=3` / `VERIFY_EXIT=0`**；**04 号截图人打开看过** —— 入群链接 `http://127.0.0.1:4327/?shareToken=DKqG…rNCg`，token 与上方「邀请凭证」逐字一致 |
| 本线三包独立复跑 | ✅ | `pnpm -r test` fail-fast 停在 `@heyta/ai`，**ui 从没被跑到过** —— 单独跑本线三包：apps/web **2216 passed**、sync-client **156 passed**、ui 首跑 **1 红**（见下）→ 修后 **665 passed** |
| 🔴 当场修掉本线一个真 bug | ✅ | `packages/ui/src/sync/share-link.ts` 的 `parseShareJoinLink` 用 `token ?? undefined`，**空串漏判**：`…/?shareToken=` 返回 `''` 而非 `undefined`。改为 `token \|\| undefined`（空 token 不是合法入群凭证，应回落"裸 token 粘贴"分支）。**交接·二那句"25/25 绿"没覆盖到它**（那是 apps/web 的测试；这条 ui 判据此前从没进过一次能跑到它的门禁）—— 印证"交接面的『已修』也要现量" |
| `pnpm -r build`（第 2 步里唯一不被测试绊线挡的子项） | ✅ | **`BUILD_EXIT=0`**、无致命错（只有 zod 的 rollup 注释告警）。⇒ 本线改的 ui 源码编得过、`packages/*/dist` 已重建（reinstall:all 的前置）|
| 🔴 本线又查出并修掉 `pnpm check` 里**两枚协作线自己的门禁红**（非别线绊线） | ✅ | 见下"二·补"。`check:ui-language` 与 `check:layering` 都命中本线（`web.share.*` / `apps/web/…/share-key-store.ts`），逐条修完并复验绿 |
| `check:ui-language`（`web.share.invite.emailPlaceholder = name@example.com`） | ✅ | 根因**不是要翻译**：同一判断本线早已写进 `packages/i18n/tests/catalog.spec.ts` 的 `allowed`（注释"it is the example itself"，由本线 `2f59b075` 引入），但那笔**漏登记到 `scripts/check-ui-language.mjs` 的 `UNTRANSLATABLE_KEYS`** —— 两处各说一套。修法=把这把 key 补进门禁白名单、写清"补的是同一处已有判断"，**不动任何用户可见文案**（示例邮箱中英逐字相同，本就不该翻）。复跑 `check:ui-language` **`EXIT=0`** |
| 🔴 `check:layering`（`apps/web/src/features/share/share-key-store.ts` 里 `entityType: 'SHARE_KEY'`） | ✅ | `syntheticIdentity` 是喂给 `SyncPayloadCipher.encrypt/decrypt` 的**合成 AAD**（文件头明写"不参与线上协议、只防 localStorage 两条记录互换"），**不是派发的 op**；但门禁按 op 形状（`entityType:` 字面量）拦，不看意图。按 AGENTS §3.5 把 op 形状构造挪出外壳：新建 `packages/app-host/src/share-key-identity.ts`（纯函数 `shareKeyStoreIdentity`，零浏览器依赖）→ 从 `app-host/src/index.ts` barrel 导出 → 外壳删掉本地函数、5 处调用改指 app-host、重打 `app-host dist`。复跑：`check:layering` **`EXIT=0`（438 文件 / 10 规则）**、`pnpm --filter app-host --filter web typecheck` **两个 Done**、外壳 `share-key-store.spec.ts` **10/10 passed** |
| 第 2 步其余子闸在本地 HEAD 上的现量 | ✅ | 改完本线并三笔提交后：`pnpm -r typecheck` 全仓 **`TYPECHECK_EXIT=0`**、`pnpm -r build` **`BUILD_EXIT=0`**（含 app-host 新导出被各消费者编进 dist）、`@heyta/app-host` 单包 test **1775 passed（94 文件）**（证明 barrel 加导出没破坏任何 app-host 测试）|
| 第 3 步文档写回 | ✅ | `f1c93750` 一笔：benchmark §2.6 的 **6.1（❌→✅）** 与 **6.7（❌→✅，注明仅 Web 落点）**、`P2-10` 拆口径；feature-matrix §6 的 6.1/6.7 备注；AGENTS §9 新增"协作与共享清单"并行轨道状态；计划头部。roadmap **按 2026-09-29 收敛口径刻意不动**。`check:md-tables` + `check:docs` 均绿（无死链）|
| 🔴 layering 重构后 journey **端到端复跑**（不只是单测） | ✅ | 重构改了 `share-key-store.ts`（journey 的密钥流会走到它），故在本地 HEAD 重跑 `pnpm verify:collab-journey`：**`RESULT=OK steps=3` / `JOURNEY_EXIT=0`**，7 张证据图非空。**04 号图人打开看过**：入群链接 `http://127.0.0.1:4327/?shareToken=s_HopOYsjOM6…GpaI`，token 与上方邀请凭证逐字一致、落点是应用源（4327）不是同步服务器 —— 正是本会话第 1 步那 4 条断言钉的事实。⇒ 分层重构没破坏真实流程 |

### 二、第 2 步门禁链：两枚红，性质不同（关键区分，别读成一个）

1. 🔴 **typecheck 红 = 别线的，且已被别线自己修掉，我没代改**：首跑 `pnpm -r typecheck` 红在
   `packages/app-host/tests/login-code.spec.ts(44)` 一个失效的 `@ts-expect-error`（vitest 不跑 tsc，
   并行 auth 会话提交 `a63aa9e9` 时没发现）。我**判定归属后没有动手**（记忆红线：判据口径/别人资产不代改）——
   随后并行会话**自己**提交了 `50a43d64 fix(app-host 测试): 摘掉一条已经多余的 @ts-expect-error`，
   我重跑 `pnpm -r typecheck` = **`TYPECHECK_EXIT=0` 绿**。**教训：共享检出里撞到别线红，先判归属、别抢修；它可能正被所有者修。**
2. 🔴 **test 红：本会话已重生成清单，但暴露出两枚别线的"钉住计数没跟着改"红**。
   - **本会话动作**：跑 `node scripts/gen-ai-capability-manifest.mjs` 重生成了
     `packages/ai/src/capability-manifest.generated.ts`（补上 COMMENT，覆盖面如实记 9/10），
     `--check` 现 **RC=0**、diff 只涉及 COMMENT。这枚改动**现在在工作树里（M）**，是协作线提交要带上的。
     它清掉了 ai 那 3 条"产物与上游逐字节一致"失败。
   - **但 `pnpm -r --filter '!@heyta/sync-server' test` 仍 `TEST_EXIT=1`**，剩两枚红，**都不是协作线的代码**：
     - `packages/shared-schema tests/auth-http-contract.spec.ts:83` 期望 `AUTH_PASSWORD_PATHS` 长度 **9、实得 12**
       —— auth 线（`a63aa9e9` 邮箱口令登录）加了口令路由没同步这条硬编码计数。shared-schema **不在我 diff 里**。
     - `packages/ai tests/capability-manifest.spec.ts` 的 **"分母恰好 9"** 那条 —— 域模型加了 COMMENT（→10），
       测试钉的分母与逐条点名没跟着改。
   - **两类同形**：改了上游、没更新钉死的计数断言。按记忆红线「判据口径/别人资产不代改」，**这两枚该由引入方（auth 线 / COMMENT 引入方）改，别本线代 bump 数字**。
   - `pnpm -r test` **fail-fast** 会停在 `@heyta/ai`、其余各包根本没跑 ⇒ 交接·二要求的对数审计在 fail-fast 下做不了。
     **本会话改用 `pnpm -r --no-bail --filter '!@heyta/sync-server' test` 跑完并做了对数（见下"二·补"）**，
     把每一枚红逐个归了属 —— 其中**一枚是协作线自己的下游活，已当场修绿**（不是别线绊线）。
   - ⚠️ COMMENT 归属存疑：域里 `COMMENT` 那笔 `git log -S` 命中 `e6058120`（标"产品体验线"），协作计划正文也把 COMMENT 算 W4 的活。
     若判归本线，则 ai 那条"分母恰好 9→10 + 点名加 COMMENT"是**本线的收尾活**；shared-schema 那 9→12 铁定是 auth 线的，不代改。

### 二·补、第 2 步对数审计（本会话用 `--no-bail` 跑完）+ 一枚协作线自己的下游红（已修）

跑法：`pnpm -r --no-bail --filter '!@heyta/sync-server' test`（后台、日志 `/tmp/rtest2.log`）。汇总 **`5 fails, 15 passes`**。

- **对数（AGENTS §6 那条"有 test 脚本的包数 == 打 `Tests` 汇总行的包数"）现在收得平**：
  `grep -rl '"test"' packages/* apps/* server/package.json` = **21 枚**；`--filter` 摘掉 `@heyta/sync-server`（沙箱 `prisma generate` EPERM，如实记的边界）后 **20 枚跑**；
  `grep` 到打了 `Tests` 汇总行的也是**同一批 20 枚**（无"某层从没跑过"）⇒ **对数审计闭合，交接·二那条"做不了"已被这次 no-bail 否证**。
- **5 枚红逐个归属（关键：不能一把都推成"别线绊线"）**：
  1. 🔴 **`apps/landing` `tests/mockup-shell-shape.spec.tsx` #7 —— 是协作线自己造成的下游红，本会话当场修绿**。
     根因：本线 `a923f7fa`（W4 web 宿主接线）往 `apps/web/src/App.tsx` 的 `.ht-header__actions` **加了一枚 `data-testid="share-open-button"`**（共享清单入口），
     而 landing 复刻对账（`SHELL_HEADER_ACTIONS` 登记处 ⟷ 真应用页头 `data-testid` 双向等集）没跟着补 ⇒ 红在"多一件"。
     `a923f7fa` **已在 HEAD**（`merge-base --is-ancestor` = YES）⇒ 是提交态的本线涟漪，不是本次未提交改动带来的。**归属查法**：`grep data-testid` 定位 testid 在 App.tsx → `git log -S 'share-open-button'` 命中 a923f7fa → 确认那笔是本线的。
     **修法（不放宽判据）**：在 landing 登记处给共享入口补一项 `id/kind 'share-open-button'`、`labelKey 'web.share.open.label'`（=「共享」，中英词条都在）、`anchors ['share-open-button']`、`mockedInLanding: false`
     （产品条件是 `currentProject!==undefined && syncConfigured`，静态展厅没有"选中清单"那一态，与既有 `assistant-open` 同一档，**只登记锚点、不在图上画**）；阳性对照字面量按 DOM 序把 `share-open-button` 补到**第一**。
     复跑：`mockup-shell-shape.spec.tsx` **21/21**、landing 全包 **1409/1409 `rc=0`**。⇒ 这枚从本线交付里**销账**。
     - 🔴 **这枚 header 涟漪的作用域已穷举，landing 是唯一真下游消费者**（"缺陷是一类"，故逐个查，别只修看见的那一枚）：其余钉 `.ht-header__actions` 的判据点都**不受影响** ——
       `e2e/tests/shell-sync-rail.spec.ts` S1 数的是容器 `toHaveCount(1)`、只反向禁**同步**那几枚 testid 与「未同步/立即同步/处理冲突」文案（「共享」两不沾）；
       `e2e/tests/ux-viewport-matrix.spec.ts` / `playwright.detail-pane` 溢出闸 / `calendar-cells` ④ —— 共享按钮的条件是 `currentProject!==undefined && syncConfigured`，
       这几支都停在 `/?lang=zh-CN` 默认视图（收集箱/今天、无选中清单、无同步配置）⇒ **那一枚根本不进 DOM**，页头宽度与"首个按钮"都不变。
       ⇒ 结论：本线加这枚条件页头按钮，除 landing 复刻对账外**没有别的判据被带红**，无需再动别线。

  2. `packages/ai` `capability-manifest.spec.ts`（**2 failed | 263 passed**）—— 分母 9→10 与 `entityTypesWithoutTools` 的产品判断绊线，**AI 覆盖范围，不代改**。
  3. `packages/shared-schema` `auth-http-contract.spec.ts`（**1 failed | 172 passed**）—— `AUTH_PASSWORD_PATHS` 9→12，**auth 线判据口径，不代改**。
  4. `packages/domain` `subscription.spec.ts`（**1 failed | 1022 passed**）—— 权益拒绝理由契约，**计费/权益线，不代改**。
  5. ⚠️ `apps/mobile`（**`Tests 958 passed (958)` 却非零退**）—— **958 条全过，红只在一条 unhandled rejection**：`RolldownError: Parse failure` 起源于 `tests/auth-flow.spec.ts`（Rolldown 解析 Flow），
     就是 AGENTS §9 记的 **`RTEST-UNHANDLED-01`**（单跑不现、共享载体上的环境抖动，**不是产品失败、也不记协作线**）。附 `[prefs] op-sqlite Cannot find module` 是沙箱里原生模块解析不到的环境噪声。
- ⇒ **协作线自己的红：landing 一枚已修绿**。整链 `-r test` / `pnpm check` 现在**只剩三枚别线判断绊线**（ai/shared-schema/domain）+ 一枚已知载体抖动（mobile），
  **在本线之外，各归其主之前"全链绿"到不了**；reinstall:all 卡在全链绿之后，且产品负责人已明确"本会话不要再触发任何需要我交付的东西"，故不无人值守跑四端设备重装。



0. 🔴 **别线判断绊线（no-bail 现量共三枚，见"二·补"）都是"故意逼决定的判断绊线"，不是机械改数字 —— 本线不代拍，等 owner/产品负责人**：
   - `packages/ai tests/capability-manifest.spec.ts`：断言 `coverage.denominator === 9` **且** `entityTypesWithoutTools === []`（"9/9 全覆盖"）。COMMENT 进物化清单后是第 10 枚且**无 AI 工具**。要修绿必须先决定其一：① 给 COMMENT 配 AI 工具；② 把它登记进 `DENOMINATOR_EXCLUSIONS` 并写明理由（AI 不管评论）；③ 接受分母=10 且让 COMMENT 落进 `entityTypesWithoutTools`（则"9/9 全覆盖"那句得改）。这正是该绊线设计来逼的显式承认 —— **属 AI 覆盖范围的产品判断，不代改**。
   - `packages/shared-schema tests/auth-http-contract.spec.ts:83`：`AUTH_PASSWORD_PATHS` 期望 9、实得 12（auth 线 `a63aa9e9` 加了口令路由没同步这条封闭词表）。**auth 线的判据口径，不代改**。
   - `packages/domain tests/subscription.spec.ts`：权益**拒绝理由契约**（1 failed | 1022 passed），归**计费/权益线**，不代改。
   - ⚠️ `apps/mobile`（958/958 全过、非零退）是 `RTEST-UNHANDLED-01` 那条 Rolldown 解析 Flow 的**载体抖动**，**不记产品失败、也不记本线**。
   - 🔴 **协作线自己那枚下游红（landing #7）已在本会话修绿并从交付里销账**（见"二·补"第 1 条）—— 别再把它算成别线绊线。
   - 本线已把**自己那枚代码 bug** 修掉：`parseShareJoinLink` 空 token 漏判（见 section 一）。清单也已重生成（工作树 `capability-manifest.generated.ts` 是 M，`--check` RC=0）。
   - ⇒ **本线（web/ui/sync-client/app-host/i18n + 现在连 landing 也）独立全绿**；但 `pnpm -r test` / `pnpm check` 整链被上面**三枚别线绊线** + 一枚已知载体抖动挡着，**在各归其主之前，第 2 步的"全链绿"与第 2 步末尾的 reinstall:all 都到不了**。
1. `pnpm check` 全绿（含 `check:ai-e2e` 整族 —— 注意它可能重新触发 collab-journey 那枚证据目录，别与并行 e2e 撞）。
2. `pnpm -r build` → `pnpm reinstall:all` 四端（每端判据按 AGENTS §6.1.1；会开窗口的后台跑、不抢焦点）。
3. **⑤ 文档写回**（本会话未动，仍是交接·二第 3 项那 5 处，但落点已现量收敛）：
   - `dida365-feature-benchmark.md` §2.6 第 6.1 行（❌→✅，证据：`server/src/shares/*` + `packages/ui/src/sync/SharePanel.tsx` + journey `RESULT=OK steps=3`）；同文件 §末 P2-10 那行跟着改口径。
   - `feature-matrix.md` §6 第 6.1 行（P2→已实现）。
   - `roadmap.md`：🔴 **本会话现量：§5.3 那张"按轨道下一步"表 2026-09-29 已刻意收敛**，明写"本节不复述，当前下一步只在 `multi-end-unified-strategy.md` §11 维护" —— **所以协作线不往 §5.3 塞行**（塞了反而违反那条收敛）。roadmap 这格实为 **no-op / 让位给计划文档**，别再纠结"新增一节还是并进 §5.3"。
   - `AGENTS.md` §9：加一条协作/共享线状态（带 journey/三包绿读数 + 那两枚外部绊线的边界）。
   - 本计划头部状态行：**本会话已改指交接·三**（不再是交接·二）。
   - W4 残余如实登记：评论/指派/动态 UI 未建、**共享任务写路径路由**是最大架构件。跑 `docs-link-check` 确认无死链。
   - ⚠️ **前置**：这些写回里凡"✅ 已实现/已完成"的口径，都应在**本线提交并过门禁之后**再落，否则是"代码还在工作树、文档先说完成"的假绿。当前全链被第 0 项两枚别线绊线挡着 ⇒ 文档写回与提交一起，等绊线各归其主。
4. **⑥ 一笔提交 —— ✅ 本会话已提交；push —— 🔴 受阻、已登记**：
   - **提交 = `2485edde`**（25 文件 / +856 −186），只含协作线：W6 join-link 落点（`join-link.ts` + ProjectsPanel + 其测试）、W4 所有权转让（SharePanel + server share.routes + `transfer.*` 词条中英同步）、`share-link.ts` 空 token bug + ui 判据、layering 分层（`app-host/share-key-identity.ts` 新 + barrel + `share-key-store.ts` 改指）、`check-ui-language.mjs` 补 emailPlaceholder、journey 4 条断言、`.gitignore` 加 `collab-journey-results/`、本计划。**locale 两文件已现量确认各只含协作线 5 键**。
   - 🔴 **故意没并进 `capability-manifest.generated.ts`**：重生成那份产物会**同时**带上本线 COMMENT **与** AI 工具线早已提交的 4 枚 TASK 工具（`get_task_estimate_context`/`append_task_checklist`/`set_task_priorities`/`set_task_estimate`）—— 它是**跨线混物**，按「只提交协作线文件」不并进本笔。它现在仍在工作树里是 `M`（本会话为验证 `--check` 跑过生成，但没提交）。**重生成的落地归属要单独协调**（谁补 COMMENT、谁补那 4 枚 TASK 工具、`capability-manifest.spec.ts`「分母 9→10 + entityTypesWithoutTools 出现 COMMENT」这条产品判断一并拍），别被某一条线顺手 sweep 进自己提交。
   - 🔴 **push 受阻（不是没做，是不能独做）**：本地 `main`（现 `2485edde`）**领先 `origin/main`（`6d1024bd`）41 笔**，而那 41 笔**全是别的并行线**的未公开笔（账号标准套件 / 自动收集 T8 / 产品体验 / server 错误信封 / 文档门禁 / BLOCKED 账本）。`git push origin main` 会把这些**别人只在本地的笔一起公开**到 origin/main —— 这正是「不代公开别人未提交的笔」那条红线，本线不代推。**下一个 AI 若本地 main 仍领先别线笔，push 前必须先与那几条线协调（或确认 `origin/main` 现量 tip 后再判）**；`.git/hooks/pre-push` 另指向外部 `pre-push-bytearm`（凭据下线那套），不许 `--no-verify` 绕。
   - ⇒ 本线交付形态：**代码已本地成笔、可复核可回退**；公开到 origin 这一步**押在跨线协调上**，不是本线遗漏。
5. **两停止点（B 类，等产品负责人裁决；本轮已把 ① 的证据看实）**：
   - ① **PIPL 同意弹窗（02 号图，本轮重跑后现看）—— 比"无视觉强调"更严重**：弹窗里 **确认共享 / 取消 / 不再提示** 三个可操作控件**全部渲染成裸文本行，没有任何按钮外观/勾选框外观**（对照 04 号图，那里「生成邀请」是正经蓝按钮 —— 同一 app、同一截图管线，所以不是渲染假象，是这个同意面的控件没套上按钮样式）。这是合规同意面的真缺陷，但改它=动对外法律表征的界面，**留给产品负责人拍**；我的修法建议：主 CTA 走设计系统强调（`cssVar('color.primary')` 实底按钮）、取消做次级按钮、"不再提示"改真 `<input type=checkbox>`（带 `accent-color` token，见 §7 第 83 条）。
   - ② **owner 转让语义**：已实现为两步确认、立即生效、原 owner 降 editor，确认文案 `web.share.transfer.confirmHint`（"转让后你将成为「可编辑」成员…此操作立即生效"）。追认，或改成可撤销/延时/新 owner 先接受。


### 四、给下一个 AI 的硬提醒

- **每步现量**：HEAD 在动、别线红会被别线修、生成物红可能已被人重生成 —— 本节任何"红/绿/号"都只是**本会话这一刻**的读数。
- **不得自行标 Goal complete**：关闭 goal 必须先向产品负责人逐条汇报读数并请示（记忆红线）；且用户已明确"本会话起不再触发任何需要他交付/确认的东西"——
  能自主做完的做完，需要他拍板的（第 3 步 roadmap 落点、第 5 步两停止点）**写进本节留给他醒来看**，不要弹窗、不要 AskUserQuestion。
