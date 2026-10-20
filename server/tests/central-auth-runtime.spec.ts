import { describe, expect, it } from 'vitest';
import { assertOidcNodeVersion, loadOidcClient, verifyOidcRuntime } from '../src/central-auth/oidc-runtime';

describe('standard OIDC client runtime', () => {
  it.each(['20.19.0', '22.0.0', '22.11.0', 'unknown'])('refuses unsupported Node %s', (version) => {
    expect(() => assertOidcNodeVersion(version)).toThrow('>=22.12');
  });
  it.each(['22.12.0', '22.22.3', '24.2.0'])('supports Node %s', (version) => {
    expect(() => assertOidcNodeVersion(version)).not.toThrow();
  });
  it('loads the actual MIT library and verifies the RFC 7636 S256 known answer offline', async () => {
    expect(await verifyOidcRuntime()).toEqual({ node: process.versions.node, pkce: 'S256' });
  });
  it('generates independent cryptographic transaction bindings with the standard library', () => {
    const client = loadOidcClient();
    const stateA = client.randomState();
    const stateB = client.randomState();
    expect(stateA.length >= 32 && stateB.length >= 32 && stateA !== stateB).toBe(true);
    expect(client.randomPKCECodeVerifier().length >= 43).toBe(true);
  });
});
