import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import SiteHeader from "./components/SiteHeader";
import CashRain from "./components/CashRain";
import OpenClaimsTicker from "./components/OpenClaimsTicker";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ClassActionPayouts.com — Class Action Lawsuit Research",
  description:
    "Search U.S. federal class action case data via the CourtListener API.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <CashRain />
        <SiteHeader />
        <OpenClaimsTicker />
        <div className="page-content">{children}</div>
      </body>
    </html>
  );
}
