-- Guests can write a message and type a discount code when they send a booking request.
-- The message stays in booking_requests.note. The code and its discount are kept on their own,
-- so the admin can show them and take the discount off the price.

alter table public.booking_requests
  add column if not exists promo_code text check (promo_code is null or promo_code ~ '^[A-Z0-9_-]{3,24}$'),
  add column if not exists discount_pct smallint check (discount_pct is null or discount_pct between 1 and 90);

-- Does this code give a discount for these nights?
-- A code counts once its offer email went out (or its send time has passed), as long as the offer is not cancelled,
-- every night of the stay falls inside the offer's stay dates, and the book-by date (Greek time) has not passed.
-- Answers {status: 'ok', pct} | {status: 'dates'} (real code, other dates or too late) | {status: 'invalid'}.
create or replace function public.promo_check(p_code text, p_in date, p_out date)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  with o as (
    select discount_pct, stay_from, stay_to, book_by
      from public.promo_offers
     where code is not null
       and upper(code) = upper(trim(coalesce(p_code, '')))
       and status <> 'cancelled'
       and send_at <= now()
  ), today as (
    select (now() at time zone 'Europe/Athens')::date as d
  ), fit as (
    select max(o.discount_pct) as pct
      from o, today
     where p_in is not null and p_out is not null and p_out > p_in
       and p_in >= o.stay_from and p_out - 1 <= o.stay_to
       and (o.book_by is null or today.d <= o.book_by)
  )
  select case
    when (select pct from fit) is not null then jsonb_build_object('status', 'ok', 'pct', (select pct from fit))
    when exists (select 1 from o) then jsonb_build_object('status', 'dates')
    else jsonb_build_object('status', 'invalid')
  end;
$$;
revoke all on function public.promo_check(text, date, date) from public;
grant execute on function public.promo_check(text, date, date) to anon, authenticated, service_role;
