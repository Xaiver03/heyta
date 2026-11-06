# 滴答清单 Windows 端 BAML → XAML 取证流水线

**一句话**：Windows 端 639 个 WPF BAML 里有我们唯一拿不到的那一层 —— **数值**
（`Width` / `Height` / `Margin` / `Padding` / `CornerRadius` / `FontSize`）。
本文件交付一条**可重跑**的通道把它们还原成可读 XAML，**639 → 638 成功、1 个失败**
（失败原因已定位到目标类自身的静态构造函数），并把从 XAML 读出的尺寸类事实按
「一条结论 + 一条能复现它的命令」列出来。

- 取证对象：滴答清单 Windows **8.2.5.0**（`TickTick, Version=8.2.5.0, Culture=neutral, PublicKeyToken=null`），
  安装目录 `C:\Program Files (x86)\滴答清单`，`TickTick.exe` **36,275,720 字节**。
- 取数通道：SSH 到远端 Windows（`ssh -o BatchMode=yes windows-pc`），PowerShell 5.1 / CLR 4.0.30319。
- 取证日期：2026-11-06。
- 本机产物：`/tmp/rea-lab/win/xaml/`（638 个 `.xaml`，**3.7 MB**）、
  `convert-manifest.tsv`（逐文件清单）、`convert-failures.tsv`（失败表）。
- 脚本：[`scripts/ticktick/baml-to-xaml.ps1`](../../scripts/ticktick/baml-to-xaml.ps1)（644 行 / 29 KB，带参数、可重跑）。

### 三条硬边界（写死，不随任务漂）

1. **不摘录它的界面文案。** XAML 里的 `Text` / `Content` / `ToolTip` 属性值一律不进本文；
   本文只统计**属性名与数值**。
2. **不把它的数值当我们的 token。** 本文所有数字都是「**它用了什么形状**」的观察记录，
   不是给 heyta 的取值建议。要新增/修改我们的变量，走
   [设计系统规则](../agents/design-system.md) 与 [界面结构原则](../agents/ux-principles.md)，
   真源是 `packages/design-system/src/tokens.css`。
3. **查不到就写「未核实」。** §6 是一张明确的缺口表，不拿推测填空。

---

## 1. 为什么必须走这条通道

### 1.1 数值不在字符串表里

`.baml` 是 WPF 的二进制编译产物（Binary Application Markup Language）。
里面**明文**的只有名字表（类型名、属性名、资源键）；而
`Width` / `Height` / `Margin` / `Padding` / `CornerRadius` / `FontSize` 这类属性的值
是按 BAML 记录格式存的 **`double` / `int32` / `Thickness` 结构**。

所以在本机对 639 个 `.baml` 直接 `strings`，**一个尺寸数字都拿不到**——
这不是工具不够好，是这一层根本没有可读字符。唯一权威的还原方式是让 WPF 自己的
`System.Windows.Baml2006.Baml2006Reader` 解析（它知道每条 BAML 记录的语义），
再用 `System.Xaml.XamlXmlWriter` 写成 XML。

```bash
# 复算：BAML 里捞不到尺寸字面量（本机 /tmp/rea-lab/win/ui 是 639 个 .baml）
$ strings -a /tmp/rea-lab/win/ui/views_mainwindow.baml | grep -cE '^(Height|Width)='
0
$ strings -a /tmp/rea-lab/win/ui/views_mainwindow.baml | grep -E 'Height|Width' | head -3
（空输出）
```

### 1.2 只用官方 reader+writer 会在 writer 崩掉

`XamlXmlWriter.WriteValue` **只接受 `string` 和 `Type`**。而 BAML 节点流里的属性值
大量是**已装箱的类型化对象**。实测（`-Survey`，见 §7）639 个 BAML 的 `Value` 节点类型分布：

| Value 节点 CLR 类型 | 个数 | 直接交给 writer 会怎样 |
|---|---:|---|
| `System.Windows.Baml2006.TypeConverterMarkupExtension` | 23,579 | `ArgumentException: 无法写入非字符串值` |
| `System.String` | 8,254 | 正常 |
| `System.Int32` | 4,189 | 同上报错 |
| `System.Windows.StaticResourceExtension` | 4,177 | 同上报错 |
| `System.Windows.DynamicResourceExtension` | 3,715 | 同上报错 |
| `System.Windows.Baml2006.DeferredBinaryDeserializerExtension` | 1,183 | 同上报错 |
| `System.Windows.DependencyProperty` | 1,263 | 同上报错 |
| `System.Boolean` | 1,214 | 同上报错 |
| `System.RuntimeType` | 557 | 同上报错 |
| `System.IO.MemoryStream` | 416 | 同上报错 |
| `System.Xaml.XamlNodeList` | 269 | 同上报错 |
| `System.Windows.Markup.StaticExtension` | 202 | 同上报错 |
| `System.Windows.Media.Int32Collection` | 2 | 同上报错 |

即：**不做任何处理的话，绝大多数文件连一个字节的 XAML 都写不出来**。
这就是为什么必须有中间层，而不是「顺手跑一下 `XamlServices.Transform`」。

### 1.3 因此脚本里打了三个补丁

| # | 补丁 | 解决什么 | 实测触发量 |
|---|---|---|---|
| 1 | `BamlValueStringifier`（XamlReader 包装器）：把每个 Value 节点**按 CLR 类型**还原成字符串（见上表逐类规则） | `无法写入非字符串值` | 覆盖全部 49,020 个 Value 节点 |
| 2 | 同一包装器里把伪成员 `_PositionalParameters` **改写成真实属性节点** | `XamlXmlWriterException: 无法写入给定的位置参数，因为找不到匹配的构造函数` | 改写 **1,491** 处（`{Binding Foo}` → `Path="Foo"`） |
| 3 | 丢掉**当前元素作用域内重复的命名空间声明**（XamlXmlWriter 按 **URI** 判重，第二次声明同 URI 就抛） | `XamlXmlWriterException: 命名空间 X 已具有一个在当前范围中定义的前缀` | 吞掉 **3** 条，救回 3 个文件 |

三个数字都在脚本收尾行打印：
`[9/9] 完成 OK=638 FAIL=1 TOTAL=639 POSITIONAL_REWRITES=1491 NS_DEDUPES=3`。

### 1.4 试过但不够用的四条路

| 路径 | 结论 |
|---|---|
| `strings` / `dnfile` 直接读 `.baml` | 拿不到任何尺寸字面量（§1.1） |
| `XamlServices.Load(...)` 直接实例化 | 会**真的构造控件对象**（执行它的构造函数），且遇到 `x:Class` / 自定义控件就断，比 reader 路线更危险也更脆 |
| `[System.Windows.Baml2006.Baml2006ReaderSettings]` 调参 | 该类型**不是公开类型**，`New-Object` 直接失败；`Baml2006Reader` 只有 `(string)` / `(Stream)` / `(Stream, XamlReaderSettings)` 三个公开构造函数（实测枚举，见 §7） |
| 自己写 BAML 解析器 | 可行但要重实现全部记录格式；官方 reader 已经把语义解出来了，只需在其后加一层 |

### 1.5 安全性

`Assembly.LoadFrom` `TickTick.exe` 只用于两件事：拿托管资源流（`GetManifestResourceStream`）
和让 `XamlSchemaContext` 反射到自定义控件类型。**载入程序集本身不执行 TickTick 代码**。
但要说清楚代价：解析每个 BAML 会触发 WPF / 控件类型的**静态构造**（`Baml2006Reader` 的固有行为）
—— §5 那个失败项正是这么暴露出来的。脚本不建窗口、不启动 TickTick、不读用户数据、不登录账号。

---

## 2. 脚本怎么用

### 2.1 参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `-InstallDir` | `C:\Program Files (x86)\滴答清单` | 必须含 `TickTick.exe` |
| `-OutDir` | `$env:TEMP\ttxaml` | 输出根目录；结构与 BAML 资源名同构 |
| `-ResourceName` | `TickTick.g.resources` | 实测 **23,120,890 字节 / 1,296 条目**（639 `.baml` + 657 其它） |
| `-Only` | 全转 | 通配符过滤**完整资源名**，例 `-Only 'views/mainwindow.baml'` |
| `-Survey` | 关 | 只做值节点类型普查，不写 XAML（§1.2 那张表的来源） |
| `-NoApplication` | 关 | 不建 `System.Windows.Application`（默认会建，部分 WPF 类型静态构造要摸 `Application.Current`） |

### 2.2 远端怎么执行（这一条踩过坑，照抄即可）

⚠️ **`ssh` 经 `cmd.exe` 转发，命令行上限约 8,191 字符。** 脚本本体 29 KB，
直接把脚本体编码进 `-EncodedCommand` 会得到 `命令行太长`。
正确姿势是**先把脚本 `scp` 上去，再用 `-EncodedCommand` 执行一句调用**：

```bash
# ① 转成 UTF-8 with BOM 再 scp（PowerShell 5.1 读无 BOM 的 UTF-8 会把中文注释读坏）
python3 -c "
d=open('scripts/ticktick/baml-to-xaml.ps1','rb').read()
open('/tmp/baml-to-xaml.ps1','wb').write(b'\xef\xbb\xbf'+d)"
scp -o BatchMode=yes /tmp/baml-to-xaml.ps1 \
    windows-pc:C:/Users/<user>/AppData/Local/Temp/baml-to-xaml.ps1

# ② 生成 -EncodedCommand 并执行（中文与引号才不会被吞）
cat > /tmp/mkenc.py <<'PY'
import base64
inner = (
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\n"
    "$ProgressPreference='SilentlyContinue'\n"
    "& 'C:\\Users\\<user>\\AppData\\Local\\Temp\\baml-to-xaml.ps1'"
)
print("powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand "
      + base64.b64encode(inner.encode("utf-16-le")).decode())
PY
ssh -o BatchMode=yes windows-pc "$(python3 /tmp/mkenc.py)"

# ③ 只转一个 view（-Only 直接拼在调用行里）
#    & 'C:\...\baml-to-xaml.ps1' -Only 'views/mainwindow.baml' -OutDir 'C:\...\ttone'
```

> ⚠️ `<user>` 要在**编码之前**替换（改 `mkenc.py` 里那行路径），不能对 base64 结果做替换。
> 上面这条链路已实测（把 `<user>` 换成真实用户名后直接跑）：
> `[9/9] 完成 OK=638 FAIL=1 TOTAL=639 POSITIONAL_REWRITES=1491 NS_DEDUPES=3`。

实测全量耗时 **5 秒**（`ELAPSED_SEC=5`）。

### 2.3 从 Windows 拉回本机

```bash
# Windows 侧打包（注意必须用绝对路径；%TEMP% 在 ssh/cmd 双引号里会被吃坏）
ssh -o BatchMode=yes windows-pc \
  'cmd /c "cd /d C:\Users\<user>\AppData\Local\Temp && tar -cf ttxaml.tar ttxaml"'

# 本机拉回并摊平到 /tmp/rea-lab/win/xaml
scp -o BatchMode=yes "windows-pc:C:/Users/<user>/AppData/Local/Temp/ttxaml.tar" /tmp/rea-lab/win/xaml.tar
mkdir -p /tmp/rea-lab/win/xaml
tar -xf /tmp/rea-lab/win/xaml.tar -C /tmp/rea-lab/win
mv /tmp/rea-lab/win/ttxaml/* /tmp/rea-lab/win/xaml/ && rmdir /tmp/rea-lab/win/ttxaml
```

### 2.4 产物

| 文件 | 内容 |
|---|---|
| `<OutDir>/**/*.xaml` | 638 个，路径同构（`views/mainwindow.baml` → `views/mainwindow.xaml`） |
| `<OutDir>/convert-manifest.tsv` | `baml · status · baml_bytes · xaml_bytes · xaml_relpath`，639 行 + 表头 |
| `<OutDir>/convert-failures.tsv` | `baml · exception · reason`，1 行 + 表头 |
| `<OutDir>/**/*.baml.raw` | 失败项的**原始 BAML 字节**（换环境/换工具复现用） |

### 2.5 幂等

每次运行先删 `<OutDir>` 下的 `*.xaml` / `*.tsv` / `*.raw` 三类文件（只这三类），再重转；
不会碰目录里别的东西。重跑三次结果一致（§7 有复算）。

---

## 3. 20 个关键 view 的转换结果

口径：`baml_bytes → xaml_bytes` 均取自 `convert-manifest.tsv`。
「一列」里的文件名都是相对 `/tmp/rea-lab/win/xaml/` 的路径。

| # | 关键 view | BAML 资源名 | 结果 | baml → xaml |
|---:|---|---|---|---:|
| 1 | 主窗 | `views/mainwindow.baml` | ✅ | 10,023 → 12,962 |
| 2 | 任务行 | `views/tasklist/item/subtasklistitem.baml` | ❌ **失败**（§5） | 4,731 → 0 |
| 3 | 任务详情 | `views/detail/taskdetailwindow.baml` | ✅ | 3,720 → 4,228 |
| 4 | 添加任务 | `views/quickadd/addtaskwindow.baml` | ✅ | 2,026 → 1,847 |
| 5 | 设置 | `views/settingdialog.baml` | ✅ | 4,730 → 2,869 |
| 6 | 日历（主体） | `views/calendar/calendarproview.baml` | ✅ | 2,848 → 2,748 |
| 7 | 日历（侧栏） | `views/calendar/calendarsidebar.baml` | ✅ | 1,604 → 1,193 |
| 8 | 专注 | `views/pomo/pomowindow.baml` | ✅ | 7,674 → 9,669 |
| 9 | 习惯 | `views/habit/habitlistcontrol.baml` | ✅ | 6,021 → 6,997 |
| 10 | 四象限 | `views/eisenhower/matrixcontainer.baml` | ✅ | 4,782 → 5,021 |
| 11 | 搜索 | `views/search/searchdialog.baml` | ✅ | 2,399 → 1,864 |
| 12 | 筛选 | `views/filter/normalfiltercontrol.baml` | ✅ | 7,378 → 11,585 |
| 13 | 标签 | `views/tag/addoredittagwindow.baml` | ✅ | 5,555 → 6,665 |
| 14 | 项目 | `views/editprojectdialog.baml` | ✅ | 11,591 → 16,901 |
| 15 | 清单 | `views/checklist/checklistcontrol.baml` | ✅ | 1,930 → 1,444 |
| 16 | 回收站 | —（**不存在**，见下） | ⚠️ 未核实 | — |
| 17 | AI 建议 | `views/ai/airecommendwindow.baml` | ✅ | 8,853 → 12,497 |
| 18 | 升级 | `views/upgrade/manageprosubscribewindow.baml` | ✅ | 3,418 → 1,295 |
| 19 | 模板 | `views/config/edittemplatewindow.baml` | ✅ | 2,079 → 2,453 |
| 20 | 笔记 / markdown | `views/markdown/markdowneditor.baml` | ✅ | 4,189 → 5,989 |
| 21 | 成绩 / 统计 | `views/summary/summarycontrol.baml` | ✅ | 14,206 → 21,149 |

**19 个转成功**（表里 21 行是因为日历拆成主体+侧栏、成绩统计单列）。两个要解释的：

- **回收站没有自己的 BAML。** 639 个资源名里没有一个命中 `trash` / `recycle` / `deleted`：

  ```bash
  cd /tmp/rea-lab/win/xaml
  awk -F'\t' 'NR>1 && tolower($1) ~ /trash|recycl|deleted/' convert-manifest.tsv | wc -l
  # → 0
  ```
  它大概率复用任务列表那套视图（同一份 XAML + 不同数据源），但**这条推论未核实**：
  要坐实得看代码里的导航逻辑，不在本支线范围。

- **`日历` 与 `成绩/统计` 各拆了两个文件**，因为它在 Windows 上就是两个独立 BAML，
  合成一个数字会掩盖「侧栏是独立模板」这个事实。

复算这两列：

```bash
cd /tmp/rea-lab/win/xaml
awk -F'\t' 'NR>1{printf "%-50s %-4s %7s %7s\n",$1,$2,$3,$4}' convert-manifest.tsv \
  | grep -E 'mainwindow|subtasklistitem|taskdetailwindow|addtaskwindow|settingdialog|calendarproview|calendarsidebar|pomowindow|habitlistcontrol|matrixcontainer|searchdialog|normalfiltercontrol|addoredittagwindow|editprojectdialog|checklistcontrol|airecommendwindow|manageprosubscribewindow|edittemplatewindow|markdowneditor|summarycontrol'
```

---

## 4. 从 XAML 读出的尺寸类事实

### 4.0 一条命令复算本节全部数字

把下面这段存成 `an3.py` 再跑（**本节所有表格都是它的输出**，无手工改动）：

```python
#!/usr/bin/env python3
"""滴答清单 Windows XAML 尺寸类属性分布统计。用法: python3 an3.py [XAML根目录]"""
import re, sys, glob, collections

root = sys.argv[1] if len(sys.argv) > 1 else '/tmp/rea-lab/win/xaml'
files = sorted(glob.glob(root + '/**/*.xaml', recursive=True))
ELEM = re.compile(r'<([A-Za-z_][\w.:-]*)((?:\s+[^<>]*?)?)/?>')
ATTR = re.compile(r'([A-Za-z_][\w.:-]*)="([^"]*)"')
NUM  = re.compile(r'^\d+(?:\.\d+)?$')
PLAIN = ('Margin', 'Padding', 'CornerRadius', 'BorderThickness')
cnt = {k: collections.Counter() for k in
       ('Height', 'Margin', 'Padding', 'CornerRadius', 'FontSize', 'BorderThickness')}
bytag = collections.defaultdict(collections.Counter)
nel = nfil = 0
for f in files:
    s = open(f, encoding='utf-8').read(); seen = False
    for tag, body in ELEM.findall(s):
        nel += 1
        a = dict(ATTR.findall(body))
        if 'Height' in a and NUM.match(a['Height']):
            cnt['Height'][a['Height']] += 1; bytag[tag][a['Height']] += 1; seen = True
        if 'FontSize' in a and NUM.match(a['FontSize']): cnt['FontSize'][a['FontSize']] += 1
        for k in PLAIN:
            if k in a and not a[k].startswith('{'): cnt[k][a[k]] += 1
    nfil += seen
print(f"files={len(files)} elements={nel} files_with_numeric_Height={nfil}")
for k in ('Height', 'Margin', 'Padding', 'CornerRadius', 'FontSize', 'BorderThickness'):
    c = cnt[k]
    print(f"\n## {k}  (n={sum(c.values())}, 不同取值={len(c)})")
    for v, n in c.most_common(12): print(f"  {n:>4}  {v}")
print("\n## Height by element")
for tag in ('Button', 'Border', 'Grid', 'RowDefinition', 'TextBox', 'Path', 'ContentControl', 'StackPanel'):
    if bytag[tag]: print(f"  {tag:<15}", ', '.join(f'{v}x{n}' for v, n in bytag[tag].most_common(6)))
```

```bash
$ python3 an3.py
files=638 elements=21111 files_with_numeric_Height=371
```

> ⚠️ **统计口径**：`Height` 只收**纯数字**值（4 值 / `auto` / `{Binding}` 不算控件高度）；
> `Margin` / `Padding` / `CornerRadius` / `BorderThickness` 收**字面量原样**
> （含 `0,0,8,0` 这种四元组，以 `{` 开头的绑定跳过）；
> `FontSize` 只收纯数字。下面每张表都标了 `n=` 与「不同取值」个数——**n 不是控件数**，
> 是「带这个属性字面量的元素次数」。

### 4.1 语料规模

| 读数 | 值 | 命令 |
|---|---:|---|
| XAML 文件数 | 638 | `find /tmp/rea-lab/win/xaml -name '*.xaml' \| wc -l` |
| 元素总数 | 21,111 | `python3 an3.py` 首行 |
| 带数字 `Height` 的文件数 | 371 / 638 | 同上 |
| `Height` 字面量出现次数 | 2,056 | 同上 |
| `convert-manifest.tsv` 里 `OK` 行 | 638 | `awk -F'\t' 'NR>1 && $2=="OK"' convert-manifest.tsv \| wc -l` |
| `convert-manifest.tsv` 里 `FAIL` 行 | 1 | `awk -F'\t' 'NR>1 && $2=="FAIL"' convert-manifest.tsv \| wc -l` |

### 4.2 控件高度分布（`Height`，n=2,056，150 种取值）

| 值 | 次数 | | 值 | 次数 |
|---:|---:|---|---:|---:|
| 28 | 162 | | 32 | 97 |
| 24 | 160 | | 30 | 90 |
| 40 | 151 | | 36 | 86 |
| 16 | 127 | | 14 | 73 |
| 18 | 124 | | 22 | 50 |
| 12 | 120 | | 34 | 42 |
| 20 | 112 | | 50 | 29 |

**形状**：它的高度不是一个干净的 4pt 网格，而是**两簇**——
一簇 12–22（图标 / 小徽标 / 行内元素），一簇 24–40（可以点的控件）。
中间 26/29/34 这种值存在但很少（26 只出现 28 次、34 出现 42 次）。
150 种不同取值说明它**大量逐处硬编码**，不是从一套 scale 里取。

按元素类型拆开（`python3 an3.py` 末段），能看出这一簇是谁贡献的：

| 元素 | 最常见的 6 个 Height |
|---|---|
| `Button` | 24×24, 30×24, 28×21, 36×16, 32×10, 25×5 |
| `Border` | 24×36, 40×30, 20×29, 28×24, 32×17, 18×15 |
| `Grid` | 40×84, 32×37, 28×33, 30×25, 36×21, 24×20 |
| `RowDefinition` | 40×23, 48×7, 32×7, 60×5, 12×4, 24×4 |
| `TextBox` | 24×16, 36×12, 28×9, 32×7, 20×6, 30×2 |
| `Path`（图标） | 12×73, 16×66, 18×64, 14×42, 20×26, 22×8 |
| `ContentControl` | 28×13, 44×4, 42×1, 0×1, 10×1 |
| `StackPanel` | 20×10, 24×5, 56×3, 44×3, 30×2, 22×2 |

值得单独记一条：**`Button` 没有单一高度**（24 / 30 / 28 / 36 / 32 各占 10–24 次）。
也就是说它**没有做到「控件高度一档」**——这正是
[界面结构原则](../agents/ux-principles.md) 里那条判据要防的东西。
这是「它长什么样」的观察，不是我们要照抄的结论。

### 4.3 常用 `Margin`（n=3,008，1,083 种取值）

| 值 | 次数 | 形态 |
|---:|---:|---|
| `0` | 117 | 单值 |
| `0,0,8,0` | 55 | 右侧 8 |
| `0,0,0,0` | 50 | 显式清零 |
| `4,0` | 47 | 左右 4 |
| `4,0,0,0` | 47 | 左 4 |
| `0,0,10,0` | 37 | 右侧 10 |
| `8,0,0,0` | 33 | 左 8 |
| `2,0,0,0` | 31 | 左 2 |
| `0,12,0,0` | 30 | 上 12 |
| `0,1,0,0` | 29 | 上 1（像素级微调） |
| `10` | 29 | 单值 |
| `0,10,0,0` | 29 | 上 10 |

**形状**：`Margin` 是它最主要的间距手段，但**方向偏「右 / 左 / 上」**——
`0,0,8,0`（右 8）、`4,0,0,0`（左 4）、`0,12,0,0`（上 12）说明它在做
「横向靠 margin 挤、纵向靠 margin 分段」。下边距（第 4 位）几乎总是 0。
1,083 种不同取值 = **间距没有 token 化**。

### 4.4 常用 `Padding`（n=173，92 种取值）

| 值 | 次数 |
|---:|---:|
| `0` | 19 |
| `4,0` | 13 |
| `8,0` | 12 |
| `16,0` | 5 |
| `0,0,0,0` | 5 |
| `10,0` | 5 |
| `4,2` | 4 |
| `28,0,6,0` | 4 |
| `0,0` | 3 |
| `42,0,6,0` | 3 |
| `6,0,0,0` | 3 |
| `20,0` | 2 |

**形状**：`Padding` 用得比 `Margin` 少一个数量级（173 对 3,008），
且集中在**纯水平**（`4,0` / `8,0` / `16,0` / `10,0`）——
它把纵向空间交给 `Height` 与 `Margin`，横向留给 `Padding`。
出现 `28,0,6,0` / `42,0,6,0` 这种大左值，是给「前置图标 + 文本」的行模板让位。

### 4.5 `CornerRadius`（n=485，47 种取值）

| 值 | 次数 |
|---:|---:|
| 6 | 110 |
| 8 | 90 |
| 4 | 66 |
| 12 | 40 |
| 10 | 28 |
| 2 | 24 |
| 18 | 14 |
| 14 | 11 |
| 3 | 10 |
| 17 | 9 |
| 20 | 8 |
| 9 | 6 |

**形状**：主力是 **6 / 8 / 4**（合计 266 / 485 = **54.8%**），
第二梯队 12 / 10（68 / 485 = 14.0%）。但 47 种取值里有一串「非整数感」的
9 / 11 / 13 / 17 / 21 —— 这些通常是**圆形**（半径 = 尺寸的一半）而不是圆角设计值，
例如 `Ellipse` 或胶囊按钮。**当圆角用就会读错**，引用前必须看它是挂在哪个元素上。

### 4.6 字号：**它的单位不是 pt，是 DIP**

🔴 **这是一处必须纠正的口径。** WPF 的 `FontSize` 是
**设备无关像素（DIP，1/96 英寸）**，不是点（pt，1/72 英寸）。
换算：`1 pt = 96/72 = 1.3333 DIP`，即 **`DIP ÷ 1.3333 = pt`**。

| XAML 里的 `FontSize` | 次数 | 折算 pt（÷1.3333） |
|---:|---:|---:|
| 14 | 233 | ≈ 10.5 |
| 12 | 192 | 9 |
| 13 | 152 | ≈ 9.75 |
| 16 | 77 | 12 |
| 11 | 38 | ≈ 8.25 |
| 20 | 16 | 15 |
| 9 | 15 | ≈ 6.75 |
| 18 | 14 | 13.5 |
| 10 | 13 | 7.5 |
| 15 | 7 | ≈ 11.25 |
| 24 | 6 | 18 |
| 17 | 5 | ≈ 12.75 |

（n=786，22 种取值。）

**形状**：字面量主力是 **14 / 12 / 13**（合计 577 / 786 = **73.4%**），
三档挤在 12–14 DIP（9–10.5 pt）这个窄带里；16 DIP（12 pt）是第四档。
换句话说：**它日常正文与次要文字的字号差不到 1pt**，
层级靠字重、颜色和间距撑，不是靠字号拉开。

另有 **114 处**走的是具名 token 而不是字面量：

```bash
grep -rhoE '\{\}\{DynamicResource Font[0-9]+\}' --include='*.xaml' . | sort | uniq -c | sort -rn
#  36  {}{DynamicResource Font12}
#  32  {}{DynamicResource Font13}
#  30  {}{DynamicResource Font14}
#   8  {}{DynamicResource Font16}
#   4  {}{DynamicResource Font11}
#   3  {}{DynamicResource Font18}
#   1  {}{DynamicResource Font20}
```

`Font12` / `Font13` / `Font14` / `Font16` 这些键名与字面量主力**一一对上**，
可以认为它们是同一套阶梯的「token 化版本」。但**这 7 个键的实际数值未能从 XAML 读出**
——原因见 §6.1（资源字典正文是延迟二进制块）。

### 4.7 `BorderThickness`（n=316，14 种取值）

| 值 | 次数 |
|---:|---:|
| 1 | 166 |
| 0 | 105 |
| 2 | 11 |
| 20 | 10 |
| `0,1,0,0` | 5 |
| 1.5 | 5 |

**形状**：**1** 是绝对主力（166 / 316 = 52.5%），`0` 次之（显式去掉边框）。
`20` 那 10 次不是描边，是「留白用的透明边」——引用前要看元素。
`1.5` 出现 5 次，说明它没有把描边宽度收敛到整数网格。

### 4.8 主窗的具体读数（可直接引用）

```bash
$ python3 - <<'PY'
import re
s = open('/tmp/rea-lab/win/xaml/views/mainwindow.xaml', encoding='utf-8').read()
m = re.search(r'<([A-Za-z_][\w.:-]*)((?:\s+[^<>]*?)?)>', s)   # 跳过 <?xml ...?> 声明
a = dict(re.findall(r'([A-Za-z_][\w.:-]*)="([^"]*)"', m.group(2)))
print('ROOT=', m.group(1))
for k in ('Height', 'Width', 'MinHeight', 'MinWidth', 'ResizeMode', 'UseLayoutRounding'):
    if k in a: print(f'  {k}={a[k]}')
PY
ROOT= tv:MainWindow
  Height=780
  Width=1140
  MinHeight=400
  MinWidth=400
  ResizeMode=CanResize
  UseLayoutRounding=True
```

即 **主窗 1140×780 DIP，最小 400×400，可缩放，开启布局舍入**。
主窗内部第一层 `Grid` 的 `RowDefinition` 里有一档 **`Height="32"`**（标题/工具行），
`ColumnDefinition` 里有一档 **`Width="50"`**（左侧竖条）——同样是字面量，不是 token。

### 4.9 这些数字「是什么形状」，不是我们的 token

把 §4.2–§4.7 放在一起，它呈现的形状是：

- **高度**：两簇（12–22 图标 / 24–40 控件），150 种取值 ⇒ **逐处硬编码，无 scale**。
- **间距**：`Margin` 主导（3,008 次）、`Padding` 辅助（173 次），1,083 种取值 ⇒ **同样无 token**。
- **圆角**：6/8/4 为主力，但混入大量「半径=尺寸一半」的圆形值 ⇒ **需要按元素判读**。
- **字号**：12/13/14 DIP 三档窄带 + 16 一档；单位是 DIP 不是 pt。
- **描边**：1 DIP 为主力。

**这不是给 heyta 的取值建议。** 反过来看，它恰好是
[设计系统规则](../agents/design-system.md) 里「组件禁止裸值」那条的反例：
一个成熟产品在有设计系统的情况下仍然留下了 1,083 种 `Margin`。
我们要学的是**它在哪里必须逐处微调**（图标对齐、像素级补偿），
不是把这些裸值搬过来。

---

## 5. 失败项（1 个，不许跳过）

| BAML | 异常 | 位置 | 留档 |
|---|---|---|---|
| `views/tasklist/item/subtasklistitem.baml`（4,731 B） | `System.TypeInitializationException` | `ticktick_WPF.Views.TaskList.Item.ListItemContent..cctor()` 内的 `System.NullReferenceException` | `/tmp/rea-lab/win/xaml/views/tasklist/item/subtasklistitem.baml.raw` |

完整异常链（`convert-failures.tsv` 原文）：

```
System.TypeInitializationException: “ticktick_WPF.Views.TaskList.Item.ListItemContent”的类型初始值设定项引发异常。
  <- System.NullReferenceException: 未将对象引用设置到对象的实例。
```

**它连节点流都读不出来**，不是 writer 阶段的问题：`Baml2006Reader.Read()` 第一次调用就抛。
精确到构造函数：

```powershell
$t = $asm.GetType('ticktick_WPF.Views.TaskList.Item.ListItemContent')
[System.Runtime.CompilerServices.RuntimeHelpers]::RunClassConstructor($t.TypeHandle)
# TypeInitializationException ... ST2 在 ticktick_WPF.Views.TaskList.Item.ListItemContent..cctor()
```

### 5.1 已排除的四个可能（都实测过）

验证用的都是**一次性探针脚本**（脚本本身留在远端 `%TEMP%`，未入库），但每条都能按下面的
「怎么验」重做：

| 假设 | 怎么验 | 结果 |
|---|---|---|
| 「反射加载（`ReflectionOnlyLoadFrom`）导致的」 | 把 `baml-to-xaml.ps1` 里那行换成 `[System.Reflection.Assembly]::LoadFrom($ExePath)` 后重跑 | 同样失败 |
| 「缺 `Application.Current`」 | 在 `Baml2006Reader` 之前先 `New-Object System.Windows.Application` 再读该 BAML | 同样失败 |
| 「缺它的主题资源字典」 | 按 `app.xaml` 的 `MergedDictionaries` 先合并 `Resource/FontResource/Font_Normal.xaml`、`Resource/ColorResource.xaml`、`Resource/Themes/Default.xaml`、`Styles/Styles.xaml` 等 6 个字典，再读 | 同样失败 |
| 「SSH 是 session 0、没有桌面」 | `schtasks /create /tn TTOne /tr "powershell -NoProfile -ExecutionPolicy Bypass -File <调用脚本>" /sc once /st 00:00 /it /f` + `schtasks /run /tn TTOne`，让它在**已登录的交互式会话**里跑同一个 `-Only` 单文件转换 | **同样失败**（远端日志收尾行 `OK=0 FAIL=1`；`query session` 可确认执行时确实在 console 会话） |

所以结论是：**这个类的静态构造函数需要 TickTick 自己的启动序列**（某些静态字段/单例
在 `App` 启动时才被填），脱离它的进程就 NRE。不是我们的环境问题，也不是参数问题。
`schtasks` 那条路顺带排除了「只要有人在桌面前就会好」这个最容易被当成借口的解释。

> 复盘一句：这条失败是**探针逼出来的** —— 如果当初只跑一次全量、看到
> `OK=638 FAIL=1` 就收工，就会把它误记成「偶发」或「工具不支持」。
> 四个假设各花不到 5 分钟，换来的是一个能写进文档的确定结论。

### 5.2 影响面与替代

- **只有这 1 个文件受影响。** 其余 638 个都不引用该类作为根类型。
- 🔴 影响要说清楚：**「任务行」这一项因此拿不到 XAML**。
  而 `views/tasklist/item/` 目录下**只有这一个 BAML**（`awk` 可复算）——
  也就是说它不是「主行 + 子行」两套模板，而是只暴露了这一个。
  **主任务行的模板是否在代码里构造，未核实**（要看反编译的代码，不在本支线范围）。
- 能拿到的最近替代（都已转换成功，行状模板）：
  `views/checklist/checklistitemcontrol.xaml`（清单行）、
  `views/habit/habitlistitem.xaml`（习惯行）、
  `views/kanban/item/kanbanitemcontent.xaml`（看板卡）。
  它们是**别的行**，不能冒充任务行的高度。

---

## 6. 未核实项

### 6.1 资源字典的正文读不出来（影响最大的一条）

`resource/` 下 145 个文件转换后的 XAML **小于 400 字节**，正文不是 XAML，而是
BAML 的**延迟二进制块**：

```bash
cd /tmp/rea-lab/win/xaml
cat resource/fontresource/font_normal.xaml
# <?xml ...?><ResourceDictionary DeferrableContent="<!--deferred-stream:1522B-->" ... />
awk -F'\t' 'NR>1 && $2=="OK" && $4<400' convert-manifest.tsv | wc -l
# → 145
```

整个产物里有 **416 个** `<!--deferred-stream:NB-->` 与 **269 个** `<!--deferred-nodelist-->`
标记（`grep -o` 可复算）。后果：

| 想拿的东西 | 状态 | 原因 |
|---|---|---|
| `resource/colorresource.baml` 的配色键值 | **未核实** | 正文是 `deferred-stream`（225 B 的壳）；颜色另走 `colors.txt` 那条线 |
| `resource/fontresource/*.baml` 的字号/字体族 | **未核实** | 同上（285 B 的壳） |
| `Font12`/`Font13`/`Font14`/`Font16` 等 7 个具名 token 的实际数值 | **未核实** | 定义在延迟块里；只知道**被引用 114 次**（§4.6） |
| `icons_*.baml` / `svg` 图元 | **未核实** | 同上 |
| 模板（`ControlTemplate`/`DataTemplate`）内部的延迟内容 | **部分未核实** | 269 个 `deferred-nodelist` 没展开；模板**结构**在 XAML 里，被延迟的是内联节点块 |

**要接着挖的入口**：这些块是 BAML 的 `DeferrableContent`，可以用
`System.Windows.Baml2006.DeferredBinaryDeserializerExtension.ProvideValue()` 解（脚本里对
`DeferredBinaryDeserializerExtension` 已经这么做了，救回了 1,183 处 Brush 值），
但对 `ResourceDictionary` 级的 `DeferrableContent` 需要 `ParserContext` 与资源程序集上下文，
本次**没打通**。

### 6.2 其余未核实项

| 项 | 状态 | 说明 |
|---|---|---|
| 任务行的真实模板 | **未核实** | §5.2：唯一 BAML 读不出来，主行是否在代码里构造未验证 |
| 回收站的视图 | **不存在 BAML**（已坐实）→ 复用哪套视图 **未核实** | §3 |
| 实际渲染像素（运行时尺寸） | **未核实** | 本支线只做静态 XAML，没有截图/取窗口量测；`MinWidth` 之类也只在特定 DPI 下才生效 |
| DPI 缩放后的实际物理像素 | **未核实** | XAML 里的都是 DIP；`UseLayoutRounding=True` 说明它按 DIP 舍入 |
| 主题切换后的取值 | **未核实** | 大量颜色/尺寸走 `{DynamicResource}`，本支线不解引用 |
| 动效时长/缓动 | **未核实** | `Storyboard` 时长在 XAML 里能看到，但本支线未统计（不属尺寸类） |

---

## 7. 已知失真（引用前必须知道的四条）

1. **标记扩展被写成转义字面量 `{}{...}`。**
   因为包装器把值还原成**字符串**，`XamlXmlWriter` 会给以 `{` 开头的字符串加 `{}` 前缀
   以免被误读成标记扩展。所以：
   `{}{StaticResource X}`（2,928 处）、`{}{DynamicResource X}`（3,451 处）、
   `{}{x:Static ...}`（1,394 处）。
   **它表达的是「这里引用了一个资源」，不是可直接编译的 XAML。**
   复算：`grep -rho --include='*.xaml' -F '"{}{StaticResource ' . | wc -l`
2. **延迟块只剩 XML 注释。** `<!--deferred-stream:1522B-->` 保留了**字节数**（可复现），
   但内容没有。不要把它当空值，也不要当零。
3. **每个文件是单行。** `XamlXmlWriter` 不缩进，`views/mainwindow.xaml` 是 12,962 字节的一整行。
   用 `grep -o ' Height="[0-9]*"'` 取值，不要指望行号；本文也因此**不引用行号**。
4. **两套名字属性并存。** BAML 里的 `x:ConnectionId`（编译器内部连接 ID）与
   `x:Name`/`Name`（真正的元素名）都会出现。`x:ConnectionId` **不是控件名**，
   按名字检索时要排除它。

另附一条环境事实（会反复踩）：**`ssh` 经 `cmd.exe`，命令行上限约 8,191 字符**，
所以「把脚本体塞进 `-EncodedCommand`」在小脚本上可行、在 29 KB 的脚本上必然
`命令行太长`。正确做法见 §2.2。同理 `%TEMP%` 在 `ssh` + `cmd /c "…"` 的双引号里会被吃坏，
打包命令必须写绝对路径。

---

## 8. 一句话验收

```bash
# 1) 文件数对得上
$ find /tmp/rea-lab/win/xaml -name '*.xaml' | wc -l
638
$ awk -F'\t' 'NR>1 && $2=="OK"'   /tmp/rea-lab/win/xaml/convert-manifest.tsv | wc -l   # 638
$ awk -F'\t' 'NR>1 && $2=="FAIL"' /tmp/rea-lab/win/xaml/convert-manifest.tsv | wc -l   # 1

# 2) 尺寸数字真的落地了（不是类型名）
$ grep -o ' Height="[0-9]*"' /tmp/rea-lab/win/xaml/views/mainwindow.xaml | head -3
 Height="780"
 Height="32"
 Height="25"

# 3) 本节所有表格能一次复算
$ python3 an3.py | head -3
files=638 elements=21111 files_with_numeric_Height=371
```

---

## 9. 交接

- 脚本：[`scripts/ticktick/baml-to-xaml.ps1`](../../scripts/ticktick/baml-to-xaml.ps1)
  （幂等、带参数、每步有注释；`-Survey` 可复核 §1.2 那张类型分布表）。
- 产物：`/tmp/rea-lab/win/xaml/`（638 XAML + 2 张 TSV；刻意**不进仓** ——
  它是它的编译产物，重分发有风险，按 §1.5 的边界只留在 `/tmp`）。
- 需要**颜色 / 字体 token 的具体值**的话，本支线给不了（§6.1），要另开一条
  「解 `DeferrableContent`」的通道，或用 `colors.txt` 那条已有的线。
- 本文件**未在 `docs/README.md` 登记**：那份文件按任务边界不许我改，
  登记留给文档 owner。
