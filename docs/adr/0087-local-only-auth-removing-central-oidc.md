# ADR-0087：认证唯一收敛为自建「邮箱+密码」，移除官方中央 OIDC

> 状态：**已接受**（2026-11-16，产品负责人授权）
> 取代：[ADR-0066](0066-official-central-identity-and-self-hosted-auth.md)（官方统一身份与自托管认证边界）。
> 实施计划：[remove-central-oidc-execution.md](../plans/remove-central-oidc-execution.md)。

## 背景

ADR-0066 让「官方托管」以中央 OIDC 为唯一人类身份权威，并保留自托管 `local` 模式。两套并存带来：
多一套 OIDC 传输、令牌/授权/撤销/握手表与多端设备配对代码；而产品实际落地的是**自建邮箱+密码体系**
（注册/登录验证码、找回、换绑、会话撤销、通行密钥）加**自有 SMTP 发信**。产品负责人 2026-11-16 决定：
**彻底删掉官方中央 OIDC 统一身份，认证只保留自建邮箱+密码 + SMTP 邮箱验证码。**

依 [AGENTS.md §0.1](../../AGENTS.md)，判"做不做"的只有用户价值："官方产品统一认证"是既有产品选择，不是不可更改的约束；
用户要自有账号体系即执行。

## 决定

- **删除**官方中央 OIDC 整条线：服务端 `central-auth`、`HEYTA_AUTH_MODE`/`HEYTA_AUTH_DEPLOYMENT`/`HEYTA_OIDC_*`、
  6 张 `Central*` 表、app-host/CLI 的中央客户端、Web/Mobile 的中央登录入口与相关文案、计划与配置。
- **唯一认证**：项目自建邮箱+密码体系（`server/src/password/*`、`server/src/auth.ts`），
  SMTP 邮箱验证码（注册验证码、登录验证码、找回）走运营者自有 `SMTP_*`。
- **不 bump `CURRENT_SCHEMA_VERSION`**：删除表不改实体清单/线协议；以单独迁移删除表（[db-migrations](../agents/db-migrations.md)）。
- **不改已应用迁移**：新增 `20261116120000_remove_central_oidc` 做 `DROP TABLE`。

## 后果

- 不再有"官方以中央身份为唯一权威"的形态；所有部署（含官方）都走同一套自建账号 + SMTP。
- 客户端不再有 cookie 会话传输；Web/移动端统一走 Bearer 令牌 + 自建登录表单。
- 删表的迁移不可逆；official 从未上线，表为空，风险可控。
- 实施状态见计划：[remove-central-oidc-execution.md](../plans/remove-central-oidc-execution.md)。
