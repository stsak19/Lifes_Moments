-- Offer-email consent follows the guest's most recent request (was: the one with the latest check-out).
create or replace function public.promo_customers()
returns table (email text, name text, lang text, mailable boolean)
language sql stable security definer set search_path = public
as $$
  with site as (
    select distinct on (lower(trim(r.email))) lower(trim(r.email)) as email, r.name, r.lang, r.marketing_consent
      from public.booking_requests r
     where not r.is_test and r.status in ('confirmed', 'pending') and r.email like '%@%'
     order by lower(trim(r.email)), r.created_at desc
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
