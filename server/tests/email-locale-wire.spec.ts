import { createServer, Server, Socket } from 'node:net';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🔴 账号语言 → 英文邮件的**线上**端到端（docs/plans/i18n-multilingual.md §7.14 边界④）
 *
 * 这批文件里原有的邮件用例各自证明了一半，但**没有一条把两半接起来**：
 *
 * - `account-locale.spec.ts` 把 `auth.ts` 整个 mock 掉 ⇒ 只证"路由选出了 `en`"，
 *   选出来之后发生了什么它一概不知。
 * - `email.spec.ts` 把 `createTransport` 换成假对象 ⇒ 只证"传给 transport 的字段对"，
 *   从未真的建过连接。
 *
 * 于是"账号语言是 en 的人**真的收到英文信**"这件事，一直停在推断层。
 * 这里把它跑到线上：真 `nodemailer` transport → 真 SMTP 会话 → **落件的原始字节**。
 *
 * ## 收件器是本机回环上的最小 SMTP 服务器，不是 mock
 *
 * 零新依赖（只用 `node:net`）、只监听 `127.0.0.1`、随机端口、**不外发任何一封信**
 * （收件地址一律用 RFC 2606 保留域 `example.com`，即使探针写坏了也到不了真人）。
 * 但它会真的走完 EHLO / MAIL FROM / RCPT TO / DATA，并把 DATA 里的字节原样交出来 ——
 * 那就是 nodemailer 真的认为"这封信发出去了"的证据（`250 OK: queued`）。
 *
 * ## 判据的形状：en 与 zh 互为对照
 *
 * 单向断言（"是英文"）会让"永远发中文"和"永远发英文"两种实现里只红一个。
 * 所以每个用例同时钉正向词（该出现的语言）**和**反向词（另一种语言的那个 key），
 * 再叠一条"英文件正文里 CJK 字符数必须为 0"。任何一层把语言丢掉（路由查了不用、
 * `localeForEmail` 优先级写反、渲染时丢了 locale、`withLocale` 没写进链接），
 * 都至少让一条转红。变异验证见 §7.14。
 */

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), updateMany: vi.fn() },
}));

vi.mock('../src/db', () => ({ prisma: { user: mocks.user } }));

// setup.ts 把 `../src/auth` 整个 mock 掉了；这一条要的**就是**它的真实现 ——
// 发信动作在里面（`requestLoginMagicLink` → `sendLoginMagicLinkEmail`）。
vi.mock('../src/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
}));

import { apiRoutes } from '../src/api';
import { PRODUCT_NAME } from '../src/config';
import { t } from '../src/design-html.js';
import { __resetMailTransporterForTests } from '../src/email';

// 🔴 `getJwtSecret()` 跑在 `../src/auth` 的**模块顶层** ⇒ 令牌相关 import 一加载就要读它。
//    开发机上有 `server/.env` 兜着，而**干净检出（CI 的唯一形态）没有** —— 于是这文件不是断言失败，
//    是加载期就红。约定同 `password-recovery.spec.ts` / `magic-link-registration.spec.ts`：
//    用 `vi.hoisted` 在所有 import 之前把测试密钥放好，`??=` 保证自己显式设过值的文件不被覆盖。
vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-long-enough-for-validation';
});

// ── 最小 SMTP 收件器 ────────────────────────────────────────────────────

interface Captured {
  from: string;
  rcpt: string[];
  raw: string;
}

function startSmtpSink(): Promise<{
  server: Server;
  captured: () => Captured[];
  drain: () => void;
}> {
  const mails: Captured[] = [];

  const server = createServer((sock: Socket) => {
    const mail: Captured = { from: '', rcpt: [], raw: '' };
    let inData = false;
    let buffer = '';
    sock.setNoDelay(true);
    sock.write('220 heyta-smtp-sink ESMTP\r\n');

    sock.on('data', (chunk) => {
      if (inData) {
        mail.raw += chunk.toString('utf8');
        if (mail.raw.endsWith('\r\n.\r\n')) {
          inData = false;
          mail.raw = mail.raw.slice(0, -5); // 去掉终止符
          mails.push(mail);
          sock.write('250 OK: queued\r\n');
        }
        return;
      }

      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        const up = line.toUpperCase();
        if (up.startsWith('EHLO') || up.startsWith('HELO')) {
          sock.write('250-heyta-smtp-sink\r\n250 SMTPUTF8\r\n');
        } else if (up.startsWith('MAIL FROM')) {
          mail.from = line;
          sock.write('250 OK\r\n');
        } else if (up.startsWith('RCPT TO')) {
          mail.rcpt.push(line);
          sock.write('250 OK\r\n');
        } else if (up === 'DATA') {
          inData = true;
          sock.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (up === 'QUIT') {
          sock.write('221 Bye\r\n');
          sock.end();
        } else {
          // RSET / NOOP / 未知命令：收件器不解释协议细节，只保证把 DATA 收全。
          sock.write('250 OK\r\n');
        }
      }
    });
    sock.on('error', () => undefined);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        captured: () => mails,
        // 每条用例开头清空：否则上一条的落件会混进这一条的"只发了一封"判据。
        drain: () => {
          mails.length = 0;
        },
      }),
    );
  });
}

// ── 落件字节的解码（只解到"用户会读到的文本"这一层）─────────────────────

const CJK = /[㐀-䶿一-鿿豈-﫿]/g;

function decodeQuotedPrintable(value: string): string {
  const soft = value.replace(/=\r?\n/g, '');
  const bytes = soft.replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  // quoted-printable 解出来是**字节**（latin1 一字符一字节），必须再按 UTF-8 读，
  // 否则中文变成两三个乱码字符，CJK 计数直接归零 —— 判据会以"通过"的方式失效。
  return Buffer.from(bytes, 'binary').toString('utf8');
}

function decodeCte(value: string, cte: string): string {
  const enc = cte.toLowerCase();
  if (enc === 'base64') return Buffer.from(value.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (enc.startsWith('quoted-printable')) return decodeQuotedPrintable(value);
  return value;
}

/** `=?utf-8?B?...?=` / `=?utf-8?Q?...?=`（主题的中文形态就是它）。 */
function decodeEncodedWords(line: string): string {
  return line.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset, enc, data) => {
    if (enc.toUpperCase() === 'B') {
      return Buffer.from(data, 'base64').toString(
        charset.toLowerCase() === 'utf-8' ? 'utf8' : 'binary',
      );
    }
    const raw = data.replace(/_/g, ' ');
    const bytes = raw.replace(/=([0-9A-Fa-f]{2})/g, (_x, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
    return Buffer.from(bytes, 'binary').toString(charset.toLowerCase() === 'utf-8' ? 'utf8' : 'binary');
  });
}

/**
 * 折行还原（RFC 5322：续行以空格/制表符开头）。
 *
 * 🔴 不折行这条判据会**假失败**：nodemailer 把 `Content-Type: multipart/alternative;`
 * 和 `boundary="…"` 写在**两行**上，只按行取头部就只剩 `multipart/alternative;`，
 * boundary 拿不到 ⇒ 整封信被当成一个 part ⇒ "text 与 html 两个 part 都在"永远红。
 */
function unfold(block: string): string {
  return block.replace(/\r?\n[ \t]+/g, ' ');
}

interface DecodedPart {
  type: string;
  text: string;
}

/** 把落件拆成 part 并解码 CTE（multipart/alternative ⇒ 纯文本版 + HTML 版）。 */
function decodeParts(raw: string): DecodedPart[] {
  const headerEnd = raw.indexOf('\r\n\r\n');
  const headerBlock = unfold(raw.slice(0, headerEnd));
  const bodyBlock = raw.slice(headerEnd + 4);

  const contentType = /^content-type:\s*(.*)$/im.exec(headerBlock)?.[1] ?? '';
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(contentType);
  const chunks = boundary
    ? bodyBlock.split(new RegExp(`--${boundary[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    : [bodyBlock];

  const parts: DecodedPart[] = [];
  for (const chunk of chunks) {
    if (!chunk.trim() || chunk.trim() === '--') continue;
    const split = chunk.indexOf('\r\n\r\n');
    if (split < 0) continue;
    const partHeaders = chunk.slice(0, split);
    const cte = /^content-transfer-encoding:\s*(.+)$/im.exec(partHeaders)?.[1]?.trim() ?? '7bit';
    const typeMatch = /^content-type:\s*([^;\r\n]+)/im.exec(partHeaders);
    const type = typeMatch ? typeMatch[1].trim().toLowerCase() : 'text/plain';
    parts.push({ type, text: decodeCte(chunk.slice(split + 4), cte) });
  }
  return parts;
}

interface DecodedMail {
  subject: string;
  from: string;
  to: string[];
  /** 所有 part 解码后拼接（纯文本版 + HTML 版）。 */
  text: string;
  parts: DecodedPart[];
}

function decodeMail(raw: string): DecodedMail {
  const headerEnd = raw.indexOf('\r\n\r\n');

  const headers = new Map<string, string[]>();
  for (const line of unfold(raw.slice(0, headerEnd)).split(/\r?\n/)) {
    const match = /^([^\s:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const list = headers.get(key) ?? [];
    list.push(match[2]);
    headers.set(key, list);
  }

  const parts = decodeParts(raw);
  return {
    subject: decodeEncodedWords(headers.get('subject')?.[0] ?? ''),
    from: decodeEncodedWords(headers.get('from')?.[0] ?? ''),
    to: headers.get('to') ?? [],
    text: parts.map((p) => p.text).join('\n'),
    parts,
  };
}

// ── 用例 ────────────────────────────────────────────────────────────────

const SINK = await startSmtpSink();
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = String((SINK.server.address() as { port: number }).port);
process.env.SMTP_SECURE = 'false';
process.env.SMTP_FROM = `"${PRODUCT_NAME}" <noreply@heyta.test>`;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  // 清空上一封的落件：不排空，"这一条只发了一封"的判据会被上一条污染。
  SINK.drain();
  mocks.user.updateMany.mockResolvedValue({ count: 1 });
  __resetMailTransporterForTests();

  app = Fastify();
  await app.register(apiRoutes, { prefix: '/api' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

afterAll(() => {
  SINK.server.close();
});

/** 发一次并等收件器把 DATA 收完（真网络往返，不是同步的 mock 调用）。 */
async function request(
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<DecodedMail> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/login/magic-link',
    payload,
    headers: { 'accept-language': 'zh-CN,zh;q=0.9', ...headers },
  });
  expect(res.statusCode).toBe(200);

  await expect
    .poll(() => SINK.captured().length, { timeout: 5_000, message: 'SMTP 收件器没收到这封信' })
    .toBe(1);
  return decodeMail(SINK.captured()[0].raw);
}

const accountRow = (locale: string | null) => ({
  id: 1,
  email: 'polyglot@example.com',
  locale,
  isVerified: 1,
  loginToken: null,
  loginTokenExpiresAt: null,
});

describe('账号语言 → 邮件语言：真 SMTP 线上落件的字节', () => {
  it('账号 locale=en ⇒ 落件是英文，且**一个 CJK 字符都没有**', async () => {
    mocks.user.findUnique.mockResolvedValue(accountRow('en'));
    const mail = await request({ email: 'polyglot@example.com' });

    expect(mail.subject).toContain(t('en', 'server.email.login.subject'));
    expect(mail.text).toContain(t('en', 'server.email.login.title'));
    expect(mail.text).not.toContain(t('zh-CN', 'server.email.login.title'));
    expect(mail.text.match(CJK)).toBeNull();
    expect(mail.subject.match(CJK)).toBeNull();
  });

  it('🔴 对照组：账号 locale=zh-CN ⇒ 同一路由落件是中文（证明语言不是常量）', async () => {
    mocks.user.findUnique.mockResolvedValue(accountRow('zh-CN'));
    const mail = await request({ email: 'polyglot@example.com' });

    expect(mail.text).toContain(t('zh-CN', 'server.email.login.title'));
    expect(mail.text.match(CJK)).not.toBeNull();
    expect(mail.subject).toContain(t('zh-CN', 'server.email.login.subject'));
  });

  it('英文信的链接带 ?lang=en（收件人在英文系统里点开也还是英文）', async () => {
    mocks.user.findUnique.mockResolvedValue(accountRow('en'));
    const mail = await request({ email: 'polyglot@example.com' });

    expect(mail.text).toContain('lang=en');
    expect(mail.text).not.toContain('lang=zh-CN');
  });

  it('body.locale=en 压过账号的 zh-CN —— 优先级在**线上**同样成立', async () => {
    mocks.user.findUnique.mockResolvedValue(accountRow('zh-CN'));
    const mail = await request({ email: 'polyglot@example.com', locale: 'en' });

    expect(mail.text.match(CJK)).toBeNull();
    expect(mail.text).toContain('lang=en');
  });

  it('账号没存语言时按 Accept-Language（en-US 浏览器 ⇒ 英文件）', async () => {
    mocks.user.findUnique.mockResolvedValue(accountRow(null));
    const mail = await request({ email: 'polyglot@example.com' }, { 'accept-language': 'en-US,en;q=0.9' });

    expect(mail.text.match(CJK)).toBeNull();
  });

  it('信封本身对：真连上了、RCPT TO 是收件人、text 与 html 两个 part 都在', async () => {
    mocks.user.findUnique.mockResolvedValue(accountRow('en'));
    const mail = await request({ email: 'polyglot@example.com' });

    expect(SINK.captured()).toHaveLength(1);
    expect(SINK.captured()[0].rcpt.join('')).toContain('<polyglot@example.com>');
    expect(mail.from).toContain('noreply@heyta.test');
    expect(mail.parts.map((p) => p.type)).toContain('text/plain');
    expect(mail.parts.some((p) => p.type.startsWith('text/html'))).toBe(true);
    // 纯文本版同样本地化（只本地化 HTML 是最常见的漏法）：`mail.text` 是两个 part
    // 拼起来的，所以单独取纯文本 part 再断言一次。
    const plainPart = decodeParts(SINK.captured()[0].raw).find((p) => p.type === 'text/plain');
    expect(plainPart?.text).toContain(t('en', 'server.email.login.body'));
  });
});
