/**
 * 门禁：**每一端的用户旅程都有可执行验收**（W6）
 * ================================================
 *
 * ## 它防的是什么
 *
 * 产品负责人的要求是「让所有的端，他们的用户旅程都是**统一的、完整的**」。
 * 但"完整"这件事**没有任何门禁看得见** —— 本仓已经有 16 道 `check:*`，
 * 它们全都在验**代码对不对**，没有一道在问**用户在这一端能不能走完**。
 *
 * 实测的现状（2026-09-29）：`apps/web` 有完整的旅程验收，
 * 而 `apps/desktop-macos` / `-windows` / `-linux` 只有**任务 CRUD** 的壳冒烟 ——
 * 它们**没有注册/登录、没有同步**，旅程是断的，而所有门禁一路绿灯。
 * 这正是本仓反复记过的那类失效："代码是对的，用户没有入口"。
 *
 * ## 判据：**登记制**（照 `packages/op-log` 的 `UNMODELED_ENTITY_TYPES`）
 *
 * 不要求"现在全都覆盖"（那会让门禁立刻变红、然后被人改松）。
 * 要求的是：**每一端要么有覆盖，要么在 `REGISTERED_GAPS` 里显式登记**，
 * 写明"缺什么、为什么、什么时候到期"。
 *
 * 于是两种失效都会**变红**：
 *
 *   1. **有端既没覆盖也没登记** —— 有人新增了一个端，忘了想旅程的事；
 *   2. **登记已经过期**（那一端其实已有覆盖）—— 登记不会烂在那里没人管。
 *
 * 🔴 第 2 条是关键，也是这套登记制唯一的价值：**实现后必须把登记移掉**。
 * 少了它，登记表会一年比一年长，而没人知道哪些还成立。
 *
 * ⚠️ **第 1 条原来是抓不住的，而本轮亲测**：`ENDPOINTS` 是一张手写清单，
 * 于是"忘了想旅程的那个端"恰好**不在清单上、也就永远不会红** ——
 * 它实际漏掉了 `apps/node-host`（此前**根本没有认证命令**）和 `apps/desktop`
 * （此前**连身份入口都没有**）。修法是把判据钉到文件系统上：见下面
 * `END_TO_DIR` / `NOT_AN_END` 那段（④），已用"凭空造一个 `apps/fake-end/`"验证会红。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 每一端的旅程验收入口。
 *
 * `specs` 是**真正能跑的东西**（测试文件 / 脚本），不是"应该有"。
 * `covers` 只用于报告，不参与判定。
 */
const ENDPOINTS = [
  {
    end: 'web',
    /**
     * 🔴 **旅程验收**：从"未登录冷启动"出发，走完注册/登录并拿到令牌的那类断言。
     * 这才是本门禁关心的东西。
     */
    journeySpecs: [
      'apps/web/tests/signin-entry.spec.tsx', // J1 前置：≤1 次点击
      'apps/web/tests/pending-login.spec.ts', // J2 邮件链接回跳 → 令牌
      'apps/web/tests/credential-storage.spec.ts', // J5 登录后重开还在
      'apps/web/tests/auth-panel.spec.tsx', // J2/J3/J7 注册登录与中性文案
      'apps/web/tests/store-copy.spec.tsx', // J6 未配服务器不阻塞
      // 🔴 真浏览器 + 真服务端的**整条**旅程（注册 → 登录 → 同步 → 新设备 → 退出）。
      //    上面 5 个是 jsdom 逻辑层；这一条证明"一个新用户真的能走完"。
      //    由 `pnpm verify:web-auth`（scripts/verify-web-auth-journey.mjs）驱动，
      //    刻意不进 `pnpm check`（要本机 Postgres + 真服务端，与 verify:multi-end 同理）。
      'e2e/auth-journey/auth-journey.spec.ts',
      // 注册旅程里「条款可达」那一步：真浏览器里点注册面板上的两条链接，
      // 官方域 ⇒ 落地页 `/legal/*`、自建域 ⇒ `<baseUrl>/privacy.html`（没配就是真 404）。
      // 由 `pnpm verify:legal-links` 驱动（刻意不进 `pnpm check`，理由写在
      // `e2e/playwright.legal-links.config.ts` 文件头）。⚠️ 官方域那一侧目前由
      // `context.route()` 顶替到本地构建产物 —— 线上发布后要删掉那条转发（G-25）。
      'e2e/legal-links/legal-links.spec.ts',
      // 🔴 **邮箱 + 口令**这一条路的真浏览器旅程（注册 → 真的那一封信 → 确认页 →
      //    落到 `/app/` → 退出 → 只用口令再登录 → 暗色下的登录态）。
      //    与上面 `auth-journey` 的分工：那条走**通行密钥**且服务端 `TEST_MODE` 开
      //    （邮箱自动验证、不发真信），所以它**判不到**"这一封信真的存在"那一格。
      //    由 `pnpm verify:password-web` 驱动（服务端 `TEST_MODE` **关** + 同源反代，
      //    理由写在 `e2e/playwright.password-web.config.ts` 文件头），刻意不进 `pnpm check`。
      'e2e/password-web/password-journey.spec.ts',
      'scripts/verify-password-web-journey.mjs',
    ],
    shellSpecs: [],
    covers: 'J1–J7 全覆盖（jsdom 逻辑层）+ 真浏览器整条旅程（e2e/auth-journey，verify:web-auth）',
  },
  {
    end: 'mobile',
    /**
     * 🔴 **2026-10-03 补齐登记**：这一条原先只有 2 个入口（`auth-flow.spec.ts` +
     * `verify-mobile-auth.sh`），而仓库里已经有 20 多个**真机零 mock 验收脚本**跑过
     * 了完整的用户旅程（清单/标签跨设备、冲突解决、自动同步、备份还原、提醒投递…）。
     *
     * 入口没登记 ≠ 验收不存在 —— 但**门禁看不见它就是没有**：这正是本文件开头那条
     * 失效形状（"手写清单漏掉的不是细节，是整个条目"）在移动端的第二次现形。
     *
     * 收录判据（三条同时成立才登记，避免把这里变成脚本目录的复制品）：
     *   ① 有 `pnpm verify:*` 别名（否则不是可复跑的入口）；
     *   ② 真模拟器/真机 + 真服务端，**零 mock**；
     *   ③ 验的是一段**用户旅程**（能从界面点进去走完），不是单个组件的渲染。
     * 每条后面的注释是它验的那一段，`covers` 只用于报告。
     */
    journeySpecs: [
      'apps/mobile/tests/auth-flow.spec.ts',
      // J1–J7 身份与凭据
      'scripts/verify-mobile-auth.sh',
      'scripts/verify-mobile-account.sh', // 改密码 / 通行密钥管理（凭据页）
      // 写入 → 跨设备读到同一条
      'scripts/verify-mobile-task-edit.sh', // 任务可编辑（截止/优先级/重命名/删除）
      'scripts/verify-mobile-task-row.sh', // 任务行的一次点击
      'scripts/verify-mobile-lists.sh', // 清单：手机建 → 归入 → 笔记本读到同一 projectId
      'scripts/verify-mobile-tags.sh', // 标签：实体 + 任务引用，两端四层判据
      'scripts/verify-mobile-conflict.sh', // 并发冲突在界面上解决
      'scripts/verify-mobile-autosync.sh', // 全程不点同步按钮，写入也必须自己出去
      'scripts/verify-mobile-restore.sh', // 备份还原（只还原到空库）
      'scripts/verify-multi-end-sync.sh', // Web ↔ 服务端 ↔ 笔记本三相（移动数据的对端）
      // 视图与交互
      'scripts/verify-mobile-calendar.sh',
      'scripts/verify-mobile-timeline.sh',
      'scripts/verify-mobile-inbox.sh',
      'scripts/verify-mobile-schedule.sh',
      'scripts/verify-mobile-sort-sheet.sh', // 排序面板
      'scripts/verify-mobile-quadrant-fill.sh', // 四象限铺满（Yoga 盒模型那一侧）
      'scripts/verify-universal-slice.sh', // 共享 UI 切片在移动壳里成立
      // 平台特性
      'scripts/verify-mobile-focus.sh', // 专注（番茄钟）闭环
      'scripts/verify-mobile-repeat.sh', // 重复规则 + 勾选顺延
      'scripts/verify-mobile-repeat-custom.sh', // 自定义重复（含跨年）
      'scripts/verify-mobile-capture.sh', // 快速捕捉 → 收集箱
      'scripts/verify-mobile-ticktick-import.sh', // 外部导入
      'scripts/verify-mobile-reminder-ring.sh', // 提醒到点：OS 通知栏真出现
      'scripts/verify-mobile-ios.sh', // iOS 输入侧全链路 + 零点击自动同步
    ],
    shellSpecs: [],
    covers:
      'J1–J7 全覆盖（真模拟器 + 真服务端，零 mock）：身份注册/登录 → 凭据管理 → 写入并跨设备读回同一条 → ' +
      '冲突解决 → 零点击自动同步 → 备份还原 → 六个视图 → 专注/重复/提醒投递，Android 与 iOS 两端',
  },
  {
    end: 'macos',
    /**
     * ⚠️ **这两个是"壳冒烟"，不是"旅程验收"** —— 它们证明"壳能起、
     * 跨语言通路通、窗口画出来了"，**不证明用户能注册/登录/同步**。
     * 门禁第一版把两者混为一谈，于是把"有壳冒烟"当成了"有旅程验收"，
     * 与下面登记的缺口直接打架 —— **那条红是本门禁自己抓出来的**。
     */
    journeySpecs: [],
    shellSpecs: ['scripts/check-macos-shell.mjs', 'scripts/check-macos-window.mjs'],
    covers: '仅壳能起 + 跨语言通路 + 窗口画出来',
  },
  {
    end: 'windows',
    /**
     * 🔴 **2026-09-30：windows 从"已登记缺口"变成真实入口。**
     *
     * 被测界面是 `apps/desktop-windows` 的 WinUI 3 壳里 **WebView2 加载的
     * 真应用**（`apps/web/dist`）—— Playwright **不启动任何浏览器**，
     * 它经 CDP 附着到那台机器上已经跑着的壳（`windows-pc` 的交互式桌面会话）。
     *
     * 由 `pnpm verify:windows-auth`（`scripts/verify-windows-shell-journey.mjs`）驱动，
     * 刻意**不进** `pnpm check`：它要一台可达的 Windows 机 + 本机 Postgres，
     * 与 `verify:web-auth` / `verify:multi-end` 同理。
     */
    journeySpecs: [
      'e2e/windows-shell/auth-journey.spec.ts',
      'scripts/verify-windows-shell-journey.mjs',
    ],
    shellSpecs: ['scripts/check-windows-shell.mjs'],
    covers:
      'W1–W6 全覆盖（真壳的真应用）：注册 → 登录（令牌落盘）→ 同步上行（服务端数 op）→ 新设备恢复 → 退出登录 → 失败可见 + 身份门',
  },
  {
    end: 'linux',
    journeySpecs: [],
    shellSpecs: ['scripts/check-linux-shell.mjs'],
    covers: '仅壳能起 + 跨语言通路（且本机平台外会响亮跳过）',
  },
  {
    end: 'node-host',
    /**
     * 🔴 **2026-10-02：这一端此前根本没有认证命令** —— 不是"没接好"，
     * 是 `cli.ts` 的 `case` 分支里**一条都没有**。于是它作为"第三个宿主"
     * （以及所有真 SQLite 取证的操作面）只能靠手工 curl 造凭据，
     * 而"这台设备能不能自己走完注册/登录"这件事**没有任何验收看得见**。
     *
     * 现在走的是 `heyta auth register` / `auth login`（`src/cli-auth.ts`）。
     * 三条不能弯的规矩，全部有判据：
     *   · 口令**只从 stdin 读**（写进 argv 会留在 `ps` 与 shell 历史里）；
     *   · 没给 `--terms` 时**一个请求都不发**（不替用户勾同意）；
     *   · 失败**只按机器码分类**，绝不把服务端的句子原样印到终端。
     *
     * ⚠️ **边界（别读多）**：2026-10-02 之前这一端**只有逻辑层**验收 ——
     * 注入的假 fetch 钉住分类/闸门/输出，而"真服务端那一跑"没人走过。
     *
     * 🔴 **那条边界已经在 2026-10-02 关掉**（`scripts/verify-email-password-chain.mjs`，
     * 计划 §9e）：真 Postgres + 真 Argon2id + 真发出去的那一封信 +
     * 真把令牌喂给 `sync` 并让**第二台设备**读到那条任务。
     * 所以 `covers` 现在写的是"逻辑层 + 真链路"，而不是"待 W9"。
     * 它的能失败性由 `scripts/mutate-password-chain.mjs` 回答：四条变异，
     * 每条要求**对应那一格**变红（整条变红不算 —— 那只能证明某一格坏了）。
     */
    journeySpecs: [
      'apps/node-host/tests/cli-auth.spec.ts',
      // 🔴 判据**能失败**的证据（九条变异，逐条还原后 sha256 比对）。
      'scripts/mutate-node-host-auth.mjs',
      // 🔴 真链路（零浏览器）：CLI 注册 → 真信 → 403 → 验证 → 登录拿令牌 →
      //    上行被服务端数出 → 新设备读到同一条 → 假成功不覆盖凭据 → 锁给具体秒数。
      'scripts/verify-email-password-chain.mjs',
      'scripts/mutate-password-chain.mjs',
    ],
    shellSpecs: [],
    covers:
      '注册/登录两条路：逻辑层 26 条 + 九条变异（同意闸门前置、四类失败不互相泄漏、' +
      '四种策略拒绝动作各异、两个秘密不混淆），外加真链路 12 格 + 四条变异' +
      '（真发信、真 Argon2id、令牌喂给真同步并被第二台设备读到）',
  },
  {
    end: 'desktop',
    /**
     * ⚠️ 与 macos / linux 同一类：`e2e/tests/desktop-window.spec.ts` 证明的是
     * **壳能起、窗口画出来**，而壳里渲染的只有 `HeytaUiProvider + TaskList`
     * —— **一个身份入口都没有**。
     */
    journeySpecs: [],
    shellSpecs: ['e2e/tests/desktop-window.spec.ts'],
    covers: '仅壳能起 + 窗口渲染（是自动化桌面 GUI 门禁的载体，不是旅程）',
  },
];

/**
 * 已登记的缺口。
 *
 * 🔴 **每一端都要么在上面有 specs、要么在这里有一条** —— 这是本门禁的全部判据。
 * 🔴 **实现之后必须把这里删掉**，否则门禁会报"登记已过期"。
 */
const REGISTERED_GAPS = [
  {
    end: 'macos',
    /**
     * 🔴 **2026-09-29 收窄、2026-09-30 改锚点**：原来写的是"注册/登录、同步、
     * 以及除任务 CRUD 以外的视图"。而现在**身份入口已经有常设验收了** ——
     * `check:macos-window` 会启动壳、断言壳里的真应用在冷启动第一屏就画出
     * **身份入口头像**（M2-macOS），并进一步断言**打开菜单后第一项是
     * 登录/注册、且未登录时没有「退出登录」**。
     * 所以缺口只剩**入口之后**的那一段。
     */
    missing: '注册/登录之后的链路（拿令牌、同步、真数据落在壳的 SQLite）',
    why: '按 ADR-0037，桌面 UI 走 **M2**（原生壳 + 内嵌共享 Web UI）。⚠️ 本条原来写的是「等 M1a（RNW 内容岛）跑通」—— **那条路线已被 S1 实测否掉**（补上它要求的 MSVC v145 后仍崩、无窗口），所以到期条件必须改指 M2，否则它引用的是一条不存在的路',
    expiry: '把真应用的存储接到壳的 SQLite 之后（M2-D 已证明「真应用 + 注册/登录前置」成立，差的是存储归属；见 docs/research/spikes/m2-webview-shell/）',
  },
  /*
   * ⚠️ **windows 的那条登记已于 2026-09-30 移掉** —— 它现在有真实旅程入口了
   * （见上面 ENDPOINTS 里的 `e2e/windows-shell/auth-journey.spec.ts` +
   * `scripts/verify-windows-shell-journey.mjs`，由 `pnpm verify:windows-auth` 驱动）。
   * 这正是登记制的设计：**实现之后必须把登记删掉**，否则红的是"登记已过期"。
   *
   * 🔴 **但有一块仍然没成立，而且本门禁看不见它**（所以写在这里，不装作没有）：
   *   壳里的真应用用的是 **WebView2 自己的 IndexedDB** 存储，
   *   **不是壳的 SQLite** —— 两者是两份数据。M2-D 的已知边界，见
   *   `docs/research/spikes/m2-webview-shell/README.md` §4d 与
   *   `docs/plans/user-journey-and-auth.md` 的矩阵。
   *   把"真应用的存储指到壳的 SQLite"是**下一步**，不在本次验收的结论里。
   */
  {
    end: 'linux',
    missing: '注册/登录、同步、以及除任务 CRUD 以外的视图',
    why: '同上（**ADR-0037**）+ 仍然没有 Linux 桌面用户的证据',
    expiry: '同上',
  },
  {
    end: 'desktop',
    missing: '注册/登录（邮箱+口令、通行密钥）与同步设置 —— 壳里渲染的只有 HeytaUiProvider + TaskList，没有任何身份入口',
    why: 'ADR-0024 的原选型已降级为**过渡壳**，且**退役时点已定**（AGENTS §2 的仓库地图：等三个原生壳的壳级门禁替换掉 `e2e/tests/desktop-window.spec.ts` 的断言之后，见 multi-end-unified-strategy §6.3-T3）。给一条注定退役的路线补认证界面 = 再养一份与 `apps/web` 平行的表单接线，而它唯一不可替代的价值是当**自动化桌面 GUI 门禁的载体** —— 那个价值不需要登录态',
    expiry: '两条到期方式，先到先算：① 壳退役 ⇒ 本条连同 `apps/desktop` 一起删掉；② 若结论改成"Electron 要继续当桌面端" ⇒ 必须补身份入口（照 `apps/web/src/features/auth/AuthPanel.tsx` 的薄壳做法，共享的 `AuthForm` 已在 `packages/ui`，代价只有一个文件）',
  },
];

/**
 * 🔴 失效 ①「有人新增了一个端，忘了想旅程的事」**在这份门禁写完的第一天是抓不住的**，
 * 而把它抓出来的正是本轮：`ENDPOINTS` 是**手写的清单**，所以它漏掉的不是某个细节，
 * 而是**整个 `apps/node-host` 与 `apps/desktop`** —— 一个"根本没有认证命令"的宿主
 * 和一个"连身份入口都没有"的壳，**都既没被列进清单、也就不会被判红**。
 * 手写清单的失效形状，和它要防的那个失效一模一样。
 *
 * 所以这一段把判据**钉到文件系统上**：`apps/*` 里出现的每一个目录，
 * 要么被某一条 `ENDPOINTS` 认领，要么在 `NOT_AN_END` 里写明"它为什么不是一个端"。
 *
 * ⚠️ 这里用**映射表**而不是给 `ENDPOINTS` 加 `dir` 字段，是为了不碰那些正在被
 * 别的会话改的条目；代价是"端名 → 目录"多了第二处要维护的地方 ——
 * 而它**漂移了会报红**（下面 ④-b 两条反向检查），不会静默。
 */
const END_TO_DIR = {
  web: 'web',
  mobile: 'mobile',
  macos: 'desktop-macos',
  windows: 'desktop-windows',
  linux: 'desktop-linux',
  'node-host': 'node-host',
  desktop: 'desktop',
};

/** 明确"不是一个端"的目录 —— 它不认领 `ENDPOINTS`，但理由必须写出来。 */
const NOT_AN_END = [
  {
    dir: 'landing',
    why: '落地页是**营销面**，不是使用端：它没有登录态，注册/登录的产品入口在 `apps/web`',
  },
];

const appDirs = readdirSync(join(ROOT, 'apps'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .sort();

let bad = false;
const claimed = new Set(Object.values(END_TO_DIR));

for (const { dir, why } of NOT_AN_END) {
  if (!existsSync(join(ROOT, 'apps', dir))) {
    console.error(`❌ 门禁自己的登记过期：NOT_AN_END 里的 apps/${dir} **已不存在**。`);
    console.error(`   （写着的理由是「${why}」）⇒ 目录没了就把这条删掉。`);
    bad = true;
  }
  claimed.add(dir);
}

// ④-a `apps/` 里有目录没被认领 ⇒ 红（这才能让"新增一个端忘了想旅程"真的变红）
for (const dir of appDirs) {
  if (!claimed.has(dir)) {
    console.error(`❌ **apps/${dir} 既不在 ENDPOINTS、也不在 NOT_AN_END** —— 它是什么？`);
    console.error('   要么它是一个端：补一条 ENDPOINTS（有旅程验收）或 REGISTERED_GAPS（登记缺口）；');
    console.error('   要么它不是一个端：在 NOT_AN_END 里写明理由。');
    bad = true;
  }
}

// ④-b 两处清单对不上 ⇒ 红（端被删/改名、或映射写错，都不会静默）
for (const [end, dir] of Object.entries(END_TO_DIR)) {
  if (!existsSync(join(ROOT, 'apps', dir))) {
    console.error(`❌ 门禁自己的登记过期：ENDPOINTS 的 '${end}' 指向 apps/${dir}，而它**不存在**了。`);
    bad = true;
  }
  if (!ENDPOINTS.some((entry) => entry.end === end)) {
    console.error(`❌ END_TO_DIR 里有 '${end}'，但 ENDPOINTS 里没有这一条 —— 两处对不上。`);
    bad = true;
  }
}
console.log(`   （apps/ 下 ${String(appDirs.length)} 个目录，全部已被认领或显式排除）`);

for (const { end, journeySpecs, shellSpecs, covers } of ENDPOINTS) {
  const all = [...journeySpecs, ...shellSpecs];
  const missingFiles = all.filter((f) => !existsSync(join(ROOT, f)));
  const registered = REGISTERED_GAPS.find((g) => g.end === end);

  // ① 声明的文件必须真的在（入口被删/改名 ⇒ 不能还算"有验收"）
  if (missingFiles.length > 0) {
    console.error(`❌ ${end}：声明的入口**不存在** —— ${missingFiles.join(', ')}`);
    bad = true;
    continue;
  }

  // ② 有旅程验收 / 还是没有 —— 只看 journeySpecs，**壳冒烟不算**
  const hasJourney = journeySpecs.length > 0;

  if (!hasJourney && registered === undefined) {
    console.error(`❌ ${end}：**既没有旅程验收、也没有登记缺口**。`);
    console.error('   （壳冒烟不算旅程验收 —— 它不证明用户能注册/登录/同步。）');
    bad = true;
    continue;
  }

  // ③ 登记过期：已经有旅程验收了，登记还留着 ⇒ 红（这是登记制唯一的价值）
  if (hasJourney && registered !== undefined) {
    console.error(`❌ ${end}：**登记已过期** —— 它已经有旅程验收了，但 REGISTERED_GAPS 里还留着。`);
    console.error(`   登记的缺口：${registered.missing}`);
    console.error('   ⇒ 实现之后必须把登记移掉，否则登记表会一年比一年长而没人知道哪些还成立。');
    bad = true;
    continue;
  }

  if (hasJourney) {
    console.log(`✅ ${end}：有**旅程**验收（${journeySpecs.length} 个）—— ${covers}`);
  } else {
    console.log(`🟡 ${end}：**已登记旅程缺口** —— ${registered.missing}`);
    console.log(`     壳冒烟 ${shellSpecs.length} 个（不抵旅程验收）`);
    console.log(`     理由：${registered.why}`);
    console.log(`     到期：${registered.expiry}`);
  }
}

// ② 报告里也要有"这些验收真的能跑"的证据之一：把 web 的旅程 spec 真跑一遍。
//
// 🔴 只跑 web：它是**今天唯一一条完整的旅程**，跑它能证明"验收入口不是摆设"。
//    其它端的入口各有各的前置（模拟器 / 图形会话 / Windows），
//    由它们自己的 `check:*` / `verify:*` 负责（本门禁只保证"入口存在且被登记"）。
if (!bad) {
  console.log('');
  console.log('   —— 抽查：web 的旅程验收真的能跑 ——');
  try {
    execFileSync(
      'pnpm',
      [
        '--dir',
        'apps/web',
        'exec',
        'vitest',
        'run',
        'tests/signin-entry.spec.tsx',
        'tests/pending-login.spec.ts',
        'tests/credential-storage.spec.ts',
        '--reporter=dot',
      ],
      { cwd: ROOT, stdio: 'inherit' },
    );
    console.log('   ✅ web 旅程验收跑通。');
  } catch {
    console.error('❌ web 的旅程验收**跑不过** —— 入口在，但它不成立。');
    bad = true;
  }
}

if (bad) {
  console.error('');
  console.error('❌ 旅程覆盖门禁未通过。');
  process.exit(1);
}

console.log('');
console.log('✅ 每一端要么有旅程验收、要么有**显式登记**的缺口（含理由与到期条件）。');