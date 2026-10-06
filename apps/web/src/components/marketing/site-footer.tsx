import Link from "next/link";

const LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy Notice" },
  { href: "/trainer-agreement", label: "Trainer Agreement" },
  { href: "/refund-policy", label: "Refund Policy" },
] as const;

export function SiteFooter() {
  return (
    <footer className="px-4 pb-10 pt-16 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="clay flex flex-col gap-6 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-serif text-lg">
            Prompt<span className="italic">Paid</span>
          </div>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-3">
            {LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="min-h-11 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <p className="pt-6 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} PromptPaid. All rights reserved.
        </p>
      </div>
    </footer>
  );
}