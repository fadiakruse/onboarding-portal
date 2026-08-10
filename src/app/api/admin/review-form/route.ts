import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: myProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (myProfile?.role !== 'manager') {
    return NextResponse.json({ error: 'Only managers can do this.' }, { status: 403 });
  }

  const { employeeId, formId, decision, comment } = (await request.json()) as {
    employeeId?: string;
    formId?: string;
    decision?: 'accepted' | 'rejected';
    comment?: string;
  };

  if (!employeeId || !formId || !decision || !['accepted', 'rejected'].includes(decision)) {
    return NextResponse.json({ error: 'A valid employeeId, formId, and decision are required.' }, { status: 400 });
  }
  if (decision === 'rejected' && !comment?.trim()) {
    return NextResponse.json({ error: 'Please explain what information is needed.' }, { status: 400 });
  }

  const admin = createAdminClient();

  const updates: Record<string, any> = {
    review_status: decision,
    review_comment: decision === 'rejected' ? comment!.trim() : null,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  };

  if (decision === 'rejected') {
    // Send it back to the employee — status reverts so it shows as
    // incomplete again on their checklist. Prior answers and the PDF are
    // left in place so the manager can still reference them, and so the
    // employee's form pre-fills with what they already entered.
    updates.status = 'not_started';
    updates.completed_at = null;
  }

  const { error } = await admin
    .from('employee_forms')
    .update(updates)
    .eq('employee_id', employeeId)
    .eq('form_id', formId);

  if (error) {
    return NextResponse.json({ error: `Failed to save review: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
