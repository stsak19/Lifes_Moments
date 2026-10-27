-- Coupons can cover any number of nights (null) or only the first N nights of a stay.
alter table public.promo_offers add column if not exists max_nights smallint check (max_nights is null or max_nights between 1 and 60);
alter table public.booking_requests add column if not exists discount_nights smallint check (discount_nights is null or discount_nights between 1 and 60);

drop function if exists public.save_offer(text, int, date, date, date, text[], boolean, timestamptz, text);
create or replace function public.save_offer(
  p_code text, p_pct int, p_stay_from date, p_stay_to date, p_book_by date,
  p_emails text[], p_send_email boolean, p_send_at timestamptz, p_by text, p_max_nights int default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_code text := upper(trim(coalesce(p_code, '')));
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  if v_code !~ '^[A-Z0-9_-]{3,24}$' then raise exception 'bad_code'; end if;
  if p_max_nights is not null and (p_max_nights < 1 or p_max_nights > 60) then raise exception 'bad_nights'; end if;
  if exists (select 1 from public.promo_offers where upper(code) = v_code and status <> 'cancelled') then raise exception 'code_taken'; end if;
  if p_emails is not null and coalesce(array_length(p_emails, 1), 0) = 0 then raise exception 'no_recipients'; end if;

  insert into public.promo_offers (discount_pct, code, stay_from, stay_to, book_by, send_at, status, finished_at, audience, send_email, created_by, max_nights)
  values (p_pct, v_code, p_stay_from, p_stay_to, p_book_by,
          case when p_send_email then coalesce(p_send_at, now()) else now() end,
          case when p_send_email then 'scheduled' else 'sent' end,
          case when p_send_email then null else now() end,
          case when p_emails is null then 'all' else 'selected' end, p_send_email, p_by, p_max_nights)
  returning id into v_id;

  insert into public.promo_recipients (offer_id, email, name, lang)
  select v_id, c.email, c.name, c.lang
    from public.promo_customers() c
   where p_emails is null or c.email = any (select lower(trim(e)) from unnest(p_emails) e);

  if not exists (select 1 from public.promo_recipients where offer_id = v_id) then raise exception 'no_recipients'; end if;
  return v_id;
end;
$$;
revoke all on function public.save_offer(text, int, date, date, date, text[], boolean, timestamptz, text, int) from public, anon;
grant execute on function public.save_offer(text, int, date, date, date, text[], boolean, timestamptz, text, int) to authenticated;

-- promo_check also says how many nights the discount covers (null = all).
create or replace function public.promo_check(p_code text, p_email text, p_in date, p_out date)
returns jsonb
language sql stable security definer set search_path to ''
as $$
  with o as (
    select * from public.promo_offers o
     where o.status <> 'cancelled' and o.send_at <= now()
       and o.code is not null and upper(o.code) = upper(trim(coalesce(p_code, '')))
  ), s as (
    select r.email, o.discount_pct, o.stay_from, o.stay_to, o.book_by, o.max_nights
      from o join public.promo_recipients r on r.offer_id = o.id
    union all
    select ps.email, o.discount_pct, o.stay_from, o.stay_to, o.book_by, o.max_nights
      from o join public.promo_sends ps on ps.offer_id = o.id and ps.status = 'sent'
    union all
    select ps.email, po.discount_pct, po.stay_from, po.stay_to, po.book_by, po.max_nights
      from public.promo_sends ps join public.promo_offers po on po.id = ps.offer_id
     where ps.status = 'sent' and po.status <> 'cancelled' and ps.code = upper(trim(coalesce(p_code, '')))
  ), mine as (
    select * from s where s.email = lower(trim(coalesce(p_email, '')))
  ), today as (
    select (now() at time zone 'Europe/Athens')::date as d
  ), fit as (
    select m.discount_pct as pct, m.max_nights as nights
      from mine m, today
     where p_in is not null and p_out is not null and p_out > p_in
       and p_in >= m.stay_from and p_out - 1 <= m.stay_to
       and (m.book_by is null or today.d <= m.book_by)
     order by m.discount_pct desc, m.max_nights desc nulls first
     limit 1
  )
  select case
    when exists (select 1 from fit) then jsonb_build_object('status', 'ok', 'pct', (select pct from fit), 'nights', (select nights from fit))
    when exists (select 1 from mine) then jsonb_build_object('status', 'dates')
    when exists (select 1 from s) then jsonb_build_object('status', 'email')
    else jsonb_build_object('status', 'invalid')
  end;
$$;
revoke all on function public.promo_check(text, text, date, date) from public;
grant execute on function public.promo_check(text, text, date, date) to anon, authenticated, service_role;

-- A request made with a code keeps how many nights its discount covers.
create or replace function public.set_discount_nights()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v jsonb;
begin
  if new.promo_code is not null and new.discount_pct is not null then
    v := public.promo_check(new.promo_code, new.email, new.check_in, new.check_out);
    if v->>'status' = 'ok' and v->>'nights' is not null then
      new.discount_nights := least((v->>'nights')::int, new.check_out - new.check_in);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists booking_requests_discount_nights on public.booking_requests;
create trigger booking_requests_discount_nights before insert on public.booking_requests
  for each row execute function public.set_discount_nights();
