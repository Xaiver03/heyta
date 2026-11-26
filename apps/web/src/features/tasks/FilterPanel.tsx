/**
 * 已存视图面板（D1 ②③，2026-11-24 重做为「滴答式组合筛选」）
 *
 * 落点在侧栏底部、「回收站」那一组下面（与 D2 对回收站那行规定的形状一致）。
 *
 * ## 它是什么
 *
 * 一条已存视图 = `{ name, filter: TaskFilter }`，其中 `filter` 现在可以是
 * **多条件组合**：`{ kind: 'compound', op: 'and' | 'or', conditions: [...] }`。
 * 每个条件只表达**一个维度**（状态 / 日期 / 清单 / 标签 / 四象限），
 * 与 `packages/domain/src/task-filter.ts` 的 `FilterCondition` 一一对应。
 *
 * 这正是滴答「过滤器 / 高级筛选」的核心：把「清单 + 标签 + 日期 + 优先级」
 * 用「且 / 或」串起来，一次点开看结果；多个条件在
 * `task-filter.ts` 里是**正交维度**求交/并（不是把两套自带完成态口径的
 * 简单视图硬求交，那会让「已完成 + 清单」恒为空）。
 *
 * ## 为什么创建表单「点 + 才出现」
 *
 * 侧栏「清单 / 标签」那节的注解记过同一个教训：常驻的空输入框看起来像
 * **一个没填完的表单**。所以这里是「区块头 + 一枚 + 图标」：点 + 才展开。
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { ICON_SIZE } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';
import {
  Quadrant,
  type CompoundOperator,
  type FilterCondition,
  type FilterDateRange,
  type TaskFilter,
} from '@heyta/domain';
import { Check, Filter as FilterIcon, Plus, X } from 'lucide-react';

import { Button, IconButton, Select } from '../../components/hta/index.js';
import { FormField } from '../../lib/form/FormField.js';
import { useProjectStore } from '../projects/store.js';
import { useTaskStore } from './store.js';
import { addSavedFilter, loadSavedFilters, removeSavedFilter, type SavedFilter } from './saved-filters.js';

interface FilterPanelProps {
  /** 用户选中一条已存视图。宿主负责落筛选（`goToFilter` = 切回任务视图 + setFilter）。 */
  onApplyFilter: (filter: TaskFilter) => void;
}

/** 两个 `TaskFilter` 是否同值（用于高亮当前生效的那条已存视图）。浅对象，序列化即值相等。 */
function sameFilter(a: TaskFilter, b: TaskFilter): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const QUADRANT_ORDER: readonly { readonly value: Quadrant; readonly labelKey: MessageKey }[] = [
  { value: Quadrant.UrgentImportant, labelKey: 'web.filter.quadrant.q1' },
  { value: Quadrant.ImportantNotUrgent, labelKey: 'web.filter.quadrant.q2' },
  { value: Quadrant.UrgentNotImportant, labelKey: 'web.filter.quadrant.q3' },
  { value: Quadrant.Neither, labelKey: 'web.filter.quadrant.q4' },
];

const DATE_RANGES: readonly FilterDateRange[] = ['today', 'tomorrow', 'next7Days', 'overdue', 'undated'];

const DATE_RANGE_LABEL: Readonly<Record<FilterDateRange, MessageKey>> = {
  today: 'web.filter.kind.today',
  tomorrow: 'web.filter.kind.tomorrow',
  next7Days: 'web.filter.kind.next7Days',
  overdue: 'web.filter.date.overdue',
  undated: 'web.filter.date.undated',
};

export function FilterPanel({ onApplyFilter }: FilterPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const currentFilter = useTaskStore((s) => s.filter);
  const projects = useProjectStore((s) => s.projects);
  const tags = useProjectStore((s) => s.tags);

  const [filters, setFilters] = useState<SavedFilter[]>(loadSavedFilters);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState('');
  const [op, setOp] = useState<CompoundOperator>('and');
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const projectOptions = useMemo(
    () =>
      projects
        .filter((project) => project.archived !== true)
        .map((project) => ({ value: project.id, label: project.name })),
    [projects],
  );
  const tagOptions = useMemo(
    () => tags.map((tag) => ({ value: tag.id, label: tag.name })),
    [tags],
  );

  /** 某一维的默认条件（切换维度时用）。 */
  const conditionForDim = useCallback(
    (dim: FilterCondition['kind']): FilterCondition => {
      switch (dim) {
        case 'status':
          return { kind: 'status', status: 'open' };
        case 'date':
          return { kind: 'date', range: 'today' };
        case 'project':
          return { kind: 'project', projectId: projectOptions[0]?.value ?? '' };
        case 'tag':
          return { kind: 'tag', tagId: tagOptions[0]?.value ?? '' };
        case 'quadrant':
          return { kind: 'quadrant', quadrant: Quadrant.UrgentImportant };
      }
    },
    [projectOptions, tagOptions],
  );

  const openCreate = useCallback(() => {
    setCreating(true);
    setName('');
    setOp('and');
    setConditions([{ kind: 'status', status: 'open' }]);
    setError('');
    requestAnimationFrame(() => nameRef.current?.focus());
  }, []);

  const closeCreate = useCallback(() => {
    setCreating(false);
    setError('');
  }, []);

  const dimOptions = useMemo(
    () => [
      { value: 'status', label: t('web.filter.dim.status') },
      { value: 'date', label: t('web.filter.dim.date') },
      { value: 'project', label: t('web.filter.kind.project') },
      { value: 'tag', label: t('web.filter.kind.tag') },
      { value: 'quadrant', label: t('web.filter.kind.quadrant') },
    ],
    [t],
  );

  const replaceCondition = useCallback((index: number, next: FilterCondition) => {
    setConditions((prev) => prev.map((condition, i) => (i === index ? next : condition)));
  }, []);

  const addCondition = useCallback(() => {
    setConditions((prev) => [...prev, { kind: 'status', status: 'open' }]);
  }, []);

  const removeCondition = useCallback((index: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** 条件是否已选全（项目/标签必须选一个 id）。 */
  const conditionComplete = (condition: FilterCondition): boolean => {
    switch (condition.kind) {
      case 'project':
        return condition.projectId !== '';
      case 'tag':
        return condition.tagId !== '';
      default:
        return true;
    }
  };

  const canSave =
    name.trim() !== '' && conditions.length > 0 && conditions.every(conditionComplete);

  const handleSave = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setError(t('web.filter.nameRequired'));
      nameRef.current?.focus();
      return;
    }
    if (conditions.length === 0 || !conditions.every(conditionComplete)) return;
    const filter: TaskFilter = { kind: 'compound', op, conditions };
    setFilters(addSavedFilter(trimmed, filter));
    closeCreate();
  }, [name, op, conditions, closeCreate, t]);

  const handleRemove = useCallback((id: string) => {
    setFilters(removeSavedFilter(id));
  }, []);

  /** 渲染一个条件的"取值"下拉（随维度不同）。 */
  const renderValueSelect = (condition: FilterCondition, index: number): React.JSX.Element => {
    const testID = `filter-cond-${index}-value`;
    switch (condition.kind) {
      case 'status':
        return (
          <Select
            label={t('web.filter.statusLabel')}
            value={condition.status}
            onChange={(value) => replaceCondition(index, { kind: 'status', status: value === 'completed' ? 'completed' : 'open' })}
            options={[
              { value: 'open', label: t('web.filter.status.open') },
              { value: 'completed', label: t('web.filter.kind.completed') },
            ]}
            testID={testID}
          />
        );
      case 'date':
        return (
          <Select
            label={t('web.filter.dateLabel')}
            value={condition.range}
            onChange={(value) => replaceCondition(index, { kind: 'date', range: value as FilterDateRange })}
            options={DATE_RANGES.map((range) => ({ value: range, label: t(DATE_RANGE_LABEL[range]) }))}
            testID={testID}
          />
        );
      case 'project':
        return (
          <Select
            label={t('web.filter.projectLabel')}
            value={condition.projectId}
            onChange={(value) => replaceCondition(index, { kind: 'project', projectId: value })}
            options={projectOptions}
            placeholder={t('web.filter.projectLabel')}
            testID={testID}
          />
        );
      case 'tag':
        return (
          <Select
            label={t('web.filter.tagLabel')}
            value={condition.tagId}
            onChange={(value) => replaceCondition(index, { kind: 'tag', tagId: value })}
            options={tagOptions}
            placeholder={t('web.filter.tagLabel')}
            testID={testID}
          />
        );
      case 'quadrant':
        return (
          <Select
            label={t('web.filter.quadrantLabel')}
            value={String(condition.quadrant)}
            onChange={(value) => replaceCondition(index, { kind: 'quadrant', quadrant: Number(value) as Quadrant })}
            options={QUADRANT_ORDER.map((option) => ({ value: String(option.value), label: t(option.labelKey) }))}
            testID={testID}
          />
        );
    }
  };

  return (
    <section className="ht-sidebar__filters" aria-label={t('web.filter.sidebar')}>
      <div className="ht-sidebar__organizer-heading">
        <h2 className="ht-nav__section ht-type-group-label">{t('web.filter.sidebar')}</h2>
        <button
          type="button"
          className="ht-sidebar__organizer-add"
          aria-label={t('web.filter.new')}
          aria-expanded={creating}
          data-testid="filter-add"
          onClick={() => {
            if (creating) closeCreate();
            else openCreate();
          }}
        >
          <Plus size={ICON_SIZE.sm} aria-hidden="true" />
        </button>
      </div>

      {filters.length === 0 && !creating ? null : (
        <div className="ht-nav ht-sidebar__filter-list">
          {filters.map((saved) => {
            const active = sameFilter(saved.filter, currentFilter);
            return (
              <div key={saved.id} className="ht-sidebar__filter-item">
                <button
                  type="button"
                  className="ht-nav__item ht-sidebar__filter-apply"
                  aria-current={active}
                  data-testid={`filter-apply-${saved.id}`}
                  onClick={() => onApplyFilter(saved.filter)}
                >
                  <FilterIcon size={ICON_SIZE.sm} aria-hidden="true" />
                  <span className="ht-sidebar__filter-apply__name">{saved.name}</span>
                </button>
                {/* 尾部删除：用与「+」同一个 44×44 居中盒（`.ht-sidebar__organizer-add`），
                    这样它的右缘落在与 + 同一条右脊线上、图标也与 + 同轴居中；
                    换成 Button 自带内距的宽度会让两个图标差 7px（实测）。 */}
                <button
                  type="button"
                  className="ht-sidebar__organizer-add"
                  aria-label={t('web.filter.remove')}
                  onClick={() => handleRemove(saved.id)}
                >
                  <X size={ICON_SIZE.sm} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {creating ? (
        <form
          className="ht-sidebar__filter-form"
          data-testid="filter-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            handleSave();
          }}
        >
          <FormField
            id="ht-filter-name"
            label={t('web.filter.nameLabel')}
            layout="stacked"
            required
          >
            {(field) => (
              <input
                {...field}
                ref={nameRef}
                value={name}
                placeholder={t('web.filter.namePlaceholder')}
                aria-invalid={error === '' ? undefined : true}
                aria-describedby={error === '' ? undefined : 'ht-filter-name-error'}
                onChange={(event) => {
                  setName(event.target.value);
                  if (error !== '') setError('');
                }}
              />
            )}
          </FormField>

          <div className="ht-sidebar__filter-conds" data-testid="filter-conditions">
            {conditions.map((condition, index) => (
              <div className="ht-sidebar__filter-cond" key={index} data-testid={`filter-cond-${index}`}>
                <Select
                  label={t('web.filter.dimLabel')}
                  value={condition.kind}
                  onChange={(value) => replaceCondition(index, conditionForDim(value as FilterCondition['kind']))}
                  options={dimOptions}
                  testID={`filter-cond-${index}-dim`}
                />
                {renderValueSelect(condition, index)}
                {conditions.length > 1 ? (
                  <div className="ht-sidebar__filter-cond-actions">
                    <IconButton
                      label={t('web.filter.removeCondition')}
                      icon={<X size={ICON_SIZE.xs} aria-hidden="true" />}
                      size="sm"
                      onClick={() => removeCondition(index)}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {conditions.length > 1 ? (
            <Select
              label={t('web.filter.opLabel')}
              value={op}
              onChange={(value) => setOp(value === 'or' ? 'or' : 'and')}
              options={[
                { value: 'and', label: t('web.filter.op.and') },
                { value: 'or', label: t('web.filter.op.or') },
              ]}
              testID="filter-op"
            />
          ) : null}

          <Button
            tone="ghost"
            size="sm"
            leadingIcon={<Plus size={ICON_SIZE.sm} aria-hidden="true" />}
            data-testid="filter-add-condition"
            onClick={addCondition}
          >
            {t('web.filter.addCondition')}
          </Button>

          {error === '' ? null : (
            <p id="ht-filter-name-error" className="ht-sidebar__filter-form__error" role="alert">
              {error}
            </p>
          )}

          <div className="ht-sidebar__filter-form__actions">
            <Button tone="ghost" onClick={closeCreate}>
              {t('web.filter.cancel')}
            </Button>
            <Button
              type="submit"
              tone="primary"
              disabled={!canSave}
              leadingIcon={<Check size={ICON_SIZE.sm} aria-hidden="true" />}
              data-testid="filter-save"
            >
              {t('web.filter.save')}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
