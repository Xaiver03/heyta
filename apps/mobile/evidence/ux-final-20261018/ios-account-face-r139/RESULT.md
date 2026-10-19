# r139 · iOS 账号面装机态复验 r138 的可及名称修复（当前源码产物）

本轮要答一句话：**r138 那处「屏幕上那行 ≠ 读屏念的那句」的修复，装进真包之后在界面上成不成立。**
旧件（r128 那枚产物）上量到的是缺陷本身（见 `../ios-ai-face-r137/RESULT.md` 第六节），这一趟量的是修完的件。

## 1. 出处（读数只在这一枚件上成立）

| 项 | 值 |
|---|---|
| 被测物 | 隔离载体 `/Users/rocalight/heyta-carriers/head-r128`，检出提交 `997a1935cff464255143f31cdfba25c117a8342b`（= r138 那笔修复本身，且它是当前 main `fec02f23` 的祖先） |
| 构建/安装 | 第九趟四端重装的 iOS 腿，落点 `/Users/rocalight/heyta-r139-tmp`（`reinstall-ios.log`、`ios/heyta-reinstall-ios.png`）；**全新安装** |
| 装进设备的包 | `…/Bundle/Application/D8CEE77A-…/Heyta.app`，包目录 mtime **`2026-10-19 11:24:10`**（旧件是 10-18 18:11:07 ⇒ 这一趟读的确实是新包） |
| 装置 | `scripts/qa/account-face-ios.py`（r138 改后版：`TOGGLE_NAMES = any_of(OTHER_WAYS_CLOSE, OTHER_WAYS_OPEN)`，旧钉死名已删） |
| 设备 | 模拟器 `heyta-iphone-17pro` / `FE195661-B021-4A71-AAD1-1F2F7AE3A102`，屏 402×874（截图 1206×2622 = @3x） |
| 三格 | `current-source/`（中文×浅）· `dark/`（中文×暗）· `english/`（英文×浅） |

## 2. 判据与读数（三格同一把尺）

尺子只有三问，全部从设备 AX 树取，不看产物里的词条表：

1. 折叠态：那枚开关节点的 `AXLabel` 是否等于屏幕上那行（「其他登录方式」）；
2. 展开态：`AXLabel` 是否换成「收起其他登录方式」**且** `AXValue == "expanded"`；
3. 再按一次：展开那两枚（邮件链接 / 通行密钥）是否**消失**（`expandedGone`）。

| 格 | 步数 | 折叠 `AXLabel` / `AXValue` | 展开 `AXLabel` / `AXValue` | `expandedGone` | `startedAt`→`finishedAt` |
|---|---|---|---|---|---|
| `current-source/` 中文×浅 | 13 | 「其他登录方式」/ `null` | 「收起其他登录方式」/ `expanded` | ✅ | 1792380291.59 → 1792380319.20 |
| `dark/` 中文×暗 | 11 | 「其他登录方式」/ `null` | 「收起其他登录方式」/ `expanded` | ✅ | 1792380992.52 → 1792381017.93 |
| `english/` 英文×浅 | 11 | "Other ways to sign in" / `null` | "Hide other ways to sign in" / `expanded` | ✅ | 1792380381.89 → 1792380405.34 |

⇒ **修复在真包上成立**：两态的可及名称都跟着屏幕上那行走，不再钉死在第三句说法上。
`startedAt`/`finishedAt` 三格都在（r138 顺手修的那处装置说谎字段，这一趟是它第一次被跑到）。

⚠️ **一处读法警告**：`expanded state` 的 `headerNow` 在中文两格里回的是 `["其他登录方式","收起其他登录方式"]` 两枚，
英文格里只有 `["Hide other ways to sign in"]` 一枚。**这不是屏上有两行** —— `headerNow` 那把尺是大小写敏感的子串在场判断，
「其他登录方式」是「收起其他登录方式」的子串所以两枚都命中，而 "Other ways to sign in" 首字母大写、
在 "Hide other ways to sign in" 里对不上（那句是小写 `other`）所以只命中一枚。
**名称的判据是 `toggleNode.AXLabel`（那一枚节点自己回的值），不是 `headerNow`。**

## 3. 深浅档与语言两维各自怎么立的

- **外观档**：`dark/` 那格的 `require_appearance` 有牙（末级目录名是 `dark`，与设备档不符就拒写），
  再加像素这把独立尺：`dark/` 两张 `modalLuminance = 28`，`current-source/` 与 `english/` 四张 `= 252`。
  设深按 #471 那条走（`shutdown` → `boot` → 之后才 `simctl ui … appearance dark`），收尾已还原 `light`（回读 `light`）。
- **语言档**：`english/` 那格靠 AX 树里的英文标签立起来（`auth form state` 那步 `Sign in with email and password: true` / 中文各枚 `false`）。
  🔴 **`xcrun simctl spawn … defaults read -g AppleLanguages` 不是这一维的判据** —— 本趟它就说过 `zh-Hans-CN` 而界面全英文，
  原因是 #469：语言由应用内开关持久化的 `HeytaWidget.preferredLocale` 决定，系统域那把尺量的是另一件事。
  本趟第一趟 AI 面就是这么被误标成"中文档"的，落点已改名，详见 `../ios-ai-face-r139/RESULT.md` 第 4 节。

## 4. 人看图（6 张全看）

| 图 | 看到什么 |
|---|---|
| `current-source/auth-sign-in.png` | 浅底、段头「… 其他登录方式」在表单下方，图标是三点 + 文字 |
| `current-source/auth-other-ways-expanded.png` | 段头换成「收起其他登录方式」，下方三枚：用邮件链接登录 / 用通行密钥登录 / 用通行密钥注册 |
| `dark/auth-sign-in.png` | 真深蓝底（不是灰白），段头「其他登录方式」白字清晰，主按钮浅蓝底深字 |
| `dark/auth-other-ways-expanded.png` | 展开后三枚按钮在深底上边框可见，段头「收起其他登录方式」 |
| `english/auth-sign-in.png` | 英文档折叠态 "Other ways to sign in"，与 `AXLabel` 同字 |
| `english/auth-other-ways-expanded.png` | "Hide other ways to sign in" + "Sign in with an email link" / "Sign in with a passkey" |

四张对照下来：**可见文字与 `AXLabel` 逐字相同**，这是 r137 那趟在旧件上反过来的那件事。

## 5. 不证（别把这一格读成这些）

1. **注册档那枚邮件链接按钮没在设备上验**。设备腿从「注册 / 登录」进，落的是登录档，
   所以屏上是「用邮件链接登录」；`mode === 'register'` 那支（「用邮件链接注册」）只有源码判据
   （`apps/mobile/tests/auth-screen-password.spec.ts` 第 7 条 + kit 的 `accessibilityLabel ?? label` 默认）在守。
2. **英文×暗这一档在当前源码件上没跑**（r137 在旧件上跑过）。这一维本线量过的是"旧件上会说出第三句说法"，
   新件上没重复取这一档 ⇒ 不许写成"四格全绿"。
3. 通行密钥那两枚按钮在登录档下同时在场（登录 + 注册）是源码里写死的两枚（`AuthScreen.tsx` 的 891/899 两枚 `label` 不带 `mode` 条件），
   与邮件链接那枚的条件式不对称。**本线不判它是不是缺陷** —— 它属界面那一线的设计取向，本线只把形状记在这儿。
4. 这一趟只跑 iOS 模拟器；macOS / Windows / Android 三端与真机未验。
5. 载体在构建后不干净（`Info.plist` ×2 与 `Podfile.lock` 被 pod install 重写），**本线没有提交那三枚**，
   形状与"别拿删除行当丢键"那条读法进环境陷阱 #489。

## 6. 复跑

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
D=apps/mobile/evidence/ux-final-20261018/ios-account-face-r139
# 中文×浅
python3 scripts/qa/account-face-ios.py --udid $U --evidence-dir $D/current-source
# 英文档（先切应用内开关）
python3 scripts/qa/ios-app-language.py --udid $U --to en
python3 scripts/qa/account-face-ios.py --udid $U --evidence-dir $D/english
python3 scripts/qa/ios-app-language.py --udid $U --to zh        # 收尾必须还原
# 暗档（#471：设深要放在 shutdown+boot 之后）
xcrun simctl shutdown $U && xcrun simctl boot $U && sleep 6
xcrun simctl ui $U appearance dark
python3 scripts/qa/account-face-ios.py --udid $U --evidence-dir $D/dark
xcrun simctl ui $U appearance light                              # 收尾还原
```

设备当前状态（本趟收工时现读）：`appearance = light`、应用内语言 = 中文（`ios-app-language.py --to zh` 8 步 `rc=0` 且回读通过）、
**没收任何 companion**。
