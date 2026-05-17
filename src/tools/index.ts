import { tavilySearchTool } from "./tavily.js";
import { exaSearchTool } from "./exa.js";
import {
  secCompanyFactsTool,
  secRecentFilingsTool,
} from "./sec-edgar.js";
import { githubOrgHealthTool, githubRepoHealthTool } from "./github.js";
import { fetchPageTool } from "./fetch-page.js";

/** Per-agent whitelisted tool sets — sealed surface. */
export const toolsByAgent = {
  market: [tavilySearchTool, exaSearchTool, fetchPageTool],
  financial: [secCompanyFactsTool, secRecentFilingsTool, tavilySearchTool, fetchPageTool],
  tech: [githubOrgHealthTool, githubRepoHealthTool, exaSearchTool, fetchPageTool],
  team: [tavilySearchTool, exaSearchTool, fetchPageTool],
  risk: [tavilySearchTool, fetchPageTool],
} as const;

export {
  tavilySearchTool,
  exaSearchTool,
  secCompanyFactsTool,
  secRecentFilingsTool,
  githubOrgHealthTool,
  githubRepoHealthTool,
  fetchPageTool,
};
