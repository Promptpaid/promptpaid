// Basic mobile-first screen shell for the app side of the site.
// Phone-width single column, generous spacing, no fixed/sticky elements
// (small page weight matters on slow, paid-by-the-MB data).

import Link from "next/link";
import type { ReactNode } from "react";
import { AccountMenu } from "@/components/account-menu";

export function PageShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-10 pt-5">
      <header className="mb-6">
        <div className="flex min-h-11 items-center justify-between">
          <Link href="/" className="font-serif text-2xl leading-none tracking-tight">
            Prompt<span className="italic">Paid</span>
          </Link>
          <AccountMenu />
        </div>
        {eyebrow ? (
          <p className="mt-5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        {title ? <h1 className="mt-1 text-2xl font-semibold text-balance">{title}</h1> : null}
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
