-- Each owner can change their own display name from the admin Settings (Προφίλ).
-- Only the name column: the email stays fixed, since it decides who is an owner.
revoke update on public.owners from authenticated;
grant update (name) on public.owners to authenticated;

create policy "owner changes own name" on public.owners
  for update to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (email = lower(coalesce(auth.jwt() ->> 'email', '')));
