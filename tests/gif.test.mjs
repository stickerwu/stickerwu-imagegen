import test from 'node:test';
import assert from 'node:assert/strict';
import * as info from '../plugins/vvvcode-image-gen/scripts/image-info.mjs';
const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAAUAAAALAAAAAABAAEAAAICRAEAIfkEABQAAAAsAAAAAAEAAQAAAgJEAQA7','base64');
test('GIF inspection measures encoded frame count, delays, duration and loop status',()=>{
  assert.equal(typeof info.inspectGif,'function');
  const result=info.inspectGif(gif);
  assert.equal(result.width,1); assert.equal(result.height,1);
  assert.equal(result.frameCount,2);
  assert.deepEqual(result.frameDurationsMs,[200,200]);
  assert.equal(result.durationMs,400);
  assert.equal(result.loopCount,null);
  const loop=Buffer.from([0x21,0xff,0x0b,...Buffer.from('NETSCAPE2.0'),3,1,0,0,0]);
  assert.equal(info.inspectGif(Buffer.concat([gif.subarray(0,19),loop,gif.subarray(19)])).loopCount,0);
  assert.throws(()=>info.inspectGif(gif.subarray(0,30)),/truncated/i);
});
