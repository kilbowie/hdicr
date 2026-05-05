/**
 * Bundle all Lambda services into self-contained CommonJS files.
 *
 * Replaces the bare `tsc` build for each service. esbuild inlines all workspace
 * package imports (@trulyimagined/*) so the Lambda zip contains no external
 * node_modules references. Only @aws-sdk/* (provided by the Lambda runtime) and
 * pg-native (optional native addon — pg falls back to pure JS when absent) are
 * left external.
 */

import * as esbuild from 'esbuild';

const services = [
  {
    name: 'identity-service',
    entry: 'services/identity-service/src/index.ts',
    outfile: 'services/identity-service/dist/index.js',
  },
  {
    name: 'consent-service',
    entry: 'services/consent-service/src/index.ts',
    outfile: 'services/consent-service/dist/index.js',
  },
  {
    name: 'licensing-service',
    entry: 'services/licensing-service/src/index.ts',
    outfile: 'services/licensing-service/dist/index.js',
  },
  {
    name: 'representation-service',
    entry: 'services/representation-service/src/index.ts',
    outfile: 'services/representation-service/dist/index.js',
  },
];

const sharedConfig = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['@aws-sdk/*', 'pg-native'],
  sourcemap: true,
  logLevel: 'info',
};

let failed = false;
for (const svc of services) {
  try {
    process.stdout.write(`Bundling ${svc.name}... `);
    await esbuild.build({ ...sharedConfig, entryPoints: [svc.entry], outfile: svc.outfile });
    console.log('done');
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    failed = true;
  }
}

if (failed) process.exit(1);
