import { CancellationToken, LanguageModelToolInvocationOptions, lm } from "vscode";
import { tryReadFileOrUrl } from "../../util.js";
import { LmToolName } from "../types.js";
import { ToolBase, ToolPrepareMessage } from "./tool-base.js";

interface PythonSdkGenerationToolParameters {
  tspConfigPath: string;
  pythonSdkRepoRoot: string;
}

export class PythonSdkGenerationTool extends ToolBase<PythonSdkGenerationToolParameters, string> {
  static TOOL_NAME = LmToolName.python_sdk_generation;
  static async register() {
    return lm.registerTool(this.TOOL_NAME, new PythonSdkGenerationTool());
  }

  getPrepareMessage(input: PythonSdkGenerationToolParameters): ToolPrepareMessage {
    return {
      invocationMessage: `Start generating Azure Python SDK`,
      confirmTitle: undefined,
      confirmMessage: undefined,
    };
  }

  async doWork(
    options: LanguageModelToolInvocationOptions<PythonSdkGenerationToolParameters>,
    token: CancellationToken,
  ): Promise<string | undefined> {
    // TODO: shall we register the python mcp here?
    const instruction = await tryReadFileOrUrl(
      "https://raw.githubusercontent.com/Azure/azure-sdk-for-python/refs/heads/main/.github/copilot-instructions.md",
    );
    if (!instruction || !instruction.content) {
      return "Not supproted! No instruction found for Python SDK generation.";
    }
    const plan = `### Following is the detail plan to generate Azure Python SDK

1. Verify whether uv (https://docs.astral.sh/uv/) is installed properly. If not, work with user to install it.
2. Make sure 'tsp_client' command is installed on the machine. If not, install it by running 'npm i -g @azure-tools/typespec-client-generator-cli'.
3. Generate the SDK by following the detail Python SDK generation instructions below with the tspconfig file at '${options.input.tspConfigPath}' and the current working directory at '${options.input.pythonSdkRepoRoot}'.:
----- start of detail instructions -----
${instruction.content}
----- end of detail instructions -----
`;
    return plan;
  }
}
