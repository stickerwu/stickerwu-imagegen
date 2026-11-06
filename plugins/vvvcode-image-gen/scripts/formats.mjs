import { pngDimensions, inspectPng, inspectGif } from './image-info.mjs';
export function imageType(bytes) {
  if(/^GIF8[79]a$/.test(bytes.toString('ascii',0,6)))return 'gif';
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpeg';
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'webp';
  const text=bytes.toString('utf8').replace(/^\uFEFF/,'').trimStart();
  if(/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) {
    // Serve only passive, self-contained SVG, always through <img>, never inline.
    const cssUrls=[...text.matchAll(/url\s*\(([^)]*)\)/gi)];
    const externalCss=cssUrls.some(match=>!/^(['"]?)#[A-Za-z0-9_.:-]+\1$/.test(match[1].trim())) ||
      (text.match(/url\s*\(/gi)?.length || 0)!==cssUrls.length;
    // A conservative passive SVG subset: no prefixed elements, animation or CSS escapes.
    // Downloaded bytes must remain safe outside the canvas's <img> and CSP.
    const tags=[...text.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<\s*\/?\s*([A-Za-z][\w:.-]*)\b/g)];
    const passive=new Set('svg g defs symbol use title desc metadata path rect circle ellipse line polyline polygon text tspan textPath linearGradient radialGradient stop clipPath mask pattern image filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence style'.toLowerCase().split(' '));
    const unsupportedTag=tags.some(match=>!passive.has(match[1].toLowerCase()));
    if(unsupportedTag || externalCss || /<!DOCTYPE|<!ENTITY|<\?(?!xml\s)|&#|\\|\b(?:on[a-z]+|style)\s*=|(?:href|src)\s*=\s*["']\s*(?!#)[^"']|@import\b|xmlns\s*=\s*["'](?!http:\/\/www\.w3\.org\/2000\/svg["'])/i.test(text))
      throw new Error('SVG contains active or external content.');
    return 'svg';
  }
  throw new Error('Expected PNG, JPEG, WebP, GIF or SVG image bytes.');
}
export const mimeType=type=>type==='svg'?'image/svg+xml':`image/${type}`;
export function imageMetadata(bytes) {
  const format=imageType(bytes);
  if(format==='png') {
    try { return {format,...inspectPng(bytes)}; }
    catch(error){return {format,...pngDimensions(bytes),transparencyVerified:false,reason:error.message};}
  }
  if(format==='gif')return {format,...inspectGif(bytes)};
  if(format==='svg') {
    const text=bytes.toString('utf8'), tag=text.match(/<svg\b[^>]*>/i)?.[0] || '';
    const box=tag.match(/\bviewBox\s*=\s*["']\s*([-+\d.e]+)[ ,]+([-+\d.e]+)[ ,]+([-+\d.e]+)[ ,]+([-+\d.e]+)\s*["']/i);
    const dimension=name=>{const m=tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([\\d.]+)(?:px)?["']`,'i'));return m?Number(m[1]):undefined;};
    const width=dimension('width') || (box?Number(box[3]):undefined),height=dimension('height') || (box?Number(box[4]):undefined);
    return {format,...(width>0&&height>0?{width,height}:{}),transparencyVerified:false};
  }
  if(format==='jpeg') {
    let at=2;
    while(at+4<=bytes.length) {
      if(bytes[at++]!==255)continue;
      let marker=bytes[at++];while(marker===255)marker=bytes[at++];
      if(marker===0xd9||marker===0xda)break;
      if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
      const length=bytes.readUInt16BE(at);
      if(length<2||at+length>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=7)
        return {format,width:bytes.readUInt16BE(at+5),height:bytes.readUInt16BE(at+3),transparencyVerified:true,hasAlpha:false,transparentPixels:0,translucentPixels:0};
      at+=length;
    }
    throw new Error('JPEG dimensions could not be read.');
  }
  for(let at=12;at+8<=bytes.length;) {
    const name=bytes.toString('ascii',at,at+4),len=bytes.readUInt32LE(at+4),p=at+8;
    if(p+len>bytes.length)break;
    if(name==='VP8X'&&len>=10)return {format,width:1+bytes.readUIntLE(p+4,3),height:1+bytes.readUIntLE(p+7,3),transparencyVerified:false};
    if(name==='VP8 '&&len>=10&&bytes[p+3]===0x9d&&bytes[p+4]===1&&bytes[p+5]===0x2a)
      return {format,width:bytes.readUInt16LE(p+6)&0x3fff,height:bytes.readUInt16LE(p+8)&0x3fff,transparencyVerified:false};
    if(name==='VP8L'&&len>=5&&bytes[p]===0x2f) {
      const bits=bytes.readUInt32LE(p+1);
      return {format,width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1,transparencyVerified:false};
    }
    at=p+len+(len%2);
  }
  throw new Error('WebP dimensions could not be read.');
}
