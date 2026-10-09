# r45 —— 数据面那两种"还原被拒"理由，第一次各有一张**绑在节点上**的图

一句话：**这一目录存在的理由，是把台账里那句"拒绝卡有图能看见"补成三档都成立。**
台账正文在 `docs/plans/product-ux-optimization.md` 里可 grep 为 `拒绝卡节点级取证` 的那格；
它更正的是同文件可 grep 为 `人打开四张看过` 那格里的一句过强主张（成因见下面"为什么要有这批"）。

## 入库的是 14 枚：`report.json` + 本 README + 12 张节点图

12 枚 = 两种拒绝理由 × 375/390/1440 × 亮暗，每枚都是 `locator.screenshot()` 截**卡本身**
（不是整页、不是视口），所以图里**只有**那张卡：警告三角 + 那句理由原文。

| 节点图 | 尺寸（现量 IHDR） | 它承担哪句主张 |
|---|---|---|
| `{dark,light}-375-data-refusal-invalid.png` | 319×45 | 「这个文件不是合法 JSON。」单行 |
| `{dark,light}-375-data-refusal-existing.png` | 319×65 | 「本机已经有数据 —— 还原只支持空库，现有数据一个字节都没动。」**折两行** |
| `{dark,light}-390-data-refusal-invalid.png` | 334×45 | 同上，390 档 |
| `{dark,light}-390-data-refusal-existing.png` | 334×65 | 同上，390 档**折两行** |
| `{dark,light}-1440-data-refusal-invalid.png` | 624×45 | 1440 档单行 |
| `{dark,light}-1440-data-refusal-existing.png` | 624×45 | 1440 档**不折行** —— 与 375/390 的 65 高成对 |

`report.json` 里这一腿每格交出 `refusalCards.{invalidText, existingText, reasonsDiffer, invalidInViewport, existingInViewport}`。
🔴 **`reasonsDiffer` 是这一批的牙**，不是那 12 张图：它判的是"两条腿真的是两条不同的拒绝理由"。
它的能红由一发变异证明过（把第一条腿喂的坏文件换成合法备份 ⇒ 两句变同一句 ⇒ 该判据转红），
读数与还原过程在台账那格里。

## 为什么要有这批（一把旧尺的射程问题）

数据面此前的两张状态图是 `page.screenshot({ fullPage: true })`，而设置浮层的内容滚在**内层容器**里
⇒ `fullPage` 对它是**空操作**（图高恒等于视口高）。同时判据 `refusalVisible` 用的是
`getByTestId('import-refused').isVisible()` ⇒ 它答的是"**渲染了没有**"，不是"**看得到吗**"。
两件事叠起来：390 那一档的两种拒绝态在图上**只差按钮行那 124×44 的位置**，理由文字一张都不在屏上。
本批用节点截图绕开滚动位置，并且把两种理由的**按节点几何**（45 / 65 高）交出来。

复现"390 那一档此前看不到"这句（零浏览器；对 r44 那批的同名两枚做差异包围盒）：

```bash
python3 - <<'PY'
from PIL import Image, ImageChops
base = 'apps/web/evidence/sync-privacy-leg-1009-r44-visual/'
for t in ('dark', 'light'):
    for w in (375, 390, 1440):
        a = Image.open(f'{base}{t}-{w}-data-failure-preserved.png').convert('RGB')
        b = Image.open(f'{base}{t}-{w}-data-refused-existing.png').convert('RGB')
        print(t, w, ImageChops.difference(a, b).getbbox())
PY
```

实测三档给 `(64,382,304,752)` / `(136,740,260,784)` / `(476,635,929,945)`，**亮暗两档逐字相同**。
390 那一行就是"两态在屏上长得一样"的那 124×44。

## 它**不证明**的三件事（照本账惯例列全）

1. **无头载体**（`carrier.headless` 现量）—— 与真实窗口态的差别见台账里"无头丢的不止 `default`"那一格。
2. **这是一趟只选 `data` 一条腿的局部趟，rc=1** —— 假的那条是 `themeLayerRulerSwitchesWithTier`
   （归属四条腿，而主检出这棵树上数据腿交不出共享层候选 ⇒ 配对尺被饿死），**不是**本批的新判据。
   整族读数在同一条线的另一批里，别把本目录的 rc 读成"这一腿坏了"。
3. **节点图只到"那句理由被画出来了"** —— 它不判颜色对比度（那由设计系统那条 WCAG 测试判）、
   不判这张卡在真实用户手里滚到不到（`invalidInViewport` 在 390 为 **false** 正是这件事的读数）。

其余产物（那 18 枚整页图、`*-backup.json` / `*-tasks.md` / `*-invalid.json` 夹具）**刻意不落库**：
整页图与 r44 那批只差"当前树"这一维，夹具是运行期临时文件。要别的图，重跑
（`HEYTA_RESPONSIVE_LEGS=data HEYTA_WEB_UI_SWEEP_EVIDENCE=<你自己的落点> pnpm verify:web-ui-sweep`）。
