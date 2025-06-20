import * as vscode from "vscode";
import { CancellationToken, LanguageModelToolInvocationOptions, lm } from "vscode";
import { getFullMcpServerId } from "../../util.js";
import { LmToolName } from "../types.js";
import { ToolBase, ToolPrepareMessage } from "./tool-base.js";

interface McpServerActionToolParameters {
  mcpServerId: string;
  /** If start/restart, these tools will be included in the next conversation */
  action: "start" | "stop" | "restart" | "resetCaches";
}

export class McpServerActionTool extends ToolBase<McpServerActionToolParameters, string> {
  static TOOL_NAME = LmToolName.mcp_server_action;
  static async register() {
    return lm.registerTool(this.TOOL_NAME, new McpServerActionTool());
  }

  getPrepareMessage(input: McpServerActionToolParameters): ToolPrepareMessage {
    return {
      invocationMessage: `Take action on MCP server with ID '${input.mcpServerId}': ${input.action}`,
      confirmTitle: undefined,
      confirmMessage: undefined,
    };
  }

  async doWork(
    options: LanguageModelToolInvocationOptions<McpServerActionToolParameters>,
    token: CancellationToken,
  ): Promise<string | undefined> {
    const cmdIdMap: Record<string, string> = {
      start: "workbench.mcp.startServer",
      stop: "workbench.mcp.stopServer",
      restart: "workbench.mcp.restartServer",
      resetCaches: "workbench.mcp.resetCachedTools",
    };

    const cmdId = cmdIdMap[options.input.action];
    if (!cmdId) {
      return `Unsupported action: ${options.input.action}.`;
    }
    const fullId = getFullMcpServerId(options.input.mcpServerId);

    try {
      await vscode.commands.executeCommand(cmdId, fullId);
      return `Finish executing action '${options.input.action}' on MCP server with ID '${fullId}'.`;
    } catch (error) {
      return `Failed to execute action '${options.input.action}' on MCP server with ID '${fullId}': ${error}`;
    }
  }
}
