// Runs every 10 minutes (pg_cron): reminds the owners 4 hours before a request expires,
// and closes requests nobody answered within 24 hours.
import { admin, json, log, notify, what, type Req } from '../_shared/core.ts';

Deno.serve(async (req) => {
  const { data: expected } = await admin.rpc('server_secret', { p_name: 'cron_secret' });
  if (!expected || req.headers.get('x-cron-secret') !== expected) return json({ error: 'forbidden' }, 403, {});

  const now = new Date();
  const cols = 'id, name, unit_type, check_in, check_out, guests, expires_at';

  const { data: expired, error: e1 } = await admin.from('booking_requests')
    .update({ status: 'expired', decided_at: now.toISOString(), decided_by: 'Αυτόματα · πέρασαν 24 ώρες' })
    .eq('status', 'pending').lt('expires_at', now.toISOString()).select(cols);
  if (e1) log('expire_error', { message: e1.message });

  const soon = new Date(now.getTime() + 4 * 3600000).toISOString();
  const { data: due, error: e2 } = await admin.from('booking_requests')
    .update({ reminded_at: now.toISOString() })
    .eq('status', 'pending').is('reminded_at', null).lte('expires_at', soon).gt('expires_at', now.toISOString())
    .select(cols);
  if (e2) log('remind_error', { message: e2.message });

  for (const r of (expired ?? []) as Req[]) {
    await notify({ title: 'Έληξε ένα αίτημα', body: what(r) + '\nΔεν απαντήθηκε σε 24 ώρες, η δέσμευση λύθηκε.', url: 'admin.html', tag: 'req-' + r.id }).catch((e) => log('notify_error', { id: r.id, message: String(e) }));
  }
  for (const r of (due ?? []) as (Req & { expires_at: string })[]) {
    const hrs = Math.max(1, Math.round((Date.parse(r.expires_at) - now.getTime()) / 3600000));
    await notify({ title: 'Λήγει σε ' + hrs + (hrs === 1 ? ' ώρα' : ' ώρες'), body: what(r) + '\nΑπάντησε πριν λήξει το αίτημα.', url: 'admin.html?req=' + r.id, tag: 'req-' + r.id }).catch((e) => log('notify_error', { id: r.id, message: String(e) }));
  }
  log('reminders_run', { expired: expired?.length ?? 0, reminded: due?.length ?? 0 });
  return json({ expired: expired?.length ?? 0, reminded: due?.length ?? 0 }, 200, {});
});
