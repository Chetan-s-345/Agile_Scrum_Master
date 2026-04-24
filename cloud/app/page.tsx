import { HeroSection } from "@/components/herosection";
import { HomeSections } from "@/components/home-sections";
import { HomeNavbar } from "@/components/home-navbar";
import { HomeFooter } from "@/components/home-footer";
import Link from "next/link";
import Image from "next/image";

function DesktopDownloadBand() {
  return (
    <section className="relative z-20 border-y border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-primary)]">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-6 py-14 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--text-secondary)]">Desktop Version</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Install Agile Scrum Master on Windows</h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--text-secondary)] md:text-base">
            Download the Windows installer to get the native desktop experience with a branded app icon, desktop shortcut,
            and taskbar presence.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="https://github.com/deekshithgowda85/Agile_Scrum_Master/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-full bg-[#2d63c9] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2455b3]"
            >
              Download Windows Installer
            </Link>
            <span className="rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-secondary)]">
              Version 0.1.0 • NSIS installer
            </span>
          </div>
        </div>

        <div className="flex justify-center lg:justify-end">
          <div className="w-full max-w-sm rounded-3xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-2xl">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]">
                <Image src="/sprint-grid-logo.svg" alt="Sprint logo" width={48} height={48} className="h-12 w-12" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Agile Scrum Master Desktop</p>
                <p className="text-xs text-[var(--text-secondary)]">Windows installer package</p>
              </div>
            </div>
            <div className="mt-5 space-y-3 text-sm text-[var(--text-secondary)]">
              <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
                <span>Installer file</span>
                <span className="font-medium text-[var(--text-primary)]">Setup.exe</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
                <span>Platform</span>
                <span className="font-medium text-[var(--text-primary)]">Windows 10 / 11</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-black dark:text-white">
      <HomeNavbar />
      <HeroSection />
      <DesktopDownloadBand />
      <HomeSections />
      <HomeFooter />
    </div>
  );
}
