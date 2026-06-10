import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { Disc3 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { getRecentAlerts } from "@/lib/wantlist-store";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SpinTrack — your record collection",
  description: "Your Discogs collection, randomized, rated, and Wikipedia'd.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b border-border/40 sticky top-0 z-40 bg-background/70 backdrop-blur-xl">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 group">
              <Disc3 className="w-5 h-5 text-primary transition-transform group-hover:rotate-180 duration-700" />
              <span className="font-semibold tracking-tight text-base">SpinTrack</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <NavLink href="/">Collection</NavLink>
              <NavLink href="/random">Spin</NavLink>
              <NavLink href="/listens">Listens</NavLink>
              <NavLink href="/stats">Stats</NavLink>
              <NavLink href="/wantlist">
                Wantlist
                <Suspense fallback={null}>
                  <WantlistBadge />
                </Suspense>
              </NavLink>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
    >
      {children}
    </Link>
  );
}

// Count of wantlist price drops in the last week, shown as a small badge on
// the Wantlist nav link. One fast store read, streamed via Suspense; renders
// nothing when there are no fresh drops.
async function WantlistBadge() {
  const alerts = await getRecentAlerts(7);
  if (alerts.length === 0) return null;
  return (
    <span className="text-[10px] leading-none rounded-full bg-primary text-primary-foreground px-1.5 py-0.5 font-medium tabular-nums">
      {alerts.length}
    </span>
  );
}
