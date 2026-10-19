/** Official identity HTTP transport; independent of op/snapshot schema versions. */
export const CENTRAL_AUTH_PATHS = {
  config: '/api/auth/central/config',
  session: '/api/auth/central/session',
  start: '/api/auth/oidc/start',
  callback: '/api/auth/oidc/callback',
} as const;
export const CENTRAL_AUTH_UNAVAILABLE = 'CENTRAL_UNAVAILABLE' as const;
export const CENTRAL_AUTH_REQUIRED = 'central_authentication_required' as const;
export type CentralReauthenticationResponse = {
  reauthenticationRequired: true;
  loginPath: typeof CENTRAL_AUTH_PATHS.start;
};
