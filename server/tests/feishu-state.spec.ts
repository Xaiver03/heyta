import { describe, expect, it } from 'vitest';

import {
  createState,
  readCookie,
  sanitizeLanding,
  serializeCookie,
  verifyState,
} from '../src/feishu/feishu-state';

const SECRET = 'a'.repeat(48);

describe('feishu-state · 签名与校验', () => {
  it('往返：createState → verifyState 得到同一 payload + 同一 nonce', () => {
    const { state, nonce } = createState({ scope: 'admin', redirectPath: '/admin' }, SECRET, 1000);
    const payload = verifyState(state, SECRET, 1000);
    expect(payload).not.toBeNull();
    expect(payload!.scope).toBe('admin');
    expect(payload!.redirectPath).toBe('/admin');
    expect(payload!.nonce).toBe(nonce);
  });

  it('签名被篡改 ⇒ null', () => {
    const { state } = createState({ scope: 'app', redirectPath: '/app/' }, SECRET, 1000);
    expect(verifyState(state, 'b'.repeat(48), 1000)).toBeNull();
    expect(verifyState(state.slice(0, -2) + 'xx', SECRET, 1000)).toBeNull();
  });

  it('过期 ⇒ null', () => {
    const { state } = createState({ scope: 'app', redirectPath: '/app/' }, SECRET, 1000);
    // 越过 10 分钟 TTL。
    expect(verifyState(state, SECRET, 1000 + 11 * 60 * 1000)).toBeNull();
  });

  it('形状不符的串 ⇒ null（不抛）', () => {
    expect(verifyState('', SECRET)).toBeNull();
    expect(verifyState('not-a-state', SECRET)).toBeNull();
  });
});

describe('feishu-state · sanitizeLanding', () => {
  it('接受站内绝对路径', () => {
    expect(sanitizeLanding('/app/', '/fallback')).toBe('/app/');
    expect(sanitizeLanding('/admin', '/fallback')).toBe('/admin');
  });
  it('拒绝 open redirect（//host、/\\host、控制字符）', () => {
    expect(sanitizeLanding('//evil.com', '/fallback')).toBe('/fallback');
    expect(sanitizeLanding('/\\evil.com', '/fallback')).toBe('/fallback');
    expect(sanitizeLanding('https://evil.com', '/fallback')).toBe('/fallback');
    expect(sanitizeLanding('/a\nb', '/fallback')).toBe('/fallback');
    expect(sanitizeLanding(undefined, '/fallback')).toBe('/fallback');
  });
});

describe('feishu-state · cookie 工具', () => {
  it('readCookie 取出指定键并解码', () => {
    expect(readCookie('a=1; heyta_feishu_state=abc%2Fdef; b=2', 'heyta_feishu_state')).toBe('abc/def');
    expect(readCookie(undefined, 'heyta_feishu_state')).toBeNull();
    expect(readCookie('x=1', 'heyta_feishu_state')).toBeNull();
  });

  it('serializeCookie 带上 HttpOnly / SameSite / Max-Age / Secure', () => {
    const header = serializeCookie('k', 'v', { maxAgeSeconds: 600, secure: true });
    expect(header).toContain('k=v');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Max-Age=600');
    expect(header).toContain('Secure');
  });
});
