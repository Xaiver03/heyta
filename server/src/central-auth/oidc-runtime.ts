/** Standard MIT client, independently integrated; no internal AGPL adapter code. */
type OidcClient = typeof import('openid-client');

export function assertOidcNodeVersion(version = process.versions.node): void {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || Number(match[1]) < 22 || (Number(match[1]) === 22 && Number(match[2]) < 12)) {
    throw new Error('The OIDC client requires Node.js >=22.12 for CommonJS require(ESM)');
  }
}

export function loadOidcClient(): OidcClient {
  assertOidcNodeVersion();
  // Node's native require(ESM), verified under ts-node and the compiled CommonJS artifact.
  // Keeping this lazy avoids changing local-mode authentication or importing browser code.
  return require('openid-client') as OidcClient;
}

/** Offline runtime probe: exercises real standard-library PKCE, never contacts an issuer. */
export async function verifyOidcRuntime(): Promise<{ node: string; pkce: 'S256' }> {
  const client = loadOidcClient();
  const challenge = await client.calculatePKCECodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  if (challenge !== 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM') {
    throw new Error('OIDC PKCE known-answer verification failed');
  }
  for (const name of ['authorizationCodeGrant', 'refreshTokenGrant', 'tokenIntrospection', 'tokenRevocation'] as const) {
    if (typeof client[name] !== 'function') throw new Error('OIDC standard-client runtime API is incomplete');
  }
  return { node: process.versions.node, pkce: 'S256' };
}
