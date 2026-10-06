"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@promptpaid/ui/components/button";

import { ModeToggle } from "@/components/mode-toggle";

const NAV = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#fees", label: "Fees" },
  { href: "#faq", label: "FAQ" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 px-4 pt-3 sm:px-6">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-clay px-3 py-2 shadow-clay">
        <Link href="/" className="flex min-h-11 items-center gap-2">
          <Image
            src="/logo-placeholder.svg"
            alt="PromptPaid"
            width={40}
            height={40}
            className="h-10 w-10"
            priority
          />
          <span className="font-serif text-xl">
            Prompt<span className="italic">Paid</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="flex min-h-11 items-center rounded-full px-4 text-sm font-normal text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <Button
            size="lg"
            className="min-h-11 rounded-full px-5"
            render={<a href="#join" />}
          >
            Join the waitlist
            <ArrowRight />
          </Button>
        </div>
      </div>
    </header>
  );
}