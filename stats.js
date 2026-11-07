// Les statistiques dyal l-ligue (page إحصائيات). Fonctions pures, kayt-testaw b `npm test`.
// L-input: managers [{ id, name, team, chips: [{name, gw}], gws: { [gw]: { p (net), h, c, bench, tr, v, or, live } } }]
// "p" howa n-n9at mn b3d l-hits (net), b7al l-classement.

const MONTHS_AR = {
  August: 'غشت', September: 'شتنبر', October: 'أكتوبر', November: 'نونبر', December: 'دجنبر', January: 'يناير',
  February: 'فبراير', March: 'مارس', April: 'أبريل', May: 'ماي',
};

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = xs => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
};

/** Tartib "compétition" (1, 1, 3): l-a7san f l-awel. */
export function competitionRank(values, higherIsBetter = true) {
  return values.map(v => 1 + values.filter(o => (higherIsBetter ? o > v : o < v)).length);
}

/** Les jawlat li 3and kolchi fihom score (salaw, wla live), mrattbin. */
export function sharedGws(managers) {
  if (!managers.length) return [];
  const sets = managers.map(m => new Set(Object.keys(m.gws).map(Number)));
  return [...sets[0]].filter(g => sets.every(st => st.has(g))).sort((a, b) => a - b);
}

export function leagueStats(managers, { phases = [], events = {} } = {}) {
  const gws = sharedGws(managers);
  const ids = managers.map(m => m.id);
  const byId = Object.fromEntries(managers.map(m => [m.id, m]));
  const pts = (id, g) => byId[id].gws[g].p;

  // Moyenne dyal l-ligue f kol jawla
  const avg = Object.fromEntries(gws.map(g => [g, mean(ids.map(id => pts(id, g)))]));

  // Cumul, l-far9 m3a l-awel, w t-tartib f kol jawla
  const cum = Object.fromEntries(ids.map(id => [id, []]));
  const gap = Object.fromEntries(ids.map(id => [id, []]));
  const rank = Object.fromEntries(ids.map(id => [id, []]));
  const totals = Object.fromEntries(ids.map(id => [id, 0]));
  for (const g of gws) {
    ids.forEach(id => { totals[id] += pts(id, g); cum[id].push({ gw: g, v: totals[id] }); });
    const vals = ids.map(id => totals[id]);
    const lead = Math.max(...vals);
    const ranks = competitionRank(vals);
    ids.forEach((id, i) => { gap[id].push({ gw: g, v: lead - totals[id] }); rank[id].push({ gw: g, v: ranks[i] }); });
  }

  // Heatmap: n-n9at w l-far9 m3a l-moyenne; l-a7san f kol jawla
  const heat = Object.fromEntries(ids.map(id => [id, {}]));
  const best = {};
  for (const g of gws) {
    const max = Math.max(...ids.map(id => pts(id, g)));
    best[g] = ids.filter(id => pts(id, g) === max);
    ids.forEach(id => { heat[id][g] = { p: pts(id, g), d: pts(id, g) - avg[g], best: pts(id, g) === max }; });
  }

  // Rbe7 l-jawla (b l-ta3adol kayt9asmo)
  const wins = ids.map(id => ({ id, v: gws.reduce((n, g) => n + (best[g].includes(id) ? 1 / best[g].length : 0), 0) }));

  // Manager of the month (phases dyal FPL), ghir les chhour li bdaw
  const months = phases
    .map(ph => {
      const inMonth = gws.filter(g => g >= ph.from && g <= ph.to);
      if (!inMonth.length) return null;
      const sums = ids.map(id => ({ id, v: inMonth.reduce((a, g) => a + pts(id, g), 0) }));
      const top = Math.max(...sums.map(x => x.v));
      return {
        id: ph.id, name: MONTHS_AR[ph.name] || ph.name, from: ph.from, to: ph.to, gws: inMonth.length,
        done: inMonth.length === ph.to - ph.from + 1 && !inMonth.some(g => ids.some(id => byId[id].gws[g].live)),
        winners: sums.filter(x => x.v === top).map(x => x.id), v: top,
      };
    })
    .filter(Boolean);

  // All-play: kol jawla kat-l3eb m3a kolchi
  const allPlay = ids.map(id => {
    let w = 0, d = 0, l = 0;
    for (const g of gws) for (const o of ids) {
      if (o === id) continue;
      const a = pts(id, g), b = pts(o, g);
      if (a > b) w++; else if (a < b) l++; else d++;
    }
    const n = w + d + l;
    return { id, w, d, l, v: n ? (w + d / 2) / n * 100 : 0 };
  });

  const list = id => gws.map(g => byId[id].gws[g]);
  const per = ids.map(id => {
    const L = list(id);
    const ps = L.map(x => x.p);
    const last = L[L.length - 1] || {};
    return {
      id,
      total: totals[id],
      avg: mean(ps),
      sd: sd(ps),
      above: gws.filter(g => pts(id, g) > avg[g]).length,
      hits: L.reduce((a, x) => a + (x.h || 0), 0),
      tr: L.reduce((a, x) => a + (x.tr || 0), 0),
      bench: L.reduce((a, x) => a + (x.c === 'bboost' ? 0 : x.bench || 0), 0),
      value: last.v || 0,
      bank: last.bank || 0,
      or: last.or || null,
      last5: ps.slice(-5),
    };
  });
  const perById = Object.fromEntries(per.map(x => [x.id, x]));

  // Les jawa2iz
  const all = ids.flatMap(id => gws.map(g => ({ id, gw: g, ...byId[id].gws[g] })));
  const maxBy = (xs, f) => xs.reduce((b, x) => (b == null || f(x) > f(b) ? x : b), null);
  const minBy = (xs, f) => xs.reduce((b, x) => (b == null || f(x) < f(b) ? x : b), null);
  const climbs = ids.flatMap(id => rank[id].slice(1).map((r, i) => ({ id, gw: r.gw, v: rank[id][i].v - r.v })));
  const awards = all.length ? {
    bestGw: maxBy(all, x => x.p),
    worstGw: minBy(all, x => x.p),
    bigHit: maxBy(all.filter(x => x.h), x => x.h),
    benchDisaster: maxBy(all.filter(x => x.c !== 'bboost' && x.bench), x => x.bench),
    climber: maxBy(climbs.filter(x => x.v > 0), x => x.v),
    steady: per.length ? minBy(per, x => x.sd) : null,
    spoon: per.length ? minBy(per, x => x.total) : null,
  } : {};

  // Les chips: shkoun l3eb chnou w fin
  const chips = Object.fromEntries(managers.map(m => [m.id, (m.chips || []).map(ch => ({ name: ch.name, gw: ch.gw }))]));
  const chipCounts = {};
  managers.forEach(m => (m.chips || []).forEach(ch => { chipCounts[ch.name] = (chipCounts[ch.name] || 0) + 1; }));

  // L-jawla l-akhira: moyenne dyal l-ligue vs moyenne 3alamiya
  const lastGw = gws[gws.length - 1];
  const lastScores = lastGw ? ids.map(id => ({ id, v: pts(id, lastGw) })) : [];
  const gwTop = lastScores.length ? maxBy(lastScores, x => x.v) : null;

  return {
    gws, ids, avg, cum, gap, rank, heat, best, wins, months, allPlay, per, perById, awards, chips, chipCounts,
    lastGw, leagueAvg: lastGw ? avg[lastGw] : null, globalAvg: lastGw ? (events[lastGw] || {}).avg : null,
    globalHigh: lastGw ? (events[lastGw] || {}).high : null, gwTop, live: lastGw ? ids.some(id => byId[id].gws[lastGw].live) : false,
  };
}

/** Captains w l-EO dyal l-ligue mn les picks dyal l-jawla (data.leaguePicks). */
export function leaguePickStats(leaguePicks, selectedBy = {}) {
  const teams = Object.values((leaguePicks || {}).by || {});
  const n = teams.length;
  const caps = {};
  const eo = {};
  const owned = {};
  for (const t of teams) {
    for (const pk of t.picks) {
      owned[pk.element] = (owned[pk.element] || 0) + 1;
      eo[pk.element] = (eo[pk.element] || 0) + pk.multiplier;
      if (pk.is_captain) caps[pk.element] = (caps[pk.element] || 0) + 1;
    }
  }
  const captains = Object.entries(caps).map(([el, v]) => ({ el: +el, v })).sort((a, b) => b.v - a.v);
  const eoList = Object.keys(owned).map(el => ({
    el: +el,
    owned: owned[el] / (n || 1) * 100,
    eo: (eo[el] || 0) / (n || 1) * 100,
    caps: caps[el] || 0,
    global: selectedBy[el] != null ? +selectedBy[el] : null,
  })).sort((a, b) => b.eo - a.eo);
  return { n, gw: (leaguePicks || {}).gw, captains, eo: eoList };
}
