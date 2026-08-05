import type { Metadata } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Self-hosted (app/fonts) so the build never depends on fonts.gstatic.com —
// works offline / on flaky networks / in CI. Variable fonts: one file each.
const geistSans = localFont({
  src: "./fonts/geist-latin.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

// Thai-script font, so Thai characters render properly.
const notoThai = localFont({
  src: "./fonts/noto-sans-thai.woff2",
  variable: "--font-noto-thai",
  weight: "400 700",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ระบบจองยานพาหนะ",
  description: "ระบบขออนุมัติใช้ยานพาหนะ อนุมัติ และจัดรอบรถ คณะแพทยศาสตร์",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} ${notoThai.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col font-sans"
        // Browser extensions like Grammarly inject `data-gr-*` attributes onto
        // <body> after hydration; this stops React's hydration mismatch warning.
        suppressHydrationWarning
      >
        <ThemeProvider>
          <NextIntlClientProvider locale={locale} messages={messages}>
            {children}
            <Toaster richColors closeButton />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
