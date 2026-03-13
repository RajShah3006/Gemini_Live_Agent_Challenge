"use client";

import { useCallback, useRef, useState } from "react";
import { extractImageFileFromClipboard, readImageFileAsDataUrl } from "@/lib/imageUpload";

interface ImageUploadProps {
  onUpload: (base64: string) => void;
  onCancel: () => void;
}

export function ImageUpload({ onUpload, onCancel }: ImageUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        setPreview(await readImageFileAsDataUrl(file));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to read file");
      }
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
      const file = extractImageFileFromClipboard(e.clipboardData.items);
      if (file) {
        e.preventDefault();
        processFile(file);
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
          className="cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors"
          style={{
            borderColor: isDragging ? "var(--accent)" : "var(--border)",
            background: isDragging ? "var(--accent-glow)" : "transparent",
          }}
        >
          <div className="mb-2 text-2xl">📸</div>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Drop an image, paste from clipboard, or click to browse
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            JPG, PNG, HEIC supported · Max 5MB
          </p>
          {error && (
            <p className="mt-2 text-xs font-medium" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
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
              className="flex-1 rounded-lg py-2 text-sm font-medium text-white"
              style={{ background: "var(--accent)" }}
            >
              Send to Tutor
            </button>
            <button
              onClick={() => {
                setPreview(null);
                onCancel();
              }}
              className="rounded-lg px-3 py-2 text-sm"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
