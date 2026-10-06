/**
 * 便签编辑屏（移动壳）—— 共享 `NoteEditor` 的**第二个宿主**
 * =========================================================
 *
 * 🔴 它补的是审计里那条「便签编辑：零件都在、没人接线」：
 * `NotesBoard` 早就有 `onEdit`（`packages/ui/src/notes/NotesBoard.tsx:110`），
 * 动作层早就有 `updateNoteContent`（`packages/app-host/src/note-actions.ts`），
 * 缺的只是移动端**没有任何界面能把正文改一遍** —— 用户写错一个字，
 * 只能删掉重建一条（而重建会丢掉钉选状态与创建时间）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件里**没有一行业务逻辑**（AGENTS §3.5）
 *
 * 编辑器长什么样、什么算空草稿，在 `@heyta/ui`；正文怎么落 op、
 * "没改动就不要写 op"那条闸门，在 `@heyta/app-host`。
 * 这里只做移动端的三件事：**把它放进一个全屏模态**、**取这一条便签的当前正文**、
 * **把失败原因原样显示**。
 *
 * ⚠️ 本文件里出现 **`entityType` 字面量**就是外壳自己在拼 op，会被
 * `check:layering` 判红（连它的判据一起写进注释，会让那条负向断言恒假 ——
 * 所以这里刻意不抄那个字面量的原形）。这一层的调用点全部经 `NoteActions`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么是**全屏 Modal** 而不是 `ProfileScreen` 的提前 return 二级页
 *
 * `ProfileScreen.tsx:169` 那一族 `useState` + 提前 return 的形状，前提是"这一屏
 * 只有「我的」页能进去"。便签编辑有两个入口（「我的 → 便签」的摘要、搜索结果里的
 * 便签行），而搜索浮层自己就是一个 `Modal`（`SearchScreen`）。用 Modal 的话
 * 两个宿主各自挂一份、各自的宿主页都不用改结构；用提前 return 的话，
 * 搜索结果要点一下就**先关掉浮层再切走 tab**，那是"我搜到了一条便签，
 * 点它却把我扔回任务页"。RN 的 `Modal` 在自己的原生层里渲染，
 * 挂在树的哪一层都不影响它盖住谁（同 `App.tsx` 里隐私面板那条理由）。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from 'react-native';

import type { Note } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { createNoteActions, type AppHost, type NoteActions } from '@heyta/app-host';
import { NoteEditor, type NoteEditorLabels } from '@heyta/ui';

import { openTaskHost } from '../db/open-host';
import { useMobileSync } from '../sync/store';
import { useTheme } from '../theme';
import { Screen, Text } from '../ui/kit';

export interface NoteEditScreenProps {
  /** 要编辑的那条便签 id。宿主只在"打开编辑"时才挂载本屏。 */
  readonly noteId: string;
  readonly onBack: () => void;
}

export function NoteEditScreen({
  noteId,
  onBack,
}: NoteEditScreenProps): React.JSX.Element {
  const { t } = useI18n();
  const { reducedMotion } = useTheme();
  /**
   * 🔴 必须订阅 `dataRevision`：`listNotes()` 读的是**已物化的内存状态**，
   * 后台同步改了它不会触发重渲染。少了这一条，"另一台设备刚把这条便签删了"
   * 在本屏上永远看不见，用户会对着一个已经不存在的 id 点保存。
   */
  const { dataRevision } = useMobileSync();

  const [host, setHost] = useState<AppHost | null>(null);
  /**
   * `null` = **还没读到**（宿主还在开），空数组 / 读到了但没找到 = 这条便签不在了。
   * 两个状态必须分开：合成一个的话，首帧会闪一句"这条便签已经不在了"，
   * 而它其实只是还没读完。
   */
  const [notes, setNotes] = useState<Note[] | null>(null);
  /** 与 `NotesSection` 决定 3 同一条分工：失败原因是**数据**，不翻译。 */
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void openTaskHost()
      .then((opened) => {
        if (alive) setHost(opened);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  // 与 `NotesSection` 同一条规则：动作集从宿主派生，不在界面里新造。
  const actions = useMemo<NoteActions | null>(() => (host ? createNoteActions(host) : null), [host]);

  const read = useCallback((): void => {
    if (actions === null) return;
    // ⚠️ `listNotes()` 是**同步**的（读已物化状态），不是 Promise。
    setNotes(actions.listNotes());
  }, [actions]);

  useEffect(read, [read, dataRevision]);

  const labels = useMemo<NoteEditorLabels>(
    () => ({
      placeholder: t('notes.composer.placeholder'),
      save: t('notes.save'),
      cancel: t('notes.cancel'),
    }),
    [t],
  );

  const note = notes === null ? undefined : notes.find((item) => item.id === noteId);

  return (
    <Modal
      visible
      animationType={reducedMotion ? 'none' : 'slide'}
      onRequestClose={onBack}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <Screen
        title={t('notes.edit.title')}
        actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
      >
        {/*
          `key={noteId}`：宿主复用同一个屏切编辑对象时（现在不会，将来搜索里
          连点两条会）草稿必须重置，否则上一台的正文会留在下一台的输入框里。
        */}
        {note === undefined ? (
          <Text variant="caption" tone="muted">
            {notes === null ? '' : t('notes.edit.notFound')}
          </Text>
        ) : (
          <NoteEditor
            key={noteId}
            initialContent={note.content}
            labels={labels}
            busy={busy}
            error={error}
            onSave={(content) => {
              if (actions === null) return;
              setBusy(true);
              setError(null);
              void actions
                .updateNoteContent(noteId, content)
                // 写完就退出这一屏：编辑的目的地是"改好了"，不是"留在这里"。
                // ⚠️ 顺序要紧 —— 先 `onBack` 再重读，`NotesSection` 那边订阅的是
                //    `dataRevision`，回到列表自然会重读。
                .then(onBack)
                .catch((e: unknown) => {
                  setError(e instanceof Error ? e.message : String(e));
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
            onCancel={onBack}
            testID="mobile-note-editor"
          />
        )}
      </Screen>
    </Modal>
  );
}
