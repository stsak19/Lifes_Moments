// Owners of the admin, managed from Ρυθμίσεις → Χρήστες. Only a signed-in owner can call this.
//   { action: 'invite', email, name, redirect }  adds the email to public.owners and emails a Supabase invitation;
//                                                 the invited owner opens the link and picks their own password.
//   { action: 'remove', email }                  takes away access: removes the owner, their login and their devices.
// Nobody can remove themselves, and the last owner can never be removed.
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

const ALLOWED_REDIRECT = /^https:\/\/stsak19\.github\.io\/|^http:\/\/localhost:8765\//i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function caller(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth) return null;
  const c = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await c.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email) return null;
  const { data: o } = await admin.from('owners').select('email').eq('email', email).maybeSingle();
  return o ? email : null;
}

async function authUserId(email: string): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const u = data.users.find(x => (x.email ?? '').toLowerCase() === email);
    if (u) return u.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return json({ error: 'method' }, 405, h);
  try {
    const me = await caller(req);
    if (!me) return json({ error: 'Δεν έχεις δικαίωμα για αυτό.' }, 403, h);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    if (action === 'invite') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
      const redirect = String(body.redirect ?? '');
      if (!EMAIL.test(email)) return json({ error: 'Το email δεν φαίνεται σωστό.' }, 400, h);
      if (!name || name.length > 80) return json({ error: 'Γράψε όνομα (έως 80 χαρακτήρες).' }, 400, h);
      if (!ALLOWED_REDIRECT.test(redirect)) return json({ error: 'bad redirect' }, 400, h);
      const { data: exists } = await admin.from('owners').select('email').eq('email', email).maybeSingle();
      if (exists) return json({ error: 'Αυτό το email είναι ήδη ιδιοκτήτης.' }, 409, h);
      const { error: insErr } = await admin.from('owners').insert({ email, name });
      if (insErr) throw new Error(insErr.message);
      // Already has a login from before (e.g. removed and added back): no invitation, they sign in or use «Ξέχασες τον κωδικό;».
      if (await authUserId(email)) { log('owner_readded', { by: me, email }); return json({ ok: true, invited: false }, 200, h); }
      const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: redirect });
      if (error) {
        await admin.from('owners').delete().eq('email', email); // keep the list honest if the email could not go out
        throw new Error(error.message);
      }
      log('owner_invited', { by: me, email });
      return json({ ok: true, invited: true }, 200, h);
    }

    if (action === 'remove') {
      const email = String(body.email ?? '').trim().toLowerCase();
      if (email === me) return json({ error: 'Δεν μπορείς να αφαιρέσεις τον εαυτό σου.' }, 400, h);
      const { count } = await admin.from('owners').select('email', { count: 'exact', head: true });
      if ((count ?? 0) <= 1) return json({ error: 'Πρέπει να μείνει τουλάχιστον ένας ιδιοκτήτης.' }, 400, h);
      const { data: gone, error } = await admin.from('owners').delete().eq('email', email).select('email');
      if (error) throw new Error(error.message);
      if (!gone?.length) return json({ error: 'Δεν βρέθηκε αυτός ο ιδιοκτήτης.' }, 404, h);
      const id = await authUserId(email);
      if (id) {
        await admin.from('push_subscriptions').delete().eq('user_id', id);
        const { error: delErr } = await admin.auth.admin.deleteUser(id);
        if (delErr) log('owner_login_delete_failed', { email, error: delErr.message }); // access is already gone with the owners row
      }
      log('owner_removed', { by: me, email });
      return json({ ok: true }, 200, h);
    }

    return json({ error: 'unknown action' }, 400, h);
  } catch (e) {
    log('owners_error', { error: String((e as Error)?.message ?? e) });
    return json({ error: 'Κάτι πήγε στραβά στον server. Δοκίμασε ξανά.' }, 500, h);
  }
});
