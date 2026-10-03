# R10 / R12 的界面取证（真浏览器 · 无头 Chromium · 静态构建产物）

> 采集时间：**2026-10-03 01:07 CST**
> 载体：`apps/web/dist`（`pnpm --filter @heyta/web build` 的产物）由一个只监听
> `127.0.0.1:5199` 的一次性静态服务提供，Playwright **无头** Chromium 驱动。
> 上位文档：[`docs/plans/ui-review-fill-zh-timeline.md`](../../../../docs/plans/ui-review-fill-zh-timeline.md) §8.7 / §10.1

## 为什么不是 `pnpm check:ai-e2e`

那个套件会先 `pkill` 机器上在跑的 vite dev server（AGENTS §7 第 87 条）。
本轮工作树与另一条线共用，那一条线的 dev 进程正活着 —— 所以这里换一条
**不启动 vite、也不杀任何进程**的载体：静态产物 + 无头浏览器。
无头因此同时满足 §6.2 规定二（不抢前台）。

## 这四张图证明什么

| 文件 | 证明的判据 |
|---|---|
| `account-menu.png` | 身份区（邮箱）→ **编辑个人信息** → 设置 → 退出登录（危险色、最底）。R10 要的"头像 → 菜单 → 二级页"形态成立，且新入口插在**身份区之后、设置之前**（§8.4 第 1 条那条排序裁决）。 |
| `profile-light.png` | 设置浮层第一屏就是「个人信息」：头像圈（消费 `--ht-size-avatar-lg`）/ 换一张 / 昵称框 / 保存 / 邮箱只读 + 为什么只读。**昵称框里的「小鹿」是从 `/api/account/profile` 读回来的**，不是组件初值 —— 这一条把它和 jsdom 用例区分开：真浏览器里读取通路也成立。 |
| `profile-dark.png` | 暗色是**实际切过**的（`<html data-theme="dark">`，即 `lib/theme.ts` 的机制），不是亮色反相：卡片底、边框、主蓝按钮、muted 说明文字各自都换过值。AGENTS §5 那条"不测暗色主题就交付"。 |
| `rail-with-quadrant-active.png` | R12：四象限在 rail 上的**真实 16px 像素**（不是候选图），`Move` 读得出"两条带箭头的轴交叉"= 她要的坐标系感。候选对比图在 [`../quadrant-icon/candidates-16px.png`](../quadrant-icon/candidates-16px.png)。 |

## 🔴 这几张图**没有**证明的三件事（别读多）

1. **没有真的上传图片。** 图里是"本机没有端到端加密口令"的状态 —— 那是冷启动的
   **真实默认态**（口令从不落盘），界面因此给的是那句陈述句而不是错误红字。
   上传/移除的通路判据在
   `packages/app-host/tests/hosted-account-profile.spec.ts`（真跑 Argon2id + AES-GCM
   的**双向证明**：口令能解回原图、明文里没有图片字节）与
   `server/tests/account-profile.spec.ts`（服务端只收密文形状、hash 由服务端算）。
2. **后端是假的。** 只有 `/api/account/profile` 一条路由被回答，其余一律 404。
   ⚠️ 这一条本身就是取证踩到的坑：第一版对 `/api/*` **一律回 200 `{}`**，
   于是运营后台以为拿到了合法 overview，在 `AdminPanel.tsx:211` 读
   `overview.total` 时抛异常、整个设置浮层被 React 卸掉 ——
   症状看起来完全像"个人信息打不开"。**桩对没问过的路由许诺真值，就会造出别人的红。**
3. **移动端 / macOS 壳 / Windows 壳没有。** 按 §6.1.1 那是各自一端的判据，
   而且移动端「账号与安全」屏（`apps/mobile/src/screens/ProfileScreen.tsx`）
   目前**没有**昵称与头像的编辑入口 —— 那是 R10 剩下的那一半，不许拿这张桌面图冒充。

## 复现

```bash
pnpm --filter @heyta/web build
# 一次性静态服务 + 无头 Chromium：见 docs/plans/ui-review-fill-zh-timeline.md §8.7 的取证那一行
# 要点只有三条：① 不启动 vite；② /api 只回答 account/profile，其余 404；
# ③ 暗色切 data-theme 属性，不用 emulateMedia。
```
