"use client";

import Image from "next/image";
import { useState } from "react";
import { X } from "lucide-react";

type GalleryImage = { uri: string; uri150?: string };

export function ImageGallery({ images }: { images: GalleryImage[] }) {
  const [active, setActive] = useState<string | null>(null);

  if (images.length === 0) return null;

  return (
    <>
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
        {images.map((img) => (
          <button
            key={img.uri}
            type="button"
            onClick={() => setActive(img.uri)}
            className="relative aspect-square overflow-hidden rounded-md ring-1 ring-white/5 hover:ring-primary/50 transition-all bg-muted/40 group"
          >
            <Image
              src={img.uri150 ?? img.uri}
              alt=""
              fill
              sizes="120px"
              className="object-cover transition-transform group-hover:scale-105"
              unoptimized
            />
          </button>
        ))}
      </div>

      {active && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setActive(null)}
        >
          <button
            type="button"
            onClick={() => setActive(null)}
            className="absolute top-4 right-4 p-2 rounded-md bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active}
            alt=""
            className="max-w-full max-h-[90vh] object-contain rounded-md"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
