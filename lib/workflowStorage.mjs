import { emptyWorkflowState } from "./taskEngine.mjs";

const WORKFLOW_STATE_KEY = "nb_workflow_state";
const MAX_ARTIFACT_CHARS = 8000;
const MAX_MEMBER_SUMMARY_CHARS = 1600;
const MAX_TASK_CHARS = 4000;

function truncateText(value, limit) {
  const text = `${value || ""}`;
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function normalizeWorkflowState(state, lang = "zh") {
  const fallback = emptyWorkflowState(lang);
  if (!state || typeof state !== "object") return fallback;
  return {
    ...fallback,
    ...state,
    task: truncateText(state.task, MAX_TASK_CHARS),
    members: Array.isArray(state.members)
      ? state.members.map(member => ({
        ...member,
        summary: truncateText(member.summary, MAX_MEMBER_SUMMARY_CHARS),
        error: truncateText(member.error, 600),
      }))
      : [],
    artifacts: Array.isArray(state.artifacts)
      ? state.artifacts.map(artifact => ({
        ...artifact,
        content: truncateText(artifact.content, MAX_ARTIFACT_CHARS),
      }))
      : [],
    progress: state.progress && typeof state.progress === "object" ? state.progress : fallback.progress,
    updatedAt: state.updatedAt || new Date().toISOString(),
  };
}

function loadWorkflowState(lang = "zh", storage = globalThis.localStorage) {
  try {
    if (!storage) return emptyWorkflowState(lang);
    const raw = storage.getItem(WORKFLOW_STATE_KEY);
    if (!raw) return emptyWorkflowState(lang);
    return normalizeWorkflowState(JSON.parse(raw), lang);
  } catch {
    return emptyWorkflowState(lang);
  }
}

function saveWorkflowState(state, lang = "zh", storage = globalThis.localStorage) {
  try {
    if (!storage) return;
    storage.setItem(WORKFLOW_STATE_KEY, JSON.stringify(normalizeWorkflowState(state, lang)));
  } catch {}
}

function clearWorkflowState(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(WORKFLOW_STATE_KEY);
  } catch {}
}

export {
  WORKFLOW_STATE_KEY,
  clearWorkflowState,
  loadWorkflowState,
  normalizeWorkflowState,
  saveWorkflowState,
};
