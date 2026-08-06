import { NextRequest, NextResponse } from 'next/server';
import { requireManager, adminStorageClient } from '@/lib/admin-storage-auth';

export async function GET(request: NextRequest) {
  const auth = await requireManager();
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const path = request.nextUrl.searchParams.get('path') || '';
  const supabase = adminStorageClient();

  const { data, error } = await supabase.storage
    .from('new-hire-forms')
    .list(path, { limit: 200, sortBy: { column: 'name', order: 'asc' } });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data || [])
    .filter((item) => item.name !== '.emptyFolderPlaceholder')
    .map((item) => ({
      name: item.name,
      isFolder: item.id === null,
      size: item.metadata?.size ?? null,
      updatedAt: item.updated_at ?? item.created_at ?? null,
    }));

  return NextResponse.json({ path, items });
}