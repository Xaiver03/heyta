import * as fs from 'fs';
import * as path from 'path';

const getTimestamp = (): string => new Date().toISOString();

let logFileStream: fs.WriteStream | null = null;

/**
 * 🔴 日志**传输层永不崩溃**（崩溃审计 2026-11-08 · U10 第 1 条 P0）。
 *
 * 原来这里是裸 `fs.createWriteStream(...)`，且**没有 `'error'` 监听**。
 * 磁盘写满（ENOSPC）/ `app.log` 被改权限（EACCES）/ 日志卷只读
 * 时 WriteStream 会**异步**发 `'error'` —— 一个没有监听者的 `'error'`
 * 事件会被 EventEmitter 抛成 uncaughtException，进而走 `index.ts` 的
 * shutdown 把整个服务停掉。**任何一次 `Logger.info` 都能触发，与业务无关。**
 *
 * 取舍：日志写不进去就**关掉文件通道、退回 console**，把
 * "日志降级"和"服务挂掉"彻底分开。运维会看到一条告警，而不是一个死掉的服务。
 */
const disableFileSink = (reason: string): void => {
  const dying = logFileStream;
  logFileStream = null;
  try {
    dying?.destroy();
  } catch {
    // 已经在错误状态，destroy 失败无妨。
  }
  try {
    // 这条走 console 而不是 writeToFile —— 文件通道已经不可用了。
    console.error(`[heyta] 文件日志已停用：${reason}`);
  } catch {
    // console 也不可用时静默。
  }
};

if (process.env.LOG_TO_FILE === 'true') {
  try {
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      // recursive: true —— 并发进程同时建目录时 existsSync+mkdirSync 会 EEXIST。
      fs.mkdirSync(logDir, { recursive: true });
    }
    const stream = fs.createWriteStream(path.join(logDir, 'app.log'), { flags: 'a' });
    // 🔴 必须先挂监听再赋值：赋值之后任何一次写失败都会走这个分支。
    stream.on('error', (error: NodeJS.ErrnoException) => {
      disableFileSink(error.code ?? error.message);
    });
    logFileStream = stream;
  } catch (error) {
    disableFileSink(error instanceof Error ? error.message : String(error));
  }
}

/**
 * `JSON.stringify` 的**永不抛**版本。
 *
 * 审计日志的 `args` 接受任意 `unknown`：调用方会传 Prisma 实体、
 * 带 socket 的 axios 错误、`BigInt` 时间戳。这些都会让 `JSON.stringify` 抛
 * （循环引用 / BigInt）。而这里是在**错误处理路径**上 ——
 * 处理错误时抛错会把"记录失败"变成"新的失败"。
 */
const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    try {
      // 兜一层：把已知的两种致抛类型换掉之后再试一次。
      return JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item === 'bigint') return item.toString();
        if (typeof item === 'function' || typeof item === 'symbol') return undefined;
        return item;
      }) ?? 'null';
    } catch {
      // 循环引用：连 replacer 都救不了（BigInt 已被上一步处理）。
      return '"[unserializable]"';
    }
  }
};

const writeToFile = (level: string, message: string, ...args: unknown[]) => {
  const stream = logFileStream;
  if (stream !== null) {
    // 🔴 整体包 try：即使前面的 error 监听装上，同步抛（例如流已 destroy）也还有兜底。
    try {
      const logEntry = safeStringify({
        timestamp: getTimestamp(),
        level,
        message,
        args: args.length ? args : undefined,
      });
      stream.write(logEntry + '\n');
    } catch (error) {
      disableFileSink(error instanceof Error ? error.message : String(error));
    }
  }
};

export interface AuditLogEntry {
  event: string;
  userId: number;
  clientId?: string;
  opId?: string;
  entityType?: string;
  entityId?: string;
  errorCode?: string;
  reason?: string;
  ip?: string;
  [key: string]: unknown;
}

export const Logger = {
  debug: (message: string, ...args: unknown[]): void => {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`${getTimestamp()} [DEBUG] ${message}`, ...args);
      writeToFile('DEBUG', message, ...args);
    }
  },
  info: (message: string, ...args: unknown[]): void => {
    console.log(`${getTimestamp()} [INFO] ${message}`, ...args);
    writeToFile('INFO', message, ...args);
  },
  warn: (message: string, ...args: unknown[]): void => {
    console.warn(`${getTimestamp()} [WARN] ${message}`, ...args);
    writeToFile('WARN', message, ...args);
  },
  error: (message: string, ...args: unknown[]): void => {
    console.error(`${getTimestamp()} [ERROR] ${message}`, ...args);
    writeToFile('ERROR', message, ...args);
  },

  /**
   * Structured audit log for security-relevant events.
   * Outputs JSON for easy parsing by log aggregation tools.
   *
   * Events:
   * - OP_REJECTED: Operation was rejected (validation, conflict, etc.)
   * - RATE_LIMITED: User hit rate limit
   * - AUTH_FAILED: Authentication attempt failed
   * - SUSPICIOUS_REQUEST: Request contained suspicious data
   * - E2EE_REQUIRED: Upload rejected by the encrypted-only ingress gate
   *   (carries `surface`: 'ops' | 'snapshot', and `opsCount`)
   */
  audit: (entry: AuditLogEntry): void => {
    const logEntry = {
      timestamp: getTimestamp(),
      level: 'AUDIT',
      ...entry,
    };
    console.log(JSON.stringify(logEntry));
    if (logFileStream) {
      logFileStream.write(JSON.stringify(logEntry) + '\n');
    }
  },
};
