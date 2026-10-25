# `apps/desktop-windows/xaml-probe` —— 让 WinUI 那一半**在 macOS/Linux 上判红**

> 入口：`pnpm check:windows-xaml`（`scripts/check-windows-xaml.mjs`）
> 状态：**在 macOS 上真跑通**（2026-10-25：129 项核对 / 0 问题；真实 C# 编译 0 警告 0 错误；
> 7 条变异臂全部按预期红，见 §4）
> 边界：**它不编 XAML**。样式键解析优先级 / 模板合法性 / `x:Bind` 的类型转换 /
> 控件树运行时行为，仍只有 Windows 上的 XamlCompiler + 一次真启动能回答（§5）。

---

## 0. 为什么这东西存在

2026-10-25 之前，`apps/desktop-windows/HeytaWindows`（WinUI 3 工程）在本机只能写、不能验：
`dotnet build` 在 macOS 上停在

```
XamlCompiler output file "obj/…/output.json" was not created
```

—— 因为 XAML 编译器是 Windows 专用二进制。当时我把它当成结论交了出去，产品负责人回：
「你是能解决的。」确实能。第一版是在 `/tmp` 里手工搭的一次性探针，当场抓到**三个会在
Windows 上直接编译失败的 bug**：

| # | bug | 在 Windows 上的下场 |
|---|---|---|
| 1 | `Windows.Graphics.SizeInt32` 被解析成 `Heyta.Windows.Graphics`（文件里有 `using Heyta.Windows.Host;`） | CS0234 |
| 2 | `KeyboardAccelerator` 在 `Microsoft.UI.Xaml.Input`，文件没 import | CS0246 |
| 3 | `<KeyboardAccelerator Key=",">` —— `Windows.System.VirtualKey` **没有逗号成员**（连 `Oem*` 都没有） | XAML 编译失败 |

但那一版有两个毛病，都属于本仓反复记过的形状：

- **它在 `/tmp`**：换个会话就没了，"验过"这件事没有留下任何可重跑的东西；
- **替身字段是手抄的**：11 个 `x:Name` 一条条对着 XML 写。加了控件没人补字段，
  而"漏一个字段"的表现是**探针绿、Windows 红** —— 最坏的方向。

所以这里把它重做成仓库内、可重跑、替身由工具生成的门禁。

## 1. 三层，以及每层判什么

```
scripts/check-windows-xaml.mjs          ← 编排（也是唯一入口）
  │
  ├─ tool/       Heyta.XamlProbe        net10.0 控制台，零 PackageReference
  │    ├─ emit-stubs : 从真实 .xaml 生成 x:Name 字段 + InitializeComponent()
  │    └─ validate   : 用 WinUI 元数据核对 XAML 里的每个名字
  │
  └─ compile/    WinUiCompileProbe      net10.0-windows10.0.19041.0 + UseWinUI
       └─ Compile Include 指向**仓库里的真实 .cs**（MainWindow / SettingsWindow / App / …）
```

| 层 | 判什么 | 判不了什么 |
|---|---|---|
| `emit-stubs` | `x:Name` 与 code-behind 手写字段重名（CS0102）、标签在元数据里找不到类型、code-behind 忘了 `partial`、自己又写了一遍 `InitializeComponent` | 不判布局 |
| `compile` | **真实 C#** 与真实 WinUI API 面：命名空间被 `using` 抢走、类型不在你以为的命名空间、控件没有那个成员、缺 import | 不判 XAML |
| `validate` | 元素类型 / 属性 / 事件 / 附加属性 / 枚举成员 / `x:Bind` 根成员 / `{ThemeResource}` `{StaticResource}` 键 / code-behind 里的处理器 / `x:Name` 唯一 / 基类与根元素一致 | 值由 TypeConverter 解释的那些（`GridLength` / `Thickness` / `FontWeight` / `Uri` / 字符串）**显式记账**，不装作验过 |

## 2. 元数据从哪来（别写死路径）

`compile/` 工程里有一条 MSBuild target：

```xml
<Target Name="HeytaDumpProbeInputs" AfterTargets="ResolveAssemblyReferences">
  <WriteLinesToFile File="obj/probe-refs.txt" Lines="@(ReferencePath)" … />
  <WriteLinesToFile File="obj/probe-out.txt"  Lines="$(TargetPath)" … />
</Target>
```

`tool` 只读这两份 —— 也就是**编译器真的看到的那些 DLL**。
按版本去猜包路径会随升级静默指向旧包，而"指向旧包"的表现是
"属性都在、Windows 上却没有"，正是这一层最该消灭的假绿。

读元数据用的是 .NET 自带的 `System.Reflection.Metadata`（`PEReader` + 自己写的
`ISignatureTypeProvider`），**没有 `PackageReference`**：`MetadataLoadContext` 要一个 NuGet 包，
而本仓库的规矩是"引入第三方组件先过可维护性 + 许可证两道门"。读 DLL 不值得为此加一条会漂的依赖。

## 3. 怎么跑

```bash
pnpm check:windows-xaml                 # 正常跑（约 10 秒，含还原）
HEYTA_XAML_VERBOSE=1 pnpm check:windows-xaml   # 逐条打印 OK …（取证用）
```

前置：`dotnet SDK ≥ 10`。**没有 dotnet 时显式跳过**（exit 0 + 一句"这一轮没有被验过"），
与 `check:windows-shell` 同一条规矩：宁可不跑并说出来，也不要假装跑过。
CI 的 ubuntu runner 就是这种情况 —— `ci.yml` 里有一条步骤专门交代它。

## 4. 它真的会红吗（7 条变异臂，2026-10-25 当场跑）

判据不是"我写了检查"，而是"喂坏件它会红，而且**只**红那一处"。每条臂都只改工作树的一份
临时副本（`/tmp/xaml-arms`），跑同一套 `validate`：

| 臂 | 注入 | 红在哪一句 |
|---|---|---|
| A | `<KeyboardAccelerator Key="," />` | `Key="," 里读不出任何 Windows.System.VirtualKey 的成员名` |
| B | `SelectionMode` → `SelectionModeX` | `上没有属性/事件 SelectionModeX` |
| C | `HeytaColorForegroundMuted` → `…MutedX` | `既不在 tokens 生成物里，也不在内建白名单里` |
| D | `{x:Bind Title}` → `{x:Bind Titel}` | `TextBlock 上没有成员 Titel`（CS1061 的形状） |
| E | `Click="OnDelete"` → `Click="OnDeleteX"` | `code-behind 里没有同名方法` |
| F | `x:Name="StatusText"` → `x:Name="AddButton"`（重复） | `在同一份 XAML 里重复` |
| G | `<WebView2` → `<WebView3` | `在元数据里找不到对应的 CLR 类型` |

臂 A 的价值最大：它就是 2026-10-25 抓到的那个 bug 的形状。而且**第一版判据把它放行了** ——
因为 `/` 之类被按分隔符切开之后一个成员名都不剩，循环体一次不跑，于是"全部合法"。
现在是显式的空集判红（`parts.Length == 0 ⇒ fail`）。**这一条是变异臂打出来的，不是读代码读出来的。**

同一次还打出另一处假绿：第一版的 XAML 命名空间候选表只写了
`Controls / 根 / Documents / Media / Shapes`，于是**正确的** `<KeyboardAccelerator Key="Enter"/>`
也会被判红 —— 因为它在 `Microsoft.UI.Xaml.Input`。
一个会把正确写法判红的判据，最后一定会被人关掉，所以改成从元数据里
把所有 `Microsoft.UI.Xaml*` 下的类型按短名索引（Controls 优先）。

## 5. 边界（别把绿读成"壳能用"）

- **不编 XAML。** 控件树合法性、样式键的解析优先级（`ThemeResource` 与字典顺序有关）、
  模板合法性、隐式样式、`x:Bind` 的类型转换与 `Mode` 语义，都只有 Windows 上的
  XamlCompiler 能回答。这里保证的是"名字与成员层面写不出那三个 bug"。
- **不跑界面。** 窗口能不能起、WebView2 能不能加载共享 UI、设置窗口是不是真的画出来了，
  仍然要一次真启动（§ `apps/desktop-windows/README.md` §7 的取证开关）。
- **`x:Bind` 只判根成员存在**，不判类型兼容（`bool` → `bool?` 这种转换由生成代码做）。

⇒ 在 Windows 机器上仍然要跑一遍
`dotnet build apps/desktop-windows/HeytaWindows/HeytaWindows.csproj`。
这里的绿只是把"大概率干净"变成"名字层面不可能错，剩下的是 XAML 语义"。
