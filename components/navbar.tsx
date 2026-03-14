"use client";
import * as React from "react";
import Link from "next/link";
import { Grid2x2PlusIcon, Sun, Moon } from "lucide-react";
import { useTheme } from "./theme-provider";
import { getMe, type MeResponse } from "@/lib/org-member-auth";

export function Navbar() {
	const [mounted, setMounted] = React.useState(false);
	const { theme, toggleTheme } = useTheme();
	const [me, setMe] = React.useState<MeResponse | null>(null);
	const [meLoaded, setMeLoaded] = React.useState(false);

	const activeMembership = React.useMemo(() => {
		const memberships = Array.isArray(me?.memberships) ? me!.memberships! : [];
		if (!memberships.length) return null;
		const activeOrgId = me?.activeOrgId ? String(me.activeOrgId) : null;
		if (activeOrgId) {
			const m = memberships.find((x) => String(x?.org?.id || '') === activeOrgId);
			if (m) return m;
		}
		return memberships[0];
	}, [me]);

	React.useEffect(() => {
		setMounted(true);
	}, []);

	React.useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const data = await getMe();
				if (!cancelled) setMe(data);
			} finally {
				if (!cancelled) setMeLoaded(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<header className="sticky top-0 z-30 w-full border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-black backdrop-blur-sm lg:pl-0">
			<nav className="flex h-14 w-full items-center justify-between px-4 lg:px-6">
				{/* Mobile Logo */}
				<Link href="/" className="flex items-center gap-2 lg:hidden" aria-label="home">
					<Grid2x2PlusIcon className="size-6 text-blue-600" />
					<span className="font-mono text-lg font-bold text-slate-900 dark:text-white">Sprint</span>
				</Link>

				{/* Mobile Spacer to avoid overlap with sidebar toggle */}
				<div className="lg:hidden w-8" />

				{/* Desktop Spacer (to push profile + theme toggle to right) */}
				<div className="hidden lg:block flex-1" />

				{/* Profile */}
				{me?.user ? (
					<div className="flex items-center gap-3 mr-2">
						<div className="hidden sm:block text-right leading-tight">
							<p className="text-sm font-semibold text-slate-900 dark:text-white">
								{me.user.fullName || me.user.email}
							</p>
							<p className="text-xs text-slate-600 dark:text-slate-300">
								{activeMembership?.org?.name || activeMembership?.org?.slug ? (
									activeMembership.org.name || activeMembership.org.slug
								) : (
									<Link href="/settings/org" className="hover:underline">
										Create Org
									</Link>
								)}
							</p>
						</div>
						<div className="w-9 h-9 rounded-full border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 flex items-center justify-center text-sm font-bold text-slate-900 dark:text-white">
							{String(me.user.fullName || me.user.email || "U")
								.trim()
								.slice(0, 1)
								.toUpperCase()}
						</div>
					</div>
				) : meLoaded ? (
					<div className="mr-2">
						<Link href="/auth/sign-in" className="text-sm font-semibold text-slate-900 dark:text-white hover:underline">
							Sign In
						</Link>
					</div>
				) : null}

				{/* Theme Toggle */}
				<div className="flex items-center gap-2">
					<button
						onClick={toggleTheme}
						className="p-2 rounded-lg border border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-900 transition text-slate-700 dark:text-slate-300"
						aria-label="Toggle theme"
					>
						{mounted && (theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />)}
						{!mounted && <div className="w-5 h-5" />}
					</button>
				</div>
			</nav>
	</header>
	);
}
