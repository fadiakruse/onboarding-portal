'use client';

interface EmbeddedOfficialPdfProps { formKey: 'w4' | 'i9'; label: string; }

export default function EmbeddedOfficialPdf({ formKey, label }: EmbeddedOfficialPdfProps) {
  return (
    <div className="mb-6">
      <div className="mb-2 rounded-md bg-amber-50 p-3 text-xs text-amber-800">
        This is the actual official {formKey === 'w4' ? 'IRS W-4' : 'USCIS I-9'} PDF, loaded live.
        Click directly into a field below to type &mdash; most browsers let you fill PDF forms
        natively. When you're done, use your browser's download/save icon (usually top-right of
        the PDF viewer) to save the completed file, then upload it using the field below.
      </div>
      <iframe src={`/api/official-pdf/${formKey}`} title={label} className="h-[600px] w-full rounded-md border border-gray-300" />
    </div>
  );
}
