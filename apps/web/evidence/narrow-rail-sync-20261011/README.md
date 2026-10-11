# 窄屏底部导航那一枚同步项（趟号 r106 / r107，2026-10-11）

这一包是**修完之后**的证据，四张都是同一次运行、同一棵工作树（`HEAD=f16ad4d7` + 本线这几枚改动）。
修之前的形状不在这里 —— 它已由在册判据复现（见下面「牙」那一节，红的那两趟打印的就是 `302→388`）。

## 这四张是什么

`rail-375-light.png` / `rail-375-dark.png` / `rail-390-light.png` / `rail-390-dark.png`
—— 截的是 `nav.ht-compact-rail` 那一枚元素自己（不是整屏），所以画面就是底部这一条导航。
**四张人都打开看过**，看到的：七枚可交互项全在框内、相邻不重叠、最后一枚读得出「同步」，
暗档不是反相（图标与文字两级灰、状态点在右上）。

## 读数（同一次运行，`scripts/qa/probe-bottom-rail.mjs`，日志在 `~/heyta-ux-logs/r106-final-bottom-rail.json`）

| 档 | 重叠数 | 出视口的项 | 命中区 <44px 的项 | 同步那一枚的盒子 |
|---|---|---|---|---|
| 375 light | 0 | 无 | 无 | 323→367（44×48） |
| 375 dark | 0 | 无 | 无 | 323→367（44×48） |
| 390 light | 0 | 无 | 无 | 336→382（46×48） |
| 390 dark | 0 | 无 | 无 | 336→382（46×48） |

修之前（同一枚探针、同一棵树只退回本线那三枚改动）：`302→388`、与通知重叠 21px、越出视口 13px，
而 `documentElement.scrollWidth` 仍等于 375 —— 所以"横向溢出"那类判据对它天生瞎。

## 牙：两条变异臂

常驻判据是 [`e2e/tests/narrow-rail-geometry.spec.ts`](../../../../e2e/tests/narrow-rail-geometry.spec.ts)
（跑在 `pnpm check:ai-e2e` 那一族里）。两条臂都是**摘掉修法**、不是放宽断言：

1. 去掉 `narrow.css` 里那组收缩规则 ⇒ 红在「相邻两项水平重叠」，打印 `通知×同步，当前状态：登录以同步=3px`；
2. 再把状态文字换回整句（= 修之前的形状）⇒ 红在「有可交互项被画到视口外」，打印 `同步，当前状态：登录以同步=302→388`。

## 这一包不证明的三件事

- 不证明 `origin/main` 有这套修法（本线未 push）；
- 不证明整族 `check:ai-e2e` 绿（本线只跑了这一枚 + `shell-sync-rail`，后者有一枚**不是本线造成**的红，
  现量方法：把本线那三枚改动退回 HEAD 再跑，同一枚 `1 failed / 3 passed`）；
- 不证明英文界面下状态词的长度分布（`?lang=en` 那一档只验了几何，没逐张看图）。

## 复跑

```bash
cd apps/web && ./node_modules/.bin/vite --port <空端口> --strictPort --host 127.0.0.1 &
HEYTA_RESPONSIVE_ORIGIN=http://127.0.0.1:<同端口> node scripts/qa/probe-bottom-rail.mjs
cd e2e && npx playwright test tests/narrow-rail-geometry.spec.ts
```
