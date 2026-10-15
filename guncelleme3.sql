-- Güncelleme 3: "Evlenmeden önceki soyadı" alanı (maiden_name)
-- Supabase > SQL Editor'de bir kez çalıştırın (tekrar çalıştırmak zararsızdır).

alter table public.people add column if not exists maiden_name text;

create or replace function public._apply_person_patch(pid uuid, p jsonb, req_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.people set
    first_name  = case when p ? 'first_name'  and nullif(p->>'first_name','') is not null then p->>'first_name' else first_name end,
    last_name   = case when p ? 'last_name'   then nullif(p->>'last_name','') else last_name end,
    maiden_name = case when p ? 'maiden_name' then nullif(p->>'maiden_name','') else maiden_name end,
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

  insert into public.people (first_name, last_name, maiden_name, gender, birth_date, death_date, birth_place, notes, city,
                             is_deceased, burial_place, blood_type, father_id, mother_id,
                             created_by, approval, pend_father_of, pend_mother_of)
  values (trim(p->>'first_name'), nullif(trim(coalesce(p->>'last_name','')),''), nullif(trim(coalesce(p->>'maiden_name','')),''), nullif(p->>'gender',''),
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
  if public.can_publish() then
    begin   -- onaysız yetki: hemen yayınlanır, yöneticiye yalnızca bildirim gider
      perform public._approve_pending_person(nid);
      update public.change_requests set status = 'approved', review_note = 'Onaysız yetkiyle eklendi', reviewed_by = uid, reviewed_at = now() where id = rid;
      return jsonb_build_object('person_id', nid, 'request_id', rid, 'published', true);
    exception when others then null;   -- ebeveyni henüz onay bekliyorsa kayıt bekleyen olarak kalır
    end;
  end if;
  return jsonb_build_object('person_id', nid, 'request_id', rid);
end $$;

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
        insert into public.people (first_name,last_name,maiden_name,gender,birth_date,death_date,birth_place,notes,city,
                                   is_deceased,burial_place,blood_type,father_id,mother_id,created_by)
        values (
          p->>'first_name', nullif(p->>'last_name',''), nullif(p->>'maiden_name',''), nullif(p->>'gender',''),
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
