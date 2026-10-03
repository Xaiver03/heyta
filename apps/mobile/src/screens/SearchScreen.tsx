/**
 * 全局搜索（移动壳）—— 共享 `SearchPanel` 的**第二个宿主**
 * =========================================================
 *
 * 🔴 它补的是主战场上一个**从来没被回答过**的问题：
 * "我记得写过一条便签，里面有某个词"。共享面板 2026-09-29 就存在，
 * 但 `apps/mobile` 里**零消费点** —— 底部 5 个 tab 没有搜索，
 * 任务页那个输入框只是**当前列表的筛选**（`searchTasks(scoped, query)`，
 * 范围已经被今天/清单/标签切过一刀，而且完全不碰便签）。
 * 于是"四端同一份"这句话在移动端只是一句注释。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三个刻意的"不给"
 *
 * 1. **不给 `quick`（快速跳转）。** 那一组在 web 是"跳到某个清单/标签"，
 *    而手机上的清单与标签在「我的」页的两段里，不是一个可以从搜索结果
 *    一步到达的目的地。给不出目的地就不给这一组 ——
 *    文案那边同步换掉（见 `lib/search-display.ts`）。
 * 2. ~~**不给 `onOpenNote`。**~~ **（2026-10-03 多端第二批已补上，留原文是为了
 *    让后来者认出这个形状）** 编辑屏 {@link NoteEditScreen} 已经存在，本屏现在
 *    传它：点搜索结果里的便签 = 关掉浮层 + 打开那条便签的编辑屏。
 *    当时那句理由（"点它去做一件不存在的事比点不动更糟"）仍然成立，变的是屏有了。
 *    ⚠️ 顺序是**先关浮层再开编辑屏** —— 两个 `Modal` 同时在场在 Android 上
 *    没有实测过，而"关掉搜索再看便签"本来就是用户想要的次序。
 * 3. **不给 `activeEntry` / `keyHints`。** 触屏没有键盘光标，也没有
 *    ↑↓ / ↵ / esc。共享面板对没传的形态**不渲染**那排芯片。
 *
 * ⚠️ 数据源只有一份：任务由宿主把它**已经在列表里的那批**递进来，
 * 本文件不另开一次 `listTasks()`。两批任务在两次读取之间会漂移，
 * 症状是"搜到的和列表里不是同一批"。便签则必须自己读 ——
 * 任务页此前从不碰 NOTE 这个实体。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 已知边界（2026-10-01 截图时看到，**本轮没动**）：
 * 任务页那个内联输入框写着「搜索任务」，它其实**不是搜索**而是当前列表的筛选
 * （范围已被今天/清单/标签切过一刀，且不碰便签）。这个浮层一进来，
 * 同屏就有了两个都能打字、名字里都带"搜索"的东西 —— 正是产品负责人
 * 2026-10-01 推翻 web 顶栏输入框时给的那条理由（"用户必须先回答我该在哪个里打字"）。
 * 该改的是那句文案（`web.shell.search.*`，中英各三条），但它的**实际值**
 * 被 `scripts/verify-mobile-tags.sh` 当断言用着，改法要连着那条一起想；
 * 而且它属于"列表页"这一面，不属于本文件。登记，不夹带。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Note, Task } from '@heyta/domain';
import { searchNotes, searchTasks } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { createNoteActions, type AppHost, type NoteActions } from '@heyta/app-host';
import { SearchPanel, type SearchPanelLabels } from '@heyta/ui';

import { openTaskHost } from '../db/open-host';
import { searchPanelLabels } from '../lib/search-display';
import { pruneSelectionAgainst } from '../lib/selection';
import { useMobileSync } from '../sync/store';
import { useTheme, useTokens } from '../theme';
import { Button, Text } from '../ui/kit';

export interface SearchScreenProps {
  visible: boolean;
  onDismiss: () => void;
  /** 宿主列表里的那批任务（**未过滤**；匹配判据在 `@heyta/domain`）。 */
  tasks: readonly Task[];
  /** 与列表页同一份行级无障碍文案 —— 搜索结果里的任务行不该说另一套话。 */
  taskRowLabels: SearchPanelLabels['taskRow'];
  /** 正在等写入回执的那条（勾选完成时置灰用）。 */
  busyTaskId?: string | null;
  onToggleTask: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  /** 点搜索结果里的便签。宿主用来打开编辑屏（见文件头决定 2）。 */
  onOpenNote: (noteId: string) => void;
}

export function SearchScreen({
  visible,
  onDismiss,
  tasks,
  taskRowLabels,
  busyTaskId = null,
  onToggleTask,
  onOpenTask,
  onOpenNote,
}: SearchScreenProps): React.JSX.Element {
  const t = useI18n().t;
  const tokens = useTokens();
  const { reducedMotion } = useTheme();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteActions, setNoteActions] = useState<NoteActions | null>(null);
  /** 见 `NotesSection` 决定 3：失败原因原样显示，不静默吞。 */
  const [error, setError] = useState<string | null>(null);

  // ⚠️ 订阅 `dataRevision`：便签读的是**已物化的内存状态**，后台同步改了它
  //    不会触发重渲染。不订阅的话，另一台设备建的便签在这台设备上
  //    "同步完了也搜不到"，而且没有任何报错。
  const { dataRevision } = useMobileSync();

  useEffect(() => {
    let alive = true;
    void openTaskHost()
      .then((opened: AppHost) => {
        if (alive) setNoteActions(createNoteActions(opened));
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (noteActions === null) return;
    // ⚠️ `listNotes()` 是同步的（读已物化状态），不是 Promise。
    const listed = noteActions.listNotes();
    setNotes(listed);
    // 🔴 回落喂**全集**而不是筛完的 `results.notes`：后者会让"改一下搜索词"
    // 把正在编辑的那条判定成不存在、编辑屏自己关掉。
    pruneSelectionAgainst({ note: listed.map((note) => note.id) });
  }, [noteActions, dataRevision]);

  /**
   * 匹配判据**一个都不在这里重写**：任务走 `searchTasks`、便签走 `searchNotes`，
   * 与 web 的浮层是同两个领域函数。
   *
   * ⚠️ 空查询不查：`searchTasks` 对空串返回"全部"，那会让浮层一打开
   *    就把整个库列出来。共享面板据此显示 `prompt`。
   */
  const results = useMemo(() => {
    const q = query.trim();
    if (q === '') return { tasks: [] as Task[], notes: [] as Note[] };
    return { tasks: searchTasks(tasks, q), notes: searchNotes(notes, q) };
  }, [query, tasks, notes]);

  const labels = useMemo(() => searchPanelLabels(t, taskRowLabels), [t, taskRowLabels]);

  const close = useCallback(() => {
    // 关掉就把词清掉：下次打开应当是"一次新的搜索"，而不是上一次的残局。
    // （web 那边不用做这件事，因为它的浮层每次都是重新挂载的。）
    setQuery('');
    onDismiss();
  }, [onDismiss]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={close}
      statusBarTranslucent
    >
      {/**
       * 遮罩。**刻意不进无障碍树** —— 与 `TaskDetailSheet` 同一条理由：
       * 它只做"点空白处关掉"，而读屏用户已经有卡片下面那个**有名字的**出口；
       * 两个控件共用一个可访问名，念两遍，做的却是同一件事。
       */}
      <Pressable
        style={{ flex: 1, backgroundColor: tokens['material.scrim'] }}
        onPress={close}
        accessible={false}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          paddingTop: insets.top + tokens['space.3'],
          paddingBottom: insets.bottom + tokens['space.3'],
          paddingHorizontal: tokens['screen.gutter'],
        }}
        pointerEvents="box-none"
      >
        {error !== null ? (
          <Text variant="row-meta" tone="danger" selectable style={{ paddingBottom: tokens['space.2'] }}>
            {error}
          </Text>
        ) : null}
        <SearchPanel
          query={query}
          onQueryChange={setQuery}
          tasks={results.tasks}
          notes={results.notes}
          busyTaskId={busyTaskId}
          onToggleTask={onToggleTask}
          onOpenTask={onOpenTask}
          onOpenNote={onOpenNote}
          labels={labels}
          testID="mobile-search-panel"
        />
        {/**
         * 出口放在卡片**下方**，不是右上角。
         *
         * 🔴 第一版把它做成右上角的 ✕，实测截图（`android-search-2-fixed-empty.png`）
         * 里它与顶栏那个同步图标**落在同一格**（两者都是 `x∈[923,1038]`）——
         * 卡片改成不透明之后遮罩底下仍有那半圈灰色图标透出来，
         * 看上去是"同步被禁用了"。顶栏右半边**已经被占了**，
         * 所以任何"浮层右上角的图标"都会跟它撞；换成文字出口、挪到卡片下面才不撞。
         *
         * ⚠️ 无障碍名仍是「关闭搜索」而不是「取消」：读屏里"取消"不说明取消了什么，
         * 而这一层唯一可取消的事就是这次搜索。
         */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            paddingTop: tokens['space.2'],
          }}
        >
          <Button
            tone="ghost"
            label={t('mobile.common.cancel')}
            accessibilityLabel={t('mobile.search.close')}
            onPress={close}
          />
        </View>
      </View>
    </Modal>
  );
}
