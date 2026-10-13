# Android 最新冻结候选构建完成

经唯一 `scripts/run-gradle.mjs assembleRelease` 在 Windows 打包机执行：BUILD SUCCESSFUL in 3m 21s，rc0。没有在 Mac 运行 Gradle。

- 本轮首次前置检查正确拒绝远端缺失新增 `@heyta/legal` 链接；经 pnpm.cmd 对移动依赖子图离线 frozen-lockfile 安装且 ignore-scripts，rc0，再调用唯一入口。
- 实际同步 tar SHA256 `3de6e414aaa9243f6b5bffa9b6176f21b2d47777f24548a3fe2afb1e44e4c371`；捕获506枚移动源码/资源与workspace dist构建输入，属于超集而非逐枚入APK声明；AuthScreen源码与tar逐字一致。
- 远端构建起点2026-10-08T10:14:42Z；APK实际完成时间2026-10-08T10:18:04.3059991Z。helper将本地mtime按整秒回写，不声称亚秒相同。
- APK 68,878,328 B；本地=远端 SHA256 `26d39bc0ca06d13e6000a363649cdf56f42d52d9a4fc0e6f2c3e4d0dbb36d115`。
- apksigner verify rc0，v2有效，签名DN CN=heyta, OU=Mobile, O=Xiaoli Creativity Culture Industry, L=Hangzhou, ST=Zhejiang, C=CN；RSA4096；证书SHA256 c46d0386179c3cef12582d1347ed2f871eb03a64aaa2bff96511c1cb76062556，与此前项目发布证书一致，非Android Debug证书。
- APK内Hermes bundle 7,894,548 B，SHA256 `29dc4ad071550c0ab44be2ca8136ae3eff0c461c54b59ba9bcbb3a14309c8741`，魔数前16字节 `c61fbc03c103191f620000005784681b`。
- 原生widget单测此前135/135已通过；本轮仅认证/法律/共享UI变化，未重复原生单测。

产物：`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`。
本Agent没有adb安装、没有清用户数据、没有验证新包设备运行。这一格由主线程继续验收；本证据不是整个Goal或四端最终交付完成。
