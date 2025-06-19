import {
  CancellationToken,
  LanguageModelChatMessage,
  LanguageModelChatResponse,
  lm,
  ProgressLocation,
  window,
} from "vscode";
import logger from "../logger/logger.js";
import { listFilesInFolder, tryReadFile, tryRepairAndParseJson } from "../util.js";
import { CodeFileInfo } from "./types.js";

export async function askLanguageModel(
  messages: LanguageModelChatMessage[],
  token: CancellationToken,
): Promise<LanguageModelChatResponse> {
  const [model] = await lm.selectChatModels({
    family: "gpt-4o",
    vendor: "copilot",
  });

  return model.sendRequest(messages, {}, token);
}

export async function handleLanguageModelResponseWithJsonArray<T>(
  response: LanguageModelChatResponse,
  handler: (json: T) => void,
) {
  let allResponse = "";
  const jsonArray: T[] = [];

  await window.withProgress(
    {
      location: ProgressLocation.Window,
      title: "Processing AI response for code fixing",
      cancellable: false,
    },
    async (progress) => {
      let nextReportSize = 0;
      for await (const fragment of response.text) {
        allResponse += fragment;
        if (allResponse.length > nextReportSize) {
          // UI is slow, we dont want to report too often
          nextReportSize += 100;
          progress.report({
            message: `${allResponse.length} char got...`,
          });
        }
      }
    },
  );

  // it's expected to be a json array, so [{}...{}]
  // in case AI put some other text before or after the json array, we need to extract the json array part
  const start = allResponse.indexOf("[");
  const end = allResponse.lastIndexOf("]");
  if (start < 0 || end < 0) {
    logger.error(`Invalid response format, expected a JSON array but got: ${allResponse}`);
    return { jsonArray, allResponse };
  } else {
    const jsonPart = allResponse.substring(start, end + 1);
    const allJsonReply = tryRepairAndParseJson(jsonPart);
    if (!Array.isArray(allJsonReply)) {
      logger.error(`Invalid response format, expected a JSON array but got: ${jsonPart}`);
      return { jsonArray, allResponse };
    } else {
      for (const json of allJsonReply) {
        jsonArray.push(json as T);
        await handler(json as T);
      }
    }
    return { jsonArray, allResponse };
  }
}

export async function handleLanguageModelResponseWithJsonArray_backup<T>(
  response: LanguageModelChatResponse,
  handler: (json: T) => void,
) {
  let allResponse = "";
  let curStepJson = "";
  const bracketTracker = [];
  const jsonArray: T[] = [];
  for await (const fragment of response.text) {
    for (const ch of fragment) {
      allResponse += ch;
      if (ch === "{") {
        bracketTracker.push("{");
      }
      if (bracketTracker.length > 0) {
        curStepJson += ch;
      }
      if (ch === "}") {
        bracketTracker.pop();
        if (bracketTracker.length === 0) {
          const json = tryRepairAndParseJson(curStepJson);
          curStepJson = "";
          if (json) {
            jsonArray.push(json as T);
            await handler(json as T);
          }
        }
      }
    }
  }
  return { jsonArray, allResponse };
}

export interface RagDoc {
  chunk: string;
  score: number;
}

export enum RagDocKind {
  General = 0x01,
  Azure = 0x02,
}

export async function getTspKnowledgeFromRag(text: string, include: RagDocKind): Promise<RagDoc[]> {
  // TODO: integrate with RAG
  return [];

  // const url = pkgJson.searchUrl;
  // const indexName = pkgJson.searchIndex;
  // const key = pkgJson.searchKey;
  // const top = 3;
  // // query ai search
  // const searchClient = new SearchClient(url, indexName, new AzureKeyCredential(key));
  // // type SearchResultModel = {
  // //   chunk: string;
  // //   title: string;
  // //   header_1: string;
  // //   header_2: string;
  // //   header_3: string;
  // // } & string;
  // try {
  //   logger.info(`searching for: \n${text}`);
  //   const found: RagDoc[] = [];
  //   const generalDocsPromise =
  //     include & RagDocKind.General
  //       ? searchClient.search(text, {
  //           select: ["chunk", "title", "header_1", "header_2", "header_3"],
  //           top,
  //           filter: "context_id eq 'typespec_docs'",
  //         })
  //       : undefined;
  //   const azureDocsPromise =
  //     include & RagDocKind.Azure
  //       ? searchClient.search(text, {
  //           select: ["chunk", "title", "header_1", "header_2", "header_3"],
  //           top,
  //           filter: "context_id eq 'typespec_azure_docs'",
  //         })
  //       : undefined;

  //   const [generalSearchResult, azureSearchResult] = await Promise.all([
  //     generalDocsPromise,
  //     azureDocsPromise,
  //   ]);

  //   if (include & RagDocKind.General && generalSearchResult) {
  //     for await (const result of generalSearchResult.results) {
  //       const doc = result.document as any;
  //       found.push({ chunk: doc["chunk"], score: result.score ?? 0 });
  //     }
  //   }
  //   if (include & RagDocKind.Azure && azureSearchResult) {
  //     for await (const result of azureSearchResult.results) {
  //       const doc = result.document as any;
  //       found.push({ chunk: doc["chunk"], score: result.score ?? 0 });
  //     }
  //   }
  //   // add some extra known knowledge
  //   // TODO: make it extensible, so we can add more knowledge in the future
  //   // const builtInKownledge = knowledgeStore.getKnowledge(text);
  //   // found.push(...builtInKownledge);
  //   logger.info(`found ${found.length} related doc for: ${text}`);
  //   //logger.debug(`found related doc: ${JSON.stringify(found, null, 2)}`);
  //   return found;
  // } catch (e) {
  //   logger.error(`[Will be skip] Error searching for ${text}: ${e}`);
  //   return [];
  // }
}

export async function getAllTspCode(folder: string) {
  // just list all the tsp files for POC
  const files = await listFilesInFolder(
    folder,
    true,
    (file) => file.endsWith(".tsp") || file.endsWith("tspconfig.yaml"),
    (folder) => !folder.includes("node_modules"),
  );
  const allCodeInfos: CodeFileInfo[] = [];
  for (const file of files) {
    const content = await tryReadFile(file);
    if (content) {
      allCodeInfos.push({
        filePath: file,
        code: content,
      });
    }
  }
  return allCodeInfos;
}
