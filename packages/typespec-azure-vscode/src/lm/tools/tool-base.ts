import {
  CancellationToken,
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  lm,
  MarkdownString,
  PreparedToolInvocation,
  ProviderResult,
} from 'vscode';
import { tryRepairAndParseJson } from '../../util.js';

export interface ToolPrepareMessage {
  invocationMessage: string | MarkdownString;
  confirmTitle: string | undefined;
  confirmMessage: string | MarkdownString | undefined;
}

export interface ToolResultBase {
  code: 'success' | 'fail' | 'assist-needed' | 'cancelled' | 'call-me-to-retry-after-fixing-issues';
  message: string;
}

export abstract class ToolBase<T, P extends ToolResultBase | string>
  implements LanguageModelTool<T>
{
  abstract getPrepareMessage(input: T): ToolPrepareMessage;
  abstract doWork(
    options: LanguageModelToolInvocationOptions<T>,
    token: CancellationToken
  ): Promise<P | undefined>;

  protected static async invokeAndParseResult<P>(
    toolName: string,
    options: LanguageModelToolInvocationOptions<object>,
    token: CancellationToken
  ): Promise<P | undefined> {
    const result = await this.invokeAndReturnRaw(toolName, options, token);
    if (result === undefined) {
      return undefined;
    } else {
      const r = tryRepairAndParseJson(result) as P;
      if (r !== undefined) {
        return r;
      } else {
        // If the result is not a valid JSON, return it as a string
        return result as any;
      }
    }
  }

  private static async invokeAndReturnRaw(
    toolName: string,
    options: LanguageModelToolInvocationOptions<object>,
    token: CancellationToken
  ): Promise<string | undefined> {
    const result = await lm.invokeTool(toolName, options, token);
    if (!result || result.content.length === 0) {
      return undefined;
    }
    return result.content.map((c) => (c as LanguageModelTextPart).value).join('\n');
  }

  async invoke(options: LanguageModelToolInvocationOptions<T>, token: CancellationToken) {
    const result = await this.doWork(options, token);
    if (!result) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          JSON.stringify(
            {
              code: 'fail',
              message: `No result returned from the tool`,
            },
            undefined,
            2
          )
        ),
      ]);
    }
    if (typeof result === 'string') {
      return new LanguageModelToolResult([new LanguageModelTextPart(result)]);
    } else {
      return new LanguageModelToolResult([new LanguageModelTextPart(JSON.stringify(result))]);
    }
  }

  prepareInvocation(
    options: LanguageModelToolInvocationPrepareOptions<T>,
    token: CancellationToken
  ): ProviderResult<PreparedToolInvocation> {
    const messages = this.getPrepareMessage(options.input);
    const invocationMessage = messages.invocationMessage;
    if (messages.confirmTitle) {
      return {
        invocationMessage,
        confirmationMessages: {
          title: messages.confirmTitle,
          message: messages.confirmMessage ?? '',
        },
      };
    } else {
      return {
        invocationMessage,
      };
    }
  }
}
