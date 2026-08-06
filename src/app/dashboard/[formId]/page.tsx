import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { FORMS, getFormById, buildProfile } from '@/lib/forms-config';
import FormWizard from './FormWizard';

export default async function FormPage({ params }: { params: { formId: string } }) {
  const form = getFormById(params.formId);
  if (!form) notFound();

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: statusRows } = await supabase
    .from('employee_forms')
    .select('form_id, status, answers')
    .eq('employee_id', user.id);

  const statusMap = new Map((statusRows ?? []).map((r) => [r.form_id, r]));

  const form1 = FORMS[0];
  const form1Completed = statusMap.get(form1.id)?.status === 'completed';
  if (form.order !== 1 && !form1Completed) {
    redirect('/dashboard');
  }

  const existing = statusMap.get(form.id);
  const alreadyCompleted = existing?.status === 'completed';

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', user.id)
    .single();

  const profile = buildProfile(statusMap.get(form1.id)?.answers);

  return (
    <FormWizard
      form={form}
      existingAnswers={existing?.answers ?? {}}
      alreadyCompleted={alreadyCompleted}
      employeeName={profileRow?.full_name || profileRow?.email || 'Employee'}
      profile={profile}
    />
  );
}
