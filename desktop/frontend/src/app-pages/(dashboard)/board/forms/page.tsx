"use client";

import { useEffect, useMemo, useState } from "react";

type FormField = {
  id: string;
  type: "text" | "textarea" | "dropdown" | "checkbox" | "date";
  label: string;
  options?: string[];
};

type FormTemplate = {
  id: string;
  title: string;
  fields: FormField[];
};

type FormResponse = {
  id: string;
  taskId: string;
  templateId: string;
  answers: Record<string, unknown>;
  completed: boolean;
  submittedAt: string;
};

type BoardTask = {
  id: string;
  title: string;
};

type TaskWithPR = {
  task: {
    id: string;
    title: string;
  };
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

function normalizeTemplates(payload: unknown): FormTemplate[] {
  if (!Array.isArray(payload)) return [];

  return payload.map((item) => {
    const rec = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const fields = Array.isArray(rec.fields) ? rec.fields : [];
    return {
      id: asString(rec.id),
      title: asString(rec.title, "Untitled Template"),
      fields: fields.map((field) => {
        const f = field && typeof field === "object" ? (field as Record<string, unknown>) : {};
        return {
          id: asString(f.id),
          type: asString(f.type, "text") as FormField["type"],
          label: asString(f.label, "Field"),
          options: Array.isArray(f.options) ? f.options.map((option) => asString(option)).filter(Boolean) : [],
        };
      }),
    };
  }).filter((template) => Boolean(template.id));
}

function normalizeResponses(payload: unknown): FormResponse[] {
  if (!Array.isArray(payload)) return [];

  return payload.map((item) => {
    const rec = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      id: asString(rec.id),
      taskId: asString(rec.taskId),
      templateId: asString(rec.templateId),
      answers: rec.answers && typeof rec.answers === "object" ? (rec.answers as Record<string, unknown>) : {},
      completed: Boolean(rec.completed),
      submittedAt: asString(rec.submittedAt),
    };
  }).filter((response) => Boolean(response.templateId));
}

function normalizeTasks(payload: unknown): BoardTask[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => {
      const rec = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const taskRaw = rec.task && typeof rec.task === "object" ? (rec.task as Record<string, unknown>) : {};
      return {
        id: asString(taskRaw.id),
        title: asString(taskRaw.title, "Untitled task"),
      };
    })
    .filter((task) => Boolean(task.id));
}

export default function FormsTabPage() {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [taskForms, setTaskForms] = useState<Record<string, FormResponse[]>>({});
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [expandedTemplateId, setExpandedTemplateId] = useState("");
  const [attachTemplateId, setAttachTemplateId] = useState("");
  const [answersDraft, setAnswersDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const selectedTaskForms = taskForms[selectedTaskId] || [];

  const selectedTemplate = useMemo(() => {
    const id = expandedTemplateId || templates[0]?.id || "";
    return templates.find((template) => template.id === id) || null;
  }, [expandedTemplateId, templates]);

  const selectedResponse = useMemo(() => {
    if (!selectedTemplate || !selectedTaskId) return null;
    return selectedTaskForms.find((response) => response.templateId === selectedTemplate.id) || null;
  }, [selectedTaskForms, selectedTaskId, selectedTemplate]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let disposed = false;

    async function bootstrap() {
      setLoading(true);
      setError(null);
      try {
        const [templatesRaw, taskRowsRaw] = await Promise.all([
          invokeDesktop<unknown>("forms:getTemplates"),
          invokeDesktop<unknown>("board:getTasksWithPRs"),
        ]);

        if (disposed) return;

        const nextTemplates = normalizeTemplates(templatesRaw);
        const nextTasks = normalizeTasks(taskRowsRaw as TaskWithPR[]);
        setTemplates(nextTemplates);
        setTasks(nextTasks);

        const initialTaskId = nextTasks[0]?.id || "";
        setSelectedTaskId(initialTaskId);
        setExpandedTemplateId(nextTemplates[0]?.id || "");
        setAttachTemplateId(nextTemplates[0]?.id || "");

        if (initialTaskId) {
          await loadTaskForms(initialTaskId, disposed);
          await loadAllTaskStatuses(nextTasks, disposed);
        }
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : "Failed to load forms");
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedTemplate) {
      setAnswersDraft({});
      return;
    }
    setAnswersDraft(selectedResponse?.answers || {});
  }, [selectedResponse, selectedTemplate]);

  async function loadTaskForms(taskId: string, disposed = false) {
    if (!taskId) return;
    const raw = await invokeDesktop<unknown>("forms:getTaskForms", { taskId });
    if (disposed) return;
    const responses = normalizeResponses(raw);
    setTaskForms((prev) => ({ ...prev, [taskId]: responses }));
  }

  async function loadAllTaskStatuses(taskItems: BoardTask[], disposed = false) {
    const entries = await Promise.all(
      taskItems.map(async (task) => {
        const raw = await invokeDesktop<unknown>("forms:getTaskForms", { taskId: task.id });
        return [task.id, normalizeResponses(raw)] as const;
      })
    );

    if (disposed) return;
    setTaskForms((prev) => {
      const next = { ...prev };
      entries.forEach(([taskId, responses]) => {
        next[taskId] = responses;
      });
      return next;
    });
  }

  function completionLabel(taskId: string) {
    const responses = taskForms[taskId] || [];
    const completed = responses.filter((response) => response.completed).length;
    return `${completed}/${responses.length}`;
  }

  async function onAttachTemplate() {
    if (!selectedTaskId || !attachTemplateId) return;
    try {
      setBusy(true);
      await invokeDesktop("forms:attachTemplate", {
        taskId: selectedTaskId,
        templateId: attachTemplateId,
      });
      await loadTaskForms(selectedTaskId);
      setExpandedTemplateId(attachTemplateId);
      setToast("Template attached");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to attach template");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitForm() {
    if (!selectedTaskId || !selectedTemplate) return;
    try {
      setBusy(true);
      await invokeDesktop("forms:submitForm", {
        taskId: selectedTaskId,
        templateId: selectedTemplate.id,
        answers: answersDraft,
      });
      await loadTaskForms(selectedTaskId);
      setToast("Form submitted");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to submit form");
    } finally {
      setBusy(false);
    }
  }

  function updateFieldAnswer(field: FormField, value: unknown) {
    setAnswersDraft((prev) => ({ ...prev, [field.id]: value }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select value={selectedTaskId} onChange={(e) => void loadTaskForms(e.target.value).then(() => setSelectedTaskId(e.target.value))} className="w-full rounded border border-[var(--border)] bg-[#111] px-3 py-2 text-sm lg:w-auto">
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>{task.title}</option>
          ))}
        </select>
        <select value={attachTemplateId} onChange={(e) => setAttachTemplateId(e.target.value)} className="w-full rounded border border-[var(--border)] bg-[#111] px-3 py-2 text-sm lg:w-auto">
          {templates.map((template) => (
            <option key={template.id} value={template.id}>{template.title}</option>
          ))}
        </select>
        <button disabled={busy || !selectedTaskId || !attachTemplateId} onClick={() => void onAttachTemplate()} className="rounded border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-card)] disabled:cursor-not-allowed disabled:opacity-60">Attach Form</button>
      </div>

      {error ? <div className="rounded-md border border-[#6a2626] bg-[#2a1515] px-3 py-2 text-xs text-[#ffc4c4]">{error}</div> : null}
      {loading ? <p className="text-xs text-[#8f8f8f]">Loading...</p> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px,1fr]">
        <div className="space-y-2">
          {tasks.map((task) => (
            <button key={task.id} onClick={() => void loadTaskForms(task.id).then(() => setSelectedTaskId(task.id))} className={`w-full rounded border px-3 py-2 text-left ${selectedTaskId === task.id ? "border-white bg-white text-black" : "border-[var(--border)] bg-[#141414]"}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{task.title}</span>
                <span className="text-xs">{completionLabel(task.id)} complete</span>
              </div>
              <p className="text-xs opacity-80">Attached forms: {(taskForms[task.id] || []).length}</p>
            </button>
          ))}
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[#141414] p-3">
          {selectedTaskId ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold">Task Forms</h3>
                <button disabled={busy || !selectedTemplate} onClick={() => void onSubmitForm()} className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-card)] disabled:cursor-not-allowed disabled:opacity-60">Submit Form</button>
              </div>

              <div className="mb-3 flex flex-wrap gap-2">
                {templates.map((template) => {
                  const response = selectedTaskForms.find((item) => item.templateId === template.id);
                  const attached = Boolean(response);
                  return (
                    <button key={template.id} onClick={() => setExpandedTemplateId(template.id)} className={`rounded border px-2 py-1 text-xs ${expandedTemplateId === template.id ? "border-white bg-white text-black" : "border-[var(--border)] hover:bg-[var(--bg-card)]"}`}>
                      {template.title} {attached ? (response?.completed ? "(Complete)" : "(In Progress)") : "(Not Attached)"}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-2">
                {selectedTemplate ? selectedTemplate.fields.map((field) => (
                  <div key={field.id} className="rounded border border-[var(--border)] bg-[#101010] px-2 py-2 text-sm">
                    <label className="mb-1 block text-xs text-[#cfcfcf]">{field.label}</label>

                    {field.type === "textarea" ? (
                      <textarea value={asString(answersDraft[field.id] || "")} onChange={(e) => updateFieldAnswer(field, e.target.value)} className="w-full rounded border border-[var(--border)] bg-[#0d0d0d] px-2 py-1.5 text-sm" rows={3} />
                    ) : null}

                    {field.type === "text" || field.type === "date" ? (
                      <input
                        type={field.type === "date" ? "date" : "text"}
                        value={asString(answersDraft[field.id] || "")}
                        onChange={(e) => updateFieldAnswer(field, e.target.value)}
                        className="w-full rounded border border-[var(--border)] bg-[#0d0d0d] px-2 py-1.5 text-sm"
                      />
                    ) : null}

                    {field.type === "dropdown" ? (
                      <select value={asString(answersDraft[field.id] || "")} onChange={(e) => updateFieldAnswer(field, e.target.value)} className="w-full rounded border border-[var(--border)] bg-[#0d0d0d] px-2 py-1.5 text-sm">
                        <option value="">Select</option>
                        {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : null}

                    {field.type === "checkbox" ? (
                      <label className="inline-flex items-center gap-2 text-sm text-[#d7d7d7]">
                        <input type="checkbox" checked={Boolean(answersDraft[field.id])} onChange={(e) => updateFieldAnswer(field, e.target.checked)} className="h-3.5 w-3.5 accent-white" />
                        Completed
                      </label>
                    ) : null}
                  </div>
                )) : null}
                {!selectedTemplate?.fields.length ? <p className="text-sm text-[#8f8f8f]">No fields in this template.</p> : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-[#8f8f8f]">No tasks available.</p>
          )}
        </div>
      </div>

      {toast ? <div className="fixed bottom-4 right-4 z-20 rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-xs text-white">{toast}</div> : null}
    </div>
  );
}

