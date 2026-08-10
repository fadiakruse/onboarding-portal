import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { requireManager, adminStorageClient } from '@/lib/admin-storage-auth';

async function listAllFiles(
  supabase: ReturnType<typeof adminStorageClient>,
  prefix: string
): Promise<string[]> {
  const { data, error } = await supabase.storage.from('new-hire-forms').list(prefix, { limit: 1000 });
  if (error || !data) return [];

  const paths: string[] = [];
  for (const entry of data) {
    if (entry.name === '.emptyFolderPlaceholder') continue;
    const fullPath = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      // Folder — recurse.
      const nested = await listAllFiles(supabase, fullPath);
      paths.push(...nested);
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

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
  const filePaths = await listAllFiles(supabase, path);

  if (filePaths.length === 0) {
    return NextResponse.json({ error: 'This folder is empty.' }, { status: 400 });
  }

  const zip = new JSZip();
  for (const filePath of filePaths) {
    const { data, error } = await supabase.storage.from('new-hire-forms').download(filePath);
    if (error || !data) continue;
    const relativePath = filePath.slice(path.length).replace(/^\/+/, '');
    const bytes = new Uint8Array(await data.arrayBuffer());
    zip.file(relativePath, bytes);
  }

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const folderName = path.split('/').filter(Boolean).pop() || 'download';

  // The type assertion here works around a known TypeScript typing mismatch
  // between @types/node's Uint8Array/Buffer generics and the DOM BodyInit
  // type in this project's config — the value itself is valid raw bytes at
  // runtime regardless of what the type checker infers.
  return new NextResponse(zipBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${folderName}.zip"`,
    },
  });
}
