// Supabase proje ayarları.
// Buradaki "publishable" anahtar herkese açık olabilir; güvenliği schema.sql'deki kurallar sağlar.
// Gizli (secret / service_role) anahtarı buraya ASLA yazmayın.
export const SUPABASE_URL = "https://fehzpvftqpbddeqfgonk.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_7oTYmN4Ce9qsLQ62LX2ZQQ_Lw12c8CL";

// Yönetici bildirimleri için VAPID GENEL anahtarı (isteğe bağlı; README'deki "Yönetici bildirimleri" bölümüne bakın).
// Yalnızca GENEL anahtar buraya yazılır. Özel anahtar yalnızca Supabase "secrets" içinde durur.
export const VAPID_PUBLIC_KEY = "";
