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
| G-47 | 镜像那棵依赖树**没有被钉住**：`check:image-license` 证明的是"2026-10-03 这一次 npm 解析结果的 143 条逐条有出处"，而每次构建 npm 都会重解一遍（没有 lockfile）。改直接依赖会红，**纯传递依赖的上游发新版不会** | 🔄 **对账已做、登记那句被量得更准、闭合形状要换**（读数见 §8.20）。现量：镜像树与 pnpm 生产树**同名同版本 125 个、镜像独有 0 个、版本不一致 14 个** —— 14 个全是镜像比 lockfile **新**，其中 12 个是传递依赖（`pino` + `@simplewebauthn/server` 底下 11 个 `@peculiar/asn1-*`，那是 **passkey 验证路径**），2 个是直接依赖（`@fastify/static ^10.1.2` 解到 10.1.5 而 pnpm 是 10.1.4、`ws ^8.18.0` 解到 8.22.0 而 pnpm 是 8.21.3）。⇒ 登记那句"改直接依赖才会漂"其实**说轻了**：没人改任何依赖，只因为版本落在 `^` 范围内，发出去的镜像就跑着一套本仓库任何测试都没跑过的版本。`--check` 新鲜度绿、覆盖率对账绿，两条都管不到这件事。🔴 **原闭合形状实测不成立**：`pnpm deploy --prod` 在 pnpm v10+ 要求 `inject-workspace-packages=true`（全仓依赖解析方式的改动），而 `--legacy` 会去 registry 取 `@heyta/i18n` 直接失败；另外 filter 打错时 `pnpm deploy` **什么都没做还 exit 0**。⇒ 换成：把已提交的那份快照从"记录 npm 这次解出什么"改成**镜像要装的版本就是它**（装配时按快照逐条钉版本），等式判据与钉版本**同一批**落地（不能先加判据把链钉红），复验仍要一轮真构建。🟡 **2026-10-04 00:4x 部分推进**（现量与判据见 §8.26）：那 143 条**仍未钉**（要 docker + 低负载窗口，与 #12 同一个），但镜像里**唯一那一枚手写版本字面量** `prisma@5.22.0` 现在有了等式判据 —— 它是第三份抄件，此前没有任何一层在守；新判据挂成 `check:image-license` 的第三条腿，5 臂注入各自精确报红、未变异对照绿。同时 §8.20 步骤 1 的**形状被改掉**（快照不能既是 install 实参的来源、又是 install 形状的哈希输入，否则等式两边都是它自己）|
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
| `check:l4` | ⚪ **不是本批**：红的是 `apps/mobile/src/screens` 内联样式 **98 > 基线 90**（12 个文件）。A/B 现量：同一目录在**基点 `f0db2a3a` 与本分支 tip 上都是 101**（`git grep -c 'style={{' <ref> -- apps/mobile/src/screens` 逐行求和），而本分支只碰过 `apps/mobile/src/sync/store.ts` 与一个 mobile 测试，**没有一个在 `src/screens/` 下**。这是 M3 那笔已提交债（同"98>90 里剩 8 处是 M3 已提交债"），**不吸收、不为凑绿调基线** |
| `@heyta/sync-server` 的测试 | ⚪ **不是回归，是隔离检出的前置缺失**：`pnpm -r test` 里唯一红的是 `tests/account-profile.spec.ts` **整个文件加载失败**（`测试进程里没有 JWT_SECRET`），而这个 worktree **没有 `server/.env`**（主检出有）。当场 A/B：注入随机 `JWT_SECRET` / `PASSWORD_PEPPER` 后该文件 **27/27 通过** ⇒ 判据本身没坏，缺的是本机凭据文件。其余 **2079 passed / 1 skipped**（111 个文件） |
| 其余各包 `pnpm -r --filter '!@heyta/sync-server' test` | ✅ exit 0，**6407 passed**（12 个包，最大一包 1502） |
| `check:web-storage` | ⚪ 单跑 ✅（Worker SQLite + OPFS + 刷新后仍在，五条判据全过）；链里那次红发生在 `loadavg 31–46` 的窗口，**归因为"未定性"**，不写成"环境没问题" |

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

1. **把快照从"读数"升成"合同"**：`server/image-npm-tree.json` 已经带 `inputs` 三枚哈希与
   `generatedAt`；改成装配阶段按快照里的 `name@version` **逐条钉版本**安装（`npm install` 的实参来自快照，
   不再来自 `^` 范围）。这样"审过的版本"与"装出去的版本"之间第一次有等式，
   而且**不新增第二份 lockfile**（第二份抄件会漂是这个批次反复付过学费的形状）。
   重跑生成脚本这个动作随之变成"提交一次版本变更"，由现有 `--check` 的哈希判据盯着。
2. **等式判据同批进链**：新增一条比对（快照 ↔ pnpm 生产树，按平台分层排除原生包），
   并做注入验证能红（把快照里一条版本号改一位 ⇒ 红；把平台分层拿掉 ⇒ 应报出 `@node-rs/*` 那一族，
   否则说明分层本身没牙）。
3. **真构建复验**（需要 docker daemon + 负载 ≤12 的窗口，与 #12 同一个窗口）：
   `pnpm verify:selfhost-stack` 全跑，并在**镜像内**读一次实际装的树，与快照逐条比 ——
   这一步的判据是"镜像里数出来的 143 条与快照逐字相同"，不是"构建退出码 0"。
   ⚠️ 若这一批最终改成 `pnpm deploy` 路线，Dockerfile 里那条必须带 `--fail-if-no-match`，
   并且解包目标要用一个**新建的空目录**（失败的 deploy 会留下半成品，`COPY` 会把它当产物）。

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


