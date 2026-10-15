-- Prices without seasons: every night has its own price, or is closed.
-- A night nobody set this year takes what the same date had in the most recent earlier year,
-- so the owners set the calendar once and it carries on year after year.

-- 1. Closed nights live with the prices.
alter table public.price_overrides add column if not exists closed boolean not null default false;

-- 2. Keep what the seasons said as this year's prices, so next year remembers them.
--    Existing nights keep their own values; missing fields are filled from the season.
with days as (
  select d::date as night from generate_series('2026-01-01'::date, '2026-12-31'::date, interval '1 day') d
), season as (
  select dd.night, s.room, s.apt, s.min_nights,
         row_number() over (partition by dd.night order by s.priority desc) as rn
  from days dd
  join public.price_seasons s on exists (
    select 1 from jsonb_array_elements(s.ranges) r
    where to_char(dd.night, 'MM-DD') between r->>0 and r->>1)
)
insert into public.price_overrides (night, room, apt, min_nights, updated_by)
select night, room, apt, min_nights, 'σεζόν 2026' from season where rn = 1
on conflict (night) do update
  set room = coalesce(public.price_overrides.room, excluded.room),
      apt = coalesce(public.price_overrides.apt, excluded.apt),
      min_nights = coalesce(public.price_overrides.min_nights, excluded.min_nights);
update public.price_overrides set min_nights = 1 where min_nights is null and not closed;

-- 3. Seasons are gone.
drop function if exists public.site_prices(date, date);
drop table public.price_seasons;

-- 4. What a night is: its own setting, or the same date in the most recent earlier year.
--    29 February with nothing of its own looks at 28 February.
create or replace function public.night_setting(p_night date)
returns table (room integer, apt integer, min_nights integer, closed boolean, from_night date)
language sql stable security definer set search_path = ''
as $$
  select o.room, o.apt, o.min_nights, o.closed, o.night
  from public.price_overrides o
  where o.night <= p_night
    and extract(month from o.night) = extract(month from p_night)
    and extract(day from o.night) in (extract(day from p_night),
          case when extract(month from p_night) = 2 and extract(day from p_night) = 29 then 28 end)
  order by (o.night = p_night) desc,
           extract(year from o.night) desc,
           extract(day from o.night) desc
  limit 1;
$$;
revoke execute on function public.night_setting(date) from public, anon, authenticated;

-- 5. Public: each night's price for the site. Closed nights and nights with no price give nulls.
create or replace function public.site_prices(p_from date, p_to date)
returns table (night date, room integer, apt integer, min_nights integer, closed boolean, extra_guest integer)
language sql stable security definer set search_path = ''
as $$
  select d::date,
         case when coalesce(s.closed, false) then null else s.room end,
         case when coalesce(s.closed, false) then null else s.apt end,
         coalesce(s.min_nights, 1),
         coalesce(s.closed, false),
         (select extra_guest from public.site_settings where id)
  from generate_series(p_from, least(p_to, p_from + 400), interval '1 day') d
  left join lateral public.night_setting(d::date) s on true
  order by 1;
$$;
grant execute on function public.site_prices(date, date) to anon, authenticated;

-- 6. A closed night is full on the site: no requests can be sent for it.
--    (Booking.com is not closed by this; closing rooms in the room calendar does that.)
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
    + (select case when coalesce(bool_or(ns.closed), false) then (case when p_type = 'apt' then 1 else 11 end) else 0 end
        from public.night_setting(d::date) ns)
    )::int
  from generate_series(p_from, p_to, interval '1 day') as d;
$$;
