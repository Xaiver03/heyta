# heyta · brand-kit

本目录是 **heyta**（本项目）的品牌资产套件，结构与生成方式照 `litopia12/brand-kit`（`_pipeline/*` 脚本 → SVG/PNG/PDF + 预览）。
所有几何与色值取自本仓库既有真源：

- 字标 **「hey.」** 的 stroke path ← `apps/landing/src/components/BrandMark.tsx`
- 图标 **「h」** 的三条圆角矩形 ← `packages/design-system/src/brand-mark.ts`
- 色值（主蓝 `#2563eb`、slate、反馈色）← `packages/design-system/src/tokens.css`

> 不使用任何其他品牌（此前误用的「晓黎创意」品牌不在此目录内，可另行删除）。

## 自检判据一览（`python _pipeline/check_artifacts.py`）

耗时：全套 45 组约 **0.4s**（`--quiet` 实测 0.42s），对 `pnpm check` 可忽略。

**失败即给修复命令**：每条失败会按类别打印「修：python .../build_xxx.py」，不用再翻文档。

三种输出：默认人读；`--list` 按「读代码 / 读产物 / 读文档」三组列出 45 组判据，并附 8 处构建期断言；`--quiet` 只在失败时说话并给一行汇总（给 CI 用）；
`--json` 输出 `{ok, passed, failed, checks|errors, remedies}`（给流水线解析用，stdout 保证是纯 JSON）。

已挂在 `check` 链上：`pnpm check:brand-kit`（紧跟 `check:brand-assets`）。

| # | 判据 | 抓的是什么 |
|---|---|---|
| 1 | 色值白名单 | 产物里出现非 token 的十六进制 |
| 2 | 数量 | 17 里程碑 / 8 身份标签 / 5 状态胶囊 / 26 图标 / 10 字标 + 各 svg 有对应 png |
| 3 | 关键产物存在且非空 | 图鉴 pdf+png、品牌手册 pdf |
| 4 | PDF 字体全嵌入 + 页数符合设计 | 换机器变宋体/变方框；页数漂移 |
| 5 | `index.html` 相对链接可达 | 卡片生成了但 href 指不到 |
| 6 | 品牌 i18n 词条两语言齐备 | 某语言漏译 → 卡片出空串 |
| 7 | 16 个语义色亮/暗成对且不同 | 漏暗色覆盖（暗色版与亮色一模一样） |
| 8 | 里程碑四维两两 ΔE ≥ 10（亮/暗 × 正常/红绿/绿色盲） | 维度色互相撞车；与 TS spec 互为独立复核 |
| 9 | 17 个门槛 + 8 个 id 与 `packages/domain` 逐项相同 | 门槛改了没重生成徽章 |
| 10 | 禁串扫描（5 条自造文案） | 品牌标语被重新写死在脚本里 |
| 11 | 产品清单里的门槛数字 = 领域层 | 文档手改数字 |
| 12 | `brand-tokens.json` 43 个色值 = tokens.css | 对外导出表与 tokens.css 不同步 |
| 13 | 图鉴标题印的数量 = 领域层数量 | 标题写死数字 |
| 14 | `brand-tokens.css` 与 json 逐项一致 | 同一数据两副面孔只改了一处 |
| 15 | `01-logo`(22) 与 `00-brand-foundation`(3) 文件集合精确 | 改名后旧文件残留 / 少导一档 |
| 16 | 每个字形 svg 都有对应 png（单色版例外） | 交付给设计师时缺某个颜色版本的位图 |
| 17 | `04-imagery` 的图与 `_manifest_main.json` 双射 | 有图没登记 / 登记了文件却不在 |
| 18 | `03-icons` 的 svg 全部进了 `icon-sheet.html` | 加了图标但总览页没收录 |
| 19 | 状态胶囊 key = 产品真实状态（todo/done/overdue/archived/high） | 印出产品里不存在的状态（「进行中」已按此删掉） |
| 20 | 产物里的本地 `src/href` 全部可达 | 删了状态却没删引用 → 海报上一枚空白胶囊 |
| 21 | 身份标签徽章上印的 `≥N` = 领域层 threshold | id 全对但门槛改了没重建徽章 |
| 22 | 里程碑徽章上印的数字 = 领域层门槛；图鉴收录全部维度中文名 | 只改画法不改文件名时，图上数字会错 |
| 23 | 状态胶囊文字对比度 ≥ 4.5:1 | 13px 小字的文字/背景不足 4.5:1 |
| 24 | `04-imagery` manifest 无重复登记 | 同一张图被登记两次 |
| 25 | 8 个分类色槽满足 spec 门槛（对比≥3 / ΔE 正常≥25、红≥14、绿≥13） | 物料上「色盲可辨」这句话没有依据 |
| 26 | 徽章英文维度名 = 产品文案的缩写 | 产品文案改名后物料缩写未同步 |
| 27 | 色卡的「用户赋义 / 存槽位 / 永不自动上色」与代码一致 | 色卡立场的表述与代码不一致 |
| 28 | `04-imagery` 每条 `sub` = 所在目录且在白名单 | 图片分类与所在目录不一致 |
| 29 | 分享文本不带账号/设备字段（隐私承诺） | 分享文本夹带账号/设备标识 |
| 30 | 手册 FAQ 四条各有依据（本地优先/无需账号/加密非默认/可自托管） | FAQ 答案失去实现依据 |
| 31 | 反例主张都在 `_pipeline/stance.py` 名单内 | 出现名单外的反例主张 |
| 32 | index.html 含全部 17 张卡片 | 配图路径与卡片清单不同步，卡片会缺 |
| 33 | index 副标题数字 = 现量值 | 手抄 17/8/26 之类 |
| 34 | 反例名单与激励体系三条红线对得上 | 物料立场与产品红线各说各的 |
| 35 | 宣传册正面印着官网域名 | 域名取不到时二维码块消失 |
| 36 | 同一物料的 PNG 与 PDF 版面比例一致 | 两种载体的纸型/比例不一致 |
| 37 | 10 份 PDF 纸型 = 设计（A4×6 / A3×3 / 图鉴 4:5 数字版 + A4 印刷版） | 未声明 @page 时按浏览器默认纸型出纸并可能溢出 |
| 38 | 手册预览图张数 = 手册页数 | 索引里的册子缺页 |
| 39 | 01-logo 位图档位（1x=760 / 2x=1520 / 图标正方） | 导错档位，文件管理器看不出 |
| 40 | 03-icons 全部 24×24 网格 | 图标机身大小不齐 |
| 41 | 产品清单里的 ΔE 实测值 = 现算值；暗色 token 必须是 hex | 文档结论与实算脱节 |
| 42 | 文档里的 `docs/…​.md §N` 引用文件与章节都在 | 被引文档搬去 archive 后成死链 |
| 43 | 二维码分支真的产出二维码（有 segno 时） | 分支恒抛异常→恒走文字兜底，页面上没有可扫的码 |
| 44 | 04-imagery 素材库：登记数=副标题数、总览图在位 | 素材只在盘上、索引里看不见 |
| 45 | 10 份 PDF 纸型（含图鉴 A4 印刷版） | 交印厂拿到非 A4 页面 |

⚠️ **PDF 每次重建字节都不同**（Chrome 打印头里带时间戳/文档 ID），PNG 与 SVG 是稳定的。
所以比对 PDF 时看页数/字体/视觉，不要看 sha256 —— 否则每次都会以为「有改动」。

另有三处**构建期断言**（不通过就直接不产出文件）：
- 手册目录页码与正文必须对得上（`len(pages) == 2 + len(toc) + 1` 且每页含对应标题）
- `05-posters/` 只许有 3 张海报各 pdf+png —— 改名时旧文件没删会被拦下
- `02-badges/{milestones,identity,status,category}` 四个子目录的文件名集合必须与生成清单逐一对上
- `09-social` / `10-templates` 同上（防改名残留）

## 交付总览（数字都带取数命令）

| 项 | 值 | 取数命令 |
|---|---|---|
| 受版本控制的物料文件 | 163 | `python brand-kit/_pipeline/build_index.py` 输出的 `index: N files` |
| 产物目录 | 11（`00-`…`10-`） | `ls -d brand-kit/[0-9][0-9]-*` |
| 自检判据 | 46 组 / 72 项 | `python brand-kit/_pipeline/check_artifacts.py --quiet` |
| 构建期断言 | 8 处 | `python brand-kit/_pipeline/check_artifacts.py --list` 末段 |
| 接线对账 | 27 条 | `node scripts/check-brand-assets.mjs` |
| 生成器幂等 | 两次运行字节一致 | 连跑 5 件生成器后比对非 PDF 产物 sha |
| 设计系统侧护栏 | `milestone-colors.spec.ts` | `pnpm --filter @heyta/design-system test` |

## 需要你定的事（不影响当前交付）

以下各项都能正常交付，只是取舍需要你拍板；未定之前按「现状」那一列执行。

**不在本清单里的**：成长页「变化才播」动效已在 `packages/ui/src/motivation/ProgressBar.tsx` 实现
（首帧直接画终值、挂载后仅在数值变化时 `Animated.timing`），它的录屏属**界面验收**产物
（`docs/agents/ui-acceptance.md`），品牌物料只提供静态稿，不重复录制。

| 事项 | 现状 | 需要你定 | 影响面 |
|---|---|---|---|
| 二维码要不要真码 | 缺 `segno` 库时印官网域名文字 | 是否同意装 `segno` 生成真二维码 | 装库即可，无网络依赖 |

## 双向闭环：代码 ↔ VI ↔ 设计系统

本目录**没有手写色值**：所有颜色由 `_pipeline/read_tokens.py` 从
`packages/design-system/src/tokens.css` 解析得到，改代码后重跑脚本即同步。
反向那一条腿以门禁形式写回代码：

| 方向 | 落点 |
|---|---|
| 代码 → VI（色） | `_pipeline/read_tokens.py` → `build_badges_v2.py` / `build_brandbook.py` / `build_docs.py` |
| 代码 → VI（文案） | `_pipeline/read_copy.py` 从 `packages/i18n` 读标语/eyebrow，脚本内不手写；**物料专属标题（海报/手册大标题）不在此列**，见产品清单 §11.6b |
| 代码 → VI（几何） | `_pipeline/build_logo.py` 从 `BrandMark.tsx` 与 `brand-mark.ts` 正则抽取字标路径与「h」矩形，取不到即报错 |
| VI → 设计系统 | 新增 `color.milestone-{checkin,focus,tasks,days}`（亮/暗各一份）进 `tokens.css` + `TOKEN_GROUPS` |
| 设计系统 → 代码 | `packages/ui/src/motivation/MilestoneMap.tsx` 消费四维色（维度圆点 + 已达成档位描边） |
| 守住不回退 | `packages/design-system/tests/milestone-colors.spec.ts`（对比度 / ΔE / 色盲 / 暗色覆盖） |
| brand-kit 自检 | `python _pipeline/check_artifacts.py`：**46 组 / 72 项**，覆盖 ①色值必须命中 tokens.css ②数量 17 里程碑 / 8 身份标签 / 5 状态胶囊 / 26 图标 / 10 字标 ③10 份 PDF 字体全嵌入、页数、**纸型** ④产物内本地引用全部可达 ⑤品牌 i18n 词条两语言齐备 ⑥16 个语义色亮/暗成对且不同 ⑦里程碑四维与分类色槽**两两 ΔE**（亮/暗 × 正常/红盲/绿盲，Python 独立重算，与 design-system 的 TS spec 互为对照）⑧门槛与 id 逐项对齐 `packages/domain`，**徽章与图鉴上印的数字也回读核对** ⑨状态胶囊 = 产品真实状态 ⑩反例主张在 `_pipeline/stance.py` 名单内且与激励体系三条红线一致 ⑪分享文本不含账号/设备标识 ⑫手册 FAQ 四条各有实现依据 ⑬索引卡片齐全、副标题为现量值 |
| 幂等 | 五件生成器连跑两次，SVG/PNG/JSON/CSS/HTML **字节完全一致**（`generated_at` 取最后一次提交时间，不用墙上时钟）；PDF 因打印头带时间戳不参与 sha 比对，只看页数/字体/纸型 |

实测与判据见 [`成就与成长体系_产品清单.md`](成就与成长体系_产品清单.md) §11。

## 相关：成就/成长体系设计清单

> 成就体系的设计依据是本仓库已实现的「激励与成长体系」，见 [`成就与成长体系_产品清单.md`](成就与成长体系_产品清单.md)。**不要照抄 Litopia 的稀有度奖章。**

## 目录与状态

| 目录 | 内容 | 状态 |
|---|---|---|
| `00-brand-foundation/` | `brand-tokens.json/.css` + `brand-book.pdf`（8 页）+ `_preview/page-01..08.png` | ✅ |
| `01-logo/` | 字标（blue/deep/ink/white）、app-icon、icon-mono/brand、横/竖锁版 + PNG | ✅ |
| `02-badges/` | **图鉴两版并存**：`badge-catalogue.pdf` 是 4:5 数字版（1200×1500，屏幕浏览）；`badge-catalogue-A4.pdf` 是 A4 竖版（交印厂）。其余物料均为 A4/A3 |
| `02-badges/` | **成长标识体系**：17 里程碑（`milestones/`）+ 8 身份标签（`identity/`）+ 8 分类色槽（`category/`）+ 5 状态胶囊（`status/`）+ `badge-catalogue.html/png/pdf` | ✅ |
| `03-icons/` | 线性图标 26（`*.svg`）+ `icon-sheet.html/png` | ✅ |
| `04-imagery/` | 本地 MOSS-Image 生成：2 背景 + 2 插画 + 3 周边（含笔记本）+ `contact-sheet.png` | ✅ |
| `05-posters/` | 海报 A3 × 3（PDF+PNG） | ✅ |
| `06-brochure/` | 宣传折页 A4 三折（正/反） | ✅ |
| `07-product-manual/` | heyta 产品手册 10 页 PDF | ✅ |
| `08-merch/` | 周边（笔记本/马克杯/帆布包/贴纸） | ✅ |
| `09-social/` | 社交卡片 / OG 图 | ✅ |
| `10-templates/` | 幻灯片模板 16:9 + 更新日志卡 | ✅ |
| `_pipeline/` | 全部生成脚本（可重跑）：`build_tokens` / `build_logo` / `build_badges_v2` / `build_icons` / `build_brandbook` / `build_docs` / `build_index` / `moss_batch` / `render` | ✅ |

## 重新生成

```bash
PY=/Users/rocalight/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3
cd brand-kit/_pipeline
PYTHONNOUSERSITE=1 $PY build_tokens.py     # 00 brand token
PYTHONNOUSERSITE=1 $PY build_logo.py       # 01 logo（rsvg 导出 PNG）
PYTHONNOUSERSITE=1 $PY build_badges_v2.py  # 02 成长标识体系（17 里程碑 + 8 标签 + 8 色槽 + 状态胶囊）
PYTHONNOUSERSITE=1 $PY build_icons.py      # 03 icons
PYTHONNOUSERSITE=1 $PY build_brandbook.py  # 00 brand-book.pdf
PYTHONNOUSERSITE=1 $PY build_docs.py       # 05–10 海报/折页/手册/周边/社交/模板
PYTHONNOUSERSITE=1 $PY build_index.py      # index.html + manifest.json
# 需要本地 ComfyUI(127.0.0.1:8188, MOSS-Image) 起的：04 位图
PYTHONNOUSERSITE=1 $PY moss_batch.py
```

## 与产品原则一致

heyta 明确「不做装饰性徽章墙、排行榜与断签惩罚」（`.agents/context/PRODUCT.md`）。本套徽章用于**品牌、周边与克制的成长回望**，不用于比较或施压；状态徽章只传达任务状态。

## 校验

```bash
ls 02-badges/milestones/*.svg | wc -l  # 17
ls 02-badges/identity/*.svg   | wc -l  # 8
ls 02-badges/status/*.svg     | wc -l  # 6
ls 03-icons/*.svg             | wc -l  # 26
ls 01-logo/*.svg              | wc -l  # 10
pdfinfo 00-brand-foundation/brand-book.pdf | grep Pages   # 8
pdfinfo 07-product-manual/heyta_product-manual.pdf | grep Pages  # 10
```
