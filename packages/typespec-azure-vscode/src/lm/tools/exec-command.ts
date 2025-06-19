import { CancellationToken, LanguageModelToolInvocationOptions, lm } from "vscode";
import { ExecResult, spawnProcessAndLogOutput } from "../../util.js";
import { LmToolName } from "../types.js";
import { ToolBase, ToolPrepareMessage, ToolResultBase } from "./tool-base.js";

export interface ExecCommandToolParameters {
  invocationMessage: string;
  confirmTitle: string | undefined;
  confirmMessage: string | undefined;
  cmd: string;
  args: string[];
  cwd: string;
}

export interface ExecCommandToolResult extends ToolResultBase {
  result: ExecResult;
}

// the agent can't wait for terminal result properly sometimes, so we use this tool to run the command in the background and wait for it to finish
// and return the result to the agent. This is a workaround for the agent to be able to run the command in the background and wait for it to finish.
export class ExecCommandTool extends ToolBase<ExecCommandToolParameters, ExecCommandToolResult> {
  static TOOL_NAME = LmToolName.exec_command;
  static internalInvoke(
    options: LanguageModelToolInvocationOptions<ExecCommandToolParameters>,
    token: CancellationToken,
  ): Promise<ExecCommandToolParameters | undefined> {
    return this.invokeAndParseResult(this.TOOL_NAME, options, token);
  }

  static async register() {
    return lm.registerTool(this.TOOL_NAME, new ExecCommandTool());
  }

  getPrepareMessage(input: ExecCommandToolParameters): ToolPrepareMessage {
    return {
      invocationMessage: input.invocationMessage ?? `Executing command: \`${input.cmd}\``,
      confirmTitle: input.confirmTitle,
      confirmMessage:
        input.confirmMessage ??
        `Do you want to execute command: \`${input.cmd} ${input.args.join(
          " ",
        )} \` in \`${input.cwd}\``,
    };
  }

  async doWork(
    options: LanguageModelToolInvocationOptions<ExecCommandToolParameters>,
    token: CancellationToken,
  ): Promise<ExecCommandToolResult | undefined> {
    const { input } = options;
    if (token.isCancellationRequested) {
      return undefined;
    }

    try {
      const result = await spawnProcessAndLogOutput(input.cmd, input.args, input.cwd);

      return {
        result,
        code: result.exitCode === 0 ? "success" : "fail",
        message: `Command executed with exit code ${result.exitCode}`,
      };
    } catch (error) {
      const execResult = error as ExecResult;
      return {
        result: execResult,
        code: "fail",
        message: `Error occurred while executing the command`,
      };
    }
  }
}
