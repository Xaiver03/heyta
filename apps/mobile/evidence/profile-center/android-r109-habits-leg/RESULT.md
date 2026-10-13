# Android 设备腿 r109（habits 腿）—— 取到的是几何，不是一条绿腿

**这一趟没有跑绿。** 它跑到的是：一次完整的远程重打 + 两次设备腿尝试（一次红在产品几何、
一次根本没开始），以及三份能复现"为什么红"的界面树。下面把**证到了什么**和**没证到什么**
分开写。

## 出处（读数属于哪一批）

| 项 | 现量 |
|---|---|
| 打包输入 | `_heyta_windows_sync_push` 送的是**当时的工作树**（`git ls-files` + 未跟踪未忽略），不是某个 commit |
| 产物 | `app-release.apk` sha256 `c150b73993a5c309…`、69,480,004 B —— **与 r108 那枚逐字节相同** ⇒ 那一次工作树在"打包输入"这一层等于 r108 的 HEAD（本轮的 `scripts/lib/*` 改动不是构建输入，`SettingsScreen.tsx` 当时还没改） |
| 设备 | `emulator-5554`（Pixel 镜像，物理分辨率 1080×2400，`wm size` 现量）；这台 AVD 已跑 3 天，**不是这一趟起的**，pid 61554 不归本线 |
| 服务端 | 本机私有端口 **3111**（3000 是另一会话的常驻 server，pid 26623，没碰）；库 `heyta_ux_r109` —— 由 schema 完整的库 `pg_dump --schema-only` 建（默认名 `heyta_mobile_smoke` 只有 25/51 张表，见 §7 陷阱 #435） |
| 账号 | 每趟新建：`mobile-e2e-1791910648@example.com`（合成夹具地址，非真人邮箱） |
| 判据 | `pnpm check:android-build-host` rc=0、`pnpm check:android-gradle-remote` rc=0、`pnpm --filter @heyta/mobile typecheck` rc=0、`pnpm check:mobile-settings` rc=0、`pnpm check:l4` rc=1（**与本线改动无关**：`SettingsScreen.tsx` 内联样式 13=13、`apps/mobile/src/screens` 合计 114=114，HEAD 与工作树同数） |

## 几何：三棵树量到的形状（这就是设备腿那句"找不到输入框"的真身）

`probe-keyboard-ab.sh` 的 A→B→C 三拍，逐节点 bounds 从 `tree-*.xml` 里可直接复量：

| 状态 | ScrollView（可滚区） | 「服务器地址」输入框 | 后两格（访问令牌 / 端到端加密口令） |
|---|---|---|---|
| A1 表单刚展开、键盘未起 | `[0,210][1080,2400]` | `[84,2125][996,2243]`（**贴住屏幕最底边**） | 标签 `[84,2344][996,2400]` 已在折叠线外，输入框不在树里 |
| B 键盘起立（填服务器地址后） | `[0,210][1080,1580]`（缩了 820 px） | `[84,1336][996,1454]` | 三枚节点 bounds 的 **top > bottom**（退化 = 被裁在折叠线以下） |
| C "收起键盘之后"（**与 B 逐字节相同的废样**） | `[0,210][1080,1580]` | `[84,1336][996,1454]` | 同 B，仍退化 |

读得到的三件事：

1. **展开即到底边**（A1）：用户点「使用自托管服务器」，新叫出来的第一格落在屏幕最下沿、
   后两格完全看不见 ⇒ 必须自己往下滚才够得着刚展开的表单。这是产品缺陷，已在
   `apps/mobile/src/screens/SettingsScreen.tsx` 收口（展开后把溢出的那一段补滚）。
2. **旧 helper 的手势落点在键盘上**（B）：`scroll_to_*` 那几处把 swipe 起点写死在 y=1900，
   而键盘起立后可滚区只到 1580 ⇒ 手势打在 IME 上，内容一毫米都不动，helper 白滚 4~5 次
   再报"找不到输入框"。已在 `scripts/lib/mobile-e2e.sh` 换成按当前 dump 里那台
   `scrollable="true"` 节点的实际上下沿算坐标（`swipe_in_view`），并把失败时的几何打进报告。
3. **退化 bounds 不能当可点行**：折叠线以下的节点在 dump 里是 `top > bottom` 的形状，
   任何"按中心点 tap"的取坐标逻辑都必须先按 `y2 > y1` 过滤 —— 这条是 helper 里 `*-sane`
   过滤的既有理由，这一趟给了它一份现量样本。

**这一条没有归因，而且 C 那一拍本身不算证据**：`tree-C-keyboard-dismissed.xml` 与
`tree-B-keyboard-up.xml` **逐字节相同**（`SHA256.txt` 里同一枚哈希）。也就是说那次"收起键盘"
根本没改变界面 —— BACK 没送达、或 IME 其实还开着。所以 C 里那个 1580 **不能**读成
"`KeyboardAvoidingView behavior='height'` 收起后没回写高度"，它只读成"探针那一步没生效"。
要判 KAV 收起后到底回不回 2400，得重跑一趟：C 那一拍同时留一条
`dumpsys input_method | grep mInputShown`，并且先证明键盘状态真的变了
（B→C 的树不许同哈希）。把这条写在这里而不是删掉 C，是因为**下一位需要知道这棵树是废样**。

**另一处只记录不修的（这条把归因改回来了）**：B/C 里那枚 `EditText` 的 text 是
`https://heyta.waytofutuhttp：／／10。0。。22：3111re.cn`。第一反应是"凭据填充往里追加而不先清空"，
**那句错了**：这串值是 `probe-keyboard-ab.sh:83` 自己打进去的 —— 一条裸
`adb shell input text "http://10.0.2.2:3111"`，**没走** lib 的 `clear_and_type`
（它 CTRL+A + DEL 先清、分块发、再读回补齐）。所以"追加不清空"是**探针的写法**，不是设备腿的缺陷。

但这棵树里还有第二件事，它是**真风险**、只是本趟没证明：`:` `/` `.` 落地成了全角 `：／／` `。`，
而 `clear_and_type` 同样只用 `input text` ⇒ 这台设备当前这个输入法状态下，设备腿填的 URL/令牌
**有可能**也被全角化。后果是可观测的而不是静默的：读回对不上会重试 6 次然后响亮地返回 1
（lib 里"口令被重复输入 7 次"那条历史注释就是同一通道的形状）。下一趟判它不用猜：
第一次读回时若 `cur` 与 `want` 的差异**只在全角/半角**，那就是输入法状态，不是丢字符。

## 两次尝试的结局

- **第一次**（`probe-first-run.txt`）：跑到设置浮层同步那一屏，按上面第 1、2 条红。
  当时取的是旧 helper 的行为（写死坐标 + 4 次白滚），报告里只有一句"找不到输入框"，
  没有几何 —— 所以才补了 `geom` 模式。
- **第二次**（`leg-loadgate-blocked.txt`）：**根本没进入设备步骤**。`wait_for_quiet_host`
  从 load1=19 一路等到 34，24 次采样全部不达标（阈值 12 = `hw.ncpu*3/4`），累计 720s 后
  本线主动停腿停栈。负载不是本线造成的：两次采样的 CPU 时间差量出 qemu 610%、
  DeepSeek Harness 273%、OrbStack 108%（客户机内 `top` 显示 idle），
  全是别处的进程。**没有为了让腿过去而调低那个阈值。**

## 下一趟怎么跑（一条命令，落点已写死）

```sh
bash apps/mobile/evidence/profile-center/android-r109-habits-leg/run-leg.sh
```

前置三件（脚本头注释里也写了）：私有 schema 完整的库、端口 3111 而非 3000、
以及 **APK 必须从含 `settings-section-*` 的当前源码重打**（10-12 那批包里没有这些
testID，用旧包跑这条腿会得到"导航全停在目录层"的假结论）。
负载门放开（`uptime` 的 load1 ≤ 12）之后再跑；跑完要把"表单展开后自己滚进视野"
这一格从**静态门 + 几何**升级成**模拟器上看它滚进来了**，并补 `mInputShown` 那一拍。
