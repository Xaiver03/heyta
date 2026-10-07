# @heyta/inbound-core

接收端与客户端共享的入站密码学和请求原语，无数据库、UI、业务 op 或厂商 SDK。
业务编排留在 app-host；版本化线形状来自 shared-schema。

实施状态见[自动收集计划](../../docs/plans/inbound-automation.md)，契约见[协议](../../docs/reference/inbound-automation-protocol.md)。

新增依赖 @noble/curves 2.4.0（MIT）已在引入前用 `research/tools/ghinfo.py paulmillr/noble-curves` 核验：
最近提交 2026-09-08、最近发版 2.4.0（2026-08-27），未归档。
@noble/hashes 已由现有 sync-core 使用。AES-GCM 和安全随机数复用 sync-core 原语。
纯 JS fallback 测试不替代 Hermes 与各平台的真实运行证据。
