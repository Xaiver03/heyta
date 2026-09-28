# 产品截图与宣传海报流水线

移植自 SSOS（`01_PROJECTS/ssos`）那套做法，并按本仓库的形态做了三处必要改动。
**方法全部来自实测**，不是照搬文档。

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm screenshot:list` | 列出所有截图目标（**不截图**） |
| `pnpm screenshot:capture` | 截图（需站点已在本地起好） |
| `pnpm screenshot:capture -- --only W01` | 只截某一个目标 |
| `pnpm screenshot:app-store` | 按 App Store 尺寸截（iPhone 6.9" / iPad 13" / Mac） |
| `pnpm screenshot:verify` | **门禁**：数量 / 尺寸 / alpha / 空白 |
| `pnpm screenshot:test` | 校验 PNG 解析器本身（对 magick 与 IHDR 字节交叉验证） |
| `pnpm poster <svg> [输出目录]` | 海报 SVG → PNG + PDF，并自检 |

## 🔴 为什么要有"空白检测"

**截图脚本"跑成功"和"截到东西"是两件事。**

页面 404、白屏、渲染未完成、被引导弹窗盖住 —— 截出来都是一张纯白图：
尺寸对、退出码 0、文件名齐全。**只有看像素才能发现。**

判据（与 SSOS 完全一致，算法见 `png-stats.mjs`）：

```
sampleStep   = max(1, floor(w*h / 20000))     # 最多采 ~2 万点，均匀跳采
luminance    = round((r+g+b)/3)
nonWhite     = r<248 || g<248 || b<248        # 阈值 248 而非 255：抗锯齿边缘也算内容
contentRatio = nonWhite / samples             # < 0.01 ⇒ 疑似空白
colorSpan    = maxLuminance - minLuminance    # < 16   ⇒ 疑似空白
hasAlpha     = IHDR colorType ∈ {4, 6}
```

⚠️ **不要靠调低阈值让它变绿。** 空白就是空白，要去查页面。

### 为什么自己解 PNG 而不装 `pngjs`

SSOS 用 `pngjs`。本仓库对新增依赖有两道门（`AGENTS.md` §3.1–3.2），
而这里只需要读 IHDR/IDAT，所以用 Node 内置 `node:zlib` 自己解，**零依赖**。

支持 1/2/4/8/16 位、灰度/真彩/索引/带 alpha。
🔴 **低位深不是边角情况**：一张真正空白的纯白截图会被编码器压成 **1 位灰度图**
（实测 `magick -size 120x80 xc:white` 即 bitDepth=1）—— 也就是说
**最需要被判为空白的那类图恰好是低位深的**，解码器在这里抛错就等于把最该发现的情况变成脚本崩溃。

### 校验器本身怎么被验证的

`png-stats.test.mjs` 分两层，**不接受"自己测自己"**：

1. 用 `magick` 造**已知像素**的合成图 → 断言精确值（纯白 → `contentRatio=0, colorSpan=0`）；
2. 用 **`magick identify` 的尺寸** + **PNG IHDR 第 25 字节的 colorType** 交叉验证真实文件。

真实样本里**包含 SSOS 仓库的产品截图**（异库样本），用来证明解析器不是只对本仓库的文件成立。
两条外部基准都对得上才认。

> 教训：一开始我硬编码断言"`xc:white` 应该是 colorType=2"，结果 IM 实际写成 **0（灰度）**。
> **别硬编码对工具输出格式的预期** —— 要断言格式自己的基准（IHDR 字节）。

## 🔴 渲染可用性：空白检测**不够**

实测过一次很贵的教训：macOS 壳的自截屏用 `cacheDisplay` 把 SwiftUI 文字
渲染成**横向色带**，而那张图尺寸对、内容比例 96%、色阶 255 ——
**空白检测完全通过**。只有人眼能发现字全是坏的。

所以门禁里有两道，**顺序不能反**：

### ① 来源门禁（硬性，防回归的核心）

原生壳的窗口证据必须带一份说明文件，声明：

```
CAPTURE_METHOD=cgs-window-server     # 必须在白名单里
CROSSCHECK=ok(1800x1120)             # 必须与独立截屏交叉验证过
```

白名单只有 `cgs-window-server`（`CGWindowListCreateImage`）与
`screencapture-window`（外部 `screencapture -l`）—— 两者同源，都是
**问窗口服务器要一份**，不是重绘。

⛔ 明确禁止（都实测证伪）：`cache-display`、`calayer-render`、`image-renderer`。

**为什么这条是核心**：真正能挡住那个 bug 的是"这份证据是怎么来的"，
而不是"它长什么样"。换个渲染方式就能骗过任何像素检查。

### ② 糊字启发式（像素级，但**是启发式**）

判据是**两条件联合**："内容很多" **且** "边缘很少"：

```
contentOnModalRatio >= 0.15  且  edgeOnContent < 0.30   ⇒   疑似渲染坏了
```

定标数据（**用真实样本量的，不是估的**）：

| 样本 | 内容占比 | edgeOnContent | 判定 |
|---|---|---|---|
| macOS 壳（清晰，暗色） | 6.6% | 0.43 | 正常 |
| iOS 截图（清晰） | 3.8% | 1.81 | 正常 |
| Android 截图（清晰） | 9.6% | 0.94 | 正常 |
| Web 截图（清晰） | 1.8% | 1.64 | 正常 |
| **macOS 旧自截图（糊）** | **43.3%** | **0.20** | 命中 |
| **旧 evidence（糊）** | **41.8%** | **0.17** | 命中 |

单个条件都不够：只看 `edgeOnContent` 时清晰暗色 UI 是 0.43、糊的是 0.20
（只差 2.1 倍）；只看内容占比时正常的内容密集 UI 也可能到 40%。
合起来才分得开 —— 涂抹的物理特征是**"把墨摊满画布，却摊没了梯度"**。

⚠️ **边缘余量只有 1.4~2.8 倍**，一个"大片纯色 + 极少文字"的正常界面
（如启动页）可能被误报。所以它是**一条独立提示**，报出实测数值让人去看一眼；
真正防回归的是上面那道来源门禁。

⚠️ 已知边界：所有指标都基于**亮度**（`(r+g+b)/3`），
**红蓝边界对它是不可见的**（红与蓝亮度都是 85，实测 `colorSpan=0`）。
它判的是明暗结构，不判色相。

## 目标注册表（`targets.mjs`）

站点结构的**唯一事实源**（截图视角）。字段：

| 字段 | 含义 |
| --- | --- |
| `id` / `name` | 目标标识与中文名，决定文件名 `<id>-<name>.png` |
| `site` | `landing` / `web` |
| `openVia` | `'path'`（goto）或 `'tab'`（点导航标签） |
| `path` / `view` | 路径，或 `apps/web` 的 `ViewKey` |
| `readyText` | **必须出现**的真实文案 —— 就绪门控 |
| `dismissTexts` | 出现就点掉的按钮（引导弹窗、公告） |
| `device` | `desktop` / `mobile` |
| `appStore` | 是否纳入 App Store 截图集 |

### 与 SSOS 的三处不同（都是本仓库的实际形态决定的）

1. 🔴 **`apps/web` 的视图是 React state，不是 URL 路由**
   （`App.tsx`: `useState<ViewKey>('tasks')`）。所以 web 目标用 `openVia: 'tab'`，
   靠点导航标签切换。**照抄 SSOS 的 path 写法会截到同一个视图 8 次还不报错。**
2. **`readyText` 取自 `packages/i18n/src/locales/zh-CN.ts` 的真实文案**（不是编的）：
   任务 / 四象限 / 习惯 / 番茄钟 / 时间线 / 成长 / 回收站 / 设置。改文案时这里会失配，正好提醒同步。
3. **用本仓库已有的 Playwright**（不引入 puppeteer）。

### 为什么等文案而不是 `sleep`

固定等待在快机器上浪费、在慢机器上截到半成品。
`readyText` 同时验证**"渲染出来了"**和**"渲染的是对的那个页面"**。

## 生产硬闸门

只有 `localhost` / `127.0.0.1` 免开闸。其它地址必须显式：

```bash
HEYTA_ALLOW_PRODUCTION=1 pnpm screenshot:capture
```

理由：截图可能把**真实用户数据**截进仓库。默认拒绝，要越界就得写出来。

## 宣传海报

SSOS 的海报是**手写 SVG**（1200×1600）—— 但它**没留下生成 PNG/PDF 的脚本**，
那一步是手工做的、不可复现。本仓库补上了 `poster.sh`。

做法：手写 SVG（`<defs>` 里的渐变做视觉分层）→ `rsvg-convert` 出 PNG → `rsvg-convert -f pdf` 出矢量 PDF → **用 `png-stats.mjs` 自检**（不能有 alpha、不能是空白）。

海报最容易出的两种事故是**导出成全透明**和**字体缺失导致整块空白**，
只看一眼缩略图是发现不了的 —— 所以要程序化自检。

### 一个硬印证

用 `poster.sh` 重新渲染 SSOS 已提交的海报 SVG：

```
PNG  SSOS=fb6d1222fa0c3123  我=fb6d1222fa0c3123   🎯 字节完全一致
```

⇒ 说明它们当年确实是用 `rsvg-convert` 做的，本脚本补上的正是那步缺失的可复现命令。
（PDF 尺寸相同 206,781 字节但哈希不同，原因**未查明**，如实记着。）

## 何时开始截图

产品界面稳定之前**不要**截。未完成的界面截出来的图有两个害处：
一是要反复重截，二是**万一被当成「已实现」的证据用出去，那就是错的证据**。

现在可以先跑：`pnpm screenshot:list`（看目标）与 `pnpm screenshot:verify`（缺图会如实报出来，不算失败）。
