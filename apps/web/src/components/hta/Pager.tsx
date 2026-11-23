import { ICON_SIZE } from '@heyta/design-system';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from './Button.js';
import { IconButton } from './IconButton.js';
import './hta.css';

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

/** 页码窗口里的一格：`'gap'` 是省略号。 */
type PageSlot = number | 'gap';

function pageSlots(current: number, totalPages: number): PageSlot[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const wanted = new Set<number>([1, totalPages, current - 1, current, current + 1]);
  const pages = [...wanted].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const slots: PageSlot[] = [];
  let previous = 0;
  for (const page of pages) {
    if (previous !== 0 && page - previous > 1) slots.push('gap');
    slots.push(page);
    previous = page;
  }
  return slots;
}

export interface PagerLabels {
  /** 「共 N 条」这类总数的成句（宿主注入）。 */
  readonly total: (total: number) => string;
  /** 每页条数选择控件的可访问名。 */
  readonly pageSize: string;
  readonly previous: string;
  readonly next: string;
}

export interface PagerProps {
  readonly total: number;
  readonly pageSize: number;
  readonly offset: number;
  readonly onOffsetChange: (offset: number) => void;
  readonly pageSizeOptions?: readonly number[];
  readonly onPageSizeChange?: (pageSize: number) => void;
  readonly labels: PagerLabels;
  readonly testID?: string;
}

/**
 * 唯一分页形状：`总数 / 每页 / 页码窗口`，**整簇右对齐**（不带 `justify-between`）。
 * 到边界时 prev/next 用 `disabled` 而不是隐藏（位置稳定）。
 */
export function Pager({
  total,
  pageSize,
  offset,
  onOffsetChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onPageSizeChange,
  labels,
  testID,
}: PagerProps): React.JSX.Element {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const current = Math.min(totalPages, Math.floor(offset / Math.max(1, pageSize)) + 1);
  const slots = pageSlots(current, totalPages);

  const goTo = (page: number): void => {
    const clamped = Math.min(Math.max(page, 1), totalPages);
    onOffsetChange((clamped - 1) * pageSize);
  };

  return (
    <div className="hta-pager" data-testid={testID}>
      <span className="hta-pager__total">{labels.total(total)}</span>

      {onPageSizeChange === undefined ? null : (
        <select
          className="hta-pager__size"
          aria-label={labels.pageSize}
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {pageSizeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}

      <IconButton
        label={labels.previous}
        icon={<ChevronLeft size={ICON_SIZE.xs} aria-hidden="true" />}
        size="sm"
        disabled={current <= 1}
        onClick={() => goTo(current - 1)}
      />

      <span className="hta-pager__pages">
        {slots.map((slot, index) =>
          slot === 'gap' ? (
            <span key={`gap-${index}`} className="hta-pager__gap" aria-hidden="true">
              …
            </span>
          ) : (
            <Button
              key={slot}
              size="sm"
              tone={slot === current ? 'secondary' : 'ghost'}
              aria-current={slot === current ? 'page' : undefined}
              onClick={() => goTo(slot)}
            >
              {slot}
            </Button>
          ),
        )}
      </span>

      <IconButton
        label={labels.next}
        icon={<ChevronRight size={ICON_SIZE.xs} aria-hidden="true" />}
        size="sm"
        disabled={current >= totalPages}
        onClick={() => goTo(current + 1)}
      />
    </div>
  );
}
