'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UpdateRoleButton({
  employeeId,
  employeeLabel,
  newRole,
  label,
}: {
  employeeId: string;
  employeeLabel: string;
  newRole: 'manager' | 'employee';
  label: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/update-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, newRole }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Could not update this role.');
      }
      setConfirming(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const actionText =
    newRole === 'manager'
      ? `Give ${employeeLabel} manager access?`
      : `Remove manager access from ${employeeLabel}?`;

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="text-xs font-medium text-gray-500 hover:underline"
      >
        {label}
      </button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <p className="text-sm text-gray-800">{actionText}</p>
            {newRole === 'manager' && (
              <p className="mt-2 text-xs text-amber-600">
                This grants full access to the Manager Dashboard, including deleting employees and managing
                other administrators.
              </p>
            )}
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
