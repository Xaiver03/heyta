import { ICON_SIZE } from '@heyta/design-system';
/**
 * 从滴答清单导入（设置页面板）—— B2-1 的界面那一半
 * ======================================================
 *
 * 逻辑（解析 / 字段映射 / 幂等 / 引用顺序 / 报告）全在 `@heyta/domain` 与
 * `@heyta/app-host`，本文件只做三件事：
 *
 *   1. 让用户选一份 CSV（复用导出/还原面板的 `readFileText`）；
 *   2. **先预览、再确认**：写库之前必须让用户看到"会新建多少、哪些带不进来"；
 *   3. 用词条表把结构化的 `reason` / `field` 翻成人话（穷举 `Record`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 两条必须在界面上说清的话
 *
 *   · **只认滴答清单**。仓库里 Todoist 的解析**不存在** —— 界面上写一句
 *     "支持滴滴答清单 / Todoist"就是在说谎，而这类话最容易出现在导入功能上。
 *   · **它与本仓库那个「导入 / 还原」面板不是一件事**：那个是还原 heyta 自己的
 *     导出文件、只支持空库；这个走普通 op、可与既有数据共存。
 *
 * 🔴 预览与确认用的是**同一份 plan / report**（见 `ticktick-import.ts` 文件头）：
 * 界面上的数字与真的写进去的东西因此来自同一次解析。
 */

import { useState } from 'react';

import type { TickTickImportResult } from '@heyta/app-host';
import {
  type TickTickImportPlan,
  type TickTickImportReport,
  type TickTickParseFailure,
  type TickTickSkipReason,
  type TickTickUnmappedField,
} from '@heyta/domain';
import { AlertTriangle, Info, Upload } from 'lucide-react';

import { useI18n, type MessageKey } from '@heyta/i18n';

import { readFileText } from './import-file.js';
import {
  confirmTickTickImport,
  previewTickTickImport,
  type TickTickPreview,
} from './ticktick-import.js';

/**
 * 解析失败的两种原因 → 词条。**穷举**（加一个成员就编译失败）。
 */
const FAILURE_KEYS: Record<TickTickParseFailure, MessageKey> = {
  'no-header': 'web.ticktick.failure.noHeader',
  'no-tasks': 'web.ticktick.failure.noTasks',
};

/** 跳过原因 → 词条。**穷举**，理由同上。 */
const SKIP_KEYS: Record<TickTickSkipReason, MessageKey> = {
  'empty-title': 'web.ticktick.skip.emptyTitle',
  'duplicate-source-id': 'web.ticktick.skip.duplicateSourceId',
};

/**
 * 没有归宿的字段 → 词条。**穷举**。
 *
 * ⚠️ 这个 `Record` 不是装饰：`TickTickUnmappedField` 加一个成员时，
 * 缺一条就编译不过 —— 而"新字段悄悄带不进来、界面上又不说"正是导入功能
 * 最容易发生的静默丢数据。
 */
const UNMAPPED_KEYS: Record<TickTickUnmappedField, MessageKey> = {
  reminder: 'web.ticktick.unmapped.reminder',
  startDate: 'web.ticktick.unmapped.startDate',
  parentId: 'web.ticktick.unmapped.parentId',
  isFloating: 'web.ticktick.unmapped.isFloating',
  columnName: 'web.ticktick.unmapped.columnName',
  columnOrder: 'web.ticktick.unmapped.columnOrder',
  viewMode: 'web.ticktick.unmapped.viewMode',
  timezone: 'web.ticktick.unmapped.timezone',
  archiveStatus: 'web.ticktick.unmapped.archiveStatus',
  priority: 'web.ticktick.unmapped.priority',
  status: 'web.ticktick.unmapped.status',
  kind: 'web.ticktick.unmapped.kind',
  repeat: 'web.ticktick.unmapped.repeat',
  missingSourceId: 'web.ticktick.unmapped.missingSourceId',
};

/** 成功的预览（`TickTickPreview` 收窄之后的形状）。 */
type ReadyPreview = Extract<TickTickPreview, { ok: true }>;

type Stage =
  | { readonly kind: 'idle' }
  | { readonly kind: 'ready'; readonly preview: ReadyPreview }
  | {
      readonly kind: 'parse-failed';
      readonly reason: TickTickParseFailure;
      readonly report: TickTickImportReport;
    }
  | { readonly kind: 'done'; readonly result: TickTickImportResult }
  | { readonly kind: 'read-failed' }
  | { readonly kind: 'import-failed' };

export function TickTickImportPanel(): React.JSX.Element {
  const { t } = useI18n();
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  /** 读文件 → 预览。**只读，不写库。** */
  const pick = async (next: File): Promise<void> => {
    setFileName(next.name);
    setStage({ kind: 'idle' });
    setBusy(true);
    try {
      const preview = previewTickTickImport(await readFileText(next));
      setStage(preview.ok ? { kind: 'ready', preview } : { kind: 'parse-failed', ...preview });
    } catch {
      setStage({ kind: 'read-failed' });
    } finally {
      setBusy(false);
    }
  };

  /** 确认：把预览那一份 plan / report 原样交回去写。 */
  const confirm = async (plan: TickTickImportPlan, report: TickTickImportReport): Promise<void> => {
    setBusy(true);
    try {
      setStage({ kind: 'done', result: await confirmTickTickImport(plan, report) });
    } catch {
      // 🔴 不假装成功：中途失败可能有部分内容已写入，界面如实说"再导一次不会重复"。
      setStage({ kind: 'import-failed' });
    } finally {
      setBusy(false);
    }
  };

  const skipped = stage.kind === 'ready' ? stage.preview.report.skippedCounts : {};
  const unmapped = stage.kind === 'ready' ? stage.preview.report.unmappedCounts : {};

  return (
    <div className="ht-settings" data-testid="ticktick-import-panel">
      <h2 className="ht-settings__title ht-type-section-title">{t('web.ticktick.title')}</h2>
      <p className="ht-settings__hint">{t('web.ticktick.intro')}</p>

      <section className="ht-settings__section">
        <h3 className="ht-settings__h3 ht-type-headline">
          <Upload size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.ticktick.fileLabel')}
        </h3>
        <div className="ht-settings__actions">
          <input
            className="ht-input"
            type="file"
            accept=".csv,text/csv"
            data-testid="ticktick-file"
            aria-label={t('web.ticktick.fileLabel')}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.files?.[0];
              if (next !== undefined) void pick(next);
            }}
          />
        </div>
        {fileName !== undefined && (
          <p className="ht-settings__hint" data-testid="ticktick-file-name">
            {t('web.ticktick.picked', { name: fileName })}
          </p>
        )}
      </section>

      {/* 诚实条款：只认滴答清单 —— Todoist 的解析在本仓库不存在。 */}
      <p className="ht-settings__notice" data-testid="ticktick-ticktick-only">
        <Info size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.ticktick.ticktickOnly')}
      </p>

      {/* 与"还原自己的导出"是两个不同的承诺，必须在界面上分开说。 */}
      <p className="ht-settings__notice" data-testid="ticktick-coexist">
        <Info size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.ticktick.coexist')}
      </p>

      {busy && (
        <p className="ht-settings__hint" data-testid="ticktick-busy">
          {t('web.ticktick.busy')}
        </p>
      )}

      {stage.kind === 'parse-failed' && (
        <p className="ht-settings__danger" role="alert" data-testid="ticktick-parse-failed">
          <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" /> {t(FAILURE_KEYS[stage.reason])}
        </p>
      )}

      {stage.kind === 'read-failed' && (
        <p className="ht-settings__danger" role="alert" data-testid="ticktick-read-failed">
          <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.ticktick.readFailed')}
        </p>
      )}

      {stage.kind === 'import-failed' && (
        <p className="ht-settings__danger" role="alert" data-testid="ticktick-import-failed">
          <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.ticktick.importFailed')}
        </p>
      )}

      {stage.kind === 'ready' && (
        <section className="ht-settings__section" data-testid="ticktick-preview">
          <h3 className="ht-settings__h3 ht-type-headline">{t('web.ticktick.previewTitle')}</h3>
          <p className="ht-settings__hint" data-testid="ticktick-preview-counts">
            {stage.preview.batch.entries.length === 0
              ? t('web.ticktick.previewNoop')
              : t('web.ticktick.previewCounts', {
                  projects: stage.preview.batch.plan.projects.length,
                  tags: stage.preview.batch.plan.tags.length,
                  tasks: stage.preview.batch.plan.tasks.length,
                  ops: stage.preview.batch.entries.length,
                })}
          </p>
          <p className="ht-settings__hint" data-testid="ticktick-preview-rows">
            {t('web.ticktick.previewRows', {
              rows: stage.preview.report.dataRows,
              checklist: stage.preview.report.checklistItems,
              recurring: stage.preview.report.recurringTasks,
              completed: stage.preview.report.completedTasks,
            })}
          </p>

          {(Object.keys(skipped) as TickTickSkipReason[]).length > 0 && (
            <div data-testid="ticktick-skipped">
              <p className="ht-settings__hint">{t('web.ticktick.skippedTitle')}</p>
              <ul className="ht-settings__list">
                {(Object.keys(skipped) as TickTickSkipReason[]).map((reason) => (
                  <li key={reason}>
                    {t(SKIP_KEYS[reason], { count: skipped[reason] ?? 0 })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(Object.keys(unmapped) as TickTickUnmappedField[]).length > 0 && (
            <div data-testid="ticktick-unmapped">
              <p className="ht-settings__hint">{t('web.ticktick.unmappedTitle')}</p>
              <ul className="ht-settings__list">
                {(Object.keys(unmapped) as TickTickUnmappedField[]).map((field) => (
                  <li key={field}>
                    {t(UNMAPPED_KEYS[field], { count: unmapped[field] ?? 0 })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="ht-settings__actions">
            <button
              type="button"
              className="ht-btn ht-btn--primary"
              data-testid="ticktick-confirm"
              disabled={busy}
              onClick={() => void confirm(stage.preview.plan, stage.preview.report)}
            >
              <Upload size={ICON_SIZE.xs} aria-hidden="true" />
              {t('web.ticktick.confirm')}
            </button>
          </div>
        </section>
      )}

      {stage.kind === 'done' && (
        <p className="ht-settings__hint" data-testid="ticktick-done">
          {stage.result.opCount === 0
            ? t('web.ticktick.doneNoop')
            : t('web.ticktick.done', {
                projects: stage.result.added.projects,
                tags: stage.result.added.tags,
                tasks: stage.result.added.tasks,
                ops: stage.result.opCount,
              })}
        </p>
      )}
    </div>
  );
}
