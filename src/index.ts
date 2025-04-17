#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

// Read configuration from environment variables
const GITLAB_TOKEN = process.env.GITLAB_PERSONAL_ACCESS_TOKEN;
const GITLAB_API_URL = process.env.GITLAB_API_URL || 'https://gitlab.com/api/v4'; // Default to public GitLab

if (!GITLAB_TOKEN) {
  console.error('Error: GITLAB_PERSONAL_ACCESS_TOKEN environment variable is required.');
  process.exit(1); // Exit if token is missing
}

// --- Interfaces for GitLab API responses (add more as needed) ---
interface GitLabProject {
  id: number;
  name: string;
  description: string | null;
  web_url: string;
  path_with_namespace: string;
  // Add other relevant fields if needed, carefully check API docs
  // owner might be complex, fork status might be needed based on previous errors
  owner?: { id: number; username: string; name: string }; // Example, adjust based on actual API
  forked_from_project?: object;
}

interface GitLabIssue {
  id: number; // Global ID
  iid: number; // Project-specific IID
  project_id: number;
  title: string;
  description: string | null;
  state: 'opened' | 'closed';
  labels: string[];
  assignee: GitLabUser | null;
  assignees: GitLabUser[];
  web_url: string;
  // Add other fields as needed
}

interface GitLabNote {
    id: number;
    body: string;
    author: GitLabUser;
    created_at: string;
    system: boolean; // Add system property
    // Add other fields as needed
}

interface GitLabUser {
    id: number;
    username: string;
    name: string;
    // Add other fields as needed
}

interface GitLabBranch {
    name: string;
    commit: {
        id: string;
        short_id: string;
        title: string;
        created_at: string;
        // Add others if needed
    };
    web_url: string;
    // Add others if needed
}

// Interface for GitLab Group (add more fields if needed)
interface GitLabGroup {
    id: number;
    name: string;
    path: string;
    full_path: string;
    // Add other relevant fields if needed
}


// --- Type guards for tool arguments ---
const isValidSearchArgs = (args: any): args is { search: string; page?: number; per_page?: number } =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.search === 'string' &&
  (args.page === undefined || typeof args.page === 'number') &&
    (args.per_page === undefined || typeof args.per_page === 'number');

// Type guard for the new search_user tool
const isValidSearchUserArgs = (args: any): args is { search: string } =>
    typeof args === 'object' && args !== null && typeof args.search === 'string';

const isValidGetProjectArgs = (args: any): args is { git_url: string } =>
    typeof args === 'object' && args !== null && typeof args.git_url === 'string';

const isValidListIssuesArgs = (args: any): args is { project_id: number | string; state?: 'opened' | 'closed' | 'all'; labels?: string; assignee_id?: number | 'None'; scope?: 'created_by_me' | 'assigned_to_me' | 'all'; page?: number; per_page?: number } =>
    typeof args === 'object' && args !== null && (typeof args.project_id === 'number' || typeof args.project_id === 'string') &&
    (args.state === undefined || ['opened', 'closed', 'all'].includes(args.state)) &&
    (args.labels === undefined || typeof args.labels === 'string') &&
    (args.assignee_id === undefined || typeof args.assignee_id === 'number' || args.assignee_id === 'None') &&
    (args.scope === undefined || ['created_by_me', 'assigned_to_me', 'all'].includes(args.scope)) &&
    (args.page === undefined || typeof args.page === 'number') &&
    (args.per_page === undefined || typeof args.per_page === 'number');

const isValidGetMyIssuesArgs = (args: any): args is { state?: 'opened' | 'closed' | 'all'; scope?: 'assigned_to_me' | 'created_by_me' | 'all'; page?: number; per_page?: number } =>
    typeof args === 'object' && args !== null && // project_id is optional here, handled by API endpoint
    (args.state === undefined || ['opened', 'closed', 'all'].includes(args.state)) &&
    (args.scope === undefined || ['assigned_to_me', 'created_by_me', 'all'].includes(args.scope)) &&
    (args.page === undefined || typeof args.page === 'number') &&
    (args.per_page === undefined || typeof args.per_page === 'number');

const isValidGetIssueArgs = (args: any): args is { project_id: number | string; issue_iid: number } =>
    typeof args === 'object' && args !== null && (typeof args.project_id === 'number' || typeof args.project_id === 'string') && typeof args.issue_iid === 'number';

const isValidCreateNoteArgs = (args: any): args is { project_id: number | string; issue_iid: number; body: string } =>
    typeof args === 'object' && args !== null && (typeof args.project_id === 'number' || typeof args.project_id === 'string') && typeof args.issue_iid === 'number' && typeof args.body === 'string';

const isValidUpdateIssueArgs = (args: any): args is { project_id: number | string; issue_iid: number; description?: string; labels?: string; add_labels?: string; remove_labels?: string; state_event?: 'close' | 'reopen' } =>
    typeof args === 'object' && args !== null && (typeof args.project_id === 'number' || typeof args.project_id === 'string') && typeof args.issue_iid === 'number' &&
    (args.description === undefined || typeof args.description === 'string') &&
    (args.labels === undefined || typeof args.labels === 'string') &&
    (args.add_labels === undefined || typeof args.add_labels === 'string') &&
    (args.remove_labels === undefined || typeof args.remove_labels === 'string') &&
    (args.state_event === undefined || ['close', 'reopen'].includes(args.state_event));

const isValidCreateBranchArgs = (args: any): args is { project_id: number | string; branch_name: string; ref: string } =>
    typeof args === 'object' && args !== null && (typeof args.project_id === 'number' || typeof args.project_id === 'string') && typeof args.branch_name === 'string' && typeof args.ref === 'string';

const isValidCreateIssueArgs = (args: any): args is { project_id: number | string; title: string; description?: string; labels?: string; assignee_ids?: number[] } =>
    typeof args === 'object' && args !== null && (typeof args.project_id === 'number' || typeof args.project_id === 'string') && typeof args.title === 'string' &&
    (args.description === undefined || typeof args.description === 'string') &&
    (args.labels === undefined || typeof args.labels === 'string') &&
    (args.assignee_ids === undefined || (Array.isArray(args.assignee_ids) && args.assignee_ids.every((id: any) => typeof id === 'number')));

const isValidListIssueNotesArgs = (args: any): args is { project_id: number | string; issue_iid: number; page?: number; per_page?: number } =>
    typeof args === 'object' && args !== null &&
    (typeof args.project_id === 'number' || typeof args.project_id === 'string') &&
    typeof args.issue_iid === 'number' &&
    (args.page === undefined || typeof args.page === 'number') &&
    (args.per_page === undefined || typeof args.per_page === 'number');

// Add this with the other type guards near the top
const isValidCreateMrArgs = (args: any): args is { project_id: number | string; source_branch: string; target_branch: string; title: string; description?: string; assignee_id?: number; reviewer_ids?: number[] } =>
    typeof args === 'object' && args !== null &&
    (typeof args.project_id === 'number' || typeof args.project_id === 'string') &&
    typeof args.source_branch === 'string' &&
    typeof args.target_branch === 'string' &&
    typeof args.title === 'string' &&
    (args.description === undefined || typeof args.description === 'string') &&
    (args.assignee_id === undefined || typeof args.assignee_id === 'number') &&
    (args.reviewer_ids === undefined || (Array.isArray(args.reviewer_ids) && args.reviewer_ids.every((id: number) => typeof id === 'number')));

const isValidCreateMrNoteArgs = (args: any): args is { project_id: number | string; mr_iid: number; body: string } =>
    typeof args === 'object' && args !== null &&
    (typeof args.project_id === 'number' || typeof args.project_id === 'string') &&
    typeof args.mr_iid === 'number' &&
    typeof args.body === 'string';

// Type guard for create_repository
const isValidCreateRepositoryArgs = (args: any): args is { name: string; group_name?: string; namespace_id?: number; path?: string; description?: string; visibility?: 'private' | 'internal' | 'public'; initialize_with_readme?: boolean } =>
    typeof args === 'object' && args !== null &&
    typeof args.name === 'string' &&
    (args.group_name === undefined || typeof args.group_name === 'string') &&
    (args.namespace_id === undefined || typeof args.namespace_id === 'number') &&
    (args.path === undefined || typeof args.path === 'string') &&
    (args.description === undefined || typeof args.description === 'string') &&
    (args.visibility === undefined || ['private', 'internal', 'public'].includes(args.visibility)) &&
    (args.initialize_with_readme === undefined || typeof args.initialize_with_readme === 'boolean');


class CustomGitLabServer {
  private server: Server;
  private axiosInstance;

  constructor() {
    this.server = new Server(
      {
        // Match the name used during creation
        name: 'noqta-gitlab-server', // Or the name you entered: 'custom-gitlab-server'
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {}, // No resources defined for now
          tools: {},     // Tools will be added
        },
      }
    );

    // Configure axios for GitLab API
    this.axiosInstance = axios.create({
      baseURL: GITLAB_API_URL,
      headers: {
        'PRIVATE-TOKEN': GITLAB_TOKEN,
        'Content-Type': 'application/json',
      },
    });

    this.setupToolHandlers();

    // Basic error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    // --- List Available Tools ---
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'search_repositories',
          description: 'Search for GitLab projects by name',
          inputSchema: {
            type: 'object',
            properties: {
              search: {
                type: 'string',
                description: 'Search query string',
              },
              page: {
                type: 'number',
                description: 'Page number for pagination (default: 1)',
              },
              per_page: {
                type: 'number',
                description: 'Number of results per page (default: 20)',
              },
            },
            required: ['search'],
          },
          // Add outputSchema if desired
        },
        {
            name: 'get_project_from_git_url',
            description: 'Get GitLab project details from a git remote URL.',
            inputSchema: {
                type: 'object',
                properties: {
                    git_url: { type: 'string', description: 'The git remote URL (e.g., https://gitlab.example.com/group/project.git or git@gitlab.example.com:group/project.git)' },
                },
                required: ['git_url'],
            },
        },
        {
            name: 'list_issues',
            description: 'List issues for a specific GitLab project.',
            inputSchema: {
                type: 'object',
                properties: {
                    project_id: { type: ['number', 'string'], description: 'The ID or URL-encoded path of the project' },
                    state: { type: 'string', enum: ['opened', 'closed', 'all'], description: 'Filter by state' },
                    labels: { type: 'string', description: 'Comma-separated list of label names' },
                    assignee_id: { type: ['number', 'string'], description: 'Filter by assignee ID or "None"' },
                    scope: { type: 'string', enum: ['created_by_me', 'assigned_to_me', 'all'], description: 'Filter by scope' },
                    page: { type: 'number', description: 'Page number' },
                    per_page: { type: 'number', description: 'Results per page' },
                },
                required: ['project_id'],
            },
        },
        {
            name: 'get_my_issues',
            description: 'List issues assigned to or created by the authenticated user across all projects.',
            inputSchema: {
                type: 'object',
                properties: {
                    state: { type: 'string', enum: ['opened', 'closed', 'all'], description: 'Filter by state' },
                    scope: { type: 'string', enum: ['created_by_me', 'assigned_to_me', 'all'], description: 'Filter by scope (default: assigned_to_me)' },
                    page: { type: 'number', description: 'Page number' },
                    per_page: { type: 'number', description: 'Results per page' },
                },
                required: [], // No required fields, uses API defaults
            },
        },
        {
            name: 'get_issue',
            description: 'Get details of a specific issue within a project.',
            inputSchema: {
                type: 'object',
                properties: {
                    project_id: { type: ['number', 'string'], description: 'The ID or URL-encoded path of the project' },
                    issue_iid: { type: 'number', description: 'The internal ID (IID) of the issue' },
                },
                required: ['project_id', 'issue_iid'],
            },
        },
        {
            name: 'create_issue_note',
            description: 'Add a comment (note) to a specific issue.',
            inputSchema: {
                type: 'object',
                properties: {
                    project_id: { type: ['number', 'string'], description: 'The ID or URL-encoded path of the project' },
                    issue_iid: { type: 'number', description: 'The internal ID (IID) of the issue' },
                    body: { type: 'string', description: 'The content of the comment' },
                },
                required: ['project_id', 'issue_iid', 'body'],
            },
        },
        {
            name: 'update_issue',
            description: 'Update attributes of an issue (e.g., description, labels, state).',
            inputSchema: {
                type: 'object',
                properties: {
                    project_id: { type: ['number', 'string'], description: 'The ID or URL-encoded path of the project' },
                    issue_iid: { type: 'number', description: 'The internal ID (IID) of the issue' },
                    description: { type: 'string', description: 'New issue description (can include Markdown checklists)' }, // Modified description
                    labels: { type: 'string', description: 'Comma-separated list of label names to set (replaces existing)' },
                    add_labels: { type: 'string', description: 'Comma-separated list of label names to add' },
                    remove_labels: { type: 'string', description: 'Comma-separated list of label names to remove' },
                    state_event: { type: 'string', enum: ['close', 'reopen'], description: 'Event to change issue state' },
                },
                required: ['project_id', 'issue_iid'], // Need at least one attribute to update
            },
        },
        {
            name: 'create_branch',
            description: 'Create a new branch in a project.',
            inputSchema: {
                type: 'object',
                properties: {
                    project_id: { type: ['number', 'string'], description: 'The ID or URL-encoded path of the project' },
                    branch_name: { type: 'string', description: 'The name for the new branch' },
                    ref: { type: 'string', description: 'The branch name or commit SHA to create the new branch from' },
                },
                required: ['project_id', 'branch_name', 'ref'],
            },
        },
        {
            name: 'create_issue',
            description: 'Create a new issue in a project.',
            inputSchema: {
                type: 'object',
                properties: {
                    project_id: { type: ['number', 'string'], description: 'The ID or URL-encoded path of the project' },
                    title: { type: 'string', description: 'The title of the issue' },
                    description: { type: 'string', description: 'The description of the issue' },
                    labels: { type: 'string', description: 'Comma-separated list of label names' },
                    assignee_ids: { type: 'array', items: { type: 'number' }, description: 'Array of user IDs to assign' },
                },
                required: ['project_id', 'title'],
            },
        },
        {
          name: 'create_merge_request',
          description: 'Create a new merge request in a GitLab project.',
          inputSchema: {
              type: 'object',
              properties: {
                  project_id: { type: ['number', 'string'], description: 'The ID or URL-encoded path of the project' },
                  source_branch: { type: 'string', description: 'The source branch name' },
                  target_branch: { type: 'string', description: 'The target branch name' },
                  title: { type: 'string', description: 'Title of the merge request' },
                  description: { type: 'string', description: 'Optional description (Markdown supported)' },
                  assignee_id: { type: 'number', description: 'Optional user ID of the assignee' },
                  reviewer_ids: { type: 'array', items: { type: 'number' }, description: 'Optional array of user IDs for reviewers' }
              },
              required: ['project_id', 'source_branch', 'target_branch', 'title'],
            },
        },
        {
            name: 'list_issue_notes',
            description: 'List comments (notes) for a specific issue.',
            inputSchema: {
                type: 'object',
                properties: {
                    project_id: { type: ['number', 'string'], description: 'The ID or URL-encoded path of the project' },
                    issue_iid: { type: 'number', description: 'The internal ID (IID) of the issue' },
                    page: { type: 'number', description: 'Page number' },
                    per_page: { type: 'number', description: 'Results per page' },
                },
                required: ['project_id', 'issue_iid'],
            },
        },
        {
            name: 'create_merge_request_note',
            description: 'Add a comment (note) to a specific merge request.',
            inputSchema: {
                type: 'object',
                properties: {
                    project_id: { type: ['number', 'string'], description: 'The ID or URL-encoded path of the project' },
                    mr_iid: { type: 'number', description: 'The internal ID (IID) of the merge request' },
                    body: { type: 'string', description: 'The content of the comment' },
                },
                required: ['project_id', 'mr_iid', 'body'],
            },
        },
        // Definition for the new search_user tool
        {
            name: 'search_user',
            description: 'Search for GitLab users by email or username.',
            inputSchema: {
                type: 'object',
                properties: {
                    search: { type: 'string', description: 'The email or username to search for.' },
                },
                required: ['search'],
            },
        },
        // Definition for the new create_repository tool
        {
            name: 'create_repository',
            description: 'Create a new GitLab project (repository).',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'The name of the new project (repository).' },
                    group_name: { type: 'string', description: 'Optional: Name of the group (namespace) to create the project in. If provided, namespace_id will be ignored.' },
                    namespace_id: { type: 'number', description: 'Optional: Direct Namespace ID for the project (group or user). Ignored if group_name is provided. Defaults to the authenticated user if neither is specified.' },
                    path: { type: 'string', description: 'Optional: Custom repository path (defaults to name).' },
                    description: { type: 'string', description: 'Optional: Short project description.' },
                    visibility: { type: 'string', enum: ['private', 'internal', 'public'], description: 'Optional: Project visibility (default: private).' },
                    initialize_with_readme: { type: 'boolean', description: 'Optional: Initialize with a README (default: false).' },
                },
                required: ['name'],
            },
        },
      ],
    }));

    // --- Handle Tool Calls ---
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'search_repositories':
          return this.handleSearchRepositories(request.params.arguments);
        case 'get_project_from_git_url':
            return this.handleGetProjectFromGitUrl(request.params.arguments);
        case 'list_issues':
            return this.handleListIssues(request.params.arguments);
        case 'get_my_issues':
            return this.handleGetMyIssues(request.params.arguments);
        case 'get_issue':
            return this.handleGetIssue(request.params.arguments);
        case 'create_issue_note':
            return this.handleCreateIssueNote(request.params.arguments);
        case 'update_issue':
            return this.handleUpdateIssue(request.params.arguments);
        case 'create_branch':
            return this.handleCreateBranch(request.params.arguments);
        case 'create_issue':
            return this.handleCreateIssue(request.params.arguments);
        case 'create_merge_request':
            return this.handleCreateMergeRequest(request.params.arguments);
        case 'list_issue_notes':
            return this.handleListIssueNotes(request.params.arguments);
        case 'create_merge_request_note':
            return this.handleCreateMergeRequestNote(request.params.arguments);
        // Case for the new search_user tool
        case 'search_user':
            return this.handleSearchUser(request.params.arguments);
        // Case for the new create_repository tool
        case 'create_repository':
            return this.handleCreateRepository(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  // --- Tool Implementation: search_repositories ---
  private async handleSearchRepositories(args: any) {
    if (!isValidSearchArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for search_repositories');
    }

    const { search, page, per_page } = args;

    try {
      console.error(`Searching GitLab projects with query: "${search}" at ${GITLAB_API_URL}`); // Log the attempt
      const response = await this.axiosInstance.get<GitLabProject[]>('/projects', {
        params: {
          search: search,
          page: page,
          per_page: per_page,
          // Add other parameters like 'scope' if needed, e.g., 'scope': 'projects'
        },
      });

      console.error(`GitLab API response status: ${response.status}`); // Log status
      // console.error(`GitLab API response data:`, response.data); // Log raw data for debugging

      // Basic check if response looks like an array of projects
      if (!Array.isArray(response.data)) {
         console.error('GitLab API did not return an array for /projects');
         throw new McpError(ErrorCode.InternalError, 'Unexpected response format from GitLab API');
      }

      // Selectively return data to avoid potential issues with complex fields
      const simplifiedResults = response.data.map(project => ({
        id: project.id,
        name: project.name,
        path_with_namespace: project.path_with_namespace,
        description: project.description,
        web_url: project.web_url,
      }));


      return {
        content: [
          {
            type: 'text',
            // Return simplified results as JSON
            text: JSON.stringify(simplifiedResults, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('Error calling GitLab API:', error); // Log the full error
      if (axios.isAxiosError(error)) {
         const errorMessage = `GitLab API error: ${error.response?.status} ${error.response?.statusText} - ${JSON.stringify(error.response?.data)}`;
         console.error(errorMessage);
        return {
          content: [{ type: 'text', text: errorMessage }],
          isError: true,
        };
      }
      // Re-throw unexpected errors, checking the type first
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new McpError(ErrorCode.InternalError, `Unexpected error during GitLab API call: ${errorMessage}`);
    }
  }

  // --- Tool Implementation: get_project_from_git_url ---
  private async handleGetProjectFromGitUrl(args: any) {
    if (!isValidGetProjectArgs(args)) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for get_project_from_git_url');
    }
    const { git_url } = args;

    // Extract project path from URL (e.g., "group/subgroup/project" from "https://gitlab.example.com/group/subgroup/project.git")
    let projectPath = '';
    try {
        const url = new URL(git_url);
        projectPath = url.pathname.replace(/^\//, '').replace(/\.git$/, '');
    } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid git_url format');
    }

    if (!projectPath) {
        throw new McpError(ErrorCode.InvalidParams, 'Could not extract project path from git_url');
    }

    try {
        // URL-encode the project path
        const encodedProjectPath = encodeURIComponent(projectPath);
        console.error(`Fetching project details for path: "${projectPath}" (encoded: ${encodedProjectPath})`);
        const response = await this.axiosInstance.get<GitLabProject>(`/projects/${encodedProjectPath}`);
        console.error(`GitLab API response status: ${response.status}`);

        return {
            content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
        };
    } catch (error) {
        return this.handleGitLabApiError(error, 'get_project_from_git_url');
    }
  }

  // --- Tool Implementation: list_issues ---
  private async handleListIssues(args: any) {
      if (!isValidListIssuesArgs(args)) {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for list_issues');
      }
      const { project_id, state, labels, assignee_id, scope, page, per_page } = args;
      const projectIdEncoded = encodeURIComponent(project_id.toString());

      try {
          console.error(`Listing issues for project ${project_id}`);
          const response = await this.axiosInstance.get<GitLabIssue[]>(`/projects/${projectIdEncoded}/issues`, {
              params: { state, labels, assignee_id, scope, page, per_page },
          });
          console.error(`GitLab API response status: ${response.status}`);
          return {
              content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
          };
      } catch (error) {
          return this.handleGitLabApiError(error, 'list_issues');
      }
  }

  // --- Tool Implementation: create_repository ---
  private async handleCreateRepository(args: any) {
      if (!isValidCreateRepositoryArgs(args)) {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for create_repository');
      }
      // Explicitly destructure all potential args based on the updated type guard
      const { name, group_name, namespace_id, path, description, visibility, initialize_with_readme } = args;

      let finalNamespaceId: number | undefined = namespace_id;

      try {
          // --- Group Lookup Logic ---
          if (group_name) {
              console.error(`Searching for group with name: "${group_name}"`);
              try {
                  const groupSearchResponse = await this.axiosInstance.get<GitLabGroup[]>('/groups', {
                      params: { search: group_name, top_level_only: true } // Search top-level groups for simplicity, adjust if needed
                  });

                  const matchingGroups = groupSearchResponse.data.filter(group => group.name === group_name || group.path === group_name || group.full_path === group_name);

                  if (matchingGroups.length === 0) {
                      throw new McpError(ErrorCode.InvalidParams, `Group named "${group_name}" not found.`);
                  } else if (matchingGroups.length > 1) {
                      // Be specific about the ambiguity
                      const foundPaths = matchingGroups.map(g => g.full_path).join(', ');
                      throw new McpError(ErrorCode.InvalidParams, `Multiple groups found matching "${group_name}": ${foundPaths}. Please provide a more specific group_name or use namespace_id.`);
                  } else {
                      finalNamespaceId = matchingGroups[0].id;
                      console.error(`Found group "${group_name}" with ID: ${finalNamespaceId}. Using this namespace_id.`);
                  }
              } catch (groupError) {
                  // Re-throw specific McpErrors, handle others as internal errors
                  if (groupError instanceof McpError) {
                      throw groupError;
                  }
                  return this.handleGitLabApiError(groupError, 'create_repository (group search)');
              }
          }
          // --- End Group Lookup ---

          // Prepare data for project creation, ensuring namespace_id is correctly set
          const projectData: { [key: string]: any } = {
              name: name,
              path: path, // Let GitLab handle default path if undefined
              description: description,
              visibility: visibility,
              initialize_with_readme: initialize_with_readme,
              // Only include namespace_id if it has a value (either found or provided)
              ...(finalNamespaceId !== undefined && { namespace_id: finalNamespaceId }),
          };

          // Remove undefined keys to avoid sending them in the API request
          Object.keys(projectData).forEach(key => projectData[key] === undefined && delete projectData[key]);


          console.error(`Creating GitLab repository with data:`, projectData);
          const response = await this.axiosInstance.post<GitLabProject>('/projects', projectData);
          console.error(`GitLab API response status: ${response.status}`);
          return {
              content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
          };
      } catch (error) {
          return this.handleGitLabApiError(error, 'create_repository');
      }
  }

  // --- Tool Implementation: get_my_issues ---
  private async handleGetMyIssues(args: any) {
      if (!isValidGetMyIssuesArgs(args)) {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for get_my_issues');
      }
      const { state, scope, page, per_page } = args;

      try {
          console.error(`Listing my issues`);
          // Uses the /issues endpoint without project ID to get issues related to the authenticated user
          const response = await this.axiosInstance.get<GitLabIssue[]>(`/issues`, {
              params: { state, scope: scope ?? 'assigned_to_me', page, per_page }, // Default scope to assigned_to_me
          });
          console.error(`GitLab API response status: ${response.status}`);
          return {
              content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
          };
      } catch (error) {
          return this.handleGitLabApiError(error, 'get_my_issues');
      }
  }

   // --- Tool Implementation: get_issue ---
   private async handleGetIssue(args: any) {
    if (!isValidGetIssueArgs(args)) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for get_issue');
    }
    const { project_id, issue_iid } = args;
    const projectIdEncoded = encodeURIComponent(project_id.toString());

    try {
        console.error(`Getting issue ${issue_iid} for project ${project_id}`);
        const response = await this.axiosInstance.get<GitLabIssue>(`/projects/${projectIdEncoded}/issues/${issue_iid}`);
        console.error(`GitLab API response status: ${response.status}`);
        return {
            content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
        };
    } catch (error) {
        return this.handleGitLabApiError(error, 'get_issue');
    }
  }

  // --- Tool Implementation: create_issue_note ---
  private async handleCreateIssueNote(args: any) {
      if (!isValidCreateNoteArgs(args)) {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for create_issue_note');
      }
      const { project_id, issue_iid, body } = args;
      const projectIdEncoded = encodeURIComponent(project_id.toString());

      try {
          console.error(`Adding note to issue ${issue_iid} in project ${project_id}`);
          const response = await this.axiosInstance.post<GitLabNote>(`/projects/${projectIdEncoded}/issues/${issue_iid}/notes`, { body });
          console.error(`GitLab API response status: ${response.status}`);
          return {
              content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
          };
      } catch (error) {
          return this.handleGitLabApiError(error, 'create_issue_note');
      }
  }

  // --- Tool Implementation: update_issue ---
  private async handleUpdateIssue(args: any) {
      if (!isValidUpdateIssueArgs(args)) {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for update_issue');
      }
      const { project_id, issue_iid, ...updateData } = args; // Separate IDs from data
      const projectIdEncoded = encodeURIComponent(project_id.toString());

      try {
          console.error(`Updating issue ${issue_iid} in project ${project_id}`);
          const response = await this.axiosInstance.put<GitLabIssue>(`/projects/${projectIdEncoded}/issues/${issue_iid}`, updateData);
          console.error(`GitLab API response status: ${response.status}`);
          return {
              content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
          };
      } catch (error) {
          return this.handleGitLabApiError(error, 'update_issue');
      }
  }

   // --- Tool Implementation: create_branch ---
   private async handleCreateBranch(args: any) {
    if (!isValidCreateBranchArgs(args)) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for create_branch');
    }
    const { project_id, branch_name, ref } = args;
    const projectIdEncoded = encodeURIComponent(project_id.toString());

    try {
        console.error(`Creating branch "${branch_name}" from ref "${ref}" in project ${project_id}`);
        const response = await this.axiosInstance.post<GitLabBranch>(`/projects/${projectIdEncoded}/repository/branches`, null, { // POST data is null, params in query string
            params: {
                branch: branch_name,
                ref: ref,
            }
        });
        console.error(`GitLab API response status: ${response.status}`);
        return {
            content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
        };
    } catch (error) {
        return this.handleGitLabApiError(error, 'create_branch');
    }
  }

  // --- Tool Implementation: create_issue ---
  private async handleCreateIssue(args: any) {
    if (!isValidCreateIssueArgs(args)) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for create_issue');
    }
    const { project_id, ...issueData } = args; // Separate project_id from issue data
    const projectIdEncoded = encodeURIComponent(project_id.toString());

    try {
        console.error(`Creating issue in project ${project_id} with title "${issueData.title}"`);
        const response = await this.axiosInstance.post<GitLabIssue>(`/projects/${projectIdEncoded}/issues`, issueData);
        console.error(`GitLab API response status: ${response.status}`);
        return {
            content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
        };
    } catch (error) {
        return this.handleGitLabApiError(error, 'create_issue');
    }
  }

  // --- Tool Implementation: create_merge_request ---
  private async handleCreateMergeRequest(args: any) {
    if (!isValidCreateMrArgs(args)) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for create_merge_request');
    }
    const { project_id, ...mrData } = args; // Separate project_id from MR data
    const projectIdEncoded = encodeURIComponent(project_id.toString());

    try {
        console.error(`Creating merge request in project ${project_id} from ${mrData.source_branch} to ${mrData.target_branch}`);
        // Ensure required fields are passed in the body
        const response = await this.axiosInstance.post(`/projects/${projectIdEncoded}/merge_requests`, mrData);
        console.error(`GitLab API response status: ${response.status}`);
        return {
            content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
        };
    } catch (error) {
        return this.handleGitLabApiError(error, 'create_merge_request');
    }
  }

  // --- Tool Implementation: list_issue_notes ---
  private async handleListIssueNotes(args: any) {
      if (!isValidListIssueNotesArgs(args)) {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for list_issue_notes');
      }
      const { project_id, issue_iid, page, per_page } = args;
      const projectIdEncoded = encodeURIComponent(project_id.toString());

      try {
          console.error(`Listing notes for issue ${issue_iid} in project ${project_id}`);
          const response = await this.axiosInstance.get<GitLabNote[]>(`/projects/${projectIdEncoded}/issues/${issue_iid}/notes`, {
              params: { page, per_page, sort: 'asc' }, // Sort by oldest first
          });
          console.error(`GitLab API response status: ${response.status}`);
          // Simplify output slightly
          const simplifiedNotes = response.data.map(note => ({
              id: note.id,
              body: note.body,
              author: note.author.username,
              created_at: note.created_at,
              system: note.system, // Now this property exists on the interface
          }));
          return {
              content: [{ type: 'text', text: JSON.stringify(simplifiedNotes, null, 2) }],
          };
      } catch (error) {
          return this.handleGitLabApiError(error, 'list_issue_notes');
      }
  }

  // --- Tool Implementation: search_user ---
  private async handleSearchUser(args: any) {
      if (!isValidSearchUserArgs(args)) {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for search_user');
      }
      const { search } = args;

      try {
          console.error(`Searching GitLab users with query: "${search}"`);
          const response = await this.axiosInstance.get<GitLabUser[]>('/users', {
              params: { search: search },
          });
          console.error(`GitLab API response status: ${response.status}`);
          // Return the array of user objects found
          return {
              content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
          };
      } catch (error) {
          return this.handleGitLabApiError(error, 'search_user');
      }
  }

  // --- Tool Implementation: create_merge_request_note ---
  private async handleCreateMergeRequestNote(args: any) {
      if (!isValidCreateMrNoteArgs(args)) {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for create_merge_request_note');
      }
      const { project_id, mr_iid, body } = args;
      const projectIdEncoded = encodeURIComponent(project_id.toString());

      try {
          console.error(`Adding note to MR !${mr_iid} in project ${project_id}`);
          // Use the MR notes endpoint
          const response = await this.axiosInstance.post<GitLabNote>(`/projects/${projectIdEncoded}/merge_requests/${mr_iid}/notes`, { body });
          console.error(`GitLab API response status: ${response.status}`);
          return {
              content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
          };
      } catch (error) {
          return this.handleGitLabApiError(error, 'create_merge_request_note');
      }
  }


  // --- Helper for API Error Handling ---
  private handleGitLabApiError(error: any, toolName: string) {
      console.error(`Error calling GitLab API for ${toolName}:`, error);
      if (axios.isAxiosError(error)) {
          const errorMessage = `GitLab API error (${toolName}): ${error.response?.status} ${error.response?.statusText} - ${JSON.stringify(error.response?.data)}`;
          console.error(errorMessage);
          return {
              content: [{ type: 'text', text: errorMessage }],
              isError: true,
          };
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new McpError(ErrorCode.InternalError, `Unexpected error during GitLab API call (${toolName}): ${errorMessage}`);
  }


  // --- Start the Server ---
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`Custom GitLab MCP server (noqta-gitlab-server) running on stdio, connected to ${GITLAB_API_URL}`);
  }
}

// Instantiate and run the server
const server = new CustomGitLabServer();
server.run().catch(error => {
  if (error instanceof Error) {
    console.error("Failed to start Custom GitLab Server:", error.message);
  } else {
    console.error("Failed to start Custom GitLab Server with unknown error:", error);
  }
  process.exit(1);
});
