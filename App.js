// PL PRO MAX 2 — Ligue FPL entre amis (حمار الجولة)
// Expo / React Native, fichier unique. Kolchi kayji mn l'API officielle dyal FPL.
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, RefreshControl,
  ActivityIndicator, StyleSheet, StatusBar, Platform, Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';

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

const API = 'https://fantasy.premierleague.com/api';
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
  boot.elements.forEach(el => { players[el.id] = { n: el.web_name, t: el.element_type, team: el.team }; });
  const teams = {};
  boot.teams.forEach(t => { teams[t.id] = t.short_name; });
  return { leagueName: league.league.name, managers, finished, current, players, teams, fetchedAt: new Date().toISOString() };
}

async function loadPicks(entryId, gw) {
  const [picks, live] = await Promise.all([
    getJson(`/entry/${entryId}/event/${gw}/picks/`),
    getJson(`/event/${gw}/live/`),
  ]);
  const pts = {};
  live.elements.forEach(el => { pts[el.id] = el.stats.total_points; });
  return { picks: picks.picks, chip: picks.active_chip, pts, hist: picks.entry_history || {} };
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

/* ---------------- UI bits ---------------- */
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
function Classement({ c, meId, open }) {
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
      <>
        {Toggle}
        <Card>
          <GwNav list={allGws} gw={gw} setGw={setGw} />
          {live ? <Text style={[s.small, { textAlign: 'center', paddingTop: 8, color: C.pink }]}>الجولة مازال كتلعب · النقاط live</Text> : null}
          <View style={[s.tr, s.thRow]}>
            <Text style={[s.th, { width: 30 }]}>#</Text>
            <Text style={[s.th, { flex: 1 }]}>اللاعب</Text>
            <Text style={[s.th, s.colN]}>-4</Text>
            <Text style={[s.th, s.colN]}>النقاط</Text>
          </View>
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
                </View>
              </View>
              <Text style={[s.num, s.colN, { color: x.g.h ? C.bad : C.muted }]}>{x.g.h ? '−' + x.g.h : '–'}</Text>
              <Text style={[s.num, s.colN, s.bold]}>{x.g.p}</Text>
            </TouchableOpacity>
          ))}
        </Card>
      </>
    );
  }

  return (
    <>
      {Toggle}
      <Card title="الترتيب العام" sub={c.liveGw ? `GW${c.liveGw} مازال كتلعب` : 'بعد خصم التبديلات'}>
        <View style={[s.tr, s.thRow]}>
          <Text style={[s.th, { width: 30 }]}>#</Text>
          <Text style={[s.th, { flex: 1 }]}>اللاعب</Text>
          <Text style={[s.th, s.colN]}>{c.showGw ? 'GW' + c.showGw : ''}</Text>
          <Text style={[s.th, s.colN]}>المجموع</Text>
        </View>
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
      </Card>
    </>
  );
}

function Hmar({ c, open }) {
  const name = id => c.per[id].m.name;
  const cur = c.byGw[c.byGw.length - 1];
  const pens = [...c.table].sort((a, b) => b.pen.amount - a.pen.amount || b.donkeys.length - a.donkeys.length);
  return (
    <>
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

      <Card title="العقوبات" sub="بالدرهم">
        {pens.map(r => (
          <TouchableOpacity key={r.m.id} style={s.tr} onPress={() => open(r.m.id)}>
            <Text style={[s.txt, { flex: 1 }]} numberOfLines={1}>{r.m.name}</Text>
            <View style={{ flexDirection: 'row-reverse', gap: 4 }}>
              {r.pen.streaks ? <Pill kind="bad" text={'متتابعين ×' + r.pen.streaks} /> : null}
              {r.pen.triples ? <Pill kind="d" text={'3 مرات ×' + r.pen.triples} /> : null}
            </View>
            <Text style={[s.num, s.colN]}>🐴{r.donkeys.length}</Text>
            <Text style={[s.num, s.colN, s.bold]}>{r.pen.amount}</Text>
          </TouchableOpacity>
        ))}
      </Card>

      <Card title="الحمير جولة بجولة">
        <View style={s.grid}>
          {[...c.byGw].reverse().map(b => (
            <View key={b.gw} style={s.gw}>
              <Text style={s.small}>GW {b.gw} · {b.min} pts{b.tie ? ' · تعادل، حسمو المجموع' : ''}</Text>
              <Text style={[s.txt, s.bold]}>{b.ids.map(name).join('، ')}</Text>
            </View>
          ))}
        </View>
      </Card>
    </>
  );
}

function Stats({ c, open }) {
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
    <>
      <Card title="الأرقام القياسية">
        {c.best ? <Row left={`أعلى سكور: ${name(c.best.id)} (GW${c.best.gw}${c.best.c ? ' · ' + CHIPS[c.best.c]?.short : ''})`} right={c.best.p} onPress={() => open(c.best.id)} /> : null}
        {c.record ? <Row left={`أعلى سكور بلا خاصيات: ${c.record.ids.map(name).join('، ')} (GW${c.record.gw})`} right={c.record.p} /> : null}
        {c.worst ? <Row left={`أقل سكور: ${name(c.worst.id)} (GW${c.worst.gw})`} right={c.worst.p} onPress={() => open(c.worst.id)} /> : null}
      </Card>

      <Card title="الخاصيات" sub="شكون لعب شنو">
        {chipRows.map(({ k, users }) => (
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
        ))}
      </Card>

      <Card title="نجم الجولة" sub="أعلى سكور">
        {byWins.map(r => <Row key={r.m.id} left={`${r.m.name}  ·  ${r.wins.map(g => 'GW' + g).join('، ')}`} right={'⭐×' + r.wins.length} onPress={() => open(r.m.id)} />)}
      </Card>

      <Card title="المعدل فالجولة">
        {byAvg.map(r => <Row key={r.m.id} left={r.m.name} right={avg(r).toFixed(1)} onPress={() => open(r.m.id)} />)}
      </Card>

      <Card title="خسارة التبديلات" sub="نقاط مخصومة">
        {byHits.length ? byHits.map(r => <Row key={r.m.id} left={r.m.name} right={'−' + r.hits} color={C.bad} onPress={() => open(r.m.id)} />)
          : <Text style={[s.small, { padding: 14 }]}>حتى واحد ما خلص -4.</Text>}
      </Card>

      <Card title="نقاط ضايعة فالبنك">
        {byBench.map(r => <Row key={r.m.id} left={r.m.name} right={r.bench} onPress={() => open(r.m.id)} />)}
      </Card>
    </>
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

function Kit({ p, data, team, bench }) {
  const pl = data.players[p.element] || { n: '?' };
  const base = team.pts[p.element] || 0;
  const pts = bench && !p.multiplier ? base : base * (p.multiplier || 1);
  const badge = p.is_captain ? (p.multiplier === 3 ? 'TC' : 'C') : p.is_vice_captain ? 'V' : null;
  return (
    <View style={s.kit}>
      <View style={[s.shirt, pl.t === 1 && { backgroundColor: '#f2c400' }]}>
        <Text style={[s.shirtT, pl.t === 1 && { color: C.ink }]}>{data.teams[pl.team] || ''}</Text>
        {badge ? <View style={s.capt}><Text style={s.captT}>{badge}</Text></View> : null}
      </View>
      <View style={s.kitName}><Text style={s.kitNameT} numberOfLines={1}>{pl.n}</Text></View>
      <View style={s.kitPts}><Text style={s.kitPtsT}>{pts}</Text></View>
    </View>
  );
}

function Pitch({ team, data }) {
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
            {line(t).map(p => <Kit key={p.element} p={p} data={data} team={team} />)}
          </View>
        ))}
      </View>
      <View style={s.benchRow}>
        {bench.map(p => <Kit key={p.element} p={p} data={data} team={team} bench={team.chip !== 'bboost'} />)}
      </View>
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
    loadPicks(id, gw).then(t => alive && setTeam(t)).catch(() => alive && setTErr('ما قدرتش نجيب الفريق.'));
    return () => { alive = false; };
  }, [id, gw]);
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
          <Stat n={'#' + r.rank} l="الترتيب" />
          <Stat n={r.total} l="المجموع" />
          <Stat n={'🐴' + r.donkeys.length} l="حمار" />
          <Stat n={r.pen.amount} l="كيخلص DH" />
        </View>
      </View>

      <Card>
        <GwNav list={gwList} gw={gw} setGw={setGw} />
        <View style={s.gwSum}>
          <View style={s.gwSumBox}><Text style={s.gwSumN}>{g.p ?? '–'}</Text><Text style={s.small}>النقاط</Text></View>
          <View style={s.gwSumBox}><Text style={s.gwSumN}>{g.h ? '−' + g.h : 0}</Text><Text style={s.small}>تبديلات</Text></View>
          <View style={s.gwSumBox}><Text style={s.gwSumN}>{team && team.hist.rank ? fmt(team.hist.rank) : '–'}</Text><Text style={s.small}>ترتيب الجولة</Text></View>
        </View>
        {g.c ? <View style={{ alignItems: 'center', paddingBottom: 8 }}><Pill text={CHIPS[g.c]?.label} color={CHIPS[g.c]?.color} /></View> : null}
        {donk.has(gw) ? <Text style={[s.txt, { textAlign: 'center', color: C.donkey, paddingBottom: 8, fontWeight: '700' }]}>🐴 حمار هاد الجولة</Text> : null}
        {tErr ? <Text style={{ color: C.bad, padding: 14, textAlign: 'right' }}>{tErr}</Text> :
          !team ? <ActivityIndicator style={{ padding: 40 }} color={C.pink} /> : <Pitch team={team} data={data} />}
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

function Fund({ c }) {
  const name = id => c.per[id].m.name;
  const bonusRec = c.record ? 100 : 0;
  const bonusClean = c.clean.length * 100;
  const cup = c.fund - bonusRec - bonusClean;
  return (
    <>
      <Card title="الانخراطات" sub={`${c.table.length} × ${CONFIG.fee} DH`}>
        <Row left="🥇 الأول (50%)" right={fmt(c.pool * 0.5)} />
        <Row left="🥈 الثاني (30%)" right={fmt(c.pool * 0.3)} />
        <Row left="🥉 الثالث (20%)" right={fmt(c.pool * 0.2)} />
        <Row left="المجموع" right={fmt(c.pool)} strong />
      </Card>
      <Card title="صندوق الحمير" sub={c.gws.length ? `حتى لـ GW${c.gws[c.gws.length - 1]}` : ''}>
        <Row left="العقوبات المجموعة" right={fmt(c.fund)} />
        <Row left={'أعلى سكور بلا خاصيات\n' + (c.record ? `${c.record.ids.map(name).join('، ')} · ${c.record.p} pts (GW${c.record.gw})` : '—')} right={'−' + bonusRec} />
        <Row left={'ما عمرو جا حمار\n' + (c.clean.length ? c.clean.map(r => r.m.name).join('، ') : 'حتى واحد')} right={'−' + fmt(bonusClean)} />
        <Row left={'🏆 الباقي للكأس' + (CONFIG.cupWinner ? ' · ' + CONFIG.cupWinner : '')} right={fmt(cup)} strong color={cup < 0 ? C.bad : C.good} />
      </Card>
      <Text style={s.note}>البريمات كتعطى فآخر الموسم. هاد الحساب كيبين شكون غادي يربح إلا وقف الموسم دابا.</Text>
    </>
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
  const [sess, setSessState] = useState(null);
  const setSess = x => { setSessState(x); if (x) AsyncStorage.setItem('fb:sess', JSON.stringify(x)).catch(() => {}); else AsyncStorage.removeItem('fb:sess').catch(() => {}); };

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await loadLeague();
      setData(d);
      const { players, ...light } = d;
      AsyncStorage.setItem('fpl:data', JSON.stringify(light)).catch(() => {});
    } catch (e) {
      setError(Platform.OS === 'web' ? 'المتصفح كيمنع الاتصال بـ FPL. حل التطبيق فـ Expo Go.' : 'ما قدرتش نجيب المعطيات. تأكد من الأنترنيت وسحب للأسفل.');
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

  const login = (id, x) => { if (x) setSess(x); setMeId(id); setTab('table'); AsyncStorage.setItem('fpl:me', String(id)).catch(() => {}); };
  const logout = () => { setMeId(null); setViewId(null); setSess(null); AsyncStorage.removeItem('fpl:me').catch(() => {}); };
  const open = id => { setViewId(id === meId ? null : id); if (id === meId) setTab('me'); };

  const c = useMemo(() => compute(data), [data]);
  const isAdmin = !!sess && sess.uid === CONFIG.staff.admin;
  const isStaff = isAdmin || (!!sess && sess.uid === CONFIG.staff.treasurer);
  const tabs = [['table', 'الترتيب'], ['hmar', 'الحمار'], ['stats', 'إحصائيات'], ['me', 'فرقتي'], ['fund', 'الصندوق'], ['pay', isStaff ? 'الخلاص' : 'حسابي'], ['rules', 'القانون']];
  if (isAdmin) tabs.push(['admin', 'الإدارة']);

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
              <TouchableOpacity onPress={() => { setTab('me'); setViewId(null); }} style={{ flex: 1 }}>
                <Text style={s.eyebrow} numberOfLines={1}>{c.per[meId] ? `${c.per[meId].m.team} · #${c.per[meId].rank}` : ''}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={logout} style={s.logout} accessibilityLabel="تسجيل الخروج">
                <Text style={s.logoutT}>خروج ⎋</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.h1}>{data.leagueName}</Text>
            <View style={s.kpis}>
              <View style={s.kpi}><Text style={s.kpiN}>{c.showGw ? 'GW' + c.showGw : '–'}</Text><Text style={s.kpiL}>{c.liveGw ? 'live' : 'آخر جولة'}</Text></View>
              <View style={s.kpi}><Text style={s.kpiN}>{fmt(c.pool)}</Text><Text style={s.kpiL}>الانخراطات</Text></View>
              <View style={s.kpi}><Text style={s.kpiN}>{fmt(c.fund)}</Text><Text style={s.kpiL}>صندوق الحمير</Text></View>
            </View>
          </View>
          <View style={s.tabs}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row-reverse', gap: 4, paddingHorizontal: 12 }}>
              {tabs.map(([k, l]) => (
                <TouchableOpacity key={k} onPress={() => { setTab(k); setViewId(null); }} style={[s.tab, tab === k && !viewId && s.tabOn]}>
                  <Text style={[s.tabT, tab === k && !viewId && { color: C.pitch }]}>{l}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <ScrollView
            style={{ flex: 1, backgroundColor: C.bg }}
            contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
          >
            {error ? <View style={s.err}><Text style={{ color: C.bad, textAlign: 'right' }}>{error}</Text></View> : null}
            {viewId ? <Player key={viewId} c={c} data={data} id={viewId} onBack={() => setViewId(null)} /> :
             tab === 'table' ? <Classement c={c} meId={meId} open={open} /> :
             tab === 'hmar' ? <Hmar c={c} open={open} /> :
             tab === 'stats' ? <Stats c={c} open={open} /> :
             tab === 'me' ? <Player key={meId} c={c} data={data} id={meId} isMe onLogout={logout} staff={sess ? (isAdmin ? 'admin' : sess.uid === CONFIG.staff.treasurer ? 'treasurer' : 'other') : null} onSession={setSess} onStaffOut={() => (CONFIG.protectedIds[meId] ? logout() : setSess(null))} /> :
             tab === 'fund' ? <Fund c={c} /> :
             tab === 'pay' ? <Finance c={c} sess={sess} setSess={setSess} meId={meId} /> :
             tab === 'admin' && isAdmin ? <Admin c={c} data={data} /> :
             <Rules />}
            <Text style={[s.small, { textAlign: 'center' }]}>سحب للأسفل باش تحدث</Text>
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: C.pitch, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderBottomWidth: 3, borderColor: C.pink },
  topBar: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  eyebrow: { color: C.cyan, fontSize: 13, fontWeight: '600', textAlign: 'right' },
  logout: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  logoutT: { color: '#fff', fontSize: 12, fontWeight: '700' },
  h1: { color: '#fff', fontSize: 28, fontWeight: '900', textAlign: 'right', marginVertical: 8, letterSpacing: -0.5 },
  kpis: { flexDirection: 'row-reverse', gap: 8 },
  kpi: { flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: 10, borderTopWidth: 3, borderColor: C.neon },
  kpiN: { color: '#fff', fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'], textAlign: 'right' },
  kpiL: { color: '#d9c7dc', fontSize: 11, textAlign: 'right' },
  tabs: { backgroundColor: C.pitch2, paddingVertical: 8 },
  tab: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999 },
  tabOn: { backgroundColor: C.neon },
  tabT: { color: '#e8dcea', fontWeight: '700', fontSize: 14 },
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
  capt: { position: 'absolute', top: -7, right: -9, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  captT: { color: '#fff', fontSize: 10, fontWeight: '900' },
  kitName: { marginTop: 3, backgroundColor: '#fff', borderTopLeftRadius: 4, borderTopRightRadius: 4, paddingHorizontal: 3, width: 66 },
  kitNameT: { fontSize: 10, fontWeight: '700', color: C.ink, textAlign: 'center' },
  kitPts: { backgroundColor: C.pitch, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, width: 66 },
  seg: { flexDirection: 'row-reverse', backgroundColor: C.card, borderRadius: 999, padding: 4, gap: 4 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center' },
  segOn: { backgroundColor: C.pitch },
  segT: { fontWeight: '700', color: C.pitch, fontSize: 14 },
  item: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: C.bg, borderRadius: 8, padding: 10 },
  miniBtn: { paddingHorizontal: 12, paddingVertical: 7, minWidth: 56, alignItems: 'center', borderRadius: 999, backgroundColor: C.me },
  miniBtnT: { fontSize: 12, fontWeight: '700', color: C.pitch },
  kitPtsT: { color: C.neon, fontSize: 11, fontWeight: '800', textAlign: 'center' },
});
