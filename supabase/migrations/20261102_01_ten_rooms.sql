-- The house now has 10 rooms (r1–r5 shown as 100–104, r6–r10 as 200–204) plus the
-- apartment (Άθος). The unit ids stay the same; only room 11 goes away.

-- 1. A closed night fills all 10 rooms.
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
    + (select case when coalesce(bool_or(ns.closed), false) then (case when p_type = 'apt' then 1 else 10 end) else 0 end
        from public.night_setting(d::date) ns)
    )::int
  from generate_series(p_from, p_to, interval '1 day') as d;
$$;

-- 2. A request fits while fewer than 10 rooms are taken.
create or replace function public.request_fits(p_type text, p_in date, p_out date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(max(taken), 0) < (case when p_type = 'apt' then 1 else 10 end)
  from public.nights_taken(p_type, p_in, p_out - 1);
$$;

-- 3. Room 11 no longer exists: drop its closed nights and its Booking.com feed.
delete from public.unit_blocks where unit = 'r11';
delete from public.ical_feeds where unit = 'r11';
