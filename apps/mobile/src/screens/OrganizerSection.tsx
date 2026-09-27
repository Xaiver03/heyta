/**
 * 通用「组织器」段落（清单 / 标签共用）
 * ======================================
 *
 * 🔴 **为什么抽出来，而不是各写一份。**
 *
 * 「清单」和「标签」在**数据模型**上毫无关系（两个实体、两张表、两条动作集），
 * 但在**界面**上是同一件事：一个名字列表 + 一个删除按钮 + 一个"新建"输入框。
 * 先写完 `ListsSection` 再照抄一份 `TagsSection`，会得到两份**结构完全一样**
 * 的 JSX —— 而本仓库已经吃过这个亏：同一段逻辑写两遍，改一处忘一处，
 * 最后两端行为不一致而没人发现（AGENTS.md §3.5 那三次漂移）。
 *
 * 所以这里只抽**结构**，不抽**语义**：
 *   - 抽走的：卡片、空态、行、删除按钮、输入框、按钮、触控目标下限。
 *   - 留在调用方的：叫什么名字、空态说什么、删除提示说什么、
 *     `onAdd` / `onRemove` 到底调哪个动作。
 *
 * ⚠️ 文案全部由调用方传入，**不在这里按 type 拼**。写成
 * `type==='tag' ? t('...tags...') : t('...lists...')` 会把两套产品语义
 * 塞进一个组件，将来给标签加一条专属提示时又得在这里开分支。
 *
 * 🔴 本文件里**没有一行业务逻辑**：能不能建（空名字由 app-host 抛错）、
 * 删了任务去哪、写什么 op，全部由 `@heyta/app-host` 决定。
 * 这里连 `ProjectActions` / `TaskActions` 都不 import —— 它只认识
 * 「一组 {id, name}」和两个回调。
 */

import React, { useCallback, useState } from 'react';
import { View } from 'react-native';

import { useTokens } from '../theme';
import type { IconName } from '../ui/icons';
import { Button, Card, Divider, IconButton, SectionHeader, Text, TextField } from '../ui/kit';

/** 这一段只需要这两样东西 —— 清单和标签都满足。 */
export interface OrganizerItem {
  id: string;
  name: string;
}

export interface OrganizerSectionProps {
  /** 段落图标（语义名，见 `ui/icons.tsx`）。 */
  icon: IconName;
  /** 段落标题。 */
  title: string;

  items: OrganizerItem[];

  emptyText: string;
  emptyHint: string;
  /**
   * 删除按钮的无障碍名，**必须带上具体是哪一条**。
   * 读屏用户听到一串「删除清单」而无从分辨要删哪个。
   */
  removeLabel: (name: string) => string;
  /**
   * 删除按钮旁边那句说明。
   *
   * 🔴 它是**产品必需**而非装饰：不写清楚，用户会以为删清单 = 删任务，
   * 于是**不敢删** —— 一个不敢用的功能等于没有。
   */
  removeHint: string;

  /**
   * 输入框的名字。
   *
   * 🔴 **必须与按钮不同名。** 同名的话无障碍树里会同时存在三个同名节点
   * （段落标题、输入框、按钮），按标签取节点只能靠 role/field 去猜，
   * 而猜错的代价是**静默设错元素**（本仓库已因此吃过两次亏）。
   */
  nameLabel: string;
  placeholder: string;
  addLabel: string;

  busy: boolean;
  /** 名字已经 trim 过；空名字由调用方**在调用前**判断（那是交互决策）。 */
  onAdd: (name: string) => void;
  onRemove: (item: OrganizerItem) => void;
}

export function OrganizerSection({
  icon,
  title,
  items,
  emptyText,
  emptyHint,
  removeLabel,
  removeHint,
  nameLabel,
  placeholder,
  addLabel,
  busy,
  onAdd,
  onRemove,
}: OrganizerSectionProps): React.JSX.Element {
  const tokens = useTokens();
  const [name, setName] = useState('');

  const submit = useCallback((): void => {
    const trimmed = name.trim();
    // 「按了空回车什么都不做」是**交互**决定，由界面自己判断 ——
    // 业务层对空名字是抛错的，不能让它抛到这里。
    if (trimmed === '') return;
    onAdd(trimmed);
    setName('');
  }, [name, onAdd]);

  return (
    <>
      <SectionHeader icon={icon} title={title} />
      <Card>
        {items.length === 0 ? (
          <View style={{ gap: tokens['space.1'] }}>
            <Text variant="row-title" tone="muted">
              {emptyText}
            </Text>
            <Text variant="caption" tone="subtle">
              {emptyHint}
            </Text>
          </View>
        ) : (
          items.map((item, index) => (
            <React.Fragment key={item.id}>
              {index > 0 ? <Divider /> : null}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  // 触控目标下限：删除按钮是这一段里唯一的可点元素。
                  minHeight: tokens['touch-target.min'],
                  gap: tokens['space.2'],
                }}
              >
                <Text variant="row-title" numberOfLines={1} style={{ flex: 1 }}>
                  {item.name}
                </Text>
                {/* 用 kit 的 `IconButton`（可点 + 自带无障碍名），**不要**裸 `Icon`
                    —— 裸图标只是个装饰，点它不会发生任何事，但看起来完全一样。 */}
                <IconButton
                  icon="task.delete"
                  label={removeLabel(item.name)}
                  color={tokens['color.danger']}
                  onPress={() => {
                    onRemove(item);
                  }}
                />
              </View>
            </React.Fragment>
          ))
        )}
      </Card>
      <Text variant="caption" tone="subtle">
        {removeHint}
      </Text>

      <TextField
        label={nameLabel}
        value={name}
        onChangeText={setName}
        placeholder={placeholder}
        autoCapitalize="sentences"
      />
      <Button
        label={addLabel}
        tone="secondary"
        icon="task.add"
        loading={busy}
        // 空名字时**禁用**而不是点了没反应：禁用态本身就是"还差什么"的提示，
        // 而"点了没反应"只会让人怀疑按钮坏了。
        disabled={name.trim() === ''}
        onPress={submit}
      />
    </>
  );
}