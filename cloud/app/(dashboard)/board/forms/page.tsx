"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

type QuestionType = "text" | "textarea" | "dropdown" | "checkbox" | "date";
type FormQuestion = {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options: string[];
};
type FormSchema = {
  id: string;
  title: string;
  description: string;
  published: boolean;
  createdAt: string;
  updatedAt: string;
  questions: FormQuestion[];
};
type FormResponse = {
  id: string;
  formId: string;
  submittedAt: string;
  answers: Record<string, string | string[]>;
};

const FORMS_KEY = "sprint.board.forms.v2";
const RESPONSES_KEY = "sprint.board.form.responses.v2";

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeQuestion(value: unknown): FormQuestion | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const type = asString(item.type, "text") as QuestionType;
  const safeType: QuestionType = ["text", "textarea", "dropdown", "checkbox", "date"].includes(type) ? type : "text";
  const rawOptions = Array.isArray(item.options) ? item.options : [];
  const options = rawOptions.map((opt) => asString(opt).trim()).filter(Boolean);
  return {
    id: asString(item.id, createId()),
    label: asString(item.label, "Untitled question"),
    type: safeType,
    required: asBoolean(item.required, false),
    options: safeType === "dropdown" || safeType === "checkbox" ? (options.length ? options : ["Option 1", "Option 2"]) : [],
  };
}

function normalizeForm(value: unknown): FormSchema | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const rawQuestions = Array.isArray(item.questions) ? item.questions : [];
  const questions = rawQuestions.map(normalizeQuestion).filter((q): q is FormQuestion => q !== null);
  return {
    id: asString(item.id, createId()),
    title: asString(item.title, "Untitled form"),
    description: asString(item.description, ""),
    published: asBoolean(item.published, false),
    createdAt: asString(item.createdAt, new Date().toISOString()),
    updatedAt: asString(item.updatedAt, new Date().toISOString()),
    questions,
  };
}

function normalizeResponse(value: unknown): FormResponse | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const answersInput = item.answers;
  const safeAnswers: Record<string, string | string[]> = {};
  if (answersInput && typeof answersInput === "object") {
    for (const [key, val] of Object.entries(answersInput as Record<string, unknown>)) {
      if (Array.isArray(val)) {
        safeAnswers[key] = val.map((v) => asString(v)).filter(Boolean);
      } else {
        safeAnswers[key] = asString(val);
      }
    }
  }
  return {
    id: asString(item.id, createId()),
    formId: asString(item.formId),
    submittedAt: asString(item.submittedAt, new Date().toISOString()),
    answers: safeAnswers,
  };
}

function loadForms(): FormSchema[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FORMS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeForm).filter((f): f is FormSchema => f !== null);
  } catch {
    return [];
  }
}

function loadResponses(): FormResponse[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RESPONSES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeResponse).filter((r): r is FormResponse => r !== null);
  } catch {
    return [];
  }
}

function saveForms(next: FormSchema[]) {
  window.localStorage.setItem(FORMS_KEY, JSON.stringify(next));
}

function saveResponses(next: FormResponse[]) {
  window.localStorage.setItem(RESPONSES_KEY, JSON.stringify(next));
}

function mkQuestion(type: QuestionType): FormQuestion {
  return {
    id: createId(),
    label: "Untitled question",
    type,
    required: false,
    options: type === "dropdown" || type === "checkbox" ? ["Option 1", "Option 2"] : [],
  };
}

export default function FormsTabPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white px-4 py-8 dark:bg-black" />}>
      <FormsTabPageContent />
    </Suspense>
  );
}

function FormsTabPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [forms, setForms] = useState<FormSchema[]>(loadForms);
  const [responses, setResponses] = useState<FormResponse[]>(loadResponses);
  const [draftTitle, setDraftTitle] = useState("New form");
  const [selectedFormId, setSelectedFormId] = useState<string>(() => String(searchParams?.get("formId") || "").trim());
  const [activeTab, setActiveTab] = useState<"build" | "fill" | "responses">(() => {
    const mode = String(searchParams?.get("mode") || "").trim().toLowerCase();
    return mode === "fill" ? "fill" : mode === "responses" ? "responses" : "build";
  });
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string | string[]>>({});
  const [banner, setBanner] = useState("");

  const selectedForm = useMemo(() => {
    const fromId = forms.find((item) => item.id === selectedFormId);
    if (fromId) return fromId;
    return forms[0] || null;
  }, [forms, selectedFormId]);

  const currentResponses = useMemo(() => {
    if (!selectedForm) return [];
    return responses.filter((item) => item.formId === selectedForm.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }, [responses, selectedForm]);

  function persistForms(next: FormSchema[]) {
    setForms(next);
    saveForms(next);
  }

  function persistResponses(next: FormResponse[]) {
    setResponses(next);
    saveResponses(next);
  }

  function setMode(next: "build" | "fill" | "responses") {
    setActiveTab(next);
    const qs = new URLSearchParams(searchParams?.toString() || "");
    if (selectedForm) qs.set("formId", selectedForm.id);
    qs.set("mode", next);
    const query = qs.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function createForm() {
    const now = new Date().toISOString();
    const form: FormSchema = {
      id: createId(),
      title: draftTitle.trim() || "Untitled form",
      description: "",
      published: false,
      createdAt: now,
      updatedAt: now,
      questions: [mkQuestion("text")],
    };
    const next = [form, ...forms];
    persistForms(next);
    setSelectedFormId(form.id);
    setBanner("Form created.");
  }

  function updateForm(mutator: (form: FormSchema) => FormSchema) {
    if (!selectedForm) return;
    const next = forms.map((form) => (form.id === selectedForm.id ? mutator(form) : form));
    persistForms(next);
  }

  function addQuestion(type: QuestionType) {
    updateForm((form) => ({
      ...form,
      updatedAt: new Date().toISOString(),
      questions: [...form.questions, mkQuestion(type)],
    }));
  }

  function updateQuestion(questionId: string, patch: Partial<FormQuestion>) {
    updateForm((form) => ({
      ...form,
      updatedAt: new Date().toISOString(),
      questions: form.questions.map((q) => (q.id === questionId ? { ...q, ...patch } : q)),
    }));
  }

  function removeQuestion(questionId: string) {
    updateForm((form) => ({
      ...form,
      updatedAt: new Date().toISOString(),
      questions: form.questions.filter((q) => q.id !== questionId),
    }));
  }

  function deleteForm(formId: string) {
    const next = forms.filter((f) => f.id !== formId);
    persistForms(next);
    if (selectedFormId === formId) setSelectedFormId(next[0]?.id || "");
    setBanner("Form deleted.");
  }

  function togglePublish() {
    if (!selectedForm) return;
    if (!selectedForm.questions.length) {
      setBanner("Add at least one question before publishing.");
      return;
    }
    updateForm((form) => ({ ...form, published: !form.published, updatedAt: new Date().toISOString() }));
    setBanner(selectedForm.published ? "Form unpublished." : "Form published.");
  }

  function copyShareLink() {
    if (!selectedForm) return;
    const url = `${window.location.origin}/board/forms?formId=${encodeURIComponent(selectedForm.id)}&mode=fill`;
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      void navigator.clipboard.writeText(url)
        .then(() => setBanner("Share link copied."))
        .catch(() => setBanner("Could not copy automatically. Copy this URL: " + url));
      return;
    }
    setBanner("Copy this URL: " + url);
  }

  function updateAnswer(questionId: string, value: string | string[]) {
    setDraftAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  function toggleMultiAnswer(questionId: string, option: string) {
    const current = Array.isArray(draftAnswers[questionId]) ? (draftAnswers[questionId] as string[]) : [];
    const has = current.includes(option);
    const next = has ? current.filter((x) => x !== option) : [...current, option];
    updateAnswer(questionId, next);
  }

  function validateRequiredQuestions(): string | null {
    if (!selectedForm) return "Select a form first.";
    for (const q of selectedForm.questions) {
      if (!q.required) continue;
      const value = draftAnswers[q.id];
      if (Array.isArray(value) && value.length === 0) return `Required: ${q.label}`;
      if (!Array.isArray(value) && !String(value || "").trim()) return `Required: ${q.label}`;
    }
    return null;
  }

  function submitResponse() {
    if (!selectedForm) return;
    if (!selectedForm.published) {
      setBanner("Publish the form before collecting responses.");
      return;
    }
    const validationError = validateRequiredQuestions();
    if (validationError) {
      setBanner(validationError);
      return;
    }
    const entry: FormResponse = {
      id: createId(),
      formId: selectedForm.id,
      submittedAt: new Date().toISOString(),
      answers: Object.fromEntries(
        Object.entries(draftAnswers).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])
      ),
    };
    persistResponses([entry, ...responses]);
    setDraftAnswers({});
    setBanner("Response submitted.");
    setMode("responses");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[var(--border)] bg-[#121212] p-3">
        <div className="mb-2 text-xs text-[#8f8f8f]">Forms workspace</div>
        <div className="flex flex-wrap gap-2">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Form title"
            className="min-w-[240px] flex-1 rounded border border-[var(--border)] bg-[#111] px-3 py-2 text-sm"
          />
          <button onClick={createForm} className="rounded border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-card)]">
            Create form
          </button>
        </div>
      </div>

      {banner ? <div className="rounded border border-emerald-700/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{banner}</div> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px,1fr]">
        <aside className="rounded-md border border-[var(--border)] bg-[#141414] p-3">
          <div className="space-y-2">
            {forms.map((form) => (
              <div key={form.id} className={`rounded border p-2 ${selectedForm?.id === form.id ? "border-white" : "border-[var(--border)]"}`}>
                <button onClick={() => setSelectedFormId(form.id)} className="w-full text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{form.title || "Untitled form"}</span>
                    <span className="text-[10px] text-[#9d9d9d]">{form.published ? "Published" : "Draft"}</span>
                  </div>
                  <div className="mt-1 text-xs text-[#8f8f8f]">{form.questions.length} questions</div>
                </button>
                <button onClick={() => deleteForm(form.id)} className="mt-2 text-xs text-rose-300 hover:underline">
                  Delete
                </button>
              </div>
            ))}
            {!forms.length ? <p className="text-sm text-[#8f8f8f]">No forms yet.</p> : null}
          </div>
        </aside>

        <section className="rounded-md border border-[var(--border)] bg-[#141414] p-3">
          {!selectedForm ? (
            <p className="text-sm text-[#8f8f8f]">Create a form to start building questions.</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3">
                {([
                  ["build", "Build"],
                  ["fill", "Preview/Fill"],
                  ["responses", "Responses"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setMode(key)}
                    className={`rounded px-3 py-1.5 text-sm ${activeTab === key ? "bg-white text-black" : "border border-[var(--border)] hover:bg-[var(--bg-card)]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  value={selectedForm.title}
                  onChange={(e) => updateForm((f) => ({ ...f, title: e.target.value, updatedAt: new Date().toISOString() }))}
                  className="min-w-[220px] flex-1 rounded border border-[var(--border)] bg-[#111] px-3 py-2 text-sm"
                />
                <button onClick={togglePublish} className="rounded border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-card)]">
                  {selectedForm.published ? "Unpublish" : "Publish"}
                </button>
                <button onClick={copyShareLink} className="rounded border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-card)]">
                  Copy share link
                </button>
              </div>

              <textarea
                value={selectedForm.description}
                onChange={(e) => updateForm((f) => ({ ...f, description: e.target.value, updatedAt: new Date().toISOString() }))}
                placeholder="Form description"
                className="mb-4 h-20 w-full rounded border border-[var(--border)] bg-[#111] px-3 py-2 text-sm"
              />

              {activeTab === "build" ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {(["text", "textarea", "dropdown", "checkbox", "date"] as const).map((type) => (
                      <button key={type} onClick={() => addQuestion(type)} className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-card)]">
                        + {type}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-3">
                    {selectedForm.questions.map((q, idx) => (
                      <div key={q.id} className="rounded-md border border-[var(--border)] bg-[#101010] p-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-[#8f8f8f]">Q{idx + 1}</span>
                          <input
                            value={q.label}
                            onChange={(e) => updateQuestion(q.id, { label: e.target.value })}
                            className="min-w-[220px] flex-1 rounded border border-[var(--border)] bg-[#111] px-2 py-1 text-sm"
                          />
                          <select
                            value={q.type}
                            onChange={(e) => {
                              const type = e.target.value as QuestionType;
                              updateQuestion(q.id, { type, options: type === "dropdown" || type === "checkbox" ? ["Option 1", "Option 2"] : [] });
                            }}
                            className="rounded border border-[var(--border)] bg-[#111] px-2 py-1 text-xs"
                          >
                            <option value="text">Text</option>
                            <option value="textarea">Paragraph</option>
                            <option value="dropdown">Dropdown</option>
                            <option value="checkbox">Checkbox</option>
                            <option value="date">Date</option>
                          </select>
                          <label className="inline-flex items-center gap-1 text-xs">
                            <input type="checkbox" checked={q.required} onChange={(e) => updateQuestion(q.id, { required: e.target.checked })} />
                            Required
                          </label>
                          <button onClick={() => removeQuestion(q.id)} className="text-xs text-rose-300 hover:underline">Remove</button>
                        </div>

                        {q.type === "dropdown" || q.type === "checkbox" ? (
                          <div className="space-y-2">
                            {q.options.map((opt, i) => (
                              <div key={`${q.id}-${i}`} className="flex gap-2">
                                <input
                                  value={opt}
                                  onChange={(e) => {
                                    const next = q.options.map((x, idx2) => (idx2 === i ? e.target.value : x));
                                    updateQuestion(q.id, { options: next });
                                  }}
                                  className="w-full rounded border border-[var(--border)] bg-[#111] px-2 py-1 text-xs"
                                />
                                <button
                                  onClick={() => updateQuestion(q.id, { options: q.options.filter((_, idx2) => idx2 !== i) })}
                                  className="rounded border border-[var(--border)] px-2 py-1 text-xs"
                                >
                                  Delete
                                </button>
                              </div>
                            ))}
                            <button onClick={() => updateQuestion(q.id, { options: [...q.options, `Option ${q.options.length + 1}`] })} className="text-xs text-sky-300 hover:underline">
                              Add option
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {!selectedForm.questions.length ? <p className="text-sm text-[#8f8f8f]">Add your first question.</p> : null}
                  </div>
                </div>
              ) : null}

              {activeTab === "fill" ? (
                <div className="space-y-4">
                  {!selectedForm.published ? <p className="text-xs text-amber-300">Publish this form to collect responses.</p> : null}
                  <div className="space-y-4 rounded-md border border-[var(--border)] bg-[#101010] p-3">
                    {selectedForm.questions.map((q) => (
                      <div key={q.id}>
                        <div className="mb-1 text-sm font-semibold">
                          {q.label}
                          {q.required ? <span className="ml-1 text-rose-300">*</span> : null}
                        </div>
                        {q.type === "text" ? (
                          <input value={String(draftAnswers[q.id] || "")} onChange={(e) => updateAnswer(q.id, e.target.value)} className="w-full rounded border border-[var(--border)] bg-[#111] px-2 py-1.5 text-sm" />
                        ) : null}
                        {q.type === "textarea" ? (
                          <textarea value={String(draftAnswers[q.id] || "")} onChange={(e) => updateAnswer(q.id, e.target.value)} className="h-24 w-full rounded border border-[var(--border)] bg-[#111] px-2 py-1.5 text-sm" />
                        ) : null}
                        {q.type === "date" ? (
                          <input type="date" value={String(draftAnswers[q.id] || "")} onChange={(e) => updateAnswer(q.id, e.target.value)} className="rounded border border-[var(--border)] bg-[#111] px-2 py-1.5 text-sm" />
                        ) : null}
                        {q.type === "dropdown" ? (
                          <select value={String(draftAnswers[q.id] || "")} onChange={(e) => updateAnswer(q.id, e.target.value)} className="w-full rounded border border-[var(--border)] bg-[#111] px-2 py-1.5 text-sm">
                            <option value="">Select</option>
                            {q.options.map((opt) => (
                              <option key={`${q.id}-${opt}`} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : null}
                        {q.type === "checkbox" ? (
                          <div className="space-y-1">
                            {q.options.map((opt) => {
                              const selected = Array.isArray(draftAnswers[q.id]) ? (draftAnswers[q.id] as string[]) : [];
                              return (
                                <label key={`${q.id}-${opt}`} className="flex items-center gap-2 text-sm">
                                  <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggleMultiAnswer(q.id, opt)} />
                                  {opt}
                                </label>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <button onClick={submitResponse} className="rounded border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-card)]">
                    Submit response
                  </button>
                </div>
              ) : null}

              {activeTab === "responses" ? (
                <div className="space-y-3">
                  <div className="text-sm text-[#b0b0b0]">{currentResponses.length} responses</div>
                  {currentResponses.length ? currentResponses.map((resp) => (
                    <article key={resp.id} className="rounded border border-[var(--border)] bg-[#101010] p-3 text-sm">
                      <div className="mb-2 text-xs text-[#8f8f8f]">{new Date(resp.submittedAt).toLocaleString()}</div>
                      <div className="space-y-1">
                        {selectedForm.questions.map((q) => {
                          const value = resp.answers[q.id];
                          const text = Array.isArray(value) ? value.join(", ") : String(value || "-");
                          return (
                            <div key={`${resp.id}-${q.id}`} className="text-xs">
                              <span className="text-[#8f8f8f]">{q.label}: </span>
                              <span>{text || "-"}</span>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  )) : <p className="text-sm text-[#8f8f8f]">No responses yet.</p>}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
