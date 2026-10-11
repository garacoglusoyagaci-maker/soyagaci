-- =====================================================
-- SOYAĞACI - Veritabanı şeması (Supabase SQL Editor'de çalıştırın)
-- =====================================================

-- ---------- TABLOLAR ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  approved boolean not null default false,   -- yönetici onaylamadan hiçbir şey göremez
  can_add boolean not null default false,    -- kişi ekleme yetkisi
  is_admin boolean not null default false,
  person_id uuid,                            -- ağaçtaki "ben" kişisi
  created_at timestamptz not null default now()
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text,
  gender text check (gender in ('E','K')),
  birth_date date,
  death_date date,
  birth_place text,
  notes text,
  father_id uuid references public.people(id) on delete set null,
  mother_id uuid references public.people(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Sonradan eklenen alanlar (şema tekrar çalıştırılsa da zararsızdır)
alter table public.people add column if not exists city text;
alter table public.people add column if not exists is_deceased boolean not null default false;
update public.people set is_deceased = true where death_date is not null and is_deceased = false;

alter table public.profiles
  drop constraint if exists profiles_person_fk;
alter table public.profiles
  add constraint profiles_person_fk foreign key (person_id)
  references public.people(id) on delete set null;

create table if not exists public.spouses (
  id uuid primary key default gen_random_uuid(),
  person_a uuid not null references public.people(id) on delete cascade,
  person_b uuid not null references public.people(id) on delete cascade,
  marriage_date date,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  check (person_a <> person_b)
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  storage_path text not null unique,
  caption text,
  visibility text not null default 'private' check (visibility in ('all','private','custom')),
  uploaded_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.photo_viewers (
  photo_id uuid not null references public.photos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (photo_id, user_id)
);

-- Davetler: yöneticinin kişi kaydına bağladığı e-postalar
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references public.people(id) on delete cascade,
  email text not null,
  can_add boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists invites_email_key on public.invites (lower(email));

-- ---------- YARDIMCI FONKSİYONLAR ----------
create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select approved from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin and approved from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select approved and (can_add or is_admin) from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_my_person(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and person_id = pid)
$$;

create or replace function public.is_photo_owner(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.photos where id = pid and uploaded_by = auth.uid())
$$;

create or replace function public.can_view_photo(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (
    select 1 from public.photos p
    where p.id = pid and (
      p.uploaded_by = auth.uid()
      or p.visibility = 'all'
      or (p.visibility = 'custom' and exists (
            select 1 from public.photo_viewers v
            where v.photo_id = p.id and v.user_id = auth.uid()))
    )
  )
$$;

create or replace function public.can_view_photo_path(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_view_photo((select id from public.photos where storage_path = path))
$$;

-- ---------- YENİ KULLANICI -> PROFİL ----------
-- İlk kayıt olan kişi otomatik yönetici olur.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Yönetici olmayanlar yetki alanlarını değiştiremesin
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

drop trigger if exists guard_profile_trg on public.profiles;
create trigger guard_profile_trg
  before update on public.profiles
  for each row execute function public.guard_profile();

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

-- ---------- SATIR DÜZEYİ GÜVENLİK (RLS) ----------
alter table public.profiles      enable row level security;
alter table public.people        enable row level security;
alter table public.spouses       enable row level security;
alter table public.photos        enable row level security;
alter table public.photo_viewers enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_approved());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- people
drop policy if exists people_select on public.people;
create policy people_select on public.people for select to authenticated
  using (public.is_approved());
drop policy if exists people_insert on public.people;
create policy people_insert on public.people for insert to authenticated
  with check (public.can_edit());
drop policy if exists people_update on public.people;
create policy people_update on public.people for update to authenticated
  using (public.is_approved() and (created_by = auth.uid() or public.is_admin() or public.is_my_person(id)))
  with check (public.is_approved());
drop policy if exists people_delete on public.people;
create policy people_delete on public.people for delete to authenticated
  using (public.is_approved() and (created_by = auth.uid() or public.is_admin()));

-- spouses
drop policy if exists spouses_select on public.spouses;
create policy spouses_select on public.spouses for select to authenticated
  using (public.is_approved());
drop policy if exists spouses_insert on public.spouses;
create policy spouses_insert on public.spouses for insert to authenticated
  with check (public.can_edit());
drop policy if exists spouses_delete on public.spouses;
create policy spouses_delete on public.spouses for delete to authenticated
  using (public.is_approved() and (created_by = auth.uid() or public.is_admin()));

-- photos: yalnızca görmeye izni olan kişi satırı görür
drop policy if exists photos_select on public.photos;
create policy photos_select on public.photos for select to authenticated
  using (public.can_view_photo(id));
drop policy if exists photos_insert on public.photos;
create policy photos_insert on public.photos for insert to authenticated
  with check (public.is_approved() and uploaded_by = auth.uid());
drop policy if exists photos_update on public.photos;
create policy photos_update on public.photos for update to authenticated
  using (uploaded_by = auth.uid()) with check (uploaded_by = auth.uid());
drop policy if exists photos_delete on public.photos;
create policy photos_delete on public.photos for delete to authenticated
  using (uploaded_by = auth.uid() or (public.is_admin() and public.can_view_photo(id)));

-- photo_viewers: yalnızca resim sahibi yönetir
drop policy if exists pv_select on public.photo_viewers;
create policy pv_select on public.photo_viewers for select to authenticated
  using (user_id = auth.uid() or public.is_photo_owner(photo_id));
drop policy if exists pv_insert on public.photo_viewers;
create policy pv_insert on public.photo_viewers for insert to authenticated
  with check (public.is_photo_owner(photo_id));
drop policy if exists pv_delete on public.photo_viewers;
create policy pv_delete on public.photo_viewers for delete to authenticated
  using (public.is_photo_owner(photo_id));

-- ---------- RESİM DEPOLAMA (özel kova) ----------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists photos_obj_select on storage.objects;
create policy photos_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.can_view_photo_path(name)));

drop policy if exists photos_obj_insert on storage.objects;
create policy photos_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos'
    and public.is_approved()
    and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists photos_obj_delete on storage.objects;
create policy photos_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (
    (storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
