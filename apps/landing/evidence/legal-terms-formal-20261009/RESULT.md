# 法律条款正式化与竞品关系声明清理（2026-10-09）

## 结果

- 对外《服务条款》不包含“个人项目，与滴答清单 / TickTick 及其关联公司无任何关系”声明。
- 对外正文不再包含内部 GDPR 适用性核对表；该审查材料保存在 `docs/research/legal-terms-gdpr-review.json`，由 `scripts/check-legal-gdpr.mjs` 读取并校验。
- 条款版本从 1.4 更新为 1.5，保留草案状态；本次修改只涉及对外措辞、章节边界和展示正式化，不构成法务审阅或协议生效批准。
- 中英文结构一致；第 1、2、4、6、10 节标题和表述改为合同主体、服务边界、账户活动、数据范围、服务期限、修订与同意记录等正式表述。

## 验证

- `pnpm --filter @heyta/legal typecheck`：通过。
- `pnpm --filter @heyta/legal build`：通过。
- `node scripts/check-legal-gdpr.mjs`：通过；内部审计 8/8 文档指针、每行缺口和越界声称检查通过。
- `node research/tools/verify-landing-dist.mjs apps/landing/dist heyta.waytofuture.cn`：通过。
- `node scripts/check-web-artifact.mjs --mount /app/ --dist apps/web/dist`：通过。
- 法律包 Vitest 本轮因立即可用内存低于 384MB 启动闸门未运行，不将其记作测试通过。

## 发布

- 远端发布主机：`ubuntu-jcli`。
- 发布前已创建回滚备份：`/tmp/heyta-public-backup-20261009-013038.tgz`。
- 站点与应用静态产物均已重新构建并上传；Landing 与 Web 的文件树 SHA-256 对账通过：
  - `apps/landing/dist`: `015c3b9d0a65d0d686d366e420855d88e7e7f5dac69e0e07662fb7e205bbf171`
  - `apps/web/dist`: `39ac0e4565ca904596ab778126bca5b726e15375539824ff986c210bea6c2a57`
- 线上 `https://heyta.waytofuture.cn/legal/terms/` 回读显示 12 个正式章节，包含“合同主体、适用范围与服务边界”，不包含竞品关系声明或 GDPR 审查章节。

## 2026-10-09 追加修订

- 版本记录中的内部合规项目名称也已移除，改为“相关内部合规记录同步归档”等对外可理解的版本摘要；正文、章节编号、版本号和同意指纹不变。
- 法律包、Landing 与 Web 已重新构建并再次上传至 `ubuntu-jcli`；新回滚包为 `/tmp/heyta-public-backup-20261008-180430.tgz`。
- 本次上传后 `index.html` 字节对账通过：Landing `b212ac79800d678f8eb9cefa762c460d185d7236fea0efc126188a239420dcee`，Web `/app/` `47386ac31b42128217621346823ac3f6ecb7aee538407a247ff12956e13e5da9`；产物自洽校验、Web 挂载校验、GDPR 内部审计门禁和 `git diff --check` 均通过。

## 2026-10-09 02:29 级联事实与竞品声明复核

- 隐私与数据权利正文已按迁移真源更新为 34 条级联外键、覆盖 33 张表，并补列自动化权益绑定与自动化权益票据使用记录；中英文结构门禁已同步。
- 法律包 Vitest：4 个测试文件、76 条全部通过；不再保留“因内存闸门未运行”的旧状态作为当前结论。
- 新回滚包：`/tmp/heyta-public-backup-20261009-022940.tgz`。
- 本地/远端 `index.html` SHA-256：Landing `3daf9db8eb7c8b62c8e7d6b100286b1fadb9e98020009a7553bb708b76101301`；Web `/app/` `435bfa315489d38dde6fffe70105b1cf9e55001d3865536cb0864ac682acc428`。
- 公网 `/legal/terms/` 回读未发现竞品关联声明、内部 GDPR 项目名或内部审计表。
