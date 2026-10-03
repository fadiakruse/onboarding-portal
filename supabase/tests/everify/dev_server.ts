// Local preview: serves web/ and the function (mock E-Verify + in-memory DB). Sign-in is stubbed.
// Run: PII_ENCRYPTION_KEY=$(openssl rand -base64 32) DENO_NO_PACKAGE_JSON=1 deno run -A --no-config supabase/tests/everify/dev_server.ts  → http://localhost:8787/employer.html
import { handle } from "../../functions/everify/index.ts";
import { MockEVerify } from "../../functions/everify/everify_client.ts";
import { fakeDb } from "./fake_db.ts";
const db = fakeDb({ "jwt-admin": { id: "u-admin", email: "admin@example.com" } });
db.T.everify_staff.push({ user_id: "u-admin", email: "admin@example.com", full_name: "Pat Admin", phone: "7325551234", is_admin: true, active: true, training_passed_at: new Date().toISOString(), training_score: 90 });
db.T.everify_clients.push({ id: "c1", name: "Demo Client", client_company_id: 78529 });
const ev = new MockEVerify();
const types: Record<string, string> = { html: "text/html", js: "text/javascript", css: "text/css" };
Deno.serve({ port: 8787 }, async (req) => {
  const u = new URL(req.url);
  if (u.pathname === "/fn") return handle(req, { db, ev });
  if (u.pathname === "/config.js") return new Response(`window.I9_CONFIG={SUPABASE_URL:"http://localhost:8787",SUPABASE_ANON_KEY:"anon",FUNCTION_URL:"/fn",ORG_NAME:"Demo"};`, { headers: { "content-type": "text/javascript" } });
  if (u.pathname === "/stub-ssr.js") return new Response(`export function createBrowserClient(){return{auth:{getSession:async()=>({data:{session:{access_token:"jwt-admin"}}})}}}`, { headers: { "content-type": "text/javascript" } });
  try {
    const f = u.pathname === "/" ? "employer.html" : u.pathname.slice(1);
    let body = await Deno.readTextFile(new URL(`../../../public/everify/${f}`, import.meta.url));
    if (f === "employer.html") body = body.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/ssr[^"]+/, "/stub-ssr.js"); // portal sign-in is stubbed
    return new Response(body, { headers: { "content-type": types[f.split(".").pop()!] ?? "text/plain" } });
  } catch { return new Response("not found", { status: 404 }); }
});
