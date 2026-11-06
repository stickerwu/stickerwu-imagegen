import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { createReviewSession } from '../plugins/vvvcode-image-gen/scripts/review-server.mjs';
import { createConfigStore } from '../plugins/vvvcode-image-gen/scripts/config.mjs';

function png(width = 32, height = 32, overlay = false) {
  const chunk = (name, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(name), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (width * 4 + 1) + 1 + x * 4;
    pixels[i] = 200; pixels[i + 3] = !overlay || (x === 0 && y === 0) ? 255 : 0;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = bytes => `data:image/png;base64,${bytes.toString('base64')}`;
async function setup(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'vvv-review-'));
  const source = join(dir, 'input.png'); await writeFile(source, png());
  const calls = [];
  const session = await createReviewSession({
    image: source, outputDir: dir, apiKey: 'test-private-key', model: 'sunburst',
    editImpl: async args => {
      calls.push(args);
      const output = join(args.outputDir, `result-${calls.length}.png`);
      await writeFile(output, png(48, 32)); return [output];
    }, ...options,
  });
  t.after(async () => { await session.close(); await rm(dir, { recursive: true, force: true }); });
  const get = path => fetch(session.url + path);
  const post = (path, value, headers = {}) => fetch(session.url + path, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: new URL(session.url).origin, ...headers },
    body: JSON.stringify(value),
  });
  const state = () => get('api/state').then(r => r.json());
  return { session, dir, source, calls, get, post, state };
}
async function settled(state) {
  for (let i = 0; i < 200; i++) {
    const value = await state(); if (!value.busy) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Review job did not settle.');
}
const submission = state => ({
  requestId: randomUUID(), revision: state.revision, sourceId: state.currentId,
  prompt: '只修改圈选区域，保留其他内容。', markup: dataUrl(png(32, 32, true)),
});
test('canvas saves and switches API profiles without a paid call, redacts keys and keeps session exports credential-free', async t => {
  const configDir = await mkdtemp(join(tmpdir(), 'stickerwu-review-config-'));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const configStore = await createConfigStore({ configPath: join(configDir, 'config.json'), env: {} });
  const { post, get, state, calls, session } = await setup(t, { configStore, apiKey: '' });
  assert.equal((await state()).connection.hasKey, false);
  assert.equal((await post('api/submit', submission(await state()))).status, 400);
  const saved = await post('api/config', { action: 'save', name: 'custom', baseUrl: 'https://custom.example', apiKey: 'custom-test-private-key' });
  assert.equal(saved.status, 200);
  assert.doesNotMatch(await saved.text(), /custom-test-private-key|"apiKey"/);
  assert.equal(calls.length, 0);
  assert.equal((await post('api/config', { action: 'switch', name: 'default' })).status, 200);
  assert.equal((await state()).connection.hasKey, false);
  assert.equal((await post('api/config', { action: 'switch', name: 'custom' }, { origin: 'https://external.example' })).status, 403);
  assert.equal((await post('api/config', { action: 'switch', name: 'custom' })).status, 200);
  assert.equal((await post('api/submit', submission(await state()))).status, 202);
  await settled(state);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].baseUrl, 'https://custom.example/v1');
  assert.equal(calls[0].apiKey, 'custom-test-private-key');
  for (const path of ['api/state', 'api/config']) assert.doesNotMatch(await (await get(path)).text(), /custom-test-private-key/);
  assert.doesNotMatch(await readFile(join(session.sessionDir, 'session.json'), 'utf8'), /custom-test-private-key|"apiKey"/);
});
test('API settings cannot switch a connection during a running request', async t => {
  const configDir = await mkdtemp(join(tmpdir(), 'stickerwu-busy-'));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const configStore = await createConfigStore({ configPath: join(configDir, 'config.json'), env: {} });
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { post, state } = await setup(t, { configStore, editImpl: async () => { await blocked; throw new Error('mock completed'); } });
  assert.equal((await post('api/submit', submission(await state()))).status, 202);
  assert.equal((await post('api/config', { action: 'switch', name: 'default' })).status, 409);
  release(); await settled(state);
});
test('per-request model and output settings are validated, persisted and forwarded to one call',async t=>{
  const {post,state,calls,session}=await setup(t);
  const initial=await state();
  for(const options of [{size:'3840x3840'},{outputFormat:'png',outputCompression:50},{model:'oops'},{apiKey:'forbidden'}]) {
    assert.equal((await post('api/submit',{...submission(initial),options})).status,400);
  }
  assert.equal(calls.length,0);
  const options={model:'flare',size:'2048x2048',quality:'max',complexity:'low',outputFormat:'png',stream:true,partialImages:1};
  assert.equal((await post('api/submit',{...submission(initial),options})).status,202);
  const next=await settled(state);
  assert.equal(calls.length,1);
  for(const [key,value] of Object.entries({...options,model:'gpt-image-2.6-flare'}))assert.equal(calls[0][key],value);
  const disk=JSON.parse(await readFile(join(session.sessionDir,'session.json'),'utf8'));
  assert.equal(disk.attempts[0].options.quality,'max');
  assert.equal(next.images.at(-1).options.model,'gpt-image-2.6-flare');
});
test('SVG final output keeps its MIME and bytes and is rejected as an edit source or reference before a round starts',async t=>{
  let calls=0;
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="10" height="10"/></svg>');
  const {post,state,get,session}=await setup(t,{editImpl:async args=>{
    calls++;const file=join(args.outputDir,'icon.svg');await writeFile(file,svg);return [file];
  }});
  const initial=await state();
  assert.equal((await post('api/submit',{requestId:randomUUID(),revision:initial.revision,mode:'generate',prompt:'icon',
    options:{outputFormat:'svg',model:'flare'}})).status,202);
  const next=await settled(state),entry=next.images.at(-1);
  assert.equal(entry.format,'svg');assert.equal(entry.width,1024);assert.equal(entry.editable,false);
  const response=await fetch(new URL(entry.src,new URL((await get('')).url).origin));
  assert.match(response.headers.get('content-type'),/image\/svg\+xml/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),svg);
  assert.equal((await post('api/submit',{...submission(next),markup:undefined})).status,400);
  assert.equal((await post('api/submit',{requestId:randomUUID(),revision:next.revision,mode:'generate',prompt:'use reference',
    referenceIds:[entry.id],options:{outputFormat:'png',model:'flare'}})).status,400);
  assert.equal(calls,1);
  assert.equal(JSON.parse(await readFile(join(session.sessionDir,'session.json'),'utf8')).attempts.length,1);
});
test('stream partials appear while busy and do not create a final canvas image',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const {post,state,get}=await setup(t,{editImpl:async args=>{
    const file=join(args.outputDir,'preview.png');await writeFile(file,png());
    await args.onProgress({event:'partial_image',index:0,file,format:'png'});
    await gate;throw new Error('stream ended without completed event');
  }});
  const initial=await state();
  assert.equal((await post('api/submit',{...submission(initial),options:{stream:true,partialImages:1}})).status,202);
  let active;
  for(let i=0;i<100;i++){
    active=await state();if(active.preview)break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  try {
    assert.equal(active.busy,true);assert.equal(active.images.length,1);
    assert.equal((await get('api/preview')).status,200);
  } finally {release();}
  const next=await settled(state);
  assert.equal(next.images.length,1);assert.equal(next.preview,null);
});
test('startup defaults and frame options survive finish and reopen without a new request',async t=>{
  const {session,state,post,calls}=await setup(t,{quality:'max',complexity:'low',size:'2048x2048',outputFormat:'webp',outputCompression:75});
  const initial=await state();
  const node={id:randomUUID(),x:0,y:0,width:360,height:360,prompt:'',shapes:[],
    options:{model:'gpt-image-2.6-flare',size:'auto',quality:'xhigh',outputFormat:'png'}};
  assert.equal((await post('api/layout',{camera:{x:0,y:0,zoom:1},nodes:[node]})).status,200);
  await session.close();
  const resumed=await createReviewSession({session:session.sessionDir,apiKey:'test',editImpl:()=>assert.fail('no paid call')});
  try {
    const saved=await fetch(resumed.url+'api/state').then(r=>r.json());
    for(const key of ['quality','complexity','size','outputFormat','outputCompression'])assert.equal(saved.defaults[key],initial.defaults[key]);
    assert.deepEqual(saved.layout.nodes[0].options,node.options);assert.equal(calls.length,0);
  } finally {await resumed.close();}
});
test('a complete frame settings object can unset optional startup defaults',async t=>{
  const {post,state,calls}=await setup(t,{quality:'max',complexity:'high',outputCompression:75,outputFormat:'webp'});
  const initial=await state();
  assert.equal((await post('api/submit',{...submission(initial),
    options:{model:'gpt-image-2.6-flare',size:'auto',outputFormat:'png'}})).status,202);
  await settled(state);
  assert.equal(calls.length,1);
  for(const key of ['quality','complexity','outputCompression'])assert.equal(calls[0][key],undefined);
  assert.equal(calls[0].outputFormat,'png');
});

test('review submits a separate markup, saves artifacts and edits the latest actual-size result next', async t => {
  const { session, calls, get, post, state } = await setup(t);
  let s = await state();
  assert.equal(s.images.length, 1);
  assert.equal(s.images[0].width, 32);
  assert.equal(JSON.stringify(s).includes('test-private-key'), false);
  assert.equal((await get('')).status, 200);
  assert.equal((await get('ui/review.mjs')).status, 200);
  const first = submission(s);
  assert.equal((await post('api/submit', first)).status, 202);
  s = await settled(state);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'edit');
  assert.equal(calls[0].n, 1);
  assert.equal(calls[0].outputFormat, 'png');
  assert.deepEqual(await readFile(calls[0].images[0]), png());
  assert.deepEqual(await readFile(calls[0].markup), png(32, 32, true));
  assert.equal(s.images.length, 2);
  assert.equal(s.images[1].width, 48);
  const second = { ...submission(s), markup: dataUrl(png(48, 32, true)) };
  assert.equal((await post('api/submit', second)).status, 202);
  s = await settled(state);
  assert.equal(calls[1].images[0], calls[0].outputDir + (process.platform === 'win32' ? '\\' : '/') + 'result-1.png');
  assert.equal(s.images.length, 3);
  const manifest = JSON.parse(await readFile(join(session.sessionDir, 'session.json'), 'utf8'));
  assert.equal(manifest.attempts.length, 2);
  assert.equal(manifest.attempts[0].status, 'succeeded');
  assert.equal(JSON.stringify(manifest).includes('test-private-key'), false);
});

test('review deduplicates submissions and rejects concurrent, stale and malformed edits without another request', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const { post, state } = await setup(t, { editImpl: async args => {
    calls.push(args); await gate;
    const output = join(args.outputDir, 'result.png'); await writeFile(output, png()); return [output];
  } });
  const initial = await state(), payload = submission(initial);
  assert.equal((await post('api/submit', payload)).status, 202);
  assert.equal((await post('api/submit', payload)).status, 202);
  assert.equal((await post('api/submit', submission(initial))).status, 409);
  assert.equal((await post('api/finish', {})).status, 409);
  release(); const updated = await settled(state);
  assert.equal(calls.length, 1);
  assert.equal((await post('api/submit', payload)).status, 202);
  assert.equal((await post('api/submit', submission(initial))).status, 409);
  assert.equal((await post('api/submit', { ...submission(updated), markup: dataUrl(png(16, 16, true)) })).status, 400);
  assert.equal((await post('api/submit', { ...submission(updated), markup: dataUrl(png()) })).status, 400);
  assert.equal((await post('api/submit', { ...submission(updated), prompt: '' })).status, 400);
  assert.equal(calls.length, 1);
});

test('review errors keep the source available and redact credentials without automatic retry', async t => {
  let calls = 0;
  const { post, state, session } = await setup(t, { editImpl: async () => {
    calls++; throw new Error('Provider test-private-key Bearer should-not-leak');
  } });
  assert.equal((await post('api/submit', submission(await state()))).status, 202);
  const s = await settled(state);
  assert.equal(s.images.length, 1); assert.equal(calls, 1);
  assert.match(s.error, /REDACTED/);
  assert.equal(s.error.includes('test-private-key'), false);
  const disk = await readFile(join(session.sessionDir, 'session.json'), 'utf8');
  assert.equal(disk.includes('test-private-key'), false);
  assert.equal(disk.includes('should-not-leak'), false);
});

test('review permits text-only editing and normalized JPEG input with matching independent overlay', async t => {
  const { source, post, state, calls } = await setup(t);
  const payload = submission(await state()); delete payload.markup;
  assert.equal((await post('api/submit', payload)).status, 202);
  await settled(state);
  assert.equal(calls[0].markup, undefined);
  // An oriented JPEG/WebP is baked into a separate unmarked PNG by the browser.
  const jpg = join(source, '..', 'input.jpg'); await writeFile(jpg, Buffer.from([255,216,255,217]));
  const normalized = await setup(t, { image: jpg });
  const jpegState = await normalized.state();
  assert.equal(jpegState.images[0].requiresNormalization, true);
  assert.equal((await normalized.post('api/submit', submission(jpegState))).status, 400);
  assert.equal((await normalized.post('api/submit', { ...submission(jpegState), sourcePng: dataUrl(png()) })).status, 202);
  await settled(normalized.state);
  assert.deepEqual(await readFile(normalized.calls[0].images[0]), png());
});

test('review protects local routes and never exposes keys or arbitrary files', async t => {
  const { session, get, post } = await setup(t);
  assert.equal(new URL(session.url).hostname, '127.0.0.1');
  assert.equal((await fetch(new URL('/', session.url))).status, 404);
  assert.equal((await post('api/submit', {}, { origin: 'https://example.com' })).status, 403);
  assert.equal((await get('image/not-a-session-image')).status, 404);
  assert.equal((await get('ui/client.mjs')).status, 404);
  const response = await get('');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await response.text()).includes('test-private-key'), false);
  assert.equal((await post('api/finish', {})).status, 200);
  await session.done;
});

test('an empty canvas generates from a prompt and preserves an explicit frame size', async t => {
  const { post, state, calls } = await setup(t, { image: undefined });
  const initial = await state();
  assert.equal(initial.images.length, 0);
  const frameId = randomUUID();
  const payload = { requestId: randomUUID(), mode: 'generate', revision: 0,
    canvasNodeId: frameId, prompt: 'A small cartoon kitten.', size: '1536x1024' };
  assert.equal((await post('api/submit', { ...payload, markup: dataUrl(png(32, 32, true)) })).status, 400);
  assert.equal((await post('api/submit', payload)).status, 202);
  const result = await settled(state);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'generate');
  assert.deepEqual(calls[0].images, []);
  assert.equal(calls[0].markup, undefined);
  assert.equal(calls[0].size, '1536x1024');
  assert.equal(result.images[0].canvasNodeId, frameId);
  assert.equal(result.images[0].mode, 'generate');
});

test('canvas layout and imported images persist without calling the paid API', async t => {
  const { post, state, calls, session } = await setup(t, { image: undefined });
  const imported = await post('api/import', { image: dataUrl(png()), name: '示意图' });
  assert.equal(imported.status, 200);
  const s = await state();
  const node = { id: randomUUID(), imageId: s.currentId, x: -340, y: 80, width: 420, height: 420,
    prompt: '保留布局', shapes: [] };
  const layout = { camera: { x: 120, y: -80, zoom: .6 }, nodes: [node] };
  assert.equal((await post('api/layout', layout)).status, 200);
  assert.deepEqual((await state()).layout, layout);
  assert.deepEqual(JSON.parse(await readFile(join(session.sessionDir, 'canvas.json'), 'utf8')), layout);
  assert.equal((await post('api/layout', { ...layout, camera: { x: 0, y: 0, zoom: -1 } })).status, 400);
  assert.equal((await post('api/layout', { ...layout, nodes: [{ ...node, imageId: 'arbitrary-file' }] })).status, 400);
  assert.equal(calls.length, 0);
});

test('a finished canvas can reopen with its images and layout without resubmitting requests', async t => {
  const original = await setup(t);
  const s = await original.state();
  const layout = { camera: { x: 60, y: 30, zoom: 1 }, nodes: [
    { id: randomUUID(), imageId: s.currentId, x: 0, y: 0, width: 400, height: 400, prompt: '', shapes: [] },
  ] };
  await original.post('api/layout', layout);
  await assert.rejects(createReviewSession({ session: original.session.sessionDir, apiKey: 'test-private-key' }), /running|finished/i);
  await original.session.close();
  const reopened = await createReviewSession({ session: original.session.sessionDir, apiKey: 'test-private-key' });
  t.after(() => reopened.close());
  const value = await fetch(reopened.url + 'api/state').then(r => r.json());
  assert.equal(value.images.length, 1);
  assert.deepEqual(value.layout, layout);
  assert.equal(value.busy, false);
  assert.equal(value.finished, false);
  await reopened.close();
});

test('explicit references use edits while retaining generation-frame placement and source integrity', async t => {
  const { post, state, calls } = await setup(t);
  const initial = await state();
  const imported = await post('api/import', { image: dataUrl(png()), name: '参考图', referenceOnly: true });
  assert.equal(imported.status, 200);
  const current = await state(), reference = current.images.at(-1);
  assert.equal(reference.referenceOnly, true);
  assert.equal(current.currentId, initial.currentId);
  const payload = { requestId: randomUUID(), revision: current.revision, mode: 'generate',
    canvasNodeId: randomUUID(), referenceIds: [reference.id], prompt: 'Use this palette for a kitten.', size: '1024x1024' };
  assert.equal((await post('api/submit', { ...payload, referenceIds: ['unknown'] })).status, 400);
  assert.equal((await post('api/submit', { ...payload, referenceIds: Array(5).fill(reference.id) })).status, 400);
  assert.equal((await post('api/submit', payload)).status, 202);
  const result = await settled(state);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'edit');
  assert.equal(calls[0].images.length, 1);
  assert.deepEqual(await readFile(calls[0].images[0]), png());
  assert.equal(result.images.at(-1).mode, 'generate');
  assert.equal(result.images.at(-1).canvasNodeId, payload.canvasNodeId);
});

test('deleted canvas assets and reference selections persist and reject unknown IDs', async t => {
  const { post, state } = await setup(t);
  const s = await state(), imageId = s.currentId;
  const layout = { camera: { x: 0, y: 0, zoom: 1 }, deletedImageIds: [imageId], nodes: [
    { id: randomUUID(), x: 0, y: 0, width: 360, height: 360, prompt: '', shapes: [], referenceIds: [imageId] },
  ] };
  assert.equal((await post('api/layout', layout)).status, 200);
  assert.deepEqual((await state()).layout, layout);
  assert.equal((await post('api/layout', { ...layout, deletedImageIds: ['unknown'] })).status, 400);
  assert.equal((await post('api/layout', { ...layout, nodes: [{ ...layout.nodes[0], referenceIds: ['unknown'] }] })).status, 400);
});
