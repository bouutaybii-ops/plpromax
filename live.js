// Points live dyal FPL: bonus provisoire (mn l-BPS), auto-subs, captain/vice, chips.
// Fonctions pures: kayt-testaw b `node live.test.mjs` bla téléphone.

const POS_MIN = { 2: 3, 3: 2, 4: 1 }; // DEF ≥ 3, MID ≥ 2, FWD ≥ 1 (GK = 1 toujours)

/**
 * Bonus provisoire: f kol match bda w mazal l-bonus ma t-confirmach, l-ktar 3 f l-BPS kayakhdo 3/2/1.
 * Les égalités: classement "compétition" (1,1,3 → 3,3,1 ; 1,2,2 → 3,2,2 ; 1,2,3,3 → 3,2,1,1).
 * Kayrje3 { elementId: bonus }.
 */
export function provisionalBonus(fixtures) {
  const out = {};
  for (const f of fixtures || []) {
    if (!f.started) continue;
    const stat = id => (f.stats || []).find(s => s.identifier === id);
    const confirmed = stat('bonus');
    if (confirmed && (confirmed.h.length || confirmed.a.length)) continue; // FPL déjà 3tah f total_points
    const bps = stat('bps');
    if (!bps) continue;
    const rows = [...bps.h, ...bps.a].sort((x, y) => y.value - x.value);
    rows.forEach(r => {
      const rank = 1 + rows.filter(o => o.value > r.value).length;
      const b = rank === 1 ? 3 : rank === 2 ? 2 : rank === 3 ? 1 : 0;
      if (b) out[r.element] = (out[r.element] || 0) + b;
    });
  }
  return out;
}

/** Les matchs dyal kol équipe f had la journée. */
export function fixturesByTeam(fixtures) {
  const by = {};
  for (const f of fixtures || []) {
    (by[f.team_h] = by[f.team_h] || []).push(f);
    (by[f.team_a] = by[f.team_a] || []).push(f);
  }
  return by;
}

/**
 * L-équipe dyal manager f journée: points dyal kol joueur, auto-subs, captain, w l-total.
 * - picks: mn /entry/{id}/event/{gw}/picks/ (picks + active_chip + entry_history)
 * - live:  { elementId: { minutes, total_points } } mn /event/{gw}/live/
 * - players: { elementId: { t: element_type, team } } mn bootstrap
 * - byTeam: fixturesByTeam(...)   - bonus: provisionalBonus(...)
 */
export function liveTeam({ picks, chip, live, players, byTeam, bonus }) {
  const info = id => {
    const st = live[id] || {};
    const fx = byTeam[(players[id] || {}).team] || [];
    const done = fx.every(f => f.finished || f.finished_provisional);
    const started = fx.some(f => f.started);
    const minutes = st.minutes || 0;
    return {
      base: (st.total_points || 0) + (bonus[id] || 0),
      bonus: bonus[id] || 0,
      minutes,
      played: minutes > 0,
      done,
      // Ma l3bch w l-match(s) dyalo salaw (wla ma 3ndoch match): kaytbeddel.
      dnp: done && minutes === 0,
      started,
    };
  };

  const rows = picks.map(p => ({ ...p, ...info(p.element), type: p.element_type || (players[p.element] || {}).t, eff: p.multiplier, subIn: false, subOut: false }));
  const bboost = chip === 'bboost';
  const xi = rows.filter(r => r.position <= 11);
  const bench = rows.filter(r => r.position >= 12 && r.position <= 15).sort((a, b) => a.position - b.position);

  if (!bboost) {
    const count = () => {
      const c = { 1: 0, 2: 0, 3: 0, 4: 0 };
      xi.forEach(r => { if (!r.subOut) c[r.type] = (c[r.type] || 0) + 1; });
      return c;
    };
    for (const out of xi.filter(r => r.dnp).sort((a, b) => a.position - b.position)) {
      const candidates = bench.filter(b => !b.subIn && b.played && (out.type === 1 ? b.type === 1 : b.type !== 1));
      for (const b of candidates) {
        out.subOut = true;
        const c = count();
        c[b.type] = (c[b.type] || 0) + 1;
        const ok = out.type === 1 || Object.entries(POS_MIN).every(([t, min]) => c[t] >= min);
        if (ok) { b.subIn = true; xi.push(b); break; }
        out.subOut = false;
      }
    }
  }

  const counts = r => (bboost ? r.position <= 15 : (r.position <= 11 && !r.subOut) || r.subIn) || r.position > 15;
  // Badil dkhel: multiplier dyalo f picks kan 0, daba kaywelli 1. Captain = 2 (TC = 3).
  rows.forEach(r => { r.eff = counts(r) ? (r.is_captain ? Math.max(r.multiplier, 2) : 1) : 0; });

  // Captain: ila ma l3bch, l-vice kayakhed l-multiplicateur dyalo.
  const cap = rows.find(r => r.is_captain);
  const vice = rows.find(r => r.is_vice_captain);
  if (cap && cap.dnp && vice && vice.played && counts(vice)) {
    vice.eff = cap.eff || Math.max(cap.multiplier, 2);
    cap.eff = 0;
  }
  rows.forEach(r => { r.pts = r.base * r.eff; });
  const total = rows.reduce((t, r) => t + r.pts, 0);
  const benchPts = bboost ? 0 : rows.filter(r => r.position >= 12 && r.position <= 15 && !r.subIn).reduce((t, r) => t + r.base, 0);
  const left = rows.filter(r => counts(r) && !r.done).length;
  const provisional = rows.reduce((t, r) => t + (r.eff ? r.bonus * r.eff : 0), 0);
  return { rows, total, benchPts, left, provisional };
}

/** { elementId: { minutes, total_points } } mn /event/{gw}/live/ */
export function liveStats(liveJson) {
  const out = {};
  for (const el of liveJson.elements || []) out[el.id] = { minutes: el.stats.minutes, total_points: el.stats.total_points };
  return out;
}
