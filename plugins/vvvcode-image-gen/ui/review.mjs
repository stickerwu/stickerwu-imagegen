const $ = selector => document.querySelector(selector);
const stage = $('#stage'), world = $('#world'), source = $('#source'), overlay = $('#overlay');
const ctx = overlay.getContext('2d'), promptInput = $('#prompt'), submit = $('#submit');
const drawingTools = ['pen', 'ellipse', 'rectangle', 'arrow', 'text'];
let state, nodes = [], camera = { x: 80, y: 60, zoom: 1 }, selected = null;
let tool = 'select', shapes = [], draft = null, gesture = null, space = false;
let ready = false, locked = false, imageLoad = 0, refreshTimer, saveTimer, saving = Promise.resolve();
let requestId = null, fingerprint = null, offline = false;
const elements = new Map();
const setStatus = (text, kind = '') => { $('#status').textContent = text; $('#status').className = `status ${kind}`; };
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
  if (selected) { selected.prompt = promptInput.value; selected.shapes = shapes; }
}
function queueSave() {
  if (!state || state.finished) return;
  clearTimeout(saveTimer); $('#save-status').textContent = '正在保存…';
  saveTimer = setTimeout(() => { saveTimer = null; saveNow().catch(() => {}); }, 450);
}
async function saveNow() {
  clearTimeout(saveTimer); saveTimer = null; remember();
  const payload = JSON.parse(JSON.stringify({ camera, nodes }));
  saving = saving.catch(() => {}).then(() => api('api/layout', payload));
  try { await saving; $('#save-status').textContent = '画布已保存'; }
  catch (error) { $('#save-status').textContent = '保存失败'; setStatus(`画布尚未保存：${error.message}`, 'error'); throw error; }
}
function controls() {
  const busy = locked || state?.busy || state?.finished;
  submit.disabled = busy || offline || !selected || !promptInput.value.trim() || Boolean(selected.imageId && !ready);
  promptInput.disabled = busy || !selected;
  $('#finish').disabled = busy; $('#import').disabled = busy; $('#file-input').disabled = busy; $('#ratio').disabled = busy;
  for (const button of document.querySelectorAll('[data-tool]'))
    button.disabled = drawingTools.includes(button.dataset.tool) && (busy || !ready);
  $('#undo').disabled = busy || !shapes.length; $('#clear').disabled = busy || !shapes.length;
  $('#export-markup').disabled = busy || !ready;
  overlay.style.pointerEvents = ready && drawingTools.includes(tool) && !busy ? 'auto' : 'none';
  $('#submit-label').textContent = busy ? '正在生成，请稍候' : !selected ? '选择图片或新建框' : selected.imageId ? '按标注修改' : '生成图片';
  stage.classList.toggle('hand', tool === 'hand'); stage.classList.toggle('space', space);
  $('#text-options').hidden = tool !== 'text';
}
function applyCamera() {
  world.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`;
  stage.style.backgroundPosition = `${camera.x}px ${camera.y}px`;
  stage.style.backgroundSize = `${24 * camera.zoom}px ${24 * camera.zoom}px`;
  $('#zoom-value').textContent = `${Math.round(camera.zoom * 100)}%`;
}
function fitAll() {
  if (!nodes.length) return;
  const left = Math.min(...nodes.map(n => n.x)), top = Math.min(...nodes.map(n => n.y));
  const width = Math.max(...nodes.map(n => n.x + n.width)) - left;
  const height = Math.max(...nodes.map(n => n.y + n.height + 30)) - top;
  camera.zoom = Math.max(.05, Math.min(1.15, (stage.clientWidth - 130) / width, (stage.clientHeight - 170) / height));
  camera.x = (stage.clientWidth - width * camera.zoom) / 2 - left * camera.zoom;
  camera.y = (stage.clientHeight - height * camera.zoom) / 2 - top * camera.zoom - 20;
  applyCamera(); queueSave();
}
function focusNode(node) {
  const x = node.x * camera.zoom + camera.x, y = node.y * camera.zoom + camera.y;
  if (x < 30 || y < 30 || x + node.width * camera.zoom > stage.clientWidth - 30 ||
    y + (node.height + 30) * camera.zoom > stage.clientHeight - 110) {
    camera.zoom = Math.max(.05, Math.min(camera.zoom, (stage.clientWidth - 100) / node.width, (stage.clientHeight - 180) / (node.height + 30)));
    camera.x = stage.clientWidth / 2 - (node.x + node.width / 2) * camera.zoom;
    camera.y = (stage.clientHeight - 70) / 2 - (node.y + node.height / 2 + 15) * camera.zoom;
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
    const x1 = parent.x + parent.width + 9, y1 = parent.y + 30 + parent.height / 2;
    const x2 = node.x - 9, y2 = node.y + 30 + node.height / 2, bend = Math.max(40, Math.abs(x2 - x1) / 2);
    path.setAttribute('d', `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`);
    for (const [key, value] of Object.entries({ fill: 'none', stroke: '#b7c8ad', 'stroke-width': '1.5', 'stroke-dasharray': '5 5' }))
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
    const resize = document.createElement('div'); resize.className = 'node-resize'; resize.title = '拖动调整图片框大小';
    body.append(resize); element.append(header, body); element.dataset.imageKey = key;
  }
  element.style.transform = `translate(${node.x}px,${node.y}px)`; element.style.width = `${node.width}px`;
  element.querySelector('.node-body').style.height = `${node.height}px`;
  element.classList.toggle('selected', selected?.id === node.id);
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
  $('#image-count').textContent = `${state.images.length} 张图片 · ${nodes.filter(n => !n.imageId).length} 个 AI 框`;
  renderConnections();
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
    brush.font = `${Math.max(24, shape.width * 4)}px "Segoe UI","Microsoft YaHei",sans-serif`; brush.fillText(shape.text || '', a.x, a.y); return;
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
async function selectNode(node, force = false) {
  if (!force && selected?.id === node?.id) return;
  if (!force) remember();
  selected = node; ready = false; shapes = node?.shapes || []; draft = null;
  promptInput.value = node?.prompt || ''; requestId = fingerprint = null; imageLoad++;
  overlay.hidden = true;
  $('#frame-options').hidden = !node || Boolean(node.imageId); $('#download').hidden = !node?.imageId;
  $('#operation-label').textContent = node?.imageId ? 'REFINE IMAGE' : node ? 'GENERATE IMAGE' : 'IMAGE CANVAS';
  $('#editor-title').textContent = node?.imageId ? '让这一版，更近一步。' : node ? '从一个想法开始。' : '在画布上开始创作。';
  $('#editor-help').textContent = node?.imageId ? '在图上圈画并填写要求，新结果会出现在原图旁边。' : '输入画面描述，生成结果将填入选中的 AI 图片框。';
  $('#prompt-label').textContent = node?.imageId ? '修改要求' : '画面描述';
  $('#dimensions').textContent = node?.imageId ? '正在加载底图…' : '按所选比例请求图片，以实际返回尺寸为准';
  if (node && !node.imageId) $('#ratio').value = node.size || '1024x1024';
  renderBoard(); renderHistory(); controls(); queueSave();
  if (!node?.imageId) return;
  const entry = entryFor(node), thisLoad = imageLoad;
  const image = new Image(); image.src = entry.src;
  try {
    await image.decode();
    if (thisLoad !== imageLoad) return;
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 16777216) throw new Error('底图超过 16,777,216 像素，无法添加 API 标注层。');
    source.width = overlay.width = image.naturalWidth; source.height = overlay.height = image.naturalHeight;
    source.getContext('2d').drawImage(image, 0, 0);
    node.pixelWidth = image.naturalWidth; node.pixelHeight = image.naturalHeight;
    node.height = node.width * image.naturalHeight / image.naturalWidth; renderNode(node);
    elements.get(node.id).querySelector('.node-body').append(overlay); overlay.hidden = false;
    $('#download').href = entry.src; $('#download').download = `vvvcode-${entry.id}.${entry.format || 'png'}`;
    ready = true; draw(); queueSave();
  } catch (error) { if (thisLoad === imageLoad) { ready = false; showError(error); controls(); } }
}
function createFrame() {
  const node = { id: crypto.randomUUID(), x: (stage.clientWidth / 2 - camera.x) / camera.zoom - 180,
    y: (stage.clientHeight / 2 - camera.y) / camera.zoom - 210, width: 360, height: 360,
    size: '1024x1024', prompt: '', shapes: [] };
  if (nodes.some(n => Math.abs(n.x - node.x) < 360 && Math.abs(n.y - node.y) < 360)) {
    node.x = Math.max(...nodes.map(n => n.x + n.width)) + 100; node.y = nodes.at(-1).y;
  }
  nodes.push(node); renderBoard(); selectNode(node).catch(showError); focusNode(node); promptInput.focus(); queueSave();
}
function showError(error) { setStatus(error.message || String(error), 'error'); }
function sourcePoint(event) {
  const b = overlay.getBoundingClientRect();
  return { x: Math.max(0, Math.min(source.width, (event.clientX - b.left) * source.width / b.width)),
    y: Math.max(0, Math.min(source.height, (event.clientY - b.top) * source.height / b.height)) };
}
overlay.addEventListener('pointerdown', event => {
  if (space || event.button === 1 || tool === 'hand') return;
  if (!ready || state.busy || locked || event.button !== 0 || !drawingTools.includes(tool)) return;
  event.stopPropagation(); overlay.setPointerCapture(event.pointerId);
  const shape = { tool, color: $('#color').value, width: Number($('#width').value), points: [sourcePoint(event)] };
  if (tool === 'text') {
    if (!$('#annotation-text').value.trim()) { setStatus('先填写右侧的标注文字，再点击图片放置。'); return; }
    shape.text = $('#annotation-text').value.trim(); shapes.push(shape); remember(); draw(); queueSave();
  } else { draft = shape; draw(); }
});
overlay.addEventListener('pointermove', event => {
  if (!draft) return;
  if (draft.tool === 'pen') draft.points.push(sourcePoint(event)); else draft.points[1] = sourcePoint(event);
  draw();
});
overlay.addEventListener('pointerup', event => {
  if (!draft) return;
  draft.points.push(sourcePoint(event)); shapes.push(draft); draft = null; remember(); draw(); queueSave();
});
overlay.addEventListener('pointercancel', () => { draft = null; draw(); });
stage.addEventListener('pointerdown', event => {
  if (event.target.closest('.toolbar,.zoom,.empty')) return;
  const node = nodes.find(n => n.id === event.target.closest('[data-node-id]')?.dataset.nodeId);
  const pan = tool === 'hand' || space || event.button === 1 || !node;
  if (event.button !== 0 && event.button !== 1) return;
  event.preventDefault(); stage.setPointerCapture(event.pointerId);
  if (pan) {
    gesture = { type: 'pan', x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y };
    stage.classList.add('panning'); return;
  }
  selectNode(node).catch(showError);
  gesture = { type: event.target.closest('.node-resize') ? 'resize' : 'move', node,
    x: event.clientX, y: event.clientY, nx: node.x, ny: node.y, width: node.width, height: node.height };
});
stage.addEventListener('pointermove', event => {
  if (!gesture) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  if (gesture.type === 'pan') { camera.x = gesture.cx + dx; camera.y = gesture.cy + dy; applyCamera(); }
  else if (gesture.type === 'move') {
    gesture.node.x = gesture.nx + dx / camera.zoom; gesture.node.y = gesture.ny + dy / camera.zoom;
    renderNode(gesture.node); renderConnections();
  } else {
    const ratio = gesture.height / gesture.width;
    const width = Math.max(64, Math.min(5000, 10000 / ratio, gesture.width + dx / camera.zoom));
    gesture.node.width = width; gesture.node.height = width * ratio;
    renderNode(gesture.node); renderConnections();
  }
});
const endGesture = () => { if (gesture) queueSave(); gesture = null; stage.classList.remove('panning'); };
stage.addEventListener('pointerup', endGesture); stage.addEventListener('pointercancel', endGesture);
stage.addEventListener('wheel', event => {
  if (event.target.closest('.toolbar,.zoom')) return;
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    const b = stage.getBoundingClientRect(); zoomAt(Math.exp(-event.deltaY * .008), event.clientX - b.x, event.clientY - b.y);
  } else { camera.x -= event.deltaX; camera.y -= event.deltaY; applyCamera(); queueSave(); }
}, { passive: false });
window.addEventListener('keydown', event => {
  if (event.target.closest('input,textarea,select')) return;
  if (event.code === 'Space') { event.preventDefault(); space = true; controls(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !$('#undo').disabled) $('#undo').click();
});
window.addEventListener('keyup', event => { if (event.code === 'Space') { space = false; controls(); } });
window.addEventListener('blur', () => { space = false; gesture = null; controls(); });
for (const button of document.querySelectorAll('[data-tool]')) button.addEventListener('click', () => {
  tool = button.dataset.tool;
  for (const item of document.querySelectorAll('[data-tool]')) item.setAttribute('aria-pressed', String(item === button));
  controls();
});
$('#undo').addEventListener('click', () => { shapes.pop(); remember(); draw(); queueSave(); });
$('#clear').addEventListener('click', () => { shapes = []; remember(); draw(); queueSave(); });
$('#new-frame').addEventListener('click', createFrame); $('#empty-create').addEventListener('click', createFrame);
$('#zoom-in').addEventListener('click', () => zoomAt(1.25)); $('#zoom-out').addEventListener('click', () => zoomAt(.8));
$('#zoom-fit').addEventListener('click', fitAll);
promptInput.addEventListener('input', () => { remember(); if (selected) renderNode(selected); controls(); queueSave(); });
$('#ratio').addEventListener('change', () => {
  if (!selected || selected.imageId) return;
  selected.size = $('#ratio').value; const [w, h] = selected.size.split('x').map(Number);
  selected.height = selected.width * h / w; renderNode(selected); queueSave();
});
async function update(next) {
  if (state) remember();
  const first = !state, previous = state?.currentId;
  state = next; offline = false; $('#model').textContent = state.model;
  if (first && state.layout) { nodes = state.layout.nodes; camera = state.layout.camera; }
  const added = [];
  for (const entry of state.images) {
    if (nodes.some(node => node.imageId === entry.id)) continue;
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
    added.push(node);
  }
  applyCamera(); renderBoard();
  if (first) {
    const node = nodes.find(n => n.imageId === state.currentId) || nodes[0];
    if (node && !node.prompt && state.prompt) node.prompt = state.prompt;
    if (node) await selectNode(node);
    if (!state.layout) fitAll();
  } else if (state.currentId !== previous && added.length) {
    await selectNode(added.at(-1), true); focusNode(added.at(-1)); queueSave();
  }
  if (state.finished) { $('#done').hidden = false; clearTimeout(refreshTimer); return; }
  if (state.busy) setStatus('正在调用 API，结果会自动放到画布上。', 'busy');
  else if (state.error) setStatus(`生成失败：${state.error}。标注仍保留，可检查后手动提交。`, 'error');
  else if (!first && added.length) { setStatus('新图片已放到画布，可继续选择、标注或生成。'); requestId = fingerprint = null; }
  renderHistory(); controls(); scheduleRefresh();
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
      canvasNodeId: selected.id, prompt: promptInput.value.trim() };
    if (selected.imageId) {
      payload.sourceId = selected.imageId;
      if (shapes.length) payload.markup = overlay.toDataURL('image/png');
      if (entryFor(selected).requiresNormalization) payload.sourcePng = source.toDataURL('image/png');
    } else payload.size = selected.size || '1024x1024';
    const current = JSON.stringify(payload);
    if (!requestId || current !== fingerprint || state.error) requestId = crypto.randomUUID();
    fingerprint = current; payload.requestId = requestId;
    await saveNow();
    const next = await api('api/submit', payload); locked = false; await update(next);
  } catch (error) { locked = false; showError(error); controls(); scheduleRefresh(); }
});
async function importFiles(files) {
  if (state?.busy || locked) return;
  locked = true; controls();
  try {
    for (const file of files) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 静态图片。');
      if (file.size > 50 * 1024 * 1024) throw new Error('图片超过 50 MiB。');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
      });
      await update(await api('api/import', { image: data, name: file.name }));
    }
    queueSave();
  } catch (error) { showError(error); } finally { locked = false; controls(); }
}
$('#import').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', event => { importFiles([...event.target.files]); event.target.value = ''; });
stage.addEventListener('dragover', event => { event.preventDefault(); });
stage.addEventListener('drop', event => { event.preventDefault(); importFiles([...event.dataTransfer.files]); });
window.addEventListener('paste', event => {
  if (event.target.closest('input,textarea')) return;
  const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); importFiles(files); }
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
window.addEventListener('beforeunload', event => {
  if (!state?.finished && (state?.busy || saveTimer)) { event.preventDefault(); event.returnValue = ''; }
});
try { await update(await api('api/state')); } catch (error) { showError(error); refreshTimer = setTimeout(refresh, 3000); }
