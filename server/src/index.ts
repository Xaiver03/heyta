import 'dotenv/config';
import { createServer } from './server';
import * as path from 'path';
import { Logger } from './logger';
import { PRODUCT_NAME } from './config';
import { assertPasswordBackend } from './password/hash';

// Create server instance with config overrides
// The server will load additional config from environment variables
const { start, stop } = createServer({
  dataDir: path.join(process.cwd(), 'data'),
});

// Graceful shutdown handling
let isShuttingDown = false;

const shutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) {
    Logger.info('Shutdown already in progress...');
    return;
  }
  isShuttingDown = true;
  Logger.info(`\n📴 Received ${signal}, shutting down gracefully...`);

  try {
    await stop();
    Logger.info('✅ Server stopped successfully');
    process.exit(0);
  } catch (err) {
    Logger.error('❌ Error during shutdown:', err);
    process.exit(1);
  }
};

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGHUP', () => shutdown('SIGHUP'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  Logger.error('❌ Uncaught exception:', err);
  shutdown('uncaughtException').catch(() => process.exit(1));
});

process.on('unhandledRejection', (reason, promise) => {
  Logger.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
});

// Start the server.
//
// The password hashing backend is verified **before** the port is bound. Both halves of
// that check are load-bearing for email+password sign-in: a missing `PASSWORD_PEPPER`
// means every registration would store a hash that can never be verified again (and
// rotating it later invalidates them all), and on `node:24-alpine` the Argon2id binary
// can install without being loadable — or load and compute different bytes. A container
// that refuses to start is a cheaper failure than a server that reports `healthy` and
// answers the first person who signs in with a 500.
const boot = async (): Promise<string> => {
  try {
    const report = await assertPasswordBackend();
    Logger.info(
      `🔒 Password hashing backend verified (Argon2id, ${report.msPerHash} ms per hash)`,
    );
  } catch (err) {
    Logger.error('❌ Password hashing backend self-check failed — refusing to start.');
    Logger.error(`   ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  return start();
};

boot()
  .then((address) => {
    Logger.info('');
    Logger.info(`🚀 ${PRODUCT_NAME} Server is running!`);
    Logger.info(`   URL: ${address}`);
    Logger.info('');
    Logger.info('Press Ctrl+C to stop the server');
    Logger.info('');
  })
  .catch((err: any) => {
    // Provide user-friendly error messages for common errors
    if (err.code === 'EADDRINUSE') {
      Logger.error(`❌ Port is already in use. Try a different port with PORT=xxxx`);
    } else if (err.code === 'EACCES') {
      Logger.error(
        `❌ Permission denied. Try a port > 1024 or run with elevated privileges`,
      );
    } else {
      Logger.error('❌ Failed to start server:', err);
    }
    process.exit(1);
  });
