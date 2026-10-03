# shellcheck shell=bash
# 镜像输入清单的唯一读者。**被 source，不执行。**
#
# source 之后得到：
#   SUPER_SYNC_IMAGE_INPUTS          数组，路径相对于**调用方的当前目录必须是 server/**
#   SUPER_SYNC_IMAGE_INPUTS_LIST     清单文件本身的绝对路径（报错时用它）
#
# 消费者（两边必须是同一个读者，否则 revision 会漂）：
#   · server/scripts/deploy.sh
#   · .github/workflows/heyta-server-image.yml
#
# 🔴 读空必须失败，不许"什么都不检查地继续"。这个数组吃四段判断，而数组为空时
# `git log -1 --format=%H --` 回的是 HEAD（对任何镜像都说"匹配"），
# `git diff --quiet --` 退化成"整个仓库脏才报错"。两种都不会响，只会让这四段
# 判断从此只证明它们自己跑过。所以下面两条失败分支是**判据**，不是输入校验的仪式。

_IMAGE_INPUTS_SELF="${BASH_SOURCE[0]}"
_IMAGE_INPUTS_SERVER_DIR="$(cd "$(dirname "$_IMAGE_INPUTS_SELF")/.." && pwd)"
SUPER_SYNC_IMAGE_INPUTS_LIST="$_IMAGE_INPUTS_SERVER_DIR/image-inputs.txt"

if [ ! -r "$SUPER_SYNC_IMAGE_INPUTS_LIST" ]; then
    echo "ERROR: 镜像输入清单读不到：$SUPER_SYNC_IMAGE_INPUTS_LIST" >&2
    return 1
fi

SUPER_SYNC_IMAGE_INPUTS=()
_image_inputs_line=""
while IFS= read -r _image_inputs_line || [ -n "$_image_inputs_line" ]; do
    # 去首尾空白（bash 3.2 没有 `$'…'` 的 trim，用双层参数展开）。
    _image_inputs_line="${_image_inputs_line#"${_image_inputs_line%%[![:space:]]*}"}"
    _image_inputs_line="${_image_inputs_line%"${_image_inputs_line##*[![:space:]]}"}"
    case "$_image_inputs_line" in
        '' | '#'*) continue ;;
    esac
    SUPER_SYNC_IMAGE_INPUTS+=("$_image_inputs_line")
done <"$SUPER_SYNC_IMAGE_INPUTS_LIST"

if [ "${#SUPER_SYNC_IMAGE_INPUTS[@]}" -eq 0 ]; then
    echo "ERROR: $SUPER_SYNC_IMAGE_INPUTS_LIST 里一条路径都没读出来（清单被读空了）。" >&2
    return 1
fi

# 🔴 不存在的 pathspec 是**静默忽略**的（`git log -- 存在 不存在` == `git log -- 存在`，
# rc 都是 0；`git diff --quiet -- 不存在` 恒真）。所以"清单里写了个不存在的名字"
# 这个错误的两个方向都不报 —— 它唯一的表现是那份输入不再参与算 revision。
# 这里把它变成会响的：每一项都必须存在。`.` 指 server/ 自身，同样存在。
for _image_inputs_path in "${SUPER_SYNC_IMAGE_INPUTS[@]}"; do
    if [ ! -e "$_image_inputs_path" ]; then
        echo "ERROR: 镜像输入清单里有一项不存在：$_image_inputs_path" >&2
        echo "       （不存在的 pathspec 会被 git 静默忽略，所以这一项等于没在清单里 —— 见上）" >&2
        return 1
    fi
done

unset _image_inputs_line _image_inputs_path
unset _IMAGE_INPUTS_SELF _IMAGE_INPUTS_SERVER_DIR
