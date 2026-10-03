// Supabase Edge Function: everify
// Single POST endpoint: { action: "...", ...params }
// Employee actions use a one-time invite token. Staff actions require a Supabase Auth JWT
// for a user listed in everify_staff (and, for E-Verify calls, a passed training test).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { EVerifyClient, EVerifyError, MockEVerify, type EVerifyApi } from "./everify_client.ts";
import { open, randomToken, seal, sha256 } from "./pii.ts";

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const MODE = env("EVERIFY_MODE", "mock"); // mock | stage | production
const BASE = MODE === "production" ? "https://everify.uscis.gov/api/v31" : "https://stage-everify.uscis.gov/api/v31";
const SOFTWARE_VERSION = env("CLIENT_SOFTWARE_VERSION", "i9portal-1.0");
const ALLOWED_ORIGINS = env("ALLOWED_ORIGINS", "*").split(",").map((s) => s.trim());

class HttpError extends Error {
  constructor(public status: number, msg: string, public extra: Record<string, unknown> = {}) { super(msg); }
}

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes("*") ? "*" : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// ---------- validation helpers ----------
const NAME = /^[a-zA-Z'’\- ]+$/;
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const blank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
function need(cond: unknown, field: string, msg: string, errs: Record<string, string>) { if (!cond) errs[field] = msg; }
function normSsn(s: unknown) { const d = digits(s); return d.length === 9 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : null; }
function normAlien(s: unknown) {
  const d = digits(s);
  return d.length >= 7 && d.length <= 9 ? "A" + d.padStart(9, "0") : null;
}
function addBusinessDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z");
  while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n--; }
  return d.toISOString().slice(0, 10);
}
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

// ---------- context ----------
type Ctx = { db: SupabaseClient; ev: EVerifyApi; req: Request; user?: { id: string; email?: string }; staff?: any };

async function log(ctx: Ctx, case_id: string | null, action: string, http_status: number | null, case_status: string | null, detail: unknown = null) {
  await ctx.db.from("everify_events").insert({ case_id, actor: ctx.user?.id ?? null, action, http_status, case_status, detail });
}

async function requireStaff(ctx: Ctx, { trained = true, admin = false } = {}) {
  const jwt = (ctx.req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data, error } = await ctx.db.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, "Please sign in.");
  ctx.user = { id: data.user.id, email: data.user.email };
  const { data: staff } = await ctx.db.from("everify_staff").select("*").eq("user_id", data.user.id).eq("active", true).maybeSingle();
  if (!staff) throw new HttpError(403, "Your account is not authorized for E-Verify. Ask an administrator to add you.");
  if (admin && !staff.is_admin) throw new HttpError(403, "Administrator access required.");
  if (trained && !staff.training_passed_at) {
    throw new HttpError(403, "E-Verify access requires a passing score (70%+) on the E-Verify knowledge test. Ask an administrator to record your training.");
  }
  ctx.staff = staff;
}

async function loadCase(ctx: Ctx, id: string) {
  const { data } = await ctx.db.from("i9_cases").select("*, client:everify_clients(name, client_company_id, notify_email)").eq("id", id).maybeSingle();
  if (!data) throw new HttpError(404, "Case not found.");
  return data;
}

function caseNumber(row: any) {
  if (!row.everify_case_number) throw new HttpError(409, "This record has not been submitted to E-Verify yet.");
  return row.everify_case_number as string;
}

async function applyWorkflow(ctx: Ctx, row: any, r: any, action: string, extra: Record<string, unknown> = {}) {
  const closed = r.case_status === "CLOSED";
  const patch = {
    case_status: r.case_status ?? row.case_status,
    case_status_display: r.case_status_display ?? row.case_status_display,
    eligibility_statement: r.case_eligibility_statement ?? row.eligibility_statement,
    dhs_referral_status: r.dhs_referral_status ?? row.dhs_referral_status,
    ssa_referral_status: r.ssa_referral_status ?? row.ssa_referral_status,
    last_error: null,
    ...(closed ? { workflow: "closed", closed_at: new Date().toISOString() } : {}),
    ...extra,
  };
  await ctx.db.from("i9_cases").update(patch).eq("id", row.id);
  await log(ctx, row.id, action, 200, patch.case_status);
  return { ...row, ...patch };
}

async function evCall(ctx: Ctx, row: any | null, action: string, fn: () => Promise<any>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EVerifyError) {
      await log(ctx, row?.id ?? null, action, e.status, row?.case_status ?? null, { errors: e.errors });
      if (row) await ctx.db.from("i9_cases").update({ last_error: { action, status: e.status, errors: e.errors } }).eq("id", row.id);
      throw new HttpError(e.status === 401 ? 502 : e.status, e.message, { everify_errors: e.errors });
    }
    throw e;
  }
}

// Public view of a case for staff (SSN masked; photo never stored).
async function staffView(row: any) {
  const pii = await open(row.pii_enc);
  const { pii_enc: _p, invite_token_hash: _t, ...rest } = row;
  const { ssn: _s, ...docs } = pii;
  const hire = row.date_of_hire;
  return {
    ...rest,
    ssn_masked: row.ssn_last4 ? `***-**-${row.ssn_last4}` : null,
    pii: docs,
    everify_due: hire ? addBusinessDays(hire, 3) : null,
    late: hire ? today() > addBusinessDays(hire, 3) : false,
  };
}

// ---------- E-Verify payload ----------
const ALWAYS = ["client_company_id", "client_software_version", "case_creator_name", "case_creator_email_address",
  "case_creator_phone_number", "case_creator_phone_number_extension", "duplicate_continue_reason_code",
  "reason_for_delay_code", "reason_for_delay_description", "employer_case_id"];

async function buildPayload(row: any, dupReason?: string) {
  const p = await open(row.pii_enc);
  const all: Record<string, unknown> = {
    client_company_id: row.client.client_company_id,
    client_software_version: SOFTWARE_VERSION,
    first_name: row.first_name, middle_initial: row.middle_initial, last_name: row.last_name,
    other_last_names_used: row.other_last_names?.length ? row.other_last_names : undefined,
    date_of_birth: row.date_of_birth, ssn: p.ssn, citizenship_status_code: row.citizenship_status_code,
    employee_email_address: row.employee_email !== row.case_creator_email ? row.employee_email : undefined,
    phone_number: row.employee_phone,
    alien_number: p.alien_number, i94_number: p.i94_number, foreign_passport_number: p.foreign_passport_number,
    country_code: p.country_code, us_passport_number: p.us_passport_number, i551_number: p.i551_number,
    i766_number: p.i766_number, document_bc_number: p.document_bc_number, visa_number: p.visa_number,
    sevis_number: p.sevis_number,
    document_a_type_code: row.document_a_type_code, document_b_type_code: row.document_b_type_code,
    document_c_type_code: row.document_c_type_code, document_sub_type_code: row.document_sub_type_code,
    us_state_code: row.us_state_code, expiration_date: row.no_expiration_date ? undefined : row.expiration_date,
    no_expiration_date: row.document_b_type_code ? !!row.no_expiration_date : undefined,
    date_of_hire: row.date_of_hire, reason_for_delay_code: row.reason_for_delay_code,
    reason_for_delay_description: row.reason_for_delay_code === "OTHER" ? row.reason_for_delay_description : undefined,
    employer_case_id: row.employer_case_id,
    case_creator_name: row.case_creator_name, case_creator_email_address: row.case_creator_email,
    case_creator_phone_number: row.case_creator_phone, case_creator_phone_number_extension: row.case_creator_phone_ext,
    duplicate_continue_reason_code: dupReason,
  };
  for (const k of Object.keys(all)) if (blank(all[k])) delete all[k];
  return all;
}

async function caseFields(ctx: Ctx, row: any, docs: Record<string, unknown>, ssn: string) {
  const r = await ctx.ev.call("POST", "/checks/case_fields", {
    json: {
      ssn, client_company_id: row.client.client_company_id, citizenship_status_code: row.citizenship_status_code,
      document_a_type_code: docs.document_a_type_code || undefined,
      document_b_type_code: docs.document_b_type_code || undefined,
      document_c_type_code: docs.document_c_type_code || undefined,
    },
  });
  return (r.case_fields ?? []) as { field_name: string; required: boolean }[];
}

// ---------- actions ----------
const actions: Record<string, (ctx: Ctx, b: any) => Promise<unknown>> = {
  // ===== Employee (token) =====
  async "employee.load"(ctx, b) {
    const row = await byToken(ctx, b.token);
    return { first_name: row.first_name, employee_email: row.employee_email, client_name: row.client?.name };
  },

  async "employee.submit"(ctx, b) {
    const row = await byToken(ctx, b.token);
    const s = b.section1 ?? {};
    const errs: Record<string, string> = {};
    for (const f of ["first_name", "last_name"]) need(s[f] && NAME.test(s[f]), f, "Letters, spaces, hyphens and apostrophes only.", errs);
    need(String(s.first_name ?? "").length <= 25, "first_name", "25 characters max.", errs);
    need(String(s.last_name ?? "").length <= 40, "last_name", "40 characters max.", errs);
    need(!s.middle_initial || /^[a-zA-Z]$/.test(s.middle_initial), "middle_initial", "One letter.", errs);
    const others = String(s.other_last_names ?? "").split(",").map((x: string) => x.trim()).filter(Boolean);
    need(others.every((n: string) => NAME.test(n) && n.length <= 40), "other_last_names", "Letters only, separated by commas.", errs);
    for (const f of ["address_line", "city", "state", "zip"]) need(s[f], f, "Required.", errs);
    need(isDate(s.date_of_birth) && s.date_of_birth < today(), "date_of_birth", "Enter a valid past date.", errs);
    const ssn = normSsn(s.ssn);
    need(ssn, "ssn", "Enter your 9-digit Social Security number.", errs);
    need(!s.phone || digits(s.phone).length === 10, "phone", "10 digits.", errs);
    const cit = s.citizenship_status_code;
    need(["US_CITIZEN", "NONCITIZEN", "LAWFUL_PERMANENT_RESIDENT", "NONCITIZEN_AUTHORIZED_TO_WORK"].includes(cit), "citizenship_status_code", "Choose one.", errs);
    const alien = s.alien_number ? normAlien(s.alien_number) : null;
    if (s.alien_number) need(alien, "alien_number", "A-Number/USCIS # is 7–9 digits.", errs);
    if (cit === "LAWFUL_PERMANENT_RESIDENT") need(alien, "alien_number", "Required for lawful permanent residents.", errs);
    if (cit === "NONCITIZEN_AUTHORIZED_TO_WORK") {
      need(alien || s.i94_number || (s.foreign_passport_number && s.country_code), "alien_number",
        "Provide an A-Number/USCIS #, a Form I-94 number, or a foreign passport number and country.", errs);
      need(!s.i94_number || /^[0-9A-Za-z]{1,11}$/.test(s.i94_number), "i94_number", "Up to 11 letters/numbers.", errs);
      need(!s.foreign_passport_number || /^[A-Za-z0-9]{6,12}$/.test(s.foreign_passport_number), "foreign_passport_number", "6–12 letters/numbers.", errs);
      need(!s.work_auth_expires || isDate(s.work_auth_expires), "work_auth_expires", "Valid date or blank (N/A).", errs);
    }
    need(s.attest === true, "attest", "You must check the attestation.", errs);
    need(String(s.signature ?? "").trim().length >= 2, "signature", "Type your full name to sign.", errs);
    if (Object.keys(errs).length) throw new HttpError(400, "Please fix the highlighted fields.", { fields: errs });

    const prior = await open(row.pii_enc);
    const pii_enc = await seal({
      ...prior, ssn, alien_number: alien ?? undefined,
      i94_number: s.i94_number ? s.i94_number.toUpperCase().padStart(11, "0") : undefined,
      foreign_passport_number: s.foreign_passport_number || undefined, country_code: s.country_code || undefined,
    });
    await ctx.db.from("i9_cases").update({
      first_name: s.first_name.trim(), middle_initial: s.middle_initial?.toUpperCase() || null, last_name: s.last_name.trim(),
      other_last_names: others, address_line: s.address_line, apt: s.apt || null, city: s.city, state: s.state, zip: s.zip,
      date_of_birth: s.date_of_birth, employee_phone: s.phone ? digits(s.phone) : null, citizenship_status_code: cit,
      work_auth_expires: s.work_auth_expires || null, ssn_last4: ssn!.slice(-4), pii_enc,
      section1_signature: s.signature.trim(), section1_signed_at: new Date().toISOString(),
      section1_ip: ctx.req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
      workflow: "section1_complete", invite_token_hash: null, invite_expires_at: null,
    }).eq("id", row.id);
    await log(ctx, row.id, "employee.section1", null, null);
    return { ok: true };
  },

  // ===== Staff: setup =====
  async "staff.me"(ctx) {
    await requireStaff(ctx, { trained: false });
    const pw = MODE === "mock" ? null : await ctx.ev.passwordExpiration().catch(() => null);
    return { staff: ctx.staff, mode: MODE, password_expiration_date: pw };
  },

  async "staff.clients"(ctx) {
    await requireStaff(ctx, { trained: false });
    const { data } = await ctx.db.from("everify_clients").select("*").order("name");
    return { clients: data ?? [] };
  },

  async "admin.client_upsert"(ctx, b) {
    await requireStaff(ctx, { trained: false, admin: true });
    if (!b.name || !(Number(b.client_company_id) > 0)) throw new HttpError(400, "Name and a numeric E-Verify client company ID are required.");
    const row = { name: b.name, client_company_id: Number(b.client_company_id), notify_email: b.notify_email || null };
    const q = b.id ? ctx.db.from("everify_clients").update(row).eq("id", b.id) : ctx.db.from("everify_clients").insert(row);
    const { error } = await q;
    if (error) throw new HttpError(400, error.message);
    return { ok: true };
  },

  async "admin.staff_list"(ctx) {
    await requireStaff(ctx, { trained: false, admin: true });
    const { data } = await ctx.db.from("everify_staff").select("*").order("full_name");
    return { staff: data ?? [] };
  },

  async "admin.staff_upsert"(ctx, b) {
    await requireStaff(ctx, { trained: false, admin: true });
    const email = String(b.email ?? "").trim().toLowerCase();
    const phone = digits(b.phone);
    if (!email || !b.full_name || phone.length !== 10) throw new HttpError(400, "Email, full name and a 10-digit phone are required.");
    let userId: string | undefined;
    const inv = await ctx.db.auth.admin.inviteUserByEmail(email, { redirectTo: env("PUBLIC_EMPLOYER_URL") || undefined });
    if (inv.data?.user) userId = inv.data.user.id;
    else {
      for (let page = 1; page < 20 && !userId; page++) {
        const { data } = await ctx.db.auth.admin.listUsers({ page, perPage: 1000 });
        userId = data?.users.find((u) => u.email?.toLowerCase() === email)?.id;
        if (!data || data.users.length < 1000) break;
      }
    }
    if (!userId) throw new HttpError(400, "Could not create or find that user.");
    const score = b.training_score === "" || b.training_score == null ? null : Number(b.training_score);
    if (score != null && (score < 0 || score > 100)) throw new HttpError(400, "Score must be 0–100.");
    const { error } = await ctx.db.from("everify_staff").upsert({
      user_id: userId, email, full_name: b.full_name, phone, phone_ext: digits(b.phone_ext) || null,
      is_admin: !!b.is_admin, active: b.active !== false, training_score: score,
      training_passed_at: score != null && score >= 70 ? (b.training_passed_at || new Date().toISOString()) : null,
    });
    if (error) throw new HttpError(400, error.message);
    return { ok: true };
  },

  // ===== Staff: cases =====
  async "staff.invite"(ctx, b) {
    await requireStaff(ctx);
    const email = String(b.employee_email ?? "").trim();
    if (!/^.+@.+\..+$/.test(email) || !b.client_id) throw new HttpError(400, "Client and a valid employee email are required.");
    const token = randomToken();
    const { data, error } = await ctx.db.from("i9_cases").insert({
      client_id: b.client_id, employee_email: email, first_name: b.first_name || null, last_name: b.last_name || null,
      date_of_hire: isDate(b.date_of_hire) ? b.date_of_hire : null, created_by: ctx.user!.id,
      invite_token_hash: await sha256(token), invite_expires_at: new Date(Date.now() + 14 * 864e5).toISOString(),
    }).select("id").single();
    if (error) throw new HttpError(400, error.message);
    const link = `${env("PUBLIC_EMPLOYEE_URL", "employee.html")}?t=${token}`;
    let emailed = false;
    if (env("RESEND_API_KEY") && b.send_email !== false) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env("RESEND_FROM", "onboarding@resend.dev"), to: email,
          subject: "Complete Section 1 of your Form I-9",
          html: `<p>Hello${b.first_name ? " " + b.first_name : ""},</p><p>Please complete Section 1 of your Form I-9 (Employment Eligibility Verification) no later than your first day of work:</p><p><a href="${link}">Complete my I-9 Section 1</a></p><p>This private link expires in 14 days and works once. Do not forward it.</p>`,
        }),
      });
      emailed = r.ok;
    }
    await log(ctx, data.id, "staff.invite", null, null, { emailed });
    return { id: data.id, link, emailed };
  },

  async "staff.list"(ctx, b) {
    await requireStaff(ctx);
    let q = ctx.db.from("i9_cases").select("id, first_name, last_name, employee_email, workflow, case_status, case_status_display, eligibility_statement, everify_case_number, date_of_hire, submitted_at, updated_at, client:everify_clients(name)")
      .order("updated_at", { ascending: false }).limit(500);
    if (b.open_only) q = q.neq("workflow", "closed").neq("workflow", "void");
    const { data } = await q;
    return { cases: (data ?? []).map((c: any) => ({ ...c, everify_due: c.date_of_hire ? addBusinessDays(c.date_of_hire, 3) : null })) };
  },

  async "staff.get"(ctx, b) {
    await requireStaff(ctx);
    const row = await loadCase(ctx, b.id);
    const { data: events } = await ctx.db.from("everify_events").select("action, http_status, case_status, detail, created_at").eq("case_id", b.id).order("created_at", { ascending: false }).limit(50);
    return { case: await staffView(row), events };
  },

  async "staff.reference"(ctx, b) {
    await requireStaff(ctx);
    const ok = ["citizenship_statuses", "countries", "document_categories", "document_sub_types", "document_types", "reasons_for_delay", "states", "duplicate_continue_reasons", "case_closure_reasons"];
    if (!ok.includes(b.kind)) throw new HttpError(400, "Unknown reference list.");
    const r = await evCall(ctx, null, "reference", () => ctx.ev.call("GET", `/reference/${b.kind}`, { query: b.query ?? {} }));
    const list = Object.values(r).find(Array.isArray) ?? [];
    return { items: list };
  },

  async "staff.case_fields"(ctx, b) {
    await requireStaff(ctx);
    const row = await loadCase(ctx, b.id);
    const pii = await open(row.pii_enc);
    const fields = await evCall(ctx, row, "case_fields", () => caseFields(ctx, row, b, pii.ssn));
    return { fields };
  },

  async "staff.section2"(ctx, b) {
    await requireStaff(ctx);
    const row = await loadCase(ctx, b.id);
    if (!["section1_complete", "section2_complete"].includes(row.workflow) || row.everify_case_number) {
      throw new HttpError(409, "Section 2 can only be edited after Section 1 and before E-Verify submission.");
    }
    const s = b.section2 ?? {};
    const errs: Record<string, string> = {};
    need(isDate(s.date_of_hire), "date_of_hire", "Required.", errs);
    if (isDate(s.date_of_hire) && row.date_of_birth) need(s.date_of_hire > row.date_of_birth, "date_of_hire", "Must be after date of birth.", errs);
    const listA = !!s.document_a_type_code;
    need(listA || (s.document_b_type_code && s.document_c_type_code), "document_a_type_code", "Choose one List A document, or one List B and one List C document.", errs);
    need(!(listA && (s.document_b_type_code || s.document_c_type_code)), "document_b_type_code", "Do not combine List A with List B/C.", errs);
    need(!s.expiration_date || isDate(s.expiration_date), "expiration_date", "Valid date.", errs);
    if (s.expiration_date && isDate(s.date_of_hire)) need(s.expiration_date >= today() || s.no_expiration_date, "expiration_date", "Document is expired — an unexpired document is required.", errs);
    const late = isDate(s.date_of_hire) && today() > addBusinessDays(s.date_of_hire, 3);
    if (late) need(s.reason_for_delay_code, "reason_for_delay_code", "Case is past the 3-business-day deadline; choose a reason.", errs);
    if (s.reason_for_delay_code === "OTHER") need(s.reason_for_delay_description && s.reason_for_delay_description.length <= 240, "reason_for_delay_description", "Explain (240 chars max).", errs);
    need(!s.employer_case_id || /^[a-zA-Z0-9\-\s]{1,40}$/.test(s.employer_case_id), "employer_case_id", "Letters, numbers, dashes; 40 max.", errs);
    need(s.attest === true, "attest", "You must attest to examining the documents.", errs);
    const p = s.pii ?? {};
    const pat: Record<string, RegExp> = {
      us_passport_number: /^[A-Za-z0-9]{6,9}$/, i551_number: /^[a-zA-Z]{3}(\d{10}|[*]\d{9})$/, i766_number: /^[a-zA-Z]{3}(\d{10}|[*]\d{9})$/,
      document_bc_number: /^[a-zA-Z0-9*-]{1,17}$/, visa_number: /^[A-Za-z0-9]{8}$/, sevis_number: /^N?\d{10}$/i,
      foreign_passport_number: /^[A-Za-z0-9]{6,12}$/, i94_number: /^[0-9A-Za-z]{11}$/,
    };
    for (const [k, re] of Object.entries(pat)) if (p[k]) need(re.test(p[k]), k, "Invalid format.", errs);
    if (p.alien_number && !normAlien(p.alien_number)) errs.alien_number = "7–9 digits.";
    if (Object.keys(errs).length) throw new HttpError(400, "Please fix the highlighted fields.", { fields: errs });

    const prior = await open(row.pii_enc);
    const merged = { ...prior };
    for (const k of [...Object.keys(pat), "alien_number", "country_code"]) {
      if (p[k] !== undefined) merged[k] = p[k] === "" ? undefined : (k === "alien_number" ? normAlien(p[k]) : k === "i94_number" ? String(p[k]).toUpperCase() : p[k]);
    }
    await ctx.db.from("i9_cases").update({
      date_of_hire: s.date_of_hire,
      document_a_type_code: s.document_a_type_code || null, document_b_type_code: listA ? null : s.document_b_type_code,
      document_c_type_code: listA ? null : s.document_c_type_code, document_sub_type_code: s.document_sub_type_code || null,
      us_state_code: s.us_state_code || null, expiration_date: s.no_expiration_date ? null : (s.expiration_date || null),
      no_expiration_date: !!s.no_expiration_date, reason_for_delay_code: s.reason_for_delay_code || null,
      reason_for_delay_description: s.reason_for_delay_code === "OTHER" ? s.reason_for_delay_description : null,
      employer_case_id: s.employer_case_id || null, pii_enc: await seal(merged),
      section2_attested_by: ctx.user!.id, section2_attested_at: new Date().toISOString(),
      case_creator_name: ctx.staff.full_name, case_creator_email: ctx.staff.email,
      case_creator_phone: ctx.staff.phone, case_creator_phone_ext: ctx.staff.phone_ext,
      workflow: "section2_complete",
    }).eq("id", row.id);
    await log(ctx, row.id, "staff.section2", null, null);
    return { ok: true };
  },

  // Duplicate check → case fields check → create → submit (ICA "Creating a Case" + "Submitting a Case")
  async "staff.submit"(ctx, b) {
    await requireStaff(ctx);
    let row = await loadCase(ctx, b.id);
    if (row.workflow !== "section2_complete" || !row.section2_attested_at) throw new HttpError(409, "Complete and attest Section 2 first.");
    if (row.everify_case_number && row.case_status !== "DRAFT") throw new HttpError(409, "Already submitted.");
    if ((ctx.ev as any).hint) (ctx.ev as any).hint(row.last_name ?? "");
    const pii = await open(row.pii_enc);

    if (!row.everify_case_number) {
      const dup = await evCall(ctx, row, "duplicate_check", () => ctx.ev.call("POST", "/duplicate_check", { json: { ssn: pii.ssn, client_company_id: row.client.client_company_id } }));
      const dups = (dup.results ?? []).filter((d: any) => d.case_status !== "CLOSED");
      if ((dup.results ?? []).length && !b.duplicate_continue_reason_code) {
        return { needs_duplicate_decision: true, open_duplicates: dups, duplicates: dup.results };
      }
      if (dups.length) throw new HttpError(409, "Close the open duplicate case(s) first, or continue an existing case instead.", { open_duplicates: dups });

      const fields: { field_name: string; required: boolean }[] = await evCall(ctx, row, "case_fields", () => caseFields(ctx, row, row, pii.ssn));
      const payload = await buildPayload(row, b.duplicate_continue_reason_code);
      const allowed = new Set([...fields.map((f) => f.field_name), ...ALWAYS]);
      const missing = fields.filter((f) => f.required && blank(payload[f.field_name]) && f.field_name !== "duplicate_continue_reason_code").map((f) => f.field_name);
      if (missing.length) throw new HttpError(400, `Missing required fields: ${missing.join(", ")}`, { missing });
      for (const k of Object.keys(payload)) if (!allowed.has(k)) delete payload[k];

      const created = await evCall(ctx, row, "create_case", () => ctx.ev.call("POST", "/cases", { json: payload }));
      await ctx.db.from("i9_cases").update({ everify_case_number: created.case_number, case_status: "DRAFT" }).eq("id", row.id);
      await log(ctx, row.id, "create_case", 201, "DRAFT", { case_number: created.case_number });
      row = { ...row, everify_case_number: created.case_number, case_status: "DRAFT" };
    }
    const r = await evCall(ctx, row, "submit_case", () => ctx.ev.call("POST", `/cases/${row.everify_case_number}/submit`));
    return { case: await staffView(await applyWorkflow(ctx, row, r, "submit_case", { workflow: "submitted", submitted_at: new Date().toISOString() })) };
  },

  // Continue an existing duplicate E-Verify case instead of creating a new one.
  async "staff.adopt_case"(ctx, b) {
    await requireStaff(ctx);
    const row = await loadCase(ctx, b.id);
    if (row.everify_case_number) throw new HttpError(409, "This record already has an E-Verify case.");
    const r = await evCall(ctx, row, "retrieve_case", () => ctx.ev.call("GET", `/cases/${encodeURIComponent(b.case_number)}`));
    return { case: await staffView(await applyWorkflow(ctx, row, r, "adopt_case", { everify_case_number: b.case_number, workflow: "submitted", submitted_at: new Date().toISOString() })) };
  },

  async "staff.refresh"(ctx, b) {
    await requireStaff(ctx);
    const row = await loadCase(ctx, b.id);
    const r = await evCall(ctx, row, "retrieve_case", () => ctx.ev.call("GET", `/cases/${caseNumber(row)}`));
    return { case: await staffView(await applyWorkflow(ctx, row, r, "retrieve_case")) };
  },

  async "staff.confirm_details_fields"(ctx, b) {
    await requireStaff(ctx);
    const row = await loadCase(ctx, b.id);
    const r = await evCall(ctx, row, "confirm_details_fields", () => ctx.ev.call("GET", `/cases/${caseNumber(row)}/confirm_details_fields`));
    const pii = await open(row.pii_enc);
    const current: Record<string, unknown> = { ...row, ...pii };
    return { fields: (r.case_fields ?? []).map((f: string) => ({ field_name: f, value: f === "ssn" ? "" : current[f] ?? "" })) };
  },

  async "staff.confirm_details"(ctx, b) {
    await requireStaff(ctx);
    const row = await loadCase(ctx, b.id);
    const fields = (b.fields ?? []) as { field_name: string; value: string }[];
    if (!fields.length || fields.some((f) => blank(f.value))) throw new HttpError(400, "Every field needs a value, even if unchanged.");
    const pii = await open(row.pii_enc);
    const sent = fields.map((f) => ({ field_name: f.field_name, value: f.field_name === "ssn" ? (normSsn(f.value) ?? f.value) : f.value }));
    const r = await evCall(ctx, row, "confirm_details", () => ctx.ev.call("POST", `/cases/${caseNumber(row)}/confirm_details`, { json: { case_fields: sent } }));
    // keep our record in sync with confirmed values
    const rowCols = ["first_name", "last_name", "middle_initial", "date_of_birth", "date_of_hire", "citizenship_status_code"];
    const patch: Record<string, unknown> = {};
    for (const f of sent) {
      if (rowCols.includes(f.field_name)) patch[f.field_name] = f.value;
      else pii[f.field_name] = f.value;
      if (f.field_name === "ssn") patch.ssn_last4 = String(f.value).slice(-4);
    }
    patch.pii_enc = await seal(pii);
    return { case: await staffView(await applyWorkflow(ctx, row, r, "confirm_details", patch)) };
  },

  async "staff.photo"(ctx, b) {
    await requireStaff(ctx);
    const row = await loadCase(ctx, b.id);
    const r = await evCall(ctx, row, "retrieve_photo", () => ctx.ev.call("GET", `/cases/${caseNumber(row)}/retrieve_photo`));
    await log(ctx, row.id, "retrieve_photo", 200, row.case_status);
    return { photo: r.document_photo }; // displayed only, never stored
  },

  async "staff.photo_match"(ctx, b) {
    await requireStaff(ctx);
    if (!["matching", "not-matching", "no-image"].includes(b.result)) throw new HttpError(400, "Invalid photo match result.");
    const row = await loadCase(ctx, b.id);
    const r = await evCall(ctx, row, "photo_match", () => ctx.ev.call("POST", `/cases/${caseNumber(row)}/photo_match`, { json: { photo_match: b.result } }));
    return { case: await staffView(await applyWorkflow(ctx, row, r, `photo_match:${b.result}`)) };
  },

  async "staff.scan_upload"(ctx, b) {
    await requireStaff(ctx);
    const row = await loadCase(ctx, b.id);
    const form = new FormData();
    for (const side of ["front", "back"] as const) {
      const f = b[side];
      if (!f?.data || !["application/pdf", "image/png", "image/jpeg"].includes(f.type)) throw new HttpError(400, `${side} image must be PDF, PNG or JPEG.`);
      const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
      if (bytes.length >= 5 * 1024 * 1024) throw new HttpError(400, `${side} image must be under 5MB.`);
      form.append(`${side}_photo`, new Blob([bytes], { type: f.type }), f.name || `${side}.${f.type.split("/")[1]}`);
    }
    const r = await evCall(ctx, row, "scan_and_upload", () => ctx.ev.call("POST", `/cases/${caseNumber(row)}/scan_and_upload`, { form }));
    return { case: await staffView(await applyWorkflow(ctx, row, r, "scan_and_upload")) };
  },

  async "staff.fan"(ctx, b) {
    await requireStaff(ctx);
    const row = await loadCase(ctx, b.id);
    const kind = b.kind === "referral_date_confirmation" ? "referral_date_confirmation" : "further_action_notice";
    const language = b.language === "spanish" ? "spanish" : "english";
    const pdf: Uint8Array = await evCall(ctx, row, kind, () => ctx.ev.call("GET", `/cases/${caseNumber(row)}/${kind}`, { query: { language }, binary: true }));
    if (kind === "further_action_notice") await ctx.db.from("i9_cases").update({ fan_downloaded_at: new Date().toISOString() }).eq("id", row.id);
    await log(ctx, row.id, kind, 200, row.case_status, { language });
    let bin = ""; for (let i = 0; i < pdf.length; i += 0x8000) bin += String.fromCharCode(...pdf.subarray(i, i + 0x8000));
    return { pdf: btoa(bin), filename: `${row.last_name}_${row.first_name}_${kind}_${language}.pdf` };
  },

  async "staff.refer"(ctx, b) {
    await requireStaff(ctx);
    const row = await loadCase(ctx, b.id);
    if (!row.fan_downloaded_at) throw new HttpError(409, "Download the Further Action Notice and review it with the employee first.");
    if (b.employee_notified !== true) throw new HttpError(400, "Confirm the employee was privately notified of the mismatch.");
    const r = await evCall(ctx, row, "refer", () => ctx.ev.call("POST", `/cases/${caseNumber(row)}/refer`, { json: { employee_notified: true } }));
    return { case: await staffView(await applyWorkflow(ctx, row, r, "refer", { employee_notified_at: new Date().toISOString() })) };
  },

  async "staff.no_action"(ctx, b) {
    await requireStaff(ctx);
    const row = await loadCase(ctx, b.id);
    if (b.employee_notified !== true) throw new HttpError(400, "The employee must be notified of the mismatch before choosing no action.");
    const r = await evCall(ctx, row, "no_action", () => ctx.ev.call("POST", `/cases/${caseNumber(row)}/no_action`, { json: { employee_notified: true } }));
    return { case: await staffView(await applyWorkflow(ctx, row, r, "no_action", { employee_notified_at: new Date().toISOString() })) };
  },

  async "staff.closure_reasons"(ctx, b) {
    await requireStaff(ctx);
    const cn = b.case_number ?? caseNumber(await loadCase(ctx, b.id));
    const r = await evCall(ctx, null, "closure_reasons", () => ctx.ev.call("GET", `/cases/${encodeURIComponent(cn)}/closure_reasons`));
    return { items: r.results ?? r.case_closure_reasons ?? Object.values(r).find(Array.isArray) ?? [] };
  },

  // Close one of our cases (b.id) or an external duplicate (b.case_number)
  async "staff.close"(ctx, b) {
    await requireStaff(ctx);
    if (!b.case_closure_reason_code) throw new HttpError(400, "Choose a closure reason.");
    if (b.case_closure_reason_code === "OTHER" && !b.other_reason_description) throw new HttpError(400, "Describe the reason.");
    if (b.case_closure_reason_code === "EMPLOYEE_CONTINUES_TO_WORK_AFTER_FNC" && !b.currently_employed_reason_description) throw new HttpError(400, "Explain why the employee continues to work.");
    const json = {
      case_closure_reason_code: b.case_closure_reason_code,
      other_reason_description: b.case_closure_reason_code === "OTHER" ? b.other_reason_description : undefined,
      currently_employed_reason_description: b.case_closure_reason_code === "EMPLOYEE_CONTINUES_TO_WORK_AFTER_FNC" ? b.currently_employed_reason_description : undefined,
    };
    if (b.case_number && !b.id) {
      const r = await evCall(ctx, null, "close_duplicate", () => ctx.ev.call("POST", `/cases/${encodeURIComponent(b.case_number)}/close`, { json }));
      await log(ctx, null, "close_duplicate", 200, r.case_status, { case_number: b.case_number });
      return { closed: r };
    }
    const row = await loadCase(ctx, b.id);
    const r = await evCall(ctx, row, "close_case", () => ctx.ev.call("POST", `/cases/${caseNumber(row)}/close`, { json }));
    return { case: await staffView(await applyWorkflow(ctx, row, r, "close_case", { closure_reason_code: b.case_closure_reason_code, workflow: "closed", closed_at: new Date().toISOString() })) };
  },

  async "staff.void"(ctx, b) {
    await requireStaff(ctx);
    const row = await loadCase(ctx, b.id);
    if (row.everify_case_number) throw new HttpError(409, "Submitted cases must be closed in E-Verify, not voided.");
    await ctx.db.from("i9_cases").update({ workflow: "void", invite_token_hash: null }).eq("id", row.id);
    await log(ctx, row.id, "void", null, null);
    return { ok: true };
  },

  // ===== Scheduled sync (Updated Cases → Confirm Updated Cases) =====
  async "sync"(ctx) {
    if (!env("SYNC_SECRET") || ctx.req.headers.get("x-sync-secret") !== env("SYNC_SECRET")) throw new HttpError(401, "Bad sync secret.");
    const r = await evCall(ctx, null, "updated_cases", () => ctx.ev.call("GET", "/cases/updated", { query: { number_of_records: 500 } }));
    const updated = (r.updated_cases ?? []) as any[];
    const changed: any[] = [];
    for (const u of updated) {
      const { data: row } = await ctx.db.from("i9_cases").select("*, client:everify_clients(name, notify_email)").eq("everify_case_number", u.case_number).maybeSingle();
      if (!row) { await log(ctx, null, "sync_unmatched", 200, u.case_status, { case_number: u.case_number }); continue; }
      if (row.case_status !== u.case_status || row.ssa_referral_status !== u.ssa_referral_status || row.dhs_referral_status !== u.dhs_referral_status) changed.push({ row, u });
      await applyWorkflow(ctx, row, u, "sync");
    }
    if (updated.length) await evCall(ctx, null, "confirm_updated", () => ctx.ev.call("POST", "/cases/confirm_updated", { json: { case_numbers: updated.map((u) => u.case_number) } }));
    if (env("RESEND_API_KEY")) {
      for (const { row, u } of changed) {
        if (!row.client?.notify_email) continue;
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: env("RESEND_FROM", "onboarding@resend.dev"), to: row.client.notify_email,
            subject: `E-Verify update: case ${u.case_number}`,
            html: `<p>E-Verify case <b>${u.case_number}</b> (${row.first_name} ${row.last_name?.[0] ?? ""}.) is now <b>${u.case_status_display ?? u.case_status}</b>.</p><p>Open the E-Verify dashboard to take any next steps.</p>`,
          }),
        }).catch(() => {});
      }
    }
    return { received: updated.length, changed: changed.length };
  },
};

async function byToken(ctx: Ctx, token: string) {
  if (!token || token.length < 20) throw new HttpError(401, "This link is invalid.");
  const { data } = await ctx.db.from("i9_cases").select("*, client:everify_clients(name)").eq("invite_token_hash", await sha256(token)).maybeSingle();
  if (!data) throw new HttpError(401, "This link is invalid or has already been used.");
  if (new Date(data.invite_expires_at) < new Date()) throw new HttpError(401, "This link has expired. Ask your employer for a new one.");
  return data;
}

export async function handle(req: Request, deps?: { db?: SupabaseClient; ev?: EVerifyApi }) {
  const headers = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
  const db = deps?.db ?? createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const ev: EVerifyApi = deps?.ev ?? (MODE === "mock" ? new MockEVerify() : new EVerifyClient(BASE, env("EVERIFY_USERNAME"), env("EVERIFY_PASSWORD"), db));
  const ctx: Ctx = { db, ev, req };
  try {
    const body = await req.json().catch(() => ({}));
    const fn = actions[body.action];
    if (!fn) throw new HttpError(400, "Unknown action.");
    return new Response(JSON.stringify(await fn(ctx, body) ?? {}), { headers });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const payload = e instanceof HttpError ? { error: e.message, ...e.extra } : { error: "Unexpected server error." };
    if (!(e instanceof HttpError)) console.error(e);
    return new Response(JSON.stringify(payload), { status, headers });
  }
}

if (import.meta.main) Deno.serve((req) => handle(req));
