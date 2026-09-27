import { createCipheriv, createSign, generateKeyPairSync } from 'node:crypto';
import { buildWebhookSignatureMessage } from '../src/billing/wechat.adapter';

/**
 * 微信回调测试夹具：**不用任何真实凭证、不发任何真实请求**。
 *
 * RSA 密钥在测试进程里现生成；AES-256-GCM 密文用同一个（假的）APIv3 密钥
 * 现加密。所以这些夹具证明的是"我们实现的协议与微信文档一致"，
 * **不是**"微信真的会接受它"。
 */
export const TEST_WECHAT_API_V3_KEY = 'a'.repeat(32); // 32 个 ASCII 字节
export const TEST_WECHAT_APP_ID = 'wx_test_appid';
export const TEST_WECHAT_MCH_ID = '1900000000';
export const TEST_WECHAT_SERIAL_NO = 'ABCDEF1234567890';
export const TEST_WECHAT_NOTIFY_URL =
  'https://sync.example.test/api/billing/webhooks/wechat';

export interface TestKeyPair {
  readonly privateKey: string;
  readonly publicKey: string;
}

export const createWechatTestKeyPair = (): TestKeyPair =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

/** 用 APIv3 密钥构造 `base64(密文 || authTag)`，与微信的 `resource.ciphertext` 同形。 */
export const encryptWechatResource = (
  plaintext: string,
  nonce: string,
  associatedData: string,
  apiV3Key: string = TEST_WECHAT_API_V3_KEY,
): string => {
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(apiV3Key, 'utf8'),
    Buffer.from(nonce, 'utf8'),
  );
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  return Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64');
};

export interface WechatWebhookFixture {
  readonly body: Buffer;
  readonly headers: Record<string, string>;
}

export interface WechatWebhookFixtureOptions {
  /** 回调里完全不带 `amount` 字段。 */
  readonly omitAmount?: boolean;
  readonly privateKey: string;
  readonly timestampSeconds: number;
  readonly outTradeNo: string;
  readonly attach?: string | null;
  readonly userId?: number;
  readonly successTime?: string;
  readonly nonce?: string;
  readonly resourceNonce?: string;
  readonly associatedData?: string;
  readonly eventType?: string;
  readonly tradeState?: string;
  readonly omitSuccessTime?: boolean;
  readonly amountFen?: number;
  readonly apiV3Key?: string;
}

/** 构造一个**签名正确**的微信支付成功回调（可按需破坏某一处）。 */
export const buildWechatPaymentWebhook = (
  options: WechatWebhookFixtureOptions,
): WechatWebhookFixture => {
  const resourceNonce = options.resourceNonce ?? 'resnonce1234';
  const associatedData = options.associatedData ?? 'transaction';
  const successTime = options.successTime ?? '2026-09-26T12:00:00+08:00';
  const plaintext = JSON.stringify({
    out_trade_no: options.outTradeNo,
    transaction_id: '4200000000000000000000000001',
    trade_state: options.tradeState ?? 'SUCCESS',
    ...(options.omitSuccessTime ? {} : { success_time: successTime }),
    ...(options.attach === null ? {} : { attach: options.attach ?? String(options.userId ?? 42) }),
    // `omitAmount` 让我们能构造"回调里根本没有金额字段"这个真实可能的输入，
    // 而不是只能构造"金额不对"。
    ...(options.omitAmount
      ? {}
      : {
          amount: {
            total: options.amountFen ?? 500,
            payer_total: options.amountFen ?? 500,
            currency: 'CNY',
          },
        }),
  });
  const envelope = JSON.stringify({
    id: 'notif_fixture_1',
    create_time: successTime,
    event_type: options.eventType ?? 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    resource: {
      algorithm: 'AEAD_AES_256_GCM',
      ciphertext: encryptWechatResource(
        plaintext,
        resourceNonce,
        associatedData,
        options.apiV3Key ?? TEST_WECHAT_API_V3_KEY,
      ),
      associated_data: associatedData,
      nonce: resourceNonce,
    },
  });
  const body = Buffer.from(envelope, 'utf8');
  const nonce = options.nonce ?? 'signoncenonce';
  const message = buildWebhookSignatureMessage(
    { timestamp: String(options.timestampSeconds), nonce },
    body,
  );
  const signature = createSign('RSA-SHA256')
    .update(message)
    .sign(options.privateKey, 'base64');
  return {
    body,
    headers: {
      'wechatpay-signature': signature,
      'wechatpay-timestamp': String(options.timestampSeconds),
      'wechatpay-nonce': nonce,
    },
  };
};