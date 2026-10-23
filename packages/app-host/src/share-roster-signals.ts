/**
 * 共享清单「成员面变了」信号的判断本体（ADR-0070）。
 *
 * 服务端在成员/邀请/信封/签名公钥这九条写路径上发一条 `share_roster_changed`，
 * 只带 `shareId`（不带名单 —— 它看不到明文，也不该替我们记名册水位）。
 * **要不要重取、什么时候只取一次**，是这里的判断，不是外壳的判断（AGENTS §3.5）。
 *
 * 🔴 为什么"接受邀请"会在几十毫秒内换来两条信号：那条路径写完成员行，
 * 新成员紧接着自证签名公钥（ADR-0069 裁决二），两条都是成员面变化。
 * 按信号条数记账的话，面板会为一次人类操作连打两次 GET ——
 * 所以这一族的合并单位是**在途的那一次重取**，不是时间窗。
 *
 * 形状与 `share-signals.ts` 刻意对齐：同样的 `knownShareIds` 必填闸门
 * （那里拦的是"刚入群那台设备索引为空"，同一格事故在 M2 收尾时被抓过），
 * 同样不把 `refresh` 的异常抛穿 —— 信号面炸了不许把调用方一起带下去。
 */

export interface ShareRosterSignalReading {
  readonly shareId: string;
  /** 这台设备认不认得这份 share（不认得 ⇒ 零请求）。 */
  readonly knownLocally: boolean;
  /** 这一次调用**启动**了重取。 */
  readonly refreshed: boolean;
  /** 这一次调用没有启动重取，而是并进了在途那一次的尾巴（结束后还会再取一次）。 */
  readonly coalesced: boolean;
  /** 重取失败过（含尾巴那一次）。读数留在这里，不抛穿。 */
  readonly failed: boolean;
}

export interface ShareRosterSignalPorts {
  /**
   * 这台设备绑定着的 shareId 名单。🔴 必填：可选就会退回"谁发信号我都重取"，
   * 那等于让服务端（它不该知道本机装了哪些清单）替本机决定取什么。
   */
  readonly knownShareIds: () => readonly string[];
  /** 真正的重取（外壳把面板的 reload 递进来）。允许抛，这里兜住。 */
  readonly refresh: (shareId: string) => Promise<void>;
}

export interface ShareRosterSignalHandler {
  /** 收到一条 `share_roster_changed`。返回读数，永不抛穿。 */
  onRosterSignal(shareId: string): Promise<ShareRosterSignalReading>;
}

export function createShareRosterSignalHandler(
  ports: ShareRosterSignalPorts,
): ShareRosterSignalHandler {
  /** 在途重取结束的尾巴：`shareId → 还需要再来一次`。 */
  const trailing = new Set<string>();
  const inFlight = new Set<string>();
  const failed = new Set<string>();

  const runRefresh = async (shareId: string): Promise<void> => {
    try {
      await ports.refresh(shareId);
      failed.delete(shareId);
    } catch {
      // 一次成员面重取失败不等于信号没处理过 —— 留个读数，尾巴照跑。
      failed.add(shareId);
    } finally {
      inFlight.delete(shareId);
      if (trailing.has(shareId)) {
        trailing.delete(shareId);
        await runRefresh(shareId);
      }
    }
  };

  return {
    onRosterSignal: async (shareId) => {
      if (!ports.knownShareIds().includes(shareId)) {
        return { shareId, knownLocally: false, refreshed: false, coalesced: false, failed: false };
      }
      if (inFlight.has(shareId)) {
        trailing.add(shareId);
        return { shareId, knownLocally: true, refreshed: false, coalesced: true, failed: failed.has(shareId) };
      }
      inFlight.add(shareId);
      await runRefresh(shareId);
      return {
        shareId,
        knownLocally: true,
        refreshed: true,
        coalesced: false,
        failed: failed.has(shareId),
      };
    },
  };
}
