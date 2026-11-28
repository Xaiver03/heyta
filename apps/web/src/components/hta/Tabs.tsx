import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';

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
 * 键盘漫游交给 Radix `Tabs`（方向键 / Home / End、`tabIndex` 游标都由它管，
 * 不再手写 `lib/tab-roving.ts`）。选中态外观走 `data-state="active|inactive"`（见 hta.css）。
 */
export function Tabs({
  tabs,
  value,
  onChange,
  label,
  panelId,
  testID,
}: TabsProps): React.JSX.Element {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onChange}>
      <TabsPrimitive.List className="hta-tabs" aria-label={label} data-testid={testID}>
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.key}
            value={tab.key}
            disabled={tab.disabled}
            className="hta-tab ht-type-body-sm"
            data-testid={testID === undefined ? undefined : `${testID}-${tab.key}`}
            {...(panelId === undefined ? {} : { 'aria-controls': panelId })}
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
