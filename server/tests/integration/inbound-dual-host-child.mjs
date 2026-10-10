/**
 * 双宿主故障窗口的**子进程宿主**夹具：一条真进程，跑一枚真 SQLite 文件宿主的一个入站周期，
 * 在指定的那一次 HTTP 完成后把自己 SIGKILL 掉。
 *
 * 为什么要有这一枚文件，而不是在 vitest 进程里"模拟崩溃"：
 * 窗口 2/4/5 的原文是"终止"，而本仓库目前所有相关判据都是**可控抛错 + 重开句柄**
 * （见计划 §W1 未闭合那一段的自陈：`真进程终止（当前是可控失败/真实文件重开）`）。
 * 抛错会让内存态留在原地，真终止不会 —— 两者对"重启后到底还剩什么"的答案不一样，
 * 所以这一格必须由一条真的进程来死。
 *
 * 契约（stdin 收一行 JSON，stdout 打若干行读数，全部走 ESM 包入口 = 构建产物）：
 *   CALL <pathname>            —— 宿主发出的每一次 HTTP（顺序本身是读数）
 *   KILLED_AFTER <token>       —— 注入真的落进了这一次调用（父进程必须数到这一行）
 *   CYCLE <state>              —— 只有没开注入时才会走到这里
 *   SETUP <json>               —— clientId / 是否注册了 worker（父进程对账用）
 *   FAIL <message>             —— 夹具自己炸了（父进程据此判"载体坏了"而不是"产品坏了"）
 * 退出：注入命中 ⇒ 本进程被 SIGKILL（父进程读到的形状是 code=null / signal='SIGKILL'）；
 *       没配注入 ⇒ 跑完一个周期后 code=0。
 *
 * 🔴 凭据只走 stdin，不落盘、不进 stdout（协议要求 worker 令牌/私钥/口令都不许进证据文件）。
 * 这里的口令与令牌都是这一趟现造的合成值，不是任何真实账号的东西。
 */
import { createInterface } from 'node:readline';

const say = (line) => process.stdout.write(`${line}\n`);

const readRecipe = () => new Promise((resolve, reject) => {
  const rl = createInterface({ input: process.stdin });
  let buffer = '';
  rl.on('line', (line) => { buffer += line; });
  rl.on('close', () => {
    try { resolve(JSON.parse(buffer)); } catch (error) { reject(error); }
  });
});

const main = async () => {
  const recipe = await readRecipe();
  const { openAppHost } = await import('@heyta/app-host');
  const { NodeSqliteDriver } = await import('@heyta/storage/sqlite/node');
  const { setArgon2ParamsForTesting } = await import('@heyta/sync-core');
  // 与主档同一套 KDF 参数：不同参数会让"同一枚口令"派生出不同的 root，
  // 于是子进程解不开父进程包好的凭据 —— 那会表现成"产品坏了"，其实是夹具没对齐。
  setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });

  const host = await openAppHost({
    dbPath: recipe.dbPath,
    driverFactory: () => new NodeSqliteDriver(recipe.dbPath),
    clientId: recipe.clientId,
    serverUrl: recipe.base,
    token: recipe.token,
    accountId: recipe.accountId,
    fetchImpl: (async (input, init) => {
      // input 可能是 string、URL，或 Request。`URL` 对象没有 `.url` 属性
      // （那是 Request 的），拿 `input.url` 去 new URL 会得到 undefined ⇒ 探针自己抛，
      // 而上层把它读成"传输失败"—— 形状和被测对象坏了完全一样。
      const url = new URL(typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url));
      // 两种真切断，别混为一谈：
      //   killBefore —— 请求已发出、响应还在路上就死（"回执/ACK 未完成"那一格）；
      //   killAfter  —— 响应已经回到客户端、还没交给上层就死（"服务端已提交而客户端永别"那一格）。
      // 切断点按**路径 + 方法**两维匹配：`/api/sync/ops` 同时是上传(POST)与下载(GET)，
      // 只按路径匹配会在下载那一腿就死，测的就不是"上传在途"了。
      const requestMethod = String(init?.method ?? 'GET').toUpperCase();
      const hits = (marker, want) => marker !== undefined && marker !== null
        && url.pathname.includes(marker) && (want === undefined || requestMethod === String(want).toUpperCase());
      if (hits(recipe.killBefore, recipe.killBeforeMethod)) {
        const pending = globalThis.fetch(input, init);
        void pending.catch(() => undefined);
        say(`KILLED_BEFORE ${url.pathname}`);
        process.kill(process.pid, 'SIGKILL');
        return new Promise(() => undefined);
      }
      const response = await globalThis.fetch(input, init);
      // 只在**响应已经完整读完**之后再死：否则写入可能还没落库，测的就不是"落盘之后才断"。
      await response.clone().arrayBuffer().catch(() => undefined);
      say(`CALL ${url.pathname} ${response.status} ${response.ok ? '' : await response.clone().text().then((value) => value.slice(0, 160)).catch(() => '')}`);
      if (hits(recipe.killAfter, recipe.killAfterMethod)) {
        say(`KILLED_AFTER ${url.pathname}`);
        process.kill(process.pid, 'SIGKILL');
        return new Promise(() => undefined);
      }
      return response;
    }),
  });
  say(`SETUP ${JSON.stringify({ clientId: host.clientId })}`);

  const session = await host.getVaultSession();
  if (session.state !== 'unlocked') {
    // 第二台设备走的是"用同一口令解开远端已存在的 key package"，不是再造一枚 root。
    await session.unlockWithPassphrase(recipe.passphrase);
  }
  if (recipe.registerWorker) {
    await host.registerInboundWorker({ userId: recipe.userId, databaseEpoch: recipe.databaseEpoch });
  }
  const registration = await host.ensureInboundRecipientKey();
  const routing = {
    enabled: true,
    allowRemote: false,
    endpoints: [{ id: 'stub', label: 'stub', endpoint: `http://127.0.0.1:${recipe.providerPort}/v1`, model: 'test' }],
    routes: { 'inbound-automation': [{ endpointId: 'stub' }] },
  };
  const result = await host.processInboundAutomation({
    userId: recipe.userId,
    keyEpoch: registration.keyEpoch,
    allowedFields: recipe.allowedFields ?? ['title'],
    routing,
    consents: [],
    systemPrompt: recipe.systemPrompt ?? 'Return tasks JSON',
    parseVersion: recipe.parseVersion ?? 1,
    ...(recipe.timezone === undefined ? {} : { timezone: recipe.timezone }),
    ...(recipe.eventId === undefined ? {} : { eventId: recipe.eventId }),
  });
  say(`CYCLE ${JSON.stringify(result)}`);
  if (recipe.syncAfterCycle) {
    const status = await host.sync();
    say(`SYNC ${JSON.stringify(status)}`);
  }
  host.close();
};

main().catch((error) => {
  say(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
