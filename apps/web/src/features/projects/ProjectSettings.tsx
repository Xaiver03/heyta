import { ICON_SIZE } from '@heyta/design-system';
/**
 * 清单设置（图标 / 视图 / 类型 / 智能清单开关）
 * ================================================
 *
 * 逐行挂在清单行的 `renderItemExtra` 插槽里（与 `ColorSlotPicker` / `FolderPicker`
 * 同一个位置）。做成**展开式**而不是浮层，理由与 `ColorSlotPicker` 逐字相同：
 * 浮层要处理定位、层级、点外部关闭、焦点陷阱，而它出现在侧栏的每一行上。
 *
 * 🔴 四件事都是**清单级设置**，不是"清单里的任务"：
 *   · 图标 —— 闭集 key（`@heyta/domain#PROJECT_ICONS`），存 key 不存字形；
 *   · 视图 —— list / board / calendar / timeline，只改展示排布，不动数据；
 *   · 类型 —— tasks / notes，只表达"打开先看到什么"，不合并便签实体；
 *   · 智能清单开关 —— 是否在汇总里出现，缺省 true。
 *
 * 所有写入都**薄转发到动作层**（`@heyta/app-host` 的 `ProjectActions`），
 * 这里不拼 op、不判合法性 —— 两份判断迟早不一致。
 *
 * ⚠️ 这里一个内联样式都没有：`scripts/check-l4-no-style.mjs` 的棘轮只减不增，
 *    新组件加 `style={{…}}` 会直接把门禁弄红。样式全在 `projects-settings.css`。
 */

import { useState } from 'react';
import { useI18n, type MessageKey } from '@heyta/i18n';
import {
  PROJECT_ICONS,
  PROJECT_KINDS,
  PROJECT_VIEW_MODES,
  parseProjectIcon,
  projectKindOf,
  projectShowInSmartListOf,
  projectViewModeOf,
  type Project,
  type ProjectIcon,
  type ProjectKind,
  type ProjectViewMode,
} from '@heyta/domain';
import { Settings2 } from 'lucide-react';

import { PROJECT_GLYPHS } from './project-glyphs.js';

/** 视图类型 → 界面词条（`Record` 保证加一个枚举值不补词条会编译报错）。 */
const VIEW_MODE_LABEL_KEYS: Record<ProjectViewMode, MessageKey> = {
  list: 'web.projects.settings.view.list',
  board: 'web.projects.settings.view.board',
  calendar: 'web.projects.settings.view.calendar',
  timeline: 'web.projects.settings.view.timeline',
};

/** 清单类型 → 界面词条。 */
const KIND_LABEL_KEYS: Record<ProjectKind, MessageKey> = {
  tasks: 'web.projects.settings.kind.tasks',
  notes: 'web.projects.settings.kind.notes',
};

interface ProjectSettingsProps {
  /** 当前清单（领域实体）—— 读它的四个设置字段。 */
  project: Project;
  onIcon: (icon: ProjectIcon | undefined) => void;
  onViewMode: (viewMode: ProjectViewMode | undefined) => void;
  onKind: (kind: ProjectKind | undefined) => void;
  onShowInSmartList: (showInSmartList: boolean) => void;
}

export function ProjectSettings({
  project,
  onIcon,
  onViewMode,
  onKind,
  onShowInSmartList,
}: ProjectSettingsProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // 磁盘上的值先过解析器再当类型用（与 HabitIconPicker 同一条：不认识的历史值不能穿透到字形）。
  const icon = parseProjectIcon(project.icon);
  const viewMode = projectViewModeOf(project);
  const kind = projectKindOf(project);
  const showInSmartList = projectShowInSmartListOf(project);

  return (
    <span className="ht-project-settings">
      <button
        type="button"
        className="ht-project-settings__toggle"
        aria-expanded={open}
        aria-label={t('web.projects.settings.toggle', { name: project.name })}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        <Settings2 size={ICON_SIZE.xs} aria-hidden="true" />
      </button>

      {open && (
        <span
          className="ht-project-settings__panel"
          role="group"
          aria-label={t('web.projects.settings.panel')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          {/* 图标 */}
          <span className="ht-project-settings__group">
            <span className="ht-project-settings__label">{t('web.projects.settings.icon')}</span>
            <span className="ht-project-settings__options" role="group">
              {PROJECT_ICONS.map((key) => {
                const Glyph = PROJECT_GLYPHS[key];
                return (
                  <button
                    type="button"
                    key={key}
                    className="ht-project-settings__option"
                    aria-pressed={icon === key}
                    aria-label={t('web.projects.settings.iconOption', { icon: key })}
                    onClick={() => {
                      // 再点一次同一个图标 = 清除（回到缺省绘制），与色槽选择器同一补救动作。
                      onIcon(icon === key ? undefined : key);
                    }}
                  >
                    <Glyph size={ICON_SIZE.sm} aria-hidden="true" />
                  </button>
                );
              })}
              <button
                type="button"
                className="ht-project-settings__option ht-project-settings__option--text"
                aria-pressed={icon === undefined}
                onClick={() => {
                  onIcon(undefined);
                }}
              >
                {t('web.projects.settings.iconDefault')}
              </button>
            </span>
          </span>

          {/* 视图类型 */}
          <span className="ht-project-settings__group">
            <span className="ht-project-settings__label">{t('web.projects.settings.viewMode')}</span>
            <span className="ht-project-settings__options" role="group">
              {PROJECT_VIEW_MODES.map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className="ht-project-settings__option ht-project-settings__option--text"
                  // 缺省值也要按下 —— 读的是**实际生效**的视图，不是"有没有显式设过"。
                  aria-pressed={viewMode === mode}
                  onClick={() => {
                    // 再点一次当前（生效中）的视图 = 退回缺省；点别的 = 写显式值。
                    onViewMode(viewMode === mode ? undefined : mode);
                  }}
                >
                  {t(VIEW_MODE_LABEL_KEYS[mode])}
                </button>
              ))}
            </span>
          </span>

          {/* 清单类型 */}
          <span className="ht-project-settings__group">
            <span className="ht-project-settings__label">{t('web.projects.settings.kind')}</span>
            <span className="ht-project-settings__options" role="group">
              {PROJECT_KINDS.map((value) => (
                <button
                  type="button"
                  key={value}
                  className="ht-project-settings__option ht-project-settings__option--text"
                  aria-pressed={kind === value}
                  onClick={() => {
                    onKind(kind === value ? undefined : value);
                  }}
                >
                  {t(KIND_LABEL_KEYS[value])}
                </button>
              ))}
            </span>
          </span>

          {/* 是否在智能清单显示 */}
          <label className="ht-project-settings__checkbox">
            <input
              type="checkbox"
              checked={showInSmartList}
              onChange={(event) => {
                onShowInSmartList(event.target.checked);
              }}
            />
            <span>{t('web.projects.settings.smartList')}</span>
          </label>
        </span>
      )}
    </span>
  );
}
