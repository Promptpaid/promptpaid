import type { Metadata } from "next";

import { DraftPage } from "@/components/marketing/draft-page";

export const metadata: Metadata = {
  title: "Privacy Notice — PromptPaid",
  robots: { index: false, follow: false },
  description: "Draft — pending legal review.",
};

export default function PrivacyPage() {
  return <DraftPage title="Privacy Notice" />;
}