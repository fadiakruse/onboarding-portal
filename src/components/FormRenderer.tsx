'use client';

import { useEffect, useRef, useState } from 'react';
import { FormField } from '@/lib/forms-config';
import { formatPhone, formatSSN } from '@/lib/formatters';
import { TESTING_MODE } from '@/lib/config';
import FileUpload from './FileUpload';

interface FormRendererProps {
  fields: FormField[];
  values: Record<string, any>;
  onChange: (fieldId: string, value: any) => void;
}

function AddressField({ field, value, onChange }: { field: FormField; value: string; onChange: (v: string) => void }) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInput(v: string) {
    onChange(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length < 5) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/address-search?q=${encodeURIComponent(v)}`);
        const data = await res.json();
        setSuggestions(data.results || []);
        setOpen(true);
      } catch { setSuggestions([]); }
    }, 400);
  }

  return (
    <div className="relative">
      <input type="text" required={field.required && !TESTING_MODE} placeholder={field.placeholder} value={value || ''}
        onChange={(e) => handleInput(e.target.value)} onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
          {suggestions.map((s) => (
            <li key={s} onMouseDown={() => { onChange(s); setOpen(false); }} className="cursor-pointer px-3 py-2 text-sm hover:bg-gray-50">{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MaskedConfirmField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input type={revealed ? 'text' : 'password'} value={value || ''} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
      <button type="button" onClick={() => setRevealed((r) => !r)} className="whitespace-nowrap rounded-md border border-gray-300 px-2 py-2 text-xs text-gray-600 hover:bg-gray-50">{revealed ? 'Hide' : 'Preview'}</button>
    </div>
  );
}

// Same masked-with-preview treatment as MaskedConfirmField above, but for
// confirmOf fields, which also need the mismatch warning. Only used when the
// field is explicitly flagged with `mask: true` in forms-config, so unrelated
// confirmOf fields elsewhere (if any) keep their current plain-text behavior.
function MaskedConfirmOfField({ value, onChange, mismatch }: { value: string; onChange: (v: string) => void; mismatch: boolean }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-2">
        <input type={revealed ? 'text' : 'password'} value={value || ''} onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${mismatch ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 focus:border-brand-600 focus:ring-brand-600'}`} />
        <button type="button" onClick={() => setRevealed((r) => !r)} className="whitespace-nowrap rounded-md border border-gray-300 px-2 py-2 text-xs text-gray-600 hover:bg-gray-50">{revealed ? 'Hide' : 'Preview'}</button>
      </div>
      {mismatch && <p className="mt-1 text-xs text-red-600">Doesn&rsquo;t match &mdash; please re-check.</p>}
    </div>
  );
}

function RoutingField({ value, onChange, onBankFound }: { value: string; onChange: (v: string) => void; onBankFound: (name: string) => void }) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleInput(v: string) {
    const digits = v.replace(/\D/g, '').slice(0, 9);
    onChange(digits);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (digits.length === 9) {
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/routing-lookup?rn=${digits}`);
          const data = await res.json();
          if (data.bankName) onBankFound(data.bankName);
        } catch {}
      }, 300);
    }
  }
  return (
    <input type="text" inputMode="numeric" maxLength={9} value={value || ''} onChange={(e) => handleInput(e.target.value)}
      placeholder="9-digit routing number" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
  );
}

export default function FormRenderer({ fields, values, onChange }: FormRendererProps) {
  useEffect(() => {
    fields.forEach((f) => {
      if (f.defaultToday && !values[f.id]) onChange(f.id, new Date().toISOString().slice(0, 10));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      {fields.map((field) => {
        if (field.showIf && values[field.showIf.field] !== field.showIf.equals) return null;
        const confirmMismatch = field.type === 'confirmOf' && field.confirmOf && values[field.id] && values[field.confirmOf] && values[field.id] !== values[field.confirmOf];
        return (
          <div key={field.id}>
            <label className="block text-sm font-medium text-gray-700">
              {field.label}
              {field.required && !TESTING_MODE && <span className="text-red-500"> *</span>}
            </label>
            {field.helpText && <p className="mt-0.5 text-xs text-gray-400">{field.helpText}</p>}
            <div className="mt-1">
              {field.type === 'text' && !field.triggersBankLookup && (
                <input type="text" required={field.required && !TESTING_MODE} placeholder={field.placeholder} value={values[field.id] || ''}
                  onChange={(e) => onChange(field.id, e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
              )}
              {field.type === 'address' && <AddressField field={field} value={values[field.id]} onChange={(v) => onChange(field.id, v)} />}
              {field.type === 'ssn' && (
                <input type="text" inputMode="numeric" required={field.required && !TESTING_MODE} placeholder="XXX-XX-XXXX" value={values[field.id] || ''}
                  onChange={(e) => onChange(field.id, formatSSN(e.target.value))} maxLength={11}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
              )}
              {field.type === 'phone' && (
                <input type="tel" inputMode="tel" required={field.required && !TESTING_MODE} placeholder="(XXX) XXX-XXXX" value={values[field.id] || ''}
                  onChange={(e) => onChange(field.id, formatPhone(e.target.value))} maxLength={14}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
              )}
              {field.triggersBankLookup && <RoutingField value={values[field.id]} onChange={(v) => onChange(field.id, v)} onBankFound={(name) => onChange('bankName', name)} />}
              {field.type === 'maskedConfirm' && <MaskedConfirmField value={values[field.id]} onChange={(v) => onChange(field.id, v)} />}
              {field.type === 'confirmOf' && field.mask && (
                <MaskedConfirmOfField value={values[field.id]} onChange={(v) => onChange(field.id, v)} mismatch={!!confirmMismatch} />
              )}
              {field.type === 'confirmOf' && !field.mask && (
                <div>
                  <input type="text" value={values[field.id] || ''} onChange={(e) => onChange(field.id, e.target.value)}
                    className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${confirmMismatch ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 focus:border-brand-600 focus:ring-brand-600'}`} />
                  {confirmMismatch && <p className="mt-1 text-xs text-red-600">Doesn&rsquo;t match &mdash; please re-check.</p>}
                </div>
              )}
              {field.type === 'fileUpload' && <FileUpload label={field.label} accept={field.accept} value={values[field.id] || null} onChange={(v) => onChange(field.id, v)} />}
              {field.type === 'date' && (
                <input type="date" required={field.required && !TESTING_MODE} value={values[field.id] || ''} onChange={(e) => onChange(field.id, e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
              )}
              {field.type === 'textarea' && (
                <textarea required={field.required && !TESTING_MODE} rows={3} placeholder={field.placeholder} value={values[field.id] || ''}
                  onChange={(e) => onChange(field.id, e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
              )}
              {field.type === 'select' && (
                <select required={field.required && !TESTING_MODE} value={values[field.id] || ''} onChange={(e) => onChange(field.id, e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600">
                  <option value="" disabled>Select…</option>
                  {field.options?.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
                </select>
              )}
              {field.type === 'radio' && (
                <div className="space-y-2">
                  {field.options?.map((opt) => (
                    <label key={opt} className="flex items-start gap-2 text-sm text-gray-700">
                      <input type="radio" name={field.id} required={field.required && !TESTING_MODE} checked={values[field.id] === opt} onChange={() => onChange(field.id, opt)} className="mt-0.5" />
                      {opt}
                    </label>
                  ))}
                </div>
              )}
              {field.type === 'checkbox' && (
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={!!values[field.id]} onChange={(e) => onChange(field.id, e.target.checked)} />
                  Yes
                </label>
              )}
              {field.type === 'checkboxGroup' && (
                <div className="space-y-2">
                  {field.options?.map((opt) => {
                    const current: string[] = values[field.id] || [];
                    const checked = current.includes(opt);
                    return (
                      <label key={opt} className="flex items-start gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={checked} onChange={(e) => { const next = e.target.checked ? [...current, opt] : current.filter((o) => o !== opt); onChange(field.id, next); }} className="mt-0.5" />
                        {opt}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
