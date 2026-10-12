-- =====================================================
-- GİZLİ AİLE TARAFI
-- Bir kişinin (örn. eşinizin) ebeveyn tarafını genel ağaçtan gizler.
-- Gizlenenleri yalnızca ayarı yapan yönetici ve o kişinin bağlı hesabı (eşiniz) görür.
-- Seçenekler: 'all' (herkes görsün), 'parents' (yalnızca anne-babası görünsün), 'none' (hiçbiri görünmesin)
-- Tekrar çalıştırmak zararsızdır.
-- =====================================================
alter table public.people add column if not exists side_mode  text not null default 'all';
alter table public.people drop constraint if exists people_side_mode_chk;
alter table public.people add constraint people_side_mode_chk check (side_mode in ('all','parents','none'));
alter table public.people add column if not exists side_owner uuid references auth.users(id) on delete set null;
alter table public.people add column if not exists hidden_for uuid;  -- bu kişi, hangi kişinin gizli tarafında (boş = herkese açık)
alter table public.people add column if not exists hidden_by  uuid references auth.users(id) on delete set null;

-- Satırı görebilir mi? Herkese açık, ya da gizliyi ayarlayan, ya da gizli tarafın sahibi kişinin hesabı.
create or replace function public.can_see_row(rid uuid, hf uuid, hb uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select hf is null
      or coalesce(hb = auth.uid(), false)
      or exists (select 1 from public.profiles
                  where id = auth.uid() and person_id is not null and (person_id = hf or person_id = rid))
$$;

create or replace function public.can_see_person(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_see_row(p.id, p.hidden_for, p.hidden_by) from public.people p where p.id = pid), false)
$$;

-- Kişi tablosu: gizli satırlar diğer üyelere hiç gönderilmez
drop policy if exists people_select on public.people;
create policy people_select on public.people for select to authenticated
  using (public.is_approved() and public.can_see_row(id, hidden_for, hidden_by));

-- Gizli kişilerin fotoğrafları, notları ve eşlik kayıtları da gizlenir
create or replace function public.can_view_photo(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (
    select 1 from public.photos p
    where p.id = pid and public.can_see_person(p.person_id) and (
      p.uploaded_by = auth.uid()
      or p.visibility = 'all'
      or (p.visibility = 'custom' and exists (
            select 1 from public.photo_viewers v
            where v.photo_id = p.id and v.user_id = auth.uid()))
    )
  )
$$;

drop policy if exists notes_select on public.person_notes;
create policy notes_select on public.person_notes for select to authenticated
  using (public.is_approved() and public.can_see_person(person_id));

drop policy if exists spouses_select on public.spouses;
create policy spouses_select on public.spouses for select to authenticated
  using (public.is_approved() and public.can_see_person(person_a) and public.can_see_person(person_b));

-- Bir kişinin tarafını yeniden hesapla.
-- Taraf = kişinin anne-babasından başlayarak ata/kardeş/amca-hala-kuzen vb. tüm kan bağı kolları ve bunların eşleri.
-- Kişinin kendisi, eşleri ve çocukları/torunları (sizin ailenizle ortak kısım) asla gizlenmez.
create or replace function public.apply_side_privacy(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.people%rowtype;
begin
  select * into s from public.people where id = sid;
  if not found then return; end if;
  update public.people set hidden_for = null, hidden_by = null where hidden_for = sid;
  if s.side_mode = 'all' or s.side_owner is null then return; end if;

  with recursive
  sp as (
    select person_a as x, person_b as y from public.spouses
    union all
    select person_b, person_a from public.spouses
  ),
  descs as (
    select id from public.people where id = sid
    union
    select c.id from public.people c join descs d on c.father_id = d.id or c.mother_id = d.id
  ),
  excl as (
    select id from descs
    union
    select sp.y from sp where sp.x = sid
  ),
  edges as (
    select id as a, father_id as b from public.people where father_id is not null
    union select id, mother_id from public.people where mother_id is not null
    union select father_id, id from public.people where father_id is not null
    union select mother_id, id from public.people where mother_id is not null
  ),
  core(id) as (
    select x from (
      select father_id as x from public.people where id = sid
      union
      select mother_id from public.people where id = sid
    ) t where x is not null and x not in (select id from excl)
    union
    select e.b from core c join edges e on e.a = c.id where e.b not in (select id from excl)
  ),
  side as (
    select id from core
    union
    select sp.y from sp join core c on sp.x = c.id where sp.y not in (select id from excl)
  )
  update public.people p
     set hidden_for = sid, hidden_by = s.side_owner
   where p.id in (select id from side)
     and p.hidden_for is null
     and (s.side_mode = 'none'
          or p.id not in (coalesce(s.father_id, gen_random_uuid()), coalesce(s.mother_id, gen_random_uuid())));
end $$;

-- Ağaç değiştikçe (kişi/eş eklenince, ebeveyn bağlanınca) gizli tarafları otomatik güncelle
create or replace function public.refresh_sides() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  for r in select id from public.people where side_mode <> 'all' loop
    perform public.apply_side_privacy(r.id);
  end loop;
  return null;
end $$;

drop trigger if exists people_sides_trg on public.people;
create trigger people_sides_trg
  after insert or delete or update of father_id, mother_id, side_mode on public.people
  for each statement execute function public.refresh_sides();

drop trigger if exists spouses_sides_trg on public.spouses;
create trigger spouses_sides_trg
  after insert or delete on public.spouses
  for each statement execute function public.refresh_sides();

-- Uygulamadan çağrılır (yalnızca yönetici)
create or replace function public.set_side_privacy(sid uuid, mode text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Yetkiniz yok'; end if;
  if mode not in ('all','parents','none') then raise exception 'Geçersiz seçenek'; end if;
  update public.people set side_mode = mode, side_owner = auth.uid() where id = sid;
  perform public.apply_side_privacy(sid);
end $$;
grant execute on function public.set_side_privacy(uuid, text) to authenticated;

notify pgrst, 'reload schema';
