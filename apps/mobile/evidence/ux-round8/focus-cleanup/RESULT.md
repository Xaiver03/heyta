# UX-S9-142：专注刷新与清理的代际屏障

日期：2026-10-08。来源：受控实施树；本轮未镜像主树。

## 已修复

1. 旧启动/回前台 wake 在等待宿主或 drain 时被清理取代，之后不能领取新的发布 epoch。启动即绑定清理代际，异步返回后复查 epoch、生命周期 owner 和当前已就绪 host。
2. 清理等待所有已启动的原生实时活动异步调用，之后才允许调用原生清理。Swift `clearWidgetState` 真正 `await FocusActivityRefresh.endAll()`，成功完成后才 resolve；容器清理失败时仍关闭活动，并 reject 原清理错误，保持失败屏障。
3. 停止后的旧 wake 不因 lifecycle 重启而恢复；旧 stop 重复调用不会销毁新 owner 的监听。
4. 专注任务选择每次通过当前 ready host 复用共享 `createTaskActions().listTasks/listPendingTasks`；切换宿主不再从原组件缓存的旧 host 读取任务或统计。

快照触发仍只订阅计时状态机变化；显示 tick 和保存回执不重新封包写盘。开始/暂停/恢复不制造任务 op，自然完成/中止仍使用原有共享写入口。

## 证据

- `before.log`：正式回归先红，3 failed / 5 passed。失败分别是清理后旧 wake 重发、清理没有等待在途 activity、停止后的旧 owner 重发。
- `after.log`：5 文件 50/50，含原有组件发布/清理桥测试、计时语义刷新、两项在途时序、owner 销毁、多 activity 等待、重叠清理失败屏障，以及真实 SQLite `:memory:` 宿主换代。
- `focus-task-source.spec.ts` 使用两个真实 `openAppHost`、真实任务动作和 SQLite。关闭旧内存宿主后额外设读取拒绝探针，当前来源为空时列表清空，新宿主写入后只读取新任务，刷新没有产生写入。
- `typecheck.log`：移动端 TypeScript rc=0。
- `swift-parse.log`：桥文件 Swift 语法解析 rc=0。
- `ios-app-build.log`：iOS Simulator Release **App target 与 WidgetExtension 同时 BUILD SUCCEEDED**，明确包含本轮清理专段；不把语法解析当成真实编译。
- `verification.json`：对应源码 SHA、测试读数和原生产物位置。

## 边界

本轮编出的 iOS 候选没有安装，没有在实体 iPhone 验证锁屏或灵动岛显示。不能据此勾掉系统组件实际添加、全模板深浅主题、四端同源码发布等交付项。

活取 ready host 证明下一次刷新使用新宿主。数据库销毁时立即通知所有已挂载屏幕清空旧内存状态，仍属于全应用生命周期需求；本测试不冒称覆盖所有屏幕的即时清屏。

本轮屏障阻止旧 wake 在异步返回后重新发布，但没有改写 `drain.ts` 的原生读取到共享写入口这段流程。不能把发布代际检查解释成已经取消所有在途 drain 写入；宿主销毁后的写入失败与退出时保留本地数据的语义仍由上层生命周期约束。

对根任务新增 `open-host` 代际与 `native-widgets` 语言串行接线的独立只读复审：缓存交付/重试与旧失败隔离、语言更新跨 restart 串行及失败恢复符合测试意图，未发现新增实现错误。宿主测试替换了 `openAppHost`，不能证明共享宿主内部初始化副作用被撤销；该范围需保持准确。
