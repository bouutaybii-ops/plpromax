// node --test: l-mouda dyal 7mar l-jawla (donkey.js). Kanjarrbo b s-sa3a dyal tilifoun f l-Maghrib.
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.TZ = 'Africa/Casablanca';
const { donkeyDeadline, formatMoroccoDate, splitCountdown } = await import('./donkey.js');

const fx = (...kickoffs) => kickoffs.map(k => ({ kickoff_time: k }));
const local = ts => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

test('ends at the midnight after the last match of the next gameweek (phone time)', () => {
  // GW10: last match Sunday 8 Nov 16:30 UTC → ends ~18:25 → Monday 9 Nov 00:00
  const t = donkeyDeadline(fx('2026-11-07T15:00:00Z', '2026-11-08T16:30:00Z', '2026-11-08T14:00:00Z'));
  assert.equal(local(t), '2026-11-9 0:00');
  assert.equal(formatMoroccoDate(t), 'الاثنين 9 نونبر · 00:00');
});

test('a late match that ends after midnight pushes the end to the next midnight', () => {
  // Kickoff 23:00 Monday → ends ~00:55 Tuesday → Wednesday 00:00
  const kickoff = new Date(2026, 10, 9, 23, 0).toISOString();
  assert.equal(local(donkeyDeadline(fx(kickoff))), '2026-11-11 0:00');
});

test('postponed matches without a date are ignored; no dates → no deadline', () => {
  assert.equal(local(donkeyDeadline([{ kickoff_time: null }, ...fx('2026-11-08T16:30:00Z')])), '2026-11-9 0:00');
  assert.equal(donkeyDeadline([{ kickoff_time: null }]), null);
  assert.equal(donkeyDeadline([]), null);
});

test('countdown parts', () => {
  assert.deepEqual(splitCountdown(((26 * 60 + 3) * 60 + 7) * 1000), { d: 1, h: 2, m: 3, s: 7 });
  assert.deepEqual(splitCountdown(-5000), { d: 0, h: 0, m: 0, s: 0 });
});
