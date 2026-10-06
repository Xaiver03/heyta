import type { MaterializedCheckpoint } from './op-log-store.js';

/**
 * Deterministic integrity tag for a materialized checkpoint.
 *
 * This intentionally is not a cryptographic MAC: the checkpoint is a local
 * acceleration cache, while the op-log remains the source of truth.  It is
 * only meant to detect torn writes, truncation, and incompatible payloads
 * before a caller uses the checkpoint as a replay boundary.
 */
export function checkpointChecksum(
  checkpoint: Omit<MaterializedCheckpoint, 'checksum'>,
): string {
  const input = JSON.stringify(checkpoint);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Structural and checksum validation shared by recovery and archiving. */
export function isValidCheckpoint(
  checkpoint: unknown,
  lastLocalSeq: number,
): checkpoint is MaterializedCheckpoint {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return false;
  const candidate = checkpoint as MaterializedCheckpoint;
  if (candidate.formatVersion !== 1) return false;
  if (!Number.isInteger(candidate.coveredSeq) || candidate.coveredSeq < 0) return false;
  if (candidate.coveredSeq > lastLocalSeq) return false;
  if (candidate.state === undefined || candidate.state === null) return false;
  if (candidate.clock === null || typeof candidate.clock !== 'object') return false;
  if (Array.isArray(candidate.clock) || Object.values(candidate.clock).some(
    (counter) => !Number.isSafeInteger(counter) || counter < 0)) return false;
  if (!Array.isArray(candidate.appliedOpIds) || candidate.appliedOpIds.some((id) => typeof id !== 'string')) return false;
  if (typeof candidate.checksum !== 'string' || candidate.checksum.length === 0) return false;

  const { checksum, ...base } = candidate;
  return checksum === checkpointChecksum(base);
}
