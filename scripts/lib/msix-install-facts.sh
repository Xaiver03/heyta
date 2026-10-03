# 🔴 单一所有者：Windows MSIX 装完之后，取证文件里**必须**出现的几条判据。
#
# 为什么抽出来（与 `sync-windows-sources.sh` 同一个理由）：这两处以前各写一份 ——
# `reinstall-all.sh` 用一份四项清单判"装上的当前源码是真应用"，
# `package-msix.sh` **一条都不判**（它 `scp … || true`，取证文件缺失也继续往下走）。
# 于是：
#   ① 直接跑打包脚本（`pnpm --filter @heyta/desktop-windows …` / CI）时，
#      `RESULT=INSTALL_FAILED` 也照样以退出码 0 收场；
#   ② 新增一条判据（桌面快捷方式）只加进了生成它的那一侧，读它的另一侧**看不见**，
#      清单从两处开始就一定会漂。
# 现在只有一份定义，两侧都调它。判据的**来源**是
# `apps/desktop-windows/scripts/install-and-capture.ps1` 写进取证文件的行；
# 那条脚本自己的 `exit 1` 传不上来（ssh 输出走管道、schtasks 又是异步投进交互会话），
# **所以必须在这里判文件，而不是判退出码。**

# 每一项都是 `键=值` 的字面形状，逐条在取证文件里找。
MSIX_REQUIRED_FACTS=(
  "ADD_APPX=OK"                 # 装上了（Add-AppxPackage 成功）
  "RESULT=OK"                   # 起来了、截了图、窗口尺寸非空
  "PAYLOAD_WEBDIST=True"        # 包里带真共享 UI，否则装的是通道试验页
  "M2D=OK"                      # 壳自己的身份菜单判据（第一项=登录/注册）
  "SHORTCUT_OK=True"            # 桌面上有一个回读过的 .lnk，target 走 shell:AppsFolder
)

# msix_check_facts <取证文件>
#   stdout：缺哪几条（或"全部在位"的读数）；返回 0 = 全在位，1 = 有缺。
# 🔴 匹配形状是**整行**，不是子串（2026-10-04 现量）：子串匹配会让一行散文判绿 ——
# 拿 `注：期望 SHORTCUT_OK=True 未满足` 喂进来，旧写法报"5 条全在位"。
# 生产侧现在不会打印这种句子（五个键都是 `$lines += ('KEY=' + 值)` 的整行形状），
# 但"判据能被一句文案满足"本身就是没有牙，而且将来任何一次加日志都可能踩到。
# 取证文件是 Windows 侧写的（行尾 \r），所以先 `tr -d '\r'` 再 `-x` 整行比，
# 两个方向都不能松：不剥 \r 就永远匹配不上（假红），不整行比就挡不住散文（假绿）。
msix_check_facts() {
  local facts_file="$1"
  local missing="" fact

  if [ ! -f "$facts_file" ]; then
    echo "取证文件不存在：${facts_file}"
    return 1
  fi
  for fact in "${MSIX_REQUIRED_FACTS[@]}"; do
    tr -d '\r' < "$facts_file" 2>/dev/null | grep -qxF "$fact" || missing="$missing $fact"
  done
  if [ -n "$missing" ]; then
    echo "缺判据：${missing# }（${facts_file}）"
    return 1
  fi
  echo "判据齐了：${#MSIX_REQUIRED_FACTS[@]} 条全在位"
  return 0
}
