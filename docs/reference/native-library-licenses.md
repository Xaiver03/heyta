# 原生系统库许可登记册

> 这份表登记的是 **heyta 的原生壳在编译期/运行期链接的"非 npm 依赖"** —— 系统库与平台运行时。
> 它存在的理由是一条实测出来的空洞：`research/tools/license-inventory.mjs` 扫的是**实际安装的
> npm/NuGet 依赖树**，而 `apps/desktop-linux` 的 `Makefile:14` 链的是 `pkg-config` 找到的系统库，
> `.deb` 的 `Depends` 写的是发行版包名（`apps/desktop-linux/scripts/package-deb.sh:111`）。
> ⇒ **这些库从来不在任何一张登记表上**，而它们已经随 `.deb` 发出去了。
>
> 🔴 「门禁绿 ≠ 登记全」是本仓库反复吃亏的同一类失效（见 `license-inventory.mjs` 文件头
> 那段"漏掉整棵 React Native 子树 315 → 908"的记录）。这份表就是补那一格的。
>
> 消费者（判据）：`research/tools/check-native-lib-registry.mjs`，由 `pnpm check:linux-shell` 调用
> —— 放在这枚门禁里是因为它**每个平台都要跑**（`check:linux-shell` 的其余三步在非 Linux 上会跳过，
> 而这一条不能跳；一条只在某台机上执行的登记对账，就是一枚可以永久不执行的判据）。

## 判据（对账器逐条钉住，缺一即红）

1. `.deb` 的 `Depends` 里每一枚运行时包，这张表**必须有一行**；
2. 这张表里每一行**必须仍然在 `Depends` 里** —— 表只能跟着现实变小，不许攒旧账
   （与 `check-image-license-coverage.mjs` 的 `IMAGE_ONLY_PACKAGES` 同一条设计）；
3. 锚点文件（`package-deb.sh`、本文件）取不到 ⇒ **响亮失败**，不许"读到空集然后报通过"；
4. 每行必须带**实测出处**（版本 + 许可原文从哪读来）与一句**为什么可以接受**；
5. 🔴 「许可」那一格**必须以许可标识符开头**（`public-domain` / `MIT*` / `BSD*` / `Apache-2.0*` / `LGPL-2.1+`），
   对账器只取**开头那一个**标识符分类，**散文里提到的别的许可不作数**；取不到标识符、或落到这几类之外
   （GPL-only、AGPL、SSPL…）⇒ 红。⚠️ 这条是今天改的：原来写的是"整格里 `includes` 任一宽松名"，
   而这张表现在要逐字抄发行版 copyright 的聚合写法（GTK4 那一格里同时出现 Apache-2.0 与 BSD-3-clause-Google），
   旧写法下**一枚 GPL-only 的库会因为散文里提到 BSD 而被判绿** —— 由自检 A6 当场证出来，
   A6/A7 两臂分别钉"开头是 copyleft"与"根本没有标识符"这两头。

> 🔴 **06 15:5x 一处实测更正（登记错了一枚的许可）**：`libjavascriptcoregtk-4.1-0` 我原先登记成
> `LGPL-2.1-or-later`，**发行版那份写的是 `Files: * → BSD-2-clause`**（并带一句"The default license of
> WebKit is BSD 2-clause"）。
> 方向上这是**低估了宽松**、不是放宽了禁令，所以裁决没变；但 ADR-0057 真正的对象因此收窄成
> **只有 GTK4 一枚的默认许可**（下表那一行是唯一一枚 `Files: *` 就是 LGPL 的；至于"包里有没有 copyleft 片段"，
> 见下面那条更正在 07 03:0x 把它拆成两个问题）。上游把自己讲成 LGPL-2.1+ 那句差
> 也留在表里，别让"按发行版那份登记"变成没人看过的决定。
>
> 🔴 **07 03:0x 又更正一处，而且这次是我自己写进去的假话**：上一段（以及原表那一行）跟着写了例外块里的
> LGPL/GPL **"全部是『或』形态的多许可，没有一枚是 GPL-only"**。按段落的分隔符重新现量（37 个 `Files:` 段，
> 逐段取 `Files:` + `License:`）⇒ **15 段带 GPL/LGPL，其中 6 段是"或"形态、9 段是纯 copyleft**，逐条是：
> `Source/JavaScriptCore/API/JSAPIValueWrapper.cpp`（LGPL-2+）、`Source/WTF/wtf/text/Base64.cpp` 与一段
> WebCore 表格布局文件（LGPL-2）、`CryptoAlgorithmX25519*.cpp`（LGPL-2.1+）、`FTPDirectoryParser`（LGPL-2.1）、
> `RenderLayerInlines.h` + `WebKit/UIProcess/API/glib/*.cpp`（LGPL-2.1+）、`XPathGrammar.{cpp,h}`（GPL-2+ with Bison exception）、
> ANGLE 的 `preprocessor_tab_autogen.cpp`（GPL-3+ with Bison exception）与 `tools/flex-bison/third_party/skeletons/*`（GPL-3+）、
> 以及 `debian/*`（LGPL-2+，那是 Debian 的打包脚本不是库代码）。
> ⚠️ **裁决不变，但理由必须换个说法**：这一格填的是**整包的默认许可**（`Files: *`），而对 heyta 来说这九段
> 的存在**不构成 §3.2 的问题** —— 靠的不是"它们不存在"，是 ADR-0057 那四条线（不拷贝源码进仓库、不改上游、
> 不静态链、由发行版携带并展示）。把它写成"没有一枚是 GPL-only"之所以危险，是因为那句话**把裁决的地基
> 放在了唯一一个不成立的事实上**：真去数一遍就翻车，而翻车的时候没人会数。
> 🔴 一处探针的边界，别把它读成"证伪了"：`nm -D --defined-only` 在 `libjavascriptcoregtk-6.0.so.1` 里
> 命中 `JSAPIValueWrapper` 1 处、`Base64` 11 处，在 `libwebkitgtk-6.0.so.4` 里对上述**所有**模式命中 0 处 ——
> 而后者是 93 MB 的实体（`ls -l` 现量），所以那 0 是**导出可见性**的性质，**不是"WebCore 那些文件不在里面"的证据**。
> 想判"某段代码进没进这枚 `.so`"得换手段（按归档成员/调试符号查），本表不判这件事，因为它不需要：
> 无论进没进，我们都不分发那枚 `.so`。

## 为什么"系统运行时库的动态链接"是一类，而不是 §3.2 的破例

[ADR-0057](../adr/0057-native-system-library-linking.md) 给的判定线（本表的准入依据）：

- **不进产物**：`.deb` 里不许出现这些库的 `.so`，只出现包名依赖；
- **不改上游**：不 fork、不打补丁、不拷贝其源码进仓库（vendored 的代码要按 §3.2 原样过门）；
- **不静态链**：链的是发行版提供的动态库，用户换掉它就能换掉实现；
- **随发行版走**：由包管理器安装与升级，许可与版权说明由发行版携带并展示。

这四条同时成立时，被约束的对象是**操作系统提供的一份运行时**，不是我们分发的代码 ——
与 macOS 壳用系统自带的 WebKit/JavaScriptCore、Windows 壳用系统自带的 WebView2
（后者在 `license-policy.mjs` 的 `REVIEWED_LICENSE_FILE_PACKAGES` 里已有逐条登记）**是同一件事**。
本仓在 Linux 上早已按这条实践走（GTK4 / JavaScriptCoreGTK 已随 `.deb` 发出去），
这份表做的是**把已经生效的实践补成有出处的登记**，并让它能被对账 —— 不是新给出一个许可口子。

🔴 **待办（要产品负责人明确要求才动）**：AGENTS.md §3.2 那张许可表的措辞读起来像
"任何 LGPL 都不行"，与本节判定的范围不一致。要么把 §3.2 补一句"系统运行时的动态链接见 ADR-0057"，
要么改这份登记册的立场 —— **二者只能选一个，且不能两份都按自己的读法漂着**。

## 表

| 运行时包名 | 我们用它做什么 | 实测版本 | 许可（实测出处） | 为什么可以接受 |
|---|---|---|---|---|
| libgtk-4-1 | Linux 壳的窗口与控件（`src/main.c`） | 4.14.5（`dpkg-query` 现量是 `4.14.5+ds-0ubuntu0.10`，2026-10-06，Ubuntu 24.04.5） | **LGPL-2.1+**（该机 `/usr/share/doc/libgtk-4-1/copyright` 的 `Files: *` 逐字是 `LGPL-2+ and LGPL-2.1+ and sun-permissive and lcs-telegraphics-permissive and X11R5-permissive and Expat and BSD-3-clause-Google and Apache-2.0 and CC0-1.0 and ZPL-2.1` —— Debian 的聚合写法；整包共 6 个 `Files:` 块，其中 **GPL-3+ 只落在 `debian/tests/run-with-display` 那枚测试脚本上，不在库代码**） | 🔴 **本表里唯一一枚"默认许可就是 copyleft 那一类"的**（`Files: *` 整段是 LGPL 系），所以它才是 ADR-0057 四条判定线要过的对象：系统运行时库、动态链接、随发行版 Depends、不进产物、不改上游。⚠️ 别说成"本表唯一带 copyleft 的一枚" —— 下面三枚 webkitgtk 家族的例外块里也有 LGPL/GPL，见 07 03:0x 那条更正 |
| libjavascriptcoregtk-4.1-0 | JS 引擎宿主：跨语言那一层跑 `native-bridge.js`（`src/heyta_host.c`） | 2.52.6（`dpkg-query` 现量 `2.52.6-0ubuntu0.24.04.1`） | 🔴 **BSD-2-clause，不是我原先登记的 LGPL-2.1-or-later**：该机 copyright 的 `Files: *` 写 `License: BSD-2-clause`，并带一句 `The default license of WebKit is BSD 2-clause. The exceptions are listed in the sections that follow.`。⚠️ 例外块里**确实有纯 copyleft**（9 段，含 JavaScriptCore/WTF 里各一枚 LGPL-2+/LGPL-2）—— 我原先写的"全是『或』形态、没有一枚 GPL-only"是**假的**，逐段读数与这条更正见上面 07 03:0x 那段。⚠️ 与上游常识的差：WebKitGTK 项目自己把库讲成 LGPL-2.1+（JSC 讲成 BSD）⇒ 本表按**我们实际拿到的那份**（发行版随包携带的 copyright 的整包默认许可）登记，同时把这两句差留在这里，别让它变成"没人看过" | BSD 直接落在 §3.2 的允许面上 ⇒ **这一枚不需要 ADR-0057 的判定**，登记它只是为了让对账器覆盖全部 `Depends`；另：它与 macOS 自带的是同一引擎家族（`apps/desktop-linux/README.md` §1 的选型理由）。⚠️ 例外块里那 9 段 copyleft 的处置走 ADR-0057 四条线，不走"它不存在" |
| libjavascriptcoregtk-6.0-1 | WebView 那一代自带的 JSC —— `heyta-linux` 里**同时**链着 4.1 与 6.0 两代（4.1 给 `heyta_host.c` 跑门面，6.0 是 `webkitgtk-6.0.pc` 的 `Requires`，见 `src/heyta_web.c`）。soname 不同（`.so.0` / `.so.1`）⇒ 同进程共存，实测 `ldd` 两枚都在 | 2.52.6-0ubuntu0.24.04.1（`dpkg-query` 现量） | BSD-2-clause（与上面那枚**同源同文件**：`libwebkitgtk-6.0-4`、`libjavascriptcoregtk-6.0-1`、`libjavascriptcoregtk-4.1-0`、`libwebkit2gtk-4.1-0` 四枚二进制包的 `/usr/share/doc/*/copyright` md5 逐字相同 = `9dcdbfed3dbad891dfee94971e48b192`，同出源包 `webkitgtk` 2.52.6）⇒ 上面那次逐段现量（37 段 / 15 段带 GPL-LGPL / 9 段纯 copyleft）**一次覆盖本表这三枚** | 同一句理由：默认许可 BSD，落在 §3.2 允许面上，不需要 ADR-0057 的判定；登记它是为了让 `Depends` 全覆盖。⚠️ 它是 `libwebkitgtk-6.0-4` 的**精确版本硬 Depends**（`= 2.52.6-0ubuntu0.24.04.1`），所以我们依赖 webkit 就等于锁死了这一对的版本一致 |
| libwebkitgtk-6.0-4 | M2 的 WebView：原生壳里加载**与其他端同一个**共享 Web UI（`src/heyta_web.c` —— 自定义 scheme + `web_context` 注册 + 快照自截屏）。选型理由：GTK4 壳只能用 6.0 那一代；4.1 的头是 GTK3 的（`check:linux-shell` 装不上就是这一条） | 2.52.6-0ubuntu0.24.04.1（`dpkg-query` 现量；`libwebkitgtk-6.0.so.4 → .so.4.16.10`，`ls -l` 现量 93 MB ⇒ **引擎实体在这枚里**，不是薄壳） | BSD-2-clause（同上一行：与那三枚共享同一份 copyright；`Files: *` = BSD-2-clause，37 个例外段里 9 段纯 copyleft，逐段读数在上方 07 03:0x 那段） | 默认许可 BSD ⇒ 落在 §3.2 允许面上，**这一枚也不需要 ADR-0057 的判定**；它进表的理由是判据① （"发出去的每一枚都要有一行"）。🔴 一句不要读漏的边界：**登记与运行取证是两件事，两件都已成立**。运行那一半在 07 03:4x 闭合 ——
`check:linux-shell` 第 ④ 档真起窗口、真截图，页侧报出 `backend=shell clientId=… mounted=1`，
四个卡点（bwrap/userns、JSC 与 WebView 的创建顺序、`crossorigin` 要的 CORS 响应头、
自定义 scheme 下 module worker 起不来）逐条有读数，全部记在
[`../runbooks/linux-dev-box.md`](../runbooks/linux-dev-box.md) §5.7。
仍未闭合的是"`.deb` 里装的是不是这份 web-dist"（计划 P4 那一行）。 |
| libsqlite3-0 | 存储驱动 `SqliteDriver` 落本地库（`src/heyta_driver.c`） | 3.45.1（`dpkg-query` 现量 `3.45.1-1ubuntu2.8`） | public-domain（该机 copyright 的 `Files: *` 逐字 `License: public-domain`；另有 `GPL-2+` 块作为 Debian 打包的备选） | 宽松类，直接落在 §3.2 的允许面上 |

## 怎么复现这几行

出处是**发行版自己那份 copyright**，不是官网、也不是上游 README —— 系统库的许可随发行版的打包决定走
（`libgtk-4-1` 的 Debian/Ubuntu 版本就带 `+ds` 后缀并混列 Apache-2.0 / BSD-3 / CC0 片段）。
在装过这五枚包的那台 Ubuntu 载体上（`linux-dev-lan`）：前三枚 2026-10-06 现量，
后两枚与那次"逐段枚举"的更正 2026-10-07 03:0x 现量，且**上面每条命令都在该机上原样跑过**（跑出来的段数读数
就是正文里那组：37 / 15 / 9）。

```bash
# 版本：用 dpkg-query，不用 pkg-config —— pkg-config 要 provisioning 装完才有（这台载体 06 15:5x 还没有），
#        而许可登记这件事不该等到那一步才能复核。
dpkg-query -W -f='${Package} ${Version}\n' \
  libgtk-4-1 libjavascriptcoregtk-4.1-0 libjavascriptcoregtk-6.0-1 libsqlite3-0 libwebkitgtk-6.0-4
# 许可：**整包的默认许可**就是 copyright 里 `Files: *` 那一段的 License 行（例外块在后头）
for p in libgtk-4-1 libjavascriptcoregtk-4.1-0 libjavascriptcoregtk-6.0-1 libsqlite3-0 libwebkitgtk-6.0-4; do
  printf '%-32s ' "$p"
  awk '/^Files: \*/{f=1} f&&/^License:/{print $0; exit}' /usr/share/doc/$p/copyright
done
# 四枚 webkitgtk 家族的二进制包共用同一份 copyright（源包同版本），这一点也要有读数：
md5sum /usr/share/doc/{libwebkit2gtk-4.1-0,libwebkitgtk-6.0-4,libjavascriptcoregtk-4.1-0,libjavascriptcoregtk-6.0-1}/copyright

# 🔴 逐段枚举例外块：**必须按空行分段**，一段里 `Files:` 可以续行、`License:` 只有一个。
#    上一版这里给的 awk（`/^Files:/{f=$0} /^License:/{print f " ==> " $0}`）**不可信**：它把"最近一行 Files:"
#    配上每一条 License:，遇到续行就串台 —— 那次就是这么写出"没有一枚是 GPL-only"这句假话的（见上方更正）。
python3 - <<'PY'
import re
p = "/usr/share/doc/libwebkitgtk-6.0-4/copyright"
st = [s for s in re.split(r"\n\n+", open(p, encoding="utf8", errors="replace").read()) if "Files:" in s]
def get(s, k):
    # Files: 与 License: 都可能续行（缩进行）
    out, on = [], False
    for line in s.splitlines():
        if line.startswith(k + ":"): on, _ = True, out.append(line.split(":", 1)[1].strip())
        elif line.startswith((" ", "\t")) and on: out.append(line.strip())
        else: on = False
    return " ".join(out)
cop = [s for s in st if re.search(r"\bL?GPL\b", get(s, "License"))]
print("段总数", len(st), "| 带 GPL/LGPL", len(cop),
      "| 其中纯 copyleft", len([s for s in cop if not re.search(r"\bor\b", get(s, "License"), re.I)]))
for s in cop:
    print(" -", get(s, "Files")[:90], "=>", get(s, "License"))
PY
```

⚠️ 换发行版/换机器时这几行**必须重量**：`check-native-lib-registry.mjs` 钉的是"`Depends` 里每一枚都在这张表里"，
钉不住"版本号还对不对"或"许可没变" —— 后者只能靠重量这张表。

## 还没进这张表的（以及为什么）

🔴 先说一条**读这张表最容易犯的错**：这张表钉的是**我们自己写进 `.deb` `Depends` 的那几枚**（判据①），
而判据②（"表里每一行必须仍然在 `Depends` 里"）意味着**传递依赖不许在这里占行** —— 给一枚没有直接链接的包
加一行，对账器立刻红。所以下面这些不进"表"，只进这一节。

| 项 | 状态 |
|---|---|
| `libwebkitgtk-6.0-4` / `libjavascriptcoregtk-6.0-1` | ✅ **已进上面的表**（07 03:0x，随 M2 接线同批落地 —— [ADR-0057](../adr/0057-native-system-library-linking.md) §4 明写了这个顺序）。留这一行是为了记下**当时为什么不能提前登记**：判据②会让"提前写好的行"立刻红，那是刻意的 —— 它挡的是"文档跑在现实前头" |
| `libsecret-1-0`（Keyring / Secret Service） | 🔲 **我们不用它存任何凭据**（沿 [ADR-0040](../adr/0040-email-password-auth-decoupled-from-e2ee.md) §3.2 那行"Linux 不做专项"）。⚠️ 但"不做"≠"不会出现在依赖里"：07 03:0x 现量 `dpkg -s libwebkitgtk-6.0-4`（装机态，不是 apt-cache）⇒ 它的硬 Depends 共 **58** 条，里面有 `libsecret-1-0 (>= 0.7)`，还有 **`bubblewrap (>= 0.3.1)`**（就是 M2 运行那条腿卡住的东西，见 runbook 的 M2 一节）。🔴 它是**传递依赖**，所以我们**不把它写进 `Depends`**、也不在这张表里占行（占行会被判据②判红）；`apt` 装我们的包时自然把它拉进来，许可说明由它自己的包携带 —— 这正是 ADR-0057 "随发行版走"那一条的形状。🔴 它进闭包**不违反 ADR-0040** —— 那条 ADR 管的是"我们自己的口令字节住在哪"（不得以可读形式落盘；OS 级加密托管属于允许类），不是"进程链接了哪些 `.so`"；而 Linux 壳今天**根本没有凭据路径**（门面不传 `serverUrl`，见 [计划](../plans/linux-adaptation.md) §1.1）。⚠️ 一处要重判而不是推翻的过期理由：ADR-0040 那行给的"Linux 定位是同架构但不做专项功能"已被 2026-10-06 的指令改掉，**结论可以不变、但不能再拿那句当论据**（改已接受的 ADR 要新写一份，本单不动它，登记在计划 P6 那一行） |
| P2 落地时的两条判据（P2 代码已落，判据现在有东西可判） | ① 壳的 C 源码里**零处**调用 WebView 的凭据/密码保存入口：**M2 接线之后重新现量仍是空集**（07 03:0x：`grep -rin 'password\|credential\|secret' apps/desktop-linux/src/` 命中 0 处，`grep -rn 'serverUrl' apps/desktop-linux/src/` 也是 0 处）⇒ 这条基线**没有**因为接 WebView 而上升；此后任何一次上升都要当场解释是哪条 API、为什么。② 共享 Web UI 里的口令输入框保持"不托管"形状（`autocomplete` 那类）—— 🔲 **未跑**：它要的是"装出来的界面"这一侧，而运行那条腿本身还没闭合，不在这里预先声称已成立 |
