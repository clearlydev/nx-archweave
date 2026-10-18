import { get } from 'node:https';

// Only called when the caller did not pin an explicit version (see plan.ts) —
// resolves "latest" from the official source, the npm registry. Never invoked during unit
// tests — those inject a fake resolver (see plan.spec.ts).
export function resolveVersionFromNpmRegistry(npmPackage: string): Promise<string> {
  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(npmPackage)}`;
  return new Promise((resolve, reject) => {
    get(registryUrl, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const latest = parsed?.['dist-tags']?.['latest'];
          if (typeof latest !== 'string') {
            reject(new Error(`Could not resolve the latest version of ${npmPackage} from the npm registry.`));
            return;
          }
          resolve(latest);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }).on('error', reject);
  });
}
