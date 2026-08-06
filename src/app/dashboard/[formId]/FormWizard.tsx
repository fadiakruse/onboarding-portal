'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FormConfig, AutofillKey } from '@/lib/forms-config';
import FormRenderer from '@/components/FormRenderer';
import SignaturePad from '@/components/SignaturePad';
import EmbeddedOfficialPdf from '@/components/EmbeddedOfficialPdf';
import { TESTING_MODE } from '@/lib/config';

interface FormWizardProps {
  form: FormConfig;
  existingAnswers: Record<string, any>;
  alreadyCompleted: boolean;
  employeeName: string;
  profile: Record<AutofillKey, string>;
}

function renderTypedSignature(name: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 180;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1a1a2e';
  ctx.font = "italic 44px 'Brush Script MT', 'Segoe Script', cursive";
  ctx.textBaseline = 'middle';
  ctx.fillText(name || '', 24, canvas.height / 2);
  return canvas.toDataURL('image/png');
}

export default function FormWizard({ form, existingAnswers, alreadyCompleted, employeeName, profile }: FormWizardProps) {
  const router = useRouter();

  const profileDefaults = useMemo(() => {
    const defaults: Record<string, any> = {};
    form.fields.forEach((f) => {
      if (f.autofillKey && profile[f.autofillKey]) defaults[f.id] = profile[f.autofillKey];
    });
    return defaults;
  }, [form, profile]);

  const [values, setValues] = useState<Record<string, any>>({ ...profileDefaults, ...existingAnswers });
  const [sigMode, setSigMode] = useState<'draw' | 'type'>('draw');
  const [signature, setSignature] = useState<string | null>(null);
  const [typedName, setTypedName] = useState(profile.fullName || '');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const todayDisplay = useRef(new Date().toLocaleDateString('en-US')).current;

  const showSummary = form.order !== 1 && (profile.fullName || profile.email || profile.phone);

  function handleChange(fieldId: string, value: any) {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!TESTING_MODE) {
      const requiredMissing = form.fields.some((f) => {
        if (f.showIf && values[f.showIf.field] !== f.showIf.equals) return false;
        return f.required && !values[f.id] && values[f.id] !== false;
      });
      if (requiredMissing) { setError('Please complete all required fields marked with *.'); return; }
    }

    const mismatchedConfirm = form.fields.find(
      (f) => f.type === 'confirmOf' && f.confirmOf && values[f.id] && values[f.confirmOf] && values[f.id] !== values[f.confirmOf]
    );
    if (mismatchedConfirm) {
      setError(`${mismatchedConfirm.label} does not match. Please double-check both entries.`);
      return;
    }

    if (form.requiresSignature && !confirmed) {
      setError('Please confirm the information provided before submitting.');
      return;
    }

    let finalSignature: string | null = null;
    if (sigMode === 'draw') {
      finalSignature = signature;
    } else if (typedName.trim()) {
      finalSignature = renderTypedSignature(typedName.trim());
    }

    if (form.requiresSignature && !finalSignature && !TESTING_MODE) {
      setError('Please sign before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/submit-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId: form.id, answers: values, signature: finalSignature }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Something went wrong. Please try again.');
      }

      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  if (alreadyCompleted) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
          <p className="text-sm text-green-800">
            You've already completed <strong>{form.title}</strong>.
          </p>
          <Link href="/dashboard" className="mt-4 inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Back to checklist
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/dashboard" className="text-xs text-gray-400 hover:text-gray-600">← Back to checklist</Link>

      <h1 className="mt-3 text-xl font-semibold text-gray-900">{form.title}</h1>
      {TESTING_MODE && (
        <p className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          Testing mode — most required fields are not enforced (signature confirmation always is)
        </p>
      )}

      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-6">
        {form.linkText && form.linkUrl && (
          <a href={form.linkUrl} target="_blank" rel="noopener noreferrer"
            className="mb-4 inline-block text-sm font-medium text-brand-600 underline hover:text-brand-700">
            {form.linkText} ↗
          </a>
        )}

        {showSummary && (
          <div className="mb-5 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-gray-50 p-3 text-xs text-gray-600">
            <div className="col-span-2"><span className="font-medium text-gray-700">Name:</span> {profile.fullName || '—'}</div>
            <div><span className="font-medium text-gray-700">DOB:</span> {profile.dob || '—'}</div>
            <div><span className="font-medium text-gray-700">Phone:</span> {profile.phone || '—'}</div>
            <div className="col-span-2"><span className="font-medium text-gray-700">Email:</span> {profile.email || '—'}</div>
            <div className="col-span-2"><span className="font-medium text-gray-700">Address:</span> {profile.address || '—'}</div>
          </div>
        )}

        {form.intro.map((para, i) => (<p key={i} className="mb-3 text-sm text-gray-600">{para}</p>))}

        {form.richSections && (
          <div className="mb-5 space-y-4 rounded-md bg-gray-50 p-4">
            {form.richSections.map((section, i) => (
              <div key={i}>
                {section.heading && <p className="text-sm font-semibold text-gray-800">{section.heading}</p>}
                {section.paragraphs?.map((p, j) => (<p key={j} className="mt-1 text-sm text-gray-600">{p}</p>))}
                {section.bullets && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-600">
                    {section.bullets.map((b, j) => (<li key={j}>{b}</li>))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        {form.embeddedOfficialPdf && (
          <EmbeddedOfficialPdf formKey={form.embeddedOfficialPdf.key} label={form.embeddedOfficialPdf.label} />
        )}

        <form onSubmit={handleSubmit} className="mt-4">
          {form.fields.length > 0 && (
            <FormRenderer fields={form.fields} values={values} onChange={handleChange} />
          )}

          {form.requiresSignature && (
            <div className="mt-6 border-t border-gray-100 pt-5">
              <label className="mb-4 flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
                I confirm that I have read and understand the information provided on this page, and I acknowledge the options I have selected.
                <span className="text-red-500">*</span>
              </label>

              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  Signature {!TESTING_MODE && <span className="text-red-500">*</span>}
                </span>
                <div className="flex items-center gap-3">
                  <div className="flex overflow-hidden rounded-md border border-gray-300 text-xs">
                    <button type="button" onClick={() => setSigMode('draw')} className={`px-3 py-1 ${sigMode === 'draw' ? 'bg-brand-600 text-white' : 'bg-white text-gray-600'}`}>Draw</button>
                    <button type="button" onClick={() => setSigMode('type')} className={`px-3 py-1 ${sigMode === 'type' ? 'bg-brand-600 text-white' : 'bg-white text-gray-600'}`}>Type</button>
                  </div>
                  <span className="text-xs text-gray-400">Date: {todayDisplay}</span>
                </div>
              </div>

              {sigMode === 'draw' ? (
                <SignaturePad onChange={setSignature} />
              ) : (
                <input type="text" placeholder="Type your full legal name" value={typedName} onChange={(e) => setTypedName(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-lg italic focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
                  style={{ fontFamily: "'Brush Script MT', 'Segoe Script', cursive" }} />
              )}
            </div>
          )}

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={submitting}
            className="mt-6 w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
            {submitting ? 'Submitting…' : 'Submit & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
