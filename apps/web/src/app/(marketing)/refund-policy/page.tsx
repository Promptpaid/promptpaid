import type { Metadata } from "next";

import { DraftPage } from "@/components/marketing/draft-page";

export const metadata: Metadata = {
  title: "Refund Policy — PromptPaid",
  robots: { index: false, follow: false },
  description: "Draft — pending legal review.",
};

export default function RefundPolicyPage() {
  return <DraftPage title="Refund Policy" />;
}