-- Decides Greek or English for the guest emails from what the guest typed, before the request is saved.
-- Order: Greek letters in the name, then the phone country code (+30 / +357 Greek, any other code English),
-- then a Greek-looking local number, then an email ending in .gr; otherwise the language the site sent
-- (which already follows the visitor's browser or menu choice).
create or replace function public.detect_guest_lang()
returns trigger
language plpgsql
set search_path = public
as $$
declare ph text := regexp_replace(coalesce(new.phone, ''), '[^0-9+]', '', 'g');
begin
  if new.name ~ '[Ͱ-Ͽ]' then new.lang := 'el';
  elsif ph ~ '^(\+|00)(30|357)' then new.lang := 'el';
  elsif ph ~ '^(\+|00)[1-9]' then new.lang := 'en';
  elsif ph ~ '^(69|2[0-9])[0-9]{8}$' then new.lang := 'el';
  elsif new.email ~* '\.gr$' then new.lang := 'el';
  end if;
  return new;
end
$$;

revoke all on function public.detect_guest_lang() from public, anon, authenticated;

create trigger booking_requests_detect_lang
  before insert on public.booking_requests
  for each row execute function public.detect_guest_lang();
