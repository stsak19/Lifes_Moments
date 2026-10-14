// Public: the "unsubscribe" link of the offer emails. Needs no login; the signed token in the link is the proof.
//  - POST (the unsubscribe page, or a mail app's one-click unsubscribe) records the opt-out.
//  - GET (someone opening the link, or a mail scanner) only sends the person to the confirm page,
//    so a scanner can never unsubscribe anybody by accident.
import { admin, cors, json, log } from '../_shared/core.ts';
import { unsubValid } from '../_shared/unsub.ts';

const FALLBACK_PAGE = 'https://stsak19.github.io/lifes_moments/unsubscribe.html';

async function page(): Promise<string> {
  const { data } = await admin.from('email_settings').select('site_url').eq('id', 1).maybeSingle();
  try { return new URL('unsubscribe.html', data?.site_url ?? FALLBACK_PAGE).toString(); } catch { return FALLBACK_PAGE; }
}

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: h });
  const q = new URL(req.url).searchParams;

  if (req.method === 'GET') {
    const to = new URL(await page());
    if (q.get('e')) to.searchParams.set('e', q.get('e')!);
    if (q.get('t')) to.searchParams.set('t', q.get('t')!);
    return new Response(null, { status: 302, headers: { Location: to.toString() } });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405, h);

  let email = q.get('e') ?? '', token = q.get('t') ?? '';
  if (!email || !token) {
    try { const b = await req.json(); email = String(b.e ?? b.email ?? ''); token = String(b.t ?? b.token ?? ''); } catch { /* one-click posts a form body */ }
  }
  email = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !token) return json({ error: 'bad_link' }, 400, h);

  const { data: secret } = await admin.rpc('server_secret', { p_name: 'cron_secret' });
  if (!secret || !(await unsubValid(secret as string, email, token))) return json({ error: 'bad_link' }, 403, h);

  const { error } = await admin.from('marketing_optouts').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true });
  if (error) { log('unsubscribe_error', { message: error.message }); return json({ error: 'server' }, 500, h); }
  log('unsubscribed');
  return json({ ok: true }, 200, h);
});
