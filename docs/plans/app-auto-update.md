# 自动更新机制（App Auto-Update）

> 状态：实施中。判定口径见文末「验收」一节，只以可执行证据为准。
> 本文档是这套机制的**唯一定性来源**：基线表、缺口矩阵、接口契约、逐端口径都写在这里。
> 代码落点见每节末尾的「落点」行。

---

## 0. 一句话结论

所有端的「要不要更新」收敛到**同一个服务端接口**（`GET /api/app-version`），客户端只负责
「上报本机版本 → 读服务端给的两个布尔（`updateAvailable` / `forceUpdate`）→ 按标志执行」，
**不自己算版本高低**。Web / PWA、桌面（Electron）、移动（React Native iOS/Android）四端
接入自动检测；iOS 受平台限制不能自更新，只能「检测 + 提示 + 跳 App Store」。

---

## 1. 基线三表（动手前必须确认的三件事）

### 1.1 技术栈

| 端 | 实际技术栈 | 关键事实（已核对到文件） |
|---|---|---|
| Web / PWA | Vite + React，自建 Service Worker | `apps/web`；SW 由 `apps/web/scripts/gen-pwa.mjs` 生成 `public/sw.js` 并由 `apps/web/src/pwa/register.ts` 注册；当前 SW **只服务小组件**，无应用更新检测 |
| 桌面 | **Electron**（不是 Tauri） | `apps/desktop`，`@electron/packager` 打包；无 `electron-updater`（更新能力目前为零） |
| 移动 iOS | **React Native**（不是 Capacitor） | `apps/mobile`，`ios/Heyta`；版本来自 `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`（当前 1.0 / 2） |
| 移动 Android | React Native | `apps/mobile/android/app/build.gradle`；`versionName "1.0"` / `versionCode 1` |
| 鸿蒙 HarmonyOS | React Native OpenHarmony（RNOH） | `scripts/build-harmony-*.mjs`、`scripts/verify-harmony-rnoh*.sh`；构建目标存在，尚未上架 |
| 微信小程序 | **不存在** | 全仓无小程序前端；`server/tests/wechat-*` 是**微信支付**适配，不是小程序壳 |
| 原生小组件 | macOS Swift（WidgetKit）/ Windows C#（WinUI）/ Android / ArkTS | `apps/desktop-macos`、`apps/desktop-windows`、`check:arkts-widgets` —— 是**小组件**，不是可独立安装的主应用 |

> 客户端版本号**唯一真源**是仓库根 `package.json` 的 `version`（当前 `0.1.0`），由
> `scripts/gen-app-version.mjs` 生成到 `packages/app-host/src/app-version.generated.ts`
> （`HEYTA_APP_VERSION`），随同步下载请求以 `appVersion` 上报。**本机制复用这一个真源**，
> 不再造第二份。

### 1.2 分发渠道

| 端 | 渠道 | 现状 |
|---|---|---|
| Web / PWA | 官方托管 `heyta.waytofuture.cn/app/` + 自托管 | 可用；SW 已上线（仅小组件） |
| 桌面 | 官网直下安装包（自托管，非商店） | 开发中（P2） |
| iOS | App Store（内测走 TestFlight） | 开发中（P2） |
| Android | APK 直装 / 国内多渠道 | 开发中（P2） |
| HarmonyOS | AppGallery | 开发中（P2） |

> 本仓库仍处开发阶段、无存量用户，所以「破坏已有安装」不作为设计约束；但接口与判定
> **按正式发布口径**写，不写占位语义。

### 1.3 后端

| 项 | 事实 |
|---|---|
| 框架 | Fastify 5（`server/`，`@heyta/sync-server`） |
| 路由注册 | `server/src/server.ts` 里 `fastifyServer.register(<plugin>, { prefix })` |
| 匿名只读先例 | `GET /api/holiday-adjustments`（ADR-0052）：per-route 限流 + `Cache-Control`，无身份维度 |
| 部署版本来源 | 服务端**自己不知道**客户端发版号（其 `package.json` 是 `1.0.0`）。本机制用**生成常量**把根 `version` 带到服务端做默认 `latestVersion`，可被 env 覆盖 |

---

## 2. 缺口矩阵（端 × 检测 / 安装 / 强制）

「能做 / 不能做 / 未知」按**平台硬限制 + 当前实现**两栏判。**目标底线是「至少自动检测」**。

| 端 | 自动检测 | 自动安装 | 强制更新 | 当前最大缺口 |
|---|---|---|---|---|
| Web / PWA | 能（SW 天然会更新，需补「提示 + 重载」） | 能（重载） | 能 | **缺检测提示**：SW 只做小组件，无 `updatefound`/版本清单轮询 |
| 桌面 Electron | 能（`app.getVersion()` + 接口） | 能（下载安装包后由系统安装器接管） | 能（后端 `minSupportedVersion` + 拦入口） | **从零**：无 updater |
| iOS（RN） | 能（读 native 版本 + 接口） | **不能**（平台禁止自更新） | 能（后端底线 + 拦业务入口） | 缺检测与提示、跳店 |
| Android（RN） | 能（`versionName`/`versionCode` + 接口） | 能（APK 用户点安装；Play 渠道 `immediate`/`flexible`） | 能 | 缺检测与下载/市场跳转 |
| 鸿蒙（RNOH） | 能（`versionName` + 接口） | 能（AppGalleryKit `updateManager`，需已上架） | 不能静默强装，需拦入口 | 未上架；接口接入待上架后接 |
| 微信小程序 | — | — | — | 不适用（无此端） |

> **优先补的洞**：Web/PWA 与桌面 Electron —— 这是用户真正能装到的两个「能覆盖全部端」
> 的入口，且检测能力从零/半零。

---

## 3. 统一「版本策略接口」

### 3.1 接口契约

```
GET /api/app-version?platform=&channel=&currentVersion=&currentBuild=&deviceId=
```

响应 JSON（`platform` / `channel` 回显；`forceUpdate` 与 `updateAvailable` 由**服务端**算好）：

```jsonc
{
  "platform": "web",
  "channel": "stable",
  "latestVersion": "0.2.0",
  "minSupportedVersion": "0.1.0",
  "updateAvailable": true,
  "forceUpdate": false,
  "downloadUrl": "https://heyta.waytofuture.cn/app/",
  "releaseNotes": "",
  "publishedAt": "",        // ISO，可空
  "rolloutPercent": 100
}
```

- 响应头**必须** `Cache-Control: no-store`（禁止任何中间层/CDN 缓存，否则用户长时间检测不到新版）。
- 匿名可读（未登录也要能问），但**载荷零身份维度**：`deviceId` 只用于灰度分桶，
  不进响应、不落库、不画像。

### 3.2 判定语义（服务端算，客户端只读标志）

- **版本用「数字段比较」**：`.` 拆成整数段逐段比，缺段补 0，`1.2.10 > 1.2.9`。
  **禁止字符串比较**（字符串里 `"1.2.10" < "1.2.9"`，会漏更新 —— 最容易踩的坑）。
- **build 用整数比较**。
- `cmp(currentVersion, minSupportedVersion) < 0` ⇒ `forceUpdate = true`（同时 `updateAvailable=true`）。
- 否则 `cmp(currentVersion, latestVersion) < 0` ⇒ `updateAvailable = true`（可选）。
- 灰度：`stableHash(deviceId) % 100 >= rolloutPercent` ⇒ 本机未进灰度，**可选更新**改回报
  `updateAvailable=false`；**强制更新不受灰度影响**。

### 3.3 服务端取值

- `latestVersion` 默认取**服务端当前部署的 app 版本**（= 根 `package.json` `version` 的生成常量），
  发版后自动变化；可被 `APP_LATEST_VERSION` 覆盖。
- `minSupportedVersion` 由 env `APP_MIN_SUPPORTED_VERSION` 控制（强制底线），默认 `0.0.0`。
- `downloadUrl` 按 `platform`（可再按 `channel`）映射，见 `APP_DOWNLOAD_URLS`（JSON）。
- `rolloutPercent` 按 env，默认 100。

### 3.4 客户端检查时机（所有端统一）

- 启动后**延迟**检查（避开首屏阻塞）。
- **定时**检查（默认 6 小时）。
- **回前台**（`visibilitychange` / `AppState` active）检查。
- 弹提示前**避开进行中任务**（编辑表单/上传/支付中不打断）。
- **同一版本不重复打扰**：已提示版本记下来，除非升级为强制。

**落点**：契约 `packages/shared-schema/src/app-version-contract.ts`；服务端纯逻辑
`server/src/app-version/policy.ts`；路由 `server/src/app-version/app-version.routes.ts`；
生成常量 `server/src/app-version/deployed-app-version.generated.ts`。

---

## 4. 逐端接入（按 heyta 实际栈）

| 端 | 检测实现 | 安装/强制 |
|---|---|---|
| Web / PWA | 定时 + 回前台 `fetch('/api/app-version')`；同时监听 SW `updatefound`（拿到新 SW 后提示「有新版本，点击刷新」并 `skipWaiting` + `controllerchange` 重载） | 重载；强制时拦在首屏路由入口 |
| Electron | 主进程 `app.getVersion()` 上报；启动 + 定时 + 回前台检查；`forceUpdate` 时拦窗口入口 | 打开 `downloadUrl` 由系统安装器接管；Electron 不自行替换二进制 |
| iOS（RN） | `NativeModules` 暴露 `CFBundleShortVersionString`/`CFBundleVersion` 上报 | **不能自更新**：提示 + `Linking.openURL(itms-apps://…)` 跳 App Store；强制靠后端底线 + 拦入口 |
| Android（RN） | 暴露 `versionName`/`versionCode` 上报 | Play 渠道 `immediate`/`flexible`；直装渠道下载 APK 触发系统安装（`versionCode` 必须单调递增、同签名、API 26+ 必须用户点安装） |
| 鸿蒙 | 暴露版本 + 接口 | 上架后用 AppGalleryKit `updateManager.checkAppUpdate`+`showDialog`（check 在 show 之前）；不能静默强装 |

---

## 5. 优先级

- **P0**：服务端接口 + 契约 + 测试；Web/PWA 检测与提示。
- **P1**：桌面 Electron 检测；移动 iOS/Android 检测与提示/跳转。
- **P2**：灰度完善、Web stale-chunk 兜底、鸿蒙上架后接入。

---

## 6. 验收（逐项可执行，跑过才算）

1. **契约测试**：字段齐全、`Cache-Control: no-store`、匿名 200。
2. **版本比较测试**：`1.2.10 > 1.2.9` 判真；build 整数比较正确。
3. **强制/可选语义**：`currentVersion < minSupportedVersion` ⇒ `forceUpdate=true`；仅低于最新 ⇒ `updateAvailable=true`。
4. **灰度**：同一 `deviceId` 多次请求落同一桶；强制更新不受灰度影响。
5. **curl 验证**：对真实起的最小服务端 `curl` 该接口，按 `platform`/`channel` 返回正确、且无缓存。

> 每条的实测读数在提交信息与本节「实测记录」里给出。

### 实测记录

**单测**（`pnpm --filter @heyta/sync-server exec vitest run tests/app-version.spec.ts`）：
26 passed。覆盖数字段比较（`1.2.10 > 1.2.9`）、缺段补 0、build 整数比较、强制/可选、
灰度（同桶恒定 / 强制不看灰度）、env 校验、路由 200/400/`no-store`/字段契约。

**curl**（最小 Fastify 只挂该插件，`http://127.0.0.1:5199/api/app-version`）：

```
env: APP_LATEST_VERSION=0.2.0 APP_MIN_SUPPORTED_VERSION=0.1.0
1) currentVersion=0.1.5  → 200, cache-control: no-store, updateAvailable=true,  forceUpdate=false
2) currentVersion=0.0.5  → 200, cache-control: no-store, updateAvailable=true,  forceUpdate=true
3) currentVersion=0.2.0  → 200, updateAvailable=false, forceUpdate=false
4) 缺 currentVersion      → 400, {"code":"invalid_app_version_query"}
5) currentVersion=1.2.0-beta → 400
6) platform=smartfridge  → 400
```

```
env: APP_ROLLOUT_PERCENT=5（可选更新按 deviceId 稳定分桶）
rollout-out-device(bucket12) / rollout-in-device(35) / device-abc(66) / d-0(62) → updateAvailable=false（未进灰度）
dev-7 / dev-16 / dev-41 (bucket 0)                                            → updateAvailable=true（进了 5%）
同一 deviceId 连打两次 → 结果一致（稳定分桶）
强制（currentVersion<min）在上述设备上一律 forceUpdate=true（灰度不挡强制，见单测）
```

**门禁**：`node scripts/check-public-facts.mjs` → 通过，匿名 GET 清单已含 `/api/app-version`。

---

## 7. 落地状态（实现清单 + 与通用模板的差异）

### 7.1 已落地（可验证）

| 层 | 文件 | 验证 |
|---|---|---|
| 契约 | `packages/shared-schema/src/app-version-contract.ts`（+ `index.ts` 导出） | tsc / 服务端测试引用 |
| 服务端纯逻辑 | `server/src/app-version/policy.ts` | `server/tests/app-version.spec.ts`（26） |
| 服务端配置 | `server/src/app-version/config.ts` | 同上（env 校验、downloadUrl 查表） |
| 服务端路由 | `server/src/app-version/app-version.routes.ts`，`server.ts` 注册于 `/api` | curl 六例 + `check:public-facts` 通过 |
| 服务端发版号 | `scripts/gen-server-app-version.mjs` → `server/src/app-version/deployed-app-version.generated.ts` | `check:app-version-server`（已入 `pnpm check` 链） |
| 客户端核心（跨端） | `packages/app-host/src/app-update.ts`（+ `index.ts` 导出） | `packages/app-host/tests/app-update.spec.ts`（14） |
| Web/PWA | `apps/web/src/features/app-update/{detect,store,AppUpdateNotice}.tsx`、`pwa/register.ts`、`main.tsx`、`App.tsx` | web tsc + vite build；客户端核心打真实接口验证 |
| 桌面 Electron | `apps/desktop/src/app-update-core.ts`、`app-update.ts`、`main.ts` | `apps/desktop/tests/app-update.spec.ts`（7）+ tsc + tsup |
| 移动 RN | `apps/mobile/src/lib/app-update-core.ts`、`app-update.ts`、`App.tsx` | `apps/mobile/tests/app-update.spec.ts`（6）+ mobile tsc 全绿 |

> 鸿蒙走移动端同一套（`platformForOs` 映射 `harmony`），差别只在"上架后用 AppGalleryKit"；
> 微信小程序**本仓库不存在**，不适用。

### 7.2 与通用模板的差异（按项目实际技术栈，不是照抄）

| 模板假设 | heyta 实际 | 本实现 |
|---|---|---|
| 桌面 Tauri v2 + `tauri-plugin-updater` | **Electron**（`@electron/packager`，无或 electron-updater） | `app.getVersion()` + `shell.openExternal(downloadUrl)`，不自行替换二进制 |
| 移动 Capacitor | **React Native** | `Platform.OS` + `HEYTA_APP_VERSION`（无需原生桥）+ `Linking` 跳店/下载 |
| 有微信小程序端 | 无（只有微信支付适配） | 不适用 |
| 路径 `GET /app/version` | 服务端 API 统一挂 `/api` 前缀 | `GET /api/app-version` |
| 版本真源另设 | 已有单一真源（根 `package.json` → `HEYTA_APP_VERSION`） | 复用；服务端再生成一份 `HEYTA_DEPLOYED_APP_VERSION` 作 `latestVersion` 默认值 |

### 7.3 客户端检查时机（三端一致）

启动延迟 15s + 定时 6h + 回前台（web `visibilitychange` / mobile AppState 由现有生命周期驱动）。
Web 额外接 service worker `controllerchange`（新构建接管）即时提示刷新。

### 7.4 尚未完成（诚实登记）

- **鸿蒙真机**：RNOH 构建目标存在但未上架，`AppGalleryKit updateManager` 接入待上架后接（机制已就位，调用同一接口）。
- **桌面原生安装包自更新**：目前是"提示 + 打开下载页"，由系统安装器安装；真正静默替换需引入签名 updater（属平台增强，非本机制缺口）。
- **版本号空间统一**：各壳 `1.0` / 根 `0.1.0` / 服务端 `1.0.0` 的对账仍是未决的产品决定（仓库台账 B11）；本机制通过 `APP_LATEST_VERSION` / `APP_DOWNLOAD_URLS` 让部署方按端配置，不把该决定塞进接口。

### 7.5 汇总实测读数

- 服务端：`server/tests/app-version.spec.ts` 26 passed；curl 六例 + 灰度对照全部符合。
- 客户端核心：`packages/app-host/tests/app-update.spec.ts` 14 passed；打真实接口——真实版本→optional、人为调低→force、最新→none。
- Web：`pnpm --filter @heyta/web build` 成功；`check:ui-language / design-token-refs / i18n-vars / ux-coverage` 通过。
- 桌面：`apps/desktop/tests/app-update.spec.ts` 7 passed；`tsc --noEmit` 通过；`tsup` 构建 `main.cjs` 成功。
- 移动：`apps/mobile/tests/app-update.spec.ts` 6 passed；`apps/mobile tsc --noEmit` 全绿。
- 门禁：`check:public-facts` 通过（匿名 GET 含 `/api/app-version`）、`check:app-version-server` 通过。
