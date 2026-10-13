// Supabase Edge Function: notify-admin
// Yöneticinin telefonuna/bilgisayarına Web Push bildirimi gönderir.
//  - {type:"request", id}  : çağıranın kendi bekleyen talebi için (üye bir talep/ekleme/silme gönderdiğinde)
//  - {type:"signup"}       : yeni kayıt olan (onaysız) üye için
//  - {type:"test"}         : yöneticinin kendi cihazına deneme bildirimi
//
// Gerekli "secrets": VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (örn. mailto:siz@gmail.com)
// SUPABASE_URL, SUPABASE_ANON_KEY ve SUPABASE_SERVICE_ROLE_KEY Supabase tarafından otomatik verilir.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const KIND: Record<string, string> = {
  add_person: "Yeni kişi", update_person: "Düzenleme", add_spouse: "Eş ekleme", add_note: "Bilgi notu",
  delete_person: "Kişi silme talebi", delete_spouse: "Eşlik silme talebi", delete_note: "Not silme talebi", delete_photo: "Fotoğraf silme talebi",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Oturum gerekli" }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!pub || !priv) return json({ error: "VAPID anahtarları tanımlı değil" }, 500);
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com", pub, priv);

    const body = await req.json().catch(() => ({}));
    let title = "", text = "", onlyUser: string | null = null;

    if (body.type === "test") {
      const { data: me } = await admin.from("profiles").select("is_admin,approved").eq("id", u.user.id).single();
      if (!me?.is_admin || !me.approved) return json({ error: "Yalnızca yönetici" }, 403);
      title = "Soyağacı"; text = "Test bildirimi: bildirimler çalışıyor ✅"; onlyUser = u.user.id;
    } else if (body.type === "request") {
      const { data: r } = await admin.from("change_requests").select("id,kind,summary,requester_name,requested_by,status,notified")
        .eq("id", body.id).maybeSingle();
      if (!r || r.requested_by !== u.user.id || r.status !== "pending" || r.notified) return json({ ok: true, sent: 0 });
      await admin.from("change_requests").update({ notified: true }).eq("id", r.id);
      title = `Onay bekliyor: ${KIND[r.kind] ?? r.kind}`;
      text = `${r.requester_name ?? "Bir üye"}: ${String(r.summary ?? "").slice(0, 160)}`;
    } else if (body.type === "signup") {
      const { data: p } = await admin.from("profiles").select("full_name,email,approved,created_at,signup_notified").eq("id", u.user.id).single();
      const fresh = p && Date.now() - new Date(p.created_at).getTime() < 15 * 60 * 1000;
      if (!p || p.approved || p.signup_notified || !fresh) return json({ ok: true, sent: 0 });
      await admin.from("profiles").update({ signup_notified: true }).eq("id", u.user.id);
      title = "Yeni üye onay bekliyor"; text = `${p.full_name ?? ""} (${p.email})`;
    } else return json({ error: "Geçersiz istek" }, 400);

    let q = admin.from("push_subscriptions").select("id,endpoint,p256dh,auth,user_id");
    if (onlyUser) q = q.eq("user_id", onlyUser);
    else {
      const { data: admins } = await admin.from("profiles").select("id").eq("is_admin", true).eq("approved", true);
      q = q.in("user_id", (admins ?? []).map((a) => a.id));
    }
    const { data: subs } = await q;
    let sent = 0;
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title, body: text, go: "approvals", tag: "soyagaci-onay" }),
          { TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id); // geçersiz abonelik
      }
    }
    return json({ ok: true, sent });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
