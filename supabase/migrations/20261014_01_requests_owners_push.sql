-- Life's Moments: booking requests from the site, the owners who answer them,
-- and the devices that get push notifications.

-- Owners allowed into the admin. Only these emails can create an account.
create table public.owners (
  email      text primary key check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  name       text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
alter table public.owners enable row level security;

create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.owners o
    where o.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create policy "owners see the owner list" on public.owners
  for select to authenticated using (public.is_owner());

-- Nobody outside the list can sign up.
create schema if not exists private;
create or replace function private.only_owner_signups()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.owners o where o.email = lower(new.email)) then
    raise exception 'This email is not an owner of Life''s Moments';
  end if;
  return new;
end;
$$;
create trigger only_owner_signups
  before insert on auth.users
  for each row execute function private.only_owner_signups();

-- Booking requests. The site never writes here directly: the submit-request
-- function checks the input and inserts with the service role.
create table public.booking_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  unit_type   text not null check (unit_type in ('room', 'apt')),
  check_in    date not null,
  check_out   date not null,
  guests      smallint not null check (guests between 1 and 5),
  name        text not null check (char_length(name) between 2 and 120),
  email       text not null check (char_length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  phone       text not null check (char_length(phone) between 6 and 40),
  note        text check (char_length(note) <= 1000),
  lang        text not null default 'el' check (lang in ('el', 'en')),
  status      text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'expired')),
  expires_at  timestamptz not null default now() + interval '24 hours',
  reminded_at timestamptz,
  unit        text check (unit is null or unit ~ '^(r([1-9]|1[01])|apt)$'),
  decided_at  timestamptz,
  decided_by  text,
  is_test     boolean not null default false,
  constraint stay_dates check (check_out > check_in and check_out - check_in <= 30),
  constraint confirmed_has_unit check (status <> 'confirmed' or unit is not null),
  constraint unit_matches_type check (unit is null or (unit_type = 'apt') = (unit = 'apt'))
);
create index booking_requests_open on public.booking_requests (expires_at) where status = 'pending';
create index booking_requests_dates on public.booking_requests (check_in, check_out) where status in ('pending', 'confirmed');
create index booking_requests_created on public.booking_requests (created_at desc);
alter table public.booking_requests enable row level security;

create policy "owners read requests" on public.booking_requests
  for select to authenticated using (public.is_owner());
create policy "owners answer requests" on public.booking_requests
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- Is there still room for these nights? Pending requests hold a unit too.
-- (Booking.com reservations join this check once its calendar is synced in.)
create or replace function public.request_fits(p_type text, p_in date, p_out date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(max(n), 0) < (case when p_type = 'apt' then 1 else 11 end)
  from (
    select d, count(r.id) as n
    from generate_series(p_in, p_out - 1, interval '1 day') as d
    left join public.booking_requests r
      on r.unit_type = p_type
     and r.status in ('pending', 'confirmed')
     and (r.status = 'confirmed' or r.expires_at > now())
     and r.check_in <= d::date and d::date < r.check_out
    group by d
  ) per_night;
$$;
revoke execute on function public.request_fits(text, date, date) from public, anon, authenticated;
grant execute on function public.request_fits(text, date, date) to service_role;

-- Devices that get push notifications, one row per owner and browser.
create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://'),
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "owners see their devices" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()) and public.is_owner());

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'not an owner'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end;
$$;
create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke execute on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- Server-only secrets (push keys, cron secret) live in Vault; only the service role reads or writes them.
create or replace function public.server_secret(p_name text)
returns text
language sql stable security definer set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;
create or replace function public.server_secret_set(p_name text, p_value text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from vault.secrets where name = p_name) then return; end if;
  perform vault.create_secret(p_value, p_name);
end;
$$;
revoke execute on function public.server_secret(text) from public, anon, authenticated;
revoke execute on function public.server_secret_set(text, text) from public, anon, authenticated;
grant execute on function public.server_secret(text) to service_role;
grant execute on function public.server_secret_set(text, text) to service_role;

-- The push public key is not secret; owners' browsers need it to subscribe.
create or replace function public.vapid_public_key()
returns text
language sql stable security definer set search_path = ''
as $$
  select case when public.is_owner()
    then (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_public' limit 1) end;
$$;
revoke execute on function public.vapid_public_key() from public, anon;
grant execute on function public.vapid_public_key() to authenticated;

-- The admin sees new requests the moment they arrive.
alter publication supabase_realtime add table public.booking_requests;

-- First owner, for testing. The two real owners are added the same way.
insert into public.owners (email, name) values ('tsakirisstathis19@gmail.com', 'Στάθης');
