# heyta 设置中心（订阅 + 问号禁令）—— 交接文档

> 写给接手这件事的 agent / 人。日期：2026-10-24。
> 起因：产品负责人要「**需要有单独的订阅界面**，移动端和桌面端都要有」，随后两次要求
> 「**严禁说明文字出现，只允许一个圈里一个问号**」，并要求把它做成**代码禁令**。
>
> **一句话结论：这三件都做完了，而且现在有门禁钉着。剩下的不是"清 47 处说明文字"
> （那是上一轮的旧读数，现在是 0），而是移动端真机验收、公证、以及部署侧那两组环境变量。**

---

## 一、先纠正三个错误前提（别再走一遍）

| 结论 | 事实 | 证据 |
| --- | --- | --- |
| ❌「还剩 47 处内联说明文字要清」 | **是 0 处**。47 是上一轮中途的读数；这一轮已经全部换成了问号气泡 | `pnpm check:settings-prose` → `✅ 设置界面里一句内联说明文字都没有`，账本 `scripts/settings-prose-ledger.json` 值为 0 |
| ❌「桌面端缺 Developer ID macOS profile，打不了包」 | **profile 一直在**。是**文件沙箱**把 `security cms -D` 拒了（`cert import failed: UNIX[Operation not permitted]`），而 `find-signing-profile.py` 把解码失败静默当成"没有 profile" | 同一条命令在完整权限下返回 `~/Library/MobileDevice/Provisioning Profiles/2bd44e7a-dacb-4925-8ba4-2acb9c47474e.mobileprovision`（bundle `cloud.finlaw.heyta.desktop`，team `V5S2LT9YV8`） |
| ❌「桌面端看不到订阅/新界面」 | **旧包**而已。已重打并覆盖安装；包里 assets 现在含 `settings.nav.subscription` | 见第三节的读数 |

> 这三条都是我（上一轮）说错的。判"缺证书/缺 profile"之前，先在**完整权限**下跑一次
> `python3 apps/desktop-macos/scripts/find-signing-profile.py cloud.finlaw.heyta.desktop V5S2LT9YV8`。

---

## 二、做完了什么

### ① 「订阅」独立成节（Web）+ 独立一节（移动端）

| 端 | 形状 |
| --- | --- |
| Web | 设置第 8 节「订阅」（排在「个人资料」之后）。`RenewPanel` 从「账号与安全」搬出来。页内三段：**状态 → 选一档 → 关于收费** |
| 移动 | `SettingsSectionKey` 新增 `subscription`（`apps/mobile/src/screens/SettingsScreen.tsx`）。页 = `SubscriptionSection`（状态 `EntitlementSection` + 收银台 `RenewSection` + 脚注），「我的」只留**一行入口** `profile-entry-subscription` |
| 桌面 | 同一个 Web 产物（WKWebView 打 `heyta-local://app/index.html`，内容来自包内 `Contents/Resources/web-dist`） |

两端**共用**同一套收银台与权益判定（`@heyta/app-host` 的 `startCheckout` / `fetchHostedEntitlementReading`，
`@heyta/domain` 的 `decideHostedSyncAccess`），没有第二份实现。

### ② 「AI 与集成」按话题分卡

- Web：面板根加 `ht-settings--cards`，于是它**不再是**一张巨卡，而是一列卡：
  `ai-card-gates`（开关/出境/供给/端点/能力/助手）→ 本机 API → 入站自动化 → 重置。
  卡片内部的 `.ht-settings__section` 降级成子块（无底色无边框，只留发丝线）。
- 移动：`AiSettingsSection` 本来就是"一卡一话题"（6 张卡），未改。
- 🔴 **供给模式默认值改了**：`routing.mode ?? 'managed'`，且「heyta 托管」排第一
  （原话：「我们现在主要是卖中央托管的……怎么搞成自托管是主叙事了呀？」）。
  安全侧没变：发不发出去仍由「允许远程端点」那道闸裁决。

### ③ 🔴 禁令：设置界面禁止内联说明文字（这一轮最重要）

| 是什么 | 在哪 |
| --- | --- |
| 门禁 | `scripts/check-settings-no-prose.mjs` → `pnpm check:settings-prose`（已进 `check` 链） |
| 账本 | `scripts/settings-prose-ledger.json`（**0**） |
| Web 载体 | `apps/web/src/features/settings/SettingsInfoTip.tsx`：`?`，hover **或** focus 展开，`Esc` 收起，正文常驻 DOM（`aria-describedby`） |
| 移动/共享载体 | `packages/ui/src/settings/Settings.tsx` 的 `SettingsInfoTip`：点击展开；`SettingsRow.hint` 已**全部**改走它（两端通吃） |
| 规则正文 | `docs/agents/design-system.md` →「设置界面里禁止写说明文字」 |
| 命令登记 | `docs/agents/commands.md` |

判据：`ht-settings__*hint* / *note* / *lead*` 任何容器 = 违规。三条例外（必须显式标注）：
**反馈**（`role="alert"` / `aria-live` / `danger` / testid 带 failure\|status）、
**ADR-0054 §7 的出境披露**（`data-settings-disclosure`）、**读数**（`data-settings-readout`，
"共 1234 条实体"这种是数据、不是解释）、**报告分组标题**（`ht-settings__h4`）。
⚠️ 第二臂**不认** `role="status"` 当载体：一句 58 字的"记忆已关闭 —— …"放进状态位仍然是那四行小字。
另有两条显式逃逸口，都要求写明理由：`// settings-prose-ok: <理由>`（写在那一行或上一行）与
`data-settings-readout`。

⚠️ 两个坑：容器**名字**带这三个词就中招（纯容器要改名，本轮把 `…__sub-footnote` → `…__sub-about`、
`…__help-note` → `…__help-line`、`…__hint-line` → `…__action-line`）；账本只许变小，
判据变严要走 `--update --rebaseline "理由"`。

---

## 三、现在的读数（2026-10-24 收尾真跑过；第二轮清完「说明文字」之后又跑了一遍）

| 判据 | 命令 | 读数 |
| --- | --- | --- |
| 设置界面禁内联说明 | `pnpm check:settings-prose` | **0 处**（账本 0，两臂都跑） |
| Web 单测 | `cd apps/web && ./node_modules/.bin/vitest run` | **2542 passed / 2 failed** —— 两条都长在并行线的 `admin-console-route` / `admin-panel`，与本轮无关 |
| 移动端单测 | `cd apps/mobile && ./node_modules/.bin/vitest run` | **1119 passed / 0 failed** |
| 真浏览器（设置面） | `cd e2e && playwright test tests/renew-panel.spec.ts tests/ai-panel-layout.spec.ts tests/profile-avatar-e2ee.spec.ts` | **10 passed** |
| 设置面整族走查 | `HEYTA_RESPONSIVE_LEGS=groups pnpm verify:web-ui-sweep` | `rig_rc=0`、25 张证据图 |
| 桌面包里有订阅 | `grep -c settings.nav.subscription /Applications/Heyta.app/Contents/Resources/web-dist/assets/index-*.js` | **2** |
| 桌面包签名 | `codesign -dv /Applications/Heyta.app` | `Identifier=cloud.finlaw.heyta.desktop`、`TeamIdentifier=V5S2LT9YV8` |
| 文案 / 方言 | `pnpm check:ui-language` | ✅ 4214 键，zh/en 一一对应 |
| ht-* 族 / 接线 / 文档命令 | `check:row-single-source` / `check:gate-wiring` / `check:doc-command-claims` | ✅ / ✅ / ✅ |

**HEAD 就红、与本轮无关**（先看是谁的线，别去"顺手修"）：
`check:design` 的 `apps/web/src/features/auth/auth-dialog.css:278`；`check:server-legal` 的指纹；
`check:selection-single-source`（3 处本地 `…Id` useState，含 `RenewPanel.tierId`）。

---

## 四、还没做完（按顺序）

0. **移动端的说明文字还只清了一半**：本门第二臂**只跑 Web**（`apps/web/src/features/{settings,subscription,sync}` + `App.tsx`）。
   移动端那些 40 字以上的静态句子还在 20 多个 screen 里（`ProfileScreen` / `SecurityScreen` / `SessionsSection` /
   `ReminderDeliverySection` / `PrivacyConsentSheet` …），其中一半是**反馈或法务文本**，要按屏逐块判。
   把第二臂开到 `apps/mobile/src/screens/**` 会一次冒出约 40 处，读数见
   `node scripts/check-settings-no-prose.mjs --json`（改 `copyArmApplies` 即可试）。
1.5 **头像要口令 → 产品负责人已拍「A. 钥匙进系统钥匙串」**（2026-10-24，回答"为什么换个头像都要口令？？？"时选的）。
   现状：头像在服务端只有密文（ADR-0073，法务表 E「没有任何生物特征模板离开你的设备」靠这条）；
   解它的钥匙是**本次会话**的 vault 钥匙，而 ADR-0040 §7.2 规定 Web 端口令不落盘 ⇒ 每开一次应用都是锁的，
   于是「换头像」和「同步」都会先要口令。A 的落法（ADR-0040 §3.2 D2 本来就留的那条路）：
   钥匙串里按 `service=cloud.finlaw.heyta.<shell>` / `account=<accountId>` 存一把包装后的根钥匙，
   启动时静默 adopt；Web 浏览器没有可信存储，行为不变（仍每次要口令）。
   要新写一份 ADR（**不能改 ADR-0073 的结论**），并在 `packages/app-host` 落一个可测的 `KeyStore` 契约。
2. **移动端真机/模拟器读数**（唯一真正的缺口）：`pnpm verify:mobile-*`（`docs/agents/commands.md`）。
   「订阅」一节与 `SettingsInfoTip` 目前只有**源码形状 + 单测**判据
   （`apps/mobile/tests/subscription-section.spec.ts` 5 条，其中 2 条是变异臂），**没有设备读数**。
3. **公证**：这一趟是 `HEYTA_SKIP_NOTARIZE=1` ⇒ **不许**声称"已公证"。
   要公证：不带那个变量再跑一次 `package-app.sh`（无上界的等待要自己看着）。
3. **四端重装 / 其它壳**：`docs/agents/multi-end-build.md` 的固定收尾。
4. **可售的最后一步在部署侧**：`server/.env` 缺 `PAYCENTER_*` 与 `MANAGED_AI_*`（¥12 要后者）。
   `pnpm doctor:billing` 看现状；容器里 `npm run doctor:billing:dist`。
5. **落地页文案**（等通道真通了再改，否则对外说假话）：`landing.pricing.hosted.cta` /
   `hostedAi.cta`（现值「即将开放」）、`landing.pricing.statusNote`（现值「……现在还不能下单」）。
6. 细节可再走一遍：`?` 与标题/字段的贴合位置（密码面板那两枚已经挪到字段标签旁）。

---

## 五、关键文件

| 用途 | 路径 |
| --- | --- |
| 设置壳（8 节 + 每节 `?`） | `apps/web/src/App.tsx`（`SETTINGS_NAV_ITEMS`、`SettingsSectionHead`） |
| 订阅（Web） | `apps/web/src/features/subscription/SubscriptionPanel.tsx` + `RenewPanel.tsx` |
| 订阅（移动） | `apps/mobile/src/screens/SubscriptionSection.tsx` + `RenewSection.tsx` + `EntitlementSection.tsx` |
| 移动订阅入口 | `apps/mobile/src/screens/ProfileScreen.tsx`（`profile-entry-subscription`） |
| 移动设置目录 | `apps/mobile/src/screens/SettingsScreen.tsx`（`SettingsSectionKey` 含 `subscription`） |
| AI 面板 | `apps/web/src/features/settings/AiSettings.tsx`（`ht-settings--cards`、`ai-card-gates`）、`apps/mobile/src/ai/AiSettingsSection.tsx` |
| 问号气泡 | `apps/web/src/features/settings/SettingsInfoTip.tsx`、`packages/ui/src/settings/Settings.tsx` |
| 禁令门禁 | `scripts/check-settings-no-prose.mjs` + `scripts/settings-prose-ledger.json` |
| 版式 CSS | `apps/web/src/styles/app/sheets.css`（`__head` / `--cards` / `__toggle-hit` / `__h4`）、`ai-panels.css` |
| 收银台 / 权益 | `packages/app-host/src/checkout.ts`、`entitlement.ts`；`server/src/billing/checkout.routes.ts` |
| 计费自检 | `server/scripts/billing-doctor.ts` |

---

## 六、走过的死路

1. **`security cms -D` 在文件沙箱下必失败**，而 `find-signing-profile.py` 把失败吞成"没有 profile"
   ⇒ 别据此判"用户没配证书"。见第一节。
2. **`ts-node` 跑不了 `billing-doctor.ts`**（源码里 `./x.js` 后缀）；容器里也没有 ts-node ⇒
   本机 `npm run doctor:billing`（先 tsc），容器 `npm run doctor:billing:dist`。
3. **jsdom 的 `textContent` 连 `display:none` 的文字都读得到** ⇒ 面板单测**证明不了**"这句不占屏"。
   要证明只能：门禁（源码）+ 真浏览器截图。
4. **桌面壳自截图可能是旧画面**（存过状态）；要一次性：`HEYTA_WEBKIT_EPHEMERAL=1`
   （配合 `HEYTA_WEB_ROOT=<repo>/apps/web/dist` 或直接用装好的包）。
5. **不要用 `!important` 压 `borderless-controls.css` 的"无描边"**（2026-10-07 的产品裁决）。
   次要按钮要显眼就换**底色**。
6. **`pnpm -r build` 现在会失败**：`server/src/admin/admin.routes.ts:1179`（并行线在用 `MapIterator.map`，
   `tsc` 目标不支持），它挡住了 `&&` 后面的 web 构建 ⇒ 只出 web 产物时用
   `pnpm --filter @heyta/web build`。
7. **打包脚本会先做"产物新鲜度对账"**，比产物新的输入存在就拒绝并打印闭合命令；别跳过它。

---

## 七、新会话开头建议

```
读 .handoff/2026-10-24-heyta-settings-center.md（先看第一节的三个错误前提），
再读 docs/agents/design-system.md 里「设置界面里禁止写说明文字」那节。
先跑：pnpm check:settings-prose && cd apps/web && ./node_modules/.bin/vitest run | tail -3
然后从第四节第 1 条（移动端设备读数）开始。动手前 git status —— 工作树里可能有并行线
（admin 控制台 / 提醒）在改同一批文件；不要碰它们。
```

---

## 八、第二轮收尾（同一天，本会话）—— 第四节那 6 条的现状

> 结论先说：**①②③⑥ 都做完（三端在本机装、Android 在 `linux-dev` 装并跑通设备腿）；
> ④⑤ 不是代码问题 —— 它们是部署凭据问题**，本机没有那两组密钥，所以"通道真通"这个前提不成立，
> 落地页文案**故意没改**（改了才是对外说假话）。

| # | 交接文档里的那条 | 现在 | 判据 / 载体 |
|---|---|---|---|
| ① | 移动端设备读数 | ✅ **两端都有设备读数了** | `pnpm verify:mobile-ios-subscription` + `pnpm verify:android-subscription`，证据两个目录（见下） |
| ② | 公证 | ✅ **两趟都 Accepted 并装订** | `xcrun notarytool submit` 的 Apple 原话，见下 |
| ③ | 四端重装 | ✅ **四端齐了**（android 的装机与设备读数在 `linux-dev` 上做的） | `reinstall:all` 汇总 + `pnpm verify:android-subscription` |
| ④ | 部署侧 `PAYCENTER_*` / `MANAGED_AI_*` | 🔴 **仍缺**（本机两组都没有） | `doctor:billing` 原话：两档都卖不了 |
| ⑤ | 落地页文案 | ⏸ **故意没改**（前提不成立） | 现值「即将开放」/「现在还不能下单」与 ④ 一致 |
| ⑥ | `?` 与标题的贴合位置 | ✅ **修了，视觉可判** | 同一脚本拍的两帧 + 居中版同位置截图；**没做像素级定量**（见下） |

### ① 移动端设备读数（这条原来只有源码形状 + 单测）

**两端各一条腿**，判同一件事，载具不同（Android 那半见本节末尾）：

| 端 | 脚本 / 命令 | 树从哪来 | `?` 怎么点 |
|---|---|---|---|
| iOS | `pnpm verify:mobile-ios-subscription` | `idb ui describe-all`（AX 树） | `?` 与标题被合并成一个节点 ⇒ 按 x 偏移**自校准**（11 个候选逐个试） |
| Android | `pnpm verify:android-subscription` | 远端 `linux-dev` 上 `uiautomator dump` | `?` 是**独立节点** `<testID>-tip` ⇒ 直接点它中心 |

iOS 那一条：**无头模拟器、零服务端**，四条判据全读 AX 树，三档分开报（有 / 没有 / 树读不出）：

```
✅ 「我的」页有订阅入口（testID=profile-entry-subscription，frame=32 558 338 44）
✅ hint「官方托管同步的订阅与续费」默认**不在**树上（说明文字不占屏）
✅ 点「?」展开成功（x 偏移 60pt）—— 正文现在在树上
✅ 再点一下收起（正文重新不在树上）
✅ 订阅页有「官方托管同步：当前状态、选档与下单」/「买哪一档」/「¥5 / 月」/「¥12 / 月」/「订阅这一档」/「订阅只买」
✅ 未登录按下「订阅这一档」→「先登录你的 heyta 账号，才能下单。」
```

设备 = `heyta-ios-isolated17`（iPhone 17 Pro，1206x2622），产物 = `main.jsbundle 18:57:59`（比全部源码新）。

**它证明不了什么**（写在脚本头部，别读多）：不能证明"能买到" —— 真下单要真服务端 + 真账号，
那两条各有自己的腿（`verify-mobile-ios-renew-sellable` / `verify:mobile-ios`）。

#### 顺手发现的**门禁漏洞**（这条比设备腿本身值钱）

为了证明设备腿会红，我把 `Settings.tsx` 里两处 `hint` 改成 `<Text>{row.hint}</Text>` 直出：

- `pnpm check:settings-prose` → **✅ 照样绿**（它只扫调用点，脚本头部本来就写明不扫组件内部）；
- `pnpm verify:mobile-ios-subscription` → **❌ 红**（`hint 默认就在树上 ⇒ 禁令破了`）。

**第一次变异臂还打歪了**：`Settings.tsx` 有两个 hint 渲染点（开关/值行 + 动作行），
我第一次只改了第一处，而订阅入口是**动作行** ⇒ 设备腿绿得没错（当时的绿是真话）。
改到第二处才红 —— 记下来是因为"变异臂打歪"很容易被读成"判据无效"。

补的零成本那一道：`packages/ui/tests/settings-hint-through-tip.spec.ts`
（源码形状：每处 `row.hint` 必须交给 `SettingsInfoTip` 或存在性守卫）。
它**注入即红**（实测 `Tests 1 failed | 1 passed`，报出 `Settings.tsx:NNN` 那一行），
干净源码下 2 passed。规则正文已写进 `docs/agents/design-system.md`。

### ② 公证（这一趟没有 `HEYTA_SKIP_NOTARIZE`）

跑了**两趟**（第二趟是因为 ⑥ 改了 `packages/ui`，要让"装着的就是当前产物"这句话继续成立）：

```
① id 58ce3dab-1c9f-4c1d-a6cf-5e83ce4533ad  status: Accepted  → staple/validate 通过
② id a72252ff-77c4-45fa-862b-6bc5a5d9831c  status: Accepted  → staple/validate 通过
```

装机后复核（`/Applications/Heyta.app`）：

```
spctl -a -t exec → accepted / source=Notarized Developer ID / origin=Developer ID Application: … (V5S2LT9YV8)
codesign -dv      → Identifier=cloud.finlaw.heyta.desktop / TeamIdentifier=V5S2LT9YV8
包内 web-dist 主 chunk sha256 = b3b0cc03… 与仓库 apps/web/dist **逐字相同**；含 settings.nav.subscription ×2
```

⚠️ **一条要如实说的读数**：打包时的 `stapler staple/validate` 成功；事后我又手敲了一次
`stapler validate`，它报 **Error 68（Could not connect to the server / CloudKit）** ——
那是**网络**失败，不是"没有票据"（同一时刻 `spctl` 判 accepted）。别把它读成公证失败。

### ③ 四端重装

`reinstall:all` 的第 0 步 `pnpm -r build` 原来**过不去**，卡在并行线新加的一行
`cells.values().map(...)`（迭代器助手，server 的 tsc 目标/lib 不含它）。我改成了语义等价的
`[...cells.values()].map(...)`（**这是我唯一动过的别人那条线的代码，1 行**，注释里写明了原因）。
之后 `pnpm -r build` → **RC=0**。

| 端 | 读数 |
|---|---|
| mac | 装好；安装判据"包内 web-dist 与本机 dist 是同一次构建（9 chunk）"、内容占比 100.0%、主蓝 997 |
| windows | `ADD_APPX=OK` / `PAYLOAD_WEBDIST=True` / `M2D=OK` / `RESULT=OK`；远端新鲜度对账（tar sha256 + 7 枚 assets）通过 |
| ios | 卸旧 → Release 重打 → 全新安装；"已装的包比源码新"；内容占比 58.9%、主蓝 4091 |
| android | ✅ **打 + 装 + 设备读数**，全部在 `linux-dev` 上：APK `69,823,408 B` / `sha256=4cf771c4bb28da34…`（四条构建判据全过）→ `adb install -r -d` → `Success` → `pnpm verify:android-subscription` 全绿 |

**android 这一端为什么换了载具**：产品负责人 2026-10-04 的裁决是"不要在这台 Mac 上起新的
Gradle 构建或模拟器"，windows-pc 又没有 emulator 本体与 system-images
（`docs/runbooks/android-build-on-windows.md` §五）。产品负责人本轮指定 **`linux-dev`**
（`ssh linux-dev`，Ubuntu 24.04，`/dev/kvm` 在位，SDK 在 `~/.local/opt/android-sdk`）。
那台机器上：AVD `litopia_store_16x9`（1080x1920 @480dpi，Android 16 / API 36），headless 起法

```
emulator -avd litopia_store_16x9 -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect
```

跑完 `adb emu kill` 收掉（本轮已收）。**这台 Mac 一个 Android 模拟器都没起。**

### ④ 部署侧（本机确实缺，不是代码问题）

`cd server && node dist/scripts/billing-doctor.js`（源码版 `doctor:billing` 曾因上面那行 tsc 红而跑不了，
修完就能跑）：

```
收款：支付中心      关（未注册）      注册的通道 noop
交付：托管 AI 上游  关（未配置）
hosted-monthly     ⛔ ④ 没有注册任何真实收款通道（只有 noop）
hosted-ai-monthly  ⛔ ②′ 这一本实例没有托管 AI 上游
```

要打开需要（两组都是"总闸为真时必须齐全"，缺一枚就是启动期硬错误）：
`PAYCENTER_ENABLED/BASE_URL/CLIENT_ID/CLIENT_SECRET`、`MANAGED_AI_ENABLED/UPSTREAM_BASE_URL/UPSTREAM_API_KEY/UPSTREAM_MODEL_ID`。

**这些是运营凭据，我没有、也不该编造。** `server/.env` 里这两组键一个都没有（`grep -c` = 0）。

### ⑤ 落地页文案：**故意没改**

`landing.pricing.hosted.cta` / `hostedAi.cta` = 「即将开放」，`statusNote` = 「……现在还不能下单」。
④ 说通道没通 ⇒ 这三句**现在是对的**。改成「立即购买」就是对外说假话，所以这一条的正确动作是"不改"。

⚠️ 留给通道真通那天的一条**已知缺口**：没有任何门禁把这三句和"卖不卖得了"绑在一起
（`check:pricing` 只对账**价格**四处一致）。届时要么人工记得改，要么补一道门 —— 现在别补，
因为部署配置不在仓库里，门禁只能猜。

### ⑥ `?` 的贴合位置（修完并量过）

`packages/ui/src/settings/Settings.tsx` 的 `actionHead` 从 `alignItems: 'center'` 改成 `'flex-start'`。
为什么：展开时那一列多出一行正文，居中对齐把**图标本身**顶上去 ——

证据是**两张图**（同一脚本、同一滚动位拍的 00/01），加上把 `alignItems` 临时改回 `center`
重打一份 bundle 后同位置的那张：居中版展开时 `?` 明显高于标题，顶端版与标题齐平 —— 肉眼可判。

⚠️ **没做像素级定量**，且要说清为什么：展开会让列表重排，跨两张图比绝对 y 会被滚动锚点混淆；
我试过三种像素探针（灰度簇 / 蓝色标题行 / 环形检测），读数在 ±20px 内不稳、还互相矛盾
⇒ 与其写一个自己都不信的数字，不如只主张"看得见的那件事"。
代价：图标与单行标题的视觉中心可能差几 pt（常量，不动就不显眼）。

### 这一轮新增/改动的文件

| 用途 | 路径 |
|---|---|
| 设备腿 · iOS（新） | `scripts/verify-mobile-ios-subscription.sh` → `pnpm verify:mobile-ios-subscription` |
| 设备腿 · Android（新） | `scripts/verify-android-subscription.sh` → `pnpm verify:android-subscription` |
| 零成本形状判据（新） | `packages/ui/tests/settings-hint-through-tip.spec.ts` |
| 规则与命令登记 | `docs/agents/design-system.md`、`docs/agents/commands.md` |
| 设备证据 · iOS | `apps/mobile/evidence/subscription-20261024/00..03-*.png` + `tip-before-after.png` |
| 设备证据 · Android | `apps/mobile/evidence/subscription-android-20261024/00..03,02b-*.png` |
| 对齐修复 | `packages/ui/src/settings/Settings.tsx`（`actionHead` + 注释） |
| 并行线的 1 行（已标注） | `server/src/admin/admin.routes.ts:1179` |

### 🔴 交出去的那一刻，工作树正处于**另一条线的在飞状态**（这条最重要，先看）

本会话收尾时（约 21:1x）`pnpm -r build` **又红了** —— 但红的不是本轮的改动，是**并行线**
（管理后台 / 习惯频率 / 公告）正把 `packages/{i18n,design-system}` 改到一半：

| 门禁 / 命令 | 红的样子 | 真因（逐字） |
|---|---|---|
| `pnpm -r build` | `@heyta/design-system build: tsup` → `Failed` | `src/typography.ts(271,27): error TS2551: Property 'layout.form-label-width' does not exist on type 'HeytaNativeTokens'`（4 处；`tokens.ts`/`tokens.css` 20:53 刚被改） |
| `pnpm --filter @heyta/web typecheck` | `HabitsView.tsx` 4 处 | `'"web.habits.freq.spaced"' is not assignable to …`（**词条还没加进 `packages/i18n`**：源码与 dist 里都 grep 不到） |
| `cd e2e && npx playwright test …` | **7 failed / 3 passed**（`renew-panel` / `profile-avatar-e2ee`），连 `settings-exit` 也红 | 页面停在品牌帧（快照只有 `- img "heyta"`）⇒ **app 根本没挂载**。红线是上面那条词条缺陷的**下游**，不是设置面回归 |

⚠️ 这三行**都不是本轮引入的**：本轮的改动清单在下面那张表里，一个字节都没碰
`design-system` / `i18n` / `habits` / `admin` / `announcements`。
🔴 我**没有**去修它们（交接文档的规矩：先看是谁的线）—— 留给那条线自己收。

**本轮的读数是在各自当时的工作树上量的**，都在下面各自那节里写明了时刻：

- `pnpm -r build` **RC=0**：18:36 与 19:0x 两次（第一次是修掉 `admin.routes.ts` 那行之后，第二次是
  `reinstall:all --only mac,windows` 的第 0 步）—— 那时并行线还没改到 `design-system`。
- iOS 设备腿：**18:57:59 的 `main.jsbundle`**（比当时全部源码新）。
- mac 装机与公证：**第二轮打包**（19:0x）—— 包内 web-dist 与当时 `apps/web/dist` 逐字相同。
- Android 设备腿：**20:4x** 在 `linux-dev` 上跑通（APK `sha256=4cf771c4…`）。

> 换句话说：**"本轮做完的四件事"成立；"现在这一刻整棵树是绿的"不成立** —— 那要等并行线收口。

### 本会话结束时仍然是红的（都与本轮无关，别顺手修）

- `check:design`：`apps/web/src/features/auth/auth-dialog.css:278`（`xl+semibold` 档位表外）—— 已知。
- `check:selection-single-source`：3 处本地 `…Id` useState（含 `RenewPanel.tierId`）—— 已知。
- `check:evidence-hygiene`：`apps/mobile/evidence/ios-notification-purpose-20261024*/HeytaNotifyPurposeProbe.app`
  —— **并行线**（通知用途探针）把产物落进了证据目录（本轮结束时是**两处**，说明那条线还在动）；
  我没删，那是别人的在途取证。
- `check:server-legal`：指纹（已知）。

### Android 设备读数（第二轮补上的那一半）

`scripts/verify-android-subscription.sh`（`pnpm verify:android-subscription`）跟 iOS 那条**判同一件事**，
但载具更硬：`uiautomator dump` 给每个节点 `resource-id` + `bounds`，`?` 是**独立节点**
（`profile-entry-subscription-tip`）⇒ 直接点它的中心，不需要 iOS 那套坐标自校准。实测输出：

```
✅ 界面已就绪（轮询 1 轮）           · 界面语言 = zh（系统 locale = en-US；zh 是 app 自己的语言偏好）
✅ 「我的」页有订阅入口（resource-id=profile-entry-subscription，bounds=(96,855,888x132)）
✅ hint「官方托管同步的订阅与续费」默认**不在**树上
✅ 点「?」展开成功（点的是 tip 节点中心 312,915）    ✅ 再点一下收起
✅ 订阅页有「…current status…」/「买哪一档」/「¥5 / 月」/「¥12 / 月」/「订阅这一档」/「订阅只买」
✅ 未登录按下「订阅这一档」→「先登录你的 heyta 账号，才能下单。」
```

证据：`apps/mobile/evidence/subscription-android-20261024/`（4 张，含滚到底部的 02b）。
过程中踩到**两条探针陷阱**，都写进脚本头部了：① `scp host:/sdcard/…` 在这台宿主上会
"No such file or directory"（`/sdcard` 是 sdcardfs），取树必须走 `adb exec-out`；
② `uiautomator dump` **只吐可见节点**，CTA/脚注在首屏之外，不先滚就断言等于拿"没滚到"当"没画"。

### 下一轮的入口

```
1. 通道：把 PAYCENTER_* / MANAGED_AI_* 写进部署的 .env，跑 doctor:billing --strict 应转绿；
   然后才改 landing.pricing.*.cta / statusNote（三处一起改）。
2. 四端：本轮 android 是在 linux-dev 的模拟器上装的，主 Mac 上没有 APK 装机
   ⇒ 下一轮想要"四端都在本机"的读数，得先决定 android 的常驻载具（Mac 起模拟器要人点名授权）。
3. 桌面端：/Applications/Heyta.app 已是当前产物且 Notarized；下一轮改完 web 记得再跑一次
   reinstall:all --only mac,windows（打包器的新鲜度对账会拦下陈旧的 web-dist）。
```


---

## 九、第三轮（同一天）：两档「可以开始卖了」—— 代码侧做完了

> 产品负责人原话：「12元 和 5元 的都可以开始卖了」「收尾事项你也要做掉」。
> 这一轮把**代码侧**全部做完并留了读数；剩下**一处自相矛盾在法务正文**（不是代码），见 §9.4。

### 9.1 落地页：付费两档从"0 个按钮"变成**真入口**

改之前现量：`apps/landing/src/components/Pricing.tsx` 的 `<button>` 数 = **0**，
付费档的 CTA 是纯文字 `{t(`${keyPrefix}.cta`)}`（"即将开放"）—— 与
`docs/plans/launch-blockers.md` §3 那个「**能交付、但买不到**」的判断一致。

现在是**两态**（判据是 `VITE_APP_URL`，与 `startCta()` 同构）：

| `VITE_APP_URL` | 渲染 | 真浏览器读数 |
|---|---|---|
| 配了 | 两档各一枚 `立即订阅` → `…/app?lang=zh-CN&settings=settings-group-subscription`，`rel=noopener noreferrer` | 点得动、真跳转（`NAV -> …settings=settings-group-subscription`）；图 `apps/landing/evidence/pricing-cta-20261024/01-pricing-configured.png` |
| 没配 | 虚线一行「应用入口尚未配置，暂时无法下单」，**0 按钮**、全文无"立即订阅" | 图 `…/02-pricing-unconfigured.png`；单测「没有假的购买按钮」仍然绿 |

🔴 **落地页不自己收单**：只把人送进应用里已经存在的那一节。收银台仍**一份实现**
（`@heyta/app-host` 的 `startCheckout`，由 `RenewPanel` 调）。

### 9.2 为此新增的应用侧深链 `?settings=<节 id>`

`apps/web/src/lib/settings-deep-link.ts`（形状照抄 `auth-deep-link.ts` 的 `?signin`）
+ `App.tsx` 挂载处一个 `useEffect`。真浏览器读数（自带 API 兜底的临时载体）：

```
带 ?settings=settings-group-subscription ⇒ settingsOpen=true，可见节恰好 1 个：
                                          ["settings-group-subscription"]，订阅面板在
不带参数                                  ⇒ 设置组数 0（不自动打开）
```

图：`…/03-web-deeplink-subscription.png`（设置直接停在 Subscription，未登录时叠着登录面板 —— 买之前必须先登录，这是对的）。

### 9.3 口径与文案

| 词条 | 改前 | 改后 |
|---|---|---|
| `landing.pricing.hosted.cta` / `hostedAi.cta` | 即将开放 / Opening soon | **立即订阅 / Subscribe now**（只在配了应用地址时渲染成按钮） |
| `landing.pricing.pending`（新） | — | 应用入口尚未配置，暂时无法下单 |
| `landing.pricing.statusNote` | 大陆与海外的支付通道都还在等 → **现在还不能下单** | **人民币两档现在可以下单**（进应用「设置 → 订阅」）；**海外（美元）**定价还在等通道，暂时不能下单 |

⚠️ 旧的那句把**已经能买的 RMB 两档一起否掉了** —— 那也是假话，只是方向相反。
新口径按地区拆开，与 `launch-blockers.md` §3「海外 $5/$12 → 409 `PROVIDER_CURRENCY_UNSUPPORTED`」一致。

### 9.4 🔴 剩下唯一一处**自相矛盾**：法务正文还写着"没提供"（不归代码改）

`packages/legal/src/documents/ai-and-transfer.ts` 的 s5 仍写着
「这一档仍打不开」「**这项服务现在没有提供**」「今天的客户端里没有任何一个开关能把它打开」。
后一句**已经是事实错误**（设置页那枚 `own/managed` 开关 ADR-0054 §10.1 记着已落地），
而落地页现在**卖这一档** ⇒ 两侧口径相反。

**本轮没改它**，理由同 ADR-0054 §10.3：那几份文档自己标着「草案，未经法务复核、尚未生效」，
改它是**一次法务动作**；而现在它不只是"偏保守的过期陈述"，是**与对外售卖矛盾**。
要动需要产品负责人点头（或法务复核），并与 `LEGAL_SET_VERSION` / `server/src/legal.generated.ts` 重生成同批做。

### 9.5 顺手更正的两处**陈旧的代码注释**（行为零改动）

1. `packages/ai/src/managed-routing.ts`：注释写着"服务端不转发 `tools`"—— **已不成立**
   （`managed-proxy.routes.ts` 有 5 处、明确"照原样转发"）。真实理由改成
   "**这条链路没做过端到端验证**"⇒ `MANAGED_CAPABILITIES` 仍不含 `tool_calling`，
   **助手在托管档仍被响亮拒绝**（受影响的只是理由，不是行为）。
   📌 所以要打开助手，缺的是**一条端到端判据**，不是代码。
2. ADR-0054 追加 **§11**（正文与前几节一字未改，按仓规只加勘误节）：§9.4 的前提过期、结论照旧；
   落地页这一侧开始卖；§11.3 点名法务那处矛盾。

### 9.6 门禁：加了牙，也证明它会红

`check:payment-entry` 原本只认 `startCheckout(` 等字面量 ⇒ **看不见落地页那个入口**
（它调的是 `subscriptionHref(`，且标签在词条表里）⇒ 把落地页按钮删掉它不会红。
本轮给它加了：

- 一条模式 `/(?<!function\s)subscriptionHref\s*\(/`（**负向断言**：只有定义不算入口，
  否则"删调用点、留定义"会假绿）；
- **两条自检臂**：G 落地页真调 ⇒ 算一处入口（绿）；H 只剩定义 ⇒ 红并点名"没有任何付款入口"。

现量：`臂数 8，失败 0`；主判据从「2 处付款入口」变「**3 处**」。

### 9.7 这一轮的读数（都是当场跑的）

| 判据 | 命令 | 读数 |
|---|---|---|
| 落地页单测 | `cd apps/landing && vitest run` | **265 passed**（含新增 3 条） |
| Web 单测 | `cd apps/web && vitest run` | **2523 passed / 13 skipped**（202 文件；含新增 4 条深链用例） |
| 落地页 e2e（真浏览器） | `pnpm check:landing-e2e` | **40 passed / 1 skipped**，RC=0 |
| 付款入口门禁 | `pnpm check:payment-entry` | 绿；**3 处入口**；自检 8 臂全绿 |
| 价格四处一致 | `pnpm check:pricing` | ✅ ¥5/月·$5/月、¥12/月·$12/月 |
| 文案合规 | `pnpm check:ui-language` | ✅ 词条表 zh 4240 / en 4240 |
| 文档 / 表格 / 命令声称 | `check:docs` / `check:md-tables` / `check:doc-command-claims` | ✅ / ✅ / ✅ |
| 结构门禁 | `check:layering` / `check:row-single-source` / `check:gate-wiring` / `check:settings-prose` / `check:locator-labels` | 全 ✅ |
| `pnpm -r build` | — | **RC=0**（本轮开始时并行线已收口） |

**变异验证（证明这些判据会红）**：
- 落地页：把订阅节 id 写错 ⇒ 3 条红；把入口改成指向应用**首页** ⇒ 3 条红（`expected null to be 'settings-group-subscription'`）。
- 深链：去掉 `isSettingsSectionId` 收窄 ⇒ 「认不出的 id」那条红，且实测**8 个 section 全 hidden**（空白设置页）—— 证明那道守卫是承重的。

### 9.8 仍然没做 / 需要你拍板

1. 🔴 **法务正文那处矛盾**（§9.4）—— 需要一个点头。这是唯一"卖得出去但对外文本说没提供"的地方。
2. **部署凭据**：本检出 `server/.env` 里 `PAYCENTER_*` / `MANAGED_AI_*` 仍是 **0 枚**，
   `node dist/scripts/billing-doctor.js` 仍说两档卖不了（本机这只实例）。**部署机上是否已配，我这里看不到**。
3. **Web e2e 的 `renew-panel` 组**这轮**没拿到干净读数**：它红在
   `/api/announcements/active` 返回非 2xx（并行线 21:27 新加的公告客户端，`e2e/stub-provider.mjs` 里
   `grep -c announcements` = **0**）。红线是那条线补齐 stub 之后的事，不是订阅面回归 ——
   订阅面这一轮的证据是「Web 单测 2523 passed」+「真浏览器深链截图」。

---

## 十、第四轮：法务那处矛盾**已解决**；部署凭据**查清了**

### 10.1 法务正文与落地页不再互相打脸

`packages/legal/src/documents/ai-and-transfer.ts` 第五节整段重写（**中英同步**），
版本 **1.5 → 1.6**（`updatedDate` 2026-10-24），变更行写进两边的 changelog。

**撤掉的三句**（都已不成立）：

| 原文 | 为什么撤 |
|---|---|
| 「这一档仍打不开」（节标题） | 设置页有 `own / managed`，服务端代理就位 ⇒ 打得开 |
| 「它**今天仍然不是一个用户打得开的功能**」 | 同上 |
| 「**这项服务现在没有提供**」「今天的客户端里没有任何一个开关能把它打开」 | 同上，且与"正在卖"直接冲突 |

**换上去的事实**，写成三条并列条件（缺一条就说不通）：① 运营方在这台**实例**上配好境内上游；
② 你在设置里选托管；③ 你对**每个功能**单独授权（订阅 ≠ 同意出境）。

🔴 **明确排除助手**：托管端点不声明 `tool_calling`，带工具的请求**发出之前**就被拒（`no-route`、零请求）
⇒ 文档里写死「这一档不含对话式助手，要助手请自备端点」。这条是 ADR-0054 §11.1 的正文落点。

**保留策略那两段一字未改**（四列表 / 内容只活在一次调用里 / 45 天元数据 / "到期就删"没落地）——
定案没变，变的是可用性。

顺带改掉的陈旧点：
- 文件头**禁令 #2** 原文是"禁止写 heyta 云端 AI"，理由是 managed 不可达 —— 理由已过期。
  现在换成"**禁止把这档写成无条件可用**"（三条件 + 不许把助手写进去）。
- `summary` 中英两句（"由我们提供的云端 AI 当前不可用" → 现在的三条件表述）。

生成物：`packages/legal` 重建 → `server/scripts/gen-server-legal.mjs` 重生成
（`ai-and-transfer@**1.6**`）→ `packages/legal/scripts/gen-site-copy.mjs` 重生成站点 40 条文案。

**读数（全部当场跑）**：

```
check:server-legal        OK   ← 本轮之前是红的（"与 @heyta/legal 不一致"），现在绿
check:legal-copy          OK   （法律文本站点文案与 @heyta/legal 一致）
check:legal-tools / -permissions / -host / -closure-truth / -gdpr / -email-claims   全 OK
check:ui-language / check:pricing / check:payment-entry                              全 OK
pnpm -r build             RC=0
落地页单测 1455 passed（24 文件）· Web 2523 passed / 13 skipped · 移动 1096 passed
```

**真浏览器复核**（`http://127.0.0.1:4341/legal/ai-and-transfer/`，截图
`apps/landing/evidence/pricing-cta-20261024/04-legal-ai-and-transfer.png`）：

```
页面显示：版本 1.6 · 更新于 2026-10-24 ；草案横幅仍在（"还在法务复核中，尚未对用户生效"）
第五节内：'仍打不开' 0 次 · '现在没有提供' 0 次 · '没有任何一个开关' 0 次
          '现在可以订阅' 2 次 · '不含对话式助手' 1 次 · '45 天' 4 次
整页残留各 1 次：那是 1.6 变更行**引用被撤掉的原话**（changelog 必须留痕），不是主张
```

⚠️ 仍然是 `status: 'draft'` —— 文档自己标着「草案，未经法务复核、尚未生效」，我没把它改成生效。

### 10.2 部署侧查清了：**¥5 通了，¥12 没通**

生产机 = **`ubuntu-jcli`**（124.223.13.226，`https://heyta.waytofuture.cn`）。
compose 项目 `server`，容器 `supersync-server`（Up 8h healthy）+ `supersync-postgres`。

| 读数（只读） | 结果 |
|---|---|
| `printenv PAYCENTER_ENABLED` | **true** |
| `PAYCENTER_*` 键名 | **七枚齐全**（ENABLED/BASE_URL/CLIENT_ID/CLIENT_SECRET/PAYMENT_TYPE/TIMEOUT_MS/WEBHOOK_PATH） |
| 支付中心登记 | 支付中心的 `PLATFORM_PAYMENT_CLIENTS_JSON` 里**有 `heyta`** ⇒ 中心侧给了 client |
| 订单表 | `checkout_orders` **存在**，`count(*) = 0`（还没人买过） |
| `MANAGED_AI_*`（容器） | **0 枚** |
| `MANAGED_AI_*`（宿主机 `.env`） | **0 枚** |
| 部署那份 `docker-compose.yml` | `grep -c MANAGED_AI_` = **0** ⇒ 生产跑的是**更早的树**，`.env` 填了也不会进容器 |
| 现网镜像里的脚本 | 连 `doctor:billing:dist` 都**没有**（同样是旧树） |

⇒ **¥5 真能卖；¥12 卖不了**（闸门 ②′ 会拒单）。要让 ¥12 能卖，需要**三样，缺一不可**：

1. **一个境内上游的凭据**。白名单只认 `api.deepseek.com`（DeepSeek）或自建在
   `heyta.waytofuture.cn` 上的端点（`SERVER_MANAGED_MODEL_HOSTS`）。我按**键名**扫过生产上
   全部运行中的容器：只有 `AI_MODEL` 这类名字，**没有任何 DEEPSEEK/OPENAI 密钥变量**。
2. **把工作树里已有的 `MANAGED_AI_*` 转发块部署上去**（部署那份 compose 是旧树）。
3. **重建服务镜像**。

🔴 **我没有、也不会编造那个密钥**；把 `MANAGED_AI_ENABLED=true` 而不给它三件套，
`config.ts` 是**全有或全无** ⇒ 每次部署**启动即崩**（`check:payment-entry` 的臂 D 就是钉这个的）。

⚠️ **一条待观察**：生产日志有 `WEBHOOK_VERIFICATION_FAILED / reason: client-mismatch`
（来源 IP 含 `172.25.0.1` 与一个公网地址）。现在 0 单，最像扫描器；
但**若**支付中心回调用的 client id 与 `PAYCENTER_CLIENT_ID` 不一致，真实付款会**永远不结算**。
第一笔真实订单落地时要盯这条 —— 这是"能收钱"与"钱到账"之间**唯一还没被真实流量验证**的环节。

### 10.3 落地页文案因此改了**第二版**（第一版在生产上是假话）

第一版写「人民币两档现在可以下单」，而部署现量是 **¥5 能卖 / ¥12 卖不了**。
现在写的是：

> 人民币两档已经开放订阅：进入应用后在「设置 → 订阅」里选档支付。某一档若在你连的这台实例上
> 还没配好对应的交付能力，下单会被如实拒绝并说明缺什么，不会扣款。海外（美元）定价还在等支付通道。

—— **对任何一台实例都成立**，所以部署侧补齐上游时**不需要再改文案**。

### 10.4 `verify:legal-links` 这轮红的真因（不是本轮引入）

5 条全挂在 `e2e/auth-journey/helpers.ts:456` 的 `toRegisterMode()`：
它点 `auth-form-switch-mode`，而那个 testid **在 `apps/web/src` 里已经不存在**
（认证面板现在是 `central-auth-*` 那一套 OIDC 形态）。

🔴 关键证据：`git show HEAD:apps/web/src/features/auth/AuthPanel.tsx | grep -c auth-form-switch-mode` = **0**
⇒ **HEAD 上就没有**，不是今天谁改掉的。同一 testid 还被另外 3 个 e2e 文件引用
（`auth-registration-otp` / `auth-consent-registration` / `selfhost-web`）⇒ 这一族 e2e 已经过期，
**与法务文本、与两档售卖都无关**。要不要修它们是一个独立的决定（改 e2e 还是把 testid 加回去）。

### 10.5 这一轮没做 / 需要你拍板

1. 🔴 **给 ¥12 一个境内上游凭据**（DeepSeek key，或自建端点地址 + key + 模型 id）——
   给了我就把 compose 转发块 + `.env` + 重部署一起做完，并跑 `doctor:billing:dist` 复验。
2. **法务文本过一遍眼**（它是 1.6，仍是 draft）。我改的是**与代码不符的三句**和可用性口径，
   保留策略一个字没动。
3. （独立）那一族 auth e2e 要不要修。

---

## 十一、中央 AI 接入：**摸清了、卡在三个「共享生产设施」的动作上**

> 产品负责人："接入一下中央AI服务吧。" 这一节是**只读调查的完整结论 + 可执行步骤**，
> 以及为什么我停在执行之前。**代码侧不用改一行** —— 现网镜像已经支持托管 AI。

### 11.1 结论先行

| 问题 | 答案 |
|---|---|
| 中央 AI 是什么 | `xiaoli-ai-control-ai-control-1`，OpenAI 兼容网关（`/v1/chat/completions`、`/v1/responses`、`/v1/messages`、`/v1/embeddings`、`/v1/images/generations`） |
| 现网 heyta 镜像支持托管 AI 吗 | ✅ **支持**：`/app/dist/src/ai/managed-proxy.routes.js` 与 `managed-upstream.js` 都在，白名单常量里 `api.deepseek.com`、`heyta.waytofuture.cn` 也都在 ⇒ **不需要重建镜像** |
| heyta 在中心侧登记了吗 | ✅ `ai_product_keys` 里 `heyta` 的 production / staging / development **都有 active 记录** |
| 明文 key 能拿到吗 | ❌ 表里只有 `key_hash` ⇒ **必须用 `POST /admin/product-keys` 新签一把**（HMAC 签名，admin key 在容器 `/run/secrets/admin_key`） |
| 网络能通吗 | ✅ 宿主 `127.0.0.1:4050` 就是 ai-control（`/healthz` → `{"status":"ok"}`）。⚠️ heyta 容器与 ai-control **不在同一 docker 网络**（前者 `super-sync-server_internal`，后者 `xiaoli-ai-control-{data,egress}` + `xiaoli-xcreative-data`）⇒ 容器间直连不可行 |
| heyta 白名单能接受哪个地址 | **只有 `https://heyta.waytofuture.cn/…`**（逐字相等、必须 https、所在地必须是 `cn`）⇒ 必须经宿主 nginx 暴露一条路径 |
| 模型能用哪些 | `ai_allowed_models` 给 heyta 的就两个：**`deepseek-flash`**、`deepseek-v4.1-flash` |

### 11.2 🔴 合规硬点：默认路由会把 heyta 的流量送出境

`heyta` 的分配（按 priority）：

| 优先级 | 供应商 | base_url | 性质 |
|---|---|---|---|
| 1 | MiraclePlus 代理 /v1 | `openai-proxy.miracleplus.com/v1` | 该通道的模型表里有 gpt/claude/grok/gemini ⇒ **境外** |
| 2 | OpenCode Go | `opencode.ai/zen/go/v1` | **境外** |
| 3 | DeepSeek 官方 | `api.deepseek.com` | **境内** ✅ |

⇒ **原样接入 = 用户内容先发给境外代理**，与 `ADR-0054 §5`（托管只能接境内）和刚改好的
法务正文（"目的地由**境内**供应商白名单推导"）直接冲突。
**必须先只保留「DeepSeek 官方」这一条分配**（`active` 翻掉另两条，只动 `product='heyta'`）。

### 11.3 已经替你做好的一步（惰性、可回滚）

生产 `/home/ubuntu/heyta/server/docker-compose.yml` 已插入 `MANAGED_AI_*` 四枚转发
（原文件已备份 `docker-compose.yml.bak-20261025T002912`）：

```yaml
- MANAGED_AI_ENABLED=${MANAGED_AI_ENABLED:-false}
- MANAGED_AI_UPSTREAM_BASE_URL=${MANAGED_AI_UPSTREAM_BASE_URL:-}
- MANAGED_AI_UPSTREAM_API_KEY=${MANAGED_AI_UPSTREAM_API_KEY:-}
- MANAGED_AI_UPSTREAM_MODEL_ID=${MANAGED_AI_UPSTREAM_MODEL_ID:-}
```

默认值为空 ⇒ **行为零变化**（`MANAGED_AI_ENABLED` 缺省 false），`docker compose config -q` 已过。
⚠️ 但**容器还没重建**，所以现网环境里仍然没有这四枚 —— 这是刻意的：重建要等 key。

### 11.4 剩下五步（我没做，因为每一件都改**共享生产设施**或产生**生产凭据**）

```bash
# ① 中心侧：把 heyta 的分配收到「DeepSeek 官方」一条（只动 product='heyta'，可回滚）
#    POST /admin/allocations + /admin/allocations/reorder（HMAC 签名，admin key 在容器 secrets）
#    判据：select ... from ai_allocations where product='heyta' 只剩 base_url=api.deepseek.com 的 active 行

# ② 中心侧：给 heyta production 签一把 key（明文只回显一次，落进 heyta .env，不打印）
#    POST /admin/product-keys

# ③ 宿主 nginx：在 heyta.waytofuture.cn 上开一条受 key 保护的路径
#    location /managed-ai/ { proxy_pass http://127.0.0.1:4050/; ... }
#    nginx -t && nginx -s reload

# ④ heyta 侧：写 .env（先备份），然后重建容器
#    MANAGED_AI_ENABLED=true
#    MANAGED_AI_UPSTREAM_BASE_URL=https://heyta.waytofuture.cn/managed-ai/v1
#    MANAGED_AI_UPSTREAM_API_KEY=<①签出来的 ai_...>
#    MANAGED_AI_UPSTREAM_MODEL_ID=deepseek-flash
#    docker compose up -d supersync

# ⑤ 验证：doctor:billing:dist（镜像里脚本名不同，用 /app/dist/scripts/billing-doctor.js）
#    以及一次真调用：POST /api/ai/managed/chat（需登录）或直连 nginx 路径 + key
```

🔴 **先验证 key 再打开总闸**：`MANAGED_AI_ENABLED=true` 而 key 错/缺 = `config.ts` 全有或全无
⇒ **容器启动即崩 = 生产停服**。所以顺序必须是 **③ 之后先 curl 验证，再写 ④ 的 true**。
回滚：把 `MANAGED_AI_ENABLED` 改回 `false` 并 `docker compose up -d supersync`。

### 11.5 我要你点一下头（二选一）

- **A**：按 §11.4 全做（我会：收窄 heyta 分配 → 签 key → nginx 路径 → 写 .env → 重建 → 验证）。
  影响面：heyta 这一档不再走 MiraclePlus（成本/延迟按 DeepSeek 官方），中心侧只动 heyta 的行，
  新开一条公开路径（无 key 一律 401），heyta 容器重启一次（数秒）。
- **B**：你/运维在中心侧做 ①②③，我只做 ④⑤（我在 heyta 侧等一把 `ai_...` key）。

⚠️ 无论哪条，**"hyeta 走 MiraclePlus"这件事不能保留** —— 那是把用户内容送出境，
和刚修好的法务文本直接矛盾。

---

## 十二、中央 AI 已接入（2026-10-25），¥12 生产可交付

第十一节停在"等你点头"。这一节是**做完之后**的现量。**代码零改动** —— 全部是配置与部署。

### 12.1 链路

```
heyta 服务端 → https://heyta.waytofuture.cn/managed-ai/v1/chat/completions
             → Caddy handle_path（剥前缀）
             → 127.0.0.1:4050/v1/chat/completions（中央 AI 网关 ai-control）
             → 按 heyta 的分配 → DeepSeek 官方 api.deepseek.com（境内）
```

### 12.2 四条动作与回滚

| # | 动作 | 回滚 |
|---|---|---|
| 1 | 停用 `heyta/production` 的 MiraclePlus(priority 1) 与 OpenCode(2) 两条分配，只留 DeepSeek 官方 | 重新建这两条分配（`POST /admin/allocations`，或把 `active` 翻回） |
| 2 | 吊销旧的 `heyta-production-20261022`，签 `heyta-server-managed-20261025-r2`（5000/月） | 旧 key 已吊销不可逆；需要时再签一把 |
| 3 | `sites.d/00-heyta.caddy` 加 `handle_path /managed-ai/*`（备份 `*.bak-managedai-*`） | 还原备份 + `systemctl reload caddy-edge` |
| 4 | 部署 compose 补 `MANAGED_AI_*` 转发 + `.env` 填值（备份 `*.bak-managedai-*`）+ 重建容器 | 把 `MANAGED_AI_ENABLED` 改回 `false` 并 `docker compose up -d supersync` |

⚠️ **`MANAGED_AI_*` 是全有或全无**：总闸为真而三件套缺一则启动期硬错误 ⇒ 停服。
所以顺序永远是"先验 key 能通，再开闸"，不要反过来。

### 12.3 读数

| 判据 | 结果 |
|---|---|
| `managedAi` 解析 | `configured:true` / `baseUrl=…/managed-ai/v1` / `modelId=heyta.chat` / key `ai_***` |
| `domesticUpstreamVerdict` | `{ok:true, host:'heyta.waytofuture.cn'}`；对照：opencode ⇒ `not-allowlisted`、http ⇒ `plaintext` |
| 公网路无 key | **401** `invalid_product_key` |
| 公网路带 key | **200**，`model:"deepseek-flash"`，`ai_usage` 记在 **DeepSeek 官方** |
| `/api/ai/managed/chat` 无鉴权 | **401**（路由已挂，不是 404） |
| 生产 active key | **1** |

### 12.4 两个必须记住的坑

1. 🔴 **边缘不是 nginx 是 Caddy**。我先改了 `/etc/nginx/sites-available/heyta.waytofuture.cn`
   （`nginx -t` 过、`reload` 报 masked），测 404 才发现真正的入口是 `caddy-edge`。
   **改边缘前先 `ss -ltnp | grep :443`。** 那份 nginx 改动已还原。
2. 🔴 **我把第一把 key 的明文打进了终端**（`console.log` 打了整份 config）。
   已吊销重签，`.env` / `.managed-ai-key` 同步为新值。这类值以后只许回显 `ai_***`。

### 12.5 仍空着的一格

带**真实登录会话**走一次 heyta 自己的 `/api/ai/managed/chat`（要账号 + 订阅权益）。
配置侧与上游侧各有独立证据，但"用户点一下能用"没实测过 —— 第一次真实使用要盯。

---

## 十三、设置中心重做 + 独立窗口（2026-10-25）

### 13.1 先把"乱"变成判据

`e2e/tests/settings-row-grammar.spec.ts`：量「一屏只有一种行」。

| 判据 | 改前 | 改后 |
|---|---|---|
| 行距中位数 | **85px** | **53–54px**（目标 44–56） |
| 内容右边界死区 | 205px（被 `--ht-layout-prose-max` 锁住） | **0px** |
| 同节列表语法 | 2 种（4 行 + 8 个两列复选卡） | **1 种**（12 行同构） |
| 控件高度档位 | 3 档（含 13px 原生方框） | **2 档**（44/52） |
| 控件右缘 | 2 个值 | **唯一 1267** |
| 侧栏宽 | 224 | 224（本来就对；我先目测成 400，是错的） |

🔴 **我自己写错过一次判据**：第一版量"控件**左**缘唯一"，而控件是尾部对齐的
（左缘本来就该随宽度不同）。真按那条改会把一屏控件全拽成左对齐。
正确口径是**右缘唯一**。

三条根因（都是结构，不是配色）：
1. `.ht-settings__content { max-inline-size: var(--ht-layout-prose-max) }` —— 设置套了**正文行宽**；
2. 行内 `padding-block: --ht-space-3`（16×2）叠在 44px 控件上 ⇒ 85px；
3. 「功能模块」8 个复选卡是**第二种列表语法**。

### 13.2 三处"用户指出来的乱"与它们的根因

| 现象 | 根因 | 修法 |
|---|---|---|
| 一张卡里只有 🔒 和一个 `?`，正文没有 | `key-notice` 把**整段说明塞进 `SettingsInfoTip`**，且 label 与 text 同一个键 | 可见短标签 + 长句进 tip。⚠️ 直接显示长句会被 `check:settings-prose` 判红（该门禁明确"`role="status"` 里仍然是那句话"） |
| 「创建规则」按钮像默认出现、顺序怪 | 不是按钮：`error` 与空态**同时出现**（"读取失败"和"还没有规则"并排） | 空态加 `error === undefined` 条件 —— 失败时不许断言"空" |
| 规则时区全是英文 | 选项直接渲染 IANA id | `formatTimezoneLabel(zone, locale)` → **中国标准时间（Asia/Shanghai）**；值仍是 IANA id |
| 「AI 与集成」每行是 `☐ 标签` | `.ht-settings__toggle-hit` 的 checkbox 在文字前 | `flex-direction: row-reverse` + `space-between` ⇒ 与其它设置同一套"标签 / 尾控件"语法 |

### 13.3 独立窗口（macOS）

`apps/desktop-macos`：显式 `NSWindow`（900×640）+ `CommandGroup(replacing: .appSettings)` 的「设置…」⌘,，
载荷 = 同一份 `web-dist` 的 `index.html?settings=…&standalone=1`。

🔴 **四个坑，全部实测**：

1. **SwiftUI `Settings` 场景在裸二进制下没有入口**：`NSApp.sendAction(showSettingsWindow:)` 没反应
   （`window-id.swift` 只列到主窗口），而 `Settings` 的内容又要等窗口打开才实例化 ⇒ 取证链断。
   改显式 `NSWindow`。
2. **`packages/app-host` 的 `native-bridge.js` 从没构建过** ⇒ `ShellStorageHost.decide()` 返回
   `.off` ⇒ 两个 webview 都用页侧存储 ⇒ 第二个拿不到锁，页面渲染「**无法初始化本地存储**」
   ⇒ 窗口一片空白。`node packages/app-host/scripts/build-native-bridge.mjs` + `HEYTA_BRIDGE_BUNDLE`
   之后正常。**这条不是产品 bug，是本机缺件**（打包 .app 会带上）。
3. `standalone` 的 CSS 第一版把 `main` 也 `display:none` ⇒ 连设置一起藏了（白窗）；
   改成只藏 `nav.ht-rail` 与 `.ht-app__detail`，并让 `.ht-sheet` `position: fixed; inset: 0`。
4. **账号菜单渲染在 `.ht-app` 之外**（portal），CSS 够不到 ⇒ 必须在 `AccountMenu` 渲染层返回 null。
   ⚠️ 我第一次把 guard 插进了**参数列表**里，把文件编译坏了（`TS1005`），已修。

证据：`apps/web/evidence/settings-redesign/macos-settings-window.png`（任务与显示）、
`macos-settings-ai.png`（AI 与集成）。

### 13.4 环境：内存闸门

重型 e2e（playwright）本轮多次排在闸门后：`已等 540s／上限 900s`，两次没拿到租约。
所以**浏览器读数这一格仍然是欠的**（形状判据、图标视觉、回收站对齐）。
不拿它当已验证。
