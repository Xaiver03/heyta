本次 MSIX 构建未启动。远端 PowerShell 拒绝调用外置脚本（PSSecurityException / UnauthorizedAccess），SSH 的 rc=0 不能代表构建成功。没有新包、没有安装动作。后续改为既有脚本的进程级 `-ExecutionPolicy Bypass`，系统执行策略保持原样。
