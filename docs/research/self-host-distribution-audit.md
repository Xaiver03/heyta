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

> 🟢 **2026-10-03 更新（划线留原句旁）**：这句话在落笔时是事实，但它把「等」当成了唯一出路，而真正便宜的解是**先取 main 已提交的那份，再只改需要改的那一行**——本批照这个做法关掉了 G-40②（过程见 §8.9）。
> 🔴 **同一段里「可直接落盘的字符串」这句被实测否证**：下面那份 en 文本含 `Super Productivity's`、`someone else's`，而词条值是**单引号**字符串 ⇒ 裸撇号当场把字符串截断，`tsc` 的报错却落在五百多行之外（3101 行埋雷、3677 行报错）。照抄这段的人会以为自己改坏了别的文件。

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
| G-40① | `site.docs.selfhost.s2i1` / `s8i6` / `site.help.a.selfhost` 三条「没有邮箱+密码这条路 / 不配邮件就注册不了」已与代码矛盾（中英各一份） | ✅ **已关（2026-10-03）——但不是本批关的**：并行会话在 `729f4bd4` / `1e092733` / `bf271a1e` 三笔里把整节按现状改写，措辞与下面那份草稿不同而信息更全。本批只做了核对与复验，见 §8.9 |
| G-40② | `s7p1` 教用户把 `SUPERSYNC_IMAGE` 指向上游 `master-<sha>`，与 `docker-compose.yml:27-33` 的裁决相反 | ✅ **本批关闭**（中英各一行；为什么四条里只剩一条要落，见 §8.9） |
| G-40③ | 落地页「打开自建指南」指向含内部机器清单的 P0 验收 runbook | ✅ **已关**。新增 `docs/runbooks/self-host.md`，`SELF_HOST_GUIDE_URL` 从页面注册表取路径 ⇒ 站内 `/docs/selfhost/`，并补了三条会红的判据（§8.9）。⚠️ 这里原来还写着"重新发布落地页本批没做"—— **那句已过期**（发布做过，见 §8.13），2026-10-04 线上现量：`/docs/selfhost/` `200`、`/app/` `200`、`/health` `200`（`curl --noproxy '*'`，绕开本机代理的 fake-ip），见 §8.21 |
| G-40④ | 自建区标题「一条命令的事」与文档中心「不是一个命令就完事」同站互相打脸 | 🟡 **错话已停，营销口径仍待 D-2**（现量与改法见 §8.21）。登记这句**说小了**：同一站点上「一条命令」共 **6 处**（4 处承诺 + 2 处否认）。🔴 而且错的那半**换了方向** —— 本批交付的 `docker-compose.migrate-once.yml` 让"表结构变更要显式执行一次"对**首次安装**不再成立（对**升级**仍成立，因为 compose 不重跑已退出的一次性服务）。⇒ 只改事实半句：那两句否认不再断言"一个命令完不完事"，改成"没有现成镜像 + 升级不是一条命令 + 后面全是你的运维"；**4 处承诺句一个字没动**。D-2 要拍的因此从"要不要停止说谎"变成"要不要把升级那一档也写进承诺位" |
| G-40⑤ | 无任何镜像发布流水线；`server/package.json` 是 1.0.0 而根包 0.0.0，无版本来源约定 | 🟡 **流水线那半已落（只写不推，§8.14 前后），版本来源这半未关**。现量（2026-10-04）：根 `0.0.0` / `apps/landing` `0.0.0` / `apps/web` `0.0.0` / `@heyta/sync-server` **`1.0.0`** ⇒ 仍然没有一个"客户端与镜像共同钉住"的版本来源。🔴 这条现在多了一条来自 G-44 的约束：版本来源不仅要存在，还要与 `MIN_CHECKPOINT_SAFE_APP_VERSION`（`18.21.2`，Super Productivity 的版本空间）**同空间**，否则补了生产者也永远判不出"新客户端"。已写进 `server/README.md` 前置条件第 1 条 |
| G-40⑥ | 服务端无版本兼容/支持矩阵政策（行业一致形态见 §4 第 4 条） | **未关**，而且是**有意的不写**。矩阵不存在（全仓没有"支持 N-1 / 同 major"的表），触发条件三处互相指得到：`server/README.md` 三条前置（版本来源同空间 / 客户端有真 full-state 生产者 / 有东西消费那个闸门）、G-44 的重分类、以及"第一枚镜像发布时 ⑤ 与 G-44 必须同时落地"。本批没有让这条更接近 |
| G-40⑦ | 镜像生产依赖由 `npm install` 安装，许可证门禁扫的是 pnpm store | **已证实：不是同一棵树**，差 16/143 条（2 个 name 门禁从没见过，含 Alpine 实际装的那枚原生二进制；14 条同名不同版本）。现量与对账见 §8.8；`pnpm check:image-license` 已挂进 `pnpm check`。**闭合（把树钉住）另立 G-47** |
| G-40⑧ | 公开仓库里含内部主机 SSH 别名与公网 IP，且被落地页直链的文档带出 | 🟡 **06:1x 把这一条的两个命题拆开量了（读数在 §8.54）**：后半句**已实测为 0** —— 发布产物 `apps/landing/dist` 95 个文件里三个 needle 全不命中，把它断掉的是 G-40③（链接改成与页面同一次构建的站内页面）。前半句**仍在**且前提这次是量出来的（未认证 API 回 `private=false`）：`origin/main` 上 `ubuntu-jcli` 20 文件 121 行、`windows-pc` 36 文件 97 行、那枚公网 IP 22 文件 57 行。真凭证逐行读过 = **0 处**（PEM 形状只剩两枚测试夹具，`JWT_SECRET`/`DATABASE_URL` 全是变量引用或占位符，`debug.keystore` 按约定就是公开物）。⇒ 剩下的这一半是**运维政策决定**（脱敏 / 转私有 / 接受）且落点含本批禁改的 `AGENTS.md`，本批只把数与复量命令钉住 |

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

⚠️ **还有第四件，这次才现量出来**：合入之后要**在合并结果上重跑 `gen:entries`**。`docs/index.html` 与 `en/docs/index.html` 是提交物，
两条线各改词条、又各改渲染它们的组件时，这两个文件必冲突；正确的解不是手工合并 HTML，而是**先解 `.ts` 词条、再重跑生成器**——`check:entries` 逐字节比对，手工拼出来的它拦得住。

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
| G-44 | `appVersion` 在服务端**有消费者、没有生产者**：`server/src/sync/checkpoint-gate.ts` 拿它判 `MIN_CHECKPOINT_SAFE_APP_VERSION`，`sync.service.ts:676 touchDevice` 把它记进 `sync_devices`，而它是**下载请求上的一个可选查询参数**（`packages/shared-schema/src/supersync-http-contract.ts:191` 是 `z.string().optional()`）—— `packages/sync-client/src/client.ts:1324-1327` 只往查询串里写 `sinceSeq` 与 `excludeClient`，**没有任何 heyta 客户端发过它** | 🔴 **本批重新归类，不按原登记实现**（证据链见 §8.17）。原句"补一个生产者"是错的：三条事实连起来说明**光上报版本会把那条日志变成假信号**，而阈值 `18.21.2` 住在**上游 Super Productivity 的版本空间**里。它不是自托管分发的缺口，是"客户端检查点/全量边界"这条**未实现的功能**的一部分 ⇒ 对外说法已在 `server/README.md`「Clients and version coupling」就地改成三个前置条件（原句只列了两个，且把"只差上报"写成了事实） |
| G-45 | 台阶 3（镜像 npm 依赖树 vs 许可证门禁扫的 pnpm store）曾是**未证实** | **本批量完并关成"有对账"**（§8.8）：`check:image-license` 逐条对账 + 四条会红的登记自检，7 发变异各自精确报红、阳性对照绿。残余风险（纯传递依赖上游发新版）已改挂 G-47 |
| G-46 | `server/scripts/build-and-push.sh`（`pnpm --filter @heyta/server docker:build` 的唯一实体）原来是**上游形状**：它自己抄了一份 7 条的镜像输入清单，其中 3 条在本仓库不存在（实测 `[ -e ]` 全不成立），而 `apps/web` / 11 个 `packages/*` / `pnpm-lock.yaml` / `server/` 自己**一条都不在里面**；`GHCR_NAMESPACE` 默认成 `super-productivity`（**别人的组织**）；并且无论给不给版本号都**顺带覆盖 `:latest`** | **本批关闭**（§8.7 第 4 条）。三条各自都会出事，都已改：清单改成 source 同一个读者、namespace 无默认值（不给就在任何 docker 之前 exit 1）、只推点名的那一个 tag。⚠️ 消费者集合是量过的：除 `server/package.json:14` 外只有 `server/tests/migration-sql.spec.ts:345` 读它，而那一发在 `it.skip` 里 ⇒ **不报错也不守** |
| G-47 | ~~镜像那棵依赖树**没有被钉住**：`check:image-license` 证明的是"2026-10-03 这一次 npm 解析结果的 143 条逐条有出处"，而每次构建 npm 都会重解一遍（没有 lockfile）。改直接依赖会红，**纯传递依赖的上游发新版不会**~~　🔴 **这段到 2026-10-04 05:5x 为止描述的是现实，现在四个事实变了**：`server/package-lock.json` 是提交物并且是 Dockerfile 的一条 `COPY` 输入（"没有 lockfile"为假）、镜像那棵树**由它驱动解析**（鉴别实验：锁里改一个版本，产物跟着改）、快照不再"每次重量"而是**从锁派生**、"改直接依赖才会红"这一句当时就说轻了（14 条在漂、两个还是直接依赖，见下面状态栏）。闭合形状与登记里预期的**不是同一件事**：§8.46（为什么 `pnpm deploy --prod` 与"提交锁 + `npm ci`"两条都走不通）、§8.47（落的形状与全部读数）| ✅ **2026-10-04 已关**（中间态曾是"🔄 对账已做、闭合形状要换"，读数见 §8.20）。现量：镜像树与 pnpm 生产树**同名同版本 125 个、镜像独有 0 个、版本不一致 14 个** —— 14 个全是镜像比 lockfile **新**，其中 12 个是传递依赖（`pino` + `@simplewebauthn/server` 底下 11 个 `@peculiar/asn1-*`，那是 **passkey 验证路径**），2 个是直接依赖（`@fastify/static ^10.1.2` 解到 10.1.5 而 pnpm 是 10.1.4、`ws ^8.18.0` 解到 8.22.0 而 pnpm 是 8.21.3）。⇒ 登记那句"改直接依赖才会漂"其实**说轻了**：没人改任何依赖，只因为版本落在 `^` 范围内，发出去的镜像就跑着一套本仓库任何测试都没跑过的版本。`--check` 新鲜度绿、覆盖率对账绿，两条都管不到这件事。🔴 **原闭合形状实测不成立**：`pnpm deploy --prod` 在 pnpm v10+ 要求 `inject-workspace-packages=true`（全仓依赖解析方式的改动），而 `--legacy` 会去 registry 取 `@heyta/i18n` 直接失败；另外 filter 打错时 `pnpm deploy` **什么都没做还 exit 0**。⇒ 换成：把已提交的那份快照从"记录 npm 这次解出什么"改成**镜像要装的版本就是它**（装配时按快照逐条钉版本），等式判据与钉版本**同一批**落地（不能先加判据把链钉红），复验仍要一轮真构建。🟡 **2026-10-04 00:4x 部分推进**（现量与判据见 §8.26）：那 143 条**仍未钉**（要 docker + 低负载窗口，与 #12 同一个），但镜像里**唯一那一枚手写版本字面量** `prisma@5.22.0` 现在有了等式判据 —— 它是第三份抄件，此前没有任何一层在守；新判据挂成 `check:image-license` 的第三条腿，5 臂注入各自精确报红、未变异对照绿。同时 §8.20 步骤 1 的**形状被改掉**（快照不能既是 install 实参的来源、又是 install 形状的哈希输入，否则等式两边都是它自己）。✅ **2026-10-04 05:5x 关闭**（`1b7d0921`，读数在 §8.47）：落的形状既不是 `pnpm deploy`，也不是"把快照逐条钉进 Dockerfile"，而是**把 npm 自己解出的那棵树提交成 `server/package-lock.json` + 一条 `COPY` 进生产阶段**，三条 `npm install` 一个字未改（实测 `npm install` 认锁、只在范围内取版本，不升级到范围内最新 —— §8.46 结论四的 C1/C2/C3 三档）。复验是**两趟真构建**（含"锁里手工改一个版本 ⇒ 产物跟着改"那一发鉴别实验，它才是"锁在驱动解析"的证据；只看"输出相同"兼容"npm 没读锁"）+ **两种载体对账**（模式 A 146 = 扫描集 126 + 镜像独有 17 + 自家包 3；模式 B 145，磁盘枚举 ⊆ 锁的非 dev 158 且差 13 条全 `optional`）+ 9 臂变异各红一次。⚠️ 别读成"完全可复现构建"：锁钉的是**第三方 registry 层**，三枚自家 tgz 走 `npm install` 的原生行为装**当前字节**（这是要的，本地包跟源码走）；`npm ci` 那条"更彻底"的形状实测会在冷缓存 `EINTEGRITY`、热缓存**静默装上一版自家代码**。G-53（`*-linux-arm64-musl` 那一类平台二进制从没进过扫描集）是这一族剩下的那条，**未闭** |
| G-48 | `check:web-artifact:app`（核对 `--base=/app/` 那份产物的那一道）**零自动消费者** —— 2026-10-03 由新门禁 `check:gate-wiring` 量出：它是 63 道 `check:*` 里唯一合法落在链外的一道，而全仓 `grep` 只有 `package.json` 自己那一行，没有任何 workflow / 验收脚本 / `deploy.sh` 调用它 ⇒「上线前跑一次」目前只写在脚本头部注释里 | ✅ **已关（2026-10-03，判据与登记见 §8.19）**。登记那半句被否证：`server/Dockerfile:191` 一直在跑同一条判据的**脚本本体**，`grep` 漏它是因为搜的是别名。决定：链**不放**这道判据（`apps/web/dist` 是一个目录、两种载体，链里 `pnpm build` 打的必然是根载体，把 `/app/` 载体放链里就是拿错的字节验对的东西 —— 现量：同一份 dist 上一条 rc=0 一条 rc=1）；改为**每个发布载体各自带对账**：runbook §3.7 的 rsync 之前插入 `pnpm check:web-artifact:app`（两处），`check:gate-wiring` 新增"链外门禁必须点名消费方文件 + 该文件里有一行**以这条命令开头**"，把"没人跑它"从一句注释变成会红的判据。6 臂注入 5 红 1 绿（绿那臂是刻意留的越界对照） |
| G-48b | G-48 关的是"这一步在不在发布序列里"，**没有**关"这一趟有没有人真的跑过它"：`consumers` 判的是 runbook 里那行命令还在，人工 rsync 前跳不跳过去仍然只取决于人。另外 `apps/web/dist` 一目录两载体没变（§8.19 读数 B），按载体分目录要同时动 `package-app.sh` / `package-msix.ps1` / `reinstall-all.sh` 的同步对账 / `Dockerfile` —— 四端打包输入的变更 | **未关**（本批只登记，理由如上：会新增一个"能碰生产"的对外动作面，或要改四端打包输入）。挂在这里是为了让下一轮别把 G-48 的绿读成"发布已经有守卫" |
| G-49 | 站内那篇自建指南（`packages/i18n` 的 `site.docs.selfhost.*`）是入口命令的**第 4 份抄件**，而 `check:selfhost-entry-command` 的扫描集里没有它（现有扫描集：`docs/runbooks/self-host.md`、`server/README.md`、`server/env.example`、`docker-compose.migrate-once.yml`、`local-server-verification.md`）| ✅ **本批关闭**，但**登记的前提一半是错的**（读数在 §8.18）：58 条词条里当时**没有一条**是完整入口命令，s7p2 只有 `-f` 那三个 flag 的**碎片**（没前缀、没 `up -d`、**没 `--build`**）。碎片比没抄件更坏 —— 拼起来敲就是 §8.11 那次 `pull access denied`。所以做的是两件事：文章改成给**完整一条**（中英各一份，与 runbook 逐字相同），再把这两份词条文件纳入扫描集（`source: 'copy'`） |



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
~~仓库里 `package-lock.json` / `npm-shrinkwrap.json` / `server/package-lock.json`
**一个都不存在**（实测 `existsSync` 三发全 false）。~~

🔴 **上面那句到 2026-10-04 05:5x 为止为真，现在为假**（`1b7d0921`）：`server/package-lock.json`
已是提交物，并且是 `server/Dockerfile` 生产阶段的一条 `COPY` 构建输入 —— 落地见 §8.47。

⇒ ~~**结论：镜像的生产依赖树每次构建都从 registry 重解一遍**~~，
而许可证门禁（`research/tools/license-inventory.mjs`）扫的是根 + e2e 两个 pnpm store —— 两者不是同一棵树。

⚠️ 这一节里**只有前半句过期**：门禁与镜像**仍然不是同一棵树**（§8.47 现量：模式 A 146 条里
扫描集 126 + 镜像独有 17），过期的是"每次从 registry 重解"那一半 ——
现在那棵树由**提交物锁**决定。为什么不是 `npm ci`：§8.46。

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
  （构建依赖进发布镜像，比许可证盲区更严重）、~~仓库里出现 npm lockfile
  （树被钉住了，这份"每次重解都要重量"的快照就是多余的第二事实源）~~。
  🔴 **第三条的方向已经反转**（`1b7d0921`，§8.47）：守卫现在是"**提交物锁不在**就 fail"，
  而快照**就是从这把锁派生**的（不再联网重解）—— 它不再是第二事实源，它是唯一事实源。

⚠️ **诚实的边界（别把这条对账读成"洞补上了"）**：它证明的是
**2026-10-03 这一次解析**的树逐条有出处。改直接依赖 ⇒ 哈希对不上 ⇒ 必须重跑，这一类拦得住；
**纯传递依赖的上游发了新版**（没人改任何声明）拦不住 —— 那只有把树**钉住**才拦得住。
🔴 **上面这段的"当时"限定：它写在只有预测快照的时候，那一档它说得对。**
钉住的形状**不是**这里猜的那一个 —— 下面两句都被实测否证了：

> ~~钉住的形状是现成的：把生产阶段换成 `pnpm deploy --prod`（三个 `workspace:*` 由 pnpm 内联，
> 那三枚 tgz 的 dance 一起消失），于是镜像的树**就是** `pnpm-lock.yaml` 的树 ⇒ 本对账可以撤掉。~~

- `pnpm deploy --prod` 走不通（四发现量在 §8.20 那张表：`--out` 不存在 / filter 打错**静默 exit 0** /
  pnpm v10+ 要 `inject-workspace-packages=true` / `--legacy` 去 registry 取我们的包且留下半成品目录）。
- 真落地的形状是**提交物 npm 锁 + 一条 `COPY`**（§8.46 结论四、§8.47），而本对账**不能撤掉** ——
  它换了职责：从"记录 npm 这次解出什么"变成**锁↔声明的防腐烂判据** + **两种载体互证**。

G-47 已按这个形状关闭（2026-10-04），不在本批做的理由是当时给的，现在已不成立。

### 8.9 台阶 0：四条对外错话——最后只有**一条**归本批，而这本身就是发现

**先记账：谁改了什么。** `site.docs.selfhost.s2i1`、`s8i6`、`site.help.a.selfhost` 三条已由并行会话改完并提交
（`729f4bd4` → `1e092733` → `bf271a1e`；最后一笔是被 `check:docs-voice` 抓到"文档中心不该出现 Argon2id"之后自我更正的）。
所以本批在 `packages/i18n` 上的净改动是 **`s7p1` 一行 × 中英两份**。落之前先量了四件事：

| 要成立的东西 | 现量 |
|---|---|
| `s7p1` 在 main 上是否仍教人指向上游 | 是：`git show HEAD:packages/i18n/src/locales/zh-CN.ts` 第 3302 行仍是「把 `SUPERSYNC_IMAGE` 显式指到某个 `master-〈提交号〉`」 |
| heyta 有没有发布镜像 | **没有**：`git tag -l 'v*.*.*'` = 0（唯一的 tag 是 `ai-remediation-fork`，非 semver 形状），`git ls-remote --tags origin` = 0 行 |
| 那条被 contradict 的纪律还在不在 | 在：`server/docker-compose.yml:27-31` 的 🔧 注释仍是「拉上游镜像跑的是**别人的代码**，而且看起来一切正常」 |
| 与并行会话**在途（未提交）**改动的碰撞 | **0 处**：`git diff -- packages/i18n` 里这四个键名命中 0（他那 59/10 行是另一件事）——这才是"能不能动 i18n"的真正判据，而不是"文件脏不脏" |

**为什么不能直接改工作树里那份。** 本分支基点落后 main **56 笔**，其中三笔动过同两个词条文件。键集合没变
（两份都仍是 2830 个键，无增无删 ⇒ 整份采纳 main 版本不引入结构性漂移）。直接提交「我的基点 + 我的 8 行」，
merge 时会在他们改过的那 3 行上冲突，而**一次草率的解冲突就是把他们的更正退回去**。做法因此是：

1. 从 main HEAD 用 `git show` 取整份 `zh-CN.ts` / `en.ts`（不是把工作树里那份旧的改了再提交）；
2. 只把 `s7p1` **整行**替换：脚本按行首键名定位、命中数必须恰好为 1，**旧值一律不靠记忆抄**；
3. 验证收敛：`diff main的副本 我的工作树` 每个文件**只差 1 行**。

于是这两份文件在本分支上是「main 的内容 + 我这一行」，merge 时是**超集**，不是竞争者。
这是"不 clobber 并行会话"的可执行版本：比"等对方先提交"便宜，比"直接改自己那份"安全。

**注入验证：四条新判据各自会不会红**（`apps/landing/tests/public-copy-register.spec.tsx` 的 `公页指向的仓库文档`）。
基线（未变异）失败 **0** 条；之后每发只改一处：

| 变异 | 失败用例数 | 红的是谁 |
|---|---|---|
| D1 `SELF_HOST_GUIDE_URL` 指向仓库里不存在的路径 | **2** | 判据 1（blob 路径必须存在）**和**判据 2（文件读不到）——同一条链接被两条管，如实记两条而不是挑一条 |
| D2 自建指南正文里塞一行 `ssh ubuntu-jcli` | **1** | 判据 2 |
| D3 把 needle 表清空（模拟词表坏了） | **1** | 判据 3（正面对照）——**它红的时候判据 2 仍是绿的**，这正是那条对照存在的理由 |
| D4 `SelfHost.tsx` 里把 `href` 换成硬编码的旧路径（**当年的缺陷形状**） | **1** | 判据 4——它不读常量，读的是渲染出来的 DOM |
| D4b 把判据 4 渲染的页面换成一张本来就没有这个链接的页 | **1** | 判据 4 的**哨兵腿**（"页面上一个都没扫到"必须红，否则这条判据会在下一次改版时悄悄变成空转） |

**`docs/runbooks/self-host.md`（新增）里我自己写错、当场改掉/否证后重写的三句**：

- HTTPS：我第一版写成「公网部署必须 HTTPS」。读 `server/src/config.ts:429-445` 才知道它同时要求 `NODE_ENV=production`，而 `isPrivateNetworkHost` 的 http 是**放行**的（局域网 / 回环）⇒ 文档现在写的是这个形状（`self-host.md` 第 56-61 行），并且补了一句这两件事合起来的后果：
- 端口：compose 里 `supersync` 绑的是 **`127.0.0.1:1900:1900`**（`docker-compose.yml:110-111`），不是"直接暴露公网"，对外入口只有 caddy 的 80/443（`:273-275`）；
- 备份落点：`scripts/backup.sh:33` → `server/backups`。

**为什么第四条要读 DOM 而不是只读常量**：前三条全部只消费 `SELF_HOST_GUIDE_URL`，而当初出问题的恰恰是
"常量改了、某个组件自己抄了一份路径"（`Footer.tsx` 的文档分组历史上就自己抄过，漏改的那一处表现为链接 404）。
只读常量的三条判据对这种漂移**完全没有牙齿**。

⚠️ 顺带一条会被误读的事实：`docs/selfhost/index.html` 这类入口 HTML **不含正文** —— 文章体是客户端从 i18n bundle 渲染的
（实测：新生成的入口里 `没有发布任何 heyta 镜像` 命中 0、旧的 `master-〈提交号〉` 也命中 0）。
所以"**生成物里有这句话**"不能当作词条已上线的证据；本轮的"改词条要连着做"里，`gen:entries` 归拢的是**帮助速答**那一层
（本次 `docs/index.html` 变的那一行就是 `site.help.a.selfhost`）。

**跑过的门禁**（都在本批改动之后重跑，非引用）：`@heyta/i18n build`、`gen:entries`、`check:entries`、
`check:ui-language`、`check:docs-voice`、`check:server-copy`、`check:legal-copy`、`check:docs` —— exit 全 0。

**待入 `docs/reference/environment-traps.md`（本批现量、可直接抄的编号条目，等该文件的在途段落落定后按当时最大号追加，避免撞号与整文件覆盖）**：

- **词条表 (`packages/i18n/src/locales/*.ts`) 的值是单引号字符串，英文正文里的裸撇号会当场截断它** ——
  而 `tsc` 报的位置在**几百行之后**（实测：3101 行埋雷，报错落在 3677–3701 一片 `TS2695 Left side of comma operator` +
  `TS2304 Cannot find name 'satisfies'`，看起来像文件末尾坏了）。
  定位法：把可疑那一行**单独**塞进一个临时 `.ts` 让 Node 的 type-stripper 解析，再拿**同一文件里没改过的邻行**做阳性对照
  （邻行也红 = 探针坏，不是文案坏）。修法只有一个方向：**改写措辞**，别指望 `\'` —— 同一句里还有第二个裸撇号时，
  修掉第一个照样红。
- **`git diff --stat` 每行那个数字是"该文件 `+` 与 `−` 之和"，不是"改了几行"**：`22 ++++----` 实为 **11 增 + 11 删**。
  要单侧计数只能用 `--numstat`（本批实测：`--stat` 报 22，`--numstat` 报 `11\t11`，`--shortstat` 的
  `2 files changed, 22 insertions(+), 22 deletions(-)` 才是两侧分开的口径）。
  这个数字不是仪式——"main 在这两份文件上到底动了多少"决定了"整份采纳 + 单行替换"安不安全。
- 🔴 **另一条同族的、更贵的误读**：`git diff --name-only A..B` 比的是**两棵树**，不是"B 相对各自父提交改过的文件集合"。
  本批先用了它，于是把"我自己创建的文件"也算进了"main 那 56 笔碰过的文件"里，交集虚高到 40+ 个；
  换成 `git diff --name-only $(git merge-base A B)..B` 之后真实交集是 **4 个文件**，而"要不要担心 clobber"这个判断
  完全建立在后者上。（同族先例：§7 第 90 条 diff-tree 两参比 A↔B。）

**收尾把 `pnpm check` 逐段跑了一遍（57 段，段名从 `package.json` 现取），抓到两处红是本批自己造的**：

| 红段 | 是谁的 | 现量与修法 |
|---|---|---|
| `check:shell-unicode` | 🔴 **本批**（10 处，全在我写的两个文件里） | `scripts/verify-selfhost-stack.sh` 9 处 + `server/scripts/deploy.sh:130` 1 处，形状就是 §7 第 64 条：`$var` 紧跟全角括号 ⇒ **变量名被吞、证据行变乱码，而退出码照常 0**。用仓库自带的 `research/tools/fix-shell-unicode-vars.py --write` 修（预演确认只命中这两个文件才 `--write`），修完该段扫 67 个 `.sh` 全绿 |
| `typecheck` | 🔴 **本批**（`apps/landing` 两条 `TS2345/TS2322`） | 我新写的判据里 `m[1]` 在 `noUncheckedIndexedAccess` 下是 `string \| undefined`。**vitest 全绿而 typecheck 红**（§7 第 162 条的同一族：esbuild 只剥类型）⇒ 按仓库既有写法收成 `?.[1] ?? ''` / 显式 `!== undefined`，改后 `pnpm typecheck` exit 0、该 spec 仍 **175/175** |
| `check:l4` | ⚪ **不是本批** | 红的是 `apps/mobile/src/screens` 内联样式 **98 > 基线 90**（12 个文件）。A/B 现量：同一目录在**基点 `f0db2a3a` 与本分支 tip 上都是 101**（`git grep -c 'style={{' <ref> -- apps/mobile/src/screens` 逐行求和），而本分支只碰过 `apps/mobile/src/sync/store.ts` 与一个 mobile 测试，**没有一个在 `src/screens/` 下**。这是 M3 那笔已提交债（同"98>90 里剩 8 处是 M3 已提交债"），**不吸收、不为凑绿调基线** |
| `@heyta/sync-server` 的测试 | ⚪ **不是回归，是隔离检出的前置缺失** | `pnpm -r test` 里唯一红的是 `tests/account-profile.spec.ts` **整个文件加载失败**（`测试进程里没有 JWT_SECRET`），而这个 worktree **没有 `server/.env`**（主检出有）。当场 A/B：注入随机 `JWT_SECRET` / `PASSWORD_PEPPER` 后该文件 **27/27 通过** ⇒ 判据本身没坏，缺的是本机凭据文件。其余 **2079 passed / 1 skipped**（111 个文件） |
| 其余各包 `pnpm -r --filter '!@heyta/sync-server' test` | ✅ 这一段是绿的 | exit 0，**6407 passed**（12 个包，最大一包 1502） |
| `check:web-storage` | ⚪ **归因未定性**（不是本批） | 单跑 ✅（Worker SQLite + OPFS + 刷新后仍在，五条判据全过）；链里那次红发生在 `loadavg 31–46` 的窗口，不写成"环境没问题" |

**台阶 0 没做完的那一件**：线上落地页仍是旧文案，词条改动不会自己上线；重新发布站点是共享状态动作，**留给产品负责人拍板**。

### 8.10 合入前做了一次**只读**干跑：冲突只有一个文件，而它的危险不在冲突本身

本批收尾时并行会话又往前走了（落后多少笔**不写死**，会漂；现量：
`git rev-list --left-right --count main...HEAD`）。"这个分支现在合得进去吗"以前是靠感觉回答的，
这次用 `git merge-tree --write-tree --name-only main HEAD` 干跑了一遍 ——
**它只写对象库，不动工作树、不动索引、不改 HEAD**，所以在共享检出里跑是安全的。

重叠文件现量法（🔴 不能用两参 `git diff A..B`，理由见 §8.9 第三条待入项）：

```bash
MB=$(git merge-base main HEAD)
comm -12 <(git diff --name-only $MB..main | sort) <(git diff --name-only $MB..HEAD | sort)
```

结果：**6 个重叠文件，5 个自动合并，只有 `package.json` 内容冲突**。那 5 个是
`docs/runbooks/deployment.md`、`packages/i18n/src/locales/{zh-CN,en}.ts`、
`apps/landing/{,en/}docs/index.html`（两份入口 HTML 是生成物，合入后仍要重跑 `gen:entries` 再验
`check:entries`，不能因为"自动合上了"就当它是最终字节）。

冲突两侧的差异**全部是"各自往 `check` 链里加门禁"**，逐名归属现量（`git show <ref>:package.json | grep -c '"<gate>"'`）：

| 门禁名 | base | main | 本分支 |
|---|---|---|---|
| `check:licenses:stamp` | 0 | 1 | 0 |
| `check:mobile-first-run-gate` | 0 | 1 | 0 |
| `check:image-license` | 0 | 0 | 1 |
| `check:server-env` | 0 | 0 | 1 |
| `check:web-artifact` | 0 | 0 | 1 |

base 一个都没有 ⇒ 这不是"两边改了同一行"的语义分歧，解法只有**并集**，没有取舍。

🔴 **真正的风险是解完之后少一个名字**。`check` 是一串 `&&`，把某个门禁掉出去**不会让任何东西失败** ——
它只是不再被跑，而链子照样 exit 0。这正是"一条永远通过的判据比没有判据更糟"的形状，
只不过这里坏的方式是**它整条都不在了**。所以合入后必须立刻跑：

```bash
for g in check:licenses:stamp check:mobile-first-run-gate check:image-license check:server-env check:web-artifact; do
  printf '%-30s %s\n' "$g" "$(grep -c -- "\"$g\"" package.json)"
done   # 五行都必须 ≥1，出现 0 就是这次合并把某个人的门禁弄丢了
```

（同族先例：§7 第 88 条"plumbing 半个文件的索引尾巴"—— 都是**合并/暂存动作会静默丢内容**，
而丢后的输出与"一切正常"完全一样。）

### 8.11 🔴 收尾复看时抓到的一条：对外那份指南 §4 印的命令**照抄会失败**，而它当初"验过"

`docs/runbooks/self-host.md` §4 的标题是"只想用一条 `docker compose` 起全套"，
印的却是：

```bash
docker compose -f docker-compose.yml -f docker-compose.migrate-once.yml up -d
```

**它漏了 `docker-compose.build.yml`。** 默认图里 `image:` 是 `${SUPERSYNC_IMAGE:-supersync:local}`，
而我们不发布镜像 —— 于是照抄的人手里既没有 build 说明也没有本地 tag，compose 去**拉**，实测得到：

```
Image supersync:local Error pull access denied for supersync, repository does not exist
or may require 'docker login'
```

最后那半句是这条路上最容易把人带偏的提示：它会让人去找"该登录哪个仓库"，
而真相是**根本没有仓库**。（`check:entries` 那类门禁抓不到它，单元测试也抓不到 ——
它是一行**给人抄的 shell**。）

**为什么它当初"过了"**：`scripts/verify-selfhost-stack.sh` 量的是自己那一套 ——
先 `docker build` 出一个私有 tag，再在一次性 env 里写 `SUPERSYNC_IMAGE=<那个 tag>`，
最后 `up -d postgres supersync`（还刻意不起 caddy）。
**这条路径结构上看不见 §4 的缺陷**：脚本手里永远有镜像，而陌生人手里没有；
脚本永远带 `SUPERSYNC_IMAGE`，而文档那条靠默认值。
这是 §7 元规则第 1 条的第三种面目 —— 探针不是坏，是**探针量的不是那道门**。

📌 这件事直接关系到落地页那句对外话：自建区标题写的是「自己的服务器，**一条命令**的事」
（`landing.selfhost.title`，见 §3）。修之前，那条"一条命令"只有 `deploy.sh` 一条腿成立，
compose 那条腿照抄必失败 —— 也就是**页面上那句话的一个分支是坏的**，
而它坏得很安静（报错把人引向"去登录某个仓库"）。

修了三层：

| 层 | 动作 |
|---|---|
| 命令本身 | 指南 §4 与 `server/README.md` 各补上 `-f docker-compose.build.yml` 与 `--build`，并把"为什么不能省"连同那句误导性报错一起写进正文（两份是**逐字同一条命令**，见下面的判据） |
| 抄件 | `server/docker-compose.migrate-once.yml` 文件头原本也重抄了这条命令（**同一个错的第二份**）。改成指向唯一真本，不再重抄 —— 三处抄件里两处漏同一份 override，正是"同一个值抄三遍"的标准漂法 |
| 判据 | 脚本新增"入口命令对账"：把两份文档里那条命令折行后**逐字比对**（只比 `-f` 集合会把"一份带 `--build`、一份不带"读成绿），集合必须恰好是 3 份，且必须带 `--build`；同时钉住**脚本自己**那两套是 2 份并写明为什么不同（脚本自己 `docker build`） |

真跑过（不是 `config` 干跑）：从 `server/` 目录用**文档印的那条命令**起了一整套 ——
compose 自己打出 `supersync:local`，一次性迁移容器 `Exited (0)` 且日志 `All migrations have been
successfully applied`，`caddy` / `supersync` / `postgres` 三个都 `healthy`；
`/health` 200、`/app/` 返回的 HTML 里资源前缀是 `/app/assets/…` 且该 js **200**。
再对同一套栈跑 `playwright.selfhost.config.ts`：**S1/S2/S3 3 passed**（含"SW 在 `/app/` scope 下注册上"
与"全新设备只能从服务端读到那条任务"），截图 `e2e/selfhost-stack-results/s1-app-loaded.png` 等 4 张，
**人已看过**（是应用本体：蓝白、左侧 rail、收集箱空态）。跑完 `down -v` 拆干净，临时 env 文件已删。

⚠️ 三条可迁移的判据（前两条已在本节正文，这条是新的）：
**验收脚本自带的 env 覆盖会把自己要验的默认值换掉** —— 这条脚本写 `SUPERSYNC_IMAGE`，
于是"默认值好不好使"这件事在它的世界里根本不存在。判"某条对外命令可用"，
就得**用那条命令原样跑一次**，而不是跑一条"等价"的。

🔴 待入 `environment-traps`（本批现量，等该文件在途段落落定后按当时最大号追加）：
**BSD sed 的 BRE 不解释 `\036` 这类八进制转义**，它按字面量 `036` 去找 ⇒
`tr '\n' '\036' | sed 's/\\\036//g'` 这种"折续行"写法在 macOS 上**静默不折叠**，
判据只读到第一条物理行，报出来的形状是"文档少带了一个 override"（其实是探针没读全）。
折续行要用 `awk '{ if ($0 ~ /\\$/) { sub(/\\$/,""); printf "%s ", $0 } else { print } }'`。
同段还有第二条：**折回来之后要先 `tr -s ' '`**，续行的缩进会留下双空格，
而 `-f x.yml` 这种"一个空格"的正则只会吃掉第一个 `-f` —— 症状同样是"少一个"，不是"全没有"。
两次都是**探针自己坏、文档是好的**，都靠"先跑基线再看注入"才分得开。

### 8.12 合并真的做了：并集解法、§8.10 那条核对循环**没有牙**、以及合并树上第一次门禁红在哪

2026-10-03 产品负责人拍板"可以开始合并"。动作：`git merge --no-commit --no-ff main`
（`main` = `437e7c1a`）。

**冲突只有一个文件**，与 §8.10 那次只读干跑的预测逐字一致（6 个重叠文件、5 个自动合并、
1 个内容冲突 = `package.json`）。两侧差异全是"各自往 `check` 链里加门禁"，
解法只有并集：以 `main` 的链顺序为底，把本分支那四道按各自相邻位置插回去
（合并提交 `de479625`）。

🔴 **然后 §8.10 自己那条核对循环被抓出来了 —— 它抓不到它声称防的东西。**

它写的是 `grep -c -- "\"$g\"" package.json`，命中的是**带双引号的那个形状**，
而这个形状只可能出现在**定义行**（`"check:image-license": "…"`）。
链里写的是 `pnpm check:image-license`，**不带引号**。所以它证明的是"定义还在"，
而这一类事故的风险形态恰恰是"**定义在、链里没有**"。实测读数：六个名字各 `1` ——
那 1 全是定义行；链里少任何一个它照样报 1。

**这条已经作废，被一道常驻门禁换掉**（`scripts/check-gate-wiring.mjs`，提交 `24b88c7f`，挂在链首）：

| # | 判据 | 为什么这条必须有 |
|---|---|---|
| 1 | 每道 `check:*` 定义要么在链里被引用，要么在允许表里**带理由**登记 | 就是上面那个风险形态 |
| 2 | 允许表不能比现实宽（定义没了还留着 = 红；已回到链里还留着 = 红） | 允许表本身会烂，留着就是在掩护下一道 |
| 3 | 链里引用的每个脚本名都要有定义 | 名字拼错 ⇒ `pnpm` 报错但**只有那一段**红，而整串红会让人以为是门禁本身坏了 |
| 4 | 锚点 `pnpm build` / `pnpm -r test` 必须逐字在场 | §7 第 57 条（`check` 曾整条不跑单元测试）与第 27 条（验的是旧产物） |

五发变异，各 `rc=1`、真树 `rc=0`，且每条报的话能直接照着修：

| 变异 | 做法 | 门禁报的话 |
|---|---|---|
| E | 把 `pnpm check:image-license` 从链里摘掉、**定义留着**（= §8.10 声称防的那个形态） | `定义还在，但不在这次的 check 链里 —— 它不会再被跑，而链子照样绿` |
| A | 摘掉 `check:web-artifact` 定义（链里仍引用） | `链里引用了 pnpm check:web-artifact，但没有这个脚本定义` |
| B | 丢掉 `pnpm -r test` | `链里少了锚点 pnpm -r test` |
| C | 链里引用一个不存在的名字 | 同时报"掉出一道"+"引用无定义"（两处，不是掩盖成一处） |
| D | 丢掉 `pnpm build` | `链里少了锚点 pnpm build` |

**顺带量出一个此前没人知道的事实**：现在 63 道 `check:*` 定义里，只有 1 道在链外 ——
`check:web-artifact:app`（它读 `--base=/app/` 那份产物，进链就是拿**错的产物**验**对的东西**，
所以它合法地不在链里）。🔴 但同一次扫描也量出它**零自动消费者**：全仓 `grep` 只有
`package.json` 自己那一行，没有任何 workflow / 验收脚本 / `deploy.sh` 跑它 ——
也就是说"打进服务端镜像 / rsync 上线前跑一次"目前只写在脚本头部注释里。
**登记为缺口，不伪装成"有守卫"**：已编号 **G-48**（见 §7 那张表）。

> ⚠️ **上面那段"零自动消费者"只有一半是对的，2026-10-03 收盘点时否证了后半**（读数见 §8.19）：
> `grep` 扫的是**别名** `check:web-artifact:app`，而 `server/Dockerfile:191` 跑的是**同一条判据的脚本本体**
> （`node scripts/check-web-artifact.mjs --dist apps/web/dist --mount /app/`）⇒ 镜像路径一直有自动载体。
> 真的没人守的是**人工 rsync 那一趟**（生产 `/app/` 到今天走的正是它）。
> 原句留着是因为它记的是"那天那次扫描读到了什么"，改成后来修好的样子就抹掉了
> **"用别名当搜索词会漏掉脚本本体"** 这个可迁移的形状。

**自动合并的五个文件里，两个 i18n 词条表必须单独核，因为"合上了"不等于"合对了"**：

| 核的东西 | 读数 |
|---|---|
| 键集 | 分支 2830 / main 2830 / 合并后 2830；双向丢失 **0**，重复 **0**，中英键集仍对等 |
| 本分支改过的 16 个键 | 合并后 16/16 **等于分支值**（没有一边被另一边静默盖掉） |
| main 也改过的键 | 10 个 —— 而 git 能自动合并的原因现在有了读数：**这 10 个 main 的值与分支逐字节相同**，即两边做的是同一条修改 |

🔴 这条推翻本批先前写在 §8.10 的一句预期："两份入口 HTML 是生成物，合入后仍要重跑
`gen:entries` 再验 `check:entries`"。实测**不需要** —— 合并树上 `check:entries` 直接过
（它在链的第 2 段，而这次链是走到第 55 段才第一次红）。留原文并在此更正：
生成物要不要重跑取决于**两侧改的是不是同一批词条**，不是"只要动了 i18n 就必须重跑"。

**合并树上第一次全量门禁红在一处与本批无关的地方**，而它是真缺陷：

`check:shell-unicode` 🔴 红在 `scripts/mutate-closeout-gates.sh` 第 223/232/242 行 ——
`读数是「$V1」` 这种 `$var` 紧跟全角括号的写法（§7 第 64 条）。
归属现量：`1ac5913a` 已经修过**同一个文件的同类 4 处**，而 `cc974fbd` / `9f1cc9c3`
后来新增 V1/V2/V3 三条变异用例时**把同一个写法又写了回去**。
症状不是崩，是**取证输出自己变乱码、值丢了，而退出码照常** —— 所以只有门禁能抓到。
修：`$V1` → `${V1}` 三处（`bash -n` 过，门禁从 3 红到 0 红，它扫 69 个 `.sh`），提交 `b3f9185b`。
这不是"为了让 `pnpm check` 变绿而改测试"：红的是**验证脚本自己的证据行**。

其后各段在同一棵合并树上重跑，`TAIL1_RC=0`：`check:gate-wiring`、`check:selfhost-entry-command`、
`check:web-storage`、`check:web-migration`、`check:web-artifact`、`check:script-snapshot`、
`check:mobile-first-run-gate`、`screenshot:verify`。
### 8.13 上线这一轮：落地页发了，而**发出去的第一版自己带着一条 404** —— 是发布后的实测抓出来的

2026-10-03 产品负责人说「现在的话可以部署上线了。可以开始合并了」。合并见 §8.12，本节只记发布。

**发布前先量"线上现在到底印的什么"** —— 因为"词条改了"与"页面上是那句话"是两件事：

| 量什么 | 发布前读数 | 怎么量的 |
|---|---|---|
| 线上落地页 bundle 里 `/app/` 出现次数 | **0** | `curl` 取 `main-CSL_7LHx.js` 再数 |
| 线上落地页 bundle 里「一条命令」出现次数 | **0** | 同上（中英两版词条都在里面） |
| 线上 `/app/` 与 `/app` | 200 与 301 | `curl -o /dev/null -w` |

第一行就是 `deployment.md` 那句「不带 `VITE_APP_URL` 重新构建，入口会静默消失」的**活样本**：
线上那一版从来没带过这个变量，所以落地页**根本没有进应用的入口**，
而页面不报错、`curl -I` 200、看着一切正常。

**发布动作**：远端先备份（`/tmp/heyta-landing-backup-pre-4dfd2b3b.tgz`）→
`VITE_APP_URL=https://heyta.waytofuture.cn/app/ pnpm --filter @heyta/landing build` →
`rsync -az --delete` → 线上复验。

🔴 **然后第一版发出去的东西里有一条死链**，而它是本批自己换出来的：
落地页「打开自建指南」在 G-40③ 那一轮从内部 P0 手册改指了
`docs/runbooks/self-host.md`，形状是 `github.com/…/blob/main/<路径>` ——
**那个文件只存在于还没合入、也没推送的分支上**。实测：仓库根 200、页脚另外四条 blob 链接 200、
**这一条 404**。而守它的判据是 `existsSync(仓库根/<路径>)`，量的是我这棵工作树。
⇒ 修在 `4fa0833a`：链接换成站内那篇文章（同一次构建、同一条 rsync，不存在"页面发了目标还没发"），
判据补上"必须在 `origin/main` 上存在"这一条腿，并顺手抓到第 4 条判据本来就漏
（组件自己抄一份路径时它照样绿 —— 改成判集合）。四发变异各自精确报红。

**发布后读数**（真浏览器 + 人真的看了那张图）：

| 判据 | 读数 |
|---|---|
| 「打开自建指南」渲染出来的 href | `/docs/selfhost/` |
| 点下去 | `https://heyta.waytofuture.cn/docs/selfhost/`，标题「自建一套同步服务器」，`404` / `Not Found` 字样 0 |
| 文章正文含 | 「三个必填项」、「只给 Caddy 当站点地址」、「docker-compose.build.yml」三条**都在** |
| 卡片标题 | 「完整步骤在自建指南里」（旧值「…在仓库里」0 命中） |
| 落地页自建区标题 | 「自己的服务器，一条命令起全套」 |
| 应用入口 | bundle 里 `https://heyta.waytofuture.cn/app/` 命中；点「立即使用」落到 `/app/`，`document.title = heyta` |
| 旧域名 `heyta.finlaw.cloud` | 线上首页 + 文章页 **0 命中** |
| console / pageerror | 0 条 |

⚠️ **G-40④ 的现状要写准**：这条没关。改完之后落地页说「一条命令**起全套**」、
文章第一句说「不是一个命令就完事」—— 张力从"同站打脸"收敛成"起来 ≠ 完事"，
但**要不要对外承诺"一条命令"这件事本身**仍是 D-2，没人拍。

**这一轮明确没做的（别读成"做完了"）**：

- **镜像没发**、**远端没推**：`origin/main` 落后本地 `main` 72 笔，推它等于替 70 多笔
  别人未过目的提交对外发布 —— 那是另一个决定，不在"可以开始合并了"的范围里。
- **生产服务端镜像没重建**：本批服务端侧的改动（`/app` 自跳转、`WEB_APP_DIR` 默认值的说法、
  `SUPERSYNC_HOST_PORT` 旋钮、一次性迁移 override）**只在自托管构建路径上生效**；
  我们自己的 `heyta.waytofuture.cn` 仍是旧容器 + 宿主 nginx 挂 `/app/`（那条 301 就是 nginx 给的）。
- `apps/web` 的 PWA / 挂载参数改动同样没上生产。
- 站内那篇指南文章现在是**对外部署文档**了，而它不在入口命令对账门禁的扫描集里 ⇒ **G-49**。

### 8.14 🔴 产品负责人实测的第二条：**点「登录」先读到一段说明**，而那段说明里有三句话是错的

原话：「点击登录怎么不直接进入到登录界面？而是出来这么一段说明文字。这段说明文字
不应该在帮助里面吗？不应该在文档中心里面吗？」

查下去是**两层**问题，第二层比第一层贵。

**第一层（入口指错了）**：导航那个「登录」落在站内 `/signin/`，而那一页第一屏是
两张方式卡 + 两节解释 + 一条 ⚠️ 注脚。想进去的人先被安排读一篇关于进去的文章。

**第二层（对外说错话）**：那页的正文与词条表里有四条断言与产品不符 ——

| 撤掉的对外断言（`packages/i18n` 的键） | 与它冲突的真凭据 |
|---|---|
| `site.signin.lede`：「账号只有两种进入方式，没有密码」 | `packages/app-host/src/hosted-auth.ts:131-135` 四条口令端点（`passwordForgot/Reset/Change/Set`），`:304` 的 `password-locked` |
| `site.signin.noPassword`：「⚠️ 为什么没有『邮箱 + 密码』」 | 同上 —— 这不是"我们选择不做"，是**已经做了**的功能被写成不做 |
| `site.signin.method.passkey.*` / `method.magic.*`（两张卡只列两条路） | `site.docs.account.s2` 自己就写着「三条登录方式，邮箱 + 口令是主路」—— **同一站点两页互相打脸** |
| `site.signin.seo.description`：「支持通行密钥与邮件登录链接两种方式」 | 这条进的是搜索引擎与分享卡片，是对外最广的一层 |

🔴 顺带纠掉两条同源错话：`site.docs.account.sum` 也写着「没有密码可记、也没有密码可撞」；
`site.help.a.passkey` 与 `site.docs.account.s2i3` 把应用内的登录面板称作「**登录页**」——
在站点也有 `/signin` 之后，那个称谓会把访客指到网站上去（真控件是 `web.auth.recovery.request`）。

**为什么没有"就地补一张登录表单"**：认证 UI 必须在应用里（地址与令牌同源，否则
"对着 A 登录、令牌存到 B"），这条不变。**变的是入口，不是认证住在哪。**

落地：

- 深链 `?signin`：`apps/web/src/lib/auth-deep-link.ts`（新增）+ `App.tsx` 挂载时读一次。
  消化点在**壳**不在 `AuthPanel` —— 面板自己读的那个参数（`?invite=`）是"开着之后"的
  字段初值，而"该不该开"的状态住在 store（`signInOpen`）。
- 落地页侧 `signInHref(locale)`（`apps/landing/src/lib/app-url.ts`）：配了 `VITE_APP_URL`
  才给外链，**没配就退回站内那一页**（不猜地址那条纪律没动）。
- `/signin` 只剩出口：主行动 + （配了应用时）找回通行密钥 + 一条去文档中心的链接。
  解释搬进 `site.docs.account.s5` / `s5p1`，挂在文档中心那篇文章的第五节。
- `docs.ts` 里 s2 那一节的 **id 从 `no-password` 改成 `ways-to-sign-in`**：锚点出现在
  URL 与目录里，而那一节讲的主路就是邮箱 + 口令 —— 锚点本身在对访客说不成立的话。

**判据（11 条注入臂，全部实测红）**：`apps/web/tests/auth-deep-link.spec.tsx` 5 条
（挂**完整 `<App />`**，判据是屏幕上出现 `auth-form-email`，不只看 store 字段）、
`apps/landing/tests/app-url.spec.ts` 3 条、`render.spec.tsx` 新增 3 条
（薄页结构、跨包字面量漂移、文档第五节真的挂上）。变异臂与读数：

| 臂 | 注入的错 | 红在哪 |
|---|---|---|
| W1 | 删掉 `App.tsx` 那段 effect | web 4 failed / 1 passed |
| W2 | 「有这个意图」改成「值必须等于 `1`」 | web 1 failed（裸 `?signin` 那条） |
| W3 | 应用侧把参数改名 `login` | landing 1 failed（跨包抄件对账） |
| L1 | 导航「登录」退回站内那一页 | landing 2 failed |
| L2 | 把一节说明搬回 `/signin` | landing 1 failed |
| L3 | 去掉去文档中心的链接 | landing 1 failed |
| L4 | 落地页不加那个参数 | app-url 2 failed |
| L5 | 词条加了、`docs.ts` 忘了挂那一节 | landing 1 failed（**"只进字典没接线"那一族**） |
| L6 | 页头那颗应用入口消失 | landing 1 failed |
| A1 | 薄页正文里一条链接都不剩 | public-copy-register 2 failed |
| A3 | 摘掉薄页的 `PageHead`（只剩出口、没有标题） | public-copy-register 2 failed |

🔴 **A2 那条臂是我自己写的第一个版本的判据没有牙，实测出来的**：薄页豁免的第一版
断言"页面渲染的引言 = 注册表 `ledeKey` 的词条值"，而**两个读数都来自注册表** ——
把 `ledeKey` 指到别的键时两边**一起变**，175 条全绿。改成结构性两条腿（正文里有
非空 `<h1>` + 有可点的出口）之后 A1/A3 才会红。同一条教训第二次进这本账：
**自指的对账只证明"两处抄得一样"，不证明"抄对了"。**

**顺带清掉的一处"看起来在跑其实没跑"**：`public-copy-register.spec.tsx` 的断言 A
（每页 × 每语言渲染文本 >500 字）原本对每一页一视同仁，纯出口页会被它读成"观测面塌了"。
没有整体调低阈值（那会让真空壳页溜过去），改成**登记薄页 + 薄页自检两条腿**，
理由与两条腿各对应什么事故写在代码注释里。

**现量读数（这一轮）**：landing `1312 passed`（22 文件）、web `1507 passed | 12 skipped`、
i18n `22 passed`；`check:entries` 75 份一致、`check:ui-language`（zh/en 各 2826 条）、
`check:docs-voice`（site.* 1018 条零命中）、`check:layering`（9 条规则）、
`check:claims`、`check:design`、`check:l4`、`check:reachability`、`check:docs`、
`check:gate-wiring`（63 道定义 / 66 段链引用）全绿。

🔴 **这一轮我自己造的一次事故（已还原，但过程要留）**：新建 web 侧测试时用了
`signin-entry.spec.tsx` 这个文件名 —— 它**已经存在**，是判据 J1（头像 → 身份菜单那 8 条）。
`Write` 直接把它整个覆盖了。发现是因为 `git status` 里出现了一行 `M apps/web/tests/...`
而我以为那是新文件；立刻 `git checkout --` 还原，新测试改挂 `auth-deep-link.spec.tsx`
（与它测的源文件同名，本来就该这样）。
**成因**：我先跑的 `ls apps/web/tests | head -60`，目录比 60 行长，`s` 开头那一批
被截断了 —— 于是"看过清单"给了我一个**假的空位**。
**规矩**：新建文件之前用 `git cat-file -e HEAD:<路径>` 或**不限长度**的 `ls` 确认；
`head -N` 的清单不构成"这里没有东西"的证据（与
[`environment-traps.md`](../reference/environment-traps.md) 第 176 条同族：**读到的样本
不等于被约束的集合**）。

### 8.15 🔴 线上验收跑完，**两张截图**又各自抓出一件断言没报的事

§8.14 那批改动发布之后，新写的 `e2e/live-site/live-signin-entry.spec.ts` 第一次跑
（打的是**已发布**的产物，不是本机构建）——三件事同时暴露：

| # | 现象 | 是真缺陷还是判据写错 |
|---|---|---|
| 1 | 点「登录」之后 `[data-testid="auth-form-email"]` **不存在**，60s 超时 | **判据当时写错了**：全新访客的第一屏是首启隐私那一层，而 §8.14 的修法把深链**记到那之后**才兑现。用例红得对，正确的产品形状是"先一层 → 答完 → 表单出现"，于是把它钉成两步 |
| 2 | `/signin/` 的出口按钮在 **x=64 而引言在 x=88**（第一版是 x≈10 贴视口边缘） | 真缺陷：少了一层 `.lp-wrap`。`.lp-section` 只管纵向留白，横向内容列是 `.lp-wrap` |
| 3 | 引言与主行动之间悬着约 **150px** 的空洞 | 真缺陷（观感）：`.lp-section` 是"一整节内容"的留白，套在一页只有三行出口的页面上就是空洞。改成只留 `.lp-wrap` |

🔴 **1 与 2 都是"断言全绿而界面是坏的"**：`live-2-signin-panel.png` 那张图里
「Sign in or register」被隐私卡片盖住一半，而当时三条断言全过 ——
这就是 §6.2 规定一第 4 条（**人必须打开那张图**）存在的理由，不是仪式。

新增的两条判据（都取**同页的参照物**，不引入像素阈值）：

- 出口按钮的 `x` **等于页脚那条链接的 `x`**（两者都是 `.lp-wrap` 的直接子元素）；
- 答隐私之前 `auth-form-email` 的计数是 **0**（"只有一层浮层"这件事本身）。

线上复验读数（`739a96d6` 的产物）：3 条全绿；`live-2a-first-visit-consent.png`
= 首访只有隐私那一层；`live-2b-signin-panel.png` = 答完之后登录面板单独一层；
`live-4-signin-page.png` = 出口落在内容列里。发布顺序是**应用先、站点后**
（与 §3.7 那条"站点先发"相反）：新应用能接住 `?signin` 而旧站点不生成那种链接，
反过来的窗口里会出现"点了进应用但面板没开"。

⚠️ **一条已知但本轮没动的**：中文落地页点进应用后界面是**英文**（这台 headless
浏览器的 `navigator.language` 是 en，而默认语言刻意不带 `lang` 参数 —— 应用按自己的
偏好存储决定语言，见 roadmap §5.1 那两条保留之一）。真实中文访客不会撞上，
但它仍是那条保留的**后果**，不是新缺陷。

📌 顺带一条**门禁卫生**：新取证目录 `e2e/live-signin-results/` 当时没进 `.gitignore`，
`git status` 里就是一坨未跟踪 PNG —— 而那正是本仓 `.gitignore` 第 84 行注释里写的
"曾经差点被当成源码提交"的同一族。已补登记。

### 8.16 #7 那笔合并：零冲突**只**证明文本，剩下的要用接缝去量

先记一条**过期**：本节原计划"等并行会话提交后 `git merge --ff-only` 即可"。现量否证了它 ——
`git merge-base --is-ancestor main feat/self-host-distribution` 为**假**：main 自 merge-base
起前进了 28 笔、本批 25 笔。所以 #7 从现在起是一次**真合并**，不再是 FF。

合并面实测（全部不带管道取码，`| head` 之后的 `$?` 是 `head` 的）：

| 量 | 读数 |
|---|---|
| `git merge-tree --write-tree` 双向 | ~~`REAL_RC` 均为 0，输出恰好 1 行 tree OID ⇒ 零冲突~~ 🔴 **这句 8 小时后就过期了**：§8.22 现量 rc=1（6 条路径冲突），§8.29 又复算一次仍是那 6 条。它只对**落笔那一趟**成立 ⇒ 用它之前必须先跑一次 `merge-tree`，不许引用 |
| `pnpm-lock.yaml` | ~~main / 分支 / 合并树三边**同一个 blob** `674079fe` ⇒ 合并树不需要重装依赖~~ 🔴 **已过期**（§8.25 现量：main `d340e576` ≠ 分支/base `674079fe`）⇒ 落地后必须 `pnpm install`，"软链 node_modules 可用"这个前提没了 |
| `package.json` | 合并后是第三个 blob `82ec7dcc`（main 加 `verify:mobile-notes`，本批加那批 `check:*`）|
| 源码级文件交集 | **只有** `packages/i18n/src/locales/{zh-CN,en}.ts` 两个数据文件 |

词条表是唯一两边都改的源码，所以逐条量它：2826 → **2841** 键（main 加了 15），
两侧键数对等，**零重复键**（对象字面量里文本合并造出的重复键 TS 不报错、后者静默覆盖，
而 parity 类门禁挡不住它 —— 这条探针喂过合成样本做阳性对照：`dupKeys=1 [["a.key",2]]`）。
`check:ui-language` rc=0。
四把生成物门禁（`server-copy` / `server-design` / `legal-copy` / `docs-voice`）
加 `selfhost-entry-command` 全 rc=0 —— **且是重建 `packages/i18n` 的 dist 之后跑的**：
不重建就是量我 2826 键那一批的旧 dist，属于 §7 里"测试绿 ≠ 当前产物"那一族。

编译面不看文件名相同与否，看**接缝**：本批有 3 个文件（`apps/web/src/App.tsx`、
`apps/web/src/features/sync/store.ts`、`apps/mobile/tests/legal-recheck-mobile.spec.ts`）
import 了 main 也改过的两个 barrel（`@heyta/app-host`、`@heyta/ui`）。逐个符号查实：
这 3 个文件跨过接缝用到的 **17 个符号**在合并树里**声明与 barrel 重导出都在**
（负向对照 `NoSuchSymbol_zzz_control` 如期 MISS）。main 侧那 4 行 `-export`
（`aliveProjects` / `topLevelProjects` / `childProjects` / `toOrganizerTree`）
是在 `packages/ui/src/projects/model.ts` **原位重写**、不是移除，且本批一个都没引用。
main 两侧都没有新增 workspace 包（`packages` 14、`apps` 8 合并前后不变）⇒ 不会有
"缺软链让 typecheck 报出一个像产品坏的数"那种形状。

🔴 **`check:docs` 在合并树上红 5 处，而这 5 处一条都不是合并造成的 —— 是 main 自己现在就不绿**：

- `docs/plans/detail-pane-alignment.md` 与 `docs/research/detail-pane-alignment-and-spaced-review.md`
  只存在于 main（本批没有这两个文件）；
- `PROGRESS.md:1362` 与 `docs/plans/countdown-anniversary.md:1280` 那两行**只在 main 的版本里**
  （本批版本的同一行是空的）；
- 四个死链目标（`aed-implementation-evidence.md` / `trash-and-archive.md` /
  `calendar-year-time-and-mobile-profile.md` / `trash-and-archive-best-practice.md`）
  在主检出里**全是 `??` 未跟踪** —— 引用方已提交、被引文件还没提交，所以他们的链接
  在**他们的工作树里是活的、在提交里是死的**；
- 本批那 76 个文件里**一个都没碰**这四个引用方。

⇒ **#7 的关闭判据不能写成"`pnpm check` 全量绿"**（会被别人已提交的技术债挡住，
而那条债不该由本批吸收）。改成：上面这 8 把门禁绿 + `check:docs` 的 5 处红**逐条仍能
归属到非本批文件**。

一条不计入的：`check:web-artifact --mount /` rc=1。它读的是磁盘上的 `apps/web/dist`，
而我最后一次构建是为了发布应用带的 `--base=/app/`；`pnpm check` 链的第一步就是
`pnpm build`，所以链内自洽。但它把 **G-48 的真实形状**照出来了：链里挂的是 `--mount /`，
而生产实际发出去的那份是 `--mount /app/`，**同一个 `dist` 目录不可能两条同时绿**。
所以 G-48 不是"顺手把它挂进链"就能闭合的 —— 要的是决定（产物分目录，还是挂载路径变成构建参数后
由链按当前载体选）。这条**本轮没动**，仍是开口。

载体：**`feat/self-host-merge-main`**（不落 /tmp）。**只认这个分支名，不认 SHA** ——
本批每多一笔提交、或 main 每前进一步，它都要用下面几行重算一次，SHA 一定变。
（我自己刚犯过一次：这一节写下 `50b02558` 之后本批又多了一笔文档提交，
指针当场变陈旧，重算得到 `834f9613`。这正是 traps 里"抄件一定会漂"的形状，
所以正确写法是把**重算命令**当载体，而不是把某一枚 SHA 当载体。）
第一父是 main，这样落地后 `git log --first-parent main` 不会跳进本批历史。重算：

```bash
mb=$(git merge-base main feat/self-host-distribution)
tree=$(git merge-tree --write-tree main feat/self-host-distribution) || exit 1
git commit-tree "$tree" -p "$(git rev-parse main)" -p "$(git rev-parse feat/self-host-distribution)" -F <msg-file>
```

🔴 **这三行只在"零冲突"那一趟成立，而 2026-10-04 08:0x 现量它已经不成立了**（§8.61 ①：
`git merge-tree --write-tree --name-only main feat/self-host-distribution` ⇒ **rc=1**，
`self-host-distribution-audit.md` 与 `package.json` 两条内容冲突）。
量过的一件事：`--write-tree` 在**有冲突时照样写出一棵树**，而那棵树里两个文件**都带 `<<<<<<<` 标记**
（现量 `f3f3b234` 那棵树：`package.json` 1 处、审计文档 1 处；负向对照本分支 HEAD 的 `package.json` = 0 处）。
所以这三行现在**只剩"退出"这一条路**：`|| exit 1` 会接住 rc=1，逐字照抄的人得到的是一个失败，
不是一枚坏载体 —— 这一点要说准，别写成"照抄就会把冲突提交进历史"（那是**去掉守卫**之后的形状）。
真正过期的是它上面那句话："SHA 一定变 ⇒ 用**下面几行**重算一次"。落地的机制已经是
`research/tools/selfhost-merge-carrier.mjs`：它把冲突**分族逐个解**
（pkg 并集 / .gitignore 两块都留 / evidence PNG 取 main / 审计文档并集 / 族外一律 die 交人判）再落笔，
而这三行只是它内部的**一步**，不是给人的手册。

🔴 **尚未实测的边界（写明，不主张）**：`pnpm -r typecheck` 与 `pnpm -r test` **没跑**。
本轮现场是负载 81.90 / 16 核、OrbStack 的 docker daemon 未运行；且此时 dist 半新半旧
（只重建了 i18n），typecheck 量不到东西。所以"合并树编译绿 / 测试绿"目前是**主张，
不是读数**，落地那一趟必须在合并载体上跑完整链才算。

⚠️ **待入 traps**（编号按收口当时的**工作树**取，不写死 —— 该台账此刻正被并行会话脏着，
HEAD 到 177 而工作树已到 189，190+ 属于他们）：

1. `git grep -E` 里 `\b` **不是词边界** ⇒ 一次 18 符号的存在性检查全报 0，症状与
   "符号真的不存在"逐字相同。识别形状：连 AGENTS.md 明文写着的 `createSyncClient`
   都在 0 里 —— 全集为 0 时先怀疑探针，别先怀疑结论。
2. zsh 里 `$ref:apps` 被 **`:a` 修饰符**吃掉，展开成"绝对路径 + `pps`"，
   于是打出 `main apps:0` 这种看着像读数的假值（真实是 8）。跨 ref 取属性一律写 `"${ref}:path"`。

📌 **探针的载体说清楚**：这一节用到的两枚探针（源码文件交集/接缝解析、导出符号查实）是
**一次性现场脚本，没有进仓库** —— 进 `scripts/` 会改 `check:script-snapshot` 的快照，
而在共享工作树里跑全仓生成器是本仓已登记过的另一族坑。可复用的部分是上面那两句**方法**
（两侧源码取交集 → 查本批 import 的 barrel 有没有正好被对方改过 → 跨接缝符号逐个查实 +
一枚已知不存在的负向对照），不是脚本本身。

### 8.17 G-44：登记说"补个生产者"，取证说"补了会把日志变成假信号"

Goal 把 G-44 排成"补 `appVersion` 的生产侧"。四条实测把这条**否证**了，所以本批改的是
**对外说法**而不是代码：

1. **闸门今天唯一的消费者是一行日志。** `MIN_CHECKPOINT_SAFE_APP_VERSION` 只被
   `server/src/sync/cleanup.ts:63-72` 读来打印 `Cleanup [checkpoint-gate]`。搜遍
   `server/src` `server/scripts` `packages` `apps` `scripts`（排除 `dist` / `node_modules` /
   `dist-types` / `bridge-bundle`）的 `cadence|checkpointInterval|CHECKPOINT_INTERVAL|
   scheduleCheckpoint|createCheckpoint|autoCheckpoint`：**7 处命中，全部是注释** ——
   `checkpoint-gate.ts:6/9/113`、`cleanup.ts:62`、`dry-run-old-ops-sweep.ts:16/182`
   （那里把 cadence 列为"#9688 的后续方向"）、`monitor.ts:176`（说的是 autovacuum 的 cadence，
   与本题无关）。没有任何实现。
2. **剪枝的授权不是独立端点，而是"最新那条因果全量 op"**
   （`server/src/sync/services/storage-quota.service.ts:417`）。
3. **服务端这一半是实现着的，缺的是客户端那一半。**
   `server/src/sync/sync.routes.snapshot-handler.ts` 完整解析 `snapshotOpType` 并写下边界；
   而 `packages/sync-client`（整个目录只有 `client.ts` `index.ts` `realtime.ts` `server-url.ts`
   **4 个文件**）对 `snapshot|checkpoint` **大小写不敏感 0 命中**，`apps/*` 源码里也没有构造点，
   `SYNC_IMPORT / BACKUP_IMPORT / REPAIR` 在 heyta 只以枚举存在
   （`packages/shared-schema/src/supersync-http-contract.ts:20-22`、
   `packages/sync-core/src/operation.types.ts:18/26/34`）。
   ⇒ 只用 heyta 客户端的账号今天**不会被剪**，代价是历史一直长 —— 存储成本，不是丢数据。
4. **阈值住在别人的版本空间里。** `18.21.2` 是 Super Productivity 的发版号，heyta 是 `0.x`；
   上报 heyta 空间的值只会让 `unversionedDevices` 变成"有版本但旧"，
   而**把 `safeAccounts` 往上推的是那个假象本身** —— 真前提（客户端能因果地创建/应用全量边界）
   并不存在。⚠️ 而且这条不对称意味着**上游 SP 客户端连我们的服务端是真的会写边界**，
   所以不能为了让自家数字过闸门而把阈值降低：那会让 18.20 这类**真旧**客户端被判安全。

⇒ 结论：G-44 不是自托管分发的缺口，属于"客户端检查点/全量边界"这条未实现的功能。
把它从登记改成三个前置条件的写在 `server/README.md`「Clients and version coupling」
（**详细版只住那一份**，本行是指针 —— 抄一份就会漂）。原句把前置写成两项且暗示
"客户端只差上报版本"，那句现在看是不完整的对外说法，已就地改掉并留了这条来历。

G-40⑤（版本来源）因此多了一条硬约束：**它必须和闸门共用一个版本空间**，
不是"给 package.json 找个消费者"那么简单。

### 8.18 G-49：登记说"文章是第 4 份抄件"，实测它连一条完整命令都没有 —— 而碎片比没抄件更坏

取证形状（`site.docs.selfhost.*` 共 **58 条**，中英各一份）：

- 行首是 `docker compose` 的命令：**0 条**（所以"第 4 份抄件"这句按字面不成立）；
- 提到 compose 的只有 `s7p2` 一条，而它印的是 `-f docker-compose.yml -f docker-compose.build.yml
  -f docker-compose.migrate-once.yml` 这个**碎片** —— 没有 `docker compose` 前缀、没有 `up -d`、
  **没有 `--build`**。

🔴 碎片不是"缺一条判据"，是**一个会伤人的呈现**：读者把它拼成 `docker compose … up -d` 敲下去，
少的正是 `--build`，得到的就是 §8.11 记的那次 `pull access denied`。
所以闭合做的是两步，顺序不能反：**先让文章给出完整一条**（中英各一份，与 runbook 逐字相同），
**再把它纳入对账** —— 反过来只会得到一条"扫了但读不到东西"的空判据。

门禁侧（`scripts/check-selfhost-entry-command.mjs`）：

- 扫描集从 5 份变 **7 份**（新增两份词条表，`source: 'copy'`），现量命中 **9 条**入口命令、
  两份词条各贡献 1 条主命令 ⇒ R5 的**跨抄件逐字比对**现在覆盖它们（中英与 runbook/README 同一句）。
- 🔴 命令形状的正则**没有抄第二份**：`ENTRY_BODY` 是唯一常量，markdown 的行首版与词条的前缀版
  都从它导出（"同一个判断抄三遍"是本仓反复出事的地方）。
- 词条报错定位带**键名**（`行号 · site.docs.selfhost.s7p2`）—— 只给行号等于让人在 2841 行里猜。

五臂变异（每臂跑完立即还原，还原后与基线 **md5 逐字相同**、复跑复绿）：

| 臂 | 改哪 | 期望 | 实到 |
|---|---|---|---|
| A | 中文抄件去掉 `--build` | R5 | ✅ |
| B | 英文抄件把 `migrate-once` 改名 | R2（文件不存在） | ✅ |
| C | 中文抄件退回成 `-f` 碎片 | R6（探针读不到主命令） | ✅ |
| D | runbook 主命令丢 build override | R1 | ✅ |
| E | runbook 末尾留悬空反斜杠 | R0 | ✅（**要构造得对**：文件必须以反斜杠结尾且**没有**尾随换行，否则 `split('\n')` 会给出一个空串当续行，R0 永远不触发 —— 我第一次就构造错了一次，症状是"红是红了，但红在 R5"） |

浏览器侧（§6.2 规定一）：`e2e/landing/docs-centre.spec.ts` 新增一条，**1 passed**，
截图 `e2e/landing-results/g49-selfhost{,-en}.png` 两张**人都看过** —— 中英两版在
"怎么装 / How to install"一节都渲染出完整一条。
🔴 这条判据**刻意不 import 门禁脚本**，而是自己读那份 markdown 折行取参照物：
两边从同一个读者拿期望值，判据就只是把门禁念一遍。

回归到的门禁（全 rc=0）：`ui-language` / `docs-voice` / `script-snapshot` / `server-copy` /
`legal-copy` / `check:entries` / `selfhost-entry-command`。`check:entries` 无变化是预期的 ——
文章是客户端渲染，入口 HTML 只有 head/meta。

⚠️ **一条已知没做的**：命令在文章里是**散文中的内联代码**（软换行），不是围栏代码块。
复制不受影响（浏览器软换行不插入换行符），但要给它一个真正的代码块需要文档渲染器加一种
新的分区形状 —— 那是界面结构改动，不在这一批里顺手做。

---

### 8.19 G-48：登记写"零自动消费者"，实测是"别名没人跑、脚本本体一直有人在跑，而真正没人守的是 rsync 那一趟"

这一条从登记到关闭只隔了 15 分钟，而**翻转的不是判据，是主语**。写下来是因为它的形状很容易再犯：
判据的名字和判据本身不是同一个东西，`grep` 到 0 次的那个是名字。

#### 现量（三条，全部是这一趟跑出来的，不是从表里抄的）

| # | 量什么 | 读数 |
|---|---|---|
| A | 收盘点前磁盘上那份产物（今天 17:06 留下的，按 `/app/` 打的）分别按两种载体验 | `--mount /` → **rc=1**，报「产物声明它挂在 `"/app/"`（从 index.html 的 2 条 assets 引用反推）」；`--mount /app/` → **rc=0**，`246` 个 `--ht-*` 定义、`5` 个 index.html 本地引用、`15` 个 manifest 文件、`4` 个组件数据 URL 落在 `/app/widgets/` |
| B | 新记录的那条构建命令照抄一遍，再拿同一份字节验两条 | `HEYTA_WEB_BASE=/app/ pnpm --filter @heyta/web build` rc=0 → `src="/app/assets/index-Cg9joIvN.js"`；`pnpm check:web-artifact:app` **rc=0**，同字节上 `pnpm check:web-artifact` **rc=1** ⇒ 登记里那句"同一个 `apps/web/dist` 不可能两条同时绿"**第一次被量出来**，此前它只是写在表里的一句话 |
| C | `pnpm check` 里这两段的位置 | 链共 `66` 段：`pnpm build` 在第 **2** 段，`check:web-artifact` 在第 **62** 段 ⇒ 链自己先把 `apps/web/dist` 重打成**根载体**，然后验那份刚被打出来的根载体 |

读数 C 才是这道门禁最不舒服的地方，也是"顺手把它挂进链"这个建议的真正问题：
**链永远看不见生产那份字节。** 它不是"漏了一个消费者"，它是结构上不可能有 ——
链里那份产物的挂载路径由链自己第 2 段决定。把它挂进链只会多一个**必然绿**的读数，
然后把"有人守"这句话变成假的（AGENTS §7 元规则 2 的第三种面目）。

#### 决定（以及被否证的那半句登记）

- `server/Dockerfile:191` 早就在跑这条判据：`RUN node scripts/check-web-artifact.mjs --dist apps/web/dist --mount /app/`
  ⇒ 镜像构建那一趟**一直有自动载体**。原登记"零自动消费者"搜的是 npm 别名 `check:web-artifact:app`，
  别名与脚本本体是两种字面形状，只搜一种就会把另一种判成"没人跑"。
- **链里不放这道判据**（读数 B/C 就是理由）。改成**每个载体各自带对账**：
  镜像路径已有（Dockerfile），人工发布路径本轮补上。
- `docs/runbooks/deployment.md` §3.7「重新发布的两条命令」→「**三条**」：
  `构建 → pnpm check:web-artifact:app → rsync`。同一形状补进"干净 HEAD 上构建"那一组。
  第三组（2026-10-03 那次三列塌成三段全宽的修法）**不改写命令本身**，只在其后加一句
  "这是事故现场记录、不要照抄，要重发请照 §3.7 那三条" —— 把事故当时的命令改成后来修好的样子，
  下一轮就没人能从这段读出当时到底跑了什么（同 §7 那张表里排除审计报告的理由）。
- 🔴 顺带修掉这一族的第二种坏法：那三组命令**都在 `cd apps/web` 之后紧跟
  `rsync -az --delete apps/web/dist/ …`** —— 源路径在 `cd` 之后不存在，照抄的人得到一条
  rsync 报错，而它看起来像"服务器连不上"。这与 §8.18 修掉的落地页那一发是同一个形状，
  而它在这个文件里存在**三处**。现在三组都不再 `cd`，构建改用 `vite.config.ts` 里那个会校验取值的
  `HEYTA_WEB_BASE`（命令行 `--base=` 绕过校验，参数比默认值多的那一档就是白给）。
- 把"有没有人跑它"从注释变成判据：`check:gate-wiring` 的链外允许表原本只要一句理由 ——
  而那句理由自己写着「⚠️ 已知缺口：目前**没有任何自动载体**跑它」，门禁照样绿。
  现在每条链外门禁必须有 `consumers[]`：文件存在、且文件里**有一行以这条命令开头**。

#### 变异验证：6 臂，5 臂按预期红、1 臂按预期绿

载体：`node scripts/check-gate-wiring.mjs --pkg <真 package.json> --root <临时树>`
（`--root` 是本轮新加的旋钮，只为注入验证存在 —— 主检出有别的会话在飞，不许为验证去改工作树）。

| 臂 | 做法 | 期望 | 读数 |
|---|---|---|---|
| E | 未变异（阳性对照，防"整片红其实是探针坏"） | rc=0 且两条消费方各打印一次 | ✅ rc=0，`deployment.md（2 处）` / `Dockerfile（1 处）` |
| A | 删掉两处 rsync 前的对账命令，**散文里仍提到它** | rc=1 报 runbook | ✅ rc=1「里没有任何一行**以这条命令开头**」 |
| B | 把 Dockerfile 那行 `RUN …` 注释掉（字符串还在文件里） | rc=1 报 Dockerfile | ✅ rc=1，同一句话 |
| C | 消费方文件整个不见 | rc=1 报"不存在" | ✅ rc=1「载体被改名/删掉/挪走了，而这里还登记着它」 |
| D | `consumers:` 键名打错（等价于没登记） | rc=1 报"没有 consumers" | ✅ rc=1「它不是"手动跑的那一条"，它是"没有人跑的那一条"」 |
| F | 删掉**构建**那一行 | **rc=0** | ✅ rc=0 —— 本门禁只管"这条判据有没有人跑"，红在这里就是判据越界 |

🔴 A 与 B 这两臂是**改出来的**，不是设计出来的：needle 一开始写的是 `includes`，
而我给第三组（事故记录那段）加了一句"它少了 `pnpm check:web-artifact:app`"，
门禁当场把那句**散文提及**数成一次命中（读数从 2 处变 3 处）。
也就是说两条真命令块全删掉、只留一句"这里本该有它"，门禁仍然绿 —— 与它要防的那一发一模一样。
⇒ 匹配改成 `line.trimStart().startsWith(needle)`，needle 连指令前缀一起写
（Dockerfile 那条必须写成 `RUN node …`）。B 臂测的就是这一层。

#### 已回归的门禁与产物

`check:gate-wiring` rc=0（63 道定义 / 66 段链 / 链外 1 道，消费方读数逐条打印）、
`check:web-artifact` 恢复根载体后 rc=0、`--check` 语法 `node --check` 两份脚本均 OK。
本轮**没有**改 `apps/web` 源码，只重打并最终恢复成默认载体（`/`），
`check:design` / `check:ui-language` / `check:docs` 不受影响（改动落在 runbook 与 `scripts/`）。

#### 残留（登记，不沉默）

1. 🔴 **rsync 那一趟仍然是人工的**。本轮让它"少一步就会被门禁红抓住"的前提是
   人照着 runbook 走；`consumers` 判的是"runbook 里那行命令还在"，不是"有人执行过它"。
   要把后者变成判据就得把发布收成一个脚本（`scripts/publish-web-app.mjs`），
   而那是**新的对外动作面**（它会 rsync 到生产），不在本批授权内 → 记为 **G-48b**。
2. `apps/web/dist` **一个目录、两种载体**没有变（读数 B 就是它的直接后果）。
   真正的结构解法是按载体分目录（`dist` / `dist-app`），但 `apps/web/dist` 同时是
   macOS 与 Windows 安装包的 `web-dist` 输入（AGENTS §6.1.1 那张表），
   改名要把 `package-app.sh` / `package-msix.ps1` / `reinstall-all.sh` 的同步对账 / Dockerfile
   一起改，属于四端打包输入的变更 ⇒ 不在"关一条门禁"这一批里顺手做，
   本轮的缓解是对账必须紧跟构建（同一条命令链里），错了会响亮报两侧取值。

---

### 8.20 G-47：登记说"传上游发新版不会红"，实测是"没人发版也在漂"，而写好的那个闭合形状走不通

这一条今天**没有关闭**，但把它从"一句推测"变成了"14 个包名"，并且把登记里现成的闭合形状
（`pnpm deploy --prod`）实测否掉了。这两件事都做完了才动手写下一批，顺序不能反过来。

#### 现量：镜像那棵树 vs pnpm 那棵树

A 侧取 `pnpm --filter @heyta/sync-server list --prod --depth Infinity --json`
（**让 pnpm 自己算它按 lockfile 装出来的树**，不另写一个 YAML 解析器 —— 那会变成第二套转义规则），
B 侧取已提交的 `server/image-npm-tree.json`（`generatedAt=2026-10-03T07:58:46Z`，`--check` rc=0 输入哈希仍对得上）。

| 量什么 | 读数 |
|---|---|
| A 侧包名 / name@version | 154 / 159（其中 3 个是 `@heyta/{domain,shared-schema,sync-core}` 本体） |
| B 侧包名 / name@version | **139 / 143** |
| 只在 B 侧（镜像多装了东西） | **0 个** ⇒ 问题不是"多装了"，纯粹是版本 |
| 只在 A 侧 | 12 个 = 11 个平台专属（`@node-rs/argon2-{darwin-arm64,win32-*,linux-arm-*,…}`）+ `fsevents` ⇒ **不算漂移** |
| 同名同版本 | 125 个 |
| 🔴 **同名不同版本** | **14 个，全部是 B 比 A 新** |

那 14 个（镜像 / pnpm）：

```
@fastify/static       10.1.5 / 10.1.4     ← server 直接依赖，范围 ^10.1.2
ws                    8.22.0 / 8.21.3     ← server 直接依赖，范围 ^8.18.0
pino                 10.4.0 / 10.3.1     ← 传递
@peculiar/asn1-*     2.10.0 / 2.9.5     ← 传递，11 个，由 @simplewebauthn/server 拉进来
```

🔴 **这一发要打掉登记里那句"改直接依赖会红，纯传递依赖的上游发新版不会"**：它说轻了。
两个**直接依赖**也在漂，而且没有任何人改过 `server/package.json` ——
`^10.1.2` 同时容得下 10.1.4 和 10.1.5，`^8.18.0` 同时容得下 8.21.3 和 8.22.0。
**漂不需要动作，只需要时间。** 而 `@peculiar/asn1-*` 那一族坐在 `@simplewebauthn/server` 底下，
也就是 **passkey 注册与验证的解析路径**上；`@fastify/static` 是托管 `/app/` 的那个包；`ws` 是实时同步。
发出去的镜像跑着一套本仓库**任何一条测试都没跑过**的版本组合，而 `pnpm check` 全绿 ——
因为链验的是 pnpm 那棵树，镜像装的是 npm 那棵树。

`check:image-license` 那两条今天都是绿的（`--check` rc=0、覆盖率对账 rc=0）——
它们管的是"**每一条有没有出处**"，不管"**是不是审过的那一个版本**"。
这正是 G-47 说的"有守卫 ≠ 有牙"，只是牙在另一处：**快照与解析之间**没有等式。

⚠️ 探针层的一条（不改结论但会改读数）：B 侧按 `TARGET={os:linux,cpu:x64,libc:musl}` 解，
A 侧装在这台 darwin/arm64 上 ⇒ 不先按平台分层，`@node-rs/argon2-*` 那 11 个会被读成"pnpm 多装了 11 个包"。
差集必须先过这一层再谈漂移。

#### 为什么登记里那个"现成的闭合形状"今天走不通

`pnpm deploy` 这四发都是实测，不是推断（pnpm 11.8.0）：

| 试的东西 | 结果 |
|---|---|
| `pnpm deploy --prod --out=<dir> server` | `Unknown option: 'out'` rc=1 —— 正确形状是 `pnpm --filter <包名> deploy --prod <目录>` |
| `pnpm --filter @heyta/server deploy …` | **打印 `No projects matched the filters` 然后 exit 0**，目标目录根本没建。真名是 `@heyta/sync-server` ⇒ 🔴 **filter 打错的 deploy 会静默什么都不做还报成功**：把它写进 Dockerfile 的人会得到一个"依赖装好了"的镜像层，里面一个包都没有 |
| 同上，加 `--fail-if-no-match` | rc=1 `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`：pnpm v10+ 只从 `inject-workspace-packages=true` 的工作区 deploy |
| `--legacy` | rc=1 `@heyta/i18n is not in the npm registry, or you have no permission to fetch it` —— legacy 实现**不内联 workspace 依赖**，回头去 registry 取我们的包；而它失败前已经把 server 的 36 个文件（6.8 MB）拷进目标目录，`node_modules` 是 0 条 ⇒ **一次失败的 deploy 会留下一个看起来像产物的半成品目录** |

⇒ 登记里那句"三个 `workspace:*` 由 pnpm 内联、三枚 tgz 的 dance 一起消失"要么要求
`inject-workspace-packages=true`（**全仓依赖解析方式改动**：每个包的 node_modules 从符号链接变实体拷贝，
`pnpm -r build` / `check:licenses` 扫的 store / 四端打包输入都得重新验一遍），要么走 `--legacy`
（pnpm 自己标注的旧实现，且实测它现在解不了 workspace）。两个都不是"改一行 Dockerfile"。

#### 今天为什么没把判据先加上

等式判据（快照的每个 `name@version` 必须等于 pnpm 树里的）现在加上去**就是 14 条红**，
而红着的链会被 #11 那次合并载体全量跑当成"这批弄坏了仓库"。
把链留在红态、或者为了让它绿而先放宽判据，是同一件事的两个错法（AGENTS §8.4：不要为了让测试变绿而改测试）。
⇒ 判据必须和"镜像装的确实是这份快照"**同一批**落地，一批里两件事一起变绿。

#### 下一批的三步（编号在这，别靠记忆）

🔴 **2026-10-04 复账：这三步只落了第 3 步，第 1、2 步 prescribed 的形状被实测否证或换掉了。**
逐条写明，免得下一轮照它做一遍已经作废的事：

1. ~~**把快照从"读数"升成"合同"**：改成装配阶段按快照里的 `name@version` **逐条钉版本**安装
   （`npm install` 的实参来自快照，不再来自 `^` 范围）……而且**不新增第二份 lockfile**。~~
   **两个否决理由**（都量过，不在这里靠印象）：
   ① 把 143 条钉进 Dockerfile，会让快照 `inputs` 的"形状哈希"去哈希快照自己的内容
   ⇒ `--check` 退化成"快照 ↔ 自己"，永远绿（§8.26）；
   ② "不新增第二份 lockfile"这一条被后面的实测**反过来了** —— 落的是**提交物 npm 锁**
   （§8.46 结论四 → §8.47）。当时怕的"第二份抄件会漂"是对的风险，但解法不是不写，
   而是给它一条**防腐烂判据**（`check-image-install-contract` 第 4 步：锁必须逐条盖住
   `server/package.json` 的每条声明，且 `COPY` 必须在生产阶段）。
   为什么不能选"提交锁 + `npm ci`"那个更朴素的形状：§8.46 六档表（热缓存**静默装旧包**、冷缓存 `EINTEGRITY`）。
2. **等式判据同批进链**：落了，但**不是登记里那一对**。等式写在
   锁 ↔ 依赖声明（覆盖 + 版本-范围 + 反向多余）和**两种树互证**（提交物锁导出的树 ↔ 镜像里枚举的真树）上。
   ~~快照 ↔ pnpm 生产树~~ 这一对**没有落**，也不该落：镜像走 npm、门禁扫 pnpm，
   是**两棵树**（§8.8 那半句至今为真），把它们写成等式等于要求两条解析路线逐版本相同 ——
   G-53 那一族（平台变体）第一个挡在那儿。差异现在由**镜像独有 17 条逐项登记 + `carrier` 字段**承接，
   而平台变体本身另有**判定 4**按锁逐条判（14 枚全判，与"发哪几档架构"脱钩）—— §8.48。
3. ✅ **真构建复验**做了两趟（§8.45 第三趟全跑、§8.47 两趟含 `ws` 差分鉴别实验），
   并且**在镜像内**读了实际装的树：判据从"与快照逐字相同"改成了更强的形状 ——
   磁盘枚举 ⊆ npm 自己写的锁的非 dev 条目，且差集**必须全是 `optional: true`**（现量 145 ⊆ 158、差 13 条全 optional）。
   "143 条"这个期望数已经过期：模式 A 现在 **146**、模式 B **145**（三枚自家包进了快照 + 遍历器补了下钻嵌套 `node_modules`，
   见 §8.45 那 4 条盲区）。⚠️ 登记里那句"若改成 `pnpm deploy` 路线要带 `--fail-if-no-match` / 解包到新建空目录"
   作废 —— 那条路线根本没走（四发实测见本节上面）。

🔴 三条读数都属于"登记与现实的差"这一族，写在这里而不是只写在提交信息里：
`check:image-license` 绿、`--check` 绿、`pnpm check` 全绿，**三条同时成立的时候，
生产镜像已经在跑 14 个没被测过的版本**，其中 11 个在 passkey 的解析路径上。
一条"逐条有出处"的门禁给出的安全感，恰好是这件事最难被发现的原因。

---

### 8.21 G-40③④⑥ 逐条对账：④ 登记说"两句打脸"，现量是六处，而且**错的那半换了方向**

#### ④ 的现量：同一站点上「一条命令」出现 6 处，不是 2 处

| 键 | 句子（中文原文，节选） | 立场 |
|---|---|---|
| `landing.selfhost.title` | 「自己的服务器，一条命令起全套」 | 承诺 |
| `landing.cta.lede` | 「…一条命令就能起自己的服务端…」 | 承诺 |
| `site.features.item.sync.selfhost` | 「自建服务器：一条命令在自己机器上跑起来…」 | 承诺 |
| `site.integrations.selfhost.item.compose` | 「一条命令起全套服务，数据落在你自己的磁盘上」 | 承诺 |
| `site.help.a.selfhost` | 「…不是一个命令就完事：…**把服务起来不等于部署完成**（数据表结构的变更要显式执行一次）」 | 否认 |
| `site.docs.selfhost.sum` | 「…但它是"自己运维一套服务"，不是一个命令就完事。」 | 否认 |

登记写的是"自建区标题 vs 文档中心"两处，实际是 **4 处承诺 + 2 处否认**，而且否认那两句藏在
FAQ 与文档中心摘要里 —— 读者先撞见承诺，再在帮助面撞见"这做不到"。

🔴 **更要紧的是：这批工作自己把这两句否认变成了错话。** 它们说"表结构的变更要显式执行一次"，
而本批交付的 `docker-compose.migrate-once.yml` 正是把首次开机的迁移并进那一条命令里的东西
（入口命令对账 R3 就是为它存在的）。今天的真实形状是：

- **首次安装**：一条命令起全套 **并且** 迁移跑过 ⇒ "不是一个命令就完事"对这一档**已经不成立**。
- **升级**：一次性迁移服务跑完就退出，compose 不重跑已退出的 `restart:"no"` 服务
  （这正是入口命令对账 R4 记的那件事）⇒ 对这一档**仍然成立**。

⇒ 改法只动**事实半句**，不动营销口径：`site.help.a.selfhost` 现在说"目前没有任何现成镜像 +
**升级不是一条命令**（要照指南里点名 `supersync-migrate` 的那条再跑一次）"；
`site.docs.selfhost.sum` 改成"把服务起来那条命令不难，难的是后面全是你的运维（备份与恢复、升级、TLS、
出问题时没人替你看日志）"。**两句都不再断言"一个命令完不完事"**，因为那件事现在有确定的分档答案。
🔴 4 处承诺句**一个字没动** —— 要不要把"一条命令"作为对外主口径是 **D-2**，那是产品负责人的决定，
不是我能替拍的；这条对账的价值是把 D-2 的**真实选项**摆出来：现在这 4 句是**对的**（对首次安装），
D-2 要拍的不再是"要不要停止说谎"，而是"要不要把升级那一档也写进承诺位"。

⚠️ 顺手修掉一处**代码里的过期注释**：`apps/landing/src/lib/repo.ts` 还写着
"站内那篇文章是入口命令的第 4 份抄件，而扫描集里目前没有它" —— 那是 G-49 关掉**之前**的事实，
两份词条表现在都在扫描集里。注释与它描述的门禁状态漂开，是这条批次里第三次同形状的事故。

#### ③ 的现量：登记那半句"重新发布落地页本批没做"已经过期

`docs/runbooks/self-host.md` 在树里（11155 B），`SELF_HOST_GUIDE_URL` 从页面注册表取路径 ⇒ `/docs/selfhost/`。
线上现量（`curl --noproxy '*'`，绕开本机代理的 fake-ip）：

```
/docs/selfhost/    200
/app/              200
/health            200
```

⇒ ③ 的"目标存在且可点"这一半，今天**在线上成立**。落地页的重新发布也确实做过（§8.13 那一轮），
所以登记里"本批没做"那半句已改（见 §7 表 ③ 行）。

#### ⑤ 的现量：版本来源仍然没有约定

| 包 | version |
|---|---|
| 根包 | `0.0.0` |
| `apps/landing` | `0.0.0` |
| `apps/web` | `0.0.0` |
| `@heyta/sync-server` | **`1.0.0`** |

⇒ 与登记一致，**未关**。而且它现在多了一条来自 G-44 的约束：版本来源不仅要存在，
还要与 `MIN_CHECKPOINT_SAFE_APP_VERSION`（`18.21.2`，Super Productivity 的版本空间）**同空间**，
否则闸门永远判不出"新客户端"。这条已经写进 `server/README.md` 的前置条件第 1 条。

#### ⑥ 的现量：兼容矩阵仍然不写，触发条件三处一致

矩阵**不存在**（全仓没有"支持 N-1 / 同 major"的表），而这是**有意的**：
`server/README.md` 现在把触发条件写成三条前置（版本来源同空间 / 客户端有真 full-state 生产者 /
有东西消费那个闸门），与 G-44 的重分类、与 §7 里"第一枚镜像发布时 ⑤ 与 G-44 必须同时落地"
那句互相指得到。**未关，且不因为本批做了别的而更接近。**

#### 这一条的验证读数（全 rc=0）

`check:ui-language`（zh 2826 / en 2826 对等）、`check:server-copy`（2×81，本次未变：改的是 `site.*` 不是 `server.*`）、
`check:entries`（75 份入口与注册表一致 —— 摘要句**会**烘进入口 HTML，所以这次有 4 份 HTML 跟着变）、
`check:legal-copy`、`check:docs-voice`（1018 条 site.*，豁免自托管 120 条，30 项禁词零命中）、
`check:selfhost-entry-command`；`@heyta/i18n` 22 passed、`@heyta/landing` **1312 passed**、
landing `typecheck` 0；真浏览器 `docs-centre.spec.ts` **18 passed**，
截图 `landing-body-selfhost.png` / `g49-selfhost.png` **人看过** ——
新摘要句在页面上渲染出来了，而文章里「怎么装：没有现成镜像，两条路自己选」那节
与新的 FAQ 句不互相矛盾（逐条读过 `s1i1/s1i2/s7/s7p1/s7p2/s9p1/s9p2`）。

⚠️ **仍然没做**：词条改了 ≠ 页面改了。这 4 份入口 HTML 与两份词条要**重新发布落地页**才对外生效，
而发布是共享状态动作 —— 等这批对外文案定稿（D-2 一锤）之后一次发，不逐条改一次发一次。

---

### 8.22 🔴 §8.16 那句"零冲突"几小时后就过期了：现在 `merge-tree` rc=1，六条路径冲突

现量（2026-10-04 00:1x，`main` = `d27bccde`，`feat/self-host-distribution` = `faa5e730`，
merge-base = `437e7c1a`）：

```
git merge-tree --write-tree main feat/self-host-distribution   →  rc=1
```

| 冲突路径 | 类型 | 两侧各是什么 |
|---|---|---|
| `.gitignore` | content（**两侧都在文件末尾追加**） | main：`/tmp/`、`e2e/_probe/`、`e2e/playwright.probe.config.ts`、`e2e/vault-results/`、`.vitest/`、`tmp-commit-plan.sh`；本批：`e2e/selfhost-stack-results/.last-run.json`（带"只忽略这一枚，s1–s3 截图仍可提交"的理由块） |
| `apps/web/evidence/assistant/1-disclosure.png`<br>`assistant/2b-chat-dark.png`<br>`task-row-touch-target/timeline-light.png` | **binary**（git 明说 `Cannot merge binary files`） | 两侧都刷新过同一族取证图：main 有 `0c8a0ad4 test(evidence): 刷新助手/象限/触达目标的取证图（并行批次现量）`，本分支上另有一笔 `f304e713` 做了同一件事 |
| `docs/research/self-host-distribution-audit.md` | **add/add**（merge-base 里没有这个文件） | main 有一份 **176 行**的版本；本分支这份 1100+ 行（📌 01:3x 复算：**1723** 行，main 那份仍 176 行） |
| `package.json` | content | 两侧都往 `check` 链里加门禁（§8.12 记过的同一形状） |

#### 这条读数的价值不在"有冲突"，在"它把 §8.16 变成了一条会过期的引用"

§8.16 落笔时 `merge-tree` 两个方向都 rc=0，那是**当天那趟**的事实。几小时后 `main` 前进了
**16 笔**（`0a61c0a6`→`d27bccde`，含 ADR-0046/0047/0050/0051 那一批），冲突就从 0 变成 6。
⇒ **#7 的关闭判据不能引用本文档任何一次合并读数**，只能在落地那一刻重跑那三行。
这与"红段集合是活树瞬时读数、不是提交属性"是同一件事，只是这次过期的是"绿"的那一侧 ——
**过期的绿比过期的红更危险**，因为它读起来像"合并已经铺好了"。

#### 逐路径的预置解法（机械的，不等现场再想）

1. `.gitignore`：**两块都留**，顺序是先 main 的探针残留块、后本批那枚 `.last-run.json`。
   两侧都是纯追加，没有一行语义重叠 —— 这条不需要判断。
2. 三枚 evidence PNG：**取 main 侧**，然后由主张那张图的那一侧重新生成。
   理由：它们是**产物不是源码**，而 §6.2 规定一要的是"谁主张谁出图、人看过" ——
   保留 main 的那份不会丢任何判据，保留本分支的这份则会把 main 上另一批的现场覆盖掉。
3. 本审计文档：**取本分支侧**。这句是需要证据的，所以量过：main 那份 122 个非空行里
   只有 **9 行**不在本分支当前版本中；其中 **7 行**能在本文件的历史 blob 里逐字找到；
   剩下 **2 行**（`apps/web/dist` 那条 bullet、"缺的成本"那一行的 ⑤）是本人在**未提交态**
   写过、后来又被我自己加注的版本（现版本里同一行后面跟着"⚠️ 同样过期…"与实测结果）。
   ⇒ **122 行里没找到任何别人写的东西**，main 那份是我自己这份在中间时刻的一份快照。
   取本分支侧不丢任何人的内容 —— 但这条结论的保质期同样只到下一次 `merge-tree`。
   ⚠️ **那句"取本分支侧"在 2026-10-04 06:4x 到期并被替换成「并集」**（它自己预告过的那件事真的发生了：
   main 上 `05be4729` 提交进整节 `## 9. 交还一条现场…`，55 条非空行、本分支一份都没有）。
   原文留在原位，因为"当时那次量是对的"与"它管不了下一次的合并"是两件事。读数与新解法见 §8.56。
4. `package.json`：链取**并集**，然后让 `check:gate-wiring` 当裁判（它现在除了"定义必须在链里"，
   还要求链外那道有可验的消费方）—— §8.12 那次靠人肉 grep 核对六枚名字，正是它被写出来的原因。

#### 归属登记（不改写别人的历史）

`f304e713 test(evidence): 刷新助手/象限/触达取证图（自托管批次现量）` 落在本分支上，
**不是这一批的动作**：本批从没提交过 `apps/web/evidence/`。它带来的直接后果是上面那三条 binary 冲突。
我不 rebase 掉它、不改写它（那是别人的动作），只把它的存在与解法写在这里。
🔴 顺带一条给后来者的形状：**同一族取证图被两个会话各自刷新并各自提交**，binary 就不可合并 ——
取证图应当由**跑那套界面的一侧**提交，或者干脆不入库（改由 `landing-results/` 那类被忽略的目录出证）。

---

### 8.23 合并载体第一次真的做出来了（带解法），而"在载体上跑完整 `pnpm check`"这一条今天**不能跑**——原因在链里

§8.22 记下"零冲突过期了"之后，这一条把四条冲突族逐个解掉并落成一笔可复核的合并提交：

```
feat/self-host-merge-main = 38564fe8   parents: d27bccde(main) + 9930edfc(本批)
```

解法与理由逐条写在**那笔合并的提交信息里**（不是只在这里），因为下一个重做它的人需要的是解法本身。
`package.json` 那块不是手改的：`/tmp/g7-union-package-json.mjs` 从两侧 blob + merge-base 算并集，
带三条断言（两侧 scripts 键不缺、两侧链段不缺、两侧各自相对顺序不颠倒），
结果 **135 个脚本键 / 67 段链**（本批 66 段 + main 独有的 `pnpm check:op-log-semantics`）。
📌 01:3x 现量复算是 **136 键 / 68 段**（main 又独有 `check:md-tables`）—— 见 §8.29。
🔴 第一版我自己写坏过一次：那次把冲突块按 main 侧收掉了 —— 症状是"合上了"，实际是**把本批五道门禁静默摘掉**。
并集脚本就是为了不再靠手而存在的。

#### 合并树上的门禁读数（全部现量，载体工作树 `/tmp/heyta-merge-trial`）

| 门禁 | rc | 读数 |
|---|---|---|
| `check:gate-wiring` | **0** | 链 67 段、定义 ~~68~~ **64** 道（🔴 68 是抄错，现量与解法在 §8.25：两枚载体的脚本键/链段集合差集都是空 ⇒ 现实没变，变的是我写的数字）、链外 1 道且消费方可验（runbook 2 处 + Dockerfile 1 处）⇒ §8.19 那条新判据在**别人的 package.json** 上也成立 |
| `check:selfhost-entry-command` | 0 | 合并后的两份词条表仍在扫描集里、R1–R6 逐行过 |
| `check:ui-language` | 0 | **zh 2934 / en 2934** 对等（main 那 16 笔加了 108 个键，与本批的改动自动合上了） |
| `check:script-snapshot` | 0 | 36 个脚本（main 的 `c25960cb` 又补了 5 个，MANIFEST 与磁盘对得上） |
| `check:docs-voice` | 0 | site.* 1020 条，30 项禁词零命中 |
| `check:docs` | **1** | 3 处失效章节引用 |

🔴 最后那行才是 #1 关闭判据的**本体**，所以它必须和 main 单独跑的结果并排量：
`/tmp/heyta-main-docs`（干净 main=d27bccde 检出）跑同一条 `node research/tools/docs-link-check.mjs`
⇒ **同样 3 处、同一批行号**（`calendar-year-time-and-mobile-profile.md:860`、
`countdown-anniversary.md:1091`、`countdown-anniversary.md:1295`）。
⇒ 这笔合并**没有给链添任何新的红**，那 3 处全部在别人的计划文档里。
（顺带：登记里那句"main 红在 5 处"也已经过期 —— main 自己那 16 笔把其中 2 处修掉了。
数字要带载体与日期，否则它一定漂。）

#### 今天**不能**跑完整 `pnpm check` 的原因，写在链自己身上

链的第 47 段是 `pnpm check:ai-e2e`，而它**会 SIGKILL 别的会话的 vite**
（`docs/reference/environment-traps.md` #87，本批早先也记过一次）。现在是 2026-10-04 00:2x，
主检出与另外 8 个 worktree 的会话还在跑（`git worktree list` 数到 14 个检出），
所以"在载体上跑完整链"这一条**不是没做，是现在做就会踩硬约束**（不 SIGKILL 别人的 dev server）。

⇒ 载体上跑完整链的窗口条件写成可判的三条：① 主检出那 5 个重叠文件已被其所有者提交
（这是 #1 原本的门槛）；② `lsof -ti :5173 :5174 :4318 :4319` 全空（没有别人的 vite 在跑）；
③ 负载 ≤12。三条同时成立才跑，跑之前把这三条的读数打出来留证。
🔴 不要用"跳过 `check:ai-e2e` 再跑其余"来绕 —— 那会让"完整链绿"这句话变成假的，
而这条链的裁判价值恰恰在于它是完整的那一条。

#### 载体是** provisional ** 的，这一点必须跟着它

它合的是 `main=d27bccde`，而主检出里那 5 个重叠文件仍是 `M`。
所以 `38564fe8` 的作用是：**解法已被验证过一次**（并集脚本 + 六道门禁 + 与 main 的红集对照），
落地那一刻按 §8.16 的三行重算、再按上面三条窗口条件跑完整链。

---

### 8.24 「打开浏览器就能用」这句话的反向残留：扫了，没有；以及三条窗口条件的现量

#### 对外文案的反向残留扫描（这一批把界面搬进镜像之后，旧说法应当全部消失）

可疑形状（两组正则，扫 `docs/runbooks/self-host.md`、`server/README.md`、
`docs/runbooks/deployment.md`、两份词条表）：
`没有界面 / 不含界面 / 不带 UI / 自己托管的界面 / separately hosted UI / 前端要自己…` 与
`自己(打包|构建|部署)(一遍)?(前端|界面|UI) / 前端也要 / UI 仍要 / 不含前端 / 没有自带界面 / separate(ly)? host`
⇒ **命中 0**。

🔴 0 命中按本批自己的规矩要带阳性对照：同一条命令形状下 `界面` 在
`self-host.md` 命中 **4** 处、`zh-CN.ts` 命中 **83** 处（`server/README.md` 是 0 —— 那份是英文文档，
不是探针瞎）。所以"0"是**扫到了**的 0，不是没扫。
而正面那句在 `self-host.md:146-148`：「然后开浏览器访问 `https://你的域名/app/` —— 界面就打在服务端镜像里，
挂载路径由 `WEB_APP_PATH` 决定（默认 `/app/`，镜像内产物路径 `WEB_APP_DIR` 默认 `/app/web-dist`；
把界面挪到别的挂载点是两个旋钮一起改，改一个是静默无效）」—— 与实现同源（`server/src/web-app.ts`）。

#### 三条窗口条件的现量（2026-10-04 00:2x）

| 条件 | 为什么是它 | 现量 |
|---|---|---|
| ① | 主检出那 5 个重叠文件被其所有者提交（#11 的门槛） | ❌ 五个文件仍是 `M`（`docs/README.md`、`package.json`、两份词条表、`scripts/check-script-snapshot.mjs`） |
| ② | `:5173 :5174 :4318 :4319` 全空（`check:ai-e2e` 会 SIGKILL 别人的 vite，traps #87） | ✅ 当前**一个都没在监听** —— 但这一条只在"起跑那一刻"有意义，跑的过程中任何会话起一个 dev server 就会被踩到 |
| ③ | 负载 ≤12（#12 的验收阈值） | ❌ `load1m 50.48 / load5m 39.02`（16 核）；OrbStack 的 socket 也不存在 ⇒ #12/#14 今天**环境无效**，不是产品失败 |

⇒ 三条里 ①③ 不成立，所以 #11 的完整链与 #12 的全跑**都不该现在起**。
这一张表留在文档里，是为了让下一次不用重新推一遍"现在能不能跑"。

---

### 8.25 载体按 §8.16 重算了一次（main 又前进 1 笔），顺手抓到**我自己写下的两条会过期的绿**

`main` 从 `d27bccde` 前进到 `f6478fad`（一笔 `docs(handoff)`，`git diff --name-only` 对
本批拥有的 10 个路径 ⇒ **空**）。按 §8.16 那三行重算，四条解法逐条照 §8.22 回放：

```
feat/self-host-merge-main = ceab1f78   parents: f6478fad(main) + d4e70ab4(本批)
```

冲突集合**一个都没变**（还是那六条路径），所以 §8.22 那四条预置解法今天仍然够用 ——
这正是写"机械解法等现场"的意义：下一次落地的人不需要重新判断。
`package.json` 仍然由并集脚本产出：**135 个脚本键 / 67 段链**，三条断言全过。
📌 同一对在 01:3x 的现量是 **136 / 68**（§8.29）—— 这两个数字每次重算载体都要重新量，不许引用。

载体上六道纯 fs 门禁现量（`/tmp/heyta-merge-trial`，无 `node_modules`，所以只跑不依赖依赖树的那六道）：
`gate-wiring` 0 ｜ `selfhost-entry-command` 0 ｜ `ui-language` 0（zh 2934 / en 2934）｜
`script-snapshot` 0（36 个脚本）｜ `docs-voice` 0 ｜ `check:docs` **1（3 处）**。

🔴 **"合并没添新红"这次换成了可复跑的比法**：§8.23 是拿散文对照行号，这一趟把两份输出
落成文件再 `diff` —— 干净 main（`f6478fad`）检出与合并载体各跑一条
`node research/tools/docs-link-check.mjs`，**输出只差第 1 行的分母**
（476 → 481 处引用，多的 5 条是本批文档自己的跨文档引用），三处红的**路径、行号、目标章节**逐字相同。
⇒ 这句话现在是**一趟读数**，不是上一次读数的引用。

#### 两条我自己写下的"过期的绿"，都在这趟现量里被否证

1. 🔴 **§8.23 那行"定义 68 道"从来不是读数，是抄错。** 现量 `check:gate-wiring` 在载体上印
   **64 道 / 67 段**。而两枚载体（`38564fe8` 与 `ceab1f78`）的 `package.json` 脚本键集合与
   链段集合经探针逐字比对**都是 `(none)` 差集** ⇒ 现实在两趟之间根本没变，变的只是我写下的数字。
   这条和 §8.22 讲的"过期的绿比过期的红更危险"是同一族，只是更朴素：**把一次没做过的测量写成表格，
   它就会被后来人当成有人做过的**。判据写法上的修正：表里的数字必须能由同一条命令再打一遍。
2. 🔴 **§8.16 那句"`pnpm-lock.yaml` 三边同一个 blob ⇒ 合并树不需要重装依赖"现在不成立了。**
   现量：merge-base `437e7c1a` = 本批 = `674079fe`，而 **main 已是 `d340e576`**（它那 16 笔里动过依赖）。
   合并取 main 那份（本批没碰 lockfile ⇒ 无冲突），所以**落地那一趟必须先 `pnpm install`**，
   不能像 §8.16 那样软链 `node_modules` 直接跑 —— 那句话当时是对的，它是那条"软链可用"前提的**证据**，
   前提过期了证据就变成陷阱。已把这条写进合并提交信息里，跟着载体走。

#### 三条窗口条件的现量（2026-10-04 00:3x，覆盖 §8.24 那张表）

① 五个重叠文件仍是 ` M` ❌ ｜ ② `:5173 :5174 :4318 :4319` 全空 ✅（只在起跑那一刻有意义）｜
③ **`load1m 102.46` / 16 核**（`ps` 现量：三个 python3/node 各占 ~99%、另有 headless android emulator 在跑），
OrbStack 的 `~/.orbstack/run/docker.sock` 不存在 ❌。
⇒ #11 的完整链、#12 的全跑、#14 的真镜像构建**三条都仍是环境无效**，不是产品失败；
没有调低任何阈值，也没有改任何判据。

#### 现场清理（为了让别人的读数不被我污染）

两枚 `/tmp` trial 检出在载体提交并移动分支指针**之后**已 `git worktree remove` ——
`git worktree list` 是 §8.23 用来数"几个会话在跑"的现量命令，我留着它就是在给别人的计数加两个假检出。
载体本体是**分支** `feat/self-host-merge-main`（不是 /tmp、不是 SHA），SHA 只作为这一趟的读数存在。

---

### 8.27 🔴 「停掉对外错话」第一次量到线上：错话不止在元数据里，有一句在**正文**，而且被同一页的命令自己否证

前面所有读数都是"仓库里写的是谁"。这一条量的是**访客实际读到的是谁** —— 方法从一次性脚本
`/tmp/live-copy-probe.mjs` 收进了仓库：`e2e/live-site/live-domain.spec.ts` 新增一条用例
（真浏览器 + `--host-resolver-rules` 钉真 IP，不进 `pnpm check`，发布那一趟跑）。

现量（2026-10-04 00:5x）：

| 量什么 | 读数 |
|---|---|
| `/docs/selfhost/` 里旧句「不是一个命令就完事」 | **4 处** —— meta description / og:description / twitter:description / JSON-LD 各一份。**是同一句话的四份抄件**，不是四处不同的话（把每处上下文打出来才看得清，`grep -c` 数行会把它读成 4 个缺陷） |
| 同一页的新句「把服务起来那条命令不难」 | 0 ⇒ 线上落后于 `faa5e730`（那次改的两条对外词条只发出去了一半） |
| `/docs/` 的 FAQ JSON-LD | 旧句 1 处，但同时含「没有发布任何现成镜像」⇒ 线上是**中间态**，不是某一枚 HEAD |
| 对照（改前改后都在场的「自己运维一套服务」） | `/docs/selfhost/` 4、`/docs/` 6 ⇒ 那两个 0 是**扫到了**的 0 |
| 🔴 `/docs/selfhost/` **正文** | 「服务自己不在启动时动表结构」**在** |

#### 那一句正文才是这一条的真正发现，而它照出的是我自己的判据取错了维度

`site.docs.selfhost.s1i2` 写「…服务自己不在启动时动表结构」，而**同一页 §7 让访客敲的那条入口命令
就带着 `-f docker-compose.migrate-once.yml`** —— 首次开机动表结构的恰恰是一个服务。
这句错话在正文里、访客逐字读得到，比 meta 里那句严重。

🔴 §8.21 那次普查为什么没抓到它？因为我按**字面串**「一条命令」去扫，而它是一句**不同措辞的同一命题**。
⇒ 教训：**扫对外承诺要按命题取，不能按字面串取** —— 同一个错误结论在一份文档里通常有两三种说法，
只有一种会被我的 needle 命中。（同族：§8.21 记下"登记说两句、现量六处"，那是字面串还准的情况；
这一次字面串直接漏了一整句。）

已改（zh + en 同步）：

- `site.docs.selfhost.s1i2`：改成"首次开机由一次性迁移服务把表结构建好，不用你手动跑；
  但 compose 不会重跑一个已退出的服务，改了表结构之后的升级要再点名执行它一次"。
- `site.docs.selfhost.s9p2`：把**两条路各自的时机**写清（`./scripts/deploy.sh` 换容器前跑 /
  `docker compose` 由 `supersync-migrate` 在第一次开机跑），原来那句只描述了前一条。

门禁现量全 rc=0：`@heyta/i18n` build、`check:ui-language`、`check:docs-voice`、
`check:selfhost-entry-command`、`check:server-copy`、`check:legal-copy`、`check:entries`。
⚠️ `check:entries` **一个 HTML 都没改** —— 这两条 key 不进静态 HTML，只进 JS bundle，
所以"改了词条"到"访客看到"之间只剩**重新发一次落地页**这一步，没有第二条路。

#### 为什么不立刻重发（以及这条判据今天为什么是红的）

线上那份 build 的**来源树无法归属**：它同时带台阶 0 的改动与旧的 sum，而那批改动 main 也有，
所以"从我这条分支发一次"**不能保证不回退别人已经发出去的内容**。
⇒ 关闭动作绑在 #11 落地之后：**从合并后的 main 发一次**，然后复跑这条用例取绿。
载体那侧已经量过词条表：`main` 旧句 2 / 新句 0，`feat/self-host-merge-main` 旧句 **0** / 新句 **1**
⇒ 合并本身就会把这句话带干净，缺的只是发布。

新用例的四条腿按这个顺序写（**对照先判**）：
① 页面是 HTML ② 在场对照（章节标题 / 「自己运维一套服务」）③ 元数据旧句 = 0 ④ 新句在位 + 正文旧句 = 0。
今天它停在第 ③ 条，报的就是那句可执行的结论：`/docs/selfhost/ 仍在线上印「不是一个命令就完事」4 处`。

⚠️ 这条用例第一版**把阳性对照写成了"新句在位"**，于是它比真判据先红 —— 红在一个
本来就不该在场的东西上，把"线上还挂着旧句"这个可执行结论盖掉了。
**对照必须取在被验状态之外**（改前改后都在场的那半句），否则它与被验命题同生同死，等于没有对照。

---

### 8.26 G-47 的第三条腿：镜像里唯一那枚**手写版本字面量**是三份抄件，而它没有判据

主体（把 143 条钉住）仍卡在 docker + 低负载窗口，和 #12 同一个窗口。
但读 `server/Dockerfile` 生产阶段时照出来一件**今天就能闭合**的事，所以把它做掉了。

#### 现量

```
server/Dockerfile:252   npm install prisma@5.22.0 --registry=… --ignore-scripts --omit=dev
server/package.json     dependencies["@prisma/client"] = 5.22.0
server/package.json     devDependencies["prisma"]      = 5.22.0
server/image-npm-tree.json  packages: prisma@5.22.0、@prisma/client@5.22.0
```

⇒ 同一个版本号在**四个地方**，其中 `5.22.0` 那个字面量是**整个仓库里唯一手写的包版本**，
而它不在任何 lockfile 里。今天四处一致 —— **一致不是判据，是运气**（AGENTS §8.3：不能失败的检查没有价值）。

#### 为什么这条值得单独有一条判据（机制，不是"顺手对账"）

`prisma` 住在 **devDependencies**，而生产阶段那条常规 `npm install` 带 `--omit=dev`
⇒ 常规那一发**永远装不到 CLI**，镜像里 `npx prisma generate` 用的那个 CLI 版本
**只由 Dockerfile 那枚字面量决定**。于是漂移的形状很具体：

有人 bump `@prisma/client`（或 devDeps 的 `prisma`）而忘了那一行 ⇒
镜像里用 5.22 的引擎生成 client、运行时 import 的是 5.23 的 client，
报错点在**容器里、而且是在生产库上迁移跑过之后**；`pnpm check` 全绿，因为
**链从来不构建镜像**（§8.7 记的就是这条盲区）。Dockerfile 自己那句
`IMPORTANT: prisma version must match @prisma/client in package.json` 说的正是这件事 ——
🔴 **它是一句提醒，不是一条判据**，而提醒挡不住"改了声明没改提醒"。

#### 落地的判据

`research/tools/check-image-install-contract.mjs`（挂成 `check:image-license` 的第三条腿，
**不新增 `check:*` 键** ⇒ `check:gate-wiring` 的读数仍是 63 道 / 66 段，没有制造新的"链外门禁"）：

| 腿 | 比的是 | 红的时候说什么 |
|---|---|---|
| ①↔③ | Dockerfile 字面量 ↔ `dependencies["@prisma/client"]` | 镜像里的 CLI 与运行时 client 不同版本，并给出**该改成哪一枚** |
| ②↔③ | Dockerfile 字面量 ↔ `prisma`（devDeps 或 deps） | 本机会与镜像**各自生成一次** client，"我本地跑过迁移没问题"对容器不成立 |
| 快照↔声明 | `image-npm-tree.json` 里 `prisma` / `@prisma/client` ↔ 上面两处 | 对账脚本此刻正在给**一个没人装过的树**打分 |
| 没有对象 | 生产阶段读不到 `prisma@X` 点名 | 响亮失败（`prisma` 在 devDeps ⇒ 没这行镜像里就没有 CLI）——**不许退化成"没扫到也算过"** |

install 形状仍然**只有一个所有者**：那条腿通过 `image-install-shape.mjs` 从 Dockerfile 读，
不抄第二份清单（§8.8 立下的规矩）。

#### 注入验证（5 臂 + 未变异对照，逐臂读数）

| 臂 | 变异 | rc | 命中的判据消息 |
|---|---|---|---|
| A | Dockerfile `prisma@5.22.0` → `5.23.0` | 1 | 「镜像里的 prisma CLI 与运行时 @prisma/client 不是同一个版本」 |
| B | package.json `@prisma/client` → `5.23.0` | 1 | 同 A（反方向） |
| C | devDeps `prisma` → `5.23.0` | 1 | 「与开发者本机的 prisma CLI 不是同一个版本」 |
| D | 快照里 `prisma` → `5.20.0` | 1 | 「快照里的 prisma=5.20.0 ≠ Dockerfile 钉的 prisma@5.22.0」 |
| E | 那一整条点名换成 `npm install lodash` | 1 | 「生产阶段没有 `npm install prisma@<version>` 这一条了」 |
| 对照 | 三份文件原样拷进临时目录 | **0** | 「三处同源 … 快照 5.22.0 / 5.22.0」 |

夹具带**命中数断言**（`npm install prisma@5.22.0` 必须恰好命中 1 次、快照里 `prisma` 必须恰好 1 条），
改 package.json/快照走解析器而不是猜缩进 —— 抄件会漂的第一现场就是这种"文本形状写死在夹具里"。

#### 🔴 同时改掉 §8.20 步骤 1 的形状（这一条比判据本身更值钱）

步骤 1 原写"装配阶段按快照里的 `name@version` 逐条钉版本"。把今天这条腿读完之后发现它有**自锚**问题：

- 快照的 `inputs` 里有一枚是 **Dockerfile 的 install 形状哈希**；
- 一旦把 143 条 `name@version` 写进那条 `npm install`，**形状哈希就是在哈希快照的内容**；
- 于是 `--check` 从"快照 ↔ 当前声明"退化成"快照 ↔ 快照自己" ⇒ **永远绿**。

⇒ 合同的**来源**必须是那个独立的东西（pnpm 的 lockfile 生产树），快照只是它的投影、
Dockerfile 的实参来自快照。步骤 2 的等式才有两个不同的边可比的；否则新增的那条判据
就是 §8.19 那种"一条永远绿的空判据"。

🟡 顺带一条实测到的**既有守卫**（不是我要加的）：`gen-image-npm-tree.mjs` 读到生产阶段用
`pnpm` 装会**直接 fail** 并写明"那时这条快照与对账应当**撤掉**，不是改成读别的文件"。
也就是说如果最终走"镜像里用 pnpm 按 lockfile 装"，被撤下的是整套快照+覆盖率对账，
而许可证门禁与镜像从此扫**同一棵树** —— 那才是 G-47 真正的终点。
这条守卫把"半吊子迁移"（留着快照又换成 pnpm）当场拦住，值得记下来。

### 8.28 🔴 验收载体自己跑的是**另一句话**：`verify-selfhost-stack.sh` 少一份 override，而它当初"有理由"

本轮（2026-10-04 01:2x）量 G-49 那条门禁的扫描集时顺带读进 `scripts/verify-selfhost-stack.sh`，
发现 §8.11 那一族**还有第三种面目**没被摘掉。

**现场**（改前）：

| 位置 | 实测 |
|---|---|
| `COMPOSE_FILES`（改前 `:101`） | 只有 `docker-compose.yml` + `docker-compose.migrate-once.yml` **两份** |
| 对外文档那条主命令（R5 钉住的） | **三份**，多 `-f docker-compose.build.yml` |
| 脚本里那段自校对 | `[ "$SCRIPT_ENTRY_FILES" = "docker-compose.migrate-once.yml docker-compose.yml "` ] —— 把**当时的形状**写死成期望值 |
| 那段旁边的理由 | 「它和文档 §4 的差集应当恰好是 `docker-compose.build.yml` —— **因为脚本自己 docker build**」 |

**那句理由被 `docker compose config` 否证**（它不需要 daemon，所以这条判断当场就能做）：
两份 / 三份两种解析的**逐路径差集恰好 6 处**，全部在预期内 ——

```
services.supersync.build.{context,dockerfile,args.APK_MIRROR,args.NPM_REGISTRY,args.VCS_REF}   null → 有值
services.supersync.environment.MIGRATE_RECOVERY_BUILD_LOCAL                                     null → "true"
```

服务清单（`caddy postgres supersync supersync-migrate`）、应用与迁移容器的 `image:`
（两边都 `supersync:selfhost-verify`）、`RUN_MIGRATIONS_ON_STARTUP` 的解析值**一项没变**。
⇒ 带上前那份 override **不会**触发重建（compose 没有 `--build` 就不看 `build:` 段），
也不会换 tag ⇒「脚本自己打镜像」这个省掉它的理由收益是 **0**。

**代价藏在一个环境变量里**：`docker-compose.build.yml:34` 给应用容器注
`MIGRATE_RECOVERY_BUILD_LOCAL=true`，而它是 `server/scripts/migrate-deploy.sh:239`
那个分支的**唯一开关** —— 决定 CONCURRENTLY 迁移失败后打印给运维的那条带外恢复命令里
有没有 `-f docker-compose.build.yml`（全仓只有这一个消费者；`server/tests/migration-sql.spec.ts:452`
只是文本断言）。外人照文档拿到的是**带 build.yml 的那一支**，验收跑的是**另一支** ⇒
"三容器 healthy + 界面可用"对那一支**不构成任何证据**。这与 §8.11 是同族（"把自己要验的
默认值换掉了"），只是这次换掉的不是镜像 tag 而是**恢复路径**。

**为什么以前没人发现**：这段判断原先只有脚本自己那一份，而它把期望值写死成当时的形状 ——
**那不是判据，是快照**：载体再漂一次只要漂成同一个值它就跟着认账，而 R1–R6 的扫描集里
根本没有这个脚本。所以修法分两层：

1. 载体改成带**同一套三份**文件（`scripts/verify-selfhost-stack.sh:110`），并**删掉**那段
   把形状写死的自校对 —— 现在它只**打印**实测集合，打印不判定；
2. 判定搬进门禁的单一所有者：`check-selfhost-entry-command.mjs` 新增 **R7**，读那个数组、
   **期望值从 R5 算出的那条对外主命令导出**（不在这里抄第二份字面量），并带三条非空哨兵
   （数组读不到 / 一个 `.yml` 都没有 / 没有期望值可用 ⇒ 都判红，不许"读不到就算过"）。

**R7 第一次跑就报出真实那个洞**（不是注入）：

```
scripts/verify-selfhost-stack.sh:101  [R7]
  验收脚本带的 compose 文件集合是「…migrate-once.yml …yml」，而外人照抄的那条主命令是
  「…build.yml …migrate-once.yml …yml」—— 两者必须是同一套文件。
```

**变异验证**（在 `/tmp/r7-shadow` 影子根里做：门禁脚本用副本、其余文件软链到真树，
真树那个文件全程没被写过 —— size+mtime 与起跑前相同）。**5/5 臂符合预期**：

| 臂 | 变异 | 结果 |
|---|---|---|
| E 阳性对照 | 当前形状 | exit **0**，R7 红数 0 |
| A | 摘掉 build.yml（回到出事那个形状） | exit 1，红数 1，定位语命中 |
| B | `COMPOSE_FILES` 改名（探针该瞎） | exit 1，红数 1，报「读不到 COMPOSE_FILES 数组」 |
| C | 空数组 | exit 1，红数 1，报「一个 .yml 都没有」 |
| D | 文件名 typo | exit 1，红数 **2**（存在性 + 集合不等） |

⚠️ 第一趟 E 臂**假红**过一次，而且红得很有迷惑性：影子根只软链了我"想起来要链"的三份
compose 文件，漏了内部验收手册用的 `docker-compose.test.yml` ⇒ R2 判它不存在 ⇒ 对照先死。
**夹具没铺全会伪装成"判据自己有洞"**，而这条判据本身恰恰是判"文件在不在"的。
修法是把 `server/` 下**每一个** `.yml` 目录化列出来链上（`readdirSync(...).filter(.yml)`），
不是去改断言。

**顺手加的腿四**：脚本现在当场读应用容器里的 `MIGRATE_RECOVERY_BUILD_LOCAL`，不是 `true` 就
`die`（读法与既有的 `RUN_MIGRATIONS_ON_STARTUP` 那条同形，"读不到"打成显式字面值而不是空串，
否则探针够不着会被报成产品缺陷）。D-3 那一节的读数行同步印出这一条。

**这一条还差什么**（别把上面这些读成"已经验过"）：

- 腿四目前只有**静态**（R7）+ **解析层**（`config` 的 6 处差集）两份证据；它自己的**真读数**
  要等任务 #2 那次全跑（`pnpm verify:selfhost-stack`）。本轮仍跑不了：01:2x 现量
  `load 98.38 / 52.74 / 59.77`（阈值 12），OrbStack daemon 这次**已经起了**
  （`/var/run/docker.sock → ~/.orbstack/run/docker.sock`，`docker version` = 29.4.0）——
  环境无效不是产品失败，按判据等窗口，没调低阈值。
- 载体与对外那句话**仍然有两处刻意不同**，写清楚免得被读成"一模一样"：
  ① 不加 `--build`（镜像由脚本自己 `docker build`，为的是传 `VCS_REF=<完整 SHA>`，
  而 build.yml 里是 `${SUPERSYNC_BUILD_SHA:-local}` ⇒ 换成 `compose build` 会把这枚标签改成 `local`，
  所以这一处**不该**为了对齐而改）；② `SUPERSYNC_IMAGE` 钉成私有 tag `supersync:selfhost-verify`
  （不复用 `supersync:local`，那是别人机器上可能存在的镜像）。
  这两条是夹具性质，不构成"验的不是那句话"——真正会让绿色不迁移的是文件集合，而那一条现在被 R7 钉住了。

### 8.29 载体那三行今天**机械重算不出来**了，而我先踩了一遍才回查出 §8.22 —— 于是把那两处过期读数原地划掉

01:3x 按 §8.16 那三行去重算载体（本批又多了 `02b05433` 那笔），现量：

```
main = 2c0ac370（自 merge-base 前进 60 笔）  branch = 02b05433（本批 42 笔）  mb = 437e7c1a
git merge-tree --write-tree main feat/…            → rc=1（两个方向都是）
```

**冲突路径集合与 §8.22 那一次逐条相同，一条不多一条不少**：`.gitignore`、三枚
`apps/web/evidence/**.png`（binary）、`docs/research/self-host-distribution-audit.md`（add/add）、
`package.json`。⇒ §8.22 那四条**预置解法今天仍然逐条可用**，且第 3 条那条证据我重新量了一遍、
**数字一模一样**（main 那份 122 个非空行里只有 9 行不在本分支当前版本中）。
这条重复读数有意义的地方在于：§8.22 自己写了"这条结论的保质期只到下一次 `merge-tree`"——
这是它的**第二趟**，两趟间隔约 1 小时 20 分、main 中间前进 1 笔。

**并集那一处必须重量**（不许引用）：

| 量 | §8.23 当时 | 01:3x 现量 |
|---|---|---|
| base / main / branch 各自链段 | — | 61 / 63 / 66 |
| 并集链段 | 67 | **68**（main 独有 2 段：`check:op-log-semantics`、**新增的** `check:md-tables`） |
| 并集 scripts 键 | 135 | **136**（main 独有 7 键：那 2 段 + 5 条 `verify:*`；本批独有 7 键：5 段 + `check:web-artifact:app` + `verify:selfhost-stack`） |
| 两侧相对 base 是否只增不减 | 未记 | **0 / 0**（⇒ 并集不会静默摘掉任何一侧的门禁；这条是并集脚本三条断言的前提，现在有了现量） |

`pnpm-lock.yaml` 仍 `main d340e576 ≠ branch/base 674079fe` ⇒ §8.25 那条"落地必须 `pnpm install`"今天仍然成立。

🔴 **本轮真正要记的是我自己的那个动作**：我是**先按 §8.16 的字面去跑**（那句"零冲突 ⇒ 三行机械重算"
在文档里当时仍以未划线的形式活着），撞到 rc=1 才回查发现 §8.22 早就把它否证了。
一份 1700 行的证据文档里，"某条结论已被后来的现量否证"如果只存在于后面某一节的叙述里，
那么下一个读它的人（就是我）会照**前面那节**行动。所以这一步不是补记，是**就地修句**：
§8.16 那张表里 `merge-tree 双向 rc=0` 与 `lockfile 三边同 blob` 两行已经原地划线并指向本节，
旁边留了"引用它之前必须先跑一次 `merge-tree`"。

**落地仍未开始，前置条件三条都没满足**（01:3x 现量）：主检出那 5 个重叠文件里还有 **3 个是 ` M`**
（`docs/README.md`、`packages/i18n/src/locales/{zh-CN,en}.ts`）；端口 3000 / 4318 / 4319 有进程在听；
`load 98.38 / 52.74 / 59.77`（阈值 12）。载体分支 `feat/self-host-merge-main` 还指在 `ceab1f78`
（两个父都旧了）—— 它现在**不是**"重算一遍就行"的状态：重算要走 §8.22 那四条解法 + 并集脚本，
而并集脚本的输入要等那两个 i18n 文件被它们的所有者提交后才固定。所以这个分支留着当形状参考，
不当现量引用。

### 8.30 G-47 的**决定依据**第一次有现量：名字层零缺失，版本层 15 条在漂（含一条跨 major）

登记里那句"镜像 npm 树 ≠ 门禁扫的树，差 16/143"（§8.8 时代）一直是一个**混合数**：
名字差与版本差被算进同一个数里，所以它既不能回答"许可证门禁漏没漏东西"，
也不能回答"把树钉住会改掉几个包"。今天用 `pnpm-lock.yaml` 单独把两件事分开量
（探针 `/tmp/g47-tree.mjs`：解析 v9 的 `importers` + `snapshots`，从 `server` 这个 importer
按生产依赖 BFS，`link:` 的工作区包继续展开；**不联网、不装、不起 docker**）。

现量（本分支 `95732679`，lockfile `674079fe`）：

| 量 | 读数 |
|---|---|
| lockfile 生产树 | **156** 个 `name@version`（走过的 snapshot 节点 156，其中 15 条带 optional 标记） |
| 镜像快照 | **143** 个 |
| **只在 lock 树的名字** | **12** 个：11 枚 `@node-rs/argon2-*` 平台变体 + `fsevents` ⇒ 是快照按 `targetPlatform: linux/x64/musl` **过滤掉**的可选平台包，不是"镜像少装了" |
| **只在快照的名字** | **0** 个 ⇒ 许可证门禁按名扫的覆盖面**没有洞**：镜像里没有任何 lock 里不存在的东西 |
| 同名不同版本 | **15** 条，且**全部是快照比 lock 新**：1 条 patch（`@fastify/static 10.1.4→10.1.5`）、13 条 minor（`ws 8.21.3→8.22.0`、`pino 10.3.1→10.4.0`、10 枚 `@peculiar/asn1-* 2.9.5→2.10.0`）、**1 条跨 major**（`real-require 0.2.0 → 1.0.0`） |
| 解析不到的依赖引用 | 0（探针自身收敛干净） |

⚠️ 这个读数费了两趟坏探针，两趟的症状都长得像"发现"：
第一版只读 `packages:` 段 —— 而 **v9 的依赖边在 `snapshots:`**，`packages:` 只有 `resolution:`。
BFS 停在 18 个直接依赖上，输出"两边差 127 条"。第二版读了 snapshots，但叶子节点写成
`zod@4.6.5: {}`（**同一行内联空映射**），而我的键提取要求整行以 `:` 结尾 ⇒ 79 条"解析不到"、
树只有 77 个。两趟都是靠结尾那条 `lockSet.size < 100 ⇒ 先怀疑解析器` 的自检抓出来的 ——
**差集很大不是结论，是探针没走到位**（§7 元规则"先怀疑探针"的第五种面目）。

### 由此 G-47 的两个形状第一次可比（这才是本轮的交付）

| | A. 镜像里改用 pnpm 按 lockfile 装 | B. 继续 `npm install`，把 143 条版本钉进 Dockerfile |
|---|---|---|
| 对许可证门禁 | **整套快照 + 覆盖率对账失去对象**（`gen-image-npm-tree.mjs` 里那条 fail-loud 守卫写的正是"那时应当撤掉，不是改成读别的文件"）；此后门禁与镜像扫**同一棵树** | 快照机制留着，但**合同的来源必须是这棵 lockfile 树**，否则 `--check` 退化成"快照 ↔ 快照自己"（§8.26 已记） |
| 今天会不会改变产物 | 会（平台过滤由 pnpm 的 `os/cpu/libc` 决定，需实测） | **会，且是 14 个包从较新版本退回 lock pin 的那一版**（含 `real-require` 跨 major 反向）⇒ 不是 no-op，是一次决定 |
| 构建侧代价 | Dockerfile 要把 workspace + `pnpm-lock.yaml` 带进生产阶段（现在是 `npm pack` 三枚本地包 + tarball），`pnpm deploy --prod` 需要完整工作区 | 只改那一条 `npm install` 的实参形状 |
| 现在能不能验证 | **不能**：两条都要一次真镜像构建才有"装上了什么"的读数，而 `load 98.38` | 同上 |

⇒ 本轮**不落代码**（不落构建可验证的改动 = 造半实现）。关闭判据收敛成一句可复核的话：
**A 与 B 的取舍需要一次真镜像构建来定"会不会改变产物"，在此之前 G-47 停在"依据齐了、未拍板"**；
量它的探针已经落进仓库：`node research/tools/image-tree-vs-pnpm-lock.mjs`
（纯读文件、不联网、不装、不起 docker；**刻意没挂进 `pnpm check`** —— 在 A/B 拍板之前把它做成门禁，
就是替一个还没定的答案预置判据。文件头写了这条理由）。
⚠️ 探针本身两趟是坏的，两次症状都长得像"发现"，记录在上面第二节 —— 那两趟比这份读数更值得读。

### 8.31 本批**已经落进 main**（02:09 由并行会话合的），所以载体这件事被**脚本化**了 —— 四条守卫全是被真实症状逼出来的

**先记落地这件事本身（全部现量，命令可重跑）：**

- `git merge-base main feat/self-host-distribution` = `b850b1c6` ⇒ **整条分支是 main 的祖先**，
  本批没有任何一笔还留在外面。带它进来的是两笔 merge：`9a61a88a`（01:43，第二父 `95732679`）
  与 `7bac538b`（02:09，第二父 `b850b1c6`，标题就叫"自托管批次尾笔"）。
- 卡了本批一整轮的那 5 个重叠文件，是**它们的所有者**提交的：`package.json` +
  `scripts/check-script-snapshot.mjs` 在 `102d064f`（00:46），`docs/README.md` + 中英两份词条表在
  `5d0b27b9`（01:53）。后果是机械的：这两份词条表与那个脚本从此**自动合并**、不进冲突集，
  而合并后的词条表仍让 `check:selfhost-entry-command` 命中 9 条入口命令 ⇒ G-49 那两份站内抄件
  没有被并掉。
- main tip 的**干净检出**（detached worktree，不是主检出那棵混合树）实测：
  `check:gate-wiring`、`check:selfhost-entry-command`、`check:script-snapshot`、`check:docs`、
  `check:md-tables` 五道**全 exit 0**；`pnpm check` 链 74 段，本批那五道
  （`gate-wiring` / `selfhost-entry-command` / `web-artifact` / `image-license` / `server-env`）
  逐条查过**都在链里**。

⇒ §8.16 的"载体三行"与 §8.22 的"四族解法"从此**没有对象**。Goal 的 item #1 只剩最后一句：
在合并态上跑**完整** `pnpm check` —— 它撞的是环境（负载 + 别人正在跑的套件），不是解法。
本文文末有现量。

**载体为什么改成脚本（`research/tools/selfhost-merge-carrier.mjs`）**

这一轮实测 main 前进的节奏：`a6c43f1f`→`5d0b27b9`→`6afca90f`→`59f0ab45`→`bcfee6fb`→`258813a8`→
`ce6c1c98`→`7bac538b`→`47c7b17d`，**六笔之内 1–3 分钟一笔**。手算的载体在写完那一秒就过期 ——
本轮两次都是解完全部冲突、跑完五道门禁，在**即将落笔的前一回合**被"main 又前进了"顶回来。
第二次的守卫是我自己写的（提交前先比 `main`），它退 4 不提交，是对的；但一次也不该再来。

**四条守卫，每条都对应一个真实症状，不是设计时想出来的**

| # | 守卫 | 逼出它的症状 |
|---|---|---|
| ① | `MERGE_HEAD` 必须存在且**等于来源 SHA** | 门禁红着报"本批五道门禁不在链里"，读起来像"合并把别人的门禁摘了"。真相是**合并根本没起来**，那棵树基本等于 main。这种红比不红更贵 —— 它把归因指向错误的层 |
| ② | 断言要落在**要提交的那个对象**上（写盘后回读再验一次并集） | 内存里算出的 68 段并集四条断言全过，磁盘上的 `package.json` 却是 main 的 63 段 |
| ③ | 失败必须把**已量到的读数**一起打出来 | `die()` 只打了门禁的输出，而"冲突 0 条"这条决定性读数留在 notes 里没人看见，于是排查只能靠猜 |
| ④ | 双亲比较要 `rev-parse HEAD^1 HEAD^2` 取**完整 SHA** | `log --format=%p` 在这一仓打的是**缩写**（实测 `parents=ce6c1c98 b850b1c6`），拿 40 位去比必然不等 ⇒ 断言把**合法**的载体判死，而且是在落笔**之后**才报，留下一笔没人指向的载体对象 |

**一条被否证的断言粒度**：审计文档那族（取本分支侧、不许丢别人内容）第一版按**行**判，
在 `main=59f0ab45` 上判红两行 —— 一行讲 `apps/web/dist` 无人引用，一行是"缺的成本"那个表格行。
两句都确实是我自己的话，但 **git 历史里从来没有过它们的 blob**：并行会话（GDPR 那笔 `6e447033`）
把我**未提交的中间态**整文件带进了 main，我随后又改写了一版 ⇒ 旧措辞在任何 ref 的任何 blob 里都不存在。
所以行粒度挡不住它想挡的东西，只会把"我自己改过措辞"误报成"别人有内容"。
改成**节粒度**：main 那份的每个小节标题（`^#{2,6} `）与每个 `§8.NN` 编号都必须能在本分支那份里找到，
缺任何一个才红 —— 而"别人的内容"在这个文件里的真实形状就是一整节。行级孤儿数量照打印，只是不作门禁。

**两处读数错误，划在这里而不是删掉**

1. 本轮一度写"`.gitignore` 213 行 = base 193 + main 8 + 本批 13"。那个等式**左右不相加**。
   真相：214 个 `split('\n')` 段（含末尾空段）= `wc -l` 的 213 行（文件以换行结尾）。
   **手抄的数字连单位都会错**，脚本自己拼进提交说明的才不会。
2. 我报过"`server/scripts/gen-image-npm-tree.mjs` 在 main 上缺"。那是按印象拼路径去 `stat` 的结果；
   `git ls-tree -r` 现量它一直在 `research/tools/`，main 与分支**都有**。
   判"某个文件不在"只认 `ls-tree`，不认我脑子里的目录布局。

**还欠的三项（都是环境/构建约束，不是没做）**

- item #2 `pnpm verify:selfhost-stack` 现量：docker daemon 起着（`29.4.0`），
  负载 02:1x 现量 `47.40`（阈值 12；同一轮里从 `416.21` → `151.69` → `47.40` 在跌）。
  脚本自带负载门，等满会以 exit 3 收 —— 那记**环境无效 ≠ 产品失败**，不改判据。
- item #4 G-47 的 A/B：要一次**真镜像构建**才知道"会不会改变产物"，依据与决策表在 §8.30。
- item #8 `pnpm reinstall:all`：前置条件"**落地之后**"在 02:09 **已满足**，
  但四端重装要占模拟器/打包机与一轮干净负载窗口；本批改过 `apps/web`，所以它必须在落地后跑，
  现在跑只是把窗口让给别人。

**脚本的四条守卫都过了变异（02:1x 现量，临时 ref + 一次性工作树，不碰真分支）**

| 臂 | 造出来的状态 | 读数 |
|---|---|---|
| ① 合并没真开始 | 在载体工作树里留一枚**未跟踪**的同名文件（`research/tools/tmp-carrier-rig.txt`），merge 被 `would be overwritten by merge … Aborting` 拒 | **exit 2**，打 git 的原文 + "MERGE_HEAD=(不存在)，应当是 …"，**不落笔** |
| 四族之外的冲突 | 临时源在 `docs/plans/multi-end-coverage-handoff.md` 的 EOF 追加一行，与 main 同期追加相撞 | **exit 2** 点名 `冲突 1 条：docs/plans/multi-end-coverage-handoff.md` 与 `分族：pkg=0 gi=0 png=0 audit=0 other=1` |
| ③ 失败要打已量到的读数 | 上面两臂的 stderr 里都带着 `main=… · merge-base=… · MERGE_HEAD=… · 分族=…` | 归因不再靠猜（臂① 没有这条时会退成"门禁红"，就是本轮踩到的假归因） |
| ④ 双亲比较 | **修法前**的真实症状就是本轮那次：`log --format=%p` 打的是缩写，合法的 `85b48831` 被判死并留下一笔没人指向的对象；**改成 `rev-parse HEAD^1/^2` 后**，同一套比较在正对照臂上取到两个完整 SHA | 这一臂不需要人造变异——它已经**真误报过一次** |

正对照臂（未变异的脚本 + 一个只加新文件的临时源）退的是 **3**，而红点在 `check:docs` ——
这一条要单独记，因为它**不是脚本的问题，也不是本批的问题**：

- 🔴 main 现在自己红在 `check:docs` **1 处**：`docs/plans/multi-end-coverage-handoff.md:317`
  指向 Goal 台账（`docs/plans/goal-multi-end-coverage.md`）里一个**还不存在的章节号**
  `7.30`（门禁打印的现有章节串里最接近的是 `7.29`，另有 `12`/`49`/`51`/`57` 这些不带 7. 前缀的号）。
  写它的是 `47c7b17d`（02:11，标题就叫"记账落点改回 Goal 台账"那一笔）。
  干净检出（detached worktree @ 47c7b17d）复跑 `check:docs` = **exit 1**，同一处；
  ✅ **03:0x 现量更正，原句留着不删**（它错在"这句话有保质期"，删掉就没人知道保质期这回事）：
  main=`de537bd4` 的干净检出复跑 `check:docs` = **exit 0**。那一处已被它的所有者关掉
  （Goal 台账里那个章节号现在真的存在了）。所以**"main 自己红在 `check:docs`"这句话今天已经不是事实** ——
  无论"5 处"还是"1 处"都不是。复现：`git -C <干净检出> checkout --detach $(git rev-parse main)`
  然后 `node research/tools/docs-link-check.mjs`。
  本批文件在这次报错的输出里**命中 0 条**。
- ⇒ 这正是 item #1 关闭判据要的那种读数，而且它换了内容：本轮开头记的是
  "main 红在 check:docs 5 处"，那 5 处已被它们的所有者关掉（02:1x 干净检出实测 exit 0），
  四分钟后 `47c7b17d` 又新写了 1 处。**"main 自己红几处"是一个每次落地前都要重量的量**，
  不是可以引用的事实。这条红**不由本批吸收**，也**不由我代改**（那是别人 5 分钟前刚落的账）。
- 📌 记一条我自己在这节里踩到的：上面那处红我**抄进来过一次** —— 写成
  「一个 `.md` 文件名 + 空格 + 章节号」放在同一对反引号里的形状，
  `check:docs` 当场把本文判红（本文 433 处引用里多了一处死的）。
  **引用不等于转述免责**：门禁按"引用方"计数，把不存在的章节号写进抄件，抄件自己就成了引用方。
  改写办法是把号与文件名分开写（`…里一个还不存在的章节号 7.30`），本文现在 exit 0。

### 8.32 冲突族今天**不构成冲突**了（因为 main 已把整批吸进去），而"停掉对外错话"这轮量到的一条在**产物字节**里

02:4x–03:00 这一轮。三件事，都有现量命令。

#### ① 载体重算：四条冲突族退化成零冲突，脚本的守卫一条没摘

```bash
git merge-base main feat/self-host-distribution          # b850b1c6 = 本批 01:45 那笔
git diff --name-only b850b1c6 feat/self-host-distribution | wc -l   # 3
git merge-tree --write-tree --name-only main feat/self-host-distribution   # 只有一行 tree OID
```

`merge-tree` 那一趟**没有冲突段** ⇒ 上一条记的四族（`package.json` 并集、`.gitignore` 三方、
evidence png 取 main、本文取本分支）今天全部不触发。原因不是"解法变好了"，是
**main 已经把整批合进去了**（并行会话那笔），所以两侧现在只在"我比 merge-base 多的那 3 个文件"
上 differ。🔴 这不等于守卫可以删：main 每两三分钟前进一笔，任何一笔都可能重新撞上那四族里的某一族
（尤其 `package.json` 的 `check` 链），守卫留着是廉价的，摘掉是拿下一轮去赌。

载体读数（`node research/tools/selfhost-merge-carrier.mjs`，本轮跑了两趟）：

| 趟 | 载体 | 第一父（main 当时） | 第二父（分支当时） | 五道纯 fs 门禁 |
|---|---|---|---|---|
| 01:5x | `b1839411` | `67149961` | `8fd34087` | 全 exit 0 |
| 02:5x | `5399ceef` | `248a663a` | `f56a2a9a` | 全 exit 0 |

链段数在载体上是 **74**，本批那 7 道（`check:gate-wiring` / `check:selfhost-entry-command` /
`check:script-snapshot` / `check:web-artifact` / `check:server-copy` / `check:server-design` /
`check:md-tables`）逐条在链里 —— 判据是"链里含这道"，由 `node -e` 现拆现数，不抄上文的数字。

⚠️ **我又踩了一遍猜路径**，而且这次是两处：判"main 里缺 `docker-compose.build.yml`"、
"缺 `apps/web/src/lib/mount-path.ts`"。`git ls-tree -r --name-only main` 的现量是
`server/docker-compose.build.yml`（在），而挂载路径那件事在 main 侧的判据文件是
`apps/web/tests/app-mount.spec.tsx`（我记的那个源码文件名根本不是一个文件）。
上一条已经为同一件事写过一次（探针脚本的真实路径在 `research/tools/` 下）。
规则再落一遍，因为它两次都值：**判"文件在不在"只认 `ls-tree`，不认我脑子里的路径形状**。

#### ② 这轮真正的对外错话在**产物字节**里，不在文档里

线上 `live-site` 两条红的根因不是判据坏。抓线上产物看（不是看源码）：

```bash
curl -s --noproxy '*' --resolve heyta.waytofuture.cn:443:124.223.13.226 \
  https://heyta.waytofuture.cn/assets/main-D9TgKitZ.js | grep -o 'if(i===Il)return n'
```

命中的是 `function ch(n,i){if(i===Il)return n; …}` —— 也就是 `withLocale` 里
"默认语言直接返回原地址"那一支**还在生产里**。它的后果是用户侧的一句话：
英文浏览器（`devices['Desktop Chrome']` 的 `en-US` 就是这种情况）读**中文**落地页、
点「立即使用」，落到的应用是**英文界面**。前提被 `0aa6cb0e` 撤掉了：应用的解析链多了
系统语言那一层（显式存储 > `?lang=` > 系统语言），"没有偏好"不再等于"默认语言"。

修法与判据各一笔：

- `8fd34087`：两种语言都带 `?lang=`；`DEFAULT_LOCALE` 在该文件里没有消费者了，import 一并摘掉。
  带参数不覆盖用户已选语言（解析链里显式存储排在前面，推断值不算显式存储 —— 读过
  `apps/web/src/lib/locale.ts` 那三条注释才敢这么写）。`pnpm --filter @heyta/landing test`
  现量 **22 files / 1312 passed**（第一次被宿主内存闸门挡了 5 轮，排队第 6 轮放行）。
- `f56a2a9a`：线上用例跟上设计，**没有放松**（中文那条从断"`/app`"改成断"`/app?lang=zh-CN`"，
  且**故意不改浏览器语言**，所以它现在量的是"`?lang=` 压过系统语言"这件事本身；
  PWA 那条自己开 `locale: 'zh-CN'` 的上下文，因为它走的是"直接打开 `/app/`"，那里没有落地页可继承）。
- 变异两臂（`withLocale` 直通 / 摘掉 `?signin`）+ 未变异复绿对照：**没跑成**。臂 A 排队 23 轮
  （约 12 分钟）宿主内存闸门一直被别人的 vitest 分片占着，02:5x 主动终止（我没有用
  `TFA_ALLOW_CONCURRENT_TEST` 绕，也没有直接调 `node_modules/.bin/vitest` 绕过劫持），
  终止后脚本自己打了两条 `RESTORE_VERIFIED=ok`，`git status --porcelain` 该文件为空 ——
  🔴 **这条不是"验过"**：`?lang=` 这件事目前只有 `8fd34087` 那笔里改过的 1312 条断言在守，
  以及线上产物字节 + `live-site` 那条 href 断言（红→绿要等重发之后复跑）。
  两臂留到窗口开的时候补，读数进 §8.33。

数数为什么要分意图（这条是判据设计上的，不是文案上的）：改成"按 pathname 认"之后
`render.spec` 那条从 2 变成 **4** —— 同一个 pathname 上住着两个意图
（「立即使用」2 条 + 「登录」宽屏操作位与窄屏菜单各 1 条）。按整串相等数会把
"真的多出了入口"读成"一条都没有"，按 pathname 数会把"两个意图"读成"入口翻倍"。
分开数（各自 =2）才是这件事的形状。

#### ③ 新的一条：发布**必须**从载体，不能从分支

`git diff --name-only b850b1c6 main -- apps/landing packages/i18n packages/design-system` 现量 **13 个文件**
（`docs.ts`、`helpFigures.ts`、`trash-coverage-copy.spec.ts`、两语词条表、6 份 token 产物）。
也就是说：**用分支的工作树重打落地页并把 rsync 上去，会把这 13 个文件在主线上的改动盖掉**
—— 而线上表现是"文案/配色悄悄回到旧版，命令退出码 0"。所以这一轮发布走
`/tmp/heyta-land-publish` 检出载体 `5399ceef` 那条路，且发布前必过产物判据。

#### ④ `research/tools/verify-landing-dist.mjs`（新）：产物自洽判据，六臂读数

四条判据：四张必需入口页都在 / `index.html` 引用的每个本地资源都在磁盘上（且该集合**非空**才算走到判据）/
预期域名全树 ≥1 且旧域名 =0 / **现行那句钉在 `docs/selfhost/index.html` 这一页上**，作废句全树与该页都 =0。

| 臂 | 动作 | 结果 |
|---|---|---|
| 干净 | 拿现有真实产物跑 | **exit 0**：95 个文件、79 个 .html/.js、预期域名 577 处、旧域名 0、作废句 0、该页现行句 4 |
| 1 | 摘掉 `index.html` 引用的 `/assets/main-D9TgKitZ.js` | 红：引用了 1 个不存在的本地资源 |
| 2 | 抹掉**那一页**里的现行句（4 处） | 🔴 **第一版活了**（见下），改成文件级后红 |
| 3 | 往英文页塞旧域名 | 红：残留旧域名 1 处 |
| 4 | 缺 `en/index.html` | 红：缺入口页 1 张 |
| 5 | 往中文页塞作废句 | 红 2 条（全树 + 该页同时报） |
| 6 | 把预期域名换成不存在的 | 红：正向对照该红 |
| 还原 | 四臂复原后再跑 | exit 0 |

臂 2 是第一版**没有牙**的证据：那版把"现行句"做成**全树计数 ≥1**，抹掉那一页的 4 处之后
同一句话在别处还剩 3 处 ⇒ 照绿。全树计数挡得住"整篇没了"，挡不住"这一篇被换回旧文案"；
只有把判据钉在**它所属的那个文件**上才有牙。这是 §7 那条"断言只会验界面写了什么、不会验少了什么"
在文案层第二次现量，只不过这次是**我自己写的判据**，而且是靠先做一次变异才发现的。

#### ⑤ #7 那条前置条件今天的现量：那五个重叠文件**还是没被其所有者提交**

工单里 #7 的第一步写的是"等主检出那 5 个重叠文件被其所有者提交"。03:1x 逐个现量
（命令：`git -C <主检出> status --porcelain -- <那五个路径>`，行数取 `diff --numstat`）：

| 文件 | 现在 | 未提交的量 |
|---|---|---|
| `docs/README.md` | 未提交 | +1 / −1 |
| `package.json` | 未提交 | +4 / −2 |
| `packages/i18n/src/locales/zh-CN.ts` | 未提交 | +31 / −0 |
| `packages/i18n/src/locales/en.ts` | 未提交 | +27 / −0 |
| `scripts/check-script-snapshot.mjs` | 未提交 | +1 / −0 |

主检出未提交条目合计 **101** 条（不止这五个）。三件事要说清：

1. **"载体不含这些 hunk"不是 bug** —— 载体只能合已提交的东西。它们落下之后 main 前进、
   `package.json` 那一族**很可能重新撞**（这次带 +4/−2 的链改动），而守卫已经在脚本里，
   重算是一条命令：`node research/tools/selfhost-merge-carrier.mjs`。
2. 🔴 **不动主检出、不代改**：这五个文件没有一个属于本批（本批的 i18n 改动早已随批次一进 main）。
   它们的作者正在写，我去碰就是抢别人的在制品。
3. 所以 #7 剩下的两步是**两种不同的卡法**，都不是"我没做"、也都不是"做完了"：
   载体跑完整 `pnpm check` 卡在负载 + 别人的 dev server（`check:ai-e2e` 的前置会 SIGKILL 它们，
   硬约束不许）；main 前进到载体卡在"只有它的所有者能推进 main"（`git branch -f main` 与
   动主检出都被明令禁止，而 main 已被主检出占用、第二个 worktree 签不出同一分支）。
   ⇒ 记成**待窗口 + 待所有者**，两条各有一条可复核的现量命令。

### 8.33 目标口径"外人一条 compose 起全套"的第一道关，实测**根本进不去第二条**：镜像死在 `load metadata`

这一节记的不是"本机网络差"，是**产品侧缺一个旋钮**。判据是 §1 的那句话：
外人要能一条命令起全套、打开浏览器就能用。

#### ① 事故与现量（`verify:selfhost-stack` 第一趟 rc=1）

链日志 `/tmp/selfhost-stack.log` 的末尾三条是**可复核的**：

```
docker=29.4.0 / OrbStack
⚠️ 测试锁仍被占（89173）；verify:selfhost-stack 自带负载门，让它自己判
verify:selfhost-stack rc=1
❌ 镜像构建失败（完整日志 /tmp/heyta-selfhost-image.log）
```

`/tmp/heyta-selfhost-image.log:8` 的原文（逐字抄，不要手改）：

```
#2 ERROR: failed to authorize: DeadlineExceeded: failed to fetch anonymous token:
Get "https://auth.docker.io/token?scope=repository%3Alibrary%2Fnode%3Apull&service=registry.docker.io":
dial tcp [2a03:2880:f126:83:face:b00c:0:25de]:443: i/o timeout
```

🔴 这条错误**没有"哪一层错了"的线索**：buildkit 是在执行第一条 Dockerfile 指令**之前**
去要匿名 token 的，所以任何写进 Dockerfile 的诊断、任何 `RUN` 层的失败点都还没轮到出现。
"界面在说谎"那一类在构建层的对应物是：**错误在说谎它属于哪一步**。

2026-10-04 现量（`docker images` + `curl -m 8 -o /dev/null -w '%{http_code}' https://<host>/`）：

| 事实 | 读数 |
|---|---|
| 本地 `node:*` 镜像 | **0 枚**（所以没有"缓存兜住"这回事） |
| `registry-1.docker.io` / `auth.docker.io` | `000`（连不上，不是慢） |
| `docker.m.daocloud.io` / `docker.1ms.run` | `302`（根路径的重定向，说明**可达**） |
| 那个 IP | `2a03:2880:f126:83:face:b00c:0:25de` —— fake-ip 池的指纹（本机 DNS 走代理） |

⚠️ 归因纪律（§7 第 84 条那条元规则的又一次现量）：**本机 fake-ip 是环境，旋钮缺失是产品**。
区分它们的是这一句 —— 大陆上一台**正常**的机器同样拉不动 `auth.docker.io`，
而它没有任何 fake-ip。所以这条不能记成"我这台机器的网络问题"。
仓库此刻的立场是"**不发布任何镜像**"（§8.30），那么"自己构建"就是**唯一**对外承诺的路径，
它在第一步就断，等于对外那句"一条 compose 起全套"是错话。

#### ② 修法：`NODE_IMAGE`（与 `APK_MIRROR` / `NPM_REGISTRY` 同族，第三个旋钮）

| 落点 | 内容 |
|---|---|
| `server/Dockerfile` | **三个 stage 各声明一次** `ARG NODE_IMAGE=node:24-alpine`（`ARG` 不跨 `FROM` 继承）；文件头有上面那段错误原文 |
| `server/docker-compose.build.yml` | `args:` 加 `NODE_IMAGE: ${NODE_IMAGE:-node:24-alpine}` ⇒ `.env` 里那一行真的会变成 `--build-arg` |
| `scripts/verify-selfhost-stack.sh` | 构建那条命令加 `${NODE_IMAGE:+--build-arg NODE_IMAGE=$NODE_IMAGE}` —— **不加这一行，验收脚本自己就用不了这个旋钮**（先漏了它，是这一节里我自己那处"改了配置没反应"的现量） |
| `docs/runbooks/self-host.md` | §3 补第三行旋钮 + 三种失败形态的区别（`apk add`/`pnpm install` 是**无声挂住**，base 是**响亮但无线索**）；§4 那句"`APK_MIRROR` / `NPM_REGISTRY` 两个旋钮"→ 三个（同一句结论落在两份文档里，改一处必 sweep 全仓） |
| `server/README.md`（英文那份） | 同一段的英文版，含"compose 那份 args **总是**把值传下去，所以生效的是 compose 的默认值" |

默认值逐字等于 `node:24-alpine` ⇒ 能直连 Docker Hub 的机器**一点行为都没变**。
仓库里不写死任何地域性源，理由与 `APK_MIRROR` 同一条。

#### ③ 新门禁 `check:image-build-args`（五条判据，七臂变异全对）

这个旋钮的形状是**"必须声明三次 + 第四份抄件在另一个文件"**，
而跨文件等式是**唯一能看见它的地方** —— 单看任何一个文件都永远自洽。
`research/tools/check-image-build-args.mjs`：

| 号 | 钉住什么 | 漏了会怎样 |
|---|---|---|
| R1 | 同名 ARG 的每份声明默认值逐字相同 | 三个 stage 用三个源 |
| R2 | 每个 `FROM ${NAME}` 之前**同一段内**有 `ARG NAME=` | 那一段退回 Docker Hub，最后一层才死 |
| R3 | compose `args:` 每一项 Dockerfile 都声明过 | 死旋钮（传了没人收，build 不报错） |
| R4 | Dockerfile 每个 ARG compose 都传**且默认值相同**（例外要写理由） | 文档承诺的 `.env` 行根本没接线 / compose 静默覆盖 Dockerfile 的默认值 |
| R5 | 每段 `FROM` 都必须是 `FROM ${NODE_IMAGE} AS <别名>` | 整族旋钮被撤掉时 R1–R4 **一条都不响**（跨文件等式的共同盲区） |

`DEFAULT_MAY_DIFFER` 只有一条 `VCS_REF`（compose `local` vs Dockerfile `unknown`），
并写明**为什么这不是漂移** —— 加一条的成本是刻意的，否则 R4 就不是判据。

七臂变异读数（一次性副本，`--root` 注入，不动工作树；`node /tmp/ciba-arms.cjs`）：

| 臂 | rc | 命中的规则 |
|---|---|---|
| control（未变异） | **0** | （不红） |
| 第三处默认值漂成 `node:22-alpine` | 1 | R1 |
| 删掉 production 段的 `ARG NODE_IMAGE` | 1 | R2 |
| compose 里加一个 Dockerfile 没声明的 `BOGUS_KNOB` | 1 | R3 |
| compose 的默认值改成 `node:20-alpine` | 1 | R4 |
| 一段 `FROM` 改回字面量 | 1 | R5 |
| **整族撤掉**（三处全回字面量 + compose 条目删掉） | 1 | R5 |

最后一臂是这一节真正的产出：它证明前五臂之外的那条"两边一起改回原样"被 R5 挡住了。
干净树读数（`node research/tools/check-image-build-args.mjs`）：

```
✅ 镜像构建参数：3 段全部 `FROM ${NODE_IMAGE} AS …`（R5）｜同名 ARG 默认值逐字一致
（R1，NODE_IMAGE×3、APK_MIRROR×2、NPM_REGISTRY×3、VCS_REF×1）｜…compose 传的 4 项 Dockerfile 全认（R3）
｜Dockerfile 的 4 个 ARG compose 全传且默认值相同（R4，例外 1 条已写明理由）
```

它挂在 `check:image-license` 之后（`pnpm check` 链多一段）；
`check:gate-wiring` / `check:docs` / `check:script-snapshot` / `check:selfhost-entry-command`
四条在这批改动后**仍 exit 0**（现量命令就是这四条）。

#### ④ 顺带被现量照出来的一条：live-site 的 PWA 用例撞上了隐私同意闸门

`verify:selfhost-stack` 那趟失败之后接着跑的线上验收（`/tmp/live-rerun.log`）里，
7 条 `live-domain` 用例 6 绿 1 红，红的是 PWA 那条，抛的是：

```
PrivacyConsentBlockedError: privacy-consent-not-granted: 用户尚未同意隐私规则，
拒绝发起任何请求（https://heyta.waytofuture.cn/app/manifest.webmanifest）
```

**这不是站点坏了，也不是用例写错了地址**：隐私那条线（G-12 / G-27）把
`window.fetch`、实时通道、以及 **`serviceWorker.register()` 本身**三件事一起搬到了
"同意之后"（`apps/web/src/features/privacy/startup-network.ts` 那张表的最后一行）。
所以在一个全新的浏览器上下文里，未同意时 `navigator.serviceWorker.ready`
**永远不 resolve** —— 没人注册过它。这条比"抛错"更坏，因为它会被读成"SW 坏了"。

用例现在先点真界面上的「同意」（与 `live-signin-entry.spec.ts:106` 同一个动作），
再跑那段探测。**判据一条没减**，只是把它原本没走到的用户动作补上了。
⚠️ 复跑读数**还没取**（负载 13.5 > 12 的测量闸门 + 测试锁被占），所以这一条现在
只是"已按产品行为改法，待现量"，不是"已验过"。
🔴 顺带一条要交给那条线的事：这条用例在 2026-09-30 是**没有这一步也能绿**的，
同意闸门落进来时**没有任何一层通知它** —— 线上验收与产品新语义之间缺一条对账
（与 §7 里"改不变量要按谁引用了输入来枚举"同族）。

#### ⑤ 没闭合的，编号登记

| 号 | 事项 | 前置 |
|---|---|---|
| **#2（本目标第 2 项）** | `pnpm verify:selfhost-stack` 全跑现量仍缺。旋钮已接进脚本，下一趟要带 `NODE_IMAGE=<自己拉得到的源>/library/node:24-alpine` | 无测试锁 + load ≤12 的窗口；等满以 rc=3 记"环境无效≠产品失败" |
| **G-50** | 站内「自建一套同步服务器」那篇文章（外人从落地页点进来的**那一份**）里，`镜像/国内/拉取/registry` **一个词都没有**（`grep` 现量 0 命中）—— 也就是它把上面这个第一关**完全没提**。要补需要动 `packages/i18n` 中英两份 + `apps/landing/src/site/docs.ts` 的 key 清单 + 重跑 `gen:entries` 与 `check:entries` | 那两份词条表**此刻仍在主检出未提交**（就是 #7 那 5 个重叠文件之二）⇒ 现在动它等于给落地加冲突面。登记，不沉默 |

### 8.34 载体脚本自己那条"写完回读"的断言，第一次运行就抓到**它自己的洞**：并集算出来了，从没写回

本轮往 `check` 链里加了 `check:image-build-args`（§8.33 ③），重算载体时脚本 **exit 5**：

```
· MERGE_HEAD=f6b44ff6 已确认 · 冲突 1 条：package.json
· package.json 并集 scripts 键 143 个 · check 链段 main=74 本批=67 base=66 并集=75（摘段 0/0）
❌ package.json 并集写回后回读**不含**完整并集：缺链段 1（check:image-build-args）· 缺键 0（）
   —— 磁盘 segs=74，应当=75
```

#### 真相不是"并集算错"，是**算对了没写**

`package.json` 那一族的逐键复制循环里有一句 `if (… || k === 'check') continue;` ——
`check` 被跳过是**对的**（它由链并集单独处理），但"单独处理"原先只处理到**内存**：
`result` 从未赋回 `outPkg.scripts.check`，于是写盘的永远是 main 那份链。
四条断言（键不缺 / 段不缺 / 顺序不颠倒 / 不摘 base 段）当时**全部成立**，产出却是错的。

🔴 为什么这个洞活了这么多轮才第一次响：main 早先把整批都吸进去了（§8.32），
所以 `tChain ⊆ oChain` ⇒ `result` 恒等于 `oChain`，不写回也不丢任何东西。
**本批第一次往链里加一段 main 还没有的新门禁**，它才第一次真的少一段。
这是"判据从没被它需要的输入触发过"的形状 —— 与 §7 #165 那一族同形：
一条断言的强度不由"它跑过多少次"回答，只由"有没有一种输入能让它红"回答。
这次是**我自己加的输入**把它照出来的，而那正是它该有的第一次用途。

修法（`research/tools/selfhost-merge-carrier.mjs`）：

1. `outPkg.scripts.check = result` 序列化后真的写回去；
2. 序列化**不凭**"`pnpm ` 开头"这个印象 —— 先用两侧的**原文**建映射（`seg()` 只是切掉 `^pnpm `，
   链里任何一段不带这个前缀都会改写命令本身），取不到才退回加前缀；
3. 加一条 round-trip 断言：重建串再 `seg()` 回去必须**逐段等于** `result`，不一致 exit 5。
   ①②③ 合起来才是"我算的那条链就是磁盘上那条链"。

#### 修完的载体（现量，且**独立复核**过，不采信脚本自己的报告）

| 项 | 读数 |
|---|---|
| 载体 | `c229bab6` = main `f61c23af` × `feat/self-host-distribution` `f6b44ff6`（`feat/self-host-merge-main` 已指过去） |
| 冲突 | 1 条：`package.json`（分族 pkg=1 gi=0 png=0 audit=0 **other=0** ⇒ 没出现预置四族之外的路径） |
| 链段 | main=74 本批=67 base=66 **并集=75**，摘段 0/0 |
| 纯 fs 门禁 | 5 道全 exit 0：`check:gate-wiring` / `check:selfhost-entry-command` / `check:script-snapshot` / `check:docs` / `check:md-tables` |

独立复核的那三条（`git show <ref>:package.json` 直接读三个 blob，不经过载体脚本）：

```
c229bab6                       链段= 75 含 image-build-args=true 定义在场=true
main                           链段= 74 含 image-build-args=false 定义在场=false
feat/self-host-distribution    链段= 67 含 image-build-args=true 定义在场=true
```

⚠️ **载体又是活的**：`main` 本轮从 `62576fa3` 走到 `f61c23af`（不到一小时两笔）。
所以"完整 `pnpm check` 跑在哪一枚载体上"这件事**只能在跑的那一刻现取** ——
这正是 §8.31 把它脚本化的理由：测量链的第 3 步在起跑**之前**再跑一次
`node research/tools/selfhost-merge-carrier.mjs`，而不是拿今天这个 `c229bab6` 去交差。

### 8.35 同意闸门之后还剩什么：`apps/web` 唯一的 SW 注册口、那句"可安装"的适用面，以及等待器自己的一处 sh 语法错

§8.33 ④ 记下 PWA 那条线上用例被闸门挡住之后，这一节把那件事**量到底**，因为它顺带照出
一句对外话的适用面。全部是读源码 + `grep` 的现量，没有一趟真浏览器读数，所以下面每条都写明"未验证"在哪。

| 取到的事实 | 出处 |
|---|---|
| `networkAllowed()` 的真值只有一种：`decision === 'accepted'`（`local-only` 与"未决定"都算否） | `packages/app-host/src/privacy-consent.ts:176-178` |
| `serviceWorker.register()` 这一步**在闸门之后**，而且是刻意搬过去的（三步收进一个端口注入的闭包，判据数"同意前被调了几次，必须是 0"） | `apps/web/src/features/privacy/startup-network.ts` 文件头那张表 + `apps/web/src/main.tsx:63-64` |
| `apps/web` 里**只有一个** SW 注册口，注册的是**小组件**那枚（`public/sw.js` 的头部注释指向 `packages/widget-core/dist`；全文件 `caches` 相关 API **0 处**） | `apps/web/src/pwa/register.ts:46` · `grep -c "caches\." apps/web/public/sw.js` = **0** |

🔴 **由此能下的结论只有一条**：这句「离线照常可用 / 可离线用」（`landing.hero.floatOffline`、
`landing.facts.offline.value`、`site.platforms.web.body`）讲的是**数据在本地**，
不是"离线重开页面"——因为仓库里**根本没有做应用外壳缓存的那一枚 SW**，
这句话与同意闸门**没有因果关系**（闸门动的是小组件 SW，它从来不是离线加载的载体）。
这条是"没有反证"而不是"证实为真"，但它排掉了一个我一开始的怀疑方向。

🟡 **下不了的结论，编号登记成 G-51**：`site.platforms.web.body` 那句
「完整产品，不是演示。**可安装**、可离线用，数据就存在你的浏览器里」里的"可安装"，
在两个分支上**没有取证**：① 未决定（同意面板还挂着）；② 选了「只用本机」。
这两档下小组件 SW 不注册，而 Chromium 什么时候肯给安装入口，判据是**厂商的**、
会随版本变 ——我没有在这一趟里用真浏览器量过，所以既不能写"照样能装"，也不能写"装不了"。
归属：这句话的字面归文案那条线，行为归隐私那条线（G-12 / G-27）。
**关闭动作**：在一趟真浏览器里各跑三档（未决定 / 只用本机 / 已同意），
量 `beforeinstallprompt` 与地址栏那个安装入口，把结论写成"哪一档能装"，
再决定那句话要不要带条件。**不做的事**：不在这轮替它拍板，也不为了过闸门去改 `networkAllowed`
——那是安全判据，按硬约束不许为测试降级。

🔴 **2026-10-04 05:5x：这一单已判定，见 §8.50**（补丁已备好，卡在两份词条表仍被并行会话占着）。
🔴 **06:5x 更新：正面读数已证"本机无人值守通道拿不到"，补丁改成 v2（摘掉安装承诺），见 §8.57。**
上面那句"既不能写'照样能装'，也不能写'装不了'"当时是对的，因为它问的是**厂商判据的充分侧**；
本轮用的只是**必要条件那一侧**（未同意档一次都不注册 SW ⇒ 那一档下"可安装"不成立），
所以"不成立"这个结论与当时的谨慎不冲突，而正面证据（已同意档 `beforeinstallprompt` 到底发不发）**仍然欠着**。
🟢 **06:1x：这一发的配方已在 §8.53** —— 监听必须装在导航之前、只观测事件不 `prompt()` 这两个坑都预解了，
欠的只剩窗口与载体（不是"不知道该怎么测"）。

🔴 **顺带抓到我自己那条等待器脚本的一处语法错，而且它已经"跑起来"过**（与 §7 的"探针自己坏了"同族）。
重排 G-47 的等待器时发现 `/tmp/queue-g47-real-tree.sh:20` 写的是
`[ -n "$busy" ] && { …; exit 3; fi` —— `fi` 是多余的，`sh -n` 当场报
`syntax error near unexpected token 'fi'`。
**但它前面已经打印过 17 轮"还在跑"**：POSIX shell 是**一条命令一条命令**边解析边执行的，
所以前 19 行能正常跑，脚本会在**等完窗口之后那一刻**才死 —— 也就是最需要它干活的那一步。
⇒ 自己写的等待器/跑批外壳，落地后要立刻 `sh -n` 一遍（这次是先跑起来了才后查），
并且凡是"循环 + 循环后的判定"这种形状，要**把循环上限临时调成 1 跑一趟**，
好让循环后那几行被执行到 —— 不然一条只有等完才会走到的分支可以永远不被语法检查覆盖。

### 8.36 §8.33 那句"第一道关进不去"是**环境瞬时读数**；这一轮顺带量出 G-52 与 G-47 的一条新证据

03:41 复跑 `pnpm verify:selfhost-stack` 前先低负载复量（`vm.loadavg` = 11.58，阈值 12；
`docker info` 返回 29.4.0 ⇒ 两个环境前置都成立），然后：

```
$ docker pull node:24-alpine
Digest: sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
Status: Downloaded newer image for node:24-alpine      rc=0
```

🔴 **这把 §8.33 的"第一道关实测根本进不去第二条"从"仓库属性"降级成了"那一刻的读数"** ——
和 §8.31 那句"这句话有保质期"是同一个形状：那句话当时是真的（本地一枚 `node:*` 缓存都没有、
`registry-1.docker.io` 直连 000），但它没有标注保质期，所以后来者会照它排"必须先有 mirror 才能验证"。
**现在的正确表述**：`NODE_IMAGE` 这个旋钮解决的是"**接不上时有没有出口**"，
它不保证"接得上"，而"接得上"这一档**每次验证前要现量**，不能引用上一次的红。
（`docs/runbooks/self-host.md:111` 那句括号里同样写着"当时的现量"，措辞已经是带保质期的，不用改。）

这一轮**顺带**量出两件事，都不是我原本要量的：

**① 登记 G-52：对外那句"连不上 Docker Hub 也能走通"只覆盖了三枚镜像里的一枚。**
`server/README.md:103-104` 印的是 —— "The build override is also where `APK_MIRROR`,
`NPM_REGISTRY` and `NODE_IMAGE` live, so it is the file that makes this path work on a machine
that cannot reach Alpine's CDN, npm's registry, **or Docker Hub**."
把这条**命题**（而不是字面串）拿去对账，现量是：

| `image:` 出现处 | 值 | 有旋钮吗 |
|---|---|---|
| `server/docker-compose.yml:36`（以及 `build.yml:37`、`migrate-once.yml:57`） | `${SUPERSYNC_IMAGE:-supersync:local}` | ✅ |
| `server/docker-compose.yml:170` | `postgres:16-alpine` | 🔴 无 |
| `server/docker-compose.yml:273` | `caddy:2.11-alpine` | 🔴 无 |
| `server/docker-compose.monitoring.yml:22` | `amir20/dozzle:latest` | 🔴 无 |
| `server/docker-compose.monitoring.yml:38` | `louislam/uptime-kuma:1` | 🔴 无 |

🔴 **而 §4 那条主命令起的恰好是 `caddy / postgres / supersync` 三个**（`docs/runbooks/self-host.md`
自己写的）。所以一台连不上 `docker.io` 的主机按文档走完：构建阶段被三个旋钮救活，
**`up` 那一刻仍然要往 Docker Hub 拉两枚**，而这两枚没有任何出口。
这句话是**本批自己写下去的**（`NODE_IMAGE` 那一笔），所以它属于"停掉对外错话"的范围，
不是上游遗留。

为什么 R1–R5 全看不见：那五条都在比 `server/Dockerfile` 的 ARG 与 compose 的 `build.args`，
**运行期 pull 的 `image:` 不在任何一条的枚举集合里**。这是 §8.21 那条"按命题取，不能按字面串取"
的同一件事的第三次命中 —— 上次漏了正文里换一种措辞的同一命题，这次漏的是**同一命题的另一半时间轴**
（构建期扫了、运行期没扫）。

已经落了判据本体（**先让它红在真缺陷上，再修东西**，不是先修再补判据）：
`research/tools/check-image-build-args.mjs` 加 **R6** —— 枚举 `server/docker-compose*.yml`
里每一枚 `image:`，不是 `${VAR:-默认}` 形状的必须在 `IMAGE_HARDCODED` 里逐条写明"为什么它不挡路"
（和 `DEFAULT_MAY_DIFFER` 同一个成本设计）。它**第一次跑就对当前树报 4 条红**、rc=1，
红的位置逐行是上面那张表的后四行 —— 这是最强的"能失败"证据：被测对象是真的，不是注入的假样本。
探针还自带两条 R0：compose 文件数为 0 或 `image:` 数为 0 都算红（遍历断掉的形状，见 §7 同族）。
🔴 R6 要求的是 `${NAME:-默认}` **整串**，不是"以 `${` 开头"：只写 `${NAME}` 的半旋钮在变量没设时
会把 `image:` 解析成空串，compose 报 `invalid reference format` —— 那比硬编码更难归因，
因为它看起来像已经接好了。

**G-52 这一单已做掉的部分**（同轮，03:5x）：

| 动作 | 落点 | 读数 |
|---|---|---|
| 四枚运行期镜像接旋钮 | `docker-compose.yml`（`POSTGRES_IMAGE` / `CADDY_IMAGE`）、`docker-compose.monitoring.yml`（`DOZZLE_IMAGE` / `UPTIME_KUMA_IMAGE`） | R6 从 4 红转绿：`5 份 compose 的 7 枚 image: 全部旋钮驱动（接了旋钮 7 / 刻意硬编码 0）` |
| 旋钮**真的接线**（不是只在 YAML 里像） | `docker compose -f docker-compose.yml config` 各渲染一次 | 不带变量 ⇒ `postgres:16-alpine` / `caddy:2.11-alpine` / `supersync:local`；带变量 ⇒ 三枚全部换成 `mirror.example.com/…`。**默认逐字节不变**是靠这条命令证的，不是靠看 YAML |
| 那句超出的对外话 | `server/README.md` §"一条 compose 起全套" | 改成"三个旋钮管**构建**"＋另起一段列 `POSTGRES_IMAGE`/`CADDY_IMAGE` 并写明它们住在**默认**那份文件里；原文那句"makes this path work on a machine that cannot reach … Docker Hub"不再原样存在 |
| 中文 runbook 同一命题 | `docs/runbooks/self-host.md` §3 末 + §4 括号 | §3 加两个旋钮与"构建期/运行期"的分法；§4 那句"三个旋钮在这条路上也生效"补了"只覆盖构建，运行期那两枚在默认那份文件里" |
| 可发现性（外人唯一会去抄的那张表） | `server/env.example` 末尾 | 加五个旋钮的分组注释（build time / run time）；⚠️ 这里**不许**写入口命令，否则它就成了第 5 份抄件 —— 该文件在 `check:selfhost-entry-command` 的扫描集里，现量仍是 0 条 |

🔴 **R6 的变异对照里，第一条臂是假的，纠正后才有四条**（这一条与 §7"红的是探针不是实现"同族）：
最初的 D 臂是"`--root` 指一棵只有 `Dockerfile`、没有 compose 的树"，我以为它在测 R0，
`rc=1` 也确实是 1 —— 但 `cat` 那个日志看到的是 **`ENOENT: … docker-compose.build.yml` 的 node 栈**，
R0 一句都没跑。红是真的，红的**原因**不是我想证的那个。补了两行 `existsSync` 前置检查后：
D1（缺 compose 文件）rc=1 且输出里 `Error:`/`ENOENT` 各 **0** 次、点名到具体文件；
D2（真树但把 `image:` 行全删空）rc=1 报 R0「一个 image: 都没读到」。
⇒ 变异臂的验收不能只看退出码，要读它**红在哪一句**（这一轮我自己差点把一条堆栈登记成判据证据）。
其余三条臂：A 半旋钮 `${POSTGRES_IMAGE}`（无 `:-默认`）rc=1 点名那一行；B 改回硬编码 rc=1 点名 `caddy`；
C 允许表分支（今天恒空 ⇒ **从未被执行过的那一支**）临时把 `IMAGE_HARDCODED` 填一条后 rc=0
且把那行理由打印出来。对照：未变异的真树 rc=0。

**R6 的适用面**（别读多）：它只管 `server/docker-compose*.yml`，也就是**外人那条 compose 路**。
Helm 那条不在里面：`postgresql` 的镜像本来就走 `.Values.postgresql.image.repository`，
但 `server/helm/supersync/templates/tests/test-connection.yaml:13` 的 `busybox:1.36` 是写死的 ——
它只在 `helm test` 时拉，不在部署路径上，所以本批没为它加旋钮，登记在这里而不是假装 R6 覆盖了它。

载体与 #7 的过期读数一并现量（03:41，`git log -1` 口径）：

| 对象 | 读数 |
|---|---|
| `main` | `391e4c27`（03:41 现量） |
| 载体 `feat/self-host-merge-main` | `564fcab8`，第一父 `f61c23af` ⇒ **已过期**，落地前按 §8.16 重算 |
| `merge-base(main, 本分支)` | `b850b1c6` |
| `merge-base --is-ancestor main 本分支` | **NO** ⇒ 仍不是 FF |
| #7 那 5 枚重叠文件 | `docs/README.md` / `package.json` / `packages/i18n/src/locales/zh-CN.ts` / `…/en.ts` / `scripts/check-script-snapshot.mjs` **03:41 现量五枚全部仍是 `M`** ⇒ 前置仍未满足 |

⚠️ 最后一行的路径要写全：`packages/i18n/src/locales/{zh-CN,en}.ts`（不是 `packages/i18n/src/*.ts`）。
我这一轮先按后者探了一次，得到"这两枚干净了"的**假读数** —— 打错路径的 `git status -- <path>`
返回空，而空看起来就是"没人动"。判"某个文件被别人提交了没有"要用**它真实存在的路径**，
并顺手确认这个路径 `git ls-files` 认得。

### 8.37 `verify:selfhost-stack` 全跑第一次跑到**最后一腿**：五步里四步有读数，第五步被另一条会话的测试锁挡下

03:41:48 起跑，负载 11.58（阈值内）、`docker info` 可用，`EXIT=1`。逐步读数（日志
`/tmp/heyta-selfhost-stack-034148.log`，脚本自己把每步的判据都印在行首）：

| 步 | 读数 | 算不算这一单的证据 |
|---|---|---|
| 打镜像 | `镜像 OK`（tag `supersync:selfhost-verify`，`VCS_REF=73861eaf`） | ✅ §8.33 那道"进不去第二条"的关，这次过了 |
| 起栈 | `服务图对账：默认 3 个（未动） · 带 override 4 个（+supersync-migrate）` | ✅ "一条 compose 起全套"的服务图成立 |
| 入口命令抄件 | `扫描集 7 份 + 故意排除 1 份，命中 9 条，R1–R6 逐行过，R7 把验收载体钉在同一套文件上` | ✅ |
| 迁移与挂载 | `一次性容器 exited(0) · RUN_MIGRATIONS_ON_STARTUP=false · 已应用 42/42 · 悬挂 0` ＋ 服务端日志 `2026-10-03T19:49:12.468Z [INFO] [web-app] 共享 UI 挂在 /app/（来自 /app/web-dist）` | ✅ 这一行是**真容器里打出来的**，不是本地 vite |
| 真浏览器三条判据 | 🔴 `内存闸门拒绝启动：已有测试在跑（pid=92498，锁 /tmp/tfa-test.lock；它是 pnpm --dir e2e run test）` | ❌ 未跑 ⇒ 这一单**没闭合** |

🔴 这一条**不许**记成"环境无效所以算过"。前四步是这次拿到的，第五步（打开浏览器就能用的直接证据）
仍然缺。`TFA_ALLOW_CONCURRENT_TEST=1` 是那条闸门的逃生门，**不用** —— 它存在的理由就是并发
e2e 会把整机推到内存不足（03:42 起另一条会话连续起了两轮 `--dir e2e run test`，
03:56 现量负载 14.49 已越过 12）。复跑条件写死：**锁空 + 负载 ≤12**，两个都要现量。

截图四张（`e2e/selfhost-stack-results/s{1,2,3}-*.png`）的路径是脚本在**拒绝启动之后**仍然打印的，
所以那一趟**不存在**这四张图 —— 别看路径存在就当看过。现量（`ls -la` 对 `stat -f %Sm` 的日志起跑时间）：
四张 png 与 `.last-run.json` 全是 **Oct 3 14:32**（上一批留下的），目录 mtime 也是 14:32，
而这一趟 03:41:48 起跑、03:49:16 写下最后一行 —— **早于起跑 13 小时**。
🔴 这是"探针没接上"和"东西是干净的"在输出上长得一样的又一例，而且它比空目录更危险：
目录里**有**四张名字完全对得上的图，任何后来人 `ls` 一次就会把它们当成这次的界面证据。
⇒ 这一单复跑时，判据不能是"目录里有这四张图"，得是"这四张图的 mtime 晚于本次起跑时刻"。

🔴 **这条判据已经写进脚本本体**（`scripts/verify-selfhost-stack.sh`，同轮）：用例起跑前先取
`BROWSER_T0`，跑完后逐张比 mtime，打印每张的 `mtime/bytes/是不是本次的` 与 `FRESH=n/4`；
**`RC=0` 而 `FRESH<4` ⇒ 直接 `die`**（"退出码 0 + 截图是旧的"只有一种解释：用例没走到截图那一步）。
两臂现量：负向 = 真目录（四张 06:32Z 的旧图）⇒ `FRESH=0/4`、rc=1；
正向 = 一次性目录里刚写四张 ⇒ `FRESH=4/4`、rc=0。
⚠️ 落地这条判据时踩到自己一处语法错：`log "… $(date -r "$X" '…') …"` 在 **bash 3.2** 下报
`syntax error near unexpected token ')'`（双引号里套双引号的命令替换）—— 改成先算进
`BROWSER_T0_HUMAN` 再插值。`bash -n` 是这条判据的开机自检，第一次跑它的时候它就是红的。


### 8.38 G-47 第一次拿到**真镜像里那棵树**：一处版本在漂，一处是许可证盲区的新形状（登记 G-53）

上面那趟跑完留下了 `supersync:selfhost-verify`，所以 §8.30 那句"只能量预测树 vs lock 树"的
限制可以解除了。现量（`docker run --rm --entrypoint node … -e` 走 `/app/node_modules`，
遍历计数 `scannedEntries=160` ⇒ 遍历没断；解析出 `name@version` **145** 枚）：

| 对比（镜像 145 vs 快照 143，`generatedAt=2026-10-03T07:58:46Z`） | 条数 | 内容 |
|---|---|---|
| 只在镜像里、快照没有 | 4 | `@heyta/sync-core@1.0.0`、`@heyta/shared-schema@1.0.0`、`@heyta/domain@0.0.0`（我们自己的三枚，快照按设计不列）＋ 🔴 `@node-rs/argon2-linux-arm64-musl@2.2.1` |
| 只在快照里、镜像没有 | 2 | `@node-rs/argon2-linux-x64-gnu@2.2.1`、`@node-rs/argon2-linux-x64-musl@2.2.1` |
| 同名不同版本 | **1** | `@fastify/websocket`：快照 `11.3.1` / 镜像 **`11.3.3`**（22 小时之间被 npm 重解了一次） |

这两行读数各自的价值不一样，分开说：

**① 版本漂移这一条第一次有了"同一对象两个时刻"的实证。**
§8.30 的 15 条是"预测树 vs lock 树"推出来的，而这一条是**真装进镜像**的字节与快照之差：
`@fastify/websocket` 在我们写下快照之后发了 `11.3.3`，而 `^` 范围让它**自动进了发布镜像**。
⇒ G-47 剩下的那个决定不是"要不要钉"，而是"钉的成本由谁付"，见下面 ③。

**② 🔴 arm64 那枚二进制包暴露了一个比"版本漂"更宽的盲区（登记 G-53）。**
本机是 arm64，`docker build` 不带 `--platform` 打出来的是 **arm64** 镜像，
所以里面躺的是 `argon2-linux-arm64-musl`；而 `gen-image-npm-tree.mjs` 的 `TARGET` 写死
`{os:linux, cpu:x64, libc:musl}`。两边的差不是"谁错了"，是**问的问题不同**：
快照回答"我们打算发布的 amd64 镜像里有什么"，镜像回答"这台机器上刚打出来的那个架构里有什么"。

于是盲区的真实形状是：**按平台切分的二进制包（`*-<os>-<arch>-<libc>`）这一整类，
许可证门禁一枚都没扫过** —— 它扫的是本机 pnpm store，本机那棵树里躺的是 darwin 变体。
x64 那两枚（`-linux-x64-musl` / `-linux-x64-gnu`）在快照里但**不在**门禁的扫描集里；
arm64 那枚连快照都不在。⚠️ 快照里的 `-linux-x64-gnu` 镜像永远不会有（基础镜像是 Alpine=musl），
说明快照本身也不是"镜像的树"，是"registry 对某个平台的解析结果" —— 这句话要写进它的文件头。

G-53 的关闭动作（不做半截）：① ~~先拍"我们承诺发哪几个架构"（现在 `VCS_REF` 那套只出 amd64、
本地构建却是 arm64，两条并存本身就是对外没说清的事）~~ ② ~~把 `TARGET` 从一枚改成**集合**
（至少 `linux/{x64,arm64}/musl`），快照与 `check:image-license-coverage` 一起按那个集合判~~；
③ 许可证扫描集要能吃下"镜像里有而开发机树上没有"的包（现在它是拿 store 目录当唯一来源）。

🔴 **2026-10-04 05:4x：这一单已关，但走的是与这三条都不同的第 4 条路（读数在 §8.48）。**
`②`/`③` 当时都把注意力放在"快照要按哪些平台解"上，而提交物锁（§8.47）让这件事变成不需要选：
判定直接读锁里的**全部**平台受限条目（14 枚，按 `os`/`cpu`/`engines.libc` 三字段取，
不按包名后缀 —— 后缀那一版会漏掉 `fsevents` 这种"字段有架构、名字没有"的形状），
逐条过同一套许可证权威。于是 `①` 也**不再挡路**：判全部 ⇒ 任何"承诺发哪几枚架构"的子集都被覆盖；
架构承诺这件事仍然没拍，但它退回成"发布哪几枚镜像"的运维决定，不再是许可证层的前置。

🔴 **顺着这条又量出一句没被验证过的断言，并已就地改掉**（同轮）：
`.github/workflows/heyta-server-image.yml` 里 `platforms:` 上面那段注释原本写着"平台：与
`server/Dockerfile` 现有实测范围一致（**本机 amd64/arm64 单架构**）"。三个现量把它否证了：

| 量的是什么 | 读数 |
|---|---|
| 发布 workflow 钉的平台 | `platforms: linux/amd64` |
| 被 `verify:selfhost-stack` 验过的那枚 | `docker image inspect` ⇒ **`arch=arm64 os=linux`**（`docker build` 不带 `--platform` ⇒ 跟随构建机） |
| 那两枚平台二进制包的许可 | `npm view @node-rs/argon2-{linux-arm64-musl,linux-x64-musl}@2.2.1 license` ⇒ 都是 **MIT** |

所以那句话的错处不是"amd64 不能发"，是**"两个架构都实测过"没有依据**：这台机器只有一个架构，
而 amd64 那枚发布物到今天**没有任何一次运行证据**（`platforms` 那行是发布配置，不是验证记录）。
内容层面今天没有真违规（两枚都是 MIT），但"今天没事"由**运气**保证 —— 没有任何一层会知道下一枚
按平台切的包是什么许可，这正是 G-53 要的那条判据。
⇒ 已改：workflow 那段注释改成"只发 amd64 / amd64 无运行证据 / 两枚的平台包不是同一批"；
`verify-selfhost-stack.sh` 现在**每次跑都把被验镜像的 `os/arch` 打进日志**，
非 amd64 时明写"这趟证明的是外人在自己机器上 build 的那一枚，不构成对发布物的运行证据"。
🔴 一般规律：**"发布配置"与"验证载体"是两个对象**，把它们写成一句话（"实测范围一致"）
就是拿前者的存在去冒充后者的证据 —— 与本文件 §8.11 / §8.13 那两次同族。


**③ 顺带把"钉住"的成本量出来了**（这是 G-47 一直缺的那个数）。镜像那棵树的形状是
`server/package.json`（21 条 prod deps）＋ 三枚本地包带出的 **5** 条 registry deps
（`@noble/ciphers`、`@noble/hashes`、`hash-wasm`、`zod`、`ical.js`；只有 `zod` 与 server 那份重叠）
＋ 那枚手写的 `prisma@5.22.0`。要把这棵树换成 `npm ci`，`npm ci` 的硬前提是
**lockfile 与 `server/package.json` 逐字段匹配**，所以三件事必须一起做：
`prisma` 从 devDeps 变成镜像装法里的显式一条（今天它靠 `--omit=dev` 之后单独点名）、
那 5 条里未被声明的要进 `server/package.json`、三枚 `.tgz` 不能再走 npm 解析
（tgz 每次构建重新打包 ⇒ 完整性哈希对不上 ⇒ `npm ci` 直接拒），改成解包进 `node_modules/@heyta/*`。
⇒ 结论：这条路可行，但它动的是**生产安装路径**，且必须用一次真容器跑起来才算闭环；
不在"马上要落地"的这一批里做，落成下一批的一条工单（含上面三个前置）。

#### 本轮（§8.36–§8.38）新增与结转的编号

| 号 | 状态 | 事项 / 前置 |
|---|---|---|
| **G-52** | ✅ 本轮闭合 | 运行期四枚镜像接旋钮 + R6 判据 + 对外那句改成按时段说清楚（读数与五臂变异见 §8.36） |
| **G-53** | ✅ **闭合（2026-10-04 05:4x，§8.48）**；曾长期是"🔴 新开，未动代码" | **按平台切分的二进制包这一整类不在许可证门禁的扫描集里**。现量：本机 arm64 打出的镜像里躺 `@node-rs/argon2-linux-arm64-musl@2.2.1`，快照（写死 `linux/x64/musl`）与门禁都没有它；快照里那两枚 `-linux-x64-{gnu,musl}` 反倒一枚都不会进 Alpine 镜像。前置：① ~~先拍"承诺发哪几个架构"~~ **这一条被 §8.43 的读数改掉了** —— 镜像里那把 lock 已经把 13 个平台变体全列成 `optional:true`，"装"这一侧不需要先拍架构；剩下真正欠的是"**扫**"这一侧肯读这些条目。② 若走 lock 路线，`gen-image-npm-tree.mjs` 的 `TARGET` 那一枚单值直接消失（读 lock 就是全集），③ 同前。**✅ 已按 lock 路线关闭（2026-10-04 05:4x，读数在 §8.48）**：新增判定 4 直接读提交物锁的 `os`/`cpu`/`engines.libc` 三字段，把 **14 枚**平台受限条目逐条过同一套许可证权威（全部 MIT、全部 optional）；字段读法抽成 `research/tools/image-lock-platform.mjs` 单一所有者，与快照生成器共用（重构零行为变化：`packages` 逐字相同、`inputs` 零差异）。8 臂变异 8/8、还原逐字节比对通过。🔴 一处形状修正：按**包名后缀**数只有 13 枚，会漏掉 `fsevents`（字段里有 darwin、名字里没有）——"按命题扫"要扫字段，名字是第二种抄件。架构承诺（发哪几枚镜像）仍未拍，但它不再是这一层的前置 |
| **G-47** | 🟡 主体未闭，但**三个前置今天全部量到、路线判定可行**（§8.43） | 版本漂移两趟独立全跑同形（`@fastify/websocket` 11.3.1→11.3.3）；① 三枚 `file:` tgz 必须在装的时候在场（真 `npm ci` rc=254/ENOENT，今天被 Dockerfile 自己 rm 掉）② `pnpm pack` 两次 sha512 相同（宿主量的，builder 内未测）③ 一把 lock 含全部 13 个平台变体且 `optional:true` ⇒ 跨架构不需要各钉一份。不在本批做的原因不变：动的是"镜像里到底装了什么" |
| **#2** | ✅ **已闭合（05:50 那一趟，读数在 §8.49）** | 五维都有现量：镜像 `VCS_REF=a70b0ef8`（含形状 C 与 G-53 新腿）· 默认服务图 3 个未动 · 一次性迁移 `exited(0)` · 真浏览器 3/3 · 四张截图 `FRESH=4/4` 且逐张人眼看过。上一行"04:2x 那一趟"与"第五步缺"都是旧读数，被这一趟换掉；架构仍是 `linux/arm64`（amd64 发布物零运行证据这件事**没被这次闭合覆盖**） |

### 8.39 两件"落地之后"的事先把前置量出来了（不预跑，只把会不会卡摸清楚）

04:0x 现量，全部只读：

| 前置 | 读数 | 结论 |
|---|---|---|
| Windows 打包机 | `ssh windows-pc` ⇒ `OK` + 主机名回显（另有一行 openssh.com 的 PQ 警告，不影响） | ✅ 第 8 项不会被"机器不在"卡住 |
| iOS 模拟器 | **三台同时 Booted**：`heyta-iphone-17pro`、`heyta-ios-isolated`、`iPhone Duo heyta` | 🔴 `reinstall:all` 的 ios 段第一步是 `simctl uninstall` —— 这三台里有别人正在用的（同一时刻另一条会话在跑 e2e）。这一段的**所有者与运行窗口**要先协调，不能直接起（AGENTS §7 第 9 条：共享资源独占验收） |
| Android | `adb devices` ⇒ `emulator-5554 device` | 同上，android 段会 `pm clear`/重装 |
| mac 端 | `/Applications/Heyta.app` 与 `/tmp/heyta-macos-dist` 都在 | ✅ 会被"清掉重装"，属预期 |
| 浏览器那条腿自身 | `e2e/selfhost-stack/selfhost-web.spec.ts:81-84` 是**真点**「同意」（`privacy-consent-dialog` / `privacy-consent-accept`），而这两个 testId 在当前树上确实存在（`apps/web/src/features/privacy/PrivacyConsentSheet.tsx:121`、`:266`） | ✅ §8.33 那次"被闸门挡住"的形态已经不会重现；剩下的唯一前置就是窗口 |

⚠️ 这一张表**不是**说第 8 项可以起 —— 它的顺序判据是"落地之后"，而落地还卡在 #7 那 5 枚重叠文件。
记在这里是为了：等窗口真来的时候，不用再花一轮去发现"模拟器是别人的"。

**② G-47 的"决定"其实早就写在工具自己嘴里**：`research/tools/gen-image-npm-tree.mjs:70-77`
有一段显式 `fail`：

> 仓库里出现了 npm 的 lockfile（`package-lock.json` / `npm-shrinkwrap.json` / `server/package-lock.json`）
> —— 镜像那棵树被钉住了，这份"每次重解都要重新量"的快照就是多余的第二事实源。
> **正确动作是把对账改成直接读那个 lockfile，并删掉本脚本。**

也就是说这一单剩下的不是"再想一个形状"，而是**把那条被写下来的路走一遍**：
生成 `server/package-lock.json` → 生产阶段 `npm install` 换 `npm ci` → 快照生成器与它那三条腿
改成读 lockfile。代价写清楚：它动 `server/Dockerfile` 的生产阶段，
所以**必须有一次真构建**才算闭环（`--check` 那类纯文件系统判据证明不了 `npm ci` 装得出来）。

### 8.40 我自己那枚"等窗口"的负载探针，两版都是坏的，而第二版坏得更像对的

等 `verify:selfhost-stack` 的干净窗口时写了个 `/tmp/window-wait.sh`（锁空 + 1 分钟负载 ≤12 才放行）。
它的负载取值连错两版：

| 版 | 写法 | 症状 |
|---|---|---|
| v1 | `sysctl -n vm.loadavg \| tr -d '{} ' \| awk '{print $1}'` | `tr` 把**分隔用的空格**和花括号一起删了 ⇒ awk 只收到一整行 `10.5313.9016.06`。日志被打印成那坨没法读的东西，**而整数部分恰好还是 1-min 那位 ⇒ 判定"侥幸"正确** |
| v2（我第一次的"修"） | `… \| awk '{gsub(/[{}]/,""); print $2}'` | 🔴 **更错且完全静默**：gsub 之后 `{` 那一段变空字段，`$1` 才是 1-min。拿它判就是在读 **5 分钟**那位 —— 1-min 已降到 11.x 时继续误挡，1-min 冲高而 5-min 还没跟上时误放 |

现量（这就是定案的依据，不是推理）：

```
$ sysctl -n vm.loadavg
{ 11.40 13.30 15.52 }
$ sysctl -n vm.loadavg | awk '{gsub(/[{}]/, ""); print "  $1=["$1"]  $2=["$2"]  $3=["$3"]"}'
  $1=[11.40]  $2=[13.30]  $3=[15.52]
```

⇒ 现在脚本用 `$1`，并且**开机先跑一条合成串自检**：`{ 1.11 2.22 3.33 }` 必须取到 `1.11`，
取到别的值直接 `exit 4 PROBE_BAD`（三位各不相同是故意的 —— 三个值相同的样本能同时通过 `$1`/`$2`/`$3`，
它证不了字段语义）。取值再判 `int=${load%%.*} ≤ 11`，并对空串/非数字/多个小数点报 `PROBE_BAD`，
**绝不把"读不到"当成"负载低"**（§7 元规则 1）。

🔴 这一条与 **§7 第 168 条**（"等负载的 `vm.loadavg` 解析自己坏了 15 轮"）是同一件事的又一副面孔：
那一副是解析不出数，这一副是**解析得出数、但取的是另一档**。
⇒ 待入 traps（**取号按主检出工作树现量，本行不写死号** —— 那个台账 `M` 着，别人正在往里加）：
凡是"三个语义不同的数值印在同一行"的读数（loadavg、`df` 的 used/avail、延迟的 p50/p95/p99），
**判据必须喂一个三位互不相同的样本自证取的是哪一位**，光断言"取到的是数字"挡不住取错档。

另记一条纪律，而且它**当场就把"写死号"抓了一遍**：`environment-traps.md` 在主检出是 `M`，所以我没有往它插行，
只在这份单写者的审计文档里登记了"待入"。同一趟现量两棵树：

| 树 | `grep -cE '^[0-9]+. '` | 最大号 |
|---|---|---|
| 本分支（`feat/self-host-distribution`） | 186 | **177** |
| 主检出工作树（2026-10-04 04:1x 现量） | 218 | **209** |

⇒ 按我这句话去写"记作 #178"，撞上的是一条**早就存在**的号（178 到 209 都在主检出里）。
**取号只认主检出工作树，而且每次现取** —— 分支上那份是合并前的旧快照，它的最大号不是下一个可用号。

### 8.41 §8.32 那句"冲突族今天不触发"活了不到一小时：04:1x `merge-tree` 又回 rc=1，唯一撞的还是 `package.json`

同一趟把载体重算成第 5 趟（`node research/tools/selfhost-merge-carrier.mjs`，脚本自己就是 §8.16 那三行的执行者）：

```
载体 1bba63b2 = main(9bcb67b2) × feat/self-host-distribution(9bdff857)，第一父 = main ✅
merge-base = b850b1c6（本批自己 01:45 那笔）；main 相对它 330 笔、本批 18 笔
git merge-tree --write-tree main feat/self-host-distribution → rc=1
  CONFLICT (content): package.json（三枚 blob：base/main/ours 齐全）→ 第 1 族
并集：scripts 键 143 个 · check 链段 main=74 / 本批=67 / base=66 / 并集=75（摘段 0/0）
五道纯 fs 门禁 exit 0
```

三点值得单独记：

1. ~~"今天不构成冲突"是有保质期的读数，而中间只隔了 main 的几笔。~~
   🔴 **这句因果被我自己下一趟现量否证了**：`main` 的链在 03:0x 那笔 `de537bd4` 上**就已经是 74 段 / 142 个 scripts 键**，
   到 `9bcb67b2` 一个字节都没动（`de537bd4` / `f61c23af` / `9bcb67b2` 三处逐字相同）。
   真正让第 1 族回来的是**本批自己往那行链上加了一道门禁**（`check:image-build-args`，scripts 键 142→143）。
   ⇒ 机制在这里，值得记：`"check"` 是**一整行**，一侧改它 git 能自动并（§8.32 那次 `rc=0` 就是这个形状），
   **两侧都改同一行才冲突**。所以"冲突族回来了"的第一怀疑对象应该是**我自己刚加的那一段**，
   而不是"main 又走了几步"。我把归因写给了一侧，而它需要的是**两侧同时动过**这个前提 —— 该现量的是这个。
   "载体只认分支名不认 SHA"那条纪律仍然成立（它防的是"载体过期"），但**它不是这次冲突的原因**，
   我原来那句话把两件事缝在了一起。
2. **这一趟是 §8.34 那个洞修好之后第一次真被触发。** 75 = 74 + 1：本批相对 main 只多一条
   新门禁（`check:image-build-args`，就是本轮 G-52 落的那道），而它必须从本批侧写回并集链。
   上一轮之前 `tChain ⊆ oChain` 让写回路径根本走不到；这轮它走到了，产出正确。
3. **我自己的复核探针报了一条假红。** 从 `git show 1bba63b2:package.json` 拆 75 段逐个点位批 7 道门禁，
   六道在链里，第七条报"🔴 不在"。现量：`grep -c 'check:image-install-contract'` = **0**，
   而它挂在 `check:image-license` 的**定义字符串**里（第三条腿）—— 也就是说**它本来就不是一个链段名**。
   ⇒ 按 §7 元规则 1 先怀疑探针：点位"某门禁进没进链"要问它**实际住在哪一层**
   （独立链段 / 别人那段里的子命令），否则一条挂对了的腿会被读成"合并把一族门禁摘了"，
   而那正是这脚本最怕的失败形状。

落地前置没变：主检出那 5 枚重叠文件**逐个仍是 `M`**（脏条目总数 134），#7 仍卡在"只有它们的所有者能推进 main"。

### 8.42 `verify:selfhost-stack` 第二次全跑：**五步全过、三条浏览器判据真跑、四张截图人看过**（第 2 项的关闭判据到齐）

窗口是等来的，不是挤进去的：等待器第一轮 200s 拿到 `FREED` 却被另一条会话的 `admin-console.spec.ts` 重新抢锁，
第二轮 500s 拿到 `锁空 + 1min 负载 9.25` ⇒ 立刻起全跑。
⚠️ **被验字节要说准**（这是"引用的运行 vs 实际跑过的运行"那一族，不能事后按 label 反推）：
起跑 04:20:50 时 `HEAD=9bdff857`、工作树带着未提交的 §8.41 文档改动；`3f190bc9` 在 04:22:05 提交；
镜像 `created=04:23:09`、label `VCS_REF=9bdff857`（脚本在起跑那一刻取的）。
⇒ 结论是**产物与这两笔的差异无关**：`docs/` 不在 `server/Dockerfile` 任何一条 `COPY` 里，
所以那几行文档改动根本进不了镜像 —— 但"label 是起跑时刻、镜像是之后完成的"这个错位本身要记下来。

```
VERIFY_EXIT=0
==> 打镜像（supersync:selfhost-verify，VCS_REF=9bdff857）
    被验的镜像：linux/arm64 —— 🔴 不等于发布 workflow 钉的 linux/amd64。   ← 本轮新加的披露自己响了
==> 起栈（project=heyta-selfhost-verify，端口 127.0.0.1:1900）
==> 入口命令抄件对账：扫描集 7 份 + 故意排除 1 份，命中 9 条，逐行过 R1–R6，R7 把验收载体也钉在同一套文件上
==> 等 /health
==> 真浏览器三条判据（http://127.0.0.1:1900/app/）  3 passed (7.2s)
    ✓ S1 /app/ 打开就是应用，且 SW 在 /app/ scope 下注册上 (517ms)
    ✓ S2 在这台实例上注册并登录，凭据落在本机自己那台服务器 (3.2s)
    ✓ S3 建一条任务同步出去，全新设备只能从服务端读到它 (3.1s)
    起跑时刻 04:24:10；四张截图 mtime 04:24:12 / 15 / 17 / 18 ⇒ 全部是本次的（新判据量的是这个，不是"目录里有图"）
==> 拆栈
```

**四张图逐张人看过**（§6.2 规定一），每张写下看到了什么：

| 图 | 看到的 |
|---|---|
| `s1-app-loaded.png` | 蓝白布局**没塌**（CSS 真从 `/app/` 加载）、侧栏九项 + 四象限 + 清单/标签两栏、`收集箱` 空态、右上「未同步」+ 中/EN + 暗色切换 |
| `s2-signed-in.png` | 右上变「已同步」（绿），头像菜单展开：邮箱 `selfhost-9051447-1@example.test` / 编辑个人信息 / 设置 / 退出登录（危险色，在最底） |
| `s3-device-a-synced.png` | 真任务 `selfhost-task-9051447-2` 落在收集箱，侧栏计数 1、四象限「不重要不紧急 1」 |
| `s3-device-b-recovered.png` | **全新 context（空 IndexedDB）**读到同一条任务、同一位置 —— 数据是从那台自建服务端下来的 |

⇒ 目标第 2 项要求的五格（设计 / 生产接线 / 失败与恢复 / 平台验收 / 当前产物）**第一次同时有读数**：
设计=台阶 1 那套挂载参数化、生产接线=镜像内 `/app/` 由服务端托管、失败与恢复=S3 那条"全新设备只能从服务端读到它"、
平台验收=本趟五步、当前产物=`VCS_REF=9bdff857` 那枚镜像（架构已如实披露为 arm64）。

**顺带把 G-47 的真树现量换到新提交重取了一次，而我的探针第一版是坏的：**

| 版 | 读数 | 真相 |
|---|---|---|
| 坏版 | "只在镜像有 = **99**" | 名字全是 `nullabstract-logging@…` 这种形状 —— `walk(root, null)` 之后 `${prefix}${name}` 把 `null` **拼进了包名**；另外 `.prisma` 目录被当成包（`null.prisma@UNREADABLE`） |
| 修好 | "只在镜像有 = **4**" | `@heyta/{domain,shared-schema,sync-core}`（本地 tgz，快照按设计不收）+ `@node-rs/argon2-linux-arm64-musl@2.2.1` |

修好后与 §8.38 同形：镜像 141（扫到目录项 156）vs 快照 143；只在快照有 2 = `argon2-linux-x64-{gnu,musl}`
（快照钉的是 `{os:linux,cpu:x64,libc:musl}`，本机是 arm64 ⇒ **这一档差就是 G-53 那个架构承诺问题本身**）；
同名不同版本 1 = `@fastify/websocket` 快照 11.3.1 vs 镜像 **11.3.3**，`generatedAt=2026-10-03T07:58Z` ——
**两次独立全跑都是这一条**，所以它不是抖动，是快照在漂。

🔴 这趟还量到一个**没预料到的东西**：镜像里有 `/app/package-lock.json`，`lockfileVersion 3`、`packages` 321 个键。
它是构建期 `npm install` 自己写的，**不是提交物**，所以今天没人读它。
⇒ 这对 G-47 的"lockfile 路线"是个真发现：那棵树**已经在镜像里被解析过一次了**，缺的只是
"把它在构建期抄出来钉住"这一步（而不是我上一轮量过走不通的 `pnpm deploy --prod`）。
但它是**构建产物**，`--check` 不能拿当前工作树去比 —— 要落地就得让 Dockerfile 在装完之后把它
`COPY --from=` 出来，作为发布物的一部分或由验收脚本现取。这条记成下一批的工单，本批不动生产安装路径。

⚠️ 落地时这四处 `e2e/selfhost-stack-results/*.png` 属于 §8.22 第 3 族（binary，取 main）。
本批提交它们只为让"这一趟真跑过"留在树里，**它们不是不可再生证据**：可重跑，而判据的载体是上面那张
"每张看到了什么"的表 —— 所以取 main 不丢任何主张。

🔴 **这一节差点把这份文档的结构弄坏，形状值得记**：我往文末追加 §8.41/§8.42 时，`Edit` 的 `old_string`
命中的其实是**文件中部**的一张表（§8.40 那两行读数表），于是新小节被插在"那张表"和"它自己的收尾段落"之间 ——
**追加变成了插入，而且成功、无报错**。症状是 §8.36 / §8.39 / §8.40 的尾巴全跑到 §8.42 之后。
⇒ 往长文档末尾追加之前先 `tail` 一眼确认锚点在文末，或直接走"读全文 → 按行 splice → 断言后写回"的脚本。
修的时候也用脚本：三块各**先断言首行内容 + 锚点唯一**，任何一块不匹配就整批不落盘；
守恒检查是 `diff <(sort 旧) <(sort 新)` —— 纯移动只应剩空行差，出现任何内容差就是改错了字。

### 8.43 G-47 的三个前置**今天全部量到了**，结论是这条路线可行 —— 而其中一枚探针差点把我骗过去

第 2 项跑完之后镜像还在，于是当场把"lockfile 路线到底走不走得通"逐个测了。
**没有改生产安装路径**（那是另一批的事），但这一单从此不再需要"再想一个形状"。

| 前置 | 怎么量的 | 读数 |
|---|---|---|
| ① 三枚 `file:` tarball 在装的时候必须在场 | 把 `package.json` + `package-lock.json` 拷进干净目录跑**真** `npm ci --omit=dev` | **rc=254 / ENOENT**。镜像里那三枚 tgz 被 `server/Dockerfile:276` 自己 `rm -f` 掉了 —— 今天这条路线**必然**死在这里 |
| ② `pnpm pack` 是否逐字节确定（不确定的话，钉住的 lock 下一次构建就失效） | 同一棵树连打两次，比 sha512 | `2e8688d2…` **两次完全相同** ⇒ 确定。⚠️ 这是在**宿主**上量的，不是在 builder stage 里；BuildKit 那侧还剩"同一 pnpm 版本 + 同一文件集"这一条没实测 |
| ③ 一份 lock 能不能跨架构（否则就是 G-53 那个架构承诺问题） | 读镜像里那把 lock 的 argon2 条目 | **13 个平台变体全在，且全部 `optional: true`**（android/darwin/freebsd/linux-arm/linux-x64-gnu/musl/win32…）⇒ **`npm ci` 自己按宿主挑变体，不需要按架构各钉一份 lock**。G-53 在"装"这一侧被这条路线**消解**了；剩下的只是"扫"那一侧要肯读这些 optional 条目 |

🔴 **①那一趟差点被 `--dry-run` 骗过去，这是本轮最值钱的一条判据教训**：
先跑的 `npm ci --omit=dev --dry-run` 在**镜像内**（`node_modules` 还在）返回 rc=0 并打 `up to date in 208ms`；
换到干净目录**仍然** rc=0（`added 145 packages`）；再把那三枚 tgz 换成**空文件**跑，**还是 rc=0**。
⇒ `npm ci --dry-run` 对 `file:` 依赖**一个字节都不碰**。任何拿 `--dry-run` 当"lock 装得出来"的证据的门禁，
都是"一条永远通过的判据"（§7 元规则 2）。真装那一次才拿到 ENOENT。
⚠️ 附带一条 npm 的措辞陷阱：ENOENT 之前打的是三行 `tarball data … seems to be corrupted` ——
**文件不存在**被 npm 说成**内容损坏**，照字面归因会去查哈希而不是查"文件在不在"。

⇒ 这一单剩下的是一句可执行的话：`server/package-lock.json` 提交进仓 →
生产阶段三条 `npm install` 换成一条 `npm ci --omit=dev`（tgz 的 `rm` 留在 ci **之后**）→
`gen-image-npm-tree.mjs` 与它那三条腿改成读 lock（那个脚本 `70-77` 行本来就写着"这是正确终态"）→
一次真构建 + `verify:selfhost-stack` 复跑才算闭环。
**本批不做的原因不变**：它动的是"镜像里到底装了什么"，而这一批正卡在落地窗口，
把一次生产路径重写塞进待评审的合并里，代价是让别的会话评审一个他们没预期的东西。

### 8.44 对账换到**真产物**上跑之后，第一次开口就照出两条对外缺陷：镜像里两枚包根本没声明 license

上面那句"本批不做生产安装路径"仍然成立，但**"对账"这一半不需要等** ——
它缺的只是一棵真的树。于是把 `check:image-license-coverage` 加了第二种载体：

| 载体 | 输入 | 跑在哪 | 能说什么话 |
|---|---|---|---|
| 预测快照（原有） | `server/image-npm-tree.json` | `pnpm check`（不联网、不 docker） | "如果 npm 按这份预测解析，许可是干净的" |
| 真镜像树（本轮加） | `research/tools/dump-installed-tree.js` 在**跑起来的镜像里**枚举 | `scripts/verify-selfhost-stack.sh` 每次全跑 | "发出去的那一枚里，装的每一条都被扫过或逐条登记过" |

新加的三条判定只在真产物上成立：登记里的 license 必须等于**包自己声明的**那一条
（拦"上游改了许可而版本号没变"）；本仓库那三枚包要求镜像内声明与源码侧声明逐字相同；
dump 里 `license` 列有值的条目数 <100 直接判红（否则"登记=声明"会静默退化成永真）。

🔴 **第一次跑就红了，而且红的是真缺陷**：`@heyta/sync-core` 与 `@heyta/shared-schema`
在镜像里的 `package.json` **没有 license 字段** —— 两枚包目录下都有 MIT 的 LICENSE 文件，
`PROVENANCE.md` 也写着 MIT，但 manifest 缺声明 ⇒ **发出去的产物自称"无授权"**。
按 AGENTS §3.2 那是"无 LICENSE 文件 = 无授权 = 一行都不能用"的同一族，只是这次缺的是**声明**不是文件。
补了两枚 `"license": "MIT"`（值来自各自目录里那份 LICENSE 的第一行，不是从 ADR 抄的）。
顺带：`packages/domain` 反过来 —— manifest 声明 MIT 而目录里**没有 LICENSE 文件**，登记不改（不在本批面上）。

⇒ 这条腿自己还有一次**当场生效**的证明：改完那两枚 manifest，快照新鲜度那条腿立刻红了
（它哈希这三枚被 pack 进镜像的 manifest），重跑 `gen-image-npm-tree.mjs` 之后 `check:image-license` 全链复绿。

⚠️ **我自己在这条腿上差点装出一个更严的第二套政策**：第一版的"声明必须宽松"只查
`PERMISSIVE_LICENSES`，于是 glob / lru-cache / minimatch / minipass / path-scurry（`BlueOak-1.0.0`）
与 nodemailer（`MIT-0`）全被判红 —— 而它们在 pnpm store 里**早就被 `REVIEWED_OTHER` 逐条判过**。
症状看起来像"镜像里混进了不合格许可"，实际是新腿另立了一套比门禁本体更严的判据。
⇒ 加判定只能引用**已有的那一个权威**（宽松表 ∪ REVIEWED_OTHER ∪ 镜像独有表），
不许在第二处重写"什么算可以"（§7 第 4 条"词表两套定义"的又一副面孔）。

登记表还多了一个 `carrier` 字段，因为它解决的是第二种载体带来的新问题：
arm64 变体与"npm 取到比 pnpm 锁更新的版本"这两类条目**只在一种载体上出现**，
按"不在树里就算过期"判会让同一张表在两种载体上互相打脸。
`carrier` 写非法值 ⇒ 直接红（不许拿它当逃避过期检查的后门）。

七臂变异各红一次、control 绿、每次改动 `cmp` 还原比对：
license 列全空 / 混入未登记的 GPL 包 / `--installed-tree` 参数被吃掉 / 路径不存在（rc=1，**不带管道**量的）/
源码侧 license 改成 GPL / 登记的 license 与产物声明不符 / `carrier` 写成 'both'。
~~快照模式读数零变化：143 = 127 + 16 + 0。~~
🔴 **这句在 §8.45 现量下已漂**：现在是 `143 = 126 + 17 + 0`。机制不是新加的判定，而是 20:47
那次快照重生成让**预测快照自己也解析到了 `@fastify/websocket@11.3.3`** —— 它于是从
"门禁扫描集里的一条"变成"登记过的一条"。写它的时候为真，现在划掉。

### 8.45 第三趟全跑：新腿在当前产物上取到绿，而它顺手照出**我自己那条腿的 4 条盲区**

**① 第三趟全跑现量**（`/tmp/heyta-selfhost-stack-run3-044933.log`，`VERIFY_EXIT=0`，
被验字节 = 分支尖 `991a1bc0`，含 §8.44 补的两条 `"license": "MIT"`）：

| 步 | 读数 |
|---|---|
| 打镜像 | `supersync:selfhost-verify`，`VCS_REF=991a1bc0` |
| **镜像内依赖树 × 许可证门禁（新腿）** | `✅ 141 条 = 扫描集 122 + 镜像独有 16 + 本仓库自己的包 3（无解释 0 · 非宽松 0 · 声明对不上 0 · 失效登记 0）` ⚠️ 这 141 是**当时那版遍历器**数出来的，同一个镜像在补了嵌套下钻之后读 **145 = 126 + 16 + 3**（见下面 ②） |
| 起栈 | 服务图对账：默认 3（未动）· 带 override 4（+`supersync-migrate`） |
| 入口命令抄件 | `✅ 扫描集 7 份 + 故意排除 1 份，命中 9 条，R1–R6 逐行过，R7 把验收载体钉在同一套文件上` |
| D-3 对账 | 一次性容器 `exited(0)` · `RUN_MIGRATIONS_ON_STARTUP=false` · 带外恢复 flag=true · 已应用 **42/42** · 悬挂 0 · 重复完成 0 · 回滚痕迹 5（设计内） |
| 界面挂载 | `[web-app] 共享 UI 挂在 /app/（来自 /app/web-dist）` |
| 真浏览器 | S1/S2/S3 **3 passed (7.2s)**，`FRESH=4/4`（四张 mtime 全部晚于起跑 04:54:53） |

`声明对不上 0` 就是这一格的靶心：上一趟（§8.44）同一格里点名的是
`@heyta/sync-core@1.0.0` 与 `@heyta/shared-schema@1.0.0`「镜像里那个包没有声明 license」。
**这条腿第一次跑出的红，在补完声明之后第一次跑出了绿** —— 不是"加了个更宽松的判定"，
是产物自己变了。

架构披露照旧响亮：`被验的镜像：linux/arm64 —— 🔴 不等于发布 workflow 钉的 linux/amd64`。
环境：起跑时 `vm.loadavg` 1 分钟 9.86（闸门 ≤12 通过），跑起来之后另一条会话的
`reinstall:all`（`package-app.sh`，已跑 3h47m）把 1 分钟负载推到 ~23。**这不算环境无效** ——
闸门量的是起跑时刻，且这一趟没有出现任何一处计时相关的失败。

四张图**人打开看过**（§6.2 规定一）：

| 图 | 看到什么 |
|---|---|
| `s1-app-loaded.png` | `/app/` 打开就是应用本体（收集箱空态 + 侧栏 + AI 两面入口 + 中英切换），顶栏「未同步」 |
| `s2-signed-in.png` | 顶栏「已同步」，头像菜单第一项是邮箱 `selfhost-0893808-1@example.test`，其下编辑个人信息/设置/退出登录 —— 没有第二个登录入口 |
| `s3-device-a-synced.png` | 设备 A 建的那条 `selfhost-task-0893808-2` 在收集箱里，计数 1 |
| `s3-device-b-recovered.png` | **全新 context（空 IndexedDB）只从服务端读到同一条任务**，同一标题、同一分组「无截止时间」 |

**② 这趟真正的产出不是"绿了"，是它照出了自己少看了 4 条。**

排查另一件事时顺手发现：镜像里 **有** 一把 lock —— `/app/package-lock.json`，
321 个键（`lockfileVersion: 3`），其中 **162 条标 `dev: true`**、非 dev **158 条**。
拿"lock 的非 dev 集合"和"我的 dump 数出来的磁盘树"正反对账：

| 方向 | 差 | 内容 |
|---|---|---|
| 磁盘有、lock 没记 | **0 条** | —— 我数出来的每一条都被 npm 自己的记录印证 |
| lock 记了、磁盘没有 | 17 条 | 12 枚 `@node-rs/argon2-*` 平台变体 + `fsevents@2.3.3`（本平台不装）+ **4 条嵌套副本** |

那 4 条嵌套副本是**真的装在镜像里、真的会被跑到**，而我的遍历器只数顶层所以看不见它们：

```
fastify-plugin@5.1.0   （顶层 6.0.0）  在 @fastify/rate-limit/node_modules 下
fast-uri@3.1.8         （顶层 4.2.1）  在 ajv/node_modules 下
process-warning@4.0.1  （顶层 5.1.0）  在 light-my-request/node_modules 下
tslib@1.14.1           （顶层 2.8.1）  在 tsyringe/node_modules 下
```

⇒ 这正是 §7 元规则第 1 条的又一副面孔：**"我这棵树数出 141 条、141 条全绿"这件事，
在 141 本身就是漏数的时候，证明不了任何东西**。发现方式不是复核遍历器，是找了个
**独立载体**去撞它 —— 而那个载体一直在产物里躺着。

修了两层（`research/tools/dump-installed-tree.js` / `check-image-license-coverage.mjs`）：

1. **遍历器递归下钻**嵌套 `node_modules`（BFS + 已入队集合，防环）。磁盘树 141 → **145**，
   正好 +4。🔴 关键读数：这 4 条**本来就都在许可证门禁的扫描集里**
   （模式 B 的 `covered` 从 122 → **126**），所以盲区闭合**没有新增任何一条豁免** ——
   最便宜的一种修法。
2. **新增一条"两个载体互相对账"**：磁盘 ⊆ lock 非 dev，且 lock 减磁盘的差集必须**全是
   `optional: true`**。规则从数据推导，**不写死包名**（写死 13 个 argon2 名字 = 把上游
   当前状态钉进判据，npm 加一个平台变体就红在无关的地方）。lock 缺失/为空 ⇒ 直接红：
   "我数出来的树"没有第二个载体可对时，它就只是我数出来的。

七臂变异（`node /tmp/agree-arms.mjs`，`ARMS_RC=0`，跑完 `cmp` 证输入文件 `SAME`）：

| 臂 | 造什么 | 读数 |
|---|---|---|
| control | 原样 | rc=0，`两个独立载体对上了：磁盘枚举 145 条 ⊆ lock 非 dev 158 条，差集 13 条且全是 optional` 命中 1 |
| **臂1** | **删掉一条非 optional 的磁盘条目（= 修之前那种只数顶层的遍历器形状）** | **rc=1**，`npm 的 lock 认为该装、磁盘上却没有的非 optional 包 1 条：tslib@1.14.1` |
| 臂2 | 磁盘凭空多一条 lock 没记的 | rc=1，`磁盘上有 1 条 lock 没记的包：evil-not-in-lock@9.9.9` |
| 臂3 | 把一条 argon2 变体的 `optional` 摘成 false | rc=1，点名 `@node-rs/argon2-linux-arm64-gnu@2.2.1` |
| 臂4 | `lockEntries` 整块拿掉 | rc=1，`现量树里没有 lockEntries` |
| 臂5 | `lockEntries` 换成空数组 | rc=1，同上（空数组不许当"没有差集"） |
| 臂6 | 磁盘树截到 99 条 | rc=1，`只有 99 条，不像一棵真的生产树`（旧哨兵仍在，新腿没绕过它） |

臂1 是这一格里最值钱的：**修之前那个形状的遍历器，在今天这条腿下会直接判红。**
盲区不是靠"我这次记得写递归"关掉的，是靠一条会因为它而红的判据关掉的。

**③ 顺带纠正两条读数与一处登记。**

- 🔴 **探针又坏在我自己手里一次**：第一版 lock 探针写 `p.name` 去数 `name@version`，
  得到 **"去重后 0 条"** —— lock v3 的包名**在键里**（`node_modules/ajv/node_modules/fast-uri`），
  值对象里没有 `name`。"全集 0"先怀疑探针，这条元规则这轮是第二次救我（第一次是 §8.41
  那条 `check:image-install-contract` 假缺失）。
- **`@fastify/websocket@11.3.3` 的登记摘掉了 `carrier` 字段**（省略 = 两种载体下都必须在，
  比写死一种**更强**）。理由：20:47 重生成快照之后，快照自己也解析到了 11.3.3，
  于是它两种载体都在 —— 留着 `carrier: 'installed-tree'` 会让"它从快照里消失"这一半
  检查被跳过。反证：把 11.3.3 从真树里拿掉 ⇒ rc=1（不带管道量的）。
- 模式 A 的 `127 + 16` 变 `126 + 17` 已原地划掉（本节开头），机制写清是快照重生成，
  不是新判定放宽。

**④ 对 G-47 的意义：那把 lock 已经在产物里，缺的是把它变成**输入**。**

审计 §8.43 量过"生成 lockfile → `npm ci` → 快照生成器改读 lock"这条路的三个前置。
这一轮多出一条**新事实**：`npm install` 在构建期**已经**产出一把完整的锁
（321 键、13 枚平台变体全标 optional），所以"钉住"这件事缺的从来不是**内容**，
而是**方向** —— 它现在是产物，不是输入。把 `/app/package-lock.json` 提升成
`server/package-lock.json` 提交物 + 生产阶段换 `npm ci`，剩下的代价仍然是那一条：
**必须有一次真构建才算闭环**（`--check` 类纯文件系统判据证明不了 `npm ci` 装得出来）。
本轮**没有**动生产安装路径（那三行 `npm install` 与 `Dockerfile:276` 的 `rm -f` 原样）。

⚠️ 边界照旧写清：这条腿**不在 `pnpm check` 链里**，它的消费者是 `verify:selfhost-stack`
（要真镜像才能跑）。链内那条（模式 A）对的是预测快照，两者读的是不同的东西，
`check-image-license-coverage.mjs` 的 `carrier` 字段就是为了让一张表能同时服务两种载体。

### 8.46 G-47 剩下那半条路：朴素形状「提交锁 + `npm ci`」被**三次实测否证**，而可用的形状也量出来了

§8.43 量过三个前置（tarball 装完即删 / `pnpm pack` 字节确定 / 锁里 13 枚平台变体全 optional）。
这一轮去量第四道 —— 也是最要命的一道：**我们自己那三枚 tarball 每次构建字节都会变，
锁里记着它们的 sha512，`npm ci` 会不会当场炸？**

先在**镜像里那把锁**上看形状（`/app/package-lock.json`，构建期 npm 自己写的）：

```
node_modules/@heyta/domain       {"resolved":"file:domain.tgz",      "integrity":"sha512-7/YHTPgpJ/6A…"}
node_modules/@heyta/shared-schema{"resolved":"file:shared-schema.tgz","integrity":"sha512-SxM73gxzxNaN…"}
node_modules/@heyta/sync-core    {"resolved":"file:sync-core.tgz",   "integrity":"sha512-NPfqVp3F4gvK…"}
```

三枚**都带 sha512**。于是造了一个零网络的最小工程（一枚 `file:` tarball 依赖）逐档量：

| # | 造什么 | rc | 装进来的内容 | 读数 |
|---|---|---|---|---|
| 1 | 字节未变（control） | 0 | —— | 正常 |
| 2 | **改一个字节重打 tarball，锁不重生成，默认（热）缓存** | **0** | **旧字节** `module.exports=1` | 🔴 **静默装旧包** |
| 3 | 同上，但 `--cache` 指到**空目录**（= CI / Docker 构建的真实条件） | **1** | 没装上 | `EINTEGRITY`（要 `C+xdLa…`，实得 `gf7R1r…`） |
| 4 | 反向对照：把**注册表**依赖的 integrity 末两字节改掉 | 1 | —— | `EINTEGRITY` ⇒ npm **确实**在验 integrity，第 2 档不是"它不验" |
| 5 | 把 `file:` 条目的 `integrity` **摘掉**，冷缓存 | **0** | **新字节** `module.exports=2` | ✅ 装的是当前 tarball |
| 6 | 第 5 档的基础上把 `package.json` 改成要 `is-odd@3.9.9`（锁里是 3.0.1） | **1** | —— | `ETARGET` ⇒ **注册表层仍然钉死**，摘 integrity 没有把锁变成装饰 |

**结论一（否证朴素形状）**：照 §8.43 那句"生成锁 → 换 `npm ci`"直接做，会在**每次改源码之后**
要么构建失败（冷缓存），要么**装进上一版我们自己的代码**（热缓存）。后者是 §7 第 27 那族
（"APK 里是旧 JS bundle"）在依赖层的翻版，而且它 rc=0、不报错。

**结论二（还有一道独立的坎，`server/Dockerfile:272-274`）**：生产阶段那三条 `npm install`
**会把 tarball 依赖写进 `server/package.json`** —— 镜像里那把锁的根条目是
`"@heyta/sync-core": "file:sync-core.tgz"`，而**仓库里声明的是 `"*"`**。
`npm ci` 的前提是"锁与 `package.json` 一致"，所以提交锁之前必须先重构这三行
（要么 `package.json` 直接声明 `file:`，要么把三枚改成 `npm install --no-save` 挂在 `ci` 之后）。
⇒ 登记 **G-54**：构建会改写 `server/package.json`，这条以前只在注释里说过理由
（为什么用 `"*"` 不用 `workspace:*`），没人量过它把"提交锁"这条路挡在哪一步。

**结论三（可用的形状，两条，代价不同）**：

- **A. 摘 integrity + `npm ci`**（第 5/6 档实测支撑）：把三枚易变 `file:` 条目的 `integrity`
  从提交物里剥掉，注册表层照旧钉死。代价：必须先解掉结论二那道坎（重构三条 install），
  而那三枚依赖的**声明形态**（`"*"`）同时是 pnpm 工作区解析的输入 ⇒ 动的面比"改两行 Dockerfile"大。
  🔴 **这条代价我没量**（要真把声明改成 `file:` 跑一遍 `pnpm install` 才知道会不会炸），
  所以它写在这里是"未实测"，不许被读成"量过了、很贵"。
- **B. 构建期漂移断言**（不动安装语义）：提交一把**基线锁**，在同一个 `RUN` 层里
  把 npm 刚写出来的 `/app/package-lock.json` 的**注册表条目**与基线逐条比，
  漂移即**构建失败**（三枚 `file:` 的 integrity 变化明确排除在外 —— 那是合法的易变部分）。
  代价：一条 COPY + 一行 node 脚本 + 一次真构建；**不需要**碰 `"*"` 那条声明。

选 **B**。理由不是它省事，是它把"钉住"落在**真正需要钉的那一层**：第三方版本 = 许可证面。
A 多出来的收益只有"连解析都不重做"，而它换来的是改生产依赖声明形态。
🔴 B 的诚实边界要写清：**它挡的是"悄悄变了"，挡不住"故意改基线"** —— 后者由 diff 评审负责，
和 `pnpm-lock.yaml` 的改动是同一档待遇。

> ⚠️ **本节上一版这里写过一句没取证的话**，已删：「`server/package.json` 的依赖声明形态是
> `check:image-install-contract` 与 `check:layering` 都在读的东西」。现量：
> `check-image-install-contract.mjs:67-77` 读的是 `dependencies["@prisma/client"]`
> （**不是**那三枚 workspace 依赖的声明形态），而 `scripts/check-layering.mjs` 里
> `package.json` 命中 **0 次** —— 它压根不读这枚文件。写错的后果是把 A 的代价**虚高**了，
> 而虚高的代价会把"没做"包装成"做过权衡"。A 真正的代价是"没量"，就写成"没量"。

**结论四（写完"选 B"那句之后立刻量出来的第三条路，它比 A 和 B 都好 —— 最终落的正是它）**：
B 有一个当场想透的坏处 —— `^` 范围 + 事后比对 = **外人晚半年 build 老 tag 会构建失败**，
而这批的目标正是"外人一条 compose 起全套"。于是量了 C：**把提交物锁当输入塞进构建，
安装命令仍是 `npm install`**（不碰 `npm ci`、不碰 `"*"` 声明）。三档实测：

| 档 | 造什么 | 读数 |
|---|---|---|
| C1 | 锁里手工把 `ms` 钉到范围内**更旧**的 2.1.2（范围内有 2.1.3），冷缓存跑 `npm install` | rc=0，装的是 **2.1.2**，锁也没被改写 ⇒ **`npm install` 认锁，不升级到范围内最新** |
| C2 | 生产真实场景：锁里 `file:` 条目的 integrity 是**旧字节**的 sha512，tgz 已重打，冷缓存跑 `npm install` | rc=0，装的是**新字节**（`module.exports=2`）⇒ 既不 EINTEGRITY，也不装旧包 |
| C3 | 同 C2 但用 `npm ci`（= 上面第 2/3 档） | 热缓存 rc=0 装**旧包** / 冷缓存 rc=1 `EINTEGRITY` ⇒ 那个坑是 **`npm ci` 特有的**，不是"锁 + 易变 tarball"固有的 |

⇒ **选 C**：注册表层被锁钉住（老 tag 永远解析出同一棵树，这才是"可复现构建"），
我们自己那三枚每次变的 tarball 走 `npm install` 的原生行为（不验 `file:` 的 integrity、装当前字节），
`server/package.json` 的 `"*"` 声明一个字都不动。代价：一条 `COPY package-lock.json` + 一把提交物锁 +
**一条防锁腐烂的门禁**（锁必须覆盖 `package.json` 每条 dependencies，否则"加了依赖忘了重生成锁"
会让锁变成装饰）。B 降级为"如果 C 的真构建验不过再退回来的形状"，A 放弃（它要动声明形态，代价没量）。

上面这一段的结论已经在 §8.47 落地。
本轮**没有**动 `server/Dockerfile` 与生产安装路径（只量，不改）——
这句是**当时**的边界，实现与真构建复验在下一笔（`1b7d0921`）已做完。

### 8.47 形状 C 落地：提交物锁 + 一条 COPY，三条 install 一个字没改（G-47 的钉子这一趟真的钉上了）

**① 改动面（就两行生产配置 + 一把锁）**

| 文件 | 改了什么 |
|---|---|
| `server/package-lock.json` | **新增提交物**（321 键 / lockfileVersion 3），取自一趟真构建的 `/app/package-lock.json` |
| `server/Dockerfile:246` | 生产阶段加一条 `COPY --chown=supersync:nodejs server/package-lock.json ./package-lock.json` |
| 那三条 `npm install` | **一个字没改**（仍是 `npm install`，不是 `npm ci`） |
| `gen-image-npm-tree.mjs` | 第 3 步不再联网重解，改成读提交物锁导出快照；旧的那条"仓库里有 lockfile 就 fail"守卫**反转**成"锁不在就 fail" |
| `check-image-license-coverage.mjs` | 模式 A 的载体名与尾部那句 ⚠️ 重写（见下面④） |
| `check-image-install-contract.mjs` | 新增第 4 步：锁的在场 / COPY 位置 / 逐条覆盖 / 反向多余 / 版本-范围 |

**② 两趟真构建把"锁在驱动解析"证到了，而不是"输出恰好相同"**

| 趟 | 造什么 | 读数 |
|---|---|---|
| 第一趟 `supersync:locktest` | 当前源码 + 种进构建的锁 | 构建 rc=0；镜像里 npm 写出的锁与提交物锁的 **registry 层 317 条逐条相同**（version+integrity 零差异、增删各 0、dev 标记 162=162） |
| 第二趟 `supersync:lockmut`（鉴别实验） | 只把锁里 `ws` 手工钉到**范围内更旧**的 8.21.3，`package.json` 仍声明 `^8.18.0`（允许 8.22.0） | 构建 rc=0，镜像里装的是 **8.21.3**，镜像那把锁也记 8.21.3 |

⇒ 第一趟单独看不算证据（"输出相同"也兼容"npm 没读锁、只是又解了一遍同样的结果"）；
第二趟才是那一格：**锁改一个版本，产物跟着改** —— 锁在驱动解析。
实验做完锁复原，`cmp` 证与镜像产物逐字节相同。

**③ 两种载体的现量（换了事实源之后）**

```
模式 A（提交物锁导出的树）    146 条 = 扫描集 126 + 镜像独有 17 + 本仓库自己的包 3
                              （无解释 0 · 非宽松 0 · 声明对不上 0 · 失效登记 0）
模式 B（跑起来的镜像里那棵树）145 条 = 扫描集 126 + 镜像独有 16 + 本仓库自己的包 3
                              磁盘枚举 145 ⊆ npm 自己写的 lock 非 dev 158，差集 13 条且全是 optional
```
143 → 146 的差是**三枚自家包进了快照**（锁里本来就有 `node_modules/@heyta/*`，
预测时代它们不在快照里，所以"本仓库自己的包 0 条"那句以前是形状使然，不是"镜像里没有自家包"）。
A 与 B 差 1 条是平台过滤那一枚（快照钉 `linux/x64/musl`，本机镜像装的是 `arm64` 那一枚）——
写这一节时 G-53 那族还没闭，别把这条差读成对账松了。🔴 **同一天 05:4x 它已经关了**：
新增的判定 4 直接按提交物锁的 `os`/`cpu`/`engines.libc` 逐条判**全部** 14 枚平台变体，
所以"哪一档架构才会装"不再决定"哪一枚被判过"（读数与 8 臂变异见 §8.48）。

**④ 这一趟停掉的三处对外错话**（都是"以前为真、现在为假"，不是写错）

1. `check-image-license-coverage` 模式 A 尾部：「仓库里**没有作为输入的** lockfile…
   钉不住下一次构建」⇒ 改成"第三方层由提交物锁钉住 + 还剩哪两处漂移面各有判据"。
2. 同一处的载体名「预测快照」⇒「提交物锁导出的树」。
3. `gen-image-npm-tree.mjs` 文件头：「仓库里没有任何 npm lockfile」「每次构建从 registry 重解」
   「用法（**要联网**）」，以及 `check-image-license-coverage` 里那句「生成：…（要联网）」
   ⇒ 生成器现在只读仓库里两枚文件，**离线**。

**⑤ 新腿第一次开口，抓到的是我自己刚造的两层问题叠在一起**

换上第一把锁之后模式 A 直接报三条「镜像里那个包没有声明 license」。拆开是两件事：

- 那把锁取自**补 license 声明之前**的那趟构建（04:23 那枚镜像），锁里 `file:` 条目的
  `license` 是构建期从 tarball 抄的 ⇒ **过期锁会带着过期的声明**。这条判定对锁同样有效，
  不只是对镜像有效 —— 这是它第一次在锁这一层开口。
- 而我这边 `deriveFromLock` 压根没把 `license` 带出来（只带 name/version/optional）
  ⇒ 三枚自家包无条件判红。

🔴 两个问题叠在一起时，**只修一个就会把剩下的那条红当成"已经修好了"**。
先换锁（从当前源码那趟构建取）→ 仍红 → 才看见自己漏读的那一列。
两处都修完才是上面③那两行绿。

**⑥ 九臂变异（`node /tmp/contract-arms.mjs`，`ARMS_RC=0`）**：全部在 `/tmp` 的
`--root` 一次性副本里做，收尾把四枚输入与工作树逐字节比（`YES`）—— 工作树一个字没动。

control 绿 / 锁整枚删掉 / 锁里少一条声明过的依赖 / 某条版本落到范围之下 / 根条目凭空多一枚依赖 /
`lockfileVersion` 改成 2 / 锁截到 100 条以下 / Dockerfile 没有 COPY 锁 / COPY 挪到生产阶段之前 ——
九臂各红一次，退出码与 needle 命中数都断言。
（其中"没有 COPY 锁"那一臂第一趟是**我的 needle 写错**：真句子是「里没有 COPY 提交物锁这一行」，
我漏抄了"提交物"三个字 ⇒ rc 对、needle 0 命中 ⇒ 判 BAD。修 needle 重跑才全对 ——
变异脚本自己的 needle 也要照源码字面抄，不能凭记忆。）

**⑦ 三条受影响的门禁现量**：`check:image-license` / `check:gate-wiring` / `check:script-snapshot`
各 `rc=0`（用 `sh -c` 逐条量退出码，不拿管道后的 `$?` 当读数）。

**还没做完的（别把这一节读成收尾）**：

- ~~`pnpm verify:selfhost-stack` **全跑**在这一批改动之后还没取过现量 ——
  写这一节时 1 分钟负载 68.9 且 `/tmp/tfa-test.lock` 在别人手里（环境无效，等窗口，不调阈值）。~~
  ✅ **05:5x 取到了，读数在 §8.49**（那一趟跑的正是含本节改动的产物）。
- ~~完整 `pnpm check` 同理没跑。~~ **仍未跑** —— 它的关闭位置在 §8.49 末尾写明（要在合并载体上跑，不是在本分支跑）。
- G-53（平台二进制包从没进过扫描集）✅ **已在本节的下一节关掉**（§8.48：判定 4 按锁的三字段逐条判 14 枚变体）。
  仍然开着的是**另一半**：本机 arm64 与发布钉的 amd64 两档并存、对外没说清 —— 那是"发哪几枚镜像"的运维决定，
  写这一节时它不属于许可证层的债。
- 重生成锁这件事**只能靠一次真构建**（从镜像取 `/app/package-lock.json`）——
  本批把它写进了三条失败提示里，没有留一条"宿主机上跑一下就完事"的假出口。
- #7 落地仍等主检出那 5 枚文件；#8 `reinstall:all` 仍排在落地之后。

### 8.48 G-53 关成"按锁逐条判"：这一层不需要先拍架构承诺（05:4x）

**为什么现在能关**：G-53 欠的一直是"**扫**"这一侧肯不肯读平台变体（§8.38 把前置①"先拍架构"
划掉之后剩下的那一格）。§8.47 把 npm 锁变成提交物之后，第一次有了一份**跨架构的、在仓库里的**
清单可以当输入 —— 逐条判**全部**变体，任何"我们承诺发哪几枚架构"的子集都自动被覆盖，
于是这条判定和那个还没拍的决定脱钩了。**架构承诺本身仍然没拍**（amd64 发布 vs 本机 arm64 构建、
`VCS_REF` 那套两件事并存且没对外说过，仍属 D-1/D-2 那一档），这一节只是不再拿它当借口。

**① 现量：平台变体这一族的真实大小，取决于探针按什么读**

| 读法 | 数出来的平台受限条目 | 漏了什么 |
|---|---|---|
| 包名后缀 `-<os>-<arch>[-<libc>]`（我先写的探针） | **13** 枚，全部 `@node-rs/argon2` 的变体 | `fsevents` 那一整类 —— 它名字里不带架构，`os:[darwin]` 只写在**字段**里 |
| 锁的 `os` / `cpu` / `engines.libc` 三字段（落地的读法） | **14** 枚（158 条非 dev 里） | — |

14 枚**全部 `license: MIT`、全部 `optional: true`**；其中 12 枚不在本次载体的树上
（模式 A 只装 `linux/x64/musl` 那一档），13 枚是"别的架构才会装"的、1 枚（`fsevents`）是"永远不会进 Linux 镜像"的。
🔴 可迁移的形状：**按命题扫要扫字段，包名后缀是第二种抄件** —— 我第一版按名字数，
差的那一枚恰好是"平台受限但名字不说"的形状，而这类包正是盲区本身。

**② 落法：先抽单一所有者，再加判定**

`research/tools/image-lock-platform.mjs`（新增）= 锁的平台闸门**唯一**读法，两个消费者：
`gen-image-npm-tree.mjs`（按 `TARGET` 过滤）与 `check-image-license-coverage.mjs`（反向取全集）。
🔴 重构要求零行为变化，且这是**量出来**的而不是声称的：`gen --stdout` 重跑一遍，
与提交快照比 `packages` **逐字相同**（146 条）、`inputs` **零差异键**。

`check-image-license-coverage.mjs` 新增**判定 4**，四条子判据：
1. 平台受限却不是 `optional` ⇒ 红（换架构构建时它是硬依赖，会当场炸构建）；
2. 锁里没有 `license` 字段 ⇒ 红（没有声明就是没有授权，不能当"应该没问题"）；
3. 声明过**同一套权威** ⇒ 不合格就红。权威只有一份：把判定 1 原来内联的四条件表达式抽成
   `unacceptable(id, declared)`，判定 1/4 共用 —— 这条脚本历史上就因为"另抄一套更严的策略"响过一次假红（见它的注释）。
4. **空集哨兵**：`gated.length === 0` ⇒ 直接红。要么字段读法坏了（它是两层判定共用的输入），
   要么 argon2 那一族真的不再按平台分发 ⇒ 把这条腿连同 G-53 一起**撤掉**，不许放宽。

**③ 八臂变异（`node /tmp/g53-arms.mjs`，`ARMS_RC=0`，8/8 OK）**
每臂只改 `server/package-lock.json` 一枚文件，跑完立刻把 `git show HEAD:` 的字节写回，
收尾断言"与 HEAD 逐字节相同 = true"且 `git status` 该行为空。

| 臂 | 造什么 | 读数 |
|---|---|---|
| control | 不变异 | 模式 A rc=0、模式 B rc=0、整条 `check:image-license` 链 rc=0 |
| 臂1 | 一枚变体 license→`GPL-3.0` | rc=1，needle `license=GPL-3.0` + 标题带计数 |
| 臂2 | 摘掉一枚变体的 license | rc=1，needle「锁里没有 license 字段」 |
| 臂3 | 一枚变体 `optional:false` | rc=1，needle「却**不是** optional」 |
| 臂4 | 把 14 条的 `os/cpu/engines.libc` 全抹掉 | rc=1，空集哨兵开口 |
| 臂5 | 给 `ms` 凭空加 `cpu:[sparc64]` | rc=1 且**指名到刚加闸门那一枚** ⇒ 字段是现读的，不是包名白名单 |
| 臂6 | 反向对照：改一枚**非**平台条目的 license | 判定 1/4 都 rc=0，**整链 rc=1 红在新鲜度**（`server/package-lock.json（镜像那棵树的钉子） 变了`）—— 见下面④ |
| 臂7 | 臂1 的同一变异，跑模式 B | rc=1 + 同一条 needle ⇒ 载体无关（输入是锁） |

臂4/臂5 第一趟是 **BAD 在我的 needle**（不是门禁没牙）：臂4 把粗体标记位置抄错
（源码 `**一枚**平台受限的都没有`，我写成整串加粗），臂5 少抄一个空格
（源码 `${e.id}  [${dims}]` 是**两个**空格）。两次都是 rc=1 正确、needle 0 命中 ⇒ 判 BAD。
🔴 这是同一族第三次（§8.47 那趟也是 needle 少抄"提交物"三个字）：**变异脚本的 needle 必须从源码字面抄，不能凭记忆**。

**④ 这一趟量出来的一层真实分层（别把它读成漏洞）**
臂6 说明：模式 A 的 license 列读的是**快照**（生成时从锁抄下来的），不是活锁。
所以"改了锁没重跑快照"这一类由 `gen --check` 的 `inputs.packageLockSha256` 守（链的第一环），
重跑之后由判定 1 守 —— 两层合起来仍然闭合，只是不在同一层。
判定 4 直接读活锁，是因为它管的那一类**判定 1 结构上永远看不见**（不在任何一棵树上）。

**⑤ 三条受影响门禁的现量**：`check:image-license`（整链）rc=0 / `check:gate-wiring` rc=0
（64 道定义、链 67 段、链外 1 道且消费方可验）/ `check:script-snapshot` rc=0
（它管的是 `scripts/` 的自快照，新增的 `research/tools/*.mjs` 共享模块不是它的输入 —— 与 `image-install-shape.mjs` 同档）。
⚠️ 记一条探针教训：我先把 `check:gate-wiring` 的实现路径猜成 `research/tools/check-gate-wiring.mjs`
⇒ `MODULE_NOT_FOUND` rc=1，**看起来像"新腿把门禁跑坏了"**。判"某道门禁红了"之前，
先 `node -e` 读 `package.json` 的 `scripts` 那一行，别按记忆的目录去跑。

**还没做完的（这一节只关 G-53）**：~~`verify:selfhost-stack` 全跑仍等窗口（等的是 §8.47 整批改动之后的现量，
写这一节时负载与 `/tmp/tfa-test.lock` 都不在手里）~~ ✅ **05:50 那一趟跑完了，读数在 §8.49**；
多架构**发布**（发哪几枚镜像）仍待拍；
`packages/domain` 声明 MIT 而目录里没有 LICENSE 文件那条只登记不动；#7/#8 不变。

### 8.49 形状 C + G-53 都进去之后的一趟全跑：`VERIFY_EXIT=0`，四张图逐张人眼看过（05:50）

窗口 05:50 拿到（1 分钟负载 10.28、`/tmp/tfa-test.lock` 不在任何人手里、docker daemon 29.4.0），
拿到之后**立刻**起全跑，没有"先干别的再回来跑"。日志 `/tmp/verify-shapeC.log`。

| 维度 | 现量 |
|---|---|
| 当前产物 | `VCS_REF=a70b0ef8` ⇒ 这一趟被测的镜像**含形状 C 那条 `COPY` 与 G-53 新腿**（不是旧镜像配新读数）。架构披露为 `linux/arm64`，脚本自己写明"不等于发布 workflow 钉的 `linux/amd64`" |
| 设计（入口命令） | `check:selfhost-entry-command`：扫描集 **7 份 + 故意排除 1 份**、命中 **9 条**入口命令，逐行过 R1–R6，R7 把验收载体的 `-f` 集合也钉成对外那一条 |
| 生产接线 | 默认服务图 **3 个未动**、带 override **4 个**（+`supersync-migrate`）；一次性迁移容器 `exited(0)`；应用侧 `RUN_MIGRATIONS_ON_STARTUP=false`；服务端日志真印「共享 UI 挂在 `/app/`（来自 `/app/web-dist`）」 |
| 失败与恢复 | D-3 那条带外恢复 flag `=true` 且与文档那条入口命令同一支 —— "升级不是一条命令"这句仍为真，没有为了让它绿而改判据 |
| 平台验收 | 真浏览器 **3 passed**：S1 `/app/` 打开就是应用且 SW 注册在 `/app/` scope、S2 在这台实例注册并登录（凭据落在**本机自己那台**服务器）、S3 建一条任务同步出去且**全新设备只能从服务端读到它** |
| 截图新鲜度 | 起跑 `05:50:49`，四张 mtime `50:50 / 50:54 / 50:56 / 50:57` ⇒ `FRESH=4/4`（判据本身见 §8.37） |

**四张图逐张看了什么**（§6.2 规定一要的是"看了"，不是"截了"）：
S1 = 蓝白共享 UI、rail 完整（收集箱/今天/最近 7 天/已完成/四象限/清单/标签）、顶栏「未同步」、中文；
S2 = 已登录（`selfhost-4250167-1@example.test`）、顶栏「已同步」绿、头像菜单是身份区 + 编辑个人信息 / 设置 /
退出登录（危险色在最底）；S3-a = 设备 A 收集箱计数 1、卡上标题 `selfhost-task-4250167-2`；
S3-b = **另一台全新设备**读到同一条任务（同标题、同「收集箱」、计数 1）—— 这一张才是"打开浏览器就能用"里"能用"的那半。
没有一张是错误屏/空白屏，也没有"探针把界面留在设置页给截图打分"那种残留（§7 第 83 条那一族）。

**新腿第一次在验收链里开口**（不是我在终端单独跑出来的）：模式 B 磁盘枚举 **145 ⊆ 锁非 dev 158**、
差集 13 条全是 `optional`；判定 4 报锁里 **14 枚**平台受限条目全过同一套权威，其中 **13 枚不在本次载体的树上**。
⚠️ 与 §8.48 模式 A 那句"12 枚不在"**不矛盾、也不是抄件漂**：A 的树是 x64 那一档（2 枚在树里）、
B 的树是 arm64 那一档（1 枚在树里），差的正是那一枚架构。

**这一趟仍然没有做到的（别读成本批收尾）**：

- 完整 `pnpm check` **仍未跑**，而且它的关闭位置不在本分支：在这里起全链会 SIGKILL 别人在 4318/4319/3000 的 vite
  （`check:ai-e2e` 的前置），而 main 自己那几处红不由本批吸收 ⇒ 只能等 #7 落地后在**合并载体**上跑。
- #7 那 5 枚重叠文件 05:4x 现量**全部仍是 `M`**，main 已走到 `022edfcf` ⇒ 载体又过一期。
- **amd64 那枚发布物至今零运行证据**（本机 arm64）。G-53 关的是"许可证判没判全"，不是"另一档架构跑没跑过"。
- #8 `pnpm reinstall:all` 仍排在落地之后（顺序错了就装完即过期）。

### 8.50 G-51 判定：「可安装」这句在两档下不是"还没测"，是**不成立**（补丁已备好，等表空出）

G-51 登记时写的是"没有取证"。这一轮把**生产者侧**和**载体侧**都量了，结论比"没取证"更硬：

| 侧 | 现量（都可重跑，不是推断） | 它证明了什么 |
|---|---|---|
| 生产者 | `apps/web/tests/startup-network.spec.ts:81` 与 `:88` 断言同意前 `registerServiceWorker` 调用数为 **0**，`:128` 同意后为 **1**；`apps/web/src/features/privacy/startup-network.ts` 那张表写明「`serviceWorker.register()` 的闸在本文件：没同意就不调」 | **未同意时页面里根本没有 SW** —— 不是"注册得晚"，是一次都不注册 |
| 载体 | `e2e/selfhost-stack/selfhost-web.spec.ts:81-85` 的 `openApp()` 在同意面板可见时**会点 `privacy-consent-accept`** | §8.49 那条「S1 SW 注册上且 scope=`/app/`」的读数**只覆盖"已同意"这一档**，不能拿来给"可安装"背书 |

⇒ 推论（前提写清）：Chromium 给安装入口的**必要条件**里包含"该 scope 有已注册 SW"，
而它在 ①未决定 ②「只用本机」两档下结构性不成立。所以落地页那句
`site.platforms.web.body`「完整产品，不是演示。**可安装**、可离线用…」在**这两档下是不成立的承诺**，
不再是"待取证"。⚠️ 这一条**只用了"没 SW 一定不给"那一侧**；
"已同意那一侧到底给不给安装入口"仍然没有正面证据（那要测 `beforeinstallprompt` 才算取证，见本节末）。

**决定：改措辞，不动闸门。** 把 `registerServiceWorker()` 搬出同意闸门确实能让这句在三档下都成立，
但那会改掉"同意前一个请求都不发"这条隐私立场（G-12 的裁决，且它正是这条闸存在的原因）——
那是产品/法务那一档的决定，不由本批顺手改。措辞改成把承诺限定在实测成立的那一档，
并且**沿用界面自己的词**（同意按钮的现行词条是 `common.privacy.consent.accept`：
中「同意并联网」/ 英 "Agree and connect"，不另造一套说法）：

```
zh 'site.platforms.web.body':
  完整产品，不是演示。点一次「同意并联网」就能装成应用，离线也能用，数据就存在你的浏览器里。
en 'site.platforms.web.body':
  The full product, not a demo. Tap "Agree and connect" once and it installs like an app.
  It works offline, and your data stays in your own browser.
```

**为什么不现在加一条"当场就会红"的门禁**：加上去就是把 `pnpm check` 留在红态，
而 §8.20 已经写过这条纪律（判据必须和它要约束的改动**同一批**落地）。
所以落地顺序钉成三步：① 两份词条表同时改（中英同步）→ ② `pnpm gen:entries` + `pnpm check:entries`
→ ③ 在 `e2e/live-site` 加一条"这句必须带条件词"的判据，并先注入验证它能红
（把条件词删掉 ⇒ 红）。**这一步和 #19/#20 那次落地页重发是同一次动作**，不另起一次发布。

**卡在哪**：`packages/i18n/src/locales/{zh-CN,en}.ts` 正是 #7 那 5 枚被并行会话占着的重叠文件之二
（05:4x 现量仍是 `M`）⇒ 现在动它 = 造一次没人能干净解的三方冲突，而且会替别人把在途词条一起提走。
所以这一单的状态是「**已判定、补丁已备好、待表空出**」，不是"待办"。

**仍然欠的那半个读数**：已同意档下 `beforeinstallprompt` 到底发不发（正面证据）。
它要一次真浏览器跑，等窗口；在拿到之前，上面那句措辞是**保守**的
（"点一次就能装成应用"仍然预设了能装 —— 如果那一发测出来是不发，这句还得再退一步）。
🟢 这一条的**配方**已在 §8.53 落好（含两个预解的坑：监听必须装在导航之前、只观测不 `prompt()`），
欠的只剩窗口与载体，不再是"不知道该怎么测"。

### 8.51 把 §8.49 那次全跑的读数**钉在"当前产物"上**，并排掉两处"看着像缺口"的（06:0x）

Goal 的第 2 项要的是"现量"，而 §8.49 那次全跑打的 `VCS_REF=a70b0ef8`，分支之后又走了两笔
（`5a369e0b`、`95ca337c`）。"那两笔只是文档"是我的印象，不是证据 —— 这一轮把它量成证据，
并且**用清单自己的读者去量**（不是我自己 eyeball 文件名）：

```sh
cd server                       # 🔴 必须在这个目录 source，见下面那条
. scripts/image-inputs.sh
out=$(git diff --name-only a70b0ef8 HEAD -- "${SUPER_SYNC_IMAGE_INPUTS[@]}") || exit 1
echo "交集 = $(printf '%s' "$out" | grep -c .)"     # → 0
```

🔴 **这段差点读成一个假的 0**：复跑时我给 reader 加了 `git -C ..`，而清单第一项是 `../.dockerignore`
—— 从仓库根看它就在**仓库外**，git 直接 `fatal: '../.dockerignore' is outside repository`，
而 `| grep -c .` 把"命令死了"读成"交集为 0"，看起来比真值还干净。两条 fatal 就印在我那一行读数的上下。
⇒ **计数之前先断言退出码**（`|| exit 1`），并且这个 reader 的 cwd 是它契约的一部分：
清单里的路径是**相对 `server/`** 的，换目录 source 就等于换语义（脚本头部本来就写了这句）。
🟡 这条一般规律（**测量被管道喂给计数器时，"命令死了"和"结果是 0"长得一模一样**）**待入环境陷阱**——
`docs/reference/environment-traps.md` 在主检出正脏着（在 06:1x 那批重叠文件里），按纪律不往多人台账插行，先登记在这里。
06:20 在分支 tip `d4c30912` 上按正确形态复量：**交集 0 / 阳性对照 5 / `diff rc=0` / `log rc=0`，
"最后碰过输入的提交"仍是 `1b7d0921`** ⇒ §8.51 那条"读数钉在当前产物上"到本轮全部提交之后仍然成立。

| 读数 | 值 | 它挡的是什么 |
|---|---|---|
| 清单条目数 | **22** | 空数组时 `git diff --quiet --` 会退化成"整个仓库脏才报错"，所以分母必须打出来 |
| `a70b0ef8..HEAD` 改动文件 | 4（1 份审计文档 + 3 张证据 PNG） | 阳性对照：同一命令去掉 pathspec 限制回 4 ⇒ 那条 pathspec 确实有东西可筛 |
| **交集** | **0** | 没有任何一条镜像内容输入变过 |
| 两棵树按同一读者算出的"最后碰过输入的提交" | 都是 **`1b7d0921`** | 这是最强的那条：deploy.sh 与发布 workflow 算 OCI revision 标签用的就是这个式子，两边同值 ⇒ **从 HEAD 重新 build 出来的那枚镜像，内容输入与 §8.49 验过的那枚同一棵树** |

⚠️ 诚实的边界：唯一会随 HEAD 变的是**打进镜像的 `VCS_REF` 字符串本身**（`scripts/verify-selfhost-stack.sh:168`
传的是 `git rev-parse HEAD`）。它是 `org.opencontainers.image.revision` 这个 LABEL（`server/Dockerfile:217/221`），
**不是内容输入** —— 所以"内容相同、标签字符串不同"。写清这个差别，免得下一轮有人把两枚镜像的标签不一致读成"产物不一致"。

**两处这次查了、确认不是缺口的（登记下来是为了别再重新推导）**：

1. **同一个 OCI 字段有五个生产者**：Dockerfile 默认 `unknown` / compose `${SUPERSYNC_BUILD_SHA:-local}` /
   deploy.sh 与 workflow 都按输入清单算 sha（两边注释里写明"必须逐字同式"）/ `verify-selfhost-stack.sh` 传全量 HEAD。
   这**不是漂移**：`check-image-build-args.mjs:51-55` 把 `VCS_REF` 作为 `DEFAULT_MAY_DIFFER` 里唯一一条登记了理由
   （compose 侧要"人能读懂的 local"，Dockerfile 侧要"没人给值就别装作有版本"），R4 因此对它放行。
2. **外人把两条路径混着跑会不会撞死**：compose 直接 build 出来的那枚标签是 `local`，
   随后 `./scripts/deploy.sh`（不带 `--build`）会不会像 §8.11 那样"照抄必失败"？现量：不会——
   `server/scripts/deploy.sh:238-246` 在 pull 之前就把这种情况做成**响亮失败并点名真修法**
   （`ERROR: 'supersync:local' is not present locally, and heyta publishes no image to pull.`
   → 下一行就是 `First deploy on this machine: ./scripts/deploy.sh --build`）。
   runbook:167 那句行内的 `./scripts/deploy.sh`（不带 `--build`，因而 `check:selfhost-entry-command` 的行首锚定看不见它）
   是一个**片段**而不是断点：它指向 §3 那条带 `--build` 的命令，而即使有人照抄，接到的是上面那条会指路的报错。
   ⇒ 登记这条差别：**"片段没被门禁看见"只有在脚本自己接不住时才是对外错话**；这里接得住。

**我这轮又踩了那条已入档的路径错**（同族第二次，05:4x→06:0x）：判"两份 i18n 表提交了没有"时先用了
`packages/i18n/src/zh-CN.ts` —— 真路径是 `packages/i18n/src/locales/{zh-CN,en}.ts`，错的 pathspec 静默回空，
看起来像"这两枚干净了"。改成先 `git ls-files -- packages/i18n` 拿真名字再判。

**#7 的 06:0x 现量**：那 5 枚重叠文件（`docs/README.md`、`package.json`、
`packages/i18n/src/locales/{zh-CN,en}.ts`、`scripts/check-script-snapshot.mjs`）**全部仍是 `M`**；
main 已走到 `030f0969` ⇒ 载体又过一期（只认分支名不认 SHA 这条纪律不变）。
本轮**没有**重算载体：main 两三分钟前进一笔，而现在重算出来的 SHA 在我写下它的同一轮就会过期，
且真正的阻塞不在 SHA 在那 5 枚文件上 —— 重算留到它们变干净那一刻做。
🔴 **最后这半句在写下几分钟内就被 §8.52 否证**：那 5 枚里今天只有 1 枚真挡路，
而挡路的两枚从没在这张表里。原句留着是因为它错得有价值 —— 它记的是一个**没量过的口径**。

### 8.52 #7 的等待面量错了：真正的阻塞集是 **3 枚**，其中 2 枚从没登记过（06:0x）

上一节那句"重算留到那 5 枚变干净那一刻"本身是个**未量的口径**。这一轮去量，
第一次就把自己算错的地方照出来了 —— 值得原样留下，因为它是"每个数字都合理但集合是错的"那一类。

| 算法 | 得到 | 判定 |
|---|---|---|
| `git diff --name-only main HEAD` | **820** 条路径 | 🔴 **错**：这里面绝大多数是 main 自己新增、本批没有的文件，合并**不会写它们**。拿它去交主检出的脏清单得到 **100 枚"阻塞文件"** —— 一个看起来"根本不可能落地"的假集 |
| `git diff --name-only "$(git merge-base main HEAD)" HEAD` | **33** 条 = 合并真正会写进 main 的路径 | ✅ 这才是枚举源（"本批相对 base 的贡献集"） |
| 33 ∩ 主检出 151 条脏 | **3 枚** | `package.json`、`research/tools/check-image-license-coverage.mjs`、`server/image-npm-tree.json` |
| `git merge-tree --write-tree main HEAD`（只读） | rc=1，冲突面**恰好 1 条路径**（`package.json`，1/2/3 三个 stage） | §8.22 预置的另外五条（`.gitignore` / 三枚 evidence PNG / 本审计文档 add/add / 链）**今天都不触发** |

🔴 **登记的 5 枚里只有 1 枚（`package.json`）今天还挡路**；另外 4 枚（`docs/README.md`、两份词条表、
`scripts/check-script-snapshot.mjs`）本批相对 merge-base **一个字都没改** —— 它们脏是别人的事，
合并既不读也不写。它们一直挂在等待面上，是 §8.16 之后没重算过集合。
而**冒出来两枚从没登记过的**。

**那两枚是本批自己的文件，正被另一条会话在主检出改着**（diff 全文我读过）：

1. `research/tools/check-image-license-coverage.mjs`：`+1` 行，往 `IMAGE_ONLY_PACKAGES` 加
   `@fastify/websocket@11.3.3`，理由写"npm 解析到 2026-10-03 新发布的 11.3.3，已核对发布 tarball 的 package/LICENSE 为 MIT"。
2. `server/image-npm-tree.json`：3 行，把快照里 `@fastify/websocket` 从 **11.3.1 → 11.3.3**、`generatedAt` 刷新、
   `serverPackageJsonSha256` 跟着变。

**成因不是有人动我的东西，是 main 还带着旧版生成器**：`git show main:research/tools/gen-image-npm-tree.mjs`
第 13 行仍写着"用法（**要联网**，它就是在问 registry 要解析结果）"、第 211 行还在跑
`install --package-lock-only` 现解 —— 形状 C（离线读提交物锁）只在本分支。所以谁今天跑 main 那一份，
得到的都是 registry 当下解析的 11.3.3，而 main 提交物里钉着 10-03 07:58 那趟解出来的 11.3.1，
两边对不上就只能手加一条许可登记。**这个 hazard 在落地那一刻自动消失**（落地后生成器读锁，不再现解）。

**落地时这三枚各怎么解（先写死，免得临场重新判断）**：

| 文件 | 解法 | 依据 |
|---|---|---|
| `package.json` | 取**并集**（链），载体脚本自动算 | §8.34 那个"并集从没写回"的洞已修；§8.41 已确认 `"check"` 是一整行 ⇒ 两侧都改才冲突 |
| `server/image-npm-tree.json` | **取本分支** | 本分支 146 条、由提交物锁派生、带 `packageLockSha256`；main 提交物 143 条旧形状，他们改出来的**也还是旧形状**（`inputs` 里没有 `packageLockSha256`）。⚠️ 他们那份落地后会被 `gen --check` 判红，因为它是联网现解的产物 |
| `check-image-license-coverage.mjs` | **取本分支**，且**零信息丢失** | 本分支第 130 行已有同一条 `@fastify/websocket@11.3.3`，还多带"为什么不写 `carrier`"的推理；他们唯一多出来的是那句"已核对发布 tarball 的 LICENSE" —— 这一轮我**自己从真产物里读了那份 LICENSE** 并写进了注释，所以他们的验证不是被丢弃，是被换成可重跑的形式 |

```sh
# 06:08 实测：读的是 05:50 那趟建出来的镜像里随包发布的那份 LICENSE，不是 registry 元数据
docker run --rm --entrypoint sh supersync:selfhost-verify -c \
  'node -e "const p=require(\"/app/node_modules/@fastify/websocket/package.json\");console.log(p.version,p.license)"; head -3 /app/node_modules/@fastify/websocket/LICENSE'
# → 11.3.3 MIT / 正文首行 "MIT License" / Copyright (c) 2017-present The Fastify team
```

🔴 **这两枚的性质和那 4 枚不同，处置也就不同**：那 4 枚是"别人在改别人的文件，等他们提交"；
这两枚是"**别人在改本批的文件**"。按 AGENTS §9 那条，撞车的判据是同一文件的未提交 diff，
不是"某条线在忙"的印象 —— 这种必须**当面协调**（他们提交或还原），不能被动等：
他们的改动若被一次 `git checkout` 或别的批次整文件 `git add` 带走，本批的许可证登记表就少一条
真验证过的项目而**没有任何一层会报红**（§7 里"我 plumbing 提进多人台账的段落会被别人整文件 `git add` 抹回去"那条的反向形态）。

**顺带对自己那条硬约束做了一次自查**（用 `diff --stat` 量，不是回忆）：`packages/shared-schema` 与
`packages/sync-core` 相对 merge-base 各只有 **1 行**，且都是 `"license": "MIT"` 声明
（04:4x 那趟补的"镜像里 manifest 没有 license 字段"）⇒ **没碰 `CURRENT_SCHEMA_VERSION`、线协议、迁移**。

**main 的推进速率**（决定"要不要提前重算载体"的现量）：`030f0969` 05:49:26 → `70ee6868` 06:05:10 →
`05be4729` 06:06:11 —— 最后两笔相隔 **61 秒**。任何"现在算好的 SHA"到落地那一刻必然过期，
所以等待器**只做检测**，绝不在窗口里自动跑 `pnpm check`（`check:ai-e2e` 的前置会 SIGKILL 别人在 4318/4319/3000 上的 dev server）。

### 8.54 G-40⑧ 拆成两半：公开页面那一半实测为 0 可以关，仓库那一半量清了但不是本批能改的（06:1x）

登记原文是「公开仓库里含内部主机 SSH 别名与公网 IP，**且被落地页直链的文档带出**」——一句话里两个命题，
这一轮分开量，结论一个是"可以关"、一个是"确认还在但不是代码问题"。

**先证那个前提**（登记时是继承来的，不是量出来的）：未认证 `GET https://api.github.com/repos/Xaiver03/heyta`
⇒ `HTTP=200`、`private=false`、`visibility=public`。**仓库确实公开**，这条前提成立。

| 载体 | 取法 | 读数 | 判定 |
|---|---|---|---|
| **对外发布的那份产物**（落地页与文档站） | `apps/landing/dist` 共 **95** 个文件，三个 needle 各 `grep -rl` | `ubuntu-jcli` / `windows-pc` / 那个公网 IP **命中 0 文件** | ✅ **那半句"被落地页直链的文档带出"可以关** —— 关掉它的是 G-40③（链接从 `blob/main/<runbook>` 改成与页面同一次构建的站内 `/docs/selfhost/`），当时按"少一个 404"做的，顺带把这条披露路径也断了 |
| **公开的那棵树**（`origin/main`，落后本地 main **76 笔**） | `git grep -l/-h -E <needle> origin/main` | `ubuntu-jcli` **20 文件 / 121 行**；`windows-pc` **36 / 97**；公网 IP **22 / 57** | 🔴 **这半句仍在**，且它是**政策决定不是缺陷** |

🔴 **载体必须写成 `origin/main`，不能写成本分支**：我第一版顺手在分支树上量，得到 57 个文件 —— 那既不是公开的那棵树
（推上去的内容少 76 笔），也不是任何对外可读的对象。**"仓库里有没有"问的是 `ls-tree`，"公开仓库泄露了什么"问的是远端那棵树**。

**"有没有真凭证"这一问是逐行读过回答的，不是靠命中数**（这条纪律在别处叫"needle 命中数不等于违规，要逐行看真值形态"）：

- 高风险形态（PEM 头 / `PASSPHRASE=` / `Bearer <长串>`）在公开树上只剩 **2 行**，两行都是测试夹具
  （`WX_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n...'`、`pem = '…\nABC\n…'`）。
- 凭证类文件名 6 枚，逐一看过：`debug.keystore`（Android **调试**密钥，按约定就是公开物）、
  `generate-release-keystore.sh`（只 echo 变量名，不 echo 值）、`.xcode.env`、两个源码里的 Keystore 桥、一个迁移脚本。
- 所有 `JWT_SECRET=` / `DATABASE_URL=postgresql://…` 命中全是**变量引用、占位符或 compose 的 `${}`**，没有一处内联真值。
- 唯一一处真字面量是 `server/Dockerfile.test:56` 那个固定 e2e secret，而**没有任何构建路径用它**
  （`docker-compose.build.yml:18` 与 workflow `:182` 都是 `server/Dockerfile`）⇒ 它是死重量，
  且**早就在别人的清理清单上**（`docs/runbooks/finlaw-cleanup-candidates.md:303`）—— 所以这里只引不重复登记。

**剩下那半句的归属**：内部主机别名 + 公网 IP 要不要脱敏（或把仓库转私有、或接受）是一个**运维/安全政策决定**，
而它的落点包含 `AGENTS.md` 与 `docs/runbooks/deployment.md` —— 都在本批的禁改区里
（硬约束"不碰 `AGENTS.md` 规则段"）。所以这一条的状态是「**已量化到行、已定载体、待负责人拍板**」，
不是"待办"也不是"已处理"。复量只要一行：

```sh
git fetch origin main
for n in ubuntu-jcli windows-pc '124\.223\.13\.226'; do
  printf '%-22s 文件=%s 行=%s\n' "$n" \
    "$(git grep -l -E "$n" origin/main | wc -l | tr -d ' ')" \
    "$(git grep -h -E "$n" origin/main | wc -l | tr -d ' ')"
done
# 公开产物那一侧（期望恒为 0）：
grep -rl -E 'ubuntu-jcli|windows-pc|124\.223\.13\.226' apps/landing/dist | wc -l
```

⚠️ 一条不要把这条读大的话：**公网 IP 本身不是秘密**（`heyta.waytofuture.cn` 公开解析到它，任何人都查得到）。
这条的实际披露内容是**"那台机器用什么登录用户名、跑着哪些容器、另一台打包机叫什么"**这类内部拓扑 ——
它降低的是攻击者的侦察成本，不构成凭证泄露。按这个严重度拍板，比按"泄露 IP 了"三个字拍板更接近事实。

### 8.53 G-51 欠的那半个正面读数：配方已在仓内，但它那条读数没有载体，只能当方法用（06:1x）

写探针之前先按"仓内可能已有现成装置"这条纪律 grep，结果**中了一整条**：
`docs/plans/multi-platform-widgets-progress.md` **R39** 已经跑过一次 `beforeinstallprompt`，
并把两个坑踩平了：

1. 🔴 **监听必须装在"任何页面脚本之前"，不是"导航之后 N 秒"**：R39 第一版在 `Page.reload` 之后 6 秒才
   `Runtime.evaluate` 装监听 ⇒ 读到 `捕获: NO`，长得像"Edge 不支持/不触发"。
   真因是 **BIP 在页面加载过程中就 fire 了**，那 6 秒里事件已经过去、事件对象也没存。
   修法是 `Page.addScriptToEvaluateOnNewDocument`（Playwright 侧对应 `context.addInitScript`，且必须在 `goto` 之前）。
   修完立刻 `捕获: YES`。R39 自己把这条归进那一族第四次：**"没观测到 ≠ 没发生"**，与 §7 元规则 1 同一条。
2. 🔴 **只观测事件，绝不 `prompt()`**：R39 捕到之后调 `window.__bip.prompt()`（带 `userGesture: true`），
   **那一行结果没写进文件、脚本挂住** —— 与它 R34 那条 `Notification.requestPermission()` 同一个形状
   （浏览器级对话框无人交互不 resolve），而 BIP **没有"预授权"对应物**，它的整个意义就是弹那个框。
   ⇒ 我这一测的判据只能写成"事件有没有 fire / `event.reason` 与 manifest 解析结果"，
   **不能**写成"用户点得到点不到"。

⚠️ **但 R39 不能直接拿来当 G-51 的证据**：那条记录**没写被测载体**（整节里没有 URL/origin/构建形态），
我按"引用 N 项要带哪一趟"回查过原文与仓内脚本（`__bip` / `addScriptToEvaluateOnNewDocument` 在仓库里只有文档那两处，
探针本体是当趟的临时 CDP 脚本，没落进仓）⇒ **它证的是"Chromium 系在这个站点上会 fire"，站点不明**。
所以本轮的处置是：**方法复用，读数作废重取**。这不是 R39 写错，是它的结论本来不需要载体 ——
需要载体的是我这一条（要回答的对外承诺绑在 heyta 的 `/app/` + 同意闸门 + `/app/` scope 的 SW 上）。

**窗口开着时这一测该怎么做（已预解两个坑，逐条可执行）**：

| 步 | 做法 | 判据 |
|---|---|---|
| 载体 | 起自托管全栈，用**回环**地址访问 `/app/`（`localhost` 是 trustworthy origin，装入口的必要条件之一才不会被"其实是 HTTP LAN IP"污染） | 页面标题 + `navigator.serviceWorker.getRegistration().scope` 必须打出 `…/app/` |
| 三档 | ① 全新 context（不点任何按钮）② 点界面上那个**「只用本机」** ③ 点**「同意并联网」**（与 `selfhost-web.spec.ts` 的 `openApp()` 同一个动作，不另造） | 每档各自一趟、互不共享存储 |
| 观测 | `addInitScript` 里 `addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__bip = {fired: true, props: Object.keys(e), platform: e.platform, amount: e.availableAmount} })`，之后 `goto`，再轮询 `__bip` | ⚠️ **属性用"把事件对象自己可枚举的东西全打出来"这一式，不写死字段名**：现行 `BeforeInstallPromptEvent` 上是 `platform` / `availableAmount` / `userChoice` / `prompt()`，早期提案里那个 `reason` 我**没在这一趟里验过**，写死它就是在配方里塞一条未证的东西。①② 预期**没有** SW（生产者侧已量：同意前 `registerServiceWorker` 调用数 0）⇒ 这两档 BIP 不 fire 是**结构性的**，不是产品坏；③ 是唯一能给正面证据的一档 |
| 截图 | 三档各一张，落在固定路径，**人打开看过**（§6.2 规定一） | 图里要能看出同意面板的状态 |

🔴 本轮**没有**把这套写成 spec 文件，理由是：跑不了的判据丢进 `e2e/` 会被别人 config 的 glob 收走，
给别人埋一次红（且违反"判据必须与它约束的改动同批落地"）。它现在只以这张表存在，
落地那一刻与词条改动、`live-site` 那条新判据**同一次**变成文件。

**当下状态不变**：G-51 仍是"已判定、补丁已备好、待表空出"，措辞按 §8.50 那版走
（它预设"点一次同意就能装成应用"——若 ③ 档测出来是不 fire，这句还要再退一步，
退到只承诺"离线可用 + 数据在自己浏览器里"那两条已被直接证过的）。
⚠️ **06:5x 这条 caveat 被启用**：那个"若"没有等到读数 —— 两条无人值守通道都被证明没有判别力（§8.57），
所以补丁换成 **v2：整条安装承诺摘掉**，并把"离线"写成有载体的那一档（离线队列两条用例）。原文留原位。

**06:1x 的环境读数（为什么这一测今天没跑）**：`vm.loadavg` 1 分钟位 **32.11**、5 分钟位 16.14，
容器列表为空（05:50 那趟已收），`:3000` 与 `:3100` 各有别人的 node 在听 —— 按目标那句
"负载 >12 属环境无效，等窗口而不是调低阈值"，这一测属于**该等**的那一档，不是能做的那一档。

## §8.55 · 06:3x 「别人在改我批的文件」读到底：同一条漂移的第二份独立取证，但它跑在旧载体上

先给现量：本轮复量里 `main` 换了两次手（`dc63cbff` → `f9d150e5`，间隔不到两分钟），
写集仍是 33 枚、阻塞仍是 3 枚 —— 与 §8.52 那张表同一批名字：
`package.json`、`research/tools/check-image-license-coverage.mjs`、`server/image-npm-tree.json`。

### 🔴 先记一条我自己刚犯的探针错（它把 3 量成了 27）

我手敲的未跟踪桶用了 `git ls-files -co --exclude-standard`，量出 `脏=3226 / 阻塞=27`。
**`-c` 在 `ls-files` 里是 cached（已跟踪），不是"未跟踪"** ⇒ 那一列其实是"全仓文件"。
可疑点当场就该抓到：那 27 枚里躺着 `server/Dockerfile` 和本审计文档自己。
改成 `--others` 之后是 `未跟踪=40 / 脏合算=164 / 阻塞=3`，与等待器的读数逐字一致
（它写的本来就是 `ls-files --others --exclude-standard`）。

⚠️ **这不是说 [`AGENTS.md`](../../AGENTS.md) §7 第 82 条里那条 `git ls-files -co --exclude-standard` 打 tar 的配方坏了** ——
那个用途要的正是"已跟踪 + 未跟踪非忽略"＝整棵源码树，`-c` 在那里是对的。
错的是我把一条命令从它的原问题里摘出来复用到另一个问题上。
**可迁移的形状：复用别人（或自己）写过的命令行时，先回去看它当初在回答哪个问题**；
而"阻塞数从 3 跳到 27"这种量级跳变，第一反应应该是查探针，不是查现场。
（待入 `docs/reference/environment-traps.md` —— 那枚文件在主检出是 `M`，按 §8.51 的做法先登记在这里。）

### 两枚阻塞的真相：不是撞车，是第二条取证路

| 文件 | 他人工作树里的差量（现量） | 与我分支的关系 |
|---|---|---|
| `check-image-license-coverage.mjs` | **+1 行**：`'@fastify/websocket@11.3.3': MIT`，`why` 写"已核对发布 tarball 的 package/LICENSE 为 MIT" | 同一枚条目、同一个 MIT 判定**已提交**在我分支；我的取证取自**镜像产物里随包发布的 LICENSE** |
| `server/image-npm-tree.json` | 重生成 `generatedAt=2026-10-03T18:35:38Z`，3/3 行 | 我那枚是 `21:19:36Z`，且 inputs 里带 `packageLockSha256` |

差别不在内容，在**载体**。他那份是 main 上**旧生成器（联网版）**的产物：
`git show HEAD:research/tools/gen-image-npm-tree.mjs | grep -c packageLockSha256` = **0**（我分支 = **3**），
他快照的 `_what` 仍是"经 npm 解析出来的依赖树快照"，我的已是"由提交物锁推导"。
去时间戳后两份快照有 5 处不同，其中 3 处正是这个形状差（`packageLockSha256` 一行、`_what` 一行），
2 处是输入哈希差（`server/package.json` 与两枚本地包 —— 因为我的分支里那两枚各自 +1 行 `"license": "MIT"`，
见 §8.52 的自我审计）。**所以这不是两条线各做一个更好的版本，而是一条线在把 G-47 之前的形状重新生产一遍。**

### 谁该赢不由我说：注入验证过了

把他那份快照灌进我的树跑 `pnpm check:image-license` ⇒ **RC=1，4 处失真**：

```
- server/package.json 变了（快照里的 serverPackageJsonSha256 与当下不一致）
- server/package-lock.json（镜像那棵树的钉子） 变了（快照里的 packageLockSha256 与当下不一致）
- packages/shared-schema/package.json 变了 —— 快照哈希 a363b0c66f50… ≠ 当下 3f21a18ae57c…
- packages/sync-core/package.json 变了 —— 快照哈希 260741f66829… ≠ 当下 657cd7991fb4…
```

还原后 `git status --porcelain` 对该文件 **0 行**；本轮我那份快照 `check:image-license` **rc=0**。
**⇒ 合并若取他那份，载体上的门禁立刻红；取我这这份绿。** 这就是 §8.52 那张逐文件解法表里
两枚 `取分支` 行的机制依据 —— 不是偏好，是**旧载体的产物在新判据下自证失真**，
而那条判据（`gen --check` 比对输入哈希）本来就是为了这件事才加的。

**信息损失已清零**：他 `why` 里那条**第二取证路（发布 tarball 的 `package/LICENSE`）**是我原先没有的证据
（我只手边那一路：构建好的镜像里的 LICENSE 文件），已并进我分支该条目下面的注释块
（`research/tools/check-image-license-coverage.mjs`，"署名 `Copyright (c) 2017-present The Fastify team`"
之后那 4 行，写明另一条会话线独立核过并点明"该登记在人家工作树里尚未提交"）。
落地取我这一份时，他这次的**发现**继续活着，被取代的只有时间戳和旧 `_what` 措辞。

### main 此刻对这条 npm 漂移没有防御 —— 但我不把它写成"必红"

`git show HEAD:research/tools/check-image-license-coverage.mjs | grep -n websocket` = **0 行**
（连注释都没有），同趟阳性对照列出该文件在 main 上真有 14 条 `IMAGE_ONLY` 登记
（`@fastify/static@10.1.5`、`ws@8.22.0`、12 条 `@peculiar/*`）。
含义写准：**`@fastify/websocket` 的防御只活在我分支和另一条会话的未提交改动里。**
⚠️ 但"main 现在红不红"不是这一段能主张的 —— 它取决于 `gen --check` 在干净树上重解析到 `^11.3.0`
里的哪一枚，那是**下一条要量的事**（要跑就得在 main 的干净 linked worktree 里跑，不在混合树上读）。

#### 06:3x 追这条时先量到的那一半，和明确量不到的那一半

临时 detached worktree（`/tmp/heyta-main-license-855` @ `main`，用完已 `worktree remove`）里，
**不需要依赖**的那两条当场就有读数：

| 现量 | 读数 |
|---|---|
| main 那份已提交快照里的 `@fastify/websocket` | **11.3.1**（`11.3.3` 命中 0） |
| main 那份登记表里的 `websocket` | **0 行** |

⇒ 于是"main 现在到底红不红"有了一个**比"大概红"准确**的答案形状：
**main 今天是绿的，而它绿的原因正是这条缺陷本身** —— 那枚快照生成于 11.3.3 发布（2026-10-03）**之前**，
钉在 pnpm store 里就有的 11.3.1 上，所以覆盖判定挑不出毛病；
**只要任何人重生成一次快照**（联网那一步），解析就会跳到 11.3.3，而登记表里没有它 ⇒ 立刻红。
另一条会话恰好就是这么撞上的：他们工作树里那份 18:35Z 的快照**含 11.3.3**，
配上那枚 +1 行的未提交登记 —— **那份登记不是"顺手多加一条"，是一次已经发生过的红的手术记录。**

量不到的那一半也写清楚：`check-image-license-coverage.mjs` 在干净 worktree 里 **RC=1，
但红在"找不到任何 pnpm store"**（它按 `node_modules/.pnpm` 定位扫描集，判红而不是跳过 —— 这条门禁自己的行为是对的）。
所以"11.3.1 这一份在带依赖的干净树上是否 rc=0"我**没有**量到，不写成结论；
要量的话得在那枚 worktree 里正经 `pnpm install` 一份自己的 `node_modules`
（**不能软链主检出那份** —— 已入本机记忆：软链会让 pnpm 试图 purge 共享树）。
这个成本值不值，等落地窗口到了再判，不在这里替它承诺。

### 落地解法表（06:3x 现量：`main=f9d150e5`、写=33、阻塞=3）

| 阻塞文件 | 谁的手 | 落地时的解 | 机制依据 |
|---|---|---|---|
| `package.json` | 他人（4/2 行未提交） | 单行 `check` 链**联合** | 合并脚本 pkg 族 + §8.16 |
| `research/tools/check-image-license-coverage.mjs` | 他人未提交 = 我分支同判定的第二取证路 | **取分支**（且他的发现已并进来） | 本节的注入 RC=1 那一组 |
| `server/image-npm-tree.json` | 他人重生成于旧载体 | **取分支** | 同上 |

### 环境读数（06:30 前后）：`vm.loadavg` 1 分钟位 **11.54**（<12），`docker info` OK

窗口确实开过，而**没有**用它起 `verify:selfhost-stack` —— 该项已在 §8.49 拿到 `VERIFY_EXIT=0`
并在 §8.51 钉在当前产物上（#12 已闭合）。此刻重跑只会拿到一个"main 又前进 20+ 枚之后"的新读数，
而它属于落地**之后**与 #8 `reinstall:all` 同一时机该做的事，不是现在该烧的窗口。

## §8.56 · 06:4x 落地路径上抓到一个会**静默删掉别人已提交内容**的解法，并把它换掉

这节记的是 #7 本身的一个缺陷，不是又一次读数刷新。**旧规则不背"丢了"的锅，但它也落不了地。**

### 现场：main 刚被另一条会话提交进一整节，而我的载体脚本写的是"取本分支侧"

`main` 的 `05be4729`（06:06）往 `docs/research/self-host-distribution-audit.md` 追加了整节
`## 9. 交还一条现场：reinstall:all 的 mac 段不是"慢"，是不朽`（相对 merge-base **+70/−0**，55 条非空行）。
而 `research/tools/selfhost-merge-carrier.mjs` 对这一族的预置解法是 **取本分支侧**，
配一条"若 main 有额外的节就 die"的守卫。

⇒ 守卫今天真的会响（所以不是一次已发生的事故），**但它的产出是"落地停下来"**，
而这条冲突今天必撞、明天也会必撞：追加型台账两侧都往尾巴写。
**只 die 不解决的判据，最后会被落地那一刻的人手工摘掉** —— 那才是真正的丢内容路径。

### 新解法：并集，且判据方向必须对

抽成单一所有者 `research/tools/selfhost-audit-union.mjs`（`unionAudit` / `unionAuditVerdict`），
载体脚本只取三份文本、写盘。产出 = 本分支那份（含本批自己的改写与删除）+ main 侧
"`base` 里没有、本分支里也没有"的行，前面盖一条 HTML 注释哨兵标明下面这块不是本批写的。

🔴 **第一版把断言写错了方向，是 control 臂自己照出来的**：我写的是
"main 那份的**每一个非空行**都必须活在产出里"。跑 control ⇒ **红在"丢了 main 侧 24 行"**。
那 24 行是什么？是**本批自己改写掉的基线行**（`base→本批 = +1716/−24`），
第一条就是台账里 G-40⑧ 那一行 —— 我改了它的措辞，旧行自然不在了。
所以那条断言会把**任何一次合法的改写**判成"吞了别人的内容"，
它的实际后果不是"更安全"，而是"落地时有人会把断言删了"。
改成按方向问：**必须活的是"别人新增的行"**（`mainOnly`），
基线上被本批改写掉的单独数一条 `droppedBase` 报出来、不判红。

### 六臂变异读数（control 用今天真实的三份 blob，变异只打在模块的一次性副本上）

```
三份行数 base=1812 main=1882 本分支=3504   merge-base=b850b1c6
control-real      OK  verdict=null  mainOnly=50 srcOnly=1289 droppedBase=24 extraMainHeadings=1
control 保两边标题 OK  产出同时含「## 9. 交还一条现场」与「§8.55」
本批改写基线行不判成丢内容 OK  droppedBase=24 而 verdict 仍 null
control-noextra   OK  main==base ⇒ mainOnly=0、产出逐字等于本分支那份
take-branch       OK  摘掉"保留 main 新增"那一半 ⇒ 红在「丢了 main 侧新增的 50 行」
take-main         OK  反向择一 ⇒ 红在「丢了本分支侧 1289 行」
invented          OK  注入一行两侧都没有的 ⇒ 红在「混入了两侧都没有的行 1 条」
marker            OK  注入 <<<<<<< ⇒ 红在「仍含冲突标记」（标记那条先判）
no-assertion      OK  把 verdict 摘成恒 null ⇒ 前四臂形状全部不红，证明红来自断言而不是模块崩
```

`mainOnly=50` 而不是 74：74 是"main 相对**本分支**的独有行"（含那 24 行我改写掉的基线），
50 才是"main 相对 **base** 的新增"。⇒ **同一个"独有行"，基线选错就换一个数**，引用它必须带基线。

### 另加一条结构层通式，并当场纠回一次我自己的旧错

`ownershipVerdict`：`diff(main, 载体树) ⊆ diff(merge-base, 本分支)`。越界那一枚就是
"这笔合并动了本批从没写过的路径"。三臂（子集 ⇒ ok、多一枚别人的 ⇒ 抓到、写集放大也照样抓到）全过。

🔴 第一次跑它我把基线写成 `merge-base(main, 载体)` —— 载体第一父就是 main，所以那个 merge-base
**恰是 main 自己**，写集退化成 `diff(main, 本分支)` = **820 条**，`⊆` 近乎空洞成立。
这正是 §8.52 记过的那条 820/33 的错，**我在写下那节的三小时内又复犯了一次**，
所以判据本体里现在写着"基线只能显式用 `baseSha`"。
用正确基线的现量：**写 33 枚 / 合并相对 main 改 33 枚 / 集外 0 / 写集里没被改到 0** —— 双向恰好，
这是"不吞并行会话改动"最硬的一种形状（不是"我承诺没动"，是"树与树比出来只动了这些"）。

### 载体已按新解法重算两趟（都 RC=0）

| 趟 | 载体 | = | 结果 |
|---|---|---|---|
| 1 | `00d2e6dc` | main `33aa63e9` × 分支 `d7bb75a6` | 五道纯 fs 门禁 exit 0；文档里 §9 命中 1、§8.55 命中 1、冲突标记 0；**§9 那 55 条非空行逐条在** |
| 2 | `9623463d` | 同上 | 带上新加的归属通式那条，仍然 exit 0 |

⚠️ 载体仍然**不是** main 的推进，且 main 每前进一步都要重跑（`node research/tools/selfhost-merge-carrier.mjs`）。
落地仍然等 §8.55 那 3 枚阻塞。§8.52 那张"逐文件解法表"里审计文档那一行从今天起改成
**并集**（原来写的是"取本分支 + 有额外的节就 die"）。

## §8.57 · 06:5x G-51 那半个正面读数：**这台机器上的自动化通道答不了这个问题**，于是措辞补丁去掉整条安装承诺

§8.50 备好的那句补丁（`site.platforms.web.body` 改成"点一次「同意并联网」就能装成应用"）
自己留了一个 caveat：**它仍然预设"能装"**。所以不能先落它再补读数 —— 那等于把一句可疑话换成另一句可疑话。
这一轮把正面读数去拿，结果是否定的，且否定得很有内容：

### 两条通道各自的失败形状（都不是"产品装不了"的证据）

| 通道 | 现量 | 为什么没有判别力 |
|---|---|---|
| 无头 Chromium（`headless:true` 与 `channel:'chromium'` 新无头两种） | 对**教科书级控制组**（`/tmp/pwa-ctl/`：合法 manifest + SW 控住 scope + 192/512 图标 + 回环 HTTPS 等价的 trustworthy origin）也 `fired:false` | 控制组不 fire ⇒ 任何"heyta 不 fire"都读不出产品结论（§8.53 已记） |
| 有头但**后台**（`open -g -n -a <Playwright 那份 Chromium>` + CDP 附着） | CDP 起来了（`Browser=Chrome/153.0.8010.12`，身份门过），但 `page.goto` 30s 超时；对那棵实例复连时 `connectOverCDP` 在 `<ws connected>` 之后超时 —— 浏览器连上了却不回话 | 这是一台**负载 20+ 的机器上的后台浏览器实例**的环境形状，不是安装性结论。控制站自己完全活着（`curl` 回 HTTP 200 / 0.0009s） |

第三条路（`chromium.launch({headless:false})` 不起 `-g`）**故意没走**：那会把窗口抢到前台，
而 `AGENTS.md` §6.2 规定二是硬约束。探针全程带前后前台应用对照，四次读数都是
`FOCUS_BEFORE=ChatGPT / FOCUS_AFTER=ChatGPT`（没抢到），收尾按 profile 逐 pid 只杀我自己起的
（残留 0、profile 目录 0、控制站端口已放）。

⇒ **结论的形状变了**：这一条不再是"欠一个读数"，而是"这个读数在本机的无人值守通道下拿不到"。
与小屏那条线 R39 的独立结论同形：**PWA 安装在浏览器模型里就要求一次真人点击，
能自动验的是"装完之后"的一切**。

### 于是补丁不再"加条件"，而是**摘掉整条安装承诺**，并把"离线"改成有载体的那一档

逐条查了载体系（这半句是新增的工作，不在 §8.50 里）：

| 对外话 | 有没有判据载体 | 现量 |
|---|---|---|
| 「可安装 / Installable」 | 🔴 没有，且两档下结构性不成立（同意前 `registerServiceWorker` 调用数 0，§8.50），第三档正面读数拿不到 | 摘掉 |
| 「可离线用 / works offline」——读作"断网照常读写、恢复后补传" | ✅ 有 | `apps/web/tests/e2e-sync.integration.spec.ts:228`「离线队列：断网时写入不丢，恢复后重放成功」、`:301`「离线合并：A 断网改 + B 在线改」 |
| 同上的另一种读法"断网时应用本身还能打开（静态资源被 SW 缓存住）" | 🔴 没有 | 全仓 `setOffline` 只命中 1 枚文件，且那是集成夹具自己定义的旋钮（`:626`），**没有一条用例真去断网 reload** |

补丁 v2（中英同步，沿用界面与落地页已有的词，不新造说法）：

```
zh 'site.platforms.web.body':
  完整产品，不是演示。断网也能照常记，恢复后自动补传；数据就存在你自己的浏览器里。
en 'site.platforms.web.body':
  The full product, not a demo. It keeps working when you are offline and syncs when the
  connection returns — your data lives in your own browser.
```

同批要一起落的判据（§8.20 的纪律：不提前挂"当场就红"的门禁）：
`e2e/live-site` 里断言 `site.platforms.web.body` **不含**「可安装 / Installable」，
并挂一条**阳性对照**用现行 `landing.capabilities.offline.body`（它已含"断网照常读写…自动补传"），
变异臂 = 把「可安装」放回去 ⇒ 必须红。

### 动那两枚表的代价这次是量过的，不是估的

- 表仍被占：`packages/i18n/src/locales/{zh-CN,en}.ts` 在主检出都是 ` M`（2 枚）。
- 🔴 **但它们没碰同一条 key**：别人这次未提交的 diff 里
  `platforms.web.body|可安装|Installable` 命中 **0**。
  ⇒ 落地的真实代价是**"等他们提交"从 3 枚涨到 5 枚**，不是"造一次三方冲突"——
  不同 hunk 的同一文件 git 会自己并；只有真撞上同一行才需要给载体脚本加第五族（今天它不在预置四族里，会响亮 die）。
- 所以顺序钉死：① 等表提交 → ② 本批同时改两份表 → ③ `pnpm gen:entries` + `pnpm check:entries`
  → ④ 上面那条 live-site 判据与变异臂**同批** → ⑤ 与 #19/#20 那次落地页重发合并成同一次发布。

**G-51 的状态从「已判定、补丁已备好、待表空出」改成「已判定、补丁 v2 已备好、待表空出」**：
措辞不再预设安装性；正面读数在本机无人值守通道下**已证拿不到**，它不再是这一单的待办，
而是一条要装给真人才能收的口（要收就请产品负责人在浏览器菜单里装一次，那是用户的动作、不是可自动化的一步）。

## §8.58 · 06:5x 把 §8.49 那次全跑的读数**重新钉到 `34e29aaf`**，并记下钉法上的一条探针错（集合相等看不见目录条目）

§8.51 那套钉法有保质期：本批之后又落了 11 枚提交。按同一式重量的结果 —— **仍然钉得住**：

| 现量（`cd server && . scripts/image-inputs.sh`） | 读数 |
|---|---|
| 清单条目数 | 22（含 1 条 `.` 与 12 条 `../packages/*` 这类**目录**条目） |
| `a70b0ef8..HEAD` 的提交数 | 11 |
| 其中碰过镜像输入的 | **0**（`git log … -- "${ARR[@]}"`） |
| 改动文件里过 pathspec 的 | **0**（`git diff --name-only a70b0ef8..HEAD -- "${ARR[@]}"`） |
| deploy.sh 同式算出的 revision | 两棵树**都是 `1b7d0921`** |

⇒ item 2 那条 `VERIFY_EXIT=0` 的读数在 `34e29aaf` 上仍然"属于当前产物"，
依据与 §8.51 同一条：镜像的 22 条内容输入自那趟之后一个字都没动，随 HEAD 变的只有标签字符串。

### 这一轮的阳性对照比 §8.51 那条更强，而它一上来就先照出我自己的错

我这次重跑图省事，把 22 条清单**归一化成根相对路径后做集合相等**去筛 `git diff --name-only`，
得到"交集 0"。但对照一跑就露馅：`1b7d0921` 明明改了 `server/Dockerfile`、
`server/package-lock.json`、`server/image-npm-tree.json` 三枚输入，集合相等却报 **0** ——
因为清单里躺着的是 `.`、`../packages/i18n` 这种**目录条目**，
字符串相等永远不会把 `server/Dockerfile` 认成 `.` 的孩子。
**那个 0 是空洞的 0。**

🔴 正解只有一条：**把清单原样交给 git 当 pathspec**（目录语义由 git 负责），
这也是 `deploy.sh:132-136` 与 workflow 一直在用的那一式 —— 所以"用清单自己的读者"不只是
避免抄第二份清单，**还包含不要自己重写它的比较语义**。
补上的对照因此是两层：

| 对照 | 读数 | 它证明什么 |
|---|---|---|
| 同一条 `git diff --name-only 1b7d0921^..1b7d0921 -- "${ARR[@]}"` | **3 个文件** | 这条 pathspec **有能力命中**，于是现量那个 0 不是恒 0 |
| §8.51 原来那条（去掉 pathspec 回 4） | 仍成立 | 只证明"diff 非空"，**证明不了筛的东西对**——所以我这次换了更直接的一臂 |

⚠️ 可迁移：**"用集合相等去实现一个本该交给 git 的判定"** 是这一族假绿的第 N 种面目 ——
它和 §7 第 89 类（`comm` 前没排序）、"值对得上不等于它就是那个角色"同一个根：
**判据的比较语义必须交给拥有该语义的那一层**（目录包含交给 git / 排序交给 `sort` / 版本交给锁文件）。
（待入 `docs/reference/environment-traps.md` —— 该文件在主检出是 `M`，取号按收口当时的**工作树**现量，
与本节上面那条 `git ls-files -co` 的一并 transplant。）

### 8.59 G-54：main 那一笔把**镜像构建本身**打死了，而 `pnpm check` 全绿（07:2x，载体侧现量照出来的）

这一条不是"载体上多一道红要处理"，是**外人一条 compose 起全套这件事在此刻不成立**。
发现路径很偶然：§8.55 之后我第一次把链里"纯 fs 那一段"搬到**没有 node_modules 的合并载体**上跑，
想给 #1 的关闭判据攒一份逐段归属读数 —— `check:image-license` 在其中报了一处失真：
`server/package.json 变了（快照里的 serverPackageJsonSha256 与当下不一致）`。
顺着这一条往下挖，底下压着的是一枚构建期炸弹。

**① 机制（实测，不是推理）。** main 侧 `b3397cda`（`feat(server,app-host,web,mobile): vault/E2EE 密钥生命周期与找回（ADR-0050）`，
2026-10-03 23:58）往 `server/package.json` 的 **devDependencies** 里加了三枚只存在于本机 pnpm 工作区的包：
`@heyta/app-host` / `@heyta/storage` / `@heyta/sync-client`，值都是 `"*"`。
🔴 **npm 在 `--omit=dev` 下仍然会解析 devDependencies 的每一枚 spec** —— 它不装它们，但它要先**解**它们；
registry 上这三个名字是 404 ⇒ 生产阶段那条 `npm install` **在装第一个包之前就死**。
而 `dependencies` 那一档的三枚 `@heyta/*` 之所以一直没炸，是因为 Dockerfile 先把三枚 tgz COPY 进生产阶段、
再在**第一条** install 里把它们作为实参给出（`server/Dockerfile:286`），npm 就地满足、不去 registry。
devDependencies 没有这条供给路径，也没有"就地满足"这个选项。

**② 鉴别实验（用镜像同款 npm，不是本机那一版）。** 本机是 npm 10.9.4，运行时镜像是 `node:24-alpine` ⇒ npm **11.19.0**，
跨大版本在 dev 解析上完全可能不同，所以两版都跑了：

| 臂 | package.json 形状 | 第一条 install（三枚 tgz） | 第二条 install（裸） |
|---|---|---|---|
| A 现状（= main 那笔之后） | 3 枚 `@heyta/*` devDep | **rc=1 `code E404 … GET …/@heyta%2fapp-host`** | rc=1 同 |
| B 装之前先 `npm pkg delete devDependencies` | 同上 | **rc=0**（`added 4 packages`） | rc=0 |
| 反证（同锁、同镜像，去掉那三枚 devDep） | 无 | rc=0 | rc=0 |

两臂在 npm 10.9.4 与 11.19.0 上同形。三枚生产依赖用**桩 tarball** 供给（这里问的是"npm 会不会去 registry 取 dev 那一档"，
桩不影响这个问题）；第一臂还顺手抓到我自己一次 harness 缺陷 —— 桩产物名是 `heyta-domain-1.0.0.tgz`，
而 Dockerfile 找的是 `./domain.tgz`，于是两臂**都** rc=254、看起来像"fix 无效"。文件名对不上不代表机制不成立。

⚠️ **边界（别读多）**：我**没有**在 main 那棵树上跑过一次真 `docker build`（要 10+ 分钟和一个低负载窗口）。
上面那三行是"按生产阶段原样的两条命令 + 同款 npm"级别的证据；
真构建那一层的证据落在**带修法的那一趟**（载体重算之后跑 `verify:selfhost-stack`，见下面"还欠的"）。

**③ 修法落在哪：落在我们这一侧，而且不改他们那笔。** 他们往 devDeps 放这三枚是**对本机 `pnpm test` 正确**的改动；
错的是"镜像构建会读到同一份 package.json"这件事没人想过。所以修法是在生产阶段装依赖之前把它摘掉 ——
`server/Dockerfile` 的 install RUN 加**第一步** `npm pkg delete devDependencies`：
不改变装出来的任何东西（`--omit=dev` 本来不装 dev 包；`prisma` CLI 仍由那条点名的 install 供给），
只改变"这一层能不能建成"。它是本批自己的文件，动它不需要谁同意；动他们的 `server/package.json` 需要。

**④ 顺带修掉的那件"红得没道理"的事（同一个哈希的两头）。** 新鲜度判据原来哈希的是
**整个 `server/package.json` 的字节**，于是 main 那一笔里连 `scripts` 的 vitest 清单也算"快照过期"——
而 `image-install-shape.mjs` 文件头早就写着它对 Dockerfile 的正确立场：
"只哈希装东西的那几行，否则改一行注释就会让快照看起来过期，而那种红灯教不会任何人任何东西"。
**同一个道理当时只落在了 Dockerfile 那一侧。** 现在两处都归一个所有者：
`readServerInstallInput()` 按**显式分区**取哈希（`TREE_AFFECTING` = dependencies / optionalDependencies / overrides /
peerDependencies / bundleDependencies；`INERT` = scripts / name / engines / … 各带一句为什么），
而**没被判定过的新顶层字段直接红并点名**（默认值必须是"要人回答一次"，不是"悄悄算进去"或"悄悄不算"）。
`devDependencies` 的惰性写成**有条件的**：条件就是第 ③ 步那条 RUN 在场，由 `prunesDevDependencies` 现读 Dockerfile 判定；
**不在** ⇒ 这一档自动挪回被哈希的集合。键名跟着换（`serverPackageJsonSha256` → `serverInstallInputSha256`），
`--check` 里另加一条"钉的还是旧键"的点名，免得换代变成一次看不懂的红。
两个消费者（生成器 + 对账）现在共享这同一份判断 —— 这条改动本身的正当性不需要各证一遍，
需要证的是**分区表有分辨力**（下面第 ⑥ 点）。

**⑤ 重生成是零行为变化的，而且是量出来的。** `node research/tools/gen-image-npm-tree.mjs` 重跑之后：

| 量 | 读数 |
|---|---|
| `packages` 逐字节相同 | **true**（146 条 / 146 条） |
| `inputs` 缺键 | 只有 `serverPackageJsonSha256`（旧键，故意不保留） |
| `inputs` 新键 | 只有 `serverInstallInputSha256` |
| `inputs` 里值变了的其它键 | **0** —— 第 ③ 步那句 Dockerfile 改动**没有**动 `installShapeSha256`（它只哈希 install 那几条，`npm pkg delete` 不是 install） |

`check:image-license` 三条腿在分支上复跑全 ✅；四个邻居 `check:image-build-args` / `check:script-snapshot` /
`check:gate-wiring` / `check:selfhost-entry-command` 各 rc=0（`pnpm` 未报 ELIFECYCLE）。
🔴 那条 `rc=` 打空的老账又踩了一次：这次是 zsh 下 `${PIPESTATUS[0]}` 为空 —— 判绿只认 rc 与 summary 行，见 §7 第 45 条那一族。

**⑥ 变异台：10 臂 / 12 条判定，`bad=0`**（`/tmp/g54-arms.mjs`，全部在 `/tmp` 的一次性副本里做，
收尾逐路径打 `git status` 证明工作树只剩我自己改的 6 枚）。其中三臂是**这次改动的目的**，期望值是**绿**：

| 臂 | 期望 | 读数 |
|---|---|---|
| control（原样） | 两个脚本都绿 | ✅ rc=0 ×2 |
| 5a-1 删掉 prune 那一步 | contract 红 | ✅ rc=1，点名"第一条 install 之前" |
| 5a-2 把 prune 挪到所有 install **之后** | contract 红 | ✅ rc=1 —— 判的是**步骤顺序**，不是"文件里出现过这句话" |
| 5a-3 只在注释里留着那句话 | contract 红 | ✅ rc=1 |
| 5b-1 声明照旧但摘掉 domain 那枚 tgz 的 COPY | contract 红 | ✅ rc=1，点名 `@heyta/domain（应在 packages/domain）` |
| 分区-1 只改 `scripts` 一个字符 | 快照**不该**再判过期 | ✅ rc=0（旧判据在这里必红 —— 这正是载体上那一处失真） |
| 分区-2 改 `dependencies` 的范围 | 必须红 | ✅ rc=1 |
| 分区-3 加一个没判定过的顶层字段 | 必须红且点名 | ✅ rc=1，点名 `heytaMystery` |
| 分区-4 **复刻 main 那一笔**（devDeps+scripts） | 快照绿 **且** 5a 仍绿 | ✅ rc=0 ×2 |
| 分区-4b 同一份 package.json，但把 prune 摘掉（= main 当下那棵树） | 必须红 | ✅ rc=1，消息里带着 E404 那一手 |

⚠️ 第一版的 5b 臂我用的是"往 dependencies 里加一枚 `@heyta/ui` 不供货" —— 它**确实**红了，
但红在第 4c 腿（"锁的根条目与声明互相缺项"），我的新消息一次都没机会打印。
🔴 **一臂变异如果先撞上更靠前的那道腿，它证明的是那道腿有牙，不是新腿有牙**；
换成"声明不动、只摘 COPY"才只让新腿可命中。这类"needle 未命中但 rc 对"要靠**同时断言两件事**才照得出来。

**⑦ 这轮顺手拿到的 #1 逐段归属读数**（在**无 node_modules 的载体** `c8664057` 上跑链里纯 fs 那一段，
`/tmp/carrier-static.log`）：`green=33 needsdeps=5 red=13`，红集
`op-log-semantics, ui-provider, theme, selection-single-source, widgets, ui-language, legal-permissions,
image-license, crosslang-contract, journey-coverage, ai-tools, ai-coverage, web-artifact`，载体脏文件=0。
其中 4 条（`ai-tools`/`web-artifact`/`crosslang-contract`/`op-log-semantics`）的报错原文就是"读不到构建产物 / 基线不绿"，
属"这段本来就得起依赖"，不是产品红；`image-license` 那条就是本节这条；
剩下的 `legal-permissions`（AndroidManifest 里 `SCHEDULE_EXACT_ALARM` 不在登记表）看着像 W9 那一族。
🔴 **逐条归属到"非本批"这一步还没做完** —— 关闭判据要求的是每条红都能在**干净 main** 上同样复现，
那需要一个 main 的 detached 检出跑同一段（见"还欠的"）。

#### 本节新增与结转的编号

| 号 | 状态 | 事项 |
|---|---|---|
| **G-54** | 🔴 **修法已提交在本分支，判据已落，真构建那一层证据未取** | `server/package.json` 的 devDependencies 里有 registry 上取不到的本地包 ⇒ `npm install --omit=dev` **在 `--omit=dev` 下仍解析 dev spec** ⇒ 镜像生产阶段第一条 install 就 E404。归属：main `b3397cda`（不是本批引入），但**它同样挡在本批的落地件上**，因为载体取的是 main 那一版 `server/package.json`。修法 `server/Dockerfile` 装之前 `npm pkg delete devDependencies` + 第 5 步两腿判据 + 新鲜度哈希按字段分区。⚠️ **本批那句"外人一条 compose 起全套"在 main 当下的树上是假的** —— 而它不在任何一道 `pnpm check` 的可见范围里（链从不构建镜像），这正是 §8.11 那条"验收脚本把自己要验的默认值换掉"的又一种面目 |
| **G-54b** | 登记，不动 | "往 `dependencies` 里加一枚 `@heyta/*` 却没给 tgz" 这一类由第 5b 腿挡住了；**往 devDependencies 加**这一类只被 prune 挡住。两种形状不同源，注释里各写了一句，别合并成一句 |
| **G-55** | 🔴 待拍板（本批不推远端） | **外人 clone 的那棵公开树 `origin/main`(`95ac4662`) 今天建不出镜像**：`b3397cda`（ADR-0050）把三枚只存在于本机工作区的 `@heyta/*` 放进了 `server/package.json` 的 **devDependencies**，而那棵树的 `server/Dockerfile` 生产阶段**没有 prune** ⇒ 落地页那篇指南让外人敲的 `docker compose … --build` 在第一条 install 就 E404。修法在本分支（G-54），**关闭要靠一次 push 或改对外那句话**，两者都不是本批能自己拍的。证据与三种关闭口径在 §8.64 |

#### 同一轮补的两条现量（不是欠项，是为了下一轮别把预期读成回归）

⑧ **prune 会带来一个副作用，我先用夹具把它量出来了**（免得下一轮把它读成"锁漏了东西"）：
`package.json` 里没有 `devDependencies` 而**提交物锁里还有**时，`npm install --omit=dev` 不只是不装它们，
它会**把锁里的 dev 条目整段删掉**。实测夹具（npm 10.9.4；`ms` 生产 + `is-odd` 开发）：

| 量 | 装之前 | 装之后 |
|---|---|---|
| 锁根条目 `devDependencies` | `{"is-odd":"3.0.1"}` | **`null`** |
| 锁的 `packages` 键 | `""`,`node_modules/is-number`,`node_modules/is-odd`,`node_modules/ms` | `""`,`node_modules/ms` |
| rc / 实际装上的 | — | rc=0 / 只有 `ms` |

⇒ 对本批三条锁侧判据的影响逐条判过：**都不需要改**。
`check:image-install-contract` 第 4 步与 `image-lock-platform.mjs`（G-53 那 14 枚平台条目）读的是**提交物锁**，
它不在镜像里被改写；`--installed-tree` 那条对账比的是"磁盘枚举 ⊆ 锁的**非 dev** 集"，
dev 条目本来就被排除在等式之外，删掉它们不改变非 dev 那 158 条。
🔴 **要紧的是那一手"重生成锁只能靠一次真构建"**：从 `/app/package-lock.json` 取回来落成提交物时，
新锁**天生不再含 dev 条目**（旧的那把含，因为它取自在没有 prune 的那一趟构建）。
所以条目总数会掉一截 —— 那是 prune 的**预期结果**，不是"锁漏了"，也不是回归。
看到数字变小就重新做差集的人，会顺手往 `IMAGE_ONLY_PACKAGES` 里加错东西，所以这句要写在这里。
⚠️ 边界：夹具是 npm 10.9.4、两个真包，等式的**形状**成立；镜像里那一趟（npm 11.19.0 + 三枚 tgz + `prisma` 点名）
的确切键数留给真构建那趟读数，不许由这一行外推。
⑨ **按命题扫过"还有没有第二处会踩同一个 E404 的构建面"**（不是只扫我改的那一处）：
`git ls-files | grep -i dockerfile` 全仓只有两枚 —— `server/Dockerfile` 与 `server/Dockerfile.test`。
后者确实跑 `npm install`（还不带 `--omit=dev`），但它 `COPY` 的是
`packages/super-sync-server/package.json` 与 `packages/sync-core/…` 这套**上游目录布局**，
在本仓库里那些路径根本不存在（我们的服务端在 `server/`），所以它在第一步就死，
且本仓 §8.54 早就量过"**没有任何构建路径用它**"（`.github/workflows/heyta-server-image.yml:182`
指向的是 `file: server/Dockerfile`，同一条 `docker build-push-action` ⇒ 修法自动被发布路径继承）。
⇒ 这条不是"又一个 G-54"，是一枚上游遗留的死件；留在这里是因为**"只修我看见的那一处"就是漂移的起点**。

⑩ **那两枚"别人正在改我的文件"的落地解法，现在有门禁当仲裁了，不再是我说了算。**
07:5x 逐行比过主检出里那两枚的未提交版本与本分支 HEAD：
`check-image-license-coverage.mjs` 他们那版是 **210 行**，我这版 **554 行** —— 也就是说
**他们改的是形状 C 之前的那份文件**（main 里躺着的就是那版老代码），而不是"在我这版上又加了东西"。
他们独有 30 个非空行里，唯一一条**语义**上是新东西的就是
`'@fastify/websocket@11.3.3'` 那枚登记（单行写法），而它在本分支里以多行写法**已经在**。
`server/image-npm-tree.json` 更直接：他们那枚钉的是
`serverPackageJsonSha256 = 272b16d2…`（正好是 main 那版 `server/package.json` 的**整文件**哈希，
见上面第 ③ 点那张四棵树表）且**没有** `packageLockSha256` 这一档 ——
那是"跑一遍旧生成器、联网重解一次"的产物（`generatedAt 2026-10-03T18:35:38Z`）。
🔴 于是落地时"取本分支"不是一条偏好，而是**门禁会判他们那枚红** —— 这一句现在是**现量**而不是我的推测：
把主检出那枚未提交的 `server/image-npm-tree.json`，连同我这版的生成器与它要读的输入
（`server/{Dockerfile,package.json,package-lock.json}` + 三枚 `packages/*/package.json`）摆进一份临时树，
跑 `node research/tools/gen-image-npm-tree.mjs --check` ⇒ **rc=1，"5 处失真"**，逐字是那五条：
① `serverInstallInputSha256` 与当下不一致；② `packageLockSha256` 与当下不一致；
③ `packages/shared-schema/package.json` 快照哈希 `a363b0c66f50…` ≠ 当下 `3f21a18ae57c…`；
④ `packages/sync-core/package.json` `260741f66829…` ≠ `657cd7991fb4…`；
⑤ "这份快照钉的还是**整个 `server/package.json` 的字节哈希**（旧键 `serverPackageJsonSha256`）"。
（复现：`/tmp/their-snap`，`cd /tmp/their-snap && node research/tools/gen-image-npm-tree.mjs --check`；
2026-10-04 08:0x 重跑与当时留档 `cmp -s` **逐字节相同**。）

⚠️ 我上一版在这里写的是"`gen-image-npm-tree --check` 直接说'快照里**没有** packageLockJsonSha256…（原文是
`packedPackageJsonSha256` 与 `packageLockSha256` 两条）'"—— ~~那个措辞是我照着记忆猜的，实测不是这个形状~~。
猜错的地方有两处，都值得留着：**它把"旧键还在"猜成了"新键缺失"**（真实输出两条都说了，但主语是"钉的还是整文件哈希"），
而且**漏了 ③④**。③④ 是这趟我才没预料到的：那枚快照连**本地包清单的哈希**都对不上当下源码，
说明它不是"形状 C 之前"那么中性，而是**对着另一份源码状态**生成的。
这条腿（本地包清单进新鲜度对账）本来就在，这一趟是它**第一次真的抓到人** —— 不是我为落地新加的。
这就是 §8.19 那句"让门禁当裁判"第一次真的替我把一条冲突解掉了，而不是我替它选边。


#### 还欠的（别当已完成）


1. **真构建**：载体重算（带上本节这几笔）之后跑一次 `verify:selfhost-stack`，看生产阶段那层建成、
   并且 `check:image-license` 在载体上从 🔴 变 ✅。这一步同时是 #2 的第 N 趟现量。
   🔴 **这一趟还要专门看一件事，别把它的红读成"G-54 没修好"**：上面 ⑧ 已经量出 prune 会让镜像内那把
   `/app/package-lock.json` **只剩非 dev 条目**（根条目的 devDependencies 变 ~~`null`~~ —— ⚠️ 这里是**猜的形状**，
   实测是 **`absent`**：`npm pkg delete` 删的是键，见 §8.62 那张对照表）。装出来的生产树不变
   （`--omit=dev` 本来就不装），但锁的字节会变 —— 而 `dump-installed-tree` / 双载体对账 / `deriveFromLock` 读的都是锁。
   所以要看的是"**非 dev 那 158 条与模式 A 的 146 条是否仍逐字对得上**"，不是"锁的条目总数有没有变"。
   若差集里冒出新的 `IMAGE_ONLY` 条目，那是**登记没跟上**（不是回归），照 §8.45 那套逐项补登记并核 `carrier` 字段。
   ✅🟡 **08:1x 分两半**：**生产阶段那层建成 + 真镜像树对账 = 拿到了**（载体 `54f66626`：`镜像 OK`、
   `145 = 126+16+3` 且声明对不上 0、双载体差集 13 条全 optional、D-3 `47/47`、界面挂载有真日志），
   ⑧ 那三个预测逐条量了在 §8.62（**两个对一个猜错**）。
   🔴 **没拿到的是真浏览器那三条与四张截图**：`VERIFY_EXIT=1` 的唯一原因是载体缺 `e2e/` 依赖
   （`e2e` 刻意不在根工作区，根 `pnpm install` 不装它）—— **harness 缺口不是产品缺陷**，依赖已补装，
   重跑要等链后半的 `pnpm check` 结束（两者往同一个 `e2e/test-results` 写同名截图）。

2. ~~**main 侧同段复跑**：拿一个 main 的 detached 检出跑**同一条**纯 fs 段，把上面那 13 条红逐条归属
   （"main 也红" = 非本批；"只有载体红" = 接缝）。这是 #1 关闭判据要求的那一句，不是可选项。~~
   🔴 **07:3x 已做掉，读数在 §8.60**：两棵树同段各跑一遍，**"只在载体红"= 空集**，而"只在 main 红"恰好是本节这一条。
   归属只到"main 同样红"这一层；剩下 8 条要在装了依赖的树上分辨，那条还欠着。
3. **协调项**：他们那笔对**服务端 `pnpm test`** 是必要的。如果他们以后往 `dependencies` 里也放工作区包，
   5b 腿会红并给出补 tgz 的修法 —— 届时要说清的是"这三枚为什么要进生产树"，不是"怎么让门禁闭嘴"。

### 8.60 #1 的关闭判据第一次**量到了**："只有载体红"那一类现在是空集（07:3x）

上一节"还欠的"第 2 条，这轮做掉了。同一份脚本（`/tmp/carrier-static-check.sh`，已改成收 `<树> <日志>` 两个参数）
分别跑在**两棵都没有 node_modules 的树**上 —— 载体 `4247c0ed` = main(`60c6fd71`) × 分支(`89cda0df`)，
与 main 自己 `60c6fd71` 的一份 detached 检出（`/tmp/heyta-main-check`，脏文件 0）：

| 树 | green | needsdeps | red | 脏文件 |
|---|---|---|---|---|
| main `60c6fd71` | 33 | 5 | **13** | 0 |
| 载体 `4247c0ed` | 34 | 5 | **12** | 0 |

| 差集 | 内容 |
|---|---|
| 🔴 **只在载体红** | **空** —— 这条就是 #1 关闭判据要的那个形状：合并没有引入任何一条 main 上不存在的红 |
| 只在 main 红 | `check:image-license` —— §8.59 那一处，**main 自己此刻就是红的**（旧判据哈希整个 `server/package.json`，而它自己的 `b3397cda` 改了 devDeps/scripts 却没人重跑生成器） |
| 两边都红（12 条） | `ai-coverage` `ai-tools` `crosslang-contract` `journey-coverage` `legal-permissions` `op-log-semantics` `selection-single-source` `theme` `ui-language` `ui-provider` `web-artifact` `widgets` |

🔴 **反过来读更值得记住**：载体这一趟比 main **少**一条红。
"合进来会不会多坏事"有人问，"合进来会不会顺手修好他们的红"没人问 ——
而后者今天真发生了，且修法就在本批的文件里（字段分区 + prune），没动他们那枚 `server/package.json` 一个字节。

⚠️ **这 12 条现在的归属只到"main 同样红"这一层，还没到"每条是环境还是产品债"那一层。**
其中 4 条的报错原文自己就说了是环境（读不到构建产物 / 基线不绿 / 缺 esbuild）；
另外 8 条要在**装了依赖**的树上才能分辨，而载体现在没有 node_modules（§8.55 已写明不许软链）。
⇒ 剩下的动作是同一条脚本在两棵**装了依赖**的树上各跑一遍完整 `pnpm check`（要窗口），
红集仍为空、且这 8 条在 main 上逐条仍可复现，才叫 #1 关闭。

⚠️ **一条探针自己坏了，而且坏得没声音**：脚本第一行那句 `loadavg` 打印出来是空的
（`loadavg(1/5/15)=`）。真实原因当场查出来了：我调的是 **`node:vm`.loadavg —— node 22 上根本没有这个函数**，
`TypeError` 被那句 `2>/dev/null` 吞掉，于是"探针不存在"在日志里长得和"负载很低"**一模一样**。
正解是 `node:os`.loadavg()。
🔴 这不是抽象教训：这一轮紧接着要排的两件重活（载体真构建、载体完整 `pnpm check`）如果照那行空读数判断，
就会在**负载 89.2 / 16 核**的机器上起一次注定被打死的跑，然后把它的红读成产品红。
现量（`os.loadavg()`，07:3x）：`1/5/15 = 89.2 / 138.8 / 87.9`，核数 16 ⇒ **窗口不到，这两件都还没跑**。
⇒ 任何负载读数必须**自带分母与探针状态**：读不到就印 `PROBE_BAD`，不许留空。
（待入 `docs/reference/environment-traps.md`：形状是"**API 选错 + `2>/dev/null`**"合起来把
 "探针不存在"伪装成"负载很低" —— 与该文件里"没观测到 X ≠ X 没发生"那一族同根，但面目是新的：
 坏的是探针调用的**函数名**，而被吞掉的方式是重定向。取号按收口当时的**工作树**现量。）
本轮这两趟纯 fs 段不依赖负载判据（且两条日志里 `rc=124` 超时计数为 **0**，12 条共有红的 rc 两边逐条相同），
结论不受那行空读数影响。

载体脚本另修一处小东西：`merge --abort` 以前是无条件跑的，于是**成功的那一趟也会往 stderr 漏一行
`fatal: There is no merge to abort`**。它不是失败（`catch` 已经接住了），但"输出里有 fatal"
会让人先怀疑合并坏了 —— 判一个动作失败只看退出码。现在先用
`rev-parse --verify MERGE_HEAD`（rc=128 ⇒ 没有进行中的合并）问一次，只在真有的时候才 abort；
两棵树上各实测该探针 rc=128。

### 8.61 落地前的一次**只读预检**：冲突面 2 条都在预置四族里、并集真跑一次判 OK，而"main 前进"这一格是 git 自己占的（08:0x）

这三件事都能在等负载窗口的空档做 —— 它们不动载体、不建工作树、几乎不吃 CPU，
而回答的问题是"那条 30-60 分钟的链跑起来会不会白跑"。

① **冲突面现量**：`git merge-tree --write-tree --name-only main feat/self-host-distribution` ⇒ **rc=1**，
两条路径：`docs/research/self-host-distribution-audit.md` 与 `package.json`。都在预置四族内
⇒ `fam.other` 为空 ⇒ 载体不会 `die(2, 预置四族之外的冲突)`。
🔴 顺带**否证了 §8.16 里还活着的一段手册**（已在原节旁边挂了指针）：那三行
`tree=$(git merge-tree --write-tree …) || exit 1` **只在零冲突时成立**。现在 rc=1，
而实测 `--write-tree` 写出的那棵树里两个文件**都带 `<<<<<<<`**（`f3f3b234`：pkg 1 处 / 审计文档 1 处，
负向对照本分支 HEAD = 0 处）⇒ 这三行今天只剩"靠 `|| exit 1` 响亮退出"这一条路，
它**不再能算出载体**。载体机制是 `research/tools/selfhost-merge-carrier.mjs`（分族解冲突再落笔）。
另一个自动结论：`research/tools/check-image-license-coverage.mjs` 与 `server/image-npm-tree.json`
在**提交层根本不冲突**（main 相对 merge-base 没改过它们）⇒ 载体自动取本分支版；
他们那两份编辑只活在主检出的工作树里，所以 §8.59 ⑩ 那条门禁读数是"他们若把自己那版提交上去会红"，
而不是"现在会冲突"。这两件事以前没分开写。

② **并集真跑一次**（真的 `selfhost-audit-union.mjs` + 三个真 blob，不建载体）：verdict = **OK**，
stats = `mainOnly=50 srcOnly=1598 lostMain=0 lostSrc=0 invented=0 markers=false extraMainHeadings=1 droppedBase=24`。
逐条读法：main 那 50 行是他们相对 base 新增的（含 1 个本分支没有的节标题），一条不少；
`droppedBase=24` 是**两侧都删掉**的 base 行 ⇒ 并集规则允许它消失。

③ 🔴 **"main 前进到该载体"这一格是 git 占的，不是规矩占的。** 两件现量：
`git worktree list` 显示 `refs/heads/main` 正检出在主检出 `/Users/…/heyta`（那侧未提交 220 枚）；
临时小仓实测**对一个已被别处检出的分支**做 `git fetch . other:two` ⇒
`rc=128` / `fatal: refusing to fetch into branch 'refs/heads/two' checked out at '…'`。
⇒ 在"不动主检出、不 `git branch -f main`、不 push"三条之下，#1 的最后一格**机械上只能由主检出的
所有者执行**。我这侧能交出的最远的东西是：`feat/self-host-merge-main` 指向一枚"第一父 = main、
且**在载体上跑过完整链**"的提交，外加一条"main 是否仍是那枚第一父"的现量判据：

```bash
git merge-base --is-ancestor "$(git rev-parse feat/self-host-merge-main^1)" main \
  && echo '载体第一父仍在 main 历史里 ⇒ 载体可直接进' \
  || echo 'main 又前进了 ⇒ 必须重算载体（新鲜度守卫会自己拦）'
```

⚠️ 这一条把 #1 的关闭形状改写了：它不是"我做完了"，是"我把可交出的部分做到底并交出指针 + 判据"。
现场证据支持这个改写的必要性 —— 记这三条的十分钟里 main 从 `ae6ec473` 走到 `af4e4b32`（两笔），
并行会话提交频率高于载体重算频率，所以任何"SHA 对得上"的印象都必须在落笔那一步重取。

④ **交接清单（08:0x 现量，本批写集 ∩ 主检出未提交）** —— 主批写集 **35 枚**，与主检出那 220 枚未提交
的交集**恰好 3 枚**：

| 文件 | main 相对 merge-base 动过吗 | 这一枚的落地解 |
|---|---|---|
| `package.json` | **动了**（⇒ 真冲突） | 预置 pkg 族：`scripts` 键并集 + `check` 链并集（§8.16 那套四条断言 + 写回后回读） |
| `research/tools/check-image-license-coverage.mjs` | **没动**（纯我方） | 提交层根本不冲突 ⇒ 载体自动取本分支版；他们那版若被提交会红，判据见 §8.59 ⑩ |
| `server/image-npm-tree.json` | **没动**（纯我方） | 同上 |

🔴 这条读数**否证了 Goal 里那句"等那 5 个重叠文件被其所有者提交"**：`docs/README.md`、
两份 i18n 词条表、`scripts/check-script-snapshot.mjs` 都不在本批写集里 —— 它们未提交会挡住
**他们自己的提交**，但挡不住这枚载体并进 main。真正需要他们先落笔的只有上面 3 枚，
其中 2 枚还是"他们动的是我方文件"（协调，不是排队）。
⚠️ 别拿 `git diff --name-only main feat/self-host-merge-main` 去算这张表：载体 4247c0ed 是对
main(`60c6fd71`) 算的，而 main 已经走到 `af4e4b32`，那 39 枚里混着**载体还没有的 main 新文件**
—— 过期载体上的"写集"不是写集。要用就先用 `merge-carrier` 重算，再取交集（本表走的是与本批
merge-base 直接相减，不受载体新鲜度影响）。

⑤ **08:0x 那一趟载体恰好是新鲜的**（瞬时读数，引用前先重取）：
`feat/self-host-merge-main` = `54f66626`，`^1 = a5583840` **逐字等于当时 main**、`^2 = 229e4dcd`（本分支）
⇒ 那条判据当场回"载体第一父仍在 main 历史里 ⇒ 可直接进"。含义很实际：**阻塞一清、main 没再动的话，
他们不需要重算载体**，直接 `git merge` 就是这一枚。三枚交接文件 08:0x 现量全部仍是 ` M`（主检出脏条目 220）。
⚠️ 但这条新鲜度是**两边**都在动的量：main 一两分钟一笔，载体是 08:04 那一刻算的 ——
所以交接时给的永远是"判据 + 重算命令"，不是"这枚 SHA 能用"。

给主检出所有者的那一步（**只有他们能做**，见 ③）：

```bash
# 前置：上面 3 枚已提交，且载体第一父仍在 main 历史里
git merge-base --is-ancestor "$(git rev-parse feat/self-host-merge-main^1)" main && \
git merge --no-ff feat/self-host-merge-main -m "merge: 自托管批次（第 N 次落地）"
```

🔴 **上面那张表的"3 枚"从今天起有一条工具化判据，别再手拼 shell**：

```bash
node research/tools/selfhost-landing-blockers.mjs
```

它按 `git worktree list` 自己找签出 `main` 的那棵树取脏集合、用 `git status -z` 解析、
先过 5 条合成夹具才输出读数（解析层坏了就 `exit 2` 且**不打**阻塞集）。
09:1x 现量：`main=3705e29d · 分支=2a62dd2c · merge-base=b850b1c6 · 写集 36 / 脏 249 / **阻塞 3**`
—— 与本节 08:0x 那三枚逐字相同（写集从 35 到 36 是我后来加了一枚 `mutate-teardown-trap.sh`，
不在脏集合里 ⇒ 不挡路）。**为什么要有这条**：手拼 `awk substr($0,3)` 那一版把每条路径切成了
"带前导空格"，交集于是恒空，屏幕上打的是"阻塞集 0 枚"，读起来像"可以落地了" —— 见 §8.65 ②。

⑤ 的新鲜度 **09:1x 重取**（瞬时读数，引用前还得重取）：载体仍是 `54f66626`，`^1 = a5583840`
仍在 `main`(`77713be3`) 历史里 = **YES**，但 `^1 ≠ main` ⇒ 载体落后 **22 笔**，
而本分支又走了 3 笔（`229e4dcd → 2a62dd2c → 03e3df12`：拆栈修法 + 夹具 + 这节）。
⇒ 08:0x 那句"阻塞一清就不用重算载体"**今天不成立**，落地前必须重算一趟；
重算命令仍是 `node research/tools/selfhost-merge-carrier.mjs`（在分支 worktree 里跑）。


### 8.62 G-54 的**真构建那一格拿到了**，而 `VERIFY_EXIT=1` 死在载体的 e2e 依赖 —— 以及 ⑧ 那条预测被现量改了两个字（08:1x）

链在 08:04 拿到窗口（负载 10.4），载体重算到 **`54f66626` = main(`a5583840`) × 分支(`229e4dcd`)**，
`INSTALL_RC=0`，然后跑 `pnpm verify:selfhost-stack`。这一趟把 §8.59 "还欠的"第 1 条**前半**做掉了：

| 环节 | 读数（全部来自 `/tmp/g54-chain.log`，载体 `54f66626`） |
|---|---|
| 生产阶段构建 | `==> 打镜像（… VCS_REF=54f66626）` → **`镜像 OK`** ⇒ 加了 prune 之后 `npm install --omit=dev` 在**载体这棵树**上不再 E404（这就是 G-54 修的那一层，main 那棵树今天仍然会死在第一条 install） |
| 架构披露 | `linux/arm64`，照旧响亮地声明它**不等于**发布 workflow 钉的 `linux/amd64` |
| 真镜像树 × 许可证扫描集 | ✅ `145 = 126 + 16 + 3`（无解释 0 · 非宽松 0 · **声明对不上 0** · 失效登记 0） |
| 双载体对账 | 磁盘枚举 145 ⊆ 镜像内锁的非 dev 158，差集 13 条**全是 optional**；G-53 那 14 枚平台条目里 13 枚不在本次载体树上 |
| D-3 | 一次性容器 `exited(0)` · 应用侧 `RUN_MIGRATIONS_ON_STARTUP=false` · **已应用 47/47** · 悬挂 0 · 重复完成 0 |
| 界面挂载 | 服务端真日志 `[web-app] 共享 UI 挂在 /app/（来自 /app/web-dist）` |
| 入口命令对账 | 7 份扫描 + 1 份故意排除，9 条命令逐行过 R1–R7 |
| 真浏览器三条 | 🔴 **没跑成**：`❌ e2e 的依赖没装` ⇒ `VERIFY_EXIT=1` |

🔴 **这一条红的归属**：`e2e/` 刻意不在根 pnpm 工作区内（`e2e/pnpm-workspace.yaml`），
所以根目录 `pnpm install --frozen-lockfile` **不会**装它 —— 必须先 `cd e2e && pnpm install`。
这是**我这条链少了一步**（harness 缺口），不是产品缺陷；已在 08:1x 于载体里补装（rc=0）。
⚠️ 重跑不能与链后半的 `pnpm check` 并行：两者都往 `/tmp/heyta-merge-carrier/e2e/test-results` 写同名截图
（§7 里"共用 test-results 会删掉唯一证据"那一族），所以浏览器那一腿等 `CHECK_RC` 之后再取。

#### ⑧ 那条预测：方向对了，两个细节是错的

`docker run --entrypoint sh supersync:selfhost-verify` 直接读镜像里的东西（现量，非推断）：

| 我 ⑧ 里写的 | 镜像里的实测 | 结论 |
|---|---|---|
| 锁"只剩非 dev 条目" | `lock_packages=159`（修前那趟是 **321**），`dev_entries=0` | ✅ 字节确实变了，dev 全没了 |
| 根条目的 `devDependencies` 变 **`null`** | **`absent`** —— 字段整个不在，不是 `null` | 🔴 我猜了形状。`npm pkg delete` 是删键 |
| "装出来的生产树不变" | 真镜像树 `145` 与修前那趟**同一读数**，`差集 13 条全是 optional`；`prisma` CLI 与 client 都是 `5.22.0` | ✅ 承重的那句成立 |
| （⑧ 没预料到） | **`/app/package.json` 里 `devDependencies` 键也整个不见了** —— prune 改的是镜像内那份 manifest，不只是锁 | 🔴 副作用比 ⑧ 写的多一处 |

那一句"要看的是非 dev 那 158 条是否仍逐字对得上"也量了：`158` 一字没动（`159 − 根条目 = 158`），
而 `readImageLock()` 在 `image-lock-platform.mjs:74` 就 `if (entry.dev) continue` ——
⇒ **下一次真构建把镜像里那把锁取回提交物时（321→159 键），模式 A 的非 dev 集合不变**，
`check:image-license` 不会因为换代而变红。唯一跟着变的是打印出来的 `entryCount`
（全仓 `entryCount` 只有 `gen-image-npm-tree.mjs:139/320` 两处是**这个字段**，另一处是本文档自己；
`server/tests/{sync-types,conflict-detection}.spec.ts` 里那几处是**同名局部变量**（向量时钟条目数），
不吃这个字段 ⇒ 没有任何断言消费它）。

#### 这一趟之后 G-54 还欠的（别把上面当成整条闭合）

1. 真浏览器三条判据 + 四张截图（人逐张看过）—— 载体上重跑，等链后半的 `pnpm check` 结束。
2. `check:image-license` 在**载体**上从 🔴 变 ✅ 这条已经由上面那行"真镜像树对账 ✅"覆盖了一半，
   另一半是链里那把纯 fs 腿在 `CHECK_RC` 里的读数。
3. 🔴 **main 那棵树今天仍然会 E404**：修法只在本分支里，落地之前外人从 main 照抄 compose 依旧起不来。
   所以 G-54 的"对外不再错话"这一半，**关闭位置是落地那一刻**，不是本分支绿那一刻。
   ⚠️ **这句在同一天 08:5x 被 §8.64 推翻了一半**：外人拿到的不是本地 `main`，是 `origin/main`，
   而那棵树今天同样会 E404（实测在 §8.64 那张表里）。"落地那一刻"只关掉了本地那一半，
   对外那一半要么配一次 push（与本批硬约束冲突），要么改指南那句 —— 编号 **G-55**。


### 8.63 `VERIFY_EXIT=1` 那趟把三个容器留在机器上 23 分钟 —— 拆栈从来不是 trap 的职责（08:4x）

取 §8.62 那条红的时候顺手查了一下现场（`docker ps -a`，08:3x）：

```
supersync-server                          heyta-selfhost-verify   Up 23 minutes (healthy)  127.0.0.1:1900
supersync-postgres                        heyta-selfhost-verify   Up 23 minutes (healthy)
heyta-selfhost-verify-supersync-migrate-1 heyta-selfhost-verify   Exited (0)
```

脚本明明有 `trap 'cleanup; rm -f -- "$0"' EXIT`，看起来"退出时会收拾"。**但没有：**
`cleanup()` 只做两件事——删快照副本、删一次性凭据文件。拆栈是**各个失败分支各自**调
`down_stack`（起栈失败那条调了，正常结束那条也调了），所以**任何一条没调到的 `die` 都会留下一栈**。
§8.62 那次 die 的位置恰好就在"栈已起来"与"唯一那条拆栈调用"之间（`e2e` 依赖那条守卫）。

⚠️ 危害比"占内存"大一层。compose 文件里 `container_name` 是写死的，脚本因此有一条 preflight
"别的栈在跑时必须响亮地失败"——但它的判据是 `owner == $PROJECT` 就 `continue`，
于是**下一趟复用我自己留下的那一栈**（同 project 名），不会响亮失败；
紧接着 `compose down -v --remove-orphans` 又把卷清掉 ⇒ 表面看是干净起栈，
而"这台实例是不是这次建起来的"从来没有判据。在这台机器上（负载 >12 就什么都跑不动）
留一栈 Up 的代价还会直接把下一个窗口吃掉。

修法三件（`scripts/verify-selfhost-stack.sh`）：

1. `STACK_UP=0` 起栈成功后置 1（**在起栈失败那条分支之后**，那条自己拆过了，不重复拆）。
2. `cleanup()` 里在 `rm -f "$ENV_FILE"` **之前**调 `down_stack` —— 顺序反了 `compose down` 读不到那份 env，
   就是"拆了个寂寞"（与文件里既有那条 `--keep` 不能删 env 的注释同一条理由）。
3. `declare -F down_stack` 那一层不是装饰：`down_stack` 定义在起栈之后，而 `die` 在那之前也会走到
   trap（容器名冲突那条就是），bash 对未定义函数是 **127**，不会"温柔地跳过"。

**验的是控制流，函数体从真文件里 `awk` 抽出来**（不手抄第二份）。
这副夹具**已经进仓库**：`research/tools/mutate-teardown-trap.sh` ——
`bash research/tools/mutate-teardown-trap.sh` 一次跑完五臂对照 + 两枚变异，< 1 秒，
不碰 docker、不起容器、不联网。它**不是门禁**：没挂进 `pnpm check`，命名也刻意不带 `check-` 前缀，
免得 `check:gate-wiring` 那张表把它当"门禁没有消费者"。
不落 `/tmp` 的理由是可复现物那一条：这行修法是**已发布行为的一部分**，
"通过=五臂"如果只活在 `/tmp`，一次重启就降级成主张。
`compose()` 换成只记参数的桩（⚠️ 桩收到的就是 `compose down …` 那几个参数，所以行首是
`COMPOSE down` 而不是 `COMPOSE -p … down` —— 第一版按真脚本的形状写 grep，三条臂一起报"却没拆栈"，
那是探针坏了，不是修法坏了）。五臂：

| 臂 | 输入 | 断言 | 结果 |
|---|---|---|---|
| A | `STACK_UP=1 KEEP=0` | 有一条 `COMPOSE down`，且那一刻 `env_exists=yes`，随后 env 被删 | ✅ |
| B | `STACK_UP=0` | **一条 compose 都不许调**（否则会去动别人的同名资源） | ✅ |
| C | `KEEP=1` | 不拆栈**也不删 env**（那条手工拆栈命令要能用） | ✅ |
| D | `down_stack` 还没定义 | 不 127、且 env 删除这一步没被一起吞掉 | ✅ |
| E | 正常结束那条路：先**显式** `down_stack` 再由 trap 走 `cleanup` | `COMPOSE down` 只许出现 **1** 次 | ✅ |
| 变异 M1 | 摘掉 trap 里那三行 | **恰好红在 A**（`STACK_UP=1 却没拆栈`，rc=1） | ✅ |
| 变异 M2 | 摘掉 `down_stack` 末尾的 `STACK_UP=0` | **恰好红在 E**（`正常结束那条路拆了 2 遍（应当 1）`，rc=1） | ✅ |
| 还原 | 真文件 | 五臂全过 rc=0 | ✅ |
| 门禁 | `check:script-snapshot` | ✅ 31 个脚本 + .gitignore（MARKER 那行没被我碰坏） | rc=0 |

⚠️ E 那一臂与 M2 是补上来的，起因不是洁癖：加完 trap 之后我去数了 `down_stack` 的调用点
（`grep -n down_stack` → 定义 344、显式调用 **362 与 507**、trap 150）⇒
**正常结束那条路会拆两遍**。`compose down -v` 幂等，不会坏，但日志里会有两行 `==> 拆栈`，
而下一个人读到两行会先怀疑"起栈是不是失败走了两条分支"。修法是在 `down_stack` 末尾把
`STACK_UP` 清零（谁真拆过谁负责改状态），而不是在调用点各加一句判断。

🔴 **两条边界，别把上面读成"真拆过一次"**：

1. 夹具量的是 trap 的分支与顺序，**没有真叫过 docker**。首次真消费是下一次真跑，
   预期读数写死在这里：任一 `die` 之后
   `docker ps -a --filter label=com.docker.compose.project=heyta-selfhost-verify -q` 必须是 **0**。
2. **载体那棵树里的脚本副本还是旧的**（follower 跑的是 `54f66626` 那份），
   所以本修法要等载体重算之后才进入验收路径。这属 §7 第 27 条那一族（改了源码、跑的是旧产物），
   只是这次旧的是**验收脚本自己**。

我自己留下的那三枚容器与两枚卷已在 08:3x 拆掉（`docker ps -a --filter label=…=heyta-selfhost-verify -q` → **0**，
`:1900` 监听数 → **0**）。

### 8.64 🔴 G-55：这一批把"对外错话"找对了位置——外人 clone 的那棵树，今天根本建不出镜像（08:5x）

§8.62 写"关闭位置是落地那一刻"。这一条把它**推翻了半步**：落地只动本地 `main`，
而外人拿到的不是本地 `main`，是 `origin/main`。逐条现量（全部**不联网构建**、只读 git 与 GitHub 公开 API）：

| 量 | 读数 | 怎么复核 |
|---|---|---|
| 仓库是否匿名可读 | `api.github.com/repos/Xaiver03/heyta` → **HTTP 200**、`private=false`、`default_branch=main` | 未认证 GET |
| 远端 main 的头 | `95ac46627b78917b…`，与本地 `origin/main` **逐字相同** | `…/commits/main` 的 `sha` 对 `git rev-parse origin/main` |
| 公开那棵树的 `server/package.json` | `dependencies`: `@heyta/domain` / `shared-schema` / `sync-core` 全 `"*"`；**`devDependencies`: `@heyta/app-host` / `storage` / `sync-client` 全 `"*"`** | `git show origin/main:server/package.json` |
| 公开那棵树的生产阶段 | 三条 `npm install … --omit=dev`，`npm pkg delete devDependencies` 命中数 **0** | `git show origin/main:server/Dockerfile` 取 `AS production` 之后 |
| 谁带进来的 | `b3397cda feat(server,app-host,web,mobile): vault/E2EE 密钥生命周期与找回（ADR-0050）`，`--is-ancestor b3397cda origin/main` = **真** | 两条 git 命令 |

⇒ §8.59 那枚机制（`--omit=dev` 仍然**解析** devDeps 的每一条 spec，工作区包在 registry 上不存在 ⇒ E404）
**今天就在公开那棵树上成立**。而指南（`docs/runbooks/self-host.md:35` 是 `git clone https://github.com/Xaiver03/heyta.git`，
站内那篇文章 `s7p1` 明写"要钉版本，就从本仓库源码构建"）指的就是这一棵。
🔴 所以对外那句"一条 compose 起全套、打开浏览器就能用"，**在本批全部落地之后仍然不成立** ——
落地动的是本地 `main`，外人拿不到，除非有人 push。

顺带被这次现量**否证的两条我自己的说法**（都留在原处，别当现状引用）：

1. 站内词条里有一句注释写"仓库当前是私有的"（`packages/i18n/src/locales/zh-CN.ts:3606` 附近，
   是给"为什么那些条目是命令不是链接"的理由）。实测 `private=false`。
   ⚠️ 这条**只是注释**、不在界面上，所以它不是一句对外错话，但它会误导下一个改词条的人 ——
   登记，等那两枚表空出来时随 G-51 一起改（改词条要中英同步 + 重跑生成 + `check:entries`）。
2. §8.62 里那句"main 那棵树今天仍然会死在第一条 install"读起来像"只有本地 main 的事"。
   真实范围更大：**公开那棵也是**，而且它才是外人那一侧。

#### 三种关闭口径（要人拍板，本批不代拍）

| 口径 | 动作 | 代价 / 风险 |
|---|---|---|
| A | 落地之后 **push `main` 到 `origin/main`** | 一次推 116 笔（`git rev-list --count origin/main..main`），**其中绝大多数不是本批的** ⇒ 等于替别人未过目的提交对外发布。硬约束里"不推远端"挡的就是这个 |
| B | 只把**修 prune 那一笔**摘出来单独 push（cherry-pick 到 `origin/main` 之上） | 快、面窄，但会造出一条"公开树 ≠ 本地 main"的分叉；下一个人 push 时要先处理 |
| C | 暂不动远端，把**指南那句改成实话**："当前从源码构建会失败（原因 + 已修在哪个分支），要么等一次推送，要么用我们给出的产物" | 要动那两枚 i18n 表（` M`，别人占着）+ `docs/runbooks/self-host.md` + 落地页重发（§8.27 那次一起做）；**不新建承诺**，只是停止兑现不了的那句 |

🔴 三条都要人拍板，且 **A 与本批硬约束直接冲突**。本批做到的部分是：机制已修（G-54，载体上 `镜像 OK` 有读数）、
判据已挂（第 5/5b 腿 + 10 臂变异）、**这一条缺口已编号并带可复核命令**。

> ⚠️ **本节那格 `116 笔` 是 08:5x 的瞬时读数，15:0x 现量已变成 `97`**（同一把尺
> `git rev-list --count origin/main..main`；`origin/main` 从 `95ac4662` 走到 `8a254bcd`，
> 今天 10:13 有人 push 过 —— 那不是本批推的）。口径 A 的**代价会随别人每次 push 自己变小**，
> 所以引用它时必须现取，不能抄本节。其余三条 needle（devDeps 里那 3 枚 `@heyta/*`、
> production 阶段 `npm pkg delete` 命中 0、`b3397cda` 是 `origin/main` 的祖先）15:0x 重量**仍成立**，
> 逐条读数与那枚差点把我骗过去的 zsh 引号坑在 **§8.89**。

### 8.65 拆栈修法**第一次被真容器消费**，而我自己的落地探针差点把这次合并放行（09:0x–09:1x）

这一节有三笔，前两笔都是**我自己的探针**的事，不是产品的。

#### ① §8.63 那条修法现在有了真容器读数（不是夹具读数）

09:08:31 从分支 worktree（`2a62dd2c`，这棵树里的脚本副本**带** `STACK_UP` 修法）起了一趟
`verify:selfhost-stack`。它在 09:11:32 被别人的内存闸门挡下（见 ③），也就是恰好踩在
§8.63 出事的那个形状上——**跑到一半 die**。两趟对照：

| | 08:0x 那趟（旧副本） | 09:0x 这趟（带修法） |
|---|---|---|
| 失败点 | 载体缺 `e2e/` 依赖 ⇒ die | 内存闸门拒绝启动 ⇒ die |
| 日志里 | 没有 `==> 拆栈` | 有 `==> 拆栈` |
| **现量残留** | 三个容器在机器上活了 **23 分钟** | `docker ps -a` 里 `heyta-selfhost-verify*` **0 条**、`:1900` 监听 **0** |

🔴 这一格认的是**那两条现量**，不认日志里那行 `==> 拆栈`——日志只证明脚本 self-report 拆过，
`docker ps -a` 才证明机器上是空的。等窗口序列 `/tmp/g56-browser-retry-then-check.sh` 把
`LEFTOVER_CONTAINERS=` 写进了每一趟的收尾，就是要让它每次真跑都重取一次，而不是一次结案。

#### ② 🔴 一次性的落地阻塞集测量**算错了**，错的形状是"假清空"

我为了在等待期确认"那 3 枚文件还在不在别人手里"，手拼了一条：

```bash
git status --porcelain --untracked-files=all | awk '{print substr($0,3)}'
```

`--porcelain=v1` 的记录是 `XY<SP>path`，第一格是 `X`，所以跳格要跳到 **4**（`substr($0,4)`）。
用 3 就得到**每条路径带一个前导空格**的集合 ⇒ 与写集的交集**恒为 0** ⇒
屏幕上打的是 `blocker count: 0`，读起来像"阻塞集已清空、可以落地了"。
真相是 **3 枚**，与 §8.52 登记的完全相同。

同一趟我跑了一条"阳性对照"：`写集 ∩ 写集 = 36`。它证明的是 `comm` 那条管道通，
**一个字都没证明那个偏移量**——对照点没穿过我怀疑的那一层。修好偏移后 shell 给 3 枚；
换成 `git status -z`（NUL 分隔，路径不需要再切、也不会被八进制引号改写）用 node 独立解析，也给 3 枚：

| 载体 | 现量 |
|---|---|
| 修好偏移的 shell（`substr($0,4)`） | 写集 36 / 脏 249 / **阻塞 3** |
| `research/tools/selfhost-landing-blockers.mjs`（`status -z` 解析） | `main=3705e29d · 分支=2a62dd2c · merge-base=b850b1c6` · 写集 36 / 脏 249 / **阻塞 3**：`package.json` · `research/tools/check-image-license-coverage.mjs` · `server/image-npm-tree.json` |

这条测量以后每次判落地都要跑，所以落成了带夹具的工具（不是门禁：它回答"卡在谁手里"，不判仓库好坏）：

- **夹具先跑**（5 条合成记录：` M` / `??` / `R  new`+`old` / `A `）⇒ 解析层坏了就直接 `exit 2`
  并明确印"**本次没有可信的阻塞集读数，『为空』尤其不能当成放行**"。
- 变异臂 `--selftest-buggy-offset` 把偏移改回我那个错的：现量 `MUT_RC=2`，
  打印 `夹具里 4/5 条路径没被解析成裸路径（实际得到 " package.json" …）`；未变异 `CONTROL_RC=0`。
- 它自己按 `git worktree list` 找**签出 main 的那棵树**去取脏集合，并把路径打印出来——
  在分支 worktree 里跑它，脏集合会来自一棵干净树 ⇒ 又是一次"假清空"。

⇒ 可迁移的形状有两个：**(a) "空测量"要当成警报而不是好消息**，尤其当那个空正好是我期待的答案；
**(b) 控制臂必须穿过我怀疑的那一层**——我第一版控制臂写成"拿一枚确定脏的路径塞进候选写集，
看交集里有没有它"，那是**恒真**的（那条路径本来就来自同一个集合，怎么解析都命中自己），
换成"合成夹具 + 变异臂"才有牙。

#### ③ 🔴 "起跑前的闸门条件"不构成"起跑后的许可"

09:08:31 探针看到 `/tmp/tfa-test.lock` 不在、load=9.0、docker 已起 ⇒ 起跑；
09:11:32 playwright 那一腿被 `内存闸门拒绝启动（pid=40555，它是 pnpm --dir e2e run test:landing）` 挡下。
锁是在我这趟**跑到一半**时被别人拿到的。这条线的产品不是缺陷、判据也没坏（它响亮地拒绝了，
还给了 pid 与命令），欠的只是"这一趟没拿到读数"。所以：

- 等待器从"跑一次"改成"被闸门拒 ⇒ 等 90s 再起下一趟，最多 6 趟"；**不是** rc=1 就重试——
  只有日志里出现那句闸门拒绝才重试，其他 rc=1 停下交人判（否则会把真缺陷刷成一串绿）。
- 没有用 `TFA_ALLOW_CONCURRENT_TEST=1` 绕（它挡的是 OOM，不是礼貌）。

顺带一处探针够不着：我那条"截图新鲜度"列表扫的是 `e2e/test-results/`（躺着别的会话几十张同名 png，
于是一整屏 `STALE`），而 `verify:selfhost-stack` 的图落在 **`e2e/selfhost-stack-results/`**
（`scripts/verify-selfhost-stack.sh:487` 传的正是这个目录）。现量：那里躺着 4 张 `05:50` 的图，
就是 §8.49 那次 `VERIFY_EXIT=0` 的四张；这一趟没有新图。**"一整屏 STALE" 是探针指错目录，不是"这次的图都是旧的"**
——同一句话在 08:4x 那次是真的（当时判据确实指对了目录），两种形状要分清。

📌 **待入 traps**：`git status --porcelain` 的行切在 `substr($0,4)`（v1 记录是两字符状态 + 一个空格）；
切到 3 会把每条路径变成"带前导空格的字符串"，于是任何与裸路径集合的交集**恒空**。
主检出 `docs/reference/environment-traps.md` 现在被别人占着（HEAD 222 / 工作树 232 行），不插行，只留这条指针。

**本节结束时仍欠的**：真浏览器三条 + 四张截图的新读数（`/tmp/g56-browser-check.log` 在等窗口，
阶段 2 是载体完整 `pnpm check`，它的窗口条件是 4318/4319/3000 上没人监听）。

### 8.66 🔴 §8.27 欠的那次重发，线上**已经带着它了** —— 但先烧掉了我自己两版错探针（09:2x，纯只读网络）

`origin/main` 之外还有一件事要重取读数：§8.27 登记「落地页还欠一次发布：线上 `/docs/selfhost/`
仍印旧句 4 处（meta/og/twitter/JSON-LD 四份抄件），正文里另有一句被同页 §7 那条命令否证」。
这一句今天量下来**已经不成立**。两把 needle 都从源码字面抄（不是台账里的转述）：

| 载体（现量 09:2x） | 旧句 | 新句 |
|---|---|---|
| `https://…/docs/selfhost/` 的 HTML（200 / 5007B） | `不是一个命令就完事` = **0** | `把服务起来那条命令不难` = **4**（description / og:description / twitter:description / JSON-LD 各一处） |
| `/assets/zh-CN-dEIblZKL.js`（156041B，懒加载的中文文案 chunk） | `服务自己不在启动时动表结构` = **0** | `首次开机由那份一次性迁移服务把表结构建好` = **1** |

源码侧的对账：`6e307b22`（10-04 01:04，改的就是 `site.docs.selfhost.s1i2` 那一句）
**既是 `main` 的祖先、也是 merge-base `b850b1c6` 的祖先**；元描述那句改得更早，
`6e307b22^` 与现在逐字相同（所以它不是那一笔改的，是 §8.21 那一轮改的 —— 别把两笔混成一笔）。
⇒ 线上产物带着这两处修复，只可能是**有人在含 `6e307b22` 的树上发过一次**（09:1x 现量：另一条会话正在跑
`pnpm --dir e2e run test:landing`）。

🔴 **我在这条读数上先错了两版，都写下来免得下一轮照抄**：

1. 第一版 needle 是我从台账的**节引**里抄的 —— §8.21/§8.64 写的是
   「…服务自己不在启动时动表结构」，那个省略号后面的串**在分支、`main`、merge-base 三份源码里都是 0 命中**
   （真实旧字面在 `git show 6e307b22^` 里）。于是"线上也 0"什么都不是：一个哪里都不在的字符串，
   在线上当然也不在。**这是 needle 教训的第四次同族**（前两次是 `includes` 数散文、一次是"提交物"三个字）。
2. 第二版探针只扫了 HTML 里 `src|href` 显式引用的两个资源 ⇒ 文案住在**懒加载的 locale chunk** 里，
   新旧两句同时为 0。同时 0 是"通道没到"的形状，不是"没有"；补上"至少一个 chunk 含中文"这条阳性对照才走通。

⚠️ **别把这句"线上已修"读成 #19/#20 可以关**。§8.27 那笔债里还有**一条产物字节**的：
线上 `/assets/main-*.js` 带 `if(i===Il)return n`（默认语言不拼 `?lang=`），首启解析链多了系统语言那一层 ⇒
英文浏览器点「立即使用」落到英文应用。它不在上面两个 needle 的射程内，判它要靠
`e2e/live-site/live-domain.spec.ts` 那条 href 断言 —— 那条**仍红**，而它的关闭动作绑在落地之后从 main 发那一次。

🔴 09:2x 我直接跑那一趟，**被内存闸门挡下**（`pid=59470` 正在 `pnpm --dir e2e run test`，锁 `/tmp/tfa-test.lock`），
所以那句"仍红"是 §8.27 的旧读数，**不是今天的读数** —— 今天既没拿到红也没拿到绿。
没用 `TFA_ALLOW_CONCURRENT_TEST=1` 绕（它挡的是 OOM）。
另记一次同族事故：我那条命令套了 `| tail -40`，后台通知因此报 **"exit code 0"**，
而真实情况是被拒绝启动（§7 第 45 条）。重跑挂在 `/tmp/g58-live-site.sh`（哨兵 `LIVE_SITE_RC=`）。

📌 一条顺带量到、**登记而不判缺陷**的形状：`?lang=en` 与不带它，回的是**同一份** 5007B HTML（中文 meta ×4），
英文文案在 `en-*.js` 那个懒加载 chunk 里 ⇒ 入口页的静态 meta 按默认语言生成。
这与 §8.21 那张「一条命令 6 处」表不是同一件事（那 6 处是正文/落地页文案）。

#### 队列里现在挂着什么（别另起一条重复的）

| 脚本 | 在等什么 | 拿到什么才算 |
|---|---|---|
| `/tmp/g56-browser-retry-then-check.sh`（pid 53488） | ① `/tmp/tfa-test.lock` 空 + load ≤12 + docker 起 ⇒ 跑 `verify:selfhost-stack`，**被闸门拒就等下一趟**（≤6 趟）；② 4318/4319/3000 无人监听 ⇒ 重算载体 + 装依赖 + 载体完整 `pnpm check` | 哨兵 `S1_OK` / `FRESH=4/4`（目录是 `e2e/selfhost-stack-results/`）/ `CHECK_RC=` |
| `/tmp/g57-attribution.sh`（pid 65696） | 等 g56 的 `CHECK_RC`/`S_ALL_DONE`，再等端口空 ⇒ **逐段**在载体跑一遍、main 那棵树只跑"载体红的那些段" | `只在载体红：`（必须空集）—— 这才是 #1 那句"逐条归属" |

🔴 g57 存在的原因写在这：**`pnpm check` 是一整行 `&&` 链，第一红就停** ⇒ 整链跑一次只拿到**一条**红，
逐条归属必须逐段跑。§8.60 那句"两棵树各跑一遍完整 check"按字面做是拿不到归属的。

### 8.67 🔵 Goal 第 2 项现在**五层齐了**（真镜像 + 真服务端 + 真浏览器 + 四张图人看过），顺带 live-site 23/23 转绿（09:3x）

#### ① `verify:selfhost-stack` 全跑 `VERIFY_EXIT=0`，载体是分支 `959fd1e6`

09:30:17 起跑（等窗口 6 分钟，09:19:14 现量 `tfa=yes listeners=3`），09:32:54 收工。逐项：

| 层 | 读数 |
|---|---|
| 真镜像 | 建成，`VCS_REF=959fd1e6`；`check:image-license` 那条腿在**真镜像树**上对账 `145 = 126 + 16 + 3`（无解释 0 / 非宽松 0 / **声明对不上 0** / 失效登记 0） |
| 默认服务图 | 3 个未动 · 带 override 4 个（+`supersync-migrate`） |
| 一次性迁移 | `exited(0)` · 应用侧 `RUN_MIGRATIONS_ON_STARTUP=false` · 带外恢复 flag=true · **已应用 42/42** · 悬挂 0 · 重复完成 0 |
| 界面挂载 | 服务端日志真印「共享 UI 挂在 /app/（来自 /app/web-dist）」 |
| 真浏览器 | 三条判据全过（`http://127.0.0.1:1900/app/`，零 mock） |
| **四张截图** | `FRESH=4/4`（mtime 09:32:45 / :49 / :52 / :53，全部晚于起跑）且**我逐张打开看过** |
| 失败与恢复 | `LEFTOVER_CONTAINERS=0` —— 这一趟是 rc=0 的正常收尾，而 09:0x 那趟**中途 die** 也是 0（§8.65 ①） |

四张图各自看到的东西（不是"非空白"，是内容）：S1 应用起在 `/app/`、中文、侧栏完整、顶栏「未同步」、收集箱空态；
S2 已登录（`selfhost-7565269-1@example.test`）+ 顶栏「已同步」+ 头像菜单三项（编辑个人信息 / 设置 / 退出登录在最底、危险色）；
S3-a 设备 A 建出 `selfhost-task-7565269-2`，收集箱计数 1；
S3-b **全新设备**（空 IndexedDB 的新 context）登录后从服务端**读回同一条任务**、顶栏「已同步」。
⚠️ 与 05:50 那四张的差别只在多了一行「排序方式 / AI 排优先级」（别人的功能落进共享界面了），
挂载/同步/身份三条判据的形状没变。

#### ② live-site 那 23 条今天**全绿**，包括 §8.27 停在第 ③ 条的那一句

`/tmp/g58-live-site.sh` 09:31:44 收工：`LIVE_SITE_RC=0`，`Running 23 tests using 1 worker` → **23 passed (1.4m)**。
其中三条正是这笔债的判据：

- `live-domain.spec.ts:157` 「英文落地页的入口带 `?lang=en`（否则英文访客进应用看到中文）」 ✅
  ⇒ §8.27 那句"今天它停在第 ③ 条，报的是 `/docs/selfhost/ 仍在线上印「不是一个命令就完事」4 处`"
  **已被现量否证**（09:2x 的产物层读数见 §8.66：旧句 0 / 新句 4）。
- `live-domain.spec.ts:256` 「PWA 资产在 `/app/` 子路径下拿到真身，且 SW 真的注册成功」 ✅
- `live-signin-entry.spec.ts` 三条（含"语言参数不能把 signin 挤掉"）✅

🔴 **两件不许顺势读成已做完**：
1. 这条判据的**牙**没在可控载体上证过 —— 它打的是线上，我不能为了变异去改生产。
   合法做法是把 `HEYTA_LIVE_ORIGIN` 指到一份**故意打回旧形状**的本地产物上跑同一用例，
   那一趟没跑 ⇒ #20 的"补变异读数"这一格**仍欠**，本批不宣布关闭。
2. 线上这份 build 的**来源树仍然无法归属**（§8.27 原话）。今天能说的是"它带着 `6e307b22` 的文案
   与 `?lang=en` 那条行为"，不能说是"从 main 的某一枚 SHA 发的"。

#### ③ 队列状态（09:3x 现量，引用前重取）

| 脚本 | 状态 |
|---|---|
| `/tmp/g56-browser-retry-then-check.sh` | 阶段 1 `S1_OK attempt=1`；阶段 2 在等 4318/4319/3000 空闲（09:33 现量 `listeners=1`、load 29） |
| `/tmp/g57-attribution.sh` | 在等 g56 的 `CHECK_RC`/`S_ALL_DONE` |
| `/tmp/g58-live-site.sh` | 已完成（`LIVE_SITE_RC=0`） |

分支侧纯 fs 门禁在 `959fd1e6` 上逐条现量：`check:selfhost-entry-command` / `check:image-build-args` /
`check:gate-wiring` / `check:script-snapshot` / `check:docs` / `check:image-license` **全部 rc=0**。

### 8.68 🔴 我把"完整 check 的窗口条件"写严了一档，于是它永远不开 —— 读被调方源码之后改对（09:3x）

g56/g57 那两条等待器等的都是"`lsof -iTCP:4318 -iTCP:4319 -iTCP:3000` 三个端口都没人监听"。
09:3x 现量：4318/4319 **本来就是空的**，占着的是 `*:3000` 那一枚 ——
`node dist/src/index.js`，cwd 是**主检出的 `server/`**，`PPID=1`（启动它的 shell 早没了），
已跑 8h10m。它是别人（或上一轮某个会话）留下的同步服务端，**不是我起的，我没杀它**。

去读被调方，而不是照抄我自己的记忆：

| 证据 | 读数 |
|---|---|
| `scripts/check-ai-e2e-preflight.mjs:37` | `const DEFAULT_PORTS = [4318, 4319];` —— SIGKILL 只作用在这两个端口上 |
| 同文件 `:20` 的注释 | 「4318 / 4319 是**为这个套件选的**：Vite 默认 5173、Next 默认 3000」 |
| `e2e/playwright.config.ts:16` | 「用 4318/4319 而不是 5173/3000：本机很可能同时开着别的项目」 |
| 同文件 `:88` | `vite --host 127.0.0.1 --port 4318 --strictPort`（链里没有任何段去 bind 3000） |

⇒ `pnpm check` **根本不碰 :3000**。我把"别 SIGKILL 别人的 dev server"这条规矩，
实现成了"等三个端口全空"，其中一个是那条规矩的**保护对象都不包含**的端口 ——
结果窗口条件比它要防的东西更严，等价于**永久等待**（09:32 起算了，到 g56 的 CAP 会打成 `S2_TIMEOUT`，
那句"环境无效≠产品失败"会是假的：环境一直是有效的）。

修法是 `research/tools` 之外的一次性链 `/tmp/g59-carrier-check-then-attribution.sh`：
窗口条件改成 **4318/4319 空 + `/tmp/tfa-test.lock` 没人拿 + 负载 ≤12**（阈值没动，动的是多出来那一档），
一条链串完：重算载体 → 装依赖 → **完整 `pnpm check`** → 载体**逐段** →
main 那棵树（配对基线 = 载体 `^1`）只跑"载体红的那些段" → 打 `只在载体红：`。
每段输出单独落 `/tmp/g59-seg-{c,m}-<段名>.log`，并额外数一次 `内存闸门拒绝启动` 的命中行数 ——
这样"红"能当场分成环境红与产品红，不必回头猜。

📌 可迁移的形状：**"等一个窗口"的每条条件都要能指回被调方的一行代码**。
我这条 `:3000` 是从上一轮某条命令里**抄来的形状**，抄的时候没人问过"谁会用这个端口"。
同族第三次（前两次：`substr($0,3)` 少跳一格、needle 抄台账节引）——
共同点是**探针的一格偏移/一个字符，都比它要防的缺陷更难发现，因为它错得很有道理**。

### 8.69 「没有发布任何现成镜像」这句对外话，今天有了一条带阳性对照的匿名探针（09:4x）

§8.21 改的那两句否认里有一枚事实断言：「没有现成镜像」。以前它的依据是
"发布 workflow 走不通（0 个 semver tag + `GHCR_NAMESPACE` 未设即 exit 1）"——那是**我们这一侧**的证据。
外人那一侧今天直接量了（匿名、只读、不带任何凭据）：

| 目标（同一段代码路径） | 读数 |
|---|---|
| 对照：`ghcr.io/home-assistant/home-assistant:stable` | **HTTP 200** |
| 对照：`ghcr.io/astral-sh/uv:latest` | **HTTP 200** |
| 我们：`ghcr.io/xaiver03/heyta-server:{latest,main}` | **403** |
| 我们：`ghcr.io/xaiver03/heyta:latest` / `…/supersync:latest` | **403** |
| 反例（说明 403 的含义）：`ghcr.io/containerd/containerd:latest` | **403** —— 这个组织是公开的，只是没有 `latest` 这一枚 tag |

⇒ 两句都要写下来才算读数：**(a)** 两条 200 证明探针**能**读到公开 manifest，所以那四枚 403 不是"网络/代理挡住"；
**(b)** 403 同时兼容"根本没发布"与"发布了但外人拉不到"与"tag 不存在"——
`containerd` 那条反例就是第三种。所以这句对外话在**外人视角**下成立（外人 `docker pull` 得到的东西确实不存在），
但它**不证明**"我们没发过任何一枚"。要证后者得看 GHCR 包列表（需要登录态，本批不做）。

复现：`node --input-type=module -e '…'`（`/tmp` 里那两份是一次性的，形状就是"先跑两条公开对照、再跑我们的"）。
📌 一般规律：**缺席断言（"没有 X"）的探针必须自带一条"X 在的时候它会响"的对照**，
否则 403/404/空集这三种形状会被同一句读数盖掉 —— 这条与 §7 第 46 条（"没复现 ≠ 没发生"）同族。

### 8.70 🔴 那三枚阻塞文件的脏行**逐行看过了**：两枚是同一个动作的遗留（约 15 小时未提交），第三枚才是别人在飞的活（10:0x）

`M` 只说"工作树与 HEAD 不同"，不说那几行是谁、为了什么、什么时候写的。
逐行读主检出的未提交 diff（只读，没动它）：

| 文件 | 脏行内容（`git diff --numstat` + 前几行） | 读出来的事 |
|---|---|---|
| `research/tools/check-image-license-coverage.mjs` | `+1 / −0`：多一条 `'@fastify/websocket@11.3.3': { license: 'MIT', source: '…' }` | 与下面那枚是**同一个动作**的两半：先重生成快照 ⇒ 版本变 11.3.3 ⇒ 门禁不认 ⇒ 只能手加一条许可登记 |
| `server/image-npm-tree.json` | `+3 / −3`：`generatedAt 2026-10-03T07:58:46Z → 2026-10-03T18:35:38Z`、`websocket 11.3.1 → 11.3.3`、`serverPackageJsonSha256` 换值 | 时间戳是**昨天傍晚** ⇒ 不是"此刻有人在写"，是留下后一直没人提交、也没人丢 |
| `package.json` | `+4 / −2`：新增 `check:ios-native-bridges`、`verify:ios-vault-keychain`，并改了 `check` 那一整行 | 这条才是真·别人在飞的活（iOS 那条线）；落地时 pkg 并集族必须把它一起并进去 |

⇒ 前两枚的落地路径其实有**两条都能收口**的，不止"等他们提交"这一条：
① 他们提交 ⇒ 合并按 §8.52 预置取本分支；② 他们丢弃那两枚（`git checkout --`）⇒ 合并根本没东西要撞。
两条终点相同：**main 带的是我们这份由提交物锁派生的快照**。
选哪条是他们的事；本批能做的是把"这两枚是一件事、且它只为绕开 main 那棵树上旧生成器的失真"写清楚，
别让下一轮把它读成"有人在改我们的工具"。

📌 与并行那条线撞出来的同一条规矩对上：**`M` ≠ 别人在飞 —— 要看脏行是谁写的、什么时候写的**。

---

### 8.71 载体算出来了（`6c4f5692`），代价是合并脚本多一整族 —— 而这一族的"取哪侧"**不由我判，由生产那一道门禁判**（10:1x–10:3x）

10:0x 手算载体时，脚本响亮退 2 并点名：

```
MERGE_HEAD=bb8ee476 已确认 · 冲突 3 条：docs/research/self-host-distribution-audit.md, package.json, server/image-npm-tree.json
❌ 出现**预置四族之外**的冲突路径，不许自动决定：
  - server/image-npm-tree.json
```

这一族是 §8.70 末尾那两条"终点相同"的路径在合并层的真身：**镜像 npm 依赖树快照**。两侧现量（读 `inputs` 的键集合，不读印象）：

| 侧 | `inputs` 里的键 |
|---|---|
| main（`aa2ddea1` 那份，10-03 18:35 生成） | `targetPlatform, registry, serverPackageJsonSha256, installShapeSha256, packedWorkspaceDeps, packedPackageJsonSha256, localTarballs, registryResolvedDeps, skippedForOtherPlatform` —— **没有** `packageLockSha256`，也**没有** `serverInstallInputSha256` |
| 本分支（`fac86036` 那份，10-03 23:21 生成） | 上面那些 + `serverInstallInputSha256` + `packageLockSha256: d2f9ab857b8e…` |

#### ① 解法写成"取本分支侧"，判据写成"把生产门禁挂进载体那六道"

取舍看着显然（合并后的树里既有那把锁、也有新生成器，取 main 侧一定红在 `check:image-license` 第一腿），
但**显然不等于量过**。所以我没有在解法块里自己拼一次 `sha256(server/package-lock.json)` 去比 ——
复制一遍判断就是下一个漂移点，而且真门禁比的是 `inputs` 里**四枚**哈希（安装输入 / 安装形状 / 三枚本地包的 `package.json` / 锁），
手拼那一枚只覆盖四分之一。改成把 `research/tools/gen-image-npm-tree.mjs --check` **原样**加进 `GATES`（现在六道），
在合并出来的载体树上现跑。只挂这一腿：`check:image-license` 后面那腿要从**真镜像**里取 `/app/package-lock.json`，
载体上跑不了 —— 挂进来等于把"载体 fs 门禁"偷换成"载体要建镜像"。

#### ② 新判据的强度是量出来的，不是声称的（一次性 detached worktree，不碰分支 worktree）

| 臂 | 动作 | 读数 |
|---|---|---|
| ARM0 | 分支那份快照（基线） | `exit 0`，「输入仍然对得上当下声明」 |
| ARM1 | 换成 main 那份 | `exit 1`，**5 处失真**（含"server/package-lock.json 变了（快照里的 packageLockSha256 与当下不一致）"） |
| ARM2 | 只往 `server/package-lock.json` 追加**一个字节**、快照不动 | `exit 1`，**恰好 1 处失真**且点名到锁那一腿 |

ARM2 是必要的：ARM1 一次红五条，分不清"锁这一腿有牙"还是"顺带被别的腿抓住"。
只动锁能单独转红，才证明"改了锁没重跑快照"这一整类失真有人守。

#### ③ 载体读数（`node research/tools/selfhost-merge-carrier.mjs`，10:31）

```
✅ 载体 6c4f5692 = main(aa2ddea1) × feat/self-host-distribution(fac86036)，分支 feat/self-host-merge-main 已指过去
· 冲突 3 条 → 分族 pkg=1 gi=0 png=0 audit=1 snap=1 other=0
· package.json 并集 scripts 键 146 个 · check 链段 main=76 本批=67 base=66 并集=77（摘段 0/0）
· 审计文档并集：保留 main 侧 50 行（含 1 个本分支没有的节标题）+ 本分支独有 1999 行，四条断言全过
· 合并归属：写 37 枚 / 合并相对 main 改 37 枚 / 集外 0 / 写集里未被改到 0 枚
· 双亲逐条完整 SHA 复核：p1=aa2ddea17ba3…（main）p2=fac860365fcd…（本批）
· 门禁 6 道全 exit 0
```

🔴 六道里那道**新**门禁 exit 0 是这一条的真正产出：它量的是"**合并后那棵树里的锁**"，
不是我 worktree 里那把锁。也就是说"取本分支侧的快照，在这棵合并树上仍然代表当下"这句话
从印象升级成了读数 —— 而这件事**只有挂门禁才能量到**，写在解法块里的手算比的是我这一侧的锁，
证的还是我这一侧。

#### ④ 阻塞集与 main 的漂移速率（引用前重取）

· 阻塞集现量（10:31，`selfhost-landing-blockers.mjs`）：夹具 **5/5** 通过 ⇒ "空"是可信读数 · 写集 37 枚 · 主检出脏条目 17 枚 · **阻塞集 0 枚**。
· main 在这一小时里 `e47bf28e → b5dae92f → aa2ddea1 → fc324e12`（四笔）。载体第一父是 `aa2ddea1`，
  所以**落笔那一秒它又落后了** —— 这正是脚本头注释写的那条"只认分支不认 SHA、main 每进一步就重跑"的用途，
  不是异常。
· 因此完整 `pnpm check` 由一次性链 `/tmp/g60-carrier-check-then-attribution.sh` 在**窗口开的那一秒**重算载体再跑：
  窗口条件三档全部指回被调方源码（4318/4319 空 ← `check-ai-e2e-preflight.mjs:37` 的 `DEFAULT_PORTS`；
  `/tmp/tfa-test.lock` 没人拿；负载 ≤12 —— **阈值一格没动**，动的只是 §8.68 那条多出来的 `:3000`）。
  g59 被我停掉不是它坏了，是它要跑的那个载体**还没有第五族**，check 完了也落不了笔。

#### ⑤ 边界（别读多）

· 载体 `6c4f5692` 不是落地。main 前进这一步仍要**主检出的所有者**执行：本批不动主检出、不 `git branch -f main`、不 push。
· 链与它的分段日志住在 `/tmp`（重启即失），住在仓库里的是**可重跑的两件装置**：
  `research/tools/selfhost-merge-carrier.mjs`（五族解法 + 六道门禁，已提交 `fac86036`）与
  `research/tools/selfhost-landing-blockers.mjs`（阻塞集 + 夹具自检）。读数没了可以重算，装置没了才算丢。

---

### 8.72 `check:md-tables` 对这份台账**一直是空跑**：它按命名白名单扫，而这份文件不在名单里（10:3x）

改完 §8.71 想验一下新加的三张表会不会破坏表格门禁，在分支 worktree 里跑 `node scripts/check-md-table-rows.mjs`
得到 `MODULE_NOT_FOUND` —— **这个文件在分支上根本不存在**（它是 merge-base 之后 main 那侧新增的门禁），
而载体（main × 本批）里有，所以载体的六道门禁报 `check:md-tables exit 0` 时读的是 main 那份。

于是在载体树的一次性 detached worktree 里把这份台账拷进去跑，得到 `✔ 9 个文件…一致`。
**这句话当时被我当成了"我的表没问题"** —— 差一步就问出真相：它为什么恰好是 9 个？

```bash
sed -n '54,64p' scripts/check-md-table-rows.mjs
```

`FILES` 是一张**逐条点名的白名单**（9 条：四条日历线的计划 + 回收站那条线的 5 份），
`docs/research/self-host-distribution-audit.md` **不在里面**，而且第 45 行的注释写明了扩展方式：
「它们收掉之后只需把路径加进下面的 `FILES`，判据本身不用改」。

⇒ **门禁绿与"我的文件被读过"是两件事**：白名单形状的门禁，报的"N 个文件"就是它的覆盖范围读数，
不比对文件数就等于把自己的表当成没人在看。这一条与 §7 里"挂在文件名枚举上的门禁，目标文件被删时安静地不执行"
是同一族的**镜像形状**（那条是文件没了还在报绿，这条是文件一直在但从来没被扫）。

#### ① 把路径塞进白名单实测，这份台账当场有 4 处真错位

| 行 | 症状 |
|---|---|
| `:532` `check:l4` 那行 | 表头 3 列（红段 / 是谁的 / 现量与修法），该行只有 2 格 |
| `:533` `@heyta/sync-server` 的测试 | 同上，归属与现量挤在同一格 |
| `:534` 其余各包 `pnpm -r test` | 同上 |
| `:535` `check:web-storage` | 同上 |

不是渲染洁癖：**这四行正是"这条红是不是本批自己造的"那一段的归属结论**，格子错位后
读者把归属读成现量的一部分，那段的本意（逐段可归属）就丢了。
修法：把归属收进第二列、现量留在第三列，四行逐条断言"开头串匹配 + 改后竖线数 = 4"再统一落盘
（一处不匹配就整批不落，不留半改状态）。

#### ② 收口读数与一条边界

· 修完在载体树那份 gate 上复跑：**`exit 0`，10 个文件**（9 + 这份台账），正向对照是同一条 gate 在修之前报的 4 处 ⇒ 它确实读这份文件。
· 🔴 **本批没有把它加进 `FILES`**：`scripts/check-md-table-rows.mjs` 在分支上不存在，
  在本批分支里"新建"这个路径 = 与 main 那份同名文件形成 add/add 冲突，而它的主人是并行那条线。
  ⇒ 记成**代价已经量好的待办**：谁下一次碰那个 gate，加一行 `'docs/research/self-host-distribution-audit.md',` 即可，
  现量成本 = **0 处违规**（登记"下批再做"之前先量贵不贵，这次量出来是不贵，但仍不归本批改）。
· 顺带又踩一次老坑：第一次跑那条命令写成 `node … | tail -14; echo RC=$?`，
  打出来的 `ARM2_RC=0` 是 `tail` 的码，而 gate 明明打印了 `✖ … 4 处`。
  这一族第三次（§7 第 45 / 179 条）。之后所有 rc 都改成**先重定向到文件、再取 `$?`**。

---

### 8.73 §8.67 那四张图**人看过的那份字节**现在在库里（`b9d11ed9`），而"要不要第六族"被一次 merge-tree 干跑变成了读数（10:4x）

§8.67 写"四张图逐张人看过"，而那四张里三张当时只活在**工作树**：

| 文件 | HEAD（05:53 那一趟 `5a369e0b`） | 人看过的 09:3x 那一趟 |
|---|---|---|
| `s1-app-loaded.png` | `02a937b6` | `02a937b6`（未变） |
| `s2-signed-in.png` | `cb9a891a` | `cea55108` |
| `s3-device-a-synced.png` | `889dc870` | `e0247fb5` |
| `s3-device-b-recovered.png` | `b0eba0b4` | `9309f623` |

截图目录是**定名覆盖式**的（`scripts/verify-selfhost-stack.sh:487` 把 `e2e/selfhost-stack-results/` 交给新鲜度探针），
任何一趟新跑都会覆盖掉 —— 而"主张指向的字节不在库里"没有任何一层会报红
（同族：证据 md5 被别人的 e2e 趟重写而无人报红）。所以三枚按路径提交，md5 逐枚写进提交说明，
让那句话指向**对象**而不是工作树。

#### ① 本来要加"第六族"，干跑之后没加

提交前的判断是：这几枚 PNG 两侧历史上都动过 ⇒ 会与 main 冲突，而 `selfhost-merge-carrier.mjs` 的
PNG 族只匹配 `apps/web/evidence/`，冲突会落进 `fam.other` 并 `die(2)`。
差一步就照这个判断写代码了。先跑一次不建工作树、不碰现场的干跑：

```bash
git merge-tree --write-tree --name-only main feat/self-host-distribution
```

出来三枚：`docs/research/self-host-distribution-audit.md`、`package.json`、`server/image-npm-tree.json`
—— **正是已预置的 audit / pkg / snap 三族**，四枚 PNG 全部 auto-merge（main 侧那几枚等于共同基线）。
⇒ 不写第六族。为一个没发生的冲突预置解法 = 给脚本加一段没有消费者的代码，
还要跟着改"每族至多一处"那条守卫。**真冲突该由 `die(2)` 响，那是设计好的响亮失败。**
📌 可迁移的形状：**"要加一族"这类判断先在 merge-tree 上干跑一次；成本几秒，收益是把推测变成读数。**

#### ② 载体第二次读数（分支 `b9d11ed9` 之后）

```
✅ 载体 5c08885b = main(2281f68e) × feat/self-host-distribution(b9d11ed9)，门禁 6 道全 exit 0
```

· `main` 期间又前进两笔（`fc324e12 → 2281f68e`），所以 §8.71 的 `6c4f5692` 已被替换 ——
  "只认分支不认 SHA、main 每进一步就重跑"这条规则第二次被真实消费。
· 完整 `pnpm check` 仍由 `/tmp/g60-carrier-check-then-attribution.sh` 在**窗口开的那一秒**重算后跑，
  所以这里连算两次载体不是重复劳动：载体必须是"被判那一秒的载体"。

#### ③ 一条只登记、不动手的环境读数

分支 worktree 现在剩 `?? e2e/node_modules`，`ls -ld` 是 `lrwxr-xr-x`（**软链**），
而 `.gitignore:1` 写的是 `node_modules/` —— **带尾斜杠只匹配目录**，软链挡不住（§7 第 196 条本机又现一次）。
本批**不碰它**：那枚软链是别的会话为 e2e 依赖搭的，删掉会让对方下一趟死在 `MODULE_NOT_FOUND`；
改成不带斜杠的 `node_modules` 要同时动本批的 `.gitignore` 族解法前提，属于撞车面。
后果边界写清楚：**任何用 `git ls-files -co --exclude-standard` 取打包集合的流程，在这个 worktree 里会把这枚软链当未跟踪文件送出去**
（§6.1.1 的 Windows 段正是这个形状；它跑在主检出，所以这一枚不在它的取集路径上）。

---

### 8.74 🔴 逐段归属拿到了 `只在载体红：（空）`，而这句话**不够关闭 #1** —— 七条红里有六条在载体侧根本没执行（10:51–10:54）

窗口在 10:51:27 开了一次（`load=10.4 tfa=no e2e_ports=0`），链一条命令跑完：
载体重算 `de66746d` = main(`6e38d5ce`) × 分支(`8fb9d488`)`CARRIER_RC=0`、`INSTALL_RC=0`、`E2E_INSTALL_RC=0`、
整链 `CHECK_RC=1`（`&&` 链只给第一红，所以逐段是必需的）、载体逐段 75 段、配对基线跑 main 那棵树。

| 段 | 载体 rc | 载体「内存闸门拒绝启动」行数 | main rc | main 拒绝行数 |
|---|---|---|---|---|
| `check:op-log-semantics` | 1 | **1** | 1 | 1 |
| `check:widgets` | 1 | **1** | 1 | 1 |
| `check:crosslang-contract` | **134** | 0 | **134** | 0 |
| `check:journey-coverage` | 1 | **1** | 1 | 1 |
| `check:ai-e2e` | 1 | **1** | 1 | 1 |
| `check:privacy-consent-e2e` | 1 | **1** | 1 | **0** |
| `check:landing-e2e` | 1 | **1** | 1 | 1 |

归属输出：**只在载体红：（空）** / 只在 main 红：（空）。

#### ① 🔴 但这张表**没有**关闭 #1，因为"rc 相同"不是"事实相同"

归属那一环比的是**段名 + 退出码**。逐条读日志才看见 `privacy-consent-e2e` 两侧的红**不是同一件事**：

· 载体侧根本没跑：`内存闸门拒绝启动：已有测试在跑（pid=89651，锁 /tmp/tfa-test.lock；它是：…/scratch-owner-transfer/rbac-d2/push-gated.test.mjs）`。
· main 侧真跑了，红在装配：`src/worker/storage.worker.ts(39,33): error TS2307: Cannot find module '@heyta/app-host'` → `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @heyta/web build`。

⇒ 载体这一趟对这六条**没有任何产品结论**（宿主内存闸门在起跑之后被别人拿走，正是 §8.65 ③
"起跑前的闸门不构成起跑后的许可"的第二次现量）。
`只在载体红：空` 在这里证明的是"**两侧一样红**"，而其中六条两侧都**没执行** ——
两个"没执行"相等不是"合并没坏"。**空集必须是执行过的空集。**
📌 可迁移的形状：**配对判据要比失败签名，不能只比退出码。** 退出码是两个集合的公共标签，
而"同一个标签下装着不同的事实"这一族本档已经记过三次（同 rc 的白屏/同 rc 的 404/同 rc 的拒绝启动）。

#### ② 两条自己装置的缺陷（都入档并要修，不掩盖）

· 链的 `BLOCKERS_AFTER` 报 `MODULE_NOT_FOUND`：第 4 段 `cd "$MT"` 之后再没回过分支目录，
  而 `research/tools/selfhost-landing-blockers.mjs` 是**批内工具、main 那棵树里没有**。
  "脚本假设 cwd 是真源仓库"这一族的又一次。事后在分支 worktree 里补现量：**阻塞集 1 枚 = `package.json`**
  （夹具 5/5 通过 ⇒ 这个"1"是可信读数）。
· main 那棵树的 `@heyta/app-host` 类型缺失提示：**配对基线跑之前没有 `pnpm -r build`**。
  载体侧整链跑过所以部分包已产 `dist`，main 侧只 install 不 build ⇒ 装配性红。
  ⇒ 这不是产品缺陷，是**载体没铺平**；下一趟两棵树都要先 build，否则"两侧一样红"可能只是"两侧都没铺平"。

#### ③ 阻塞集回到 1 枚意味着落地那一格又关上了

`package.json` 在主检出又是 ` M`（10:31 那一趟它是 0 枚）。#1 的第一句话就是
"等它被**其所有者**提交"，本批不代改、不动主检出。所以现在的状态是：
**载体可算、六道 fs 门禁绿、逐段可跑；落地被一枚别人的未提交 `package.json` 挡着，完整链被宿主内存闸门挡着。**
两件事各自有归属，不合并成一句"在等窗口"。

---

### 8.75 阻塞集那一枚 `package.json` 的**主人换了**（10:57 现量）—— §8.70 那条归属只在当时成立

10:51 载体重算前量到"阻塞集 1 枚 = `package.json`"，10:57 把那一枚的脏 hunk 读了一遍（只读 `git diff`，不动主检出）：

· 加了两条 scripts：`check:legal-closure-truth`、`check:legal-gdpr`；
· 并在 `check` 链里 `check:legal-host` 之后**原位插入**这两段。

⇒ 这是**法务/GDPR 那条线**的在飞动作，不是 §8.70 记的那条（那天读到的 `package.json` 脏行属于 iOS 线）。
两件事都是当时读当时对的，**归属是瞬时读数**：同一枚文件、同一天、两个主人。

对合并的实际影响：这条线的改动与并集解法**不冲突** —— 载体脚本第 1 族本来就是
"scripts 键并集 + `check` 链并集 + 四条断言（含两侧相对顺序不颠倒、相对 base 都不得摘段）"。
他们提交之后重算载体即可，两侧段都会进并集；**不需要**谁给谁让路。
真正卡住 #1 的仍然只是"落地那一刻不许把别人未提交的工作树并进载体"这一条。

---

### 8.76 两件"等待期"该做的事：第 2 项的证据**仍然覆盖当前 tip**（零产品字节差），以及两条只属于验证装置的坑（11:0x–11:4x）

#### ① 第 2 项（`verify:selfhost-stack` 全跑）的证据没有因为分支推进而失效 —— 这是量出来的，不是默认假设

那条全跑落在产物 `959fd1e6` 上。之后分支又走了五笔（第五族脚本、台账 §8.71–§8.75、看过的三张截图）。
"引用的运行落后于实际跑过的运行"是一族会悄悄烂掉的断言，所以逐文件现量：

```
git diff --name-only 959fd1e6..HEAD
  docs/research/self-host-distribution-audit.md
  e2e/selfhost-stack-results/s2-signed-in.png   ← 人看过的那版字节（09:3x 那一趟）
  e2e/selfhost-stack-results/s3-device-a-synced.png
  e2e/selfhost-stack-results/s3-device-b-recovered.png
  research/tools/selfhost-landing-blockers.mjs
  research/tools/selfhost-merge-carrier.mjs
git diff --stat 959fd1e6..HEAD -- packages apps server scripts  ⇒ **空**
```

⇒ **产品面字节自那次全跑以来一个没动**。第 2 项的证据对当前 tip 仍成立，
而这句话现在有取之即得的复跑命令，不靠印象。

#### ② 验证装置的两条坑（都不是产品结论，但都会让下一轮误判）

· **静默的等待循环等于挂了**。第一版配对链 `/tmp/g62-redpair-signature.sh` 的段前等待上限是 25 分钟，
  11:18 起跑后 10 分钟日志**一行没多**，看上去与"卡死"完全同形（§7 里"空日志≠卡住"那一族的**反向**用法：
  装置的输出必须能自证活着）。g63 改成每 60s 打一行 `... 段前等待中 load= tfa= e2e_ports=`，
  并把 25 分钟/段 收成 7 分钟/段 + 一个 `GLOBAL_CAP` 全局上限，超限的段**记 `NOT_EXECUTED`** 而不是继续等。
· **逐段当场等闸门，比"起跑前看一眼"贵但值得**：`privacy-consent-e2e` 那种"两侧都 rc=1、
  一侧其实没跑"的形状，只有在每段起跑前重新量一次 `/tmp/tfa-test.lock` 才不会被当成配对成功。

#### ③ 这一小时的机器现场（说明为什么"等窗口"今天是慢的）

`load=69.9 → 102.8 → 75.2 → 23.2 → 41.8`，11:37 起 `/tmp/tfa-test.lock=yes`（别的会话在跑测试）。
四条线（倒数纪念日、日历+Profile、回收站、本批）在同一天都要重验证窗口。
本批**不为此调低阈值**（`负载 >12 属环境无效` 是任务书里的原话），
等满 CAP 就按"环境无效 ≠ 产品失败"记，不写"没跑成所以没问题"。

---

### 8.77 §8.74 那七条红**拆开了**：一条其实是绿的、一条结构上不归本批、五条是环境拿不到读数（12:1x–13:2x）

#### ① 开窗判据的形状错过一次，现在改对了

g63 用"单次采样 load ≤12"开窗：`12:11:13 WINDOW_OPEN load=10.9` 起跑，**一分钟后机器打到 174.3**。
负载均值是指数衰减量 —— 别人那一趟刚起步时它还没上来，所以单次采样会把"正在起跑的重负载"读成窗口。
g64 换的形状：**连续三样**（间隔 20s）都 ≤12 且内存闸门没人拿且 4318/4319 空才算开窗，
并且**每条段起跑前重新量一次连串**（不是起跑前看一眼）。阈值一格没动，动的还是我自己那条形状。

#### ② g64 现量（载体 `30f0dfab` = main `5e09205d` × 分支，两棵树 install+build 全 rc=0）

| 段 | g60（无 build + 起跑前看一眼闸门） | g64（build 铺平 + 段前量连串） |
|---|---|---|
| `check:op-log-semantics` | 两侧 rc=1、两侧"拒绝启动"各 1 行 | **`rc_c=0 rc_m=0 env_c=0 env_m=0 EXEC=yes`** |
| `check:widgets` | 同上 | `SKIP_ENV`（连串等待 900s 超时，`load=244.2`） |
| `check:crosslang-contract` | 两侧 rc=134、两侧 env=0 | `SKIP_ENV`（`load=24.8`；归属改走结构层，见 ③） |
| 其余四条 | 同上（env=1） | 未到（13:28 手动停链，见 ④） |

🔴 **`op-log-semantics` 从来不是产品红** —— 它在两棵树上都**执行过并跑绿**。
g60 那张"两侧一样红"的表里，等号两边装的是同一个**装置缺陷**：
载体侧被宿主内存闸门拒绝启动（没跑），main 侧红在 `Cannot find module '@heyta/app-host'`（没 build）。
**配对判据若只比退出码，两个"没铺平"会伪装成一次成功的归因。**

#### ③ `crosslang-contract` 这条真红：归属由**结构**给，不等环境

三条独立读数（都是现取）：
· 本批写集 `b850b1c6..HEAD` 里 `research/spikes` 命中 **0 枚** —— 这条线从没碰过那个 C# 台架；
· 失败断言的标题（"计数与物化同数、含归档…P1-10"）在**本分支树里搜不到**，它住在 main 侧；
· 台架的 expect 桩 `research/spikes/sqlite-driver-csharp/vitest-shim.ts:177` 只实现了 `toBeGreaterThanOrEqual`，
  而调用方用的是 `toBeGreaterThan` ⇒ `Property 'toBeGreaterThan' of object is not a function`。

⇒ 归回收站/归档那条线（"含归档"那一档正是他们今天加的判断）。
本批**不代改**：那条 shim 与那条契约断言都在别人今天在写的路径里，动它会把这枚合并的评审面扩大。
读数是 g60 量的"两侧同一 rc=134"，加上今天这三条结构证据 —— 缺的是他们那一侧把它补齐，不是本批。

#### ④ 13:28 手动停链的理由，和停之前拿到的东西

13:09→13:24 两条 `SKIP_ENV` 的负载读数分别是 **244.2** 与 24.8；当天四条线（本批 + 倒数纪念日 + 回收站 + 日历/Profile）
都要重验证窗口，`≤12` 那一档几乎不出现。继续挂着只会把 turn 烧在等待上。
停之前已经拿到 ② 里那条**执行过的绿**，这是 #1 今天能推进的实际一格。

**下一趟怎么接**（同一件正事，剩下五条）：两棵树 `pnpm install --frozen-lockfile && pnpm -r build` →
连续三样安静才开窗 → 逐段配对跑 `check:widgets`、`check:journey-coverage`、`check:ai-e2e`、
`check:privacy-consent-e2e`、`check:landing-e2e`，每条**两侧都执行**才算一条配对读数，
并把失败签名并排打出来。装置已写好：`/tmp/g65-redpair-sustained.sh`（重启即失，逻辑就是本节这一段）。

#### ⑤ #1 现在的完整状态（五层分开写，不合成一句"在等窗口"）

| 层 | 读数 |
|---|---|
| 设计 | 五族解法 + 六道纯 fs 门禁，全部固化在 `research/tools/selfhost-merge-carrier.mjs`（§8.71） |
| 生产接线 | 载体 `30f0dfab` 第一父 = 当下 main `5e09205d`；并集链 77 段，main/分支两侧一段不缺（§8.71 后现量） |
| 失败与恢复 | 载体脚本遇未预置冲突族 `die(2)`；main 前进时 `die(4)` 不落笔；两件事都已在真输入下响过 |
| 平台验收 | 载体逐段 75 段：68 段 exit 0 执行过；7 段红里 **1 段今天两侧执行并跑绿**、1 段结构性不归本批、5 段环境拿不到读数 |
| 当前产物 | `feat/self-host-merge-main` 指向可复核载体对象；**落地那一格仍未做** —— 阻塞集 1 枚 = 别人的未提交 `package.json`（§8.75） |

---

### 8.78 落地执行卡（**只放指针与现量命令，不复述 §8.61 / §8.77 的内容**，13:4x）

本批离"关掉 #1"只差两个**外部条件**。两个各有一条 3 秒的现量命令，谁回来都不用重新猜：

| 条件 | 谁手里 | 现量命令 | 13:4x 读数 |
|---|---|---|---|
| A 未提交的重叠文件清零 | 法务/GDPR 那条线（主检出 `package.json`） | `node research/tools/selfhost-landing-blockers.mjs`（在分支 worktree 里跑） | 夹具 5/5 · 写集 37 · 脏条目 142 · **阻塞 1 枚 = `package.json`** |
| B 五条红拿到**执行过**的配对读数 | 环境（四条线抢重验证窗口） | `tail -40 /tmp/g65-redpair.log` | 连续三样安静始终没凑齐；load 峰值现量 247.0 / 165.7 |

A 归零之后的顺序（**命令本体在 §8.61 ④，判据在 §8.77 ⑤，这里不抄第二份**）：
① 重算载体（`node research/tools/selfhost-merge-carrier.mjs`，五族解法 + 六道门禁自己判）
② 由主检出所有者把载体并进 main（`--is-ancestor` 那条守卫先跑，绝不 `branch -f`、绝不 push）
③ 落地**之后**才起 `pnpm reinstall:all`（第 8 项；§6.1.1：本批改了 `apps/web`，排在落地前会装完即过期）。

B 的读数一到（五条各两侧都执行），#1 的平台验收那一格就从"68 段执行过 + 1 段两侧跑绿"变成"74 段有执行读数"，
剩下那一格（落地）仍然只能等 A —— **A 与 B 是两条独立的门，不许用其中一条的进展去宣布另一条。**

### 8.79 载体的落笔前门禁补到八道 · 第五族第一次真被消费 · 负载地板不在我这侧（2026-10-04 14:0x）

**这一节的起因是一句我信了三轮的注释。** 载体脚本里第 5 道之后那条门禁的注释写着
「🔴 只挂这一腿，不挂整条 —— 后面那腿 `--installed-tree` 要从**真镜像**里取树」。
今天实测才发现：它把**一个模式**当成了**两条腿**。
`check:image-license`（`package.json:47`）是三条腿的 `&&` 链，而第 2/3 腿在载体上跑起来
只读「提交物锁 / Dockerfile / 快照 / `server/package.json`」—— 里面的 `node_modules/<name>`
是**锁里的键形状**，不是磁盘路径（`check-image-install-contract.mjs:240`）。
⇒ 两条都在载体上 exit 0、不联网、不要 node_modules。

**为什么今天非补不可**（不是整洁）：main 正在动 `server/` —— 这一次重算，
`git diff --name-only <分支> <载体> -- server/` 就是 **60 枚**，其中一枚是 `server/package.json`，
它往 `devDependencies` 里加了 **`@heyta/app-host` / `@heyta/storage` / `@heyta/sync-client`** 三枚
（registry 上不存在的工作区包）。npm 在 `--omit=dev` 下**仍然解析** devDependencies 的每一枚 spec ⇒
不带 prune 的话第一条 install 就 E404。而这一族的修法正是本批 G-54 落的那条
`npm pkg delete devDependencies`（`server/Dockerfile:297`，注释里连 ADR-0050 那笔 `b3397cda`
的名字与两臂实测都印着：带三枚 devDep ⇒ rc=1；先删 ⇒ rc=0、`added 4 packages`）。
**守 prune 顺序与 prisma 三处同源的就是第 3 腿** —— 不挂它，"落地那一刻才发现镜像建不出来"
就还是可能的；挂了，它变成落笔前的判据。

现量（全部在这一趟打出）：

| 读数 | 值 |
|---|---|
| 阻塞集（`selfhost-landing-blockers.mjs`，13:47） | 夹具 5/5 · 写集 37 · 脏条目 143 · **阻塞 1 枚 = `package.json`**（法务/GDPR 那条线） |
| 只读预检 `git merge-tree --write-tree main HEAD` | rc=1，冲突面 **3 条**：本审计文档 / `package.json` / `server/image-npm-tree.json` —— 全在五族内 ⇒ 不 `die(2)` |
| 第五族第一次被**消费** | main 又用旧联网生成器重算了快照 ⇒ 真撞车；解法取本分支侧，`inputs.packageLockSha256=d2f9ab857b8e…`，新鲜度由第 1 腿在载体树上现判（exit 0） |
| 门禁（补挂第 2/3 腿之后） | **8 道全 exit 0** |
| 载体 | `ad15b4a7` = main(`a789687b`) × 分支(`47a81c99`)；链段 main=76 本批=67 base=66 并集=**77**、摘段 0/0；归属 写 37 / 改 37 / 集外 0 / 写集里未被改到 0 |

⚠️ `ad15b4a7` 在我写下它的那一刻就已经过期（本批紧接着落了 `281d37a1`）。
**载体只认分支名不认 SHA**，交接给的永远是判据 + 重算命令：
`node research/tools/selfhost-merge-carrier.mjs`。
⚠️ §8.78 那句"冲突面恰好 1 条"同样是瞬时读数 —— 它是"每写一次就要重取一次"的量，不是属性。

**接线有牙**（新增的不是判据，是**消费方**，所以臂打的是"循环认不认非零退出"这一层）：
往 GATES 尾部插一条必然红的门禁（`/tmp/ht-arm-fail.mjs`，退 1）⇒
`ARM_RUN_RC=3`、`feat/self-host-merge-main` 前后**逐字相同**（`27299dbc`…，没落笔）、
报告里点名到那一臂（`变异臂：必然红的门禁 在载体上退 1：ARM_GATE_RAN…`）、
还原后 `cmp -s` 逐字节相同、`grep -c 变异臂 = 0`。
注入器对 needle 断言命中数 = 1（照源码字面抄，第五次同族教训）。

**B 那条门的地板不在我这侧**（读数，不是抱怨）：g64 从 12:38 跑到 13:26，
**一个"连续三样 ≤12"的窗口都没开出来** —— 最低单样 11.1（13:06:16）但三样没连上，其余 12.7–24.8，
峰值 298.7（13:08:44）。而此刻最占 CPU 的是**一枚从 `heyta-wt-hierarchy` 逃逸的 vitest worker**：
98.9%、已跑 **15 小时**、`ppid=1`（父进程早没了）。它是另一条线的运行现场，
**杀它不是我这侧能替别人做的决定** ⇒ 登记，不动手。
⇒ 可迁移：**"负载高"要先量成"谁的负载"**；地板若是别人的一枚常驻进程，
我这侧调阈值只会把"环境无效"伪装成"已验过"。

**这一节真正要留给下一轮的一句话**：判"某条腿在某个载体上跑不了"，
要跑一次再说 —— 注释里那句理由是关于**另一种模式**的，而它挡住了两条本来免费的落笔前判据。

### 8.80 落地那一刻的两条外部条件：一条已满足、一条仍在别人手里（2026-10-04 14:0x）

**先把"现在能不能落"量清楚**，免得下一轮再重新推：

| 判据 | 命令 | 14:04 现量 |
|---|---|---|
| 落地守卫的前提（载体第一父就在 main 上） | `git merge-base --is-ancestor "$(git rev-parse feat/self-host-merge-main^1)" main` | **成立** —— `载体^1 == main == a789687b`（逐字相同） |
| 阻塞集 | `node research/tools/selfhost-landing-blockers.mjs` | 夹具 5/5 · 写集 37 · 脏条目 148 · **仍是 1 枚 = `package.json`**（法务/GDPR 那条线） |
| 冲突面 | `git merge-tree --write-tree --name-only main HEAD` | rc=1，3 条，全在五族内 |

⇒ **机械上唯一还差的动作是别人提交 `package.json`**，而 main 每分钟都在动，所以"守卫前提成立"
这一格**每交接一次都要重取**，它不是属性（§8.16 起就记过这条）。

**落地前顺带把 main 新带的 5 枚迁移量了一遍**（`git diff --name-only b850b1c6 main -- server/prisma/migrations` = 5，
含 `20261009…add_vault_key_packages` / `20261011…atomic_vault_key_migration` / `20261013…add_holiday_adjustments`）：

- `node scripts/check-migrations.mjs` 在**载体树**上 = **exit 0**（47 个迁移文件、其中 9 枚含 CONCURRENTLY）。
  这一条不是"载体专属门禁"，所以我**没有**把它挂进 GATES —— 挂进去只会让"别人自己的迁移不合规"
  变成"我这侧永远算不出载体"，那是把合并的可用性扣在别人的债上。**它属于落地那一刻的完整链**。
- 为什么值得当场量：D-3 那句对外承诺是"外人一条 override 就把表结构起来"，走的是
  `migrate-deploy.sh`（不是 `prisma migrate deploy`），而校验器检查的正是那个解析器的前提
  （整行注释、语句行尾分号、CONCURRENTLY 单语句形状）。形状层**没有**被这 5 枚撞坏。
- 🔴 边界写清楚：**"静态形状合规"不等于"新库上跑得过"**。这 5 枚在首次安装的**空库**上没有运行读数 ——
  那要么等落地后在载体上重跑 `verify:selfhost-stack`（第 2 项那一格会因此需要一次新读数），
  要么由它们的所有者在自己的 pglite/集成用例里给。**本批不在分支树上替 main 的迁移取这个读数** ——
  分支树里根本没有这 5 枚文件（`git diff … main -- server/prisma/migrations` 就是它们）。

**G-50 仍挂着，但阻塞理由换了**（14:03 现量）：`packages/i18n/src/locales/{zh-CN,en}.ts`
在主检出**仍是 `M`**。所以今天动它 = 把**两枚**新文件加进落地阻塞集（§8.52 那套口径），
而不是"等它们变干净"。⇒ 结论不变（登记，不现在动），但理由从"5 个重叠文件之二"改成
"现在做会让阻塞集从 1 枚涨到 3 枚"。

**本节的自查读数**：`docs-link-check` exit 0；`check:md-tables` 在装了本台账的臂里 exit 0 / 10 个文件
（§8.79 那张两列表在内）；载体脚本改完后的两次重算分别打出 `ad15b4a7` / `1e18b22c`（8 道门禁全 exit 0）——
**SHA 都不作交接依据**，交接只给分支名 + 重算命令。

### 8.81 「绿即结案、红才配对」：B 那条门的形状被自己的读数改了（2026-10-04 14:1x）

**起因是一笔白等**：g64（12:38–13:26）加 g65（13:28–14:07）合计约 75 分钟，
一个"连续三样 ≤12"的窗口都没开出来（地板 12.7–62.0，峰值 401.2/298.7），
**五段一条都没执行**。这不是"环境无效≠产品失败"那一格的正当用法 —— 那条规则是为
**读数会被负载污染**服务的，而我把"等窗口"放到了**所有**动作前面（连安装和构建都在窗口后面）。

**关键区分（这才是这一节的内容）**：负载造成的是**假红** —— 超时、抢不到端口、内存闸门拒启动；
它**不会把没跑的断言变成通过**。⇒ 协议改成三段：

1. 先在载体上**不等窗口**跑一次。绿 ⇒ **结案**（配对问题根本不存在：载体绿不需要 main 侧对照）；
2. 红 ⇒ 立刻**同树复跑**一次，区分负载噪声与稳定红；
3. 仍红 ⇒ 才去等窗口做 main 侧配对读数（原协议）。

**"绿"必须看得见执行**，否则就等于把跳过读成通过 —— 两层判据：日志里有汇总条数就按条数
（`passed≥1` 且 `skipped` 为 0 或缺席），没有条数就按**那条门禁自己打的覆盖标记**。

🔴 **第一轮（14:12）就产出了一枚假读数**：`scripts/check-widgets.mjs:245` 用
`execFileSync(..., {stdio:'pipe'})` 委派 vitest，而那份输出**只在失败时**才被打出来 ⇒
成功时日志里没有条数 ⇒ 我的 `passed=NA` 把一枚 `rc=0` 读成"没执行"，白跑一次复跑、差一点又去等窗口。
两层判据补上后它当场结案。而 `rc=0` 本身**就是**那个被吞掉输出的 vitest 退 0 的证明
（`execFileSync` 非零即 throw；vitest 在"没收到测试文件"时也是非零）。

**按段的端口面（另一处我原来写错的形状）**：`scripts/check-ai-e2e-preflight.mjs:37/44/78-83`
kill 的只有**传给它的那几枚端口** —— 默认 4318/4319，privacy 那条传 4322，landing 那条传 4320，
**从不碰 3000**。14:10 现量：4318/4319 正被别人的 node 听着（pid 29596 / 29585），4320/4322 空。
⇒ 把安全条件写成"全局端口表（含 3000）"会把四段本来能跑的读数白白扣住；
而 **`check:ai-e2e` 真正的地不是负载，是那两枚端口的所有者让位**（这一条要改写成"待窗口"是错的）。

**两处我自己的探针 bug，都被同一次误读逮住**：

1. `MT=$(sed -n 's/^="\(.*\)"$/\1/p' …)` 因为脚本里写的是 `MT=/tmp/…`（**没引号**）而取到**空串**，
   于是 `cd "$MT"` **静默落在当前目录** = 主检出，把 `M .gitignore / AGENTS.md / PROGRESS.md`
   读成了"配对树脏 ⇒ 配对树不可用"。实际 `/tmp/heyta-main-check` 干净、已跟到载体第一父。
   ⇒ **跨树探针一律 `git -C "$TREE"`，并在脚本开头断言这些变量非空**（`cd ""` 不报错，这是它最贵的一处）。
2. 载体树里我提交的那三张证据 PNG 的 mtime 被 `git checkout` 刷成了 14:14。
   ⇒ **任何按 mtime 判"这是这次跑出来的"的判据，在会被 re-checkout 的树里只证明"刚被写过"**，
   不证明"刚被跑出来"。分支 worktree 那 09:32 才是真跑的时刻；对外那一锚我已经换成**提交物字节**（md5）。

**14:15 的结案读数**（载体 = main × 分支，两棵树的 install / `pnpm -r build` / e2e install 先做完，
这些**不是读数**所以不该排在窗口后面）：

| 段 | 读数 | 处置 |
|---|---|---|
| `check:widgets` | rc=0，标记「扫描 **12** 个文件 + **4** 份黄金夹具，**5** 条规则」 | **结案，不需要配对** |
| `check:journey-coverage` | rc=0，**36 passed**，标记「web 旅程验收跑通」 | **结案，不需要配对** |
| `check:ai-e2e` | 14:15:14 起跑（写这一节时仍在跑，前 9 条逐条 ✓） | 待读数 |
| `check:privacy-consent-e2e` / `check:landing-e2e` | 排队中 | 待读数 |

**第 2 项的证据重新钉了一遍**（不靠"那几笔只是文档"这句印象）：
09:14 那趟 `VERIFY_EXIT=0`（`/tmp/g56-browser-check.log`）里逐条是 —— VCS_REF=`959fd1e6`、
真镜像树对账 **145 = 126 + 16 + 3**（无解释 0 · 非宽松 0 · 声明对不上 0 · 失效登记 0）、
G-53 那一族 14 枚平台受限条目逐条过同一套许可证权威、`selfhost-web` **3 passed**、
`FRESH=4/4`（09:32:45 / :49 / :52 / :53）。两条祖先关系也现量了：
prune 修法 `89cda0df` **是** `959fd1e6` 的祖先 ⇒ 那趟构建**带着**修法；
`git diff --name-only 959fd1e6 HEAD` ∩ 22 条镜像输入 = **交集 0**
（用清单自己的读者 `cd server && . scripts/image-inputs.sh`；阳性对照 = 同一命令去掉 pathspec 回 **6**）。
⇒ 这一格的"当前产物"覆盖到分支 tip，不需要重跑。

⚠️ 这一节**没有**宣布"77 段里有多少段带执行读数"—— 那个总数要在五段读数齐了之后按日志逐段点，
留给 §8.82。

### 8.82 `check:ai-e2e` 的那一枚红用**结构层**结案（不靠窗口），外加第 8 项的前置现量（2026-10-04 14:2x）

**载体上的执行读数**（`/tmp/g66-c1-check:ai-e2e.log`，14:15:14–14:21:24）：
`Running 157 tests using 1 worker` → **154 passed / 2 skipped / 1 failed**，rc=1。
唯一红的那条是 `tests/list-folder.spec.ts:72`「清单移入文件夹：入口常驻、跨刷新还在、非法目标不给点」，
**首次与 retry #1 都红**（同一签名，不是抖动）。

**这一条不需要等窗口就能结案**，靠的是两条现量而不是印象：

1. **交集 0**：本批写集 37 枚 ∩ { `apps/web/`、`e2e/tests/`、`e2e/playwright*.config.ts`、`packages/*/src/` } = **0 条**。
   `packages/` 下只有两枚 `package.json`（`shared-schema` / `sync-core`），逐条 `--numstat` = **+1 −0**，
   改的就是那行 `"license": "MIT"` 声明；`pnpm-lock.yaml` 与 `e2e/pnpm-lock.yaml` **都不在写集**
   ⇒ 那条 spec 的被测应用与依赖解析在 main 和载体上**逐字节相同**。
2. **归属通式「集外 0」**（载体脚本每次重算都跑的那条）：合并只写了本批自己写过的路径 ⇒
   载体树上凡是本批没写过的字节都等于 main ⇒ **这条红不可能由合并引入**。

🔴 **阳性对照（这条方法有牙）**：同一条交集法对 `check:landing-e2e` 报的是 **5**
（本批改了 `apps/landing/**`，而 `e2e/playwright.landing.config.ts:30` 的 `testDir: './landing'`
跑的正是这个 app）⇒ 上面那个 0 **不是**"探针扫不到"。
🔴 **边界（两条都不许越）**：结构论证证明的是"**不是本批造成的**"，**不证明**它在 main 上此刻红着
（那需要一发 main 树上的执行读数 —— 与正在跑的 `check:ai-e2e` 抢同一对 4318/4319 端口，
所以现在跑只会造自己的假红，**排在 g66 之后单跑那一条 spec、两次同签名即结案**）；
更**不**等于本批去修它 —— `list-folder` 是别人那条线的界面用例，AGENTS「绝不代改他们的」那一档。

**第 8 项（落地后的 `reinstall:all`）的前置现量**（14:21 只读取证，没动任何别人的现场）：

| 端 | 前置 | 读数 |
|---|---|---|
| android | 设备在 | `emulator-5554 device` |
| windows | 打包机可达 | `ssh windows-pc` → `SSH_OK`（附 openssh pq.html 提示） |
| mac | 现装产物在 | `/Applications/Heyta.app` 在 |
| ios | 🔴 **六枚模拟器正被 Booted** | `heyta-batch2-closeout` / `heyta-bc-reminders` / `heyta-iphone-17pro` / `heyta-ios-isolated` / `iPhone Duo heyta` … |

⇒ ios 那一段的动作里有 `simctl uninstall` —— 落在别人正在取证的设备上会**毁掉他们的证据**，
所以这一格要的是**所有者让位**，不是"负载降到 12 以下"。（它本来就排在落地之后，不构成现在的阻塞。）

**顺手补上的一条覆盖缺口登记**：今天的并集是 **77** 段，而 `check:entries` 这一段在载体上
**从没执行过**（把并集段名与 g60 那趟 75 行 `SEG_CARRIER` 逐名对账，只有它多出来；
另一个"多出来"的 `-r` 是我自己解析 `pnpm -r test` 取的**假名**，不是缺口）。
它本身是 fs 类、可以当场补，但它会**重新生成入口页并与提交物逐字节比** ⇒
与正在跑的 `check:ai-e2e` 同时动 4318/4319 会互相造红 ⇒ 命令记在这里，排在 g66 之后跑：
`pnpm --filter @heyta/landing check:entries`（在载体树上）。

### 8.83 g66：把"等窗口才起跑"换成"绿即结案"之后，真该等的**不是负载，是那把锁**（2026-10-04 14:3x）

（读数取自分支 `feat/self-host-distribution` 上的 `/tmp/g66-readings.log`、`/tmp/g66-summary.txt`、
`/tmp/g60-carrier-check.log`、`/tmp/g60-seg-{c,m}-check:landing-e2e.log`，时间戳 2026-10-04 14:15–14:35。）

**① 协议换掉了，两条立刻从"没执行"变成结案。** g60 那趟是"没有干净窗口就不起跑"，
于是五段里四段压根没执行；g66 改成**先在载体上无窗口跑：绿就是读数，红才复跑/配对**。
理由是负载造成的是**假红**（超时、抢不到端口），它不制造假绿 —— 所以绿不需要窗口。

| 段 | g60 | g66（载体，load=39.3） |
|---|---|---|
| `check:widgets` | rc=1 内存闸门=1（没跑） | 14:15:10 RUN1 **rc=0** ⇒ 14:15:12 SETTLED |
| `check:journey-coverage` | rc=1 内存闸门=1（没跑） | 14:15:12 RUN1 **rc=0 passed=36** ⇒ 14:15:14 SETTLED |

**② 但"绿"要能被认出来，而 `counts()` 认不出。** 第一趟我就是这么把一枚 rc=0 读成"没执行"的：
`scripts/check-widgets.mjs:245` 用 `execFileSync(..., {stdio:'pipe'})` 跑 vitest，**成功时把输出整个吞掉**，
只有失败才打 ⇒ 日志里没有 `N passed`。修法不是改判据放宽，是**两层结案**：看得见条数就按条数，
看不见就按**那条门禁自己打的覆盖标记**（widgets 打"扫描 12 个文件 + 4 份黄金夹具，5 条规则"，
journey 打"web 旅程验收跑通"）。rc=0 本身已经证明被吞掉的那次 vitest **退的是 0**
（`execFileSync` 非零即 throw），而"一个测试文件都没找到"在 vitest 下是非零退出，伪装不成绿。

**③ `check:ai-e2e`：稳定红，配对**没**执行 —— 卡它的是锁，不是负载 12。**
两趟同树同签名（RUN1 14:15:14→14:21:24、RUN2 紧随），`rc=1 passed=154 skipped=2 failed=1`，
败的是 `tests/list-folder.spec.ts:72`，两趟收集到的失败集合哈希逐字相同（`c1=c2=7e7a96bad838a397b91645c451b8e0e0`），
归属已由结构层在 §8.82 结案（写集 ∩ 该段消费的输入 = 0 + 载体"集外 0" + 正向对照 landing-e2e=5）。
等待连串的心跳把真实原因打在日志里：

```
14:28:52 load=39.8 tfa=yes ports=none
14:29:53 load=42.2 tfa=yes ports=none
14:30:54 load=50.2 tfa=yes ports=none
```

`ports=none` —— 4318/4319 **是空的**，端口面根本没挡；挡的是 `tfa=yes`。
14:35 现量那把锁的持有者是 pid 79513：

```
/bin/sh /Users/rocalight/.tfa-shield/bin/node scripts/run-gated.mjs --heap-mb=1024 --limit-mb=1024 \
  -- node --test --test-concurrency=1 --test-reporter=spec scripts/test/{gates,host-headroom,host-shield,run-gated}.test.ts
```

**这是别的仓库的测试，不是 heyta 的**（锁 `/tmp/tfa-test.lock` 是主机级串行装置）。
⇒ "等 load≤12"这一条对这几段本来就是错的条件：它们等的是一次**全局验证窗口**，
负载降到 12 也照样会被闸门拒绝。我不去摘那把锁，也不绕过那个 shim —— 它和用户那条
"跑验收不得抢别人的东西"是同一件事。

**④ 那两段的归属，用 g60 已有的同签名对读数结案，不需要新窗口**：

| 段 | 载体（g60） | main（g60） | 判 |
|---|---|---|---|
| `check:landing-e2e` | rc=1 内存闸门=1 | rc=1 内存闸门=1 | **两棵树同一把锁同一签名**（日志里连 pid=89651 与那句"它是：…/scratch-owner-transfer/rbac-d2/push-gated.test.mjs"都逐字相同）⇒ 环境，不是本批 |
| `check:privacy-consent-e2e` | rc=1 内存闸门=1（没跑） | rc=1 内存闸门=0，跑到了编译：`avatar-encode.ts(96,55) TS2322`、`ErrorScreen.tsx(27,24) TS2307 Cannot find module '@heyta/design-system'` | main 侧那枚红是 **main 自己的债**（它连我们改的都没碰）；载体侧仍是**未执行**，不假装结案 |

**⑤ §8.82 登记的那条覆盖缺口当场补掉了**：`pnpm --filter @heyta/landing check:entries`
在载体树 `a250e6da` 上 **rc=0**，打的是"入口文件与注册表一致（**75** 份）"。
⚠️ 第一次我是拿管道读的退出码，`${PIPESTATUS[0]}` 在 zsh 里是**空值** ⇒ 打成 `ENTRIES_RC=NA`；
把输出重定向到文件再取 `$?` 才拿到 0（§7 第 184 条同族）。

**⑥ 🔴 这一趟里 main 前进了两回，载体自己重算了两次 —— 现在这枚载体不是落地那一枚。**

```
14:1x  载体=d4b63beb 第一父=6fdb517f
14:3x  载体=a250e6da 第一父=a49c4f19 第二父=e2b8d764
main 现量（14:35）= 1930f2b5，分支现量 = 5a4b9e35
git merge-base --is-ancestor feat/self-host-distribution main ⇒ NO（还没落地）
```

`a250e6da` 的两个父**都**旧了（main 又走了一笔 `1930f2b5`，分支又落了一笔 §8.82 的文档）。
所以本节的每一条段读数都是**那一枚具名载体上的**读数，它不等于落地那一刻的读数 ——
落地前必须重算 + 重扫（载体脚本自己就写了这条：只认分支不认 SHA，main 每进一步都要重跑）。
⚠️ 连**分母**都要现数，而且**先钉死计数单位**——同一棵树上能数出三个不同的数：

| 数的是哪棵树 | 按 `&&` 切的项数 | 其中 `pnpm <段名>` 形状的段 |
|---|---|---|
| 载体 `a250e6da` | 77 | **75** |
| main 现 tip `1930f2b5` | 76 | **74**（另 2 项是 RAW：`pnpm --filter @heyta/landing check:entries` 与 `pnpm -r test`） |
| 🔴 主检出**工作树**（就是那枚阻塞文件） | 81 | **79** |

`git show main:package.json` 与工作树逐名对账，工作树比 main **多 5 条门**：
`check:legal-closure-truth`、`check:legal-gdpr`、`check:vault-diagnostics`、`check:apk-freshness`、
`check:shell-erasure-parity`（全是别人那笔未提交改动挂上去的，不是我们的）。
⇒ **等 `package.json` 那笔提交上去，落地那一枚载体的并集会自动带上这 5 条** ——
落地扫描的分母既不是 75 也不是 81，是那趟现场数出来的数；本节这些读数**不**声称覆盖它。
现数命令（对着哪棵树就在哪棵树下跑）：

```bash
node -e 'const p=require("./package.json");const i=(p.scripts.check||"").split("&&").map(x=>x.trim()).filter(Boolean);
console.log("项数="+i.length+" 段名数="+i.filter(s=>/^pnpm [\w:-]+$/.test(s)).length)'
```

**⑦ 顺手把"本节那张表被 md-tables 判过了"这个误读挡掉**：`scripts/check-md-table-rows.mjs` 的
`FILES` 是**显式清单，9 枚**（现量：`node -e` 数载体上那份脚本的数组，本档 `含本档=false`），
`docs/research/self-host-distribution-audit.md` **不在里面** —— 所以 §8.83 这三张表**没有被那道门判过**，
那道门对它们既不是绿也不是红，是**没看**。这条不是新缺口，就是 §8.82 末登记的那条
"等它的所有者下次碰它时把本档加进 `FILES`"同一件事；今天把代价**重新现量了一遍**：
把那枚脚本的 `FILES` 换成只剩本档的一枚拷贝、在分支树上跑 ⇒ `rc=0`，打的是
"✔ markdown 表格行：1 个文件，列数、断行与“是不是表”都一致"（文件 5095 行，含本节新写的三张表）。
⚠️ 另外记一笔形状：**在分支树里直接 `node scripts/check-md-table-rows.mjs` 得到的是
`MODULE_NOT_FOUND`** —— 那道门是 main 侧的，分支上还没有这个文件。它不是红，是**走错了树**；
把它当红报就会把"我没带那个工具"说成"这条门禁挂了"。

**⑧ 阻塞集现量（14:35）**：夹具 5/5 · 写集 37 枚 · 主检出脏条目 169 枚 · **阻塞集 1 枚 = `package.json`**。
main 最近 8 笔全是别的线的文档（`docs(ai-goal)` ×6、`docs(handoff)`、`docs(selfhost)`），
他们正在往里落，`package.json` 那一笔是同一批的活 —— 等它，不代改。
**下一步（已起成一次性后台链 g69，它不含 merge 动作）**：轮询阻塞集归零 → 重算载体 →
在**新载体**上逐段扫链（端口面按段现查，占着就响亮跳过，绝不 SIGKILL 别人的 dev server）→ 出报告。
落地那一笔（`git merge --no-ff`，§8.61 ④ 的守卫序列）等报告齐了再由人拍。

### 8.84 阻塞集从 1 枚涨到 2 枚，多出来那枚在**我们自己的写集里**，而且别人正在敲它（2026-10-04 14:4x）

**现量**（`node research/tools/selfhost-landing-blockers.mjs`，14:41 那一趟，全原文）：

```
main = d636b010 · feat/self-host-distribution = d2a34a79 · merge-base = b850b1c6
夹具：5/5 条通过 · 写集 37 枚 · 脏条目 177 枚 · **阻塞集 2 枚**
  BLOCK package.json                                落地解法：取并集（载体脚本已实现…）
  BLOCK research/tools/gen-image-npm-tree.mjs       落地解法：未预置 ⇒ 交人判（不要猜）
```

六分钟前（§8.83 ⑧）是 **1 枚 / 脏条目 169**。多出来那一枚不是别人的边角文件：
它是 **G-47 那把生成器**，就在我们那 37 枚写集里，同时是载体八道门第 6 道
（`gen-image-npm-tree.mjs --check`，判第五族 `server/image-npm-tree.json` 的新鲜度）的**被消费方**。
主检出那个文件 `stat` 出来是 `Oct 4 14:40:07`，比我这次取数**早 60 秒** ⇒ 那不是遗留的脏，那是**正在写**。

**他在改什么**（`git diff` 现量 +31/-2，注释原文照抄）：把 `--check` 的指纹从"整个 `package.json` 的 sha256"
收窄到七个依赖相关字段 —— `dependencies / devDependencies / optionalDependencies / peerDependencies /
overrides / engines / packageManager`，理由是"一杆对无关改动乱响的尺子会训练人忽略它——真到依赖漂移那天
反而当噪声放过去"。**这条理由我认同，它也不动我们的立场**（收窄前加一条测试脚本名会让 `--check` 红，
收窄后仍然盖住全部会改变安装结果的面）。

🔴 **但它带一条连带的落地风险，写在这里是为了落地那一趟不措手不及**：他注释最后一句是
"改这个函数的取值集合 = 换了指纹口径 ⇒ **必须重跑生成器落新快照**"。如果他提交时只交了脚本、
没重跑 ⇒ `server/image-npm-tree.json` 里那个指纹与新口径算出来的对不上 ⇒ `check:image-license`
**第 1 腿在 main 上红**；而那一腿正是第五族的裁判 ⇒ 落地扫描里会出现一枚**"看起来是载体红"的 main 侧红**。
处置写清楚，三条都不要做/都要做：

- **不**把它当本批缺陷，也**不**"顺手把快照重跑一遍" —— 那是替他改他正在写的文件（AGENTS §8 共享资源独占）；
- 归属用现成的两层：先 §8.82 那条结构层（写集 ∩ 该段消费的输入），再同一趟在**载体与 main 各跑那条腿一次**，
  同签名即 main 侧；
- 那枚阻塞的落地解法工具自己写着"**未预置 ⇒ 交人判（不要猜）**"，我照抄，不自作主张取哪一侧。

**顺带一条我自己探针的形状**：g69 里"阻塞集归零"用的是 `grep -c 'BLOCK '`，不是解析
"阻塞集 N 枚"那句中文汇总（那要跨 CJK 与粗体标记，而 `BLOCK ` 是 ASCII 且**每条阻塞恰好一行**）。
第一炮就打出 **2**，而我按 14:35 的记忆预期是 1。⚠️ 说清这发阳性对照证明了什么：
它证明**计数器没有静默归零**（拿一个此刻必然非空的集合喂它，返回非零且与工具自己的汇总行数一致：
2 行 BLOCK ↔ "阻塞集 2 枚"）；它**不**证明"世界没变" —— 过期的是我脑子里那个"1"。

**g66 已在 14:31 停掉**：它的 `check:ai-e2e` 配对等的是 `load≤12`，而真挡它的是全局验证锁
（§8.83 ③：`ports=none` 而 `tfa=yes`），等下去只会等到 `SEG_CAP` 用尽并留下一条假"环境无效"。

**g69 已起（后台，它**不含** merge 动作）**：`/tmp/g69-land-preflight.sh` ——
轮询 `BLOCK ` 行归零（上限 90 分钟，用尽记 `NOT_EXECUTED` 并以 exit 3 收尾）→
重算载体并断言**第一父 == main 现量**（不等就判 `STALE` 退出，不留半截读数）→
在载体上备安装/构建输入 → **分母从载体自己的 `package.json` 现取**（连 `pnpm -r test`
那种带参数的 RAW 项也逐字执行）→ 逐段跑，端口面**按段现查**，占着就 `SKIP_SAFETY`
（`check-ai-e2e-preflight.mjs` 只 kill 它自己拿到参数那几个端口）→ 汇总列出
`SEG_TOTAL / rc=0 / 内存闸门拒绝 / SKIP_SAFETY / NOT_EXECUTED / 红集` 与
"只在载体红（对 g60 已知红集取差）"，末尾把守卫序列**打出来给人执行**。

### 8.85 那枚阻塞不是一个文件，是一个**共同提交集**；而载体第 1 道门当时看不见它 —— 补了判据，四条读数齐（2026-10-04 14:4x）

§8.84 记下阻塞集涨到 2 枚。把它挖开一层：脏的那枚 `package.json` 的链里**多了 5 道门**，
而这 5 道的**实现文件不在一起**（`git cat-file -e main:<路径>` + `git ls-files` + `git check-ignore` 逐枚现量）：

| 链里新增的门 | 实现文件 | 在 main 里 | 在索引里 | 在盘上 | 被忽略 |
|---|---|---|---|---|---|
| `check:legal-closure-truth` | `scripts/check-legal-closure-truth.mjs` | ✅ 有 | 已暂存 | 在 | 否 |
| `check:legal-gdpr` | `scripts/check-legal-gdpr.mjs` | ✅ 有 | 已暂存 | 在 | 否 |
| `check:vault-diagnostics` | `scripts/check-vault-diagnostics.mjs` | 🔴 无 | **未跟踪** | 在 | 否 |
| `check:apk-freshness` | `scripts/lib/apk-freshness.sh` | 🔴 无 | **未跟踪** | 在 | 否 |
| `check:shell-erasure-parity` | `scripts/check-shell-erasure-parity.mjs` | 🔴 无 | **未跟踪** | 在 | 否 |

⇒ 那枚阻塞的真身是**一个共同提交集**（`package.json` + 三枚未跟踪实现）。
如果他只提交 `package.json`，链里就留下**三枚指向不存在文件的门**。
而这类形状**不在合并冲突里** —— `merge-tree` 看文本、第 1/3 条对齐判据看定义与链，两边都看不见"文件不在树上"。

**注入实测：当时的门禁是瞎的。** 造一份候选 `package.json`（= `git show main:package.json` + 加一道
`check:does-not-exist-xyz` → `node scripts/definitely-not-here-xyz.mjs`，并把它挂进链），
拿**主检出那份未改的门禁**跑 `--pkg`：`CTRL_RC=0`（main 原样）与 **`INJ_RC=0`（注入了悬空门）—— 结论句照打、退出码 0**。
再用他工作树那份真脏 `package.json` 打同一枚旧门禁：`DIRTY_RC=0`，点名 0 枚。**这就是"链绿但一整段根本跑不了"的形状。**

**补的判据**：`scripts/check-gate-wiring.mjs` 加第 **3b** 条 ——
链里每道门的定义若能认出 `node|bash|sh <仓库内路径>`，那枚文件必须在这棵树上存在；
带 `cd` 的、`pnpm --filter X <script>` 的、路径落在 `node_modules` 的**不判**，
并把 **"实现文件判了 N 段、跳过 M 段"打进输出**（一个静默的 0 会把"探针没接上"读成"全都对上了"）。

五条读数（全在 14:4x 现量；第 1/4/5 条是**改后的真门禁**跑的，第 2/3 条是同一逻辑的离线复刻 ——
复刻只为把「pkg 与树必须同源」这一对比做在别的树上，`--pkg` 改不了脚本自己那枚 `ROOT`）：

| 组合 | 读数 |
|---|---|
| 分支树自己（`node scripts/check-gate-wiring.mjs`） | `rc=0`，判 **63** 段、跳 **8** 段 |
| 载体 `a250e6da` 自带 pkg + 同一棵载体树（复刻） | 判 **73**、跳 8、**缺 0** ⇒ 不会把载体第 1 道门自己搞红 |
| `git show main:package.json`（取数时 main=`1930f2b5`）vs 干净检出 `/tmp/heyta-main-check`=`a49c4f19`（跟踪文件脏数 0） | 判 **72**、**缺 0** ⇒ **不是天生红的门禁**（AGENTS §8.3） |
| 合成悬空门那份 pkg | `rc=1`，点名 `check:does-not-exist-xyz → scripts/definitely-not-here-xyz.mjs` |
| 他那份真脏 pkg vs 缺这些文件的树 | `rc=1`，**恰好点名那三枚**（`vault-diagnostics` / `apk-freshness` / `shell-erasure-parity`） |

对照一条（复刻跑的）：同一份 main 的 pkg 打**分支树**会报 **缺 10** —— 那是跨树比较（分支还没并 main 的新门），
不是产品红；比较必须 **pkg 与树同源**，这条与 §8.84 那条"走错树拿到 `MODULE_NOT_FOUND`"是同一件事的两面。

**落地那一趟因此换了形状**：`pnpm check` 是 `&&` 串起来的，一枚悬空门不只是"少跑一段"，
它会让**排在它后面的整串根本不跑**，读数是三枚 `MODULE_NOT_FOUND` + 一屏没跑完；
现在第 1 道门会在起跑就把三枚门**按名字**报出来 ⇒ §8.61 那条"逐条仍可归属"的关闭判据少三枚要靠签名比对的硬骨头。

**没做的事，写明**：没碰他那三枚文件、没替他把实现 `git add`、没把他的 5 道门挪进我们这条分支、
没动任何阈值 —— 这条新判据判的是**结构**（定义指向的文件在不在），不是"谁的实现该不该进链"。

### 8.86 第六族：main 与本批改到了**同一个生成器**上，取本分支侧的理由不是偏好（2026-10-04 14:5x）

`git merge-tree --write-tree --name-only main feat/self-host-distribution` 现量 **4 条冲突**：
`docs/research/self-host-distribution-audit.md`、`package.json`、`server/image-npm-tree.json`，
以及新出现的 🔴 **`research/tools/gen-image-npm-tree.mjs`**。它的来历就是 §8.84 那枚刚落地没多久的
`b60589de`（14:42）：main 侧 +31/−2 把新鲜度哈希收窄到 7 个依赖字段，而本批那版 +152/−91
是把**整条读取路径换成"从提交物锁派生"**（G-47 形状 C）。两侧都从 base `b850b1c6` 改起 ⇒ 撞在同一文件上。

**为什么这一族取本分支侧不是"选边"**：main 那版钉的键 `serverPackageJsonSha256`
在本分支版里**已经不存在**，取而代之的是 `image-install-shape.mjs` 的 `readServerInstallInput()`：

- `TREE_AFFECTING` 5 档（`dependencies` / `optionalDependencies` / `overrides` / `peerDependencies` /
  `bundleDependencies`）+ `INERT` 若干档，**每档写清为什么不进树**；
- 🔴 **读到没被判定过的顶层字段直接抛** —— 他们那版是"把 `packageManager` 写进 7 字段名单"，
  本分支这版是"谁将来加 `packageManager`，必须先回答它会不会改变那棵树"。同一个担心，两种强度；
- `devDependencies` 的惰性是**有条件的**：由 `shape.prunesDevDependencies` 现读生产阶段那条
  `npm pkg delete devDependencies` 还在不在（G-54 那条实测），不在就自动挪回被哈希的集合。

所以取 main 侧不是"少一点功能"，是**载体的第 6/7/8 道门禁会直接读不到输入**。
第五族（快照）与第六族（生成器）因此**必须同侧** —— 这正是载体脚本要分两族预置、而不是
"整个 `research/tools/` 取一侧"的原因。

**载体读数（`6d5602fa`，14:54 现跑）**：

```
载体 6d5602fa = main(9372a885) × feat/self-host-distribution(adc2c535)
冲突 4 条 → 分族 pkg=1 gi=0 png=0 audit=1 snap=1 gen=1 other=0
package.json 并集 scripts 键 146 个 · check 链段 main=76 本批=67 base=66 并集=77（摘段 0/0）
  （这里"链段"= 按 `&&` 切再剥 `pnpm ` 前缀的**项数**，与 §8.83 那张表同单位）
审计文档并集：main 节 76、本分支节 193、main 独有行 50、本分支独有行 2543、产出非空行 4138
gen-image-npm-tree.mjs 取本分支侧（main 侧仍钉旧键 serverPackageJsonSha256、本分支侧走
  readServerInstallInput 分区指纹；载体上取到的这份含分区指纹=true，两侧行数 292/324）
合并归属：写 38 枚 / 合并相对 main 改 38 枚 / **集外 0** / 写集里未被改到 0 枚
八道纯 fs 门禁 exit 0
```

第 1 道是 §8.85 那条新判据**第一次在别的树上跑**：载体上 `判 73 段 / 跳 8 段 / 缺 0`、`rc=0`
（`grep -c '实现文件判了' 载体/scripts/check-gate-wiring.mjs` = 1 ⇒ 落地这一笔会把这条判据一起带进 main）。

**§8.84 那条连带预测没有发生，留档**：`git show --stat b60589de` 里
`server/image-npm-tree.json` **同笔改了 10 行**（外加两枚别人那条线的 vault-panel PNG）——
他按自己注释里那句"换指纹口径 ⇒ 必须重跑生成器落新快照"做了。
⇒ 不能把"猜对方漏了那一步"排进落地顺序；能做的是把那一类形状变成**有名字的判据**（§8.85 那条 3b），
这样不管谁漏都会响亮地红，而不是靠人预言。

**现场**（14:46–14:49，g69 三次 POLL）：阻塞集 **1 枚 = `package.json`**，脏条目 174；
main 从 `d636b010` 走到 `9372a885`。载体每前进一次都要重算（脚本只认分支不认 SHA），
落地那一笔仍归人执行守卫序列。

### 8.87 第 2 项（`verify:selfhost-stack` 现量重跑）的就绪表：把"端口被别人占"这条**错的阻塞**摘掉（2026-10-04 14:58）

这一项之前一直挂着两条"现场前置"，其中**一条是我记错的**。14:58 逐条现量：

| 前置 | 现量 | 判 |
|---|---|---|
| Docker 上下文 / daemon | `orbstack` ｜ `29.4.0 / OrbStack / 16 C / 16 GB` | ✅ 起 |
| 磁盘 | `/` 可用 **83 Gi**（已用 14%） | ✅ |
| 三文件解析出的服务集 | `docker compose -f docker-compose.yml -f docker-compose.build.yml -f docker-compose.migrate-once.yml config --services` = `postgres / supersync-migrate / supersync / caddy` | 记录 |
| **这一跑起哪些服务** | `scripts/verify-selfhost-stack.sh:335` = `compose up -d postgres supersync` ⇒ **caddy 不进这一跑** | 🔴 纠正 |
| 宿主端口面 | `docker-compose.yml` 全文只有 **2 处 `ports:`**：`:110` supersync = `127.0.0.1:${SUPERSYNC_HOST_PORT:-1900}:1900`、`:280` caddy = `80/443` | 记录 |
| 1900 / 80 / 443 | 14:58 现量**三个都空** | ✅ |
| 别人占着的端口 | `3000` = pid 70256 `node dist/src/index.js`（13.5 小时）、`5432` = pid 1334 homebrew `postgresql@15`（17 小时） | 🔴 **与本跑无关** |

🔴 **纠正的那条**：我此前把"宿主端口被别人占着"写进这一项的前置，比的是 **3000 与 5432** ——
那两个端口**我们的栈根本不映射**（postgres 在 compose 里没有宿主端口映射，只走内部网络；
服务端默认落在 **1900**，且 `SUPERSYNC_HOST_PORT` 可换）。那枚 homebrew postgres 与那枚
`dist/src/index.js` 属于别的线，挡不到这一跑。把不相干的占用算成前置，后果是**永远等不到窗口**：
等的是一个本来就不存在的条件。
同一条也解释了 AGENTS 里那句"`deploy.sh` 会拉起 caddy 而本机 :80 被宿主 nginx 占"为什么**不适用于这一项**——
不是 :80 空了（它此刻确实是空的），是这一跑**不带 caddy**。

**仍然挡着的只剩两条**（都写清属于哪一类）：

1. **窗口**：14:58 现量 load **34.3**，`/tmp/tfa-test.lock` 被 pid 79513 持有
   （`~/.tfa-shield/.../run-gated.mjs … node --test scripts/test/{gates,host-headroom,host-shield,run-gated}.test.ts`
   —— 别的仓库的测试，见 §8.83 ③）。这一跑要 `docker build` 当前树 ⇒ 它自己也会把负载顶上去，
   所以它必须排在**本线那把逐段扫（g69）之后**，两条重活挤同一个窗口的话双方读数都不可归因（AGENTS §8）。
2. **"真镜像"这三个字有现成的新鲜度判据，别用 mtime 猜**：脚本自己就在
   `scripts/verify-selfhost-stack.sh:179-181` 打 `DOCKER_BUILDKIT=1 docker build -f server/Dockerfile
   --build-arg VCS_REF="$(git rev-parse HEAD)"`，镜像 tag 是 `:92` 那行写死的 `supersync:selfhost-verify`。
   现量：盘上那枚 `cabb721a918c` 是 **5 小时前**的，而树在那之后又动了（§8.83–§8.86 那几笔 + 载体换六族）。
   ⇒ 这一项的读数**必须来自重跑**，而"装的是不是这一批"有一条可核对的判据：
   **构建出来的镜像里那个 `VCS_REF` 要等于起跑那棵树自己的 `git rev-parse HEAD`**（拿旧镜像冒充就是把
   §6.1.1 那句"测试全绿 ≠ 这是当前产物"再犯一遍）。构建输入清单另有 `server/scripts/image-inputs.sh` 那 22 枚路径。

⇒ 这一项的下一步不是"继续等"，是**排在 g69 之后起一条**：`pnpm verify:selfhost-stack`（默认旋钮，
不带 `--only`/`--skip`），日志落 `/tmp/heyta-selfhost-up.log` 之外再自己写一份带时间戳的读数文件，
等满负载门就按 exit 3 记"环境无效 ≠ 产品失败"，**不动阈值**。

### 8.88 归属基线的方向反了：干净 main 上那八道 fs 门禁**全绿**，Goal 里"main 红在 check:docs 5 处"这句已被否证（2026-10-04 15:0x）

起因是一件不免费但该做的事：main 从 `a49c4f19` 走到 `dcbb94ab`（这一天里第三次挪），
而我引用的"main 自己现在红在 `check:docs` 5 处 —— 引用方/报错行只在 main 版本、4 个死链目标
在主检出是 `??` 未跟踪"这句话是**几天前的读数**。归属判据的基线如果过期，后面每条"这条红不是
本批的"都是空话，所以去现量。

#### ① 现量（干净 main 检出，逐字执行载体 GATES 里那八道）

载体 `/tmp/heyta-main-check`（`git status --porcelain` = **0 行**，`checkout --detach dcbb94ab` 之后仍是 0 行），
把 `research/tools/selfhost-merge-carrier.mjs` GATES 用到的六道 `check:*` **按 main 自己 `package.json` 里的
定义原样执行**（装置：`/tmp/g70-main-baseline.mjs`，它先读 main 的 `pkg.scripts[name]`，
取不到就记 `ABSENT_IN_MAIN` 而不是拿我这边的定义冒充）：

⚠️ 执行的是 **main 那一份实现**（例如 `check:gate-wiring` 里没有 §8.85 本批新加的第 3b 条），
所以下面这张表证的是"main 现在自己站不站得住"，不是"我这版门禁在 main 上绿"。

| 门禁 | main 里的定义 | rc | 读到的最后一行 |
|---|---|---|---|
| `check:gate-wiring` | `node scripts/check-gate-wiring.mjs` | **0** | ✅ check 链与门禁定义对上了 |
| `check:selfhost-entry-command` | `node scripts/check-selfhost-entry-command.mjs` | **0** | 审计报告那条"故意排除 1 条"（§8.11 的旧命令） |
| `check:script-snapshot` | `node scripts/check-script-snapshot.mjs` | **0** | ✅ 自快照 bootstrap 全部在位（**38** 个脚本 + .gitignore） |
| `check:docs` | `node research/tools/docs-link-check.mjs` | **0** | ✅ 无死链、无"本机有仓库里没有"的链接、无失效章节引用、无失效锚点（278 文件 / 1932 链接 / 522 处跨文档引用） |
| `check:md-tables` | `node scripts/check-md-table-rows.mjs` | **0** | ✔ 9 个文件的表格行一致 |
| `check:image-license`（三条腿） | `gen-image-npm-tree --check && check-image-license-coverage --quiet && check-image-install-contract` | **0** | ✅ prisma 三处同源 5.22.0 |

🔴 **要撤的结论（就地撤，不新开会）**：Goal 第 1 项关闭判据里那句"main 自己现在红在 `check:docs`
5 处（引用方/报错行只在 main 版本、4 个死链目标在主检出是 `??` 未跟踪）"**被这一跑否证**。
那 4 枚死链目标后来被它们的所有者提交了，main 现在在 `check:docs` 上是 `rc=0`。

⚠️ 诚实划线：**这条否证不是今天第一次拿到**。文档里那处原句旁边已经写过"02:1x 干净检出实测 exit 0"
的更正（本文 `main 红在 check:docs 5 处` 那一行的下方）。本节的增量只有两点：
① 把它从 `check:docs` **一枚**扩到**八道全测**（这才谈得上"配对门免费不免费"）；
② 在**当前** SHA `dcbb94ab` 上重取（main 这 12 小时里挪了三次，02:1x 那次量的不是这一版）。

#### ② 这句话变了判据的**方向**，不是只变一个数字

以前的形状是"载体某道红 ⇒ 去 main 上跑同一道，main 也红就算非本批"（§8.74 / §8.77 用的就是它，
当时它确实免费）。现在这八道 main 全绿 ⇒

- **配对门不再免费**：载体上这八道里任何一枚红，都不能再往 main 身上一推了之，必须落进本批写集
  （38 枚）并解释清楚是**哪一笔**造成的，或者说明它由环境造成（例如 `--check` 那条腿读的锁被人改了）。
- 反过来说这也**收紧了我自己的证据**：载体扫链里这八道只要报 `rc=0`，就直接是"落地不引入 fs 类回归"
  的正证，不再需要"两侧都红所以不算"这种两段式。
- 元教训：**"main 也红"是一种会自己失效的豁免**。 引用它时必须带上"在哪个 SHA 上量的"，
  并且下一次落地前重量 —— 这轮的现量命令就一条（`node /tmp/g70-main-baseline.mjs /tmp/heyta-main-check`），
  成本比重新推理一遍低得多。

#### ③ 第 2 项那趟 `VERIFY_EXIT=0` 没有被这批 23 笔作废 —— 逐笔取的路径集

`git log --format=%h 959fd1e6..237f69ec` = **23 笔**（959fd1e6 = 拿到 `VERIFY_EXIT=0`/`FRESH=4/4` 那趟的分支载体，
见 §8.67）。逐笔 `git show --name-only` 后去重，落到的路径只有四类：

| 落到的路径 | 会不会改变"跑起来的栈" |
|---|---|
| `docs/research/self-host-distribution-audit.md` | 不会（不进镜像、不进 `apps/web/dist`） |
| `research/tools/selfhost-merge-carrier.mjs`、`selfhost-landing-blockers.mjs` | 不会（落地装置，不是产品字节） |
| `scripts/check-gate-wiring.mjs` | 不会（门禁实现；`server/Dockerfile:197` 从 `scripts/` 里**只** COPY `check-web-artifact.mjs` 那一枚，其余零拷贝） |
| `e2e/selfhost-stack-results/s{2,3}-*.png`（`b9d11ed9`） | 不会（验收证据本身，§8.67 把人看过的那版字节钉进去） |

打进镜像的那几样（`server/`、`packages/*/dist`、`apps/web/dist`、`package.json` 里能改变依赖树的字段、
`server/image-npm-tree.json`）**一枚都不在这 23 笔里**。所以 §8.87 说的"排在 g69 之后重跑第 2 项"
是为**合并载体**拿一趟现量（载体才是 main 要前进到的那个字节集），不是因为旧读数坏了。

#### ④ 同一时刻的环境读数（第 2 项没起跑的原因，写清楚免得被读成回避）

```
vm.loadavg        = { 20.67 25.73 28.26 }   ⇒ 高于 12，负载门会拒
/tmp/tfa-test.lock = 存在，14:57 起被占（全局验证锁，另一条线的 `node --test` 在跑）
docker info        = 29.4.0（daemon 在）
docker ps          = 空（没有残留容器，容器名冲突那一档不适用）
```

⇒ 现在起 `pnpm verify:selfhost-stack` 会得到一次**环境无效**的 exit 3，不是产品失败。
按 Goal 的约束**不动阈值、不降级判据**，等窗口；g69（阻塞集→重算→扫链）仍在轮询，
最近一行 `15:01:41 POLL blockers_rc=0 BLOCK行=1`。

⚠️ 顺手记一枚装置坑（我自己的）：这一跑我先用 `grep -c '^BLOCK '` 数阻塞集，读出 **0**，
而 g69 用 `grep -c 'BLOCK '` 读出 **1** —— 台账里 `BLOCK` 那几行是**带两格缩进**的，
锚在行首的计数把非空集合数成了空集。这正是 §7 那条"空测量看着最干净"的形状：
**判"归零"的计数器必须与生产它的那把尺子逐字同式**（g69 用的模式是对的，我的锚是错的）。

### 8.89 G-55 的三条 needle 在**新的公开 SHA** 上重量一遍仍成立；顺带一枚差点骗过我的 zsh 引号坑（2026-10-04 15:0x）

`origin/main` 在今天自己动了（§8.64 量的那版是 `95ac4662`），所以"公开那棵树建不出镜像"这句
**必须重取**才能继续当对外结论用。这一跑全程只读：git 对象 + GitHub 匿名 API，**不构建、不 push、不发镜像**。

#### ① 远端那一侧现在是什么（先证明我看的不是本地旧 ref）

| 量 | 读数 | 命令 |
|---|---|---|
| 本地 `origin/main` | `8a254bcd9074a37006be56ac3adc411604c9c17f` | `git rev-parse origin/main` |
| 远端 `main` 的头（匿名 API） | `8a254bcd9074a37006be56ac3adc411604c9c17f` —— **逐字相同** | `GET api.github.com/repos/Xaiver03/heyta/commits/main` |
| 仓库是否公开 | `private=false`、`default_branch=main` | `GET …/repos/Xaiver03/heyta` |
| `origin/main..main` 落后笔数 | **97**（§8.64 那格是 116；10:13 有人 push 过，不是本批推的） | `git rev-list --count origin/main..main` |

#### ② G-55 的三条承重 needle，逐条重量

| needle | 15:0x 读数 | 说明 |
|---|---|---|
| `server/package.json` 的 `devDependencies` 里那 3 枚工作区包 | **仍在**：`@heyta/app-host` / `@heyta/storage` / `@heyta/sync-client` | 用 `git show` 取出 blob 后 **JSON 解析**读字段，不是 grep 字符串 |
| `AS production` 之后 `npm pkg delete` 的命中数 | **0** | 阶段用 `awk '/AS production/,0'` 切，避免把 builder 阶段的行算进来 |
| `b3397cda`（ADR-0050，带进那 3 枚 devDep 的那笔）是 `origin/main` 的祖先？ | **真** | `git merge-base --is-ancestor` |

⇒ 生产阶段那三条 install 仍然是 `--omit=dev` 的裸形状（`:250-252`），机制那半截
（`--omit=dev` **照样解析** devDeps 的每一条 spec）不是这次重量的对象 —— 它已经有真读数了：
§8.62 那张鉴别表里 **A 臂**（= `b3397cda` 之后的形状，3 枚 `@heyta/*` devDep）
第一条与第二条 install **各红一次**（`rc=1 code E404 … GET …/@heyta%2fapp-host`），
**B 臂**（装之前 `npm pkg delete devDependencies`）与**反证臂**（同锁同镜像、摘掉那三枚）都 `rc=0`，
两臂在 npm 10.9.4（本机）与 11.19.0（`node:24-alpine` 运行时同款）上同形。
⚠️ 措辞按表原文收窄：那两列是**两条 install**，不是"本地那棵 vs 公开那棵"——
公开树这一侧的证据是**形状层**的（本节 ② 那三条 needle），不是"公开树被真构建过"。
行号也分两本账，别抄串了：**公开那棵树**那三条 `--omit=dev` 在 `server/Dockerfile:250-252`；
**本分支那版**的修法 RUN 在 `:297`（`RUN npm pkg delete devDependencies && npm install ./sync-core.tgz …`）。
⚠️ 顺带抓出本文自己的一处引用漂移：§8.62 写的 `server/Dockerfile:286` 现在落在**注释行**上
（`# 🔧 heyta 改动（G-54…）`），RUN 那一行在 `:297` —— 差 11 行是 G-54 那节注释变长造成的。
两版 Dockerfile 行号整体差 40+ 行，引用时必须写明是**哪一棵树**的行号。
**所以 G-55 的结论一个字都不改，只是把它的日期从 08:5x 换到 15:0x**，并把口径 A 那格会漂的数字标出来（见原句旁的更正）。

🔴 这一条**仍然不是本批能自己关的**，三种口径一条都没被自动满足：A 直接撞"不推远端"；
B 会造出"公开树 ≠ 本地 main"的分叉；C 要动那两枚仍在别人手里的 i18n 表 + 一次落地页重发。
它保持 pending，但现在是**带着现量的 pending**，不是带着印象的 pending。

#### ③ 差点骗过我的一枚坑（值得入档的形状）

第一趟我这样写：

```bash
for ref in origin/main main; do git show $ref:server/package.json …; done
```

zsh 会把 `$ref:server/…` 里那个 `:` 当成**修饰符**去解析（同一个家族里还有 `$ref:path` 报 bad substitution），
于是 git 实际收到的是 `origin/main.json`：

```
fatal: ambiguous argument 'origin/main.json': unknown revision or path not in the working tree
SyntaxError: Unexpected end of JSON input        ← 管道下游拿到空串
prune-family needles: 0                           ← grep 对空文件计数 = 0
```

危险的不是报错，是**那个 0 与正确答案同号**：我预期的读数就是"`npm pkg delete` 命中 0"，
所以第一趟的屏幕看起来"完全符合预期"，没有任何一条异常会促使我去看 stderr。
这一条与 §7「空测量看着最干净」是同一族，但多一种面目：
**当"没有"本身就是预期结论时，命令失败与结论成立在输出上不可区分。**

修法两条都便宜，都已用在这一节：
1. ref 与路径**一起**放双引号：`git show "${ref}:server/package.json"`；
2. 每次"0 命中 / 空集"的读数，同一趟里把**取字节那一步自己的 rc** 打出来
   （这一节改成先 `> /tmp/spj.json` 落盘再解析，解析失败会炸在 `JSON.parse`，
   而不是静默把空文件数成 0）。

### 8.90 第七族：main 把**对账器**也改到了同一枚已删除的键上；取本分支侧的理由与注入读数（2026-10-04 15:1x）

#### ① 怎么发现的：不是等窗口开，是先把"窗口开了会不会白费"量一遍

g69 那把等待链的条件是"阻塞集归零 ⇒ 重算载体 ⇒ 扫链"。但"重算这一步在当前两棵树下会不会
`die(2)`（预置族之外的冲突）"是一个**可以在等待期就确定**的事实 —— 如果会，窗口开了也只是浪费一次窗口。
所以先干跑（`git merge-tree --write-tree --name-only main b37780fa`，不写树、不动任何工作区）：

```
MT_RC=1  冲突 5 条：
  docs/research/self-host-distribution-audit.md      ← 第四族
  package.json                                        ← 第一族
  research/tools/check-image-license-coverage.mjs     ← 🔴 新面孔（这一节补成第七族）
  research/tools/gen-image-npm-tree.mjs               ← 第六族
  server/image-npm-tree.json                          ← 第五族
```

⚠️ 干跑**只是预警**，不是结案依据：§8.73 记过一次 `merge-tree` 的预报与实际合并结果不一致。
判"取哪一侧对不对"的证据只取载体脚本自己列出的冲突集（它跑真 `merge --no-commit --no-ff`）
加下面 ④ 的注入臂。

#### ② 第七族是什么

| 侧 | 动了什么 | 谁动的 |
|---|---|---|
| main | `+4 / −1`：新增 `research/tools/image-deps-fingerprint.mjs`，新鲜度那行改成 `depsFingerprint(…)`，**但仍然去比 `snapshot.inputs.serverPackageJsonSha256`** | `e374b142`（14:54）`refactor(gates): 镜像新鲜度指纹抽成共享模块——生成器与对账器必须同一份实现` |
| 本批 | `+388 / −35`：遍历器下钻嵌套 `node_modules`、按锁逐条判许可证、双载体互证，新鲜度键换成 `serverInstallInputSha256`（分区指纹，来自 `image-install-shape.mjs`） | `1b7d0921` / `972374f8` / `a70b0ef8` / `89cda0df` |

取本分支侧的**理由**（两条都是结构性的，不是偏好）：

1. **第六族与第七族必须同侧。** 生成器写 `serverInstallInputSha256` 而对账器读
   `serverPackageJsonSha256` 时，"快照代不代表当下"这一腿比的是一枚**载体上再也不会有人写**的键
   ⇒ 变成恒红判据；反过来（main 的生成器 × 本批的对账器）同理。载体脚本把这件事打成了
   一行可复核读数（`与第六族同侧=true`），不靠注释里的信念。
2. 🔴 **main 那次 refactor 的意图在载体上没有被打折**：它反对的是"两套实现"，
   载体取完两侧之后，两个消费者共用的是**同一份** `image-install-shape.mjs`
   （`readServerInstallInput` 分区判断只有一处）。
   这一句必须写在这里 —— 不写，下一读的人会误读成"合并把他们的重构退回了"。

#### ③ 结构代价：main 那枚新模块在载体上**零引用者**（计数是量出来的，且不删）

main 上 `depsFingerprint` 的引用者集合（`/tmp/heyta-main-check` 干净检出，`grep -rln`）=
`gen-image-npm-tree.mjs` + `check-image-license-coverage.mjs` + 它自己，**恰好就是第六、第七族那两枚**。
⇒ 两族都取本分支侧之后，载体上该模块引用者 = **0**（载体脚本把这个计数直接打进那笔读数：
`⚠️ main 新模块 research/tools/image-deps-fingerprint.mjs 在载体上的引用者=0 枚`）。

**不删。** 删它 = 动一枚本批写集之外的路径 ⇒ 破"集外 0"那条结构不变量，而那条不变量正是
"这笔合并没吞别人的改动"的唯一证据。这一格交给它的所有者处置；载体不落笔，读数留在提交信息里。

#### ④ 判据有没有牙：注入臂（只把对账器换成 main 那版，在载体上跑）

| 臂 | 三条腿读数 |
|---|---|
| 载体原样 | 八道全 `exit 0`（逐条读数打在载体那笔的提交信息里：`check:gate-wiring` / `check:selfhost-entry-command` / `check:script-snapshot` 38 枚 / `check:docs` / `check:md-tables` 9 文件 / image-license 三条腿） |
| 只把 `check-image-license-coverage.mjs` 取 main 侧 | 第 1 腿仍 `exit 0`，**第 2 腿 `exit 1` 且三层同时红**：① `快照已经不代表当下的声明 / server/package.json 变了（快照里的哈希与当下不一致）`——② 里预测的那一层**命中**；② `镜像装了 3 条许可证门禁从没见过的包`（`@heyta/domain@0.0.0` / `@heyta/shared-schema@1.0.0` / `@heyta/sync-core@1.0.0`）；③ `计数不闭合 covered(126) + 豁免(17) ≠ 快照总数(146)` |
| 复原 | `git reset --hard e8846352` 后 `git status --porcelain` = **0 行**（注入没在载体上留任何东西） |

🔴 这一臂顺带照出**一件不只是第七族的事**：那三层红里有两层（3 枚本地包从未登记、126+17≠146）
是 main 那版对账器**读本批快照**时的必然形状 —— 也就是说，"main 那棵树自己的对账器 + 本批那把锁派生的
快照"这个组合从来没被人验过。这正是 §8.85 那枚新门禁（3b：链里的门指向不在树上的文件）的**姊妹形状**：
判据之间是配对的，配对的两半分别在不同侧被改，就没人知道合起来红不红。第七族把"必须同侧"钉住，
就是为了让这个组合不出现。

#### ⑤ 重算后的载体（第七族已生效）

```
✅ 载体 e8846352 = main(7471d45d) × feat/self-host-distribution(b37780fa)
   冲突 5 条 · 分族 pkg=1 gi=0 png=0 audit=1 snap=1 gen=1 cov=1 other=0
   并集 scripts 键 146 · check 链段 main=76 本批=67 base=66 并集=77（摘段 0/0）
   合并归属：写 38 枚 / 合并相对 main 改 38 枚 / 集外 0 / 写集里未被改到 0 枚
   门禁 8 道全 exit 0
```

⚠️ `main` 在这一小时内又挪了两次（`a49c4f19` → `dcbb94ab` → `7471d45d`），`gi`/`png` 两族这次**没有**冲突
（第一族的 `package.json` 与第四族的审计文档仍在）。所以 §8.88 那张"main 八道全绿"的基线是
**逐 SHA 的**：真正落地那一刻必须按当时的 `main` 重算载体并重新取一遍基线，不能引用本节这几个 SHA 的读数。

#### ⑥ 等待链的状态（这一节做完时）

g69 已**主动停掉**（不是等满超时）：它的重算步骤用的工具缺第七族，`die(2)` 会让窗口白开。
补完并实测通过后，等窗口那把重开成 g71，条件不变（阻塞集归零 → 重算 → 逐段扫链 → 出报告），
它现在拿到的是**带第七族的工具**。阻塞集现量仍是 1 枚（`package.json`，在别人手里）。

### 8.91 载体第一族还有一档没人守的字段：`scripts` **之外**那九枚顶层键，本批改了也会被静默丢掉（2026-10-04 15:2x）

#### ① 起点是一个具体问题：落地扫链的第一步会不会注定红

g71 的扫链序列是 `pnpm install --frozen-lockfile` → `pnpm -r build` → `e2e` 装依赖 → 逐段跑链。
第一步红 ⇒ 后面整把读数作废（§8.90 刚为"工具在窗口开之前先修好"付过一次代价，这是同一件事的另一面）。
而第一族的解法是"**深拷贝 main 那份 `package.json`，只把 `scripts` 做并集**"，
同时 `pnpm-lock.yaml` 这次**不在冲突集里**（git 三方文本自动合并了它）。
"文本层自动合并的锁"配"非文本层并集的清单"，就是 `--frozen-lockfile` 的经典死法。

#### ② 现量：今天这一笔是干净的，但干净是运气

| 量 | 读数 | 装置 |
|---|---|---|
| root importer 的 `devDependencies` | 载体 / 干净 main / 本分支三棵树都是 `pkg=4 lock=4 锁缺=0 锁多=0` | `/tmp/g72-lock-preflight.mjs`（带阳性对照：往 pkg 塞一枚锁里没有的 ⇒ 精确报 `锁缺=zzz-not-in-lock`） |
| 根 `package.json` 非 `scripts` 顶层字段 | base / main / branch / 载体四份两两相同；顶层键各 10 枚，无单侧独有键 | `git show <ref>:package.json` 后按值比 |

⇒ 今天不红。但"今天不红"和"有东西守着"是两件事：

🔴 **潜在洞**：如果本批往根 `package.json` 的 `dependencies` / `devDependencies` / `pnpm.overrides` /
`packageManager` 里加过任何东西，并集会**把它丢掉**，而现有六条 scripts 断言（缺键 / 缺链段 /
两侧顺序 / 两侧摘段）**一条都不会响**。掉的那一档如果同时是锁的构建输入 ⇒ 落地第一步红；
更糟的是它**不红**那一支（只改 `pnpm.overrides` 这类不进锁口径的字段）—— 从此没有任何一层知道。

#### ③ 补的判据：`pkgFieldVerdict`，判在**磁盘那个对象**上

实现进 `research/tools/selfhost-audit-union.mjs`（纯函数，和 `unionAudit` / `ownershipVerdict` 同一模块、同一风格），
调用点在载体脚本 `package.json` 那一族里，位置刻意选在 `writeFileSync` **之后**、
与既有那条"写完回读再验"的断言同一个对象上：

```js
const fields = pkgFieldVerdict({ base, ours, theirs, out: backPkg });
if (!fields.ok) die(2, `package.json 并集把本批改过的**非 scripts 顶层字段**丢了 …交人判`);
```

判据语义只有一条：**本批相对 base 改过的**每一个顶层字段，必须在产出对象里逐字节等于本批那份。
它**不管** main 单方的改动（`out` 就是从 main 深拷贝来的，那是基线，不该响）——
这条边界是故意的：替 main 的决定报红会让这道门变成噪音源。

#### ④ 注入臂（装置已入库：`research/tools/selfhost-merge-carrier-arms.mjs`，五臂全中，`rc=0`）

它**不是一份只能看不能跑的表**：默认旋钮自己取 `merge-base(main, 本分支)` 与两侧的
`package.json` blob，臂 1 读的是**当前磁盘上那份载体**（`feat/self-host-merge-main`），
所以每次载体重算之后重跑它，判的都是现量而不是快照。
🔴 同一趟里既有"必须 ok"的臂也有"必须红"的臂 ⇒ 它**结构上不可能恒绿**（少任何一边的分辨力都会让某条臂 ❌）。

| 臂 | 输入 | 期望 | 实读 |
|---|---|---|---|
| 1 | 真实四份（磁盘载体对象） | `ok=true` | ✅ `ok=true 比了=9` —— 证明**不是生来就红** |
| 1b | 真实三份 + 并集构造 | `ok=true` | ✅ 同上 |
| 2 | 本批往 `devDependencies` 加一枚 | 红，点名 `devDependencies` | ✅ `dropped=[devDependencies]` |
| 3 | 本批新增 main 没有的顶层 `pnpm.overrides` | 红，点名 `pnpm` | ✅ `dropped=[pnpm]`（比了 10 个键——新键也进了分母） |
| 4 | 本批改 `packageManager` | 红，点名 `packageManager` | ✅ `dropped=[packageManager]` |
| 5 | **只有 main** 改了 `devDependencies` | `ok=true` | ✅ —— 证明它不替别人响 |

#### ⑤ 这一节自己的探针差点骗过我（同一个家族，第三种面目）

`g72` 第一版把 root importer 解析成 **0 条依赖**，三棵树读数**完全一样**、且都写着"锁缺=4"。
那是解析器坏了（pnpm-lock v9 的 importer 键是 `  .:` 无引号、条目在 6 格缩进且带引号，我按 4 格无引号写的），
不是三棵树真的都少 4 条。
🔴 可迁移的一句：**跨树比较里"三棵树读数一样"不是"世界一致"的证据，它同样是"尺子坏了"的证据**；
唯一能区分两者的是**阳性对照**（造一个必然不一致的对象喂进去，看它会不会报不一致）。
加完对照之后这次跑才第一次有分辨力（`pkg=5 lock=4 锁缺=zzz-not-in-lock`）。

#### ⑥ 重算后的载体（带新断言，main 又挪了一笔）

```
✅ 载体 75c98496 = main(cc0cb6a8) × feat/self-host-distribution(0c2f1fa0)
   并集 scripts 键 146 · check 链段 main=76 本批=67 base=66 并集=77（摘段 0/0）
   · 非 scripts 顶层字段比了 9 个，两侧改动全落进磁盘对象（丢 0）
   门禁 8 道全 exit 0
```

⚠️ 与 §8.90 同一句提醒：`main` 从 `7471d45d` 又走到 `cc0cb6a8`（这一天里第四次），
载体每次都要重算。等待链 g71 仍在轮询（最近 `15:21:15 POLL blockers_rc=0 BLOCK行=1`），
它拿到的工具现在是**带第七族 + 带字段断言**的那一版。

### 8.92 第 2 项的"当前产物"那一档，原来只有**人记着**：`VCS_REF` 打进去却从不读回 —— 补成硬闸，两臂实测（2026-10-04 15:2x）

#### ① 缺口在哪一句里

§8.87 写着"新鲜度由 `VCS_REF == 树 SHA` 现判"。去读被调方本体：

```
grep -n VCS_REF scripts/verify-selfhost-stack.sh
  177:  log "==> 打镜像（${IMAGE}，VCS_REF=$(git rev-parse --short HEAD)）"
  180:    --build-arg VCS_REF="$(git rev-parse HEAD)" \
```

两行：一行**打印**，一行**传进构建**。没有任何一处把构建出来的那枚镜像的 label **读回来**比对。
🔴 也就是说那句"新鲜度由 VCS_REF 判"当时的真身是"**由我记得判**"——
它是人读日志的一次动作，不是这趟运行的一道判据。而同一脚本里紧跟着就有 `IMAGE_ARCH`
那条**读回**式判据（`docker image inspect … '{{.Os}}/{{.Architecture}}'`，§8.38/G-53 就靠它），
所以这不是"做不到"，是**少做了一条**。

这正是本仓 §7 第 27／82 条那一族换了个介质：APK 里是旧 JS bundle、Windows 装的是旧树、
这里是 `--no-build` 复用了一个旧 tag —— 三者的共同点是**症状与"一切正常"逐字相同**。

#### ② 这一档今天就在发生（不是假想敌）

```
docker image inspect supersync:selfhost-verify
  → org.opencontainers.image.revision = 959fd1e6b8c9ce25016be2b339e813c18f25b391   （6 小时前那趟）
git rev-parse HEAD（本分支）
  → 8bcc53d2dc94c5fffdd324c983ab974d8083bfe6
```

⇒ 此刻任何人跑 `pnpm verify:selfhost-stack --no-build`，都会拿到一整套 `VERIFY_EXIT=0` 形状的结论，
而它们全部是在给**另一棵树**的二进制打分。旧那趟（§8.67）本身没问题——它的 label 恰好等于它主张的那笔；
**问题是没有一条判据能区分"恰好等于"和"差 23 笔"**。

#### ③ 补的判据（`scripts/verify-selfhost-stack.sh:200-215`）

构建／确保镜像那一段之后、任何容器动作之前：

- 读回 `docker image inspect "$IMAGE" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'`；
- 与 `git rev-parse HEAD` **不等 ⇒ 响亮 die**，把两个完整 SHA 都打出来，并写明
  "`--no-build` 时这条就是硬闸：要故意验旧镜像请把旧树检出去再跑，**不要为了让这一行过去而改这条判据**"；
- 相等才继续，并打一行 `被验镜像的 revision == 当前 HEAD（…）`。

🔴 一条诚实边界也跟着打进日志：label 只证明"**构建时那笔 commit**"，**不**证明"构建时工作树干净"
（构建上下文送的是工作树字节）。所以新增 `构建上下文的未提交条目=N`，
让下一读的人能把这趟解释成"这一笔 + N 枚脏行"，而不是"这一笔"。
这一格不是装饰——脏行会不会进上下文取决于跑的人当时有没有未提交改动，
而**当时那一趟的脏行数没有任何一层记录过**（只有"载体 = 分支 `959fd1e6`"这一句）。

#### ④ 两臂（都不是"改测试凑绿"，两臂都不需要窗口、不碰容器）

| 臂 | 怎么跑 | 读数 |
|---|---|---|
| 负（真数据） | `bash scripts/verify-selfhost-stack.sh --no-build` | **`NEG_RC=1`**，`❌ 被验镜像的 OCI revision 与当前树不是同一笔` + 两个完整 SHA；死在 compose 之前，没有起任何容器、没腾任何端口 |
| 正（同一段代码、输入相配） | 从脚本里 `awk` 抽出那 15 行，把 `TREE_SHA` 预先设成镜像自己那份 revision 再 source | `PASS_BRANCH_RC=0`，打出 `revision == 当前 HEAD（959fd1e6b8c9…）` 与脏行计数 |

⚠️ 正对照用的是**抽出来的同一段**而不是重写一遍——重写的那份不是被测对象。
（这跟 §8.91 那枚"三棵树读数一样"的教训是同一件事：跨分支/跨输入的比较里，
必须有一臂走的是"应当不响"的那一支，否则一条恒红的判据看起来像在守护什么。）

#### ⑤ 门禁复跑（这一改动的暴露面）

`check:script-snapshot` `rc=0`（31 个 bootstrap 脚本）、`check:gate-wiring` `rc=0`、
`check:selfhost-entry-command` `rc=0`（它本来就扫这个文件里的入口命令形状）、
`docs-link-check` `rc=0`、本文表格对账 `rc=0`。

#### ⑥ 对第 2 项关闭判据的影响（要说清，别读成"第 2 项现在才算做完"）

第 2 项那格 `VERIFY_EXIT=0` 的**读数不变、仍然成立**（§8.76 已逐笔核过零产品字节差，
四张截图字节入库且人看过）。这一节补的是它缺的**第四层里"当前产物"那一档的机器保证**：
从现在起，"验的是不是这一棵树的镜像"不再取决于跑的人记得不记得，而 `--no-build`
那扇逃生门也只剩"这一棵树自己的旧 tag"这一种用法。
排在 g71 之后的那趟重跑因此**必须**是默认旋钮（`BUILD=1`），否则它会在这里红 ——
那是正确的红：它拒绝把旧二进制的读数当新读数。

### 8.93 「定义与链段**一起**消失」这一档判据 1 结构上看不见 —— 把本批对链的唯一新增钉进锚点表（2026-10-04 15:3x）

#### ① 为什么动这道门禁，而不是"落地就算完了"

第 1 项的关闭判据是 main 前进到载体。但前进之后还有一句没人守的：**下一笔**谁拿自己那份
stale base 提交 `package.json`（整文件覆盖，不是三方合并），本批并进去的链段就没了。
`scripts/check-gate-wiring.mjs` 正是为这件事存在的，它的文件头写着
「掉哪一个都是"整条链不再检查一件事"级别的事故」—— 所以先看它**现在能不能抓住这一种形状**，
而不是假设它能。

它的判据 1 的主语是**定义**：「每一道 `check:*` 定义要么在链里，要么在允许表里」。
而整文件覆盖会**同时**抹掉定义与链段 ⇒ 主语消失 ⇒ 这条判断根本不触发。
这一档只有锚点表（`REQUIRED_ANCHORS`，与"定义在不在"无关）能抓。

⇒ 与 §8.91 那条 `pkgFieldVerdict` **不是同一层**，别读成重复：`pkgFieldVerdict` 管的是
"**载体这次写回**别把本批改过的非 `scripts` 字段丢了"（合并时刻，一次性）；
这一条管的是"**落地之后**被人覆盖会不会红"（常驻）。

#### ② 该钉哪一段，用差集现量而不是印象

同一趟把三棵树的链拆成段对比（`&&` 切分 + `trim`，与门禁自己的切法逐字相同）：

| 对象 | 段数 | 键数 |
|---|---|---|
| main HEAD | 76 | 145 |
| 主检出的**脏** `package.json` | 81 | 150 |
| 载体 | 77 | 146 |

- 载体比 main 多的段 = **1**：`pnpm check:image-build-args`（本批对链的唯一新增）。
- 脏树比 main 多的 5 段全是**别人**的：`check:legal-closure-truth`、`check:legal-gdpr`、
  `check:vault-diagnostics`、`check:apk-freshness`、`check:shell-erasure-parity`。
- 脏树里**没有** `check:image-build-args` —— 也就是说主检出那份正在被提交的链
  本来就不含本批这一段。这正是"覆盖即丢"的活样本，不是我在推演。

⇒ 锚点加的就是那一条，不多不少。加多了会把别人的链段也纳进本批的地界。

#### ③ 四臂读数（改前 / 改后 / 只摘链段 / 未变异对照）

同一份脚本、同一棵树，只变异 `package.json`，走它自带的 `--pkg` 旋钮（不动工作树）：

| 臂 | 形状 | 改前 rc | 改后 rc |
|---|---|---|---|
| armA | 链段与定义**一起**摘掉（= 整文件覆盖那一档） | **0，红 0 条**（看不见） | 1，红 1 条，逐字是「链里少了锚点 \`pnpm check:image-build-args\`。」 |
| armB | 只摘链段、留着定义 | 1（判据 1「定义还在但不在链里」） | 1，红 2 条（判据 1 + 锚点，冗余但不互斥） |
| 对照 | 未变异 | 0 | 0 |
| 载体配对 | 载体的脚本 + 载体的树（74 定义 / 77 段） | — | 0 |

改前那个 **rc=0 就是这条改动全部的必要性** —— 它不是"我觉得会掉"，是"同一台机器上摘掉它，
没有任何一层会红"。改后 armA 的红**只有一条**且点名锚点，说明这条判据没有牵连别的判断、
也没有把红推给别的原因。

#### ④ 合并影响面：不新增冲突族

`git diff --quiet $(git merge-base main feat/self-host-distribution) main -- scripts/check-gate-wiring.mjs`
⇒ **NO**（main 自 merge-base `b850b1c6` 起没碰过这个文件），而 `git diff --numstat main HEAD` 给
41 增 0 删（全是本批新增行）。所以这一改动落在七族之外且**不可能冲突**，
不需要给载体工具加第八族。

#### ⑤ 落地时刻顺带的现场变化（记录，不解释成因果）

等待期间 main 从 `8590ae02` 前进到 `b4033742`（`git rev-list --count` = **2 笔**：`65567666` 是 B76 补记、
`b4033742` 是证据入库前置换成提交后逐字节对账），
主检出脏条目 185 → 154，阻塞集仍是 **1 枚 = `package.json`**。载体随之重算：

```
✅ 载体 165d4a34 = main(b4033742) × feat/self-host-distribution(3d8d317f)
   并集 scripts 键 146 · 链段 main=76 本批=67 base=66 并集=77（摘段 0/0）
   · 非 scripts 顶层字段比了 9 个，两侧改动全落进磁盘对象（丢 0）
   门禁 8 道全 exit 0
```

臂表复跑：`node research/tools/selfhost-merge-carrier-arms.mjs` ⇒ rc=0，7 条 ✅ / 0 条 ❌。

#### ⑥ 敞口要说全（别把这条写成"从此不会掉"）

这一改动把「覆盖 `package.json`」变成会红。但「**同时**覆盖 `package.json` 与
`scripts/check-gate-wiring.mjs`」仍然没有机器守 —— 守门人被覆盖是这类门禁的通用剩余敞口，
只能落在评审层（那一笔 diff 会同时动两个文件，比只动一个显眼）。我没有为这一档造判据，
也不打算造（再往上就是无限回归）。

复跑：`pnpm check:gate-wiring`（链第一段）；注入：
`node scripts/check-gate-wiring.mjs --pkg /tmp/ht-armA.json`（armA 的生成方式在本节 ② ③，
摘段 + 删定义，两行 `node -e` 就能重造）。

### 8.94 逐段归属对拍器搬进仓（`research/tools/selfhost-check-segments.mjs`）—— 顺手抓到配对树自己过期，并把"只在载体红 = ∅"在纯 fs 子集上先取到（2026-10-04 15:4x）

#### ① 为什么这件事要在落地之前做

第 1 项的关闭判据要求"完整 `pnpm check` 的**每一枚红**仍可逐条归属到非本批"。而 `scripts.check`
是一长串 `&&`：**第一段红就整体退出** ⇒ 完整跑只给我一个失败点，看不出后面几十段的状态。
归属要靠"两棵树各跑一遍再取差集"，而那套逻辑原先只活在 `/tmp/check-segments.mjs` +
`/tmp/attrib-two-trees.sh` 两份临时脚本里 —— 落地那一刻要用的东西捏在 `/tmp`，本身就是风险
（main 上 `65567666` 那笔记的就是"同一台机器上 `/tmp` 取证文件被别人污染"）。

#### ② 写这版工具的第一跑就抓到一条真缺陷（不是设计出来的）

现量：`/tmp/heyta-main-check` 的 HEAD 是 **`dcbb94ab`**，而 `main` 当时已经是 **`f0afe884`**。
也就是说 §8.88 之后任何拿它做"main 也红"配对的读数，都是在**拿一笔旧运行给新结论背书** ——
这是"两边都对上"里最贵的一种假绿：它不报错、不异常，只是把差集算在一张过期的表上。
⇒ 工具把这件事变成前置判据：`--tree <路径> --ref <引用>` 时先 `rev-parse` 两侧比对，
不等就**退 2**（用法/探针码），并打出两枚 SHA。同一趟还断言工作树 0 脏、`node_modules` 在位
（没有它的红是 `MODULE_NOT_FOUND`，不是判据红）。

#### ③ 六臂（每条都真跑，含"必须能红"那条）

| 臂 | 形状 | 期望 | 现量 |
|---|---|---|---|
| 1 | `--only zzz-not-a-gate`（空选择器） | 2 | **2** |
| 2 | `--max-load 1`（负载门） | 3 | **3** |
| 3 | 配对树落后于 `--ref` | 2 | **2**（打出 `dcbb94ab` vs `f0afe884`） |
| 4 | 树脏（指主检出，154 条未提交） | 2 | **2** |
| 5 | 正样本真跑（carrier 上 `check:gate-wiring`） | 0 | **0** |
| 6 | 真造一枚红（一次性假树里 `scripts.check = "false && pnpm check:gate-wiring"`） | 1 | **1**，且"只在 fake 红 (2)"非空、"链里没有的段"按 `ABSENT` 分开登记 |

臂 1 有第二次价值：它最初**走不到**。第一版把选择器检查排在负载门**之后**，
那一趟负载 13.77 ⇒ 直接退 3，我差点把"这条臂没红"读成"选择器检查是多余的"。
⇒ 用法错（码 2）比环境（码 3）便宜且确定，必须排在前面 —— 顺序不是风格，是能不能看见自己探针坏了。

#### ④ 纯 fs 子集的先量归属（第 26 项的前半）

载体 `7c8b8173`（= main `8c4cbf1e` × 分支 `cdc7126e`）与**当前** main 两棵树各跑 6 段
（`check:gate-wiring` / `docs` / `docs-voice` / `md-tables` / `selfhost-entry-command` / `script-snapshot`）：

```
链并集 77 段（carrier=77 / main=76）· 本次判定 6 段
只在 carrier 红 (0)：∅    只在 main 红 (0)：∅    两边都红 (0)：∅
明细 TSV：/tmp/fsattrib.tsv（12 行 = 6 段 × 2 棵）   PAIR_RC=0
```

`check:gate-wiring` 在**两棵树都绿**这一条顺带证明了 §8.93 那枚锚点不会把 main 判红
（main 那份链里没有这一段，但它那份文件里也没有这条锚点 —— 两边各自自洽）。

⚠️ **这一趟的 `--max-load 20` 要写明理由，不许读成"我调了阈值"**：负载门防的是**超时与端口争抢**
（重型段：build / `-r test` / 各 e2e），而这 6 段是纯文件系统计算，单段实测 0–1 秒、不起进程不抢端口
⇒ 负载对这类读数不构成有效性条件。默认阈值仍是 12，且**完整链那一趟必须用默认值跑**；
把这条写在这里是因为"同一台机器上为了拿到读数而放宽旋钮"是最容易滑过去的一步。

#### ⑤ 与落地那一刻的接法

```sh
node research/tools/selfhost-check-segments.mjs \
  --tree /tmp/heyta-merge-carrier --as carrier --ref feat/self-host-merge-main \
  --tree /tmp/heyta-main-check    --as main    --ref main \
  --out /tmp/land-attrib.tsv            # 不加 --only = 全链 77 段逐段跑（默认负载门 12）
```
落地前必须先把 `main-check` 那棵树 `checkout -f $(git rev-parse main)` 同步到当前 main ——
工具会拦住不同步的情况，但拦住 ≠ 白跑一趟，所以命令仍要连着写。
"只在 carrier 红"非空时**不许落地**，逐段回本批写集解释（§8.88 的基线方向已翻：干净 main 现在全绿）。

### 8.95 端口守卫的 `lsof` 探针**坏了而读数长得像"没人占"** —— 这一条如果不抓到，下一个用它扫链的人就会杀掉别人的 dev server（2026-10-04 15:5x）

#### ① 事故形状（发生在写守卫的那一趟，不是发生在别人身上）

给 `selfhost-check-segments.mjs` 加"逐段扫链前先看端口有没有人听着"这一档时，造了腿 1：
自己在 4318 起一枚监听，再跑工具，期望 `SKIP_SAFETY`。实际读数：

```
占位者监听行数=2          ← 直接跑 lsof，端口确实被占
[fake] ❌ rc=1 0s pnpm check:ai-e2e     ← 工具的守卫**没拦住**，这一段真的跑了
端口安全跳过 0 段
```

#### ② 成因：两种"空"在退出码上完全同形

命令是把 `-iTCP:<port>` 和 `-sTCP:LISTEN` **按端口各带一遍**：

```
lsof: duplicate TCP inclusion: LISTEN     ← stderr
stdout 为空，rc = 1
```

而"端口真的空闲"同样是 stdout 为空、`rc = 1`。⇒ **退出码在这里没有分辨力**。
第一版拿 `rc > 1` 当"探针坏"的信号，于是探针坏被归进"没人占"，守卫直接放行，
而 `pnpm check:ai-e2e` 的 preflight 会把它拿到参数的那几枚端口上的进程 **SIGKILL** 掉
（§8.88 记过这条边界）—— 也就是说：这一档一旦带着这个 bug 进落地那一刻，
症状不是"这趟红"，是**别人的 dev server 没了**，而且现场不会有任何一行日志指向这里。

现量校准（三条各跑一次，用来定"哪个字段才有分辨力"）：

| 情形 | rc | stdout | stderr |
|---|---|---|---|
| 空端口（无人监听） | 1 | 空 | 空 |
| 有监听（单个 `-sTCP:LISTEN`） | **1** | 有表头 + 数据行 | 空 |
| 探针坏（`-sTCP` 重复） | 1 | 空 | **有字** |

⇒ `rc` 三种都是 1；唯一有分辨力的是 **stderr 有没有字** 和 **stdout 有没有数据行**。

#### ③ 改法三条

1. `-sTCP:LISTEN` 全命令**只出现一次**（`-iTCP:4318 -iTCP:4319 -sTCP:LISTEN`）。
2. **不用 rc 判成败**：stderr 有字 ⇒ 探针坏 ⇒ `exit 2` 拒跑；判"被占"只看 stdout 去掉表头后的行数。
3. **阳性对照用系统里一枚已经在监听的端口**喂同一个解析器（本机现量 `:39876` 抓到 1 行）；
   抓不到 ⇒ `exit 2`。本次挑出的段里没有会腾端口的，就打印"不做"，**不假装验过**。

#### ④ 两臂（改后重跑）

| 臂 | 形状 | 期望 | 现量 |
|---|---|---|---|
| 腿 1 | 4318 被我自己的监听占着 | 跳过、不执行 | `SKIP_SAFETY pnpm check:ai-e2e：端口被占（4318/4319 ← node/…/127.0.0.1:4318/(LISTEN)）`，`跳过 1 段`，`红 0`，rc=0 |
| 腿 2 | 端口空 | **必须真跑**（守卫不许恒跳过） | 同一段执行了（`[fake] ❌ rc=1 0s`）。这个 rc=1 是夹具自己起不来，不是判据红；臂要证的是"没有恒跳过"，它证到了 |

腿 2 的教训顺带记一条：**夹具的绿不是臂的绿**。我原本拿"marker 文件存在"当腿 2 的通过条件，
而 `pnpm check:ai-e2e` 在那枚一次性假树里根本跑不起来 ⇒ marker 恒不存在。
真判据是"这一段被**执行**了"（输出里有 `[fake] rc=…` 那一行），marker 是我假想出来的第二把尺。

#### ⑤ 同一趟量到的负载现场（解释"为什么现在什么都跑不了"）

`load` 两趟现量：`1min = 78.48`（守卫腿那一趟，工具自己打的）与 `54.9 / 34.7 / 24.1`（紧接着的 `ps` 那趟）。
两个数不同序，所以都写出来而不是拼成一串。CPU 前列里有一枚**不属于本批**的孤儿：

```
pid 29644  PPID=1  %CPU=100.0  ELAPSED=17:03:22
command = node --experimental-import-meta-resolve --require …/heyta-wt-hierarchy/…
cwd     = …/heyta-wt-hierarchy/packages/domain
```

它是另一条线（`heyta-wt-hierarchy` 那个 worktree）挂住的 17 小时长跑，`ppid=1` ⇒ 父会话早没了。
🔴 **我不杀它**：不是我起的进程、也不知道它有没有未落盘的产物，那是那个 worktree 的所有者的决定。
这里只留证据，因为"负载 78"这种读数如果不带上归属，下一读的人会去调低阈值（而阈值不能动）。
⇒ 本轮所有重型动作（第 2 项全跑、落地那一刻的完整链扫段、`reinstall:all`）现在都**不该起**。

#### ⑥ 复跑

```sh
node research/tools/selfhost-check-segments.mjs --tree <树> --only check:ai-e2e
# 腿 1：node -e "require('net').createServer().listen(4318,'127.0.0.1')" & 后再跑
```
