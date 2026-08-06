import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { FORMS } from '@/lib/forms-config';

export default async function EmployeeDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: myProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (myProfile?.role !== 'manager') redirect('/dashboard');

  const { data: employee } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, full_name, email')
    .eq('id', params.id)
    .single();
  if (!employee) notFound();

  const employeeDisplayName =
    [employee.first_name, employee.last_name].filter(Boolean).join(' ') || employee.full_name || employee.email;

  const { data: formRows } = await supabase
    .from('employee_forms')
    .select('form_id, status, pdf_path, completed_at')
    .eq('employee_id', params.id)
    .order('form_order', { ascending: true });

  const statusMap = new Map((formRows ?? []).map((r) => [r.form_id, r]));

  const signedUrls = new Map<string, string>();
  for (const row of formRows ?? []) {
    if (row.pdf_path) {
      const { data } = await supabase.storage
        .from('new-hire-forms')
        .createSignedUrl(row.pdf_path, 60 * 60);
      if (data?.signedUrl) signedUrls.set(row.form_id, data.signedUrl);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin" className="text-xs text-gray-400 hover:text-gray-600">
        ← All employees
      </Link>

      <h1 className="mt-3 text-xl font-semibold text-gray-900">
        {employeeDisplayName}
      </h1>
      <p className="text-sm text-gray-500">{employee.email}</p>

      <ol className="mt-6 space-y-2">
        {FORMS.map((form) => {
          const record = statusMap.get(form.id);
          const isCompleted = record?.status === 'completed';
          const url = signedUrls.get(form.id);

          return (
            <li
              key={form.id}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                isCompleted ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                    isCompleted ? 'bg-green-600 text-white' : 'bg-gray-300 text-gray-600'
                  }`}
                >
                  {isCompleted ? '✓' : form.order}
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-800">{form.shortTitle}</p>
                  {record?.completed_at && (
                    <p className="text-xs text-gray-400">
                      Completed {new Date(record.completed_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>

              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                >
                  View PDF
                </a>
              ) : (
                <span className="text-xs text-gray-400">Not yet submitted</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
