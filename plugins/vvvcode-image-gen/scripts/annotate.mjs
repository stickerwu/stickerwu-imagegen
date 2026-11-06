#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createReviewSession } from './review-server.mjs';
import { safeError } from './client.mjs';
import { createConfigStore } from './config.mjs';

let apiKey = process.env.STICKERWU_IMAGEGEN_API_KEY || process.env.VVVCODE_API_KEY || '';
try {
  const { values: flags } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' }, image: { type: 'string' }, session: { type: 'string' },
    'output-dir': { type: 'string' }, model: { type: 'string' }, size: { type: 'string' },
    quality: { type: 'string' }, complexity: { type: 'string' }, background: { type: 'string' },
    'output-format':{type:'string'},'output-compression':{type:'string'},stream:{type:'boolean'},
    'partial-images':{type:'string'},'frame-count':{type:'string'},'frame-duration-ms':{type:'string'},
    timeout: { type: 'string' }, 'base-url': { type: 'string' }, 'prompt-file': { type: 'string' },
    profile: { type: 'string' },
    'idle-timeout': { type: 'string' }, open: { type: 'boolean' },
  } });
  if (flags.help) {
    console.log(`stickerwu imagegen — on-demand infinite image canvas (Node.js 22+)
  node annotate.mjs [--image result.png] --output-dir outputs [--open]
  node annotate.mjs --session outputs/review-SESSION-ID [--open]
  --model sunburst|flare --size auto|WIDTHxHEIGHT --quality VALUE
  --complexity low|medium|high --background auto|opaque|transparent
  --output-format png|jpeg|webp|svg|gif --output-compression 0..100
  --stream --partial-images 0..3 --frame-count 2..16 --frame-duration-ms 20..2000
Parameters are editable per frame in the page. SVG/GIF are view/download only.
  --profile work  /  --base-url https://api.example.com/v1
API Settings in the canvas menu can save and switch named connections without generating.
  --prompt-file edit.txt --timeout 300000 --idle-timeout 3600000
The URL opens a local infinite canvas. Empty frames generate; images edit.
Each Submit makes exactly one API request. Ordinary generate.mjs stays headless.
Source images, transparent markup, prompts and results stay in a review subfolder.
stdout is newline-delimited JSON: ready, submitted, generated, error, finished.
No request runs at startup. No automatic paid retries. No saved key returned to the browser.
Use Finish in the page to stop; inactive sessions close after one hour.`);
  } else {
    const configStore = await createConfigStore();
    const connection = configStore.resolve({ profile: flags.profile, baseUrl: flags['base-url'] });
    apiKey = connection.apiKey;
    const session = await createReviewSession({
      image: flags.image, session: flags.session, outputDir: flags['output-dir'], apiKey,
      baseUrl: connection.baseUrl, configStore, connectionInfo: connection,
      model: flags.model || (flags.session ? undefined : connection.model), size: flags.size,
      quality: flags.quality, complexity: flags.complexity, background: flags.background,
      outputFormat:flags['output-format'],
      outputCompression:flags['output-compression']===undefined?undefined:Number(flags['output-compression']),
      stream:flags.stream,partialImages:flags['partial-images']===undefined?undefined:Number(flags['partial-images']),
      frameCount:flags['frame-count']===undefined?undefined:Number(flags['frame-count']),
      frameDurationMs:flags['frame-duration-ms']===undefined?undefined:Number(flags['frame-duration-ms']),
      timeout: Number(flags.timeout || 300000), idleTimeout: Number(flags['idle-timeout'] || 3600000),
      prompt: flags['prompt-file'] ? await readFile(flags['prompt-file'], 'utf8') : '',
      onEvent: event => console.log(JSON.stringify(event)),
    });
    if (flags.open) {
      const [program, args] = process.platform === 'win32'
        ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `Start-Process -FilePath '${session.url}' -WindowStyle Hidden`]]
        : process.platform === 'darwin' ? ['open', [session.url]] : ['xdg-open', [session.url]];
      const child = spawn(program, args, { stdio: 'ignore', windowsHide: true });
      child.on('error', error => console.error(`Open the ready URL manually: ${safeError(error, apiKey)}`));
    }
    await session.done;
  }
} catch (error) {
  console.error(safeError(error, apiKey)); process.exitCode = 1;
}
