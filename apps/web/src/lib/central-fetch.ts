import { createCentralCookieFetch } from '@heyta/app-host';

import { consentFetch } from '../features/privacy/consent-gate.js';

function browserCsrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('__Host-heyta-csrf='))?.slice('__Host-heyta-csrf='.length);
}

/** Web API clients use the same Cookie/CSRF transport as sync and vault. */
export function createWebAuthFetch(baseUrl: string, authTransport: 'bearer' | 'cookie'): typeof fetch {
  return authTransport === 'cookie'
    ? createCentralCookieFetch(baseUrl, browserCsrfToken, consentFetch)
    : globalThis.fetch.bind(globalThis);
}
