import { Reveal } from "./reveal";

export function Solution() {
  return (
    <section className="px-4 py-20 sm:px-6" aria-labelledby="solution-heading">
      <div className="mx-auto max-w-4xl">
        <Reveal>
          <div className="clay rounded-clay p-8 sm:p-12">
            <p className="text-sm font-medium uppercase tracking-wide text-primary">
              The solution
            </p>
            <h2
              id="solution-heading"
              className="mt-3 font-serif text-4xl leading-tight sm:text-5xl"
            >
              One platform,{" "}
              <span className="italic">rules written down first.</span>
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              PromptPaid pays people for the conversations AI buyers need, in nine
              languages across four countries. Every rate, threshold and fee is
              published up front — on this page and in the Trainer Agreement — so
              you know the rules before you start, not after.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}