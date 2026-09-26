/**
 * Argon2id 已知答案向量（KAT）
 * ============================
 *
 * 🔴 **这个文件补的是一个真实的缺口：整套加密测试全是往返测试。**
 *
 * 原来 `encryption.spec.ts` 的断言形状是"加密 → 解密 → 得到原文"。
 * 那种测试**永远抓不到下面这件事**：换掉 Argon2 的实现，只要它自洽，
 * 所有用例照样绿 —— 而它派生出的密钥字节和别的平台不一样。
 * 后果不是报错，是**静默的数据不可读**：
 * Web 上加密的任务，手机上解出来是乱码或解密失败；每台设备都"工作正常"。
 *
 * 这就是本项目已经吃过两次亏的那类 bug（AGENTS.md §7 第 4、7 条：
 * **两套并行定义**），而单元测试抓不到它 —— 因为 mock 是按实现者的
 * 理解写的，理解错了 mock 跟着错。所以这里钉的是**字节**，不是行为。
 *
 * ---
 *
 * ## 向量是怎么来的
 *
 * 在改任何东西**之前**，用当时唯一在用的实现（`hash-wasm` 4.12.0）
 * 在生产参数下算出来并抄在这里：
 *
 *     password = 'correct horse battery staple'
 *     salt     = 16 个字节，全为 0x07
 *     params   = { parallelism: 1, iterations: 3, memorySize: 65536 }  // 64 MiB
 *     hashLength = 32
 *     → 6ad10af97f1744119bd7135c85121dc589794f9c5d646200b8ad4d6becf15084
 *
 * 🔴 **先取向量、再改实现**，顺序不能反。
 * 反过来做的话，向量会变成"新实现的产物"，于是它证明的只是"新实现等于它自己"。
 *
 * ## 这个向量同时被验证过什么
 *
 * `@noble/hashes` 1.8.0 的 `argon2id` 在同样输入下产出**逐字节相同**的结果，
 * 所以这两条事实是一起确立的：
 *
 *   1. 参数映射正确（`memorySize` 是 KiB、`iterations` 是轮数、`parallelism` 是并行度）；
 *   2. 纯 JS 实现在**正确性**上可以替代 WASM —— 慢是另一回事，见下。
 *
 * ⚠️ **这条测试管不了性能。** 实测（V8 / Apple Silicon）：
 * 纯 JS `@noble/hashes` 在 64 MiB、3 轮下要 **3.9–6.8 秒**；
 * `hash-wasm` 走 WASM 快得多。Hermes 不支持 WebAssembly，
 * 所以移动端必须走原生或接受这个数量级的等待 —— 那是选型问题，
 * 不是这条测试能回答的问题。**不要把"向量对上了"读成"可以换实现"**。
 */

import { describe, expect, it } from 'vitest';

import { deriveKeyFromPassword, getArgon2Params, setArgon2ParamsForTesting } from '../src';

/** 与向量生成时**逐字相同**的输入。改这里等于换了一条向量，必须重新生成。 */
const KAT_PASSWORD = 'correct horse battery staple';
const KAT_SALT = new Uint8Array(16).fill(0x07);
const KAT_EXPECTED_HEX = '6ad10af97f1744119bd7135c85121dc589794f9c5d646200b8ad4d6becf15084';

/** 生产参数。与向量绑定 —— 改了它就等于改了跨平台契约。 */
const KAT_PARAMS = { parallelism: 1, iterations: 3, memorySize: 65536 };

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

describe('Argon2id 已知答案向量', () => {
  it('生产参数没有被悄悄改掉（改了就不是同一套契约了）', () => {
    // 这条单独断言，是为了让"参数漂移"报出**它自己**的名字。
    // 只断言密钥字节的话，参数被改会表现成"密钥不对"，
    // 排查方向会直接偏到 Argon2 实现上去。
    setArgon2ParamsForTesting();
    expect(getArgon2Params()).toEqual(KAT_PARAMS);
  });

  it('🔴 派生结果与 hash-wasm 的产物逐字节一致', async () => {
    setArgon2ParamsForTesting(); // 生产参数；其它用例会用弱参数提速

    const { keyBytes, salt } = await deriveKeyFromPassword(KAT_PASSWORD, KAT_SALT);

    expect(salt).toEqual(KAT_SALT);
    expect(keyBytes).toHaveLength(32);
    expect(toHex(keyBytes)).toBe(KAT_EXPECTED_HEX);
  });

  it('同一密码配不同 salt 派生不同密钥（salt 真的参与了运算）', async () => {
    setArgon2ParamsForTesting();

    const other = await deriveKeyFromPassword(KAT_PASSWORD, new Uint8Array(16).fill(0x08));

    // 防的是"实现忽略了 salt"这种低级但致命的错误：
    // 那会让每个用户、每次派生都得到同一个密钥。
    expect(toHex(other.keyBytes)).not.toBe(KAT_EXPECTED_HEX);
  });
});