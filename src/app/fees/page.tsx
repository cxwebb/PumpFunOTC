import { OTC_FEE_BPS, OTC_TREASURY, explorerAddressUrl } from "@/lib/config";

export const metadata = { title: "Fees" };

export default function FeesPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-bold">Fees</h1>
      <div className="panel p-5 space-y-4">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Platform fee</th>
              <th>Who pays</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>OTC settlement</td>
              <td>{OTC_FEE_BPS / 100}% of the agreed SOL price</td>
              <td>Deducted from the seller&apos;s proceeds</td>
            </tr>
            <tr>
              <td>Pump.fun / PumpSwap trade</td>
              <td>None</td>
              <td>Pump protocol fees still apply</td>
            </tr>
            <tr>
              <td>Coin launch</td>
              <td>None</td>
              <td>Pump protocol costs and rent apply</td>
            </tr>
            <tr>
              <td>Posting, countering or cancelling an offer</td>
              <td>None</td>
              <td>Free signed message</td>
            </tr>
          </tbody>
        </table>
        <ul className="list-disc ml-5 space-y-1 text-sm">
          <li>The OTC fee is part of the order the maker signs and part of the settlement transaction both parties sign. It cannot be changed afterwards.</li>
          <li>The buyer pays the Solana network fee and, if needed, rent to open their token account (about 0.002 SOL).</li>
          <li>
            Fees go only to the published treasury{" "}
            {OTC_TREASURY ? (
              <a className="text-info break-all" href={explorerAddressUrl(OTC_TREASURY)} target="_blank" rel="noreferrer">
                {OTC_TREASURY}
              </a>
            ) : (
              <span className="text-warn">(not configured)</span>
            )}
            . Your browser refuses to sign any settlement that sends the fee anywhere else.
          </li>
          <li>There are no hidden fees.</li>
        </ul>
      </div>
    </div>
  );
}
