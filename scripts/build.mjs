// Builds the extension.
//   node scripts/build.mjs          release build: dist/extension and dist/promptalarm-<version>.zip
//   node scripts/build.mjs --test   test build: dist/extension-test (adds a mock chat site adapter)
//
// The release build contains no test code. The test build differs only by the mock adapter,
// the mock provider entry and host access for localhost.

import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'extension');
const test = process.argv.includes('--test');
const outDir = join(root, 'dist', test ? 'extension-test' : 'extension');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(dirname(outDir), { recursive: true });
cpSync(src, outDir, {
  recursive: true,
  filter: (p) => !/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(p),
});

const providersPath = join(outDir, 'shared', 'providers.js');
let providers = readFileSync(providersPath, 'utf8');

if (test) {
  providers = providers
    .replace(
      '/*__EXTRA_PROVIDERS__*/',
      `mock: { id: 'mock', name: 'Mock chat', hosts: ['localhost', '127.0.0.1'], origins: ['http://localhost/*', 'http://127.0.0.1/*'], allowHttp: true },`
    )
    .replace('/*__EXTRA_ADAPTER_FILES__*/', `'content/adapters/mock.js',`);
  cpSync(join(root, 'test', 'mock-chat', 'mock-adapter.js'), join(outDir, 'content', 'adapters', 'mock.js'));
  const manifestPath = join(outDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = ['http://localhost/*', 'http://127.0.0.1/*'];
  manifest.name = 'PromptAlarm (test build)';
  delete manifest.default_locale;
  manifest.description = 'Test build';
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  rmSync(join(outDir, '_locales'), { recursive: true, force: true });
} else {
  providers = providers.replace('/*__EXTRA_PROVIDERS__*/', '').replace('/*__EXTRA_ADAPTER_FILES__*/', '');
}
writeFileSync(providersPath, providers);

console.log(`built ${relative(root, outDir)}`);

if (!test) {
  const version = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')).version;
  const zipPath = join(root, 'dist', `promptalarm-${version}.zip`);
  rmSync(zipPath, { force: true });
  // zip from inside the folder so manifest.json sits at the top level of the archive
  execFileSync('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: outDir });
  const files = [];
  (function walk(d) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      statSync(p).isDirectory() ? walk(p) : files.push(relative(outDir, p));
    }
  })(outDir);
  console.log(`zip: ${relative(root, zipPath)} (${files.length} files)`);
}
