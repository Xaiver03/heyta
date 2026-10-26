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
 *
 * ## 同族扫描里被**判掉**的两处（登记结论，免得下一个人重新怀疑一遍）
 *
 *  - `AuthForm` 自托管档「粘贴令牌 → 验证」按钮：形状看着一样（也在 `field` 里、也拿 4px），
 *    但那枚按钮的 `onPress` 是 `onVerifyToken(token)` 并立刻清空**那一个**输入框 ——
 *    它是那根控件自己的动作，不是表单里的下一个控件 ⇒ 4px 是对的。
 *    ⚠️ 另外它在 `allowAdvanced = false`（默认）下根本不渲染，本条也量不到。
 *  - `apps/web/src/features/tasks/TaskRepeat.tsx` 的 `<fieldset>`：`gap: space.1` 分隔的是
 *    `<legend>`（分组标题）与它的第一行单选 —— 那是"标签 ↔ 控件"，同一个 4px 的正确形状。
 *
 * 判据的分母因此**只有**"独立控件 ↔ 下一个独立控件"那几对：本文件里被产品负责人
 * 当面指出过的两例（`primary` 与 `termsRow`）都属于这一类，被上面两处都不属于。
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
import { expect, test } from '@playwright/test';

import { openApp, openAuthPanel } from '../auth-journey/helpers.js';

const SHOTS = ['test-results/auth-form-spacing-1440.png', 'test-results/auth-form-spacing-375.png'] as const;
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
for (const [label, width, height, shot] of [
  ['宽屏 1440', 1440, 900, SHOTS[0]],
  ['窄屏 375', 375, 812, SHOTS[1]],
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
    expect(failures, failures.join('\n')).toEqual([]);
  });
}
