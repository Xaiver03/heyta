# Windows 冻结候选：原位升级已完成

- 包版本：1.0.0.1；Identity/Publisher 保持 cloud.finlaw.heyta.desktop / CN=heyta local build。
- 临时复用既有打包流水线，仅改变安装为保数据升级、进程过滤、一次性投递、测试包版本递增。仓库产品源码和安装脚本没有为本次操作修改。
- ADD_APPX=OK / RESULT=OK / M2D=OK / SHORTCUT_OK=True；共享唯一事实检查器 5 条通过。
- 安装前后 default heyta 与包 LocalState 文件数和整体SHA摘要完全一致：UPGRADE_DATA_UNCHANGED=True。三枚独立 profile QA 进程仍在，本轮未停止。
- 安装目录中 web-dist 全部26文件逐字等于受控树；native-bridge 等于受控构建输入；Core/独立 Provider 的5份DLL/EXE与 staged 字节相等。
- 包 manifest 包含独立 Provider ExeServer 与 today/quadrant/habits/focus 四模板。小组件语言35项独立smoke已通过；没有验证实际 Widgets Board。
- 签名状态 Valid，签名者/颁发者均 CN=heyta local build：这是自签名测试包，并非公开可信发布证书；其他机器需先信任随包CER。
- MSIX 195,873,256 B，SHA256 `126dad13692ffd71accc13fbb50ff8329a5914ea559fbbe2374b36bdc01feaae`；本地回传和远端字节一致。
- 产物：`dist/windows-auth-legal-frozen/heyta.msix` 与 `heyta-selfsigned.cer`。
- 人眼查看完整安装副本 `installed-dpi-full.png`（1440×734），真实用户会话 AppsFolder 启动、路径核验为安装目录、DPI aware，无cmd遮挡；联网同意弹窗及菜单内容完整。原流水线1152×587截图裁切，不拿它验美观。

## 已实际解决的构建操作问题

1. 首次旧调用被PowerShell策略拒绝，未构建。后续沿既有进程级ExecutionPolicy Bypass，系统policy未改。
2. 临时任务日期需yyyy/MM/dd；首尝试只补投递、不重编。
3. Windows以0x80073CFB拒绝不同内容同版本1.0.0.0，即使ForceUpdateFromAnyVersion。保存失败事实后，仅递增测试包版本至1.0.0.1，同身份原位升级成功。绝不卸载。

本证据只覆盖此次Windows候选及安装。不是整个Goal完成、不是四端统一冻结来源的声明，也未验证新的Android设备安装。
