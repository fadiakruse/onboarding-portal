'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ReviewFormButtons({
  employeeId,
  formId,
  reviewStatus,
}: {
  employeeId: string;
  formId: string;
  reviewStatus: 'pending' | 'accepted' | 'rejected' | null;
}) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(decision: 'accepted' | 'rejected') {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/review-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId,
          formId,
          decision,
          comment: decision === 'rejected' ? comment : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save this review.');
      setRejecting(false);
      setComment('');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => submit('accepted')}
          disabled={busy}
          className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-60 ${
            reviewStatus === 'accepted'
              ? 'bg-green-600 text-white'
              : 'border border-green-300 text-green-700 hover:bg-green-50'
          }`}
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => setRejecting(true)}
          disabled={busy}
          className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-60 ${
            reviewStatus === 'rejected'
              ? 'bg-red-600 text-white'
              : 'border border-red-300 text-red-700 hover:bg-red-50'
          }`}
        >
          Reject
        </button>
      </div>

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-gray-900">What needs to be fixed?</h2>
            <p className="mt-1 text-xs text-gray-500">This is shown to the employee when they log back in.</p>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder="e.g. Routing number doesn't match the voided check you uploaded."
              className="mt-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setRejecting(false);
                  setError('');
                }}
                disabled={busy}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => submit('rejected')}
                disabled={busy || !comment.trim()}
                className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {busy ? 'Sending…' : 'Reject & Notify'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
