-- Ad blockers stop browser requests whose URL contains "coupon", so the admin's RPCs get neutral names.
alter function public.create_coupon(text, int, date, date, date, text[], boolean, timestamptz, text) rename to save_offer;
alter function public.coupon_customers() rename to offer_customers;
alter function public.coupon_uses() rename to offer_uses;
