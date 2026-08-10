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

  if (employeeId === user.id) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Confirm the employee exists before doing anything destructive.
  const { data: employee, error: employeeFetchError } = await admin
    .from('profiles')
    .select('id, email, first_name, last_name')
    .eq('id', employeeId)
    .single();

  if (employeeFetchError || !employee) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  // 1. Collect and delete any uploaded PDF files for this employee.
  const { data: forms, error: formsFetchError } = await admin
    .from('employee_forms')
    .select('pdf_path')
    .eq('employee_id', employeeId);

  if (formsFetchError) {
    return NextResponse.json(
      { error: `Failed to look up employee's forms: ${formsFetchError.message}` },
      { status: 500 }
    );
  }

  const pdfPaths = (forms || [])
    .map((f) => f.pdf_path)
    .filter((p): p is string => Boolean(p));

  if (pdfPaths.length > 0) {
    const { error: storageError } = await admin.storage.from('new-hire-forms').remove(pdfPaths);
    if (storageError) {
      return NextResponse.json(
        { error: `Failed to delete uploaded files: ${storageError.message}` },
        { status: 500 }
      );
    }
  }

  // 2. Delete the employee_forms rows.
  const { error: formsDeleteError } = await admin
    .from('employee_forms')
    .delete()
    .eq('employee_id', employeeId);

  if (formsDeleteError) {
    return NextResponse.json(
      { error: `Failed to delete employee's form records: ${formsDeleteError.message}` },
      { status: 500 }
    );
  }

  // 3. Delete the profile row (must happen before deleting the auth user,
  // since profiles.id has a foreign key into auth.users).
  const { error: profileDeleteError } = await admin.from('profiles').delete().eq('id', employeeId);

  if (profileDeleteError) {
    return NextResponse.json(
      { error: `Failed to delete profile: ${profileDeleteError.message}` },
      { status: 500 }
    );
  }

  // 4. Delete the auth user itself. Any failure here (e.g. an invalid
  // service-role key) is surfaced as a real error instead of being swallowed.
  const { error: authDeleteError } = await admin.auth.admin.deleteUser(employeeId);

  if (authDeleteError) {
    console.error('Auth user delete failed', authDeleteError);
    return NextResponse.json(
      { error: `Failed to delete login access: ${authDeleteError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
