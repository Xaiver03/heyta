# B（桌面端真应用存储 → 壳的 SQLite）：Windows 侧证据

> 采集时间：**2026-09-30**（CST）· 机器：`windows-pc`（Win11，WebView2 `Edg/154.0.4258.37`）
> 上位文档：[`docs/plans/desktop-storage-host-handoff.md`](../../../../docs/plans/desktop-storage-host-handoff.md)

这一组证明的是**一件从界面上看不出来**的事：壳里那个真应用
（`apps/web/dist`，跑在 WinUI 3 壳的 WebView2 里）把数据放在了
**壳自己的 `%LOCALAPPDATA%\heyta\heyta.sqlite`**，而不是 WebView 自己的 OPFS。
两条路都能让所有界面断言变绿 —— 所以判据必须落在**进程外**与**重启之后**。

## 三份产物各证明什么

| 文件 | 它证明 | 怎么来的 |
|---|---|---|
| `shell-evidence.txt` | 🔴 **页侧自己报告用了壳的存储**：`STORAGE=shell` + `STORAGE_HOST=on` | 壳在 M2-D 探针里用 `ExecuteScriptAsync` 读页侧的 `globalThis.__heytaStorage.backend` 后写下（`MainWindow.xaml.cs` 的 `WriteEvidence`）。`DB_DONE/DB_TOTAL=-1` 是**按设计**：存储宿主模式下引擎在页侧，壳数不出来 |
| `db-scan-from-outside.txt` | 🔴 **那条数据真的在那个文件里** —— 用 PowerShell 直接扫 `heyta.sqlite` / `heyta.sqlite-wal` 的字节，不需要 sqlite3 CLI | `scripts` 里没有它；命令是把一段 PS 脚本 scp 上去跑的（关键点：应用持着库 ⇒ 必须 `FileShare.ReadWrite`；SQLite 的 TEXT 与建表 SQL 都是**字面存储**，所以字节级 UTF-8 扫描既能找到载荷、也能确认 `CREATE TABLE "ops"` 在） |
| `b-persist-after-restart.png` | 🔴 **重启之后它还在，且界面真的画出来了**（人已看过：`收集箱=1`、任务行 `B-shell-storage-1790759433473` 可见；头像仍是未登录态） | 判据脚本 `scripts/verify-shell-storage-windows.mjs --expect <标题>` 在**关掉应用再重开**之后跑 |

## 为什么"重启之后还在"这条最关键

那条任务是在**只走壳存储**的那一轮里建的 —— **那一轮的 WebView OPFS 从没见过它**。
所以重开还能看到它，**只可能**来自壳的 SQLite。
只跑"写进去"那一步会漏掉"进程一关就没了"这一类失败。

## 「OPFS → 壳」的一次性导入（同一条判据链，四份产物）

已装过 heyta 的人，数据在 **WebView 自己的 OPFS** 里（那是 `sqlite` 后端那条路建的）。
把存储交给壳之后，**必须**有一次性的导入 —— 否则他们看到的是**一个空应用**，
而那是比崩溃更难挽回的一类故障。这一组就是它的判据链：

| 文件 | 它证明 |
|---|---|
| `import-1-legacy-write.txt` | 在**存储宿主关掉**的那一轮写了一条（`BACKEND=sqlite` ⇒ 数据落 OPFS） |
| `import-2-shell-db-before.txt` | 🔴 此刻**壳的库里没有它**（`title=False`）—— 两份存储确实是分开的（这正是 B 要解决的形状） |
| `import-3-after-import.txt` | 带上 `-ShellStorage` 重开 ⇒ `BACKEND=shell` 且 **`titleCount: 1`** |
| `import-4-shell-db-after.txt` | 🔴 从**壳外**扫 ⇒ `title=True` / `ops_table=True`：那条数据**现在在壳的 SQLite 里** |
| `import-5-after-restart.png` | 人已看过：重启后的冷启动里那条 `B-legacy-…` 就在界面上 |

⚠️ 要让这条链成立，**OPFS 必须跨启动存活** —— 而验收用的启动脚本每轮都会清 publish 目录，
profile 又恰好落在里面。实测两条路都**不通**：`WEBVIEW2_USER_DATA_FOLDER` 不生效；
`CoreWebView2Environment.CreateAsync` 在这个 WinAppSDK 工程里不可用（`CS1501`）。
⇒ 最后改成**启动脚本在 publish 时保留并恢复** `<pubDir>\HeytaWindows.exe.WebView2`
（这也正是装好的应用天然具备的"profile 跨升级存活"）。

### 注入验证（这条判据不是空转）

把 `await migrateLegacyOpfsSqlite(session.store)` 拿掉、重打产物、**重跑同一条链**：

```
$ node scripts/verify-shell-storage-windows.mjs --expect B-legacy-1790760602922
BACKEND=shell
❌ 找不到那条任务（titleCount=0，当前共 0 行）。
```

⇒ **同一份判据在"有导入 / 无导入"下给出相反结论**。这才是它能承重的证据。
（同一轮里 `import-3` 是 `titleCount: 1`。）

## 如实记边界（别读多）

1. **还在 WAL 里**：扫描显示 `MAIN bytes=4096`（只有文件头）、`WAL bytes=168952`。
   也就是说 schema 与数据当前都在 `-wal` 里，**尚未 checkpoint 回主库**。
   这是 SQLite WAL 的正常行为（我的采集方式是 `Stop-Process -Force`，
   等于 `TerminateProcess`，进程没机会跑关闭时的 checkpoint），
   而 **`-wal` 是数据库的一部分**，不影响"数据在壳的 SQLite 里"这个结论。
   ⚠️ 若要更强的"主库文件自带"判据，需要让应用**优雅退出**后再扫一次 —— 未做。
2. **跑的是自包含 exe，不是 MSIX 打包态**：为了让 `HEYTA_WEB_ROOT` /
   `HEYTA_SHELL_STORAGE` 生效必须这样（打包态是 app 模型启动，环境变量传不进去）。
3. **存储宿主默认仍是关的**（`HEYTA_SHELL_STORAGE=1` 才开）：它还缺
   **OPFS → 壳的一次性导入**，翻默认之前必须先做 —— 见 handoff §5。
4. **只验了 Windows**。macOS 壳（WKWebView，**没有 CDP**）还没接。
