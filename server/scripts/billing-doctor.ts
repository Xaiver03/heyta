/**
 * 这台实例**到底能卖什么** —— 只读自查（不进容器、不发请求、不碰库）
 * =================================================================
 *
 * ## 为什么要有它
 *
 * 产品负责人 2026-10-24 在「托管同步续费」按下 ¥12，拿到「这一档现在还不能卖」，
 * 第一句问的是"**现在不应该接了中央支付吗？**"。
 *
 * 那一问是合理的：收款确实已经统一走支付中心（`paycenter.adapter.ts`，微信直连已退场）。
 * 挡住那一单的**不是支付**，而是另一道闸 —— 这一档要交付「我们的云端 AI」，
 * 而这台实例没配托管 AI 上游（`checkout.routes.ts` 的 ②′）。
 *
 * 问题在于**没有任何一处能一眼看出这件事**：开关在 `config.ts`、注册在 `registry.ts`、
 * 闸门在 `checkout.routes.ts`、客户端只看得到一个 409。于是"要买"和"要卖"的两个人各自猜。
 *
 * ## 它只报**事实**，不下第二个判断
 *
 * 🔴 刻意**不**在这里重新实现"能不能卖"：那是 `checkout.routes.ts` 的闸门，
 * 写第二份一定会漂（AGENTS §3.5 的判据）。这里只做三件客观的事：
 *
 *   1. 打印**解析之后**的配置事实（`config.paycenter` / `config.managedAi` 在不在），
 *      而不是去猜 `process.env` 里那串字；
 *   2. 打印**真的注册成功**的收款通道（走生产同一个构造函数 `createBillingAdaptersFromConfig`）；
 *   3. 打印每个 SKU 授予哪些能力、以及它**按闸门顺序**会先撞上哪一道（只指路）。
 *
 * ## 用法
 *
 * ```bash
 * cd server && npm run doctor:billing                        # 看本机 .env
 * docker compose exec server npm run doctor:billing:dist      # 看容器里**实际生效**的那份
 * cd server && npm run doctor:billing -- --strict             # 有档卖不了就退 1（部署前自检）
 *
 * ⚠️ 容器里用 `:dist` 那条：运行镜像按 `npm pkg delete devDependencies` 构建，
 * 没有 `ts-node`，而 `doctor:billing` 走的是 tsc（源码里那些 `./x.js` 后缀 ts-node 解不了）。
 * 等价写法：`docker compose exec server node dist/scripts/billing-doctor.js`。
 * ```
 *
 * ⚠️ `loadConfigFromEnv` 在"配了一半"时**故意**直接抛（`config.ts` 的注释）。
 * 那正是运营最需要看到的一条事实，所以这里接住并原样打印，而不是以一个看不懂的栈结束。
 */
import 'dotenv/config';

import { loadConfigFromEnv, type ServerConfig } from '../src/config';
import { MANAGED_AI_CAPABILITY } from '../src/ai/metering';
import { NOOP_PROVIDER } from '../src/billing/noop.adapter';
import { SKU_GRANTS, grantsForSku, notSellableReason } from '../src/billing/price-book';
import { createBillingAdaptersFromConfig } from '../src/billing/registry';

/**
 * 开某一项需要的环境变量名。
 *
 * 🔴 这是**给运营看的帮助文本**，不是判断依据（判断一律读解析后的 `config`）。
 * 它由 `server/tests/billing-doctor.spec.ts` 逐名对账 `config.ts` 的源码 ——
 * 名字改了而这里没改，那条判据会红，所以这段文本不会悄悄过期。
 */
export const ENV_NAMES = {
  paycenter: [
    'PAYCENTER_ENABLED',
    'PAYCENTER_BASE_URL',
    'PAYCENTER_CLIENT_ID',
    'PAYCENTER_CLIENT_SECRET',
  ],
  managedAi: [
    'MANAGED_AI_ENABLED',
    'MANAGED_AI_UPSTREAM_BASE_URL',
    'MANAGED_AI_UPSTREAM_API_KEY',
    'MANAGED_AI_UPSTREAM_MODEL_ID',
  ],
} as const;

export interface SkuReading {
  readonly priceId: string;
  readonly grants: readonly string[];
  /** 按闸门顺序，这一档会先撞上的那一道；`null` = 三道都不挡。 */
  readonly blocker: string | null;
}

/**
 * 逐档读数。**纯函数**，判据直接喂它（脚本本身只是把结果印出来）。
 *
 * ⚠️ `blocker` 的文字是给运营的指路，不是判断 —— 真正的裁决仍在
 * `checkout.routes.ts`；这里只是按同一顺序把"会撞哪一道"读出来。
 */
export function readSellability(input: {
  readonly config: Pick<ServerConfig, 'managedAi'>;
  readonly realProviderCount: number;
}): readonly SkuReading[] {
  const readings: SkuReading[] = [];
  for (const priceId of Object.keys(SKU_GRANTS)) {
    const grants = grantsForSku(priceId) ?? [];
    let blocker: string | null = null;
    const global = notSellableReason(priceId);
    if (global !== null) {
      blocker = `① 全局不可交付：${global}`;
    } else if (grants.includes(MANAGED_AI_CAPABILITY) && input.config.managedAi === undefined) {
      blocker = '②′ 这一档要交付云端 AI，而本实例没有托管 AI 上游';
    } else if (input.realProviderCount === 0) {
      blocker = '④ 没有注册任何真实收款通道（只有 noop）';
    }
    readings.push({ priceId, grants, blocker });
  }
  return readings;
}

const line = (label: string, value: string): string => `  ${label.padEnd(22, ' ')} ${value}`;

function printReport(): number {
  console.log('heyta · 收款与交付自查（只读：不发请求、不碰数据库）\n');

  let config: ServerConfig | undefined;
  let configError: string | undefined;
  try {
    config = loadConfigFromEnv();
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }

  if (config === undefined) {
    console.log('🔴 环境变量**没配齐**，服务端起不来（所以下面每条闸门的答案都是"卖不了"）：\n');
    console.log(`  ${configError ?? '未知错误'}\n`);
  }

  const adapters = config === undefined ? [] : createBillingAdaptersFromConfig(config);
  const providers = adapters.map((adapter) => adapter.provider);
  const realProviders = providers.filter((provider) => provider !== NOOP_PROVIDER);

  console.log('一、这一台实例的事实（来自解析后的配置，不是猜 env 字符串）');
  console.log(
    line('收款：支付中心', config?.paycenter === undefined ? '关（未注册）' : '开（已注册）'),
  );
  console.log(line('收款：注册的通道', providers.length === 0 ? '（无）' : providers.join(' / ')));
  console.log(
    line('交付：托管 AI 上游', config?.managedAi === undefined ? '关（未配置）' : '开（已配置）'),
  );
  console.log(line('服务端配置', config === undefined ? '🔴 起不来（见上）' : '可启动'));
  console.log('');

  console.log('二、逐档读数（按服务端闸门顺序：① 全局 → ②′ 云端 AI → ④ 收款通道）');
  const readings = readSellability({
    config: { managedAi: config?.managedAi },
    realProviderCount: realProviders.length,
  });
  for (const reading of readings) {
    const verdict = reading.blocker === null ? '✅ 可以下单' : `⛔ ${reading.blocker}`;
    console.log(`  ${reading.priceId.padEnd(20, ' ')} [${reading.grants.join(', ')}]`);
    console.log(`  ${''.padEnd(20, ' ')} ${verdict}`);
  }
  console.log('');

  console.log('三、要把它们打开，需要这几枚（写在部署的 .env 里，再重启容器）');
  console.log(`  支付中心（收单/退款统一走它）：${ENV_NAMES.paycenter.join(' + ')}`);
  console.log(`  云端 AI（¥12 那一档买的东西）：${ENV_NAMES.managedAi.join(' + ')}`);
  console.log('  ⚠️ 两组都是"总闸为真时必须齐全"，缺一枚就是**启动期硬错误**（有意如此）。');
  console.log('  ⚠️ 微信直连已退场：即使设了 WECHAT_PAY_ENABLED，也会在启动期被拒。');
  console.log('');

  const blocked = readings.filter((reading) => reading.blocker !== null);
  const strict = process.argv.includes('--strict');
  if (blocked.length > 0) {
    console.log(`结论：${blocked.length} 档现在卖不了（见上面第 ② 节）。`);
    return strict ? 1 : 0;
  }
  console.log('结论：三档闸门都过，所有档位都能下单。');
  return 0;
}

// 只在**直接执行**时跑；被测试 import 时不要打屏、也不要读 env。
if (process.argv[1] !== undefined && /billing-doctor\.(ts|js)$/u.test(process.argv[1])) {
  process.exitCode = printReport();
}
