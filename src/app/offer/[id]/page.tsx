import { OfferDetail } from "@/components/otc/OfferDetail";

export const metadata = { title: "OTC offer" };

export default async function OfferPage({ params }: PageProps<"/offer/[id]">) {
  const { id } = await params;
  return <OfferDetail hash={id} />;
}
