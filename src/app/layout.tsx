import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Waypoint — engineering incident agent",
  description: "Investigate engineering incidents through connected evidence and approved actions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
