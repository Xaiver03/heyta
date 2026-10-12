/**
 * 应用内语言开关的那句说明：**说的必须是它的真实生命周期**。
 *
 * 生产者的事实（现量于 2026-10-13，两枚设备 + 源码三处）：
 * - 选择**会持久**：`apps/mobile/src/i18n/locale.ts:69-70` 把 `HeytaWidget.preferredLocale` 排在
 *   `deviceLocale` / `AppleLanguages` / `localeIdentifier` **之前**，所以冷启动读回的就是上一次的选择；
 *   挡这一档优先级的判据早在 `apps/mobile/tests/locale.spec.ts:33-35`。
 * - 设备侧实测：`am force-stop com.heyta` → `pidof` 空 → `am start -W` 拿到新 pid，界面**仍是**上一趟切过去的英文。
 * - 与小组件**共用同一份存储**：写 `apps/mobile/src/i18n/locale-preference.tsx:39` →
 *   Android `WidgetLocalePreference.write` / iOS `HeytaWidgetModule.setWidgetLocale`，
 *   小组件渲染时读的就是这一份（`WidgetLocalePreference.localizedContext`）。
 *
 * 而这句话**曾经写反**：「选择只在本会话内生效，重开应用会回到设备的语言。」
 * ⇒ 那是一句对用户的事实错误，不是风格问题：照着它做，用户会以为切完语言重启就没了，
 *   于是本线那两枚设备脚本一度把它当"只在本会话内"的旋钮用，英文腿因此不幂等。
 *
 * 🔴 变异臂（四臂，**下面是实测的失败集合**，不是设想 —— 2026-10-13 现跑，
 *    驱动脚本 `.run-logs/mutate-language-hint.mjs`，`.run-logs/` 是跑批落点、不入库，
 *    复现只需按下面四句各改一次再 `npx vitest run tests/language-hint-copy.spec.ts`）：
 * 1. 中文那条改回旧句 ⇒ rc=1，红在第 2 组**和第 3 组**（旧句既说了"只在本会话内"，也压根没提小组件）。
 * 2. 英文那条改回 `This choice lasts for the current session only…` ⇒ rc=1，同上两组（证明中英两侧都守）。
 * 3. 只把中文句尾"；系统小组件读同一份偏好。"删掉 ⇒ rc=1，**只有第 3 组红**（这一臂才是"只删共用那半句"的隔离臂）。
 * 4. 把这枚键**改名** ⇒ rc=1，第 1/2/3 组全红。第 2/3 组全靠第 1 组先把"键在、两表都有"钉死，
 *    否则键一漂，后面三组会静默空跑（同目录 `habit-total-copy.spec.ts` 变异臂 5 就是这个形状）。
 *    ⚠️ 臂 1/2 不是一臂一组：旧句同时缺两样东西，所以它抓不到"只删一半"那种改法 —— 那是臂 3 的活。
 */
import { describe, expect, it } from 'vitest';

import { en } from '../src/locales/en.js';
import { zhCN, type MessageKey } from '../src/locales/zh-CN.js';

/** 唯一一句会交代"这枚开关活多久"的文案；其余同族键都只是标签，没有生命周期可言。 */
const HINT_KEY = 'mobile.profile.language.hint' as const satisfies MessageKey;

/** 把开关说成"临时的 / 重启就没了"的说法，中英各一种形状。 */
const SESSION_SCOPED_ZH = /只?在本会话|会话内生效|回到设备的语言/u;
const SESSION_SCOPED_EN = /current session only|lasts for the session|returns? to the device language/iu;

/** 说清"它会留下来"的最低要求：既要点持久，也要点重启之后仍然。 */
const PERSISTENT_ZH = /(记住|保留|仍然|依旧)/u;
const PERSISTENT_EN = /(remembers?|still applies|persists?)/iu;

/** 说清"和小组件共用那份偏好" —— 这一半对应上面那条第一优先级，不许悄悄删。 */
const SHARED_ZH = /小组件/u;
const SHARED_EN = /widget/iu;

describe('语言开关的说明与它的真实生命周期同源', () => {
  it('清单不空，且这枚键在中英两表里都在（阳性对照）', () => {
    expect(zhCN[HINT_KEY], '中文表缺这枚键').toBeTruthy();
    expect(en[HINT_KEY], '英文表缺这枚键').toBeTruthy();
  });

  it('两表都不许把开关说成"只在本会话内"', () => {
    expect(zhCN[HINT_KEY], '中文又把持久的开关说成了临时的').not.toMatch(SESSION_SCOPED_ZH);
    expect(en[HINT_KEY], '英文又把持久的开关说成了临时的').not.toMatch(SESSION_SCOPED_EN);
  });

  it('正面交代：会留下来，且小组件读同一份偏好', () => {
    expect(zhCN[HINT_KEY], '中文没再说清"重启之后仍然生效"').toMatch(PERSISTENT_ZH);
    expect(en[HINT_KEY], '英文没再说清"重启之后仍然生效"').toMatch(PERSISTENT_EN);
    expect(zhCN[HINT_KEY], '中文漏了"和系统小组件共用这份偏好"').toMatch(SHARED_ZH);
    expect(en[HINT_KEY], '英文漏了"和系统小组件共用这份偏好"').toMatch(SHARED_EN);
  });

  it('🔴 全表没有第二处把语言开关说成临时的（漏登记）', () => {
    // 判据锚的是"语言 + 临时"这对语义，不是某个字面串 —— 换措辞也照样响。
    const strays = Object.entries(zhCN)
      .filter(([key, value]) => key !== HINT_KEY && /语言/u.test(value) && SESSION_SCOPED_ZH.test(value))
      .map(([key]) => key);
    expect(strays, '这些句子也在把语言切换说成临时的 ⇒ 判据会漏守').toEqual([]);
    const enStrays = Object.entries(en)
      .filter(([key, value]) => key !== HINT_KEY && /language/i.test(value) && SESSION_SCOPED_EN.test(value))
      .map(([key]) => key);
    expect(enStrays, '英文侧有第二处同样的说法没登记').toEqual([]);
  });
});
