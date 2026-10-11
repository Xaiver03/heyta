import { describe, expect, it } from 'vitest';

import { buildShareJoinLink, parseShareJoinLink } from '../src/sync/share-link';

describe('share join link（W6：链接落点是应用，= 凭证载体，不含密钥）', () => {
  const BASE = 'https://app.example';
  const TOKEN = 'inv-token-abc123';

  it('build：拼出 {app}?shareToken=…；应用可挂在子路径，尾斜杠归一', () => {
    expect(buildShareJoinLink(BASE, TOKEN)).toBe(`${BASE}/?shareToken=${TOKEN}`);
    expect(buildShareJoinLink(`${BASE}/`, TOKEN)).toBe(`${BASE}/?shareToken=${TOKEN}`);
    expect(buildShareJoinLink(`${BASE}/app/`, TOKEN)).toBe(`${BASE}/app/?shareToken=${TOKEN}`);
    // `/app`（无尾斜杠）也归一到 `/app/`：静态托管少一次 301，查询串不经历跳转链。
    expect(buildShareJoinLink(`${BASE}/app`, TOKEN)).toBe(`${BASE}/app/?shareToken=${TOKEN}`);
  });

  it('build：缺 baseUrl / 缺 token 抛错（凭证链接不许静默降级）', () => {
    expect(() => buildShareJoinLink('', TOKEN)).toThrow();
    expect(() => buildShareJoinLink(BASE, '')).toThrow();
  });

  it('parse：带 shareToken 的 URL 取回 token；无该参数/非 URL ⇒ undefined', () => {
    expect(parseShareJoinLink(`${BASE}/?shareToken=${TOKEN}`)).toBe(TOKEN);
    expect(parseShareJoinLink(`${BASE}/app/?shareToken=${TOKEN}`)).toBe(TOKEN);
    // path 不锁：同一个应用换挂载点仍是我们的链接（share-link.ts 的裁决注释）。
    expect(parseShareJoinLink(`${BASE}/tasks?shareToken=${TOKEN}`)).toBe(TOKEN);
    expect(parseShareJoinLink(`${BASE}/`)).toBeUndefined();
    expect(parseShareJoinLink(`${BASE}/?shareToken=`)).toBeUndefined();
    expect(parseShareJoinLink('not a url')).toBeUndefined();
  });

  it('build→parse 圆环：token 含特殊字符也保真（encodeURIComponent）', () => {
    const tricky = 'a+b/c=d&e';
    const round = parseShareJoinLink(buildShareJoinLink(BASE, tricky));
    expect(round).toBe(tricky);
  });
});
