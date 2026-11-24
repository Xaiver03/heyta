# heyta · brand-kit

本目录是 **heyta**（本项目）的品牌资产套件，结构与生成方式照 `litopia12/brand-kit`（`_pipeline/*` 脚本 → SVG/PNG/PDF + 预览）。
所有几何与色值取自本仓库既有真源：

- 字标 **「hey.」** 的 stroke path ← `apps/landing/src/components/BrandMark.tsx`
- 图标 **「h」** 的三条圆角矩形 ← `packages/design-system/src/brand-mark.ts`
- 色值（主蓝 `#2563eb`、slate、反馈色）← `packages/design-system/src/tokens.css`

> 不使用任何其他品牌（此前误用的「晓黎创意」品牌不在此目录内，可另行删除）。

## 自检判据一览（`python _pipeline/check_artifacts.py`）

耗时：全套 34 组约 **0.4s**（`--quiet` 实测 0.42s），对 `pnpm check` 可忽略。

**失败即给修复命令**：每条失败会按类别打印「修：python .../build_xxx.py」，不用再翻文档。

三种输出：默认人读；`--list` 按「读代码 / 读产物 / 读文档」三组列出 34 组判据，并附 8 处构建期断言；`--quiet` 只在失败时说话并给一行汇总（给 CI 用）；
`--json` 输出 `{ok, passed, failed, checks|errors, remedies}`（给流水线解析用，stdout 保证是纯 JSON）。\n\n> 链上已经跑过：`pnpm check:brand-assets` 内部会调用它；\n> 想单独跑用 `pnpm check:brand-kit`（不要再挂进 `check` 链，否则一次 CI 跑两遍）。

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
| 12 | `brand-tokens.json` 43 个色值 = tokens.css | 对外导出表漂移（实测抓到过靛蓝/品红错色） |
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
| 23 | 状态胶囊文字对比度 ≥ 4.5:1 | 胶囊是 13px 小字，印出来读不清 |
| 24 | `04-imagery` manifest 无重复登记 | 同一张图登两次 → 图鉴两张一样的卡 |
| 25 | 8 个分类色槽满足 spec 门槛（对比≥3 / ΔE 正常≥25、红≥14、绿≥13） | 物料上「色盲可辨」这句话没有依据 |
| 26 | 徽章英文维度名 = 产品文案的缩写 | 产品把 Focus 改名后物料仍写 FOCUS HRS |
| 27 | 色卡的「用户赋义 / 存槽位 / 永不自动上色」与代码一致 | 色卡写着一个产品没做到的承诺 |
| 28 | `04-imagery` 每条 `sub` = 所在目录且在白名单 | 图放错目录 → 图鉴归错类 |
| 29 | 分享文本不带账号/设备字段（隐私承诺） | 用户外发的文本里带了自己的 id |
| 30 | 手册 FAQ 四条各有依据（本地优先/无需账号/加密非默认/可自托管） | 手册承诺了产品没做的事 |
| 31 | 反例主张都在 `_pipeline/stance.py` 名单内 | 有人悄悄加了「不做 X」而名单没登记 |
| 32 | index.html 含全部 17 张卡片 | 配图改名后卡片静默消失（实测发生过） |
| 33 | index 副标题数字 = 现量值 | 手抄 17/8/26 之类 |
| 34 | 反例名单与激励体系三条红线对得上 | 物料立场与产品红线各说各的 |

⚠️ **PDF 每次重建字节都不同**（Chrome 打印头里带时间戳/文档 ID），PNG 与 SVG 是稳定的。
所以比对 PDF 时看页数/字体/视觉，不要看 sha256 —— 否则每次都会以为「有改动」。

另有三处**构建期断言**（不通过就直接不产出文件）：
- 手册目录页码与正文必须对得上（`len(pages) == 2 + len(toc) + 1` 且每页含对应标题）
- `05-posters/` 只许有 3 张海报各 pdf+png —— 改名时旧文件没删会被拦下
- `02-badges/{milestones,identity,status,category}` 四个子目录的文件名集合必须与生成清单逐一对上
- `09-social` / `10-templates` 同上（防改名残留）

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
| brand-kit 自检 | `python _pipeline/check_artifacts.py`：色值必须命中 tokens.css + 数量 17/8/6/26/10 + **9 份 PDF 字体全嵌入且页数符合设计** + **index.html 29 个相对链接全部可达** + **品牌 i18n 词条两语言齐备** + **16 个语义色亮/暗成对且取值不同** + **里程碑四维两两 ΔE≥10（亮/暗 × 正常/红绿色盲，Python 独立重算，与 design-system 的 TS spec 互为对照）** + **17 个里程碑门槛与 8 个身份标签 id 与 `packages/domain` 逐项相同** + **产品清单里写的门槛数字与领域层一致** + **无自造文案回归（禁串扫描）** + **`brand-tokens.json` 43 个色值与 tokens.css 逐项一致** + **图鉴标题印的数量 = 领域层数量**（注入非法色 / 改错页数 / 写坏 href / 漏暗色覆盖 / 多出或不存在的档位都会 exit 1） |

实测与判据见 [`成就与成长体系_产品清单.md`](成就与成长体系_产品清单.md) §11。

## 相关：成就/成长体系设计清单

> 成就体系的设计依据是本仓库已实现的「激励与成长体系」，见 [`成就与成长体系_产品清单.md`](成就与成长体系_产品清单.md)。**不要照抄 Litopia 的稀有度奖章。**

## 目录与状态

| 目录 | 内容 | 状态 |
|---|---|---|
| `00-brand-foundation/` | `brand-tokens.json/.css` + `brand-book.pdf`（8 页）+ `_preview/page-01..08.png` | ✅ |
| `01-logo/` | 字标（blue/deep/ink/white）、app-icon、icon-mono/brand、横/竖锁版 + PNG | ✅ |
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
