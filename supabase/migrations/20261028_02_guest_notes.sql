-- Owners' private notes about a guest (keyed like the phone admin groups guests: email, else last 10 phone digits, else name).
create table public.guest_notes (
  guest_key  text primary key check (length(guest_key) between 1 and 200),
  note       text not null default '' check (length(note) <= 5000),
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
alter table public.guest_notes enable row level security;
create policy "owners read guest notes" on public.guest_notes for select to authenticated using (public.is_owner());
create policy "owners add guest notes" on public.guest_notes for insert to authenticated with check (public.is_owner());
create policy "owners change guest notes" on public.guest_notes for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owners remove guest notes" on public.guest_notes for delete to authenticated using (public.is_owner());
revoke all on public.guest_notes from anon;
grant select, insert, update, delete on public.guest_notes to authenticated;
