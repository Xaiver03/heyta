# r44 —— 图 / 读数 / 树三者同批的那一趟

一句话：**这一目录存在的理由，是让"人看过的图"和"机读的色"出自同一趟、同一棵树。**
台账正文在 `docs/plans/product-ux-optimization.md` 里可 grep 为 `同批看图三张` 的那格（亮档那两张在同格的 `同批亮档两张` 段）。

## 入库的是 7 枚：`report.json` + 本 README + 5 张图

| 入库 | 它承担哪句主张 |
|---|---|
| `report.json` | 37 条判据全真、`notJudged` 空；出处五项在 `carrier.tree`（`headSha` / `dirtyFiles` / `rigSha256Prefix` / `rigWorktreeMatchesHead` / `provenanceScope`） |
| `dark-390-reminder-granted.png` | 机读说暗档 `桌面小组件` 标题 = `rgb(241, 245, 249)`；这张按行取最亮点，**94 行的极值逐字等于它** |
| `dark-1440-sync.png` | 同一把尺在 1440 暗档给 **109 行**；图里「决定于 2026-10-09 21:25 (UTC)」就是这一趟起跑后的时刻 ⇒ **图自己带批次出处**（比 mtime 硬，它在像素里） |
| `light-390-reminder-granted.png` | 亮档那一半：机读 = `rgb(15, 23, 42)`，按行取最暗点 **96 行**命中 |
| `light-1440-data-refused-existing.png` | 亮档 1440：**97 行**命中；另有数据面「本机已经有数据 —— 还原只支持空库」状态卡**在框内**（旧账里它只由脚本断言承担），主按钮是 `#2563EB` |
| `dark-1440-data-refused-existing.png` | 同一张状态卡的暗档版，在框内 |
| `README.md` | 就是本文件 |

🔴 **那四个"行数"是一把聚合尺，不是一句"节点↔色已绑定"**：按行取极值只回答
「机读报的那个色**有没有被画到屏上**、有多少行的极值是它」，它**不**证明那个色恰好来自那枚标题节点
（同一屏里别的文字可能同色）。"节点↔色"那一半由 `report.json` 里的 DOM 计算色承担，
两层是**互补**，不是互证。要把绑定也证到，得按节点自己的盒裁一块再数 —— 那一档**不在本目录**，
在同一条线的另一枚证据里：`apps/web/evidence/theme-node-binding-1010/`（两枚 89×23 元素截图，
暗档盒内 246 枚像素 = 机读色、亮档 255 枚，而**对面那档的色在同一盒内 0 次**；台账里可 grep `节点级绑定`）。

复现这把尺（零浏览器、零运行成本；实测四张图给的就是 94 / 109 / 96 / 97）：

```bash
python3 - <<'PY'
from PIL import Image
base = 'apps/web/evidence/sync-privacy-leg-1009-r44-visual/'
for f, want, pick in [('dark-390-reminder-granted.png', (241, 245, 249), max),
                      ('dark-1440-sync.png',            (241, 245, 249), max),
                      ('light-390-reminder-granted.png', (15, 23, 42), min),
                      ('light-1440-data-refused-existing.png', (15, 23, 42), min)]:
    im = Image.open(base + f).convert('RGB')
    W, H = im.size
    px = im.load()
    rows = [pick([px[x, y] for x in range(W)], key=lambda t: sum(t)) for y in range(H)]
    print(f, '命中', sum(1 for c in rows if c == want), '行 /', H, '期望', want)
PY
```

其余 82 枚 PNG 与那几枚 `*-backup.json` / `*-tasks.md` / `*-invalid.json` **刻意不落库**（整批 7.7 MB，
与已入库的 10-09 14:09 那批只差"当前树"这一维）。所以：

- 本目录**不是**一趟完整可复现的证据集 —— 复现命令在台账那格里
  （`HEYTA_WEB_UI_SWEEP_EVIDENCE=<本目录> pnpm verify:web-ui-sweep`），重跑会落进**你指定的**落点。
- 从本目录**不要**推"这批图都在仓库里"。要别的图，重跑。

## 它**不证明**的三件事（照本账惯例列全）

1. **无头载体**（`carrier.headless` 现量）—— 与真实窗口态的差别见台账里"无头丢的不止 `default`"那一格。
2. **拍的是未登录 / 未同意联网的门禁态** —— 决定态那一腿另有它自己的格子。
3. **它不是逐张全查** —— 这一趟 87 张图里人只看了 5 张（暗 3 + 亮 2）。深浅两档各自都有人看过了，
   但"每一张都看过"仍然没有做，那一档和台账里"父级视觉复核"是同一件事。
