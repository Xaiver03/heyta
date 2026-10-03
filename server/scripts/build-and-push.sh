#!/bin/bash
# SuperSync Server - Build and Push to GitHub Container Registry
#
# 🔧 heyta 改动（2026-10-03，见 docs/research/self-host-distribution-audit.md §8.7）：
# 这个脚本原来是**上游形状**的，带着三个各自都会出事的地方，现在都改了：
#   1. 它自己抄了一份"镜像输入清单"（7 条），其中 3 条在本仓库**根本不存在**，
#      而 `apps/web`、11 个 `packages/*`、`pnpm-lock.yaml`、`server/` 自己**一条都不在里面**。
#      不存在的 pathspec 被 git 静默忽略 ⇒ 它算出的 revision 会**落后于真实输入**，
#      也就是说"新前端配旧标签"那类事故就从这里出来。现在和 `deploy.sh`、
#      发布流水线吃**同一份** `image-inputs.txt`（同一个读者）。
#   2. `GHCR_NAMESPACE` 原来默认成 `super-productivity` —— 那是**别人的组织**。
#      任何配了 `GHCR_TOKEN` 的人跑一次 `pnpm docker:build`，就会把自己构建的镜像
#      推进上游的包命名空间。现在**没有默认值**：不显式给就拒绝开始（见下面 guard）。
#   3. 它原来无论给不给版本号都**顺带覆盖 `:latest`**。`latest` 的含义是"最高那个
#      semver"，而本地脚本无从判断 —— 补发一个旧版本就会把 latest 拽下去。
#      现在只推你点名的那一个 tag。
#
# 官方分发点由 `.github/workflows/heyta-server-image.yml` 决定（那一步要产品负责人拍板）。
# **这个脚本只用于推到你自己的 namespace / fork**，不是第二条官方发布路。
#
# Usage:
#   ./scripts/build-and-push.sh [TAG] [--no-cache]
#
# Examples:
#   GHCR_NAMESPACE=my-ghcr-account ./scripts/build-and-push.sh          # 推成 :latest
#   GHCR_NAMESPACE=my-ghcr-account ./scripts/build-and-push.sh v1.0.0   # 只推 :v1.0.0
#   GHCR_NAMESPACE=my-ghcr-account ./scripts/build-and-push.sh --no-cache
#
# Prerequisites:
#   Add to .env file:
#     GHCR_NAMESPACE=your-ghcr-account   # **必填、无默认**：image owner
#     GHCR_USER=your-github-username     # GitHub *账号*（不能是 org 名）
#     GHCR_TOKEN=your-github-token

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$(dirname "$SERVER_DIR")")"
DOCKERFILE="$SERVER_DIR/Dockerfile"

# 清单里的路径以 server/ 为基准（`deploy.sh` 也是先 cd 到这里再读它）。
cd "$SERVER_DIR"

# Load .env file
if [ -f "$SERVER_DIR/.env" ]; then
    export $(grep -E '^(GHCR_USER|GHCR_TOKEN|GHCR_NAMESPACE)=' "$SERVER_DIR/.env" | xargs)
fi

# Configuration
# GHCR login user: a GitHub *account* with write access to the namespace's
# packages (you cannot authenticate as an org). Required only when pushing.
GITHUB_USER="${GHCR_USER:-}"
GHCR_TOKEN="${GHCR_TOKEN:-}"

# 🔴 保险 2 的可执行版本：namespace **没有默认值**。
# 这一步放在任何 docker 调用**之前**，所以"配错了就直接退出"是当场可验的（不烧一次构建）。
if [ -z "${GHCR_NAMESPACE:-}" ]; then
    echo "ERROR: GHCR_NAMESPACE 未设置 —— 这个脚本刻意不给默认值。" >&2
    echo "       上游那份默认值是 super-productivity（**别人的组织**），照着跑就会把" >&2
    echo "       自己构建的镜像推进上游的包命名空间。" >&2
    echo "       官方镜像由 .github/workflows/heyta-server-image.yml 发布；本脚本只用于" >&2
    echo "       **你自己的** namespace / fork：GHCR_NAMESPACE=<你的 GitHub 账号或组织名> $0" >&2
    exit 1
fi
IMAGE_NAME="ghcr.io/$GHCR_NAMESPACE/heyta-server"


# 镜像输入清单：与 deploy.sh / 发布流水线**同一份、同一个读者**。
# shellcheck disable=SC1091
if ! . "$SCRIPT_DIR/image-inputs.sh"; then
    echo "ERROR: 读镜像输入清单失败 —— 没有它既算不出 revision，也判不了工作树干不干净。" >&2
    exit 1
fi

supersync_image_source_revision() {
    local revision

    revision="$(git log -1 --format=%H -- \
        "${SUPER_SYNC_IMAGE_INPUTS[@]}" 2>/dev/null || true)"
    if [ -n "$revision" ]; then
        printf '%s\n' "$revision"
        return
    fi

    git rev-parse HEAD 2>/dev/null || true
}

assert_clean_supersync_image_inputs() {
    local untracked_files

    # 与 deploy.sh 同一条纪律：源码树不是 git 仓库时（文档里的 rsync 部署形态）
    # 这个检查**没法做**，必须显式跳过并告警 —— 而不是把它当成"有脏文件"。
    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        echo "WARNING: not a git work tree — cannot verify that the image inputs are clean."
        echo "         The image revision label degrades, so this build is NOT traceable."
        return 0
    fi

    if ! git diff --quiet -- \
        "${SUPER_SYNC_IMAGE_INPUTS[@]}" ||
        ! git diff --cached --quiet -- \
            "${SUPER_SYNC_IMAGE_INPUTS[@]}"; then
        echo ""
        echo "ERROR: Refusing to build a labeled supersync image from dirty tracked input files."
        echo "       Commit or stash changes in the image inputs before building."
        echo "       Inputs (one list, read by scripts/image-inputs.sh):"
        printf '%s\n' "${SUPER_SYNC_IMAGE_INPUTS[@]}" | sed 's/^/       - /'
        exit 1
    fi

    untracked_files="$(git ls-files --others --exclude-standard -- \
        "${SUPER_SYNC_IMAGE_INPUTS[@]}" 2>/dev/null || true)"
    if [ -n "$untracked_files" ]; then
        echo ""
        echo "ERROR: Refusing to build a labeled supersync image with untracked input files."
        echo "       Commit, stash, remove, or ignore these files first:"
        printf '%s\n' "$untracked_files" | sed 's/^/       - /'
        exit 1
    fi
}

assert_clean_supersync_image_inputs
VCS_REF="$(supersync_image_source_revision)"

# Parse arguments
TAG="latest"
BUILD_NO_CACHE=false

for arg in "$@"; do
    if [ "$arg" = "--no-cache" ]; then
        BUILD_NO_CACHE=true
    elif [ "${arg:0:1}" != "-" ]; then
        TAG="$arg"
    fi
done

echo "==> SuperSync Build & Push"
echo "    Image: $IMAGE_NAME:$TAG"
echo "    Repo:  $REPO_ROOT"
echo ""

# Step 1: Build image
# 🔴 只打**你点名的那一个** tag。原来这里无论给不给版本号都额外 `-t …:latest`，
# 于是"补发一个旧版本"会把 `latest` 拽下去 —— 而 `latest` 的含义是"最高那个 semver"，
# 本地脚本无从判断。官方 `latest` 的位置由发布流水线的 `latest=auto` 决定（那里能列出全部 tag）。
echo "==> Building image..."
if [ "$BUILD_NO_CACHE" = true ]; then
    echo "    Using --no-cache flag to prevent layer caching"
    docker build --no-cache \
        --build-arg "VCS_REF=$VCS_REF" \
        -t "$IMAGE_NAME:$TAG" \
        -f "$DOCKERFILE" \
        "$REPO_ROOT"
else
    docker build \
        --build-arg "VCS_REF=$VCS_REF" \
        -t "$IMAGE_NAME:$TAG" \
        -f "$DOCKERFILE" \
        "$REPO_ROOT"
fi

echo ""
echo "==> Build complete!"
echo ""

# Step 2: Login to GHCR (if token provided)
if [ -n "$GHCR_TOKEN" ]; then
    if [ -z "$GITHUB_USER" ]; then
        echo "ERROR: GHCR_TOKEN is set but GHCR_USER is empty." >&2
        echo "       Set GHCR_USER to the GitHub account used to authenticate to GHCR." >&2
        exit 1
    fi
    echo "==> Logging in to GHCR..."
    echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin
    echo ""
fi

# Step 3: Push to registry —— 只推上面打的那一个 tag。
echo "==> Pushing to GHCR..."
docker push "$IMAGE_NAME:$TAG"

echo ""
echo "==> Done!"
echo "    Pushed: $IMAGE_NAME:$TAG"
echo ""
echo "    To deploy on server, run:"
echo "    ./scripts/deploy.sh"
