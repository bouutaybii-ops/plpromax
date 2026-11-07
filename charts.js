// Les graphiques dyal page الإحصائيات (react-native-svg + View).
// Qwa3id (skill dataviz): khtout 2px, nqat ≥ 8px b 7alqa b lon s-surface, grid hairline rmadi,
// "emphasis": joueur wa7d wla jouj b l-lon w l-ba9i rmadi; l-ktba dima b lon n-noss.
import React, { useRef, useState } from 'react';
import { Text, TouchableOpacity, View, ScrollView, StyleSheet, Pressable } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

export const VIZ = {
  me: '#953bff', // lilas FPL — nta
  focus: '#e90052', // magenta PL — l-joueur li kat9arn m3ah
  context: '#d9cfdb', // l-ba9i
  grid: '#eee8ef',
  axis: '#c3b2c4',
  ink: '#1d0a20',
  muted: '#6c5f70',
  surface: '#ffffff',
  bar: '#c9b6cc',
  // Diverging: a7san mn l-moyenne (zr9) ↔ a9al (7mer), l-wsat rmadi
  good: ['#dbe9fb', '#9ec5f4', '#3987e5', '#1c5cab'],
  bad: ['#fde3e3', '#f5b3b3', '#e66767', '#c23b3b'],
  mid: '#f0efec',
};

/** Lon dyal cellule f heatmap 3la 7sab l-far9 m3a l-moyenne. */
export function divergingColor(d, step = 12) {
  const k = Math.min(3, Math.floor(Math.abs(d) / step));
  if (Math.abs(d) < step / 2) return { bg: VIZ.mid, fg: VIZ.ink };
  const ramp = d > 0 ? VIZ.good : VIZ.bad;
  return { bg: ramp[k], fg: k >= 2 ? '#fff' : VIZ.ink };
}

const niceMax = v => {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

/**
 * Line chart b "emphasis". series: { id: [{gw, v}] }. focus: [{ id, color, label }] (kayrsmo fo9).
 * invert: 1 lfo9 (tartib, far9 m3a l-awel). Tap 3la l-chart kayban l-9ima dyal kol focus f dik l-jawla.
 */
export function LineChart({ series, gws, focus = [], invert = false, height = 200, yMin, yMax, fmt = v => v, ticks = 4, unit = '' }) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState(null);
  const pad = { l: 34, r: 12, t: 12, b: 22 };
  const all = Object.values(series).flat().map(x => x.v);
  const lo = yMin ?? Math.min(0, ...all);
  const hi = yMax ?? niceMax(Math.max(...all, 1));
  const iw = Math.max(1, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const x = g => pad.l + (gws.length > 1 ? (gws.indexOf(g) / (gws.length - 1)) * iw : iw / 2);
  const y = v => {
    const f = (v - lo) / (hi - lo || 1);
    return pad.t + (invert ? f : 1 - f) * ih;
  };
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.gw).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const focusIds = new Set(focus.map(f => f.id));
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks);
  const labelEvery = Math.max(1, Math.ceil(gws.length / 8));
  const onPress = e => {
    if (!gws.length) return;
    const lx = e.nativeEvent.locationX;
    const i = Math.round(((lx - pad.l) / iw) * (gws.length - 1));
    setSel(gws[Math.max(0, Math.min(gws.length - 1, i))]);
  };
  const selGw = sel ?? gws[gws.length - 1];
  return (
    <View>
      <View style={st.readout}>
        <Text style={st.readoutGw}>GW{selGw}</Text>
        {focus.map(f => {
          const pt = (series[f.id] || []).find(p => p.gw === selGw);
          return (
            <View key={f.id} style={st.readoutItem}>
              <View style={[st.key, { backgroundColor: f.color }]} />
              <Text style={st.readoutT} numberOfLines={1}>{f.label}: <Text style={st.readoutV}>{pt ? fmt(pt.v) : '–'}{unit}</Text></Text>
            </View>
          );
        })}
      </View>
      <Pressable onPress={onPress} onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height, direction: 'ltr' }}>
        {w > 0 ? (
          <Svg width={w} height={height}>
            {tickVals.map(t => (
              <React.Fragment key={t}>
                <Line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={VIZ.grid} strokeWidth={1} />
                <SvgText x={pad.l - 6} y={y(t) + 4} fontSize={10} fill={VIZ.muted} textAnchor="end">{fmt(Math.round(t))}</SvgText>
              </React.Fragment>
            ))}
            {gws.map((g, i) => (i % labelEvery === 0 || i === gws.length - 1 ? (
              <SvgText key={g} x={x(g)} y={height - 6} fontSize={10} fill={VIZ.muted} textAnchor="middle">{g}</SvgText>
            ) : null))}
            {sel != null ? <Line x1={x(sel)} x2={x(sel)} y1={pad.t} y2={pad.t + ih} stroke={VIZ.axis} strokeWidth={1} /> : null}
            {Object.entries(series).filter(([id]) => !focusIds.has(+id) && !focusIds.has(id)).map(([id, pts]) => (
              <Path key={id} d={path(pts)} stroke={VIZ.context} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {[...focus].reverse().map(f => {
              const pts = series[f.id] || [];
              const last = pts[pts.length - 1];
              const dot = pts.find(p => p.gw === selGw) || last;
              return (
                <React.Fragment key={f.id}>
                  <Path d={path(pts)} stroke={f.color} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                  {dot ? <Circle cx={x(dot.gw)} cy={y(dot.v)} r={5} fill={f.color} stroke={VIZ.surface} strokeWidth={2} /> : null}
                </React.Fragment>
              );
            })}
          </Svg>
        ) : null}
      </Pressable>
    </View>
  );
}

/**
 * Ranked bars (a7san lfo9). rows: [{ id, label, sub, value, display }]. me: l-id li kayban b lon dyalo.
 * Bar ≤ 22px, ras mdawwer, kaybda mn l-imin (RTL); l-9ima f ras l-bar.
 */
export function RankBars({ rows, me, focus, max, color = VIZ.bar, bars = true }) {
  const top = max ?? Math.max(...rows.map(r => Math.abs(r.value)), 1);
  return (
    <View style={{ gap: 6, padding: 12 }}>
      {rows.map((r, i) => {
        const c = r.id === me ? VIZ.me : r.id === focus ? VIZ.focus : color;
        // 78% max: l-9ima dyal l-bar l-kbir kat9ad tban 7daha
        const pct = Math.max(2, (Math.abs(r.value) / top) * 78);
        return (
          <View key={r.id ?? i} style={st.barRow}>
            <View style={st.barLabel}>
              <Text style={[st.barName, r.id === me && { fontWeight: '900' }]} numberOfLines={1}>{r.label}</Text>
              {r.sub ? <Text style={st.barSub} numberOfLines={1}>{r.sub}</Text> : null}
            </View>
            <View style={st.barTrack}>
              {bars ? <View style={[st.bar, { width: `${pct}%`, backgroundColor: c }]} /> : <View style={[st.key, { backgroundColor: c }]} />}
              <Text style={st.barVal}>{r.display ?? r.value}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Heatmap managers × jawlat: s-smiyat tabtin 3la l-imin, l-jadwal kayscrolli 3la l-jnb.
 * cell(id, gw) → { text, bg, fg, crown }.
 */
export function Heatmap({ rows, gws, cell, me, onRow }) {
  const [tip, setTip] = useState(null);
  const ref = useRef(null);
  return (
    <View>
      {tip ? <Text style={st.heatTip}>{tip}</Text> : <Text style={st.heatTip}>دوس على خانة باش تشوف التفاصيل</Text>}
      <View style={{ flexDirection: 'row-reverse' }}>
        <View>
          <View style={[st.heatHead, { width: 92 }]} />
          {rows.map(r => (
            <TouchableOpacity key={r.id} onPress={() => onRow && onRow(r.id)} style={[st.heatName, r.id === me && { backgroundColor: '#f3eafe' }]}>
              <Text style={[st.heatNameT, r.id === me && { fontWeight: '900', color: VIZ.me }]} numberOfLines={1}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView
          ref={ref}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1, direction: 'ltr' }}
          onContentSizeChange={() => ref.current && ref.current.scrollToEnd({ animated: false })}
        >
          <View>
            <View style={{ flexDirection: 'row' }}>
              {gws.map(g => <Text key={g} style={[st.heatHead, st.heatHeadT]}>{g}</Text>)}
            </View>
            {rows.map(r => (
              <View key={r.id} style={{ flexDirection: 'row' }}>
                {gws.map(g => {
                  const c = cell(r.id, g);
                  return (
                    <Pressable key={g} onPress={() => setTip(c.tip)} style={[st.heatCell, { backgroundColor: c.bg }]}>
                      <Text style={[st.heatCellT, { color: c.fg }]}>{c.text}</Text>
                      {c.crown ? <Text style={st.crown}>👑</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

/** Legend sghira: noqta b l-lon + s-smiya (l-ktba b lon n-noss). */
export function Legend({ items }) {
  return (
    <View style={st.legend}>
      {items.map(it => (
        <View key={it.label} style={st.legendItem}>
          <View style={[st.key, { backgroundColor: it.color }]} />
          <Text style={st.legendT}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  readout: { flexDirection: 'row-reverse', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingHorizontal: 12, paddingTop: 10 },
  readoutGw: { fontSize: 12, fontWeight: '900', color: VIZ.ink, backgroundColor: '#f4f2f5', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  readoutItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, flexShrink: 1 },
  readoutT: { fontSize: 12, color: VIZ.muted, flexShrink: 1 },
  readoutV: { color: VIZ.ink, fontWeight: '800' },
  key: { width: 10, height: 10, borderRadius: 5 },
  barRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  barLabel: { width: 108 },
  barName: { fontSize: 13, color: VIZ.ink, fontWeight: '700', textAlign: 'right' },
  barSub: { fontSize: 11, color: VIZ.muted, textAlign: 'right' },
  barTrack: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  bar: { height: 18, borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
  barVal: { fontSize: 12, fontWeight: '800', color: VIZ.ink, fontVariant: ['tabular-nums'] },
  heatTip: { fontSize: 12, color: VIZ.muted, textAlign: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  heatHead: { height: 22 },
  heatHeadT: { width: 34, textAlign: 'center', fontSize: 10, color: VIZ.muted, lineHeight: 22 },
  heatName: { height: 30, width: 92, justifyContent: 'center', paddingHorizontal: 6, borderBottomWidth: 1, borderColor: '#f4f2f5' },
  heatNameT: { fontSize: 12, color: VIZ.ink, textAlign: 'right', fontWeight: '600' },
  heatCell: { width: 32, height: 28, margin: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  heatCellT: { fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  crown: { position: 'absolute', top: -7, right: -3, fontSize: 9 },
  legend: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 12, paddingHorizontal: 12, paddingTop: 8 },
  legendItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  legendT: { fontSize: 12, color: VIZ.muted },
});
