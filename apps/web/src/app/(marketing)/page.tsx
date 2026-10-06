import { FAQ } from "@/components/marketing/faq";
import { Fees } from "@/components/marketing/fees";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Problem } from "@/components/marketing/problem";
import { Solution } from "@/components/marketing/solution";

export default function MarketingPage() {
  return (
    <>
      <Hero />
      <Problem />
      <Solution />
      <HowItWorks />
      <Fees />
      <FAQ />
      <FinalCta />
    </>
  );
}