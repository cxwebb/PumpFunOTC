import { Suspense } from "react";
import { OtcDesk } from "@/components/otc/OtcDesk";
import { Loading } from "@/components/ui";

export const metadata = { title: "OTC Desk" };

export default function OtcPage() {
  return (
    <Suspense fallback={<Loading />}>
      <OtcDesk />
    </Suspense>
  );
}
