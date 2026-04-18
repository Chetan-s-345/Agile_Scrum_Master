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
import { usePathname } from "@/next-shims/navigation";

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

type CreateTaskForm = {
  title: string;
  type: string;
  priority: string;
  points: string;
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

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (typeof window === "undefined" || !window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge is unavailable");
  }
  return window.desktopApi.invoke<T>(channel, payload);
}

function toTaskList(items: unknown[]): Task[] {
  return items.map((item) => {
    const rec = (item || {}) as Record<string, unknown>;
    const assigneeRaw = rec.assignee as Record<string, unknown> | null;
    const sprintRaw = rec.sprint as Record<string, unknown> | null;
    const sprintId = asString(rec.sprintId || sprintRaw?.id);
    const storyPoints = asNumber(rec.storyPoints || rec.points);
    return {
      id: asString(rec.id),
      title: asString(rec.title),
      status: asString(rec.status),
      type: asString(rec.type) || "story",
      priority: asString(rec.priority) || "medium",
      storyPoints,
      sprintId: sprintId || null,
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

function deriveDevelopers(taskItems: Task[]): Developer[] {
  const map = new Map<string, Developer>();
  for (const task of taskItems) {
    if (!task.assignee?.id) continue;
    if (map.has(task.assignee.id)) continue;
    map.set(task.assignee.id, {
      id: task.assignee.id,
      name: task.assignee.name || "Developer",
    });
  }
  return [...map.values()];
}

function deriveSprints(taskItems: Task[]): Sprint[] {
  const map = new Map<string, Sprint>();
  for (const task of taskItems) {
    if (!task.sprintId) continue;
    if (map.has(task.sprintId)) continue;
    map.set(task.sprintId, {
      id: task.sprintId,
      name: `Sprint ${task.sprintId}`,
      status: "planning",
    });
  }
  return [...map.values()];
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
  const pathname = usePathname();
  const isBoardBacklog = pathname.startsWith("/board/backlog");

  const [projects] = useState<Project[]>([{ id: "desktop", name: "Agile Scrum Master" }]);
  const [projectId, setProjectId] = useState("desktop");
  const [selectedSprintId, setSelectedSprintId] = useState("sprint-1");
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [containers, setContainers] = useState<ContainerMap>({ backlog: [] });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterState>({ assigneeIds: [], priority: "all", label: "all", type: "all", epic: "all" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: "title" | "priority" | "storyPoints"; value: string } | null>(null);
  const [assigneePickerTaskId, setAssigneePickerTaskId] = useState<string | null>(null);
  const [visibleBacklogCount, setVisibleBacklogCount] = useState(25);
  const [toast, setToast] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ taskId: string; x: number; y: number } | null>(null);
  const [addToSprintPickerTaskId, setAddToSprintPickerTaskId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<CreateTaskForm>({
    title: "",
    type: "story",
    priority: "medium",
    points: "3",
  });

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
    if (isBoardBacklog && !selectedSprintId) return;
    if (!isBoardBacklog && !projectId) return;
    void refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedSprintId, isBoardBacklog]);

  async function refreshData() {
    setLoading(true);
    setError(null);
    try {
      const items = isBoardBacklog
        ? await invokeDesktop<unknown[]>("board:getSprintBacklog", { sprintId: selectedSprintId })
        : await invokeDesktop<unknown[]>("backlog:getItems", { filters: { projectId } });
      const taskItems = toTaskList(Array.isArray(items) ? items : []);
      const sprintItems = deriveSprints(taskItems);
      const developerItems = deriveDevelopers(taskItems);
      setSprints(
        isBoardBacklog && !sprintItems.length && selectedSprintId
          ? [{ id: selectedSprintId, name: `Sprint ${selectedSprintId}`, status: "planning" }]
          : sprintItems
      );
      setDevelopers(developerItems);
      setTasks(taskItems);

      const nextContainers: ContainerMap = { backlog: [] };
      (isBoardBacklog ? (sprintItems.length ? sprintItems : [{ id: selectedSprintId, name: "", status: "planning" }]) : sprintItems).forEach((sprint) => {
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

  async function patchTask(taskId: string, changes: Record<string, unknown>, successMessage?: string) {
    await invokeDesktop("backlog:updateItem", {
      id: taskId,
      changes,
    });
    if (successMessage) setToast(successMessage);
  }

  function getGlobalOrderedIds(nextContainers: ContainerMap) {
    const sprintContainerIds = sprints.map((sprint) => `sprint-${sprint.id}`);
    const allContainerIds = [...sprintContainerIds, "backlog"];
    const ordered: string[] = [];
    allContainerIds.forEach((containerId) => {
      (nextContainers[containerId] || []).forEach((id) => {
        if (!ordered.includes(id)) ordered.push(id);
      });
    });
    return ordered;
  }

  async function saveInlineEdit() {
    if (!editing) return;
    try {
      if (editing.field === "title") {
        await patchTask(editing.id, { title: editing.value }, "Title updated");
      }
      if (editing.field === "priority") {
        await patchTask(editing.id, { priority: editing.value }, "Priority updated");
      }
      if (editing.field === "storyPoints") {
        const nextPoints = Math.max(0, Number(editing.value || 0));
        await patchTask(editing.id, { points: nextPoints }, "Story points updated");
      }
      await refreshData();
      setEditing(null);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function onSelectAssignee(task: Task, developerId: string) {
    try {
      await patchTask(task.id, { assigneeId: developerId });
      setAssigneePickerTaskId(null);
      setToast("Assignee updated");
      await refreshData();
    } catch {
      setToast("Assignee update failed");
    }
  }

  async function onReorder(containerId: string, orderedIds: string[]) {
    const nextContainers = { ...containers, [containerId]: orderedIds };
    setContainers(nextContainers);
    await invokeDesktop("backlog:reorderItems", {
      orderedIds: getGlobalOrderedIds(nextContainers),
    });
  }

  async function moveTaskToBoard(taskId: string, status: string) {
    await invokeDesktop("board:moveToBoard", {
      taskId,
      status,
    });
    setToast("Moved to board");
    await refreshData();
  }

  async function onMoveTask(taskId: string, destinationContainer: string) {
    if (isBoardBacklog) {
      const status = destinationContainer === "backlog" ? "todo" : "in_progress";
      await moveTaskToBoard(taskId, status);
      return;
    }

    const sprintId = destinationContainer.startsWith("sprint-") ? destinationContainer.replace("sprint-", "") : null;
    if (sprintId) {
      await invokeDesktop("backlog:addToSprint", { itemId: taskId, sprintId });
    } else {
      await patchTask(taskId, { sprintId: "" });
    }
    setToast("Task moved");
  }

  async function onAddTaskToSprint(taskId: string, sprintId: string) {
    if (!sprintId) return;
    try {
      await invokeDesktop("backlog:addToSprint", { itemId: taskId, sprintId });
      setAddToSprintPickerTaskId(null);
      setToast("Added to sprint");
      await refreshData();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to add to sprint");
    }
  }

  async function onMoveToBoard(taskId: string, status: string) {
    try {
      await moveTaskToBoard(taskId, status);
      setAddToSprintPickerTaskId(null);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to move task to board");
    }
  }

  async function createTask() {
    const title = createForm.title.trim();
    if (!title) {
      setToast("Title is required");
      return;
    }

    try {
      setCreating(true);
      await invokeDesktop("backlog:createItem", {
        title,
        type: createForm.type,
        priority: createForm.priority,
        points: Math.max(0, Number(createForm.points || 0)),
      });
      setCreateOpen(false);
      setCreateForm({ title: "", type: "story", priority: "medium", points: "3" });
      setToast("Task created");
      await refreshData();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to create task");
    } finally {
      setCreating(false);
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
    if (!selectedTasks.length) {
      setToast("No tasks selected");
      return;
    }

    await invokeDesktop("backlog:bulkUpdate", {
      ids: selectedTasks.map((task) => task.id),
      changes: { assigneeId: developerId },
    });
    setToast("Bulk assign applied");
    await refreshData();
  }

  async function applyBulkMove(sprintId: string) {
    await invokeDesktop("backlog:bulkUpdate", {
      ids: selectedIds,
      changes: { sprintId },
    });
    setToast("Bulk move requested");
    await refreshData();
  }

  async function applyBulkPriority(priority: string) {
    await invokeDesktop("backlog:bulkUpdate", {
      ids: selectedIds,
      changes: { priority },
    });
    setToast("Priority updated");
    await refreshData();
  }

  async function applyBulkDelete() {
    await invokeDesktop("backlog:bulkDelete", {
      ids: selectedIds,
    });
    setToast("Deleted selected tasks");
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
          <select
            value={isBoardBacklog ? selectedSprintId : projectId}
            onChange={(e) => {
              if (isBoardBacklog) setSelectedSprintId(e.target.value);
              else setProjectId(e.target.value);
            }}
            className="rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-xs text-white"
          >
            {isBoardBacklog
              ? sprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}</option>)
              : projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
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

        <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-white bg-white px-3 py-2 text-xs font-semibold text-black">
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
                  <button onClick={() => setToast("Sprint controls are not available in desktop backlog IPC")} className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[#cfcfcf]">Start Sprint</button>
                  <button onClick={() => setToast("Sprint controls are not available in desktop backlog IPC")} className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[#cfcfcf]">Complete Sprint</button>
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
                          addToSprintPickerTaskId={addToSprintPickerTaskId}
                          developers={developers}
                          sprints={sprints}
                          isBoardBacklog={isBoardBacklog}
                          onToggleSelected={() => {
                            setSelectedIds((prev) => (prev.includes(task.id) ? prev.filter((x) => x !== task.id) : [...prev, task.id]));
                          }}
                          onEdit={(field, value) => setEditing({ id: task.id, field, value })}
                          onSaveInlineEdit={() => void saveInlineEdit()}
                          onAssigneePicker={() => setAssigneePickerTaskId((prev) => (prev === task.id ? null : task.id))}
                          onAddToSprintPicker={() => setAddToSprintPickerTaskId((prev) => (prev === task.id ? null : task.id))}
                          onSelectAssignee={(developerId) => void onSelectAssignee(task, developerId)}
                          onAddToSprint={(sprintId) => void onAddTaskToSprint(task.id, sprintId)}
                          onMoveToBoard={(status) => void onMoveToBoard(task.id, status)}
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
                    addToSprintPickerTaskId={addToSprintPickerTaskId}
                    developers={developers}
                    sprints={sprints}
                    isBoardBacklog={isBoardBacklog}
                    onToggleSelected={() => {
                      setSelectedIds((prev) => (prev.includes(task.id) ? prev.filter((x) => x !== task.id) : [...prev, task.id]));
                    }}
                    onEdit={(field, value) => setEditing({ id: task.id, field, value })}
                    onSaveInlineEdit={() => void saveInlineEdit()}
                    onAssigneePicker={() => setAssigneePickerTaskId((prev) => (prev === task.id ? null : task.id))}
                    onAddToSprintPicker={() => setAddToSprintPickerTaskId((prev) => (prev === task.id ? null : task.id))}
                    onSelectAssignee={(developerId) => void onSelectAssignee(task, developerId)}
                    onAddToSprint={(sprintId) => void onAddTaskToSprint(task.id, sprintId)}
                    onMoveToBoard={(status) => void onMoveToBoard(task.id, status)}
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

      {createOpen ? (
        <div className="fixed inset-0 z-30 flex">
          <button className="h-full flex-1 bg-black/40" onClick={() => setCreateOpen(false)} aria-label="Close create drawer" />
          <div className="h-full w-full max-w-md border-l border-[var(--border)] bg-[#121212] p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Create Task</h3>
              <button onClick={() => setCreateOpen(false)} className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[#d2d2d2]">Close</button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs text-[#bdbdbd]">
                Title
                <input
                  value={createForm.title}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-xs text-white"
                />
              </label>

              <label className="block text-xs text-[#bdbdbd]">
                Type
                <select
                  value={createForm.type}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, type: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-xs text-white"
                >
                  <option value="story">Story</option>
                  <option value="bug">Bug</option>
                  <option value="task">Task</option>
                </select>
              </label>

              <label className="block text-xs text-[#bdbdbd]">
                Priority
                <select
                  value={createForm.priority}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, priority: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-xs text-white"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>

              <label className="block text-xs text-[#bdbdbd]">
                Story Points
                <input
                  type="number"
                  min={0}
                  value={createForm.points}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, points: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-xs text-white"
                />
              </label>

              <button
                disabled={creating}
                onClick={() => void createTask()}
                className="w-full rounded-md border border-white bg-white px-3 py-2 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-70"
              >
                {creating ? "Creating..." : "Create Task"}
              </button>
            </div>
          </div>
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
  addToSprintPickerTaskId,
  developers,
  sprints,
  isBoardBacklog,
  onToggleSelected,
  onEdit,
  onSaveInlineEdit,
  onAssigneePicker,
  onAddToSprintPicker,
  onSelectAssignee,
  onAddToSprint,
  onMoveToBoard,
  onContextMenu,
}: {
  task: Task;
  index: number;
  selected: boolean;
  editing: { id: string; field: "title" | "priority" | "storyPoints"; value: string } | null;
  assigneePickerTaskId: string | null;
  addToSprintPickerTaskId: string | null;
  developers: Developer[];
  sprints: Sprint[];
  isBoardBacklog: boolean;
  onToggleSelected: () => void;
  onEdit: (field: "title" | "priority" | "storyPoints", value: string) => void;
  onSaveInlineEdit: () => void;
  onAssigneePicker: () => void;
  onAddToSprintPicker: () => void;
  onSelectAssignee: (developerId: string) => void;
  onAddToSprint: (sprintId: string) => void;
  onMoveToBoard: (status: string) => void;
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

      {editing?.id === task.id && editing.field === "priority" ? (
        <select
          autoFocus
          value={editing.value}
          onChange={(e) => onEdit("priority", e.target.value)}
          onBlur={onSaveInlineEdit}
          className="truncate rounded border border-[var(--border-strong)] bg-[#101010] px-1.5 py-0.5 text-[11px] text-[#ddd]"
        >
          <option value="critical">critical</option>
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </select>
      ) : (
        <button onClick={() => onEdit("priority", task.priority || "medium")} className="truncate rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[#ddd]">{task.priority || "medium"}</button>
      )}

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
      <div className="relative">
        <button
          onClick={onAddToSprintPicker}
          className={isBoardBacklog ? "rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[#d9d9d9]" : "text-[#9f9f9f]"}
          title={isBoardBacklog ? "Move to Board" : "Add to Sprint"}
        >
          {isBoardBacklog ? "Move" : <MoreHorizontal className="h-4 w-4" />}
        </button>
        {addToSprintPickerTaskId === task.id ? (
          <div className="absolute right-0 top-6 z-10 min-w-40 rounded-md border border-[var(--border)] bg-[#121212] p-1">
            <p className="px-2 py-1 text-[11px] text-[#9f9f9f]">{isBoardBacklog ? "Move to Board" : "Add to Sprint"}</p>
            {isBoardBacklog ? (
              [
                { value: "todo", label: "To Do" },
                { value: "in_progress", label: "In Progress" },
                { value: "in_review", label: "In Review" },
                { value: "done", label: "Done" },
              ].map((status) => (
                <button key={status.value} onClick={() => onMoveToBoard(status.value)} className="block w-full rounded px-2 py-1 text-left text-[11px] text-[#ddd] hover:bg-[#1f1f1f]">
                  {status.label}
                </button>
              ))
            ) : sprints.map((sprint) => (
              <button key={sprint.id} onClick={() => onAddToSprint(sprint.id)} className="block w-full rounded px-2 py-1 text-left text-[11px] text-[#ddd] hover:bg-[#1f1f1f]">
                {sprint.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

