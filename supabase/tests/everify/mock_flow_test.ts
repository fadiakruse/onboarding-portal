// Run: PII_ENCRYPTION_KEY=$(openssl rand -base64 32) deno test -A tests/
import { ok as assert, deepStrictEqual as assertEquals } from "node:assert";
import { handle } from "../../functions/everify/index.ts";
import { MockEVerify } from "../../functions/everify/everify_client.ts";
import { fakeDb } from "./fake_db.ts";

const ADMIN = { id: "u-admin", email: "admin@example.com" };
const UNTRAINED = { id: "u-new", email: "new@example.com" };
const db = fakeDb({ "jwt-admin": ADMIN, "jwt-new": UNTRAINED });
db.T.everify_staff.push(
  { user_id: ADMIN.id, email: ADMIN.email, full_name: "Pat Admin", phone: "7325551234", is_admin: true, active: true, training_passed_at: new Date().toISOString(), training_score: 90 },
  { user_id: UNTRAINED.id, email: UNTRAINED.email, full_name: "New User", phone: "7325550000", is_admin: false, active: true, training_passed_at: null },
);

async function call(action: string, body: Record<string, unknown> = {}, jwt = "jwt-admin") {
  const req = new Request("http://x/", { method: "POST", headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) });
  const r = await handle(req, { db, ev: new MockEVerify() });
  return { status: r.status, body: await r.json() };
}
const today = new Date().toLocaleDateString("en-CA");

async function newHire(lastName: string, extra: Record<string, unknown> = {}) {
  const inv = await call("staff.invite", { client_id: clientId, employee_email: `${lastName}@example.com`, send_email: false });
  assertEquals(inv.status, 200, JSON.stringify(inv.body));
  const token = new URL(inv.body.link, "http://x").searchParams.get("t")!;
  const sec1 = await call("employee.submit", { token, section1: {
    first_name: "Dana", last_name: lastName, date_of_birth: "1990-04-02", ssn: "123456789", address_line: "1 Main St", city: "Holmdel", state: "NJ", zip: "07733",
    citizenship_status_code: "US_CITIZEN", attest: true, signature: `Dana ${lastName}`, ...extra } });
  assertEquals(sec1.status, 200, JSON.stringify(sec1.body));
  const reuse = await call("employee.submit", { token, section1: {} });
  assertEquals(reuse.status, 401, "invite link must be single-use");
  const s2 = await call("staff.section2", { id: inv.body.id, section2: {
    date_of_hire: today, document_a_type_code: "US_PASSPORT", expiration_date: "2031-01-01", attest: true, pii: { us_passport_number: "123456789" } } });
  assertEquals(s2.status, 200, JSON.stringify(s2.body));
  return inv.body.id as string;
}

let clientId = "";
Deno.test("admin creates a client", async () => {
  assertEquals((await call("admin.client_upsert", { name: "Acme Dermatology", client_company_id: 78529 })).status, 200);
  clientId = (await call("staff.clients")).body.clients[0].id;
});

Deno.test("untrained staff cannot run cases", async () => {
  const r = await call("staff.list", {}, "jwt-new");
  assertEquals(r.status, 403);
});

Deno.test("employee validation errors are field-specific", async () => {
  const inv = await call("staff.invite", { client_id: clientId, employee_email: "bad@example.com", send_email: false });
  const token = new URL(inv.body.link, "http://x").searchParams.get("t")!;
  const r = await call("employee.submit", { token, section1: { first_name: "D4na", ssn: "12", citizenship_status_code: "LAWFUL_PERMANENT_RESIDENT" } });
  assertEquals(r.status, 400);
  for (const f of ["first_name", "ssn", "alien_number", "attest", "signature"]) assert(r.body.fields[f], `expected error on ${f}`);
});

Deno.test("happy path → Employment Authorized, SSN encrypted at rest", async () => {
  const id = await newHire("Rivera");
  const row = db.T.i9_cases.find((r: any) => r.id === id);
  assert(row.pii_enc.startsWith("v1.") && !row.pii_enc.includes("123-45-6789"));
  const r = await call("staff.submit", { id });
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals(r.body.case.case_status, "CLOSED");
  assertEquals(r.body.case.eligibility_statement, "EMPLOYMENT_AUTHORIZED");
  assertEquals(r.body.case.ssn_masked, "***-**-6789");
  assert(!JSON.stringify(r.body).includes("123-45-6789"), "full SSN must never be returned");
});

Deno.test("photo match → not matching → scan & upload → mismatch → FAN → refer", async () => {
  const id = await newHire("Photo");
  assertEquals((await call("staff.submit", { id })).body.case.case_status, "PHOTO_MATCH");
  assert((await call("staff.photo", { id })).body.photo);
  assertEquals((await call("staff.photo_match", { id, result: "not-matching" })).body.case.case_status, "SCAN_AND_UPLOAD");
  const img = { name: "f.png", type: "image/png", data: btoa("fake") };
  assertEquals((await call("staff.scan_upload", { id, front: img, back: img })).body.case.case_status, "PENDING_REFERRAL");
  assertEquals((await call("staff.refer", { id, employee_notified: true })).status, 409, "must download FAN first");
  const fan = await call("staff.fan", { id, language: "spanish" });
  assert(atob(fan.body.pdf).startsWith("%PDF"));
  assertEquals((await call("staff.refer", { id, employee_notified: true })).body.case.case_status, "REFERRED");
});

Deno.test("mismatch → no action → FNC → close", async () => {
  const id = await newHire("Mismatch");
  assertEquals((await call("staff.submit", { id })).body.case.case_status, "PENDING_REFERRAL");
  assertEquals((await call("staff.no_action", { id, employee_notified: true })).body.case.case_status, "FINAL_NONCONFIRMATION");
  const reasons = (await call("staff.closure_reasons", { id })).body.items;
  assert(reasons.length);
  assertEquals((await call("staff.close", { id, case_closure_reason_code: "EMPLOYEE_CONTINUES_TO_WORK_AFTER_FNC" })).status, 400);
  const c = await call("staff.close", { id, case_closure_reason_code: "EMPLOYEE_TERMINATED_FOR_FNC_RESULT" });
  assertEquals(c.body.case.workflow, "closed");
});

Deno.test("unconfirmed data → confirm details", async () => {
  const id = await newHire("Confirm");
  assertEquals((await call("staff.submit", { id })).body.case.case_status, "UNCONFIRMED_DATA");
  const f = (await call("staff.confirm_details_fields", { id })).body.fields;
  assertEquals(f.find((x: any) => x.field_name === "last_name").value, "Confirm");
  assertEquals((await call("staff.confirm_details", { id, fields: f })).body.case.eligibility_statement, "EMPLOYMENT_AUTHORIZED");
});

Deno.test("duplicate SSN requires a decision", async () => {
  const id = await newHire("Dupe");
  const r1 = await call("staff.submit", { id });
  assert(r1.body.needs_duplicate_decision);
  const r2 = await call("staff.submit", { id, duplicate_continue_reason_code: "REHIRE" });
  assertEquals(r2.status, 409, "open duplicates must be closed first");
  const r3 = await call("staff.adopt_case", { id, case_number: r1.body.duplicates[0].case_number });
  assertEquals(r3.body.case.everify_case_number, "2026001000001AA");
});

Deno.test("late case requires reason for delay", async () => {
  const inv = await call("staff.invite", { client_id: clientId, employee_email: "late@example.com", send_email: false });
  const token = new URL(inv.body.link, "http://x").searchParams.get("t")!;
  await call("employee.submit", { token, section1: { first_name: "Lee", last_name: "Late", date_of_birth: "1985-01-01", ssn: "987-65-4321", address_line: "2 Elm", city: "Holmdel", state: "NJ", zip: "07733", citizenship_status_code: "US_CITIZEN", attest: true, signature: "Lee Late" } });
  const r = await call("staff.section2", { id: inv.body.id, section2: { date_of_hire: "2026-01-05", document_a_type_code: "US_PASSPORT", expiration_date: "2031-01-01", attest: true } });
  assertEquals(r.status, 400); assert(r.body.fields.reason_for_delay_code);
});

Deno.test("sync rejects missing secret", async () => {
  assertEquals((await call("sync")).status, 401);
});
