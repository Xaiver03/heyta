/** Authentication uses the saved endpoint, an explicit deployment override, or heyta hosted.
 * A local WebView or a development origin is never inferred to be a sync server.
 * Resolving an endpoint neither grants network consent nor creates a session.
 */
import { OFFICIAL_SITE_ORIGIN } from '@heyta/app-host';

function configuredSyncUrl(): string | null {
  const raw: unknown = import.meta.env.VITE_SYNC_URL;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === '') return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  } catch {
    return null;
  }
  return trimmed;
}

/** Keep existing sessions bound to their issuer; only new sessions use the default. */
export function authBaseUrl(configuredBaseUrl = ''): string {
  const configured = configuredBaseUrl.trim().replace(/\/+$/, '');
  if (configured !== '') return configured;
  return configuredSyncUrl() ?? OFFICIAL_SITE_ORIGIN;
}

export function isUnconfigured(baseUrl: string): boolean {
  return baseUrl.trim() === '';
}
