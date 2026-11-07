// node --test: les statistiques dyal l-ligue (stats.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { competitionRank, leaguePickStats, leagueStats, sharedGws } from './stats.js';

const M = (id, scores, extra = {}) => ({
  id, name: 'M' + id, team: 'T' + id, chips: extra.chips || [],
  gws: Object.fromEntries(scores.map((p, i) => [i + 1, { p, h: (extra.hits || {})[i + 1] || 0, bench: (extra.bench || {})[i + 1] || 0, c: (extra.chip || {})[i + 1] || '', tr: 1, v: 100 + i / 10, or: 1000 - i }])),
});

test('competition ranking gives ties the same rank', () => {
  assert.deepEqual(competitionRank([50, 70, 50, 40]), [2, 1, 2, 4]);
});

test('shared gameweeks only include weeks every manager has', () => {
  const a = M(1, [10, 20, 30]), b = M(2, [10, 20]);
  assert.deepEqual(sharedGws([a, b]), [1, 2]);
});

test('cumulative totals, gap to leader, league rank per gameweek', () => {
  const s = leagueStats([M(1, [50, 40, 60]), M(2, [60, 40, 40]), M(3, [40, 70, 50])]);
  assert.deepEqual(s.cum[1].map(x => x.v), [50, 90, 150]);
  // totals: M1 50/90/150, M2 60/100/140, M3 40/110/160
  assert.deepEqual(s.gap[2].map(x => x.v), [0, 10, 20]);
  assert.deepEqual(s.rank[3].map(x => x.v), [3, 1, 1]);
});

test('heatmap marks the best score and the gap to the league average', () => {
  const s = leagueStats([M(1, [50]), M(2, [70]), M(3, [60])]);
  assert.equal(s.avg[1], 60);
  assert.deepEqual(s.heat[2][1], { p: 70, d: 10, best: true });
  assert.equal(s.heat[1][1].d, -10);
});

test('gameweek wins split ties; all-play counts wins, draws, losses', () => {
  const s = leagueStats([M(1, [70, 50]), M(2, [70, 40]), M(3, [30, 60])]);
  // GW1: M1 and M2 tie on 70 (half a win each); GW2: M3 wins with 60
  assert.deepEqual(s.wins.map(x => x.v), [0.5, 0.5, 1]);
  const ap = s.allPlay.find(x => x.id === 1);
  assert.deepEqual([ap.w, ap.d, ap.l], [2, 1, 1]);
});

test('manager of the month uses FPL phases', () => {
  const phases = [{ id: 2, name: 'August', from: 1, to: 2 }, { id: 3, name: 'September', from: 3, to: 5 }];
  const s = leagueStats([M(1, [50, 50, 90]), M(2, [60, 60, 10])], { phases });
  assert.deepEqual(s.months.map(m => [m.name, m.winners, m.v, m.done]), [['غشت', [2], 120, true], ['شتنبر', [1], 90, false]]);
});

test('hits, bench (not counting bench boost) and awards', () => {
  const s = leagueStats([
    M(1, [50, 80], { hits: { 2: 8 }, bench: { 1: 12, 2: 20 }, chip: { 2: 'bboost' } }),
    M(2, [55, 30], { bench: { 2: 9 } }),
  ]);
  const p1 = s.perById[1];
  assert.equal(p1.hits, 8);
  assert.equal(p1.bench, 12);
  assert.equal(s.awards.bestGw.p, 80);
  assert.equal(s.awards.bigHit.h, 8);
  assert.equal(s.awards.benchDisaster.bench, 12);
  assert.equal(s.awards.spoon.id, 2);
  assert.equal(s.awards.climber.id, 1);
});

test('league captaincy and effective ownership from picks', () => {
  const pk = (el, mult, cap) => ({ element: el, multiplier: mult, is_captain: cap });
  const lp = { gw: 10, by: { 1: { picks: [pk(9, 2, true), pk(5, 1, false)] }, 2: { picks: [pk(9, 3, true), pk(5, 0, false)] } } };
  const r = leaguePickStats(lp, { 9: '80.0', 5: '10.0' });
  assert.deepEqual(r.captains, [{ el: 9, v: 2 }]);
  assert.deepEqual(r.eo.map(x => [x.el, x.owned, x.eo, x.caps, x.global]), [[9, 100, 250, 2, 80], [5, 100, 50, 0, 10]]);
});
