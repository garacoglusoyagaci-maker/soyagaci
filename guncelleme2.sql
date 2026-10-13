-- =====================================================
-- SOYAĞACI - GÜNCELLEME 2
-- Supabase > SQL Editor'de BİR KEZ çalıştırın (tekrar çalıştırmak zararsızdır).
-- Önce schema.sql (yeni kurulum) ya da guncelleme.sql (eski kurulum) çalışmış olmalıdır.
--
-- Eklenenler
--  1. Tam yetkililerin eklediği kişi/eş kaydı kendi hesabında ANINDA görünür,
--     diğer üyeler yönetici onayından sonra görür ("onay bekliyor" kaydı).
--  2. Silme kuralları (veritabanında zorlanır):
--       - Başka kullanıcının eklediği kaydı kimse silemez (bilgi ekleyebilir).
--       - Ekleyen kişi, eklediği kaydı ilk 5 dakika içinde silebilir.
--       - 5 dakikadan sonra silme bir TALEP olur, yönetici onaylayınca silinir.
--       - Toplu silme KAPALI: tek seferde 1'den fazla kayıt silinemez, tablo boşaltılamaz.
--       - Her silme "deletion_log" tablosuna yedekli kaydedilir.
--  3. Yedekleme: yönetici dışa aktarımı (admin_export), alıcı listesi, yedek günlüğü.
--  4. Yönetici bildirimleri: push abonelikleri, gerçek zamanlı yayın.
-- =====================================================

-- ---------- 0) Talep türleri, bildirim işareti ----------
alter table public.change_requests drop constraint if exists change_requests_kind_check;
alter table public.change_requests add constraint change_requests_kind_check
  check (kind in ('update_person','add_person','add_spouse','add_note',
                  'delete_person','delete_spouse','delete_note','delete_photo'));
alter table public.change_requests add column if not exists notified boolean not null default false;

-- Kişi silinse bile talep kaydı (geçmiş) kalsın
alter table public.change_requests drop constraint if exists change_requests_person_id_fkey;
alter table public.change_requests add constraint change_requests_person_id_fkey
  foreign key (person_id) references public.people(id) on delete set null;

alter table public.profiles add column if not exists signup_notified boolean not null default false;

-- ---------- 1) Onay bekleyen kayıtlar ----------
alter table public.people add column if not exists approval text not null default 'approved';
alter table public.people drop constraint if exists people_approval_chk;
alter table public.people add constraint people_approval_chk check (approval in ('pending','approved'));
-- Onay bekleyen kişi "şu kişinin babası/annesi" olarak eklendiyse, bağ onaylanınca kurulur
alter table public.people add column if not exists pend_father_of uuid references public.people(id) on delete set null;
alter table public.people add column if not exists pend_mother_of uuid references public.people(id) on delete set null;
create index if not exists people_created_by_idx on public.people (created_by);
create index if not exists people_pending_idx on public.people (approval) where approval = 'pending';

alter table public.spouses add column if not exists approval text not null default 'approved';
alter table public.spouses drop constraint if exists spouses_approval_chk;
alter table public.spouses add constraint spouses_approval_chk check (approval in ('pending','approved'));
-- Eşlik kayıtlarında oluşturma zamanı yoktu (5 dakika kuralı için gerekli). Eskiler "eski" sayılır.
alter table public.spouses add column if not exists created_at timestamptz;
update public.spouses set created_at = timestamptz '2000-01-01' where created_at is null;
alter table public.spouses alter column created_at set default now();
alter table public.spouses alter column created_at set not null;

create or replace function public.row_visible(cb uuid, ap text) returns boolean
language sql stable security definer set search_path = public as $$
  select ap = 'approved' or coalesce(cb = auth.uid(), false) or public.is_admin()
$$;

-- Bir kişiyi görebilir mi? (gizli aile tarafı + onay bekleyen kayıtlar)
create or replace function public.can_see_person(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_see_row(p.id, p.hidden_for, p.hidden_by)
                          and public.row_visible(p.created_by, p.approval)
                     from public.people p where p.id = pid), false)
$$;

drop policy if exists people_select on public.people;
create policy people_select on public.people for select to authenticated
  using (public.is_approved()
         and public.can_see_row(id, hidden_for, hidden_by)
         and public.row_visible(created_by, approval));

drop policy if exists spouses_select on public.spouses;
create policy spouses_select on public.spouses for select to authenticated
  using (public.is_approved()
         and public.can_see_person(person_a) and public.can_see_person(person_b)
         and public.row_visible(created_by, approval));

-- ---------- 2) Silme kuralları: API üzerinden doğrudan silme KAPALI ----------
drop policy if exists people_delete  on public.people;
drop policy if exists spouses_delete on public.spouses;
drop policy if exists photos_delete  on public.photos;
drop policy if exists notes_delete   on public.person_notes;
drop policy if exists cr_delete      on public.change_requests;
revoke delete, truncate on public.people, public.spouses, public.photos, public.person_notes, public.change_requests
  from anon, authenticated;

-- Toplu silme kilidi: bir SQL ifadesi 1'den fazla kayıt silemez.
-- İstisna: ana kaydı zaten silinmiş "yetim" satırlar (bir kişi silinince bağlı eş/not/resim kayıtlarının zincirleme silinmesi).
create or replace function public.guard_bulk_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  execute format('select count(*) from old_rows o where not (%s)', TG_ARGV[0]) into n;
  if n > 1 then
    raise exception 'Toplu silme yasaktır: tek seferde yalnızca 1 kayıt silinebilir.' using errcode = 'P0001';
  end if;
  return null;
end $$;

create or replace function public.block_truncate() returns trigger
language plpgsql as $$
begin
  raise exception 'Tabloyu toptan boşaltmak yasaktır.' using errcode = 'P0001';
end $$;

do $$
declare t text; pred text;
begin
  foreach t in array array['people','spouses','photos','person_notes','change_requests','invites'] loop
    pred := case t
      when 'people'          then 'false'
      when 'spouses'         then 'not exists (select 1 from public.people x where x.id = o.person_a) or not exists (select 1 from public.people x where x.id = o.person_b)'
      when 'photos'          then 'not exists (select 1 from public.people x where x.id = o.person_id) or not exists (select 1 from auth.users x where x.id = o.uploaded_by)'
      when 'person_notes'    then 'not exists (select 1 from public.people x where x.id = o.person_id)'
      when 'change_requests' then 'not exists (select 1 from auth.users x where x.id = o.requested_by)'
      when 'invites'         then 'not exists (select 1 from public.people x where x.id = o.person_id)'
    end;
    execute format('drop trigger if exists no_bulk_delete on public.%I', t);
    execute format('create trigger no_bulk_delete after delete on public.%I referencing old table as old_rows for each statement execute function public.guard_bulk_delete(%L)', t, pred);
    execute format('drop trigger if exists no_truncate on public.%I', t);
    execute format('create trigger no_truncate before truncate on public.%I for each statement execute function public.block_truncate()', t);
  end loop;
end $$;

-- Silinen her kaydın yedeği (geri getirmek için)
create table if not exists public.deletion_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  target_id uuid not null,
  label text,
  snapshot jsonb,
  deleted_by uuid,
  mode text not null check (mode in ('direct','approved')),
  created_at timestamptz not null default now()
);
alter table public.deletion_log enable row level security;
drop policy if exists dl_select on public.deletion_log;
create policy dl_select on public.deletion_log for select to authenticated using (public.is_admin());

-- Resim dosyası, yalnızca veritabanı kaydı silindikten sonra (artık kayıt yoksa) silinebilir
create or replace function public.photo_row_exists(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.photos where storage_path = path)
$$;
drop policy if exists photos_obj_delete on storage.objects;
create policy photos_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos'
         and not public.photo_row_exists(name)
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------- Yardımcı (iç) fonksiyonlar ----------
create or replace function public._apply_person_patch(pid uuid, p jsonb, req_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
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
  where id = pid;
end $$;

-- Onay bekleyen kişiyi yayınla (ebeveyni/eşi de onaylıysa)
create or replace function public._approve_pending_person(pid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.people%rowtype;
begin
  select * into pr from public.people where id = pid for update;
  if not found then raise exception 'Kişi bulunamadı (silinmiş olabilir)'; end if;
  if pr.approval = 'approved' then return; end if;
  if pr.father_id is not null and exists (select 1 from public.people where id = pr.father_id and approval = 'pending') then
    raise exception 'Önce babasının kaydını onaylayın: %', (select first_name || ' ' || coalesce(last_name,'') from public.people where id = pr.father_id);
  end if;
  if pr.mother_id is not null and exists (select 1 from public.people where id = pr.mother_id and approval = 'pending') then
    raise exception 'Önce annesinin kaydını onaylayın: %', (select first_name || ' ' || coalesce(last_name,'') from public.people where id = pr.mother_id);
  end if;
  -- Eşlik kayıtları: diğer taraf da yayındaysa onaylanır; değilse o kişi onaylanınca onaylanır
  update public.spouses s set approval = 'approved'
   where s.approval = 'pending' and (s.person_a = pid or s.person_b = pid)
     and not exists (select 1 from public.people o
                      where o.id = case when s.person_a = pid then s.person_b else s.person_a end and o.approval = 'pending' and o.id <> pid);
  if pr.pend_father_of is not null then
    update public.people set father_id = pid where id = pr.pend_father_of and father_id is null;
  end if;
  if pr.pend_mother_of is not null then
    update public.people set mother_id = pid where id = pr.pend_mother_of and mother_id is null;
  end if;
  update public.people set approval = 'approved', pend_father_of = null, pend_mother_of = null where id = pid;
end $$;

-- Gerçek silme (yalnızca diğer fonksiyonlardan çağrılır). Silinen kaydın yedeğini deletion_log'a yazar.
-- Dönüş: silinen kayda ait resim dosyası yolları (arayüz bunları depolamadan kaldırır).
create or replace function public._do_delete(k text, tid uuid, by uuid, md text, except_req uuid default null) returns text[]
language plpgsql security definer set search_path = public as $$
declare paths text[] := '{}'; lbl text; snap jsonb;
begin
  if k = 'person' then
    select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')),
           jsonb_build_object('person', to_jsonb(p),
             'spouses', coalesce((select jsonb_agg(to_jsonb(s)) from public.spouses s where s.person_a = p.id or s.person_b = p.id), '[]'::jsonb),
             'notes',   coalesce((select jsonb_agg(to_jsonb(n)) from public.person_notes n where n.person_id = p.id), '[]'::jsonb),
             'photos',  coalesce((select jsonb_agg(to_jsonb(f)) from public.photos f where f.person_id = p.id), '[]'::jsonb),
             'children', coalesce((select jsonb_agg(c.id) from public.people c where c.father_id = p.id or c.mother_id = p.id), '[]'::jsonb))
      into lbl, snap from public.people p where p.id = tid;
    if snap is null then raise exception 'Kayıt bulunamadı'; end if;
    select coalesce(array_agg(storage_path), '{}') into paths from public.photos where person_id = tid;
    update public.change_requests
       set status = 'rejected', review_note = 'Kişi silindi', reviewed_at = now()
     where person_id = tid and status = 'pending' and id is distinct from except_req;
    delete from public.people where id = tid;
  elsif k = 'spouse' then
    select 'Eşlik kaydı', to_jsonb(s) into lbl, snap from public.spouses s where s.id = tid;
    if snap is null then raise exception 'Kayıt bulunamadı'; end if;
    delete from public.spouses where id = tid;
  elsif k = 'note' then
    select left(n.body, 80), to_jsonb(n) into lbl, snap from public.person_notes n where n.id = tid;
    if snap is null then raise exception 'Kayıt bulunamadı'; end if;
    delete from public.person_notes where id = tid;
  elsif k = 'photo' then
    select coalesce(f.caption, 'Fotoğraf'), to_jsonb(f) into lbl, snap from public.photos f where f.id = tid;
    if snap is null then raise exception 'Kayıt bulunamadı'; end if;
    paths := array[snap->>'storage_path'];
    delete from public.photos where id = tid;
  else
    raise exception 'Geçersiz tür';
  end if;
  insert into public.deletion_log (kind, target_id, label, snapshot, deleted_by, mode)
  values (k, tid, lbl, snap, by, md);
  return paths;
end $$;

revoke all on function public._apply_person_patch(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._approve_pending_person(uuid) from public, anon, authenticated;
revoke all on function public._do_delete(text, uuid, uuid, text, uuid) from public, anon, authenticated;

-- ---------- Tam yetkili üyenin kişi eklemesi: anında kendi hesabında, onayla herkeste ----------
create or replace function public.add_person_pending(p jsonb, summary text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); nid uuid; rid uuid; rname text; tgt uuid; cnt int;
begin
  if not public.can_edit() then raise exception 'Kişi ekleme yetkiniz yok'; end if;
  if public.is_admin() then raise exception 'Yönetici kişileri doğrudan ekler'; end if;
  if nullif(trim(p->>'first_name'), '') is null then raise exception 'Ad gerekli'; end if;
  select count(*) into cnt from public.change_requests where requested_by = uid and status = 'pending';
  if cnt >= 200 then raise exception 'Onay bekleyen çok fazla kaydınız var, önce yöneticinin onaylamasını bekleyin'; end if;
  foreach tgt in array array[nullif(p->>'as_father_of','')::uuid, nullif(p->>'as_mother_of','')::uuid, nullif(p->>'spouse_of','')::uuid] loop
    if tgt is not null and not public.can_see_person(tgt) then raise exception 'İlişki kurulacak kişi bulunamadı'; end if;
  end loop;
  select coalesce(nullif(full_name,''), email) into rname from public.profiles where id = uid;

  insert into public.people (first_name, last_name, gender, birth_date, death_date, birth_place, notes, city,
                             is_deceased, burial_place, blood_type, father_id, mother_id,
                             created_by, approval, pend_father_of, pend_mother_of)
  values (trim(p->>'first_name'), nullif(trim(coalesce(p->>'last_name','')),''), nullif(p->>'gender',''),
          nullif(p->>'birth_date','')::date, nullif(p->>'death_date','')::date,
          nullif(p->>'birth_place',''), nullif(p->>'notes',''), nullif(p->>'city',''),
          coalesce((p->>'is_deceased')::boolean, false), nullif(p->>'burial_place',''), nullif(p->>'blood_type',''),
          nullif(p->>'father_id','')::uuid, nullif(p->>'mother_id','')::uuid,
          uid, 'pending', nullif(p->>'as_father_of','')::uuid, nullif(p->>'as_mother_of','')::uuid)
  returning id into nid;

  tgt := nullif(p->>'spouse_of','')::uuid;
  if tgt is not null then
    insert into public.spouses (person_a, person_b, created_by, approval) values (tgt, nid, uid, 'pending');
  end if;

  insert into public.change_requests (kind, person_id, payload, summary, requested_by, requester_name)
  values ('add_person', nid, p, summary, uid, rname) returning id into rid;
  return jsonb_build_object('person_id', nid, 'request_id', rid);
end $$;

-- Kendi onay bekleyen kişisini doğrudan düzenleme (henüz kimse görmediği için talep gerekmez)
create or replace function public.edit_pending_person(pid uuid, patch jsonb, new_summary text default null) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.people%rowtype;
begin
  select * into pr from public.people where id = pid for update;
  if not found or pr.approval <> 'pending' or pr.created_by is distinct from auth.uid() then
    raise exception 'Bu kaydı doğrudan düzenleyemezsiniz';
  end if;
  perform public._apply_person_patch(pid, patch, true);
  update public.change_requests
     set payload = payload || patch, summary = coalesce(new_summary, summary)
   where person_id = pid and kind = 'add_person' and status = 'pending';
end $$;

create or replace function public.add_spouse_pending(a uuid, b uuid, mdate date default null, summary text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); sid uuid; rid uuid; rname text;
begin
  if not public.can_edit() then raise exception 'Ekleme yetkiniz yok'; end if;
  if public.is_admin() then raise exception 'Yönetici doğrudan ekler'; end if;
  if a = b then raise exception 'Bir kişi kendisiyle evlenemez'; end if;
  if not (public.can_see_person(a) and public.can_see_person(b)) then raise exception 'Kişi bulunamadı'; end if;
  if exists (select 1 from public.spouses where (person_a = a and person_b = b) or (person_a = b and person_b = a)) then
    raise exception 'Bu iki kişi zaten eş olarak kayıtlı';
  end if;
  select coalesce(nullif(full_name,''), email) into rname from public.profiles where id = uid;
  insert into public.spouses (person_a, person_b, marriage_date, created_by, approval)
  values (a, b, mdate, uid, 'pending') returning id into sid;
  insert into public.change_requests (kind, person_id, payload, summary, requested_by, requester_name)
  values ('add_spouse', a, jsonb_build_object('person_a', a, 'person_b', b, 'marriage_date', mdate, 'spouse_row_id', sid),
          summary, uid, rname) returning id into rid;
  return jsonb_build_object('spouse_id', sid, 'request_id', rid);
end $$;

-- ---------- Silme: 5 dakika içinde ekleyen siler, sonra yönetici onayı ----------
create or replace function public.request_delete(kind text, tid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); adm boolean := public.is_admin();
  owner uuid; made timestamptz; pend boolean := false; lbl text; pid uuid; spath text;
  blocked boolean := false; why text; direct boolean; paths text[]; rid uuid; rname text;
  nkids int := 0; recent int; sm text; a_name text; b_name text; spa uuid; spb uuid;
begin
  if not public.is_approved() then raise exception 'Yetkiniz yok'; end if;

  if kind = 'person' then
    select p.created_by, p.created_at, p.approval = 'pending', trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), p.id
      into owner, made, pend, lbl, pid from public.people p where p.id = tid and public.can_see_person(p.id);
    if not found then raise exception 'Kayıt bulunamadı'; end if;
    select count(*) into nkids from public.people c where c.father_id = tid or c.mother_id = tid;
    if exists (select 1 from public.people c where (c.father_id = tid or c.mother_id = tid) and c.created_by is distinct from uid) then
      blocked := true; why := 'Başkalarının eklediği çocuk kayıtları bağlı';
    elsif exists (select 1 from public.spouses s where (s.person_a = tid or s.person_b = tid) and s.created_by is distinct from uid) then
      blocked := true; why := 'Başkalarının eklediği eşlik kaydı bağlı';
    elsif exists (select 1 from public.person_notes n where n.person_id = tid and n.author_id is distinct from uid) then
      blocked := true; why := 'Başkalarının eklediği bilgi notu var';
    elsif exists (select 1 from public.photos f where f.person_id = tid and f.uploaded_by is distinct from uid) then
      blocked := true; why := 'Başkalarının eklediği fotoğraf var';
    elsif exists (select 1 from public.profiles f where f.person_id = tid) or exists (select 1 from public.invites i where i.person_id = tid) then
      blocked := true; why := 'Kişiye bağlı bir hesap ya da davet var';
    end if;
    sm := format('Silme talebi: Kişi “%s”%s', lbl, case when nkids > 0 then format(' (%s çocuk bağlantısı kopacak)', nkids) else '' end);
  elsif kind = 'spouse' then
    select s.created_by, s.created_at, s.approval = 'pending', s.person_a, s.person_b
      into owner, made, pend, spa, spb from public.spouses s where s.id = tid;
    if not found or not (public.can_see_person(spa) and public.can_see_person(spb)) then raise exception 'Kayıt bulunamadı'; end if;
    select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) into a_name from public.people where id = spa;
    select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) into b_name from public.people where id = spb;
    pid := spa;
    sm := format('Silme talebi: Eşlik kaydı %s & %s', a_name, b_name);
  elsif kind = 'note' then
    select n.author_id, n.created_at, n.person_id, left(n.body, 120) into owner, made, pid, lbl
      from public.person_notes n where n.id = tid and public.can_see_person(n.person_id);
    if not found then raise exception 'Kayıt bulunamadı'; end if;
    select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) into a_name from public.people where id = pid;
    sm := format('Silme talebi: Bilgi notu (%s): “%s”', a_name, lbl);
  elsif kind = 'photo' then
    select f.uploaded_by, f.created_at, f.person_id, f.storage_path, coalesce(f.caption, '') into owner, made, pid, spath, lbl
      from public.photos f where f.id = tid and public.can_view_photo(f.id);
    if not found then raise exception 'Kayıt bulunamadı'; end if;
    select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) into a_name from public.people where id = pid;
    sm := format('Silme talebi: Fotoğraf (%s)%s', a_name, case when lbl <> '' then ' “' || lbl || '”' else '' end);
  else
    raise exception 'Geçersiz tür';
  end if;

  -- Sahiplik kuralı: başkasının eklediğini kimse silemez. Sahibi olmayan (silinmiş üye) kayıtlar için yönetici.
  if owner is null then
    if not adm then raise exception 'Bu kaydı yalnızca yönetici silebilir.'; end if;
  elsif owner <> uid then
    raise exception 'Başka bir kullanıcının eklediği kaydı silemezsiniz. Bilgi ekleyebilirsiniz.';
  end if;

  direct := (made > now() - interval '5 minutes' or pend) and not blocked;

  if direct then
    select count(*) into recent from public.deletion_log where deleted_by = uid and created_at > now() - interval '1 hour';
    if recent >= 10 then raise exception 'Çok fazla silme yaptınız, bir süre sonra tekrar deneyin.'; end if;
    paths := public._do_delete(kind, tid, uid, 'direct');
    return jsonb_build_object('status', 'deleted', 'storage_paths', to_jsonb(paths));
  end if;

  if exists (select 1 from public.change_requests c
              where c.status = 'pending' and c.kind = 'delete_' || request_delete.kind and (c.payload->>'target')::uuid = tid) then
    raise exception 'Bu kayıt için zaten bir silme talebi bekliyor.';
  end if;
  select coalesce(nullif(full_name,''), email) into rname from public.profiles where id = uid;
  insert into public.change_requests (kind, person_id, payload, summary, requested_by, requester_name)
  values ('delete_' || request_delete.kind, pid,
          jsonb_build_object('target', tid, 'kind', request_delete.kind, 'storage_path', spath, 'label', lbl),
          sm, uid, rname)
  returning id into rid;
  return jsonb_build_object('status', 'requested', 'request_id', rid, 'reason', why);
end $$;

-- Kendi bekleyen talebini geri çekme (kayıt silinmez, "reddedildi" olarak saklanır)
create or replace function public.withdraw_request(req_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.change_requests%rowtype;
begin
  select * into r from public.change_requests where id = req_id for update;
  if not found or r.requested_by <> auth.uid() or r.status <> 'pending' then raise exception 'Talep geri çekilemez'; end if;
  if r.kind = 'add_person' and r.person_id is not null then
    delete from public.people where id = r.person_id and approval = 'pending';
  elsif r.kind = 'add_spouse' and r.payload ? 'spouse_row_id' then
    delete from public.spouses where id = (r.payload->>'spouse_row_id')::uuid and approval = 'pending';
  end if;
  update public.change_requests set status = 'rejected', review_note = 'Talep sahibi geri çekti', reviewed_at = now() where id = req_id;
end $$;

-- ---------- Talebi onayla / reddet (yalnızca yönetici) ----------
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
  paths text[];
  sp public.spouses%rowtype;
begin
  if not public.is_admin() then raise exception 'Yetkiniz yok'; end if;
  select * into r from public.change_requests where id = req_id for update;
  if not found then raise exception 'Talep bulunamadı'; end if;
  if r.status <> 'pending' then raise exception 'Talep zaten işlenmiş'; end if;
  p := r.payload;
  result := r.person_id;

  if approve then
    select coalesce(is_admin,false) into req_admin from public.profiles where id = r.requested_by;
    req_admin := coalesce(req_admin,false);

    if r.kind = 'update_person' then
      if r.person_id is null then raise exception 'Kişi artık yok'; end if;
      perform public._apply_person_patch(r.person_id, p, req_admin);

    elsif r.kind = 'add_person' then
      if r.person_id is not null then
        perform public._approve_pending_person(r.person_id);   -- anında eklenmiş, onay bekleyen kişi
      else
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
        tgt := nullif(p->>'as_father_of','')::uuid;
        if tgt is not null then update public.people set father_id = new_id where id = tgt and father_id is null; end if;
        tgt := nullif(p->>'as_mother_of','')::uuid;
        if tgt is not null then update public.people set mother_id = new_id where id = tgt and mother_id is null; end if;
        tgt := nullif(p->>'spouse_of','')::uuid;
        if tgt is not null then
          insert into public.spouses (person_a, person_b, created_by) values (tgt, new_id, r.requested_by);
        end if;
      end if;

    elsif r.kind = 'add_spouse' then
      if p ? 'spouse_row_id' then
        select * into sp from public.spouses where id = (p->>'spouse_row_id')::uuid for update;
        if not found then raise exception 'Eşlik kaydı bulunamadı'; end if;
        if exists (select 1 from public.people where id in (sp.person_a, sp.person_b) and approval = 'pending') then
          raise exception 'Önce eşlerin kişi kayıtlarını onaylayın';
        end if;
        update public.spouses set approval = 'approved' where id = sp.id;
      else
        insert into public.spouses (person_a, person_b, marriage_date, created_by)
        values ((p->>'person_a')::uuid, (p->>'person_b')::uuid, nullif(p->>'marriage_date','')::date, r.requested_by);
      end if;

    elsif r.kind = 'add_note' then
      insert into public.person_notes (person_id, body, author_id, author_name)
      values (r.person_id, p->>'text', r.requested_by, r.requester_name);

    elsif r.kind in ('delete_person','delete_spouse','delete_note','delete_photo') then
      paths := public._do_delete(p->>'kind', (p->>'target')::uuid, auth.uid(), 'approved', req_id);
      update public.change_requests set payload = payload || jsonb_build_object('storage_paths', to_jsonb(paths)) where id = req_id;
    end if;

  else
    -- Reddedilen "anında eklenmiş" kayıtlar kaldırılır (başkaları zaten görmemişti)
    if r.kind = 'add_person' and r.person_id is not null then
      delete from public.people where id = r.person_id and approval = 'pending';
    elsif r.kind = 'add_spouse' and p ? 'spouse_row_id' then
      delete from public.spouses where id = (p->>'spouse_row_id')::uuid and approval = 'pending';
    end if;
  end if;

  update public.change_requests
     set status = case when approve then 'approved' else 'rejected' end,
         review_note = note, reviewed_by = auth.uid(), reviewed_at = now()
   where id = req_id;
  return result;
end $$;

-- ---------- 3) Yedekleme ----------
create table if not exists public.backup_recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  label text,
  created_at timestamptz not null default now()
);
create unique index if not exists backup_recipients_email_key on public.backup_recipients (lower(email));
alter table public.backup_recipients enable row level security;
drop policy if exists br_admin on public.backup_recipients;
create policy br_admin on public.backup_recipients for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create table if not exists public.backup_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                 -- 'indirme' | 'e-posta' | 'test'
  status text not null default 'ok',  -- 'ok' | 'hata'
  detail text,
  recipients int,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.backup_log enable row level security;
drop policy if exists bl_select on public.backup_log;
create policy bl_select on public.backup_log for select to authenticated using (public.is_admin());
drop policy if exists bl_insert on public.backup_log;
create policy bl_insert on public.backup_log for insert to authenticated with check (public.is_admin() and created_by = auth.uid());

-- Tüm veriyi (gizli taraflar ve onay bekleyenler dahil) tek JSON olarak verir. Yalnızca yönetici.
create or replace function public.admin_export(include_members boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception 'Yetkiniz yok'; end if;
  res := jsonb_build_object(
    'exported_at', now(),
    'people',       coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.people x), '[]'::jsonb),
    'spouses',      coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.spouses x), '[]'::jsonb),
    'person_notes', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.person_notes x), '[]'::jsonb),
    'photos',       coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'person_id', x.person_id, 'storage_path', x.storage_path,
                              'caption', x.caption, 'visibility', x.visibility, 'uploaded_by', x.uploaded_by, 'created_at', x.created_at)
                              order by x.created_at) from public.photos x), '[]'::jsonb),
    'change_requests_pending', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.change_requests x where x.status = 'pending'), '[]'::jsonb),
    'deletion_log', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.deletion_log x), '[]'::jsonb)
  );
  if include_members then
    res := res || jsonb_build_object(
      'members', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'email', x.email, 'full_name', x.full_name,
                    'approved', x.approved, 'can_add', x.can_add, 'is_admin', x.is_admin, 'person_id', x.person_id)) from public.profiles x), '[]'::jsonb),
      'invites', coalesce((select jsonb_agg(to_jsonb(x)) from public.invites x), '[]'::jsonb));
  end if;
  return res;
end $$;

-- ---------- 4) Yönetici bildirimleri ----------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists ps_select on public.push_subscriptions;
create policy ps_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists ps_delete on public.push_subscriptions;
create policy ps_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- Aynı cihaz başka hesaba geçerse abonelik yeni hesaba devredilir
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Yetkiniz yok'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end $$;

-- Uygulama açıkken yönetici anında haberdar olsun (Supabase Realtime)
do $$
begin
  begin alter publication supabase_realtime add table public.change_requests;
  exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then null; when undefined_object then null; end;
end $$;

-- ---------- Çağrı izinleri ----------
do $$
declare f text;
begin
  foreach f in array array[
    'add_person_pending(jsonb, text)', 'edit_pending_person(uuid, jsonb, text)',
    'add_spouse_pending(uuid, uuid, date, text)', 'request_delete(text, uuid)', 'withdraw_request(uuid)',
    'review_change(uuid, boolean, text)', 'admin_export(boolean)',
    'save_push_subscription(text, text, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
