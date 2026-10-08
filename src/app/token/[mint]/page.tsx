import { notFound } from "next/navigation";
import { TokenView } from "@/components/token/TokenView";
import { isPublicKey } from "@/lib/validation";

export const metadata = { title: "Token" };

export default async function TokenPage({ params }: PageProps<"/token/[mint]">) {
  const { mint } = await params;
  if (!isPublicKey(mint)) notFound();
  return <TokenView mint={mint} />;
}
