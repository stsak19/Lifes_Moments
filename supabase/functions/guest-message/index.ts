// Emails a message an owner wrote in the admin (Μηνύματα) to the guest of that booking request.
// Called by the admin page with the owner's login: { message_id }. The message row is in public.request_messages;
// this function sends it through Resend and writes the result back on the row (email_status, email_error).
// Uses the same email settings (sender, reply-to, address), the same Resend key and the same look as send-email
// (the email is built by buildMessageMail in ../send-email/templates.ts).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildMessageMail, type Guest } from '../send-email/templates.ts';

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

async function resendKey(): Promise<string | null> {
  const env = Deno.env.get('RESEND_API_KEY');
  if (env) return env;
  const { data } = await admin.rpc('server_secret', { p_name: 'resend_api_key' });
  return (data as string | null) ?? null;
}

type Req = Guest & { email: string; is_test: boolean };

async function send(messageId: string) {
  const { data: m } = await admin.from('request_messages').select('id, request_id, sender, body, email_status').eq('id', messageId).maybeSingle();
  if (!m || m.sender !== 'owner') return { error: 'not_found' };
  if (m.email_status === 'sent') return { ok: true, already: true };
  const { data: r } = await admin.from('booking_requests').select('name, email, lang, unit_type, unit, check_in, check_out, guests, ref_no, is_test').eq('id', m.request_id).maybeSingle();
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
  const mail = buildMessageMail(r as Req, m.body, s);
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
