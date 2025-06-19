import { dirname, join } from "path";
import {
  CancellationToken,
  LanguageModelChatMessage,
  LanguageModelToolInvocationOptions,
  lm,
} from "vscode";
import { z } from "zod";
import logger from "../../logger/logger.js";
import {
  getCodeSnippetFromFile,
  isFileExist,
  Retry,
  spawnProcessAndLogOutput,
  wrapBackticks,
} from "../../util.js";
import { fixCodeWithLanguageModel } from "../ml-fix-code.js";
import {
  askLanguageModel,
  getAllTspCode,
  getTspKnowledgeFromRag,
  handleLanguageModelResponseWithJsonArray,
  RagDocKind,
} from "../ml-utils.js";
import { LmToolName } from "../types.js";
import { ReportProgressTool } from "./report-progress.js";
import { ToolBase, ToolPrepareMessage, ToolResultBase } from "./tool-base.js";

const CompileIssueSchema = z
  .object({
    level: z.enum(["error", "warning"]).describe("The level of the issue"),
    description: z.string().describe("The detail description of the issue"),
    file: z.string().optional().describe("The absolute path of the file containing the issue"),
    line: z
      .string()
      .optional()
      .describe("The line number of the code in the file related to the issue"),
    pos: z.string().optional().describe("The position in the line related to the issue"),
  })
  .describe("The schema of the issue found in code");
type CompileIssue = z.infer<typeof CompileIssueSchema>;

export interface TspCompileAndFixToolParameters {
  tspConfigPath: string;
}

export interface TspCompileAndFixToolResult extends ToolResultBase {}

export class TspCompileAndFixTool extends ToolBase<
  TspCompileAndFixToolParameters,
  TspCompileAndFixToolResult
> {
  static TOOL_NAME = LmToolName.tsp_compile_and_fix;
  static internalInvoke(
    options: LanguageModelToolInvocationOptions<TspCompileAndFixToolParameters>,
    token: CancellationToken,
  ): Promise<TspCompileAndFixToolResult | undefined> {
    return this.invokeAndParseResult(LmToolName.tsp_compile_and_fix, options, token);
  }

  static async register() {
    return lm.registerTool(this.TOOL_NAME, new TspCompileAndFixTool());
  }

  getPrepareMessage(input: TspCompileAndFixToolParameters): ToolPrepareMessage {
    return {
      invocationMessage: `Compile typespec code and try to fix found issues automatically`,
      confirmTitle: undefined,
      confirmMessage: undefined,
    };
  }

  async doWork(
    options: LanguageModelToolInvocationOptions<TspCompileAndFixToolParameters>,
    token: CancellationToken,
  ): Promise<TspCompileAndFixToolResult | undefined> {
    const { input } = options;
    if (token.isCancellationRequested) {
      return undefined;
    }
    const folder = dirname(input.tspConfigPath);
    const clientFile = join(folder, "client.tsp");
    const mainFile = join(folder, "main.tsp");
    let entrypointFile = "";
    if (await isFileExist(clientFile)) {
      entrypointFile = clientFile;
    } else if (await isFileExist(mainFile)) {
      entrypointFile = mainFile;
    } else {
      logger.error(
        `No entrypoint file found in the folder ${folder}. Expected to find 'client.tsp' or 'main.tsp' file.`,
      );
      return {
        code: "call-me-to-retry-after-fixing-issues",
        message: `No entrypoint file found in the folder ${folder}. Expected to find 'client.tsp' or 'main.tsp' file. Please work with user to figure out the correct tspconfig.yaml file and try again.`,
      };
    }

    // TODO: add confirmation to user if we tried many times
    const iterationSummaries: string[] = [];
    for (let i = 1; ; i++) {
      try {
        const result = await spawnProcessAndLogOutput(
          "npx",
          ["tsp", "compile", entrypointFile, "--pretty", "false"],
          folder,
        );
        if (result.exitCode === 0) {
          // only exit when we fix everything
          await ReportProgressTool.internalInvoke(
            {
              input: {
                progressTitle: `Compiling typespec succeeded (iteration ${i})`,
                progressMessage: `Typespec compiled successfully after ${i} iterations. In summary:
${iterationSummaries.map((s) => `# Iteratoin ${i}\n- ${s}`).join("\n\n")}`,
              },
              toolInvocationToken: options.toolInvocationToken,
            },
            token,
          );
          return {
            code: "success",
            message: `Typespec compiled successfully after ${i} iterations.`,
          };
        } else {
          const issues = (
            await Retry(
              async () => {
                const r = await this.resolveCompileOutput(result.stdout, token);
                if (r.length === 0) {
                  throw new Error("No issues found in the output, try to analyze it again");
                }
                return r;
              },
              3,
              200,
            )
          )
            // we only care about error now
            .filter((issue) => issue.level === "error");

          await ReportProgressTool.internalInvoke(
            {
              input: {
                progressTitle: `${issues.length} issues found (iteration ${i})`,
                progressMessage: issues
                  .map((is) => `### ${is.file}:${(is.line, is.pos)}\n- ${is.description}`)
                  .join("\n\n"),
              },
              toolInvocationToken: options.toolInvocationToken,
            },
            token,
          );

          const docs: Set<string> = new Set();
          for (const issue of issues) {
            let relatedCode = "";
            if (issue.file && issue.line !== undefined) {
              const lineNumber =
                typeof issue.line === "string"
                  ? parseInt(issue.line)
                  : typeof issue.line === "number"
                    ? issue.line
                    : -1;
              relatedCode =
                lineNumber >= 0 ? await getCodeSnippetFromFile(issue.file, lineNumber, 2) : "";
            }
            const founds = await getTspKnowledgeFromRag(
              `${issue.description}\n\n${relatedCode}`,
              RagDocKind.General | RagDocKind.Azure,
            );
            founds.forEach((f) => {
              docs.add(f.chunk);
            });
          }

          const edits = await fixCodeWithLanguageModel(
            await getAllTspCode(folder),
            `Review and fix ALL the diagnostics found below carefully. Take your time if needed:`,
            issues,
            options.toolInvocationToken,
            token,
            Array.from(docs).join("\n\n"),
          );
          const iterationSummary =
            edits.length > 0
              ? edits
                  .map(
                    (e) => `## fix file ${e.filePath}\n- ${e.explanation ?? "no detail available"}`,
                  )
                  .join("\n\n")
              : "No fixes recommended by AI";
          iterationSummaries.push(iterationSummary);
          const r = await ReportProgressTool.internalInvoke(
            {
              input: {
                progressTitle: `Compiling typespec and fixing ${issues.length} issues (iteration ${i})`,
                progressMessage: iterationSummary,
                confirmTitle: `Please ACCEPT or UNDO the fixes and continue.`,
                confirmMessage: wrapBackticks(iterationSummary, "markdown", 4),
              },
              toolInvocationToken: options.toolInvocationToken,
            },
            token,
          );
        }
      } catch (error) {
        logger.error(`Unexpected error when trying to compile typespec: ${error}`);
        return {
          code: "fail",
          message: `Unexpected error when trying to compile typespec: ${error}`,
        };
      }
    }
  }

  private async resolveCompileOutput(
    output: string,
    token: CancellationToken,
  ): Promise<CompileIssue[]> {
    const message = [
      LanguageModelChatMessage.Assistant(
        `You are a Typespec export and you are asked to analyze the output of Typespec compiler.
- DO NOT include triple backticks in your response.
- The file path is absolute path in ${process.platform} system. If the file is prefixed with '../' or '..\\', remove the prefix
- Distince the array to avoid return duplicated issues`,
      ),
      LanguageModelChatMessage.User(`Please analyze the given output and summarize the issues (error or warning) as following json object array:
[{"level": 'error or warning', description: 'detail description of the error or warning', file: 'the path of the file containing the issue if available', line: 'the line of the code in the file related to the issue if available', pos: 'the position in the line related to the issue if available'}]
Please analyze the following output:
--------------
${output}`),
    ];

    const response = await askLanguageModel(message, token);
    const result: CompileIssue[] = [];
    const { allResponse } = await handleLanguageModelResponseWithJsonArray<CompileIssue>(
      response,
      (json) => {
        // output found issues to user
        result.push(json);
      },
    );
    if (result.length === 0) {
      logger.debug(
        `No issue analyzed from the output: \n${output} \n-----\nAI response: \n${allResponse}`,
      );
    }
    return result;
  }
}
