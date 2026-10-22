# Goal：共享清单（多人协作）—— 试实施（W0 + W1）

> 状态：✅ **已在 main 上并已 push**（2026-10-20 现量：`git rev-list --left-right --count refs/remotes/origin/main...main` 回 `0 0`）；这一行原先钉的「本地成笔（2026-10-11），全链门禁被别线绊线挡着、push 押在跨线协调」两半都已过期 —— 那四枚绊线各归其主已被收掉（`cd packages/{ai,shared-schema,domain} && npx vitest run` 与 `pnpm check:reachability` 现量各 rc=0）。
> 🔴 **但这条 Goal 的第 2 步"全链绿"达成 ≠ 这条线做完**：内容面**今天断成两半** ——
> 评论那条腿 2026-10-21 已接通（下行 + 游标 + 经真宿主验过），任务那条仍断（`TASK/PROJECT` 的 op 仍进个人 op-log，属 M2），
> 现状、三条产品拍板与里程碑见 [`collaboration-shared-lists.md`](collaboration-shared-lists.md) **§9**（M1 的读数在 §9.8）。下面这些历史读数保留，是为了让下一位看清当时是怎么判的，不是当前状态。 —— W0+W1 ✅ / W2 服务端核心 ✅ / W3 纯层+格式统一 ✅ / 法务 ✅ / W4 已接线、W6 已落地、journey 全绿且链接落点断言已补（`RESULT=OK steps=3`）/ **④ 门禁：`pnpm -r typecheck` 全仓绿 + 本线两枚红（`check:layering`、`check:ui-language`）当场修绿；no-bail 全量 test 已做对数审计（**条数不写在这里，会漂**；现量：逐包 `Tests` 汇总行相加，并核「有 test 脚本的包数 == 打了汇总行的包数」），本线自己那枚下游红（landing `mockup-shell-shape` #7，因 a923f7fa 给页头加了 `share-open-button`）本会话当场修绿销账；整链仍红在三枚别线判断绊线**（`packages/ai`「分母 9→10」= 给 COMMENT 配不配 AI 工具的产品判断；`shared-schema` `AUTH_PASSWORD_PATHS` 9→12 = auth 线口径；`domain subscription.spec` 权益拒绝理由契约 = 计费线，**都不代改**）+ 一枚先前登记的载体抖动（`mobile` Rolldown `RTEST-UNHANDLED-01`）本轮**不摘层重跑未复现**（958 全过、rc=0），已从本线边界里销掉；全量 test 的对数审计分母**含 `server`** —— AGENTS §6 那句"沙箱跑不了 sync-server"是瞬时属性，沿用它会把自己的分母算错（→ §7 第 408 条）/ **⑤ 文档写回已按内容复账并补齐**（benchmark §2.6 的 6.1+6.7、matrix §6（6.2/6.3 按现量更正为「已建模≠可达」）、**roadmap.md 新增 §1.3 并行轨道**、**docs/plans/README.md 索引行**、AGENTS §9、P2-10，均带边界如实登记）/ **⑥ 本线已本地提交（见交接·三），push 未独做**（本地 main 领先 origin 的笔多为别线未公开，`git push` 会一起公开）/ **停止点 ①（同意面视觉层级）已于 2026-10-12 按最佳实践落地并配 8 条判据 + 六臂变异**（见文末那一节），②（owner 转让语义）仍待产品负责人追认。逐项读数与执行序见文末「2026-10-11 交接·三」；每步现量——共享检出在动。DoD 全清单见 [collaboration-shared-lists.md](collaboration-shared-lists.md) §7。
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
  🔴 **上面那句 `--filter` 摘层的边界已被本会话自己否证**（2026-10-11 同日补测，见「交接·三」）：
  `pnpm --filter @heyta/sync-server test` **rc=0**（`Test Files 158 passed`、`Tests 2785 passed | 1 skipped`），
  走 `cd server && npx vitest run` 也是同一份读数。⇒ 那条 EPERM 只在生成物未落盘的窗口出现过，
  **这一层从来没有"跑不了"**，而我照抄了 `AGENTS.md` §6 那句旧结论，把一整层永久摘出了分母 ——
  而"20 == 20"这个审计看起来完全严谨。已入 **§7 第 408 条**，并当场改了 AGENTS §6 那句（见同节）。
  **闭合后的真审计 = 21 层跑 == 21 层打 `Tests` 汇总，差集空**（含 `server`）。
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
     🔴 **归属已现量定案（先前"COMMENT 算不算 W4 的活"存疑，现关掉）**：`git log -S "'COMMENT'"` 命中域/清单**只有 `e6058120`（产品体验线 §UX-S9-153，2026-10-09）**，本线 `a923f7fa` 没碰 `entity-types.ts`/`entities.ts` ⇒ **COMMENT 不是本线引入的，这枚 ai 红不是本线涟漪**（与 landing 那枚不同，那枚 `git log -S` 命中的是本线 `a923f7fa`）。
     而且同一枚 COMMENT 还挡了**第四道**别线红：`check:reachability`「已建模≠可达，1 个已建模实体零写路径 —— COMMENT」（`CommentThread.tsx`/`comments-model.ts` 建好并从 ui barrel 导出，但 `apps` 里**没有一处 `<CommentThread>` 挂载、没有构造 COMMENT op 的写调用点**）。这道与 ai 那枚都**已在 `BLOCKED.md` B156/B159 由别的会话登记**（明写不许用删实体/补 ACTION_FAMILIES/拿测试当调用点三种手法修绿），**本线不碰 BLOCKED、也不代拍**。
     ⇒ 修正上一小节"两枚别线绊线"的计数：`pnpm check` 实际卡在**四枚外部红**（ai-manifest + check:reachability 同源于 COMMENT/e6058120、shared-schema/auth、domain/billing）+ 一枚已知载体抖动（mobile）。
  3. `packages/shared-schema` `auth-http-contract.spec.ts`（**1 failed | 172 passed**）—— `AUTH_PASSWORD_PATHS` 9→12，**auth 线判据口径，不代改**。
  4. `packages/domain` `subscription.spec.ts`（**1 failed | 1022 passed**）—— 权益拒绝理由契约，**计费/权益线，不代改**。
  5. ⚠️ `apps/mobile`（**`Tests 958 passed (958)` 却非零退**）—— **958 条全过，红只在一条 unhandled rejection**：`RolldownError: Parse failure` 起源于 `tests/auth-flow.spec.ts`（Rolldown 解析 Flow），
     就是 AGENTS §9 记的 **`RTEST-UNHANDLED-01`**（单跑不现、共享载体上的环境抖动，**不是产品失败、也不记协作线**）。附 `[prefs] op-sqlite Cannot find module` 是沙箱里原生模块解析不到的环境噪声。
- ⇒ **协作线自己的红：landing 一枚已修绿**。整链 `-r test` / `pnpm check` 现在**只剩四枚别线判断绊线**（ai-manifest + `check:reachability` 同源 COMMENT/产品体验线 `e6058120`、shared-schema/auth、domain/billing）+ 一枚已知载体抖动（mobile），
- 🔴 **本线交付物的一键复认证（在最新 HEAD 上跑一遍，确认共享码没被别会话改坏本线）**：静态门 `pnpm check:layering check:ui-language check:design check:migrations check:adr-numbering`（各 rc=0）+ 逐包 `cd packages/{app-host,ui,sync-client,i18n} && npx vitest run`、`cd apps/landing && npx vitest run`、`cd apps/web && npx vitest run tests/share-key-store.spec.ts`（本会话 2026-10-11 全绿，条数以命令现读为准、不写死）。（注：全链 `-r test`/`pnpm check` 因上面四枚别线红仍非零退，与本线交付物是否绿是两件事。）
  **在本线之外，各归其主之前"全链绿"到不了**；reinstall:all 卡在全链绿之后，且产品负责人已明确"本会话不要再触发任何需要我交付的东西"，故不无人值守跑四端设备重装。



0. 🔴 **别线判断绊线（no-bail 现量共**四**枚，见"二·补"）都是"故意逼决定的判断绊线"，不是机械改数字 —— 本线不代拍，等 owner/产品负责人**：
   - `packages/ai tests/capability-manifest.spec.ts` + `scripts/check-reachability.mjs`：**同源于 COMMENT**（产品体验线 `e6058120` 引入的实体，不是本线）。reachability 红在"1 个已建模实体零写路径 —— COMMENT"，ai 红在"分母 9→10 + `entityTypesWithoutTools` 出现 COMMENT"。要修绿必须先决定其一：① 给 COMMENT 配 AI 工具；② 把它登记进 `DENOMINATOR_EXCLUSIONS` 并写明理由（AI 不管评论）；③ 接受分母=10 且改"9/9 全覆盖"那句。属 AI 覆盖范围的产品判断 + 评论功能是否落地，**都非本线、不代改**，且这两枚已在 `BLOCKED.md` B156/B159 由别会话登记（明写不许用删实体/补 ACTION_FAMILIES/拿测试当调用点三种手法修绿）。
   - `packages/shared-schema tests/auth-http-contract.spec.ts:83`：`AUTH_PASSWORD_PATHS` 期望 9、实得 12（auth 线 `a63aa9e9` 加了口令路由没同步这条封闭词表）。**auth 线的判据口径，不代改**。
   - `packages/domain tests/subscription.spec.ts`：权益**拒绝理由契约**（1 failed | 1022 passed），归**计费/权益线**，不代改。
   - ⚠️ `apps/mobile`（958/958 全过、非零退）是 `RTEST-UNHANDLED-01` 那条 Rolldown 解析 Flow 的**载体抖动**，**不记产品失败、也不记本线**。
   - 🔴 **协作线自己那枚下游红（landing #7）已在本会话修绿并从交付里销账**（见"二·补"第 1 条）—— 别再把它算成别线绊线。
   - 本线已把**自己那枚代码 bug** 修掉：`parseShareJoinLink` 空 token 漏判（见 section 一）。清单也已重生成（工作树 `capability-manifest.generated.ts` 是 M，`--check` RC=0）。
   - ⇒ **本线（web/ui/sync-client/app-host/i18n + 现在连 landing 也）独立全绿**；但 `pnpm -r test` / `pnpm check` 整链被上面**四枚别线绊线** + 一枚已知载体抖动挡着，**在各归其主之前，第 2 步的"全链绿"与第 2 步末尾的 reinstall:all 都到不了**。
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
   - 🔴 **push 受阻（不是没做，是不能独做）**：**别在正文写领先笔数与 SHA（会漂）**，现量：
     `git rev-list --count origin/main..HEAD`（本会话某刻读得 41→48→51→55，一路随别线本地笔增长）；远端真实 tip 用
     `timeout 12 git ls-remote origin refs/heads/main`（本会话读得仍 = `origin/main`，即别会话**没**从自己机器推过）。
     领先集**大头是别的并行线的未公开笔**。**按线现量分类**（给协调用）：
     `git --no-pager log origin/main..HEAD --format='%s' | sed -E 's/^[a-z]+[（(]([^)）]*).*/\1/' | sort | uniq -c | sort -rn`
     —— 本会话某刻读得：协作线（我）约 12–14 笔，其余散在 **账号标准套件 / 自动收集 / 产品体验线 / 四端重装 / BLOCKED 账本 / server / 文档门禁** 等 4–5 条并行线，非本线笔合计约 50。
     ⇒ `git push origin main` 会替这 ~50 笔**别人只在本地的笔**一起公开到 origin/main —— 这正是「不代公开别人未提交的笔」那条红线，本线不代推。**要落地推送，正确姿势是各线各自从自己机器 push、或产品负责人拍"整条 main 一起推"；下一 AI 别代推 —— 除非 `origin/main..HEAD` 现量只剩本线笔**；`.git/hooks/pre-push` 另指向外部 `pre-push-bytearm`（凭据下线那套），不许 `--no-verify` 绕。
   - ⇒ 本线交付形态：**代码已本地成笔、可复核可回退**；公开到 origin 这一步**押在跨线协调上**，不是本线遗漏。
5. **两停止点（B 类，等产品负责人裁决；本轮已把 ① 的证据看实）**：
   - ① **PIPL 同意弹窗（02 号图 + 本轮读 `packages/ui/src/sync/ShareConsentModal.tsx` 源码现量）**：三个可操作控件（确认共享 / 取消 / 不再询问）**都是真 `Pressable`，功能与无障碍没问题** —— `accessibilityRole="button"`（accept/cancel）/ `accessibilityRole="checkbox"` + `aria-checked`（不再询问）、各自 `onPress` + `testID`（`share-consent-accept`/`-cancel`/`-dont-ask`）齐全。**真正的缺陷是：整个 modal（外层 `View` + 三个 `Pressable`）没有任何 `style`/StyleSheet** ⇒ 渲染成一叠无按钮/勾选框外观的纯文字行（截图里那个样子）。**不是"控件坏了"，是"一个能用、可访问、但零视觉设计的同意面"。** 待产品负责人拍的仍是同一件事，但口径要准：**要不要给它套设计系统样式 + 同意面的视觉层级**（哪枚按钮做主强调、"不再询问"默认关且给真勾选框视觉），而视觉层级在 PIPL 同意面上是**防暗黑模式/合规判断**，不是纯样式偏好，故留给你；若要我改，方向是主 CTA 走 `cssVar('color.primary')` 实底按钮、取消做次级、"不再询问"补真 `<input type=checkbox>` 视觉（带 `accent-color` token，§7 第 83 条），**词条与同意语义一字不动**。
   - ② **owner 转让语义**：已实现为两步确认、立即生效、原 owner 降 editor，确认文案 `web.share.transfer.confirmHint`（"转让后你将成为「可编辑」成员…此操作立即生效"）。🔴 **本轮读服务端源码核到行为层**（不只 UI 文案）：`server/src/shares/share.routes.ts:596` 的 `POST /shares/:shareId/transfer` 把三处写包进**一个 `prisma.$transaction`** —— `share.ownerUserId`→目标、目标成员 `role:'owner'`、旧 owner 成员 `role:'editor'` ⇒ "立即生效 + 降 editor + 原子（不留双 owner/零 owner）"逐条属实；前置 `requireShareOwner`、拒转给自己、拒目标已是 owner。追认这套语义，或改成可撤销/延时/新 owner 先接受（后者要动服务端事务形状，非纯前端）。


### 四、给下一个 AI 的硬提醒

- **每步现量**：HEAD 在动、别线红会被别线修、生成物红可能已被人重生成 —— 本节任何"红/绿/号"都只是**本会话这一刻**的读数。
- **不得自行标 Goal complete**：关闭 goal 必须先向产品负责人逐条汇报读数并请示（记忆红线）；且用户已明确"本会话起不再触发任何需要他交付/确认的东西"——
  能自主做完的做完，需要他拍板的（第 3 步 roadmap 落点〔🔴 **已被「2026-10-11 交接·三」代拍并写明回退方式，不再等他**〕、第 5 步两停止点）**写进本节留给他醒来看**，不要弹窗、不要 AskUserQuestion。

---

## 2026-10-11 交接·三（同一会话续跑：第 3 步两处真缺口 + 三次"先 grep 再落笔"）

**触发**：现量发现 HEAD 动了（`git rev-list --count origin/main..HEAD` 从 65/66 变 **68**、HEAD 到 `6d657ef7`）。
按"重验只在输入真变了才跑"的口径，先查这几笔碰了什么：只有一笔，**自动收集线的 docs-only**
（`PROGRESS.md` + `docs/plans/inbound-automation.md` + 8 张 `ui-retry` 证据图）⇒
**四枚别线绊线没有被任何人修**，其中 `check:reachability` 本轮**重新实测 = rc=1**；
另外三枚按"输入有没有变"判：`git diff --name-only <上次读数那一笔>..HEAD` 里
`packages/{ai,shared-schema,domain}` **一个文件都没出现** ⇒ 它们的输入未变、无需重跑。
🟡 但 `packages/ai/src/capability-manifest.generated.ts` **当前正被别会话改着**（工作树 `M`、未提交）
⇒ 那一枚可能在别处正在收，本线不去动它（归属见上面那条「跨线混物」）。

**趁这次重量顺手把第 3 步的 5 处逐格复核了一遍，查出两处真缺口**（此前我把它当成"已完成"标过，
是**按文件而不是按内容**勾的）：

| 处 | 现量 | 处理 |
|---|---|---|
| `docs/plans/roadmap.md` | 全篇**一个协作落点都没有**（`grep '共享\|协作' ` 命中的全是 `shared-schema` 那种假命中） | 新增 **§1.3 并行轨道：共享清单协作**，格式照 §1.1（AI 线）/§1.2（激励线）——**不**把 §5.3 那条 2026-09-29 被显式收敛掉的"按轨道下一步"表长回来（那节正文写着"本节不复述"，往里加状态行等于推翻别人的收敛）。指针指向两份计划 + ADR-0062 |
| `docs/plans/README.md` 第 16 行 | 索引**存在**但状态是旧的："W0+W1+W2 ✅ ／ **W3–W6 未开工**" | 按当前事实重写该行；同时把会漂的计数（"14 端点"、"31 测试"、"40 绿"）换成**一条现量命令**，端点数量不再抄进正文 |

**"三次先 grep 再落笔"改变了要写的话**（这三条是本节真正的产出，全部记进 §7 第 407 条）：
我要往矩阵写"评论/指派/动态流 UI 未建"，动手前按四层各 grep 一次（实体在不在清单 / 组件在不在包里 /
谁 import 它 / 谁写它），结果**三条里有两条不是"没建"，是"已建模≠可达"**：

- **评论**：`packages/ui/src/sync/{comments-model.ts,CommentThread.tsx}` **已经写好并从包根导出**，
  只是 `apps/*` 与 `packages/app-host` **零引用** ⇒ 下一步是**挂载 + 补 op 构造**，
  🔴 不是"画一个评论界面"（那会造出第二份，正是 §3.5 那条"抽出来了但旧的一份没删"的镜像）。
- **指派**：`Task.assigneeUserId` 是 `packages/domain/src/entities.ts` 里的**可选字段**（注释写明语义、
  在加密 payload 内），而且**通知过滤层已经在读它**（`notification-model.ts` 的「指派给我的」那档）——
  缺的是**全仓没有一处写它**。
- **动态流**：三类活动语义只作为**通知偏好开关**存在，确实没有活动流界面（这一条原本判断正确）。

🔴 顺带照出一处**判据射程**（不是缺陷，是分母）：`check:reachability` 拿 `ENTITY_TYPES` 与物化清单对账，
只覆盖**实体** ⇒ 字段级的"建模了 / 有读取方 / 零写入方"（`assigneeUserId` 这一类）它一条都拦不到。
要把这一档钉住得先扩它的分母，那是**判据口径**，按红线归产品负责人，本线不代改。

**同一处旧话在 AGENTS §9 也修了**：那行原本写"指派 / 动态流 UI 未建"，而现量是**指派属于评论那一类**
（字段已建模、通知过滤层已在读、只缺写入者），动态流才是真没建 —— 留着就是矩阵与 §9 两套状态，
按 §8 第 8 条一起更正。

**roadmap 落点这一格不再挂回给他**：上一节把它列进"需要他拍板的"，但它是**可逆的文档结构判断**
（一笔 `git revert` 就能退），依据也现量齐了（§5.3 正文那句"本节不复述"），按"可代拍的默认值"处理 ——
**代拍：落在新增 §1.3**，并在这里标明是我拍的、回退方式是什么。他若不同意这个落点，撤那节即可，
不动其余写回。

**本轮读数**：`node research/tools/docs-link-check.mjs` rc=0（含新增的 `../research/feature-matrix.md`
与 `roadmap.md` 两条链接）；`pnpm check:adr-numbering` rc=0（本轮没引新 ADR 号）；被改的六份文件
（`AGENTS.md`、`docs/plans/roadmap.md`、`docs/plans/README.md`、`docs/plans/goal-collaboration-shared-lists.md`、
`docs/research/feature-matrix.md`、`docs/reference/environment-traps.md`）改动前逐个现量干净
（`git status --porcelain -- <各文件>` 输出为空 ⇒ 无撞车，不需要并集裁决）。

**仍然开的四格没有变化，也不在本线射程内**：`pnpm check` 整条被四枚别线绊线挡着；`reinstall:all`
要设备 + 全链绿；push 要跨线授权；①②两停止点等他醒来看第 5 步那两段（① 的口径本轮已按源码修正过，
别按"控件坏了"读）。

**补测（同一会话晚些，因为把 AGENTS §6 那句"跑不了"重量了一次）**

全量 `-r --no-bail test`（这次**不摘任何层**）：

| 格 | 读数 | 结论 |
|---|---|---|
| 对数审计 | 日志里出现过的层 **21** == 打了 `Tests` 汇总行的层 **21**，差集**空** | 闭合，且**分母含 `server`** —— 上一版"20==20"是照抄旧边界算出来的，见 §7 第 408 条 |
| `server`（`@heyta/sync-server`） | `Test Files 158 passed`、`Tests 2785 passed \| 1 skipped`，rc=0 | 那层从来没有"跑不了"；EPERM 只在生成物未落盘的窗口出现，client 已生成时 `pretest` 是 no-op |
| `apps/mobile` | `958 passed`，本轮**没有** `RTEST-UNHANDLED-01` | 之前那枚 Rolldown 载体抖动**已不在**，不再作为本线边界登记 |
| `apps/web` | 全包 `1 failed \| 2215 passed \| 13 skipped` —— 红在 `tests/task-sort.spec.tsx:253`「批量选择入口只在任务列表里出现，完成后退出选择态」，报 `expected undefined to be defined` | 🔴 **判成负载抖动，不判成本线回归**，证据三条：① 该断言在 `await setTimeout(50)` 之后读 store；② 单跑两趟 `cd apps/web && npx vitest run tests/task-sort.spec.tsx` **各 rc=0**；③ 当时 `uptime` 1 分钟负载 **46.96**（本仓阈值 12）。⇒ 记**载体无效**，不记产品失败，也不记"已验证"；本线未碰 task-sort 的任何一侧（`git status --porcelain -- apps/web/tests/task-sort.spec.tsx` 干净）。 |
| 真红三枚（不变） | `packages/ai` 2 failed / `packages/shared-schema` 1 failed / `packages/domain` 1 failed | 仍是那三枚别线判断绊线；本线不代改口径 |

🟡 `packages/ai/src/capability-manifest.generated.ts` 在工作树里**被别会话改着**（未提交），
所以 `ai` 那枚红随时可能在他们那边收掉 —— 本线不动它，也不替它写读数。

**顺手做的第 4 步文件清单逐格对账**（交接·二 §二 那份「协作线（建议单独一笔 commit）」20 条路径）：
逐条现量 = **20/20 全部 clean**，且最后动它们的笔都是协作线的
（`a923f7fa` W4 web 宿主 / `2485edde` W4-W6 接线 / `2f59b075` packages 层）⇒ 没有漏格、也没有把别线文件捎进来。
⚠️ 其中 `server/src/shares/share.routes.ts` 在交接·二 §二 被列进「并行会话的、不碰」，
而当前 Goal 原文的禁碰清单里没有它，且 W6 的转让端点本来就落在那份文件里 ⇒ 它随 `2485edde` 进了本线的笔，
这里把两种清单的差异写明，别让下一个读者以为是违规代提交。

**关于 `reinstall:all` 那一格的一条新事实**（从 `git reflog` 现量，2026-10-11）：
产品体验线那笔 `92fcff44 test(产品体验线 第 4 步收口 r93)` 的标题写着**四端一趟跑齐、图与判据同批入库**
⇒ **那条链在这台机器上是跑得通的**，本线先前把 reinstall 排后时给的"设备面 + 链是否可用"这一半前提**已被别线实测**。
🔴 但这**不等于本线的第 2 步那格可以勾掉**：AGENTS §6.1.1 要的是"**装上的是当前源码的产物**"，
他们装的那一批早于本线这一轮的文档笔与协作线全部接线笔 ⇒ 判据（各端 `远端字节 == 本地工作树`）不成立。
⇒ 剩下的真前提只有一条：**四端设备面同时空 + 产品负责人醒着**（会开窗口的验收不得抢前台，且他不希望被叫醒）。

### 五、本会话终态：可自主做的格已清空，剩下四格每一格都不在本线射程（附复量命令）

写这一节是为了让下一个会话**不必重新推导"还剩什么、归谁"**，也为了挡住一种特定的浪费：
剩下四格的重跑条件全在**别人的笔**或**产品负责人的一句话**上，照本线现在的状态再跑一遍整链只会得到同一份红集
（本轮已现量：`git diff --name-only <本线上一次读数那一笔>..HEAD -- packages/ai packages/shared-schema packages/domain e2e`
= **0 个文件** ⇒ 三枚判断绊线与 `check:reachability` 的输入没变，重跑不构成新读数）。

| 格 | 归谁 | 复量命令（输入变了才跑） | 闭合的判据 |
|---|---|---|---|
| `pnpm check` 整链绿 | 别线：AI 工具线（`packages/ai` 分母 + `capability-manifest.generated.ts` 已在他们工作树里被改）、auth 线（`AUTH_PASSWORD_PATHS` 词表）、计费线（权益拒绝理由契约）；`check:reachability` 归 COMMENT 的归属方（产品体验线） | `pnpm check 2>&1 \| sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g'` —— 先剥 ANSI 再数红（§7 第 163 条：不剥会把红报成 0 条），且**不许接 `head`**（红集要整份拿） | 那四枚红**由他们改口径**；本线代改判据口径属越界（记忆红线：判据口径永不代改） |
| `pnpm reinstall:all` 四端 | 产品负责人（设备面 + 不抢前台） | `pnpm reinstall:all` | AGENTS §6.1.1：每端一条「远端字节 == 本地工作树」，任一端红整体红、不静默跳过。链可用性已被别线 `92fcff44` 实测，缺的只是设备面同时空 |
| push 到 `origin/main` | 产品负责人 或 各线各自从自己机器推 | `git rev-list --count refs/remotes/origin/main..HEAD` 现量领先枚数，再 `git --no-pager log refs/remotes/origin/main..HEAD --format='%s' \| sed -E 's/^[a-z]+[（(]([^)）]*).*/\1/' \| sort \| uniq -c` **按线分类** | 只有当领先集里**只剩本线的笔**，或他明确说"整条 main 一起推"，才动。不 force、不 `--no-verify`（pre-push 有外部 bytearm） |
| 停止点 ②（owner 转让语义） | 产品负责人（改语义要动服务端事务形状） | 读第 5 步那两段 + `server/src/shares/share.routes.ts` 的 `transfer` 事务 | 追认现语义（两步确认、立即生效、原 owner 降 editor、三写同事务）或改可撤销/延时/先接受。⚠️ **① 已从这张表划掉**：2026-10-12 产品负责人授权后按最佳实践落地，见文末「2026-10-12」那一节 |

🔴 **给下一个 AI 的一条**：这四格里**没有一格是"本线忘了做"**。把任何一格重新登记成待办去推动，
就等于让这条线再排一次已经在别人手里的队 —— 想动之前先跑上面那列命令，看输入是不是真变了。

## 2026-10-12（停止点 ① 按最佳实践落地：同意面不再等权）

触发是产品负责人一句「你来按照最佳实践来排版，并且改掉就行」⇒ ① 从"待拍"变成本线的实施项。
**②（owner 转让语义）仍在他的格子里**，本轮没碰服务端。

**改了什么**（`packages/ui/src/sync/ShareConsentModal.tsx`；行为与状态机零改动，只多一个可选 prop `titleHidden`）：

| 面 | 之前 | 现在 | 依据 |
|---|---|---|---|
| 主按钮「确认共享」 | 与取消同权重（无底色） | 实心 `color.primary` + `on-primary` 文字，按压走 `color.primary-active` | 同层 `AuthForm.primary` / `primaryPressed` 那一套（不新造一套按钮语言） |
| 取消 | 同上 | 文字按钮，**没有**底色声明 | 同意面里"拒绝"不该长得像第二个主操作 |
| 三行同意范围 | 三行裸文本带 `·` | 一块 `surface-sunken` 披露面，逐条一行、正文级字号 | 它是同意的**内容**，不该比说明文字小一档 |
| 「不再提示」 | 只有文字 | `size.checkbox` 方框 + 选中态实心主蓝 + `Check` 图标 + 平铺 `aria-checked` | 状态不靠单一颜色承载（WCAG 1.4.1） |
| 标题 | 与宿主对话框 `<h2>` 同文重复（中：共享清单／共享清单；英：Share list／Shared list） | 宿主传 `titleHidden` ⇒ 同屏只出现一次 | 一屏两个同名标题等于没有标题 |
| 命中区 | 无 `minHeight` | 两颗按钮与勾选行都吃 `touch-target.min`（44） | AGENTS §5 可访问性下限 |

**刻意没做的一件事，带读数**：披露面**不描边**。`color.border-subtle` 在亮色档与 `surface-sunken` 是**同一枚** slate-100（比 1.0），换成 `color.border`（slate-200）也只有 **1.13** ⇒ 画上去是一道看不见的线，比不画更容易被读成"渲染坏了"。这块面靠底色凹陷与外部分隔。

**对比度**（两档 × 五对，按 WCAG 公式对**实际解析出的十六进制**现算，不是引用文档里那句"4.5:1"）：
亮 16.3 / 7.58 / 5.17 / 17.85 / 4.34（项目符号按图形 3.0 判）；暗 17.62 / 11.21 / 7.93 / 15.2 / 7.53
⇒ 全部过 AA（正文 4.5、图形 3.0）。

**判据**：新增 `apps/web/tests/share-consent-modal-theme.spec.tsx` 8 条（暗 5 + 亮 1 + 标题 2）。
六臂变异逐臂读数：A 取消也画实心→2 红；B 主按钮换一枚蓝→2 红；C 披露面退平→1 红；D 摘掉 `titleHidden`→1 红；
E 勾选后不切实心→1 红；F 主按钮文字配对坏→1 红。还原后**两层各验一次**：源码 `cmp` 与备份相同，
产物指纹按**形状**取（不是按标识符）：
`grep -c 'style: \[styles2\.checkbox, dontAskAgain ? styles2\.checkboxOn : null\]' packages/ui/dist/index.js` = 1、
`grep -c 'style: \[styles2\.checkbox, null\]'` = 0。
🔴 这一节原来写的产物指纹是 `grep -c 'styles2.checkboxOn : null'` = 3，**那枚是坏尺**（10-12 用它误报过一次红）：
`styles2` 是 bundler 给 `styles` 改的局部名，同一份产物里另外两个组件的勾选框也叫这个名字，
那个"3"数的是三个不相干的地方 ⇒ 详见 §7 第 **410** 条的改口段。
⚠️ 为什么这里不用 `getComputedStyle`、为什么只认 `r-` 原子类、为什么按 `border-color` 读永远是空
→ §7 第 **411** 条（三个都是本轮实测，每一个的症状都是"用例红了而产品是对的"）。

**e2e 侧也钉了一层**：`e2e/tests/collab-journey.spec.ts` 在点确认之前，让浏览器自己算一次
"确认按钮的计算底色 == 页面 `--ht-color-primary`、取消 != 它"。判的是**不等权**，不是"有没有 class"。

**暗色为什么没有截图**：旅程里试过补一张 —— `emulateMedia({ colorScheme: 'dark' })` 之后截出来与亮色
**md5 逐字节相同**（→ §7 第 **409** 条）。web 的暗色开关只改 `<html data-theme>`，而共享层的颜色来自开机时
解析完的那张表；要真变暗必须重载，而重载会打断这条旅程的解锁态。所以暗色由上面那棵树**在暗色 token 表下渲染**来判。

**读数**：`packages/ui` 44 文件 / 665 通过 rc=0；`apps/web` 全套 174 文件 / 2230 通过 / 13 跳过 rc=0；
`pnpm verify:collab-journey` `RESULT=OK steps=3` rc=0，02 号图**人打开看过**（同屏只有一处「共享清单」标题、
主按钮实心蓝、勾选框是看得见的空方框）；静态门 `check:design` / `check:ui-language` / `check:layering` /
`check:rn-aria` / `check:tokens` 各 rc=0。

🔴 **一枚别线红灯如实记，不代改**：`pnpm --filter @heyta/ui --filter @heyta/web typecheck` rc=2，
唯一错误在 `apps/web/tests/inbound-panel-layout.spec.tsx:66`
（函数签名写 `HTMLElement | undefined`，返回处 `as HTMLElement | null`）。
**⚠️ 这一格 10-12 现量过两次，形状变了要跟着改**：写本段时它是**未跟踪**文件（`??`，自动收集线在途夹具）；
他们随后把它提交进 `c099afe6`，我再量**仍然 rc=2** ⇒ 现在它是 **main 上一枚已提交的红灯**，
不再是"别人工作树里的半成品"。现量命令：
`pnpm --filter @heyta/ui --filter @heyta/web typecheck`（错误行号会随他们的修改移动，别按本段号找）。
⇒ 本线四份文件（组件 / 宿主 / 新用例 / 旅程）在同一趟 tsc 里零错误，但**全仓 typecheck 这一格不算绿**。

**本轮之后仍然开着的**：② owner 转让语义追认；四端重装（等四端设备面同时空 + 他不被叫醒）；
`pnpm check` 整链仍挡在那四枚别线绊线上。

### 我那一笔提交的越界与还原（`6cd953cb` → `1a8de6fd`）

`6cd953cb` 的 `--stat` 里有两行不是本线的：`BLOCKED.md -10`、`PROGRESS.md -42`。
成因不在我写了什么，在**共享索引**：自动收集线用自己的 plumbing 落台账时只移了 ref、没刷索引，
于是索引里躺着他们两份文档的旧版；我随后一次裸 `git commit`（提交整份索引）把那份旧版提交了，
读起来就是"本线把那两条线的刚发布的复账删了"。`BLOCKED.md` 还在任务书的"不碰"清单上 ——
**我没碰过它的工作树，一次 `git add` 都没写**，但它出现在我的 commit 里，责任是我的收尾动作。

还原（一笔前向修复 `1a8de6fd`，不改写历史、不 force、不越 hook）：

| 前置现量 | 读数 |
|---|---|
| `git log --oneline 6cd953cb..HEAD -- BLOCKED.md` | 空 ⇒ 那一枚 blob 里只有我那一刀，整枚换回不盖别人 |
| `git diff 6cd953cb~1 HEAD -- BLOCKED.md` | 恰好那 10 行 ⇒ 换 blob == 只反向我自己 |
| 还原后 `git diff 6cd953cb~1 HEAD -- BLOCKED.md` | 空；`git show HEAD:BLOCKED.md \| grep -c 复账（本会话）` = 1 |
| `PROGRESS.md` 那 42 行 | 已由其所有者在 `c099afe6` 自己提交回来 ⇒ 本笔不涉及 |

🔴 **收尾的第二半才是这次的新内容**：我这一笔也是 plumbing，它自己会留下**新的**索引残留。
做完 `git update-index --cacheinfo` 后必须读到 `git status --porcelain -- BLOCKED.md` = ` M`（不是 `MM`）
且 `git diff --cached HEAD --name-only` 为空 —— 少了这一步，下一位裸 commit 会把我的修复再退回去一次，
而那时"谁删的"已经查不到了。完整机制与三方归属写在 §7 第 **88** 条的第二次实证里（同类事故扩充原条，不另开号）。

**由此固定下来的本线提交动作**：共享检出里提交一律 `git commit -- <自己的路径>` 或 plumbing + 刷索引，
不再用裸 `git commit`；提交后必查 `git show --stat <新> --` 的路径集是否**恰好**等于本线清单。

### 10-12 01:0x 复量（HEAD 又动了三笔，旧读数不能沿用；这一节只登记"现在还挡着什么"）

四枚绊线**逐条重取**，形状与 10-11 一致、条数有变（写在这里的是这一趟的读数，下一趟必须重跑）：

| 那一格 | 现量命令 | 这一趟读数 |
|---|---|---|
| `packages/ai` 分母判断 | `pnpm --filter @heyta/ai test` | rc=1，**2 failed / 263 passed**（10-11 是 5 failed ⇒ 别线自己补掉 3 条，剩下 2 条就是"COMMENT 配不配 AI 工具"那一句） |
| 已建模≠可达 | `pnpm check:reachability` | rc=1，仍是 COMMENT 零写路径（与上一格同源） |
| 口令路径封闭词表 | `pnpm --filter @heyta/shared-schema test` | rc=1，`expected […] to have a length of 9 but got 12` |
| 权益拒绝理由契约 | `pnpm --filter @heyta/domain test` | rc=1，`subscription.spec > every denial reason we know about exists on the server` |

**本线五道静态门在新 HEAD 逐条 rc=0**（`check:design` / `check:layering` / `check:ui-language` / `check:rn-aria` / `check:tokens`）。

🔴 **`pnpm reinstall:all` 这一格现在不能起，且不是"等负责人"，是等设备面**：01:0x 现量
`xcrun simctl list devices booted` 有 **两台** iOS 模拟器在跑（`heyta-ios-isolated17` +
`heyta-iphone-17pro`）、`adb devices` 有 `emulator-5554 device`，一分钟负载 12.62（本仓阈值 12）。
那条流程会 `simctl uninstall` + 卸旧装新，**正在别的会话的在途验收上踩过去**（AGENTS §8 第 9 条
"共享资源独占验收"）。设备面空出来之后现量这四条读数再起，别照本节推断"现在可以跑"。

### 10-12 第二次复量（HEAD 之后又落 17 笔；上一节那张表已经作废，以本节为准）

四枚绊线**少了一枚**，另一枚换了位置 —— 这就是"每次现量"的实际成本，也是别把条数写进正文的理由：

| 那一格 | 这一趟 | 归谁 |
|---|---|---|
| `packages/domain` 权益拒绝理由契约 | ✅ **rc=0，1023 全过** —— 由自动收集线 `f2a94651` 修掉（它把并进订阅读取词表的 8 枚自动收集拒绝理由拆回自己那张表，那条漂移守卫当场复绿） | 已闭，不再挂在本线边界上 |
| `packages/shared-schema` 口令路径封闭词表 | ❌ 仍 1 failed / 172 passed | auth 线 |
| `packages/ai` 分母 + `check:reachability` | ❌ 仍 2 failed / 263 passed；reachability 仍 rc=1（断言 B：已建模实体必须在 app-host 有写路径 —— COMMENT） | 同源于产品体验线 `e6058120` 引入的 COMMENT，两格一起 |
| `-r typecheck` | ❌ 仍 rc=2，**但错误换了文件**：`apps/web/src/features/shell/RailNavigation.tsx:109` TS2783 `'tabIndex' is specified more than once` | 产品体验线（`59c23f40` 那一族的在途文件） |

🔴 **`RailNavigation.tsx` 那一处为什么不代改（三条代改条件第二条不成立，写清楚免得下一位顺手"修绿"）**：
`git status --porcelain` 现量该文件是 **`M`（别人正在写）**；而且这不是可证无害的删除 ——
那行 `tabIndex={roving ? 0 : -1}` 后面紧跟 `{...sortableAttributes}`，dnd-kit 的属性里**也带 `tabIndex`**，
所以"谁生效"由**展开顺序**决定：删掉前面那行 = 键盘漫游焦点（roving tabindex）交给拖拽库，是**改行为**不是改类型。
运行时形状不等于改前 ⇒ 按任务书"撞车文件登记不硬改"处理。

**本线交付物在 17 笔之后重新认证过**（判据不变、结果不变）：五道静态门 `check:design` / `check:layering` /
`check:ui-language` / `check:rn-aria` / `check:tokens` 各 rc=0；`packages/ui` 665 全过；
`apps/web` 本线两份用例 18 全过（同意面 8 + 密钥信封 10）；
`apps/landing` 1409 全过 —— 也就是 `a923f7fa` 欠的那枚页头对账锚点**没有被别人刚改的窄屏导航碰坏**。

## 2026-10-22 交接·四（M5 已上线；任务书第 2 步只剩四端重装那一格，卡在设备面）

### 落地的这些笔（**数目不钉在这里，会漂**；逐笔现量用 `git show --stat <sha>`）

> ⚠️ 别用 `git log --grep '协作'` 当这张表的全集 —— 实测它**抓不到** subject 里没有"协作"二字的 `15ac92f2c fix(收尾装置)` 与 `9fdd2db28 docs(路线图)`，
> 却会**多抓**一笔 ¥12 档的台账（`04fe42898`，正文里出现过那个词）。按 subject 关键词取集合 = 两头都错。
> 远端对账判据：`git rev-list --left-right --count refs/remotes/origin/main...main`（2026-10-22 01:00 现量 `0 0`）。

| 笔 | 内容 |
|---|---|
| `feat(协作·M5-ab)` | `sync-client` 认下 `new_share_ops` + `app-host/share-signals.ts`（信号→拉一次→判该不该吵，四条纪律）+ `sync-wiring` 的可选 `onNewShareOps` + `ui` 的 `selectNotifiedActivities` |
| `feat(协作·M5-c)` | web 接线：根组件注册消费者、评论区**撤掉每 5 秒兜底轮询**、通知按偏好投；两枚 locale 各只落 `common.share.activity.*` 两行 |
| `test(协作·M5)` | `verify:collab-sync` 第 11 步（真 WS 扇出 + 真宿主 + 作者那一台零活动） |
| `docs(协作·M5)` | 计划 §9.1/§9.3/§9.10、progress-log 删两条过期抄件、traps #519–#521 |
| `fix(收尾装置)` | `reinstall-all.sh` 两行 `$VAR（` 补花括号（本仓门禁自己的处方；提交信息里带了一条**否证**：本机 bash 3.2 下两种写法输出逐字相同，所以这格修的是"门禁红"不是"已发生的丢值"） |
| `docs(路线图)`（同日晚间，`9fdd2db28`） | `roadmap.md` 那节 W4 残余与"尚未 push"两句都被现量否证 ⇒ 改口（评论那一米已接上 = 宿主 `share-comments.ts` + `apps/web` 挂载 + `verify:collab-sync` `steps=11`；push 状态换成一条**可复跑**的 `git rev-list` 判据而不是一句当时的话） |

### 第 2 步的门禁读数（都是 2026-10-21 深夜在本棵树上现量）

`pnpm -r typecheck` rc=0；`pnpm --filter '!@heyta/sync-server' -r test` rc=0（分母对账：有 `test` 脚本的包数 == 打 `Tests` 汇总行的包数）；
`pnpm -r build` rc=0；`pnpm verify:collab-sync` ⇒ `RESULT=OK steps=11` rc=0；`pnpm verify:collab-journey` ⇒ `RESULT=OK steps=3` rc=0。
> 📌 顺带销一格旧账：交接·二/三那两批把 `check:reachability` 的"断言 B ⇒ `COMMENT` 已建模零写路径"记成本线的绊线。
> 2026-10-22 01:3x 现量它 **rc=0**（`✅ COMMENT 1 处：packages/app-host/src/comment-actions.ts`）—— 那一米 M1/M5 接上之后它就不再红了。
> 同一句话还留在两处别人的台账里（traps §7 第 407 条那张表的「现量」列、`remote-linux-host-and-disk-reclaim.md` §那张归属表），
> 两处都已按"这句话现在不成立 + 现量命令"改口，别让人照它等。

`pnpm check` 那一条 `&&` 链**现量 122 段**（分母现取：`node -e 'console.log(require("./package.json").scripts.check.split(" && ").length)'`），
它在第 21 段 fail-fast，所以"这条链红"不等于"后面都红"——把第 21 段之后的 101 段逐段单跑，红四格，**逐格归因**：
> 🔁 **2026-10-22 01:0x 复量**（本线那笔路线图改口落进 `main` 之后又跑了一遍这四格）：**归属一格没变**。
> 现量：`check:selection-single-source` / `check:image-license` / `check:text-color` 各 rc=1；
> 前两格的输入文件（`apps/web/src/features/subscription/RenewPanel.tsx`、`apps/mobile/src/screens/RenewSection.tsx`、
> `server/package.json`、`server/package-lock.json`）对 HEAD **干净** ⇒ 是**已入库的别线状态**，不是谁在飞；
> `check:text-color` 那一枚 `packages/ui/src/ai/AiGeneratedLabel.tsx` 仍 `M`（AI 线在写）。
> 本线不代改、不放宽，也不把它们算成自己的边界。
> ⚠️ **第四格 `check:ai-e2e` 这一趟的复量没有取到，且拿不到**：起跑时它的 preflight 回「✅ 4318 / 4319 都是空的」，
> 我就当这台机没人 —— **那是把"端口空"读成"独占"，同一族的在册教训见 §7 #329**（名字里带 lock 的装置只承诺"等"，不承诺"占"）。
> 跑到第 69 行时 `ps` 现量到并行线正在跑 `scripts/verify-mobile-ios-renew-sellable.sh`（两枚 PID，44 秒 / 1 秒）⇒
> 这一发的红（`account-email-change-and-sessions`、`admin-console` 两组，单发 17s 上下的**超时形状**）**不可归因**，
> 我按"不作证据"处理：停掉自己那一发、没有把它写成读数，也没据此改动任何判据。停完复量族谱：登记过的 7 枚 PID 全 `GONE`、4318/4319 无监听（这次 `TaskStop` 确实把子树带走了，不是只退包装 —— 但仍要这样复验）。
> ⇒ **下一位要取这一格，先 `ps -eo pid,etime,command | grep -E 'verify-mobile|reinstall-all|playwright'` 确认没人**，
> 别只看 preflight 那句端口空。

| 段 | 形状 | 归属与依据 |
|---|---|---|
| `check:selection-single-source` | 断言 G 命中 `RenewPanel.tsx` / `RenewSection.tsx` 的 `tierId` | ¥12 档线；两枚文件对 HEAD 干净，本线一个字节没碰 |
| `check:image-license` | 镜像 npm 树快照三处失真 | **HEAD 内部**：快照末笔 `d0bd83b36`（10-17）晚于 `server/package-lock.json` 末笔 `7281d1388`（10-19），两枚工作树都干净 ⇒ 门自己给的情形 ②，修法要点 `pnpm verify:selfhost-stack`（打镜像），归自托管分发线 |
| `check:text-color` | `packages/ui/src/ai/AiGeneratedLabel.tsx:81` | AI 线**正在写**（`git status` 该文件 `M`）⇒ 别人的在飞 hunk，登记不代改 |
| `check:ai-e2e` | rc=160，脚本自己判「这一轮 **作废**，签名 `net::ERR_CONNECTION_REFUSED`」 | **载体**，不是产品：跑时 4318 拒连；跑后现量 4318/4319 都不在听、当时那枚 PID 已消失 ⇒ 那是本轮自带的临时 dev server。同棵树相邻两段 e2e（`privacy-consent-e2e`、`landing-e2e`）当轮 rc=0，`-r test` 也 rc=0 |

⚠️ 这一趟我自己造了三枚假绿并写成了陷阱 **#522**（分段跑链的装置：`mapfile` 在 bash 3.2 不存在、分界变量没 `export` ⇒ 段表空而循环零次仍退 0；`… | tail -4; echo $?` 读的是 `tail`；改标签时把执行那一行一起替换掉 ⇒ 每格都 rc=0）。
**改完"能失败的装置"，判据是它能不能红，不是它跑过一次。**

### 🔴 四端重装这一格：**没跑**，整轮被就绪裁判判在门外（不是静默跳过）

`bash research/tools/b-reinstall-readiness.sh`（仓里那道默认 dry-run 的就绪裁判）现量 **exit 3，两条前置不成立**：

1. 「目标树里有 **179 枚未提交的打包输入**」—— 是 AI 线正在写的 `apps/*/src` 与 `packages/*`，装进四端就是别人的半成品。
   门自己给的解法是 `CARRIER=<干净载体>`（隔离检出从 HEAD 打包），**这一条已经解掉了**：
   载体 `~/heyta-carriers/heyta-wt-collab-m5`（`git worktree add --detach … HEAD`，`pnpm install` 4.7s 装完，
   软链指本树 —— 反查 `readlink <载体>/apps/web/node_modules/@heyta/domain`），
   对着它复量就绪裁判 ⇒ `✅ 目标树…没有未提交改动` ＋ `✅ 载体新鲜：… == 主检出 HEAD`。
2. 「Android 段目标 `emulator-5554` 不可达；当前 adb 在线设备：一个都没有」—— 本线 AVD 是 `heyta-w3-yearly`，
   裁判明文「环境准备**不在本脚本里代跑**（起 qemu 会把负载顶上去，别人的 adb 因此超时）」，而 AGENTS §6.1 的新规是**别在这台 Mac 上起模拟器**。
   ⇒ 这一条**归人**：要么起那台 AVD，要么给一台 adb 可达的设备。
   按 §6.1.1 那条「缺一端设备就别装其余三端（四端不同代比整轮没跑更难收拾）」，**没有**用 `--only` 先装 mac/windows/ios 三端。
3. 复量时还多了一条会自己消的：`❌ 负载 37 > 12`（同一趟早些时候主检出处是 7.95 —— 那 37 里有我这趟建载体与并发验收造成的份额）。
   **负载这一格按"等几分钟"排队，不登记成阻塞**（见记忆里那条"窗口按分钟级开合"）。
   ⇒ **它确实自己消了**：2026-10-22 01:00 复量同一道裁判回 `✅ 负载 6 ≤ 12`。**这一格不是阻塞，别为它等人**；
   现在只剩上面第 2 格（设备面）一项前置不成立，裁判仍 exit 3。
4. 复量时载体那一条换了形状：裁判报「载体停在 `5ab3dbff3`，主检出 HEAD 是更新的笔 —— 落后 2 个提交 / 超前 0 个，
   但**打包输入面逐字相同**（全仓差 5 个文件，都在非输入面：docs/research/台账）⇒ 产物同形，本腿判绿」。
   ⇒ 记下来免得下一位照旧话先 `checkout` 一遍：**载体不要求逐提交追平，只要求打包输入面一致**；
   真正要追平的判据是 `git diff --name-only <载体sha> <main sha>` 里有没有 `apps/ packages/ server/ e2e/` 这些输入面路径。
   ⚠️ **但它会随并线的代码笔重新开**：01:2x 并线落了一笔 `test(¥12 档)`，改到 `package.json` 与 `scripts/` ⇒ 裁判立刻翻成
   `❌ 打包输入面差 3 个文件`。这一格**归我自己**，不用等人：`git -C <载体> checkout --detach <main sha>` →
   比 `pnpm-lock.yaml` 的 sha256（相同就直接沿用载体里那份 `node_modules`，别重装）→ 在载体里 `pnpm -r build`（本次 rc=0）→
   复量裁判回 `✅ 载体新鲜：… == 主检出 HEAD`。**做完之后现量只剩"设备面"这一格不成立**，其余五项全 ✅（负载 9 ≤ 12、无脏打包输入、无软链 node_modules、没有别的 `reinstall-all` 在跑）。

其余现场读数（同一趟）：没有别的 `reinstall-all` 在跑；没有 `verify-mobile-*` 在跑；`notarytool` 空；
已启动模拟器**恰好一台** `heyta-iphone-17pro`；`ssh windows-pc` 回 `SSHECHO=OK`；数据卷余量 68Gi。

**下一位照这两行点火**（先起 AVD，再让就绪裁判自己点头 —— 它的 `--confirm` 分支只在全绿时才执行；
裁判只认 `CARRIER=` 这个**环境变量**，写成参数会被判「未知参数」退 1）：

```bash
/opt/homebrew/share/android-commandlinetools/emulator/emulator -avd heyta-w3-yearly -no-snapshot-save >/dev/null 2>&1 &
CARRIER=$HOME/heyta-carriers/heyta-wt-collab-m5 bash research/tools/b-reinstall-readiness.sh          # 全绿才继续
CARRIER=$HOME/heyta-carriers/heyta-wt-collab-m5 bash research/tools/b-reinstall-readiness.sh --confirm # 点火
```
⚠️ 点火前若 main 已经前进，先把载体追平（`git -C <载体> checkout --detach <main sha>`）；
`pnpm-lock.yaml` 的 sha256 逐字相同就可以直接沿用载体里那份 `node_modules`（不同就别软链过来，让它自己装）。

### 🔴 停止点 ①（PIPL 同意面视觉）—— 这一条的前提**已被源码与判据否证，不该再拿去问负责人**

任务书与交接·三都写着「主按钮『确认共享』无视觉强调、『不再询问』勾选无可见位（词条存在但视觉层级待追认）」。
2026-10-22 01:2x 现量三处，那句**不成立**（它是 2026-10-11 视觉层级定稿**之前**那张 02 号图的形状）：

| 层 | 现量 |
|---|---|
| 组件 | `packages/ui/src/sync/ShareConsentModal.tsx`：确认那颗是实心 `color.primary`（`styles.primary` + `primaryPressed`），取消走 `ghost` 文字按钮；勾选框有 `size.checkbox` 的方框、选中态实色 + `Check` 图标，`aria-checked` 与图标同时携带状态 |
| 常驻判据 | `apps/web/tests/share-consent-modal-theme.spec.tsx` 当场跑 ⇒ **8 passed / rc=0**。它不吃快照：拿 RNW 挂在节点上的**原子类**去样式表里取那枚 `background-color`（文件头记着第一版按 `classList` 顺序扫会先撞上复位基底类、六条全红的教训），亮色档与暗色档各一组；其中一枚的用例标题写着它防的是哪一版（把样式整块删回去 = 2026-10-11 之前那一版 ⇒ 这条该红）。⚠️ **那是在册的失法说明，不是我这一趟执行过的变异臂** —— 本轮只跑了"它现在过"这一臂 |
| 运行时腿 | `e2e/tests/collab-journey.spec.ts` 在真浏览器里取两颗按钮的底色与主蓝比对（`bg('share-consent-accept')`）—— 今天这一趟 `verify:collab-journey` 回 `RESULT=OK steps=3`，就是这条腿过了 |

⇒ 这一格**不再是待追认**：能做的那半早已落地且有牙。留给负责人的只剩一句**口味级确认**（"就按现在这版"），
不该再让他去修一个不存在缺陷。②（owner 转让语义）仍是待追认，那格是真的没人在语义层点过头。

### 🔴 停止点 ②（owner 转让语义）—— 那四句事实**逐句回源码核过，全部成立**，但核的过程中翻出一格真缺陷

| 句子 | 现量 |
|---|---|
| 两步确认 | `packages/ui/src/sync/SharePanel.tsx`：第一下 `setTransferArmed(memberId)` 只把那一行展开成确认块（`share-transfer-confirm-*` 里有「确认转让」与「取消」），第二下才调 `onTransferOwnership` |
| 立即生效 | `POST /shares/:shareId/transfer` 一次请求里 `$transaction` 改三处（`share.ownerUserId` + 新 owner 角色 + 旧 owner 降 `editor`），没有"对方接受"那一环；确认文案自己就写着「此操作立即生效」 |
| 原 owner 降 editor | 同一枚事务里 `data: { role: 'editor' }`，回包里 `demotedRole: 'editor'` |
| 文案键 | `web.share.transfer.confirmHint` 在 `zh-CN` / `en` 两枚 locale 都在，且 `ShareFeature.tsx` 的 labels 真在取它（不是写了没人读的键） |

⚠️ 但同一条路由**没校验接收方手里有没有钥** ⇒ 记成 **§6 B-10**（转让后可能造出"解不开自己清单的 owner"，而补发信封是 owner 专属，客户端无人能修）。
那格是本线的、不需要新 ADR，但改的是"谁能被转让"这条对外资格 ⇒ 按今晚的排序登记 + 给出验收形状，**没有**混在重装前顺手改。

### `check:ai-e2e` 那一格：读到第 82/395 行就停 —— 红全点名到别线，但**本线那一半没进分母**

（标题这么写是因为它容易被读歪：这一趟**不是**"红不可归因"，红每一枚都有 spec 文件名；**不可用的是"本线在这条链上到底怎么样"这一格** —— 跑到停为止本线的 spec 一条都没被执行。）

前一次整机空闲重跑（`/tmp/rl-22/ai-e2e-clean.log`；再前一次被并行会话中途起的 `verify-mobile-ios-renew-sellable.sh` 污染、已作废，形状见 §7 第 329 条）。这一趟读完后的判断是**它给不出可用读数**：

| 观察 | 现量（对着 `/tmp/rl-22/ai-e2e-clean.log` 复量：`grep -cE '[[:space:]]✘' 日志`） |
|---|---|
| 结果面 | 到停为止 **82 行结果：30 绿 / 52 红**（红含 `retry #1` 各占一行 ⇒ **这里不给"唯一用例数"**：去重口径要再解释一遍，不如留下按 spec 归并那张表） |
| 红按 spec 归并 | `admin-console` 18 行 / `account-email-change-and-sessions` 14 / `auth-consent-registration` 10 / `ai-row-layout` 4 / `ai-tool-run` 4 / `assistant-hosted-ux` 2 ⇒ **6 枚 spec，没有一枚是本线的** |
| 🔴 红的**两种形状要分开说**（别一句"都是超时"糊过去） | 慢失败（16.8s–1.0m，首发与 retry 同值）：`admin-console`、`auth-*`、`ai-*`、`assistant-hosted-ux`；但 `account-email-change-and-sessions` 那 14 行是 **2.5–3.0s 的快失败 = 真断言红**，不是机器慢。本线不替别线把每一行归因到具体成因，只登记这个区分 —— 把整族写成"环境拖慢"就是假归因 |
| 推进速率 | 约 10 分钟走 10 行 ≈ **1 行/分钟** ⇒ 395 项按这个速率要跑数小时，继续等只是多攒几摞同样形状的读数 |
| 停之后 | `TaskStop` 只退包装 ⇒ 按 PID 逐个复量：`ps -o pid=,lstart= -p 87026,87132,87283,87440` 回空、`lsof -nP -iTCP:4318 -iTCP:4319 -sTCP:LISTEN` 回空 ⇒ 端口已释放、本会话起的残留进程为零 |

🔴 **别把这张表读成"本线在这条链上无红"**：`e2e/tests/collab-*.spec.ts` 按文件序排在 `auth-*` 之后，这一趟**根本没跑到** ⇒ 本线那几枚 spec 没进分母。这条链要真给本线销账，得有人一次跑完；本轮只能落"这 82 行里的红没有一行属于本线"这一句，分母就是那 82 行。

### 顺带把旧口径那一族的最后一处活句子改掉（AGENTS §9 的标题）

`docs/agents/progress-log.md` 那一节的**标题**到本轮还写着「本地成笔、全链门禁被别线绊线挡着」（2026-10-11）。它和它自己正文里那条 `git rev-list` 现量互相打脸 —— 属于上一轮"COMMENT 零写路径"那一族（同一个结论有好几种句子形状）。现量这一族还剩哪些形状：
`grep -rn "本地成笔\|push 押在跨线协调\|绊线挡着" docs/plans docs/agents docs/research/*.md README.md` ⇒ 剩下的命中全在**带日期的交接记录**里（交接·三那几段），那是刻意保留的当时状态，不动；活口径只剩标题那一处，本轮改成"已进 `main` 并已 push；只剩四端重装那一格"，并把停止点 ② 那句"语义已定案"旁边补上 **B-10** 的限定（**语义已定 ≠ 这条路径是对的**）。

### 本轮收口读数（01:5x，全部串行走完，不与那条 e2e 链并发）

| 项 | 读数 |
|---|---|
| 文档门（六条，一次一条） | `check:md-tables` / `check:docs` / `check:doc-citations` / `check:doc-command-claims` / `check:docs-voice` / `node research/tools/docs-link-check.mjs` ⇒ **各 rc=0**（日志 `/tmp/rl-22/gate-*.out`） |
| 提交与推送 | 本线那一笔只带本线三个 `.md`（`git commit -F - -- <三路径>`）⇒ push 前现量领先集 `git rev-list --count refs/remotes/origin/main..HEAD` = **1 笔、且那一笔是本线的**（不是替别线公开）⇒ `git push origin HEAD:main` rc=0（pre-push 的字节臂过：射程内 1 笔 / diff 51 行 / 在册值 21 枚 ⇒ 0 命中）⇒ 复量 `git rev-list --left-right --count refs/remotes/origin/main...main` 回 **`0 0`** |
| `pnpm -r build` 这一格为什么还作数 | 那一笔的 `git show --stat` 只有三份 `.md` ⇒ **打包输入面零变化**，所以"载体里那次 rc=0"对当前 main 仍成立；载体随后被追平到本线那笔并**重跑过 `pnpm -r build` ⇒ rc=0**（`/tmp/rl-22/carrier-build.out`） |
| 载体前置（本轮做完） | `git -C <载体> status --porcelain` 空 ⇒ `checkout --detach <main sha>` 追平；`pnpm-lock.yaml` 的 sha256 与主检出**逐字相同**（对账命令：`shasum -a 256 <载体>/pnpm-lock.yaml pnpm-lock.yaml \| awk '{print $1}' \| sort -u \| wc -l` 回 `1`）⇒ 沿用载体里那份 `node_modules`，没有软链 |
| 就绪裁判（复量两趟） | 追平前 rc=3、4 项不成立；追平+重打后 rc=3、**只剩设备两格**：`⚠️ 0 台已启动模拟器且没传 IOS_DEVICE_NAME` + `❌ emulator-5554 不可达（adb 在线设备一个都没有）`。负载 7 ≤ 12、无并发 reinstall、目标树干净 —— 全绿只差设备 |

🔴 **剩下这一格不是"等人有空"，是一条规则冲突，要产品负责人拍**（本线不自决）：
`docs/agents/multi-end-build.md` §6.1 那条 2026-10-04 拍板写着「不要再在这台 Mac 上起新的 Gradle 构建或**模拟器**」（理由是资源：headless 模拟器 3.6G+ 常驻 / 90% CPU）；
而同一条 §6.1 的边界又写着「Windows 侧没有 Android 模拟器，所以**设备侧验收目前仍在 Mac**」，且本线那枚就绪裁判自己就把起 AVD 的那一行打印出来当作开窗条件（它明写"环境准备不在本脚本里代跑"）。
⇒ 这两句在"四端重装要在这台 Mac 上跑完"这件事上互相拉着。本线按红线停在这里：**判据与拍板口径不代改、那条禁令不自取例外**。
可拍的两条路：① 给一次**单动作授权**（只允许 `emulator -avd heyta-w3-yearly -no-snapshot-save &` 这一发，随后由裁判 `--confirm` 点火，仍不动 Gradle 通道）；② 判定本轮四端重装不适用（本线这一轮改动面是服务端 + Web + 文档，移动端那一节评论区本来就还没挂 —— 但注意 `packages/ui`、`app-host`、`sync-client` 都被移动端消费，"输入没变"这句并不成立）。

### 本线两条常驻判据在**当前 HEAD** 上复量（02:0x，因为账上先前那批读数是对着旧 HEAD 量的）

main 在推送之后又被别线推进（`git rev-parse --short HEAD` 现量，本线射程内 `packages/{ui,app-host,sync-client}`、`server/src/shares`、`apps/web/src`、`e2e/tests` 在那几笔里 **零改动**：`git diff --stat <上一笔>..HEAD -- <那些路径>` 回空）。仍按"读数只对当刻 HEAD 成立"这条纪律重跑一遍：

| 腿 | 读数 |
|---|---|
| `pnpm verify:collab-journey` | `RESULT=OK steps=3`、rc=0（复量就是这一行命令，别去指本轮的临时日志 —— 那类件住 `/tmp`，重启就没） |
| `pnpm verify:collab-sync` | `RESULT=OK steps=11`、rc=0 |
| 新截图人工看过 | `e2e/collab-journey-results/04-owner-invite-ticket.png`：入群链接那一栏逐字是 `http://127.0.0.1:4327/?shareToken=<同一枚凭证>`，与上方"邀请凭证"栏**同一串**（这正是第 1 步钉进判据的那格，图与断言两头都对得上）；`02-owner-consent-modal.png` 见下。⚠️ 那批图**不进仓**（现量：`git ls-files e2e/collab-journey-results` 回 0 枚），换台机器照上面那行命令跑一遍就重新落出来 —— 别去仓库里找它们 |

⚠️ 顺带把**停止点 ① 的口味确认**从"读源码"升级成"看图"：`02-owner-consent-modal.png` 这一张是刚跑出来的，画的是三行同意范围做成一块凹陷披露面、"不再提示"带一枚**看得见的空方框**、"取消"是纯文字、"确认共享"是实心主蓝 —— 任务书那句"主按钮无视觉强调、勾选无可见位"在这张图上**逐字不成立**。递给负责人时该给这张，别再给 10-11 那张旧 02 号图。

### 🔴 本线最后那几笔停在本地没推 —— 领先集里有一枚别线的未公开笔

复量：`git --no-pager log --oneline refs/remotes/origin/main..HEAD` 现量到两枚，一枚是本线的复量入账，另一枚是
**¥12 档那一线的文档笔**（本仓所有笔的 `%an` 都是同一个人，**认归属只能看提交信息的前缀**：那一枚是 `docs(¥12 档·台账 194 追)`）。
裸 `git push origin HEAD:main` 会替他们把那笔一起公开到 origin/main。
「不代公开别人只在本地的笔」这条红线在前的授权是**按次**的（上一趟"整条 main 推"不自动覆盖这一趟），所以本线**停在这里**：
本地那几枚安全、可复核、可回退，等负责人一句话就推（推之前重复量同一行命令，确认领先集形状没再变）。

### 第 2 步的门禁链：在**一枚干净提交**上把 122 段逐段量完（先前那趟是在 195 枚在途改动的工作树上读的，归不到提交）

主检出此刻有 **195 枚在途改动**（现量 `git status --porcelain | grep -v '^??' | wc -l`，全是别线在写的），所以"在那棵树上跑链"拿到的红**分不清是提交还是半成品**。改成在隔离载体（追平到 `c1e26febc`、工作树干净、`pnpm-lock.yaml` sha 与主检出逐字相同）上跑：

| 段 | 读数 |
|---|---|
| `pnpm -r typecheck` | **rc=0**（20 个包打了 typecheck 段） |
| `pnpm -r --no-bail test` | **rc=0**、**14180 条用例 0 失败**；对数闭合：**有 test 脚本的包 21 == 打 `Tests` 汇总行的包 21**（`comm -23` 取差集为空）。⚠️ 先前那趟"沙箱跑不了 prisma generate ⇒ `--filter '!@heyta/sync-server'"` 分母只有 20"那道边界**这一趟不成立** —— 载体里 prisma client 已生成，`server` 自己也跑了 |
| `pnpm check`（122 段，`&&` 链，第 22 段短路） | 逐段续跑 23–122（把链按 `&&` 切开逐条 `sh -c`、只剔 `check:ai-e2e`）⇒ **120 段绿、2 段真红、4 段是载体特有** |

🔴 **两枚真红都不是本线的，且各自门里就写着修法**（本线不代改别线判据）：

- **第 22 段 `check:selection-single-source`** —— ¥12 档：`apps/web/src/features/subscription/RenewPanel.tsx` 与 `apps/mobile/src/screens/RenewSection.tsx` 各有一处本地 `…Id` `useState`（`tierId`）没做语义登记。门自己给的两条出路：要么它判的是"当前看的是哪一条"⇒ 那是第二个选中所有者，改用 `@heyta/app-host` 的 selection；要么属五类瞬态之一 ⇒ 进 `ROW_ID_EXEMPT` 登记一行并写明哪一类。
- **第 45 段 `check:image-license`** —— 自托管线：`server/package-lock.json` 与在册快照的 `packageLockSha256` 分家。门自己分两种情形并给了对应命令（只有锁变了 ⇒ 重跑 `node research/tools/gen-image-npm-tree.mjs`；装法变了 ⇒ 得重新生成锁再更新 `IMAGE_ONLY_PACKAGES`）。**这一枚在主检出上复现同 rc=1，且那两份文件都没在途改动** ⇒ 是提交态的既有红，不是谁写一半。

**四枚"红"是载体的形状，不是产品的形状**（逐枚拿回主检出重量，全 rc=0）：`check:licenses`、`check:privacy-consent-e2e`、`check:landing-e2e` 红在**载体的 `e2e` 独立工作区没装**（门的原文就是"node_modules missing"，它拒绝少算所以不出数），`check:vault-diagnostics` 同样只在载体里红。
⇒ 记一条给下一位：**这枚载体要当全链裁判用，得先 `cd e2e && pnpm install`**（`pnpm reinstall:all` 不读那棵树，所以重装那一趟不受它影响）。

`check:ai-e2e` 那一枚仍按上面那格的有界分母入账（82/395 行、红全在别线 6 枚 spec、本线 spec 未进分母），不重复跑。

### 下一步
计划 §9.10 末节：**M2**（共享任务/清单的写路径路由 —— 要先立一份新 ADR），其后 M4 → M6。
~~🔴 排在 M2 之前先做 §6 B-10~~ ⇒ **2026-10-22 04:1x 已做完**，读数写在下面那一节。
本线在任务书里的五步只剩上面那一格重装；**Goal 没有自标完成**（关闭要先向产品负责人逐条汇报并请示）。

### 2026-10-22 04:1x · §6 B-10 落地（转让接收方的密钥资格门）
一句话：**转让那一步从前不看接手人手里有没有钥，现在两半都看** —— 服务端对不合格目标回一枚具名 409
`SHARE_TRANSFER_TARGET_UNSEALED`，成员面板对不合格成员**不给那颗按钮**、只给一句既有的「等待所有者授权」
（复用词条 `common.share.member.waitingForEnvelope`，所以**没有动 `packages/i18n`**）。
改动面：`server/src/shares/share.routes.ts`（判据放在自查与"目标已是 owner"之后、`$transaction` 之前 ⇒ 被拒时一处都不写）、
`packages/sync-client/src/share-api-client.ts`（错误码镜像）、`packages/ui/src/sync/share-model.ts`
（新导出 `memberCanHoldOwnership`：`hasEnvelope && keyEpochLag === 0`，面板与判据共用同一枚谓词）、`packages/ui/src/sync/SharePanel.tsx`。

判据与归因（都在主检出同一棵树量的，未提交的别线 WIP 也在树里 ⇒ 逐条只看与本格相关的那几条）：
`cd server && npx vitest run tests/share-routes.spec.ts` ⇒ `Tests 35 passed (35)`，转让那一组由 5 条到 7 条；
`cd packages/ui && npx vitest run` ⇒ `46 files / 686 passed`；`cd packages/sync-client && npx vitest run` ⇒ `12 files / 165 passed`；
`cd apps/web && npx vitest run tests/share-panel-transfer.spec.tsx` ⇒ `10 passed`（原 7 + 新 3），
`cd apps/web && npx vitest run` ⇒ `187 files passed / 2 skipped，2371 passed | 13 skipped`；
类型：`pnpm --filter @heyta/ui --filter @heyta/sync-client --filter @heyta/web --filter @heyta/sync-server typecheck` ⇒ rc=0、`error TS` 0 条，
但**`@heyta/sync-server` 没有 `typecheck` 脚本**（现量 `node -e "console.log(require('./server/package.json').scripts.typecheck)"` ⇒ `NONE`）
⇒ 服务端那格的类型靠 `cd server && npx tsc --noEmit -p tsconfig.json`（rc=0、0 条错）单独补量，别把"四包 typecheck 绿"读成"服务端被覆盖到了"。
变异台架（每条臂都要能红）：服务端拆掉信封那半 ⇒ 只红「世代对齐但手里没有信封」；拆掉世代那半 ⇒ 只红「有信封但世代落后」；
面板把 `canTransfer` 钉成恒真并重打 `pnpm --filter @heyta/ui build` ⇒ 新 3 条一起红、原 7 条照绿。
三处还原后 `shasum -a 256` 与变异前逐字节相同（`server/src/shares/share.routes.ts`、`packages/ui/src/sync/share-model.ts`、`packages/ui/src/sync/SharePanel.tsx`）。

🔴 **落地前必须先量的一格**：这道门会不会把转让变成永远按不到？现量答案是不会 ——
`apps/web/src/features/share/ShareFeature.tsx` 里 owner 侧的 `autoSeal` 在面板挂载期间随 3s 轮询给不合格成员补封信封，
而 `PUT /shares/:shareId/members/:memberId/envelope` 把 `memberKeyEpoch` 写成与 `Share.keyEpoch` 同一个号 ⇒ owner 开过面板之后接手人必然合格。
剩下的真窗口（owner 从没打开面板／不在线／保险库锁着）那一格按设计给提示不给按钮。
未做的一条尾巴：`SHARE_TRANSFER_TARGET_UNSEALED` 在宿主侧**没有文案映射**（全仓只有 sync-client 那枚镜像表消费错误码），
面板数据过期那一瞬走 409 时用户看到通用失败 ⇒ 挂到 M4。

**常驻变异装置**：上面那些"拆一半只红对应那一条"不再靠手工 —— `node research/tools/mutation-rigs/mutate-collab-transfer-gate.mjs`
把这四臂钉成红集精确匹配（条数 + 缺席 + 多红三条都过），已在 `research/tools/mutation-rigs/README.md` 登记。
本机首跑读数：`GUARD ✅ 4 臂的 needle 各命中 1 次，且 3 枚目标文件相对 HEAD 干净` ⇒ 三份基线 `35/17/10 passed` ⇒
`[unsealed-ignored] 红 1/1`、`[epoch-ignored] 红 1/1`、`[predicate-drops-envelope] 红 1/1`、`[panel-always-eligible] 红 3/3` ⇒
三趟 RECHECK 全 `md5=byte-identical` ⇒ `ARMS=pass (4/4)`，rc=0。
⚠️ 这台装置本身踩了一枚新坑并登记为环境陷阱 **#525**：分段写文件把第一段的尾巴覆盖了，顶层少一行常量，
`node --check` 全绿而一实跑就 `ReferenceError`，而当时 README 已经替它声称"这四臂能红"——顺序应是先跑通一趟再写在册行。

**改完面板渲染条件之后，两条常驻链在本棵树上复跑**（B-10 动的是成员面板那一块 DOM，所以这两趟是必须的回归，不是例行）：
`pnpm verify:collab-journey` ⇒ `RESULT=OK steps=3`，rc=0（这条链不碰转让那一步，现量 `grep -c transfer e2e/tests/collab-journey.spec.ts` ⇒ 0，
所以"所有权转让 ✅"从来不是它证的 —— 它证的是邀请凭证 + 链接落点 + 入群）。
`pnpm verify:collab-sync` ⇒ `RESULT=OK steps=11`，rc=0，其中
**STEP 4「信封下发 + bob 解出清单密钥（与 owner 一致）」正是上面那道资格门"不是永久挡路"的现成证据** ——
它是生产路径（不是夹具）：新成员入群后由 owner 侧把当前世代信封发下去，随后 STEP 9 的 rekey 才把世代推进、
并把被移除者留在门外。也就是说：**合格态是流程会自动到达的那一档，不合格态是"owner 还没开过面板"这一档**，
面板在那一档只给提示不给按钮，与 STEP 4 之后的行为不矛盾。

**B-10 之后把任务书第 2 步那几趟重跑了一遍**（改的是产品代码不是文档，旧读数不能沿用）：
`pnpm -r test` ⇒ rc=0、`Scope: 21 of 22 workspace projects`、21 枚包各打出一条 `Tests … passed`、
非零 `failed` 行 0 条、合计 **14220 passed**。**对数怎么算才算对**：盘上有 `test` 脚本的包 22 枚，差的那一枚是 `e2e` ——
它是一棵独立工作区，`pnpm -r` 根本不 traverse（与载体那枚坑 **#523** 同一个根因），
所以合法说法是 **21 == 21**，`e2e` 那一格由上面那两条常驻链覆盖；
别把分母写成 22 再留一句"e2e 没跑"当边界，那会把一条结构性边界读成一次漏跑。
`pnpm -r build` ⇒ rc=0、输出里 `error`/`failed` 0 行（`apps/desktop` 那条 manualChunks 是**警告**，不是红）。
`pnpm check` 那 122 段链仍是**两枚别线红**：在 tip `a6662e218` 上逐枚复量 `pnpm check:selection-single-source` rc=1、
`pnpm check:image-license` rc=1，两者相关文件无在途改动 ⇒ 全绿这一格不归本线，也不由我放宽。
`pnpm reinstall:all` 仍停在停止点 ③（Android 设备腿的载体口径冲突，两条路见上面那节）。

**2026-10-22 04:2x 重装预检复量（只读，不动产物）**：`CARRIER=~/heyta-carriers/heyta-wt-collab-m5 sh research/tools/b-reinstall-readiness.sh`
⇒ exit 3、**前置从 4 项降到 3 项**。我做掉的那一项：载体原来停在 `c1e26febc`，**打包输入面差 9 个文件**
（正是 B-10 那 8 枚 + 别线动过的两枚 locale），按 §7 第 178 条那一族"装出来的是旧提交"，所以
`git checkout --detach` 追到本线 tip（载体当时逐格干净，`status --porcelain` 回 0 行）。
复量结果：载体与主检出**打包输入面逐字相同**（全仓差 2 个文件，都在非输入面的 `docs/research/台账` ⇒ 那一腿自己判绿，不拦）。
剩下唯一拦路的是 **Android 段没有可达设备**（`adb` 在线设备一个都没有，本线 AVD = `heyta-w3-yearly`），
而预检脚本明确**不代起 emulator**（起 qemu 会把负载顶上去、别人的 adb 因此超时）——
这一格与 `docs/agents/multi-end-build.md` §6.1 那句"出包走 windows-pc、设备侧验收目前仍在 Mac"是同一处口径冲突，
归产品负责人拍。拍之前我不硬装（§6.1.1：环境原因如实报红）。

⚠️ 上面那句「剩下唯一拦路的是 Android」是把 **3 项前置读成了 1 项**：同一次 exit 3 里还有负载与 iOS 目标名两格，我当时没把它们写下来（那两格现在还在，见 10:2x 那一节的逐项清单）。这一条属于"瞬时读数被写成状态"那一族，预检脚本自己打的是 `note` 清单，逐项抄才靠得住。

**2026-10-22 10:2x 复量（tip `2bf6eadcb`）**：本线产品代码自 `bbcdc1ace` 之后没再动，其后落进 `main` 的别线提交
`git diff --name-only 915a54252..HEAD` 现量只有 `PROGRESS.md` 与 `docs/plans/subscription-handoff.md` 两枚、
命中 `^(apps|packages|server|e2e)/` 的**打包输入面文件 0 枚** ⇒ 跑在 `915a54252` 上的那几趟仍归得到当前提交。

- `pnpm -r typecheck` ⇒ **rc=0**、`Scope: 21 of 22 workspace projects`。先把这句 scope 拆开再对数（现量 `pnpm list -r --depth -1 --parseable | wc -l` = **22** = 21 枚 `@heyta/*` + 根包 `heyta`；
  `e2e` 压根不在 pnpm 这份清单里 —— 它是另一棵工作区，即 **#523** 那个根因；而 `-r run` 默认不含根包 ⇒ scope 那 21 枚是命名包）。
  对数按 **#524⑵** 那把尺走**同一条构造式**：从各 `package.json` 现取"有 `typecheck` 脚本"= 21 枚（含根包），
  与 scope 求交 ⇒ 应打 **20** 行（差的那一枚是 `@heyta/sync-server`，它压根没有该脚本），实打 **20** 行，两侧差分均为空 —— 这一族见 **#526**。
  🔴 `sync-server` 那一格不由"链子绿"覆盖：它没有 `typecheck` 脚本，`pnpm -r typecheck` 对它一句话都不说，
  所以我另跑 `cd server && npx tsc --noEmit -p tsconfig.json` ⇒ **rc=0**，并把这条命令写进台账，
  别让下一个会话把 21 枚 in-scope 读成 21 枚被检查过。
- `pnpm check` 那两枚别线红在新 tip 逐枚复量：`check:selection-single-source` **rc=1**、`check:image-license` **rc=1**。
  归因现量：相关文件对 HEAD 全部干净 —— `RenewPanel.tsx` 末笔 `81d4a7044`（10-21 收银台给两档）、
  `RenewSection.tsx` 末笔 `3fa210c5e`（10-22 未登录不静默）、门本体 `scripts/check-selection-single-source.mjs` 末笔 `057ca068a`（10-18）
  ⇒ 提交态既有红，不是谁写一半，也不是我碰出来的。
  断言 G 那一枚的语义我读完了：两处 `tierId` 各自只服务一件事 —— 决定**这一单下哪一档**
  （`apps/web/src/features/subscription/RenewPanel.tsx:127` 与 `apps/mobile/src/screens/RenewSection.tsx:90` 都是
  `priceId: CHECKOUT_TIER_PRICE_IDS[tierId]`），屏上没有"当前看的是哪一条"那种行列表 ⇒ 按门自己给的第二条出路，
  它属五类瞬态里的 `form-draft`，最小修法是往 `ROW_ID_EXEMPT` 补两行（文件名 + `'tierId'` + `'form-draft'`）。
  **我没有代它登记**：那张豁免表能豁免什么，就是这枚门的判据口径；代改别人的口径会把我线的判断写进别人线的裁判里。
  所以任务书第 2 步那句"`pnpm check` 全绿"到这一格的诚实读数是：**两枚别线存量红，本线不代改、不放宽**（交回内容见上）。
- `pnpm reinstall:all` 预检（`CARRIER=~/heyta-carriers/heyta-wt-collab-m5 sh research/tools/b-reinstall-readiness.sh`）
  ⇒ **exit 3、三项前置不成立**，逐项抄脚本自己的输出：
  ① **负载 28 > 12**；② **iOS 段：0 台已启动模拟器且没传 `IOS_DEVICE_NAME`**（脚本"不猜目标"，因为它下一步就是 `simctl uninstall`）；
  ③ **Android 段：`adb` 在线设备一个都没有**（本线 AVD = `heyta-w3-yearly`）。载体那一格这次也报"落后 3 枚提交、
  差异只在非输入面（产物同形，不拦）"⇒ 那一腿判绿，不挡。
  ① 归因：`pgrep -fl heyta` 回 **0** —— 这负载不是本仓任何一趟跑出来的；短窗/长窗 `30.50 / 28.69 ≈ 1.06` ⇒ 常驻底噪不是突发，
  `ps -Ao pcpu,comm -r` 第一名是一枚 Xcode 自带的 Python 占满一核。**"等它落回 12"不是等谁交活，是等一个外来进程自己安静**，
  所以我不守它，也不给它降门槛。②③ 两格脚本都明确不代起设备 ⇒ 起不起 iOS 模拟器 / Android AVD 就是停止点 ③，归产品负责人拍；
  拍之前我不硬装（§6.1.1：环境原因如实报红）。
- 远端对账：`git rev-list --left-right --count refs/remotes/origin/main...main` ⇒ **`0 0`**，本线已入库的东西都在公开那侧。
  载体那一格我在 10:3x 已经先**替下一次点火铺平**（这一步不需要任何人点头）：
  `git -C ~/heyta-carriers/heyta-wt-collab-m5 checkout --detach <main sha>` 追到本线 tip，追之前 `status --porcelain` 回 0 行，
  追之后仍 0 行；`pnpm-lock.yaml` 的 sha256 两侧**逐字相同**（`6e609a8b…` 前缀一致，全量比在两处各取一次）⇒ 载体里那份 `node_modules` 可以沿用。
  复量预检 ⇒ 载体新鲜那一格从"落后 3 枚、差异只在非输入面"变成 **`✅ 载体新鲜：<sha> == 主检出 HEAD`**，
  而 exit 仍是 3、拦路的仍是那三格（负载 23 > 12、iOS 0 台已启动模拟器、Android 0 枚在线设备）。
  ⇒ 也就是说：**"设备点头"一到，这一趟不需要再补任何准备工作**，直接 `CARRIER=$HOME/heyta-carriers/heyta-wt-collab-m5 bash research/tools/b-reinstall-readiness.sh --confirm` 点火。

### 2026-10-22 10:3x · 第 1 步的字面落点**其实欠了一半**，补上并做两头对照

复审计务第 1 步那句原文（「断言 `[data-testid="share-invite-link"]` 文本含 `http://127.0.0.1:${WEB_PORT}` 且含 `shareToken=`」）时，
现读 `e2e/tests/collab-journey.spec.ts` 发现**只有后半句在**：`toContain('shareToken=')` 加三条 origin 级断言
（落点等于应用页自身的源、不等于同步服务器、链接里的 token 与展示的凭证同一枚）。
前半句没有任何东西在钉 —— 那个端口号只被 `e2e/playwright.collab.config.ts` 当 `baseURL` 消费，**spec 从不读它**；
"有一个消费者"不等于"那句要求有判据"（环境陷阱 **#527**）。
补法：`expect(inviteLink).toContain(WEB_URL)`，靶子取 `HEYTA_COLLAB_WEB_URL`（验收脚本本来就注入它），缺省值与脚本逐字一致，
并在加载期 fail-fast 校验靶子形状 —— 靶子若是空串，`toContain('')` 对任何链接都成立，那是一条永远通过的判据。

**两头对照（顺序是刻意的：负在前，绿在后，因为这一趟会重刷证据目录）**：
- 负臂（临时把靶子换成 `http://127.0.0.1:1`）⇒ `RESULT=FAIL step=2`、rc=1，失败原文里读到真链接
  `http://127.0.0.1:4327/?shareToken=<一枚一次性凭证，不入库>` ⇒ **这条断言能红**。
- 正臂（改回注入的那个靶子）⇒ `RESULT=OK steps=3`、rc=0、`STEP 3 OK 证据齐（8 张）`。
- 新截图人工看过：`e2e/collab-journey-results/04-owner-invite-ticket.png`（10:38:49 那一枚）屏上逐字是
  「入群链接」下方 `http://127.0.0.1:4327/?shareToken=…`，且那串 token 与上方「邀请凭证（只显示这一次）」逐字相同；
  成员区那行写 `成员 618 · 所有者（我）`。

🔴 **同时更正本文件先前那一格的口径**：第 1 步记成"已完成"时，我把 origin 等价断言当成了任务书那句字面要求的兑现。
两者覆盖不同 —— origin 那三条比的是"页面自身的源"，**对端口号本身不敏感**（换一枚端口它照样绿），
而任务书要的那半句钉的正是"落点等于这台实例上应用的那个 loopback 地址"。现在两半各有一条能红的判据。
改的是 `e2e/tests/*.spec.ts`，所以把**会解析 spec 文本的静态门**复跑了一遍（不是"应该不受影响"，是量过）：
`check:locator-labels`／`check:journey-coverage`／`check:integration-coverage`／`check:gate-wiring` 四枚各 **rc=0**。
其中 `locator-labels` 是这趟真该问的一枚：新断言的 message 是一行中文，而那道门的分母就是"含汉字的字符串字面量"、不区分定位符与日志行（环境陷阱 **#429**）。
再核一件事，免得下一位以为漏跑：改的是 `e2e/` 那棵**独立工作区**，它压根不在 `pnpm -r test` 的分母里（**#523** 同一根因），
所以这一趟的复跑口径就是 `verify:collab-journey` 本身（上面那两趟），不是"再跑一遍全仓测试"。
