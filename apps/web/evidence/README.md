# Web 端证据目录

> 索引，不是规则。只回答：**这张图在为哪条结论作证？**
> 完整规则与删除规程见 [`apps/mobile/evidence/README.md`](../../mobile/evidence/README.md)，
> 两边同一套（png + `uiautomator` 不适用于 Web，Web 的读数一律取 `documentWidth` /
> `bodyWidth` / 可见元素 `scrollWidth` 等 DOM 实测值，随截图一起落盘）。

现量（2026-11-14）：**193 个一级子目录 / 3406 个文件 / 278 MB**。

## 什么时候留、什么时候删

| 情形 | 处置 |
|---|---|
| 被文档 / 计划 / 脚本按路径引用（`apps/web/evidence/<目录>/…`） | **留** |
| 工作已关闭、零引用、mtime 超过 24h | 可删 —— 但**必须先归档到仓库外** |
| 目录名带今天日期 / 24h 内有变动 | 🔴 不删，先问 |

🔴 **本目录不入库**（`.gitignore` 的 `apps/*/evidence/`，2026-11-09 `e760da75`）。
`git rm` 会 `fatal: pathspec did not match`，`git log --all -- apps/web/evidence/<目录>`
提交数是 **0** —— 删了**不能从 git 恢复**。归档步骤见 mobile README §5。

## 主力子目录 → 它服务的那份文档

按体积前 14 个（全量映射用 mobile README §4 的命令把 `mobile` 换成 `web` 现算）：

| 子目录 | 体积 / 文件 | 服务的关键文档（括号内是命中处数） |
|---|---|---|
| `ux-final-20261008/` | 27 MB / 112 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(18); `scripts/check-android-gradle-remote.mjs`(4) |
| `ux-final-20261012/` | 20 MB / 64 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(9); `BLOCKED.md`(1) |
| `global-responsive-ux/` | 12 MB / 252 | [`global-responsive-audit-2026-10-07.md`](../../../docs/research/global-responsive-audit-2026-10-07.md)(6); `e2e/tests/global-responsive-ux.spec.ts`(1) |
| `sync-privacy-leg-1010-r46-family/` | 8 MB / 118 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(1) |
| `sync-privacy-leg-1009-r44-visual/` | 8 MB / 107 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(8) |
| `sync-privacy-leg-1009-r18/` | 7 MB / 106 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(1) |
| `sync-privacy-leg-1009-r20/` | 7 MB / 106 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(1) |
| `sync-privacy-leg-1009-r11/` | 6 MB / 84 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(1) |
| `sync-privacy-leg-1009-r8/` | 6 MB / 76 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(1) |
| `ux-closeout/` | 5 MB / 60 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(9); [`app-distribution.md`](../../../docs/runbooks/app-distribution.md)(4) |
| `sync-privacy-leg-1009-r21-carrier/` | 4 MB / 40 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(1) |
| `ux-final-20261009/` | 4 MB / 52 | [`product-ux-optimization.md`](../../../docs/plans/product-ux-optimization.md)(10); [`account-standard-suite.md`](../../../docs/plans/account-standard-suite.md)(1) |
| `sync-privacy-leg-1009-r13/` | 6 MB / 84 | **零强引用** |
| `sync-privacy-leg-1010-r48-family/` | 8 MB / 121 | **零强引用** |

`sync-privacy-leg-*` 是同步隐私那条线逐轮（r5 / r8 / r11 / r12 / r13 / r18 …）的
取证现场：同一形状反复重拍，只有少数几轮被正文引用。判断哪些还有用，
**看正文有没有指向它，不要看轮次号大小**。

## 本轮（2026-11-14）零引用候选

现量：**20 个目录 / 635 文件 / 48.2 MB**。体积前 6：

| 子目录 | MB | 文件 |
|---|---|---|
| `sync-privacy-leg-1010-r48-family/` | 8.1 | 121 |
| `sync-privacy-leg-1009-r13/` | 6.3 | 84 |
| `sync-privacy-leg-1010-r51-threelegs/` | 3.5 | 43 |
| `reminder-row-two-line-r147/` | 2.7 | 31 |
| `sync-privacy-leg-1009-r24-rolecheck-revert/` | 2.7 | 31 |
| `sync-privacy-leg-1009-r26-pairjudge-main/` | 2.7 | 31 |

## 相邻

- [`apps/mobile/evidence/README.md`](../../mobile/evidence/README.md) —— 完整规程在这一份
- `docs/agents/ui-acceptance.md` —— 界面验收硬性规定
