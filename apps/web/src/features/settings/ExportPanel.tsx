import { ICON_SIZE } from '@heyta/design-system';
/**
 * 导出面板（设置页）
 * ====================
 *
 * 🔴 这个面板兑现 `README.md` 设计原则第 5 条「导出自由」，以及订阅到期提示里
 * 对用户的承诺「本地数据仍然可以正常查看、编辑和**导出**」。
 * 在此之前，全仓没有任何用户可见的导出入口 —— 那两句话是不实的
 * （见 `packages/app-host/src/export-dump.ts` 文件头）。
 *
 * 面板本身**不做任何"导出里该有什么"的判断**：文档构造、墓碑的包含与否、
 * 计数、Markdown 的格式全在 `@heyta/app-host`。这里只负责三件事：
 *
 *   1. 从本地 op-log 读数据（这是宿主职责）；
 *   2. 把包好的文本交给浏览器下载（`export-download.ts`）；
 *   3. 用词条表说清楚"这是导出、还不能导回来"。
 *
 * ⚠️ **下载这一步没有自动化验证**：`<a download>` 是浏览器行为，jsdom 里跑不了。
 * 被测试覆盖的是纯逻辑（app-host 的序列化器 + 这里的措辞装配）。
 */

import { useState } from 'react';

import {
  buildExportDocument,
  buildTaskExportRows,
  exportFileName,
  renderTasksMarkdown,
  serializeExportDocument,
  type ExportCounts,
  type ExportFormat,
} from '@heyta/app-host';
import { Download, FileJson, FileText } from 'lucide-react';

import { useI18n } from '@heyta/i18n';

import { currentState, requireStore } from '../../lib/oplog.js';
import { tasksMarkdownCopy } from './export-copy.js';
import { downloadTextFile } from './export-download.js';
import { SettingsNotice } from './SettingsNotice.js';
import { SettingsInfoTip } from './SettingsInfoTip.js';

export function ExportPanel({
  onlyJson = false,
  onJsonExported,
}: { onlyJson?: boolean; onJsonExported?: () => void } = {}): React.JSX.Element {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [counts, setCounts] = useState<ExportCounts | undefined>(undefined);

  const run = async (format: ExportFormat): Promise<void> => {
    setFailed(false);
    setBusy(true);
    try {
      const exportedAt = Date.now();
      const state = currentState();
      // `getAllOps()` 是"读全库"的正式入口，已按 seq 升序。
      const stored = await requireStore().getAllOps();
      const doc = buildExportDocument({
        state,
        ops: stored.map((row) => row.op),
        exportedAt,
        host: 'web',
      });

      if (format === 'json') {
        downloadTextFile(
          exportFileName('json', exportedAt),
          serializeExportDocument(doc),
          'application/json',
        );
        onJsonExported?.();
      } else {
        const markdown = renderTasksMarkdown(
          buildTaskExportRows(state),
          tasksMarkdownCopy(t),
          doc.exportedAt,
        );
        downloadTextFile(exportFileName('markdown', exportedAt), markdown, 'text/markdown');
      }

      setCounts(doc.counts);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ht-settings" data-testid="export-panel">
      {/*
        🔴 没有 h2 也没有 intro（2026-10-24 禁令）：节标题「数据管理」旁边那枚 `?`
        已经说明这一页管什么；面板再写「导出」+ 一句"把数据带走"就是同一件事的第三遍。
      */}

      <section className="ht-settings__section">
        <h3 className="ht-settings__h3 ht-type-row-title">
          <FileJson size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.export.json.label')}
          <SettingsInfoTip
            testId="tip-export-json"
            label={t('web.export.json.label')}
            text={t('web.export.json.note')}
          />
        </h3>
        <div className="ht-settings__actions">
          <button
            type="button"
            className="ht-btn ht-btn--primary"
            data-testid="export-json"
            disabled={busy}
            onClick={() => void run('json')}
          >
            <Download size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.export.json.button')}
          </button>
        </div>
      </section>

      {!onlyJson && <section className="ht-settings__section">
        <h3 className="ht-settings__h3 ht-type-row-title">
          <FileText size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.export.markdown.label')}
          <SettingsInfoTip
            testId="tip-export-markdown"
            label={t('web.export.markdown.label')}
            text={t('web.export.markdown.note')}
          />
        </h3>
        <div className="ht-settings__actions">
          {/*
            🔴 这一枚是**次要**动作（2026-10-24）：同一屏上「下载 JSON」已经是主色实底，
            而这一屏还有第二个主色实底 + 一个禁用的主色实底 —— 三个主按钮等于没有主按钮。
            给人看的 Markdown 是旁支（它不能导回），所以降到 ghost。
          */}
          <button
            type="button"
            className="ht-btn ht-btn--ghost"
            data-testid="export-markdown"
            disabled={busy}
            onClick={() => void run('markdown')}
          >
            <Download size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.export.markdown.button')}
          </button>
        </div>
      </section>}

      {counts !== undefined && (
        <p className="ht-settings__hint" role="status" data-settings-readout="true" data-testid="export-counts">
          {t('web.export.counts', {
            entities: counts.totalEntities,
            deleted: counts.totalDeleted,
            ops: counts.totalOps,
          })}
        </p>
      )}

      {/*
        🔴 诚实条款，不是说明文字。这一轮**不做导入**，所以必须明说 ——
        否则用户会把它当成还原点，而一个导不回来的文件当还原点用等于没有备份。
      */}
      <SettingsNotice
        title={t('web.settings.dataUx.formatsTitle')}
        tone="warning"
        testId="export-not-restore-point"
      >{t('web.export.notRestorePoint')}</SettingsNotice>

      {failed && (
        <SettingsNotice title={t('web.export.failed')} tone="danger" testId="export-failed" live />
      )}
    </div>
  );
}
