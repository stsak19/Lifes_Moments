-- The guest now picks the language of their emails in the request form: Greek, English, Turkish or Bulgarian.
-- 1) booking_requests.lang accepts 'tr' and 'bg'.
-- 2) lang_chosen marks a language the guest picked themselves; the guess from name/phone/email
--    (detect_guest_lang) then leaves it alone. Requests made any other way are guessed as before.
alter table public.booking_requests drop constraint if exists booking_requests_lang_check;
alter table public.booking_requests add constraint booking_requests_lang_check check (lang in ('el', 'en', 'tr', 'bg'));
alter table public.booking_requests add column if not exists lang_chosen boolean not null default false;

create or replace function public.detect_guest_lang()
returns trigger
language plpgsql
set search_path = public
as $$
declare ph text := regexp_replace(coalesce(new.phone, ''), '[^0-9+]', '', 'g');
begin
  if new.lang_chosen then return new; end if;
  if new.name ~ '[Ͱ-Ͽ]' then new.lang := 'el';
  elsif ph ~ '^(\+|00)(30|357)' then new.lang := 'el';
  elsif ph ~ '^(\+|00)[1-9]' then new.lang := 'en';
  elsif ph ~ '^(69|2[0-9])[0-9]{8}$' then new.lang := 'el';
  elsif new.email ~* '\.gr$' then new.lang := 'el';
  end if;
  return new;
end
$$;
