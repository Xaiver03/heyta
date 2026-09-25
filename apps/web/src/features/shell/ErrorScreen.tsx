/**
 * 存储不可用时的兜底屏。
 *
 * 刻意**不做成裸 inline 样式**：那样会绕过设计系统，而且错误状态恰恰是
 * 用户最需要看清文字的时候 —— 用 token 才能保证它与应用其余部分一样
 * 满足对比度要求（设计系统有测试真实计算 WCAG 对比度，inline 样式没有）。
 */

import { cssVar } from '@heyta/design-system';

export interface ErrorScreenProps {
  title: string;
  message: string;
  hint?: string;
}

export function ErrorScreen({ title, message, hint }: ErrorScreenProps) {
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
        {title}
      </h1>
      <p
        style={{
          margin: 0,
          maxWidth: cssVar('layout.prose-max'),
          fontSize: cssVar('font-size.base'),
          lineHeight: cssVar('line-height.normal'),
          color: cssVar('color.foreground-muted'),
        }}
      >
        {message}
      </p>
      {hint !== undefined && (
        <p
          style={{
            margin: 0,
            maxWidth: cssVar('layout.prose-max'),
            fontSize: cssVar('font-size.sm'),
            color: cssVar('color.foreground-muted'),
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
