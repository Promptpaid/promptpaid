import { Reveal } from "./reveal";

const FAQS = [
  {
    q: "What is PromptPaid?",
    a: "An AI training platform. Members hold structured conversations with AI models and get paid for that work. AI buyers pay for the resulting training data.",
  },
  {
    q: "How much can I earn?",
    a: "At full daily activity, a Rookie member can earn up to \u20A615,000 a month — 5 paid conversations a day at \u20A6100 each. It's an upper bound, not a guarantee: you earn for the days you work.",
  },
  {
    q: "When can I withdraw for the first time?",
    a: "No earlier than 14 days after you activate, and only once you reach the \u20A68,000 withdrawal threshold. The 14-day minimum applies regardless of your balance.",
  },
  {
    q: "Are there any fees?",
    a: "Yes. There is a \u20A61,000 verification fee charged on every withdrawal.",
  },
  {
    q: "Is there a cost to join the waitlist?",
    a: "No. Joining the waitlist is free. The Rookie tier costs \u20A62,000 when you activate.",
  },
  {
    q: "Which countries and languages are supported?",
    a: "Nigeria, South Africa, Ghana and Kenya. Members can work in English, Nigerian Pidgin, Yoruba, Igbo, Hausa, Afrikaans, Zulu, Swahili and French.",
  },
  {
    q: "When do I start?",
    a: "We're opening access in batches. Join the waitlist and watch your email — we'll contact you when your spot opens.",
  },
] as const;

export function FAQ() {
  return (
    <section
      id="faq"
      className="scroll-mt-24 px-4 py-20 sm:px-6"
      aria-labelledby="faq-heading"
    >
      <div className="mx-auto max-w-3xl">
        <Reveal>
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-primary">
              Questions
            </p>
            <h2
              id="faq-heading"
              className="mt-3 font-serif text-4xl leading-tight sm:text-5xl"
            >
              Asked before <span className="italic">you join.</span>
            </h2>
          </div>
        </Reveal>
        <div className="mt-10 space-y-4">
          {FAQS.map((faq, i) => (
            <Reveal key={faq.q} delay={0.04 * i}>
              <details className="clay clay-press group rounded-clay px-6 py-4">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-left font-medium [&::-webkit-details-marker]:hidden">
                  <span className="text-base">{faq.q}</span>
                  <span
                    aria-hidden
                    className="font-serif text-2xl leading-none text-primary transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-muted-foreground">
                  {faq.a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}