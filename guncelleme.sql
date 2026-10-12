-- Mevcut kurulumu güncelleme (Supabase > SQL Editor'de bir kez çalıştırın)
-- Eklenenler: şehir, vefat işareti, davetler, onay akışı, mezar yeri, kan grubu, bilgi notları, güvenlik düzeltmesi.
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

-- =====================================================
-- ONAY AKIŞI, MEZAR YERİ, KAN GRUBU, BİLGİ NOTLARI
-- Admin dışındaki herkesin değişikliği "talep" olarak kaydolur; admin onaylayınca uygulanır.
-- =====================================================
alter table public.people add column if not exists burial_place text;
alter table public.people add column if not exists blood_type text;
alter table public.people drop constraint if exists people_blood_type_chk;
alter table public.people add constraint people_blood_type_chk
  check (blood_type is null or blood_type in ('A+','A-','B+','B-','AB+','AB-','0+','0-'));

-- Bilgi notları (herkes okur, yalnızca onaylanınca eklenir)
create table if not exists public.person_notes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  body text not null,
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  created_at timestamptz not null default now()
);
create index if not exists person_notes_person_idx on public.person_notes (person_id);

-- Değişiklik talepleri
create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('update_person','add_person','add_spouse','add_note')),
  person_id uuid references public.people(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  summary text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  requester_name text,
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  announced boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists change_requests_status_idx on public.change_requests (status, created_at);

create or replace function public.can_propose() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_approved()
$$;

-- Talebi onayla / reddet (yalnızca yönetici)
drop function if exists public.review_change(uuid, boolean, text);
create or replace function public.review_change(req_id uuid, approve boolean, note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r public.change_requests%rowtype;
  p jsonb;
  new_id uuid;
  tgt uuid;
  req_admin boolean;
  result uuid;
begin
  if not public.is_admin() then raise exception 'Yetkiniz yok'; end if;
  select * into r from public.change_requests where id = req_id for update;
  if not found then raise exception 'Talep bulunamadı'; end if;
  if r.status <> 'pending' then raise exception 'Talep zaten işlenmiş'; end if;

  if approve then
    p := r.payload;
    result := r.person_id;
    select coalesce(is_admin,false) into req_admin from public.profiles where id = r.requested_by;
    req_admin := coalesce(req_admin,false);
    if r.kind = 'update_person' then
      update public.people set
        first_name  = case when p ? 'first_name'  and nullif(p->>'first_name','') is not null then p->>'first_name' else first_name end,
        last_name   = case when p ? 'last_name'   then nullif(p->>'last_name','') else last_name end,
        gender      = case when p ? 'gender'      then nullif(p->>'gender','') else gender end,
        birth_date  = case when p ? 'birth_date'  then nullif(p->>'birth_date','')::date else birth_date end,
        death_date  = case when p ? 'death_date'  then nullif(p->>'death_date','')::date else death_date end,
        birth_place = case when p ? 'birth_place' then nullif(p->>'birth_place','') else birth_place end,
        notes       = case when p ? 'notes'       then nullif(p->>'notes','') else notes end,
        city        = case when p ? 'city'        then nullif(p->>'city','') else city end,
        is_deceased = case when p ? 'is_deceased' then (p->>'is_deceased')::boolean else is_deceased end,
        burial_place= case when p ? 'burial_place' then nullif(p->>'burial_place','') else burial_place end,
        blood_type  = case when p ? 'blood_type'  then nullif(p->>'blood_type','') else blood_type end,
        -- yönetici dışındakiler için ebeveyn yalnızca boşsa doldurulur, mevcut bağ silinmez/değişmez
        father_id   = case when p ? 'father_id' and (father_id is null or req_admin) then nullif(p->>'father_id','')::uuid else father_id end,
        mother_id   = case when p ? 'mother_id' and (mother_id is null or req_admin) then nullif(p->>'mother_id','')::uuid else mother_id end
      where id = r.person_id;
    elsif r.kind = 'add_person' then
      insert into public.people (first_name,last_name,gender,birth_date,death_date,birth_place,notes,city,
                                 is_deceased,burial_place,blood_type,father_id,mother_id,created_by)
      values (
        p->>'first_name', nullif(p->>'last_name',''), nullif(p->>'gender',''),
        nullif(p->>'birth_date','')::date, nullif(p->>'death_date','')::date,
        nullif(p->>'birth_place',''), nullif(p->>'notes',''), nullif(p->>'city',''),
        coalesce((p->>'is_deceased')::boolean,false), nullif(p->>'burial_place',''), nullif(p->>'blood_type',''),
        nullif(p->>'father_id','')::uuid, nullif(p->>'mother_id','')::uuid, r.requested_by)
      returning id into new_id;
      result := new_id;
      -- "şu kişinin babası/annesi" (üst soy ekleme): yalnızca ilgili alan boşsa
      tgt := nullif(p->>'as_father_of','')::uuid;
      if tgt is not null then update public.people set father_id = new_id where id = tgt and father_id is null; end if;
      tgt := nullif(p->>'as_mother_of','')::uuid;
      if tgt is not null then update public.people set mother_id = new_id where id = tgt and mother_id is null; end if;
      -- "şu kişinin eşi"
      tgt := nullif(p->>'spouse_of','')::uuid;
      if tgt is not null then
        insert into public.spouses (person_a, person_b, created_by) values (tgt, new_id, r.requested_by);
      end if;
    elsif r.kind = 'add_spouse' then
      insert into public.spouses (person_a, person_b, marriage_date, created_by)
      values ((p->>'person_a')::uuid, (p->>'person_b')::uuid, nullif(p->>'marriage_date','')::date, r.requested_by);
    elsif r.kind = 'add_note' then
      insert into public.person_notes (person_id, body, author_id, author_name)
      values (r.person_id, p->>'text', r.requested_by, r.requester_name);
    end if;
  end if;

  update public.change_requests
     set status = case when approve then 'approved' else 'rejected' end,
         review_note = note, reviewed_by = auth.uid(), reviewed_at = now()
   where id = req_id;
  return result;
end $$;

grant execute on function public.review_change(uuid, boolean, text) to authenticated;

alter table public.person_notes    enable row level security;
alter table public.change_requests enable row level security;

drop policy if exists notes_select on public.person_notes;
create policy notes_select on public.person_notes for select to authenticated using (public.is_approved());
drop policy if exists notes_insert on public.person_notes;
create policy notes_insert on public.person_notes for insert to authenticated with check (public.is_admin());
drop policy if exists notes_delete on public.person_notes;
create policy notes_delete on public.person_notes for delete to authenticated using (public.is_admin());

drop policy if exists cr_select on public.change_requests;
create policy cr_select on public.change_requests for select to authenticated
  using (requested_by = auth.uid() or public.is_admin());
drop policy if exists cr_insert on public.change_requests;
create policy cr_insert on public.change_requests for insert to authenticated
  with check (public.can_propose() and requested_by = auth.uid() and status = 'pending');
drop policy if exists cr_update on public.change_requests;
create policy cr_update on public.change_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists cr_delete on public.change_requests;
create policy cr_delete on public.change_requests for delete to authenticated
  using (public.is_admin() or (requested_by = auth.uid() and status = 'pending'));

-- Kişi ve eş kayıtlarına doğrudan yazma artık yalnızca yönetici (diğerleri talep gönderir)
drop policy if exists people_insert on public.people;
create policy people_insert on public.people for insert to authenticated with check (public.is_admin());
drop policy if exists people_update on public.people;
create policy people_update on public.people for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists people_delete on public.people;
create policy people_delete on public.people for delete to authenticated using (public.is_admin());
drop policy if exists spouses_insert on public.spouses;
create policy spouses_insert on public.spouses for insert to authenticated with check (public.is_admin());
drop policy if exists spouses_delete on public.spouses;
create policy spouses_delete on public.spouses for delete to authenticated using (public.is_admin());
