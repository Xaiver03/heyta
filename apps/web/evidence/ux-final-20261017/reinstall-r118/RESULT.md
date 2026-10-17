# r118 · 第七趟四端重装（载体钉在 `25f544bd`，起跑 `dirty=0`）

**结论：`REINSTALL_RC=0`。四端各有"装的是当前产物"与"起得来 / 画的是共享 UI"两条判据，五张界面图人都逐张打开看过。**

出处（载体、那一戳、脏不脏、负载、跑法、产物身份）全部在 [`provenance.txt`](provenance.txt)，
每一行都是现量命令 + 那一刻的读数，不在这页里重抄一遍会漂的值。

## 逐端判据（每条都能红）

| 端 | "装的是当前产物" | "起得来 / 画的是共享 UI" |
|---|---|---|
| mac | `.app` 内 `web-dist` 与本机 `apps/web/dist` **同一次构建**（9 个 chunk 逐字对账） | 窗口 2318x1508（`WINDOW_SIZE=1159x754` @2x，`CAPTURE_METHOD=screencapturekit`）；**这一趟两张都读了**：窗口那张内容 74.5%、`…webview.png` 那张 74.6%、色阶 229、主蓝 997（判据数的是 webview 那张） |
| windows | 远端 tar sha256 逐字相同 + 新鲜度对账（`web-dist/index.html` / `bridge` / 7 枚 assets）；`install-capture.txt` 五条判据全在位（`ADD_APPX=OK` / `RESULT=OK` / `SHORTCUT_RESOLVES=True` / `WINDOW_TITLE=heyta` / `PNG_SAVED=True bytes=198010`），其中 `PAYLOAD_INDEX_SHA` 与本机 `index.html` 同一枚 | 1440x734、内容 69.0%、色阶 247、边缘 0.382 |
| android | release APK 重打 80M（`heyta-reinstall-apk.log.txt`）→ `emulator-5554` **全新安装**（不保留数据） | 前台由 `am start -W` 显式确认（`mCurrentFocus=Window{c4692cf u0 com.heyta/com.heytamobile.MainActivity}`）；1080x2400、内容 55.9%、主蓝 4042 |
| ios | `✅ 已装的包比源码新 —— 这一轮装的是当前产物`（xcodebuild Release 重打 JS bundle） | 1206x2622、内容 58.8%、主蓝 4091 |

## 人看图那一半（AGENTS §6.2 规定一）

| 图 | 看到什么 |
|---|---|
| `heyta-reinstall-mac-installed.png.webview.png` | 浅色收集箱首屏：左 rail 九个入口、四象限五个带色点、清单/标签两张空态、右栏「对话助手」+「今天想先完成什么？」、页头「今天 / 最近 7 天 / 已完成」；正中盖着联网同意卡，主蓝「同意并联网」+ 次级「只用本机」 |
| `heyta-reinstall-mac-installed.png`（窗口那张） | **这一趟它里面有完整应用** —— 红绿灯点 + 三栏共享 UI，和上面那张同一次瞬间。⚠️ 这不推翻"窗口截图不能当 UI 证据"那条：r110 同一枚判据数的是 webview 那张，因为窗口那张当时是**均匀暗底 + 三个点、里面没有应用**。两趟合起来说的是：这张图**两种形状都出现过**，所以它不能当判据，只能当对照 |
| `packaged-first-run.png`（windows） | 收集箱三栏 + **头像菜单是开着的**（取证探针点开的：登录账号 / 个人中心 / 应用设置）+ 同意卡。1440 这一档右栏标题「对话助手」**完整可见、离右边缘有余量** —— 但这不是 r110 记下那格待查的宽度（那一格要判的是 1152x587），所以**它不结掉那一格** |
| `heyta-reinstall-android.png` | 全新安装后的首屏同意卡（浅色）：盾牌图标标题、两段要点、"服务条款 / 隐私政策"两链接、底部两枚按钮完整可见，无遮挡无截断 |
| `heyta-reinstall-ios.png` | 同一张同意卡在 iPhone 上（浅色），行距与 Android 一致；状态栏 13:39，两枚按钮完整 |

## 两处偏离（不藏）

1. **ios 那一腿用的不是点名的模拟器。** 传的是 `IOS_DEVICE_NAME=heyta-iphone-17pro`，日志原话：
   「⚠️ 名字含 "heyta-iphone-17pro" 的模拟器没有已启动的，但**只有一台**已启动 ⇒ 用它：
   `heyta-multiend-reinstall (EAAD1B66-80A3-4A51-957C-298DAF22F057)`」。
   ⇒ 读数落在**另一台设备标识**上。这一腿证的是"当前产物能装进一台 iPhone 模拟器并画共享 UI"，
   不主张"在 17 Pro 那一枚上"。
2. **`pod install` 把载体写脏了 1 行**（`apps/mobile/ios/Podfile.lock`，1 增 1 删，逐字见
   `podfile-lock-delta.txt`）。⇒ ios 这一腿**不是**"只含已提交内容的隔离检出"那一档；
   跑完之后那棵树 `git status --porcelain` 只剩这一枚文件。

## 这一趟**不证**的事（写给下一个读这页的人）

1. **不证 `origin/main`** —— 全程只本地提交，没 push。
2. **不证深浅两档都装过** —— 壳跟随宿主系统外观，这一趟四端跑出来**都是浅色**；暗色那档仍只有浏览器与设备腿的读数。
3. **不证小组件卡片在桌面里换了字** —— 那是原生桌面小组件，重装只保证壳与包，不碰宿主桌面。
4. **不证干净检出可复现这一趟** —— 载体 `dirty=0` 起步，但 `pod install` 中途把它写脏了；那一档另有 r102–r105 的读数，不在本页。
5. **不证 windows 那 13 列右边缘**：`packaged-first-run.png` 最右 `x∈[1427,1440]` 有一条**不是应用画的**内容
   （主色 `#DDDCDC` 亮灰 6553 px + 一枚红字形 `#B7302F` 45 px + 一枚紫字形 `#A066AD` 24 px，直方图现量），
   占整图 **0.9%**。窗口圆角在 `x≈1425` 就收口了 ⇒ 那是**窗口之外的桌面内容被吃进来了**。
   本趟**不裁决它是什么**（要判得回远端看那一屏），但它是一个**装置事实**：windows 那张的内容占比判据里含 ≤0.9% 的外来像素。
6. **不证 r117 那枚守卫缺陷在这趟的包上被修掉了** —— 恰恰相反，这趟的包上又复现了一次，见下。

## 与 r117 那一格的接缝

这趟装出来的 Android 包（`lastUpdateTime=2026-10-17 13:26:21`）上，「清除本机保存的凭据」那枚按钮
在冷启动后仍然是 `enabled=false` —— 读数与逐字证据在
[`apps/mobile/evidence/ux-final-20261017/android-widget-erase-r117/RESULT.md`](../../../../mobile/evidence/ux-final-20261017/android-widget-erase-r117/RESULT.md)。
⇒ 台账那一格（计划文末）记的"可达态成立、入口够不到"这半句，在**当前产物**上同样成立，不是旧包的读数。

## 复跑（一条命令，落点写死）

```sh
C="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-r111"
RT="$HOME/heyta-r118-reinstall" && mkdir -p "$RT" && \
git -C "$C" checkout --detach 25f544bd && cd "$C" && \
NO_COLOR=1 HEYTA_REINSTALL_TMP_DIR="$RT" IOS_DEVICE_NAME=heyta-iphone-17pro \
  bash scripts/reinstall-all.sh > "$RT/reinstall.txt" 2>&1
```

⚠️ `HEYTA_REINSTALL_TMP_DIR` **必须先 `mkdir`**（不给目录它会 `RC=4`），且路径**不许含空格**。
载体那一棵是本次用完的 `heyta-wt-r111`（`du -sh` 现量 2.3G，收尾脏项 = 上面那枚 `Podfile.lock`），
要新开一棵照台账那几格的步骤。
