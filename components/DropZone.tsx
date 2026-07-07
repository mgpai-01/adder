"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, UploadCloud } from "lucide-react";
import { useT } from "@/lib/i18n";

// A drag-and-drop upload area with explicit buttons so it works well on phones:
// "Take Photo" opens the camera directly, "Choose Photo" opens the library/file
// picker. On desktop you can also drag & drop or tap the area.
export default function DropZone({
  onFiles,
  label = "Drag & drop photos here",
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
  const { t } = useT();
  const [over, setOver] = useState(false);
  const libraryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  // Depth counter so the highlight stays on while the cursor moves over the
  // inner buttons/thumbnails (each child fires its own dragenter/dragleave).
  const dragDepth = useRef(0);

  // Stop the browser from opening/navigating to a file dropped anywhere on the
  // page. Without this, a drop that lands even slightly outside the box makes
  // the browser open the image instead of uploading it — which reads as
  // "drag & drop doesn't work". Drops on the box are still handled below.
  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  function emit(list: FileList | null) {
    if (!list || list.length === 0) return;
    // Accept anything image-like. Some files (e.g. HEIC) report an empty type,
    // so fall back to the file extension rather than dropping them silently.
    const images = Array.from(list).filter(
      (file) => accept === "*" || file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i.test(file.name)
    );
    if (images.length > 0) onFiles(images);
  }

  return (
    <div
      onClick={() => libraryRef.current?.click()}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setOver(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setOver(false);
        emit(event.dataTransfer.files);
      }}
      className={
        "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors " +
        (over ? "border-workshop-500 bg-workshop-100" : "border-steel-200 bg-steel-50 hover:border-workshop-500")
      }
    >
      <UploadCloud size={26} className="text-workshop-700" />
      <p className="font-black text-steel-700">{t(label)}</p>
      <p className="text-xs font-bold text-steel-500">{t(hint)}</p>

      {/* Explicit, touch-friendly choices. stopPropagation so they don't also
          trigger the surrounding area's library picker. */}
      <div className="mt-3 flex w-full flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            cameraRef.current?.click();
          }}
          className="touch-target flex items-center justify-center gap-1.5 rounded-lg bg-workshop-700 px-4 py-2.5 text-sm font-black text-white shadow-sm transition-colors hover:bg-workshop-500"
        >
          <Camera size={17} /> {t("Take Photo")}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            libraryRef.current?.click();
          }}
          className="touch-target flex items-center justify-center gap-1.5 rounded-lg border border-steel-200 bg-white px-4 py-2.5 text-sm font-black text-steel-900 shadow-sm transition-colors hover:border-workshop-500"
        >
          <ImagePlus size={17} /> {multiple ? t("Choose Photos") : t("Choose Photo")}
        </button>
      </div>

      {/* Library / file picker. On phones this offers Photo Library + Files. */}
      <input
        ref={libraryRef}
        className="hidden"
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event) => {
          emit(event.target.files);
          event.target.value = "";
        }}
      />
      {/* Camera capture. `capture` opens the camera directly on phones; it is
          ignored on desktop, where it falls back to the file dialog. */}
      <input
        ref={cameraRef}
        className="hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => {
          emit(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
