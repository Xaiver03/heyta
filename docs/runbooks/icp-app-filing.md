# ICP APP 备案（工信部）操作手册 —— heyta

> 元信息：创建于 2026-09-29。渠道：腾讯云 APP 备案。
> 操作类 Skill（字段规范 / 控件手册 / 驱动器）：`ssos/.agents/skills/tencent-cloud-icp-app-filing/`
>（heyta 侧是符号链接 `​.agents/skills/tencent-cloud-icp-app-filing`，真身在 SSOS —— SSOS 治理规则：真身才归 SSOS 自有，符号链接视为外部依赖）。

本文记录：**各平台特征信息的取值方法与实测值**（公开值，可入档）、
登录/自动化环境、以及备案进度。**口令、私钥、cookie 一律不进本文。**

---

## 一、进度总览

| 平台 | 包名 | 平台公钥 | 签名指纹 | 状态 |
|---|---|---|---|---|
| 鸿蒙 | ✅ `com.heyta.app`（AGC 已注册） | ✅ 已取（AGC 备案信息弹窗三源一致） | ✅ SHA-1 已取 | ✅ 取值齐备，待填表 |
| 安卓 | 未开始 | — | — | 未开始 |
| 苹果 | 未开始 | — | — | 未开始 |

### 腾讯云备案草稿状态（2026-09-30 更新）

- 订单 `30179057320250614`（新增服务，2026-09-28 建），主体=晓黎（杭州）人工智能科技有限公司（浙ICP备2026081423号，与华为账号主体一致 ✅）。
- 草稿里已有：主体信息（完整）、APP「heyta」服务信息、**安卓平台**（`com.heyta`，域名 `heyta.waytofuture.cn`）、**苹果平台**（同域名）、负责人材料。
- ✅ **2026-09-30 已补入鸿蒙平台**：域名 `heyta.waytofuture.cn`，包信息 `com.heyta.app` / 公钥 `040a1de6…c70a` / SHA-1 `866b9c3c…7373`，「验证」通过，「保存服务」已保存（重新打开表单复核过）。
- ⚠️ 域名用的是 `heyta.waytofuture.cn`（本主体已备案主域 `waytofuture.cn` 的子域），**不是** `heyta.finlaw.cloud` —— 这避开了 §四 的域名实名主体不一致坑；**同时要求该子域真的指向已备案的腾讯云服务器**（草稿云资源 124.223.13.226），服务与填报要一致。
- **下一步（交还用户）**：✅ 已推进到第 4 步「信息预览与提交备案」（2026-09-30），三平台信息已在预览页逐项核对无误（用户授权"可点、只保存、不提交"）。
  **「提交审核」按钮就差用户本人一点** —— 点之前页面会要求勾选《备案承诺书》等三个同意项。提交后还有：腾讯云审核 1–2 个工作日 → 工信部 24h 短信核验（本人）→ 管局审核。

🔴 **heyta 用的 AGC 账号是 `hid78288024`（晓黎（杭州）人工智能科技有限公司，2026-09-29 登录核实）。
账号内另有「晓黎学习」（`cn.waytofuture.ai`，用户本人创建）与 `xiaoli-learning-release` 证书 —— **同账号双产品，操作时不要动别人的记录**。
本机已有的另一张发布证书（§2.4）是 SSOS 的华为账号（晓黎创意文化产业发展（北京）有限公司）签发的 ——
⚠️ 两张证书分属两个账号，§2.4 的取值**不能**用于 heyta 备案**，只作为取值方法与格式的实证。

### ✅ 鸿蒙备案取值（终版，2026-09-29 实测，三源一致）

**三源**：Node `crypto`、`openssl`、AGC「证书 → 备案信息」弹窗 —— 三者逐字一致才录入此处。

| 备案字段 | 值 |
|---|---|
| 应用包名 | `com.heyta.app` |
| 平台公钥（ECC P-256 非压缩点，130 hex，AGC 原样小写） | `040a1de66ca62c08e64d7b038dc3e82aa23bcc31b4e31ab6c06691b852594965a4a80b39026d293a5b4a8cd15d0fff4559e4dd80664fb682cf32be57e4bbd3c70a` |
| 「签名MD5值」栏（= 证书 **SHA-1**，40 位） | `866b9c3c0dafbeab4138d9c358b08bf0c7346373` |
| 叶证书 SHA-256（备查） | `393DAB29C2808490384295405A05B6027783D883527D8CB8369D98D5C4D180BD` |
| 叶证书 subject | `C=CN, O=晓黎（杭州）人工智能科技有限公司, OU=2050388399419874177, CN=…(2050388399419874177)\\,Release` |
| 证书有效期 | 至 2029-09-29 |

配对验证：叶证书公钥 == 本地 CSR 公钥（SPKI DER 逐字节一致）→ 该证书与本地私钥配对，可用于签名。

**AGC 侧实体**（2026-09-29 创建）：

| 实体 | 值 |
|---|---|
| APP ID | `6917617738050571851`（heyta / com.heyta.app / 发布） |
| 应用记录 | 「heyta」，支持设备=手机，默认语言=简体中文，状态=准备提交 |
| 发布证书 | `heyta-release`（由本地 CSR 签发，`.cer` 已下载至 `/tmp/heyta-agc/`） |

备案四步（腾讯云把一条备案拆成）：① 前置事实核查 → ② 特征信息取值 → ③ 填表 → ④ 人工环节（视频核身等，只能本人）→ ⑤ 预览与提交。
**绝不自动点「提交初审」** —— 必须用户看完核对结论后明确确认（Skill 硬闸门）。

---

## 二、鸿蒙（HarmonyOS）特征信息取值 —— 实测 2026-09-29

### 2.1 证书从哪来

- 来源：华为 AGC（AppGallery Connect）签发的**发布证书链**，本地存于
  `~/Library/Application Support/ssos/signing/harmonyos/ssos-harmony-release.cer`（同目录 `.p12` 是私钥，**只取公开值时不需要碰它**）。
- ⚠️ **这个 `.cer` 里有 3 张证书**（根 CA → 中间 CA → 叶证书）。`openssl x509 -in <file>`
  **只解析第一张**，而第一张恰好是根证书 —— 直接跑会得到根证书的指纹，
  **错得很像真的**。必须先按 `-----BEGIN CERTIFICATE-----` 切开、认出叶证书再算。

### 2.2 证书身份（2026-09-29 实测）—— ⚠️ 属 SSOS 账号，不是 heyta 的

- 主体：`C=CN, O=晓黎创意文化产业发展（北京）有限公司, OU=1958681377943588481, CN=…(1958681377943588481)\\,Release`
  —— 这是 **SSOS 华为开发者账号的实名主体**。
- 签发链：`Huawei CBG Developer Relations CA G2` → `Huawei CBG Root CA G2`。
- 🔴 heyta 的 AGC 账号是**杭州公司**（见 §一），证书主体必须与发布它的账号一致 ——
  **这张证书的值不能填进 heyta 的备案**。它在本节保留，是因为它实证了格式（下节）。

### 2.3 🔴 华为发布证书是 ECC（P-256），不是 RSA

实测 `openssl x509 -text`：`Public Key Algorithm: id-ecPublicKey, 256 bit`（曲线 `prime256v1`）。

后果：

1. **「模数」不存在**（`openssl x509 -noout -modulus` 直接报
   `No modulus for this public key type`；Node 的 JWK 导出里也没有 `n`）。
   Skill 总表里"鸿蒙公钥=模数"那一格只对 RSA 证书成立 —— 以本文实测为准。
2. 腾讯官方规范（[243/97789](https://cloud.tencent.com/document/product/243/97789)）鸿蒙一节的取法：
   从 AGC「证书、APP ID 和 Profile」下载**应用开发者证书** →
   **删掉证书链部分、只留叶证书** → 打开证书详细信息：
   - **「公钥」→ 平台公钥**。ECC 证书在系统证书查看器里显示的公钥就是
     **非压缩曲线点**（`04 || X || Y`，65 字节 / 130 个 hex 字符）。
     ⚠️ 表单最终接受什么形态（带不带前导 `04`、要不要冒号分隔）**未核实** —— 填表时先按查看器原样，被拒再调。
   - **「指纹」→「签名MD5值」栏**。官方原文注明：**"这里的指纹是 SHA1 指纹，可以通过它作为 MD5 值去备案"**
     —— 和苹果平台同一个反直觉坑：**字段名叫 MD5，填的是 SHA-1（40 位 hex，去冒号）**。

### 2.4 实测取值（双工具交叉验证）

**验证方法（不可省）**：任何指纹/公钥必须**两套独立实现逐字一致**才可采信。
本文的 SHA-1 / SHA-256 / MD5 / ECC 公钥点均由 **`openssl` + Node `crypto`** 各算一遍、逐字比对一致
（公钥点另有第三工具 `openssl pkey -text` 的冒号分节形态对照）。
历史教训：自写 PEM 切片曾把三张证书的指纹**全算错且错得很像真的**（见 Skill §二次验证）。

| 项 | 值 |
|---|---|
| 叶证书 SHA-1（→「签名MD5值」栏，40 位） | `9CA44BD19A4F60815B0A2F168A02ABC9697B6F98` |
| 叶证书 SHA-256 | `F3615B29545C5AD3B5FB281790655FD6D4EC359879EA53357B7378687D76E82E` |
| 叶证书 MD5 | `2B49BCFD0AA66E73D0FB914D69313384` |
| 平台公钥（ECC P-256 非压缩点，130 hex 字符） | `04AE5926C189C2888D07259C041EA0CA3AC39D120EFCD62AC2F7D13E61748674C810AC8B4618E7E6B8EE04721760167940415B73F027CEBEB79A1DADDF58472061` |

复算命令（读叶证书、双工具）：

```bash
CER="$HOME/Library/Application Support/ssos/signing/harmonyos/ssos-harmony-release.cer"
# 切出叶证书（3 张里通常最后一张带 Release 的；认 subject 而不是数序号）
awk '/BEGIN CERT/{n++} {print > ("/tmp/cert-" n ".pem")}' "$CER"
for f in /tmp/cert-*.pem; do openssl x509 -in "$f" -noout -subject -issuer; done  # 确认哪张是叶
openssl x509 -in /tmp/cert-N.pem -noout -fingerprint -sha1  # 指纹（N 替换成叶那张的序号）
```

⚠️ **取值有效期**：这些值绑定**当前这张发布证书**。若日后在 AGC 重签/换证书，指纹与公钥**全部作废**，备案要改 —— 备案期间不要动 AGC 里的证书。

### 2.5 包名：已定 `com.heyta.app`（2026-09-29 在 AGC 注册）

- ⚠️ **`com.heyta`（模板默认）与 `com.heyta.app` 试填时触发的"敏感词/保留字符"报错都是假象** ——
  那两条报错是 `display:none` 的静态隐藏模板，**真实的可用性校验要通过「下一步」行为结果判断**（教训：回执/样式 ≠ 校验结果）。
- `com.heytaapp` 只有 2 段，不符合"至少包含 3 段"规则，不可用。
- 工程 `apps/mobile/harmony/AppScope/app.json5` 已同步为 `com.heyta.app`（vendor: heyta），
  `app_name` 从模板的 "MyApplication" 改为 **`heyta`**（与安卓 `strings.xml` 的显示名一致 —— 备案「服务名称」必须 == 图标下显示名）。
- ⚠️ 同步改名前 `.hvigor/` 缓存里可能残留旧包名，属构建产物，重编即清，不要手改。

---

## 三、登录与自动化环境（AGC / 腾讯云控制台通用）

- 本机可接管的浏览器是**独立实例**：`/tmp/asc-chrome`，远程调试端口 `9223`。
  用户日常 Chrome（默认 profile）**接管不了**，登录态要落在 asc-chrome 里才可复用。
- 登录态判定：`node ssos/.agents/skills/huawei-agc/scripts/agc.mjs status`
  —— **看 DOM 标记**（有无「登录」CTA /「我的应用」），**不看 URL 与 Cookie**（未登录也会种访客 Cookie、也不一定跳登录页）。
- 未登录时：停自动化，把窗口交给用户登录。**置前用 CDP `Page.bringToFront`**（走 9223）。
  ⚠️ 2026-09-29 实测：ZCode 计算机控制助手**没有辅助功能授权**（AX 全挂），
  别走 `list_windows` / 点击窗口那条路 —— CDP 通道不受影响。
- 硬规矩（承自 huawei-agc skill）：不抢用户前台（用户明确要求开窗登录除外）、
  后台开标签、未登录不重试、绝不读取/打印凭据。

---

## 四、相关事实与未决问题

- **华为开发者账号（heyta 用）**：`hid78288024`，实名主体「晓黎（杭州）人工智能科技有限公司」（2026-09-29 登录 DOM 核实，✅ 主账号已认证）。
  SSOS 的华为账号主体是「晓黎创意文化产业发展（北京）有限公司」—— 同一实控人、不同法人，**两个账号不要混**。
  同账号内还有用户自建的「晓黎学习」（cn.waytofuture.ai）—— 不要动。
- 备案主体 vs 域名实名主体 vs 华为账号主体，三方是否一致 —— **进腾讯表单前必须核对**（Skill §域名实名：不一致必被打回，这是该 Skill 记录过最贵的坑）。
- AGC 里 **heyta 的应用记录与 APP ID**：✅ 已创建（见 §一 表后）。
- 腾讯云备案控制台的**既有草稿**：未核实（等登录后看）。

### 3.1 AGC 实测状态（2026-09-29，hid78288024）

| 项 | 状态 |
|---|---|
| 实名认证 | ✅ 主账号已认证 |
| 发布证书 | ❌ 证书列表 0 条（certManage 页「暂无数据」） |
| 在架应用 | 0 |
| HarmonyOS 应用列表 | 空态（`#/myApp` HarmonyOS 标签无表格，只有空态引导） |
| 总览"HarmonyOS应用数" | ⚠️ 显示 1，与上矛盾，未定论 |

### 3.2 本地签名材料（heyta 账号专用，2026-09-29 生成）

- 目录：`~/Library/Application Support/heyta/signing/harmonyos/`
  （`heyta-harmony-release.p12` 密钥库 + `heyta-harmony-release.csr` + `signing.env`，全 600 权限；口令只在 env 文件里，**不入任何日志**）
- 生成工具：DevEco 自带 `hap-sign-tool.jar`（`generate-keypair` ECC NIST-P-256 → `generate-csr` SHA256withECDSA，subject `C=CN,O=Heyta,CN=heyta-release`）。
- ⚠️ **`.p12` 是这个发布证书的私钥，丢了 = 证书作废重走一遍**；口令同理。备份要走用户自己的密管，不进 git。
- ✅ 2026-09-29：CSR 已在 AGC 换发为发布证书 `heyta-release`（配对已验证，见 §一），
  签发链下载件在 `/tmp/heyta-agc/heyta-release.cer`（临时目录，**重启即丢** —— 权威副本永远在 AGC，可随时重下）。
