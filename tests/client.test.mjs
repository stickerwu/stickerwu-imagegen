import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestImages, normalizeBase, safeError } from '../plugins/vvvcode-image-gen/scripts/client.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aUioAAAAASUVORK5CYII=', 'base64');
test('caller cancellation stops an image request without retries, including pre-aborted calls', async () => {
  const first = new AbortController(); first.abort();
  let calls = 0;
  await assert.rejects(requestImages({ apiKey: 'test-key', prompt: 'cat', signal: first.signal,
    fetchImpl: async () => { calls++; throw new Error('unexpected network'); } }), /abort/i);
  assert.equal(calls, 0);
  const controller = new AbortController();
  const pending = requestImages({ apiKey: 'test-key', prompt: 'cat', signal: controller.signal,
    fetchImpl: async (_url, init) => {
      calls++;
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    } });
  controller.abort();
  await assert.rejects(pending, /abort/i); assert.equal(calls, 1);
});
test('caller cancellation interrupts a stalled SSE body and a CDN download without retry', async () => {
  for (const streaming of [true, false]) {
    let calls = 0, cancelled = false;
    const controller = new AbortController();
    const pending = requestImages({ apiKey: 'test-key', prompt: 'cat', signal: controller.signal,
      ...(streaming ? { stream: true } : {}),
      fetchImpl: async (_url, init) => {
        calls++;
        if (streaming) return new Response(new ReadableStream({ start() { setImmediate(() => controller.abort()); }, cancel() { cancelled = true; } }),
          { headers: { 'content-type': 'text/event-stream' } });
        if (calls === 1) return Response.json({ data: [{ url: 'https://cdn.example/result.png' }] });
        assert.equal(init.headers, undefined);
        setImmediate(() => controller.abort());
        return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
      } });
    await assert.rejects(pending, /abort/i);
    assert.equal(calls, streaming ? 1 : 2);
    if (streaming) assert.equal(cancelled, true);
  }
});
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
test('SVG generation saves exact XML bytes and JPEG compression is serialized for both endpoints',()=>workspace(async dir=>{
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><circle r="20"/></svg>');
  const files=await requestImages({apiKey:'test',prompt:'icon',outputFormat:'svg',background:'transparent',outputDir:dir,
    fetchImpl:async()=>Response.json({data:[{b64_json:svg.toString('base64')}]})});
  assert.match(files[0],/\.svg$/); assert.deepEqual(await readFile(files[0]),svg);
  const image=join(dir,'input.png'); await writeFile(image,png);
  const jpeg=Buffer.from([255,216,255,217]);
  for(const mode of ['generate','edit']) await requestImages({apiKey:'test',prompt:'cat',mode,images:mode==='edit'?[image]:[],
    outputFormat:'jpeg',outputCompression:0,outputDir:dir,fetchImpl:async(url,init)=>{
      const fields=init.body instanceof FormData?Object.fromEntries(init.body):JSON.parse(init.body);
      assert.equal(Number(fields.output_compression),0);
      return Response.json({data:[{b64_json:jpeg.toString('base64')}]});
    }});
}));
test('fragmented SSE saves previews separately and only completed events become final results',()=>workspace(async dir=>{
  for(const mode of ['generate','edit']) {
    const image=join(dir,'source.png');await writeFile(image,png);
    const events=[];
    const text=`: heartbeat\r\n\r\nevent: image_${mode==='edit'?'edit':'generation'}.partial_image\r\ndata: ${JSON.stringify({type:`image_${mode==='edit'?'edit':'generation'}.partial_image`,b64_json:png.toString('base64'),partial_image_index:0})}\r\n\r\ndata: ${JSON.stringify({type:`image_${mode==='edit'?'edit':'generation'}.completed`,b64_json:png.toString('base64')})}\n\n`;
    const bytes=new TextEncoder().encode(text);
    const files=await requestImages({apiKey:'test',prompt:'cat',mode,images:mode==='edit'?[image]:[],stream:true,partialImages:2,
      outputDir:dir,onProgress:event=>events.push(event),fetchImpl:async(url,init)=>{
        const fields=init.body instanceof FormData?Object.fromEntries(init.body):JSON.parse(init.body);
        assert.equal(String(fields.stream),'true');assert.equal(Number(fields.partial_images),2);
        return new Response(new ReadableStream({start(controller){
          for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();
        }}),{headers:{'content-type':'text/event-stream'}});
      }});
    assert.equal(files.length,1);assert.equal(events.length,1);
    assert.notEqual(events[0].file,files[0]);assert.deepEqual(await readFile(events[0].file),png);
  }
}));
test('truncated or error SSE never promotes a preview or retries the request',()=>workspace(async dir=>{
  for(const tail of ['', 'data: {"type":"error","error":{"message":"denied test-secret"}}\n\n']) {
    let calls=0;
    await assert.rejects(requestImages({apiKey:'test-secret',prompt:'cat',stream:true,partialImages:1,outputDir:dir,
      fetchImpl:async()=>{
        calls++;return new Response(`data: ${JSON.stringify({type:'image_generation.partial_image',b64_json:png.toString('base64'),partial_image_index:0})}\n\n${tail}`,
          {headers:{'content-type':'text/event-stream'}});
      }}),/completed|denied/);
    assert.equal(calls,1);
  }
}));
test('a mismatched provider format is retained as evidence without becoming a successful result',()=>workspace(async dir=>{
  let calls=0,message='';
  try {
    await requestImages({apiKey:'test',prompt:'cat',outputFormat:'jpeg',outputDir:dir,fetchImpl:async()=>{
      calls++;return Response.json({data:[{b64_json:png.toString('base64')}]});
    }});
    assert.fail('must reject mismatched format');
  }catch(error){message=error.message;}
  assert.equal(calls,1);
  assert.match(message,/provider returned png/);
  const {readdir}=await import('node:fs/promises');
  const files=await readdir(dir);
  assert.equal(files.length,1);assert.match(files[0],/^unexpected-.*\.png$/);
  assert.deepEqual(await readFile(join(dir,files[0])),png);
}));
