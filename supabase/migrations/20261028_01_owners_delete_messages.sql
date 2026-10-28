-- Owners can clear old conversations from the phone admin (swipe left → delete on a thread).
create policy "owners delete messages" on public.request_messages
  for delete to authenticated using (public.is_owner());
grant delete on public.request_messages to authenticated;
