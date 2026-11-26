/**
 * `useShareMembers` —— 读一个共享清单的成员名册（只读）
 * =====================================================
 *
 * 用途：#15「委派 UI」在任务详情面板里渲染「指派」入口时，要知道这个共享清单里
 * 有哪些成员可以指派。名册的唯一事实源是服务端（`ShareApiClient.listMembers`），
 * 与 `ShareFeature` / `JoinSharedListDialog` 用的是**同一个构造法**
 * （`ShareApiClient` + `createWebAuthFetch`）。
 *
 * 🔴 这里**只读**，不发任何写。写指派仍然走既有的
 * `patchDetails(assigneeUserId)` 动作路径（`features/tasks/store.ts#setAssignee`
 * → `app-host` 的 `TaskActions.patchDetails`），本 hook 不造第二条写路径。
 *
 * 🔴 **缺失即降级为空**：个人清单（无 `shareId`）、未配置服务端、取数失败，
 * 一律返回空数组而不是抛错 —— 详情面板不该因为名册取不到而白屏。
 * 「没有成员可选」与「取数失败」在界面上都表现为只剩「未指派」，这是可接受的
 * 降级（指派本身在共享清单之外没有意义）。
 */

import { useEffect, useMemo, useState } from 'react';

import { ShareApiClient } from '@heyta/sync-client';

import { useSyncStore } from '../sync/store.js';
import { createWebAuthFetch } from '../../lib/auth-fetch.js';

/** 一行可指派的成员。`userId` 就是写进 `Task.assigneeUserId` 的那个值（字符串化）。 */
export interface ShareMemberOption {
  /** 成员行 id（服务端名册的主键，仅用于 React key）。 */
  memberId: string;
  /** 账号 id（`Task.assigneeUserId` 的取值；服务端 `userId` 字符串化）。 */
  userId: string;
  /** 角色（`owner` / `editor` / `commenter` …）；本格只展示不解释。 */
  role: string;
}

/**
 * 给定 `shareId` 返回成员名册。`shareId` 为 `undefined`（个人清单）⇒ 空数组。
 *
 * ⚠️ 请求生命周期挂在 `[api, shareId]` 上：切到另一条任务时若它属于**同一个**
 * 共享清单（`shareId` 不变），名册不会重复拉取；所属清单变了才重取。
 */
export function useShareMembers(shareId: string | undefined): readonly ShareMemberOption[] {
  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);
  const authTransport = useSyncStore((s) => s.authTransport);
  const [members, setMembers] = useState<readonly ShareMemberOption[]>([]);

  const api = useMemo(() => {
    if (shareId === undefined || shareId === '') return undefined;
    if (baseUrl.trim() === '' || token === undefined || token.trim() === '') return undefined;
    return new ShareApiClient({
      baseUrl,
      getToken: () => token,
      authTransport,
      fetchImpl: createWebAuthFetch(baseUrl, authTransport),
    });
  }, [authTransport, baseUrl, shareId, token]);

  useEffect(() => {
    if (api === undefined || shareId === undefined || shareId === '') {
      setMembers([]);
      return undefined;
    }
    let alive = true;
    void api
      .listMembers(shareId)
      .then((result) => {
        if (!alive) return;
        setMembers(
          result.members.map((m) => ({
            memberId: m.memberId,
            userId: String(m.userId),
            role: m.role,
          })),
        );
      })
      .catch(() => {
        if (alive) setMembers([]);
      });
    return () => {
      alive = false;
    };
  }, [api, shareId]);

  return members;
}
