import { describe, expect, it } from 'vitest';

import { buildShareJoinLink, parseShareJoinLink } from '../src/sync/share-link';

describe('share join link（W6 骨架：链接 = 凭证，不含密钥）', () => {
  const BASE = 'https://app.example';
  const TOKEN = 'inv-token-abc123';

  it('build：拼出 /share/join?token=…，baseUrl 尾斜杠容忍', () => {
    expect(buildShareJoinLink(BASE, TOKEN)).toBe(`${BASE}/share/join?token=${TOKEN}`);
    expect(buildShareJoinLink(`${BASE}/`, TOKEN)).toBe(`${BASE}/share/join?token=${TOKEN}`);
  });

  it('parse：链接里取回 token；异路径/无 token ⇒ undefined', () => {
    expect(parseShareJoinLink(`${BASE}/share/join?token=${TOKEN}`)).toBe(TOKEN);
    expect(parseShareJoinLink(`${BASE}/tasks?token=${TOKEN}`)).toBeUndefined();
    expect(parseShareJoinLink(`${BASE}/share/join`)).toBeUndefined();
    expect(parseShareJoinLink('not a url')).toBeUndefined();
  });

  it('build→parse 圆环：token 含特殊字符也保真（encodeURIComponent）', () => {
    const tricky = 'a+b/c=d';
    const round = parseShareJoinLink(buildShareJoinLink(BASE, tricky));
    expect(round).toBe(tricky);
  });
});
