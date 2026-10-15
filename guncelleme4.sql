-- Güncelleme 4: hesap bazlı akrabalık adları + profil fotoğrafı (görünürlük seçilebilir)
-- Supabase > SQL Editor'de bir kez çalıştırın (tekrar çalıştırmak zararsızdır). Önce guncelleme2.sql çalıştırılmış olmalı.

-- 1) Akrabalık adları: her hesap kendi tercihini görür, başkası göremez
create table if not exists public.user_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rel_names jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_prefs enable row level security;
drop policy if exists up_select on public.user_prefs;
create policy up_select on public.user_prefs for select to authenticated using (user_id = auth.uid());
drop policy if exists up_insert on public.user_prefs;
create policy up_insert on public.user_prefs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists up_update on public.user_prefs;
create policy up_update on public.user_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.user_prefs to authenticated;

-- 2) Profil fotoğrafı: photos tablosunda is_avatar=true olan tek satır (hesap başına bir tane).
--    Görünürlük mevcut fotoğraf kurallarıyla aynı: yalnızca ben / tüm üyeler / seçili kişiler.
alter table public.photos add column if not exists is_avatar boolean not null default false;
create unique index if not exists photos_one_avatar on public.photos (uploaded_by) where is_avatar;

drop policy if exists photos_insert on public.photos;
create policy photos_insert on public.photos for insert to authenticated
  with check (public.is_approved() and uploaded_by = auth.uid()
    and (not is_avatar or person_id = (select person_id from public.profiles where id = auth.uid())));
drop policy if exists photos_update on public.photos;
create policy photos_update on public.photos for update to authenticated
  using (uploaded_by = auth.uid())
  with check (uploaded_by = auth.uid()
    and (not is_avatar or person_id = (select person_id from public.profiles where id = auth.uid())));

-- Kendi profil fotoğrafını kaldırma (genel silme kilidi açılmadan, yalnızca kendi tek kaydı)
create or replace function public.remove_my_avatar() returns text
language plpgsql security definer set search_path = public as $$
declare p text;
begin
  delete from public.photos where uploaded_by = auth.uid() and is_avatar returning storage_path into p;
  return p;
end $$;
revoke all on function public.remove_my_avatar() from public, anon;
grant execute on function public.remove_my_avatar() to authenticated;
