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
import { AlertTriangle, Info, Upload } from 'lucide-react';

import { useI18n, type MessageKey } from '@heyta/i18n';

import { restoreFromExport } from '../../lib/oplog.js';
import { readFileText } from './import-file.js';

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
      <h2 className="ht-settings__title">{t('web.import.title')}</h2>
      <p className="ht-settings__hint">{t('web.import.intro')}</p>

      <section className="ht-settings__section">
        <h3 className="ht-settings__h3">
          <Upload size={12} aria-hidden="true" /> {t('web.import.fileLabel')}
        </h3>
        <div className="ht-settings__actions">
          <input
            className="ht-input"
            type="file"
            accept=".json,application/json"
            data-testid="import-file"
            aria-label={t('web.import.fileLabel')}
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
            <Upload size={12} aria-hidden="true" />
            {busy ? t('web.import.busy') : t('web.import.button')}
          </button>
        </div>
      </section>

      {/*
        🔴 诚实条款，不是说明文字。它同时是"只做了一半"的说明与安全承诺：
        用户必须知道 (a) 这不是万能导入、(b) 它不会动现有数据。
      */}
      <p className="ht-settings__notice" data-testid="import-empty-only">
        <Info size={12} aria-hidden="true" /> {t('web.import.emptyOnly')}
      </p>

      {/*
        第二条诚实条款：还原**只作用在本机**。导入的 op 带着原设备的 clientId，
        服务端会以 INVALID_CLIENT_ID 拒绝它们，所以这台设备不会把它们上传。
        不说的话，用户会以为"还原完就同步到云上了"。
      */}
      <p className="ht-settings__notice" data-testid="import-local-only">
        <Info size={12} aria-hidden="true" /> {t('web.import.localOnly')}
      </p>

      {outcome?.kind === 'restored' && (
        <p className="ht-settings__hint" data-testid="import-success">
          {t('web.import.success', {
            entities: outcome.result.entities,
            deleted: outcome.result.deleted,
            ops: outcome.result.importedOps,
          })}
          {outcome.result.skippedOps > 0
            ? ` ${t('web.import.skipped', { skipped: outcome.result.skippedOps })}`
            : ''}
        </p>
      )}

      {outcome?.kind === 'refused' && (
        <p className="ht-settings__danger" role="alert" data-testid="import-refused">
          <AlertTriangle size={12} aria-hidden="true" /> {t(REASON_KEYS[outcome.reason])}
        </p>
      )}

      {failed && (
        <p className="ht-settings__danger" role="alert" data-testid="import-failed">
          <AlertTriangle size={12} aria-hidden="true" /> {t('web.import.failed')}
        </p>
      )}
    </div>
  );
}
