#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { requestImages, safeError, normalizeBase, MODELS } from './client.mjs';
import { inspectPng, pngDimensions, resolutionSize } from './image-info.mjs';

const configPath = join(homedir(), '.config', 'vvvcode-image-gen', 'config.json');
let apiKey = process.env.VVVCODE_API_KEY || '';
try {
  const { values: flags } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' },
    'get-config': { type: 'boolean' },
    'set-config': { type: 'boolean' },
    'key-stdin': { type: 'boolean' },
    edit: { type: 'boolean' },
    image: { type: 'string', multiple: true },
    mask: { type: 'string' },
    prompt: { type: 'string' },
    'prompt-file': { type: 'string' },
    model: { type: 'string' },
    size: { type: 'string' },
    resolution: { type: 'string' },
    ratio: { type: 'string' },
    background: { type: 'string' },
    'output-format': { type: 'string' },
    quality: { type: 'string' },
    count: { type: 'string' },
    timeout: { type: 'string' },
    'base-url': { type: 'string' },
    'output-dir': { type: 'string' },
  } });
  let config = {};
  try { config = JSON.parse(await readFile(configPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read plugin config; check its JSON format.'); }
  apiKey ||= config.apiKey || '';
  if (flags.help) {
    console.log(`VVVCode Image Gen (Node.js 22+)
  --prompt "description" [--model sunburst|flare] [--size 1024x1024]
  --edit --image source.png --prompt "edit instruction" [--mask mask.png]
  --prompt-file prompt.txt                    Avoid shell quoting issues
  --image a.png --image b.png --edit ...      Multiple reference images
  --count 1..4 --quality VALUE --timeout 300000 --output-dir outputs
  --background transparent|opaque|auto --output-format png|jpeg|webp
  --resolution 1K|2K|4K [--ratio 3:4]         Long edge 1024/2048/4096
  --get-config                               Does not expose the API key
  --set-config --model flare --base-url https://apis.vvvcode.com/
  --key-stdin                                Read and save a key from stdin
Environment: VVVCODE_API_KEY, VVVCODE_BASE_URL
Edits default to size=auto; generation defaults to 1024x1024.
No automatic retries or fallback from edits to generations.`);
  } else if (flags['get-config']) {
    console.log(JSON.stringify({
      hasKey: Boolean(apiKey), model: config.model || 'sunburst',
      baseUrl: normalizeBase(process.env.VVVCODE_BASE_URL || config.baseUrl),
      configPath,
    }, null, 2));
  } else if (flags['set-config'] || flags['key-stdin']) {
    if (flags.model) {
      if (!MODELS[flags.model] && !Object.values(MODELS).includes(flags.model)) throw new Error('Unknown model.');
      config.model = flags.model;
    }
    if (flags['base-url']) config.baseUrl = normalizeBase(flags['base-url']);
    if (flags['key-stdin']) {
      let text = '';
      for await (const chunk of process.stdin) text += chunk;
      if (!text.trim() || /\s/.test(text.trim())) throw new Error('Expected one nonempty API key on stdin.');
      config.apiKey = text.trim();
      apiKey = config.apiKey;
    }
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    console.log('Configuration saved. API key is not displayed.');
  } else {
    if (flags.prompt && flags['prompt-file']) throw new Error('Use prompt or prompt-file, not both.');
    const prompt = flags['prompt-file'] ? await readFile(flags['prompt-file'], 'utf8') : flags.prompt;
    const mode = flags.edit ? 'edit' : 'generate';
    const model = flags.model || config.model || 'sunburst';
    if (flags.size && flags.resolution) throw new Error('Choose size or resolution, not both.');
    if (flags.ratio && !flags.resolution) throw new Error('ratio requires resolution.');
    let size = flags.size;
    if (flags.resolution) {
      let ratio = 1;
      if (flags.ratio) {
        if (!/^\d+:\d+$/.test(flags.ratio)) throw new Error('Ratio must be WIDTH:HEIGHT.');
        const [w, h] = flags.ratio.split(':').map(Number);
        ratio = w / h;
      } else if (flags.edit && flags.image?.length) {
        // Fail explicitly for non-PNG instead of guessing and distorting a source.
        const { width, height } = pngDimensions(await readFile(flags.image[0]));
        ratio = width / height;
      }
      size = resolutionSize(flags.resolution, ratio);
    }
    size ??= flags.edit ? 'auto' : '1024x1024';
    console.log(`Mode: ${mode}; model: ${model}; size: ${size}; background: ${flags.background || 'unspecified'}`);
    const files = await requestImages({
      apiKey, mode, model, prompt, images: flags.image, mask: flags.mask,
      size, quality: flags.quality, background: flags.background,
      outputFormat: flags['output-format'], n: Number(flags.count || 1),
      timeout: Number(flags.timeout || 300000),
      baseUrl: flags['base-url'] || process.env.VVVCODE_BASE_URL || config.baseUrl,
      outputDir: flags['output-dir'],
    });
    const results = [];
    for (const file of files) {
      let metadata;
      try { metadata = inspectPng(await readFile(file)); }
      catch (error) { metadata = { transparencyVerified: false, reason: safeError(error, apiKey) }; }
      const warnings = [];
      if (size !== 'auto' && metadata.width && `${metadata.width}x${metadata.height}` !== size) warnings.push('Returned dimensions differ from requested size.');
      if (flags.background === 'transparent' &&
          (!metadata.transparencyVerified || !(metadata.transparentPixels + metadata.translucentPixels > 0)))
        warnings.push('Real transparency was NOT verified; do not claim transparent output.');
      results.push({ file, ...metadata, warnings });
    }
    console.log(JSON.stringify({ ok: true, mode, model, requestedSize: size, files, results }, null, 2));
  }
} catch (error) {
  console.error(safeError(error, apiKey));
  process.exitCode = 1;
}
