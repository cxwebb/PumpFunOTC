"use client";

import Link from "next/link";
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { formatSol, parseUiAmount } from "@/lib/amounts";
import { CLUSTER } from "@/lib/config";
import { fromBase64 } from "@/lib/encoding";
import { verifyTradeTransaction } from "@/modules/trading/verify";
import { api } from "@/client/api";
import { useAuth } from "@/client/auth";
import { Notice, Panel, TxLink } from "../ui";

type Step = "idle" | "uploading" | "building" | "signing" | "confirming" | "done";

export function LaunchForm() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const { signedIn, signIn } = useAuth();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [initialBuy, setInitialBuy] = useState("0");
  const [ack, setAck] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ mint: string; sig: string } | null>(null);

  async function launch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!publicKey || !signTransaction) return setError("Connect a wallet that can sign transactions");
    try {
      if (!image) throw new Error("Choose an image");
      const buyLamports = initialBuy.trim() ? parseUiAmount(initialBuy, 9) : 0n;
      if (!signedIn) await signIn();

      setStep("uploading");
      const form = new FormData();
      Object.entries({ name, symbol, description, twitter, telegram, website }).forEach(([k, v]) => v && form.append(k, v));
      form.append("image", image);
      const meta = await api<{ uri: string }>("/api/launch/metadata", { method: "POST", body: form });

      // The mint keypair is created here and never leaves this browser.
      const mintKp = Keypair.generate();
      setStep("building");
      const built = await api<{ transaction: string; simulation: { err: unknown; logs: string[] } }>("/api/launch/build", {
        method: "POST",
        json: { mint: mintKp.publicKey.toBase58(), name, symbol, uri: meta.uri, initialBuyLamports: buyLamports.toString() },
      });
      if (built.simulation.err) throw new Error(`Simulation failed: ${JSON.stringify(built.simulation.err)}`);
      const tx = VersionedTransaction.deserialize(fromBase64(built.transaction));
      const problems = verifyTradeTransaction(tx, publicKey.toBase58(), { extraSigners: [mintKp.publicKey.toBase58()], maxLamportsOut: buyLamports + 50_000_000n });
      if (problems.length) throw new Error(`Refusing to sign: ${problems.join("; ")}`);

      setStep("signing");
      tx.sign([mintKp]);
      const signed = await signTransaction(tx);
      setStep("confirming");
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      const latest = await connection.getLatestBlockhash("confirmed");
      const conf = await connection.confirmTransaction({ signature: sig, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
      if (conf.value.err) throw new Error(`Launch failed on chain: ${JSON.stringify(conf.value.err)}`);
      await api("/api/launch/confirm", { method: "POST", json: { mint: mintKp.publicKey.toBase58(), signature: sig } }).catch(() => undefined);
      setResult({ mint: mintKp.publicKey.toBase58(), sig });
      setStep("done");
    } catch (err) {
      setError((err as Error).message);
      setStep("idle");
    }
  }

  if (result)
    return (
      <Panel title="Launched">
        <div className="space-y-3">
          <Notice tone="ok">Your coin is live on the Pump.fun bonding curve ({CLUSTER}).</Notice>
          <p>
            Transaction: <TxLink sig={result.sig} />
          </p>
          <Link className="btn btn-up" href={`/token/${result.mint}`}>
            Open token page
          </Link>
        </div>
      </Panel>
    );

  const busy = step !== "idle";
  let buyPreview = "";
  try {
    buyPreview = initialBuy.trim() ? formatSol(parseUiAmount(initialBuy, 9)) : "0";
  } catch {
    buyPreview = "invalid";
  }

  return (
    <form onSubmit={launch} className="grid lg:grid-cols-3 gap-6">
      <Panel title="Coin details" className="lg:col-span-2">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Name</label>
            <input className="input" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label">Ticker</label>
            <input className="input uppercase" maxLength={10} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} required />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Description</label>
            <textarea className="input min-h-24" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Image (PNG, JPEG, GIF or WebP, up to 4 MB)</label>
            <input className="input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => setImage(e.target.files?.[0] ?? null)} required />
          </div>
          <div>
            <label className="label">X / Twitter (optional)</label>
            <input className="input" placeholder="https://x.com/..." value={twitter} onChange={(e) => setTwitter(e.target.value)} />
          </div>
          <div>
            <label className="label">Telegram (optional)</label>
            <input className="input" placeholder="https://t.me/..." value={telegram} onChange={(e) => setTelegram(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Website (optional)</label>
            <input className="input" placeholder="https://..." value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
        </div>
      </Panel>
      <div className="space-y-6">
        <Panel title="Launch">
          <div className="space-y-3">
            <div>
              <label className="label">Optional first buy (SOL)</label>
              <input className="input" inputMode="decimal" value={initialBuy} onChange={(e) => setInitialBuy(e.target.value)} />
              <p className="text-[11px] text-dim mt-1">Bought atomically in the same transaction as the launch, so nobody can buy before you.</p>
            </div>
            <div className="text-xs border border-line rounded p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-dim">First buy</span>
                <span>{buyPreview} SOL</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">Platform fee</span>
                <span>none</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">Protocol rent + network fee</span>
                <span>shown by your wallet</span>
              </div>
            </div>
            <Notice tone="warn">
              Irreversible: name, ticker, image and supply cannot be changed after launch. The token is a Token-2022 mint created with Pump&apos;s create_v2 instruction. The mint key is
              generated in your browser and never sent to our server.
            </Notice>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand this launch is permanent and costs SOL.
            </label>
            {error && <Notice tone="error">{error}</Notice>}
            <button className="btn btn-up w-full" disabled={!publicKey || !ack || busy}>
              {
                {
                  idle: "Launch coin",
                  uploading: "Uploading metadata…",
                  building: "Building and simulating…",
                  signing: "Confirm in wallet…",
                  confirming: "Waiting for confirmation…",
                  done: "Done",
                }[step]
              }
            </button>
            {!publicKey && <p className="text-[11px] text-dim">Connect a wallet to launch.</p>}
          </div>
        </Panel>
      </div>
    </form>
  );
}
