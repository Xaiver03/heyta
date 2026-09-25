# 出处说明（Provenance）

本包**部分为 vendored（内联复用）**，部分为 heyta 原创改造。

## 来源

| 项 | 值 |
|---|---|
| 上游项目 | **Super Productivity** |
| 仓库 | https://github.com/super-productivity/super-productivity |
| 路径 | `packages/shared-schema/` |
| **commit** | `aa9690ca28aa6751971dd0e47d9b39c5b72922cb` |
| License | **MIT** |
| 版权 | Copyright (c) 2018 Johannes Millan |

原始 `LICENSE` 文件完整保留在本目录下。

## 逐文件说明：哪些是上游的，哪些是 heyta 改的

| 文件 | 状态 | 说明 |
|---|---|---|
| `src/supersync-http-contract.ts` | ✅ **上游原样**（384 行） | HTTP 线协议：端点常量、限制、错误码、zod schema。**未作任何修改** |
| `src/migrate.ts` | ✅ **上游原样**（303 行） | 双向迁移框架，设计干净，直接复用 |
| `src/migration.types.ts` | ✅ **上游原样**（84 行） | 迁移类型定义 |
| `src/entity-types.ts` | 🔧 **heyta 重写** | 上游是 21 项 SP 专属硬编码清单，与 heyta 实体完全不同 |
| `src/schema-version.ts` | 🔧 **heyta 重写** | 版本号重置为 v1（新项目无历史包袱），但**完整继承上游的 bump 政策** |
| `src/migrations/index.ts` | 🔧 **heyta 重写** | 迁移注册表清空（heyta 从 v1 开始），保留"如何新增迁移"的政策说明 |
| `src/index.ts` | 🔧 微调 | 移除 `PROJECT_DELETE_WINS_SCHEMA_VERSION` 导出；新增 `isEntityType` 导出 |
| `package.json` | 🔧 微调 | `@sp/shared-schema` → `@heyta/shared-schema`；增加 `typecheck` script |
| `src/migrations/*-v*-to-v*.ts` | ❌ **已删除** | 上游的 3 个迁移全部是 SP 专属（如 `MiscToTasksSettings`），对 heyta 无意义 |
| `tests/migrations/` | ❌ **已删除** | 上述迁移的测试 |

## 我们保留的测试

| 文件 | 说明 |
|---|---|
| `tests/migrate.spec.ts` | 迁移框架自身的测试 |
| `tests/supersync-http-contract.spec.ts` | 线协议契约测试 |
| `tests/released-client-compatibility-policy.spec.ts` | 把"已发布客户端兼容性政策"做成**可执行测试** —— 这个思路很好，保留 |

## 为什么不整体重写

`supersync-http-contract.ts` 那 384 行 zod schema 是**照着真实运行的系统逐条对齐出来的**，
包含了端点限制（`MAX_OPS_PER_UPLOAD = 100`）、完整错误码分组、
甚至"错误回显字段也要限长"这类安全细节。**重写它等于把这些知识重新踩一遍。**

`migrate.ts` 的迁移框架同理——它是几十次线上版本迁移喂出来的。

## 更新上游代码的方法

```bash
git clone --depth 1 https://github.com/super-productivity/super-productivity /tmp/sp
git -C /tmp/sp log --oneline aa9690ca..HEAD -- packages/shared-schema/
```

⚠️ 注意 `entity-types.ts` / `schema-version.ts` / `migrations/` 是**我们主动分叉**的文件，
**不要盲目跟随上游覆盖**。真正值得跟进的是 `supersync-http-contract.ts` 与 `migrate.ts`。
