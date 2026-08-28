import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { FORMS } from '@/lib/forms-config';
import { sanitizeFolderSegment } from '@/lib/formatters';
import ReviewFormButtons from '@/components/ReviewFormButtons';
import MarkAllCompleteButton from '@/components/MarkAllCompleteButton';

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

  // Same folder convention used when forms are generated/saved in
  // submit-form/route.ts: "Employee Files/{Last}, {First}/Onboarding Forms".
  const folderLast = sanitizeFolderSegment(employee.last_name || '') || 'Employee';
  const folderFirst = sanitizeFolderSegment(employee.first_name || '') || 'Unknown';
  const onboardingFormsPath = `Employee Files/${folderLast}, ${folderFirst}/Onboarding Forms`;
  const zipDownloadHref = `/api/admin/storage/download-zip?path=${encodeURIComponent(onboardingFormsPath)}&filename=${encodeURIComponent(`${employeeDisplayName} - Onboarding Forms`)}`;

  const { data: formRows } = await supabase
    .from('employee_forms')
    .select('form_id, status, pdf_path, completed_at, review_status, review_comment, manager_marked_complete')
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
      <div className="flex items-center justify-between">
        <Link href="/admin" className="text-xs text-gray-400 hover:text-gray-600">
          ← All employees
        </Link>
        <div className="flex items-center gap-2">
          <a
            href={zipDownloadHref}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Download all forms (ZIP)
          </a>
          <MarkAllCompleteButton employeeId={employee.id} employeeLabel={employeeDisplayName} />
        </div>
      </div>

      <h1 className="mt-3 text-xl font-semibold text-gray-900">{employeeDisplayName}</h1>
      <p className="text-sm text-gray-500">{employee.email}</p>

      <ol className="mt-6 space-y-2">
        {FORMS.map((form) => {
          const record = statusMap.get(form.id);
          const isCompleted = record?.status === 'completed';
          const url = signedUrls.get(form.id);
          const isManagerOverride = !!record?.manager_marked_complete;
          const reviewStatus = (record?.review_status ?? null) as 'pending' | 'accepted' | 'rejected' | null;

          return (
            <li
              key={form.id}
              className={`rounded-lg border px-4 py-3 ${
                isCompleted ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between">
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
                        {isManagerOverride ? 'Marked complete' : 'Completed'}{' '}
                        {new Date(record.completed_at).toLocaleDateString()}
                      </p>
                    )}
                    {reviewStatus === 'accepted' && <p className="text-xs font-medium text-green-700">Accepted</p>}
                    {reviewStatus === 'rejected' && (
                      <p className="text-xs font-medium text-red-700">Rejected — awaiting resubmission</p>
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
                ) : isManagerOverride ? (
                  <span className="text-xs text-gray-400">Marked complete by manager</span>
                ) : (
                  <span className="text-xs text-gray-400">Not yet submitted</span>
                )}
              </div>

              {url && !isManagerOverride && (
                <ReviewFormButtons employeeId={employee.id} formId={form.id} reviewStatus={reviewStatus} />
              )}

              {record?.review_comment && (
                <p className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">
                  <span className="font-medium">Your note to employee:</span> {record.review_comment}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
