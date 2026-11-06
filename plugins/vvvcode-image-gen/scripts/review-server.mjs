import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { requestImages, safeError, MODELS, SUPPORTED_MODELS } from './client.mjs';
import { inspectPng, pngDimensions } from './image-info.mjs';

const PIXEL_LIMIT = 16777216, FILE_LIMIT = 50 * 1024 * 1024;
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function check(value, message, status = 400) {
  if (!value) throw new HttpError(status, message);
}
function stillType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new Error('Annotation review requires a still PNG, JPEG or WebP image.');
}
function validDimensions(info) {
  check(info.width > 0 && info.height > 0 && info.width * info.height <= PIXEL_LIMIT,
    'Image exceeds the 16,777,216 pixel markup limit.');
  return info;
}
function decodePng(data) {
  check(typeof data === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data),
    'Expected a PNG data URL.');
  const bytes = Buffer.from(data.slice('data:image/png;base64,'.length), 'base64');
  check(bytes.length <= FILE_LIMIT, 'PNG exceeds 50 MiB.');
  validDimensions(pngDimensions(bytes));
  return bytes;
}
async function readJson(req) {
  check(req.headers['content-type']?.split(';')[0] === 'application/json', 'Expected application/json.', 415);
  const parts = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    check(size <= 140 * 1024 * 1024, 'Request body exceeds 140 MiB.', 413);
    parts.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new HttpError(400, 'Invalid JSON body.'); }
}
const GUIDE = '\n\n标注线仅用于定位修改区域，请勿将标注线、箭头或圈画绘入最终图像。尽量保留未要求修改的内容。';

// The HTTP interface accepts only session image IDs, never filesystem paths or credentials.
export async function createReviewSession({
  image, session, outputDir = 'outputs', apiKey, baseUrl, model, size = 'auto',
  quality, complexity, background, timeout = 300000, prompt = '',
  editImpl = requestImages, onEvent = () => {}, idleTimeout = 3600000,
} = {}) {
  if (!apiKey) throw new Error('Set VVVCODE_API_KEY or the plugin local configuration first.');
  if (image && session) throw new Error('Choose an initial image or a saved session.');
  const loaded = session ? JSON.parse(await readFile(join(resolve(session), 'session.json'), 'utf8')) : null;
  if (loaded && !loaded.finished) throw new Error('This canvas is still running or was not finished. Reuse its running page; do not restart a paid request.');
  model ||= loaded?.model || 'sunburst';
  if (!SUPPORTED_MODELS.includes(MODELS[model] || model)) throw new Error('Unknown model.');
  if (!Number.isFinite(idleTimeout) || idleTimeout < 1000) throw new Error('Idle timeout must be at least 1000 ms.');
  const sessionDir = session ? resolve(session) : resolve(outputDir, `review-${randomUUID()}`);
  await mkdir(sessionDir, { recursive: true });
  const images = [];
  if (loaded) {
    if (!Array.isArray(loaded.images) || !Array.isArray(loaded.attempts)) throw new Error('Invalid saved canvas.');
    for (const entry of loaded.images) {
      const file = resolve(entry.file), inside = relative(sessionDir, file);
      if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) throw new Error('Saved image must stay inside its canvas folder.');
      stillType(await readFile(file));
      images.push({ ...entry, file });
    }
  } else if (image) {
    const initial = await readFile(image);
    if (initial.length > FILE_LIMIT) throw new Error('Input image exceeds 50 MiB.');
    const type = stillType(initial);
    const dimensions = type === 'png' ? validDimensions(pngDimensions(initial)) : {};
    const original = join(sessionDir, `original.${type}`);
    await copyFile(image, original);
    images.push({ id: randomUUID(), file: original, type, label: '原图', ...dimensions });
  }
  const token = randomBytes(24).toString('hex'), prefix = `/${token}/`;
  const state = { revision: loaded?.revision || 0, currentId: loaded?.currentId || images[0]?.id || null,
    busy: false, error: null, finished: false, attempts: loaded?.attempts || [] };
  let layout = null, layoutPending = Promise.resolve();
  if (loaded) {
    try { layout = JSON.parse(await readFile(join(sessionDir, 'canvas.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read saved canvas layout.'); }
  }
  let pending = Promise.resolve(), lastActivity = Date.now(), closing = false, idleTimer;
  let resolveDone;
  const done = new Promise(resolveDoneFn => { resolveDone = resolveDoneFn; });
  const publicState = () => ({
    revision: state.revision, currentId: state.currentId, busy: state.busy, error: state.error,
    finished: state.finished, model: MODELS[model] || model, prompt, layout,
    images: images.map(({ id, label, type, width, height, sourceId, canvasNodeId, mode, prompt, referenceOnly }) => ({
      id, label, width, height, sourceId, canvasNodeId, mode, prompt, referenceOnly, format: type, requiresNormalization: type !== 'png',
      src: `${prefix}image/${id}`,
    })),
  });
  async function persist(overrides = {}) {
    const path = join(sessionDir, 'session.json');
    await writeFile(`${path}.tmp`, JSON.stringify({ ...state, ...overrides, model: MODELS[model] || model, images }, null, 2) + '\n');
    await rename(`${path}.tmp`, path);
  }
  const emit = event => onEvent({ ...event, sessionDir });
  const assets = new Map();
  for (const [path, file, contentType] of [
    ['', 'index.html', 'text/html; charset=utf-8'],
    ['ui/review.mjs', 'review.mjs', 'text/javascript; charset=utf-8'],
    ['ui/canvas-model.mjs', 'canvas-model.mjs', 'text/javascript; charset=utf-8'],
    ['ui/review.css', 'review.css', 'text/css; charset=utf-8'],
  ]) assets.set(path, { bytes: await readFile(new URL(`../ui/${file}`, import.meta.url)), contentType });

  async function runEdit(attempt, source, sourceBytes, markupBytes) {
    try {
      const roundDir = join(sessionDir, `round-${String(state.attempts.length).padStart(3, '0')}`);
      await mkdir(roundDir);
      attempt.directory = roundDir;
      let sourceFile = source?.file;
      if (sourceBytes) {
        sourceFile = join(roundDir, 'source.png'); await writeFile(sourceFile, sourceBytes);
      }
      let markup;
      if (markupBytes) {
        markup = join(roundDir, 'markup.png'); await writeFile(markup, markupBytes);
      }
      attempt.source = sourceFile; attempt.markup = markup;
      const apiPrompt = attempt.prompt + (attempt.mode === 'edit' ? GUIDE : '');
      await writeFile(join(roundDir, 'prompt.txt'), apiPrompt, 'utf8');
      await persist();
      const references = (attempt.referenceIds || []).map(id => images.find(entry => entry.id === id).file);
      const files = await editImpl({
        apiKey, baseUrl, mode: attempt.mode === 'edit' || references.length ? 'edit' : 'generate', model, size: attempt.mode === 'generate' ? attempt.size : size,
        quality, complexity, background, timeout,
        prompt: apiPrompt, images: [...(sourceFile ? [sourceFile] : []), ...references], markup,
        outputFormat: 'png', n: 1, outputDir: roundDir,
      });
      if (!Array.isArray(files) || files.length !== 1) throw new Error('Expected exactly one edited PNG.');
      const info = pngDimensions(await readFile(files[0]));
      const next = { id: randomUUID(), file: resolve(files[0]), type: 'png',
        label: `第 ${state.revision + 1} 版`, width: info.width, height: info.height,
        sourceId: source?.id, canvasNodeId: attempt.canvasNodeId, mode: attempt.mode, prompt: attempt.prompt };
      images.push(next); state.currentId = next.id; state.revision++;
      attempt.status = 'succeeded'; attempt.resultId = next.id; attempt.result = next.file;
      state.error = null;
      emit({ event: 'generated', mode: attempt.mode, requestId: attempt.id, files: [next.file], width: info.width, height: info.height });
    } catch (error) {
      attempt.status = 'failed'; attempt.error = safeError(error, apiKey);
      state.error = attempt.error;
      emit({ event: 'error', requestId: attempt.id, error: state.error });
    } finally {
      lastActivity = Date.now();
      // Keep the in-memory lock until the completed round is safely on disk.
      await persist({ busy: false });
      state.busy = false;
    }
  }
  let authority;
  const server = createServer(async (req, res) => {
    const send = (status, value, contentType = 'application/json; charset=utf-8') => {
      res.writeHead(status, {
        'content-type': contentType, 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      });
      res.end(Buffer.isBuffer(value) ? value : JSON.stringify(value));
    };
    try {
      check(req.headers.host === authority, 'Invalid local host.', 403);
      const pathname = new URL(req.url, `http://${authority}`).pathname;
      check(pathname.startsWith(prefix), 'Unknown session.', 404);
      const route = pathname.slice(prefix.length);
      if (req.method === 'GET' && assets.has(route)) {
        const asset = assets.get(route); return send(200, asset.bytes, asset.contentType);
      }
      if (req.method === 'GET' && route === 'api/state') return send(200, publicState());
      if (req.method === 'GET' && route.startsWith('image/')) {
        const entry = images.find(item => item.id === route.slice(6));
        check(entry, 'Unknown image.', 404);
        return send(200, await readFile(entry.file), `image/${entry.type}`);
      }
      check(req.method === 'POST' && ['api/submit', 'api/finish', 'api/layout', 'api/import'].includes(route), 'Not found.', 404);
      check(req.headers.origin === `http://${authority}`, 'This action must come from the local review page.', 403);
      const payload = await readJson(req);
      check(payload && typeof payload === 'object' && !Array.isArray(payload), 'Expected a JSON object.');
      check(!closing && !state.finished, 'Session has finished.', 409);
      if (route === 'api/layout') {
        const { camera, nodes, deletedImageIds } = payload;
        const finite = (value, limit = 10000000) => Number.isFinite(value) && Math.abs(value) <= limit;
        check(camera && finite(camera.x) && finite(camera.y) && camera.zoom >= .05 && camera.zoom <= 5,
          'Invalid canvas camera.');
        check(Array.isArray(nodes) && nodes.length <= 300, 'Canvas allows up to 300 frames.');
        const knownImages = new Set(images.map(entry => entry.id));
        const validRefs = refs => Array.isArray(refs) && refs.length <= 4 &&
          new Set(refs).size === refs.length && refs.every(id => knownImages.has(id));
        check(deletedImageIds === undefined || Array.isArray(deletedImageIds) &&
          deletedImageIds.length <= images.length && deletedImageIds.every(id => knownImages.has(id)), 'Unknown deleted canvas image.');
        const ids = new Set();
        for (const node of nodes) {
          check(node && /^[a-f0-9-]{36}$/i.test(node.id) && !ids.has(node.id), 'Invalid canvas node ID.');
          ids.add(node.id);
          check(!node.imageId || images.some(entry => entry.id === node.imageId), 'Unknown canvas image.');
          check(finite(node.x) && finite(node.y) && node.width >= 64 && node.width <= 5000 &&
            node.height >= 32 && node.height <= 10000, 'Invalid frame dimensions.');
          check(typeof node.prompt === 'string' && node.prompt.length <= 32000, 'Invalid frame prompt.');
          check(node.referenceIds === undefined || validRefs(node.referenceIds), 'Invalid frame references.');
          check(Array.isArray(node.shapes) && node.shapes.length <= 2000, 'Too many annotations.');
          let points = 0;
          for (const shape of node.shapes) {
            check(['pen', 'ellipse', 'rectangle', 'arrow', 'text'].includes(shape.tool) &&
              /^#[a-f0-9]{6}$/i.test(shape.color) && shape.width >= 1 && shape.width <= 100, 'Invalid annotation.');
            check(Array.isArray(shape.points) && shape.points.length > 0, 'Invalid annotation points.');
            points += shape.points.length;
            check(points <= 100000 && shape.points.every(point => finite(point.x) && finite(point.y)), 'Too many annotation points.');
            check(shape.text === undefined || typeof shape.text === 'string' && shape.text.length <= 2000, 'Invalid annotation text.');
          }
        }
        // A separate serialized file avoids racing with a generation's session manifest.
        const saved = JSON.stringify({ camera, nodes, ...(deletedImageIds === undefined ? {} : { deletedImageIds }) });
        layoutPending = layoutPending.catch(() => {}).then(async () => {
          await writeFile(join(sessionDir, 'canvas.json.tmp'), saved);
          await rename(join(sessionDir, 'canvas.json.tmp'), join(sessionDir, 'canvas.json'));
          layout = JSON.parse(saved);
        });
        await layoutPending; lastActivity = Date.now();
        return send(200, { ok: true });
      }
      if (route === 'api/import') {
        check(!state.busy, 'Wait for the current request before importing.', 409);
        check(typeof payload.image === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(payload.image),
          'Import a still PNG, JPEG or WebP image.');
        const bytes = Buffer.from(payload.image.slice(payload.image.indexOf(',') + 1), 'base64');
        check(bytes.length <= FILE_LIMIT, 'Input image exceeds 50 MiB.');
        const type = stillType(bytes), dimensions = type === 'png' ? validDimensions(pngDimensions(bytes)) : {};
        const id = randomUUID(), file = join(sessionDir, `import-${id}.${type}`);
        state.busy = true;
        try {
          await writeFile(file, bytes, { flag: 'wx' });
          images.push({ id, file, type, label: typeof payload.name === 'string' ? payload.name.slice(0, 100) : '导入图片',
            ...(payload.referenceOnly === true ? { referenceOnly: true } : {}), ...dimensions });
          if (payload.referenceOnly !== true) state.currentId = id;
          state.revision++; await persist({ busy: false });
        } finally { state.busy = false; }
        lastActivity = Date.now(); emit({ event: 'imported', files: [file] });
        return send(200, publicState());
      }
      if (route === 'api/finish') {
        check(!state.busy, 'Wait for the current request before finishing.', 409);
        send(200, { ok: true });
        setImmediate(() => { close('finished').catch(error => emit({ event: 'error', error: safeError(error, apiKey) })); });
        return;
      }
      check(typeof payload.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(payload.requestId), 'Expected a request ID.');
      // A browser timeout/reload must not accidentally duplicate a paid request.
      if (state.attempts.some(attempt => attempt.id === payload.requestId))
        return send(202, { duplicate: true, ...publicState() });
      check(!closing && !state.finished, 'Session has finished.', 409);
      check(!state.busy, 'An edit is already running.', 409);
      check(payload.revision === state.revision, 'The image changed. Refresh before submitting.', 409);
      check(typeof payload.prompt === 'string' && payload.prompt.trim() && payload.prompt.length <= 32000,
        'Describe the edit in 1–32,000 characters.');
      const mode = payload.mode || 'edit';
      check(['generate', 'edit'].includes(mode), 'Unknown image operation.');
      check(payload.canvasNodeId === undefined || /^[a-f0-9-]{36}$/i.test(payload.canvasNodeId), 'Invalid frame ID.');
      const source = mode === 'edit' ? images.find(item => item.id === payload.sourceId) : undefined;
      const referenceIds = payload.referenceIds || [];
      check(Array.isArray(referenceIds) && referenceIds.length <= 4 && new Set(referenceIds).size === referenceIds.length &&
        referenceIds.every(id => id !== source?.id && images.some(entry => entry.id === id)), 'Choose up to four distinct session reference images.');
      let sourceBytes, firstInfo = source;
      if (mode === 'edit') {
        check(source, 'Unknown source image.');
        if (source.type !== 'png') {
          sourceBytes = decodePng(payload.sourcePng); firstInfo = pngDimensions(sourceBytes);
        } else check(payload.sourcePng === undefined, 'Do not replace the original PNG with a flattened canvas.');
        validDimensions(firstInfo);
      } else {
        check(payload.markup === undefined && payload.sourcePng === undefined && payload.sourceId === undefined, 'Generation cannot include markup or source images.');
        check(['1024x1024', '1024x1536', '1536x1024', '1536x864', '864x1536'].includes(payload.size || '1024x1024'), 'Choose a supported generation frame size.');
      }
      let markupBytes;
      if (payload.markup !== undefined) {
        markupBytes = decodePng(payload.markup);
        const overlay = inspectPng(markupBytes);
        check(overlay.width === firstInfo.width && overlay.height === firstInfo.height, 'Markup dimensions must match the source.');
        check(overlay.transparencyVerified && overlay.transparentPixels + overlay.translucentPixels > 0,
          'Markup must contain transparent pixels.');
      }
      const attempt = { id: payload.requestId, sourceId: source?.id, mode, size: payload.size || '1024x1024',
        ...(referenceIds.length ? { referenceIds } : {}),
        canvasNodeId: payload.canvasNodeId, prompt: payload.prompt.trim(),
        createdAt: new Date().toISOString(), status: 'running' };
      state.attempts.push(attempt); state.busy = true; state.error = null; lastActivity = Date.now();
      emit({ event: 'submitted', mode, requestId: attempt.id, sourceId: source?.id });
      pending = runEdit(attempt, source, sourceBytes, markupBytes).catch(error => {
        state.busy = false; state.error = safeError(error, apiKey);
        emit({ event: 'error', error: state.error });
      });
      return send(202, publicState());
    } catch (error) { send(error.status || 400, { error: safeError(error, apiKey) }); }
  });
  async function close(reason = 'finished') {
    if (closing) return done;
    closing = true; clearInterval(idleTimer);
    await pending; await layoutPending.catch(() => {}); state.finished = true; await persist();
    await new Promise((resolveClose, rejectClose) => {
      server.close(error => error ? rejectClose(error) : resolveClose());
      server.closeIdleConnections();
    });
    emit({ event: 'finished', reason, files: images.slice(1).map(item => item.file) });
    resolveDone({ reason, sessionDir });
    return done;
  }
  await persist();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  authority = `127.0.0.1:${server.address().port}`;
  const url = `http://${authority}${prefix}`;
  idleTimer = setInterval(() => {
    if (!state.busy && Date.now() - lastActivity >= idleTimeout)
      close('idle-timeout').catch(error => emit({ event: 'error', error: safeError(error, apiKey) }));
  }, Math.min(30000, idleTimeout));
  idleTimer.unref();
  emit({ event: 'ready', url });
  return { url, sessionDir, done, close };
}
