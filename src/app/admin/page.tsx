import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { TOTAL_FORMS } from '@/lib/forms-config';
import DeleteEmployeeButton from '@/components/DeleteEmployeeButton';

export default async function AdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: myProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (myProfile?.role !== 'manager') {
    redirect('/dashboard');
  }

  const { data: employees } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, full_name, email, created_at')
    .eq('role', 'employee')
    .order('created_at', { ascending: false });

  const { data: allForms } = await supabase.from('employee_forms').select('employee_id, status');
  const { data: inviteLogRows } = await supabase.from('invite_log').select('email, first_sent_at');

  const inviteByEmail = new Map((inviteLogRows ?? []).map((r) => [r.email.toLowerCase(), r.first_sent_at]));

  const completionByEmployee = new Map<string, number>();
  for (const row of allForms ?? []) {
    if (row.status === 'completed') {
      completionByEmployee.set(row.employee_id, (completionByEmployee.get(row.employee_id) || 0) + 1);
    }
  }

  const practiceName = process.env.NEXT_PUBLIC_PRACTICE_NAME || 'Your Practice';

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <p className="text-sm text-gray-500">{practiceName}</p>
      <h1 className="text-2xl font-semibold text-gray-900">Manager Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Onboarding progress for {employees?.length ?? 0} employees</p>

      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Employee Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Date Sent</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Progress</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(employees ?? []).map((emp) => {
              const completed = completionByEmployee.get(emp.id) || 0;
              const isDone = completed === TOTAL_FORMS;
              const dateSent = emp.email ? inviteByEmail.get(emp.email.toLowerCase()) : null;
              const displayName =
                [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.full_name || '—';

              return (
                <tr key={emp.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{displayName}</td>
                  <td className="px-4 py-3 text-gray-600">{emp.email}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {dateSent ? new Date(dateSent).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-28 rounded-full bg-gray-200">
                        <div
                          className={`h-1.5 rounded-full ${isDone ? 'bg-green-600' : 'bg-brand-600'}`}
                          style={{ width: `${(completed / TOTAL_FORMS) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">
                        {completed}/{TOTAL_FORMS}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {isDone ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Complete
                      </span>
                    ) : completed === 0 ? (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        Not started
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        In progress
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/admin/employee/${emp.id}`}
                        className="text-xs font-medium text-brand-600 hover:underline"
                      >
                        View details →
                      </Link>
                      <Link
                        href="/admin/files"
                        className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:underline"
                        >
                        📁 View Employee Files
                      </Link>
                      <DeleteEmployeeButton employeeId={emp.id} employeeLabel={displayName} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {(employees ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                  No employees have logged in yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
