import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { I18nProvider } from '@heyta/i18n';
import { AiDisclosureHost } from '../src/features/ai/AiDisclosureHost.js';

it('先展示可理解的数据范围，仍可展开全部字段且未知字段不会被隐藏', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => root.render(<I18nProvider locale="zh-CN"><AiDisclosureHost
      testIdPrefix="summary-"
      target={{ endpointId: 'test', destination: 'user-endpoint', label: '测试服务', endpoint: 'https://example.test/v1', model: 'test', isLocal: false, fallbacks: ['https://fallback.test/v1'] }}
      fields={['task.title', 'task.body', 'note.content', 'future.secret', 'task.id', 'task.priority', 'event.date', 'habit.name', 'project.name']}
      retentionDisclosure={undefined}
    /></I18nProvider>));
    expect(container.querySelector('[data-testid="summary-field-summary"]')?.textContent).toContain('任务内容（含备注）');
    expect(container.querySelector('[data-testid="summary-field-summary"]')?.textContent).toContain('future.secret');
    expect(container.querySelector('[data-testid="summary-field-list"]')).toBeNull();
    expect(container.querySelector('[data-testid="summary-e2ee-warning"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="summary-fallbacks"]')?.textContent).toContain('fallback.test');
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="summary-fields-toggle"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const details = container.querySelector('[data-testid="summary-field-list"]')?.textContent;
    for (const field of ['task.title', 'task.body', 'note.content', 'future.secret']) expect(details).toContain(field);
    act(() => toggle.click());
    expect(container.querySelector('[data-testid="summary-field-list"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
