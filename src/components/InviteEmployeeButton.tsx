'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function InviteEmployeeButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');

  function resetAndClose() {
    setOpen(false);
    setFirstName('');
    setLastName('');
    setEmail('');
    setError('');
  }

  async function handleSubmit() {
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/admin/invite-employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Could not invite this employee.');
      }
      resetAndClose();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700"
      >
        + Invite Employee
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-gray-900">Invite a new employee</h2>
            <p className="mt-1 text-xs text-gray-500">
              This creates their account and immediately emails them a login link.
            </p>

            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={sending}
                  className="w-1/2 rounded border border-gray-300 px-2 py-1.5 text-sm disabled:opacity-60"
                />
                <input
                  type="text"
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={sending}
                  className="w-1/2 rounded border border-gray-300 px-2 py-1.5 text-sm disabled:opacity-60"
                />
              </div>
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sending}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:opacity-60"
              />
            </div>

            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={resetAndClose}
                disabled={sending}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={sending || !firstName || !lastName || !email}
                className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {sending ? 'Sending…' : 'Send invite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
