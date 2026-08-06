import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: myProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (myProfile?.role !== 'manager') {
    return NextResponse.json({ error: 'Only managers can do this.' }, { status: 403 });
  }

  const { employeeId } = (await request.json()) as { employeeId: string };
  if (!employeeId) {
    return NextResponse.json({ error: 'Missing employeeId.' }, { status: 400 });
  }

  const { data: employee } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', employeeId)
    .single();

  if (!employee?.email) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');

  const { error } = await supabase.auth.signInWithOtp({
    email: employee.email,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback`,
    },
  });

  if (error) {
    console.error('Resend link failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const normalizedEmail = employee.email.trim().toLowerCase();
  const admin = createAdminClient();
  const { data: existingLog } = await admin
    .from('invite_log')
    .select('email')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existingLog) {
    await admin
      .from('invite_log')
      .update({ last_sent_at: new Date().toISOString() })
      .eq('email', normalizedEmail);
  } else {
    await admin.from('invite_log').insert({ email: normalizedEmail });
  }

  return NextResponse.json({ success: true });
}
