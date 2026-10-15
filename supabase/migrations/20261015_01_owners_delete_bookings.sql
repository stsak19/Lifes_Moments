-- Owners can delete bookings from the admin (requests from the site and stays they or the Booking.com sync added).
-- The admin asks for confirmation first and keeps Booking.com-synced stays out of it (the sync would bring them back).
create policy "owners delete requests" on public.booking_requests
  for delete to authenticated using (public.is_owner());
create policy "owners delete stays" on public.owner_stays
  for delete to authenticated using (public.is_owner());
