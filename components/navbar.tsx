"use client";
import * as React from "react";
import Link from "next/link";
import { Grid2x2PlusIcon, Sun, Moon } from "lucide-react";
import { useTheme } from "./theme-provider";

export function Navbar() {
	const [mounted, setMounted] = React.useState(false);
	const { theme, toggleTheme } = useTheme();

	React.useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setMounted(true);
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

				{/* Desktop Spacer (to push theme toggle to right) */}
				<div className="hidden lg:block flex-1" />

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
