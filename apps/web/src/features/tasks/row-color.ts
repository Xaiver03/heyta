/**
 * 三态 → 一枚**颜色 token**（**只有清单图标着色**，产品拍板 2026-11-08）
 * ==========================================================
 *
 * 这一层是**宿主的界面绑定**，不是业务判断：业务字段（`Task.projectId` /
 * `Project.color` / `Tag.color`）与"哪些标签有效"的判据都在别处，
 * 这里只回答"这一行该给共享层什么颜色 token"。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 🔴 `Project.color` 存的是**色槽位号**，不是颜色值
 * ─────────────────────────────────────────────────────────────────────
 *
 * 这一格本来是"待确认"的（`Project.color` 是 `string`，全仓零读点）。查完不用问了：
 * `apps/web/src/features/projects/store.ts:62` 的
 * `setProjectColor(id, slot?: CategorySlot)` —— **写入方给的就是槽位号**。
 * 而 `packages/domain/src/activity-categories.ts:38` 那条注释把纪律写死了：
 *
 * > 数据里存的是这个数字，不是颜色。存的必须是不变量（"第 3 号槽位"），
 * > 而不是"长什么样"（`#dc2626`）—— 后者跟不了暗色主题、过不了对比度保证。
 *
 * ⇒ 所以这里**不猜**：`parseCategorySlot` 认得出的才映射到
 * `CATEGORY_SLOT_TOKEN_BY_SLOT`（设计系统里唯一一份），认不出的一律回落
 * （"没有颜色"），绝不把错色画上去。这也是 `parseCategorySlot` 自己的语义。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 🔴 按标签那一档必须经 `resolveTagIds`
 * ─────────────────────────────────────────────────────────────────────
 *
 * 合并过的标签（`A → B`）在 `task.tagIds` 里仍然留着 `A`，而 `A` 已不存活。
 * 直接 `includes` 会让"合并之后我的标签色没了"—— 而它**不报错**。
 * 同一族盲区这一轮已在三个读点上踩过，`scripts/check-tag-resolution.mjs` 就是为它补的门禁。
 */

import { parseCategorySlot, resolveTagIds, type Project, type Tag } from '@heyta/domain';
import { CATEGORY_SLOT_TOKEN_BY_SLOT, UNSET_CATEGORY_TOKEN } from '@heyta/design-system';
import type { TaskRow } from '@heyta/ui';
import type { CategoryColorToken } from '@heyta/ui';

import type { RowColorMode } from './row-color-pref.js';

/**
 * 实体里的 `color` 字符串 → 颜色 token。
 *
 * 认不出（不是 1–8 的槽位号 / 空串 / 未来别的写入方写了别的东西）⇒ `undefined`，
 * 调用方据此**不渲染**那枚图标。**不回落成某个槽位色** —— 那会让"没设过色"
 * 看起来像用户选过的某个颜色（`UNSET_CATEGORY_TOKEN` 的注释里写了同一条理由）。
 */
export function toIconColorToken(raw: string | undefined): CategoryColorToken | undefined {
  const slot = parseCategorySlot(raw);
  return slot === undefined ? undefined : CATEGORY_SLOT_TOKEN_BY_SLOT[slot];
}

/** 没设过色时给什么 —— 与分类报告同一枚中性 token（**不是**某个槽位色）。 */
export const UNSET_ROW_ICON_TOKEN: CategoryColorToken = UNSET_CATEGORY_TOKEN;

export interface RowColorSources {
  readonly projects: Readonly<Record<string, Project>>;
  /** **含墓碑**的全量标签表（解析别名要它，见 `packages/domain/src/tags.ts` 文件头）。 */
  readonly tags: Readonly<Record<string, Tag>>;
}

/**
 * 算这一行该着的色。
 *
 * - `off` ⇒ 恒 `undefined`（共享层据此**不渲染**那枚节点；这是"关"的实现与判据）；
 * - `project` ⇒ 该任务所属清单的色；未归属（收集箱）⇒ `undefined`；
 * - `tag` ⇒ 第一个**有效**标签的色（经 `resolveTagIds`）。
 */
export function rowIconColorToken(
  row: TaskRow,
  mode: RowColorMode,
  sources: RowColorSources,
): CategoryColorToken | undefined {
  if (mode === 'off') return undefined;
  const task = row.source;

  if (mode === 'project') {
    // 未归属（收集箱）= `projectId` **字段不存在**，不是 `null`（见 entities.ts 的 🔴 说明）。
    const projectId = task.projectId;
    if (projectId === undefined || projectId === '') return undefined;
    return toIconColorToken(sources.projects[projectId]?.color);
  }

  // mode === 'tag'：第一个**有效**标签的色。
  for (const id of resolveTagIds(task.tagIds, sources.tags)) {
    const token = toIconColorToken(sources.tags[id]?.color);
    if (token !== undefined) return token;
  }
  return undefined;
}
