/** Real product mint in isolated PostgreSQL; generated credentials only. */
import { randomBytes } from 'node:crypto';
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.DATABASE_URL = process.env.HEYTA_CENTRAL_TEST_DATABASE_URL;
const { centralSessionIssuer } = await import('../../src/central-auth/session-issuer');
export const sessionIssuer = centralSessionIssuer();
