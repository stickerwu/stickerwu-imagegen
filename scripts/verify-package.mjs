import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

if (!process.env.npm_execpath) throw new Error('Run through npm: npm run pack:verify -- [destination]');
const directory = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(join(tmpdir(), 'stickerwu-package-'));
await mkdir(directory, { recursive: true });
const [pack] = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--json', '--ignore-scripts', '--pack-destination', directory], { encoding: 'utf8' }));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const files = new Set(pack.files.map(file => file.path));
const documentation = ['PRIVACY.md', 'TERMS.md', 'CHANGELOG.md', 'AGENTS.md', 'docs/usage.md',
  'docs/marketplaces.md', 'docs/releases.md', 'docs/submissions/awesome-dsh-plugin/PR.md',
  'docs/submissions/awesome-dsh-plugin/stickerwu__stickerwu-imagegen.yml'];
for (const file of [...documentation, 'package.json', 'cordis.patch.yml', 'README.md', 'LICENSE',
  'adapters/deepseek-harness/index.mjs', 'adapters/deepseek-harness/bridge.mjs',
  'plugins/stickerwu-imagegen/scripts/client.mjs', 'plugins/stickerwu-imagegen/scripts/config.mjs',
  'plugins/stickerwu-imagegen/scripts/review-server.mjs', 'plugins/stickerwu-imagegen/scripts/stream.mjs',
  'plugins/stickerwu-imagegen/ui/review.mjs', 'plugins/stickerwu-imagegen/ui/index.html', 'plugins/stickerwu-imagegen/ui/review.css',
  'plugins/stickerwu-imagegen/.claude-plugin/plugin.json', 'plugins/stickerwu-imagegen/.codex-plugin/plugin.json',
  'plugins/stickerwu-imagegen/assets/icon.png',
  'plugins/stickerwu-imagegen/skills/stickerwu-imagegen/SKILL.md']) assert.ok(files.has(file), `Missing packaged dependency: ${file}`);
for (const file of files) {
  assert.ok([...documentation, 'package.json', 'cordis.patch.yml', 'README.md', 'LICENSE'].includes(file) ||
    file.startsWith('adapters/deepseek-harness/') || file.startsWith('plugins/stickerwu-imagegen/'), `Unexpected packed file: ${file}`);
  assert.ok(!/(?:^|\/)(?:node_modules|outputs|\.env|config\.json|session\.json|\.git)(?:\/|$)/.test(file), `Private/local file packed: ${file}`);
}
assert.equal(pack.name, pkg.name); assert.equal(pack.version, pkg.version);
console.log(JSON.stringify({ passed: true, package: pack.name, version: pack.version,
  files: files.size, bytes: pack.size, tarball: join(directory, pack.filename), integrity: pack.integrity }));
