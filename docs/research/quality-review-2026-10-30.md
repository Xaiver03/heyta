# 质量与产品审阅 · 分组问题清单（2026-10-30）

注册登录标准套件线交出的 ③ 那一轮审阅的**总账**。五维每一维都落到一把能失败的尺上，
这份文件只干一件事：**把"发现 → 严重度 → 落点 → 复量命令 → 去处"排成一张可以逐条打勾的表**。

> 🔴 **两条口径，读这份文件前先接受**
> 1. **正文不驻留计数**。下面所有枚数都是 2026-10-30 11:07 那一戳的读数（同戳复量命令在右栏），
>    下一次 `main` 前进就会漂。要现量就跑命令，别引用这里。
> 2. **候选不是判词**。尺只负责"这个形状值得看一眼"；判红只发生在开码之后。
>    本表里"去处"一列写 `已修`／`待拍板`／`有意不动`／`未判定`，四种不许混为一谈。
>    **严重度与待拍板那张表同一口径**：🔴 = 开码后判成真缺陷；🟠 = 候选或"要人看"；⚪ = 未判定。
>    同一格在两处不同级，就算两份互相矛盾的账（🟠 那一格"候选，一枚没动"是这个意思）。
>
> 台账逐轮过程在 [`../plans/account-standard-suite.md`](../plans/account-standard-suite.md)（末节号现量：
> `grep -n "^### 6\.1" docs/plans/account-standard-suite.md | tail -1`）；
> 需要谁点头的都记在 [`../../BLOCKED.md`](../../BLOCKED.md) 那张「待拍板 / 跨线」表里
> （取位置：`grep -n "新落到的一格待拍板" BLOCKED.md`）。

一把尺一条命令：

```sh
node research/tools/audit-duplicate-function-bodies.mjs --top 500   # ① 跨文件重叠实现（逐字）
node research/tools/audit-duplicate-logic-skeletons.mjs --top 500   # ① 只改名的复制（文本尺看不见的那族）
node research/tools/audit-duplicate-destinations.mjs --top 50       # ⑤ 同一目的地两个入口
node research/tools/audit-dual-edit-controls.mjs --hints            # ⑤ 两处都能编辑
node research/tools/audit-unused-package-exports.mjs --top 500      # ② 导出面未被引用
node research/tools/audit-loop-io.mjs --top 500                     # ③ 循环内查库 / 同步 IO
node research/tools/audit-listener-timer-cleanup.mjs                # ③ 监听器与定时器有没有清理
node research/tools/audit-server-read-index-coverage.mjs --top 500   # ③ 读路径有没有索引
node research/tools/audit-unbounded-read-paths.mjs --top 500         # ③ 缺分页的无界行列表读
node research/tools/audit-avoidable-rerenders.mjs                    # ③ 可避免的全量重渲染
node research/tools/audit-silent-failure-branch.mjs                  # ④ 失败支有没有回执
node research/tools/audit-error-shape-machine-readable.mjs           # ④ 错误形状机不机读
# 任何一把都能自证会红：把上面的命令后缀换成 --self-test（臂数由它自己打印）或 --mutate
```

---

## ① 重复实现

| 严重度 | 形状与落点 | 复量 | 去处 |
|---|---|---|---|
| 🔴 | **同一件仪式在同一枚文件里被抄了多遍**：`apps/web/src/App.tsx:932` 与 `:991` 逐字同（六枚 setter 一起设）；`:2424`、`:2430`、`:2450` 三枚同仪式（`onOpenProfile` / `onOpenProfileCenter` / `onOpenHelp`） | `node research/tools/audit-duplicate-destinations.mjs`（🔴 只由"周围 5 行调用集合逐字相同"决定，跨文件一样升档） | **待拍板**：合并会连带改"从哪一面返回"那个行为；`App.tsx` 归日历/详情面线、账号菜单分层归全局 UX 线 |
| 🟠 | **同一枚展示逻辑在 `apps/mobile` 与 `apps/web` 各写一遍是一族**（导出文案表、看板标签、周期标签、倒计时过滤语、剩余时间文案、优先级标签、分享花名册注册；最长的一对是百行级的 AI 意图文案）——这条同时是 AGENTS §3.5「业务语义只许在 `packages/*`」的现量证据 | `node research/tools/audit-duplicate-function-bodies.mjs --top 500`（分桶：🔴 逐字相同 / 🟠 只差注释或文案，按 ≥3/≥5/≥10 行三档） | **待拍板**：修法不是逐格删，而是"下沉到哪一枚包、公共面长什么样"；且会动 barrel |
| 🟠 | **同一条夹取/校验逻辑在两处手抄**（自动收集规则 config 在 create 与 saveEdit 两处，同一行 `Math.min(50` 逐字符相同） | `grep -rn "Math.min(50" apps/web/src packages/app-host/src` | **待拍板**（自动收集线；与他们那条"新建不重置"宜同一笔做） |

| 🟠 | **同一守卫被手抄多份**：`packages/app-host` 各 `*-actions.ts` 里的 `xxxOf` 存取器（"取不到或已立墓碑就返回 `undefined`"这一条规则各抄一份，共 8 枚）。🔴 逐枚开码对过：**规则一致，没有哪一份漏掉墓碑判断** ⇒ 这是"漂移风险"候选，不是现行缺陷 | `grep -rn "deletedAt !== undefined) return undefined" packages/app-host/src/*-actions.ts \| wc -l`；组级候选 `node research/tools/audit-duplicate-logic-skeletons.mjs --top 500` | **待拍板**：收成一条共用存取器会动到 op-log 写入口那批工厂的签名，属共享层口径，一枚没动 |
| 🟠 | **同一仪式跨壳各写一遍**（`listeners.add` + 返回 `delete` 的订阅器；`localStorage` 偏好读写四件套 save/clear；`stripComments` 之类夹具）——这一族**逐字尺读不到**，因为每份的标识符名不一样 | `node research/tools/audit-duplicate-logic-skeletons.mjs --top 500`（第一栏就是最大的一组，成员名逐枚打全）| **待拍板**：订阅器与偏好读写该不该下沉成一枚共用件是包边界问题（AGENTS §3.5 只规定"业务语义"在哪，没规定这类通用件）；测试面夹具另计一档，不算产品重复 |

**射程**：这一维现在有两把尺——按**文本**对账的那把抓逐字与只差注释/文案的复制，按**骨架**（控制流关键字序列 + 标识符个数）对账的那把抓"只改名的复制"；
后者只比控制流形状，**不比语义**：`if (a) return b` 与 `if (x) return y` 同骨架，所以它的每一组都要逐枚开码才成判词（`--mutate` 那枚臂钉的是"改名确实追得回来、且落进同一组"，不是"这组是缺陷"）。
两把尺都只看**声明级函数体**：表达式体箭头函数与回调被跳过（跳过的枚数由尺自己打印在分母那行）。
"同一套逻辑用**不同控制流**写成"（例如两枚不同形状的重试退避）仍然读不到 ⇒ 那一族**未判定**，不是"查过没有"。

---

## ② 死代码与未被引用的实现

| 严重度 | 形状与落点 | 复量 | 去处 |
|---|---|---|---|
| 🟠 | 公共导出面里**全仓零引用**的一批（分母 = `packages/*/src` 全部 `export`；分布最厚在 `packages/domain` 与 `packages/app-host`） | `node research/tools/audit-unused-package-exports.mjs --top 500` | **待拍板**：删公共面是产品决定，按包归各包负责人；尺看不见动态引用与 `export *` 转发后的间接使用 |
| 🟠 | 只被 `index.ts` 再导出、**没有任何壳 import** 的一批（里面既有"公共面还没被用上"，也有"转发链接到一半断了"——后者是真缺陷） | 同上那一把的第二桶 | **待拍板**：逐枚开码才能分开这两类 |
| 🟠 | 定义了但**从来没被 `throw` 过**的错误类（形状归 ②，账不记在 ④） | `node research/tools/audit-error-shape-machine-readable.mjs`（F2 那行的"定义了但从来没抛出"） | **待拍板**（各线自己的面） |

**这条维度上一轮翻过一次案**：重叠探针第一版漏掉带返回类型标注的 `function` 声明，
整树读数少报 4 倍（`cc9ff3b41` 修的，臂 D14 钉住）——**负结论要先读分母**，别用一把只扫某套写法的尺断言"没有"。

---

## ③ 实际性能

| 严重度 | 形状与落点 | 复量 | 去处 |
|---|---|---|---|
| 🟠 | **服务端读路径没有索引兜着**（严重度与待拍板表同一口径：候选，一枚没动）：一批 `where` 没有任何索引以其中任一字段作最左列 ⇒ 全表扫那条谓词。抽验一枚是真的：`User` 只有四枚 token 列索引，而 `server/src/admin/admin.routes.ts:351`、`admins.ts:73`、`credential-sweep.ts:166` 按 `isVerified` / `isAdmin` 过滤 | `node research/tools/audit-server-read-index-coverage.mjs --top 500`；判它有没有牙 `--self-test`；单枚反查 `awk '/^model <Model> /,/^\}/' server/prisma/schema.prisma` | **待拍板**：加索引是迁移（不可逆层），不加也得有人写下"这表就这么大"——两边都是服务端那条线的口径 |
| 🟠 | **无界行列表读**（Prisma 列表读没有顶层 `take`/`skip`/`cursor`）。⚠️ 反例已钉死：`server/src/account/access-sessions.ts:189` **不许**加 `take`——同文件 `:178` 写着"退出登录撤销不了它们就变成一句界面上的谎"，真正的边界在行的生命周期（`:218/239/274` 与 `central-auth/repository.ts:689/749` 自己就在删行） | `node research/tools/audit-unbounded-read-paths.mjs --top 500`；`--self-test` / `--mutate` | **待拍板**（`server/` 整棵 vendored，改要动 `PROVENANCE.md`；分布最厚在管理面与分享面） |
| 🟠 | 循环里逐行查库与循环内同步 IO 两档（各若干处，逐处清单由尺打印） | `node research/tools/audit-loop-io.mjs --top 500` | **已逐枚开码**：多数判成"要么改判断口径、要么不可逆层、要么根本不是缺陷"（同步配额那条腿注释自写"Exact semantics over a faster plan"；有界重试与被卸载路径上的同步拆卸都不是缺陷）⇒ 全部**待拍板**，一枚没动 |
| 🟠 | **可避免的全量重渲染**：A 族下标当 key（本仓唯一一枚候选开码后是顶层字面量表 ⇒ 无风险）；B 族内联字面量打穿 `memo` **没有分母**——`git grep -nw memo` 剔掉 `useMemo` 与注释后全仓**一处具名 `React.memo` 都没有** | `node research/tools/audit-avoidable-rerenders.mjs`；`--self-test`（14 枚臂）/ `--mutate`（两发都不依赖树上恰好有什么） | **待拍板（边界）**：见 BLOCKED 那张表——先有运行时 profiling 再谈要不要引入 memo 策略；"B 族没东西可判"**不等于**"性能没问题" |
| ✅ | 监听器/定时器没有无界增长或漏清理的候选 | `node research/tools/audit-listener-timer-cleanup.mjs` | 本轮无候选；尺留着（判不了那一族逐枚给位置） |

**射程**：raw SQL 的 `WHERE` 有没有界、客户端与 HTTP 层的分页参数、以及"这次重渲染代价值不值"（运行时问题）
都**没量** ⇒ "没有无界读""性能没问题"这两句都不许由这些尺的 0 候选得出。

---

## ④ 错误处理

| 严重度 | 形状与落点 | 复量 | 去处 |
|---|---|---|---|
| 🔴 | **失败支呈现成功**（本轮唯一一枚开码后判成真缺陷）：`apps/mobile/src/screens/ProfileScreen.tsx:243` 的 catch 只 `console.warn` 并把 `scope` 留 `undefined`，而 `apps/mobile/src/lib/vault-session-cleanup.ts:48/57` 在 `scope === undefined` 时把禁用金库自动解锁与移除根密钥**两步都跳过**、返回 `{}` ⇒ 调用方 `:272` 读成"没有 `secureStorageError`"，界面报「已清干净」 | `grep -n "secure root cleanup skipped" apps/mobile/src/screens/ProfileScreen.tsx`；`sed -n '42,65p' apps/mobile/src/lib/vault-session-cleanup.ts`；候选全集 `node research/tools/audit-silent-failure-branch.mjs` | **待拍板**（设备撤销那条线的契约与安全边口径；不代改三条理由在台账 §6.122） |
| 🟠 | 本机 op-log 迁移失败只在控制台留一句"将从空库开始"，而同处注释写着"必须留下**可见**痕迹"（`apps/web/src/lib/oplog.ts:437` 对 `:413-415`） | `grep -n "迁移失败，将从空库开始" apps/web/src/lib/oplog.ts` | **待拍板**：要不要为这一档加一枚用户可见呈现是产品决定，落在浮层与反馈那条线的债务账本上 |
| 🟠 | 两条保存路径的 catch 不绑 error，服务端明写的 `code`（含 402 付费门槛）在界面层丢成同一句"没接受这次改动" | `node research/tools/audit-error-shape-machine-readable.mjs`；`grep -rn "没接受这次改动" packages/i18n/src/locales/zh-CN.ts` | **待拍板**（分档出回执文案牵动 i18n 与四端壳） |
| ✅ | **错误形状机读性整体过关**：生产代码里"拿自家文案当分支"0 枚；"抛出去又谁也分不开"的错误类 0 枚 | `node research/tools/audit-error-shape-machine-readable.mjs`；`--self-test`（臂数由它自己打印）/ `--mutate`（两向） | 两格"要人看"已单列进待拍板表（测试面拿文案当断言、往 `message` 里塞 slug） |
| ✅ | **F4 服务端对外响应体（原先挂"未判定"那格，现已按真实形状量掉）**：`reply.status(4xx/5xx).send({...})` 那一片里，什么码位都没有的 **0 处**——绝大多数带统一 `code`，两处用 `status: 'approved'` 这类枚举字段 | `node research/tools/audit-error-shape-machine-readable.mjs`（F4 那行打印四档，"判不了"那档**逐枚带 file:line**）；判它能不能红 `--self-test`（臂 G18/G19/G20）；谓词现量 `git grep -lE "res\\.status\\([0-9]{3}\\)\\.json\\(" -- server/src`（读空＝本仓没这族写法，所以谓词是按 Fastify 真形状下的） | 闭合。原先"判不了"那几处已**逐枚开码判过**：字面量在 helper 里，helper 自己就带 `code` —— `server/src/entitlement.ts:548` 那枚装配函数返 `{ code: ENTITLEMENT_ERROR_CODE, … }`（`:576` 整份交给它、`:605` 展开它再补两格数值），`server/src/sync/sync.routes.quota.ts:138` 的 `code` 就写在展开**前面**。复量：`sed -n '544,556p' server/src/entitlement.ts`；`sed -n '125,142p' server/src/sync/sync.routes.quota.ts` |

**射程**：F4 现在仍看不见 `send(变量)`／带 `...展开` 那几处的**字面量内容**（这是静态对账的边界），但它把每一枚的位置点名出来，
所以"判不了"是一条**可以去开码的待办**，不再是一个数字；本仓那几枚已各自开码判完（上一行）。
"对外全部带码位"这句仍不许由 F4 的 0 候选得出——它只覆盖 `reply.status(...).send(...)` 这一族写法。

---

## ⑤ 产品视角（可达路径上的缺陷形状）

| 严重度 | 形状与落点 | 复量 | 去处 |
|---|---|---|---|
| 🔴 | 同一个账号菜单里并排两枚「个人资料」入口，走的还是**两个不同状态字段**：`apps/web/src/features/shell/AccountMenu.tsx:101-102` 同时收 `onOpenProfile` 与 `onOpenProfileCenter` 且两枚都渲染（`:351` 只在后者缺席时退化成一枚）；一枚设 `settingsAnchor='profile'`，一枚设 `secondaryAccountSurface='profile'` | `grep -n "onOpenProfile" apps/web/src/features/shell/AccountMenu.tsx`；`grep -n "onOpenProfile" apps/web/src/App.tsx` | **待拍板**：该留哪一个（或本来就是两个目的地）是产品口径；本线不替它们合并状态字段 |
| 🟠 | 「两处都能编辑」四组候选**逐枚开码后全是有意的互斥相位**（建密码库 vs 解锁；登录 identify 相位 vs 后续），今天这一族没有实锤缺陷 | `node research/tools/audit-dual-edit-controls.mjs --hints`（分支提示是启发式，不参与判红）；`--self-test` / `--mutate` | 结论记台账 §6.133；跨组件那一半是**射程**，不是"查过没有" |
| 🟠 | 「两处都能编辑」的**测试面**与「码位塞在 message 里」两格（各 2 枚） | 见 ④ 那两行命令 | **待拍板**（各线口径） |
| ⚪ | 落地页有一枚**存在过但从未接上**的目的地：仓库有 `/pitch/` 五件套但不在 `SITE_PAGES` 注册表、线上回 404 | `node scripts/live-web-freshness.mjs --landing`（末行点名）；`grep -c "id: " apps/landing/src/site/pages.ts` | **待拍板**（落地页/文档站那线：接进注册表并给入口，或整目录删） |
| ✅ | 「失败后没有回执」这一族有装置且逐枚判过：11 枚候选里 1 枚真缺陷（上面那行 🔴）、1 枚"该改但要拍板"、9 枚有意为之 | `node research/tools/audit-silent-failure-branch.mjs --self-test`（15 枚臂）/ `--mutate` | 逐枚结论在台账 §6.122 |

**该改与不该改的边界**（本轮的判断口径，供下一位复核）：
① 动**判据口径**的一律不代改（错误分档、回执语义、"取不到 scope 算失败还是算无需清理"）；
② 动**不可逆层**（schema、迁移、线协议）的不代做；
③ `server/` 与 `packages/sync-core/` 是 vendored，改要动 `PROVENANCE.md` ⇒ 只登记；
④ 别人此刻在写的文件（脏集里那批）不动、不代提交；
⑤ **纯本地可对账的小毛病当场修**——本轮当场修完的都在下面的表里。

---

## 当场修完的（每条都配了能失败的判据）

| 改了什么 | 判它能不能红 | 那一笔 |
|---|---|---|
| 共用遮蔽器把 TSX 闭标签 `</li>` 当正则起点，一路抹掉整段真代码（含 `value={x}`）；改按"两条 JSX 斜杠判据"处理 | 新尺自带的对账臂（第一发读出 73 ≠ 60 抓到它）＋ `node research/tools/audit-avoidable-rerenders.mjs --self-test` | `d5b818200` |
| 被复用的那枚重叠尺**没有入口判定**：别的模块只 import 它的 `extractFns`，也会拿调用方的 argv 去跑整套扫描（`--self-test` 被调用方的 argv 抢走）；加 `IS_ENTRY`（`import.meta.url === pathToFileURL(process.argv[1]).href`）把命令行那段整块包住 | 只 import 不再打印分母那行（当场实测）＋ `node research/tools/audit-duplicate-function-bodies.mjs --self-test` 仍全绿 | `7422c5d67` |
| **同一族第二次露头，于是逐枚数了一遍**：五枚"有导出面、顶层还裸调 `main()`/`run()`、又没入口判定"的尺（归属尺、账本编号尺、台账健康尺、读路径索引尺、导出面尺）——只 import 就把整套扫描跑完并打印。分母是**两下属实**收窄出来的：先"有导出面"抓到一把假候选（有导出面 ≠ 被 import 会跑副作用），再钉"顶层有一行裸调用"才收到这几枚 | 修前先让它红：`node --input-type=module -e "await import('./scripts/check-worktree-exceptions.mjs'); console.log('ONLY_IMPORT')"` 会先打印归属报表；修后五枚一律只回 `ONLY_IMPORT`，且各尺 `--self-test` 仍 `不符 0`（臂数由它们自己打印）。逐枚分母命令与两下收窄见台账 §6.141 | 本轮 |
| 重叠探针漏掉带返回类型标注的 `function` 声明 ⇒ 整树读数少报 4 倍 | `node research/tools/audit-duplicate-function-bodies.mjs --self-test`（臂 D14/D15） | `cc9ff3b41` |
| 归属尺的构建产物噪声只在一个模式下被滤过 ⇒ 默认模式也按机制豁免 | `node scripts/check-worktree-exceptions.mjs --self-test`（㉞/㉟/㊀ 三臂） | `83eb19791` |
| 台账尺把一次合规的"往同一格追加追记"读成行消失 ⇒ 另立「就地改写」一档 | `--self-test`（L13/L14 两臂）＋ `--mutate` 2/2 | `baee627b3` |
| 服务端版本快照指纹停在旧版本号（正文已升） | 重新生成后跑该线自己的对账 | `f80b4e50c` |
| 签发端三枚空串被当成"配了"，公开撤销面从 500 回到 403 | 该线门禁（见 BLOCKED 台账那节） | `54bf5e9d2` |
| 一次托管调用扣两次预留；认领只属于设备走代理那条腿 | 该线的计量用例 | `9904fb671` / `76a125efa` |

---

## 还没做完的（只剩一件）

1. **发布这一格：已量成"线上那份就是 HEAD 的产物"**，不是"等点头"。
   在干净 HEAD 的独立载体上重建两盘产物并与线上逐字节比：应用入口那两枚 asset 的文件名与 sha256 全同，
   落地页主 JS 与 `index.html` 也各同值；真浏览器那套 live-site 判据整条通过（含台账 B232 曾红的两枚）。
   ⇒ "发"这一步对当前 HEAD 的净效果是零。取数与构建命令见
   [`../runbooks/deployment.md`](../runbooks/deployment.md) §3.7（那节也写了落地页构建必须带
   `VITE_SITE_URL`/`VITE_APP_URL`，少给会造出一枚假"线上旧"）；逐轮现量：
   `node scripts/live-web-freshness.mjs` ＋ `node scripts/live-web-freshness.mjs --landing` ＋
   `cd e2e && npx playwright test --config playwright.live-site.config.ts`。
   ⚠️ 这条结论只对**写它那一刻的 HEAD**成立：`apps/web`/`packages` 一有提交就要重新量，
   判"要不要再发一趟"用的是打包输入差集，不是这行字。
2. **待拍板那张表**：`grep -n "新落到的一格待拍板" BLOCKED.md` 起，逐格归人。
   本线一律**只交装置、候选与复量命令**，没替任何一条线改判据口径。
   本轮新增一格（**账本卫生**，不是代码缺陷）：取证账本里同号开多节一批 ——
   `node research/tools/audit-blocked-number-collisions.mjs`（枚数由它自己打印）。
   我自己今天就被它绊过：同一枚 B232 同时是 10-18 的 macOS 门那一节与 10-27 的落地页那一节
   （现量 `grep -n "B232" BLOCKED.md`）。这是几条线共用的账本，**重编号＝改写别人写过的引用** ⇒ 只登记，不由本线改。
