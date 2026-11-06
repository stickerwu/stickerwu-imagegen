import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('renamed display name preserves the plugin and skill identities needed for existing installs', async () => {
  const plugin = JSON.parse(await readFile('plugins/vvvcode-image-gen/.codex-plugin/plugin.json', 'utf8'));
  const marketplace = JSON.parse(await readFile('.agents/plugins/marketplace.json', 'utf8'));
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(plugin.interface.displayName, 'stickerwu imagegen');
  assert.equal(plugin.name, 'vvvcode-image-gen');
  assert.equal(marketplace.name, 'vvvcode-plugins');
  assert.equal(marketplace.plugins[0].name, plugin.name);
  assert.equal(plugin.version, pkg.version);
  const skill = await readFile('plugins/vvvcode-image-gen/skills/vvvcode-image-gen/SKILL.md', 'utf8');
  assert.match(skill, /^---\s+name: vvvcode-image-gen/m);
  assert.match(skill, /# stickerwu imagegen/);
});
