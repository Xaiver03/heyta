# 04 · 测试草稿与复现脚本

全部**只读**（不改业务代码、不联网、不跑构建），可直接运行。

| 文件 | 作用 | 现量结果 |
|---|---|---|
| `repro-landing-drift.sh` | 复现 **F-02**：落地页形状登记处落后真源 4 处 | **rc=0**（修复后已闭合） |
| `repro-kanban-unreachable.sh` | 复现 **F-01**：kanban 视图没有任何入口可达 | **rc=1**（缺陷仍在，符合预期） |
| `view-reachability.spec.tsx` | 回归测试草稿：视图可达性门禁（补 `check:reachability` 的盲区） | 见下 |

## `view-reachability.spec.tsx` 的现量结果

按建议落点复制到 `apps/web/tests/` 后运行：

```
$ cp view-reachability.spec.tsx ../../../apps/web/tests/__night-audit-view-reachability.spec.tsx
$ cd ../../../apps/web && npx vitest run tests/__night-audit-view-reachability.spec.tsx

 Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
```

**4 条里 2 红 2 绿，而红的正是要抓的两条** —— 这同时证明了

- 缺陷真实存在（`kanban`）；
- **判据能失败**（一条永远绿的判据比没有判据更糟，见 AGENTS.md §6 第 2 条）。

| 用例 | 结果 | 说明 |
|---|---|---|
| 核心判据：VIEW_TABS 里没有"进不去"的视图 | 🔴 **红** | 报出 `kanban` —— 这就是 F-01 |
| 阳性对照：人造一个不可达视图时必须报出来 | ✅ 绿 | 证明上面那条不是恒绿 |
| 豁免名单里每一项都写清了"从哪儿进" | ✅ 绿 | 挡"豁免名单退化成垃圾篓" |
| 🔴 F-03：`MODULE_VIEW_TABS` 每项都须登记进 `SHELL_MODULES` | 🔴 **红** | 报出 `kanban` —— 独立复现 F-03 |

> ⚠️ **要让这两条转绿，必须先做 F-01 的产品决定**（加模块 / 设常驻 / 删掉）。
> 所以本草稿**不直接入库** —— 入库就会让 `pnpm -r test` 多两条红，
> 而那正是我们这一轮在修的东西。

## 草稿里的一处设计选择

`railPreferenceAccepts()` **从源码文本读**白名单，而不是 import。
原因：`rail-pref.isViewKey` 目前是模块私有的（未 export）。
正式入库时有两条路：

1. 保持读源码文本（零侵入，但与 `mockup-shell-shape` 同一类脆弱：
   排版一变就锚点失效）；
2. **把白名单提成 `export const RAIL_VIEW_KEYS: readonly ViewKey[]`** —— 
   顺带把 **F-04**（手抄白名单与 `ViewKey` 无对账）一起修掉。**推荐这条。**
