# A 包验收记录 · 用户能看到什么变化（2026-11-06）

> 配套：[实施计划](package-a-data-trust-2026-11.md) · [ADR-0084](../adr/0084-local-library-ownership-and-signout-erasure.md)
> 本文件是交付物 ③：**只写"人能看到/能验证到什么"**，机制细节在计划里。

---

## 一、三条用户可见的变化

| # | 之前 | 现在 | 证据 |
|---|---|---|---|
| 1 | 账号 A 退出登录后，A 的任务还在本机侧栏里；换 B 登录还能看到 | 退出登录 = **这台设备上不再留 A 的数据**；销毁没清干净时顶部出现红条「本机的任务数据没有清除干净」+ 重试 | `signOutStore` 先起 `purgeLocalLibrary()`；`library-owner.spec.ts` 用**真实 SQLite 文件**断言销毁后 `existsSync(dbPath) === false`、重开是空库 |
| 2 | 登录到一台属于别人的设备时，界面照常显示上一个人的数据，还能把数据传上去 | 登录/启动时先问「这个库是不是你的」：不是就**撤掉新凭据**、不发任何同步请求，顶部出现「这台设备上的数据属于另一个账号」+ 唯一出口「清除本机数据」 | `verifyLibraryOwner()`；`syncNow` 在 mismatch 时直接返回 `idle`（零请求）；`library-owner.spec.ts` 断言 B 的 `dispatch`/`sync` 都抛可判别错误且 A 的数据没被改 |
| 3 | ⌘Z 是空操作（只有 5 秒回执） | 删错清单/改错字段可以撤销与重做；**别人改过这条**时拒绝撤销并说「没撤成」，不会拿旧值覆盖新改动 | `op-log` 的 `undo()/redo()/historyState()`；`history.spec.ts` 9 条，含 stale 拒绝与"一次撤销只落一条 op" |
| 4 | 设置 → 同步只说"已同步/同步中"，看不出有没有东西没上去；刷新后"上次同步"变空白 | ①设置 → 同步 多三行本地读数：**还有 N 项改动没上传 / 上次成功同步：… / 数据先写在本机，再同步到你的服务器**（`N=0`、`还没读`、`没成功同步过` 各是各的句子）；②rail 那一枚的整句状态后面挂「· N 项还没上传」（读屏与 hover 同一句） | `SyncSettingsPanel` 三行 + `sync-data-status.spec.tsx` **5 条**（含 rail 一条）；真浏览器证据见 §三 |

## 二、判据「怎么才会红」——逐条实测读数

每条都是**真的把代码注掉、跑红、再还原**（备份在 `/tmp/a-pkg-fi/`，还原后复跑全绿）。

| 判据 | 注入点 | 实测结果 |
|---|---|---|
| R2-a 删清单可撤销 | `history.ts` 的 `OpType.Delete` 分支改成 `skip('unsupported-op')` | `history.spec.ts` **4 failed**；断言 `expected 5000 to be undefined`（清单仍是墓碑） |
| R2-c stale 不覆盖 | `checkInverseStillValid` 开头直接 `return undefined` | **2 failed**：`expected {status:'applied'} to deeply equal {status:'stale'}`（会误覆盖远端） |
| R1-a 登出后库为空 | `purgeLocalLibrary` 直接返回 `purged`、不真的销毁 | `library-owner.spec.ts` **2 failed**；断言 `expected true to be false`（db 文件还在） |
| R1-c 跨账号写入被拒 | 去掉 `host.dispatch` 里的 `requireLibraryOwner()` | **2 failed**：`expected undefined to be an instance of LocalLibraryOwnedByAnotherAccountError` |
| R7-a 待上传条数 | `SyncSettingsPanel` 那一段三元表达式换成常量「都已经上传」 | `sync-data-status.spec.tsx` **2 failed**：`expected '本机的改动都已经上传。' to contain '3'` |

还原后复跑：`history.spec.ts` 9 passed、`library-owner.spec.ts` 10 passed、`sync-data-status.spec.tsx` 4 passed。

## 三、本轮取证边界（不藏）

1. **真浏览器证据已经有了一半**：`e2e/tests/shell-sync-rail.spec.ts` 新增 **S5**，
   真跑 `vite preview` + 已构建的 `apps/web/dist`，5 条全过；截图
   `apps/web/evidence/shell-sync-rail/settings-data-status.png` **已人眼看过**：
   三行读数在同一屏、不重叠、中文可读（"本机的改动都已经上传。/ 还没有成功同步过。/
   数据先写在这台设备上……"）。**仍缺**：①待上传 > 0 那一态在真浏览器里的截图
   （需要真造 3 条未上传改动）；②退出登录后那条红条、归属冲突提示的真浏览器截图。
2. rail 上已挂「· N 项还没上传」（复用既有状态句，不新增角标 —— 48px 放不下第二枚）。
3. **移动端只做了接线**（`ProfileScreen` 先 `purgeLocalLibrary()` 再清钥匙，
   失败单列一条提示 + 重试），**没有设备腿 e2e**；`mobile typecheck` 已绿。
4. **`rejected`（服务端永久拒绝）没有计数**：所以"待上传"是 `pending` 队列，
   严格意义上的"没到服务端" = `pending + rejected`，本轮只覆盖前者（计划 §6 已记）。

### R7 的「哪一条、谁赢」这一半：本包没有重做，只注明它在哪

PRD 的 R7 判据 ② 是"制造冲突 → 看得到**哪一条、谁赢、能不能改判**"。这一半**在本包之前就存在**：
`apps/web/src/features/sync/ConflictDialog.tsx` + `@heyta/ui` 的 `ConflictResolutionView`
（并排渲染双方载荷、标出较新一侧、每侧一个「保留这一版」＝改判）。
本包**一行都没改它**，所以不把它的证据算成自己的功劳；它现有的判据在
`apps/web/tests/conflict-dialog.spec.tsx`（含「必须同时渲染出双方的载荷内容」一条）。

## 四、门禁读数（并标注哪些红不是本包引入）

| 门禁 | 读数 |
|---|---|
| `@heyta/op-log test` | 156 passed（新增 9） |
| `@heyta/app-host test` | 2088 passed（新增 10） |
| web 相关用例（account-security / local-data-destruction / sync-settings-prefill / sync-data-status） | 42 + 18 + 7 + 4 = **71 passed** |
| `@heyta/{op-log,app-host,sync-client,storage,web,mobile} typecheck` | **全绿**（mobile 之前红在 `task-sort.ts` 缺 `manual` 档文案——HEAD 上就有的缺口，本轮补 1 行） |
| `check:undo-receipt` | ✅（141 个 token 引用全部可解析） |
| `check:design-token-refs` | ✅ |
| `e2e` · `shell-sync-rail.spec.ts`（真 Chromium + `vite preview`） | **5 passed**（S1–S5；S5 是本轮新增），截图已人眼看 |
| `check:layering` | ❌ **不是本包**：违规在 `apps/web/src/features/tasks/saved-filters.ts:35`，该行在 HEAD 上就存在（`git show HEAD:…` 可核对） |
| web 全量 | 2741 passed / **5 failed**，失败在 `task-sort`（HEAD 的 `TASK_SORT_KEYS` 已有 `manual` 但用例仍断言 3 档）与 `rail-more-menu` / `keyboard-cursor` —— 这三处本包未改，且与并行会话正在进行的 R4/R9/R6 改动同域 |

## 五、下一轮（按顺序）

1. 真浏览器补两张图：**待上传 > 0**（造 3 条未上传改动看 rail 与设置两处）与**退出登录后的红条 / 归属冲突提示**；
2. 移动端设备腿 e2e（现在只有源码接线判据 + typecheck）；
3. 把 `rejected` 计数开出来，让"没到服务端" = `pending + rejected` 能说全。

## 六、一个环境事故（已恢复，必须记下来）

跑 `pnpm --filter @heyta/ui build` 想刷新设计系统的产物时，**tsup 在失败前删掉了
`packages/ui/dist/index.d.ts`**，于是一串壳的 typecheck 变成"找不到 @heyta/ui 的类型"。

- **失败原因不是本包**：`packages/ui` 里有文件 `import … from 'react-native'` /
  `'react-native-svg'`，而这两个包在 `packages/ui` 这一层解析不到（本机安装态如此，
  HEAD 上就跑不过 `ui build`）。
- **恢复方式**：用 `tsc -p tsconfig.json --emitDeclarationOnly --noEmitOnError false`
  重新生成 `dist/index.d.ts`（`ROW_ACTION_IDS` 已在其中），随后
  `web` / `mobile` / `app-host` 的 typecheck 复绿。
- **没恢复的那一点**：`dist/index.d.cts`（tsup 的 CJS 声明）没有重新生成；
  本机 `@heyta/ui` 的 `build` 脚本仍然是红的（缺 RN 类型）。这两条是**环境缺口**，
  下次动 `packages/ui` 的人会再撞上，建议把 RN 类型依赖按 §3.1/§3.2 登记后补进 devDeps。
