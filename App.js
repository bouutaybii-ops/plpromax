// PL PRO MAX 2 — Ligue FPL entre amis (حمار الجولة)
// Expo / React Native, fichier unique. Kolchi kayji mn l'API officielle dyal FPL.
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, RefreshControl, Image,
  ActivityIndicator, StyleSheet, StatusBar, Platform, Modal, AppState, Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fixturesByTeam, liveStats, liveTeam, provisionalBonus } from './live';
import { donkeyDeadline, formatMoroccoDate, splitCountdown } from './donkey';
import { leaguePickStats, leagueStats } from './stats';
import { Heatmap, Legend, LineChart, RankBars, VIZ, divergingColor } from './charts';

/* ============ CONFIG DYAL LA LIGUE (ghir l'admin kaybeddelha) ============ */
const CONFIG = {
  leagueId: 1397179,        // la ligue lwa7ida li khddama f l'app
  staff: {                  // comptes Firebase (UID) li 3ndhom l7e9
    admin: 'ZDBI5RI9m4Q3aSclfSEHlNBJW6j2',      // Brahim: الإدارة + الخلاص
    treasurer: 'X4lWdR4Of1WExkhOsFr7Jabe8oj1',  // Najib: الخلاص
  },
  protectedIds: {            // IDs FPL li kaytlbou mot de passe f login → UID Firebase
    3868881: 'ZDBI5RI9m4Q3aSclfSEHlNBJW6j2',    // Brahim
    2855552: 'X4lWdR4Of1WExkhOsFr7Jabe8oj1',    // Najib
  },
  fee: 200,                 // ثمن الانخراط
  startGw: 1,               // الدوري بدا من هاد الجولة
  participants: [],         // IDs dyal li dakhlin f l'pari. [] = ga3 l'membres dyal la ligue
  cupWinner: '',            // الفائز بالكأس
  firebase: { dbUrl: 'https://pl-pro-max-default-rtdb.europe-west1.firebasedatabase.app', apiKey: 'AIzaSyDsweg7BAUARM_f2KXU0vwHGz0mD2RJtnA' }, // Firebase Realtime Database (l'khlass)
};
/* ======================================================================== */

// F l-web, les navigateurs ma kaykhelliwch nqraw FPL direct: kandouzo b l-proxy dyalna (app/api/fpl).
const API = Platform.OS === 'web' ? '/api/fpl' : 'https://fantasy.premierleague.com/api';
const CHIPS = {
  wildcard: { label: 'Wildcard', short: 'WC', color: '#6b4fd8' },
  freehit: { label: 'Free Hit', short: 'FH', color: '#1f7fbf' },
  bboost: { label: 'Bench Boost', short: 'BB', color: '#c06a12' },
  '3xc': { label: 'Triple Captain', short: 'TC', color: '#b4332b' },
  manager: { label: 'Assistant Manager', short: 'AM', color: '#2f7d5b' },
};
const POS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

// Couleurs inspirées de la Premier League: violet, magenta, cyan, vert fluo
const C = {
  pitch: '#37003c', pitch2: '#5a0b62', pink: '#e90052', cyan: '#04f5ff', neon: '#00ff85',
  bg: '#f4f2f5', card: '#ffffff', ink: '#1d0a20', muted: '#6c5f70',
  line: '#e7e1e9', gold: '#c9a227', silver: '#8b8f99', bronze: '#b06a3b', donkey: '#8a5a2b', donkeyBg: '#f6ece1',
  bad: '#e90052', good: '#00a35c', me: '#f1e6f3',
  grass1: '#1f9d55', grass2: '#22a85c',
};

/* ---------------- data ---------------- */
async function getJson(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function loadLeague() {
  const [boot, league] = await Promise.all([
    getJson('/bootstrap-static/'),
    getJson('/leagues-classic/' + CONFIG.leagueId + '/standings/'),
  ]);
  let entries = league.standings.results;
  if (CONFIG.participants.length) entries = entries.filter(e => CONFIG.participants.includes(e.entry));
  const histories = await Promise.all(entries.map(e => getJson('/entry/' + e.entry + '/history/')));
  // FPL kat3llem l-jawla "finished" ghir mn b3d ta2kid l-bonus (ymken nhar kaml mn b3d). 3andna
  // l-jawla katsali rasmiyan m3a nihayat akhir match dyalha (finished_provisional).
  const finished = boot.events.filter(ev => ev.finished).map(ev => ev.id);
  const current = (boot.events.find(ev => ev.is_current) || {}).id || null;
  const managers = entries.map((e, i) => {
    const h = histories[i];
    const chipBy = {};
    (h.chips || []).forEach(ch => { chipBy[ch.event] = ch.name; });
    const gws = {};
    (h.current || []).forEach(g => {
      const hit = g.event_transfers_cost || 0;
      gws[g.event] = { p: g.points - hit, raw: g.points, h: hit, c: chipBy[g.event] || '', bench: g.points_on_bench || 0, tr: g.event_transfers || 0, v: (g.value || 0) / 10, bank: (g.bank || 0) / 10, or: g.overall_rank };
    });
    return { id: e.entry, name: e.player_name, team: e.entry_name, gws, chips: (h.chips || []).map(ch => ({ name: ch.name, gw: ch.event })) };
  });
  const players = {};
  boot.elements.forEach(el => { players[el.id] = {
    n: el.web_name, t: el.element_type, team: el.team, c: el.code,
    full: `${el.first_name} ${el.second_name}`, price: el.now_cost / 10, total: el.total_points, form: el.form,
    ppg: el.points_per_game, sel: el.selected_by_percent, g: el.goals_scored, a: el.assists, cs: el.clean_sheets,
    min: el.minutes, bonus: el.bonus, xg: el.expected_goals, xa: el.expected_assists, news: el.news,
    ev: el.event_points, tin: el.transfers_in_event, tout: el.transfers_out_event, cc: el.cost_change_event / 10,
    ccs: el.cost_change_start / 10, ict: +el.ict_index, xgi: +el.expected_goal_involvements, bps: el.bps,
    dc: el.defensive_contribution, sv: el.saves, gc: el.goals_conceded, ep: +el.ep_next, st: el.status, chance: el.chance_of_playing_next_round,
  }; });
  const teams = {};
  const teamInfo = {};
  boot.teams.forEach(t => { teams[t.id] = t.short_name; teamInfo[t.id] = { n: t.name, s: t.short_name, code: t.code }; });

  // L-fari9 dyal kol wa7ed f l-jawla l-7aliya (wla akhir jawla salat): bach n3erfo 3and chkoun
  // kayn kol joueur f l-ligue (ownership, captain…).
  const live = current && !finished.includes(current);
  const pickGw = live ? current : finished[finished.length - 1];
  const allPicks = pickGw ? await Promise.all(managers.map(m => getJson(`/entry/${m.id}/event/${pickGw}/picks/`).catch(() => null))) : [];
  const leaguePicks = { gw: pickGw, by: {} };
  managers.forEach((m, i) => { if (allPicks[i]) leaguePicks.by[m.id] = { picks: allPicks[i].picks, chip: allPicks[i].active_chip }; });

  // Jawla mazal kat-tl3eb: l-history dyal FPL ma kaytbeddelch live, donc kan7esbo l-points
  // dyal kol wa7ed mn l'équipe dyalo + les stats live + bonus provisoire + auto-subs.
  let gwDone = false;
  if (live) {
    try {
      const ctx = await loadGwContext(current, players);
      gwDone = ctx.fixtures.length > 0 && ctx.fixtures.every(f => f.finished || f.finished_provisional);
      managers.forEach((m, i) => {
        const pk = allPicks[i];
        if (!pk) return;
        const t = liveTeam({ picks: pk.picks, chip: pk.active_chip, players, live: ctx.live, byTeam: ctx.byTeam, bonus: ctx.bonus });
        const hit = (pk.entry_history || {}).event_transfers_cost || 0;
        // B7al fplgameweek: chkoun l-captain (wla l-vice ila khda l-capitanat), ch7al kayl3bou daba,
        // w ch7al mazal ma bdaw (ghir li kaythesbou f l-équipe).
        const counting = t.rows.filter(r => r.eff > 0 || r.subIn);
        const capRow = t.rows.find(r => r.eff >= 2) || t.rows.find(r => r.is_captain);
        const inPlay = counting.filter(r => r.started && !r.done).length;
        const toStart = counting.filter(r => !r.started).length;
        m.gws[current] = { ...(m.gws[current] || {}), cap: capRow ? capRow.element : null, capVice: !!(capRow && !capRow.is_captain), inPlay, toStart, p: t.total - hit, raw: t.total, h: hit, c: pk.active_chip || '', bench: t.benchPts, tr: (pk.entry_history || {}).event_transfers || 0, live: !gwDone, left: t.left, prov: gwDone ? 0 : t.provisional };
      });
    } catch {}
  }
  const events = {};
  boot.events.forEach(ev => { events[ev.id] = { avg: ev.average_entry_score, high: ev.highest_score }; });
  const phases = (boot.phases || []).filter(ph => ph.id > 1).map(ph => ({ id: ph.id, name: ph.name, from: ph.start_event, to: ph.stop_event }));
  const nextEv = boot.events.find(ev => ev.is_next);
  return {
    leagueName: league.league.name, managers, finished: gwDone ? [...finished, current] : finished, current, players, teams, teamInfo,
    leaguePicks, events, phases, fetchedAt: new Date().toISOString(),
    // Mazal FPL ma kemmlat l-jawla (bonus ma t2kedch): kan3awdo njibo b chwiya.
    pending: !!live, nextDeadline: nextEv ? Date.parse(nextEv.deadline_time) : null,
  };
}

// Stats live dyal journée: points dyal kol joueur, les matchs, w l-bonus provisoire (mn l-BPS).
async function loadGwContext(gw, players) {
  const [live, fixtures] = await Promise.all([getJson(`/event/${gw}/live/`), getJson(`/fixtures/?event=${gw}`)]);
  const explain = {};
  for (const el of live.elements || []) explain[el.id] = { parts: el.explain || [], bps: el.stats.bps, xg: el.stats.expected_goals, xa: el.stats.expected_assists };
  return { live: liveStats(live), byTeam: fixturesByTeam(fixtures), bonus: provisionalBonus(fixtures), explain, fixtures };
}

async function loadPicks(entryId, gw, players) {
  const [picks, ctx] = await Promise.all([getJson(`/entry/${entryId}/event/${gw}/picks/`), loadGwContext(gw, players)]);
  const t = liveTeam({ picks: picks.picks, chip: picks.active_chip, players, live: ctx.live, byTeam: ctx.byTeam, bonus: ctx.bonus });
  return { picks: t.rows, chip: picks.active_chip, hist: picks.entry_history || {}, total: t.total, left: t.left, prov: t.provisional, explain: ctx.explain, byTeam: ctx.byTeam, gw };
}

/* ---------------- rules ---------------- */
// Kol 3 jornadas حمار متتابعين = 70. Lba9i: kol 3 = 50, w kol wa7da b9at = 10.
function penalty(list) {
  const g = [...list].sort((a, b) => a - b);
  let i = 0; const groups = [], rest = [];
  while (i < g.length) {
    if (i + 2 < g.length && g[i + 1] === g[i] + 1 && g[i + 2] === g[i] + 2) {
      groups.push({ gws: [g[i], g[i + 1], g[i + 2]], amount: 70, kind: 'streak' }); i += 3;
    } else { rest.push(g[i]); i++; }
  }
  for (let k = 0; k + 3 <= rest.length; k += 3) groups.push({ gws: rest.slice(k, k + 3), amount: 50, kind: 'triple' });
  rest.slice(rest.length - (rest.length % 3)).forEach(x => groups.push({ gws: [x], amount: 10, kind: 'single' }));
  groups.sort((a, b) => a.gws[0] - b.gws[0]);
  const streaks = groups.filter(x => x.kind === 'streak').length, triples = groups.filter(x => x.kind === 'triple').length;
  return { amount: groups.reduce((t, x) => t + x.amount, 0), streaks, triples, singles: groups.length - streaks - triples, groups };
}

// حمار الجولة: أقل نقاط فالجولة. إلا تعادلو: اللي عندو أقل مجموع حتى لهاد الجولة.
// إلا بقاو متعادلين: اللي تحت فترتيب FPL ديال الدوري. ديما واحد فقط.
function cumTo(m, gw) {
  let t = 0;
  for (let g = CONFIG.startGw; g <= gw; g++) if (m.gws[g]) t += m.gws[g].p;
  return t;
}
function pickDonkey(ms, gw) {
  const min = Math.min(...ms.map(m => m.gws[gw].p));
  const tied = ms.map((m, i) => ({ m, i })).filter(x => x.m.gws[gw].p === min);
  tied.sort((a, b) => cumTo(a.m, gw) - cumTo(b.m, gw) || b.i - a.i);
  return { min, id: tied[0].m.id, tie: tied.length > 1 };
}

function compute(data) {
  if (!data) return null;
  const ms = data.managers;
  const inSeason = g => g >= CONFIG.startGw;
  const gws = data.finished.filter(g => inSeason(g) && ms.every(m => m.gws[g]));
  const per = {};
  ms.forEach(m => {
    const list = Object.entries(m.gws).filter(([g]) => inSeason(+g)).map(([g, s]) => ({ gw: +g, ...s }));
    per[m.id] = {
      m, list, total: list.reduce((a, x) => a + x.p, 0), hits: list.reduce((a, x) => a + x.h, 0),
      bench: list.reduce((a, x) => a + x.bench, 0), last: null, donkeys: [], wins: [],
    };
  });
  const liveGw = data.current && !data.finished.includes(data.current) ? data.current : null;
  const showGw = liveGw || gws[gws.length - 1] || null;
  if (showGw) ms.forEach(m => { per[m.id].last = m.gws[showGw] ? m.gws[showGw].p : null; });

  const byGw = gws.map(g => {
    const vals = ms.map(m => m.gws[g].p);
    const max = Math.max(...vals);
    const d = pickDonkey(ms, g);
    const min = d.min, ids = [d.id];
    const top = ms.filter(m => m.gws[g].p === max).map(m => m.id);
    ids.forEach(id => per[id].donkeys.push(g));
    top.forEach(id => per[id].wins.push(g));
    return { gw: g, min, ids, max, top, tie: d.tie };
  });

  let record = null, best = null, worst = null;
  gws.forEach(g => ms.forEach(m => {
    const s = m.gws[g];
    if (!best || s.p > best.p) best = { p: s.p, gw: g, id: m.id, c: s.c };
    if (!worst || s.p < worst.p) worst = { p: s.p, gw: g, id: m.id };
    if (s.c) return;
    if (!record || s.p > record.p) record = { p: s.p, gw: g, ids: [m.id] };
    else if (s.p === record.p && !record.ids.includes(m.id)) record.ids.push(m.id);
  }));

  ms.forEach(m => { per[m.id].pen = penalty(per[m.id].donkeys); });
  const table = ms.map(m => per[m.id]).sort((a, b) => b.total - a.total);
  table.forEach((r, i) => { r.rank = i + 1; });
  const fund = table.reduce((s, r) => s + r.pen.amount, 0);
  const clean = table.filter(r => r.donkeys.length === 0);
  const pool = ms.length * CONFIG.fee;
  const liveDonkey = liveGw && ms.every(m => m.gws[liveGw]) ? (() => {
    const d = pickDonkey(ms, liveGw);
    return { gw: liveGw, min: d.min, ids: [d.id] };
  })() : null;
  return { gws, showGw, liveGw, per, byGw, record, best, worst, table, fund, clean, pool, liveDonkey };
}

const fmt = n => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
// Ra9m kbir (ترتيب الجولة f l3alam): 1.43M, 245k.
const fmtShort = n => (n >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : fmt(n));

/* ---------------- UI bits ---------------- */
// Page b bzaf dyal les cartes: l-3onwan dyal kol carte (w s-ster dyal l-colonnes) kayb9a lase9
// lfo9 mli kanscrolliw f had l-carte, 7tta tji l-carte li moraha.
function Sections({ sections, refreshControl, footer }) {
  const web = Platform.OS === 'web';
  const children = [];
  const sticky = [];
  sections.filter(Boolean).forEach((sec, i) => {
    const hasHead = !!(sec.title || sec.head);
    const head = hasHead ? (
      <View key={'h' + i} style={[s.secHead, web && s.secHeadWeb]}>
        {sec.title ? (
          <View style={s.cardH}>
            <Text style={s.h2}>{sec.title}</Text>
            {sec.sub ? <Text style={s.muted}>{sec.sub}</Text> : null}
          </View>
        ) : null}
        {sec.head || null}
      </View>
    ) : null;
    const body = <View key={'b' + i} style={sec.bare ? { marginBottom: 14 } : [s.secBody, !hasHead && s.secAlone]}>{sec.body}</View>;
    if (web) {
      // Web: "position: sticky" kayb9a lase9 ghir west l-bloc dyalo, donc mli kaysali l-jadwal
      // kaykhrej m3ah l-3onwan dyalo (stickyHeaderIndices ma kaydfe3ch l-9dim f l-web).
      children.push(<View key={'s' + i}>{head}{body}</View>);
    } else {
      if (head) { sticky.push(children.length); children.push(head); }
      children.push(body);
    }
  });
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 14, paddingBottom: 40 }} stickyHeaderIndices={web ? undefined : sticky} refreshControl={refreshControl}>
      {children}
      {footer || null}
    </ScrollView>
  );
}

function Card({ title, sub, children }) {
  return (
    <View style={s.card}>
      {title ? (
        <View style={s.cardH}>
          <Text style={s.h2}>{title}</Text>
          {sub ? <Text style={s.muted}>{sub}</Text> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}
function Row({ left, right, strong, color, onPress }) {
  const Body = (
    <View style={[s.row, strong && { backgroundColor: C.bg }]}>
      <Text style={[s.txt, strong && s.bold, { flex: 1 }]}>{left}</Text>
      <Text style={[s.num, strong && s.bold, color && { color }]}>{right}</Text>
    </View>
  );
  return onPress ? <TouchableOpacity onPress={onPress}>{Body}</TouchableOpacity> : Body;
}
function Pill({ text, color, kind }) {
  const bg = color || (kind === 'bad' ? C.bad : kind === 'd' ? C.donkeyBg : C.line);
  const fg = color || kind === 'bad' ? '#fff' : kind === 'd' ? C.donkey : C.muted;
  return <View style={[s.pill, { backgroundColor: bg }]}><Text style={[s.pillT, { color: fg }]}>{text}</Text></View>;
}
function Stat({ n, l }) {
  return <View style={s.stat}><Text style={s.statN}>{n}</Text><Text style={[s.small, { color: '#d9c7dc' }]}>{l}</Text></View>;
}

/* ---------------- login ---------------- */
function authMsg(e) {
  const m = String((e && e.message) || e);
  if (m === 'uid') return 'هاد الحساب ماشي ديال هاد اللاعب (UID مختلف).';
  if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(m)) return 'الإيميل ولا كلمة السر غالطين. (' + m + ')';
  if (/OPERATION_NOT_ALLOWED|PASSWORD_LOGIN_DISABLED/.test(m)) return 'Email/Password ماشي مفعل فـ Firebase Authentication. (' + m + ')';
  if (/API_KEY|referer|blocked/i.test(m)) return 'مشكل فـ Clé API (فيها قيود). (' + m + ')';
  if (/TOO_MANY/.test(m)) return 'بزاف ديال المحاولات، تسنى شوية. (' + m + ')';
  if (/USER_DISABLED/.test(m)) return 'هاد الحساب موقوف. (' + m + ')';
  return 'خطأ: ' + m;
}

function Login({ data, onLogin, loading, error }) {
  const [id, setId] = useState('');
  const [msg, setMsg] = useState(null);
  const [lock, setLock] = useState(null);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const unlock = async () => {
    setMsg(null); setBusy(true);
    try {
      const x = await fb.signIn(email.trim(), pw);
      if (x.uid !== CONFIG.protectedIds[lock]) throw new Error('uid');
      onLogin(lock, x);
    } catch (e) { setMsg(authMsg(e)); }
    setBusy(false);
  };
  const go = () => {
    const n = parseInt(id, 10);
    if (!n) { setMsg('دخل ID ديالك (أرقام فقط).'); return; }
    if (!data) { setMsg('مازال كنجيب المعطيات، عاود بعد شوية.'); return; }
    const m = data.managers.find(x => x.id === n);
    if (!m) { setMsg('هاد ID ماشي فهاد الدوري.'); return; }
    if (CONFIG.protectedIds[n]) { setLock(n); setMsg(null); return; }
    onLogin(n);
  };
  if (lock) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={[s.h1, { color: C.pitch }]}>🔒 حساب محمي</Text>
        <Text style={s.txt}>هاد الحساب خاصو كلمة السر.</Text>
        <Card>
          <View style={{ padding: 14, gap: 10 }}>
            <TextInput style={[s.input, { fontSize: 15 }]} value={email} onChangeText={setEmail} placeholder="الإيميل" autoCapitalize="none" keyboardType="email-address" />
            <TextInput style={[s.input, { fontSize: 15 }]} value={pw} onChangeText={setPw} placeholder="كلمة السر" secureTextEntry />
            <TouchableOpacity style={s.btn} onPress={unlock} disabled={busy}><Text style={s.btnT}>{busy ? '…' : 'دخول'}</Text></TouchableOpacity>
            {msg ? <Text style={{ color: C.bad, textAlign: 'right' }}>{msg}</Text> : null}
          </View>
        </Card>
        <TouchableOpacity onPress={() => { setLock(null); setPw(''); setMsg(null); }}><Text style={[s.small, { textAlign: 'center', color: C.pitch2 }]}>رجوع</Text></TouchableOpacity>
      </ScrollView>
    );
  }
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={[s.h1, { color: C.pitch }]}>{data ? data.leagueName : 'PL PRO MAX 2'}</Text>
      <Text style={s.txt}>دخل ID ديال الفريق ديالك فـ FPL باش تدخل للدوري.</Text>
      <Card>
        <View style={{ padding: 14, gap: 10 }}>
          <TextInput style={s.input} value={id} onChangeText={setId} keyboardType="number-pad" placeholder="ID ديالك" />
          <TouchableOpacity style={s.btn} onPress={go}><Text style={s.btnT}>دخول</Text></TouchableOpacity>
          {msg ? <Text style={{ color: C.bad, textAlign: 'right' }}>{msg}</Text> : null}
          {loading ? <ActivityIndicator color={C.pitch} /> : null}
          {error ? <Text style={{ color: C.bad, textAlign: 'right' }}>{error}</Text> : null}
        </View>
      </Card>
      <Text style={s.note}>فين نلقى ID ديالي؟ دخل لموقع FPL ← Points. الرقم اللي فالرابط من بعد /entry/ هو ID ديالك.</Text>
    </ScrollView>
  );
}

/* ---------------- screens ---------------- */
function Classement({ c, data, meId, open, refreshControl }) {
  const shares = [0.5, 0.3, 0.2];
  const medal = [C.gold, C.silver, C.bronze];
  const allGws = [...new Set(c.table.flatMap(r => r.list.map(x => x.gw)))].sort((a, b) => a - b);
  const [mode, setMode] = useState('total');
  const [gw, setGw] = useState(c.showGw || allGws[allGws.length - 1]);

  const Toggle = (
    <View style={s.seg}>
      {[['total', 'الترتيب العام'], ['gw', 'ترتيب الجولة']].map(([k, l]) => (
        <TouchableOpacity key={k} onPress={() => setMode(k)} style={[s.segBtn, mode === k && s.segOn]}>
          <Text style={[s.segT, mode === k && { color: '#fff' }]}>{l}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (mode === 'gw') {
    return (
      <View style={s.fixedPage}>
        {Toggle}
        <View style={[s.card, s.fixedCard]}>
          <GwNav list={allGws} gw={gw} setGw={setGw} />
          <GwGrid key={gw} c={c} data={data} gw={gw} meId={meId} open={open} refreshControl={refreshControl} />
        </View>
      </View>
    );
  }

  return (
    <View style={s.fixedPage}>
      {Toggle}
      <View style={[s.card, s.fixedCard]}>
        <View style={s.cardH}>
          <Text style={s.h2}>الترتيب العام</Text>
          <Text style={s.muted}>{c.liveGw ? `GW${c.liveGw} مازال كتلعب` : 'بعد خصم التبديلات'}</Text>
        </View>
        <View style={[s.tr, s.thRow]}>
          <Text style={[s.th, { width: 30 }]}>#</Text>
          <Text style={[s.th, { flex: 1 }]}>اللاعب</Text>
          <Text style={[s.th, s.colN]}>{c.showGw ? 'GW' + c.showGw : ''}</Text>
          <Text style={[s.th, s.colN]}>المجموع</Text>
        </View>
        <ScrollView style={{ flex: 1 }} refreshControl={refreshControl}>
        {c.table.map((r, i) => (
          <TouchableOpacity key={r.m.id} onPress={() => open(r.m.id)} style={[s.tr, r.m.id === meId && { backgroundColor: C.me }]}>
            <View style={[s.rk, i < 3 && { backgroundColor: medal[i] }]}>
              <Text style={[s.rkT, i < 3 && { color: '#fff' }]}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1, paddingHorizontal: 8 }}>
              <Text style={[s.txt, s.bold]} numberOfLines={1}>{r.m.name}{r.donkeys.length ? '  🐴×' + r.donkeys.length : ''}</Text>
              <Text style={s.small} numberOfLines={1}>{r.m.team}{i < 3 ? `  ·  ${fmt(c.pool * shares[i])} DH` : ''}</Text>
            </View>
            <Text style={[s.num, s.colN]}>{r.last ?? '–'}</Text>
            <Text style={[s.num, s.colN, s.bold]}>{r.total}</Text>
          </TouchableOpacity>
        ))}
        </ScrollView>
      </View>
    </View>
  );
}

// Jadwal dyal l-jawla b7al AG Grid: kliki 3la smiyat l-3amoud bach trattab (▼/▲).
// L-3amoud dyal smiya tabet 3la l-imin, l-b9iya kayt-scrollaw l-jnab.
const GRID_ROW = 46;
function GwGrid({ c, data, gw, meId, open, refreshControl }) {
  const live = gw === c.liveGw;
  const phase = (data.phases || []).find(ph => gw >= ph.from && gw <= ph.to);
  const lp = data.leaguePicks && data.leaguePicks.gw === gw ? data.leaguePicks.by || {} : {};
  const pname = el => (data.players[el] || {}).n || '';
  const finishedD = c.byGw.find(b => b.gw === gw);
  const donkeyId = finishedD ? finishedD.ids[0] : (live && c.liveDonkey ? c.liveDonkey.ids[0] : null);

  const rows = c.table.map(r => {
    const g = r.m.gws[gw];
    if (!g) return null;
    const sum = (from, to) => Object.entries(r.m.gws).filter(([k]) => +k >= from && +k <= to).reduce((a, [, x]) => a + (x.p || 0), 0);
    const pk = (lp[r.m.id] || {}).picks || [];
    const capEl = g.cap || (pk.find(x => x.is_captain) || {}).element || null;
    return {
      id: r.m.id, name: r.m.name, team: r.m.team, g,
      pts: g.p, total: sum(1, gw), month: phase ? sum(phase.from, gw) : null,
      inPlay: g.inPlay || 0, toStart: g.toStart || 0, prov: g.prov || 0,
      cap: capEl ? pname(capEl) : '', capVice: !!g.capVice, chip: g.c || '',
      h: g.h || 0, tr: g.tr || 0, bench: g.c === 'bboost' ? 0 : g.bench || 0, or: g.or || null,
    };
  }).filter(Boolean);
  const max = rows.length ? Math.max(...rows.map(x => x.pts)) : null;

  const cols = [
    { k: 'pts', t: 'الجولة', w: 54, bold: true, sub: x => (x.h ? `−${x.h}` : null) },
    { k: 'total', t: 'المجموع', w: 60 },
    phase && { k: 'month', t: 'الشهر', w: 54 },
    live && { k: 'inPlay', t: '▶ كيلعبو', w: 62, color: '#0a7a45', zero: '·' },
    live && { k: 'toStart', t: '⏳ مازال', w: 58, color: '#9a5b00', zero: '·' },
    live && { k: 'prov', t: '★ بونيس', w: 58, color: '#c99a00', fmt: v => '+' + v, zero: '·' },
    { k: 'cap', t: 'الكابتن', w: 98, str: true },
    { k: 'chip', t: 'Chip', w: 52, str: true },
    { k: 'h', t: 'Hits', w: 48, color: C.bad, fmt: v => '−' + v, zero: '·' },
    { k: 'tr', t: 'تبديلات', w: 58, zero: '·' },
    { k: 'bench', t: 'الدكة', w: 50, zero: '·' },
    { k: 'or', t: 'الترتيب العالمي', w: 92, asc: true, fmt: fmtShort },
  ].filter(Boolean);

  const [sort, setSort] = useState({ k: 'pts', dir: -1 });
  const col = cols.find(x => x.k === sort.k) || cols[0];
  const val = x => x[col.k];
  const cmp = (a, b) => {
    const va = val(a), vb = val(b);
    if (col.str) return sort.dir * String(va || '￿').localeCompare(String(vb || '￿'));
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return sort.dir * (va - vb);
  };
  const sorted = [...rows].sort((a, b) => cmp(a, b) || b.pts - a.pts || b.total - a.total);
  // Tartib "compétition" 3la l-3amoud l-mkhtar (l-mtsawyin kayakhdo nafs r-ra9m).
  const pos = sorted.map((x, i) => (i && !cmp(sorted[i - 1], x) ? null : i + 1));
  for (let i = 1; i < pos.length; i++) if (pos[i] == null) pos[i] = pos[i - 1];
  const press = k => setSort(st => (st.k === k ? { k, dir: -st.dir } : { k, dir: cols.find(x => x.k === k).asc || cols.find(x => x.k === k).str ? 1 : -1 }));

  const head = useRef(null);
  const body = useRef(null);
  const width = cols.reduce((a, x) => a + x.w, 0);
  const toEnd = () => { head.current && head.current.scrollToEnd({ animated: false }); body.current && body.current.scrollToEnd({ animated: false }); };

  const cell = (x, cl) => {
    const v = x[cl.k];
    if (cl.k === 'cap') {
      return v ? (
        <View style={[s.capTag, { maxWidth: cl.w - 8 }]}>
          <Text style={[s.capTagC, x.capVice && { backgroundColor: C.muted }]}>{x.capVice ? 'V' : 'C'}</Text>
          <Text style={s.capTagT} numberOfLines={1}>{v}</Text>
        </View>
      ) : <Text style={s.gridDim}>–</Text>;
    }
    if (cl.k === 'chip') return v ? <Pill text={CHIPS[v]?.short || v} color={CHIPS[v]?.color} /> : <Text style={s.gridDim}>–</Text>;
    if (v == null) return <Text style={s.gridDim}>–</Text>;
    if (!v && cl.zero) return <Text style={s.gridDim}>{cl.zero}</Text>;
    const sub = cl.sub && cl.sub(x);
    return (
      <>
        <Text style={[s.gridNum, cl.bold && { fontWeight: '900', fontSize: 15 }, cl.color && { color: cl.color }]}>{cl.fmt ? cl.fmt(v) : v}</Text>
        {sub ? <Text style={{ fontSize: 10, color: C.bad, fontWeight: '700' }}>{sub}</Text> : null}
      </>
    );
  };

  const hcell = cl => {
    const on = sort.k === cl.k;
    return (
      <TouchableOpacity key={cl.k} onPress={() => press(cl.k)} style={[s.gridH, { width: cl.w }, on && s.gridHOn]}>
        <Text style={[s.gridHT, on && { color: C.pitch }]} numberOfLines={2}>{cl.t}</Text>
        <Text style={[s.gridArrow, on && { color: C.pink }]}>{on ? (sort.dir < 0 ? '▼' : '▲') : '⇅'}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {live ? <Text style={[s.small, { textAlign: 'center', paddingTop: 8, color: C.pink }]}>الجولة مازال كتلعب · النقاط live</Text> : null}
      <Text style={[s.small, { textAlign: 'center', paddingTop: 4 }]}>كليكي على العمود باش ترتب · سكرولي ↔ باش تشوف كولشي</Text>
      <View style={[s.gridRow, s.gridHeadRow]}>
        <View style={[s.gridName, s.gridH, { height: 44 }]}><Text style={s.gridHT}># · اللاعب</Text></View>
        <ScrollView ref={head} horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} style={{ flex: 1, direction: 'ltr' }}>
          <View style={{ flexDirection: 'row-reverse', width }}>{cols.map(hcell)}</View>
        </ScrollView>
      </View>
      <ScrollView style={{ flex: 1 }} refreshControl={refreshControl}>
        <View style={s.gridRow}>
          <View style={s.gridName}>
            {sorted.map((x, i) => (
              <TouchableOpacity key={x.id} onPress={() => open(x.id)} style={[s.gridNameCell, i % 2 && s.gridAlt, x.id === meId && { backgroundColor: C.me }]}>
                <View style={[s.rk, { width: 24, height: 24 }, x.pts === max && { backgroundColor: C.gold }, x.id === donkeyId && { backgroundColor: C.donkey }]}>
                  <Text style={[s.rkT, (x.pts === max || x.id === donkeyId) && { color: '#fff' }]}>{pos[i]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.txt, s.bold, { fontSize: 13, writingDirection: 'ltr', textAlign: 'right' }]} numberOfLines={1}>{x.name}{x.pts === max ? ' ⭐' : ''}{x.id === donkeyId ? (live ? ' ⏳🐴' : ' 🐴') : ''}</Text>
                  <Text style={[s.small, { fontSize: 10 }]} numberOfLines={1}>{x.team}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
          <ScrollView ref={body} horizontal style={{ flex: 1, direction: 'ltr' }} onContentSizeChange={toEnd} onLayout={toEnd}
            scrollEventThrottle={16} onScroll={e => head.current && head.current.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false })}>
            <View style={{ width }}>
              {sorted.map((x, i) => (
                <TouchableOpacity key={x.id} activeOpacity={0.7} onPress={() => open(x.id)} style={[s.gridCells, i % 2 && s.gridAlt, x.id === meId && { backgroundColor: C.me }]}>
                  {cols.map(cl => (
                    <View key={cl.k} style={[s.gridCell, { width: cl.w }, sort.k === cl.k && s.gridCellOn]}>{cell(x, cl)}</View>
                  ))}
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

// Kronometre: ch7al ba9i l 7mar l-jawla. L-mouda dyalo katsali m3a 00:00 dyal l-lil li mn b3d
// akhir match f l-jawla li jaya (b twa9it l-Maghrib).
function DonkeyTimer({ nextGw, onOver }) {
  const [deadline, setDeadline] = useState(undefined);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let alive = true;
    setDeadline(undefined);
    getJson(`/fixtures/?event=${nextGw}`).then(f => alive && setDeadline(donkeyDeadline(f))).catch(() => alive && setDeadline(null));
    return () => { alive = false; };
  }, [nextGw]);
  const over = deadline != null && now >= deadline;
  useEffect(() => { if (over && onOver) onOver(nextGw); }, [over, nextGw]);
  useEffect(() => {
    if (deadline == null || over) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline, over]);
  if (deadline === undefined) return <ActivityIndicator color={C.donkey} />;
  if (deadline === null) return null;
  if (over) return <View style={s.timerPill}><Text style={s.timerPillT}>✓</Text></View>;
  const { d, h, m, s: sec } = splitCountdown(deadline - now);
  const pad = n => String(n).padStart(2, '0');
  return (
    <View style={s.timerPill} accessibilityLabel={`باقي ${d} يوم ${h} ساعة ${m} دقيقة · كيسالي ${formatMoroccoDate(deadline)}`}>
      <Text style={s.timerPillL}>⏱</Text>
      <Text style={s.timerPillT}>{d ? `${d}ي ` : ''}{pad(h)}:{pad(m)}:{pad(sec)}</Text>
    </View>
  );
}

// Safhat l-matchat: kol jawla, l-matchat mrattbin b n-nhar, w ila kliki 3la match kayban kolchi:
// l-ahdaf, l-passes, l-kartonat, t-tasdiyat, l-bonus (rasmi wla 7asab l-BPS) w top BPS.
const BADGE = code => `https://resources.premierleague.com/premierleague/badges/70/t${code}.png`;
const FX_STATS = [
  ['goals_scored', '⚽', 'أهداف'], ['assists', '🅰️', 'تمريرات حاسمة'], ['own_goals', '🔴', 'ضد المرمى'],
  ['penalties_saved', '🧤', 'بنالتي تصدى ليه'], ['penalties_missed', '❌', 'بنالتي ضيعو'],
  ['yellow_cards', '🟨', 'إنذارات'], ['red_cards', '🟥', 'طرد'], ['saves', '🧤', 'تصديات'],
];
function TeamBadge({ info }) {
  const [bad, setBad] = useState(false);
  if (!info || !info.code || bad) return <View style={[s.fxBadge, s.fxBadgeAlt]}><Text style={s.fxBadgeT}>{info ? info.s : '?'}</Text></View>;
  return <Image source={{ uri: BADGE(info.code) }} style={s.fxBadge} resizeMode="contain" onError={() => setBad(true)} accessibilityLabel={info.n} />;
}
// Soura sghira dyal joueur (b7al FPL) m3a C/V w l-bank b chfafiya.
function MiniFace({ el, pick, data, pts }) {
  const pl = data.players[el] || {};
  const [i, setI] = useState(0);
  const urls = pl.c ? photoUrls(pl.c) : [];
  const bench = pick.position > 11;
  const badge = pick.is_captain ? (pick.multiplier === 3 ? 'TC' : 'C') : pick.is_vice_captain ? 'V' : null;
  return (
    <View style={[s.mini, bench && { opacity: 0.45 }]}>
      <View style={s.miniPhotoWrap}>
        {i < urls.length
          ? <Image source={{ uri: urls[i] }} style={s.miniPhoto} resizeMode="cover" onError={() => setI(i + 1)} />
          : <Text style={s.miniInit}>{(pl.n || '?').slice(0, 2)}</Text>}
        {badge ? <View style={s.miniBadge}><Text style={s.miniBadgeT}>{badge}</Text></View> : null}
      </View>
      <Text style={s.miniName} numberOfLines={1}>{pl.n || '?'}</Text>
      {pts != null ? <View style={[s.miniPts, pts >= 6 && { backgroundColor: C.good }, pts <= 1 && { backgroundColor: C.muted }]}><Text style={s.miniPtsT}>{pts}</Text></View> : null}
    </View>
  );
}

// L-joueurs dyali f jawla mo3ayana: l-jawlat li fatou mn picks dyalha; l-jawla l-jaya = picks
// dyal l-jawla l-7aliya + les transferts li dert liha.
async function myPicksFor(meId, gw, current) {
  const base = Math.min(gw, current || gw);
  const pk = await getJson(`/entry/${meId}/event/${base}/picks/`);
  let picks = pk.picks.map(x => ({ ...x }));
  if (gw > base) {
    const tr = await getJson(`/entry/${meId}/transfers/`).catch(() => []);
    tr.filter(t => t.event > base && t.event <= gw).sort((a, b) => Date.parse(a.time) - Date.parse(b.time)).forEach(t => {
      const p = picks.find(x => x.element === t.element_out);
      if (p) p.element = t.element_in;
    });
  }
  return Object.fromEntries(picks.map(x => [x.element, x]));
}

function Matches({ data, meId, refreshControl }) {
  const list = Array.from({ length: 38 }, (_, i) => i + 1);
  const [gw, setGw] = useState(data.current || 1);
  const [mine, setMine] = useState({});
  const [live, setLive] = useState(null);
  useEffect(() => { setLive(null); }, [gw]);
  // N-n9at dyal kol joueur f kol match (mn explain dyal /event/{gw}/live/) + bonus mo2a99at ila mazal.
  const fxPts = useMemo(() => {
    const out = {};
    for (const el of (live && live.elements) || []) {
      for (const ex of el.explain || []) {
        (out[ex.fixture] = out[ex.fixture] || {})[el.id] = ex.stats.reduce((t, st) => t + (st.points || 0), 0);
      }
    }
    return out;
  }, [live]);
  useEffect(() => {
    let alive = true;
    setMine({});
    if (meId) myPicksFor(meId, gw, data.current).then(m => alive && setMine(m)).catch(() => {});
    return () => { alive = false; };
  }, [gw, meId, data.current]);
  const myTeam = teamId => Object.values(mine).filter(x => (data.players[x.element] || {}).team === teamId).sort((a, b) => a.position - b.position);
  const [fx, setFx] = useState(null);
  const [err, setErr] = useState(false);
  const [openId, setOpenId] = useState(null);
  useEffect(() => {
    let alive = true;
    setErr(false);
    getJson(`/fixtures/?event=${gw}`).then(f => alive && setFx(f)).catch(() => alive && setErr(true));
    if (gw <= (data.current || 0)) getJson(`/event/${gw}/live/`).then(l => alive && setLive(l)).catch(() => {});
    return () => { alive = false; };
  }, [gw, data.fetchedAt]);
  useEffect(() => { setFx(null); setOpenId(null); }, [gw]);
  // Wast l-match: kan-tjeddou kol d9i9a 7tta f had s-safha.
  const anyLive = (fx || []).some(f => f.started && !f.finished && !f.finished_provisional);
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(() => {
      getJson(`/fixtures/?event=${gw}`).then(setFx).catch(() => {});
      getJson(`/event/${gw}/live/`).then(setLive).catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, [anyLive, gw]);

  const info = id => (data.teamInfo || {})[id] || { s: (data.teams || {})[id] || '?', n: (data.teams || {})[id] || '?' };
  const pn = el => (data.players[el] || {}).n || '#' + el;
  const lp = data.leaguePicks && data.leaguePicks.gw === gw ? Object.values(data.leaguePicks.by || {}) : [];
  const own = {};
  lp.forEach(t => (t.picks || []).forEach(pk => { if (pk.multiplier > 0) own[pk.element] = (own[pk.element] || 0) + 1; }));
  const Own = ({ el }) => (own[el] ? <Text style={s.fxOwn}>👥{own[el]}</Text> : null);

  const days = [];
  [...(fx || [])].sort((a, b) => Date.parse(a.kickoff_time || 0) - Date.parse(b.kickoff_time || 0) || a.id - b.id).forEach(f => {
    const key = f.kickoff_time ? formatMoroccoDate(Date.parse(f.kickoff_time)).split(' · ')[0] : 'التوقيت مازال ما تحددش';
    const d = days[days.length - 1];
    if (d && d.key === key) d.fx.push(f); else days.push({ key, fx: [f] });
  });

  const detail = f => {
    const st = id => (f.stats || []).find(x => x.identifier === id) || { h: [], a: [] };
    const confirmed = st('bonus');
    const isConf = confirmed.h.length + confirmed.a.length > 0;
    const bonus = isConf
      ? [...confirmed.h, ...confirmed.a].map(r => ({ el: r.element, v: r.value }))
      : Object.entries(provisionalBonus([f])).map(([el, v]) => ({ el: +el, v }));
    bonus.sort((a, b) => b.v - a.v);
    const bps = [...st('bps').h.map(r => ({ ...r, side: 'h' })), ...st('bps').a.map(r => ({ ...r, side: 'a' }))].sort((a, b) => b.value - a.value).slice(0, 6);
    const side = rows => rows.map(r => (
      <View key={r.element} style={[s.fxEvRow, mine[r.element] && s.fxMine]}>
        <Text style={[s.fxEvName, mine[r.element] && s.fxMineT]} numberOfLines={1}>{pn(r.element)}{r.value > 1 ? ` ×${r.value}` : ''}</Text>
        <Own el={r.element} />
      </View>
    ));
    const events = FX_STATS.map(([id, icon, label]) => {
      const x = st(id);
      if (!x.h.length && !x.a.length) return null;
      return (
        <View key={id} style={s.fxEv}>
          <Text style={s.fxEvLabel}>{icon} {label}</Text>
          <View style={s.fxEvCols}>
            <View style={{ flex: 1 }}>{side(x.h)}</View>
            <View style={s.fxEvSep} />
            <View style={{ flex: 1 }}>{side(x.a)}</View>
          </View>
        </View>
      );
    });
    return (
      <View style={s.fxDetail}>
        {events.some(Boolean) ? events : <Text style={[s.small, { textAlign: 'center', padding: 8 }]}>حتى حاجة مازال ما وقعات.</Text>}
        {bonus.length ? (
          <View style={s.fxEv}>
            <Text style={s.fxEvLabel}>★ البونيس {isConf ? '' : '(حسب BPS دابا)'}</Text>
            {bonus.map(b => (
              <View key={b.el} style={[s.fxBonusRow, mine[b.el] && s.fxMine]}>
                <View style={[s.fxBonusN, { backgroundColor: b.v === 3 ? C.gold : b.v === 2 ? C.silver : C.bronze }]}><Text style={s.fxBonusNT}>{b.v}</Text></View>
                <Text style={[s.fxEvName, { flex: 1 }, mine[b.el] && s.fxMineT]} numberOfLines={1}>{pn(b.el)}</Text>
                <Own el={b.el} />
                <Text style={s.small}>{info((data.players[b.el] || {}).team).s}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {bps.length ? (
          <View style={s.fxEv}>
            <Text style={s.fxEvLabel}>📊 أحسن BPS</Text>
            {bps.map(r => (
              <View key={r.element} style={[s.fxBonusRow, mine[r.element] && s.fxMine]}>
                <Text style={[s.fxEvName, { flex: 1 }, mine[r.element] && s.fxMineT]} numberOfLines={1}>{pn(r.element)}</Text>
                <Text style={s.small}>{info(r.side === 'h' ? f.team_h : f.team_a).s}</Text>
                <View style={s.fxBpsBar}><View style={[s.fxBpsFill, { width: `${Math.max(4, (r.value / Math.max(1, bps[0].value)) * 100)}%` }]} /></View>
                <Text style={[s.gridNum, { width: 30, textAlign: 'left', fontSize: 12 }]}>{r.value}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  const playerPts = (f, el) => {
    if (!f.started || !live) return null;
    const base = (fxPts[f.id] || {})[el] || 0;
    const conf = (f.stats || []).find(x => x.identifier === 'bonus');
    const prov = conf && (conf.h.length || conf.a.length) ? 0 : provisionalBonus([f])[el] || 0;
    return base + prov;
  };
  const card = f => {
    const live = f.started && !f.finished && !f.finished_provisional;
    const done = f.finished || f.finished_provisional;
    const h = info(f.team_h), a = info(f.team_a);
    const time = f.kickoff_time ? formatMoroccoDate(Date.parse(f.kickoff_time)).split(' · ')[1] : '–';
    const isOpen = openId === f.id;
    return (
      <TouchableOpacity key={f.id} activeOpacity={0.85} onPress={() => f.started && setOpenId(isOpen ? null : f.id)} style={[s.fxCard, live && s.fxCardLive]}>
        <View style={s.fxRow}>
          <View style={s.fxTeam}>
            <TeamBadge info={h} />
            <Text style={s.fxTeamT} numberOfLines={1}>{h.n}</Text>
          </View>
          <View style={s.fxMid}>
            {f.started ? (
              <View style={[s.fxScore, live && { backgroundColor: C.pink }]}>
                <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                  <Text style={s.fxScoreT}>{f.team_h_score ?? 0}</Text><Text style={s.fxScoreT}>-</Text><Text style={s.fxScoreT}>{f.team_a_score ?? 0}</Text>
                </View>
              </View>
            ) : <View style={[s.fxScore, { backgroundColor: C.bg }]}><Text style={[s.fxScoreT, { color: C.pitch }]}>{time}</Text></View>}
            <Text style={[s.fxState, live && { color: C.pink }]}>{live ? `🔴 ${f.minutes}'` : done ? 'انتهت' : ''}</Text>
          </View>
          <View style={[s.fxTeam, { flexDirection: 'row' }]}>
            <TeamBadge info={a} />
            <Text style={[s.fxTeamT, { textAlign: 'left' }]} numberOfLines={1}>{a.n}</Text>
          </View>
        </View>
        {myTeam(f.team_h).length || myTeam(f.team_a).length ? (
          <View style={s.fxMinis}>
            <View style={[s.fxMiniSide, { flexDirection: 'row-reverse' }]}>{myTeam(f.team_h).map(x => <MiniFace key={x.element} el={x.element} pick={x} data={data} pts={playerPts(f, x.element)} />)}</View>
            <View style={{ width: 74 }} />
            <View style={[s.fxMiniSide, { flexDirection: 'row' }]}>{myTeam(f.team_a).map(x => <MiniFace key={x.element} el={x.element} pick={x} data={data} pts={playerPts(f, x.element)} />)}</View>
          </View>
        ) : null}
        {f.started ? <Text style={s.fxMore}>{isOpen ? '▴ خبي التفاصيل' : '▾ التفاصيل والبونيس'}</Text> : null}
        {isOpen ? detail(f) : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.fixedPage}>
      <View style={[s.card, { overflow: 'hidden' }]}><GwNav list={list} gw={gw} setGw={setGw} /></View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 24 }} refreshControl={refreshControl}>
        {err ? <View style={s.err}><Text style={{ color: C.bad, textAlign: 'right' }}>ما قدرتش نجيب الماتشات.</Text></View> : null}
        {!fx && !err ? <ActivityIndicator color={C.pink} style={{ marginTop: 30 }} /> : null}
        {days.map(d => (
          <View key={d.key} style={{ gap: 8 }}>
            <Text style={s.fxDay}>{d.key}</Text>
            {d.fx.map(card)}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// Safhat l-kachafa: les joueurs l-7a9i9iyin (points, bonus, ownership, prix, transferts) w
// l-intiqalat dyal l-ligue (chkoun jab chkoun w chkoun ba3o) + dyal FPL kamla.
const fmtK = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n || 0));
const iso2 = t => `⁦${t}⁩`;
const POS_TAG = { 1: ['GKP', '#ffd400', C.ink], 2: ['DEF', '#00ff85', C.ink], 3: ['MID', '#04f5ff', C.ink], 4: ['FWD', '#e90052', '#fff'] };
const SCOUT_SORTS = [
  ['total', 'النقاط', v => v],
  ['ev', 'هاد الجولة', v => v],
  ['form', 'الفورم', v => v.toFixed(1)],
  ['bonus', 'البونيس', v => v],
  ['sel', 'الامتلاك', v => v.toFixed(1) + '%'],
  ['tin', '📥 شراو', fmtK],
  ['tout', '📤 باعو', fmtK],
  ['price', 'السعر', v => iso2('£' + v.toFixed(1))],
  ['xgi', 'xGI', v => v.toFixed(2)],
  ['ict', 'ICT', v => v.toFixed(1)],
  ['ep', 'المتوقع', v => v.toFixed(1)],
  ['g', 'الأهداف', v => v],
  ['a', 'الأسيست', v => v],
  ['cs', 'Clean sheet', v => v],
];
function PlayerPhoto({ pl, size = 46 }) {
  const [i, setI] = useState(0);
  const urls = pl.c ? photoUrls(pl.c) : [];
  return (
    <View style={[s.scPhoto, { width: size, height: size, borderRadius: size / 2 }]}>
      {i < urls.length
        ? <Image source={{ uri: urls[i] }} style={{ width: size, height: size * 1.1, marginTop: size * 0.12 }} resizeMode="cover" onError={() => setI(i + 1)} />
        : <Text style={s.miniInit}>{(pl.n || '?').slice(0, 2)}</Text>}
    </View>
  );
}

const SCOUT_DEFAULT = { pos: 0, team: 0, minP: 3.5, maxP: 16, mine: false, avail: false, league: false, minSel: 0, minMin: 0 };
// Liste déroulante: zr kayban fih l-ikhtiyar, w kayt7el lista f modal.
function Dropdown({ label, value, options, onChange, style }) {
  const [open, setOpen] = useState(false);
  const cur = options.find(o => o[0] === value);
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={[s.dd, style]}>
        {label ? <Text style={s.ddL}>{label}:</Text> : null}
        <Text style={s.ddV} numberOfLines={1}>{cur ? cur[1] : '–'}</Text>
        <Text style={s.ddCaret}>▾</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={s.modalBox}>
            {label ? <Text style={[s.h2, { padding: 14, textAlign: 'center' }]}>{label}</Text> : null}
            <ScrollView style={{ maxHeight: 420 }}>
              {options.map(([v, l]) => (
                <TouchableOpacity key={v} onPress={() => { onChange(v); setOpen(false); }} style={[s.modalItem, v === value && { backgroundColor: C.me }]}>
                  <Text style={[s.txt, { textAlign: 'center' }, v === value && { color: C.pink, fontWeight: '800' }]}>{v === value ? '✓ ' : ''}{l}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
// Spinner: − 9ima +
function Stepper({ label, value, step, min, max, fmt, onChange }) {
  const set = v => onChange(Math.round(Math.min(max, Math.max(min, v)) * 10) / 10);
  return (
    <View style={s.stepWrap}>
      {label ? <Text style={s.stepL}>{label}</Text> : null}
      <View style={s.step}>
        <TouchableOpacity onPress={() => set(value + step)} disabled={value >= max} style={[s.stepBtn, value >= max && { opacity: 0.3 }]}><Text style={s.stepBtnT}>+</Text></TouchableOpacity>
        <Text style={s.stepV}>{fmt(value)}</Text>
        <TouchableOpacity onPress={() => set(value - step)} disabled={value <= min} style={[s.stepBtn, value <= min && { opacity: 0.3 }]}><Text style={s.stepBtnT}>−</Text></TouchableOpacity>
      </View>
    </View>
  );
}
function ToggleRow({ label, value, onChange, last }) {
  return (
    <View style={[s.togRow, last && { borderBottomWidth: 0 }]}>
      <Text style={[s.txt, { flex: 1, textAlign: 'right' }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: C.line, true: '#953bff' }} thumbColor="#fff" activeThumbColor="#fff" />
    </View>
  );
}
function FilterTag({ t, onX }) {
  return (
    <TouchableOpacity onPress={onX} style={s.fTag}>
      <Text style={s.fTagT}>{t}  ✕</Text>
    </TouchableOpacity>
  );
}

function Scout({ c, data, meId, refreshControl }) {
  const [view, setView] = useState('players');
  const [f, setF] = useState(SCOUT_DEFAULT);
  const [draft, setDraft] = useState(null);
  const [q, setQ] = useState('');
  const [sortK, setSortK] = useState('total');
  const [sortDir, setSortDir] = useState(-1);
  const [limit, setLimit] = useState(40);
  const [sel, setSel] = useState(null);
  const [ctx, setCtx] = useState(null);
  const players = data.players || {};
  const teamS = id => ((data.teamInfo || {})[id] || {}).s || (data.teams || {})[id] || '';
  const lpBy = (data.leaguePicks || {}).by || {};
  const nL = Object.keys(lpBy).length;
  const own = {};
  Object.values(lpBy).forEach(t => (t.picks || []).forEach(pk => { own[pk.element] = (own[pk.element] || 0) + 1; }));
  const mine = Object.fromEntries(((lpBy[meId] || {}).picks || []).map(pk => [pk.element, pk]));

  const openPlayer = async el => {
    let g = ctx;
    if (!g && data.current) {
      try { g = await loadGwContext(data.current, players); setCtx(g); } catch { g = null; }
    }
    const lv = g ? (g.live[el] || {}) : {};
    const bonus = g ? g.bonus[el] || 0 : 0;
    setSel({ p: { element: el, eff: 1, bonus, pts: (lv.total_points || 0) + bonus, base: (lv.total_points || 0) + bonus }, team: { gw: data.current, explain: g ? g.explain : {}, byTeam: g ? g.byTeam : {} } });
  };

  const rows = useMemo(() => Object.entries(players).filter(([, pl]) => pl.t !== 5)
    .map(([id, pl]) => ({ id: +id, ...pl, sel: +pl.sel || 0, form: +pl.form || 0, ppg: +pl.ppg || 0 })), [data]);
  const needle = q.trim().toLowerCase();
  // L-ar9am dyal transferts (FPL) kayt3awdo mn 0 m3a kol deadline: daba rahom dyal l-jawla l-jaya.
  const nextGw = data.nextDeadline ? (data.current || 0) + 1 : null;
  const sortDef0 = SCOUT_SORTS.find(x => x[0] === sortK);
  const sortDef = ['tin', 'tout'].includes(sortK) && nextGw ? [sortDef0[0], `${sortDef0[1]} GW${nextGw}`, sortDef0[2]] : sortDef0;
  const list = rows
    .filter(r => (!f.pos || r.t === f.pos) && (!f.team || r.team === f.team) && r.price >= f.minP && r.price <= f.maxP
      && (!f.mine || mine[r.id]) && (!f.avail || !r.st || r.st === 'a') && (!f.league || own[r.id]) && r.sel >= f.minSel && (r.min || 0) >= f.minMin
      && (!needle || (r.n + ' ' + r.full).toLowerCase().includes(needle) || teamS(r.team).toLowerCase() === needle))
    .sort((a, b) => sortDir * ((a[sortK] || 0) - (b[sortK] || 0)) || b.total - a.total);
  const active = Object.keys(SCOUT_DEFAULT).filter(k => f[k] !== SCOUT_DEFAULT[k]).length;
  const teamsList = Object.entries(data.teamInfo || {}).map(([id, t]) => [+id, t.n]).sort((a, b) => a[1].localeCompare(b[1]));
  const sortOpts = SCOUT_SORTS.map(([k, l0]) => [k, ['tin', 'tout'].includes(k) && nextGw ? `${l0} GW${nextGw}` : l0]);
  const shown = list.slice(0, limit);
  const reset = f => v => { f(v); setLimit(40); };

  const Seg = (
    <View style={s.seg}>
      {[['players', '📊 اللاعبين'], ['transfers', '🔄 الانتقالات']].map(([k, l]) => (
        <TouchableOpacity key={k} onPress={() => setView(k)} style={[s.segBtn, view === k && s.segOn]}>
          <Text style={[s.segT, view === k && { color: '#fff' }]}>{l}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
  const sheet = sel ? <PlayerSheet p={sel.p} team={sel.team} data={data} c={c} onClose={() => setSel(null)} /> : null;

  if (view === 'transfers') {
    return (
      <View style={s.fixedPage}>
        {Seg}
        <ScoutTransfers c={c} data={data} teamS={teamS} openPlayer={openPlayer} refreshControl={refreshControl} mine={mine} />
        {sheet}
      </View>
    );
  }

  const card = (x, i) => {
    const pk = mine[x.id];
    const tag = POS_TAG[x.t] || ['', C.line, C.ink];
    const role = pk ? (pk.is_captain ? (pk.multiplier === 3 ? 'TC' : 'C') : pk.is_vice_captain ? 'V' : pk.position > 11 ? 'بنك' : null) : null;
    return (
      <TouchableOpacity key={x.id} activeOpacity={0.8} onPress={() => openPlayer(x.id)} style={[s.scCard, pk && s.scCardMine]}>
        <Text style={s.scRank}>{i + 1}</Text>
        <View>
          <PlayerPhoto pl={x} />
          {pk ? <View style={s.scMineDot}><Text style={s.scMineDotT}>✓</Text></View> : null}
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
            <Text style={s.scName} numberOfLines={1}>{x.n}</Text>
            {x.st && x.st !== 'a' ? <Text style={{ fontSize: 12 }}>{x.st === 'i' || x.st === 's' ? '🚑' : '⚠️'}</Text> : null}
          </View>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <View style={[s.scPos, { backgroundColor: tag[1] }]}><Text style={[s.scPosT, { color: tag[2] }]}>{tag[0]}</Text></View>
            <Text style={s.scTeam}>{teamS(x.team)}</Text>
            <Text style={s.scPrice}>{iso2('£' + x.price.toFixed(1))}</Text>
            {x.cc ? <Text style={[s.scTeam, { color: x.cc > 0 ? C.good : C.bad }]}>{x.cc > 0 ? '▲' : '▼'}</Text> : null}
            {pk ? <View style={s.scMineTag}><Text style={s.scMineTagT}>عندي{role ? ' · ' + role : ''}</Text></View> : null}
            {own[x.id] ? <Text style={s.scTeam}>👥{own[x.id]}/{nL}</Text> : null}
          </View>
          <Text style={s.scSub} numberOfLines={1}>
            GW {x.ev} · {x.total} pts · ★{x.bonus} · {x.sel.toFixed(1)}%
          </Text>
        </View>
        <View style={s.scBig}>
          <Text style={s.scBigN}>{sortDef[2](x[sortK] || 0)}</Text>
          <Text style={s.scBigL} numberOfLines={1}>{sortDef[1]}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.fixedPage}>
      {Seg}
      <View style={s.fBar}>
        <View style={s.fSearchWrap}>
          <Text style={{ fontSize: 14 }}>🔎</Text>
          <TextInput value={q} onChangeText={reset(setQ)} placeholder="قلب على لاعب…" placeholderTextColor={C.muted} style={s.fSearch} autoCorrect={false} autoCapitalize="none" />
          {q ? <TouchableOpacity onPress={() => reset(setQ)('')}><Text style={s.fClear}>✕</Text></TouchableOpacity> : null}
        </View>
        <TouchableOpacity onPress={() => setDraft(f)} style={s.fIconBtn} accessibilityLabel="الفيلترز">
          <Text style={s.fIcon}>⚙️</Text>
          {active ? <View style={s.fBadge}><Text style={s.fBadgeT}>{active}</Text></View> : null}
        </TouchableOpacity>
      </View>
      <View style={s.fSortRow}>
        <Dropdown label="رتّب ب" value={sortK} options={sortOpts} onChange={reset(setSortK)} style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => { setSortDir(d => -d); setLimit(40); }} style={s.fDirBtn} accessibilityLabel="قلب الترتيب">
          <Text style={s.fDirT}>{sortDir < 0 ? '▼ من الكبير' : '▲ من الصغير'}</Text>
        </TouchableOpacity>
      </View>
      <View style={s.fSummary}>
        <Text style={s.fSummaryN}>{list.length} لاعب</Text>
        {f.pos ? <FilterTag t={POS_TAG[f.pos][0]} onX={() => setF({ ...f, pos: 0 })} /> : null}
        {f.team ? <FilterTag t={teamS(f.team)} onX={() => setF({ ...f, team: 0 })} /> : null}
        {f.minP !== SCOUT_DEFAULT.minP || f.maxP !== SCOUT_DEFAULT.maxP ? <FilterTag t={`£${f.minP}–${f.maxP}`} onX={() => setF({ ...f, minP: SCOUT_DEFAULT.minP, maxP: SCOUT_DEFAULT.maxP })} /> : null}
        {f.mine ? <FilterTag t="✓ ديالي" onX={() => setF({ ...f, mine: false })} /> : null}
        {f.avail ? <FilterTag t="متاحين" onX={() => setF({ ...f, avail: false })} /> : null}
        {f.league ? <FilterTag t="👥 الليگ" onX={() => setF({ ...f, league: false })} /> : null}
        {f.minSel ? <FilterTag t={`≥${f.minSel}%`} onX={() => setF({ ...f, minSel: 0 })} /> : null}
        {f.minMin ? <FilterTag t={`≥${f.minMin}د`} onX={() => setF({ ...f, minMin: 0 })} /> : null}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingBottom: 24 }} refreshControl={refreshControl}>
        {shown.map(card)}
        {!shown.length ? <Text style={[s.small, { textAlign: 'center', padding: 20 }]}>حتى لاعب ما كيطابق.</Text> : null}
        {list.length > limit ? (
          <TouchableOpacity onPress={() => setLimit(l => l + 40)} style={s.moreBtn}>
            <Text style={s.moreBtnT}>عرض المزيد ({list.length - limit} باقيين)</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
      {sheet}
      {draft ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setDraft(null)}>
          <TouchableOpacity activeOpacity={1} style={s.sheetShade} onPress={() => setDraft(null)}>
            <TouchableOpacity activeOpacity={1} style={s.fSheet} onPress={() => {}}>
              <View style={s.fGrab} />
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center' }}>
                <Text style={[s.h2, { flex: 1, textAlign: 'right' }]}>الفيلترز</Text>
                <TouchableOpacity onPress={() => setDraft(SCOUT_DEFAULT)}><Text style={s.fReset}>إعادة الضبط</Text></TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 16, paddingBottom: 10 }}>
                <View style={{ gap: 8 }}>
                  <Text style={s.fLabel}>المركز</Text>
                  <View style={s.fSeg}>
                    {[[0, 'الكل'], [1, 'GKP'], [2, 'DEF'], [3, 'MID'], [4, 'FWD']].map(([k, l]) => (
                      <TouchableOpacity key={k} onPress={() => setDraft({ ...draft, pos: k })} style={[s.fSegBtn, draft.pos === k && { backgroundColor: k ? POS_TAG[k][1] : C.pitch }]}>
                        <Text style={[s.fSegT, draft.pos === k && { color: k ? POS_TAG[k][2] : '#fff' }]}>{l}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <View style={{ gap: 8 }}>
                  <Text style={s.fLabel}>الفريق</Text>
                  <Dropdown value={draft.team} options={[[0, 'كاع الفرق'], ...teamsList]} onChange={v => setDraft({ ...draft, team: v })} />
                </View>
                <View style={{ gap: 8 }}>
                  <Text style={s.fLabel}>السعر</Text>
                  <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
                    <Stepper label="من" value={draft.minP} step={0.5} min={3.5} max={draft.maxP} fmt={v => '£' + v.toFixed(1)} onChange={v => setDraft({ ...draft, minP: v })} />
                    <Stepper label="حتى" value={draft.maxP} step={0.5} min={draft.minP} max={16} fmt={v => '£' + v.toFixed(1)} onChange={v => setDraft({ ...draft, maxP: v })} />
                  </View>
                </View>
                <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
                  <View style={{ flex: 1, gap: 8 }}>
                    <Text style={s.fLabel}>الامتلاك على الأقل</Text>
                    <Stepper value={draft.minSel} step={5} min={0} max={80} fmt={v => v + '%'} onChange={v => setDraft({ ...draft, minSel: v })} />
                  </View>
                  <View style={{ flex: 1, gap: 8 }}>
                    <Text style={s.fLabel}>الدقايق على الأقل</Text>
                    <Stepper value={draft.minMin} step={90} min={0} max={1800} fmt={v => String(v)} onChange={v => setDraft({ ...draft, minMin: v })} />
                  </View>
                </View>
                <View style={s.fToggles}>
                  <ToggleRow label="✓ غير اللاعبين ديالي" value={draft.mine} onChange={v => setDraft({ ...draft, mine: v })} />
                  <ToggleRow label="👥 غير اللي عند شي واحد ف الليگ" value={draft.league} onChange={v => setDraft({ ...draft, league: v })} />
                  <ToggleRow label="🩺 غير المتاحين (بلا إصابة ولا توقيف)" value={draft.avail} onChange={v => setDraft({ ...draft, avail: v })} last />
                </View>
              </ScrollView>
              <TouchableOpacity onPress={() => { setF(draft); setDraft(null); setLimit(40); }} style={s.fApply}>
                <Text style={s.fApplyT}>طبّق الفيلترز</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      ) : null}
    </View>
  );
}

function ScoutTransfers({ c, data, teamS, openPlayer, refreshControl, mine = {} }) {
  const players = data.players || {};
  const pl = el => players[el] || {};
  const ids = (data.managers || []).map(m => m.id);
  const [tab, setTab] = useState('world');
  const [dir, setDir] = useState('in');
  const [tr, setTr] = useState(null);
  const [gw, setGw] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all(ids.map(id => getJson(`/entry/${id}/transfers/`).then(x => x.map(t => ({ ...t, entry: id }))).catch(() => [])))
      .then(all => { if (!alive) return; const flat = all.flat(); setTr(flat); setGw(g => g || Math.max(0, ...flat.map(t => t.event)) || null); });
    return () => { alive = false; };
  }, [data.fetchedAt]);

  const nextGw = data.nextDeadline ? (data.current || 0) + 1 : null;
  const gwTag = nextGw ? `GW${nextGw}` : `GW${data.current || ''}`;
  const hidden = nextGw && data.nextDeadline > Date.now();
  const first = id => (c.per[id] ? c.per[id].m.name.split(' ')[0] : '?');
  const price = v => iso2('£' + v.toFixed(1));

  // Ligne dyal joueur m3a bar (b7al l-graphiques): soura, smiya, fari9, l-ar9am.
  const Row = ({ el, i, value, max, label, color, who }) => {
    const p = pl(el);
    const tag = POS_TAG[p.t] || ['', C.line, C.ink];
    const isMine = !!mine[el];
    return (
      <TouchableOpacity activeOpacity={0.8} onPress={() => openPlayer(el)} style={[s.tRow, isMine && s.tRowMine]}>
        <Text style={s.tRank}>{i + 1}</Text>
        <View>
          <PlayerPhoto pl={p} size={40} />
          {isMine ? <View style={s.scMineDot}><Text style={s.scMineDotT}>✓</Text></View> : null}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
            <Text style={[s.tName, isMine && { color: '#7a1fe0' }]} numberOfLines={1}>{p.n || '?'}</Text>
            <View style={[s.scPos, { backgroundColor: tag[1] }]}><Text style={[s.scPosT, { color: tag[2] }]}>{tag[0]}</Text></View>
            <Text style={s.scTeam}>{teamS(p.team)}</Text>
            {p.price != null ? <Text style={s.scPrice}>{price(p.price)}</Text> : null}
          </View>
          <View style={s.tBarTrack}>
            <View style={[s.tBar, { width: `${Math.max(3, (value / (max || 1)) * 100)}%`, backgroundColor: color }]} />
          </View>
          {who ? <Text style={s.tWho} numberOfLines={1}>{who}</Text> : null}
        </View>
        <View style={{ alignItems: 'center', minWidth: 54 }}>
          <Text style={[s.tVal, { color }]}>{label}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const Tabs = (
    <View style={s.tTabs}>
      {[['world', '🌍 العالم'], ['league', '👥 الليگ'], ['price', '💹 الأسعار']].map(([k, l]) => (
        <TouchableOpacity key={k} onPress={() => setTab(k)} style={[s.tTab, tab === k && s.tTabOn]}>
          <Text style={[s.tTabT, tab === k && s.tTabTOn]}>{l}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
  const InOut = (
    <View style={s.tInOut}>
      {[['in', '📥 دخلو', C.good], ['out', '📤 خرجو', C.bad]].map(([k, l, col]) => (
        <TouchableOpacity key={k} onPress={() => setDir(k)} style={[s.tIO, dir === k && { backgroundColor: col, borderColor: col }]}>
          <Text style={[s.tIOT, dir === k && { color: '#fff' }]}>{l}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  let body;
  if (tab === 'world') {
    const all = Object.entries(players).filter(([, p]) => p.t !== 5).map(([id, p]) => ({ el: +id, ...p }));
    const total = all.reduce((t, p) => t + (p.tin || 0), 0);
    const key = dir === 'in' ? 'tin' : 'tout';
    const top = [...all].sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, 15);
    const max = top.length ? top[0][key] : 1;
    const myIn = all.filter(p => mine[p.el]).sort((a, b) => (b.tout || 0) - (a.tout || 0))[0];
    body = (
      <>
        <View style={s.tHero}>
          <Text style={s.tHeroK}>{gwTag} · من بعد آخر deadline</Text>
          <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
            <View style={s.tHeroBox}><Text style={s.tHeroN}>{fmtK(total)}</Text><Text style={s.tHeroL}>انتقال فالعالم</Text></View>
            <View style={s.tHeroBox}><Text style={s.tHeroN} numberOfLines={1}>{top.length ? pl(top[0].el).n : '–'}</Text><Text style={s.tHeroL}>{dir === 'in' ? 'الأكثر شراء' : 'الأكثر بيع'}</Text></View>
          </View>
          {data.nextDeadline ? <Text style={s.tHeroSub}>⏰ الـ deadline: {formatMoroccoDate(data.nextDeadline)}</Text> : null}
          {myIn && myIn.tout ? <Text style={s.tHeroSub}>📤 أكثر لاعب ديالك كيبيعوه: {myIn.n} ({fmtK(myIn.tout)})</Text> : null}
        </View>
        {InOut}
        <View style={s.tCard}>
          {top.map((p, i) => <Row key={p.el} el={p.el} i={i} value={p[key] || 0} max={max} label={fmtK(p[key] || 0)} color={dir === 'in' ? C.good : C.bad} />)}
        </View>
        <Text style={[s.small, { textAlign: 'center' }]}>الأرقام كتجي من FPL: مجموع الانتقالات ديال كاع المدربين فالعالم من آخر deadline.</Text>
      </>
    );
  } else if (tab === 'price') {
    const all = Object.entries(players).filter(([, p]) => p.t !== 5).map(([id, p]) => ({ el: +id, ...p }));
    const up = all.filter(p => p.cc > 0).sort((a, b) => b.cc - a.cc || b.tin - a.tin);
    const down = all.filter(p => p.cc < 0).sort((a, b) => a.cc - b.cc || b.tout - a.tout);
    const list = dir === 'in' ? up : down;
    body = (
      <>
        <View style={s.tHero}>
          <Text style={s.tHeroK}>تبدّل الأسعار · {gwTag}</Text>
          <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
            <View style={s.tHeroBox}><Text style={[s.tHeroN, { color: C.neon }]}>▲ {up.length}</Text><Text style={s.tHeroL}>طلعو</Text></View>
            <View style={s.tHeroBox}><Text style={[s.tHeroN, { color: '#ff6b9a' }]}>▼ {down.length}</Text><Text style={s.tHeroL}>هبطو</Text></View>
          </View>
        </View>
        <View style={s.tInOut}>
          {[['in', '📈 طلعو', C.good], ['out', '📉 هبطو', C.bad]].map(([k, l, col]) => (
            <TouchableOpacity key={k} onPress={() => setDir(k)} style={[s.tIO, dir === k && { backgroundColor: col, borderColor: col }]}>
              <Text style={[s.tIOT, dir === k && { color: '#fff' }]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={s.tCard}>
          {list.length ? list.slice(0, 25).map((p, i) => (
            <Row key={p.el} el={p.el} i={i} value={dir === 'in' ? p.tin || 0 : p.tout || 0} max={Math.max(1, ...list.slice(0, 25).map(x => (dir === 'in' ? x.tin : x.tout) || 0))}
              label={(p.cc > 0 ? '+' : '') + p.cc.toFixed(1)} color={dir === 'in' ? C.good : C.bad} who={`${dir === 'in' ? '📥' : '📤'} ${fmtK(dir === 'in' ? p.tin : p.tout)} ${dir === 'in' ? 'شراوه' : 'باعوه'}`} />
          )) : <Text style={[s.small, { textAlign: 'center', padding: 20 }]}>حتى لاعب ما تبدّل السعر ديالو.</Text>}
        </View>
      </>
    );
  } else {
    const gws = tr ? [...new Set(tr.map(t => t.event))].sort((a, b) => b - a) : [];
    const now = (tr || []).filter(t => t.event === gw);
    const tally = k => {
      const m = {};
      now.forEach(t => { (m[t[k]] = m[t[k]] || []).push(t.entry); });
      return Object.entries(m).map(([el, who]) => ({ el: +el, who })).sort((a, b) => b.who.length - a.who.length).slice(0, 10);
    };
    const list = tally(dir === 'in' ? 'element_in' : 'element_out');
    const byMgr = {};
    now.forEach(t => { (byMgr[t.entry] = byMgr[t.entry] || []).push(t); });
    const mgrs = Object.entries(byMgr).sort((a, b) => b[1].length - a[1].length);
    const hits = mgrs.reduce((t, [id]) => t + (((c.per[id] || {}).m || { gws: {} }).gws[gw] || {}).h || 0, 0);
    body = !tr ? <ActivityIndicator color={C.pink} style={{ padding: 30 }} /> : (
      <>
        {hidden ? (
          <View style={s.scLock}><Text style={s.scLockT}>🔒 تبديلات GW{nextGw} ديال الليگ كيبانو من بعد الـ deadline · {formatMoroccoDate(data.nextDeadline)}</Text></View>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ direction: 'rtl', flexGrow: 0 }} contentContainerStyle={s.scChips}>
          {gws.map(g => (
            <TouchableOpacity key={g} onPress={() => setGw(g)} style={[s.chipBtn, gw === g && s.chipOn]}>
              <Text style={[s.chipT, gw === g && { color: '#fff' }]}>GW{g}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={s.tHero}>
          <Text style={s.tHeroK}>الليگ · GW{gw}</Text>
          <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
            <View style={s.tHeroBox}><Text style={s.tHeroN}>{now.length}</Text><Text style={s.tHeroL}>انتقال</Text></View>
            <View style={s.tHeroBox}><Text style={s.tHeroN}>{mgrs.length}/{ids.length}</Text><Text style={s.tHeroL}>بدّلو</Text></View>
            <View style={s.tHeroBox}><Text style={[s.tHeroN, hits && { color: '#ff6b9a' }]}>{hits ? '−' + hits : 0}</Text><Text style={s.tHeroL}>hits</Text></View>
          </View>
        </View>
        {now.length ? (
          <>
            {InOut}
            <View style={s.tCard}>
              {list.map((x, i) => <Row key={x.el} el={x.el} i={i} value={x.who.length} max={list[0].who.length} label={'×' + x.who.length} color={dir === 'in' ? C.good : C.bad} who={x.who.map(first).join('، ')} />)}
            </View>
            <Text style={s.tSection}>شكون بدّل شنو</Text>
            {mgrs.map(([id, ts]) => {
              const h = (((c.per[id] || {}).m || { gws: {} }).gws[gw] || {}).h || 0;
              return (
                <View key={id} style={[s.tCard, { paddingVertical: 10, gap: 8 }]}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
                    <Text style={[s.tName, { flex: 1 }]} numberOfLines={1}>{c.per[id] ? c.per[id].m.name : id}</Text>
                    <View style={s.tCount}><Text style={s.tCountT}>{ts.length} 🔄</Text></View>
                    {h ? <View style={[s.tCount, { backgroundColor: '#ffe3ec' }]}><Text style={[s.tCountT, { color: C.bad }]}>−{h}</Text></View> : null}
                  </View>
                  {ts.map((t, i) => (
                    <View key={i} style={s.tSwap}>
                      <TouchableOpacity onPress={() => openPlayer(t.element_in)} style={[s.tSide, { backgroundColor: '#e9fbf1' }]}>
                        <PlayerPhoto pl={pl(t.element_in)} size={28} />
                        <View style={{ flex: 1 }}>
                          <Text style={[s.tSideN, { color: '#0a7a45' }]} numberOfLines={1}>{pl(t.element_in).n || '?'}</Text>
                          <Text style={s.tSideP}>{price(t.element_in_cost / 10)}</Text>
                        </View>
                      </TouchableOpacity>
                      <Text style={s.tArrow}>⇄</Text>
                      <TouchableOpacity onPress={() => openPlayer(t.element_out)} style={[s.tSide, { backgroundColor: '#fff0f4' }]}>
                        <PlayerPhoto pl={pl(t.element_out)} size={28} />
                        <View style={{ flex: 1 }}>
                          <Text style={[s.tSideN, { color: C.bad }]} numberOfLines={1}>{pl(t.element_out).n || '?'}</Text>
                          <Text style={s.tSideP}>{price(t.element_out_cost / 10)}</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              );
            })}
          </>
        ) : <Text style={[s.small, { textAlign: 'center', padding: 14 }]}>حتى واحد ما بدّل ف هاد الجولة.</Text>}
      </>
    );
  }

  return (
    <View style={{ flex: 1, gap: 10 }}>
      {Tabs}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 24 }} refreshControl={refreshControl}>
        {body}
      </ScrollView>
    </View>
  );
}

function Hmar({ c, open, refreshControl }) {
  const name = id => c.per[id].m.name;
  // 7mar GW N kaybda l-7okm dyalo m3a 00:00 mn b3d akhir match f GW N, w kaysali m3a 00:00 mn b3d
  // akhir match f GW N+1. Donc mli katsali GW N, 7mar GW N-1 kayb9a 7tta l-lil, 3ad kaytbeddel bo7do.
  const last = c.byGw[c.byGw.length - 1];
  const prev = c.byGw[c.byGw.length - 2];
  const [expired, setExpired] = useState(null);
  const cur = last && prev && expired !== last.gw ? prev : last;
  const pens = [...c.table].sort((a, b) => b.pen.amount - a.pen.amount || b.donkeys.length - a.donkeys.length);
  const banner = cur ? (
    <View style={s.donkeyRow}>
      <View style={s.donkeyIcon}><Text style={{ fontSize: 22 }}>🐴</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.donkeyName} numberOfLines={1}>{cur.ids.map(name).join(' و ')}</Text>
        <Text style={s.donkeySub}>حمار GW{cur.gw} · {cur.min} pts</Text>
      </View>
      {cur.gw < 38 ? <DonkeyTimer key={cur.gw} nextGw={cur.gw + 1} onOver={setExpired} /> : null}
    </View>
  ) : (
    <Card><Text style={[s.txt, { padding: 16 }]}>حتى جولة ما سالات من بداية الدوري.</Text></Card>
  );
  return (
    <Sections
      refreshControl={refreshControl}
      sections={[
        { body: banner, bare: true },
        {
          title: 'العقوبات', sub: 'بالدرهم',
          head: (
            <View style={[s.tr, s.thRow]}>
              <Text style={[s.th, { flex: 1 }]}>اللاعب</Text>
              <Text style={[s.th, s.colN]}>حمار</Text>
              <Text style={[s.th, s.colN]}>DH</Text>
            </View>
          ),
          body: pens.map(r => (
            <TouchableOpacity key={r.m.id} style={s.tr} onPress={() => open(r.m.id)}>
              <Text style={[s.txt, { flex: 1 }]} numberOfLines={1}>{r.m.name}</Text>
              <View style={{ flexDirection: 'row-reverse', gap: 4 }}>
                {r.pen.streaks ? <Pill kind="bad" text={'متتابعين ×' + r.pen.streaks} /> : null}
                {r.pen.triples ? <Pill kind="d" text={'3 مرات ×' + r.pen.triples} /> : null}
              </View>
              <Text style={[s.num, s.colN]}>🐴{r.donkeys.length}</Text>
              <Text style={[s.num, s.colN, s.bold]}>{r.pen.amount}</Text>
            </TouchableOpacity>
          )),
        },
        {
          title: 'الحمير جولة بجولة',
          body: (
            <View style={s.dgList}>
              {[...c.byGw].reverse().map((b, i) => (
                <TouchableOpacity key={b.gw} style={s.dgCard} onPress={() => open(b.ids[0])} activeOpacity={0.8}>
                  <View style={[s.dgGw, i === 0 && { backgroundColor: C.pink }]}>
                    <Text style={s.dgGwL}>GW</Text>
                    <Text style={s.dgGwN}>{b.gw}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.dgName} numberOfLines={1}>{b.ids.map(name).join('، ')}</Text>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                      <Text style={s.dgTeam} numberOfLines={1}>{b.ids.map(id => c.per[id].m.team).join('، ')}</Text>
                      {b.tie ? <View style={s.dgTie}><Text style={s.dgTieT}>تعادل</Text></View> : null}
                    </View>
                  </View>
                  <View style={s.dgPts}>
                    <Text style={s.dgPtsN}>{b.min}</Text>
                    <Text style={s.dgPtsL}>pts</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ),
        },
      ]}
    />
  );
}
function Stats({ c, data, meId, open, refreshControl }) {
  const S = useMemo(() => leagueStats(data.managers, { phases: data.phases || [], events: data.events || {} }), [data]);
  const sel = useMemo(() => Object.fromEntries(Object.entries(data.players || {}).map(([id, pl]) => [id, pl.sel])), [data]);
  const P = useMemo(() => leaguePickStats(data.leaguePicks, sel), [data, sel]);
  const name = id => (c.per[id] ? c.per[id].m.name : '?');
  const first = id => name(id).split(' ')[0];
  const player = el => (data.players[el] || {}).n || '?';
  const lead = c.table[0] ? c.table[0].m.id : null;
  const second = c.table[1] ? c.table[1].m.id : null;
  const [focusId, setFocus] = useState(meId === lead ? second : lead);
  const focus = [
    ...(meId ? [{ id: meId, color: VIZ.me, label: 'نتا' }] : []),
    ...(focusId && focusId !== meId ? [{ id: focusId, color: VIZ.focus, label: first(focusId) }] : []),
  ];
  if (!S.gws.length) return <Card><Text style={[s.txt, { padding: 16 }]}>مازال ما كاين حتى جولة.</Text></Card>;

  const gapLead = second ? c.per[lead].total - c.per[second].total : 0;
  const capTop = P.captains[0];
  const picker = (
    <View style={{ paddingBottom: 8 }}>
      <Text style={[s.small, { paddingHorizontal: 12, paddingTop: 8 }]}>قارن مع:</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 12, paddingTop: 6 }}>
        {c.table.filter(r => r.m.id !== meId).map(r => (
          <TouchableOpacity key={r.m.id} onPress={() => setFocus(r.m.id)} style={[s.pickChip, focusId === r.m.id && s.pickChipOn]}>
            <Text style={[s.pickChipT, focusId === r.m.id && { color: '#fff' }]}>{first(r.m.id)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Legend items={[...(meId ? [{ color: VIZ.me, label: 'نتا' }] : []), { color: VIZ.focus, label: focusId ? name(focusId) : '' }, { color: VIZ.context, label: 'الباقي' }]} />
    </View>
  );
  const rowsBy = (key, f, filter = () => true) => S.per.filter(filter).map(x => ({ id: x.id, label: first(x.id), value: x[key], display: f ? f(x) : x[key] })).sort((a, b) => b.value - a.value);
  const awards = [
    S.awards.bestGw && ['🚀', 'أحسن جولة', name(S.awards.bestGw.id), `${S.awards.bestGw.p} pts · GW${S.awards.bestGw.gw}`],
    S.awards.climber && ['📈', 'أكبر طلعة', name(S.awards.climber.id), `+${S.awards.climber.v} بلايص · GW${S.awards.climber.gw}`],
    S.awards.steady && ['🎯', 'الأكثر انتظاماً', name(S.awards.steady.id), `σ ${S.awards.steady.sd.toFixed(1)}`],
    S.awards.benchDisaster && ['🪑', 'كارثة البنك', name(S.awards.benchDisaster.id), `${S.awards.benchDisaster.bench} pts فالبنك · GW${S.awards.benchDisaster.gw}`],
    S.awards.bigHit && ['💸', 'أكبر hit', name(S.awards.bigHit.id), `−${S.awards.bigHit.h} · GW${S.awards.bigHit.gw}`],
    S.awards.worstGw && ['🥶', 'أسوأ جولة', name(S.awards.worstGw.id), `${S.awards.worstGw.p} pts · GW${S.awards.worstGw.gw}`],
    S.awards.spoon && ['🥄', 'الملعقة الخشبية', name(S.awards.spoon.id), `${S.awards.spoon.total} pts`],
  ].filter(Boolean);

  return (
    <Sections
      refreshControl={refreshControl}
      sections={[
        {
          bare: true,
          body: (
            <View style={s.statHero}>
              <Text style={s.statHeroT}>GW{S.lastGw}{S.live ? ' · 🔴 live' : ''}</Text>
              <View style={s.statTiles}>
                {[
                  ['نجم الجولة', S.gwTop ? `${S.gwTop.v}` : '–', S.gwTop ? first(S.gwTop.id) : ''],
                  ['معدل الدوري', S.leagueAvg != null ? S.leagueAvg.toFixed(0) : '–', S.globalAvg != null ? `العالمي ${S.globalAvg}` : ''],
                  ['المتصدر', lead ? first(lead) : '–', second ? `+${gapLead} على ${first(second)}` : ''],
                  ['كابتن الدوري', capTop ? player(capTop.el) : '–', capTop ? `${capTop.v}/${P.n} دارو` : ''],
                ].map(([l, v, sub]) => (
                  <View key={l} style={s.statTile}>
                    <Text style={s.statTileL}>{l}</Text>
                    <Text style={s.statTileV} numberOfLines={1}>{v}</Text>
                    <Text style={s.statTileS} numberOfLines={1}>{sub}</Text>
                  </View>
                ))}
              </View>
            </View>
          ),
        },
        {
          title: 'سباق النقاط', sub: 'شحال بعيد على المتصدر', head: picker,
          body: <LineChart series={S.gap} gws={S.gws} focus={focus} invert yMin={0} unit=" pts" />,
        },
        {
          title: 'سباق الترتيب', sub: 'الترتيب فكل جولة',
          body: <LineChart series={S.rank} gws={S.gws} focus={focus} invert yMin={1} yMax={S.ids.length} ticks={Math.min(5, S.ids.length - 1)} fmt={v => '#' + v} />,
        },
        {
          title: 'خريطة الجولات', sub: 'النقاط مقارنة مع معدل الدوري',
          body: (
            <>
              <Heatmap
                rows={c.table.map(r => ({ id: r.m.id, label: first(r.m.id) }))}
                gws={S.gws}
                me={meId}
                onRow={open}
                cell={(id, g) => {
                  const h = S.heat[id][g];
                  const col = divergingColor(h.d);
                  return { text: h.p, bg: col.bg, fg: col.fg, crown: h.best, tip: `${name(id)} · GW${g}: ${h.p} pts (${h.d >= 0 ? '+' : ''}${h.d.toFixed(0)} على المعدل ${S.avg[g].toFixed(0)})` };
                }}
              />
              <Legend items={[{ color: VIZ.good[2], label: 'فوق المعدل' }, { color: VIZ.mid, label: 'قريب' }, { color: VIZ.bad[2], label: 'تحت المعدل' }, { color: '#fff', label: '👑 أحسن واحد' }]} />
              <View style={{ height: 10 }} />
            </>
          ),
        },
        {
          title: 'الأبطال', sub: 'نجم الجولة و نجم الشهر',
          body: (
            <>
              <RankBars rows={S.wins.filter(x => x.v > 0).map(x => ({ id: x.id, label: first(x.id), value: x.v, display: '⭐ ' + (x.v % 1 ? x.v.toFixed(1) : x.v) })).sort((a, b) => b.value - a.value)} me={meId} focus={focusId} />
              <View style={s.monthList}>
                {S.months.map(m => (
                  <View key={m.id} style={[s.monthCard, !m.done && { borderStyle: 'dashed' }]}>
                    <Text style={s.monthName}>{m.name}{m.done ? '' : ' ⏳'}</Text>
                    <Text style={s.monthWho} numberOfLines={1}>{m.winners.map(first).join('، ')}</Text>
                    <Text style={s.monthPts}>{m.v} pts · GW{m.from}–{m.to}</Text>
                  </View>
                ))}
              </View>
            </>
          ),
        },
        {
          title: 'الكابتن', sub: `GW${P.gw ?? ''} · شكون دار شكون`,
          body: (
            <>
              <RankBars rows={P.captains.map(x => ({ id: 'c' + x.el, label: player(x.el), value: x.v, display: `${x.v}/${P.n}` }))} />
              <View style={[s.tr, s.thRow]}>
                <Text style={[s.th, { flex: 1 }]}>اللاعب</Text>
                <Text style={[s.th, s.colN]}>عندهم</Text>
                <Text style={[s.th, s.colN]}>C</Text>
                <Text style={[s.th, s.colN]}>EO</Text>
                <Text style={[s.th, { width: 56, textAlign: 'center' }]}>vs العالم</Text>
              </View>
              {P.eo.slice(0, 12).map(x => {
                const diff = x.global != null ? x.eo - x.global : null;
                return (
                  <View key={x.el} style={s.tr}>
                    <Text style={[s.txt, { flex: 1 }]} numberOfLines={1}>{player(x.el)}</Text>
                    <Text style={[s.num, s.colN]}>{x.owned.toFixed(0)}%</Text>
                    <Text style={[s.num, s.colN]}>{x.caps || '–'}</Text>
                    <Text style={[s.num, s.colN, s.bold]}>{x.eo.toFixed(0)}%</Text>
                    <Text style={[s.num, { width: 56, textAlign: 'center', fontWeight: '800', color: diff == null ? C.muted : diff >= 0 ? VIZ.good[3] : VIZ.bad[3] }]}>{diff == null ? '–' : `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}`}</Text>
                  </View>
                );
              })}
              <Text style={[s.small, { padding: 10, textAlign: 'center' }]}>EO = شحال كيحسب اللاعب فالدوري (الكابتن ×2). vs العالم = الفرق مع النسبة ديال FPL.</Text>
            </>
          ),
        },
        {
          title: 'التبديلات', sub: 'النقاط اللي ضاعو فالـ hits',
          body: (() => {
            const rows = rowsBy('hits', x => `−${x.hits}`, x => x.hits > 0).map(r => ({ ...r, sub: `${S.perById[r.id].tr} تبديل` }));
            return rows.length ? <RankBars rows={rows} me={meId} focus={focusId} /> : <Text style={[s.small, { padding: 14, textAlign: 'center' }]}>حتى واحد ما دار -4.</Text>;
          })(),
        },
        {
          title: 'نقاط ضايعة فالبنك', sub: 'بلا Bench Boost',
          body: <RankBars rows={rowsBy('bench')} me={meId} focus={focusId} />,
        },
        {
          title: 'الخاصيات', sub: 'شكون لعب شنو و فاش',
          body: (
            <View style={{ padding: 8 }}>
              <View style={[s.chipTotals]}>
                {Object.keys(CHIPS).filter(k => S.chipCounts[k]).map(k => (
                  <View key={k} style={[s.chipTotal, { borderColor: CHIPS[k].color }]}>
                    <Text style={[s.chipTotalN, { color: CHIPS[k].color }]}>{S.chipCounts[k]}</Text>
                    <Text style={s.chipTotalL}>{CHIPS[k].short}</Text>
                  </View>
                ))}
              </View>
              {c.table.map(r => (
                <View key={r.m.id} style={[s.tr, { paddingVertical: 7 }]}>
                  <Text style={[s.txt, { width: 96 }, r.m.id === meId && { color: VIZ.me, fontWeight: '900' }]} numberOfLines={1}>{first(r.m.id)}</Text>
                  <View style={{ flex: 1, flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 4 }}>
                    {(S.chips[r.m.id] || []).length ? [...S.chips[r.m.id]].sort((a, b) => a.gw - b.gw).map(ch => (
                      <View key={ch.name + ch.gw} style={[s.chipDot, { backgroundColor: (CHIPS[ch.name] || {}).color || C.muted }]}>
                        <Text style={s.chipDotT}>{(CHIPS[ch.name] || {}).short || ch.name} {ch.gw}</Text>
                      </View>
                    )) : <Text style={s.small}>مازال</Text>}
                  </View>
                </View>
              ))}
            </View>
          ),
        },
        {
          title: 'قيمة الفرقة', sub: 'و الفرق مع معدل الدوري',
          // Kolchi 7da 100m: barres mn 0 ma kaybinouch l-far9, donc ar9am w l-far9 m3a l-moyenne.
          body: (() => {
            const avgV = S.per.reduce((a, x) => a + x.value, 0) / (S.per.length || 1);
            const iso = t => '\u2066' + t + '\u2069';
            return <RankBars bars={false} rows={S.per.map(x => ({ id: x.id, label: first(x.id), sub: 'بنك ' + iso(`£${x.bank.toFixed(1)}m`), value: x.value, display: iso(`£${x.value.toFixed(1)}m`) + `  (${x.value - avgV >= 0 ? '+' : ''}${(x.value - avgV).toFixed(1)})` })).sort((a, b) => b.value - a.value)} me={meId} focus={focusId} />;
          })(),
        },
        {
          title: 'الحمير 🐴', sub: 'شحال من مرة كل واحد كان حمار الجولة',
          body: (() => {
            const rows = c.table.filter(r => r.donkeys.length).map(r => ({
              id: r.m.id, label: first(r.m.id), value: r.donkeys.length,
              sub: 'GW ' + [...r.donkeys].sort((a, b) => a - b).join('، ') + ` · ${r.pen.amount} DH`,
              display: '🐴 ' + r.donkeys.length,
            })).sort((a, b) => b.value - a.value || c.per[b.id].pen.amount - c.per[a.id].pen.amount);
            const clean = c.table.filter(r => !r.donkeys.length).map(r => first(r.m.id));
            return (
              <>
                {rows.length ? <RankBars rows={rows} me={meId} focus={focusId} /> : null}
                {clean.length ? <Text style={[s.small, { padding: 14, paddingTop: 4, textAlign: 'right' }]}>✨ عمرهم ما كانو حمير: {clean.join('، ')}</Text> : null}
              </>
            );
          })(),
        },
        {
          title: 'الانتظام', sub: 'المعدل، التذبذب (σ)، فوق المعدل، 🐴',
          head: (
            <View style={[s.tr, s.thRow]}>
              <Text style={[s.th, { flex: 1 }]}>اللاعب</Text>
              <Text style={[s.th, s.colN]}>المعدل</Text>
              <Text style={[s.th, s.colN]}>σ</Text>
              <Text style={[s.th, s.colN]}>فوق</Text>
              <Text style={[s.th, { width: 40, textAlign: 'left' }]}>🐴</Text>
            </View>
          ),
          body: [...S.per].sort((a, b) => b.avg - a.avg).map(x => (
            <TouchableOpacity key={x.id} style={[s.tr, x.id === meId && { backgroundColor: C.me }]} onPress={() => open(x.id)}>
              <Text style={[s.txt, { flex: 1 }]} numberOfLines={1}>{name(x.id)}</Text>
              <Text style={[s.num, s.colN, s.bold]}>{x.avg.toFixed(1)}</Text>
              <Text style={[s.num, s.colN]}>{x.sd.toFixed(1)}</Text>
              <Text style={[s.num, s.colN]}>{x.above}/{S.gws.length}</Text>
              <Text style={[s.num, { width: 40, textAlign: 'left', color: C.donkey, fontWeight: '800' }]}>{c.per[x.id] ? c.per[x.id].donkeys.length : 0}</Text>
            </TouchableOpacity>
          )),
        },
        {
          title: 'كلشي ضد كلشي', sub: 'لو كان كل جولة ماتش ضد الكل',
          body: <RankBars rows={S.allPlay.map(x => ({ id: x.id, label: first(x.id), sub: `${x.w}ر ${x.d}ت ${x.l}خ`, value: x.v, display: `${x.v.toFixed(0)}%` })).sort((a, b) => b.value - a.value)} me={meId} focus={focusId} max={100} />,
        },
        {
          title: 'الجوائز', sub: 'من بداية الموسم',
          body: (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row-reverse', gap: 10, padding: 12 }}>
              {awards.map(([icon, title, who, detail]) => (
                <TouchableOpacity key={title} style={s.awardCard} activeOpacity={0.85}>
                  <Text style={s.awardIcon}>{icon}</Text>
                  <Text style={s.awardTitle}>{title}</Text>
                  <Text style={s.awardWho} numberOfLines={1}>{who}</Text>
                  <Text style={s.awardDetail} numberOfLines={1}>{detail}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ),
        },
      ]}
    />
  );
}

function GwNav({ list, gw, setGw }) {
  const [open, setOpen] = useState(false);
  const i = list.indexOf(gw);
  const prev = i > 0 ? list[i - 1] : null;
  const next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  return (
    <>
      <View style={s.gwNav}>
        <TouchableOpacity disabled={!prev} onPress={() => setGw(prev)} style={[s.arrow, !prev && { opacity: 0.3 }]} accessibilityLabel="الجولة السابقة">
          <Text style={s.arrowT}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setOpen(true)} style={s.gwBtn}>
          <Text style={s.gwBtnT}>Gameweek {gw}  ▾</Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={!next} onPress={() => setGw(next)} style={[s.arrow, !next && { opacity: 0.3 }]} accessibilityLabel="الجولة الجاية">
          <Text style={s.arrowT}>›</Text>
        </TouchableOpacity>
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={s.modalBox}>
            <Text style={[s.h2, { padding: 14, textAlign: 'center' }]}>اختار الجولة</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {[...list].reverse().map(g => (
                <TouchableOpacity key={g} onPress={() => { setGw(g); setOpen(false); }} style={[s.modalItem, g === gw && { backgroundColor: C.me }]}>
                  <Text style={[s.txt, { textAlign: 'center' }, g === gw && { color: C.pink, fontWeight: '700' }]}>Gameweek {g}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// Tsawer dyal les joueurs 3and Premier League. L-chemin tbeddel bin les saisons, donc kanjarrbo
// wa7ed mn b3d wa7ed. Ila ma khdam ta wa7ed, kayban l-maillot b7al 9bel.
const photoUrls = code => [
  `https://resources.premierleague.com/premierleague25/photos/players/110x140/${code}.png`,
  `https://resources.premierleague.com/premierleague/photos/players/110x140/p${code}.png`,
  `https://resources.premierleague.com/premierleague/photos/players/250x250/p${code}.png`,
];

function PlayerFace({ pl, data, badge }) {
  const [i, setI] = useState(0);
  const urls = pl.c ? photoUrls(pl.c) : [];
  const shirt = (
    <View style={[s.shirt, pl.t === 1 && { backgroundColor: '#f2c400' }]}>
      <Text style={[s.shirtT, pl.t === 1 && { color: C.ink }]}>{data.teams[pl.team] || ''}</Text>
    </View>
  );
  return (
    <View style={s.face}>
      {i < urls.length ? (
        <>
          <Image source={{ uri: urls[i] }} style={s.photo} resizeMode="contain" onError={() => setI(i + 1)} accessibilityLabel={pl.n} />
          <View style={[s.teamTag, pl.t === 1 && { backgroundColor: '#f2c400' }]}>
            <Text style={[s.teamTagT, pl.t === 1 && { color: C.ink }]}>{data.teams[pl.team] || ''}</Text>
          </View>
        </>
      ) : shirt}
      {badge ? <View style={s.capt}><Text style={s.captT}>{badge}</Text></View> : null}
    </View>
  );
}

function Kit({ p, data, bench, onPress }) {
  const pl = data.players[p.element] || { n: '?' };
  // Banc (bla Bench Boost): kayban l-point dyal joueur wakha ma kaythesbch.
  const pts = bench && !p.subIn ? p.base : p.pts;
  const capNow = p.eff >= 2;
  const badge = capNow ? (p.eff === 3 ? 'TC' : 'C') : p.is_captain ? 'C' : p.is_vice_captain ? 'V' : null;
  const waiting = !p.done && !p.played;
  const prov = p.bonus && (p.eff || bench) ? p.bonus : 0;
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={[s.kit, p.subOut && { opacity: 0.45 }]} accessibilityLabel={`إحصائيات ${pl.n}`}>
      {p.subIn ? <Text style={s.subTag}>↑ دخل</Text> : p.subOut ? <Text style={[s.subTag, { backgroundColor: C.bad }]}>↓ خرج</Text> : null}
      <PlayerFace key={p.element} pl={pl} data={data} badge={badge} />
      <View style={s.kitName}><Text style={s.kitNameT} numberOfLines={1}>{pl.n}</Text></View>
      <View style={s.kitPts}>
        <Text style={s.kitPtsT}>{waiting ? '⏳' : pts}</Text>
        {prov ? <Text style={s.bonusT}>+{prov * Math.max(1, p.eff || 1)}★</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const POS_AR = { 1: 'حارس', 2: 'مدافع', 3: 'وسط', 4: 'مهاجم', 5: 'مدرب' };
const STAT_AR = {
  minutes: 'الدقائق', goals_scored: 'أهداف', assists: 'تمريرات حاسمة', clean_sheets: 'شباك نظيفة',
  goals_conceded: 'أهداف مستقبلة', own_goals: 'ضد مرماه', penalties_saved: 'جزاء متصدى', penalties_missed: 'جزاء ضايع',
  yellow_cards: 'إنذار', red_cards: 'طرد', saves: 'تصديات', bonus: 'بونيس', defensive_contribution: 'مساهمة دفاعية',
};

// Wra9a dyal l-joueur: had l-jawla (match w n-n9at m-fassla), 3and chkoun kayn f l-ligue,
// l-jawlat li fatou, w l-matchat li jayin.
const FDR = { 1: ['#375523', '#fff'], 2: ['#01fc7a', '#1d0a20'], 3: ['#e7e7e7', '#1d0a20'], 4: ['#ff1751', '#fff'], 5: ['#80072d', '#fff'] };
const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function leagueOwnership(c, data, element) {
  const lp = data.leaguePicks || { by: {} };
  const ids = Object.keys(lp.by);
  const owners = [];
  for (const id of ids) {
    const pk = lp.by[id].picks.find(x => x.element === element);
    if (pk && c.per[id]) owners.push({ id: +id, m: c.per[id].m, pick: pk, chip: lp.by[id].chip });
  }
  const n = ids.length || 1;
  const starts = owners.filter(o => o.pick.multiplier > 0).length;
  const caps = owners.filter(o => o.pick.is_captain).length;
  const eo = owners.reduce((t, o) => t + o.pick.multiplier, 0);
  const role = o => (o.pick.is_captain ? (o.pick.multiplier === 3 ? 'TC' : 'C') : o.pick.is_vice_captain ? 'V' : o.pick.multiplier > 0 ? 'XI' : 'بنك');
  owners.sort((x, y) => y.pick.multiplier - x.pick.multiplier || x.m.name.localeCompare(y.m.name));
  return { gw: lp.gw, n: ids.length, owners, owned: owners.length / n * 100, starts: starts / n * 100, caps, eo: eo / n * 100, role };
}

function PlayerSheet({ p, team, data, c, onClose }) {
  const [tab, setTab] = useState('gw');
  const [hist, setHist] = useState(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    getJson(`/element-summary/${p.element}/`).then(h => alive && setHist(h)).catch(() => alive && setHist({ error: true }));
    return () => { alive = false; };
  }, [p.element]);
  const pl = data.players[p.element] || { n: '?' };
  const ex = (team.explain || {})[p.element] || { parts: [] };
  const fx = (team.byTeam || {})[pl.team] || [];
  const name = id => data.teams[id] || '';
  const when = iso => {
    if (!iso) return 'مؤجل';
    const d = new Date(iso);
    return `${DAYS_AR[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const own = leagueOwnership(c, data, p.element);
  const pct = x => `${x.toFixed(x % 1 ? 1 : 0)}%`;
  const rows = ex.parts.flatMap(part => part.stats.map(st => ({ key: part.fixture + st.identifier, label: STAT_AR[st.identifier] || st.identifier, value: st.value, pts: st.points })));
  if (p.bonus) rows.push({ key: 'prov', label: '★ بونيس مؤقت', value: `BPS ${ex.bps}`, pts: p.bonus, prov: true });
  const mult = p.eff || 0;

  const tabs = [['gw', `GW${team.gw}`], ['league', 'الدوري'], ['prev', 'السابق'], ['next', 'القادم']];
  const history = hist && hist.history ? [...hist.history].reverse() : [];
  const shown = all ? history : history.slice(0, 5);
  const sum = k => shown.reduce((t, h) => t + (+h[k] || 0), 0);
  const cols = [['GW', 30], ['الخصم', 62], ['د', 30], ['ن', 28], ['G', 22], ['A', 22], ['CS', 26], ['DC', 26], ['xG', 38], ['xA', 38]];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} style={s.sheetShade} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.sheet} onPress={() => {}}>
          <View style={s.sheetHead}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                <Text style={s.sheetPos}>{name(pl.team)} · {POS_AR[pl.t] || ''}</Text>
                {pl.price != null ? <View style={s.pricePill}><Text style={s.pricePillT}>{'£' + pl.price.toFixed(1) + 'm'}</Text></View> : null}
              </View>
              <Text style={s.sheetName} numberOfLines={1}>{pl.n}</Text>
              <Text style={s.sheetFull} numberOfLines={1}>{pl.full || ''}</Text>
            </View>
            <PlayerFace pl={pl} data={data} />
            <TouchableOpacity onPress={onClose} style={s.sheetClose} accessibilityLabel="سد"><Text style={{ color: '#fff', fontSize: 18 }}>✕</Text></TouchableOpacity>
          </View>

          <View style={s.sheetKpis}>
            {[[p.pts, `GW${team.gw}${mult >= 2 ? ` ×${mult}` : ''}`], [pct(own.owned), 'فالدوري'], [own.caps, 'كابتن'], [pct(own.eo), 'EO'], [`${pl.sel ?? '–'}%`, 'عالمياً']].map(([v, l]) => (
              <View key={l} style={s.sheetKpi}><Text style={s.sheetKpiN}>{v}</Text><Text style={s.sheetKpiL}>{l}</Text></View>
            ))}
          </View>

          <View style={[s.seg, { marginHorizontal: 12, marginTop: 10 }]}>
            {tabs.map(([k, l]) => (
              <TouchableOpacity key={k} onPress={() => setTab(k)} style={[s.segBtn, tab === k && s.segOn]}>
                <Text style={[s.segT, tab === k && { color: '#fff' }]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView style={{ maxHeight: 430 }} contentContainerStyle={{ padding: 12, gap: 10 }}>
            {pl.news ? <View style={s.sheetNews}><Text style={s.sheetNewsT}>⚠️ {pl.news}</Text></View> : null}

            {tab === 'gw' ? (
              <>
                {fx.map(f => (
                  <View key={f.id} style={s.sheetFx}>
                    <Text style={[s.sheetFxT, f.team_h === pl.team && s.sheetFxMine]}>{name(f.team_h)}</Text>
                    {f.started ? (
                      <View style={{ flex: 1, flexDirection: 'row-reverse', justifyContent: 'center', gap: 8 }}>
                        <Text style={s.sheetFxScore}>{f.team_h_score ?? 0}</Text>
                        <Text style={[s.sheetFxScore, { color: C.muted }]}>-</Text>
                        <Text style={s.sheetFxScore}>{f.team_a_score ?? 0}</Text>
                      </View>
                    ) : <Text style={[s.sheetFxScore, { flex: 1, fontSize: 13 }]}>{when(f.kickoff_time)}</Text>}
                    <Text style={[s.sheetFxT, f.team_a === pl.team && s.sheetFxMine]}>{name(f.team_a)}</Text>
                    <Text style={s.sheetFxState}>{f.finished || f.finished_provisional ? 'سالا' : f.started ? `🔴 ${f.minutes}'` : ''}</Text>
                  </View>
                ))}
                <View style={s.card}>
                  <View style={[s.tr, s.thRow]}>
                    <Text style={[s.th, { flex: 1 }]}>الإحصائية</Text>
                    <Text style={[s.th, s.colN]}>العدد</Text>
                    <Text style={[s.th, s.colN]}>نقاط</Text>
                  </View>
                  {rows.length ? rows.map(r => (
                    <View key={r.key} style={s.tr}>
                      <Text style={[s.txt, { flex: 1 }, r.prov && { color: '#c99a00', fontWeight: '700' }]}>{r.label}</Text>
                      <Text style={[s.num, s.colN]}>{r.value}</Text>
                      <Text style={[s.num, s.colN, s.bold, { color: r.pts < 0 ? C.bad : C.ink }]}>{r.pts > 0 ? '+' + r.pts : r.pts}</Text>
                    </View>
                  )) : <Text style={[s.small, { padding: 14, textAlign: 'center' }]}>{p.done ? 'ما لعبش فهاد الجولة.' : 'مازال ما لعبش.'}</Text>}
                  <View style={[s.tr, { backgroundColor: C.bg }]}>
                    <Text style={[s.txt, s.bold, { flex: 1 }]}>المجموع{mult >= 2 ? ` (×${mult})` : ''}</Text>
                    <Text style={[s.num, s.colN, s.bold]}>{ex.bps != null ? `BPS ${ex.bps}` : ''}</Text>
                    <Text style={[s.num, s.colN, s.bold, { color: C.pitch }]}>{p.pts}</Text>
                  </View>
                </View>
              </>
            ) : null}

            {tab === 'league' ? (
              <>
                <View style={s.sheetGrid}>
                  {[[`${own.owners.length}/${own.n}`, 'عندهم'], [pct(own.starts), 'أساسي'], [own.caps, 'كابتن'], [pct(own.eo), 'الملكية الفعلية']].map(([v, l]) => (
                    <View key={l} style={[s.sheetStat, { width: '47%' }]}><Text style={s.sheetStatN}>{v}</Text><Text style={s.sheetStatL}>{l}</Text></View>
                  ))}
                </View>
                <View style={s.card}>
                  <View style={s.cardH}><Text style={[s.h2, { fontSize: 15 }]}>عند شكون كاين</Text><Text style={s.muted}>GW{own.gw}</Text></View>
                  {own.owners.length ? own.owners.map(o => {
                    const r = own.role(o);
                    return (
                      <View key={o.id} style={s.tr}>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.txt, s.bold]} numberOfLines={1}>{o.m.name}</Text>
                          <Text style={s.small} numberOfLines={1}>{o.m.team}</Text>
                        </View>
                        <View style={[s.roleTag, r === 'بنك' && { backgroundColor: C.line }, (r === 'C' || r === 'TC') && { backgroundColor: C.pitch }]}>
                          <Text style={[s.roleTagT, r === 'بنك' && { color: C.muted }, (r === 'C' || r === 'TC') && { color: C.neon }]}>{r}</Text>
                        </View>
                      </View>
                    );
                  }) : <Text style={[s.small, { padding: 14, textAlign: 'center' }]}>حتى واحد فالدوري ما عندو هاد اللاعب.</Text>}
                </View>
              </>
            ) : null}

            {tab === 'prev' ? (
              !hist ? <ActivityIndicator style={{ padding: 30 }} color={C.pink} /> : hist.error ? <Text style={[s.small, { textAlign: 'center' }]}>ما قدرتش نجيب الإحصائيات.</Text> : (
                <View style={s.card}>
                  <View>
                    <View>
                      <View style={[s.tr, s.thRow, { gap: 0 }]}>
                        {cols.map(([l, w]) => <Text key={l} numberOfLines={1} style={[s.th, { width: w, textAlign: 'center' }]}>{l}</Text>)}
                      </View>
                      {shown.map(h => (
                        <View key={h.fixture} style={[s.tr, { gap: 0 }]}>
                          {[h.round, `${name(h.opponent_team)} ${h.was_home ? '(د)' : '(خ)'}`, h.minutes, h.total_points, h.goals_scored, h.assists, h.clean_sheets, h.defensive_contribution ?? 0, h.expected_goals, h.expected_assists].map((v, i) => (
                            <Text key={i} numberOfLines={1} style={[s.num, { width: cols[i][1], textAlign: 'center', fontSize: 13 }, i === 3 && s.bold]}>{v}</Text>
                          ))}
                        </View>
                      ))}
                      <View style={[s.tr, { gap: 0, backgroundColor: C.bg }]}>
                        {['', all ? 'المجموع' : 'آخر 5', sum('minutes'), sum('total_points'), sum('goals_scored'), sum('assists'), sum('clean_sheets'), sum('defensive_contribution'), sum('expected_goals').toFixed(2), sum('expected_assists').toFixed(2)].map((v, i) => (
                          <Text key={i} numberOfLines={1} style={[s.num, s.bold, { width: cols[i][1], textAlign: 'center', fontSize: 13 }]}>{v}</Text>
                        ))}
                      </View>
                    </View>
                  </View>
                  {history.length > 5 ? (
                    <TouchableOpacity onPress={() => setAll(!all)} style={{ padding: 12 }}>
                      <Text style={[s.small, { color: C.pitch2, fontWeight: '800', textAlign: 'center' }]}>{all ? 'غير آخر 5' : `عرض كاع الجولات (${history.length})`}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )
            ) : null}

            {tab === 'next' ? (
              !hist ? <ActivityIndicator style={{ padding: 30 }} color={C.pink} /> : hist.error ? <Text style={[s.small, { textAlign: 'center' }]}>ما قدرتش نجيب الماتشات.</Text> : (
                <View style={{ gap: 8 }}>
                  {(hist.fixtures || []).slice(0, 6).map(f => {
                    const [bg, fg] = FDR[f.difficulty] || FDR[3];
                    const opp = f.is_home ? f.team_a : f.team_h;
                    return (
                      <View key={f.id} style={s.nextRow}>
                        <Text style={s.nextGw}>GW{f.event ?? '–'}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.txt, s.bold]}>{name(opp)} <Text style={s.muted}>{f.is_home ? '(دار)' : '(خارج)'}</Text></Text>
                          <Text style={s.small}>{when(f.kickoff_time)}</Text>
                        </View>
                        <View style={[s.fdr, { backgroundColor: bg }]}><Text style={[s.fdrT, { color: fg }]}>{f.difficulty}</Text></View>
                      </View>
                    );
                  })}
                  <Text style={[s.small, { textAlign: 'center' }]}>الرقم = صعوبة الماتش (FDR) من 1 سهل حتى 5 صعيب</Text>
                </View>
              )
            ) : null}

            <View style={s.sheetGrid}>
              {[['المجموع', pl.total], ['الفورم', pl.form], ['ن/ماتش', pl.ppg], ['أهداف', pl.g], ['تمريرات', pl.a], ['xG / xA', pl.xg != null ? `${pl.xg} / ${pl.xa}` : '–']].map(([l, v]) => (
                <View key={l} style={s.sheetStat}><Text style={s.sheetStatN}>{v ?? '–'}</Text><Text style={s.sheetStatL}>{l}</Text></View>
              ))}
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function Pitch({ team, data, c }) {
  const [sel, setSel] = useState(null);
  const xi = team.picks.filter(p => p.position <= 11);
  const bench = team.picks.filter(p => p.position > 11);
  const line = t => xi.filter(p => (data.players[p.element] || {}).t === t);
  return (
    <View>
      <View style={s.pitch}>
        {[0, 1, 2, 3, 4, 5].map(i => <View key={i} style={[s.stripe, { top: `${i * 16.67}%`, backgroundColor: i % 2 ? C.grass1 : C.grass2 }]} />)}
        <View style={s.box} />
        <View style={s.halfLine} />
        <View style={s.circle} />
        {[1, 2, 3, 4].map(t => (
          <View key={t} style={s.lineRow}>
            {line(t).map(p => <Kit key={p.element} p={p} data={data} onPress={() => setSel(p)} />)}
          </View>
        ))}
      </View>
      <View style={s.benchRow}>
        {bench.map(p => <Kit key={p.element} p={p} data={data} bench={team.chip !== 'bboost'} onPress={() => setSel(p)} />)}
      </View>
      {sel ? <PlayerSheet p={sel} team={team} data={data} c={c} onClose={() => setSel(null)} /> : null}
    </View>
  );
}

function Player({ c, data, id, isMe, onLogout, onBack, staff, onSession, onStaffOut }) {
  const [staffOpen, setStaffOpen] = useState(false);
  const r = c.per[id];
  const gwList = r ? r.list.map(x => x.gw) : [];
  const [gw, setGw] = useState(c.showGw && gwList.includes(c.showGw) ? c.showGw : gwList[gwList.length - 1]);
  const [team, setTeam] = useState(null);
  const [tErr, setTErr] = useState(null);
  useEffect(() => {
    if (!gw) return;
    let alive = true;
    setTeam(null); setTErr(null);
    loadPicks(id, gw, data.players).then(t => alive && setTeam(t)).catch(() => alive && setTErr('ما قدرتش نجيب الفريق.'));
    return () => { alive = false; };
  }, [id, gw, data.players, data.fetchedAt]);
  if (!r) return null;
  const max = Math.max(1, ...r.list.map(x => x.p));
  const donk = new Set(r.donkeys);
  const g = r.m.gws[gw] || {};
  return (
    <>
      {onBack ? <TouchableOpacity onPress={onBack}><Text style={[s.txt, { color: C.pitch2, fontWeight: '700' }]}>→ رجوع</Text></TouchableOpacity> : null}
      <View style={s.hero}>
        <Text style={s.heroName}>{r.m.team}</Text>
        <Text style={s.heroSub}>{r.m.name} · ID {r.m.id}</Text>
        <View style={s.stats}>
          {/* F "فرقتي" l-ar9am dyalek kaynin f l-header lfo9: hna ghir dakchi li ma kaynch tmma. */}
          {!isMe ? <Stat n={'#' + r.rank} l="الترتيب" /> : null}
          {!isMe ? <Stat n={r.total} l="المجموع" /> : null}
          {!isMe ? <Stat n={'🐴' + r.donkeys.length} l="حمار" /> : null}
          <Stat n={r.pen.amount} l="كيخلص DH" />
        </View>
      </View>

      <Card>
        <GwNav list={gwList} gw={gw} setGw={setGw} />
        <View style={s.gwSum}>
          <View style={s.gwSumBox}><Text style={s.gwSumN}>{g.p ?? '–'}</Text><Text style={s.small}>النقاط</Text></View>
          <View style={s.gwSumBox}><Text style={s.gwSumN}>{g.h ? '−' + g.h : 0}</Text><Text style={s.small}>تبديلات</Text></View>
          <View style={s.gwSumBox}><Text style={s.gwSumN} numberOfLines={1}>{team && team.hist.rank ? fmtShort(team.hist.rank) : '–'}</Text><Text style={s.small}>ترتيب الجولة</Text></View>
        </View>
        {g.live ? (
          <Text style={[s.small, { textAlign: 'center', paddingBottom: 8, color: C.pink }]}>
            {'🔴 live'}{g.left ? ` · ⏳ باقي ${g.left} لاعبين` : ' · سالاو كاملين'}{g.prov ? ` · ★ +${g.prov} بونيس مؤقت` : ''}
          </Text>
        ) : null}
        {g.c ? <View style={{ alignItems: 'center', paddingBottom: 8 }}><Pill text={CHIPS[g.c]?.label} color={CHIPS[g.c]?.color} /></View> : null}
        {donk.has(gw) ? <Text style={[s.txt, { textAlign: 'center', color: C.donkey, paddingBottom: 8, fontWeight: '700' }]}>🐴 حمار هاد الجولة</Text> : null}
        {tErr ? <Text style={{ color: C.bad, padding: 14, textAlign: 'right' }}>{tErr}</Text> :
          !team ? <ActivityIndicator style={{ padding: 40 }} color={C.pink} /> : <Pitch team={team} data={data} c={c} />}
      </Card>

      <Card title="النقاط جولة بجولة" sub="البني = حمار · الذهبي = نجم">
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={s.bars}>
            {r.list.map(x => (
              <TouchableOpacity key={x.gw} style={s.barCol} onPress={() => setGw(x.gw)}>
                <Text style={s.barV}>{x.p}</Text>
                <View style={[s.bar, { height: 4 + 90 * (x.p / max), backgroundColor: donk.has(x.gw) ? C.donkey : r.wins.includes(x.gw) ? C.gold : C.pitch2 }, x.gw === gw && { borderWidth: 2, borderColor: C.pink }]} />
                <Text style={[s.barL, x.gw === gw && { color: C.pink, fontWeight: '700' }]}>{x.gw}</Text>
                <Text style={[s.barL, { color: x.c ? CHIPS[x.c]?.color : 'transparent', fontWeight: '700' }]}>{x.c ? CHIPS[x.c]?.short : '·'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </Card>

      <Card title="الخاصيات">
        {Object.keys(CHIPS).filter(k => k !== 'manager' || r.m.chips.some(ch => ch.name === k)).map(k => {
          const used = r.m.chips.filter(ch => ch.name === k);
          return <Row key={k} left={CHIPS[k].label} right={used.length ? used.map(u => 'GW' + u.gw).join('، ') : 'مازال'} color={used.length ? CHIPS[k].color : C.muted} />;
        })}
        <Row left="خسارة التبديلات" right={'−' + r.hits} />
        <Row left="نقاط ضايعة فالبنك" right={r.bench} />
      </Card>
      {isMe ? (
        <>
          <TouchableOpacity style={[s.btn, { backgroundColor: C.pink }]} onPress={onLogout}><Text style={s.btnT}>تسجيل الخروج</Text></TouchableOpacity>
          {staff ? <Text style={[s.small, { textAlign: 'center', color: C.pitch2 }]}>{staff === 'admin' ? 'متصل كمسؤول' : 'متصل كأمين المال'}</Text> : null}
        </>
      ) : null}
    </>
  );
}

/* ---------------- finance (Firebase Realtime Database, REST) ---------------- */
const fb = {
  enabled: () => !!(CONFIG.firebase.dbUrl && CONFIG.firebase.apiKey),
  async read(path) {
    const r = await fetch(`${CONFIG.firebase.dbUrl}/${path}.json`);
    if (!r.ok) throw new Error('read ' + r.status);
    return (await r.json()) || {};
  },
  async signIn(email, password) {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${CONFIG.firebase.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
    return { uid: j.localId, idToken: j.idToken, refreshToken: j.refreshToken, exp: Date.now() + (+j.expiresIn - 60) * 1000 };
  },
  async fresh(sess) {
    if (sess.exp > Date.now()) return sess;
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${CONFIG.firebase.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(sess.refreshToken),
    });
    const j = await r.json();
    if (!r.ok) throw new Error('session');
    return { uid: j.user_id, idToken: j.id_token, refreshToken: j.refresh_token, exp: Date.now() + (+j.expires_in - 60) * 1000 };
  },
  async write(sess, path, patch) {
    const r = await fetch(`${CONFIG.firebase.dbUrl}/${path}.json?auth=${sess.idToken}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, at: Date.now() }),
    });
    if (!r.ok) throw new Error(r.status === 401 ? 'ما عندكش الحق تبدل' : 'write ' + r.status);
  },
};

function StaffLogin({ onSession }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = async () => {
    setErr(null); setBusy(true);
    try { onSession(await fb.signIn(email.trim(), pw)); }
    catch (e) { setErr(authMsg(e)); }
    setBusy(false);
  };
  return (
    <Card title="دخول المسؤولين" sub="Brahim · Najib">
      <View style={{ padding: 14, gap: 10 }}>
        <TextInput style={[s.input, { fontSize: 15 }]} value={email} onChangeText={setEmail} placeholder="الإيميل" autoCapitalize="none" keyboardType="email-address" />
        <TextInput style={[s.input, { fontSize: 15 }]} value={pw} onChangeText={setPw} placeholder="كلمة السر" secureTextEntry />
        <TouchableOpacity style={s.btn} onPress={go} disabled={busy}><Text style={s.btnT}>{busy ? '…' : 'دخول'}</Text></TouchableOpacity>
        {err ? <Text style={{ color: C.bad, textAlign: 'right' }}>{err}</Text> : null}
      </View>
    </Card>
  );
}

const gwLabel = g => g.gws.length === 1 ? 'GW' + g.gws[0] : 'GW' + g.gws.join('-');
const kindLabel = { streak: '3 متتابعين', triple: '3 مرات', single: 'حمار' };

function Finance({ c, sess, setSess, meId }) {
  const [pay, setPay] = useState(null);
  const [outs, setOuts] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => {
    setErr(null);
    Promise.all([fb.read('payments'), fb.read('payouts')])
      .then(([p, o]) => { setPay(p); setOuts(o); })
      .catch(() => setErr('ما قدرتش نجيب الخلاص.'));
  }, []);
  useEffect(() => { if (fb.enabled()) load(); }, [load]);

  if (!fb.enabled()) {
    return <Card title="الخلاص"><Text style={[s.txt, { padding: 14 }]}>هاد الصفحة غادي تخدم ملي تتربط قاعدة البيانات.</Text></Card>;
  }

  const editing = !!sess && (sess.uid === CONFIG.staff.admin || sess.uid === CONFIG.staff.treasurer);

  const save = async (key, path, patch, apply) => {
    setBusy(key); setErr(null);
    try {
      const x = await fb.fresh(sess);
      if (x !== sess) setSess(x);
      await fb.write(x, path, patch);
      apply();
    } catch (e) {
      if (e.message === 'session') { setErr('عاود دخل.'); setSess(null); }
      else setErr(e.message.startsWith('ما عندك') ? 'هاد الحساب ما عندوش الحق يبدل الخلاص.' : 'ما تسجلش، عاود.');
    }
    setBusy(null);
  };

  // ---- incoming: fee + penalties computed from results ----
  const rows = c.table.map(r => {
    const p = (pay || {})[r.m.id] || {};
    const penMap = p.pen || {};
    const groups = r.pen.groups.map(g => {
      const paid = g.gws.reduce((t, gw) => t + (penMap[gw] || 0), 0);
      return { ...g, paid: Math.min(paid, g.amount), done: paid >= g.amount };
    });
    const paid = groups.reduce((t, g) => t + g.paid, 0);
    return { r, fee: !!p.fee, penMap, groups, owed: r.pen.amount, paid, left: r.pen.amount - paid };
  });
  const setGroup = (x, g, done) => {
    const pen = { ...x.penMap };
    g.gws.forEach(gw => { delete pen[gw]; });
    if (done) pen[g.gws[g.gws.length - 1]] = g.amount;
    const key = x.r.m.id + ':' + g.gws.join('-');
    save(key, `payments/${x.r.m.id}`, { pen }, () =>
      setPay(p => ({ ...(p || {}), [x.r.m.id]: { ...((p || {})[x.r.m.id] || {}), pen } })));
  };
  const setFee = (x, fee) => save(x.r.m.id + ':fee', `payments/${x.r.m.id}`, { fee }, () =>
    setPay(p => ({ ...(p || {}), [x.r.m.id]: { ...((p || {})[x.r.m.id] || {}), fee } })));

  // ---- outgoing: prizes and bonuses computed from results ----
  const name = id => c.per[id] ? c.per[id].m.name : '?';
  const bonusRec = c.record ? 100 : 0, bonusClean = c.clean.length * 100;
  const payouts = [
    ...[0, 1, 2].map(i => c.table[i] && {
      key: 'prize' + (i + 1), title: ['🥇 الأول', '🥈 الثاني', '🥉 الثالث'][i], to: c.table[i].m.id,
      amount: Math.round(c.pool * [0.5, 0.3, 0.2][i]), end: true,
    }),
    c.record && { key: 'record', title: 'أعلى سكور بلا خاصيات', to: c.record.ids[0], amount: 100, end: true, note: `${c.record.p} pts · GW${c.record.gw}` },
    ...c.clean.map(r => ({ key: 'clean-' + r.m.id, title: 'ما عمرو جا حمار', to: r.m.id, amount: 100, end: true })),
    { key: 'cup', title: '🏆 الكأس', toName: CONFIG.cupWinner || 'مازال ما تعرف', amount: c.fund - bonusRec - bonusClean, end: true },
  ].filter(Boolean);
  const setOut = (o, paid) => {
    const patch = paid ? { paid: true, amount: o.amount, to: o.to || 0 } : { paid: false, amount: 0, to: 0 };
    save('out:' + o.key, `payouts/${o.key}`, patch, () => setOuts(p => ({ ...(p || {}), [o.key]: patch })));
  };

  const feesIn = rows.filter(x => x.fee).length;
  const penIn = rows.reduce((t, x) => t + x.paid, 0);
  const penOwed = rows.reduce((t, x) => t + x.owed, 0);
  const paidOut = Object.values(outs || {}).reduce((t, o) => t + (o.paid ? o.amount || 0 : 0), 0);
  const cash = feesIn * CONFIG.fee + penIn - paidOut;

  if (!editing) {
    const me = rows.find(x => x.r.m.id === meId);
    if (!me) return null;
    const mine = payouts.filter(o => o.to === meId);
    const toPay = (me.fee ? 0 : CONFIG.fee) + Math.max(0, me.left);
    const toWin = mine.filter(o => !((outs || {})[o.key] || {}).paid).reduce((t, o) => t + o.amount, 0);
    return (
      <>
        <View style={s.hero}>
          <Text style={s.heroSub}>{me.r.m.name}</Text>
          <View style={s.stats}>
            <View style={s.stat}><Text style={[s.statN, { fontSize: 26, color: toPay ? C.pink : C.neon }]}>{toPay} DH</Text><Text style={[s.small, { color: '#d9c7dc' }]}>خاصك تخلص</Text></View>
            <View style={s.stat}><Text style={[s.statN, { fontSize: 26, color: C.neon }]}>{fmt(toWin)} DH</Text><Text style={[s.small, { color: '#d9c7dc' }]}>غادي تربح</Text></View>
          </View>
        </View>
        {pay === null && !err ? <ActivityIndicator color={C.pink} /> : null}
        {err ? <View style={s.err}><Text style={{ color: C.bad, textAlign: 'right' }}>{err}</Text></View> : null}
        <Card title="شنو خاصك تخلص">
          <View style={{ padding: 12, gap: 8 }}>
            <View style={s.item}>
              <Text style={[s.txt, { flex: 1 }]}>الانخراط · {CONFIG.fee} DH</Text>
              <Pill text={me.fee ? 'تخلص ✓' : 'مازال'} color={me.fee ? C.good : C.bad} />
            </View>
            {me.groups.map(g => (
              <View key={g.gws.join('-')} style={s.item}>
                <View style={{ flex: 1 }}>
                  <Text style={s.txt}>🐴 {gwLabel(g)} · <Text style={s.bold}>{g.amount} DH</Text></Text>
                  <Text style={s.small}>{kindLabel[g.kind]}{g.paid && !g.done ? ` · تخلص ${g.paid}، باقي ${g.amount - g.paid}` : ''}</Text>
                </View>
                <Pill text={g.done ? 'تخلص ✓' : 'مازال'} color={g.done ? C.good : C.bad} />
              </View>
            ))}
            {!me.groups.length ? <Text style={s.small}>حتى عقوبة. ما عمرو جيتي حمار 👏</Text> : null}
          </View>
        </Card>
        <Card title="شنو غادي تربح" sub="إلا وقف الموسم دابا">
          {mine.length ? mine.map(o => {
            const st = (outs || {})[o.key] || {};
            return (
              <View key={o.key} style={s.tr}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.txt, s.bold]}>{o.title} · {fmt(o.amount)} DH</Text>
                  {o.note ? <Text style={s.small}>{o.note}</Text> : null}
                </View>
                <Pill text={st.paid ? 'توصلتي ✓' : 'آخر الموسم'} color={st.paid ? C.good : C.silver} />
              </View>
            );
          }) : <Text style={[s.small, { padding: 14 }]}>حتى جائزة دابا. كمل وزيد 💪</Text>}
        </Card>
        <Text style={s.note}>كلشي محسوب من النتائج ديال FPL. أمين المال هو اللي كيسجل الخلاص.</Text>
      </>
    );
  }

  const Btn = ({ k, label, onPress, solid }) => (
    <TouchableOpacity style={[s.miniBtn, solid && { backgroundColor: C.pitch }]} disabled={!!busy} onPress={onPress}>
      {busy === k ? <ActivityIndicator size="small" color={solid ? '#fff' : C.pink} /> : <Text style={[s.miniBtnT, solid && { color: '#fff' }]}>{label}</Text>}
    </TouchableOpacity>
  );

  return (
    <>
      <View style={s.hero}>
        <Text style={s.heroSub}>الصندوق فاليد</Text>
        <Text style={[s.heroName, { fontSize: 32, color: C.neon }]}>{fmt(cash)} DH</Text>
        <View style={s.stats}>
          <Stat n={`${feesIn}/${rows.length}`} l="الانخراط" />
          <Stat n={`${fmt(penIn)}/${fmt(penOwed)}`} l="العقوبات" />
          <Stat n={fmt(paidOut)} l="تعطات" />
        </View>
      </View>

      {pay === null && !err ? <ActivityIndicator color={C.pink} /> : null}
      {err ? <View style={s.err}><Text style={{ color: C.bad, textAlign: 'right' }}>{err}</Text></View> : null}

      <Card title="المداخيل" sub={editing ? 'وضع التعديل' : 'دغط على لاعب'}>
        {rows.map(x => {
          const open = openId === x.r.m.id;
          return (
            <View key={x.r.m.id} style={{ borderBottomWidth: 1, borderColor: C.line }}>
              <TouchableOpacity style={[s.tr, { borderBottomWidth: 0 }]} onPress={() => setOpenId(open ? null : x.r.m.id)}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[s.txt, s.bold]} numberOfLines={1}>{x.r.m.name}</Text>
                  <View style={{ flexDirection: 'row-reverse', gap: 6, flexWrap: 'wrap' }}>
                    <Pill text={x.fee ? 'الانخراط ✓' : 'الانخراط ✗'} color={x.fee ? C.good : C.bad} />
                    {x.owed ? <Pill text={x.left > 0 ? `باقي ${x.left} DH` : 'العقوبات ✓'} color={x.left > 0 ? C.donkey : C.good} /> : null}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-start' }}>
                  <Text style={[s.num, s.bold]}>{x.paid}/{x.owed}</Text>
                  <Text style={s.small}>{open ? '▴' : '▾'}</Text>
                </View>
              </TouchableOpacity>
              {open ? (
                <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>
                  <View style={s.item}>
                    <Text style={[s.txt, { flex: 1 }]}>الانخراط · {CONFIG.fee} DH</Text>
                    {editing ? <Btn k={x.r.m.id + ':fee'} label={x.fee ? 'لغي' : 'خلص'} solid={!x.fee} onPress={() => setFee(x, !x.fee)} />
                      : <Text style={{ color: x.fee ? C.good : C.bad, fontWeight: '700' }}>{x.fee ? '✓' : '✗'}</Text>}
                  </View>
                  {x.groups.length ? x.groups.map(g => {
                    const k = x.r.m.id + ':' + g.gws.join('-');
                    return (
                      <View key={k} style={s.item}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.txt}>🐴 {gwLabel(g)} · <Text style={s.bold}>{g.amount} DH</Text></Text>
                          <Text style={s.small}>{kindLabel[g.kind]}{g.paid && !g.done ? ` · تخلص ${g.paid}، باقي ${g.amount - g.paid}` : ''}</Text>
                        </View>
                        {editing ? <Btn k={k} label={g.done ? 'لغي' : g.paid ? `كمل ${g.amount - g.paid}` : 'خلص'} solid={!g.done} onPress={() => setGroup(x, g, !g.done)} />
                          : <Text style={{ color: g.done ? C.good : C.bad, fontWeight: '700' }}>{g.done ? '✓' : '✗'}</Text>}
                      </View>
                    );
                  }) : <Text style={s.small}>حتى عقوبة. ما عمرو جا حمار 👏</Text>}
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>

      <Card title="المدفوعات" sub="الجوائز والبريمات">
        {payouts.map(o => {
          const st = (outs || {})[o.key] || {};
          return (
            <View key={o.key} style={s.tr}>
              <View style={{ flex: 1 }}>
                <Text style={[s.txt, s.bold]}>{o.title} · {fmt(o.amount)} DH</Text>
                <Text style={s.small}>{o.to ? name(o.to) : o.toName}{o.note ? ' · ' + o.note : ''}{o.end && !st.paid ? ' · آخر الموسم' : ''}</Text>
              </View>
              {editing ? <Btn k={'out:' + o.key} label={st.paid ? 'لغي' : 'تعطات'} solid={!st.paid} onPress={() => setOut(o, !st.paid)} />
                : <Pill text={st.paid ? 'تعطات ✓' : 'مازال'} color={st.paid ? C.good : C.silver} />}
            </View>
          );
        })}
      </Card>
      <Text style={s.note}>كلشي محسوب من النتائج: إلا تبدل الترتيب ولا جات جولة جديدة، المبالغ كيتحسبو بوحدهم. إلا كان واحد خلص 10 ومن بعد كملو 3 مرات، كيبان ليه غير الباقي.</Text>

      <TouchableOpacity onPress={load}><Text style={[s.small, { textAlign: 'center' }]}>تحديث الخلاص ↻</Text></TouchableOpacity>
    </>
  );
}

function Fund({ c, refreshControl }) {
  const name = id => c.per[id].m.name;
  const bonusRec = c.record ? 100 : 0;
  const bonusClean = c.clean.length * 100;
  const cup = c.fund - bonusRec - bonusClean;
  return (
    <Sections
      refreshControl={refreshControl}
      sections={[
        {
          title: 'الانخراطات', sub: `${c.table.length} × ${CONFIG.fee} DH`,
          body: (
            <>
              <Row left="🥇 الأول (50%)" right={fmt(c.pool * 0.5)} />
              <Row left="🥈 الثاني (30%)" right={fmt(c.pool * 0.3)} />
              <Row left="🥉 الثالث (20%)" right={fmt(c.pool * 0.2)} />
              <Row left="المجموع" right={fmt(c.pool)} strong />
            </>
          ),
        },
        {
          title: 'صندوق الحمير', sub: c.gws.length ? `حتى لـ GW${c.gws[c.gws.length - 1]}` : '',
          body: (
            <>
              <Row left="العقوبات المجموعة" right={fmt(c.fund)} />
              <Row left={'أعلى سكور بلا خاصيات\n' + (c.record ? `${c.record.ids.map(name).join('، ')} · ${c.record.p} pts (GW${c.record.gw})` : '—')} right={'−' + bonusRec} />
              <Row left={'ما عمرو جا حمار\n' + (c.clean.length ? c.clean.map(r => r.m.name).join('، ') : 'حتى واحد')} right={'−' + fmt(bonusClean)} />
              <Row left={'🏆 الباقي للكأس' + (CONFIG.cupWinner ? ' · ' + CONFIG.cupWinner : '')} right={fmt(cup)} strong color={cup < 0 ? C.bad : C.good} />
            </>
          ),
        },
      ]}
      footer={<Text style={s.note}>البريمات كتعطى فآخر الموسم. هاد الحساب كيبين شكون غادي يربح إلا وقف الموسم دابا.</Text>}
    />
  );
}

function Rules() {
  const blocks = [
    ['1. الانخراط 💰', [`${CONFIG.fee} درهم لكل لاعب.`, 'المجموع كيتقسم على الثلاثة الأوائل: 50% / 30% / 20%.']],
    ['2. حمار الجولة 🐴', ['صاحب أقل نقاط فالجولة (بعد خصم التبديلات). كل جولة كاين حمار واحد فقط.', 'إلا تعادلو فالنقاط، الحمار هو اللي عندو أقل مجموع عام.', 'كيحط صورة الحمار فالبروفيل طول الجولة.']],
    ['3. العقوبات ⚠️', ['كل جولة حمار: 10 دراهم.', '3 مرات حمار: 50 درهم بلاصة 3 × 10.', '3 مرات متتابعين: 70 درهم بلاصة 3 × 10.']],
    ['4. البريمات 🎯', ['أعلى سكور فجولة وحدة فالموسم، بلا خاصيات: 100 درهم (لاعب واحد، مرة وحدة).', 'اللي ما عمرو جا حمار طول الموسم: 100 درهم.']],
    ['5. الكأس 🏆', ['الفائز بالكأس كيربح الباقي كامل من الصندوق.']],
  ];
  return (
    <Card>
      <View style={{ padding: 14, gap: 14 }}>
        {blocks.map(([t, items]) => (
          <View key={t}>
            <Text style={[s.txt, s.bold, { marginBottom: 4 }]}>{t}</Text>
            {items.map(x => <Text key={x} style={s.txt}>• {x}</Text>)}
          </View>
        ))}
      </View>
    </Card>
  );
}

function Admin({ c, data }) {
  return (
    <>
      <Card title="إعدادات الدوري" sub="غير ليك">
        <Row left="League ID" right={CONFIG.leagueId} />
        <Row left="ثمن الانخراط" right={CONFIG.fee + ' DH'} />
        <Row left="الدوري بدا من" right={'GW' + CONFIG.startGw} />
        <Row left="اللاعبين فالرهان" right={CONFIG.participants.length ? CONFIG.participants.length : 'الكل (' + c.table.length + ')'} />
        <Row left="الفائز بالكأس" right={CONFIG.cupWinner || '—'} />
      </Card>
      <Card title="IDs ديال اللاعبين">
        {c.table.map(r => <Row key={r.m.id} left={r.m.name + ' · ' + r.m.team} right={r.m.id} />)}
      </Card>
      <Text style={s.note}>هاد الإعدادات مكتوبة فالكود (CONFIG) باش تكون نفسها عند كاع اللاعبين. باش تبدلها، قول لـ Claude شنو بغيتي.</Text>
      <Text style={[s.small, { textAlign: 'center' }]}>آخر تحديث: {new Date(data.fetchedAt).toLocaleString('fr-MA')}</Text>
    </>
  );
}

/* ---------------- app ---------------- */
export default function App() {
  const [data, setData] = useState(null);
  const [meId, setMeId] = useState(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('table');
  const [viewId, setViewId] = useState(null);
  const [menu, setMenu] = useState(false);
  const [sess, setSessState] = useState(null);
  const setSess = x => { setSessState(x); if (x) AsyncStorage.setItem('fb:sess', JSON.stringify(x)).catch(() => {}); else AsyncStorage.removeItem('fb:sess').catch(() => {}); };

  // silent: actualisation automatique, bla spinner.
  const refresh = useCallback(async (silent) => {
    if (silent !== true) setLoading(true);
    setError(null);
    try {
      const d = await loadLeague();
      setData(d);
      const { players, ...light } = d;
      AsyncStorage.setItem('fpl:data', JSON.stringify(light)).catch(() => {});
    } catch (e) {
      if (silent === true) return; // l-actualisation automatique tfashlat: kanb9aw b les données l-9dima
      setError('ما قدرتش نجيب المعطيات. تأكد من الأنترنيت وسحب للأسفل.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await AsyncStorage.getItem('fpl:me');
        if (me) setMeId(parseInt(me, 10));
        const fs = await AsyncStorage.getItem('fb:sess');
        if (fs) setSessState(JSON.parse(fs));
        const cached = await AsyncStorage.getItem('fpl:data');
        if (cached) setData({ players: {}, teams: {}, ...JSON.parse(cached) });
      } catch {}
      setReady(true);
      refresh();
    })();
  }, [refresh]);

  // Web: ila tla3t nouskha jdida dyal l-site, l-page kat3awed tcharja bo7dha (mli kat-rja3 l l-app
  // wla kol 5 d9aye9). Bla hadchi, l-onglet wla l-icône f l'écran d'accueil kayb9aw f nouskha 9dima.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const bundle = s => (s.match(/\/_expo\/static\/js\/web\/entry-[^"'\s]+?\.js/) || [])[0];
    const mine = bundle([...document.scripts].map(x => x.src).join(' '));
    if (!mine) return;
    const check = () => fetch('/', { cache: 'no-store' }).then(r => r.text()).then(html => {
      const live = bundle(html);
      if (live && live !== mine) window.location.reload();
    }).catch(() => {});
    const onShow = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onShow);
    const t = setInterval(check, 2 * 60000);
    return () => { document.removeEventListener('visibilitychange', onShow); clearInterval(t); };
  }, []);

  // Tajdid otomatiki dyal kolchi: wast l-jawla kol d9i9a (bach nchoufo nihayat akhir match dghya),
  // mn b3d ma tsali w FPL mazal ma 2akkdat l-bonus kol 5 d9aye9, w ila ma kayn walo kanstennaw
  // l-deadline dyal l-jawla l-jaya. W kol mra katrja3 l l-app (wla l-onglet) kan-tjeddou.
  const liveNow = !!(data && data.current && !data.finished.includes(data.current));
  const pending = !!(data && data.pending);
  const nextDeadline = data && data.nextDeadline;
  useEffect(() => {
    if (liveNow || pending) {
      const t = setInterval(() => refresh(true), liveNow ? 60000 : 5 * 60000);
      return () => clearInterval(t);
    }
    if (!nextDeadline) return;
    const wait = nextDeadline + 60000 - Date.now();
    if (wait <= 0 || wait > 2 ** 31 - 1) return;
    const t = setTimeout(() => refresh(true), wait);
    return () => clearTimeout(t);
  }, [liveNow, pending, nextDeadline, refresh]);
  const fetchedAt = data && data.fetchedAt;
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => {
      if (st === 'active' && (!fetchedAt || Date.now() - Date.parse(fetchedAt) > 2 * 60000)) refresh(true);
    });
    return () => sub.remove();
  }, [fetchedAt, refresh]);

  const login = (id, x) => { if (x) setSess(x); setMeId(id); setTab('table'); AsyncStorage.setItem('fpl:me', String(id)).catch(() => {}); };
  const logout = () => { setMeId(null); setViewId(null); setSess(null); AsyncStorage.removeItem('fpl:me').catch(() => {}); };
  const open = id => { setViewId(id === meId ? null : id); if (id === meId) setTab('me'); };

  const c = useMemo(() => compute(data), [data]);
  const isAdmin = !!sess && sess.uid === CONFIG.staff.admin;
  const isStaff = isAdmin || (!!sess && sess.uid === CONFIG.staff.treasurer);
  const tabs = [['table', 'الترتيب', '🏆'], ['matches', 'الماتشات', '🏟️'], ['hmar', 'الحمار', '🐴'], ['stats', 'إحصائيات', '📊'], ['scout', 'الكشافة', '🔭'], ['me', 'فرقتي', '⚽'], ['fund', 'الصندوق', '💰'], ['pay', isStaff ? 'الخلاص' : 'حسابي', '💳'], ['rules', 'القانون', '📜']];
  if (isAdmin) tabs.push(['admin', 'الإدارة', '⚙️']);
  const me = c && meId ? c.per[meId] : null;
  const pullToRefresh = <RefreshControl refreshing={loading} onRefresh={() => refresh()} />;
  const pageTitle = viewId ? 'فريق لاعب' : (tabs.find(x => x[0] === tab) || [])[1] || '';

  if (!ready) return <View style={{ flex: 1, backgroundColor: C.pitch }} />;
  const locked = meId && CONFIG.protectedIds[meId] && (!sess || sess.uid !== CONFIG.protectedIds[meId]);
  const known = meId && !locked && data && data.managers.some(m => m.id === meId);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.pitch }}>
      <StatusBar barStyle="light-content" backgroundColor={C.pitch} />
      {!known ? (
        <Login data={data} onLogin={login} loading={loading} error={error} />
      ) : (
        <>
          {/* L-header (smiya + l-ar9am dyalek) ghir f "فرقتي"; l-pages l-khrin bla header. */}
          {tab === 'me' && !viewId ? (
          <View style={s.header}>
            <View style={s.topBar}>
              <TouchableOpacity onPress={() => { setTab('me'); setViewId(null); }} style={{ flex: 1 }}>
                <Text style={s.meName} numberOfLines={1}>{me ? me.m.name : ''}</Text>
                <Text style={s.eyebrow} numberOfLines={1}>{me ? me.m.team : ''} · {pageTitle}</Text>
              </TouchableOpacity>
            </View>
            {me ? (
              <View style={s.kpis}>
                <View style={s.kpi}><Text style={s.kpiN}>#{me.rank}</Text><Text style={s.kpiL}>الترتيب</Text></View>
                <View style={s.kpi}>
                  <Text style={s.kpiN}>{me.last ?? '–'}</Text>
                  <Text style={s.kpiL}>{c.liveGw ? '🔴 ' : ''}{c.showGw ? 'GW' + c.showGw : 'الجولة'}</Text>
                </View>
                <View style={s.kpi}><Text style={s.kpiN}>{me.total}</Text><Text style={s.kpiL}>المجموع</Text></View>
                <View style={s.kpi}><Text style={s.kpiN}>🐴{me.donkeys.length}</Text><Text style={s.kpiL}>حمار</Text></View>
              </View>
            ) : null}
          </View>
          ) : null}
          <Modal visible={menu} transparent animationType="slide" onRequestClose={() => setMenu(false)}>
            <TouchableOpacity activeOpacity={1} style={s.drawerShade} onPress={() => setMenu(false)}>
              <TouchableOpacity activeOpacity={1} style={s.drawer} onPress={() => {}}>
                <Text style={s.drawerTitle}>{data.leagueName}</Text>
                <Text style={[s.small, { color: '#d9c7dc', textAlign: 'right', marginBottom: 12 }]}>
                  {c.showGw ? `GW${c.showGw}${c.liveGw ? ' · live' : ''} · ` : ''}{fmt(c.pool)} DH انخراطات · {fmt(c.fund)} DH صندوق
                </Text>
                {tabs.map(([k, l, icon]) => {
                  const on = tab === k && !viewId;
                  return (
                    <TouchableOpacity key={k} onPress={() => { setTab(k); setViewId(null); setMenu(false); }} style={[s.drawerItem, on && s.drawerItemOn]}>
                      <Text style={s.drawerIcon}>{icon}</Text>
                      <Text style={[s.drawerT, on && { color: C.pitch }]}>{l}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity onPress={() => { setMenu(false); logout(); }} style={[s.drawerItem, { marginTop: 8 }]} accessibilityLabel="تسجيل الخروج">
                  <Text style={s.drawerIcon}>⎋</Text>
                  <Text style={s.drawerT}>تسجيل الخروج</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
          {!viewId && ['table', 'matches', 'hmar', 'stats', 'scout', 'fund'].includes(tab) ? (
            // Had les pages 3ndhom scroll dyalhom: l-entêtes dyal les jadawel kayb9aw tabtin.
            <View style={{ flex: 1, backgroundColor: C.bg }}>
              {error ? <View style={[s.err, { margin: 14, marginBottom: 0 }]}><Text style={{ color: C.bad, textAlign: 'right' }}>{error}</Text></View> : null}
              {tab === 'table' ? <Classement c={c} data={data} meId={meId} open={open} refreshControl={pullToRefresh} /> :
               tab === 'scout' ? <Scout c={c} data={data} meId={meId} refreshControl={pullToRefresh} /> :
               tab === 'matches' ? <Matches data={data} meId={meId} refreshControl={pullToRefresh} /> :
               tab === 'hmar' ? <Hmar c={c} open={open} refreshControl={pullToRefresh} /> :
               tab === 'stats' ? <Stats c={c} data={data} meId={meId} open={open} refreshControl={pullToRefresh} /> :
               <Fund c={c} refreshControl={pullToRefresh} />}
            </View>
          ) : (
          <ScrollView
            style={{ flex: 1, backgroundColor: C.bg }}
            contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={() => refresh()} />}
          >
            {error ? <View style={s.err}><Text style={{ color: C.bad, textAlign: 'right' }}>{error}</Text></View> : null}
            {viewId ? <Player key={viewId} c={c} data={data} id={viewId} onBack={() => setViewId(null)} /> :
             tab === 'me' ? <Player key={meId} c={c} data={data} id={meId} isMe onLogout={logout} staff={sess ? (isAdmin ? 'admin' : sess.uid === CONFIG.staff.treasurer ? 'treasurer' : 'other') : null} onSession={setSess} onStaffOut={() => (CONFIG.protectedIds[meId] ? logout() : setSess(null))} /> :
             tab === 'pay' ? <Finance c={c} sess={sess} setSess={setSess} meId={meId} /> :
             tab === 'admin' && isAdmin ? <Admin c={c} data={data} /> :
             <Rules />}
            <Text style={[s.small, { textAlign: 'center' }]}>سحب للأسفل باش تحدث</Text>
          </ScrollView>
          )}
          {/* L-bar dyal l-te7t b7al FPL: les pages l-mohimmin, w "المزيد" fiha kolchi. */}
          <View style={s.bottomNav}>
            {[['table', 'الترتيب', '🏆'], ['me', 'فرقتي', '⚽'], ['matches', 'الماتشات', '🏟️'], ['hmar', 'الحمار', '🐴'], ['stats', 'إحصائيات', '📊']].map(([k, l, icon]) => {
              const on = tab === k && !viewId;
              return (
                <TouchableOpacity key={k} onPress={() => { setTab(k); setViewId(null); }} style={s.bottomItem} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                  <View style={[s.bottomIconWrap, on && s.bottomIconOn]}><Text style={s.bottomIcon}>{icon}</Text></View>
                  <Text style={[s.bottomT, on && s.bottomTOn]}>{l}</Text>
                </TouchableOpacity>
              );
            })}
            {(() => {
              const on = !viewId && !['table', 'me', 'matches', 'hmar', 'stats'].includes(tab);
              return (
                <TouchableOpacity onPress={() => setMenu(true)} style={s.bottomItem} accessibilityLabel="المزيد">
                  <View style={[s.bottomIconWrap, on && s.bottomIconOn]}><Text style={[s.bottomIcon, { color: on ? C.pitch : '#fff' }]}>☰</Text></View>
                  <Text style={[s.bottomT, on && s.bottomTOn]}>المزيد</Text>
                </TouchableOpacity>
              );
            })()}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  h1: { color: '#fff', fontSize: 28, fontWeight: '900', textAlign: 'right', marginVertical: 8, letterSpacing: -0.5 },
  header: { backgroundColor: C.pitch, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 3, borderColor: C.pink, gap: 10 },
  topBar: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  menuBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  menuIcon: { color: '#fff', fontSize: 22, fontWeight: '700' },
  meName: { color: '#fff', fontSize: 19, fontWeight: '900', textAlign: 'right' },
  eyebrow: { color: C.cyan, fontSize: 12, fontWeight: '600', textAlign: 'right' },
  kpis: { flexDirection: 'row-reverse', gap: 6 },
  kpi: { flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8, borderTopWidth: 2, borderColor: C.neon },
  kpiN: { color: '#fff', fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'], textAlign: 'right' },
  kpiL: { color: '#d9c7dc', fontSize: 10, textAlign: 'right' },
  drawerShade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  drawer: { width: '100%', backgroundColor: C.pitch, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 18, paddingHorizontal: 14, paddingBottom: 28, gap: 4 },
  bottomNav: { flexDirection: 'row-reverse', backgroundColor: C.pitch, borderTopWidth: 3, borderColor: C.pink, paddingTop: 6, paddingBottom: 8 },
  bottomItem: { flex: 1, alignItems: 'center', gap: 2 },
  bottomIconWrap: { width: 52, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bottomIconOn: { backgroundColor: C.neon },
  bottomIcon: { fontSize: 17, color: '#fff' },
  bottomT: { color: '#d9c7dc', fontSize: 11, fontWeight: '700' },
  bottomTOn: { color: '#fff' },
  drawerTitle: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'right' },
  drawerItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12 },
  drawerItemOn: { backgroundColor: C.neon },
  drawerIcon: { fontSize: 18, width: 26, textAlign: 'center', color: '#fff' },
  drawerT: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'right' },
  fixedPage: { flex: 1, padding: 14, gap: 14 },
  secHeadWeb: { position: 'sticky', top: 0, zIndex: 2 },
  secHead: { backgroundColor: C.card, borderTopLeftRadius: 12, borderTopRightRadius: 12, overflow: 'hidden', borderBottomWidth: 1, borderColor: C.line },
  secBody: { backgroundColor: C.card, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, overflow: 'hidden', marginBottom: 14 },
  secAlone: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  fixedCard: { flex: 1 },
  card: { backgroundColor: C.card, borderRadius: 12, overflow: 'hidden', shadowColor: '#37003c', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardH: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'baseline', padding: 12, borderBottomWidth: 1, borderColor: C.line },
  h2: { fontSize: 18, fontWeight: '800', color: C.pitch, textAlign: 'right' },
  txt: { fontSize: 14, color: C.ink, textAlign: 'right', writingDirection: 'rtl' },
  muted: { fontSize: 12, color: C.muted },
  small: { fontSize: 12, color: C.muted, textAlign: 'right' },
  bold: { fontWeight: '700' },
  num: { fontSize: 14, color: C.ink, fontVariant: ['tabular-nums'] },
  fxMinis: { flexDirection: 'row-reverse', marginTop: 6 },
  fxMiniSide: { flex: 1, gap: 4, flexWrap: 'wrap' },
  mini: { width: 44, alignItems: 'center' },
  miniPhotoWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#efe6f3', overflow: 'visible', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#953bff' },
  miniPhoto: { width: 28, height: 28, borderRadius: 14 },
  miniInit: { fontSize: 10, fontWeight: '900', color: C.pitch },
  miniBadge: { position: 'absolute', top: -4, right: -6, minWidth: 14, height: 14, paddingHorizontal: 2, borderRadius: 7, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  miniBadgeT: { color: '#fff', fontSize: 8, fontWeight: '900' },
  miniName: { fontSize: 9, fontWeight: '800', color: '#953bff', marginTop: 1, maxWidth: 44 },
  fxMine: { backgroundColor: '#f3e8ff', borderRadius: 6, paddingHorizontal: 4 },
  fxMineT: { color: '#7a1fe0', fontWeight: '900' },
  miniPts: { marginTop: 2, minWidth: 22, paddingHorizontal: 5, height: 16, borderRadius: 8, backgroundColor: C.pitch, alignItems: 'center', justifyContent: 'center' },
  miniPtsT: { color: '#fff', fontSize: 10, fontWeight: '900' },
  fxDay: { fontSize: 13, fontWeight: '900', color: C.pitch, textAlign: 'right', marginTop: 6, paddingHorizontal: 4 },
  fxCard: { backgroundColor: C.card, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: C.line },
  fxCardLive: { borderColor: C.pink, borderWidth: 2 },
  fxRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  fxTeam: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  fxTeamT: { flex: 1, fontSize: 13, fontWeight: '800', color: C.ink, textAlign: 'right' },
  fxBadge: { width: 30, height: 30 },
  fxBadgeAlt: { borderRadius: 15, backgroundColor: C.pitch, alignItems: 'center', justifyContent: 'center' },
  fxBadgeT: { color: '#fff', fontSize: 9, fontWeight: '900' },
  fxMid: { alignItems: 'center', minWidth: 74 },
  fxScore: { backgroundColor: C.pitch, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, minWidth: 64, alignItems: 'center' },
  fxScoreT: { color: '#fff', fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'], writingDirection: 'ltr' },
  fxState: { fontSize: 10, fontWeight: '800', color: C.muted, marginTop: 3 },
  fxMore: { fontSize: 11, color: C.pink, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  fxDetail: { marginTop: 8, borderTopWidth: 1, borderColor: C.line, paddingTop: 8, gap: 10 },
  fxEv: { gap: 4 },
  fxEvLabel: { fontSize: 12, fontWeight: '900', color: C.pitch, textAlign: 'center', backgroundColor: C.bg, borderRadius: 6, paddingVertical: 3 },
  fxEvCols: { flexDirection: 'row-reverse', gap: 8 },
  fxEvSep: { width: 1, backgroundColor: C.line },
  fxEvRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingVertical: 1 },
  fxEvName: { fontSize: 13, color: C.ink, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  fxOwn: { fontSize: 10, color: C.muted, fontWeight: '700' },
  fxBonusRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 2 },
  fxBonusN: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  fxBonusNT: { color: '#fff', fontSize: 11, fontWeight: '900' },
  fxBpsBar: { width: 70, height: 6, borderRadius: 3, backgroundColor: C.bg, overflow: 'hidden', flexDirection: 'row-reverse' },
  fxBpsFill: { height: 6, backgroundColor: '#953bff', borderRadius: 3 },
  tTabs: { flexDirection: 'row-reverse', backgroundColor: C.pitch, borderRadius: 14, padding: 4, gap: 4 },
  tTab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tTabOn: { backgroundColor: C.neon },
  tTabT: { color: '#d9c7dc', fontSize: 13, fontWeight: '800' },
  tTabTOn: { color: C.pitch },
  tHero: { backgroundColor: C.pitch, borderRadius: 16, padding: 14, gap: 10 },
  tHeroK: { color: C.cyan, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  tHeroBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, borderTopWidth: 2, borderColor: C.neon },
  tHeroN: { color: '#fff', fontSize: 18, fontWeight: '900', textAlign: 'right', fontVariant: ['tabular-nums'] },
  tHeroL: { color: '#d9c7dc', fontSize: 11, textAlign: 'right' },
  tHeroSub: { color: '#d9c7dc', fontSize: 12, textAlign: 'right' },
  tInOut: { flexDirection: 'row-reverse', gap: 8 },
  tIO: { flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: C.line },
  tIOT: { fontSize: 13, fontWeight: '900', color: C.ink },
  tCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  tRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: C.line },
  tRowMine: { backgroundColor: '#faf5ff' },
  tRank: { width: 18, textAlign: 'center', fontSize: 12, fontWeight: '900', color: C.muted },
  tName: { fontSize: 14, fontWeight: '900', color: C.ink, textAlign: 'right', flexShrink: 1 },
  tBarTrack: { height: 6, borderRadius: 3, backgroundColor: C.bg, overflow: 'hidden', flexDirection: 'row-reverse' },
  tBar: { height: 6, borderRadius: 3 },
  tWho: { fontSize: 11, color: C.muted, textAlign: 'right' },
  tVal: { fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  tSection: { fontSize: 16, fontWeight: '900', color: C.pitch, textAlign: 'right', marginTop: 6 },
  tCount: { borderRadius: 999, backgroundColor: C.bg, paddingHorizontal: 8, paddingVertical: 2 },
  tCountT: { fontSize: 11, fontWeight: '900', color: C.pitch },
  tSwap: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, paddingHorizontal: 10 },
  tSide: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 6, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 6 },
  tSideN: { fontSize: 12, fontWeight: '900', textAlign: 'right' },
  tSideP: { fontSize: 10, color: C.muted, textAlign: 'right' },
  tArrow: { fontSize: 14, color: C.muted, fontWeight: '900' },
  fBar: { flexDirection: 'row-reverse', gap: 8, alignItems: 'center' },
  fSearchWrap: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 12, borderWidth: 1, borderColor: C.line, height: 46 },
  fSearch: { flex: 1, fontSize: 15, color: C.ink, textAlign: 'right', height: 44, outlineStyle: 'none' },
  fClear: { fontSize: 14, color: C.muted, fontWeight: '900', padding: 4 },
  fIconBtn: { width: 46, height: 46, borderRadius: 14, backgroundColor: C.pitch, alignItems: 'center', justifyContent: 'center' },
  fIcon: { fontSize: 20 },
  fBadge: { position: 'absolute', top: -5, left: -5, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.pink, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.bg },
  fBadgeT: { color: '#fff', fontSize: 10, fontWeight: '900' },
  fSortRow: { flexDirection: 'row-reverse', gap: 8 },
  fDirBtn: { borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, justifyContent: 'center' },
  fDirT: { fontSize: 12, fontWeight: '900', color: C.pink },
  fSummary: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  fSummaryN: { fontSize: 13, fontWeight: '900', color: C.pitch },
  fTag: { backgroundColor: '#f3e8ff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  fTagT: { fontSize: 11, fontWeight: '800', color: '#7a1fe0' },
  dd: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, height: 42 },
  ddL: { fontSize: 12, color: C.muted, fontWeight: '700' },
  ddV: { flex: 1, fontSize: 14, color: C.ink, fontWeight: '900', textAlign: 'right' },
  ddCaret: { fontSize: 14, color: C.pink, fontWeight: '900' },
  fSheet: { backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, gap: 12, paddingBottom: 24 },
  fGrab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#d4cbd6' },
  fReset: { color: C.pink, fontWeight: '800', fontSize: 13 },
  fLabel: { fontSize: 13, fontWeight: '900', color: C.pitch, textAlign: 'right' },
  fSeg: { flexDirection: 'row-reverse', backgroundColor: '#fff', borderRadius: 12, padding: 3, gap: 3, borderWidth: 1, borderColor: C.line },
  fSegBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  fSegT: { fontSize: 12, fontWeight: '900', color: C.muted },
  stepWrap: { flex: 1, gap: 4 },
  stepL: { fontSize: 11, color: C.muted, textAlign: 'right', fontWeight: '700' },
  step: { flexDirection: 'row-reverse', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.line, overflow: 'hidden', height: 42 },
  stepBtn: { width: 40, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f6f2f7' },
  stepBtnT: { fontSize: 20, fontWeight: '900', color: C.pitch },
  stepV: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '900', color: C.ink, fontVariant: ['tabular-nums'], writingDirection: 'ltr' },
  fToggles: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12 },
  togRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line },
  fApply: { backgroundColor: C.pink, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  fApplyT: { color: '#fff', fontSize: 15, fontWeight: '900' },
  scBar: { gap: 8 },
  scLock: { marginHorizontal: 12, marginBottom: 6, padding: 10, borderRadius: 12, backgroundColor: '#fff4e5', borderWidth: 1, borderColor: '#ffd8a3' },
  scLockT: { fontSize: 12, color: '#9a5b00', fontWeight: '700', textAlign: 'right', lineHeight: 18 },
  scChips: { gap: 6, flexDirection: 'row', paddingVertical: 2 },
  sortChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line },
  sortChipOn: { backgroundColor: C.pink, borderColor: C.pink },
  sortChipT: { fontSize: 12, fontWeight: '800', color: C.ink },
  scCard: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 10, borderWidth: 1, borderColor: C.line },
  scCardMine: { borderColor: '#953bff', borderWidth: 2, backgroundColor: '#faf5ff' },
  scRank: { width: 22, textAlign: 'center', fontSize: 12, fontWeight: '900', color: C.muted },
  scPhoto: { backgroundColor: '#efe6f3', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  scMineDot: { position: 'absolute', bottom: -2, left: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: '#953bff', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  scMineDotT: { color: '#fff', fontSize: 9, fontWeight: '900' },
  scName: { fontSize: 15, fontWeight: '900', color: C.ink, textAlign: 'right', flexShrink: 1 },
  scPos: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  scPosT: { fontSize: 9, fontWeight: '900' },
  scTeam: { fontSize: 11, fontWeight: '800', color: C.muted },
  scPrice: { fontSize: 11, fontWeight: '800', color: C.pitch },
  scMineTag: { borderRadius: 999, backgroundColor: '#953bff', paddingHorizontal: 7, paddingVertical: 1 },
  scMineTagT: { color: '#fff', fontSize: 10, fontWeight: '900' },
  scSub: { fontSize: 11, color: C.muted, textAlign: 'right' },
  scBig: { minWidth: 62, alignItems: 'center', backgroundColor: C.pitch, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 6 },
  scBigN: { color: '#fff', fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  scBigL: { color: C.neon, fontSize: 9, fontWeight: '800', maxWidth: 70 },
  moreBtn: { margin: 12, padding: 12, borderRadius: 12, backgroundColor: C.bg, alignItems: 'center' },
  moreBtnT: { color: C.pitch, fontWeight: '800', fontSize: 13 },
  chipBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line },
  chipOn: { backgroundColor: C.pitch, borderColor: C.pitch },
  chipT: { fontSize: 12, fontWeight: '800', color: C.pitch },
  search: { backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.ink, textAlign: 'right', borderWidth: 1, borderColor: C.line },
  scHead: { fontSize: 13, fontWeight: '900', color: C.pitch, textAlign: 'right', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  scLine: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 7, borderBottomWidth: 1, borderColor: C.line },
  scMgr: { paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderColor: C.line, gap: 4 },
  scSwap: { flexDirection: 'row-reverse', gap: 12, flexWrap: 'wrap' },
  gridRow: { flexDirection: 'row-reverse' },
  gridHeadRow: { backgroundColor: C.bg, borderBottomWidth: 1, borderColor: C.line, marginTop: 6 },
  gridName: { width: 150, borderLeftWidth: 1, borderColor: C.line },
  gridNameCell: { height: GRID_ROW, flexDirection: 'row-reverse', alignItems: 'center', gap: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: C.line },
  gridCells: { height: GRID_ROW, flexDirection: 'row-reverse', borderBottomWidth: 1, borderColor: C.line },
  gridCell: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  gridCellOn: { backgroundColor: 'rgba(233,0,82,0.06)' },
  gridAlt: { backgroundColor: '#faf8fb' },
  gridH: { height: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  gridHOn: { backgroundColor: 'rgba(233,0,82,0.08)', borderBottomWidth: 2, borderColor: C.pink },
  gridHT: { fontSize: 11, color: C.muted, fontWeight: '800', textAlign: 'center' },
  gridArrow: { fontSize: 9, color: '#c4bcc6', marginTop: 1 },
  gridNum: { fontSize: 14, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },
  gridDim: { fontSize: 13, color: '#c4bcc6' },
  colN: { width: 58, textAlign: 'left' },
  tr: { flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: C.line, gap: 6 },
  thRow: { paddingVertical: 6, backgroundColor: C.bg },
  th: { fontSize: 12, color: C.muted, textAlign: 'right', fontWeight: '600' },
  rk: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.line, alignItems: 'center', justifyContent: 'center' },
  rkT: { fontSize: 12, fontWeight: '800', color: C.pitch },
  row: { flexDirection: 'row-reverse', justifyContent: 'space-between', gap: 12, paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: C.line },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-end' },
  pillT: { fontSize: 11, fontWeight: '700' },
  hmar: { flexDirection: 'row-reverse', gap: 14, alignItems: 'center', backgroundColor: C.donkeyBg, borderWidth: 1, borderColor: C.donkey, borderRadius: 12, padding: 16 },
  hmarBig: { fontSize: 44 },
  capTag: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, maxWidth: 130 },
  capTagC: { width: 16, height: 16, borderRadius: 8, backgroundColor: C.ink, color: '#fff', fontSize: 9, fontWeight: '900', textAlign: 'center', lineHeight: 16, overflow: 'hidden' },
  capTagT: { fontSize: 12, color: C.ink, fontWeight: '700', flexShrink: 1 },
  liveTag: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: '#fff4e5', borderWidth: 1, borderColor: '#ffd8a3' },
  liveTagT: { fontSize: 10, fontWeight: '800', color: '#9a5b00' },
  statHero: { backgroundColor: C.pitch, borderRadius: 16, padding: 14, gap: 10, borderBottomWidth: 3, borderColor: C.neon },
  statHeroT: { color: C.cyan, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  statTiles: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  statTile: { width: '48%', flexGrow: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 10 },
  statTileL: { color: '#d9c7dc', fontSize: 11, textAlign: 'right' },
  statTileV: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'right' },
  statTileS: { color: C.neon, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  pickChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line },
  pickChipOn: { backgroundColor: VIZ.focus, borderColor: VIZ.focus },
  pickChipT: { fontSize: 13, fontWeight: '700', color: C.ink },
  monthList: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  monthCard: { width: '31%', flexGrow: 1, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 8, backgroundColor: C.card },
  monthName: { fontSize: 12, fontWeight: '900', color: C.pitch, textAlign: 'right' },
  monthWho: { fontSize: 13, fontWeight: '800', color: C.ink, textAlign: 'right' },
  monthPts: { fontSize: 11, color: C.muted, textAlign: 'right' },
  chipTotals: { flexDirection: 'row-reverse', gap: 8, paddingHorizontal: 4, paddingBottom: 8 },
  chipTotal: { flex: 1, alignItems: 'center', borderWidth: 1.5, borderRadius: 10, paddingVertical: 6 },
  chipTotalN: { fontSize: 18, fontWeight: '900' },
  chipTotalL: { fontSize: 11, color: C.muted, fontWeight: '700' },
  chipDot: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  chipDotT: { color: '#fff', fontSize: 11, fontWeight: '800' },
  awardCard: { width: 150, borderRadius: 14, padding: 12, gap: 2, backgroundColor: C.pitch, borderBottomWidth: 3, borderColor: C.neon },
  awardIcon: { fontSize: 26, textAlign: 'right' },
  awardTitle: { color: C.cyan, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  awardWho: { color: '#fff', fontSize: 15, fontWeight: '900', textAlign: 'right' },
  awardDetail: { color: '#d9c7dc', fontSize: 11, textAlign: 'right' },
  sheetShade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden', maxHeight: '88%' },
  sheetHead: { flexDirection: 'row-reverse', alignItems: 'flex-end', gap: 12, backgroundColor: C.pitch, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 0, borderBottomWidth: 3, borderColor: C.pink },
  sheetPos: { color: C.cyan, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  sheetName: { color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'right' },
  sheetFull: { color: '#d9c7dc', fontSize: 12, textAlign: 'right', marginBottom: 12 },
  sheetClose: { position: 'absolute', top: 10, left: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  sheetNews: { backgroundColor: '#fff4e0', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#ffd590' },
  sheetNewsT: { color: '#8a5a00', fontSize: 13, textAlign: 'right' },
  sheetGw: { flexDirection: 'row-reverse', alignItems: 'baseline', justifyContent: 'center', gap: 8, backgroundColor: C.pitch, borderRadius: 14, paddingVertical: 10 },
  sheetGwL: { color: '#d9c7dc', fontSize: 13, fontWeight: '700' },
  sheetGwN: { color: C.neon, fontSize: 36, fontWeight: '900', fontVariant: ['tabular-nums'] },
  sheetFx: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: C.line },
  sheetFxT: { fontSize: 15, fontWeight: '800', color: C.pitch, minWidth: 40, textAlign: 'center' },
  sheetFxScore: { fontSize: 18, fontWeight: '900', color: C.ink, textAlign: 'center', fontVariant: ['tabular-nums'] },
  sheetFxMine: { backgroundColor: C.pitch, color: '#fff', borderRadius: 6, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 2 },
  sheetFxState: { fontSize: 11, color: C.pink, fontWeight: '700', minWidth: 34, textAlign: 'center' },
  sheetKpis: { flexDirection: 'row-reverse', backgroundColor: C.pitch2, paddingVertical: 8 },
  sheetKpi: { flex: 1, alignItems: 'center' },
  sheetKpiN: { color: '#fff', fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  sheetKpiL: { color: '#d9c7dc', fontSize: 10 },
  pricePill: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  pricePillT: { color: '#fff', fontSize: 12, fontWeight: '800', writingDirection: 'ltr' },
  roleTag: { minWidth: 34, alignItems: 'center', backgroundColor: C.neon, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  roleTagT: { color: C.pitch, fontSize: 12, fontWeight: '900' },
  nextRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.line },
  nextGw: { width: 50, textAlign: 'center', fontWeight: '900', color: C.pitch, fontSize: 13 },
  fdr: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  fdrT: { fontSize: 15, fontWeight: '900' },
  sheetGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  sheetStat: { width: '31%', flexGrow: 1, backgroundColor: C.card, borderRadius: 12, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: C.line },
  sheetStatN: { fontSize: 18, fontWeight: '900', color: C.pitch, fontVariant: ['tabular-nums'] },
  sheetStatL: { fontSize: 11, color: C.muted },
  dgList: { padding: 10, gap: 8 },
  dgCard: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12, padding: 8, paddingLeft: 10, borderWidth: 1, borderColor: C.line, shadowColor: '#37003c', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  dgGw: { width: 50, height: 50, borderRadius: 10, backgroundColor: C.pitch, alignItems: 'center', justifyContent: 'center' },
  dgGwL: { color: C.cyan, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  dgGwN: { color: '#fff', fontSize: 20, fontWeight: '900', marginTop: -2 },
  dgName: { fontSize: 15, fontWeight: '800', color: C.ink, textAlign: 'right' },
  dgTeam: { fontSize: 12, color: C.muted, textAlign: 'right', flexShrink: 1 },
  dgTie: { backgroundColor: '#fff0f5', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1, borderWidth: 1, borderColor: '#ffc2d6' },
  dgTieT: { color: C.pink, fontSize: 10, fontWeight: '800' },
  dgPts: { minWidth: 52, alignItems: 'center', backgroundColor: '#e9fff4', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: '#b6f5d4' },
  dgPtsN: { fontSize: 18, fontWeight: '900', color: C.pitch, fontVariant: ['tabular-nums'] },
  dgPtsL: { fontSize: 10, color: C.muted, marginTop: -2 },
  donkeyRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, shadowColor: '#37003c', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  donkeyIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.donkeyBg, alignItems: 'center', justifyContent: 'center' },
  donkeyName: { fontSize: 16, fontWeight: '800', color: C.ink, textAlign: 'right' },
  donkeySub: { fontSize: 12, color: C.muted, textAlign: 'right', marginTop: 1 },
  timerPill: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, backgroundColor: C.donkey, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  timerPillL: { color: '#fff', fontSize: 11 },
  timerPillT: { color: '#fff', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  hmarName: { fontSize: 22, fontWeight: '800', color: C.donkey, textAlign: 'right' },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, padding: 12 },
  gw: { width: '48%', borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 8 },
  note: { fontSize: 13, color: C.muted, textAlign: 'right', paddingHorizontal: 4 },
  input: { borderWidth: 2, borderColor: C.line, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 12, fontSize: 18, color: C.ink, backgroundColor: '#fff', textAlign: 'center' },
  btn: { backgroundColor: C.pitch, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  btnT: { color: '#fff', fontWeight: '800', fontSize: 15 },
  err: { backgroundColor: '#fde6ee', borderRadius: 8, padding: 12 },
  stats: { flexDirection: 'row-reverse', marginTop: 12 },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  statN: { fontSize: 18, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
  hero: { backgroundColor: C.pitch, borderRadius: 12, padding: 16, borderBottomWidth: 4, borderColor: C.cyan },
  heroName: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'right' },
  heroSub: { color: '#d9c7dc', fontSize: 13, textAlign: 'right', marginTop: 2 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: 12, minHeight: 160 },
  barCol: { width: 26, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: 18, borderRadius: 4 },
  barV: { fontSize: 10, color: C.ink, marginBottom: 2 },
  barL: { fontSize: 10, color: C.muted, marginTop: 2 },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: C.line },
  chipT: { fontSize: 12, color: C.muted, fontWeight: '600' },
  gwNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.pitch, paddingHorizontal: 8, paddingVertical: 8 },
  arrow: { width: 44, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  arrowT: { color: '#fff', fontSize: 28, fontWeight: '700', marginTop: -4 },
  gwBtn: { flex: 1, marginHorizontal: 8, paddingVertical: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center' },
  gwBtnT: { color: '#fff', fontWeight: '800', fontSize: 15 },
  gwSum: { flexDirection: 'row-reverse', paddingVertical: 12 },
  gwSumBox: { flex: 1, alignItems: 'center' },
  gwSumN: { fontSize: 24, fontWeight: '900', color: C.pitch, fontVariant: ['tabular-nums'] },
  modalBg: { flex: 1, backgroundColor: 'rgba(29,10,32,0.55)', justifyContent: 'center', padding: 30 },
  modalBox: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden' },
  modalItem: { paddingVertical: 13, borderTopWidth: 1, borderColor: C.line },
  pitch: { backgroundColor: C.grass1, paddingVertical: 14, gap: 14, overflow: 'hidden', position: 'relative' },
  stripe: { position: 'absolute', left: 0, right: 0, height: '16.67%' },
  box: { position: 'absolute', top: 0, left: '28%', right: '28%', height: 56, borderWidth: 2, borderTopWidth: 0, borderColor: 'rgba(255,255,255,0.45)' },
  halfLine: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 0, borderTopWidth: 2, borderColor: 'rgba(255,255,255,0.45)' },
  circle: { position: 'absolute', bottom: -45, alignSelf: 'center', width: 90, height: 90, borderRadius: 45, borderWidth: 2, borderColor: 'rgba(255,255,255,0.45)' },
  lineRow: { flexDirection: 'row', justifyContent: 'space-evenly', paddingHorizontal: 4 },
  benchRow: { flexDirection: 'row', justifyContent: 'space-evenly', backgroundColor: '#e3f4ea', paddingVertical: 12, paddingHorizontal: 4 },
  kit: { width: 66, alignItems: 'center' },
  shirt: { width: 38, height: 34, borderRadius: 7, borderTopLeftRadius: 14, borderTopRightRadius: 14, backgroundColor: C.pitch, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  shirtT: { color: '#fff', fontSize: 9, fontWeight: '800' },
  face: { width: 50, height: 56, alignItems: 'center', justifyContent: 'flex-end' },
  photo: { width: 46, height: 56 },
  teamTag: { position: 'absolute', bottom: 0, left: -4, backgroundColor: C.pitch, borderRadius: 4, paddingHorizontal: 3, borderWidth: 1, borderColor: '#fff' },
  teamTagT: { color: '#fff', fontSize: 8, fontWeight: '800' },
  capt: { position: 'absolute', top: -7, right: -9, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  captT: { color: '#fff', fontSize: 10, fontWeight: '900' },
  kitName: { marginTop: 3, backgroundColor: '#fff', borderTopLeftRadius: 4, borderTopRightRadius: 4, paddingHorizontal: 3, width: 66 },
  kitNameT: { fontSize: 10, fontWeight: '700', color: C.ink, textAlign: 'center' },
  kitPts: { backgroundColor: C.pitch, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, width: 66, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 3 },
  bonusT: { color: '#ffd400', fontSize: 9, fontWeight: '800' },
  subTag: { position: 'absolute', top: -6, zIndex: 2, backgroundColor: C.good, color: '#fff', fontSize: 8, fontWeight: '800', paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' },
  seg: { flexDirection: 'row-reverse', backgroundColor: C.card, borderRadius: 999, padding: 4, gap: 4 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center' },
  segOn: { backgroundColor: C.pitch },
  segT: { fontWeight: '700', color: C.pitch, fontSize: 14 },
  item: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: C.bg, borderRadius: 8, padding: 10 },
  miniBtn: { paddingHorizontal: 12, paddingVertical: 7, minWidth: 56, alignItems: 'center', borderRadius: 999, backgroundColor: C.me },
  miniBtnT: { fontSize: 12, fontWeight: '700', color: C.pitch },
  kitPtsT: { color: C.neon, fontSize: 11, fontWeight: '800', textAlign: 'center' },
});
