# 小组件队列确认与清理回归

2026-10-08，受控实施树运行四个定向测试文件：

```sh
pnpm --filter @heyta/mobile exec vitest run tests/credential-wipe.spec.ts tests/widget-bridge.spec.ts tests/widget-drain.spec.ts tests/widget-publish.spec.ts
```

4 文件、45 项通过。覆盖桥接清理 reject/false 不得报告成功、确认失败保留队列、成功项精确确认、快照规划。Android Kotlin 另在 Windows 构建机验证；本记录不代替系统桌面实际点击，也不证明最终 APK 包已更新。
