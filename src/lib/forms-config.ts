export type FieldType = 'text' | 'textarea' | 'date' | 'ssn' | 'phone' | 'address' | 'select' | 'radio' | 'checkbox' | 'checkboxGroup' | 'maskedConfirm' | 'confirmOf' | 'fileUpload' | 'signature';

export type AutofillKey = 'firstName' | 'lastName' | 'fullName' | 'dob' | 'email' | 'phone' | 'address' | 'ssn';

export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  helpText?: string;
  autofillKey?: AutofillKey;
  showIf?: { field: string; equals: string };
  confirmOf?: string;
  accept?: string;
  mask?: boolean;
  triggersBankLookup?: boolean;
  defaultToday?: boolean;
  defaultValue?: string;
}

export interface RichSection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface FormConfig {
  id: string;
  order: number;
  title: string;
  shortTitle: string;
  intro: string[];
  richSections?: RichSection[];
  linkText?: string;
  linkUrl?: string;
  fields: FormField[];
  requiresSignature: boolean;
  embeddedOfficialPdf?: { key: 'w4' | 'i9'; uploadFieldId: string; label: string };
}

export const FORMS: FormConfig[] = [
  { id: '01-employee-data-form', order: 1, title: 'Employee Data Form', shortTitle: 'Employee Data',
    intro: ['This Employee Data Form does not constitute, imply, or create either an employment agreement or any terms of employment. All employment is considered "at will."'],
    fields: [
      { id: 'firstName', label: 'First Name', type: 'text', required: true },
      { id: 'lastName', label: 'Last Name', type: 'text', required: true },
      { id: 'ssn', label: 'Social Security Number', type: 'ssn', required: true },
      { id: 'dob', label: 'Date of Birth', type: 'date', required: true },
      { id: 'address', label: 'Home Address', type: 'address', required: true, helpText: 'Start typing and select your address from the suggestions to verify it.' },
      { id: 'cell', label: 'Cell Phone', type: 'phone', required: true },
      { id: 'email', label: 'Email Address', type: 'text', required: true },
      { id: 'emergencyContactName', label: 'Emergency Contact Name', type: 'text', required: true },
      { id: 'emergencyContactPhone', label: 'Emergency Contact Phone', type: 'phone', required: true },
      { id: 'emergencyContactRelationship', label: 'Relationship to Emergency Contact', type: 'text', required: true },
      { id: 'hireType', label: 'Hire Type', type: 'radio', options: ['New Hire', 'Status Change'], required: true },
      { id: 'position', label: 'Position', type: 'select', options: ['Medical Assistant', 'Front Desk', 'Manager', 'Physician', 'PA/NP', 'Other'], required: true },
      { id: 'positionOther', label: 'Please specify your position', type: 'text', showIf: { field: 'position', equals: 'Other' } },
      { id: 'startDate', label: 'Start Date', type: 'date', required: true },
      { id: 'employmentType', label: 'Employment Type', type: 'select', options: ['Full-time', 'Part-time', 'Summer Hire', 'Contractor'], required: true },
      { id: 'salaryRate', label: 'Salary Rate ($)', type: 'text', required: true },
      { id: 'salaryBasis', label: 'Salary Basis', type: 'radio', options: ['Per hour', 'Annually'], required: true },
      { id: 'specialConditions', label: 'Special Conditions of Employment (if any)', type: 'textarea' },
    ], requiresSignature: true },
   { id: '02-w4-2026', order: 2, title: "Form W-4 (2026) — Employee's Withholding Certificate", shortTitle: 'W-4 (2026)',
    intro: ['Complete the fields below \u2014 this automatically fills out the official IRS Form W-4 and saves the completed, signed form for your records.'],
    linkText: 'View a blank copy of the official Form W-4', linkUrl: 'https://www.irs.gov/pub/irs-pdf/fw4.pdf',
    fields: [
      { id: 'w4FirstName', label: 'First name and middle initial', type: 'text', required: true, autofillKey: 'firstName' },
      { id: 'w4LastName', label: 'Last name', type: 'text', required: true, autofillKey: 'lastName' },
      { id: 'w4Address', label: 'Address', type: 'address', required: true, autofillKey: 'address' },
      { id: 'w4Ssn', label: 'Social Security Number', type: 'ssn', required: true, autofillKey: 'ssn' },
      { id: 'w4FilingStatus', label: 'Filing Status', type: 'radio', required: true,
        options: ['Single or Married filing separately', 'Married filing jointly or Qualifying surviving spouse', 'Head of household'] },
      { id: 'w4MultipleJobs', label: 'Step 2(c): Check if you (and spouse) have only two jobs total', type: 'checkbox' },
      { id: 'w4Dependents3a', label: 'Step 3(a): Qualifying children under 17 \u00d7 $2,200', type: 'text' },
      { id: 'w4Dependents3b', label: 'Step 3(b): Other dependents \u00d7 $500', type: 'text' },
      { id: 'w4Dependents', label: 'Step 3: Total credits ($)', type: 'text' },
      { id: 'w4OtherIncome', label: 'Step 4(a): Other income ($)', type: 'text' },
      { id: 'w4Deductions', label: 'Step 4(b): Deductions ($)', type: 'text' },
      { id: 'w4ExtraWithholding', label: 'Step 4(c): Extra withholding per pay period ($)', type: 'text' },
      { id: 'w4Exempt', label: 'I claim exemption from withholding for 2026 (see the linked form for eligibility)', type: 'checkbox' },
    ],
    requiresSignature: true },

    intro: ['Complete Section 1 only of the official USCIS Form I-9 below using your browser\u2019s PDF tools. Section 2 (document review) will be completed by your employer/HR representative.', 'When finished, save/download the completed PDF and upload it here.'],
    embeddedOfficialPdf: { key: 'i9', uploadFieldId: 'completedI9File', label: 'Upload your completed I-9 PDF (Section 1)' },
    fields: [{ id: 'completedI9File', label: 'Upload your completed I-9 PDF (Section 1)', type: 'fileUpload', accept: 'application/pdf', required: true }],
    requiresSignature: true },
  { id: '04-direct-deposit', order: 4, title: 'Direct Deposit Authorization', shortTitle: 'Direct Deposit',
    intro: ['Please complete all information below. This authorization will remain in effect until you modify or cancel it in writing.'],
    fields: [
      { id: 'ddName', label: 'Name', type: 'text', required: true, autofillKey: 'fullName' },
      { id: 'ddAddress', label: 'Address', type: 'address', required: true, autofillKey: 'address' },
      { id: 'routingNumber', label: 'Routing Number', type: 'text', required: true, triggersBankLookup: true },
      { id: 'routingNumberConfirm', label: 'Confirm Routing Number', type: 'confirmOf', confirmOf: 'routingNumber', required: true },
      { id: 'bankName', label: 'Name of Bank', type: 'text', required: true, helpText: 'Auto-filled from the routing number when recognized — double check it\u2019s correct.' },
      { id: 'accountNumber', label: 'Account Number', type: 'maskedConfirm', required: true },
      { id: 'accountNumberConfirm', label: 'Confirm Account Number', type: 'confirmOf', confirmOf: 'accountNumber', mask: true, required: true },
      { id: 'accountType', label: 'Type of Account', type: 'radio', options: ['Checking', 'Savings'], required: true },
      { id: 'checkImage', label: 'Upload Check Image (voided check)', type: 'fileUpload', accept: 'image/*,application/pdf', required: true },
    ], requiresSignature: true },
  { id: '05-hipaa-confidentiality', order: 5, title: 'Employee HIPAA Confidentiality Agreement', shortTitle: 'HIPAA Confidentiality',
    linkText: 'Review terms of Confidentiality Agreement', linkUrl: 'http://navesinkderm.com/wp-content/uploads/2026/08/05-HIPAA-Confidentiality.pdf',
    intro: ['It is the responsibility of all workforce members to preserve and protect confidential patient, employee, and business information.', 'By signing below, you acknowledge that you have read and understand this agreement and agree to comply with its terms, including that your obligation to safeguard confidentiality continues after your employment ends.'],
    fields: [{ id: 'printName', label: 'Print Name', type: 'text', required: true, autofillKey: 'fullName' }], requiresSignature: true },
  { id: '06-hipaa-compliance', order: 6, title: 'Employee HIPAA Compliance Signature Form', shortTitle: 'HIPAA Compliance',
    linkText: 'Review terms of HIPAA Compliance Agreement', linkUrl: 'http://navesinkderm.com/wp-content/uploads/2026/08/06-HIPAA-Compliance-Form.pdf',
    intro: ["I have attended the facility's HIPAA compliance training program or read the HIPAA compliance training booklets, and agree to comply with these requirements to the best of my ability."],
    fields: [], requiresSignature: true },
  { id: '07-job-exposure-classification', order: 7, title: 'Job Exposure Classification Record', shortTitle: 'Exposure Classification',
    intro: ['Employees are classified according to work-task exposure to certain body fluids as required by the OSHA Bloodborne Standard. Select the category that matches your role.'],
    richSections: [
      { heading: 'Exposure Determination Categories' },
      { heading: 'Category 1: All Employees Have Exposure', bullets: ['Job Titles: Physicians, nurses, medical assistants, surgical techs, histotechnicians.', 'Criteria: Daily routine inherently involves potential contact with blood, body fluids, or tissues.'] },
      { heading: 'Category 2: Some Employees Have Exposure', bullets: ['Job Titles: Medical receptionists, cleaning staff, maintenance workers.', 'Criteria: Normal routine has no exposure, but specific tasks (like handling regulated waste or cleaning spills) may be required.'] },
      { heading: 'Category 3: No Occupational Exposure', bullets: ['Job Titles: Billing staff, off-site administrative personnel.', 'Criteria: Duties do not involve any exposure or emergency first-aid response expectations.'] },
    ],
    fields: [{ id: 'exposureCategory', label: 'Exposure Category', type: 'radio', options: ['Category 1 — All Employees Have Exposure', 'Category 2 — Some Employees Have Exposure', 'Category 3 — No Occupational Exposure'], required: true }],
    requiresSignature: true },
  { id: '08-confidentiality-agreement', order: 8, title: 'Confidentiality Agreement', shortTitle: 'Confidentiality Agreement',
    linkText: 'Review terms of TMGNJ Confidentiality Agreement', linkUrl: 'http://navesinkderm.com/wp-content/uploads/2026/08/08-Confidentiality-Agreement.pdf',
    intro: ['This Confidentiality Agreement governs your access to patient and Practice information during and after your employment. Please read the full agreement linked above before signing.', 'By signing, you agree to keep all Information confidential, use it only in performance of your job duties, and return all materials upon termination of employment.'],
    fields: [{ id: 'employeeFullName', label: 'Employee Full Name', type: 'text', required: true, autofillKey: 'fullName' }], requiresSignature: true },
  { id: '09-cepa-acknowledgment', order: 9, title: 'CEPA "Whistleblower Act" Acknowledgment', shortTitle: 'CEPA Acknowledgment',
    linkText: 'Review the Conscientious Employee Protection Act (CEPA)', linkUrl: 'https://navesinkderm.com/wp-content/uploads/2026/07/CEPA-Navesink-Dermatology.pdf',
    intro: ['This acknowledges that you have received notice of your rights under the Conscientious Employee Protection Act (CEPA) and understand the designated contact person for reporting alleged violations.'],
    fields: [{ id: 'cepaPrintName', label: 'Print Name', type: 'text', required: true, autofillKey: 'fullName' }], requiresSignature: true },
  { id: '10-medicare-attestation', order: 10, title: 'Medicare Compliance Attestation', shortTitle: 'Medicare Attestation',
    linkText: 'Complete the Medicare Parts C & D Fraud, Waste & Abuse Training (upload your certificate below upon completion)', linkUrl: 'https://www.cms.gov/Outreach-and-Education/MLN/WBT/MLN3995723-MLNPartsCD/FWA/story.html',
    intro: ['I have reviewed the training materials concerning Medicare Parts C and D Compliance and Combating Medicare Parts C and D Fraud, Waste, and Abuse, as well as the Medicare Compliance Policies and Code of Conduct.'],
    fields: [
      { id: 'medicarePrintName', label: 'Employee Name', type: 'text', required: true, autofillKey: 'fullName' },
      { id: 'trainingCertificate', label: 'Upload Training Completion Certificate', type: 'fileUpload', accept: 'image/*,application/pdf', required: true },
    ], requiresSignature: true },
  { id: '11-hep-b-vaccination', order: 11, title: 'Hepatitis B Vaccination Record', shortTitle: 'Hep B Vaccination',
    intro: ['All employees with potential occupation exposure (Job Risk Classification 1 & 2) to blood or other infectious materials will be offered a Hepatitis B vaccination.', 'OSHA and the CDC have identified the potential exposure risk of health care workers to the hepatitis B virus (HBV) in the course of performing their duties. For the protection of our employees, we are offering pre-screening testing (optional-not mandatory), the HBV vaccination (3 inoculations), and a follow-up antibody blood test for Hepatitis B surface antigen (given 1-2 months following 3rd inoculation - mandatory after 1/15/99) to all employees with potential exposure to blood or other potentially infectious materials.', 'In accordance with recommended OSHA and CDC guidelines this vaccine and testing is offered at no cost to the employee. You have the ability to decide whether or not you want the vaccine. If you decline at this time you may reconsider and request the vaccine at any time in the future while employed.', 'Please indicate your choice below.'],
    fields: [
      { id: 'hepBChoice', label: 'Your Choice', type: 'radio', options: ['I want to receive the pre-screening (optional — give reason in notes)', 'I want to receive the vaccine series', 'I have already had the hepatitis B vaccine series and will supply information to confirm receiving it', 'Declination: I do not want the vaccine or testing and have read the following statement: I understand that due to my occupational exposure to blood or other potentially infectious materials I may be at risk of acquiring hepatitis B virus (HBV) infection. I have been given the opportunity to be vaccinated with hepatitis B vaccine at no charge to myself. However, I decline the hepatitis B vaccination at this time. I understand that by declining this vaccine, I continue to be at risk of acquiring hepatitis B, a serious disease. If in the future I continue to have occupational exposure to blood or other potentially infectious materials and I want to be vaccinated with hepatitis B vaccine, I can receive the vaccination series at no charge to me.'], required: true },
      { id: 'hepBNotes', label: 'Notes (optional)', type: 'textarea' },
    ], requiresSignature: true },
  { id: '12-human-trafficking-awareness', order: 12, title: 'Human Trafficking Awareness Acknowledgment', shortTitle: 'Trafficking Awareness',
    linkText: 'Review the Human Trafficking Awareness Training', linkUrl: 'https://navesinkderm.com/wp-content/uploads/2026/07/Human-Trafficking-Awareness-Training.pdf',
    intro: ['I reviewed in its entirety the training module titled "Recognizing and Responding to Human Trafficking in a Healthcare Context" (National Human Trafficking Resource Center).'],
    fields: [{ id: 'reviewDate', label: 'Date Training Was Reviewed', type: 'date', required: true, defaultToday: true }], requiresSignature: true },
  { id: '13-employee-manual-acknowledgement', order: 13, title: 'Acknowledgment of Receipt of Employee Manual', shortTitle: 'Employee Manual',
    linkText: 'Review Our Employee Manual', linkUrl: 'https://navesinkderm.com/employees/employee_manual_app.html',
    intro: ['This acknowledges that you have received, read, and understand the Employee Manual, and agree to adhere to its policies, including any future revisions communicated in writing.'],
    fields: [{ id: 'manualPrintName', label: 'Print Name', type: 'text', required: true, autofillKey: 'fullName' }], requiresSignature: true },
];

export function getFormById(id: string): FormConfig | undefined { return FORMS.find((f) => f.id === id); }
export function getFormByOrder(order: number): FormConfig | undefined { return FORMS.find((f) => f.order === order); }
export const TOTAL_FORMS = FORMS.length;

export function buildProfile(form1Answers: Record<string, any> | undefined | null) {
  const a = form1Answers ?? {};
  const firstName = a.firstName ?? '';
  const lastName = a.lastName ?? '';
  return {
    firstName, lastName,
    fullName: [firstName, lastName].filter(Boolean).join(' '),
    dob: a.dob ?? '', email: a.email ?? '', phone: a.cell ?? '', address: a.address ?? '', ssn: a.ssn ?? '',
  } as Record<AutofillKey, string>;
}
