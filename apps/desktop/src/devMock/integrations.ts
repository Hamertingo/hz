import type { GoogleService, Integrations } from "../lib/kit";

/// Accounts and integrations in the browser preview: Google signed in with two agents granted, Bark set up,
/// Composio and 1Password not yet, so every row shows both of its states once clicked through.
const state: Integrations = {
  google: { connected: true, hasClient: true, email: "ada@example.com", services: ["gmail", "calendar", "drive"], agents: ["a1"] },
  composio: { connected: false, workspaces: [] },
  bark: { connected: true, server: "https://api.day.app", fullText: false, encrypted: false },
  onepassword: { installed: true, enabled: false, agents: [] },
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
  integrations_status: () => structuredClone(state),
  google_set_client: () => {
    state.google.hasClient = true;
  },
  google_sign_in: async (a) => {
    await wait(900);
    state.google = { ...state.google, connected: true, email: "ada@example.com", services: a.services as GoogleService[] };
    return { email: state.google.email, services: state.google.services };
  },
  google_cancel: () => undefined,
  google_sign_out: () => {
    state.google = { ...state.google, connected: false, email: null, services: [] };
  },
  google_grant: (a) => {
    const id = String(a.agent);
    state.google.agents = a.on ? [...new Set([...state.google.agents, id])] : state.google.agents.filter((x) => x !== id);
  },
  composio_connect: (a) => {
    state.composio = { connected: true, workspaces: [String(a.workspaceId)] };
  },
  composio_disconnect: () => {
    state.composio = { connected: false, workspaces: [] };
  },
  bark_set: (a) => {
    state.bark = { ...state.bark, connected: true, encrypted: !!a.encryptKey, fullText: false };
  },
  bark_full_text: (a) => {
    state.bark.fullText = !!a.on && state.bark.encrypted;
  },
  bark_clear: () => {
    state.bark.connected = false;
  },
  bark_test: () => undefined,
  op_set: (a) => {
    state.onepassword = { ...state.onepassword, enabled: !!a.enabled, agents: a.agents as string[] };
  },
  op_lookup: () => ({ available: true, title: "GitHub" }),
};
