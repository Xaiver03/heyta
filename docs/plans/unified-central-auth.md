# heyta 统一中央认证实施计划

> 状态：**进行中**（2026-10-19）
> 决策：[ADR-0066](../adr/0066-official-central-identity-and-self-hosted-auth.md)。

## 范围与基线

用户要求官方产品统一认证；heyta 自托管可选身份方、本地优先与 E2EE 保持。
本轮隔离树分支 codex/unified-auth，基线 4ba3c6bd761cb77b52d6023371dc7abbc4df2f44。
原仓 QA 与 SEO 他人写集不带入。本轮不部署、不迁生产、不构建或安装原生壳。
取数：git rev-parse HEAD、git status --short、git worktree list --porcelain。

## 顺序与状态

| 包 | 范围 | 状态 | 放行判据 |
|---|---|---|---|
| P5.0 | 许可/标准库运行时/严格模式 | 已独立验收 | Node、ts-node、编译产物、容器实跑；配置负例；独立复审 |
| P5.1 | identity/pending/grant/outbox schema与repository | 实现与作者验证完成，待独立复审 | 真隔离PG、唯一映射/单次消费、无email自动合并 |
| P5.2 | 标准OIDC+所有签发入口+API/WS撤销 | 待实施 | 真中央HTTPS与双PG、A/B授权隔离、失败清理/迟到刷新 |
| P5.3 | 官方Web Cookie与sync/vault transport | 待实施 | 真浏览器、CSRF、无上游凭据落浏览器、E2EE/离线保持 |
| P5.4 | 原生和CLI共享handoff | 待实施 | 各端当前安装产物回跳、安全存储、重放/错绑定拒绝 |
| P5.5 | 文档、全量验收、发布准备 | 待实施 | 独立复审与当前产物；生产另走授权流程 |

## 产品登录体验约束

用户明确要求各产品保留特色登录 UI。heyta 保留既有设计语言与本地优先入口；
后续 Web 替换认证机制，中央只根据受信 client_id 登记显示产品品牌认证页，
不接受浏览器任意品牌/跳转参数，也不把 heyta 改成无品牌通用登录框。
中央品牌页由中央工作线负责，P5.0 不扩大 UI 写集。

## P5.0 精确写集

- 本计划、plans/README.md、ADR-0066、docs/README.md 登记入口。
- server/src/central-auth/config.ts 与 oidc-runtime.ts；server/src/config.ts 和 server.ts 启动接线。
- server/tests/central-auth-config.spec.ts、central-auth-runtime.spec.ts；server/scripts/verify-oidc-runtime.ts。
- server/package.json、server/package-lock.json、pnpm-lock.yaml：标准库与可复跑命令。
- THIRD_PARTY_LICENSES.md、research/licenses-inventory.generated.md、server/PROVENANCE.md、server/docs/authentication.md。

无数据库、HTTP线协议、客户端UI或原生变化。OIDC完整配置仍由启动门禁拒绝，不能让
“模式字段已新增”掩盖仍在运行的本地密码权威。

## P5.0 依赖准入证据

2026-10-19 读取 npm registry 对应精确版本 metadata 与 tarball 的 package/LICENSE.md：
openid-client 6.8.8、jose 6.2.12、oauth4webapi 3.8.8 均 MIT，均 2026-09-05 发布。
前者依赖后两者；后两者无运行时依赖。复验 npm view <包>@<版本> license time --json，
实际安装树由 node research/tools/license-inventory.mjs 与生成登记册复验。
不得使用 AGPL 内部适配或测试源码。本仓 CommonJS / Node24生产、Node22测试镜像需分别验。

## 验证台账

2026-10-19 在当前隔离树实际执行：

| 验证 | 结果 | 边界与复现 |
|---|---|---|
| 标准库运行时 | rc=0 | server 的 verify:oidc-runtime / verify:oidc-runtime:built；宿主 Node24.2.0、node:24-alpine 实际24.21.0、node:22.22.3-bookworm-slim 均通过；容器只读挂载、network none |
| 真实编译服务启动门禁 | rc=0 | 合成完整 OIDC env 下调用 dist/src/server.js 的 createServer，准确报“OIDC authentication is not available yet”，指定新 dataDir 未创建；未连接中央/数据库 |
| 定向测试 | 85/85，rc=0 | pnpm --filter @heyta/sync-server exec vitest run tests/central-auth-config.spec.ts tests/central-auth-runtime.spec.ts tests/config.spec.ts |
| 服务端及依赖构建 | rc=0 | pnpm -r --filter @heyta/sync-server... build；最终 server build 再通过 |
| 全仓类型 | rc=0 | packages 与 node-host TS 产物就绪后 pnpm -r typecheck |
| 全仓测试覆盖对账 | 有 test 的21包均有汇总，无遗漏 | pnpm -r --no-bail test 首轮19包通过、2包失败；下述两个包分别完整复跑通过；没有把原命令 rc=1 写成0 |
| Node CLI完整复跑 | 198/198，rc=0 | pnpm --filter @heyta/node-host test；首轮因 dist/cli.js 未构建失败，补建TS产物后通过 |
| Web完整复跑 | 2307通过、13跳过，rc=0 | pnpm --filter @heyta/web test；全仓并发时 task-sort 的50ms等待断言失败，单文件8/8及整包复跑通过；没有修改该测试，不能据此宣称永不波动 |
| 服务端全量 | 2874通过、1跳过 | 全仓那次 server/test 163文件通过；之后仅追加一个严格 HTTPS URL 负例，最终定向85/85覆盖该变更 |
| 许可实物清点/生成 | rc=0 | node research/tools/license-inventory.mjs；node research/tools/render-license-inventory.mjs；三项新依赖进入生成登记册 |
| 文档与补丁 | rc=0 | node research/tools/docs-link-check.mjs；pnpm check:adr-numbering；git diff --check |

初轮 typecheck 在依赖产物未就绪时出现 legal 可空类型错误；核对基线4ba3c6bd的
测试、配置、package均字节一致，补齐产物后最小与全仓检查通过，未据此改法律模块。
所有构建均为TS/网页依赖产物，无原生壳构建/安装。npm生产锁只新增标准库三项，保留
既有 Linux Argon2 libc 元数据；pnpm锁其余版本不变。

独立复审已完成：实现提交 7281d13885848cd8f5f92df049879377c608d9d5 的18路径
SHA256均一致，完整源码差异审读 High/Medium=0。独立定向85/85、服务端构建、
ts-node/编译产物实际PKCE探针均 rc=0；真实 createServer 在完整OIDC配置下拒绝启动，
且未创建data目录。复现命令同表中对应行；本机独立日志为
/tmp/heyta-p50-independent-tests.log 与 /tmp/heyta-p50-independent-build.log。
本包不代表实际 OIDC 授权成功、原生兼容或生产已切换；本阶段无真实中央请求。

## P5.1 持久化设计（实现前固定）

范围仅服务端持久层与独立加密封装，不开放OIDC启动门禁，也不接HTTP、UI或op-log。
代码完全独立按MIT标准实现；不引用内部AGPL客户端或测试。

### 身份与旧账号

新增唯一 `(issuer, subject)` 身份映射至现有 numeric User.id，同一issuer的一个本地账号
最多一个身份。首次建号由受信OIDC协调器给出已经验证的身份及邮箱，并显式收集产品条款；
邮箱冲突返回需绑定，不按邮箱查找并接管旧账号，缺邮箱返回补录，不构造假邮箱。
绑定旧账号必须有当前本地会话及新鲜本地重新认证证明，并有本次OIDC验证结果；
持久层复查同一session、tokenVersion、证明时效和待授权绑定。P5.1不提供这些证明的HTTP
签发入口，不能把“持久层接收受信输入”写成“双证明登录已交付”。不改isAdmin和旧条款。

### 授权尝试与所有权

Pending保存state与浏览器随机绑定的摘要，nonce/PKCE verifier用AES-256-GCM加密；
绑定固定issuer/client/redirect及可选旧账号证明。十分钟过期，原子消费后只产生一次attempt。
外部token请求之前必须持久记录DISPATCHED。崩溃/未知结果不得重新派发；即使租约超时也
不能把这次授权码/刷新令牌重用。网络未知必须保持UNKNOWN，后续只能核实/清理。

authorization和refresh共用持久attempt所有权台账。上游成功返回材料先落加密RESULT，
随后验证并原子应用为grant；回执丢失时查同一attempt。APPLIED是不可逆结论，下一次
refresh不能覆写前次attempt；发现旧attempt已应用，绝不能catch里撤销其材料。
没有记录也不等于失败；仅明确REJECTED或已撤销grant的结果可进入撤销队列。
HTTP协调器必须在P5.2证明token成功但验证/数据库失败、COMMIT回执丢失的实际路径。

### 会话、刷新与撤销

Grant按独立随机id和authorization attempt登记，不以中央root sid作主键；两次授权
即便sid相同仍分开。Grant与AccessSession精确对应并检查同一userId/tokenVersion；
上游AT/RT仅加密保存，AAD绑定purpose/id/version，防止跨行或跨用途替换。
刷新以grant版本和活动attempt串行；迟到结果不能越过撤销或版本边界恢复会话。

删除会话/账号前先原子落outbox、关闭grant并删会话；outbox没有指向待删除user/session的
CASCADE外键。活grant对user使用RESTRICT，未经撤销编排的销户失败关闭，避免吞掉上游
材料；P5.2须接入既有销户事务，不能把该拒绝当作已完成用户注销。
撤销队列只持内部issuer/client、授权id、加密材料和最少重试元数据；不接受动态端点。
租约和CAS确保并发worker不能互相确认；网络撤销可幂等重试，完成即清密文。

### 留存与清理

Pending有效期十分钟，消费/过期清PKCE密文；已派发UNKNOWN保留不含凭据的attempt判断，
不因清理重新可用。Grant及身份映射随用户显式注销处理，过期grant先排撤销再清理。
撤销密文最长保留七日用于重试；到期清密文并将结果标为EXPIRED_UNCONFIRMED，不能记成
“中央已撤销”，记录须由发布前运维处置并保持本地拒绝。完成/终止attempt与outbox元数据
保留24小时后可清，缺失记录永远不得授权或触发补偿撤销。P5.1提供清理方法并测边界；
P5.2接定时调度、报告未确认撤销，正式上线前不得跳过。隐私政策中英同步说明类别、用途、
密文边界与这两个期限；E2EE密钥、同步内容不进入上述表。

### 精确写集和判据

- `server/prisma/schema.prisma`：新增Identity/Pending/Attempt/Grant/Outbox及关系。
- 新迁移 `server/prisma/migrations/20261019000000_central_auth_persistence/migration.sql`；不改历史迁移。
- `server/src/central-auth/crypto.ts`、`repository.ts`。
- `server/tests/central-auth-crypto.spec.ts`、`tests/integration/central-auth-persistence.integration.spec.ts`。
- `server/scripts/prepare-central-auth-postgres.mjs`：仅本机隔离测试库，迁移走仓库脚本；
  `server/package.json` 登记 `test:integration:central-auth`，防止真库用例脱离运行通道。
- `server/PROVENANCE.md`、本计划、ADR-0066、`packages/legal/src/documents/{privacy,data-rights,personal-info-list}.ts`中英版本，
  以及 `packages/legal/tests/structure.spec.ts` 新增类别覆盖；
  `server/src/legal.generated.ts` 通过既有生成器再生，不手写第二份政策。

真PG测试覆盖唯一映射、邮箱冲突、双证明绑定条件、pending并发单次/过期/错浏览器、
共享sid的A/B独立、refresh串行/迟到/commit后回执重读、grant撤销后结果不可复活、
账号删除受限且outbox可存活、队列租约错配、加密AAD/篡改/清理期限。构建、迁移检查、
既有local认证回归与独立复审必须通过；本包仍不代表真实中央联调或生产切换。

## P5.1 作者验证（2026-10-19，独立发现已修并复验）

- 隔离真PG：`HEYTA_CENTRAL_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:32790/heyta_central_auth_test`；
  `node server/scripts/prepare-central-auth-postgres.mjs` 经仓库migrate-deploy.sh完整应用74个迁移，rc=0。
  `pnpm --filter @heyta/sync-server test:integration:central-auth`：21/21，rc=0。
  日志 `/tmp/heyta-p51-fixture.log`、`/tmp/heyta-p51-postgres-final.log`。
- local与中央定向7文件160/160，rc=0；新测试独立tsc rc=0；server build rc=0。
  日志 `/tmp/heyta-p51-regression.log`、`/tmp/heyta-p51-test-types.log`、`/tmp/heyta-p51-build.log`。
- 法律包4文件80/80，build/typecheck rc=0；legal-copy、server-legal、legal-closure-truth、
  backup-retention、迁移检查、集成用例脚本覆盖、token-minting、session-revocation、email-normalization均rc=0。
  新类别连同隐私/权利/信息清单中英同步；server法律快照用既有生成器再生。级联数由真PG
  `pg_constraint WHERE contype='f' AND confrelid='users'::regclass AND confdeltype='c'`
  的 `count(*)` 与 `count(DISTINCT conrelid)` 重算，法律结构测试亦顺序重放迁移核对。
- 全服务端首轮164文件：163通过、1失败；2880通过、1失败、1跳过，rc=1。
  唯一失败为既有大压缩snapshot用例超过自带15秒上限；测试和两条生产路由源码与P5.0基线
  SHA256一致，单文件复跑40/40、2.71秒、rc=0。没有改超时或删测试。
  证据 `/tmp/heyta-p51-server-all.log`、`/tmp/heyta-p51-compressed-baseline.json`、
  `/tmp/heyta-p51-compressed-recheck.log`；全套限制2 worker复跑164文件全部通过，2881通过、1跳过，rc=0（67.51秒），
  命令 `pnpm --filter @heyta/sync-server exec vitest run --maxWorkers=2`，日志
  `/tmp/heyta-p51-server-bounded.log`。最后补齐撤销grant元数据24小时清理，由最终真PG21条与
  server build覆盖；未把首轮全套rc=1改写为0，也不据此宣称既有大压缩用例永不波动。

独立复审发现两个期限边界，修复后主线程复验通过，剩余High/Medium为零。持久层的verified identity与fresh local proof输入仅供未来受信协调器使用，
本包没有实现HTTP的OIDC/旧账号重新认证验证，不得把真库测试称作真实中央联调。
`expiresAt` 是产品grant会话的上限，TokenMaterial自身的到期是上游访问令牌时间；P5.2须
按中央实际契约区分两者，不得把AT短期到期当成拒绝任何refresh的条件。OIDC启动门禁保持。


### P5.1 独立反例与修复

独立真PG反例 `/tmp/heyta-p51-independent-red-final.log` 发现：刷新RESULT在派发期限后、
清理运行前仍能应用；绑定旧账号的pending等候用户行锁期间过期，解锁后仍能派发。
修复在`dispatchAuthorization`的本地证明锁等待后重读数据库时钟，在`completeRefresh`
初检及用户锁等待后均检查attempt期限。过期RESULT保留持久所有权供清理，APPLIED仍可
跨期限幂等重读，不能因此补偿撤销已拥有的grant。未改迁移、HTTP、JWT或OIDC启动门禁。

- 原独立测试断言未改，专属`heyta_central_auth_review_test`：2/2，rc=0，
  `/tmp/heyta-p51-expiry-independent.log`；此为作者复跑，独立复验仍由原审阅者执行。
- 作者真PG补充“刷新等待用户锁跨期限拒绝且材料可清理”“APPLIED跨期限仍保持归属”
  两项，`test:integration:central-auth`：23/23，rc=0，`/tmp/heyta-p51-expiry-author.log`。
- 服务端build rc=0，`/tmp/heyta-p51-expiry-build.log`。

### P5.1 独立验收结果

主线程逐文件核对最终16路径SHA，阅读持久层、迁移、加密和留存契约，并复跑作者真实PG23项及
独立真实PG2项，全部通过（零跳过）。原两个失败反例在修复后转绿，未修改断言。
独立用例在 `server/tests/integration/central-auth-independent.integration.spec.ts`；
将 `HEYTA_CENTRAL_TEST_DATABASE_URL` 指向本机 `heyta_central_auth_review_test`，先运行
`node server/scripts/prepare-central-auth-postgres.mjs`，再运行
`pnpm --filter @heyta/sync-server test:integration:central-auth:review` 可复现。
日志 `/tmp/heyta-p51-independent-final.log` 与 `/tmp/heyta-p51-independent-author-regression.log`。
这是持久层候选验收，HTTP/OIDC/JWKS/原生/定时任务仍在后续包，正式OIDC启动门禁继续关闭。
