import type { SVGProps } from 'react';
import { ASSISTANT_MARK_PATHS, ASSISTANT_MARK_VIEWBOX, ASSISTANT_MARK_STROKE, ICON_SIZE } from '@heyta/design-system';

/** 装饰图形；可访问名称由外层按钮或标题提供。 */
export function AssistantIcon({ size = ICON_SIZE.sm, ...props }: SVGProps<SVGSVGElement> & { size?: number }): React.JSX.Element {
  return <svg {...props} width={size} height={size} viewBox={ASSISTANT_MARK_VIEWBOX}
    fill="none" stroke="currentColor" strokeWidth={ASSISTANT_MARK_STROKE}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    data-assistant-mark="double-page">
    {ASSISTANT_MARK_PATHS.map((d) => <path key={d} d={d} />)}
  </svg>;
}
