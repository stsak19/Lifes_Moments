// Owners only: get the push public key (made on first use) or send a test notification to your own devices.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ANON, URL_, cors, json, log, notify, vapid } from '../_shared/core.ts';

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: h });
  if (req.method !== 'POST') return json({ error: 'method' }, 405, h);

  const auth = req.headers.get('authorization') ?? '';
  const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await user.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  const { data: owner } = await user.rpc('is_owner');
  if (!who?.user || owner !== true) return json({ error: 'not_owner' }, 403, h);

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* empty body is fine */ }

  try {
    if (b.action === 'key') return json({ publicKey: (await vapid()).publicKey }, 200, h);
    if (b.action === 'test') {
      const r = await notify({ title: 'Δοκιμή ειδοποίησης', body: 'Έτσι θα έρχεται κάθε νέο αίτημα κράτησης.', url: 'admin.html', tag: 'test' }, who.user.id);
      log('push_test', { user: who.user.id, ...r });
      return json(r, 200, h);
    }
    return json({ error: 'action' }, 400, h);
  } catch (e) {
    log('push_fn_error', { message: String(e) });
    return json({ error: 'server' }, 500, h);
  }
});
