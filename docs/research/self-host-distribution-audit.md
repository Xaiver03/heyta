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

补一条会挡路的已知缺陷：`apps/web/vite.config.ts` 里**没有 `base`**，挂载路径靠命令行 `--base=/app/` 传（`deployment.md:465,471`）；同时 PWA 的 `/sw.js` 与 manifest 里 `start_url/scope/icons` 全是根绝对路径，在 `/app/` 子路径下会落回落地页（`deployment.md` §3.7「还没做的」，登记至今**未修**）。~~登记至今未修~~ ⇒ **2026-10-04 现量更正：这一句作为"当前状态"已过期**——`apps/web/src/pwa/register.ts:43` 现在是 `${import.meta.env.BASE_URL}sw.js`，产物 `apps/web/dist/manifest.webmanifest` 的 `start_url`/`scope` 是 `"."`、`icons[].src` 是相对路径（挂载路径已成为构建参数）。⚠️ 这只推翻到**代码与产物层**；"线上 `/app/sw.js` 现在返回的是 JS 而不是落地页 HTML"没有在本趟取证，所以它作为**部署态**判据仍待复验（G-59）。⇒ 要把界面塞进镜像，**必须先把挂载路径变成构建参数**，否则打出来的包在子路径下是坏的。

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
| G-40⑥ | 服务端无版本兼容/支持矩阵政策（行业一致形态见 §4 第 4 条） | **未关**，而且是**有意的不写**。矩阵不存在（全仓没有"支持 N-1 / 同 major"的表），触发条件三处互相指得到：`server/README.md` 三条前置（版本来源同空间 / 客户端有真 full-state 生产者 / 有东西消费那个闸门）、G-44 的重分类、以及"第一枚镜像发布时 ⑤ 与 G-44 必须同时落地"。本批没有让这条更接近；最近一次**逐条判它仍然成立**的现场在 §8.160 ⑥（对外手册否定句普查那一行），漂移裁决在 §8.159 ① |
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
| G-41 | `env.example` 文档化的旋钮与 compose 的白名单之间没有对账 ⇒ "照着文档填了值"与"什么都没填"逐字相同 | **本批关闭**：`pnpm check:server-env`（已挂进 `pnpm check`）。现量读数见 `server/scripts/check-server-env-forwarding.mjs` 文件头；11 条豁免逐条带理由，且"豁免项必须仍然没有通路"本身是判据 ⇒ 这张表只能变小、不能变成谎话。台账现场（10-05 那次 sweep 补上的指针，见 §8.159 —— 这行原先整行没有一个 `§8.x`，也就是"关掉了一句、没人会被带回正文复核"）：§8.3 第 5 条记的是它自己那两处放水怎么改掉的（变异复跑 14 个孤儿 + 13 个错位一次全打印），§8.108 记的是它与 `check:selfhost-entry-command` 这两把尺各自的输入 |
| G-42 | 自建区的四条错话（§2.3 / §7） | ✅ **已关**（2026-10-03 台阶 0，读数在 §8.9；**这行一直留到 10-05 才回写，本身就是台账漂移的一条证据 —— 见 §8.159**）。四条里三条由并行会话改完并提交（`729f4bd4` → `1e092733` → `bf271a1e`），本批在 `packages/i18n` 上的净改动是 `s7p1` 一行 × 中英两份；那笔 `c219e4ec` 现量**已在 main**（`git merge-base --is-ancestor c219e4ec main` ⇒ 真）。原句那两个前提都不成立了：① "未关"过期；② "`packages/i18n` 此刻仍被并行会话占着" —— 主检出那两份词条表现为**干净**（`git status --porcelain -- packages/i18n/src/locales/*` 空） |
| G-43 | `checking` 期间宿主把拦截叙述成裁决（界面对用户说谎） | **本批关闭**（§8.3 第 1 条） |
| G-44 | `appVersion` 在服务端**有消费者、没有生产者**：`server/src/sync/checkpoint-gate.ts` 拿它判 `MIN_CHECKPOINT_SAFE_APP_VERSION`，`sync.service.ts:676 touchDevice` 把它记进 `sync_devices`，而它是**下载请求上的一个可选查询参数**（`packages/shared-schema/src/supersync-http-contract.ts:191` 是 `z.string().optional()`）—— `packages/sync-client/src/client.ts:1324-1327` 只往查询串里写 `sinceSeq` 与 `excludeClient`，**没有任何 heyta 客户端发过它** | 🔴 **本批重新归类，不按原登记实现**（证据链见 §8.17）。原句"补一个生产者"是错的：三条事实连起来说明**光上报版本会把那条日志变成假信号**，而阈值 `18.21.2` 住在**上游 Super Productivity 的版本空间**里。它不是自托管分发的缺口，是"客户端检查点/全量边界"这条**未实现的功能**的一部分 ⇒ 对外说法已在 `server/README.md`「Clients and version coupling」就地改成三个前置条件（原句只列了两个，且把"只差上报"写成了事实） |
| G-45 | 台阶 3（镜像 npm 依赖树 vs 许可证门禁扫的 pnpm store）曾是**未证实** | **本批量完并关成"有对账"**（§8.8）：`check:image-license` 逐条对账 + 四条会红的登记自检，7 发变异各自精确报红、阳性对照绿。残余风险（纯传递依赖上游发新版）已改挂 G-47 |
| G-46 | `server/scripts/build-and-push.sh`（`pnpm --filter @heyta/server docker:build` 的唯一实体）原来是**上游形状**：它自己抄了一份 7 条的镜像输入清单，其中 3 条在本仓库不存在（实测 `[ -e ]` 全不成立），而 `apps/web` / 11 个 `packages/*` / `pnpm-lock.yaml` / `server/` 自己**一条都不在里面**；`GHCR_NAMESPACE` 默认成 `super-productivity`（**别人的组织**）；并且无论给不给版本号都**顺带覆盖 `:latest`** | **本批关闭**（§8.7 第 4 条）。三条各自都会出事，都已改：清单改成 source 同一个读者、namespace 无默认值（不给就在任何 docker 之前 exit 1）、只推点名的那一个 tag。⚠️ 消费者集合是量过的：除 `server/package.json:14` 外只有 `server/tests/migration-sql.spec.ts:345` 读它，而那一发在 `it.skip` 里 ⇒ **不报错也不守** |
| G-47 | ~~镜像那棵依赖树**没有被钉住**：`check:image-license` 证明的是"2026-10-03 这一次 npm 解析结果的 143 条逐条有出处"，而每次构建 npm 都会重解一遍（没有 lockfile）。改直接依赖会红，**纯传递依赖的上游发新版不会**~~　🔴 **这段到 2026-10-04 05:5x 为止描述的是现实，现在四个事实变了**：`server/package-lock.json` 是提交物并且是 Dockerfile 的一条 `COPY` 输入（"没有 lockfile"为假）、镜像那棵树**由它驱动解析**（鉴别实验：锁里改一个版本，产物跟着改）、快照不再"每次重量"而是**从锁派生**、"改直接依赖才会红"这一句当时就说轻了（14 条在漂、两个还是直接依赖，见下面状态栏）。闭合形状与登记里预期的**不是同一件事**：§8.46（为什么 `pnpm deploy --prod` 与"提交锁 + `npm ci`"两条都走不通）、§8.47（落的形状与全部读数）| ✅ **2026-10-04 已关**（中间态曾是"🔄 对账已做、闭合形状要换"，读数见 §8.20）。现量：镜像树与 pnpm 生产树**同名同版本 125 个、镜像独有 0 个、版本不一致 14 个** —— 14 个全是镜像比 lockfile **新**，其中 12 个是传递依赖（`pino` + `@simplewebauthn/server` 底下 11 个 `@peculiar/asn1-*`，那是 **passkey 验证路径**），2 个是直接依赖（`@fastify/static ^10.1.2` 解到 10.1.5 而 pnpm 是 10.1.4、`ws ^8.18.0` 解到 8.22.0 而 pnpm 是 8.21.3）。⇒ 登记那句"改直接依赖才会漂"其实**说轻了**：没人改任何依赖，只因为版本落在 `^` 范围内，发出去的镜像就跑着一套本仓库任何测试都没跑过的版本。`--check` 新鲜度绿、覆盖率对账绿，两条都管不到这件事。🔴 **原闭合形状实测不成立**：`pnpm deploy --prod` 在 pnpm v10+ 要求 `inject-workspace-packages=true`（全仓依赖解析方式的改动），而 `--legacy` 会去 registry 取 `@heyta/i18n` 直接失败；另外 filter 打错时 `pnpm deploy` **什么都没做还 exit 0**。⇒ 换成：把已提交的那份快照从"记录 npm 这次解出什么"改成**镜像要装的版本就是它**（装配时按快照逐条钉版本），等式判据与钉版本**同一批**落地（不能先加判据把链钉红），复验仍要一轮真构建。🟡 **2026-10-04 00:4x 部分推进**（现量与判据见 §8.26）：那 143 条**仍未钉**（要 docker + 低负载窗口，与 #12 同一个），但镜像里**唯一那一枚手写版本字面量** `prisma@5.22.0` 现在有了等式判据 —— 它是第三份抄件，此前没有任何一层在守；新判据挂成 `check:image-license` 的第三条腿，5 臂注入各自精确报红、未变异对照绿。同时 §8.20 步骤 1 的**形状被改掉**（快照不能既是 install 实参的来源、又是 install 形状的哈希输入，否则等式两边都是它自己）。✅ **2026-10-04 05:5x 关闭**（`1b7d0921`，读数在 §8.47）：落的形状既不是 `pnpm deploy`，也不是"把快照逐条钉进 Dockerfile"，而是**把 npm 自己解出的那棵树提交成 `server/package-lock.json` + 一条 `COPY` 进生产阶段**，三条 `npm install` 一个字未改（实测 `npm install` 认锁、只在范围内取版本，不升级到范围内最新 —— §8.46 结论四的 C1/C2/C3 三档）。复验是**两趟真构建**（含"锁里手工改一个版本 ⇒ 产物跟着改"那一发鉴别实验，它才是"锁在驱动解析"的证据；只看"输出相同"兼容"npm 没读锁"）+ **两种载体对账**（模式 A 146 = 扫描集 126 + 镜像独有 17 + 自家包 3；模式 B 145，磁盘枚举 ⊆ 锁的非 dev 158 且差 13 条全 `optional`）+ 9 臂变异各红一次。⚠️ 别读成"完全可复现构建"：锁钉的是**第三方 registry 层**，三枚自家 tgz 走 `npm install` 的原生行为装**当前字节**（这是要的，本地包跟源码走）；`npm ci` 那条"更彻底"的形状实测会在冷缓存 `EINTEGRITY`、热缓存**静默装上一版自家代码**。G-53（`*-linux-arm64-musl` 那一类平台二进制从没进过扫描集）**已闭（同日 05:4x，§8.48：判定 4 按提交物锁的 `os`/`cpu`/`libc` 三字段逐条过同一套许可证权威，14 枚全 MIT 全 optional）** —— 这半句曾在行尾挂了很久"未闭"，10-05 那次 sweep 回写成现状（漂移本身记在 §8.159）。这一族现在剩下的是**"承诺发哪几个架构"**那一层（§8.48 末段、上面 #2 那行的"amd64 发布物零运行证据"），它要人拍板，且**不是**扫描集这一层的前置 |
| G-48 | `check:web-artifact:app`（核对 `--base=/app/` 那份产物的那一道）**零自动消费者** —— 2026-10-03 由新门禁 `check:gate-wiring` 量出：它是 63 道 `check:*` 里唯一合法落在链外的一道，而全仓 `grep` 只有 `package.json` 自己那一行，没有任何 workflow / 验收脚本 / `deploy.sh` 调用它 ⇒「上线前跑一次」目前只写在脚本头部注释里 | ✅ **已关（2026-10-03，判据与登记见 §8.19）**。登记那半句被否证：`server/Dockerfile:211`（10-04 现量更正：原写 191，Dockerfile 长出 20 行后台账没跟着改；行号会漂 ⇒ 按内容找 `grep -n "check-web-artifact.mjs.*--mount /app/" server/Dockerfile`） 一直在跑同一条判据的**脚本本体**，`grep` 漏它是因为搜的是别名。决定：链**不放**这道判据（`apps/web/dist` 是一个目录、两种载体，链里 `pnpm build` 打的必然是根载体，把 `/app/` 载体放链里就是拿错的字节验对的东西 —— 现量：同一份 dist 上一条 rc=0 一条 rc=1）；改为**每个发布载体各自带对账**：runbook §3.7 的 rsync 之前插入 `pnpm check:web-artifact:app`（两处），`check:gate-wiring` 新增"链外门禁必须点名消费方文件 + 该文件里有一行**以这条命令开头**"，把"没人跑它"从一句注释变成会红的判据。6 臂注入 5 红 1 绿（绿那臂是刻意留的越界对照） |
| G-48b | G-48 关的是"这一步在不在发布序列里"，**没有**关"这一趟有没有人真的跑过它"：`consumers` 判的是 runbook 里那行命令还在，人工 rsync 前跳不跳过去仍然只取决于人。另外 `apps/web/dist` 一目录两载体没变（§8.19 读数 B），按载体分目录要同时动 `package-app.sh` / `package-msix.ps1` / `reinstall-all.sh` 的同步对账 / `Dockerfile` —— 四端打包输入的变更 | **未关**（本批只登记，理由如上：会新增一个"能碰生产"的对外动作面，或要改四端打包输入）。挂在这里是为了让下一轮别把 G-48 的绿读成"发布已经有守卫" |
| G-49 | 站内那篇自建指南（`packages/i18n` 的 `site.docs.selfhost.*`）是入口命令的**第 4 份抄件**，而 `check:selfhost-entry-command` 的扫描集里没有它（现有扫描集：`docs/runbooks/self-host.md`、`server/README.md`、`server/env.example`、`docker-compose.migrate-once.yml`、`local-server-verification.md`）| ✅ **本批关闭**，但**登记的前提一半是错的**（读数在 §8.18）：58 条词条里当时**没有一条**是完整入口命令，s7p2 只有 `-f` 那三个 flag 的**碎片**（没前缀、没 `up -d`、**没 `--build`**）。碎片比没抄件更坏 —— 拼起来敲就是 §8.11 那次 `pull access denied`。所以做的是两件事：文章改成给**完整一条**（中英各一份，与 runbook 逐字相同），再把这两份词条文件纳入扫描集（`source: 'copy'`） |



### 8.5 版本耦合写成政策（台阶 1 本体的最后一项）

落在 `server/README.md`「Clients and version coupling」，形态是**两句真话 + 一条触发条件**：

- 镜像里的客户端与服务端**天然同一份源码、同一次构建** ⇒ 这一对不存在兼容问题；对账方式是 `VCS_REF` 构建参数与 `deploy.sh` 的 revision 核对。
- 其他形态的客户端（移动壳 / 桌面壳）**必须来自同一份源码版本** —— 因为 E2EE + op-log 语义下，服务端从设计上读不到明文，任何"降级兼容"都只能在**看得见的元数据**上做，判不了数据。
- 🔴 **不写"支持 N-1 / 同 major"的矩阵**，因为①今天没有任何发布产物（矩阵无人可引用），②`appVersion` 有消费者没生产者（G-44），矩阵**技术上无法被执行**。触发条件写死在文档里：**第一枚镜像发布时，G-40⑤（版本来源）与 G-44（生产者）必须同时落地**，矩阵才能从"政策"变成"事实"。
  ⚠️ **上面这句的"两个前置"口径在 §8.17 之后已经过期，留原句是为了让人认出这个想法从哪来。** 取证判定：光上报 `appVersion` 会把那条日志变成**假信号**（阈值 `18.21.2` 住在 Super Productivity 的版本空间里，heyta 的 `0.x` 永远比成"旧"），所以 G-44 不是"补个生产者"那种缺口。对外那份（`server/README.md`「Clients and version coupling」）已改成**三条前置的完整链**（版本来源与闸门同空间 / 客户端真的**创建**因果 full-state 边界 —— 服务端那半 `snapshot-handler.ts` 早已实现、客户端从不调用 / 有东西消费那个闸门），并且明写"上报只是其中一条，不是这句话过去声称的那两条"。**当时改了对外那份却没 sweep 到这里 —— 本节就是那笔欠账。**

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
| `research/tools/check-image-license-coverage.mjs` | 两种载体的树逐条对扫描集；没见过的必须在 `IMAGE_ONLY_PACKAGES` 里**带 license/URL/日期/为什么**登记过；登记还要**仍然成立**；计数恒等式必须闭合；**两种载体各有一条与该树之输入/来源锁的双向差集**（真树=磁盘↔`/app/package-lock.json` 两个独立观测；快照=与它的**输入**锁，只拦生成器漏数与手改提交物，2026-10-04 §8.103 补） |

它同时拦五种"看起来没事"（第 5 种是 2026-10-04 §8.103 加的；前四种每条都注过射）：

- 快照里冒出一条没登记的新依赖 ⇒ 红（**注入 `evil-injected-pkg@9.9.9` 实测红**，
  并连带报"计数不闭合"）；
- 登记里的 license 被改成非宽松 ⇒ 红（**注入 `GPL-3.0` 实测红**）；
- 登记已经过期（条目不在快照里 / 其实已在扫描集里）⇒ 红
  （**两发各测一条：注入 `zod@9.9.9` 报"不在快照里"，注入 `@fastify/accept-negotiator@2.1.0`
  报"豁免不再成立"**）—— 这张表因此只能跟着现实变小；
- 改了声明却没重新生成快照 ⇒ 红（**注入错的 `serverPackageJsonSha256` 实测红**，
  并打印重跑命令）；
- 树与该树的**来源锁**双向差集（§8.103）⇒ 红。快照侧：摘掉一条锁里非 optional 的包
  （**注入 `@fastify/accept-negotiator@2.1.0` 实测红，报"快照里却没有的非 optional 条目 1 条"**）、
  塞一条锁没记的包（**注入 MIT 假包实测红**）；而差集里那 12 条全 optional ⇒ 绿（容差的正面读数）；
  真树侧：登记项逐条摘满 16 条，**15 条由 lock↔磁盘层抓、1 条 optional 由 rot 层抓，0 条摘了没人守**
  （表在 §8.103，每臂的层级都单独取过原文）。
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
| `s7p1` 在 main 上是否仍教人指向上游 | ~~是：`git show HEAD:packages/i18n/src/locales/zh-CN.ts` 第 3302 行仍是「把 `SUPERSYNC_IMAGE` 显式指到某个 `master-〈提交号〉`」~~ 🔴 **04:0x 被现量否证，且那句命令本身没锚（正是 `check:doc-citations` 拦的那一类）**：`git show c1c203c8:packages/i18n/src/locales/zh-CN.ts \| grep -n site.docs.selfhost.s7p1` = 第 **3567** 行，措辞已经是**反的**（"不要把 `SUPERSYNC_IMAGE` 指向上游的 `master-〈提交号〉`"）⇒ 台阶 0 这条对外错话**在 main 上已经由那条线自己修掉了**；本批那份不再是唯一来源（§8.168 ①）。以后写这种话要用**键**而不是行号，且 ref 要锚 SHA |
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
> `grep` 扫的是**别名** `check:web-artifact:app`，而 `server/Dockerfile:211`（10-04 现量更正：原写 191，Dockerfile 长出 20 行后台账没跟着改；行号会漂 ⇒ 按内容找 `grep -n "check-web-artifact.mjs.*--mount /app/" server/Dockerfile`） 跑的是**同一条判据的脚本本体**
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
> ✅ **上面那句"仍是开口"是 10-03 当时的事实，已过期。** 决定走的是"**链不放这道判据，改为每个发布载体各自带对账**"
> 那一支（登记表那一行的现状 + §8.19 的判据与登记），并且挂载路径在此批里**确实成了构建参数**
> （`apps/web/vite.config.ts` 的 `base: webBase()` 取 `HEYTA_WEB_BASE`，判据 `check:pwa` +
> `server/tests/web-app-serving.spec.ts`；现量更正见 §8.110 ⑦）。
> ⚠️ 这一处也是 `selfhost-registry-drift-sweep.mjs` **照不到的那一面**：它比的是"登记行的状态 vs 正文结论"，
> 而这次是**登记行已经更新、正文旧断言留在原地** —— 方向相反，同一族。它和 §8.177 那条合起来说明：
> 一张表要两边都往中间收，只检查一个方向就会漏掉另一方向的漂移。

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

- `server/Dockerfile:211`（10-04 现量更正：原写 191，Dockerfile 长出 20 行后台账没跟着改；行号会漂 ⇒ 按内容找 `grep -n "check-web-artifact.mjs.*--mount /app/" server/Dockerfile`） 早就在跑这条判据：`RUN node scripts/check-web-artifact.mjs --dist apps/web/dist --mount /app/`
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
  ~~本批没有任何一笔还留在外面~~。**🔴 10-04 22:1x 现量否证**：那两笔 merge 带进来的是**当时的分支头** `b850b1c6`，而分支在那之后又前进了 151 笔 —— 现量 `git merge-base --is-ancestor feat/self-host-distribution main` ⇒ **rc=1**、`git rev-list --count main..feat/self-host-distribution` = **151**、差额 **58 个文件**（逐类见 §8.134）。"已经落进 main"这句从今天起只对 02:09 那一刀成立，**不能**再当第 1 项（#7 合并落地）的关闭依据。带它进来的是两笔 merge：`9a61a88a`（01:43，第二父 `95732679`）
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
- item #8 `pnpm reinstall:all`：前置条件"**落地之后**"在 02:09 ~~已满足~~ —— **10-04 现量限定**：就"本批改过 `apps/web`"这一条而言成立（差额 58 个文件里 `apps/web/` 命中 **0**），但差额里仍有 `packages/i18n/src/locales/{zh-CN,en}.ts`（界面文案会烘进 RN/浏览器包）与 `apps/landing/*`、`server/*` ⇒ **今天重装装出来的四端不含本批的文案修正**，所以这一项仍然排在整批落地之后（理由从"apps/web"换成"词条"，结论不变）。
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
🔴 **04:0x 复量：这一句的 ref 没锚，所以它今天讲的是另一件事** ——
`git show c1c203c8:research/tools/check-image-license-coverage.mjs | grep -c websocket` = **1**，
那一枚就是 `'@fastify/websocket@11.3.3'` 的**登记条目本身**（`checkedAt: '2026-10-04'`），不是注释。
⇒ "防御只活在我分支"已被**main 自己加上这条登记**否证；留下来的含义换成两条：
① 台阶 0/G-47 那一族在 main 上也有了 ⇒ 落地时这枚文件是**两侧都改**的形状，
   载体第七族（对账器本体）第一次会在真窗口里被真走到（§8.168 ②）；
② 同趟 `grep -c IMAGE_ONLY` 在 main 上是 **7**，与本句当时写的"14 条"不是同一个计数单位
   （枚举行 vs 含该词的行）⇒ 引用"N 条"要带它是怎么数出来的（[[feedback-duplicate-facts-drift]]）。
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

> ⚠️ **本节那格 `116 笔` 是 08:5x 的瞬时读数，15:0x 现量已变成 `97`，18:4x 再取是 `26`**
> （`origin/main` 已到 `9070e18d`；全部读数与命令见 §8.115。同一把尺
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

### 8.96 用**权威那把尺**复核我自己的台账表格（而不是我的 /tmp 副本），并记下"注册进 FILES 现在是免费的"这一格读数（2026-10-04 15:5x）

#### ① 起因：我一直在用一把次级尺给自己打分

`check:md-tables` 的 FILES 清单（main 侧那份 `scripts/check-md-table-rows.mjs`）**不含本台账**，
所以我每轮跑的是自己写的 `/tmp/ht-mdt-audit.mjs` 副本，并把它的 `rc=0` 写进提交信息。
那正是本仓登记过的漂移形状（[[抄件一定会漂]]）：**副本与真门禁的判据不是一条**——
真门禁比我的副本多第三条腿（"表头下面必须紧跟分隔行"，它自己注明"这条放走过两枚真缺陷"）。
所以"MDT_RC=0"这句话此前**证明的是我的副本**，不是那道门禁。

#### ② 现量（拿真那份的判据本体，只换它的 FILES 行）

把 main 树的脚本原样拷出，只把 `const FILES = [...]` 换成本台账的绝对路径（判据函数一字未动）：

```
✔ markdown 表格行：1 个文件，列数、断行与"是不是表"都一致     REAL_GATE_RC=0
```

⇒ 台账**在当前状态下满足权威判据**。这件事有直接用途：那份门禁的文件头写着加入的前提是
「这个文件归本线写、且现量干净」——本台账是单写者、现量干净，**两个前提今天都成立**。

#### ③ 牙齿验证两臂成立、一臂是我自己的夹具坏了

| 臂 | 注入 | 现量 |
|---|---|---|
| B | 把三列的表头删成两列（去掉最后一格连同它的行尾竖线） | rc=1，4 处，第一条逐字是 `:1643 列数 3（本表表头是 2）` |
| C | 删掉表头下面那行分隔行 | rc=1，1 处：`这一块的表头下面没有分隔行（GFM 把它当裸文字渲染 ⇒ 列数判据对整个碎片失效）` |
| A | 在数据行行尾竖线**前面**加两个字（竖线根数一根没变） | **rc=0** —— 但这不是门禁没牙 |

🔴 A 臂是我**自己的注入没改到对象**：那个 replace 只是在行尾竖线**前**加了两个字，
**竖线根数一根没变**，所以列数确实没变——它测的是"我加了个字"，不是"我加了一列"。
⇒ 一条注入在判红之前要先证明**它真的动了被比的那个量**（这里应当是 `pipePositions(line).length` 改前后各打一次），
否则"没红"会被读成"门禁没牙"。这与 §8.95 腿 2 那个 marker 是同一形状：**判据要用被测对象自己的权威字段**。

#### ④ 为什么我没有顺手把台账加进 FILES（这条要写清，别读成"忘了"）

`scripts/check-md-table-rows.mjs` **在 main 侧自 merge-base `b850b1c6` 之后被改过**（现量：
`git diff --quiet $MB main -- 该文件` ⇒ YES），而本分支**根本没有这个文件**。
把它加进我的写集 = 制造**第八个冲突族**，而冲突族的数量是落地风险的形状，不该为一条
"锦上添花的文档自检"去换。⇒ 正确动作是**交接**，不是代改：
给该文件的所有者留一行改动（判据不用动）：

```js
'docs/research/self-host-distribution-audit.md',   // 单写者；10-04 15:5x 权威判据现量 rc=0
```

#### ⑤ 我自己的副本就此退役（换成同一条权威口径）

以后核这份台账不再跑 `/tmp/ht-mdt-audit.mjs`，改跑这条（判据本体来自门禁那份文件）：

```sh
node -e 'const fs=require("node:fs");const s=fs.readFileSync("/tmp/heyta-main-check/scripts/check-md-table-rows.mjs","utf8")
  .replace(/const FILES = \[[\s\S]*?\];/,"const FILES = ["+JSON.stringify(process.cwd()+"/docs/research/self-host-distribution-audit.md")+"];");
  fs.writeFileSync("/tmp/mdt-real.mjs",s)' && node /tmp/mdt-real.mjs
```

⚠️ 它依赖 main 那棵树是**当前** main —— 这正是 §8.94 那条 `--ref` 判据防的事，
所以跑之前先 `git -C /tmp/heyta-main-check checkout -qf "$(git rev-parse main)"`。
等 §8.16 落地之后，权威那份文件会同时带着这条 FILES 项进 `pnpm check`，这条一次性命令就不需要了。

#### ⑥ 这一节自己被抓了一次（两把尺同判），写下来因为它是本节论点的实证

把本节插进台账后立刻跑权威那份：

```
✖ markdown 表格行错位 1 处：
  docs/research/self-host-distribution-audit.md:5941 列数 5（本表表头是 3）   AUTH_MDT_RC=1
```

成因就是 ③ 表格里 A 那一行：我把 `line.replace(/\|\s*$/u, ' x |')` 原样写进了表格单元格，
**代码段里的裸竖线被当成列分隔**——正是这份门禁文件头自称抓过的第二类缺陷，我当天又写了一遍。
修法：那一格改成中文描述（"在行尾竖线前面加两个字，竖线根数一根没变"），不写含裸竖线的代码。
⚠️ **第一次修完仍然报同一行号**：B 那一行里也写着裸竖线（代码段开头那个 `|`）。
⇒ 这类判据报的是"这一行"，不是"这一处"；改完必须回读到 rc=0，不能改一处就宣布修好。

两条要如实登记的读数：

1. 我的副本 `/tmp/ht-mdt-audit.mjs` 对**同一处也给 rc=1**（同一行号、同样"列数 5 / 表头 3"）。
   ⇒ 我先前那句"一直在用次级尺自证，所以绿色读数可能是假绿"作为**风险**成立（覆盖面没逐条比过），
   但作为**事实**在这一型上不成立：这一型两把尺一致。副本真正的未知项只剩第三条腿（分隔行那一判据）
   有没有实现——没测，就不写结论，改用权威那份即可（⑤）。
2. 缺陷**没有进过任何一次提交**：append 之后我第一件事就是跑尺子，抓到才落笔修。
   这跟 §8.94 那条"配对树自己过期"是同一类收益：**把测量搬到写盘那一步之后、落笔之前**。


### 8.97 第 2 项（`verify:selfhost-stack` 全跑现量）拿到闭合读数，以及两趟之间那一次"环境无效"的归属（2026-10-04 16:0x–16:1x）

**两趟，同一支分支，结论不同档 —— 分开记，不许合并成一句"跑过了"。**

| 趟 | 载体 | 结果 | 差在哪 |
|---|---|---|---|
| g75 16:02–16:0x | `af1bbdf8` | **RC=1** | 真浏览器三条判据**从未起跑**：全局内存闸门 `/tmp/tfa-test.lock` 拒绝（持有者 pid 8721 = `~/.tfa-shield/bin/node --test ~/scratch-owner-transfer/rbac-ai-queue/staging-gated.test.mjs`，**另一个仓库**的测试）。其余各层读数全部取到 |
| g76 16:11–16:15 | `feed25c9` | **RC=0，三条全过** | 等闸门 90s 后释放，默认旋钮（`BUILD=1`，不传 `--only`/`--skip`）整趟重跑 |

🔴 **没有绕护栏**：闸门自己印了 `TFA_ALLOW_CONCURRENT_TEST=1` 这条逃生门，**没用**。理由是它拦的是"并发测试把整机推到 1.8–26GB"那件事，与本批无关的第三方测试正在跑时，绕过去拿到的读数也不该被当成"环境有效"。等窗口 = 90 秒，成本几乎为零。

**g76 的完整读数**（日志 `/tmp/g76.log`，汇总 `/tmp/g76-summary.txt`）：

- 镜像：`supersync:selfhost-verify`，`被验镜像的 revision == 当前 HEAD（feed25c907c5…）` —— 这条读回判据（§8.92 补的）第一次在真跑里发挥作用：它挡的就是"复用本地那个 tag 给旧二进制打分"。
- 镜像内依赖树对账：145 条 = 门禁扫描集 126 + 逐条登记的镜像独有 16 + 本仓库自己的包 3（无解释 0 · 非宽松 0 · 声明对不上 0 · 失效登记 0）；平台变体 14 枚逐条过许可证权威，其中 13 枚不在本次载体的树上。
- 服务图：默认 3 个（未动）· 带 override 4 个（+`supersync-migrate`）。
- 入口命令对账：扫描集 7 份 + 故意排除 1 份，命中 9 条，逐行过 R1–R6，R7 把验收载体钉在同一套 `-f` 文件上。
- D-3：一次性容器 `exited(0)` · 应用侧 `RUN_MIGRATIONS_ON_STARTUP=false` · 带外恢复 flag=true · **已应用 42/42** · 悬挂 0 · 重复完成 0。
- 界面挂载：`[web-app] 共享 UI 挂在 /app/（来自 /app/web-dist）`。
- 真浏览器三条：`S1 /app/ 打开就是应用且 SW 在 /app/ scope 注册上`、`S2 在这台实例上注册并登录，凭据落在本机自己那台服务器`、`S3 建一条任务同步出去，全新设备只能从服务端读到它` —— **3 passed (9.6s)**。

**§6.2 规定一：四张图人看过了，逐张写明看到什么**（不是"截了就算"）：

- `s1-app-loaded.png`：未登录态的**真应用**（不是落地页、不是错误屏）—— 收集箱空态、rail 九项、AI 工具调用与对话助手两张卡、中文默认、蓝白主题，主蓝落在"收集箱"激活项与"添加"按钮上。
- `s2-signed-in.png`：身份区是 `selfhost-1746602-1@example.test`，菜单为「编辑个人信息 / 设置 / 退出登录」（危险色在最后一项），顶栏"已同步"绿勾 —— 与 AGENTS §9 那条身份入口裁决一致。
- `s3-device-a-synced.png`：设备 A 的收集箱计数 1，条目 `selfhost-task-1746602-2` 落在"不重要不紧急 / 无截止时间"。
- `s3-device-b-recovered.png`：**全新设备**（空 IndexedDB 的新 context）读到**同一条** `selfhost-task-1746602-2`，计数同为 1 —— 这一张是"打开浏览器就能用"里唯一不能靠单端证明的那一格。

🔴 **旧图差点冒充新证据（本节的真实收获之一）**：`e2e/selfhost-stack-results/` 里躺着 **09:32 那趟**的四张图（`.last-run.json` = `passed`，载体 `959fd1e6`）。g75 被闸门拒绝时**没有**覆盖它们 —— 也就是说"日志说三条判据没跑，目录里却有四张看着像证据的图"这个形状是**此刻真实存在**的。跑前录了 md5（16:11:32），g76 后 mtime 全部落在 08:15:47–08:15:55，脚本自带的 `FRESH=4/4` 与逐张"本次的"标记把归属钉住了。可迁移的那条：**引用任何截图前先量它是不是这一趟写的**，`mtime > 起跑时刻` 是必要条件。

顺带一条**产物距离**读数（决定"旧图能不能算数"）：`git diff --name-only 959fd1e6..feed25c9` 共 37 笔，落在 `apps/` `packages/` `server/` 下的**产品源码 0 处**（全部在 `docs/ e2e/ research/ scripts/`）。所以 09:32 那趟缺的不是产品能力，只是一趟运行 —— 但按元规则 3（"测试全绿 ≠ 这是当前产物"）仍要重打镜像重出图，这一趟就是这么做的。

**同一轮修掉的两处（都不是判据强度变化，是"读数在说谎"）**：

1. `verify-selfhost-stack.sh:214` 那句"构建上下文的未提交条目=N（>0 ⇒ 这趟不是纯提交物）"把**整棵工作树**的 `git status` 计数冠名为"构建上下文脏"。本机现量那 1 枚是 `?? e2e/node_modules`，而仓库根 `.dockerignore` 有 `**/node_modules`，它根本进不了镜像 ⇒ 这句是**自我削弱式的错话**（把已经成立的纯提交物证据自己说软了）。改成逐条列清单、不替 `.dockerignore` 下结论（手搓排除表就是第二套真源）。提交 `feed25c9`。
2. `selfhost-check-segments.mjs` 的依赖前置从 `existsSync(node_modules)` 升级为读 `node_modules/.modules.yaml`（pnpm 每次完整安装必写）。提交 `360fb91a`。三臂实测：假树（有目录无元数据）退 2 并打印补救命令；补上该文件后越过这一腿、改在脏树守卫处退 2；真树不被挡。
   🔴 **这一条差点被两枚假读数改坏**，两枚都记进注释里挡后来者：`ls node_modules | head` **不列点开头条目**，所以真装全的树看着只有 3 项；根 `node_modules/.bin/vitest` 在**四棵真装的树上都不存在**（vitest 是各包的依赖），拿它当缺失信号会让工具恒退 2，反而永久挡死配对。

**本项剩余的一格**：以上都是**分支载体**上的读数。第 1 项落地后要在 **main 侧**再取一次（同一支脚本、同一套判据，载体换成 main），否则"外人一条 compose 起全套"这句在部署态上仍未验证。载体边界也写清：g76 跑在 `feed25c9`，其后那一笔 `360fb91a` 是纯验收工具改动，不在镜像与界面判据的输入里。

### 8.98 落地窗口开好后会不会白跑：载体在新输入下重算 + 一处 `traps #196` 的复发实例（2026-10-04 16:1x–16:2x）

🔴 **本轮抓到的不是合并问题，是"窗口开了以后工具会不会 die"那一格**（§8.90 记过同一族，这次是它自己的第二次实例化）。

`research/tools/selfhost-check-segments.mjs` 的脏树前置在**真树上恒退 2**，报"工作树有 1 条未提交"。那 1 条是 `?? e2e/node_modules` —— linked worktree 里为了不重复装第二份 playwright 而指向主检出的**软链**。它兜在 `git status` 里的原因正是 traps #196 记过的那条：**根 `.gitignore` 写的是带尾斜杠的 `node_modules/`，尾斜杠只匹配目录，挡不住软链**。后果不是难看，是**恒挡**：g74 的扫段与 4b 配对两趟都过不了这道前置，也就是说阻塞集归零、窗口开好之后，那一把会整把 die(2)。

修法是一行（提交 `d0c0802e`）：`node_modules/` → `node_modules`。三条实测，含改前对照：

- `git check-ignore -v e2e/node_modules` → `.gitignore:6:node_modules`（改前：无规则命中）；
- `git status --porcelain` → 不再出现它（改前：`?? e2e/node_modules` 常驻）；
- `git ls-files -co --exclude-standard` 命中数 **0** —— 这一条是 #196 原事故的那个方向（打包集合会把未忽略的软链当未跟踪文件送出去），**同一行修两头**。
- 复跑真树臂：`A_RC=0`，打印 `self=d0c0802e 脏=0 pnpm装过=是 ref=feat/self-host-distribution✓`，那一段真执行且 `rc=0`。

依赖前置那一腿同时被升级（`360fb91a`：读 `node_modules/.modules.yaml` 而不是 `existsSync(node_modules)`），两条被否证的候选记在注释里挡后来者：`ls node_modules | head` 不列点开头条目（真装全的树看着只有 3 项），根 `node_modules/.bin/vitest` 在四棵真装树上都不存在（vitest 是各包的依赖）—— 拿后者当缺失信号会让工具**恒退 2**，比原来的问题更糟。

**载体在新输入下重算**（`ed0a837b = main(4235319d) × feat/self-host-distribution(d0c0802e)`，`CARRIER_RC=0`）：

- 七族解法仍成立，含 `.gitignore` 那一族新增的第 6 行改动 —— 它落在与 main 不同的行上，行并集 + 零丢失断言没被触发。
- scripts 并集 146 键；`check` 链段 `main=76 本批=67 base=66 并集=77（摘段 0/0）`；非 `scripts` 顶层字段比了 9 个，丢 0。
- 八道纯 fs 门禁**全 exit 0**（负载 15.99 时跑的：这八道是纯 fs，不需要低负载窗口 —— 需要窗口的是"两边都红⇒非本批"那种配对结论，见 §8.94）。
- ⚠️ `main` 在本轮内又前进了一次（`8c4cbf1e → 4235319d`，别人那条线的一笔启动器修复）。这坐实了 §8.93 那条：**落地前必须再重算一次载体**，几分钟就 2–3 笔；现量命令就是脚本自己印的那句 `node research/tools/selfhost-merge-carrier.mjs`。
- ⚠️ 归属边界如实写：这次重算与 g74 用的是**同一个** `/tmp/heyta-merge-carrier`。当时 g74 仍在 POLL 阶段（阻塞集 1 枚，未归零），两趟没有交叠；g74 归零后会自己再重算一次并覆盖本节的 SHA —— 那是设计内的，不是冲突。

🔴 **这行修复的代价也打在同一个位置，别只留收益**：改 `.gitignore` 让它**进入了本批写集**（写集 40 → 41 枚），而主检出的 `.gitignore` 此刻正被别人脏着（他们那两行是 `research/tools/.*.snap.*`）⇒ 落地阻塞集当场从 **1 枚变 2 枚**（现量 `selfhost-landing-blockers.mjs`：`BLOCK .gitignore` + `BLOCK package.json`）。也就是说换来的是"窗口开好后不 die"，付出的是"**多等一次别人提交**"。
判断是**保留**，两条理由：① #196 已经复发过一次，摘掉根因就是等第三次，而"摘掉"并不免费 —— 替代做法要么在工具里维护一张"哪些未跟踪路径不算脏"的表（第二套真源），要么把这棵树的软链换成独立安装（几百 MB，且 g76 已证明软链形态跑得通）；② 载体实测这一族能自动解：我改在第 6 行、他们改在第 191 行附近，行并集 + 零丢失断言不触发。
⚠️ 但这条判断的有效期取决于别人什么时候提交 `.gitignore`。落地前重取现量，不要引用本节的"2 枚"。

### 8.99 G-49 那条"判据能红"做成了本轮现量，而不是引用旧记录（2026-10-04 16:2x）

objective 第 5 项要的是"让它进对账**且判据能红**"。进对账这一腿 g76 的日志每次都在打印（扫描集 7 份、`zh-CN.ts`/`en.ts` 各命中 1 条），但"能红"这一腿此前只有一条 2026-10-03 的记录 —— 而"某道门禁曾经能失败"是会过期的那种断言（同 §8.88 那条"main 也红"的豁免）。所以本轮就地复验一次。

**变异必须施在被扫的那一层**，这一点在动手前读了实现才定下来：`findCopyEntryCommands` 取的是**词条值里被反引号包住的 span**（`matchAll` 抓成对反引号之间的内容），再过 `cmdRe`。所以改散文、改整篇都会得到一个"探针没读到东西"的假读数，而不是"门没牙"。臂：把 `site.docs.selfhost.s7p2` 里那条命令的 `-f docker-compose.build.yml` 摘掉，**中英两份同步改**（只改一份会让红的原因变成"中英不同步"而不是"入口命令漂了"），替换前带命中数断言 `恰好 1` 才落笔。

读数：`ARMED_GATE_RC=1`，5 处红 ——

- `zh-CN.ts:3305 · site.docs.selfhost.s7p2` 命中 **R1**（少 override）与 **R5**（与对外主命令不逐字相同）；
- `en.ts:3104 · site.docs.selfhost.s7p2` 同样两条；
- 第 5 处是**跨抄件**那条：`docs/runbooks/self-host.md:143 + server/README.md:94 + zh-CN.ts:3305 + en.ts:3104 [R5]` —— 四份被同一次比对点名，这就是"抄件互相钉住"的直接证据（只比集合挡不住"行贴错对象"，所以它是逐字比）。
- 报错里带**键名**而不只行号：词条值在 3305 行那种长行里，只给行号等于让人在整行里猜。

复原也是读数的一部分（否则这条臂本身就在污染工作树）：`git checkout --` 那两份之后，`md5` 与臂前基线**逐字相同**、门禁 `RESTORED_GATE_RC=0`、`git status --porcelain` 空。

⇒ 第 5 项的两腿现在都是**当天现量**：进对账（g76 打印）+ 能红（本节）。装置留在 `/tmp/g85-arm.mjs`（一次性，未入库 —— 它的价值在这次读数，不是一份要长期维护的臂；要长期跑应该挂进 `research/tools/mutation-rigs/`，那是另一件事，登记在此不代做）。

### 8.100 第 3 项 G-48 的两条腿都取到本轮现量，顺带记一条"载体存在 ≠ 这趟真跑"与一条被排除的错误推理（2026-10-04 16:2x–16:3x）

objective 那句"**同一个 `apps/web/dist` 不可能两条同时绿**"本轮直接量了，两跑纯 fs、零写盘：

| 腿 | 命令 | 结果 |
|---|---|---|
| 链里那条 | `node scripts/check-web-artifact.mjs --mount /` | **rc=0** ✅ 产物自洽：挂载 `/` 与产物声明一致（5 个本地引用、15 个 manifest 文件、4 个 data URL 落在 `/widgets/`、246 个 `--ht-*`） |
| 生产那条 | 同一份产物、不改任何东西、`--mount /app/` | **rc=1** ❌ 产物与挂载路径不一致：「产物声明它挂在 `/`（从 index.html 的 2 条 assets 引用**反推**）而你要把它放在 `/app/`」 |

挂载路径是**从产物自己声明反推**的，不是拿参数去比参数 —— 所以这两条互斥是设计使然，不是缺陷。宿主 `apps/web/dist` 是默认构建（`src="/assets/…"`），于是它只能对 `/` 绿。

🔴 **`/app/` 那一腿的自动载体，本轮证明的是"这趟真跑"，不是"历史上跑过"**：`docker build -f server/Dockerfile --target web --no-cache-filter web --progress=plain` ⇒ `[web 36/36] RUN node scripts/check-web-artifact.mjs --dist apps/web/dist --mount /app/` 后面紧跟 `✅ 产物自洽：挂载 /app/ 与产物声明一致…4 个组件数据 URL 都落在 SW 前缀 **/app/widgets/** 内；246 个 --ht-* 定义对得上`。`--no-cache-filter` 是关键：不加它，缓存命中时只能证明"某趟跑过"，而那正是 §7 第 27 条（旧产物报绿）在镜像层的形态。probe 用的临时 tag 已 `docker rmi`，残留 0。

⚠️ **一条被排除的错误推理，别照着它再推一遍**：`docker history supersync:selfhost-verify | grep check-web-artifact` 命中 **0** —— 这**不**说明那一层没跑。多阶段构建里 `web` 阶段不进最终镜像，历史里天然查不到。当时我差点把它读成"载体没执行"。

🔴 **还剩一格不可观测（登记，未当场改）**：`verify-selfhost-stack.sh` 把 `docker build` 的输出整体吞掉（`grep -c CACHED /tmp/g76.log` = **0**，日志里只有"镜像 OK"那一行）。也就是说**日常跑 verify 时，那一层跑没跑、是 DONE 还是 CACHED，从日志里看不出来** —— 载体存在是真的，可观测性是缺的。补法（下一轮做，不在这里顺手改）：给那条 build 加 `--progress=plain` 并把输出留档，然后**把"产物自洽：挂载 /app/"那一行必须出现**做成判据（找不到 ⇒ die），注入臂 = 临时改 needle 看它会红。离线先验已经有真数据：`/tmp/g88-web.log:508` 就是 plain 输出里那一行，可以直接喂给解析部分，不必占一次完整构建窗口。

⇒ 第 3 项的"做决定 + 注入验证能红"两腿现在是**当天现量**；上面那格是可观测性的欠账，不是判据缺失。

### 8.101 G-47 三腿的"能红"复验：两臂有牙、一臂存活，以及一条我**没有**据此宣布的结论（2026-10-04 16:3x）

第 4 项此前也只有旧记录。基线三腿先取：全 `rc=0`（腿 1「快照的输入仍然对得上当下声明」、腿 3「提交物锁 320 条、逐条盖住 18 条声明、不判定 0 条」）。

⚠️ **基线第一次跑是我自己的探针坏**：`for leg in "node … --check"; do $leg; done` 在 zsh 下**不对未加引号的变量做词分割**，整串被当成一个命令名 ⇒ 三腿齐刷刷 `rc=127`。如果只读退出码不看 stderr，这就是"G-47 三腿全红"。本仓 §7 记过同一坑（批量门禁在 zsh 下必须 `sh -c`），我又踩了一次 —— 修法就是 `sh -c` 包住循环。

三臂（每臂：改 `server/image-npm-tree.json` → 跑 → 复原 → 复跑确认回绿）：

| 臂 | 改动 | 结果 | 命中的是哪一层 |
|---|---|---|---|
| A | `inputs.serverInstallInputSha256` 末位翻转 | **rc=1** ✅ | 腿 1「快照已经不代表当下的声明（1 处失真）」 |
| B | `packages[0].license` MIT → AGPL-3.0-or-later | **rc=1** ✅ | ⚠️ 但报的是「有 1 条"声明"对不上（抄件过期 / 产物里没声明）」——**不是我以为的"非宽松"那一格**。它确实红了，可红的原因是"许可证与包自己声明的不一致"，不是"AGPL 进白名单外" |
| C | 摘掉 `packages` 里 `@fastify/accept-negotiator@2.1.0`（146 → 145） | **三腿全 rc=0** ❌ 存活 | 见下 |

臂 C 是**先只跑了对应腿**就差点下结论的 —— 补了一次"施同一臂、三腿全跑"才拿到 `红的有 0 腿`。只跑一腿就宣布缺口是不成立的。

🔴 **但我不据此写"锁可被手改而无人守"**，因为边界还没量准：`check-image-license-coverage.mjs` 有**两种载体**（文件头 §32/§39/§41 写明），臂 B/C 跑的是离线那种（读快照 = "我们说要装什么"），而 `verify:selfhost-stack` 用的是 `--installed-tree` 那种（读镜像里实际那棵树），它多一条判定 —— g76 那趟的打印里就有「**失效登记 0**」（登记了但树里没有的条数）。所以摘掉**登记项**（那 16 条镜像独有里的一条）在真树载体上应当会红；我摘的是一条普通 MIT 包，落在两不管的位置。

⇒ 准确的读数只到这一句：**从快照里摘掉一条"既不在 18 条声明、也不在镜像独有登记、也不是本地包"的普通包，离线三腿全绿；真树载体抓不抓，未测**。要把这条缺口写成结论，得先读全两种载体各自的输入集合，或者跑一趟带 `--installed-tree` 的臂 C（要占一次完整构建窗口）。登记为待查，不当场改判据 —— 这条门禁的哈希腿（臂 A）证明"改输入"有牙，缺的是"改产物内容"那一格。

复原读数（臂本身就是污染源，所以它是读数的一部分）：两把脚本都带 `finally` 复原，跑完 `git status --porcelain -- server/image-npm-tree.json` = 空（与 HEAD 逐字相同）。装置留在 `/tmp/g92-arms.mjs`、`/tmp/g93-armc.mjs`（一次性，未入库）。

### 8.102 臂 C 的边界用真镜像导出的树量准了一半，另一半是我自己的第二次分类器错（2026-10-04 16:3x）

§8.101 留的那句"真树载体抓不抓，未测"**不必占构建窗口**：`check-image-license-coverage.mjs` 的真树载体吃的是 `--installed-tree <文件>`，而那份文件可以用一条 `docker run --rm -i --entrypoint node supersync:selfhost-verify … < research/tools/dump-installed-tree.js` 现导（一次性容器、不占端口、秒级）。导出来与 g76 的打印逐字对得上：`root=/app/node_modules · scannedEntries=160 · packages=145 · lockEntries=158 · license 全有 145/145`；喂回去基线 `rc=0`，等式仍是「145 = 126 + 16 + 3（无解释 0 · 非宽松 0 · 声明对不上 0 · 失效登记 0）」⇒ 喂法没错、载体没错。

✅ **量准的那一半**：从真树里摘掉一条 lock 记着的非 optional 包（`@fastify/accept-negotiator@2.1.0`，145→144），真树载体 **rc=1**：

> ❌ npm 的 lock 认为该装、磁盘上却没有的非 optional 包 1 条：@fastify/accept-negotiator@2.1.0

所以 §8.101 那个"摘一条包没人守"的形状，**只在离线快照载体成立**；真树载体有一条 `lock ↔ 磁盘` 的双向差集守着。缺口比 §8.101 写的小，而且修法被这条读数直接指出来了：把同一个形状搬到快照那一侧（快照本来就是从 `server/package-lock.json` 导出的，`磁盘` 换成 `快照 packages` 即可），不新造机制。

❌ **作废的那一半（我的第二次分类器错，记下来挡我自己）**：本想问"摘一条**镜像独有登记项**会不会红"，但我把"镜像独有"实现成"不在 `lockEntries` 里" ⇒ 算出 **0 条**，`onlyInImage[0]` 是 `undefined`，那一臂 `filter(p => p.name !== undefined)` 等于**什么都没摘**，`rc=0` 是空臂的必然结果，不是"抓不到"。门禁那句"镜像独有 16 条"讲的是**不在 `license-inventory` 扫描集里**（那是 pnpm store 的实际安装树），跟"不在 npm lock 里"是两个集合。脚本打印了「取 undefined 施 C1」才被看见 —— 分母为 0 的臂要自己喊出来，否则它长得就像一条测过的臂。
⇒ "摘那 16 条镜像独有会不会红"**仍未测**，#29 继续挂着，且已把集合定义钉成"license-inventory 的扫描集"而不是 lock。

⚠️ 一条不据此宣称的边界：真树载体那条牙依赖喂进去的 `lockEntries`。伪造输入（连 `lockEntries` 一起改）不在任何判据射程内 —— 它的守点是"这份文件由一次性容器现导"，而那一层由 #28（build 输出不可观测）管。

### 8.103 真树载体逐条摘满 19 臂全有牙，顺手把快照侧缺的那半条判定补上并注入验证（2026-10-04 16:4x–16:5x）

§8.102 登记待查的那半条（"#29：摘那 16 条镜像独有会不会红"）**先要认个错：那个臂的形状是错的**。
`check-image-license-coverage.mjs` 的"登记只增不减"判定比的是**真树 ∪ 提交物快照**的并集（行 427–433），
理由写在原地：真树只覆盖"这台机器这次构建的那枚镜像"，单棵判会让同一张表在 arm64 与 x64 上互相打脸。
⇒ 单摘真树里的一条登记项**按设计就不该红**。把设计读成漏洞会白修一次；
但也正是读这段代码照出另一件事：**快照那一侧根本没有与锁的对账** ——
`treeAgreement` 整块被 `if (snapshot.installedTree)` 关着，而提交物快照里连 `lockEntries` 字段都没有（现量）。
那正是 §8.101 臂 C（从快照里摘掉一条普通 MIT 包，离线三腿全绿）活下来的原因。

#### 读数一：真树载体 19 臂，逐条摘满，零"摘了却全绿"（`/tmp/g98.log`）

输入 = §8.102 那份真镜像导出的树（`/tmp/g95-real-tree.json`）。登记表 18 条里真树有 16 条 ⇒ **16 条逐条摘**，
不抽样；另加三条：非登记普通包一条（就是 §8.101 当初存活的那个形状）、声明漂移一条、基线一条。

| 施了什么 | 条数 | rc | 响的是哪一层 |
|---|---|---|---|
| 摘登记项（lock 里**非 optional**：`@fastify/static`、11 枚 `@peculiar/asn1-*`、`pino`、`ws`、`@fastify/websocket`） | 15 | 1/1 全红 | `lock ↔ 磁盘` 双向差集 |
| 摘登记项（lock 里 optional 的 `@node-rs/argon2-linux-arm64-musl`，它登记时写了 `carrier: 'installed-tree'`） | 1 | 红 | **rot 层**（"已经不成立"），不是 lock 层 |
| 摘**非登记**的普通包 `@fastify/accept-negotiator@2.1.0` | 1 | 红 | `lock ↔ 磁盘` 层 |
| 把扫描集里那枚包真树声明的 license 改成 GPL-3.0 | 1 | 红 | "两条路看到的不是同一件事" |
| 不改（基线） | 1 | 0 | — |

`汇总：19 臂 · rc 与期望不符 0 · 摘了却全绿的 0 臂`。每条红的原文都单独取过一次
（`/tmp/g97-D.log`、`/tmp/g97-E.log`），因为"哪一层抓到的"才是这条判据的边界，退出码不是。

🔴 GPL canary 那一臂（往真树 + lock 各塞一条 `@heyta/gpl-canary@9.9.9`，license=GPL-3.0）**一次点亮三层**：
`从没见过` + `不是宽松许可` + `计数不闭合`。G-47 立项时那句"下一次漂进来一个 GPL 的传递依赖，
会不会有人知道"，在真树载体上到这里是**有读数的肯定答案**，且不依赖任何单层。

#### 读数二：快照侧那条判定补上了，四臂注入它自己必须能红

改动只在 `research/tools/check-image-license-coverage.mjs`：锁的读法从判定 4 **上提成两种载体共用的一份**
（原来判定 4 自己读 ⇒ 快照载体没有第二载体可对），快照载体新增双向差集，
并给那句打印补了一段**写清它拦什么、不拦什么**的话。
施臂前量的数据门控：快照 146 条 ⊆ 锁的非 dev 158 条，`快照有锁无 = 0`、`锁有快照无 = 12 条且全 optional` ⇒ 零例外可钉死。

| 臂 | 期望 | 实际 |
|---|---|---|
| 基线（快照载体） | rc=0 且新打印那段真的出现（挡"改了但没跑到"） | ✅ ✅ |
| S1 摘一条 lock 非 optional 的普通包 | rc=1，且红来自**新判据** | ✅（原文"提交物锁认为该装、快照里却没有的非 optional 条目 1 条：@fastify/accept-negotiator@2.1.0"） |
| S2 塞一条锁里没记的包（license 给 MIT，避免别层先响） | rc=1，命中"提交物锁没记的包" | ✅ |
| S4 摘一条 lock 里 **optional** 而快照里真有的登记项（`@node-rs/argon2-linux-x64-gnu@2.2.1`） | 新判据**不响**（容差是活的）而 rot 层响 | ✅ / ✅ |

⚠️ **我自己作废的一条臂**：原本写了 S3"往快照塞一枚 lock 里的 optional 平台变体 ⇒ 应当 rc=0"，
实测 `rc=1`，红来自判定 1 —— `@node-rs/argon2-android-arm-eabi` 从来没进过许可证登记表
（它由判定 4 按锁逐条判，不需要在树侧登记）。**是我的期望错了，不是代码错了**，
那条臂整个不算读数；"差集只允许 optional"这半的正面证明是基线那句 `差集 12 条且全是 optional` + `rc=0`。
提交物复原：`server/image-npm-tree.json` 施臂前后 md5 逐字节相同（`b41922c899…` → 同一个值），`git status` 只剩脚本本体。

#### 边界（这句不能写多）

快照侧新加的**不是**"两个独立观测"：快照本来就是 `gen-image-npm-tree.mjs` 从那把锁导出的，
所以它拦的只有两件事 —— 生成器漏数（同一族缺陷在真树侧漏过 4 条嵌套副本，§8.45）与**有人手改了这个提交物**。
"镜像里实际少装了东西"仍然只有 `--installed-tree` 那趟说得出，而那趟的消费者是 `verify:selfhost-stack`（链外、要构建窗口）；
新加的这条则每次 `pnpm check` 都跑。两种载体各有一条差集、含义不同，这话写进了文件头，不只在台账里。

复跑：两种载体基线各 `rc=0`、`pnpm check:image-license` 三腿 `rc=0`、`pnpm check:script-snapshot` `rc=0`（31 脚本 + .gitignore）。
写集代价：本批多一枚 `research/tools/check-image-license-coverage.mjs`，它在主检出里**现量干净**
（`git status --porcelain -- …` 只回 `.gitignore` 与 `package.json` 两枚）⇒ **落地阻塞集没有因此变大，仍是 2 枚**。
它是载体预置冲突族第七族的成员，取本分支侧这条决定不变。⇒ 任务 #29 关闭。

### 8.104 #28 落地：构建层那条判据不止是"看不见"，它判的还是**拷贝前**那份产物（2026-10-04 16:5x–17:0x）

#28 登记的是"verify 把 `docker build` 的输出吞了 ⇒ 镜像层判据不可观测"。实现时先撞到一件更大的事：
`server/Dockerfile` 里那条 `check-web-artifact --mount /app/`（第 211 行）判的是 **web 阶段的
`/repo/apps/web/dist`**，而外人拿到的是它之后 `COPY --from=web … ./web-dist`（第 268 行，WORKDIR=/app）
⇒ **`/app/web-dist`**。挂载前缀与产物落点一旦说不上（G-48 当初就是这个形状），构建阶段那条照样绿。
所以这次不是"把日志留档"这么简单，补的是三样：

1. `--progress=plain`（那条 RUN 的 stdout 进留档；不加就只能看到 step 名）；
2. 构建层读数写成**三种合法形状**并把命中哪一种打进日志：`ran` / `cached-or-silent` / 两者都没有 ⇒ die。
   不写死"必须执行过"：BuildKit 命中缓存时那一层只打 `CACHED`、不出声，硬判红会把"缓存"与
   "判据没了"混成同一个读数（§8.100 那条"载体存在≠这趟真跑"的另一种面目）；
3. 🔴 **在镜像里**跑同一条 checker：`docker run --rm --entrypoint node -v $REPO_ROOT/scripts:/heyta-chk:ro $IMAGE
   /heyta-chk/check-web-artifact.mjs --dist /app/web-dist --mount $EXPECT_MOUNT`。
   它读的是发出去的那份字节，与缓存无关、与 `--no-build` 无关；checker 本体从宿主只读挂进去，
   不在镜像里再抄一份判定。挂载值 `EXPECT_MOUNT` **从 Dockerfile 现取**（不写死 `/app/`，
   抄进脚本就又造一份抄件），取到 0 行或**多于 1 行**都 die —— "该对哪个挂载"没有唯一答案时不许按首值通过。

#### 五条读数

| 腿 | 期望 | 实际 |
|---|---|---|
| `--no-build` 走一遍真实代码路径 | 提取不 die（现量唯一 1 行=`/app/`）、新的那句复用日志印出来 | ✅✅，随后被 §8.92 那条 revision 闸挡住：`镜像 label=feed25c9… / git HEAD=f00db9cd…` ⇒ `rc=1` |
| 镜像内 checker 正向 | rc=0 | ✅ `产物自洽：挂载 /app/ 与产物声明一致；index.html 的 5 个本地引用、manifest 的 15 个文件全部存在；4 个组件数据 URL 都落在 SW 前缀 /app/widgets/ 内；246 个 --ht-* 定义对得上产物里全部无兜底引用` |
| 镜像内 checker 失败腿（同一条命令只把挂载改成 `/nope/`） | rc≠0 | ✅ `rc=1` + 「产物声明它挂在 "/app/"（从 index.html 的 2 条 assets 引用反推）/ 而你要把它放在 "/nope/"」 |
| 构建层三形状打在真数据上 | 真 plain 日志(g88)⇒`ran`；空日志⇒`die`；合成 `CACHED`⇒`cached-or-silent` | ✅ 三个各命中一次 |
| 唯一性守卫注入（往 Dockerfile 第 211 行后**复制一条**匹配的 RUN） | rc=1 且报错印出条数 | ✅ `现量取到 2 行`；复原后 `md5 54584b49…` 与备份逐字节相同 |

🔴 **这一笔提交自己把本地镜像作废了**（HEAD 前进 ⇒ revision 闸红）。这不是事故，是那条闸在做事：
它挡的正是"给旧二进制打新分数"。`ran/cached` 那个形状读数因此**还没在真实构建上取过**，
留给下一次全跑（本轮负载 19.6，为一行打印去抢一次完整构建不是窗口该花的钱）。

#### 两条实施期踩到的（都值得入档，属"探针自己坏"那一族）

- 本脚本第 86 行就开着 `set -euo pipefail`。我先写的是 `OUT=$(docker run …)` 换行 `RC=$?` ——
  **失败时 shell 在赋值那一行就退出了，`RC=` 那行永远执行不到**，红色路径只会得到一个没有诊断的退出。
  改成 `OUT=$(…) || RC=$?` 才是这条判据自己的取码形状。
- 施臂命令写成 `awk … > server/Dockerfile`，而 awk 有语法错：**重定向在 awk 开始工作之前就把文件截成 0 字节**，
  而 `&&` 链里的失败让后续步骤不执行 —— 这次没留下坏文件只是因为复原那条写在了链外（无条件）。
  一般规律：**施臂的复原动作不能排在 `&&` 链里**；改用 node 写文件后同一臂正常施成并复原。

### 8.105 落地前把第 1 族（`package.json` 那条链）的交叉真的量了一遍：并集成立、摘段 0，另登记一条他们的风险（2026-10-04 17:0x）

g74 从 15:55 起一直报阻塞集 2 枚（`.gitignore` + `package.json`），等的过程里第一次去量**这两枚脏的是什么形状**——
之前只把"阻塞"当一个布尔用，而那两枚的 hunk 到底交不交集决定了落地时会不会停下来要人拍。全部只读
（`git show` + 把工作树指针指到我这棵树跑别人的脚本），不动主检出。

#### 现量

- 主检出 `.gitignore` 未提交 = **2 行**（`research/tools/.*.snap.*` 一条新忽略 + 它的注释），
  与本批那枚 `node_modules`（traps #196）在**不同位置**⇒ 零文本交叉；载体第 2 族本来就是行并集。
- 主检出 `package.json` 未提交 = 重写 `check` 那一整条物理行 + 新增 6 个 scripts 键。
  🔴 这一枚**是真交叉**：他们改的正是本批也改的那一行（链）。
- 段数：`base(b850b1c6)=66 · main HEAD(9070e18d)=76 · main 工作树(未提交)=82 · 本分支(a1d03b64)=67`
  ⇒ `main HEAD ∪ 本分支 = 77`。
- 载体第 1 族的四条断言在**离线三股**上先跑：并集摘 base 的段 = **0**；main 相对 base 摘段 = **0**；
  本分支相对 base 摘段 = **0**；main 工作树相对 main HEAD 摘段 = **0**。
  ⇒ 落地时这一族不会 die 要人拍，也不需要新开第八族——它的解法（键并集 + 链段并集 + 写回 round-trip +
  磁盘回读 + "只增不减"前提断言）本来就把这种交叉吃掉了。

#### 🔴 登记一条在**他们**手里的落地风险（不代改、不摘段）

`main` 工作树新增的 6 个链段里，有 **4 枚实现文件此刻是未跟踪状态**：

| 链段 | 实现文件 | main 里 |
|---|---|---|
| `check:verify-script-copy` | `scripts/check-verify-script-copy.mjs` | **未跟踪** |
| `check:apk-freshness` | `scripts/lib/apk-freshness.sh` | **未跟踪** |
| `check:shell-erasure-parity` | `scripts/check-shell-erasure-parity.mjs` | **未跟踪** |
| `check:vault-diagnostics` | `scripts/check-vault-diagnostics.mjs` | **未跟踪** |
| `check:legal-closure-truth` | `scripts/check-legal-closure-truth.mjs` | 已跟踪 |
| `check:legal-gdpr` | `scripts/check-legal-gdpr.mjs` | 已跟踪 |

`git commit` 提的是整个索引 ⇒ 他们如果 `git add package.json` 而没把那 4 枚未跟踪文件一起收进去，
`main` 前进后链上就会有一段指向**不存在**的实现，载体 `pnpm check` 会红成 MODULE_NOT_FOUND 的形状。
本批的处理口径先写死在这里：**那一类红逐条归属到非本批**（判据就是他们自己的文件缺失），
不代他们补文件、也不为了让链绿去摘那一段——摘段会被第 1 族的前提断言拦下来，那正是它该拦的。

#### 一条对**本批**的自查：他们那枚新门禁扫不扫我改的脚本

`check:verify-script-copy` 的输入集合是**按目录枚举** `scripts/verify-*.sh`（不是写死清单，
这是它自己文件头的主张），所以本批的 `scripts/verify-selfhost-stack.sh` 在它的射程里。
用 main 那份实现、`cwd` 指到本工作树跑一次（纯读盘）：

```
本批树：输入脚本=34 needle=196 缺失=1 插值needle=12 词条中文值条数=2531   ⇒ rc=1
main 树：输入脚本=46 needle=238 缺失=0 插值needle=22 词条中文值条数=2768   ⇒ rc=0
唯一那条缺失 = scripts/verify-mobile-reminder-ring.sh:193 [exact] "移除"
```

⇒ **不是本批的文件**（那条属提醒投递那一线），而且 main 侧同跑 `缺失=0` ——
差别来自本分支的 i18n 落后 main（2531 vs 2768 条中文值），`移除` 这个值是 main 侧才有的。
预测：载体是 main ∪ 本分支，i18n 那两族按键并集取，`移除` 会在场 ⇒ 这一条在载体上不该红。
**如果**落地那趟它真的红了，第一个要看的就是这一枚 needle，归属仍然是他们那条线。
本批两枚 verify 脚本在这次预扫里**零命中**。

#### 一条方法上的（我自己的）

阻塞集当布尔用了三个小时才去量内容，是这一节最贵的地方：**"等谁"必须先等于"等什么形状"**，
否则窗口开的那一刻才发现要人拍板，窗口就白烧一次（§8.90 / §8.98 是同一族的两次实例）。
所以这段读数没有留在 `/tmp`，落成了仓里一条可重跑的装置：
**`research/tools/selfhost-chain-preflight.mjs`**（纯读盘；主检出目录从 `git worktree list` 第一条现取，
不写死路径；链段切法与 `check:gate-wiring` 和第 1 族逐字一致）。
它**不挂 scripts 键、不进链** —— 它吃的是"另一棵工作树的磁盘状态"，挂进链就等于让 `pnpm check`
依赖别人工作树的未提交内容（那不再是可重跑的判据，而是当前状态的照片）。
今天跑出来的就是上面那三行：摘段四个方向全 0、新增 6 段里 4 段实现未跟踪。

### 8.106 G-51 的五步里前三步落地：阻塞集降到 2 枚之后，词条表第一次是干净的（2026-10-04 17:1x）

§8.57 的 v2 补丁（把整条安装承诺从 `site.platforms.web.body` 摘掉）备好文句之后一直压着，
原因是"两份 i18n 词条表在主检出脏着"。这一节先记一件事：**那个前提今天变了**——
现量主检出 `packages/i18n/src/locales/zh-CN.ts` 与 `en.ts` 都是干净的（`git status --porcelain -- …` 空），
阻塞集只剩 `.gitignore` 与 `package.json` 两枚。⇒ 五步里的 ①②③ 第一次可做。

动手前先量两件"删一条会被吞掉吗"与"别人正改这一行吗"：

- **删一条会不会被并集复活**：`grep -n "i18n|词条|zh-CN|en-US" research/tools/selfhost-merge-carrier.mjs`
  只回一条注释（`check:selfhost-entry-command` 顺带证明"没把两份词条抄件并掉"），
  **没有** i18n 那族的自动解法实现 ⇒ 这两个文件走普通 git merge，而 main 没有碰这一行 ⇒ 删除干净生效。
  （这句是查"载体对该文件做了什么"得到的，不是从"并集一般怎样"推的。）
- **是不是别人正在改**：逐字取回四行 —— main HEAD 的 `zh:3282 / en:3053` 与主检出工作树的 `zh:3310 / en:3081`
  **全是旧句**（`可安装、可离线用…` / `Installable, works offline…`）⇒ 不是撞车面，只是我这条分支落后。

落的字面 = §8.57 里那份 v2（**照抄定稿，不另写措辞**）：

```
zh  'site.platforms.web.body': 完整产品，不是演示。断网也能照常记，恢复后自动补传；数据就存在你自己的浏览器里。
en  'site.platforms.web.body': The full product, not a demo. It keeps working when you are offline and
                               syncs when the connection returns — your data lives in your own browser.
```

#### 跑到的门禁（当天）

`@heyta/i18n build` rc=0 ｜ `check:entries` rc=0（入口文件与注册表一致 75 份 ⇒ **这句不在提交物入口页里**，
`grep -rln 可安装、可离线用` 只回 `apps/landing/dist`、`apps/web/dist` 两枚**被忽略的构建产物**）｜
`check:docs-voice` rc=0（site.* 1018 条、禁词表零命中）｜ `check:ui-language` rc=0（zh-CN 2826 / en 2826，中英同步）｜
`check:claims` / `check:legal-copy` / `check:reachability` 各 rc=0。

#### 🔴 两件没做的事，以及为什么没做

1. **两条包测试没跑**：`pnpm --filter @heyta/i18n test` 与 `--filter @heyta/landing test` 都被
   全局内存闸门拒了 —— `已有测试在跑（pid=74180，锁 /tmp/tfa-test.lock；它是 scratch-owner-transfer/
   rbac-local-admission 那趟 node --test）`。**没有**用 `TFA_ALLOW_CONCURRENT_TEST=1` 绕别人的护栏
   （拒绝是环境读数，不是产品结论）。
   替代取证（能免费拿的那一半）：不限扩展名 grep 全部测试目录（`apps/landing/tests`、`apps/web/tests`、
   `packages/i18n/tests`、`e2e/tests`、`e2e/live-site`）⇒ **没有任何用例钉着这句**；
   该键唯一消费者是 `apps/landing/src/site/content.ts:131` 的 `bodyKeys` ⇒ 改值的爆炸半径就是那一张卡。
2. **界面级证据没做，也就不声称**：§6.2 规定一要有真浏览器截图且人看过才算，
   而落地页要 build + preview 起服务，本机负载 19.6、闸门在别人手里。
   ⇒ 这一档与 live-site 判据（步骤④）和落地页重发（步骤⑤）排在同一趟，
   今天这句只到"源码与词条表已改成不承诺安装"，**不到**"用户看到的页面已经不含那句话"。

按 §8.20 的纪律，那条"`site.platforms.web.body` 不含「可安装 / Installable」"的 live-site 判据
**现在不落**：线上站点仍是旧句，提前挂上去只会红在"还没发布"这件事上，而不是红在代码上。

### 8.107 G-51 第四档做到一半：两条包测试补到了、界面判据落成一条有自动消费者的用例，而真浏览器读数被别人的套件挡在门外（2026-10-04 17:2x）

§8.106 末尾欠的两件事，这一节把**能免费拿的那一半**拿完，另一半**照实记成没拿到**。

#### ① 两条包测试：第一次跑到了（不是绕闸）

17:17 那把被拒之后，17:1x 末闸门空了一小段（`/tmp/tfa-test.lock` 不存在），补跑：

| 命令 | 读数 |
|---|---|
| `pnpm --filter @heyta/i18n test` | `Test Files 2 passed (2) · Tests 22 passed (22)`，`I18N_RC=0` |
| `pnpm --filter @heyta/landing test` | `Test Files 22 passed (22) · Tests 1312 passed (1312)`，`LANDING_RC=0` |

退出码取自日志里我自己追加的哨兵行，**不是**后台通知那个包装码（§7 第 164/179 条）。
⇒ §8.106 那条"两条包测试没跑"闭合，改成本节的"跑了、全绿"。

#### ② 界面级判据：写成一条真浏览器用例，落在**本地 build 产物**

新文件 `e2e/landing/platforms-install-claim.spec.ts`（3 条用例；~~3 条~~ ⇒ **18:0x 现量是 4 条**，
第 4 条是看图撞见的 `.lp-note` flex 缺陷，见 §8.110 ②）。它盯的是一句
**没有载体的对外承诺**：`site.platforms.web.body` 原来写「可安装、可离线用」，
而 Web 端到今天也没有可安装的 PWA（`SW_URL='/sw.js'` 在 `/app/` 挂载下返回落地页 HTML，
§8.57 / deployment.md §3.7）。⚠️ **这句里的机制部分已被 §8.110 ⑦ 的现量推翻**（挂载路径已成构建参数），
但"因此就可安装"没有证 —— **摘掉整条安装承诺的裁决不变**。G-51 的处置是把整条安装承诺摘掉，这条用例负责**不让它回来**。

两个形状决定，都不是审美：

- **载体 = `playwright.landing.config.ts` 的 build + preview（端口 4320、`strictPort`、独立
  `outputDir: ./landing-results`），不是 `e2e/live-site/`**。线上那一份还等重新发布（步骤⑤），
  把判据挂到 live-site 会红在"还没发布"上而不是红在代码上 —— 按 §8.20 的纪律不落。
  落在本地产物上，它拦的是**代码往回退**，落地即有效。
- **断言范围收在 `section#web`，不写全页级"没有安装字样"**。同一页另外三张卡合法地含「安装」：
  `zh-CN.ts:3051` iOS「在模拟器上完整跑通：**安装**、建库…」、`:3055` 鸿蒙「能打出**安装**包」、
  `:3057` self-host「不是零思考的一键**安装**」。全页级判据会红在这三条正确的文案上。
  这条不是推测 —— 用例里第三条就是把它钉成断言（`#main` 全文**应当**含「安装」），
  将来谁把那三句里的「安装」也顺手改掉，这条会告诉他范围为什么收在这里。

每条都按 §6.2 规定一写：**先截图再断言**、固定文件名（`platforms-web-card-zh.png` /
`-en.png` / `platforms-page.png`）、`console.error` 与 `pageerror` 进断言，
并且**负向断言配正向锚点**（先要求新句含「断网也能照常记」/ `keeps working when you are offline`，
才有资格说「可安装」「Installable」不在 —— 空串的 `not.toContain` 是无条件成立的假绿）。

**自动消费者现量**：`check:landing-e2e` 已经在 `pnpm check` 链里（两棵树的 `package.json` 都是：
`node scripts/check-ai-e2e-preflight.mjs 4320 && pnpm --dir e2e run test:landing`），
而 `playwright.landing.config.ts` 的 `testDir: './landing'` 是**目录枚举** ⇒ 新 spec 自动进套件，
**不需要动 `package.json`**。这一点是刻意的：那枚文件现在正躺在阻塞集里（③）。

**起跑即被挡**：`pnpm --dir e2e exec playwright test -c playwright.landing.config.ts
platforms-install-claim.spec.ts` 回 `内存闸门拒绝启动：已有测试在跑（pid=37974，它是
`pnpm --dir e2e run test`）`，`SPEC_RC=1`，**一条用例都没执行**（`landing-results/` 里
没有新图，最新时间戳还是 00:03）。同一时刻 `vm.loadavg` = **176.63**。**没有**用
`TFA_ALLOW_CONCURRENT_TEST=1` 绕 —— 拒绝是环境读数。等待器 `/tmp/g128-wait.sh`（pid 45068）
每 60s 查锁、锁空后无条件再等 20s 才起跑，上限 3600s，等满按"环境无效≠产品失败"收尾。

⇒ 所以 G-51 这一档**现在只到**"判据已写、静态预验过、有自动消费者"，**不到**"界面已验"。
在拿到那张图并看过之前，不声称界面上那句话已经不见了。

#### ③ 等窗口期间做的零 CPU 预验（它能证明什么、不能证明什么）

扫 `apps/landing/dist/assets`（**5 份** JS/HTML，1,649,058 字节，UTF-8 原样与 `\uXXXX` 两种形状各试一遍）：

| needle | 命中 |
|---|---|
| `断网也能照常记` | 1（`assets/zh-CN-Ds4-fmdC.js`） |
| `keeps working when you are offline` | 1（`assets/en-DTpLKdU2.js`） |
| `数据就存在你自己的浏览器里` | 1（中文 chunk） |
| `可安装` | **0** |
| `Installable` | **0** |

这证明的是**当前构建字节里有锚点、没有旧承诺**（顺带挡掉 §7 第 27/82 条那个"跑在旧产物上照样绿"）。
它**不证明**浏览器把它渲染出来了 —— 词条在 chunk 里而 `dist/platforms/index.html` 里
`indexOf('完整产品，不是演示') = -1`（本站文案是客户端渲染的），所以那条正向断言只能由真浏览器给。

#### ④ 阻塞集从 2 枚回弹到 4 枚，而"不撞车"这句仍然成立（附阳性对照）

17:10 那三格记录的是「只剩 `.gitignore` 与 `package.json`」；**这句六分钟后就过期了** ——
`selfhost-landing-blockers.mjs` 现在报 4 枚，两枚词条表又被写上未提交改动。逐条看了他们改的是什么：
`mobile.vault.devices*`（16 个键）、`site.docs.passphrase.sum`、`site.help.a.passphrase`、
`web.sync.devices.*` —— 9 个 hunk / 两表各 88 行里 **`site.platforms` 命中 0**。
🔴 **阳性对照**：同一条正则 `^[+-].*(platforms\.web|可安装)` 喂给我自己那笔 `88c6e91a`
命中 2 行（旧句 − / 新句 +）⇒ 那个 0 是"他们没碰这一行"，不是"探针读不到"（§7 第 46 条那一族）。
结论：**不撞车**仍成立，但"表是干净的"要按每次现量读，别抄本节数字。

同一段时间里 `main` 自己前进了两笔（`eb97471a`、`406edd5e`，都是别人那条线的闸门/文档修复，
17:22:31 刚落）⇒ 载体的 `^1` 又落后了，落地前**必须重算**，这条协议没有因为读数变新而松动。

#### ⑤ G-55 的三条 needle 在**新的公开 SHA** 上重量：结论一个字没改，代价那一格变了 48 倍

`git fetch`（只读；本批仍然不 push）。现量 `origin/main = 9070e18d`、本地 `main = 406edd5e`：

| needle | 17:2x 读数 | 复核命令 |
|---|---|---|
| 公开树 `server/package.json` 的 devDeps 里那三枚工作区包 | `@heyta/app-host` / `storage` / `sync-client` 全 `"*"` | `git show origin/main:server/package.json` |
| 公开树生产阶段有没有 prune | `npm pkg delete devDependencies` 命中 **0** | `git show origin/main:server/Dockerfile \| awk '/AS production/,0' \| grep -c …` |
| 修法在不在公开树上 | 不在（修在我这条分支，`--is-ancestor` 到 `origin/main` 为假） | 同 §8.89 那三条 |

⇒ **「外人 clone 那棵树今天仍然建不出镜像」这句仍是当前事实**，G-55 继续待拍板。

但**口径 A 的代价那一格必须重写**（这正是 §8.64 末尾那条更正立的规矩）：

| 时间 | `git rev-list --count origin/main..main` |
|---|---|
| 08:5x（§8.64 原文） | 116 |
| 15:0x（§8.89 更正） | 97 |
| **17:2x（本节）** | **2** |

也就是说"push 等于替别人未过目的提交对外发布"这个理由**今天几乎不成立了** —— 只差的就是
别人这两笔，而这两笔已经在本机 `main` 上。⚠️ **这不构成我可以推**：硬约束仍然是不推远端，
而且这个数字会在落地之后重新变大（载体带进来的那几十笔是本批的）。
它改变的是**拍板时看到的形状**：口径 A 现在很便宜，口径 B 那条"分叉"的代价相对就变高了。
本批做到的部分不变：机制已修、判据已挂、缺口编号 + 可复核命令 + 现取数字。

### 8.108 等窗口的间隙把指南的"旋钮面"普查了一遍：0 条对外错话，而代价是我自己第一版探针差点造出两条假的（2026-10-04 17:3x）

G-49 把**入口命令**那一抄件接进了对账，但它管的只有命令串。外人照着指南敲的第二类符号是
**环境变量名** —— 指南点了一个旋钮而仓库里没人读它，或反过来"必填却不见于任何文档面"，
两种都会让"一条 compose 起全套"停在半路。这一节把那一面量完，并且**先记我自己那次探针错**。

#### ① 第一版的取键正则是坏的，而且坏得会**造假阳性**

我第一版从 `server/env.example` 取"已文档化的键"用的是 `^([A-Z][A-Z0-9_]{3,})=`（行首、不许有 `#`）。
量出来是 **15 条**。拿它去减指南点名的 21 条，差集里立刻冒出两条"看起来是真缺陷"的东西：

- `REQUIRE_EMAIL_VERIFICATION` —— 指南 `s2i1` 专门教人设它；
- `SUPERSYNC_IMAGE` —— 指南 `s7p1` 专门警告人别乱设它。

**两条都在 `env.example` 里，只是写的是注释形态**（`:302` `# REQUIRE_EMAIL_VERIFICATION=true`、
`:349` `# SUPERSYNC_IMAGE=ghcr.io/your-name/heyta-server:<你的 tag>`）—— 那正是这个文件表示
"可选、有默认值"的写法，全文件 61 条里 **46 条是这种形态**。
🔴 也就是说：**第一版那个"15"不是文档化数量，是"未注释生效的数量"**，
而我差点把它当成前者去写结论。修法不是加白名单，是**换分母**：`^\s*#?\s*(KEY)=`，
两个数都打出来（61 = 含注释，15 = 生效中），并挂一条**必须为在册的对照集**
（`REQUIRE_EMAIL_VERIFICATION / SUPERSYNC_IMAGE / JWT_SECRET / POSTGRES_PASSWORD` 四条逐条打印"在册"）——
以后这一族再判"没文档"，先过这四条。这与 §7 那一族"分类器只认权威字段"是同一个形状的又一次现身。

#### ② 量到的读数（17:3x，本分支 `7ddf36a9`）

| 量 | 读数 | 尺 |
|---|---|---|
| `env.example` 文档化键 | **61**（其中未注释生效 15） | 修正后的正则 |
| 指南文章点名键 | **21** | 从 `zh-CN.ts` 里 `site.docs.selfhost.*` / `site.help.*` 现取，含 `` `KEY=value` `` 形态 |
| 点名了但连注释都没有 | **4**：`HEYTA_DB` `HEYTA_SERVER_URL` `HEYTA_TOKEN` `HEYTA_PASSWORD` | 差集 |
| 这 4 条有没有消费者 | **有**：`apps/node-host/src/cli.ts:21-22`（文档串）、`:182-185`（帮助串）、`cli-auth.ts:247` 真读 `env['HEYTA_SERVER_URL']` | 逐行 grep |

⇒ 那 4 条不是缺口：它们是 **node-host CLI 自己的环境变量**，不是服务端旋钮，本来就不该出现在
`server/env.example` 里，而文章那一节讲的就是 CLI。
🔴 **本轮这一面的结论是 0 条对外错话**，而且它是有数字的 0，不是"看了一遍没发现"。

我那个"含注释形态"的 61 不是我自己正则的私房数 —— 它和那把尺**自己的分母逐字相同**（现跑）：

```sh
$ node server/scripts/check-server-env-forwarding.mjs
✅ 旋钮通路：文档化 61 = 进 supersync 32 + 进 compose 其他段 10 + 部署脚本消费 8 + 已登记豁免 11（孤儿 0）
RC=0
```

⚠️ 顺带一条给下一个读的人：那个文件**自己的头**写着"2026-10-03 读数：文档化 58 = …+ 进 compose
其他段 7 + …"。那句是**当时**的复现读数（它标了日期，所以不是假话），但同一把尺今天跑出
**61 / 10**，净 +3。这 +3 里有本批自己的那笔 —— `git show 6f315ae3 -- server/env.example`
现量把 `POSTGRES_IMAGE` / `CADDY_IMAGE` 两行加进去（G-52 那一族：运行期镜像源旋钮），
其余的差要按现跑取，别拿日志行数减（10-03 以来日志里新增的键行是 7 条，而净数只有 3，
因为其中几条本来就以任何一种形态在册）。**引用这条尺的读数必须现跑，不抄文件头。**

反向那一半（"compose 必填而文档没有"）**不新做判据** —— 它已经有单一所有者
`server/scripts/check-server-env-forwarding.mjs`（`check:server-env`，在链里），
它的分母是 env.example 的 58 条、带"进容器/进 compose 其他段/部署脚本消费/已登记豁免（孤儿 0）"
四层通路，而且**已经抓出过三个真缺陷**（其中就有 `REQUIRE_EMAIL_VERIFICATION`：文档写了、compose 不通）。
我再立一条就是 §7 那种"同一个判断抄两遍"的起点。

#### ③ 登记一条**没被任何门禁覆盖**的方向，编号 G-56，待拍不代拍

现存两把尺各自的输入：`check:server-env` 吃 **env.example**，`check:selfhost-entry-command` 吃
**入口命令串**。**没有任何一把吃"文章点名的键集"**。今天这个集合减完是 4 条且全部有主，
所以没有活口；但它意味着：**下次有人在指南里加一句"设 `SOME_NEW_SWITCH=false`"，
而 compose 里那一行没写、env.example 里也没列 —— 全链不会有任何一层红。**
这正是那把尺的文件头记着的事故形状（`check-server-env-forwarding.mjs` 自述 2026-10-03 复跑：
58 条里曾有 **14 条填了也不生效**，其中 3 条是真缺陷，第一条就是 `REQUIRE_EMAIL_VERIFICATION`），
只是换了输入源 —— 那条尺的输入是 env.example，我说的这一路输入是**散文里的句子**。

⚠️ **为什么现在不落这条判据**（三条都要，缺一条就不该写）：
① 分母的正确所有者在 `server/scripts/` 那把尺里，加第二个输入源要跨本批边界改它的解析层；
② 我刚用它同族的第一版正则造出过两条假阳性，同一条解析在补上"注释形态 + 四条在册对照"之前不该再扩面；
③ 今天差集是 4 条且全部有主，**没有活缺陷可用来验证新判据能红** —— 按"不能失败的检查没有价值"，
只能靠注入来证明，那要先有一个稳定的假键名，而那是可以随拍板一起做的。
⇒ 拍板时可选做法：把文章键集作为**第三个输入**并入 `check-server-env-forwarding.mjs`
（它已经有豁免表和对照机制），而不是新开一条门禁。

| 号 | 状态 | 事项 | 一条可复核命令 |
|---|---|---|---|
| **G-56** | 登记，待拍（本批不代拍、不新建门禁） | **没有任何门禁把"指南文章点名的环境变量集合"当输入**：`check:server-env` 的分母是 `server/env.example`（61 条，含注释形态），`check:selfhost-entry-command` 的分母是入口命令串。今天这个集合减完是 **4 条且全部有主**（`HEYTA_*` 属 node-host CLI），**没有活缺陷**；但下次有人在散文里加一句"设 `SOME_NEW_SWITCH=false`"而 compose 与 example 都没这一行，**全链零层会红** —— 那正是 `check-server-env-forwarding.mjs` 文件头自述的"58 条里曾有 14 条填了也不生效"那一族的**输入源盲区** | `node -e` 现取三个集合再取差集，命令见 ② 那张表（同一把尺两次跑出的数应当逐字相同） |

#### ④ 排队状态（本节不落任何结论，只记读数）

`/tmp/g130-arms.sh`（G-51 那条新用例的基线 + 三臂变异 + md5 复原对账）在等内存闸门，
17:29–17:30 期间锁的持有者从 `pid=37974` 换成 `pid=67378` —— **别人的套件是接力跑的**，
不是"上一把快完了"。1 分钟负载 15.7→17.5→14.6，`g131`（`verify:selfhost-stack` 全跑）
被我自己写成"必须等 g130 结束 + 负载 ≤12 + 闸门空"三个条件同时成立才起跑，
等满按环境无效收尾（`CAP=5400s`）。这两把的读数没拿到之前，
§8.107 的"这一档还没到界面已验"和 G-51 步骤④⑤都**不提前标闭合**。

### 8.109 一把变异 rig 被两个缺陷绊住，第二个差点让我把"别人的 node_modules 删了"（2026-10-04 17:3x）

G-51 那条新用例要拿"基线 + 三臂变异 + 复原对账"。第一版 rig（`/tmp/g130-arms.sh`）跑出
**基线绿、三臂全被挡**的读数，看着像"环境不配合"，实际是**我自己两条缺陷**，
而且第一条有跨树破坏性 —— 值得单独入档。

#### ① 🔴 在软链过 `node_modules` 的隔离 worktree 里用 `pnpm --dir e2e …` 起跑，会让 pnpm 想 **purge 别人那棵树的 node_modules**

基线日志（`/tmp/g130/00-baseline.log`）的原文：

```
[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY] Aborted removal of modules directory due to no TTY
If you are running pnpm in CI, set the CI environment variable to "true", or set "confirmModulesPurge" to "false".
[ERROR] Command failed with exit code 1: pnpm install
    at runDepsStatusCheck (…/pnpm 11.8.0/dist/pnpm.mjs:248210:7)
```

成因是本 worktree 的建法：`e2e/node_modules` 是**软链**，指向主检出那棵树
（17:3x 现量：`readlink e2e/node_modules` → `/Users/…/heyta/e2e/node_modules`，链建于 10-03 11:22）。
`pnpm exec` 跑前的 deps-status 检查因此判定"这个 modules 目录不属于当前这棵树"，
下一步就是**删掉重建**。这次它没删成，只因为**没有 TTY**、它自己中止了 —— 运气，不是保护。
🔴 如果照它给的提示去设 `CI=true` 或 `confirmModulesPurge=false`，被删的就是
**别人正在跑套件的 `e2e/node_modules`**（当时确实有人在跑：锁的持有者 17:2x–17:3x 依次是
`37974` → `67378` → `15242` → `35771`）。**那两个变量一个都不设。**

改法不是加锁，是**换起跑通道**：`cd e2e && npx playwright test -c playwright.landing.config.ts …`。
这条通道不是新造的 —— `scripts/verify-selfhost-stack.sh:546-548` 用的就是它
（先 `[ -d node_modules/@playwright/test ] || die`，再 `npx playwright test`），
所以它本来就验过软链可用。
⚠️ 代价要说清：`npx` **不经过** tfa-shield 那层 pnpm 包装，全局内存闸门不再自动拦并发。
所以 rig 自己承担同一条前置：起跑前查 `/tmp/tfa-test.lock`、锁在就等、锁没了还无条件再等 20s
（外层进程退出会删锁，"锁不在"不等于窗口真的开着）—— 协调性质不变，只是从工具层搬到脚本层。

#### ② 第二条缺陷更普通，也更贵：**起跑失败被我当成绿色基线**

v1 的 `run_spec()` 只要日志开头不是"闸门拒绝"就返回 0，于是那条 `RC=1` 的
purge 失败被记成"基线跑过了"，三臂照常施上去。
🔴 这正是本仓那条元规则的第三次现身（§7 的"**一条永远通过的判据比没有判据更糟**"）：
判据把"没报我认识的那个错"当成了"跑绿了"。
v2 改成：`run_spec` 透传 Playwright 自己的 RC，**基线 RC≠0 就整把停住、不落任何臂的读数**
（`exit 4`），并把红条标题打出来。这一条改动让 rig 从"能产出读数的装置"变成"能拒绝产出读数的装置"。

#### ③ 落地那一步**只能用 `--ff-only`**，理由是现量：主检出的索引里躺着别人的东西

载体由 `research/tools/selfhost-merge-carrier.mjs` 在隔离 worktree（`/tmp/heyta-merge-carrier`）
里用 `merge --no-commit --no-ff` + 一次正常 `git commit` 造出来，双亲断言为
`(mainSha, srcSha)`，再把 `feat/self-host-merge-main` 指过去。
那么"让 main 前进到载体"这最后一步，如果做成 **`git merge --no-ff feat/self-host-merge-main`**
（在主检出里合），git 会**新建一笔提交，而新提交的内容 = 整个索引**。
17:3x 现量主检出索引里有 **2 枚纯暂存条目**，都是别人那条线的取证文件：

```
A  apps/mobile/evidence/android-vault-revocation-20261004.txt
A  apps/mobile/evidence/ios-reminder-ax-companion-20261004.txt
```

（同一时刻：工作树脏 135 枚 + 未跟踪 24 枚，共 160 条 `git status` 行。）
⇒ 那两枚会被我的合并提交吞掉，而它们与本批毫无关系。这是 §7 那族
"`git commit` 提交的是整个索引"在**合并**这一动作上的形态，而合并比点名提交更没法 `--only`。
**唯一不造提交的推进是 fast-forward**：载体的第一父恰好是推进那一刻的 `main`，
所以 `git merge --ff-only feat/self-host-merge-main` 只做 ref + 工作树更新，不产生新对象。
守卫顺序（落地那一次严格按这个走，中间不许插别的动作）：

1. 重跑 `node research/tools/selfhost-merge-carrier.mjs`（它自带"main 在重算期间又前进 ⇒ 不落笔"的新鲜度守卫，退 4）；
2. 现查 `git rev-parse main` == 载体的 `HEAD^1`（不等就回到 1，不硬合）；
3. `git merge --ff-only feat/self-host-merge-main` —— **只有这一条**动 main；
4. 完整 `pnpm check` 的逐段归属读数**必须在 ff 之前**于载体上拿（ff 之后 main 就是载体，
   再跑一次只为确认"ff 没改变字节"）。

#### ④ 陷阱台账的三个副本，号差得很多

`docs/reference/environment-traps.md` 在三处的最大号（`grep -oE '^[0-9]+\. ' | sort -n | tail -1`）：

| 副本 | 最大号 |
|---|---|
| 本分支（`feat/self-host-distribution`）里的那份 | **177** |
| `main` 提交里的那份 | **228** |
| 主检出**工作树**里那份 | **261** |

⇒ 本节 ①② 那两条（软链 node_modules 的 purge 危险 / "没报我认识的错"当跑绿）**要入陷阱台账，
取号按落笔那天的主检出工作树现量**（17:3x = 261 ⇒ 至少 #262），不写进本分支那份，
也不按本分支的 177 编号 —— 那是同一族"按 HEAD 取号"的错。
另：`git diff --name-only main...HEAD -- docs/reference/environment-traps.md` **空**
⇒ 本批从没碰过这个文件，落地时它不会成为冲突面（这一条对 §8.16 的族枚举是有用的：
它不在 45 个改动文件里）。

#### ⑤ 阻塞集与排队状态（都是瞬时读数，引用要现取）

- 阻塞集 = **本批 45 个改动文件 ∩ 主检出脏集合**，17:3x 现量 **4 枚**：
  `.gitignore`、`package.json`、两份词条表。这个交集定义比"那 5 个重叠文件"更准，
  因为 `scripts/check-script-snapshot.mjs` 与 `docs/README.md` 已被他们提交掉了。
- 1 分钟负载 17:34 = **314**、17:35 = 313 —— 比 §8.107 记的 19.6 又高一个数量级。
  `g134`（rig v2）与 `g131`（`verify:selfhost-stack` 全跑）都在等：rig 等锁，
  `g131` 等 rig 结束 **且** 负载 ≤12 **且** 锁空；两条都是等满按环境无效收尾，不调阈值。
- `g74` 落地预检仍在轮询（上限 18:55 左右到点）。**它到点不等于窗口关**，
  也不等于我可以提前落地；到点后按 §8.16 重跑一轮预检再说。

### 8.110 一张"给人看的证据图"谎报了一个不存在的缺陷，而顺着它查下去撞到两条真的（2026-10-04 17:4x–18:0x）

这一节全部读数来自 `/tmp/g134/arms.txt`、`/tmp/g139/readings.txt`、`/tmp/g141-landing-suite2.log`、
`/tmp/g145/readings.txt`、`/tmp/g146-suite.log`，提交为 `7ddf36a9`（三条判据）、`8926be56`（`.lp-note` 修复 + 第 4 条）、
`4e805e53`（等稳定闸门抽成单一所有者）。

#### ① G-51 那条判据做到 4 条，三臂各有牙

| 趟 | 读数 |
|---|---|
| 基线（3 条） | `BASELINE rc=0 摘要=[3 passed ]` |
| ARM1 把中文那句安装承诺塞回去 | `rc=1 摘要=[2 failed 1 passed ]`，红的是「中文 Web 卡」+「整页仍有离线」两条 |
| ARM2 塞英文那句 | `rc=1 摘要=[1 failed 2 passed ]`，红「英文 Web 卡」 |
| ARM3 把正向锚点拿掉 | `rc=1 摘要=[1 failed 2 passed ]`，红「中文 Web 卡」 |
| 复原 | `RESTORED rc=0 摘要=[3 passed ]` + `MD5_SAME=yes`（两份词条表逐字节回到原样） |
| 加第 4 条之后 | `FIXED rc=0 摘要=[4 passed ]` → 全量 landing 套件 `22 passed`（`SUITE_RC=0 17:51:21`） |

⚠️ 三臂的施法顺序按 §8.109 那条教训改过：施臂 → 跑 → **无条件** restore → 重建，
且基线 `rc≠0` 就直接 `exit 4` 不落任何臂读数（第一版 rig 把一次 RC=1 的失败起跑当成了绿色基线）。

#### ② 看图撞见的第一个真缺陷：`.lp-note` 是 flex，把一句话排成三栏

`RichText`（`apps/landing/src/site/PageSections.tsx:77`）把一条词条按 `**粗体**` / `` `代码` ``
切成一串**兄弟节点**，而 `.lp-note` 原来是 `display:flex` + `gap` ⇒ `/platforms` 那条「未签名」
说明被排成三列，第二列以「，需要右键打开」起头（改前图 `/tmp/g138-before/platforms-page.png`，
md5 `1c6798b6…`）。⚠️ 图标 `⚠️` 住在**词条文本里**、不是子元素，所以这一条不是"缺图标才要 flex"。

修法 `display:block`（`landing.css:596`），判据第 4 条钉住，三段读数：

```
FIXED rc=0 摘要=[4 passed ]
APPLIED flex-back
ARM-FLEX rc=1 摘要=[1 failed 3 passed ] 红条=[1) …platforms-install-claim.spec.ts:112:1 › 页末说明是一段 flowing ]
RESTORED rc=0 摘要=[4 passed ]   MD5_SAME=yes
```

两处 `.lp-note` 规则块（`landing.css:596` 与 `:1689`）**各管不同属性**（后者只有 `max-inline-size`），
不是重复定义 —— 查过才敢改。`check:design` rc=0。

#### ③ 看图撞见的第二个问题不在产品里，在探针里 —— 而它差点让我去"修"一个不存在的缺陷

改后那张 fullPage 图里，页首「平台状态」H1 **整块不见了**，图顶留一条 180px 空白带。
先按 §7 第 83 条 ① 怀疑探针自己：把截图前的 `scrollIntoViewIfNeeded` 拿掉重跑
（`/tmp/g142-noscroll`，md5 从 `a505e3e8…` 变成 `954f91dd…` ⇒ 那一次滚动确实改了字节），
**空白仍在**。于是量几何（`/tmp/g143-geom.mjs`，自带阳性对照：同时量肉眼确定渲染着的「Web」H2）：

```
H1  text=平台状态  rect=[88,120,1104,56]  opacity=1  visibility=visible  color=rgb(15,23,42)
第一个 H2  rect=[64,395,1152,42]  （同一趟，它在图里是看得见的）
MASK-IMMEDIATE  {"innerTransform":"none","offset":0,"running":1}
MASK-AFTER-1500MS {"innerTransform":"none","offset":0,"running":0}
```

⇒ DOM 一切正常，标题**已经**落位；另拍一张视口图（`/tmp/g143-settled.png`）标题、引言、
主蓝按钮全在。所以缺的不是内容，是**截图取在显现动画中途**：页头走
`maskedRevealVariants`（`.lp-mask{overflow:hidden}` + 内层 `translateY→0`），
而 fullPage 把视口撑到整页高度会让 `whileInView` 重放。

🔴 **`screenshot({animations:'disabled'})` 单独不够**（这是我一开始的假设，实测否证）：
那个参数只完成 CSS 动画/过渡，遮罩那一下是 framer-motion 的 WAAPI transform。
加上它之后（`/tmp/g144-animdisabled`）lede 与主蓝按钮回来了，**H1 仍是空白**。

#### ④ 这个失效形态仓库里早就知道 —— 于是没有抄第二份，而是抽成单一所有者

`docs-centre.spec.ts:120` 已有一个 `waitHeadRevealed`，**16 处消费者**，注释里写着
"第一轮六张图里有四张是这样"。所以正确收尾不是在我的 spec 里再写一个等待，
而是把它抽成 `e2e/landing/head-reveal.ts` 做唯一事实源，两份消费者共用（`4e805e53`）。

零行为变化读数（抽取前后各跑一次整个 landing 套件）：

```
g141（抽取前）  22 passed  SUITE_RC=0 17:51:21
g146（抽取后）  22 passed  SUITE_RC=0 18:08:07
spec:line 标识集合大小  22 = 22
```

闸门有牙读数（`/tmp/g145/readings.txt`）：把等待的超时压到 1ms ⇒
`ARM1 rc=1 摘要=[3 passed ] 红条=[1) …:86:1 › 整页仍有「离线」这一档承诺…]`，
恰好红在带截图的那条；`MD5_SAME=yes`（spec 逐字节复原）。
最终那张图 `/tmp/g145/platforms-page.png`（md5 `4f36c0f3…`）**人已看过**：标题、引言、
六个平台区块、说明卡恢复成 flowing 文本、状态图例、页脚全在。

#### ⑤ 同族扫描：`capture.mjs` 用的是固定 600ms，而已入库的截图今天没中招

`scripts/screenshots/capture.mjs:206` 在截图前只 `waitForTimeout(600)`，而它确实截落地页
（`targets.mjs:138-141`：L02 `/features`、L03 `/platforms`、L04 `/pricing`、L05 `/help`）。
逐张人眼核对已入库的 `screenshots/landing/L03-平台.png`（1440×900）⇒ **标题在**，
600ms 那一趟够用。所以今天没有对外伤害，登记为 **G-57**：把那条固定等待换成
`waitHeadRevealed` 同一条规则（`e2e/landing/head-reveal.ts` 已是单一所有者，`scripts/` 要复用得先解决
它不在同一棵依赖树里），代价是重截七张图 —— 排在落地之后一起做，不单独起一趟。

#### ⑥ 顺着 L03 那张图撞见第二条：已入库截图里还印着摘掉的承诺和旧域名

同一张 `screenshots/landing/L03-平台.png` 的 Web 卡正文写的是
「**安装为 PWA 后可离线使用**，数据存在浏览器本地的 SQLite（OPFS）」，
验证方式一栏写的是 `https://heyta.finlaw.cloud/app/`。
前者正是 G-51 从词条里摘掉的那句（图是旧构建截的），后者是 2026-09-30 已迁走的域名。
引用面现量：只有 `docs/research/ui-aesthetic-and-design-system-coverage-audit.md` 与
`docs/plans/help-center-docs-expansion.md` 两份**内部**文档引用 `screenshots/` ⇒
这是**潜在**的对外错话，不是现行页面。登记为 **G-58**：落地 + 重发之后重跑
`pnpm screenshot:capture` 并把七张图一起换掉（换图前逐张看，别只跑 `screenshot:verify` 的空白判据 ——
它答的是"有没有内容"，不答"内容是不是当前这批"）。

#### ⑦ 我自己那条怀疑只否证了一半 —— 剩下的登记成 G-59，不写成"已清白"

sweep 残留 PWA 承诺时命中 `zh-CN.ts:3602` / `en.ts:3402`
（「这里没有「检查更新」按钮：应用是 PWA，更新由浏览器在后台决定」），
我按 §8.57 / `:61` 那条旧读数怀疑它也是错话。**代码与产物层已被否证**：
`apps/web/src/pwa/register.ts:43` 已是 `${import.meta.env.BASE_URL}sw.js`（注释明写"不能写死 `/sw.js`"），
产物 `apps/web/dist/manifest.webmanifest` 的 `start_url`/`scope` 是 `"."`、`icons[].src` 是
`icons/…` 相对路径 ⇒ 挂载路径变成构建参数之后这两处都跟着走了。

🔴 但这**不等于线上注册成功**：原来那个缺陷的形态是"线上 `/sw.js` 返回落地页 HTML"，
要否证它得量**部署态**（`/app/sw.js` 的 `content-type` 与 SW 注册结果），~~本趟没有取~~
⇒ **这句"没有取"是错的，2026-10-04 18:3x 撤回**：判据**早就存在**
（`e2e/live-site/live-domain.spec.ts:256`，它量 `sw.js` 的 content-type、`start_url`/`scope`/图标
解析路径、`serviceWorker.ready` 的 scope 与 scriptURL、注册失败的 warn 与未捕获异常），
18:35 那次整套运行里它是**绿的**；另有独立的 `curl` 复量补了一刀更硬的：线上那枚
`/app/sw.js` 与本地 `apps/web/dist/sw.js` **逐字节相同**（`cmp -s`）。
⇒ 那句 `updateNote` 从"疑似错话"改成"**待线上复验**"，登记为 **G-59**：
~~补一条 live-site 判据（`/app/sw.js` 返回 JS 而不是 HTML + 注册不报 `SecurityError`），
跑在落地之后 —— 与 G-51 剩下的 ④ 同一趟，不要各起一次。~~
⇒ **G-59 已关（§8.113）**：`web.about.updateNote` 那句不是错话。
⚠️ 但**这不等于"PWA 可安装已被证明"** —— 既有用例判的是"资产拿到真身 + SW 注册并激活"，
`beforeinstallprompt` 本机自动化通道答不了（§8.57），G-51 摘掉安装承诺那句的裁决不变。
📌 这条登记本身的教训：**宣布"欠某条证据"之前先按结论句 grep 判据本体**（该搜的是
`serviceWorker.ready`，不是搜 "G-59"）—— 我上一轮就是没读同目录那份 spec 才立了一条已存在的判据。

⚠️ 同时把两处**过期状态句**原地更正（不删，划线留原句旁）：`:61` 那句
"PWA 的 `/sw.js` 与 manifest 里 `start_url/scope/icons` 全是根绝对路径…登记至今**未修**"，
以及 `:6384`（§8.107）那句"Web 端到今天也没有可安装的 PWA"。
后者只在**代码/产物层**被推翻，"因此就可安装"没有证，所以 **G-51 摘掉那句的裁决不变**。

#### ⑧ 落地与第 2 项的排队读数（截至 18:07）

- 阻塞集**从 5 枚变 4 枚**（`docs/README.md`、`scripts/check-script-snapshot.mjs` 已被他们提交）：
  现在是 `.gitignore` / `package.json` / `packages/i18n/src/locales/zh-CN.ts` / `en.ts`，
  写集 46 枚、脏条目 166 枚、夹具 `5/5 条通过`。
- 🔴 **载体已过期**：`main = 1cda2053`，而 `/tmp/heyta-merge-carrier` 那笔合并的第一父是 `4235319d`
  ⇒ 落地时必须重算载体（新鲜度守卫会退 4），不能拿现成的 `ed0a837b` 去 `--ff-only`。
- `g131`（等负载 ≤12 + 闸门空再跑 `pnpm verify:selfhost-stack`）仍在等，18:02–18:05 三次读到
  负载 `277.31 / 208.24 / 94.45`（别人的重活在跑）。CAP 5400s 约 19:0x 到点；
  到点按"环境无效≠产品失败"记，不因此改判据、也不代跑凑绿。

### 8.111 载体在 `main(cae62c6b)` 上重算**零冲突**、8 道门禁全绿 —— 于是把"阻塞集"这个词的两层含义分开钉住（2026-10-04 18:1x）

`node research/tools/selfhost-merge-carrier.mjs` 一条命令的完整读数（`/tmp/heyta-merge-carrier`）：

```
✅ 载体 7d556d97 = main(cae62c6b) × feat/self-host-distribution(7ce0d2b4)，分支 feat/self-host-merge-main 已指过去
   并集 scripts 键 146 个 · check 链段 main=76 本批=67 base=66 并集=77（摘段 0/0）
   · 非 scripts 顶层字段比了 9 个，两侧改动全落进磁盘对象（丢 0）
   门禁 8 道全 exit 0；完整 pnpm check 留给落地那一刻
```

#### ① 20 分钟里 main 前进了两次，而"载体过期"这件事的量法变了

18:07 读到的是 `main = 1cda2053`（载体第一父还是 `4235319d` ⇒ 过期），18:1x 已经是 `cae62c6b`。
⇒ 落地这一步**不可能**"先算好载体再等窗口"，只能贴着 `--ff-only` 现算现落。
这条不是新认识，但它把 §8.109 ③ 那四步的时间窗从"小时级"压到"分钟级"，
所以完整 `pnpm check` 那一步**不能提前跑** —— 跑在旧载体上等于没跑（AGENTS §7 第 27/82 条那个失效形态）。

#### ② 🔴 现量把"阻塞集"拆成两层，之前混着一层说

| 层 | 问的是什么 | 现量 | 谁能解 |
|---|---|---|---|
| **A 提交态冲突** | 两棵**已提交**的树合并时会不会撞 | ~~零冲突~~ 🔴 **这句作为当前陈述活了不到一小时**：19:1x §8.119 ① 量到 6 条，10-04 20:3x §8.124 ① 仍是 6 条且 `other=0` | 已经没有了 —— 但**每次落地前必须重取** |
| **B 工作树未提交** | 主检出里别人**还没提交**的改动正压在我也改过的文件上 | **4 枚**：`.gitignore` / `package.json` / `packages/i18n/src/locales/zh-CN.ts` / `en.ts`（`selfhost-landing-blockers.mjs`：写集 46 · 脏条目 166 · 夹具 5/5） | 只能等他们提交 |

之前几处把 B 写成"落地解法：未预置 ⇒ 交人判"，读起来像 A 里还有一件没人预置的冲突。
**不是**：~~A 已经空了~~（见上一行那条更正 —— A 的真实形状是"每次重取，只要还在八族内就不需要新增解法"）；B 是"我现在 `--ff-only` 会把他们未提交的工作树搅成混合态"这一件事，
而载体脚本对 B **本来就不该有解法**（它只读 `origin`/本地 ref 的提交，不碰工作树）。
⇒ 关闭判据不变（等 B 归零），但**理由要说准**：不是"怕冲突"，是"不踩别人未提交的东西"。

#### ③ 这一趟没有做的两件事，写清楚免得下一个人以为做了

1. **完整 `pnpm check` 没跑**（负载 90–300，别的会话在跑重活；跑在旧载体上无意义，跑在新载体上会挤掉 `g131` 等的那个窗口）。
2. **`main` 没有前进**：`feat/self-host-merge-main` 指向 `7d556d97` 只是载体分支，`main` 仍在 `cae62c6b`。
   不 `git branch -f main`、不 push —— 落地那一步仍然只能 `git merge --ff-only`，且要在 B 归零之后现算。

### 8.112 把落地那一步从"靠人记四条禁令 + 三条前置"变成一条带四臂读数的体检命令（2026-10-04 18:2x）

新增 `research/tools/selfhost-land-main.mjs`（与本节同一笔提交）。它不新增任何权限，
只是把 §8.109 ③ 那四步和四条禁令变成**一次跑完的闸门体检**：默认 dry-run，
`--confirm` 才动，而且 `--confirm` **只能在主检出里跑**（脚本自己不跨工作树）。

#### ① 四臂读数（全部就地跑过，非推断）

| 臂 | 命令 | 期望 | 现量 |
|---|---|---|---|
| ARM1 | `--confirm`（在分支检出里） | 拒动，退 2 | `🔴 落地动作 —— --confirm 只能在主检出里跑` + 打出该在主检出跑的那一行，`RC=2` |
| ARM2 | `--carrier $(git rev-parse HEAD)`（非合并提交） | 双亲闸门红 | `f2fb6bf2 不是双亲齐全的合并提交（^1=7ce0d2b4 ^2=无）`，`RC=1` |
| ARM3 | `--carrier 7d556d97`（**八分钟前**造的载体，第一父 `cae62c6b`；main 已是 `91765ef0`） | 过期载体被拦 | `第一父 cae62c6b ≠ main 91765ef0 ⇒ 载体过期，落地会装一笔旧合并`，`RC=1` |
| ARM4 | 裸跑（重算载体） | 双亲 ✅（阳性对照）+ 前置红 | `✅ 载体 cca4c0a6 = 91765ef0 × f2fb6bf2`、`🔴 阻塞集 4 枚未清空`、`🔴 负载 69.32 > 12`、`⏭️ 完整 check 没跑`、`RC=1` |

🔴 **ARM3 是这节最值钱的一条**：它拦下的不是构造的假对象，而是**我自己八分钟前算的那枚载体** ——
`main` 在 18:07→18:2x 之间又前进了两次（`cae62c6b → 91765ef0`）。
§8.111 ① 说"落地只能贴着 `--ff-only` 现算现落"，这条臂把那句话变成了一个会自己拦我的装置。

#### ② 第一版有两个缺陷，都是它自己的判据抓出来的（记下来免得只留"做完了"）

1. **静默退 2**。`for (const line of execFileSync(...) + '\n')` 少了一次 `.split('\n')` ⇒
    iterating 的是**字符**，`trees` 恒空 ⇒ 走到"没找到工作树"分支，而那一支当时只 `process.exit(2)`
   不打字。症状是"命令什么都没说就退了"。⇒ 现在这条分支把 worktree 清单打出来再退。
   📌 一般规律：**拒绝也要有读数** —— 一个不打字的 exit 和一个正确的 exit 在终端上长得一样。
2. **前置已红却还会去跑完整 `pnpm check`**。收集器的第一版是"每条闸门都跑完再汇总退出"，
   而其中一条是几十分钟的重活 ⇒ 在负载 300 的机器上，一次本来就该被阻塞集挡下的体检
   会把整台机器的窗口占掉。⇒ 现在 check 闸门在 `fails.length>0` 时**响亮地跳过**
   （`⏭️ …跳过不等于通过`），且 `checkOk` 仍为 false，`--confirm` 走到最后也会被"没跑过 check"挡住。
   📌 这条是 §7 第 81 条那一族的反面：**静默跳过**是"装饰性判据"，而**昂贵的漏跑**是"放行"——
   两种都要用一行读数区分开。

#### ③ 落地这一步现在还剩什么（不缩小，也不提前宣布）

- 阻塞集 4 枚（`.gitignore` / `package.json` / `zh-CN.ts` / `en.ts`）等其所有者提交 —— 见 §8.111 ② 的两层拆分。
- 归零之后：在主检出里 `node research/tools/selfhost-land-main.mjs --confirm`，
  它会现算载体、校双亲、跑完整 `pnpm check`（红则退 4 并给出逐段归属命令，**不落地**），
  全过才 `git merge --ff-only`。不 push、不 `branch -f main`。
- `check:gate-wiring` rc=0（新脚本不是门禁，接线检查确认没破它）。

### 8.113 G-59 的"未取证"是**我没读同目录那份 spec**（2026-10-04 18:3x，含一次自我删除）

#### ① 触发：一句我自己写的"本趟没有取"

§8.110 ⑦ 把 `web.about.updateNote` 那句「应用是 PWA，更新由浏览器在后台决定」从"疑似错话"
降级成"待线上复验"，登记为 G-59，理由写的是"要否证它得量**部署态**，本趟没有取"。
这一轮先按那句去量部署态。

#### ② 零 CPU 的那一半（curl，绕本机代理 fake-ip）

```
/app/                    200 text/html                  1361 B
/app/sw.js               200 application/javascript    16381 B  md5 d0252fcbdefedaec4edb6cf6222cd65e
/app/manifest.webmanifest 200 application/octet-stream   2361 B
/sw.js                   200 text/html                  7022 B   ← 落地页，路由事实不是回归
/health                  200 {"status":"ok","db":"connected","wsConnections":0}
```

🔴 **关键的一条不是状态码，是字节**：线上那枚 `sw.js` 与本地 `apps/web/dist/sw.js`
`cmp -s` **逐字节相同**（同一个 md5）。也就是说"部署态与产物态不一致"这个旧缺陷的
**机制**今天在线上不存在 —— 旧缺陷的形态恰恰是"产物是对的、路由让它落回落地页"，
所以只看产物会得出假清白，只看状态码（200）也会（落地页也是 200）。

#### ③ 真浏览器的那一半，以及它查出来的**我自己的第二个错**

写了 `e2e/live-site/live-pwa.spec.ts`（3 条腿：挂载路径下 sw.js 是 JS + 根路径 `/sw.js`
仍是 HTML 做对照；页面里注册成功、scope `/app/`、SW 能**激活**、加载期零 error，
外加一发**非法 scope 的有牙臂**；manifest 能 `JSON.parse`）。跑出来：

- 真实臂 3 passed：`{"real":{"ok":true,"scope":"…/app/","active":false,…}}`
  （`active:false` 是注册那一刻的读数，后面的激活等待单独判了 `true`）、加载期控制台 `(无)`；
- 变异臂 `HEYTA_LIVE_APP_BASE=/` ⇒ **3 failed**，三条各自精确报红
  （①「`/sw.js` 的**实体**不是 HTML」②「SW 注册应成功」③`SyntaxError: Unexpected token '<'`）。

🔴 然后才读到：**同一目录的 `live-domain.spec.ts:256` 早就在判同一件事**，而且判得更严 ——
`start_url`/`scope`/`icons[0].src` 必须解析成 `/app/…`、`sw.js` 的 content-type 必须匹配
`javascript`、`navigator.serviceWorker.ready` 20s 内不许 timeout、scope 与 scriptURL 都要含
`/app/`、注册失败的 warn 文案 = `[]`、未捕获异常 = `[]`。它在 18:35 那次整套运行里是**绿的**
（`26 passed (1.1m)`，含 live-domain 7 条 / live-legal 13 条 / live-signin-entry 3 条 / 我那条 3 条）。

⇒ **G-59 那句"未取证"不成立**，而且成因不是"证据不存在"，是**我没读同目录那份 spec 就宣布了缺口**。
这跟本文档 §8.57 那条"只在 `apps/web` 里搜就会把服务端渲染的流程误判成没做"是同一族的第二种面目：
上一次是搜错了目录，这一次是**没搜就登记**。
📌 一般规律：**登记"欠某条证据"之前，先按结论句去 grep 一遍判据本体**（这次该搜的是
`serviceWorker.ready` 与 `content-type`，不是搜 "G-59"）。

⇒ 新写的那份**已删除**（`e2e/live-site/live-pwa.spec.ts`，未提交、本会话产物）。
理由：同一结论落进两份文件就是下一轮漂移的来源（本批已有 G-49 那条"第 4 份抄件"的教训）。
它的三条读数留在上面这三段里，作为**这一趟**的证据；长期载体仍是那两条既有用例：

| 载体 | 判据住在哪 | 本批状态 |
|---|---|---|
| 线上（nginx + 已发布产物） | `e2e/live-site/live-domain.spec.ts:256` | ✅ 18:35 绿（26 passed 里的一条） |
| 自托管（镜像内 fastify 托管 `/app/`） | `e2e/selfhost-stack/selfhost-web.spec.ts` 的 S1 | 🔄 等负载窗口，就是第 2 项那条 `verify:selfhost-stack` |

⇒ **G-59 关闭**：`web.about.updateNote` 那句**不是错话**（部署态已由既有用例 + 独立 curl 两侧量到）。
⚠️ 但**别读成"PWA 可安装已被证明"** —— 两条用例判的是"资产拿到真身 + SW 注册并激活"，
`beforeinstallprompt` 这台机器的自动化通道答不了（§8.57），G-51 摘掉那句安装承诺的裁决**不变**。

#### ④ 顺带查出来的两条，一条入档一条只是读数

- **G-60（新登记 → ✅ 已关，见 §8.132，2026-10-04 21:5x：生产 nginx 已补类型 + `live-site/live-manifest.spec.ts` 三条判据 + 旧域名红臂）**：`/app/manifest.webmanifest` 线上回 **`application/octet-stream`**
  （nginx 的 `mime.types` 里没有 `.webmanifest`）。~~两处既有用例都**只把这个值放进 probe 里记录、
  没有一条 expect**~~ ⇒ 🔴 **这半句在写下的一小时内被我自己否证**：自托管载体那一侧
  **早就有一条断言** —— `e2e/selfhost-stack/selfhost-web.spec.ts:220`
  `expect(manifest.headers()['content-type']).toContain('application/manifest+json')`
  （它今天没跑过，因为浏览器那三条判据还等负载窗口，见第 2 项）。
  ⇒ **G-60 的范围因此缩成一侧**：**只有线上（nginx）那一侧是"有读数、无判据"**。
  而且自托管那一侧的期望值这次有了**代码层依据**（不是猜的）：镜像锁里
  `node_modules/mime 3.0.0`（**prod**）+ `@fastify/send@4.1.1` 的 `lib/send.js:508`
  写的是 `mime.getType(path) || mime.default_type`，而 `mime@3.0.0/types/standard.js` 里
  **有** `"application/manifest+json":["webmanifest"]` 那一条。
  ⚠️ 顺带记一次我自己的探针形状错：`new (require('mime/Mime.js'))()` 直接实例化那个类
  会拿到**空表**（`getType` 回 `null`），差点被我读成"mime@3 不认识 webmanifest"。
  表在 `types/standard.js`，而装配好的实例是 `index.js` 的默认导出 —— **判"某个库认不认识 X"
  要读它导出的那个实例，不是它内部的类**。
  要关它只剩一件事：给发布主机的 nginx 补 `mime.types` 那一行，**或**明确接受并写明理由。
  ⚠️ 别把这条读成"自托管那边也等着复验" —— 那边是**已有断言、还没跑**，跑的结果无论绿红都归第 2 项那趟。
- 一条**观察不是缺陷**：全新上下文（Chromium 报 `en-US`）直开 `/app/` 渲染的是整套英文界面 +
  英文同意弹窗（截图 `e2e/test-results/live-pwa-app.png`，人已看：Inbox/Today/四象限/清单/标签
  全在，主蓝按钮 `Agree and connect`）。这是语言解析链第三层（`navigator.language`）的设计行为。
  ⚠️ 我这一轮踩的坑恰好是它记过的：`live-domain.spec.ts:264` 那段注释明写"这条用例必须钉
  `locale: 'zh-CN'`，否则红在那句等中文输入框上，而站点没坏"—— 我第一版抄了它的中文判据、
  没抄它的 locale，于是红了一次（红在探针取值方式，不是产品）。**同目录那份 spec 的注释里
  有我需要的答案**，这是本条第二次的现量。

#### ⑤ 这一轮的两条边界（写清楚，免得被读成"跑过了"）

1. 18:36 起 `~/.tfa-shield` 内存闸门以 `pid=43044`（别人的 `pnpm --dir e2e run test:landing`）
   **拒绝启动**我的 playwright。我**没有**用 `TFA_ALLOW_CONCURRENT_TEST=1` 绕它；
   所以 ②③ 的读数全部来自 18:30–18:35 那段闸门放行的窗口，之后没再补跑。
2. 负载全程 18–325，`verify:selfhost-stack` 仍未起跑（看守 `g131-wait.sh` 在等 ≤12），
   落地那一步的阻塞集仍是 4 枚（看守 `g149-blockers.sh` 在等归零）。**第 1、2、8 项本段没有推进**。

### 8.114 G-57 落地：截图前的固定 600 ms 换成"等揭示落位"，并把判据抽成**两个语言共用的一份**（2026-10-04 18:4x）

§8.110 登记 G-57 时只写了"capture.mjs 截图前用固定 600ms"。这一轮补上它**为什么是缺陷**
—— 不是"不够优雅"，是它违反了那个文件自己头部写下的设计约束第 1 条：

> **等文案，不等时间。** 固定 `sleep` 在快机器上浪费、在慢机器上截到半成品。

而落地页页头走的正是 §8.110 那套 `.lp-mask` + `translateY(112%)→0%` 错峰揭示，
600 ms 就是"慢机器上截到半成品"的那个半成品 —— 已入库的 `screenshots/landing/*.png`
（G-58）与这条固定等待是**同一个缺陷的两面**：一面产出坏图，一面是坏图为什么还会被产出。

#### 改的形状（三处，一个所有者）

| 文件 | 动作 |
|---|---|
| `scripts/screenshots/head-reveal.mjs` | **新增，判据本体**：`headRevealed()`（页面上下文里跑的纯函数）+ `waitHeadRevealed(page)`（等不到就超时抛）+ `settleForShot(page)`（**按这一页有没有 `.lp-h1` 分叉**） |
| `scripts/screenshots/capture.mjs` | `waitForTimeout(600)` → `await settleForShot(page)`，并把走的那一支（`revealed` / `fallback`）**打进每张图的读数行** |
| `e2e/landing/head-reveal.ts` | 判据本体删掉，只剩**类型壳** + 一层委托 |

🔴 **为什么必须抽成 `.mjs` 而不是各自留一份**：这条判据有**两个消费者，且不在同一个语言里** ——
`e2e/landing/*.spec.ts` 由 Playwright 跑（TS），`scripts/screenshots/capture.mjs` 由纯 Node 跑。
§8.110 那次抽取只把 e2e 内部那 16 处消费者收拢了，**Node 那一侧当时没算进去**；
不抽到 `.mjs`，这次修 G-57 就是**亲手造出第二份抄件**（正是 G-49 那条"第 4 份抄件"教训的形状）。
`.mjs` 是两边都能原生加载的最大交集：e2e 那份 `package.json` 是 `"type": "module"`，
Playwright 用 esbuild 转 `.ts`、`.mjs` 原样交给 Node。

⚠️ **应用视图那批仍走那 600 ms**（`settleForShot` 的 `fallback` 支）。这不是保守：
那些页面没有可等的揭示，把它们接进新判据 = 让每张应用截图都等一个**永远不成立**的条件，
30 s × 11 张之后红在一片"探针问题"上。分叉的判据是"这一页有没有 `.lp-h1`"，
而它本身就是那条承诺的适用范围。

#### 这一轮量到的 / 没量到的（分开写）

已量（全部零浏览器、零 docker）：

```
node --check scripts/screenshots/head-reveal.mjs   → OK
node --check scripts/screenshots/capture.mjs      → OK
pnpm screenshot:list                               → RC=0 （capture.mjs 的新导入链在 Node 侧成立）
同深度 .mjs 导入 '../../scripts/screenshots/head-reveal.mjs' → RESOLVED typeof= function
```

🔴 **没量的一条要说死**：`pnpm screenshot:capture` **没跑**（要浏览器 + 要本机起站，
而负载 167–325、`~/.tfa-shield` 内存闸门此刻被别人 `pid=43044` 的 `test:landing` 持有），
所以"新等待真的产出带标题的图"这句仍是**待验证**，它随 G-58 那趟一起做（落地 + 重发之后重截）。
e2e 那一侧同理：Playwright 的 loader 能不能解析这条跨目录 `.mjs` 导入，**本趟没跑**
（同一条 shield 闸门挡着，而正有人在跑那套套件，不该去抢）。
兜底在链上：`check:landing-e2e` 是 `pnpm check` 的一环，落地前那次完整 check 会把它跑到 ——
**解析不了就是响亮地红，不是静默放行**。

⇒ G-57 的状态从"未关（判据缺失）"改成"**代码已落、判据分叉有读数、复跑等 G-58 那趟**"。

### 8.115 G-55 的三个数今天全部重取（2026-10-04 18:4x）—— 公开树仍建不出镜像，但"要推几笔"从 97 掉到 26

G-55 的登记（§8.64）里那三个数当时是 `origin/main = 95ac4662`、本地 main 领先 **116 笔**；
16:1x 重取是 **97 笔**。这一轮按同一条命令再取，**两个数都变了**：

```
origin/main = 9070e18d          （16:1x 时是 8a254bcd ⇒ 有人 push 过）
main        = 5de78a14
git rev-list --count origin/main..main = 26
git show origin/main:server/Dockerfile  | grep -cE '^\s*RUN.*npm pkg delete' = 0
git show feat/self-host-distribution:server/Dockerfile | 同式 = 1
origin/main 的 server/package.json devDependencies 里 @heyta/* 工作区包 = 3
```

🔴 **结论没变，代价变了**：外人 clone 到的那棵公开树**今天仍然建不出镜像** ——
它带着三枚只存在于本机 pnpm 工作区的 devDependencies，而带 `npm pkg delete devDependencies`
那一修的那一行**还没进公开树**（判据锚定 `^\s*RUN`，不锚这个的话分支上会数出 2：
第 286 行是注释、297 行才是 `RUN`）。
但"口径 A（push）"的代价从"一次推 116 笔别人的提交"变成 **26 笔**，
而"口径 C（把指南那句改成实话）"的落点（两份 i18n 表 + 落地页重发）**这轮没重新量**，
它仍挂在阻塞集里。⇒ **要人拍板的这条，数字必须以这一趟为准**，
引用 §8.64 那句"116 笔"就是拿一个会过期的数去做不可逆判断。

⚠️ 这一轮**没有**动任何对外动作：没 push、没发布镜像、没改指南措辞。
`origin/main` 这次前进是别人推的，不是我 —— 我全程只读。

### 8.116 外人**今天**从公开树读到的那份指南，它自己的对账门禁判它绿（2026-10-04 18:4x）

§8.115 量了"公开树建不出镜像"（G-55）。那一格只回答"能不能跑起来"，
没回答另一件更要外人的事：**外人照着敲的那条命令，在公开树上是不是自相矛盾的**。
这一条今天量了 —— 用一次性 detached 检出把**公开那棵树**（`origin/main = 9070e18d`）
拉下来，跑**它自己带的那份门禁**（`scripts/check-selfhost-entry-command.mjs` 在公开树上存在）：

```
GATE_RC=0
✅ 扫描集 7 份 + 故意排除 1 份，命中 9 条入口命令，逐行过 R1–R6，R7 把验收载体也钉在同一套文件上
   · docs/runbooks/self-host.md 3 条 / server/README.md 1 条 / 两份 i18n 词条表各 1 条
   · server/env.example 0 条 / docker-compose.migrate-once.yml 0 条
   · docs/runbooks/local-server-verification.md 3 条（内部验收手册）
   · R7：verify-selfhost-stack.sh 的 -f 集合 = 对外主命令同一套文件
   · 审计报告**故意排除** 1 条（它引的是出事当时的旧命令）
```

⇒ **对外文案这一面今天没有第二种错话**：公开树上那 9 条入口命令抄件互相一致，
也与验收载体用的 `-f` 集合一致。外人从公开树失败的原因**只有一个**，就是 §8.115/G-55 那条
（`RUN … npm pkg delete` 没进公开树，而它的 `server/package.json` devDeps 里躺着三枚工作区包）。
这值得写下来，因为它把"要不要再改指南措辞"这件事从待办里**量掉了** —— 口径 C 的
"把指南那句改成实话"这半句，今天没有对应的现行失真句子可改（要改的是**能不能建**，不是**怎么说**）。

⚠️ **两条边界，别把这一趟读多**：
1. 这条门禁判的是**抄件之间一致**，不判"照着敲能不能成功" —— 后者恰恰是 G-55 那条，
   两个命题独立成立，一次绿不能顶掉另一次红。
2. 我在这棵只读树上想顺手再证一次"它有牙"，**变异臂没打上就退了**：
   脚本里那句 `-f docker-compose.build.yml` 的**字面形状**在 zh 词条里不是我猜的那样
   （`assert` 当场 `NOHIT`），所以那次 `MUT_RC=0` 的含义是"**变异没发生**"，
   **不是**"门禁放过了一条坏命令"。它的有牙读数仍以 §8.18 那九臂为准（在**本批**载体上做的）。
   检出跑完即 `git worktree remove`，工作树 `git status` 0 行 —— 全程没动过公开树、没动过主检出。

### 8.117 那把等窗口的看守器**只在窗口真开的那一刻才崩**：`$L、` 把全角顿号吃进变量名（2026-10-04 19:0x）

#### ① 现量：`G131_DONE rc=1`，而日志最后一行是脚本自己的崩溃

```
18:43:05 负载 19.61 > 12 ⇒ 环境无效，不调阈值、不等满就退
/tmp/g131-wait.sh: line 29: L？: unbound variable
G131_DONE rc=1
```

第 29 行是 **成功路径**上那句 `echo "… 起跑：负载 $L、闸门空…"` ——
`$L` 后面紧跟全角顿号 `、`，bash 把它吃进变量名，`set -u` 当场 `unbound variable`。
🔴 **这条路的形状是"只在窗口真的开了时才死"**：负载高的那几十轮走的是另一行
（那句里的 `$L` 后面是空格，正常），所以看守器跑了 50 分钟、报了 30 次"环境无效"，
**看起来完全健康**，而它其实永远不可能起跑。18:43 那次 19.61 之后窗口正在收敛，
它死在了起跑前一句 —— 一个窗口就这么丢了。

这正是 `docs/reference/environment-traps.md` 里已经入档的那一族（`$VAR` 后跟全角字符），
而且**仓库里有一道专管它的门禁**：`check:shell-unicode`（`scripts/check-shell-unicode-vars.mjs`，
在 `pnpm check` 链里，今天扫 70 枚 `.sh` 全绿）。

⇒ **缺的不是判据，是覆盖面**：一次性等待器写在 `/tmp`，仓库那道门禁物理上扫不到它。
所以"这类坑已经被门禁管住了"这句对**提交物**成立、对**我这轮的临时装置**不成立。

#### ② 我顺手又踩了一次"传实参被静默丢弃"

想用那道门禁直接判 `/tmp` 下我的等待器，跑的是
`node scripts/check-shell-unicode-vars.mjs /tmp` ⇒ 它回了一句
"✅ …（扫了 70 个 .sh）"。**那 70 枚是仓库自己的**：脚本的 `ROOT` 是
`path.resolve(dirname(自己), '..')` **自锚**，`process.argv` 只用来判断"是不是主模块"，
**根本不读路径参数** ⇒ 我那次传参被静默丢弃，读数量的还是同一棵树。
📌 这就是记忆里那条"零参自锚函数传实参会被静默丢弃 ⇒ '两边相等'可能是量了同一棵树两次"的
**同族第二面**：这次不是"两边相等"，是"**我以为我换了被测对象**"。
真做这次扫描用的是我自己那段 node 谓词（`$[A-Za-z_]\w*` 紧跟 `[\u3000-\u303f\uff00-\uffef\u300a-\u3011]`），
它精确点出 `g131-wait.sh:29` 那一行，并且量到 **本批改过的 2 枚 `.sh` 命中 0 处**、
`g149-blockers.sh` 命中 0 处 —— 所以那把还在跑的阻塞集看守器不受这个坑影响。

#### ③ 窗口现在真的开着，第 2 项已手动起跑

19:00:5x 现量：`loadavg` 1 分钟位 **7.43 / 8.54**、`/tmp/tfa-test.lock` 空、
`docker info` 29.4.0、`:1900` 无监听。⇒ 不等重写的看守器，直接起跑：

```
19:01  nohup pnpm verify:selfhost-stack > /tmp/g157-verify.log
       ==> 打镜像（supersync:selfhost-verify，VCS_REF=37639f11 …）
```

`VCS_REF` 就是当前分支头 ⇒ 这一趟的读数**属于当前产物**（元规则 3）。
19:04 已过镜像构建与入口命令对账（7 份扫描集 / R7 载体 `-f` 集合一致），正在起栈。
🔴 本条只记"起跑与前置读数"，**不预支结论** —— 三条真浏览器判据（S1 应用+SW scope、
S2 注册登录、S3 全新设备读回）要等日志里的 `STACK_RC=`，图要人打开看过才算。
（结果与逐腿读数在 §8.118：`STACK_RC=0`，三条 3 passed，四张图逐张看过。）

### 8.118 第 4 趟全跑 `STACK_RC=0`，四张图**人打开逐张看过** —— goal 第 2 项按五栏对账结案（2026-10-04 19:0x）

#### ① 这一趟的每一条腿都开了口（日志 `/tmp/g157-verify.log`，53 行，逐行核过）

| 腿 | 读数 | 行 |
|---|---|---|
| 打镜像 | `supersync:selfhost-verify`，`VCS_REF=37639f11`，且脚本自己判 **被验镜像的 revision == 当前 HEAD** | 2–4 |
| 工作树 | 未提交条目 **0** ⇒ 被验的是**提交物**，不是我这棵树的瞬时状态 | 5 |
| 产物自洽（在**被验镜像里**跑） | 挂载 `/app/` 与产物声明一致；`index.html` 的 5 个本地引用、manifest 的 15 个文件全在；4 个组件数据 URL 都落在 SW 前缀 `/app/widgets/` 内；246 个 `--ht-*` 定义对得上产物里全部无兜底引用 | 6–8 |
| 许可证（真镜像树载体） | `145 = 126 + 16 + 3`，无解释 0 · 非宽松 0 · **声明对不上 0** · 失效登记 0；两个独立载体对上（磁盘枚举 145 ⊆ npm 自写 lock 非 dev 158，差 13 条且**全是 optional**） | 12–15 |
| 平台变体（G-53 那一族） | 提交物锁里 **14 枚**平台受限条目逐条过同一套许可证权威，全部合格；其中 13 枚不在本次载体的树上 | 16 |
| 服务图 | 默认 3 个（**未动**）· 带 override 4 个（+`supersync-migrate`） | 18 |
| 入口命令抄件 | 扫描集 7 份 + 故意排除 1 份（本审计文档，理由印在输出里），命中 9 条，逐行过 R1–R6，**R7 把验收载体也钉在同一套 `-f` 文件上** | 19–20 |
| D-3（迁移） | 一次性容器 `exited(0)` · 应用侧 `RUN_MIGRATIONS_ON_STARTUP=false` · 带外恢复 flag=true（与文档那条入口同一支）· **已应用 42/42** · 悬挂 0 · 重复完成 0 · 回滚痕迹 5 条（设计内） | 32 |
| 服务端自己说的话 | `[INFO] [web-app] 共享 UI 挂在 /app/（来自 /app/web-dist）` | 33 |
| 真浏览器三条 | `3 passed (8.7s)`：S1 应用 + SW scope、S2 本机实例注册登录、S3 建一条任务 → **全新设备只能从服务端读到它** | 34–42 |
| 截图新鲜度 | `FRESH=4/4`，四张 mtime 全晚于起跑时刻 19:05:04 | 44–50 |
| 收尾 | `==> 拆栈` → `✅ 自托管整套：三条判据全过` → `STACK_RC=0 19:05:13` | 51–53 |

#### ② 四张图我逐张打开了（§6.2 规定一第 4 条），每张**只**回答它自己那一问

- `s1-app-loaded.png`：`/app/` 打开就是**应用本体**（收集箱 + 侧栏四象限 + 清单/标签 + AI 工具调用/对话助手），顶栏是「**未同步**」—— 这一栏恰好是**对**的：S1 还没登录，如果它显示"已同步"反倒说明状态没分清。不是错误屏、不是落地页。
- `s2-signed-in.png`：头像菜单里印着 `selfhost-1904796-1@example.test`，顶栏变「**已同步**」。这证的是"账号签在了**这台实例自己那台服务器**上"（邮箱是这一趟现造的），不是签在我们家生产上。
- `s3-device-a-synced.png`：任务 `selfhost-task-1904796-2` 在收集箱里，收集箱徽标 1、四象限「不重要不紧急」徽标 1。
- `s3-device-b-recovered.png`：**同一个标题的任务出现在一台全新设备上**（新 context、空 IndexedDB），徽标同样是 1 —— 这一张才是"服务端是通道、客户端能从它重建状态"的画面证据。
- 🔴 这四张**没有**证明的：界面好不好用、暗色主题、移动端。它们只证明"外人一条 compose 起的那套东西，浏览器打开就能注册、能写、能在新设备读回来"。别把它们读成界面验收。

#### ③ goal 第 2 项的五栏（缺任何一栏都不叫结案）

| 栏 | 证据 |
|---|---|
| 设计 | 挂载路径是构建参数（§8.1 那一族）+ 一次性迁移 override 不动默认服务图（D-3） |
| 生产接线 | 服务端日志真印「共享 UI 挂在 /app/」+ `WEB_ARTIFACT_IN_IMAGE=OK`（在**被验镜像内**跑的那条腿，不是宿主机上仿的） |
| 失败与恢复 | `RUN_MIGRATIONS_ON_STARTUP=false` 被对账成"带外恢复 flag=true 且与文档那条入口同一支"；42/42、悬挂 0、重复完成 0；S3 那一条本身就是恢复路径（新设备只能从服务端读） |
| 平台验收 | 真浏览器 3/3 + 四张新鲜截图 + 人看过 |
| 当前产物 | `VCS_REF=37639f11` == 分支头，且工作树未提交条目 0 ⇒ 元规则 3 这一栏成立 |

#### ④ 三条边界，写在这里免得下一轮被读成"整套都验过了"

1. 🔴 **被验的镜像是 `linux/arm64`**，而发布 workflow 钉的是 `linux/amd64` —— 脚本自己把这句打在输出里（第 9–11 行）。这趟证的是「外人在自己机器上 build 出来的那一枚能跑」，**不构成**对 amd64 发布物的运行证据。
2. **构建层那条产物自洽 RUN 的读数形状是 `cached-or-silent`**（第 3 行明写）：`docker build` 的输出不足以判断那一层到底跑没跑。补的那一条腿是在**跑起来的镜像里另跑一次**（`WEB_ARTIFACT_IN_IMAGE=OK`），所以这条判据不依赖构建日志。
3. **验证 ≠ 迁移**：这趟全程在 `127.0.0.1:1900` 的隔离栈上，没有碰生产容器、没有发布镜像、没有推远端。

#### ⑤ 一条可迁移的形状（承 §8.117，不重述它的读数）

**轮询型看守器的"健康表象"来自它一直在拒绝，而它的失败路径只在它答应的那一刻才走。**
所以"它 50 分钟里报了 30 次环境无效"这条观测**不构成**它可用的证据 ——
要证它，得造一次窗口真开的运行，或在拒绝分支里也走一遍那句 `echo`。
下次写等待器：把成功路径那句 `echo` 放到**任何副作用之前**，并避免 `$VAR` 紧跟全角标点。

#### ⑥ 这四张图入库时的一条附带读数：**同一趟里有一张与上一趟逐字节相同**

`git hash-object` 对账：`s1-app-loaded.png` 的新字节 == `HEAD` 里那一版（`67ea5fa6…`），
另外三张变了 —— 因为 S2/S3 那三张里印着**本次 run id**（邮箱 `selfhost-1904796-1@…`、
任务标题 `selfhost-task-1904796-2`），而 S1 是**未登录**的空收集箱，画面里没有任何一次性的东西。
⇒ 这条不是 trivia：它说明**"mtime 晚于起跑"和"内容变了"是两个独立的判据**，
一张图可以完全新鲜而逐字节不变。脚本只判前者（对的，那是它能判的），
而如果哪天有人改成"图必须和上一版不同"，S1 会**永远红** —— 别那么写。
另三张自 merge-base 起 **main 没动过**（逐条 `rev-parse main:<path>` == `… $MB:<path>`）
⇒ 把它们入库**不会**给落地那一趟新增一枚二进制冲突族。


### 8.119 落地预检照出**第八族冲突**：两侧改在截图前的同一段等待上（2026-10-04 19:1x–19:2x）

#### ① 触发方式：不是有人来报，是我按 §8.16 跑那条体检命令

刚提交完 §8.117/§8.118（`ca20880e`）就 dry-run 一次落地体检，为了确认"新落 115 行台账没把载体判红"。
它回的不是"载体 OK"，而是 `exit 2`：

```
· main=b18379fc · feat/self-host-distribution=ca20880e · merge-base=b850b1c6
· MERGE_HEAD=ca20880e 已确认 · 冲突 6 条：…audit.md, package.json, check-image-license-coverage.mjs,
  gen-image-npm-tree.mjs, server/image-npm-tree.json, scripts/screenshots/capture.mjs
❌ 出现**预置七族之外**的冲突路径，不许自动决定：
  - scripts/screenshots/capture.mjs
```

前 5 条是旧族（并集/取侧都已预置）。第 6 条是新的：**main 在 10-04 也改了 `capture.mjs`**
（`dismissOverlays` / `clearHoverAndFocus` / 报错要说出"是谁盖住了点击目标"），
而本批 G-57 改的是**同一段**（把截图前那句固定 `waitForTimeout(600)` 换成"等揭示落位"）。
🔴 这正是那道"不许自动决定"该拦的东西：它不是"两边各加一块"，是**同一个语义位有两个主人**。

#### ② 为什么解法不是"两块都留"

`.gitignore` 那一族可以两块都留，因为两侧都是**末尾追加**。这里不行：
行级并集会把 `await page.waitForTimeout(600);` 和 `const settled = await settleForShot(page);`
**一起留下** —— 产出看起来什么都没丢，语义却是"先傻等 600ms 再等揭示"，
也就是把 G-57 刚摘掉的那个形状原样装了回去。
⇒ 解法：**取 main 为底，把本批那四处改动逐字面重放上去**，每处要求 needle **恰好命中一次**
（0 次 = main 又改了形状；>1 次 = 我的 needle 太宽），两种都当场退 2 交人判，不"顺手取一侧"。

判据与产出在 `research/tools/selfhost-capture-replay.mjs`（单一所有者，载体脚本只消费它），
带 `--selftest`：control 绿 + 五臂各红一次 + 收尾复绿。

#### ③ 这个装置自己开口两次，两次都是我的错，都留在代码注释里

1. **第一版实现就是错的，被 control 臂照出来**：`diffKeys` 我写了
   `dir === 'removed' ? m < n : m > n` 的三元 —— 选完 `src` 之后两个方向其实是**同一个比较**，
   三元让"新增"恒空 ⇒ control 自己红（`实际新增 0 行、应当 11 行`）。
   这不是"测试太严"，是判据没牙的另一种面目：**它报的数永远少一半**。
2. **第一版的一条臂是无效臂**：`extra_line_dropped` 用"从 main 的样本里删一行"来模拟
   "重放覆盖掉别人的改动" ⇒ 它**不响**。原因是行级对账比的是 replay 的**输入与输出**，
   main 少一行是两边一起少。那一层归 `MUST_KEEP_FROM_MAIN` 管（臂 2 就是它，会响）。
   行级对账真正的用途是挡"**重放自己写坏**" ⇒ 臂 4 换成临时把某一处 `repl` 少写一行
   （`sabotage`），并配**还原断言 + 收尾复绿**，证明变异没留在对象里。
   📌 可迁移：**一条判据的"能失败"要按它真正覆盖的那一层造样本**，
   造在别的层上的臂会给出"验过了"的假读数 —— 这比没验更贵。

#### ④ 真产物读数（不是合成样本）

拿 `git show main:scripts/screenshots/capture.mjs` 的**真 blob** 跑重放：
`hits=[1,1,1,1]` · verdict 0 条 · 产出 `node --check` 过。
与分支那一版逐行差 **83 增 / 12 删**，那 12 行**全是 main 侧的改动**
（`dismissTexts` 内联循环被换成 `dismissOverlays`、报错归因重写、还有一处把注释并到
`.first();` 行尾的格式伤）—— 本批四处一行都不在差集里。

载体已按新族重算：**`06067be4` = main(`e95feb5a`) × `ca20880e`**，8 道纯 fs 门禁全 `exit 0`，
`CARRIER_RC=0`。载体上那份合并结果**独立复核**过（不看工具自述）：
`dismissOverlays=1 clearHover=1 settleForShot=2 固定600=0 等待读数=1` 且 `node --check` 过。
🔴 期间 main 又动了两次（`5de78a14`→`b18379fc`→`e95feb5a`）⇒ "现算载体 → 现跑链 → 立刻落地"
这个顺序仍然成立，任何提前跑好的东西都会在窗口到来时过期。

#### ⑤ 边界与代价（写清楚，别让下一轮以为是零成本）

- 四处 needle 是**逐字面**钉的。main 再动那四行里的任何一处措辞 ⇒ 预检退 2 点名，
  要人加一版重放或手工解。**这是刻意的**：这一族的两侧都有主人，自动决定等于我替他拍。
- `MUST_KEEP_FROM_MAIN` 只钉了 main 新增的**两个函数签名**。main 以后往那一段再加东西
  （不在这两个签名里、也不在这四处 needle 里）时，行级对账**看不见**（理由见 ③.2）——
  真要挡那一类，得把"main 侧新增块的清单"也钉进来，那是下一次的事，不在这里预支。
- 阻塞集仍是 **4 枚**（`.gitignore` · `package.json` · 两份 i18n 词条表），等其所有者提交；
  看守器 `g149-blockers.sh`（pid 86985）在跑，它解析的是中文汇总那句，
  且自带"脚本没报出数 ⇒ 探针问题，不算归零"那条守卫。
- 📌 **§8.22 那张"四条预置解法"表现在只是历史**。族与解法的**唯一清单**是
  `research/tools/selfhost-merge-carrier.mjs` 文件头那八条（它同时是唯一执行者）。
  以后新增一族只写在那里 —— 在台账里再抄一份就是下一个会漂的副本。

#### ⑥ 预检复跑（19:2x，`cf6b0316` 之后）：第八族不再挡路，剩下的两条红都不是我这批的

```
✅ 载体 bb18d96d = main(e95feb5a) × feat/self-host-distribution(cf6b0316)
   门禁 8 道全 exit 0；完整 pnpm check 留给落地那一刻
✅ 载体双亲对上
🔴 阻塞集为空 —— 4 枚未清空：.gitignore · package.json · packages/i18n/src/locales/en.ts · …/zh-CN.ts
🔴 负载可用 —— 负载 87.71 > 12 ⇒ 环境无效（不调阈值、不硬跑）
⏭️ 载体上完整 pnpm check —— 没跑（前面已有 2 条不成立）。跳过不等于通过。
LAND_DRY_RC=1
```

⇒ 落地那一步现在**只剩两种外部条件**：别人把 4 枚未提交文件提交掉、以及一个负载窗口。
"合并这件事本身"已经没有任何未预置的形状了 —— 这跟 19:1x 那一趟的区别就是第八族从
`❌ 不许自动决定` 变成了 `✅ 已预置`，其余读数一模一样。
⚠️ 别把这条读成"预检通过了"：它 `exit 1`，而且**下一次跑它时 main 大概率又前进了几笔**，
载体与这两条红都要重新现量。



### 8.120 第八族那条判据有了自动消费方，而"给它造一条变异臂"这件事本身错了一次（2026-10-04 19:3x–19:4x）

#### ① 为什么挂进载体脚本、而不是加一段 `pnpm check`

§8.119 落下的 `selfhost-capture-replay.mjs --selftest` 当时只有一个消费方：**我手动跑过一次**。
按 G-48 收口时立下的口径，那不叫消费方（"它不是'手动跑的那一条'，它是'没有人跑的那一条'"）。
挂点选在 `selfhost-merge-carrier.mjs` 的分族之后、解族之前，理由是：
这条判据唯一被用到的时刻就是解第八族，而**每次要落地都必须重算载体** ⇒ 挂在这里它就有"每次都被跑"的保证；
往链里加一段反而要再动 `"check"` 那一整行 —— 那正是 §8.41 那族冲突的成因（一侧改能自动并，两侧都改才冲突）。

#### ② 三条实测读数，其中一条把我自己原先的论证否证了

| 臂 | 结果 | 说明 |
|---|---|---|
| 真自检输出喂给内容判据 | `null`（=通过） | 判据在合法输入上不响 |
| 摘掉"残留冲突标记"那条检查（= 一条臂不再开火） | 内容判据开口：`1 条变异臂的问题数为 0 ⇒ 自检被摘了牙或某一臂不再可达` | **但同一趟 `rc` 也是 1** ⇒ 这一臂**没有**证明"内容判据比退出码多抓住什么"，只证明它**不依赖自检脚本自己的 pass/fail 记账** |
| 想造的"摘掉自检判定 + 死臂"组合臂 | 变异**没落在代码上** | 见 ③ |

 所以这里不许写成"只看 rc 的消费方是瞎的，我修好了它"。准确的说法是：
内容判据是**第二层**（它自己独立重算结论），它比 rc 强的那一面**今天没有取到证据**。

#### ③ 变异没施上去的原因，是我自己给自己埋的：文档注释里逐字抄了那行代码

`replace(那行代码, 'const ok = true;')` **只换第一处**，而第一处是我在
`selftestOutputVerdict` 的注释里为了讲清理由而**原样引用**的那一句 ⇒
注释被改了、代码里那一句原封不动（`grep -n "const ok = "` 两行都还在：注释那行成了
`const ok = true;`，代码那行仍是 `const ok = name === 'control' ? …`）。
表现是"变异成功、判据没响"，很容易被读成"这条判据没牙"——**而没牙的是变异装置**。
已把那处注释改成不含该字面串的转述，并把这件事写回注释本身，防止下一个人再抄一遍。

#### ④ 一次"标签先于读数"的自纠

我在打印里预写了 `（只看退出码的消费方在这一臂上是瞎的）`，命令回来才发现 `rc=1` ——
**结论与我刚起的标签相反**。这是"给还没量到的读数起一个名字"那一族：
期望要写在**断言**里（脚本自己比较并决定红/绿），不能写在我为解释输出而准备的那句话里。

#### ⑤ 成功路径也要打印

自检那条原先只 `notes.push(...)`，而 `notes` 只在 `die()` 时 dump ⇒ 成功时完全静默。
"静默的通过"会被下一轮读成"没跑"，也可能被读成"跑了但没人看"——两种都不是证据。
已加进成功输出。载体复跑读数（19:4x）：

```
✅ 载体 4d5ed9ea = main(133441bf) × feat/self-host-distribution(3fddcd07)
   第八族判据自检：control 0 条 + 五臂各 ≥1 条 + 收尾复绿（按输出内容判，不是只看 rc）
   门禁 8 道全 exit 0；完整 pnpm check 留给落地那一刻
CARRIER_RC=0
```

⚠️ 两个读数口径要说清：① 被 exec 的自检是**载体树里那份**（提交物），不是我工作树那份；
② 这一趟里 main 又动了（`d5eb28db`→`133441bf`，约两分钟）—— 落地窗口里"现算载体"这一步省不掉。

### 8.121 落地闸门新增"跑链之前先看那几个端口上有没有人"这一道（提交 `4ce764fe`）—— 控制臂在**提交前**就抓到两条自己写的 bug

> 载体：`c70e3bcc = main(671020ac) × feat/self-host-distribution(c3c3db91)`（19:5x 现算，本次体检用的就是它）。
> 现量闸门读数：阻塞集 **4 枚**（`.gitignore`、`package.json`、`packages/i18n/src/locales/{en,zh}.ts`）· 负载 **39.06 > 12** ⇒ `exit 1`（阻塞集那一档更严重）。

**为什么现在补**：目标第 1 项要在载体上跑**完整 `pnpm check`**，而硬约束里写着"不 SIGKILL 别人的 dev server"。
这两句原来在同一个工具里打架，而且打架的方式是**沉默的**：`scripts/check-ai-e2e-preflight.mjs` 会对它那些端口上的
监听者逐个 `process.kill(pid, 'SIGKILL')`，杀完只打印 pid —— 受害者通常到下一次 `ECONNREFUSED` 才知道是谁干的。
所以这一道**不提供绕过开关**：判不了就不跑链，要硬跑的人自己去载体目录跑（清场由他做、日志在他手上）。

#### ① 三条实测决定了写法（不是设计出来的）

1. **射程不能只读 `DEFAULT_PORTS`。** 现量：链里有**三段**各自调那枚 preflight ——
   `check:ai-e2e` 不传参数（用默认 4318/4319）、`check:landing-e2e` 传 **4320**、`check:privacy-consent-e2e` 传 **4322**。
   只读默认值的版本会漏掉后两个，症状正是"以为判了、其实照杀别人的服务端"。
   现在端口集合从"每一段调用时**实际传了什么**"现读（显式优先、没传才回落默认值），并给每个端口留**归因**（拒绝时要能说出是谁把它放进射程的）。
2. **载体目录只能用一只旋钮、一个默认值。** 本工具原来写 `join(tmpdir(), 'heyta-merge-carrier')`，
   而 macOS 的 `TMPDIR` 不是 `/tmp`：现量 `ls` 那条路径 → **`No such file or directory`**，真实载体在 `/tmp/heyta-merge-carrier`。
   也就是说这道新闸门本来会去判一棵**不存在的树**（它至少是响亮拒绝、不是假绿，但判错了对象）。
   现在默认值与 `selfhost-merge-carrier.mjs` 逐字对齐，且**这条对齐本身是自检的一臂**（读不到对方的形状 ⇒ 报"不敢假设"，不报"对上了"）。
   旋钮名也收敛成一只（`HEYTA_CARRIER_WT`）—— 两只旋钮时只设对方那只的人会读到旧树的端口清单。
3. **`Number('')` 是 `0` 而不是 `NaN`。** `m[1].trim().split(/\s+/)` 在"这段没传参数"时得到 `['']`，
   `map(Number)` 得到 `[0]`，于是 `explicit.length` 为真 ⇒ **回落不发生** ⇒ 真正会被清的默认端口整个掉出射程。
   控制臂实测就是 `[0, 4320, 4322]`（应当 4 个端口）。加 `x > 0` 后为 `[4318, 4319, 4320, 4322]`。

#### ② 判据自带自检，而且 `--confirm` 会先跑它（自动消费方）

`node research/tools/selfhost-land-main.mjs --selftest` 现量（`SELFTEST_RC=0`）：

```
载体射程 4 个端口（4318←check:ai-e2e（用 DEFAULT_PORTS）、4319←check:ai-e2e（用 DEFAULT_PORTS）、
  4320←check:landing-e2e（显式传 4320）、4322←check:privacy-consent-e2e（显式传 4322））
探测腿：::1:52886→pid 51576、127.0.0.1:52887→pid 51576
✅ 射程判据自检：控制臂出数 + 五臂各按预期 + IPv6/IPv4 单栈监听都可见且关闭后读成空闲 + 无 lsof 时报"判不了" + 收尾复绿
```

腿是哪些：**控制臂**（已知形状的假链 ⇒ 端口集恰好 `[4318,4319,4320,4322]`）、
摘掉 preflight 文件 / 改形 `DEFAULT_PORTS` / 链里一段都不提它 ⇒ 三臂都必须报**"判不了"**而不是空集
（空集在这一档不是"安全"，是探针没接上）、
只有一段且它传显式参数 ⇒ 射程必须**恰好**是那一个（不许把默认值拖进来，那是过度拒绝）、
同端口被两段认领 ⇒ 去重且归因只留第一条、
**探测腿**：真造监听者，`::1` 与 `127.0.0.1` 各一条（vite 就绑 `[::1]`；只认 IPv4 的探测会把**有人用**的端口读成空闲），
开着时 `busyEntries` 必须数出恰好 1 条且那条里带着来源串，关掉后必须 0 条（否则闸门会过度拒绝、把自己的路也堵死），
PATH 里没有 `lsof` 时必须报"判不了"，换回来必须又能判（收尾复绿，且这一臂**无条件跑** —— 前面红了不许把它一起省掉）。
`--confirm` 起手先跑同一个函数：**判据自己坏了的时候，它那句"这些端口没人用"不能当放行**（§8.120 同一形状）。

#### ③ 变异读数（两臂，一次性副本 + 复原逐字节对照）

```
M1 载体目录默认值漂移: rc=2 命中针=是 | - 载体目录默认值漂移：本文件 /tmp/other-carrier vs 载体脚本 /tmp/heyta-merge-carrier ⇒ 闸门判的是另一棵树
M2 空参数折成端口 0:   rc=2 命中针=是 | - 控制臂射程：实际 [0,4320,4322]，应当 [4318,4319,4320,4322]
复原对照: 逐字节相同=True 复绿 rc=0
```

M2 不是"设计的变异"—— 它就是这条判据**写完第一趟实测的样子**（① 第 3 条），修好之后又拿它反着打了一次，
确认红是这一臂造成的而不是别的臂顺带红了。

#### ④ 边界（别读多）

- 这道闸门判的是**"跑链之前"**这一刻。它不锁端口，也不防"判完之后别人在链跑到一半时起 dev server"——
  那是那枚 preflight 自己的射程，本工具不改它（改它 = 动别人的门禁）。
- dry-run 不跑链 ⇒ 这一道打印 `⏭️ 不适用`，**不适用不等于通过**（沿用闸门里"跳过必须响亮"的那条）。
- `busyEntries` 里 `ps` 读不到命令行时写 `(读不到)`，仍算"有人"—— 宁可过度拒绝，不拿读不到当空闲。
- 载体又落后了：`c70e3bcc` 的父是 19:5x 的 main(`671020ac`)，落地那一步仍要**重算**（`--confirm` 自己会算）。

### 8.122 端口射程抽成单一所有者 `selfhost-kill-ports.mjs`（提交 `78c26d66`）—— 合并两份抄件时发现的不是"重复"，是**其中一份把修过的假 0 抄丢了**

> 载体：`777ae984 = main(294bb83c) × feat/self-host-distribution(daf13640)`（20:0x 现算；main 又动了两次）。
> 阻塞集仍 **4 枚**（`.gitignore`、`package.json`、`packages/i18n/src/locales/{en,zh}.ts`），负载 16>12 ⇒ 落地闸门 `exit 1`。

**起因**：上一节把落地闸门的射程改成"从链现读"之后，同一个判断在仓里有**两份**了
（`selfhost-check-segments.mjs` 里那张"段名正则 → 端口"表 与 本工具的新代码）。
按"抽单一所有者"去合的时候，逐行读了对方那份的注释，才发现真正的问题不是重复：

| 那一份 | 它自己的注释里写着 | 我的那份 |
|---|---|---|
| segments（`da3345c3` 修过） | 🔴 **rc 不是判据**（有监听时也退 1）；坏探针的信号是 **stderr 有字**；探针坏时 stdout 同样空 ⇒ 会被读成"没人占"⇒ 放行 SIGKILL | 我按 preflight 的写法抄成"`e.stdout ?? ''`"，**把这一层抄丢了** |

也就是说 §8.121 那道新闸门在"lsof 参数形状出问题 / 被别名包掉"这种场合下会**响亮地报绿**，
然后照样杀别人的 dev server。这不是假想的：`-sTCP:LISTEN` 各端口带一次就是这条事故的原样，
它今天在这台机器上仍会往 stderr 写 `lsof: duplicate TCP inclusion: LISTEN`（自检臂 6 现量）。

#### ① 合完之后：判据只有一处，两个消费方

`research/tools/selfhost-kill-ports.mjs` 持 `defaultsFrom` / `explicitPortsOf` / `portsForCommand` /
`portsKilledBy`（**guard 在模块里**，见下）/ `deriveKillPorts`（带归因）/ `probeVerdict`（三档互不相同：
`noLsof` 判不了 · `brokenProbe` 探针坏 · `rows` 可信读数）/ `listenersOn` / `busyEntries` / `portsSelftest`。
落地闸门与逐段归属器都只调它；两份本地实现删掉（`-286` 行）。

#### ② 抽出时新长出来的两条（都不是原有两份里的）

- **`portsKilledBy` 的 guard**：回落逻辑（"没传显式参数就用默认值"）写在 `portsForCommand` 里，
  调用方一旦忘了先判"这段到底调不调 preflight"，就会把**整条链**读成"会清 4318/4319"（过度拒绝），
  或者反过来挑错段。所以 guard 收进模块，消费方只拿得到 `portsKilledBy`。
  第一版没这条，**臂 3 立刻红了**（"链里一段都不清端口"变成"每段都清"）—— 那是夹具先发现的，不是人读出来的。
- **配对取并集**：归属器现在对**所有配对树**各算一遍再取并集（任何一棵会清、且那枚端口正被占 ⇒ 两边都不跑）。
  旧表按段名给固定端口，没有"这棵树上这段根本不存在"这一档。

#### ③ 零行为变化（不许凭"看起来一样"宣布）

旧表**从 `git show HEAD:` 取出**（不手抄），解析成 3 行后逐条 script 比新旧端口集：

```
旧表从 HEAD 取出 3 行：check:ai-e2e→4318/4319 · privacy-consent→4322 · test:landing|check:landing-e2e→4320
carrier: 146 条 script 逐条比过，其中 146 条新旧一致
branch:  130 条 script 逐条比过，其中 130 条新旧一致
✅ 零行为变化：两棵树每条 script 的新旧端口集逐字相同
```
（`OLDBNEW_RC=0`；解析行数不等于 3 就 `exit 2`，不拿"没比上"当"比过了"。）

#### ④ 真现场复验（这台机器此刻正有别人的 dev server）

```
链并集 77 段（carrier=77）· 本次判定 2 段
   端口探针阳性对照：已监听端口 :39876 抓到 1 行（同一条命令形状）
   SKIP_SAFETY pnpm check:ai-e2e：端口被占（4318/4319 ← :4319 pid=77341 node，:4318 pid=77353 node）—— 这一段不跑，也不进差集
  [carrier] ✅ rc=0 1s pnpm check:design
```
4318/4319 是**别人正在用的两枚端口**（`lsof` 现量 pid 77353/77341），改线后的归属器把它们抓成 SKIP_SAFETY、
只跑了那条轻段，`SEG_RC=0`。这一趟不是构造出来的：它同时说明落地闸门**现在**跑也会拒绝（这正是它该做的）。
⚠️ 这一趟用了 `--max-load 60`（该工具自带的显式旋钮）：负载 14.88 时本该 exit 3，但被判的对象是"端口守卫接没接上"，
而唯一有牙的段（`check:ai-e2e`）已经被安全跳过 ⇒ 没有任何重活因此跑起来。**这不是把阈值改成能过**（那条红本来就不在这条判据上）。

#### ⑤ 变异读数（一次性副本 + 复原逐字节对照）

```
M1 摘掉"不调 preflight"的 guard: rc=2 命中针=是 | - 臂5b 不调 preflight 的段：实际 [4318,4319]，应当 []
M2 把"探针坏了"当可信空集:      rc=2 命中针=是 | - 臂6 把"探针坏了 + stdout 空"读成了可信空集 ⇒ SIGKILL 照旧发生
复原对照: 逐字节相同=True 复绿 rc=0
```

#### ⑥ 待入 traps（⚠️ **没有**写进 `docs/reference/environment-traps.md`，理由现量）

主检出的那份台账此刻 **`M` 且 +779 行**（别人正在写，工作树最大号 267）—— 按既有纪律不往正脏的多人台账里插行，
在这里登记，落地后由所有者收号：

- **候选 A**：macOS 的 `os.tmpdir()` 是 `$TMPDIR=/var/folders/…/T`，**不是 `/tmp`**。
  两处代码用不同写法表达"同一个临时目录"时，其中一处会指向一条**不存在的路径**，
  而 `existsSync` 为假时的症状与"这棵树没建"完全一样（本工具原来就是这样，判的是空气）。
- **候选 B**：`Number('')` 是 `0` 而不是 `NaN` ⇒ "这段没传参数"被读成"传了端口 0"。
  与 §8.121 ①-3 同族，属"假 0 会咬人"的第三种面目（前两种：坏探针的空 stdout、rc=1 与空闲同形）。

### 8.123 线上落地页此刻仍印着「可安装」，而且同一条页上还有第二处已修未上线的缺陷（2026-10-04 20:1x 现量）

新写的那条**部署层**判据 `e2e/live-site/live-install-claim.spec.ts`（G-51 步骤 ④）第一趟就红，
红的内容不是探针坏了，是**对外错话今天仍在生产上**：

```
Error: Web 卡应当含当前文案锚点「断网也能照常记」：完整产品，不是演示。可安装、可离线用，数据就存在你的浏览器里。
Error: Web 卡应当含当前文案锚点「keeps working when you are offline」：The full product, not a demo. Installable, works offline, …
LIVE_RC=1（2 failed，zh-CN 与 en 各一条）
```

#### ① 归因：线上与 `main` 是一致的，缺的是**落地**，不是发布动作

```
main:packages/i18n/src/locales/zh-CN.ts:3282  'site.platforms.web.body': '…可安装、可离线用…'
main:packages/i18n/src/locales/en.ts:3053     '…Installable, works offline…'
本分支  zh-CN:3047 / en:2842                  已是摘掉那句的新文案
```
⇒ 线上渲染的正是 `main` 的内容。
⚠️ **这里没有需要撤回的旧结论**：§8.27 当时就写着"为什么不立刻重发…合并本身就会把这句话带干净，
缺的只是发布"，§8.107 也写着"没有任何用例钉着这句"。本条做的是把那个缺口补上（第一次有线上读数），
它是**印证**而不是否证。会被误读的是任务清单里 #8/#19 那两个 ✅ 标题
（"重新发布落地页（台阶 0 改的对外词条…）"）—— 那两趟复跑的既有用例里没有一条量过这句，
所以"已重发"与"这句还在"两件事同时为真。标题的措辞已按本条改挂到"待落地后复跑"（任务 #21）。

#### ② 同一条页上的第二处（人眼看截图撞出来的，不是断言撞出来的）

`e2e/live-site-results/platforms-web-card-zh-CN.png`（已看过）里那条「未签名」提示**排成三栏**：
"双击会被 ／ ，需要右键打开。把这句省 ／ 系统拦下 ／ 掉，用户会以为包坏了。"
现量 `main:apps/landing/src/styles/landing.css:596` 是 `display: flex`，而本分支同一处是
`display: block` + 一段说明（修在 `8926be56`，正是 §7 第 5e 条那一族：`RichText` 把一条词条按
`**粗体**` / `` `代码` `` 切成兄弟节点，flex 把它们各排一栏）。
⇒ **同一个根因**：这一批没落地，所以两处"已修"在生产上都还在。

⚠️ 那张图顶部的标题残缺**不算缺陷读数** —— 这条用例在 `domcontentloaded` 后立刻截图，
标题揭示动画还没走完（同一族的探针时机问题，记忆 5c）。要量标题得等 reveal。

#### ③ 这条判据的两腿各自都红过（不是"看起来在保护，其实保护的是另一件"）

- **锚点腿**：今天因"线上还是旧文案"红（① 的读数）。
- **负向腿**：受控变异（暂时拿掉锚点断言，只让负向断言说话）报出
  `线上 Web 卡不该再承诺「可安装」：完整产品，不是演示。可安装、可离线用…`
  与 `…「Installable」：The full product, not a demo. Installable, works offline…`，`ARMA_RC=1`；
  之后 `cp` 复原并 `diff -q` 确认**逐字节相同**。
  这条变异不是编出来的样本 —— 它就是线上今天的真值，所以它同时是"判据有牙"和"错话还在"两份证据。

#### ④ 为什么这次**提交一条红的判据**（与 §8.107 那条"不落"的裁决不冲突）

§8.107 当时不落，是因为那条红会红在"还没发布"上，而**没人拥有那个动作**。现在的差别是：
红因已归因到两件有主的事（① 本批落地＝目标第 1 项；② 从落地后的 main 重发落地页＝任务 #19/#8 那条链），
且用例头部与断言消息里都写着**关闭条件**（"如果读到的是「可安装/Installable」那句，说明还没落地或还没重发，不是站点坏了"）。
不提交的代价更大：那就没有任何东西会在重发之后回来量一次"错话到底走了没有"。

#### ⑤ 落地之后的同一趟要顺手做的（不另起一次）

1. 重发落地页后**复跑本文件**取绿（两条 locale），并保留 `live-site-results/platforms-web-card-{zh-CN,en}.png` 两张图给人看；
2. 那时那条三栏提示应当自动变好（同一棵树），要**再看一眼图**确认，而不是推断；
3. 任务 #20/#21 与 G-58（`screenshots/landing/*.png` 仍印着那句承诺与旧域名）在同一趟收口。

#### ⑥ 整条线上套件同时跑了一遍：23 绿 / 2 红，而两枚红全是这条新判据

```
Running 25 tests using 1 worker
  2 failed
    [chromium] › live-site/live-install-claim.spec.ts:68:3 › 线上 zh-CN Web 卡…
    [chromium] › live-site/live-install-claim.spec.ts:68:3 › 线上 en Web 卡…
  23 passed (1.1m)
LIVEALL_RC=1
```
这条读数的用处是**把"站点坏了"这个解释排除掉**：既有的 23 条线上判据（解析 / TLS / canonical /
`/app/` 加载 / 登录入口 / `/docs/selfhost/` / PWA 资产与 SW 注册…）全绿，红的只有新加那两条，
且报错原文就是 `main` 的词条内容。⇒ 生产没有回归，缺的仍然只是"落地 + 从落地后的 main 重发"。
（对账口径不是"总数相等"而是**既有用例一条都没变红**。顺带把三次读数的差说清，免得下一读的人以为掉了什么：
09:31 是 23 条（§8.27 前），18:35 是 26 条 —— 多的那 3 条是当时挂在树里、**未提交**的
`live-site/live-pwa.spec.ts` 三条腿（§8.118 记着它后来被删），本趟 25 = 既有 23 + 本条新增 2。）

### 8.124 落地前又跑了一次只读预检，这一趟的产出是一条**新的闸门**：载体重算会毁掉别人正在跑的现场（提交 `ec941cf8`，2026-10-04 20:2x–20:4x）

#### ① 预检读数（全部瞬时，引用要现取）

| 读数 | 命令 | 现量 |
|---|---|---|
| 三行 | `git rev-parse main` / 分支 / `git merge-base` | `58e43418` × `ec941cf8`，merge-base 仍是 `b850b1c6` —— 二十分钟内 main 走了 `294bb83c→d2a4854a→58e43418` 三笔 |
| 冲突面 | `git merge-tree --write-tree --name-only main feat/self-host-distribution` | `rc=1`，**6 条**：`package.json` / 本审计文档 / `check-image-license-coverage.mjs` / `gen-image-npm-tree.mjs` / `scripts/screenshots/capture.mjs` / `server/image-npm-tree.json` |
| 分族 | 载体脚本 `:191` 那张表 | `pkg=1 audit=1 cov=1 gen=1 cap=1 snap=1` ⇒ **`other=0`**，八族全覆盖，不会 `die(2)` |
| 阻塞集 | `selfhost-landing-blockers.mjs` | 写集 54 · 脏 166 · **4 枚**（`.gitignore` / `package.json` / 两份词条表）—— 这 4 枚在 `merge-tree` 上**全是 `Auto-merging`、零 CONFLICT** |
| 环境 | `sysctl -n vm.loadavg`、`lsof -nP -iTCP:…` | 负载 16.58–117.79（两趟别人的 iOS 设备验收在飞）· 4318/4319/4320/4322 **全空** · 载体此刻**在用者 0 个** |

🔴 **要就地更正的是 §8.111 ② 那一行的现在时**：它写"A 提交态冲突 = 零冲突 … 已经没有了"。
那趟（18:1x，main=`cae62c6b`）确实是零冲突，而它作为**当前陈述**已经活了不到一小时 ——
19:1x 的 §8.119 ① 就量到 6 条，今天仍是 6 条。那一层的正确说法不是"空了"，是
**"每次落地前重取一次；只要还在八族内就不需要新增解法"**。已按这个措辞在原行下方标注。
（阻塞集那一层没变：B 仍是 4 枚、仍只能等他们提交 —— 见 §8.111 ② 的分工。）

#### ② 第八族的另一半读数：反证臂

§8.119 ④ 记的是正向那一半（拿 `git show main:scripts/screenshots/capture.mjs` 的真 blob 跑重放，
`hits=[1,1,1,1]`、verdict 0 条、`node --check` 过）。今天补的是**反证那一半**，
因为"needle 恰好命中一次"这条判据如果其实是恒真的，正向那半就什么都没说：

```
以 main(d2a4854a) 那一份（329 行）重放 ⇒ ✅ 判定通过，命中 [1,1,1,1]，删 4 行 / 增 11 行，产出 336 行
以分支那一份（265 行）重放          ⇒ ❌ 命中 [1,0,0,0] —— 三处"改动前"的 needle 命中 0
                                       ⇒ 不重放，交人判（这一条必须红，它是那四处不是恒真的证据）
```

⚠️ 拿分支那份喂进去**不是**本来的用法（`replayCapture()` 的输入定义是 stage 2 = main），
它在这里只当反证用。保质期口径同 §8.16：只对落笔这一趟成立。

#### ③ 这一趟真正新增的东西：一道闸门，因为载体已经是两棵树共用的

`/tmp/heyta-merge-carrier` 现在**不只我在用** —— 并行那条线的启动器（main `f7e193e9` 把它自己升到 v11
的那笔提交信息）在同一棵树上做公证 + 远端打包，一趟 15–25 分钟。而 `selfhost-merge-carrier.mjs`
第 0 步是**无条件**的 `worktree add` / `merge --abort` / `checkout --force` / `reset --hard`。
撞进去的症状不是报错，是**他们的读数句句真话而图属于另一棵树**（`INNER_EXIT=0` / `FRESH=5/5`）——
那是他们 v11 守卫正要防的事，可那侧守卫防不住我这侧把树换掉。
⇒ 对称动作必须由**我**做，而且必须挂在**第一个写动作之前**：口头约定"跑之前先看一眼"在这台机器上
已经失效过（那条提交信息里写着 20:03 的 reflog 有一枚不是他做的 checkout）。

判据本体 `research/tools/selfhost-carrier-busy.mjs`（九臂自检），消费方是载体脚本第 0a 步，
落地体检把它的 `rc=6` 记成 sev 3（**协作未到位，不是产品红**）。四条形状各挡一个已经发生过的错：

| 形状 | 不这么做会怎样 |
|---|---|
| 整 token 命中，不认前缀子串 | `${dir}-backup` 这类目录也算"有人在用" ⇒ 永远拒绝 ⇒ 下一次被人整个拆掉 |
| 两条腿读不到 ⇒ 按"判不了"退 2 | `ps`/`lsof` 被拦时的输出与"没人用"**同形** —— §8.122 那个假 0 的同一个形状 |
| `/private/tmp` 与 `/tmp` 归一 | 实测 `lsof -d cwd` 打印的是 `/private/tmp/heyta-merge-carrier` ⇒ 不归一会把"有人正在用"读成空集 |
| argv 腿之外还要 cwd 腿 | 别人 `cd` 进载体之后起的子进程，命令行里根本没有那个路径 |

自己的进程树按 **pid 链**豁免（否则 `--confirm` 自己挡自己），子孙不豁免；
`HEYTA_CARRIER_BUSY_FORCE` **只能把它逼红**（`busy`/`blind`），没有让它放行的取值 ——
打错字本身按"判不了"退 2，所以这道闸门没有绕过口。

#### ④ 注入与变异读数（判据有牙的证据，不是"跑过了"）

```
HEYTA_CARRIER_BUSY_FORCE=busy     ⇒ rc=6   点名 pid=999999 [argv]
HEYTA_CARRIER_BUSY_FORCE=blind    ⇒ rc=2   "判不了 ≠ 没人用"
HEYTA_CARRIER_BUSY_FORCE=nonsense ⇒ rc=2   不认识的取值也过不去
三趟之后载体 head=ffd421f2 / reflog 条数 103 / dirty 0 —— 逐项逐字不变 ⇒ NO_WRITE_PROVEN=OK
land 体检（dry-run + FORCE=busy） ⇒ 打印"载体是别人的现场，脚本一个字节都没写（退 6）"，
                                   并按 sev 排档退 1（阻塞集那条 sev 更高，属既有设计）
把 pid-1 正向对照摘掉（原地变异，一次性替换带命中数断言）⇒ 臂 6 由"问题 0 条"变"问题 1 条"，
                                   复原 cmp 相同后自检回 rc=0
```

control 臂**第一跑就抓到两条我自己写的 bug**，都留在代码注释里：
① `if (!r.users[0]?.via === 'argv' && …)` —— `!x === 'argv'` 恒假，那条断言一次都没生效过；
② `new URL(…).pathname` 会把仓库路径里的空格百分号编码成 `All%20in%20one` ⇒ `readFileSync` 读不到
对方脚本 ⇒ 防漂那一臂**报了个假红**（红的是探针，不是判据）。修法是 `fileURLToPath`。

#### ⑤ 一条命令名的坑（同 §8.122 那一族，值得单独留名）

我把载体脚本 GATES 里那八道在**本分支**上逐道跑了一遍，`check:md-tables` 读出 `RC=1` 且日志**空** ——
真相是 pnpm 报 `ERR_PNPM_NO_SCRIPT`（`-s` 把那句吞了）：**这个脚本名在 `feat/self-host-distribution` 上不存在**，
它是 main 那侧新增的（合并后的并集里才有）。"脚本不存在"与"门禁判红"在退出码上**完全一样**。
⇒ 用循环批量跑门禁时，`RC` 之前要确认那一档名字在本棵树上真的有；
空日志 + 非 0 不是"红"，是"没跑到"。其余四道（`gate-wiring` / `selfhost-entry-command` /
`script-snapshot` 31 枚 / `docs`）本分支上全 `exit 0`，新增那枚脚本没惊动任何一道。

#### ⑥ 同批落下的第二道闸门：跑链之前先问"载体的 `node_modules` 是不是当前那把锁装出来的"（提交 `1efc1cb0`）

这道不是"顺手多加一条"，是这一趟读出来的**下一个窗口风险**：第 1 族的重算只做 `reset --hard`，
**同步提交、不重装依赖**，而 `node_modules` 被 git 忽略、原地留着。main 只要动过
`pnpm-lock.yaml` 或 `e2e/pnpm-lock.yaml`，那一趟完整 `pnpm check` 就跑在上一把锁的依赖上 ——
响亮的那种（模块找不到）便宜，安静的那种（旧版本照跑照绿）贵。它与 §7 第 27 条
（APK 里是旧 JS bundle）、§8.111 ①（跑在旧载体上等于没跑）是同一个失效形态，只是这一枚落在依赖层。

物证不靠时间戳：pnpm 每次安装会把当次那把锁**逐字**复制成 `node_modules/.pnpm/lock.yaml`，
所以"装的时候用的是哪把锁"有磁盘证据。根与 `e2e/` **成对判**（`e2e` 刻意不在根工作区内、
自带一份 lockfile，见 `e2e/pnpm-workspace.yaml`）—— 只判一半就等于那一半没人守。

🔴 **这条判据的形状是被我今天一次实测的假读数逼出来的**：我先用 shell 量同一件事，
`set -- $pair` 没把两个路径拆开 ⇒ 两边 sha 都是**空串** ⇒ 打印出 `same=YES`。
"什么都没读到"与"两边一致"在输出上完全一样。所以本体里每一条都要求
sha 是 64 位十六进制、文件非 0 字节、**没有安装指纹按"判不了"退**而不是"新鲜"。

| 读数 | 现量 |
|---|---|
| 自检 | control + 五臂各按预期 + 真实腿 + 收尾复绿 ⇒ `rc=0` |
| 真实腿（分支检出） | 根 `lock=111cc2d1d04d(364423B) == installed(同)` · e2e `021a9df4add8(993B) ==` ⇒ 同源 |
| 消费方（落地体检第 3c 道） | `--carrier ffd421f2` 那趟打印 `✅ 载体的 node_modules 与当前那把锁同源 —— 根 0f3c1bf6d9e2(361300B) · e2e 021a9df4add8(993B)`；同趟另三条红是双亲过期 / 负载 58.77 / 检查被跳过 |
| 变异（摘掉"不同源记账"） | 臂 2 报 `换了 e2e 的安装指纹却仍判同源 ⇒ 这条判据没牙`，自检 `rc=2`；`cmp` 复原后回绿 |

本工具**不代跑 `pnpm install`**：那棵树的 `node_modules` 与并行那条线的打包共用，重装是有现场后果的动作，
必须由看清在场的人做（闸门只把两个 sha 和该跑的命令打出来）。

至此这一趟给落地窗口新添了两道自动消费的闸门：**载体是不是别人的现场**（`ec941cf8`，第 0a 步，退 6）
与**依赖是不是当前那把锁**（`1efc1cb0`，第 3c 道，sev 3）。两条都在**写动作或跑链之前**，
都不给绕过取值。

### 8.125 阻塞集归零了，落地体检现在**只剩负载一条**（2026-10-04 20:4x 现量，载体 `37a3af78`）

20:43 还是 4 枚，20:48 现量 **0 枚** —— 那四枚（`.gitignore` / `package.json` / 两份 i18n 词条表）被各自的所有者提交了，
主检出的脏条目同时从 166 掉到 **9**。这条变化值得单独一节：Goal 第 1 项的关闭判据从此**不再依赖别人的动作**。

落地体检整条 dry-run 的读数（`node research/tools/selfhost-land-main.mjs`，`DRY_RC=3`）：

| 那道 | 读数 |
|---|---|
| 载体重算 | ✅ `37a3af78 = main(e952b0e7) × feat/self-host-distribution(dec7be6f)`，**8 道纯 fs 门禁全 exit 0** |
| 并集 | scripts 键 **154** 个 · `check` 链段 main=82 本批=67 base=66 并集=**83**，摘段 **0/0** · 非 scripts 顶层字段比了 9 个，丢 **0** |
| 双亲 | ✅ 第一父就是当时的 main |
| 阻塞集 | ✅ 0 枚（夹具 5/5 ⇒ 这个"空"是可信读数；写集 56 枚 · 脏条目 9 枚） |
| 依赖同源 | ✅ 根 `0f3c1bf6d9e2(361300B)` 与 `node_modules/.pnpm/lock.yaml` 逐字相同 · e2e `021a9df4add8(993B)` 同 ⇒ **这一批 main 没动过任何一把锁，落地时不需要先 `pnpm install`**（第 3c 道今天给的是"通过"而不是"免检"） |
| 端口 | ⏭️ dry-run 不跑链 ⇒ 不适用（不适用 ≠ 通过）；现量四枚端口空 |
| 负载 | 🔴 **13.78 > 12** ⇒ 环境无效。这是**只剩的一条** |
| main 抢先 | ✅ `e952b0e7` 仍是当前值 |

冲突面同时重取（`merge-tree --name-only main 分支` ⇒ `rc=1`，**6 条**，逐条仍在预置八族内、`other=0`）——
这趟重算**真的走了**四道此前只在夹具上跑过的解法：审计文档并集、`package.json` 并集写回 + round-trip、
第七族取本分支侧、第八族取 main 为底 + 四处重放。**新落的两道闸门也在真实路径上过了一遍**
（载体在用者 `rc=0` 空闲 ⇒ 才敢重算；依赖同源判据第一次被消费方调到）。

🔴 **还剩的风险要说准，不是"万事俱备"**：完整 `pnpm check` 要几十分钟，而今天 main 的实际节奏是 1–5 分钟一笔
（`294bb83c→d2a4854a→58e43418→b0b82857→e952b0e7`）。最后一道"main 未被别人抢先"是在**跑完链之后**判的 ⇒
链跑多久，被撞的概率就有多大；撞了就退 1 不落地、重来一次。所以哨兵 v2 的开窗条件加了**第五条"main 连续两样不变"**
（`/tmp/g173-window2.sh`，`/tmp/g173-window2.log`，五件同时成立才 `WINDOW_OPEN`：阻塞集 0 / 负载 ≤12 /
那四枚端口空 / 载体空闲 / main 安静），并自带一条负载解析自校准（三位互不相同的合成样本必须读出第一位，
读错就 `PROBE_BAD` 退出，不拿 5 分钟那位当"现在很安静"）。
⚠️ 阈值一条没动、不硬跑；等满按环境无效收尾。

### 8.126 落地体检工具自己有两处"说的话和做的事不一致"，这一轮把它们量出来了（提交 `7a77422e`，2026-10-04 20:5x–21:1x）

上一轮把"只剩负载一条"写进 §8.125 之后，这轮是把负载那一档做硬，顺带撞出两个**这份工具自己的**缺陷。
两个都不是产品红，但都会让落地那一趟白跑或伤人。

**① `dry-run 不跑链` 这句是假的。** 第 3b 道闸门的跳过文案写着"dry-run 不跑链 ⇒ 这条今天不适用"，
而第 4 道（载体上完整 `pnpm check`）**没有对应的 `!CONFIRM` 守卫** —— 它只在 `fails.length` 时跳过。
于是"只体检"的一次运行会**真的**起几十分钟的链，而链里的 e2e 前置是按端口 SIGKILL 的：
3b 那道守卫在 dry-run 里被跳过，正好把唯一拦着它的东西也跳过了。
实测（21:0x）：控制臂（摘掉任何桩、同一份脚本）负载恰好读到 **11.29 ≤ 12** ⇒ 前置全过 ⇒
`   日志 → /var/folders/…/heyta-land-check.log` 真的打出来，链开跑了。我是在它跑起来之后发现的，
杀掉这一趟时那四枚端口**当时无人监听**（哨兵 21:04–21:05 记录的两枚监听者在 21:07 前已退出），
所以这轮没有造成实际伤害 —— 但那是运气，不是设计。修：第 4 道加 `if (!CONFIRM) skip(...)`，
并且末尾那条"完整 check 没有真的跑过"只在 `CONFIRM` 下判（否则 dry-run 会得到一条**永远不通过**的判据，
正是 §7 元规则 2 的反面）。
两条跳过文案不同 ⇒ 分支被真区分，读数：
- `MAX_LOAD=999` 的 dry-run：**3 秒**退 0，打 `⏭️ …… dry-run 不跑链（链里 e2e 前置会按端口 SIGKILL，体检不许有这种副作用）`；
- 同一条闸门在 `--confirm` + 故意过期的载体下打的是另一支 `⏭️ …… 没跑（前面已有 1 条不成立）`，退 1。

**② 它打印的落地命令在主检出里根本不存在。** 原话是 `cd <主检出> && node research/tools/selfhost-land-main.mjs --confirm`，
而这批 `selfhost-*.mjs` **一枚都不在 main 上**（现量：主检出 `research/tools/` 下 `selfhost-*` = **0** 枚，分支检出 11 枚），
`--confirm` 又必须在主检出目录里跑 ⇒ 照抄得到 `MODULE_NOT_FOUND`，而它的症状和"脚本坏了"分不开。
现在打印**本文件的绝对路径**并带引号（仓库路径含空格，裸路径粘进 shell 会拆成两个参数，那又是另一种假故障）。
落地那一趟因此应当这么起（这一句就是给下一轮的）：

```bash
cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta" \
  && node "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-selfhost/research/tools/selfhost-land-main.mjs" --confirm
```

**③ 负载档的新形状，四臂各有读数。** `--confirm` 要**连续三样** ≤ 阈值、两样之间真等 `LOAD_STEP`（默认 60s）：
`MAX_LOAD=999 HEYTA_LAND_LOAD_STEP=5` 下读到 `3 样都在 17.67/16.82/15.87`，整趟耗时 **11s**（两跳间隔 ⇒ 睡眠真的发生）；
`MAX_LOAD=0` 下拒绝腿写成 `第 1/3 样负载 15.87 > 0`（"要三样"这件事在拒绝文案里也看得见）。
探针两臂（临时桩 shadow `sysctl -n vm.loadavg`，其余参数透传真 sysctl）：非数字 `{ abc def ghi }` 与**空 stdout**
各 **exit 2** 并打 `第 1 样读不出数 ⇒ 判不了` —— 不拿"判不了"当"负载低"。
⚠️ 这两臂第一次是**假通过**的：桩文件用单引号 `printf` 写，落盘的是字面 `"\$1"`，sh 把它当两字符常量比 ⇒
桩静默走到 `exec /usr/sbin/sysctl`，那一臂量的是**真读数**（15.17）却报了"符合预期"。
改成写文件 + 每次先 `cat` 桩内容再跑（needle/转义同族的第三次，§8.46 与 §8.48 各记过一次）。
另一次读数丢失是同族的另一面：zsh 里 `${PIPESTATUS[0]}` 是空值 ⇒ 那两条 `B1_EXIT=`/`B2_EXIT=` 没量到码，
重跑用"先重定向到文件再 `echo $?`"才拿到 1（traps #184）。

**④ 新落的两道闸门第一次在真实时间线上响（不是夹具）**，见哨兵 `/tmp/g173-window2.log`：
21:04:07 `载体(rc3)=🔴 载体 /tmp/heyta-merge-carrier 此刻有 **17 个别人的进程**在用` ⇒ 重算被拒，一个字节没写；
同一行 21:04–21:05 的端口腿读到 `BUSY=4319/66242,4318/66259`（别人的 vite），21:07:08 清空后才放行。
这两条就是 §8.124 那两枚闸门要拦的东西，被哨兵在真实时间线上各抓了一次。

**⑤ 🔴 结构性发现：今天这个节奏下，"现算载体→现跑链→立刻 ff"不可能成功。**
`git log main --since="40 minutes ago"` 现量 **27 笔 / 平均间隔 85s / 最大间隔 525s**（21:00 取）。
链长没有计时读数（只知道它没在两分半内跑完 —— 13:0x 那一趟被我杀掉时仍在跑），
而 §8.125 记的定性是"几十分钟"。几十分钟 ÷ 85s ≈ 二十几笔，最大空窗 8.75 分钟 ⇒
**链必然横跨至少一笔新 main**，最后一道"main 未被别人抢先"退 1、整趟证据作废。
所以 21:08:39 那次 `WINDOW_OPEN`（阻塞集 0 / 负载 11.89 / 端口空 / 载体空闲 / main 连续两样不变）
我**主动放弃**了：第五条只观察约 90s，它开的是"**能起跑**"的窗，不是"**能跑完**"的窗；
而链跑完之后 main 已经不是开窗时那枚（现量 main 从 `e952b0e7` → `4a140cdd` → `c343b923` → `a244d24b`，
我这一个多小时里载体重算了四次，四次都是给一条过期链做嫁衣）。
剩下的那条**不是我能在本机造出来的条件**：要么等那条线的提交节奏停下来（协调项，不是负载项），
要么由人拍板换落地形状（"先 ff 再在 landed main 上取全链读数"，或让他们的合并把这批吸收掉）。
两种都要人/都要协调，因此这一轮只登记、不动形状 —— 阈值一条没改、链没抢跑、main 一个字节没动。

⚠️ 分支 tip 现为 `7a77422e`（§8.125 记的 `3610f422` 已过期）；载体 `ac7df765 = a244d24b × 3610f422` 也已过期，
落地那一刻仍要按 §8.16 现算。

### 8.127 跑链期间的看守（提交 `2f62ad94`），以及它第一次真腿运行抓出的 `-a`（2026-10-04 21:1x–21:2x）

§8.126 ④ 那两行哨兵读数（21:04 `4318/4319` 有人 → 21:07 空 → 21:13 又有人）说明了一件事：
**第 3b 道闸门的那一眼只在起跑之前判**。链要跑几十分钟，这期间出现的任何外来监听者
都会被链里的 e2e 前置 SIGKILL —— 也就是说：我保护自己的那条守卫，护不住整趟跑。

新装置 `research/tools/selfhost-kill-watchdog.mjs`（消费者 = `selfhost-land-main.mjs` 第 4 道，边跑边守）：

| 部件 | 判什么 | 判不了的时候 |
|---|---|---|
| 射程 | 端口集合来自 `selfhost-kill-ports.mjs`（不抄第二份） | `deriveKillPorts` 报错 ⇒ `blind()` exit 2，**不开跑** |
| 归属 | 该 pid 的**工作目录**在载体树里 ⇒ 自己的；否则 ⇒ 别人的 | 读不到 cwd ⇒ 记 `blind` 并**按触发处理** |
| 探针 | 问自己的 pid 要 cwd，必须逐字读回 `process.cwd()`（臂 8 阳性对照） | 自检不过 ⇒ 看守不开，直接中止 |
| 动作 | 外来监听者出现 ⇒ `child.kill('SIGTERM')`（5s 后 SIGKILL 兜底），链记 exit 3 | 保守方向：宁可白跑几十分钟，不拿别人的现场换我的读数 |

`--confirm` 下第 4 道因此从 `execFileSync` 改成 `spawn` + `await`（同步调用会把事件循环钉死，
`setInterval` 一轮回不来 —— 那才是这条守卫最安静的坏法：链照跑，看守从不执行）。
`gate()` 收集器同步改成 `async` + 七个调用点 `await`。读数里带**看守真判了几轮**
（`看守判了 N 轮`），因为"起了个定时器"和"它真的跑过"是两件事。

🔴 **夹具九臂全绿，真腿把装置自己的 bug 照出来了**：`lsof -p PID -d cwd` 不带 `-a` 时
把两个选择项按 **OR** 组合 —— 回的是"所有进程的 cwd ∪ 这些进程的任意 fd"，于是第一个 `n`
是系统守护进程的 `/`。实测：我自己 `spawn('sleep', …, {cwd: 载体})` 起的进程，`cwdOf` 读回 `/`。
这个 bug 的方向特别坏：它不会让看守失效，它会让看守**每次把自己那条链判成外来**，
于是 `--confirm` 在第 5 秒自我中止 —— 落地永远跑不起来，而症状看着像"守卫在起作用"。
⇒ 可迁移的形状：**归属类探针必须配一条问已知答案的阳性对照**（臂 8），
    夹具喂进去的 `cwdFor` 只能证明分类逻辑，证明不了那枚真命令的字段语义（`-a`、`-F`、`-d` 怎么组合）。
    lsof 的多选择项默认是 OR，`-a` 才是 AND —— 属于本仓反复登记过的"参数接住了但语义不是我以为的那个"那一族，
    这一条是它的新面目：**参数没拼错，组合语义拼错了**（`-p`/`-d` 都对，缺的是把它们连成 AND 的那个 `-a`）。

**验证读数**（都在这一轮取的）：
- 装置自检 `node research/tools/selfhost-kill-watchdog.mjs --selftest` ⇒ **rc 0**，对照 1 + 臂 1..9
  全过；臂 8 打印 `pid=39404 ⇒ …/heyta-wt-selfhost（与本进程 cwd 逐字相同）`。
- 真腿一次性测 `/tmp/g173-live-legs.mjs` ⇒ **rc 0**：L1 载体里的 `sleep` 读回 `/private/tmp/heyta-merge-carrier`
  （归一后与载体相等）；L2 在真端口 `:4322` 上起一枚非载体 cwd 的监听者 ⇒ `foreign=1` 并点名端口与 cwd；
  L4 `startWatch` 用真探针 ⇒ `onTrip` 恰好 1 次、被守的**子进程真的收到 SIGTERM**（`exit.sig=SIGTERM`）。
  收尾断言残留 sleep = 0 枚（装置自己起的进程自己收）。
- 反向臂：`HEYTA_CARRIER_WT=/tmp/g173-empty-dir … --confirm` ⇒ **exit 2** 并打
  `判不了射程：… 里没有 scripts/check-ai-e2e-preflight…`（目录不存在与目录空着两种都试了，各 exit 2）。
- 回归：`--selftest` 之后 dry-run 仍是 3 秒、链跳过、七道逐条出读数。
- `pnpm check:gate-wiring` 在加了新工具之后仍 ✅（64 道定义 / 67 段 / 链外 1 道有消费方 3 处）；
  `docs-link-check` ✅ 无死链。

⚠️ **这条守卫今天还没有它在真实链上的读数**：`--confirm` 需要几十分钟的窗口，而 §8.126 ⑤ 那个
结构性阻塞还在。它今天在真机上验过的是"判归属 + 杀子进程"这两件事，不是"一趟 30 分钟的链被它救了一次"。
写成待取，不写成已闭。
   ⚠️→ **2026-10-04 23:1x 就地更新（不删原句）**：那半句里"要几十分钟的窗口"混着两件事 —— 已拆开一半：
   "看守会不会中止"在 `--watch-leg` 三臂 + 两臂变异上取到了读数（§8.138），**仍然缺的是那一格时长**
   （一趟真 `pnpm check` 被它守完整跑完）。所以这条从"完全没读数"改成"机制有读数、时长没读数"，不写成已闭。

🔴 顺带一条 item 1 的现量更新：21:08 报的"阻塞集 = 0"在 21:2x **又回到 1 枚**（`package.json`，
别人的未提交改动）。所以落地那一刻的三条待条件仍是同一形状：**阻塞集归零 + 负载连续三样 ≤12 +
main 在整趟链里不动**，而第三条今天有读数支撑的结论是"在当前节奏下拿不到"。

### 8.128 等窗口这段时间做的两件事：把"今天新加的文件会不会在落地那一刻撞红"量掉，把"链要多长"变成一条会自动交数的读数（提交 `25799540`，2026-10-04 21:2x–21:3x）

§8.127 那条守卫改的是第 4 道的执行方式（`execFileSync` ⇒ `spawn` + `await`），而**合并载体上跑的
是 main 版的那三道 fs 门禁**（`check:script-snapshot` / `check:md-tables` / `check:gate-wiring`），
它们和我今天新加的两枚 `research/tools/*.mjs`、以及台账里新增的那张表，第一次相遇就是在落地那一刻。
窗口很贵，所以先在合并态把它们各跑一遍（全部只读，不写盘）：

| 在合并载体 `4619ca26 = main(74b3b566) × ad76332a` 上跑 | 结果 | 现量 |
|---|---|---|
| `node scripts/check-script-snapshot.mjs --check` | ✅ rc 0 | 「自快照 bootstrap 全部在位（**40 个脚本 + .gitignore**）」——新加的两枚工具不在它的扫描集里，不会要求重生成快照 |
| `node scripts/check-md-table-rows.mjs` | ✅ rc 0 | 「9 个文件，列数、断行与"是不是表"都一致」；🔴 **本台账不在那 9 枚里**（现读 `const FILES`，不靠 §8.88 那句记忆）⇒ §8.127 新加的那张 3 列表没被它判过，也不会因为它而红 |
| `node scripts/check-gate-wiring.mjs` | ✅ rc 0 | 「门禁定义 **80** 道 ｜ 链里被引用 **83** 段 ｜ 链外 **1** 道（允许表 1 道）」，链外那道逐条有消费方（`check:web-artifact:app` ← runbook 2 处 + `server/Dockerfile` 1 处）|

⇒ 这一轮**不欠任何"落地时才发现的红"**：今天加的是工具与台账，进不了这三道的扫描集，也不改链段集合。

🔴 **"链要几十分钟"到今天为止是一条没有计时读数的断言**，而 §8.126 ⑤ 那个结构性结论恰恰要靠
两个数才能说出口：链长 vs `main 平均 85s 一笔`。第 4 道现在给三条出口都打了时长
（`看守判了 N 轮 · 用时 Ns` 出现在全绿、`rc≠0`、以及被看守中止那三条读数里）——
下一次真窗口自动交数，不需要谁事后补测；红的那一趟和被中止的那一趟**同样**要有时长，
那才是"需要多长的静止窗口"的下界。

臂（一次性副本 `research/tools/g173-copy-arm.mjs`，跑完即删；四处替换都带命中数断言）：
链换成 `sh -c 'sleep 3; exit 7'`，阻塞集与端口腿喂 stub，其余腿（含载体双亲对上）**保留真实判定**。
实际跑了那一支得到：

```
🔴 载体上完整 pnpm check —— rc=7 ⇒ **不落地**。…
   看守判了 1 轮 · 用时 3s
🔴 体检未过：1 条不成立，按最严重那一档退（载体上完整 pnpm check ⇒ exit 4）
main 未动=YES      # 副本只可能跑到 merge 之前：rc≠0 ⇒ fails 非空 ⇒ 那条 git merge 不执行
```

⚠️ 这条臂证明的是**计时表达式与 `wd` 三段出口都被真跑过**，不是"链跑过了"——链本身仍等真窗口。
另外它第一次跑**没跑到那一支**：我从 `✅ 载体 <sha>` 那行用 `awk '{print $2}'` 取号，取到的是汉字「载体」
⇒ 传了个假 SHA ⇒ 第 1 道拒 ⇒ 第 4 道按设计跳过。**跳过的读数长得像跑过的读数**，靠的是逐行看输出而不是退出码才发现。

两个方向各有读数（免得把"这次没触发"读成"它不响"）：那一臂期间端口**确实**是空的
（同刻 `lsof` 对这四位回 0 行，装置自己再判也是 `{ours:[],foreign:[],blind:[]}`）；
触发方向由 §8.127 的真腿 L2/L4 证过（在 `:4322` 真起一枚外来监听者 ⇒ `onTrip=1`、被子守的子进程收到 SIGTERM）。

⚠️ 分支 tip 现为 `25799540`；载体 `fb68cdc5`（建在 `ad76332a` 上）又过期了 —— 落地那一刻仍按 §8.16 现算，
这一条从 §8.126 起每个数字都在告诉我：**它不是待办，是这条线自己的提交节奏**。

### 8.129 落地前的归属快照：main **自己**今天在这些段上是什么颜色（2026-10-04 21:3x，一次性临时 detached 树）

§8 的关闭判据是"每一枚红仍可归属到非本批"，而这件事可以在等窗口的这段时间先做掉一半：
把**对外文案那几段**（不需要依赖、不需要构建的门禁）在 main 自己的树上跑一遍。
做法是 `git worktree add --detach /tmp/g173-main-probe main`（临时树，跑完 `worktree remove`，
主检出与我自己的工作树一个字节没动），逐条读 `package.json` 里该门禁用的是哪个实现文件再跑。

| 段（main 版实现，main 版内容） | rc | main 自己打出的最后一行 |
|---|---|---|
| `check:docs`（`research/tools/docs-link-check.mjs`） | 0 | ✅ 无死链、无"本机有仓库里没有"的链接、无失效章节引用、无失效锚点 |
| `check:selfhost-entry-command`（本批那条入口命令对账） | 0 | `docs/research/self-host-distribution-audit.md：**故意排除** 1 条…正是 §8.11 记的那条旧命令` |
| `check:server-design` | 0 | ✅ 已写入 `server/src/design.generated.ts`（颜色 16 / 尺寸 23 / 字体 2）← 🔴 见下，这行本来不该出现 |
| `check:legal-tools` | 0 | ✅ 本机接口工具表对账通过：目录 26 条 == 中文表 == 英文表，且中英逐行同序 |
| `check:md-tables` | 0 | ✔ 9 个文件，列数、断行与"是不是表"都一致 |
| `check:script-snapshot` | 0 | ✅ 自快照 bootstrap 全部在位（40 个脚本 + .gitignore） |
| `check:gate-wiring` | 0 | ✅ 链与门禁定义对上了（链外 1 道有可验消费方） |
| `check:claims` | 0 | ✅ 6 个平台都能在 roadmap 里找到对应条目 |
| `check:legal-copy` | 1 | 🔴 **不是产品红也不是 main 的红**：`Cannot find module`（临时树没有 node_modules）⇒ 这一条判不了，别记成"main 在这里红" |

⇒ 对 item 1 的实际意义：**main 今天在"对外文案/结构类"段上是全绿的**，
所以落地那一趟若出红，先怀疑的是需要依赖与构建的段（`typecheck` / `-r test` / 三段 e2e），
不是这批自己改过的那些句子。这条快照省掉的是"红了一起怀疑到本批头上"的那段归因工作。

🔴 两条探针自己的问题，都在这趟里被抓出来（比上面那张表更值得留）：

1. **门禁用的是哪个文件，要从 `package.json` 现读，不能从门禁名猜。**
   我先写了 `scripts/${g#check:}.mjs`，于是 `check:md-tables` 被拼成 `scripts/md-tables.mjs` ——
   **八条齐刷刷 rc=1**，而末行都是 `Node.js v22.22.0`（崩溃栈的最后一条），不是任何产品的判红。
   形状和 §8.101 那次 zsh 不词分割导致的"三腿全红 127"是同一族：**一片红先看它们共享的那层**。
2. **正则只取 `node <路径>` 把参数丢了**，于是 `… gen-server-design.mjs --check` 变成了**没有 `--check` 的生成**——
   我以为在跑只读检查，实际跑的是写盘。临时树里 `git status --porcelain` 是空的，
   说明生成的内容与提交物逐字相同才没留下痕迹 —— **那是运气，不是我的探针有边界**。
   **参数不是修饰符，`--check` 就是那条命令的语义本身**。
   下一轮在任何真实树里跑门禁一律走 `pnpm run <gate>`（由 pnpm 自己带参数），
   要直接调实现文件就必须把整行参数原样抄过去。

### 8.130 「可安装」那句在**发布层**的复验 —— 上一趟那个 0 是探针打在了不含这句的载体上（2026-10-04 21:3x–21:4x）

本条只读、不起浏览器、不动任何工作树。起因是我想用一次纯 HTTP 读去复核 §8.123，
`curl https://heyta.waytofuture.cn/` 之后数 `可安装` 得 0 —— **那个 0 当场没有被采信**，
理由是落地页是 Vite SPA、HTML 只是壳。这一节把"换成真载体之后到底是不是 0"量完。

#### ① 载体的形状：这句既不在 index.html，也不在主 bundle，而在**按 locale 动态加载的 chunk** 里

```
HTML=200 size=7022            → 可安装=0  安装=0            （index.html 是 gen-entries 生成的壳）
main-CoyMNTqu.js  848654 B    → 可安装=0  完整产品=0  不是演示=0     ← 整组营销文案都不在这里
                              → 对照：本地优先=11  端到端=25  滴答清单=1  ← 别的中文文案确实在这里
主 bundle 里挖出的 chunk 名：SyncScene-BaoDr3vy.js / three-E1hU0WNZ.js / zh-CN-dEIblZKL.js / en-lYAaj_gJ.js
```

⚠️ **同一枚 needle 打在错的载体上会读出 0，而那个 0 和"这句已经走了"在输出上长得一模一样** ——
这是"假 0"那一族的第五种面目（前四种：探针坏→空 stdout 当"没人用"、`Number('')===0` 当"负载低"、
两边都空⇒"相同"、§8.129 那种按门禁名推实现路径）。差别在于前四种是**探针坏了**，
这一种是**探针没坏、但它量的不是装着被判断对象的那一层**。

#### ② 现量（2026-10-04 21:41，真载体 = 两枚 locale chunk，各 250274 / 261407 B，HTTP 200）

| 载体 | 旧句 needle | 新句锚点 |
|---|---|---|
| 线上 `zh-CN-dEIblZKL.js` | `可安装`=1 `完整产品`=1 `可离线用`=1 | `断网也能照常记`=**0** |
| 线上 `en-lYAaj_gJ.js` | `Installable`=1 `The full product`=1 `not a demo`=1 | `keeps working when you are offline`=**0** |

原文逐字（从 chunk 里 `grep -oE 'site\.platforms\.web\.body.{0,140}'` 取）：

```
"site.platforms.web.body":"完整产品，不是演示。可安装、可离线用，数据就存在你的浏览器里。"
"site.platforms.web.body":"The full product, not a demo. Installable, works offline, and your data lives in your own browser."
```

与 `main:packages/i18n/src/locales/zh-CN.ts:3310`、`main:packages/i18n/src/locales/en.ts:3081` **逐字相同**
（行号现取；main 此刻 `e088c92f`）。⇒ **§8.123 的结论在发布层复验成立**：那句对外错话今天仍在生产上，
缺的仍然只是"落地 + 从落地后的 main 重发"这两件有主的事，没有第三件。本条**不主张任何一句已被解决**。

#### ③ 这组 0/1 不是"探针恒 0"也不是"探针恒 1"：同一枚探针喂分支产物做反向对照

```
本地 apps/landing/dist/assets（分支已按"摘掉整条安装承诺"重打的那份产物）：
  zh-CN-Ds4-fmdC.js   可安装=0  断网也能照常记=1  完整产品=1
  en-DTpLKdU2.js      Installable=0  keeps working when you are offline=1  The full product=1
```

⇒ 正向腿（新句锚点）在分支产物上=1、在线上=0；负向腿（旧句）在线上=1、在分支产物上=0。
**两腿各自都会变色**，所以 ② 的读数属于站点，不属于探针。
⚠️ 顺带记一条选 needle 的规则：`完整产品=1` 在**两边都=1**（新旧句共享前半句）—— 它**不能**当判据 needle；
能区分两个状态的只有「可安装 / 断网也能照常记」（及英文那两个）这两个 token。
`live-install-claim.spec.ts` 现在用的正是这一对，选得对。

#### ④ 落笔纪律：这条只是哨子，不是判据的第二个所有者

上面那串 curl 可以留作"重发之后先廉价看一眼"的手艺，但**不要把它抄成脚本再挂一条常驻门禁** ——
判据本体仍然是 `e2e/live-site/live-install-claim.spec.ts`，它量的是**渲染后的 DOM**，
并且带一条 `body.length > 0` 的"正文不许是空串"断言专门防"页面被兜底成壳 ⇒ `not.toContain` 无条件成立"。
给同一个判断造第二份抄件就是 §8.122 那一族。任务 #20 的收口动作不变：
**重发后复跑那条用例取绿（zh-CN / en 两条）+ 两张 `platforms-web-card-*.png` 给人看**。

#### ⑤ 待入 traps（按主检出工作树取号 **#271**；该文件此刻是 `M`，主检出另有 15 枚别人的脏文件 ⇒ 不往里插行）

建议措辞：**"某句对外文案还在不在"要按该文案真实的加载载体数 needle** —— Vite SPA 的 index.html
与主 bundle 都可能 0 命中而 locale chunk 是 1；同一枚探针必须喂一份"已知含此句"和一份"已知不含此句"
的产物做双向对照，单侧 0 不构成结论。（与第 82、170、197 条同族：**判据的颜色取决于它打在哪一层，
而不是取决于被判断的那件事。**）

#### ⑥ 同趟顺手读到的落地前置（不新开判据，只记瞬时值）

哨兵 `/tmp/g173-window3.log` 到 21:41:06：`负载=9.19` —— 今晚**第一次**读到 ≤12，
但同一刻 `端口=BUSY=4319/50329,4318/50359`（别人的 e2e 在跑）、`main` 两分钟内动过两笔
（`74b3b566 → 83359555 → e088c92f`）、`阻塞集=1`。⇒ 五条件仍不成立，继续等；
这一趟没有为"挤进去"改任何阈值。

### 8.131 发布层逐个 needle 的对账：入口命令那一份**不在**错话清单里，「可安装」那一份在（2026-10-04 21:44）

§8.130 定位到"对外文案住在 locale chunk"之后，同一趟把**外人照着敲的那一份**（站内自建指南文章）
也按 needle 逐条量了。载体就是 §8.130 ② 那两枚线上 chunk（`zh-CN-dEIblZKL.js` / `en-lYAaj_gJ.js`），
对照真值取 `main:packages/i18n/src/locales/{zh-CN,en}.ts`（main 此刻 `e088c92f`）。

| needle | 线上 zh | 线上 en | 判读 |
|---|---|---|---|
| `-f docker-compose.build.yml` | 1 | 1 | 入口命令的三份 override **在线上就是全的** ⇒ 指南文章这一处不是对外错话（任务 #15 / G-49 那条对账的线上侧） |
| `-f docker-compose.migrate-once.yml` | 1 | 1 | 同上，一次性迁移那一份也在 |
| `supersync-migrate` | 2 | 2 | 服务名的两处说明都在（§8.130 之后这条顺手读，未另设判据） |
| `git clone` | 0 | 0 | ⚠️ 这个 0 **有正证**，不是够不着：`main` 两份词条表 `grep -c -F 'git clone'` 各 = 0，本分支也 = 0 ⇒ 文章里本来就没有"克隆源码"这一步的命令行 |
| `可安装` / `Installable` | 1 | 1 | §8.130 ② 的那句旧承诺，位置在**营销卡**（`site.platforms.web.body`），指南文章那一份里没有它 |

⇒ **对外错话清单此刻在发布层的读数只有两处**，且都排在同一件有主的事后面：
① 「可安装 / Installable」那句（§8.130）；② 同一条页上那条三栏排错的「未签名」提示（§8.123 ②）。
入口命令那一份**不在这个清单里** —— 这条要写明，免得下一读的人把 #15 那个 ✅ 读成"线上命令还是旧的"。

🔴 **本趟我自己又造了一次假 0，形状和 §8.130 不同**：第一趟用的是"上下文窗口正则"
`"[^"]{0,40}(docker compose|git clone)[^"]{0,200}"`，只回 2 条，看起来像"整条长命令没上线"。
真实原因是 `site.docs.selfhost.s7p2` 那条长句里，**从开引号到第一个 `docker compose` 已经远超 40 字符**，
窗口装不下 ⇒ 整句被静默剔除。按整串命令字面量 `grep -o -F` 重数才拿到 1/1。
⇒ 可迁移的规律（并进 §8.130 ⑤ 那条待入 traps #271 的措辞）：
**数长句里的字面量要用 `-F` 整串，不要用"关键字前后各取 N 个字符"的窗口正则** ——
窗口正则的 0 命中默认是**探针的属性**，不是内容的属性。
（同一族的第三种面目：① needle 不在这一层、② 窗口装不下、③ 真值本来就没有 ——
三者都打印 0，区别只在**有没有为这个 0 单独取过正证**。）

### 8.132 G-60 就地关掉：线上把清单当 `octet-stream` 给出去，修在生产、判据在 live-site，牙是用旧域名咬出来的（2026-10-04 21:5x）

§8.130/§8.131 那趟顺手量的，本条把它做完。任务 #33（G-60）从"缺判据"进到**已修 + 已有判据 + 已有红臂**。

#### ① 现量与根因（一次 curl 就够，零 CPU 竞争）

```
/app/manifest.webmanifest   200  application/octet-stream        2361 B   ← 修前
/app/manifest.webmanifest   200  application/manifest+json       2361 B   ← 修后（同一枚 curl）
/app/sw.js                  200  application/javascript         16381 B
/app/icons/icon-192.png     200  image/png                       3267 B
/app/manifest.json          200  text/html 1361 B  ← 未命中被 try_files 兜底成应用 HTML，**状态码是 200**
```

根因与 §7 那条 `.wasm` 是**同一个根因的第二次**：这台机器的 `/etc/nginx/mime.types`
（nginx/1.18.0 Ubuntu）里既没有 `wasm` 也没有 `webmanifest`，缺条目就一律 `octet-stream`。
`/etc/nginx/sites-available/heyta.waytofuture.cn` 里 `.wasm` 那段（100–113 行）把修法写得很清楚，
我照它的形状做：**`include /etc/nginx/mime.types;` 之后再补自己的 `types {}`** ——
因为 **`types` 在嵌套层级是替换继承、不是叠加**，只补一条会把同一段里的 `.js`/`.css`/`.png`
一起打回默认类型（那段注释自己写着"模块脚本直接不执行"）。

#### ② 凭什么值得动生产：把"挡不挡安装"和"一致性"分开说

浏览器（Chromium 口径）的安装性判据里**没有 content-type 这一条**——我读了 MDN 的原文，
它列的是 HTTPS + 清单里 `name`/`short_name`、`icons` 含 192 与 512、`start_url`、`display`、
`prefer_related_applications` 不为 true。⇒ **这条不是"用户装不上"那一类**。
它真正的价值有两条，都写在配置注释里：
1. **对外一致性**：自托管那侧的验收用例（`e2e/selfhost-stack/selfhost-web.spec.ts:220`）断言 `application/manifest+json` 且**是绿的**，
   也就是说外人自建的那套与我们托管的这套在同一个文件上给了两个答案；用户照我们的文档排查时会撞见"我这边和官方那边不一样"。
2. **它属于"不报错就不管、打开面板才看得见"那一族**（`.wasm` 那次的原话），而那条当时也真被修了。

线上清单的**内容**顺手也核了一遍（同一枚 curl，纯读）：`name=heyta`、`start_url="."`、`display="standalone"`、
图标 3 枚含 `192x192` 与 `512x512`（另有 maskable 一枚）、无 `prefer_related_applications` ⇒ 安装性的**清单侧四条 criteria 在线上齐**。
🔴 这句**不等于**"PWA 可安装已被证明"（台账 6785 行那条纪律仍然成立：既有用例判的是资产真身 + SW 注册激活，
`beforeinstallprompt` 那一发至今没有读数）—— 摘掉那句对外承诺的裁决**不变**，本条不翻案。

#### ③ 变更流程照 §3.7.x 那条纪律走（备份 → 改 → `nginx -t` → reload → 复验）

```
备份  /etc/nginx/sites-available/heyta.waytofuture.cn.bak-g60-20261004T135239Z
插入  15 行（diff 实测：只插入、删除 0 行）→ 全落在 location /app/ 内
闸门  nginx: configuration file /etc/nginx/nginx.conf test is successful ⇒ RELOAD=done
复验  ①上面那五行全部符合预期；/app/ 的 Cache-Control: no-cache 仍在；
      落地页 / 与 /en/ 与 /legal/terms/ 三个载体类型未变；/health 200；og-card.png 200 image/png；
      落地页 HTML 里旧域名命中 0
回滚  sudo cp …/heyta.waytofuture.cn.bak-g60-20261004T135239Z …/heyta.waytofuture.cn && sudo nginx -t && sudo systemctl reload nginx
```

⚠️ 一处**我自己写过头、当场改掉**的话：runbook 初稿写"旧域名那份没补这两条、回滚会把两处带回来"。
实测是 `heyta.finlaw.cloud` 那份**有** `application/wasm`（70–82 行）**只缺** `webmanifest` ⇒ 已改成只主张后者。

#### ④ 判据（`e2e/live-site/live-manifest.spec.ts`，提交 `a0d733ff`）与它的牙

三条用例、`request` fixture（不启浏览器，整趟 **726ms**）：
- 第一条：类型 + 清单内容四条 criteria 逐项点名（防"清单能解析"被读成"清单够了"）；
- 第二条是**两腿**：同一段 `servedAsManifest()` 分别喂真清单（必须 true）与 `/app/site.webmanifest`
  （它被 SPA 兜底成 HTML、**状态码 200**，必须 false）⇒ 挡死的正是"拿状态码当存在性判据"那一族；
- 第三条的枚举源是**清单自己**（`icons[].src` 逐条去取，相对 `/app/` 解析），不是我抄的一张名字表；
  并带一条"点名表不许为空"的前置（空表会让遍历静默不执行 = 一条永远不会红的判据）。

```
线上（修后）            3 passed (726ms)                                    MANIFEST_RC=0
旧域名 heyta.finlaw.cloud（同一份判据、未改一个字）  2 failed / 1 passed      ARM_RC=1
   Error: 清单要由服务端以 application/manifest+json 给出（实际 content-type="application/octet-stream"）
   ✘ 第一条  ✘ 第二条的正向腿   ✓ 第三条（图标与 SW 在两个域名上都正常）
```

⇒ 这条判据能失败，**不是靠改断言证明的，是靠一台真在生产上、恰好没补这条类型的服务器证明的**；
而第三条在红臂里仍然通过，说明它抓的是"清单类型"这一处，不是"整站都红"。

#### ⑤ 一条**当场撤回的假设**（留着，因为它差点变成一条错话）

我看到 `location /app/` 用 `alias /var/www/heyta-app/` 时，判断"本批把前端产物搬进了服务端镜像
（`server/src/web-app.ts` 那一路），线上还从磁盘目录取 ⇒ 这是一处新的对外错话"。
现量否证：运行手册 §3.3.1 / §3.7.2 自己写的托管路径就是 **`HEYTA_WEB_BASE=/app/` 构建 + `check:web-artifact:app` 对账 +
rsync 到 `/var/www/heyta-app/`**（第 479–487 行三条命令），磁盘 mtime `2026-10-03 18:13` 与它一致；
`server/public/` 那一路是**自托管**载体的形状，不是我们这套 nginx 的。⇒ **生产与它自己的文档一致，那句"错话"不成立，已撤回**。
教训形状：**"我看到配置与代码不一致"要先去读运维事实那份文档，再宣布错话**（否则我自己就是那个制造错话的人）。

#### ⑥ 顺带两条运维事实（下一条会话别重新推导）

- 🔴 `e2e/live-site-results/` 是 **gitignore 的**、且 Playwright 每次运行开始会删建 outputDir。
  §8.123/§8.130 引的那两张 `platforms-web-card-*.png` 因此**不入库**。跑任何 live-site 用例前先 `cp -a` 走：
  本次备份在 `/tmp/g180-live-evidence-pre-20261004T135635Z`（md5 `e8506c6f…` 与原文件逐字节相同），跑完拷回。
- 门禁名不要按印象调文件：我先跑 `node scripts/docs-link-check.mjs` 与 `check-md-tables.mjs` 各得 `rc=1`，
  那两条是 **`Cannot find module` / `Missing script`**，属"判不了"，不是红。改走 `pnpm run check:docs`
  （实现是 `research/tools/docs-link-check.mjs`）得 **rc=0 ✅ 无死链**。`md-tables` 那个键名在本仓库不存在，
  真名待查——**不写成"这道门禁没了"**。

#### ⑦ 对外错话清单的最新读数（本条之后）

发布层剩 **1 处**：「可安装 / Installable」那句（§8.130），加同一条页上三栏排错的「未签名」提示（§8.123 ②，同一根因）。
两者的关闭动作仍然只有一个：**落地 + 从 landed main 重发落地页**（任务 #19/#20/#21）。
G-60 这一处已从清单里出去（修在生产、判据已挂 live-site、红臂已取）。

### 8.133 G-58 的断言要改精确：那张图里印的不是「可安装」，是**更早一代**文案（2026-10-04 22:0x，人眼复核）

§8.130/§8.131 那两趟把发布层的文案对账做完之后，回头核 G-58（已入库的
`screenshots/landing/*.png` 仍印着摘掉的安装承诺与旧域名）。台账里的措辞是"仍印着**那句**承诺"，
而"那句"在前文一直指「可安装」——**这个 needle 选错了**。按 §6.2 规定一（人必须真的打开图看）
读了 `screenshots/landing/L03-平台.png`（文件 mtime `2026-10-03 10:04`，102193 B）：

| 图上读到什么（逐字） | 与三个文本载体对照 |
|---|---|
| Web 卡正文：`完整产品，不是演示。安装为 PWA 后可离线使用，数据存在浏览器本地的 SQLite（OPFS）。` | 🔴 **既不是 main 的「可安装、可离线用」，也不是本批的「断网也能照常记」** —— 是**更早一代**的措辞 |
| 验证方式：`https://heyta.finlaw.cloud/app/` | ✅ 旧域名，G-58 这半条**成立**（当前 canonical 是 `heyta.waytofuture.cn`，见 §3.7.2） |
| Android 卡：`真机跑通：…四款桌面小组件代码齐备，但真机验收尚未做；当前签名不是发布配置。` | 与本批裁决一致，不是错话 |

⇒ **同一句对外文案今天有第三代际同时存在**：图片（第 0 代）→ `main` 词条（第 1 代，线上正在渲染）→
本批分支词条（第 2 代，未落地）。这本身不奇怪（图是 10-03 打的），但要紧的是**判据形状**：

🔴 **谁将来拿「可安装」当 needle 去扫这批截图，会扫出 0 命中并宣布"图没问题"。**
截图的复验 needle 必须是**这一族的全部三代措辞**，或者干脆按"这张卡有没有在安装承诺"来判
（`安装为 PWA` / `可安装` / `Installable` / `works offline` 任一命中即算待重截），
而不是拿当前那一代的字面量去比 —— 与 §8.131 那条"窗口正则装不下"同一族：
**needle 选错，0 命中就会伪装成"已解决"。**

处置（不改裁决，只改措辞与判据形状）：
- G-58 仍然排在**落地 + 重发之后**那一趟（与 G-57 的 `screenshot:capture` 复跑、任务 #20/#21 同一趟），
  因为现在重截只会截到 main 的第 1 代文案，重发后又要再截一次；
- 任务 #30 的描述已改成按"三代措辞任一命中"来判，避免下一读的人拿错 needle；
- 台账里"仍印着那句承诺"这类措辞自本条起以本节为准（原句留在 6761 / 7546 行旁，不删，因为
  "登记过一条不够精确的断言"本身也是要留的现场）。

### 8.134 落地范围被重新量过：差额 151 笔 / 58 个文件，而目标点名的 5 枚重叠只剩 3 枚（2026-10-04 22:1x）

触发点是给八项做"五栏证据"对账（设计／生产接线／失败与恢复／平台验收／当前产物）时，
第③类报出一处我自己写的断言已经否证不了：**§8.31 说"整条分支是 main 的祖先、本批没有任何一笔还留在外面"**，
而 §8.125–§8.128 全程还在等落地。两句不可能同时为真，所以先去量，不先改口径。

#### ① 现量（全部可重跑）

```
git merge-base main feat/self-host-distribution            = b850b1c6（10-04 01:45）
git merge-base --is-ancestor feat/self-host-distribution main → rc=1     ← 分支不是 main 的祖先
git rev-list --count main..feat/self-host-distribution     = 151        ← 还没落地的笔数
git rev-list --count feat/self-host-distribution..main     = 656        ← 分支落后 main 的笔数
git ls-tree -r main research/tools | grep -c selfhost      = 0
main 上有：scripts/verify-selfhost-stack.sh ✔   scripts/check-selfhost-entry-command.mjs ✔
main 上无：research/tools/selfhost-land-main.mjs ✘
```

⇒ 02:09 那两笔 merge（`9a61a88a` / `7bac538b`）带进来的是**当时的分支头**，之后分支又走了 151 笔。
**"已经落进 main"从今天起只对那一刀成立**，不能再当第 1 项（#7 合并落地）的关闭依据。
两处断言已**原地划线**（§8.31 内 10-04 更正，原句保留在旁边）；任务 #7 的标题"已由并行会话完成"是同一句话的另一副面目，已改挂到本条。
⚠️ §8.31 的**标题本身没动** —— `check:docs` 会验"失效章节引用/失效锚点"（本趟 rc=0 的输出里就有这句），
改标题的代价是别处的引用跟着失效；更正放在标题下第一行，不另起一节藏起来。

#### ② 差额 58 个文件按"落地时谁会吃它"分类（数字现量，不手抄）

| 枚数 | 类别 | 含义 |
|---|---|---|
| 21 | `research/tools/` | 落地工具与闸门本体（含 `selfhost-land-main.mjs`）⇒ **main 上一枚都没有**，这就是 §8.126 那条"落地命令必须写分支绝对路径"的根因 |
| 8 | `server/` | `Dockerfile`、三份 compose、`package-lock.json`、`image-npm-tree.json`、`env.example`、`README` ⇒ **G-47 的镜像依赖树与安装契约都还没进 main** |
| 6 | `apps/landing/` | 含那条三栏排错的 `styles/landing.css` 修复与两个测试 |
| 6 | `e2e/`（live-site 3 + landing 3） | 线上判据（含本趟新增的 `live-manifest.spec.ts`） |
| 4 | `scripts/` | `verify-selfhost-stack.sh`、`check-gate-wiring.mjs`、`screenshots/` 两枚 |
| 3 | `docs/` | 台账 + 两份 runbook |
| 3 | `e2e/selfhost-stack-results/` | 三枚证据 PNG |
| 2 | `packages/i18n/src/locales/` | **界面文案（含摘掉「可安装」那一代）⇒ 会烘进产物** |
| 2 | `packages/{shared-schema,sync-core}/package.json` | 包元数据 |
| 2 | 根文件 | `package.json`（链定义）、`.gitignore` |
| 1 | `.github/workflows/heyta-server-image.yml` | CI |
| **0** | **`apps/web/`** | ← 关键，见 ④ |

#### ③ 目标第 1 项点名的 5 枚重叠文件，逐枚现量"还在不在差额里"

```
docs/README.md                       否   ← 已不再是撞车面
package.json                         是
packages/i18n/src/locales/zh-CN.ts   是
packages/i18n/src/locales/en.ts      是
scripts/check-script-snapshot.mjs    否   ← 已不再是撞车面
```

⇒ **撞车面从 5 枚降到 3 枚**，而阻塞集现量只有 1 枚（`package.json` 被别人未提交的工作树压着）——
词条那两枚此刻在主检出是干净的。这条改变了第 1 项的形状：
**只剩一枚文件挡在"等别人提交"那一档**，其余前置（负载／端口／main 静止）都是环境给的，
而 §8.126 已经用数字量过它们为什么凑不齐（main 平均 85s 一笔 vs 链要几十分钟）。

#### ④ 顺带把第 8 项的理由换掉（结论不变）

`apps/web` 命中 0 ⇒ §8.31 那句"本批改过 `apps/web`，所以 reinstall:all 必须排在落地后"里，
**apps/web 那一刀其实已经落地了**。但差额里仍有两份词条表与落地页 ⇒
**今天重装出来的四端不含本批的文案修正**，所以排序结论不变、**理由从"apps/web"换成"词条"**。
（已在 §8.31 原地划线更正，不另写一份。）

#### ⑤ 五栏对账里仍然真缺的格子（不粉饰，逐条给取法）

1. 第 1 项「当前产物」：落地没发生 ⇒ 天然为空，**不是漏**。
2. **G-61（新登记，待拍板 → 三档现全有裁决：①=§8.160 落成会红的 R9、②③=§8.176 判"不做 / 落地后做"）**：`pnpm verify:selfhost-stack` **不在任何自动链里** —— 现量：
     `package.json` 的 `check` 链（取法：`node -e 'JSON.parse(require("fs").readFileSync("package.json")).check'`；
     这里原先写的是"第 55 行那条"，而它今天已经是 `:66` —— 那正是 G-66 讲的行号引用会漂的形状，所以换成命令）不含它，两个 workflow 里只有注释级提及
     （`.github/workflows/heyta-server-image.yml` 的说明行）。也就是说第 2 项那条"真镜像 + 真服务端 + 真浏览器"的验收
     是**人跑一次**的验收，不是门禁：它红了不会挡住任何一次提交。
     为什么不默认挂链（这是裁决，不是拖延）：它要真构建镜像并起 Docker 栈，挂进 `pnpm check`
     会把整条门禁变成几十分钟，而且它自带负载门（等满 exit 3）—— 一个"经常因为环境无效而红"的段挂在必过链上，
     下一位会去调低阈值，那比没人跑更贵（§8.118 与记忆「设备验收自带负载门」同一族）。
     **要人拍的三选一**：① 保持人跑（现状，但要在 runbook 里写明"每次改了 server/Dockerfile 或 compose 必须跑一次"）；
     ② 挂进**发布前**那道（`scripts/verify-*` 串）而不是 `pnpm check`；③ 拆成"纯静态的镜像契约对账"进链（`check:image-*` 那三道已经是这个形状）+ 真跑留给人。
     取法（现量命令）：`grep -n '"check":' package.json` 与 `grep -rn verify:selfhost-stack .github/workflows/`。
     ✅ **①档已做（10-05 02:5x，§8.160）**：义务写进 `docs/runbooks/local-server-verification.md`，
     并由 `check:selfhost-entry-command` 的新 **R9** 钉成会红的判据（落点行首 + 时机句 + 前提自审），
     十六臂读数在 §8.160 ③。**②③两档仍未拍板** —— 这一档关的是"义务写没写、写在没写在对的地方"，
     不是"有没有人守"（那半段与 G-48b 同一档）。
3. G-40 ④/⑤ 的「失败与恢复」：那两句否认式文案与"版本从哪来"至今**没有会红的判据**（只有 rc=0 的通过读数）⇒ 下一条会话的第一件。
   ✅ **10-05 01:0x 已闭**：判据落在 `server/tests/version-coupling.spec.ts`（§8.135，5 条检查各配同趟阳性对照 + 8 条注入臂含 3 条塌缩臂）。
4. 第 8 项「失败与恢复」：`scripts/reinstall-all.sh` 的新鲜度对账（`:150-151`）本批从未被变异验证。
   ✅ **10-05 01:0x 已闭（判据本体换了主人）**：判据不在 `reinstall-all.sh:150-151`（那是注释，本体在 `scripts/lib/sync-windows-sources.sh`），
   而 main 已把那份重写成 `_heyta_windows_sync_push` ⇒ 变异臂在**两份实现上各跑一遍**，读数与一处新敞口（G-63）在 §8.151。
5. 指针漂移三处：`§7` 表内与 §8.19 写的 `server/Dockerfile:191` 现量是 `COPY packages/storage/`，
   那条 `RUN …check-web-artifact.mjs … --mount /app/` 在 **211** 行 ⇒ 已原地更正，
   并把"按内容找"的 grep 一起钉在旁边（行号会漂这件事本身，就是这类指针的默认失效方式）。

### 8.135 G-40⑤/G-44 那两格从"只有通过读数"补成会红的判据：`server/tests/version-coupling.spec.ts`（2026-10-04 22:37 现量）

**为什么落在测试而不是又一条 `check:*`**：落地阻塞集现在只剩根 `package.json` 一枚（哨兵 22:36 现量 `阻塞集=1`），
而新增一条 `check:*` 必须改那个文件 —— 净增只会把本批的落点变成又一枚"等别人提交"的东西。
`server` 的 `test` 就是 `vitest run`，`pnpm -r test` 每次都会跑它 ⇒ 判据一进仓库就有自动消费方，零净增文件以外的改动。
（这也是 §8.134 那张五栏表里"三格缺牙"的一条真解法：**判据的载体选择本身是被别人的未提交约束的**。）

**它钉住的是那节文档的对外说法**：`server/README.md`「Clients and version coupling」写的是一串**否定**
（没有 heyta 客户端发 `appVersion`、没有客户端创建因果 full-state 边界、没有东西消费那个闸门）。
G-44 改道之后（§8.17）这些"还没有"就是承诺本身 —— 一旦有人在别处补上了生产者却没人回看这段，文档立刻变成错话。
五个检查各配**同趟阳性对照**，因为"0 命中"单独看什么都证明不了（扫描器坏了／目录改名／正则写窄，输出上和"确实没有"一模一样）。

| 检查 | 钉住的句子 | 阳性对照（同一趟里必须成立） |
|---|---|---|
| C1 | README 抄的阈值 = 代码常量，且**恰好一处** | 同一抽取器对 `is \`9.9.9\`` 必须读出 `9.9.9`（否则它可能只是复述常量） |
| C2 | 本仓库任何工作区版本都**满足不了**闸门（= "上报了也判不出新客户端"的事实基础） | `isCheckpointSafeAppVersion(阈值)` 必须为 `true`；每个 workspace glob 必须枚举到 ≥1 份 package.json |
| C3 | sync-client 全目录读不到 `appVersion`，且下载查询串**只**发那三个键 | 同一 `filesWith` 在 `server/src` 必须读得到 `appVersion`（实得 5 份文件） |
| C4 | 8 个"能构造 op"的客户端目录里没有任何 full-state/`REPAIR`/`SYNC_IMPORT`/`BACKUP_IMPORT` 构造点 | 同一正则对 `packages/shared-schema/src` 必须命中（契约层的枚举声明） |
| C5 | `isAccountCheckpointSafe` 模块外 0 引用；阈值常量模块外只被 `cleanup.ts` 引用，且那里是那行日志 | C5 的常量腿本身是 `accountSafeRefs` 那条 0 命中的对照（它必须非空） |

**现量读数**（这行由用例自己 `console.log` 出来，下一读的人不用重量）：

```
[version-coupling] readings {"readmeGateCopies":["18.21.2"],"workspaceCount":20,
"workspaceVersions":["0.0.0","1.0.0"],"workspaceGlobs":["packages/*","apps/*","server"],
"syncClientFiles":[…4 个…],"downloadQueryKeys":["sinceSeq","limit","excludeClient"],
"fullStateScope":["packages/sync-client/src","packages/app-host/src","packages/op-log/src",
"apps/desktop/src","apps/landing/src","apps/mobile/src","apps/node-host/src","apps/web/src"],
"fullStateScanned":{"packages/sync-client/src":4,"packages/app-host/src":41,"packages/op-log/src":3,
"apps/desktop/src":6,"apps/landing/src":62,"apps/mobile/src":86,"apps/node-host/src":10,"apps/web/src":147},
"checkpointRefsOutsideModule":{"accountSafeRefs":[],"constantRefs":["server/src/sync/cleanup.ts"]}}
```

**注入臂 8 条全按预期只点红自己那一组**（`Tests 9 passed (9)`，基线 `failures=[]` 是每条臂的前置断言）：

| 臂 | 变异 | 期望响 | 读数 |
|---|---|---|---|
| 1 | README 阈值抄件改数 | `[C1]` | ✅ |
| 2 | `packages/sync-client` 版本改 `18.22.0` | `[C2]` | ✅ |
| 3 | 客户端加 `url.searchParams.set('appVersion', …)` | `[C3]` | ✅ |
| 4 | `packages/app-host/src` 新造 `{ opType: 'REPAIR' }` | `[C4]` | ✅ |
| 5 | `server/src/sync/` 新增调用 `isAccountCheckpointSafe` 的文件 | `[C5]` | ✅ |
| 6 | 摘掉 `packages/sync-client/src` 整棵 | `[C3,C4]` | ✅（两族共用该目录，所以**两族都该响** —— 单 id 断言会把正确的行为读成臂失败） |
| 7 | 摘掉 `apps` 整棵 | `[C2,C4]` | ✅ |
| 8 | 摘掉 `server/README.md` | `[C1]` | ✅ |

臂 6–8 是**专门为止住"假 0"而加的**：作用域塌了的时候判据必须响，而不是安静地读出一堆 0。
🔴 前两版就在这里红过两次，红的原因都不是判据而是我自己写错了：
① `manifestRels` 的深度过滤按 `split('/').length === 2` 筛 `packages/i18n/package.json`（那是 3 段）⇒ 工作区清单恒空，
② 覆盖树的 `walk` 只过滤了合成文件、没过滤 base 的结果 ⇒ 摘除后仍去 `read` 被摘的路径直接抛。
两个都是"判据在恒真的方向上坏掉"，靠臂 6/7 才抓出来 —— **没有塌缩臂，这两条 bug 会带着一条永远绿的判据进仓库**。

**为什么不写死"工作区应有 20 个"**：那会把上游当前状态抄进判据（下一个人加一个包就红，而那条红什么都没说）。
改成把作用域下限**钉回真源** —— 读 `pnpm-workspace.yaml` 的 glob，要求每个 glob 枚举到至少一份 package.json。
`@heyta/sync-server` / `@heyta/sync-client` 两个名字仍写死，因为那两条句子点名的就是它们。

**这条判据不证明什么**（别读多）：它证明的是"文档此刻那串否定还成立、并且一旦不成立有人会响"。
它**不**证明 G-44 已经关闭 —— 字面项（补生产者）仍然**刻意不做**，理由见 §8.17：阈值 `18.21.2` 住在
*Super Productivity* 的版本空间里，heyta 补上上报只会让 `Cleanup [checkpoint-gate]` 那行日志往"全安全"漂，
而它保护的性质（客户端创建因果 full-state 边界）依然不存在。将来真补生产者时 C3 会红 ——
**那时该做的是改那节文档并重新判 G-44，不是改这条判据**。

复跑：`cd server && npx vitest run tests/version-coupling.spec.ts`（1.4 s，零端口、零设备、零 Docker）。
同批回跑的门禁（都 `rc=0`）：`check:layering` `check:script-snapshot` `check:docs` `check:ui-language`
`node scripts/check-journey-coverage.mjs`。
📌 待入 `docs/reference/environment-traps.md`（多人台账，编号按主检出工作树现量取：22:39 量到**工作树最大号 270 / `git show HEAD:` 最大号 228**，
差 42 段**不在这份 HEAD 里**（在未提交的脏工作树里还是在别的分支上没测）—— 按 HEAD 取号会撞车）：
**"覆盖树/夹具的 walk 忘了过滤 base 结果"与"深度过滤按猜的段数"这两族，症状都是臂自己红而不是判据红** ——
所以新写作用域类判据时，先把"摘掉一整棵目录"做成一条臂，再看它期望响的 id 集合。

### 8.136 判据写完先拿到**落地后的那棵树**上预跑一遍 —— 这一跑同时照出判据错、和对外那份也错了（2026-10-04 22:43–22:50）

§8.135 那条判据在我自己的分支跑绿之后，我做了一件此前没做过的事：**把它拷进合并载体 `/tmp/heyta-merge-carrier`（`fb68cdc5`，第一父 = main）跑一遍**。
载体 = 落地之后所有判据真正要面对的那棵树。跑出来是 **9 条全红**，其中两条是基线红：

```
C4: packages/sync-client/src 出现 full-state op 构造：packages/sync-client/src/client.ts
C4: packages/op-log/src 出现 full-state op 构造：packages/op-log/src/engine.ts
```

现量（都在载体那棵树上取的，我这棵树里还没有）：

| 事实 | 读数 |
|---|---|
| `packages/op-log/src/engine.ts` 有 `createSyncCheckpoint()`，派发 `{ entityType:'ALL', entityId:'*', opType: OpType.Repair, payload:{isFullState:true,…} }` | 是 ADR-0046/ADR-0047 的**显式维护 API**，无自动 timer，前置是三道拒绝（历史完整 / 队列排空 / 实体类型可表示） |
| 它的调用者 | 只有测试：`packages/op-log/tests/full-state-recovery.spec.ts`、`packages/op-log/tests/op-log-count-reads.spec.ts`、`apps/web/tests/e2e-sync.integration.spec.ts`。**产品层零调用**（`packages/{sync-client,app-host}` 与 `apps/*/src` 各目录 0 命中） |
| `packages/sync-client/src` | 现在 **5 个文件**（多了 `payload-cipher.ts`），`client.ts:1005-1006,1063` 三处 `op.opType === 'REPAIR'` —— 那是上传**分桶与密文**用的**比较**，不是构造 |

### ① 判据自己错了：词级正则把"这个词出现过"当成了"这条路径存在"

我原来那条 C4 的失效方式有三层，全部由载体这一跑照出来：

1. **比较形状被读成构造**（sync-client 那处）；
2. **作用域把机制本体所在目录也算进"不许有构造"** —— op-log 是这条机制**该在**的地方，把它当违规等于把上游当前状态写死在判据里，别人正常落地就误红；
3. **生成物里的方法定义会被当成调用**：`packages/app-host/bridge-bundle/native-bridge.js` 打包了 op-log 的类，里面有 `createSyncCheckpoint() {`。这条我在写正则时先想到并用"调用要带接收者点号"挡掉了（`.createSyncCheckpoint\s*\(`），否则判据会把一个**打包产物**判成产品路径。

改后的形状（同一趟里的四条对照都落进 `readings.fullStateShapeControls`）：

```
{"构造命中":true,"比较不误伤":false,"枚举成员不误伤":false,"调用命中":true,"定义不误伤":false}
```

- 构造判据 = `opType:` **冒号**后跟 full-state 枚举 ⇒ `op.opType === 'REPAIR'` 与 `Repair = 'REPAIR',` 都不算；
- 调用判据 = 带接收者的 `.createSyncCheckpoint(` ⇒ 打包产物里的定义不算；
- 作用域 = 产品层（`packages/sync-client/src`、`packages/app-host/src`、`apps/*/src`）；
- 机制那一侧单独记账：`packages/op-log/src` 里允许有构造点，但**只允许 0 或 1 个文件**含它 —— 0 = 这棵树还没有机制，1 = 机制在 designated 位置，>1 = 多了一条边界来源（那不会是产品层，所以产品层的判据永远看不见它）。
- 臂从 8 条加到 **11 条**：新增"宿主层调用维护检查点""机制侧冒出第二个构造点"，以及一条**反向臂** —— 往上传路径真加一处 `op.opType === 'REPAIR'`，判据**必须不响**。
  🔴 反向臂是这条判据能不能长期活着的钥匙：宽到误伤的判据会在别人正常落地时变红，而误红判据的下场就是被放宽，放宽通常放宽到没牙。

### ② 更贵的那半：对外那份（本批自己写的）在合并树上是错的

`server/README.md` 前置条件 2 里这两句，是 §8.17 那次改道时按**当时的**读数写的：

> ~~`SYNC_IMPORT` / `BACKUP_IMPORT` / `REPAIR` appear in heyta's code only as enum members … `packages/sync-client` contains no snapshot or checkpoint path at all (4 files, zero case-insensitive matches)~~

合并树上：op-log **有**构造点、sync-client **有** REPAIR 相关代码（虽然是识别不是构造）、文件数是 5 不是 4。这句一旦随本批落地就是对外错话 —— 而且它是那种"没人会主动发现"的错：它读起来像在说缺口很深，实际缺口只剩"没人调用"。

已就地改写（不是删：原句说了什么以引用形式留在更正段里）：

- 服务端那半照旧"fully implemented"（`sync.routes.snapshot-handler.ts` 解 `snapshotOpType` 并写边界）；
- 客户端那半缺的是 **"a product path that runs it"**，机制存在且是显式维护 API（点名 ADR-0046/0047），调用者只有测试；
- 上传路径"只*识别*这类 op（分桶、密文），不构造"；
- ⚠️ 一条**给下一个人的话**：如果哪天 `createSyncCheckpoint` 被接进产品路径（`engine.ts` 那句注释已经在说"检查点会在每次同步后尝试"），C4 会红 —— **那时要重判的是 §8.17 那条"上报 appVersion 会造假信号"的结论**（前置条件 2 成立之后，这个推论的前提就没了），不是把判据改窄。两处都写进了本体。
- 顺带把"下载查询只设 `sinceSeq` 与 `excludeClient`"补全成实测的三个键（`sinceSeq`/`limit`/`excludeClient`）—— 这就是 C3 那条腿钉的东西。

sweep 过没有第三份抄件：`only as enum members` / `no snapshot or checkpoint path` / `zero case-insensitive matches` / `枚举成员` 在 `docs` `server` `packages` `apps` `research` 全仓各 **0 命中**（只有 README 那一处，已改）。

### 为什么这必须现在做，不能在窗口里做

`pnpm -r test` 会在落地链里跑到这条判据。判据在窗口里红的代价是把几十分钟的稀缺窗口花在自家事上；改判据 + 改文档是十几分钟的事，而且**不需要别人任何东西**。载体跑完已清理：`cp` 进去 → 跑 → `rm` → `git status --porcelain` = **0**。

### 读数与复跑

- 我这棵树：`Tests 12 passed (12)`（1 条现量 + 11 条臂）；`fullStateProductConstructions=[]`、`fullStateProductCallers=[]`、`fullStateMechanismFiles=[]`（我这棵树还没有机制）、`opLogFileCount=3`。
- 合并载体 `fb68cdc5`：同样 `Tests 12 passed (12)`；`syncClientFiles` 5 枚（含 `payload-cipher.ts`）、`fullStateScanned` `app-host 54 / mobile 105 / web 162`、`fullStateMechanismFiles=["packages/op-log/src/engine.ts"]`。
  🔴 **两棵树都绿、但读数不同** —— 这正是想要的形状：判据不写死上游状态，机制进来之后它改记的是"构造点在 designated 位置、产品层没人调用"。
- 同批回跑：`check:docs rc=0`（改的是 README 本体）。
- 复跑：`cd server && npx vitest run tests/version-coupling.spec.ts`；载体预检 = `cp server/tests/version-coupling.spec.ts /tmp/heyta-merge-carrier/server/tests/ && cd /tmp/heyta-merge-carrier/server && npx vitest run tests/version-coupling.spec.ts`，跑完 `rm` 并核 `git -C /tmp/heyta-merge-carrier status --porcelain | wc -l` 回到 0。

📌 待入 `docs/reference/environment-traps.md`（编号按主检出工作树现量取，22:39 量到最大号 270）：
**新写的作用域/形状类判据，要拿"落地后的那棵树"（现成的合并载体）预跑一遍** —— 只在本分支跑绿证明的是"我和我上游还没分叉的那部分"，
而判据真正要活的环境是合并之后。词级正则把"词出现过"当"路径存在"是这一族的典型失效（比较形状 / 枚举声明 / 打包产物里的定义三种误伤）。

### 8.137 G-62（新登记，待落地后做）：站内那篇自建指南从没说过"界面就在镜像里、打开 `/app/` 就能用"，而它的排查顺序还停留在"你自己托管 UI"那一档

落地等待期做的一次对外说明普查（零端口、零写盘以外的活），对象是目标那句话的字面前半段：
**"外人一条 compose 起全套、打开浏览器就能用"**。

### 现量：能力已经成立，说明没有跟上

| 事实 | 取证 |
|---|---|
| 自建部署下应用**默认就是同域**：什么都没配时 `authBaseUrl()` 取 `window.location.origin`，协议不是 http/https 才回落公共服务 | `apps/web/src/lib/auth-endpoint.ts:95-101`（`httpOriginOrOfficial()`），注释里明写"这一档不改变自建部署的形态：自建者跑的是 web，走的还是'来源就是答案'那条" |
| 服务端容器同域挂 `/app/`（界面）与 `/api/` | 本批 #2 已落；`docs/runbooks/self-host.md:184-186` 印着"开浏览器访问 **`https://你的域名/app/`** —— 界面就打在服务端镜像里，挂载路径由 `WEB_APP_PATH` 决定（默认 `/app/`，镜像内产物路径 `WEB_APP_DIR` 默认 `/app/web-dist`）" |
| 而**外人真的点进去的那一页**（站内指南，中英两份词条）通篇没有这句话 | `grep -c "/app/" packages/i18n/src/locales/zh-CN.ts` = **1**、`en.ts` = **1** —— 两处都是**代码注释**（zh `:715`、en `:659`，讲 `/app/#sessionToken=` 那条登录跳转），不是用户看得见的正文。`site.docs.selfhost.*` 全部 s1–s8 段里 `/app/` 命中 **0** |

不只是漏一句便利信息 —— 它让**已存在的一段说明变得会误导**：

- `site.docs.selfhost.s6` 整段叫「界面显示离线，先看这一条」，`s6p1` 讲的是"请求根本没发出去：服务端只放行它配置里列出的前端来源"，`s6p2` 据此给出排查顺序"**先看浏览器控制台的跨域报错，再看服务端日志**"。
- 那句本身对它描述的那一档是**对的**（自己另托管一份 UI 时 `CORS_ORIGINS` 不放行就是会在浏览器本地被拦下，而这条仓库真踩过：`AGENTS.md` §9 的 P2 那行把它列成 `pnpm verify:multi-end` 查出的三个真问题之一，症状正是"界面显示离线而服务端零请求"）。
- 但它现在是**默认形态下不可能发生的事**：界面由服务端容器同域提供，同域请求不走 CORS。也就是说这一页把人先引向一条走不通的排查路，而把默认形态真正会坏的那几处（`--base=/app/` 打出来的产物路径、SW/manifest 在 `/app/` 下的落点 —— 本批 G-48/G-59/G-60 修的就是这些）一句不提。

### 为什么登记而不是现在改（三条，都是量出来的）

1. **词条表是全仓最高频的文件**：主检出 `git log --since="2 days ago" -- packages/i18n/src/locales/zh-CN.ts` = **62 笔**。改它会把本批的合并面从"只剩 `package.json` 一枚"重新撑成含高频整包，正落在落地窗口前 —— 为一个说明性改动去赌一次冲突，不值。
2. **改完也还要再发一次才对外可见**：词条只有随落地页重新发布才上线（本批 #8 就是这件事）。落地后本来就要做一次重发 + live-site 复跑（任务 #19/#20），这条搭那趟车，发布成本 0 增量。
3. **改词条的连带纪律不便宜**：中英必须同步（`check:ui-language` + 词条对账），改完要重跑生成与 `check:entries`。这些都不难，但都是"贴着落地窗口边缘做"时最不想占的东西。

主检出那两份词条表**此刻是干净的**（`git status --porcelain -- packages/i18n/src/locales/*` 空），所以这不是"别人在飞"，是"我不去加宽合并面"。

### 落地后要做的样子（写成可直接执行的三条）

1. `site.docs.selfhost.s7`（「怎么装」）末尾加一段：起来之后浏览器直接开 `https://你的域名/app/`，界面与 API 同域、由同一个容器提供，**不需要另托管一份前端**；要另托管才落到下面那条 `CORS_ORIGINS`。
2. `s6p1`/`s6p2` 的排查顺序改成**按形态分叉**：同域（默认）先确认产物路径与挂载点（`WEB_APP_PATH`/`WEB_APP_DIR` 两个旋钮要一起改，改一个是静默无效 —— 这句 runbook 已有，搬进指南），另托管 UI 才先查跨域。原句保留，只把它明确限定在它描述的那一档 —— 不删，删了等于把真踩过的坑抹掉。
3. 中英同步 + 重跑 `gen` 与 `check:entries` + `pnpm check:ui-language`，然后随任务 #19 那次重发上线，并在 live-site 侧加一条**读页面正文的判据**（这条是判据不是文案活）：站内自建指南页必须能读到 `/app/` 这个词，且该页仍印着与 `check:selfhost-entry-command` 同一句主命令 —— 后者已有（R1–R7 管着），前者没有，所以这一页"说明了怎么起、没说明起完打开哪里"这种事**下次还会漂**。臂的做法：临时把那句摘掉跑一次必须红，再原样放回并核对放回后命中数回到现量。

📌 顺带一条可迁移的（与本批 §8.131/§8.132 同族）：**能力上线了 ≠ 说明跟着上线了**。这一族的失效形态不是"说明写错"，而是"说明写的还是能力变之前那个世界"，而它读起来句句都对 —— `s6` 那段就是：它描述的那个坑是真的，只是不再是默认路径会撞的那个坑。判这类问题只能拿"用户实际会做的那条路"重走一遍，不能只校对句子。

### 8.138 "这条判据要窗口"是关于**装置**的一句话，不是关于事实的一句话 —— 看守的中止读数拆开取（2026-10-04 23:0x–23:1x）

§8.127 末段留了一格："这条守卫今天还没有它在真实链上的读数……写成待取，不写成已闭"。
那一格被读成了"要等几十分钟的窗口才能取"。**这句是错的**，而错得很典型：

> 我要的读数有两件事混在一起 —— ① **看守会不会中止**（需要：gate 4 那段代码 + 一个真子进程 + 一个真监听者），
> ② **一趟链有多长**（那才真的需要窗口）。①被②押着，于是一条 3 秒能取的读数被挂在了 30 分钟上。

#### 做法：把那段代码从调用方手里搬出来，两个入口共用

| 搬动 | 内容 |
|---|---|
| `selfhost-kill-watchdog.mjs` | 新增导出 `runChildUnderWatch()` —— spawn 子进程 + `startWatch` + 中止时 SIGTERM→5s 后 SIGKILL + 退出码归一 + 回 `reads/elapsedMs/output`。**这就是第 4 道跑链的那段本体**，搬出来之前它只在 `selfhost-land-main.mjs` 里，于是"只有真窗口能取它的读数"是结构必然 |
| `selfhost-land-main.mjs` 第 4 道 | 原来那 30 行内联换成一次 `runChildUnderWatch()` 调用，读数格式、日志路径、`refuse(...,3)`/`refuse(...,4)` 的分支一个字没改 |
| 入口 A `--watch-leg N` | 单独取证模式：**在任何闸门之前 exit**，不重算载体、不读别人的工作树、不碰任何 ref；与 `--confirm` 互斥（各 exit 2） |
| 入口 B `--confirm` 开跑前 | 同一函数跑三臂（约 3s），任一臂不合格 = 探针坏 ⇒ 不开那几十分钟的链。**这一档是门槛不是打印**（`process.exit` 退 1 或 2）；顺序刻意放在"用法错"之后、载体重算之前：探针坏的时候一个字节都不该写 |

🔴 入口 B 是刻意加的：**"只有人能手动跑的那一条判据"在这批里已经付过两次账**（G-48 的链外门禁、G-61 的 `verify:selfhost-stack`）。

#### 三臂（23:08 与 23:12 两趟各取一次，第二次是搬成函数之后的复跑）

| 臂 | 期望 | 现量 |
|---|---|---|
| W1 对照：那枚端口上无人监听 | 子进程自己退、不触发、定时器真转过 | `code=0 trip=null reads=4` + 独立复判 `ours=0 foreign=0` |
| W2 **跑起来 0.7s 之后**才出现的外来监听者 | 中止、点名那枚 pid、子进程真收到信号、且**不是一进来就判的** | `code=143 sig=SIGTERM reads=4 用时 1.1s`，`trip=外来监听者 1 枚：:60159 pid=… cwd=/var/folders/…`；起跑前另取一次复判为空端口 |
| W3 反向对照：监听者 cwd 就在载体里（用 `<载体>/scripts` 子目录，顺带盖住 `startsWith(carrier+'/')` 那一支） | **必须不触发** | `code=0 trip=null reads=4` + 独立复判 `ours=1 foreign=0` |

🔴 **W2 的期望值第一版是"先把监听者摆好再开跑"，那量的是第 3b 道已经量过的事** —— 改成延迟注入并加 `reads ≥ 2` 之后，它才回答"跑到第 29 分钟别人刚起的服务端会不会被救下来"。
🔴 **W3 缺了就等于把 §8.127 那枚 `-a` bug 的形状放回去**：把自己判成外来的看守，在只测 W2 的装置里表现完美。
每臂还配一条**独立复判**（直接调 `foreignListeners`）：W1 要 0/0、W3 要 1/0 —— 否则"什么都没看见"和"看见了并判成自己的"在输出上长得一样。

#### 牙：`research/tools/selfhost-watchleg-arms.mjs`（一次性变异台，全部发生在临时目录的拷贝里）

```
✅ M1 tripReason 恒 null（看守永远不认定外来监听者）⇒ 只准 W2 红   rc=1 点名的臂=W2   期望=W2
✅ M2 只有起跑前那一眼、定时器没接上 ⇒ W2 与 W3 都要红            rc=1 点名的臂=W2 · W3 期望=W2 · W3
收尾对账：真树状态行 = 2 条 [watchdog, land-main] ✅ 恰好是本轮我自己改的那两枚
```

#### 这一轮我自己造的三个坑（都留了读数，因为它们就是这节要讲的形状）

1. **探针坏了报的是"被测对象没起来"**：`net.createConnection()` **零参**在 Node 22 里同步抛 `ERR_MISSING_ARGS`，而它抛在 Promise 执行体里 ⇒ 变成一个没人接的 rejection，整条腿崩在第一臂之后。症状看着像"我的合成监听者起不来"。改成 `new Socket()` + `try/catch`，并把探针本身的错误带进那句 die 的文案。
2. **`${PIPESTATUS[0]}` 在 zsh 是空值**（§7 #184 同族，我第二次撞）：第一趟把 `LEG_EXIT` 报成空串。重跑成"落盘再读 `$?`"才拿到 `LEG5_EXIT=0`。
3. 🔴 **变异台的"没污染真树"那条收尾对账，第一版自己就是个恒 0 的假判据**：git 的 cwd 我写成 `…/research/tools/..`，而内核把 `x/y/..` 解析成 `x` ⇒ git 在 `research/` 里跑、pathspec 变成 `research/research/tools/…` ⇒ **恒 0 条**，看着正好像"变异没漏进真树"。修到仓库根之后它**第一次跑就因为另一个解析错判红**（porcelain 状态位是 2 字符，我先 `trim()` 再 `slice(3)` ⇒ 路径被啃掉一个字符，对不上期望值）—— 那句红正是"断言有牙"的直接证据。⇒ **收尾对账必须断言"恰好等于什么"，不能只报"等于 0"**（0 既可能是干净，也可能是没在看）。

#### 仍然缺的格子（不写成已闭）

- **真 `pnpm check` 在看守下的时长读数**：那一格确实要窗口，§8.127 那半句不随本轮关闭。
- **`--confirm` 那个调用点今天没真跑过**：三臂函数被 `--watch-leg` 跑过（同一份代码），但"`--confirm` 在开链前调它"这条接线只有结构核对，没有运行读数 —— 它第一次响要在窗口里。
- 哨兵 `/tmp/g173-window3.sh`（pid 16536）**23:14:10 `CAP_REACHED` 等满 7200s 自己收场**：观察期内 main 变过 **18 次**，`阻塞集` 恒为 **1** 枚（`package.json`，别人的未提交改动），负载/端口/载体/阻塞集**从未同时凑齐**。⇒ 这是"等窗口"这件事目前最硬的一条量化证据：**卡点不是负载尖峰（那是会过的），是那枚要由它的所有者提交的未提交文件。**

### 8.139 把"等窗口"从只报不开工改成会开工：哨兵 v4 收进仓库（2026-10-04 23:1x，同一轮）

§8.138 那条 `CAP_REACHED` 读数值的不是"窗口没开"这四个字，是**两小时买回来一行打印**。
v3 哨兵（`/tmp/g173-window3.sh`）设计上只写日志、把命令交给人，于是"窗开了"和"活干了"之间
永远隔着一个人醒着的那一分钟 —— 而这一批的窗口按 main 的节奏大概率出现在凌晨，不在我醒着的时候。

| 改动 | 内容 |
|---|---|
| 收进仓库 | `research/tools/selfhost-window-sentinel.sh`（v4）。v3 住 /tmp：会被清，而且它已经是三节台账引用的取证装置 ⚠️ **已被 v5（`.mjs`）取代并在 §8.144 删掉** —— 那行"收进仓库"讲的还是 v4 |
| 新开关 | `--run-on-open` ⇒ 开窗即 `cd <主检出> && node <绝对路径>/selfhost-land-main.mjs --confirm`，退出码原样透成 `LAND_RC=` 并进日志 |
| 默认仍是只报 | 不加那个旗标 = v3 的行为（打命令 + "本哨兵没加 --run-on-open ⇒ 只报不开工"）|
| 主检出不写死 | 从 `git worktree list --porcelain` 找 `branch refs/heads/main` 那一条；**找不到 ⇒ `PROBE_BAD` exit 2**，不拿"没找到"当"这台机器没有主检出" |
| 六件判据一个字没放宽 | 阻塞集 0 / 1 分钟负载 ≤12 / 射程端口空 / 载体空闲 / main 两样同值 / 五件**连续**成立（默认 `QUIET_MIN` 从 10 提到 **15** 分钟 —— 只往严的方向动） |

🔴 **成功路径平时不执行，所以先各演练一遍**（`FORCE_OPEN=1`，g131 那一族）：

```
带 --run-on-open --run-cmd 'echo 演练：这里没有真的落地'
  WINDOW_OPEN … main=9de0e545 …  /  开窗即执行：cd "…/heyta" && echo 演练…  /  演练…  /  LAND_RC=0
不带 --run-on-open
  WINDOW_OPEN …  /  ⚠️ 本哨兵没加 --run-on-open ⇒ 只报不开工。   （rc=0）
```

⇒ 开窗那一支的**两条**出口（开工 / 不开工）都被真走过，不是只走过默认那条。
裁判仍然不是哨兵：真跑的是 `--confirm` 自己那七道闸门 + §8.138 那三臂自证，哨兵只决定"什么时候让它去判"。

⚠️ **不把它读成"落地已经自动化了"**：① 它可能真的在无人时把 `main` 前进掉（用户已授权合并；`--ff-only`、不 push），
② 落地**之后**的三件事一条都不自动 —— 从 landed main 重发落地页（#20/#21）、`pnpm reinstall:all`（第 8 项）、
G-62/#39 那篇指南的 `/app/` 那一句。这些仍要人（或下一轮）。
③ 观察期 `连静 15 分钟` 仍然只是代理指标：链要几十分钟，动了就退 1，那一趟的全链读数仍留在日志里，
落地要重来一趟 —— **退 1 不是白跑**，它顺手就是 #26（逐段归属）要的那份读数。

本轮起跑：`CAP=14400 STEP=150 QUIET_MIN=15 --run-on-open`，日志 `/tmp/selfhost-window-sentinel.log`。

### 8.140 "这道门不管这个文件" ≠ "这个文件没有这类问题"：拿 main 那道表形态门的算法量了一遍本档（2026-10-04 23:2x）

落地前最不该发生的事，是**链里冒出一枚新红**——那会让 30 分钟的窗口整趟作废去拆归属。所以先把"我这轮往台账里加的三张表会不会撞上 main 侧那道 `check:md-tables`"量掉。

**第一步现量门的范围**（不猜）：

```
git show main:scripts/check-md-table-rows.mjs | sed -n '/^const FILES/,/^\];/p'   # 9 枚显式清单
git show main:scripts/check-md-table-rows.mjs | grep -c self-host-distribution-audit  # → 0
```

⇒ 本档**不在**它的扫描集里，落地那一刻它不会因为 §8.138/§8.139 新增的表而红。到这一步就可以收工 —— 但那正是这句话要拦的东西：

**第二步把那枚门的算法搬到本档上跑一遍**（做法：`git show main:…` 取实现，把 `FILES` 换成只剩本档的一份，在分支树上跑）：

| 趟 | 结果 |
|---|---|
| 第一趟 | 🔴 **rc=1**：`docs/research/self-host-distribution-audit.md:8407 列数 3（本表表头是 2）` |
| 改后复跑 | ✅ `1 个文件，列数、断行与"是不是表"都一致` rc=0 |

真缺陷，不是判据过严：我在表格里写 `` `process.exit(1|2)` `` —— **代码段里的竖线在 markdown 表格单元里就是列分隔符**，任何渲染器都会把那一行画成三列。改成"退 1 或 2"。
它跟这轮的判据本体无关，所以没人会替我响：**门的范围决定红不红，不决定对不对。**

⇒ 可迁移的两件：① 判"某道门管不管我这个文件"要现量它的**范围来源**（`check:md-tables` 是 9 枚显式清单，不是目录枚举/glob —— 换成 glob 的那道就是另一件事）；
② 想知道"不在范围内"的那些内容对不对，就把**那道门自己的算法**搬到我的文件上跑一次 —— 别自己重写一遍形状判断（重写的那份就是第二套规则，会漂）。

⚠️ **"把本档加进 `FILES`"这轮的代价现量 = 0 处（整档 rc=0），但这一轮不加**：
`scripts/check-md-table-rows.mjs` 不在本批写集里，而且它正是回收站那条线今天动过的那枚脚本（清单注释里写着"2026-10-04 加入，逐文件现量 rc=0"）
⇒ 我加一行 = 给自己新增一枚撞车面，而落地等的就是撞车面归零。登记成**落地之后**的候选（谁做都要重新现量"代价 0 处"这句，它和本档所有其他数字一样有保质期）。

### 8.141 载体第九族（`server/Dockerfile`）：**两侧各修了同一个缺陷**时，"取哪一侧"仍要由判据决定；而拒绝的那一趟必须把现场擦干净（2026-10-04 23:3x–23:5x）

23:0x 那一趟重算撞到的**族外冲突**就是这一枚。现量的形状（下一次重算必须重量，这组数字有保质期）：
`main=c9fe6f56` · `feat/self-host-distribution=f106e8b3` · `merge-base=b850b1c6`，
`git merge-tree` 报 **7 条**冲突：本档、`package.json`、`check-image-license-coverage.mjs`、
`gen-image-npm-tree.mjs`、`scripts/screenshots/capture.mjs`、`server/image-npm-tree.json`、**`server/Dockerfile`**。
⚠️ `.gitignore` 这一轮**不再冲突**（自动并好了）——第八族之前它还在那张表里，所以"预置八族"这句话本身也是一条会漂的抄件。

**两侧改的是同一个缺陷，写法不同**：main `b3397cda` 往 `server/package.json` 的 `devDependencies` 里放了
三枚只存在于本机 pnpm 工作区的 `@heyta/*`，npm 在 `--omit=dev` 下照样**解析** dev 的每一枚 spec ⇒
registry 404 ⇒ 镜像那一层建不出来（`pnpm -r build` 与 `pnpm check` 全绿，AGENTS §7 第 75 条那个形状）。
main 的修法是一句内联 `node -e '…delete p.devDependencies…'`，本批的修法是 `npm pkg delete devDependencies`。
`server/Dockerfile` 相对 merge-base：main +17/−3，本批 +52/−4，而**只有 1 块**冲突。

#### 取舍不是偏好，是判据

`image-install-shape.mjs` 的 `PRUNE_DEV_DEPS_RE` 只认 `npm pkg delete devDependencies` 那一种形状，
而它是**契约门禁第 5 步与快照指纹共用的唯一一份**判定（`check-image-install-contract.mjs:314` 消费 `shape.prunesDevDependencies`）。
取 main 侧会连红两处，且两处都是本批自己的门：

1. 第 5 步直接点名"生产阶段没有在第一条 install 之前删掉 devDependencies"；
2. `prunesDevDependencies=false` 会把 `devDependencies` 从 `INERT` 档挪回被哈希的集合 ⇒
   `serverInstallInputSha256` 变 ⇒ 第五族那份快照新鲜度那一腿也红。

⇒ 命令形状取**本分支**。但**注释不取**：main 那一段独有注释里是它自己的取证理由
（"剪掉是安全的：这三枚只有测试与 `scripts/*.ts` 用，`recover-user.ts` 里那处是注释、值用字面量，
由 `server/tests/recover-artifact-envelope.spec.ts` 钉住"）——结论相同不等于论证可以丢，
所以解法把 main 独有的注释行**逐字保留**（保留几行由载体读数现量，不在这里抄死）。

#### 🔴 这一族特别不能 `checkout --theirs`

前几族里"取本分支侧"是 `git checkout --theirs -- <path>`，那一句拿的是**整文件**。
本文件只有 1 块冲突，其余几块是 git **自动并好**的 —— 整文件取一侧会把 main 那些**没冲突的块**
一行不留地丢掉，而归属检查（`diff(main, 载体) ⊆ diff(base, 本分支)`）**抓不到**这一条：
这一路径本来就在写集里，产出看着完全合法。这就是本文件头部第 1 族那句
"摘掉的那段会被当成另一边没有而**静默消失**"换了个文件重演。
⇒ 解法**只改写冲突块本身**，块外一个字节不动；判据与守卫抽进
`research/tools/selfhost-dockerfile-merge.mjs`（单一所有者，可离线变异，不必为验一条判据就在真载体里留一次半合状态）。

#### 新判据的牙：17 条自检 + 四道守卫各做一次摘除变异

`--selftest` 现量：**17 条臂（control 10 条 + 拒绝类 7 条），红 0，rc 0**。变异读数（一次性副本 `/tmp/g190mut2`，真树未动）：

- 摘掉"本分支侧没有剪枝句 ⇒ 拒" ⇒ 红 1 条：`A1`；
- 摘掉"main 侧有非注释、非替代写法的行为行 ⇒ 拒" ⇒ 红 1 条：`A2`；
- 摘掉"产出里剪枝不在第一条 install 之前 ⇒ 拒" ⇒ 红 1 条：`A7`；
- 摘掉"没有 `ARG`/`RUN` 锚点 ⇒ 拒" ⇒ 红 1 条：`A5`；
- 未变异对照：rc 0、红 0。

🔴 **"按理由认领"这件事救了一次**：臂的第一版只断言"它拒了"，于是 `A1` 那条输入在前置守卫被摘掉之后
**仍然红不了** —— 它会被**另一道**守卫（产出的形状自检）兜住，症状是"M2 变异 rc=0、一条红臂都没有"。
改成比对 `verdict` 里的 needle（每条臂认领自己那道守卫的措辞）之后，第一版夹具立刻暴露出
`A5`/`A7` 其实走到了**别的**守卫上（main 侧那句 `ARG NPM_REGISTRY=…` 与夹具里的 theirs 不相等，
于是先撞上"main 独有的非注释行"那道），两臂的夹具 accordingly 改窄。
⇒ 可迁移的口径：**同一件事有多道守卫会各自拒绝**，"拒了"作为断言只证明"有一道在"，
不证明"我要验的那道在"；拒绝类臂必须认领**理由**，否则它对自己那道守卫的失效是盲的。

#### 🔴 拒绝的那一趟把载体留在了半合状态 —— 代价是下一次连我自己都进不来

23:0x 那一趟撞到族外冲突 ⇒ 退 2，但退 2 只做了"打印 + 退出"，`/tmp/heyta-merge-carrier` 留在
`MERGE_HEAD=f106e8b3` + **61 条脏**。当时以为代价是"树脏了"，实际代价更绕：第 0a 步那道闸门把
`MERGE_HEAD` 认成"**别人的现场**"⇒ 从那一刻起**挡住的是我自己**。
手工 `git merge --abort` 后现量 `MERGE_HEAD=无` / `DIRTY=0`，然后把这道动作固化成 `die()` 里的 `teardown()`：
合并一开始就置 `mergeStarted`（挂在 merge 尝试**之前**，不是挂在 `MERGE_HEAD` 核对通过之后 ——
第 0 步已经 abort + reset 过，此后树上任何进行中的合并都是我自己起的），
每一条 die 路径 abort 之后**再量一次** `MERGE_HEAD` 与脏条数，没擦干净时把恢复命令原样印出来
（不改退出码：原始失败才是归因对象）。

顺带把这轮碰到的两处**数字抄件**改成现量：`GATES` 的道数用 `GATES.length`、提交说明里的族数用
`Object.keys(fam).length − 1`（原来写死的"七族冲突的解法"在加第八族时就已经是错的了）。

#### 抽出 `readImageInstallShapeFromText` 的零行为变化证明

第九族需要"拿着**还没写盘**的那个产出先问一次形状"，所以把 `readImageInstallShape` 的纯计算抽成
`shapeOfStageLines`，路径版与新文本版都是它的一层薄壳（不是第二份实现）。现量三条相等：
`HEAD 版(路径) == 新版(路径)`、`新版(文本) == 新版(路径)`，且两个消费者复跑
`gen-image-npm-tree --check` / `check-image-license-coverage --quiet` / `check-image-install-contract` 全 rc=0，
`prunes=true · install 3 条 · normalizedShape 263 字符`。载体侧另外落了一条**磁盘再判**的自检
（写回后回读逐字节相同 + 磁盘那份的 `normalizedShape` 与本分支侧相同 ⇒ "保留注释"没有改变镜像装出来的东西，
第五族取的那份快照仍然对得上）。

⚠️ 未做 / 边界：① **这一跑的真载体重算尚未完成**（下一步走 `selfhost-merge-carrier.mjs`，
读数以它打印的为准，本条不代它主张）；② 哨兵从 `.sh` 端口成 `.mjs` 仍未做（§8.139 登记的那条），
它挡的是 bash 字节偏移那一族（§7 第 110/113 条），与本轮无关；③ main 侧那句 `node -e` 的**出处 SHA**
由载体读数打印（`main 那一版的出处=`），不手抄进本条。

### 8.142 🔴 载体的红不再只有两种下场：加了一层"main 自己也红"的逐条归属（第九族随即在真载体上解开，2026-10-04 23:5x）

#### 先说这一跑拿到的东西（提交 `73e594a1` / `ac409892`，载体 `d6310288` = main `a12cc709` × 分支 `ac409892`，`CARRIER_RC=0`）

- **第九族在真数据上解开**：`保留 main 独有注释 10 行 · main 那句替代写法 node -e 已丢弃 ·
  剪枝在第一条 install 之前=true · install 3 条 · 安装形状与本分支侧逐字节相同=true`，
  并且打出 `main 那一版的出处=715b25eb`（同一缺陷的另一种写法）。
- 冲突 **7 条**全部落在预置九族内（`fam.other=0`），`.gitignore` 这一轮**自动并了**（`gi=0`）⇒
  "预置八族/九族"那句族清单本身是一条会漂的抄件，脚本里的族数已改成从分族表现量。
- 链并集读数：`scripts 键 154 · check 链段 main=82 本批=67 base=66 并集=83（摘段 0/0）`。
- 归属通式：`写 63 / 合并相对 main 改 63 / 集外 0 / 写集里未被改到 0`。
- 八道纯 fs 门禁里 **7 道 exit 0 + 1 道红**，而那一道的红被下面那层归属判成非本批。

#### 那条红不是解法错，是别人的红 —— 旧逻辑拿它当"解法没修好"，于是永远拒绝落笔

`check:docs` 在载体上退 1，点名一处：`docs/plans/calendar-profile-handoff.md:1187` 指向回收站那份计划里
编号 `10.87` 的那一节，而**提交物里**那一节不存在。三条现量把它钉成非本批：

1. 干净 main 检出（`/tmp/g196-main` @ `2c69c57d`，`git status` 0 行）上 `node research/tools/docs-link-check.mjs`
   ⇒ **rc=1、同样这一条**（分母 `532`，载体上是 `537` —— 多出来的 5 处是本批自己加的引用）；
2. 那两枚文件**都不在本批写集**：`git diff --name-only b850b1c6 73e594a1 | grep -cE 'calendar-profile-handoff|trash-and-archive'` = **0**；
3. main 上那份计划里 `10.` 的编号最大到 **10.17**（现量命令：`git show main:docs/plans/trash-and-archive.md | grep -oE '^#+ 10\.[0-9]+' | sort -t. -k2 -n | tail`）；
4. 而主检出那枚文件的**未提交版本**里 `10.84`–`10.91` 全都在 ⇒ 这条死链会在它自己的所有者提交后自愈，**不由本批改那两枚文件**。

🔴 而旧逻辑是"任何一道门红 ⇒ 不提交、先修解法"。屏幕上句句真话，**实际没有解法可修**：
这一档会每轮重算都拒一次，症状长得和"载体坏了"一模一样。Goal 第 1 项本来写的就不是
"check 全量绿"，而是"逐条仍可归属到非本批"——这一轮把那句话**装进了工具里**。

#### 归属层的形状（`research/tools/selfhost-red-attribution.mjs`，提交 `ac409892`）

三条放行条件缺一不可：① 这道门**有缺陷行提取式**；② 同一道门在**干净的 main**（配对树自己也断言
`HEAD == mainSha` 且脏 0 条）上也退非 0；③ 载体点名的**每一条**缺陷行在原样 main 输出里**逐字**存在。
任何一条"判不了"都按**不放行**处理 —— "没法归属"不许被读成"归属过了"（§8.122 那族假 0 的第四个面目）。

- 自检 **12 条**：control 3 + 放行方向 1（main 红得更多仍然算非本批）+ **五条按理由认领的拒绝臂** + 聚合 2。
- **五道守卫各做一次摘除变异，各打红自己那条臂**；未变异对照 rc=0 / 红 0。
- 🔴 **needle 教训第五次同族，而且这次是"needle 串到别人措辞上"**：A1 的认领串我先写成 `'退 0'`，
  于是摘掉"main 退 0"那道守卫之后**变异没被抓住**（rc=0、红臂 0 条）—— 因为另一道守卫的措辞里
  也含"main 同道门退 0"。换成那道守卫**独有**的短语（`这条红是本批带进去的`）之后 G2 变异才红。
  ⇒ §8.141 那条"按理由认领"还不够，理由串必须是**该守卫专属**的子串；写完每条臂要拿"摘掉这道守卫"
  真跑一次，而不是只看臂全绿。
- 🔴 **放行 ≠ 吸收**：那条红仍然在 main 上、仍由它的主人修；本批只是不再被它挡在门口，
  并把配对读数（带 main 的 SHA）打进**载体那笔的提交说明** + 终端复述，别人查得到，
  不会被本批的"绿"掩埋。这条正是 §8.135–8.137 立下的"新判据要在落地后的那棵树上预跑"的反向用途：
  预跑照出的**别人**的缺陷，要留在归属读数里而不是被顺手修掉（`calendar-profile-handoff.md` 不在写集，动它=越界）。
- 配对树自己也是现场：`teardown()` 一并 `worktree remove`（拒绝路径也收），成功路径落笔前收。
  顺带修掉 `teardown` 里那条 `fatal: Needed a single revision` —— 期望失败的那一读必须压住 stdio，
  否则成功退出的趟里印着一行 fatal（本文件第 0 步早就为同一件事写过注释，我在 teardown 里重犯）。

#### 一条装置层的自伤（写下来挡下一次）

探"模块能不能解析"时用了 `node -e 'import("./research/tools/selfhost-merge-carrier.mjs")'`，
而这类 `selfhost-*.mjs` **不是库，top-level 就是执行** ⇒ 那一趟**真跑了一次载体重算**（产出 `fba23c40`，
双亲正确、指针正确、日志没进文件所以读不到过程）。它没造成损害，但过程读数只能从
那笔的提交说明里复原。⇒ 会执行的文件不许用 `import()` 探解析，用 `node --check` 或合成输入调它导出的函数。

#### 现在 item 1 剩什么（23:5x 现量，别照这段的 SHA 行动）

- ✅ **A 层（提交态）已通**：九族全覆盖、`other=0`、八道纯 fs 门禁绿或逐条归属到非本批、归属通式集外 0。
  载体 `d6310288` 已经**落笔**（此前每轮都拒在族外冲突或门禁红上）。
- ⏳ **B 层仍是别人的**：`node research/tools/selfhost-landing-blockers.mjs` 现量的 `BLOCK ` 行数（上一轮是 1 枚 `package.json`）。
- ⏳ **C 层要窗口**：载体上的**完整 `pnpm check`**（要 node_modules、要起栈、`check:ai-e2e` 会 SIGKILL 别人的 dev server）。
- 🔴 **main 在本次重算之后又前进了**（`a12cc709` → `797fc05d`）⇒ 载体每次落地前重算，
  引用 `d6310288` 的结论只对它那一趟有效；本条下面这几行数字每次要重量。

### 8.143 🔴 归属层第一次响，是响在**我自己那句抄件**上（2026-10-04 23:5x–24:0x，提交 `f60bdf1b` `7baccf6d`，载体 `a2194a6b`）

上一节把 `check:docs` 那条非本批的红记进台账时，我把别人那条坏引用**逐字复述**了一遍 ——
写成「文件名 `.md` + 空格 + `§10.87`」。而 `docs-link-check.mjs` 的 `SECTION_REF_RE`
是 `/([A-Za-z0-9_./-]+\.md)`?\s*§\s*(\d+(?:\.\d+)*)/`，它**不区分 markdown 链接与散文里的路径**
（这是有意的：「见 `deployment.md` §3.7.1」是人话，也要判）。于是那一行变成仓库里的**第二条死链**，
而它住在**本批写集里的那枚文件**上。

载体的反应（现量，`CARRIER_RC=3`）：

```
check:docs：有 1 条缺陷**只在载体**（main 同道门退 1，逐字对不上）：
docs/research/self-host-distribution-audit.md:8609 -> docs/plans/trash-and-archive.md §10.87
⇒ 归属不成立的那些必须先在解法侧修掉；本工具不拿"看起来差不多"当放行。
现场：已 merge --abort ⇒ MERGE_HEAD=无 · 工作树脏 0 条 · 配对树已移除
```

🔴 **这一响是对的，不是门禁过严**：main 的红集点名的是 `calendar-profile-handoff.md:1187`，
载体多出来的那条点名的是我这行 —— 两条不是同一个缺陷，"main 也红"这句在我这行上不成立。
刚写完的归属层第一次在真载体上开口，就把自己的作者判了一遍。⇒ 可迁移的形状：
**记一条死链的方式是描述它，不是复现它的形状**；文件名与 `§` 编号要分开写（中间隔一个非空格、
非 `§` 的词），否则这段"证据"自己会进那一道门的分母。同族旧账：§8.18（把碎片抄进文章）、
§8.21（同一命题的第二种措辞）、以及记忆里那条「补话重抄字面量会磨平牙齿门」。

修完（只动本档，`docs-link-check.mjs` 在分支树上 `✅ 无死链`）后重算 ⇒ **`CARRIER_RC=0`**：

- 载体 `a2194a6b` = main `e4bd54b2` × 分支 `7baccf6d`，冲突 7 条全在预置九族内（`other=0`）；
- 链并集：`scripts 键 154 · check 链段 main=82 本批=67 base=66 并集=83（摘段 0/0）`；
- 八道纯 fs 门禁：`check:docs` 退 1、点名 1 条，main 同道门退 1 且这 1 条逐字都在
  ⇒ **非本批**（那条红仍在 main 上，本批不代改）；其余 7 道 exit 0；
- 🔴 main 在这一轮里前进 4 笔（`a12cc709` 23:49:53 → `797fc05d` 23:50:43 → `3b446075` 23:51:32 → `e4bd54b2` 23:54:38，五分钟内）
  ⇒ 载体每次落地前重算，引用 `a2194a6b` 的结论只对它那一趟有效。

**为什么抄进散文会响、抄进代码块不响**（现量在 `docs-link-check.mjs:209–216`）：它逐行扫，
一条围栏行会翻转 `inFence` 并**整行跳过块内内容**。所以上面那段工具原样输出放在围栏里是安全的，
而上一轮我那句散文（在围栏外）就是第二条死链。⇒ 复述一条坏引用有三种安全形状：进围栏、把文件名与 `§` 编号隔开写、或改成纯文字描述。

顺带把那条**没验过的抄件命令**换掉：原文写的是 `grep -oE '^#+ 10\\.[0-9]+' | sort -n`，
单引号里的 `\\.` 匹配的是"反斜杠 + 任意字符"，照抄会得到空集（空集在这里会被读成"那一节不存在"，
而它其实是判据没接上）。现在印的是实际跑过的那一条，并补第四条现量：目标那一节
**在主检出那枚文件的未提交版本里存在**（`10.84`–`10.91` 全在）⇒ 它的所有者提交后自愈，不由本批改那两枚文件。

**B 层现量（`node research/tools/selfhost-landing-blockers.mjs`）**：写集 64 / 脏条目 43 / **阻塞集 1 枚**（`package.json`）。
那五枚重叠文件里其余四枚已被各自所有者提交 ⇒ 等的只剩一枚，而它落在别人手里（落地解法工具自己写着"取并集，载体脚本已实现"）。
C 层（载体上的完整 `pnpm check`）仍未取 —— 要窗口，理由与判据见 §8.127 / §8.138，不写成已闭。

🔴 **同一趟还照出我自己那句假话**：归属通过后载体打的是「门禁 8 道全 exit 0」，
而它上一行刚打「载体红 1 道」。那句是 `selfhost-merge-carrier.mjs` 里写死的
`${GATES.length} 道全 exit 0` —— 归属过的红仍然是红（缺陷还躺在 main 上），把它印成"全绿"正是本批一直在拦的那类对外错话，
只不过这次的读者是下一轮的我。已改成从 `attribution.length` 推导（`N 道：M 道 exit 0 + K 道红已逐条归属到非本批`）。
⇒ 可迁移的形状：**新增一条"放行"分支时，要把所有下游的汇总句一起检查一遍**，
因为汇总句通常写在新分支之前、不知道世界上会出现第三种下场（§8.34 那个"并集从没写回"是同族：判据加了新分支，旧汇总句没跟着变）。

### 8.144 哨兵 v4（sh）→ v5（node）：三条实测理由，外加一条"它静死了没人知道"（2026-10-04 00:0x，`selfhost-window-sentinel.mjs`，v4 已删）

v4 收进仓库那节（§8.139）把它的设计讲全了，但**没讲它为什么该是 sh** —— 答案是"反正只是等"。
这一轮把它换成 node，理由三条都是实测的：

| # | v4 的形状 | 为什么换 |
|---|---|---|
| ① | `grep -o '阻塞集 [0-9]* 枚' \| tr -cd '0-9'` | 中文汇总是**第二本账**；工具同时打的是 ASCII 的 `BLOCK ` 行（本档 §8.133 就写了"数 BLOCK 行、别解析中文汇总"）。v5 把两条独立读数**互相咬合**：`BLOCK ` 行数必须等于汇总里那个数，咬不上 ⇒ `PROBE_BAD` ⇒ 按"不成立"处理。🔴 这条牙专门挡"0 枚"的两种下场（真没了 / 探针没接上）—— 我自己撞过一次（锚定行首恒得 0）|
| ② | `sysctl -n vm.loadavg \| tr -d '{}' \| awk '{print $1}'` | 同一族错过两次（§7 第 168 条、§8.40：`tr` 把分隔空格一起删、"修"完读到 5 分钟位）。v5 抽成纯函数 `parseLoad()` + 三位互不相同的合成样本自检，读错位就**响亮失败** |
| ③ | 端口探针写在 `node -e '…'` 里 | 判据被塞进 shell 单引号，引号一漂就是静默空读数。v5 直接 `import { deriveKillPorts, listenersOn }`，同进程、同判据本体 |

**第四条才是要紧的**：v4 那一趟 23:19 起跑、23:21 之后**静死**（日志里没有退出行 —— 是父 shell 被收走的），
而"有个东西在等窗口"这件事**读不出来**。下一轮只能靠"日志没长"猜，那是最容易被读成"还没到窗口"的形状。
⇒ v5 每样把 `pid / epoch / 这一样为什么不成立` 落进心跳文件，`--alive` 用 `ps -o pid= -p` 比**回显**判活
（`kill -0` 会把活进程读成已死，§7 那一族），并算心跳年龄。起跑后的正腿读数：

```
ALIVE=yes pid=14088（ps 回显="14088"）心跳=0 分钟前 · pid=14088 … run_on_open=1
last=["阻塞集=1","负载=71.03>12","端口被占：4319/13914,4318/13939","首样：没有\"上一样的 main\"可比"]
```

⇒ 窗口此刻**远得很**（一枚别人正占着的 dev server 端口 + 71 的负载 + 1 枚未提交的 `package.json`），
不是"快开了"。三条不成立的理由是哨兵自己打的，不是我推测的。

判据有牙只靠变异回答（本轮做的）：`--selftest` 14 条臂 control 全绿；
把 `s.blockers !== 0` 那一行摘掉 ⇒ **A1 精确转红**（期望 false 实得 true）、`MUT_RC=1`、还原后复绿；
变异体是同目录一次性副本（`import` 才解析得到），跑完立刻 `rm`，收尾 `git status` 只剩该进仓的那枚新文件。

⚠️ 演练臂顺手照出 v4 也带着的一处**会骗人的行**：`FORCE_OPEN=1` 打出的 `WINDOW_OPEN` 里印着真实负载
（实测 `负载=88.66` / `77.93`），下一轮很容易把它读成真窗口。v5 给那条加了
`WINDOW_OPEN【FORCE_OPEN=1 演练，不是真窗口】` 标记 —— 判据本体一条没减。

🔴 **不把它读成"落地已经自动化了"**：§8.139 那三条限制一条没变 —— 它可能真的在无人时把本地 `main` 前进掉
（用户已授权合并；`--ff-only`、不 push、不动主检出以外的东西），而落地**之后**的三件事一条都不自动：
从 landed main 重发落地页（#20/#21）、`pnpm reinstall:all`（第 8 项）、G-62/#39 那句"起完打开 `/app/` 就能用"。
本轮起跑：`CAP=14400 STEP=150 QUIET_MIN=15 LOAD_MAX=12 --run-on-open`，日志 `/tmp/selfhost-window-sentinel.log`、
心跳 `/tmp/selfhost-window-sentinel.pid`。

### 8.145 开窗之后"退 1 就退出"等于把窗口还给随机性 —— 哨兵改成会重试，但只对**时机类**退出码重试（2026-10-05 00:1x）

先记一条我自己写下的假设定：我看了一眼 §8.139 那句"开窗即 `--confirm`"就推断
**"main 每几分钟一笔 ⇒ 载体一定过期 ⇒ 哨兵会把窗口白白烧掉"**。
读源码把它否证了：`selfhost-land-main.mjs:328–354` 在没有 `--carrier` 时**自己就重算一次载体**，
还把 `✅ 载体 <sha>` 那行抠出来当读数（抠不到就按探针坏处理）。⇒ 这一条不是缺口，而我那句"一定会烧掉"
差一点变成下一轮的假台账。

真缺口是**另一件事**，而且是我自己那份设计留下的：`--confirm` 退 1（main 在算完载体后又动了一笔）或
退 3（负载/端口/载体没守住）时，v5 是 `process.exit(rc)` —— 等待器就此结束。而这两种退出码说的都是
**这一趟的时机不对**，不是产品红；窗口是按分钟计的稀缺资源，退出等于把已经拿到的窗口还给随机性，
下一轮要人重新起跑（v4/v5 各被这件事咬过一趟）。

⇒ 新逻辑（`decideAfterLand(rc, attempts, maxAttempts)`，默认 `MAX_ATTEMPTS=3`）：

| rc | 含义 | 干什么 |
|---|---|---|
| 0 | 已落地 | 退 0 |
| 1 / 3 | 时机不对（main 又动了 / 负载·端口·载体没守住） | **回到等待循环**，用满 3 次机会为止，最后把 LAND 的原码透出去 |
| 2 | 探针坏 | **不重试** —— 拿同一个坏探针再跑一遍还是坏的 |
| 4 | 载体上完整 `pnpm check` 红 | **不重试** —— 那是要人逐段归属的产品/归属问题，不是运气 |

🔴 重试的**时间纪律**是这条改动的要害，不是重试本身：回到循环后照样 `sleep STEP` 才计一样，
所以第二次尝试前必须**重新凑满** `QUIET_MIN` 分钟。若改成"立刻重样"，15 分钟这个代理指标会在几十秒内被凑满 ——
那等于为了多试几次而把判据自己摘掉。另一道闸是尝试次数：每一趟完整链是几十分钟高负载，
重试会把一次干扰变成 N 次干扰，所以封顶而不是无限。

读数（都是这一趟现量）：

- `--selftest` 20 条臂 control 全绿；变异只摘那道"只对 {1,3}"的闸 ⇒ **B4/B5 两条精确转红**、`MUT_RC=1`，还原复绿。
- 演练重试整条路径：`FORCE_OPEN=1 STEP=1 MAX_ATTEMPTS=2 --run-cmd 'exit 1'` ⇒
  第 1/2 次 ⇒ `LAND_RC=1 ⇒ retry` ⇒ `↩ 回等待循环` ⇒ 第 2/2 次 ⇒ 用满 ⇒ 停，**退出码 1 原样透出来**（没被改写成 0）。
- 换代码后重新起跑（先 `ps -o command=` 确认那枚 pid 确实是哨兵才 kill，再 `disown` 投放）：
  新 pid 43552，`--alive` 正腿成立；此刻它自己打的读数 `阻塞集=2 · 负载=38.3>12 · 首样` ——
  ⚠️ 阻塞集从 1 枚涨回 **2 枚**（别人新的未提交工作又压在写集上），这与 §8.84 那条"阻塞集会涨"是同一族，
  再次证明**不许拿上一轮的枚数当现状**。

#### 那两枚阻塞分别是谁（00:1x 现量，枚数与身份都会变，别照这段行动）

| 文件 | 谁手里 | 提交态会不会变成冲突 |
|---|---|---|
| `package.json` | 别人未提交（本批也改它：那条 `check` 整行链） | 🔴 **会**，而且已有预置解法（第九族之外的 pkg 族：取并集 + 写回 + round-trip 断言）|
| `scripts/check-gate-wiring.mjs` | 别人未提交 +20 行；本批相对 main 是 +46 行（第 3b 条那批） | **今天不会** —— 现量命令：`git merge-tree --write-tree --name-only main feat/self-host-distribution`（rc=1，恰好 7 条）里没有它；那 7 条是 `docs/research/self-host-distribution-audit.md` / `package.json` / `research/tools/check-image-license-coverage.mjs` / `research/tools/gen-image-npm-tree.mjs` / `scripts/screenshots/capture.mjs` / `server/Dockerfile` / `server/image-npm-tree.json`，逐条都落在预置族内。它现在是**纯 B 层**：只等他们把 +20 提交掉 |

⇒ 这条区分要紧，因为它决定"落地那一刻会不会多一道要人判的冲突"：`check-gate-wiring` 的落地解法工具自己写着
**"未预置 ⇒ 交人判（不要猜）"** —— 今天用不上，但他们那 +20 行一旦提交到同一段，就会从"B 层等一等"
变成"载体拒绝落笔"。所以落地前除了数枚数，还要**现量它是否进了冲突清单**（同一条命令的两行输出）。

### 8.146 落地体检（dry-run）在无人值守之外还能拿什么：一次零副作用的全闸门读数（2026-10-05 00:1x）

`node research/tools/selfhost-land-main.mjs` **不带 `--confirm`** 时把七道闸门全过一遍而不跑链、不动 ref、
不 SIGKILL 别人的 dev server —— 等窗口期间这是唯一"既不打扰别人、又能在真产物上重取每一条闸门"的动作。
这一趟的产出（下表是逐条抄出来的读数；原始日志在 `/tmp/g220-dryrun.txt`，会随 `/tmp` 清掉，所以**别把它当取证载体** —— 这同 v3 哨兵住 /tmp 被收进仓库是同一件事，§8.139）：

| 闸门 | 读数 |
|---|---|
| 载体双亲 | 脚本自己重算 ⇒ `94cb744e = main(5dc9359e) × 分支(eda43d8f)`；链段 `main=84 本批=67 base=66 并集=85（摘段 0/0）`、scripts 键 157 |
| 阻塞集 | 🔻 **从 2 枚掉回 1 枚** —— 上一节那枚 `scripts/check-gate-wiring.mjs` 已被它的所有者提交（这正是"枚数每次现量"的又一次回报）；只剩 `package.json` |
| 负载 | `45.17 > 12` ⇒ 环境无效（dry-run 只取一样，`--confirm` 要连续三样）⇒ 等窗口，不调阈值 |
| 端口 | ⏭️ dry-run 不跑链 ⇒ **不适用 ≠ 通过**（这句话是脚本自己打的） |
| 载体 node_modules 与锁同源 | ✅ 根工作区 `lock=0f3c1bf6d9e2(361300B) == installed` · e2e 套件 `021a9df4add8(993B) == installed` |
| main 未被抢先 | ✅ `5dc9359e` 仍是当前值 |

`DRYRUN_RC=1` 是**两条不成立按最严重那一档退**（阻塞集 + 负载），不是产品红。

🔴 一件顺手核对的：`--confirm` **不需要**有人先去重算载体 —— `selfhost-land-main.mjs:328–354` 在没有 `--carrier` 时
自己就调 `selfhost-merge-carrier.mjs` 并把 `✅ 载体 <sha>` 抠成读数（抠不到按探针坏处理）。
所以"哨兵开窗只跑 `--confirm`"这条自动化路径没有"载体一定过期"那个洞 —— 我差一点把它写进台账当缺口。
顺带：这一趟 dry-run 落的载体已经比上一节引用的 `9c6fffbc` 新了两轮（main 期间走了 `2ea0e3c0 → 5dc9359e`）
⇒ 本文件里所有载体 SHA 都只对那一趟有效，引用前先重跑。



### 8.147 「重新发布」第二次靠现场回忆，于是把顺序固化成一条默认不动手的命令（2026-10-05 00:3x–00:4x，`research/tools/publish-public-sites.mjs`）

**动因不是图省事。** 落地之后要重发公开站点（任务 19/20 那一格），而这同一条链**手工做过两次**，
每次都要现场回忆同样的五件事：从哪棵树发、挂载路径要显式给、发前两次产物对账、远端先备份、站点先发应用后发。
这五条只要漏一条，产出的都是一个**看起来成功**的对外状态 —— 而"看起来成功"正是这一族的全部危险。
本批又改了对外文案（台阶 0 那四条 + 那句「可安装」），**词条只有随构建产物发出去才对外可见**，
所以"停掉对外错话"这半件事的唯一关闭动作就是重发一次。

**装置形状**（`node research/tools/publish-public-sites.mjs`）：

- 默认 **dry-run**：只做只读守卫读数 + 原样打印九步的 argv，一条都不执行。`--confirm` 才真的 build / ssh / rsync。
  🔴 发布是对外动作，脚本不替人决定；它也不发服务端镜像（那仍然等 G-55 拍板）。
- 守卫三条各带变异读数：`HEAD == main`（不许发没进 `main` 的那一截）、构建输入零未提交、两个判据文件在树上。
  读不出来一律按**不成立**处理 —— 与 `selfhost-land-main.mjs` 同一个立场：宁可拒绝，也不发一个说不清来源的产物。
- 九步全是 **argv 数组**而不是拼好的 shell 串（`§7` 那一族里路径带空格会被拆）。
- `--selftest` 的臂数与 `--mutation` 的腿数**由命令自己打印**（这一节写的时候是 23 / 15，含未变异对照组）；
  地板 `arms.length < N` 随臂数只升不降 —— 摘掉一条臂，自检当场红。

**四条实测读数，其中三条是装置自己的缺陷**：

1. **按下标断言的臂，插一步就抛异常而不是报红。** 第一版 P1/P3/P4 写的是 `steps[0] / steps[1] / steps[2]`，
   M1（把一条 rsync 插进两条构建之间）当场让整份 selftest 抛 `TypeError` —— 响亮，但**九条臂的读数全没了**。
   改成按 argv 形状查找（`isWebBuild` / `isRsync` / `isAppCheck`…）后，同一次变异报出 6 条红。
   泛化：**"读不到"和"读出来是红的"是两种东西**；判据要能在结构变动下继续给读数，不然下一次改顺序的人只能重新推导。
2. **`argv.includes(x)` 在字符串上同样为真。** M6 把某一步的 argv 换成一个 shell 串，只有形状臂 P9 红，
   P1 那类顺序臂**跟着绿**。所以"没有一条是拼好的串"这条必须单独存在，它不是洁癖。
3. **P17 第一次跑就红，而且红得对**：`rsync` 的源目录**必须带尾斜杠**（不带会把目录本身嵌进目标），
   而 `check-web-artifact.mjs --dist` 收的是不带斜杠的目录名。拿字符串直接比会**恒假** ——
   恒假的判据比不判更糟（它永远拒绝正常路径）。改成比较归一化后的**同一个目录**，两边约束都保留。
4. 🔴 **守卫清单少两枚输入，而且没人会看见。** 第一版 `INPUT_PATHS` 只有 `apps/landing / apps/web /
   packages / server/public`，但这两次构建还吃 **`pnpm-lock.yaml`**（决定装进来的依赖）与根
   **`package.json`**（workspace 与 scripts 键），而第 9 步那条**线上验收读数**来自 `e2e/`。
   漏一枚的后果不是"少判一项"，是"发出去的字节仍然自称等于 main 那一笔"。现在三枚都在列，
   各有 P20/P21/P22 一条**行为臂**（喂脏字符串进去，看守卫拒不拒）。
5. 🔴 **桩不认 pathspec，四条守卫臂就全是假的。** 加完那三条臂，M12–M14 把清单里的条目逐个摘掉，
   红集**一条都没变** —— 因为 `fakeGit` 对 `status` 不管 `--` 后面列了什么都把脏串原样回给守卫。
   也就是说 P20–P22 测的是"桩会不会说脏"。改成按 pathspec 过滤后，摘掉哪一枚就恰好红那一条。
   泛化：**验证台的桩答"是"得太快，判据就会一致答"通过"** —— 加桩时先问它能不能回答"不"。
6. 🔴 **rig 的锚点扫到了 rig 自己。** 变异写进脚本后（`--mutation`），M2–M10 九条腿全部读成"红集为空"，
   看起来像"这九条判据都没牙"。真实原因：`rep()` 的实参锚点在**整份文件**里命中 2 次
   （一次在 `planSteps`，一次在 rig 自己的 needle 字符串里）⇒ 命中数断言抛错 ⇒ 子进程没打印任何 `RED` 行。
   修法是把变异作用域限定在 `planSteps` 那一段（`PLAN_START` → 自检标记之间）。
   泛化：**把 needle 写进同一个会被自己扫描的文件时，先问这个 needle 在文件里出现几次**；
   而"九条腿的红集同时为空 + 对照组却正常"这个形状本身就是探针坏的信号，不是判据坏。
   配套的第二次修正：`--mutation` 起初把"父进程没造出变异体"和"子进程跑了但一条没红"**都读成红集为空**，
   换完作用域后 14/15 条腿一起变"不符"才暴露。现在两条分开报 —— 后者才是"判据没牙"，前者必须说"探针坏"。

**顺带把两份抄件钉在一起**（`P19`）。脚本里的九条命令是 `docs/runbooks/deployment.md` 里那一组的第二份抄件，
留两份而不对账，等于把"手抄要现场回忆五件事"换成"手抄和脚本各自回忆"。
P19 比的是**目的目录集合**而不是出现次数 —— 那一节里三处历史事故记录各自印着同一条命令，
而那些段落明写"不要改写这一段本身"（判次数会把它们读成漂移）。
M11 把脚本侧的 `heyta-app` 改名 ⇒ `P7 P17 P19` 三条红（顺序、对账对象、抄件各一条，互不遮蔽）。
runbook 那一节加了一段指针，说明谁是命令本体、谁是逃生门。

**现量（这一趟，不是结论）**：`--selftest` 臂数 23 · 红 0；`--mutation` 15 条腿 · 不符 0；
`node research/tools/docs-link-check.mjs` 打印"无死链…无失效章节引用"（新加的 `.mjs` 散文引用不在扫描集内 —— 它只收 `.md`）；
dry-run 守卫读数 `HEAD=0ba6df54 · main=cd689365`、构建输入脏 **0** 条 ⇒ 拒发，退 1，一条命令没执行。

**守卫的正反两路都在真实树上各跑过一趟**（不是只有假 git）：在临时 detached worktree
`/tmp/heyta-pubcheck-<pid>` 里 checkout 本批一笔（`6da18b2f`），`--selftest` 臂数 23·红 0；
`HEYTA_PUBLISH_REF=<该笔 SHA>` 时守卫成立、九步全打印、`B_RC=0` 且**一步都没执行**（默认 dry-run）；
把 `pnpm-lock.yaml` 追加一行 ⇒ `C_RC=1` 并点名 `M pnpm-lock.yaml`；还原后把 `apps/web/src/main.tsx`
追加一行 ⇒ 同样拒并点名。用完 `git worktree remove --force` 清场。
⚠️ 这一趟的"守卫成立"是**拿 SHA 当 ref** 做的正路验证（模拟"这棵树正好等于要发的那一笔"），
真实发布时 ref 是 `main` —— 两者走的是同一条比较，但**这不等于线上已经可以发**。

**没有主张的事**：`--confirm` **没有跑过**（对外动作，且现在这棵树不是 `main`）；
这条链**没有自动消费方** —— 它是落地之后由人敲的一次动作，它的"消费者"是 runbook 那一节 + 它自己的两条自检。
所以它不进 `pnpm check`（一次发布不该变成每次 push 都跑的东西），但它一旦红了就是"下次发不出去"，
这就是为什么 20 条臂里有 8 条在判顺序与对账对象，而不是只判文件存不存在。

### 8.148 main 一夜走了 30+ 笔之后重取落地体检：缺的还是同样两格，冲突面一枚没新增（2026-10-05 00:4x，载体 `e23e5085`）

趁没人手时把落地体检（dry-run，零副作用）重跑一趟，为的是回答一个问题：**窗口真开起来那天，会不会当场冒出一个没人预置过的冲突族**。
读数是"不会"：

```
node research/tools/selfhost-land-main.mjs        # 不带 --confirm：只读数，不 build、不 SIGKILL、不动 main
```

| 闸门 | 这一趟读数 |
|---|---|
| 载体 | `e23e5085 = main(09ed85c0) × 6585ca66`，第一父 = main（按 ref 名认，不按 SHA 抄） |
| 并集 | scripts 键 **157** 个 · check 链段 `main=84 本批=67 base=66 并集=85（摘段 0/0）` · 非 scripts 顶层字段比了 9 个，两侧改动全落进磁盘对象（丢 0） |
| 门禁 | 8 道：**7 道 exit 0 + 1 道红已逐条归属到非本批**（归属层继续工作；摘要句是推导出来的，不是手写的——见 §8.143 那句修过的谎） |
| 阻塞集 | 🔴 1 枚 = **`package.json`**，从昨天到现在**同一枚没换**（别人未提交的工作树，不是合并冲突） |
| 负载 | 🔴 54.3 > 12（第 1/1 样）⇒ 环境无效 |
| 端口 | ⏭️ dry-run 不跑链 ⇒ 不适用 ≠ 通过 |
| node_modules | ✅ 与当前那把锁同源：根 `lock=0f3c1bf6d9e2(361300B)`，e2e `lock=021a9df4add8(993B)` ⇒ 落地那一刻**不需要重装依赖**（一夜 30+ 笔没动锁） |
| main | ✅ 体检当时仍是 `09ed85c0`，没被别人抢先 |
| 退出 | `DRYRUN_RC=1`（两条不成立，按最严重那一档 = 阻塞集） |

**顺带一条探针教训（差点写成"零冲突"）**：取冲突面时我先用了
`git merge-tree --name-only "$BASE" main <sha>`（**三参数老形状** + `--name-only`）——
输出 **0 行、rc=0**。这形状读起来就是"干净合并"，而真答案是**同样那 7 枚**
（`docs/research/self-host-distribution-audit.md` / `package.json` /
`research/tools/check-image-license-coverage.mjs` / `research/tools/gen-image-npm-tree.mjs` /
`scripts/screenshots/capture.mjs` / `server/Dockerfile` / `server/image-npm-tree.json`），
`git merge-tree --write-tree --name-only main <sha>` 才给：rc=**1** + 上面那 7 行 + `CONFLICT (content)` 明细。
泛化：**空测量是最像"通过"的一种读数** —— 三参数老形状的 `--name-only` 根本不生效，
它不是"没有冲突"，是"这个形状不报冲突"。取这类读数要抄仓内脚本用的那一条命令，不要凭记忆拼。
⚠️ 另：`main` 在这两行命令之间又前进了一次（`09ed85c0 → 7ba7c5e2`），所以上表**只对那一趟有效**。

**这一节的结论**：落地这条路上，本批侧**没有新的未知**——等的仍是
①那一枚 `package.json` 被它的所有者提交，②一次负载 ≤12 且五件同时安静的窗口。
看守（pid 43552，`CAP=14400 STEP=150 QUIET_MIN=15 LOAD_MAX=12 MAX_ATTEMPTS=3 --run-on-open`）在等；
它拿到窗口时跑的是 `--confirm`，那时才第一次真的跑完整 `pnpm check`（dry-run 明确不跑，见上表"不适用"两行）。

### 8.149 那张许可证登记表到底有没有牙：三条变异臂离线测完，装置放进自己的文件（不撑宽冲突面）（2026-10-05 00:4x，`research/tools/selfhost-license-coverage-arms.mjs`）

**补的是 #29 明写"仍未测"那一格**：G-47 的许可证对账一直只有**通过读数**（"17 条逐条登记过"），
而登记这张表是人抄的 —— 没测过"摘掉一条会不会红"，就等于没测过它拦不拦得住东西。
上一轮这条臂**施错了对象**：把"镜像独有"错当成"不在 `lockEntries` 里"，算出 0 条、什么都没摘、
`rc=0` 是空臂的必然。集合定义后来钉准了：**不在 `license-inventory` 的扫描集里**才是那批条目，
而这张表就在 `check-image-license-coverage.mjs` 里（`IMAGE_ONLY_PACKAGES`）。

**这一趟不需要 docker**（该门禁的 `snapshot` 载体本来就设计成可离线挂到 `pnpm check` 上），
所以当场测完了三条：

| 臂 | 施法 | 读数 |
|---|---|---|
| 对照 | 未变异 | `rc=0`，输出无 ❌ ⇒ 三条臂都不是无条件红 |
| A | 从表里**摘掉一枚真登记**（`@node-rs/argon2-linux-x64-gnu@2.2.1`） | `rc=1`，**两层**红：①"有 1 条许可证门禁**从没见过**的包"；②"计数不闭合 covered(126)+豁免(16)+自家(3) ≠ 146" |
| B | 塞一条**幽灵登记**（不在快照里、也没写 `carrier`） | `rc=1`："__pubcheck-ghost@9.9.9 已经不在快照里了（登记该删，或给它写 carrier）" |
| C | 把 `carrier` 写成不存在的载体名（拿它当逃避过期检查的后门） | `rc=1`："登记的 carrier=whichever 不是 snapshot / installed-tree 之一 —— 这不是'跳过检查'的开关" |

现量顺带一条：**这张表今天是 17 枚**（`146 = 门禁扫描集 126 + 登记 17 + 本仓库自家 3`），
不是 §8.101 那批引用的 16/143 —— 引用旧数字会漂，取数请用
`node research/tools/check-image-license-coverage.mjs` 自己打印那一行。

**为什么装置单独一个文件**（而不是给门禁加 `--mutation`）：
`research/tools/check-image-license-coverage.mjs` 是本批与 `main` 的**七枚冲突路径之一**（§8.145 那张身份表），
往里加 60 行装置代码 = 落地那一刻把合并面再撑宽一层，而这几行判据撑不起那个代价。
所以这里改的是它的**一次性副本**（写完就跑、跑完就 `rmSync`，原件零改动；实测残留 0 枚）。
表被改名时 `firstKey()` 取不到第一枚登记项会**抛错**而不是"什么都没摘"—— 上一条那种空臂事故的形状，写死了不让它再来一次。
装置自己踩到的一次：`ROOT` 少剥一层（`research/tools` → 仓库根需要 `'..','..'`），
`readFileSync` ENOENT 当场炸 —— 报错比"静默空臂"好。

~~🔴 **仍没测的那一半**：同样的三条臂在 `--installed-tree`（真树）载体上还没施过 ——
那一趟要跑起来的镜像，排在落地后的低负载窗口，与 #28 同一趟。~~
🔴 **这句当场被自己否证，划线留在这里**：真树 dump **不是构建窗口级的贵事**。本机就有那枚镜像
（`supersync:selfhost-verify`，`074da09c8436`，6 小时前 §8.118 那次 verify 留的），
一条秒级的一次性容器就导得出来（命令形状从 `scripts/verify-selfhost-stack.sh:308-309` 抄，不凭记忆拼）：

```bash
docker run --rm -i --entrypoint node supersync:selfhost-verify --input-type=commonjs - \
  < research/tools/dump-installed-tree.js > /tmp/tree.json
node research/tools/selfhost-license-coverage-arms.mjs --installed-tree /tmp/tree.json
```

**两种载体各 4 条腿，都是 0 不符**：

| 载体 | 对照组 | A 摘掉一枚真登记 | B 幽灵登记 | C `carrier` 后门 |
|---|---|---|---|---|
| `snapshot` | `rc=0` 无 ❌ | 摘 `@node-rs/argon2-linux-x64-gnu@2.2.1` ⇒ `rc=1` **两层**红 | 红"已经不在快照里了" | 红"不是 snapshot / installed-tree 之一" |
| `installed-tree`（真镜像里那棵树，`145 = 126 + 16 + 3`） | `rc=0` 无 ❌ | 摘 `@node-rs/argon2-linux-arm64-musl@2.2.1` ⇒ `rc=1`，报的是**"真镜像里装上的那棵树里有 1 条门禁从没见过"** | 红"已经不在真树里了" | 同上 |

⚠️ 真树这一趟挑的是**在这棵树里**的登记项，这一点是装置自己判的（`firstKeyIn` 拿 dump 的
`name@version` 集合求交，交不出就抛错）—— 表里有些条目声明 `carrier: 'snapshot'`，
在真树那趟本来就不参与判定，摘那种会"什么都没摘"而被读成"这条臂没牙"，正是 §8.101 那次空臂事故的形状。

**所以这一节的主张现在到这一句**：这张登记表在**两种载体上都有牙**（摘掉/塞假/走后门各红一次，
对照组未变异时不红）。仍**不**主张的是：这棵真树来自 6 小时前那次 verify 的镜像，不是当前产物的树 ——
"发出去的字节里有牙"要等落地后 `verify:selfhost-stack` 重跑那一趟（那趟会顺手把 dump 导成当天的）。

### 8.150 全栈现量**现在还是不是**当前产物的读数：一条命令答完（差额 172 笔，产品构建输入 0 改动）（2026-10-05 00:5x）

目标第 2 项那句"`pnpm verify:selfhost-stack` 全跑拿现量"闭在 §8.118（`STACK_RC=0 / 3 passed / FRESH=4/4`，四张图人看过）。
但它此后又落了十几笔本批提交 ⇒ "那次读数还成立吗"这一问题每次都要重答，**答法不能靠印象**。
判据就一条，量的是**自那次读数以来有没有动过产品构建输入**：

```bash
git diff --name-only 37639f11..HEAD -- apps packages server/src server/Dockerfile \
  server/package.json server/package-lock.json server/prisma server/scripts   # 枚数 = 0
```

这一趟读数：**0 枚**。期间变的 7 个文件全在判定与证据那一侧（两枚 `e2e/live-site/*.spec.ts`、
三枚 `e2e/selfhost-stack-results/*.png`、`server/README.md`、`server/tests/version-coupling.spec.ts`）
—— 它们改的是"怎么判"和"判完留下什么"，不是"发出去什么"。
所以：**§8.118 那趟全栈现量仍然覆盖当前产物**，不需要为了"读数新鲜"重跑一次十几分钟的 docker 构建。

🔴 这句话的边界要写清，它**不是**"不需要重跑"：
① 落地之后必然要重跑（载体的 `pnpm check` 里就含 e2e，且 main 那侧别人的改动会进构建输入）；
② 本命令只覆盖 `apps/ packages/ server/` 这几条路径，若哪天有构建输入住在别处（例如根配置），
   这条判据的射程就要跟着改 —— 它的强度取决于**列出来的路径是不是全部输入**，不是"跑过了"。

顺带两条现量（都会漂，留命令）：
- 全批差额 **`git rev-list --count main..HEAD` = 172 笔**（这一天的凌晨还是几十笔量级，main 一夜在走）。
- 哨兵 43552 活着（37 分钟），它最新两样报的是 **端口被占：4319/57632、4318/57643** ——
  也就是说这一晚挡住落地的不止负载与那一枚 `package.json`，还有别人的 dev server 站在 `--confirm`
  会 SIGKILL 的那一段射程上。这条正是哨兵第三条判据**在做它该做的事**：与其开窗后被
  gate 5 打回来，不如不开。**别把它读成"哨兵太严"**，更别去调那个阈值。

### 8.151 重装新鲜度对账第一次有牙（两份实现各 7 臂，5 支精确报红），并照出一处**空对空**敞口（登记 **G-63**）（2026-10-05 01:0x）

触发点是 §8.134 ⑤ 那张"仍然真缺的格子"表里的第 3、4 格。两格现在各有各的下落，**先记下落再记读数**：

- **第 3 格（G-40④/⑤ 的"失败与恢复"没有会红的判据）已由 §8.135 关闭** —— `server/tests/version-coupling.spec.ts`
  5 条检查各配同趟阳性对照，外加 8 条注入臂（其中 3 条是**塌缩臂**，专门拦"作用域塌了却读出一堆 0"）。本条只做对账，没有重跑它的必要。
- **第 4 格（重装新鲜度从未被变异验证）本条做掉**，但动手前先量了载体，量出两件必须先写的事。

#### ① 那条登记自己的指针就是漂的，而判据本体**换了主人**

§8.134 写的是"`scripts/reinstall-all.sh` 的新鲜度对账（`:150-151`）"。现量：那两行是**注释**，判据早在 09-30 就抽到了
`scripts/lib/sync-windows-sources.sh`（`reinstall-all.sh` 那里只剩一行 `source`）。取法：

```bash
grep -n 'local_hash="$(shasum' scripts/lib/sync-windows-sources.sh   # 判据在这里
grep -n 'sync-windows-sources' scripts/reinstall-all.sh              # 命中两行：一条注释 + 一行 source（source 那行才是消费方）
```

🔴 更要紧的是**这份文件在我这条分支上一行没动、在 main 上被重写了三笔**（`f4fe87d2` 加"按枚数"的对账、
`0858032e` + `5be80374` 把公共半抽成 `_heyta_windows_sync_push`：清单 → tar → scp → **tar 的 sha256 对账** → 远端先清后解，
并让 Android 远程构建那一腿共用同一份）。现量与取法：

```bash
git rev-parse main:scripts/lib/sync-windows-sources.sh HEAD:scripts/lib/sync-windows-sources.sh   # 两个 blob 不同
git diff 'main...HEAD' -- scripts/lib/sync-windows-sources.sh | wc -l                              # = 0 ⇒ 本分支自合并基以来没动
```

⇒ 落地时这一路径**没有冲突**（只有一侧改过），走"取 main 侧"。所以**只在 branch 那份上跑出"有牙"是不算数的** ——
读的是落地后不会跑的那份代码。这是 §8.136 那条"判据要拿到落地后的树上预跑"的镜像版本：这回连预跑都不用等，
直接把 `main:` 那一份取进装置就行。

#### ② 装置：一次性临时 git 仓 + `ssh`/`scp` 垫片，两种来源各跑一遍

`research/tools/selfhost-windows-sync-arms.mjs`。**为什么必须垫片**：这一族判据的本体是"远端字节 == 本地字节"这个**裁决**，
而真跑一次会把 `C:\src\heyta` 覆盖成我这棵树的状态 —— 那是另一条会话（Windows / Android 远程构建那条线）**正在用的构建输入**，
不是可以拿来"验一次判据"的耗材。装置做的事：

- 在 `mkdtemp` 出来的临时 git 仓里放一份被测库（`--source branch` 取工作树那份，`--source main` 取 `git show main:` 那份）、
  两枚构建输入（`apps/web/dist`，桥的 bundle 由桩脚本生成）、以及 `bin/ssh` + `bin/scp` 两个垫片；
- 垫片只认三类远端命令（解包、`Get-FileHash`、`Measure-Object` 计数），**认不出的命令退 9 并打印原文** ——
  "判据读了一个装置没模拟的形状"会响，不会静当成通过（§8.147 那条"桩必须能回答不"的同一件事）；
- 装置会写 `/tmp/heyta-src.tar.gz` 与 `/tmp/heyta-src-files.txt` —— 那正是真脚本硬编码的两个临时名，
  所以它**先查有没有活着的远程构建宿主**（`reinstall-all.sh` / `run-gradle.mjs` / `verify-windows-shell-journey` / `package-msix`），
  有就退 3 并点名是谁（环境无效 ≠ 判据红）。

#### ③ 读数（2026-10-05 01:0x，两份实现**逐臂相同**；臂数与每臂读数由装置自己打印，台账不抄分母）

| 臂 | 伪造什么 | 期望 | branch 侧 `d127ad37…` | main 侧 `17d3d47b…` |
|---|---|---|---|---|
| 对照 | 什么都不改 | 绿 | `rc=0` +「远端新鲜度对账通过」 | 同 |
| A | 远端 `index.html` 解包后多一字节 | 红，且点名 index.html | ✅ | ✅ |
| B | 远端桥 bundle 多一字节 | 红，「桥的 bundle 不新鲜」 | ✅ | ✅ |
| C | 远端 `assets/` 留一枚旧 chunk（"只增不减"那一族） | 红，「远端 chunk 数」 | ✅ | ✅ |
| D | 远端 `Get-FileHash` 读不到 | 红（**不是**当成两边相等） | ✅ | ✅ |
| E | 远端 chunk 计数读不到 | 红，「数不到远端」 | ✅ | ✅ |
| F | **本地 `apps/web/dist` 里没有 `index.html`** | 期望红 | 🔴 **绿** | 🔴 **绿** |

A–E 五支精确点红自己那一句、对照组不红 ⇒ §8.134 ⑤ 第 4 格要的"有牙"这件事**现在有了**，
而且是在**落地后真正会跑的那一份**上有的。

#### ④ F 这一臂照出来的敞口，登记为 **G-63**（未闭，且**不归本批改**）

形状：本地 `apps/web/dist` 目录**存在**（过得了那句构建输入存在性的 `[ -e "$p" ]`）但里面**没有 `index.html`** ——
比如一次半途失败的 vite 构建留下的目录。此时：

- `local_hash` 空（`shasum` 读不到文件），`remote_hash` 也空（远端那个路径同样不存在，被 `grep -E '^[0-9a-f]{64}$'` 滤成空）
  ⇒ `[ "$local_hash" != "$remote_hash" ]` **不成立**；
- 桥的 bundle 两条都在 ⇒ 红不了；`assets/*.js` 两侧**枚数相同**（都是这一份残包里的数量）⇒ 红不了；
- 于是判据打印「✅ 远端新鲜度对账通过」并 `return 0` ⇒ 打包继续，装出来的包里那枚 `index.html` 根本不存在。

🔴 **main 新加的那条整包 tar sha256 对账挡不住这一发**：它证的是"远端拿到的是不是**这一包**"，
而这一包本来就与本地逐字节相同 —— 包里缺东西，两边一样缺。**"两边一致"从来不等于"两边都有内容"**
（与 §8.135 那三条塌缩臂、以及"空测量看着最干净"同一族）。

修法（三行，写在这里是为了让下一读的人不用重新推）：把 main 已经用在远端 tar 上的那条"读不到就拒"搬到**本地侧** ——
`local_hash` / `local_bridge` 必须匹配 `^[0-9a-f]{64}$`、`local_chunks` 必须 ≥ 1，任一不成立即 `return 1`。

**为什么不在本批顺手改**：这个文件本分支一行没动，我改它 = **两侧都改** = 落地时多一枚冲突族，
而 `research/tools/selfhost-merge-carrier.mjs` 登记的九族里**没有它** ⇒ 载体退 2 点名、落地要人现场拍"取哪侧、怎么并"。
那等于把别人正在承重的判据变成"本批落地的阻塞"：收益是三行代码，代价是整批多一族冲突面，而**那三行由那条线自己改是零成本**。
装置 F 臂就是这条登记的复现与关闭判据 —— **哪天那三行落下去，F 臂会自己转红并打印"把这条臂的 expect 改成 red"**，
敞口不会静着烂掉。

#### ⑤ 边界（别读多）

- 装置证的是**裁决逻辑**（比较、拒绝、"读不到算红"），不证真 PowerShell 的 stdout 能被那个 `grep` 解析 ——
  那是真跑过的读数（`M2D=OK` 那一族）给的，两者不互相覆盖。
- 装置不跑 `reinstall-all.sh` 本体（那要真设备 / 真打包），所以它**不**关闭第 8 项的"平台验收"与"当前产物"两格 ——
  那两格仍然只在落地后的 `pnpm reinstall:all` 那一趟上。
- 这格现在算闭到：**"失败与恢复"从"只有通过读数"变成"5 支有牙 + 1 支敞口已编号"**。

### 8.152 窗口一开就会退 2 的那两枚新冲突面：载体补第十/十一族，并用一次 throwaway 载体复跑验到"解法真的走通"（2026-10-05 01:1x–01:2x，`785ea171` `bbbd629e`）

#### ① 现量：冲突面从 7 枚涨到 9 枚，而涨出来的两枚**不在预置九族里**

```bash
# merge-tree 的产出是四段：OID 行 / 冲突路径 / 空行 / "Auto-merging…" 与 "CONFLICT…" 的旁白。
# 🔴 取路径必须**在空行处停**：整段喂给 grep 会把 "Auto-merging" 当成一枚路径去查族
#    （本条第一趟就这么错了一次，报出六个假 OTHER）。
PATHS=$(git merge-tree --write-tree --name-only main feat/self-host-distribution \
         | awk 'NR>1{if($0=="")exit; print}')
echo "$PATHS" | wc -l          # = 9（01:2x 现量）
for p in $PATHS; do
  grep -q -F -- "$p" research/tools/selfhost-merge-carrier.mjs || echo "OTHER: $p"
done
#   ↑ 没有 OTHER 输出 = 预置各族覆盖住了这 9 枚；出现 OTHER 就是"开窗后 --confirm 会退 2"那一发。
# 单枚的族命中数（本条当时量出来 0 命中、随后被补成族的那两枚）：
grep -c -F 'docs/runbooks/deployment.md' research/tools/selfhost-merge-carrier.mjs          # 现在 ≥1（第十族）
grep -c -F 'e2e/live-site/live-domain.spec.ts' research/tools/selfhost-merge-carrier.mjs    # 现在 ≥1（第十一族）
```

分族表是**精确匹配**，落不进任何族 ⇒ `fam.other` ⇒ 退 2 并点名。这件事的代价不是"多一条错误信息"：
哨兵等的是**窗口**（阻塞集 0 + 负载 ≤12 + 端口空 + 载体空闲 + main 连静 15 分钟），
而 01:0x 那几拍现量是 main 每 2–3 分钟走一笔、`连静=0/6` —— 窗口是稀缺资源。
在窗口打开之前不预置解法，就等于把等来的一整趟白烧掉。所以这一条排在第 2 项之前做。

#### ② 两枚的形状不一样，解法就不一样 —— 这是形状决定的，不是偏好

| 族 | 形状（diff3 现量） | 解法 | 无损怎么证 |
|---|---|---|---|
| **第十族** `docs/runbooks/deployment.md` | 1 个冲突块，**base 段为空** ⇒ 两侧都在同一处纯追加（各自写了一段"这一步为什么在这里"） | 并集（ours 段 + theirs 段） | **块级**：两侧块内每一行都必须在产出里 + 无标记残留 + 段数算术 |
| **第十一族** `e2e/live-site/live-domain.spec.ts` | 1 个冲突块，**base 段非空** ⇒ 两侧各写了"先在界面上点同意、再探测"这**同一件事的两种实现** | 取 main 侧，并把本批侧被丢的独有行打进读数 | 结构断言：`const probe = await page.evaluate` 与 `privacy-consent-accept` 的命中数必须**等于 main 那一份的命中数** |

🔴 第十一族**不能并集**：它的 theirs 段把 base 的 `const probe` 那几行又写了一遍，并集会产出两枚同名声明，
语法就不过 —— "两边都保留"在这种形状上不是保守，是把代码改坏。所以这一族自己带着一条反向臂：
union 在这里必须拒绝，或者被结构断言抓住。
取 main 侧的理由写在调用点：**那一侧的读数更新**（10-05 线上实测，`waitFor` + 断言消息 + 超时）。
本批那版只多一处 `.first()` 严格模式护栏 ⇒ 记成 **G-64 / 任务 #41**，落地后由这条线回补到 main 那版之上，
**不在载体里现写第三种没跑过的写法**（那会把"落地"变成"未经检验的修改"）。

判据本体抽成 `research/tools/selfhost-text-merge.mjs`，与第九族同一个理由：要能在**没有 worktree、
不碰哨兵那枚热载体**的条件下被打红。自检 **9 臂**（真实两枚各走自己的解法、base 非空时 union 必须拒、
从产出偷摘一行块级检查必须响、把 `probe` 复制成两枚结构断言必须响）：

其中 **U4 挡的是我自己先写错的那版判据**：无损检查最初写成"两侧**文件里**每一行都要在产出里"，
第一次跑真实 `deployment.md` 就红在"缺本批的 3 行"—— 那是 main 在**块外**改掉的散文，
本来就不该在产出里。判据写宽一档 = 每次落地都恒红 ⇒ 下一位会去摘掉它。改成块级之后 U4 专门跑这个反例。

#### ③ throwaway 载体复跑（两枚新族的端到端读数）

真载体 `/tmp/heyta-merge-carrier` 是哨兵那枚，**不能用它试**（占用会破它的"载体空闲"判据），
所以整套跑在一次性副本上，跑完删掉：

```bash
HEYTA_CARRIER_WT=/tmp/heyta-tm-probe-wt HEYTA_CARRIER_BRANCH=feat/self-host-tm-probe \
HEYTA_CARRIER_PAIR_WT=/tmp/heyta-tm-probe-pair node research/tools/selfhost-merge-carrier.mjs
```

01:2x 那趟的读数：`冲突 9 条` → `分族：… deploy=1 lspec=1 **other=0**` →
`第十/十一族判据自检：臂数 9 · 不符 0` → `deployment.md 并集：纯追加块 1 个、两侧块内行全部留在产出里（块级无损检查过），产出 2361 段` →
`live-domain.spec.ts 取 main 侧…本批侧被丢的独有行 18 条（前三条打在读数里）` → `合并归属：写 68 / 集外 0 / 写集里未被改到 0`。
🔴 这趟最后 **EXIT=3**，红在 `license-inventory 找不到任何 pnpm store` —— throwaway 副本没装依赖。
归属层对它报的是"这道门没有缺陷行提取式 ⇒ 判不了（不放行）"，也就是**fail-closed 对了**：
环境缺件套出来的红，不该被算成"非本批缺陷"而放行。
⇒ 这一趟证明到的是**分族与两族解法走通**，不是"载体全闸门绿"；后者只有哨兵那枚装了依赖的热载体给得出。

#### ④ 这一趟顺带照出来的两条（都已入装置，不必再靠人记）

1. 🔴 **`/tmp` 是 `/private/tmp` 的软链**：模块用字符串比 `argv[1]` 与 `import.meta.url` 判"我是入口"，
   在载体路径下判成假 ⇒ 自检**一条臂都没跑，而 rc 还是 0**。是调用方那道"按输出内容判、不按 rc 判"的
   闸门把它拦成退 2 的（`臂数行：（没有这一行）`）。修成 `realpathSync` 两边都比。
   📌 ~~**待入 `docs/reference/environment-traps.md`**（编号按主检出工作树现量取，别按 HEAD —— 多人台账，
   理由见 §8.135 那条同款）~~ ⇒ **10-05 01:4x 撤回，读数见 §8.153 ③**：这条机制 main 那边已经入档
   （`#193`，比这条更完整的两版本），本批再插一行就是给载体添第十二族。
   **"入口判断比字符串"的症状不是崩，是安静地什么都不跑**；
   凡是消费侧只看退出码，它就会以"通过"的样子烂掉。同族的正面做法即第八/九族那条"判输出内容"口径。
2. `fam.other ⇒ 退 2` 这道闸门**本身是好的**（这次就是它把两枚没预置解法的路径点名的），
   但它只在**真跑载体时**响。所以这一批把"冲突面枚数与族覆盖"变成一条可以在**开窗之前**跑的命令
   （上面 ① 的三行），以后每次 main 大幅前进后先量它，再等窗口。

#### ⑤ 边界

- 本节的冲突面枚数、族计数、产物段数都是 **01:1x–01:2x 的瞬时读数**；
  下一次 `--confirm` 之前必须重量 ① 那三行 —— 这一夜 main 走了 30+ 笔，涨出来的可能不止这两枚。
- 装置跑在 throwaway 副本 ⇒ 它不替代第 1 项的关闭判据（载体上**完整** `pnpm check`）；
  它替代的是"开窗后才发现要现场拍"。

### 8.153 并集链的第三种洞（链条目在、脚本没了）关在窗口之外：新增 `selfhost-chain-targets.mjs`（11 臂自检，三个裁判对象现量 0 悬空）+ 换掉那枚只活到 04:15 的哨兵（2026-10-05 01:2x–01:4x）

#### ① 为什么这件事排在第 1 项之前

第 1 项要求"在合并载体上跑**完整 `pnpm check`**"，而完整链这辈子只在落地那一刻真跑过一次。
10-05 01:3x 现量两侧链条目数与"每条点名的脚本在不在树里"：

| 裁判对象 | 链步 | 取到脚本目标 | 不在射程 | 悬空 |
|---|---|---|---|---|
| 载体提交 `feat/self-host-merge-main` | 85 | 82 | 7 | 0 |
| `main` | 84 | 81 | 7 | 0 |
| 本分支 `HEAD` | 67 | 64 | 7 | 0 |

"不在射程"那 7 条三棵树**逐字同一份名单**（4 条 `--filter`：`check:entries`/`check:adaptive-cards`/`check:pwa`/`check:tokens`，
3 条 `-r` 或指向 `-r` 的根条目：`build`/`typecheck`/`-r test`），按名字打全，不是静默跳过 —— 数法见 ②。

**现量差本身就是要防的东西**：main 的链比本分支多 18 道、本分支比 main 多 1 道
（只在 main：`check:shell-surfaces` `check:op-log-semantics` `check:selection-single-source` `check:legal-tools`
`check:legal-permissions` `check:legal-closure-truth` `check:legal-gdpr` `check:doc-citations` `check:md-tables`
`check:brand-assets` `check:public-facts` `check:card-export` `check:ios-native-bridges` `check:vault-diagnostics`
`check:verify-script-copy` `check:android-gradle-remote` `check:apk-freshness` `check:shell-erasure-parity`；
只在 branch：`check:image-build-args`）。第一族对根 `package.json` 取的是**两侧链的并集**，
于是有一类红既不在这棵树上也不在那棵树上，只在**并起来那棵树**上：
**链条目留着，脚本文件被另一侧删了** ⇒ 完整链走到那里以 `Cannot find module` 收尾。
两种收场都不是"落地"：要么当场烧掉一整枚窗口，要么配对树那一侧根本不跑这一道、
归属只能把它记成"本批带进来的"。

#### ② 判据本体 `research/tools/selfhost-chain-targets.mjs`

- 逐条链步 `pnpm X` → `scripts[X]`（展开一层嵌套，带环守卫），从命令体里取"像仓库内脚本"的 token
  （`.mjs/.cjs/.js/.ts/.sh`、不以 `-` 开头、不含 `node_modules/`），`cd <dir> &&` 前缀换基目录；
- 🔴 **三档分类都要点名打印，且不许把"读不出"和"坏了"混成同一档**：`checked` / `no-target`
  （`-r`、`--filter`、纯 shell 一步）/ `unresolved`（链点了名字但 `scripts` 里没有 —— **只有这一档自己就是红**）。
  把前两档也判红 = 一条在正常的树上恒红的门禁 = 没有门禁（AGENTS §8.3 同一句理由）；
- `--ref <rev>` 模式用 `git ls-tree -r --name-only` 当"树里有什么"，所以能审**将要落地的那枚提交**，
  而不必把进程 cwd 落进哨兵那枚热载体 —— 那会踩掉载体空闲判据的 argv+cwd 两腿，等于自己把窗口关掉；
- 接线：挂进 `selfhost-merge-carrier.mjs` 落笔前的 `GATES`，带缺陷行抽取式 `^悬空/判不了\s`，
  于是它红的时候配对树能逐条归属。**不**加进 `pnpm check` 链：它判的是**合并后**那棵树，
  单棵树上的通过是它的日常状态，真正需要它的时刻只有落地前那一次；
  加进链要多改一次根 `package.json`（冲突面第一族），代价换不到东西。

自检 **11 臂**：对照 + A 悬空 + B/C `cd` 基目录两形态 + D `node_modules` 假阳性（就是 ① 里那条
`ts-node --transpile-only`，我第一版手拼的正则把它读成了"脚本缺失"）+ E `unresolved` 不静默 +
F[敞口] 扩展名集合外改名 + G/H 递归步骤与自指链 + I/J `--filter`/`-r` 不许恒红。
F 臂断言的是**当前真实行为**（`.mts` 掉进 `no-target` 而不判红），修好了它会自己报"敞口已闭" ——
与 §8.151 的 G-63 那条臂同一个做法。

```bash
node research/tools/selfhost-chain-targets.mjs --selftest                     # 臂数 11 · 不符 0 · 退 0
node research/tools/selfhost-chain-targets.mjs                                # 本工作树 67 步 / 悬空 0
node research/tools/selfhost-chain-targets.mjs --ref main                     # main 84 步 / 悬空 0
node research/tools/selfhost-chain-targets.mjs --ref feat/self-host-merge-main # 载体 85 步 / 悬空 0
```

同一趟把落笔前那 8 道纯 fs 门禁在本工作树逐道跑过：全部 `rc=0`（含新加的这道）。

#### ③ 顺手关掉的三条"会白跑一趟"的怀疑（都现量，不是推断）

| 怀疑 | 现量 | 结论 |
|---|---|---|
| 本批新增的 `research/tools/selfhost-*.mjs` 要不要进 `check:script-snapshot` 清单，否则载体红？ | 该门禁的 `MANIFEST` 只覆盖 `scripts/verify-*.sh` + `reinstall-all.sh`，文件头明写 `.mjs` 不受 bash 错位读坑影响、刻意不在清单里 | **不需要 re-bless**（它自己也不查"漏登记"，这条边界写在它文件头） |
| G-58 那批旧 landing PNG 会不会让落笔前的链红？ | `scripts/screenshots/verify-artifacts.mjs` 判的是数量/尺寸/无 alpha/非空白，不判像素里印的字 | 不会；#30 仍是对外错话要办的那一条，但不是落地前的债 |
| §8.152 欠的"待入 `environment-traps.md`"要不要本批再插一行？ | 主检出的 `#193` 已经在档（`git show main:docs/reference/environment-traps.md` 里行首号 4590 行，含 `realpathSync(argv[1])` 修法 + "判绿认结论行"第二层，比本批那次更完整）；该文件在 main 是 `M`，本分支那份最大号 177 而 main 工作树 270 | **待入已闭合**，§8.152 ④ 那句就地划线撤回；本批不往多写台账插行（插了就是第十二族） |

#### ④ 哨兵换实例（四条阈值一字未动）

上一枚是 `CAP=14400`、00:14 起算 ⇒ 04:15 到点。窗口需要"别人把根 `package.json` 提交掉 + main 连静 15 分钟"，
而 01:2x 现量是 main 每 2–3 分钟走一笔、`连静=0/6` —— **排队器寿命不够长 = 静默少一整段交付**。
先停旧实例再数进程（`ps` 清单里 `[s]elfhost-window-sentinel` 计数 0），然后按同一套旋钮起长命实例，只改 `CAP`：

```bash
CAP=28800 STEP=150 QUIET_MIN=15 LOAD_MAX=12 MAX_ATTEMPTS=3 \
  node research/tools/selfhost-window-sentinel.mjs --run-on-open
# 心跳 /tmp/selfhost-window-sentinel.pid：pid=51157 … cap=28800 quiet_min=15 run_on_open=1
```

`LOAD_MAX=12`／`QUIET_MIN=15`／`STEP=150`／`MAX_ATTEMPTS=3` 四条一条没动（§7 元规则：不许调阈值凑绿）。
判存活用 `ps -o pid= -p` 或进程清单，不用裸 `kill -0`。

#### ⑤ G-64 的承重判定：把"回补一条会红的护栏"降级成"形状统一"

`.first()` 在第十一族取 main 侧时被丢（§8.152），但它**承不承重是可量的**，不必等落地后撞运气：
全仓 `data-testid="privacy-consent-accept"` 的**生产者一枚**
（`apps/web/src/features/privacy/PrivacyConsentSheet.tsx:266`）、**挂载点一枚**（`apps/web/src/App.tsx:1770`），
`LegalReconfirmSheet` 用的是别的 testid ⇒ 同一页不可能出现两枚 ⇒ main 那版不带 `.first()` 的
`locator(...).click()` 撞不到严格模式。所以 #41 的主张改成：
**与 sibling 用例统一形状**（main 的 `e2e/live-site/live-signin-entry.spec.ts` 四处都带 `.first()`），
闭合读数挂在 #20 那一趟 —— 落地后跑 main 那版能点过 = 证明"无第二枚"；若报 strict mode，
它承重，当场回补并取证。留在原地的判断不变：**不在载体里现写第三种没跑过的写法**。

#### ⑥ 边界（别读多）

- ① 那张表是 **01:3x 那一枚载体提交**的读数。载体每次落地前重算，链的结构跟着 main 走；
  下一次 `--confirm` 之前要重量那四条命令，不抄这张表。
- 这道判据只管**根链**。子包自己的 `scripts`（那 4 条 `--filter`）不在射程里，工具按名字把它们打出来；
  要把它们纳进来得先把包名映射回目录（读 `pnpm-workspace.yaml`），本批没做，记在这里。
- "悬空 0"证明的是**这一族洞此刻没开**，不是"落地一定会绿"：完整链里其余 60+ 道（要 node_modules、要起栈、
  `check:ai-e2e` 会按端口 SIGKILL）仍然只有窗口里那一趟给得出读数。

### 8.154 那道新判据在**真实预测形状**上量到一枚悬空（登记 **G-65**，不是本批能修的），顺带把自己写的那个"import 也跑 CLI"的洞关掉（2026-10-05 01:4x，`354a1489` 之后）

#### ① 现量：阻塞集那一枚 `package.json` 里，有一条链的目的地是**未跟踪文件**

主检出的未提交差异（只读，`git diff -- package.json`）往链里加了**一道**、往 scripts 里加了**一个名字**：

| 他们 pending 的新增 | 指向 | 那个文件此刻在 git 里是什么状态 |
|---|---|---|
| `check:shell-exit-chain`（**进 `check` 链**） | `scripts/check-shell-exit-chain.mjs` | 🔴 **未跟踪**（`?? `），工作树里在 |
| `verify:macos-account-erasure`（不进 `check` 链，是 `verify:*`） | `scripts/verify-macos-account-erasure.sh` | 未跟踪；它不在链上 ⇒ 不产生悬空，但 §8.153 ③ 第一条说过：`check:script-snapshot` 的 `MANIFEST` 是显式清单，**它不查"漏登记"**，所以那枚新长跑 `.sh` 没进清单也不会红 |

把这**一版 package.json** 配上 **main 已提交那棵树**的文件清单喂给刚落地的判据
（新增的跨树模式：链条目与文件清单可以来自**两棵不同的树**，两个根都打进输出，
免得"两边相等"其实是把同一棵树量了两次）：

```bash
node research/tools/selfhost-chain-targets.mjs --pkg ../heyta/package.json --tree main
```

```
链条目来自文件 …/heyta/package.json · 文件清单来自 …/heyta 里的引用 main（tree 14e0e8179ae4，3333 条）
悬空/判不了  pnpm check:shell-exit-chain  不在树里：scripts/check-shell-exit-chain.mjs
链步 85 · 取到脚本目标 82 枚并逐枚判在位 · checked 77 · no-target 7 · unresolved 0 · 悬空 1
❌ 有悬空或读不到的链步 ⇒ pnpm check 走到那里会以 Cannot find module 收尾      （退 1）
```

同一把尺子的其余三档也一并量过：`--pkg package.json --tree HEAD` 退 0；
只给 `--pkg` 不给 `--tree` 退 2（跨树比较必须两边都给）；`--ref` 与 `--tree` 混用退 2。

#### ② 它预示的是**什么形状的红**，以及现在谁会先接住它

如果他们那一笔把 `package.json` 提交了而 `scripts/check-shell-exit-chain.mjs` 没在同一笔里进版本库，
那么落地那一刻的完整链会在 `check:shell-exit-chain` 处以 `Cannot find module` 收尾。
§8.153 那道新判据把它**提前到落笔之前**：载体的 `GATES` 里这一道会打出上面那行 `悬空/判不了`，
归属层拿干净 main 的配对树去比 —— main 那侧的链**不跑这一道**（它还没提交），所以配对复跑是 `rc=0`，
于是归属**不成立**、载体 `die(3)` 不落笔。`die(3)` 属于时序/环境那一档 ⇒ 哨兵按 `MAX_ATTEMPTS` 重试，
**不会把那几十分钟的完整链烧掉**。这是这道判据存在的理由第一次被真实数据量到，不是夹具。

⚠️ 别把它读成"本批欠一笔修复"：修法是**他们把两个路径同一笔提交**（或先提交脚本再提交链）。
本批不动主检出、不代改他们的 `package.json`。登记成 **G-65**，关闭判据 = 下一次开窗前 ① 那条复跑打印
`悬空 0`；如果开窗时它仍 `悬空 1`，载体在落笔前就停，读数里点名的是 `check:shell-exit-chain` 而不是本批的解法。
✅ **这条已在 §8.173 按它自己写的判据关闭**（10-05 10:1x 复跑同一把尺打出 `悬空 0`，且 tree OID 与 main HEAD 对上）。

#### ③ 同一个探针顺手照出自己的洞（已修，且是 traps `#193` 的第三个实例）

第一次跑这个读数用的是**一次性 `import` 探针**（现在的持久形态就是 ① 那条 `--pkg/--tree`），
结果输出的是**判据自己 CLI 段的"全绿"结论**（`链步 67 … 悬空 0`），
而我注入的 `has` 一次都没被用上 —— 因为这一版工具把 CLI 段写在模块顶层，**没有入口守卫**：
`import` 也算"被跑到"。症状不是崩，是**安静地量了另一棵树**（比 §8.152 那枚更糟：那枚至少是被闸门拦住的空跑）。
修法与本仓另一处一致：CLI 段收进 `runCli(argv)`，入口判断**两边都 `realpathSync` 之后**再比。
修完同一条命令才打出上面那行 `悬空 1`。自检仍 `臂数 11 · 不符 0`、磁盘/`--ref` 两模式仍 `rc=0`。

📌 一般规律：**能被 import 的判据模块必须有入口守卫**，否则"注入 `has`/注入 root"这类可测性设计
只是看上去能测 —— 调用方拿到的结论是模块自己那棵树的，而字形与真话一致。
这条**待入 `docs/reference/environment-traps.md`**（多写台账，编号按主检出工作树现量取；
`#193` 讲的是"字符串比 argv ⇒ 自检空跑"，这一枚是"根本没有守卫 ⇒ import 也跑 CLI"，
是同一家族的第二种面目，是否并条由后来者按条目原文判）。

### 8.155 main 的链比本批多出来那 18 道，第一次逐道离线跑过并配了对：16 道里 8 绿 / 8 非绿，而 8 道非绿**两侧退出码与首条针句逐字同形**（2026-10-05 01:5x）

#### ① 为什么现在跑

第 1 项的关闭判据要求"在合并载体上跑**完整** `pnpm check`"，而 §8.153 量到 main 的链里
有 **18 道是本批从没单独跑过的**（`check:shell-surfaces` `check:op-log-semantics`
`check:selection-single-source` `check:legal-tools` `check:legal-permissions` `check:legal-closure-truth`
`check:legal-gdpr` `check:doc-citations` `check:md-tables` `check:brand-assets` `check:public-facts`
`check:card-export` `check:ios-native-bridges` `check:vault-diagnostics` `check:verify-script-copy`
`check:android-gradle-remote` `check:apk-freshness` `check:shell-erasure-parity`）。
其中任何一道若因**本批写过的东西**红，落地就会红在一枚没人认领的格子上。
窗口是稀缺资源，所以这件事在开窗之前用离线树跑。

#### ② 做法（两枚一次性 detached 树，跑完即撤）

```bash
git worktree add --detach /tmp/ht-selfhost-gatecheck feat/self-host-merge-main   # 载体那枚提交
git worktree add --detach /tmp/ht-selfhost-gatepair main                          # 配对：干净 main
# …逐道 node scripts/check-*.mjs，落 rc 与输出…
git worktree remove --force /tmp/ht-selfhost-gatecheck
git worktree remove --force /tmp/ht-selfhost-gatepair
```

不拿哨兵那枚热载体试：同 §8.152 ③ 那条理由（它的 argv+cwd 两腿会把这次试跑读成"载体被别人用"）。
`check:op-log-semantics`（本体是变异台架）与 `check:apk-freshness`（要 Android 现场）刻意没离线跑 ——
它们不属于"纯 fs 那几道"，读数只能在窗口里取。

#### ③ 读数（16 道逐道：退出码两侧对比 + 首条失败针句）

| 门禁 | 载体侧 rc | main 侧 rc | 首条失败针句 |
|---|---|---|---|
| `legal-tools`（本体 `check-legal-tool-catalog.mjs`） | 0 | 没重跑 | — |
| `legal-permissions` | 0 | 没重跑 | — |
| `shell-erasure-parity` | 0 | 没重跑 | — |
| `selection-single-source` | 0 | 没重跑 | — |
| `ios-native-bridges`（本体 `check-ios-native-bridge-names.mjs`） | 0 | 没重跑 | — |
| `vault-diagnostics` | 0 | 没重跑 | — |
| `android-gradle-remote` | 0 | 没重跑 | — |
| `md-tables`（本体 `check-md-table-rows.mjs`） | 0 | 没重跑 | — |
| `legal-closure-truth` | 1 | **1** | `ERR_MODULE_NOT_FOUND`（两侧都是 `packages/legal/dist/index.js` 不在） |
| `legal-gdpr` | 1 | **1** | 同一枚 `packages/legal/dist/index.js` |
| `shell-surfaces` | 1 | **1** | `🔴 W5 产物不存在：apps/web/dist ⇒ 先跑 pnpm --filter @heyta/web build` |
| `verify-script-copy` | 2 | **2** | `🔴 词条产物目录不存在：packages/i18n/dist —— 先 pnpm --filter @heyta/i18n build` |
| `public-facts` | 1 | **1** | `Cannot find module '<本树根>/packages/shared-schema/dist/index.js'`（只差树根，同一条） |
| `brand-assets` | 1 | **1** | `缺少设计系统构建产物：packages/design-system/dist/index.js` |
| `card-export` | 1 | **1** | `❌ @heyta/ui/node 在 node 里加载不了`（那条入口要靠构建产物才解析得到） |
| `doc-citations` | 1 | **1** | `引用问题 4 条`，四条全在**别人的** `performance-hotpaths-audit.md`，针句全是 `dist/…` |

配对那一趟**只重跑了这 8 道非绿的**（绿的那 8 道在干净 main 上没重跑，所以这一列写"没重跑"而不是
补一个数 —— 绿在这里只主张"它在载体那枚提交上绿"）。结果：**8 道非绿在两侧退出码完全相同、
首条失败针句同一句** ⇒ 归因是"这两棵一次性树都没有 `packages/*/dist`"，不是"本批带进来的"。

#### ④ 这一趟真正买到的两件事

1. **这些红里有本批要负责的吗？没有。** 8 道非绿全部同因：一次性树里没跑过 `pnpm build`，
   而且干净 main 上**同一趟**给出同样的退出码与同一句针。
   而落地那一刻的完整链第 2 步就是 `pnpm build` ⇒ 那时 `packages/*/dist` 在，这八格不构成新的债。
2. 🔴 **不要把这类门禁加进载体的落笔前 `GATES`**（`selfhost-merge-carrier.mjs` 那一段跑在
   `pnpm build` **之前**，也没有 node_modules）。加进去 = 在正常的树上恒红 = 没有判据
   （AGENTS §8.3 那句，与 §8.153 ② 把"读不出"和"坏了"分两档是同一个理由）。
   落笔前该挂的是**纯 fs 的**那几道 —— 也就是 §8.153 新加的链悬空判据所属的那一类。

⚠️ 别把"8 绿"读成"这些门禁在载体上一定绿"：没有 node_modules 的树里，绿只证明
"不依赖构建产物的那部分逻辑成立"。完整链的读数仍然只有窗口里那一趟给得出（第 1 项的关闭判据不变）。

#### ⑤ 这一趟里唯一一条真的、且能点名的落地前风险，是 §8.154 的 G-65

其余 16 道要么离线绿、要么红因是"树没有产物"（另两道 `op-log-semantics` / `apk-freshness`
没离线跑，理由写在 ② 那一段末尾）。只有 `check:shell-exit-chain`
那一条是**链条目已经进了别人要提交的那版 `package.json`，而它指向的脚本还没进版本库** ——
那种红不是环境给的，`pnpm build` 也补不出来。

### 8.156 退 2 里混着的两种东西分成两支：哨兵不再把"没人写解法"当"探针坏"，从而把已经等到的窗口扔掉（2026-10-05 02:0x，25 臂自检 + 三趟摘除变异 + 两趟演练）

#### ① 动因：代价只在真落地那一刻才付，所以必须现在改

`selfhost-land-main.mjs` 在载体重算退 2 时把它标成 `probe` 并整体退 2，而哨兵 v5 早先对退 2 只有一条
规则：**探针坏 ⇒ 停**。可退 2 里其实混着两种完全不同的东西：

| 退 2 的那一支 | 它说的是 | 应该做的 | v5 早先做的 |
|---|---|---|---|
| 真探针坏（读不出形状、载体目录不在、脚本自己崩） | 这个装置不能用 | 停，等人修 | 停 ✅ |
| `fam.other`（`selfhost-merge-carrier.mjs:345`） | **这件事还没人写解法** | 回等待循环继续等，并把点名的路径打进日志 | 停 ❌ |

第二支停下来 = 把"五件同时成立且连静 15 分钟"这种按分钟计的东西还给随机性，还要人重新起一实例。
而它**不是**修不好的东西：解法可能就是另一条会话此刻正在写的第十二族。

#### ② 改了什么（三处，都在决策层）

1. `decideAfterLand(rc, attempts, maxAttempts, landOut)` 多了第 4 个实参：`rc === 2` 时先看输出里有没有
   载体那句 die() 的字面针，有就按"时机不对"走重试，且**照样受 `MAX_ATTEMPTS` 挡**（第 3 次仍这样 ⇒ 停，
   不拿窗口刷尝试）；没有就维持原口径停。两支的 `why` 分别为"冲突面有未预置族 ⇒ 等解法被写进来，不算探针坏"
   与"…但尝试次数已用满（第 N/M 次）⇒ 停，这一族要人来补"——早先那种"stop 却印着 retry 的理由"的措辞
   在演练里露出来了（同一个 `why` 被两种动作共用），已拆开。
2. 开窗那一支不再 `stdio: 'inherit'`：改成 `body > '${LOG}.land-N.log' 2>&1`，退出码仍取 `sh` 的 status。
   **不带管道**（环境陷阱 #179/#164 那一族：`| tee` 之后那个码是 `tee` 的）。落点后读末尾 300 KB 判针，
   把 `LAND_RC` + 判定 + 未预置族点名的路径 + 完整输出落点 + 末尾三行打进心跳日志。
   退 2 而输出文件读不到时**明写"针没有语料可比，按停处理是保守，不是判据"** —— 空读数不许冒充判定。
   输出落点从 `LOG` 派生（原来写死 `/tmp/selfhost-sentinel-land-N.log`，会和并行实例撞同一枚文件名 ——
   本轮已经被别人的 `/tmp/ct-st2.log` 撞过一次）。
3. 判针与抽路径共用同一个字面量 `FAM_OTHER_MARK`（`decideAfterLand` 与 `famOtherPaths` 都从它取），
   不抄第二份；再加一条 **B11 判针有出处**：从载体源里核对那句 `出现**预置十一族之外**的冲突路径`
   和 `fam.other.join('\n  - ')` 两件事，载体那边改措辞 ⇒ 这里红。否则哨兵会悄悄退化成
   "退 2 永远算探针坏 ⇒ 永远停"，症状是"窗口明明到了却没落地"，日志里看不出是针失效。

#### ③ 自检与摘除变异（全部实量；`cp` 复原后 `cmp -s` 逐字节相同）

| 趟 | 摘掉的东西 | 红集 | rc |
|---|---|---|---|
| 基线 | —— | 臂数 25 · 红 **0** | 0 |
| M1 | `famOther = String(landOut).includes(FAM_OTHER_MARK)` → 恒 `false` | **B7** 一条 | 1 |
| M2 | `retry` 里那个 `attempts < maxAttempts` | **B8** 一条 | 1 |
| M3 | 字面量改成 `预置十一族以外` | **B7 + B9 + B11** 三条 | 1 |

M3 一把照出三处共用同一个针（决策、抽路径、出处对账），这正是"抄两遍就漂"反过来用的样子。

#### ④ 演练读数（`FORCE_OPEN=1` + 一次性夹具，一个字节都没落地）

- **A 腿**（夹具照 land-main 转发载体 die() 的字面形状打 stdout 并退 2，`MAX_ATTEMPTS=2`）：
  第 1 次 `⇒ retry（冲突面有未预置族 ⇒ 等解法被写进来，不算探针坏）`，并把两行点名路径
  （`docs/research/self-host-distribution-audit.md`、`package.json`）与 357 字节的完整输出落点打进日志；
  第 2 次 `⇒ stop（冲突面有未预置族，但尝试次数已用满（第 2/2 次）⇒ 停，这一族要人来补）`；
  哨兵退出码 = LAND 原码 **2**。
- **B 腿**（真·探针坏夹具，`MAX_ATTEMPTS=3`）：第 1 次就 `⇒ stop（探针坏 ⇒ 拿同一个坏探针再跑一遍还是坏的）`，
  没有多烧一趟。
- 夹具在 `/tmp/selfhost-drill-{famother,probebad}.sh`，一次性，未入库。
- **C 腿**（`--run-cmd 'exit 2'`，即"退 2 而一个字都没写"那一支）：`DRILL_C_rc=2`，日志里除了 `LAND_RC=2` 还有一条
  `🔴 退 2 但输出读不到（…land-1.log size=0）⇒ 针没有语料可比，按"停"处理是保守，不是判据`，
  落点文件确实是 **0 字节**。这一支不跑就不是"少一条读数"，而是**下次真出这种事时没人知道日志里那行"停"是判出来的还是兜的底**。

#### ⑤ 顺带把"现在这一趟会不会撞 fam.other"量了：不会（9 枚全在族内）

`main = 48061d4e`（02:0x 现量）下 `git merge-tree --write-tree main feat/self-host-distribution` 报
**9 枚 content 冲突**，逐枚对到**载体分族表自己的键**（不是对 prose grep）：
`package.json`→pkg（字面比较）、`self-host-distribution-audit.md`→AUDIT、`deployment.md`→DEPLOY、
`e2e/live-site/live-domain.spec.ts`→LSPEC、`check-image-license-coverage.mjs`→COV、
`gen-image-npm-tree.mjs`→GEN、`scripts/screenshots/capture.mjs`→CAPTURE_PATH（cap）、
`server/Dockerfile`→DOCKERFILE_PATH（dock）、`server/image-npm-tree.json`→SNAPSHOT ⇒ **other = 0**。

🔴 这一条差点被我自己写的探针判错：我先写了个"从源码抽 `const X = '…';` 再比"的一次性核对器，
它把 9 枚里的 **3 枚判成 OTHER** —— 因为 `package.json` 在 if-chain 里是字面量、
`CAPTURE_PATH`/`DOCKERFILE_PATH` 是从兄弟模块 `import` 进来的，两种形状都不长那样，
而它还把 `ORPHAN/REPLAY/DMERGE/TMERGE/ATTR` 这些**不是族键**的常量一并收进"键常量 11 个"。
也就是说那个探针会把"全部有解法"读成"要死一次窗口"。已删，结论以逐条读常量定义为准。
可迁移的一句：**抽判据的语法形状必须和被抽方的写法一致，否则"看着最干净"的空读数会替你下结论**
（AGENTS §7 元规则 1"先怀疑探针"的又一种面目）。

#### ⑥ 实例与旋钮

旧实例 51157（装的是没有这一支的老代码）先停 ⇒ `pgrep` 数到 0 ⇒ 起新实例 pid **3361**，
旋钮逐字未改（`CAP=28800 STEP=150 QUIET_MIN=15 LOAD_MAX=12 MAX_ATTEMPTS=3 --run-on-open`）。
起步读数仍是 `阻塞集=1`、`负载=25.14>12` ⇒ 第 1 项仍未开窗。

#### ⑦ 边界（别读多）

- 只动**决策层**，没有加"每个 tick 预跑一次 merge-tree"的判据：那会往共享对象库写不可达对象，
  而 ⑤ 的现量说明"当下会不会撞"本来就是随 main 每分钟漂移的瞬时读数（§8.153 已量过 prose-grep 类
  代理指标不够格）。留下的代价是：真撞 `fam.other` 会烧掉**一次尝试** —— 而载体是在第一个写动作之前
  就退 2 的，那一趟只花几十秒，不是几十分钟。
- 载体那侧 `fam.other` 的"不许自动决定"一个字没动。这里改的是"哨兵怎么读那个退 2"，不是"冲突能不能自动解"。

### 8.157 窗口之外把载体重算跑了一遍（第一次带上 §8.153 那道链悬空预检）：十一族全解、九道门禁 8 绿 + 1 道逐条归属到非本批（2026-10-05 02:1x，main=`e443b4bd`）

#### ① 为什么现在跑（它不值 40 分钟，却能把 40 分钟省下来）

`selfhost-land-main.mjs` 在没有 `--carrier` 时**自己就会重算载体**，所以开窗那一趟跑的是"当时那版 main"。
main 这几分钟动了两次（`fde7dbca → 48061d4e → e443b4bd`），而分族表是**内容敏感**的（pkg 族要两侧原文映射、
第十/十一族各有判据自检）—— 结构性的解不动只在真落地那一趟才现形。载体这一趟只花 git 的量（不起栈、不跑单元测试），
所以它在窗口之外跑得起。

#### ② 读数（全部现量，逐字来自 `/tmp/selfhost-carrier-preflight-e443b4bd.log`，`CARRIER_RC=0`）

- `✅ 载体 a5fedf16 = main(e443b4bd) × feat/self-host-distribution(bad04bc9)` ⇒ **十一族里没有 `other`**
  （与 §8.156 ⑤ 那 9 枚冲突面对得上；分族表按自己的键常量逐枚认领，不是 prose grep）。
- `并集 scripts 键 157 个 · check 链段 main=84 本批=67 base=66 并集=85（摘段 0/0）· 非 scripts 顶层字段比了 9 个，
  两侧改动全落进磁盘对象（丢 0）` ⇒ 这一行同时是 **§8.153 那条新预检第一次在真载体上走通**（悬空 0，所以它没响）。
- `第八族判据自检：control 0 条 + 五臂各 ≥1 条 + 收尾复绿（按输出内容判）`；
  `第九族判据自检：17 条臂（拒绝类 7，按理由认领）红 0`。
- `门禁 9 道：8 道 exit 0 + 1 道红已逐条归属到非本批` —— 红的那道是 `check:docs`：
  载体退 1、点名 3 条，配对树（干净 main `e443b4bd`）同道门退 1 且这 3 条逐条都在 ⇒ **非本批**，不代改、不吸收。
  ⚠️ 与第 1 项开头登记的那条"main 红在 check:docs 5 处"对照：**main 自己现在点名 3 条**（不是 5 条）。
  这两个数属于不同时刻的瞬时读数，谁也别拿自己去替对方（`grep` 现量的命令在 §8.16 那三行里）。

#### ③ 与 G-65 的关系（它仍然活着，而且这次是**带出处**地确认）

> ⚠️ 这一段下面是**当时**的读数（`悬空 1`）。它活着的那件事在 10-05 10:04 由他们那笔 `9856a4a7` 关掉，
> 关闭读数（同一把尺打出 `悬空 0`）在 §8.173 —— 留原文是为了让后来者认得"半笔提交"这个形状，不是现状。

`--ref main` 判 HEAD：**链步 84 · 悬空 0**（HEAD 里没有 `check:shell-exit-chain` 那条目）。
`--pkg ../heyta/package.json --tree main` 判"别人那半笔提交之后"：**链步 85 · 悬空 1**
（`pnpm check:shell-exit-chain → scripts/check-shell-exit-chain.mjs 不在树里`）。
⇒ 那一半笔一旦落地，载体预检会 `die(3)` 而不是 `die(2)`（它不是 fam.other），哨兵按"时机不对"回等待循环 ——
这正是 §8.156 那一支该有的行为：**协作没到位不烧窗口，也不拿它当产品红**。

#### ④ 顺带照到的一条（不归本批，但值得记）

main 最新那笔 `e443b4bd` 的标题是「链每 60s 白跑一次全量构建 —— 一边等负载窗口一边自己往上加（已修，
不靠重启进程生效）」。也就是说这一晚上把负载顶在 25 以上的一个来源是**别人那边的自激**，已修。
本批的哨兵阈值一个字没动（`LOAD_MAX=12` 是被约束方的门槛，不是可调来迁就环境的旋钮）。

#### ⑤ §8.138 留的那格"`--confirm` 那个调用点今天没真跑过"，也在窗口之外取掉了

那一格原先挂在"要窗口"名下的理由是同一条 §8.138 开头批评过的错：**把接线当成运行**。
接线要证的只有一件事 —— `CONFIRM` 那支真的在载体重算**之前**调了 `watchLeg()`。
取法（不写任何东西，3 秒）：把 `HEYTA_CARRIER_WT` 指到一枚不存在的目录，再按**生产形状**跑
（cwd = 主检出、脚本用本分支那份的绝对路径，和哨兵开窗那条命令同形）：

```
HEYTA_CARRIER_WT=/tmp/selfhost-nonexistent-carrier-xyz node "<本分支 worktree>/research/tools/selfhost-land-main.mjs" --confirm
```

现量 `CONFIRM_WIRING_rc=2`，stdout 三行依次是 `主检出=… · 分支检出=… · 当前目录=…` →
`跑链之前先自证看守三臂（合成子进程；任一臂不合格 = 探针坏 ⇒ 不开几十分钟的链）` →
`🔴 载体目录 /tmp/selfhost-nonexistent-carrier-xyz 不存在 ⇒ 归属判不了（不拿"判不了"当"没触发"）`。
第二行就是那条接线的证据（它打在 `watchLeg()` 自己的 die 之前），第三行证明它死在**第一个写动作之前**
（`land-main:167` 是 `watchLeg` 的第一道守卫）。主检出前后都是 `main=24be9a85 · 脏条目 26`，
逐字相同 ⇒ 这一趟没碰别人的树。

⇒ §8.138 那三格里现在只剩**真 `pnpm check` 在看守下的时长**那一格仍要窗口（那才是真的需要几十分钟的东西），
任务第 35 项按这一条收窄。

### 8.158 把"全仓只有这三张表"那句一次性普查结论钉成常驻判据（R8），并给它配一台八臂变异台（2026-10-05 02:3x）

§8.11 起这条门禁靠的是三张表（`SCAN_SET` / `EXCLUDES` / `NON_COPIES`）。**表本身没有入口**：
仓库里新出现第四份抄件时，没有任何一层会失败 —— 它不在表里，所以 R1–R7 根本不看它。
上一轮我手跑过一次 `git grep` 普查（"全仓只有这些"），但**一次性普查的结论会漂**，
这正是本批反复犯的那类错：把一个当时的读数写成永久事实。所以把它做成 R8。

#### ① R8 判三件事，方向各不同

| 方向 | 红法 | 防的是什么 |
|---|---|---|
| ① 多出来没人管 | 命中形状但不在三张表里 ⇒ 点名那份文件 | 新增抄件悄悄游离在判据之外（§8.11 那条"改一处要改全部"从此没人守） |
| ② 豁免漂了 | 表里登记的 `file` 当前读不到那个形状 ⇒ 红 | 文件被改名/删掉/换写法后，豁免**没有对象**却还在清单上（= 静默缩小射程） |
| ③ 探针没接上 | `git grep` 报错或零命中 ⇒ 响亮红，**不**按"全仓干净"过 | "没观测到 X"被读成"X 没发生"（§7 元规则 1） |

`NON_COPIES` 里每条都带一个 `needle`：豁免必须**确有其事**（读得到那句承重断言）才算，
不是"写个文件名就免了"。六条里有一条是**自指**的 —— 门禁自己的头部与 `COPY_SHAPE` 常量带着那个形状，
R8 第一次跑就把裁判判成了漏登记。**修法是登记，不是在代码里写一句"跳过自己"** ——
后者就是"探针不检自己"那种洞，而它恰好是这条判据最该抓的形状。

#### ② 第一次跑就照出一处探针自己的坑（POSIX ≠ JS 正则）

`COPY_SHAPE` 第一版写成 `docker compose[^\n]*docker-compose\.build\.yml`。
`git grep` 用的是 **POSIX** ERE：`[^\n]` 在那里是"除反斜杠和字母 n 之外"，
带 `monitoring` 的那行因此**静默不命中**。同一棵树现量：**正写法 12 枚 / 坏写法 11 枚，少的正是
`docs/runbooks/deployment.md`**。症状不是"少检了一份"，是 R8 反过来报
"NON_COPIES 登记的豁免已经读不到那个形状了" —— 也就是**新判据自己把自己的分母改了**，
却以"清单漂了"的面目出现。已改成 `.*`，并把这段实测数字写进代码注释。

#### ③ 牙：`research/tools/selfhost-entry-command-arms.mjs`（八臂，一次性副本，真门禁零改动）

把门禁拷成 `scripts/.r8-arm-copy.mjs`（同目录 ⇒ 它算出的 `repoRoot` 不变），只在**副本**上做字面替换；
副本是未跟踪文件 ⇒ 不进 R8 自己的分母（否则每臂都多一条"副本没登记"，那是装置在判自己）。
`mutate()` 对锚点带**命中数断言**（不等于期望次数就抛 ⇒ 装置与被检对象漂了会立刻知道，不会静默 no-op）。

现量（`ARMS_RC=0`，逐臂打印）：

| 臂 | 期望 | 读数 |
|---|---|---|
| A0 原样副本 | 退 0 + 零 `[R8]` 红 + **绿时必须报得出分母** | `rc=0 · [R8] 红 0 条 · 当前分母=12 枚` |
| A1 摘掉一份抄件的登记 | 点名那枚真文件"不在 SCAN_SET" | `rc=1 · [R8] 2 条 · 点名 phase-2-multi-platform.md 1 条` |
| A2 同一次改名 | 还有一条"豁免已经读不到那个形状"（两个方向各有措辞） | 措辞命中 `true` |
| A3 needle 读不到 | 红"豁免的承重断言不成立"，且**不许**误报成漏登记 | `rc=1 · 点名 deployment.md 1 条 · 漏登记措辞出现=false` |
| A4 形状换成永不命中 | 红在"没有分母（探针没接上）"，不是静默通过 | `rc=1 · 措辞命中=没有分母` |
| A5 退回 `[^\n]` 写法 | 响亮红在"豁免没有对象"，不是静默把那份抄件当不存在 | `rc=1 · 自量分母：正写法 12 枚 / 坏写法 11 枚 · 坏写法丢掉=docs/runbooks/deployment.md` |
| A6 摘掉门禁对自己的登记 | 它把自己判成漏登记（自指不是豁免的借口） | `rc=1 · 点名 scripts/check-selfhost-entry-command.mjs 1 条` |
| C1 收尾复原 | 三个变异串都不在真门禁里、自登记那条在 | `门禁字节数=22282 · 变异串残留=无` |

**A5 这一臂第一版的期望是错的**，留在这里因为它暴露了一个通用盲区：我原本断"不红、但普查行报出的
枚数比 A0 少"。实测 `rc=1` 且**根本没有普查行** —— 门禁的 `notes` 是在 `failures.length > 0`
那个分支**之后**才打印的，任何一条红都会把"当前分母是几枚"整行吞掉。
⇒ 两条一般规律：**变异臂要断言的对象，必须先确认它在失败路径上还打不打得出来**（这里打不出来）；
**"分母自己缩小"这类形状回归的正确期望是"响"，不是"数字变小"**。
改后的 A5 不再读门禁的打印，而是**自己用同一条 `git grep` 量两种形状**并打差集（命令、`-I`、`cwd`
照门禁本体抄，否则量的不是同一个东西），阈值用 `narrow < wide` 而不是写死 11/12 ——
写死就是把当时的形状当判据，那正是 R7 批评过的错。

#### ④ 边界（不写成"以后有人守"）

这台变异台**没有自动消费方**，与本批另两台同族（`selfhost-license-coverage-arms.mjs`、
`selfhost-windows-sync-arms.mjs`）：一次性装置不该挂进 `pnpm check` —— 它每次运行都故意把红写进副本。
⇒ R8 的牙只在"改动 `COPY_SHAPE` / `NON_COPIES` / 三张表任一"时重新现量一次，
判据本体（R8 自己）则每次 `pnpm check` 都跑。这条区别要逐列看：**每条判据的形状**与**每条的自动消费者**，
别拿后者证明前者（本批已在 §8.149 为同一件事改过口径）。

另有一条**没进射程**的边界要写明：`git grep -I` 跳过二进制 ⇒ 已入库的 `scripts/screenshots/landing/*.png`
里印着的命令文案**不由 R8 管**，那是任务 #30 / G-58（要重打图，走 `screenshot:capture`）。

#### ⑤ 复跑读数与窗口现状（写这一节时的现量）

- `node scripts/check-selfhost-entry-command.mjs` ⇒ 加 arms 文件**前** `rc=0`、`git add` 之后**仍** `rc=0`，
  普查分母停在 **12 枚**（新入仓的那台装置自己**不**命中形状，所以不需要第四枚豁免登记；
  这一点是复跑量出来的，不是推出来的）。汇总行：`扫描集 7 份 + 故意排除 1 份 + 非抄件登记 6 份，命中 9 条入口命令`。
- 哨兵 pid 3361 已跑 25 分半，02:29:40 那一次心跳：`阻塞集=1 · 负载=7.94 · 端口空（4318/4319/4320/4322）·
  载体空闲 ✅ · main=c3049c88(上一=c3049c88) · 连静=0/6 · 不成立=阻塞集=1`。
  ⚠️ **这是本轮第一次只剩一件不成立**：负载从 189.5 → 58.05 → 13.29 → 9.29 → 6.5 → 7.94（那台自激修掉之后），
  端口/载体/main 同值三件都已成立，卡的只剩别人那枚未提交的 `package.json`。
  阈值与条件一条没动。`连静=0/6` 里还有 main 的账：02:24:39 那一样报的正是
  `main 变了（24be9a85→c3049c88）`，两件事不会互相掩盖 —— 那是"不成立=…"这行存在的意义。
### 8.159 缺口登记表自己就是最大的一份抄件：两处状态行烂了两天没被回写，另有一条"分支工作树不等于要落的东西"顺带量到（2026-10-05 02:4x，main=`c3049c88`）

写 §8.158 时顺手回读登记表，撞到两条**行状态与正文结论互相打脸**的记录。两条都不是新缺陷，
是"同一个结论在台账里写了两遍，改了一遍没改另一遍"—— 本批一直在替别的抄件记账，这回记账对象是它自己。

| 行 | 它一直写着 | 正文早就说了 | 烂了多久 |
|---|---|---|---|
| `G-42` 自建区四条错话 | "**未关**：`packages/i18n` 此刻仍被并行会话占着……等它空出来直接落" | §8.9 整节就是这件事的收尾：三条由并行会话提交（`729f4bd4`/`1e092733`/`bf271a1e`），本批净改动只有 `s7p1` 一行 × 中英 | 10-03 14:0x 写完 §8.9 → 10-05 02:4x 读回来，≈ 两天 |
| `G-47` 行尾 | "G-53（平台二进制从没进过扫描集）是这一族剩下的那条，**未闭**" | §8.48 同一句以 ✅ 收尾（判定 4 按提交物锁的 `os`/`cpu`/`libc` 三字段逐条过，14 枚全 MIT 全 optional），而登记行自己另一头写着"✅ 2026-10-04 已关" | 10-04 05:4x 关闭 → 21 小时 |

`G-42` 的前提也一起过期了：主检出那两份词条表**此刻干净**
（`git status --porcelain -- packages/i18n/src/locales/*` 空），所以"被占着"既不是现状也不是理由。
两条都已就地回写，并把"这行曾经烂过"留在原句旁边而不是抹掉。

#### ① `G-42` 这类为什么偏偏会烂：整行没有一个可点回去的现场

它原来只写"改法已在 **§7** 备好" —— §7 是本文档的静态章节，不是出事现场；而且**正文从来没点过 `G-42` 这个号**
（现量：全文 `G-42` 命中 1 处，就是登记行自己）。也就是说没有任何东西会在哪天把人带回这一行复核它。
对照被点名的次数：`G-47` 30 次、`G-44` 11 次、`G-48` 与 `G-49` 各 10 次 —— 这几条烂不了，因为它们一直在被路过。

同形状还查出第三行：`G-41`（`check:server-env`）**已关闭却整行没有一个 `§8.x`**。
它的现场是存在的（§8.3 第 5 条记它自己那两处放水怎么改掉的、§8.108 记它与入口对账两把尺各自的输入），
当时只是没写回登记行。已补上指针 —— 补的是指针，没有重写当年的结论。

⇒ 落成一条**评审辅助**：`research/tools/selfhost-registry-drift-sweep.mjs`。它扫两件事：
登记行的状态与正文最新结论打脸（候选），以及整行有没有 `§8.x` 现场（规则 A）。
两趟读数，第二趟是正向对照（`audit-prefix.md` = `git show HEAD:` 那版，
`node research/tools/selfhost-registry-drift-sweep.mjs /tmp/audit-prefix.md`）：

| 版本 | 打脸候选 | 无现场行 | 明细 |
|---|---|---|---|
| 改之前 | 1 | 3 | `G-40⑥`（真：有意不写，现场在 §4 第 4 条那类静态章节）、`G-41`、**`G-42`** |
| 改之后 | 1 | 1 | 只剩 `G-40⑥`。那条打脸候选留着是因为 §8.8 里有一句提前写了"G-47 已按这个形状关闭"，与登记行引的 §8.47 不是同一节 —— 读一眼就知道是两处都说过，不是缺陷 |

规则 A 读的是**整行**而不是状态栏：`G-48b` 的现场写在中间那格（"§8.19 读数 B"），
只读最后一格就会把它误报成没出处 —— 只看一栏的判据测不到"其实写了，写在别处"。

#### ② 为什么它今天**不**挂进 `pnpm check`（三条，前两条是现量）

1. 挂链要改根 `package.json`，而它此刻是**落地的唯一阻塞项**（`阻塞集 1 枚 = package.json`，别人未提交）。
   为一条评审辅助去加宽那一枚的合并面，是拿窗口换便利。
2. 更自然的落点是 `research/tools/docs-link-check.mjs`（它已经在校"章节引用有效"），但那枚文件现在在主检出里是 `M`
   （别人正在改它）。本分支一碰它，它就从"不重叠"变成"重叠 + 未提交"⇒ 进阻塞集，
   而且它**不在预置十一族**里 ⇒ 开窗时直接 `fam.other`。
3. 更根本的一条：**纯关键词裁判管不住这一类**。假阳性就长在刚改完的 `G-47` 行上 —— 它现在写"已闭"，
   可后面跟着解释这次漂移的那句 `这半句曾在行尾挂了很久"未闭"`，引号里的 `未闭` 让它在关键词下仍然是红的。
   一条会这样红的判据挂进链里，下一次真漂移就混在噪音里没人看 ⇒ 比没有判据更糟（AGENTS §7 元规则 2）。

所以它是**工具**：写完"某条已关"那一段之后跑一次，候选逐条读。
等落地之后前两条前提都不成立时，再决定要不要给它一条会红的判据 —— 届时的形状是"每行要么有 `§8.x` 现场、
要么显式写『本批未动』"这种**择一标记**，而不是扫状态词。

#### ③ 同一轮量到的一条，比上面两条都值得记：分支工作树 ≠ 要落的东西

因为 `G-42` 牵扯 i18n，顺手把**载体**那两份词条表与 main 现在那两份对了一遍：

- `diff 载体 vs 主检出` ⇒ `zh-CN.ts` **差 2 行**、`en.ts` **差 2 行**，两枚文件差的都只有同一个键
  `site.platforms.web.body`：载体带的是本批那句（"断网也能照常记，恢复后自动补传……"），
  main 现在还是被摘掉的那句"可安装、可离线用"。⇒ 载体在词条这一层相对 main 的**净差就是本批要停的那句对外错话本身**，
  没有夹带别的东西（任务 #21 / G-51 等的就是它随落地出去）。
- 反向也核了，结论是**没有 clobber**：本分支自己那份 `zh-CN.ts:3323` / `en.ts:3122` 里，
  `site.docs.selfhost.s10p1` 还带着他们后来摘掉的 "Argon2id"（正文那句，不是注释），
  而**载体**与 main 两份在该键上都是改过的新句（两边都落在 3361 行），`Argon2id` 在这两份里只剩注释那一处
  （zh:854 / en:778）。⇒ §8.9 当年那句警告（"一次草率的解冲突就是把他们的更正退回去"）现在有了一条形成的读数：
  融合结果替他们保住了更正，而本分支那份陈旧副本根本没进入要落的字节。
- 台阶 0 那笔 `c219e4ec`：`git merge-base --is-ancestor c219e4ec main` ⇒ **真**，早就在 main 里了。
  于是"四条错话已停"这半句的**源码真源**部分已经成立，未落的只剩 `site.platforms.web.body` 那一句（要等落地 + 重发）。
- 第 1 项要的差额笔数（同一趟现量）：`main..feat/self-host-distribution` = **186** 笔、
  `feat/self-host-distribution..main` = **738** 笔，merge-base `b850b1c6`，main=`c3049c88`，本分支=`1fdfcbeb`。

⇒ 可迁移的那条：**"我这分支上这句话还是旧的"既不构成"落地会把它带回旧的"，也不构成"它还对外生效"**。
判这类事只认两棵树 —— 要落的载体与 main —— 而且差集要**逐键列出来**（这里是 1 个键 × 2 份文件）；
只报"差 2 行"等于没说，因为 2 行既可能是同一个键的两种语言，也可能是两个不相干的改动。
### 8.160 对外手册里那句"依赖树没被钉住"已经过期一天半，同一轮把 G-61 的①档做成会红的 R9（十六臂，其中一臂被自己的载荷判进分母）（2026-10-05 02:5x）

§8.159 那条"登记表自己会漂"的账还没合上，就顺着同一根线撞到第二条：**对外手册也在漂**。

#### ① `docs/runbooks/self-host.md` 的"还没做到的"表里，那条依赖树句子早就不成立了

现量（改之前）：那一行整句是
`| 服务端镜像的 npm 依赖树没被钉住 | 同一份源码两次构建可能装到不同的传递依赖版本；许可证与漏洞扫描因此只能覆盖"某一次解析"（pnpm check:image-license 就是那条会红的对账） |`。
而 §8.47 记录的是：`server/package-lock.json` 是**提交物**、是 `server/Dockerfile` 生产阶段的一条 `COPY` 输入，
鉴别实验（锁里手工改一个版本 ⇒ 产物跟着改）已经做过 —— 也就是**这句在 2026-10-04 05:5x 就过期了**，
到 10-05 02:5x 才被读回来（≈ 21 小时）。这一页正是外人"照着做"的那一份，所以它比登记表更贵：
外人读到的是**我们主动发出去的错话**，不是内部记账。

改法不是删掉那一行，而是把它换成**这一格现在真正没做到的三件**：
① 自家三枚 workspace 包装的是当前源码字节（这是要的，不是可复现性缺陷）；
② 锁钉的是 registry 层 —— 上游**重传同一版本号**的字节，锁不会替你发现；
③ **发哪几个架构**还没拍板 ⇒ 只有本机那个架构（这台 `linux/arm64`）有运行证据，`amd64` 发布物**零运行证据**。
并把"许可证扫描已覆盖锁里的平台变体（判定 4 按 `os`/`cpu`/`libc` 逐条判），但那回答的是许可可不可接受，
**不回答跑起来对不对**"写在同一格 —— 否则下一次又会拿"扫描覆盖了"去顶"验过了"。

📌 与 §8.159 同一条元规则：**关闭一条登记 ≠ 回写所有说它的地方**。这批已经第三次撞到它
（G-42 行、G-47 行尾的 G-53、这句 runbook）。前两条是内部账，第三条是对外账 —— 贵的正是第三条。

#### ② G-61 的①档落成 R9：把"没人跑它"从一句注释变成一次失败

`pnpm verify:selfhost-stack` 是"真镜像 + 真服务端 + 真浏览器"唯一那一趟，而它**不在 `pnpm check` 链里**。
§8.134 登记时留了三选一（① 保持人跑但把义务写进文档 / ② 挂进发布前那道 / ③ 拆静态腿进链）。
本批做掉的是**①**，用的是 G-48 已经验证过的机制：链外那道必须点名消费方文件，且该文件里有一行
**以这条命令开头** —— 写在句子中间不算（散文不是指令，与 R1–R6 对入口命令同一条口径）。

新判据 `R9` 挂在 `scripts/check-selfhost-entry-command.mjs`（已在链里，**零新增链项、零 `package.json` 改动**）。
它判三件事，缺一即红：① **前提**（命令确实还在链外 —— 现量读 `package.json` 的 `scripts.check`；
哪天真挂进链里，这条判据就永远不可能命中 ⇒ 自己响亮地红，要人换形或删）；② **落点**；③ **时机**
（"什么时候该跑"那句还在不在）。消费方选 `docs/runbooks/local-server-verification.md`（内部验收手册，
它是**义务**的家；对外指南 `self-host.md` 不放这条 —— 那是 ours 的运维义务，不是外人的步骤）。

载体选择这三条都是现量（第 35 项那条"判据的载体本身被别人约束"在这里第三次成立）：

| 候选落点 | 现量 | 结论 |
|---|---|---|
| 新增一条 `check:*` 进链 | 要改根 `package.json`，而它是落地**唯一**的阻塞项（`阻塞集 1 枚 = package.json`） | 不用 —— 改挂进既有门禁 |
| 扩 `scripts/check-gate-wiring.mjs` | 两侧自 merge-base 各改过（本分支 +46 行、main +20 行），且 main 那 20 行落在 110 行附近、本分支的锚点在 118 行附近 ⇒ 再往上叠就是**造一次新的冲突面** | 不用 |
| 门禁本体 `check-selfhost-entry-command.mjs` + 内部手册 | main 侧对这两枚文件自 merge-base **零改动**（`0 / 0`） | ✅ 用它：合并面上不新增任何一枚重叠文件 |

🔴 边界照 G-48b 写进代码注释：**R9 钉的是义务写在哪儿，不是义务被执行过。**
"这趟真跑过没有"在这一层结构上不可观测（它是几十分钟的真构建），那半段仍留在要人拍板的那一档里。

#### ③ 牙：`selfhost-entry-command-arms.mjs` 十六臂，`ARMS_RC=0`

R9 那七臂（A7–A13）变异的是**被读的那棵树**，不是门禁本体 —— 前提是门禁加了 `--repo-root`
（真实消费者不带它；它存在的唯一理由是让"命令被挂进链里"这一臂不必去动真 `package.json`）。
假树不在 git 仓里、也只有两枚文件 ⇒ R1/R2/R8 会另红几处，所以这几臂**只数 `[R9]` 的红**：

| 臂 | 期望 | 读数 |
|---|---|---|
| A7 原样假树 | `[R9]` 零红 + 门禁把自报根打出来 | 红 0 条 · 自报根=打了 |
| A8 摘掉那行命令 | 红"没有一行以…开头" | 1 条 · 命中 |
| A9 那行退成句子里的散文 | 照样红 ⇒ **行首锚有牙**，不是"文里出现过就算" | 1 条 · 命令这串字确实还在文档里 |
| A10 摘掉"什么时候该跑" | 只报时机那条，**不许**顺带报落点那条（两条措辞各自独立） | 时机=true · 落点=false |
| A11 命令塞进 `scripts.check` | 红"前提变了"（判据不许悄悄空转） | 1 条 · 命中 |
| A12 消费方文档不见 | 红"重新变成没人点名的一趟" | 1 条 · 命中 |
| A13 `package.json` 坏掉 | 红"没有分母/读不出 scripts.check"，**不按**"还在链外"过 | 措辞=没有分母 |
| C2 复原 | 真手册与真 `package.json` **逐字未变**、假树已删 | 手册 9109=9109 · pkg 11592=11592 · 已删=true |

#### ④ 这一轮最值钱的一条：A4 被**自己的载荷**判进了被测分母

A4 的原写法是把 `COPY_SHAPE` 换成 `'这一串永不可能出现在任何文件_ZZZ'`，期望是"没有分母"那条红。
实测 `rc=1` 但**那条红根本没出现**，屏幕上 7 条 `[R8]` 全是另一类。原因：
`git grep` 扫的是**全部被跟踪文件**，而这台变异装置的文件里**字面带着那句"永不命中"的串**
（它就是 `mutate()` 的实参）⇒ 分母读出来是 **1 枚：装置自己**，不是 0。
于是"探针没接上"这一档被装置自己的源码顶掉了，读起来像"豁免全漂了"。

⇒ 这是"桩自己造红/造绿"那一族（AGENTS §7 已有同族条目）的一个具体新形状：
**变异载荷本身就是被扫描文本的一部分；"永不命中"必须拼起来写，让拼接后的字面串在任何文件里都不存在。**
改法：`'ZZZ永不可能命中' + '_9f3c'`，并把这一条**加成判据而不只是注释** —— A4 现在同时断言
"没有分母"措辞命中 **且** 输出里不出现"不在 SCAN_SET"（后者一旦出现就说明装置自己进了分母，
那条臂就是在判自己而不是在判门禁）。改后 A4：`[R8] 1 条 · 措辞命中=没有分母 · 装置自己被判成漏登记=否`。

🔴 同一条元规则在这台评审辅助上也兑现了第二次：写完 §8.159/§8.160 再跑它，打脸候选从 1 条变成 **2 条**，
而两条都落在**同一行**（`G-40⑥`）上 —— 触发它的正是我这次新写的那两句：它们同时含有 `G-40⑥` 这个编号
与「已关」这个词。⇒ "引用/提到"与"断言"在纯关键词裁判下不可区分，这不是缺陷，是这一族的**结构性**性质，
所以它只能当候选、不能当门禁（文件头那条实测假阳性是第一次，这次是第二次，同一台装置、同一个原因）。

#### ⑤ 仍然欠的（不把①读成②③）

G-61 的 ②（挂进发布前那道链）与 ③（把静态腿拆进链）**没做**，它们要人拍板 —— ②会改变每次发布的时间与负载，
③要重新定义哪些断言算"静态"。本批只把①做完并钉成会红的判据；这一档关的是"义务写没写、写没写在对的地方"，
**不是**"有没有人守"。§8.134 那条登记的原句"三选一待拍板"因此**部分**关闭，剩下两档保持待拍板状态。

#### ⑥ 顺手把同一份对外手册的其余否定句逐条读了：命中 1 条 / 13 条仍然成立

既然 ①那条是"关掉一件事却没回写说它的地方"，就把这份手册里所有**否定式主张**逐条过了一遍
（取法：`grep -nE '没有|尚未|还不|不支持|未实现|零运行' docs/runbooks/self-host.md` ⇒ 14 条，含刚改那条）。
逐条判的结果：

| 主张 | 判 | 依据 |
|---|---|---|
| "不承诺 Podman，它的 compose 兼容层没有一次实测记录" | ✅ 仍然成立 | 本批所有真跑都在 Docker 上（`verify:selfhost-stack` 那几趟都是 `docker`/OrbStack），没有任何一发在 Podman 上 |
| "目前没有发布任何 heyta 的服务端镜像，发布流水线已落地但没启用" | ✅ 仍然成立 | 镜像发布是本批硬约束里明令禁止的对外动作（要人拍板）；`git tag -l 'v*.*.*'` 与 `git ls-remote --tags origin` 的读数见 §8.9 |
| "没有可钉的版本号 / 没有客户端-服务端兼容矩阵 / 没有自动更新与多副本编排" | ✅ 三条都成立 | 分别对应 G-40⑤、G-40⑥、以及 §8.134 那栏"有意的不写" |
| "端到端加密下备份就是全部，我们这边没有任何一份你的明文可以还原给你" | ✅ 成立 | 这是产品立场不是待补事项 |
| §4/§6 那四条讲 `pull access denied`、"根本没有仓库"、compose 不会重跑已退出的一次性服务 | ✅ 成立 | 它们是**事故现场记录**，写的是当时发生了什么，不是当前主张 |
| ~~"服务端镜像的 npm 依赖树没被钉住"~~ | 🔴 **已过期，本节 ① 改掉** | §8.47 的锁 + `COPY` 形状 |

⇒ 这一格的结论值得留着：**逐条读只找出 1 条**，说明这一批对外文档的整体状态是跟得上的，
而那 1 条恰好是"刚刚关掉的这件事"——失效最集中的地方就是**最近改动过的那一格**。
下次做同类 sweep，先读"上周关掉的登记"对应的那几行，比从头扫全文便宜得多。
`docs/reference/build-matrix.md` 那 9 条否定句属于别的条线（RN / 桌面壳 / 代理），本批没动它们，
而该文件 main 侧自 merge-base 有 1 处改动、本分支 0 处 ⇒ **不去碰**：为一处并不虚假的句子新增一枚重叠文件，
是把 sweep 的成本换成落地的成本。
### 8.161 落地前把载体重算先跑一遍：十一族对今天的 main 仍然全覆盖（`other=0`），但一趟"全绿"里藏着一枚没人检查的环境前提（2026-10-05 03:2x）

窗口一开，`land-main --confirm` 就是一整趟：载体重算 → 配对归属 → 完整 `pnpm check`。如果它死在
"第十/十一族之外"或者一棵树的环境前提上，代价不是十分钟，是那一枚等了三小时、条件刚凑齐的窗口。
所以趁 `阻塞集=1`（别人的 `package.json` 还没提交）把**同一份脚本**先跑一遍 —— 不是复刻逻辑，是
把它的三个 env 旋钮指向一次性目录：

```bash
cd heyta-wt-selfhost && HEYTA_CARRIER_WT=/tmp/heyta-pf-carrier \
  HEYTA_CARRIER_PAIR_WT=/tmp/heyta-pf-carrier-pair \
  HEYTA_CARRIER_BRANCH=preflight/selfhost-carrier-1005 \
  node research/tools/selfhost-merge-carrier.mjs
```

（三个旋钮本来就在脚本里读 env，所以预检与真跑是同一段代码；预检不碰 `/tmp/heyta-merge-carrier`
—— 那棵树与并行那条线的打包共用，也不碰 `feat/self-host-merge-main`。）

**① 预检的结论：十一族够用。** 四趟读数（main 在这十几分钟里从 `0de18b87` 走到 `741c31c4`，
每趟都重取）：`分族：pkg=1 gi=0 png=0 audit=1 snap=1 gen=1 cov=1 cap=1 dock=1 deploy=1 lspec=1 **other=0**` ·
`合并归属：写 73 枚 / 合并相对 main 改 73 枚 / 集外 0 / 写集里未被改到 0 枚` ·
`check 链段 main=84 本批=67 base=66 并集=85（摘段 0/0）` · 第八族 17 臂红 0、第十/十一族 9 臂不符 0、
归属判据 12 臂红 0。⇒ 落笔不会被"新来一族"挡住。冲突稳定是 9 条，逐条都有族认领。

**② 顺带量到一条落地前不会失效的前提。** 载体那侧的 `node_modules/.pnpm` 是 **10-04 07:03 由人装进去的**
（脚本既不装、也不检查它存不存在）。现量 `depsFresh(/tmp/heyta-merge-carrier)`：根锁 `0f3c1bf6…` 与
`main:pnpm-lock.yaml` 逐字节相同、e2e 锁 `021a9df4…` 相同、`stale=[]`；而并集相对 main 的 7 行
`package.json` diff **全部在 `scripts` 里**（`dependencies`/`devDependencies` 一行没动，实测
`git diff a5fedf16 main -- package.json`）。⇒ 重算的 `reset --hard` 不会让 store 变得不同源，
land-main 第 3 道 gate 不挡。**这句是"现在成立"** —— main 一旦改根依赖就要重装，而那时挡的是第 3 道 gate，
不是这里。

**③ 真正的产出是一句假判据的注释**（元规则二那一族）。脚本头部先前写着"`--quiet` 的 coverage 与
install-contract 只读提交物锁 / Dockerfile / 快照 / `server/package.json` ⇒ 两条都 exit 0、**不联网、
不要 node_modules**"。前半句对（输出里的 `node_modules/<name>` 确实是锁里的键形状），后半句错：第 2 腿调
`license-inventory.mjs --json`，而那一步先要有已安装的树。错因很具体 —— **在一棵恰好有 store 的树上量到一次
exit 0，就把"这次跑得动"写成了"不需要这个环境"**。一次性载体（没有 store）当场把它照出来：第 2 腿非零 ⇒
归属层收到"这道门没有缺陷行提取式 ⇒ 判不了"⇒ 建议"先在解法侧修掉"，可那个现场没有解法可修，缺的是一棵树。

**④ 隔壁还有一条更坏的形状：假归属。** 配对树每次由 `worktree add` 新建，**永远没有 store**。所以
"载体侧点名了缺陷 + 配对侧读不到 store" 会让 `attributeRed` 得出"缺陷只在载体 ⇒ 本批带进去的"——
而真相是那一侧没被问成功。本次没走到它（第 2 腿本来就没有提取式，先被 ③ 那条拦住），但任何**带提取式的门**
（`check:docs`、`链里每条脚本目标都在树里`）红的时候都走得到。

**⑤ 做了什么**（判据方向一条没动，改的是它说的那句话真不真）：
- 在任何归属判定**之前**把"两侧任一侧读不到 store"摘出来，按**配不了**退 3，并把两棵树的 store 在场、
  目录路径、恢复命令（`cd <缺的那侧> && pnpm install --frozen-lockfile && cd e2e && pnpm install --frozen-lockfile`）
  打全。结论仍然不放行 —— 这一支不是把"判不了"改成"过"。
- 归属没全过的那条消息现在把"这条红是本批的"与"这条红判不了"分开念：后者要补的是**点名形状**，不是缺陷。
- 每次重算落一行运行前提读数：`落笔前门禁的运行前提：载体 store 在场=false（/tmp/heyta-pf-carrier5）· 门禁 9 道`。
  这是"打包输入由门禁隐提供"那一族的同一条规律：**环境也是被测对象的一部分**，它得出现在读数里。
- 顺手修了自己写的一处计数 bug：`reds.filter((g) => !blind.includes(g))` 里 `blind` 装的是 `{g, m2}`，
  恒不等 ⇒ "另外 N 道红"数成了全部（第五趟改按 label 集合后现量读成"另外 1 道红 … check:docs"）。

**⑥ 复现**（不是"待验证"）：上面那条命令连跑两趟即可。旧文本只印 1 道"判不了"、第二道是谁只能靠再跑一趟去猜；
改后点名全部红集并把 `check:docs` 单独列出。⚠️ **边界**：预检没证明"配对层会把 `check:docs` 归到非本批"
—— 那半段要有 store 的载体才走得到，落地那一刻才是它的现场。载体侧有 store 时第 2 腿根本不红，
⑤ 那条分支平时不被触发；它守的是"当它红的时候，别把人引到错的方向"。

**⑦ 一般规律**：**"在某棵树上跑通过"不等于"这条判据不依赖那棵树的环境"**。要写的不是"不需要 X"，
而是"这一趟 X 在场=${…}"——把前提落成一行现量读数，下一读的人就不用猜，也不会有人把一次偶然的
成功读成一条不受环境约束的规则。
### 8.162 配对那一层第一次被真跑：载体红 1 道逐条归属到非本批；为此补了"形状 + 条数"的键、一个借 store 的预检旋钮，和一处我自己造出来的泄漏（2026-10-05 03:3x）

§8.161 那一趟停在"配不了"（两棵一次性树都没有已安装的树）。这一轮把那条路打通，为的是让**配对层**
—— 落地判据里唯一回答"这条红是不是本批的"那一层 —— 第一次真的被跑一次，而不是只活在合成输入的臂里。

**① 借 store 的前提写成锁，不写成印象。** 新旋钮 `HEYTA_CARRIER_LINK_STORE_FROM=<另一棵检出的根>`
把已安装的依赖树**软链**进载体树与配对树。前提是两侧（根的与 `e2e/` 的）`pnpm-lock.yaml` 的 sha256
**逐字节相同**，不同就退 3 不软链 —— 那边装出来的字节不是这一把锁的，借来只会让"配对"量错东西。
软链建完还要**回读** `.pnpm` 真的在（`symlinkSync` 成功不等于链路通）。真落地不需要它：载体那侧有人装过，
而 land-main 第 3 道 gate 判过同源。

**② 正读数（两趟，main=`487911a5` 与 `d9da78ea`）：** `✅ 载体 78ea2850 = main(d9da78ea) × feat/self-host-distribution(fe607573)` ·
`门禁 9 道：8 道 exit 0 + 1 道**红**已逐条归属到非本批` · 那一道红的归属读数是
`check:docs：载体退 1、点名 3 条，main(d9da78ea) 同道门退 1 且这 3 条逐条都在（main 共点名 3 条）⇒ **非本批**`。
⇒ Goal 第 1 项要的那句"必须逐条仍可归属到非本批"，在**落笔前的 9 道门**这一段现在有实跑读数了；
完整 `pnpm check` 那半段仍未跑（要窗口，#35 的"真链时长"那一格）。

**③ 负读数（前提不是装饰）：** 把借的源换成 `heyta-wt-selfhost`（它的锁是本批那把 `111cc2d1…`，
载体树是 main 那把 `0f3c1bf6…`）⇒ `❌ 载体树 借 store 的前提不成立：（根）那侧 … 的锁=111cc2d1d04d3763
而 /tmp/heyta-pf-carrier7 的锁=0f3c1bf6d9e21526 ⇒ 那边装出来的字节不是这一把锁的，不软链`，
`NEG_RC=3`，teardown 把现场擦干净（`已 merge --abort ⇒ MERGE_HEAD=无 · 工作树脏 0 条`）。

**④ 一处我自己造出来的泄漏，在写盘那一步堵掉了。** provenance 那行原先把 env 里的**家目录绝对路径**
写进 `notes`，而 `notes` 进**提交说明**，载体那笔又会成为 main 的祖先。既存载体提交里 `/Users/` 出现 **0 次**
（现量 `git log -1 --format=%B a5fedf16 | grep -c '/Users/'`）—— 破坏它的是我新加的这一行。改成只落
`basename`，全路径只留在 stderr 的恢复命令里（那里需要能直接执行）。复验：新载体提交
`git log -1 --format=%B | grep -c "/Users/"` = **0**。

**⑤ §8.161 ④ 说的那个假归属形状，补上了键。** `attributeRed` 新增可选 `defectKey`：带键时按
**多重集**比（同一形状在载体多一条 ⇒ 那条算本批的，A8），不带键时**逐字语义一字不变**（原有 A6/A6b
仍拒，A10 是这条的对偶）。理由不是"逐字太严"，是逐字在这两类门上会**指错方向**：并集本身会往文档里插 11 行，
`self-host.md:88 [R1]` 到了载体就成了 `:91`。归属层自检现在 **21 条臂 · 红 0**（A7 放行 / A8 多重集 /
A9 规则词必须留在键里 —— 把数字与规则一起折叠会让 R1 与 R2 成同一个键，那是一条会放过自己缺陷的判据 /
A9b 键的形状 / A10 无键语义不变 / S1 S2 快照门两向）。

**⑥ 两条新提取式不是照着 fixture 猜的。** 在一次性根里把两道门**真判红**（快照门 31 条、入口命令门 11 条），
拿真输出喂提取式：**31/31、11/11 全命中**；键的样本 `docs/runbooks/self-host.md [R-scan]`、
`scripts/reinstall-all.sh: 清单里的文件不存在 —— 清单与现实漂移了`。先喂已知会命中的样本，
fixture 与真实形状对不上就会在这里现形，而不是等到落地那一刻。

**⑦ 三道门刻意不给键**（`check:image-license` 第 1/2/3 腿与 `check:gate-wiring`）：它们缺陷行里的数字
**就是要判的内容**（"N 条许可证没有出处"从 16 变成 143 是新信息）。折掉数字会把"恶化了"读成
"和 main 同一条"，那是会放过自己缺陷的判据 ⇒ 它们红时仍然交人。区别只在于：交人的那句话现在说的是真话
（"判不了"），不再说"先在解法侧修掉"。

**⑧ 一条收尾纪律，是踩过才写下来的：** 软链进临时树之后，清理必须**先 `rm` 掉那两枚软链**，
再 `git worktree remove --force` —— 递归删目录的工具跟着软链走就会删掉**借来的那棵树**（那是主检出的
`node_modules`，也是并行那条线正在用的东西）。删完回读主检出的 `node_modules/.pnpm` 仍在（1185 条目）。

### 8.163 落地的阻塞面从 5 枚收窄到 2 枚，且这两枚是**同一车道的一件事**；顺带把"他们只提交一半会怎样"量成了具体形状（2026-10-05 03:4x）

**为什么这一格值得单独记**：#7 的关闭判据不是"载体算得出"，是"那 5 枚重叠文件被其所有者提交"。
03:2x 我登记的是 5 枚，现量已经变了 —— 而**变的方向决定我是继续等还是重算**，所以每次都要现量，不引用上一格的数字。

**① 现量（03:4x，主检出）**：`main` = `9192445d`（比 03:2x 那趟预检的 `d9da78ea` 多 **7 笔**）。
重叠 5 枚里 **3 枚已干净**（`docs/README.md`、`packages/i18n/src/locales/zh-CN.ts`、`packages/i18n/src/locales/en.ts`），
仍脏的是 ~~**`package.json` 与 `scripts/check-script-snapshot.mjs`**~~
🔴 **这半句 8 分钟后被本条自己的判据否证**：`selfhost-landing-blockers.mjs` 报的阻塞集是 **1 枚（只有 `package.json`）**，
因为 `scripts/check-script-snapshot.mjs` **不在本批写集里**（脏 ≠ 重叠）。现量见 §8.164 ①，标题那句"收窄到 2 枚"按它读。
复现：`git status --porcelain -- docs/README.md package.json packages/i18n/src/locales/en.ts packages/i18n/src/locales/zh-CN.ts scripts/check-script-snapshot.mjs`。
🔴 我第一次量这五枚时把两份词条表写成了 `packages/i18n/src/zh-CN.json` / `en-US.json`（**不存在的路径**），
于是那条命令"什么都没打印"被我读成"已经有人提交了"。**路径要现取**：`git ls-files packages/i18n | grep locales`
⇒ 真表是 `.ts`。一次假 0 差点写成一条"阻塞已解除"的账。

**② 那两枚脏文件是**同一件事**的两半**（这是判断"等不等得来"的依据，不是印象）：
它们的未提交 diff 只做一件事 —— 把 macOS 账号注销那条线接进门禁链：
`package.json` 加 `check:shell-exit-chain` 与 `verify:macos-account-erasure` 两条 script，
`scripts/check-script-snapshot.mjs` 的 MANIFEST 加 `scripts/verify-macos-account-erasure.sh` 一行。
它们引用的两枚脚本此刻**都还是未跟踪**：`?? scripts/check-shell-exit-chain.mjs`（01:33）、
`?? scripts/verify-macos-account-erasure.sh`（01:14），且 `git cat-file -e main:scripts/<那一枚>` 两枚都 NOT@main。

**③ 于是 G-65（任务 #42）有了可判的形状**（以前我只写了"指向未跟踪脚本，落地前会悬空"）：
他们**必须两枚脏的 + 两枚未跟踪的一起提交**。只提交那两枚 `M` 的话，main 上的 `pnpm check`
会死在**第一道**门 `check:gate-wiring`（`package.json` 里那条 `node scripts/check-shell-exit-chain.mjs` 找不到文件），
`check:script-snapshot` 同时会因为 MANIFEST 里那行指向不存在的脚本而红 —— 也就是说
"**卡住我落地的那笔提交**"如果只做一半，会把**整条链**变成红的，而我的载体在那种 main 上跑不出可用读数。
这条不该我修（绝不代改他们的文档与脚本），但**它是我落地条件的一部分**：载体重算时 main 必须是自洽的。
🔴 共享工作树里 `git commit` 提交的是整个索引 ⇒ 他们那笔若顺手 `git add -A`，会把**并行会话正在用的东西**一起带走；
这一条只能由写的那个人遵守，我这边唯一的自保是"每次落地前重算载体 + 提交只点名自己的路径"。

**④ 多出来的 7 笔不挡路**（现量）：`git diff --name-only d9da78ea..main` 只有三枚文档
（`docs/plans/goal-multi-end-coverage.md`、`docs/plans/multi-end-coverage-handoff.md`、`docs/runbooks/android-build-on-windows.md`），
与本批文件集**零交叠**（`git diff --name-only main...feat/self-host-distribution` 里 grep 那三枚 = 空）。
⇒ 载体重算时十一族不会因这 7 笔新增集外路径；main 前进会把 03:2x 那次预检的基线换掉，
但换的只是文档，**归属基线要重取**（`check:docs` 的缺陷条数是从 main 现量的，不抄这里的数字）。

**⑤ 状态**：哨兵（pid 3361，02:04:32 起跑）仍在等连静 15 分钟；main 每前进一笔，"main 未变"那一格重新起算 ——
这是设计，不是故障。等窗口期间本轮**不起任何重活**：负载与端口是它要量的两格，我自己跑一条门禁就会把窗口吃掉。

### 8.164 阻塞集现量 = **1 枚**（不是我登记的 2 枚）；把"窗口为什么一直不开"的那一格读准了，顺手按并集代码走了一遍他们那份 diff 的形状（2026-10-05 03:4x–03:47）

**① 判据自己给的读数**（0.15s，纯读）：`node research/tools/selfhost-landing-blockers.mjs` ⇒
`main = 6fa73ae0 · feat/self-host-distribution = a02bd3f7 · 夹具 5/5 · 写集 73 枚 · 脏条目 29 枚 · **阻塞集 1 枚：package.json**`。
🔴 这否证了我 03:4x 写进 §8.163 的那句"仍差 2 枚"：`scripts/check-script-snapshot.mjs` 在主检出确实还是 `M`，
**但它不在本批的写集里**（`git diff --name-only main...feat/self-host-distribution | grep check-script-snapshot` = 空，
同一命令里 `package.json` 命中 1 枚）⇒ 它不构成"我的落地要等它"。
它的脏只是**他们那条线的自洽问题**（G-65 / 任务 #42 讲的是同一件事），我把两件事并成了一句"5 枚已收窄到 2 枚"。
**可迁移的那条**：阻塞集的判据是"**写集 ∩ 脏集**"，所以目标原文里那份"5 枚重叠文件"的清单是**§8.16 时代的写集快照** ——
写集会随提交变窄（我这批现在 73 枚），引用旧清单就等于引用别人正在消失的前提（[[feedback-attribution-carries-a-precondition]]）。

**② 窗口为什么一直不开（现量，不是猜）**：哨兵 03:17–03:45 那 12 行心跳里，负载 6.19–11.53 **全部 ≤12**、
端口全空、载体空闲，唯一不成立的是 `阻塞集=1` 与 **"main 变了"** —— main 在那 28 分钟里前进了 **10 笔**
（423bed1a→741c31c4→73305a73→b4cf434a→d9da78ea→caaf9775→8b690dcf→dba68caf→9192445d→0431d829→6fa73ae0），
平均 2–3 分钟一笔，而 `QUIET_MIN=15` 要求连 6 个采样点 main 不动。
⇒ **绑定条件是"别人停止提交"，不是负载**。这一格要说准：等的是**人**，不是机器底噪
（[[feedback-wait-on-people-not-on-machine-noise]]）。
⚠️ 顺带把一条我自己的错读挡住：那 10 笔的 `--name-only` 全是三枚文档（§8.163 ④），
看起来"改文档不该挡我" —— 但"main 未变"这一格是**承重**的，不是保守的装饰：
`selfhost-land-main.mjs` 是以 ff-only 前进 main，跑链那几十分钟里 main 只要动一笔，
第 7 道 gate（未被抢先）就必须拒，否则我把载体按旧 main 算出的并集盖到一条已前进的线上。
不许为了开窗把这一格改窄（同"不许改判据凑绿"）。

**③ 按并集代码把**他们那份未提交的 diff** 走了一遍**（读代码，不是跑载体 —— 跑要窗口）：
他们的形状是 (a) `check` 链里插一段 `pnpm check:shell-exit-chain`、(b) 新增两个 scripts 键。
逐条对上 `selfhost-merge-carrier.mjs:425-464`：
链并集以 main 侧 `oChain` 为基准、只插 `tChain` 里 main 没有的段 ⇒ 他插的那段本来就在 `oChain`，**位置原样保留**；
新键走"一侧独有 ⇒ 直接收"（`:426-429`），不会碰到 `:433` 那条"两边都改且互不相同"的 die(2)；
`dropped.main/dropped.src`（`:462-463`）只在**有人摘段**时才响，他们是纯增。
round-trip 那步也不受影响：`originalOf`（`:482-489`）从两侧原文建映射，他那段是标准 `pnpm ` 前缀。
⇒ **结论**：他提交之后，载体重算不会因这份 diff 而 die(2)/die(5)。
🔴 但这一条是**代码走的**，不是实测的：窗口开成真跑一遍之后，要把这句换成现量读数（`package.json 并集 scripts 键 N 个 · check 链段 main=… 本批=… 并集=…`，那行本来就打进提交说明）。

**④ 我这侧今天没有可做的**（写下来挡"闲着也是闲着去动高危文件"）：G-62（任务 #39）剩的两步落在
`packages/i18n/src/locales/*.ts` 两份词条表 —— §8.137 那条"不去加宽合并面"的理由**今天更成立**：
那两条表刚被其所有者提交（03:4x 现量干净），而写的那个人正在连排提交（2–3 分钟一笔），
此刻去改词条 = 直接把阻塞集从 1 枚撑回 3 枚并撞上他的下一笔。指南 runbook 那一半（`/app/` 那句）§8.137 已证**本来就有**。

### 8.165 落地前那六格"未知"换成读数：四格实测、两格明写"读代码不是实测"，并顺手查出唯一一条会让窗口白开的环境风险（2026-10-05 03:4x–03:5x）

窗口没开之前能做的不是等，是把**窗口一开就会被烧掉**的未知先量掉。逐格与复现命令：

| 格 | 现量 | 复现 | 性质 |
|---|---|---|---|
| 阻塞集 | **1 枚（`package.json`）**，main=6fa73ae0 · 写集 73 · 脏 29 | `node research/tools/selfhost-landing-blockers.mjs`（0.15s） | 实测 |
| 载体 store 与锁同源 | ✅ 根工作区 `lock=0f3c1bf6d9e2(361300B) = installed` · e2e `021a9df4add8(993B)` | `node research/tools/selfhost-deps-fresh.mjs --dir=/tmp/heyta-merge-carrier` | 实测 |
| 冲突面 | 十一族对今天的 main 仍全覆盖（集外 0、摘段 0/0）；main 新增那 10 笔只碰三枚文档，**都不在本批写集**（`git diff --name-only main...HEAD` 里 grep 那三枚 = 空；同一条命令 grep `pnpm-lock` 也 = 空 ⇒ 本批不动锁） | §8.161 + §8.164 ④ | 实测 |
| 配对归属层 | 载体红 1 道逐条归到非本批（借 store 的预检旋钮），判据自检 21 臂红 0 | §8.162 | 实测 |
| 他们那份未提交 diff 会不会让并集 die | **不会**：链上纯增 ⇒ 位置原样保留；两个新键走"一侧独有直接收"（`selfhost-merge-carrier.mjs:426-429`）；`dropped.*`（`:462-463`）只在摘段时响；round-trip 的 `originalOf`（`:482-489`）吃标准 `pnpm ` 前缀 | 读 `:425-494` | 🔴 **读代码，不是实测** ⇒ 真跑之后换成载体打进提交说明的那行 `package.json 并集 …` |
| 哨兵自动那一枪的接线 | `--run-on-open` 用 `spawnSync('sh', …, {cwd: mainTree})`，而 land-main `:308` 要求 `--confirm` 必须在主检出里跑（`here === mainTree.path`）⇒ 形状对得上；工具路径从 `SELF` 绝对化（`:60-61`），不依赖 cwd | 读哨兵 `:380-388` + land-main `:308` | 🔴 同上（读代码） |

**① 唯一一条会让窗口白开的风险，是**锁**这一格**（现量出来的，不是推测）：
`main` 的 `pnpm-lock.yaml` = `0f3c1bf6d9e2`，最后改动是 `2f735392`（10-03 23:58「并行批次的总接线 —— …包清单…」）；
载体树的锁与它**同一串 sha256 前缀**（判据取的就是这 12 位），载体已装的 store 也标着同一枚 ⇒ 第 3 道 gate 今天成立。
⚠️ 但这一格**只在落地那一刻成立**：落地前 main 若再吞一笔动锁的提交，重算出的载体锁就换哈希，
而 `gate(1)` 只同步提交、**不重装依赖** ⇒ `depsFresh` 转红、整趟以退 3 结束（环境无效），
而修它是往 `heyta-wt-selfhost` 那棵树里 `pnpm install` —— 那棵树与并行那条线的打包**共用**，不能随手装。
⇒ 窗口开前的最后一个动作应该是**重取这两枚哈希**（就是上面那条 depsFresh 命令），不是引用这一格。
对照：本批工作树自己的锁是 `111cc2d1d04d`（比 main 旧），**与这件事无关** —— 尺量的是载体树。

**② 一条不要照做的诱惑**：想"先跑一遍 dry-run 确认没问题"恰好会把窗口吃掉 ——
`carrierSha` **只来自 `--carrier` 选项**（land-main `:326`），所以不带它时 `gate(1)` 无条件重算载体，
dry-run 也会写盘、也会上负载。判"这一步是不是零成本"要看**它会不会走进重算/门禁那几道**，不是看它有没有 `--confirm`。

**③ 到点这件事不重抄数字**：哨兵实例的 CAP 与"main 多久动一笔"都在 §8.164 ②（那里是现量），
本条只加一句判读：**到点而窗口没开 = 环境无效（不是产品失败）**，处置是重开实例继续等，不是改阈值。
🔴 这一格刻意只留指针不留数值 —— 同一个结论句落在两份文档里，改一处必漏一处（本批已为此 sweep 过五次）。

### 8.166 我自己那条"批量跑门禁报 rc"的循环是坏的：它把**不存在的脚本**读成 rc=0，而我把那句"四道文档门禁复跑 rc=0"写进了两笔提交（2026-10-05 03:5x 现量更正）

**① 坏在哪（一行命令就能复现的形状）**

```sh
for g in A B C; do node "$g" >/dev/null 2>&1; echo "$(basename $g) rc=$?"; done   # 🔴 全废
node A >/dev/null 2>&1; rc=$?; printf '%s rc=%s\n' "A" "$rc"                       # ✅ 唯一正确写法
```

`echo` 里的 `$(basename …)` **先执行**，把 `$?` 换成 `basename` 的退出码（恒 0）。
所以我对产品负责人那句"四道文档门禁复跑 rc=0"**不是读数**，是 `basename` 的返回值
（§8.164 与 §8.165 两次追加各用了这种循环；三节正文本身没有复述过那些 rc，所以**不需要撤回结论**，
要撤回的是"我验过了"这句话）。这不是措辞问题：同一轮我因此**没有发现路径是我编的** ——
循环里我放了 `scripts/check-doc-citations.mjs`，本分支根本没有这枚文件（`node` 打 `MODULE_NOT_FOUND`），
而我的探针照样报 `rc=0`。**"不存在的门禁看起来绿"是这条陷阱最贵的地方。**
🔴 与 §7 第 45/179/184 条同族（管道后 `$?` 是 `tail` 的、`cmd > log 2>&1` 之后接 `tee -a log` 的码、zsh 里 `${PIPESTATUS[0]}` 是空值），
这是这张表目的**第四种面目**：命令替换把 `$?` 换掉。正对照现成——把不存在的路径丢进正确写法，rc 必须是 1（本轮已量到 1）。

**② 重测（用正确写法，退出码紧跟命令）**：`docs-link-check` rc=**0** · `check-docs-voice` rc=**0** ·
`check-selfhost-entry-command` rc=**0** · `check-script-snapshot` rc=**0**。
⇒ §8.163–§8.165 那三笔追加的内容本身仍然干净，只是**当时没说清它没被验证**。

**③ 顺带查出的两件真事**（都是这一轮把手伸进 main 才看见的）

1. **main 上新增了一道门 `check:doc-citations`**：`git cat-file -e main:scripts/check-doc-citations.mjs` = 存在，
   `HEAD` = **不存在**；而它默认只查 `docs/research/performance-hotpaths-audit.md`（`:67`），
   要 `--doc` 才换对象。⇒ 载体那九道落笔前门禁**不含**它（那道门是本批写集之外的 main 新增），
   它只在第 4 道那几十分钟的完整 `pnpm check` 里跑；本批的文档不是它的默认对象，
   所以它红的话是 main 自己的账（要逐段归属），不是"本批带进去的"。
2. 🔴 **登记 G-66（不归本批改）**：对外那份 `server/README.md`「Clients and version coupling」里带着**行号引用**
   （`storage-quota.service.ts:417`），而**没有任何一道门钉它**——现量：
   `grep -n "417\|storage-quota\|snapshot-handler" server/tests/version-coupling.spec.ts` = **空**，
   `check:doc-citations` 又默认不查这份文档。
   今天它是**对的**（`:417-419` 正是 "Deletion is authorized by the newest CAUSAL full-state op…" 那段注释），
   但"对"没有消费者守着就只是此刻对。
   ⚠️ 修法**不在本批**：把 `scripts/check-doc-citations.mjs` 复制到本分支去扩 `--doc`，
   会变成 add/add 冲突（该文件 main 有、本批没有）⇒ 给落地添一整族。
   关闭判据：由性能那条线的所有者把这道门的文档清单扩到 `server/README.md`（或对本批公开文档单列一次），
   并配一臂"把 `:417` 改成 `:999` 必须红"。

**④ 这一轮另外两条仍然成立的复验**（用绝对路径与现取符号，不引用记忆）
`appVersion` 在本批树上的**生产者仍是空集**：全仓（排除 `node_modules`/`dist`）`*.ts(x)` 命中 19 处，
逐条分属服务端消费者（`sync.routes.ts:157/165`、`checkpoint-gate.ts`、`device.service.ts`、`admin.routes.ts`）、
线契约（`supersync-http-contract.ts:191` 是 `z.string().optional()`）、管理台面（`admin-client.ts:156` 只是投影类型）；
唯一构造下载查询的 `packages/sync-client/src/client.ts:1324-1327` 设的是 `sinceSeq` / `limit` / `excludeClient`
三枚，**与 README 那句逐字一致**，没设 `appVersion` ⇒ 目标第 6 项那句对外承诺在当前产物上仍为真。

### 8.167 借 main 那道新门（`--root`/`--doc`）扫本批两份对外文档：runbook 里抓到两条真错话并已修，另抓到那道门自己的一个结构性盲区（2026-10-05 04:0x）

**① 用法**：`git show main:scripts/check-doc-citations.mjs > /tmp/cdc.mjs`，再
`node /tmp/cdc.mjs --root . --doc docs/runbooks/self-host.md`。
🔴 刻意走它的两个旋钮而不是自己重写一遍判据 —— 换实现就是从"同一个判断写两次"开始漂的地方。
它每次先跑内置三维阳性对照：本轮 `SELFTEST=pass（路径维=抓到 · 无锚维=抓到 · 假 SHA 维=抓到）`。

**② runbook 报 3 条，其中两条是真错话**（`docs/runbooks/self-host.md` §7「升级与备份」）：
原句写 `./scripts/deploy.sh --build` 与 `./scripts/backup.sh`，而 §3 那句 `cd server`（`:52`）离 §7 有 170 行 ——
跳到"升级与备份"的人站在仓库根照敲，得到的是 `No such file or directory`。
这就是目标后半句"停掉对外错话"里最实在的一类：**句子没错，路径在它不在的那个上下文里**。
改成仓库根相对的唯一形状 `server/scripts/deploy.sh` / `server/scripts/backup.sh`
（与 `docs/runbooks/deployment.md:201/713` 的既有写法同一口径），并补一句 `BACKUP_DIR` 可覆写
（现量 `server/scripts/backup.sh:33` = `BACKUP_DIR="${BACKUP_DIR:-$SERVER_DIR/backups}"`；
原句"pg_dump 到 `server/backups/`"本身是对的，留着）。
第三条（§6 里指回第 3 节的那句）改成不带路径 span 的写法 —— 那一处指的是第 3 节代码块，不是一条新命令。
修后：`126 span · 无问题` rc=**0**。

**③ 🔴 那道门自己的盲区，是 G-66 的续集**：同一把尺扫 `server/README.md` 报 **6 条**（`:48 :79 :152 :166 :176 :177`），
而这 6 条**都不是错** —— 那份文档自己在 `:56` 写着"（`env.example`、`scripts/deploy.sh` 都在这里）"，读者先 `cd server`。
尺子把路径 span 一律按**仓库根**解析，它没有"这段指令的工作目录"这一维。
⇒ 给 G-66 的所有者加一条前置：**先把 cwd 约定定下来**（文档统一写仓库根相对，或那道门支持 per-doc 的 cwd 声明），
再谈把清单扩到 `server/README.md`；否则扩容第一次跑就红 6 条，被下一位读成"对外文档坏了"而去"修"一堆对的东西。

**④ 顺手否证我自己差点写的一条担心**：`server/scripts/deploy.sh:153` 那句
"`deploy.sh --build` 在**文档写明的部署方式下永远跑不起来**"，我差点据此把 runbook 让人带 `--build` 判成错话。
现量：`:153` 讲的是**已被修掉的因** —— 同一个函数里 `:159-165` 遇到非 git 工作树时打 WARNING、
说明"脏树守卫做不了"并 `return 0` 继续跑。⇒ 带 `--build` 不是错话；真实代价是镜像 revision 标签退化成 `local`（不可回溯到 commit），
而那条脚本自己已经把代价讲清了，runbook 不需要另加警告。

**读数**：`docs-link-check` / `check-docs-voice` / `check-selfhost-entry-command` 各 rc=**0**
（`rc=$?` 紧跟命令、`printf` 参数里不做命令替换 —— 形状见 §8.166 ①）。

### 8.168 用 main 那道新门回头扫自己的台账，扫出两条**已被 main 否证的旧断言**，顺带量清这道门能扩到哪里（2026-10-05 04:0x）

**① 台阶 0 那条对外错话，main 已经自己修了**（现量，带锚）：
`git show c1c203c8:packages/i18n/src/locales/zh-CN.ts | grep -n site.docs.selfhost.s7p1` = 第 **3567** 行，
措辞已是**反的**："不要把 `SUPERSYNC_IMAGE` 指向上游的 `master-〈提交号〉`"。
⇒ 台账 `:470` 那句"`s7p1` 在 main 上仍教人指向上游 = 是"就地划线更正（原句留着，理由同 §8.166：
带日期的"仍然是"不会自己通知你失效）。对本批的含义是好的：**落地不会把它带回去**，
而两份词条表在两侧都改 ⇒ 走 i18n 那一族。
🔴 我原来那一句的取证命令用的是 `git show HEAD:` **没锚**，而 `HEAD` 在哪个树上取决于谁跑 ——
这正是那道门存在的理由，我自己的台账里也有两枚这种句子。

**② G-47 那一族：main 现在也有 `@fastify/websocket@11.3.3` 的登记了**（不是注释，是条目本体，`checkedAt: '2026-10-04'`；
`git show c1c203c8:research/tools/check-image-license-coverage.mjs | grep -c websocket` = **1**，本批 HEAD = 4）。
⇒ 台账 `:3480` 那句"防御只活在我分支和另一条会话的未提交改动里"被 main 自己否证，已就地更正。
落地含义：这枚文件变成**两侧都改**的形状 ⇒ **载体第七族（对账器本体）第一次会在真窗口里被真走到** ——
这一格先前只有合成臂的读数（#27），现在有真输入了。
⚠️ 另一条可迁移的：同趟 `grep -c IMAGE_ONLY` 在 main 上是 **7**，而那句当时写"14 条登记"
⇒ 两个数不是同一件东西（含该词的行 vs 登记的枚举行）—— 引用"N 条"要带数法（[[feedback-duplicate-facts-drift]]）。

**③ 这道门能扩到哪里（110 条这个数字本身就是答案）**：
把 `check:doc-citations` 的尺子拿 `--root/--doc` 指向本台账（10 052 行取证文档），报 **110 条**
（那一趟量于追加本节之前；本节自己又添了几条"被引用成示例"的串，所以这个数字下一轮会变——它的作用是**形状分布**，不是水位），
其中**只有 2 条**是本批该改的（就是 ①② 那两句没锚的 `git show HEAD:`，已修）；其余的形状是
npm 包名（`@fastify/accept-negotiator@2.1.0`）、被引用成"错误示范"的字符串（`./scripts/deploy.sh` 在 §8.167 里是**被纠正的对象**）、
尚未创建的目录（`server/backups`）、上游历史路径（`packages/super-sync-server`）、运行期文件（`server/.env`）。
⇒ 三条边界，都写进 G-66 的移交里，一条都不能省：
(a) **对外指令文档**（runbook / `server/README.md`）适用，但要先解决 §8.167 ③ 的 **cwd 维**；
(b) **长篇取证台账**不能直接进清单 —— 它需要 per-doc 的模式（只查 `git show` 锚 + 显式"这是仓库路径"的形状）或豁免表（那道门已自带 5 条逐条带理由的豁免）；
(c) **被引用成错误的字符串**与**指令**在语法上同形，只有"这句是不是要人照敲"这个语义能区分 ⇒ 任何扩容都要先有一条"引用-作为-错误"的登记形状，否则下一位会去"修"一批对的句子。

**读数**：`SELFTEST=pass`（三维都抓到）· runbook 修后 rc=**0** · 本台账 rc=**1**（110 条，见 ③）·
`docs-link-check` / `check-docs-voice` / `check-selfhost-entry-command` 各 **0**。
🔴 这三枚 `rc` 是用 §8.166 ① 那个正确形状量的；同轮我又踩了一次老坑 ——
`node X | tail -6; echo $?` 读的是 `tail`（`AUDIT_RC` 一度显示 0，其实是 1），
以及 `$M:research/…` 在 zsh 里被当成 `${M:r}` 修饰符把路径啃成 `esearch/…` ⇒ ref 一律**加引号**写 `"${M}:path"`。


### 8.169 落地前那一格"冲突面还在不在十一族之内"换成一条不建载体的读数，并拿一次真载体复算把它对上了（2026-10-05 04:1x 现量）

窗口是这批唯一贵的东西。哨兵等的是**五件**同时成立（阻塞集 0 / 负载 ≤12 / 射程端口空 / 载体空闲 / main 不动，连静 6 样），
而这五件里**没有"冲突面还在预置十一族之内"** —— 于是可能出现：窗口开 → 重算载体 → 撞出一枚新族 → `die(2)` ⇒
这一趟窗口连同它前面那十几分钟连静一起白烧。而"不会新增"这个前提**不是恒真的**，本批的族数一夜从 8 涨到 11
（第九族 10-04 23:0x、第十/十一族 10-05 01:1x，出处见载体文件头）。所以它得量。

量它的正规办法是跑载体，而跑载体不便宜：要一棵 `/tmp/heyta-merge-carrier` 工作树、要过"别的进程正在用这棵树"闸门、
还要真跑一遍 merge 并带着第九族 17 臂 + 归属 21 臂两套自检。**这一格本可以在窗口开了之后才发现** ——
和 §8.138 那条"这条判据要窗口"是同一个错的第二种面目：那格是把 3 秒的读数挂在 30 分钟上，这一格是把一次纯读盘的近似
挂在"必须动那棵树"上。

#### 装置：`research/tools/selfhost-conflict-screen.mjs`（纯读盘，零写盘，不动任何 ref）

| 判什么 | 怎么判 |
|---|---|
| 两侧都动过的同一枚路径 | `git diff -M --name-status` 取两侧集合求交，对交集逐个拿 base/main/src 三份 blob 跑 `git merge-file`，冲突块 >0 ⇒ 预测进 unmerged |
| 一侧删、另一侧改 | 直接预测 unmerged（`kind=modify/delete`；git 在这里一定留冲突条目） |
| 预测到的那批落在哪一族 | 按载体的族表分类，打印 `pkg=… other=…` 与逐枚清单 |

🔴 **它不判"会不会有冲突"，它判"有冲突的那批里有没有一族没预置的"** —— 纯追加在第 2/4/10 族里是**要**出现在 unmerged 集里的
（载体才有并集可解），这一点在自检里是被当期望值钉住的（A4 期望 **1 块**而不是 0）。

**看不见什么（明写，不折算成 0）**：~~任一侧改名参与（`R`）→ 只进 `blind` 清单，不进"无冲突"~~
⚠️ **这句在写下的一小时内被自己否证了**：那一版只在"两侧都用同一个新名"时才抓得到改名，
而按名字求交的交集**看不见**"一侧改名、另一侧改的是那个旧名"这一类 ⇒ 它报的是 `0 冲突 0 盲点`，
也就是**假的全绿**。修法与证据见 §8.172（现量：这一类在本批与 main 之间当前命中 0 枚，所以补的是潜伏的洞）。
文件/目录同名碰撞、mode/symbolic-link 位变化 —— `--name-status` 根本不报。
所以退出码是 `0 =集外 0 且无盲点 / 2 =预测有集外（落地会 die 2）/ 3 =有盲点或 blob 读不到（这一格只能靠载体实测）`，
**退 3 不是"可以落地"**。

#### 为什么族表是**抄件**而不是抽公共模块

那 11 枚路径字面量目前住在 `selfhost-merge-carrier.mjs:290-345`，各被引用 4–12 次。为了让一个只读预测工具去搬它们，
要把落地路径上唯一执行者的十处引用改成 import —— **改漏一处的故障时机恰好是落地那一刻**（`ReferenceError` 在解第 N 族时才抛）。
代价与收益不成比例，所以按本仓既有做法办：**留抄件 + 配一条会红的对账**（形状同哨兵 B11"判针有出处"）：
`--selftest` 的 A2/A2b/A2c/A2d 四臂每次自检都读载体原文 —— 本表某枚字面量在原文里找不到、
本表少一族（反向检查报"不认的族键"）、载体加了第 12 族而本表不认 ⇒ 三样都直接红。

#### 牙（三组，都是现跑的）

1. **合成臂**：`node research/tools/selfhost-conflict-screen.mjs --selftest` ⇒ **臂数 27 · 红 0**（含四臂阳性对照）。
   其中两臂的期望值是被**实测纠正过**的：A4 我先按"纯追加应当自动并"写成 0 块，实跑 1 块 ——
   错的是我的期望值（git 层它就是未合并），改回来并把理由写进注释；A7b 喂了两枚同改路径却期望计一枚。
   **这两条是本工具里最有用的一次红**：如果照错误的期望值留下，它会把"载体解得了的冲突"报成"不该有冲突"。
2. **现量注入（真树，非合成）**：把一枚**不在任何族里**的路径造出真冲突，看它会不会报集外。
   做法不留痕：临时索引 + plumbing（`git read-tree <src>` → `update-index --cacheinfo` → `write-tree` → `commit-tree`，
   **不建任何 ref**），拿 `scripts/check-gate-wiring.mjs` 在 main 那笔插入的**同一位置**塞一行注释，
   再以 `--src=<那枚不可达 commit>` 跑：
   `other=1 content=10 mdd=0 blind=0 unreadable=0 rc=2`，点名的正是注入的那枚，而原本 9 族的计数一字未动。
   用完把 `/tmp/inj-index` 删掉；那枚 commit 不可达，只能等 gc，不留分支。
3. **与一次真载体复算对表**（这才是"预测"这个东西唯一的正经验收）：
   `node research/tools/selfhost-merge-carrier.mjs` 于 `main=f8ecbd8f · 本批=76d98b2a · base=b850b1c6` 退 **0**，
   它记在载体提交说明里的实测是 `冲突 9 条` + `分族：pkg=1 gi=0 png=0 audit=1 snap=1 gen=1 cov=1 cap=1 dock=1 deploy=1 lspec=1 other=0`
   —— 与本工具同一趟的输出**逐字相同**（枚数、族计数、以及那 9 枚路径的集合）。
   ⇒ 这一格从今天起是"落地前随手可得"，不再要窗口。

#### 那次复算顺手带回三格新的现量（都是主线上要的）

| 读数 | 值 | 为什么记 |
|---|---|---|
| `check:docs` 那条红的**条数** | main 从 5 条降到 **3 条**，载体退 1 点名的 3 条**逐条都在 main 上**（配对树 = 干净 main `f8ecbd8f`）⇒ 判为**非本批** | 落地关闭判据写的是"每条红仍可归属"，不是"全量绿"；条数是活的，只能现量（§8.165 那张表里那半格今天有了新值） |
| `check` 链的并集数学 | `main=84 本批=67 base=66 并集=85（摘段 0/0）`、scripts 键并集 157 个、非 scripts 顶层字段比了 9 个丢 0 | 第 1 族的四条断言每次重算都真跑；`摘段 0/0` 是"并集不许悄悄减一段"那条前提断言的现量 |
| 门禁 9 道 | 8 道 exit 0 + 1 道红已归属；`落笔前门禁的运行前提：载体 store 在场=true` | 完整 `pnpm check` 仍**只在落地那一刻**跑（任务 #26/#43 那两格没被这次复算冒充） |

⚠️ **这次复算不冒充任何"落地已完成"**：它只把 `feat/self-host-merge-main` 指向 `main=f8ecbd8f × 76d98b2a` 的解冲突树，
阻塞集此刻仍是 1 枚（`package.json`，归 G-65/任务 #42 那条线），所以落地仍未发生。
载体每次落地前都要重算 ⇒ 这一格读数今天新，落地那一刻必须是当时的。

📌 可迁移的一条：**"这条判据要窗口"是一句关于装置的话，不是关于事实的话** —— 它每次出现都值得问一遍
"我要的到底是哪一格读数，那一格的最小输入是什么"。同一族今天已有两个实例（§8.138 的看守中止读数、这一格的集外读数），
两者的共同点是：原装置（完整链 / 载体工作树）能给出更强的读数，于是"只有它能给"被误记成"必须等它"。


### 8.170 那一夜没开成窗的**真正原因只有一个**：其余四件连续 5.2 小时同时成立（并把"落地要 main 静默多久"算成一道可核对的算术，2026-10-05 09:5x 现量）

04:30→09:45 这一段是本轮最长的一次机会窗口，值得把它到底缺了哪一件量清楚，而不是写成"等了一夜没等到"。

#### 现量（09:5x）

| 量 | 值 | 取法 |
|---|---|---|
| 那一夜的开窗次数 | **0** 次 `WINDOW_OPEN` · 0 次落地尝试 · `*.land-*.log` 不存在 | `grep -cE 'WINDOW_OPEN' /tmp/selfhost-window-sentinel.log` |
| 每次心跳里"不成立"的原因 | 自 02:04 那枚实例起 **190 样**，其中 **129 样只差"阻塞集=1"这一件**（负载/端口/载体/main 全过）· `main 变了` 只出现在 39 样里，全在 04:30 之前 | `awk '/02:04:32 起步/{f=1} f' /tmp/selfhost-window-sentinel.log \| grep -c '不成立='` · 同一条再 `grep -c '不成立=阻塞集=1$'` |
| **两数互推** | 129 样 × `STEP=150s` = **322min ≈ 5.4h**，与下一行那条"最大静默 309.9min"是同一件事的两种独立取法 | — |
| main 在最近 6h 的静默分布 | 19 笔 · 中位间隔 **1.2min** · 最大 **309.9min** · ≥15min 仅 2 处 · ≥60min 仅 1 处 | `git log --since="6 hours ago" --format=%ct main \| sort -rn` 后逐对相减 |
| 09:54 那一样 | 阻塞集=1 · 负载 7.8 · **端口 4318/4319 被别人的进程占着**（pid 95042/95057）· 载体空闲 | 哨兵心跳行 |

⇒ 结论只有一句：**这一批离落地差的是别人那一枚没提交的 `package.json`，不是环境、不是负载、不是端口、不是载体。**
"main 不动"这一件看着苛刻（中位间隔 1.2 分钟），但它是**可以被满足的**——那一夜它连着满足了 5.2 小时。

#### 于是把"落地要求 main 连续静默多久"算出来，而不是估

需要的是 `连静阈值(15min) + 落地链本体时长`。后半截就是任务 #35 缺的那一格，**至今没有实测值**。
这里要写清我**为什么不用手工跑一遍完整链把它换成实测**（这是本轮唯一一个还能自己凑出来的取数机会）：

`check` 链里有三条 Playwright 腿（`check:ai-e2e` / `check:privacy-consent-e2e` / `check:landing-e2e`），
而 `check:ai-e2e` 的**起跑动作**是先 SIGKILL 4318/4319 上已有的进程（环境陷阱 #87 那一族）。
09:54 那一样里这两枚端口正被别人的进程占着，且那条线还在提交（09:52 刚进一笔）。
⇒ 硬约束"跑验收不抢前台、**不 SIGKILL 别人的 dev server**"直接否掉"趁现在没人跑一把"。
**这条约束不是习惯**：它现在有了现量理由——会在别人正在跑的那趟上把一个进程杀掉，而那看起来像我这边成功了。

顺带把"能不能把链里的三条 Playwright 腿摘掉再测时长"也否掉：摘腿测出来的不是 `pnpm check` 的时长，
拿它去定 `连静阈值` 就是拿一个更小的数当阈值 ⇒ 窗口开更早、死得更晚，比现在更糟。
所以 #35 只能等第一次真尝试；我已把这一格做成**自动落进日志**（见下）。

#### 哨兵决定层里那条会把"没跑起来"记成"被人抢先"的洞（已修，带变异证据）

`spawnSync` 起不来时 `status` 是 `null`，而原写法 `const rc = r.status ?? 1` 会把它折成 **1**，
1 在这条链上的语义是"main 在算完载体后又动了 ⇒ 可重试"（`decideAfterLand`）。
后果不是报错，是**安静的错归因**：三枚尝试全部用满、哨兵收工，而日志里每一行都写着"别人抢先"，
下一位读到的结论会是"这一夜窗口来过又被顶掉了"——真相是落地脚本一次都没被执行。

改法是抽一条纯函数并让它先判 `r.error`：

```js
export const landRcOf = (r) => (r.error ? 2 : (r.status ?? 1));
```

`2` 那一档在 `decideAfterLand` 里是"探针坏 ⇒ 拿同一个坏探针再跑一遍还是坏的 ⇒ **停**"，
并且新加了一行把 `r.error.message` 打进心跳。

| 证据 | 读数 |
|---|---|
| 改后自检 | `臂数 29 · 红 0 · 判定臂 26 条`（原 25 臂） |
| 新增臂 | B12（`r.error` ⇒ 2）、B12b 阳性对照（同一枚对象按老写法读确实是 1 ⇒ 这条臂是承重的）、B13（退 4 原样是 4，不重试）、B13b（`status=null` 且无 error ⇒ 仍按 1，保留旧行为） |
| **变异证明它能红** | 原地把 `landRcOf` 改回 `r.status ?? 1` ⇒ `🔴 B12 … 期望 2，实得 1` · `臂数 29 · 红 1`；从 `/tmp/sentinel.pre-mut` 还原后 `cmp -s` 逐字节相同、自检复绿 |

同处加了 `LANDER 时长=<n>min` 一行（第几次尝试、这一段就是"窗口开之后 main 还必须继续不动那么久"的实测）
⇒ **#35 那一格会在第一次真尝试发生时自动写进心跳**，不再需要谁事后手算。

#### 重起哨兵这件事的取舍（记下来，因为它的判据是现量而不是感觉）

哨兵 v5 是**已在跑的进程**，改文件不会进到它里面；而重启会把连静清零。
这一夜连静一直是 0（`阻塞集=1` 撑着），所以重启**什么都不丢**，反而立刻拿到新决定层和时长读数 ⇒ 做了。
参数逐字沿用上一枚实例记在 `/tmp/selfhost-window-sentinel.pid` 里的那一组（`step=150 cap=28800 quiet_min=15 load_max=12 run_on_open=1`），
新实例 `pid=96927`，覆盖到本地 17:5x。
⚠️ 我第一次重启用了 `nohup … &`，进程没活下来（`pgrep` 空）——**"投放后台后第一个动作是用 pid 证明它在"这条老规矩又被自己验了一次**：
改用受跟踪的后台任务起，再 `head -1` 那枚 pid 文件确认。

#### G-65 的最新形状（它没变好，但变清楚了）

09:5x 现量：主检出 `package.json` 仍未提交，里面新增**两条**而不是原来担心的"一条链段"：

- `"check": "… && pnpm check:shell-exit-chain && …"` —— 实现 `scripts/check-shell-exit-chain.mjs`（01:33）**未跟踪**；
- `"verify:macos-account-erasure": "bash scripts/verify-macos-account-erasure.sh"` —— 实现（06:14 还在改）**未跟踪**。

本批写集从 73 枚变 **74** 枚（多的那枚就是新入仓的集外冲突预检），脏条目 50 枚，阻塞集仍 **1** 枚。
两种后果要分开写，因为它们的处置权不同：

1. 他们**连实现一起提交** ⇒ 阻塞集归零、`check:gate-wiring` 有实现可对 ⇒ 窗口在下一段静默里就能开，本批不动手。
2. 他们**只提交 `package.json`** ⇒ main 自己会红在 `check:gate-wiring`（链段指向不存在的脚本）。
   那条红**可归属到非本批**（落地关闭判据本来就允许带可归属的红），但本批不该把它当"能落地"的信号：
   载体第 1 族的并集是**逐字保留两侧链段**的，这条会悬空的段照样会被并进载体 ⇒ 落地那一刻的红集里多一枚非本批红。
   这一档**由那条线自己收**，我不替他们摘段（摘段 = 改他们的对外承诺，且载体脚本对"摘段"是 `die(2)`）。

📌 这一节可迁移的那条：**"等窗口"不是一个状态，是一道算术** ——
它等于 `连静阈值 + 被等待那段工作的时长`，而后者必须由被等待的那段工作**自己**给出实测。
把阈值写在装置里（`QUIET_MIN=15`）而把它的依据留在人脑子里，就会在第一次需要解释"为什么还没落地"时退化成"环境不给力"。


### 8.171 把 main 那道新门指到**合并后的载体**上扫本批两份对外手册：一份干净，另一份报 6 条且逐条都是假阳性——两次同形状实例，够写成那道门的一条适用前提（2026-10-05 10:0x 现量）

§8.167 那回是在**主检出**上拿 `--root`/`--doc` 指过去扫的。这次换对象：**载体树**（`/tmp/heyta-merge-carrier`，`HEAD=10c48344 = main(f8ecbd8f) × 76d98b2a`）——
那才是落地那一刻真的会变成 main 的那个对象，而两份对外手册在载体上分别是"本批那版"（`self-host.md`）与"第十族并集"（`deployment.md`）。
零写盘、零端口，两条命令：

```
cd /tmp/heyta-merge-carrier && node scripts/check-doc-citations.mjs --root /tmp/heyta-merge-carrier --doc docs/runbooks/self-host.md
```

| 文档 | rc | 读数 |
|---|---|---|
| `docs/runbooks/self-host.md`（外人照着敲的那一份，本批改过） | **0** | 反引号 span 126 枚 · `git show HEAD:` 锚 0 枚 · 内置三维自检（路径维/无锚维/假 SHA 维）全 pass · 无问题 |
| `docs/runbooks/deployment.md`（第十族，两侧纯追加） | **1** | 6 条"引用了不存在的路径"，逐条见下 |

#### 那 6 条为什么全是假阳性，以及归属怎么定的

归属用**同一串在三个树里的命中数**定，而不是用印象：

| 词 | main | 载体 | 本批分支 |
|---|---|---|---|
| `server/.env` | 15 | 15 | 15 |
| `mxbiz1/2.qq.com` | 1 | 1 | 1 |
| `docs/ops/deployment.md` | 1 | 1 | 1 |

三个数相等 ⇒ 合并**一个字节都没引入**这些串，它们不是本批写的，也不是本批改出来的。逐条判：

1. **`server/.env`（4 处）**：那是让自建者**自己在机器上创建**的运行时文件，设计上不进 git（AGENTS §9 那条"tar 打包工作树会把 `server/.env` 带上服务器"的教训正是它的另一面）。
   "文档里出现一个要你去创建的文件名"≠"仓库欠这个文件"。
2. **`mxbiz1/2.qq.com`（1 处）**：腾讯企业邮箱的两台 MX 主机的**中文散文缩写**（`mxbiz1.qq.com` / `mxbiz2.qq.com` 合写），门把带点的反引号 token 一律当路径。
3. **`docs/ops/deployment.md`（1 处）**：这处最像"真死链"，读上下文才知是一张**反事实表**的第 10 行——
   那一行讲的是"交付路径**本可以**叫 `docs/ops/deployment.md`，但按 `docs/README.md` 的分层规则运维手册归 `runbooks/`，所以落在 `docs/runbooks/deployment.md`"。
   把它"修掉"（改成真路径）等于把那句命名理由抹掉。
   ⚠️ 顺带一条读数：`docs-link-check`（`check:docs`）对它命中 **0** 次 —— 因为它不是 markdown 链接语法，只是表格里一个反引号词。
   也就是说**两道文档门看的是两种不同的东西**：一道读链接，一道读反引号 token，谁都不是"全看见"。

#### 于是把"两次同形状"升成那道门的一条适用前提（这是给 G-66 那条线的证据，不是本批的待办）

§8.167 在 `server/README.md` 上撞到过一次（6 条假阳性，形态是"缺 cwd 这一维"），这次在 `docs/runbooks/deployment.md` 又撞到 6 条，形态是
**"把反引号里的任意点分 token 当仓库路径"**。两次都不是那道门的 bug——它按"仓库内路径存在性"判是对的——
而是它**默认只扫一份**（`scripts/check-doc-citations.mjs:67`：`docs.length===0` 时 push `docs/research/performance-hotpaths-audit.md`），
那份是审计文档（里面引用的基本都是真路径），而**手册类文档**的散文里坐满了"要你创建的文件""外部域名""反事实的路径名"。
⇒ 可迁移的那条：**把门从审计文档扩到手册类文档之前，先假设产出主要是假阳性，并先给那条门配一张逐条带理由的豁免表**
（它自己就是这么设计的——`PATH_ALLOWLIST` 每条都要写理由，加一条的成本是刻意的，同 `license-inventory.mjs` 的 `REVIEWED_OTHER`）。

🔴 **本批不替它加那 4 条豁免**，理由不是省事而是三条现量：
① 豁免表住在那道门的实现文件里，而**那个文件此刻正在主检出里被人家改**（`M scripts/check-doc-citations.mjs`）；
② 它**不在本批写集**（74 枚里没有它），动它就是给落地新添一枚冲突面；
③ 落地窗口按 §8.170 的算术只需要别人那一枚 `package.json`，我不在该等的地方加自己的面。
这一格因此挂到 **G-66 / 任务 #44**（那条线的所有者）名下，附的可执行内容是：
`deployment.md` 里那 4 个不同 token 各配一条理由进 `PATH_ALLOWLIST`，然后 `--doc docs/runbooks/deployment.md` 复跑取 rc=0（现量命令就写在本节上面）。

📌 这一节自己那条可迁移的：`check:docs` 命中 0 而 `check:doc-citations` 命中 1 —— **同一处文本在两道门下读数相反**，
所以"文档门过了"永远要说清是哪道门、判的是哪种引用形状。凡是把"某道文档门绿了"当"这页对外说明没问题"的地方，
都欠一句"哪一道门、它的扫描集里有没有这一份、它认哪种形状"。


### 8.172 `verify:selfhost-stack` 的全跑现量拿到了 12 层绿，最后三条浏览器判据被**本机并发测试内存闸门**拒了；顺带把我一小时前那件预检里一处"假的全绿"补上（2026-10-05 10:0x）

#### ① 第 2 项的现量：走到浏览器那一步之前，全部绿在**当前产物**上

对象 = 本分支头 `69523ee2` 自己打出来的那一枚镜像（不是缓存、不是上一轮的），完整日志 `/tmp/vss-verify-0510.log`：

| 层 | 读数 |
|---|---|
| 构建 | `镜像 OK`，且**被验镜像的 revision == 当前 HEAD**（`69523ee2a967…`）；工作树未提交条目 0 |
| 产物自洽（跑在镜像里） | 挂载 `/app/` 与产物声明一致；`index.html` 5 个本地引用、manifest 15 个文件全部存在；4 个组件数据 URL 都落在 SW 前缀 `/app/widgets/` 内；**246 个 `--ht-*` 定义**对得上产物里全部无兜底引用 ⇒ `WEB_ARTIFACT_IN_IMAGE=OK` |
| 平台 | 被验的是 `linux/arm64` ⇒ 明写它**不构成**对发布 workflow 钉的 `linux/amd64` 的运行证据（两批平台二进制包不是同一批） |
| G-47/G-53 那族 | 镜像内依赖树 × 许可证门禁对账：`145 条 = 扫描集 126 + 逐条登记的镜像独有 16 + 本仓自己的包 3`，**无解释 0 · 非宽松 0 · 声明对不上 0 · 失效登记 0**；两个独立载体对上（磁盘枚举 145 ⊆ npm 自己写的 lock 非 dev 158，差 13 条全是本平台不装的 optional 变体）；14 枚平台受限条目逐条过同一套权威 |
| 起栈 | `project=heyta-selfhost-verify` · 端口 127.0.0.1:1900 · 服务图默认 3 个**未动** / 带 override 4 个 |
| 入口命令对账（R1–R9） | 扫描集 7 份 + 故意排除 1 + 非抄件登记 6，命中 9 条逐行过；R7 把验收脚本自己的 `-f` 集合钉成对外主命令同一套文件；R8 全仓普查命中 12 枚、**未登记 0 枚** |
| D-3 迁移 | 一次性容器 `exited(0)` · 应用侧 `RUN_MIGRATIONS_ON_STARTUP=false` · 带外恢复 flag=true · **已应用 42/42 · 悬挂 0 · 重复完成 0 · 回滚痕迹 5 条（设计内）** |
| 服务端自己声明的挂载 | `[web-app] 共享 UI 挂在 /app/（来自 /app/web-dist）` ⇒ 目标那句"打开浏览器就能用"的**服务端侧**这一趟是真的 |
| 🔴 三条浏览器判据 | **没跑**：被本机 Playwright 并发测试内存闸门拒绝启动 —— `已有测试在跑（pid=49169，锁 /tmp/tfa-test.lock；它是 /bin/sh …pnpm --dir e2e run test）` |

判性：**环境拒绝 ≠ 产品失败**。所以第 2 项本轮记成"12 层绿 + 界面那一维零证据"，不写成 `verify:selfhost-stack` 通过。
没有用 `TFA_ALLOW_CONCURRENT_TEST=1` 绕过去 —— 那道闸门守的是这台机器今天弹"内存不足"的成因，
绕它拿到的绿是**用别人的稳定性换的一行读数**，与"改判据凑绿"只差一个环境变量的名字。
拆栈判据也复核了：`docker ps -a` 里 `heyta-selfhost*`/`supersync*` 残留 0 枚，`e2e/selfhost-stack-results/` 里只有 10-04 19:05 那枚 `.last-run.json`，**没有新截图**（所以更谈不上"人看过了"）。

📌 一条给下一次执行这一项的流程读数（不是改判据，是省成本）：这趟是**昂贵段全跑完**才走到拒绝 ——
docker build + 起栈 + 六层判据都付了，最后一步才被告知并发不允许。
起跑前先 `pgrep -f playwright` 现量（成本 0），就能把这件事挪到最前面。

#### ② 我自己那件预检里的一处"假的全绿"（§8.169 写下不到一小时）

复审它的交集逻辑时发现的：`predictFromMaps` 两侧**按路径名**求交，而 git 合并**按 blob 身份跟随改名**。
于是这一类完全不被看见 —— main 把 `a.ts` 改名成 `b.ts`，本批改的是 `a.ts`：

- 交集里没有 `a.ts`（main 侧的条目挂在新名 `b.ts` 下，带 `from=a.ts`）；
- 交集里也没有 `b.ts`（本批从没动过它）；
- 结果报 `content=0 blind=0`，读起来是"合并面干净"，而真合并一定会在这里留一条 rename/modify 的 unmerged 条目，
  载体按定义把它归进 `fam.other` ⇒ `die(2)`。

⚠️ 我那节里原本写着"改名参与 → 只进 blind"，这句**只在两侧都用同一个新名时成立**——
也就是说我列了盲点，但那个盲点不会被报出来。**"列出了盲点"不等于"盲点会被报出来"**，
这是 §8.169 那条"能力上线了 ≠ 说明跟着上线了"的自家复刻。

现量这一类今天命中几枚：**0**（`git diff -M --name-status` 两侧对查：main 侧改名条目里新旧名落在本批写集的 0 枚、
main 删除而本批修改的路径 0 枚、本批侧改名 0 枚）⇒ 修的是**潜伏**的洞，不是正在骗人的洞；
但这条工具的存在理由恰恰是"别让假的全绿把人放进窗口"，所以潜伏也得堵。

改法：在按名字的交集之前，**改名身份单独走一遍** —— 一侧有 `from` 而对侧的映射里有那个旧名 ⇒ 进 `blind`（两个方向各查一次）；
两侧把同一旧名改成**不同**新名（rename/rename）⇒ 也进 `blind`。看不见的那两样仍然明写看不见：
文件/目录同名碰撞、mode/symlink 位（`--name-status` 不报）。

| 证据 | 读数 |
|---|---|
| 自检 | `臂数 32 · 红 0`（新增 A8c/A8c-1/A8c-2/A8d/A8e 五臂） |
| 变异 | 原地摘掉那两行 `renameCross(...)` ⇒ `🔴 A8c 期望 1 实到 0`、`🔴 A8c-1 期望 "old.txt→new.txt" 实到 undefined`、`🔴 A8d 期望 1 实到 0`（`臂数 32 · 红 3`）；从 `/tmp/screen.pre-mut` 还原后 `cmp -s` 逐字节相同、复绿 |
| 真树复跑 | `main` 已推进到新一轮提交，读数仍 `other=0 content=9 mdd=0 blind=0 unreadable=0 rc=0` ⇒ 这一格的答案今天没变，但**它现在是有依据的没变** |

### 8.173 那 5 枚重叠文件被它们的所有者提交完了；G-65 是按**它自己写的那条判据**关的，不是按"文件干净了"关的（2026-10-05 10:1x）

第 1 项等的那件事（"等主检出那 5 个重叠文件被其所有者提交"）**在这一刻满足了**。这一段把"满足了"拆成三条独立读数，
并把落地剩下的东西精确成"只剩环境"。

#### ① 那 5 枚的现量（逐枚点名，不是一句"都提交了"）

| 文件 | 此刻在主检出的未提交状态 | 它落在哪笔 |
|---|---|---|
| `docs/README.md` | 干净 | `2ea0e3c0` 10-05 00:08 |
| `package.json` | 干净 | `9856a4a7` 10-05 10:04 `feat(gates): check:shell-exit-chain …` |
| `packages/i18n/src/locales/zh-CN.ts` | 干净 | `baf125e5` 10-04 20:45 |
| `packages/i18n/src/locales/en.ts` | 干净 | `baf125e5` 10-04 20:45 |
| `scripts/check-script-snapshot.mjs` | 干净 | `f9152fbf` 10-05 10:04 `feat(macos,server): 账号注销在 macOS 壳上的界面级擦除验…` |

阻塞集同刻：`夹具 5/5 条通过 · 写集 74 枚 · 脏条目 20 枚 · 阻塞集 0 枚`，而那句"夹具已绿 ⇒ 这个『空』是可信读数"
是工具自己打的（不是我把空读成绿）。哨兵侧独立对上了：10:05 那一样起，`不成立=` 里**不再有阻塞集**这一项。

#### ② G-65 关闭（复跑的是判据本体）

```
node research/tools/selfhost-chain-targets.mjs --pkg ../heyta/package.json --tree main
→ 链步 85 · 取到脚本目标 82 枚 · checked 78 · no-target 7 · unresolved 0 · **悬空 0**
```

🔴 关闭读数**不能**是 ① 那张表。① 只证明"他们提交了"，而 G-65 讲的形状是**半笔提交**（链条目进来了、
被点名的脚本没进来）—— 这两件事在"文件干净"这个观测上长得一模一样。所以按 §8.154 写下的原判据复跑，
它打出 `悬空 0` 才算关。另外补了一条它自己没要求的对账，为的是别拿工作树副本冒充 main：
该工具读的清单 tree OID `2a09dbf438e3` **==** `git rev-parse fd8cd780^{tree}` ⇒ 它判的确实是当前 HEAD。
两枚实现此刻都在 main 树里（`scripts/check-shell-exit-chain.mjs`、`scripts/verify-macos-account-erasure.sh`），
链里那条在 `package.json:66`、`verify:` 那条在 `:95`。

#### ③ 载体对最新 main 重算：第一族第一次在"两侧都动链"的真实形状上被跑到

`edb9d8db = main(fd8cd780) × feat/self-host-distribution(ea3d4049)`，`feat/self-host-merge-main` 已指过去。

| 读数 | 值 |
|---|---|
| scripts 键并集 | 159 枚 |
| check 链段 | main=85 · 本批=67 · base=66 · **并集=86** · 摘段 0/0 |
| 非 scripts 顶层字段 | 比了 9 个，两侧改动全落进磁盘对象（丢 0） |
| 第八族自检 | control 0 条 + 五臂各 ≥1 条 + 收尾复绿 |
| 第九族自检 | 17 臂（拒绝类 7）红 0 · 四道守卫各做过摘除变异 |
| 落笔前门禁 | **9 道全 exit 0**（含 `check:script-snapshot`、`链里每条脚本目标都在树里`） |
| 冲突面预测（独立工具，不开载体） | `other=0 content=9 mdd=0 blind=0 unreadable=0 rc=0`，逐枚 9 条：pkg(2 块) / audit(1) / deployment(1) / live-domain(1) / coverage(2) / gen(1) / capture(1) / Dockerfile(2) / image-npm-tree(4) |

为什么这一趟值得单独记：**main 这次动的正是第一族**（`package.json` 那条 `check` 链），而第一族的解法是
"scripts 键并集 + 链并集 + 四条断言 + **写回后回读**"（`selfhost-merge-carrier.mjs:420-520`，丢链段走 `die(5)`）。
`并集=86 = main 的 85 + 本批的 1` 且**摘段 0/0** ⇒ 本批没吃掉 main 一夜新增的那些段，main 也没吃掉本批那一段。
这就是"落地会不会把别人的更正带回旧的"的**机制版判据**：它不需要人逐行读那张 diff，`die(5)` 自己会红。

#### ④ 落地此刻只剩环境，而且"窗口什么时候可能开"是能算的

10:14 现量：负载 1-min **14.28**（5-min 19.07）；哨兵 10:05 起 5 样里 5 样 `>12`（18.18 / 13.05 / 29.46 / 27.76 / 27.76）；
`4318/4319` 在 10:07–10:10 那一档被别人占着。main 在 09:54→10:10 那 16 分钟里走了 5 笔
（`16dc5e9e→3546ad39→73ad62a3→f9cf9803→cd6b4123→fd8cd780`）⇒ `连静=0/6` 一直在被重置。
落地要的是 `连静 15 分钟` **+ 完整链时长**（后者这一轮起由哨兵的 `LANDER 时长=` 自动留档，见 §8.170 ⑤）。
所以处置不变：等，实例 `pid 96927`（`CAP=28800 STEP=150 QUIET_MIN=15 LOAD_MAX=12 --run-on-open`）。
**第 1 项仍未闭合**，缺的是"开窗 → 载体上完整 `pnpm check` → main `--ff-only` 前进 → 剩余红逐条归属"这四步，
而不是"等他们提交"。开窗时还要先重取"载体锁同源"（任务 #43，它只在落地那一刻成立）。

#### ⑤ 一处我自己的探针错（记下来挡下一次误判"哨兵死了"）

判存活时我把 pid 文件的**整行**（`pid=96927 epoch=… step=150 cap=…`）喂给了 `ps -p` ⇒ 参数不是数字 ⇒ `ps` 输出空
⇒ 读起来像"实例没了"，而 `pgrep -f selfhost-window-sentinel` 给出的是**在位**。
📌 一般形状：**pid 文件是键值对载体，不是一个 pid**；"只吃数字"的参数拿到整行会**静默返回空**，
而空在这一族判据里恰好等于"死了" —— 与"判存活用 `ps` 清单不用裸 `kill -0`"同族，是它的新面目。

### 8.174 开窗前把"落地那一刻才现形的失败"挪到便宜的地方：四格 node-only 预检（2026-10-05 10:2x，不起栈、不跑测试）

#### ① 载体那棵树的链是完整的（本批自己新增的那一段不是又一次"半笔"）

```
cd /tmp/heyta-merge-carrier && node research/tools/selfhost-chain-targets.mjs
→ 裁判对象 = 工作树 /private/tmp/heyta-merge-carrier
  链步 86 · 取到脚本目标 83 枚 · checked 79 · no-target 7 · unresolved 0 · **悬空 0**
```

本批那一段 `check:image-build-args` 的实现确实在载体里（`research/tools/check-image-build-args.mjs` 18548 B）。
🔴 这条读数判的方向和 §8.173 ② 相反：那次判的是"**别人**的链条目指向别人的缺失脚本"，这次判的是
"**我的**链条目不能指向我这侧没提交的脚本" —— 同一个洞的两半，只量一半等于没量。

#### ② 链条目按 ref 逐段对账：main 一夜新增 19 段，上一趟 40 分钟全链**没跑到过它们**

`base(b850b1c6)=66 · main(fd8cd780)=85 · 本批(389771be)=67 · 并集=86`。main 新增的 19 段（逐字点名）：

```
check:shell-surfaces · check:op-log-semantics · check:selection-single-source · check:legal-tools ·
check:legal-permissions · check:legal-closure-truth · check:legal-gdpr · check:doc-citations ·
check:md-tables · check:brand-assets · check:public-facts · check:card-export ·
check:ios-native-bridges · check:vault-diagnostics · check:shell-exit-chain · check:verify-script-copy ·
check:android-gradle-remote · check:apk-freshness · check:shell-erasure-parity
```

本批新增 1 段：`check:image-build-args`。
**为什么要专门记这一格**：§8.169 记的"链段 main=84"到 §8.173 是 85，而"载体上完整 `pnpm check` 跑过一遍"
那次读数属于**旧的 66/84 段**。链条会变长，"上次全链绿"这张凭据的**射程会随 main 的新增段缩**——
把它当成"载体链已经验证过"就是拿旧地图走新路。

#### ③ 其中"可能被我的合并解法影响"的那几段，在载体上单跑全绿

| 段 | 载体单跑 | 一行读数 |
|---|---|---|
| `check:doc-citations` | rc=0 | `引用检查：路径存在性 + git-show-HEAD 锚 —— 无问题` |
| `check:shell-exit-chain`（main 今天 10:04 才加的） | rc=0 | `30 枚自快照 rig 的生效 EXIT handler 全部带 "$0…"` |
| `check:image-build-args`（本批那一段） | rc=0 | `镜像构建参数：3 段全部 FROM ${NODE_IMAGE} AS …（R5）` |
| `check:md-tables` | rc=0 | `9 个文件，列数、断行与"是不是表"都一致` |

加载体重算自带的 **9 道 GATES 全 exit 0** ⇒ 落笔前那一段是 13 道读数。
⚠️ `doc-citations` 这条要和 §8.171 一起读，否则像自相矛盾：那 6 条假阳性是我用 `--doc docs/runbooks/deployment.md`
**手点那篇**才现形的；链里那一步扫的是默认文档集，它**不含** `deployment.md` ⇒ 链绿并不推翻 §8.171 的结论，
两条讲的是射程不同。

#### ④ 载体锁同源（只为确认"开窗时不会因为它 `die(3)`"）

`根工作区 ✅同源 lock=0f3c1bf6d9e2(361300B) installed=0f3c1bf6d9e2(361300B) · e2e 套件 ✅同源 lock=021a9df4add8(993B)`。
🔴 这条**不替代**任务 #43：它只在落地那一刻成立（main 再动一次锁就作废），现在量它是把"开窗即 `die(3)`"这一种
浪费挪出来，不是提前取得那格凭据。

#### ⑤ 🔴 剩下 15 段我没在载体上单跑，这是**故意的**，预检证明到哪一步也写在这一步

它们要么要 `packages/*/dist`（链第一步就是 `pnpm build`），要么要 APK / 远端 Windows / 真机 / Playwright
（后者会去抢 `/tmp/tfa-test.lock` 那把内存闸门，并在我等的窗口上再加一层负载）。本批的落点**不在**那些面上 ⇒
若红，同一把尺在干净 main 上也红，归属层按"逐字 / 形状+条数"两条对法判（`selfhost-red-attribution.mjs` 文件头那三条放行条件）。
所以这四格证明的是"**到这一步为止**没有本批造成的红"，它**不等于**"开窗那趟全链会绿" —— 后者只能由那 40 分钟本身给。

### 8.175 "等他们提交"不是一条单调的等待：`package.json` 归零 20 分钟后又脏了（2026-10-05 10:3x）

#### ① 现量：阻塞集 0 → 1 的那一次翻转，恰好翻在负载第一次达标的那一格

| 时刻 | 阻塞集 | 负载 1-min | 哨兵自己打的 `不成立=` |
|---|---|---|---|
| 10:05 – 10:25（连续 **9 样**） | **0** | 13 – 29 | `负载=…>12` |
| 10:27:55 | **1** | **11.94** | `阻塞集=1`（当天第一格负载达标的样，只栽在阻塞集上） |
| 10:30:25 / 10:32:56 / 10:35:58 | 1 | 15.7 / 7.51 / 42.93 | `阻塞集=1；负载=…` |

把 09:55 起的所有样按两格交叉数一遍：`阻塞集=0` 的 **9** 样、`负载≤12` 的 **6** 样、**两格同时成立的 2 样**，
而 `连静=` 今天到过的最大值是 **1/6**（落地要 6 样连续 + 之后整条链期间 main 都不动）。

🔴 **这条改变的是"接下来怎么等"的形状**：Goal 第 1 项写的是"等那 5 枚重叠文件被其所有者提交"，
读起来像一个**一次性条件**；现量是** contested 文件会反复变脏**（同一枚 `package.json`，10:04 提交、10:27 又脏）。
所以"提交完了"不是落地的前置状态，而是一个**必须与负载窗口、端口、main 连续静默同时命中的瞬时事件**。
两格独立算的话 9/45 与 6/45 的交集只剩 2 样 ⇒ 任何"我先干别的、等它提交完了再回来跑"的排法都会扑空
（这条与记忆里"拿到窗口立刻起全跑，不要先干别的再回来"是同一条，只是今天给它补了**为什么**）。

#### ② 这一次变脏**不是** G-65 重演 —— 但我是**先写错了一遍**才知道的

两种裁判形态各量一次（第一次我把**同一个形态**跑了两次，还以为是一个管已提交、一个管未提交）：

| 形态 | 链条目来源 | 树 | 读数 |
|---|---|---|---|
| `--ref main` | 已提交的 `fe3e9e7d` | 同一笔的 tree | 链步 **85** · 目标 82 · no-target 7 · unresolved 0 · **悬空 0** |
| `--pkg 工作树副本 --tree main` | **还没提交**那版 | `fe3e9e7d` 的 tree | 链步 **86** · 目标 82 · no-target 8 · unresolved 0 · **悬空 0** |

⇒ 这次脏编辑**确实**往链里加了**一段**（`check:ios-ax-shim`，no-target 7→8 就是它进来的形状），
而它点名的实现**已经在树里** ⇒ 与 G-65 那一族（条目进来、脚本没进来）**不同型**，落地不会被它 `die(3)`。
🔴 我自己那一版的错处值得留形：**"跑了两次"不等于"两个方向都量了"** —— 那把尺的三种形态（磁盘 / `--ref` / 跨树）
里，只有 `--ref` 读的是已提交那一侧；`--pkg <工作树文件>` 连读两次得到的是同一个问题的同一个答案。
判"别人是不是又来了半笔"必须**跨树形态与 `--ref` 各一次**，差集才是那半笔的形状。

#### ③ 一次**代拍**的运维旋钮改动：把看守的寿命拉到覆盖夜间，阈值三格一字没动

旧实例 `pid 96927` 的 `CAP=28800` 会在 **17:5x** 到期退出，而 ① 那 2 样"两格同时成立"的分布说明
白天几乎不会有 6 连静 ⇒ 到点之后**没有任何东西在等**。所以按那条纪律换实例：
**先停旧（`kill` 从 pid 文件里 `sed` 出来的那个数，不是整行）→ 数进程必须是 0 → 再起新 → 用 `pgrep` 清单 + pid 文件双证**。

| 旋钮 | 旧实例 | 新实例 |
|---|---|---|
| `STEP` / `QUIET_MIN` / `LOAD_MAX` / `--run-on-open` | 150 / 15 / 12 / 开 | **逐字不变** |
| `MAX_ATTEMPTS` | 3 | 3 —— 🔴 **这格我上一版写错了**：写成"写死在脚本里，没动"，实际它是 `process.env.MAX_ATTEMPTS || 3`（`:53`），和 `CAP` 一样是 env 旋钮。**没有据此改值**，但错的不是我第一次读它的那次，是第二次抄它的那次 |
| `CAP` | 28800（到 17:5x） | **86400**（到 10-06 10:3x） |

⚠️ 这是**代拍**，不是决议：依据是 ① 那张交叉表 + "到期后没人看守"这一格；
回退一条命令 —— 停掉 `pid 88716`、按上一行原旋钮（`CAP=28800`）再起一枚，阈值那一档不跟着改。
🔴 延长 `CAP` 不属于"调低阈值"：窗口五格条件与 `LOAD_MAX=12` 一字未动，改的只是**这枚装置愿意等多久**。

#### ④ 既然 `MAX_ATTEMPTS` 是可改的，就顺手把"为什么**不**改它"写下来

`decideAfterLand`（`:142-157`）的真相是：**尝试用满 ⇒ `retry=false` ⇒ 哨兵带着 LAND 的原退出码结束进程**
（`B3`/`B8` 两臂就钉着这件事）。也就是说 3 次烧完之后，`CAP` 拉到多大都没用了 —— 没有东西在等。
按"反正要有人等"的直觉应该把 `MAX_ATTEMPTS` 一起调大；这里**不调**，两条理由：

1. 一枚尝试不是重试一次的开销那么轻 —— 它是**一整趟完整链**（86 段，含 `pnpm build` 与 `pnpm -r test`），
   调大尝试次数等于授权自己在安静时段连续烧几小时的机器，而那正是别人（以及本批第 2、8 项）要用的窗口。
2. "三次开窗都没落成"本身是**结构性信号**（要么解法族不够、要么归属层判不动），它该停下来被人看，
   不该被"再多试两次"糊过去 —— 与"不能失败的检查比没有更糟"是同一族立场。

替代装置是**只读**的那枚看守（本轮起的 `b1zvesyvm`，2600s 上限）：它同时判
"main 已含载体"（落地成功）与"`selfhost-window-sentinel` 进程没了"（尝试用满或异常退出），
后者一旦出现就通知我，由我决定是补一发还是停下来查结构 —— **把"要不要再试"这一格留给人，把"别没人等"那一格交给机器**。

### 8.176 G-61 的②③不再是"待拍板"：②判**不做**、③排到落地之后（2026-10-05 10:3x，我自己的裁决，标明是代拍）

§8.134 把 G-61 登记成"三选一待拍板"，①档在 §8.160 已落成会红的 R9。剩下两档一直挂着"要人拍板"，
而这两档判的是**内部判据挂在哪条链上**——不是对外法律表征，也不是发布动作，属于已经交给我拍的这一类。
所以这里给出裁决与理由，并写清**什么证据会把它推翻**。

| 档 | 裁决 | 理由（各一条承重的） | 推翻条件 |
|---|---|---|---|
| ② 把 `pnpm verify:selfhost-stack` 挂进发布前那道链 | **不做** | 它要 Docker daemon、要起真栈、要真浏览器 —— 挂进链等于把"需要一台安静机器的验收"变成**每次 `pnpm check` 的前置**，也就直接把落地的冻结时长从"跑链"推到"跑链 + 跑栈"。§8.175 ① 那笔算术（连静今天最大只到 1/6）说明这一步加上去买到的不是绿，是**永远开不了的窗口** | 若 `verify:selfhost-stack` 的静态腿（③）拆干净后、真栈腿单独有个"发布前"的**非链**闸门（例如 CI 里那条），②的动机就消失了；那时该做的不是挂链，是把那台机器的存在变成发布条件 |
| ③ 把"静态腿"拆进链 | **排在落地之后**，与 G-62 同批 | 理由不是"冲突面"（`package.json` 是预置第一族，并集+回读那三条断言已经守住了），是**链每多一段，main 必须连续静默的时间就多一段** —— 而 ① 的现量正好说明这件事现在最贵。它也不是免费的：哪些断言算"静态"要重定义（`image-npm-tree` 那条要读已安装的树、`FROM ${NODE_IMAGE}` 那条只要文件），先把边界写下来再动链 | 落地后进 main 的那趟由这条线自己做；若落地后链时长明显小于载体上那 9 道 GATES 的时长，③的代价论证要重做 |

🔴 这一节的**关闭形状**要说准：关的是"两档一直悬在待拍板、没人给理由"这件事，
**不是**"②③的内容做了"。任务 #37 因此改成"已裁决：②不做 / ③落地后做"，两档各自的执行仍挂在原编号上。

### 8.177 登记表那一格的状态是对的，缺的是"把人带回现场"的指针 —— 规则 A 报的就是这一类（2026-10-05 10:4x）

`selfhost-registry-drift-sweep.mjs` 在分支上跑出一份 `G-40⑥`，两格都点它的名：

| 报的形状 | 判 | 处置 |
|---|---|---|
| 打脸候选：行写"**未关**，有意的不写"，正文 §8.159 说"已关" | **不是缺陷** —— §8.159 那句讲的是**这条候选自己**（"读一眼就知道是两处都说过"），而 `G-40⑥` 的结论至今是"有意不写"，§8.160 ⑥ 的否定句普查又逐条判它**仍然成立** | 状态一个字没改 |
| 规则 A：整行**没有任何 `§8.x` 现场** | **是真缺陷**，且与状态对错**无关** —— 状态写对了但没有任何东西把人带回去复核，它照样会烂（`G-42` 烂了两天的成因就是这个形状） | 只在行尾补两个轮号：最近一次逐条判它成立的 §8.160 ⑥、以及漂移裁决 §8.159 ① |

复跑对账（同一把尺，改前 / 改后）：

| | 打脸候选 | 无现场行 |
|---|---|---|
| 改前 | 2（`G-40⑥` 是 ⚠️、`G-47` 是 ℹ️） | **1**（`G-40⑥`） |
| 改后 | 2（两条同形：都是"行里已指向那一节 ⇒ 引用旧措辞造成的命中"） | **0** |

⇒ 补指针把 ⚠️ 降成了 ℹ️，而候选总数不动 —— 这正是它**只能当评审辅助、不能当门禁**的原因：
剩下的 2 条都是关键词把"引用旧措辞"读成"断言"，纯关键词管不住这一类（文件头那条实测假阳性是第一次，
§8.159 是第二次，今天是第三次，同一台装置、同一个原因）。
📌 一般形状：**"这行有没有出处"和"这行的状态对不对"是两个正交的缺陷**；
只修后者会留下一堆"句句真话、但没人会被带回去再看一眼"的行，而那种行就是几天后自己烂掉的那一种。

### 8.178 第 2 项起跑前的三格环境预检（2026-10-05 10:4x，负载 98.8 的时候做的，零成本）

开窗前先把"跑到最后一步才发现环境不允许"的那几格量掉。这一趟**没有起跑**（负载 10:41 现量 **98.83**），
但三格前置有了确定答案：

| 格 | 现量 | 判 |
|---|---|---|
| Docker daemon | `docker version` 打出 **29.4.0** | 可用。⚠️ 顺带一处**探针错**：我先用 `pgrep -x OrbStack` 判"守护进程在不在"，输出是"不在"—— 名称假设错了，**能用的那格答案是 `docker version` 给的**，不是进程清单 |
| `e2e` 那份额外 lockfile 的依赖 | 分支树与载体树**两侧都在**（`e2e/node_modules/@playwright/test`） | 第 2 项那三条浏览器腿不会因为"e2e 不在根工作区、依赖没装"而红（AGENTS §6 那条注释讲的正是这个坑） |
| 🔴 会不会 SIGKILL 别人的 dev server | `verify-selfhost-stack.sh` 全文**没有** `kill/pkill/lsof`，只有 `PORT=1900` 那套专用 compose project，且它撞到别人的栈是**响亮拒绝**（`:172`"要么先停掉那一套，要么换 `HEYTA_SELFHOST_PORT`"）；`playwright.selfhost.config.ts` 里没有 globalSetup 杀端口 | **可以跑**。此刻 `:3000` 被别人占着**不是** blockers —— 那三条腿打的是 `http://127.0.0.1:1900/app/`，与 `:3000` 无关 |

⇒ 第 2 项落地后起跑的**唯一**前置回到那一格老的：**负载 ≤12 且 `/tmp/tfa-test.lock` 空**（后者是这台机器的
全局内存闸门，`verify` 脚本自己在起跑前查它；昨天那一趟就是被它挡下的）。
⚠️ 这一条仍然**不**授权我绕开它 —— `TFA_ALLOW_CONCURRENT_TEST=1` 是那枚闸门的逃生门，
台账里逐次记的都是"**不用**"（现量：`grep -n 'TFA_ALLOW_CONCURRENT_TEST' docs/research/self-host-distribution-audit.md`
—— 本节故意**不**在这里写行号，那正是 G-66 讲的会漂的形状，而我上一版差一点就写了），
理由各处都是同一句："它拦的是 OOM，不是礼貌；别人正在跑时绕过去拿到的读数也不该被当成环境有效"。

### 8.179 第 1 项那句"main 自己红在 `check:docs` 5 处"是**瞬时读数**，不是验收标准（2026-10-05 10:4x）

任务书原文里写着"main 自己**现在**红在 `check:docs` 5 处（引用方/报错行只在 main 版本、4 个死链目标在主检出是 `??` 未跟踪），
必须逐条仍可归属到非本批才算"。这一趟把前半句单独量了一遍：

| 时刻 | `check:docs` 的红集 | 出处 |
|---|---|---|
| 10-04 夜间 | **5 处** | 任务书所依据的那次读数 |
| 10-05 01:3x | 5 → **3** 条可归属 | §8.169（同一轮还记下"引用旧措辞"自己也是一次命中） |
| 10-05 10:4x，载体 `89850262` | **0**：`✅ 无死链、无"本机有仓库里没有"的链接、无失效章节引用、无失效锚点`（`rc=0`） | 本轮 |

🔴 三件事要分开说，混一件就会写错结论：

1. **验收标准没变**："每一个红都要能逐条归属到非本批"。红集变空**不等于**这一格免做 —— 它变成"空集，
   且空集是可复核的"（判据本体打印了它查的四类，全 0）。
2. **载体绿 ≠ 落地那趟绿**。这枚载体第一父只到 `fe3e9e7d`；之后 main 又走 2 笔
   （`79ebb485`、`1cd5ac6f`，都是「交接账」文档：一处给 `§4.1 G2` 补了"第二枚别人的红"、
   一处把一条撤掉的读数重写进同一枚文档）—— 而**改文档正文正是会动死链/锚点/章节引用的形状**。
   所以这个 0 是**这一格此刻**的读数，落地那趟仍要重新判；不能拿它提前主张"归属不用做"。
3. **条数只能现量，不能从任何一份抄件抄**——包括从任务书抄、从台账旧轮抄。
   📌 一般形状：**外部交给我的判据文本里会夹带它当时看到的瞬时读数**（这里是"5 处"）。
   执行时要把那句读成"当时有 5 处，标准是逐条归属"，而不是"现在应该还能数出 5 处"——
   否则会出现两种错：数不满 5 就以为自己漏了，或者拿别人的红去凑自己的数。

### 8.180 装置与任务书之间有一处**方向相反的**不匹配，今天读代码才看见（2026-10-05 10:4x）

任务书第 1 项写的是：关闭判据**不是**"check 全量绿"——main 自己的红只要逐条可归属到非本批就算过。
而 `selfhost-land-main.mjs` 实际做的是（`:515-527`，本轮逐字读过）：

```js
if (r.code !== 0) refuse(`rc=${r.code} ⇒ **不落地** …`, 4);
checkOk = true;
```

`--attribute` 全仓只出现在两处：文件头用法行（`:14`）与那句报错里的提示（`:527`）
⇒ **它只跑诊断，不存在"红但全部可归属 ⇒ 照样落"的那条路径**。装置比任务书**严**。

这不是 bug，但它有两个真实后果，都要写下来，因为下一个会话会撞上：

1. 🔴 **一次"红但不是我们的"会把无人值守那次直接打死**：`rc=4` 那一支按 `B4` 臂**不重试**
   （设计意图就是"那是要人逐段归属的"）⇒ 哨兵不会再用掉第二枚窗口，而是结束进程。
   本轮为此装的只读看守正好接住这一格（它判"哨兵进程没了"和"main 已含载体"两件事）。
2. 任务书那句"逐条可归属"**由人兑现**，不由装置兑现。这一条如果反过来做（给 lander 加
   `--land-on-attributable`），影响面不是本批：那是把**共享 trunk `main` 推到一棵 `pnpm check` 红的树**上，
   而此刻有并行会话正在它上面工作（main 今天 10:4x 那两笔「交接账」就是它写的，见 §8.179 ②）。**本批不这样做，也不在无人值守时这样做。**

📌 一般形状（与 §8.179 成对）：**任务书里的验收标准与装置的放行条件是两个东西**，
两者不一致时要么改装置要么改流程，但**必须先发现不一致**——今天是在读 `r.code !== 0` 那一行时发现的，
不是在被它打死的时候发现的。发现的时机差 40 分钟和一整枚窗口。

### 8.181 今天到底有几个"够落地那么长"的间隔：120 个间隔里只有 **1 个**够（2026-10-05 10:5x，git-only 零负载）

把 main 今天 00:00 之后的逐笔提交时间戳拿来做差（`git log main --since=… --format='%ct'`）：

| 量 | 值 |
|---|---|
| 间隔数 | **120** |
| 均值 | **5.4 min** |
| ≥ 15 min（连静那一档要的最短长度） | **3 个**：15.1 / 17.2 / 309.9 |
| ≥ 55 min（连静 15 + 一条完整链 ~40） | **1 个**：309.9 min |

⇒ 落地需要的不是"一个安静的时刻"，是**一段 55 分钟以上没人碰 main 的区间**，而今天这种区间**只出现过一次**。
这不是"再等等看"的理由，是排期的依据：白天那条线在连续写「交接账」（10:4x 那三笔 `ea913891`/`1cd5ac6f`/`79ebb485` 就是它），
下一段这种区间大概率在它收尾之后。看守 `pid 88716` 的寿命已经拉到 10-06 10:3x，**覆盖得到夜里那一段**。
⚠️ 顺带一条同族的可读性提醒：并行那条线在 10:4x–10:5x 连着写了 `79ebb485`/`1cd5ac6f`/`ea913891`
三笔「交接账」，其中最后一笔的标题是「**(39) 窗口开过一次，看守按设计停**」——
那是**它自己的**看守与**它自己的**窗口定义，不要读成"本批的窗口开过了"。两份账落在同一枚 main 上，长得很像。

#### ② 判存活这件事今天第三次踩同一族（三种面目，全是我的探针）

| 错法 | 症状 | 对法 |
|---|---|---|
| `ps -p "$(cat pid文件)"` | pid 文件是 `pid=… epoch=… step=…` 整行 ⇒ `ps` 拿到非数字 ⇒ **输出空**，读起来等于"实例死了" | 先 `sed -n 's/^pid=\([0-9]*\).*/\1/p'` 取数（本轮换实例时就是这么取的） |
| `pgrep -c` | macOS 的 `pgrep` **没有 `-c`** ⇒ 打出 usage 并被当成计数 | `… \| wc -l` |
| `pgrep -f selfhost-window-sentinel` | 数出 **3** —— 实际是 1 枚哨兵 + **我自己那两枚只读看守**（它们的命令行里写着同一枚 log 的路径） | 按**脚本文件**计数：`ps -Ao pid,args \| grep "[s]elfhost-window-sentinel.mjs"` ⇒ 精确 1 枚（这格必须准，两枚同时在等就会各自动一次手） |

#### ③ 第 8 项（`reinstall:all`）的可达性预检，以及一处**必须现在就知道**的闸门

| 端 | 现量 | 判 |
|---|---|---|
| Windows 打包机 | `ssh -o BatchMode=yes windows-pc` 打出 `WINDOWS_OK` | 可达（那条 `openssh.com/pq` 是 server key 算法提示，不是失败） |
| macOS | `/Applications/Heyta.app` 在 | 会被"清掉重装"，这是 §6.1.1 的设计 |
| iOS | 此刻 **Booted 三台**：`heyta-batch2-closeout` / `heyta-bc-reminders` / `heyta-e2-ios-erasure` | 🔴 **都不许动**（别人三条验收线在跑）。`reinstall-all.sh:342-365` 有现成闸门：默认 `IOS_DEVICE_NAME=iPhone 17 Pro`，没有一台含这个名字且 Booted>1 ⇒ **响亮拒绝**并列出候选，不猜、不 `head -1` |
| Android | 本批新规：一律走 `windows-pc`（AGENTS §6.1） | — |

⇒ 落地后跑第 8 项的 iOS 端，**先 boot 一枚本批自己的设备**（名字里带 `iPhone 17 Pro` 或直接 `IOS_DEVICE_NAME` 钉住它），
而不是复用或卸载别人那三台。而现在（1-min 负载 28.0、5-min 102.9）不起第四台模拟器 —— 64G 会被模拟器吃掉。

#### ④ 载体里那枚 `apps/web/dist` 是 10-04 21:01 的旧物 —— 这不是缺陷，但它是那条边界的具体例子

链第一步就是 `pnpm build`，所以落地那趟不会拿旧 dist 去判任何东西；
而 §8.173 边界①（靠 `packages/*/dist` 的门禁不要加进**落笔前**那一段）说的就是这种形状 ——
落笔前那一步跑在 `pnpm build` **之前**，把 dist 依赖型门禁加进去 = 在一棵正常树上是恒红。

### 8.182 排除一个会烧窗口的候选：`screenshot:verify` 在载体上绿，而它**判的不是**"截图是不是当前产物"（2026-10-05 10:5x）

链条目里有 `pnpm screenshot:verify`（在链尾，`pnpm -r test` 之前）。它会不会因为 §8 里那批**旧 PNG**
（G-58 / 任务 #30：`screenshots/landing/*.png` 仍印着已摘掉的安装承诺与旧域名）在落地那一刻红、
把 `rc=4` 那一支（按 `B4` 不重试）直接打死？现量：

```
cd /tmp/heyta-merge-carrier && node scripts/screenshots/verify-artifacts.mjs
→ rc=0 ✅ 截图校验通过（注册表共 23 个目标；已生成的均尺寸正确、无 alpha、非空白）
```

它**不需要 Playwright、不需要重新捕获**（纯 fs + `png-stats`），所以这一格不可能是落地那趟的红。
🔴 但这条绿**不是**"截图是当前产物"的凭据 —— 它的四条判据是
**数量对得上 / 尺寸精确 / 无 alpha / 非空白**（文件头明写第 4 条才是它存在的理由：白屏、404、渲染未完成
截出来都是尺寸正常的纯白图，只有看像素才发现）。**它不比对重新捕获的像素**，
所以一张印着旧域名与已摘掉承诺的截图，在它眼里完全合格。

⇒ 两条结论要分开留：
1. **落地风险面**：`screenshot:verify` 不是候选（本轮排除）。
2. **对外错话面**：#30 / #31 仍然开着，而且它们**永远不会被这道门禁照出来** ——
   要闭合只能靠 `screenshot:capture` 重拍 + **人看那张图**（AGENTS §6.2 规定一）。
📌 一般形状：**"这道门禁绿"必须连同"它判的是哪几件事"一起读**。
`screenshot:verify` 绿 + 旧截图 = 两句都真话，而"链绿 ⇒ 截图没问题"是一次跨问题推理 ——
它与 §8.180 那条（任务书标准 vs 装置放行条件是两件事）是同一族的不同面。

### 8.183 那把"链步目标必须在树里"的尺子少一个扩展名，G-65 那一族就从缝里走进来、而它报的是"不在射程"（登记 **G-67**，2026-10-05 11:0x）

`research/tools/selfhost-chain-targets.mjs` 是落笔前预检之一，也是 **G-65 的关闭判据本体**：
链里每条点名的脚本必须在那棵树里，判据写作"开窗前复跑它，打印 `悬空 0`"。
它从命令体里取"看起来是仓库内脚本"的 token 的规则是一行扩展名白名单：

```
const SCRIPT_EXT = /\.(?:mjs|cjs|js|ts|sh)$/;   // 修前
```

🔴 主检出现存那份**未提交**的 `package.json` 刚往链里加了一步
`check:ios-ax-shim` → `python3 scripts/tools/ios-ax-shim.test.py`，而那枚 `.py` 在主检出里是 `??` 未跟踪
（main 树里只有 `scripts/tools/ios-ax-shim.py`）。这正是 G-65 那一族的字面形状 ——
"只提交 `package.json` 就会在落地那一刻以 `Cannot find module` 收尾" ——
只是换了个解释器，而尺子的白名单里没有 `.py`。

现量（同一把尺子，修前/修后各一趟，零负载）：

| 形态 | 修前 | 修后 |
|---|---|---|
| `--ref main`（已提交的 main） | 链步 85 · 目标 82 · `悬空 0` rc=0 | 同一读数 rc=0 |
| `--pkg ../heyta/package.json --tree main`（G-65 字面判据） | 链步 86 · 目标 82 · no-target **8** · `悬空 0` **rc=0** | 链步 86 · 目标 **83** · no-target **7** · `悬空 1` **rc=1**，点名 `不在树里：scripts/tools/ios-ax-shim.test.py` |

⇒ **这条最要紧的**：那条判据在一个真悬空存在时照样打印 `悬空 0`。它**确实点名了**那一步
（`不在射程（点名，不静默）：… pnpm check:ios-ax-shim`），但 `no-target` 这一档的含义是
"这一条我没判" —— 打印 ≠ 判过。一把"读命令体取路径"的尺子，它的分档名会自己把"没判"
伪装成"判过且没问题"，而任务书里那句"打印 `悬空 0` 即关闭"完全消费不到这一格。

#### ① 修法只加 `.py`，不是"顺手把集合放宽"

放宽白名单会造假红（链里 `--file=…`、`foo.png` 那类 token 一旦被当目标，正常树上就恒红 ——
那等于没有判据）。所以先扫真实链再决定，判据 = 现量而不是想象：

```
主检出脏 package.json 的链 → 未被旧白名单覆盖的目标扩展名：只有 .py（1 条，就是上面那条）
/tmp/heyta-merge-carrier 的已提交 package.json 的链 → 0 条
```

`.mts` / `.swift` / `.ps1` 仍然在集合外，按 ① 那条敞口**点名登记、不当通过**。

#### ② 牙：两臂 + 一次真变异

`--selftest` 现在 13 臂（臂数由它自己打印，文档不抄）。新增的 K1/K2 各钉一档：
K1 `python3` 那步取到目标**且在位** ⇒ `1 checked / 0 悬空 / 0 no-target`（挡"掉回 no-target 蒙过去"）；
K2 同一形态但实现不在树里 ⇒ **恰好 1 条 dangling**（这才是加 `.py` 的全部理由）。

变异在**一次性副本**上做（不改真文件来回试）：`sed` 把副本里的 `py` 摘掉 ⇒
K1 实量 `0|0|1`、K2 实量 `0|1`（两条都退回 no-target），副本自身退出 **rc=1**、真文件 **rc=0**。
两条臂各自精确对应一个失效形状，摘掉一处 = 两臂同红。

#### ③ 归属：G-67 不是本批的，而且这条红**不挡落地**（别读成"落不了地"）

`check:ios-ax-shim` 那一步和那枚未跟踪的 `.py` 都在**主检出**里，属 iOS AX shim 那条线。
本批不动主检出、不代改他们的 `package.json`。登记 **G-67**：

- 内容：链里新增了一步，其实现此刻未跟踪 ⇒ 他们若只提交 `package.json`，main 会红在 `check:ios-ax-shim`；
- 关闭判据（他们侧）：把那枚 `.py` 与 `package.json` **同一笔**提交（或撤掉那一步）；
- 复验（开窗前，我这侧一条命令）：`node research/tools/selfhost-chain-targets.mjs --pkg ../heyta/package.json --tree main` 打印 `悬空 0`。

🔴 **两档读数不要混**：载体合的是 main 的**已提交**树，所以落地判据是 `--ref main` 那一趟（现在 rc=0）；
`--pkg ../heyta/package.json` 那一趟是**提前替下一位照出他们那笔提交的风险**。
把后者当成落地阻塞去"调低阈值"或"先摘掉那一步"，就是 §8.118 那条族的复发。

📌 可迁移的形状：**任何"读命令体 / 读正文再分类"的尺子，它的每一档名都要问一句
"这一档里有没有我其实没判的东西"**，并且**新增一档形态之前先扫真实数据**。
G-65 的关闭判据被自己那档 `no-target` 喂了一次假绿 —— 而它看起来完全不像假绿，
因为它把名字打印出来了。

### 8.184 落笔前门禁从 9 道加到 17 道；"纯"是**造一棵载体形状但没有 store 没有 dist 的树**量出来的（2026-10-05 11:1x）

§8.181 那条边界（靠 `packages/*/dist` 的门禁不要加进落笔前那段）此前是**读出来的**。
这一轮把它改成**跑出来的**，并且顺手把八枚成对一致性门禁挂了进去。量法是关键，
因为它推翻了"在 `/tmp/heyta-merge-carrier` 里绿过"这种看起来最像证据的东西：

```
git worktree add --detach /tmp/heyta-puregate2 89850262   # 两侧都合好了 + 没有 node_modules + 没有任何 dist
（跑完 git worktree remove --force；不碰共用那棵热载体）
```

为什么不能拿热载体当纯度凭据：那棵树**有人为别的会话装过 store、还留着 10-04 21:01 的旧 dist**。
这正是 `selfhost-merge-carrier.mjs` 文件头为第 2 腿记过的那条（§8.161："在这棵树上绿过
≠ 不依赖这棵树的环境"）—— 这次是第二次命中，而且**更坏的一面现形了**（见下面 B 组两枚红）。

#### A 组：入选的八枚（两棵树都有这些文件，配对成立）

| 门禁 | 纯树（无 store / 无 dist） | 热载体 |
|---|---|---|
| `check:ui-language`（词条 zh↔en） | rc=0（词条表 zh-CN 3103 / en 3103） | rc=0 |
| `check:legal-tools`（工具目录↔法务中英表，逐行同序） | rc=0（26 条） | rc=0 |
| `check:legal-permissions`（权限承诺↔manifest） | rc=0（Android 3 条） | rc=0 |
| `check:legal-host`（对外域名三方） | rc=0 | rc=0 |
| `check:pricing` | rc=0 | rc=0 |
| `check:ai-quota` | rc=0 | rc=0 |
| `check:claims` | rc=0 | rc=0 |
| `check:docs-voice` | rc=0（site.* 1018 条 / 豁免自托管 120） | rc=0 |

🔴 两枚 `check:legal-tools` / `check:legal-permissions` **本分支没有那两枚文件**（`git cat-file -e` 现量：
main=yes / br=NO）—— 载体与配对树（干净 main 那一棵）都有 ⇒ 配对没问题，但**第一次在纯树里跑它们时
它们报的是 `Cannot find module`**，那不是我判的"红"，是**我这棵树里根本没有这道门禁**。
先按"文件不在"归零再看 rc，否则会把一次探针寿命问题读成一次门禁缺陷。

为什么这八枚值得挂进落笔前：它们判的全是**成对一致性**（真源 ↔ 生成物 / 中 ↔ 英 / 声称 ↔ 实现），
而十一族并集只按**冲突路径逐行**保序 —— "一侧改真源、另一侧改生成物"这种破法 union 看不见，
只有这些裁判看得见。本批恰好动了 `packages/i18n` 两张词条表与法务文案。

#### B 组：反面教材（同一棵纯树上全红，热载体上六绿二红）

`check:legal-gdpr` / `check:legal-closure-truth` / `check:public-facts` / `check:card-export` /
`check:doc-citations` / `check:shell-surfaces` / `check:verify-script-copy` / `check:brand-assets`
—— 纯树上 rc 分别 1/1/1/1/1/1/**2**/1（`verify-script-copy` 那枚 rc=2 且直接点名
`词条产物目录不存在：packages/i18n/dist`，是这一族里唯一"响亮拒绝"的形态）。
热载体上**六绿**。剩两枚两边都红，而它们的成因值得单独留：

| 门禁 | 红因（现量） | 是不是落地阻塞 |
|---|---|---|
| `check:shell-surfaces` | 它自己的第 27 条式判据命中：`[web] countdown · W5 产物比源码旧（dist 2026-10-04T13:01:19 < src 2026-10-04T20:19:43）`，另有两栏"包里的 web-dist 与本工作树 sha256 不同 ⇒ 那是别的检出／别的会话打的包，不计为通过" | 不是 —— 链第一步就是 `pnpm build` |
| `check:brand-assets` | `TypeError: brandMarkSvg is not a function`（`gen-app-icons.mjs:331`）。那枚导出在 `packages/design-system/src/brand-mark.ts:141`，而旧 `dist/index.js` 里出现 **0** 次（mtime 10-04 21:01）| 同上 |

🔴 **这就是比"恒红"更坏的那一面**：dist 依赖型门禁在一棵**有旧 dist** 的树上不是安静地红，
而是**红得像个真缺陷** —— 症状写着"品牌产物接线对账失败"，谁读了都会去找那个不存在的缺陷。
§8.181 那条边界原来的理由（"在正常树上恒红"）比实测轻了一档。

#### 归属预读数（给 #26 省一次现场推理，不代替落地那一刻的复跑）

`check:shell-surfaces` 与 `check:brand-assets` 那两枚红**不在落地阻塞集里**，两条独立理由：
① 成因都是"这棵树没跑 build"，而 `pnpm check` 的第一项就是 `pnpm build`；
② 这四枚文件（两枚门禁 + 两枚生成器）本分支**一个都没有**（`git cat-file -e HEAD:…` 全部 NO）⇒
它们进载体只可能来自 main 那一侧。⚠️ 但 ② **不是**"与本批无关"的证明 —— `shell-surfaces` 判的正是
`apps/web` 那一面，而本批改过 `apps/web`。所以落地那一刻仍要按原办法逐条配对复跑，
这一节只保证**没人会把它当成新出现的谜**。

#### 落笔

`selfhost-merge-carrier.mjs`：`GATES` 9 → 17 道（条数由它自己 `GATES.length` 打进读数，文档不抄）。
文件头那段"落笔前的门禁"清单**先前已经漏记了两批**（`链里每条脚本目标都在树里` 那条也没在清单里），
本次一并补齐 —— 这正是 §8.177/§8.180 那族"行与正文两个方向都会漂"的第三次命中，
只不过这次漂的是**注释 vs 数组**。`node --check` 通过；八枚在热载体与纯树两侧都 exit 0。

### 8.185 排演真跑了一趟：载体重算 + 17 道落笔前门禁 **17/17 exit 0**，而"借 store 的起跑资格"是这样成立起来的（2026-10-05 11:2x）

新八枚挂进 `GATES` 之后，它们在真载体上**一次都没跑过**（§8.184 量的是一棵我造的对照树）。
所以趁载体空闲（`selfhost-carrier-busy.mjs` 现量：空闲，ps 1956 行 / cwd 1738 行 / 豁免自己链）
跑了一趟**纯排演**：只重算载体，不动 `main`、不 push。现量：

```
HEYTA_CARRIER_LINK_STORE_FROM=<主检出> node research/tools/selfhost-merge-carrier.mjs
→ ✅ 载体 4527e46b = main(e7b7990f) × feat/self-host-distribution(f7169b5e)
  · 并集 scripts 键 159 · check 链段 main=85 本批=67 base=66 并集=86（摘段 0/0）
    非 scripts 顶层字段比了 9 个，丢 0
  · 合并归属：写 74 枚 / 合并相对 main 改 74 枚 / 集外 0 / 写集里未被改到 0 枚
  · 第八族（截图重放）control 0 + 五臂各 ≥1 + 收尾复绿；第九族（Dockerfile）17 条臂红 0
  · 门禁 17 道：17 道 exit 0        ← §8.184 那八枚第一次在真载体上跑，逐条有读数
  · 红集归属判据自检 21 条臂红 0（含五条按理由认领的拒绝臂）
```

#### 借 store 这条路不是"配好的"，它的前提今天才量清

`check:image-license` 第 2 腿要**已安装**的 pnpm 树（§8.161），而配对树每次由 `worktree add` 新建、
永远没有 `node_modules` ⇒ 没有 `HEYTA_CARRIER_LINK_STORE_FROM` 这一档，归属层那一趟从来没真跑过。
它的硬前提是**同一把锁**。今天现量：

| 对象 | 根 `pnpm-lock.yaml` sha256 前 12 |
|---|---|
| merge-base `b850b1c6` | `111cc2d1d04d` |
| 本分支 `f7169b5e` | `111cc2d1d04d`（**没动过锁**：`git diff --numstat` 对 base 为空）|
| main `e7b7990f` | `0f3c1bf6d9e2`（相对 base `+18 / −73`）|
| 主检出磁盘（借的来源）| `0f3c1bf6d9e2` = main 提交那把 ✅；`e2e/` 那把两侧也逐字相同 ✅ |

⇒ 推理链是闭合的：**只有一侧动过锁 ⇒ 合并 trivially 取 main 那把 ⇒ 载体与配对树的锁都等于主检出的锁**
⇒ 一次借用同时服务两棵树。这一趟确实走通了（提交说明里两行为证：
`store 是从「heyta」这个检出软链来的`、`载体 store 在场=true`；家目录路径被刻意不写进提交说明，
因为载体那笔会成为 main 的祖先 —— 这个脱敏 choice 是对的，本轮复述也不补路径）。

#### 🔴 这格仍然不是"已闭合"，它只是"起跑资格"（任务 #43 不许据此销账）

锁同源、主检出装有 store、载体空闲、负载 —— 这四样**每一项都在落地那一刻重新失效**：
main 这一小时内走过 `28811aa5 → ed1af640 → e7b7990f`，别人随时可能再改锁或重装。
所以落地前必须**重取**这四格，而不是引用本节。

#### ⚠️ 这趟排演证明到哪一步为止（说不清就会误导下一位）

1. ✅ 证明：17 道门禁的**接线**跑得通、在真载体上都有读数、第八/九族自检与 21 臂归属自检都在场。
2. ✅ 证明：借 store 这条路**能**建立（前提成立时它不 die(3)）。
3. ❌ **没有**证明：真出现一条红时归属层会正确分"本批 / 非本批"。这一趟的红集是**空集**，
   所以"有红 ⇒ 配对 ⇒ 归属"那条链只在**判据自检的 21 条臂**（合成输入 + 摘除变异）上被证过，
   没有被一次真红走过。把 ①② 当成 ③ 的证据，就是记忆「一次成功运行不等于后续判定被走过」那族。
4. ❌ 没有证明：完整 `pnpm check` 绿（那要窗口，仍是落地那一刻的判据）。

### 8.186 借 store 那道守卫的**对称的一半**：前提不成立时它确实响亮地红（注入现量，rc=3），另记两格环境读数（2026-10-05 11:3x）

§8.185 只证了"前提成立 ⇒ 它放行"。一句"能红"的承诺必须有反向现场，否则它和
「只有通过读数、没有牙」那三条是同一个形状。注入法不改任何代码，只换一个**锁不同的**借用源：

```
HEYTA_CARRIER_LINK_STORE_FROM=<本分支那棵检出> node research/tools/selfhost-merge-carrier.mjs
→ ❌ 载体树 借 store 的前提不成立：（根）那侧 …/heyta-wt-selfhost 的锁=111cc2d1d04d3763
     而 /tmp/heyta-merge-carrier 的锁=0f3c1bf6…
  现场：已 merge --abort ⇒ MERGE_HEAD=无 · 工作树脏 0 条
  脚本自身 rc=3        ← 不是包装命令的 rc（§7 第 164 条那一族）
```

三格读数一起看才算完整：

| 这一趟证明了 | 现量 |
|---|---|
| 守卫**会**拦，且拦在**建软链之前**（日志里"配对树"0 次命中 ⇒ 配对树根本没被建出来） | rc=3 + 上面那两行 |
| 拦下来之后现场是干净的（不留下半个合并给下一位） | `MERGE_HEAD=无`、`git status --porcelain` 0 条、`git worktree list` 无残留 pair |
| 十一族解法在**同一对提交**上是可复现的（两趟重算打的族读数逐字一致） | 写 74 / 集外 0 / 第九族 17 臂红 0（两趟相同） |

🔴 一条要紧的**范围限定**：这道守卫住在 `selfhost-merge-carrier.mjs` 里，而归属判据自己的 21 条臂
（`selfhost-red-attribution.mjs`）**没有** store-blind 那一格 —— 它拿的是合成 stdout。
所以"缺 store ⇒ 判不了 ⇒ 响亮拒绝"这条性质的牙，目前只有①§8.161 那次现场与②本节这次注入两处**读数**，
没有一条**臂**钉住它。要补的话，臂该打在载体脚本这一侧（换一个锁不同的 `BORROW_SRC` 就够，
正是本节的注入），登记在这里，不在本轮做——本轮已经没有别的格子需要这棵热载体。

#### 两格环境读数（为什么这一轮**没有**起 `verify:selfhost-stack`）

| 判据 | 现量 | 门槛 |
|---|---|---|
| 负载 | 1-min `15.49`（5-min 35.33 / 15-min 55.65） | ≤ 12 ⇒ 不合格 |
| 交换 | `total 19456M used 19088M free 368M` | 上一轮 #46 就是被本机内存闸门拒的 ⇒ 不合格 |
| Docker daemon | `29.4.0` 应答 | 合格 |

⇒ 三格里两格不合格 = **环境无效**，按任务书"等窗口而不是调低阈值"处理，这一轮不起趟。
（不去动阈值、不去改判据凑绿；这一格记下来是为了让"没跑"读起来是决定，不是遗忘。）

#### 顺带一条会自己过期的事实，写清楚免得误导

`main` 在这两趟之间又走了一步：`e7b7990f → 3daeccb5`。
所以 §8.185 那枚载体 `4527e46b`（第一父 = `e7b7990f`）**现在就已经不是"当前 main × 当前本批"**了 ——
它不是坏了，是过期。落地前必须再重算一次，这正是脚本自己那句
`main 若再前进 ⇒ 重跑：node research/tools/selfhost-merge-carrier.mjs` 的意思。

### 8.187 落地体检 dry-run 第一次逐格打出七道闸门的读数：**阻塞集已由 5 枚收窄到 1 枚**（2026-10-05 11:3x，零写、零负载动作）

`selfhost-land-main.mjs` 不带 `--confirm` 就是体检：每条闸门出读数，按最严重那一档退出。
这一趟用现成载体（`--carrier feat/self-host-merge-main`，不重算、不碰别人的树）：

| 闸门 | 读数 | 档 |
|---|---|---|
| 载体双亲对上 | 🔴 第一父 `e7b7990f` ≠ main `3daeccb5` ⇒ 载体过期 | 1 |
| 阻塞集为空 | 🔴 只剩 **1 枚**：`package.json`（`docs/README.md` 在这几分钟里被提交了）| 1 |
| 负载可用 | 🔴 采样 `251.12 > 12` ⇒ 环境无效（它自己那句话：不调阈值、不硬跑）| 3 |
| 完整 check 不 SIGKILL 别人的 dev server | ⏭️ dry-run 不跑链 ⇒ "不适用 ≠ 通过" | — |
| 载体的 `node_modules` 与当前那把锁同源 | ✅ 根 `0f3c1bf6d9e2`(361300B) 同源 · e2e `021a9df4` 同源 | — |
| main 未被别人抢先 | ✅ `3daeccb5` 仍是当前值 | — |
| 载体上完整 `pnpm check` | ⏭️ dry-run 不跑 | — |

`exit 1`（最严重那一档）。三格值得单独留下：

1. **阻塞集从 5 枚走到 1 枚**是这一小时里发生的事（10-05 10:1x 那批提交先收掉三枚，11:3x 前后
   `docs/README.md` 又一枚）。剩下那一枚 `package.json` 是链与门禁定义的收口点，动它的人最多，
   所以"再等一笔"仍然是正确决定 —— 不是拖延。
2. **"锁同源"这一格现在有了机器读数**，不再只是我推出来的（§8.185 那段推理与这里同源，
   但判据是那道闸门本身）。它同时说明 §8.186 那次 die(3) 拦的是**借 store 的源**，
   不是载体自己的树 —— 载体那棵的 store 与锁确实对得上。
3. 🔴 **我先前把 251.12 解释成"瞬时采样，与 `vm.loadavg` 的 1-min 15.49 是两个不同的东西"—— 这句是错的，改掉。**
   读实现（`selfhost-loadavg.mjs`：`readLoad1()` = `sysctl -n vm.loadavg` 取**第一位**，
   `parseLoad1` 的形状守卫 + `load1Selfcheck()` 用合成样钉住"取的是 1 分钟位不是 5 分钟位"）
   后现量：那两个数是**同一个量的两次采样**，相隔不到一分钟。这台机器当时负载本就在剧烈摆动
   （工具自己的注释留过 9.7 → 99.4 → 70.4 → 39.2；本节写下后又读到 `341.83 251.32 143.65`）。
   ⇒ 那道闸门的形状也随之更正：**不是**"单样 + 阈值设得很低"，而是 dry-run 只取一样、
   `--confirm` 要**连续三样、每样间隔 `LOAD_STEP`(60s)**，三样都必须 ≤ `MAX_LOAD`(12)。
   为什么要三样恰恰就在这次数上：单样读到 ≤12 之后，几十分钟的完整链里几乎必然撞进一个尖峰，
   而尖峰造成的是**要逐段归属的假红** —— 所以闸门宁可前置付三次 60s 的等待。
   📌 这一格真正值得留的是**方法**：我写下那句解释时没读实现，只在读数之间找差异；
   两个读数对不上时的第一动作应该是读那把尺，不是给它们编两个名字（AGENTS §7 元规则 1）。

⏭️ 两格"不适用 ≠ 通过"要保持原样读：dry-run 从来不会把完整链跑一遍，
所以"落地那一刻 check 绿"与"check 不会 SIGKILL 别人"这两件事**不能**由本节主张。

### 8.188 最后一枚阻塞项与 **G-67** 是**同一笔提交**，而那把 `.py` 尺子在真实数据上咬住了它（2026-10-05 11:4x，零写）

两趟现量（同一分钟内，`--ref` 与 `--pkg/--tree` 三种裁判形态各跑一遍）：

| 判什么 | 命令 | 读数 |
|---|---|---|
| 载体自己（链条目 + 文件清单都取载体树） | `--ref feat/self-host-merge-main` | 链步 **86** · checked 79 · no-target 7 · unresolved 0 · **悬空 0** ✅ |
| main 已提交那版 | `--ref main` | 链步 **85** · checked 78 · **悬空 0** ✅ |
| **他们工作树那版链**（未提交）× 载体树 | `--pkg ../heyta/package.json --tree feat/self-host-merge-main` | 链步 86 · checked 78 · **悬空 1** ❌ `pnpm check:ios-ax-shim → scripts/tools/ios-ax-shim.test.py` |

三条结论：

1. 🔴 **"5 枚重叠文件"与"G-67"不是两件事，是同一笔**。体检的阻塞集现在只剩 `package.json` 一枚，
   而它未提交的那 3 行 hunk 恰恰就是挂上 `check:ios-ax-shim` 的那一笔（同刻主检出：
   `M scripts/tools/ios-ax-shim.py` + `?? scripts/tools/ios-ax-shim.test.py`）。
   ⇒ §8.183 ③ 那句"这条红**不挡落地**"仍然成立（**已提交**态两档都 `悬空 0`），
   但要加一个方向：**他们若只提交 `package.json` 而不带那枚 `.py`，落地的阻塞就换一张脸** ——
   从"工作树没清"变成"载体落笔前门禁打红 `悬空 1`"。那张脸是**他们的**，本批按硬约束不代改。
2. ✅ **§8.183 开的复验命令现在被走过一次真数据**（原来只有合成臂 K1/K2）：
   `--pkg ../heyta/package.json` 分别对 `--tree main` 与 `--tree feat/self-host-merge-main` 各跑一遍，
   两档同为 `悬空 1`、同点名那枚 `.py`。
   🔴 **但 G-67 没有因此关闭** —— 它的关闭判据是"那枚 `.py` 与 `package.json` **同一笔**提交之后，
   这条命令打印 `悬空 0`"。此刻拿到的是**失败那一档**的真读数：它证实"尺子会响"，
   不证实"那笔提交合规"。这两件事在输出上只差一个数字，在判据上是两回事。
   这补上了 G-65 那一族留下的方法论缺口：**"我加了扩展名"要靠一次真实命中来证明它咬得住**，
   合成臂只证明形状，不证明这仓里真存在那种形状。
3. 🔴 **两个"86"不要读成同一件事**：载体的 86 来自并集链，第三行的 86 来自
   main 的 85 + 他们新加的那一步。数字相同纯属巧合 —— 而"数字对上了"是这条记录里最容易犯的错。

⇒ 落地前该做的仍然只有等（#7：等那一笔提交 + 等窗口）。11:4x 环境读数：main 未再前进（`3daeccb5`），
负载 136.17（`>12` ⇒ 环境无效，与 §8.187 更正后的那格同源：**同一个 1 分钟位的又一次摆动**）。

### 8.189 借 store 那条守卫从"只有现场读数"补成有臂；写臂的过程里掉出一个真的洞（2026-10-05 11:5x，提交 `2a52eb10`）

§8.185/§8.186 给这条性质留下的是**两次现场观测**（一次成功配对、一次 `rc=3` 响亮拒绝），
而 `selfhost-merge-carrier.mjs` 里**没有一条臂**钉它 —— 摘掉"两侧 `pnpm-lock.yaml` 的 sha256 必须逐字节相同"
那一行不会有任何东西失败。这就是本仓立过两次的那条：**只有通过读数、没有牙**（同 #36 那一族）。

做法（与第八/九族同一处挂法）：判定本体抽成 `research/tools/selfhost-store-borrow.mjs` 的
`borrowStep`（纯函数，不碰 fs、不读 env），载体 `borrowStore` 只留 fs 动作（软链 + 回读）并调用它，
落笔前在同一趟里跑它的 `--selftest` 并判**输出内容**（红臂计数 + 臂数行）+ 从函数那一侧重新数臂
+ 断言判定确实走过 `borrowStep`。🔴 **臂必须打在跑的那份上**：在自检文件里另写一份判定 = 两套裁决标准。

| 台 | 读数 |
|---|---|
| 自检本体 | `臂数 13（拒绝类 8，按理由认领）· 红 0`，rc=0 |
| 纯度（§8.184 那把尺） | 一次性 `--detach` 树（无 `node_modules`、无 `packages/*/dist`）里 **rc=0**，跑完 `remove --force` |
| 接线对账 | 载体那三道正则打在真输出上：臂数行命中、`claimed=[13,8]` 过 `≥13 / ≥7` 门槛、`RED` 行 0 |
| 等价台（旧内联逻辑 vs 新判定，已随变异台入仓） | 全组合 **144 格 · 语义差 16 格**，16 格**全部**落在同一输入档（两侧锁都读不到），且"新判定比旧的更宽松" **0 格** |

四朵变异（打在内存副本上，真文件一个字没动；**可复跑**：`node research/tools/mutate-store-borrow-guard.mjs`，
它 rc=0 的判据是"每朵都打红自己那一组 + 等价台没有一格变松"。下面这份是当时一趟的快照，命名与脚本一致）：

```
M1 摘掉"两侧锁必须逐字节相同"    ⇒ 红臂 [control, A1, A2, A4, A5]
M2 摘掉"源里必须有 .pnpm"        ⇒ 红臂 [A3, A8]
M3 摘掉"读不出数 ≠ 相等"         ⇒ 红臂 [A7]
M4 把 skip 挪到守卫前面（顺序）  ⇒ 红臂 [A4, A8]
```

三条值得留下的：

1. ✅ **M1 连一枚 control 都打红** —— control 不是装饰，它真的在跑同一条判定；
   而 M4 证明"skip 排在 refuse 之后"这个**顺序**是有主的（不是随手写的代码顺序）。
2. 🔴 **写臂的第一版有两臂"绿"得毫无意义**：`refuses()` 吃的是判定**结果**，我却传了原始输入进去，
   于是那两格是靠"喂错形状恰好落到另一档守卫"蒙过去的。是四臂齐红把它们照出来的。
   ⇒ 这是 §7 第 46 条那一族（没复现 ≠ 路径没执行）的**自检版**：臂自己也要被证明在判它说的那件事。
   修完后重跑：13 臂全 ok，四朵变异各自只打红它那一组。
3. ✅ **M3 只打红 A7**，而 A6（只有一侧读不到）被两道守卫同时接住 —— 于是"唯一持有者"这件事
   现量出来了：`读不出数 ≠ 相等` 这一档由 A7 单独守。
   📌 顺手掉出的那个洞是真的：`sha256Of` 原先在文件读不到时返回字符串 `'读不到'`，
   于是**两侧都读不到时字符串比较给出"相同"** —— 守卫会把"都不知道"读成"一致"，
   照样去软链一棵没被证明同源的树。这一档先前没有臂，所以它一直没被看见（等价台那 16 格就是它）。
4. ✅ **这台自己有阳性对照**，而且做过：把两枚文件 `cp` 到同一枚临时目录，在副本的**判据本体**上
   先落 M1（摘掉"锁必须相同"那一档），再跑副本里的台 ⇒
   `对照（未变异）红臂 = 5 条 [control, A1, A2, A4, A5] ⇒ 判据本体已坏`、
   `M1 ⇒ NO-OP（这趟变异没发生，读数无效）`、`❌ 本台判据不通过（3 条）`、**rc=1**。
   ⇒ 这台**能红**，不是只会在好世界里打勾。
   ⚠️ 第一次做这个对照走的是 `git worktree add --detach`：那棵树来自 HEAD 而台**当时还没提交**，
   于是 node 报 `MODULE_NOT_FOUND`、那个 rc=1 是**探针没跑起来**，不是对照成功。
   台按自己所在目录找判据文件 ⇒ 量它必须把两枚文件放在一起（这条本身就是 §7 元规则 1 的形状：
   先确认探针跑起来了，再读它的退出码）。

⚠️ **未闭合的边界（别把这张表读成端到端已验）**：这四处读数量的是**判定与接线**。
载体自检块 + 真 `borrowStore` 软链那条路的**端到端一次真跑**要等下一次载体重算（要窗口），
届时 `notes` 里会多出那行"借 store 守卫判据自检…"；#43 那一格同理（只在落地那一刻成立）。

### 8.190 "脏清单"与"阻塞集"是两个不同的数：27 枚脏条目里只有 1 枚算阻塞，而我差点把 2 当阻塞（2026-10-05 12:0x）

环境取数（为第 2 项开窗资格做的现量，跑不了就等，不调阈值）：
docker daemon rc=0（在场），`load1 = 464.61` → 两分钟后复取 `308.8`。
🔴 这一格红的**归属要分两半**（详见本节末）：一小半是并行会话的 node burst（起跑 4 秒、各约 100% CPU，
会自己走完），**另一大半是常驻进程** —— 活动监视器自己占 33%、WindowServer 41%、Qoder 两枚 Helper、
以及一枚已跑 **1 天 5 小时** 的 Android headless 模拟器。⇒ **光等不来**：那半部分不是"别人跑完"，
是要人关窗口/停模拟器。产品侧一条读数没变：不是产品失败，是环境无效。
磁盘：可用 28 Gi（这半小时没变）。

顺手取了一次阻塞集现量，撞出一个**我自己会读错**的地方：

```
node research/tools/selfhost-landing-blockers.mjs
主检出（脏集合来源）= heyta · main = 69dccc8a · 分支 = 835cb65f · merge-base = b850b1c6
夹具 5/5 · 写集 76 枚 · 脏条目 27 枚 · 阻塞集 1 枚  →  BLOCK package.json
```

同一分钟里 `git status` 在主检出看到的是 `M docs/README.md` + `M package.json` 两枚
（正是任务书里点名的那两枚重叠文件）。🔴 但**这两个读数不冲突，也不是同一个判据**：

- 阻塞集 = **本批写集（76 枚）** ∩ 主检出脏集合。`docs/README.md` 落在写集**之外** ⇒ 别人在改它，
  与这笔试装不相交，等它没有意义。
- 任务书列的"5 枚重叠文件"是**当时**写集与当时脏集合的交集读数，它不是常数 ——
  这一小时里它 5 → 1，而 12:0x 又出现一枚"看着像重叠其实不相交"的。

📌 一般形状：**"别人在改同一枚文件"和"别人在改我们要写的枚文件"是两件事**，
后者才由 `selfhost-landing-blockers.mjs` 判（它带 5 条夹具）。
按 `git status` 数脏文件会把等待面放大，而多等的那部分是等不来的（AGENTS §9 第 9 条：
撞车判据是同一文件的未提交 diff，不是"某条线在忙"的印象 —— 这里是它的反向面：**交集才算**）。

另记一笔瞬时读数（都是瞬时的，别当趋势读）：main 在这一小时第三次前进
（`e7b7990f → 3daeccb5 → 69dccc8a`），载体因此每次都要重算；`--carrier` 那条体检只是**读数**，
不是可以拿去 `--confirm` 的状态。

🔴 **同一趟里两把"能不能开窗"的尺给出相反读数，而两把都没坏**：宿主那把内存闸门的锁
（`/tmp/tfa-test.lock`）此刻**空**（无持有者），而落地那把负载闸门判 `308.8 > 12`。
成因现量：占 CPU 的是**长跑的常驻进程**（WindowServer 41%、Activity Monitor 33%、
Qoder 渲染/GPU 两枚、`qemu … -avd heyta-w3-yearly` 已跑 1 天 5 小时）
加一批**起跑 4 秒的 node**（并行会话的短促 burst，每个都占满一票 CPU）。
⇒ **锁空 ≠ 负载可用**：那把门只拦"测试类 argv 的起跑"，它不知道常驻负载；
落地/整链这类的资格**只由 `--confirm` 那三样连续采样判**。
⚠️ 也别反过来用："锁是空的"不能作为抢跑的理由，"负载高"也不能当作可以摘掉别人的模拟器 ——
`heyta-w3-yearly` 那枚 AVD 属并行那条线（本机规则已把 Android 构建改走 `windows-pc`，
但**已在跑的别人的模拟器不许我动**）。

### 8.191 第 2 项的现量拿到了：一条 compose 起全套 + 真浏览器三条判据全过，四张截图逐张看过（2026-10-05 12:0x）

开窗资格不再由人判，改由 `research/tools/selfhost-verify-window-runner.mjs` 判（判定本体带臂，
`--selftest` 自己打印臂数）。它这一趟打的是：

```
0s 负载=10.13 锁=空 阻塞集=1 ⇒ go
开窗（起跑时负载=10.13 ≤ 12、锁=我 67217）⇒ 起跑：pnpm verify:selfhost-stack
```

🔴 它**起跑时把 `/tmp/tfa-test.lock` 拿到自己手里**（照 shim 的协议写自己的 pid、写完复读确认），
所以链里后面每一段测试类 argv 走的是自树豁免，而不是"起跑那一刻空、第 40 秒被别人抢走"。
收工行：`===== 收工 2026-10-05T04:08:50.139Z rc=0 signal=- 锁已释放 =====`（全程 ~2 分钟）。

一趟里现量到的判据（只列这一趟的，历史读数不并进来）：

- 服务图对账：默认 3 个（未动）· 带 override 4 个（+supersync-migrate）⇒ 第 3 项那条"不改默认服务图"仍然成立。
- 入口命令抄件对账：扫描集 7 份 + 故意排除 1 份 + 非抄件登记 6 份，命中 9 条，R1–R9 全过。
  其中 **站内那篇自建指南（zh-CN/en 各 1 条）在扫描集里** = G-49 关闭后的第一次真跑复验。
- D-3 对账：一次性容器 `exited(0)` · 应用侧 `RUN_MIGRATIONS_ON_STARTUP=false` · 已应用 **42/42** ·
  悬挂 0 · 重复完成 0 · 回滚痕迹 5 条（设计内）。
- 界面挂载：`[web-app] 共享 UI 挂在 /app/（来自 /app/web-dist）` ⇒ 第 1 项（挂载路径成构建参数）与
  第 2 项（前端产物进镜像）在这一趟里是被同一份日志同时钉住的，不是分开主张。
- 真浏览器 3 passed（7.5s，chromium，零 mock），`FRESH=4/4`。

**四张截图逐张打开看过**（§6.2 规定一，"人眼复核"印在输出里不算）：

| 图 | 看到的 |
|---|---|
| `s1-app-loaded.png` | 收集箱空态 + 左 rail 主蓝激活项 + 顶栏「未同步」+ 中文/English/暗色三个控件都在 —— 是 heyta 的界面，不是报错页 |
| `s2-signed-in.png` | 头像菜单展开，邮箱 `selfhost-3322011-1@example.test`，顶栏变绿「已同步」 |
| `s3-device-a-synced.png` | 任务 `selfhost-task-3322011-2` 在 A 设备，收集箱计数 1、四象限「不重要不紧急」计数 1 |
| `s3-device-b-recovered.png` | **同一标题**出现在全新 context（空 IndexedDB）那台设备上，同样「已同步」 |

🔴 两张 s3 长得几乎一样，这**正是**判据要的形状（同一台服务器读回来的同一条 op）；
"它们是两台设备"这件事不由像素主张，由 spec 里那两条断言主张：写之前 `toHaveCount(0)`、
B 侧 `toBeVisible()` 且 B 是 `browser.newContext()` 的新页面。账号与任务名都带本轮序号
（`3322011` / `-2`），所以旧图不可能冒充这一趟。

⚠️ **这一项证明到哪一步为止**（别把它读成"外人已经能装"）：它证的是**这台机器上、用本地构建出的镜像**，
一条 compose 起全套并且界面可用。它**不**证：① 外人从镜像仓库拉 —— 镜像没发布，那一档还压在
G-55（公开 `origin/main` 建不出镜像，等一次拍板）；② 装完之后四端产物是当前的 —— 那是第 8 项
`reinstall:all`，按任务书排在落地之后。

### 8.192 载体崩在"合并与落笔之间"那一格：三件独立的事，同一趟撞齐（2026-10-05 12:0x–12:1x）

为了把 §8.189 留的那格未闭合边界（"载体自检块 + 真软链那条路的端到端一次真跑"）拿掉，
带着 `HEYTA_CARRIER_LINK_STORE_FROM` 重算了一次载体。它先崩、再拒、最后成 —— 三段各有读数。

**① 崩：一个未定义标识符 `SELF`，而且后台通知报的是"exit code 0"。**
新加的借 store 判据段里那句 `readFileSync(SELF, 'utf8')` 引用了一个从没定义过的常量，
脚本在合并之后、落笔之前抛 `ReferenceError` 死掉。
🔴 包装命令（`… > log 2>&1`）的退出码是 0，通知就说任务完成了 —— 这是 §7 #164 第三次撞在同一条上，
这次连"我自己写的日志行"都没留下。**以后所有后台跑法都必须自己往日志尾部追加 `RC=$?`**
（本轮起 `/tmp/carrier-*.log` 末尾那一行 `CARRIER_RC=` 就是它）。

**② 那 13 条臂一条都没抓住①，而这不算臂的失败。**
臂打在**判定函数**上（`borrowStep` 的输入→动作），它们判的是"这条性质有没有牙"；
没有任何一层判"调用方会不会崩"。⇒ 记一条一般形状：**臂齐 ≠ 接线跑过**，
新判据段第一次运行必须有一次真跑（哪怕它什么结论都不产出），否则"挂上了"只是我的说法。
这一格现在有了：真跑那趟打印 `借 store 守卫判据自检：13 条臂（拒绝类 8，按理由认领）红 0 · 判定本体=本文件调用的 borrowStep`。

**③ 拒：守卫在真数据上第一次自己拒成，而且拒得精确。**

```
❌ 载体树 借 store 的前提不成立（两侧锁不是同一把）：
   （根）借来方的锁=111cc2d1d04d3763 · 载体的锁=0f3c1bf6d9e21526 ⇒ 不软链
   现场：已 merge --abort ⇒ MERGE_HEAD=无 · 工作树脏 0 条
```

三棵树现量（`pnpm-lock.yaml` 的 sha256 前 12 位，别当常数读）：

| 树 | root 锁 | e2e 锁 |
|---|---|---|
| 分支 worktree（借来方） | `111cc2d1d04d` | `021a9df4add8` |
| 载体 | `0f3c1bf6d9e2` | `021a9df4add8` |
| 主检出 | `0f3c1bf6d9e2` | `021a9df4add8` |

⇒ **只有根那一对漂了，e2e 那一对两侧相同** —— 这正是臂 A2 钉的那条性质（"第二侧不是免检区"）
第一次拿到现场读数：只判根的实现会在这里放行一棵锁不同的树。漂的原因也现量了：
main 在 `2f735392` 动过根锁，而分支 worktree 的 `node_modules` 是那之前装的。

⚠️ **这条漂不构成交付前置，我一开始把它读成了前置 —— 现量否证了**（同一趟里第 3 道守卫给的）：
漂的是**借来方**（分支 worktree）那侧的锁，而载体**自己**的 `node_modules` 与载体那把锁是**同源的**
（根 `0f3c1bf6d9e2` 361300B / installed 同值；e2e `021a9df4add8` 993B / installed 同值 ⇒ 两道 ✅）。
理由不神秘：本批没动 `pnpm-lock.yaml`，所以载体的锁 = main 的锁，而载体那套 install 早就是按 main 那把锁装的。
⇒ **落地不需要"先在载体里 install 一趟"**，`selfhost-land-main.mjs` 第 3 道守卫现在是绿的（它仍是每次落地前重取的瞬时读数）。
旋钮那条路（借别人的 store）因此**只在"载体没装过"的世界里才需要** —— 这一次它把自己拦在门外，
恰好证明它判的是前提而不是便利。

**④ 顺带查出闸门话术里一格没有出口的循环**（已改，`80dba899`）：
①崩在合并之后 ⇒ 载体里留下 `MERGE_HEAD`；下一趟退 6，话术是"等那一趟跑完再重跑本脚本"。
但那一格是 `pid=-1 [MERGE_HEAD]` —— **状态不是进程**，没有会跑完的那一趟，
而第 0 步那次 `merge --abort` 排在闸门**后面**，闸门不通就永远走不到它。
⇒ 判拒一个字没改（不自动收拾别人的现场），只把建议分成两种形状，并加第三档注入
`HEYTA_CARRIER_BUSY_FORCE=state` 专门演这一格。三档实测：`state`→6（新的恢复话术，
点名"先对分支尖 + 对 mtime 证明是谁起的，再由那个所有者 abort"）、`busy`→6（原"等"话术）、
`ture`（打错）→2。

### 8.193 落地只剩一格：体检七道里 5 绿 · 2 "不适用" · 唯一那枚红是别人的未提交 `package.json`（2026-10-05 12:1x）

```
node research/tools/selfhost-land-main.mjs --carrier     # 只读取数，不落地
✅ 载体 c7c4e0ad = main(8cb33f55) × feat/self-host-distribution(cab59fc6)
   并集 scripts 键 159 · check 链段 main=85 本批=67 base=66 并集=86（摘段 0/0）· 非 scripts 顶层字段 9 个（丢 0）
   门禁 17 道：17 道 exit 0
✅ 载体双亲对上 · ✅ 负载可用 7.33 ≤ 12 · ✅ node_modules 与当前那把锁同源 · ✅ main 未被抢先
🔴 阻塞集 1 枚：package.json
⏭️ 完整 check 不会 SIGKILL 别人的 dev server（dry-run 不跑链）· ⏭️ 载体上完整 pnpm check（同上）
```

🔴 **两格"不适用"不是通过**（AGENTS §9 第 7 条那一档）：它们要的是**窗口内**那趟真链，
而**现在还不能跑它** —— 链里 e2e 前置会按端口 SIGKILL，那正是第 4 道守卫在 dry-run 里不执行的原因。
⇒ 第 1 项剩下的**不是**"再准备一点"，而是两件事：**别人提交 `package.json`** + **一个能跑完整链的协调窗口**。
哨兵（`--run-on-open`，`QUIET_MIN=15 LOAD_MAX=12`）等的是前者，窗口开了自己就会走后面那趟。

顺带把 G-48 那句"零自动消费者"的**当前**状态现量了一遍（它已经不等式反了，别按旧措辞读）：
`--mount /app/` 那一腿现在有三处消费者 —— `server/Dockerfile:211`（镜像构建内跑
`check-web-artifact --dist apps/web/dist --mount /app/`）、`scripts/verify-selfhost-stack.sh:182`
（**从 Dockerfile 里反解**出唯一那个 `--mount` 值，取不到唯一值就 die，然后在**跑起来的镜像里**
按同一个值复判一次 :270）、`scripts/check-gate-wiring.mjs:102`（把 `pnpm check:web-artifact:app` 当
needle 钉住）。三档调用实测：裸跑（不给 `--mount`）⇒ **退 1**「缺少 --mount …默认值就是那条永远绿的空判据」；
`--mount /` ⇒ 0（本 worktree 当前产物是按 `/` 打的）；`--mount /app/` ⇒ 1「产物声明 / 而你要放在 /app/」
—— 后两条**同时正确**，因为判的是"这一份产物声明的路径 == 你要挂的路径"，不是"产物好不好"。
⚠️ 我上一趟把裸跑那个 1 当成"G-48 可能没闭合"的信号 —— 那是**我的调用形状错了**，
不是判据坏了。形状：这条判据**必须**带 `--mount`，而链里带的是 `/`。

🔴 **那一枚红的形状要报准，否则"在等提交"会被读成"快好了"**（12:1x 现量，主检出只读）：
`package.json` 的未提交 diff 是 **2 增 1 删**，而它的 mtime 是 **10:31:18** —— 也就是这一格已经
挂了 **1 小时 47 分**没被碰过；同一棵主检出此刻还有 **27 条**脏条目（`AGENTS.md`、`PROGRESS.md`、
一批 iOS 证据 PNG/txt）在动。⇒ 这不是"他马上就提"，是**那个人正忙别的事**，
哨兵按 `quiet_min=15` 等下去可能等很久。能清这一格的只有它的所有者（或产品负责人让那条会话先把它提了），
**不是**我这侧再准备什么 —— 本批写集与它相交的只有这一枚，其余四枚（`docs/README.md` 等）按 §8.190
那条交集判据早就不算阻塞。

### 8.194 G-47 那条"真树不是当前产物"的边界，今天顺手升了一格（2026-10-05 12:2x）

第 2 项那趟 `verify:selfhost-stack` 把镜像重建了（`supersync:selfhost-verify` id `3739fa94b690`，
`created=12 minutes ago`）⇒ §8.149 留的那句"真树来自 6 小时前那次 verify 的镜像，不是当前产物"
当场过期。一条秒级一次性容器把树导出来，再拿它跑一遍许可证臂：

```
docker run --rm -i --entrypoint node supersync:selfhost-verify --input-type=commonjs - \
  < research/tools/dump-installed-tree.js > /tmp/tree-today.json      # 23388 B · scannedEntries 145
node research/tools/selfhost-license-coverage-arms.mjs --installed-tree /tmp/tree-today.json
  ok A 摘掉一枚真登记（@node-rs/argon2-linux-arm64-musl@2.2.1）⇒ rc=1，命中「许可证门禁**从没见过**」
  ok B 塞一条幽灵登记 ⇒ rc=1，命中「已经不在」
  ok C 把 carrier 写成后门值 ⇒ rc=1，命中「不是 snapshot / installed-tree 之一」
  许可证登记表变异臂：载体=installed-tree · 4 条 · 不符 0（对照组未变异不红）
```

🔴 **这一格能升，靠的是"登记成债前先实测贵不贵"那一条**（§8.149 的自我否证）：
先前把它排在"落地后与 #28 同一趟"，理由是"要占一次完整构建窗口" —— 那句是错的，
一次性容器秒级就够。⇒ 现在**主张**的是：真树那侧的三条臂在**本批字节构建出的镜像**上各红一次。
仍然**不**主张的：这台机器上"发出去的字节有人守" —— 镜像没发布（G-55 那一档等拍板），
而 12:08 之后我又落了三笔（`80dba899` 只动 `research/tools/selfhost-merge-carrier.mjs`、
`cab59fc6`/`1e35790a` 只动本台账），**都不在 `server/Dockerfile` 的 COPY 集合里**，
所以这棵树对"许可证扫的那棵树"仍然代表当前产物 —— 这一句是有条件的，条件就是刚才那三条 `--stat`。

### 8.195 任务书第 1 项那句"main 自己现在红在 check:docs 5 处"**已经不成立** —— 归属层现在是"两侧都绿"，判据因此变严不变松（2026-10-05 12:2x）

同一道门在两棵**只读**树上各跑一遍（`node research/tools/docs-link-check.mjs`，零依赖、不写盘）：

| 树 | 取法 | 读数 |
|---|---|---|
| 干净 main `8cb33f55` | `git worktree add --detach /tmp/heyta-main-redcheck 8cb33f55` | **退 0**「✅ 无死链…」（扫描 282 份 md / 1977 条相对链接 / 55 处页内锚点；2 条"本机有仓库里没有"的登记豁免、8 条指 `research/upstream` 的刻意跳过，都照原样打印） |
| 载体 `c7c4e0ad`（双亲 `8cb33f55` × `cab59fc6`） | 直接在 `/tmp/heyta-merge-carrier` 里跑 | **退 0**，同一句结论 |

⇒ 任务书里那"5 处红"（引用方只在 main 版本、4 个死链目标在主检出是 `??` 未跟踪）**已经被它的所有者提交掉了** ——
那 4 枚文件不再是未跟踪，于是链接在干净检出上点得开了。
🔴 **这一格的方向要读对**：它不是"归属这一关可以少做"。`selfhost-red-attribution.mjs` 的三条放行条件里
第 2 条要的是"同一道门在**干净 main** 上也退非 0" —— main 现在退 0，于是**载体一旦红，判定就是
"这条红是本批带进去的"**（那是它的 `main 退 0 ⇒` 那条拒绝臂，A 族里最硬的一条）。
⇒ 落地那一刻 `check:docs` 若红，**没有归属可退**，只能真修。这一格从"要逐条写归属"变成"空集且可复核"，
标准没降，是**可主张的更强**：两侧同绿这件事本身是可复跑的两条命令，不是我的说法。

⚠️ 别把这条读成"整条链两侧都绿"：这只量了 `check:docs` 一道门，而完整链 86 段里那 15 段
（要 `packages/*/dist` / APK / 远端 Windows / Playwright）**仍然只能在落地那一刻的窗口里跑**（§8.174 ⑤）。
一次性对照树用完就收：`git worktree remove --force /tmp/heyta-main-redcheck`（本轮已收）。

### 8.196 "崩在合并与落笔之间"这一档现在有自己的牙：A/B 各跑一次（2026-10-05 12:2x）

§8.192 那格记的是**事故**（一个未定义标识符把共享载体留在半合状态）。补完处理器后不能只留一句"已修"，
要能当场复现"没修会怎样"。注入臂 `HEYTA_CARRIER_CRASH_AFTER_MERGE=1` 打在"合并已确认、还没落笔"那一格，
A/B 两趟都跑真脚本、真载体：

| 趟 | 实现 | 退出码 | 事后现场（独立复核，不看脚本自己说了什么） |
|---|---|---|---|
| 负对照 | 同一份文件 `sed` 掉两行 `process.on(...)`（一次性副本 `research/tools/.tmp-crashbench.mjs`，跑完即删） | **1** + 裸 stack 直接吐到 stderr | `MERGE_HEAD=4bd397af` **还在** · 工作树脏 **77 条** |
| 正对照 | 规范版（`uncaughtException` + `unhandledRejection` 两档） | **7**（不与任何一道守卫的码相撞） | 打出"已量到的读数"三条 + `现场：已 merge --abort ⇒ MERGE_HEAD=无 · 工作树脏 0 条`；事后独立取数：**无 MERGE_HEAD · 脏 0 条** |

🔴 两档都要挂的理由不是保险，是形状不同：本文件有**顶层 await**，异步里没接住的走
`unhandledRejection`，Node 22 默认**直接终止且不经过** `uncaughtException` —— 只挂前者会留一整类崩漏掉擦现场。

⚠️ 一条边界别读错：**处理器只擦"自己这一趟起的"合并**（`mergeStarted` 之后才可能非空）。
别人留下的 MERGE_HEAD 仍然由第 0a 步拒在门外 —— 负对照那趟留下的现场就是**手工** `merge --abort` 收的，
因为规范版对它的判断是"不是我起的，不动"。⇒ 修的是"别再制造现场"，不是"替别人收拾"。

### 8.197 "跑过"与"看得见跑过"是两件事：借 store 自检每次都在跑，但成功路径一个字都不印（2026-10-05 12:2x）

补完 §8.196 之后顺手重算了一趟载体（不带旋钮），`rc=0`、`门禁 17 道全 exit 0`，
而我 grep 那行"借 store 守卫判据自检"**没找到** —— 第一反应是"上一轮的结论又写快了"。
读代码才分清两种失败：那段是**无条件的裸块**（`{ … }`，不是 `if (BORROW_SRC)`），它每趟都跑、
每趟都 `notes.push`；但 `notes` 只在 **die 路径**上被 dump，成功路径走的是逐条 `console.log`，
而 `dockSelftestReading`（第九族）在那儿有一行、`borrowSelftestReading` 没有。
⇒ §8.192 里"真跑那趟打印了这行"的读数**是真的**，只是它当时出现在**失败**那一趟里；
成功的那几趟里它一直在跑、一直没人看见。

修法一行（挨着它那两个同级读数印出来）。**判据**：不带旋钮重算一趟 `rc=0`，输出里必须出现
`借 store 守卫判据自检：… 红 0`；这一条在修之前跑会**没有那一行**（本轮就是这么撞见的，
所以它是实测过的红，不是推出来的）。

📌 一般形状：**"这段判据每次都执行"与"这段判据的读数每次都可见"是两条独立性质**，
只满足前者的装置，会在下一次被人当成"没跑"而被重做或删掉 —— 而它恰恰是那种删掉不会立刻有事的装置。
本文件里那两条"自检必须在成功路径上也打出来"的注释（`capSelftestReading` / `dockSelftestReading` 上面那段）
早就写过这条理由；**同一个理由第二次漏在新加的那一段上**，说明它是"写在注释里的规则"而不是"结构上挡住的规则" ——
真要挡住得让成功路径统一 dump `notes`，那是一次单独的改动（会挪动 8 处已有打印的排版），
本批不在此刻做，登记在这里。

### 8.198 载体那三份 compose 解析出来与分支那份**只差两个绝对路径**；而"验哪棵树"这件事脚本早就回答了（2026-10-05 12:2x）

落地前不想再花一次窗口才发现"合并把 compose 的 YAML 解坏了"，所以做了一次**不吃负载**的静态解析
（`docker compose -f docker-compose.yml -f docker-compose.build.yml -f docker-compose.migrate-once.yml config`，
两棵树各一次，都退 0）：

- 服务清单逐字相同：`supersync · supersync-migrate · postgres · caddy`（+ 卷/网络名 `caddy-data`、
  `postgres-data`、`supersync-data`、`internal`、`networks`、`options`）。
- 解析后全文 `diff` **只有 4 行**，两两成对，且都是同一件事：`source: <树>/server/Caddyfile` 与
  `context: <树>` —— 绝对路径本来就该随树变。⇒ 挂载、build 上下文、健康检查、端口这些**承重形状零差异**。

🔴 **这条读数的射程到此为止**：`config` 只证"解析得出、形状一致"，不证"起得来、界面可用"。
后者由 `scripts/verify-selfhost-stack.sh` 判（第 2 项那趟已经判过一次，`服务图对账：默认 3 个 · 带 override 4 个`）。

💡 **顺手纠正我自己一个差点白造装置的决定**：本来要给"载体 vs 分支的 compose 形状"写一枚新判据
（带臂、带注入）。读完 verify 脚本头部才看清两件事 ——
① 它已经在判服务图（`默认 3 / 带 override 4` 那句就是它打的），再造一枚是**第二把量同一件事的尺**，
正是本批一直在拦的"同形状第二次"；
② 它的被测树是 `REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"`（:88）**由脚本自身路径推出**，
不是参数也不是当前目录 ⇒ 直接跑 `/tmp/heyta-merge-carrier/scripts/verify-selfhost-stack.sh`
量就是**落地后那笔字节**，而且 :234 那条 `被验镜像的 revision == 当前 HEAD` 会自己把"验的是哪一棵"钉住
（镜像 tag 取自载体 HEAD，对不上就响亮拒绝）。
⇒ 结论：**不加新装置**，改成把同一把尺挪到载体那棵树上跑一次，排在落地那一刻（任务 #50）。
它比第 2 项现在这趟强的地方很具体：第 2 项量的是**分支 worktree**，而合并解出来的
`server/Dockerfile`（第九族）与 compose 三件套**只在载体上以那个形状存在过**。

⚠️ 过程里又踩了同一条：第一次跑我把 `… | head -8` 之后的 `$?` 当成了 compose 的退出码
（两行 `RC=0` 其实是 `head` 的）—— AGENTS §7 #184 那张账上这是第 N 次，判据要重跑一遍才算：
去掉管道之后真实读数才是上面那两条"都退 0"。

### 8.199 把"记得打印"改成结构守卫：它第一次运行就抓到三处，其中一处是真的（2026-10-05 12:3x）

§8.197 只补了一行打印，那是**症状**。这轮把成功路径改成整份 `notes` 也 dump，并加一条**读自己源码**的登记守卫：
凡 `xxxReading = …` 赋过值，名字必须出现在某条 `notes.push(…)` 的参数里，否则退 2 点名。
不用维护清单 —— **清单本身就是第四次会漏的地方**（"记得加一行打印"这句注释在本文件写过两次，第三次照样漏）。

实测三档：

| 趟 | 结果 |
|---|---|
| 第一次运行（守卫放在**落笔之后**） | 退 2 点名 `pkgReading, giReading, auditReading` —— 但载体 `060dda7b` **已经提交、分支已经指过去**。⇒ 位置错：一条只依赖源码形状的守卫排在写动作后面，等于把"落笔后才发现"变成常态 |
| 移到第 0 步之前 + 修完三处 | `rc=0`，输出多出一段 `── 这一趟量到的 22 条读数 ──`，第一行就是 `读数登记守卫：11 个 *Reading 赋值点，全部出现在某条 notes.push 的参数里` |
| 变异（一次性副本尾部加 `let zzzReading=''; zzzReading='…'`，不登记） | `rc=2` 点名 `zzzReading`，`feat/self-host-merge-main` 前后逐字相同（`13eb9888 → 13eb9888`），日志里**没有**"载体检出"那一行 ⇒ 死在任何写动作之前。副本已 `rm` |

三处命中里两处是**我的正则太窄**（假阳）：`pkgReading` / `giReading` 走的是
`notes.push(\`package.json ${pkgReading}\`)` 这种带前缀写法，第一版只认 `notes.push(名字)` 整参 ⇒
判据把合法写法读成缺陷，比漏判更贵（它会把人推去"修"一条没坏的东西）。规则改成"出现在 push 的参数里"。

真漏的那一处是 `auditReading`：四条"零丢行 / 无冲突标记"断言的读数**只进了提交说明**，
stdout 一个字都没有 —— 也就是说那四条断言每次载体重算都在过，但绿路上没人看得见（正是 §8.197 那一族，
只是这次抓到的是**已经存在很久**的一段，不是我新写的）。已并进它旁边那条 push。

📌 一般形状：**新守卫第一次运行的"位置"要和它的"依赖"一致**。只读源码/配置的判据必须排在任何写动作之前 ——
它越早红，红的时候需要收拾的现场就越少。本轮把它放在落笔之后，第一次响就留下一笔"已经落但被自己判死"的载体。

### 8.200 对外那句"别人通过 bundled Caddy 访问 `/app/`"从来没有人真跑过（登记 G-68；顺手拿到一枚便宜的地板）（2026-10-05 12:3x）

第 2 项那趟绿了之后，回头核对外两份文件的每条可验声称（`docs/runbooks/self-host.md` 与 `server/README.md`）：
端口 `127.0.0.1:1900`、`WEB_APP_PATH=/app/` + `WEB_APP_DIR=/app/web-dist` 两个旋钮、
`[web-app] 共享 UI 挂在 /app/（来自 …）` 那句日志、一次性 migrator `exited(0)` 而应用侧
`RUN_MIGRATIONS_ON_STARTUP=false`、"heyta 不发镜像所以 prefer-the-pull 在这里不可用"——
**逐条与今天 12:08 那趟的读数一致**（这是"没找到错话"的负结果，不是"验过了"）。

🔴 但顺着第 142-143 行那句 "for other people it is `https://<your-domain>/app/` through the
**bundled Caddy service**" 查下去，撞出一格**覆盖缺口**：

- `scripts/verify-selfhost-stack.sh:50` 明写"只起 postgres 与 supersync 两个服务：**不起 caddy**"
  （这台机器 :80 归宿主 nginx，`deploy.sh` 曾因它以"启动失败"收尾），并把 Caddy 那一段推给
  `e2e/live-site/`；
- 而 `e2e/live-site/` 打的是**线上那个域名**，线上走的是**宿主 nginx**（`deployment.md` §3.12 那套），
  不是 compose 里这枚容器；
- 全仓 `grep -li caddy scripts/ research/tools/ e2e/` 只命中两枚：上面那枚脚本（**排除**它）与
  `check-image-build-args.mjs`（管 `CADDY_IMAGE` 那个镜像前缀旋钮）。
  而 `docker-compose.yml:275` 的默认服务图里 caddy 是**常驻第三枚**（`ports 80:80 / 443:443`，
  健康检查探针打 admin `127.0.0.1:2019`）。

⇒ **外人照指南做的第一步，恰好落在唯一一次都没被任何判据跑过的那枚容器上。**
今天这趟绿**不**覆盖它 —— 它量的是"绕开 caddy 直接打 1900 时界面可用"。登记为 **G-68**，
关闭判据写成一条能跑的动作：在一台 :80/:443 可占的机器（或把 caddy 的 `address` 临时改成
高端口 + `tls internal` 的一次性网络）起一次真栈，判 ① 容器 healthy（admin 探针那条注释说改 admin
绑定就会 restart-loop —— 那正是这一跑要证的）② 经 caddy 拿到 `/app/` 200 且 HTML 里数得出主蓝资源
③ 经 caddy 的 `/api/health` 与直连 1900 同形。**不以 `caddy validate` 顶替这三条。**

✅ 拿到一枚便宜的地板（不是判据，是"至少配置本身不坏"）：
`docker run --rm -e DOMAIN=heyta.example.test -v $PWD/server/Caddyfile:/etc/caddy/Caddyfile:ro --network none caddy:2.11-alpine caddy validate --config … --adapter caddyfile`
→ **`Valid configuration`**，并自动加上 TLS 策略与 HTTP→HTTPS 跳转（`https_port 443`）。零端口绑定、
零负载、秒级。⚠️ 它**不**证容器起得来、不证反代通、不证证书拿得到。

⚠️ 同一趟带出一条**决定不做**的：validate 顺带报 `Caddyfile input is not formatted`（:6）。
实测删掉那个空行只把警告推到 :7，`caddy fmt` 要的是**整份文件空格→制表符**（剩 102 行 churn），
而这份文件里住着**日志脱敏那一段**（`request>uri regexp "?REDACTED"`、`Referer delete`）。
⇒ 不在落地前为一枚排版警告造 100 行 diff；登记为 **G-69**，判据：真要 fmt 就单独一笔、
零逻辑改动，且重跑一次"上游不可用时 `docker logs` 里读不到 token"那条脱敏断言。

### 8.201 G-68 闭合：bundled Caddy 第一次在真栈上被真跑，18 臂 0 红，两条判据各被变异臂打过（2026-10-05 12:5x）

装置新入库：`research/tools/selfhost-caddy-serve-check.mjs`（分支）。它**不抄形状** ——
`caddy:2.11-alpine`、`ports` 的容器侧端口、healthcheck 的 `test`/`interval`/`timeout`/`retries`/`start_period`、
`cap_drop`/`cap_add`、`mem_limit`、Caddyfile 的挂载点，全部现读 `server/docker-compose.yml` 的 caddy 块，
**任一项读不到就退 2**（"推导不出来"必须与"跑绿了"分开）。主判据腿仍走窗口起跑器的 `CMD` 旋钮，
所以锁与负载纪律沿用既有那把尺，没有第二把。退出码分档：判据红 8、注入形状不对 6、
栈没起（环境无效≠产品失败）3、没到 healthy 5 —— 绿不绿只认整条 exit。

上面那条"关闭判据"逐条对上：

| 原判据 | 现量 |
|---|---|
| ① 容器 healthy（证 admin 绑定没坏） | ✅ 状态 `healthy`；compose 那条探针 `[wget -q --spider http://127.0.0.1:2019/config/]` 现跑 **rc=0** |
| ② 经 caddy 拿 `/app/` 200 且数得出主蓝资源 | ✅ 代理 200 且与直连**同字节**（sha256[:12] `5573bdad5f06` == `5573bdad5f06`）；HTML 引到 5 个同源资源经代理**全 200**；**4** 个产物含从 `tokens.css` 解出的 `#2563eb`（色值是现读的，不是写死的） |
| ③ 经 caddy 的 `/api/health` 与直连 1900 同形 | ✅ 但**路径按现量更正为 `/health`** —— 服务端只有这一个健康路由（`verify-selfhost-stack.sh:446` 等的就是它；`/api/health` 只在 `verify-mobile-ios.sh:541` 作为 `||` 兜底出现，不是路由）。同形判据本身没改 |

顺带钉住"外人第一步"另三格，它们全是**取值差异**而不是"有没有"：
`X-Frame-Options` 经代理=**DENY**、直连=**SAMEORIGIN**（⇒ caddy 的 `header` 块在覆盖，也证代理腿真经过它）；
`encode gzip zstd` 生效（代理带 `content-encoding: gzip`，直连**不带压缩**）；
`-Server` 两侧都无 —— Node 本来就不发 `Server` 头 ⇒ **这一行在当前部署里是空操作**，登记不当缺陷。

🔴 这里有一处**我自己写错的判据被现量抓出来**：原打算用"直连侧没有安全头"当"请求真经过 caddy"的证据，
实测**直连侧三条全有**（发出者是 `@fastify/helmet`，注册在 `server/src/server.ts:416`）。照原写法跑会以红收尾、且把归因指错地方。改成"取值不同形"，
并补一条更硬的：`docker stop` 之后代理腿 `fetch failed`（status=0）而**直连腿仍 200**
⇒ 回话者就是这枚容器，不是 `127.0.0.1:18080` 上恰好坐着的东西。

两条变异臂（都留原读数）：
- `{ admin off }` 注进全局块 ⇒ 那条健康检查命令 **rc=1**，而容器仍活着、代理仍 200
  ⇒ 红的确实只有 admin 那一格 ⇒ **①/A 有牙**（这正是 Caddyfile 头三行注释那句"改 admin 绑定就会 restart-loop"的第一次实证）。
- 摘掉两处 `request>uri` 日志 filter ⇒ 合成令牌**出现在** `docker logs` ⇒ **E（脱敏那条）有牙**。
  令牌是 `synthetic-<uuid>`，不是任何真凭据，且不落进任何输出与证据文件。

两处**探针自身**的缺陷当场被抓、当场改掉（都属"臂写反 / 模式打空"那一族，值得后来者照镜子）：
1. 那条 admin-off 臂我写成 `claim(..., 1, rc === 0 ? 1 : 0)` —— 把读数预先取反了一次，
   于是**变异真的成功时这条臂反而报红**（第二趟 18 臂里那 1 条红就是它，不是产品红）。
   ⇒ 规矩：**臂的 `got` 必须是原读数**；"期望非零"要写成布尔，不要靠三元翻转去凑。
2. 按字面内容匹配那行 filter 的正则**一条都没摘到**，脚本却照常往下走 ⇒ 若不加
   "正好摘掉 2 条、且摘完后 `REDACTED` 不再出现"这两条断言，就会把"探针没打中"记成"E 判过了"。
   （§7 第 46 条的又一次实锤：**没复现的臂什么也不证明**。）

🔴 **射程边界（不许读多）**：这跑**不覆盖** `docker compose up` 那条真服务图（我用 `docker run` 起单容器，
只是字段从 compose 读）· **不覆盖签证书**（`DOMAIN=:80` 没有域名 ⇒ ACME/443 那一格仍未取证）·
**不覆盖** WebSocket 升级经代理（`?token=` 只打到 HTTP GET 层）· **不覆盖**主机 :80/:443 的真占用
（刻意发布到 `127.0.0.1:18080`，也不动宿主 nginx）。
⇒ 对外那句 "through the bundled Caddy service" 现在有四格读数（容器起得来 / 反代通 / 产物原样到达浏览器 /
日志脱敏在位），**没有**"证书能签下来"那一格。

顺手一枚 G-69 新读数：`caddy validate` 在这条路径上照样报 `not formatted`（file=`/etc/caddy/Caddyfile`），
脚本把它作为 reading 打印出来 —— 警告是真的、且不修。

收尾对账：脚本自己创建的对象（3 枚容器 + 6 枚一次性卷）**0 残留**；我自己那组 `--keep` 栈已 `down -v`
（两枚数据卷与 `super-sync-server_internal` 均 Removed）、一次性凭据文件已删、:1900 空。
⚠️ 那条 `--keep` 复跑留下的三张新截图（`e2e/selfhost-stack-results/s2/s3-*.png`）**没有被人复核**，
所以**没有提交**；§8.191 那四张已复核的仍是当前证据。

### 8.202 证书签不出来时三枚容器**全绿**（一枚 hermetic 容器的读数 ⇒ 对外那句补了两条前提）（2026-10-05 13:0x）

起因是上一节自己写下的那句边界（"签证书那一格不在射程内"）。回头核
`docs/runbooks/self-host.md` §5，它让外人 `curl -fsS https://你的域名/health` 再开
`https://你的域名/app/` —— 而这两条成立的**前提**（域名已解析到这台机器、宿主机 80/443 对外可达）
**全文一次都没出现**（**改前**现量：`grep -n "解析\|DNS\|A 记录\|ACME" docs/runbooks/self-host.md`
只命中第 4 行那句讲 `jq` 的；本节落笔之后再跑同一条会命中**下面那段新加的措辞**，
所以这条 grep 只在"改前"那棵树上有意义）。这不是错话，是**漏了两条会让外人第一步就撞墙、而撞了又查不出在哪的前提**。

读数（可复现、零对外请求、零端口占用；容器已自清）：

```bash
docker run -d --name heyta-g68-nocert --network none \
  -v "$PWD/server/Caddyfile:/etc/caddy/Caddyfile:ro" -e DOMAIN=heyta.example.test \
  --cap-drop=ALL --cap-add=NET_BIND_SERVICE --memory=256m \
  --health-cmd "wget -q --spider http://127.0.0.1:2019/config/" \
  --health-interval 5s --health-retries 3 --health-start-period 5s caddy:2.11-alpine
```

35 秒后现量：**`running=true  exitcode=0  health=healthy`**。日志只有这三条：

| logger | level | 内容 |
|---|---|---|
| `http.acme_client` | warn | `HTTP request failed; retrying`（`acme-v02.api.letsencrypt.org/directory` DNS 都不通） |
| `tls.obtain` | error | `could not get certificate from issuer` |
| `tls.obtain` | error | `will retry … retrying_in: 60, max_duration: 2592000` |

🔴 打掉的是这个假设：**"caddy 起不来才会红"**。它签不到证书时**不退出**、
出货那份 healthcheck（探针打 admin `127.0.0.1:2019`，与证书是两套东西）**照旧 healthy**，
`docker compose ps` 三枚全绿，而且它会这样安静重试**三十天**。
⇒ 已落进 §5 的措辞：那一步的判据只能是**浏览器真打开那个 https 地址**（或 `curl -fsSv`），
不能是容器状态；并写明这一格比"起了但未迁移"更隐蔽 —— 后者至少还在应用日志里刷
`column ... does not exist`，证书这一格**连 `unhealthy` 都不出现**。

⚠️ 边界（别读多）：这枚容器**不**证"证书能签下来"（那需要一台域名已指过来、80/443 可入的机器），
它证的是**失败形态**，也就是"为什么不能拿容器状态当那一条的判据"。
⇒ 一条一般规律：**健康检查打在"进程还活着"上，就打不出"这件事做成了"** ——
§7 元规则 2（一条永远通过的判据比没有判据更糟）的第五种面目。

### 8.203 登记 G-70：实时同步那一腿从来没经 caddy 走过（`?token=` 的 WebSocket 升级）（2026-10-05 13:1x）

§8.201 把 bundled Caddy 的三格拿到了，但它自己留了一条**没写够**的边界：
那三格全是 HTTP GET 层（`/app/`、`/health`）。而 P2 落地的**实时同步**走的是 WebSocket，
且它的鉴权是 `?token=<JWT>`（浏览器不能给 WS 设头）—— 这正是 `server/Caddyfile` 里那段
日志脱敏**为它而写**的那条路径。也就是说：

- 外人照 §5 打开 `https://你的域名/app/` 之后，"另一台设备改一条任务、这边不动就跳出来"
  这一维，从来没经这枚容器验证过；
- `verify:mobile-autosync` / `verify:p2` 那几套打的都是**直连 :1900**（§8.200 已记），
  `e2e/live-site/` 打的是线上**宿主 nginx**；
- Caddy 的 `reverse_proxy` 会自动处理 upgrade 是它的设计，但"设计如此"在本仓库**不构成读数**
  （§7 第 46 条：没复现的臂什么也不证明），而且这枚容器还叠着 `cap_drop: ALL` 与
  `encode gzip zstd` —— 后两者与 upgrade 路径的相互作用没量过。

⇒ 登记 **G-70**，关闭判据写成一条能跑的动作（**落在 §8.201 那枚装置里加一条臂，不另建装置**）：
① 经 caddy 用真 JWT 完成一次 WS 升级（断言拿到 `101` 且**这一腿只有经过 caddy 才会是 101** ——
控制腿：不带 upgrade 头同 URL 必须不是 101）；② 设备 A 经代理写一条任务，设备 B 只挂着这条 WS、
**不轮询不点同步**收到该 op，且**从建连到收到这一条不许发生重连**（重连计数为 0）——
这一条比"多少秒内"硬：它排掉了"其实是退避重连把那一条带回来的"。
阈值不许写死，只能从 `packages/sync-client/src/realtime.ts:220-222` 现量导出
（`DEFAULT_INITIAL_BACKOFF_MS = 1_000` / `DEFAULT_MAX_BACKOFF_MS = 30_000` / `factor = 2`）；
close 码那三个常量（`4001/4003/4009`）是同一条路径上的既有词表，臂要认它们而不是认字符串。
③ 变异臂一条：把 Caddyfile 的 `reverse_proxy` 换成 `handle_path /` 之类的错误形状 ⇒ ② 必须转红
（证 ② 真压在代理那一条上）；④ 顺手取 `docker logs` 里那条 `?REDACTED` **出现在这腿的 upgrade 请求上**
（现在只证过 HTTP GET 腿）。
边界：这一跑仍**不覆盖**签证书（§8.202）与真实域名下的 TLS 终结。
⚠️ 它需要窗口（要起栈），排在落地之后；现在登记是为了**别让这条边界只活在那张表里**。

### 8.204 判据的锚点必须带**现量路径**：我在 §8.203 里写的那个文件路径是脑补的（2026-10-05 13:1x）

上一节最初把阈值锚在「`realtime.ts` 里那个既有常量」—— 因为 `AGENTS.md` 的 P2 那一行写着
"实时同步在 web 的接线（`realtime.ts` 450 行 + 自带测试齐全）"，我按惯性把它当成 `apps/web/src/realtime.ts`。
现量：那个路径**不存在**（`ls apps/web/src/realtime.ts` → No such file）。真身在
**`packages/sync-client/src/realtime.ts`**（469 行，与 AGENTS 那句"450 行"对得上，但**不 web**），
web 侧只有 `apps/web/tests/realtime-wiring.spec.ts` 那枚接线测试；`apps/mobile/src/sync/realtime.ts` 是另一份宿主侧。
⇒ 已把 §8.203 的 ② 改写成"重连计数为 0 + 阈值从 `packages/sync-client/src/realtime.ts:220-222` 现量导出"。

📌 这条值得单独留着：**"文档里提到过某个文件名"不等于"它在某个路径下"**。
把判据锚在一个不带路径的名字上，下一个执行者要么在错的文件里找不到常量、
要么随手挑一个数字当阈值 —— 两种都把这条判据变成装饰。锚点写法只有两种合格的：
**带行号的现量路径**，或**从被约束的常量导出的表达式**（§7 元规则 2）。

### 8.205 落地那一刻会红在哪一格，现在就有读数（预检四向摘段=0，唯一那一格是 `check:ios-ax-shim`）（2026-10-05 13:1x）

`node research/tools/selfhost-chain-preflight.mjs` 现量：四向摘段全 0（并集 vs base ／ main vs base ／
本分支 vs base ／ main工作树 vs main），而主检出**未提交**新增的链段有 1 枚 ——
`check:ios-ax-shim`，它的实现读不出路径（未跟踪的 `.py`）。

⇒ 两条结论必须分开写，不许混成一句"预检全绿"：

1. **合并形状没有要人拍的地方** —— 载体第 1 族这次可以自动解，不会停下来等人裁决。
2. **落地那一趟 `pnpm check` 预计仍会红一格，而它不是本批的**：载体是干净检出 ⇒
   未跟踪文件**不随 merge 走** ⇒ 引用方（`package.json` 里那段）已进链、实现方在载体里根本不存在。
   预先定好的处置（不因它改判据、不为它摘段）：**逐条归属到非本批**，挂原编号 G-67 ／ 任务 #48，
   由那个门的所有者把实现一并提交之后它自然消失（§8.105 是同一条纪律的前一次）。
   ⚠️ 这一格是"等得来的人"：红的原因是**一个正在工作的会话**，不是环境，也不是本批。

⚠️ 同一趟的对照读数：阻塞集仍 **1 枚**（`package.json`），而主检出脏条目从 12:4x 的 29 涨到 13:1x 的 **56**
—— 那条线正在大批落笔。**"等他们提交"是瞬时事件，不是状态**：这一格只在落地那一刻重取才有意义（任务 #43）。


### 8.206 公开 main 12:59 前进了 594 笔，而本地 main 一滴不剩 ⇒ 落地的**基线**自己成了一格（2026-10-05 13:2x）

取现量的过程里先撞上一次自己的探针错：`git fetch --quiet origin 2>&1 | tail -2` 之后 `$?`
读的是 `tail` 的（§7 第 184 条**第三次**在同一双手上现形），而 `origin` 是那枚 SSH 远端
（`git@github.com:Xaiver03/heyta.git`），这台机器今天没有可用访问权（报
"make sure you have the correct access rights"）。
⇒ 换回台账里昨天那条**成功过的只读路径**重跑，且不经管道：
`git fetch https://github.com/Xaiver03/heyta.git +refs/heads/main:refs/remotes/origin/main`
→ `FETCH_RC=0`，`8ae4bfcc..564ad047`（公开那笔 **12:59:42**；本地 main=`8cb33f55` 是 **11:58:54**）。

🔴 四笔现量（都可复跑）：

```
git rev-list --count origin/main..main  =   0    ← 本地 main 没有任何公开树没有的东西
git rev-list --count main..origin/main  = 594    ← 公开 main 领先本地 594 笔
git merge-base --is-ancestor 8cb33f55 origin/main = 是
git merge-base --is-ancestor 673e6a43 origin/main = 否   （本分支 tip 不在公开树里）
```

⇒ **本批已经"部分公开"**：公开树里有那条 `RUN npm pkg delete devDependencies`（`:309`）、
有 24 枚 `research/tools/selfhost-*.mjs`、台账写到 **§8.182**；而分支后半段（含今天这五笔）不在。
"落地"这件事的 mental model 由此过期了一格 —— 要落的是**差集**，不是整批。

### 这条现量逼出的三件事

1. **给 lander 加了一道基线闸门**（`research/tools/selfhost-land-main.mjs`，新 `--baseline-leg`）。
   原有那道"载体双亲对上"只比对**本地** main，看不见"本地 main 自己就是旧的" ——
   装在旧基线上的那一笔并不代表"批次 + 当前公开基线"，一旦被人推上去，就是把别人 594 笔当分叉处理。
   读不到远端 ref 按**判不了**处理（`--confirm` 下拦、纯体检只报不拦），口径与
   `selfhost-carrier-busy` 同一句：**"判不了"不等于"没问题"**。
   三臂现量（两腿都用真 ref 打，没有造假旋钮）：
   `HEYTA_LAND_REMOTE_MAIN=main` ⇒ ✅ 落后 0 笔、rc=0；默认 `origin/main` ⇒
   🔴 领先 **594 笔**、rc=1 并给出恢复动作；`HEYTA_LAND_REMOTE_MAIN=no/such/ref` ⇒
   🔴 判不了、rc=2。**这条判据能红是拿真数据证的**，不是推断。
2. **G-55 换问题、不换编号**：它的前提"公开树缺那条 prune ⇒ 建不出镜像"今天**已不成立**
   （那一行现在就在公开树里）。剩下没人证的命题是"外人从公开树按那三条 `-f` 整条 build 走不走得通"，
   判据：一次性 detached 检出公开那一笔，真跑一次 `docker compose build`（需要窗口）。
   ⚠️ 别把它读成"公开树现在能建了" —— 那是还没量的另一格。
3. **落地时 Dockerfile 那一族的新形状要现量看**：两棵树在这段**只差注释**
   （公开侧多了一段讲"devDependencies 必须在装之前剪掉"的说明，本分支是另一套精简措辞），
   而 `ARG`/`RUN` 行为行**逐字相同**。⇒ `selfhost-dockerfile-merge.mjs` 若只按行为行解冲突，
   这一格（纯注释分叉）怎么落地要在**那趟运行里**取读数，不许事后用"反正是注释"解释掉。

### 对第 1 项的影响：外部合取从一条变成两条

原来只剩"owner 提交 `package.json`"。现在多一条**只有主检出所有者能做**的动作：把主检出快进到公开那一笔
（`git merge --ff-only origin/main`）。本批**不动主检出**、不 `git branch -f main`、不 push ⇒ 这道快进
不能由我代做；而 lander 现在会**响亮拒绝**装在旧基线上。
⚠️ 哨兵那台 `--run-on-open` 仍会照开 —— 开窗后被这道新闸门挡下（rc=1，一个字节都不写）。
**这是设计要的**：宁可退，也不要装出一笔会被人当分叉处理的合并。

### 8.207 「不动主检出」有了一条**有边界的例外**：产品负责人授权我在主检出干净时跑那一条 ff-only（2026-10-05 13:3x）

授权原话：**「授权我在主检出干净时跑那一条 ff-only（推荐）」** —— 这是对 §8.206 末尾那个归属问题的回答。
边界要逐字钉住，否则"授权"两个字会被后面的人读成通行证：

- **前提**：主检出 `git status --porcelain` 为 **0 行**（含 §8.206 说的那枚 `package.json` 已被其所有者提交）。
- **动作**：只有那**一条** `git merge --ff-only origin/main`。
- **仍然不做**：不编辑他们的文件、不代提交、不 push、不动别的分支、不在非快进时硬来。
- **失败原样报**，不解释成环境问题。

### 写这条时的现量（三个数，全部当场取的）

| 读数 | 值 |
|---|---|
| `main` / `origin/main` | `8cb33f55`（11:58）/ `564ad047`（12:59） |
| 落后 / 本地独有 | **594 / 0** ⇒ 纯快进，`--ff-only` 不会改写任何历史 |
| 主检出脏条目 / 阻塞集 | **59 / 1**（`BLOCK package.json`） |

🔴 **这里有一条排序上的收获**：脏集合 59 ⊇ 阻塞集 1，所以"主检出干净"**这一个条件同时满足 §8.206 那两条外部合取**
（owner 提交 `package.json` 是它的子集）。触发器因此从"等 land 日志出现"改成"等 `porcelain` 归零"——
一个条件、两件事，不用等两次。

另一条现量：`heyta-wt-merge` 那枚 worktree 挂在 **`merge/20261005` = `564ad047`**，也就是公开那一笔。
别的会话已经在公开基线上开了自己的合并分支。它**不是本批的资产，不动它**；
但它说明 `origin/main` 这个 ref 现在别人也在跟 ⇒ 我 ff 之后它可能**再次被推走**，
届时 lander 的基线闸门会再拦一次（同一条授权重复即可，不是新决策）。

### 落地序列（顺序固定，一步一等的）

1. 触发条件成立：主检出 `porcelain` 0 行 **且** `origin/main..main` 为 0（真有独有提交就不是那条授权，停下报）。
2. 用今天唯一可用的通道重取基线：`git fetch https://github.com/Xaiver03/heyta.git +refs/heads/main:refs/remotes/origin/main`
   —— `origin` 是 SSH，这台机器今天不通。**取完重新数落后笔数**，不沿用旧读数。
3. 落后 > 0 ⇒ 在主检出跑那一条 `git merge --ff-only origin/main`；报错原文照抄进台账。
4. 重跑 `research/tools/selfhost-chain-preflight.mjs`：基线跳了 594 笔，**集外冲突族的形状可能变**。
   §8.206 第 3 条那格（Dockerfile 只差注释、行为行逐字相同）要在**那趟预检里**取读数，
   不许事后用"反正是注释"解释掉。
5. 哨兵开窗 ⇒ lander 按 §8.16 三行重算载体 ⇒ **载体上**跑完整 `pnpm check` ⇒ `main` ff-only 前进到载体 ⇒
   逐条归属。§8.205 预测的 `check:ios-ax-shim` 那一格按**归属、不修、不摘段**处置。

### 哨兵不改判据，只讲清它和这道新闸门的关系

`selfhost-window-sentinel.mjs` gate 的是"阻塞集=0 + 负载 + 端口空 + 载体空闲"；基线那一格由 **lander 自己拒**
（rc=1，一个字节都不写）。我 ff 之后那一格自然成立，不需要给哨兵加条件。
⚠️ 代价登记在这：若 `origin/main` 在我 ff 之后又前进，哨兵**开窗那一次**会被基线闸门吃掉一枚尝试额度。
现量：哨兵已跑 3 小时 00 分，land 日志 **0 枚**（`/tmp/selfhost-window-sentinel.log.land-*.log` 无匹配），
因为阻塞集一直是 1 —— 这个消耗**还没发生过**，别把它写成已经付过的成本。

### 8.208 那条授权的前提在**写完它十分钟后**就断了：主检出出现一笔没推的本地提交 ⇒ 现在不是快进（2026-10-05 13:4x）

`--check`（只判不动，对真主检出跑）打回来的是：

```
{"kind":"dirty","before":"3281ebb2","lines":32}   rc=2
```

同一时刻另取的关系数：**`main=3281ebb2` · `origin/main=564ad047` · 落后 594 / 本地独有 1**（13:4x 先 `git fetch` 过一次 HTTPS 只读通道，`fetch_rc=0`，所以这不是陈旧 ref）。

两件事同时成立，而第二件是新的：

1. **脏条目从 59 掉到 32** —— 并行会话在主检出提交了 `3281ebb2`（"日历线入库装置那条闸门自己漏了一支"）。
2. 🔴 **`ahead=1` 让那条授权整格失效**：快进的前提是"本地是公开的祖先"，现在本地有一笔公开的树里没有。
   `git merge --ff-only origin/main` 在这个形状下**跑不通**，而授权写得很清楚只覆盖快进 ⇒ 我不动。

§8.207 那张"写这条时的现量"表（`main=8cb33f55` / 脏 59 / 落后 594 独有 **0**）在十分钟内就全变了。
这正是要把触发条件写成**状态**（porcelain 归零 **且** 独有=0）而不是写成某个 SHA 的原因 ——
台账里那三个数的保质期是分钟级的，读数只能现取。

### 由此逼出的一个真缺陷：闸门给的恢复动作在这个形状下是不可能成功的

`selfhost-land-main.mjs` 的基线闸门原来只有一个分支："领先 N 笔 ⇒ `cd 主检出 && git merge --ff-only origin/main`"。
那句话在 `ahead=0` 时是对的（13:2x 的三臂读数就是这么打的），在 `ahead>0` 时**指人去跑一条必定失败的命令**。
"恢复动作跑不通"和"对外错话"是同一族，所以拆成两格：

- `behind>0 且 ahead>0` ⇒ 明说**这不是快进**、那条授权不覆盖、本工具不替所有者合并/变基/推送，
  要由那 N 笔的所有者把本地提交与公开基线和好；
- `behind>0 且 ahead=0` ⇒ 仍指快进，但**不再抄那条命令**，改成指向 `selfhost-main-fastforward.mjs`
  （判据只有一处：前提与动作固化在那枚工具里）。

三臂现量（全部真 ref，无造假旋钮）：`HEYTA_LAND_REMOTE_MAIN=main` ⇒ ✅ 落后 0 / 独有 0、rc=0；
默认 `origin/main` ⇒ 🔴 **新话术**（"本地另有 1 笔没进…这不是快进"）、rc=1；
`no/such/ref` ⇒ 🔴 判不了、rc=2。
⚠️ **纯落后那一格的**新**话术当前拿不到真读数** —— 主检出有了未推送提交之后，公开树里没有任何 ref 以本地 `main` 为祖先，
所以那个分支**构造不出来**。它在 13:2x 有过一次真 ref 读数（当时独有=0），那笔记录算它的历史证据；
等新那一笔被推上去、形状回到"只落后"，要再打一次。别把这条读成"两格都验证过了"。

### 新增那枚装置：`research/tools/selfhost-main-fastforward.mjs`（把 §8.207 的授权固化成代码）

它不是"帮我敲命令"的脚本，而是**前提 + 三个拒绝分支**唯一能说清的地方：
`porcelain==0` 才继续；`ahead>0` 就拒（并停止，不重试）；只有"落后且干净"才跑那一条 `merge --ff-only`；
跑完回读 `porcelain` 是否仍为 0 与落点 SHA。主检出路径由 `git worktree list` 现取（与 lander 同一个来源，不抄第二份），
fetch 走 origin URL 的 HTTPS 同址（SSH 那台今天不通；转换只做一次）。

三臂自证（合成夹具 `git init`+`clone`，**一个字节都不碰主检出**；臂数由脚本自己打印）：

| 臂 | 期望 | 实读 |
|---|---|---|
| 脏 ⇒ 拒绝且 main 未动 | `dirty|same` | `dirty|same` ✅ |
| 非快进 ⇒ 拒绝且 main 未动 | `divergent|same` | `divergent|same` ✅ |
| 干净且只落后 ⇒ 快进到公开那一笔 | `ffed|same|true` | `ffed|same|true` ✅ |

第 2 臂就是今天 13:4x 那个真形状的合成复现 —— 也就是说"授权不覆盖这一格"这句话**有代码在守**，
不是我在台账里对自己表态。

### 现在的外部合取（第 1 项落地）

原来是两条（owner 提交 `package.json` + 有人快进主检出），今天现量把第二条**换了形态**：

1. 主检出 `porcelain` 归零（含那枚 `package.json`）；**并且**
2. 那笔本地未推送的提交进入公开 `main`（由它的所有者推送，或由他把公开基线和进来）。

两条同时成立 ⇒ `ahead=0 且 behind>0 且 干净` ⇒ 看守会跑那一条快进；随后 lander 的基线闸门放行，
哨兵开窗就能进"重算载体 → 载体完整 check → main ff-only 前进到载体 → 逐条归属"。
**这两条都不是本批能代做的动作**，也不在授权范围内多做任何一条。

### 8.209 看守的循环层也要读数：分叉那格**该等**，把它写成"失败退出"等于让自动化在最需要它的时候死掉（2026-10-05 13:4x）

§8.208 那三臂证的是 `evaluate()` 那一层的判定形状。把工具接通之前又问了一遍**循环层**：
三种真状态各跑一次（一次性合成仓库，`--step=1 --cap=2..3`，跑完即删；不碰主检出）：

| 状态 | 实读 | 出口码 |
|---|---|---|
| 干净且只落后 | `[1/3] ffed main=600711a→98c3159 落后1/独有0` + `首行原文：Updating 600711a..98c3159` | 0 |
| 脏一行 | `[1/2] 脏 1 行` `[2/2] 脏 1 行` + `窗口等满` | 3 |
| 分叉（独有 1 笔） | `⏳ divergent …不在授权范围，继续等：本地独有 1 笔` ×2 + `窗口等满` | 3 |

第 2、3 行是**改过之后**的读数：原先这两格都以 rc=1 退出。那个形状的错在于 ——
"前提不成立"和"命令跑过却失败"是两类事实，把前者当后者报，看守就会在主检出正脏着、
而那笔未推送提交还没人和好的那一刻**自己死掉**，于是"等窗口"这件事需要有人在旁边盯着重启，
而那就是一个会自己造红的装置。现在只有三种情况停：
`ff-fail`（那条授权命令真跑过且失败 ⇒ 原样报）、`no-remote-ref`（探针读不到 ⇒ 判不了）、现场解析不到。
⚠️ 边界：rc=3 只说明"这一轮等满"，不说明前提永远不会成立 —— 记成"环境无效≠产品失败"，不记成"不需要落地"。

### 8.210 预检打在"落地真正会用的那支基线"上，量出一枚**必然出现的假红**，顺手把"红了却退 0"也改掉（2026-10-05 13:5x）

§8.208 说主检出的形态已经变了，那就别只盯着本地 `main` 预检 —— 落地用的基线是快进之后的 `origin/main`。
把 `selfhost-chain-preflight.mjs` 打在 `origin/main` 上，旧版打回来的是：

```
摘段 origin/main工作树 vs origin/main = 5 ⇒ check:detail-pane-status-table | … | check:image-build-args
结论：并集与 base 之间摘段=5 ⇒ 🔴 会 die，要人先判
```

🔴 **这句结论两句都是错的**：

1. **那 5 段不是摘段**。第 4 格拿的是主检出那棵树的**工作树字节**，而工作树签出的是本地 `main`（比 `origin/main` 旧 594 笔）⇒
   "ref 有而工作树没有"的段被读成"被摘掉"。打在**没被签出**的那支 ref 上时，这一格**按构造必然红**。
2. **判词的名字与实际算的东西不符**：`anyErode` 是四格之和，话却写成"并集与 base 之间"。
   也就是说别人未提交的链里少一段，也会被判成"载体第 1 族会 die"。

这两条合起来的代价不是难看：这一枚预检的职责就是**在开窗之前回答"窗口会不会白烧"**，
而它会在每一次"先看新基线"的用法里喊一句不可行动的狼来了 —— 下一步通常就是有人去"消掉那 5 段"。

### 改成什么样（判据只有一处，且要能红）

- 判词 = **前三格之和**（并集 / `<ref>` / 本分支 各自 vs base）；第 4 格单独报、不进判词 —— 它问的是另一件事。
- 第 4 格与"未提交新增段"两格在 `<ref>` ≠ 主检出签出那笔时**标成不适用**，
  并且明写"**不是 0**"（口径同 lander：判不了不等于没问题）。
- 🔴 **判红即 `process.exit(1)`**：原来印着"🔴 会 die，要人先判"却以 0 结束 —— 红留在纸面上、链上没人接。
  未跟踪实现那一档**不进**出口码（那不是本批的债，按 §8.105 逐条归属，不把预检变成别人的门禁）。

三臂现量（每一臂都认了 exit code）：

| 臂 | 判词 | 出口码 |
|---|---|---|
| A 默认（对本地 `main`，第 4 格适用） | 合计=0 ⇒ 可以自动解；`check:ios-ax-shim` 未跟踪 1 枚照旧单列 | 0 |
| B `origin/main`（落地真正会用的那支） | 合计=0 ⇒ 可以自动解 + 两格标"不适用（**不是 0**）" | 0 |
| C 阳性对照：合成 ref 摘掉 `pnpm screenshot:verify` | 合计=1 ⇒ 🔴 会 die，要人先判 | **1** |

C 那支 ref 由 `hash-object`+`mktree`+`commit-tree` 现造，挂在 `refs/tmp/` 下，跑完即删（`rev-parse --verify` 回 `fatal: Needed a single revision` 为删净证据）——
只写对象库，不动任何工作树、不动索引。**这条臂是手搭的一次性夹具，不常驻**，重配方在本节文字里。

### 顺带量到的一格（对本批有利，以前没量过）

段数现量：`本分支=67` 全部落在 `origin/main=90` 里 ⇒ **落地时链并集 = `origin/main` 那 90 段，本批不再往 `check` 链里加任何一段**。
这与 §8.206"公开树已经带着本批的一部分"是同一件事的另一个面：本批在链这一族上的净新增已经是 0。

### 一条我自己的过程读数（写下来挡下一次）

臂 C 第一次跑的时候**根本没有判词行**：我改代码时删掉了 `const theirNew` 声明，脚本在打印判词之前就崩了（`ReferenceError`），
而我当时用 `… | grep -E "摘段|结论|不适用"` 看输出 —— grep 只挑出匹配行，**崩溃与"没有结论行"在尾巴上长得一样**。
如果那一次我照实把 C 记成"红=1 条臂通过"，就是把一条 `ReferenceError` 记成了变异验证读数。
判据：**跑完认 `exit code`，关键字只用来定位行**（§7 #164 同族；这一条今天在同一台机器上第三次撞到"管道之后的码不是被测命令的码"）。

### 8.211 第 2 项（`verify:selfhost-stack` 全跑现量）**读数已经在手上了**：12:44 那趟跑完、rc=0，而我把它记成了"只是给 caddy 装置当底座"（2026-10-05 14:0x）

`/tmp/heyta-keep-verify.log`（65 行，起跑 `2026-10-05T04:43:10Z` = 本地 12:43）逐段读数：

| 段 | 现量 |
|---|---|
| 环境 | **起跑时负载=8.59**（≤12）⇒ 这趟是有效窗口，不是"等满 exit 3 记环境无效"那一档 |
| 镜像 | `VCS_REF=673e6a43`，且脚本自己断言"被验镜像的 revision == 当前 HEAD" |
| 镜像内产物自洽 | 挂载 `/app/` 与产物声明一致；`index.html` 的 5 个本地引用 + manifest 的 15 个文件全部存在；4 个组件数据 URL 都落在 SW 前缀 `/app/widgets/` 内；246 个 `--ht-*` 定义对得上产物里全部**无兜底**引用 |
| 镜像依赖树 × 许可证门禁 | 145 条 = 门禁扫描集 126 + 逐条登记的镜像独有 16 + 本仓库自己的包 3（无解释 0 · 非宽松 0 · 声明对不上 0 · 失效登记 0）；两个独立载体对上（磁盘枚举 145 ⊆ npm 自写 lock 非 dev 158，差集 13 全是 optional 平台变体）；G-53 那一族 14 枚平台受限条目逐条过同一套权威 |
| 起栈 | `project=heyta-selfhost-verify` · 端口 `127.0.0.1:1900` · 服务图对账：默认 3 个（未动）/ 带 override 4 个（`+supersync-migrate`） |
| 入口命令对账 | R1–R9：扫描集 7 份 + 故意排除 1 份 + 非抄件登记 6 份，命中 9 条；R8 全仓普查 12 枚逐枚在表里（未登记 0） |
| `/health` 与迁移 | D-3 对账：一次性容器 `exited(0)` · 应用侧 `RUN_MIGRATIONS_ON_STARTUP=false` · 带外恢复 flag=true · **已应用 42/42** · 悬挂 0 · 重复完成 0 · 回滚痕迹 5（设计内） |
| 界面挂载 | 服务端日志：`共享 UI 挂在 /app/（来自 /app/web-dist）` |
| 真浏览器三条判据 | **3 passed**：S1 `/app/` 打开就是应用且 SW 注册在 `/app/` scope · S2 注册并登录、凭据落在本机自己那台服务器 · S3 建一条任务同步出去、**全新设备只能从服务端读到它** |
| 截图 | `FRESH=4/4`，四张都标"本次的" |
| 收工 | `rc=0 signal=- 锁已释放` |

四张图逐张看过（`s1-app-loaded` / `s2-signed-in` / `s3-device-a-synced` / `s3-device-b-recovered`）：
界面是**中文真应用**（rail + 收集箱 + AI 两面 + 四象限），账号是这趟的一次性 `selfhost-5490291-1@example.test`，
任务是 `selfhost-task-5490291-2` —— **同一个进程级 nonce 串在三张图上**，而 B 那张是全新设备读到了 A 写的那一条。
主蓝命中、无空白屏、无报错屏。三张改动的 PNG 随本节一起入库（它们就是这趟的证据，不入库等于证据只活在 `/tmp`）。

### 边界（四条，别读多）

1. 🔴 **平台是 `linux/arm64`，不等于发布 workflow 钉的 `linux/amd64`** —— 这句是脚本自己印的。
   这趟证明的是"外人在自己机器上 build 出来的那一枚能跑"，**不构成**对 amd64 发布物的运行证据。
2. **caddy 那一腿不在这趟里**（`verify-selfhost-stack.sh` 刻意不起 caddy）。bundled caddy 的证据是 §8.201 那枚装置的 18 臂，
   而它用 `DOMAIN=:80` ⇒ **不覆盖证书签发**（§8.202 量到的是"签不出来时三枚容器全绿"那个失败形状）。
3. 跑在 `673e6a43`。`673e6a43..HEAD` 里**被验面改动 0 个文件**（现量：`git diff --name-only 673e6a43..HEAD -- server apps packages scripts e2e` 去掉截图后计数=0），
   中间那十笔全是 docs 与 `research/tools` ⇒ 这趟对**当前分支的产物面**仍然成立。
   ⚠️ 但它不是"落地后装的是这一批产物"的证据 —— 那一格在任务 #50（落地后在载体那棵树上用同一把尺复跑）。
4. `--keep` 留下的栈与一次性凭据文件：现量都是**已清**（`docker ps -a --filter label=…=heyta-selfhost-verify` 空、
   `/var/folders/…/heyta-selfhost-env.WeDWEk` 不存在）。随机凭据不留在 `/tmp`。

### 过程账（这一条是写给我自己的）

我**跑那趟的目的是给 caddy 装置当底座**，之后引用它时只用了"栈还在"这一面，就没再回去读它的 verdict 行 ——
于是第 2 项在我这里挂了整轮的"未拿现量"，而它其实早就绿了。
**一趟运行的用途不等于它的读数**；"没去读"和"读出来没通过"在任务清单上长得一模一样。
这和 §7 元规则第 1 条（先怀疑探针）是同一族的另一面：**也要怀疑自己没读的那几行**。

### 8.212 本批**未公开的差集只剩 14 个文件，且一个产物面文件都没有**（2026-10-05 14:0x，这条改掉了我对"落地"的两个旧说法）

现量（`git merge-base HEAD origin/main` 之后直接数）：

| 读数 | 值 |
|---|---|
| merge-base | `c171b06f`（今天 **10:57** —— 两周前那种"差 500 多笔"的基线感已经不适用了） |
| 本地独有 / 公开独有 | **33 笔 / 1198 笔** |
| 本批相对公开基线的净差集 | **14 个文件**：2 份文档 + 3 张截图 + 9 枚 `research/tools/*.mjs`（其中 6 枚公开树里根本没有、8 枚同名但内容不同） |
| 差集里的 `server/` `apps/` `packages/` `scripts/` 文件 | **0 个** |

⇒ **"落地"这件事的内容，现在就是文档 + 工具**。镜像、compose、`/app/` 托管、i18n 那四条对外词条、
`scripts/verify-selfhost-stack.sh`、许可证与迁移那些**都已经在公开树里**了（§8.206 说的"部分已公开"，今天量到了"部分"到底是多大一块）。

### 但它**不**推翻第 8 项的顺序 —— 理由要换一句说

第 8 项"落地之后才起 `reinstall:all`"原来记的理由是"本批改了 `apps/web`，排在落地前会装完即过期"。
现在量出来 `apps/web` 不在差集里，容易被读成"那就不用等了"。**不能这么读**：
`reinstall-all.sh` 装的是**它跑在哪棵树上**的那份源码，而主检出那棵树要等快进 + 落地才拿得到这些产物改动。
所以顺序不变，变的是原因：**不是"改动还没提交"，是"目标那棵树还没拿到它们"**。

### 落地那趟会第一次跑到 23 段本批从没执行过的门禁；四段最可能咬人的已经走过代码

链的并集现量：`origin/main=90` 段、`本分支=67` 段，且**本分支 67 段全部 ⊆ 公开那 90 段**（只在本分支里的 = 0）
⇒ 载体不会往 `check` 链里加任何一段，但会把公开侧那 **23 段**第一次带进本批的树。

按"扫描集与本批差集有没有交集"逐段筛，最可能咬人的四段做了定向代码走查（**读代码，不是实测**）：

| 门禁 | 它实际扫什么（`git show origin/main:scripts/…` 现读） | 与本批 14 枚差集的交集 |
|---|---|---|
| `check:md-tables` | 一份**点名的** `FILES` 白名单（`docs/plans/calendar-*`、`docs/research/trash-and-archive…` 等），不 glob 整个 docs | 无（本批那两份文档不在名单里） |
| `check:doc-citations` | 不带参数时只扫 `docs/research/performance-hotpaths-audit.md` 一份 | 无 |
| `check:verify-script-copy` | `scripts/` 目录 + `packages/i18n/dist` | 无（差集里没有 `scripts/` 文件） |
| `check:public-facts` | `server/src` + `packages/shared-schema/dist` | 无 |

⚠️ 这张表**不构成"落地那趟不会红"**：它只说"这 23 段里最可能因本批而红的四段，扫描集碰不到本批改的文件"。
其余 19 段（`check:detail-pane-*` 四段、`check:legal-*` 三段、`check:shell-*` 三段、`check:op-log-semantics`、
`check:apk-freshness` 等）红不红取决于**公开侧自己在那 1198 笔上的状态**与本批树的合并 —— 那正是 §8.205 那张
归属表与任务 #26 的两树 A/B 要回答的：**红了要能说出"这一段在纯公开基线上也红"**，而不是替它消红。
另外提醒一次链的形状：`check` 是 40+ 段 `&&` 串，**一次运行只暴露第一个红**（§7 那条），所以"载体上跑完整 check"
那一趟的输出要留全文，不能只看最后一行。

### 8.213 落地那趟**唯一**的冲突是我们自己那本台账，而它会让载体退 2 白烧一个窗口——所以把那 50 行原样搬进本分支（2026-10-05 14:0x）

不需要窗口就能量的一格：`git merge-tree --write-tree origin/main HEAD`（纯对象库，不动任何工作树）——

```
rc=1  CONFLICT (content): Merge conflict in docs/research/self-host-distribution-audit.md
```

**整个合并只有这一枚冲突**，其余全部自动合（连 §8.206 第 3 条那格 Dockerfile 纯注释分叉都没冲突）。
两侧差异量清了：公开侧末节 `### 8.182`，本分支 `### 8.212`；冲突块两侧**都是纯追加**，
`§8.NN` 节号交集 = **0**（不存在重复编号）。

### 但"取本分支侧"那一族会**停下来要人判**，而不是静默删

载体第 4 族的守卫是结构粒度的（文件头写着：main 那份的每一个 `^#{2,6} ` 标题与每一个 `§8.NN` 都要能在本分支那份里找到，缺任何一个 ⇒ 那是别人写的一节 ⇒ 退 2）。
按标题集合现量比一遍：公开侧 218 节 / 本分支 262 节，**只在公开侧的恰好一节** ——

```
## 9. 交还一条现场：`reinstall:all` 的 mac 段不是"慢"，是不朽（2026-10-04 06:0x 现量）
```

🔴 所以落地那一刻载体**必然退 2**：守卫是对的（它挡的正是"把别人的账整片抹掉"，
这条红线本批不破），但它烧掉的是一个 15 分钟连续静默的窗口，而窗口现在是最贵的东西。

### 处置（**这一格已被 §8.215 推翻**）：把那 50 行逐字搬进本分支

搬之前先量过它安全：块内 `### 8.NN` 标题数 = 0（不会造出重复编号），只有一个 `§8.9` 交叉引用（本分支那份里在）。
本批不改它一个字 —— 改的是**位置**，不是内容。搬完之后第 4 族的集合差应为空，
载体就会走"取本分支侧"这条自动解，而不是停下来。

⚠️ 口径写清楚，别让下一位误读：**这里做集合差是预检，不是判据的第二份实现** ——
"能不能自动解"这件事的判据本体仍然只在 `selfhost-merge-carrier.mjs` 第 4 族里；
本节那条 `comm -23` 只是在窗口之前先回答"要不要为这一格留人"。

### 8.214 不需要窗口的归属预检：本批那 14 枚差集文件能过的门禁，现在全绿（2026-10-05 14:0x）

第 1 项的关闭判据是"任何红都要逐条归属到非本批"。窗口之前能做的不是等，是把**本批自己可能造成的红**先排掉。
差集是 2 份文档 + 3 张截图 + 9 枚 `research/tools/*.mjs`（§8.212），所以只跑**射程真覆盖这些路径**的五道：

| 门禁 | 为什么它可能咬本批 | 现量 |
|---|---|---|
| `check:docs` | 今天新写十来节，带路径/节号/锚点引用 | rc=0（无死链、无"本机有仓库里没有"、无失效章节引用与锚点） |
| `check:gate-wiring` | 新增 `selfhost-main-fastforward.mjs` 这类工具，链与门禁定义要对得上 | rc=0 |
| `check:claims` | 对外/平台状态句 | rc=0（6 个平台都在 roadmap 找得到条目） |
| `check:docs-voice` | 台账与 runbook 的措辞表 | rc=0（扫 `site.*` 1018 条，豁免自托管 120 条） |
| `check:script-snapshot` | 新脚本入 `research/tools` | rc=0（31 个脚本自快照在位；它只管 `scripts/`，所以这一格是"确认不覆盖"而不是"覆盖到且绿"） |
| `check:selfhost-entry-command` | 本批改过 runbook 的入口段 | rc=0（R1–R9 全过） |

🔴 这张表**只回答"本批有没有自己带进红"**，不回答"载体上完整 check 会不会绿" ——
后者要跑在合并树上，且公开侧那 23 段（§8.213）第一次进本批的树，红了按 #26 的两树 A/B 归属。
`check:script-snapshot` 那一格尤其要说白：它扫的是 `scripts/`，**射程不含 `research/tools`**，
所以它的绿对本批新工具没有任何证明力 —— 写进表里是为了不让下一位把"五道全绿"读成"新工具被门禁看过"。

### 8.215 §8.213 的因果是错的：载体那一族**早就是无损并集**，而我凭文件头的旧措辞判它"必然退 2"（2026-10-05 14:1x）

写完 §8.213 之后去读被调本体，读到的是 `research/tools/selfhost-audit-union.mjs`：

- `unionAudit()` 的产出 = **本分支那份 + main 侧"base 没有、本分支也没有"的行**，
  并自带一条 `<!-- ↓↓ 载体并集：以下 N 行来自 main 侧… -->` 哨兵；
- `unionAuditVerdict()` 只在**四类**事上停下来：产出仍含冲突标记 / 丢了 main 侧新增行 /
  丢了本分支行 / 混入两侧都没有的行。"main 有一节本分支没有"**不在**停下来之列 —— 那正是它要并进去的东西。
- 文件头第 4 族那段"取本分支侧 + 缺节就退 2"讲的是**旧规则**（那段自己写了"旧规则只是 die（不背锅），
  本模块把它做成能落地"），我读的是那一段，没读实现。

⇒ 三条更正：
1. **落地不会因为这一格退 2**，§8.213 那句"必然退 2、白烧一个窗口"不成立。
   `merge-tree` 那部分读数仍然有效（唯一冲突=这本台账、两侧纯追加、`§8.NN` 交集 0）—— 它证明的是
   "这一格有自动解可用"，不是"要停下来"。
2. **搬进来的那 50 行已撤回**（本节写之前撤的）。撤回的理由不是它有害：
   `mainOnly` 按"main 有而 src 没有"取行，所以复制一份**不会**被并集重复；
   但 main 日后若编辑那一节，旧行会留在 src 里、新行会被当 main 独有追加 ⇒ 造出一节两具，
   而这是**我自己给自己造的冲突面**。多余且带未来债，就走。
3. 载体文件头那段旧措辞同时改掉，指到模块名上（判据本体只有一处，下一位不必再踩）。

🔴 一般规律（本仓库第 N 次同一面目）：**"它会不会做 X"要读被调函数本体，不能读调用方对它的描述**。
文件头那段不是假话，是**历史**——它记的是"以前怎么做、为什么换掉"，
而我把换掉之前的规则当成了现行规则，据此做了一笔真实提交。判据形状没错（集合差确实为 0），
错的是我以为不搬就会停下来。**结论正确、因果错误**这种读数最不容易被复查出来，因为它看起来一切自洽。

### 8.216 那本台账的并集判据**先前一条变异臂都没有**；补了 12 臂自检 + 六臂二阶对照，其中一臂第一次活得比判据还久（2026-10-05 14:2x）

§8.215 纠正了"这一族必然退 2"之后，剩下一个更硬的问题我没答过：
**这条并集判据自己能不能红？** 现量（不是印象）：

```
grep -rl "selfhost-audit-union" → 只有 4 个文件；`unionAuditVerdict` 的出现处 = 本体 + 载体 772 行
```

也就是说：文件头写着"可拿合成样本离线变异"，而**全仓没有一处真跑过变异**；
唯一的执行路径是"落地时真落到一次台账冲突上"。这是一条只能在生产事件里第一次生效的判据 ——
本仓库为这一类东西付过多少次学费不必再数。

补的东西按 `selfhost-text-merge.mjs --selftest` 的既有形状做（没有另立一套）：

| 臂 | 咬的是哪条断言 | 认领的理由 |
|---|---|---|
| S0 | control：合成三份走并集 | verdict 必须 `null` |
| S1/S6 | `lostMain` | 「丢了 main 侧新增」 |
| S2/S7 | `lostSrc` | 「丢了本分支侧」 |
| S3 | `invented` | 「混入了两侧都没有」 |
| S4 | `markers` | 「仍含冲突标记」 |
| S5 | **新增**的 `missingBanner` | 「告示牌」 |
| R0/R1/R2/R3 | 真三份（`merge-base` × `origin/main` × `HEAD`） | null / 摘一条真独有行必须响 / 标题与 `8.NN` 缺 0 |

真三份读数（这条同时是 §8.215 遗留的那格"落地不会吞别人的账"的**直接**证据，不需要窗口）：

```
输入行数 base=10826 main=10878 src=12097（merge-base=c171b06f）
stats={"mainOnly":50,"srcOnly":925,"lostMain":0,"lostSrc":0,"droppedBase":0,"invented":0,
       "markers":false,"mainHeadings":548,"srcHeadings":610,"extraMainHeadings":0}
verdict=null ⇒ 可以写盘（无损并集） · main 侧标题 548 枚缺 0 · §8.NN 184 个缺 0
```

🔴 **两件事只有这条读能给，而我差点没看见它们**：

1. `extraMainHeadings=0` —— main 那 50 行**不构成一整节**。上一轮我按"别人加了一节"的形状防它，
   真实形状是"别人往已有小节里加了 50 行"。行粒度那一族（§8.213 记的"旧措辞从来没有过 blob"）
   与节粒度那一族在这一轮**都不成立**，只有逐行集合差成立。防错了形状不会导致错判，
   但会导致错判据（我若按"有独有一节"写臂，这轮就会假绿）。
2. R3 因此**没有对象**。第一版我把这条臂的期望写死成"必须响"，于是它判红。
   这不是判据坏，是臂把"总有对象"写进了期望。改法是让**适用性进读数**：
   `OK R3 …（期望 "无对象（本轮 main 相对本分支在该粒度上没有独有内容）" 实得 同）` ——
   读的人一眼看见这轮它没咬到东西，既不假绿也不假红。

**二阶对照里活下来的那一臂**（`research/tools/selfhost-audit-union-mutants.mjs`，六条各改坏一条断言）：

```
第一趟：M1✅ M2✅ M3✅ M4✅ M5❌(rc=0 红臂 0) M6✅ —— 对照 6 条 · 未转红 1
```

M5 是把"冲突标记"那条检测摘掉，S4 却仍然响。原因值得单独记：
S4 塞进去的 `<<<<<<< HEAD` **两侧都没有**，于是抓它的是 `invented` 而不是 `markers` ——
**"能红"和"红在该红的那一条"是两件事**。八条牙臂原先统一判 `!== null`，
这就是那种"看起来有牙、其实牙齿是别人的"的臂。改法：每条臂**认领自己那条理由字符串**
（`fires(text, reason)`），改完第二趟 6/6 全转红，M5 精确打回 S4。
📌 一般规律：**牙臂的期望要写成"因为什么而红"，不是"红就行"**；
二阶对照（改坏判据、看臂是否各自转红）才是这个的唯一裁判，一阶"臂全过"回答不了它。

消费者的接线照第八/九族同一处挂法：载体在解台账那一族**之前**跑 `--selftest`，
判的是输出内容（rc + 无 BAD + `臂数 ≥12 且拒绝类 ≥7`），不是只看 rc。
这一层闸门的三腿读数是拿真输出复放的（不是造的句子）：真绿 ⇒ PASS；
真红（M5 那次运行的 stdout）⇒ REFUSE 并指出 `BAD S4 …`；把臂数行删掉 ⇒ REFUSE。

边界（别读多）：
- 这组证据答的是**台账这一族**在 `c171b06f × origin/main × HEAD` 这一对输入上无损；
  落地那一刻两侧都会变，载体每次重算都会用当时输入现跑一遍 —— 这一条不能提前预支。
- `check:script-snapshot` 只扫 `scripts/`，这枚新自检住在 `research/tools/`，
  它的绿**不覆盖**这里（§8.214 同一句边界，再说一次是因为这次真的新增了文件）。
- `pnpm check` 里没有一条门禁跑 `research/tools/**` 的自检；本节的自检目前**只有载体那一道闸门消费**。
  把它接进 `check` 链要单开一笔（载体在 /tmp、干净检出没有那棵树），不当成已做。

### 8.217 落地等的那三格，14:3x 现量：脏 33 行没变，**未推的提交从 1 笔涨到 3 笔** —— 授权那条 ff-only 不是"还没到时机"，是**永远不会自己到**（2026-10-05 14:3x）

看守（pid 37271，`selfhost-main-fastforward.mjs --step=180 --cap=240`）第 14 轮的读数：

```
主检出 porcelain = 33 行            （14:13 起一直是 33–34，没有收敛趋势）
main..origin/main = 594 笔（公开侧领先）
origin/main..main =   3 笔（本地未推）    ← 14:0x 现量还是 1 笔
git cherry origin/main main = 三笔全是 `+`（公开侧没有同内容的补丁）
```

三笔未推的都是本机两条并行会话在 13:44 / 14:0x / 14:20 提交到本地 `main` 的，路径与本批**零重叠**：

| 提交 | 碰的东西 |
|---|---|
| `3281ebb2` | `research/tools/calendar-line-*`、`e2e/tests/calendar-day-en.spec.ts` 等 27 文件 |
| `adfc7ec5` | `research/tools/r17-reshoot-*`、`calendar-line-commit-plan.sh` 等 9 文件 |
| `ef4f4566` | `docs/plans/calendar-profile-handoff.md`（56 行交接） |

🔴 **这条读数改掉的是"等"这个动作本身**。14:0x 我把那笔未推提交登记成"等所有者处理"，隐含的假设是
"这是一次瞬时事件，处理完 ahead 就回 0"。六分钟内它变成 3 笔，而且看守的 33 行脏也一点没少 ——
两个方向各跑：**本地 `main` 是一条正在被日常使用的分支，公开 `main` 是另一条**。
"等主检出干净 + 落后归零"这个前提不是慢，是**结构上不成立**；
再等下去只会让 ahead 继续涨。

所以落地的下一步需要的不是窗口，是一次**由所有者做的裁决**（三选一，本工具与本线一条都不替做）：
① 把这三笔推上去（或先并进公开那 594 笔再推）；② 把本地 `main` 重置到公开那一笔，
这三笔另找落点；③ 明确"本地 `main` 与公开 `main` 各是一条线"，那 §8.16 那套"载体前进 main"的落地口径要重写。
每一条都会动到**别人已提交的工作**，而授权原文只覆盖"主检出干净时 `git merge --ff-only origin/main` 这一条命令"，
ahead>0 时它按设计就 refuse（看守每轮如实打 ⏳，没有降级、没有代做）。

📌 可迁移的一条：**"等一个瞬时事件"和"等一个稳态"在输出上长得一模一样** —— 看守每轮打的都是
"脏 33 行 / ahead=1"和"脏 33 行 / ahead=3"，如果不把 ahead 当**趋势**数（而不是当归零条件等），
就会一直等下去。登记等待时要写清这一格**由谁、在什么动作下**消掉；答不出来就不是等待，是死等。
（本线 §7 第 82 条讲"非空白不等于对"，这条是它的git版：读数正确不等于读数在回答你的问题。）

### 8.218 "实时同步"这一维**不是**对外错话：逐条核完那条隐私披露的三个断言，顺手照出两条仓库内部的过期"没有 X"句（2026-10-05 14:3x，负载 65 ⇒ 这一格只能是代码读）

G-70 挂的是"WS 升级从未经验 bundled Caddy"。查它之前先问了一句更前置的：**对外有没有已经在说一件还没成立的事**。
现量（全仓 `实时同步|realtime sync`，排除生成物与 sourcemap）只命中三处，唯一对外那一处是法务条款：

| 位置 | 那句话在断言什么 |
|---|---|
| `packages/legal/src/documents/minors.ts:127`（落地页 `/legal/minors/` + 服务端对外页共用这一份真源） | "**在你同意联网、并且开启同步之后**，Web 端才会在你的浏览器里注册 Service Worker 并建立实时同步连接，两者都是持久连接 —— 服务器因此能看到『该账号此刻在线』这一事实。**没有那份同意，这两件事都不会发生**" |
| `packages/app-host/src/privacy-consent.ts:11` | 不是现状 —— 那是**缺口陈述**（"此前…先于任何同意发生"），第一眼看成矛盾，读完那一整句才否掉 |
| `packages/sync-client/src/realtime.ts:2` | 模块自述，不对外 |

🔴 注意那条不是功能承诺，是**隐私披露**：它承诺的是"我们不收集"那一侧，所以错话方向是**说过头**（声称有闸门而实际没有），比"承诺有功能而没做"更难被发现 —— 没人会去测一条本来就不该发生的连接。逐条核：

1. "同意之后才建 WS" ⇒ `apps/web/src/features/sync/store.ts:253` `if (!privacyConsent.networkAllowed()) return;`，
   且注释明写"WS 不经 `window.fetch`，带闸的那层罩不到它 —— **这一处就是它唯一的闸**"，并排在 dispose 之后（撤回同意要真的断连）。
   移动端同一道闸在 `apps/mobile/src/sync/realtime.ts:175`。
2. "Web 端会建立实时同步连接" ⇒ `store.ts:294` 真走共享接线 `createHostRealtimeClient()`，不是"零件都在、没人接"那个旧形状。
3. "Service Worker 也在同意之后" ⇒ `apps/web/src/features/privacy/startup-network.ts:22`（"没同意就不调 `registerServiceWorker`"）。
4. Caddy 那一侧不构成拦截：`server/Caddyfile:21-30` 是**无路径匹配器**的 catch-all `reverse_proxy`，
   而 `:48-52` 的日志过滤专门处理 WS 的 `?token=` —— 写这段的人知道 WS 从这里走。
   ⚠️ 这句是**读代码不是实测**：G-70 那一格（一次真 upgrade 真的穿过 bundled Caddy 落到 supersync）仍然开着，负载 65 现在跑它就是拿环境无效换读数。

⇒ **裁决：这条披露不是错话，不动。** 它也不归本批改（写集外，见下）。

顺光照出的两条**仓库内部**过期句（性质与上面第 2 条相反 —— 是"没有 X"型句子）：

- `apps/web/src/features/sync/store.ts:211`：**"没有任何地方 `createRealtimeClient()`"** —— 现在有两处宿主在接。
- `apps/web/src/features/sync/store.ts:250`：**"全仓只有这一个 `createHostRealtimeClient()` 调用点（已 grep 确认）"**，
  而紧接 `:251` 立着一条依赖这个"只有一个"的纪律（"新增第二个构造点时必须同样调它"）。第二处就在
  `apps/mobile/src/sync/realtime.ts:107`。两份 `realtime-wiring.spec.ts`（web 与 mobile）文件头也还抄着同一段旧话。
  ⚠️ 这条比上一条例子更值得记：那句"已 grep 确认"带着**取证凭证的样子**，而它已经过期 ——
  凭证证明的是**当时**，不是**现在**（AGENTS §9 为同一形状写过"'没有入口'这句话的保质期取决于别人什么时候补上它，所以它旁边必须写核对的日期" —— 这里连日期都没有）。

归属（现量，不是印象）：`git diff --name-only $(git merge-base HEAD origin/main)..HEAD` 里
`apps/web/src/features/sync|apps/mobile/src/sync|packages/legal` 命中 **0** ⇒ 这三处都在本批写集外。
本批**不改、也不加进写集**：理由与 §8.137 对 `packages/i18n` 那条同一个 —— 落地窗口前不把合并面撑宽一枚文件。
登记给出：realtime/移动端那条线与法务那条线（后者若要动 `minors.ts` 要走它自己的版本与同意指纹纪律）。

### 8.219 三格"窗口一开才会被烧掉"的未知，这轮换成读数；两格明写**没做以及为什么不做**（2026-10-05 14:3x，负载 65 ⇒ 只能做不占机器的那部分）

| 格 | 现量 | 复现 | 性质 |
|---|---|---|---|
| §8.216 那枚新闸门**喂完整 SHA** 走不走得通（载体用的是 `mainSha`/`srcSha` 不是 ref 名） | ✅ `臂数 12（拒绝类 7）红 0`，`mainSha=564ad047d718 srcSha=e1ba2e1a5dcf` | `HEYTA_MAIN_REF=$(git rev-parse origin/main) HEYTA_SOURCE_REF=$(git rev-parse HEAD) node research/tools/selfhost-audit-union.mjs --selftest` | 实测 |
| 第 2 项那趟 rc=0 还**现不现**（自那以后本分支又落了 4 笔） | ✅ 产品面改动 **0**：`git diff --name-only 673e6a43 HEAD -- apps/web server/src server/docker-compose.yml server/Caddyfile e2e/selfhost-stack` 空；唯二变化是那三张截图本身 | 同上 | 实测 |
| 落地口径在"本地 main 与公开 main 是两条线"那一档下**要不要新代码** | ✅ 不要：载体基线本就有旋钮（`selfhost-merge-carrier.mjs:156` `HEYTA_MAIN_REF`），公开侧有 `HEYTA_LAND_REMOTE_MAIN`（`selfhost-land-main.mjs:337`）；唯一硬编码是 `MAIN_REF='main'`（`:47`）= 主检出那个分支名，本来就该是它 | 读码 | 读码（这一格的答案只决定"要不要写"，不决定任何对外事实） |

### 两格明写"没做"，写清楚是为了让下一位不必重新怀疑

1. **`research/tools/**` 的自检在 `pnpm check` 链里没有消费者。** 本批在这些目录里落了十几枚判据，
   现在只有合并载体那几道闸门消费其中几枚（第八/九/十/十一族 + §8.216 这一枚）。
   补法已经想清楚并且**故意不写成手写清单**（这条线第五次栽的坑就是手写枚举，见主检出 `3281ebb2`）：
   按**存在性**扫 `research/tools/*.mjs`，凡是文件里出现 `--selftest` 字样就必须跑它并判输出内容（红臂计数 + 臂数行），
   一条都不许"找不到就跳过"；阈值由被扫文件自己打印的臂数推导。
   🔴 **现在不做的理由不是"以后再说"**：加一条链段要动根 `package.json` 的 `scripts.check`，
   而那是本批**唯一剩下**的合并重叠文件；§8.137 对 `packages/i18n` 用的是同一条判断 ——
   落地窗口前不把合并面撑宽一枚。排在落地之后，与 G-62、③"静态腿拆进链"（§8.164）同一批。
2. **G-70（一次真 WS upgrade 穿过 bundled Caddy）没有写成脚本。** 想过的形状是
   复用 `e2e/selfhost-stack/selfhost-web.spec.ts` 里 S2 之后那条**已注册、已同意、已配好凭据**的真会话，
   在 Playwright 侧收 `websocket` 事件并要求 URL 落在同域 `/api/` 上。
   本轮**不写**，理由是硬的：这条判据要两次整套跑才配被登记为"有牙"（正向 + 注入把它打红），
   而现在负载 65，跑一次就是拿"环境无效"换一张**未经反证**的绿条 —— 那张绿条比没有更坏，
   它会让人以为 G-70 已闭合。先决条件写在这：谁写这条判据，必须同一趟里交注入腿，
   并且把"摘掉 consent 同意 ⇒ WS 不建"（`store.ts:253` 那道闸）也算作一条臂，
   这样它同时回答 §8.218 那条隐私披露的行为面（现在只证到代码面）。

### 8.220 外人那一页的**事实面**普查：九条可核断言逐条对到代码/文件本体，零错话；查出的是"没有一条门禁守着这些散文"这一族缺口（2026-10-05 14:4x，负载 65 只能做这一类活）

第 2 项的现量已到手（§8.211），落地卡在人的裁决上（§8.217），这一轮能推进目标的只剩目标后半句：
**"停掉对外错话"**。做法不是再读一遍措辞，是把 `docs/runbooks/self-host.md` 里**每一条能被代码否证**的断言
逐条对到**本体**（不是对到文档自己的注释 —— 这条纪律本轮真的抓到一次，见最后一段）。

| 对外那句 | 核对的本体 | 判 |
|---|---|---|
| "目前没有发布任何 heyta 的服务端镜像"（§0 第 1 条 + §8 表首行） | `.github/workflows/heyta-server-image.yml` 的**真 `on:` 块**：`push: tags: ['v*.*.*']`，全文**没有** `workflow_dispatch` | ✅ 成立 |
| "tag 三件套写了但没启用 / 没有可钉的版本号" | `git tag -l 'v*.*.*'` = **0** | ✅ 成立 |
| "拦着发布的是两个可核对的事实，不是一个 `if: false`" | 第二个事实 = `guard` 步骤在 `vars.GHCR_NAMESPACE` 未设时 `exit 1`（`:89-102` 原文） | ✅ 代码面成立；**"仓库 Settings 里现在没有这个变量"这一条本轮没法复核**（那是一次对外读），沿用 10-03 那次现量 |
| "`JWT_SECRET` 至少 32 字符，缺了或太短直接抛"（§2） | `server/src/auth.ts:17` `MIN_JWT_SECRET_LENGTH = 32` + `:32-42` 两条 `throw` | ✅ |
| "`PUBLIC_URL` 的默认值就是 `http://localhost:1900`"（§2） | `server/src/config.ts:425` ``http://localhost:${config.port}`` | ✅ |
| "公网 host 的 `PUBLIC_URL` 必须 https（会抛）；局域网/回环的 http **放行**"（§2） | `config.ts:326-332`（`ADR-0012 §4.2`：禁令只对公网，与 iOS ATS 口径一致）+ `:428` 起那段 | ✅ 两句都对 |
| "`CORS_ORIGINS` 默认是上游演示站，而且 `env.example` 里**未注释**，`cp` 完就生效"（§2 表） | `server/env.example:199` = `CORS_ORIGINS=https://app.super-productivity.com`，行首无 `#` | ✅ |
| "应用自己只绑 `127.0.0.1:1900`，直接 `http://IP:1900` 从局域网连不通（不是防火墙，是它只听回环）"（§6） | `server/docker-compose.yml:114` `'127.0.0.1:${SUPERSYNC_HOST_PORT:-1900}:1900'` | ✅ |
| "备份脚本在 `server/scripts/backup.sh`，`BACKUP_DIR` 默认落 `$SERVER_DIR/backups`"（§7） | `backup.sh:32-33` `SERVER_DIR="$(dirname "$SCRIPT_DIR")"` / `BACKUP_DIR="${BACKUP_DIR:-$SERVER_DIR/backups}"`，`:51` 确实用 `pg_dump` | ✅ 整句成立 |

⇒ **本轮没有发现新的对外错话，所以一个字都没改这份 runbook。** 这是"查过且是干净的"，不是"没查"。

🔴 **查出来的缺口是另一类**：上面九条**没有任何一条**由门禁钉住。
现有几条各管一段、都管不到这些散文事实 ——
`check:selfhost-entry-command` 管**命令抄件**、`check:server-env-forwarding` 管**键能不能到达容器**
（它文件头立的就是"文档写了 ≠ 旋钮有效"那一族），`check:docs` 管**死链**，
`check:image-build-args` 管 **image 变量形状**。
"默认值是 X""至少 N 字符""只听回环"这类**取值断言**漂了，五道门禁一条都不会响。
这和本仓库已经登记过的两枚同族：G-66（README 里的行号引用无门禁）、
§8.137 那条"指南页能读到 `/app/` 这个词"没有判据 —— 三条合起来是**一条一般规律**：
**文档里凡是"能被子系统否证"的句子，都要有一条指向那个子系统的对账**，否则它只是一次性正确的快照。
拟法与 §8.219 第 1 条同一批做（落地后，避免动根 `package.json`）：取值类断言按"文档里的字面 ⇒ 去本体取一次 ⇒ 逐字比"写，
判据的输入只能是被调本体（配置文件 / `env.example` / workflow 的 `on:` 块），不许再抄一份进测试。

顺带一条**方法**收获：核对"拦着发布的是两个事实"这句时，我一开始读的是文件头那段注释 ——
它把 `on:` 写成 `push: tags` 并特意说"刻意没有 `workflow_dispatch`"。
按 §8.215 立的纪律（断言要读被调本体，不能读调用方的描述），我回去看了**真 `on:` 块**：
确实是 `push: tags: ['v*.*.*']`，`workflow_dispatch` 只出现在注释文字里（`grep` 命中第 12 行，不在 `on:` 段内）。
这次注释与本体一致；**但结论只有在读了本体才算成立** —— 而这份文件恰好是"错一句话就会在别人没拍板时把镜像推出去"的那种。

### 8.221 G-49 的"判据能红"那一半**在仓里根本不可复现** —— 补成常驻七臂；第一臂打错了对象，因为没先读那条判据的期望值从哪儿来（2026-10-05 15:0x，负载仍高，只能做这类不占 docker/模拟器的活）

第 5 项（G-49）当初写的是"让它**进对账且判据能红**"。核对现量时两半并不对称：

| 那一半 | 现量 |
|---|---|
| 进对账 | ✅ 真的进了：`packages/i18n/src/locales/{zh-CN,en}.ts` 那两份词条抄件在 `check:selfhost-entry-command` 的扫描集里（门禁的 R8 note 每趟现量打印枚数），对外文档 `docs/runbooks/self-host.md` 也受 R3/R4/R5 管 |
| 判据能红 | 🔴 **在仓里没有可复现装置** —— §8.99 那趟"能红"的读数靠 `/tmp/g85-arm.mjs` 拿到，装置没入库，一次重启就把臂带走了；而 `research/tools/selfhost-entry-command-arms.mjs` 文件头那句"R1–R7 各自有别的臂"指的是**当时那个 /tmp** |

⇒ 那是一句**只在当天成立的声明被抄进了长期文件**（与 §7 第 46 条"没复现 ≠ 路径没执行"同族，但方向相反：这里是一句当时**真**成立的话，后来变成假的而没有任何一层会响）。
本轮把它补成常驻臂：A 组（R8/R9，变异门禁本体跑副本）之外新增 **T 组 T0–T7**，形状不同 ——
把门禁列出的每一份文件**原样**拷进一次性假树、`--repo-root` 指过去、**跑真门禁**，在假树里做定向漂移，每臂只数**自己那条 tag** 的红。
两种形状不许合并的理由写在装置文件头：R1–R7 要证的正是"抄件漂了会红"，把门禁换成副本就什么都没验。

现量（`node research/tools/selfhost-entry-command-arms.mjs`）：**臂数 25 · 红 0 · rc=0**；真门禁在真树上 `rc=0`。逐臂读数：

```
T0 原样假树 ⇒ R1…R7 全零          R1=0 R2=0 R3=0 R4=0 R5=0 R6=0 R7=0 · 假树 17 枚文件
T1 中文词条摘掉 `-f build.yml`     R1=1（且点名 zh-CN.ts）· 连带 R2/R3/R4/R5 各 1
T2 只改英文那份（摘 `--build`）    R5=2 而 R1=0        ← 中英只改一边只有 R5 会响
T3 中文那份整条命令删掉            R6=1                ← 非空哨兵不许静默空转
T4 build.yml 打成 bulid            R2=1
T5 指南主命令摘掉 migrate-once     R3=1
T6 点名服务那条摘掉迁移服务        R4=1
T7 验收载体 COMPOSE_FILES 摘一项   R7=1 而 R5=0
C3 四枚被变异的原文件与进组基线逐字相同（4/4）
```

T0 是这组的**承重臂**：没有它，T1–T7 的"红"可能只是假树根本够不着（探针读不到东西时，"红"和"没跑"在输出上长得一模一样 —— §7 元规则一）。

🔴 **T7 第一版打错了对象，而这不是手滑，是一条可迁移的写法纪律**：我照 T5 的直觉把变异打在对外文档上，得到
`R5=2 R7=0` ⇒ 臂红。读 R7 的实现才看清：**R7 的期望值是从对外主命令导出的**（`mainSets` 由 `EXTERNAL_MAINS` 算来），
所以只改一份对外抄件时它**不该**响 —— 那一档归 R5 管；能把 R7 单独打红的只有**载体自己**漂（`scripts/verify-selfhost-stack.sh`
的 `COMPOSE_FILES=(…)`）。改完后臂还多加了一条 `[R5]=0` 的断言：**这一轮的红必须由 R7 自己认领，不许是别的判据的连带读数**。
⇒ 立成规矩：写变异臂之前先读**那条判据的期望值从哪里取**，臂要打在那条判据唯一能命中的那一端；
  而"另一条判据同时红"要写成断言（T2、T7 都这么写），不能靠人看输出分辨 —— 靠人看就等于这条臂随时可能被一次连带红代抓，
  而代抓的臂是**零牙**的：它红过，判却的不是自己那条。

另外两条落地时的取舍：
- **分母与常量全从门禁本体现取**：假树要放哪些文件由 `file: '…'` 正则从门禁源码导出（现量 17 枚），
  三个 override 文件名与载体路径由 `constOf('BUILD_OVERRIDE' | 'MIGRATE_OVERRIDE' | 'MIGRATOR_SERVICE' | 'HARNESS_FILE')` 取；
  读不到就 `throw`（装置坏了，rc=2），不按"没有对象"过。理由写在文件头：入口命令抄件已有四份，
  **判据装置自己是第五份的话，"漂了会红"的那条判据就成了自己也不会红的抄件**。这条正是 §8.220 那批普查立的一般规律在装置自己的形状上的一次应用。
- **C3 判"与进组基线逐字相同"，不判"git status 干净"**：后者会把本批早前的未提交改动读成"装置在改真文件"（假红），
  而它要证的只是"变异没漏出假树"这一件事。第一版就是照 git 写的，改判据口径后读数 4/4。

🔴 **仍未闭合的一格（不伪装成已闭合）**：这台装置**没有链上消费者** —— 它不在 `pnpm check` 里，也不在别的门禁里，
所以"G-49 的牙"现在是**存在且可复现**，但**没人自动跑**。这与 §7 第 46 条讲的"能红 ≠ 有人跑"是同一格的另一半，
已挂在任务 #55（给 `research/tools` 的自检按存在性枚举加一条链上消费者；要动根 `package.json` ⇒ 排在落地后，理由同 §8.16 那条不碰主检出/共享文件的纪律）。
本轮不顺手挂链，是因为挂链要改根 `package.json`，而那枚文件正被主检出的并行会话占着（§8.217 的归属现量）。

### 8.222 G-70 的装置落了（接在 G-68 那台里，**不另起一台**）——本节只有装置，读数在窗口开的那一趟之后另起一节（2026-10-05 15:1x）

第 2 项的现量早就到手（§8.211），落地卡在人的裁决（§8.217），这一轮能推进"外人打开浏览器就能用"的只剩 **G-70**：
实时同步那条 WebSocket 升级**从来没穿过 compose 自带的那枚 Caddy**。
现有两块相邻装置各管一半、谁都不管这一格 —— `verify-realtime-push.mjs` 连的是 `:1900` 直连，
`selfhost-caddy-serve-check.mjs`（G-68）验的是 HTTP 三格（`/app/` 同字节、`/health` 同形、安全头只在代理那侧）。
中间那一格坏了的症状不是报错，是**界面全绿、只是永远等不到推送**。

🔴 **为什么不另写一台装置**：起 Caddy 容器的形状（compose 现读 image/端口/healthcheck/cap/卷、
一次性卷、不占主机 :80:443、停容器做归因）在 G-68 那台里已经有一份**且只有一个所有者**。
另起一份就是本仓反复登记过的"第二套实现一定漂移"那一族（§3.5 抽取那段的教训、§8.215 的教训）。
所以 WS 的腿接在第 2 步之后，复用同一枚 LIVE 容器与同一套 `claim(name, expect, got)` 形状。

接进去的六条腿，各自咬一个**不同的失效方向**（写成一条"能连上"就浪费了整段）：

| 腿 | 判据 | 它防的失效 |
|---|---|---|
| W1 | 经代理的 WS 建立、并收到服务端那条 `connected` 握手；上传前那段静默里 `new_ops` 条数=0 | 帧只单向过 · 推送是无条件发的（正例会被它骗绿 —— 反例纪律从 `verify-realtime-push` 原样继承） |
| W2 | **坏令牌**那条连接拿不到 `connected`，且被服务端以 `4003` 关掉 | 那条 101 其实是**代理自己给的**（没有这条，W1 可能只是探针打错了对象 —— §7 元规则一） |
| W3 | 另一台设备**经代理** `add`+`sync` 一条真 op ⇒ 监听端收到 `new_ops` 且 `latestSeq>0` | "连上了但通道是空的" |
| W4 | 那次升级在 caddy 日志里必须是 `?REDACTED`，两把真令牌一个都不许出现 | 这条比 HTTP 那条要紧：WS **只能**用 query 带凭据（浏览器不能给升级请求设头），而那颗令牌 365 天有效、无轮换 —— Caddyfile 的注释写的就是它 |
| W5 | 停掉这枚 caddy 后经代理连不上、直连照旧 | 把 W1–W4 的归因钉在 caddy 上，而不是 18080 上恰好坐着的别的东西 |
| 变异 | 摘掉日志 filter 那枚容器上，**WS 这条路径**也必须把泄漏抓出来 | HTTP 那条抓不到泄漏不代表 WS 也抓不到 —— 两条是不同的代码形状 |

三处形状上的取舍：
- **端点不手拼**：引客户端自己的 `buildRealtimeUrl`（`verify-realtime-push.mjs` 的第一版手拼 `/ws`，
  而真端点是 `/api/sync/ws` —— 那次红把客户端一个长期存在的 404 抖了出来）。装置手拼就只在测自己写的那个字符串。
- **上传方是真 CLI**（`apps/node-host`：经代理 `auth register` → `auth login` → `add` → `sync`，
  口令只从 stdin 进、令牌只用来连、读数里一个都不出现），并**显式**给一条与监听端不同的 `--client-id`：
  服务端广播排除上传者自己，两边同 id 时"没收到"会被读成产品坏了，而真相是探针自己把自己排除了。
- **掉臂检查按组名判，不按条数写死**：写死数字就是把当时的形状当判据（本仓为这件事红过几次），
  而这里真正会发生的失效是"某一整段被删掉或提前 return"—— 那种情况下"红 0"最危险。

🔴 **射程边界（别读多）**：① 监听端**不是浏览器** —— "浏览器里那条实时接线真会连"归 `verify:selfhost-stack`
的界面腿与 `store.ts` 那三道闸；② 这一趟是 `ws://` 明文（沿用 G-68 声明的差异 2：`DOMAIN=:<容器端口>`），
**签证书那一条不在这里证**；③ 起栈仍由 `verify-selfhost-stack.sh` 那一个所有者做，装置不另抄 `-f` 集合
（抄了就成了第五份抄件，而 R8 的漏登记哨兵正是为这个而存在）。

**状态**：装置在案，`node --check` 过、入口命令门禁 R1–R9 仍绿、`docs-link-check` 仍绿。
**读数还没拿到** —— 起跑资格由 `selfhost-verify-window-runner.mjs` 判（15:1x 现量：负载 24.66→13.36、
宿主测试锁里有活持有者 3342、阻塞集 1 枚 ⇒ 等）。G-70 不因本节而关闭：关闭要的是那六条腿的实跑读数。

### 8.223 G-70 闭合：32 臂 0 红；第 2 项的现量在 `6039f158` 上重取到手；而第一趟被**自己的新鲜度闸**当场拒了（2026-10-05 15:24–15:28，负载窗口 9.29）

**先记那笔红，因为它是对的**：15:24 我先用 `--no-build` 起跑（想着"镜像是两小时前的，就是这批那棵树"），
`verify-selfhost-stack.sh` 直接 rc=1 拒跑：

```
❌ 被验镜像的 OCI revision 与当前树不是同一笔：
     镜像 label = 673e6a43193de75fbf9c61183a0f7c88ea44db5b
     git HEAD   = 6039f15892d136bec9ff08231f6288698147e00a
```

我那句"就是这批那棵树"是**印象**，不是判据 —— 中间我又提了两笔（装置与台账），闸按 HEAD 逐字比，
所以它抓到的是真事。没有改这条判据、没有 `--no-build` 硬闯、没有把旧镜像当新的用；改成带构建重跑。
（这条闸存在的理由就是 §7 第 27／82 那一族：报绿的是另一棵树的产物。）

**第二趟（真构建，`VCS_REF=6039f158`）rc=0**，`===== 收工 2026-10-05T07:26:41Z rc=0 ======`：

| 那一趟量到的 | 读数 |
|---|---|
| 被验镜像的 revision == 当前 HEAD | `6039f15892d1…` 逐字对上 |
| 产物自洽（挂载 `/app/`） | `index.html` 的 5 个本地引用、manifest 的 15 个文件全部存在；4 个组件数据 URL 都在 SW 前缀 `/app/widgets/` 内；246 个 `--ht-*` 定义对得上产物里全部无兜底引用 |
| 镜像依赖对账（真镜像里那棵树） | 145 条 = 门禁扫描集 126 + 逐条登记过的镜像独有 16 + 本仓库自己的包 3（无解释 0 · 非宽松 0 · 声明对不上 0 · 失效登记 0） |
| 入口命令对账 | 扫描集 7 + 故意排除 1 + 非抄件登记 6，命中 9 条，R1–R9 全过；载体带的文件逐字 = `docker-compose.build.yml docker-compose.migrate-once.yml docker-compose.yml` |
| 真浏览器三条判据（`http://127.0.0.1:1900/app/`） | 三条全过，四张截图落在 `e2e/selfhost-stack-results/` |

🔴 **四张图人打开看过**（§6.2 规定一，"印着人眼复核"不算）：
`s1-app-loaded` 是**未登录未同步**态（顶栏"未同步"、空收集箱、rail 九个入口齐）；
`s2-signed-in` 顶栏变"已同步"，头像菜单四项 = 邮箱 / 编辑个人信息 / 设置 / **退出登录（底部、危险色）**，
且菜单没被 rail 裁掉右边；
`s3-device-a-synced` 里 `selfhost-task-5194621-2` 这条任务真落在界面上（收集箱 1 / 不重要不紧急 1 / 无截止时间 1 三处计数一起对上）；
`s3-device-b-recovered` 是**全新 context（空 IndexedDB = 一台刚装好的设备）**读到同一条任务且"已同步"。
⇒ 目标那句"外人打开浏览器就能用"在这一趟里是**看过的**，不是推的。

**G-70 的六条腿实跑（`node research/tools/selfhost-caddy-serve-check.mjs`，`RIG_RC=0`，臂 32 条 · 红 0 · 组 13 个都在）**：

```
W0 经代理建号 + 两次登录：register rc=0、令牌两把都在（长度 223/223，值不进读数）
W1 监听端经代理：open=true、收到 connected=true；上传前 new_ops 条数=0
W2 坏令牌：open=true、拿到 connected=false、关闭码=4003
W3 上传方经代理 add rc=0 ok=true，sync rc=0 ok=true ⇒ 监听端 new_ops=true（latestSeq=1）
W4 caddy 访问日志里 /api/sync/ws 行 2 条，带 ?REDACTED 的 2 条；两把令牌出现=false
W5 停掉 caddy 后：经代理 WS connected=false、直连 WS connected=true
变异 no-filter：HTTP 泄漏=true；WS 泄漏=true；WS 在该容器上仍能建立=true
```

两条设计上的收获，都不是"跑过了"能教的：

1. **W2 判据不能写成"连不上"**。升级握手在**代理层**就返回 101（`open=true`），服务端的鉴权是**之后**才把
   socket 以 4003 关掉的。所以这条腿判的是"拿不到 `connected` + 关闭码 4003"。
   当初若图省事写成 `opened === false`，它会**永远红** —— 一条看起来在防"代理伪造 101"、实际只会把整趟拖红的判据，
   下一步就是被人摘掉。反证要打在**服务端真正说话的那一格**上。
2. **同一枚变异容器上的两次注入不算一次**。`no-filter` 那枚容器上 HTTP 泄漏与 WS 泄漏**分别**为 true，
   才让 E（HTTP）与 W4（WS）各自有牙 —— 两条走的是 Caddyfile 里不同的代码形状（两个 `log` 块），
   只测一条就是给另一条留"看起来有门禁"的空档。

🔴 **G-70 的射程边界（别读多，也别当成已证）**：① 这一趟是 `ws://` 明文（沿用 G-68 声明的差异 2，
`DOMAIN=:<容器端口>`）⇒ **签证书那条不在这里证**，而 runbook §5 已单独写明"证书签不出来时容器仍 healthy"；
② 监听端**不是浏览器** —— "浏览器里那条实时接线真会连、且被三道同意闸罩住"归 `verify:selfhost-stack`
的界面腿（上面那四张图）与 `store.ts` 的 `networkAllowed()` / `dataEgressAllowed()`；
③ 起栈仍只有 `verify-selfhost-stack.sh` 一个所有者，装置没有另抄 `-f` 集合。

**收尾**：`--keep` 留下的那套栈按脚本打出的那条命令 `down -v` 拆掉，一次性凭据文件 `rm` 掉，
现量残留 0 枚容器 / 0 枚网络。装置与台账之外，本轮没有动任何别的落点。
