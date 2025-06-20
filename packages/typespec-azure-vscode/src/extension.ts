// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { ExecCommandTool } from "./lm/tools/exec-command.js";
import { McpServerActionTool } from "./lm/tools/mcp-server-action.js";
import { PythonSdkAdapterTool, registerAzureSdkPythonMcp } from "./lm/tools/python-sdk-adapter.js";
import { ReportProgressTool } from "./lm/tools/report-progress.js";
import { SdkGenerationPlannerTool } from "./lm/tools/sdk-generation-planner.js";
import { TspCompileAndFixTool } from "./lm/tools/tsp-compile-and-fix.js";
import { ExtensionLogListener } from "./logger/extension-log-listener.js";
import logger from "./logger/logger.js";
import { TypeSpecLogOutputChannel } from "./logger/typespec-log-output-channel.js";

export const outputChannel = new TypeSpecLogOutputChannel("TypeSpec Azure");
logger.registerLogListener("extension-log", new ExtensionLogListener(outputChannel));

export async function activate(context: vscode.ExtensionContext) {
  logger.info("TypeSpec Azure extension is activating...");

  context.subscriptions.push(await registerAzureSdkPythonMcp());

  const helloWorldCommand = vscode.commands.registerCommand(
    "typespec-azure.helloWorld",
    async () => {
      vscode.window.showInformationMessage("Hello World from TypeSpec Azure!");
      //await startExMcpServer(AzureSdkPythonMcpId);
    },
  );
  context.subscriptions.push(helloWorldCommand);

  context.subscriptions.push(await SdkGenerationPlannerTool.register());
  context.subscriptions.push(await ExecCommandTool.register());
  context.subscriptions.push(await ReportProgressTool.register());
  context.subscriptions.push(await TspCompileAndFixTool.register());
  context.subscriptions.push(await PythonSdkAdapterTool.register());
  context.subscriptions.push(await McpServerActionTool.register());

  logger.info("TypeSpec Azure extension activated successfully.");
}

// This method is called when your extension is deactivated
export function deactivate() {}
