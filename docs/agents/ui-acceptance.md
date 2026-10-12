<!-- 由 heyta/AGENTS.md 按作用域拆分而来（2026-10-12）。内容零删除。
     本文件是「界面验收的两条硬性规定」的完整规则（原文 §6.2）。返回入口：[`AGENTS.md`](../../AGENTS.md)。
     原始单体文件备份：`AGENTS.md.bak-full-2026-10-12`。 -->

### 6.2 界面验收：两条**硬性规定**（不是建议）

#### 规定一：Playwright 必须真跑，而且**必须截图 + 人真的看**

任何"界面能用 / 界面画出来了"的结论，**只有截图能作为证据**。
`pnpm check` 绿、元素断言过、元素数量对 —— **都不算**。

```bash
cd e2e && npx playwright test tests/<某个>.spec.ts
# 截图落在 e2e/test-results/ 下，固定文件名，直接打开看
```

写验收时必须做到这四条（后来者不要删）：

1. **先截图，再断言。** 截图在 `try` 之前就落盘，**失败时也要有图** ——
   否则失败只会得到一个 `Test timeout of 60000ms exceeded`，它**不会告诉你
   界面长什么样**。
2. **截图放固定路径**（如 `e2e/test-results/desktop-window.png`），不随测试名变化，
   这样 `pnpm check` 之后可以直接打开同一个文件看。采集前清除同名旧文件，
   采集失败不得沿用旧图；工具切换传输方式时，AX、手势、截图调用必须一起切换（环境陷阱 #208）。
3. **抓控制台 `console` 与 `pageerror`**，并在断言失败时打印。
   白窗口的根因**几乎只在这里现形**（模块 404、CSP 拦脚本、React 抛错）。
   ⚠️ 监听要在**窗口一创建**就挂上（Electron 用 `app.on('window')`），
   挂晚了收不到加载期错误 —— 输出会显示"控制台无内容"，那是最误导人的结果。
4. **人必须打开那张图看一眼。** 不是"截了就算"，是"看了才算"。

移动端真实 AX 验收在滚动后必须重新读取当前节点的 bounds，再计算点击/滑动坐标；不能复用滚动前的
屏幕坐标或旧 AX 树。ScrollView 底部的登录、保存和解锁按钮尤其如此，否则点击可能返回成功却作用于
错误节点，必须回读 UI 和 SQLite 状态确认实际业务动作。

Android Vault 验收还必须把恢复码控件的滚动、输入和业务回读分开记录：隐藏键盘后再滚动，
每次滚动后重新抓 AX bounds；ADB 连续快速退格会丢字符，清空文本框要逐键退格并留间隔。
设备撤销后的固定顺序是 token-version fence → 重新认证 → 恢复码解锁 → 新 E2EE 口令/恢复码
发布 → keyVersion 与 payloadKeyVersion 对账。Node host 的 `--db`、`--server`、`--token`、
`--password`、`--account-id` 是全局参数，必须放在 `sync`/`list` 命令之前；缺 `account-id`
会误选 legacy codec。只报告 `synced` 或 CLI 退出码不够，必须回读 payload generation、任务
列表和 pending；空历史不能冒充跨端互读（环境陷阱 #248）。

**为什么定成硬性规定 —— 这是当天实测出来的三连击。**
桌面端窗口**全白**，而当时的断言只写了"某个元素可见"。加上截图之后，
**一张图连续抓出三个各自独立、断言都没报出根因的 bug**：

| # | 界面上看到的 | 真实根因 |
|---|---|---|
| 1 | 全白，`launch()` 直接超时 | `app.getAppPath()` 是**入口脚本所在目录**（`dist/`），不是包根 —— 拼出的 `dist/renderer-dist/index.html` 不存在。🔴 **这个 bug 从占位页时期就存在，桌面端从来没显示过东西。** |
| 2 | `宿主不可用：TypeError: Cannot read properties of undefined (reading 'request')` | 同一类错误：`preload` 路径多拼了一层 `dist`。preload 缺失时 Electron **不报错、照常开窗**，只是 `window.heytaDesktop` 是 `undefined`。 |
| 3 | 全白，`#root` 长度为 0 | 少了 `<HeytaUiProvider>`（共享组件**主动抛错**而不是静默降级，这点值得表扬） |

三条里有两条的症状是"白屏"，而**白屏在自动化里最阴的地方是它什么都不报**：
不崩、不 timeout（除了第一条）、日志干净 —— 只是"那个元素没出现"。
只有图能一眼区分"没渲染"和"渲染成了空白"。

#### 规定二：跑验收**不要抢前台**

**任何会开窗口的操作（Electron 冒烟、真浏览器、模拟器）都必须在后台跑，
且不得抢走用户的输入焦点。** 用户可能在同一个界面上做别的事，
每跑一次测试就把人踢出正在做的事，是不可接受的。

- 命令用**后台任务**跑（`run_in_background`），不要卡在前台。
- Electron 窗口必须**不抢焦点**：已有实现见 `apps/desktop/src/main.ts`
  的 `NO_FOCUS`（`focusable: false` + `showInactive()`），
  由环境变量 `HEYTA_DESKTOP_NO_FOCUS=1` 打开，
  GUI 冒烟在 `electron.launch({ env: … })` 里传它。
- ⚠️ 光用 `showInactive()` 在 macOS 上**不够** —— 窗口仍可能因为"可聚焦"
  而被激活。`focusable: false` 才是硬保证。
- 新增任何会弹窗的验收脚本时，照这个模式做，别等用户投诉。
- 🔴 **验证载体的默认顺序（2026-09-29 产品负责人拍板）**：Web UI 的验证
  **默认优先用外接浏览器**（Playwright，无头、不开任何原生窗口）——
  只有"必须看原生壳里长什么样"的判据才起原生壳，且启动必须带
  `HEYTA_NO_FOCUS=1`（macOS 壳已支持；Electron 用 `HEYTA_DESKTOP_NO_FOCUS=1`）。
  2026-09-29 当天壳级验收反复把用户从前台拽走，这条就是那天的产出。

---
