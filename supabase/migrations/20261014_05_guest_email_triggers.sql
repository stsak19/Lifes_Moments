-- Every change that should email a guest is caught in the database, so it works the same whether
-- the owner answers in the admin, in the dashboard, or the 24-hour timer closes the request.
-- The trigger only calls the send-email function (same pattern as the 10-minute reminders job);
-- if that fails, the booking change itself is never blocked.
create or replace function public.queue_guest_email()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare k text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' then k := 'received'; end if;
  elsif new.status is distinct from old.status
        and old.status = 'pending'
        and new.status in ('confirmed', 'rejected', 'expired') then
    k := new.status;
  end if;
  if k is null then return new; end if;

  begin
    perform net.http_post(
      url := 'https://cwucmglctgklokxwbwqz.supabase.co/functions/v1/send-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := jsonb_build_object('request_id', new.id, 'kind', k),
      timeout_milliseconds := 20000
    );
  exception when others then
    raise warning 'queue_guest_email failed: %', sqlerrm;
  end;
  return new;
end
$$;

revoke all on function public.queue_guest_email() from public, anon, authenticated;

create trigger booking_requests_email_insert
  after insert on public.booking_requests
  for each row execute function public.queue_guest_email();

create trigger booking_requests_email_status
  after update of status on public.booking_requests
  for each row execute function public.queue_guest_email();
