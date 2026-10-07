# 个人中心 IA / UX 浏览器验收

2026-10-07，当前开发工作树，`http://localhost:5173/`。

使用真实 Chromium、真实 React 页面与控件；账号 profile API 为本地路由 fixture，昵称/邮箱为虚构测试数据，所有任务统计为真实空数据库的 0。此证据不证明生产登录、云同步或真实账号读写。

- `desktop-light.png` / `desktop-dark.png`：1440×1000。
- `narrow-light.png` / `narrow-dark.png`：390×844，长昵称/邮箱。
- `growth-disabled.png`：关闭成长后隐藏成就和入口。
- `journeys.json`：视口、主题、横向溢出测量与编辑/设置往返结果。

用户旅程：头像 → 个人中心 → 编辑资料（昵称自动聚焦）→ 保存 → 返回（显示新昵称）→ 设置 → 返回 → 关闭。截图为编辑前，机器记录为实际旅程完成后写入。暗色宽屏与窄屏已经人工查看；窄屏底部完整成长操作通过页面滚动可达。

复现：仓库根目录运行 `node scripts/qa/profile-center-ux.mjs`。该脚本只访问本机 Web，fixture 账号请求被拦截，不向真实服务端写入。

键盘追加验收通过：方向键打开菜单后第一项获焦，Enter 进入个人中心，Esc 关闭并返回头像；完整成长跳转与关闭模块场景同样通过。
