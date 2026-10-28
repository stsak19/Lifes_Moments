// Runs every 10 minutes (pg_cron): reminds each owner about open requests at the frequency they chose in Settings,
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

  // Pending requests that haven't expired yet; each owner is reminded on their own schedule.
  const { data: open, error: e2 } = await admin.from('booking_requests')
    .select(cols + ', created_at').eq('status', 'pending').gt('expires_at', now.toISOString());
  if (e2) log('remind_error', { message: e2.message });
  const { data: owners } = await admin.from('owners').select('email, remind_every');
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const idOf = new Map((users?.users ?? []).map((u) => [String(u.email).toLowerCase(), u.id]));
  const { data: sentRows } = await admin.from('request_reminders').select('request_id, owner_email, last_at');
  const last = new Map((sentRows ?? []).map((x) => [x.request_id + '|' + x.owner_email, Date.parse(x.last_at)]));
  let reminded = 0;
  for (const r of (expired ?? []) as Req[]) {
    await notify({ title: 'Έληξε ένα αίτημα', body: what(r) + '\nΔεν απαντήθηκε σε 24 ώρες, η δέσμευση λύθηκε.', url: 'admin.html', tag: 'req-' + r.id }).catch((e) => log('notify_error', { id: r.id, message: String(e) }));
  }
  for (const r of (open ?? []) as (Req & { expires_at: string; created_at: string })[]) {
    const left = Date.parse(r.expires_at) - now.getTime();
    for (const o of owners ?? []) {
      const uid = idOf.get(o.email); const every = o.remind_every as number;
      if (!uid || every === 0) continue;
      const prev = last.get(r.id + '|' + o.email);
      const due = every === -1 ? (prev === undefined && left <= 4 * 3600000)
        : now.getTime() - (prev ?? Date.parse(r.created_at)) >= every * 3600000 - 60000;
      if (!due) continue;
      await admin.from('request_reminders').upsert({ request_id: r.id, owner_email: o.email, last_at: now.toISOString() });
      const hrs = Math.max(1, Math.round(left / 3600000));
      await notify({ title: 'Λήγει σε ' + hrs + (hrs === 1 ? ' ώρα' : ' ώρες'), body: what(r) + '\nΑπάντησε πριν λήξει το αίτημα.', url: 'admin.html?req=' + r.id, tag: 'req-' + r.id }, uid)
        .then(() => reminded++).catch((e) => log('notify_error', { id: r.id, message: String(e) }));
    }
  }
  log('reminders_run', { expired: expired?.length ?? 0, reminded });
  return json({ expired: expired?.length ?? 0, reminded }, 200, {});
});
