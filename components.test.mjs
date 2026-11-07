// node --test: kol composant msta3mel f App.js (<Player …>) khasso ykoun m3arraf wla mjib b import.
// Bla had l-test, chi page ymken tmout ("Player is not defined") bla ma n3erfo 9bel l-déploiement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('every component used in App.js is defined or imported', () => {
  const src = readFileSync(new URL('./App.js', import.meta.url), 'utf8');
  const used = new Set([...src.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map(m => m[1]));
  const defined = new Set([
    ...[...src.matchAll(/\bfunction ([A-Z][A-Za-z0-9]*)\s*\(/g)].map(m => m[1]),
    ...[...src.matchAll(/\bconst ([A-Z][A-Za-z0-9]*)\s*=/g)].map(m => m[1]),
    ...[...src.matchAll(/import\s*(?:([A-Z]\w*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g)].flatMap(m => [m[1], ...(m[2] || '').split(',').map(x => x.trim().split(/\s+as\s+/).pop())]).filter(Boolean),
  ]);
  const missing = [...used].filter(n => !defined.has(n));
  assert.deepEqual(missing, [], `not defined: ${missing.join(', ')}`);
});
