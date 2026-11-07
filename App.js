// PL PRO MAX 2 — Ligue FPL entre amis (حمار الجولة)
// Expo / React Native, fichier unique. Kolchi kayji mn l'API officielle dyal FPL.
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, RefreshControl, Image,
  ActivityIndicator, StyleSheet, StatusBar, Platform, Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fixturesByTeam, liveStats, liveTeam, provisionalBonus } from './live';

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
  const finished = boot.events.filter(ev => ev.finished).map(ev => ev.id);
  const current = (boot.events.find(ev => ev.is_current) || {}).id || null;
  const managers = entries.map((e, i) => {
    const h = histories[i];
    const chipBy = {};
    (h.chips || []).forEach(ch => { chipBy[ch.event] = ch.name; });
    const gws = {};
    (h.current || []).forEach(g => {
      const hit = g.event_transfers_cost || 0;
      gws[g.event] = { p: g.points - hit, raw: g.points, h: hit, c: chipBy[g.event] || '', bench: g.points_on_bench || 0, tr: g.event_transfers || 0 };
    });
    return { id: e.entry, name: e.player_name, team: e.entry_name, gws, chips: (h.chips || []).map(ch => ({ name: ch.name, gw: ch.event })) };
  });
  const players = {};
  boot.elements.forEach(el => { players[el.id] = { n: el.web_name, t: el.element_type, team: el.team, c: el.code }; });
  const teams = {};
  boot.teams.forEach(t => { teams[t.id] = t.short_name; });

  // Jawla mazal kat-tl3eb: l-history dyal FPL ma kaytbeddelch live, donc kan7esbo l-points
  // dyal kol wa7ed mn l'équipe dyalo + les stats live + bonus provisoire + auto-subs.
  if (current && !finished.includes(current)) {
    try {
      const ctx = await loadGwContext(current, players);
      const allPicks = await Promise.all(managers.map(m => getJson(`/entry/${m.id}/event/${current}/picks/`).catch(() => null)));
      managers.forEach((m, i) => {
        const pk = allPicks[i];
        if (!pk) return;
        const t = liveTeam({ picks: pk.picks, chip: pk.active_chip, players, ...ctx });
        const hit = (pk.entry_history || {}).event_transfers_cost || 0;
        m.gws[current] = { p: t.total - hit, raw: t.total, h: hit, c: pk.active_chip || '', bench: t.benchPts, tr: (pk.entry_history || {}).event_transfers || 0, live: true, left: t.left, prov: t.provisional };
      });
    } catch {}
  }
  return { leagueName: league.league.name, managers, finished, current, players, teams, fetchedAt: new Date().toISOString() };
}

// Stats live dyal journée: points dyal kol joueur, les matchs, w l-bonus provisoire (mn l-BPS).
async function loadGwContext(gw, players) {
  const [live, fixtures] = await Promise.all([getJson(`/event/${gw}/live/`), getJson(`/fixtures/?event=${gw}`)]);
  return { live: liveStats(live), byTeam: fixturesByTeam(fixtures), bonus: provisionalBonus(fixtures) };
}

async function loadPicks(entryId, gw, players) {
  const [picks, ctx] = await Promise.all([getJson(`/entry/${entryId}/event/${gw}/picks/`), loadGwContext(gw, players)]);
  const t = liveTeam({ picks: picks.picks, chip: picks.active_chip, players, ...ctx });
  return { picks: t.rows, chip: picks.active_chip, hist: picks.entry_history || {}, total: t.total, left: t.left, prov: t.provisional };
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
  const children = [];
  const sticky = [];
  sections.filter(Boolean).forEach((sec, i) => {
    const hasHead = !!(sec.title || sec.head);
    if (hasHead) {
      sticky.push(children.length);
      children.push(
        <View key={'h' + i} style={s.secHead}>
          {sec.title ? (
            <View style={s.cardH}>
              <Text style={s.h2}>{sec.title}</Text>
              {sec.sub ? <Text style={s.muted}>{sec.sub}</Text> : null}
            </View>
          ) : null}
          {sec.head || null}
        </View>
      );
    }
    children.push(<View key={'b' + i} style={sec.bare ? { marginBottom: 14 } : [s.secBody, !hasHead && s.secAlone]}>{sec.body}</View>);
  });
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 14, paddingBottom: 40 }} stickyHeaderIndices={sticky} refreshControl={refreshControl}>
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
function Classement({ c, meId, open, refreshControl }) {
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
    const live = gw === c.liveGw;
    const rows = c.table.map(r => ({ r, g: r.m.gws[gw] })).filter(x => x.g).sort((a, b) => b.g.p - a.g.p);
    const max = rows.length ? rows[0].g.p : null;
    const finishedD = c.byGw.find(b => b.gw === gw);
    const donkeyId = finishedD ? finishedD.ids[0] : (live && c.liveDonkey ? c.liveDonkey.ids[0] : null);
    return (
      <View style={s.fixedPage}>
        {Toggle}
        <View style={[s.card, s.fixedCard]}>
          <GwNav list={allGws} gw={gw} setGw={setGw} />
          {live ? <Text style={[s.small, { textAlign: 'center', paddingTop: 8, color: C.pink }]}>الجولة مازال كتلعب · النقاط live</Text> : null}
          <View style={[s.tr, s.thRow]}>
            <Text style={[s.th, { width: 30 }]}>#</Text>
            <Text style={[s.th, { flex: 1 }]}>اللاعب</Text>
            <Text style={[s.th, s.colN]}>-4</Text>
            <Text style={[s.th, s.colN]}>النقاط</Text>
          </View>
          <ScrollView style={{ flex: 1 }} refreshControl={refreshControl}>
          {rows.map((x, i) => (
            <TouchableOpacity key={x.r.m.id} onPress={() => open(x.r.m.id)} style={[s.tr, x.r.m.id === meId && { backgroundColor: C.me }]}>
              <View style={[s.rk, x.g.p === max && { backgroundColor: C.gold }, x.r.m.id === donkeyId && { backgroundColor: C.donkey }]}>
                <Text style={[s.rkT, (x.g.p === max || x.r.m.id === donkeyId) && { color: '#fff' }]}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, paddingHorizontal: 8 }}>
                <Text style={[s.txt, s.bold]} numberOfLines={1}>{x.r.m.name}{x.g.p === max ? '  ⭐' : ''}{x.r.m.id === donkeyId ? (live ? '  ⏳🐴' : '  🐴') : ''}</Text>
                <View style={{ flexDirection: 'row-reverse', gap: 6, alignItems: 'center' }}>
                  <Text style={s.small} numberOfLines={1}>{x.r.m.team}</Text>
                  {x.g.c ? <Pill text={CHIPS[x.g.c]?.short || x.g.c} color={CHIPS[x.g.c]?.color} /> : null}
                  {x.g.live && x.g.left ? <Text style={[s.small, { color: C.pink }]}>⏳{x.g.left}</Text> : null}
                  {x.g.live && x.g.prov ? <Text style={[s.small, { color: '#c99a00', fontWeight: '700' }]}>★+{x.g.prov}</Text> : null}
                </View>
              </View>
              <Text style={[s.num, s.colN, { color: x.g.h ? C.bad : C.muted }]}>{x.g.h ? '−' + x.g.h : '–'}</Text>
              <Text style={[s.num, s.colN, s.bold]}>{x.g.p}</Text>
            </TouchableOpacity>
          ))}
          </ScrollView>
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

function Hmar({ c, open, refreshControl }) {
  const name = id => c.per[id].m.name;
  const cur = c.byGw[c.byGw.length - 1];
  const pens = [...c.table].sort((a, b) => b.pen.amount - a.pen.amount || b.donkeys.length - a.donkeys.length);
  const banners = (
    <View style={{ gap: 10 }}>
      {c.liveDonkey ? (
        <View style={[s.hmar, { borderStyle: 'dashed' }]}>
          <Text style={s.hmarBig}>⏳</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.small, { color: C.donkey }]}>حمار مؤقت · GW{c.liveDonkey.gw} (live)</Text>
            <Text style={s.hmarName}>{c.liveDonkey.ids.map(name).join(' و ')}</Text>
            <Text style={s.txt}>{c.liveDonkey.min} نقطة دابا، يقدر يتبدل حتى تسالي الجولة.</Text>
          </View>
        </View>
      ) : null}
      {cur ? (
        <View style={s.hmar}>
          <Text style={s.hmarBig}>🐴</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.small, { color: C.donkey }]}>حمار الجولة {cur.gw}</Text>
            <Text style={s.hmarName}>{cur.ids.map(name).join(' و ')}</Text>
            <Text style={s.txt}>{cur.min} نقطة · كيخلص وكيحط صورة الحمار فالبروفيل.</Text>
          </View>
        </View>
      ) : <Card><Text style={[s.txt, { padding: 16 }]}>حتى جولة ما سالات من بداية الدوري.</Text></Card>}
    </View>
  );
  return (
    <Sections
      refreshControl={refreshControl}
      sections={[
        { body: banners, bare: true },
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
            <View style={s.grid}>
              {[...c.byGw].reverse().map(b => (
                <View key={b.gw} style={s.gw}>
                  <Text style={s.small}>GW {b.gw} · {b.min} pts{b.tie ? ' · تعادل، حسمو المجموع' : ''}</Text>
                  <Text style={[s.txt, s.bold]}>{b.ids.map(name).join('، ')}</Text>
                </View>
              ))}
            </View>
          ),
        },
      ]}
    />
  );
}
function Stats({ c, open, refreshControl }) {
  const name = id => c.per[id].m.name;
  const chipRows = Object.keys(CHIPS).map(k => ({
    k, users: c.table.flatMap(r => r.m.chips.filter(ch => ch.name === k && ch.gw >= CONFIG.startGw).map(ch => ({ id: r.m.id, gw: ch.gw }))),
  })).filter(x => x.users.length || x.k !== 'manager');
  const avg = r => (c.gws.length ? r.list.filter(x => c.gws.includes(x.gw)).reduce((a, x) => a + x.p, 0) / c.gws.length : 0);
  const byAvg = [...c.table].sort((a, b) => avg(b) - avg(a));
  const byHits = [...c.table].filter(r => r.hits).sort((a, b) => b.hits - a.hits);
  const byBench = [...c.table].sort((a, b) => b.bench - a.bench).slice(0, 5);
  const byWins = [...c.table].filter(r => r.wins.length).sort((a, b) => b.wins.length - a.wins.length);
  return (
    <Sections
      refreshControl={refreshControl}
      sections={[
        {
          title: 'الأرقام القياسية',
          body: (
            <>
              {c.best ? <Row left={`أعلى سكور: ${name(c.best.id)} (GW${c.best.gw}${c.best.c ? ' · ' + CHIPS[c.best.c]?.short : ''})`} right={c.best.p} onPress={() => open(c.best.id)} /> : null}
              {c.record ? <Row left={`أعلى سكور بلا خاصيات: ${c.record.ids.map(name).join('، ')} (GW${c.record.gw})`} right={c.record.p} /> : null}
              {c.worst ? <Row left={`أقل سكور: ${name(c.worst.id)} (GW${c.worst.gw})`} right={c.worst.p} onPress={() => open(c.worst.id)} /> : null}
            </>
          ),
        },
        {
          title: 'الخاصيات', sub: 'شكون لعب شنو',
          body: chipRows.map(({ k, users }) => (
            <View key={k} style={[s.tr, { alignItems: 'flex-start' }]}>
              <View style={{ width: 120 }}><Pill text={CHIPS[k].label} color={CHIPS[k].color} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                {users.length ? users.sort((a, b) => a.gw - b.gw).map(u => (
                  <TouchableOpacity key={u.id + '-' + u.gw} onPress={() => open(u.id)}>
                    <Text style={s.txt}>{name(u.id)} <Text style={s.muted}>· GW{u.gw}</Text></Text>
                  </TouchableOpacity>
                )) : <Text style={s.small}>حتى واحد مازال</Text>}
              </View>
            </View>
          )),
        },
        {
          title: 'نجم الجولة', sub: 'أعلى سكور',
          body: byWins.map(r => <Row key={r.m.id} left={`${r.m.name}  ·  ${r.wins.map(g => 'GW' + g).join('، ')}`} right={'⭐×' + r.wins.length} onPress={() => open(r.m.id)} />),
        },
        {
          title: 'المعدل فالجولة',
          body: byAvg.map(r => <Row key={r.m.id} left={r.m.name} right={avg(r).toFixed(1)} onPress={() => open(r.m.id)} />),
        },
        {
          title: 'خسارة التبديلات', sub: 'نقاط مخصومة',
          body: byHits.length ? byHits.map(r => <Row key={r.m.id} left={r.m.name} right={'−' + r.hits} color={C.bad} onPress={() => open(r.m.id)} />)
            : <Text style={[s.small, { padding: 14 }]}>حتى واحد ما خلص -4.</Text>,
        },
        {
          title: 'نقاط ضايعة فالبنك',
          body: byBench.map(r => <Row key={r.m.id} left={r.m.name} right={r.bench} onPress={() => open(r.m.id)} />),
        },
      ]}
    />
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
    const t = setInterval(check, 5 * 60000);
    return () => { document.removeEventListener('visibilitychange', onShow); clearInterval(t); };
  }, []);

  // Wast la journée: kan3awdo njibo les points kol d9i9a.
  const liveNow = !!(data && data.current && !data.finished.includes(data.current));
  useEffect(() => {
    if (!liveNow) return;
    const t = setInterval(() => refresh(true), 60000);
    return () => clearInterval(t);
  }, [liveNow, refresh]);

  const login = (id, x) => { if (x) setSess(x); setMeId(id); setTab('table'); AsyncStorage.setItem('fpl:me', String(id)).catch(() => {}); };
  const logout = () => { setMeId(null); setViewId(null); setSess(null); AsyncStorage.removeItem('fpl:me').catch(() => {}); };
  const open = id => { setViewId(id === meId ? null : id); if (id === meId) setTab('me'); };

  const c = useMemo(() => compute(data), [data]);
  const isAdmin = !!sess && sess.uid === CONFIG.staff.admin;
  const isStaff = isAdmin || (!!sess && sess.uid === CONFIG.staff.treasurer);
  const tabs = [['table', 'الترتيب', '🏆'], ['hmar', 'الحمار', '🐴'], ['stats', 'إحصائيات', '📊'], ['me', 'فرقتي', '⚽'], ['fund', 'الصندوق', '💰'], ['pay', isStaff ? 'الخلاص' : 'حسابي', '💳'], ['rules', 'القانون', '📜']];
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
          <View style={s.header}>
            <View style={s.topBar}>
              <TouchableOpacity onPress={() => setMenu(true)} style={s.menuBtn} accessibilityLabel="القائمة">
                <Text style={s.menuIcon}>☰</Text>
              </TouchableOpacity>
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
          <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
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
                <View style={{ flex: 1 }} />
                <TouchableOpacity onPress={() => { setMenu(false); logout(); }} style={s.drawerItem} accessibilityLabel="تسجيل الخروج">
                  <Text style={s.drawerIcon}>⎋</Text>
                  <Text style={s.drawerT}>تسجيل الخروج</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
          {!viewId && ['table', 'hmar', 'stats', 'fund'].includes(tab) ? (
            // Had les pages 3ndhom scroll dyalhom: l-entêtes dyal les jadawel kayb9aw tabtin.
            <View style={{ flex: 1, backgroundColor: C.bg }}>
              {error ? <View style={[s.err, { margin: 14, marginBottom: 0 }]}><Text style={{ color: C.bad, textAlign: 'right' }}>{error}</Text></View> : null}
              {tab === 'table' ? <Classement c={c} meId={meId} open={open} refreshControl={pullToRefresh} /> :
               tab === 'hmar' ? <Hmar c={c} open={open} refreshControl={pullToRefresh} /> :
               tab === 'stats' ? <Stats c={c} open={open} refreshControl={pullToRefresh} /> :
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
  drawerShade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'flex-end' },
  drawer: { width: '78%', maxWidth: 320, height: '100%', backgroundColor: C.pitch, paddingTop: 48, paddingHorizontal: 14, paddingBottom: 28, gap: 4 },
  drawerTitle: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'right' },
  drawerItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12 },
  drawerItemOn: { backgroundColor: C.neon },
  drawerIcon: { fontSize: 18, width: 26, textAlign: 'center', color: '#fff' },
  drawerT: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'right' },
  fixedPage: { flex: 1, padding: 14, gap: 14 },
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
