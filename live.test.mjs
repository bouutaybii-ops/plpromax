// node --test : kayjarreb l-7sab dyal les points live (live.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixturesByTeam, liveTeam, provisionalBonus } from './live.js';

// 15 joueurs: GK 1, DEF 2-6, MID 7-11, FWD 12-14, GK2 15. Équipe = id (kol joueur f équipe dyalo).
const TYPES = { 1: 1, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 4, 13: 4, 14: 4, 15: 1 };
const players = Object.fromEntries(Object.entries(TYPES).map(([id, t]) => [id, { t, team: +id }]));
// XI 4-4-2: GK1, DEF 2-5, MID 7-10, FWD 12-13. Banc: GK15, DEF6, MID11, FWD14.
const order = [1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 15, 6, 11, 14];
const picks = (cap = 12, vice = 13, capMult = 2) =>
  order.map((el, i) => ({ element: el, position: i + 1, multiplier: i >= 11 ? 0 : el === cap ? capMult : 1, is_captain: el === cap, is_vice_captain: el === vice, element_type: TYPES[el] }));
const fixture = (team, state) => ({ id: team, team_h: team, team_a: 100 + team, started: state !== 'todo', finished: state === 'done', finished_provisional: state === 'done', stats: [] });
const ctx = (minutes, states = {}) => {
  const fixtures = Object.keys(TYPES).map(id => fixture(+id, states[id] || 'done'));
  const live = Object.fromEntries(Object.keys(TYPES).map(id => [id, { minutes: minutes[id] ?? 90, total_points: minutes[id] === 0 ? 0 : 2 }]));
  return { live, byTeam: fixturesByTeam(fixtures), bonus: {} };
};

test('everyone played: 11 × 2 points, captain doubled', () => {
  const t = liveTeam({ picks: picks(), chip: null, players, ...ctx({}) });
  assert.equal(t.total, 24);
  assert.equal(t.benchPts, 8);
  assert.equal(t.left, 0);
});

test('a defender who did not play is replaced by the first bench player keeping a valid formation', () => {
  // DEF 2 out. Bench order: DEF6, MID11, FWD14 → DEF6 comes in.
  const t = liveTeam({ picks: picks(), chip: null, players, ...ctx({ 2: 0 }) });
  assert.deepEqual(t.rows.filter(r => r.subIn).map(r => r.element), [6]);
  assert.equal(t.total, 24);
});

test('formation rule skips a bench player that would break it', () => {
  // XI with 3 DEF only: play DEF 2,3,4 + MID 7,8,9,10,11? Use picks where bench DEF6 did not play.
  const t = liveTeam({ picks: picks(), chip: null, players, ...ctx({ 2: 0, 3: 0, 6: 0 }) });
  // DEF2 out → DEF6 did not play → MID11 comes in (still 3 DEF: 3? no: 3 is out too).
  // DEF3 out → only FWD14 left, but then 2 DEF: not allowed → no sub.
  const ins = t.rows.filter(r => r.subIn).map(r => r.element);
  assert.deepEqual(ins, [11]);
  assert.equal(t.rows.find(r => r.element === 3).subOut, false);
});

test('a player whose match has not finished is not replaced yet', () => {
  const t = liveTeam({ picks: picks(), chip: null, players, ...ctx({ 2: 0 }, { 2: 'todo' }) });
  assert.equal(t.rows.filter(r => r.subIn).length, 0);
  assert.equal(t.left, 1);
});

test('the vice-captain gets the armband when the captain did not play', () => {
  const t = liveTeam({ picks: picks(12, 13), chip: null, players, ...ctx({ 12: 0 }) });
  const vice = t.rows.find(r => r.element === 13);
  assert.equal(vice.eff, 2);
  // FWD12 out → FWD14 (bench) in: 10 starters × 2 + vice extra 2 + FWD14 2 = 24
  assert.equal(t.total, 24);
});

test('triple captain and bench boost', () => {
  assert.equal(liveTeam({ picks: picks(12, 13, 3), chip: '3xc', players, ...ctx({}) }).total, 26);
  const bb = order.map((el, i) => ({ element: el, position: i + 1, multiplier: el === 12 ? 2 : 1, is_captain: el === 12, is_vice_captain: false, element_type: TYPES[el] }));
  const t = liveTeam({ picks: bb, chip: 'bboost', players, ...ctx({}) });
  assert.equal(t.total, 32);
  assert.equal(t.benchPts, 0);
});

test('provisional bonus from BPS, ties included, skipped once FPL confirmed it', () => {
  const fx = (bps, bonus = []) => ({ started: true, stats: [{ identifier: 'bps', h: bps, a: [] }, { identifier: 'bonus', h: bonus, a: [] }] });
  const b = v => v.map((value, i) => ({ element: i + 1, value }));
  assert.deepEqual(provisionalBonus([fx(b([40, 40, 30, 20]))]), { 1: 3, 2: 3, 3: 1 });
  assert.deepEqual(provisionalBonus([fx(b([40, 30, 30, 20]))]), { 1: 3, 2: 2, 3: 2 });
  assert.deepEqual(provisionalBonus([fx(b([40, 30, 20, 20]))]), { 1: 3, 2: 2, 3: 1, 4: 1 });
  assert.deepEqual(provisionalBonus([fx(b([40, 30, 20]), [{ element: 1, value: 3 }])]), {});
  assert.deepEqual(provisionalBonus([{ started: false, stats: [] }]), {});
});

test('the first bench player takes the place even before his own match is played (FPL bench order)', () => {
  // MID 7 did not play. Bench order: GK15, DEF6 (match not played yet), MID11 (played), FWD14.
  // FPL brings in DEF6, not MID11: he is first in the bench order and may still play.
  const t = liveTeam({ picks: picks(), chip: null, players, ...ctx({ 7: 0, 6: 0 }, { 6: 'todo' }) });
  assert.deepEqual(t.rows.filter(r => r.subIn).map(r => r.element), [6]);
  // DEF6 has 0 points so far, MID11 stays on the bench: 10 starters × 2 + captain extra 2 = 22
  assert.equal(t.total, 22);
  assert.equal(t.left, 1);
});
