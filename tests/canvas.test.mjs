import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasHistory, hitAnnotation, shouldSubmit } from '../plugins/vvvcode-image-gen/ui/canvas-model.mjs';

test('Enter submission respects multiline, IME composition, keyCode 229 and held keys', () => {
  assert.equal(shouldSubmit({ key: 'Enter' }), true);
  for (const fields of [{ shiftKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }])
    assert.equal(shouldSubmit({ key: 'Enter', ...fields }), false);
  assert.equal(shouldSubmit({ key: 'a' }), false);
});

test('canvas undo and redo restore independent snapshots without replaying generation', () => {
  const history = new CanvasHistory(4);
  const canvas = { nodes: [{ id: 'frame', x: 0, shapes: [] }], deletedImageIds: [] };
  history.push(canvas);
  canvas.nodes[0].x = 80; history.push(canvas);
  canvas.nodes[0].shapes.push({ tool: 'pen' }); history.push(canvas);
  const undo = history.undo();
  assert.equal(undo.nodes[0].x, 80);
  assert.deepEqual(undo.nodes[0].shapes, []);
  undo.nodes[0].x = 999;
  assert.equal(history.undo().nodes[0].x, 0);
  assert.equal(history.redo().nodes[0].x, 80);
  history.push({ nodes: [], deletedImageIds: ['asset'] });
  assert.equal(history.canRedo, false);
  assert.deepEqual(history.undo().deletedImageIds, []);
});

test('undoing a generated frame hides its existing asset from polling until redo', () => {
  const history = new CanvasHistory();
  const source = { id: 'source-frame', imageId: 'source' };
  history.push({ nodes: [source, { id: 'target-frame', prompt: '画一只猫' }], deletedImageIds: [] });
  history.push({ nodes: [source, { id: 'target-frame', imageId: 'result' }], deletedImageIds: [] });
  const images = [{ id: 'source' }, { id: 'result' }, { id: 'reference', referenceOnly: true }];
  const undone = history.undo(images);
  assert.deepEqual(undone.deletedImageIds, ['result']);
  assert.equal(undone.nodes[1].imageId, undefined);
  assert.equal(undone.nodes[1].prompt, '画一只猫');
  const redone = history.redo(images);
  assert.deepEqual(redone.deletedImageIds, []);
  assert.equal(redone.nodes[1].imageId, 'result');
  assert.deepEqual(history.undo(images).deletedImageIds, ['result']);
});

test('eraser hits actual stroke outlines and text rather than empty bounding boxes', () => {
  const shape = { tool: 'pen', width: 4, points: [{ x: 10, y: 10 }, { x: 100, y: 100 }] };
  assert.equal(hitAnnotation(shape, { x: 50, y: 52 }, 3), true);
  assert.equal(hitAnnotation(shape, { x: 10, y: 100 }, 3), false);
  const rectangle = { ...shape, tool: 'rectangle' };
  assert.equal(hitAnnotation(rectangle, { x: 50, y: 50 }, 3), false);
  assert.equal(hitAnnotation(rectangle, { x: 10, y: 50 }, 3), true);
  const circle = { ...shape, tool: 'ellipse' };
  assert.equal(hitAnnotation(circle, { x: 55, y: 55 }, 3), false);
  assert.equal(hitAnnotation(circle, { x: 55, y: 10 }, 3), true);
  const text = { ...shape, tool: 'text', text: '这里变蓝\n保留背景' };
  assert.equal(hitAnnotation(text, { x: 22, y: 0 }, 3), true);
});
