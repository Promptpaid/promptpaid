import { Reveal } from "./reveal";

const SIDES = [
  {
    title: "For AI buyers",
    body: "Models trained on thin, generic data behave like it. Real conversations from real people — in the languages people actually speak — are the part that's hardest to buy.",
  },
  {
    title: "For people looking for work",
    body: "Most \u201Cearn from your phone\u201D offers are vague about what you're paid, when you can withdraw, and what it costs to start. You find out the rules after you've committed.",
  },
] as const;

export function Problem() {
  return (
    <section className="px-4 py-20 sm:px-6" aria-labelledby="problem-heading">
      <div className="mx-auto max-w-4xl">
        <Reveal>
          <p className="text-sm font-medium uppercase tracking-wide text-primary">
            The problem
          </p>
        </Reveal>
        <Reveal delay={0.06}>
          <h2
            id="problem-heading"
            className="mt-3 font-serif text-4xl leading-tight sm:text-5xl"
          >
            Two sides are <span className="italic">stuck.</span>
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {SIDES.map((side, i) => (
            <Reveal key={side.title} delay={0.1 + i * 0.06}>
              <div className="clay h-full rounded-clay p-6">
                <h3 className="font-serif text-2xl">{side.title}</h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">
                  {side.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}