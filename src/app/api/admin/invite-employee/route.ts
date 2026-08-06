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

  const { firstName, lastName, email, asManager } = (await request.json()) as {
    firstName?: string;
    lastName?: string;
    email?: string;
    asManager?: boolean;
  };

  if (!firstName || !lastName || !email) {
    return NextResponse.json({ error: 'First name, last name, and email are all required.' }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const fullName = `${firstName} ${lastName}`.trim();

  const admin = createAdminClient();

  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existingProfile) {
    return NextResponse.json(
      { error: 'This person already exists. Use "Resend link" or promote/demote their role instead.' },
      { status: 409 }
    );
  }

  // Creating the auth user fires the on_auth_user_created -> handle_new_user()
  // trigger, which inserts the matching profiles row (email, full_name, role='employee').
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError || !created?.user) {
    return NextResponse.json(
      { error: `Failed to create account: ${createError?.message || 'Unknown error'}` },
      { status: 500 }
    );
  }

  // The trigger only sets full_name and defaults role to 'employee', so fill in
  // first/last name here, and upgrade to manager if requested.
  const { error: updateError } = await admin
    .from('profiles')
    .update({
      first_name: firstName,
      last_name: lastName,
      ...(asManager ? { role: 'manager' } : {}),
    })
    .eq('id', created.user.id);

  if (updateError) {
    return NextResponse.json(
      { error: `Account created, but failed to save details: ${updateError.message}` },
      { status: 500 }
    );
  }

  // Send the actual magic-link invite email.
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  const { error: otpError } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback`,
    },
  });

  if (otpError) {
    console.error('Invite email send failed', otpError);
    return NextResponse.json(
      { error: `Account created, but the invite email failed to send: ${otpError.message}` },
      { status: 500 }
    );
  }

  await admin.from('invite_log').insert({ email: normalizedEmail });

  return NextResponse.json({ success: true });
}
