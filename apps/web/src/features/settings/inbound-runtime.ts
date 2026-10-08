import {
  createInboundCommitJournal,
  createInboundRecipientKeyStore,
  createInboundRecipientRemote,
  createVaultWrappedAutomationWorkerStore,
  generateInboundKeyPair,
  inboundPublicKey,
  registerAutomationWorker,
  processInboundAutomationEvent,
  type AutomationWorkerCredential,
  type InboundRecipientRegistration,
} from '@heyta/app-host';
import { IndexedDbAdapter } from '@heyta/storage';
import { requireEngine } from '../../lib/oplog.js';
import { getWebVaultSession } from '../../lib/vault-session.js';
import { consentFetch } from '../privacy/consent-gate.js';
import type { AiRoutingConfig, EgressConsent } from '@heyta/ai';
import type { InboundAutomationField } from '@heyta/app-host';

const DB_NAME = 'heyta-inbound';
let adapterPromise: Promise<IndexedDbAdapter> | undefined;

async function adapter(): Promise<IndexedDbAdapter> {
  adapterPromise ??= (async () => {
    const value = new IndexedDbAdapter(DB_NAME);
    await value.init();
    return value;
  })();
  return adapterPromise;
}

const accountBinding = (value: string): string => /^\d+$/.test(value) ? `user-${value}` : value;
const publicKey = (value: Uint8Array): string => inboundPublicKey(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function unlocked(input: { accountId: string; baseUrl: string; token: string }): Promise<{ root: Uint8Array; sessionOrigin: string }> {
  const session = await getWebVaultSession(input.accountId, input.baseUrl, async () => input.token);
  if (session.state !== 'unlocked') throw new Error('Vault is locked');
  return { root: session.copyUnlockedRootKey(), sessionOrigin: session.scope.serverOrigin };
}

export async function ensureWebInboundRecipientKey(input: { accountId: string; baseUrl: string; token: string }): Promise<InboundRecipientRegistration> {
  const remote = createInboundRecipientRemote({ baseUrl: input.baseUrl, getToken: async () => input.token, fetchImpl: consentFetch });
  const existing = await remote.get();
  const unlockedSession = await unlocked(input);
  const store = createInboundRecipientKeyStore(await adapter());
  const scopeBase = { accountId: accountBinding(input.accountId), serverOrigin: unlockedSession.sessionOrigin };
  let privateKey: Uint8Array | undefined;
  try {
    const scope = { ...scopeBase, keyEpoch: existing?.keyEpoch ?? 1 };
    privateKey = await store.load(scope, unlockedSession.root);
    if (existing !== undefined) {
      if (privateKey === undefined || publicKey(privateKey) !== existing.publicKey) throw new Error('Inbound recipient key recovery is required');
      return existing;
    }
    if (privateKey === undefined) {
      privateKey = generateInboundKeyPair().privateKey;
      await store.save(scope, privateKey, unlockedSession.root);
    }
    const candidate = { keyEpoch: 1, packageVersion: 1, publicKey: publicKey(privateKey) };
    try { return await remote.put(candidate, null); }
    catch (error) {
      const winner = await remote.get();
      if (winner?.keyEpoch === candidate.keyEpoch && winner.publicKey === candidate.publicKey) return winner;
      throw error;
    }
  } finally { privateKey?.fill(0); unlockedSession.root.fill(0); }
}

export async function rotateWebInboundRecipientKey(input: { accountId: string; baseUrl: string; token: string }): Promise<InboundRecipientRegistration> {
  const remote = createInboundRecipientRemote({ baseUrl: input.baseUrl, getToken: async () => input.token, fetchImpl: consentFetch });
  const existing = await remote.get();
  if (existing === undefined) throw new Error('Inbound recipient key is not registered');
  const unlockedSession = await unlocked(input);
  const store = createInboundRecipientKeyStore(await adapter());
  const scopeBase = { accountId: accountBinding(input.accountId), serverOrigin: unlockedSession.sessionOrigin };
  const currentScope = { ...scopeBase, keyEpoch: existing.keyEpoch };
  const candidateScope = { ...scopeBase, keyEpoch: existing.keyEpoch + 1 };
  let current: Uint8Array | undefined;
  let candidate: Uint8Array | undefined;
  try {
    current = await store.load(currentScope, unlockedSession.root);
    if (current === undefined || publicKey(current) !== existing.publicKey) throw new Error('Inbound recipient key recovery is required');
    candidate = await store.load(candidateScope, unlockedSession.root);
    if (candidate === undefined) { candidate = generateInboundKeyPair().privateKey; await store.save(candidateScope, candidate, unlockedSession.root); }
    const publication = { keyEpoch: candidateScope.keyEpoch, packageVersion: existing.packageVersion + 1, publicKey: publicKey(candidate) };
    try { return await remote.put(publication, existing.packageVersion); }
    catch (error) {
      const winner = await remote.get();
      if (winner?.keyEpoch === publication.keyEpoch && winner.packageVersion === publication.packageVersion && winner.publicKey === publication.publicKey) return winner;
      await store.remove(candidateScope);
      throw error;
    }
  } finally { current?.fill(0); candidate?.fill(0); unlockedSession.root.fill(0); }
}

export async function registerWebInboundWorker(input: { accountId: string; baseUrl: string; token: string }): Promise<AutomationWorkerCredential> {
  const root = await unlocked(input);
  const db = await adapter();
  try {
    const secrets = createVaultWrappedAutomationWorkerStore(db, async () => {
      const session = await getWebVaultSession(input.accountId, input.baseUrl, async () => input.token);
      if (session.state !== 'unlocked') return undefined;
      return session.copyUnlockedRootKey();
    });
    const credential = await registerAutomationWorker({ baseUrl: input.baseUrl, token: input.token, userId: input.accountId,
      clientId: requireEngine().getClientId(), databaseEpoch: `web-${requireEngine().getClientId()}`, secrets, fetchImpl: consentFetch });
    return credential;
  } finally { root.root.fill(0); }
}

export async function hasWebInboundWorker(input: { accountId: string; baseUrl: string; token: string }): Promise<boolean> {
  const db = await adapter();
  const secrets = createVaultWrappedAutomationWorkerStore(db, async () => {
    const session = await getWebVaultSession(input.accountId, input.baseUrl, async () => input.token);
    if (session.state !== 'unlocked') return undefined;
    return session.copyUnlockedRootKey();
  });
  return (await secrets.load({ userId: input.accountId, clientId: requireEngine().getClientId(), serverOrigin: new URL(input.baseUrl).origin })) !== undefined;
}

export async function webInboundJournal() {
  return createInboundCommitJournal(await adapter());
}

/** Foreground-only Web worker step. The caller supplies the current AI gates. */
export async function processWebInboundOnce(input: {
  accountId: string; baseUrl: string; token: string; keyEpoch: number;
  allowedFields: readonly InboundAutomationField[]; targetProjectId?: string; maxItems?: number;
  timezone?: string; parseVersion: number; routing: AiRoutingConfig; consents: readonly EgressConsent[];
  systemPrompt: string; eventId?: string;
}): Promise<{ state: 'empty' | 'submitted'; eventId?: string; itemCount?: number }> {
  const session = await getWebVaultSession(input.accountId, input.baseUrl, async () => input.token);
  if (session.state !== 'unlocked') throw new Error('Vault is locked');
  const db = await adapter();
  const secrets = createVaultWrappedAutomationWorkerStore(db, async () => {
    const live = await getWebVaultSession(input.accountId, input.baseUrl, async () => input.token);
    if (live.state !== 'unlocked') return undefined;
    return live.copyUnlockedRootKey();
  });
  const worker = await secrets.load({ userId: input.accountId, clientId: requireEngine().getClientId(), serverOrigin: new URL(input.baseUrl).origin });
  if (worker === undefined) throw new Error('Inbound worker is not registered or Vault is locked');
  const keys = createInboundRecipientKeyStore(db);
  const root = session.copyUnlockedRootKey();
  let privateKey: Uint8Array | undefined;
  try {
    privateKey = await keys.load({ accountId: accountBinding(input.accountId), serverOrigin: new URL(input.baseUrl).origin, keyEpoch: input.keyEpoch }, root);
    if (privateKey === undefined) throw new Error('Inbound recipient key is unavailable');
    return await processInboundAutomationEvent({
      baseUrl: input.baseUrl, token: input.token, worker, journal: createInboundCommitJournal(db), privateKey,
      accountId: accountBinding(input.accountId), keyEpoch: input.keyEpoch, allowedFields: input.allowedFields,
      ...(input.targetProjectId === undefined ? {} : { targetProjectId: input.targetProjectId }),
      ...(input.maxItems === undefined ? {} : { maxItems: input.maxItems }),
      ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      parseVersion: input.parseVersion, routing: input.routing, consents: input.consents, systemPrompt: input.systemPrompt,
      ...(input.eventId === undefined ? {} : { eventId: input.eventId }), taskBatch: { dispatchValidated: requireEngine().dispatchValidated.bind(requireEngine()) },
      loadPrivateKey: async (keyEpoch) => keys.load({ accountId: accountBinding(input.accountId), serverOrigin: new URL(input.baseUrl).origin, keyEpoch }, root),
      fetchImpl: consentFetch,
    });
  } finally { privateKey?.fill(0); root.fill(0); }
}
