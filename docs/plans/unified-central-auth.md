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
| P5.1 | identity/pending/grant/outbox schema与repository | 设计与精确写集核对中 | 真隔离PG、唯一映射/单次消费、无email自动合并 |
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
