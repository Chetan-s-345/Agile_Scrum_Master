const CHANNELS = require("./channels");

const templates = [
  {
    id: "tmpl-dod",
    title: "Definition of Done checklist",
    fields: [
      { id: "tests", label: "Tests added and passing", type: "checkbox" },
      { id: "docs", label: "Docs updated", type: "checkbox" },
      { id: "qa", label: "QA verified", type: "checkbox" },
    ],
  },
  {
    id: "tmpl-bug",
    title: "Bug Report form",
    fields: [
      { id: "summary", label: "Bug summary", type: "text" },
      { id: "steps", label: "Steps to reproduce", type: "textarea" },
      { id: "severity", label: "Severity", type: "dropdown", options: ["low", "medium", "high", "critical"] },
    ],
  },
  {
    id: "tmpl-feature",
    title: "Feature Request form",
    fields: [
      { id: "problem", label: "Problem statement", type: "textarea" },
      { id: "proposal", label: "Proposed solution", type: "textarea" },
      { id: "impact", label: "Expected impact", type: "text" },
    ],
  },
];

const attachedTemplatesByTask = {
  "board-1": ["tmpl-dod", "tmpl-feature"],
  "board-2": ["tmpl-dod", "tmpl-bug"],
  "board-3": ["tmpl-feature"],
  "board-4": ["tmpl-dod"],
};

let formResponses = [
  {
    id: "resp-1",
    taskId: "board-1",
    templateId: "tmpl-dod",
    answers: {
      tests: true,
      docs: true,
      qa: false,
    },
    completed: false,
    submittedAt: new Date().toISOString(),
  },
  {
    id: "resp-2",
    taskId: "board-2",
    templateId: "tmpl-bug",
    answers: {
      summary: "Cache does not invalidate on assignment changes",
      steps: "Create assignment then update developer; stale state remains",
      severity: "high",
    },
    completed: true,
    submittedAt: new Date().toISOString(),
  },
];

let customForms = [];

function asString(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function cloneTemplate(template) {
  return {
    id: asString(template.id),
    title: asString(template.title),
    fields: Array.isArray(template.fields)
      ? template.fields.map((field) => ({
          id: asString(field.id),
          label: asString(field.label),
          type: asString(field.type, "text"),
          options: Array.isArray(field.options) ? field.options.map((opt) => asString(opt)).filter(Boolean) : [],
        }))
      : [],
  };
}

function cloneResponse(response) {
  return {
    id: asString(response.id),
    taskId: asString(response.taskId),
    templateId: asString(response.templateId),
    answers: response.answers && typeof response.answers === "object" ? { ...response.answers } : {},
    completed: Boolean(response.completed),
    submittedAt: asString(response.submittedAt),
  };
}

function ensureTaskEntry(taskId) {
  const normalizedTaskId = asString(taskId);
  if (!normalizedTaskId) return;
  if (!Array.isArray(attachedTemplatesByTask[normalizedTaskId])) {
    attachedTemplatesByTask[normalizedTaskId] = [];
  }
}

function isResponseCompleted(template, answers) {
  if (!template || !Array.isArray(template.fields)) return false;
  if (!answers || typeof answers !== "object") return false;

  return template.fields.every((field) => {
    const value = answers[field.id];
    if (field.type === "checkbox") return typeof value === "boolean";
    return asString(value) !== "";
  });
}

function registerFormsIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.FORMS.GET_TEMPLATES, async () => {
    return templates.map(cloneTemplate);
  });

  ipcMain.handle(CHANNELS.FORMS.GET_TASK_FORMS, async (_event, payload) => {
    const taskId = asString(payload?.taskId);
    if (!taskId) throw new Error("taskId is required");

    ensureTaskEntry(taskId);
    const templateIds = attachedTemplatesByTask[taskId] || [];

    return templateIds.map((templateId) => {
      const existing = formResponses.find((response) => asString(response.taskId) === taskId && asString(response.templateId) === asString(templateId));
      if (existing) return cloneResponse(existing);

      return {
        id: "",
        taskId,
        templateId: asString(templateId),
        answers: {},
        completed: false,
        submittedAt: "",
      };
    });
  });

  ipcMain.handle(CHANNELS.FORMS.ATTACH_TEMPLATE, async (_event, payload) => {
    const taskId = asString(payload?.taskId);
    const templateId = asString(payload?.templateId);

    if (!taskId) throw new Error("taskId is required");
    if (!templateId) throw new Error("templateId is required");

    const templateExists = templates.some((template) => asString(template.id) === templateId);
    if (!templateExists) throw new Error("Template not found");

    ensureTaskEntry(taskId);
    const attached = attachedTemplatesByTask[taskId];
    if (!attached.includes(templateId)) {
      attached.push(templateId);
    }

    return { success: true };
  });

  ipcMain.handle(CHANNELS.FORMS.SUBMIT_FORM, async (_event, payload) => {
    const taskId = asString(payload?.taskId);
    const templateId = asString(payload?.templateId);
    const answers = payload?.answers && typeof payload.answers === "object" ? payload.answers : {};

    if (!taskId) throw new Error("taskId is required");
    if (!templateId) throw new Error("templateId is required");

    ensureTaskEntry(taskId);
    if (!attachedTemplatesByTask[taskId].includes(templateId)) {
      attachedTemplatesByTask[taskId].push(templateId);
    }

    const template = templates.find((entry) => asString(entry.id) === templateId) || null;
    const completed = isResponseCompleted(template, answers);

    const existingIndex = formResponses.findIndex(
      (response) => asString(response.taskId) === taskId && asString(response.templateId) === templateId
    );

    const nextResponse = {
      id: existingIndex >= 0 ? asString(formResponses[existingIndex].id, `resp-${Date.now()}`) : `resp-${Date.now()}`,
      taskId,
      templateId,
      answers: { ...answers },
      completed,
      submittedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      formResponses[existingIndex] = nextResponse;
    } else {
      formResponses.push(nextResponse);
    }

    return cloneResponse(nextResponse);
  });

  ipcMain.handle(CHANNELS.FORMS.CREATE_FORM, async (_event, payload) => {
    const name = asString(payload?.name);
    const description = asString(payload?.description);

    if (!name) {
      throw new Error("name is required");
    }

    const item = {
      id: `form-${Date.now()}`,
      name,
      description,
      createdAt: new Date().toISOString(),
    };

    customForms.unshift(item);
    return { success: true, form: { ...item } };
  });
}

module.exports = {
  registerFormsIpcHandlers,
};
