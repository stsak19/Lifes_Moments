// Public: the site sends a booking request here. Checks it, saves it and alerts the owners.
import { admin, cors, json, log, notify, what } from '../_shared/core.ts';

const DAY = 86400000;
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const athensToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: h });
  if (req.method !== 'POST') return json({ error: 'method' }, 405, h);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, h); }
  if (b.website) return json({ ok: true, id: null }, 200, h); // hidden field only bots fill in

  // The owners can stop new requests from the admin (Settings → Αιτήματα από το σάιτ).
  const { data: open } = await admin.rpc('site_open');
  if (open === false) return json({ error: 'closed' }, 403, h);

  const unit_type = b.unit_type === 'apt' ? 'apt' : b.unit_type === 'room' ? 'room' : null;
  const check_in = b.check_in, check_out = b.check_out;
  const guests = Number(b.guests);
  const name = String(b.name ?? '').trim().replace(/\s+/g, ' ');
  const email = String(b.email ?? '').trim().toLowerCase();
  const phone = String(b.phone ?? '').trim();
  // The guest's message to the owners (optional) and a discount code (optional, typed or from an offer email).
  const note = String(b.note ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 1000) || null;
  const promoRaw = String(b.promo ?? '').trim();
  const promo = /^[A-Za-z0-9_-]{3,24}$/.test(promoRaw) ? promoRaw.toUpperCase() : null;
  const marketing = b.marketing === true; // the optional tick for offers; never assumed
  const lang = b.lang === 'en' ? 'en' : 'el';

  const bad: string[] = [];
  if (!unit_type) bad.push('unit_type');
  if (!isDate(check_in) || !isDate(check_out)) bad.push('dates');
  else {
    const nights = (Date.parse(check_out) - Date.parse(check_in)) / DAY;
    if (nights < 1 || nights > 30) bad.push('nights');
    if (check_in < athensToday()) bad.push('past');
    if (Date.parse(check_in) - Date.now() > 550 * DAY) bad.push('too_far');
  }
  if (!Number.isInteger(guests) || guests < 1 || guests > (unit_type === 'apt' ? 5 : 3)) bad.push('guests');
  if (name.length < 2 || name.length > 120) bad.push('name');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad.push('email');
  if (phone.replace(/\D/g, '').length < 8 || phone.length > 40) bad.push('phone');
  if (bad.length) return json({ error: 'invalid', fields: bad }, 400, h);

  // A code is checked again here: it must be this guest's own code (sent to this email) and valid for these nights.
  let discount_pct: number | null = null;
  if (promoRaw && !promo) return json({ error: 'promo', promo: 'invalid' }, 400, h);
  if (promo) {
    const { data: pc, error: pcErr } = await admin.rpc('promo_check', { p_code: promo, p_email: email, p_in: check_in, p_out: check_out });
    if (pcErr) { log('promo_check_error', { message: pcErr.message }); return json({ error: 'server' }, 500, h); }
    if (!pc || pc.status !== 'ok') return json({ error: 'promo', promo: pc?.status ?? 'invalid' }, 400, h);
    discount_pct = Number(pc.pct);
  }

  // Same request sent twice (double tap, retry): answer with the first one.
  const { data: same } = await admin.from('booking_requests').select('id, ref_no')
    .eq('email', email).eq('unit_type', unit_type).eq('check_in', check_in).eq('check_out', check_out)
    .eq('status', 'pending').limit(1);
  if (same?.length) return json({ ok: true, id: same[0].id, ref: same[0].ref_no, repeat: true }, 200, h);

  // Simple limits against floods.
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const [{ count: mine }, { count: all }] = await Promise.all([
    admin.from('booking_requests').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', hourAgo),
    admin.from('booking_requests').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 600000).toISOString())
  ]);
  if ((mine ?? 0) >= 5 || (all ?? 0) >= 40) { log('request_limited', { mine, all }); return json({ error: 'too_many' }, 429, h); }

  const { data: fits, error: fitErr } = await admin.rpc('request_fits', { p_type: unit_type, p_in: check_in, p_out: check_out });
  if (fitErr) { log('fits_error', { message: fitErr.message }); return json({ error: 'server' }, 500, h); }
  if (!fits) return json({ error: 'full' }, 409, h);

  const { data: row, error } = await admin.from('booking_requests')
    .insert({ unit_type, check_in, check_out, guests, name, email, phone, note, lang, marketing_consent: marketing, promo_code: discount_pct ? promo : null, discount_pct })
    .select('id, name, unit_type, check_in, check_out, guests, ref_no').single();
  if (error) { log('insert_error', { message: error.message }); return json({ error: 'server' }, 500, h); }
  log('request_saved', { id: row.id, unit_type, nights: (Date.parse(check_out as string) - Date.parse(check_in as string)) / DAY });

  try {
    const r = await notify({ title: 'Νέο αίτημα κράτησης', body: what(row) + (discount_pct ? '\nΚωδικός ' + promo + ' · −' + discount_pct + '%' : '') + '\nΑπάντησε μέσα σε 24 ώρες.', url: 'admin.html?req=' + row.id, tag: 'req-' + row.id });
    log('request_notified', { id: row.id, ...r });
  } catch (e) {
    log('notify_error', { id: row.id, message: String(e) }); // the request is saved either way
  }
  return json({ ok: true, id: row.id, ref: row.ref_no, discount_pct }, 200, h);
});
