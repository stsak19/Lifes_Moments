// Sends the guest emails (request received / confirmed / rejected / expired) through Resend.
// Called by database triggers (header x-cron-secret) and by the admin page (owner login) for preview / test.
// The wording comes from public.email_templates and public.email_settings, which owners edit in the admin page.
// Needs the Edge Function secret RESEND_API_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const ALLOWED = ['https://stsak19.github.io', 'http://localhost:8765'];
const KINDS = ['received', 'confirmed', 'rejected', 'expired'];

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

// ---------- rendering ----------
type Settings = Record<string, any>;
type Guest = { name: string; lang: string; unit_type: string; unit: string | null; check_in: string; check_out: string; guests: number };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function fmtDate(iso: string, lang: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString(lang === 'en' ? 'en-GB' : 'el-GR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function typeLabel(t: string, lang: string) {
  return t === 'apt' ? (lang === 'en' ? 'Apartment' : 'Διαμέρισμα') : (lang === 'en' ? 'Room' : 'Δωμάτιο');
}
function unitLabel(g: Guest, lang: string) {
  const m = /^r(\d+)$/.exec(g.unit ?? '');
  if (m) return (lang === 'en' ? 'Room ' : 'Δωμάτιο ') + m[1];
  return typeLabel(g.unit_type, lang);
}
function vars(g: Guest, s: Settings): Record<string, string> {
  const lang = g.lang === 'en' ? 'en' : 'el';
  const nights = Math.round((Date.parse(g.check_out) - Date.parse(g.check_in)) / 86400000);
  return {
    name: g.name,
    check_in: fmtDate(g.check_in, lang),
    check_out: fmtDate(g.check_out, lang),
    nights: String(nights),
    guests: String(g.guests),
    unit_type: typeLabel(g.unit_type, lang),
    unit: unitLabel(g, lang),
    checkin_time: s.checkin_time ?? '',
    checkout_time: s.checkout_time ?? '',
    address: s.address ?? '',
    maps_url: s.maps_url ?? '',
    phone: s.phone ?? '',
    arrival: (lang === 'en' ? s.arrival_en : s.arrival_el) ?? '',
    extra: (lang === 'en' ? s.extra_en : s.extra_el) ?? '',
    site_url: s.site_url ?? ''
  };
}
/** Fills {{placeholders}}. A line whose placeholders are all empty is dropped, so unfilled settings leave no gaps. */
function fill(tpl: string, v: Record<string, string>): string {
  const out: string[] = [];
  for (const line of tpl.replace(/\r/g, '').split('\n')) {
    const ph = [...line.matchAll(/\{\{\s*(\w+)\s*\}\}/g)];
    if (ph.length && ph.every((m) => !(v[m[1]] ?? '').trim())) continue;
    out.push(line.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => v[k] ?? ''));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function toHtml(text: string): string {
  const body = esc(text)
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => '<a href="' + u + '" style="color:#0b6e8a">' + u + '</a>')
    .replace(/\n/g, '<br>');
  return '<!doctype html><html><body style="margin:0;background:#f4f1ec;padding:24px 12px">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222">' +
    '<div style="background:#0b6e8a;color:#fff;padding:18px 24px;font-size:18px;font-weight:600">Life\'s Moments</div>' +
    '<div style="padding:24px;font-size:15px;line-height:1.6">' + body + '</div></div></body></html>';
}
function render(tpl: { subject: string; body: string }, g: Guest, s: Settings) {
  const v = vars(g, s);
  const subject = fill(tpl.subject, v).replace(/[\r\n]+/g, ' ').slice(0, 200);
  const text = fill(tpl.body, v);
  return { subject, text, html: toHtml(text) };
}

// ---------- sending ----------
async function sendMail(s: Settings, to: string, m: { subject: string; text: string; html: string }, idem?: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not set' };
  const fromName = String(s.from_name ?? '').replace(/[<>",\r\n]/g, '').trim() || 'Life\'s Moments';
  const payload: Record<string, unknown> = { from: fromName + ' <' + s.from_email + '>', to: [to], subject: m.subject, html: m.html, text: m.text };
  if (s.reply_to) payload.reply_to = s.reply_to;
  if (s.owner_copy_email) payload.bcc = [s.owner_copy_email];
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(idem ? { 'Idempotency-Key': idem } : {}) },
    body: JSON.stringify(payload)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (res.status + ' ' + (j?.message ?? '')).trim().slice(0, 300) };
  return { ok: true, id: j?.id as string | undefined };
}

async function loadSettings(): Promise<Settings> {
  const { data, error } = await admin.from('email_settings').select('*').eq('id', 1).single();
  if (error || !data) throw new Error('settings: ' + (error?.message ?? 'missing'));
  return data;
}
async function loadTemplate(kind: string, lang: string) {
  const { data } = await admin.from('email_templates').select('subject, body').eq('kind', kind).eq('lang', lang).maybeSingle();
  if (data) return data;
  const { data: el } = await admin.from('email_templates').select('subject, body').eq('kind', kind).eq('lang', 'el').maybeSingle();
  return el;
}
async function record(request_id: string | null, kind: string, to: string, status: string, error?: string, provider_id?: string) {
  const { error: e } = await admin.from('email_log').insert({ request_id, kind, to_email: to, status, error: error ?? null, provider_id: provider_id ?? null });
  if (e && e.code !== '23505') log('email_log_error', { message: e.message });
}

// ---------- a guest email for a real request (called by the database) ----------
async function guestEmail(requestId: string, kind: string) {
  const s = await loadSettings();
  const { data: r } = await admin.from('booking_requests')
    .select('id, name, email, lang, unit_type, unit, check_in, check_out, guests, status, is_test').eq('id', requestId).maybeSingle();
  if (!r) return { skipped: 'not_found' };
  const to = r.email as string;
  if (!s.enabled) { await record(r.id, kind, to, 'skipped', 'emails switched off'); return { skipped: 'disabled' }; }
  if (r.is_test) { await record(r.id, kind, to, 'skipped', 'test request'); return { skipped: 'test' }; }
  const wanted = kind === 'received' ? 'pending' : kind;
  if (r.status !== wanted) { await record(r.id, kind, to, 'skipped', 'status is ' + r.status); return { skipped: 'status' }; }

  const { data: done } = await admin.from('email_log').select('id').eq('request_id', r.id).eq('kind', kind).eq('status', 'sent').limit(1);
  if (done?.length) return { skipped: 'already_sent' };

  const tpl = await loadTemplate(kind, r.lang === 'en' ? 'en' : 'el');
  if (!tpl) { await record(r.id, kind, to, 'failed', 'no template'); return { error: 'no_template' }; }
  const mail = render(tpl, r as Guest, s);
  const res = await sendMail(s, to, mail, r.id + '-' + kind);
  if (!res.ok) { log('email_failed', { id: r.id, kind, error: res.error }); await record(r.id, kind, to, 'failed', res.error); return { error: res.error }; }
  await record(r.id, kind, to, 'sent', undefined, res.id);
  log('email_sent', { id: r.id, kind });
  return { sent: true };
}

// ---------- admin preview / test ----------
function sample(lang: string): Guest {
  const d = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  return { name: lang === 'en' ? 'Maria Smith' : 'Μαρία Παπαδοπούλου', lang, unit_type: 'room', unit: 'r3', check_in: d(30), check_out: d(34), guests: 2 };
}

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: h });
  if (req.method !== 'POST') return json({ error: 'method' }, 405, h);

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, h); }

  try {
    // 1) from the database triggers
    const cron = req.headers.get('x-cron-secret');
    if (cron) {
      const { data: expected } = await admin.rpc('server_secret', { p_name: 'cron_secret' });
      if (!expected || cron !== expected) return json({ error: 'forbidden' }, 403, h);
      if (typeof b.request_id !== 'string' || !KINDS.includes(String(b.kind))) return json({ error: 'bad_input' }, 400, h);
      return json(await guestEmail(b.request_id, String(b.kind)), 200, h);
    }

    // 2) from the admin page: owners only
    const auth = req.headers.get('authorization') ?? '';
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: who } = await user.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    const { data: owner } = await user.rpc('is_owner');
    if (!who?.user || owner !== true) return json({ error: 'not_owner' }, 403, h);

    const kind = String(b.kind ?? '');
    const lang = b.lang === 'en' ? 'en' : 'el';
    if (!KINDS.includes(kind)) return json({ error: 'bad_input' }, 400, h);
    const s = await loadSettings();
    // The admin can preview unsaved edits by sending the draft subject/body.
    const draft = typeof b.subject === 'string' && typeof b.body === 'string' ? { subject: b.subject.slice(0, 200), body: b.body.slice(0, 8000) } : null;
    const tpl = draft ?? await loadTemplate(kind, lang);
    if (!tpl) return json({ error: 'no_template' }, 404, h);
    const mail = render(tpl, sample(lang), s);

    if (b.action === 'preview') return json(mail, 200, h);
    if (b.action === 'test') {
      const to = who.user.email;
      if (!to) return json({ error: 'no_email' }, 400, h);
      const res = await sendMail(s, to, { ...mail, subject: '[ΔΟΚΙΜΗ] ' + mail.subject });
      await record(null, kind, to, res.ok ? 'sent' : 'failed', res.ok ? undefined : res.error, res.ok ? res.id : undefined);
      return json(res.ok ? { ok: true, to } : { ok: false, error: res.error }, 200, h);
    }
    return json({ error: 'action' }, 400, h);
  } catch (e) {
    log('send_email_error', { message: String(e) });
    return json({ error: 'server' }, 500, h);
  }
});
