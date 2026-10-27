-- Coupons section in the admin.
-- An owner makes a coupon for all customers or for chosen ones, and decides whether it goes out by email.
-- Either way the code works only together with the email of someone it was made for (promo_recipients).
-- Emails go only to people who ticked the offers box on their latest stay and have not unsubscribed.

alter table public.promo_offers
  add column if not exists audience text not null default 'all' check (audience in ('all', 'selected')),
  add column if not exists send_email boolean not null default true,
  add column if not exists created_by text;

create table if not exists public.promo_recipients (
  offer_id uuid not null references public.promo_offers (id) on delete cascade,
  email text not null check (email = lower(email)),
  name text,
  lang text,
  primary key (offer_id, email)
);
alter table public.promo_recipients enable row level security;
revoke all on public.promo_recipients from anon, authenticated;
grant select on public.promo_recipients to authenticated;
create policy "owners read coupon recipients" on public.promo_recipients for select to authenticated using (public.is_owner());

-- Owners may switch off any coupon that is not already off (before or after it was sent).
drop policy if exists "owners cancel scheduled offers" on public.promo_offers;
create policy "owners cancel offers" on public.promo_offers for update to authenticated
  using (public.is_owner() and status <> 'cancelled') with check (public.is_owner() and status = 'cancelled');

-- Everyone with an email who stayed or booked with us (site requests and bookings the owners entered).
create or replace function public.promo_customers()
returns table (email text, name text, lang text, mailable boolean)
language sql
stable
security definer
set search_path = public
as $$
  with site as (
    select distinct on (lower(trim(r.email))) lower(trim(r.email)) as email, r.name, r.lang, r.marketing_consent
      from public.booking_requests r
     where not r.is_test and r.status in ('confirmed', 'pending') and r.email like '%@%'
     order by lower(trim(r.email)), r.check_out desc, r.created_at desc
  ), own as (
    select distinct on (lower(trim(o.email))) lower(trim(o.email)) as email, o.name
      from public.owner_stays o
     where o.email like '%@%'
     order by lower(trim(o.email)), o.check_out desc
  ), allc as (
    select s.email, s.name, s.lang, coalesce(s.marketing_consent, false) as consent from site s
    union all
    select o.email, o.name, 'el', false from own o where not exists (select 1 from site s where s.email = o.email)
  )
  select a.email, a.name, a.lang,
         a.consent and not exists (select 1 from public.marketing_optouts x where x.email = a.email)
    from allc a;
$$;
revoke all on function public.promo_customers() from public, anon, authenticated;

-- For the admin: the customer list with who can get an offer email.
create or replace function public.coupon_customers()
returns table (email text, name text, mailable boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.email, c.name, c.mailable from public.promo_customers() c where public.is_owner() order by c.name;
$$;
revoke all on function public.coupon_customers() from public, anon;
grant execute on function public.coupon_customers() to authenticated;

-- Make a coupon. p_emails null = all customers. Without email the coupon is ready at once (status 'sent', nothing mailed).
create or replace function public.create_coupon(
  p_code text, p_pct int, p_stay_from date, p_stay_to date, p_book_by date,
  p_emails text[], p_send_email boolean, p_send_at timestamptz, p_by text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_code text := upper(trim(coalesce(p_code, '')));
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  if v_code !~ '^[A-Z0-9_-]{3,24}$' then raise exception 'bad_code'; end if;
  if exists (select 1 from public.promo_offers where upper(code) = v_code and status <> 'cancelled') then raise exception 'code_taken'; end if;
  if p_emails is not null and coalesce(array_length(p_emails, 1), 0) = 0 then raise exception 'no_recipients'; end if;

  insert into public.promo_offers (discount_pct, code, stay_from, stay_to, book_by, send_at, status, finished_at, audience, send_email, created_by)
  values (p_pct, v_code, p_stay_from, p_stay_to, p_book_by,
          case when p_send_email then coalesce(p_send_at, now()) else now() end,
          case when p_send_email then 'scheduled' else 'sent' end,
          case when p_send_email then null else now() end,
          case when p_emails is null then 'all' else 'selected' end, p_send_email, p_by)
  returning id into v_id;

  insert into public.promo_recipients (offer_id, email, name, lang)
  select v_id, c.email, c.name, c.lang
    from public.promo_customers() c
   where p_emails is null or c.email = any (select lower(trim(e)) from unnest(p_emails) e);

  if not exists (select 1 from public.promo_recipients where offer_id = v_id) then raise exception 'no_recipients'; end if;
  return v_id;
end;
$$;
revoke all on function public.create_coupon(text, int, date, date, date, text[], boolean, timestamptz, text) from public, anon;
grant execute on function public.create_coupon(text, int, date, date, date, text[], boolean, timestamptz, text) to authenticated;

-- Who an offer email goes to: its recipients who accept offers (older offers without recipients: the old audience).
create or replace function public.promo_mail_list(p_offer uuid)
returns table (email text, name text, lang text)
language sql
stable
security definer
set search_path = public
as $$
  select r.email, coalesce(r.name, c.name), coalesce(r.lang, c.lang)
    from public.promo_recipients r
    join public.promo_customers() c on c.email = r.email and c.mailable
   where r.offer_id = p_offer
  union all
  select a.email, a.name, a.lang from public.promo_audience() a
   where not exists (select 1 from public.promo_recipients r where r.offer_id = p_offer);
$$;
revoke all on function public.promo_mail_list(uuid) from public, anon, authenticated;

-- The code works for its recipients (or, for older offers, the people it was emailed to).
create or replace function public.promo_check(p_code text, p_email text, p_in date, p_out date)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  with o as (
    select * from public.promo_offers o
     where o.status <> 'cancelled' and o.send_at <= now()
       and o.code is not null and upper(o.code) = upper(trim(coalesce(p_code, '')))
  ), s as (
    select r.email, o.discount_pct, o.stay_from, o.stay_to, o.book_by
      from o join public.promo_recipients r on r.offer_id = o.id
    union all
    select ps.email, o.discount_pct, o.stay_from, o.stay_to, o.book_by
      from o join public.promo_sends ps on ps.offer_id = o.id and ps.status = 'sent'
    union all
    select ps.email, po.discount_pct, po.stay_from, po.stay_to, po.book_by
      from public.promo_sends ps join public.promo_offers po on po.id = ps.offer_id
     where ps.status = 'sent' and po.status <> 'cancelled' and ps.code = upper(trim(coalesce(p_code, '')))
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

-- How many bookings used each coupon (for the admin list).
create or replace function public.coupon_uses()
returns table (code text, uses integer)
language sql
stable
security definer
set search_path = public
as $$
  select upper(r.promo_code), count(*)::int from public.booking_requests r
   where public.is_owner() and r.promo_code is not null and not r.is_test and r.status in ('pending', 'confirmed')
   group by upper(r.promo_code);
$$;
revoke all on function public.coupon_uses() from public, anon;
grant execute on function public.coupon_uses() to authenticated;
