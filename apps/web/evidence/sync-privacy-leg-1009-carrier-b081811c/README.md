# 「同步与隐私」决定态那一腿的读数（2026-10-09 15:2x）

装置：`scripts/qa/reminders-data-responsive.mjs` 的 `sync` 腿（`HEYTA_RESPONSIVE_LEGS=sync`）。
它守的是 UX-S9-139 那两条裁决在**界面上**的形状：「已同意」只给「撤回同意」；「还没选择」只给
「重新作出选择」；「重新作出选择」开的是**同一张**同意面板，不是第二份同意界面。
此前全仓零层在守（`grep -rn privacy-revoke e2e/tests apps/web/tests` 现量 0 处）。

## 1. 两趟各跑一次，因为这一档两棵树本来就不一样

| 趟 | 载体 | 产品源码 | 结果 |
|---|---|---|---|
| A | 主检出工作树 | 含未提交的两栏设置 IA（`SettingsNotice.tsx` / `privacy-settings.css` 在 `HEAD` 里不存在） | 十条判据全真，`SYNC_LEG_RC=0`，负载 33.81 |
| B | `heyta-carriers/heyta-uxhead-1009` @ `b081811c`（工作树零脏；`PrivacyPanel.tsx`/`privacy/store.ts`/`consent-gate.ts`/`App.tsx` 与 `HEAD` **逐字相同**） | 只有已提交的那半 | 十条判据全真，`CARRIER_LEG_RC=0`，负载 28.10 |

🔴 **B 这一趟的目的不是多取一份数**：这条腿要能进别人的干净检出，就不能是"取证口先行"的红
（同族规矩见本文件 §6.23 那条「已补只有配上在 HEAD 里才算补」）。载体上那份装置是本目录新写的文件
（`b081811c` 里没有它），跑完已删除并复验 `git status --porcelain` = 0 行。

三格视口×主题：明 1440×900 / 暗 1440×900 / 明 375×812。每格走全三态，各拍一张图（每趟 12 张）。

## 2. 实测出来的两树分歧（不是读代码读出来的，是两趟读数对出来的）

| 那一档 | 已提交的代码（B 趟） | 工作树那版（A 趟） |
|---|---|---|
| 选了「只用本机」之后 | 给的是 **「撤回同意」**（`revoke=1 choose=0`）—— 这就是 UX-S9-139 缺陷栏第一项 | 给的是 **「重新作出选择」**（`choose=1 revoke=0`） |
| 决定时间那句话 | `只用本机（未同意联网）（决定于 2026-10-09 15:27）` —— **没有 UTC** | `…决定于 2026-10-09 15:25（UTC）` |
| 点「同意并联网」之后 | 什么都不弹（`signInAfterAccept.appeared=false`） | **自动把登录引导弹出来**（`appeared=true`，靠它自己的 `auth-form-close` 才收得掉） |

⚠️ 第二行那条**不能**读成"`HEAD` 的词条没有 UTC"：`git show HEAD:packages/i18n/src/locales/zh-CN.ts`
里 `'common.privacy.settings.decidedAt'` 确实写着 `决定于 {time}（UTC）`。B 趟读的是那棵隔离副本里
**已经构建好的 `packages/i18n/dist`**，它比源码旧 —— 拿隔离副本跑界面，读的是产物不是词条
（AGENTS §7 第 27 条那一族）。要在载体上验词条，得先在那棵树上重打 `packages/i18n`。

第三行是**新记到在案的一条产品行为**（未提交那版带来的）：首启点「同意」会顺手把登录引导弹满整屏，
1440 那一档实测连左侧 rail 都被藏掉（`account-menu-avatar` 报 `element is not visible`）。
它不是本线的判据对象，本线只把它记成读数 `signInAfterAccept`。

## 3. 十条判据（两趟都全真）

`syncPrivacyThreeStatesReached`、`syncPrivacyPanelVisibleAndThemeApplied`、
`syncPrivacyExactlyOneActionPerState`、`syncPrivacyAcceptedShowsOnlyRevoke`、
`syncPrivacyRevokeReturnsToChooseAgain`、`syncPrivacyReopenUsesOneAndOnlyOneDialog`、
`syncPrivacyEveryStateSettled`、`syncPrivacyConsentDialogUnmountedAfterDecide`、
`syncPrivacyDecisionButtonsPointerReachable`、`syncPrivacyBadArmsFlipTheRuler`。

牙：往运行时 DOM 里种两枚坏（摘掉那枚决定按钮 / 追加第二张 `privacy-consent-dialog`），
两趟都数得到（`planted.actionBefore=1 → actionAfter=0`，`dialogsBefore=0 → dialogsAfter=1`）。

## 4. 人看过哪几张（AGENTS §6.2 规定一）

- `../sync-privacy-leg-1009-r6/sync-privacy-1-accepted-dark-1440.png` —— 暗色确实是暗底、主蓝「登录」按钮、
  「已同意与服务器通信 / 决定于 …（UTC）」、下面只有「撤回同意」一枚。
- `../sync-privacy-leg-1009-r6/sync-privacy-3-reopen-dialog-light-1440.png` —— 从设置里点「重新作出选择」
  开出来的**就是首启那张**「在使用联网功能之前」，两个按钮并排同等可达，不是第二份同意界面。
- `../sync-privacy-leg-1009-r6/sync-privacy-2-undecided-light-375.png` —— 窄屏撤回之后：
  「还没有作出选择」+ 只有一枚「重新作出选择」。
- `sync-privacy-4-local-only-light-1440.png`（本目录）—— **已提交的代码**上，选了「只用本机」之后
  界面给的是「撤回同意」，配一句「撤回后这台设备立刻停止对外请求…」。

其余 20 张是同样三态在别的视口/主题下的重复，未逐张人看。

## 5. 复跑

```bash
# 主检出（工作树那版）
cd apps/web && ./node_modules/.bin/vite --host 127.0.0.1 --port 4379 --strictPort &
HEYTA_RESPONSIVE_HEADED=0 HEYTA_RESPONSIVE_LEGS=sync \
  HEYTA_RESPONSIVE_EVIDENCE=$PWD/apps/web/evidence/<新目录> \
  node scripts/qa/reminders-data-responsive.mjs

# 已提交形状：把同一份装置复制进一棵干净的隔离副本，换端口与证据落点
HEYTA_RESPONSIVE_ORIGIN=http://127.0.0.1:4380 HEYTA_RESPONSIVE_HEADED=0 HEYTA_RESPONSIVE_LEGS=sync \
  HEYTA_RESPONSIVE_EVIDENCE=/tmp/<新目录> node <副本>/scripts/qa/reminders-data-responsive.mjs
```

⚠️ 证据落点**每次换一个新目录**：本装置默认落的目录里有 47 枚已跟踪文件，闸门会拒绝覆盖；
而复用同一个临时目录会让人读到上一趟的 `report.json`（本轮 15:2x 就这么差点把 15:13 的旧读数当新读数）。
