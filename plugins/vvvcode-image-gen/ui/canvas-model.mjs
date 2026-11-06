export const shouldSubmit = event => event.key === 'Enter' && !event.shiftKey && !event.altKey &&
  !event.isComposing && event.keyCode !== 229 && !event.repeat;

export class CanvasHistory {
  constructor(limit = 60) { this.limit = limit; this.items = []; this.index = -1; }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.items.length - 1; }
  push(value) {
    const snapshot = JSON.stringify(value);
    if (this.items[this.index] === snapshot) return;
    this.items.splice(this.index + 1);
    this.items.push(snapshot);
    if (this.items.length > this.limit) this.items.shift();
    this.index = this.items.length - 1;
  }
  restore(index, images) {
    const snapshot = JSON.parse(this.items[index]);
    const visible = new Set(snapshot.nodes.map(node => node.imageId));
    const deleted = new Set(snapshot.deletedImageIds || []);
    // Completed API assets outlive their frames; keep undone results hidden
    // when the server's next state poll lists those same existing files.
    for (const image of images) if (!image.referenceOnly && !visible.has(image.id)) deleted.add(image.id);
    snapshot.deletedImageIds = [...deleted];
    return snapshot;
  }
  undo(images = []) { return this.canUndo ? this.restore(--this.index, images) : null; }
  redo(images = []) { return this.canRedo ? this.restore(++this.index, images) : null; }
}

function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function hitAnnotation(shape, p, tolerance = 6) {
  const a = shape.points[0], b = shape.points.at(-1), radius = tolerance + shape.width / 2;
  if (shape.tool === 'text') {
    const font = Math.max(24, shape.width * 4), lines = (shape.text || '').split('\n');
    return p.x >= a.x - tolerance && p.x <= a.x + Math.max(...lines.map(line => [...line].length)) * font + tolerance &&
      p.y >= a.y - font - tolerance && p.y <= a.y + (lines.length - 1) * font * 1.3 + tolerance;
  }
  if (shape.tool === 'ellipse') {
    const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
    if (!rx || !ry) return segmentDistance(p, a, b) <= radius;
    const x = (p.x - (a.x + b.x) / 2) / rx, y = (p.y - (a.y + b.y) / 2) / ry;
    return Math.abs(Math.hypot(x, y) - 1) * Math.min(rx, ry) <= radius;
  }
  let points = shape.points;
  if (shape.tool === 'rectangle') points = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a];
  if (points.length === 1) return Math.hypot(p.x - a.x, p.y - a.y) <= radius;
  return points.slice(1).some((point, i) => segmentDistance(p, points[i], point) <= radius);
}
