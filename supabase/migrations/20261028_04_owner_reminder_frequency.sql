-- Each owner picks how often they're reminded about an unanswered request until it expires.
-- 0 = never, -1 = once (4 hours before expiry, the old behaviour), N = every N hours.
alter table public.owners add column remind_every smallint not null default -1
  check (remind_every in (-1, 0, 1, 2, 3, 6));
grant update (name, remind_every) on public.owners to authenticated;

-- When each owner was last reminded about each request (so reminders are per owner).
create table public.request_reminders (
  request_id  uuid not null references public.booking_requests (id) on delete cascade,
  owner_email text not null references public.owners (email) on delete cascade on update cascade,
  last_at     timestamptz not null default now(),
  primary key (request_id, owner_email)
);
alter table public.request_reminders enable row level security; -- service role only
