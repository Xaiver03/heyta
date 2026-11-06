<#
.SYNOPSIS
    滴答清单 (TickTick) Windows 端 WPF BAML -> XAML 批量转换器。

.DESCRIPTION
    目标：把 TickTick.exe 内嵌的 `TickTick.g.resources` 里全部 639 个 .baml 反序列化成
    可读 .xaml，供「控件尺寸/间距/圆角/字号」逆向取证引用。

    为什么必须走这条通道（而不是直接读 .baml 字节）：
      BAML 是 WPF 的二进制编译产物（Binary Application Markup Language）。.baml 里只有
      名字表是明文的；Width/Height/Margin/Padding/CornerRadius/FontSize 这些**数值**
      按 BAML 记录格式存成 double/int32，`strings` 一个都看不到。唯一权威的还原方式是
      让 WPF 自己的 `System.Windows.Baml2006.Baml2006Reader` 解析（它知道每条记录的
      语义），再用 `System.Xaml.XamlXmlWriter` 写成 XML。

    为什么要插一层包装器（本脚本 90% 的复杂度都在这里）：
      Baml2006Reader 吐出的节点流里，属性值是**已装箱的类型化对象**
      （double / enum / Brush / `TypeConverterMarkupExtension` / `StaticResourceExtension` /
      `DeferredBinaryDeserializerExtension` ...），而 `XamlXmlWriter.WriteValue` 只接受
      string 和 Type，遇到其它装箱值直接抛 `ArgumentException: 无法写入非字符串值`。
      实测 639 个 BAML 的 Value 节点类型分布（用 `-Survey` 可复现）：
        TypeConverterMarkupExtension 23579 / String 8254 / Int32 4189 /
        StaticResourceExtension 4177 / DynamicResourceExtension 3715 /
        DeferredBinaryDeserializerExtension 1183 / DependencyProperty 1263 /
        Boolean 1214 / RuntimeType 557 / MemoryStream 416 / XamlNodeList 269 /
        StaticExtension 202 / Int32Collection 2
      所以必须在 reader 与 writer 之间插一层 `BamlValueStringifier`（XamlReader 包装器，
      本脚本用 Add-Type 现场编译）：把每个 Value 节点按上表逐类还原成字符串/标记文本。

    第二处补丁：`_PositionalParameters`
      BAML 把「用构造函数实参写的标记扩展」存成特殊成员 `_PositionalParameters`，
      典型就是 `{Binding Foo}` 这种简写（Foo 是 Binding(string path) 的实参）。
      XamlXmlWriter 不认识这个伪成员，会抛
      `XamlXmlWriterException: 无法写入给定的位置参数，因为找不到匹配的构造函数`。
      实测 39 个文件因此转不出来，其中包含「习惯」「筛选」「升级」等关键 view。
      包装器把这些节点改写成真实属性节点（`_PositionalParameters` -> `Path`），
      语义等价（`{Binding Foo}` == `Path="Foo"`），并记录改写次数。

    安全性：
      `Assembly.LoadFrom` TickTick.exe 只为拿托管资源流（GetManifestResourceStream）
      和让 XamlSchemaContext 反射到自定义控件类型。载入程序集本身不执行 TickTick 代码；
      但解析每个 BAML 会触发 WPF/控件类型的静态构造（Baml2006Reader 的固有行为）。
      不创建窗口、不启动 TickTick、不读用户数据。

    可重跑：每次运行先删掉 -OutDir 下的 *.xaml / *.tsv / *.baml.raw（只这三类），再重转。

.PARAMETER InstallDir
    滴答清单安装目录，默认 `C:\Program Files (x86)\滴答清单`，必须含 TickTick.exe。

.PARAMETER OutDir
    输出目录，默认 `$env:TEMP\ttxaml`。输出与 BAML 资源名同构：
    `views/mainwindow.baml` -> `<OutDir>\views\mainwindow.xaml`。

.PARAMETER ResourceName
    托管资源名，默认 `TickTick.g.resources`（8.2.5.0 实测 23,120,890 字节 / 1296 条目）。

.PARAMETER Only
    只转匹配的资源名（通配符，对完整资源名匹配）。省略=全转。

.PARAMETER Survey
    只做「值节点类型普查」，不写 XAML。用来复核本文档与注释里引用的类型计数。

.PARAMETER NoApplication
    不创建 `System.Windows.Application`。默认创建（部分 WPF 类型静态构造要摸
    Application.Current）。用完 Shutdown。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ticktick\baml-to-xaml.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass `
        -File scripts\ticktick\baml-to-xaml.ps1 -OutDir D:\ttxaml `
        -Only 'views/mainwindow.baml','views/settingdialog.baml'

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ticktick\baml-to-xaml.ps1 -Survey

.NOTES
    从 macOS 拉回（实测可用的四条命令）：
        ssh windows-pc 'cmd /c tar -cf %TEMP%\ttxaml.tar -C %TEMP% ttxaml'
        scp windows-pc:%TEMP%/ttxaml.tar /tmp/rea-lab/win/xaml.tar
        mkdir -p /tmp/rea-lab/win/xaml
        tar -xf /tmp/rea-lab/win/xaml.tar -C /tmp/rea-lab/win

    远端执行一律用 -EncodedCommand（中文与引号才不会被 ssh/cmd 吞掉）。
      注意 ssh 经 cmd.exe 转发，命令行上限约 8191 字符，脚本本体必须先 scp 上去，
      再用 -EncodedCommand 执行一句「& '<远端脚本路径>'」。
#>

[CmdletBinding()]
param(
    [string]   $InstallDir   = 'C:\Program Files (x86)\滴答清单',
    [string]   $OutDir       = (Join-Path $env:TEMP 'ttxaml'),
    [string]   $ResourceName = 'TickTick.g.resources',
    [string[]] $Only,
    [switch]   $Survey,
    [switch]   $NoApplication
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
# Write-Host 的信息流经 ssh 会被序列化成 CLIXML 噪音，全程只用 Write-Output
$InformationPreference = 'SilentlyContinue'

# --- 步骤 0：控制台强制 UTF-8 -------------------------------------------------------
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

# --- 步骤 1：加载 WPF / XAML 程序集 ------------------------------------------------
# PresentationFramework 提供 Baml2006Reader；System.Xaml 提供 XamlXmlWriter。
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName System.Xaml
Write-Output "[1/9] 程序集已加载 PS=$($PSVersionTable.PSVersion) CLR=$([System.Environment]::Version)"

# --- 步骤 2：编译 BamlValueStringifier 包装器 ---------------------------------------
# 逐条规则见文件头 .DESCRIPTION；每条对应一个实测的 Value 节点 CLR 类型。
$InterposerSource = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Media;
using System.Xaml;

// 注意：不能 using System.Windows.Markup —— 它和 System.Xaml 都有 XamlReader，
// 会报「不明确的引用」。MarkupExtension / StaticExtension 一律写全名。

public class BamlValueStringifier : System.Xaml.XamlReader
{
    // 一个待发节点。包装器自己排节点，才能把 _PositionalParameters 改写成真实属性。
    private struct Node
    {
        public XamlNodeType Kind;
        public XamlMember Member;
        public XamlType Type;
        public object Value;
        public NamespaceDeclaration Namespace;
    }

    private readonly XamlReader _inner;
    private readonly Queue<Node> _queue = new Queue<Node>();
    private Node _cur;
    private XamlMember _member;
    private readonly Stack<XamlType> _typeStack = new Stack<XamlType>();
    // 命名空间作用域栈：XamlXmlWriter 对「同一作用域重复声明同前缀」会直接抛
    // XamlXmlWriterException（实测 3 个文件栽在这）。这里把重复声明吞掉。
    private readonly List<Dictionary<string, string>> _nsScopes = new List<Dictionary<string, string>>();
    public static int NamespaceDedupes;

    public static readonly List<string> Warnings = new List<string>();
    public static int PositionalRewrites;

    public BamlValueStringifier(XamlReader inner)
    {
        _inner = inner;
        _nsScopes.Add(new Dictionary<string, string>(StringComparer.Ordinal));
    }

    // XamlXmlWriter 的报错是「命名空间 X 已具有一个在当前范围中定义的前缀」——
    // 它按 **命名空间 URI** 判重（同一个 URI 在本元素作用域里被声明了第二次就炸），
    // 所以这里以 URI 为键只在**当前元素作用域**内查重（跨元素重复声明是合法的）。
    private bool NamespaceAlreadyInCurrentScope(string ns)
    {
        return _nsScopes[_nsScopes.Count - 1].ContainsKey(ns);
    }

    public override XamlNodeType NodeType { get { return _cur.Kind; } }
    public override XamlMember Member { get { return _cur.Member; } }
    public override XamlType Type { get { return _cur.Type; } }
    public override object Value { get { return _cur.Value; } }
    public override NamespaceDeclaration Namespace { get { return _cur.Namespace; } }
    public override XamlSchemaContext SchemaContext { get { return _inner != null ? _inner.SchemaContext : null; } }
    public override bool IsEof { get { return _inner != null && _inner.IsEof && _queue.Count == 0; } }

    private void EnqueueSimple(XamlNodeType kind, XamlMember m, object v)
    {
        Node n = new Node();
        n.Kind = kind; n.Member = m; n.Value = v;
        _queue.Enqueue(n);
    }

    public override bool Read()
    {
        if (_queue.Count > 0) { _cur = _queue.Dequeue(); return true; }

        while (true)
        {
            if (!_inner.Read()) { _cur = new Node(); return false; }

            XamlNodeType kind = _inner.NodeType;
            XamlMember m = null;

            if (kind == XamlNodeType.StartObject)
            {
                _typeStack.Push(_inner.Type);
                _nsScopes.Add(new Dictionary<string, string>(StringComparer.Ordinal));
                _cur = Make(_inner);
                return true;
            }
            if (kind == XamlNodeType.EndObject)
            {
                if (_typeStack.Count > 0) _typeStack.Pop();
                if (_nsScopes.Count > 1) _nsScopes.RemoveAt(_nsScopes.Count - 1);
                _cur = Make(_inner);
                return true;
            }
            if (kind == XamlNodeType.NamespaceDeclaration)
            {
                NamespaceDeclaration nd = _inner.Namespace;
                string prefix = nd.Prefix ?? string.Empty;
                if (NamespaceAlreadyInCurrentScope(nd.Namespace))
                {
                    NamespaceDedupes++;
                    continue;   // 当前作用域已声明过这个命名空间，丢掉重复声明
                }
                _nsScopes[_nsScopes.Count - 1][nd.Namespace] = prefix;
                _cur = Make(_inner);
                return true;
            }
            if (kind == XamlNodeType.StartMember)
            {
                m = _inner.Member;
                if (m != null && m.Name == "_PositionalParameters")
                {
                    // 读 ahead：Value [EndMember]
                    object raw = null; bool haveValue = false;
                    if (_inner.Read() && _inner.NodeType == XamlNodeType.Value)
                    {
                        raw = _inner.Value; haveValue = true;
                        _inner.Read();  // 吃掉 EndMember
                    }
                    XamlType owner = _typeStack.Count > 0 ? _typeStack.Peek() : null;
                    XamlMember target = MapPositional(owner);
                    if (haveValue && target != null)
                    {
                        // 语义等价改写：{Binding Foo} 的 Foo 其实是 Path="Foo"
                        PositionalRewrites++;
                        _member = target;
                        EnqueueSimple(XamlNodeType.StartMember, target, null);
                        EnqueueSimple(XamlNodeType.Value, null, StringifyFor(raw, target));
                        EnqueueSimple(XamlNodeType.EndMember, null, null);
                        _cur = _queue.Dequeue();
                        return true;
                    }
                    Warnings.Add("_PositionalParameters 无法映射成员");
                    _member = m;
                    EnqueueSimple(XamlNodeType.StartMember, m, null);
                    if (haveValue) EnqueueSimple(XamlNodeType.Value, null, StringifyFor(raw, m));
                    EnqueueSimple(XamlNodeType.EndMember, null, null);
                    _cur = _queue.Dequeue();
                    return true;
                }
                _member = m;
                _cur = Make(_inner);
                return true;
            }
            if (kind == XamlNodeType.Value)
            {
                _cur = Make(_inner);
                _cur.Value = StringifyFor(_inner.Value, _member);
                return true;
            }
            _cur = Make(_inner);
            return true;
        }
    }

    private static Node Make(XamlReader r)
    {
        Node n = new Node();
        n.Kind = r.NodeType;
        n.Member = r.Member;
        n.Type = r.Type;
        n.Value = r.Value;
        n.Namespace = r.Namespace;
        return n;
    }

    // 把 _PositionalParameters 映射回真实属性：
    //   1) 类型声明了 ContentProperty -> 用它
    //   2) 单实参构造函数 -> 用「形参名 == 属性名」(忽略大小写) 找属性
    // 实测命中：Binding(string path) -> Binding.Path
    private static XamlMember MapPositional(XamlType owner)
    {
        if (owner == null) return null;
        if (owner.ContentProperty != null) return owner.ContentProperty;
        Type ut = owner.UnderlyingType;
        if (ut == null) return null;
        try
        {
            foreach (ConstructorInfo c in ut.GetConstructors())
            {
                ParameterInfo[] ps = c.GetParameters();
                if (ps.Length != 1 || ps[0].Name == null) continue;
                foreach (XamlMember xm in owner.GetAllMembers())
                {
                    if (xm == null || xm.IsAttachable || xm.IsDirective) continue;
                    if (string.Equals(xm.Name, ps[0].Name, StringComparison.OrdinalIgnoreCase)) return xm;
                }
            }
        }
        catch { }
        return null;
    }

    private static string Conv(TypeConverter conv, object v)
    {
        if (conv == null || v == null) return null;
        try
        {
            if (!conv.CanConvertTo(typeof(string))) return null;
            return conv.ConvertToString(null, CultureInfo.InvariantCulture, v);
        }
        catch { return null; }
    }

    // 把原始值转成字符串。
    // 关键：必须先让 Stringify() 自己按 CLR 类型分派（尤其 TypeConverterMarkupExtension
    // 要先拆出里面的 _value），**不能**先拿成员的类型转换器去转原始对象 ——
    // 那样 Height 会得到 "System.Windows.Baml2006.TypeConverterMarkupExtension"
    // 而不是 780。成员级转换器只在 Stringify 的兜底分支里对纯量值使用。
    private static string StringifyFor(object v, XamlMember target)
    {
        if (v == null) return null;
        if (v is string) return (string)v;
        BamlValueStringifier probe = new BamlValueStringifier(null);
        probe._member = target;
        return probe.Stringify(v, 0);
    }

    private static object Field(object o, string name)
    {
        if (o == null) return null;
        FieldInfo f = o.GetType().GetField(name,
            BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);
        if (f == null) return null;
        try { return f.GetValue(o); } catch { return null; }
    }

    // 契约：永远返回 string 或 null —— XamlXmlWriter 只接受这两种。
    private string Stringify(object v, int depth)
    {
        if (v == null) return null;
        if (v is string) return (string)v;
        if (depth > 4) return SafeToString(v);

        Type t = v.GetType();
        string tn = t.FullName;

        // 557 个：成员声明类型是 System.Type，直接放行会撞 writer
        if (v is Type) return "{x:Type " + ((Type)v).FullName + "}";

        // 1263 个：Setter.Property / Trigger.Property / Condition.Property
        if (v is DependencyProperty)
        {
            DependencyProperty dp = (DependencyProperty)v;
            return "{x:Static " + dp.OwnerType.FullName + "." + dp.Name + "}";
        }

        // 23579 个：BAML 内部把「(TypeConverter, 原始值)」打成一对
        if (tn == "System.Windows.Baml2006.TypeConverterMarkupExtension")
        {
            object raw = Field(v, "_value");
            TypeConverter conv = Field(v, "_converter") as TypeConverter;
            string s = Conv(conv, raw);
            if (s != null) return s;
            if (raw != null) return Stringify(raw, depth + 1);
            return string.Empty;
        }

        // 202 个：{x:Static 类型.成员}
        if (v is System.Windows.Markup.StaticExtension)
        {
            System.Windows.Markup.StaticExtension se = (System.Windows.Markup.StaticExtension)v;
            string m = se.Member ?? string.Empty;
            if (se.MemberType != null) return "{x:Static " + se.MemberType.FullName + "." + m + "}";
            return "{x:Static " + m + "}";
        }
        // 4177 / 3715 个：资源引用
        if (v is StaticResourceExtension)
            return "{StaticResource " + ((StaticResourceExtension)v).ResourceKey + "}";
        if (v is DynamicResourceExtension)
            return "{DynamicResource " + ((DynamicResourceExtension)v).ResourceKey + "}";

        // 1183 个：BAML 延迟反序列化的二进制块（绝大多数是 Brush 序列化体）。
        // ProvideValue(null) 能解出 SolidColorBrush 等，解出即得 "#AARRGGBB"。
        if (tn == "System.Windows.Baml2006.DeferredBinaryDeserializerExtension")
        {
            try
            {
                object real = ((System.Windows.Markup.MarkupExtension)v).ProvideValue(null);
                if (real != null && !ReferenceEquals(real, v))
                {
                    string s = Stringify(real, depth + 1);
                    if (!string.IsNullOrEmpty(s)) return s;
                }
            }
            catch { }
            object blob = Field(v, "_data");
            long n = (blob is byte[]) ? ((byte[])blob).LongLength : 0;
            Warnings.Add("DeferredBinary(" + n + "B) 未解码");
            return "@@TT-DEFERRED-BINARY:" + n + "@@";
        }

        if (v is System.Windows.Markup.MarkupExtension)
        {
            try
            {
                object real = ((System.Windows.Markup.MarkupExtension)v).ProvideValue(null);
                if (real != null && !(real is System.Windows.Markup.MarkupExtension) && !ReferenceEquals(real, v))
                {
                    string s = Stringify(real, depth + 1);
                    if (!string.IsNullOrEmpty(s)) return s;
                }
            }
            catch { }
            Warnings.Add("MarkupExtension " + t.Name + " 未展开");
            return "{" + t.Name + "}";
        }

        if (v is Int32Collection)
        {
            List<string> parts = new List<string>();
            foreach (int i in (Int32Collection)v) parts.Add(i.ToString(CultureInfo.InvariantCulture));
            return string.Join(",", parts.ToArray());
        }

        // 416 / 269 个：BAML 内联二进制块与内联节点块，没有文本等价物。
        // 不猜内容，只留占位符（带字节数），落盘时替换成 XML 注释。
        if (v is Stream)
        {
            long len = 0;
            try { len = ((Stream)v).Length; } catch { }
            Warnings.Add("Stream(" + len + "B) 未解码");
            return "@@TT-DEFERRED-STREAM:" + len + "@@";
        }
        if (tn == "System.Xaml.XamlNodeList")
        {
            Warnings.Add("XamlNodeList 未展开");
            return "@@TT-DEFERRED-NODELIST@@";
        }

        // 常规装箱值：优先「成员声明类型」的转换器（保证 12.5 不会变 12,5），
        // 再退「值自身类型」的转换器，最后 InvariantCulture ToString。
        string res = null;
        if (_member != null && _member.Type != null && _member.Type.TypeConverter != null)
            res = Conv(_member.Type.TypeConverter.ConverterInstance, v);
        if (res == null) res = Conv(TypeDescriptor.GetConverter(t), v);
        if (res != null) return res;
        return SafeToString(v);
    }

    private static string SafeToString(object v)
    {
        try { return Convert.ToString(v, CultureInfo.InvariantCulture); }
        catch { return v.GetType().Name; }
    }
}
'@
Add-Type -TypeDefinition $InterposerSource -ReferencedAssemblies @(
    'System.Xaml', 'System.ComponentModel.TypeConverter', 'WindowsBase',
    'PresentationCore', 'PresentationFramework', 'System.Xml', 'System.IO'
) -ErrorAction Stop
Write-Output "[2/9] BamlValueStringifier 已编译"

# --- 步骤 3：注册程序集解析 --------------------------------------------------------
# 自定义控件类型分布在安装目录 60+ 个 dll 里；不注册会报「未能加载程序集 TickTick」。
$Resolver = {
    param($sender, $eventArgs)
    $simpleName = (New-Object System.Reflection.AssemblyName($eventArgs.Name)).Name
    foreach ($ext in @('.dll', '.exe')) {
        $candidate = Join-Path $InstallDir ($simpleName + $ext)
        if (Test-Path -LiteralPath $candidate) {
            return [System.Reflection.Assembly]::LoadFrom($candidate)
        }
    }
    return $null
}
[AppDomain]::CurrentDomain.add_AssemblyResolve($Resolver)

# --- 步骤 4：可选地建立 Application 上下文 ------------------------------------------
if (-not $NoApplication) {
    try {
        $script:WpfApp = New-Object System.Windows.Application
        Write-Output "[3/9] WPF Application 上下文已建立"
    } catch {
        Write-Output "[3/9] Application 建立失败（继续）：$($_.Exception.Message)"
    }
} else {
    Write-Output "[3/9] 按 -NoApplication 跳过 Application 上下文"
}

# --- 步骤 5：打开内嵌资源 -----------------------------------------------------------
$ExePath = Join-Path $InstallDir 'TickTick.exe'
if (-not (Test-Path -LiteralPath $ExePath)) { throw "找不到 $ExePath" }
$Assembly = [System.Reflection.Assembly]::LoadFrom($ExePath)
$ResourceStream = $Assembly.GetManifestResourceStream($ResourceName)
if ($null -eq $ResourceStream) { throw "找不到托管资源 $ResourceName" }
$ResourceSet = New-Object System.Resources.ResourceSet($ResourceStream)
Write-Output "[4/9] $ResourceName 已打开：$($ResourceStream.Length) 字节"

# --- 步骤 6：枚举 .baml 条目 --------------------------------------------------------
# .baml 在 ResourceSet 里是 UnmanagedMemoryStream；其余 657 个条目是字符串表/
# 图片/xshd 语法定义，本脚本不处理。
$BamlEntries = [ordered]@{}
foreach ($entry in $ResourceSet) {
    if ($entry.Key -like '*.baml') { $BamlEntries[$entry.Key] = $entry.Value }
}
Write-Output "[5/9] 发现 $($BamlEntries.Count) 个 .baml"

$Keys = @($BamlEntries.Keys | Sort-Object)
if ($Only) {
    $Keys = @($Keys | Where-Object { $k = $_; ($Only | Where-Object { $k -like $_ }).Count -gt 0 })
    Write-Output "      按 -Only 过滤后 $($Keys.Count) 个"
}

# --- 步骤 7：-Survey 分支 -----------------------------------------------------------
if ($Survey) {
    Write-Output "[6/9] -Survey：统计 Value 节点 CLR 类型"
    $TypeCounts = @{}
    $ReadFails = @()
    foreach ($key in $Keys) {
        $stream = $BamlEntries[$key]; $stream.Position = 0
        $mem = New-Object System.IO.MemoryStream
        $stream.CopyTo($mem); $mem.Position = 0
        try {
            $reader = New-Object System.Windows.Baml2006.Baml2006Reader($mem)
            while ($reader.Read()) {
                if ($reader.NodeType.ToString() -eq 'Value') {
                    $val = $reader.Value
                    if ($null -ne $val) {
                        $n = $val.GetType().FullName
                        if ($TypeCounts.ContainsKey($n)) { $TypeCounts[$n]++ } else { $TypeCounts[$n] = 1 }
                    }
                }
            }
        } catch {
            $e = $_.Exception.InnerException
            $ReadFails += ("$key`t$($e.GetType().FullName)`t$($e.Message)")
        } finally { $mem.Dispose() }
    }
    foreach ($n in ($TypeCounts.Keys | Sort-Object)) {
        Write-Output ("VTYPE`t{0}`t{1}" -f $n, $TypeCounts[$n])
    }
    Write-Output ("READ_FAILS`t" + $ReadFails.Count)
    $ReadFails | ForEach-Object { Write-Output ("READFAIL`t" + $_) }
    if ($script:WpfApp) { $script:WpfApp.Shutdown() }
    return
}

# --- 步骤 8：批量转换 ---------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
# 幂等：只清本脚本自己的产物
Get-ChildItem -LiteralPath $OutDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in '.xaml', '.tsv', '.raw' } |
    Remove-Item -Force -ErrorAction SilentlyContinue

$Manifest   = New-Object System.Collections.Generic.List[string]
$Failures   = New-Object System.Collections.Generic.List[string]
$FailedKeys = New-Object System.Collections.Generic.List[string]
[BamlValueStringifier]::PositionalRewrites = 0
$i = 0
foreach ($key in $Keys) {
    $i++
    $stream = $BamlEntries[$key]; $stream.Position = 0
    $mem = New-Object System.IO.MemoryStream
    $stream.CopyTo($mem)          # 拷一份：ResourceSet 的流重复 Seek 不可靠
    $bamlBytes = $mem.Length
    $mem.Position = 0

    $rel    = [System.IO.Path]::ChangeExtension($key, '.xaml')
    $dst    = Join-Path $OutDir $rel
    $dstDir = Split-Path -Parent $dst
    if (-not (Test-Path -LiteralPath $dstDir)) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }

    [BamlValueStringifier]::Warnings.Clear()
    try {
        # 8a. BAML -> 节点流（Baml2006Reader 是唯一权威解码器）
        $reader = New-Object System.Windows.Baml2006.Baml2006Reader($mem)
        # 8b. 节点流 -> 字符串化 + 位置参数改写
        $wrap = New-Object BamlValueStringifier($reader)
        # 8c. 节点流 -> XAML，schema context 沿用 reader 的（含 WPF 内建类型映射）
        $sw = New-Object System.IO.StringWriter
        $xw = New-Object System.Xaml.XamlXmlWriter($sw, $reader.SchemaContext)
        [System.Xaml.XamlServices]::Transform($wrap, $xw)
        $xw.Close()
        $xml = $sw.ToString()

        # 8d. 内部占位符 -> XML 注释（合法、不伪装成可用值、字节数仍可复现）
        $evaluator = [System.Text.RegularExpressions.MatchEvaluator] {
            param($m)
            "<!--deferred-$($m.Groups[1].Value.ToLower()):$($m.Groups[2].Value)B-->"
        }
        $xml = [regex]::Replace($xml, '@@TT-DEFERRED-(BINARY|STREAM):(\d+)@@', $evaluator)
        $xml = $xml.Replace('@@TT-DEFERRED-NODELIST@@', '<!--deferred-nodelist-->')

        # 8e. 落盘：UTF-8 无 BOM
        [System.IO.File]::WriteAllText($dst, $xml, (New-Object System.Text.UTF8Encoding($false)))
        $Manifest.Add(("{0}`tOK`t{1}`t{2}`t{3}" -f $key, $bamlBytes, [System.Text.Encoding]::UTF8.GetByteCount($xml), $rel))
        if ($i % 100 -eq 0) { Write-Output "      已处理 $i / $($Keys.Count)" }
    } catch {
        # 失败必须留痕：原始 BAML 字节 + 完整异常链，不许静默跳过
        $inner = $_.Exception
        if ($inner.InnerException) { $inner = $inner.InnerException }
        $chain = @(); $cursor = $inner
        while ($cursor -and $chain.Count -lt 5) {
            $chain += ($cursor.GetType().FullName + ': ' + $cursor.Message)
            $cursor = $cursor.InnerException
        }
        $reason = ($chain -join ' <- ') -replace "`t", ' '
        $FailedKeys.Add($key)
        $Failures.Add(("{0}`t{1}`t{2}" -f $key, $inner.GetType().FullName, $reason))
        # 保留原始 BAML，方便换环境/换工具复现
        $rawDst = Join-Path $OutDir ([System.IO.Path]::ChangeExtension($key, '.baml.raw'))
        $rawDir = Split-Path -Parent $rawDst
        if (-not (Test-Path -LiteralPath $rawDir)) { New-Item -ItemType Directory -Force -Path $rawDir | Out-Null }
        [System.IO.File]::WriteAllBytes($rawDst, $mem.ToArray())
        $Manifest.Add(("{0}`tFAIL`t{1}`t0`t{2}" -f $key, $bamlBytes, $inner.GetType().Name))
        Write-Output "      FAIL $key :: $($inner.GetType().Name): $($inner.Message)"
    } finally { $mem.Dispose() }
}

# --- 步骤 9：写清单与失败表 ---------------------------------------------------------
$ManifestPath = Join-Path $OutDir 'convert-manifest.tsv'
[System.IO.File]::WriteAllLines($ManifestPath,
    (@("baml`tstatus`tbaml_bytes`txaml_bytes`txaml_relpath") + $Manifest),
    (New-Object System.Text.UTF8Encoding($false)))

$FailPath = Join-Path $OutDir 'convert-failures.tsv'
[System.IO.File]::WriteAllLines($FailPath,
    (@("baml`texception`treason") + $Failures),
    (New-Object System.Text.UTF8Encoding($false)))

$okCount = $Manifest.Count - $Failures.Count
Write-Output "[9/9] 完成 OK=$okCount FAIL=$($Failures.Count) TOTAL=$($Keys.Count) POSITIONAL_REWRITES=$([BamlValueStringifier]::PositionalRewrites) NS_DEDUPES=$([BamlValueStringifier]::NamespaceDedupes)"
Write-Output "      XAML:   $OutDir"
Write-Output "      清单:   $ManifestPath"
Write-Output "      失败表: $FailPath"
foreach ($k in $FailedKeys) { Write-Output "      FAILED: $k" }

if ($script:WpfApp) { $script:WpfApp.Shutdown() }
