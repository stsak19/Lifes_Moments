// Emails a message an owner wrote in the admin (Μηνύματα) to the guest of that booking request.
// Called by the admin page with the owner's login: { message_id }. The message row is in public.request_messages;
// this function sends it through Resend and writes the result back on the row (email_status, email_error).
// Uses the same email settings (sender, reply-to, address) and the same Resend key as send-email.
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const ALLOWED = ['https://stsak19.github.io', 'http://localhost:8765'];

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(o) ? o : ALLOWED[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}
const json = (body: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json' } });
const log = (event: string, f: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, ...f }));
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

async function resendKey(): Promise<string | null> {
  const env = Deno.env.get('RESEND_API_KEY');
  if (env) return env;
  const { data } = await admin.rpc('server_secret', { p_name: 'resend_api_key' });
  return (data as string | null) ?? null;
}

type Req = { name: string; email: string; lang: string; unit_type: string; unit: string | null; check_in: string; check_out: string; ref_no: number | null; is_test: boolean };

function build(r: Req, body: string, s: Record<string, any>) {
  const en = r.lang === 'en';
  const tr = (el: string, x: string) => (en ? x : el);
  const loc = en ? 'en-GB' : 'el-GR';
  const day = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const m = r.unit ? /^r(\d+)$/.exec(r.unit) : null;
  const unit = m ? tr('Δωμάτιο ', 'Room ') + m[1] : (r.unit_type === 'apt' ? tr('Διαμέρισμα', 'Apartment') : tr('Δωμάτιο', 'Room'));
  const ref = r.ref_no ? 'LM-' + r.ref_no : '';
  const stay = day(r.check_in) + ' – ' + day(r.check_out) + ' · ' + unit + (ref ? ' · ' + ref : '');
  const addr = String(s.address ?? '').split('\n').map((x) => x.trim()).filter(Boolean).join(', ');
  const canReply = !!String(s.reply_to ?? '').trim();
  const text = body.replace(/\r/g, '').trim();
  const subject = tr('Μήνυμα για την κράτησή σου – Life’s Moments', 'A message about your booking – Life’s Moments');
  const html = `<!doctype html><html lang="${en ? 'en' : 'el'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#eaf1f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eaf1f8;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:18px;">
<tr><td style="padding:30px 36px 6px 36px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:1.5px;color:#7a98b8;font-weight:600;">${esc(tr('ΜΗΝΥΜΑ ΑΠΟ ΤΟ LIFE’S MOMENTS', 'A MESSAGE FROM LIFE’S MOMENTS'))}</td></tr>
<tr><td style="padding:14px 36px 4px 36px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#2b3a4a;">${esc(text).replace(/\n/g, '<br>')}</td></tr>
<tr><td style="padding:22px 36px 0 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f8fc;border-radius:12px;"><tr><td style="padding:14px 18px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#4b5d70;"><strong style="color:#163f73;">${esc(tr('Η κράτησή σου', 'Your booking'))}</strong><br>${esc(stay)}</td></tr></table></td></tr>
${canReply ? `<tr><td style="padding:18px 36px 0 36px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#4b5d70;">${esc(tr('Μπορείς να απαντήσεις κατευθείαν σε αυτό το email.', 'You can reply directly to this email.'))}</td></tr>` : ''}
<tr><td style="padding:24px 36px 30px 36px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4b5d70;">${esc(tr('Με εκτίμηση,', 'Kind regards,'))}<br><strong style="color:#2b3a4a;">${esc(tr('η ομάδα του Life’s Moments', 'the Life’s Moments team'))}</strong></td></tr>
</table>
<div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#8aa1b8;padding:16px 12px;">Life&#8217;s Moments${addr ? ' · ' + esc(addr) : ''}</div>
</td></tr></table></body></html>`;
  const plain = text + '\n\n' + tr('Η κράτησή σου', 'Your booking') + ': ' + stay + '\n\n'
    + (canReply ? tr('Μπορείς να απαντήσεις κατευθείαν σε αυτό το email.', 'You can reply directly to this email.') + '\n\n' : '')
    + tr('Με εκτίμηση,', 'Kind regards,') + '\n' + tr('η ομάδα του Life’s Moments', 'the Life’s Moments team')
    + '\n--\nLife’s Moments' + (addr ? ' · ' + addr : '');
  return { subject, html, text: plain };
}

async function send(messageId: string) {
  const { data: m } = await admin.from('request_messages').select('id, request_id, sender, body, email_status').eq('id', messageId).maybeSingle();
  if (!m || m.sender !== 'owner') return { error: 'not_found' };
  if (m.email_status === 'sent') return { ok: true, already: true };
  const { data: r } = await admin.from('booking_requests').select('name, email, lang, unit_type, unit, check_in, check_out, ref_no, is_test').eq('id', m.request_id).maybeSingle();
  if (!r || !r.email) return { error: 'no_guest' };
  const done = async (ok: boolean, error?: string) => {
    await admin.from('request_messages').update(ok ? { email_status: 'sent', email_error: error ?? null } : { email_status: 'failed', email_error: (error ?? '').slice(0, 300) }).eq('id', m.id);
  };
  if (r.is_test) { await done(true, 'test request, not emailed'); return { ok: true, test: true }; }
  const { data: s } = await admin.from('email_settings').select('*').eq('id', 1).single();
  if (!s) { await done(false, 'email settings missing'); return { ok: false, error: 'settings' }; }
  if (s.enabled === false) { await done(false, 'emails switched off'); return { ok: false, error: 'emails switched off' }; }
  const key = await resendKey();
  if (!key) { await done(false, 'RESEND_API_KEY is not set'); return { ok: false, error: 'no key' }; }
  const mail = build(r as Req, m.body, s);
  const fromName = String(s.from_name ?? '').replace(/[<>",\r\n]/g, '').trim() || 'Life\'s Moments';
  const payload: Record<string, unknown> = { from: fromName + ' <' + s.from_email + '>', to: [r.email], subject: mail.subject, html: mail.html, text: mail.text };
  if (s.reply_to) payload.reply_to = s.reply_to;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': 'msg-' + m.id },
    body: JSON.stringify(payload)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = (res.status + ' ' + (j?.message ?? '')).trim();
    await done(false, error);
    log('message_failed', { id: m.id, error });
    return { ok: false, error };
  }
  await done(true);
  log('message_sent', { id: m.id });
  return { ok: true };
}

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: h });
  if (req.method !== 'POST') return json({ error: 'method' }, 405, h);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, h); }
  try {
    const auth = req.headers.get('authorization') ?? '';
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: who } = await user.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    const { data: owner } = await user.rpc('is_owner');
    if (!who?.user || owner !== true) return json({ error: 'not_owner' }, 403, h);
    if (typeof b.message_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.message_id)) return json({ error: 'bad_input' }, 400, h);
    return json(await send(b.message_id), 200, h);
  } catch (e) {
    log('guest_message_error', { message: String(e) });
    return json({ error: 'server' }, 500, h);
  }
});
