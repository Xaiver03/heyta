#!/usr/bin/env node
/**
 * 门禁：**Windows 那一半（WinUI / XAML）在任意 OS 上能判红到什么程度**。
 * ==================================================================
 *
 * ## 为什么需要它
 *
 * `apps/desktop-windows/HeytaWindows` 是 WinUI 3 工程，历史上只能在 Windows 上验。
 * 2026-10-25 用一次性探针（放在 `/tmp`）把它编过一次，当场抓到三个**在 Windows 上会直接
 * 编译失败**的 bug：
 *
 *   1. `Windows.Graphics.SizeInt32` 被解析成 `Heyta.Windows.Graphics`
 *      （文件里有 `using Heyta.Windows.Host;`）⇒ CS0234；
 *   2. `KeyboardAccelerator` 在 `Microsoft.UI.Xaml.Input`，文件没 import ⇒ CS0246；
 *   3. `<KeyboardAccelerator Key=",">` —— `Windows.System.VirtualKey` 里**没有逗号成员**
 *      （连 `Oem*` 都没有），XAML 只收枚举名 ⇒ XAML 编译失败。
 *
 * 那一次是 `/tmp` 里的手写探针：**它会消失，而且替身字段是手抄的**（11 个 `x:Name`，
 * 多一个少一个没人知道）。本文件 + `apps/desktop-windows/xaml-probe/` 把那一趟变成
 * 仓库里能反复跑的东西：
 *
 *   · `compile/`：把**仓库里的真实 C#** 拉进一个 `net10.0-windows` 工程编一遍。
 *     XAML 编译器（Windows 二进制）跑不了，所以替身掉它本该生成的两样东西 ——
 *     而那份替身由 `tool` 从真实 `.xaml` **机械生成**，不是抄件。
 *   · `tool validate`：拿 WinUI 自己的元数据逐条核对 XAML 里的名字：元素类型、属性、
 *     事件、附加属性、枚举成员、`x:Bind` 路径、资源键、code-behind 里的处理器。
 *
 * ## 边界（别把这里的绿读成"壳能用"）
 *
 * 🔴 它**不是** XAML 编译器。样式键解析优先级、模板合法性、`x:Bind` 的类型转换、
 *    控件树在运行时的行为，仍只有 Windows 上的 XamlCompiler + 一次真启动能回答。
 *    这一层保证的是：**名字与成员层面写不出前面那三个 bug**。
 *
 * ⚠️ 机器上没有 `dotnet` 时**显式报告"已跳过"并 exit 0**（与 `check:windows-shell` 同一条规矩），
 *    绝不让"没验过"长得像"验过了"。CI 的 ubuntu runner 就是这种情况，所以
 *    `.github/workflows/ci.yml` 里另有一条步骤把这件事说出来。
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = join(ROOT, 'apps/desktop-windows/xaml-probe');
const TOOL_PROJECT = join(PROBE, 'tool/Heyta.XamlProbe.csproj');
const TOOL_DLL = join(PROBE, 'tool/bin/Release/net10.0/Heyta.XamlProbe.dll');
const COMPILE_PROJECT = join(PROBE, 'compile/WinUiCompileProbe.csproj');
const COMPILE_DIR = join(PROBE, 'compile');
const XAML_DIR = join(ROOT, 'apps/desktop-windows/HeytaWindows');
const STUBS = join(COMPILE_DIR, 'obj/generated/XamlStubs.g.cs');
const TOKENS = join(ROOT, 'packages/design-system/generated/HeytaTokens.xaml');

const hasDotnet = () => {
  const probe = spawnSync('dotnet', ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
};

if (!hasDotnet()) {
  console.log('⚠️  未找到 `dotnet` —— WinUI / XAML 这一层**已跳过**。');
  console.log('    ⇒ 这一轮**没有**证明"XAML 里的名字在 Windows 上都能编过"，不要读成壳已经验过。');
  process.exit(0);
}

process.env.DOTNET_CLI_TELEMETRY_OPTOUT ??= '1';
process.env.DOTNET_NOLOGO ??= '1';

if (!existsSync(TOKENS)) {
  console.error(`❌ 缺少设计 token 生成物：${TOKENS}`);
  console.error('   先跑 token 生成（见 packages/design-system/README.md），否则资源键判据没有比对基准。');
  process.exit(1);
}

/**
 * 跑一条 dotnet 命令。**继承 stdio**：失败时人要看得到是哪一行红。
 * `-p:NuGetAudit=false` 不是为了好看 —— 包漏洞审计会去连 nuget.org 并写用户级 http-cache，
 * 在受限环境里那会变成一串 NU1900 警告噪音，把真正的编译错误挤下去。
 */
const dotnet = (args, label) => {
  console.log(`\n── ${label}`);
  const result = spawnSync('dotnet', args, {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
  });

  if (result.error) {
    console.error(`❌ 没能启动 dotnet：${result.error.message}`);
    process.exit(1);
  }

  return result.status ?? 1;
};

const run = (args) => {
  const result = spawnSync('dotnet', args, { stdio: 'inherit', cwd: ROOT });
  if (result.error) {
    console.error(`❌ 没能启动 dotnet：${result.error.message}`);
    process.exit(1);
  }

  return result.status ?? 1;
};

// ① 工具本体（net10.0，零 PackageReference —— 元数据用 .NET 自带的 System.Reflection.Metadata）
if (
  dotnet(
    ['build', TOOL_PROJECT, '-c', 'Release', '-v', 'quiet', '--nologo', '-p:NuGetAudit=false'],
    '构建 XAML 探针工具',
  ) !== 0
) {
  console.error('❌ 探针工具本身编不过 —— 这是探针坏了，不是被验代码坏了。');
  process.exit(1);
}

// ② 让 compile 工程把它**真的看到的**引用落盘（供元数据探针当输入）。
//    只跑到 ResolveAssemblyReferences：这一步不需要编译，所以可以在替身还不存在时跑。
if (
  dotnet(
    [
      'build',
      COMPILE_PROJECT,
      '-t:ResolveAssemblyReferences',
      '-v',
      'quiet',
      '--nologo',
      '-p:NuGetAudit=false',
    ],
    '解析 WinUI 引用（还原 + 目标解析）',
  ) !== 0
) {
  console.error('❌ WinUI 引用解析失败 —— 看上面的还原错误（网络 / 包版本）。');
  process.exit(1);
}

// ③ 从真实 .xaml 生成 XAML 编译器本该生成的那两样（x:Name 字段 + InitializeComponent）
{
  const emit = run([
    'exec',
    TOOL_DLL,
    'emit-stubs',
    '--xaml-dir',
    XAML_DIR,
    '--compile-dir',
    COMPILE_DIR,
    '--out',
    STUBS,
  ]);

  if (emit !== 0) {
    console.error('❌ XAML 替身生成失败（x:Name 与 code-behind 冲突 / 标签在元数据里找不到类型）。');
    process.exit(1);
  }
}

// ④ 编译**仓库里的真实 C#**：命名空间被 using 抢走、控件没有那个成员、缺 import —— 全在这里现形
if (
  dotnet(
    ['build', COMPILE_PROJECT, '-c', 'Debug', '-v', 'quiet', '--nologo', '-p:NuGetAudit=false'],
    '编译真实 C#（WinUI API 面）',
  ) !== 0
) {
  console.error('');
  console.error('❌ WinUI 那一半的 C# 编不过。这是**真故障**：在 Windows 上同样编不过。');
  console.error('   （XAML 编译器本身没跑 —— 这里验的是 C# 与 WinUI API 面对不对得上。）');
  process.exit(1);
}

// ⑤ 元数据核对：XAML 里的每个名字是否真的存在
console.log('\n── 核对 XAML 里的元素 / 属性 / 事件 / 枚举成员 / 绑定路径 / 资源键');
const validate = run([
  'exec',
  TOOL_DLL,
  'validate',
  '--xaml-dir',
  XAML_DIR,
  '--compile-dir',
  COMPILE_DIR,
  '--tokens',
  TOKENS,
  ...(process.env.HEYTA_XAML_VERBOSE === '1' ? ['--verbose'] : []),
]);

console.log('');
console.log('✅ WinUI 那一半：真实 C# 编过，XAML 里的名字全部在元数据里对得上。');
console.log('   ⚠️ 边界照旧：样式键解析优先级 / 模板合法性 / x:Bind 的类型转换 / 控件树运行时行为，');
console.log('      仍只有 Windows 上的 XamlCompiler + 一次真启动能回答。这条门禁不替那一步签名。');
process.exit(validate);
