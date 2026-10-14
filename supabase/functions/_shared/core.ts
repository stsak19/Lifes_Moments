import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { generateVapid, sendPush, type Vapid } from './webpush.ts';

export const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
export const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default;

export const admin: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

// Who push services can contact about these notifications (RFC 8292 "sub").
const SUBJECT = 'https://stsak19.github.io/lifes_moments/';
const ALLOWED = ['https://stsak19.github.io', 'http://localhost:8765'];

export function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(o) ? o : ALLOWED[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}
export function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
export function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

async function secret(name: string): Promise<string | null> {
  const { data, error } = await admin.rpc('server_secret', { p_name: name });
  if (error) throw new Error('secret read failed: ' + error.message);
  return data as string | null;
}

/** The push key pair, made once on first use and kept in Vault as one JSON secret. */
export async function vapid(): Promise<Vapid> {
  let raw = await secret('vapid');
  if (!raw) {
    const k = await generateVapid();
    const { error } = await admin.rpc('server_secret_set', { p_name: 'vapid', p_value: JSON.stringify(k) });
    if (error) throw new Error('secret write failed: ' + error.message);
    raw = await secret('vapid'); // if two calls raced, both now read the one that was kept
    log('vapid_created');
  }
  const k = JSON.parse(raw!);
  return { publicKey: k.publicKey, privateJwk: k.privateJwk, subject: SUBJECT };
}

export type Note = { title: string; body: string; url: string; tag: string };

/** Send to every owner device (or one owner's devices). Dead subscriptions are removed. */
export async function notify(note: Note, onlyUser?: string): Promise<{ sent: number; failed: number; devices: number }> {
  let q = admin.from('push_subscriptions').select('id, endpoint, p256dh, auth');
  if (onlyUser) q = q.eq('user_id', onlyUser);
  const { data: subs, error } = await q;
  if (error) throw new Error('subscriptions read failed: ' + error.message);
  if (!subs?.length) return { sent: 0, failed: 0, devices: 0 };
  const v = await vapid();
  let sent = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const r = await sendPush(s, note, v);
      if (r.ok) { sent++; await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', s.id); }
      else {
        failed++;
        log('push_failed', { status: r.status, host: new URL(s.endpoint).host, tag: note.tag });
        if (r.gone) await admin.from('push_subscriptions').delete().eq('id', s.id);
      }
    } catch (e) {
      failed++;
      log('push_error', { message: String(e), host: new URL(s.endpoint).host, tag: note.tag });
    }
  }));
  return { sent, failed, devices: subs.length };
}

const MON = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μαΐ', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];
export function range(a: string, b: string): string {
  const [ya, ma, da] = a.split('-').map(Number), [yb, mb, db] = b.split('-').map(Number);
  return ma === mb && ya === yb ? da + '–' + db + ' ' + MON[mb - 1] : da + ' ' + MON[ma - 1] + ' – ' + db + ' ' + MON[mb - 1];
}
export type Req = { id: string; name: string; unit_type: string; check_in: string; check_out: string; guests: number };
export function what(r: Req): string {
  return r.name + ' · ' + range(r.check_in, r.check_out) + ' · ' + r.guests + (r.guests === 1 ? ' άτομο' : ' άτομα') + ' · ' + (r.unit_type === 'apt' ? 'Διαμέρισμα' : 'Δωμάτιο');
}
