'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface StorageItem {
  name: string;
  isFolder: boolean;
  size: number | null;
  updatedAt: string | null;
}

function formatSize(bytes: number | null) {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Folders first, then files, both alphabetical (case-insensitive) within
// their group. Applied on the client so display order is guaranteed
// regardless of what the storage API happens to return.
function sortItems(items: StorageItem[]): StorageItem[] {
  return [...items].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

const ROOT_FOLDER = 'Employee Files';

export default function EmployeeFilesPage() {
  const [path, setPath] = useState(ROOT_FOLDER);  
  const [items, setItems] = useState<StorageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [zippingFolder, setZippingFolder] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const relativePath = path.startsWith(ROOT_FOLDER) ? path.slice(ROOT_FOLDER.length).replace(/^\//, '') : path;
  const segments = relativePath ? relativePath.split('/') : [];
  
  const load = useCallback(async (targetPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/storage/list?path=${encodeURIComponent(targetPath)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load folder');
      setItems(sortItems(data.items));
    } catch (err: any) {
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(path);
  }, [path, load]);

  const openFolder = (name: string) => setPath(path ? `${path}/${name}` : name);
  const goToBreadcrumb = (index: number) => setPath(`${ROOT_FOLDER}/${segments.slice(0, index + 1).join('/')}`);
  const goToRoot = () => setPath(ROOT_FOLDER);

  const openInNewTab = async (url: string, tab: Window | null) => {
    if (tab) {
      tab.location.href = url;
    } else {
      window.location.href = url;
    }
  };

  const viewFile = async (name: string) => {
    const tab = window.open('', '_blank');
    const fullPath = path ? `${path}/${name}` : name;
    const res = await fetch(`/api/admin/storage/download?path=${encodeURIComponent(fullPath)}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to generate a view link');
      tab?.close();
      return;
    }
    openInNewTab(data.url, tab);
  };

  const downloadFile = async (name: string) => {
    const tab = window.open('', '_blank');
    const fullPath = path ? `${path}/${name}` : name;
    const res = await fetch(`/api/admin/storage/download?path=${encodeURIComponent(fullPath)}&download=true`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to generate a download link');
      tab?.close();
      return;
    }
    openInNewTab(data.url, tab);
  };

  const downloadFolder = async (name: string) => {
    const fullPath = path ? `${path}/${name}` : name;
    setZippingFolder(name);
    setError(null);
    try {
      // Zipping happens server-side and can take a moment for larger
      // folders, so we navigate directly rather than pre-opening a blank
      // tab — the browser's download prompt appears once the zip is ready.
      window.location.href = `/api/admin/storage/download-zip?path=${encodeURIComponent(fullPath)}`;
    } finally {
      setZippingFolder(null);
    }
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', path);
      const res = await fetch('/api/admin/storage/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      await load(path);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    setCreatingFolder(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/storage/create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, folderName: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create folder');
      setNewFolderOpen(false);
      setNewFolderName('');
      await load(path);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreatingFolder(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Employee Files</h1>
        <a href="/admin" className="text-sm text-blue-600 hover:underline">&larr; Back to Dashboard</a>
      </div>

      <nav className="flex items-center flex-wrap gap-1 text-sm mb-4 text-gray-600">
      <button onClick={goToRoot} className="hover:underline text-blue-600">All Employees</button>        
      
      {segments.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <span>/</span>
            <button onClick={() => goToBreadcrumb(i)} className="hover:underline text-blue-600">{seg}</button>
          </span>
        ))}
      </nav>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-500">
          {loading ? 'Loading…' : `${items.length} item${items.length === 1 ? '' : 's'}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setNewFolderOpen(true)}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            New Folder
          </button>
          <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" />
          <button
            onClick={handleUploadClick}
            disabled={uploading}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload File Here'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 text-sm rounded-md bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {newFolderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-gray-900">New folder</h2>
            <input
              type="text"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              placeholder="Folder name"
              disabled={creatingFolder}
              className="mt-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:opacity-60"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setNewFolderOpen(false);
                  setNewFolderName('');
                  setError(null);
                }}
                disabled={creatingFolder}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={creatingFolder || !newFolderName.trim()}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {creatingFolder ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="border rounded-lg divide-y bg-white">
        {!loading && items.length === 0 && (
          <div className="px-4 py-6 text-sm text-gray-400 text-center">This folder is empty.</div>
        )}
        {items.map((item) => (
          <div key={item.name} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
            <button
              onClick={() => (item.isFolder ? openFolder(item.name) : undefined)}
              className={`flex items-center gap-2 text-sm ${item.isFolder ? 'text-gray-800 font-medium cursor-pointer' : 'text-gray-700'}`}
              disabled={!item.isFolder}
            >
              <span>{item.isFolder ? '📁' : '📄'}</span>
              <span>{item.name}</span>
            </button>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              {!item.isFolder && <span>{formatSize(item.size)}</span>}
              {!item.isFolder && (
                <>
                  <button onClick={() => viewFile(item.name)} className="text-blue-600 hover:underline text-xs font-medium">
                    View
                  </button>
                  <button onClick={() => downloadFile(item.name)} className="text-blue-600 hover:underline text-xs font-medium">
                    Download
                  </button>
                </>
              )}
              {item.isFolder && (
                <button
                  onClick={() => downloadFolder(item.name)}
                  disabled={zippingFolder === item.name}
                  className="text-blue-600 hover:underline text-xs font-medium disabled:opacity-50"
                >
                  {zippingFolder === item.name ? 'Zipping…' : 'Download'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
