-- Mevcut kurulumu güncelleme (Supabase > SQL Editor'de bir kez çalıştırın)
-- Eklenenler: şehir, vefat işareti, davetler (e-posta ile kişi bağlama) ve güvenlik düzeltmesi.
-- Verileriniz silinmez. Tekrar çalıştırmak zararsızdır.

alter table public.people add column if not exists city text;
alter table public.people add column if not exists is_deceased boolean not null default false;
update public.people set is_deceased = true where death_date is not null and is_deceased = false;

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references public.people(id) on delete cascade,
  email text not null,
  can_add boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists invites_email_key on public.invites (lower(email));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
  inv public.invites%rowtype;
  has_inv boolean;
begin
  select not exists (select 1 from public.profiles) into first_user;
  select * into inv from public.invites where email = lower(new.email) limit 1;
  has_inv := found;
  insert into public.profiles (id, email, full_name, approved, can_add, is_admin, person_id)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)),
    first_user or has_inv,
    first_user or (has_inv and inv.can_add),
    first_user,
    case when has_inv then inv.person_id else null end
  );
  return new;
end $$;

create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.is_admin  := old.is_admin;
    new.can_add   := old.can_add;
    new.approved  := old.approved;
    new.email     := old.email;
    new.person_id := old.person_id;  -- kişi bağlamayı yalnızca yönetici yapar
  end if;
  return new;
end $$;

-- ---------- DAVETLER: kişi kaydına e-posta bağlama ----------
-- Yönetici bir kişiye e-posta yazar. O e-postayla kayıt olan kişi otomatik onaylanır
-- ve kendi kaydına bağlanır (sadece kendi kaydını düzenleyebilir).
create or replace function public.invite_normalize() returns trigger
language plpgsql as $$
begin
  new.email := lower(trim(new.email));
  return new;
end $$;

drop trigger if exists invite_normalize_trg on public.invites;
create trigger invite_normalize_trg
  before insert or update on public.invites
  for each row execute function public.invite_normalize();

-- E-posta zaten kayıtlıysa hemen bağla ve onayla
create or replace function public.invite_apply_existing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set person_id = new.person_id,
         approved  = true,
         can_add   = case when is_admin then can_add else new.can_add end
   where lower(email) = new.email;
  return new;
end $$;

drop trigger if exists invite_apply_existing_trg on public.invites;
create trigger invite_apply_existing_trg
  after insert or update on public.invites
  for each row execute function public.invite_apply_existing();

alter table public.invites enable row level security;
drop policy if exists invites_admin on public.invites;
create policy invites_admin on public.invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
