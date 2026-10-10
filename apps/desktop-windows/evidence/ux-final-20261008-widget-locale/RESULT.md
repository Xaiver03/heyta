# UX-S9-143：Windows 原生小组件语言

2026-10-08完成源码实现与定向验证；未镜像到主树，也未重包MSIX。

应用语言通过宿主 `setWidgetLocale` 写入包内独立的 `locale.txt`；只接受 `zh-CN` 与 `en`，不含账号、任务或密钥。清除加密小组件状态保留该设备偏好。Provider唤醒时读取应用语言；没有有效偏好才使用系统语言（中文映射到zh-CN，其余到en）。运行中的Provider同时监听快照和语言文件的修改/创建/删除/原子重命名，刷新所有已知卡片。

原硬编码的今日任务、四象限、习惯、专注、占位、数量、任务动作、时长和连续天数现在来自 `packages/i18n`。`scripts/gen-windows-widget-strings.mjs` 从源TypeScript AST生成 `widget-strings.generated.json`，作为Core嵌入资源，Provider无需JS运行时也能读取。`--check`与跨进程语言冒烟纳入现有Windows壳检查入口。没有新词条，也没有新增第三方依赖。

验证：

- macOS上Core构建：0警告、0错误；独立冒烟35项通过。
- Windows真机独立冒烟：35项通过，包含应用语言覆盖系统语言、拒绝非法偏好、跨进程冷唤醒仍读取保存语言、清敏感状态保留设备语言、四模板中英非空/占位、任务动作、习惯单复数、专注时长。
- Windows Provider Debug构建：0警告、0错误；Windows壳Debug（含新桥方法）构建：0错误，1个现有NU1801（NuGet签名索引网络不可达）警告。
- 生成文案与i18n源逐字一致（`node scripts/gen-windows-widget-strings.mjs --check`）。

边界：这些结果证明语言偏好持久化、独立进程读取、卡片数据和桥编译，不等于Windows Widgets Board真实卡片切换语言已验。本机系统Widgets host安装问题不在本次任务范围；最终同源码MSIX重建、重装和系统内可见卡片仍由总验收收口。应用locale事件到Web桥的整条调用由主线程并行实现，本任务没有改共享locale/app-host类型。

日志与本轮源码SHA均在本目录。路径标识是测试构建目录，不含私有凭据或任务数据。
