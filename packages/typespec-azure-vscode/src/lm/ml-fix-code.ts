import { inspect } from 'util';
import {
  CancellationToken,
  ChatParticipantToolToken,
  LanguageModelChatMessage,
  LanguageModelToolInvocationOptions,
  lm,
} from 'vscode';
import { zodToJsonSchema } from 'zod-to-json-schema';
import logger from '../logger/logger.js';
import { tryReadFile } from '../util.js';
import { handleLanguageModelResponseWithJsonArray } from './ml-utils.js';
import {
  CodeFileChange,
  CodeFileChangeSchema,
  CodeFileInfo,
  CodeFileWithEdit,
  CodeFileWithEditSchema,
} from './types.js';

export async function mergeAllTspCode(allCodeFileInfo: CodeFileInfo[]) {
  const codes: string[] = [];
  for (const codeInfo of allCodeFileInfo) {
    const content = codeInfo.code.split('\n').map((v, i) => `${i}: ${v}`);
    const addStartEnd =
      `// START OF FILE: ${codeInfo.filePath} \n ` +
      `${content.join('\n')}\n` +
      `// END OF FILE: ${codeInfo.filePath} `;
    codes.push(addStartEnd);
  }

  return codes.join('\n');
}

export async function fixCodeWithLanguageModel<T>(
  codeFiles: CodeFileInfo[],
  userRequirementBrief: string,
  userRequirementsArray: T[],
  toolInvocationToken: ChatParticipantToolToken | undefined,
  token: CancellationToken,
  allExtraKnowledge: string,
  startMessage: string = 'You are an expert in Typespec and you are asked to update typespec(.tsp) code according to the given requirement. Review the code and the instruction carefully and MAKE SURE to update the code for ALL OF them carefully. Double check the code and make sure it is correct. **MAKE SURE ONLY do change that is necessary to fix the code for the give requirement, MUST NOT add any new code or change the code that is not related to the requirement**.'
): Promise<(CodeFileWithEdit | CodeFileChange)[]> {
  const allCode = await mergeAllTspCode(codeFiles);

  const startMsg = LanguageModelChatMessage.Assistant(startMessage);
  const responseFormatMsg_allCode = LanguageModelChatMessage.Assistant(
    `Response with the code change needed in an array of json object with the schema below. The json object array SHOULD be the only thing in your response. DON'T wrap your response in triple backticks. DOUBLE CONFIRM the returned reponse follows the schema below STRICTLY especially the required fields are all set properly. DOUBLE CONFIRM carefully that the 'code' field MUST CONTAIN all the code after change. Code changes in one file should be grouped together in one json object with the filePath and explanation
---- Start of the json object schema ----
${JSON.stringify(zodToJsonSchema(CodeFileChangeSchema))}
---- End of the json object schema ----`
  );
  const responseFormatMsg_diffCode = LanguageModelChatMessage.Assistant(
    `Response with the code change needed in an array of json object with the schema below. The json object array SHOULD be the only thing in your response. DON'T wrap your response in triple backticks. DOUBLE CONFIRM the returned reponse follows the schema below STRICTLY especially the required fields are all set properly. DOUBLE CONFIRM carefully that the 'search' field MUST EXACTLY matches the original code you want to change. Code changes in one file should be grouped together in one json object with the filePath and explanation
---- Start of the json object schema ----
${JSON.stringify(zodToJsonSchema(CodeFileWithEditSchema))}
---- End of the json object schema ----`
  );
  const extraKnowledgeMsg = LanguageModelChatMessage.Assistant(
    `### Following is some preference when fixing the code:
- If a decorator is not recognized, try to use its full qualified name including namespace to see whether it fixes the issue before trying other fixes.
- If a variable, operation, model or other entity are named as a reserved keyword that needs escape, MAKE SURE all the occurrences of the entity are escaped properly.
- When fixing regular expression, DOUBLE CHECK whether '\\\\' should be fixed to '\\' or '\\\\\\\\' in the code depends on the context.
###Following is more related knowledge:\n${allExtraKnowledge}`
  );
  const allTspCode = LanguageModelChatMessage.User(
    `Following is all the code and config files you need to review and update according to the requirement with the extra knowledge provided:
${allCode}`
  );
  const userMsg = LanguageModelChatMessage.User(
    `Followings are user's requirements. MAKE SURE to update code according to these requirement. DOUBLE CONFIRM all the changes you made to MAKE SURE they are related to at least one of the given requirement. **MUST NOT do any change can't be related to any requirements which means it's not necessary**.\n${userRequirementBrief}\n---- Start of user requirements array ----\n${JSON.stringify(userRequirementsArray)}\n---- End of user requirements array ----`
  );

  // const allModel = await lm.selectChatModels();
  // logger.debug(`All available models: \n${inspect(allModel)}`);

  const [model] = await lm.selectChatModels({
    family: 'claude-sonnet-4',
    //family: 'claude-3.5-sonnet',
    vendor: 'copilot',
    //family: 'gpt-4o',
    //vendor: 'copilot',
  });

  let leftRetry = 4;
  const useAllCodeEdit = false;
  while (leftRetry > 0) {
    const requireAgainMsg = LanguageModelChatMessage.User(
      `*IMPORTANT* The code edits you provided are not valid last time. MAKE SURE to double review the code edits carefully and provide valid code edits according to the schema above. `
    );
    logger.debug(
      `AI Code Edit in ${useAllCodeEdit ? 'all code' : 'diff code'} mode, left retry: ${leftRetry}`
    );
    const messages = [
      startMsg,
      useAllCodeEdit ? responseFormatMsg_allCode : responseFormatMsg_diffCode,
      extraKnowledgeMsg,
      allTspCode,
      userMsg,
    ];
    if (leftRetry < 3) {
      messages.push(requireAgainMsg);
    }
    try {
      const response = await model.sendRequest(messages, {}, token);
      const arr: (CodeFileWithEdit | CodeFileChange)[] = [];
      const { jsonArray, allResponse } = await handleLanguageModelResponseWithJsonArray<
        CodeFileChange | CodeFileWithEdit
      >(response, async (json) => {
        if (useAllCodeEdit) {
          if (!('code' in json) || json.code === undefined) {
            logger.warning(`Invalid code change from AI: code is undefined`);
            return;
          } else {
            const r = await AdjustCodeFileChangeFromAi(json);
            if (r) {
              arr.push(r);
              await sendCodeFileEditToLanguageModel(r, toolInvocationToken, token);
            }
          }
        } else {
          if (
            !('codeEdits' in json) ||
            json.codeEdits === undefined ||
            json.codeEdits.length === 0
          ) {
            return;
          } else {
            const r = await AdjustCodeFileWithEditFromAi(json);
            if (r) {
              arr.push(r);
              await sendCodeFileEditToLanguageModel(r, toolInvocationToken, token);
            }
          }
        }
      });
      logger.debug(`AI response: ${allResponse}`);
      if (arr.length === 0) {
        logger.warning(
          `No valid code edits found from AI response. Will retry with AI. Ai's response: ${inspect(arr)}`
        );
        leftRetry--;
      } else {
        logger.info(`Got ${arr.length} code edits from AI.`);
        return arr;
      }
    } catch (error) {
      logger.error(`Error when sending request to AI: ${inspect(error)}`);
      if (error === 'Canceled') {
        break;
      }
      // double check the respones too long error
      logger.warning('Switch to use diff code and retry');
      //useAllCodeEdit = true;
      leftRetry--;
    }
  }
  return [];
}

async function AdjustCodeFileChangeFromAi(
  change: CodeFileChange
): Promise<CodeFileChange | undefined> {
  const result = CodeFileChangeSchema.safeParse(change);
  if (!result.success) {
    logger.warning(`Invalid code change from AI: ${inspect(result.error)}`);
    return undefined;
  }
  if (change.code === undefined) {
    logger.warning(`Invalid code change from AI: code is undefined or empty`);
    return undefined;
  }
  return change;
}

async function AdjustCodeFileWithEditFromAi(
  edit: CodeFileWithEdit
): Promise<CodeFileWithEdit | CodeFileChange | undefined> {
  const cfe: CodeFileWithEdit = {
    filePath: edit.filePath,
    explanation: edit.explanation,
    codeEdits: [],
  };
  const result = CodeFileWithEditSchema.safeParse(edit);
  if (!result.success) {
    logger.warning(`Invalid code edit from AI: ${inspect(result.error)}`);
    return undefined;
  }
  const content = await tryReadFile(edit.filePath);
  if (content === undefined) {
    logger.warning(`can't read file ${edit.filePath}, should be a new file created by AI`);
    return edit;
  }
  for (const codeEdit of edit.codeEdits) {
    if (!codeEdit.search) {
      logger.warning(`Invalid code edit from AI: search code is undefined`);
      continue;
    }
    cfe.codeEdits.push({
      description: codeEdit.description,
      search: codeEdit.search,
      replace: codeEdit.replace,
      requirementIndex: codeEdit.requirementIndex,
    });
  }
  let newCode = content;
  let cannotApply = false;
  // let's try to apply directly if possible
  for (let i = 0; i < cfe.codeEdits.length; i++) {
    const ce = cfe.codeEdits[i];
    if (ce.requirementIndex === undefined || ce.requirementIndex < 0) {
      logger.warning(`Invalid code edit from AI: requirementIndex is undefined or negative`);
    }
    if (newCode.indexOf(ce.search) === -1) {
      cannotApply = true;
      break;
    }
    newCode = newCode.replace(ce.search, `@@@@@@${i}@@@@@@`);
  }
  if (!cannotApply) {
    for (let i = 0; i < cfe.codeEdits.length; i++) {
      const ce = cfe.codeEdits[i];
      newCode = newCode.replace(`@@@@@@${i}@@@@@@`, ce.replace);
    }
    logger.debug(`Convert code edit to full code change for file ${cfe.filePath}`);
    return {
      filePath: cfe.filePath,
      explanation: cfe.explanation ?? 'No explanation provided',
      code: newCode,
    };
  } else {
    logger.debug(
      `Keep diff based code edit for file ${cfe.filePath} as it cannot be applied directly`
    );
    if (cfe.codeEdits.length === 0) {
      logger.error(`Invalid code edit from AI: no valid code edits found ${inspect(edit)}`);
      return undefined;
    }
    return cfe;
  }
}

export async function sendCodeFileEditToLanguageModel(
  edits: CodeFileChange | CodeFileWithEdit,
  invocationToken: ChatParticipantToolToken | undefined,
  token: CancellationToken
) {
  const EDIT_FILE_TOOL = 'copilot_insertEdit';
  let option: LanguageModelToolInvocationOptions<any>;
  if ('code' in edits) {
    // full code change
    option = {
      input: {
        explanation: `the code is the exact full code to replace all the original code in the file. Just replace the code in the file with the code provided, ** IMPORTANT: DO NOT add, delete, update any code on the given code which may cause unexpected result. JUST replace all the code in the file with the given code**.`,
        filePath: edits.filePath,
        code: edits.code,
      },
      toolInvocationToken: invocationToken,
    };
  } else {
    // diff code change
    const codeChanges = edits.codeEdits.map((v) => {
      return {
        searchCode: v.search,
        replaceCode: v.replace,
      };
    });
    option = {
      input: {
        explanation: `code property is the code changes in an array of search/replace objects, search code is the original code to search for, replaceCode is the code to replace it with.`,
        filePath: edits.filePath,
        code: JSON.stringify(codeChanges),
      },
      toolInvocationToken: invocationToken,
    };
  }
  await lm.invokeTool(EDIT_FILE_TOOL, option, token);
}
