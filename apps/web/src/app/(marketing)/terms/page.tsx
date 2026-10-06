import type { Metadata } from "next";

import { DraftPage } from "@/components/marketing/draft-page";

export const metadata: Metadata = {
  title: "Terms — PromptPaid",
  robots: { index: false, follow: false },
  description: "Draft — pending legal review.",
};

export default function TermsPage() {
  return <DraftPage title="Terms" />;
}