-- Each owner gets their own colour (avatar in the admin). The database picks it when the owner is
-- created: the first colour of the palette that nobody uses yet, or the least used one once all are taken.
-- The admin maps the key to the actual colours, so the palette can be retuned without touching the data.
alter table public.owners add column if not exists color text;

create or replace function public.owner_pick_color()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  palette text[] := array['amber','teal','coral','violet','sky','rose','olive','slate'];
begin
  if new.color is null or not (new.color = any (palette)) then
    select p.c into new.color
    from unnest(palette) with ordinality as p(c, i)
    left join public.owners o on o.color = p.c and o.email <> new.email
    group by p.c, p.i
    order by count(o.email), p.i
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists owners_pick_color on public.owners;
create trigger owners_pick_color before insert on public.owners
  for each row execute function public.owner_pick_color();

-- Existing owners, oldest first, get distinct colours.
do $$
declare r record;
begin
  for r in select email from public.owners where color is null order by created_at, email loop
    update public.owners o set color = (
      select p.c from unnest(array['amber','teal','coral','violet','sky','rose','olive','slate']) with ordinality as p(c, i)
      left join public.owners x on x.color = p.c
      group by p.c, p.i order by count(x.email), p.i limit 1)
    where o.email = r.email;
  end loop;
end $$;

alter table public.owners alter column color set not null;
