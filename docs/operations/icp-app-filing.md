# APP 备案填报单（腾讯云 · 工信部 APP 备案）

> 主体：**晓黎（杭州）人工智能科技有限公司**
> 服务器：轻量应用服务器 `124.223.13.226`（微信云/腾讯云，nginx → heyta 容器）
> 采集时间：2026-09-28　采集人：agent（每条值都带来源与复现命令）

📌 **更正（2026-09-28，我自己的错）**：第一版我写"**没有域名**"—— **那是错的**。
我搜索时正则只列了 `.com|.cn|.net|.app|.io`，**漏了 `.cloud`**，于是没搜到 `heyta.finlaw.cloud`。
域名一直存在。⇒ 一个教训：**"没搜到"不等于"不存在"**，尤其是自己写的、带 TLD 白名单的搜索。

⚠️ **这份文件只做两件事**：把**能算出来的**算准，把**算不出来的**明确列出来。
**没有任何一条是猜的** —— 算不出来的那些宁可留空，也不填一个像样的假值：
备案是法律声明，填错的指纹/域名会在审核环节被打回，返工成本远高于现在多问一句。

---

## 1. 🔴 两个硬阻断 + 一个已解决

| # | 阻断 | 事实 | 需要谁定 |
|---|---|---|---|
| ~~**B1**~~ | ✅ **已解决：域名就是 `heyta.finlaw.cloud`** | 见 [deployment.md](../runbooks/deployment.md)：`DNS: heyta.finlaw.cloud → A 124.223.13.226`（RecordId 2419295096），nginx 站点 `sites-enabled/heyta.finlaw.cloud` 是**当前唯一域名**（2026-09-27 起）。⚠️ **待确认**：域名实名主体是否就是「晓黎（杭州）人工智能科技有限公司」—— 备案要求域名实名主体与备案主体一致，否则需要域名授权书 | 你（确认域名实名主体） |
| **B2** | **Android 用的是测试签名** | AAB 的签名证书主体是 `CN=heyta test upload, O=heyta, C=CN` —— 这是**测试上传密钥**，不是发布证书。而且 `app-release.apk` **根本没签名**（`META-INF` 里 0 个签名文件） | 你（确定走 Google Play 应用签名 / 还是自有发布密钥） |
| **B3** | **iOS 没有发布签名产物** | 本机只有 `Debug-iphonesimulator` 的 `.app`（模拟器）；**没有** `.ipa` / `.xcarchive`。而钥匙串里有**两张**都有效的 `Apple Distribution` 证书 → 现在无法确定哪一张会签正式包 | 你（跑一次 Archive，或告诉我用哪张） |

另外两条**产品决策**（不是阻断，但会影响填法）：

- **应用真实显示名是 `HeytaMobile`**（iOS `CFBundleDisplayName`、Android `app_name` 都是它）。
  备案的「服务名称(APP)」应当**与图标下方显示的名字一致** ⇒ 要么填 `HeytaMobile`，
  要么**先把 App 里改成 `heyta` 再备案**。你之前说"忽略晓黎学习、用我们自己的名称"，
  所以这里我按真实的 `HeytaMobile` 给，想换成 `heyta` 的话得同步改三端。
- **桌面两端现在没有可备案的包名**：Linux 原生壳还没做；Windows 有 WinUI 3 壳但**没有 MSIX 标识**。
  ⇒ 建议这一轮**只备案 安卓 / 苹果 / 鸿蒙**，桌面等有正式包名了再增项。

---

## 2. 可以直接填的（附来源）

### 2.1 基本信息

| 字段 | 值 | 来源 |
|---|---|---|
| 主体 | 晓黎（杭州）人工智能科技有限公司 | 你的截图 |
| 服务名称(APP) | **HeytaMobile** | `apps/mobile/ios/HeytaMobile/Info.plist` → `CFBundleDisplayName`；`android/.../values/strings.xml` → `app_name` |
| 服务语言(APP) | 中文简体 | 你的截图 |
| 云资源 | 轻量应用服务器 · `124.223.13.226` | 你的截图 |
| 对外提供SDK | **不提供** | 仓库里没有对外发布的 SDK 产物 |
| 使用外部SDK | **不使用** | 依赖清单里没有地图/支付/推送等第三方 SDK（微信支付是服务端调 `api.mch.weixin.qq.com`，不是 App 内 SDK） |
| 前置审批 | **以上都不涉及** | 无新闻/出版/教育/医疗等前置审批业务 |
| 服务负责人 | 邓湘雷 · 430381200307030011 · 2026.06.18–2036.06.18 · 13077328906 · 19279070348 · xaiverlight@163.com | 你的截图 |
| 域名 | **`heyta.finlaw.cloud`** | [deployment.md](../runbooks/deployment.md)：`A 124.223.13.226`，nginx 站点已启用 |

**备注**（≥15 字，可直接用）：

> heyta 是一款个人任务管理工具类应用，提供任务的记录、分类、清单归属、标签、专注计时与
> 已完成归档功能，帮助用户管理日常待办与个人事务。应用数据默认保存在用户设备本地，
> 登录后可选择同步到自有服务器。不涉及新闻、出版、视听、游戏、金融等需前置审批的业务。

### 2.2 各平台包信息

| 平台 | 包名 / Bundle ID | 指纹 | 来源 |
|---|---|---|---|
| 安卓 | `com.heytamobile` | **MD5 `7B:AF:77:DF:13:C2:0F:66:18:60:78:19:BD:3F:8A:E3`**<br>SHA1 `D8:A4:31:8D:68:07:F6:F3:9C:F1:D8:C2:FC:16:0C:C4:39:90:1C:53`<br>SHA256 `CB:CA:3A:05:13:68:3D:2F:43:07:4A:0E:A7:C4:5A:B4:83:63:59:E2:E7:3E:9B:B7:C8:70:D4:78:EF:A2:92:60` | `applicationId`；指纹从 `app-release.aab` 的 PKCS#7 里取的证书（见 §3 复现） |
| 苹果 | `com.heyta.mobile` | **SHA-1 见 B3**（两张候选：`35:28:80:81:C9:02:1E:14:B1:1B:8A:B2:B1:4D:12:DD:34:8B:27:EB` / `79:51:52:08:57:8A:81:0F:82:C8:9E:5A:3D:48:24:37:DC:2D:EF:26`） | `project.pbxproj` → `PRODUCT_BUNDLE_IDENTIFIER`；证书来自本机钥匙串 |
| 鸿蒙 | `com.heyta.mobile` | 鸿蒙侧一般填包名 + 签名证书；**待你确认鸿蒙的签名方式** | `AppScope/app.json5` → `bundleName` |
| LINUX | ⬜ 暂不填报 | — | 原生壳未完成（计划 §4） |
| windows | ⬜ 暂不填报 | — | 无 MSIX 标识 |

⚠️ **安卓与苹果/鸿蒙的包名不一致**（`com.heytamobile` vs `com.heyta.mobile`）。
规则允许不同平台用不同包名，所以**不是错误**；但同一产品建议统一，否则将来对账、
推送、统计都要记两套。要不要统一由你定（改 Android 的 `applicationId` 会影响已发出去的包）。

### 2.3 APP 图标

| 候选 | 文件 | 规格 | 判断 |
|---|---|---|---|
| ✅ 推荐 | `apps/web/public/icons/icon-512.png` | 512×512 PNG，8.9 KB | 尺寸/格式/体积都合规（限 jpg/jpeg/png，≤9 MB） |
| 备选 | `apps/mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` | Android 真实应用图标 | 与 App 实际图标一致，更适合 |

🔴 **iOS 的 `AppIcon.appiconset` 里只有 `Contents.json`，一张图都没有** —— 也就是说
iOS 包**没有应用图标**。这不只影响备案，上架 App Store 也会被拒。

---

## 3. 复现命令（每一个值都能自己再算一遍）

```bash
# ── 安卓：从 AAB 的签名块里取**签名者证书**（不需要密钥库密码）
unzip -o -q apps/mobile/android/app/build/outputs/bundle/release/app-release.aab "META-INF/*.RSA" -d /tmp/aab
openssl pkcs7 -inform DER -in /tmp/aab/META-INF/HEYTATES.RSA -print_certs -out /tmp/aab/cert.pem
keytool -printcert -file /tmp/aab/cert.pem              # ← SHA1 / SHA256 以这个为准
openssl x509 -in /tmp/aab/cert.pem -noout -fingerprint -md5   # ← MD5（JDK21 不再打印它）

# ── 苹果：本机钥匙串里的 Apple Distribution 证书
security find-identity -v -p codesigning                # 列出可用签名身份
security find-certificate -a -c "Apple Distribution" -p | openssl x509 -noout -fingerprint -sha1
```

### 🔴 我在这一步算错过一次，值得记下来

我第一版用 Python 直接从 PEM 解码 DER 再算指纹，切片写成了 `split('\n')[1:-2]` ——
**多丢了最后一行 base64**，于是 DER 变了、**三张证书的指纹全是错的**，而且错得很像真的
（位数、格式都对）。是 `keytool` 报的 SHA1 和我算的对不上，才发现的。

⇒ **指纹这类值必须两个工具对得上才算数**（`keytool` + `openssl`，或 `apksigner`）。
单工具自算自验会给出"看起来很可信"的错值。正确的切片是 `lines[1:-1]`。

---

## 4. 你做完这几件事，剩下的我就能填完

1. ~~给一个域名并解析到 124.223.13.226~~ ✅ 已有：**`heyta.finlaw.cloud`**。改为**确认该域名的实名主体**就是备案主体。
2. **确定安卓发布签名**：是走 Google Play 应用签名（那要填 Play Console 里"应用签名密钥证书"的 MD5，
   不是这个上传密钥），还是自有发布密钥（那就用正式 keystore 重新出包，我再取一次指纹）（B2）。
3. **跑一次 iOS Archive**（或告诉我用哪张 Apple Distribution 证书）（B3）。
4. 确认 **服务名称** 用 `HeytaMobile` 还是改成 `heyta`（要改的话我同步改三端）。
5. 在表单里从**实际下拉选项**里选「服务内容(APP)」的叶子分类（这个我猜不得，得看真实选项列表）。
6. 视频核身 + 上传图标（这些只能你本人做）。
