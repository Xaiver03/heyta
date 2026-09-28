import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 非 Web 宿主：**不用 jsdom**。这里需要 jsdom 就说明有浏览器依赖混进来了。
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts'],

    // 🔴 放宽超时，理由与 `server/vitest.config.ts` 相同，但这里的具体证据是实测的。
    //
    // 本包的用例要**真起子进程、真读写系统钥匙串**（`security` 命令），
    // 而这类"真东西"的耗时跟机器速度强相关：
    //
    //   本机（Apple Silicon）最慢一条 = 1226ms
    //   CI runner 上同一条      ≈ 4.3s   ← 实测倍率约 3.5×
    //
    // 默认的 5000ms 就压在这条线上 —— 那不是"偶尔慢"，是**本来就没有余量**。
    //
    // ⚠️ 这种红比"直接失败"更坏：它会被当成"重跑一下就好"，
    //    而一个能被重跑哄好的门禁，很快就不再挡得住真问题。
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
