/**
 * 移动端续费入口的**形状**判据。
 *
 * ⚠️ 移动壳没有组件级测试载体（`apps/mobile/tests/*.spec.ts` 全部是源码正则或
 * 纯函数 import，没有 render/jsdom），所以这里钉的是**结构**，不是行为：
 * 行为由 `packages/app-host/tests/checkout.spec.ts` 负责（**条数别在这里抄**：它在跟着
 * 收银台的能力长，要就读 vitest 自己打印的那一行）——
 * 那才是两个壳共用的那一半。分工刻意的：**同一个判断只在一个地方有牙**。
 *
 * 这里要挡的是三种"看起来接上了其实各写一份"的形状：
 *   1. 移动壳自己发 fetch（= 第二套收银台，一定会与 app-host 那份漂移）；
 *   2. 绕过出境同意闸门直接下单；
 *   3. 往 `web.*` 词条账上加新条目（AGENTS 与 `profile-nickname-entry.spec.ts:144`
 *      的那本"既存 179 处"的账不许再长大）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const renew = () => readFileSync(join(SRC, 'src/screens/RenewSection.tsx'), 'utf8');
const profile = () => readFileSync(join(SRC, 'src/screens/ProfileScreen.tsx'), 'utf8');
/** 订阅页与设置目录（2026-10-24 起「我的」只留入口，真正的两块住在这两枚里）。 */
const subscriptionSection = () =>
  readFileSync(join(SRC, 'src/screens/SubscriptionSection.tsx'), 'utf8');
const settingsScreen = () => readFileSync(join(SRC, 'src/screens/SettingsScreen.tsx'), 'utf8');

/**
 * 去掉注释，只留代码。
 *
 * 🔴 没有这一步，"闸门排在下单之前"那条判据会被**文件头自己的说明文字**满足：
 * 头注释里写着 `privacyConsent.networkAllowed()`，它的下标永远比代码里的
 * `startCheckout(` 小 —— 于是把代码里那行守卫整条删掉，判据照样全绿（第一版的
 * 变异臂 D1 就是这么活下来的）。同理 `fetch(` 的恒 0 断言。
 */
const codeOnly = (text: string): string =>
  text.replace(/^\/\*[\s\S]*?^\*\/$/gm, '').replace(/^\s*\/\/.*$/gm, '');

describe('移动端续费入口', () => {
  it('🔴 下单走 @heyta/app-host 那一份接线，本文件里一个 fetch 都不写', () => {
    const src = codeOnly(renew());
    expect(src).toMatch(/import\s*{[^}]*startCheckout[^}]*}\s*from\s*'@heyta\/app-host'/s);
    expect(src.match(/\bfetch\(/gu) ?? [], '移动壳里自己发了 fetch = 第二套收银台').toHaveLength(0);
    // 正向对照：同一形状的探针在能命中的形状上不是恒 0（否则上面那条什么都不证明）。
    expect(src.match(/startCheckout\(/gu)?.length ?? 0).toBeGreaterThan(0);
  });

  it('🔴 出境同意闸门排在下单之前（不同意就一个请求都不发）', () => {
    const src = codeOnly(renew());
    const gate = src.indexOf('if (!privacyConsent.networkAllowed()) return;');
    const order = src.indexOf('startCheckout({');
    expect(gate, '下单路径里没有代码形态的同意闸门（注释里的不算）').toBeGreaterThan(-1);
    expect(order).toBeGreaterThan(gate);
  });

  it('🔴 档位只从 @heyta/app-host 那张表取，本屏不写死 priceId、也不写金额', () => {
    // 收银台有两枚按钮之后，新的假话形状是"壳里自己抄一份档位/价格"。
    // 判据：源码里既不该出现 `'hosted-monthly'` / `'hosted-ai-monthly'` 这类字面量，
    // 也不该出现 ¥/$ 加数字的金额串 —— 档位表在 app-host，金额只在报价响应里。
    const src = codeOnly(renew());
    expect(src).toMatch(/CHECKOUT_TIER_PRICE_IDS\[/);
    expect(src).toMatch(/CHECKOUT_TIERS\.map/);
    expect(src.match(/['"]hosted(?:-ai)?-monthly['"]/gu) ?? [], '壳里写死了 priceId 字面量').toHaveLength(0);
    expect(src.match(/[¥$]\s?\d/gu) ?? [], '壳里写死了金额').toHaveLength(0);
  });

  it('支付串用 Linking 唤起微信，并用 Clipboard 兜底', () => {
    const src = renew();
    expect(src).toMatch(/Linking\.openURL\(/);
    expect(src).toMatch(/Clipboard\.setString\(/);
  });

  it('🔴 本屏一个 `web.*` 键都不读（命名空间说的是壳，不是事）', () => {
    const src = renew();
    expect(src.match(/t\(\s*'web\./gu) ?? [], 'RenewSection 里出现了 t(\'web.…\')').toHaveLength(0);
    expect(src.match(/t\(\s*'mobile\./gu)?.length ?? 0).toBeGreaterThan(3);
  });

  it('失败的陌生码不许被翻译成一句假话：兜底里要带上原始码', () => {
    const src = renew();
    // 查表顺序：**先原因码、再错误码、最后 unknown**（三档必须都在同一条式子里）。
    // 🔴 这条形状在 2026-10-24 变过一次：只按错误码查时，`PRICE_NOT_SELLABLE`
    //    盖住了"这一档要交付的能力本机没有"与"这一档全局没开卖"两件事 ——
    //    两件不同的事被说成同一句，用户拿不到那条真能走的路。原因码那一档因此排在最前。
    expect(src).toMatch(
      /FAILURE_REASON_KEYS\[outcome\.reason\][\s\S]{0,80}FAILURE_KEYS\[outcome\.code\]\s*\?\?\s*'mobile\.entitlement\.renew\.fail\.unknown'/,
    );
    expect(src).toMatch(/\{\s*code:\s*outcome\.code\s*\}/);
  });

  it('🔴 两道新闸门会返回的码，移动壳各有自己的词条 —— 不许落到"原始码"那一支', () => {
    // 闸门 ①（这一档在这台实例交付不了 ⇒ `PRICE_NOT_SELLABLE`）是**今天生产上真会触发**的那一支：
    // 托管上游还没配，用户按下去拿到的就是它。少这一行，界面印的是「下单失败（PRICE_NOT_SELLABLE）。」
    // —— 把服务端机器码当人话给用户看，而 web 那一侧同一件事是有句子的（`web.subscription.renew.fail.sellable`）。
    const src = codeOnly(renew());
    for (const [code, key] of [
      ['PRICE_NOT_SELLABLE', 'mobile.entitlement.renew.fail.sellable'],
      ['PRICE_TIER_LOSES_GRANTS', 'mobile.entitlement.renew.fail.downgrade'],
    ] as const) {
      expect(src, `移动壳没给 ${code} 配词条`).toContain(`${code}: '${key}'`);
      for (const locale of ['zh-CN', 'en']) {
        const table = readFileSync(join(SRC, `../../packages/i18n/src/locales/${locale}.ts`), 'utf8');
        expect(table, `${locale}.ts 里缺 ${key}`).toContain(`'${key}':`);
      }
    }
  });

  it('🔴 没配服务器时按下「下单续费」不许静默', () => {
    // 2026-10-22 iOS 设备腿实测：这台机上该块渲染了（同意过出境）、账号是「还没登录」，
    // 按下之后**可及树一字未变** —— 没有进度、没有失败句，而 `fail.unauthorized`
    // 那句「先登录你的 heyta 账号，才能下单。」永远走不到。
    // 判据写成"两种合法修法任一"：壳里这一支自己报失败，或者把 app-host 的
    // `UNCONFIGURED` 码接进 FAILURE_KEYS。只挡"什么都不说"这一种形状。
    const src = codeOnly(renew());
    const speaks =
      /if \(config === undefined\)\s*\{[^}]*setOutcome\(/u.test(src) ||
      /UNCONFIGURED:\s*'mobile\.entitlement\.renew\.fail\./u.test(src);
    expect(speaks, '按下「下单续费」在没配服务器时不产生任何界面反馈 = 静默空转').toBe(true);
  });

  /**
   * 🔴 2026-10-24 改了挂载点：产品负责人要"单独的订阅界面，移动端和桌面端都要有"。
   * `RenewSection` 从「我的」的滚动流搬进了设置里独立的一节（`SubscriptionSection`），
   * 「我的」只留一个入口行。
   *
   * 判据仍然是"挂上了没挂"，只是现在**三处都得在**，缺一处没有别的门禁会红：
   *   ① 订阅页真的渲染了它；②「我的」有一个入口行；③ 设置目录里真的有这一节。
   */
  it('订阅页挂上了它、「我的」有入口、设置目录有这一节', () => {
    const src = profile();
    expect(subscriptionSection()).toMatch(/<RenewSection \/>/);
    expect(src).toContain("testID: 'profile-entry-subscription'");
    expect(src).toContain("setSettingsSection('subscription')");
    expect(settingsScreen()).toContain("case 'subscription'");
    // 挂载点没有把 `web.` 词条带进这一屏（`profile-nickname-entry.spec.ts:144` 的账）。
    expect(src.match(/t\(\s*'web\./gu) ?? [], 'ProfileScreen 里出现了 t(\'web.…\')').toHaveLength(0);
  });

  it('🔴 这一屏渲染出来的每一句都不声称钱已经到账（查词条表的**值**，不查源码）', () => {
    // 为什么查词条而不是查本文件源码：注释里写"这里不许说已到账"是**在描述这条纪律**，
    // 拿源码正则去挡它会把这句自述也判红（第一版就是这么红的）。
    // 真正会出现在界面上的只有 `mobile.entitlement.renew.*` 那些值。
    const zh = readFileSync(join(SRC, '../../packages/i18n/src/locales/zh-CN.ts'), 'utf8');
    const values = [...zh.matchAll(/^  'mobile\.entitlement\.renew\.[^']+':\s*'([^']*)'/gmu)].map((m) => m[1]);
    expect(values.length, '一条 renew 词条都没抓到 = 解析层坏了，这个 0 什么都不证明').toBeGreaterThan(5);
    for (const forbidden of ['付款成功', '支付成功', '已到账', '已续费', '已购买']) {
      for (const value of values) expect(value).not.toContain(forbidden);
    }
  });
});
