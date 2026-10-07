import { describe, expect, it } from 'vitest';

import { selectStateArtwork, STATE_ARTWORK } from '../src/empty-state/artwork.js';

const VARIANTS = ['tasks', 'notes', 'habits', 'calendar', 'search', 'complete'] as const;

describe('StateIllustration 双语资源映射', () => {
  it('为中文和英文都登记六种场景，并保留 data URI', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      for (const variant of VARIANTS) {
        expect(STATE_ARTWORK[locale][variant]).toMatch(/^data:image\/png;base64,/);
      }
    }
  });

  it('当前无文字原图可在中英文共享同一运行时 PNG', () => {
    for (const variant of VARIANTS) {
      expect(selectStateArtwork('zh-CN', variant)).toBe(selectStateArtwork('en', variant));
    }
  });

  it('locale 选择是显式的，宿主可直接把 useI18n().locale 传入', () => {
    expect(selectStateArtwork('en', 'tasks')).toBe(STATE_ARTWORK.en.tasks);
    expect(selectStateArtwork('zh-CN', 'tasks')).toBe(STATE_ARTWORK['zh-CN'].tasks);
  });
});
