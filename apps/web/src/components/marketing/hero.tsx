import { ArrowDown, ArrowRight } from "lucide-react";

import { Button } from "@promptpaid/ui/components/button";

import { Reveal } from "./reveal";

export function Hero() {
  return (
    <section className="px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
      <div className="mx-auto max-w-4xl text-center">
        <Reveal>
          <span className="clay inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm">
            <span aria-hidden className="size-2 rounded-full bg-primary" />
            Now building the waitlist
          </span>
        </Reveal>
        <Reveal delay={0.06}>
          <h1 className="mx-auto mt-6 max-w-3xl font-serif text-5xl leading-[1.05] sm:text-6xl md:text-7xl">
            Get paid for the conversations that train{" "}
            <span className="italic text-primary">AI.</span>
          </h1>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            PromptPaid is an AI training platform. You have real conversations
            with AI models, get paid for the work that makes those models better,
            and AI buyers get higher-quality training data in return.
          </p>
        </Reveal>
        <Reveal delay={0.18}>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              size="lg"
              className="min-h-12 w-full rounded-clay px-8 text-base sm:w-auto"
              render={<a href="#join" />}
            >
              Join the waitlist
              <ArrowRight />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="min-h-12 w-full rounded-clay px-8 text-base sm:w-auto"
              render={<a href="#how-it-works" />}
            >
              See how it works
              <ArrowDown />
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}