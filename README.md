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
- Yedekleme sekmesi, yönetici bildirimleri ve silme kuralları: aşağıdaki "Güncelleme 2" bölümüne bakın.
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

## Güncelleme 2 (anında ekleme, silme kuralları, yedekleme, bildirimler)
**Önce** Supabase > SQL Editor'de `guncelleme2.sql` dosyasını bir kez çalıştırın (tekrar çalıştırmak zararsızdır; verileriniz silinmez), sonra yeni dosyaları GitHub'a yükleyin (`index.html`, `app.js`, `style.css`, `sw.js`, `config.js` ve isterseniz diğerleri). `config.js` içindeki kendi Supabase adresinizi/anahtarınızı koruyun; yalnızca en alttaki `VAPID_PUBLIC_KEY` satırı yenidir.

### Kurallar (veritabanında zorlanır)
- **Tam yetkili üye** eklediği kişi/eşi **kendi hesabında anında** görür (⏳ "onay bekliyor" işaretiyle). Diğer üyeler, yönetici **Onaylar** sekmesinden onaylayınca görür. Reddedilirse kayıt kaldırılır. Kişiyi eklediği için henüz yayınlanmamışsa üye onu doğrudan düzenleyebilir.
- **Onaysız yetki** (tam yetkinin üstü; **Üyeler** sekmesinde "Onaysız yetki" kutusu): bu üyenin eklediği kişi, eş ve bilgi notu onay beklemeden herkese yayınlanır; yöneticiye yalnızca bildirim gider (Onaylar sekmesinde "onaysız yetki, yayında" notuyla da görünür). Üyenin düzenleme önerileri yine onaya düşer; silme kuralları aynen geçerlidir. Davet formundan atanmaz, kayıt olduktan sonra Üyeler sekmesinden verilir.
- **Toplu onay** (Onaylar sekmesi): "Hepsini onayla", kutucuklarla "Seçilenleri onayla" ve üye adına göre "✓ Üye · n" düğmeleri. Silme talepleri toplu onaylanmaz.
- Kendi kaydı + alt/üst soyu yetkisindeki üyelerin ekleme/düzenlemeleri eskisi gibi onay bekler, onaylanana dek kimse görmez.
- **Başka kullanıcının eklediği kaydı kimse silemez** (yönetici dahil). Başkasının kaydına bilgi notu eklenebilir ya da düzenleme önerilebilir.
- **Ekleyen kişi, eklediği kaydı ilk 5 dakika içinde hemen silebilir** (kişi, eşlik, bilgi notu, fotoğraf). 5 dakikadan sonra "Silme talebi" gönderilir; yönetici **Onaylar** sekmesinde tek tek onaylar. Onay bekleyen (henüz yayınlanmamış) kayıt süre sınırı olmadan geri çekilebilir. Başkalarının eklediği çocuk/not/fotoğraf bağlıysa kişi hemen silinmez, talep olur.
- **Toplu silme kapalı:** Bir SQL ifadesi 1'den fazla kayıt silemez, tablolar boşaltılamaz (`TRUNCATE` yasak), tarayıcıdan/API'den doğrudan silme yoktur; silmeler yalnızca kurallı fonksiyonlardan geçer. Silinen her kaydın tam yedeği `deletion_log` tablosunda ve **Yedek** sekmesindeki "Silme günlüğü"nde durur.
- Not: Sahibi artık olmayan (hesabı silinmiş üyenin eklediği) kayıtları yalnızca yönetici silebilir. Gerçekten toplu temizlik gerekirse Supabase'de ilgili tetikleyiciyi (`no_bulk_delete`) bilinçli olarak devre dışı bırakmanız gerekir.

### Yedekleme (yalnızca yönetici, "💾 Yedek" sekmesi)
- **Kişi verisi:** JSON (tam yedek) ve CSV (Excel). **Yazılım:** sitedeki dosyaların ZIP'i. İkisi de doğrudan indirilir, kurulum gerekmez.
- **E-postayla gönderme** için bir kez kurulum (ücretsiz, Gmail ile):
  1. Gmail hesabınızda 2 adımlı doğrulamayı açın, Google Hesabı > Güvenlik > **Uygulama şifreleri**'nden bir şifre üretin.
  2. Supabase CLI ile (bilgisayarınızda bir kez): `supabase login`, `supabase link --project-ref <proje-id>`,
     `supabase secrets set SMTP_USER=siz@gmail.com SMTP_PASS=<uygulama-şifresi>`,
     `supabase functions deploy send-backup`
     (CLI kullanmak istemezseniz Supabase > Edge Functions > *Deploy a new function* ile `supabase/functions/send-backup/index.ts` içeriğini yapıştırıp Secrets bölümüne aynı iki değeri girin).
  3. Uygulamada **Yedek** sekmesinde alıcıları ekleyin, önce **Test e-postası gönder**'i deneyin.
  Gmail yerine Resend kullanmak isterseniz `RESEND_API_KEY` ve `MAIL_FROM` secret'larını tanımlayın.
- Yedeğe fotoğraf dosyaları girmez. E-posta ekleri gizli aile taraflarını da içerir; alıcıları buna göre seçin.

### Yönetici bildirimleri (telefonda bildirim)
Yönetici onayına düşen her şey (yeni kişi/eş/not, düzenleme, silme talebi, yeni üye) telefona bildirim olarak gelir; uygulama açıkken ayrıca anında uyarı ve uygulama simgesinde sayı rozeti görünür.
1. Anahtar üretin (bilgisayarda bir kez): `npx web-push generate-vapid-keys`
2. **Genel** anahtarı `config.js` içindeki `VAPID_PUBLIC_KEY` satırına yazın ve siteyi yeniden yükleyin.
3. `supabase secrets set VAPID_PUBLIC_KEY=<genel> VAPID_PRIVATE_KEY=<özel> VAPID_SUBJECT=mailto:siz@gmail.com` ve `supabase functions deploy notify-admin`. Özel anahtarı asla `config.js`'e veya GitHub'a koymayın.
4. Telefonda siteyi uygulama olarak yükleyin (iPhone: Safari > Paylaş > Ana Ekrana Ekle, iOS 16.4+), yönetici olarak girin, **Profilim > Yönetici bildirimleri > Bildirimleri aç** deyin ve **Test bildirimi gönder** ile deneyin.

### Soy görünümü
"Benim soyum"da ebeveynden çocuğa bağlantı çizgileri (üst soy dahil) çizilir; atalar satırlarında eşler artık yan yana ve ♥ ile evli gösterilir (ör. Aslan ♥ Mevlüde, Ali ♥ Zeyne Karaman). "Kardeş, amca/hala" açıkken seçilen kişinin kardeşleri kendisiyle aynı satırda, büyükler solda küçükler sağda görünür.

## Güncelleme (eski)
Daha önce kurulum yaptıysanız, yeni dosyaları yüklemeden **önce** Supabase > SQL Editor'de `guncelleme.sql` içeriğini bir kez çalıştırın (şehir, vefat işareti, davetler, onay akışı, mezar yeri, kan grubu, bilgi notları ve güvenlik düzeltmesi içerir). Verileriniz silinmez, tekrar çalıştırmak zararsızdır.

## Davet ve yetkiler
- **Davetler** sekmesi (yönetici): Her kişinin yanına e-posta yazıp Kaydet deyin. O e-postayla kayıt olan kişi otomatik onaylanır ve kendi kartına bağlanır. "Davet gönder" düğmesi hazır mesajı WhatsApp, e-posta ile gönderir ya da kopyalar.
- **Kendi kaydı + alt/üst soyu** (varsayılan): Kişi tüm ağacı görür, fotoğraf ekler, bilgi notu paylaşır. Yalnızca kendi kartını düzenleyebilir; kendi atalarına ve altsoyuna kişi (çocuk, kardeş, eş, baba/anne) ekleme önerebilir. Silemez, mevcut ebeveyn bağını değiştiremez.
- **Tam yetki:** Herkes için düzenleme/ekleme önerebilir. Silme her zaman yalnızca yöneticidedir.
- Her iki durumda da değişiklikler **yönetici onayına** düşer. Fotoğraf yükleme onaya takılmaz.
- Otomatik e-posta: statik sitede sunucu olmadığı için "güncellendi" maili otomatik gitmez; Onaylar > "Güncelleme duyurusu hazırla" ile hazır mesaj kendi e-postanızdan gönderilir.
- Yönetici yalnızca siz (ve atadıklarınız) olursunuz. Kişi-hesap bağlantısını yalnızca yönetici değiştirebilir.
- Üyeler sekmesinden zaten kayıtlı birini sonradan bir kişiye bağlayabilirsiniz.

## Gizli aile tarafı
- Eş olarak eklediğiniz kişinin kartını açın (Aile tarafı görünürlüğü): **Herkes görsün**, **yalnızca anne ve babası görünsün** ya da **hiçbiri görünmesin** seçeneklerinden birini seçin.
- Gizlenenler (anne-baba, kardeşler, dede-nine, amca-hala, kuzenler ve eşleri) yalnızca sizin ve o kişinin bağlı hesabının (eşiniz) ekranında görünür. Kartlarında 🔒 işareti olur. Eşinizin görebilmesi için onu **Davetler** sekmesinden kendi kişi kartına bağlayın.
- Gizleme veritabanı kuralıdır; ekranda saklanmaz, başkaları API'den de göremez. Gizli kişilerin fotoğrafları, notları ve eşlik kayıtları da gizlenir.
- Çocuklar ve eş her zaman görünür. Sonradan eklediğiniz yakınlar da ayara göre otomatik gizlenir.
- İlk kez kullanmadan önce `gizlilik.sql` dosyasını Supabase > SQL Editor'de bir kez çalıştırın (tekrar çalıştırmak zararsız).

## Telefona uygulama olarak yükleme
- **Android (Chrome):** Siteyi açın > ⋮ menü > "Uygulamayı yükle" / "Ana ekrana ekle". Profilim sekmesindeki "Uygulamayı yükle" düğmesi de aynı işi yapar.
- **iPhone (Safari):** Paylaş simgesi > "Ana Ekrana Ekle".
- **Bilgisayar (Chrome/Edge):** Adres çubuğunun sağındaki yükle simgesi.
Uygulama internet bağlantısı ister, çünkü veriler Supabase'de durur.
