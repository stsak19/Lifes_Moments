// Reads each room's Booking.com calendar (iCal) and keeps its reservations as owner stays,
// so the room closes on the site and shows in the admin. Runs every 15 minutes (pg_cron),
// and when an owner presses "Έλεγχος τώρα" or saves a link.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ANON, URL_, admin, cors, json, log, notify, range } from '../_shared/core.ts';

const SYNCED = 'Booking.com'; // created_by of the stays this function makes
const LINK = /^https:\/\/([a-z0-9-]+\.)*booking\.com\//;
const DAY = 86400000;
const athensToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const unitName = (u: string) => u === 'apt' ? 'Διαμέρισμα' : 'Δωμάτιο ' + u.slice(1);

type Ev = { uid: string; start: string; end: string };
type Feed = { unit: string; import_url: string | null; last_ok_at: string | null };

/** The VEVENTs of an iCal file: all-day start and end (end is the check-out day). */
export function parseIcs(text: string): Ev[] | null {
  if (!/BEGIN:VCALENDAR/i.test(text)) return null;
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out: Ev[] = [];
  let cur: Record<string, string> | null = null;
  const day = (v: string) => { const m = /^(\d{4})(\d{2})(\d{2})/.exec(v); return m ? m[1] + '-' + m[2] + '-' + m[3] : ''; };
  for (const l of lines) {
    const u = l.trim().toUpperCase();
    if (u === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (u === 'END:VEVENT') {
      if (cur && cur.start && (cur.status ?? '') !== 'CANCELLED') {
        const end = cur.end && cur.end > cur.start ? cur.end : addDays(cur.start, 1);
        out.push({ uid: (cur.uid || cur.start + '/' + end).slice(0, 300), start: cur.start, end });
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const i = l.indexOf(':');
    if (i < 0) continue;
    const key = l.slice(0, i).split(';')[0].trim().toUpperCase(), val = l.slice(i + 1).trim();
    if (key === 'DTSTART') cur.start = day(val);
    else if (key === 'DTEND') cur.end = day(val);
    else if (key === 'UID') cur.uid = val;
    else if (key === 'STATUS') cur.status = val.toUpperCase();
  }
  return out;
}

async function readFeed(url: string): Promise<Ev[]> {
  let r: Response;
  try {
    r = await fetch(url, { headers: { 'User-Agent': "Life's Moments calendar sync", Accept: 'text/calendar, */*' }, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error('Το Booking.com δεν απάντησε. Ξαναδοκιμάζει μόνο του σε 15 λεπτά.');
  }
  if ([400, 401, 403, 404, 410].includes(r.status)) throw new Error('Το Booking.com δεν βρίσκει αυτόν τον σύνδεσμο. Αντέγραψέ τον ξανά από το extranet.');
  if (!r.ok) throw new Error('Το Booking.com απάντησε με σφάλμα (' + r.status + '). Ξαναδοκιμάζει μόνο του σε 15 λεπτά.');
  const text = await r.text();
  if (text.length > 2_000_000) throw new Error('Το ημερολόγιο είναι πολύ μεγάλο για να διαβαστεί.');
  const evs = parseIcs(text);
  if (!evs) throw new Error('Ο σύνδεσμος δεν είναι ημερολόγιο. Χρειάζεται ο σύνδεσμος «Εξαγωγή» αυτού του δωματίου.');
  return evs;
}

/** Nights of this room already taken here (site, typed-in stays, closed nights). */
async function ownNights(unit: string, today: string): Promise<Set<string>> {
  const [req, st, bl] = await Promise.all([
    admin.from('booking_requests').select('check_in, check_out').eq('unit', unit).eq('status', 'confirmed').eq('is_test', false).gt('check_out', today),
    admin.from('owner_stays').select('check_in, check_out').eq('unit', unit).eq('status', 'confirmed').eq('source', 'direct').neq('kind', 'test').gt('check_out', today),
    admin.from('unit_blocks').select('night').eq('unit', unit).gte('night', today)
  ]);
  const bad = [req, st, bl].find((x) => x.error);
  if (bad) throw new Error('db: ' + bad.error!.message);
  const s = new Set<string>();
  for (const x of [...(req.data ?? []), ...(st.data ?? [])]) for (let d = x.check_in; d < x.check_out; d = addDays(d, 1)) s.add(d);
  for (const b of bl.data ?? []) s.add(b.night);
  return s;
}

type Result = { unit: string; ok: boolean; count?: number; added?: number; changed?: number; cancelled?: number; error?: string };

async function syncFeed(f: Feed, today: string, clashes: string[]): Promise<Result> {
  const unit = f.unit;
  const { data: mine, error: mineErr } = await admin.from('owner_stays')
    .select('id, ical_uid, check_in, check_out, status, created_by').eq('unit', unit).not('ical_uid', 'is', null);
  if (mineErr) throw new Error('db: ' + mineErr.message);
  const existing = new Map((mine ?? []).map((m) => [m.ical_uid as string, m]));

  // No link (any more): the copies it made go, typed-in ones stop following it.
  if (!f.import_url) {
    const synced = (mine ?? []).filter((m) => m.created_by === SYNCED && m.check_out >= today).map((m) => m.id);
    const typed = (mine ?? []).filter((m) => m.created_by !== SYNCED).map((m) => m.id);
    if (synced.length) await admin.from('owner_stays').delete().in('id', synced);
    if (typed.length) await admin.from('owner_stays').update({ ical_uid: null }).in('id', typed);
    return { unit, ok: true, count: 0, cancelled: synced.length };
  }

  const tried = new Date().toISOString();
  let evs: Ev[];
  try {
    if (!LINK.test(f.import_url)) throw new Error('Ο σύνδεσμος πρέπει να είναι του Booking.com.');
    evs = await readFeed(f.import_url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from('ical_feeds').update({ last_try_at: tried, last_error: msg }).eq('unit', unit).eq('import_url', f.import_url);
    log('ical_read_failed', { unit, message: msg });
    return { unit, ok: false, error: msg };
  }

  const future = evs.filter((e) => e.end > today && (Date.parse(e.end) - Date.parse(e.start)) / DAY <= 60);
  const seen = new Set(evs.map((e) => e.uid));
  const own = await ownNights(unit, today);
  const type = unit === 'apt' ? 'apt' : 'room';
  let added = 0, changed = 0, cancelled = 0;

  for (const e of future) {
    const ex = existing.get(e.uid);
    if (ex) {
      if (ex.check_in !== e.start || ex.check_out !== e.end || ex.status !== 'confirmed') {
        const { error } = await admin.from('owner_stays').update({ check_in: e.start, check_out: e.end, status: 'confirmed' }).eq('id', ex.id);
        if (!error) changed++; else log('ical_update_failed', { unit, message: error.message });
      }
      continue;
    }
    const nights: string[] = [];
    for (let d = e.start; d < e.end; d = addDays(d, 1)) nights.push(d);
    // Our own booking that Booking.com shows back to us: already counted here.
    if (nights.every((d) => own.has(d))) continue;
    // A copy the owners typed in by hand before the link existed: it now follows the link.
    const { data: typed } = await admin.from('owner_stays').select('id').eq('unit', unit).eq('source', 'booking')
      .eq('status', 'confirmed').is('ical_uid', null).eq('check_in', e.start).eq('check_out', e.end).limit(1);
    if (typed?.length) { await admin.from('owner_stays').update({ ical_uid: e.uid }).eq('id', typed[0].id); continue; }
    const { error } = await admin.from('owner_stays').insert({
      kind: 'paid', source: 'booking', unit_type: type, unit, check_in: e.start, check_out: e.end,
      guests: 1, name: 'Booking.com', created_by: SYNCED, ical_uid: e.uid
    });
    if (error) { if (error.code !== '23505') log('ical_insert_failed', { unit, message: error.message }); continue; }
    added++;
    if (nights.some((d) => own.has(d) && d >= today)) clashes.push(unitName(unit) + ' · ' + range(e.start, e.end));
  }

  // Gone from Booking.com's calendar: cancelled there. After a new link, old copies just go.
  const fresh = !f.last_ok_at;
  for (const m of mine ?? []) {
    if (seen.has(m.ical_uid as string) || m.status !== 'confirmed' || m.check_out < today) continue;
    if (fresh && m.created_by === SYNCED) await admin.from('owner_stays').delete().eq('id', m.id);
    else if (fresh) await admin.from('owner_stays').update({ ical_uid: null }).eq('id', m.id);
    else await admin.from('owner_stays').update({ status: 'cancelled' }).eq('id', m.id);
    cancelled++;
  }

  await admin.from('ical_feeds').update({ last_try_at: tried, last_ok_at: tried, last_error: null, last_count: future.length })
    .eq('unit', unit).eq('import_url', f.import_url);
  return { unit, ok: true, count: future.length, added, changed, cancelled };
}

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: h });
  if (req.method !== 'POST') return json({ error: 'method' }, 405, h);

  // pg_cron with the shared secret, or a signed-in owner.
  const { data: expected } = await admin.rpc('server_secret', { p_name: 'cron_secret' });
  const fromCron = !!expected && req.headers.get('x-cron-secret') === expected;
  if (!fromCron) {
    const auth = req.headers.get('authorization') ?? '';
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: who } = await user.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    const { data: owner } = await user.rpc('is_owner');
    if (!who?.user || owner !== true) return json({ error: 'not_owner' }, 403, h);
  }

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* empty body: every room */ }
  const only = typeof b.unit === 'string' && /^(r([1-9]|1[01])|apt)$/.test(b.unit) ? b.unit : null;

  try {
    let q = admin.from('ical_feeds').select('unit, import_url, last_ok_at').order('unit');
    if (only) q = q.eq('unit', only);
    const { data: feeds, error } = await q;
    if (error) throw new Error('db: ' + error.message);
    const today = athensToday();
    const clashes: string[] = [];
    const results: Result[] = [];
    for (const f of feeds ?? []) {
      try { results.push(await syncFeed(f as Feed, today, clashes)); }
      catch (e) { log('ical_unit_error', { unit: f.unit, message: String(e) }); results.push({ unit: f.unit, ok: false, error: 'Κάτι πήγε στραβά. Ξαναδοκιμάζει μόνο του σε 15 λεπτά.' }); }
    }
    if (clashes.length) {
      try {
        await notify({ title: 'Πιθανή διπλή κράτηση', body: 'Ήρθε κράτηση από Booking.com σε μέρες που είναι ήδη πιασμένες εδώ: ' + clashes.join(', ') + '. Κοίτα το ημερολόγιο.', url: 'admin.html', tag: 'ical-clash' });
      } catch (e) { log('notify_error', { message: String(e) }); }
    }
    const linked = results.filter((r) => (feeds ?? []).find((f) => f.unit === r.unit)?.import_url);
    log('ical_sync', { from: fromCron ? 'cron' : 'owner', linked: linked.length, failed: linked.filter((r) => !r.ok).length,
      added: results.reduce((a, r) => a + (r.added ?? 0), 0), cancelled: results.reduce((a, r) => a + (r.cancelled ?? 0), 0), clashes: clashes.length });
    return json({ ok: true, results }, 200, h);
  } catch (e) {
    log('ical_sync_error', { message: String(e) });
    return json({ error: 'server' }, 500, h);
  }
});
