'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function ConfirmLoginInner() {
  const searchParams = useSearchParams();
  const confirmationUrl = searchParams.get('confirmation_url');
  const [clicked, setClicked] = useState(false);

  function handleClick() {
    if (!confirmationUrl) return;
    setClicked(true);
    // A real click, not an automated email scanner, so the one-time token
    // hasn't been consumed by a prefetch by the time we get here.
    window.location.href = confirmationUrl;
  }

  if (!confirmationUrl) {
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
        disabled={clicked}
        className="mt-6 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {clicked ? 'Signing you in…' : 'Click to sign in'}
      </button>
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
