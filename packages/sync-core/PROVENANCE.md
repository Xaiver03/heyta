# 出处说明（Provenance）

本包**不是 heyta 原创代码**，是 vendored（内联复用）自开源项目的第三方代码。

## 来源

| 项 | 值 |
|---|---|
| 上游项目 | **Super Productivity** |
| 仓库 | https://github.com/super-productivity/super-productivity |
| 路径 | `packages/sync-core/` |
| **commit** | `aa9690ca28aa6751971dd0e47d9b39c5b72922cb` |
| **commit 日期** | 2026-09-24T20:59:28+02:00 |
| License | **MIT** |
| 版权 | Copyright (c) 2018 Johannes Millan |

原始 `LICENSE` 文件完整保留在本目录下，未作修改。

## 我们对上游代码做的唯一改动

1. **`package.json` 的 `name`**：`@sp/sync-core` → `@heyta/sync-core`
   （已验证：`src/` 与 `tests/` 中**没有**对该包名的自引用，改名不影响任何代码）
2. 在 `package.json` 增加 `typecheck` script（与 `test:typecheck` 等价，便于工作区统一调用）

**除此之外，`src/` 与 `tests/` 的代码与上游逐字一致、未作任何修改。**

> 保持零改动是刻意的：这样将来上游修 bug 时，我们可以直接 diff 并同步。

## 为什么 vendor 而不是依赖 npm

`@sp/sync-core` **没有发布到 npm**（`registry.npmjs.org/@sp%2fsync-core` → `{"error":"Not found"}`），
上游是把它作为 monorepo 内部工作区包使用的。因此只能内联。

## 为什么可以这样用（许可证依据）

MIT 许可证允许"use, copy, modify, merge, publish, distribute, sublicense"，
条件是**保留版权声明与许可声明**。我们保留了原始 `LICENSE` 文件，
并在仓库根的 `THIRD_PARTY_LICENSES.md` 中登记了归属。

**MIT 允许闭源商用**，不受 heyta 自身许可证选择（见 `docs/adr/0001-license-decision.md`）的影响。

## 更新上游代码的方法

```bash
# 1. 拉取上游
git clone --depth 1 https://github.com/super-productivity/super-productivity /tmp/sp

# 2. 看上游在 vendored commit 之后改了什么
git -C /tmp/sp log --oneline aa9690ca..HEAD -- packages/sync-core/

# 3. 只有在确认需要时，才把改动搬过来并更新本文件的 commit 记录
```

## ⚠️ 不要修改本包代码

heyta 自己的逻辑**不应该写在这里**。集成代码请放在 `packages/domain/` 或应用层，
通过 `src/ports.ts` 里的 7 个 host Port 接入。

改动本包会让"跟随上游更新"变得昂贵。
