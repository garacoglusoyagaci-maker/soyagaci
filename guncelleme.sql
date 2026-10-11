-- Mevcut kurulumu güncelleme (Supabase > SQL Editor'de bir kez çalıştırın)
-- Yeni alanlar: yaşadığı şehir ve "vefat etti" işareti.
-- Verileriniz silinmez.

alter table public.people add column if not exists city text;
alter table public.people add column if not exists is_deceased boolean not null default false;
update public.people set is_deceased = true where death_date is not null and is_deceased = false;
