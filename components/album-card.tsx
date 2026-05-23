import Image from "next/image";
import Link from "next/link";
import type { CollectionRelease } from "@/lib/discogs";
import { primaryArtist } from "@/lib/discogs";

export function AlbumCard({ release }: { release: CollectionRelease }) {
  const info = release.basic_information;
  const img = info.cover_image || info.thumb;
  const artist = primaryArtist(release);

  return (
    <Link
      href={`/album/${info.id}`}
      className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-md"
    >
      <div className="aspect-square overflow-hidden rounded-md bg-muted/40 relative ring-1 ring-white/5 shadow-lg shadow-black/30 transition-all duration-300 group-hover:ring-primary/30 group-hover:shadow-xl group-hover:shadow-black/40 group-hover:-translate-y-0.5">
        {img ? (
          <Image
            src={img}
            alt={`${artist} — ${info.title}`}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 200px"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No image
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="mt-2.5 space-y-0.5 px-0.5">
        <div className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
          {info.title}
        </div>
        <div className="text-xs text-muted-foreground line-clamp-1">{artist}</div>
        {info.year > 0 && (
          <div className="text-[10px] text-muted-foreground/70 tabular-nums uppercase tracking-wider mt-0.5">
            {info.year}
          </div>
        )}
      </div>
    </Link>
  );
}
