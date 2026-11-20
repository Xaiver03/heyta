# 移动端登录 / 注册（AI 与人工都看这一份）

> 目的：调试、验收、写测试时**不要再让人工登录**。照本文用测试账号 + 一键脚本直接登进去。
> 本文覆盖：产品登录/注册的真实流程、各步界面锚点、测试账号怎么来、以及自动化脚本。
> 触发场景：任何要在真机上"进到 heyta 主界面"的 AI/自动化任务。

## 1. 服务器与入口

| 项 | 值 |
|---|---|
| 官方站点（App 默认服务器） | `https://heyta.waytofuture.cn` |
| 生产机 | `ssh finlaw`（`124.223.13.226`）；容器 `supersync-server` + `supersync-postgres`（PostgreSQL 16） |
| 密码算法 | **Argon2id + pepper（PHC 串）**，见 `server/src/password/hash.ts` 的 `hashPassword`；pepper 走容器环境变量 `PASSWORD_PEPPER` |

## 2. 产品登录 / 注册的真实流程（真机实测顺序）

1. **欢迎页**：`注册 / 登录`（`resource-id=welcome-signin`）/ `先离线使用`（`welcome-offline`）。
2. **隐私联网同意**（第一次联网时拦一次）：`同意并联网` / `只用本机`。**必须选「同意并联网」**，否则登录请求一个字节都发不出去。
3. **登录表单**（`mobile-auth-form`）：
   - 邮箱 `mobile-auth-form-email`、登录密码 `mobile-auth-form-password`、`登录` `mobile-auth-form-submit`。
   - 切注册：`mobile-auth-form-switch-mode`（"还没有这个邮箱的账号？创建一个"）。
4. **注册 = 邮箱验证码**：注册表单有 邮箱 / 密码 / 再次输入密码 / 勾选条款 + `发送验证码`（`mobile-auth-form-submit`）。**必须收到邮箱验证码才能完成**，不能免验证码自助注册。
5. **登录后的「加密口令」步**（登录成功但还没进主界面时）：`加密口令` 输入框 + `保存并启用同步`。**必填**，否则界面停在"还没设置端到端加密口令"。
6. **条款版本确认**（账号 `terms_document_version` 为空时出现）：`我已读完并确认` / `稍后再说（继续不同步）`。选「我已读完并确认」才能同步。
7. 进主界面：底部 tab `任务 / 日历 / 专注 / AI / 我的`。

> 🔴 两个必须做的事（`docs/agents/commands.md` 早有记录，这里是同一件）：① 联网前先过隐私同意；② 登录后必须设置「加密口令」才算真正可用同步。

## 3. 测试账号（不要人工注册，直接写生产库）

注册要邮箱验证码，不适合自动化。**调试账号直接写生产库**（产品负责人 2026-11-20 明确授权写库建测试账号；**只建/更新这个测试账号，绝不改现网其他用户**）。

当前测试账号：

| 字段 | 值 |
|---|---|
| 邮箱 | `qa-mobile@waytofuture.cn` |
| 登录密码 | 见 `.local/test-account.env`（gitignore，不入库） |
| 加密口令 | 见 `.local/test-account.env` |
| 生产库 id | 30，`is_verified=1` |

凭据文件：`.local/test-account.env`（`HEYTA_TEST_EMAIL` / `HEYTA_TEST_PASSWORD` / `HEYTA_TEST_E2EE`）。

### 3.1 建/改测试账号的做法（用服务端自己的哈希，别自己拼 PHC）

在 `finlaw` 上把下面脚本 `docker cp` 进 `supersync-server` 再 `node` 执行（容器内 `/app` 有 `dist` 与 Prisma 客户端，环境自带 `PASSWORD_PEPPER`/`DATABASE_URL`）：

```js
const { hashPassword } = require('/app/dist/src/password/hash.js');
const { PrismaClient } = require('/app/node_modules/@prisma/client');
(async () => {
  const email = 'qa-mobile@waytofuture.cn';
  const password = process.env.PW; // 传入口令
  const phc = await hashPassword(password);
  const prisma = new PrismaClient();
  const u = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: phc, isVerified: 1, failedLoginAttempts: 0, lockedUntil: null },
    create: { email, passwordHash: phc, isVerified: 1, termsAcceptedAt: BigInt(Date.now()) },
    select: { id: true, email: true, isVerified: true },
  });
  console.log('UPSERT_OK', JSON.stringify(u));
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
```

要点：`isVerified: 1`（否则登录被拒，`server/src/password/service.ts` 明确要求）；`termsAcceptedAt` 造号时给上，减少一次条款确认；**不要**自己用外部库生成 Argon2 PHC —— 必须带服务端同一个 pepper，只有容器内的 `hashPassword` 能对上。

## 4. 一键登录脚本

`bash scripts/login-device-staging.sh` —— 读 `.local/test-account.env`（或环境变量），用 adb 自动走完第 2 节的 1–6 步。真机 USB 会掉线，脚本内置重连重试。已登录则直接退出。

## 5. 踩过的坑（都是实测）

- **USB 真机易掉线**：`adb: no devices/emulators found` 偶发。脚本每步带 `adb reconnect offline` 重试；必要时重新插线并解锁信任。
- **键盘把登录表单顶得滚动**：填完一个字段后坐标会变，所以脚本每一步都重新 `uiautomator dump` 按 `resource-id` 取坐标，不用固定坐标。
- **必须先过隐私联网同意**：登录点下去才弹「同意并联网」，点了之后回到表单再点一次「登录」。
- **签名不要乱变、严禁卸载**：调试包必须用发布 key（见 `docs/runbooks/android-build-on-linux-dev.md`），升级用 `adb install -r`（原地、保数据）；**绝不 `adb uninstall`**（会清登录态，逼人重登）。
