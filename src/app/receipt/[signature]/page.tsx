import { ReceiptView } from "@/components/otc/ReceiptView";

export const metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: PageProps<"/receipt/[signature]">) {
  const { signature } = await params;
  return <ReceiptView signature={signature} />;
}
