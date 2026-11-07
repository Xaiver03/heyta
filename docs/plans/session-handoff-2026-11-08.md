# 交接 · 2026-11-08 凌晨那一轮（P2 对标收口）

> 写给下一个接手的人。**读完这一份就不需要再问"现在到哪了"。**
> 明细在各自的计划文档里；本文只回答四件事：哪些关了、哪些没关、**卡在什么决定上**、怎么接着跑。

---

## 1. 关了哪些格子（main 上 49 笔提交，`5d3b2d924..HEAD`）

| 格 | 判据读数 |
|---|---|
| 看板重建在 `TaskRow` 上（B274） | `check:l4` 78→**74 恰在基线**、族仍 **33** |
| 标签合并三个读点 | 别名表命中 1 / 存活表 0（判据能红） |
| 附件接进 web 详情面 | 去掉挂载点 ⇒ 6 条里 5 条红 |
| 空态第四档 `card` | 三支注入臂都真红 |
| **R13a** 设置树「个性化」+ 我的页两锚点 | 组 id 不变、版本读唯一真源、退出单入口 |
| **R13b** 主题预设 + 自动深浅 | **零 op**；逐预设 × 逐明暗算 WCAG |
| **R11** `ErrorState` / `Skeleton` + 第一个消费者 | 加载画骨架且空态不在；换回纯文字 ⇒ 红 |
| 移动端上传失败词表 | 源码形状判据 + 反向断言 |
| **新门禁** `check:tag-resolution` | 自检 6/6；真注入 rc=1 |
| **新门禁** `check:state-tiers` | 30 行账本；改一档 ⇒ 点名第几个站点 |
| **四端重装** | mac ✅ / windows ✅ / ios ✅ / android ✅（新增 AVD `heyta-api35`） |

## 2. 没关的格子（**每一项都带一个"要不要做"的决定**）

| 格 | 现量 | 卡在什么上 |
|---|---|---|
| **移动端设备腿** | ❌ 停在判据 A 之后 | 🔴 **产品缺陷**：readable 账号上传仍带密文 ⇒ `PLAINTEXT_REQUIRED`、`latestSeq` 恒 0。四趟复现（负载 11/12/20+/**6.0**）⇒ [gap 文档](mobile-plaintext-sync-gap-2026-11-08.md)。**判据已落库且现在是红的**：`payload-mode-host.spec.ts` 的「活配置 + 没有 accountId」那条 |
| R13b 剩下的四维 | 纯色 / 字号档 / 密度 / 行着色三态 | 各要先定方案。**行着色已测绘完**（[落点](row-color-three-states-scope-2026-11-08.md)）：数据已有、行上零入口、`关` 必须真的是关 |
| R11 覆盖度 | 32 容器只接了 1 处；`card` 档 0 消费者 | 铺开要逐容器改界面，且"用错档"的判据已就位 |

## 3. 三个待裁决（[`decisions-needed-2026-11-08.md`](decisions-needed-2026-11-08.md)）

① 明文同步怎么修（三个方向 + 建议先落 B）② 本地库与上传是否必须同模式 ③ R13b 四维的门槛。

## 4. 怎么接着跑（环境）

```bash
# 服务端（仓库里没有 npm 脚本，是手工命令）
cd server && PORT=3100 NODE_ENV=development \
  DATABASE_URL="postgresql://rocalight@127.0.0.1:5432/heyta_mobile_smoke" \
  TEST_MODE=true TEST_MODE_CONFIRM=yes-i-understand-the-risks \
  node dist/src/index.js

# 设备腿（模拟器 + idb companion + 全新账号）
mkdir -p /tmp/idb        # ← 机器重启后它不存在，companion 会报 GRPCCore 错误
DEVICE_NAME="iPhone Duo heyta" IOS_UDID=742A8651-1A31-45AA-B213-8794631B153F PORT=3100 \
  bash scripts/verify-mobile-ios-account-erasure.sh

# Android（这一轮新建的 AVD）
/opt/homebrew/share/android-commandlinetools/emulator/emulator -avd heyta-api35 -no-window -no-audio
```

⚠️ 三条今晚踩过的坑：`idb companion` 要先建 `/tmp/idb`；`pnpm install` 装不上会**先删整棵树**
（traps #673）；`$var` 紧跟全角标点会被吃进变量名（traps #676）。

---

## 5. 一句话总结

**能自己做完的都做完了：四端重装、18 道门禁、2793 个 web 用例。**
剩下三格各自卡在一个产品决定上，每格都有现量、判据、和"最小落地方案"，
**只差有人点头**。我没有把任何一格写成"已完成"来凑收盘。
