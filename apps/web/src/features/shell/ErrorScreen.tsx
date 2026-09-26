/**
 * 存储不可用时的兜底屏。
 *
 * 刻意**不做成裸 inline 样式**：那样会绕过设计系统，而且错误状态恰恰是
 * 用户最需要看清文字的时候 —— 用 token 才能保证它与应用其余部分一样
 * 满足对比度要求（设计系统有测试真实计算 WCAG 对比度，inline 样式没有）。
 *
 * 🔴 **它必须在没有任何 Provider 的情况下也能渲染。** 它出现的时机正是
 * "整个应用起不来"（`initOpLog()` 失败、`main.tsx` 的 catch 分支），
 * 那时堆栈里什么都不能假设。`@heyta/i18n` 的 context 默认值是
 * `DEFAULT_LOCALE`，所以 `useI18n()` 在 Provider 之外**不抛**、直接给默认语言。
 *
 * 🔴 因此这里**刻意不加** "必须在 Provider 内使用" 那种守卫：
 * 崩溃屏因为缺 Provider 而二次崩溃，等于把唯一能告诉用户发生了什么的地方也弄没了。
 * （需要切换器的组件才走会抛的 `useLocalePreference` —— 那是另一回事，
 * 切换器本来就必须在 Provider 内，见 `lib/locale-preference.tsx`。）
 *
 * 标题与建议是**词条 key**，在组件内部翻译；`message` 是原始错误文本，
 * 属于**数据**，不翻译。这样即使本组件在 Provider 之外渲染，
 * 它也能用默认语言把自己说清楚。
 *
 * 🔴 但"数据"不等于"可以当主文案"：`message` 是**跨包的中文**
 * （`packages/storage` 抛的），所以它现在放在 `<details>` 里当技术详情，
 * 主文案是**按失败原因取词条的建议**（见 `error-hint.ts`）。
 */

import { cssVar } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';

export interface ErrorScreenProps {
  /** 标题词条 key。为什么不是已翻译好的字符串：见文件头。 */
  titleKey: MessageKey;
  /** 原始错误文本 —— 数据，不翻译。 */
  message: string;
  /** 可选的处理建议词条 key。 */
  hintKey?: MessageKey;
}

export function ErrorScreen({ titleKey, message, hintKey }: ErrorScreenProps) {
  const { t } = useI18n();

  return (
    <div
      role="alert"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: cssVar('space.4'),
        padding: cssVar('space.6'),
        background: cssVar('color.background'),
        color: cssVar('color.foreground'),
        fontFamily: cssVar('font.sans'),
        textAlign: 'center',
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: cssVar('font-size.2xl'),
          fontWeight: cssVar('font-weight.semibold'),
          lineHeight: cssVar('line-height.tight'),
        }}
      >
        {t(titleKey)}
      </h1>
      {/* 建议在原文**之前**：用户第一眼要知道的是"我现在能做什么"。 */}
      {hintKey !== undefined && (
        <p
          data-testid="error-hint"
          style={{
            margin: 0,
            maxWidth: cssVar('layout.prose-max'),
            fontSize: cssVar('font-size.base'),
            lineHeight: cssVar('line-height.normal'),
            color: cssVar('color.foreground-muted'),
          }}
        >
          {t(hintKey)}
        </p>
      )}
      {/*
        🔴 原始错误文本降级成"技术详情"，**不再是主文案**。

        原因：它是**跨包的中文**（`packages/storage` 抛的），
        英文界面的用户读到的第一句话会是中文 —— 而门禁看不见这条通道
        （它查字面量，这里渲染的是变量）。

        但它**不能删**：容器里看不到真错误的时候，就靠它诊断
        （`AGENTS.md` §7 的教训）。`<details>` 默认收起，
        所以它保留诊断价值，又不占第一眼。

        ⚠️ 不要给 `summary` 加 `outline: none`（`AGENTS.md` §5）——
        键盘用户要靠焦点环找到它。
      */}
      <details
        data-testid="error-details"
        style={{ maxWidth: cssVar('layout.prose-max'), width: '100%' }}
      >
        <summary
          style={{
            cursor: 'pointer',
            fontSize: cssVar('font-size.sm'),
            color: cssVar('color.foreground-muted'),
          }}
        >
          {t('web.error.details')}
        </summary>
        <p
          data-testid="error-message"
          style={{
            margin: 0,
            marginTop: cssVar('space.2'),
            fontSize: cssVar('font-size.sm'),
            lineHeight: cssVar('line-height.normal'),
            color: cssVar('color.foreground-muted'),
            overflowWrap: 'anywhere',
            textAlign: 'left',
          }}
        >
          {message}
        </p>
      </details>
    </div>
  );
}
