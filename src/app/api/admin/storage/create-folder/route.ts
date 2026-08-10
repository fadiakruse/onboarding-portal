import { NextRequest, NextResponse } from 'next/server';
import { requireManager, adminStorageClient } from '@/lib/admin-storage-auth';

export async function POST(request: NextRequest) {
  const auth = await requireManager();
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { path, folderName } = (await request.json()) as { path?: string; folderName?: string };

  const trimmedName = (folderName || '').trim();
  if (!trimmedName) {
    return NextResponse.json({ error: 'Folder name is required.' }, { status: 400 });
  }
  if (trimmedName.includes('/') || trimmedName.includes('\\')) {
    return NextResponse.json({ error: 'Folder name cannot contain slashes.' }, { status: 400 });
  }

  const supabase = adminStorageClient();
  const basePath = path ? path.replace(/\/+$/, '') : '';
  // Supabase Storage has no real folders — a folder only "exists" once it
  // contains at least one object. We upload an empty placeholder, the same
  // convention the list route already filters out of the displayed results.
  const placeholderPath = `${basePath}/${trimmedName}/.emptyFolderPlaceholder`;

  const { error } = await supabase.storage
    .from('new-hire-forms')
    .upload(placeholderPath, new Blob([]), { upsert: false });

  if (error) {
    if (error.message?.toLowerCase().includes('already exists')) {
      return NextResponse.json({ error: 'A folder with that name already exists here.' }, { status: 409 });
    }
    return NextResponse.json({ error: `Failed to create folder: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
