import type { Metadata } from "next";
import "./globals.css";
import "./chat.css";
import "./cockpit.css";
import "./landing.css";

export const metadata: Metadata = {
  title: "Waypoint — engineering incident agent",
  description: "Investigate engineering incidents through connected evidence and approved actions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Browser extensions (password managers, grammar checkers, ad blockers) commonly inject attributes into
  // <html>/<body> before React hydrates; suppressHydrationWarning keeps that from crashing the whole page.
  return <html lang="en" suppressHydrationWarning><body suppressHydrationWarning>{children}</body></html>;
}
