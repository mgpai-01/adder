"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

// A drag-and-drop upload area that also opens the file picker on tap. Use it
// anywhere photos can be added.
export default function DropZone({
  onFiles,
  label = "Drag & drop photos here, or tap to choose",
  hint = "PNG or JPG",
  accept = "image/*",
  multiple = true
}: {
  onFiles: (files: File[]) => void;
  label?: string;
  hint?: string;
  accept?: string;
  multiple?: boolean;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function emit(list: FileList | null) {
    if (!list || list.length === 0) return;
    const images = Array.from(list).filter((file) => file.type.startsWith("image/") || accept === "*");
    if (images.length > 0) onFiles(images);
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        emit(event.dataTransfer.files);
      }}
      className={
        "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors " +
        (over ? "border-workshop-500 bg-workshop-100" : "border-steel-200 bg-steel-50 hover:border-workshop-500")
      }
    >
      <UploadCloud size={26} className="text-workshop-700" />
      <p className="font-black text-steel-700">{label}</p>
      <p className="text-xs font-bold text-steel-500">{hint}</p>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event) => {
          emit(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
