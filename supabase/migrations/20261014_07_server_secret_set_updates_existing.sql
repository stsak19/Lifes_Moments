-- server_secret_set used to do nothing when the secret already existed, so replacing a key
-- (e.g. a new Resend API key) silently kept the old one. Now it updates the existing secret.
create or replace function public.server_secret_set(p_name text, p_value text)
returns void language plpgsql security definer set search_path to ''
as $function$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = p_name;
  if sid is null then perform vault.create_secret(p_value, p_name);
  else perform vault.update_secret(sid, p_value);
  end if;
end;
$function$;
