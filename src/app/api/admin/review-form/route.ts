import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getFormById } from '@/lib/forms-config';

async function sendRejectionEmail(opts: {
  to: string;
  employeeName: string;
  formTitle: string;
  managerName: string;
  comment: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set — skipping rejection email.');
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  const { to, employeeName, formTitle, managerName, comment } = opts;

  const html = `
    <h2>A form needs your attention</h2>
    <p>Hi ${employeeName || 'there'},</p>
    <p><strong>${formTitle}</strong> was reviewed by ${managerName} and needs some changes before it can be accepted:</p>
    <blockquote style="margin:16px 0;padding:12px 16px;background:#f5f5f5;border-left:4px solid #999;white-space:pre-wrap;">${comment}</blockquote>
    <p>Please log in to your onboarding portal to update and resubmit this form.</p>
    ${siteUrl ? `<p><a href="${siteUrl}">Sign in to Navesink Dermatology Onboarding</a></p>` : ''}
  `;

  const text = [
    `Hi ${employeeName || 'there'},`,
    '',
    `"${formTitle}" was reviewed by ${managerName} and needs some changes before it can be accepted:`,
    '',
    comment,
    '',
    'Please log in to your onboarding portal to update and resubmit this form.',
    siteUrl || '',
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Employee Onboarding <Onboarding@notifications.skincenternj.com>',
        to,
        subject: `Action needed: ${formTitle}`,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`Resend send failed (${res.status}): ${body}`);
      return { sent: false, error: `Resend responded with ${res.status}` };
    }

    return { sent: true };
  } catch (err: any) {
    console.error('Resend send threw an error:', err);
    return { sent: false, error: err?.message ?? 'Unknown error sending email' };
  }
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: myProfile } = await supabase
    .from('profiles')
    .select('role, full_name, first_name, last_name')
    .eq('id', user.id)
    .single();
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

  let emailResult: { sent: boolean; error?: string } = { sent: false };

  if (decision === 'rejected') {
    const { data: employeeProfile } = await admin
      .from('profiles')
      .select('email, full_name, first_name, last_name')
      .eq('id', employeeId)
      .single();

    if (employeeProfile?.email) {
      const formTitle = getFormById(formId)?.title ?? formId;
      const managerName =
        myProfile?.full_name ||
        [myProfile?.first_name, myProfile?.last_name].filter(Boolean).join(' ') ||
        'your manager';
      const employeeName =
        employeeProfile.full_name ||
        [employeeProfile.first_name, employeeProfile.last_name].filter(Boolean).join(' ') ||
        '';

      emailResult = await sendRejectionEmail({
        to: employeeProfile.email,
        employeeName,
        formTitle,
        managerName,
        comment: comment!.trim(),
      });
    } else {
      emailResult = { sent: false, error: 'Employee has no email on file' };
    }
  }

  return NextResponse.json({ success: true, emailSent: emailResult.sent, emailError: emailResult.error });
}
