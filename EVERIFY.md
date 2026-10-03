# E-Verify I-9 Module (E-Verify Web Services, ICA v31.1.0)

The employee completes Section 1 from a private link. You examine their documents and complete Section 2. Then one click runs E-Verify's whole case sequence: duplicate check, case-fields check, create case, submit. From there the dashboard walks you through whatever status comes back: photo match, scan and upload, confirm data, mismatch (tentative nonconfirmation) with notices and referral, final nonconfirmation, and closing the case. An hourly job pulls SSA/DHS updates automatically.

```
public/everify/employee.html      Section 1 (opened from the emailed one-time link)
public/everify/employer.html      Dashboard: cases, new hire, Section 2, every E-Verify status, admin
public/everify/config.js       Your Supabase URL + anon key
supabase/migrations/   Tables (RLS on, no browser access — everything goes through the function)
supabase/functions/everify/   Server: E-Verify client, token cache, encryption, all actions
supabase/tests/everify/  Mock end-to-end tests + local preview server
```

## Security model
- E-Verify credentials and SSNs never reach a browser. The function holds the credentials, and SSNs and document numbers are encrypted at rest (AES-256-GCM). Staff see only the last 4 digits of the SSN.
- Database tables have Row Level Security turned on with no policies. Only the function, using the service role, can read or write them.
- Employee links are single-use, stored only as a hash, and expire after 14 days.
- Staff sign in with a Supabase email sign-in link. They must be listed in `everify_staff`, and they must have a passing training score recorded before they can run cases. That score is the DHS 70% knowledge-test requirement.
- Every E-Verify call is logged to `everify_events`. Error details are stored, but SSNs and document numbers are not.
- Document photos from Photo Match are displayed but never stored.

## Setup (step by step)

**1. Test it in mock mode first. This needs no E-Verify credentials.**
```bash
cd onboarding-portal
PII_ENCRYPTION_KEY=$(openssl rand -base64 32) deno test -A supabase/tests/everify/          # 10 flow tests
PII_ENCRYPTION_KEY=$(openssl rand -base64 32) deno run -A supabase/tests/everify/dev_server.ts
# open http://localhost:8787/employer.html. A last name containing photo / mismatch / confirm / queue / dupe simulates that outcome.
```

**2. Create the database tables.** In the Supabase SQL editor, run `supabase/migrations/20261002000000_everify_i9.sql`. Or from the command line: `supabase db push`.

**3. Set the function secrets.** These are under Supabase → Edge Functions → Secrets, or set them with the CLI:
```bash
supabase secrets set \
  EVERIFY_MODE=stage \
  EVERIFY_USERNAME=<web services logon ID> EVERIFY_PASSWORD='<password>' \
  PII_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  SYNC_SECRET=$(openssl rand -hex 24) \
  PUBLIC_EMPLOYEE_URL=https://yourdomain/i9/employee.html \
  PUBLIC_EMPLOYER_URL=https://yourdomain/i9/employer.html \
  ALLOWED_ORIGINS=https://yourdomain \
  RESEND_API_KEY=re_... RESEND_FROM='HR <hr@yourdomain>' \
  CLIENT_SOFTWARE_VERSION=i9portal-1.0
```
Back up `PII_ENCRYPTION_KEY` somewhere safe, such as a password manager. Losing it makes all stored SSNs unreadable.

**4. Deploy the function.**
```bash
supabase functions deploy everify --no-verify-jwt
```
`--no-verify-jwt` is correct here. The function does its own authentication: invite tokens for employees, and staff JWT plus the staff table for employers.

**5. Add yourself as the first administrator.** First, open `employer.html` and request a sign-in link once; that creates your account. Then run this in the SQL editor:
```sql
insert into everify_staff (user_id, email, full_name, phone, is_admin, training_passed_at, training_score)
select id, email, 'Your Name', '7325551234', true, now(), 100 from auth.users where email = 'you@yourdomain';
```
After that, add client companies and other users from the **Admin** tab. Each client company needs its E-Verify client company ID.

**6. Schedule the hourly status sync.** In the SQL editor, enable the `pg_cron` and `pg_net` extensions, then run:
```sql
select cron.schedule('everify-sync', '17 * * * *', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT.supabase.co/functions/v1/everify',
    headers := jsonb_build_object('Content-Type','application/json','x-sync-secret','YOUR_SYNC_SECRET'),
    body := '{"action":"sync"}'::jsonb) $$);
```
This calls E-Verify's Updated Cases endpoint, updates your records, confirms receipt with Confirm Updated Cases, and emails the client's notify address when a status changes.

**7. Host the pages.** They ship with the Next.js app from `public/everify/` → `https://yourdomain/everify/employer.html` and `/everify/employee.html`. The app middleware lets `/everify/*` through without the portal login, because these pages authenticate through the function.

**8. Pass E-Verify acceptance testing (EAAT).** Using `EVERIFY_MODE=stage`, run the self-test document's scenarios. For SSA/DHS outcomes, use the stage Web Service Management GUI (E-Verify stage → View Cases). Once you're approved, switch to `EVERIFY_MODE=production` and update the credentials.

## Endpoint coverage (ICA v31)
| ICA operation | Where |
|---|---|
| Login and 12-hour token (cached, refreshed automatically) | `everify_client.ts` |
| Duplicate Check, Case Fields Check, Create Case, Submit Case | `staff.submit` |
| Retrieve Case | `staff.refresh`, `staff.adopt_case` |
| Confirm Details Fields / Confirm Details | `staff.confirm_details_fields` / `staff.confirm_details` |
| Retrieve Photo / Photo Match | `staff.photo` / `staff.photo_match` |
| Scan and Upload | `staff.scan_upload` |
| Further Action Notice / Referral Date Confirmation (English and Spanish) | `staff.fan` |
| Refer Case / No Action | `staff.refer` / `staff.no_action` |
| Case Closure Reasons / Close Case (including closing duplicate cases) | `staff.closure_reasons` / `staff.close` |
| Updated Cases / Confirm Updated Cases | `sync` |
| Reference lists (document types, sub-types, states, countries, reasons for delay, duplicate-continue reasons) | `staff.reference` |

The Section 2 form asks E-Verify's Case Fields Check which fields each document combination needs, so conditional requirements always come from E-Verify itself, not hard-coded rules.

## What stays with you (program requirements, not code)
- **Training:** build or buy the E-Verify user training course and knowledge test, and record each user's score in Admin.
- **Section 2 examination:** a person must examine the documents and attest. This module does not automate that step, and it shouldn't.
- **Form I-9 PDF and retention:** this module stores the I-9 data and the E-Verify case. Keep using your onboarding portal's I-9 PDF, and write the E-Verify case number on it or keep this record with it. Retention rules still apply.
- **Notices to employees:** give the Further Action Notice in private and keep the signed copy. Don't take adverse action while a case is open.
- **E-Verify password:** web services passwords expire. The dashboard warns you 14 days ahead. Change the password in E-Verify, then update `EVERIFY_PASSWORD`.
- **Not included:** the preparer/translator certification on Section 1, Supplement B (reverification), and the Edit Case endpoint for drafts. Drafts aren't needed in practice, because Section 2 is validated before the case is created.
