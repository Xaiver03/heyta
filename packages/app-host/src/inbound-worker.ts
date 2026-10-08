import type { SuperSyncInboundUploadAuthorization } from '@heyta/shared-schema';
import type { SyncClientOptions } from '@heyta/sync-client';
import type { InboundAutomationField } from '@heyta/inbound-core';

/** The worker token is a platform secret, never an op-log value. */
export interface AutomationWorkerCredential {
  workerId: string;
  workerToken: string;
  userId: string;
  clientId: string;
  databaseEpoch: string;
  serverOrigin: string;
}

export interface AutomationWorkerSecretStore {
  load(binding: { userId: string; clientId: string; serverOrigin: string }): Promise<AutomationWorkerCredential | undefined>;
  save(credential: AutomationWorkerCredential): Promise<void>;
  clear(binding: { userId: string; clientId: string; serverOrigin: string }): Promise<void>;
  /** Optional in-place re-wrap used by Vault root rotation. */
  rewrap?(binding: { userId: string; clientId: string; serverOrigin: string }, oldRoot: Uint8Array, newRoot: Uint8Array): Promise<boolean>;
}

/** Durable journal entry. Its value is the opaque signed receipt from the server. */
export interface AutomationCommitJournal {
  load(eventId: string): Promise<string | undefined>;
  save(eventId: string, proof: string): Promise<void>;
  remove(eventId: string): Promise<void>;
}

export interface InboundWorkerAuthorizationOptions {
  userId: string;
  secrets: AutomationWorkerSecretStore;
  journal: AutomationCommitJournal;
}

const jsonHeaders = { 'content-type': 'application/json' } as const;
const workerRegistrationPath = '/api/automation/worker/register';
const commitPermitPath = '/api/automation/commit-permit';
const claimEventPath = '/api/automation/events/claim';
const reserveAiAttemptPath = (eventId: string) => `/api/automation/events/${encodeURIComponent(eventId)}/ai-attempt/reserve`;
const preparedResultPath = (eventId: string, clientId: string) => `/api/automation/events/${encodeURIComponent(eventId)}/result?clientId=${encodeURIComponent(clientId)}`;

const workerHeaders = (token: string, worker: AutomationWorkerCredential): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  'x-heyta-worker-token': worker.workerToken,
  'x-heyta-database-epoch': worker.databaseEpoch,
});

export interface RegisterAutomationWorkerOptions {
  baseUrl: string;
  token: string;
  userId: string;
  clientId: string;
  databaseEpoch: string;
  secrets: AutomationWorkerSecretStore;
  fetchImpl?: typeof fetch;
}

/** Register and durably save the worker token before any inbound op is made. */
export async function registerAutomationWorker(options: RegisterAutomationWorkerOptions): Promise<AutomationWorkerCredential> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(new URL(workerRegistrationPath, options.baseUrl), {
    method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${options.token}`, ...jsonHeaders },
    body: JSON.stringify({ clientId: options.clientId, databaseEpoch: options.databaseEpoch }),
  });
  if (!response.ok) throw new Error('Automation worker registration failed');
  const raw = await response.json() as Record<string, unknown>;
  if (typeof raw.workerId !== 'string' || typeof raw.workerToken !== 'string' ||
      typeof raw.syncClientId !== 'string' || typeof raw.databaseEpoch !== 'string' ||
      !/^[0-9a-f]{64}$/.test(raw.workerToken)) throw new Error('Invalid automation worker response');
  const credential: AutomationWorkerCredential = {
    workerId: raw.workerId, workerToken: raw.workerToken, userId: options.userId,
    clientId: raw.syncClientId, databaseEpoch: raw.databaseEpoch,
    serverOrigin: new URL(options.baseUrl).origin,
  };
  await options.secrets.save(credential);
  return credential;
}

export interface CommitPermitRequest {
  clientId: string;
  databaseEpoch: string;
  eventId: string;
  opId: string;
  ruleId: string;
  ruleVersion: number;
  parseVersion: number;
  resultDigest: string;
  itemCount: number;
}

/** Ask the server for a permit and journal its proof before dispatching the op. */
export async function requestCommitPermitAndJournal(options: {
  baseUrl: string;
  token: string;
  worker: AutomationWorkerCredential;
  request: CommitPermitRequest;
  journal: AutomationCommitJournal;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const response = await (options.fetchImpl ?? globalThis.fetch)(new URL(commitPermitPath, options.baseUrl), {
    method: 'POST', redirect: 'error',
    headers: { authorization: `Bearer ${options.token}`, ...jsonHeaders,
      'x-heyta-worker-token': options.worker.workerToken,
      'x-heyta-database-epoch': options.worker.databaseEpoch },
    body: JSON.stringify(options.request),
  });
  if (!response.ok) throw new Error('Automation commit authorization failed');
  const raw = await response.json() as Record<string, unknown>;
  if (typeof raw.proof !== 'string' || raw.eventId !== options.request.eventId || raw.opId !== options.request.opId) {
    throw new Error('Invalid automation commit authorization response');
  }
  await options.journal.save(options.request.eventId, raw.proof);
  return raw.proof;
}

export interface ClaimedAutomationEvent {
  receivedAt: number;
  eventId: string;
  ruleId: string;
  ruleVersion: number;
  contentType: 'application/json' | 'text/plain';
  payloadCiphertext: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  attempt: number;
  allowedFields: readonly InboundAutomationField[];
  targetProjectId?: string;
  timezone?: string;
  parseVersion: number;
  maxItems: number;
}

/** Claiming is an opaque transport operation; decryption stays in the host. */
export async function claimAutomationEvent(options: {
  baseUrl: string;
  token: string;
  worker: AutomationWorkerCredential;
  eventId?: string;
  fetchImpl?: typeof fetch;
}): Promise<ClaimedAutomationEvent | undefined> {
  const response = await (options.fetchImpl ?? globalThis.fetch)(new URL(claimEventPath, options.baseUrl), {
    method: 'POST', redirect: 'error', headers: { ...workerHeaders(options.token, options.worker), ...jsonHeaders },
    body: JSON.stringify({ clientId: options.worker.clientId, ...(options.eventId === undefined ? {} : { eventId: options.eventId }) }),
  });
  if (!response.ok) throw new Error('Automation event claim failed');
  const raw = await response.json() as Record<string, unknown>;
  if (raw.state === 'empty') return undefined;
  if (typeof raw.receivedAt !== 'number' || !Number.isSafeInteger(raw.receivedAt) || raw.receivedAt < 0 || raw.receivedAt > 8_640_000_000_000_000 ||
      typeof raw.eventId !== 'string' || typeof raw.ruleId !== 'string' || typeof raw.ruleVersion !== 'number' ||
      typeof raw.payloadCiphertext !== 'string' || typeof raw.leaseGeneration !== 'number' ||
      typeof raw.leaseExpiresAt !== 'string' || typeof raw.attempt !== 'number') {
    throw new Error('Invalid automation event claim response');
  }
  const allowedFields = Array.isArray(raw.allowedFields) && raw.allowedFields.every((field): field is InboundAutomationField =>
    typeof field === 'string' && ['title', 'note', 'priority', 'projectId', 'dueDate', 'startDate', 'durationMinutes'].includes(field))
    ? raw.allowedFields : ['title'] as const;
  return {
    eventId: raw.eventId, ruleId: raw.ruleId, ruleVersion: raw.ruleVersion, receivedAt: raw.receivedAt, contentType: raw.contentType === 'text/plain' ? 'text/plain' : 'application/json',
    payloadCiphertext: raw.payloadCiphertext, leaseGeneration: raw.leaseGeneration,
    leaseExpiresAt: raw.leaseExpiresAt, attempt: raw.attempt,
    allowedFields,
    ...(typeof raw.targetProjectId === 'string' ? { targetProjectId: raw.targetProjectId } : {}),
    ...(typeof raw.timezone === 'string' ? { timezone: raw.timezone } : {}),
    parseVersion: typeof raw.parseVersion === 'number' ? raw.parseVersion : 1,
    maxItems: typeof raw.maxItems === 'number' ? raw.maxItems : 50,
  };
}

export async function renewAutomationLease(options: {
  baseUrl: string;
  token: string;
  worker: AutomationWorkerCredential;
  eventId: string;
  leaseGeneration: number;
  fetchImpl?: typeof fetch;
}): Promise<ClaimedAutomationEvent> {
  const response = await (options.fetchImpl ?? globalThis.fetch)(
    new URL(`/api/automation/events/${encodeURIComponent(options.eventId)}/renew`, options.baseUrl),
    { method: 'POST', redirect: 'error', headers: { ...workerHeaders(options.token, options.worker), ...jsonHeaders },
      body: JSON.stringify({ clientId: options.worker.clientId, leaseGeneration: options.leaseGeneration }) },
  );
  if (!response.ok) throw new Error('Automation lease renewal failed');
  const raw = await response.json() as Record<string, unknown>;
  if (typeof raw.receivedAt !== 'number' || !Number.isSafeInteger(raw.receivedAt) || raw.receivedAt < 0 || raw.receivedAt > 8_640_000_000_000_000 ||
      typeof raw.eventId !== 'string' || typeof raw.ruleId !== 'string' || typeof raw.ruleVersion !== 'number' ||
      typeof raw.payloadCiphertext !== 'string' || typeof raw.leaseGeneration !== 'number' ||
      typeof raw.leaseExpiresAt !== 'string' || typeof raw.attempt !== 'number') throw new Error('Invalid automation lease response');
  const allowedFields = Array.isArray(raw.allowedFields) && raw.allowedFields.every((field): field is InboundAutomationField =>
    typeof field === 'string' && ['title', 'note', 'priority', 'projectId', 'dueDate', 'startDate', 'durationMinutes'].includes(field))
    ? raw.allowedFields : ['title'] as const;
  return { eventId: raw.eventId, ruleId: raw.ruleId, ruleVersion: raw.ruleVersion, receivedAt: raw.receivedAt, contentType: raw.contentType === 'text/plain' ? 'text/plain' : 'application/json', payloadCiphertext: raw.payloadCiphertext,
    leaseGeneration: raw.leaseGeneration, leaseExpiresAt: raw.leaseExpiresAt, attempt: raw.attempt, allowedFields,
    ...(typeof raw.targetProjectId === 'string' ? { targetProjectId: raw.targetProjectId } : {}),
    ...(typeof raw.timezone === 'string' ? { timezone: raw.timezone } : {}),
    parseVersion: typeof raw.parseVersion === 'number' ? raw.parseVersion : 1,
    maxItems: typeof raw.maxItems === 'number' ? raw.maxItems : 50 };
}

export async function publishAutomationResult(options: {
  baseUrl: string;
  token: string;
  worker: AutomationWorkerCredential;
  eventId: string;
  leaseGeneration: number;
  parseVersion: number;
  itemCount: number;
  resultDigest: string;
  resultCiphertext: string;
  needsConfirmation?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ eventId: string; state: string; parseVersion: number }> {
  const response = await (options.fetchImpl ?? globalThis.fetch)(
    new URL(`/api/automation/events/${encodeURIComponent(options.eventId)}/result`, options.baseUrl),
    { method: 'POST', redirect: 'error', headers: { ...workerHeaders(options.token, options.worker), ...jsonHeaders },
      body: JSON.stringify({ clientId: options.worker.clientId, leaseGeneration: options.leaseGeneration,
        parseVersion: options.parseVersion, itemCount: options.itemCount, resultDigest: options.resultDigest, resultCiphertext: options.resultCiphertext,
        ...(options.needsConfirmation === undefined ? {} : { needsConfirmation: options.needsConfirmation }) }) },
  );
  if (!response.ok) throw new Error('Automation result publication failed');
  const raw = await response.json() as Record<string, unknown>;
  if (typeof raw.eventId !== 'string' || typeof raw.state !== 'string' || typeof raw.parseVersion !== 'number') {
    throw new Error('Invalid automation result response');
  }
  return { eventId: raw.eventId, state: raw.state, parseVersion: raw.parseVersion };
}

export async function readAutomationPreparedResult(options: {
  baseUrl: string; token: string; worker: AutomationWorkerCredential; eventId?: string; fetchImpl?: typeof fetch;
}): Promise<{ eventId: string; ruleId: string; ruleVersion: number; parseVersion: number; resultDigest: string; resultItemCount: number; resultCiphertext: string; state: string } | undefined> {
  const path = options.eventId === undefined
    ? `/api/automation/events/recover?clientId=${encodeURIComponent(options.worker.clientId)}`
    : preparedResultPath(options.eventId, options.worker.clientId);
  const response = await (options.fetchImpl ?? globalThis.fetch)(new URL(path, options.baseUrl), {
    method: 'GET', redirect: 'error', headers: workerHeaders(options.token, options.worker),
  });
  if (response.status === 404 && options.eventId !== undefined) return undefined;
  if (!response.ok) throw new Error('Automation result recovery failed');
  const raw = await response.json() as Record<string, unknown>;
  if (raw.state === 'empty') return undefined;
  if (typeof raw.eventId !== 'string' || typeof raw.ruleId !== 'string' || typeof raw.ruleVersion !== 'number' ||
      typeof raw.parseVersion !== 'number' || typeof raw.resultDigest !== 'string' || typeof raw.resultItemCount !== 'number' ||
      typeof raw.resultCiphertext !== 'string' || (raw.state !== 'prepared' && raw.state !== 'cancelled') ||
      (options.eventId !== undefined && raw.eventId !== options.eventId)) throw new Error('Invalid automation result recovery response');
  return { eventId: raw.eventId, ruleId: raw.ruleId, ruleVersion: raw.ruleVersion, parseVersion: raw.parseVersion,
    resultDigest: raw.resultDigest, resultItemCount: raw.resultItemCount, resultCiphertext: raw.resultCiphertext, state: raw.state };
}

export async function reserveAutomationAiAttempt(options: {
  baseUrl: string; token: string; worker: AutomationWorkerCredential; eventId: string;
  ruleId: string; parseVersion: number; attempt: number; leaseGeneration: number; fetchImpl?: typeof fetch;
}): Promise<{ periodAnchor: number | null; billingSource: 'direct' | 'managed'; state: string }> {
  const response = await (options.fetchImpl ?? globalThis.fetch)(new URL(reserveAiAttemptPath(options.eventId), options.baseUrl), {
    method: 'POST', redirect: 'error', headers: { ...workerHeaders(options.token, options.worker), ...jsonHeaders },
    body: JSON.stringify({ clientId: options.worker.clientId, ruleId: options.ruleId, parseVersion: options.parseVersion,
      attempt: options.attempt, leaseGeneration: options.leaseGeneration }),
  });
  if (!response.ok) throw new Error('Automation AI attempt reservation failed');
  const raw = await response.json() as Record<string, unknown>;
  if ((raw.periodAnchor !== null && typeof raw.periodAnchor !== 'number') ||
      (raw.billingSource !== 'direct' && raw.billingSource !== 'managed') ||
      (raw.billingSource === 'direct' && raw.periodAnchor !== null) ||
      (raw.billingSource === 'managed' && typeof raw.periodAnchor !== 'number') ||
      typeof raw.state !== 'string') throw new Error('Invalid automation AI reservation response');
  return { periodAnchor: raw.periodAnchor, billingSource: raw.billingSource, state: raw.state };
}

export async function advanceAutomationAiAttempt(options: {
  baseUrl: string; token: string; worker: AutomationWorkerCredential; eventId: string;
  ruleId: string; parseVersion: number; attempt: number; leaseGeneration: number;
  from: 'reserved' | 'sent' | 'consumed' | 'released' | 'unknown';
  to: 'reserved' | 'sent' | 'consumed' | 'released' | 'unknown'; fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const response = await (options.fetchImpl ?? globalThis.fetch)(new URL(`/api/automation/events/${encodeURIComponent(options.eventId)}/ai-attempt/state`, options.baseUrl), {
    method: 'POST', redirect: 'error', headers: { ...workerHeaders(options.token, options.worker), ...jsonHeaders },
    body: JSON.stringify({ clientId: options.worker.clientId, ruleId: options.ruleId, parseVersion: options.parseVersion,
      attempt: options.attempt, leaseGeneration: options.leaseGeneration, from: options.from, to: options.to }),
  });
  if (!response.ok) throw new Error('Automation AI attempt state transition failed');
  const raw = await response.json() as Record<string, unknown>;
  if (typeof raw.changed !== 'boolean') throw new Error('Invalid automation AI state response');
  return raw.changed;
}

/**
 * Build the sync-client callback from platform secure storage and the durable
 * proof journal. Missing or mismatched bindings fail closed and leave the op
 * pending for a later retry. The secret store is intentionally injected: web
 * uses an OS/browser protected store while native shells use Keychain/Keystore.
 */
export function createInboundUploadAuthorization(
  options: InboundWorkerAuthorizationOptions,
): NonNullable<SyncClientOptions['getInboundUploadAuthorization']> {
  return async ({ baseUrl, clientId, token, opIds }) => {
    let origin: string;
    try { origin = new URL(baseUrl).origin; } catch { return undefined; }
    const credential = await options.secrets.load({ userId: options.userId, clientId, serverOrigin: origin });
    if (credential === undefined || credential.clientId !== clientId || credential.serverOrigin !== origin || credential.workerToken.length !== 64) {
      return undefined;
    }
    const commitProofs: Record<string, string> = {};
    for (const opId of opIds) {
      if (!opId.startsWith('inbound:')) continue;
      const eventId = opId.slice('inbound:'.length);
      const proof = await options.journal.load(eventId);
      if (proof !== undefined) commitProofs[opId] = proof;
    }
    const result: SuperSyncInboundUploadAuthorization = {
      workerToken: credential.workerToken,
      databaseEpoch: credential.databaseEpoch,
      commitProofs,
    };
    // The token is compared to the current authenticated account token by the
    // server; this callback only supplies it for the same request scope.
    void token;
    return result;
  };
}

/** Journal-before-dispatch fence used by the local worker. */
export async function journalCommitProofBeforeDispatch(
  journal: AutomationCommitJournal,
  eventId: string,
  proof: string,
  dispatch: () => Promise<void>,
): Promise<void> {
  await journal.save(eventId, proof);
  await dispatch();
}
