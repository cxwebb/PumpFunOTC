import { LaunchForm } from "@/components/launch/LaunchForm";

export const metadata = { title: "Launch" };

export default function LaunchPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Launch a coin</h1>
        <p className="text-dim">Create a Pump.fun coin from your wallet, with an optional first buy in the same transaction.</p>
      </div>
      <LaunchForm />
    </div>
  );
}
