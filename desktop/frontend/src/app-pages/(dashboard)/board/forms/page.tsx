"use client";

import { useState } from "react";

type FormField = { id: string; type: "text" | "textarea" | "dropdown" | "checkbox" | "date"; label: string };
type FormSchema = { id: string; title: string; active: boolean; fields: FormField[]; createdAt: string };
const LS_KEY = "sprint.board.forms.v1";

export default function FormsTabPage() {
  const [forms, setForms] = useState<FormSchema[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      const parsed = raw ? (JSON.parse(raw) as FormSchema[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [title, setTitle] = useState("New Intake Form");
  const [selected, setSelected] = useState<string>("");

  function persist(next: FormSchema[]) {
    setForms(next);
    window.localStorage.setItem(LS_KEY, JSON.stringify(next));
  }

  function createForm() {
    const item: FormSchema = { id: crypto.randomUUID(), title: title.trim() || "Untitled Form", active: true, createdAt: new Date().toISOString(), fields: [] };
    const next = [item, ...forms];
    persist(next);
    setSelected(item.id);
  }

  function addField(formId: string, type: FormField["type"]) {
    const next = forms.map((f) => (f.id === formId ? { ...f, fields: [...f.fields, { id: crypto.randomUUID(), type, label: `${type} field` }] } : f));
    persist(next);
  }

  function toggleActive(formId: string) {
    persist(forms.map((f) => (f.id === formId ? { ...f, active: !f.active } : f)));
  }

  const current = forms.find((f) => f.id === selected) || forms[0] || null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[#8f8f8f]">[SKIP - no endpoint] using local storage form builder fallback</p>
      <div className="flex gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded border border-[var(--border)] bg-[#111] px-3 py-2 text-sm" />
        <button onClick={createForm} className="rounded border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-card)]">Create Form</button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px,1fr]">
        <div className="space-y-2">
          {forms.map((form) => (
            <button key={form.id} onClick={() => setSelected(form.id)} className={`w-full rounded border px-3 py-2 text-left ${selected === form.id ? "border-white bg-white text-black" : "border-[var(--border)] bg-[#141414]"}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{form.title}</span>
                <span className="text-xs">{form.active ? "Active" : "Inactive"}</span>
              </div>
              <p className="text-xs opacity-80">{form.fields.length} fields</p>
            </button>
          ))}
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[#141414] p-3">
          {current ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold">{current.title}</h3>
                <button onClick={() => toggleActive(current.id)} className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-card)]">
                  {current.active ? "Set Inactive" : "Set Active"}
                </button>
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {(["text", "textarea", "dropdown", "checkbox", "date"] as const).map((type) => (
                  <button key={type} onClick={() => addField(current.id, type)} className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-card)]">+ {type}</button>
                ))}
              </div>
              <div className="space-y-2">
                {current.fields.map((field) => (
                  <div key={field.id} className="rounded border border-[var(--border)] bg-[#101010] px-2 py-2 text-sm">{field.label} ({field.type})</div>
                ))}
                {!current.fields.length ? <p className="text-sm text-[#8f8f8f]">No fields yet.</p> : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-[#8f8f8f]">Create a form to begin.</p>
          )}
        </div>
      </div>
    </div>
  );
}

