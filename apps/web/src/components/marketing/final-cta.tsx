import { Reveal } from "./reveal";
import { WaitlistForm } from "./waitlist-form";

export function FinalCta() {
  return (
    <section
      id="join"
      className="scroll-mt-24 px-4 py-20 sm:px-6"
      aria-labelledby="join-heading"
    >
      <div className="mx-auto max-w-2xl">
        <Reveal>
          <div className="clay rounded-clay p-6 sm:p-10">
            <div className="text-center">
              <h2
                id="join-heading"
                className="font-serif text-4xl leading-tight sm:text-5xl"
              >
                Join the waitlist
              </h2>
              <p className="mt-3 text-muted-foreground">
                Free to join. We'll email you when your spot opens.
              </p>
            </div>
            <div className="mt-8">
              <WaitlistForm />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}