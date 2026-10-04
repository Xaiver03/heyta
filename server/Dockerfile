# ---- Builder stage ----
FROM node:24-alpine AS builder

# 🔧 heyta 改动：Alpine 仓库源可覆盖。
#
# 默认仍是官方 CDN，所以在能直连 Alpine 的机器上行为完全不变。
# 但在国内主机上 `dl-cdn.alpinelinux.org` 会**连不上**，而 `apk add` 不设超时，
# 表现为 `docker compose build` **永久卡在这一步且没有任何输出**
# （实测：官方 CDN 超时无响应，mirrors.aliyun.com 0.26s 返回 200）。
#
# 部署时用 `APK_MIRROR=mirrors.aliyun.com`（见 docker-compose.build.yml）
# 覆盖，而不是往仓库里写死一个地域性的镜像 —— 那会让别处的自建者拿到慢源。
ARG APK_MIRROR=dl-cdn.alpinelinux.org

WORKDIR /repo

RUN set -eux; \
    if [ "$APK_MIRROR" != "dl-cdn.alpinelinux.org" ]; then \
      sed -i "s|dl-cdn.alpinelinux.org|${APK_MIRROR}|g" /etc/apk/repositories; \
    fi; \
    apk add --no-cache openssl libc6-compat

# 🔧 heyta 改动：上游这里用 `npm ci`。
# heyta 的工作区定义在 pnpm-workspace.yaml（不在 package.json 的 `workspaces` 字段），
# npm 根本看不到它是一个 monorepo，所以必须改用 pnpm。
# 版本与根 package.json 的 `packageManager` 保持一致。
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

# 根工作区文件 + 各包的 package.json（先只拷清单，让依赖层可缓存）
# ⚠️ `tsconfig.base.json` 也必须拷：`packages/domain` 的 tsconfig 是
# `"extends": "../../tsconfig.base.json"`，少了它 tsup 的 dts 构建会报
# `TS5083: Cannot read file '/repo/tsconfig.base.json'`。
# sync-core / shared-schema 不 extends 任何东西，所以少了它**只有 domain 会炸**。
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/sync-core/package.json ./packages/sync-core/
COPY packages/shared-schema/package.json ./packages/shared-schema/
COPY packages/domain/package.json ./packages/domain/
COPY server/package.json ./server/

# 安装整个工作区的依赖。
# --frozen-lockfile：锁文件与清单不一致时**直接失败**，而不是悄悄换版本。
#
# 🔧 heyta 改动：npm registry 可覆盖，理由与上面的 APK_MIRROR 完全同形。
# 在连不上 registry.npmjs.org 的主机上，`pnpm install` 会一路 `error (23)` 重试
# 到超时（实测 356/360 之后 TimeoutError，整层构建作废），而这一层不作废缓存，
# 所以**每次重试都从零开始**。registry.npmmirror.com 实测 0.79s 可用。
#
# 默认仍是官方 registry：换源只影响"从哪取包"，不影响锁文件里记录的 tarball 完整性
# 校验，所以 `--frozen-lockfile` 的保证不被削弱。
#
# ⚠️ 必须用 `pnpm config set registry`，**不能**只给 `npm_config_registry` 环境变量：
# 实测后者被 pnpm 忽略，包**照旧从 registry.npmjs.org 取**
# （日志里 `GET https://registry.npmjs.org/… error (23)`），于是还在同一处超时。
# 锁文件里没有任何硬编码 URL（`grep registry.npmjs.org pnpm-lock.yaml` = 0），
# 所以取包地址完全由配置决定 —— 把配置真的设上就行了。
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN pnpm config set registry "$NPM_REGISTRY" \
 && pnpm install --frozen-lockfile --ignore-scripts

# 拷贝源码
COPY packages/sync-core/ ./packages/sync-core/
COPY packages/shared-schema/ ./packages/shared-schema/
COPY packages/domain/ ./packages/domain/
COPY server/ ./server/

# 先构建 sync-core，再构建 shared-schema，最后 domain —— 顺序不能反，每个都依赖前一个
WORKDIR /repo/packages/sync-core
RUN pnpm run build

# 🔧 heyta 改动：tarball 名字随包名变化。
# 包名是 @heyta/sync-core，`pnpm pack` 产出 heyta-sync-core-<version>.tgz（去掉 scope）。
RUN pnpm pack

WORKDIR /repo/packages/shared-schema
RUN pnpm run build
# Pack shared-schema to tgz for installation in production
RUN pnpm pack

# 🔧 heyta 改动：domain 也必须在这里构建并打包。
#
# `server/package.json` 声明了 `@heyta/domain`，而 `server/src/billing/*` 真的 import 它
# （`extendSubscriptionPeriod` 等）。少了这一段，构建会在
# `tsc` 阶段报 `TS2307: Cannot find module '@heyta/domain'`。
#
# ⚠️ 这个缺口**潜伏过一段时间**：镜像里原来只有 sync-core + shared-schema，
# 而当时 server 还没 import domain，所以构建一直是绿的；
# 直到 billing 开始用 `@heyta/domain`，**镜像就再也构建不出来了**，
# 而本地 `pnpm -r build`（工作区全都在）完全看不出问题 —— 典型的"只有换台机器才炸"。
WORKDIR /repo/packages/domain
RUN pnpm run build
RUN pnpm pack

# 构建服务端
WORKDIR /repo/server
RUN pnpm exec prisma generate
RUN rm -rf dist && pnpm run build

# ---- Web stage（共享 UI）----
#
# ## 为什么镜像里必须有它
#
# 自建者 `docker compose up` 起来之后**没有任何界面可用** —— 镜像里只有 `/api/`，
# 而 heyta 的界面是一个独立的前端产物（`apps/web/dist`），此前**从来没有进过镜像**：
# 我们自己线上那份是靠 `vite build --base=/app/` 手动打包再 rsync 到 nginx 的
# （`docs/runbooks/deployment.md` §3.7）。所以"一条 compose 起全套"这句话
# 在补上这一段之前**根本不成立**。
#
# 同类项目里可比对的六家有五家把前端 bake 进服务端镜像（Vaultwarden / Immich /
# Uptime Kuma / Vikunja / Actual，逐家出处见 `docs/research/self-host-distribution-audit.md` §5）。
# 这也是唯一能让"一条 compose + 打开浏览器就能用"成立的形态：
# 界面与 API 同一个容器 ⇒ 同一个 origin（没有 CORS 那一类事故）、版本天然配对。
#
# ## 为什么在这里构建，而不是 COPY 宿主上打好的 dist
#
# 根 `.dockerignore` 里有一行 `**/dist` —— 宿主上打的产物**根本进不了构建上下文**。
# 这不是疏漏（带上开发者的旧产物会让"跑旧镜像配新迁移"那类事故换个面目重来）。
# 结论：`docker compose build` 必须能只靠源码打出界面，所以在容器里构建。
#
# ## 为什么是一个独立的阶段而不是塞进 builder
#
# builder 那一层的缓存被服务端镜像的每一层依赖着。把 web 的源码 COPY 混进去之后，
# **改一行 UI 会让服务端也重新构建**。分阶段还有一个硬好处：
# 这一层的失败点（前端打不出来）在服务端失败点之外是**独立可辨**的。
FROM node:24-alpine AS web

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

# 先只拷清单，让依赖层可缓存（与 builder 阶段同一套做法）。
#
# 🔴 下面这 13 个包**就是 `@heyta/web` 的工作区依赖闭包**，不是"顺手多拷几个"：
# `pnpm install --frozen-lockfile` 看到 `@heyta/ui: workspace:*` 而 `packages/ui/package.json`
# 不在，会直接报找不到 workspace 清单。少一个包 = 构建红，且红得看不出来为什么。
# `packages/legal` 不在列表里 —— web 不依赖它。
#
# ⚠️ 新增 `@heyta/*` 依赖时必须同时在这里加两行（清单 + 源码）。
# 这条约束的失败方向是**构建失败**（不是静默产出坏界面），所以没有配门禁；
# 但 `apps/web/tests/pwa.spec.ts` 与 `scripts/check-web-artifact.mjs` 会拦住产物层的问题。
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/ai/package.json ./packages/ai/
COPY packages/app-host/package.json ./packages/app-host/
COPY packages/design-system/package.json ./packages/design-system/
COPY packages/domain/package.json ./packages/domain/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/local-api/package.json ./packages/local-api/
COPY packages/op-log/package.json ./packages/op-log/
COPY packages/shared-schema/package.json ./packages/shared-schema/
COPY packages/storage/package.json ./packages/storage/
COPY packages/sync-client/package.json ./packages/sync-client/
COPY packages/sync-core/package.json ./packages/sync-core/
COPY packages/ui/package.json ./packages/ui/
COPY packages/widget-core/package.json ./packages/widget-core/
COPY apps/web/package.json ./apps/web/

# registry 可覆盖的理由与 builder 完全同形（那里有实测数据）。
# 同理必须用 `pnpm config set`，`npm_config_registry` 环境变量会被 pnpm 忽略。
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN pnpm config set registry "$NPM_REGISTRY" \
 && pnpm install --frozen-lockfile --ignore-scripts

# 源码 + 那条自洽判据（`scripts/` 根脚本零依赖，可以单拷）。
COPY packages/ai/ ./packages/ai/
COPY packages/app-host/ ./packages/app-host/
COPY packages/design-system/ ./packages/design-system/
COPY packages/domain/ ./packages/domain/
COPY packages/i18n/ ./packages/i18n/
COPY packages/local-api/ ./packages/local-api/
COPY packages/op-log/ ./packages/op-log/
COPY packages/shared-schema/ ./packages/shared-schema/
COPY packages/storage/ ./packages/storage/
COPY packages/sync-client/ ./packages/sync-client/
COPY packages/sync-core/ ./packages/sync-core/
COPY packages/ui/ ./packages/ui/
COPY packages/widget-core/ ./packages/widget-core/
COPY apps/web/ ./apps/web/
COPY scripts/check-web-artifact.mjs ./scripts/

# 🔴 挂载路径必须是**构建参数**：产物里 `index.html` 引用的资源前缀、manifest 的
# `start_url`/`scope`/图标路径、`sw.js` 的注册 URL 全由它决定。
# `HEYTA_WEB_BASE=/app/` 与运行时 `WEB_APP_PATH` 的默认值必须一致 ——
# 下一行的判据就是专门用来抓"两边不一致"的（它从产物自身反推挂载路径）。
#
# `--filter "@heyta/web..."`（三个点）= web 本身 + 它的全部工作区依赖，
# 由 pnpm 按拓扑序构建。写成 `-r build` 会去构建这个仓库里**所有**包（含没装依赖的）。
RUN HEYTA_WEB_BASE=/app/ pnpm --filter "@heyta/web..." run build

# 产物自洽判据在**构建现场**跑一次，而不是只在 CI 跑：
# 这一层能拦住"镜像里的界面挂在 /app/ 下打不开"这一整类事故，
# 而那类事故此前只在真浏览器里才现形（§7 第 82 条：一致地错也能对账通过）。
RUN node scripts/check-web-artifact.mjs --dist apps/web/dist --mount /app/

# ---- Runtime stage ----
FROM node:24-alpine AS production
ARG VCS_REF=unknown
# 与 builder 阶段同源；见那里的注释。两个阶段各自声明，因为 ARG 不跨阶段继承。
ARG APK_MIRROR=dl-cdn.alpinelinux.org

LABEL org.opencontainers.image.revision=$VCS_REF

# System deps for Prisma & healthcheck + create user BEFORE copying files
RUN set -eux; \
    if [ "$APK_MIRROR" != "dl-cdn.alpinelinux.org" ]; then \
      sed -i "s|dl-cdn.alpinelinux.org|${APK_MIRROR}|g" /etc/apk/repositories; \
    fi; \
    apk add --no-cache openssl libc6-compat wget && \
    addgroup -g 1001 -S nodejs && \
    adduser -S supersync -u 1001 -G nodejs && \
    mkdir -p /app/data && chown supersync:nodejs /app /app/data

WORKDIR /app

# Copy built artifacts from builder (note: tsconfig rootDir is "." so structure is dist/src/ and dist/scripts/)
# 🔧 heyta 改动：源路径 packages/super-sync-server/ → server/
COPY --from=builder --chown=supersync:nodejs /repo/server/dist ./dist
COPY --from=builder --chown=supersync:nodejs /repo/server/public ./public
# Templates live OUTSIDE public/ on purpose: @fastify/static serves that whole directory,
# so a template left there is downloadable at /privacy.template.html — which would republish
# the very statements the generator suppresses when an operator has not configured them.
COPY --from=builder --chown=supersync:nodejs /repo/server/templates ./templates
COPY --from=builder --chown=supersync:nodejs /repo/server/prisma ./prisma
COPY --from=builder --chown=supersync:nodejs /repo/server/scripts ./scripts
COPY --from=builder --chown=supersync:nodejs /repo/server/src ./src
COPY --from=builder --chown=supersync:nodejs /repo/server/package.json ./package.json
# 🔧 heyta 改动：共享 UI 产物进运行时镜像。
#
# 目标目录名 `/app/web-dist` 与挂载路径 `/app/` 的**默认值**住在
# `server/src/config.ts`（`webAppDir` / `webAppPath`），这里**故意不再写一遍 `ENV`** ——
# 同一个值抄两处就会漂，而漂了的后果是"镜像里有界面但没人去读它"（静默无效，不报错）。
# web 阶段末尾那条 `check-web-artifact --mount /app/` 判的是**产物自己声明**的路径，
# 所以"这两个默认值不一致"会在构建期变红，不需要靠这里两份注释互相提醒。
COPY --from=web --chown=supersync:nodejs /repo/apps/web/dist ./web-dist
# 🔧 heyta 改动：tarball 名字 sp-* → heyta-*
COPY --from=builder --chown=supersync:nodejs /repo/packages/sync-core/heyta-sync-core-*.tgz ./sync-core.tgz
COPY --from=builder --chown=supersync:nodejs /repo/packages/shared-schema/heyta-shared-schema-*.tgz ./shared-schema.tgz
COPY --from=builder --chown=supersync:nodejs /repo/packages/domain/heyta-domain-*.tgz ./domain.tgz

# Install dependencies and generate Prisma client in single layer
# Note: prisma CLI installed explicitly for runtime migrate deploy
# IMPORTANT: prisma version must match @prisma/client in package.json
#
# 这里仍然是 npm（不是 pnpm），**刻意的**：
# 服务端 package.json 里三个工作区依赖都写成 `"*"`，npm 能用上面三个 tarball 满足它们；
# 写成 `workspace:*` 的话 npm 会直接报错。这一点很容易踩，别改。
#
# ⚠️ `domain.tgz` 必须一起装：它自己还依赖 `@heyta/shared-schema`，
# 而 `pnpm pack` 会把 domain 的 `workspace:*` 改写成真实版本号 ——
# 所以两个 tarball 要在**同一条** `npm install` 里给，npm 才能就地满足它。
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN npm install ./sync-core.tgz ./shared-schema.tgz ./domain.tgz --registry="$NPM_REGISTRY" --ignore-scripts --omit=dev && \
    npm install --registry="$NPM_REGISTRY" --ignore-scripts --omit=dev && \
    npm install prisma@5.22.0 --registry="$NPM_REGISTRY" --ignore-scripts --omit=dev && \
    npx prisma generate && \
    rm -f sync-core.tgz shared-schema.tgz domain.tgz && \
    npm cache clean --force

USER supersync

EXPOSE 1900

ENV NODE_ENV=production
ENV PORT=1900
ENV DATA_DIR=/app/data
ENV RUN_MIGRATIONS_ON_STARTUP=false
# Keep V8 old-space below the cgroup mem_limit (768m in production compose) so
# GC starts before cgroup OOM-kill. RSS = old-space + new-space + code cache +
# native heap + ArrayBuffers, so headroom matters. 576 ≈ 75% of 768m.
ENV NODE_OPTIONS=--max-old-space-size=576

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

CMD ["sh", "-c", "if [ \"${RUN_MIGRATIONS_ON_STARTUP:-false}\" = \"true\" ]; then sh scripts/migrate-deploy.sh || exit 1; fi; exec node dist/src/index.js"]
