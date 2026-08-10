import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { FORMS } from '@/lib/forms-config';

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

  const { employeeId } = (await request.json()) as { employeeId?: string };
  if (!employeeId) return NextResponse.json({ error: 'Missing employeeId.' }, { status: 400 });

  const admin = createAdminClient();

  const { data: existingRows } = await admin
    .from('employee_forms')
    .select('form_id, status')
    .eq('employee_id', employeeId);

  const existingIds = new Set((existingRows ?? []).map((r) => r.form_id));
  const now = new Date().toISOString();

  // Create rows for any forms the employee never even started.
  const missing = FORMS.filter((f) => !existingIds.has(f.id));
  if (missing.length > 0) {
    const { error: insertError } = await admin.from('employee_forms').insert(
      missing.map((f) => ({
        employee_id: employeeId,
        form_id: f.id,
        form_order: f.order,
        status: 'completed',
        manager_marked_complete: true,
        completed_at: now,
      }))
    );
    if (insertError) {
      return NextResponse.json({ error: `Failed to create form records: ${insertError.message}` }, { status: 500 });
    }
  }

  // Force-complete anything not already completed.
  const { error } = await admin
    .from('employee_forms')
    .update({ status: 'completed', manager_marked_complete: true, completed_at: now })
    .eq('employee_id', employeeId)
    .neq('status', 'completed');

  if (error) {
    return NextResponse.json({ error: `Failed to mark forms complete: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
