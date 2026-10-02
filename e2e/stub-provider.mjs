/**
 * 确定性假端点：一个最小的 OpenAI 兼容 `/v1/chat/completions`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 为什么门禁**必须**用它，而不是接真模型
 *
 * 本仓库已经有接真端点的验收（`scripts/verify-ai-*-live.mjs`、
 * `apps/web/tests/journey-ai-memory.integration.spec.tsx`）。实测过一次教训：
 * 在有并发负载时，真端点那条旅程测试会**偶发超时**（该测试文件第 310–312 行
 * 自己写明了"单独跑必过、成套并行跑偶发失败"）。
 *
 * 把它当门禁的后果是：**门禁的红绿取决于别人的服务器和本机负载**，
 * 于是"红了"不再意味着"代码坏了"，门禁立刻失去意义 —— 而一个会被忽略的门禁
 * 比没有门禁更糟。
 *
 * 所以这里的取舍是明确的：
 *   * **门禁**用这个假端点 → 确定性、离线、毫秒级、可断言"真的发了请求"
 *   * **真端点验收**继续独立存在，作为"能不能对接真世界"的补充证据，
 *     但**不参与**门禁判定
 *
 * ## 它按什么路由到不同功能
 *
 * 靠**系统提示词的首句**区分（那四句是各功能唯一的、稳定可辨的标识）。
 * 不靠 model 名、不靠 URL —— 那些在配置里是可变的。
 *
 * ## `/__requests` 是给测试用的
 *
 * 门禁要能证明"浏览器里真的发出了网络请求"，而不是组件内部伪造了一个结果。
 * 所以这里记录每次调用的功能名，测试可以读回来自证。
 */
import { createServer } from 'node:http';

const PORT = Number(process.env['STUB_PORT'] ?? 4319);

/** 系统提示词首句 → 功能名。改那四句提示词时必须同步改这里。 */
const ROUTES = [
  ['你是一个任务捕获助手', 'capture'],
  ['你是一个任务拆解助手', 'breakdown'],
  ['你是一个任务优先级排序助手', 'prioritize'],
  ['你是一个任务耗时估计助手', 'duration-estimate'],
];

/** 每次调用的记录，给测试断言用。 */
const calls = [];

/**
 * 各功能的确定性响应。
 *
 * ⚠️ 形状必须与 `packages/app-host/src/ai-*.ts` 的解析器严格一致 ——
 * 这里写错的话，失败会表现为"组件说解析不了"，而不是"假端点错了"，
 * 排查时会绕远路。改解析器时同步改这里。
 */
function respond(feature, userContent) {
  switch (feature) {
    case 'breakdown':
      // 解析器要 `- ` 开头的行，3–8 项。
      return ['- 起草公告文案', '- 走一遍回归测试', '- 通知值班同学', '- 部署并观察半小时'].join(
        '\n',
      );

    case 'capture':
      // 只输出 JSON 对象；`dueDate` 故意省略 —— 假端点不该"猜"日期，
      // 那正是 `ai-capture` 反复强调的"不确定就省略"。
      return JSON.stringify({ title: '修复登录页在 Safari 上的错位', priority: 'high' });

    case 'prioritize': {
      // 🔴 id 必须来自输入。假端点**故意不做任何编造** ——
      // 如果它编一个 id，而被 `parsePrioritizeResult` 的白名单挡掉，
      // 测试就会绿着通过，却什么都没验证。
      const ids = [...userContent.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
      const flavors = ['high', 'medium', 'low', 'none'];
      return JSON.stringify(
        ids.map((id, i) => ({
          id,
          priority: flavors[i % flavors.length],
          reason: `假端点给出的第 ${String(i + 1)} 条理由`,
        })),
      );
    }

    case 'duration-estimate':
      // 解析器要一个纯整数。
      return '90';

    default:
      return '假端点不认识这个请求';
  }
}

/**
 * CORS 头 —— 给**真浏览器**放行。
 *
 * 🔴 这一段是接真浏览器时补的，值得记下为什么：假端点跑在
 * `127.0.0.1:4319`，而被测应用跑在 `127.0.0.1:4318` —— **不同源**。
 * 浏览器会对"带 `authorization` / `content-type: application/json` 的 POST"
 * 先发一次 OPTIONS 预检，再要求响应带 `access-control-allow-origin`。
 *
 * 缺了它的症状**极具误导性**：请求在 DevTools 里是 CORS 拒绝，
 * 而应用层拿到的是 `TypeError: Failed to fetch` ——
 * 界面把它渲染成「无法连接端点：Failed to fetch」，
 * 看起来像"端点没起来"或"地址填错了"，而假端点其实活得很好
 * （`/__requests` 里 count 一直是 0）。排查会绕很远。
 *
 * ⚠️ jsdom 版旅程（`apps/web/tests/journey-ai-memory.integration.spec.tsx`）
 * 看不到这个问题：它用 Node 的 fetch，**没有同源策略**。
 * 这正是"真浏览器比 jsdom 严格"的一个具体例子。
 */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

/**
 * 🔴 **来源白名单模式 —— 让假端点会"拒绝"，这条判据才有牙齿。**
 *
 * 为什么必须有这一段（实测 2026-10-02，Ollama 0.23.2）：
 * 本机端点对**非回环来源**回 `403`、`Content-Length: 0`、**且完全不带 `ACAO`**。
 * 于是浏览器把它拦成 `TypeError: Failed to fetch`，应用侧只能归成 `'network'`，
 * 而上面那段注释描述的症状**正是用户实际看到的那一句**。
 *
 * 原来这个假端点无条件回 `ACAO: *`、根本不读 `Origin` ⇒ 它**结构上不可能复现**
 * 这一类缺陷 —— 判据只测了放行那一侧，所以缺陷在开发阶段永远看不见
 * （同理：所有人都在 localhost 上测，而回环来源是被放行的）。
 *
 * 用法：`STUB_ORIGIN_ALLOWLIST='http://127.0.0.1:4318,http://localhost:4318'`。
 * 语义照抄 Ollama：
 * - **没设这个变量 ⇒ 逐字保持从前的放行行为**（既有套件零影响，这是刻意的）；
 * - 无 `Origin` 头 ⇒ 放行（那是非浏览器调用，比如测试自己 curl）；
 * - `Origin` 在白名单里 ⇒ 放行，并**回显该来源**（`Vary: Origin`，与 Ollama 一致）；
 * - `Origin` 不在白名单里 ⇒ **403 且不带任何 CORS 头** ——
 *   🔴 少一个"顺手回个 ACAO 让错误更可读"都不行，那样浏览器的拦法就变了，
 *   测出来的就不再是真症状。
 */
const ORIGIN_ALLOWLIST = (process.env['STUB_ORIGIN_ALLOWLIST'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s !== '');

/** 放行时该回哪些 CORS 头。白名单模式下回显来源，而不是 `*`。 */
function corsFor(origin) {
  if (ORIGIN_ALLOWLIST.length === 0) return CORS_HEADERS;
  if (origin === undefined || !ORIGIN_ALLOWLIST.includes(origin)) return undefined;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'Origin',
  };
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';

  // 🔴 来源闸门放在**最前面**，先于预检与所有路由 —— 真端点就是这么做的，
  // 而且若放在后面，`/__requests` 这类诊断路径会变成绕过白名单的侧门。
  if (ORIGIN_ALLOWLIST.length > 0) {
    const origin = req.headers['origin'];
    const allowed =
      typeof origin !== 'string' || ORIGIN_ALLOWLIST.includes(origin);
    if (!allowed) {
      // 403、零 CORS 头、零 body —— 三个都必须，否则浏览器的拦法就不是真形状。
      res.writeHead(403, { 'content-length': '0' });
      res.end();
      return;
    }
  }
  const cors = corsFor(typeof req.headers['origin'] === 'string' ? req.headers['origin'] : undefined)
    ?? CORS_HEADERS;

  // 预检请求：只回头，没有 body。
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  // 测试用它来断言"真的发起了网络请求"。
  if (url.startsWith('/__requests')) {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ count: calls.length, calls }));
    return;
  }

  // `/__reset` 让每个用例从干净的计数开始。
  if (url.startsWith('/__reset')) {
    calls.length = 0;
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  if (!url.includes('/chat/completions')) {
    res.writeHead(404, { ...cors, 'content-type': 'application/json' });
    res.end('{"error":"只实现了 /v1/chat/completions"}');
    return;
  }

  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { ...cors, 'content-type': 'application/json' });
      res.end('{"error":"请求体不是 JSON"}');
      return;
    }

    const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    const system = messages
      .filter((m) => m?.role === 'system')
      .map((m) => String(m?.content ?? ''))
      .join('\n');
    const user = messages
      .filter((m) => m?.role === 'user')
      .map((m) => String(m?.content ?? ''))
      .join('\n');

    const hit = ROUTES.find(([marker]) => system.includes(marker));
    const feature = hit?.[1] ?? 'unknown';
    calls.push({ feature, systemHead: system.slice(0, 40) });

    const content = respond(feature, user);
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'stub',
        object: 'chat.completion',
        model: parsed?.model ?? 'stub',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`假端点已就绪： http://127.0.0.1:${String(PORT)}/v1`);
});
