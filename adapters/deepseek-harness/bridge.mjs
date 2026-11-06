import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createConfigStore } from '../../plugins/stickerwu-imagegen/scripts/config.mjs';
import { requestImages, MODELS, SUPPORTED_MODELS, safeError } from '../../plugins/stickerwu-imagegen/scripts/client.mjs';
import { createReviewSession } from '../../plugins/stickerwu-imagegen/scripts/review-server.mjs';
import { imageMetadata, mimeType } from '../../plugins/stickerwu-imagegen/scripts/formats.mjs';

const text = description => ({ type: 'string', description });
const array = items => ({ type: 'array', items });
const object = properties => ({ type: 'object', properties, additionalProperties: false });
const string = { type: 'string' };
const common = {
  model: { ...text('Exact model ID or sunburst/flare (2.6 aliases). A pinned 2.5 model stays 2.5.'), enum: [...Object.keys(MODELS), ...SUPPORTED_MODELS] },
  profile: text('Existing saved API profile; credentials are configured in the local canvas settings, never tool arguments.'),
  size: text('Provider size, for example auto, 1024x1024, 1536x1024 or 1024x1536.'),
  quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] },
  complexity: text('Optional provider complexity. Availability depends on the endpoint.'),
  background: { type: 'string', enum: ['auto', 'transparent', 'opaque'] },
  outputFormat: { type: 'string', enum: ['png', 'jpeg', 'webp', 'gif', 'svg'] },
  outputCompression: { type: 'integer', description: 'JPEG/WebP compression 0–100.' },
  frameCount: { type: 'integer', description: 'GIF frame count; only Image 2.6 supports GIF.' },
  frameDurationMs: { type: 'integer', description: 'GIF frame duration in milliseconds.' },
};
const imageOutput = object({ model: string, files: array(string), images: array({ type: 'json' }),
  metadata: array({ type: 'json' }), warnings: array(string) });
const render = (_args, value) => [{ type: 'text', text: JSON.stringify(value) },
  ...(value.images || []).map(attachment => ({ type: 'image', attachment }))];

// No network or configuration mutation occurs on load. SDK imports live in index.mjs;
// injecting the boundary lets tests run without installing a second host SDK.
export function createHarnessPlugin(ctx, config = {}, dependencies = {}) {
  const deps = { createConfigStore, requestImages, createReviewSession, ...dependencies };
  if (typeof deps.defineTool !== 'function') throw new Error('Harness defineTool is required.');
  const outputDir = resolve(config.outputDir || join(homedir(), 'Pictures', 'stickerwu-imagegen'));
  const timeout = config.timeoutMs ?? 300000, idleTimeout = config.canvasIdleMs ?? 3600000;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 1800000) throw new Error('timeoutMs must be 1000–1800000.');
  if (!Number.isInteger(idleTimeout) || idleTimeout < 1000 || idleTimeout > 86400000) throw new Error('canvasIdleMs must be 1000–86400000.');
  const sessions = new Set();
  const running = new Set(), lifetime = new AbortController();
  let disposed = false;
  function run(exec, operation) {
    const signal = AbortSignal.any([exec.signal, lifetime.signal]);
    const pending = Promise.resolve().then(() => { signal.throwIfAborted(); return operation({ signal }); });
    running.add(pending);
    void pending.then(() => running.delete(pending), () => running.delete(pending));
    return pending;
  }
  async function connection(args) {
    if (disposed) throw new Error('Image plugin is unloaded.');
    const store = await deps.createConfigStore(config.configPath ? { configPath: config.configPath } : {});
    if (disposed) throw new Error('Image plugin is unloaded.');
    const selected = { profile: args.profile || config.profile || undefined };
    return { store, selected, resolved: store.resolve(selected) };
  }
  async function sourceFiles(paths = [], attachments = [], signal) {
    if (!Array.isArray(paths) || !Array.isArray(attachments) || paths.length + attachments.length > 10)
      throw new Error('Edit accepts at most 10 local images and/or Harness image attachments.');
    const images = [...paths];
    for (const reference of attachments) {
      signal.throwIfAborted();
      const { data } = await ctx.attachments.readImage(reference, signal);
      const info = imageMetadata(Buffer.from(data));
      if (!['png', 'jpeg', 'webp'].includes(info.format)) throw new Error('Edit source attachment must be a still PNG, JPEG or WebP.');
      signal.throwIfAborted();
      const directory = join(outputDir, 'references');
      await mkdir(directory, { recursive: true });
      const file = join(directory, `${randomUUID()}.${info.format}`);
      await writeFile(file, data, { flag: 'wx' });
      images.push(file);
    }
    return images;
  }
  async function generate(mode, args, exec) {
    exec.signal.throwIfAborted();
    const { resolved: active } = await connection(args);
    const model = MODELS[args.model || active.model] || args.model || active.model;
    const images = mode === 'edit' ? await sourceFiles(args.images, args.imageAttachments, exec.signal) : [];
    exec.signal.throwIfAborted();
    const files = await deps.requestImages({ ...args, images, mode, model, apiKey: active.apiKey,
      baseUrl: active.baseUrl, outputDir, timeout, signal: exec.signal });
    // A successful paid request must remain successful even if the optional preview
    // service fails. Preserve the originals and never repeat generation for a preview.
    const result = { model, files, images: [], metadata: [], warnings: [] };
    for (const file of files) {
      try {
        const data = await readFile(file), info = imageMetadata(data);
        result.metadata.push({ file, ...info });
        if (info.format !== 'svg') result.images.push(...await ctx.attachments.saveImages([
          { data, mediaType: mimeType(info.format), name: basename(file) },
        ]));
      } catch (error) { result.warnings.push(`Original image retained at ${file}; preview unavailable: ${safeError(error, active.apiKey)}`); }
    }
    return result;
  }
  for (const mode of ['generate', 'edit']) ctx.tools.register(deps.defineTool({
    name: `stickerwu_imagegen_${mode}`,
    description: mode === 'edit' ? 'Edit existing local images through the image edits API. Keep explicit 2.5/2.6 model IDs. No automatic retry.' :
      'Generate images through the configured image API. One invocation is one paid request; never retry automatically after failure or cancellation.',
    parameters: { prompt: { ...text('Image instruction.'), required: true }, ...common,
      n: { type: 'integer', description: 'Number of results, 1–4; default 1.' },
      ...(mode === 'edit' ? { images: { ...array(string), description: 'Source image absolute local paths. Supply at least one path or imageAttachments reference; combined maximum 10.' },
        imageAttachments: { ...array({ type: 'json' }), description: 'Durable Harness image attachment references from this conversation (PNG/JPEG/WebP). Verified by the attachment service before upload.' },
        mask: text('Optional local mask file; do not combine with markup.'),
        markup: text('Optional transparent PNG annotation overlay matching the first source image.') } : {}) },
    output: { schema: imageOutput, render },
    isConcurrencySafe: () => false, timeoutMs: timeout + 15000,
    execute: (args, exec) => run(exec, current => generate(mode, args, current)),
  }));
  ctx.tools.register(deps.defineTool({
    name: 'stickerwu_imagegen_canvas',
    description: 'Open an on-demand local infinite canvas for image generation, annotation and iterative editing. Return its URL to the user. Opening/settings incur no image API call; each user Submit makes one request. Finished sessions may be reopened.',
    parameters: { ...common, image: text('Optional absolute local PNG/JPEG/WebP source path.'),
      imageAttachment: { type: 'json', description: 'Optional durable Harness image attachment, mutually exclusive with image/session.' },
      session: text('Optional finished canvas session directory; mutually exclusive with image.'), prompt: text('Optional initial instruction.') },
    output: { schema: object({ url: string, sessionDir: string, note: string }), render },
    isConcurrencySafe: () => false, timeoutMs: 30000,
    async execute(args, exec) {
      return run(exec, async current => {
        const { store, resolved: active } = await connection(args);
        current.signal.throwIfAborted();
        if (args.imageAttachment && (args.image || args.session)) throw new Error('Choose one of image, imageAttachment or session.');
        const image = args.imageAttachment ? (await sourceFiles([], [args.imageAttachment], current.signal))[0] : args.image;
        current.signal.throwIfAborted();
        const lifecycle = new AbortController();
        const session = await deps.createReviewSession({ ...args, image, apiKey: active.apiKey, baseUrl: active.baseUrl,
          model: args.model || active.model, outputDir, timeout, idleTimeout, configStore: store, connectionInfo: active,
          editImpl: options => deps.requestImages({ ...options, signal: AbortSignal.any([lifecycle.signal, lifetime.signal]) }) });
        const managed = { close() { lifecycle.abort(); return session.close(); } };
        if (disposed || current.signal.aborted) { await managed.close(); current.signal.throwIfAborted(); throw new Error('Image plugin unloaded.'); }
        sessions.add(managed);
        void session.done.finally(() => { lifecycle.abort(); sessions.delete(managed); }).catch(() => {});
        return { url: session.url, sessionDir: session.sessionDir,
          note: 'Open this local URL. Configure API profiles in Settings. Submit explicitly to generate/edit; Finish closes the session. No image request has been made by opening this canvas.' };
      });
    },
  }));
  ctx.tools.register(deps.defineTool({
    name: 'stickerwu_imagegen_status', description: 'Inspect configured API profiles and model without revealing keys or calling the image API.',
    parameters: { profile: common.profile }, output: { schema: { type: 'json' }, render },
    isConcurrencySafe: () => true,
    execute(args, exec) { return run(exec, async () => { const { store, selected } = await connection(args); return store.describe(selected); }); },
  }));
  return { async dispose() {
    disposed = true; lifetime.abort();
    await Promise.allSettled([...sessions].map(session => session.close()).concat([...running]));
    sessions.clear();
  } };
}
