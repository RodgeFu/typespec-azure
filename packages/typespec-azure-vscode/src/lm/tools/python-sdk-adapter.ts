import * as vscode from "vscode";
import { CancellationToken, LanguageModelToolInvocationOptions, lm } from "vscode";
import { tryReadFileOrUrl } from "../../util.js";
import { LmToolName } from "../types.js";
import { ToolBase, ToolPrepareMessage } from "./tool-base.js";

export const AzureSdkPythonMcpId = "azure-sdk-python-mcp";

export async function registerAzureSdkPythonMcp(): Promise<vscode.Disposable> {
  const mcp = await vscode.lm.registerMcpServerDefinitionProvider(AzureSdkPythonMcpId, {
    provideMcpServerDefinitions: async () => {
      //const localLocation = "c:/git/RodgeFu/azure-sdk-for-python";
      const mcpServerDefinition = new vscode.McpStdioServerDefinition(AzureSdkPythonMcpId, "uv", [
        "run",
        "--index-url",
        "https://pkgs.dev.azure.com/azure-sdk/public/_packaging/azure-sdk-for-python/pypi/simple/",
        "--with",
        "azure-sdk-python-mcp",
        "azure-sdk-python-mcp",
        // "--directory",
        // //join(localLocation, "tools", "mcp", "azure-sdk-python-mcp"),
        // "https://pkgs.dev.azure.com/azure-sdk/public/_packaging/azure-sdk-for-python/pypi/simple/",
        // "run",
        // "main.py",
      ]);
      return [mcpServerDefinition];
    },
  });
  return mcp;
}

interface PythonSdkAdapterToolParameters {
  tspConfigPath: string;
  pythonSdkRepoRoot: string;
}

export class PythonSdkAdapterTool extends ToolBase<PythonSdkAdapterToolParameters, string> {
  static TOOL_NAME = LmToolName.python_sdk_adapter;
  static async register() {
    return lm.registerTool(this.TOOL_NAME, new PythonSdkAdapterTool());
  }

  getPrepareMessage(input: PythonSdkAdapterToolParameters): ToolPrepareMessage {
    return {
      invocationMessage: `Checking specific instructions for Azure Python SDK`,
      confirmTitle: undefined,
      confirmMessage: undefined,
    };
  }

  async doWork(
    options: LanguageModelToolInvocationOptions<PythonSdkAdapterToolParameters>,
    token: CancellationToken,
  ): Promise<string | undefined> {
    // TODO: shall we register the python mcp here?
    const instruction = await tryReadFileOrUrl(
      "https://raw.githubusercontent.com/Azure/azure-sdk-for-python/refs/heads/main/.github/copilot-instructions.md",
    );
    if (!instruction || !instruction.content) {
      return "Not supported! No instruction found for Python SDK generation.";
    }

    let step = 1;
    const plan = `

# CRITICAL ENFORCEMENT RULES

## MANDATORY TOOL USAGE
- When instructions say "MUST call agent tool #toolname" or "ACTION: Run [toolname] mcp tool", this is MANDATORY, not optional
- NEVER substitute manual commands for required MCP tools
- If an MCP tool is mentioned by name in the workflow steps, it MUST be used
- Before running ANY manual command, check if there's a corresponding MCP tool that should be used instead

## VERIFICATION CHECKPOINT
Before executing any action, ask yourself:
1. Does the instruction explicitly mention an MCP tool for this step?
2. If yes, am I using that exact tool?
3. If the tool is not available, have I refreshed and double-checked the available tools? Have I asked the user about it?

## FAILURE PROTOCOL
If you catch yourself about to run a manual command when an MCP tool was specified:
- STOP immediately
- State: "The instructions require using [specific MCP tool] for this step"
- Use the correct tool or ask user if it's unavailable

## STEP NUMBERING
- Make sure to adjust the step numbering if the instructions restart step numbering from 1. i.e. if the instructions say "1. Do something", you should continue from the last step number you have showned to the user, not start from 1 again.
    
# Following is the detail instruction to generate Azure Python SDK

${step++}. Verify whether npm package '@azure-tools/typespec-client-generator-cli' is installed globally. If not, install it globally.
${step++}. Generate the SDK by following the detail Python SDK generation instructions below with the tspconfig file at '${options.input.tspConfigPath}' and the current working directory at '${options.input.pythonSdkRepoRoot}':
----- start of detail instructions -----
${instruction.content}
----- end of detail instructions -----
`;
    return plan;
  }
}
