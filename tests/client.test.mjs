import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestImages, normalizeBase, safeError } from '../plugins/vvvcode-image-gen/scripts/client.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aUioAAAAASUVORK5CYII=', 'base64');
async function workspace(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'vvv-test-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
test('base URL has exactly one v1 and rejects insecure remote URLs', () => {
  assert.equal(normalizeBase('https://apis.vvvcode.com/'), 'https://apis.vvvcode.com/v1');
  assert.equal(normalizeBase('https://apis.vvvcode.com/v1/'), 'https://apis.vvvcode.com/v1');
  assert.throws(() => normalizeBase('http://example.com'));
  assert.throws(() => normalizeBase('https://user:secret@example.com'));
});
test('generation sends JSON and saves returned image bytes', () => workspace(async dir => {
  const files = await requestImages({ apiKey: 'test-secret', prompt: 'cat', outputDir: dir,
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://apis.vvvcode.com/v1/images/generations');
      assert.equal(init.headers.Authorization, 'Bearer test-secret');
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'gpt-image-2.6-sunburst');
      assert.equal(body.prompt, 'cat');
      assert.equal(body.size, '1024x1024');
      return Response.json({ data: [{ b64_json: png.toString('base64') }] });
    } });
  assert.deepEqual(await readFile(files[0]), png);
}));
test('editing uploads image and mask files to edits, never generations; defaults to auto', () => workspace(async dir => {
  const image = join(dir, 'source.png');
  await writeFile(image, png);
  const files = await requestImages({ apiKey: 'test-secret', mode: 'edit', images: [image],
    mask: image, prompt: 'replace logo', model: 'flare', outputDir: dir,
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://apis.vvvcode.com/v1/images/edits');
      assert.ok(init.body instanceof FormData);
      assert.equal(init.headers['Content-Type'], undefined);
      assert.equal(init.body.get('size'), 'auto');
      assert.equal(init.body.get('model'), 'gpt-image-2.6-flare');
      assert.deepEqual(Buffer.from(await init.body.get('image').arrayBuffer()), png);
      assert.equal(init.body.get('mask').type, 'image/png');
      return Response.json({ data: [{ b64_json: png.toString('base64') }] });
    } });
  assert.equal(files.length, 1);
}));
test('URL results download without exposing API authorization to CDN', () => workspace(async dir => {
  let calls = 0;
  await requestImages({ apiKey: 'test-secret', prompt: 'cat', outputDir: dir,
    fetchImpl: async (url, init) => {
      calls++;
      if (calls === 1) return Response.json({ data: [{ url: 'https://cdn.example.com/result' }] });
      assert.equal(init.headers?.Authorization, undefined);
      return new Response(png);
    } });
  assert.equal(calls, 2);
}));
test('failures redact credentials and do not silently retry paid requests', () => workspace(async dir => {
  let calls = 0;
  await assert.rejects(requestImages({ apiKey: 'test-secret', prompt: 'cat', outputDir: dir,
    fetchImpl: async () => { calls++; return new Response('bad test-secret', { status: 400 }); }
  }), /HTTP 400/);
  assert.equal(calls, 1);
  assert.ok(!safeError(new Error('bad test-secret'), 'test-secret').includes('test-secret'));
}));
test('invalid arguments fail before any network call', async () => {
  const fetchImpl = () => assert.fail('must not call API');
  for (const options of [{ mode: 'edit' }, { n: 0 }, { model: 'typo' }, { size: 'bad' }]) {
    await assert.rejects(requestImages({ apiKey: 'test', prompt: 'cat', fetchImpl, ...options }));
  }
});
test('transparent output fields reach both JSON and multipart requests', () => workspace(async dir => {
  const image = join(dir, 'source.png');
  await writeFile(image, png);
  for (const mode of ['generate', 'edit']) {
    await requestImages({ apiKey: 'test', mode, images: mode === 'edit' ? [image] : [],
      prompt: 'cat', background: 'transparent', outputFormat: 'png', outputDir: dir,
      fetchImpl: async (url, init) => {
        const field = key => init.body instanceof FormData ? init.body.get(key) : JSON.parse(init.body)[key];
        assert.equal(field('background'), 'transparent');
        assert.equal(field('output_format'), 'png');
        return Response.json({ data: [{ b64_json: png.toString('base64') }] });
      } });
  }
}));
test('transparent JPEG is rejected without spending a request', async () => {
  await assert.rejects(requestImages({ apiKey: 'test', prompt: 'cat',
    background: 'transparent', outputFormat: 'jpeg',
    fetchImpl: () => assert.fail('must not spend') }), /transparent/i);
});
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAAUAAAALAAAAAABAAEAAAICRAEAIfkEABQAAAAsAAAAAAEAAQAAAgJEAQA7', 'base64');
test('GIF fields reach generation and edit endpoints and real GIF bytes get a gif suffix', () => workspace(async dir => {
  const image = join(dir, 'source.png');
  await writeFile(image, png);
  for (const mode of ['generate', 'edit']) {
    const files = await requestImages({ apiKey:'test', mode, images:mode === 'edit' ? [image] : [],
      prompt:'cat waving in a seamless loop', outputFormat:'gif', frameCount:15, frameDurationMs:200,
      complexity:'medium', outputDir:dir,
      fetchImpl:async (url, init) => {
        const field = key => init.body instanceof FormData ? init.body.get(key) : JSON.parse(init.body)[key];
        assert.equal(field('output_format'), 'gif');
        assert.equal(Number(field('frame_count')), 15);
        assert.equal(Number(field('frame_duration_ms')), 200);
        assert.equal(field('size'), 'auto');
        assert.equal(field('complexity'), 'medium');
        return Response.json({data:[{b64_json:gif.toString('base64')}]});
      }});
    assert.match(files[0], /\.gif$/);
    assert.deepEqual(await readFile(files[0]), gif);
  }
}));
test('markup uploads its own transparent PNG bytes, separate from source', () => workspace(async dir => {
  const source=join(dir,'source.png'), markup=join(dir,'markup.png');
  const overlay=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=', 'base64');
  await writeFile(source,png); await writeFile(markup,overlay);
  await requestImages({apiKey:'test',mode:'edit',images:[source],markup,prompt:'edit circled area',outputDir:dir,
    fetchImpl:async (url,init)=>{
      assert.equal(url,'https://apis.vvvcode.com/v1/images/edits');
      assert.deepEqual(Buffer.from(await init.body.get('markup').arrayBuffer()),overlay);
      assert.deepEqual(Buffer.from(await init.body.get('image').arrayBuffer()),png);
      return Response.json({data:[{b64_json:png.toString('base64')}]});
    }});
}));
test('invalid animation and markup combinations fail before spending',async()=>{
  let calls=0;
  const fetchImpl=()=>{calls++;throw new Error('unexpected network call');};
  for(const options of [
    {outputFormat:'gif',frameCount:17}, {outputFormat:'gif',frameCount:1},
    {outputFormat:'gif',frameDurationMs:10}, {frameCount:4},
    {outputFormat:'gif',mask:'mask.png',mode:'edit',images:['source.png']},
    {markup:'overlay.png'}, {mode:'edit',images:['source.png'],mask:'mask.png',markup:'overlay.png'},
    {complexity:'extreme'}, {size:'513x512'},
  ]) await assert.rejects(requestImages({apiKey:'test',prompt:'cat',fetchImpl,...options}),
    /frame|GIF|markup|complexity|divisible|size/i);
  assert.equal(calls,0);
});
test('an explicitly pinned 2.5 model remains available',()=>workspace(async dir=>{
  await requestImages({apiKey:'test',prompt:'cat',model:'gpt-image-2.5-flare',outputDir:dir,
    fetchImpl:async(url,init)=>{
      assert.equal(JSON.parse(init.body).model,'gpt-image-2.5-flare');
      return Response.json({data:[{b64_json:png.toString('base64')}]});
    }});
}));
