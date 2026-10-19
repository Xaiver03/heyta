# ADR-0066：官方统一身份与自托管认证边界

> 状态：**已接受**（2026-10-19）
> 实施与验收唯一入口：[统一认证计划](../plans/unified-central-auth.md)。

## 背景

用户要求所有官方产品统一认证。heyta 为 MIT、本地优先、可自托管且采用 E2EE。
原本的 issueSession 集中签发并不能保证中央撤销：API 仍只验证本地 JWT，
既有 WS 只在升级时认证。统一身份须覆盖服务端会话与所有宿主。

## 决定

- 官方托管以中央 OIDC 为唯一人类身份权威；自托管显式选择 local 或 oidc。
  缺配置、未知模式、中央不可达均不得降级本地密码。实现尚未完成的 oidc 模式拒绝启动。
- 使用独立 MIT 标准库 openid-client。不得引入或复制 AGPL 内部客户端及其测试源码。
  PKCE、nonce、issuer/audience 和签名验证交给标准库，heyta 只实现产品映射和生命周期。
- 保持 numeric User.id 及现有数据关系，用唯一 (issuer, sub) 映射身份；禁止按邮箱自动合并。
  旧新双证明后才能绑定旧帐号。管理员、产品准入和条款同意仍由产品显式裁决。
- 本地会话逐一绑定中央授权 grant，AT/RT 仅服务端加密保存；刷新串行/CAS，失败清理与
  登出用持久 outbox。共享中央浏览器会话中的两次产品授权不得因一次登出而互相撤销。
- 官方 Web 使用 host-only HttpOnly Secure Cookie 与 CSRF/Origin 防护；原生使用系统浏览器，
  仅通过绑定发起设备 verifier 的短时单次兑换传送产品会话；URL 不携带长期令牌。
  认证编排共用 app-host，壳只提供平台 API，不各写一套协议。
- API 和已建立 WS 均受中央有效性约束；进程内缓存不能越过撤销边界。
  单会话退出、所有 heyta 设备退出、全平台退出分别实现。
- 本地任务与离线使用不要求登录；E2EE root/口令/恢复码不进中央，不以 JWT 派生密钥。
  中央撤销/停用/故障不得映射 ACCOUNT_CLOSED；只有显式产品销户可触发本地销毁。

## 配置和阶段门禁

配置仅来自运维环境，不接受请求 Host 或浏览器输入。HEYTA_AUTH_DEPLOYMENT 为
self-hosted（默认）或 official，HEYTA_AUTH_MODE 为 local（仅自托管默认）或 oidc。
显式空值或未知值报错；local 同时配置任意 HEYTA_OIDC_* 变量也报错，避免拼错 mode
后悄悄启用本地认证。official 必须显式 oidc。

OIDC 必须提供 issuer、client id/secret、固定回调 URI、会话加密 key。URL 全部 HTTPS，
无用户名密码/query/fragment；回调固定同 PUBLIC_URL origin 的 /api/auth/oidc/callback。
issuer 原样保留（不静默改尾斜线）；加密 key 为 32 字节 hex，单独于 JWT_SECRET。
标准库 ESM 由服务端 CommonJS 在 Node >=22.12 的 require(ESM)加载，不全仓迁移模块格式。

P5.0 只提供配置与运行时验收；即便 OIDC 配置完整仍拒绝启动，直至完整授权/撤销接线。
此门禁无环境旁路。尚无实际认证行为，不新增持久化数据；后续 schema 需独立复审。

## 后果

不改变 op-log schema 与 E2EE 协议；官方切换后未绑定中央 grant 的旧会话不能访问云。
自托管 local 保持现有行为。Node 22.0–22.11 不能用于新增 OIDC 模块。
原生安装、生产迁移、上线属于后续验收；单包通过不等于统一认证已交付。

## 持久化补充（P5.1）

每次外部token请求单独记录不可复用attempt，DISPATCHED/UNKNOWN不能重新派发。
上游响应先加密记录RESULT，再原子应用为独立grant；已APPLIED的旧attempt即使经历后次
刷新仍保持所有权，不能因客户端丢失COMMIT回执而被错误补偿撤销。没有记录也不授权撤销。

Grant对用户和本地会话使用RESTRICT；正常退出/注销须先在事务中将上游材料移入独立
outbox再删除本地记录。注销回调与上述步骤共享一个事务，不允许先清理再单独删账号。
Pending有效十分钟，撤销密文最长七日、终态最少元数据24小时。七日未获确认必须标记
EXPIRED_UNCONFIRMED，不假称中央已撤销。未知外部结果保留最少所有权证据直至核实处置。
数据库中所有中央写操作使用短事务咨询锁串行化；事务内无网络请求。此选择先保证所有权
一致，尚无吞吐基准，后续扩容需实测锁等待，再按相同不变量拆分锁粒度。
P5.2必须挂载清理调度和未确认撤销的运维报告；P5.1仍没有HTTP或生产认证行为。
