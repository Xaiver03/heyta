/**
 * 登录/注册表单里，**相邻两个控件**之间的垂直间距必须落在设计系统那一格上
 * ========================================================================
 *
 * ## 它补的是哪一格
 *
 * `packages/ui/src/auth/AuthForm.tsx` 的表单节奏有两层，各自一个值：
 *
 *  - `root` 的 `gap: space.3`（12px）—— **控件与控件**之间；
 *  - `field` 的 `gap: space.1`（4px）—— **一个控件内部**（标签 ↔ 输入框 ↔ 错误提示）。
 *
 * 这两层各自都对，坏在**放错容器**：一个本该是"下一个控件"的东西被写进了 `field` 里，
 * 于是它只拿到 4px。这个形状在本文件里已经出现过三次，前两次都是产品负责人**当面指出**的：
 *
 *  - 2026-10-02「这两个继续这个按钮怎么跟上面那个框隔得那么近呢？」⇒ `primary` 补 `marginTop`
 *    （理由的全文在 `AuthForm.tsx` 里 `primary` 的注释，本文件不重述）；
 *  - 2026-10-26「记住密码的框之间的距离太近了」⇒ `termsRow` 同法补上。
 *
 * 两次都是**人眼看截图看出来的**，而仓库里没有任何一枚尺量过"相邻控件间距"。
 * `pnpm check:design` 判的是裸值（`gap: 4` 这种），而这里每一处写的都是合规的
 * `tokens['space.1']` —— 用错档位不是裸值，任何裸值门禁都看不见它。
 * `check:form-anatomy` 判的是标签解剖，也不判间距。⇒ 本文件补的就是这一格。
 *
 * ## 判据
 *
 *  ① 每一对"独立控件 ↔ 下一个独立控件"的实测间距必须 ≥ `space.3`（12px，容差 0.5px）。
 *     逐条打分再一起断言（不用一条接一条的 `expect`：第一条红会让后面的判据这一趟**根本没被判**）。
 *  ② **探针**：每一对都必须拿得到两个矩形。拿不到记为失败而不是跳过 ——
 *     一个选择器改名会让这条判据静默退化成"没东西可判 ⇒ 绿"。
 *  ③ **不判**标签 ↔ 输入框（那正是 4px 的正确形状）。判据的对象只有跨控件的那几段，
 *     否则这条尺会在合规的地方造红。
 *  ④ 文字按钮那一列判**高度 ≥ 44px**（`MASTER.md` 的触控目标那条），不判它们的间距数：
 *     它们住在 4px 容器里是**事实**，判掉的理由是点击区撑开了视觉距离 —— 那就把这个理由量住。
 *     墨迹间距只报数不判，因为没有任何一条明文规则规定"两行文字之间要隔几 px"，
 *     而现编一个阈值就是往仓库里放一枚没有出处的尺。
 *     🔴 这一条的能红性是**量过**的（2026-10-27）：把 `textAction` 的 `minHeight` 从
 *     `touch-target.min` 换成 `space.5` 重跑 ⇒ 两档各 4 条 ④ 红，盒子高实测 29px，
 *     而**同一趟里墨迹间距从 27px 掉到 12px** —— "点击区一收，4px 盒子间距就真贴脸"
 *     这句不是推断。还原后 2 passed（还原只从本轮自己写的 `.teeth-bak`，不从 git）。
 *
 * ## 同族扫描里被**判掉**的两处（登记结论，免得下一个人重新怀疑一遍）
 *
 *  - `AuthForm` 自托管档「粘贴令牌 → 验证」按钮：形状看着一样（也在 `field` 里、也拿 4px），
 *    但那枚按钮的 `onPress` 是 `onVerifyToken(token)` 并立刻清空**那一个**输入框 ——
 *    它是那根控件自己的动作，不是表单里的下一个控件 ⇒ 4px 是对的。
 *    ⚠️ 另外它在 `allowAdvanced = false`（默认）下根本不渲染，本条也量不到。
 *  - `apps/web/src/features/tasks/TaskRepeat.tsx` 的 `<fieldset>`：**这一处当初被我判成合规，
 *    判错了**。实测 6 行单选之间 4px、`<legend>` 到第一行 **0px**（`legend` 在 flex 容器里
 *    不是 flex item，容器那个 `gap` 管不到它）—— 与用户报的是同一个形状，已改。
 *    它的复测判据在 `e2e/tests/checkbox-group-spacing.spec.ts`。
 *
 * 判据的分母因此**只有**"独立控件 ↔ 下一个独立控件"那几对：本文件里被产品负责人
 * 当面指出过的两例（`primary` 与 `termsRow`）都属于这一类，被上面两处都不属于。
 *
 * ## 2026-10-27 那次全仓扫描：分母与结论都记在这儿
 *
 * 扫了 `packages/ui/src/**` + `apps/web/src/**` 约 **120 处** 4px 及以下的间距站点
 * （`gap: tokens['space.1']`，含裸值与 space.0），进入候选 **9 处**。
 * 🔴 结论**改过一次**，改的原因值得留着：第一版按读代码判成"9 处全部不是缺陷"，
 * 而其中两处（`TaskOrganizer` 的标签多选、`TaskRepeat` 的重复单选）拿一次性探针**实测**
 * 之后是 **4px 行距 + 分组标题到第一行 0px** —— 与你两次当面指出的形状同一个。
 * 那两处已按同一句改掉，判据在 `e2e/tests/checkbox-group-spacing.spec.ts`（那里也写了
 * 为什么 `TaskRepeat` 不进它的分母）。**教训：读代码判"贴脸不贴脸"不成立，这类必须量。**
 *
 * ### 第二套面：服务端渲染的那五张页（不在上面 120 处的分母里）
 *
 * `packages/ui` 与 `apps/web` 之外还有一批表单 —— 邮件点开的凭据页，样式在
 * `server/src/design-html.ts` 的内联 `<style>` 里，**跟 React 那套 token 不同源**。
 * 2026-10-27 用真 Chromium 逐张量过（1440 与 375 两档；先在真线上量，后用本地
 * `pageRoutes` inject 出的同一份标记复量，两把读数一致）：**找到一处，已改** ——
 * 重置页「至少 8 个字符…」那行提示到「保存新密码」按钮**间隙 0px**（文字压在按钮上沿），
 * 补上 `.hint + .btn` 之后两档都是 **16px**；摘掉那半条规则再量，读数回到 0 ⇒ 判据能红。
 * 其余四张页各只有一个按钮、上方留白 55~110px，输入框高 44~46、按钮高 48（都过 44 那一档）。
 * 常驻守卫在 `server/tests/password-reset-page.spec.ts`（那里记了同一组读数）。
 *
 * ### 第四套面：邮件正文本体（`renderEmail`，不是它点开的那张页）
 *
 * 这一格的结论是**结构级的**，证据类型与上面三套不同，写清楚免得被读成"量过了"：
 * 一封邮件正文里**只有一枚可点控件**（现量：
 * `awk 'NR>=158 && NR<=207' server/src/design-html.ts | grep -cE '<a href'` = 1，
 * `<button|<input|<form` = 0）⇒ "两枚相邻独立控件贴脸"这个形状在这里**没有实例可量**；
 * 而每一块 `<td>` 自己声明了上留白，声明值逐枚枚举是
 * `space.8 / space.4 / space.3 / space.6 / space.4`（最小那枚 `space.3` = 12px，
 * 按钮那一格是 `space.6` = 24px），全部走 token、没有裸值。
 * ⚠️ 这一格**没有**渲染像素读数：邮件的渲染器是客户端（Outlook/Apple Mail 各自重排
 * table），不是 Chromium，本机没有那条渲染通道。所以这句是"控件计数 + 声明值枚举"，
 * 不是"两档宽度量过"。谁要把它升级成像素级，得先接一枚真客户端的取数装置。
 *
 * ⚠️ **第三套面本轮没量到：移动壳（`apps/mobile`，React Native）**。
 *   先说清一件不需要量就能定的事：移动登录屏**没有「记住密码」这一枚控件**
 *   （`apps/mobile/src/screens/AuthScreen.tsx` 里既没有该文案，也不渲染共享 `<AuthForm>`，
 *   只借它的类型 ⇒ 现量 `grep -n "<AuthForm\\|remember\\|记住" apps/mobile/src/screens/AuthScreen.tsx`
 *   只回一行 `useState<AuthFormMode>`）。所以用户报的那个形状在移动上不成立；
 *   未判定的是**别的** RN 表单的间距。
 *   登记成"未判定"而不是"合规"，因为按上面那条教训，没量的面不许写结论。
 *   判它的断言就是本文件 ①③ 那两对（独立控件↔独立控件 ≥ `space.3`、触控目标 ≥ 44）
 *   搬到 RN 的读数上。**取数路径不是"以后再找"，仓内已有现成先例**（10-27 现量）：
 *   `apps/mobile/src/ai/AssistantScreen.tsx:289` 就在用
 *   `onLayout={() => ref.current?.measureInWindow((_x, y) => …)}` 把布局变成数字
 *   ⇒ 补这一格最便宜的一条腿是：对相邻两枚控件各取一次 `measureInWindow` 的 `y`/`height`，
 *   差值就是本文件 ① 那把尺量的同一个量（**注意 RN 里没有 `measureInRow` 这个 API**，
 *   我之前在这段里写错了名字，会让人白找一个函数；真的那两个是
 *   `measureInWindow` 与 `measureLayout`）。
 *   跑动装置与 `docs/agents/multi-end-build.md` 那四端重装共用（iOS 那端可在本机模拟器量；
 *   Android 的构建与设备量要在打包机上跑，见那一节载体）。
 *   ⚠️ 另外两条现量事实，省得下一个人重复摸：`apps/mobile/package.json` 的
 *   `test = vitest run` —— **没有 Detox / Maestro 那类装置**，纯 JS 测试跑不出布局（Yoga 的
 *   计算结果不在 vitest 里暴露成像素），所以这一格确实只能走设备腿；
 *   `grep -rln 'detox\|maestro' apps/mobile/src` 现量为空。
 *   谁补这一格，请连**排除掉的那些**一起带读数，别只登记改掉的。
 *
 * 剩下 7 处判掉，逐条理由：
 * `AuthForm` 验证码屏 2 处（登录档 / 注册档同形）、二级链那一列 1 处、注册档同意项 1 处
 * （上面已记）、`FolderPicker` 触发↔自己的菜单、`HabitGoalEditor` 触发↔自己的展开面板、
 * `SubscriptionNotice` 里按钮的兄弟是说明文字不是控件。
 * 另核对 `CloseAccountPanel`、`CentralAccountConflictPanel`、`AuthPanel` 的复选框：
 * 宿主容器本来就是 space.3/space.4，没入网。
 *
 * 🔴 **验证码屏那两处 2026-10-27 曾经登记成"未判定"，理由是"这一屏要真服务端发挑战才渲染，
 *   e2e 装置里没有"—— 那句是错的**：错的是一次探针失误（没先填邮箱就点触发器，而触发器
 *   本身还住在折叠层里），同目录 `auth-login-code.spec.ts` / `auth-registration-otp.spec.ts`
 *   一直用 `page.route()` fulfill 一份假挑战让那一屏出现。现量：
 *   `grep -n "page.route(" e2e/tests/auth-login-code.spec.ts e2e/tests/auth-registration-otp.spec.ts`。
 *   那一格现在由本文件末尾那四条臂量着，读数（2026-10-27，真 Chromium、两档宽度各一次）：
 *     登录档 / 注册档 验证码屏：**验证码框 → 验证按钮 实测 12px**（两档相同，吃的是 `primary`
 *     自带的 `marginTop: space.2` 补偿），`-submit` / `-resend` / `-change-email` 三枚
 *     **盒子高都是 44px**（墨迹 20-21px），两枚文字链的**墨迹间距 27px**（只报数，不判）。
 *   ⇒ 那两处的判掉**不再靠代理读数**；谁把 `primary` 的补偿或 `textAction` 的 `minHeight`
 *     改掉，这四条会红。能红性 2026-10-27 现量证过：把 `textAction` 的
 *     `minHeight` 从 `touch-target.min` 单独改成 `space.4`（16px）重建 `@heyta/ui` 再跑这四项
 *     ⇒ **4 项全红**，报的就是 `④ …「-resend」「-change-email」实测高 29px < 44px`；
 *     从 `.mut-bak` 还原后整条尺复跑 **6 passed**（变异只动产品，没动过任何一条断言）。
 *   坑本身记在 `docs/reference/environment-traps.md`（"把探针失误登记成装置的限制"那一条）。
 *
 * 🔴 其中前三处（文字按钮那一族）判掉靠的是**同一句明文规则**：`MASTER.md` 的
 * "触控目标 ≥ 44×44px" —— 4px 是**盒子**间距，而盒子里只有中间那行字。
 * 这个理由本身由判据 ④ 量着（见 `SECONDARY_TEXT_ACTIONS`），不是"看着还行"。
 * 剩下六处按 `field`/同一控件的形状判掉，不需要一把新尺。
 *
 * 能红性（2026-10-26 实测，不是推断）：修之前跑本条，第 ① 对读到 **4px**、第 ③ 对读到
 * **4px**，两条一起报红；补上 `standaloneRow` 与 `textActionCenter` 的 `marginTop` 后三对都是 12px。
 *
 * 🔴 **改 `packages/ui/src/**` 之后必须 `pnpm --filter @heyta/ui build`**，否则本条量的是
 *    `dist/` 里的旧产物 —— `@heyta/ui` 的 `exports` 指向 `./dist/index.js`，Vite 读的是那一份。
 *    本轮第一跑就是这么骗过自己的：样式已改、判据仍报 4px，看起来像"我的修法无效"，
 *    实际是产物没跟上（与 `docs/reference/environment-traps.md` 里 i18n dist 那条同一族）。
 *
 * 量的对象是**合成后的视觉距离**，不是样式表里写的那个数：勾选框那一行还叠了
 * `termsCheckboxOffset` 的负 margin（让 22px 的框与 18px 行高垂直居中，行内对齐，合理）。
 *
 * 🔴 截图落固定路径、人必须打开看（§6.2）。`test-results/` 是运行产物，不是证据。
 */
import { existsSync, rmSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

import { openApp, openAuthPanel } from '../auth-journey/helpers.js';

const SHOTS = [
  'test-results/auth-form-spacing-1440.png',
  'test-results/auth-form-spacing-375.png',
  'test-results/auth-form-spacing-secondary-1440.png',
  'test-results/auth-form-spacing-secondary-375.png',
  'test-results/auth-form-spacing-code-screen-login-1440.png',
  'test-results/auth-form-spacing-code-screen-login-375.png',
  'test-results/auth-form-spacing-code-screen-registration-1440.png',
  'test-results/auth-form-spacing-code-screen-registration-375.png',
] as const;
const MIN_CONTROL_GAP = 12;
const TOLERANCE = 0.5;

/** 每一对都必须**视觉相邻**。⚠️ 注册档那两对在本轮被删掉了：
 *  「确认密码框 → 同意项」实测 **74px**、「同意项 → 注册按钮」**45px** —— 中间隔着
 *  密码强度条与邀请码框，所以拿这两个 testID 配对量到的**不是间距**，而是一段
 *  永远大于 12px 的跨元素距离 ⇒ 那条断言在任何缺陷下都不会红。
 *  按 `AGENTS.md` §5 元规则二（"一条永远通过的判据比没有判据更糟"）删掉，
 *  而不是留着当"注册档也覆盖了"的读数。注册档的同意项**当前没有间距判据**。 */
const PAIRS = {
  'sign-in': [
    ['auth-form-password', 'auth-form-remember-password', '密码框 → 记住密码'],
    ['auth-form-remember-password', 'auth-form-submit', '记住密码 → 登录按钮'],
    ['auth-form-submit', 'auth-form-switch-mode', '登录按钮 → 切换去注册'],
  ],
} as const;

/**
 * ## 同族扫描剩下的那一族为什么**不是**缺陷 —— 这一条判的是它的成立前提
 *
 * 扫描（≈120 处 `gap: space.1` 站点 → 9 处进入候选）里，判掉的多数长这样：
 * `AuthForm` 二级链那一列（`-passkey` / `-magic-link` / `-recovery`）、验证码屏下面那两枚
 * （`-login-code-resend` / `-login-code-change-email`）—— 它们**也**住在 4px 的容器里，
 * 盒子间距实测就是 4px。判掉的理由不是"看着还行"，而是一条**写在设计系统里**的规则：
 * `design-system/heyta/MASTER.md` §「触控目标 ≥ 44×44px」。文字按钮的 44px 是**点击区**，
 * 墨迹只占中间那 ~18px 一行 ⇒ 盒子贴脸不等于眼睛看贴脸。
 *
 * 🔴 所以这一条不许判"间距 ≥12"（那会在合规的地方造红），而判**那个理由本身**：
 *     每一枚的实测高度必须 ≥ 44px。它一旦变矮（比如谁把 padding 收掉），4px 盒子间距
 *     就真的变成贴脸 —— 那正是需要有人被叫醒的那一刻，而这里会红。
 *     墨迹间距只**报数**不判：没有一条明文规则给"两行文字之间要隔几 px"，
 *     我不会为了多一枚尺现编一个阈值。
 */
const SECONDARY_TEXT_ACTIONS = [
  'auth-form-passkey',
  'auth-form-magic-link',
  'auth-form-recovery',
  'auth-form-switch-mode',
] as const;
const MIN_TOUCH_TARGET = 44;
const MIN_TOUCH_TOLERANCE = 0.5;

test.beforeAll(() => {
  for (const shot of SHOTS) if (existsSync(shot)) rmSync(shot);
});

async function measure(dialog: import('@playwright/test').Locator, pairs: readonly (readonly string[])[]) {
  const readings: { label: string; gap: number | null; above: string; below: string }[] = [];
  for (const [aboveId, belowId, label] of pairs) {
    const above = await dialog.getByTestId(aboveId).boundingBox();
    const below = await dialog.getByTestId(belowId).boundingBox();
    readings.push({
      label,
      above: aboveId,
      below: belowId,
      gap: above && below ? Number((below.y - (above.y + above.height)).toFixed(2)) : null,
    });
  }
  return readings;
}

/**
 * 两档宽度各量一次。⚠️ 为什么是这两档、为什么**没有**暗色：
 *  - `auth-dialog.css:317` 有一条 `@media (max-width: 30rem)`（=480px）—— 窄屏那一档
 *    这个浮层的布局**换了一套规则**，所以 12px 这件事必须在两档各证一次；
 *  - 暗色**刻意不量**，而且这不是省事：`darkTokens` 只覆盖 `color.*`
 *    （现量：`sed -n '473,540p' packages/design-system/src/generated/tokens.native.ts`
 *    里非 color 的键为 0 枚），间距不参与主题 ⇒ 暗色那张图与亮色**逐字节相同**。
 *    本仓库已经在 `habit-month.spec.ts` R7 上吃过一次那种假绿
 *    （"名字比断言强"），所以这里不摆一枚不可能红的暗色臂。
 */
for (const [label, width, height, shot, shotSecondary] of [
  ['宽屏 1440', 1440, 900, SHOTS[0], SHOTS[2]],
  ['窄屏 375', 375, 812, SHOTS[1], SHOTS[3]],
] as const) {
  test(`登录档里每一对相邻独立控件的间距都在 12px 那一格上（${label}）`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openApp(page, '/', 'accepted');
    const dialog = await openAuthPanel(page);
    await dialog.getByTestId('auth-form').waitFor({ state: 'visible' });
    // 等弹窗淡入走完：动画中途的矩形还在位移，量出来的是过渡态而不是设计值。
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot, fullPage: false });

    const readings = await measure(dialog, PAIRS['sign-in']);
    console.log(`${label}：`);
    for (const r of readings) {
      console.log(`  ${r.label.padEnd(24)} ${r.gap === null ? '🔴 量不到' : `${String(r.gap)}px`}`);
    }

    const failures: string[] = [];
    for (const r of readings) {
      if (r.gap === null) {
        failures.push(`② ${label}「${r.label}」量不到矩形（${r.above} / ${r.below} 之一不在册）⇒ 探针失效，不是"没有缺陷"`);
      } else if (r.gap < MIN_CONTROL_GAP - TOLERANCE) {
        failures.push(
          `① ${label}「${r.label}」实测 ${String(r.gap)}px < ${String(MIN_CONTROL_GAP)}px（space.3）` +
            ` ⇒ 这个控件被放进了"控件内部"的容器（field 的 gap 是 space.1=4px），` +
            `修法照样式表里 primary 那条：挂 standaloneRow（4+8 落在 12 那一格）`,
        );
      }
    }

    // ── 二级链那一列：判的是"它凭什么叫不贴脸"那条规则本身（见文件头 SECONDARY 那段）──
    // DOM 顺序：切换去注册 → 通行密钥 → 收登录链接 → 找回。后三枚住在 4px 的容器里。
    // ⚠️ 这三枚默认**不在 DOM 里**：web 壳传了 `otherWaysToggle`，未展开时那一列整段不渲染
    //    （实测：直接 `boundingBox()` 会等到 60 s 超时，红的不是间距而是探针没点开那层）。
    const toggle = dialog.getByTestId('auth-form-other-ways-toggle');
    if ((await toggle.count()) > 0) await toggle.click();
    const COLUMN = ['auth-form-switch-mode', ...SECONDARY_TEXT_ACTIONS.filter((id) => id !== 'auth-form-switch-mode')];
    const inks: { id: string; box: { y: number; height: number } | null; ink: { y: number; height: number } | null }[] = [];
    for (const id of COLUMN) {
      const handle = dialog.getByTestId(id);
      const box = await handle.boundingBox();
      // 墨迹 = 这枚按钮**最后一个子节点**（那行链接文字）的矩形；第一枚在 passkey 那行是图标。
      const ink = await handle.locator('> *:last-child').boundingBox();
      inks.push({ id, box, ink });
    }
    await page.screenshot({ path: shotSecondary, fullPage: false });
    console.log('  二级链那一列（盒子间距是 4px，靠 44px 点击区撑开，所以判高度）：');
    for (const r of inks) {
      const h = r.box ? String(Number(r.box.height.toFixed(2))) : '🔴 量不到';
      const inkH = r.ink ? String(Number(r.ink.height.toFixed(2))) : '量不到';
      console.log(`    ${r.id.padEnd(28)} 盒子高 ${h.padStart(6)}px   墨迹高 ${inkH}px`);
    }
    for (let i = 1; i < inks.length; i += 1) {
      const a = inks[i - 1].ink;
      const b = inks[i].ink;
      const inkGap = a && b ? Number((b.y - (a.y + a.height)).toFixed(2)) : null;
      console.log(
        `    墨迹间距 ${inks[i - 1].id} → ${inks[i].id}: ${inkGap === null ? '量不到（只报数，不判）' : `${String(inkGap)}px`}`,
      );
    }
    for (const r of inks) {
      if (r.box === null) {
        failures.push(`② ${label}「${r.id}」量不到矩形 ⇒ 探针失效（这一列没渲染出来 ≠ 合规）`);
      } else if (r.box.height < MIN_TOUCH_TARGET - MIN_TOUCH_TOLERANCE) {
        failures.push(
          `④ ${label}「${r.id}」实测高 ${String(Number(r.box.height.toFixed(2)))}px < ${String(MIN_TOUCH_TARGET)}px` +
            ` ⇒ 触控目标那条规则（MASTER.md「≥ 44×44px」）破了，而它住在 gap=space.1 的容器里 ——` +
            ` 这枚一旦变矮，4px 盒子间距就真的变成贴脸`,
        );
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });
}

/**
 * ## 第三段：验证码屏 —— 把文件头那格「未判定」补成现量
 *
 * 文件头原先写过"这一屏要真服务端发挑战才渲染，e2e 装置里没有"，**那句是错的**：
 * 现成的机关一直在同目录另外两条尺里 —— `auth-login-code.spec.ts` 与
 * `auth-registration-otp.spec.ts` 用 `page.route` 把
 * `/api/login/email-code/request`、`/api/register/email-password/request` 拦下、
 * fulfill 一份带 `emailDelivered` 的挑战，那一屏就出来了。
 * 我先前探的是**没填邮箱**就去点触发器，于是读到 `isVisible()=false`，
 * 把一次探针操作失误登记成了装置的限制（教训记在 `docs/reference/environment-traps.md`）。
 *
 * 这一屏的控件全部住在同一个 `styles.field`（`gap: space.1` = 4px）里，
 * 和用户报的是**同一个形状**，所以判据照上面那两条走，不新造阈值：
 *  ① 验证码框 → 验证按钮：两枚**独立**控件 ⇒ 判合成视觉距离 ≥ 12px
 *     （`primary` 自带 `marginTop: space.2` 的补偿：容器给 4，补 8，落在 12 那一格）；
 *  ④ 「重新发送」「换邮箱」两枚文字链：盒子间距实测就是 4px，判掉靠的是
 *     `design-system/heyta/MASTER.md`「触控目标 ≥ 44×44px」那条明文规则
 *     ⇒ 这里判**那个理由本身**（实测高度 ≥ 44），墨迹间距只报数不判 ——
 *     与 `SECONDARY_TEXT_ACTIONS` 那一段同一把尺。
 *
 * 两档宽度各量一次的理由同上（`auth-dialog.css` 那条 `@media (max-width: 30rem)`）。
 */
function futureChallenge(id: string) {
  return {
    challengeId: id,
    expiresAt: Date.now() + 10 * 60 * 1000,
    resendAvailableAt: Date.now() + 60_000,
    emailDelivered: true,
  };
}

async function installChallengeRoutes(page: Page): Promise<void> {
  await page.route('**/api/login/email-code/request', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(futureChallenge('spacing-login-code')),
    });
  });
  await page.route('**/api/register/email-password/request', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(futureChallenge('spacing-registration-code')),
    });
  });
}

async function reachLoginCodeStage(dialog: ReturnType<Page['getByTestId']>): Promise<void> {
  await dialog.getByTestId('auth-form-email').fill('me@example.com');
  const toggle = dialog.getByTestId('auth-form-other-ways-toggle');
  if ((await toggle.count()) > 0) await toggle.click();
  await dialog.getByTestId('auth-form-login-code-trigger').click();
  await expect(dialog.getByTestId('auth-form-login-code-stage')).toBeVisible();
}

async function reachRegistrationCodeStage(dialog: ReturnType<Page['getByTestId']>): Promise<void> {
  await dialog.getByTestId('auth-form-switch-mode').click();
  await dialog.getByTestId('auth-form-email').fill('me@example.com');
  await dialog.getByTestId('auth-form-password').fill('correct horse battery');
  await dialog.getByTestId('auth-form-password-confirmation').fill('correct horse battery');
  await dialog.getByTestId('auth-form-terms').click();
  await dialog.getByTestId('auth-form-submit').click();
  await expect(dialog.getByTestId('auth-form-registration-code-stage')).toBeVisible();
}

/**
 * `kind` 就是那一屏的 testID 中缀（`login-code` / `registration-code`）：
 * 输入框 `auth-form-<kind>`、按钮 `-submit`、两枚文字链 `-resend` / `-change-email`。
 */
async function measureCodeScreen(
  dialog: ReturnType<Page['getByTestId']>,
  kind: string,
  screenLabel: string,
): Promise<string[]> {
  const input = await dialog.getByTestId(`auth-form-${kind}`).boundingBox();
  const submit = await dialog.getByTestId(`auth-form-${kind}-submit`).boundingBox();
  const failures: string[] = [];

  if (input === null || submit === null) {
    failures.push(`② ${screenLabel}：验证码框或提交按钮量不到矩形 ⇒ 探针失效，不是"没有缺陷"`);
  } else {
    const gap = Number((submit.y - (input.y + input.height)).toFixed(2));
    console.log(`  ${screenLabel}：验证码框 → 验证按钮 实测 ${String(gap)}px`);
    if (gap < MIN_CONTROL_GAP - TOLERANCE) {
      failures.push(
        `① ${screenLabel}「验证码框 → 验证按钮」实测 ${String(gap)}px < ${String(MIN_CONTROL_GAP)}px（space.3）` +
          ` ⇒ 这一屏的提交按钮没吃到 \`primary\` 那条 marginTop 补偿`,
      );
    }
  }

  for (const id of [
    `auth-form-${kind}-submit`,
    `auth-form-${kind}-resend`,
    `auth-form-${kind}-change-email`,
  ]) {
    const box = await dialog.getByTestId(id).boundingBox();
    const ink = box === null ? null : await dialog.getByTestId(id).locator('> *:last-child').boundingBox();
    console.log(
      `    ${id.padEnd(40)} 盒子高 ${(box === null ? '🔴 量不到' : `${String(Number(box.height.toFixed(2)))}px`)}` +
        `   墨迹高 ${ink === null ? '量不到' : `${String(Number(ink.height.toFixed(2)))}px`}`,
    );
    if (box === null) {
      failures.push(`② ${screenLabel}「${id}」量不到矩形 ⇒ 探针失效（这一枚没渲染出来 ≠ 合规）`);
    } else if (box.height < MIN_TOUCH_TARGET - MIN_TOUCH_TOLERANCE) {
      failures.push(
        `④ ${screenLabel}「${id}」实测高 ${String(Number(box.height.toFixed(2)))}px < ${String(MIN_TOUCH_TARGET)}px` +
          ` ⇒ 触控目标那条规则（MASTER.md「≥ 44×44px」）破了，而它住在 gap=space.1 的容器里 ——` +
          ` 这枚一旦变矮，4px 盒子间距就真的变成贴脸`,
      );
    }
  }

  // 墨迹间距只报数：没有一条明文规则规定两行文字之间要隔几 px。
  const inkBoxes: (import('@playwright/test').BoundingBox | null)[] = [];
  for (const id of [`auth-form-${kind}-resend`, `auth-form-${kind}-change-email`]) {
    inkBoxes.push(await dialog.getByTestId(id).locator('> *:last-child').boundingBox());
  }
  const inkGap =
    inkBoxes[0] && inkBoxes[1]
      ? Number((inkBoxes[1].y - (inkBoxes[0].y + inkBoxes[0].height)).toFixed(2))
      : null;
  console.log(`    两枚文字链的墨迹间距：${inkGap === null ? '量不到（只报数，不判）' : `${String(inkGap)}px`}`);

  return failures;
}

for (const [screenLabel, kind, width, height, shot, reach] of [
  ['登录档验证码屏 · 宽屏 1440', 'login-code', 1440, 900, SHOTS[4], reachLoginCodeStage],
  ['登录档验证码屏 · 窄屏 375', 'login-code', 375, 812, SHOTS[5], reachLoginCodeStage],
  ['注册档验证码屏 · 宽屏 1440', 'registration-code', 1440, 900, SHOTS[6], reachRegistrationCodeStage],
  ['注册档验证码屏 · 窄屏 375', 'registration-code', 375, 812, SHOTS[7], reachRegistrationCodeStage],
] as const) {
  test(`验证码屏这一格的间距有它自己的读数（${screenLabel}）`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await installChallengeRoutes(page);
    await openApp(page, '/', 'accepted');
    const dialog = await openAuthPanel(page);
    await dialog.getByTestId('auth-form').waitFor({ state: 'visible' });
    await reach(dialog);
    // 等切换那一下的过渡走完，理由同上：中途的矩形是过渡态而不是设计值。
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot, fullPage: false });

    const failures = await measureCodeScreen(dialog, kind, screenLabel);
    expect(failures, failures.join('\n')).toEqual([]);
  });
}
