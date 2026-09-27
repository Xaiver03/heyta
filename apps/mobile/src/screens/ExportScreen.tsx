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
 * 🔴 诚实条款不可省（见 Web 端 `ExportPanel`）：这一轮**不做导入**，
 * 所以必须明说这是导出、不能导回来 —— 否则用户会把它当成还原点，
 * 而一个导不回来的文件当还原点用等于没有备份。
 * 这里直接复用 Web 的同一条词条（`web.export.notRestorePoint`），
 * 两端不可能说出不一样的话。
 */

import React, { useEffect, useState } from 'react';
import { Share } from 'react-native';

import {
  buildTaskExportRows,
  exportDocumentFromHost,
  renderTasksMarkdown,
  serializeExportDocument,
  type AppHost,
  type ExportCounts,
  type ExportFormat,
} from '@heyta/app-host';
import { useI18n } from '@heyta/i18n';

import { openTaskHost } from '../db/open-host';
import { tasksMarkdownCopy } from '../lib/export-copy';
import { useTokens } from '../theme';
import { Button, Card, Screen, Text } from '../ui/kit';

export function ExportScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();

  const [host, setHost] = useState<AppHost | null>(null);
  const [busy, setBusy] = useState<ExportFormat | undefined>(undefined);
  const [counts, setCounts] = useState<ExportCounts | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

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
