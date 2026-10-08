import { SettlementView } from "@/components/otc/SettlementView";

export const metadata = { title: "Settlement" };

export default async function TradePage({ params }: PageProps<"/trade/[id]">) {
  const { id } = await params;
  return <SettlementView id={id} />;
}
