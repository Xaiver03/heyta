import { ICON_SIZE } from '@heyta/design-system';
/**
 * 导入 / 还原面板（设置页）
 * ============================
 *
 * 这个面板兑现 `README.md` 设计原则第 5 条「导出自由」的另一半 ——
 * 在此之前，导出的文件只能出、不能回，界面与 Markdown 页脚都写着
 * "这是导出，还不是还原点"。
 *
 * 🔴 **界面必须诚实地只说它支持的那一种模式。**
 *
 * 本轮只支持**还原到空库**（`restoreIntoEmptyTarget`），不做"合并到已有数据的库"：
 * id 冲突、时钟/op 顺序、"本地是否更新版本"三件事本轮都没有可信判据，
 * 做出来会静默丢数据 —— 理由完整写在 `packages/app-host/src/import-dump.ts` 文件头。
 *
 * 所以这里**不写一句看起来万能的"导入"**，而是白纸黑字地说：
 * 「只支持还原到空库；本机已有数据时直接拒绝，不会清空或覆盖任何现有数据」。
 *
 * 面板本身**不做任何"能不能导"的判断**：解析、版本校验、空库判定、
 * 结果核对全在 `@heyta/app-host`。这里只负责：
 *
 *   1. 让用户选一个文件（`import-file.ts` 读成文本 —— 浏览器行为，jsdom 里可测）；
 *   2. 调 `restoreFromExport()`（`lib/oplog.ts` 提供本地存储 + 通知刷新）；
 *   3. 用词条表把结构化的 `reason` 翻成人话。
 */

import { useState } from 'react';

import type { ExportImportFailureReason, RestoreExportResult } from '@heyta/app-host';
import { Upload } from 'lucide-react';

import { useI18n, type MessageKey } from '@heyta/i18n';

import { restoreFromExport } from '../../lib/oplog.js';
import { readFileText } from './import-file.js';
import { SettingsNotice } from './SettingsNotice.js';
import { SettingsFilePicker } from './SettingsFilePicker.js';

/**
 * 结构化 `reason` → 词条。**穷举**（`Record<Union, MessageKey>`）。
 *
 * 🔴 用 `Record` 而不是 `switch` + default：`ExportImportFailureReason` 加一个成员时
 * 这里会**编译失败**，逼人为它加一句人话。有 default 的写法会让新原因静默
 * 落进兜底文案 —— 用户看到"还原失败"，而真正的原因没人说。
 */
const REASON_KEYS: Record<ExportImportFailureReason, MessageKey> = {
  'invalid-json': 'web.import.reason.invalidJson',
  'invalid-document': 'web.import.reason.invalidDocument',
  'wrong-application': 'web.import.reason.wrongApplication',
  'unsupported-format-version': 'web.import.reason.unsupportedFormatVersion',
  'unsupported-schema-version': 'web.import.reason.unsupportedSchemaVersion',
  'inconsistent-document': 'web.import.reason.inconsistentDocument',
  'target-not-empty': 'web.import.reason.targetNotEmpty',
  'verification-failed': 'web.import.reason.verificationFailed',
};

type Outcome =
  | { kind: 'restored'; result: Extract<RestoreExportResult, { ok: true }> }
  | { kind: 'refused'; reason: ExportImportFailureReason };

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImportPanel(): React.JSX.Element {
  const { t } = useI18n();
  const [file, setFile] = useState<File | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const run = async (): Promise<void> => {
    if (file === undefined) return;
    setFailed(false);
    setOutcome(undefined);
    setBusy(true);
    try {
      const result = await restoreFromExport(await readFileText(file));
      // ⚠️ 刻意**不渲染** `result.detail`：它是给 CLI / 日志的诊断串，
      // 不是文案（没有走词条表）。把它显示在英文界面上会漏出中文。
      if (result.ok) setOutcome({ kind: 'restored', result });
      else setOutcome({ kind: 'refused', reason: result.reason });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ht-settings" data-testid="import-panel">
      <h2 className="ht-settings__title ht-type-section-title">{t('web.import.title')}</h2>
      <p className="ht-settings__hint">{t('web.import.intro')}</p>

      <section className="ht-settings__section" aria-labelledby="import-file-title">
        <h3 id="import-file-title" className="ht-settings__h3 ht-type-headline">
          <Upload size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.import.fileLabel')}
        </h3>
        <div className="ht-settings__actions">
          <SettingsFilePicker
            selected={file !== undefined}
            accept=".json,application/json"
            testId="import-file"
            label={t('web.import.fileLabel')}
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0]);
              setOutcome(undefined);
              setFailed(false);
            }}
          />
          <button
            type="button"
            className="ht-btn ht-btn--primary"
            data-testid="import-run"
            disabled={busy || file === undefined}
            onClick={() => void run()}
          >
            <Upload size={ICON_SIZE.xs} aria-hidden="true" />
            {busy ? t('web.import.busy') : t('web.import.button')}
          </button>
        </div>
        {file !== undefined && (
          <div className="ht-settings__file-summary" data-testid="import-file-summary">
            <strong>{file.name}</strong>
            <span>{formatFileSize(file.size)}</span>
          </div>
        )}
      </section>

      {/*
        🔴 诚实条款，不是说明文字。它同时是"只做了一半"的说明与安全承诺：
        用户必须知道 (a) 这不是万能导入、(b) 它不会动现有数据。
      */}
      <SettingsNotice
        title={t('web.settings.dataUx.emptyTitle')}
        tone="warning"
        testId="import-empty-only"
      >{t('web.import.emptyOnly')}</SettingsNotice>

      {/*
        第二条诚实条款：还原**只作用在本机**。导入的 op 带着原设备的 clientId，
        服务端会以 INVALID_CLIENT_ID 拒绝它们，所以这台设备不会把它们上传。
        不说的话，用户会以为"还原完就同步到云上了"。
      */}
      <SettingsNotice title={t('web.settings.dataUx.localTitle')} testId="import-local-only">{t('web.import.localOnly')}</SettingsNotice>

      {outcome?.kind === 'restored' && (
        <SettingsNotice
          title={t('web.import.success', {
            entities: outcome.result.entities,
            deleted: outcome.result.deleted,
            ops: outcome.result.importedOps,
          })}
          tone="success"
          testId="import-success"
          live
        >
          {outcome.result.skippedOps > 0
            ? t('web.import.skipped', { skipped: outcome.result.skippedOps })
            : undefined}
        </SettingsNotice>
      )}

      {outcome?.kind === 'refused' && (
        <SettingsNotice
          title={t(REASON_KEYS[outcome.reason])}
          tone="danger"
          testId="import-refused"
          live
        />
      )}

      {failed && (
        <SettingsNotice title={t('web.import.failed')} tone="danger" testId="import-failed" live />
      )}
    </div>
  );
}
