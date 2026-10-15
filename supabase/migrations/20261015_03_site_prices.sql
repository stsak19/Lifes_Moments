-- Prices for the site, set by the owners in the admin (Τιμές tab and the room calendar).
-- Booking.com prices are set in the extranet and never stored here.

-- Seasons: base price per night for a room and for the apartment, and the minimum nights.
-- ranges: [["MM-DD","MM-DD"], ...] repeating every year. Higher priority wins where seasons overlap.
create table public.price_seasons (
  id          text primary key,
  name        text not null,
  range_label text not null default '',
  ranges      jsonb not null default '[]'::jsonb,
  room        integer check (room is null or room >= 0),
  apt         integer check (apt is null or apt >= 0),
  min_nights  integer not null default 1 check (min_nights >= 1),
  priority    integer not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default ''
);
insert into public.price_seasons (id, name, range_label, ranges, room, apt, min_nights, priority) values
  ('low',  'Χαμηλή σεζόν',       'Μάιος – Ιούνιος, Σεπτέμβριος', '[["05-01","06-30"],["09-01","09-30"]]', 85, 150, 2, 1),
  ('high', 'Υψηλή σεζόν',        'Ιούλιος – Αύγουστος',          '[["07-01","08-31"]]',                   120, 190, 3, 2),
  ('peak', 'Δεκαπενταύγουστος',  '10 – 20 Αυγούστου',            '[["08-10","08-20"]]',                   145, 230, 4, 3);

-- Specific prices for single nights (override the season). A null field keeps the season's value.
create table public.price_overrides (
  night       date primary key,
  room        integer check (room is null or room >= 0),
  apt         integer check (apt is null or apt >= 0),
  min_nights  integer check (min_nights is null or min_nights >= 1),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default ''
);

-- Extra guest per night, above 2 guests.
alter table public.site_settings add column if not exists extra_guest integer not null default 15 check (extra_guest >= 0);

alter table public.price_seasons enable row level security;
alter table public.price_overrides enable row level security;
create policy "owners read seasons" on public.price_seasons for select to authenticated using (public.is_owner());
create policy "owners change seasons" on public.price_seasons for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owners read price overrides" on public.price_overrides for select to authenticated using (public.is_owner());
create policy "owners add price overrides" on public.price_overrides for insert to authenticated with check (public.is_owner());
create policy "owners change price overrides" on public.price_overrides for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owners remove price overrides" on public.price_overrides for delete to authenticated using (public.is_owner());
revoke all on public.price_seasons, public.price_overrides from anon;

-- Public: the price of each night between two dates (for the site), nothing else.
create or replace function public.site_prices(p_from date, p_to date)
returns table (night date, room integer, apt integer, min_nights integer, extra_guest integer)
language sql stable security definer set search_path = ''
as $$
  with days as (
    select d::date as night
    from generate_series(p_from, least(p_to, p_from + 400), interval '1 day') d
  ), season as (
    select dd.night, s.room, s.apt, s.min_nights,
           row_number() over (partition by dd.night order by s.priority desc) as rn
    from days dd
    join public.price_seasons s
      on exists (
        select 1 from jsonb_array_elements(s.ranges) r
        where to_char(dd.night, 'MM-DD') between r->>0 and r->>1
      )
  )
  select dd.night,
         coalesce(o.room, se.room),
         coalesce(o.apt, se.apt),
         coalesce(o.min_nights, se.min_nights, 1),
         (select extra_guest from public.site_settings where id)
  from days dd
  left join season se on se.night = dd.night and se.rn = 1
  left join public.price_overrides o on o.night = dd.night
  order by dd.night;
$$;
grant execute on function public.site_prices(date, date) to anon, authenticated;

alter publication supabase_realtime add table public.price_overrides;
alter publication supabase_realtime add table public.price_seasons;
