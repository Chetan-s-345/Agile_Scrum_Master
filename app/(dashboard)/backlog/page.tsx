"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreHorizontal, Plus, RefreshCw } from "lucide-react";

type Project = { id: string; name: string };
type Sprint = { id: string; name: string; startDate?: string; endDate?: string; status?: string };
type Developer = { id: string; name?: string; fullName?: string; avatarUrl?: string };
type Task = {
  id: string;
  title: string;
  status?: string;
  type?: string;
  priority?: string;
  storyPoints?: number;
  assignee?: { id: string; name?: string; avatarUrl?: string } | null;
  sprintId?: string | null;
  dueDate?: string;
  techTags?: string[];
  epicTitle?: string;
  jiraIssueKey?: string;
};

type ContainerMap = Record<string, string[]>;
type FilterState = {
  assigneeIds: string[];
  priority: string;
  label: string;
  type: string;
  epic: string;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value || 0);
}

function toTaskList(items: unknown[]): Task[] {
  return items.map((item) => {
    const rec = (item || {}) as Record<string, unknown>;
    const assigneeRaw = rec.assignee as Record<string, unknown> | null;
    return {
      id: asString(rec.id),
      title: asString(rec.title),
      status: asString(rec.status),
      type: asString(rec.type) || "task",
      priority: asString(rec.priority) || "medium",
      storyPoints: asNumber(rec.storyPoints),
      sprintId: asString(rec.sprintId) || null,
      dueDate: asString(rec.dueDate),
      techTags: Array.isArray(rec.techTags) ? (rec.techTags as string[]) : [],
      epicTitle: asString(rec.epicTitle),
      jiraIssueKey: asString(rec.jiraIssueKey),
      assignee: assigneeRaw?.id
        ? {
            id: asString(assigneeRaw.id),
            name: asString(assigneeRaw.name) || "Developer",
            avatarUrl: asString(assigneeRaw.avatarUrl),
          }
        : null,
    };
  });
}

function sprintLabel(sprint: Sprint): string {
  const start = sprint.startDate || "-";
  const end = sprint.endDate || "-";
  return `${start} → ${end}`;
}

function getContainerForTask(taskId: string, containers: ContainerMap): string {
  for (const [container, ids] of Object.entries(containers)) {
    if (ids.includes(taskId)) return container;
  }
  return "backlog";
}

export default function BacklogPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [containers, setContainers] = useState<ContainerMap>({ backlog: [] });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterState>({ assigneeIds: [], priority: "all", label: "all", type: "all", epic: "all" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: "title" | "storyPoints"; value: string } | null>(null);
  const [assigneePickerTaskId, setAssigneePickerTaskId] = useState<string | null>(null);
  const [visibleBacklogCount, setVisibleBacklogCount] = useState(25);
  const [toast, setToast] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ taskId: string; x: number; y: number } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const filteredTaskIds = useMemo(() => {
    return tasks
      .filter((task) => {
        if (filters.assigneeIds.length && (!task.assignee?.id || !filters.assigneeIds.includes(task.assignee.id))) return false;
        if (filters.priority !== "all" && task.priority !== filters.priority) return false;
        if (filters.type !== "all" && (task.type || "task") !== filters.type) return false;
        if (filters.label !== "all") {
          const labels = task.techTags || [];
          if (!labels.includes(filters.label)) return false;
        }
        if (filters.epic !== "all" && (task.epicTitle || "none") !== filters.epic) return false;
        return true;
      })
      .map((task) => task.id);
  }, [filters, tasks]);

  const filteredIdSet = useMemo(() => new Set(filteredTaskIds), [filteredTaskIds]);

  const taskById = useMemo(() => {
    const map = new Map<string, Task>();
    tasks.forEach((task) => map.set(task.id, task));
    return map;
  }, [tasks]);

  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string }> = [];
    filters.assigneeIds.forEach((id) => {
      const dev = developers.find((d) => d.id === id);
      chips.push({ key: `assignee-${id}`, label: `Assignee: ${dev?.name || dev?.fullName || id.slice(0, 6)}` });
    });
    if (filters.priority !== "all") chips.push({ key: "priority", label: `Priority: ${filters.priority}` });
    if (filters.label !== "all") chips.push({ key: "label", label: `Label: ${filters.label}` });
    if (filters.type !== "all") chips.push({ key: "type", label: `Type: ${filters.type}` });
    if (filters.epic !== "all") chips.push({ key: "epic", label: `Epic: ${filters.epic}` });
    return chips;
  }, [developers, filters]);

  const uniqueLabels = useMemo(() => {
    const labels = new Set<string>();
    tasks.forEach((task) => (task.techTags || []).forEach((label) => labels.add(label)));
    return Array.from(labels).sort();
  }, [tasks]);

  const uniqueTypes = useMemo(() => {
    const values = new Set<string>();
    tasks.forEach((task) => values.add(task.type || "task"));
    return Array.from(values).sort();
  }, [tasks]);

  const uniqueEpics = useMemo(() => {
    const values = new Set<string>();
    tasks.forEach((task) => values.add(task.epicTitle || "none"));
    return Array.from(values).sort();
  }, [tasks]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function onClickAnywhere() {
      setContextMenu(null);
    }
    document.addEventListener("click", onClickAnywhere);
    return () => document.removeEventListener("click", onClickAnywhere);
  }, []);

  useEffect(() => {
    let ignore = false;
    async function loadStaticData() {
      const [projectsResp, devResp] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/developers", { cache: "no-store" }),
      ]);
      const projectsData = await projectsResp.json().catch(() => null) as { items?: Project[] } | null;
      const devData = await devResp.json().catch(() => null) as { items?: Developer[] } | null;
      if (ignore) return;
      const pItems = Array.isArray(projectsData?.items) ? projectsData!.items : [];
      setProjects(pItems);
      if (!projectId && pItems[0]?.id) setProjectId(pItems[0].id);
      setDevelopers(Array.isArray(devData?.items) ? devData!.items : []);
    }
    void loadStaticData();
    return () => {
      ignore = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function refreshData() {
    setLoading(true);
    setError(null);
    try {
      const [sprintsResp, tasksResp] = await Promise.all([
        fetch(`/api/sprints?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
        fetch(`/api/tasks?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
      ]);
      const sprintsData = await sprintsResp.json().catch(() => null) as { items?: Sprint[] } | null;
      const tasksData = await tasksResp.json().catch(() => null) as { items?: unknown[] } | null;

      const sprintItems = Array.isArray(sprintsData?.items) ? sprintsData!.items : [];
      const taskItems = toTaskList(Array.isArray(tasksData?.items) ? tasksData!.items : []);
      setSprints(sprintItems);
      setTasks(taskItems);

      const nextContainers: ContainerMap = { backlog: [] };
      sprintItems.forEach((sprint) => {
        nextContainers[`sprint-${sprint.id}`] = [];
      });

      taskItems.forEach((task) => {
        const key = task.sprintId ? `sprint-${task.sprintId}` : "backlog";
        if (!nextContainers[key]) nextContainers[key] = [];
        nextContainers[key].push(task.id);
      });

      setContainers(nextContainers);
      setSelectedIds([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load backlog");
    } finally {
      setLoading(false);
    }
  }

  async function patchTask(taskId: string, patch: Record<string, unknown>, successMessage?: string) {
    const resp = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null) as { error?: string } | null;
      throw new Error(data?.error || "Task update failed");
    }
    if (successMessage) setToast(successMessage);
  }

  async function saveInlineEdit() {
    if (!editing) return;
    try {
      if (editing.field === "title") {
        await patchTask(editing.id, { title: editing.value }, "Title updated");
      }
      if (editing.field === "storyPoints") {
        const nextPoints = Math.max(0, Number(editing.value || 0));
        await patchTask(editing.id, { storyPoints: nextPoints }, "Story points updated");
      }
      await refreshData();
      setEditing(null);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function onSelectAssignee(task: Task, developerId: string) {
    try {
      if (!task.sprintId) {
        setToast("Assigning backlog tasks requires sprint context");
        return;
      }
      const resp = await fetch("/api/assignment/assign-explicit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, sprintId: task.sprintId, developerId }),
      });
      if (!resp.ok) throw new Error("Failed to assign");
      setAssigneePickerTaskId(null);
      setToast("Assignee updated");
      await refreshData();
    } catch {
      setToast("Assignee update failed");
    }
  }

  async function onReorder(containerId: string, orderedIds: string[]) {
    setContainers((prev) => ({ ...prev, [containerId]: orderedIds }));
    await fetch("/api/tasks/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
  }

  async function onMoveTask(taskId: string, destinationContainer: string) {
    const sprintId = destinationContainer.startsWith("sprint-") ? destinationContainer.replace("sprint-", "") : null;
    const resp = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sprintId }),
    });

    if (!resp.ok) {
      setToast("Move persisted locally only (backend sprint move unsupported)");
    } else {
      setToast("Task moved");
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id || "");
    if (!activeId) return;

    const overId = String(event.over?.id || "");
    if (!overId) return;

    const sourceContainer = getContainerForTask(activeId, containers);
    const targetContainer = containers[overId] ? overId : getContainerForTask(overId, containers);
    if (!targetContainer) return;

    if (sourceContainer === targetContainer) {
      const sourceItems = containers[sourceContainer] || [];
      const oldIndex = sourceItems.indexOf(activeId);
      const newIndex = sourceItems.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return;
      const next = arrayMove(sourceItems, oldIndex, newIndex);
      await onReorder(sourceContainer, next);
      return;
    }

    const sourceItems = containers[sourceContainer] || [];
    const targetItems = containers[targetContainer] || [];
    const nextSource = sourceItems.filter((id) => id !== activeId);
    const targetIndex = targetItems.indexOf(overId);
    const nextTarget = [...targetItems];
    if (targetIndex >= 0) nextTarget.splice(targetIndex, 0, activeId);
    else nextTarget.push(activeId);

    setContainers((prev) => ({
      ...prev,
      [sourceContainer]: nextSource,
      [targetContainer]: nextTarget,
    }));

    await onMoveTask(activeId, targetContainer);
  }

  function toggleAssigneeFilter(id: string) {
    setFilters((prev) => {
      const exists = prev.assigneeIds.includes(id);
      const assigneeIds = exists ? prev.assigneeIds.filter((x) => x !== id) : [...prev.assigneeIds, id];
      return { ...prev, assigneeIds };
    });
  }

  function clearFilters() {
    setFilters({ assigneeIds: [], priority: "all", label: "all", type: "all", epic: "all" });
  }

  function removeChip(chipKey: string) {
    if (chipKey.startsWith("assignee-")) {
      const id = chipKey.replace("assignee-", "");
      setFilters((prev) => ({ ...prev, assigneeIds: prev.assigneeIds.filter((x) => x !== id) }));
      return;
    }
    if (chipKey === "priority") setFilters((prev) => ({ ...prev, priority: "all" }));
    if (chipKey === "label") setFilters((prev) => ({ ...prev, label: "all" }));
    if (chipKey === "type") setFilters((prev) => ({ ...prev, type: "all" }));
    if (chipKey === "epic") setFilters((prev) => ({ ...prev, epic: "all" }));
  }

  async function applyBulkAssign(developerId: string) {
    const selectedTasks = selectedIds.map((id) => taskById.get(id)).filter(Boolean) as Task[];
    const withSprint = selectedTasks.filter((task) => task.sprintId);
    if (!withSprint.length) {
      setToast("No sprint-scoped tasks selected");
      return;
    }

    await Promise.all(
      withSprint.map((task) =>
        fetch("/api/assignment/assign-explicit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: task.id, sprintId: task.sprintId, developerId }),
        })
      )
    );
    setToast("Bulk assign applied");
    await refreshData();
  }

  async function applyBulkMove(sprintId: string) {
    const resp = await fetch("/api/tasks/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selectedIds, sprintId }),
    });
    if (!resp.ok) setToast("Bulk move may be partially unsupported by backend");
    else setToast("Bulk move requested");
    await refreshData();
  }

  async function applyBulkPriority(priority: string) {
    const resp = await fetch("/api/tasks/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selectedIds, priority }),
    });
    if (!resp.ok) setToast("Bulk priority update failed");
    else setToast("Priority updated");
    await refreshData();
  }

  async function applyBulkDelete() {
    const resp = await fetch("/api/tasks/bulk", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selectedIds }),
    });
    if (!resp.ok) setToast("Bulk delete failed");
    else setToast("Deleted selected tasks");
    await refreshData();
  }

  function getVisibleIds(containerId: string) {
    const ids = containers[containerId] || [];
    const filtered = ids.filter((id) => filteredIdSet.has(id));
    if (containerId === "backlog") return filtered.slice(0, visibleBacklogCount);
    return filtered;
  }

  const backlogVisibleIds = getVisibleIds("backlog");
  const hasMoreBacklog = (containers.backlog || []).filter((id) => filteredIdSet.has(id)).length > backlogVisibleIds.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[#121212] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-xs text-white">
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>

          {developers.slice(0, 8).map((dev) => {
            const active = filters.assigneeIds.includes(dev.id);
            return (
              <button key={dev.id} onClick={() => toggleAssigneeFilter(dev.id)} className={`rounded-full border px-2 py-1 text-[11px] ${active ? "border-white bg-white text-black" : "border-[var(--border)] text-[#bbb]"}`}>
                {(dev.name || dev.fullName || "D").slice(0, 2).toUpperCase()}
              </button>
            );
          })}

          <select value={filters.priority} onChange={(e) => setFilters((prev) => ({ ...prev, priority: e.target.value }))} className="rounded-md border border-[var(--border)] bg-[#151515] px-2 py-2 text-xs text-white">
            <option value="all">Priority</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select value={filters.label} onChange={(e) => setFilters((prev) => ({ ...prev, label: e.target.value }))} className="rounded-md border border-[var(--border)] bg-[#151515] px-2 py-2 text-xs text-white">
            <option value="all">Label</option>
            {uniqueLabels.map((label) => <option key={label} value={label}>{label}</option>)}
          </select>

          <select value={filters.type} onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))} className="rounded-md border border-[var(--border)] bg-[#151515] px-2 py-2 text-xs text-white">
            <option value="all">Type</option>
            {uniqueTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>

          <select value={filters.epic} onChange={(e) => setFilters((prev) => ({ ...prev, epic: e.target.value }))} className="rounded-md border border-[var(--border)] bg-[#151515] px-2 py-2 text-xs text-white">
            <option value="all">Epic</option>
            {uniqueEpics.map((epic) => <option key={epic} value={epic}>{epic}</option>)}
          </select>

          <button onClick={clearFilters} className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[#bbb]">Clear filters</button>
          <button onClick={() => void refreshData()} className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[#bbb]"><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>

        <button className="inline-flex items-center gap-1 rounded-md border border-white bg-white px-3 py-2 text-xs font-semibold text-black">
          <Plus className="h-3.5 w-3.5" /> Create Task
        </button>
      </div>

      {activeChips.length ? (
        <div className="flex flex-wrap gap-2">
          {activeChips.map((chip) => (
            <button key={chip.key} onClick={() => removeChip(chip.key)} className="rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-[11px] text-[#d3d3d3]">
              {chip.label} ×
            </button>
          ))}
        </div>
      ) : null}

      {error ? <div className="rounded-md border border-[#6a2626] bg-[#2a1515] px-3 py-2 text-xs text-[#ffc4c4]">{error}</div> : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void handleDragEnd(event)}>
        {sprints.map((sprint) => {
          const containerId = `sprint-${sprint.id}`;
          const ids = getVisibleIds(containerId);
          const taskCount = ids.length;
          const points = ids.reduce((sum, id) => sum + Number(taskById.get(id)?.storyPoints || 0), 0);
          const isCollapsed = collapsed[containerId] ?? false;

          return (
            <div key={sprint.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#222] px-3 py-2">
                <button onClick={() => setCollapsed((prev) => ({ ...prev, [containerId]: !isCollapsed }))} className="text-left">
                  <p className="text-sm font-semibold text-white">{sprint.name}</p>
                  <p className="text-[11px] text-[#8f8f8f]">{sprintLabel(sprint)} • {taskCount} tasks • {points} points</p>
                </button>
                <div className="flex gap-2">
                  <button onClick={() => fetch(`/api/sprints/${encodeURIComponent(sprint.id)}/start`, { method: "PATCH" })} className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[#cfcfcf]">Start Sprint</button>
                  <button onClick={() => fetch(`/api/sprints/${encodeURIComponent(sprint.id)}/complete`, { method: "PATCH" })} className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[#cfcfcf]">Complete Sprint</button>
                </div>
              </div>

              {!isCollapsed ? (
                <div className="p-2">
                  <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                    {ids.map((taskId, index) => {
                      const task = taskById.get(taskId);
                      if (!task) return null;
                      return (
                        <TaskRow
                          key={task.id}
                          task={task}
                          index={index}
                          selected={selectedIds.includes(task.id)}
                          editing={editing}
                          assigneePickerTaskId={assigneePickerTaskId}
                          developers={developers}
                          onToggleSelected={() => {
                            setSelectedIds((prev) => (prev.includes(task.id) ? prev.filter((x) => x !== task.id) : [...prev, task.id]));
                          }}
                          onEdit={(field, value) => setEditing({ id: task.id, field, value })}
                          onSaveInlineEdit={() => void saveInlineEdit()}
                          onAssigneePicker={() => setAssigneePickerTaskId((prev) => (prev === task.id ? null : task.id))}
                          onSelectAssignee={(developerId) => void onSelectAssignee(task, developerId)}
                          onContextMenu={(x, y) => setContextMenu({ taskId: task.id, x, y })}
                        />
                      );
                    })}
                  </SortableContext>
                </div>
              ) : null}
            </div>
          );
        })}

        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="border-b border-[#222] px-3 py-2">
            <p className="text-sm font-semibold text-white">Backlog</p>
            <p className="text-[11px] text-[#8f8f8f]">Unassigned tasks</p>
          </div>
          <div className="p-2">
            <SortableContext items={backlogVisibleIds} strategy={verticalListSortingStrategy}>
              {backlogVisibleIds.map((taskId, index) => {
                const task = taskById.get(taskId);
                if (!task) return null;
                return (
                  <TaskRow
                    key={task.id}
                    task={task}
                    index={index}
                    selected={selectedIds.includes(task.id)}
                    editing={editing}
                    assigneePickerTaskId={assigneePickerTaskId}
                    developers={developers}
                    onToggleSelected={() => {
                      setSelectedIds((prev) => (prev.includes(task.id) ? prev.filter((x) => x !== task.id) : [...prev, task.id]));
                    }}
                    onEdit={(field, value) => setEditing({ id: task.id, field, value })}
                    onSaveInlineEdit={() => void saveInlineEdit()}
                    onAssigneePicker={() => setAssigneePickerTaskId((prev) => (prev === task.id ? null : task.id))}
                    onSelectAssignee={(developerId) => void onSelectAssignee(task, developerId)}
                    onContextMenu={(x, y) => setContextMenu({ taskId: task.id, x, y })}
                  />
                );
              })}
            </SortableContext>

            {hasMoreBacklog ? (
              <button onClick={() => setVisibleBacklogCount((prev) => prev + 25)} className="mt-2 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[#c9c9c9]">
                Load more
              </button>
            ) : null}
          </div>
        </div>
      </DndContext>

      {selectedIds.length ? (
        <div className="fixed bottom-4 left-1/2 z-20 w-full max-w-3xl -translate-x-1/2 rounded-md border border-[var(--border)] bg-[#121212] px-3 py-2 shadow-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-white">{selectedIds.length} tasks selected</span>
            <select onChange={(e) => e.target.value && void applyBulkAssign(e.target.value)} className="rounded border border-[var(--border)] bg-[#181818] px-2 py-1 text-[#ddd]">
              <option value="">Assign to</option>
              {developers.map((dev) => <option key={dev.id} value={dev.id}>{dev.name || dev.fullName || dev.id.slice(0, 6)}</option>)}
            </select>
            <select onChange={(e) => e.target.value && void applyBulkMove(e.target.value)} className="rounded border border-[var(--border)] bg-[#181818] px-2 py-1 text-[#ddd]">
              <option value="">Move to Sprint</option>
              {sprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}</option>)}
            </select>
            <select onChange={(e) => e.target.value && void applyBulkPriority(e.target.value)} className="rounded border border-[var(--border)] bg-[#181818] px-2 py-1 text-[#ddd]">
              <option value="">Set Priority</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <button onClick={() => void applyBulkDelete()} className="rounded border border-[#5f2a2a] bg-[#2a1515] px-2 py-1 text-[#ffc4c4]">Delete</button>
          </div>
        </div>
      ) : null}

      {contextMenu ? (
        <div style={{ left: contextMenu.x, top: contextMenu.y }} className="fixed z-30 w-44 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-1.5 shadow-2xl">
          <button className="block w-full rounded px-2 py-1.5 text-left text-xs text-[#ddd] hover:bg-[#1f1f1f]">Open task</button>
          <button className="block w-full rounded px-2 py-1.5 text-left text-xs text-[#ddd] hover:bg-[#1f1f1f]">Edit inline</button>
          <button className="block w-full rounded px-2 py-1.5 text-left text-xs text-[#ddd] hover:bg-[#1f1f1f]">Move to Sprint ▶</button>
          <button className="block w-full rounded px-2 py-1.5 text-left text-xs text-[#ddd] hover:bg-[#1f1f1f]">Duplicate task</button>
          <button className="block w-full rounded px-2 py-1.5 text-left text-xs text-[#ddd] hover:bg-[#1f1f1f]">Copy task link</button>
          <button className="block w-full rounded px-2 py-1.5 text-left text-xs text-[#ffb9b9] hover:bg-[#2a1515]">Delete task</button>
        </div>
      ) : null}

      {loading ? <p className="text-xs text-[#8f8f8f]">Loading...</p> : null}
      {toast ? <div className="fixed bottom-4 right-4 z-20 rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-xs text-white">{toast}</div> : null}
    </div>
  );
}

function TaskRow({
  task,
  index,
  selected,
  editing,
  assigneePickerTaskId,
  developers,
  onToggleSelected,
  onEdit,
  onSaveInlineEdit,
  onAssigneePicker,
  onSelectAssignee,
  onContextMenu,
}: {
  task: Task;
  index: number;
  selected: boolean;
  editing: { id: string; field: "title" | "storyPoints"; value: string } | null;
  assigneePickerTaskId: string | null;
  developers: Developer[];
  onToggleSelected: () => void;
  onEdit: (field: "title" | "storyPoints", value: string) => void;
  onSaveInlineEdit: () => void;
  onAssigneePicker: () => void;
  onSelectAssignee: (developerId: string) => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const { setNodeRef, transform, transition, listeners, attributes } = useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const issueKey = task.jiraIssueKey || `SCRUM-${index + 1}`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event.clientX, event.clientY);
      }}
      className="mb-1 grid grid-cols-[20px_20px_18px_90px_minmax(180px,1fr)_80px_64px_100px_110px_24px] items-center gap-2 rounded border border-[var(--border)] bg-[#151515] px-2 py-2 text-xs"
    >
      <button {...attributes} {...listeners} className="text-[#8f8f8f]"><GripVertical className="h-3.5 w-3.5" /></button>
      <input type="checkbox" checked={selected} onChange={onToggleSelected} className="h-3.5 w-3.5 accent-white" />
      <span className="text-[#9d9d9d]">{(task.type || "task").slice(0, 1).toUpperCase()}</span>
      <span className="truncate text-[#bfbfbf]">{issueKey}</span>

      {editing?.id === task.id && editing.field === "title" ? (
        <input
          autoFocus
          value={editing.value}
          onChange={(e) => onEdit("title", e.target.value)}
          onBlur={onSaveInlineEdit}
          onKeyDown={(e) => e.key === "Enter" && onSaveInlineEdit()}
          className="rounded border border-[var(--border-strong)] bg-[#101010] px-2 py-1 text-xs text-white"
        />
      ) : (
        <button onClick={() => onEdit("title", task.title)} className="truncate text-left text-white hover:underline">{task.title}</button>
      )}

      <span className="truncate rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[#ddd]">{task.priority || "medium"}</span>

      {editing?.id === task.id && editing.field === "storyPoints" ? (
        <input
          autoFocus
          type="number"
          min={0}
          value={editing.value}
          onChange={(e) => onEdit("storyPoints", e.target.value)}
          onBlur={onSaveInlineEdit}
          onKeyDown={(e) => e.key === "Enter" && onSaveInlineEdit()}
          className="w-14 rounded border border-[var(--border-strong)] bg-[#101010] px-1 py-1 text-right text-xs text-white"
        />
      ) : (
        <button onClick={() => onEdit("storyPoints", String(task.storyPoints || 0))} className="text-right text-[#e5e5e5]">{Number(task.storyPoints || 0)}</button>
      )}

      <div className="relative">
        <button onClick={onAssigneePicker} className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-[11px] text-[#d0d0d0]">
          {(task.assignee?.name || "UN").slice(0, 2).toUpperCase()}
        </button>
        {assigneePickerTaskId === task.id ? (
          <div className="absolute left-0 top-7 z-10 min-w-40 rounded-md border border-[var(--border)] bg-[#121212] p-1">
            {developers.map((dev) => (
              <button key={dev.id} onClick={() => onSelectAssignee(dev.id)} className="block w-full rounded px-2 py-1 text-left text-[11px] text-[#ddd] hover:bg-[#1f1f1f]">
                {dev.name || dev.fullName || dev.id.slice(0, 6)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <span className="text-[11px] text-[#a9a9a9]">{task.dueDate || "-"}</span>
      <button className="text-[#9f9f9f]"><MoreHorizontal className="h-4 w-4" /></button>
    </div>
  );
}
