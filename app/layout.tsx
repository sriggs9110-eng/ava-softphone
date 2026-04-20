import type { Metadata } from "next";
import { Fraunces, Caveat } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const caveat = Caveat({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-accent",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pepper — AI sales coach",
  description: "Pepper — AI sales coach for your calls",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${fraunces.variable} ${caveat.variable}`}
    >
      <head>
        {/* General Sans (body) — Fontshare, not available via next/font/google */}
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap"
        />
        <style>{`:root { --font-body: "General Sans"; }`}</style>
      </head>
      <body className="min-h-full flex font-sans pepper-gradients">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
