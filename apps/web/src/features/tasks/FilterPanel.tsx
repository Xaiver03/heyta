/**
 * 已存视图面板（D1 ②）
 *
 * 落点在侧栏底部那一组（与回收站同一形状）。
 * 选中一条已存视图 ⇒ setFilter(saved.filter)（D1 ③）。
 */

import React, { useState, useCallback } from 'react';
import { useI18n } from '@heyta/i18n';
import type { TaskFilter } from '@heyta/domain';
import { loadSavedFilters, addSavedFilter, removeSavedFilter, type SavedFilter } from './saved-filters.js';

interface FilterPanelProps {
  onApplyFilter: (filter: TaskFilter) => void;
}

export function FilterPanel({ onApplyFilter }: FilterPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [filters, setFilters] = useState<SavedFilter[]>(loadSavedFilters);
  const [nameDraft, setNameDraft] = useState('');
  const [kindDraft, setKindDraft] = useState<TaskFilter['kind']>('all');

  const handleSave = useCallback(() => {
    if (!nameDraft.trim()) return;
    const filter: TaskFilter = { kind: kindDraft } as TaskFilter;
    const next = addSavedFilter(nameDraft.trim(), filter);
    setFilters(next);
    setNameDraft('');
  }, [nameDraft, kindDraft]);

  const handleRemove = useCallback((id: string) => {
    setFilters(removeSavedFilter(id));
  }, []);

  return (
    <div className="ht-filter-panel" data-testid="filter-panel">
      <ul className="ht-filter-panel__list">
        {filters.map((f) => (
          <li key={f.id} className="ht-filter-panel__item">
            <button
              type="button"
              className="ht-filter-panel__apply"
              onClick={() => onApplyFilter(f.filter)}
            >
              {f.name}
            </button>
            <button
              type="button"
              className="ht-filter-panel__remove"
              aria-label={t('web.filter.remove')}
              onClick={() => handleRemove(f.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="ht-filter-panel__create">
        <input
          type="text"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          placeholder={t('web.filter.namePlaceholder')}
          aria-label={t('web.filter.namePlaceholder')}
          className="ht-input"
        />
        <select
          value={kindDraft}
          onChange={(e) => setKindDraft(e.target.value as TaskFilter['kind'])}
          aria-label={t('web.filter.kindLabel')}
          className="ht-input"
        >
          <option value="all">{t('web.filter.kind.all')}</option>
          <option value="today">{t('web.filter.kind.today')}</option>
          <option value="next7Days">{t('web.filter.kind.next7Days')}</option>
          <option value="completed">{t('web.filter.kind.completed')}</option>
        </select>
        <button
          type="button"
          onClick={handleSave}
          disabled={!nameDraft.trim()}
          className="ht-btn ht-btn--primary"
        >
          {t('web.filter.save')}
        </button>
      </div>
    </div>
  );
}
