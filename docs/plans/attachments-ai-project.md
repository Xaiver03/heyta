# 附件 AI 工具 —— 立项 / 可行性

## 结论
- 附件**元数据走 op-log**（`ATTACHMENT` 实体：`CREATE / DEL / RENAME` op，`packages/app-host/src/attachment-actions.ts` 独占构造），**字节走服务端 blob 通道**（`AttachmentBlobPort`，需登录态 + 服务端地址；无端口时端口方法一律 rejected）。
- 因此可安全补的 AI 工具：`list_attachments`（只读本地 op-log）、`rename_attachment`（纯 op）、`remove_attachment`（先发 `DEL` op、字节回收尽力）。三者即可覆盖 `ATTACHMENT`（读 + 写），撤销 `AI-COV-9` 缺口。
- `add_attachment`（上传字节）**不适合 AI**：模型没有文件字节来源。人类上传已有 UI（`TaskDetailCard` 附件区）。AI 的定位是「人类上传后，列出 / 改名 / 删除」。

## 约束（事实）
- 上传与字节回收需要注入 `AttachmentBlobPort`；CLI / MCP / agent-cloud 宿主没有服务端地址与登录态 —— 这些宿主上 `remove_attachment` 只发元数据 `DEL` op，字节留服务端由孤儿扫描回收（`bytesReleased:false` 是既有语义，列表状态仍正确）；`list/rename` 不需要端口。
- 不做加密：字节按 `ADR-0081` 由整库档位在上传前决定形态，动作层只见 base64。
- 一意图一 op；`DEL` 走软删、可逆；无 purge。

## 落地清单（可实现小批）
1. `packages/local-api/src/tools/attachment.ts`：`list_attachments`(read) + `rename_attachment`(write) + `remove_attachment`(write) 的目录/schema/toIntent；`shared.ts` 写 intent 联合 + `ATTACHMENT` 容量；实体名词表确认 `ATTACHMENT` 映射。
2. `packages/app-host/src/local-api-host.ts`：读分支 `list-attachments`（`aliveAttachmentsForTask`）；写分支 `rename/remove` 构造 `createAttachmentActions(ctx,{blobs})`（`blobs` 从 options 注入；缺省用 reject-port）。
3. 五个宿主构造点按需传 `attachmentBlobs`（web 可传真端口；CLI/MCP 不传）。
4. i18n + web/mobile 人话 + `gen-ai-capability-manifest` + 撤销 `AI-COV-9` + 同步 `ai-event-tool-contract.md §5.1` + 测试（含「缺端口时 remove 只发 op、bytesReleased:false」）。
