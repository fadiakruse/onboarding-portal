'use client';

import { useState } from 'react';

export default function ResendLinkButton({ employeeId }: { employeeId: string }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleClick() {
    setStatus('sending');
    setErrorMsg('');
    try {
      const res = await fetch('/api/admin/resend-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Could not resend the link.');
      }
      setStatus('sent');
      setTimeout(() => setStatus('idle'), 4000);
    } catch (err: any) {
      setErrorMsg(err.message);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 4000);
    }
  }

  return (
    <div className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === 'sending'}
        className="text-xs font-medium text-red-600 hover:underline"
      >
        {status === 'sending' ? 'Sending…' : status === 'sent' ? 'Link sent ✓' : 'Resend link'}
      </button>
    </div>
  );
}
