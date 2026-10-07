# `/download` 的人眼复核证据（2026-10-07）

`AGENTS.md` §6.2 规定一：界面结论只有截图算数，而且**人必须真的打开看过**。
这两张是产品负责人要求"下载界面做一个出来"那一轮的现场。

| 文件 | 看什么 | 结论 |
|---|---|---|
| `download-zh-2026-10-07.png` | 整页：八端一张不少、只有 macOS 有出口、其余每一端各自写明差在哪一步 | 已看过。页头下面那段空隙是外壳自己的（`.lp-page__head` 的顶距，`/platforms` 同形），不是本页的缺陷 |
| `finder-macos-2026-10-07.png` | 系统识别那一档在 Mac UA 下的形状 | 已看过。它写「看起来你在这一类机器上」而不是「已替你选好」—— 浏览器读不出芯片，而包是分芯片的 |
| `download-zh-4of8-published-2026-10-07.png` | **同一页在"四端都发出去"之后的形状**（12:3x）：macOS / Android / Windows / Linux 四张卡各有下载钮 + 文件名/版本/字节数/发布日/SHA-256，iOS 与鸿蒙仍是"差在哪一步"的框 | 已看过。四枚钮都在，两条 caveat 各自印在自己的卡里（Windows 的 SmartScreen、Linux 的"还没有人在自己机器上装过"），没有一张卡把没证的事说成已证 |
| `download-en-4of8-published-2026-10-07.png` | 英文同一套结构 | 已看过，正文零中文 |

## 这一轮看图时当场改掉的两处

1. **`lp-wrap` 套了两层**：`SiteSubPage → PageSections` 已经包过一次，正文自己又包一次，
   得到双份左右内边距 + 一段不属于外壳的顶距空隙。
2. **六张卡各挂一条「这一端现在到哪一步了」**：macOS / Windows / Linux 三端在状态页
   **同一个** `#desktop` 锚点上，于是同一页出现三条指向同一处的链接。摘掉卡片级的，
   只留页末那一条（判据：`tests/downloads.spec.tsx`「状态页的入口整页只有一条」）。


## 12:3x 那一轮看图时注意到的两件事

1. **上面第一行那张"只有 macOS 有出口"是 11:4x 的状态**，不是现状 —— 下午四端都发了。
   留着它是因为它拍的是"清单里少一枚 ⇒ 页面上就少一颗钮"这一档，那一档现在只能靠
   测试里的 fixture 复现（`tests/downloads.spec.tsx` 的 `EMPTY` / `DEV_CHANNEL`）。
2. **网页版那张卡的钮写「开始自建」不是缺陷**：这一套 `webServer` 构建时**没有**
   `VITE_APP_URL`，`siteCta()` 在没有应用入口时整条降级到自建指南，**标签跟着目的地一起变**。
   线上（配了 `VITE_APP_URL`）那一颗是「立即使用」/ "Use it now"（`landing.cta.useApp`）。⚠️ 也就是说：**看本地截图判断线上文案，
   在这一点上会判错** —— 线上形态由 `check:entries` 钉住的那份产物与发布后的 live-site 用例说。

## 怎么重跑这两张图

```bash
cd e2e && npx playwright test --config playwright.landing.config.ts landing/download.spec.ts
# 图落在 e2e/landing-results/（gitignore 里），要留证就拷进本目录并写清日期
```

⚠️ 这一套 `webServer` 里带一次 `build`，所以拍的永远是**当前源码的产物**（§7 第 27/82 条那一族）。
清单快照 `apps/landing/src/site/release-manifest.json` 决定页面上有没有按钮 ——
它是分发桶 `latest.json` 的逐字抄件，理由见 [ADR-0058](../../../../docs/adr/0058-download-page-and-manifest-single-source.md)。
