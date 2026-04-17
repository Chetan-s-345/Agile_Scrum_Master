"use client";

import { useEffect, useMemo, useState } from "react";

type Sprint = { id: string; name: string };

type Task = {
	id: string;
	title: string;
	status?: string;
	sprintId?: string;
	assignee?: { id: string; name?: string } | null;
};

type GitHubPR = {
	url: string;
	branchName: string;
	prStatus: "open" | "merged" | "closed";
	reviewStatus: string;
	author: string;
};

type TaskWithPR = {
	task: Task;
	pr: GitHubPR | null;
};

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
	if (typeof window === "undefined" || !window.desktopApi?.invoke) {
		throw new Error("Desktop IPC bridge is unavailable");
	}
	return window.desktopApi.invoke<T>(channel, payload);
}

function asString(value: unknown, fallback = "") {
	const text = String(value ?? fallback).trim();
	return text || fallback;
}

function normalizeRows(payload: unknown): TaskWithPR[] {
	if (!Array.isArray(payload)) return [];

	return payload.map((row) => {
		const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
		const taskRaw = record.task && typeof record.task === "object" ? (record.task as Record<string, unknown>) : {};
		const prRaw = record.pr && typeof record.pr === "object" ? (record.pr as Record<string, unknown>) : null;
		const assigneeRaw = taskRaw.assignee && typeof taskRaw.assignee === "object" ? (taskRaw.assignee as Record<string, unknown>) : null;

		return {
			task: {
				id: asString(taskRaw.id),
				title: asString(taskRaw.title, "Untitled task"),
				status: asString(taskRaw.status, "todo"),
				sprintId: asString(taskRaw.sprintId),
				assignee: assigneeRaw?.id
					? {
							id: asString(assigneeRaw.id),
							name: asString(assigneeRaw.name, "Unassigned"),
						}
					: null,
			},
			pr: prRaw
				? {
						url: asString(prRaw.url),
						branchName: asString(prRaw.branchName, "-"),
						prStatus: asString(prRaw.prStatus, "open") as "open" | "merged" | "closed",
						reviewStatus: asString(prRaw.reviewStatus, "pending"),
						author: asString(prRaw.author, "unknown"),
					}
				: null,
		};
	});
}

export default function BoardCodePage() {
	const [rows, setRows] = useState<TaskWithPR[]>([]);
	const [sprints, setSprints] = useState<Sprint[]>([]);
	const [selectedSprintId, setSelectedSprintId] = useState("");
	const [statusFilter, setStatusFilter] = useState("all");
	const [assigneeFilter, setAssigneeFilter] = useState("all");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);

	const [linkingTaskId, setLinkingTaskId] = useState<string | null>(null);
	const [prUrlInput, setPrUrlInput] = useState("");

	const assignees = useMemo(() => {
		const map = new Map<string, string>();
		rows.forEach((row) => {
			if (!row.task.assignee?.id) return;
			map.set(row.task.assignee.id, row.task.assignee.name || "Unassigned");
		});
		return [...map.entries()].map(([id, name]) => ({ id, name }));
	}, [rows]);

	const filteredRows = useMemo(() => {
		return rows.filter((row) => {
			if (statusFilter !== "all") {
				const prStatus = row.pr?.prStatus || "none";
				if (prStatus !== statusFilter) return false;
			}

			if (assigneeFilter !== "all") {
				const assigneeId = row.task.assignee?.id || "none";
				if (assigneeId !== assigneeFilter) return false;
			}

			return true;
		});
	}, [rows, statusFilter, assigneeFilter]);

	useEffect(() => {
		if (!toast) return;
		const timer = window.setTimeout(() => setToast(null), 2200);
		return () => window.clearTimeout(timer);
	}, [toast]);

	async function loadRows(sprintId?: string) {
		setLoading(true);
		setError(null);
		try {
			const payload = sprintId ? { sprintId } : undefined;
			const data = await invokeDesktop<unknown>("board:getTasksWithPRs", payload);
			const normalized = normalizeRows(data);
			setRows(normalized);

			const sprintMap = new Map<string, Sprint>();
			normalized.forEach((row) => {
				const sid = asString(row.task.sprintId);
				if (!sid) return;
				if (sprintMap.has(sid)) return;
				sprintMap.set(sid, { id: sid, name: `Sprint ${sid}` });
			});

			const nextSprints = [...sprintMap.values()];
			setSprints(nextSprints);

			if (!selectedSprintId && nextSprints.length) {
				setSelectedSprintId(nextSprints[0].id);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load board code tasks");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void loadRows(selectedSprintId || undefined);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedSprintId]);

	async function openExternal(url: string) {
		try {
			await invokeDesktop("system:openExternal", { url });
		} catch (e) {
			setToast(e instanceof Error ? e.message : "Failed to open URL");
		}
	}

	async function submitLinkPR() {
		if (!linkingTaskId) return;
		const nextUrl = prUrlInput.trim();
		if (!nextUrl) {
			setToast("PR URL is required");
			return;
		}

		try {
			await invokeDesktop("board:linkPR", { taskId: linkingTaskId, prUrl: nextUrl });
			setLinkingTaskId(null);
			setPrUrlInput("");
			setToast("PR linked");
			await loadRows(selectedSprintId || undefined);
		} catch (e) {
			setToast(e instanceof Error ? e.message : "Failed to link PR");
		}
	}

	async function unlinkPR(taskId: string) {
		try {
			await invokeDesktop("board:unlinkPR", { taskId });
			setToast("PR unlinked");
			await loadRows(selectedSprintId || undefined);
		} catch (e) {
			setToast(e instanceof Error ? e.message : "Failed to unlink PR");
		}
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[#121212] px-4 py-3">
				<div className="flex flex-wrap items-center gap-2">
					<select
						value={selectedSprintId}
						onChange={(e) => setSelectedSprintId(e.target.value)}
						className="rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-xs text-white"
					>
						<option value="">All Sprints</option>
						{sprints.map((sprint) => (
							<option key={sprint.id} value={sprint.id}>{sprint.name}</option>
						))}
					</select>

					<select
						value={statusFilter}
						onChange={(e) => setStatusFilter(e.target.value)}
						className="rounded-md border border-[var(--border)] bg-[#151515] px-2 py-2 text-xs text-white"
					>
						<option value="all">PR Status</option>
						<option value="open">Open</option>
						<option value="merged">Merged</option>
						<option value="closed">Closed</option>
						<option value="none">Unlinked</option>
					</select>

					<select
						value={assigneeFilter}
						onChange={(e) => setAssigneeFilter(e.target.value)}
						className="rounded-md border border-[var(--border)] bg-[#151515] px-2 py-2 text-xs text-white"
					>
						<option value="all">Assignee</option>
						{assignees.map((assignee) => (
							<option key={assignee.id} value={assignee.id}>{assignee.name}</option>
						))}
					</select>

					<button onClick={() => void loadRows(selectedSprintId || undefined)} className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[#bbb]">Refresh</button>
				</div>
			</div>

			{error ? <div className="rounded-md border border-[#6a2626] bg-[#2a1515] px-3 py-2 text-xs text-[#ffc4c4]">{error}</div> : null}

			<div className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-surface)]">
				<div className="grid grid-cols-[minmax(180px,1.6fr)_minmax(180px,1.1fr)_minmax(140px,1fr)_120px_120px_120px_120px] gap-2 border-b border-[#222] px-3 py-2 text-[11px] uppercase tracking-wide text-[#8f8f8f]">
					<span>Task</span>
					<span>Linked PR</span>
					<span>Branch</span>
					<span>PR Status</span>
					<span>Review</span>
					<span>Author</span>
					<span className="text-right">Actions</span>
				</div>

				{loading ? <p className="px-3 py-3 text-xs text-[#8f8f8f]">Loading...</p> : null}

				{!loading && !filteredRows.length ? <p className="px-3 py-3 text-xs text-[#8f8f8f]">No tasks found for selected filters.</p> : null}

				{!loading ? filteredRows.map((row) => (
					<div key={row.task.id} className="grid grid-cols-[minmax(180px,1.6fr)_minmax(180px,1.1fr)_minmax(140px,1fr)_120px_120px_120px_120px] items-center gap-2 border-b border-[#222] px-3 py-2 text-xs">
						<span className="truncate text-white">{row.task.title}</span>
						{row.pr?.url ? (
							<button onClick={() => void openExternal(row.pr!.url)} className="truncate text-left text-[#8ecbff] hover:underline">
								{row.pr.url}
							</button>
						) : (
							<span className="text-[#8f8f8f]">Not linked</span>
						)}
						<span className="truncate text-[#d5d5d5]">{row.pr?.branchName || "-"}</span>
						<span className="text-[#d5d5d5]">{row.pr?.prStatus || "-"}</span>
						<span className="text-[#d5d5d5]">{row.pr?.reviewStatus || "-"}</span>
						<span className="text-[#d5d5d5]">{row.pr?.author || row.task.assignee?.name || "-"}</span>
						<div className="flex justify-end gap-1">
							<button onClick={() => { setLinkingTaskId(row.task.id); setPrUrlInput(row.pr?.url || ""); }} className="rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[#d9d9d9]">Link PR</button>
							<button onClick={() => void unlinkPR(row.task.id)} className="rounded border border-[#5f2a2a] bg-[#2a1515] px-2 py-1 text-[11px] text-[#ffc4c4]">Unlink</button>
						</div>
					</div>
				)) : null}
			</div>

			{linkingTaskId ? (
				<div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
					<div className="w-full max-w-lg rounded-md border border-[var(--border)] bg-[#121212] p-4">
						<h3 className="mb-2 text-sm font-semibold text-white">Link PR</h3>
						<input
							value={prUrlInput}
							onChange={(e) => setPrUrlInput(e.target.value)}
							placeholder="https://github.com/org/repo/pull/123"
							className="w-full rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-xs text-white"
						/>
						<div className="mt-3 flex justify-end gap-2">
							<button onClick={() => setLinkingTaskId(null)} className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[#cfcfcf]">Cancel</button>
							<button onClick={() => void submitLinkPR()} className="rounded border border-white bg-white px-3 py-1.5 text-xs font-semibold text-black">Link PR</button>
						</div>
					</div>
				</div>
			) : null}

			{toast ? <div className="fixed bottom-4 right-4 z-20 rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-xs text-white">{toast}</div> : null}
		</div>
	);
}

