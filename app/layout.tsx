import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeInit } from "@/components/theme-init";
import { InitialVisitLoader } from "@/components/initial-visit-loader";
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
  title: "Sprint Manager - AI-Powered Agile Platform",
  description: "Intelligent project management with AI-driven sprint planning and developer assignment",
};

const themeInitScript = `
(() => {
  try {
    const stored = localStorage.getItem('sprint-theme');
    const parsed = stored ? JSON.parse(stored) : null;
    const theme = parsed?.state?.theme === 'light' ? 'light' : 'dark';
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.classList.toggle('dark', theme === 'dark');
  } catch {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'dark');
    root.classList.add('dark');
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="dark" className="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[var(--bg-app)] text-[var(--text-primary)] transition-colors`}
      >
        <InitialVisitLoader />
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}
