import type { Metadata } from "next";
import Link from "next/link";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: { default: "PumpFunOTC", template: "%s · PumpFunOTC" },
  description: "Escrowless wallet-to-wallet OTC trading, Pump.fun token discovery, trading and launches on Solana.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Providers>
          <Header />
          <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6">{children}</main>
          <footer className="border-t border-line text-dim text-[11px]">
            <div className="mx-auto max-w-7xl px-4 py-4 flex flex-wrap gap-x-6 gap-y-2">
              <span>Non-custodial. You sign every transaction in your own wallet.</span>
              <span>Unaudited software. Do not trade amounts you cannot afford to lose.</span>
              <Link href="/fees" className="hover:text-ink">Fees</Link>
              <Link href="/help" className="hover:text-ink">How it works</Link>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
