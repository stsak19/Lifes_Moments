-- Messages between the owners and a guest who booked through the site.
-- The message a guest writes in the booking form (booking_requests.note) becomes the first message of the thread.
-- Owners write replies in the admin; the send-email function emails each reply to the guest and records the result.
create table public.request_messages (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.booking_requests (id) on delete cascade,
  sender       text not null check (sender in ('guest', 'owner')),
  body         text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at   timestamptz not null default now(),
  created_by   text,
  read_at      timestamptz,
  email_status text check (email_status in ('sent', 'failed')),
  email_error  text
);
create index request_messages_thread on public.request_messages (request_id, created_at);
create index request_messages_unread on public.request_messages (created_at) where sender = 'guest' and read_at is null;
alter table public.request_messages enable row level security;

create policy "owners read messages" on public.request_messages
  for select to authenticated using (public.is_owner());
create policy "owners write messages" on public.request_messages
  for insert to authenticated with check (public.is_owner() and sender = 'owner' and email_status is null and read_at is null);
create policy "owners mark messages read" on public.request_messages
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- Owners may only add a reply (request, text, who) and mark messages read; everything else is the server's.
revoke insert, update, delete on public.request_messages from anon, authenticated;
grant insert (request_id, sender, body, created_by) on public.request_messages to authenticated;
grant update (read_at) on public.request_messages to authenticated;

create or replace function public.request_note_to_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.note is not null and btrim(new.note) <> '' then
    insert into public.request_messages (request_id, sender, body, created_at) values (new.id, 'guest', btrim(new.note), new.created_at);
  end if;
  return new;
end $$;
revoke execute on function public.request_note_to_message() from public, anon, authenticated;
create trigger booking_requests_note_message after insert on public.booking_requests
  for each row execute function public.request_note_to_message();

-- Messages already written in earlier requests.
insert into public.request_messages (request_id, sender, body, created_at)
select r.id, 'guest', btrim(r.note), r.created_at from public.booking_requests r
where r.note is not null and btrim(r.note) <> ''
  and not exists (select 1 from public.request_messages m where m.request_id = r.id and m.sender = 'guest');

-- The admin listens for new messages live, like it does for requests.
alter publication supabase_realtime add table public.request_messages;
