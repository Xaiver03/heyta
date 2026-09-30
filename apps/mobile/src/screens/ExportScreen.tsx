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
 *   3. 用词条表说清楚「这是导出、还不能导回来」。
 *
 * 🔴 **移动端没有 `<a download>`，也没有内建文件系统。**
 * 不引新第三方依赖的前提下，平台上真实可用的方式只有 RN 核心的
 * `Share.share()`：把**导出文本**交给系统分享面板，由用户选择存到「文件」、
 * 发给自己、或者交给别的 App。代价要说清楚 —— 分享出去的是一个文本片段，
 * 文件名/扩展名由接收方决定，不是一次"另存为 heyta-export-….json"。
 * 界面上的 `mobile.export.shareHint` 就是这句实话。
 *
 * 🔴 诚实条款不可省（见 Web 端 `ExportPanel`）：**这个导出文件导不回来**，
 * 所以必须明说它不是还原点 —— 否则用户会把它当备份用，
 * 而一个导不回来的文件当还原点用等于没有备份。
 * 这里直接复用 Web 的同一条词条（`web.export.notRestorePoint`），
 * 两端不可能说出不一样的话。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 与"导入"的关系（2026-09-29 补）
 *
 * 同一屏里现在还有**从滴答清单导入**。两者是**两个不同的承诺**，界面上分开说：
 *   · **导出**：heyta → 一个文件；**导不回来**（还没有"从 heyta 导出还原"这条路）。
 *   · **导入**：**滴答清单的 CSV** → heyta；不是还原点，也不覆盖既有数据。
 *
 * 🔴 **移动端的输入方式是"粘贴"，不是"选文件"** —— 见 `lib/ticktick-import.ts`
 * 的文件头（要选文件就得引一个原生依赖，需过两道门；而手机上 CSV 常常就在
 * 聊天/邮件里，长按复制再粘进来是更短的一条路）。这个差别写在界面上，不假装等价。
 */

import React, { useEffect, useState } from 'react';
import { Share, View } from 'react-native';

import {
  buildTaskExportRows,
  exportDocumentFromHost,
  renderTasksMarkdown,
  serializeExportDocument,
  type AppHost,
  type ExportCounts,
  type ExportFormat,
  type TickTickImportResult,
} from '@heyta/app-host';
import { useI18n } from '@heyta/i18n';

import { openTaskHost } from '../db/open-host';
import { tasksMarkdownCopy } from '../lib/export-copy';
import {
  confirmTickTickImport,
  previewTickTickImport,
  type TickTickPreview,
} from '../lib/ticktick-import';
import { useTokens } from '../theme';
import { Button, Card, Screen, Text, TextField } from '../ui/kit';

export function ExportScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();

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
      title={t('web.export.title')}
      actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
    >
      <Text variant="row-meta" tone="subtle">
        {t('web.export.intro')}
      </Text>

      {error !== undefined ? (
        <Text variant="caption" tone="danger" selectable>
          {error}
        </Text>
      ) : null}

      <Card style={{ gap: tokens['space.3'] }}>
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

      <Card style={{ gap: tokens['space.3'] }}>
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

      {/* ── 从滴答清单导入（方案 §5.5 第 7 项的移动端那一半）───────────────
          🔴 与上面那两张卡是**两个不同的承诺**：导出是 heyta → 文件（导不回来），
          导入是**滴答清单的 CSV** → heyta。所以下面单独说"只认滴答清单"。 */}
      <Card style={{ gap: tokens['space.3'] }}>
        <Text variant="row-title">{t('web.ticktick.title')}</Text>
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

        {preview === undefined ? null : preview.ok ? (
          <View style={{ gap: tokens['space.2'] }}>
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
          </View>
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

      {/* 🔴 诚实条款，与 Web 端同一句词条：这是导出，还不能导回来。 */}
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
