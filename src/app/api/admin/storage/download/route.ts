import { NextRequest, NextResponse } from 'next/server';
import { requireManager, adminStorageClient } from '@/lib/admin-storage-auth';

export async function GET(request: NextRequest) {
  const auth = await requireManager();
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const path = request.nextUrl.searchParams.get('path');
  if (!path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const supabase = adminStorageClient();
  const { data, error } = await supabase.storage
    .from('new-hire-forms')
    .createSignedUrl(path, 300); // 5 minutes

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'Failed to sign URL' }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl });
}