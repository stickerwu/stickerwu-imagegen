import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHarnessPlugin } from '../adapters/deepseek-harness/bridge.mjs';
import { createConfigStore } from '../plugins/vvvcode-image-gen/scripts/config.mjs';
import { requestImages } from '../plugins/vvvcode-image-gen/scripts/client.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aUioAAAAASUVORK5CYII=', 'base64');
async function setup(t, fetchImpl, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'stickerwu-harness-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, 'config.json'), source = join(dir, 'source.png');
  await writeFile(configPath, JSON.stringify({ apiKey: 'harness-test-key', baseUrl: 'https://images.example/v1' }));
  await writeFile(source, png);
  const tools = new Map();
  const ctx = { tools: { register: tool => tools.set(tool.name, tool) },
    attachments: { saveImages: async inputs => inputs.map(item => ({ attachmentId: 'fixture-id', mediaType: item.mediaType,
      bytes: item.data.length, width: 1, height: 1, name: item.name })),
      readImage: async reference => { assert.equal(reference.attachmentId, 'source-ref'); return { ref: reference, data: png }; } } };
  const plugin = createHarnessPlugin(ctx, { configPath, outputDir: dir }, {
    defineTool: definition => definition,
    createConfigStore: options => createConfigStore({ ...options, env: {} }),
    requestImages: options => requestImages({ ...options, fetchImpl }),
    ...overrides,
  });
  t.after(() => plugin.dispose());
  return { dir, source, tools, plugin, ctx };
}
test('Harness native tools preserve all four explicit Image 2.5/2.6 models for generation and edit', async t => {
  let expectedModel, expectedMode, calls = 0;
  const state = await setup(t, async (url, init) => {
    calls++; assert.equal(init.headers.Authorization, 'Bearer harness-test-key');
    assert.equal(url, `https://images.example/v1/images/${expectedMode === 'edit' ? 'edits' : 'generations'}`);
    assert.equal(expectedMode === 'edit' ? init.body.get('model') : JSON.parse(init.body).model, expectedModel);
    if (expectedMode === 'edit') assert.deepEqual(Buffer.from(await init.body.get('image').arrayBuffer()), png);
    return Response.json({ data: [{ b64_json: png.toString('base64') }] });
  });
  assert.equal(state.tools.size, 4);
  const exec = { signal: new AbortController().signal };
  for (expectedModel of ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2.6-sunburst', 'gpt-image-2.6-flare']) {
    for (expectedMode of ['generate', 'edit']) {
      const tool = state.tools.get(`stickerwu_imagegen_${expectedMode}`);
      const args = { prompt: 'one cat', model: expectedModel, ...(expectedMode === 'edit' ? { images: [state.source] } : {}) };
      const result = await tool.execute(args, exec);
      assert.equal(result.model, expectedModel); assert.equal(result.files.length, 1);
      assert.deepEqual(await readFile(result.files[0]), png);
      assert.equal(result.images[0].attachmentId, 'fixture-id');
      assert.ok(tool.output.render(args, result).some(block => block.type === 'image'));
      assert.ok(!JSON.stringify(result).includes('harness-test-key'));
    }
  }
  assert.equal(calls, 8);
  const config = await state.tools.get('stickerwu_imagegen_status').execute({}, exec);
  assert.equal(config.hasKey, true); assert.ok(!JSON.stringify(config).includes('harness-test-key'));
});
test('Harness errors redact keys and never retry; 2.5 GIF fails before networking', async t => {
  let calls = 0;
  const { tools } = await setup(t, async () => { calls++; return new Response('harness-test-key', { status: 400 }); });
  const tool = tools.get('stickerwu_imagegen_generate'), exec = { signal: new AbortController().signal };
  await assert.rejects(tool.execute({ prompt: 'cat' }, exec), error => /HTTP 400/.test(error.message) && !error.message.includes('harness-test-key'));
  assert.equal(calls, 1);
  await assert.rejects(tool.execute({ prompt: 'cat', model: 'gpt-image-2.5-flare', outputFormat: 'gif' }, exec), /2.6/);
  assert.equal(calls, 1);
});
test('Harness canvas opens without generating, and plugin disposal closes its session', async t => {
  let calls = 0;
  const { tools, plugin } = await setup(t, async () => { calls++; throw new Error('No image request expected.'); });
  const result = await tools.get('stickerwu_imagegen_canvas').execute({}, { signal: new AbortController().signal });
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:/);
  const state = await (await fetch(result.url + 'api/state')).json();
  assert.equal(state.connection.hasKey, true); assert.ok(!JSON.stringify(state).includes('harness-test-key'));
  assert.equal(calls, 0);
  await plugin.dispose();
  await assert.rejects(fetch(result.url + 'api/state'));
});
test('Harness accepts durable source attachments and retains successful originals when preview storage fails', async t => {
  let calls = 0;
  const { tools, ctx } = await setup(t, async (_url, init) => {
    calls++; assert.deepEqual(Buffer.from(await init.body.get('image').arrayBuffer()), png);
    return Response.json({ data: [{ b64_json: png.toString('base64') }] });
  });
  ctx.attachments.saveImages = async () => { throw new Error('preview store unavailable harness-test-key'); };
  const result = await tools.get('stickerwu_imagegen_edit').execute({ prompt: 'wave paw',
    imageAttachments: [{ attachmentId: 'source-ref' }] }, { signal: new AbortController().signal });
  assert.equal(calls, 1); assert.equal(result.images.length, 0); assert.equal(result.warnings.length, 1);
  assert.ok(!result.warnings[0].includes('harness-test-key')); assert.deepEqual(await readFile(result.files[0]), png);
});
test('a published canvas outlives its tool signal; unloading cancels its own pending image request', async t => {
  let edit, finish, calls = 0, closed = 0, started;
  const ready = new Promise(resolve => { started = resolve; });
  const session = { url: 'http://127.0.0.1:12345/test/', sessionDir: '/fixture',
    done: new Promise(resolve => { finish = resolve; }), close() { closed++; finish(); } };
  const { tools, plugin, dir } = await setup(t, async (_url, init) => {
    calls++; started();
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  }, { createReviewSession: options => { edit = options.editImpl; return session; } });
  const controller = new AbortController();
  await tools.get('stickerwu_imagegen_canvas').execute({}, { signal: controller.signal });
  controller.abort(); assert.equal(closed, 0);
  const pending = edit({ apiKey: 'test-key', prompt: 'cat', outputDir: dir });
  const cancelled = assert.rejects(pending, /abort/i);
  await ready; await plugin.dispose(); await cancelled;
  assert.equal(calls, 1); assert.equal(closed, 1);
});
test('cancelling while a canvas is opening closes it before publishing a URL', async t => {
  let release, opened, finish, closed = 0;
  const started = new Promise(resolve => { opened = resolve; });
  const session = { url: 'http://127.0.0.1:12345/test/', sessionDir: '/fixture',
    done: new Promise(resolve => { finish = resolve; }), close() { closed++; finish(); } };
  const { tools } = await setup(t, async () => { throw new Error('No paid request expected'); }, {
    createReviewSession: () => new Promise(resolve => { release = resolve; opened(); }),
  });
  const controller = new AbortController();
  const pending = tools.get('stickerwu_imagegen_canvas').execute({}, { signal: controller.signal });
  await started; controller.abort(); release(session);
  await assert.rejects(pending, /abort/i); assert.equal(closed, 1);
});
test('unloading during asynchronous configuration preparation prevents a new paid request', async t => {
  let release, started, calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const { tools, plugin } = await setup(t, async () => { throw new Error('No network expected'); }, {
    createConfigStore: () => new Promise(resolve => { release = () => resolve({
      resolve: () => ({ model: 'sunburst', apiKey: 'test-key', baseUrl: 'https://images.example/v1' }),
    }); started(); }),
    requestImages: async () => { calls++; return []; },
  });
  const pending = tools.get('stickerwu_imagegen_generate').execute({ prompt: 'cat' }, { signal: new AbortController().signal });
  await ready;
  const disposed = plugin.dispose(); release();
  await assert.rejects(pending, /abort|unloaded/i); await disposed;
  assert.equal(calls, 0);
});
test('unloading cancels a foreground image POST and waits for its completion without retry', async t => {
  let started, calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const { tools, plugin } = await setup(t, async (_url, init) => {
    calls++; started();
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  });
  const pending = tools.get('stickerwu_imagegen_generate').execute({ prompt: 'cat' }, { signal: new AbortController().signal });
  const rejected = assert.rejects(pending, /abort/i);
  await ready; await plugin.dispose(); await rejected;
  assert.equal(calls, 1);
});
