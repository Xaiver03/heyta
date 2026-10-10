/**
 * 一键投诉/举报入口在移动端的**接线判据**（源码层）
 * ==============================================
 *
 * 🔴 为什么是读源码而不是渲染组件：`apps/mobile` 刻意没有 RN 组件测试栈
 * （理由见 `tests/habit-create-entry.spec.ts` 文件头）。
 *
 * 这一格不是"多加一个链接"：备案材料与隐私政策都对用户承诺了**投诉举报途径**，
 * 而在此之前那个途径只存在于法律文本的一行字里 —— 应用内没有任何入口。
 * 三种会**悄悄**发生、界面上什么都不坏的坏法，各由下面一条挡着：
 *   ① 界面里自己抄一份邮箱 ⇒ 与法律文本那份漂移，用户的投诉发进没人看的信箱；
 *   ② `Linking.openURL` 失败被吞掉 ⇒ 用户以为自己已经反映出去了；
 *   ③ 入口整段被删 ⇒ 材料里那句"应用内提供入口"变成谎话，而没有一层会红。
 */

import { describe, expect, it } from 'vitest';

import { read, stripComments } from './source-reading';

const SETTINGS = stripComments(read('apps/mobile/src/screens/SettingsScreen.tsx'));
/** 受理邮箱的唯一主人（法律文本与备案材料都从它取）。 */
const LEGAL = stripComments(read('packages/legal/src/index.ts'));

/** 从 `const renderGeneral` 到下一个 `const render` 之间 —— 通用那一屏。 */
function generalBody(): string {
  const start = SETTINGS.indexOf('const renderGeneral');
  const end = SETTINGS.indexOf('const renderSecurity', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return SETTINGS.slice(start, end);
}

describe('入口在，且指向法律文本公示的那一枚邮箱', () => {
  it('🔴 通用那一屏里真的有这一行（不是只在别处定义了一个回调）', () => {
    const body = generalBody();
    expect(body).toContain("testID: 'settings-entry-feedback'");
    expect(body).toContain("t('common.feedback.label')");
    expect(body).toContain('onPress: openFeedbackMail');
    expect(body).toContain("testID=\"settings-feedback\"");
    // 正向对照：同一把尺在同一个片段里读得到别的东西（读不到任何 testID 就是尺坏了）。
    expect(body).toContain("testID=\"profile-language\"");
  });

  it('🔴 地址取 `OPERATOR.contactEmail`，文件里**没有**第二份邮箱字面量', () => {
    expect(SETTINGS).toContain("import { OPERATOR } from '@heyta/legal'");
    expect(SETTINGS).toMatch(/mailto:\$\{OPERATOR\.contactEmail\}/);
    // 变异：把 `OPERATOR.contactEmail` 换成写死的 `heyta@waytofuture.cn` ⇒ 本条红。
    // 这一条挡的是"两份事实源"，不是"格式不对" —— 所以它数的是**出现次数**，
    // 而那个次数由法律文本那一侧现量，不抄在这里。
    const published = LEGAL.match(/contactEmail:\s*'([^']+)'/);
    expect(published, '法律文本里读不到公示邮箱，这条判据就失去了参照').not.toBeNull();
    expect(SETTINGS).not.toContain(published![1]);
  });

  it('主题由词条表给（不是拼在代码里的一句中文）', () => {
    expect(SETTINGS).toContain("t('common.feedback.subject')");
    expect(SETTINGS).toContain('encodeURIComponent');
  });
});

describe('打不开邮件应用必须说出口', () => {
  it('🔴 失败回调把状态置回"失败"，而不是 `.catch(() => undefined)`', () => {
    const start = SETTINGS.indexOf('const openFeedbackMail');
    const end = SETTINGS.indexOf('}, [t]);', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = SETTINGS.slice(start, end);
    expect(body).toContain('Linking.openURL');
    expect(body).toContain('setFeedbackFailed(true)');
    // 正向对照：点下去先清掉上一次的失败提示，否则会留下"已经发出去了"的反面谎话。
    expect(body.indexOf('setFeedbackFailed(false)')).toBeLessThan(body.indexOf('Linking.openURL'));
  });

  it('失败时那一行会把地址本身念出来（给用户一条手动发送的出口）', () => {
    const body = generalBody();
    expect(body).toContain("t('mobile.settings.feedback.failed'");
    expect(body).toContain('email: OPERATOR.contactEmail');
    expect(body).toContain("testID: 'settings-feedback-failed'");
  });

  it('连点两次时旧请求的失败不能覆盖新请求 ⇒ 用请求代数而不是布尔量', () => {
    // 与 `PrivacyConsentSheet` 的 `linkRequest` 同一形状。变异：删掉
    // `if (request === feedbackRequest.current)` 这道闸 ⇒ 本条红。
    expect(SETTINGS).toContain('const feedbackRequest = useRef(0)');
    expect(SETTINGS).toMatch(/if \(request === feedbackRequest\.current\)/);
  });
});

describe('词条中英齐', () => {
  it('四枚新词条在两份表里都在', () => {
    const zh = read('packages/i18n/src/locales/zh-CN.ts');
    const en = read('packages/i18n/src/locales/en.ts');
    for (const key of [
      'common.feedback.label',
      'common.feedback.hint',
      'common.feedback.subject',
      'mobile.settings.feedback.section',
      'mobile.settings.feedback.failed',
    ]) {
      expect(zh, `zh-CN 缺 ${key}`).toContain(`'${key}'`);
      expect(en, `en 缺 ${key}`).toContain(`'${key}'`);
    }
  });
});
