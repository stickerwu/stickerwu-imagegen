import { CanvasHistory, hitAnnotation, shouldSubmit } from './canvas-model.mjs';
import { normalizeOptions, resolutionSize } from './image-options.mjs';
const $ = selector => document.querySelector(selector);
const stage = $('#stage'), world = $('#world'), source = $('#source'), overlay = $('#overlay');
const ctx = overlay.getContext('2d'), promptInput = $('#prompt'), submit = $('#submit');
const drawingTools = ['pen', 'ellipse', 'rectangle', 'arrow', 'text', 'eraser'];
let state, nodes = [], camera = { x: 80, y: 60, zoom: 1 }, selected = null;
let tool = 'select', shapes = [], draft = null, gesture = null, space = false;
let ready = false, locked = false, imageLoad = 0, refreshTimer, saveTimer, saving = Promise.resolve();
let requestId = null, fingerprint = null, offline = false;
const elements = new Map();
const history = new CanvasHistory(), deletedImageIds = new Set();
let selectionIds = new Set(), composerOpen = true, textDraft = null, erasing = false, statusTimer;
const setStatus = (text, kind = '') => {
  clearTimeout(statusTimer); $('#status').textContent = text; $('#status').className = `status ${kind}`;
  if (!kind) statusTimer = setTimeout(() => { $('#status').textContent = ''; }, 4000);
};
const icon = name => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
};
const checkpoint = () => { remember(); history.push({ nodes, deletedImageIds: [...deletedImageIds] }); controls(); };
async function api(path, payload) {
  const response = await fetch(new URL(path, location.href), payload === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}
const entryFor = node => state?.images.find(entry => entry.id === node?.imageId);
function remember() {
  if (selected && nodes.includes(selected)) { selected.prompt = promptInput.value; selected.shapes = shapes; }
}
function queueSave() {
  if (!state || state.finished) return;
  clearTimeout(saveTimer); $('#save-status').textContent = '正在保存…';
  saveTimer = setTimeout(() => { saveTimer = null; saveNow().catch(() => {}); }, 450);
}
async function saveNow() {
  clearTimeout(saveTimer); saveTimer = null; remember();
  const payload = JSON.parse(JSON.stringify({ camera, nodes, deletedImageIds: [...deletedImageIds] }));
  saving = saving.catch(() => {}).then(() => api('api/layout', payload));
  try { await saving; $('#save-status').textContent = '画布已保存'; }
  catch (error) { $('#save-status').textContent = '保存失败'; setStatus(`画布尚未保存：${error.message}`, 'error'); throw error; }
}
function controls() {
  const busy = locked || state?.busy || state?.finished;
  submit.disabled = busy || offline || !selected || !(promptInput.value.trim() || selected.imageId && shapes.length) || Boolean(selected.imageId && !ready);
  const readOnly=entryFor(selected)?.editable===false;
  promptInput.disabled = busy || !selected || readOnly;
  for(const field of document.querySelectorAll('[data-option],#option-resolution,#option-ratio,#option-size'))field.disabled=busy||!selected||readOnly;
  if(readOnly) {
    submit.disabled=true;
    $('#settings-note').textContent='此结果可查看和下载；如需标注，请导入 PNG、JPEG 或 WebP 图片。';
    $('#settings-note').classList.remove('invalid');
  } else if(selected) {
    try { normalizeOptions({...selected.options,mode:selected.imageId||selected.referenceIds?.length?'edit':'generate'});
      $('#settings-note').classList.remove('invalid');
    } catch(error) {submit.disabled=true;$('#settings-note').textContent=error.message;$('#settings-note').classList.add('invalid');}
  }
  for (const id of ['finish', 'import', 'menu-import', 'file-input', 'reference-file-input', 'reference-import', 'new-frame', 'empty-create', 'tool-frame', 'references-toggle'])
    $(`#${id}`).disabled = busy;
  for (const button of document.querySelectorAll('[data-size]')) {
    button.disabled = busy; button.setAttribute('aria-pressed', String(button.dataset.size === selected?.size));
  }
  for (const button of document.querySelectorAll('[data-tool]'))
    button.disabled = drawingTools.includes(button.dataset.tool) && (busy || !ready);
  $('#undo').disabled = busy || !history.canUndo; $('#redo').disabled = busy || !history.canRedo;
  $('#delete').disabled = $('#duplicate').disabled = busy || !selectionIds.size;
  $('#clear').disabled = busy || !shapes.length;
  $('#export-markup').disabled = busy || !ready;
  overlay.style.pointerEvents = ready && drawingTools.includes(tool) && !busy && !space ? 'auto' : 'none';
  overlay.style.cursor = tool === 'text' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair';
  $('#submit-label').textContent = busy ? '正在生成，请稍候' : !selected ? '选择图片或新建框' : readOnly ? '此结果仅供查看和下载' : selected.imageId ? '按标注修改' : '生成图片';
  stage.classList.toggle('hand', tool === 'hand'); stage.classList.toggle('space', space);
  $('#style-panel').classList.toggle('frame-style', Boolean(selected && !selected.imageId));
  $('#frame-options').hidden = !selected || Boolean(selected.imageId);
  if (selected && !selected.imageId) $('#frame-size').textContent = `${selected.size || '1024x1024'} px`;
  positionPanels();
}
function syncOptions() {
  if(!selected)return;
  selected.options ||= {...state.defaults,size:selected.imageId?'auto':selected.size||state.defaults.size||'1024x1024'};
  const options=selected.options;
  for(const field of document.querySelectorAll('[data-option]')) {
    if(field.type==='checkbox')field.checked=options[field.dataset.option]===true;
    else field.value=options[field.dataset.option]??(field.dataset.option==='outputFormat'?'png':'');
  }
  $('#option-resolution').value=selected.resolution || (options.size==='auto'?'auto':'custom');
  $('#option-ratio').value=String(selected.ratio || 1);$('#option-size').value=options.size || 'auto';
  const format=options.outputFormat||'png',streaming=options.stream===true;
  $('#custom-size-field').hidden=$('#option-resolution').value!=='custom';
  $('#ratio-field').hidden=['custom','auto'].includes($('#option-resolution').value);
  $('#compression-field').hidden=!['jpeg','webp'].includes(format);
  $('#stream-field').hidden=['gif','svg'].includes(format);
  $('#partial-field').hidden=!streaming || ['gif','svg'].includes(format);
  $('#frames-field').hidden=$('#delay-field').hidden=format!=='gif';
  $('#settings-summary').textContent=`${options.model?.includes('flare')?'Flare':'Sunburst'} · ${options.quality||'默认质量'} · ${options.size||'auto'} · ${format.toUpperCase()}`;
  $('#model').textContent=options.model || state.model;
  $('#settings-note').textContent=format==='gif'?'GIF 需上游预览权限；帧数 × 每帧时长决定总时长。':
    format==='svg'?'SVG 仅支持无参考图的生图；矢量结果可查看和下载。':
    `${options.size==='auto'?'自动选择尺寸':'按请求尺寸生成，以实际返回为准'} · 4K 受 3840 边长和 8.29MP 限制；质量与复杂度分别控制。`;
  controls();
}
function optionsChanged(event) {
  if(!selected || locked || state?.busy)return;
  const options=selected.options;
  if(event.target.dataset.option) {
    const field=event.target,key=field.dataset.option;
    if(field.type==='checkbox')options[key]=field.checked;
    else if(field.value==='')delete options[key];
    else options[key]=field.type==='number'||key==='partialImages'?Number(field.value):field.value;
    if(key==='outputFormat') {
      if(!['jpeg','webp'].includes(options.outputFormat))delete options.outputCompression;
      if(options.outputFormat!=='gif'){delete options.frameCount;delete options.frameDurationMs;}
      if(['gif','svg'].includes(options.outputFormat)){delete options.stream;delete options.partialImages;}
    }
    if(key==='stream'&&!options.stream)delete options.partialImages;
  } else {
    selected.resolution=$('#option-resolution').value;selected.ratio=Number($('#option-ratio').value);
    try {options.size=selected.resolution==='auto'?'auto':selected.resolution==='custom'?$('#option-size').value.trim():
      resolutionSize(selected.resolution,selected.ratio);}
    catch(error){showError(error);return;}
    selected.size=options.size;
    if(!selected.imageId&&options.size!=='auto') {
      const [w,h]=options.size.split('x').map(Number);
      if(w>0&&h>0&&h/w<=3&&w/h<=3){selected.height=selected.width*h/w;renderNode(selected);}
    }
  }
  syncOptions();checkpoint();queueSave();
}
for(const field of document.querySelectorAll('[data-option],#option-resolution,#option-ratio,#option-size'))field.addEventListener('change',optionsChanged);
$('#generation-settings').addEventListener('toggle',positionPanels);
function applyCamera() {
  world.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`;
  $('#zoom-value').textContent = `${Math.round(camera.zoom * 100)}%`;
  positionPanels();
}
function positionPanels() {
  const composer = $('#composer'), actions = $('#selection-actions');
  composer.hidden = !selected || !composerOpen; actions.hidden = !selectionIds.size || Boolean(selected && composerOpen);
  if (selected) {
    const w = Math.min(520, innerWidth - 24), h = composer.offsetHeight || 224;
    const x = selected.x * camera.zoom + camera.x, y = selected.y * camera.zoom + camera.y;
    composer.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, x + (selected.width * camera.zoom - w) / 2))}px`;
    composer.style.top = `${Math.max(60, Math.min(innerHeight - h - 88, y + selected.height * camera.zoom + 14))}px`;
    $('#selection-label').textContent = `${entryFor(selected)?.label || 'AI 图片框'}${shapes.length ? ` · ${shapes.length} 处标注` : ''}`;
    $('#open-composer').textContent = selected.imageId ? '按标注修改' : '输入描述';
    $('#open-composer').hidden = false;
    actions.style.left = `${Math.max(12, Math.min(innerWidth - 260, x))}px`;
    actions.style.top = `${Math.max(60, Math.min(innerHeight - 120, y + selected.height * camera.zoom + 12))}px`;
  } else if (selectionIds.size) {
    $('#selection-label').textContent = `已选 ${selectionIds.size} 个图片框 · 拖动、复制或删除`;
    $('#open-composer').hidden = true; actions.style.left = '50%'; actions.style.top = '65px';
  }
  if (!$('#reference-picker').hidden) {
    const b = $('#references-toggle').getBoundingClientRect(), picker = $('#reference-picker');
    picker.style.left = `${Math.max(12, Math.min(innerWidth - 302, b.left))}px`;
    picker.style.top = `${Math.max(65, Math.min(innerHeight - picker.offsetHeight - 80, b.bottom + 6))}px`;
  }
}
function fitAll() {
  if (!nodes.length) return;
  const left = Math.min(...nodes.map(n => n.x)), top = Math.min(...nodes.map(n => n.y));
  const width = Math.max(...nodes.map(n => n.x + n.width)) - left;
  const height = Math.max(...nodes.map(n => n.y + n.height + 30)) - top;
  camera.zoom = Math.max(.05, Math.min(1.15, (stage.clientWidth - 240) / width, (stage.clientHeight - 370) / height));
  camera.x = (stage.clientWidth - 160 - width * camera.zoom) / 2 - left * camera.zoom;
  camera.y = (stage.clientHeight - 270 - height * camera.zoom) / 2 - top * camera.zoom;
  applyCamera(); queueSave();
}
function focusNode(node) {
  const x = node.x * camera.zoom + camera.x, y = node.y * camera.zoom + camera.y;
  if (x < 30 || y < 70 || x + node.width * camera.zoom > stage.clientWidth - 210 ||
    y + node.height * camera.zoom > stage.clientHeight - 340) {
    camera.zoom = Math.max(.05, Math.min(camera.zoom, (stage.clientWidth - 240) / node.width, (stage.clientHeight - 370) / node.height));
    camera.x = (stage.clientWidth - 160) / 2 - (node.x + node.width / 2) * camera.zoom;
    camera.y = (stage.clientHeight - 270) / 2 - (node.y + node.height / 2) * camera.zoom;
    applyCamera(); queueSave();
  }
}
function zoomAt(factor, x = stage.clientWidth / 2, y = stage.clientHeight / 2) {
  const zoom = Math.max(.05, Math.min(5, camera.zoom * factor));
  camera.x = x - (x - camera.x) * zoom / camera.zoom;
  camera.y = y - (y - camera.y) * zoom / camera.zoom;
  camera.zoom = zoom; applyCamera(); queueSave();
}
function renderConnections() {
  const svg = $('#connections'); svg.replaceChildren();
  for (const node of nodes) {
    const entry = entryFor(node), parent = nodes.find(n => n.imageId && n.imageId === entry?.sourceId);
    if (!parent) continue;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const x1 = parent.x + parent.width + 9, y1 = parent.y + parent.height / 2;
    const x2 = node.x - 9, y2 = node.y + node.height / 2, bend = Math.max(40, Math.abs(x2 - x1) / 2);
    path.setAttribute('d', `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`);
    for (const [key, value] of Object.entries({ fill: 'none', stroke: '#c8cdd5', 'stroke-width': '1.5', 'stroke-dasharray': '4 5' }))
      path.setAttribute(key, value);
    svg.append(path);
  }
}
function renderNode(node) {
  let element = elements.get(node.id);
  const entry = entryFor(node), key = entry?.id || 'draft';
  if (!element) {
    element = document.createElement('article'); element.className = 'node'; element.dataset.nodeId = node.id;
    element.setAttribute('aria-label', '画布图片框'); world.append(element); elements.set(node.id, element);
  }
  if (element.dataset.imageKey !== key) {
    element.replaceChildren();
    const header = document.createElement('div'); header.className = 'node-header';
    const label = document.createElement('span'); label.className = 'node-label'; label.textContent = entry?.label || 'AI 图片';
    const meta = document.createElement('span'); meta.className = 'node-meta'; header.append(label, meta);
    const body = document.createElement('div'); body.className = `node-body${entry ? '' : ' draft-body'}`;
    if (entry) {
      const image = document.createElement('img'); image.className = 'node-image'; image.src = entry.src;
      image.alt = entry.label; image.draggable = false; body.append(image);
    } else {
      const icon = document.createElement('span'); icon.className = 'draft-icon'; icon.textContent = '✧';
      const title = document.createElement('strong'); title.textContent = 'AI 图片框';
      const text = document.createElement('p'); text.className = 'draft-prompt'; body.append(icon, title, text);
    }
    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      const resize = document.createElement('div'); resize.className = 'node-resize'; resize.dataset.corner = corner; resize.title = '拖动调整图片框大小'; body.append(resize);
    }
    element.append(header, body); element.dataset.imageKey = key;
  }
  element.style.transform = `translate(${node.x}px,${node.y}px)`; element.style.width = `${node.width}px`;
  element.querySelector('.node-body').style.height = `${node.height}px`;
  element.classList.toggle('selected', selected?.id === node.id);
  element.classList.toggle('multi-selected', !selected && selectionIds.has(node.id));
  element.querySelector('.node-meta').textContent = entry?.width ? `${entry.width} × ${entry.height}` : node.size || '1024x1024';
  const text = element.querySelector('.draft-prompt'); if (text) text.textContent = node.prompt || '选中后输入描述，生成你的第一版图片';
  // Keep annotations visible on unselected originals without allocating a full-size canvas per image.
  if (entry && node.shapes?.length) {
    let preview = element.querySelector('.saved-annotations');
    if (!preview) { preview = document.createElement('canvas'); preview.className = 'saved-annotations'; element.querySelector('.node-body').append(preview); }
    const pixelWidth = entry.width || node.pixelWidth, pixelHeight = entry.height || node.pixelHeight;
    const key = JSON.stringify([pixelWidth, pixelHeight, node.shapes]);
    if (pixelWidth && pixelHeight && preview.dataset.content !== key) {
      const scale = Math.min(1, 1024 / Math.max(pixelWidth, pixelHeight));
      preview.width = Math.max(1, Math.round(pixelWidth * scale)); preview.height = Math.max(1, Math.round(pixelHeight * scale));
      const brush = preview.getContext('2d'); brush.scale(preview.width / pixelWidth, preview.height / pixelHeight);
      for (const shape of node.shapes) drawShape(shape, brush);
      preview.dataset.content = key;
    }
  } else element.querySelector('.saved-annotations')?.remove();
}
function renderBoard() {
  for (const node of nodes) renderNode(node);
  for (const [id, element] of elements) if (!nodes.some(n => n.id === id)) { element.remove(); elements.delete(id); }
  $('#empty').hidden = nodes.length > 0;
  $('#image-count').textContent = `${nodes.length} 个图片框`;
  renderConnections(); positionPanels();
}
function renderHistory() {
  const list = $('#history'); list.replaceChildren();
  for (const node of nodes.filter(n => n.imageId)) {
    const entry = entryFor(node); if (!entry) continue;
    const button = document.createElement('button'); button.className = `version${selected?.id === node.id ? ' selected' : ''}`;
    button.setAttribute('aria-label', `定位${entry.label}`);
    const image = document.createElement('img'); image.src = entry.src; image.alt = entry.label;
    const label = document.createElement('span'); label.textContent = entry.label; button.append(image, label);
    button.addEventListener('click', () => { selectNode(node).catch(showError); focusNode(node); }); list.append(button);
  }
}
function drawShape(shape, brush = ctx) {
  const a = shape.points[0], b = shape.points.at(-1);
  brush.strokeStyle = brush.fillStyle = shape.color; brush.lineWidth = shape.width; brush.lineCap = brush.lineJoin = 'round'; brush.beginPath();
  if (shape.tool === 'text') {
    const font = Math.max(24, shape.width * 4);
    brush.font = `${font}px "Segoe UI","Microsoft YaHei",sans-serif`;
    (shape.text || '').split('\n').forEach((line, i) => brush.fillText(line, a.x, a.y + i * font * 1.3)); return;
  }
  if (shape.tool === 'pen') {
    brush.moveTo(a.x, a.y); if (shape.points.length === 1) brush.lineTo(a.x + .01, a.y);
    for (const point of shape.points.slice(1)) brush.lineTo(point.x, point.y);
  } else if (shape.tool === 'ellipse') brush.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2,
    Math.max(.1, Math.abs(b.x - a.x) / 2), Math.max(.1, Math.abs(b.y - a.y) / 2), 0, 0, Math.PI * 2);
  else if (shape.tool === 'rectangle') brush.rect(a.x, a.y, b.x - a.x, b.y - a.y);
  else {
    brush.moveTo(a.x, a.y); brush.lineTo(b.x, b.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x), length = Math.max(18, shape.width * 3);
    brush.moveTo(b.x - length * Math.cos(angle - .5), b.y - length * Math.sin(angle - .5)); brush.lineTo(b.x, b.y);
    brush.lineTo(b.x - length * Math.cos(angle + .5), b.y - length * Math.sin(angle + .5));
  }
  brush.stroke();
}
function draw() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  for (const shape of shapes) drawShape(shape);
  if (draft) drawShape(draft);
  if (ready) $('#dimensions').textContent = `${source.width} × ${source.height} px · ${shapes.length} 处标注`;
  controls();
}
async function selectNode(node, force = false, keepSelection = false) {
  if (!force && selected?.id === node?.id && selectionIds.size <= 1) { composerOpen = true; positionPanels(); return; }
  finishText();
  if (!force) remember();
  if (!keepSelection) selectionIds = new Set(node ? [node.id] : []);
  selected = node; ready = false; shapes = node?.shapes || []; draft = null;
  composerOpen = !drawingTools.includes(tool); closePopovers();
  promptInput.value = node?.prompt || ''; requestId = fingerprint = null; imageLoad++;
  overlay.hidden = true;
  $('#frame-options').hidden = !node || Boolean(node.imageId); $('#download').hidden = !node?.imageId;
  $('#editor-title').textContent = node?.imageId ? '按标注修改' : 'AI 图片生成';
  promptInput.placeholder = node?.imageId ? '描述修改要求，或使用图片上的文字标注' : '描述你想生成的图片';
  $('#dimensions').textContent = node?.imageId ? '正在加载底图…' : '按所选比例请求图片，以实际返回尺寸为准';
  syncOptions();
  renderReferences(); renderBoard(); renderHistory(); controls(); queueSave();
  if (!node?.imageId) return;
  const entry = entryFor(node), thisLoad = imageLoad;
  $('#download').href = entry.src; $('#download').download = `vvvcode-${entry.id}.${entry.format || 'png'}`;
  if(entry.editable===false) {
    $('#editor-title').textContent=`${entry.format.toUpperCase()} 结果`;
    $('#dimensions').textContent=`${entry.width||'—'} × ${entry.height||'—'} · 查看与下载`;
    controls();promptInput.disabled=true;return;
  }
  const image = new Image(); image.src = entry.src;
  try {
    await image.decode();
    if (thisLoad !== imageLoad) return;
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 16777216) throw new Error('底图超过 16,777,216 像素，无法添加 API 标注层。');
    source.width = overlay.width = image.naturalWidth; source.height = overlay.height = image.naturalHeight;
    source.getContext('2d').drawImage(image, 0, 0);
    node.pixelWidth = image.naturalWidth; node.pixelHeight = image.naturalHeight;
    node.height = node.width * image.naturalHeight / image.naturalWidth; renderNode(node); positionPanels();
    elements.get(node.id).querySelector('.node-body').append(overlay); overlay.hidden = false;
    $('#download').href = entry.src; $('#download').download = `vvvcode-${entry.id}.${entry.format || 'png'}`;
    ready = true; draw(); queueSave();
  } catch (error) { if (thisLoad === imageLoad) { ready = false; showError(error); controls(); } }
}
function createFrame() {
  if (locked || state?.busy) return;
  if (nodes.length >= 300) return showError(new Error('画布最多支持 300 个图片框。'));
  remember(); closePopovers(); setTool('select');
  const node = { id: crypto.randomUUID(), x: (stage.clientWidth / 2 - camera.x) / camera.zoom - 180,
    y: (stage.clientHeight / 2 - camera.y) / camera.zoom - 210, width: 360, height: 360,
    size: state.defaults.size || '1024x1024', prompt: '', shapes: [] };
  if(node.size!=='auto') {
    const [w,h]=node.size.split('x').map(Number);
    node.height=node.width*h/w;
  }
  if (nodes.some(n => Math.abs(n.x - node.x) < 360 && Math.abs(n.y - node.y) < 360)) {
    node.x = Math.max(...nodes.map(n => n.x + n.width)) + 100; node.y = nodes.at(-1).y;
  }
  nodes.push(node); renderBoard(); selectNode(node).catch(showError); focusNode(node); promptInput.focus(); checkpoint(); queueSave();
}
function showError(error) { setStatus(error.message || String(error), 'error'); }
function sourcePoint(event) {
  const b = overlay.getBoundingClientRect();
  return { x: Math.max(0, Math.min(source.width, (event.clientX - b.left) * source.width / b.width)),
    y: Math.max(0, Math.min(source.height, (event.clientY - b.top) * source.height / b.height)) };
}
function eraseAt(point) {
  const tolerance = 7 * source.width / overlay.getBoundingClientRect().width;
  shapes = shapes.filter(shape => !hitAnnotation(shape, point, tolerance)); remember(); draw();
}
function finishText(cancel = false) {
  if (!textDraft) return;
  const pending = textDraft; textDraft = null;
  const input = $('#inline-text'), text = input.value.trim(); input.hidden = true;
  if (!cancel && text && selected?.id === pending.nodeId) {
    shapes.push({ ...pending.shape, text }); remember(); draw(); renderBoard(); checkpoint(); queueSave();
  }
}
overlay.addEventListener('pointerdown', event => {
  if (space || event.button === 1 || tool === 'hand') return;
  if (!ready || state.busy || locked || event.button !== 0 || !drawingTools.includes(tool)) return;
  event.preventDefault(); event.stopPropagation(); overlay.setPointerCapture(event.pointerId);
  const shape = { tool, color: $('#color').value, width: Number($('#width').value), points: [sourcePoint(event)] };
  if (tool === 'text') {
    finishText(); const input = $('#inline-text'); textDraft = { nodeId: selected.id, shape };
    input.value = ''; input.hidden = false; input.style.color = shape.color;
    input.style.left = `${Math.max(5, Math.min(innerWidth - 290, event.clientX))}px`;
    input.style.top = `${Math.max(55, Math.min(innerHeight - 180, event.clientY - 24))}px`;
    input.style.fontSize = `${Math.max(16, shape.width * 4 * overlay.getBoundingClientRect().width / source.width)}px`;
    input.focus();
  } else if (tool === 'eraser') { erasing = true; eraseAt(sourcePoint(event)); }
  else { draft = shape; draw(); }
});
overlay.addEventListener('pointermove', event => {
  if (erasing) return eraseAt(sourcePoint(event));
  if (!draft) return;
  if (draft.tool === 'pen') draft.points.push(sourcePoint(event)); else draft.points[1] = sourcePoint(event);
  draw();
});
overlay.addEventListener('pointerup', event => {
  if (erasing) { erasing = false; checkpoint(); renderBoard(); queueSave(); return; }
  if (!draft) return;
  draft.points.push(sourcePoint(event)); shapes.push(draft); draft = null; remember(); draw(); renderBoard(); checkpoint(); queueSave();
});
overlay.addEventListener('pointercancel', () => { draft = null; if (erasing) { erasing = false; checkpoint(); queueSave(); } draw(); });
$('#inline-text').addEventListener('blur', () => finishText());
$('#inline-text').addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') { event.preventDefault(); finishText(true); stage.focus(); }
  else if (shouldSubmit(event)) { event.preventDefault(); finishText(); stage.focus(); }
});
function selectGroup(ids) {
  ids = new Set(ids);
  if (ids.size === selectionIds.size && [...ids].every(id => selectionIds.has(id))) return;
  remember(); selectionIds = new Set(ids);
  selectNode(selectionIds.size === 1 ? nodes.find(n => selectionIds.has(n.id)) : null, true, true).catch(showError);
}
stage.addEventListener('pointerdown', event => {
  if (event.target.closest('.empty')) return;
  const node = nodes.find(n => n.id === event.target.closest('[data-node-id]')?.dataset.nodeId);
  const pan = tool === 'hand' || space || event.button === 1;
  if (event.button !== 0 && event.button !== 1) return;
  finishText(); event.preventDefault(); stage.focus(); stage.setPointerCapture(event.pointerId); closePopovers();
  if (pan) {
    gesture = { type: 'pan', x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y };
    stage.classList.add('panning'); return;
  }
  if (!node) {
    if (!event.shiftKey) selectNode(null).catch(showError);
    gesture = { type: 'marquee', x: event.clientX, y: event.clientY, previous: event.shiftKey ? [...selectionIds] : [] }; return;
  }
  if (event.shiftKey) {
    const ids = new Set(selectionIds); if (ids.has(node.id)) ids.delete(node.id); else ids.add(node.id);
    selectGroup(ids); return;
  }
  if (!selectionIds.has(node.id)) selectNode(node).catch(showError);
  else if (selectionIds.size === 1) { composerOpen = true; positionPanels(); }
  if (state.busy || locked) return;
  gesture = { type: event.target.closest('.node-resize') ? 'resize' : 'move', node,
    x: event.clientX, y: event.clientY, nx: node.x, ny: node.y, width: node.width, height: node.height,
    corner: event.target.closest('.node-resize')?.dataset.corner,
    originals: nodes.filter(n => selectionIds.has(n.id)).map(n => ({ id: n.id, x: n.x, y: n.y })) };
});
stage.addEventListener('pointermove', event => {
  if (!gesture) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  if (gesture.type === 'pan') { camera.x = gesture.cx + dx; camera.y = gesture.cy + dy; applyCamera(); }
  else if (gesture.type === 'marquee') {
    const left = Math.min(gesture.x, event.clientX), top = Math.min(gesture.y, event.clientY);
    const right = Math.max(gesture.x, event.clientX), bottom = Math.max(gesture.y, event.clientY);
    Object.assign($('#marquee').style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` }); $('#marquee').hidden = false;
    const ids = nodes.filter(n => n.x * camera.zoom + camera.x < right && (n.x + n.width) * camera.zoom + camera.x > left &&
      n.y * camera.zoom + camera.y < bottom && (n.y + n.height) * camera.zoom + camera.y > top).map(n => n.id);
    selectGroup(new Set([...gesture.previous, ...ids]));
  }
  else if (gesture.type === 'move') {
    if (Math.abs(dx) + Math.abs(dy) > 4) gesture.moved = true;
    for (const original of gesture.originals) {
      const node = nodes.find(n => n.id === original.id); if (!node) continue;
      node.x = original.x + dx / camera.zoom; node.y = original.y + dy / camera.zoom; renderNode(node);
    }
    if (Math.abs(dx) + Math.abs(dy) > 4) composerOpen = false;
    renderConnections(); positionPanels();
  } else {
    const ratio = gesture.height / gesture.width;
    const sx = gesture.corner?.includes('w') ? -1 : 1, sy = gesture.corner?.includes('n') ? -1 : 1;
    const change = Math.abs(dx) >= Math.abs(dy / ratio) ? sx * dx : sy * dy / ratio;
    const width = Math.max(64, Math.min(5000, 10000 / ratio, gesture.width + change / camera.zoom));
    gesture.node.width = width; gesture.node.height = width * ratio;
    if (gesture.corner?.includes('w')) gesture.node.x = gesture.nx + gesture.width - width;
    if (gesture.corner?.includes('n')) gesture.node.y = gesture.ny + gesture.height - width * ratio;
    renderNode(gesture.node); renderConnections(); positionPanels();
  }
});
const endGesture = () => {
  if (gesture) {
    if (gesture.type === 'move' && !gesture.moved && selectionIds.size > 1) selectNode(gesture.node).catch(showError);
    if (!['pan', 'marquee'].includes(gesture.type)) checkpoint(); queueSave();
  }
  gesture = null; $('#marquee').hidden = true; stage.classList.remove('panning');
};
stage.addEventListener('pointerup', endGesture); stage.addEventListener('pointercancel', endGesture);
stage.addEventListener('wheel', event => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    const b = stage.getBoundingClientRect(); zoomAt(Math.exp(-event.deltaY * .008), event.clientX - b.x, event.clientY - b.y);
  } else { camera.x -= event.deltaX; camera.y -= event.deltaY; applyCamera(); queueSave(); }
}, { passive: false });
window.addEventListener('keydown', event => {
  if (event.target.closest('input,textarea,select') || event.isComposing) return;
  if (event.code === 'Space') { event.preventDefault(); space = true; controls(); }
  const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
  if (mod && key === 'z') { event.preventDefault(); $(`#${event.shiftKey ? 'redo' : 'undo'}`).click(); return; }
  if (mod && key === 'y') { event.preventDefault(); $('#redo').click(); return; }
  if (mod && key === 'd') { event.preventDefault(); $('#duplicate').click(); return; }
  if (mod && key === 'a') { event.preventDefault(); selectGroup(nodes.map(n => n.id)); return; }
  if (mod || event.altKey || event.repeat) return;
  if (event.key === 'Escape') { setTool('select'); closePopovers(); $('#shortcuts').hidden = true; composerOpen = false; positionPanels(); return; }
  if (key === 'delete' || key === 'backspace') { event.preventDefault(); $('#delete').click(); return; }
  if (event.shiftKey && event.code === 'Digit1') return fitAll();
  if (event.shiftKey && event.code === 'Digit0') return zoomAt(1 / camera.zoom);
  if (key === '?') { $('#shortcuts').hidden = !$('#shortcuts').hidden; return; }
  if (key === 'a' && !locked && !state.busy) { event.preventDefault(); createFrame(); return; }
  const shortcuts = { v: 'select', h: 'hand', c: 'pen', d: 'pen', e: 'eraser', t: 'text', l: 'arrow', r: 'rectangle', o: 'ellipse' };
  if (shortcuts[key]) setTool(shortcuts[key]);
});
window.addEventListener('keyup', event => { if (event.code === 'Space') { space = false; controls(); } });
window.addEventListener('blur', () => { space = false; endGesture(); controls(); });
function setTool(next) {
  if (drawingTools.includes(next) && (!ready || state?.busy || locked)) return;
  finishText(); tool = next;
  for (const item of document.querySelectorAll('[data-tool]')) item.setAttribute('aria-pressed', String(item.dataset.tool === tool));
  if (drawingTools.includes(tool)) composerOpen = false;
  controls();
}
for (const button of document.querySelectorAll('[data-tool]')) button.addEventListener('click', () => setTool(button.dataset.tool));
async function restore(snapshot) {
  if (!snapshot) return;
  const id = selected?.id; selected = null; shapes = [];
  nodes = snapshot.nodes; deletedImageIds.clear(); snapshot.deletedImageIds.forEach(id => deletedImageIds.add(id));
  await selectNode(nodes.find(n => n.id === id) || null, true); renderBoard(); renderHistory(); controls(); queueSave();
}
$('#undo').addEventListener('click', () => restore(history.undo(state.images)).catch(showError));
$('#redo').addEventListener('click', () => restore(history.redo(state.images)).catch(showError));
$('#clear').addEventListener('click', () => { shapes = []; remember(); draw(); renderBoard(); checkpoint(); queueSave(); closePopovers(); });
$('#delete').addEventListener('click', () => {
  remember();
  const removed = nodes.filter(n => selectionIds.has(n.id)); nodes = nodes.filter(n => !selectionIds.has(n.id));
  for (const node of removed) if (node.imageId && !nodes.some(n => n.imageId === node.imageId)) deletedImageIds.add(node.imageId);
  selectNode(null, true).catch(showError); checkpoint(); queueSave();
});
$('#duplicate').addEventListener('click', () => {
  remember(); const originals = nodes.filter(n => selectionIds.has(n.id));
  if (nodes.length + originals.length > 300) return showError(new Error('画布最多支持 300 个图片框。'));
  const copies = structuredClone(originals).map(n => ({ ...n, id: crypto.randomUUID(), x: n.x + 36, y: n.y + 36 }));
  nodes.push(...copies); selectGroup(copies.map(n => n.id)); renderBoard(); checkpoint(); queueSave();
});
$('#new-frame').addEventListener('click', createFrame); $('#empty-create').addEventListener('click', createFrame);
$('#tool-frame').addEventListener('click', createFrame);
$('#zoom-in').addEventListener('click', () => zoomAt(1.25)); $('#zoom-out').addEventListener('click', () => zoomAt(.8));
$('#zoom-fit').addEventListener('click', fitAll);
$('#zoom-value').addEventListener('click', () => zoomAt(1 / camera.zoom));
promptInput.addEventListener('input', () => { remember(); if (selected) renderNode(selected); controls(); queueSave(); });
promptInput.addEventListener('blur', checkpoint);
promptInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault(); if (shouldSubmit(event)) submit.click();
  }
});
for (const button of document.querySelectorAll('[data-size]')) button.addEventListener('click', () => {
  if (!selected || selected.imageId) return;
  selected.size = button.dataset.size; const [w, h] = selected.size.split('x').map(Number);
  selected.options.size=selected.size;selected.resolution='custom';syncOptions();
  selected.height = selected.width * h / w; renderNode(selected); checkpoint(); controls(); focusNode(selected); queueSave();
});
async function update(next) {
  if (state) remember();
  const first = !state, previous = state?.currentId;
  state = next; offline = false; $('#model').textContent = selected?.options?.model || state.model;
  $('#stream-preview').hidden=!state.preview;
  if(state.preview) {
    if($('#preview-image').getAttribute('src')!==state.preview.src)$('#preview-image').src=state.preview.src;
    $('#preview-index').textContent=`第 ${Number(state.preview.index||0)+1} 张`;
  } else $('#preview-image').removeAttribute('src');
  if (first && state.layout) {
    nodes = state.layout.nodes; camera = state.layout.camera;
    for (const id of state.layout.deletedImageIds || []) deletedImageIds.add(id);
  }
  const added = [];
  for (const entry of state.images) {
    if (entry.referenceOnly || deletedImageIds.has(entry.id) || nodes.some(node => node.imageId === entry.id)) continue;
    let node = entry.mode === 'generate' && nodes.find(n => n.id === entry.canvasNodeId && !n.imageId);
    if (node) { node.imageId = entry.id; node.height = node.width * (entry.height || 1) / (entry.width || 1); node.prompt = ''; }
    else {
      const parent = nodes.find(n => n.imageId === entry.sourceId);
      node = { id: crypto.randomUUID(), imageId: entry.id, x: parent ? parent.x + parent.width + 110 :
        nodes.length ? Math.max(...nodes.map(n => n.x + n.width)) + 100 : 80,
      y: parent?.y ?? 80, width: parent?.width || 360, height: 360, prompt: '', shapes: [] };
      node.height = node.width * (entry.height || 1) / (entry.width || 1);
      while (nodes.some(n => Math.abs(n.x - node.x) < 50 && Math.abs(n.y - node.y) < node.height + 50)) node.y += node.height + 100;
      nodes.push(node);
    }
    node.options ||= structuredClone(entry.options || state.defaults);
    added.push(node);
  }
  applyCamera(); renderBoard();
  if (first) {
    const node = nodes.find(n => n.imageId === state.currentId) || nodes[0];
    if (node && !node.prompt && state.prompt) node.prompt = state.prompt;
    if (node) await selectNode(node);
    if (!state.layout) fitAll();
  } else if (state.currentId !== previous && added.length) {
    setTool('select'); await selectNode(added.at(-1), true); focusNode(added.at(-1)); queueSave();
  }
  if (state.finished) { $('#done').hidden = false; clearTimeout(refreshTimer); return; }
  if (state.busy) setStatus('正在调用 API，结果会自动放到画布上。', 'busy');
  else if (state.error) setStatus(`生成失败：${state.error}。标注仍保留，可检查后手动提交。`, 'error');
  else if (!first && added.length) {
    const warnings=state.images.at(-1)?.warnings || [];
    setStatus(warnings.length?warnings.join('；'):'新图片已放到画布，可继续选择、标注或生成。',warnings.length?'error':'');
    requestId = fingerprint = null;
  }
  if (first || added.length) checkpoint();
  if (first && !state.busy && !state.error) setStatus('');
  renderReferences(); renderHistory(); controls(); scheduleRefresh();
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!state?.finished) refreshTimer = setTimeout(refresh, state?.busy ? 1000 : 5000);
}
async function refresh() {
  try { await update(await api('api/state')); }
  catch {
    offline = true; controls(); setStatus('无法连接本地服务，画布不会自动重新提交请求。', 'error');
    refreshTimer = setTimeout(refresh, 3000);
  }
}
submit.addEventListener('click', async () => {
  if (submit.disabled) return;
  locked = true; controls(); clearTimeout(refreshTimer); setStatus('正在保存画布并提交…', 'busy');
  try {
    // Capture the authorized image and drawing before the first await: the user
    // can still navigate the board while its layout is being saved.
    const payload = { revision: state.revision, mode: selected.imageId ? 'edit' : 'generate',
      canvasNodeId: selected.id, referenceIds: selected.referenceIds || [],
      options:normalizeOptions({...selected.options,mode:selected.imageId||selected.referenceIds?.length?'edit':'generate'}),
      prompt: promptInput.value.trim() || '按照图片中的圈选、箭头和文字标注修改画面，移除标注痕迹，保留未要求修改的内容。' };
    if (selected.imageId) {
      payload.sourceId = selected.imageId;
      if (shapes.length) payload.markup = overlay.toDataURL('image/png');
      if (entryFor(selected).requiresNormalization) payload.sourcePng = source.toDataURL('image/png');
    }
    const current = JSON.stringify(payload);
    if (!requestId || current !== fingerprint || state.error) requestId = crypto.randomUUID();
    fingerprint = current; payload.requestId = requestId;
    await saveNow();
    const next = await api('api/submit', payload); locked = false; await update(next);
  } catch (error) { locked = false; showError(error); controls(); scheduleRefresh(); }
});
async function importFiles(files, referenceOnly = false) {
  if (state?.busy || locked) return;
  const target = selected;
  if (referenceOnly && !target) return;
  locked = true; controls();
  try {
    for (const file of files) {
      if (referenceOnly && (target.referenceIds?.length || 0) >= 4) throw new Error('最多添加 4 张参考图。');
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 静态图片。');
      if (file.size > 50 * 1024 * 1024) throw new Error('图片超过 50 MiB。');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
      });
      const next = await api('api/import', { image: data, name: file.name, referenceOnly });
      if (referenceOnly) {
        target.referenceIds = [...(target.referenceIds || []), next.images.at(-1).id];
        await update(next); renderReferences();
      } else await update(next);
    }
    checkpoint(); queueSave();
  } catch (error) { showError(error); } finally { locked = false; controls(); }
}
$('#import').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', event => { importFiles([...event.target.files]); event.target.value = ''; });
$('#reference-file-input').addEventListener('change', event => { importFiles([...event.target.files], true); event.target.value = ''; });
stage.addEventListener('dragover', event => { event.preventDefault(); });
stage.addEventListener('drop', event => { event.preventDefault(); importFiles([...event.dataTransfer.files]); });
window.addEventListener('paste', event => {
  if (event.target.closest('input,textarea') && event.target !== promptInput) return;
  const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); importFiles(files, event.target === promptInput); }
});
$('#export-markup').addEventListener('click', () => {
  const link = document.createElement('a'); link.href = overlay.toDataURL('image/png'); link.download = 'markup.png'; link.click();
});
$('#finish').addEventListener('click', async () => {
  if (state.busy || locked) return;
  locked = true; controls(); clearTimeout(refreshTimer);
  try { await saveNow(); await api('api/finish', {}); state.finished = true; $('#done').hidden = false; }
  catch (error) { locked = false; showError(error); controls(); scheduleRefresh(); }
});
function closePopovers(except) {
  for (const [panel, toggle] of [['menu', 'menu-toggle'], ['more-menu', 'more-toggle'], ['gallery', 'document-toggle'], ['reference-picker', 'references-toggle']]) {
    if (panel === except) continue;
    $(`#${panel}`).hidden = true; $(`#${toggle}`).setAttribute('aria-expanded', 'false');
  }
}
for (const [toggle, panel] of [['menu-toggle', 'menu'], ['more-toggle', 'more-menu'], ['document-toggle', 'gallery'], ['references-toggle', 'reference-picker']])
  $(`#${toggle}`).addEventListener('click', () => {
    const open = $(`#${panel}`).hidden; closePopovers(); $(`#${panel}`).hidden = !open;
    $(`#${toggle}`).setAttribute('aria-expanded', String(open));
    if (panel === 'reference-picker') renderReferences(); positionPanels();
  });
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.popover,#menu-toggle,#more-toggle,#document-toggle,#references-toggle')) closePopovers();
});
$('#menu-import').addEventListener('click', () => { closePopovers(); $('#file-input').click(); });
$('#menu-fit').addEventListener('click', () => { closePopovers(); fitAll(); });
$('#shortcuts-toggle').addEventListener('click', () => { closePopovers(); $('#shortcuts').hidden = false; });
$('#shortcuts-close').addEventListener('click', () => { $('#shortcuts').hidden = true; });
$('#composer-close').addEventListener('click', () => { composerOpen = false; closePopovers(); positionPanels(); stage.focus(); });
$('#open-composer').addEventListener('click', () => { composerOpen = true; setTool('select'); focusNode(selected); positionPanels(); promptInput.focus(); });
$('#reference-import').addEventListener('click', () => { closePopovers(); $('#reference-file-input').click(); });
function renderReferences() {
  const chips = $('#reference-chips'), list = $('#reference-list'); chips.replaceChildren(); list.replaceChildren();
  const refs = selected?.referenceIds || [];
  for (const entry of state?.images || []) {
    if (entry.id === selected?.imageId || entry.editable===false) continue;
    const button = document.createElement('button'); button.title = entry.label; button.setAttribute('aria-label', `参考图 ${entry.label}`);
    button.setAttribute('aria-pressed', String(refs.includes(entry.id)));
    button.disabled = locked || state.busy || !selected || refs.length >= 4 && !refs.includes(entry.id);
    const image = new Image(); image.src = entry.src; image.alt = entry.label; button.append(image);
    button.addEventListener('click', () => {
      if (!selected || locked || state.busy) return;
      selected.referenceIds = refs.includes(entry.id) ? refs.filter(id => id !== entry.id) : [...refs, entry.id];
      renderReferences(); checkpoint(); queueSave();
    });
    list.append(button);
    if (refs.includes(entry.id)) {
      const chip = document.createElement('div'); chip.className = 'reference-chip'; chip.append(image.cloneNode());
      const remove = document.createElement('button'); remove.append(icon('close')); remove.setAttribute('aria-label', `移除参考图 ${entry.label}`);
      remove.disabled = locked || state.busy;
      remove.addEventListener('click', () => {
        if (!selected || locked || state.busy) return;
        selected.referenceIds = refs.filter(id => id !== entry.id); renderReferences(); checkpoint(); queueSave();
      });
      chip.append(remove); chips.append(chip);
    }
  }
  if (!list.childElementCount) { const text = document.createElement('p'); text.textContent = '导入参考图，或使用画布上的其他图片'; list.append(text); }
  $('#references-toggle').hidden = refs.length >= 4; positionPanels();
}
const palette = [
  ['#1d1d1d','黑色'], ['#9b9b9b','灰色'], ['#c5a3e6','浅紫'], ['#ae3ec9','紫色'],
  ['#4263eb','蓝色'], ['#4dabf7','浅蓝'], ['#f1c40f','黄色'], ['#f76707','橙色'],
  ['#099268','绿色'], ['#40c057','浅绿'], ['#e03131','红色'], ['#ff8787','浅红'],
];
function syncStyle() {
  for (const button of document.querySelectorAll('[data-color]')) button.setAttribute('aria-pressed', String(button.dataset.color === $('#color').value));
  for (const button of document.querySelectorAll('[data-width]')) button.setAttribute('aria-pressed', String(button.dataset.width === $('#width').value));
  $('#width-value').textContent = $('#width').value;
}
for (const [color, name] of palette) {
  const button = document.createElement('button'); button.className = 'color-swatch'; button.dataset.color = color;
  button.setAttribute('aria-label', name); button.title = name; button.style.setProperty('--swatch', color);
  button.append(document.createElement('span')); button.addEventListener('click', () => { $('#color').value = color; syncStyle(); }); $('#colors').append(button);
}
for (const button of document.querySelectorAll('[data-width]')) button.addEventListener('click', () => { $('#width').value = button.dataset.width; syncStyle(); });
$('#color').addEventListener('input', syncStyle); $('#width').addEventListener('input', syncStyle); syncStyle();
let toolbarDrag;
$('#toolbar-grip').addEventListener('pointerdown', event => {
  if (event.button !== 0) return; event.preventDefault();
  const b = $('#toolbar').getBoundingClientRect(); toolbarDrag = { x: event.clientX, y: event.clientY, left: b.left, top: b.top };
  event.currentTarget.setPointerCapture(event.pointerId);
});
$('#toolbar-grip').addEventListener('pointermove', event => {
  if (!toolbarDrag) return;
  const toolbar = $('#toolbar');
  Object.assign(toolbar.style, { transform: 'none', bottom: 'auto',
    left: `${Math.max(8, Math.min(innerWidth - toolbar.offsetWidth - 8, toolbarDrag.left + event.clientX - toolbarDrag.x))}px`,
    top: `${Math.max(62, Math.min(innerHeight - toolbar.offsetHeight - 8, toolbarDrag.top + event.clientY - toolbarDrag.y))}px` });
});
for (const type of ['pointerup', 'pointercancel']) $('#toolbar-grip').addEventListener(type, () => { toolbarDrag = null; });
window.addEventListener('resize', () => {
  positionPanels();
  if ($('#toolbar').style.top) Object.assign($('#toolbar').style, { left: '50%', top: '', bottom: '', transform: '' });
});
window.addEventListener('beforeunload', event => {
  if (!state?.finished && (state?.busy || saveTimer)) { event.preventDefault(); event.returnValue = ''; }
});
try { await update(await api('api/state')); } catch (error) { showError(error); refreshTimer = setTimeout(refresh, 3000); }
