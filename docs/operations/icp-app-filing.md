# APP 备案填报单（腾讯云 · 工信部 APP 备案）

> 主体：**晓黎（杭州）人工智能科技有限公司**（统一社会信用代码 `91330106MAKNJ6DX7M`）
> 备案订单：`30179057320250614`（新增服务 · 草稿）· 控制台：<https://console.cloud.tencent.com/beian>
> 本轮范围：**安卓平台 + 苹果平台**（鸿蒙后补 —— 华为实名认证审核未通过，见 §7）
> 最后更新：2026-09-28

📌 **这份文档是"这一次的记录"；可复用的流程已经固化成 Skill：**
[`.agents/skills/tencent-cloud-icp-app-filing/`](../../.agents/skills/tencent-cloud-icp-app-filing/SKILL.md)
—— 换一个项目/换一台机器时看那份（含四个字段的格式规范、控制台的浏览器手法、五个反直觉的坑）。
**实现只有一份**：脚本实体在 Skill 的 `scripts/` 下，本仓库的 `scripts/icp-app-filing-values.mjs` 只是薄封装。

📌 **取值不要手抄。** 下面每一个值都由
[`scripts/icp-app-filing-values.mjs`](../../scripts/icp-app-filing-values.mjs) 从**证书本身**重算：

```bash
node scripts/icp-app-filing-values.mjs          # 人看的对照表
node scripts/icp-app-filing-values.mjs --json   # 机器读
```

这条纪律来自一次真实事故：本文件第一版用自写的 PEM 切片算指纹，多丢了一行 base64，
**三张证书的指纹全错，而且错得很像真的**（位数、格式都对）。所以脚本现在**故意**用
Node `crypto` 和 `openssl` 两套独立实现算同一个值并比对，不一致就拒绝输出。

---

## 1. 当前进度

| 步骤 | 状态 |
|---|---|
| 主体信息 | ✅ 草稿里已就绪（复用已有主体，未改动） |
| 服务名称 / 服务内容 / 备注 | ✅ 已填 |
| 应用运行平台 | ✅ 安卓平台 + 苹果平台 |
| 域名 | ✅ `waytofuture.cn`（两个平台各一条） |
| 包信息（包名 + 公钥 + 签名值） | ✅ 两行都已「验证」通过并入库 |
| 负责人信息 | ✅ 由「复用负责人信息模版」自动带出，与下方值逐字一致 |
| 证件照（人像面 / 国徽面） | ✅ 均已上传 |
| APP 图标 | ✅ 已上传 `apps/web/public/icons/icon-512.png` |
| **视频核身** | ✅ 已完成（用户本人，2026-09-28） |
| **联系方式1 短信验证码** | ✅ 已完成（用户本人） |
| 保存 | ✅ 表单已自动保存；服务状态从「信息待编辑」变为**「正常」** |
| 预览核对 | ✅ 已到第 4 步预览页，17 项逐项比对**全部一致**（见 §8） |
| 提交初审 | ⏸️ **用户决定暂不提交（2026-09-28）** —— 四步已全部就绪，停在预览页等用户。`提交审核` 需先勾选法律同意框，未勾时是**灰色不可点**的 |

> ⚠️ **域名最终填的是 `heyta.waytofuture.cn`**（不是我最初填的 `waytofuture.cn`）——
> 用户把三级域名细化成了实际要用的那个。二级域名仍是 `waytofuture.cn`，
> 其实名主体是杭州公司，**仍然满足"二级域名实名信息需与备案主体一致"**。

---

## 2. 最终填报值（两个平台）

### 2.1 通用

| 字段 | 值 |
|---|---|
| 服务名称(APP) | `heyta` |
| 服务内容(APP) | 信息传输、软件和信息技术服务业 → **软件开发** |
| 服务语言 | 中文简体 |
| 对外提供 SDK | 不提供 |
| 使用外部 SDK | 不使用 |
| 前置审批类型 | 以上都不涉及 |
| 云资源 | 轻量应用服务器 · `124.223.13.226` |
| 域名 | `waytofuture.cn` |
| 服务负责人 | 邓湘雷 · 证件号 / 两个手机号 / 邮箱见 [`icp-app-filing.values.local.md`](icp-app-filing.values.local.md)（**已 gitignore，不入库**）· 证件有效期 2026.06.18–2036.06.18 |

备注（≥15 字，已填）：

> heyta 是一款个人任务管理工具类应用，提供任务的记录、分类、清单归属、标签、专注计时与已完成归档功能，
> 帮助用户管理日常待办与个人事务。应用数据默认保存在用户设备本地，登录后可选择同步到自有服务器。
> 不涉及新闻、出版、视听、游戏、金融等需前置审批的业务。

### 2.2 安卓平台

| 字段 | 值 |
|---|---|
| App包名 | `com.heyta` |
| 公钥（**10 进制**模数，1233 位） | `658808503626053372327914224136080771407802175981430134082611502024507423292772199097401732446411642782783678053681503759094933413757089234719011889870741498343773244174819800070007541731022409950156389791322940910733676605120591952626323989920908005274254859920060191166251750726049670115937098220767348132137957689090637952930560683442653099672486641624553311462415483507270799867816880392629693511964621155528765714321443398102752068864034605197789287743077369966326449196888592473695789586413279239397842214953400580116107994974515351340137897286977983388639233340974291359007045592022151065248428719132881183895189511758236125215117117014082381191960235678190776972775664089297921478236942640747706968566930802093195080670550758685837719215307337614224550912455564098651643206967498971088703379398019517894992496020708795194187517989538840823707779742664964107329824750464834612211159901542440028117664882646467034997387139912042480778641633041350406253343153937160051713218256938640213840453506187103893577784036300516931633636442665759653734408658929238675569269316260627326909486641862385502792339976271745464645445500462684911611981554151184957017350838755850546775040021633134806780951377948993392794523296776242887353130179` |
| 签名MD5值（32 位，去冒号） | `228708966FFD3F96A92D5C879FE7B2A9` |
| 签名证书 | `C=CN, ST=Zhejiang, L=Hangzhou, O=Xiaoli Creativity Culture Industry, OU=Mobile, CN=heyta` |
| 证书有效期 | Sep 28 06:04:26 2026 GMT → Feb 13 06:04:26 2054 GMT |

比对用（带冒号）：MD5 `22:87:08:96:6F:FD:3F:96:A9:2D:5C:87:9F:E7:B2:A9` · SHA-1 `54:B7:0E:92:13:CE:92:39:7A:6F:F0:EE:FE:39:5F:2B:AA:0B:9A:3A`
（与 `keytool -printcert` / `openssl x509 -fingerprint` 双向一致）

### 2.3 苹果平台

| 字段 | 值 |
|---|---|
| Bundle ID | `com.heyta` |
| 公钥（**16 进制**模数，512 位） | `9614645280AE2E2D80275688420BCA34C67C7CC2C4606DA354EE68BCF92209F3B61E3171D14B5BBD52D83A6E888C137F2E4AB1E2C496F3E00FB94E713F44439EB5DDA6C61211E71C3BF17B683D12AFC2630F0BC51FF63B370501CB96F1E3AA454632DEF25B4B6CF03C98E58606EEA223D085165ADC0CD0430905366EE30B8BEA9AB9AFC306B14A84CAE0C22328F4E7576A16A5C593D42E7A600BA38CA41C60629403B3B8D9B8C289C72ADD2B692F21C716D48579B133C5839FC871C1F44767EA95F4CBABC58146172393555075F1F271D384A24BA9AAE12060A28D1F1CDA4F625F4B3F190C9E9601DB78BB5F28E185DE7BA7FA9BB40EB92D5662A6B5E391449B` |
| 签名MD5值 | 🔴 **填证书的 SHA-1（40 位，去冒号）**：`79515208578A810F82C89E5A3D482437DC2DEF26` |
| 签名证书 | `UID=V5S2LT9YV8, CN=Apple Distribution: Xiaoli Creativity Culture Industry Development (beijing) Co.\, Ltd. (V5S2LT9YV8), OU=V5S2LT9YV8, O=Xiaoli Creativity Culture Industry Development (beijing) Co.\, Ltd., C=US` |
| 证书有效期 | Jun 19 06:25:29 2026 GMT → Jun 19 06:25:28 2027 GMT |

比对用（带冒号）：SHA-1 `79:51:52:08:57:8A:81:0F:82:C8:9E:5A:3D:48:24:37:DC:2D:EF:26` · MD5 `9D:E3:FE:22:16:8A:8C:FE:1B:FF:97:D4:EB:1E:BB:6D`（备案**不用** MD5）

---

## 3. 🔴 三个纠正过的认知（都是本来会打回的坑）

### 3.1 「平台公钥」不是 base64，是**模数**

第一版把 `openssl x509 -pubkey` 的 PEM 正文当公钥，**格式就不对**。
腾讯云规范：<https://cloud.tencent.com/document/product/243/97789> ——
「APP 特征信息中的平台公钥，以 **10 进制或 16 进制**形式填写」。

把该页的官方截图下载下来直接看，红框标的正是：

- **安卓（jadx-gui）**：`公钥类型 RSA` / `指数 65537` / `模数大小（位）` / **`模数: 9187796948092…`** ← 红字标注「公钥」
- **苹果（Keychain 证书详情）**：`公共密钥  256字节  BB 8B 38 FD 9…`

⇒ **公钥 = 证书里的「模数」（modulus），不含指数。** 两个平台的自然形态不同：
安卓来自 jadx，是 **10 进制**；苹果来自 Keychain，是 **16 进制**。腾讯云两种都收。

### 3.2 苹果的「签名MD5值」字段，要填的是 **SHA-1**

字段名叫 MD5，规范却写「**苹果版 APP：请填写证书的 SHA-1 值**」，
表单 placeholder 也是「请输入 **40 位**长度的 SHA-1 值」。按字段名猜会填成 32 位 MD5 → 打回。

- 安卓 → 证书 **MD5**（32 位）
- 苹果 → 证书 **SHA-1**（40 位）

### 3.3 域名的**实名主体**必须与备案主体一致 —— `finlaw.cloud` 不符合

`heyta.finlaw.cloud` 是 heyta 当时的线上域名，本来打算直接填。查下来：

| 域名 | 实名主体 | 与备案主体一致？ |
|---|---|---|
| `finlaw.cloud` | 晓黎创意文化产业发展（**北京**）有限公司 `91110108MAD6K3UL6K` | 🔴 **否** |
| `waytofuture.cn` | 晓黎（**杭州**）人工智能科技有限公司 `91330106MAKNJ6DX7M` | ✅ **是** |

表单自己也写着：「二级域名实名信息**需与备案主体保持一致**」。
⇒ 本轮改用 `waytofuture.cn`。**代价与后续**：APP 后台要真的切到 `waytofuture.cn` 的子域，
否则填报内容与事实不符（`finlaw.cloud` 若要继续用，得先把它过户到杭州公司）。

复核命令（只读，域名分别在两个腾讯云账号下）：

```bash
tccli domain DescribeDomainSimpleInfo --Domain finlaw.cloud    --profile default
tccli domain DescribeDomainSimpleInfo --Domain waytofuture.cn  --profile waytofuture
```

---

## 4. 改名：`HeytaMobile` / `com.heyta.mobile` / `com.heytamobile` → **heyta / com.heyta**

产品就叫 **heyta**，不带 `mobile` 后缀。本轮做了外科手术式改名（**不搬代码包目录、不重命名 Xcode target**）：

| 层 | 改动 | 说明 |
|---|---|---|
| 安卓 `applicationId` | `com.heytamobile` → `com.heyta` | **这才是备案要的「App包名」** |
| 安卓 `namespace` / Kotlin `package` | **保持不变** `com.heytamobile` | 内部代码命名空间，不是应用身份；改它要搬 30 个文件、对备案零收益 |
| iOS `PRODUCT_BUNDLE_IDENTIFIER` | `com.heyta.mobile` → `com.heyta`（含 `.WidgetExtension`） | |
| iOS Xcode target / 目录名 | **保持不变** `HeytaMobile` | 内部名字，不出现在应用身份里 |
| iOS App Group | `group.com.heyta.mobile` → `group.com.heyta` | entitlements ×2 + `WidgetSharedConstants.swift` |
| 显示名 | `HeytaMobile` → `heyta` | iOS `CFBundleDisplayName`、安卓 `app_name`、启动页文案、`app.json` |
| RN 模块名 | `HeytaMobile` → `heyta` | **三处必须同步**：`app.json` 的 `name` / `AppDelegate.swift` / `MainActivity.kt` |
| 鸿蒙 `bundleName` | `com.heyta.mobile` → `com.heyta` | 仅改配置（本轮不报鸿蒙） |
| E2E 脚本 | `scripts/lib/mobile-e2e.sh` 的 `PKG` + 5 个 `verify-mobile-*.sh` 的数据目录 | |

🔴 **签名证书不随包名变**：改完重新出包后，签名证书的 SHA-256 与改名前**逐字节相同**
⇒ 公钥与指纹**不需要重算**。改完两个产物都实测确认过：

| 产物 | 包名 / label | 证书 SHA-256 | 结论 |
|---|---|---|---|
| `app-release.aab` | `com.heyta`（merged manifest） | `C46D0386…062556` | 与改名前相同 |
| `app-release.apk` | `com.heyta` / label `heyta`（`aapt2 dump badging`） | `c46d0386179c3cef12582d1347ed2f871eb03a64aaa2bff96511c1cb76062556` | 与 AAB 相同 |

且**三个独立工具**对同一张证书给出的指纹一致（这是本仓库"指纹必须两个工具对得上"那条纪律的加强版）：

```
openssl x509 -fingerprint -md5      → 22:87:08:96:6F:FD:3F:96:A9:2D:5C:87:9F:E7:B2:A9
keytool -printcert（SHA-1/256）      → 54:B7:0E:… / C4:6D:03:…
apksigner verify --print-certs       → MD5 228708966ffd3f96a92d5c879fe7b2a9  ← 与已填备案值逐字相同
```

⚠️ **教训**：Release APK 只做 v2/v3 签名，**没有** `META-INF/*.RSA`，
`unzip "META-INF/*.RSA"` 会报 `filename not matched` —— 看起来像"没签名"。
**APK 要用 `apksigner verify --print-certs`**（在 Android SDK 的 build-tools 里）。

⚠️ **仍未做（改名带来的后续，不是本次备案的阻塞项）**：
ASC 需要为 `com.heyta` / `com.heyta.WidgetExtension` 新建 App ID 与 App Group、
重建 App Store profile（`archive-release.sh` / `export-ipa.sh` 里的名字已同步改好，
但 profile 本身要重新申请），已有的 TestFlight 包作废。

---

## 5. 复现：每个值都可以自己再算一遍

```bash
# 一键出全部（推荐）
node scripts/icp-app-filing-values.mjs

# ── 安卓：从已签名 AAB 的签名块里取签名者证书（不需要密钥库口令）
unzip -o -q apps/mobile/android/app/build/outputs/bundle/release/app-release.aab "META-INF/*.RSA" -d /tmp/aab
openssl pkcs7 -inform DER -in /tmp/aab/META-INF/HEYTA.RSA -print_certs -out /tmp/aab/cert.pem
keytool -printcert -file /tmp/aab/cert.pem                       # SHA1/SHA256
openssl x509 -in /tmp/aab/cert.pem -noout -fingerprint -md5      # MD5（JDK21 不再打印它）
openssl x509 -in /tmp/aab/cert.pem -noout -modulus               # 模数（=「公钥」），hex

# ── 苹果：钥匙串里的 Apple Distribution 证书
security find-identity -v -p codesigning
security find-certificate -a -c "Apple Distribution" -p
```

出包（🔴 打包前必须先 `pnpm -r build`）：

```bash
pnpm -r build
pnpm --filter @heyta/mobile run build:android:bundle   # → app-release.aab
pnpm build:android                                     # → app-release.apk（给国内商店）
```

🔴 **漏跑 `pnpm -r build` 的症状很容易误判成"改名改坏了"**：
`:app:createBundleReleaseJsAndAssets` 失败，Metro 报
`While trying to resolve module @heyta/i18n … dist/index.js. Indeed, none of these files exist`。
根因是 `packages/*/dist` 不存在（AGENTS.md §6.1 早就写了"打包前必须先 `pnpm -r build`"），
**与包名/改名无关**。判据：
`for p in i18n domain ui …; do ls packages/$p/dist; done` —— 缺 dist 就先 `pnpm -r build`。

---

## 6. 人工步骤：已完成

1. ~~视频核身~~ ✅ 用户本人完成（控制台显示「文件已上传 / 重新核验」）。
2. ~~联系方式1 短信验证码~~ ✅ 用户本人完成。
3. ~~点「下一步，上传补充材料」~~ ✅ 已到第 4 步预览页。

「补充材料」那一步是**选填** —— 控制台自己写着
「如未被要求或无上传补充材料的需求，请点击下一步」，所以直接跳过。

**只剩最后一下**：勾选「我已阅读并同意《腾讯云隐私声明》《相关条款》《互联网信息服务备案承诺书》」
→ 点 **`提交审核`**。⚠️ 未勾选时该按钮是**灰色不可点**的，不会误触。
**这一步必须用户明确确认后才做。**

---

## 7. 为什么本轮不报鸿蒙

- 华为开发者账号的**实名认证审核尚未通过**，不能建应用/证书/Profile。
- 本仓鸿蒙端目前只构建出**未签名**的 `entry-default-unsigned.hap`
  （`apps/mobile/harmony/build-profile.json5` 的 `signingConfigs` 是空数组），
  拿不到公钥与指纹，硬填就是假值。
- 等实名过了、签名配好、出得来正式 HAP，再在**同一订单**上「新增服务」增项。

---

## 8. 预览核对（提交前最后一次对账）

第 4 步预览页的值，与 `scripts/icp-app-filing-values.mjs` 从**证书本身**重算的值
**17 项逐字比对，全部一致**：

| # | 项 | 判据 |
|---|---|---|
| 1 | 服务名称(APP) | `heyta` |
| 2 | 服务内容(APP) | `软件开发` |
| 3 | 对外提供SDK | `不提供` |
| 4 | 使用外部SDK | `不使用` |
| 5 | 前置审批类型 | `以上都不涉及` |
| 6 | 服务器资源 | `124.223.13.226` |
| 7 | 域名（两个平台） | `heyta.waytofuture.cn` ×2 |
| 8 | 安卓 App包名 | `com.heyta` |
| 9 | 安卓 公钥（10 进制） | 1233 位，**逐字** |
| 10 | 安卓 签名MD5值 | `228708966FFD3F96A92D5C879FE7B2A9` |
| 11 | 苹果 Bundle ID | `com.heyta` |
| 12 | 苹果 公钥（16 进制） | 512 位，**逐字** |
| 13 | 苹果 签名MD5值（=SHA-1） | `79515208578A810F82C89E5A3D482437DC2DEF26` |
| 14 | 负责人姓名 | `邓湘雷`（主体与 APP 两处都在） |
| 15 | 证件号码 | 见 [`icp-app-filing.values.local.md`](icp-app-filing.values.local.md)（两处同值；不入库） |
| 16 | 电子邮箱 | 同上本地文件（两处同值；不入库） |
| 17 | 法律同意勾选框 | 存在（未勾时 `提交审核` 不可点） |

复现这个核对的方法：把预览页正文抽出来，然后
`node scripts/icp-app-filing-values.mjs --json` 拿到权威值，两者做**字符串全等**比较
（`in` 判断，不是"看起来差不多"）。

