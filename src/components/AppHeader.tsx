'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface AppHeaderProps {
  practiceName: string;
  isManager: boolean;
}

export default function AppHeader({ practiceName, isManager }: AppHeaderProps) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt={practiceName} className="h-9 w-auto" />
        </Link>
        <div className="flex items-center gap-4 text-xs">
          {isManager && (
            <>
              <Link href="/dashboard" className="text-gray-500 hover:text-gray-800">
                My Forms
              </Link>
              <Link href="/admin" className="text-gray-500 hover:text-gray-800">
                Manager View
              </Link>
            </>
          )}
          <button onClick={handleSignOut} className="text-gray-500 hover:text-gray-800">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
