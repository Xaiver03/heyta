# AI 接入网关 —— 目标达成状态（2026-11-22）

> 对照目标 ①–⑤。证据=代码 + 可转红测试 + 门禁。

## 验证快照
| 项 | 结果 |
|---|---|
| server 网关/健康/代理/agent-tools | 51 passed |
| app-host 报表/后台客户端/助手/集成 | 13 passed（app-host 我的文件 tsc 0 错*） |
| mobile tsc | 0 错 |
| check:ai-tools / check:layering / check:i18n-vars / check:ai-coverage | 全 ✅ |

\* app-host 全量 tsc 仍有**既有**测试基线错误（`assistant-sessions.spec.ts`，与本工作无关）。

## 对照
| 目标 | 落地 | 证据 |
|---|---|---|
| ① 服务端网关抽象（多上游/选择/脱敏/热生效） | ✅ | `ai-gateway.ts`/`gateway-store.ts`；`managed-proxy` 按网关选上游；`ai-gateway.spec`(8) |
| ② 管理后台 增删改查/试连/启停/健康 | ✅ | `admin/ai-gateway.routes.ts` + Web `/admin`「AI 网关」分区 + 健康列；`ai-gateway.routes.spec`(6)、`gateway-health.spec`(1) |
| ③ PP 网关接入 | ⏳ **配置就绪，待真实地址** | 作为 OpenAI 兼容上游 `id=pp`，后台/env 填 baseUrl/model/key；`docs/reference/ai-gateway.md`。**未做真实连通验证**（不知地址）。 |
| ④ 周报/年终总结 = Harness 工具，零入口 | ✅ | `ai-report-tools.ts`（weekly_report/year_end_summary，本地聚合，egressFields 齐）；双端适配器传 getReportState；`ai-report-tools.spec`/`ai-cloud-assistant` |
| ⑤ 裁决约束 + 安全审计 + 门禁 | ✅（含记录缺口） | apiKey 不回显/0600/原子写；SSRF/空key/改id 已修；两轮审计 + 处置表；四门禁绿 |

## 已知缺口（诚实）
1. **PP 真实连通**未验证（需你提供地址/密钥后点「试连」）。
2. 上游 **weight 加权分流**未做（当前按 priority+weight 取第一条）；健康仅"冷却跳过"，无主动故障转移。
3. Web 全量 `tsc` 现红但**非本工作**：`CalendarHeaderToolbar.tsx:365` 引用缺失词条（另一会话未提交改动）。
4. 后台页未做浏览器点击验收（需起服务端 + admin 会话）；已用注入测试覆盖路由语义。

## 结论
网关抽象、管理后台（含健康）、Harness 报表工具、审计与门禁均已交付；PP 真实接入与后台 UI 点击验收需外部输入（地址/会话）。
