/**
 * 移动端：任务结构化子项（checklist）编辑区
 * ========================================
 * 逐条勾选 + n/m + 增删。用现有 UI kit（Text / Checkbox / TextField / Button / Stack / HStack），
 * 不写内联样式对象，避免 mobile screens 的 l4 内联样式棘轮增长。
 * 老数据只有备注 `- [ ]` 时只读展示 + 一键"转可勾选"（懒升级）。
 */
import { useState } from 'react';
import type { TaskActions } from '@heyta/app-host';
import { readChecklist, type Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';

import { Button, Checkbox, HStack, Stack, Text, TextField } from './kit';

export interface ChecklistSectionProps {
  task: Task;
  actions: TaskActions;
}

export function ChecklistSection({ task, actions }: ChecklistSectionProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');

  if (task.checklist === undefined) {
    const legacy = readChecklist(task);
    if (legacy.length === 0) return null;
    const doneCount = legacy.filter((x) => x.done).length;
    return (
      <Stack gap="tight">
        <Text variant="caption" tone="subtle">
          {`${t('web.tasks.checklist.title')} · ${doneCount}/${legacy.length}`}
        </Text>
        {legacy.map((it, i) => (
          <Text key={`legacy-${String(i)}`} variant="row-title" tone={it.done ? 'subtle' : 'default'}>
            {it.text}
          </Text>
        ))}
        <Button
          label={t('web.tasks.checklist.convertLegacy')}
          tone="secondary"
          onPress={() => {
            void actions.setChecklist(
              task.id,
              legacy.map((x) => ({ text: x.text, done: x.done })),
            );
          }}
        />
      </Stack>
    );
  }

  const items = task.checklist;
  const doneCount = items.filter((x) => x.done).length;
  const submit = (): void => {
    const v = draft.trim();
    if (v === '') return;
    void actions.addChecklistItem(task.id, v);
    setDraft('');
  };

  return (
    <Stack gap="tight">
      <Text variant="caption" tone="subtle">
        {items.length > 0
          ? `${t('web.tasks.checklist.title')} · ${doneCount}/${items.length}`
          : t('web.tasks.checklist.title')}
      </Text>
      {items.map((it) => (
        <HStack key={it.id} gap="tight" align="center">
          <Checkbox
            checked={it.done}
            onToggle={() => {
              void actions.toggleChecklistItem(task.id, it.id, !it.done);
            }}
            label={it.text}
          />
          <Text variant="row-title" tone={it.done ? 'subtle' : 'default'} grow>
            {it.text}
          </Text>
          <Button
            label={t('web.tasks.checklist.remove')}
            tone="secondary"
            onPress={() => {
              void actions.removeChecklistItem(task.id, it.id);
            }}
          />
        </HStack>
      ))}
      <HStack gap="tight" align="center">
        <TextField
          label={t('web.tasks.checklist.title')}
          value={draft}
          onChangeText={setDraft}
          placeholder={t('web.tasks.checklist.addPlaceholder')}
          onSubmitEditing={submit}
        />
        <Button label={t('web.tasks.checklist.add')} tone="secondary" onPress={submit} />
      </HStack>
    </Stack>
  );
}
