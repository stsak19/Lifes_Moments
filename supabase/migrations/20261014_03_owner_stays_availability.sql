-- Life's Moments: stays the owners enter by hand (phone, Booking.com, friends), closed dates,
-- cancelling, and the availability the public site reads.

-- A confirmed request can now be cancelled by an owner; the nights open up again.
alter table public.booking_requests drop constraint booking_requests_status_check;
alter table public.booking_requests add constraint booking_requests_status_check
  check (status in ('pending', 'confirmed', 'rejected', 'expired', 'cancelled'));

-- Stays an owner types in: phone or direct bookings, copies of Booking.com reservations,
-- free stays for friends, and tests.
create table public.owner_stays (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by text not null default '',
  kind       text not null check (kind in ('paid', 'free', 'test')),
  source     text not null default 'direct' check (source in ('direct', 'booking')),
  unit_type  text not null check (unit_type in ('room', 'apt')),
  unit       text not null check (unit ~ '^(r([1-9]|1[01])|apt)$'),
  check_in   date not null,
  check_out  date not null,
  guests     smallint not null check (guests between 1 and 5),
  name       text not null check (char_length(name) between 1 and 120),
  email      text not null default '' check (char_length(email) <= 254),
  phone      text not null default '' check (char_length(phone) <= 40),
  note       text not null default '' check (char_length(note) <= 1000),
  total      numeric(10, 2) not null default 0 check (total >= 0),
  pay        text check (pay in ('cash', 'card', 'bank')),
  status     text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  decided_by text,
  constraint owner_stay_dates check (check_out > check_in and check_out - check_in <= 60),
  constraint owner_stay_unit_type check ((unit_type = 'apt') = (unit = 'apt'))
);
create index owner_stays_dates on public.owner_stays (check_in, check_out) where status = 'confirmed';
alter table public.owner_stays enable row level security;
create policy "owners read stays" on public.owner_stays for select to authenticated using (public.is_owner());
create policy "owners add stays" on public.owner_stays for insert to authenticated with check (public.is_owner());
create policy "owners change stays" on public.owner_stays for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- Nights an owner closed on one room (or the apartment).
create table public.unit_blocks (
  unit       text not null check (unit ~ '^(r([1-9]|1[01])|apt)$'),
  night      date not null,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  primary key (unit, night)
);
alter table public.unit_blocks enable row level security;
create policy "owners read blocks" on public.unit_blocks for select to authenticated using (public.is_owner());
create policy "owners add blocks" on public.unit_blocks for insert to authenticated with check (public.is_owner());
create policy "owners remove blocks" on public.unit_blocks for delete to authenticated using (public.is_owner());

-- How many rooms (or the apartment) are taken each night, from every source.
-- Pending requests hold a unit until they expire. Tests never hold one.
create or replace function public.nights_taken(p_type text, p_from date, p_to date)
returns table (night date, taken int)
language sql stable security definer set search_path = ''
as $$
  select d::date,
    ( (select count(*) from public.booking_requests r
        where r.unit_type = p_type and r.is_test = false
          and (r.status = 'confirmed' or (r.status = 'pending' and r.expires_at > now()))
          and r.check_in <= d::date and d::date < r.check_out)
    + (select count(*) from public.owner_stays s
        where s.unit_type = p_type and s.status = 'confirmed' and s.kind <> 'test'
          and s.check_in <= d::date and d::date < s.check_out)
    + (select count(*) from public.unit_blocks b
        where (b.unit = 'apt') = (p_type = 'apt') and b.night = d::date)
    )::int
  from generate_series(p_from, p_to, interval '1 day') as d;
$$;
revoke execute on function public.nights_taken(text, date, date) from public, anon, authenticated;
grant execute on function public.nights_taken(text, date, date) to service_role;

create or replace function public.request_fits(p_type text, p_in date, p_out date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(max(taken), 0) < (case when p_type = 'apt' then 1 else 11 end)
  from public.nights_taken(p_type, p_in, p_out - 1);
$$;

-- What the public site reads: only counts per night, never names or contacts.
create or replace function public.site_availability(p_from date, p_to date)
returns table (unit_type text, night date, taken int)
language sql stable security definer set search_path = ''
as $$
  select t.ty, n.night, n.taken
  from (values ('room'), ('apt')) as t(ty),
  lateral public.nights_taken(
    t.ty,
    greatest(p_from, (now() at time zone 'Europe/Athens')::date),
    least(p_to, greatest(p_from, (now() at time zone 'Europe/Athens')::date) + 600)
  ) as n
  where n.taken > 0;
$$;
revoke execute on function public.site_availability(date, date) from public;
grant execute on function public.site_availability(date, date) to anon, authenticated;

-- The admin sees hand-entered stays and closed dates the moment the other owner changes them.
alter publication supabase_realtime add table public.owner_stays;
alter publication supabase_realtime add table public.unit_blocks;
