import generatedArtwork from './state-artwork.generated.json';

export type StateIllustrationLocale = 'zh-CN' | 'en';

export type StateIllustrationArtworkVariant =
  | 'tasks'
  | 'notes'
  | 'habits'
  | 'calendar'
  | 'search'
  | 'complete';

export type StateIllustrationArtwork = Readonly<
  Record<StateIllustrationLocale, Readonly<Record<StateIllustrationArtworkVariant, string>>>
>;

/**
 * 双语资源映射。当前六张原图都没有文字，因此中英文共用同一份运行时 PNG；
 * 仍保留 locale 这一层，未来某张插画需要语言化时不会把选择逻辑散到宿主。
 */
export const STATE_ARTWORK = generatedArtwork as StateIllustrationArtwork;

export function selectStateArtwork(
  locale: StateIllustrationLocale,
  variant: StateIllustrationArtworkVariant,
): string {
  return STATE_ARTWORK[locale][variant] ?? STATE_ARTWORK['zh-CN'][variant];
}
