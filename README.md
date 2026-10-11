# Soyağacı

Ücretsiz çalışan aile ağacı uygulaması. Arayüz GitHub Pages'te, veriler ve resimler Supabase ücretsiz planında durur.

> Neden sadece GitHub değil? GitHub'da saklanan dosyalar ya herkese açıktır ya da sunucu olmadan gizlenemez. "Bu resmi şu kişiler görsün" kuralı için küçük bir sunucu tarafı gerekir. Supabase bunu ücretsiz verir.

## Özellikler
- E-posta + şifre ile kayıt (e-posta doğrulaması yok, e-posta sadece bilgi amaçlı).
- İlk kayıt olan kişi otomatik **yönetici** olur.
- Sonradan kayıt olanlar yönetici **onaylayana** kadar hiçbir şey göremez (ağaç açık internete düşmesin diye).
- Yönetici her üyeye **kişi ekleme yetkisi** verebilir.
- Herkes kişilere resim ekleyebilir. Her resim için: **Sadece ben / Tüm üyeler / Seçtiğim kişiler**.
  Bu kurallar veritabanında zorlanır; tarayıcıyı kurcalayan biri bile göremez. Yöneticiler de başkasının "sadece ben" resmini göremez.
- Ağaç görünümü, eş ve çocuk ekleme, arama, profilini ağaçtaki kişiyle eşleştirme.

## Kurulum

1. **Supabase projesi aç:** https://supabase.com adresinde ücretsiz hesap, yeni proje.
2. **Şemayı yükle:** Supabase > SQL Editor > `schema.sql` içeriğini yapıştır > Run.
3. **E-posta doğrulamasını kapat:** Authentication > Providers > Email > "Confirm email" seçeneğini kapat.
4. **Anahtarları yaz:** Project Settings > API sayfasındaki *Project URL* ve *anon public* anahtarını `config.js` içine yaz.
5. **GitHub'a yükle:** Yeni bir depo aç, 5 dosyayı (`index.html`, `app.js`, `style.css`, `config.js`, `schema.sql`) yükle.
6. **Yayınla:** Depo > Settings > Pages > Branch: `main`, klasör `/ (root)` > Save. Birkaç dakika sonra adres hazır olur.
7. **İlk kaydı sen yap** (yönetici olursun), sonra adresi aileye gönder.
8. Authentication > URL Configuration bölümüne GitHub Pages adresini "Site URL" olarak ekle.

## Kullanım
- Aile bireyleri adresten kayıt olur. Sen **Üyeler** sekmesinden onaylar, istediklerine "Kişi ekleyebilir" yetkisi verirsin.
- Kişi kartına dokununca ayrıntı, eş/çocuk ekleme ve fotoğraflar açılır.

## Bilmeniz gerekenler
- Supabase ücretsiz planı: 500 MB veritabanı, 1 GB resim alanı. Resimler yüklenirken otomatik küçültülür (en uzun kenar 1600 px).
- Ücretsiz projeler 7 gün hiç kullanılmazsa duraklatılır. Supabase panelinden tek tıkla yeniden açılır.
- `anon` anahtarı herkese açık olabilir, güvenliği `schema.sql` içindeki kurallar sağlar. `service_role` anahtarını **asla** koda koyma.
- Şifre sıfırlama bu sürümde yok. Gerekirse Supabase > Authentication > Users bölümünden yapılır.
