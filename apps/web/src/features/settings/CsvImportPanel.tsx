/**
 * 设置 ·「从 CSV / Todoist 导入」卡片
 * ==================================
 *
 * 选来源（通用 CSV / Todoist）→ 选文件 → **预览计数** → 确认导入。解析与写入的
 * 判断都在 `@heyta/domain` / `@heyta/app-host`；本文件只做选择、预览、确认三件事。
 * 与「导入 / 还原」（heyta 自有备份，只能进空库）是两件事：这里是跨产品迁移，
 * 走普通 op，可与既有数据共存。
 */

import { Upload } from 'lucide-react';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';
import {
  type CsvImportKind,
  type TickTickImportPlan,
  type TickTickImportReport,
  type TickTickParseFailure,
} from '@heyta/domain';
import { useState } from 'react';

import { Button } from '../../components/hta/index.js';
import { readFileText } from './import-file.js';
import { SettingsFilePicker } from './SettingsFilePicker.js';
import { confirmCsvImport, previewCsvImport, type CsvPreview } from './csv-import.js';

type ReadyPreview = Extract<CsvPreview, { ok: true }>;

const FAILURE_KEYS: Record<TickTickParseFailure | 'unsupported', MessageKey> = {
  'no-header': 'web.csvimport.failure.noHeader',
  'no-tasks': 'web.csvimport.failure.noTasks',
  unsupported: 'web.csvimport.failure.unsupported',
};

type Stage =
  | { readonly kind: 'idle' }
  | { readonly kind: 'ready'; readonly preview: ReadyPreview }
  | { readonly kind: 'parse-failed'; readonly reason: TickTickParseFailure | 'unsupported' }
  | { readonly kind: 'done'; readonly report: TickTickImportReport }
  | { readonly kind: 'read-failed' }
  | { readonly kind: 'import-failed' };

export function CsvImportPanel(): React.JSX.Element {
  const { t } = useI18n();
  const [kind, setKind] = useState<CsvImportKind>('generic');
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  const onFile: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    setFileName(file.name);
    setStage({ kind: 'idle' });
    setBusy(true);
    void (async () => {
      try {
        const preview = previewCsvImport(kind, await readFileText(file));
        setStage(preview.ok ? { kind: 'ready', preview } : { kind: 'parse-failed', reason: preview.reason });
      } catch {
        setStage({ kind: 'read-failed' });
      } finally {
        setBusy(false);
      }
    })();
  };

  const onConfirm = (plan: TickTickImportPlan, report: TickTickImportReport): void => {
    setBusy(true);
    void (async () => {
      try {
        await confirmCsvImport(plan, report);
        setStage({ kind: 'done', report });
      } catch {
        setStage({ kind: 'import-failed' });
      } finally {
        setBusy(false);
      }
    })();
  };

  const preview = stage.kind === 'ready' ? stage.preview.report : undefined;
  const skippedCount = preview === undefined ? 0 : preview.skipped.length;

  return (
    <section
      className="ht-settings__data-card"
      data-testid="csv-import-panel"
      aria-label={t('web.csvimport.title')}
    >
      <header className="ht-settings__data-card-header">
        <div>
          <h3 className="ht-settings__data-card-title ht-type-headline">
            <Upload size={ICON_SIZE.sm} aria-hidden="true" />
            {t('web.csvimport.title')}
          </h3>
        </div>
      </header>
      <div className="ht-settings">
        <div className="ht-settings__actions">
          <select
            className="ht-input"
            value={kind}
            data-testid="csv-import-kind"
            onChange={(event) => {
              setKind(event.target.value === 'todoist' ? 'todoist' : 'generic');
              setStage({ kind: 'idle' });
              setFileName(undefined);
            }}
          >
            <option value="generic">{t('web.csvimport.kindGeneric')}</option>
            <option value="todoist">{t('web.csvimport.kindTodoist')}</option>
          </select>
          <SettingsFilePicker
            accept=".csv,text/csv,text/plain"
            label={t('web.csvimport.pick')}
            testId="csv-import-file"
            disabled={busy}
            selected={fileName !== undefined}
            onChange={onFile}
          />
        </div>
        {fileName !== undefined ? (
          <p className="ht-settings__data-status-label" data-settings-readout data-testid="csv-import-filename">
            {fileName}
          </p>
        ) : null}

        {stage.kind === 'ready' && preview !== undefined ? (
          <>
            <p className="ht-settings__data-status" data-settings-readout data-testid="csv-import-preview">
              {t('web.csvimport.preview', {
                tasks: preview.tasks,
                projects: preview.projects,
                tags: preview.tags,
                skipped: skippedCount,
              })}
            </p>
            <div className="ht-settings__actions">
              <Button
                tone="primary"
                size="sm"
                loading={busy}
                data-testid="csv-import-confirm"
                onClick={() => {
                  onConfirm(stage.preview.plan, stage.preview.report);
                }}
              >
                {t('web.csvimport.import')}
              </Button>
            </div>
          </>
        ) : null}

        {stage.kind === 'parse-failed' ? (
          <p className="ht-settings__data-status" role="status" data-testid="csv-import-error">
            {t(FAILURE_KEYS[stage.reason])}
          </p>
        ) : null}

        {stage.kind === 'done' ? (
          <p className="ht-settings__data-status" role="status" data-settings-readout data-testid="csv-import-done">
            {t('web.csvimport.done', { tasks: stage.report.tasks })}
          </p>
        ) : null}

        {stage.kind === 'read-failed' ? (
          <p className="ht-settings__data-status" role="status">
            {t('web.csvimport.readFailed')}
          </p>
        ) : null}

        {stage.kind === 'import-failed' ? (
          <p className="ht-settings__data-status" role="status">
            {t('web.csvimport.importFailed')}
          </p>
        ) : null}
      </div>
    </section>
  );
}
