import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { FORMS, TOTAL_FORMS } from '@/lib/forms-config';

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: existing } = await supabase
    .from('employee_forms')
    .select('form_id, status')
    .eq('employee_id', user.id);

  const existingIds = new Set((existing ?? []).map((r) => r.form_id));
  const missing = FORMS.filter((f) => !existingIds.has(f.id));

  if (missing.length > 0) {
    await supabase.from('employee_forms').insert(
      missing.map((f) => ({
        employee_id: user.id,
        form_id: f.id,
        form_order: f.order,
        status: 'not_started',
      }))
    );
  }

  const { data: statusRows } = await supabase
    .from('employee_forms')
    .select('form_id, status, completed_at')
    .eq('employee_id', user.id)
    .order('form_order', { ascending: true });

  const statusMap = new Map((statusRows ?? []).map((r) => [r.form_id, r]));

  // Forms get removed/reorganized over time (e.g. W-4/I-9/Direct Deposit were
  // removed from the flow). If this employee completed any of those before
  // they were removed, the old 'completed' row is still sitting in
  // employee_forms — without this filter it would inflate completedCount
  // past TOTAL_FORMS (e.g. "13 of 10 forms completed" and "allDone" never
  // becoming true even though every current form is done).
  const currentFormIds = new Set(FORMS.map((f) => f.id));
  const completedCount = (statusRows ?? []).filter(
    (r) => r.status === 'completed' && currentFormIds.has(r.form_id)
  ).length;
  const allDone = completedCount === TOTAL_FORMS;

  const form1 = FORMS[0];
  const form1Completed = statusMap.get(form1.id)?.status === 'completed';

  const practiceName = process.env.NEXT_PUBLIC_PRACTICE_NAME || 'Your Practice';

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8">
        <p className="text-sm text-gray-500">{practiceName}</p>
        <h1 className="text-2xl font-semibold text-gray-900">Your Onboarding Checklist</h1>
        <p className="mt-1 text-sm text-gray-500">
          {completedCount} of {TOTAL_FORMS} forms completed
        </p>
        <div className="mt-3 h-2 w-full rounded-full bg-gray-200">
          <div
            className="h-2 rounded-full bg-brand-600 transition-all"
            style={{ width: `${(completedCount / TOTAL_FORMS) * 100}%` }}
          />
        </div>
        {form1Completed && !allDone && (
          <p className="mt-2 text-xs text-gray-400">
            All forms are now unlocked — complete them in any order you like.
          </p>
        )}
      </div>

      {allDone && (
        <div className="mb-6 rounded-lg bg-green-50 p-4 text-sm text-green-800">
          🎉 You've completed all onboarding forms. HR has been notified. Thank you!
        </div>
      )}

      <ol className="space-y-2">
        {FORMS.map((form) => {
          const record = statusMap.get(form.id);
          const isCompleted = record?.status === 'completed';
          const isAccessible = form.order === 1 || form1Completed;
          const isLocked = !isCompleted && !isAccessible;

          return (
            <li
              key={form.id}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                isCompleted
                  ? 'border-green-200 bg-green-50'
                  : isAccessible
                  ? 'border-gray-200 bg-white shadow-sm'
                  : 'border-gray-200 bg-gray-50 opacity-60'
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                    isCompleted
                      ? 'bg-green-600 text-white'
                      : isAccessible
                      ? 'bg-brand-600 text-white'
                      : 'bg-gray-300 text-gray-600'
                  }`}
                >
                  {isCompleted ? '✓' : form.order}
                </span>
                <span className="text-sm font-medium text-gray-800">{form.shortTitle}</span>
              </div>

              {isLocked ? (
                <span className="text-xs text-gray-400">Locked</span>
              ) : isCompleted ? (
                <span className="text-xs text-green-700">Completed</span>
              ) : (
                <Link
                  href={`/dashboard/${form.id}`}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                >
                  Start
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
