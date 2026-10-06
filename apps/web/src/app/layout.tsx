import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Serif } from "next/font/google";

import "../index.css";
import Providers from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  style: ["normal", "italic"],
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PromptPaid — Get paid for the conversations that train AI",
  description:
    "PromptPaid is an AI training platform. Have real conversations with AI models, get paid for the work that makes them better, and be part of something real.",
};

export const viewport: Viewport = {
  themeColor: "#1b6b3a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${instrumentSerif.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}