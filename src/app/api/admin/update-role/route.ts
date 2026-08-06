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

  const { employeeId, newRole } = (await request.json()) as {
    employeeId?: string;
    newRole?: 'manager' | 'employee';
  };

  if (!employeeId || !newRole || !['manager', 'employee'].includes(newRole)) {
    return NextResponse.json({ error: 'A valid employeeId and newRole are required.' }, { status: 400 });
  }

  if (employeeId === user.id) {
    return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', employeeId)
    .single();

  if (targetError || !target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  const { error: updateError } = await admin.from('profiles').update({ role: newRole }).eq('id', employeeId);

  if (updateError) {
    return NextResponse.json({ error: `Failed to update role: ${updateError.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
