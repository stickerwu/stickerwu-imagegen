import test from 'node:test';
import assert from 'node:assert/strict';
import {imageMetadata,imageType} from '../plugins/vvvcode-image-gen/scripts/formats.mjs';
test('JPEG and three WebP headers report actual encoded dimensions',()=>{
  const jpeg=Buffer.from([255,216,255,192,0,17,8,0,96,0,128,3,1,17,0,2,17,0,3,17,0,255,217]);
  assert.equal(imageMetadata(jpeg).width,128);assert.equal(imageMetadata(jpeg).height,96);
  for(const type of ['VP8X','VP8 ','VP8L']){
    const bytes=Buffer.alloc(30);bytes.write('RIFF');bytes.writeUInt32LE(22,4);bytes.write('WEBP',8);bytes.write(type,12);bytes.writeUInt32LE(10,16);
    if(type==='VP8X'){bytes.writeUIntLE(127,24,3);bytes.writeUIntLE(95,27,3);}
    if(type==='VP8 '){bytes.set([0x9d,1,0x2a],23);bytes.writeUInt16LE(128,26);bytes.writeUInt16LE(96,28);}
    if(type==='VP8L'){bytes[20]=0x2f;bytes.writeUInt32LE(127+(95<<14),21);}
    assert.equal(imageMetadata(bytes).width,128);assert.equal(imageMetadata(bytes).height,96);
  }
});
test('SVG supports viewBox metadata and rejects active or externally loaded content',()=>{
  const svg=Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 768"><use href="#shape"/></svg>');
  assert.deepEqual(imageMetadata(svg),{format:'svg',width:1024,height:768,transparencyVerified:false});
  for(const part of ['<script/>','<image href="https://example.com/x"/>','<path onload="run()"/>','<foreignObject/>'])
    assert.throws(()=>imageType(Buffer.from(`<svg>${part}</svg>`)),/active|external/);
});
test('SVG permits quoted local gradients while rejecting external CSS loads',()=>{
  for(const reference of ['url(#paint)',"url('#paint')",'url( "#paint" )'])
    assert.equal(imageType(Buffer.from(`<svg><style>path{fill:${reference}}</style></svg>`)),'svg');
  for(const reference of ['url(https://example.com/a)',"url( 'https://example.com/a' )",'url( "#paint" ),url(https://example.com/a)'])
    assert.throws(()=>imageType(Buffer.from(`<svg><style>path{fill:${reference}}</style></svg>`)),/active|external/);
  assert.throws(()=>imageType(Buffer.from('<svg><style>@import "https://example.com/a";</style></svg>')),/active|external/);
});
test('SVG rejects namespace aliases, animation mutations and escaped CSS loads',()=>{
  for(const part of [
    '<s:script xmlns:s="http://www.w3.org/2000/svg">alert(1)</s:script>',
    '<set attributeName="href" to="javascript:alert(1)"/>',
    '<animate attributeName="href" values="#local;https://example.com/a"/>',
    '<style>path{fill:u\\72l(https://example.com/a)}</style>',
    '<path style="fill:u\\72l(https://example.com/a)"/>',
    '<style>&#64;import "https://example.com/a";</style>',
  ])assert.throws(()=>imageType(Buffer.from(`<svg>${part}</svg>`)),/active|external/);
});
