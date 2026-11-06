import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

test('CLI saves and selects named profiles; old script paths and configuration commands still work', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'stickerwu-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, 'config.json');
  const env = { ...process.env, STICKERWU_IMAGEGEN_CONFIG: configPath,
    STICKERWU_IMAGEGEN_API_KEY: '', STICKERWU_IMAGEGEN_BASE_URL: '', VVVCODE_API_KEY: '', VVVCODE_BASE_URL: '' };
  const cli = (...args) => spawnSync(process.execPath, ['plugins/vvvcode-image-gen/scripts/generate.mjs', ...args], { env, encoding: 'utf8', input: 'cli-test-private-key\n' });
  for (const args of [
    ['--set-config', '--profile', 'work', '--base-url', 'https://work.example/v1', '--key-stdin'],
    ['--set-config', '--profile', 'personal', '--base-url', 'https://personal.example', '--model', 'flare'],
    ['--use-profile', 'work'],
  ]) { const result = cli(...args); assert.equal(result.status, 0, result.stderr); assert.doesNotMatch(result.stdout, /cli-test-private-key/); }
  const result = cli('--get-config');
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.activeProfile, 'work'); assert.equal(config.hasKey, true);
  assert.equal(config.baseUrl, 'https://work.example/v1');
  assert.equal(config.profiles.length, 3);
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).apiKey, 'cli-test-private-key');
  assert.equal(JSON.parse(cli('--get-config', '--profile', 'personal').stdout).hasKey, false);
  assert.match(cli('--help').stdout, /stickerwu imagegen/);
  assert.equal(cli('--use-profile', 'missing').status, 1);
});

test('CLI rejects URL-only endpoint changes before any network call', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'stickerwu-endpoint-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, 'config.json'), mock = join(dir, 'no-network.mjs');
  await writeFile(configPath, JSON.stringify({ apiKey: 'saved-endpoint-test-key', baseUrl: 'https://saved.example/v1' }));
  await writeFile(mock, "globalThis.fetch = async () => { throw new Error('NETWORK_CALLED'); };\n");
  const env = { ...process.env, STICKERWU_IMAGEGEN_CONFIG: configPath, STICKERWU_IMAGEGEN_API_KEY: '',
    STICKERWU_IMAGEGEN_BASE_URL: '', VVVCODE_API_KEY: '', VVVCODE_BASE_URL: '' };
  for (const [flags, overrides] of [
    [['--base-url', 'https://other.example'], {}],
    [[], { STICKERWU_IMAGEGEN_BASE_URL: 'https://other.example' }],
    [[], { VVVCODE_BASE_URL: 'https://other.example' }],
  ]) {
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(mock).href, 'plugins/vvvcode-image-gen/scripts/generate.mjs',
      '--prompt', 'test endpoint configuration', ...flags], { env: { ...env, ...overrides }, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /NETWORK_CALLED|saved-endpoint-test-key/);
    assert.match(result.stderr, /API_KEY/);
  }
});
