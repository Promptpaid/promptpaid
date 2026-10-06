import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="relative flex min-h-svh flex-col overflow-x-clip">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-32 h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle_at_center,oklch(0.8_0.12_152/0.35),transparent_70%)] blur-3xl" />
        <div className="absolute top-1/3 -right-40 h-[36rem] w-[36rem] rounded-full bg-[radial-gradient(circle_at_center,oklch(0.9_0.08_120/0.3),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-0 left-1/4 h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle_at_center,oklch(0.85_0.09_160/0.28),transparent_70%)] blur-3xl" />
      </div>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}