# 结果：设置面目录层把 Android 设备腿的导航全停在目录层（同族三处）

跑的时间：2026-10-13 15:5x – 19:5x（本机时区）。

## 出处（每条读数都带这三行才成立）

| 量 | 现量命令 | 读数 |
|---|---|---|
| 源码 | `git rev-parse --short HEAD` | `071e09fd`（改的只有工作树，见下"脏"） |
| 装到设备上的产物 | `sync-needle-probe.py` 里 `sha256sum` 设备上的 `base.apk` | `c150b73993a5…648410e`（= r108 那一趟的产物，见 `apps/web/evidence/ux-final-20261013/reinstall-r108/SHA256.txt`） |
| 载体 | 主检出（`/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta`），设备 `emulator-5554` | 跑前 `ps` 里没有别的会话在驱动设备 |
| 被改的 lib | `git status --porcelain -- scripts/lib/mobile-e2e.sh` | `M`（各臂日志里的 `LIB_DIRTY=1` 就是这个；`LIB_BLOB` 打的是 **HEAD 那一版**的 blob，用来证明"改前臂"跑的确实是入库那版） |

## 这五个文件各证一件事

| 文件 | 证明 |
|---|---|
| `ab-before.txt` | 入库那版 `configure_sync_credentials` 在**当前产物**上四枚红（三个字段"找不到"+ 终态"字段丢了"），而第五枚 `界面认为已配置` 是**假绿** —— 它读的是目录层，那句话在那一屏根本不渲染 |
| `ab-after-nav-only.txt` | 只补"进组"这一刀之后：`服务器地址` 填上了，另两枚仍找不到 ⇒ 第二个缺陷（折叠线以下的输入框整枚不在无障碍树里，裸 `xy_edit` 拿不到可点坐标） |
| `ab-after-nav-scroll.txt` | 换成 `scroll_to_edit` 后三枚字段全填上、终态三值同时仍在 |
| `ab-fresh-rid.txt` / `ab-final.txt` | 冷启动整条路（起应用 → 过首屏两道闸 → 我的 → 设置 → 目录 → 同步与隐私 → 使用自托管服务器 → 三个字段）5✅ 0❌，用的是最终代码 |
| `ab-sections.txt` | 共享的 `open_settings_section` 对**五个组各一枚组内独有 testID** 都落对了地方，且 `close_settings_sheet` 每趟都把面关掉（`sheet_open_after_close=0`）|
| `probe.json` | 针的正对照：未配置态下 `mobile.profile.sync.notConfigured` 的**当前值**确实在「同步与隐私」那一屏渲染（`[42,945][1038,993]`），旧那句不在树里 |
| `probe-nav-check.json` | 只点「设置」时落在目录层：三个凭据字段 + 「使用自托管服务器」全部 `false`，屏上只有目录那几行 |
| `run-configure-ab.sh` / `probe-sections.sh` / `sync-needle-probe.py` | 装置本体，可直接复跑 |

## 复跑命令

```sh
# 单臂（假凭据，不碰真令牌；现场路径走私有目录，不覆盖并行会话那份）
HEYTA_AB_RUN=~/heyta-r108-tmp/ab-configure-final \
  bash apps/mobile/evidence/profile-center/android-r108-syncneedle/run-configure-ab.sh fresh
# 五个组 + 关闭契约
bash apps/mobile/evidence/profile-center/android-r108-syncneedle/probe-sections.sh
```

## 这页**不证明**的三件事

1. **没有跑任何一条完整设备腿**（`verify-mobile-habits.sh` 之类）。这里只把"导航 + 填字段"这一段单独跑通；填的是假凭据，所以一次同步都没发。腿的其余判据（同步、冲突、跨端）仍然要各腿自己跑。
2. **iOS 那一侧没验**。iOS 的同类导航在 `verify-mobile-ios-account-email-sessions.sh:799-831` 早就自己适配过目录层（那里注释明写"旧那代设置面根层就有「服务器地址」"），本趟没重取它的读数。
3. **`settings-section-profile` 那一组没在设备上验到**：那组只在账号存在时渲染（`SettingsScreen.tsx:351-355` 的 filter），而这台设备上没有账号。`verify-mobile-account-email-sessions.sh` 的三处改的是**同一条已验证的库函数**换了 key，它的前提（有账号 ⇒ 那一行在）来自源码，不是现量 —— 那条腿真跑起来时如果那一行不在，会按 `open_settings_section` 里的 `bad` 响亮失败，不会静默。
