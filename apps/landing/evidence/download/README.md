# `/download` 的人眼复核证据（2026-10-07）

`AGENTS.md` §6.2 规定一：界面结论只有截图算数，而且**人必须真的打开看过**。
这两张是产品负责人要求"下载界面做一个出来"那一轮的现场。

| 文件 | 看什么 | 结论 |
|---|---|---|
| `download-zh-2026-10-07.png` | 整页：八端一张不少、只有 macOS 有出口、其余每一端各自写明差在哪一步 | 已看过。页头下面那段空隙是外壳自己的（`.lp-page__head` 的顶距，`/platforms` 同形），不是本页的缺陷 |
| `finder-macos-2026-10-07.png` | 系统识别那一档在 Mac UA 下的形状 | 已看过。它写「看起来你在这一类机器上」而不是「已替你选好」—— 浏览器读不出芯片，而包是分芯片的 |

## 这一轮看图时当场改掉的两处

1. **`lp-wrap` 套了两层**：`SiteSubPage → PageSections` 已经包过一次，正文自己又包一次，
   得到双份左右内边距 + 一段不属于外壳的顶距空隙。
2. **六张卡各挂一条「这一端现在到哪一步了」**：macOS / Windows / Linux 三端在状态页
   **同一个** `#desktop` 锚点上，于是同一页出现三条指向同一处的链接。摘掉卡片级的，
   只留页末那一条（判据：`tests/downloads.spec.tsx`「状态页的入口整页只有一条」）。

## 怎么重跑这两张图

```bash
cd e2e && npx playwright test --config playwright.landing.config.ts landing/download.spec.ts
# 图落在 e2e/landing-results/（gitignore 里），要留证就拷进本目录并写清日期
```

⚠️ 这一套 `webServer` 里带一次 `build`，所以拍的永远是**当前源码的产物**（§7 第 27/82 条那一族）。
清单快照 `apps/landing/src/site/release-manifest.json` 决定页面上有没有按钮 ——
它是分发桶 `latest.json` 的逐字抄件，理由见 [ADR-0058](../../../../docs/adr/0058-download-page-and-manifest-single-source.md)。
