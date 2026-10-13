# Android候选构建与原生小组件单测（2026-10-08）

仅从受控树通过既有 `scripts/run-gradle.mjs` 走 Windows 构建，没有在Mac运行Gradle，没有adb安装/卸载，没有清用户数据。候选尚不代表Goal最终四端统一发布。

第一次真实运行：` :app:testDebugUnitTest --tests com.heytamobile.widget.* assembleRelease`，11套/135项，1失败、0错误、0跳过。`GoldenFixtureSmokeTest` 用POSIX斜杠字符串判断目录尾部，在Windows真实canonicalPath反斜杠上失败。测试夹具目录存在，其他解析断言通过。此趟rc=1、APK未产出；失败日志、JUnit XML归档和源码输入身份留在 `attempt-1/`。

主线程将断言改为原生 `Path.endsWith(Paths.get(...))` 后，从新源码包完整同步并重复同一条命令。第二次rc=0：Gradle `BUILD SUCCESSFUL in 3m 56s`，11套/135项全过，0失败/错误/跳过；每枚JUnit XML时间均晚于本趟远端构建起点，修复后的夹具测试源码SHA与实际传入tar一致。

Release APK：

- 位置：`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`。
- 大小：68,273,188 B。
- 远端/本地SHA-256一致：`4ba659d599c66b9506e49167d1df1563328540d081c7a02091ac4925962de57f`。
- 远端完成时间：`2026-10-08T08:21:16.5698658Z`；helper按秒回写本地mtime为 `2026-10-08T08:21:16Z`。保留真实精度差异，不声称亚秒值完全相等。
- `apksigner verify --verbose --print-certs` rc=0；v2签名通过；CN=heyta，证书SHA-256为 `c46d0386179c3cef12582d1347ed2f871eb03a64aaa2bff96511c1cb76062556`。
- APK内真实Hermes bundle长度7,289,408 B，SHA-256为 `ced48c79450e2406c31f3d3c6092d9c16107c4d487522565184b631da87270e9`。

第二趟源码tar SHA-256：`f12b56cd1149b59e20ed7fa512f24b3d52e56fc7d783b1b30deeee5659df36b3`，远端与本地逐字对账。`attempt-2/source-inputs.json` 从实际tar捕获506枚mobile/Android与workspace-dist/fixture输入SHA，排除iOS和证据目录；这是构建输入的捕获超集，不声称每个文件都被链接进APK，也不拿当前HEAD替代未提交工作树身份。

本轮Mac打包专段同时发生修复，因此没有宣称四端使用同一冻结树。此APK尚未在设备上安装，交互级回归、各端重装与上传由主线程继续收口。原始完整日志留在 `/tmp/heyta-android-candidate-20261008{,-attempt2}.log`；本目录副本只隐去Windows用户目录名，保持任务、结果与错误内容。全部JUnit XML保留在归档中。
