-- The push key pair is kept as one JSON secret ('vapid'); owners read only its public half.
create or replace function public.vapid_public_key()
returns text
language sql stable security definer set search_path = ''
as $$
  select case when public.is_owner()
    then (select (decrypted_secret::jsonb) ->> 'publicKey' from vault.decrypted_secrets where name = 'vapid' limit 1) end;
$$;

-- Every 10 minutes: reminders 4 hours before a request expires, and expiry after 24 hours.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret')
where not exists (select 1 from vault.secrets where name = 'cron_secret');

select cron.schedule(
  'lm-request-reminders',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://cwucmglctgklokxwbwqz.supabase.co/functions/v1/request-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
