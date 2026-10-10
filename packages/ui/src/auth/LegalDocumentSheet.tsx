/**
 * 认证流程里的法律文档阅读器
 * ============================
 *
 * 这只是跨端的阅读外壳，不持有法律正文。宿主从 `@heyta/legal` 取出与当前
 * 服务端匹配的文档后注入 `document`，因此官方托管与自托管不会误用同一份
 * 承诺。正文结构与落地页共享同一套 LegalDocument 形状，避免在客户端复制
 * 另一份条款。
 *
 * `Modal` 关闭时不会卸载认证表单；宿主只切换 `visible`，所以用户读完协议
 * 返回时邮箱、密码、确认密码和勾选状态都还在。视觉上只使用 surface + 轻阴影，
 * 不额外画边框，保持无边界的认证界面语言。
 */

import React, { useMemo } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { X } from 'lucide';

import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens, useHeytaUiTheme } from '../theme.js';

export type LegalDocumentLocale = 'zh-CN' | 'en';

export type LegalInlineText = string;

export type LegalDocumentBlock =
  | { readonly kind: 'p'; readonly text: LegalInlineText }
  | { readonly kind: 'ul'; readonly items: readonly LegalInlineText[] }
  | { readonly kind: 'ol'; readonly items: readonly LegalInlineText[] }
  | { readonly kind: 'callout'; readonly text: LegalInlineText }
  | { readonly kind: 'docRef'; readonly docId: string; readonly text: LegalInlineText }
  | {
      readonly kind: 'table';
      readonly head: readonly LegalInlineText[];
      readonly rows: readonly (readonly LegalInlineText[])[];
    };

export type LegalDocumentSection = {
  readonly id: string;
  readonly title: LegalInlineText;
  readonly blocks?: readonly LegalDocumentBlock[];
  readonly subsections?: readonly LegalDocumentSection[];
};

/** 与 `@heyta/legal` 的 LegalDocument 保持结构兼容，但不把法律包拖进共享 UI。 */
export interface LegalDocumentLike {
  readonly id: string;
  readonly version: string;
  readonly status: 'draft' | 'effective';
  readonly updatedDate: string;
  readonly effectiveDate?: string;
  readonly title: Readonly<Record<LegalDocumentLocale, string>>;
  readonly summary: Readonly<Record<LegalDocumentLocale, string>>;
  readonly sections: Readonly<Record<LegalDocumentLocale, readonly LegalDocumentSection[]>>;
}

export interface LegalDocumentSheetLabels {
  readonly close: string;
  /** 已由宿主按当前语言格式化好的版本与日期。 */
  readonly meta?: string;
  readonly status?: string;
}

export interface LegalDocumentSheetProps {
  readonly document: LegalDocumentLike;
  readonly locale: LegalDocumentLocale;
  readonly labels: LegalDocumentSheetLabels;
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onDocumentReference?: (documentId: string) => void;
  readonly testID?: string;
}

type InlinePiece = { readonly kind: 'text' | 'strong' | 'code'; readonly value: string };

function tokenizeInline(value: string): readonly InlinePiece[] {
  const pieces: InlinePiece[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) pieces.push({ kind: 'text', value: value.slice(cursor, match.index) });
    pieces.push(
      match[1] !== undefined
        ? { kind: 'strong', value: match[1] }
        : { kind: 'code', value: match[2] ?? '' },
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) pieces.push({ kind: 'text', value: value.slice(cursor) });
  return pieces;
}

function InlineText({ value, codeStyle, strongStyle }: {
  readonly value: string;
  readonly codeStyle: object;
  readonly strongStyle: object;
}): React.JSX.Element {
  return (
    <>
      {tokenizeInline(value).map((piece, index) => (
        <Text
          key={`${piece.kind}-${index}`}
          style={piece.kind === 'code' ? codeStyle : piece.kind === 'strong' ? strongStyle : undefined}
        >
          {piece.value}
        </Text>
      ))}
    </>
  );
}

export function LegalDocumentSheet({
  document,
  locale,
  labels,
  visible,
  onClose,
  onDocumentReference,
  testID = 'legal-document-sheet',
}: LegalDocumentSheetProps): React.JSX.Element {
  const theme = useHeytaUiTheme();
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const { width } = useWindowDimensions();
  // The native token is the only breakpoint we need here: below the modal's
  // readable width, tables become label/value records; on a desktop-sized
  // viewport they keep aligned columns. This keeps the semantic tree shared.
  const compact = width < tokens['layout.modal-max'];
  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: tokens['space.4'],
          backgroundColor: tokens['color.overlay'],
        },
        sheet: {
          width: '100%',
          maxWidth: tokens['layout.modal-max'],
          maxHeight: '88%',
          borderRadius: tokens['radius.xl'],
          backgroundColor: tokens['color.surface'],
          ...theme.native.shadow('shadow.md'),
        },
        header: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: tokens['space.3'],
          padding: tokens['space.5'],
          paddingBottom: tokens['space.3'],
        },
        headingBlock: { flex: 1, gap: tokens['space.1'] },
        title: { color: tokens['color.foreground'], flexShrink: 1 },
        close: {
          minWidth: tokens['touch-target.min'],
          minHeight: tokens['touch-target.min'],
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: tokens['radius.full'],
        },
        meta: { gap: tokens['space.1'], paddingBottom: tokens['space.4'] },
        metaText: { color: tokens['color.foreground-subtle'] },
        summary: {
          ...text['row-title'],
          color: tokens['color.foreground'],
          paddingBottom: tokens['space.4'],
        },
        body: {
          paddingHorizontal: tokens['space.5'],
          paddingTop: tokens['space.4'],
          paddingBottom: tokens['space.6'],
        },
        section: { gap: tokens['space.3'], paddingTop: tokens['space.6'] },
        sectionTitle: { color: tokens['color.foreground'] },
        subsection: { color: tokens['color.foreground'], paddingTop: tokens['space.2'] },
        paragraph: { ...text['row-title'], color: tokens['color.foreground'] },
        list: { gap: tokens['space.2'], paddingLeft: tokens['space.3'] },
        listItem: { flexDirection: 'row', gap: tokens['space.2'] },
        marker: { color: tokens['color.primary'] },
        callout: {
          paddingVertical: tokens['space.3'],
          paddingHorizontal: 0,
        },
        table: { gap: tokens['space.3'] },
        tableGrid: { gap: tokens['space.1'] },
        tableGridRow: { flexDirection: 'row', gap: tokens['space.3'] },
        tableGridHeader: { paddingBottom: tokens['space.1'] },
        tableGridCell: { flex: 1, color: tokens['color.foreground'] },
        tableGridLabel: { flex: 1, color: tokens['color.foreground-muted'] },
        tableRecord: {
          gap: tokens['space.3'],
          paddingVertical: tokens['space.2'],
        },
        tableField: { gap: tokens['space.1'] },
        tableLabel: { color: tokens['color.foreground-muted'] },
        code: {
          color: tokens['color.foreground'],
          backgroundColor: tokens['color.surface-sunken'],
        },
        strong: { fontWeight: text['section-title'].fontWeight },
        calloutText: { ...text['row-title'], color: tokens['color.foreground'] },
        link: { color: tokens['color.primary'] },
        pressed: { opacity: 0.72 },
      }),
    [text, theme, tokens],
  );

  const sections = document.sections[locale];

  const renderBlock = (block: LegalDocumentBlock, index: number): React.JSX.Element => {
    if (block.kind === 'p') {
      return (
        <Text key={`p-${index}`} style={styles.paragraph}>
          <InlineText value={block.text} codeStyle={styles.code} strongStyle={styles.strong} />
        </Text>
      );
    }
    if (block.kind === 'callout') {
      return (
        <View key={`callout-${index}`} style={styles.callout}>
          <Text style={styles.calloutText}>
            <InlineText value={block.text} codeStyle={styles.code} strongStyle={styles.strong} />
          </Text>
        </View>
      );
    }
    if (block.kind === 'ul' || block.kind === 'ol') {
      return (
        <View key={`${block.kind}-${index}`} style={styles.list}>
          {block.items.map((item, itemIndex) => (
            <View key={`${block.kind}-${index}-${itemIndex}`} style={styles.listItem}>
              <Text style={styles.marker}>{block.kind === 'ol' ? `${itemIndex + 1}.` : '•'}</Text>
              <Text style={[styles.paragraph, { flex: 1 }]}>
                <InlineText value={item} codeStyle={styles.code} strongStyle={styles.strong} />
              </Text>
            </View>
          ))}
        </View>
      );
    }
    if (block.kind === 'docRef') {
      const reference = (
        <Text style={[styles.paragraph, styles.link]}>
          <InlineText value={block.text} codeStyle={styles.code} strongStyle={styles.strong} />
        </Text>
      );
      return onDocumentReference === undefined ? (
        <View key={`ref-${index}`}>{reference}</View>
      ) : (
        <Pressable
          key={`ref-${index}`}
          accessibilityRole="link"
          onPress={() => onDocumentReference(block.docId)}
          style={({ pressed }) => (pressed ? styles.pressed : undefined)}
          testID={`${testID}-ref-${block.docId}`}
        >
          {reference}
        </Pressable>
      );
    }
    const useRecordLayout = compact || block.head.length >= 4;
    if (!useRecordLayout) {
      return (
        <View key={`table-${index}`} style={[styles.table, styles.tableGrid]}>
          <View style={[styles.tableGridRow, styles.tableGridHeader]}>
            {block.head.map((cell, cellIndex) => (
              <Text key={`head-${cellIndex}`} style={[text['caption'], styles.tableGridLabel]}>
                <InlineText value={cell} codeStyle={styles.code} strongStyle={styles.strong} />
              </Text>
            ))}
          </View>
          {block.rows.map((row, rowIndex) => (
            <View key={`row-${rowIndex}`} style={styles.tableGridRow}>
              {block.head.map((_, cellIndex) => (
                <Text key={`cell-${rowIndex}-${cellIndex}`} style={styles.tableGridCell}>
                  <InlineText
                    value={row[cellIndex] ?? ''}
                    codeStyle={styles.code}
                    strongStyle={styles.strong}
                  />
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    }
    return (
      <View key={`table-${index}`} style={styles.table}>
        {block.rows.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.tableRecord}>
            {row.map((cell, cellIndex) => (
              <View key={`cell-${rowIndex}-${cellIndex}`} style={styles.tableField}>
                <Text style={[text['caption'], styles.tableLabel]}>
                  <InlineText
                    value={block.head[cellIndex] ?? ''}
                    codeStyle={styles.code}
                    strongStyle={styles.strong}
                  />
                </Text>
                <Text style={styles.paragraph}>
                  <InlineText value={cell} codeStyle={styles.code} strongStyle={styles.strong} />
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  };

  const renderSection = (
    section: LegalDocumentSection,
    index: number,
    depth = 0,
  ): React.JSX.Element => {
    return (
      <View key={section.id} style={styles.section} nativeID={section.id}>
        <Text
          accessibilityRole="header"
          {...(Platform.OS === 'web' ? { 'aria-level': depth === 0 ? 2 : 3 } : {})}
          style={[
            depth === 0 ? text['section-title'] : text.headline,
            depth === 0 ? styles.sectionTitle : styles.subsection,
          ]}
        >
          {section.title}
        </Text>
        {section.blocks?.map(renderBlock)}
        {section.subsections?.map((child, childIndex) => renderSection(child, childIndex, depth + 1))}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === 'web' ? 'none' : 'fade'}
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop} testID={testID}>
        <View
          accessibilityRole="none"
          accessibilityLabel={document.title[locale]}
          style={styles.sheet}
        >
          <View style={styles.header}>
            <View style={styles.headingBlock}>
              <Text accessibilityRole="header" {...(Platform.OS === 'web' ? { 'aria-level': 1 } : {})} style={[text['screen-title'], styles.title]}>{document.title[locale]}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.close}
              onPress={onClose}
              style={({ pressed }) => [styles.close, pressed ? styles.pressed : undefined]}
              testID={`${testID}-close`}
            >
              <HeytaIcon
                data={X}
                size={tokens['icon.sm']}
                color={tokens['color.foreground-muted']}
              />
            </Pressable>
          </View>
          <ScrollView key={document.id} contentContainerStyle={styles.body}>
            <View style={styles.meta}>
              {labels.status !== undefined ? (
                <Text style={[text['caption'], styles.metaText]}>
                  <InlineText
                    value={labels.status}
                    codeStyle={styles.code}
                    strongStyle={styles.strong}
                  />
                </Text>
              ) : null}
              {labels.meta !== undefined ? (
                <Text style={[text['caption'], styles.metaText]}>{labels.meta}</Text>
              ) : null}
            </View>
            <Text style={styles.summary}>
              <InlineText
                value={document.summary[locale]}
                codeStyle={styles.code}
                strongStyle={styles.strong}
              />
            </Text>
            {sections.map((section, index) => renderSection(section, index, 0))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
