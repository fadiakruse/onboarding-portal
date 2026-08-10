'use client';

import { useRef, useState } from 'react';

interface FileUploadProps {
  label: string;
  accept?: string;
  value: { name: string; dataUrl: string } | null;
  onChange: (file: { name: string; dataUrl: string } | null) => void;
}

export default function FileUpload({ label, accept, value, onChange }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError('');
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setError('File is too large (max 8MB).'); return; }
    const reader = new FileReader();
    reader.onload = () => { onChange({ name: file.name, dataUrl: reader.result as string }); };
    reader.onerror = () => setError('Could not read that file. Please try again.');
    reader.readAsDataURL(file);
  }

  function handleClear() {
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <label className="cursor-pointer rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          {value ? 'Replace file' : 'Choose file'}
          <input ref={inputRef} type="file" accept={accept} onChange={handleFile} className="hidden" />
        </label>
        {value && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="truncate max-w-[220px]">{value.name}</span>
            <button type="button" onClick={handleClear} className="text-xs font-medium text-red-600 hover:underline">Remove</button>
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
