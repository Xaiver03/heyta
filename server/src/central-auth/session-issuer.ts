/** Trusted server factory; never accepts browser-provided user/session identity. */
import { issueSession } from '../auth';
import { newJti, sessionIdOf, type SessionMeta } from '../account/access-sessions';
import type { CentralSessionIssuer } from './repository';
export function centralSessionIssuer(): CentralSessionIssuer {
  return async (tx, userId, expiresAt, meta: SessionMeta = {}) => {
    const metadata = Object.freeze({ ...meta });
    const jti = newJti();
    const token = await issueSession({ id: userId }, metadata, { tx, jti, expiresAt });
    return { token, sessionHash: sessionIdOf(jti) };
  };
}
