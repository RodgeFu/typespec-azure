import { CancellationToken, LanguageModelToolInvocationOptions, lm } from "vscode";
import logger from "../../logger/logger.js";
import { LmToolName } from "../types.js";
import { AzureSdkPythonMcpId } from "./python-sdk-adapter.js";
import { ToolBase, ToolPrepareMessage } from "./tool-base.js";

interface SdkInfo {
  url: string;
  name: string;
  // instructionType: "url" | "text" | "file" | "mcp";
  // instruction: string;
  // // preRequisites needed before going to the instruction
  preRequisites: string[];
  mcpId?: string; // Optional MCP ID if needed
}

interface SdkGenerationContext {
  language: string;
  tspConfigPath: string;
  sdkInfo: SdkInfo;
}

interface SdkGenerationPlannerToolParameters {
  language: "python" | "java";
  tspConfigPath: string;
}

function getSdkGenerationContext(input: SdkGenerationPlannerToolParameters): SdkGenerationContext {
  const infoMap: Record<string, SdkInfo> = {
    python: {
      url: "https://github.com/Azure/azure-sdk-for-python.git",
      name: "azure-sdk-for-python",
      // instructionType: "url",
      // instruction:
      //   "https://github.com/Azure/azure-sdk-for-python/blob/main/.github/copilot-instructions.md",
      preRequisites: [
        "Verify whether uv (https://docs.astral.sh/uv/) is installed properly. If not, work with user to install it.",
      ],
      mcpId: AzureSdkPythonMcpId,
    },
  };
  const info = infoMap[input.language.toLowerCase()];
  if (!info) {
    throw new Error(`Unsupported language: ${input.language}`);
  }
  return {
    language: input.language,
    tspConfigPath: input.tspConfigPath,
    sdkInfo: info,
  };
}

export class SdkGenerationPlannerTool extends ToolBase<SdkGenerationPlannerToolParameters, string> {
  static TOOL_NAME = LmToolName.azure_sdk_generation_planner;
  static async register() {
    return lm.registerTool(this.TOOL_NAME, new SdkGenerationPlannerTool());
  }

  getPrepareMessage(input: SdkGenerationPlannerToolParameters): ToolPrepareMessage {
    return {
      invocationMessage: `Start generating Azure SDK for ${input.language}`,
      confirmTitle: "Please confirm the tspconfig.yml file used for generation",
      confirmMessage: input.tspConfigPath,
    };
  }

  async doWork(
    options: LanguageModelToolInvocationOptions<SdkGenerationPlannerToolParameters>,
    token: CancellationToken,
  ): Promise<string | undefined> {
    const content = getSdkGenerationContext(options.input);

    let step = 1;
    let plan = `
You are an expert in Typespec language and will be tasked to generating Azure SDK from typespec project. Follow the steps in Workflow section below strictly to do the generation.

# Instructions

- Current OS is ${process.platform}, so use the appropriate commands for the OS.

- If you are not sure about file content or codebase structure pertaining to the user's request, use your tools to read files and gather the relevant information: do NOT guess or make up an answer.

- Your thinking should be thorough and so it's fine if it's very long. You can think step by step before and after each action you decide to take.

- MAKE SURE to use agent tool exactly if it's required by the steps explicitly. Ask user if the agent tool required is not available

- MAKE SURE to always use full absolute path for the files and folders in command.

- MAKE SURE '\\' is used properly when calling command in windows.

- Follow the steps in the Workflow below step-by-step strictly. And MAKE SURE NOT to do anything not mentioned in the workflow.

- You have the authority to go to next step as described in the Workflow section. DO NOT ask user to confirm to go to next step

# Workflow

`;

    if (content.sdkInfo.preRequisites.length > 0) {
      plan += `
## Step ${step++}: Install pre-requisites

${content.sdkInfo.preRequisites.map((item, index) => `${index}. ${item}`).join("\n")}

`;
    }

    if (content.sdkInfo.mcpId) {
      plan += `
## Step ${step++}: Prepare AI tools for SDK generation 

1. MUST call agent tool #${LmToolName.mcp_server_action} to start the MCP server '${content.sdkInfo.mcpId}' if it is not started yet.

`;
    }

    plan += `## Step ${step++}: Figure out the {local SDK repository root folder}

1. Ask user to provide the local root folder of SDK repository '${content.sdkInfo.name}'
2. If the user provides the folder, use it as the root folder of the SDK repository.
3. If the user does not provide the folder, work with user to git clone the repository '${content.sdkInfo.url}' to a local folder and use it as the root folder of the SDK repository.

## Step ${step++}: Compile the typespec code and fix any issues found

1. MUST call agent tool #${LmToolName.tsp_compile_and_fix} whicl will compile the typespec code and fix issues automatically.

`;

    plan += `
## Step ${step++}: Generate the SDK by following the detail instruction

1. MUST call agent tool #${LmToolName.python_sdk_adapter} to generate the SDK by following the detail instructions from the tool. The 'pythonSdkRepoRoot' is the local SDK repositry root folder figured out in the step 1 above.
`;

    logger.debug(`Generated plan for SDK generation: \n${plan}`);
    return plan;
  }
}
