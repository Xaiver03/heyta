import { ICON_SIZE } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n/provider';
import { EmptyState, HeytaUiProvider } from '@heyta/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { ADMIN_PAGE_SIZE } from '../store.js';

/** epoch 毫秒 → `YYYY-MM-DD HH:mm`（本地时区）。`null` → `—`。 */
export function formatTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const date = new Date(value);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** 字节 → 人类可读。用二进制单位（与 `storageQuotaBytes` 的语义一致）。 */
export function formatBytes(value: number): string {
  if (value < 1024) return `${String(value)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(1)} ${units[unit] ?? 'TiB'}`;
}

/** 金额（最小单位）→ `12.34 CNY`。后台只做展示，不做换算。 */
export function formatMoney(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

/**
 * 列表为空时的占位。
 *
 * 🔴 走**共享那一个实现**（`packages/ui` 的 `EmptyState`），不在视图里手写骨架与文案
 * —— `pnpm check:empty-state` 的判据 3。
 *
 * ⚠️ 词条名字刻意**不带那个词**（用 `noneFound` / `list.none`）：
 * 那道门禁是按词条 key 的**段**匹配的，一个以它结尾的 key 即使交给共享组件
 * 也仍然算"手写站点"。同理，**这段注释里也不能把那两个形态写出来** ——
 * 门禁是**纯文本**匹配的，写出来就等于自己踩自己（`InboxBell` 的文件里
 * 有一条同样的告诫，我就是没照做才多绕了一轮）。
 *
 * 🔴 共享组件必须挂在 `<HeytaUiProvider>` 之内 —— 它读 token，
 * 缺了会**主动抛错**（与 `InboxBell` 同一处理，见 `check:ui-provider`）。
 */
export function AdminEmpty(props: { titleKey: MessageKey }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <HeytaUiProvider>
      <EmptyState title={t(props.titleKey)} />
    </HeytaUiProvider>
  );
}

/** 一个统计格。 */
export function Stat(props: { labelKey: MessageKey; value: string | number }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ht-settings__admin-stat">
      <span className="ht-settings__admin-statValue">{props.value}</span>
      <span className="ht-settings__admin-statLabel">{t(props.labelKey)}</span>
    </div>
  );
}

/** 上一页 / 下一页。到边界时禁用而不是隐藏 —— 位置稳定，不会让按钮跳来跳去。 */
export function Pager(props: {
  total: number;
  offset: number;
  onPrev: () => void;
  onNext: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ht-settings__admin-pager">
      <button
        type="button"
        className="ht-settings__admin-btn"
        disabled={props.offset === 0}
        onClick={props.onPrev}
      >
        <ChevronLeft size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.admin.prev')}
      </button>
      <button
        type="button"
        className="ht-settings__admin-btn"
        disabled={props.offset + ADMIN_PAGE_SIZE >= props.total}
        onClick={props.onNext}
      >
        {t('web.admin.next')} <ChevronRight size={ICON_SIZE.xs} aria-hidden="true" />
      </button>
    </div>
  );
}
