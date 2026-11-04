import type { Locale } from '@heyta/i18n';

export function formatSettingsDate(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(locale, {
    year: '2-digit',
    month: 'numeric',
    day: 'numeric',
  });
}

export function formatSettingsDateTime(ms: number, locale: Locale): string {
  return new Date(ms).toLocaleString(locale, {
    year: '2-digit',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
