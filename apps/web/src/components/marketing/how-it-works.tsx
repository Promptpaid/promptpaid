import { CheckCircle2, ClipboardList, MessageSquareText } from "lucide-react";

import { Reveal } from "./reveal";

const STEPS = [
  {
    icon: ClipboardList,
    title: "Join the waitlist",
    body: "Add your details below. Joining the waitlist is free. We'll email you when your spot opens up.",
  },
  {
    icon: CheckCircle2,
    title: "Get verified and trained",
    body: "We verify your identity and walk you through the tasks. You choose your tier when you activate.",
  },
  {
    icon: MessageSquareText,
    title: "Do the work and withdraw",
    body: "Have your daily conversations, reach your withdrawal threshold, and cash out. The 14-day minimum and the \u20A61,000 verification fee per withdrawal apply — full details in Fees and rules.",
  },
] as const;

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-24 px-4 py-20 sm:px-6"
      aria-labelledby="how-heading"
    >
      <div className="mx-auto max-w-5xl">
        <Reveal>
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-primary">
              How it works
            </p>
            <h2
              id="how-heading"
              className="mt-3 font-serif text-4xl leading-tight sm:text-5xl"
            >
              Three steps to your first <span className="italic">payout.</span>
            </h2>
          </div>
        </Reveal>
        <ol className="mt-12 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal key={step.title} delay={0.1 + i * 0.08}>
              <li className="clay flex h-full flex-col rounded-clay p-6">
                <div className="flex items-center justify-between">
                  <step.icon className="size-7 text-primary" aria-hidden />
                  <span className="font-serif text-3xl text-primary/40">
                    0{i + 1}
                  </span>
                </div>
                <h3 className="mt-4 font-serif text-2xl">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}