import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const { email } = (await request.json()) as { email?: string };
  const normalizedEmail = (email || '').trim().toLowerCase();

  if (!normalizedEmail) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }

  // Only invited people (i.e. someone with an existing profiles row, created
  // either by an admin's "Invite Employee" action or by a prior login) can
  // request a link. Supabase's signInWithOtp would otherwise silently create
  // a brand-new account for any email typed in, which is exactly the gap
  // this closes.
  const admin = createAdminClient();
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (!existingProfile) {
    return NextResponse.json(
      { error: "We don't have an account for this email. Please ask your manager to invite you first." },
      { status: 403 }
    );
  }

  const supabase = createClient();
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: { emailRedirectTo: `${siteUrl}/auth/callback` },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
