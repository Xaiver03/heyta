# Android 小组件缺口修复报告（2026-10-08）

## 已实施

### 1. 暂停状态可见

当前共享快照已经有兼容字段 `endsAt`：运行中带有 `endsAt`，暂停时故意省略。Android 原生模型现在按这个既有契约区分：

- `active=true && endsAt != null` → `ACTIVE`；
- `active=true && endsAt == null` → `PAUSED`。

暂停状态继续显示任务标题和目标时长，同时显示“已暂停，打开 Heyta 继续”（英文为 “Paused — open Heyta to continue”）。没有新增共享契约字段，也没有把发布时的相对倒计时当成实时倒计时。

### 2. 空态正文可返回应用

Focus Widget 的正文容器由 `wrap_content` 改为可占据剩余高度的可点击区域。原有标题头部和空态消息仍保留打开应用的 PendingIntent；现在用户点击空态卡片正文也能返回 Heyta。

## 语言路径结论

本次没有修改共享 React/UI 语言接线，因为原生链路已经完整存在：

1. `WidgetModule.getConstants()` 暴露 `preferredLocale` 与 `deviceLocale`；
2. `resolveDeviceLocale()` 优先读取已选的 Widget/应用语言偏好；
3. `LocalePreferenceProvider` 的 `useEffect` 调用 `setWidgetLocale(locale)`；
4. `setWidgetLocale` 原生持久化并立即 `WidgetRefresh.pushAll`；
5. `WidgetRefresh` 通过 `WidgetLocalePreference.localizedContext` 选择中英文资源。

设备验收时 `heyta_widget_preferences.xml` 的真实值是 `en`。直接用 Android 系统 `cmd locale set-app-locales` 改为 `zh-CN` 不会覆盖已有的显式应用偏好，这是设计上的优先级，而不是同步遗漏；冷启动仍显示英文符合“显式应用偏好优先”。应通过应用设置中的语言选择切换，不能用系统 shell 命令替代用户路径。测试结束已恢复系统应用语言偏好为空列表。

## 范围

本轮只改 Android Widget 原生实现、Android 资源和原生单测：

- `FocusWidgetModel.kt`
- `FocusWidgetViews.kt`
- `widget_focus.xml`
- `values/strings.xml`
- `values-en/strings.xml`
- `FocusWidgetModelTest.kt`

没有修改共享 `packages/widget-core`、React Native UI、同步、法律或总优化清单，也没有重新安装正在使用的设备。

## 验证

通过唯一远程构建入口执行：

```text
node scripts/run-gradle.mjs testDebugUnitTest --tests com.heytamobile.widget.FocusWidgetModelTest
```

结果：`BUILD SUCCESSFUL`，FocusWidgetModelTest 全部通过（13 项）。首次运行中旧断言把没有 `endsAt` 的 active 快照当作 ACTIVE，已按现有契约修正测试夹具；暂停态专测和运行态专测均通过。

尚未做新的 APK 安装态验收：根据交接要求，需由根协调在统一 Windows Gradle 构建后安排安装，避免打断当前设备上的其他验收。
