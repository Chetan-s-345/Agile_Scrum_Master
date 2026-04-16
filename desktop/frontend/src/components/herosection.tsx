"use client";

import Image from "@/next-shims/image";
import Link from "@/next-shims/link";
import { Brain, Database, Github, MessagesSquare, Rocket, Workflow, Zap } from "lucide-react";

const integrations = [
    { name: "GitHub", icon: Github },
    { name: "Jira", icon: Workflow },
    { name: "Slack", icon: MessagesSquare },
    { name: "Inngest", icon: Zap },
    { name: "Brevo", icon: Rocket },
    { name: "PostgreSQL", icon: Database },
    { name: "Vercel", icon: null },
    { name: "OpenAI", icon: Brain },
];

export const HeroSection = () => {
    return (
        <div>

            <main>
                <div
                    aria-hidden
                    className="z-[2] absolute inset-0 pointer-events-none isolate opacity-50 contain-strict hidden lg:block"
                >
                    <div className="h-[80rem] w-[35rem] -translate-y-87.5 absolute left-0 top-0 -rotate-45 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,hsla(0,0%,85%,.08)_0,hsla(0,0%,55%,.02)_50%,hsla(0,0%,45%,0)_80%)]" />
                    <div className="h-[80rem] absolute left-0 top-0 w-56 -rotate-45 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.06)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)] [translate:5%_-50%]" />
                    <div className="h-[80rem] -translate-y-87.5 absolute left-0 top-0 w-56 -rotate-45 bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.04)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)]" />
                </div>

                <section className="overflow-hidden bg-[var(--bg-app)]">
                    <div className="relative mx-auto max-w-5xl px-6 py-28 lg:py-24">
                        <div className="relative z-10 mx-auto max-w-2xl text-center">
                            <h1 className="text-balance text-4xl font-semibold md:text-5xl lg:text-6xl">
                                Master Your Agile Workflows
                            </h1>
                            <p className="mx-auto my-8 max-w-2xl text-xl">
                                Streamline your sprint planning, easily assign tasks, track developer progress, and deliver high-quality software on time. Reimagined explicitly for Scrum teams.
                            </p>

                            <Link
                                className="inline-flex items-center justify-center rounded-full bg-foreground px-8 py-3 text-sm font-medium text-background transition hover:opacity-90"
                                href="/auth/sign-in"
                            >
                                Get Started
                            </Link>
                        </div>
                    </div>

                    <div className="mx-auto -mt-16 max-w-7xl [mask-image:linear-gradient(to_bottom,black_50%,transparent_100%)]">
                        <div className="[perspective:1200px] [mask-image:linear-gradient(to_right,black_50%,transparent_100%)] -mr-16 pl-16 lg:-mr-56 lg:pl-56">
                            <div className="[transform:rotateX(20deg);]">
                                <div className="lg:h-[44rem] relative skew-x-[.36rad] overflow-hidden rounded-[--radius]" style={{ clipPath: "inset(10px 0 2px 0 round var(--radius))" }}>
                                    <div className="pointer-events-none absolute inset-x-0 top-0 z-[3] h-1 bg-[var(--bg-app)]" />
                                    <Image
                                        className="z-[2] relative block dark:hidden w-full h-full object-cover object-top"
                                        src="/image light.png"
                                        alt="Agile Scrum dashboard preview"
                                        width={2880}
                                        height={2074}
                                        priority
                                        style={{ pointerEvents: "none" }}
                                    />
                                    <Image
                                        className="z-[2] relative hidden dark:block w-full h-full object-cover object-top"
                                        src="/image.png"
                                        alt="Agile Scrum dashboard preview"
                                        width={2880}
                                        height={2074}
                                        style={{ pointerEvents: "none" }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
                <section className="relative z-10 py-16 bg-transparent">
                    <div className="m-auto max-w-5xl px-6">
                        <h2 className="text-center text-lg font-semibold text-[var(--text-primary)]">
                            Works with your delivery stack.
                        </h2>
                        <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-[var(--text-secondary)]">
                            Connected integrations for planning, delivery, notifications, and automation.
                        </p>

                        <div className="mt-8 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
                            <div className="hero-logo-marquee flex w-max items-center gap-8 whitespace-nowrap">
                                {[...integrations, ...integrations].map((entry, idx) => {
                                    const Icon = entry.icon;
                                    return (
                                        <span key={`${entry.name}-${idx}`} className="inline-flex items-center gap-2 text-base font-medium text-[var(--text-primary)]">
                                            {entry.name === "Vercel" ? (
                                                <span className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1">
                                                    <Image
                                                        src="/vercel.svg"
                                                        alt="Vercel"
                                                        width={74}
                                                        height={16}
                                                        className="h-3.5 w-auto dark:invert"
                                                    />
                                                </span>
                                            ) : Icon ? (
                                                <Icon className="h-4 w-4 text-[var(--accent-blue)]" />
                                            ) : null}
                                            {entry.name !== "Vercel" ? entry.name : null}
                                            <span className="ml-4 text-[var(--text-muted)]">/</span>
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </section>

                <style>{`
                    .hero-logo-marquee {
                        animation: heroLogoSlide 24s linear infinite;
                    }

                    @keyframes heroLogoSlide {
                        from {
                            transform: translateX(0);
                        }
                        to {
                            transform: translateX(-50%);
                        }
                    }
                `}</style>
            </main>
        </div>
    );
};