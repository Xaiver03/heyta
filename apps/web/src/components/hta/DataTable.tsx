import { useEffect, useRef, type ReactNode } from 'react';

import { ICON_SIZE } from '@heyta/design-system';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { ListState, type ListStateError } from './ListState.js';
import './hta.css';

export type SortDirection = 'asc' | 'desc';

export interface DataTableSort {
  readonly key: string;
  readonly direction: SortDirection;
}

export interface DataTableColumn<T> {
  readonly key: string;
  /** 表头内容（用户可见文案由宿主注入）。 */
  readonly header: ReactNode;
  readonly render: (row: T) => ReactNode;
  readonly sortable?: boolean;
  readonly align?: 'start' | 'end';
}

export interface DataTableSelection<T> {
  /** 受控选中集：**单一事实源在宿主 store**，本组件不持第二份。 */
  readonly selectedKeys: readonly string[];
  readonly onChange: (keys: string[]) => void;
  readonly selectAllLabel: string;
  readonly rowLabel: (row: T) => string;
}

export interface DataTableProps<T> {
  readonly columns: readonly DataTableColumn<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly loading?: boolean;
  readonly error?: ListStateError | null;
  readonly onRetry?: () => void;
  readonly emptyTitle: string;
  readonly emptyHint?: string;
  readonly skeletonRows?: number;
  readonly sort?: DataTableSort;
  readonly onSortChange?: (next: DataTableSort) => void;
  readonly selection?: DataTableSelection<T>;
  readonly onRowClick?: (row: T) => void;
  /** 表格的可访问名（视觉隐藏的 `<caption>`）。 */
  readonly caption?: string;
  readonly testID?: string;
}

function toggleSort(current: DataTableSort | undefined, key: string): DataTableSort {
  if (current !== undefined && current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: 'asc' };
}

/**
 * 记录台账表格：**sticky 表头 + 排序 + `ListState` 三态 + 可选批量选择**。
 *
 * 🔴 row/selection 单一来源：`rows` 与 `selection.selectedKeys` 都是**受控**的，
 *    本组件不持任何行/选中缓存，也不自建 store（`check:selection-single-source`）。
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  emptyTitle,
  emptyHint,
  skeletonRows = 5,
  sort,
  onSortChange,
  selection,
  onRowClick,
  caption,
  testID,
}: DataTableProps<T>): React.JSX.Element {
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const pageKeys = rows.map((row) => rowKey(row));
  const selectedSet = new Set(selection?.selectedKeys ?? []);
  const selectedOnPage = pageKeys.filter((key) => selectedSet.has(key));
  const allSelected = pageKeys.length > 0 && selectedOnPage.length === pageKeys.length;
  const someSelected = selectedOnPage.length > 0 && !allSelected;

  useEffect(() => {
    if (headerCheckboxRef.current !== null) {
      headerCheckboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const toggleAll = (): void => {
    if (selection === undefined) return;
    const rest = selection.selectedKeys.filter((key) => !pageKeys.includes(key));
    selection.onChange(allSelected ? rest : [...rest, ...pageKeys]);
  };

  const toggleRow = (key: string): void => {
    if (selection === undefined) return;
    if (selection.selectedKeys.includes(key)) {
      selection.onChange(selection.selectedKeys.filter((item) => item !== key));
    } else {
      selection.onChange([...selection.selectedKeys, key]);
    }
  };

  const clickable = onRowClick !== undefined;

  const table = (
    <div className="hta-table-wrap">
      <table className="hta-table" data-testid={testID}>
        {caption === undefined ? null : <caption className="hta-table__caption">{caption}</caption>}
        <thead className="hta-table__head">
          <tr>
            {selection === undefined ? null : (
              <th className="hta-table__cell hta-table__cell--select" scope="col">
                <input
                  ref={headerCheckboxRef}
                  className="hta-table__checkbox"
                  type="checkbox"
                  aria-label={selection.selectAllLabel}
                  checked={allSelected}
                  onChange={toggleAll}
                />
              </th>
            )}
            {columns.map((column) => {
              const sorted = sort !== undefined && sort.key === column.key;
              const sortable = column.sortable === true && onSortChange !== undefined;
              const ariaSort: 'ascending' | 'descending' | 'none' | undefined = sortable
                ? sorted
                  ? sort !== undefined && sort.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
                : undefined;
              return (
                <th
                  key={column.key}
                  className={`hta-table__cell${column.align === 'end' ? ' hta-table__cell--end' : ''}`}
                  scope="col"
                  aria-sort={ariaSort}
                >
                  {sortable ? (
                    <button
                      type="button"
                      className="hta-table__sort"
                      onClick={() => onSortChange(toggleSort(sort, column.key))}
                    >
                      {column.header}
                      {sorted ? (
                        sort !== undefined && sort.direction === 'asc' ? (
                          <ChevronUp size={ICON_SIZE.xs} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={ICON_SIZE.xs} aria-hidden="true" />
                        )
                      ) : null}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                className={clickable ? 'hta-table__row hta-table__row--clickable' : 'hta-table__row'}
                data-testid={testID === undefined ? undefined : `${testID}-row-${key}`}
                onClick={clickable ? () => { onRowClick?.(row); } : undefined}
              >
                {selection === undefined ? null : (
                  <td className="hta-table__cell hta-table__cell--select">
                    <input
                      className="hta-table__checkbox"
                      type="checkbox"
                      aria-label={selection.rowLabel(row)}
                      checked={selectedSet.has(key)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleRow(key)}
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`hta-table__cell${column.align === 'end' ? ' hta-table__cell--end' : ''}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <ListState
      loading={loading}
      error={error}
      onRetry={onRetry}
      empty={rows.length === 0}
      emptyTitle={emptyTitle}
      emptyHint={emptyHint}
      skeletonRows={skeletonRows}
      testID={testID}
    >
      {table}
    </ListState>
  );
}
