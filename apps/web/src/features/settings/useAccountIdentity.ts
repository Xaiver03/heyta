/**
 * 共享的账号身份只读投影。
 *
 * 个人中心、头像菜单和个人资料编辑页必须回答同一个问题：当前会话对应的
 * 昵称与头像是什么。资料编辑页仍然拥有写入行为；这个 hook 只负责读取，避免
 * 各个表面各自请求、各自缓存，导致刚保存的身份在另一个入口里仍显示旧值。
 *
 * 账号资料请求始终经过 Web 的隐私同意闸门。账号或口令切换、组件卸载时，
 * AbortController 会终止旧请求；generation 检查仍保留，防止不支持真正取消的
 * fetch 替身或已经完成的 Promise 把旧账号的数据写回当前界面。
 */
import { useEffect, useState } from 'react';

import {
  getAccountProfile,
  resolveAccountAvatarImage,
  type AccountAvatarImage,
} from '@heyta/app-host';
import { avatarInitialFromEmail } from '@heyta/shared-schema';

import {
  consentFetch,
  privacyConsent,
  subscribePrivacyConsent,
} from '../privacy/consent-gate.js';
import { useSyncStore } from '../sync/store.js';

export type AccountIdentityStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Invalidate the mounted overview after a profile write in the settings surface. */
export const ACCOUNT_IDENTITY_CHANGED_EVENT = 'heyta:account-identity-changed';

export function notifyAccountIdentityChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ACCOUNT_IDENTITY_CHANGED_EVENT));
  }
}

export interface AccountIdentity {
  /** 还没登录或资料尚未读到时为 undefined；已读到但用户未设置时为 null。 */
  readonly displayName: string | null | undefined;
  /** 解密成功时存在；其它头像状态必须由调用方按 avatarState 处理。 */
  readonly avatarDataUri: string | undefined;
  readonly avatarState: AccountAvatarImage['state'] | undefined;
  readonly status: AccountIdentityStatus;
  /** 仅供显示兜底，不代表用户保存过头像。 */
  readonly email: string | undefined;
  readonly initial: string | undefined;
}

type ScopedIdentity = Omit<AccountIdentity, 'email' | 'initial'> & { readonly scope: string };

const idleIdentity = (scope: string): ScopedIdentity => ({
  scope,
  displayName: undefined,
  avatarDataUri: undefined,
  avatarState: undefined,
  status: 'idle',
});

function accountScope(baseUrl: string, token: string | undefined): string {
  // The token is intentionally only used as an opaque scope key. It is never
  // returned or rendered; this prevents one account's result being visible with
  // another account's email during the effect hand-off.
  return `${baseUrl}\u0000${token ?? ''}`;
}

export function useAccountIdentity(): AccountIdentity {
  const baseUrl = useSyncStore((state) => state.baseUrl);
  const token = useSyncStore((state) => state.token);
  const password = useSyncStore((state) => state.password);
  const email = useSyncStore((state) => state.email);
  const [consentRevision, setConsentRevision] = useState(0);
  const [profileRevision, setProfileRevision] = useState(0);
  const scope = accountScope(baseUrl, token);
  const [identity, setIdentity] = useState<ScopedIdentity>(() => idleIdentity(scope));

  useEffect(() => subscribePrivacyConsent(() => setConsentRevision((value) => value + 1)), []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onProfileChanged = (): void => setProfileRevision((value) => value + 1);
    window.addEventListener(ACCOUNT_IDENTITY_CHANGED_EVENT, onProfileChanged);
    return () => window.removeEventListener(ACCOUNT_IDENTITY_CHANGED_EVENT, onProfileChanged);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;

    if (
      !privacyConsent.networkAllowed() ||
      baseUrl.trim() === '' ||
      token === undefined ||
      token.trim() === ''
    ) {
      setIdentity(idleIdentity(scope));
      return () => {
        current = false;
        controller.abort();
      };
    }

    setIdentity({
      scope,
      displayName: undefined,
      avatarDataUri: undefined,
      avatarState: undefined,
      status: 'loading',
    });

    void (async () => {
      const options = { baseUrl, fetchImpl: consentFetch, signal: controller.signal };
      const profile = await getAccountProfile(options, token);
      if (!current) return;
      if (!profile.ok) {
        setIdentity({
          scope,
          displayName: undefined,
          avatarDataUri: undefined,
          avatarState: undefined,
          status: 'error',
        });
        return;
      }

      // The profile GET is sufficient to answer the primary identity question.
      // Publish the nickname immediately; avatar decryption is a secondary read.
      setIdentity({
        scope,
        displayName: profile.displayName,
        avatarDataUri: undefined,
        avatarState: undefined,
        status: 'ready',
      });

      const reading = await resolveAccountAvatarImage(
        options,
        token,
        password,
        profile.avatarHash,
      );
      if (!current) return;
      setIdentity((previous) =>
        previous.scope === scope
          ? {
              ...previous,
              avatarDataUri: reading.state === 'ready' ? reading.dataUri : undefined,
              avatarState: reading.state,
            }
          : previous,
      );
    })();

    return () => {
      current = false;
      controller.abort();
    };
  }, [baseUrl, consentRevision, password, profileRevision, scope, token]);

  // Effects run after render. Scope the returned snapshot as well so a new
  // account can never see one frame of the previous account's nickname.
  const visible = identity.scope === scope ? identity : idleIdentity(scope);

  return {
    displayName: visible.displayName,
    avatarDataUri: visible.avatarDataUri,
    avatarState: visible.avatarState,
    status: visible.status,
    email,
    initial: avatarInitialFromEmail(email),
  };
}
