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
| P5.1 | identity/pending/grant/outbox schema与repository | 已独立验收并交付 `0c361789` | 真隔离PG、唯一映射/单次消费、无email自动合并 |
| P5.2A | 标准OIDC传输与材料持久边界 | 已独立验收 | 真中央HTTPS与双PG、标准验签、单次派发、先持久后验证 |
| P5.2B1 | 事务唯一签发、live/refresh/退出销户与worker底座 | 已独立验收 | 真实PG+TLS反例、实际中央联调、local回归 |
| P5.2B2 | 所有签发入口与API/WS/runtime接线 | 待实施 | 缓存前中央live、已连接WS撤销、定时清理生命周期 |
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


## P5.2A 标准协议边界

本包只实现服务端受信协调器接口，不提供浏览器HTTP入口，不签发产品JWT、不应用attempt，
不开放OIDC启动门禁。普通SSO接受已有中央会话的真实auth_time；旧账号绑定发起login与
max_age=0，并核验签名auth_time不早于本次pending，不用iat冒充重新认证时间。

- `createCentralOidcClient` 固定配置与发现metadata的精确issuer；授权、token、userinfo、
  introspection、revocation、JWKS均为同源HTTPS、无用户信息/query/fragment。
  每次实际出站再次约束端点和method、拒绝重定向。只接受ES256并显式启用标准库
  `enableNonRepudiationChecks`。每次兑换/刷新独立Configuration和捕获器，禁止跨账号共享。
- `begin` 持久state/browser绑定、nonce与S256；`exchange` 在请求上游前原子消费pending；
  `refresh` 只能领取repository里的grant与subject。单次attempt最多一次token POST，任何
  网络/响应/数据库回执未知均不得重派。repository仅新增startedAt/subject两个返回投影。
- token响应最多64 KiB，单token最多16 KiB；提取到的可撤销材料先await recordResult，之后
  才交标准库验签和claims。坏签名、错误HTTP状态仍保留材料；坏JSON/无法完整读取的响应
  保持派发未知。COMMIT回执丢失或总期限15秒到达都不在catch中撤销；晚提交仍归同一attempt。
- 内省严格检查active/client_id/sub/Bearer/exp；中央AT是opaque身份凭据且未声明资源aud，
  不从client登记字段猜aud。现有严格配置没有可选resource audience；以后若引入必须另行
  显式契约与验证。userinfo仅返回绑定sub和已验证邮箱，不按email自动关联旧账号。
  refresh允许无ID；存在ID时照常验签并绑定原subject。
- `introspect`、`userInfo`、`revoke` 仅供后续服务端协调器调用，不能直接挂浏览器可传任意
  token的路由。错误只返回固定代码，不反射SDK cause、响应正文或凭据。

测试由独立MIT HTTPS fixture与真PG验证；临时CA由openssl生成，子进程仅通过
NODE_EXTRA_CA_CERTS信任该CA，不关闭TLS验证，不读取.env。真实中央服务由独立runner动态
调用外部identity-server启动/fixture导出，双PG隔离，未复制AGPL实现或测试源码。

可复现入口：先将HEYTA_CENTRAL_TEST_DATABASE_URL设为本机独立的
`heyta_central_auth_oidc_test`并运行 `node server/scripts/prepare-central-auth-postgres.mjs`；
`pnpm --filter @heyta/sync-server test:integration:central-oidc`。
真实中央联调另需HEYTA_CENTRAL_SERVER_ROOT指向中央源码根和OIDC_TEST_DATABASE_URL
指向该服务校验允许的本机测试库；先server build，再运行
`pnpm --filter @heyta/sync-server test:integration:central-oidc:http`。
两命令按顺序运行，禁止共享同一测试库并发清理。

P5.2B仍须接入issueSession唯一铸造口、现存登录旁路、缓存命中前central live校验、
已连接WebSocket撤销、各退出范围、销户同事务outbox、定时清理与EXPIRED_UNCONFIRMED报告。
本包协议通过不能代替这些产品闭环，也不代表原生、Web UI或生产认证切换。


### P5.2A 作者验收（2026-10-19）

Node22.22.3，隔离heyta_central_auth_oidc_test通过仓migrate-deploy完整应用74迁移。
首轮在迁移尚未结束时误启动测试而失败；等待完整成功后重新执行，未改迁移或降低断言。
独立fixture最初未按OAuth规则解码Basic中的百分号字符，修正测试协议实现；适配器按
标准库GET userinfo传入的null body修正空体兼容。最初integration覆盖门禁要求package
命令直接点名文件，已让TLS runner接收该显式路径，未豁免门禁。

| 项目 | 实测结果 | 复现/证据 |
|---|---|---|
| HTTPS协议与真PG | 46/46，rc=0 | test:integration:central-oidc；/tmp/heyta-p52a-protocol-registered.log |
| 实际中央服务HTTPS与双PG | 11条判据，rc=0 | test:integration:central-oidc:http；/tmp/heyta-p52a-central-http-registered.log |
| 既有持久层 | 23/23，rc=0 | test:integration:central-auth；/tmp/heyta-p52a-persistence-regression.log |
| local/配置/运行时/密码/缓存/会话 | 8文件160/160，rc=0 | /tmp/heyta-p52a-local-regression-final.log |
| 服务端构建与新测试独立类型检查 | 均rc=0 | /tmp/heyta-p52a-build-final.log、/tmp/heyta-p52a-test-types.log |
| 文档链接、集成脚本覆盖、唯一签发与会话撤销门禁、diff | 均rc=0 | docs-link-check.mjs、check:integration-coverage、check:token-minting、check:session-revocation、git diff --check |

协议负例含坏签名/alg/issuer/aud/nonce/state/时效、端点跨源与重定向、响应过大与读体
超时、重复callback、并发多账号捕获隔离、非200仍先存材料、坏JSON不重派、COMMIT已提交
但回执丢失、总期限到达后晚提交仍归原attempt、绑定旧账号拒绝旧auth_time、刷新无ID与
换subject拒绝、userinfo绑定与未验证邮箱、撤销后内省失败。真实中央11条覆盖标准
授权/PKCE/ES256/JWKS、独立A/B grant、真实auth_time、userinfo验证邮箱、跨client opaque
内省拒绝、刷新持久/轮换、重复callback与撤销A不影响B。无生产数据或生产凭据请求。

主线程独立复审已通过：冻结9路径SHA全部一致，完整协议与持久所有权边界审读High/Medium=0。
独立HTTPS+PG 46/46、重新server build、实际中央HTTPS双PG 11条均rc=0；证据
`/tmp/heyta-p52a-independent-result.json`，日志分别为
`/tmp/heyta-p52a-independent-protocol.log`、`/tmp/heyta-p52a-independent-build.log`、
`/tmp/heyta-p52a-independent-central-http.log`。交付提交与远端状态以
`git log -1 --oneline`、`git ls-remote origin refs/heads/codex/unified-auth`现量核验。
启动门禁保持，P5.2B及后续产品接线未完成，本包没有部署。


## P5.2B1 服务端事务协调底座（已独立验收）

本包已获主线程范围批准。B1只提供内部服务端工厂、唯一事务签发、live/refresh、产品
单会话/全会话退出、销户和撤销worker；B2才接middleware/API/WS/runtime。OIDC启动
门禁保持，Web/原生正式入口与生产切换仍未完成。

- `issueSession`保持唯一jwt.sign，增加受信事务选项；recordSession使用同一事务。
  repository构造时必须注入受信session issuer，completeAuthorization不自行插会话，
  在锁定并核验用户后调用issuer，并核对实际会话行；只有事务COMMIT确认后才能返回JWT。
  APPLIED重入返回归属回执，不重新签发；丢失原响应需要新独立授权，不能盲撤已拥有grant。
- grant绝对上限沿既有产品会话策略为365天，授权提交时固定；单一策略常量供JWT与grant
  使用。refresh只能保持或缩短原期限，不得滑动延长；AT的短期到期不等于grant到期。
- live读取可信绑定快照，释放PG事务后调用中央，再在短事务里复核grant version、
  sessionHash、user/tokenVersion、issuer/client/subject；任何未知网络结果只拒绝准入，
  不注销、不清E2EE；明确inactive才按版本撤销，不能用旧网络答复撤掉新轮换grant。
- refresh只派发一次持久attempt；提交回执未知不得重派或catch撤销。单会话退出只操作
  该user/session；产品全退出同tx撤所有grant和tokenVersion递增；销户复用原墓碑函数
  与prepareUserClosure，outbox无User依赖继续保存。
- worker只消费匹配固定issuer/client的outbox，RT后AT，成功才确认lease；部分失败可
  幂等重试。cleanup有防重入和停止入口，EXPIRED_UNCONFIRMED单独上报，不当作已撤销。

精确写集：server/src/auth.ts、account/access-sessions.ts、central-auth/{repository,
oidc-client,session-policy,session-issuer,coordinator,worker}.ts；server/tests/integration
下central-auth的persistence、independent、oidc既有用例和新增coordinator用例；
server/scripts/verify-central-oidc-http.mjs、server/package.json、server/PROVENANCE.md
及本计划。必要测试fixture只使用MIT独立实现，不复制中央AGPL源码。

授权和刷新应用还持久化已验证的内省AT到期时间；live最终复核再次用数据库时钟确认
该次中央证据未过期。单次会话元数据经可信工厂传至唯一铸造口。全设备退出的方法要求
显式提交后closeForUser回调，避免只有tokenVersion递增而未关闭实时通道；门禁不加豁免。

### P5.2B1 作者验收

| 项目 | 结果 | 复现/证据 |
|---|---|---|
| 协调器真PG+TLS | 25/25，rc=0（期限修复后） | test:integration:central-coordinator；/tmp/heyta-p52b1-expiry-coordinator.log |
| 标准协议真PG+TLS | 46/46，rc=0 | test:integration:central-oidc；/tmp/heyta-p52b1-expiry-protocol.log |
| 实际中央HTTPS双PG | 17条，rc=0 | test:integration:central-oidc:http；/tmp/heyta-p52b1-expiry-central-http.log |
| 原持久层/独立期限反例 | 23/23、2/2，均rc=0 | test:integration:central-auth及:review；/tmp/heyta-p52b1-expiry-persistence.log、/tmp/heyta-p52b1-expiry-old-review.log |
| 服务端全套（本包初轮） | 164文件，2881通过/1既有跳过，rc=0 | pnpm --filter @heyta/sync-server test --maxWorkers=2；/tmp/heyta-p52b1-server-full.log |
| local/密码/缓存/会话/模式 | 8文件203/203，rc=0 | /tmp/heyta-p52b1-local.log |
| 全工作区typecheck | rc=0 | pnpm -r typecheck；/tmp/heyta-p52b1-workspace-types.log |
| server build / 本包测试strict类型 | 均rc=0 | /tmp/heyta-p52b1-expiry-build.log、/tmp/heyta-p52b1-expiry-types.log |
| 唯一签发/撤销/集成覆盖/文档/diff | 均rc=0 | check:token-minting、check:session-revocation、check:integration-coverage、research/tools/docs-link-check.mjs、git diff --check |

协调器反例覆盖真实JWT行绑定、超长寿命压顶、APPLIED不重签、真实签发后事务失败、
COMMIT已提交但回执丢失、未验证邮箱与旧邮箱不合并、AT过期刷新不延寿、并发只一次
派发、响应未知不重派、不持锁网络、退出后的在途active答复拒绝、迟到inactive不撤新
版本、中央网络失败不删账号、单/全会话退出、墓碑销户事务失败与迟到refresh材料、
worker部分RT成功后AT失败重试、失租不能确认、固定issuer/client、防重入和停止、
EXPIRED_UNCONFIRMED上报。真实中央另外通过coordinator.live、refresh、logout和worker
核验实际opaque凭据撤销；未复制中央AGPL源码。

全工作区测试不能写成全绿：默认并发pnpm -r test在Web的calendar-sidebar、nav-next7-days
和reminder-wake发生3个超时及1个真时钟断言失败；限定并发重跑工作区又在mobile
auth-flow出现React Native Flow解析未处理错误（该轮断言987通过但rc=1）。相关源码本包
未改，单独单worker重跑Web三文件29/29、mobile auth-flow17/17均rc=0。首轮与重跑日志
分别为/tmp/heyta-p52b1-workspace-tests.log、/tmp/heyta-p52b1-workspace-tests-serial.log、
/tmp/heyta-p52b1-web-failures-rerun.log、/tmp/heyta-p52b1-mobile-failure-rerun.log。
这些结果仅说明失败未在定向重跑复现，不声称已修复全仓测试稳定性。

最初测试类型命令遗漏--strict导致既有判别联合无法收窄，按仓strict配置重跑通过；
文档脚本最初路径写错，改用实际research/tools入口通过。最初会话撤销门禁发现新
repository的tokenVersion路径缺同文件关闭接缝，已改为必需的提交后关闭回调，未豁免。
旧持久层的任意sessionHash参数已移除，原冲突回滚测试改为真实唯一签发后抛错，保留
RESULT/identity/session事务原子性判据；独立期限反例只适配可信签发依赖，不改失败断言。

B1仍是内部服务底座，正式middleware/API/WS/runtime、旧登录入口关闭、Web/原生
认证UI与生产切换均未完成。OIDC启动门禁继续拒绝启动。本包已独立验收，未部署。


### P5.2B1 独立期限反例与修复

主线程独立真实TLS+PG发现Medium：中央introspection给出短期有效证据后，UserInfo延迟
可耗尽其有效期，原completeAuthorization仍交付JWT。原反例日志
`/tmp/heyta-p52b1-independent-expiry.log`；主线程所有的临时expiry-review文件保持原文
原断言，作者复跑修复后rc=0，`/tmp/heyta-p52b1-expiry-author-review-rerun.log`。随后
主线程按原反例完成独立复验并确认该Medium已关闭，结论见下段独立验收记录。

修复将completeAuthorization/completeRefresh的accessExpiresAt改为必需有限数值，来源
必须是成功中央内省的验证结果；协议调用点明确传递result.accessExpiresAt，不能从
令牌响应expires_in补齐，也无缺省无限期限。仅纯持久层夹具显式提供有限合成证据。
授权在事务初检、取得用户锁后、实际唯一签发后、最终写入后重新读取数据库时钟裁决；
刷新在初检、用户锁后和最终写入后同样核验。证据过期整事务回滚，attempt保留RESULT
归属及材料供原状态机清理，不把过期证据当成功，不盲目撤销或重派。APPLIED重入仍
只读既有归属而不签发，期限已过不能据此撤掉早先成功拥有的grant。

新增四个作者反例：真实UserInfo延迟过期；真实issueSession后延迟过期而用户/身份/会话/
grant整体回滚；真实refresh内省通过后等待User行锁跨期限、版本与旧密文均不变化；
缺失可信证据即使token材料有expiresAt也拒绝。25项协调器、46项协议、17条真实中央
HTTPS、23项持久层和2项原独立期限回归均通过，build及strict测试类型通过。
本轮没有再次宣称整个workspace测试成功；初轮aggregate限制保留。


### P5.2B1 独立验收结果

主线程逐一核对v2的17路径SHA一致，完整复审High/Medium=0。独立重跑协调器25项、
原期限反例1项、标准协议46项及重新构建后的真实中央HTTPS双PG17条，全部通过。
报告`/tmp/heyta-p52b1-independent-result.json`。原独立临时用例在核对内容SHA后移出
源码树，正文保留于/tmp；作者四个期限反例正式留在已登记协调器套件中。

本结论限B1内部底座。B2正式接线、原生/Web入口和生产部署仍未完成；全工作区测试
初轮失败与定向重跑的限制保持，不作全仓全绿承诺。交付提交与现有远端可用
`git log -1 --oneline`、`git ls-remote origin refs/heads/codex/unified-auth`重新核验。
