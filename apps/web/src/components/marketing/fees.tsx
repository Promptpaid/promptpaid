import Link from "next/link";

import { Reveal } from "./reveal";

const RATES = [
  { label: "Rookie tier price", value: "\u20A62,000" },
  { label: "Daily conversations", value: "5" },
  { label: "Rate per conversation", value: "\u20A6100" },
  { label: "Withdrawal threshold", value: "\u20A68,000" },
] as const;

const RULES = [
  "You must be active for at least 14 days from activation, regardless of your balance.",
  "You must reach the \u20A68,000 withdrawal threshold.",
  "A \u20A61,000 verification fee is charged on every withdrawal.",
] as const;

export function Fees() {
  return (
    <section
      id="fees"
      className="scroll-mt-24 px-4 py-20 sm:px-6"
      aria-labelledby="fees-heading"
    >
      <div className="mx-auto max-w-4xl">
        <Reveal>
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-primary">
              Fees and rules
            </p>
            <h2
              id="fees-heading"
              className="mt-3 font-serif text-4xl leading-tight sm:text-5xl"
            >
              Everything costs something.{" "}
              <span className="italic">Here's ours.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              These are the Rookie tier figures. They apply from the moment you
              activate. Read them before you join — not after.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {RATES.map((rate) => (
              <div key={rate.label} className="clay rounded-clay p-5 text-center">
                <dd className="font-serif text-3xl text-primary">{rate.value}</dd>
                <dt className="mt-1 text-sm text-muted-foreground">{rate.label}</dt>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.14}>
          <div className="clay mt-6 rounded-clay p-6 sm:p-8">
            <h3 className="font-serif text-2xl">
              Earnings at full daily activity
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                ["Up to \u20A6500", "per day"],
                ["Up to \u20A63,500", "per week"],
                ["Up to \u20A615,000", "per month"],
              ].map(([amount, span]) => (
                <div key={span} className="clay-sm rounded-clay px-4 py-3">
                  <p className="font-serif text-2xl text-primary">{amount}</p>
                  <p className="text-sm text-muted-foreground">{span}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              These figures assume you complete all 5 conversations every day.
              They are an upper bound, not a guarantee. Miss a day, earn less.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.2}>
          <div className="mt-6 rounded-clay border-2 border-primary/25 bg-background p-6 sm:p-8">
            <h3 className="font-serif text-2xl">Before your first withdrawal</h3>
            <ul className="mt-4 space-y-3">
              {RULES.map((rule) => (
                <li key={rule} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-1 size-2 shrink-0 rounded-full bg-primary"
                  />
                  <span className="leading-relaxed">{rule}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm text-muted-foreground">
              Higher tiers (Elite and Legendary) are documented in the{" "}
              <Link
                href="/trainer-agreement"
                className="font-medium text-primary underline underline-offset-2"
              >
                Trainer Agreement
              </Link>
              .
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}