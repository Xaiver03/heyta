/**
 * 「导出数据」—— 移动端的导出自由
 * ==================================
 *
 * 这个屏兑现 `README.md` 设计原则第 5 条「导出自由」，以及订阅到期提示里
 * 对用户的承诺「本地数据仍然可以正常查看、编辑和**导出**」。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 导出的**内容形状**一行都不在这里：文档构造、墓碑的包含与否、计数、
 * Markdown 的排版全在 `@heyta/app-host`（`buildExportDocument` /
 * `renderTasksMarkdown`）。这里只负责三件事：
 *
 *   1. 从本地 op-log 读数据（宿主职责，`exportDocumentFromHost`）；
 *   2. **把文本交给平台**（移动端是系统分享面板，不是 `<a download>`）；
 *   3. 用词条表说清楚「这是导出；JSON 只能还原到空库」。
 *
 * 🔴 **移动端没有 `<a download>`，也没有内建文件系统。**
 * 不引新第三方依赖的前提下，平台上真实可用的方式只有 RN 核心的
 * `Share.share()`：把**导出文本**交给系统分享面板，由用户选择存到「文件」、
 * 发给自己、或者交给别的 App。代价要说清楚 —— 分享出去的是一个文本片段，
 * 文件名/扩展名由接收方决定，不是一次"另存为 heyta-export-….json"。
 * 界面上的 `mobile.export.shareHint` 就是这句实话。
 *
 * 🔴 诚实条款不可省（见 Web 端 `ExportPanel`）：**JSON 导出可以导回来，
 * 但只支持还原到空库；Markdown 那份是给人看的，导不回来**。这条话说的是
 * 还原的真实边界 —— 用户若把"能导回来"读成"随时能覆盖回去"，就会在
 * 有数据的设备上等一个永远不会发生的动作。
 * 这里直接复用 Web 的同一条词条（`web.export.notRestorePoint`），
 * 两端不可能说出不一样的话。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 与"导入"的关系（2026-09-29 补，2026-10-02 补还原）
 *
 * 同一屏里有**三件不同的事**，界面上分开说：
 *   · **导出**：heyta → 一个文件（JSON 可导回，Markdown 不可）。
 *   · **还原**：heyta 自己的 JSON → 本机，**只进空库**（多端覆盖审计 P1-2）。
 *     🔴 **还原回来的数据只在这台设备上**：还原走 `OpLogStore.appendImported`，
 *     它把这些 op 标成"不进上传队列"，因为 op 带的是**原设备**的 `clientId`，
 *     而服务端 `validateOp` 对 `op.clientId !== requestClientId` 逐条回
 *     `INVALID_CLIENT_ID`（`server/src/sync/services/validation.service.ts:75`）。
 *     所以"换机后其他设备也能看到这批"是**不成立**的，界面上那句成功语
 *     （`mobile.restore.done`）说的就是这件事本身 —— 别说"会自动上行"。
 *     ⚠️ 还原之后本机新写的照常同步（判据④b 钉的就是这条）。
 *   · **导入**：**滴答清单的 CSV** → heyta；不是还原点，也不覆盖既有数据。
 *
 * 🔴 输入方式在两端**不一样，且不假装等价**：
 *   · 还原走**系统文件选择器**（`@react-native-documents/picker` v12，MIT，
 *     2026-07 仍发版，peer `react-native >= 0.79` 覆盖本仓库的 0.84.1）
 *     + 粘贴兜底 —— 备份本来就是一个文件。
 *     ⚠️ 依赖裁决的第一版选的是**旧包名** `react-native-document-picker@9.3.1`，
 *     它在 RN 0.84 上 `compileReleaseJavaWithJavac` **编不过**（引用的
 *     `com.facebook.react.bridge.GuardedResultAsyncTask` 已被 RN 删除）。
 *     同项目的活跃后继是 scoped 的 `@react-native-documents/picker`，
 *     换过去才编得动 —— 换包名 = API 也换（`pick()` + `keepLocalCopy()`，
 *     没有 `pickSingle` / `fileCopyUri`）。
 *   · 滴答导入走**粘贴**（见 `lib/ticktick-import.ts` 文件头：手机上 CSV
 *     常常就在聊天/邮件里，长按复制再粘进来是更短的一条路）。
 *
 * 🔴 "选来的文件怎么读出文本"不是 JS 能解决的：RN 0.84.1 在 Android 上
 * 对 `content://` / `file://` 一律读不出字节（fetch 与 XHR 都是，含 blob），
 * 失败点在 `NetworkingModule.kt:318` —— 机制与实测见 traps #124 与
 * `lib/local-file-read.ts` 文件头。iOS 侧暂无对应原生模块，退路**未在模拟器验证**。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Share } from 'react-native';
import { keepLocalCopy, pick } from '@react-native-documents/picker';

import {
  buildTaskExportRows,
  exportDocumentFromHost,
  parseExportDocument,
  renderTasksMarkdown,
  restoreIntoEmptyTarget,
  serializeExportDocument,
  type AppHost,
  type ExportCounts,
  type ExportDocument,
  previewRestore,
  type RestoreDocument,
  type ExportFormat,
  type ExportImportFailureReason,
  type TickTickImportResult,
} from '@heyta/app-host';
import { useI18n, type MessageKey } from '@heyta/i18n';

import { readLocalTextUri } from '../lib/local-file-read';
import { openTaskHost } from '../db/open-host';
import { tasksMarkdownCopy } from '../lib/export-copy';
import {
  confirmTickTickImport,
  previewTickTickImport,
  type TickTickPreview,
} from '../lib/ticktick-import';
import { Button, Card, Screen, Stack, Text, TextField } from '../ui/kit';

/** 一句待渲染的文案：词条键 + 插值，措辞全在词条表里（AGENTS §5）。 */
interface FailureMessage {
  readonly key: MessageKey;
  readonly vars?: Readonly<Record<string, string | number>>;
}

/**
 * 失败原因 → 词条。** exhaustive Record**：app-host 新增一个 reason 时
 * 这里编译期就红，不会变成一个静默的"未知错误"。
 */
const RESTORE_FAILURE_KEYS: Record<ExportImportFailureReason, MessageKey> = {
  'invalid-json': 'mobile.restore.error.invalidJson',
  'invalid-document': 'mobile.restore.error.invalidDocument',
  'unsupported-format-version': 'mobile.restore.error.formatVersion',
  'wrong-application': 'mobile.restore.error.wrongApp',
  'unsupported-schema-version': 'mobile.restore.error.schemaVersion',
  'target-not-empty': 'mobile.restore.error.targetNotEmpty',
  'inconsistent-document': 'mobile.restore.error.inconsistent',
  'verification-failed': 'mobile.restore.error.verification',
};

/**
 * 确认面板那几个数字。
 *
 * 🔴 走 `previewRestore`（重放）而不是 `document.counts`（文件自己声明的那一格）：
 * 只交 op-log 的恢复产物没有 `counts.entities`，照原来那样 `?? 0` 会让面板说
 * "0 条记录、0 条已删除"，而按下去真的会导进 3 条含 1 墓碑 —— 那是界面在说谎。
 */
function restorePreviewVars(doc: RestoreDocument): Record<string, number> {
  const p = previewRestore(doc);
  return {
    tasks: p.perType.TASK?.total ?? 0,
    projects: p.perType.PROJECT?.total ?? 0,
    tags: p.perType.TAG?.total ?? 0,
    entities: p.totalEntities,
    deleted: p.totalDeleted,
    ops: p.totalOps,
  };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 读一份选中的备份。先直接读选择器给的 `content://`（SAF 已把临时读权限授给
 * 本应用）；只有它打不开时才退到"复制进缓存再读 `file://`"。
 *
 * 🔴 空文本一律算失败：宁可就地说"读出来是空的"，也不要静默什么都不发生 ——
 * 这一条是被"选完文件界面毫无反应"逼出来的（连着三轮判据都以为选择器没回结果，
 * 实际是三条读取通道全塌、而错误没地方显示）。
 */
async function readPickedBackup(contentUri: string, fileName: string): Promise<string> {
  let why = '';
  try {
    const text = await readLocalTextUri(contentUri);
    if (text.trim() !== '') return text;
    why = 'content:// 读到空内容';
  } catch (e: unknown) {
    why = `content:// ${errText(e)}`;
  }
  const [copy] = await keepLocalCopy({
    files: [{ uri: contentUri, fileName }],
    destination: 'cachesDirectory',
  });
  if (copy === undefined || copy.status !== 'success') {
    throw new Error(`${why} ｜ 复制到缓存失败 ${copy === undefined ? '没有回结果' : copy.copyError}`);
  }
  let local = '';
  try {
    local = await readLocalTextUri(copy.localUri);
  } catch (e: unknown) {
    throw new Error(`${why} ｜ file:// ${errText(e)}`);
  }
  if (local.trim() === '') throw new Error(`${why} ｜ file:// 读到空内容`);
  return local;
}

export function ExportScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useI18n();

  const [host, setHost] = useState<AppHost | null>(null);
  const [busy, setBusy] = useState<ExportFormat | undefined>(undefined);
  const [counts, setCounts] = useState<ExportCounts | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  /** 导入：粘贴的 CSV 原文。 */
  const [importText, setImportText] = useState('');
  /** 预览结果（含解析失败）。`undefined` = 还没预览过。 */
  const [preview, setPreview] = useState<TickTickPreview | undefined>(undefined);
  /** 确认后的结果。 */
  const [importResult, setImportResult] = useState<TickTickImportResult | undefined>(undefined);
  const [importBusy, setImportBusy] = useState(false);

  // ── 从备份还原（批五，多端覆盖审计 P1-2）─────────────────────────
  const [restoreText, setRestoreText] = useState('');
  const [restorePreview, setRestorePreview] = useState<RestoreDocument | undefined>(undefined);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreResult, setRestoreResult] = useState<
    { importedOps: number; entities: number } | undefined
  >(undefined);
  const [restoreError, setRestoreError] = useState<FailureMessage | undefined>(undefined);
  // 低频输入默认收起；选择文件仍是恢复备份的主入口。
  const [restorePasteOpen, setRestorePasteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  /** 还原失败原因 → 词条（reason 集合由 app-host 的返回类型穷尽界定）。 */
  const restoreReasonMessage = useCallback(
    (reason: ExportImportFailureReason, detail?: string): FailureMessage => {
      const key = RESTORE_FAILURE_KEYS[reason];
      return detail === undefined ? { key } : { key, vars: { detail } };
    },
    [],
  );

  /**
   * 预检：解析 + 版本/应用/自洽校验，**一个字节都不写**。
   *
   * 🔴 `parseExportDocument` 的拒绝矩阵在 app-host 有契约测试
   * （截断 / 版本不符 / 词表外 opType / 计数自相矛盾）；界面的职责只是
   * 把每个拒绝原因**说成人话**并且**不崩溃** —— 变异靶是"拿掉这道预检"
   * （判据①），见 `scripts/verify-mobile-restore.sh`。
   */
  const handleRestoreText = useCallback(
    (text: string): void => {
      // 🔴 这里**没有静默返回**的余地：以前 host 为 null 或文本为空就 `return`，
      // 用户按了按钮界面上一言不发，而那正是"看起来什么都没发生"的形态。
      if (host === null) {
        setRestoreError({ key: 'mobile.restore.error.hostNotReady' });
        return;
      }
      if (text.trim() === '') {
        setRestoreError({ key: 'mobile.restore.error.emptyFile' });
        return;
      }
      setRestoreError(undefined);
      setRestoreResult(undefined);
      const parsed = parseExportDocument(text);
      if (!parsed.ok) {
        setRestoreError(restoreReasonMessage(parsed.reason, parsed.detail));
        setRestorePreview(undefined);
        return;
      }
      setRestorePreview(parsed.document);
    },
    [host, restoreReasonMessage],
  );

  /**
   * 选文件：`@react-native-documents/picker` v12（批五依赖裁决，见文件头）。
   *
   * 🔴 `pick()` 在 Android 上回的是 `content://` URI，读它要走下面那两条通道
   * （fetch 与 XHR+本机副本）；
   * 用户取消（`OPERATION_CANCELED`）是**正常路径**，静默返回，
   * 但"读不出来"不是 —— 它必须说出来，否则用户会以为选了文件却什么也没发生。
   */
  const pickBackupFile = useCallback((): void => {
    if (host === null) return;
    setRestoreError(undefined);
    setRestoreResult(undefined);
    void (async () => {
      const docs = await pick({ allowMultiSelection: false }).catch((e: unknown) => {
        // 🔴 取消是正常路径，静默返回；**其他**错误码不能说谎 ——
        // 把它当成"用户取消了"会让一次真实的失败长得像什么都没发生。
        if ((e as { code?: string }).code === 'OPERATION_CANCELED') return undefined;
        setRestoreError({
          key: 'mobile.restore.error.readFailed',
          vars: { detail: e instanceof Error ? e.message : String(e) },
        });
        return undefined;
      });
      if (docs === undefined) return; // 用户取消（OPERATION_CANCELED）
      const doc = docs[0];
      // 🔴 空数组**不是**取消，不能静默：选择器已经关掉、界面却一言不发，
      // 用户只能再点一次按钮 —— 而这一轮排查里，"静默"正是最难归因的形态。
      if (doc === undefined) {
        setRestoreError({ key: 'mobile.restore.error.emptyFile' });
        return;
      }
      const name = doc.name ?? 'heyta-backup.json';
      let text: string;
      try {
        text = await readPickedBackup(doc.uri, name);
      } catch (e: unknown) {
        setRestoreError({ key: 'mobile.restore.error.readFailed', vars: { detail: errText(e) } });
        return;
      }
      handleRestoreText(text);
    })();
  }, [host, handleRestoreText]);

  const confirmRestore = useCallback((): void => {
    if (host === null || restorePreview === undefined || restoreBusy) return;
    setRestoreBusy(true);
    setRestoreError(undefined);
    void restoreIntoEmptyTarget(
      // 🔴 只交引擎：空库守卫走 `engine.countStoredOps()`（索引计数），
      // 不再为了数一下就把整库连密文正文搬进内存。
      { engine: host.engine },
      restorePreview,
    )
      .then((result) => {
        if (result.ok) {
          setRestoreResult({ importedOps: result.importedOps, entities: result.entities });
          setRestorePreview(undefined);
          setRestoreText('');
        } else {
          setRestoreError(restoreReasonMessage(result.reason, result.detail));
        }
      })
      .finally(() => {
        setRestoreBusy(false);
      });
  }, [host, restorePreview, restoreBusy, restoreReasonMessage]);

  useEffect(() => {
    let alive = true;
    openTaskHost()
      .then((next) => {
        if (alive) setHost(next);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 生成 + 分享。
   *
   * 🔴 **生成**与**分享**分开 catch：它们失败的原因完全不同。
   * 生成失败是"数据读不出来"（`failed`），分享失败是"面板没打开"
   * （`shareFailed`）—— 合成一句话会让用户以为导出文件坏了，
   * 而其实内容已经算好了、只是没送出去。
   */
  const run = (format: ExportFormat): void => {
    if (host === null) return;
    setBusy(format);
    setFailed(false);
    setShareFailed(false);
    setError(undefined);

    void (async () => {
      let content: string;
      try {
        const exportedAt = Date.now();
        const doc = await exportDocumentFromHost(host, { exportedAt, host: 'mobile' });
        content =
          format === 'json'
            ? serializeExportDocument(doc)
            : renderTasksMarkdown(
                buildTaskExportRows(host.getState()),
                tasksMarkdownCopy(t),
                doc.exportedAt,
              );
        setCounts(doc.counts);
      } catch (e: unknown) {
        setFailed(true);
        setError(e instanceof Error ? e.message : String(e));
        setBusy(undefined);
        return;
      }

      try {
        // `Share.share` 是 RN 核心能力，不需要任何新依赖。
        // 用户取消分享时它正常 resolve（`dismissedAction`），不算失败。
        await Share.share({ title: t('mobile.export.shareTitle'), message: content });
      } catch {
        setShareFailed(true);
      } finally {
        setBusy(undefined);
      }
    })();
  };

  /**
   * 预览：解析 + 算"会写什么"，**一个字都不写**。
   *
   * 🔴 与 web 同一套流水线（`previewTickTickImport` → 用户确认 → `confirmTickTickImport`）。
   * 直接导入（没有预览那一步）会让"这份 CSV 里其实有 3000 条、把库刷满"
   * 变成一次不可撤的操作 —— 而导入**是一次批量写入**，没有撤销。
   */
  const runPreview = (): void => {
    if (host === null) return;
    setImportBusy(true);
    setImportResult(undefined);
    try {
      setPreview(previewTickTickImport(importText, host));
    } finally {
      setImportBusy(false);
    }
  };

  /**
   * 确认导入。
   *
   * 🔴 **不吞异常**：`confirmTickTickImport` 在半途抛错时原样上抛 ——
   * 见 `lib/ticktick-import.ts` 文件头第 2 条。这里把"失败"说出来并让用户
   * 重试，而不是把它显示成"成功"（一次半截导入看起来完成是本仓明令禁止的写法）。
   */
  const runConfirm = (): void => {
    if (host === null || preview === undefined || !preview.ok) return;
    setImportBusy(true);
    setImportResult(undefined);
    setError(undefined);
    void confirmTickTickImport(preview.plan, preview.report, host)
      .then((result) => {
        setImportResult(result);
        setPreview(undefined);
        setImportText('');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setImportBusy(false);
      });
  };

  return (
    <Screen
      title={t('mobile.export.title')}
      actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
    >
      <Text variant="row-meta" tone="subtle">
        {t('mobile.export.intro')}
      </Text>

      {error !== undefined ? (
        <Text variant="caption" tone="danger" selectable>
          {error}
        </Text>
      ) : null}

      <Card gap="loose">
        <Text variant="row-title">{t('web.export.json.label')}</Text>
        <Text variant="caption" tone="muted">
          {t('web.export.json.note')}
        </Text>
        <Button
          label={t('mobile.export.json.button')}
          icon="action.share"
          tone="primary"
          disabled={host === null || busy !== undefined}
          loading={busy === 'json'}
          onPress={() => {
            run('json');
          }}
        />
      </Card>

      <Card gap="loose">
        <Text variant="row-title">{t('web.export.markdown.label')}</Text>
        <Text variant="caption" tone="muted">
          {t('web.export.markdown.note')}
        </Text>
        <Button
          label={t('mobile.export.markdown.button')}
          icon="action.share"
          tone="primary"
          disabled={host === null || busy !== undefined}
          loading={busy === 'markdown'}
          onPress={() => {
            run('markdown');
          }}
        />
      </Card>

      {/* ── 从备份还原（批五，多端覆盖审计 P1-2）───────────────────────────
          🔴 它是**导出**的逆操作，不是"滴答导入"的另一半：认的是 heyta 自己
          导出的 JSON，而且**只进空库**。选择文件是主路径，JSON 粘贴只是按需展开的兜底。 */}
      <Card gap="loose">
        <Text variant="row-title">{t('mobile.restore.title')}</Text>
        <Text variant="caption" tone="muted">
          {t('mobile.restore.lead')}
        </Text>

        <Button
          label={t('mobile.restore.pickFile')}
          tone="primary"
          disabled={host === null || restoreBusy}
          onPress={pickBackupFile}
        />

        <Button
          label={t('mobile.restore.pasteLabel')}
          tone="ghost"
          icon={restorePasteOpen ? 'action.collapse' : 'action.expand'}
          expanded={restorePasteOpen}
          onPress={() => setRestorePasteOpen((open) => !open)}
        />

        {restorePasteOpen ? <>
        <TextField
          label={t('mobile.restore.pasteLabel')}
          value={restoreText}
          onChangeText={(next) => {
            setRestoreText(next);
            // 🔴 与滴答导入同一条纪律：文本一改，上一次的预检就**作废**。
            // 不让它作废，用户会对着**旧预览**按「确认还原」，
            // 而真正写下去的是那份旧文档。
            setRestorePreview(undefined);
            setRestoreError(undefined);
          }}
          hint={t('mobile.restore.pasteHint')}
          multiline
          lines={4}
        />

        <Button
          label={t('mobile.restore.preview')}
          tone="secondary"
          disabled={host === null || restoreBusy || restoreText.trim() === ''}
          onPress={() => {
            handleRestoreText(restoreText);
          }}
        />
        </> : null}

        {restoreError === undefined ? null : (
          <Text variant="caption" tone="danger" selectable>
            {t(restoreError.key, restoreError.vars)}
          </Text>
        )}

        {restorePreview === undefined ? null : (
          <Stack>
            <Text variant="caption" tone="muted">
              {t('mobile.restore.previewCounts', {
                ...restorePreviewVars(restorePreview),
              })}
            </Text>
            <Button
              label={t('mobile.restore.confirm')}
              tone="danger"
              disabled={host === null || restoreBusy}
              loading={restoreBusy}
              onPress={confirmRestore}
            />
          </Stack>
        )}

        {restoreResult === undefined ? null : (
          <Text variant="caption" tone="muted">
            {t('mobile.restore.done', {
              ops: restoreResult.importedOps,
              entities: restoreResult.entities,
            })}
          </Text>
        )}
      </Card>

      {/* ── 从滴答清单导入（方案 §5.5 第 7 项的移动端那一半）───────────────
          🔴 与上面那几张卡是**不同的承诺**：还原认的是 heyta 自己的 JSON，
          导入认的是**滴答清单的 CSV**。所以下面单独说"只认滴答清单"。 */}
      <Card gap="tight">
        <Button
          label={t('mobile.import.label')}
          accessibilityLabel={t('web.ticktick.title')}
          tone="ghost"
          icon={importOpen ? 'action.collapse' : 'action.expand'}
          expanded={importOpen}
          onPress={() => setImportOpen((open) => !open)}
        />
        {importOpen ? <>
        <Text variant="caption" tone="muted">
          {t('web.ticktick.intro')}
        </Text>
        {/* 诚实条款一：只认滴答清单（Todoist 的解析在本仓库不存在）。 */}
        <Text variant="caption" tone="muted">
          {t('web.ticktick.ticktickOnly')}
        </Text>

        <TextField
          label={t('mobile.import.pasteLabel')}
          value={importText}
          onChangeText={(next) => {
            setImportText(next);
            // 🔴 文本一改，上一次的预览就**作废**。
            // 不让它作废的话，用户会对着**旧预览**按确认 ——
            // 而真正写下去的是那份旧 plan（预览只是给人看的）。
            setPreview(undefined);
            setImportResult(undefined);
          }}
          placeholder={t('mobile.import.pastePlaceholder')}
          multiline
          lines={6}
        />
        {/* 诚实条款二：移动端是**粘贴**，不是选文件。 */}
        <Text variant="caption" tone="muted">
          {t('mobile.import.pasteNotFile')}
        </Text>

        <Button
          label={t('mobile.import.preview')}
          tone="primary"
          disabled={host === null || importBusy || importText.trim() === ''}
          loading={importBusy && preview === undefined && importResult === undefined}
          onPress={runPreview}
        />
        </> : null}

        {preview === undefined ? null : preview.ok ? (
          <Stack>
            <Text variant="row-meta" tone="muted">
              {t('web.ticktick.previewTitle')}
            </Text>
            <Text variant="caption" tone="muted">
              {preview.batch.entries.length === 0
                ? t('web.ticktick.previewNoop')
                : t('web.ticktick.previewCounts', {
                    projects: preview.batch.plan.projects.length,
                    tags: preview.batch.plan.tags.length,
                    tasks: preview.batch.plan.tasks.length,
                    ops: preview.batch.entries.length,
                  })}
            </Text>
            {/* 报告明细：告诉用户"文件里还有什么"，而不是只报"将新建几条"。
                子任务/重复/已完成这几类在滴答里有自己的形态，导入时会有取舍，
                不说清楚就会被读成"我的数据丢了一半"。 */}
            <Text variant="caption" tone="muted">
              {t('web.ticktick.previewRows', {
                rows: preview.report.dataRows,
                checklist: preview.report.checklistItems,
                recurring: preview.report.recurringTasks,
                completed: preview.report.completedTasks,
              })}
            </Text>
            <Button
              label={t('web.ticktick.confirm')}
              tone="primary"
              disabled={importBusy}
              loading={importBusy}
              onPress={runConfirm}
            />
          </Stack>
        ) : (
          <Text variant="caption" tone="danger">
            {t(
              preview.reason === 'no-header'
                ? 'web.ticktick.failure.noHeader'
                : 'web.ticktick.failure.noTasks',
            )}
          </Text>
        )}

        {importResult === undefined ? null : (
          <Text variant="caption" tone="muted">
            {importResult.opCount === 0
              ? t('web.ticktick.doneNoop')
              : t('web.ticktick.done', {
                  projects: importResult.added.projects,
                  tags: importResult.added.tags,
                  tasks: importResult.added.tasks,
                  ops: importResult.opCount,
                })}
          </Text>
        )}
      </Card>

      {counts === undefined ? null : (
        <Text variant="caption" tone="muted">
          {t('web.export.counts', {
            entities: counts.totalEntities,
            deleted: counts.totalDeleted,
            ops: counts.totalOps,
          })}
        </Text>
      )}

      {/* 说出平台差异：分享面板而不是"下载到某个目录"。 */}
      <Text variant="caption" tone="muted">
        {t('mobile.export.shareHint')}
      </Text>

      {/* 诚实条款，与 Web 端同一句词条：JSON 只支持导入到空库。 */}
      <Text variant="caption" tone="warning">
        {t('web.export.notRestorePoint')}
      </Text>

      {failed ? (
        <Text variant="caption" tone="danger">
          {t('web.export.failed')}
        </Text>
      ) : null}
      {shareFailed ? (
        <Text variant="caption" tone="danger">
          {t('mobile.export.shareFailed')}
        </Text>
      ) : null}
    </Screen>
  );
}
