-- Optional cloud development seed. Create a user through Supabase Auth first, then set its UUID below.
-- Never use this development showcase as official tournament data.
do $$
declare admin_id uuid;
begin
  select id into admin_id from auth.users where email='admin@demo.tkd' limit 1;
  if admin_id is null then
    raise notice 'Create admin@demo.tkd with Supabase Auth before running the optional cloud seed.';
    return;
  end if;
  insert into public.profiles(id,email,full_name) values(admin_id,'admin@demo.tkd','Adam Aghzaf') on conflict(id) do update set full_name=excluded.full_name;
  insert into public.organizations(id,name,slug) values('11111111-1111-4111-8111-111111111111','TKDTech Development Organization','tkdtech-development') on conflict(slug) do nothing;
  insert into public.organization_members(organization_id,profile_id,role) values('11111111-1111-4111-8111-111111111111',admin_id,'SUPER_ADMIN') on conflict do nothing;
end $$;
