-- E-Verify I-9 module (ICA v31.1.0)
-- All tables have RLS enabled with NO policies: browsers can never read them directly.
-- Every read/write goes through the `everify` edge function using the service role,
-- which enforces staff checks, training gate, and PII masking.

create extension if not exists pgcrypto;

-- Staff who may use E-Verify. DHS requires users to pass the E-Verify knowledge test
-- (>= 70%) before access; the function refuses staff without training_passed_at.
create table if not exists public.everify_staff (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  full_name          text not null,
  email              text not null,
  phone              text not null check (phone ~ '^\d{10}$'),
  phone_ext          text check (phone_ext ~ '^\d{1,8}$'),
  is_admin           boolean not null default false,
  training_passed_at timestamptz,
  training_score     int check (training_score between 0 and 100),
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

-- Client companies you verify for as an E-Verify employer agent.
create table if not exists public.everify_clients (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  client_company_id bigint not null unique check (client_company_id > 0),
  notify_email      text,               -- optional: status-change emails (Resend)
  created_at        timestamptz not null default now()
);

create table if not exists public.i9_cases (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.everify_clients(id),
  workflow           text not null default 'invited'
                     check (workflow in ('invited','section1_complete','section2_complete','submitted','closed','void')),
  invite_token_hash  text unique,
  invite_expires_at  timestamptz,
  employee_email     text not null,
  created_by         uuid references auth.users(id),

  -- Section 1 (employee)
  first_name         text,
  middle_initial     text,
  last_name          text,
  other_last_names   text[] not null default '{}',
  address_line       text,
  apt                text,
  city               text,
  state              text,
  zip                text,
  date_of_birth      date,
  employee_phone     text,
  citizenship_status_code text,
  work_auth_expires  date,
  ssn_last4          text,
  pii_enc            text,          -- AES-256-GCM JSON: ssn, alien_number, i94_number, foreign_passport_number, country_code, + Section 2 doc numbers
  section1_signature text,
  section1_signed_at timestamptz,
  section1_ip        text,

  -- Section 2 (employer)
  date_of_hire       date,
  document_a_type_code   text,
  document_b_type_code   text,
  document_c_type_code   text,
  document_sub_type_code text,
  us_state_code      text,
  expiration_date    date,
  no_expiration_date boolean,
  reason_for_delay_code        text,
  reason_for_delay_description text,
  employer_case_id   text,
  section2_attested_by uuid references auth.users(id),
  section2_attested_at timestamptz,
  case_creator_name  text,
  case_creator_email text,
  case_creator_phone text,
  case_creator_phone_ext text,

  -- E-Verify
  everify_case_number   text unique,
  case_status           text,
  case_status_display   text,
  eligibility_statement text,
  dhs_referral_status   text,
  ssa_referral_status   text,
  fan_downloaded_at     timestamptz,
  employee_notified_at  timestamptz,
  closure_reason_code   text,
  last_error            jsonb,
  submitted_at          timestamptz,
  closed_at             timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists i9_cases_status_idx on public.i9_cases (case_status);
create index if not exists i9_cases_client_idx on public.i9_cases (client_id);

-- Audit trail of every E-Verify call (no SSNs / document numbers stored here).
create table if not exists public.everify_events (
  id          bigserial primary key,
  case_id     uuid references public.i9_cases(id) on delete set null,
  actor       uuid,
  action      text not null,
  http_status int,
  case_status text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists everify_events_case_idx on public.everify_events (case_id, created_at desc);

-- Single-row cache for the 12-hour E-Verify access token.
create table if not exists public.everify_token_cache (
  id           int primary key default 1 check (id = 1),
  access_token text not null,
  expires_at   timestamptz not null,
  password_expiration_date date,
  updated_at   timestamptz not null default now()
);

create or replace function public.everify_touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists i9_cases_touch on public.i9_cases;
create trigger i9_cases_touch before update on public.i9_cases
  for each row execute function public.everify_touch_updated_at();

alter table public.everify_staff       enable row level security;
alter table public.everify_clients     enable row level security;
alter table public.i9_cases            enable row level security;
alter table public.everify_events      enable row level security;
alter table public.everify_token_cache enable row level security;
revoke all on public.everify_staff, public.everify_clients, public.i9_cases,
              public.everify_events, public.everify_token_cache from anon, authenticated;
