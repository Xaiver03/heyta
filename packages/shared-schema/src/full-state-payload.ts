/** Versioned encrypted payload for heyta's causal maintenance snapshots. */
export interface HeytaFullStatePayload<TState = unknown> {
  isFullState: true;
  heytaStateVersion: 1;
  state: TState;
  repairBaseServerSeq: number;
}

/** Envelope validation; the reducer owns validation of the serialized state. */
export function isHeytaFullStatePayload(value: unknown): value is HeytaFullStatePayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Partial<HeytaFullStatePayload>;
  return payload.isFullState === true && payload.heytaStateVersion === 1 &&
    payload.state !== null && typeof payload.state === 'object' &&
    Number.isSafeInteger(payload.repairBaseServerSeq) && (payload.repairBaseServerSeq ?? -1) >= 0;
}
