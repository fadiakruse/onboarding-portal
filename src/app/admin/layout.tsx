import { createClient } from '@/lib/supabase/server';
import AppHeader from '@/components/AppHeader';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isManager = false;
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    isManager = profile?.role === 'manager';
  }

  const practiceName = process.env.NEXT_PUBLIC_PRACTICE_NAME || 'Your Practice';

  return (
    <>
      <AppHeader practiceName={practiceName} isManager={isManager} />
      {children}
    </>
  );
}
