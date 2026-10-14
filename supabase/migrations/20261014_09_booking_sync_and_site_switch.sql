-- Life's Moments: Booking.com calendar sync (one iCal link each way per room),
-- and the switch that stops the site taking requests.

-- One row per room and the apartment.
-- import_url: the link Booking.com gives (its "export"); we read it every 15 minutes.
-- export_token: makes our own link, which Booking.com reads (its "import").
create table public.ical_feeds (
  unit         text primary key check (unit ~ '^(r([1-9]|1[01])|apt)$'),
  import_url   text check (import_url is null or (char_length(import_url) <= 600 and import_url ~ '^https://([a-z0-9-]+\.)*booking\.com/')),
  export_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  last_try_at  timestamptz,
  last_ok_at   timestamptz,
  last_error   text,
  last_count   int,
  updated_at   timestamptz not null default now(),
  updated_by   text not null default ''
);
insert into public.ical_feeds (unit)
  select 'r' || g from generate_series(1, 11) as g
  union all select 'apt';
alter table public.ical_feeds enable row level security;
create policy "owners read feeds" on public.ical_feeds for select to authenticated using (public.is_owner());
create policy "owners set feed links" on public.ical_feeds for update to authenticated using (public.is_owner()) with check (public.is_owner());
-- Owners only set the link. The status is written by the sync function.
revoke insert, update, delete on public.ical_feeds from anon, authenticated;
grant update (import_url, updated_at, updated_by) on public.ical_feeds to authenticated;

-- Reservations read from Booking.com are kept as owner stays with the event's UID.
alter table public.owner_stays add column ical_uid text check (ical_uid is null or char_length(ical_uid) <= 300);
create unique index owner_stays_ical on public.owner_stays (unit, ical_uid) where ical_uid is not null;

-- A new or removed link starts clean. The ical-sync function then drops the old copies
-- (on the first read after a change, or when there is no link any more).
create or replace function private.ical_feed_changed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.import_url is distinct from old.import_url then
    new.last_try_at := null; new.last_ok_at := null; new.last_error := null; new.last_count := null;
  end if;
  return new;
end;
$$;
create trigger ical_feed_changed before update on public.ical_feeds
  for each row execute function private.ical_feed_changed();

-- What our link for one room tells Booking.com: the nights that are taken here.
-- Booking.com's own reservations are left out, it already has them.
create or replace function public.ical_busy(p_token text)
returns table (uid text, check_in date, check_out date)
language sql stable security definer set search_path = ''
as $$
  with f as (select unit from public.ical_feeds where export_token = p_token),
  today as (select (now() at time zone 'Europe/Athens')::date - 1 as d)
  select 'req-' || r.id, r.check_in, r.check_out
    from public.booking_requests r, f, today
    where r.is_test = false and r.check_out > today.d
      and ((r.status = 'confirmed' and r.unit = f.unit)
        -- one apartment: a request waiting for an answer already holds it
        or (f.unit = 'apt' and r.unit_type = 'apt' and r.status = 'pending' and r.expires_at > now()))
  union all
  select 'stay-' || s.id, s.check_in, s.check_out
    from public.owner_stays s, f, today
    where s.unit = f.unit and s.status = 'confirmed' and s.kind <> 'test' and s.source = 'direct' and s.check_out > today.d
  union all
  -- closed nights, joined into runs of consecutive nights
  select 'closed-' || g.unit || '-' || min(g.night), min(g.night), max(g.night) + 1
    from (select b.unit, b.night, b.night - (row_number() over (order by b.night))::int as grp
            from public.unit_blocks b, f, today where b.unit = f.unit and b.night >= today.d) as g
    group by g.unit, g.grp;
$$;
revoke execute on function public.ical_busy(text) from public, anon, authenticated;
grant execute on function public.ical_busy(text) to service_role;

-- The site's on/off switch for new requests.
create table public.site_settings (
  id         boolean primary key default true check (id),
  accepting  boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
insert into public.site_settings default values;
alter table public.site_settings enable row level security;
create policy "owners read site settings" on public.site_settings for select to authenticated using (public.is_owner());
create policy "owners change site settings" on public.site_settings for update to authenticated using (public.is_owner()) with check (public.is_owner());
revoke insert, delete on public.site_settings from anon, authenticated;

create or replace function public.site_open()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select accepting from public.site_settings where id), true);
$$;
revoke execute on function public.site_open() from public;
grant execute on function public.site_open() to anon, authenticated, service_role;

-- Both owners see a change the moment the other makes it.
alter publication supabase_realtime add table public.ical_feeds;
alter publication supabase_realtime add table public.site_settings;

-- Every 15 minutes: read Booking.com's calendars.
select cron.schedule(
  'lm-ical-sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://cwucmglctgklokxwbwqz.supabase.co/functions/v1/ical-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
