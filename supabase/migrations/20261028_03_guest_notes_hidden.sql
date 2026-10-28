-- Owners can remove a guest from the phone admin's Πελάτες list (bookings stay untouched).
alter table public.guest_notes add column hidden boolean not null default false;
