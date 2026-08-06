import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'Invalid email' }, { status: 400 });

  const admin = createAdminClient();
  const { data: existing } = await admin.from('invite_log').select('email').eq('email', email).maybeSingle();
  if (existing) {
    await admin.from('invite_log').update({ last_sent_at: new Date().toISOString() }).eq('email', email);
  } else {
    await admin.from('invite_log').insert({ email });
  }
  return NextResponse.json({ success: true });
}
