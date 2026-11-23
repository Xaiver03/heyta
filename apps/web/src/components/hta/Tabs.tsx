import { useId, type ReactNode } from 'react';

import { onTabRovingKeyDown, rovingTabKey } from '../../lib/tab-roving.js';
import './hta.css';

export interface TabItem {
  readonly key: string;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

export interface TabsProps {
  readonly tabs: readonly TabItem[];
  readonly value: string;
  readonly onChange: (key: string) => void;
  /** `role="tablist"` 的可访问名。 */
  readonly label: string;
  /** 被控面板的 id（`aria-controls`）。多个 tab 共用一个面板时给同一个。 */
  readonly panelId?: string;
  readonly testID?: string;
}

/**
 * 同页二级面切换。**单行可横滚、不换行**（`flex-wrap: nowrap` 在地基 CSS 里）。
 *
 * 键盘漫游接 `lib/tab-roving.ts`：组内只有选中那枚进 Tab 序列，方向键/Home/End 移焦点。
 */
export function Tabs({
  tabs,
  value,
  onChange,
  label,
  panelId,
  testID,
}: TabsProps): React.JSX.Element {
  const baseId = useId();
  const orderedKeys = tabs.map((tab) => tab.key);
  const rovingKey = rovingTabKey(orderedKeys, value);

  return (
    <div
      className="hta-tabs"
      role="tablist"
      aria-label={label}
      data-testid={testID}
      onKeyDown={(event) => onTabRovingKeyDown(event, 'horizontal')}
    >
      {tabs.map((tab) => {
        const selected = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.key}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={rovingKey === tab.key ? 0 : -1}
            disabled={tab.disabled}
            className={`hta-tab${selected ? ' hta-tab--active' : ''}`}
            data-testid={testID === undefined ? undefined : `${testID}-${tab.key}`}
            onClick={() => onChange(tab.key)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
