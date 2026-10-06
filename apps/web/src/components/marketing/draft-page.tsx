import type { ReactNode } from "react";

export function DraftPage({ title }: { title: string }) {
  let body: ReactNode;
  if (title === "Terms") {
    body = (
      <>
        <p>
          The final text for this page is being prepared with our lawyer and will
          be published before PromptPaid launches.
        </p>
        <p className="mt-4">
          Until then, the Rules set out on the PromptPaid landing page — including
          the Fees and rules section — apply to your use of PromptPaid. Refer to it
          for the Rookie tier figures before you join.
        </p>
      </>
    );
  } else if (title === "Trainer Agreement") {
    body = (
      <>
        <p>
          The final text for this page is being prepared with our lawyer and will
          be published before PromptPaid launches.
        </p>
        <p className="mt-4">
          Until then, the Rookie tier figures on the PromptPaid landing page apply.
          Higher tiers (Elite and Legendary) are documented here once live.
        </p>
      </>
    );
  } else if (title === "Refund Policy") {
    body = (
      <>
        <p>
          The final text for this page is being prepared with our lawyer and will
          be published before PromptPaid launches.
        </p>
        <p className="mt-4">
          Until then, refund terms are described in the Fees and rules section on
          the PromptPaid landing page.
        </p>
      </>
    );
  } else {
    body = (
      <>
        <p>
          The final text for this page is being prepared with our lawyer and will
          be published before PromptPaid launches.
        </p>
        <p className="mt-4">
          Until then, this notice describes how we handle information you share
          when you join the PromptPaid waitlist.
        </p>
      </>
    );
  }

  return (
    <div className="px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <div className="clay rounded-clay p-6 sm:p-10">
          <p className="text-sm font-medium uppercase tracking-wide text-primary">
            PromptPaid
          </p>
          <h1 className="mt-2 font-serif text-4xl leading-tight sm:text-5xl">
            {title}
          </h1>
          <div className="mt-6 rounded-clay-sm border-2 border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <strong>Draft — pending legal review.</strong> This page is not final
            and is excluded from search engines.
          </div>
          <div className="mt-6 leading-relaxed text-muted-foreground">{body}</div>
        </div>
      </div>
    </div>
  );
}