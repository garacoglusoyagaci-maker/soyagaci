// Supabase Edge Function: send-backup
// Yöneticinin tanımladığı alıcılara yedeği e-posta eki olarak gönderir.
// Güvenlik: yalnızca oturum açmış YÖNETİCİ çağırabilir (is_admin kontrolü). Alıcılar BCC'dir.
//
// Gerekli "secrets" (Supabase > Edge Functions > Secrets ya da `supabase secrets set`):
//   SMTP_USER   Gmail adresiniz (gönderen)
//   SMTP_PASS   Gmail "uygulama şifresi" (2 adımlı doğrulama açıkken Google Hesabı > Güvenlik > Uygulama şifreleri)
//   SMTP_HOST   (isteğe bağlı) varsayılan smtp.gmail.com
//   SMTP_PORT   (isteğe bağlı) varsayılan 465  (25 ve 587 numaralı portlar Supabase'de kapalıdır)
//   SMTP_FROM_NAME (isteğe bağlı) varsayılan "Soyağacı"
// Alternatif: RESEND_API_KEY + MAIL_FROM tanımlarsanız Resend kullanılır.
import { createClient } from "npm:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return json({ error: "Oturum gerekli" }, 401);
    const { data: isAdmin } = await sb.rpc("is_admin");
    if (isAdmin !== true) return json({ error: "Yalnızca yönetici yedek gönderebilir" }, 403);

    const body = await req.json().catch(() => ({}));
    const test = body.test === true;
    const attachments: { filename: string; content_type: string; content_b64: string }[] = Array.isArray(body.attachments) ? body.attachments : [];
    if (!test && attachments.length === 0) return json({ error: "Gönderilecek dosya yok" }, 400);
    if (attachments.reduce((a, x) => a + (x.content_b64?.length ?? 0), 0) > 30_000_000) return json({ error: "Ek boyutu çok büyük" }, 413);

    const { data: rc, error: rcErr } = await sb.from("backup_recipients").select("email,label");
    if (rcErr) return json({ error: "Alıcılar okunamadı: " + rcErr.message }, 500);
    const to = (rc ?? []).map((r) => r.email).filter(Boolean);
    if (to.length === 0) return json({ error: "Alıcı listesi boş" }, 400);

    const date = new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
    const subject = test ? "Soyağacı test e-postası" : `Soyağacı yedeği – ${date}`;
    const text = test
      ? `Bu bir test e-postasıdır. Yedek e-postaları bu adrese böyle gelecek.\n${body.site ?? ""}`
      : `Merhaba,\n\nSoyağacı uygulamasının yedeği ektedir (${date}).\n\nEkler:\n${attachments.map((a) => " - " + a.filename).join("\n")}\n\nBu dosyalar aile bilgileri içerir; lütfen başkalarıyla paylaşmayın.\n${body.site ?? ""}`;

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const user = Deno.env.get("SMTP_USER");
    const fromName = Deno.env.get("SMTP_FROM_NAME") ?? "Soyağacı";
    let error: string | null = null;
    try {
      if (resendKey) {
        const from = Deno.env.get("MAIL_FROM") ?? "onboarding@resend.dev";
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `${fromName} <${from}>`, to: [from], bcc: to, subject, text,
            attachments: attachments.map((a) => ({ filename: a.filename, content: a.content_b64 })),
          }),
        });
        if (!r.ok) throw new Error("Resend: " + (await r.text()));
      } else {
        const pass = Deno.env.get("SMTP_PASS");
        if (!user || !pass) throw new Error("SMTP_USER / SMTP_PASS tanımlı değil (README > Yedekleme)");
        const client = new SMTPClient({
          connection: {
            hostname: Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com",
            port: Number(Deno.env.get("SMTP_PORT") ?? 465),
            tls: true,
            auth: { username: user, password: pass },
          },
        });
        await client.send({
          from: `${fromName} <${user}>`,
          to: user,
          bcc: to,
          subject,
          content: text,
          attachments: attachments.map((a) => ({
            filename: a.filename, content: a.content_b64, encoding: "base64", contentType: a.content_type || "application/octet-stream",
          })),
        });
        await client.close();
      }
    } catch (e) {
      error = String((e as Error).message ?? e);
    }

    await sb.from("backup_log").insert({
      kind: test ? "test" : "e-posta",
      status: error ? "hata" : "ok",
      detail: error ?? (test ? "Test e-postası" : attachments.map((a) => a.filename).join(", ")),
      recipients: to.length,
    });
    if (error) return json({ error }, 502);
    return json({ ok: true, sent: to.length });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
