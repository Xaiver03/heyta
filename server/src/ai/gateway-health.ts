/**
 * 上游**健康/计量**（进程内、有界）。给网关选择与后台展示用。
 *
 * 不落库、不进日志：这是"此刻哪条上游还活着"的运行态，重启重来即可（同熔断口径）。
 * 判据（可转红）：连续失败达阈值 → 冷却期内判为不可用，选择时跳过；一次成功即复位。
 */
export interface UpstreamHealth {
  consecutiveFails: number;
  lastOkAt: number | null;
  lastFailAt: number | null;
  totalOk: number;
  totalFail: number;
}

const HEALTH = new Map<string, UpstreamHealth>();
const FAIL_THRESHOLD = 3;
const COOLDOWN_MS = 30_000;

export function recordUpstreamResult(id: string, ok: boolean, now: number = Date.now()): void {
  const h = HEALTH.get(id) ?? { consecutiveFails: 0, lastOkAt: null, lastFailAt: null, totalOk: 0, totalFail: 0 };
  if (ok) {
    h.consecutiveFails = 0;
    h.lastOkAt = now;
    h.totalOk += 1;
  } else {
    h.consecutiveFails += 1;
    h.lastFailAt = now;
    h.totalFail += 1;
  }
  HEALTH.set(id, h);
}

/** 是否可用：连续失败未达阈值即可用；达阈值则在冷却窗内跳过。 */
export function isUpstreamAvailable(id: string, now: number = Date.now()): boolean {
  const h = HEALTH.get(id);
  if (h === undefined) return true;
  if (h.consecutiveFails < FAIL_THRESHOLD) return true;
  const last = h.lastFailAt ?? 0;
  return now - last >= COOLDOWN_MS;
}

export function upstreamHealthSnapshot(id: string): UpstreamHealth {
  return HEALTH.get(id) ?? { consecutiveFails: 0, lastOkAt: null, lastFailAt: null, totalOk: 0, totalFail: 0 };
}

/** 仅供测试：清空。 */
export function __resetGatewayHealthForTests(): void {
  HEALTH.clear();
}
