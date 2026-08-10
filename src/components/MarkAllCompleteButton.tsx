'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MarkAllCompleteButton({
  employeeId,
  employeeLabel,
}: {
  employeeId: string;
  employeeLabel: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/mark-all-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not mark forms complete.');
      setConfirming(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        Mark all forms complete
      </button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <p className="text-sm text-gray-800">
              Mark every remaining form for <strong>{employeeLabel}</strong> as complete, even though they
              haven&rsquo;t submitted them?
            </p>
            <p className="mt-2 text-xs text-amber-600">
              This is an override — no PDF is generated for forms completed this way. Use for cases handled
              outside the system (e.g. paper forms already on file).
            </p>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setConfirming(false);
                  setError('');
                }}
                disabled={busy}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={busy}
                className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {busy ? 'Updating…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
