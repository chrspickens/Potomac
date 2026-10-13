import assert from 'node:assert/strict';
import test from 'node:test';
import { filterLore, projectCachedPlayerLore, resolveRelatedLore, safeLorePreview, validateLoreImage } from './lore.ts';

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

test('offline Lore projection accepts only matching shared active article records', () => {
  const shared = { id: 'a', revision: 2, title: 'Visible', kind: 'note', tags: [], body: '', visibility: 'shared', archived: false };
  const privateArticle = { ...shared, id: 'b', visibility: 'gm' };
  const stale = { ...shared, id: 'c', revision: 3 };
  assert.deepEqual(projectCachedPlayerLore([
    { id: 'a', revision: 2, article: shared, links: [] },
    { id: 'b', revision: 2, article: privateArticle, links: [] },
    { id: 'c', revision: 2, article: stale, links: [] },
  ]), [shared]);
});

test('Lore image upload checks the host supported media, matching extension, and size bound', () => {
  assert.equal(validateLoreImage({ name: 'map.png', type: 'image/png', size: 100 }), null);
  assert.match(validateLoreImage({ name: 'map.jpg', type: 'image/png', size: 100 }) || '', /matching file extension/);
  assert.match(validateLoreImage({ name: 'map.svg', type: 'image/svg+xml', size: 100 }) || '', /Choose a PNG/);
  assert.match(validateLoreImage({ name: 'large.webp', type: 'image/webp', size: 5 * 1024 * 1024 + 1 }) || '', /5 MiB/);
});
