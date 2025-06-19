import { CancellationToken, LanguageModelToolInvocationOptions, lm } from "vscode";
import { LmToolName } from "../types.js";
import { ToolBase, ToolPrepareMessage } from "./tool-base.js";

export interface ReportProgressToolParameters {
  progressTitle: string;
  progressMessage: string;
  confirmTitle?: string;
  confirmMessage?: string;
}

export class ReportProgressTool extends ToolBase<ReportProgressToolParameters, string> {
  static TOOL_NAME = LmToolName.report_progress;
  static async internalInvoke(
    options: LanguageModelToolInvocationOptions<ReportProgressToolParameters>,
    token: CancellationToken,
  ): Promise<string | undefined> {
    return this.invokeAndParseResult(this.TOOL_NAME, options, token);
  }

  static async register() {
    return lm.registerTool(this.TOOL_NAME, new ReportProgressTool());
  }

  getPrepareMessage(input: ReportProgressToolParameters): ToolPrepareMessage {
    return {
      invocationMessage: input.progressTitle,
      confirmTitle: input.confirmTitle,
      confirmMessage: input.confirmMessage,
    };
  }

  async doWork(
    options: LanguageModelToolInvocationOptions<ReportProgressToolParameters>,
    token: CancellationToken,
  ): Promise<string | undefined> {
    if (token.isCancellationRequested) {
      return undefined;
    }
    return options.input.progressMessage;
  }
}
