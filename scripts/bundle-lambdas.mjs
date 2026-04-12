#!/usr/bin/env node
/**
 * Bundle Lambda functions with esbuild.
 * Produces self-contained dist/index.js for each service so workspace
 * packages (@trulyimagined/*) are inlined and Lambda runtime finds no
 * missing modules.
 *
 * Usage: node scripts/bundle-lambdas.mjs
 */

import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Resolve workspace package paths relative to repo root
const alias = {
  '@trulyimagined/database':  path.resolve(root, 'infra/database/src/index.ts'),
  '@trulyimagined/middleware': path.resolve(root, 'shared/middleware/src/index.ts'),
  '@trulyimagined/utils':     path.resolve(root, 'shared/utils/src/index.ts'),
  '@trulyimagined/types':     path.resolve(root, 'shared/types/src/index.ts'),
};

const services = [
  { name: 'identity-service',       entry: 'services/identity-service/src/index.ts' },
  { name: 'consent-service',        entry: 'services/consent-service/src/index.ts' },
  { name: 'licensing-service',      entry: 'services/licensing-service/src/index.ts' },
  { name: 'representation-service', entry: 'services/representation-service/src/index.ts' },
];

async function bundleAll() {
  for (const svc of services) {
    const outfile = path.resolve(root, svc.entry.replace(/^services\//, 'services/').replace('src/index.ts', 'dist/index.js'));
    console.log(`\nBundling ${svc.name} → ${outfile}`);

    await build({
      entryPoints: [path.resolve(root, svc.entry)],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      outfile,
      alias,
      // pg-native is an optional native addon — exclude it at bundle time
      external: ['pg-native'],
      // Keep pg's dynamic require patterns working
      mainFields: ['main'],
      sourcemap: false,
      minify: false,
      logLevel: 'info',
    });

    console.log(`✅ ${svc.name} bundled successfully`);
  }
  console.log('\nAll Lambda functions bundled.');
}

bundleAll().catch((err) => {
  console.error('Bundle failed:', err);
  process.exit(1);
});
