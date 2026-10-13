/**
 * 移动端续费入口的**形状**判据。
 *
 * ⚠️ 移动壳没有组件级测试载体（`apps/mobile/tests/*.spec.ts` 全部是源码正则或
 * 纯函数 import，没有 render/jsdom），所以这里钉的是**结构**，不是行为：
 * 行为由 `packages/app-host/tests/checkout.spec.ts`（14 条，含变异臂）负责 ——
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
    expect(src).toMatch(/FAILURE_KEYS\[outcome\.code\]\s*\?\?\s*'mobile\.entitlement\.renew\.fail\.unknown'/);
    expect(src).toMatch(/\{\s*code:\s*outcome\.code\s*\}/);
  });

  it('ProfileScreen 挂上了它，且那两条冻结判据仍然成立', () => {
    const src = profile();
    expect(src).toMatch(/<RenewSection \/>/);
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
