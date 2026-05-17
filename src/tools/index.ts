import { tavilySearchTool } from "./tavily.js";
import { exaSearchTool } from "./exa.js";
import {
  secCompanyFactsTool,
  secRecentFilingsTool,
} from "./sec-edgar.js";
import { githubOrgHealthTool, githubRepoHealthTool } from "./github.js";

/** Per-agent whitelisted tool sets — sealed surface. */
export const toolsByAgent = {
  market: [tavilySearchTool, exaSearchTool],
  financial: [secCompanyFactsTool, secRecentFilingsTool, tavilySearchTool],
  tech: [githubOrgHealthTool, githubRepoHealthTool, exaSearchTool],
  team: [tavilySearchTool, exaSearchTool],
  risk: [tavilySearchTool],
} as const;

export {
  tavilySearchTool,
  exaSearchTool,
  secCompanyFactsTool,
  secRecentFilingsTool,
  githubOrgHealthTool,
  githubRepoHealthTool,
};
