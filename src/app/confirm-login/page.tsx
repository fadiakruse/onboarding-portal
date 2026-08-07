'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

function ConfirmLoginInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tokenHash = searchParams.get('token_hash');
  const [status, setStatus] = useState<'idle' | 'verifying' | 'error'>('idle');
  const [error, setError] = useState('');

  async function handleClick() {
    if (!tokenHash) return;
    setStatus('verifying');
    setError('');

    const supabase = createClient();
    // token_hash + verifyOtp has no browser-affinity requirement, unlike the
    // PKCE code exchange — this works correctly even when the link was
    // requested from a different browser/device (e.g. a manager sending an
    // invite or resend link on someone else's behalf).
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });

    if (error) {
      setError(error.message);
      setStatus('error');
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  if (!tokenHash) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16 text-center">
        <p className="text-sm text-gray-600">
          This link is missing information and can&rsquo;t be used to sign in. Please request a new link.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-gray-900">Sign in</h1>
      <p className="mt-2 text-sm text-gray-500">
        Click below to finish signing in. This extra step confirms it&rsquo;s really you, not an automated
        email security scan.
      </p>
      <button
        onClick={handleClick}
        disabled={status === 'verifying'}
        className="mt-6 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {status === 'verifying' ? 'Signing you in…' : 'Click to sign in'}
      </button>
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function ConfirmLoginPage() {
  return (
    <Suspense
      fallback={<div className="mx-auto max-w-sm px-4 py-16 text-center text-sm text-gray-400">Loading…</div>}
    >
      <ConfirmLoginInner />
    </Suspense>
  );
}
