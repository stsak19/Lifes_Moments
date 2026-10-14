-- A discount code works only together with an email address the offer was actually sent to.
-- The code in the email stays the offer's code (e.g. THASOS15); promo_sends.code (from 12) is matched too,
-- for personal codes if the offer emails ever carry them.
create or replace function public.promo_check(p_code text, p_email text, p_in date, p_out date)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  with s as (
    select ps.email, o.discount_pct, o.stay_from, o.stay_to, o.book_by
      from public.promo_offers o
      join public.promo_sends ps on ps.offer_id = o.id and ps.status = 'sent'
     where o.status <> 'cancelled'
       and (ps.code = upper(trim(coalesce(p_code, '')))
            or (o.code is not null and upper(o.code) = upper(trim(coalesce(p_code, '')))))
  ), mine as (
    select * from s where s.email = lower(trim(coalesce(p_email, '')))
  ), today as (
    select (now() at time zone 'Europe/Athens')::date as d
  ), fit as (
    select max(m.discount_pct) as pct
      from mine m, today
     where p_in is not null and p_out is not null and p_out > p_in
       and p_in >= m.stay_from and p_out - 1 <= m.stay_to
       and (m.book_by is null or today.d <= m.book_by)
  )
  select case
    when (select pct from fit) is not null then jsonb_build_object('status', 'ok', 'pct', (select pct from fit))
    when exists (select 1 from mine) then jsonb_build_object('status', 'dates')
    when exists (select 1 from s) then jsonb_build_object('status', 'email')
    else jsonb_build_object('status', 'invalid')
  end;
$$;
