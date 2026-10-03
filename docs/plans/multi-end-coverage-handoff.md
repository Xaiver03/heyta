# 交接：多端补齐（重点移动端）Goal —— 当前停在哪

> 状态行：**🔄 未完成**。条件 1 的 6 行里 **3 行 ✅ / 3 行 🟡**；条件 2 **未达成**（`pnpm check` 57/62 段可过、
> 四端重装本轮没跑）。**这条 Goal 没有被标记完成，也不要照本文件当成已完成接手。**
> 唯一权威过程账在 [`goal-multi-end-coverage.md`](goal-multi-end-coverage.md) §7（§7.27 字形定论、§7.28 完成条件逐条现量），
> 阻塞与归属账在仓库根 [`../../BLOCKED.md`](../../BLOCKED.md)（B33/B41/B42/B43/B45/B47/B50/B51/B52），
> 逐程流水在 [`../../PROGRESS.md`](../../PROGRESS.md)。本文件**不重复决策与归因**，只写"现在在哪、下一步按什么顺序做"。

---

## 0. 载体（接手前先核，别信本文件里的号）

| 项 | 值（2026-10-03 21:1x） | 复跑核对 |
|---|---|---|
| 本分支 HEAD | `96f3293d` | `git rev-parse --short HEAD` |
| 本条线今日提交 | `05293b7d` `a633183c` `8519de39` `96f3293d`（中间被并行条线的提交穿插） | `git log --oneline -14` |
| 判据基线（本轮现量） | 四份 spec **71 passed、0 skipped** | 见 §3 第一条 |
| l4 棘轮 | **98 / 90**（上限 ≤104/90） | `node scripts/check-l4-no-style.mjs` |

⚠️ **接手第一件事**：`git status --porcelain` 现在约 **270 条**未提交，其中绝大多数不属于本条线。
本仓库是**共享工作树**，`git commit`（裸）提交的是整个索引 ⇒ 永远点名路径提交。

---

## 1. 目标与范围（原文口径，不要扩）

移动端「零件都在、没人接线」的那批功能接完，每条带能失败的判据，最后四端装上当前源码。
让步顺序：**判据真实 > 功能做完 > 做得快**。

允许改的地界（其余只读）：`apps/mobile/src/**`、`apps/web/src/features/{notes,motivation,search,projects,habits,subscription}/**`、
`packages/{ui,app-host,i18n}/src/**`、`scripts/verify-mobile-*.sh`、`check-script-snapshot.mjs` 的 MANIFEST、
`check-journey-coverage.mjs` 的 mobile 登记、两份台账（审计 §3/§4 与 goal §7）。
判卷冻结：`apps/mobile/tests/**`、`e2e/**`、其余 `scripts/check-*.mjs` 不许改
（唯一例外 `reminders-notes-display.spec.ts:261` 那条已翻成 `toContain('onEdit=')`，不许删）。

---

## 2. 已经做完并落盘的（别重做）

| 面 | 状态 | 判据（可复跑） |
|---|---|---|
| 清单/标签 改名与归档（两端） | ✅ | `cd apps/mobile && npx vitest run tests/organizer-rename.spec.ts` → 26 passed |
| 习惯 改名与删除 | ✅ | 同上文件里那条习惯 describe |
| 便签 编辑（移动端二级全屏屏 + 搜索里点开便签） | ✅ 接线与判据齐 | `npx vitest run tests/note-edit.spec.ts` → 15 passed；`tests/reminders-notes-display.spec.ts` → 17 passed（含翻向断言） |
| 周小结分享块 + 「我的」权益卡 + 占位符字形对账 | ✅ | `npx vitest run tests/growth-share-summary.spec.ts` → 13 passed |
| 导入（自家 JSON 还原）移动端 | ✅ | `node scripts/check-pricing-consistency.mjs` → exit 0 之外，设备判据 `scripts/verify-mobile-restore.sh` |
| `check:ai-coverage` 按端枚举（移动端 0/5 显式红） | ✅ | 变异：塞两条探针 import ⇒ 精确点名缺的 3 条 |

## 3. 当前状态：还差的（逐项带现量）

1. **条件 2 的第 1 条：`pnpm check` 62 段 exit 0** —— 现量 **57/62**。5 段红各自的位置：
   - 3 段 Playwright（`check:ai-e2e` / `check:privacy-consent-e2e` / `check:landing-e2e`）：
     需要 `:3000` 空闲且没有别人的 vite；`check:ai-e2e` 会 **SIGKILL 别人的 dev server**（traps #87）。
   - `check:shell-unicode`：**HEAD 上就红**，在别人提交的 `scripts/mutate-closeout-gates.sh`（B36.2，地界外不代改）。
   - `check:docs`（第 34 段）：**HEAD 上就红 3 处**（别人引用进了提交、目标文件漏 `git add`，B51），
     其余 24–30 处只在混合工作树成立，**本条线 0 处**。
2. **条件 2 的第 2 条：四端重装 `INNER_EXIT=0`** —— 🔴 **本轮没跑**。上一次四端跑绿的载体不是本轮交付，不能顶替。
3. **条件 1 的三行 🟡**（不是漏做，是拦路的在本批权限之外）：
   - 清单/标签行的「父子层级选择器」：**写侧只差 `ProjectActions` 上一个 `setParent` 包装**
     （通用派发器 `project-actions.ts:165` 的 payload 是开放的，rename/setColor/archive 都是它的一行包装），
     **真缺的是两端的选择器界面 + 跨端形态裁决**（web 也没有嵌套）。设计已被 `packages/domain/src/entities.ts:270-277`
     钉死：只允许一层文件夹。→ B52。
   - 成长统计行：热力图无障碍名被 `apps/mobile/tests/growth-display.spec.ts:365` 钉成空串；
     补打卡被 `HabitStreakList.tsx:269` 的 `||` 渲染条件挡住（**接了也不出现、不报错**）。→ B41 / B42。
   - 权益行：`entitlement.ts` 那次 GET **一个响应字段都不消费**，web 侧到期条同样只有两个布尔
     ⇒「到 X 日到期」要动服务端面。→ B45。
4. **`verify:mobile-notes` 剩余腿**：真机只走到第 5 步；第 8 步之后三腿缺（第 8 步第三张截图、第 6/7 步 op 判据、第 9–11 步跨设备）。

## 4. 环境读数（2026-10-03 21:1x，设备/浏览器类验收的前置）

`sysctl -n vm.loadavg` 1min = **91**（16 核）；`:3000` 被 **PID 80257** 占；有人在 `/tmp/heyta-reminder-ios4` 编 iOS。
⇒ 设备类与 Playwright 类验收**现在跑不得**。跑之前重新现量这三条，别看本文件。

## 5. 下一步（有序，一次一个会话做得完的量）

1. 等窗口（负载落下来 + `:3000` 空闲 + 没有别人的 vite）→ 跑 `pnpm reinstall:all`，要 `INNER_EXIT=0` 与四张**逐张写明各自钉到哪一步**的截图（AGENTS §6.2 规定一：人必须打开看图）。
2. 同一窗口内补跑那 3 段 Playwright，然后跑满 `pnpm check` 并把**可过段数与载体 sha** 一起写进 goal §7.29。
3. `verify:mobile-notes` 从第 6 步接着做（第 6/7 步的 op 判据 → 第 8 步第三张截图 → 第 9–11 步跨设备）。⚠️ 它要 `PORT=3100`（`:3000` 是别人的旧进程）。
4. **父子层级选择器**：先在 `ProjectActions` 上补 `setParent(entityId, parentId?)`（照 `archiveProject` 的形状，一个意图 = 一个 op）+ 一层深度/环/自指守卫，再决定两端界面形态。**跨端形态要产品负责人拍**：两端同时做嵌套，还是移动端先做。
5. 若要做热力图/补打卡：那是**翻冻结判据**的权限问题，不是接线问题 —— 需要判卷文件的属主批准改 `growth-display.spec.ts:365`/`:302`。

## 6. 死胡同警告（这些坑已被现量踩过，别再走一遍）

- 🔴 **别用 `git commit --only <文件>` 提本条线的两份台账** —— 里面此刻混着并行会话的 hunk
  （`goal-multi-end-coverage.md:104` 是他们改的 W9 状态句）。正确做法见 `96f3293d` 的提交信息：
  用 plumbing 造「HEAD + 只含我的行」的 blob，提交后**按路径刷共享索引**（`git update-index --cacheinfo`），
  否则别人一次裸 `git commit` 会把我这几百行倒回去。
- `check:docs` 的**总数是活的**（一小时内 27→32→33→34），别把它当提交属性引用；判归属要用**链接整串**，
  不能用文件名 basename（`README.md` 会假命中），也不能用解析后的绝对路径（文档里写的是相对串）。
- 行内代码（反引号）里的路径**不是链接**，`check:docs` 看不见它 —— 别把"没被报"读成"是好的"。
- 门禁名的唯一权威来源是 `package.json` 的 `scripts` 键（`check:docs` = `node research/tools/docs-link-check.mjs`，
  没有 `scripts/check-docs-link.mjs` 这个文件）。
- 脚本里开了 `set -o pipefail` 时，**别写 `if ! diff -u A B | grep -q …`**：`diff` 在有差异时退 1，
  整条管道状态就是 1，匹配成功也会被读成失败（本轮在此空转四趟）。改成直接 `grep 文件`。
