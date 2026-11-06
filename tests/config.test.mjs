import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigStore } from '../plugins/vvvcode-image-gen/scripts/config.mjs';

async function setup(t, value = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'stickerwu-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify(value));
  return { configPath, store: await createConfigStore({ configPath, env: {} }) };
}

test('legacy configuration loads without losing its key or model; saves remain readable by old versions', async t => {
  const { store, configPath } = await setup(t, { apiKey: 'legacy-test-key', baseUrl: 'https://old.example/v1', model: 'flare', extra: 'keep' });
  assert.equal(store.resolve().apiKey, 'legacy-test-key');
  assert.equal(store.resolve().model, 'flare');
  assert.equal(store.describe().activeProfile, 'default');
  await store.saveProfile({ name: 'second', baseUrl: 'https://new.example', apiKey: 'second-test-key' });
  const saved = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(saved.apiKey, 'second-test-key');
  assert.equal(saved.baseUrl, 'https://new.example/v1');
  assert.equal(saved.extra, 'keep');
  assert.equal(saved.profiles.default.apiKey, 'legacy-test-key');
  await store.useProfile('default');
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).apiKey, 'legacy-test-key');
});

test('new profiles never inherit keys, endpoint changes clear old keys, and public settings redact credentials', async t => {
  const { store } = await setup(t, { apiKey: 'legacy-test-key', baseUrl: 'https://old.example' });
  await store.saveProfile({ name: 'new', baseUrl: 'https://new.example' });
  assert.equal(store.resolve().apiKey, '');
  assert.equal(store.describe().hasKey, false);
  await store.saveProfile({ name: 'new', baseUrl: 'https://new.example', apiKey: 'new-test-key' });
  await store.saveProfile({ name: 'new', baseUrl: 'https://other.example' });
  assert.equal(store.resolve().apiKey, '');
  assert.doesNotMatch(JSON.stringify(store.describe()), /legacy-test-key|new-test-key|"apiKey"/);
  await assert.rejects(store.saveProfile({ name: '../bad', baseUrl: 'https://valid.example' }), /profile name/i);
  await assert.rejects(store.saveProfile({ name: 'bad', baseUrl: 'https://user:secret@example.com' }), /base URL/i);
  await assert.rejects(store.useProfile('missing'), /Unknown API profile/);
});

test('old clients may still change active top-level configuration; explicit profiles isolate environment overrides', async t => {
  const { configPath, store } = await setup(t, { apiKey: 'legacy-test-key', baseUrl: 'https://old.example' });
  await store.saveProfile({ name: 'custom', baseUrl: 'https://custom.example', apiKey: 'custom-test-key' });
  const raw = JSON.parse(await readFile(configPath, 'utf8'));
  raw.apiKey = 'old-client-test-key';
  await writeFile(configPath, JSON.stringify(raw));
  const reloaded = await createConfigStore({ configPath, env: { VVVCODE_API_KEY: 'env-test-key', VVVCODE_BASE_URL: 'https://env.example' } });
  assert.equal(reloaded.resolve().apiKey, 'env-test-key');
  assert.equal(reloaded.resolve({ profile: 'custom' }).apiKey, 'old-client-test-key');
  assert.equal(reloaded.resolve({ profile: 'default' }).baseUrl, 'https://old.example/v1');
  const renamedEnv = await createConfigStore({ configPath, env: { STICKERWU_IMAGEGEN_API_KEY: 'renamed-test-key', STICKERWU_IMAGEGEN_BASE_URL: 'https://renamed.example', VVVCODE_API_KEY: 'old-env-test-key' } });
  assert.equal(renamedEnv.resolve().apiKey, 'renamed-test-key');
  assert.equal(renamedEnv.resolve().baseUrl, 'https://renamed.example/v1');
});

test('URL-only overrides never reuse a saved key for a different endpoint', async t => {
  const { configPath, store } = await setup(t, { apiKey: 'endpoint-bound-test-key', baseUrl: 'https://saved.example/v1' });
  assert.equal(store.resolve({ baseUrl: 'https://other.example' }).apiKey, '');
  assert.equal(store.resolve({ profile: 'default', baseUrl: 'https://other.example' }).apiKey, '');
  assert.equal(store.resolve({ baseUrl: 'https://saved.example/' }).apiKey, 'endpoint-bound-test-key');
  assert.equal(store.resolve({ baseUrl: 'https://other.example', apiKey: 'explicit-endpoint-test-key' }).apiKey, 'explicit-endpoint-test-key');
  for (const variable of ['STICKERWU_IMAGEGEN_BASE_URL', 'VVVCODE_BASE_URL']) {
    const changed = await createConfigStore({ configPath, env: { [variable]: 'https://other.example' } });
    assert.equal(changed.resolve().apiKey, '');
  }
});
