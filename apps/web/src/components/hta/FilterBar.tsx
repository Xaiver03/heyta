import { useRef, useState, type ReactNode } from 'react';

import { ICON_SIZE } from '@heyta/design-system';
import { Funnel } from 'lucide-react';

import { AnchoredMenu } from '../../lib/menu/AnchoredMenu.js';
import { Badge } from './Badge.js';
import { Button } from './Button.js';
import './hta.css';

export interface FilterBarProps {
  /** 触发按钮的文字，同时作为菜单的可访问名。 */
  readonly label: string;
  /** 已生效的筛选条件数（只数条件，不数值）。 */
  readonly activeCount?: number;
  /** 筛选面板内容。面板是 `role="menu"`，所以子项应使用 `MenuItem`/`MenuSection`。 */
  readonly children: ReactNode;
  readonly testID?: string;
}

/**
 * 唯一筛选入口：**一枚按钮 + 一个面板**。每页最多一枚。
 *
 * 复用 `AnchoredMenu`（门户 + 键盘 + 点外关），角标只数生效条件。
 */
export function FilterBar({
  label,
  activeCount = 0,
  children,
  testID,
}: FilterBarProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <Button
        ref={triggerRef}
        tone="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        leadingIcon={<Funnel size={ICON_SIZE.xs} aria-hidden="true" />}
        data-testid={testID}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        {activeCount > 0 ? <Badge tone="info">{activeCount}</Badge> : null}
      </Button>
      <AnchoredMenu
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        label={label}
        testID={testID === undefined ? undefined : `${testID}-panel`}
      >
        {children}
      </AnchoredMenu>
    </>
  );
}
