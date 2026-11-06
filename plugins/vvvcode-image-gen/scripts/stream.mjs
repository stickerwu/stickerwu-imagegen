// SSE is a byte stream: UTF-8 characters, CRLF and JSON may span chunks.
export async function* imageEvents(response, { signal } = {}) {
  if(!response.body) throw new Error('Streaming response has no body.');
  const decoder=new TextDecoder();
  let buffer='', data=[], event='', total=0;
  const packet=()=> {
    if(!data.length) { event=''; return null; }
    const text=data.join('\n'), name=event; data=[];event='';
    if(text==='[DONE]')return null;
    const value=JSON.parse(text);
    return {...value,type:value.type || name};
  };
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
  signal?.throwIfAborted();
  while (true) {
    const { value: bytes, done } = await reader.read();
    signal?.throwIfAborted();
    if (done) break;
    buffer+=decoder.decode(bytes,{stream:true}); total+=bytes.length;
    if(total>256*1024*1024 || buffer.length>100*1024*1024)throw new Error('Image stream exceeds size limit.');
    let at;
    while((at=buffer.indexOf('\n'))!==-1) {
      const line=buffer.slice(0,at).replace(/\r$/,'');buffer=buffer.slice(at+1);
      if(!line) { const value=packet();if(value)yield value; }
      else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));
      else if(line.startsWith('event:'))event=line.slice(6).trim();
    }
  }
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  buffer+=decoder.decode();
  if(buffer.trim()) {
    if(buffer.startsWith('data:'))data.push(buffer.slice(5).trim());
    else throw new Error('Truncated image stream.');
  }
  const value=packet();if(value)yield value;
}
