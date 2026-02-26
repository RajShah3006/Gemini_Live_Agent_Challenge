"use client";

import { useCallback, useRef, useState } from "react";

interface ImageUploadProps {
  onUpload: (base64: string) => void;
  onCancel: () => void;
}

export function ImageUpload({ onUpload, onCancel }: ImageUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setPreview(result);
      };
      reader.readAsDataURL(file);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) processFile(file);
          break;
        }
      }
    },
    [processFile],
  );

  return (
    <div onPaste={handlePaste}>
      {!preview ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            isDragging
              ? "border-emerald-500 bg-emerald-900/20"
              : "border-gray-700 hover:border-gray-600"
          }`}
        >
          <div className="mb-2 text-2xl">📸</div>
          <p className="text-sm text-gray-400">
            Drop an image, paste from clipboard, or click to browse
          </p>
          <p className="mt-1 text-xs text-gray-600">
            JPG, PNG, HEIC supported
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) processFile(file);
            }}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <img
            src={preview}
            alt="Uploaded homework"
            className="max-h-48 w-full rounded-lg object-contain"
          />
          <div className="flex gap-2">
            <button
              onClick={() => onUpload(preview)}
              className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Send to Tutor
            </button>
            <button
              onClick={() => {
                setPreview(null);
                onCancel();
              }}
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-400 hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
