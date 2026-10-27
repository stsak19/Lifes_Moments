-- The admin sends a new coupon's emails at once (the 10-minute run stays as a fallback).
create or replace function public.send_offers_now()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  perform net.http_post(
    url := 'https://cwucmglctgklokxwbwqz.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"action":"run_offers"}'::jsonb,
    timeout_milliseconds := 55000);
end;
$$;
revoke all on function public.send_offers_now() from public, anon;
grant execute on function public.send_offers_now() to authenticated;
