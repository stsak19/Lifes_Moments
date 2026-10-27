-- Owners delete coupons instead of switching them off (recipients and sends go with them).
grant delete on public.promo_offers to authenticated;
create policy "owners delete offers" on public.promo_offers for delete to authenticated using (public.is_owner());
