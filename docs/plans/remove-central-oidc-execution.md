# 移除中央 OIDC、收敛为自建邮箱+密码 执行计划

> 决策：[ADR-0087](../adr/0087-local-only-auth-removing-central-oidc.md)（取代 ADR-0066）。
> 分支：`feat/remove-central-oidc`（隔离 worktree，基于 `e8457104`）。基线类型检查：`server tsc exit0`。

## 状态

| 阶段 | 范围 | 状态 |
|---|---|---|
| P1 服务端 | `server/src/central-auth` 全删、12 处引用去 central、`SESSION_MAX_AGE_MS` 迁 `server/src/session-policy.ts`、schema 删 6 张 Central* 表 + User/AccessSession 关系、新增删除迁移、删 central 脚本与 14 个 central 测试 | ✅ 完成，`server tsc exit0` / `prisma validate` 通过 / `check-migrations` 通过 |
| P2a 容器/契约（与 P3 需同批） | app-host 删 `central-auth.ts` 与导出、hosted-auth/vault-session 去 cookie；node-host CLI 去中央配对；shared-schema 删 `central-auth-contract.ts` | ⏳ 已完成并验证过，因须与 P3 同批才编译，暂并入 P3 一起提交 |
| P3 Web/Mobile UI | 见下 | ⏳ 待做 |
| P4 i18n | 删 `web.auth.central.*` / `mobile.auth.central.*`（各 36 键，zh-CN/en） | ⏳ 待做 |
| P5 文档/门禁 | 归档 `unified-central-auth.md`、清 `docs/agents` 引用、改门禁脚本、`.handoff` 保留历史 | ⏳ 待做 |
| P6 SMTP | 配我方自有 SMTP 使验证码真实发信 | ✅ 完成：host=`gz-smtp.qcloudmail.com:465` / user=`heyta-noreply@waytofuture.cn`（腾讯云 SES，default 账号 100044381704）；凭据在 `~/.config/heyta/smtp-waytofuture.env`(600) 并已接入 `server/.env`；nodemailer 实测 `250 queued` |

## P3 细目（web，`apps/web/src`）

- `features/sync/store.ts`：删 `CENTRAL_COOKIE_SESSION_MARKER/createCentralCookieFetch/getCentralAuthConfig/getCentralAuthSession/bindCentralAccount` 相关 import；删 state 字段 `centralBindingConflict/centralBindingTarget/centralAccountSwitching/csrfToken`；删方法 `applyCentralAuth/resumeCentralSession/beginCentralAccountSwitch/finishCentralAccountSwitch`；`buildClient` 固定 `authTransport='bearer'`、`fetchImpl=consentFetch`。
- `features/auth/AuthPanel.tsx`：删中央面板 JSX/状态/处理（约 98 处）；保留本地邮箱+密码表单。
- `features/auth/store.ts`：删 `startCentralLogin/startCentralDeviceLogin`、`central-login`/`central-device-waiting` 状态与相关 import。
- 删除文件：`features/auth/CentralAccountConflictPanel.tsx`、`features/auth/central-account-switch.ts`、`features/sync/central-session-recheck.ts`、`lib/central-account-binding.ts`。
- `lib/central-fetch.ts` → 改名 `lib/auth-fetch.ts`，仅返回 `globalThis.fetch`（bearer）；更新 5 处 import（share 四文件 + `lib/vault-session.ts`）。
- `main.tsx`：删 `installCentralSessionRecheck` 与 `resumeCentralSession` 调用；`features/privacy/startup-network.ts` 删 `resumeCentralSession` 端口。
- `lib/local-data-destruction.ts`：删 `CENTRAL_ACCOUNT_BINDING_KEY` 相关分支。
- `features/auth/auth-dialog.css`：删 `.ht-auth-central*` 样式块。
- 判据：`apps/web` typecheck（`tsc --noEmit` / 构建脚本）exit0。

## P3 细目（mobile，`apps/mobile/src`）

- `screens/AuthScreen.tsx`（约 55 处）：删中央 OIDC 设备配对分支与 `getCentralAuthConfig/isOfficialCentralAuthEndpoint` 引入；只留本地邮箱+密码登录/注册。

## P5 门禁与文档要点

- `scripts/check-privacy-as-blocker.mjs`、`scripts/check-token-minting.mjs`、`scripts/verify-mobile-auth.sh` 中涉及 central 的断言改到本地路径。
- `docs/plans/unified-central-auth.md` 归档到 `docs/plans/archive/`；`docs/plans/README.md` 与其引用更新。
- serial：`docker-compose.yml` 删 `HEYTA_AUTH_*`/`HEYTA_OIDC_*`；`env.example` 删 `HEYTA_OIDC_*`。

## P6 SMTP

> ✅ 已打通：`gz-smtp.qcloudmail.com:465`（广州区专属主机；用香港区 `smtp.qcloudmail.com` 会报 `not exist in redis`）。
> 发信地址 `heyta-noreply@waytofuture.cn`（专用，未改动既有 `heyta@`/`noreply@`）；SMTP 密码经 `UpdateEmailSmtpPassWord` 设置（长度10–20、含大小写+≥2不重复数字）。
> 实测：nodemailer `verify()` 通过、发信返回 `250 OK: queued`。`server/.env` 已写入 `SMTP_*` 与 `REQUIRE_EMAIL_VERIFICATION=true`。

服务端已具备：`server/src/email.ts`（nodemailer，读 `SMTP_HOST/PORT/SECURE/USER/PASS/FROM`）、
`server/src/password/registration-otp.ts`（注册验证码）、`login-otp.ts`（登录验证码）、找回信。
`docker-compose.yml` 已透传 SMTP 并默认 `REQUIRE_EMAIL_VERIFICATION=true`。
**缺的是真实 SMTP 凭据**（当前 `server/.env` 未配 → 走 Ethereal 测试邮箱）。需用户提供
`waytofuture.cn` 的发信凭据（腾讯云 SES / 腾讯企业邮 SMTP 主机、端口、账号、密码、From），或在部署 env 中填入。

## 验收（整体）

`pnpm -r typecheck` 全绿；`pnpm check:migrations`、`check-schema-migration-drift`、`check:privacy-as-blocker`、
`check:token-minting`、`check:legal-email-claims` 通过；web/mobile 真机/浏览器登录（自建邮箱+密码 + 邮箱验证码）跑通。
