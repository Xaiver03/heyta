# 分发操作手册（安装包怎么发出去）

> 建立：2026-09-30。配套脚本：[`scripts/upload-dist.sh`](../../scripts/upload-dist.sh)、
> [`scripts/tools/cos-api.mjs`](../../scripts/tools/cos-api.mjs)。
> 与 [`multi-platform-build.md`](multi-platform-build.md) 的关系：那份讲**怎么打包**，这份讲**包打完之后怎么发**。

---

## 1. 渠道定位（一次说清，别再摇摆）

| 渠道 | 定位 | 理由 |
|---|---|---|
| **COS 专用桶** | 国内正式下载入口（macOS / Android / Windows / Linux） | coscli 已配置；专用桶隔离了公开读与生命周期的爆炸半径 |
| **GitHub Releases** | 海外镜像 + 校验和 + 发布说明 | 仓库转公开后启用；国内访问 assets 域名不稳定，只作镜像 |
| **TestFlight / App Store** | iOS 唯一通道 | 不走 web 分发；见 [`multi-platform-build.md`](multi-platform-build.md) §2.5/§2.6 |
| **飞书网盘** | 内测临时发包 | 能自动化（`lark-cli drive +push`），但外链无稳定直链、下载要过飞书网页、大文件引导装客户端 —— **不做公开下载入口** |
| 轻量应用服务器 | ❌ 不发安装包 | 带宽仅几 Mbps，一个 63MB APK 下一分多钟还挤占同步流量 |

## 2. COS 分发桶

**桶名 `heyta-dist-1380503169`（ap-guangzhou），整桶公开读。**

🔴 **为什么是专用桶而不是复用 `litopia-1380503169`**：那个桶是多产品共用的
（litopia / ssos 的 APK、头像都在里面）。公开读、防盗链、生命周期这类
**桶级配置会波及所有对象** —— 在共享桶上开防盗链白名单会立刻打断别的产品的下载。
专用桶让这些配置的作用域 = heyta 自己。

桶级配置现状（用 `scripts/tools/cos-api.mjs` 配置并回读验证过）：

- **生命周期**：全桶 90 天转 STANDARD_IA、365 天过期。`latest/` 每轮发布都会被重写
  （mtime 刷新），不会中途消失；一年不发版 `latest/` 会 404 —— 那是可见的失败，不是静默的。
- **防盗链（Referer）**：**故意没配**。下载器/直链打开常带空 Referer，现在开了只会误伤；
  真出现盗链烧流量时再加（命令见 §5）。

凭据来源：`~/.coscli/config.yaml`（桶已登记为 alias `heyta-dist`）。
**仓库里不存任何密钥**；`cos-api.mjs` 也是运行时从 coscli 配置读。

## 3. 每轮发布的固定动作

打包（[`multi-platform-build.md`](multi-platform-build.md) / `pnpm reinstall:all`）完成后：

```bash
scripts/upload-dist.sh --version 0.1.0 \
  --file macos=/tmp/heyta-macos-dist/Heyta.dmg \
  --file android=apps/mobile/android/app/build/outputs/apk/release/app-release.apk \
  --file windows=dist/windows/Heyta.msix \
  --file linux=apps/desktop-linux/dist/heyta.deb
```

脚本做五件事：规范化命名（`heyta-<version>-<platform>.<ext>`）→ 算 sha256 →
生成 `latest.json` → 上传到 `app-releases/heyta/<version>/` 与 `…/latest/` →
**匿名** HEAD 回读校验（content-length 对不上就退出 1；带授权的成功证明不了公开读）。

产物 URL 形态：

```
https://heyta-dist-1380503169.cos.ap-guangzhou.myqcloud.com/app-releases/heyta/latest/heyta-<version>-<platform>.<ext>
```

落地页下载按钮指向 `latest/`（固定名）或解析 `latest/latest.json`（含 version / sha256 / size / 双 URL）。
版本化 URL 不可变（`Cache-Control: immutable`），`latest/` 短缓存（300s）。

**收尾流程里的位置**：`pnpm reinstall:all` 负责证明"四端装的是当前产物"；
`upload-dist.sh` 是它**之后**的独立一步，刻意不并进去 —— 分发是外向动作，不该被
"装好了"顺手触发（早期开发阶段传一堆 0.0.x 到公网没有意义，想传的时候显式传）。

## 4. 成本与省流量

- 外网下行 ≈ **¥0.5/GB**：63MB APK ≈ 3 分/次下载，1000 次 ≈ ¥30。存储 ≈ ¥0.1/GB·月（IA 减半），可忽略。
- **最优先的省流量手段是瘦产物**：Android APK 63MB 含全 ABI，开 arm64-only 拆分一般能砍
  30-40%。⚠️ 改 `apps/mobile/android/app/build.gradle` 的 `splits` 会改变产物路径，
  动之前先确认 `reinstall-all.sh` / 各 verify 脚本引用的是哪个路径 —— **本轮没做**，留作已知优化。
- 量级判据：月下行 > ~50GB 再在桶前挂腾讯云 CDN（流量单价约省一半）；
  现阶段挂 CDN 纯属增加复杂度。
- 已验证的试传：`0.0.0-dev`（macOS zip + Android APK，2026-09-30），匿名 200，
  可随时 `coscli rm` 清掉。

## 5. 防盗链（真需要时再加）

```bash
cat > /tmp/referer.xml <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<RefererConfiguration>
  <Status>Enabled</Status>
  <ProtectType>WhiteList</ProtectType>
  <DomainList>
    <Domain>*.waytofuture.cn</Domain>
  </DomainList>
  <AllowEmpty>true</AllowEmpty>
</RefererConfiguration>
EOF
node scripts/tools/cos-api.mjs --bucket heyta-dist-1380503169 \
  --method PUT --query referer --body-file /tmp/referer.xml
# 配完必须回读 + 匿名 GET 实测一个直链（空 Referer 场景）
```

`AllowEmpty=true` 是关键：无 Referer 的直链/下载器必须放行，否则"点了没反应"。

## 6. 留白（有意不做，别当遗漏）

- **自定义域名**（`dl.waytofuture.cn` CNAME 到桶）：默认 `myqcloud.com` 域名直接可用，
  自定义域名要动 DNS 与证书，等对外域名策略定了再说。
- **GitHub Releases 镜像**：仓库转公开后，把同一批文件挂到 release 上即可，脚本化
  （`gh release create`）此处不展开。
- **MSIX / deb 的常规产出**：Windows 包在远端打包机、Linux 包路径见
  [`multi-platform-build.md`](multi-platform-build.md) §6，接入 upload-dist 时按实际产物路径传参即可。

## 7. 2026-10-08 第一批测试（历史）

发布标签 `v1.0.1-test.20261008.1`，源码快照 `0107fe15440aecf5775a71574ba973406d8b4c49`。批次号区分安装包，非强制改写各端内部版本；iOS 为 `1.0 (3)`，模拟器同源码验收包为 `1.0 (1)`。

| 端 | 测试产物 | 签名/安装状态 |
|---|---|---|
| macOS | Apple Silicon arm64 DMG | Developer ID 签名，Apple 公证和 staple 验证通过，已安装 |
| Windows | x64 ZIP：MSIX + CER + 中文安装说明 + 安装脚本 | 自签名；signtool 验证 0；已安装。首次需管理员信任公开证书，不包含私钥 |
| Android | 发布签名 APK | 证书指纹与登记一致；当前源码已卸旧装新。曾装 Debug 签名版时须先导出数据再卸载旧版 |
| Linux | amd64 DEB | 包内共享 UI 对账和解包启动通过；未做系统安装，验证机沙箱限制如实保留 |
| iOS | TestFlight 1.0 (3) | Apple 处理 VALID，加入既有内部组；没有公开测试邀请链接 |

- [GitHub 测试版与校验和](https://github.com/Xaiver03/heyta/releases/tag/v1.0.1-test.20261008.1)
- [国内下载清单](https://heyta-dist-1380503169.cos.ap-guangzhou.myqcloud.com/app-releases/heyta/latest/latest.json)
- [TestFlight 管理入口（需相应账号权限）](https://appstoreconnect.apple.com/apps/6817635248/testflight/ios)
- [本批产物校验记录](../../apps/web/evidence/ux-closeout/release-2026-10-08/release.json)

本轮未发邀请/通知、未提交外部 Beta 审核。Web 和帮助中心已更新，真实邮箱收件及其完整验证码闭环仍待专门验证，不能由上传成功代替。


## 8. 2026-10-08 第二批测试（历史）

当前源码快照 `c938a0bbf6e3102652f2358ad987685a65aeaefe`，标签 `v1.0.1-test.20261008.2`。包含移动任务视图菜单与排期渐进披露、个人中心整行入口、成长空态/年度活动，以及四象限撤销与新建清单防重入修复。后续 QA 脚本和证据更新不改变这批二进制。

- iOS：`com.heyta` **1.0 (4)**，Apple 处理 `VALID`；API 回读确认加入既有“内部测试”组，已补 `zh-Hans` 测试说明。本机 Apple Developer 签名可用，无需重新提供账号。未发邀请、未创建公开测试链接；模拟器已重装，不能据此声称用户的实体 iPhone 已安装。
- macOS：Developer ID 签名，公证 `Accepted`，staple 验证通过；已安装。实际帮助入口点击因本机锁屏尚未复验。
- Windows：当前 MSIX 已安装，签名有效。ZIP 包含 MSIX、公开 CER、中文安装说明和管理员安装脚本；证书与包签名、说明中的包哈希均已核对。首次安装需按说明信任测试证书。
- Android：发布签名 APK 已重打、安装；任务旅程、Profile 链路与深浅主题已复验。
- Linux：DEB 包内共享 UI 字节对账及解包启动通过；尚未系统安装，验证机沙箱限制仍保留。
- Web：已部署；390/1440 下登录、注册确认密码与强度、帮助首页/文章导航通过。未发送验证码邮件，不代表生产 SMTP 已验收。

[国内下载清单](https://heyta-dist-1380503169.cos.ap-guangzhou.myqcloud.com/app-releases/heyta/latest/latest.json) 已切换 `1.0.1-test.20261008.2`，四端文件匿名可读，大小及清单 SHA-256 与本机一致。[GitHub 第二批测试版](https://github.com/Xaiver03/heyta/releases/tag/v1.0.1-test.20261008.2) 已公开，五个资产 SHA-256 与本机一致。完整校验读数见 [第二批分发证据](../../apps/web/evidence/ux-closeout/release-2026-10-08-b2/release.json)。

## 9. 2026-10-08 第三批测试（当前）

本批修复助手长对话滚动、历史面板关闭、取消披露恢复草稿、跨布局披露/等待状态、提醒按钮暗色与宽度，以及移动端任务角标截断。macOS、Windows、Android、iOS 模拟器已完成当前源码重打重装；Web 已部署并通过深浅主题/多视口助手与设置2条真实浏览器旅程。

iOS **1.0 (5)** 已上传 TestFlight，Apple 状态 VALID，既有内部测试组关联已 API 回读确认，附中文测试说明。没有创建公开邀请链接，也没有实体 iPhone 安装证据。其余四个平台的第三批下载包已上传，GitHub五个资产的大小及SHA-256均与本机一致，COS latest清单已切换第三批且逐项对账通过。源码快照 `8a7332c365250d1c8136eb8ef7b9d4d31c1839e9` 的22个workspace依赖清单已通过离线冻结锁文件校验；快照修正未覆盖工作树中的服务端开发改动，也未改动用户Git索引或HEAD。

[下载第三批测试版](https://github.com/Xaiver03/heyta/releases/tag/v1.0.1-test.20261008.3) · [国内下载清单](https://heyta-dist-1380503169.cos.ap-guangzhou.myqcloud.com/app-releases/heyta/latest/latest.json)。

本批不部署服务端，仍保留 `3880bdd1fd5e8fe3710bd19c5f753947ea89c468`。另一任务的 inbound automation 服务端修改不纳入本次客户端发布；共享包中的可选 worker 接线不表示公网回调功能已交付。该批发布时仅证实小组件 descriptor 注册；后续第五轮已通过 iOS 系统面板添加“今日任务”小组件，见产品 UX 计划的续验证据，尚不代表全部模板与实时刷新通过。

[第三批构建与分发证据](../../apps/web/evidence/ux-closeout/release-2026-10-08-b3/release.json)。
