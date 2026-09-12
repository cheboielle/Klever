-- Retain existing named themes while allowing an exact, validated brand colour.
alter table public.tenants drop constraint tenants_brand_theme_check;
alter table public.tenants add check(brand_theme in ('forest','ocean','slate','plum','terracotta') or brand_theme ~ '^#[0-9A-Fa-f]{6}$');
create or replace function public.save_business_branding(p_theme text,p_revision integer) returns boolean language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.require_access(true);begin
 if p_theme is null or not (p_theme in ('forest','ocean','slate','plum','terracotta') or p_theme ~ '^#[0-9A-Fa-f]{6}$') then raise exception 'Choose a colour theme or enter a six-digit HEX code';end if;
 update public.tenants set brand_theme=case when p_theme like '#%' then upper(p_theme) else p_theme end,brand_revision=brand_revision+1 where id=tid and brand_revision=p_revision;
 return found;
end $$;
