import { useEffect, useRef, useState } from 'react';
import { Check, Palette, X } from 'lucide-react';

import { cssVar, ICON_SIZE } from '@heyta/design-system';
import { CATEGORY_SLOTS, type CategorySlot } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';

import { categorySlotColor } from '../../lib/category-colors.js';

import './category-create-dialog.css';

export type CategoryCreateKind = 'project' | 'tag';

interface CategoryCreateDialogProps {
  open: boolean;
  kind: CategoryCreateKind;
  existingNames: readonly string[];
  supportsColor?: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; color?: CategorySlot }) => Promise<void>;
}

const focusableSelector =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * 清单 / 标签共用的新建对话框。
 *
 * 它只拥有交互状态：实体创建仍由宿主传入的 action 完成。颜色只在宿主
 * 明确声明 domain/action 支持时显示，避免给 Tag 画出一个实际无法保存的控件。
 */
export function CategoryCreateDialog({
  open,
  kind,
  existingNames,
  supportsColor = false,
  onClose,
  onCreate,
}: CategoryCreateDialogProps): React.JSX.Element | null {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [name, setName] = useState('');
  const [color, setColor] = useState<CategorySlot | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // The parent passes inline callbacks. Keep the keyboard handler stable while
  // still calling the latest callback and reading the latest busy state.
  onCloseRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    if (!wasOpenRef.current) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      wasOpenRef.current = true;
    }
    setName('');
    setColor(undefined);
    setError('');
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector);
      if (focusable === undefined || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [kind, open]);

  useEffect(() => {
    if (open || restoreFocusRef.current === null) return;
    restoreFocusRef.current.focus();
    restoreFocusRef.current = null;
    wasOpenRef.current = false;
  }, [open]);

  if (!open) return null;

  const title = kind === 'project' ? t('web.categories.create.project.title') : t('web.categories.create.tag.title');
  const inputLabel = t('web.categories.create.name');
  const createLabel = kind === 'project' ? t('web.categories.create.project.submit') : t('web.categories.create.tag.submit');

  const submit = async (): Promise<void> => {
    if (busyRef.current) return;
    const trimmed = name.trim();
    if (trimmed === '') {
      setError(t('web.categories.create.empty'));
      inputRef.current?.focus();
      return;
    }
    const duplicate = existingNames.some((item) => item.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase());
    if (duplicate) {
      setError(t('web.categories.create.duplicate', { name: trimmed }));
      inputRef.current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await onCreate({ name: trimmed, ...(supportsColor && color !== undefined ? { color } : {}) });
      onClose();
    } catch {
      setError(t('web.categories.create.failed'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      className="ht-category-create-dialog"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="ht-category-create-dialog__dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="ht-category-create-title"
        data-testid="category-create-dialog"
      >
        <div className="ht-category-create-dialog__header">
          <h2 id="ht-category-create-title" className="ht-type-section-title">{title}</h2>
          <button
            type="button"
            className="ht-category-create-dialog__close"
            aria-label={t('web.categories.create.close')}
            onClick={onClose}
            disabled={busy}
          >
            <X size={ICON_SIZE.sm} aria-hidden="true" />
          </button>
        </div>

        <form
          className="ht-category-create-dialog__form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="ht-category-create-dialog__label" htmlFor="ht-category-create-name">
            {inputLabel}
          </label>
          <input
            ref={inputRef}
            id="ht-category-create-name"
            className="ht-category-create-dialog__input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error !== '') setError('');
            }}
            placeholder={t('web.categories.create.namePlaceholder')}
            aria-invalid={error === '' ? undefined : true}
            aria-describedby={error === '' ? undefined : 'ht-category-create-error'}
            disabled={busy}
          />

          {supportsColor ? (
            <fieldset className="ht-category-create-dialog__colors">
              <legend className="ht-category-create-dialog__label">
                <Palette size={ICON_SIZE.xs} aria-hidden="true" />
                {t('web.categories.create.color')}
              </legend>
              <div className="ht-category-create-dialog__palette">
                {CATEGORY_SLOTS.map((slot) => (
                  <button
                    type="button"
                    key={slot}
                    className="ht-category-create-dialog__swatch"
                    aria-label={t('web.categories.create.colorSlot', { slot })}
                    aria-pressed={color === slot}
                    disabled={busy}
                    onClick={() => setColor((current) => (current === slot ? undefined : slot))}
                  >
                    <span className="ht-category-create-dialog__swatch-color" style={{ background: categorySlotColor(slot) }} aria-hidden="true">
                      {color === slot ? <Check size={ICON_SIZE.xs} aria-hidden="true" /> : null}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="ht-category-create-dialog__swatch ht-category-create-dialog__swatch--none"
                  aria-label={t('web.categories.create.colorNone')}
                  aria-pressed={color === undefined}
                  disabled={busy}
                  onClick={() => setColor(undefined)}
                >
                  <span aria-hidden="true" />
                  <span>{t('web.categories.create.colorNoneShort')}</span>
                </button>
              </div>
            </fieldset>
          ) : null}

          {error === '' ? null : (
            <p id="ht-category-create-error" className="ht-category-create-dialog__error" role="alert">
              {error}
            </p>
          )}

          <div className="ht-category-create-dialog__actions">
            <button type="button" className="ht-btn ht-btn--ghost" onClick={onClose} disabled={busy}>
              {t('web.categories.create.cancel')}
            </button>
            <button type="submit" className="ht-btn ht-btn--primary" disabled={busy}>
              <Check size={ICON_SIZE.sm} aria-hidden="true" />
              {busy ? t('web.categories.create.creating') : createLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
