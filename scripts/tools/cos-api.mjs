#!/usr/bin/env node
// 零依赖的腾讯云 COS XML API 调用器（coscli 只覆盖对象读写，桶级配置
// 如 lifecycle / referer 需要 REST API，签名按官方 q-sign-algorithm=sha1 手写）。
//
// 凭据从 coscli 的配置读取（~/.coscli/config.yaml 的 cos.base 段），
// 不在仓库里存任何密钥。
//
// 用法：
//   node scripts/tools/cos-api.mjs --bucket heyta-dist-1380503169 \
//        --method PUT --query lifecycle --body-file /tmp/lifecycle.xml
//   node scripts/tools/cos-api.mjs --bucket heyta-dist-1380503169 --method GET --query lifecycle
//
// 退出码：0 成功；非 0 失败（响应非 2xx 时打印响应体与状态码）。

import { createHmac, createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import https from 'node:https';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) args[k.slice(2)] = argv[++i] ?? '';
  }
  return args;
}

function loadCredentials() {
  for (const p of [
    `${homedir()}/.coscli/config.yaml`,
    `${homedir()}/.cos.yaml`,
  ]) {
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    const id = text.match(/secretID:\s*(\S+)/)?.[1];
    const key = text.match(/secretKey:\s*(\S+)/)?.[1];
    if (id && key) return { id, key };
  }
  console.error('找不到 coscli 凭据（~/.coscli/config.yaml）');
  process.exit(2);
}

function hmacSha1(key, text) {
  return createHmac('sha1', key).update(text).digest('hex');
}
function sha1Hex(text) {
  return createHash('sha1').update(text).digest('hex');
}

// COS v5 签名。只把 host / content-type 纳入签名头（与实际发送头严格一致）。
function buildAuthHeader({ method, pathname, query, secretId, secretKey, contentType, contentMd5 }) {
  const now = Math.floor(Date.now() / 1000);
  const keyTime = `${now};${now + 600}`;
  const signKey = hmacSha1(secretKey, keyTime);

  const params = Object.entries(query).map(([k, v]) => [k.toLowerCase(), v]);
  params.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const urlParamList = params.map(([k]) => k).join(';');
  const formatParams = params
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  const headers = { host: `${BUCKET}.cos.${REGION}.myqcloud.com` };
  if (contentType) headers['content-type'] = contentType;
  if (contentMd5) headers['content-md5'] = contentMd5;
  const headerEntries = Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]);
  headerEntries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const headerList = headerEntries.map(([k]) => k).join(';');
  // 🔴 头部的**值**同样要 URL 编码 —— COS 服务端回显的 FormatString 里
  //    `+`/`=` 都被编码成了 %2B/%3D（实测拿这个报错对出来的差异）。
  const formatHeaders = headerEntries
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  const httpString = `${method.toLowerCase()}\n${pathname}\n${formatParams}\n${formatHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1Hex(httpString)}\n`;
  const signature = hmacSha1(signKey, stringToSign);

  return (
    `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}` +
    `&q-key-time=${keyTime}&q-header-list=${headerList}` +
    `&q-url-param-list=${urlParamList}&q-signature=${signature}`
  );
}

const args = parseArgs(process.argv);
const BUCKET = args.bucket;
const REGION = args.region || 'ap-guangzhou';
const METHOD = (args.method || 'GET').toUpperCase();
const KEY = args.key || ''; // 对象键；桶级操作留空
const QUERY = args.query ? { [args.query]: '' } : {};
const BODY_FILE = args['body-file'];
const CONTENT_TYPE = BODY_FILE ? 'application/xml' : undefined;

const { id: secretId, key: secretKey } = loadCredentials();

const body = BODY_FILE ? readFileSync(BODY_FILE) : null;
// lifecycle 这类配置化 PUT 要求 Content-MD5；该头必须同时进入签名与请求头。
const contentMd5 = body ? createHash('md5').update(body).digest('base64') : undefined;

// 键要整体 URI 编码（含 `/`），COS 的 pathname 约定如此。
const pathname = '/' + encodeURIComponent(KEY).replace(/%2F/g, '/');
const authorization = buildAuthHeader({
  method: METHOD,
  pathname,
  query: QUERY,
  secretId,
  secretKey,
  contentType: CONTENT_TYPE,
  contentMd5,
});

const q = new URLSearchParams(QUERY).toString();
const pathWithQuery = pathname + (q ? `?${q}` : '');

const req = https.request(
  {
    host: `${BUCKET}.cos.${REGION}.myqcloud.com`,
    path: pathWithQuery,
    method: METHOD,
    headers: {
      Authorization: authorization,
      ...(CONTENT_TYPE ? { 'Content-Type': CONTENT_TYPE } : {}),
      ...(contentMd5 ? { 'Content-MD5': contentMd5 } : {}),
      ...(body ? { 'Content-Length': body.length } : {}),
    },
  },
  (res) => {
    if (process.env.COS_API_DEBUG) {
      console.error(`[debug] sent headers: Content-Type=${CONTENT_TYPE} Content-MD5=${contentMd5} len=${body?.length}`);
    }
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`HTTP ${res.statusCode}` + (text ? `\n${text}` : ''));
        process.exit(0);
      } else {
        console.error(`HTTP ${res.statusCode}\n${text}`);
        process.exit(1);
      }
    });
  },
);
req.on('error', (e) => {
  console.error('request error:', e.message);
  process.exit(1);
});
if (body) req.write(body);
req.end();
