/**
 * GitHub signals for the TechAgent. We compute repo health: stars trajectory,
 * contributor count, language mix, recent commit velocity, open-issue ratio.
 * Auth via GITHUB_TOKEN dramatically raises the rate limit.
 */

import { request } from "undici";
import { config } from "../config.js";
import type { ToolDef } from "../llm/types.js";

const ghHeaders = (): Record<string, string> => {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Veridia",
  };
  if (config.GITHUB_TOKEN) h.Authorization = `Bearer ${config.GITHUB_TOKEN}`;
  return h;
};

async function ghGet<T>(path: string): Promise<T> {
  const res = await request(`https://api.github.com${path}`, {
    headers: ghHeaders(),
  });
  if (res.statusCode === 404) return null as unknown as T;
  if (res.statusCode >= 400) {
    const body = await res.body.text();
    throw new Error(`GitHub ${res.statusCode}: ${body.slice(0, 200)}`);
  }
  return (await res.body.json()) as T;
}

interface OrgRepo {
  name: string;
  full_name: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  pushed_at: string;
  archived: boolean;
  fork: boolean;
}

export const githubOrgHealthTool: ToolDef = {
  name: "github_org_health",
  description:
    "Snapshot the engineering health of a company's GitHub org: top repos by stars, total stars, languages, recent push activity, and the headline repo's contributor count. Pass the org login (e.g. 'openai', 'stripe').",
  inputSchema: {
    type: "object",
    properties: {
      org: { type: "string", description: "GitHub org login slug." },
      topN: { type: "integer", default: 5, maximum: 10 },
    },
    required: ["org"],
  },
  run: async (raw) => {
    const { org, topN = 5 } = raw as { org: string; topN?: number };
    const repos = await ghGet<OrgRepo[]>(
      `/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=pushed`,
    );
    if (!repos) return { error: `Org ${org} not found.` };
    const live = repos.filter((r) => !r.archived && !r.fork);
    const totalStars = live.reduce((s, r) => s + r.stargazers_count, 0);
    const top = [...live]
      .sort((a, b) => b.stargazers_count - a.stargazers_count)
      .slice(0, topN);
    const langs = new Map<string, number>();
    for (const r of live) {
      if (r.language) langs.set(r.language, (langs.get(r.language) ?? 0) + 1);
    }
    const recentlyActive = live.filter(
      (r) =>
        Date.now() - new Date(r.pushed_at).getTime() < 90 * 24 * 3600 * 1000,
    ).length;
    // Pull contributors for the headline repo (sample signal).
    let headlineContributors: number | null = null;
    if (top[0]) {
      const contribs = await ghGet<unknown[]>(
        `/repos/${top[0].full_name}/contributors?per_page=100&anon=true`,
      );
      headlineContributors = Array.isArray(contribs) ? contribs.length : null;
    }
    return {
      org,
      repoCount: live.length,
      totalStars,
      recentlyActive90d: recentlyActive,
      languageMix: Object.fromEntries(langs),
      topRepos: top.map((r) => ({
        name: r.name,
        stars: r.stargazers_count,
        forks: r.forks_count,
        openIssues: r.open_issues_count,
        language: r.language,
        pushedAt: r.pushed_at,
      })),
      headlineRepo: top[0]?.full_name,
      headlineContributors,
    };
  },
};

export const githubRepoHealthTool: ToolDef = {
  name: "github_repo_health",
  description:
    "Detail a single GitHub repository: stars, forks, open issues, languages, last push, and commit velocity (count of commits in the last 90 days, capped at 100).",
  inputSchema: {
    type: "object",
    properties: {
      repo: {
        type: "string",
        description: "Full repo path, e.g. 'vercel/next.js'.",
      },
    },
    required: ["repo"],
  },
  run: async (raw) => {
    const { repo } = raw as { repo: string };
    const r = await ghGet<{
      name: string;
      full_name: string;
      stargazers_count: number;
      forks_count: number;
      open_issues_count: number;
      language: string | null;
      pushed_at: string;
      description: string | null;
      license?: { spdx_id?: string } | null;
    }>(`/repos/${repo}`);
    if (!r) return { error: `Repo ${repo} not found.` };
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const commits = await ghGet<unknown[]>(
      `/repos/${repo}/commits?since=${since}&per_page=100`,
    );
    return {
      name: r.full_name,
      description: r.description,
      stars: r.stargazers_count,
      forks: r.forks_count,
      openIssues: r.open_issues_count,
      primaryLanguage: r.language,
      license: r.license?.spdx_id ?? null,
      lastPush: r.pushed_at,
      commits90d: Array.isArray(commits) ? commits.length : 0,
    };
  },
};
