# 单元结果（原始 JSON）

| 文件 | 单元 | 范围 | 发现 | P0 |
|---|---|---|---|---|
| U01a-sqlite.json | U01a | `storage/src/sqlite/**` | 10 | 2 |
| U01b-idb-memory.json | U01b | storage indexeddb + memory + db-op-log-store | 14 | 3 |
| U02a-oplog-schema.json | U02a | `op-log` engine + state | 3 | 1 |
| U02b-domain-1.json | U02b | domain events / date / activity-categories / habit-review | 5 | 3 |
| U02c-domain-2.json | U02c | domain recurrence / reminders / ticktick-import | 3 | 0 |
| U03-sync-core.json | U03 | `sync-core` | 6 | 2 |
| U04a-sync-client.json | U04a | `sync-client` | 9 | 3 |
| U04b-ai.json | U04b | `ai` | 8 | 2 |
| U05a-apphost-1.json | U05a | app-host actions/admin/ai-* | 6 | 0 |
| U05b-apphost-2.json | U05b | app-host entitlement/central-auth/host | 7 | 0 |
| U05c-apphost-3.json | U05c | app-host inbound-* | 7 | 0 |
| U06a-vault-share.json | U06a | app-host vault + share | 8 | 1 |
| U08a-sync-routes.json | U08a | server/src/sync routes | 5 | 0 |
| U08b-sync-services.json | U08b | server/src/sync/services | 4 | 1（**已证伪**） |

合计 **95 条**（另有 U07 local-api/inbound/widget 14 条在会话中返回、已并入报告）= **109 条**。

聚合去重 + 对抗验证结果见 `docs/plans/crash-audit-report-2026-11-08.md`。
**未覆盖单元**：U09/U10（server billing/auth/api.ts）、U11/U12（desktop/web）、U13–U21（mobile/ui/原生壳）。
重跑时把单元切到 300–400KB 以下，每批 ≤6 个。
