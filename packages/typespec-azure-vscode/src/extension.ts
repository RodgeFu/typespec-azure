// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { ExecCommandTool } from "./lm/tools/exec-command.js";
import { PythonSdkGenerationTool } from "./lm/tools/python-sdk-generation-tool.js";
import { ReportProgressTool } from "./lm/tools/report-progress.js";
import { SdkGenerationPlannerTool } from "./lm/tools/sdk-generation-planner-tool.js";
import { TspCompileAndFixTool } from "./lm/tools/tsp-compile-and-fix.js";
import { ExtensionLogListener } from "./logger/extension-log-listener.js";
import logger from "./logger/logger.js";
import { TypeSpecLogOutputChannel } from "./logger/typespec-log-output-channel.js";

export const outputChannel = new TypeSpecLogOutputChannel("TypeSpec Azure");
logger.registerLogListener("extension-log", new ExtensionLogListener(outputChannel));

export async function activate(context: vscode.ExtensionContext) {
  const mcp = await vscode.lm.registerMcpServerDefinitionProvider("azure-sdk-python-mcp", {
    provideMcpServerDefinitions: async () => {
      //const localLocation = "c:/git/RodgeFu/azure-sdk-for-python";
      const mcpServerDefinition = new vscode.McpStdioServerDefinition(
        "azure sdk python mcp server",
        "uv",
        [
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
        ],
      );
      return [mcpServerDefinition];
    },
  });
  context.subscriptions.push(mcp);

  const helloWorldCommand = vscode.commands.registerCommand("typespec-azure.helloWorld", () => {
    vscode.window.showInformationMessage("Hello World from TypeSpec Azure!");
  });
  context.subscriptions.push(helloWorldCommand);

  context.subscriptions.push(await SdkGenerationPlannerTool.register());
  context.subscriptions.push(await ExecCommandTool.register());
  context.subscriptions.push(await ReportProgressTool.register());
  context.subscriptions.push(await TspCompileAndFixTool.register());
  context.subscriptions.push(await PythonSdkGenerationTool.register());
}

// This method is called when your extension is deactivated
export function deactivate() {}
