# Windows 顶部融合验收（UX-S9-135）

2026-10-08，在 Windows 真机的独立 Debug QA 副本上完成。不是最终同源码 MSIX 交付。

| 项目 | 实际结果 | 证据 |
|---|---|---|
| 浅色完整窗口 | 原独立顶栏空带消失，三个原生系统按钮入图；共享 UI 到顶部 | final-light-main.png / .json |
| 深色完整窗口 | 顶部与页面同一表面，无浅色顶栏 | final-dark-avatar-native.png、final-dark-settings.png |
| 弹层 | 遮罩延伸到原生 caption 按钮下方，未被旧 XAML 顶栏覆盖 | final-light-modal.png |
| 原生拖动 | 真实鼠标拖动后窗口 (80,60) → (160,110)，尺寸不变 | final-light-drag.json |
| 原生双击 | 双击后 IsZoomed=true，完整屏幕内可见区域已截图 | final-light-maximized.json / .png |
| 顶部按钮命中 | 原生点击头像弹出账号菜单；详情开关将详情列收起，未被 drag rectangles 抢走 | final-dark-avatar-native.png、final-dark-detail-native.png |
| 窄窗 | 800×680 物理窗口，624×536 CSS viewport，documentOverflow=0，appTop=0，caption 安全区域由实际 ClientSize/innerWidth 换算 | final-dark-narrow.png / narrow-dom.json |
| 原生系统按钮 | 真实鼠标点最小化/最大化/还原/关闭全部通过 | one-shot-finalized.json |
| QA 生命周期 | 原验证副本 exact PID stopped；任务已删除；1277 默认目录文件前后完全一致 | manifest-summary.json |

窄窗底部导航采用横向列表，截图末尾回收站项被局部视口裁切。此结果只证明页面整体没有横向溢出，不能证明所有导航项无需滚动即可看见。同日新生命周期 QA 副本又以真实鼠标点了原生最小化、最大化、还原和关闭按钮，各 Win32 状态读数均通过；关闭放最后，exact finalize 核对默认文件不变。最小化后的首次恢复使用 ShowWindow，仅 caption 最大化后的还原是按钮实点。Snap 悬停仍未实测，保留原生控件不等于该交互已验收。

MainWindow.xaml/.cs 的远端 SHA 与受控源码逐字一致。运行 WebView 的 index SHA 为 `3b86137cc615f63bfe07c7e2128cc206cd3ac441e8f704981feb1b661e8553c3`，加载的是先前从受控树构建传入的 web-dist。远端仓库 base.css 和 runner 仍是较早源码，因此这些远端源码哈希不用于宣称本轮 CSS/runner 已统一发布。保留受控源码 SHA 与运行 DLL SHA，最终发布仍须重新同步、构建和对账。旧 identity 输出的负 elapsedSeconds 是时区减法错误，已弃作证据。

本轮源码将顶栏 hit-test 从实色 XAML 覆盖层换成 AppWindow drag rectangles：仅非交互空白区域可拖动；有 modal 时暂停拖动区域；右侧 caption 区给当前右边 header 与详情容器保留实际 inset。共享布局不再增加整页 padding-top。主树镜像只含这些 chrome 段，保留其它并行功能。

新 runner 独立生命周期运行：复用当前 Debug 与 web-dist，在新临时 QA 根启动后76.69秒核对只有1实例，原生计划任务已删除，runner副本 SHA 与受控源码一致（`one-shot-running.json`）。连接曾临时中断，恢复后 PID 与可执行路径证明原 QA 仍 live，未重起。随后在用户交互会话中真实点原生最小化/最大化/还原/关闭，关闭后 exact finalize：1277 默认文件前后一致，任务不存在，进程0；见 `one-shot-finalized.json`。
