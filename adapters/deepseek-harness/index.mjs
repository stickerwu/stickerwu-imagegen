import { defineTool } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';
import { createHarnessPlugin } from './bridge.mjs';

export const name = 'stickerwu-imagegen';
export const inject = ['tools', 'attachments'];
export const Config = Schema.object({
  configPath: Schema.string().description('Optional shared API configuration JSON path; blank uses the existing stickerwu/VVVCode configuration.').default(''),
  profile: Schema.string().description('Optional existing named API profile.').default(''),
  outputDir: Schema.string().description('Absolute output directory; blank uses ~/Pictures/stickerwu-imagegen.').default(''),
  timeoutMs: Schema.number().min(1000).max(1800000).description('Image request deadline in milliseconds. No automatic retry.').default(300000),
  canvasIdleMs: Schema.number().min(1000).max(86400000).description('Close an idle annotation canvas after this interval.').default(3600000),
});
export function apply(ctx, config) {
  const plugin = createHarnessPlugin(ctx, config, { defineTool });
  ctx.effect(() => () => plugin.dispose());
}
