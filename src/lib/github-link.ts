import { createGitHubAppJwt } from "@/lib/github-app";

const API = "https://api.github.com";
const API_VERSION = "2026-03-10";
type Fetcher = typeof fetch;
type Env = Record<string, string | undefined>;
const REQUIRED_APP_PERMISSIONS: Record<string, string> = {
  metadata: "read", contents: "read", issues: "read", pull_requests: "read", checks: "read", vulnerability_alerts: "read",
};

const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

async function api<T>(path: string, token: string, fetcher: Fetcher): Promise<T> {
  const response = await fetcher(`${API}${path}`, {
    redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": API_VERSION, "user-agent": "Waypoint" },
  });
  const text = await response.text();
  if (!response.ok || text.length > 1_000_000) throw new Error(`GitHub request failed (${response.status}).`);
  return JSON.parse(text) as T;
}

/** Exchange an OAuth code for the signed-in GitHub user's identity and the installations of THIS app they can access. */
export async function authorizeGitHubUserInstallations(code: string, options: { env?: Env; fetch?: Fetcher } = {}) {
  if (!code || code.length > 512) throw new Error("GitHub authorization response is invalid.");
  const env = options.env ?? process.env;
  const clientId = env.GITHUB_APP_CLIENT_ID;
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GitHub OAuth credentials are not configured.");
  const fetcher = options.fetch ?? fetch;
  const response = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "Waypoint" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const text = await response.text();
  if (!response.ok || text.length > 64_000) throw new Error(`GitHub OAuth failed (${response.status}).`);
  const auth: unknown = JSON.parse(text);
  const userToken = typeof auth === "object" && auth !== null ? (auth as Record<string, unknown>).access_token : null;
  if (typeof userToken !== "string") throw new Error("GitHub OAuth did not issue a user token.");
  try {
    const user = await api<{ id?: unknown; login?: unknown }>("/user", userToken, fetcher);
    if (!positiveId(user.id) || typeof user.login !== "string") throw new Error("GitHub user identity is invalid.");
    const installationIds: number[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = await api<{ installations?: unknown }>(`/user/installations?per_page=100&page=${page}`, userToken, fetcher);
      if (!Array.isArray(result.installations)) throw new Error("GitHub installation list is invalid.");
      for (const item of result.installations) {
        const id = typeof item === "object" && item !== null ? (item as Record<string, unknown>).id : null;
        if (positiveId(id)) installationIds.push(id);
      }
      if (result.installations.length < 100) break;
    }
    return { githubUserId: user.id, githubLogin: user.login, installationIds: installationIds.slice(0, 10) };
  } finally {
    await fetcher(`${API}/applications/${encodeURIComponent(clientId)}/token`, {
      method: "DELETE", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/vnd.github+json", authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "x-github-api-version": API_VERSION, "user-agent": "Waypoint", "content-type": "application/json" },
      body: JSON.stringify({ access_token: userToken }),
    }).catch(() => null);
  }
}

/** Read-only diagnostic of the registered GitHub App against what Waypoint needs. Never returns secret values. */
export async function describeGitHubAppSetup(options: { env?: Env; fetch?: Fetcher } = {}) {
  const env = options.env ?? process.env;
  const fetcher = options.fetch ?? fetch;
  const present = {
    appId: /^\d{1,20}$/.test(env.GITHUB_APP_ID?.trim() ?? ""),
    slug: /^[a-z0-9-]{1,100}$/i.test(env.GITHUB_APP_SLUG ?? ""),
    privateKey: Boolean(env.GITHUB_APP_PRIVATE_KEY?.includes("PRIVATE KEY")),
    clientId: Boolean(env.GITHUB_APP_CLIENT_ID),
    clientSecret: Boolean(env.GITHUB_APP_CLIENT_SECRET),
    stateSecret: (env.GITHUB_APP_STATE_SECRET?.length ?? 0) >= 32,
  };
  type AppInfo = { slug: string; matchesSlug: boolean; missingPermissions: string[]; installations: number };
  if (!Object.values(present).every(Boolean)) return { present, reachable: false, app: null as AppInfo | null };
  try {
    const jwt = createGitHubAppJwt(env.GITHUB_APP_ID!.trim(), env.GITHUB_APP_PRIVATE_KEY!.replaceAll("\\n", "\n"));
    const app = await api<{ slug?: unknown; permissions?: unknown }>("/app", jwt, fetcher);
    const installs = await api<unknown>("/app/installations?per_page=100", jwt, fetcher);
    const permissions = typeof app.permissions === "object" && app.permissions !== null ? app.permissions as Record<string, string> : {};
    const rank = (value?: string) => (value === "write" || value === "admin" ? 2 : value === "read" ? 1 : 0);
    const missingPermissions = Object.entries(REQUIRED_APP_PERMISSIONS).filter(([name, level]) => rank(permissions[name]) < rank(level)).map(([name]) => name);
    return { present, reachable: true, app: { slug: String(app.slug ?? ""), matchesSlug: app.slug === env.GITHUB_APP_SLUG, missingPermissions, installations: Array.isArray(installs) ? installs.length : 0 } as AppInfo | null };
  } catch { return { present, reachable: false, app: null as AppInfo | null }; }
}
