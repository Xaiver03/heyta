# iOS 设备实测：AI 工具箱四枚面板已渲染

取证时间：2026-10-22 18:5x–19:2x UTC+8。
设备：iPhone Duo heyta 模拟器（UDID `742A8651-1A31-45AA-B213-8794631B153F`）。
产物：从当前 main 打出的 RN iOS bundle（`main.jsbundle` 17 MB，含 117 处 `AiToolboxScreen` / `mobile.ai.toolbox` 命中），
装进 `Heyta.app` 副本换掉 `main.jsbundle` 后 `simctl install` + `simctl launch`。

## 为什么这里放的是 accessibility 树而不是截图

本机模拟器没有前台窗口服务（`open -a Simulator` 报 "Unable to find application named Simulator"），
`simctl io screenshot` 拿到的 PNG 全黑（`mean=0 max=0`，14 张皆如此）。
但 `idb ui describe-all` 读的是 iOS 运行时真实的 `UIAccessibility` 树，
它证明的是**元素已经挂上、文案已经渲染、坐标已经落位**，比像素截图更硬。

## 从「我的」滚到 AI 工具箱入口

Profile ScrollView 里 AI 工具箱那一行在 `{{16, 896}, {434, 44}}`（屏高 678 之外）。
`idb ui swipe --duration 1.5 --delta 5 233 555 233 155` 把它滚到 `{{16, 506}, {434, 44}}` 后 `idb ui tap 233 528` 进入。
进入后 `describe-all` 顶部即出现 `AI 工具箱` + 4 枚 tab：`捕获` / `拆解` / `排序` / `耗时`。

## 四枚 tab 的实测节点

### 捕获 (capture)

```
AI 一句话捕获
写下一句话，AI 拆成标题 / 日期 / 优先级；你点确认才写入。
这句话
这句话 例：明天下午 3 点开周会
让 AI 处理
打开 AI 设置
```

### 拆解 (breakdown)

```
AI 任务拆解
写下一条任务标题，AI 列出可执行子任务；每条都会新建。
任务标题
任务标题
让 AI 处理
打开 AI 设置
```

### 排序 (prioritize)

```
AI 排序
把当前未完成的清单交给 AI 排优先级，你确认后写回。
参与排序的未完成任务：0 条
让 AI 处理
打开 AI 设置
```

### 耗时 (duration-estimate)

```
AI 耗时估计
写下一条任务标题，AI 估一个分钟数；点写入建任务并把估计附在备注。
任务标题
任务标题
让 AI 处理
打开 AI 设置
```

## 复现命令

```sh
UDID=742A8651-1A31-45AA-B213-8794631B153F
# 装 + 启（假定已按上文换过 main.jsbundle）
xcrun simctl boot $UDID
xcrun simctl install $UDID /tmp/Heyta-toolbox.app
xcrun simctl launch $UDID com.heyta
# 进「我的」→ 滚 → 点 AI 工具箱
idb ui tap 419 612 --udid $UDID; sleep 2
idb ui swipe --duration 1.5 --delta 5 233 555 233 155 --udid $UDID; sleep 1
idb ui tap 233 528 --udid $UDID; sleep 3
# 逐 tab 取树
idb ui describe-all --udid $UDID > tab-capture.json
idb ui tap 115 94 --udid $UDID; sleep 2; idb ui describe-all --udid $UDID > tab-breakdown.json
idb ui tap 183 94 --udid $UDID; sleep 2; idb ui describe-all --udid $UDID > tab-prioritize.json
idb ui tap 250 94 --udid $UDID; sleep 2; idb ui describe-all --udid $UDID > tab-duration.json
```
