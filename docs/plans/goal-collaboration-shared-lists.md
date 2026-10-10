# Goal：共享清单（多人协作）—— 试实施（W0 + W1）

> 状态：🔄 **进行中（Goal 模式已启用，2026-10-08）** —— W0+W1 ✅ 完成（见下）；**W2 服务端核心 ✅ 完成（本节下方）**；W2 余项（法务第一批、app-host share-client）与 W3–W6 未开工。DoD 全清单见 [collaboration-shared-lists.md](collaboration-shared-lists.md) §7。
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
