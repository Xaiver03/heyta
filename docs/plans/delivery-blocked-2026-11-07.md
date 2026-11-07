# 交付卡点 · 四端重装与移动端设备腿（2026-11-07）

> 这一轮把功能格做完了，卡在**交付**这一步。本文是那一步的现量：
> 卡在什么上、**为什么不是代码问题**、需要谁动手、以及下次恢复后按什么顺序跑。
> 状态：🔴 **未交付**（四端重装与设备腿都没跑通）。

---

## 1. 现量：卡在三处，都在本会话的沙盒之外

| # | 卡点 | 现量证据 | 谁来解 |
|---|---|---|---|
| 1 | **`pnpm -r build` 起不来**：`prisma generate` 要 `utime` `~/.cache/prisma/**` | `Error: EPERM: operation not permitted, utime '…/darwin-arm64/libquery-engine'`，rc=1。同一条在沙盒外可跑（历史日志里有成功记录） | 沙盒外权限，或由人跑一次 `pnpm reinstall:all` |
| 2 | **xcodebuild 挂**：SwiftPM 要写 `~/Library/Caches/org.swift.swiftpm/**` | `cannot open file '…/ManifestLoading/heytawidgetcore.dia' for diagnostics emission (Operation not permitted)`。直接 `touch` 那个目录也 `Operation not permitted` | 同上 |
| 3 | **模拟器上没有装过本 App** | `xcrun simctl get_app_container <UDID> com.heyta app` ⇒ `No such file or directory`；`listapps | grep -c com.heyta` ⇒ **0** | 装包成功之后才有 |

三处同源：**本会话的文件沙盒只允许写工作区**，而这三件事都要写用户缓存目录。

## 2. 已经解决、且值得记下来的两处（它们原本也挡在前面）

1. **`pod install` 必然失败（`undefined method '[]' for nil`）** —— 根因是 pnpm 的严格隔离让
   `react-native/react-native.config.js` 的 `require('@react-native/community-cli-plugin')` 解析不到，
   CLI 的 `try/catch` **静默丢掉整个 RN 依赖项**，于是 `config["project"]` 是 `{}`。
   判据（不看 Podfile 就能定性）：
   ```bash
   cd apps/mobile && node -e "process.argv=['','','config'];require('@react-native-community/cli').run()" \
     | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(Object.keys(j.project||{}))})"
   # 正常 ['ios','android']；打出 [] 就是这条
   ```
   本会话的绕法：**在 `apps/mobile/node_modules/@react-native/` 里补一条软链**（git-ignored，不进仓库）。
   修好之后同一发打出 `['ios','android']`、`ios.sourceDir` 正确，`pod install` 通过
   （`✅ 沙盒已同步（Manifest.lock == Podfile.lock）`）。

   🔴 **根上的修法不是补软链**：那条 `require` 是 RN 自己发起的，pnpm 隔离下必然解析不到。
   要么把 `@react-native/community-cli-plugin` 显式声明进 `apps/mobile` 的 devDependencies
   （版本必须与 `react-native` 同步），要么在 `pnpm-workspace.yaml` 里给它一条 `publicHoistPattern`。
   两条都要改 lockfile —— 本轮没做，因为**改 lockfile 之后必须能重新 `pnpm install` 才算数**，
   而那一刻 store 里缺 `lunar-typescript`（见陷阱 #673）。**这是留给下一个人的第一件事。**

2. **`pnpm install` 会把"装不上一个新依赖"结算成"先删掉整棵 node_modules"** ——
   本轮真撞了一次：报错指向 `lunar-typescript`，后果是 `apps/mobile/node_modules` 变成 0 个条目。
   恢复：`pnpm install --frozen-lockfile`（**不加 `--offline`**），12.7 s，`typecheck` 回到 rc=0。
   全记在陷阱 #673。

## 3. 恢复之后按这个顺序跑

```bash
cd "<repo>"
pnpm install --frozen-lockfile            # 若 lockfile 被改过：不带 --offline
pnpm --filter @heyta/node-host build      # 陷阱：#674 的姊妹 —— apps/desktop 读它的 dist 类型
pnpm typecheck                            # 期望 rc=0
pnpm reinstall:all                        # 四端；iOS 段必须带 IOS_DEVICE_NAME
# 设备腿（等负载降到个位数再做，见陷阱 #634）
PORT=3100 bash scripts/verify-mobile-ios-account-erasure.sh
```

⚠️ iOS 段之前先跑一遍 §2 的那发 `cli config` 探针 —— 它会用 5 秒回答
"这次 pod install 会不会又死在 `nil` 上"，而那正是上一次花了半小时才看懂的那一格。

## 4. 凭什么说"不是代码问题"

| 判据 | 读数 |
|---|---|
| 源码自身的门禁 | 19 道逐条 rc=0（含本轮新开的 `check:tag-resolution` / `check:state-tiers`） |
| 类型 | `pnpm typecheck` rc=0（`node-host` build 之后） |
| 单测 | `apps/web` **2793 passed / 0 failed**；`packages/ui` 921；`design-system` 583；`apps/mobile` 1327 |
| 卡点成因 | 三处全是 `Operation not permitted` / `No such file`，且 `touch` 一个缓存目录就被拒 —— **沙盒边界**，不是逻辑 |

## 5. 附带做成的（不是卡点，但这一轮也发生了）

- 起了一台 **TEST_MODE 服务端**（`PORT=3100`，`/health` = `{"status":"ok","db":"connected"}`），
  并建了一个**全新账号**（`/tmp/heyta_mobile_{email,token,e2ee}.txt` 齐）——
  设备腿的前置条件 ② 已经就绪，只剩装包。
- ④ `localhost:3000` 上那枚**不是 heyta 的**监听已定性：cwd 是 `/Users/rocalight/.dsh/profiles/desktop`，
  `/`、`/health`、`/api/test/create-user` 全 404 ⇒ 不能拿它当测试服务端（原来以为"3000 被占"，其实是被别人占）。
