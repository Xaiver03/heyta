import { verifyOidcRuntime } from '../src/central-auth/oidc-runtime';

verifyOidcRuntime().then((result) => {
  console.log(JSON.stringify({ result: 'OIDC_RUNTIME_OK', ...result }));
}).catch(() => {
  // Never print module/configuration errors containing operational paths or credentials.
  console.error('OIDC_RUNTIME_FAILED');
  process.exitCode = 1;
});
