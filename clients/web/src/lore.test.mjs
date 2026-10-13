import assert from 'node:assert/strict';
import test from 'node:test';
import { filterLore, resolveRelatedLore, safeLorePreview } from './lore.ts';

const article = (id, title, values = {}) => ({ id, title, kind: 'location', tags: [], body: '', revision: 1, visibility: 'shared', archived: false, ...values });

test('Lore browse filters the same entries by kind, tag, query, and archive state', () => {
  const entries = [article('a', 'Sunken Archive', { tags: ['ruins', 'coast'] }), article('b', 'Old Archive', { kind: 'handout', archived: true })];
  assert.deepEqual(filterLore(entries, 'sunken', 'location', 'RUINS').map(item => item.id), ['a']);
  assert.deepEqual(filterLore(entries, '', 'all', '', true).map(item => item.id), ['b']);
});

test('Lore preview removes executable markup and hides external link and image targets', () => {
  const preview = safeLorePreview('# Archive\n<script>alert(1)</script> [danger](javascript:alert(1)) ![map](https://example.invalid/map.png)');
  assert.equal(preview.includes('<script>'), false);
  assert.equal(preview.includes('javascript:'), false);
  assert.equal(preview.includes('https://'), false);
  assert.match(preview, /danger/);
  assert.match(preview, /map/);
});

test('related Lore resolves only explicit encounter links among accessible non-archived entries', () => {
  const entries = [article('visible', 'Shared'), article('archived', 'Old', { archived: true })];
  assert.deepEqual(resolveRelatedLore(['hidden', 'archived', 'visible'], entries).map(item => item.id), ['visible']);
  assert.deepEqual(resolveRelatedLore(undefined, entries), []);
});
