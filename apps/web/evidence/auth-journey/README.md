# D：共享 UI 的认证旅程（真 WebAuthn）—— RP ID 必须是域名，不能是 IP 字面量

> 采集时间：**2026-09-30**（CST）· 入口：`pnpm verify:web-auth`
> 上位文档：[`docs/plans/desktop-storage-host-handoff.md`](../../../../docs/plans/desktop-storage-host-handoff.md) §6

## 这份产物证明什么

`journey-pass-localhost.txt` 是**绿的那一轮**：`6 passed`、exit 0。
J1–J6 走的是**真** WebAuthn（Chromium 的虚拟认证器，challenge / 签名 / origin 校验全部真实发生），
覆盖：**注册 → 登录 → 建任务并同步（服务端真的收到 op）→ 新设备恢复 → 退出登录 → 失败可见**。

`journey-INJECTION-red-ip-literal.txt` 是**注入的那一轮**：把页面 origin 与 WebAuthn 三元组
翻回 `127.0.0.1`（= 修之前的状态）⇒ **J1 当场红**，而且红得很有信息量：

```
Received string: "这个浏览器或设备不支持通行密钥，改用邮箱登录链接即可。"
```

⇒ **同一份判据在"域名 / IP 字面量"两种输入下给出相反结论。** 这才是它能承重的证据。

## 修的是什么

| | 之前 | 现在 |
|---|---|---|
| Web 应用 origin | `http://127.0.0.1:4329` | **`http://localhost:4329`** |
| WebAuthn `rpId` | `127.0.0.1` ❌ | **`localhost`** |
| `WEBAUTHN_ORIGIN` | `http://127.0.0.1:4329` | **`http://localhost:4329`** |

**根因**：WebAuthn 的 RP ID 必须是 origin 的**域名后缀**，而 **Chromium 拒收 IP 字面量**。
修之前，界面只会说"这个浏览器或设备不支持通行密钥" —— 看起来像**设备能力问题**，
实际是**地址形态问题**。这条症状与原因之间的距离，就是它一直没被修掉的原因。

🔴 **两侧必须用同一个名字**：`vite --host localhost` 与 Playwright 的 `webServer.url`
都是 `localhost`。2026-09-29 踩过的是**混用**（vite 绑 `localhost` 解析到 `::1`、
而 Playwright 轮询 IPv4）⇒ "服务起了却等 120 秒超时"。

## 路上修掉的两个真 bug（都在**判据本身**，不在产品代码）

1. 🔴 **凭据快照没有随登录前进**：`signInOnThisDevice` 每次都注入 J1 注册那一刻的快照，
   而虚拟认证器里的 `signCount` **每次认证都会前进** ⇒ 注入旧快照让计数器**倒退**，
   服务端按 FIDO 规范**拒收**。界面文案是「通行密钥验证没有通过，可以再试一次」——
   **密码学上什么都没坏**，而症状与"凭据不存在"极像。
   修法：登录成功后 `readCredentials` 读回最新快照并更新 `journey.credential`。
   ⚠️ Windows 侧（W2/W3）踩过**完全同一条**。
2. 🔴 **J5 的断言曾经是空真**：退出登录会**把菜单关掉**，而"退出登录项不存在"
   在菜单关闭时恒成立 ⇒ 那一条什么都没判。修法：重新点开头像，在**打开**的菜单上断言。
   ⚠️ 同样是 Windows W5 踩过的形状。

⇒ 这两条都不是产品缺陷，而是**判据自己在空转**。它们只有在 RP ID 修好、
旅程第一次真正跑到底之后才**暴露出来** —— 这正是"阻塞被解开"的第一个副作用。

## J7：桌面壳的**反向授权回跳**（ADR-0039 §2.3）

| 文件 | 它证明 |
|---|---|
| `journey-pass-with-J7-desktop-handoff.txt` | ✅ **7 passed**：J7 打开 `/?auth=desktop&state=…`、用通行密钥登录，兜底链接的 `href` 是 `heyta://auth#token=…&state=<原 state>`，且 **query 里没有 token** |
| `auth-journey-8-desktop-handoff.png` | 人看过：应用已登录，底部是「正在返回 heyta…（如果没有自动跳转，点这里）」 |
| `journey-INJECTION-no-handoff-hook.txt` | 🔴 拿掉 `applyAuthSession` 里的回跳钩子 ⇒ **J7 红**（兜底入口不出现），J1–J6 仍绿 |

⚠️ 这条只验**浏览器侧**"把令牌交回壳"。**壳真的接到并校验 `state`** 还没做
（macOS 的 `ASWebAuthenticationSession` / Windows 等价物），见 ADR-0039 §2.3。

## 如实记边界（别读多）

1. **这条旅程跑在 Chromium（Playwright）里，不是桌面壳里。**
   它证明的是**共享 UI 的认证旅程本身**可用，不是"桌面壳里可用"。
   🔴 macOS 壳里目前**仍不可用**：带焦点实测 `uvpaa=false`（见
   `apps/desktop-macos/evidence/storage-host/`）。
2. **API 仍在 `http://127.0.0.1:3211`**：只有**页面**的 origin 需要是域名
   （RP ID 由它派生），API 的地址形态不影响 WebAuthn。
3. **`localhost` 只适合本机**：它解决的是"开发/验收的自建服务端"。
   生产上 RP ID 是真实域名 —— 这条修法**不是**生产配置的替代品。
4. 截图在 `e2e/test-results/`（已拷到本目录）：`1-未登录` / `2-已注册` / `3-已登录` /
   `4-已同步` / `5-第二台设备` / `6-退出后` / `7-失败可见`。
