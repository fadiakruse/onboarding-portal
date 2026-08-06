'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DeleteEmployeeButton({
  employeeId,
  employeeLabel,
}: {
  employeeId: string;
  employeeLabel: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function handleDelete() {
    setDeleting(true);
    setError('');
    try {
      const res = await fetch('/api/admin/delete-employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Could not delete this employee.');
      }
      setConfirming(false);
      setDeleting(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="text-xs font-medium text-red-600 hover:underline"
      >
        Delete
      </button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <p className="text-sm text-gray-800">
              Delete <strong>{employeeLabel}</strong>? This permanently removes their
              onboarding data, uploaded files, and login access.
            </p>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setConfirming(false);
                  setError('');
                }}
                disabled={deleting}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
