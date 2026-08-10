import { NextRequest, NextResponse } from 'next/server';
import { requireManager, adminStorageClient } from '@/lib/admin-storage-auth';

export async function POST(request: NextRequest) {
  const auth = await requireManager();
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const path = formData.get('path');

  if (!file || typeof path !== 'string') {
    return NextResponse.json({ error: 'Missing file or path' }, { status: 400 });
  }

  const fullPath = path ? `${path}/${file.name}` : file.name;
  const arrayBuffer = await file.arrayBuffer();

  const supabase = adminStorageClient();
  const { error } = await supabase.storage
    .from('new-hire-forms')
    .upload(fullPath, Buffer.from(arrayBuffer), {
      contentType: file.type || 'application/octet-stream',
      upsert: true,
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, path: fullPath });
}