import { z } from "zod";

export enum LmToolName {
  azure_sdk_generation_planner = "azure-sdk-generation-planner",
  tsp_compile_and_fix = "tsp-compile-and-fix",
  exec_command = "tsp-exec-command",
  report_progress = "tsp-report-progress",
  python_sdk_generation = "python-sdk-generation",
}

export interface CodeFileInfo {
  filePath: string;
  code: string;
}

export const CodeFileChangeSchema = z.object({
  filePath: z.string().describe("The ABSOLUTE path of the file that has been changed"),
  code: z
    .string()
    .describe(
      "All the code of the filePath after change. Please always include all the changed code here, even if it is the same as the original code",
    ),
  explanation: z
    .string()
    .describe(
      "the explanation on how the code been changed and why. For any class name, method/function name, variable name, or code-related term in the explanation should be enclosed in backticks (`) to improve readability.",
    ),
});

export type CodeFileChange = z.infer<typeof CodeFileChangeSchema>;

export const CodeEditSchema = z
  .object({
    search: z
      .string()
      .describe(
        "A contiguous chunk of lines to search for in the given source code, include just the changing lines, and a few surrounding lines if needed for uniqueness, must *EXACTLY MATCH* the part of the given source code, character for character, line to line, including all comments, docstrings, whitespaces, tab characters, intent, line endings, newline, etc. You must always include the original code here if source code requires change. You should not leave this empty.",
      ),
    replace: z
      .string()
      .describe("The lines to replace into the source code including the surrounding lines"),
    description: z.string().describe("The brief description of the code edit"),
    requirementIndex: z
      .number()
      .describe(
        "The index of the requirement that this code edit is related to, starting from 0. If this code edit is not related to any requirement, set it to -1. DOUBLE CHECK whether this code edit is really needed if requirementIndex is -1 because it is likely that the code edit is not needed if it is not related to any requirement.",
      ),
  })
  .describe("The schema of the code edit");
export type CodeEdit = z.infer<typeof CodeEditSchema>;

export const CodeFileWithEditSchema = z
  .object({
    filePath: z.string().describe("The ABSOLUTE path of the file to be edited"),
    explanation: z.string().optional().describe("The explanation of the code edit"),
    codeEdits: z.array(CodeEditSchema).describe("The edits to be applied to the file"),
  })
  .describe(
    "The schema of the code edit in a file, which includes the file path, explanation, and the code edits to be applied to the file",
  );
export type CodeFileWithEdit = z.infer<typeof CodeFileWithEditSchema>;
