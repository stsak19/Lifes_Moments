// Sends the guest emails through Resend: request received, confirmed, before arrival, cancelled,
// rejected, expired, and the offers owners schedule. The look and wording are in templates.ts.
// Who calls it:
//  - database triggers (header x-cron-secret): one email for one booking request
//  - pg_cron (x-cron-secret): { action: 'scan' } hourly (before-arrival emails + retry of failed ones)
//                              { action: 'run_offers' } every 10 minutes (scheduled offers)
//  - the admin page (owner login): preview and test sends
// Needs the Resend key: Edge Function secret RESEND_API_KEY, or the Vault secret "resend_api_key".
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildGuestMail, buildOfferMail, GUEST_KINDS, type GuestKind, type Guest, type Mail, type Offer, type Settings } from './templates.ts';
import { unsubUrl } from '../_shared/unsub.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const ALLOWED = ['https://stsak19.github.io', 'http://localhost:8765'];
const DAY = 86400000;
const RETRY_WINDOW_H = 48;   // a failed email is tried again for this long
const RETRY_MAX = 5;         // ...and at most this many times
const OFFER_BATCH = 30;      // offer emails per 10-minute run (Resend free plan: 100 a day)
const PAUSE_MS = 600;        // Resend allows 2 requests a second

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(o) ? o : ALLOWED[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}
const json = (body: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json' } });
const log = (event: string, f: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, ...f }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const athensDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(d);
const athensHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', hour: '2-digit', hour12: false }).format(new Date())) % 24;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

// ---------- sending ----------
async function resendKey(): Promise<string | null> {
  const env = Deno.env.get('RESEND_API_KEY');
  if (env) return env;
  const { data } = await admin.rpc('server_secret', { p_name: 'resend_api_key' });
  return (data as string | null) ?? null;
}
async function cronSecret(): Promise<string | null> {
  const { data } = await admin.rpc('server_secret', { p_name: 'cron_secret' });
  return (data as string | null) ?? null;
}
type SendOpts = { idem?: string; bcc?: boolean; headers?: Record<string, string> };
async function sendMail(s: Settings, to: string, m: Mail, o: SendOpts = {}) {
  const key = await resendKey();
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not set', id: undefined as string | undefined };
  const fromName = String(s.from_name ?? '').replace(/[<>",\r\n]/g, '').trim() || 'Life\'s Moments';
  const payload: Record<string, unknown> = { from: fromName + ' <' + s.from_email + '>', to: [to], subject: m.subject, html: m.html, text: m.text };
  if (s.reply_to) payload.reply_to = s.reply_to;
  if (o.bcc !== false && s.owner_copy_email) payload.bcc = [s.owner_copy_email];
  if (o.headers) payload.headers = o.headers;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(o.idem ? { 'Idempotency-Key': o.idem } : {}) },
    body: JSON.stringify(payload)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (res.status + ' ' + (j?.message ?? '')).trim().slice(0, 300), id: undefined };
  return { ok: true, error: undefined, id: j?.id as string | undefined };
}

async function loadSettings(): Promise<Settings> {
  const { data, error } = await admin.from('email_settings').select('*').eq('id', 1).single();
  if (error || !data) throw new Error('settings: ' + (error?.message ?? 'missing'));
  return data;
}
async function record(request_id: string | null, kind: string, to: string, status: string, error?: string, provider_id?: string) {
  const { error: e } = await admin.from('email_log').insert({ request_id, kind, to_email: to, status, error: error ?? null, provider_id: provider_id ?? null });
  if (e && e.code !== '23505') log('email_log_error', { message: e.message });
}

// ---------- a guest email for a real request ----------
const COLS = 'id, name, email, lang, unit_type, unit, check_in, check_out, guests, status, is_test, ref_no, price_total, price_paid';
const STATUS_FOR: Record<GuestKind, string> = { received: 'pending', confirmed: 'confirmed', prearrival: 'confirmed', cancelled: 'cancelled', rejected: 'rejected', expired: 'expired' };

async function guestEmail(requestId: string, kind: GuestKind, s?: Settings, quiet = false) {
  s ??= await loadSettings();
  const { data: r } = await admin.from('booking_requests').select(COLS).eq('id', requestId).maybeSingle();
  if (!r) return { skipped: 'not_found' };
  const to = r.email as string;
  if (!s.enabled) { if (!quiet) await record(r.id, kind, to, 'skipped', 'emails switched off'); return { skipped: 'disabled' }; }
  if (r.is_test) { if (!quiet) await record(r.id, kind, to, 'skipped', 'test request'); return { skipped: 'test' }; }
  if (r.status !== STATUS_FOR[kind]) { if (!quiet) await record(r.id, kind, to, 'skipped', 'status is ' + r.status); return { skipped: 'status' }; }
  if (kind === 'prearrival' && r.check_in < athensDate()) return { skipped: 'past' };

  const { data: prior } = await admin.from('email_log').select('status').eq('request_id', r.id).eq('kind', kind).in('status', ['sent', 'failed']);
  if (prior?.some((p) => p.status === 'sent')) return { skipped: 'already_sent' };
  const attempt = (prior?.length ?? 0) + 1;

  const mail = buildGuestMail(kind, r as Guest, s);
  const res = await sendMail(s, to, mail, { idem: r.id + '-' + kind + '-' + attempt });
  if (!res.ok) { log('email_failed', { id: r.id, kind, attempt, error: res.error }); await record(r.id, kind, to, 'failed', res.error); return { error: res.error }; }
  await record(r.id, kind, to, 'sent', undefined, res.id);
  log('email_sent', { id: r.id, kind });
  return { sent: true };
}

// ---------- hourly: before-arrival emails and retries ----------
async function scan() {
  const s = await loadSettings();
  const out = { prearrival: 0, retried: 0, errors: 0 };
  if (!s.enabled) return { ...out, skipped: 'disabled' };

  // Retry what failed (a wrong sender, Resend down, a domain not verified yet...). guestEmail re-checks the status first.
  const since = new Date(Date.now() - RETRY_WINDOW_H * 3600000).toISOString();
  const { data: failed } = await admin.from('email_log').select('request_id, kind').eq('status', 'failed').not('request_id', 'is', null).gte('created_at', since).in('kind', [...GUEST_KINDS]);
  const tries = new Map<string, number>();
  for (const f of failed ?? []) { const k = f.request_id + '|' + f.kind; tries.set(k, (tries.get(k) ?? 0) + 1); }
  for (const [k, n] of tries) {
    if (n >= RETRY_MAX) continue;
    const [id, kind] = k.split('|');
    try { const r = await guestEmail(id, kind as GuestKind, s, true); if ((r as any).sent) out.retried++; } catch (e) { out.errors++; log('retry_error', { id, kind, message: String(e) }); }
    await sleep(PAUSE_MS);
  }

  // Before arrival: only during the day in Greece, for confirmed bookings that were confirmed at least 12 hours ago.
  const hour = athensHour();
  if (hour >= 10 && hour < 20) {
    const today = athensDate();
    const days = Math.min(14, Math.max(1, Number(s.prearrival_days) || 3));
    const { data: rows } = await admin.from('booking_requests').select('id, decided_at')
      .eq('status', 'confirmed').eq('is_test', false).gt('check_in', today).lte('check_in', addDays(today, days)).limit(100);
    const ready = (rows ?? []).filter((r) => !r.decided_at || Date.parse(r.decided_at) <= Date.now() - 12 * 3600000);
    for (const r of ready) {
      try { const res = await guestEmail(r.id, 'prearrival', s, true); if ((res as any).sent) out.prearrival++; } catch (e) { out.errors++; log('prearrival_error', { id: r.id, message: String(e) }); }
      await sleep(PAUSE_MS);
    }
  }
  log('scan_done', out);
  return out;
}

// ---------- every 10 minutes: scheduled offers ----------
/** Each guest gets their own code for an offer, e.g. THASOS-K7M3QPX: the offer's code (or LM) plus 7 letters
 *  signed from the offer and the guest's email, so a resend gives the same code. It works only with that email. */
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function personalCode(offerId: string, prefix: string | null | undefined, email: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('promo|' + offerId + '|' + email.toLowerCase())));
  let tail = '';
  for (let i = 0; i < 7; i++) tail += CODE_ABC[mac[i] % CODE_ABC.length];
  const head = String(prefix ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) || 'LM';
  return head + '-' + tail;
}
async function offerMail(o: Offer & { id?: string }, to: { name: string; lang: string; email: string }, s: Settings, secret: string) {
  const link = await unsubUrl(URL_ + '/functions/v1', secret, to.email);
  const code = await personalCode(o.id ?? 'preview', o.code, to.email, secret);
  return { mail: buildOfferMail({ ...o, code }, to, s, link), link, code };
}

async function runOffers() {
  const s = await loadSettings();
  if (!s.enabled) return { skipped: 'disabled' };
  const secret = await cronSecret();
  if (!secret) return { error: 'no_secret' };
  const nowIso = new Date().toISOString();
  const { data: due } = await admin.from('promo_offers').select('*').lte('send_at', nowIso)
    .or('status.eq.scheduled,and(status.eq.sending,lease_until.lt.' + nowIso + ')');
  const summary: Record<string, unknown>[] = [];

  for (const o of due ?? []) {
    // Claim it so two runs never send the same offer at once (the lease runs out if a run dies).
    let claim = admin.from('promo_offers').update({ status: 'sending', lease_until: new Date(Date.now() + 8 * 60000).toISOString() }).eq('id', o.id).eq('status', o.status);
    if (o.status === 'sending') claim = claim.lt('lease_until', nowIso);
    const { data: got } = await claim.select('id');
    if (!got?.length) continue;

    const { data: audience } = await admin.rpc('promo_audience');
    const { data: done } = await admin.from('promo_sends').select('email, status, attempts').eq('offer_id', o.id);
    const state = new Map((done ?? []).map((d) => [d.email, d]));
    const todo = (audience ?? []).filter((a: any) => { const d = state.get(a.email); return !d || (d.status === 'failed' && d.attempts < 3); });

    let sent = 0, failed = 0;
    for (const a of (todo as { email: string; name: string; lang: string }[]).slice(0, OFFER_BATCH)) {
      const { mail, link, code } = await offerMail(o as Offer & { id: string }, a, s, secret);
      const attempts = (state.get(a.email)?.attempts ?? 0) + 1;
      const res = await sendMail(s, a.email, mail, {
        idem: 'offer-' + o.id + '-' + a.email + '-' + attempts, bcc: false,
        headers: { 'List-Unsubscribe': '<' + link + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      });
      await admin.from('promo_sends').upsert({ offer_id: o.id, email: a.email, code, status: res.ok ? 'sent' : 'failed', attempts, error: res.ok ? null : res.error, provider_id: res.id ?? null, updated_at: new Date().toISOString() }, { onConflict: 'offer_id,email' });
      if (res.ok) sent++; else { failed++; log('offer_email_failed', { offer: o.id, error: res.error }); }
      await sleep(PAUSE_MS);
    }

    const { data: all } = await admin.from('promo_sends').select('email, status, attempts').eq('offer_id', o.id);
    const final = new Map((all ?? []).map((d) => [d.email, d]));
    const left = (audience ?? []).filter((a: any) => { const d = final.get(a.email); return !d || (d.status === 'failed' && d.attempts < 3); }).length;
    const sentTotal = (all ?? []).filter((d) => d.status === 'sent').length;
    const failedTotal = (all ?? []).filter((d) => d.status === 'failed').length;
    await admin.from('promo_offers').update(left === 0
      ? { status: 'sent', sent_count: sentTotal, failed_count: failedTotal, lease_until: null, finished_at: new Date().toISOString() }
      : { status: 'sending', sent_count: sentTotal, failed_count: failedTotal, lease_until: new Date().toISOString() }).eq('id', o.id);
    log('offer_run', { offer: o.id, sent, failed, left });
    summary.push({ offer: o.id, sent, failed, left });
  }
  return { offers: summary };
}

// ---------- admin preview / test ----------
function sample(lang: string): Guest {
  const d = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  return { name: lang === 'en' ? 'Maria Smith' : 'Μαρία Παπαδοπούλου', lang, unit_type: 'room', unit: 'r3', check_in: d(30), check_out: d(34), guests: 2, ref_no: 1042 };
}
function sampleOffer(): Offer {
  const d = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  return { discount_pct: 15, code: 'THASOS15', stay_from: d(30), stay_to: d(75), book_by: d(20) };
}
function readOffer(v: any): Offer | null {
  if (!v || typeof v !== 'object') return null;
  const pct = Number(v.discount_pct), iso = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
  if (!Number.isInteger(pct) || pct < 1 || pct > 90 || !iso(v.stay_from) || !iso(v.stay_to)) return null;
  const code = typeof v.code === 'string' && /^[A-Za-z0-9_-]{3,24}$/.test(v.code) ? v.code : null;
  return { discount_pct: pct, code, stay_from: v.stay_from, stay_to: v.stay_to, book_by: iso(v.book_by) ? v.book_by : null };
}

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: h });
  if (req.method !== 'POST') return json({ error: 'method' }, 405, h);

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, h); }

  try {
    // 1) from the database and the schedules
    const cron = req.headers.get('x-cron-secret');
    if (cron) {
      const expected = await cronSecret();
      if (!expected || cron !== expected) return json({ error: 'forbidden' }, 403, h);
      if (b.action === 'scan') return json(await scan(), 200, h);
      if (b.action === 'run_offers') return json(await runOffers(), 200, h);
      if (typeof b.request_id !== 'string' || !(GUEST_KINDS as readonly string[]).includes(String(b.kind))) return json({ error: 'bad_input' }, 400, h);
      return json(await guestEmail(b.request_id, String(b.kind) as GuestKind), 200, h);
    }

    // 2) from the admin page: owners only
    const auth = req.headers.get('authorization') ?? '';
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: who } = await user.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    const { data: owner } = await user.rpc('is_owner');
    if (!who?.user || owner !== true) return json({ error: 'not_owner' }, 403, h);

    const kind = String(b.kind ?? '');
    const lang = b.lang === 'en' ? 'en' : 'el';
    const isOffer = kind === 'offer';
    if (!isOffer && !(GUEST_KINDS as readonly string[]).includes(kind)) return json({ error: 'bad_input' }, 400, h);
    const s = await loadSettings();

    let mail: Mail;
    if (isOffer) {
      const offer = readOffer(b.offer) ?? sampleOffer();
      const secret = (await cronSecret()) ?? 'preview';
      const g = sample(lang);
      mail = (await offerMail(offer, { name: g.name, lang, email: who.user.email ?? 'preview@example.com' }, s, secret)).mail;
    } else {
      mail = buildGuestMail(kind as GuestKind, sample(lang), s);
    }

    if (b.action === 'preview') return json(mail, 200, h);
    if (b.action === 'test') {
      const to = who.user.email;
      if (!to) return json({ error: 'no_email' }, 400, h);
      const testMail = { ...mail, subject: '[ΔΟΚΙΜΗ] ' + mail.subject };
      let target = to;
      let res = await sendMail(s, target, testMail, { bcc: false });
      // Without a verified domain Resend only delivers to the address of the Resend account, which may differ
      // from the owner's login email. Its error names that address, so retry once there.
      if (!res.ok) {
        const m = /own email address \(([^)\s]+@[^)\s]+)\)/.exec(res.error ?? '');
        if (m && m[1].toLowerCase() !== to.toLowerCase()) { target = m[1]; res = await sendMail(s, target, testMail, { bcc: false }); }
      }
      await record(null, kind, target, res.ok ? 'sent' : 'failed', res.ok ? undefined : res.error, res.ok ? res.id : undefined);
      return json(res.ok ? { ok: true, to: target } : { ok: false, error: res.error }, 200, h);
    }
    return json({ error: 'action' }, 400, h);
  } catch (e) {
    log('send_email_error', { message: String(e) });
    return json({ error: 'server' }, 500, h);
  }
});
