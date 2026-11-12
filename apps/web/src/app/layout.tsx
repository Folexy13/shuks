import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shuks — The Local Artisan Marketplace",
  description:
    "Connect with neighborhood tradespeople, finalize scope on a web call with live meeting notes, and pay safely through PayPal Escrow.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="font-sans antialiased bg-canvas text-ink selection:bg-terracotta selection:text-white"
      >
        {children}
      </body>
    </html>
  );
}
