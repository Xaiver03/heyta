/**
 * 白噪音设置（覆盖图谱 #51）
 * ===========================
 *
 * 专注页的一个次级入口（与「时长设置」同族：默认收起，摘要显示当前状态）。
 * 里面只有**控件本身**：开关、噪声种类、音量 —— 不写任何说明文字
 * （UX 原则 §11：布局与控件自己解释）。
 *
 * 状态与持久化在 `lib/focus-noise.ts`，播放接线在 `use-noise-player.ts`，
 * 这里只画。
 */

import { useState } from 'react';
import { cssVar } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';

import {
  NOISE_KINDS,
  loadNoisePref,
  saveNoisePref,
  type NoiseKind,
  type NoisePref,
} from '../../lib/focus-noise.js';
import { useNoisePlayer } from './use-noise-player.js';

/** 噪声种类 → 词条。加一种噪声要同时补这里与 `NOISE_PRESETS`。 */
const KIND_LABEL_KEYS: Record<NoiseKind, MessageKey> = {
  rain: 'web.focus.noise.kind.rain',
  white: 'web.focus.noise.kind.white',
  brown: 'web.focus.noise.kind.brown',
};

export function NoiseSettings(): React.JSX.Element {
  const { t } = useI18n();
  const [pref, setPref] = useState<NoisePref>(loadNoisePref);

  // 真实播放：enabled / kind / volume 都从这里喂给 AudioContext。
  useNoisePlayer({ enabled: pref.enabled, kind: pref.kind, volume: pref.volume });

  const update = (partial: Partial<NoisePref>): void => {
    setPref((prev) => {
      const next: NoisePref = { ...prev, ...partial };
      saveNoisePref(next);
      return next;
    });
  };

  return (
    <details className="ht-app__focus-settings" data-testid="focus-noise">
      <summary className="ht-app__focus-settings-toggle" data-testid="focus-noise-toggle">
        <span>{t('web.focus.noise.title')}</span>
        <span className="ht-app__focus-settings-summary" aria-hidden="true">
          {pref.enabled ? t('web.focus.noise.on') : t('web.focus.noise.off')}
        </span>
      </summary>
      <fieldset className="ht-app__focus-settings-fields">
        <legend className="ht-app__focus-settings-legend">{t('web.focus.noise.title')}</legend>

        {/* 开关：role=switch，状态由 aria-checked 暴露（不靠纯颜色）。 */}
        <button
          type="button"
          role="switch"
          aria-checked={pref.enabled}
          aria-label={t('web.focus.noise.title')}
          data-testid="focus-noise-switch"
          onClick={() => {
            update({ enabled: !pref.enabled });
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: cssVar('space.2'),
            minBlockSize: cssVar('size.field-height'),
            paddingInline: cssVar('space.3'),
            borderRadius: cssVar('radius.md'),
            border: `1px solid ${cssVar('color.border')}`,
            background: pref.enabled ? cssVar('color.primary-subtle') : cssVar('color.background'),
            color: pref.enabled ? cssVar('color.primary') : cssVar('color.foreground'),
            fontSize: cssVar('font-size.sm'),
            cursor: 'pointer',
            inlineSize: '100%',
          }}
        >
          <span>{pref.enabled ? t('web.focus.noise.on') : t('web.focus.noise.off')}</span>
        </button>

        {/* 噪声种类：三选一，选中只改底色 + 边框，不改行高/形状。 */}
        <div
          role="radiogroup"
          aria-label={t('web.focus.noise.kindLabel')}
          data-testid="focus-noise-kind"
          style={{ display: 'flex', gap: cssVar('space.2'), flexWrap: 'wrap' }}
        >
          {NOISE_KINDS.map((kind) => {
            const selected = pref.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`focus-noise-kind-${kind}`}
                onClick={() => {
                  update({ kind });
                }}
                style={{
                  flex: '1 1 auto',
                  minBlockSize: cssVar('size.field-height'),
                  paddingInline: cssVar('space.3'),
                  borderRadius: cssVar('radius.md'),
                  border: `1px solid ${selected ? cssVar('color.primary') : cssVar('color.border')}`,
                  background: selected ? cssVar('color.primary-subtle') : cssVar('color.background'),
                  color: selected ? cssVar('color.primary') : cssVar('color.foreground-muted'),
                  fontSize: cssVar('font-size.sm'),
                  cursor: 'pointer',
                }}
              >
                {t(KIND_LABEL_KEYS[kind])}
              </button>
            );
          })}
        </div>

        {/* 音量：原生 range，无障碍名走词条。 */}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={pref.volume}
          aria-label={t('web.focus.noise.volume')}
          data-testid="focus-noise-volume"
          onChange={(event) => {
            update({ volume: Number.parseFloat(event.target.value) });
          }}
          style={{ inlineSize: '100%' }}
        />
      </fieldset>
    </details>
  );
}
