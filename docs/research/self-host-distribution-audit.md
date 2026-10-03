# 自托管分发：核实另一份结论，以及这条路该怎么走

> 类型：调研记录（结论与证据；要拍板的三件事在 §6，本文不下结论）
> 日期：2026-10-03
> 起因：产品负责人转来另一份 AI 关于「三个面 + 下一步是发布镜像」的结论，要求逐条核实并做更深调研
> 方法：仓库内逐 file:line 复核（不采信转述）+ 六同类项目一手文档 + 大陆可达性来源

---

## 1. 逐条核实

| 他的断言 | 结论 | 证据 |
|---|---|---|
| 官方实例配了 SMTP，本轮默认 `REQUIRE_EMAIL_VERIFICATION=true` 那条路一个字节没变 | ✅ 成立 | `server/src/config.ts:287`（默认 true）、`server/tests/self-host-email-verification.spec.ts:224` 这条用例的名字就是这个断言本身 |
| ① 托管首屏只有「邮箱 + 口令」，第二格不用填 | ✅ 成立 | `apps/web/src/features/auth/AuthPanel.tsx:278`（地址栏只在 `isUnconfigured` 时给）、`:176`（给的时候也是预填值） |
| ③ 自托管使用者只看到一格地址，登录方式与托管同一套 | ✅ 成立，且比他说的更严 | 表单唯一一份在 `@heyta/ui` 的 `AuthForm`（`AuthPanel.tsx:9-23` 记了 484/403 两份手写表单合并的来龙去脉）；每个动作第一个参数都是 `baseUrl`（`:444-482`） |
| ② 外人自托管只有「克隆 + 自己打包」一条路 | ✅ 成立 | 全仓只有 1 枚 git tag（`ai-remediation-fork`，与发布无关）；`.github/workflows` 只有 `ci.yml` 一个 `verify` job，**没有任何镜像构建/推送**；`server/docker-compose.yml:36` = `supersync:local` |
| 仓库对外可达（克隆这条路的门开着） | ✅ 成立，他没说但值得钉 | `apps/landing/src/lib/repo.ts` 记 2026-09-29 转公开；匿名 `GET https://github.com/Xaiver03/heyta` → 200 |
| `docker-compose.yml:36` / `:27` / `server/README.md:42` / `env.example:62` | ✅ 四处行号逐字对得上 | 见那些行 |
| 「配置面其实已经齐了」 | ⚠️ **半对，但漏了最贵的一块** | 见 §2.2 |
| 「镜像的 entrypoint 或一个 init 容器要负责迁移」 | ❌ **不成立——这两样都已经存在** | 见 §2.1 |
| 「发布镜像不是 push 一下的事，成本在升级路径」 | ✅ 方向对，但成本落点写错了 | 见 §5 |

---

## 2. 三处必须更正

### 2.1 迁移职责不存在「要新加」，它已经落在三个地方

| 载体 | 位置 | 干什么 |
|---|---|---|
| 镜像内 entrypoint | `server/Dockerfile:170` | `RUN_MIGRATIONS_ON_STARTUP=true` 时先 `sh scripts/migrate-deploy.sh` 再 `exec node`。**注意跑的是我们那个处理 CONCURRENTLY 的脚本，不是 `prisma migrate deploy`** |
| K8s | `server/helm/supersync/templates/deployment.yaml:43-46` | initContainer `migrate-db` 跑同一个脚本 |
| 主机部署 | `server/scripts/deploy.sh:386-406` | 换应用容器**之前**起一次性 migrator 容器跑同一个脚本，另有镜像源码版本核对（`:241-291`） |

默认值是 `false`（`server/docker-compose.yml:50`、`Dockerfile:161`），而理由在 `server/README.md:75-88`：容器启动时的自动迁移默认关，**是为了防止应用重启与部署迁移器互相踩**，不是为了省事。

⇒ 所以真正待决的不是「要不要加迁移职责」（有），而是**「公开发布时，单容器 compose 的默认档要不要改成启动即迁移」**。这两件事的成本完全不同：前者是写代码，后者是承诺一个语义。

### 2.2 缺的不是镜像，是客户端——发镜像只把「半条路」发出去

他列「配置面已经齐了」时数了 Caddyfile、compose、env.example、helm、`ALLOWED_EMAILS`。这一串里**没有一个是客户端**：

- `server/Caddyfile:23` 只有一个 `reverse_proxy supersync:1900`，整份文件没有任何静态资源；
  ⚠️ **这一条已被 §8 的实现推翻**（2026-10-03）：界面由**服务端自己**挂，Caddy 那条 blanket
  `reverse_proxy` 本来就把 `/app/` 一起带过去了 —— 所以 Caddyfile **不需要改**，
  这不是遗漏。原来把它列成"缺的东西"是因为那时服务端确实没有这个挂载。
- `server/public/` 只有五张凭据页的脚本，`server/src/server.ts:135` 把整个 `public/` 挂出去，**没有 `/app/`**；
  ⚠️ 同样过期：`server/src/server.ts:591` 现在调 `registerWebApp(...)`，挂载路径由
  `WEB_APP_PATH` 决定、产物目录由 `WEB_APP_DIR` 决定（实现见 `server/src/web-app.ts`，§8）。
- 全仓没有任何 Dockerfile / compose / 部署脚本引用 `apps/web/dist`（我们自己的线上应用是**本机 `vite build` + rsync 到 `/var/www/heyta-app/`**，`docs/runbooks/deployment.md:455-468`；那份 nginx 站点配置**当时**只在服务器上，同文 `:425` —— 这句到 2026-09-28 已过期，现在纳管在 `server/deploy/nginx/`，由 `server/scripts/nginx-sync.sh` 对账）；
- 移动端也没有对外产物：落地页「平台」那页自己写着「这一页叫平台状态，不叫下载……没有下载按钮」（`apps/landing/src/pages/PlatformsPage.tsx:5,12`）。COS 桶里确实传过 0.0.0-dev 的包（`docs/runbooks/app-distribution.md:57`），但**没有任何对外入口指向它**。

⇒ 外人今天即使拿到镜像、跑起服务端，**手上仍然是一个没有界面的 API**。这是这条路的主要长度来源，而它和「发不发镜像」是两个独立问题。

⚠️ 这句在写下的当天成立，**现在不成立**（2026-10-03，§8）：从本仓库 `docker compose up`
起来的那台实例**自带界面**（服务端在 `/app/` 托管同一次构建里的 `apps/web` 产物）。
仍然成立的后半句是「和发不发镜像是两个独立问题」—— 而且它更真了：今天**没有发布镜像**，
所以这条路对外仍然要靠"自己从源码构建"，而构建出来的东西现在是完整的。

补一条会挡路的已知缺陷：`apps/web/vite.config.ts` 里**没有 `base`**，挂载路径靠命令行 `--base=/app/` 传（`deployment.md:465,471`）；同时 PWA 的 `/sw.js` 与 manifest 里 `start_url/scope/icons` 全是根绝对路径，在 `/app/` 子路径下会落回落地页（`deployment.md` §3.7「还没做的」，登记至今**未修**）。⇒ 要把界面塞进镜像，**必须先把挂载路径变成构建参数**，否则打出来的包在子路径下是坏的。

⚠️ **这条前置已经做完**（2026-10-03，`257d4b3e` + 本文 §8）：`base` 进了 `vite.config.ts`
（构建参数 `HEYTA_WEB_BASE`），PWA 的 `SW_URL` 与 manifest 三项改成随 `base` 走。
判据不是"看起来对了"：`e2e/selfhost-stack/selfhost-web.spec.ts` 的 S1 在**真容器**里断言
`/app/manifest.webmanifest` 200、SW 注册成功且 `scope` 就是 `/app/`，截图人看过。
`deployment.md` §3.7 那句「还没做的」同批改写。

### 2.3 他说「要登记的缺口」，但那三条已经在页面上当着外人说错了

不是「将来会过期」，是**现在就与代码矛盾**（词条在 `packages/i18n`，中英各一份）：

| 键 | 页面上现在的话 | 事实 |
|---|---|---|
| `site.docs.selfhost.s2i1` | 「heyta **没有**邮箱+密码这条路，注册与登录都得点邮件里的链接」 | 有。口令注册/登录是主路：`AuthPanel.tsx:154-155`，决策见 [ADR-0040](../adr/0040-email-password-auth-decoupled-from-e2ee.md) |
| `site.docs.selfhost.s2i1` / `s8i6` / `site.help.a.selfhost` | 「不开通邮件服务就**注册不了**」 | 只对默认档成立。`REQUIRE_EMAIL_VERIFICATION=false` 时注册当场可用、一封都不发（`server/tests/self-host-email-verification.spec.ts:142-178`）；发不出去时界面也不再谎称「去查收邮件」（`AuthPanel.tsx:351`） |
| `site.docs.selfhost.s7p1` | 「想把版本钉住，就把 `SUPERSYNC_IMAGE` 显式指到某个 `master-〈提交号〉`」 | 🔴 **这条是在教用户做我们自己注释里明令否掉的事**：那个标签是上游 Super Productivity 的代码，而 heyta 的服务端已改造（实体清单、迁移、E2EE 强制），「拉上游镜像跑的是别人的代码，而且看起来一切正常」（`server/docker-compose.yml:27-33`）。用户照这句做，拿到的是**能起来、能响应健康检查、但跑的是别人 schema 的服务器** |

这三条都属于本仓已经定性的「界面对用户说谎」那一类（同批先例：落地页曾写着「邀请好友送会员」而没有任何一张表记住谁邀请了谁）。

**为什么没有当场改**：`packages/i18n/src/locales/zh-CN.ts` 与 `en.ts` 此刻有并行会话未提交的改动（各 +8/+5 行，与自建无关）。点名路径提交会把他人在途词条一起提走。改法已在 §7 备好可直接落盘的字符串。

---

## 3. 本次调研另外查出来的两条（与发不发镜像无关，都更便宜）

**3.1 落地页那个「打开自建指南」按钮指向的是内部机器清单。**
`apps/landing/src/lib/repo.ts` 里 `SELF_HOST_GUIDE_URL` 指向 `docs/runbooks/local-server-verification.md`。那份文件标题是「本地跑通同步服务端（不依赖 Docker）」，是给 **P0 验收**写的，§0 是一张**本团队 Linux 机器表**（SSH 别名、公网 IP、哪一台同时是 heyta 的公网部署机）。落地页对外的承诺是「要逐条执行的命令、依赖与配置文件都写在自建指南里，跟着跑一遍就能起来」（`landing.selfhost.guide.body`）——**那份文档里既没有面向陌生人的部署路径，又把内部运维现场暴露在公开仓库的公开页面上**。

对外人真正能用的那份是 `server/README.md`（Quick Start 到 `deploy.sh`、`--build` 的内存代价、迁移语义、P3018/P3009 处置都在）。

> 暴露面这件事本身不建议顺手删：仓库公开后「哪些内部运维细节该摘」是一条**政策**，要连 `AGENTS.md` 与 `deployment.md` 里的同批内容一起判（那里也写着同一枚公网 IP）。登记在 §7，待裁决。

**3.2 落地页的口径与文档中心的口径互相打脸，而且是同一站点的两页。**
自建区标题：「自己的服务器，**一条命令**的事」（`landing.selfhost.title`）+「一条 docker compose 起全套」（`landing.selfhost.step1.body`、`site.integrations.selfhost.body`）。
文档中心同一件事：「它是『自己运维一套服务』，**不是一个命令就完事**」+「目前**没有发布任何现成镜像**」（`site.docs.selfhost.sum`、`s1i1`）。
后者是诚实的、也是对的。前者是一句营销话。仓库里既有判据（`apps/landing/tests/public-copy-register.spec.tsx` 管语域，不管事实对错），所以这种矛盾不会被门禁抓到。

---

## 4. 别人是怎么做的（一手来源，2026-10-03 查）

| 项目 | 前端谁打包 | 迁移谁跑 | 镜像发布 | tag 形态 |
|---|---|---|---|---|
| Vaultwarden | **bake 进服务端镜像**（README 自述 "Modified Web Vault client (Bundled within our containers)"） | 启动时 | Docker Hub + ghcr + quay 三处 | `x.y.z` / `latest` / `testing` |
| Immich | **bake 进 server 镜像**（compose 里没有独立 web 服务） | **启动时**（官方升级文档："Immich will make some changes to the DB during startup"） | GHCR + Docker Hub | 只改 `IMMICH_VERSION` 换版本 |
| Uptime Kuma | **bake** | 启动时（knex） | Docker Hub | `louislam/uptime-kuma:2` |
| Vikunja（任务管理，最贴近 heyta） | **前端在同一镜像内**，compose 只要 vikunja + db | **启动时自动迁移** | Docker Hub `vikunja/vikunja` | `latest` + 滚动 `2`/`2.7` + `2.7.0` |
| Joplin Server | 无 Web 客户端（界面在各端原生壳里）——**与 heyta 形态最像，但它有已发布的商店应用** | 启动时 | Docker Hub + ghcr | `latest`/`beta`/`2`/逐级 |
| Actual Budget | **bake** | 启动时 | Docker Hub | `latest`/`nightly`/`edge`/`sha-<commit>` + CalVer |

来源：https://github.com/dani-garcia/vaultwarden 、https://docs.immich.app/install/upgrading 、https://github.com/louislam/uptime-kuma 、https://vikunja.io/docs/docker-walkthrough 、https://github.com/laurent22/joplin/blob/dev/packages/server/README.md 、https://hub.docker.com/r/actualbudget/actual-server/tags

**四条一致的规律**（这几个项目里没有一个例外）：

1. **有 Web 界面的都把前端 bake 进服务端镜像**。"一条 compose 起全套 + 打开浏览器就能用" 是靠这一条做到的，不是靠多个容器。
2. **迁移全部在启动时跑**，没有一家用 initContainer/migrator 容器。原因很实在：它们都按单副本部署设计。⇒ heyta 现在的 `false` 默认是**为多副本与部署脚本安全**做的选择，与「单条 compose 就能起来」这个自托管诉求**方向相反**，这是同一个决定的两面，不是可以两边都要的。
3. **tag 是三件套**：精确版本 + 滚动 major/minor + `latest`。而 K8s 官方文档明写生产应避开 `:latest`（https://kubernetes.io/docs/concepts/containers/images/）。⇒ 上游只发 `latest`/`master-<sha>` 恰恰是反面样本，他引这一点是对的。
4. **没有一家提供迁移回滚工具**。一致的姿势是「升级前备份 + 出问题恢复备份 + roll-forward only」。**heyta 的文档已经写了这一条**（`site.docs.selfhost.s9p1`、`s4p1`）——这一项我们不欠。

**大陆可达性**（他完全没提，但对 heyta 的目标用户这是一半的难度）：

- Docker Hub 直连自 2024-06 起不可靠 —— 这是**社区实测口径，没有官方公告**（https://linux.do/t/topic/106856 、https://eastondev.com/blog/zh/posts/dev/20251217-docker-mirror-guide-2025/）；ghcr.io 同为「难连」。
- 第三方 pull-through mirror（`docker.m.daocloud.io`、`docker.xuanyuan.me` 这类）**无 SLA、随时关停**——我们自己的部署文档也已经在用它（`docs/runbooks/deployment.md` §3.8 那两个「都不能省」的镜像源）。
- 阿里云 **ACR 个人版官方明文：仅限开发测试、不得用于生产、无 SLA、每账号 1 实例、需个人实名**（https://help.aliyun.com/zh/acr/user-guide/create-a-container-registry-personal-edition-instance）⇒ **不能当公开分发通道**。企业版付费。
- ⇒ 「发布一个公开镜像」≠「大陆用户拉得到」。可承诺的最多加三层：官方源发 GHCR/Hub；文档教用户**自己配** pull-through 或海外反代；不把任何第三方公共 mirror 写成官方分发点。

**供应链签名**：buildx 原生支持 `--provenance/--sbom`，GitHub 有 artifact attestations（https://docs.docker.com/build/metadata/attestations/ 、https://docs.github.com/en/rest/repos/attestations）。但上表六家里没一家把它作为首发前提——它们靠「release tag ↔ 镜像一一对应 + Actions 可追溯」承担同等责任。⇒ 可后置。

---

## 5. 真实成本落在哪里（和他的判断不同的地方）

他说成本是「本仓 §4 那条 `migrate deploy` 会 25001 失败，所以 entrypoint 或 init 容器要负责迁移，还得能停在旧版本回滚」。逐项核：

| 他点名的成本 | 实际情况 |
|---|---|
| 迁移要新加进 entrypoint | ❌ 已经有了（§2.1，三处）。**真成本**是「默认档要不要改」这个语义决定 |
| 要能停在旧版本 | ✅ 而且比想的容易：`server/prisma/migrations` 里 **2026-09 之后没有任何真实的 `DROP COLUMN/TABLE`**（命中行全是 `--` 回滚说明注释；真破坏性迁移都在 2026-08 前，且 `server/README.md:133` 明文禁 `DROP TABLE`）⇒ schema 层可以停在旧版本。缺的是**没人写过兼容政策**（全仓搜「支持矩阵 / N-1 / roll-forward」在服务端语境下**零命中**） |
| 缺的成本（他没数） | ① **客户端形态**——§2.2，这是主要长度（✅ 2026-10-03 已落：界面进镜像、服务端挂 `/app/`，见 §8）；② **挂载路径先变成构建参数 + PWA `/app/` 那条已知未修**（✅ 同批已修，判据是真容器里的 S1，见 §8.1/§8.2）；③ **发布流水线本身不存在**（`ci.yml` 只有 verify）；④ **大陆可达性不是发一次就有的**；⑤ **镜像的依赖树不是门禁扫的那棵树**（`server/Dockerfile:147-152` 用 `npm install` 从 tarball 装生产依赖，而 `research/tools/license-inventory.mjs:54-55` 扫的是根/e2e 两个 **pnpm store**）⇒ 公开发布产物时，许可证门禁证明的不是那个产物的依赖集。这条我**未证实**是否真的会漏（server 是根工作区成员，理论同源），要跑一次镜像内 `npm ls` 与 store 的差集才算结论（→ G-45，本批**仍未量**） |

---

## 6. 要拍板的三件事（本文只给台阶，不下结论）

**D-1 自托管的客户端形态**（这条不定，D-2 发了也只是半个产品）
- **A. 前端 bake 进服务端镜像，挂在 `/app/`**（六家里五家的做法，也是唯一能让「一条 compose + 打开浏览器就能用」成立的形态）。代价：先做挂载路径构建参数化 + 修 PWA 那条；客户端与服务端从此版本耦合（Immich 靠明文「只兼容同 major 客户端」把耦合变成政策）。
- **B. 不带客户端，明说「用官方 Web 壳连你自己的服务端」**。技术上今天近乎可用（同步地址是自由文本、认证地址同源回落在 web 上成立），但要对方把 `CORS_ORIGINS` 加上我们的站点，而且**与产品自己的话冲突**——文档中心已经写了「自建之后，你就是那个能看到元数据的人」（`s3w1`），让用户依赖我们托管的界面就是把这句话收回去。
- **C. 独立发一个静态前端镜像**（两个 artifact）。好处是客户端能独立更新；代价是零预算项目要维护两条发布线，而业界几乎没人这么做。
- 我的倾向：**A**。B 与自己写的隐私承诺冲突，C 把成本压在恰好最没资源的维度上。**但 A 的前置（挂载参数化 + PWA）比发镜像本身更早、更该做**，因为它同时也是我们自己线上那个已知坏着的 PWA 入口。

**D-2 要不要现在承诺「一条 compose + 一个公开镜像」**
这是「给别人一条升级路径」的开关。开了就长期欠：tag 政策、升级说明、支持边界一句话、镜像依赖树的许可证对账。
技术上离得并不远——**前提是 D-1 先定**。

**D-3 单容器 compose 的迁移默认档**
默认 `false` 保护的是多副本与 `deploy.sh`，代价是「`docker compose up -d` 之后跑在未迁移的表结构上」（`server/README.md:85-88` 自己承认）。业界全是启动即迁移。要么改成 compose 里加一次性迁移服务（`depends_on: {condition: service_completed_successfully}`，语义上等价于 helm 那个 initContainer，两边口径就统一了），要么维持现状并在对外文档第一屏写「不要用 `docker compose up`，用 `./scripts/deploy.sh`」。后者今天的文档里**有**（`s7p2`），但它埋在第七节。

✅ **本批已收口**（2026-10-03，§8.6）：**两条一起做了**，因为它们是同一句话的两半 ——
一次性服务做成**显式 override 文件**（默认服务图一个字节没动，`deploy.sh` 的 migrator 仍独占升级路径），
而「受支持入口是 `deploy.sh`、bare `up -d` 会起在未迁移表结构上、以及那个 override 只在第一次开机迁移」
三句一起提到了 `server/README.md` 的第一屏。判据不再是文档里的一句话：`pnpm verify:selfhost-stack`
现在**数得出** 42 个迁移目录 / 42 个已应用迁移名 / 0 条悬挂，并且同时断言应用容器自己的
`RUN_MIGRATIONS_ON_STARTUP` 当场是 `false`（否则"迁移由一次性服务完成"这个结论不成立）。

**顺带一条我的判断**：他问「自托管默认要不要邮箱验证」。默认实现（与托管一致、关掉是显式选择）与本仓既有立场同构——`s1i4`「不给用默认密钥上线留活路」、取值写错**报错**不静默。反面选择（默认关）会让 `ALLOWED_EMAILS` 从可选变必配。这一条不需要拍板，**现在的选择是对的**，只是要按 §2.3 把文案改准。

---

## 7. 缺口登记

| 编号 | 内容 | 归属 |
|---|---|---|
| G-40① | `site.docs.selfhost.s2i1` / `s8i6` / `site.help.a.selfhost` 三条「没有邮箱+密码这条路 / 不配邮件就注册不了」已与代码矛盾（中英各一份） | 词条层，等 `packages/i18n` 上并行会话的改动落地后立刻改，改法在下面 |
| G-40② | `s7p1` 教用户把 `SUPERSYNC_IMAGE` 指向上游 `master-<sha>`，与 `docker-compose.yml:27-33` 的裁决相反 | 同上 |
| G-40③ | 落地页「打开自建指南」指向含内部机器清单的 P0 验收 runbook | 需一份面向陌生人的 `docs/runbooks/self-host.md`（依赖 D-1/D-3） |
| G-40④ | 自建区标题「一条命令的事」与文档中心「不是一个命令就完事」同站互相打脸 | 依赖 D-2 |
| G-40⑤ | 无任何镜像发布流水线；`server/package.json` 是 1.0.0 而根包 0.0.0，无版本来源约定 | 依赖 D-2 |
| G-40⑥ | 服务端无版本兼容/支持矩阵政策（行业一致形态见 §4 第 4 条） | 依赖 D-2 |
| G-40⑦ | 镜像生产依赖由 `npm install` 安装，许可证门禁扫的是 pnpm store | **已证实：不是同一棵树**，差 16/143 条（2 个 name 门禁从没见过，含 Alpine 实际装的那枚原生二进制；14 条同名不同版本）。现量与对账见 §8.8；`pnpm check:image-license` 已挂进 `pnpm check`。**闭合（把树钉住）另立 G-47** |
| G-40⑧ | 公开仓库里含内部主机 SSH 别名与公网 IP，且被落地页直链的文档带出 | 政策问题，要与 `AGENTS.md`/`deployment.md` 同批判 |

### G-40①② 的落盘改法（中英各一条，可直接抄）

`site.docs.selfhost.s2i1`
- zh：`邮件服务：默认**必须配**，否则注册会被挡住。可以把这道门显式关掉（`REQUIRE_EMAIL_VERIFICATION=false`），关掉后注册当场可用、一封都不发——代价是"证明你收得到这个邮箱"这一环没有了，任何人都能用任意邮箱建号，找回密码也就找不到真人。`
- en：`SMTP: required by default — registration is blocked without it. You may explicitly lower the gate (`REQUIRE_EMAIL_VERIFICATION=false`); registration then works immediately with no mail sent. The cost: nothing any longer proves the address is yours, so anyone can register with any address and password recovery cannot reach a real person.`

`site.docs.selfhost.s8i6`
- zh：`` `SMTP_*`：发信配置。口令注册与登录不依赖它，但邮箱验证、找回密码、魔法登录链接依赖它——默认档下这一组不配好就注册不进来。``
- en：`` `SMTP_*`: outgoing mail. Password sign-up and sign-in do not need it, but email verification, password recovery and magic login links do — under the default gate, nobody can register with this group unset.``

`site.help.a.selfhost`：把末句「而且**不配邮件服务就注册不了**」改成「不配邮件服务就得**显式关掉邮箱验证这道门**（代价是任何人都能用任意邮箱建号）」；「没有发布任何现成镜像（要自己构建）」保持原样——这句仍然对。

`site.docs.selfhost.s7p1`
- zh：`目前**没有任何发布镜像**。不要把 `SUPERSYNC_IMAGE` 指向上游的 `master-〈提交号〉`：那是 Super Productivity 自己的服务端代码，实体清单、迁移、加密强制都已经和 heyta 分叉——它会正常启动、健康检查正常，跑的却是别人的 schema。要版本钉住，就从本仓库源码构建并在构建时传入那份源码的版本标识。`
- en：`No images are published. Do **not** point `SUPERSYNC_IMAGE` at upstream `master-<commit>` tags: that is Super Productivity's own server, whose entity list, migrations and encryption enforcement have diverged from heyta — it starts fine and passes health checks while running someone else's schema. To pin a version, build from this repository and pass that revision as the build's version label.`

改词条要连着做的三件：中英同步、`pnpm --filter @heyta/i18n build`（§7 #79）、`pnpm check:entries` 前重跑 `gen:entries`，并在线上重新发布落地页才算数（页面改词条不会自己上线）。

---

## 8. 2026-10-03 本批实际落地了什么（台阶 1 前置 + 台阶 1 本体）

上面几节写的是**当时的距离**。这一节写已经缩短的部分，逐条给"现在能重跑的证据"，不写"已完成 ✅"就算数。

### 8.1 界面进了镜像，由服务端自己挂

| 面 | 落地 | 判据（可重跑） |
|---|---|---|
| 挂载路径成为构建参数 | `apps/web/vite.config.ts:241` 的 `base: webBase()`，取值来自 `HEYTA_WEB_BASE`（`vite.config.ts:225-235`，首尾必须都带斜杠，不合法**直接抛**而不是猜） | `pnpm check:pwa`；`server/tests/web-app-serving.spec.ts` |
| PWA 在子路径下落回落地页 | `SW_URL` 与 manifest 的 `start_url/scope/icons[]` 随 `base` 生成 | `e2e/selfhost-stack/selfhost-web.spec.ts` S1：在**真容器**里断言 `/app/manifest.webmanifest` 200 + `content-type: application/manifest+json` + SW 注册成功且 `scope === '/app/'`，且控制台零报错 |
| 前端产物进服务端镜像 | `server/Dockerfile` 的 `web` stage 从源码构建 `@heyta/web`（`.dockerignore` 的 `**/dist` 禁止用宿主机产物，所以镜像里没有"悄悄带上旧包"这条路），落到 `/app/web-dist` | 一条命令的验收：`pnpm verify:selfhost-stack` |
| 服务端托管 | `server/src/web-app.ts` 的 `registerWebApp` / `resolveWebAppMount`，挂在 `WEB_APP_PATH`（默认 `/app/`）；`server/src/server.ts:591` 接线 | `server/tests/web-app-serving.spec.ts`；`WEB_APP_DIR=`（空）时**只跑 API**，那条逃生门要真的能关 |
| compose / env.example | `WEB_APP_DIR` / `WEB_APP_PATH` 进 `supersync.environment`，用 `${VAR-default}`（**不带冒号** —— 空串在这里有语义） | `pnpm check:server-env`（G-41） |
| Caddyfile | **没改，这是对的**：它那条 blanket `reverse_proxy supersync:1900` 本来就带 `/app/` | §2.2 已就地更正 |

### 8.2 三条判据的真浏览器验收

`pnpm verify:selfhost-stack`（`scripts/verify-selfhost-stack.sh` + `e2e/playwright.selfhost.config.ts`）：一条命令 → 临时 `.env`（写在仓库外）→ 从源码构建镜像 → `docker compose up` → Playwright 跑 S1/S2/S3 → 截图 → 拆掉。实测 `3 passed`，截图逐张看过。

- **S1** 打开 `/app/`：界面画出来、manifest 200、SW scope 对、控制台零报错。
- **S2** 在这台实例上注册并登录：断言 `creds.baseUrl === new URL(BASE).origin` —— 这是「同一个容器 = 同一个 origin」的**产品级**判据，它要是漂到别的域名，自托管用户就是在往**别人的**服务器登录。界面上还要看得见（头像菜单里的邮箱 = 刚注册的那个），而截图必须等 `.ht-material` 的入场动画落位（`opacity === 1`）再拍 —— 第一版拍在半透明那一帧，看着像"面板没有背景"这个**不存在的**缺陷。
- **S3** 建一条任务 → 点同步 → 已同步 → **全新 context（= 刚装好的新设备）登录后能读到它**。服务端只有密文，所以"新设备读得到"是这条路上唯一诚实的断言。

### 8.3 这一轮顺手修掉的五个真缺陷（都不是为了让测试变绿）

1. 🔴 **`checking` 阶段把"还没问到"说成"要重新确认"**（G-43）：S3 第一次点同步拿到「条款文本已经更新…」，而服务端对同一账号已答 `needsReconfirm:false`。修在共享闸门 `packages/app-host/src/legal-recheck.ts` 新增 `settled()`，两个宿主在**判之前**等答案落地。不变量「`checking` 期间不出境」**没动** —— 动掉的只是"拦截有资格被叙述成裁决"这一条。三层都做了注入验证（把 `await settled()` 拿掉 ⇒ 精确报出那句谎）。
2. `verify-selfhost-stack.sh` 用 `docker logs | grep -q` 做前置判定：**命中了也报"没挂载界面"**。`pipefail` 下 `grep -q` 让 `docker logs` 吃 SIGPIPE ⇒ 退出码 141 ⇒ 判据自己骗人。改成先捕获进变量再 `case` 匹配（§7 #45 那一族的第五种面目）。
3. 随机 `POSTGRES_PASSWORD` + 残留的 postgres 卷 ⇒ 容器 `P1000` 崩溃循环（官方镜像在**非空**数据目录上跳过初始化，密码永远改不过来）。`up` 之前显式 `down -v --remove-orphans`。
4. 一次性凭据文件在 BSD 上 `mktemp -t` 留下字面 `XXXXXX`；并加了两条"写盘那一步"的自检：文件必须非空、目标路径**不许在仓库里**。
   ⚠️ **本条原来还记了一句错话，现在就地撤回**：它写着"heredoc 重定向时 stderr 会印一行 `...: Permission denied` 并跟着一个与本仓库无关的路径，而写入其实成功了 —— 那是 CLI 沙箱夹层的产物，别被那行带走"。**不是夹层**。真相见 §8.6：那个 heredoc 的**注释里带了反引号**，未加引号的 `<<EOF` 把它当命令替换执行了。我当天把一条真缺陷判成了环境噪声。

5. `check-server-env-forwarding.mjs` 自己的两处放水（见 G-41）：① 第一层把**注释里的键名**算成消费者 —— 把 `- WEB_APP_DIR=…` 删掉它照样不报；② 三层判定各调一次 `fail()`，而 `fail()` 里面是 `process.exit(1)` ⇒ 一次运行只披露**最浅那一层**，真正致命的"src 读它、容器收不到"被挡在后面。改成判定用去掉注释的那一份 compose，且三层全跑完再一起退。变异复跑现量：**14 个孤儿 + 13 个错位，一次全打印，exit 1**。

### 8.4 新增缺口登记

| 编号 | 内容 | 状态 |
|---|---|---|
| G-41 | `env.example` 文档化的旋钮与 compose 的白名单之间没有对账 ⇒ "照着文档填了值"与"什么都没填"逐字相同 | **本批关闭**：`pnpm check:server-env`（已挂进 `pnpm check`）。现量读数见 `server/scripts/check-server-env-forwarding.mjs` 文件头；11 条豁免逐条带理由，且"豁免项必须仍然没有通路"本身是判据 ⇒ 这张表只能变小、不能变成谎话 |
| G-42 | 自建区的四条错话（§2.3 / §7） | **未关**：`packages/i18n` 此刻仍被并行会话占着（工作树 `zh-CN.ts`/`en.ts` 有未提交改动）。改法已在 §7 备好，等它空出来直接落；不点名路径提交把他在途词条一起提走 |
| G-43 | `checking` 期间宿主把拦截叙述成裁决（界面对用户说谎） | **本批关闭**（§8.3 第 1 条） |
| G-44 | `appVersion` 在服务端**有消费者、没有生产者**：`server/src/sync/checkpoint-gate.ts` 拿它判 `MIN_CHECKPOINT_SAFE_APP_VERSION`，`sync.service.ts:676 touchDevice` 把它记进 `sync_devices`，而它是**下载请求上的一个可选查询参数**（`packages/shared-schema/src/supersync-http-contract.ts:191` 是 `z.string().optional()`）—— `packages/sync-client/src/client.ts:1324-1327` 只往查询串里写 `sinceSeq` 与 `excludeClient`，**没有任何 heyta 客户端发过它** | **未关**（本批只把它写成事实）。后果是那条闸门对自家客户端恒等于"未知版本"，所以 §8.5 的版本政策**不能**写成 N-1/major 矩阵，只能写成触发条件 |
| G-45 | 台阶 3（镜像 npm 依赖树 vs 许可证门禁扫的 pnpm store）曾是**未证实** | **本批量完并关成"有对账"**（§8.8）：`check:image-license` 逐条对账 + 四条会红的登记自检，7 发变异各自精确报红、阳性对照绿。残余风险（纯传递依赖上游发新版）已改挂 G-47 |
| G-46 | `server/scripts/build-and-push.sh`（`pnpm --filter @heyta/server docker:build` 的唯一实体）原来是**上游形状**：它自己抄了一份 7 条的镜像输入清单，其中 3 条在本仓库不存在（实测 `[ -e ]` 全不成立），而 `apps/web` / 11 个 `packages/*` / `pnpm-lock.yaml` / `server/` 自己**一条都不在里面**；`GHCR_NAMESPACE` 默认成 `super-productivity`（**别人的组织**）；并且无论给不给版本号都**顺带覆盖 `:latest`** | **本批关闭**（§8.7 第 4 条）。三条各自都会出事，都已改：清单改成 source 同一个读者、namespace 无默认值（不给就在任何 docker 之前 exit 1）、只推点名的那一个 tag。⚠️ 消费者集合是量过的：除 `server/package.json:14` 外只有 `server/tests/migration-sql.spec.ts:345` 读它，而那一发在 `it.skip` 里 ⇒ **不报错也不守** |
| G-47 | 镜像那棵依赖树**没有被钉住**：`check:image-license` 证明的是"2026-10-03 这一次 npm 解析结果的 143 条逐条有出处"，而每次构建 npm 都会重解一遍（没有 lockfile）。改直接依赖会红，**纯传递依赖的上游发新版不会** | **未关**（本批只登记）。闭合形状是现成的：生产阶段换成 `pnpm deploy --prod` ⇒ 三个 `workspace:*` 由 pnpm 内联、三枚 tgz 的 dance 一起消失、镜像的树**就是** `pnpm-lock.yaml` 的树 ⇒ 门禁与产物同源，`check:image-license` 与快照应当**撤掉**（不是改成读另一个文件）。代价：动生产镜像的装配路径，要单独一轮真构建复验（`pnpm verify:selfhost-stack` 全跑） |



### 8.5 版本耦合写成政策（台阶 1 本体的最后一项）

落在 `server/README.md`「Clients and version coupling」，形态是**两句真话 + 一条触发条件**：

- 镜像里的客户端与服务端**天然同一份源码、同一次构建** ⇒ 这一对不存在兼容问题；对账方式是 `VCS_REF` 构建参数与 `deploy.sh` 的 revision 核对。
- 其他形态的客户端（移动壳 / 桌面壳）**必须来自同一份源码版本** —— 因为 E2EE + op-log 语义下，服务端从设计上读不到明文，任何"降级兼容"都只能在**看得见的元数据**上做，判不了数据。
- 🔴 **不写"支持 N-1 / 同 major"的矩阵**，因为①今天没有任何发布产物（矩阵无人可引用），②`appVersion` 有消费者没生产者（G-44），矩阵**技术上无法被执行**。触发条件写死在文档里：**第一枚镜像发布时，G-40⑤（版本来源）与 G-44（生产者）必须同时落地**，矩阵才能从"政策"变成"事实"。

### 8.6 D-3：一次性迁移做成显式 override，并把"第一次开机才迁移"这件事说破

`server/docker-compose.migrate-once.yml`（新文件，**默认服务图一个字节没动**）加一个 `supersync-migrate`：
`restart: 'no'` + 与主容器**同一枚镜像** + `entrypoint` 跑镜像里的 `scripts/migrate-deploy.sh`，
主容器对它 `depends_on: condition: service_completed_successfully`。形状与
`server/helm/supersync/templates/deployment.yaml:42-49` 的 `migrate-db` initContainer 逐点对齐
（同一条命令、同一枚镜像、同样带 `REQUIRE_DATABASE_POOL_LIMITS=true`）。

三条判据（`pnpm verify:selfhost-stack` 一次跑完，实测 `SCRIPT_EXIT=0`）：

| 判什么 | 现量 |
|---|---|
| 默认图恰好 `caddy / postgres / supersync`；带 override 只多 `supersync-migrate` | ✅ `服务图对账：默认 3 个（未动） · 带 override 4 个` |
| 一次性容器 `exited` 且退出码 0；应用容器自己的 `RUN_MIGRATIONS_ON_STARTUP` 当场是 `false` | ✅ 夹具里**不设**这个键，于是它只能是默认值 —— 两条合起来才把"迁移来自应用启动"这条假路堵死 |
| 台账：已应用的**不同迁移名数** = 磁盘迁移目录数；悬挂 0；同一名字重复完成 0 | ✅ `已应用 42/42 · 悬挂 0 · 重复完成 0 · 带外恢复痕迹 5 条（设计内）` |

静态那半边钉在 `server/tests/migration-sql.spec.ts` 新增的 4 条（默认图三个服务、override 只加一个、
一次性服务的环境行形状、README 第一屏那三句话），每条都做过变异：改名 / 删掉开关行 /
把 URL 的 `&pool_timeout=10` 去掉 / 把 README 里那条命令换成 `docker compose up -d` —— 各自精确报红。

这一轮自己踩到的两个判据缺陷（都属"探针比产品更值得修"那一类，都已就地改）：

1. 🔴 **第一版断言写的是"`finished_at IS NULL` 的行数必须为 0"，它会把一次正确的部署判成失败。**
   `migrate-deploy.sh` 对 CONCURRENTLY 迁移走"先原生试 → 失败则打回滚标记 → 带外恢复"，
   恢复成功后同一个迁移名**留两行**（一条 `rolled_back_at` 有值的痕迹、一条 `finished_at` 有值的结果）。
   实测 5 条痕迹，全是那几条 CONCURRENTLY。真正"没跑完"的形状是
   **既没有 `finished_at` 也没有 `rolled_back_at`**（PENDING / IN_PROGRESS）—— 那才是要拦的，
   而且它和"名字数 = 目录数"配成一对：漏跑一条 ⇒ 后者必然不等，多跑一条重复 ⇒ 前者或"重复完成"抓到。
2. 🔴 **`expect(x).toContain('REQUIRE_DATABASE_POOL_LIMITS=true')` 挡不住"把环境行删掉"** ——
   这个文件的**注释**里就有这个字面量（讲 helm 那一段），于是那一发变异一个测试都没打死。
   改成锚定 `- KEY=value` 的行形状。与 §8.3 第 5 条（compose 的注释喂饱了键名扫描）同一个形状，
   而同一天我在两个不同的脚本里各修了一次 —— 说明它不是手误，是"用 `includes` 判配置"这个习惯的必然产物。

### 8.7 台阶 2：发布流水线**文件落地但这条路当下走不通**，并且我先前给它写的"三重保险"里有一重是假的

新文件 `.github/workflows/heyta-server-image.yml`。它今天发不出任何东西，拦着的是
**四个当场量过的事实**（2026-10-03，全部只读命令，未推送、未发布）：

| 事实 | 现量命令 | 读数 |
|---|---|---|
| 仓库没有 `vX.Y.Z` tag | `git tag -l 'v*.*.*' \| wc -l` | `0` |
| 远端也没有（不是本地没同步） | `git ls-remote --tags origin` | 空输出 |
| `GHCR_NAMESPACE` 这个仓库变量不存在 | `gh api repos/Xaiver03/heyta/actions/variables` | `(空)` |
| `image-publish` 环境不存在 | `gh api repos/Xaiver03/heyta/environments` | `(空)` |

再加上"唯一触发方式是 `push: tags`"这一条形状 ⇒ **打 tag 这个动作本身就是拍板**，
不需要再造一个"禁止运行"的开关。

🔴 **一条我写错了、当天就撤掉的断言**：第一版把这个环境写成"三重保险"里的第二重，
理由是"GitHub 对引用不存在的环境的处理是**作业不执行**"。**这句是错的** ——
官方文档（Actions → 管理部署环境）原文是
"**运行引用不存在环境的工作流程时，将会创建一个使用该引用名称的环境**"。
也就是说那一行既不会拦、也不会报，它只会**凭空长出一个环境**。
已就地改成 ⚠️ 注释并写明它的真实作用 = **留痕**（发布过就删不掉痕迹），
而它**不是闸门**；真正的闸门只有 `guard` 那一步的 `exit 1`。
这条值得留下的原因不是"我错了"，而是：**一份"为什么安全"的清单里，
每一条都必须是被量过的，不然它会把唯一真的那条淹掉。**

顺手同批修掉的另外三个形状问题：

1. 🔴 **`workflow_dispatch` 删掉了**。它绕过"没有 tag"那一重，而它的 `version` 输入
   在这个文件里**没有任何步骤消费**（一个没人用的手动输入 = 一个会失败、
   但失败点不在你按下去那一下的按钮）。将来发版要做的动作就是打 tag 本身。
2. 🔴 **`guard` 里那条判据原本是恒假的**：写的是 `[ -z "${IMAGE_NAME##*/}" ]`，
   取的是**最后一段**，它永远等于 `heyta-server` ⇒ 条件永不成立，整个 `if` 只是装饰。
   改成取第一个 `/` 之前的 `${IMAGE_NAME%%/*}` —— 变量未设时 `IMAGE_NAME="/heyta-server"`，
   它才是**空串**。A/B 实测：未设的形状 rc=1 并打印出该补哪两样，设成 `acme` 时 rc=0。
3. **`VCS_REF` 不再"假设等于 release 提交号"，而是当场证。** `deploy.sh` 的期望值是
   `git log -1 --format=%H -- <镜像输入清单>`（cwd=server/），而**不等就是 `exit 1`**
   （读的是 `verify_supersync_image_revision` 本体，不是注释）。所以一笔什么都没改、
   只加了 tag 的 release 提交会打出一个"**每次部署都被拒**"的镜像，而 CI 全绿。
   现在构建前比一次，不等就拒绝发布并说清修法。
   变异实测：把 HEAD 换成 `HEAD~1/2/3/5` ⇒ **4 发全 rc=1** 并打印两个 SHA；
   不变异时 rc=0 且 `GITHUB_OUTPUT` 里确实落到了 `revision=470dda0c…`。

**镜像输入清单收成一份文件**（这一步是 3. 的前提，否则清单就有第五份抄件）：
`server/image-inputs.txt`（数据 + 为什么）+ `server/scripts/image-inputs.sh`（唯一读者，
**被 source 不执行**）。`deploy.sh` 与这份 workflow 现在吃同一个读者。

- **零行为变化**是量过的，不是声称的：用改造前那份数组的字面值与读者读出的 22 项分别跑
  `git log -1 --format=%H`、`git diff --name-only`、`git ls-files --others --exclude-standard`，
  外加清单本身 ⇒ **四发 `cmp` 全部相同**（rev 都是 `470dda0c…`）。
- 读者的三条失败分支各自做过变异，并带阳性对照（只给 `.` 一项 ⇒ 绿）：
  清单只有注释 ⇒ 红（"读空"不许变成"什么都不检查"）；某项不存在 ⇒ 红；
  清单文件不存在 ⇒ 红。`deploy.sh` 那段 `if ! . …; then exit 1` 的接线也用同一个读者
  在坏输入下复跑过，走到的是 exit 1 而不是静默继续。
  ⚠️ 最后这一发是**接线复刻**（在 `/tmp` 的副本目录里跑那四行），不是 `deploy.sh` 整机 ——
  跑整机会真去部署，本批不许碰。
- `../.github/workflows/supersync-docker.yml`（上游留的名字，本仓库从来不存在）从清单里去掉，
  换成这份真实文件；"不存在的 pathspec 会被 git 静默忽略"那整段推理搬进了
  `image-inputs.txt` 的头注释，因为它现在是**读者要拦的事**而不是注释里的事。
- 大陆可达性的口径写在文件头：**官方分发点只有 GHCR 一个**，第三方公共 mirror
  一律不写成官方；可达性由部署者自己配 mirror/反代，教程在 `docs/runbooks/deployment.md`。

- 4. 🔴 **"第二条发布路"不是错觉，它一条命令就能跑 —— 所以在拍板之前先把它修到不害人**：`server/scripts/build-and-push.sh`（`pnpm --filter @heyta/server docker:build` 就是它）原本自带一份 7 条的镜像输入清单，其中 3 条在本仓库**不存在**（`.github/workflows/supersync-docker.yml`、`package-lock.json`、`packages/super-sync-server`），而 `apps/web` 与 11 个 `packages/*` **一条都不在里面** —— 它算出的 revision 因此**恒落后于真实输入**，正是"新前端配旧标签"那类事故的形状。现在它 source 同一个读者（第三个消费者）。另两条同批改：`GHCR_NAMESPACE` **去掉默认值 `super-productivity`**（那是上游的组织，配了 token 的人一跑就把镜像推进别人命名空间），不给就在任何 docker 之前 exit 1；不再"顺带覆盖 `:latest`"（只推点名的那一个 tag，`latest` 归发布流水线的 `latest=auto` 判）。三发实测：不给 namespace ⇒ rc=1 且没碰 docker；给了 namespace ⇒ 走到脏输入检查并打印出**同一份 22 项清单**（仍然没碰 docker）；三处 `VCS_REF` 算法（本脚本 / `deploy.sh` / workflow 里那条断言）在 `HEAD=470dda0c` 上给出**同一个值**。
  ⚠️ 记一条探针教训：上面第三发我第一次是在 **zsh** 里跑的，`BASH_SOURCE` 为空 ⇒ `dirname ""` = `.` ⇒ 清单被解析到仓库根，报"读不到"后 zsh（没有 `set -e`）继续跑，于是得到一句 `fatal: empty string is not a valid pathspec`。**那是探针坏，不是读者坏** —— 换 `bash -c` 后同一发出的是 `n=22 / revision=470dda0c…`。

G-40⑤（版本来源约定）与 G-40⑥（兼容矩阵）**仍未关** —— 它们要的是"第一枚镜像发出去"
这个动作之后的事，本批不许碰（见 §8.5 那条触发条件）。

### 8.8 台阶 3：镜像那棵依赖树 vs 许可证门禁扫的那一棵 —— 现量结论是**不是同一棵树**

**装法（读的是 `server/Dockerfile` 本体，不是文档转述）**：生产阶段有三条
`npm install`（三条都带 `--omit=dev --ignore-scripts`），依赖的
`@heyta/{sync-core,shared-schema,domain}` 由 `pnpm pack` 出来的三枚 tgz 就地满足；
builder / web 两个阶段用 pnpm + `--frozen-lockfile`。
仓库里 `package-lock.json` / `npm-shrinkwrap.json` / `server/package-lock.json`
**一个都不存在**（实测 `existsSync` 三发全 false）。

⇒ **结论：镜像的生产依赖树每次构建都从 registry 重解一遍，而许可证门禁
（`research/tools/license-inventory.mjs`）扫的是根 + e2e 两个 pnpm store —— 两者不是同一棵树。**

量法与读数（2026-10-03；`gen-image-npm-tree.mjs` 把镜像那三步的解析结果落成快照，
再逐条对到门禁的 961 条扫描集上）：

| 项 | 现量 |
|---|---|
| 镜像生产树（按 `linux/x64/musl` 过滤后） | **143 条** |
| 其中 name+version 两边完全一致 | **127 条** |
| 门禁**从没见过这个 name** | **2 条**：`@node-rs/argon2-linux-x64-gnu@2.2.1`、`@node-rs/argon2-linux-x64-musl@2.2.1` |
| name 见过但**版本不同** | **14 条**：`@fastify/static` 10.1.5↔10.1.4、`pino` 10.4.0↔10.3.1、`ws` 8.22.0↔8.21.3、12× `@peculiar/asn1-*` 2.10.0↔2.9.5 |
| 差集占比 | **16/143 ≈ 11%** |

三条值得单独说的：

1. 🔴 **`@node-rs/argon2-linux-x64-musl` 是 Alpine 镜像实际装的那一枚**，而门禁在
   macOS/arm64 上扫 store，装的是 `darwin-arm64` 那一枚 —— 也就是说
   **"我们分发出去的那枚原生二进制的许可证，从来没有任何一层看过它"**。
   （`-gnu` 那枚是 npm 把两个 linux 变体都记进 lock 的产物，musl 镜像不会装它；
   我没替它辩护，一起登记了。）
2. **版本那一栏 14 条不是巧合，是结构**：`pnpm-lock.yaml` 只在人手动 `pnpm update`
   时才前进，npm 每次构建取 `^` 范围内最新 ⇒ 两条解析路必然漂。所以"127/143 相同"
   是今天的快照，不是不变量。
3. 今天这 16 条**逐条查注册表都是 MIT**（16 发 `https://registry.npmjs.org/<name>/<version>`
   全 HTTP 200，结果连 URL 和日期写进了登记的注释）—— 但那是**一次人工查的**：
   在下一次漂移之前，没有任何一层会发现某个传递依赖换成了 GPL。

补上的那条会红的对账：`check:image-license`（挂在 `pnpm check`，紧跟 `check:licenses`）。
三个文件，各自只管一件事，**不互相抄**：

| 文件 | 职责 |
|---|---|
| `research/tools/image-install-shape.mjs` | 从 `Dockerfile` 的 `AS production` 阶段读那几条 `npm install`（生成器与对账共用；抄两份正则就是第五份抄件） |
| `research/tools/gen-image-npm-tree.mjs` | 让 npm 自己解一遍，落成 `server/image-npm-tree.json`（带 `inputs` 哈希：`server/package.json` 的 sha256 + 那几条 install 命令的 sha256） |
| `research/tools/check-image-license-coverage.mjs` | 快照逐条对扫描集；没见过的必须在 `IMAGE_ONLY_PACKAGES` 里**带 license/URL/日期/为什么**登记过；登记还要**仍然成立**；计数恒等式必须闭合 |

它同时拦四种"看起来没事"：

- 快照里冒出一条没登记的新依赖 ⇒ 红（**注入 `evil-injected-pkg@9.9.9` 实测红**，
  并连带报"计数不闭合"）；
- 登记里的 license 被改成非宽松 ⇒ 红（**注入 `GPL-3.0` 实测红**）；
- 登记已经过期（条目不在快照里 / 其实已在扫描集里）⇒ 红
  （**两发各测一条：注入 `zod@9.9.9` 报"不在快照里"，注入 `@fastify/accept-negotiator@2.1.0`
  报"豁免不再成立"**）—— 这张表因此只能跟着现实变小；
- 改了声明却没重新生成快照 ⇒ 红（**注入错的 `serverPackageJsonSha256` 实测红**，
  并打印重跑命令）；
- 外加两发解析层哨兵（快照 <100 条 ⇒ 红：**注入"只留 5 条"实测红**；
  `fastify`/`@prisma/client`/`zod` 三个 needle 缺任一 ⇒ 红），
  防止"解析悄悄退化成空集然后一路绿"。
- 生成器另有三条**方向性**失败：生产阶段哪天改用 pnpm（那就真的和门禁同一棵树了，
  本对账应当**撤掉**而不是改读别的文件）、任何一条 install 丢了 `--omit=dev`
  （构建依赖进发布镜像，比许可证盲区更严重）、仓库里出现 npm lockfile
  （树被钉住了，这份"每次重解都要重量"的快照就是多余的第二事实源）。

⚠️ **诚实的边界（别把这条对账读成"洞补上了"）**：它证明的是
**2026-10-03 这一次解析**的树逐条有出处。改直接依赖 ⇒ 哈希对不上 ⇒ 必须重跑，这一类拦得住；
**纯传递依赖的上游发了新版**（没人改任何声明）拦不住 —— 那只有把树**钉住**才拦得住。
钉住的形状是现成的：把生产阶段换成 `pnpm deploy --prod`（三个 `workspace:*` 由 pnpm 内联，
那三枚 tgz 的 dance 一起消失），于是镜像的树**就是** `pnpm-lock.yaml` 的树 ⇒ 本对账可以撤掉。
已登记成 **G-47**，不在本批做（它动的是生产镜像的装配路径，要单独一轮真构建复验）。

