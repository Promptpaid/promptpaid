import type { Metadata } from "next";

import { DraftPage } from "@/components/marketing/draft-page";

export const metadata: Metadata = {
  title: "Trainer Agreement — PromptPaid",
  robots: { index: false, follow: false },
  description: "Draft — pending legal review.",
};

export default function TrainerAgreementPage() {
  return <DraftPage title="Trainer Agreement" />;
}