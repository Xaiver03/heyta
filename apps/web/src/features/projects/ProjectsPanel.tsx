/**
 * 清单与标签面板（侧栏）
 * =========================
 */

import { useState } from 'react';
import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { parseCategorySlot } from '@heyta/domain';
import { Folder, Plus, Tag as TagIcon, Trash2 } from 'lucide-react';

import { ColorSlotPicker } from '../categories/ColorSlotPicker.js';
import { useTaskStore } from '../tasks/store.js';
import { selectChildProjects, selectTopLevelProjects, useProjectStore } from './store.js';

export function ProjectsPanel() {
  const { t } = useI18n();
  const projects = useProjectStore();
  const tasks = useTaskStore();
  const [draft, setDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');

  const tops = selectTopLevelProjects(projects);

  function countIn(projectId: string): number {
    return Object.values(tasks.entities.tasks).filter(
      (task) =>
        task.deletedAt === undefined &&
        task.completedAt === undefined &&
        task.projectId === projectId,
    ).length;
  }

  return (
    <aside
      aria-label={t('web.projects.ariaLabel')}
      style={{
        padding: cssVar('space.3'),
        borderRight: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
        minWidth: cssVar('layout.sidebar-width'),
        display: 'flex',
        flexDirection: 'column',
        gap: cssVar('space.4'),
      }}
    >
      <section>
        <h2 style={headingStyle}>{t('web.projects.heading')}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void projects.addProject(draft);
            setDraft('');
          }}
          style={{ display: 'flex', gap: cssVar('space.1'), marginBottom: cssVar('space.2') }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('web.projects.newPlaceholder')}
            aria-label={t('web.projects.newLabel')}
            style={inputStyle}
          />
          <button type="submit" aria-label={t('web.projects.add')} style={iconButtonStyle}>
            <Plus size={16} aria-hidden="true" />
          </button>
        </form>

        <ul style={listStyle}>
          {tops.map((p) => (
            <li key={p.id}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => tasks.setFilter({ kind: 'project', projectId: p.id })}
                  style={rowButtonStyle}
                >
                  <Folder size={14} aria-hidden="true" />
                  <span style={{ flex: 1, textAlign: 'left' }}>{p.name}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{countIn(p.id)}</span>
                </button>
                <ColorSlotPicker
                  value={parseCategorySlot(p.color)}
                  onChange={(slot) => void projects.setProjectColor(p.id, slot)}
                  targetName={p.name}
                />
                <button
                  type="button"
                  onClick={() => void projects.deleteProject(p.id)}
                  aria-label={t('web.projects.delete', { name: p.name })}
                  style={iconButtonStyle}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
              {/* 子清单只渲染一层 —— 领域层明确不支持任意深度嵌套 */}
              <ul style={{ ...listStyle, paddingLeft: cssVar('space.4') }}>
                {selectChildProjects(projects, p.id).map((c) => (
                  <li key={c.id} style={{ display: 'flex', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => tasks.setFilter({ kind: 'project', projectId: c.id })}
                      style={rowButtonStyle}
                    >
                      <span style={{ flex: 1, textAlign: 'left' }}>{c.name}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{countIn(c.id)}</span>
                    </button>
                    <ColorSlotPicker
                      value={parseCategorySlot(c.color)}
                      onChange={(slot) => void projects.setProjectColor(c.id, slot)}
                      targetName={c.name}
                    />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 style={headingStyle}>{t('web.tags.heading')}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void projects.addTag(tagDraft);
            setTagDraft('');
          }}
          style={{ display: 'flex', gap: cssVar('space.1'), marginBottom: cssVar('space.2') }}
        >
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            placeholder={t('web.tags.newPlaceholder')}
            aria-label={t('web.tags.newLabel')}
            style={inputStyle}
          />
          <button type="submit" aria-label={t('web.tags.add')} style={iconButtonStyle}>
            <Plus size={16} aria-hidden="true" />
          </button>
        </form>
        <ul style={listStyle}>
          {projects.tags.map((tag) => (
            <li key={tag.id} style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ ...rowButtonStyle, cursor: 'default', flex: 1 }}>
                <TagIcon size={14} aria-hidden="true" />
                {tag.name}
              </span>
              <button
                type="button"
                onClick={() => void projects.deleteTag(tag.id)}
                aria-label={t('web.tags.delete', { name: tag.name })}
                style={iconButtonStyle}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

const headingStyle: React.CSSProperties = {
  margin: `0 0 ${cssVar('space.2')}`,
  fontSize: cssVar('font-size.2xs'),
  fontWeight: cssVar('font-weight.semibold'),
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: cssVar('color.foreground-muted'),
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minHeight: cssVar('touch-target.min'),
  padding: `0 ${cssVar('space.2')}`,
  borderRadius: cssVar('radius.md'),
  border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
  background: cssVar('color.background'),
  color: cssVar('color.foreground'),
  // ≥16px，否则 iOS 聚焦时自动放大页面
  fontSize: cssVar('font-size.base'),
  fontFamily: cssVar('font.sans'),
  minWidth: 0,
};

const iconButtonStyle: React.CSSProperties = {
  minWidth: cssVar('touch-target.min'),
  minHeight: cssVar('touch-target.min'),
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  color: cssVar('color.foreground-muted'),
  borderRadius: cssVar('radius.md'),
};

const rowButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: cssVar('space.2'),
  width: '100%',
  minHeight: cssVar('touch-target.min'),
  padding: `0 ${cssVar('space.2')}`,
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  color: cssVar('color.foreground'),
  fontSize: cssVar('font-size.sm'),
  fontFamily: cssVar('font.sans'),
  borderRadius: cssVar('radius.md'),
};
