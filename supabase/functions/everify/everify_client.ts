// E-Verify REST client — ICA v31.1.0 (Employer Web Services)
// Stage:      https://stage-everify.uscis.gov/api/v31
// Production: https://everify.uscis.gov/api/v31
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export class EVerifyError extends Error {
  constructor(public status: number, public errors: Array<Record<string, unknown>>, msg?: string) {
    super(msg ?? (errors?.map((e) => e.message).join("; ") || `E-Verify HTTP ${status}`));
  }
}

type CallOpts = {
  json?: unknown;
  query?: Record<string, string | number | undefined>;
  form?: FormData;
  binary?: boolean; // expect application/pdf
};

export interface EVerifyApi {
  call(method: "GET" | "POST", path: string, opts?: CallOpts): Promise<any>;
  passwordExpiration(): Promise<string | null>;
}

const TOKEN_LIFETIME_MS = 11.5 * 60 * 60 * 1000; // ICA: 12-hour lifespan; refresh early

export class EVerifyClient implements EVerifyApi {
  constructor(
    private baseUrl: string,
    private username: string,
    private password: string,
    private db: SupabaseClient,
  ) {}

  private async login(): Promise<string> {
    const r = await fetch(`${this.baseUrl}/authentication/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new EVerifyError(r.status, body.errors ?? [], "E-Verify login failed");
    const pwExp = body.user_info?.password_expiration_date ?? null;
    await this.db.from("everify_token_cache").upsert({
      id: 1,
      access_token: body.access_token,
      expires_at: new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString(),
      password_expiration_date: pwExp,
      updated_at: new Date().toISOString(),
    });
    return body.access_token;
  }

  private async token(force = false): Promise<string> {
    if (!force) {
      const { data } = await this.db.from("everify_token_cache").select("access_token, expires_at").eq("id", 1)
        .maybeSingle();
      if (data && new Date(data.expires_at).getTime() > Date.now() + 5 * 60 * 1000) return data.access_token;
    }
    return await this.login();
  }

  async passwordExpiration() {
    const { data } = await this.db.from("everify_token_cache").select("password_expiration_date").eq("id", 1)
      .maybeSingle();
    return data?.password_expiration_date ?? null;
  }

  async call(method: "GET" | "POST", path: string, opts: CallOpts = {}, retried = false): Promise<any> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.token(retried)}`,
      Accept: opts.binary ? "application/pdf" : "application/json",
    };
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.json); }
    else if (method === "POST") { headers["Content-Type"] = "application/json"; body = "{}"; }

    const r = await fetch(url, { method, headers, body });
    if (r.status === 401 && !retried) return this.call(method, path, opts, true); // token expired/revoked → re-login once
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new EVerifyError(r.status, err.errors ?? []);
    }
    if (opts.binary) return new Uint8Array(await r.arrayBuffer());
    const text = await r.text();
    return text ? JSON.parse(text) : {};
  }
}

// ---------------------------------------------------------------------------
// MOCK mode (EVERIFY_MODE=mock): lets you click through every status before you
// have stage credentials. Outcome is chosen by the employee's LAST NAME on submit:
//   contains "photo"       → PHOTO_MATCH
//   contains "mismatch"    → PENDING_REFERRAL (Tentative Nonconfirmation)
//   contains "confirm"     → UNCONFIRMED_DATA
//   contains "queue"       → QUEUED
//   contains "dupe"        → duplicate_check returns an existing case
//   anything else          → CLOSED / EMPLOYMENT_AUTHORIZED
// ---------------------------------------------------------------------------
const wf = (case_number: string, case_status: string, display: string, elig: string | null = null, ssa = "NOT_REFERRED", dhs = "NOT_REFERRED") => ({
  case_number, case_status, case_status_display: display, case_eligibility_statement: elig,
  ssa_referral_status: ssa, dhs_referral_status: dhs,
});
const TINY_PDF = new TextEncoder().encode(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj 4 0 obj<</Length 58>>stream\nBT /F1 18 Tf 72 700 Td (MOCK E-Verify notice - not real) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

export class MockEVerify implements EVerifyApi {
  private lastName = "";
  hint(lastName: string) { this.lastName = lastName.toLowerCase(); }
  async passwordExpiration() { return null; }
  async call(method: string, path: string, opts: CallOpts = {}): Promise<any> {
    const cn = path.split("/")[2] ?? "";
    const j = (opts.json ?? {}) as Record<string, any>;
    if (path === "/duplicate_check") {
      const dupe = this.lastName.includes("dupe");
      return { total_results: dupe ? 1 : 0, results: dupe ? [{ case_number: "2026001000001AA", case_status: "PENDING_REFERRAL", case_status_display: "Tentative Nonconfirmation (SSA)", first_name: "Existing", last_name: "Case", created_date: "2026-01-05" }] : [] };
    }
    if (path === "/checks/case_fields") {
      const f = ["first_name", "last_name", "date_of_birth", "ssn", "citizenship_status_code", "date_of_hire", "case_creator_name", "case_creator_email_address", "case_creator_phone_number"];
      if (j.document_a_type_code === "US_PASSPORT") f.push("us_passport_number", "expiration_date");
      if (j.document_a_type_code === "FORM_I551") f.push("alien_number", "i551_number");
      if (j.document_a_type_code === "FORM_I766") f.push("alien_number", "i766_number", "expiration_date");
      if (j.document_b_type_code === "DRIVERS_LICENSE") f.push("document_sub_type_code", "us_state_code", "document_bc_number", "expiration_date", "no_expiration_date");
      return { case_fields: f.map((field_name) => ({ field_name, required: true })) };
    }
    if (path === "/cases" && method === "POST") {
      this.lastName = String(j.last_name ?? "").toLowerCase();
      if (this.lastName.includes("dupe") && !j.duplicate_continue_reason_code) throw new EVerifyError(409, [{ error_code: "CASE_STATUS_CONFLICT", message: "A duplicate case exists." }]);
      return { ...j, case_number: `2026${String(Date.now()).slice(-9)}MK`, case_status: "DRAFT" };
    }
    if (path.endsWith("/submit")) {
      const n = this.lastName;
      if (n.includes("photo")) return wf(cn, "PHOTO_MATCH", "Photo Matching Required");
      if (n.includes("mismatch")) return wf(cn, "PENDING_REFERRAL", "Tentative Nonconfirmation (SSA)", null, "PENDING_REFERRAL");
      if (n.includes("confirm")) return wf(cn, "UNCONFIRMED_DATA", "Confirm Case Data");
      if (n.includes("queue")) return wf(cn, "QUEUED", "Verification In Process");
      return wf(cn, "CLOSED", "Closed", "EMPLOYMENT_AUTHORIZED");
    }
    if (path.endsWith("/confirm_details_fields")) return { case_fields: ["first_name", "last_name", "date_of_birth"] };
    if (path.endsWith("/confirm_details")) return wf(cn, "CLOSED", "Closed", "EMPLOYMENT_AUTHORIZED");
    if (path.endsWith("/retrieve_photo")) {
      return { document_photo: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" };
    }
    if (path.endsWith("/photo_match")) {
      return j.photo_match === "matching" ? wf(cn, "CLOSED", "Closed", "EMPLOYMENT_AUTHORIZED") : wf(cn, "SCAN_AND_UPLOAD", "Case Incomplete");
    }
    if (path.endsWith("/scan_and_upload")) return wf(cn, "PENDING_REFERRAL", "Tentative Nonconfirmation (DHS)", null, "NOT_REFERRED", "PENDING_REFERRAL");
    if (path.endsWith("/further_action_notice") || path.endsWith("/referral_date_confirmation")) return TINY_PDF;
    if (path.endsWith("/refer")) return wf(cn, "REFERRED", "Employee Referred (SSA)", null, "REFERRED");
    if (path.endsWith("/no_action")) return wf(cn, "FINAL_NONCONFIRMATION", "Final Nonconfirmation", "NO_ACTION_FNC");
    if (path.endsWith("/closure_reasons")) {
      return { results: [
        { code: "EMPLOYEE_CONTINUES_TO_WORK_AFTER_EA", name: "The employee continues to work for the employer after receiving an Employment Authorized result." },
        { code: "EMPLOYEE_TERMINATED_FOR_FNC_RESULT", name: "The employee was terminated by the employer for receiving a Final Nonconfirmation result." },
        { code: "EMPLOYEE_CONTINUES_TO_WORK_AFTER_FNC", name: "The employee continues to work for the employer after receiving a Final Nonconfirmation result." },
        { code: "INCORRECT_DATA", name: "The case is being closed because the data entered is incorrect." },
        { code: "OTHER", name: "Other" },
      ] };
    }
    if (path.endsWith("/close")) return wf(cn, "CLOSED", "Closed", null);
    if (path === "/cases/updated") return { updated_cases: [] };
    if (path === "/cases/confirm_updated") return { confirmed_cases: j.case_numbers ?? [], unconfirmed_cases: [] };
    if (path.startsWith("/reference/")) return mockReference(path, opts.query ?? {});
    if (path.startsWith("/cases/")) return wf(cn, "QUEUED", "Verification In Process");
    throw new EVerifyError(404, [{ message: `Mock: no route ${path}` }]);
  }
}

function mockReference(path: string, q: Record<string, unknown>) {
  const kind = path.split("/")[2];
  if (kind === "document_types") {
    const lists: Record<string, [string, string][]> = {
      LIST_A: [["US_PASSPORT", "U.S. Passport or Passport Card"], ["FORM_I551", "Permanent Resident Card (Form I-551)"], ["FORM_I766", "Employment Authorization Document (Form I-766)"]],
      LIST_B: [["DRIVERS_LICENSE", "Driver's license or ID card issued by a U.S. state or outlying possession"], ["SCHOOL_ID_CARD", "School ID card"]],
      LIST_C: [["SOCIAL_SECURITY_CARD", "Social Security Card"], ["US_BIRTH_CERTIFICATE", "U.S. birth certificate"]],
    };
    return { document_types: (lists[String(q.document_category)] ?? []).map(([code, name]) => ({ code, name })) };
  }
  if (kind === "document_sub_types") return { document_sub_types: [{ code: "DRIVERS_LICENSE", name: "Driver's License" }, { code: "STATE_ID_CARD", name: "State Issued ID Card" }] };
  if (kind === "states") return { states: [{ code: "NJ", name: "New Jersey" }, { code: "NY", name: "New York" }, { code: "PA", name: "Pennsylvania" }] };
  if (kind === "countries") return { countries: [{ code: "CAN", name: "Canada" }, { code: "MEX", name: "Mexico" }, { code: "IND", name: "India" }] };
  if (kind === "reasons_for_delay") return { reasons_for_delay: [{ code: "AWAITING_SOCIAL_SECURITY_NUMBER", name: "Awaiting Social Security Number" }, { code: "TECHNICAL_PROBLEMS", name: "Technical Problems" }, { code: "OTHER", name: "Other" }] };
  if (kind === "duplicate_continue_reasons") return { duplicate_continue_reasons: [{ code: "REHIRE", name: "Employee was rehired" }, { code: "PREVIOUS_CASE_RESULT_RESUBMIT", name: "Previous case result was Resubmit" }, { code: "OTHER", name: "Other" }] };
  return {};
}
