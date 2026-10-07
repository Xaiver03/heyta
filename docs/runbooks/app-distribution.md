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

脚本做六件事：规范化命名（`heyta-<version>-<platform>.<ext>`）→ 算 sha256 →
生成 `latest.json` → 上传到 `app-releases/heyta/<version>/` 与 `…/latest/` →
**匿名** HEAD 回读校验（content-length 对不上就退出 1；带授权的成功证明不了公开读）→
**刷新落地页那份快照**（`gen-downloads.mjs` + `check-downloads.mjs`，任一失败就退出 1）。

🔴 两处与直觉不同的形状（[ADR-0058](../adr/0058-download-page-and-manifest-single-source.md) §4 第 5 条）：

1. **`latest.json` 按端合并，不整批重写。** 五端不落在同一轮（iOS 走 TestFlight、
   某一端晚一天验装），整批重写的失效形态是"第二批只带 android ⇒ 清单里的 macos 条目消失"，
   而桶里那个字节仍然在、仍然能下 —— 页面上一秒有按钮下一秒没有，没人会想到是另一批上传抹掉的。
2. **版本号挂在每一枚文件上**（`files.<端>.version`），批次号只是"最新一轮"的抬头。
   合并清单里各端不同轮，一个批次号盖不住它们；落地页据此判断"这一端是不是正式发布通道"。
   臂 D 抓的就是这件事，且**已经抓过一次真的**：旧条目缺 `version` 时会被本轮批次号盖掉，
   现在版本号只从它自己的文件名取（取不到就留空让门禁响，不猜）。

产物 URL 形态：

```
https://heyta-dist-1380503169.cos.ap-guangzhou.myqcloud.com/app-releases/heyta/latest/heyta-<version>-<platform>.<ext>
```

落地页下载按钮指向 `latest/`（固定名）或解析 `latest/latest.json`（含 version / sha256 / size / 双 URL）。
版本化 URL 不可变（`Cache-Control: immutable`），`latest/` 短缓存（300s）。

**收尾流程里的位置**：`pnpm reinstall:all` 负责证明"四端装的是当前产物"；
`upload-dist.sh` 是它**之后**的独立一步，刻意不并进去 —— 分发是外向动作，不该被
"装好了"顺手触发（早期开发阶段传一堆 0.0.x 到公网没有意义，想传的时候显式传）。

### 3.1 第一批真发布（2026-10-07，四端）里三件只有做过才知道的事

**① Android 的正式签名可以在**发起机**上做，密钥不用出境。**
远端打包机（`run-gradle.mjs` 收口点）出来的 `app-release.apk` 在缺四个 keystore 键时会被
`build.gradle` 挂到 `signingConfigs.debug` 上（现量 `CN=Android Debug`）。补签的做法是
把**那一份 APK** 传回持有发布密钥的机器，用 `apksigner sign` 重签 —— 密钥一个字节都不出境：

```bash
# 远端出包 → 回传 → 本地重签（zipalign 已由 AGP 做过，仍要 -c 复核）
apksigner sign --ks <发布库> --ks-key-alias <别名> --out heyta-<v>-android.apk app-release.apk
apksigner verify --print-certs heyta-<v>-android.apk   # 期望 DN 里有 CN=heyta，不是 CN=Android Debug
zipalign -c 4 heyta-<v>-android.apk
```

🔴 **这条路径目前没有脚本、也没有门禁**：仓里没有任何地方执行 `apksigner`，"期望的 Signer DN"
也没钉住 —— 也就是说下一轮谁忘了重签就直接上传，页面会照样给一个调试签名的按钮（臂 D 只核版本号，
不核签名）。**要补的是判据，不是这段文字**（登记在 `BLOCKED.md` 本轮那条）。

**② `.dmg` 不是可复现容器。** 同一份源码，上午那批与下午重装各打出一枚，
字节数不同（2,362,276 vs 2,367,142）。所以"发布的是哪一枚"只能由 **sha256** 回答，
不能由"源码同一个 commit"回答 —— 桶里那条 `files.macos.sha256` 对的是**上传的那一枚**。

**③ 装进系统那一格，能在无 root 下证的部分比想象中多。**
盒子（Ubuntu 24.04.5）没有免密 root，`dpkg -i` 跑不了；但 `dpkg -i` 会失败的三种原因里三种都能提前查：

| 会失败的原因 | 无 root 的查法 | 今天的读数 |
|---|---|---|
| 装的时候跑任意脚本（postinst 崩） | `dpkg-deb -e <deb> /tmp/x && ls /tmp/x` | 只有 `control` ⇒ **没有 maintainer 脚本** |
| 依赖名对不上 Ubuntu 的包名 | 逐条 `dpkg-query -W -f='${Version}' <名>` | 六枚全装着（`libgtk-4-1 4.14.5`…） |
| 与别的包抢同一个路径 | 逐条 `dpkg -S <路径>`，**先拿 `/usr/bin/ls → coreutils` 做阳性对照** | 32 条路径 0 冲突 |

剩下没证的只是 dpkg 那次事务本身。**这一格开在访客看得见的地方**：`/download` 的 Linux 那一行
caveat 写的就是"我们验过解包后能起真界面，还没有人在自己机器上装过 —— 装不上请告诉我们"，
而不是把它包装成已验。要闭合只需在有 root 的机器上跑一次
`sudo dpkg -i heyta_1.0.0_amd64.deb && dpkg -L heyta | head`。

⚠️ 批次号一旦公开就变成下界：这批以 `1.0.0` 发出后，下一批的号**不能比它小**
（`latest.json` 的 `version` 会倒退，而下载页只认各文件自己的 `version`，没有任何一层会报）。
现量冲突见 `BLOCKED.md` 本轮格 8（root `package.json` 在 main 是 `0.0.0`、在 self-host 那条线是 `0.1.0`）。

## 4. 成本与省流量

- 外网下行 ≈ **¥0.5/GB**：63MB APK ≈ 3 分/次下载，1000 次 ≈ ¥30。存储 ≈ ¥0.1/GB·月（IA 减半），可忽略。
- **最优先的省流量手段是瘦产物**：Android APK 63MB 含全 ABI，开 arm64-only 拆分一般能砍
  30-40%。⚠️ 改 `apps/mobile/android/app/build.gradle` 的 `splits` 会改变产物路径，
  动之前先确认 `reinstall-all.sh` / 各 verify 脚本引用的是哪个路径 —— **本轮没做**，留作已知优化。
- 量级判据：月下行 > ~50GB 再在桶前挂腾讯云 CDN（流量单价约省一半）；
  现阶段挂 CDN 纯属增加复杂度。
- 已验证的试传：`0.0.0-dev`（macOS zip + Android APK，2026-09-30），匿名 200，
  可随时 `coscli rm` 清掉。⚠️ 那枚 macOS zip 是**没有共享 UI 产物的那一轮**（装上打不开，
  AGENTS §7 第 82 条那一族），所以它虽然能下载也**不算对外发布** —— 落地页对
  带预发布后缀的版本一律不给按钮（`src/site/downloads.ts` 的 `STABLE_VERSION`）。
- ✅ **第一次真发布：macOS `1.0.0`**（2026-10-07 11:4x，载体 `b081811c` 的产物）。
  `heyta-1.0.0-macos.dmg` 2,362,276 B，`sha256 15ae558303543482cd42e43a986b617a64457a389bef8197966d157cd526fe12`，
  匿名 Range 实取回 `206 / bytes 0-0/2362276`。签名那一侧的复验在上传**之前**做：
  `codesign` 读到 Developer ID、`spctl -a -t install` 判 `accepted / source=Notarized Developer ID`、
  `stapler validate` 通过。边界：只有 **Apple Silicon** 构建（`lipo -archs` = `arm64`），
  Intel Mac 没有产物 ⇒ 页面上那一行写着这件事，而不是删掉提醒。
  回退这一发：`coscli rm cos://heyta-dist-1380503169/app-releases/heyta/1.0.0/heyta-1.0.0-macos.dmg`
  与 `…/latest/` 那一份，然后重跑 `node apps/landing/scripts/gen-downloads.mjs`。

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
  ⚠️ 但"传得上去"不等于"能发布"：这两端各自还差**访客装得上**那一格
  （Windows 自签名要先信任证书、Linux 的 `dpkg -i` 未验）。落地页读清单，
  所以这一格没补上之前，页面上就是没有按钮 —— 那是**故意的**，不是遗漏（ADR-0058 §5）。
- **`channels`（TestFlight 那类人工登记的入口）**：它是清单里唯一允许手写的字段，
  代价是 `check-downloads.mjs` 的臂 B 要求它的 host 落在官方域名白名单内，
  且 key 必须是注册表里标成商店的那一行。
