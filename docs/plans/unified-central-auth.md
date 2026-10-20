# heyta 统一中央认证实施计划

> 状态：**进行中**（2026-10-20）
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
| P5.2B2 | Cookie/CSRF、所有签发入口与API/WS/runtime接线 | 作者验收完成，待独立复审 | 缓存前中央live、已连接WS撤销、定时清理生命周期 |
| P5.3 | 官方Web特色UI与共享Cookie/sync/vault transport适配 | 候选已提交，待独立复审与真实中央浏览器联调 | 真浏览器、CSRF、无上游凭据落浏览器、E2EE/离线保持 |
| P5.4 | 原生和CLI共享handoff | 服务端与CLI候选已提交；移动端 iOS 入口候选已在当前 Release 安装产物验界面，完整回跳与领取待验 | 各端当前安装产物回跳、安全存储、重放/错绑定拒绝 |
| P5.5 | 文档、全量验收、发布准备 | 待实施 | 独立复审与当前产物；生产另走授权流程 |

## P5.4 原生/CLI handoff 实施边界（候选已接线，完整验收未交付）

设备必须能在**没有既存 Web 会话**时自行发起登录。原生端打开系统浏览器，CLI 输出
固定 HTTPS 启动链接并轮询；两者共用 `@heyta/app-host` 协议，产品服务端继续使用固定
OIDC 回调和唯一 `issueSession` 签发口。不能把 Web Cookie 搬给设备，也不能用邮箱、
中央 sid 或浏览器自报的设备号认领结果。

1. 设备生成高熵 verifier，仅将其 SHA-256 challenge 通过 HTTPS POST 到产品服务端。
   服务端返回无用户信息的随机 handoff id 和一次性浏览器启动链接；verifier 原文只留
   在发起设备内存/受保护存储。启动链接不得包含 verifier、产品 JWT 或中央令牌。
2. 浏览器 GET 启动链接只显示本站的“继续登录”页并设置短时 host-only Cookie；
   **不能在 GET 消费启动凭据**，避免链接预取/安全扫描器抢先使用户无法登录。用户明确点击
   后的同源 POST 核对 Cookie、Origin 和页面一次性值，再原子消费启动凭据，设置现有
   加密 pending Cookie，以 `Referrer-Policy: no-referrer` 跳转到中央 OIDC 授权地址。
   pending 的浏览器绑定、state、nonce、PKCE 与十分钟时限仍由现有 OIDC 协调器验证。
   启动链接泄露不构成设备领取证明；启动失败只能重新发起，不能复用已消费的授权码。
3. 固定回调按 pending id 区分 Web 与 handoff。handoff 完成中央验签、userinfo 和
   introspection 后，必须在**同一产品数据库事务**里调用唯一会话签发口、建立 grant、
   加密保存待领取产品 JWT、将 handoff 置为 READY；唯一签发口为本地事务内逻辑，
   外部 OIDC 网络调用必须在事务外完成。不得先提交产品 grant 再在另一事务
   中保存待领取凭据。handoff 回调不写 Web session Cookie。若事务失败，不产生可领取
   会话；外部 token 请求结果仍遵守既有 RESULT/UNKNOWN 所有权规则，绝不重派授权码。
4. 设备以 handoff id + verifier 通过 POST 领取。持久层在锁内比较 challenge、期限、
   READY 状态及绑定 grant/session 是否仍有效，一次性原子返回并清除密文；并发领取仅
   一次成功。错 verifier 不消耗，须限流。响应丢失后不得重发长期令牌，设备重新登录；
   已签发但未领走的 grant 到期须进入现有撤销 outbox，不能静默留活。
5. CLI 轮询与原生回前台轮询只读取 PENDING/READY/终态；URL/深链最多携带随机 handoff
   id 作为回前台提示，**不含** JWT、refresh token、verifier、授权码或用户信息。
   各端收到产品 bearer 后复用现有会话落点与 E2EE 解锁路径；本地任务无需联网登录。

实施前须再核实迁移及当前平台壳约束。真 PostgreSQL 反例至少覆盖：并发领取、错设备
verifier、过期与锁等待跨期限、回调重复/授权码未知结果、回调事务回滚、领取前会话撤销、
领取响应丢失和未领取 grant 清理。另验系统浏览器当前安装产物回跳、CLI 真实进程轮询、
原生安全存储与登出删除、Web 既有 Cookie 流程不回归。当前候选不等于 P5.4 完成。

### P5.4 服务端与 CLI 候选验证（2026-10-20）

新迁移 `20261020010000_central_device_handoff` 仅应用于本机隔离测试库，未触及生产。
客户端 verifier 原文只在设备内存，服务端持 SHA-256 challenge；浏览器启动链接需在
同源页面输入设备另行展示的 12 位配对码并点击确认，GET 预取不消费。回调只把产品 JWT
以独立服务端密钥封装到 handoff 行，和唯一签发、grant、attempt APPLIED 同一事务；
领取清密文，错 verifier 不消耗，并发只一次成功。未领走的 grant 到期入撤销队列。

已实跑：迁移脚本在本机 `heyta_central_auth_device2_test` 与
`heyta_central_auth_oidc_device_test` 两个隔离 PostgreSQL 库成功（75 个迁移）；持久层
6/6 真库反例通过（含用户行锁跨 handoff 到期），HTTPS/OIDC/HTTP/WS 集成 14/14 通过，
原 Web Cookie 回归在同组；启动页 Cookie 的同源、重复、错绑定与过期定向反例 6/6 通过。
共享 `app-host` 1854/1854、`sync-core` 318/318、`shared-schema` 173/173、Node CLI
200/200 均通过；这四组未覆盖移动端当前安装产物。`node scripts/check-migrations.mjs` 和
涉及包的构建通过。补测后服务端全量 2899 通过、1 跳过，迁移规范与文档链接检查 rc=0。
4.1 Flash 读取服务端与CLI实际 diff 的独立审阅没有确证 High/Medium，
但其部分“High/Medium”条目本身写着无问题、另有刷新会轮换本地会话的推测；主线按源码
复核，没有把模型回报当验收。正式独立复审和移动端完整链路现场验收仍未完成。

### P5.4 移动端入口候选验证（2026-10-20）

官方 HTTPS 产品基址在移动端只显示统一身份入口；自托管必须显式切换并填写独立
服务器地址，官方域不呈现旧口令登录。点击中央入口先经过原有联网同意闸门，再核对
用户主动勾选的条款；设备 verifier 只在 React 状态内保存，服务端只收到 challenge，
系统浏览器启动链接与另行显示的 12 位确认码分开。回前台才轮询领取，一次失败按
结果不确定处理，不重领同一个一次性 bearer；成功后进入既有 E2EE 口令和
`saveAuthSession` 落点。完整中央浏览器确认及领取尚未在 iOS 安装产物上走通，
Android、HarmonyOS 的当前安装产物也尚未验收，故 P5.4 仍进行中。

实测：`pnpm -r build`、`xcodebuild ... Release ... build CODE_SIGNING_ALLOWED=NO`
均 rc=0；2026-10-20 复建的 `main.jsbundle` 已通过 `simctl install` 装入
`heyta-iphone-17pro` 并启动，安装包与本轮构建产物 SHA-256 一致，bundle 新于改动源码。
`idb ui describe-all` 回读
“使用统一身份登录”存在、“登录密码”不存在；点“使用自建服务端”后服务器地址为空且
旧口令字段出现。未勾条款点击会由移动端拦住；未触发生产 `device/start`，不把它
当成生产端到端登录证明。浅色与深色截图已人工目视检查：
[浅色](../../apps/mobile/evidence/unified-auth-20261020/ios-light.png) ·
[深色](../../apps/mobile/evidence/unified-auth-20261020/ios-dark.png)。
全仓 `pnpm -r test` rc=0（移动端 987/987、共享 app-host 1855/1855、Node CLI
200/200、服务端 2899/2899，另有既有跳过项），`pnpm check:docs`、分层和界面文案
门禁 rc=0；相关类型与构建 rc=0。共享设备通道补上拒绝明文/带凭据 URL 的反例，
CLI 夹具改用 HTTPS 后通过。4.1 Flash 经 CC Switch 非官方路由复审这次移动端与
共享客户端差异，实际返回 `deepseek/deepseek-v4.1-flash`，未报告确证 High/Medium；
这不替代完整中央浏览器交接与原生安全存储验收。

当前移动端同步凭据仍按既有设计只留进程内存，退出时清除；这避免把 JWT 写入普通
磁盘文件，但冷启动需要重新认证。原生安全存储持久会话、跨进程删除与恢复判据尚未
交付，不能用现有 Vault root-key 安全存储冒充 JWT 安全存储。

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


## P5.2B2 服务端完整接线（2026-10-19）

本包基线 `1e03707c86778d10a49f3dcc598087da96beff48`，代码在隔离树完成并通过独立
审查。无部署、无新增依赖/迁移、不改op-log/E2EE，不复制AGPL中央代码或测试。
B2提前包含安全Cookie/CSRF和HTTP回调底座；P5.3仍需Web共享transport与特色UI，
P5.4仍需原生/CLI设备绑定handoff，当前服务端通过不能当成全部统一认证已交付。

### 实际边界

- 共享纯加法契约位于shared-schema/central-auth-contract；配置、预会话/已登录投影、
  同源POST开始和固定GET回调分别为config/session/start/callback路径。
  新账号须在start明确接受当前产品文档版本，接受时间由服务端记录并封入pending Cookie；
  state/iss/PKCE/nonce/ES256仍由标准库与持久pending共同验证。重复query/Cookie、旧浏览器
  事务、任意returnTo或身份参数均拒绝。回调固定303至配置origin的/app/，不相信Host。
- JWT只以host-only Secure HttpOnly SameSite=Lax Cookie交付；session响应只给账号投影与
  CSRF。CSRF使用独立加密上下文、会话摘要绑定、同源Origin与请求头核验，非简单双提交。
  明确失效会话由session端点清HttpOnly Cookie并发匿名CSRF以便重新登录；503保留会话。
  官方旧密码/passkey/magic/OTP/邮箱凭据路由及邮件落地页在副作用前409；testRoutes不注册。
  issueSession仍是唯一jwt.sign，私有能力只由centralSessionIssuer适配接缝使用，门禁有负例。
- OIDC每次HTTP成功鉴权都检查本地用户/版本/会话及中央live，缓存不跳过该过程；无jti、
  无grant旧JWT拒绝。中央inactive为TOKEN_REVOKED；未知为CENTRAL_UNAVAILABLE/503；
  本地确实删户才ACCOUNT_CLOSED/410。退出专用鉴权仅挂当前退出、本人会话删除和产品全退出，
  在中央故障下仍可本地撤销并落outbox，不能用于业务API或销户。
- 已连接WS的业务输入、全部输出和30秒heartbeat均复验，设备touch在通过复验后进行。
  每连接串行队列上限32，迟到active不复活已删除连接；撤销4003，未知/过载1013。
  官方拒绝URL长期token，只接受同源Cookie或受信native Authorization；local原协议保留。
- 单次/产品全部退出、管理员强制退出、replace-token、设备撤销及销户收敛到中央事务。
  设备封锁、automation worker撤销、产品grant/outbox与版本递增同事务；失败全部回滚。
  replace-token在OIDC下回reauthenticationRequired与固定登录路径，不凭旧证明续签；local原样。
  产品销户只删产品账号并写墓碑，不注销中央账号。全平台退出没有在本包猜造接口。
- 单进程运行时有唯一所有者；初始化/监听失败释放自己资源，不覆盖别的server；成功监听后
  启动worker，关闭等完HTTP、WS在途验证和worker后再断DB。完整服务端接线后已解除历史
  “尚未实现”启动拒绝；严格环境校验及Node>=22.12门禁仍有效。

自托管OIDC的新账号自动建号仍保守关闭：现有法律模块只为官方法律域名返回文档版本，
其他实例的运营者文档版本为null，本包不伪造。已映射账号可登录，local自托管不受影响。
旧账号HTTP双证明绑定和运营者自定义条款版本需后续独立接线，不按邮箱自动合并或认领。

### P5.2B2 验证记录

| 项目 | 结果 | 复跑与日志 |
|---|---|---|
| 服务端全套 | 167文件，2898通过、1既有跳过，rc=0 | pnpm --filter @heyta/sync-server test --maxWorkers=2；/tmp/heyta-p52b2-server-all-final.log |
| 真TLS/PG/HTTP/WS | 13/13，rc=0，含实际30秒空闲复验 | test:integration:central-http-ws；/tmp/heyta-p52b2-http-ws-final.log |
| 实际中央HTTPS双PG | 22条，rc=0，使用最终编译产物 | test:integration:central-oidc:http；/tmp/heyta-p52b2-real-central-final.log |
| 原协调器/标准协议 | 25/25、46/46，rc=0 | test:integration:central-coordinator、central-oidc；/tmp/heyta-p52b2-coordinator.log、/tmp/heyta-p52b2-oidc.log |
| 原持久层/独立期限用例 | 23/23、2/2，rc=0 | test:integration:central-auth及:review；/tmp/heyta-p52b2-persistence.log、/tmp/heyta-p52b2-persistence-review.log |
| shared-schema / sync-client | 173/173、159/159，rc=0 | 对应包test；/tmp/heyta-p52b2-schema-tests.log、/tmp/heyta-p52b2-sync-client-tests.log |
| 全workspace类型/server构建/新增测试strict类型 | 均rc=0 | pnpm typecheck、server build；/tmp/heyta-p52b2-typecheck.log、/tmp/heyta-p52b2-build-final.log、/tmp/heyta-p52b2-test-types.log |
| 唯一签发/撤销/集成覆盖/文档/diff | 均rc=0；签发门禁11个自证反例全通过 | check:token-minting及--self-test、check:session-revocation、check:integration-coverage、docs-link-check.mjs、git diff --check |

本轮初始生命周期夹具缺disconnectDb，修正测试装配后通过；曾在中间全套遇到未改动的
restore-script错误口令测试随机报ARTIFACT_CORRUPT而非ARTIFACT_UNDECRYPTABLE（依然
拒绝还原，未碰数据库），日志/tmp/heyta-p52b2-server-all-restore-flake.log。最终当前源码
全套通过，不据此声称该既有测试的随机性已经修复；本包没有修改还原脚本或该测试。
没有重跑整个workspace测试，只跑全部服务端、受影响共享包及全workspace类型检查；
B1记录的Web/mobile aggregate波动仍保留，不写成已消失。HTTP安全反例还量到Fastify
set-cookie追加造成重复Cookie，已修为先移除旧响应头再一次设置完整列表，实际回调验证
只有一枚session Cookie。WS队列同时约束32条、帧字节与presence payload，防慢中央积压。

复现脚本已登记 `test:integration:central-http-ws`，与既有
central-coordinator、central-oidc、central-oidc:http 共用隔离产品库，必须顺序执行。
测试TLS runner生成临时CA，保持证书校验；真实中央作为外部依赖启动，未复制其实现。
真实中央HTTP脚本使用其测试fixture的既有中央登录态，只证明服务端OIDC、Cookie和WS
链路，不代表真实密码/MFA、浏览器SameSite或原生UI端到端验收。


### P5.2B2 独立验收结果

独立审查逐一核对36路径SHA无漂移，High/Medium=0；回执
`/tmp/heyta-p52b2-independent-review.json`。独立复跑真实TLS/PG/HTTP/WS 13项（含
真实30秒空闲复验）、全部服务端167文件2898通过/1既有跳过、sync-client 159项，
以及唯一签发、撤销、集成覆盖与diff检查，均rc=0。

另加3个独立反例：已替换WS的迟到授权及旧handler不能转发；PostgreSQL INSERT触发器
故障使撤销变更、tokenVersion、grant/session及销户全部回滚；去掉故障后同一撤销成功
且只关闭一次。复跑入口 `/tmp/heyta-p52b2-independent-counterexamples.cjs`，日志
`/tmp/heyta-p52b2-independent-counterexamples.log`。独立装置初次仅因ts-node模块解析失败，
启用experimentalResolver后全部通过，未为反例修改产品代码。

此验收没有部署，HTTP/WS独立夹具不等于真实中央密码/MFA或浏览器SameSite验收，
P5.3/P5.4界面与原生接线仍待完成。独立全服务端未复现前述restore-script波动，
不据此宣称随机性已修复。提交和远端状态用git log与git ls-remote现查，不手写完成状态。

### 2026-10-20：P5.3 Web 候选现量核对

`git log -8 --oneline` 可重取 P5.3 候选：`0afb0359c` 接通官方中央登录 UI、
Cookie 请求封装、sync/vault 传输；`9bf4ce280` 保留自托管高级入口；
`4e7aee9a6` 修复弹层关闭；`9b36df989` 收紧浏览器错误验收。
本轮从干净工作树复跑 `pnpm --filter @heyta/web test`：180 文件通过、2 跳过，
2308 项通过、13 跳过，rc=0；`pnpm --filter @heyta/web build` rc=0。
`cd e2e && pnpm exec playwright test --config playwright.auth-simple.config.ts
tests/auth-simple-ux.spec.ts`：5/5 通过，检查了移动和桌面、亮暗主题、
高级自托管入口及中央配置不可用时的关闭行为；移动亮暗截图已人工查看。
Playwright 生成的 5 个已跟踪证据图差异已在确认原工作树干净后恢复；写本文档前
`git status --short` 为干净。此轮未部署，也未完成真实中央密码/MFA浏览器联调、
Cookie跨站行为和独立安全复审，因此不把 P5.3 标为放行完成。

### 2026-10-20：后台会话复查候选与持久绑定放行闸

官方 Web 候选增加前台恢复时的中央会话复查：隐私网络闸关闭时不发请求；服务端
明确返回未认证时清除旧身份标签与实时连接；网络结果未知时保留本地状态；
退出或换账号后晚到的探测结果由凭据版本栅栏丢弃；同一页面会话里另一标签页
换 subject 时，当前页停止自动接入。复审发现**刷新后仍缺本机持久 subject 绑定**：
HttpOnly Cookie 无法由 JavaScript 读取旧 subject，内存身份也会随刷新消失，
因此新 subject 的 Cookie 仍可能把旧 op-log 接到新账号。此项是 P5.3 生产放行闸。

持久绑定必须同时覆盖服务源与 subject，并与换账号界面、先导出再清除本地数据的
操作及完整擦除失败判据同批交付。不能只写绑定键却没有可见的解除路径，也不能在
数据擦除失败时先解除绑定。上述候选未完成真实中央密码/MFA浏览器联调、跨站 Cookie
和生产切换验收。

同日补丁候选增加了 Web 本机数据的 `{服务源, subject}` 持久绑定、冲突时的 JSON
导出与用户确认清除、以及逐层清除成功后才解除旧绑定的判据。绑定的检查与写入通过
Web Locks 跨标签页串行化；浏览器不提供 Web Locks 或本地存储不可用时，中央会话
不得自动接入本地 op-log。已有页面内旧 subject 而尚无绑定时，先持久记录旧归属，
避免部分清除后残存数据失去归属。定向测试包括双标签争用、刷新后换号、清除期间
绑定变化、部分清除和确认目标重绑。

Chromium 双标签实测使用同一浏览器上下文：A 登录旧 subject 并写入一条 op，
B 模拟新 subject。A 持有 SQLite/OPFS Access Handle 时，B 的应用初始化被浏览器
拒绝，旧绑定保持不变；错误页现按这条实测原因提示关闭其它标签页。关闭 A 并刷新
B 后，冲突面板出现，下载的 JSON 含旧任务；用户确认清除后，本地绑定改成新
subject，旧任务不再出现。浏览器用例覆盖了这条可恢复的**单活标签页**换号路径。

该结果仍不能证明“两个标签页同时活跃并换号”安全：B 在 A 存活时根本进不了
业务界面。发布前须决定并验证多标签支持策略，或明确产品只允许单活标签页；
真实中央 Cookie、密码/MFA、跨站行为与目标浏览器兼容性仍是 P5.3 放行闸。

当前候选判据：`pnpm --filter @heyta/web test` 为 184 文件通过、2 跳过，
2330 项通过、13 跳过；`pnpm --filter @heyta/web build`、`typecheck`、
`check:layering`、`check:i18n-vars`、`check:ui-language`、`check:docs-voice`、
`check:docs` 与 `git diff --check` 均 rc=0。Playwright 的冲突界面和单活标签页
换号流程 2/2 通过；桌面亮色、移动暗色及存储占用错误页截图已打开目视核对；
移动端底部动作需滚动到位，未见文字重叠或
横向溢出。本机 Chromium 与 WebKit 的 `http://localhost` 安全上下文均测得
`navigator.locks.request` 为函数，但这不等于全部目标浏览器已经验收。
