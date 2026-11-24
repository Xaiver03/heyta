# heyta · brand-kit

本目录是 **heyta**（本项目）的品牌资产套件，结构与生成方式照 `litopia12/brand-kit`（`_pipeline/*` 脚本 → SVG/PNG/PDF + 预览）。
所有几何与色值取自本仓库既有真源：

- 字标 **「hey.」** 的 stroke path ← `apps/landing/src/components/BrandMark.tsx`
- 图标 **「h」** 的三条圆角矩形 ← `packages/design-system/src/brand-mark.ts`
- 色值（主蓝 `#2563eb`、slate、反馈色）← `packages/design-system/src/tokens.css`

> 不使用任何其他品牌（此前误用的「晓黎创意」品牌不在此目录内，可另行删除）。

## 双向闭环：代码 ↔ VI ↔ 设计系统

本目录**没有手写色值**：所有颜色由 `_pipeline/read_tokens.py` 从
`packages/design-system/src/tokens.css` 解析得到，改代码后重跑脚本即同步。
反向那一条腿以门禁形式写回代码：

| 方向 | 落点 |
|---|---|
| 代码 → VI（色） | `_pipeline/read_tokens.py` → `build_badges_v2.py` / `build_brandbook.py` / `build_docs.py` |
| 代码 → VI（文案） | `_pipeline/read_copy.py` 从 `packages/i18n` 读标语，脚本内不手写 |
| 代码 → VI（几何） | `_pipeline/build_logo.py` 从 `BrandMark.tsx` 与 `brand-mark.ts` 正则抽取字标路径与「h」矩形，取不到即报错 |
| VI → 设计系统 | 新增 `color.milestone-{checkin,focus,tasks,days}`（亮/暗各一份）进 `tokens.css` + `TOKEN_GROUPS` |
| 设计系统 → 代码 | `packages/ui/src/motivation/MilestoneMap.tsx` 消费四维色（维度圆点 + 已达成档位描边） |
| 守住不回退 | `packages/design-system/tests/milestone-colors.spec.ts`（对比度 / ΔE / 色盲 / 暗色覆盖） |

实测与判据见 [`成就与成长体系_产品清单.md`](成就与成长体系_产品清单.md) §11。

## 相关：成就/成长体系设计清单

> 成就体系的设计依据是本仓库已实现的「激励与成长体系」，见 [`成就与成长体系_产品清单.md`](成就与成长体系_产品清单.md)。**不要照抄 Litopia 的稀有度奖章。**

## 目录与状态

| 目录 | 内容 | 状态 |
|---|---|---|
| `00-brand-foundation/` | `brand-tokens.json/.css` + `brand-book.pdf`（8 页）+ `_preview/page-01..08.png` | ✅ |
| `01-logo/` | 字标（blue/deep/ink/white）、app-icon、icon-mono/brand、横/竖锁版 + PNG | ✅ |
| `02-badges/` | **成长标识体系**：17 里程碑（`milestones/`）+ 8 身份标签（`identity/`）+ 8 分类色槽（`category/`）+ 6 状态胶囊（`status/`）+ `badge-catalogue.html/png/pdf` | ✅ |
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
