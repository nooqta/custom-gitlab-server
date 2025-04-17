# GitLab MCP Server (noqta-gitlab-server)

A [Model Context Protocol (MCP)](https://github.com/modelcontextprotocol/specification) server that provides tools for interacting with the GitLab API.

This server allows AI assistants (like Claude via the MCP integration) to perform various actions on GitLab, such as searching repositories, managing issues, creating branches, and more, directly through natural language commands.

## Features / Available Tools

This server exposes the following tools for use by MCP clients:

*   **`search_repositories`**: Search for GitLab projects by name.
*   **`get_project_from_git_url`**: Get GitLab project details from a git remote URL.
*   **`list_issues`**: List issues for a specific GitLab project (filterable by state, labels, assignee, scope).
*   **`get_my_issues`**: List issues assigned to or created by the authenticated user across all projects (filterable by state, scope).
*   **`get_issue`**: Get details of a specific issue within a project by its IID.
*   **`create_issue_note`**: Add a comment (note) to a specific issue.
*   **`update_issue`**: Update attributes of an issue (e.g., description, labels, state).
*   **`create_branch`**: Create a new branch in a project from a specified ref.
*   **`create_issue`**: Create a new issue in a project.
*   **`create_merge_request`**: Create a new merge request.
*   **`list_issue_notes`**: List comments (notes) for a specific issue.
*   **`create_merge_request_note`**: Add a comment (note) to a specific merge request.
*   **`search_user`**: Search for GitLab users by email or username.
*   **`create_repository`**: Create a new GitLab project (repository) under a user or group namespace.

*(Refer to the server's `ListTools` response or the source code (`src/index.ts`) for detailed input schemas for each tool.)*

## Prerequisites

*   Node.js (LTS version recommended)
*   npm (usually included with Node.js)
*   A GitLab account (gitlab.com or self-hosted)
*   A GitLab Personal Access Token with `api` and `read_api` scopes.

## Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/nooqta/noqta-gitlab-server.git # Replace with actual URL after creation
    cd noqta-gitlab-server
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    *   Copy the example environment file:
        ```bash
        cp .env.example .env
        ```
    *   Edit the `.env` file:
        *   Generate a **GitLab Personal Access Token**: Go to your GitLab profile -> Settings -> Access Tokens. Create a token with `api` and `read_api` scopes.
        *   Paste the generated token into `.env` for the `GITLAB_PERSONAL_ACCESS_TOKEN` variable.
        *   **(Optional)** If you use a self-hosted GitLab instance, update `GITLAB_API_URL` to point to your instance's API endpoint (e.g., `https://gitlab.yourcompany.com/api/v4`). Otherwise, leave it as the default for gitlab.com.

4.  **Build the server:**
    ```bash
    npm run build
    ```
    This compiles the TypeScript code to JavaScript in the `build/` directory.

## Running the Server

You can run the server directly using Node.js:

```bash
node build/index.js
```

The server communicates over standard input/output (stdio). For persistent use, consider running it with a process manager like `pm2` or `systemd`.

## Integration (Example: Claude Desktop)

To use this server with an MCP client like Claude Desktop, add its configuration to the client's settings file.

**Configuration File Locations:**
*   **MacOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
*   **Windows:** `%APPDATA%/Claude/claude_desktop_config.json`
*   **Linux:** `~/.config/Claude/claude_desktop_config.json`

**Example `claude_desktop_config.json` entry:**

```json
{
  "mcpServers": {
    "noqta-gitlab-server": {
      "command": "/full/path/to/your/noqta-gitlab-server/build/index.js"
    }
  }
  // Potentially other configurations...
}
```

**Important:** Replace `/full/path/to/your/noqta-gitlab-server/` with the actual absolute path to where you cloned the repository.

## Development

*   **Build:** `npm run build` (Compiles TypeScript and sets executable permissions)
*   **Watch Mode:** `npm run watch` (Automatically recompiles on file changes)

## Debugging

Since MCP servers communicate over stdio, direct debugging can be tricky. Use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) for easier debugging:

```bash
npm run inspector
```

This command starts the server with the inspector attached. Open the URL provided in the console output in your browser to view MCP messages and server logs.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please see the [CONTRIBUTING.md](CONTRIBUTING.md) file for guidelines.
