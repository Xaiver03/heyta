import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 宿主无关层：**不用 jsdom**。这里需要 jsdom 就说明有浏览器依赖混进来了。
  // 与 `packages/app-host` 同一条约定 —— 本包将来会被四端的壳调用，但它自己不碰任何壳。
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts'],

    // 🔴 时区必须钉死，这不是"讲究"，是夹具能不能成立的前提。
    //
    // `fixtures/*.golden.json` 里有一个**绝对 epoch** 字段（专注会话的 `endsAt`）。
    // 它是从"本地日历日的正午"推出来的，所以**同一个本地时刻在不同时区是不同的
    // epoch 数值** —— 夹具的字节会跟着生成机器的时区变。
    //
    // 后果实测过：这份夹具在本机（UTC+8）生成，CI 在 UTC 跑，
    // `check:widgets` 直接红（`endsAt` 差 8 小时，密文整体跟着变）。
    // 而它是**四端解析器的锁** —— 它不稳定，等于锁本身在晃。
    //
    // 钉在 UTC 而不是"用生成者的时区"，是为了让**生成与校验在同一条件下进行**：
    // 谁跑、在哪跑，字节都一样。
    env: { TZ: 'UTC' },
  },
});
