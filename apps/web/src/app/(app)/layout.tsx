import { SessionProvider } from "@/components/session-provider";
import { JourneyProvider } from "@/components/journey-provider";

// Session (who am I) and journey (where am I) wrap every app-side page.
// Marketing keeps its own group and gets none of this.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <JourneyProvider>{children}</JourneyProvider>
    </SessionProvider>
  );
}
