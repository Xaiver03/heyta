/**
 * 判据：转让失败的**具名错误**在宿主侧要落进哪一类（B-10 收口）。
 *
 * 为什么值得单写：服务端那道门（接收方手里没有当前世代的清单钥 ⇒ 409
 * `SHARE_TRANSFER_TARGET_UNSEALED`）先前在宿主侧**没有任何消费者** —— 外壳发转让请求时
 * 没有 catch，Promise 直接变成未处理拒绝，用户按了「确认转让」之后什么也不会发生。
 * 面板把不合格的接收方灰掉只是**第一层**；面板数据落后一拍（例如 owner 刚换过钥）时
 * 仍会打到服务端，那一发必须有话。
 *
 * 🔴 两头对账那一臂管的是"抄件会不会漂"：本模块写死的码值必须等于 sync-client
 * 真正上线的那枚常量。改线上契约的人不会想起来改这里，所以让测试去想起来。
 */
import { describe, expect, it } from 'vitest';

import { SHARE_ERROR_CODES } from '@heyta/sync-client';

import {
  SHARE_TRANSFER_TARGET_UNSEALED_CODE,
  shareTransferFailure,
} from '../src/share-transfer-error.js';

describe('shareTransferFailure · 转让失败分类（B-10）', () => {
  it('409 + 具名码 ⇒ target-unsealed（这一类要给"等待授权"那句，不给裸码）', () => {
    expect(
      shareTransferFailure({ status: 409, code: 'SHARE_TRANSFER_TARGET_UNSEALED' }),
    ).toBe('target-unsealed');
  });

  it('同为 409 但别的具名码 ⇒ other（不许把别的冲突也解释成"对方没解锁"）', () => {
    expect(shareTransferFailure({ status: 409, code: 'SHARE_ROLE_FORBIDDEN' })).toBe('other');
  });

  it('同一个码但状态不是 409 ⇒ other（分类看的是这一对，不是单看码）', () => {
    expect(shareTransferFailure({ status: 403, code: 'SHARE_TRANSFER_TARGET_UNSEALED' })).toBe('other');
  });

  it('拿不到 status/code（网络失败、非 ShareApiError）⇒ other，不抛', () => {
    expect(shareTransferFailure({})).toBe('other');
    expect(shareTransferFailure({ status: undefined, code: undefined })).toBe('other');
  });

  it('两头对账：本模块写死的码值 == sync-client 上线的那枚常量', () => {
    expect(SHARE_TRANSFER_TARGET_UNSEALED_CODE).toBe(SHARE_ERROR_CODES.TRANSFER_TARGET_UNSEALED);
  });
});
