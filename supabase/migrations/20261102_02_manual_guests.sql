-- Guests the owners add by hand (no booking yet). Same key as guest_notes: email, else last 10 phone digits, else name.
alter table public.guest_notes
  add column if not exists name  text not null default '' check (length(name) <= 200),
  add column if not exists email text not null default '' check (length(email) <= 200),
  add column if not exists phone text not null default '' check (length(phone) <= 50),
  add column if not exists manual boolean not null default false;
