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
- Ağaç görünümü, eş / çocuk / kardeş ekleme, arama, profilini ağaçtaki kişiyle eşleştirme.
- Kişiler sekmesinde sayılar (toplam, erkek, kadın, hayatta, vefat), şehir / cinsiyet / durum filtresi.
- Her kişiye yaşadığı şehir ve "vefat etti" işareti.
- Ağaçta yakınlaştırma (büyüteç) ve nesillere göre değiştirilebilir yatay zemin renkleri.
- Telefona uygulama gibi yüklenebilir (PWA), mobil için alt sekme çubuğu.
- **Onay akışı:** Yönetici dışındakilerin tüm değişiklikleri (düzenleme, kişi/eş ekleme, bilgi notu) talep olarak kaydolur; yönetici **Onaylar** sekmesinden onaylayınca listeye girer.
- Kişi penceresinde Aile tablosu (baba, anne, eş, kardeş, çocuk), bilgi tablosu, bilgi notları.
- Vefat edenlerde defin yeri notu ve kartın sağ üst köşesinde hilal işareti.
- Kan grubu (filtre + toplu giriş ekranı), listede sıralama (alfabetik, yaş, kayıt sırası, aile içi).
- Fareyle kişinin üzerine gelince önizleme: büyütülmüş fotoğraf, yaş (yıl ve ay), şehir, defin yeri, kan grubu (Profilim > Önizleme ayarları'ndan açılıp kapatılır).
- **Benim soyum** görünümü: seçilen kişinin atalarını (anne-baba, dede-nine…) ve altsoyunu gösterir; yukarı/aşağı kaç nesil görüneceği ve kardeş/amca/hala gösterimi ayarlanır. Kişiye bağlı üyeler girişte doğrudan kendi soylarıyla açılır, yönetici tüm ağaçla.
- Güncelleme duyurusu: onaylanan değişikliklerden hazır "Soyağacı güncellendi" mesajı, kayıtlı e-postalara Gmail/e-posta uygulamasıyla gönderilir.

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

## Güncelleme
Daha önce kurulum yaptıysanız, yeni dosyaları yüklemeden **önce** Supabase > SQL Editor'de `guncelleme.sql` içeriğini bir kez çalıştırın (şehir, vefat işareti, davetler, onay akışı, mezar yeri, kan grubu, bilgi notları ve güvenlik düzeltmesi içerir). Verileriniz silinmez, tekrar çalıştırmak zararsızdır.

## Davet ve yetkiler
- **Davetler** sekmesi (yönetici): Her kişinin yanına e-posta yazıp Kaydet deyin. O e-postayla kayıt olan kişi otomatik onaylanır ve kendi kartına bağlanır. "Davet gönder" düğmesi hazır mesajı WhatsApp, e-posta ile gönderir ya da kopyalar.
- **Kendi kaydı + alt/üst soyu** (varsayılan): Kişi tüm ağacı görür, fotoğraf ekler, bilgi notu paylaşır. Yalnızca kendi kartını düzenleyebilir; kendi atalarına ve altsoyuna kişi (çocuk, kardeş, eş, baba/anne) ekleme önerebilir. Silemez, mevcut ebeveyn bağını değiştiremez.
- **Tam yetki:** Herkes için düzenleme/ekleme önerebilir. Silme her zaman yalnızca yöneticidedir.
- Her iki durumda da değişiklikler **yönetici onayına** düşer. Fotoğraf yükleme onaya takılmaz.
- Otomatik e-posta: statik sitede sunucu olmadığı için "güncellendi" maili otomatik gitmez; Onaylar > "Güncelleme duyurusu hazırla" ile hazır mesaj kendi e-postanızdan gönderilir.
- Yönetici yalnızca siz (ve atadıklarınız) olursunuz. Kişi-hesap bağlantısını yalnızca yönetici değiştirebilir.
- Üyeler sekmesinden zaten kayıtlı birini sonradan bir kişiye bağlayabilirsiniz.

## Telefona uygulama olarak yükleme
- **Android (Chrome):** Siteyi açın > ⋮ menü > "Uygulamayı yükle" / "Ana ekrana ekle". Profilim sekmesindeki "Uygulamayı yükle" düğmesi de aynı işi yapar.
- **iPhone (Safari):** Paylaş simgesi > "Ana Ekrana Ekle".
- **Bilgisayar (Chrome/Edge):** Adres çubuğunun sağındaki yükle simgesi.
Uygulama internet bağlantısı ister, çünkü veriler Supabase'de durur.
