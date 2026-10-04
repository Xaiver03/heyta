/**
 * Authenticated sync-device management (host agnostic).
 *
 * The server's device rows are advisory presence records, while revocation is
 * an authentication boundary: the DELETE route invalidates the account token
 * version and closes all sockets.  This port therefore never claims that
 * deleting one row is enough.  A successful revoke returns
 * `requiresKeyRotation: true`; the caller must re-authenticate as needed and
 * complete the E2EE root rotation before treating the old device as safe.
 */

import {
  SUPER_SYNC_CLIENT_ID_REGEX,
  SUPER_SYNC_MAX_CLIENT_ID_LENGTH,
  SuperSyncDevicesResponseSchema,
  SuperSyncRevokeDeviceResponseSchema,
} from '@heyta/shared-schema';
import { joinEndpointUrl } from './endpoint-url.js';

export const HOSTED_SYNC_DEVICES_PATH = '/api/sync/devices';

export type HostedSyncDevice = {
  readonly clientId: string;
  readonly lastSeenAt: number;
};

export type HostedDeviceManagementErrorCode =
  | 'unconfigured'
  | 'no-token'
  | 'invalid-client-id'
  | 'unauthorized'
  | 'session-changed'
  | 'request-failed'
  | 'invalid-response';

export class HostedDeviceManagementError extends Error {
  constructor(
    message: string,
    readonly code: HostedDeviceManagementErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HostedDeviceManagementError';
  }
}

export interface HostedDeviceManagementOptions {
  /** Server root, for example `https://sync.example.com`. */
  readonly baseUrl: string;
  /** Read the current token at request time; never cache it in this port. */
  readonly getToken: () => Promise<string | undefined>;
  readonly fetchImpl?: typeof fetch;
}

export type HostedDeviceRevocation = {
  readonly clientId: string;
  readonly requiresKeyRotation: true;
};

/** The account binding used to authorize one device-management action. */
export type HostedSyncAuthSnapshot = {
  readonly accountId: string;
  readonly baseUrl: string;
  readonly token: string;
};

export type BoundHostedDeviceRevocation =
  | {
      readonly status: 'committed';
      readonly revocation: HostedDeviceRevocation;
      /** False means the UI moved to another account while the request ran. */
      readonly authStillCurrent: boolean;
    }
  | {
      /** The server may have committed before the HTTP response was lost. */
      readonly status: 'ambiguous';
      readonly authStillCurrent: boolean;
    };

export function hostedSyncAuthMatches(
  left: HostedSyncAuthSnapshot | undefined,
  right: HostedSyncAuthSnapshot,
): boolean {
  return left?.accountId === right.accountId &&
    left.baseUrl === right.baseUrl &&
    left.token === right.token;
}

const readBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const requestContext = async (
  options: HostedDeviceManagementOptions,
): Promise<{ fetchImpl: typeof fetch; token: string }> => {
  if (options.baseUrl.trim() === '') {
    throw new HostedDeviceManagementError('Sync server is not configured', 'unconfigured');
  }
  let token: string | undefined;
  try {
    token = await options.getToken();
  } catch (error) {
    throw new HostedDeviceManagementError(
      error instanceof Error ? error.message : 'Sync token could not be read',
      'request-failed',
    );
  }
  if (token === undefined || token === '') {
    throw new HostedDeviceManagementError('Sync token is unavailable', 'no-token');
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (fetchImpl === undefined) {
    throw new HostedDeviceManagementError('Fetch is unavailable', 'request-failed');
  }
  return {
    fetchImpl,
    token,
  };
};

export type HostedDeviceRevocationControllerOptions = {
  readonly auth: HostedSyncAuthSnapshot;
  readonly clientId: string;
  readonly readCurrentAuth: () => HostedSyncAuthSnapshot | undefined;
  readonly fetchImpl?: typeof fetch;
  /** Persist non-secret rotation guidance before local credentials are cleared. */
  readonly persistRotationGuidance: () => void | Promise<void>;
  /** Reuse the host's complete local logout/session cleanup path. */
  readonly clearCurrentSession: () => void | Promise<void>;
};

const request = async (
  options: HostedDeviceManagementOptions,
  path: string,
  init: RequestInit,
): Promise<Response> => {
  const context = await requestContext(options);
  try {
    return await context.fetchImpl(joinEndpointUrl(options.baseUrl, path), {
      ...init,
      headers: {
        authorization: `Bearer ${context.token}`,
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    throw new HostedDeviceManagementError(
      error instanceof Error ? error.message : 'Device request failed',
      'request-failed',
    );
  }
};

const assertClientId = (clientId: string): void => {
  if (
    clientId.length === 0 ||
    clientId.length > SUPER_SYNC_MAX_CLIENT_ID_LENGTH ||
    !SUPER_SYNC_CLIENT_ID_REGEX.test(clientId)
  ) {
    throw new HostedDeviceManagementError('Invalid sync device id', 'invalid-client-id');
  }
};

const assertResponse = async (response: Response): Promise<unknown> => {
  const body = await readBody(response);
  if (response.status === 401 || response.status === 403) {
    throw new HostedDeviceManagementError('Device management is not authorized', 'unauthorized', response.status);
  }
  if (!response.ok) {
    throw new HostedDeviceManagementError(`Device request failed (${response.status})`, 'request-failed', response.status);
  }
  return body;
};

export async function listHostedSyncDevices(
  options: HostedDeviceManagementOptions,
): Promise<readonly HostedSyncDevice[]> {
  const body = await assertResponse(await request(options, HOSTED_SYNC_DEVICES_PATH, { method: 'GET' }));
  const parsed = SuperSyncDevicesResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new HostedDeviceManagementError('Invalid sync device response', 'invalid-response');
  }
  return parsed.data.devices.map((device) => ({
    clientId: device.clientId,
    lastSeenAt: device.lastSeenAt,
  }));
}

export async function revokeHostedSyncDevice(
  options: HostedDeviceManagementOptions,
  clientId: string,
): Promise<HostedDeviceRevocation> {
  assertClientId(clientId);
  const body = await assertResponse(
    await request(options, `${HOSTED_SYNC_DEVICES_PATH}/${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
    }),
  );
  const parsed = SuperSyncRevokeDeviceResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.clientId !== clientId) {
    throw new HostedDeviceManagementError('Invalid sync device revoke response', 'invalid-response');
  }
  return {
    clientId: parsed.data.clientId,
    requiresKeyRotation: parsed.data.requiresKeyRotation,
  };
}

/**
 * Run a revoke with the exact authenticated session the user confirmed.
 *
 * The caller captures `auth` before opening a confirmation dialog. This
 * function refuses to send the request if that binding has changed while the
 * dialog was open, and never swaps in a newer token after the request starts.
 * A network error after a DELETE is inherently ambiguous: retry once with the
 * same token. If the retry is rejected, report `ambiguous` so the caller can
 * fence local credentials without claiming that the UI observed a success.
 */
export async function revokeHostedSyncDeviceBound(options: {
  readonly auth: HostedSyncAuthSnapshot;
  readonly clientId: string;
  readonly readCurrentAuth: () => HostedSyncAuthSnapshot | undefined;
  readonly fetchImpl?: typeof fetch;
}): Promise<BoundHostedDeviceRevocation> {
  if (!hostedSyncAuthMatches(options.readCurrentAuth(), options.auth)) {
    throw new HostedDeviceManagementError(
      'The authenticated session changed before device revocation',
      'session-changed',
    );
  }

  const requestOptions: HostedDeviceManagementOptions = {
    baseUrl: options.auth.baseUrl,
    getToken: async () => options.auth.token,
    fetchImpl: options.fetchImpl,
  };
  let revocation: HostedDeviceRevocation;
  try {
    revocation = await revokeHostedSyncDevice(requestOptions, options.clientId);
  } catch (error) {
    // A malformed success body (including a different clientId) is not a
    // verified success. It also cannot undo a DELETE the server already
    // committed. Treat it like a lost response and keep the original binding.
    if (!(error instanceof HostedDeviceManagementError) ||
        (error.code !== 'request-failed' && error.code !== 'invalid-response')) throw error;
    try {
      revocation = await revokeHostedSyncDevice(requestOptions, options.clientId);
    } catch (retryError) {
      // Once the first request has lost its response, a second failure cannot
      // prove that the server did not commit the DELETE.  Fence the bound
      // local session for every retry failure, including a second network
      // failure or a malformed/non-2xx response.  Throwing here would leave
      // the old root and credentials live precisely in the ambiguous case.
      if (retryError instanceof HostedDeviceManagementError &&
          retryError.code !== 'session-changed' &&
          retryError.code !== 'invalid-client-id') {
        return {
          status: 'ambiguous',
          authStillCurrent: hostedSyncAuthMatches(options.readCurrentAuth(), options.auth),
        };
      }
      throw retryError;
    }
  }
  return {
    status: 'committed',
    revocation,
    authStillCurrent: hostedSyncAuthMatches(options.readCurrentAuth(), options.auth),
  };
}

/**
 * Shared device-revocation orchestration for Web and mobile hosts.
 *
 * The UI supplies only platform storage/session ports. Auth binding, retry on
 * response loss, guidance-before-cleanup ordering, and the rule that a newer
 * session must never be cleared live in this host-agnostic action.
 */
export async function runHostedDeviceRevocation(
  options: HostedDeviceRevocationControllerOptions,
): Promise<BoundHostedDeviceRevocation> {
  const outcome = await revokeHostedSyncDeviceBound({
    auth: options.auth,
    clientId: options.clientId,
    readCurrentAuth: options.readCurrentAuth,
    fetchImpl: options.fetchImpl,
  });
  try {
    await options.persistRotationGuidance();
  } finally {
    // Guidance persistence is useful recovery state, but it can never block
    // the authentication fence after the server has accepted (or ambiguously
    // may have accepted) the revoke.
    if (outcome.authStillCurrent && hostedSyncAuthMatches(options.readCurrentAuth(), options.auth)) {
      await options.clearCurrentSession();
    }
  }
  // The session may have changed while the non-secret guidance was being
  // written. Reflect the final check so a host cannot mistake a skipped
  // cleanup for a currently bound session.
  if (outcome.authStillCurrent && !hostedSyncAuthMatches(options.readCurrentAuth(), options.auth)) {
    return { ...outcome, authStillCurrent: false };
  }
  return outcome;
}
