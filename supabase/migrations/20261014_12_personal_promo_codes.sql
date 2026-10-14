-- Discount codes are personal: every offer email carries its own code, and that code works only
-- with the email address it was sent to. There is no shared code any more; promo_offers.code is
-- now only the readable start of each personal code (e.g. THASOS-K7M3QPX), 'LM' when empty.

alter table public.promo_sends add column if not exists code text
  check (code is null or code ~ '^[A-Z0-9_-]{3,24}$');
create unique index if not exists promo_sends_code on public.promo_sends (code) where code is not null;

drop function if exists public.promo_check(text, date, date);

-- Does this code give this guest (by email) a discount for these nights?
-- The code must belong to an offer email that went out to this address, the offer is not cancelled,
-- every night falls inside the offer's stay dates and the book-by date (Greek time) has not passed.
-- Answers {status: 'ok', pct} | {status: 'dates'} | {status: 'email'} (someone else's code) | {status: 'invalid'}.
create or replace function public.promo_check(p_code text, p_email text, p_in date, p_out date)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  with s as (
    select ps.email, o.discount_pct, o.stay_from, o.stay_to, o.book_by
      from public.promo_sends ps
      join public.promo_offers o on o.id = ps.offer_id
     where ps.code = upper(trim(coalesce(p_code, '')))
       and ps.status = 'sent'
       and o.status <> 'cancelled'
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
revoke all on function public.promo_check(text, text, date, date) from public;
grant execute on function public.promo_check(text, text, date, date) to anon, authenticated, service_role;
