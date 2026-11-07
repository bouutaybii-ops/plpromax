// L-mouda dyal 7mar l-jawla: l-7mar dyal GW N kayb9a 7mar 7tta tsali GW N+1, ya3ni m3a 00:00 dyal
// l-lil li mn b3d akhir match f GW N+1. 00:00 b s-sa3a dyal t-tilifoun (s7ab l-ligue kamlin f
// l-Maghrib): ma kan3tamdouch 3la tzdata dyal l-navigateur, 7it ymken tkoun 9dima.
// Fonctions pures: kayt-testaw b `npm test`.

/** Chi match kaydoum ~115 d9i9a b l-wa9t bdal-dyal w l-istira7a. */
export const MATCH_MINUTES = 115;

/**
 * Fin dyal l-mouda (timestamp ms): 00:00 (s-sa3a dyal t-tilifoun) li mn b3d nihayat akhir match
 * f les fixtures dyal l-jawla li jaya. null ila ma kayn 7tta match m-programmé.
 */
export function donkeyDeadline(fixtures) {
  const kickoffs = (fixtures || []).map(f => f.kickoff_time).filter(Boolean).map(Date.parse).filter(Number.isFinite);
  if (!kickoffs.length) return null;
  const end = new Date(Math.max(...kickoffs) + MATCH_MINUTES * 60000);
  end.setHours(24, 0, 0, 0); // 00:00 dyal n-nhar li mn b3d
  return end.getTime();
}

/** { d, h, m, s } dyal l-wa9t l-ba9i (ms); kolchi 0 ila sala. */
export function splitCountdown(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'ماي', 'يونيو', 'يوليوز', 'غشت', 'شتنبر', 'أكتوبر', 'نونبر', 'دجنبر'];

/** "الاثنين 9 نونبر · 00:00" b s-sa3a dyal t-tilifoun. */
export function formatMoroccoDate(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} · ${hh}:${mm}`;
}
