import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOptions, resolutionSize } from '../plugins/vvvcode-image-gen/ui/image-options.mjs';

test('shared options cover both models, quality and effort independently', () => {
  for (const model of ['flare', 'sunburst'])
    for (const quality of ['auto','low','medium','high','xhigh','max'])
      for (const complexity of ['low','medium','high']) {
        const value = normalizeOptions({model, quality, complexity, size:'2048x2048'});
        assert.equal(value.model, `gpt-image-2.6-${model}`);
        assert.equal(value.quality, quality); assert.equal(value.complexity, complexity);
      }
});
test('dimension envelope rejects edge, pixels, aspect, divisibility and tiny stills', () => {
  for (const size of ['4096x2048','3840x3840','2048x512','1025x1024','512x512','0x1024'])
    assert.throws(() => normalizeOptions({size}), /size|pixel|edge|ratio|divisible/i);
  assert.equal(normalizeOptions({size:'3840x2160'}).size,'3840x2160');
  assert.equal(normalizeOptions({size:'512x512',outputFormat:'gif'}).size,'512x512');
  for (const resolution of ['1K','2K','4K'])
    for (const ratio of [1/3,9/16,3/4,1,4/3,16/9,3])
      assert.doesNotThrow(() => normalizeOptions({size:resolutionSize(resolution,ratio)}));
});
test('output combinations are rejected before spending and zero compression survives', () => {
  assert.equal(normalizeOptions({outputFormat:'webp',outputCompression:0}).outputCompression,0);
  assert.equal(normalizeOptions({outputFormat:'svg',background:'transparent'}).outputFormat,'svg');
  for(const options of [
    {outputFormat:'png',outputCompression:80},{outputFormat:'jpeg',outputCompression:101},
    {outputFormat:'jpeg',background:'transparent'},{partialImages:1},
    {stream:true,partialImages:4},{stream:'true'},
    {outputFormat:'svg',stream:true},{outputFormat:'svg',partialImages:0},
    {outputFormat:'svg',n:2},{outputFormat:'svg',mode:'edit'},
    {outputFormat:'gif',stream:true},{outputFormat:'gif',partialImages:0},
    {outputFormat:'gif',outputCompression:50},
  ]) assert.throws(()=>normalizeOptions(options));
});
