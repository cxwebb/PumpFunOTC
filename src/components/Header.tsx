"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { CLUSTER } from "@/lib/config";
import { useAuth } from "@/client/auth";

const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), { ssr: false });

const NAV = [
  { href: "/explore", label: "Explore" },
  { href: "/otc", label: "OTC Desk" },
  { href: "/launch", label: "Launch" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/help", label: "Help" },
];

export function Header() {
  const path = usePathname();
  const { connected } = useWallet();
  const { signedIn, signIn, signOut, sessionWallet } = useAuth();
  return (
    <header className="border-b border-line bg-panel/80 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-6">
        <Link href="/" className="font-bold tracking-tight text-up whitespace-nowrap">
          ▚ PumpFunOTC
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {NAV.map((n) => {
            const active = path === n.href || (n.href !== "/" && path.startsWith(n.href)) || (n.href === "/explore" && path === "/");
            return (
              <Link key={n.href} href={n.href} className={`px-3 py-1.5 rounded ${active ? "text-ink bg-panel-2" : "text-dim hover:text-ink"}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={`hidden sm:inline px-2 py-1 rounded text-[11px] border ${CLUSTER === "devnet" ? "text-warn border-warn/40" : "text-down border-down/50"}`}
            title="Solana cluster this app transacts on"
          >
            {CLUSTER === "devnet" ? "DEVNET" : "MAINNET"}
          </span>
          {connected && !signedIn && (
            <button className="btn btn-up text-xs" onClick={() => signIn().catch(() => undefined)}>
              Sign in
            </button>
          )}
          {signedIn && sessionWallet && (
            <button className="btn text-xs" onClick={() => signOut()} title="Sign out of the app session">
              Signed in
            </button>
          )}
          <WalletMultiButton />
        </div>
      </div>
      <nav className="md:hidden flex overflow-x-auto px-2 pb-2 gap-1">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`px-3 py-1 rounded text-xs ${path.startsWith(n.href) ? "bg-panel-2" : "text-dim"}`}>
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
