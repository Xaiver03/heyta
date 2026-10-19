// Explicit local test fixture only. Does not read .env or permit a remote target.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const raw = process.env.HEYTA_CENTRAL_TEST_DATABASE_URL;
if (!raw) throw new Error("HEYTA_CENTRAL_TEST_DATABASE_URL is required");
const url = new URL(raw);
if (
  url.protocol !== "postgresql:" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !/^\/heyta_central_auth_[a-z0-9_]*test$/.test(url.pathname) ||
  url.search ||
  url.hash
) {
  throw new Error(
    "Only an explicitly named loopback heyta_central_auth_*test database is allowed",
  );
}
const name = url.pathname.slice(1),
  admin = new URL(url);
admin.pathname = "/postgres";
function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (r.status !== 0) throw new Error(`Fixture command failed: ${cmd}`);
}
// The name was constrained above. Existing fixture is preserved; no DROP/reset.
const exists = spawnSync(
  "psql",
  [
    admin.href,
    "-XAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `SELECT 1 FROM pg_database WHERE datname = '${name}'`,
  ],
  { encoding: "utf8" },
);
if (exists.status !== 0) throw new Error("Cannot inspect local fixture");
if (!exists.stdout.trim())
  run("createdb", ["--maintenance-db", admin.href, name]);
const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
run("sh", ["scripts/migrate-deploy.sh"], {
  cwd: server,
  env: {
    ...process.env,
    DATABASE_URL: raw,
    PATH: `${path.join(server, "../research/tools/macos-sed-shim")}:${process.env.PATH}`,
  },
});
