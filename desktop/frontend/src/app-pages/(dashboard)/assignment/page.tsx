"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

type Developer = {
	id: string;
	name: string;
	capacity: number;
};

type Task = {
	id: string;
	title: string;
	sprintId?: string;
	sprintName?: string;
	status: string;
	priority: string;
	storyPoints: number;
	assignee?: { id: string; name?: string | null } | null;
};

type Sprint = {
	id: string;
	name: string;
	status: string;
};

type AssignmentGroup = {
	developer: Developer;
	tasks: Task[];
};

function asString(value: unknown, fallback = "") {
	const text = String(value ?? fallback).trim();
	return text || fallback;
}

function toFiniteNumber(value: unknown, fallback = 0) {
	const num = Number(value);
	return Number.isFinite(num) ? num : fallback;
}

function normalizeTask(value: unknown, fallbackDeveloper?: Developer): Task {
	const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	const assigneeRaw = raw.assignee && typeof raw.assignee === "object" ? (raw.assignee as Record<string, unknown>) : null;

	return {
		id: asString(raw.id),
		title: asString(raw.title, "Untitled Task"),
		sprintId: asString(raw.sprintId || raw.sprint_id || "") || undefined,
		sprintName: asString(raw.sprintName || raw.sprint_name || "") || undefined,
		status: asString(raw.status, "todo"),
		priority: asString(raw.priority, "medium"),
		storyPoints: Math.max(0, toFiniteNumber(raw.storyPoints || raw.story_points, 0)),
		assignee: assigneeRaw
			? {
					id: asString(assigneeRaw.id),
					name: asString(assigneeRaw.name || "") || null,
				}
			: fallbackDeveloper
				? { id: fallbackDeveloper.id, name: fallbackDeveloper.name }
				: null,
	};
}

function normalizeSprintList(payload: unknown): Sprint[] {
	if (!Array.isArray(payload)) return [];

	return payload
		.map((item) => {
			const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
			return {
				id: asString(raw.id),
				name: asString(raw.name || "Sprint"),
				status: asString(raw.status || "planning"),
			};
		})
		.filter((item) => Boolean(item.id));
}

function normalizeAssignmentGroups(payload: unknown): AssignmentGroup[] {
	if (!Array.isArray(payload)) return [];

	const groups = payload
		.map((item) => {
			const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
			const developerRaw = raw.developer && typeof raw.developer === "object" ? (raw.developer as Record<string, unknown>) : {};

			const developer: Developer = {
				id: asString(developerRaw.id),
				name: asString(developerRaw.name || "Developer"),
				capacity: Math.max(1, toFiniteNumber(developerRaw.capacity, 20)),
			};

			const tasksRaw = Array.isArray(raw.tasks) ? raw.tasks : [];
			const tasks = tasksRaw
				.map((task) => normalizeTask(task, developer))
				.filter((task) => Boolean(task.id));

			return {
				developer,
				tasks,
			};
		})
		.filter((group) => Boolean(group.developer.id));

	groups.sort((a, b) => a.developer.name.localeCompare(b.developer.name));
	return groups;
}

function statusBadgeClass(status: string) {
	const normalized = asString(status).toLowerCase();
	if (normalized.includes("done") || normalized.includes("complete") || normalized.includes("closed")) {
		return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200";
	}
	if (normalized.includes("progress") || normalized.includes("review")) {
		return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200";
	}
	if (normalized.includes("block")) {
		return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200";
	}
	return "bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-slate-200";
}

function priorityBadgeClass(priority: string) {
	const normalized = asString(priority).toLowerCase();
	if (normalized === "critical") return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200";
	if (normalized === "high") return "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200";
	if (normalized === "low") return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200";
	return "bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-slate-200";
}

function isCompletedStatus(status: string) {
	const normalized = asString(status).toLowerCase();
	return normalized.includes("done") || normalized.includes("complete") || normalized.includes("closed");
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
	if (typeof window === "undefined" || !window.desktopApi?.invoke) {
		throw new Error("Desktop IPC bridge is unavailable");
	}

	return window.desktopApi.invoke<T>(channel, payload);
}

export default function AssignmentOverviewPage() {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);

	const [sprints, setSprints] = useState<Sprint[]>([]);
	const [selectedSprintId, setSelectedSprintId] = useState("");
	const [statusFilter, setStatusFilter] = useState("all");
	const [priorityFilter, setPriorityFilter] = useState("all");

	const [groups, setGroups] = useState<AssignmentGroup[]>([]);
	const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
	const [reassigningTaskId, setReassigningTaskId] = useState<string | null>(null);

	const toastTimerRef = useRef<number | null>(null);

	const allDevelopers = useMemo(() => {
		const map = new Map<string, Developer>();
		for (const group of groups) {
			if (!map.has(group.developer.id)) {
				map.set(group.developer.id, group.developer);
			}
		}
		return [...map.values()];
	}, [groups]);

	const filteredGroups = useMemo(() => {
		return groups.map((group) => {
			const tasks = group.tasks.filter((task) => {
				if (statusFilter !== "all" && asString(task.status).toLowerCase() !== asString(statusFilter).toLowerCase()) {
					return false;
				}
				if (priorityFilter !== "all" && asString(task.priority).toLowerCase() !== asString(priorityFilter).toLowerCase()) {
					return false;
				}
				return true;
			});

			return {
				...group,
				tasks,
			};
		});
	}, [groups, priorityFilter, statusFilter]);

	const hasVisibleAssignments = useMemo(() => filteredGroups.some((group) => group.tasks.length > 0), [filteredGroups]);

	function showToast(message: string) {
		setToast(message);
		if (toastTimerRef.current) {
			window.clearTimeout(toastTimerRef.current);
		}
		toastTimerRef.current = window.setTimeout(() => {
			setToast(null);
			toastTimerRef.current = null;
		}, 2200);
	}

	async function loadSprintList() {
		const sprintPayload = await invokeDesktop<unknown>("assignment:getSprintList");
		setSprints(normalizeSprintList(sprintPayload));
	}

	async function loadAssignments(sprintId: string) {
		const payload = sprintId ? { sprintId } : undefined;
		const groupsPayload = await invokeDesktop<unknown>("assignment:getAllAssignments", payload);
		setGroups(normalizeAssignmentGroups(groupsPayload));
	}

	async function loadAll(nextSprintId = selectedSprintId) {
		setLoading(true);
		setError(null);

		try {
			await Promise.all([loadSprintList(), loadAssignments(nextSprintId)]);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load assignments");
		} finally {
			setLoading(false);
		}
	}

	async function handleSprintChange(nextSprintId: string) {
		setSelectedSprintId(nextSprintId);
		setActiveTaskId(null);
		setLoading(true);
		setError(null);

		try {
			await loadAssignments(nextSprintId);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load assignments");
		} finally {
			setLoading(false);
		}
	}

	async function handleReassign(taskId: string, newDeveloperId: string) {
		if (!taskId || !newDeveloperId) return;

		setReassigningTaskId(taskId);
		setError(null);

		try {
			await invokeDesktop<unknown>("assignment:reassignTask", { taskId, newDeveloperId });
			showToast("Assignment updated successfully.");
			setActiveTaskId(null);
			await loadAssignments(selectedSprintId);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to reassign task");
		} finally {
			setReassigningTaskId(null);
		}
	}

	useEffect(() => {
		void loadAll("");
		return () => {
			if (toastTimerRef.current) {
				window.clearTimeout(toastTimerRef.current);
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<div className="min-h-screen bg-white px-4 py-8 dark:bg-black">
			<div className="mx-auto max-w-6xl space-y-5">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h1 className="text-3xl font-bold text-slate-900 dark:text-white">Assignment Overview</h1>
						<p className="mt-1 text-slate-600 dark:text-slate-300">Current task-to-developer assignments grouped by developer.</p>
					</div>
					<button
						type="button"
						onClick={() => void loadAll(selectedSprintId)}
						disabled={loading}
						className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
					>
						<RefreshCw className="h-4 w-4" /> Refresh
					</button>
				</div>

				{error ? (
					<div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
						{error}
					</div>
				) : null}

				<div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
					<div className="grid grid-cols-1 gap-3 md:grid-cols-3">
						<label>
							<div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Sprint</div>
							<select
								value={selectedSprintId}
								onChange={(event) => void handleSprintChange(event.target.value)}
								className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-zinc-800 dark:bg-black dark:text-white"
							>
								<option value="">All sprints</option>
								{sprints.map((sprint) => (
									<option key={sprint.id} value={sprint.id}>
										{sprint.name} ({sprint.status})
									</option>
								))}
							</select>
						</label>

						<label>
							<div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Status</div>
							<select
								value={statusFilter}
								onChange={(event) => setStatusFilter(event.target.value)}
								className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-zinc-800 dark:bg-black dark:text-white"
							>
								<option value="all">All status</option>
								<option value="todo">todo</option>
								<option value="in_progress">in_progress</option>
								<option value="in_review">in_review</option>
								<option value="blocked">blocked</option>
								<option value="done">done</option>
							</select>
						</label>

						<label>
							<div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Priority</div>
							<select
								value={priorityFilter}
								onChange={(event) => setPriorityFilter(event.target.value)}
								className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-zinc-800 dark:bg-black dark:text-white"
							>
								<option value="all">All priority</option>
								<option value="critical">critical</option>
								<option value="high">high</option>
								<option value="medium">medium</option>
								<option value="low">low</option>
							</select>
						</label>
					</div>
				</div>

				{loading ? <div className="text-sm text-slate-600 dark:text-slate-300">Loading assignments...</div> : null}
				{!loading && !hasVisibleAssignments ? (
					<div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-slate-300">
						No assignments found for the selected filters.
					</div>
				) : null}

				{!loading
					? filteredGroups.map((group) => {
							const totalTasks = group.tasks.length;
							const totalPoints = group.tasks.reduce((sum, task) => sum + Math.max(0, Number(task.storyPoints || 0)), 0);
							const completedTasks = group.tasks.filter((task) => isCompletedStatus(task.status)).length;
							const completionPct = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
							const capacity = Math.max(1, Number(group.developer.capacity || 1));
							const utilizationPct = Math.max(0, Math.min(100, Math.round((totalPoints / capacity) * 100)));

							return (
								<section key={group.developer.id} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div>
											<h2 className="text-lg font-semibold text-slate-900 dark:text-white">{group.developer.name}</h2>
											<div className="mt-1 text-xs text-slate-600 dark:text-slate-300">Developer ID: {group.developer.id}</div>
										</div>
										<div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-700 dark:text-slate-200 sm:grid-cols-4">
											<div>Total tasks: {totalTasks}</div>
											<div>Total points: {totalPoints}</div>
											<div>Completion: {completionPct}%</div>
											<div>Capacity: {capacity}</div>
										</div>
									</div>

									<div className="mt-3">
										<div className="mb-1 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
											<span>Capacity utilization</span>
											<span>
												{totalPoints}/{capacity} points
											</span>
										</div>
										<div className="h-2 w-full overflow-hidden rounded bg-slate-200 dark:bg-zinc-800">
											<div className="h-full bg-slate-900 dark:bg-white" style={{ width: `${utilizationPct}%` }} />
										</div>
									</div>

									{group.tasks.length ? (
										<div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-zinc-800">
											<table className="min-w-full text-sm">
												<thead className="bg-slate-50 dark:bg-black/40">
													<tr>
														<th className="px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-200">Task</th>
														<th className="px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-200">Sprint</th>
														<th className="px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-200">Status</th>
														<th className="px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-200">Priority</th>
														<th className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">Points</th>
														<th className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">Reassign</th>
													</tr>
												</thead>
												<tbody>
													{group.tasks.map((task) => (
														<tr
															key={task.id}
															onClick={() => setActiveTaskId(task.id)}
															className="cursor-pointer border-t border-slate-200 dark:border-zinc-800"
														>
															<td className="px-3 py-3 align-top text-slate-900 dark:text-white">{task.title}</td>
															<td className="px-3 py-3 align-top text-slate-600 dark:text-slate-300">{task.sprintName || task.sprintId || "-"}</td>
															<td className="px-3 py-3 align-top">
																<span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(task.status)}`}>
																	{task.status}
																</span>
															</td>
															<td className="px-3 py-3 align-top">
																<span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${priorityBadgeClass(task.priority)}`}>
																	{task.priority}
																</span>
															</td>
															<td className="px-3 py-3 text-right align-top text-slate-900 dark:text-white">{task.storyPoints}</td>
															<td className="px-3 py-3 text-right align-top" onClick={(event) => event.stopPropagation()}>
																{activeTaskId === task.id ? (
																	<select
																		value={task.assignee?.id || ""}
																		disabled={reassigningTaskId === task.id}
																		onChange={(event) => void handleReassign(task.id, event.target.value)}
																		className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-zinc-800 dark:bg-black dark:text-white"
																	>
																		<option value="">Select developer</option>
																		{allDevelopers.map((developer) => (
																			<option key={developer.id} value={developer.id}>
																				{developer.name}
																			</option>
																		))}
																	</select>
																) : (
																	<button
																		type="button"
																		onClick={() => setActiveTaskId(task.id)}
																		className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-zinc-700 dark:text-slate-200"
																	>
																		Reassign
																	</button>
																)}
															</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									) : (
										<div className="mt-4 text-sm text-slate-600 dark:text-slate-300">No tasks for this developer under current filters.</div>
									)}
								</section>
							);
						})
					: null}
			</div>

			{toast ? (
				<div className="fixed bottom-4 right-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-100">
					{toast}
				</div>
			) : null}
		</div>
	);
}

