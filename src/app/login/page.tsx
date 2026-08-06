'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const practiceName = process.env.NEXT_PUBLIC_PRACTICE_NAME || 'Your Practice';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setErrorMsg('');

    const supabase = createClient();
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${siteUrl}/auth/callback` } });

    if (error) {
      setStatus('error');
      setErrorMsg(error.message);
    } else {
      setStatus('sent');
      fetch('/api/track-invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }).catch(() => {});
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm border border-gray-100">
        <h1 className="text-xl font-semibold text-gray-900">{practiceName}</h1>
        <p className="mt-1 text-sm text-gray-500">New Hire Onboarding Portal</p>
        {status === 'sent' ? (
          <div className="mt-6 rounded-lg bg-brand-50 p-4 text-sm text-brand-700">
            Check <strong>{email}</strong> for a secure sign-in link. It expires shortly, so open it soon. You can close this tab.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">Work or personal email</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
            </div>
            {status === 'error' && <p className="text-sm text-red-600">{errorMsg}</p>}
            <button type="submit" disabled={status === 'sending'}
              className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {status === 'sending' ? 'Sending link…' : 'Email me a sign-in link'}
            </button>
            <p className="text-xs text-gray-400">No password needed. We'll email you a secure one-time link to start or continue your onboarding forms.</p>
          </form>
        )}
      </div>
    </div>
  );
}
