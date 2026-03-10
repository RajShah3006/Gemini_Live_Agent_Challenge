"use client";

export const IMAGE_UPLOAD_MAX_SIZE = 5 * 1024 * 1024;

export function validateImageFile(file: File, maxSize = IMAGE_UPLOAD_MAX_SIZE): string | null {
  if (!file.type.startsWith("image/")) {
    return "Please upload an image file (JPG, PNG, HEIC)";
  }
  if (file.size > maxSize) {
    return `Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 5MB.`;
  }
  return null;
}

export function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const validationError = validateImageFile(file);
    if (validationError) {
      reject(new Error(validationError));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = (event) => resolve((event.target?.result as string) || "");
    reader.readAsDataURL(file);
  });
}

export function extractImageFileFromClipboard(items: DataTransferItemList): File | null {
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}
