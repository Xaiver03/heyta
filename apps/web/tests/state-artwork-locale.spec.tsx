import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { HeytaUiProvider, EmptyState, useHeytaUiLocale } from '@heyta/ui';

function LocaleProbe() {
  return <output data-testid="ui-locale">{useHeytaUiLocale()}</output>;
}

it('宿主切换语言后，嵌套共享组件立即选择该语言素材', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    for (const locale of ['zh-CN', 'en', 'zh-CN'] as const) {
      await act(async () => root.render(
        <HeytaUiProvider locale={locale}>
          <HeytaUiProvider>
            <LocaleProbe />
            <EmptyState title="空态语言切换验证" illustration="tasks" illustrationMotion="none" />
          </HeytaUiProvider>
        </HeytaUiProvider>,
      ));
      expect(container.querySelector('[data-testid="ui-locale"]')?.textContent).toBe(locale);
      expect(container.querySelector('[data-testid="state-artwork-tasks"]')).not.toBeNull();
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
