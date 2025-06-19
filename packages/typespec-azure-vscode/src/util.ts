import { spawn } from "child_process";
import { readdir, readFile, stat, writeFile } from "fs/promises";
import { jsonrepair } from "jsonrepair";
import { join } from "path";
import vscode, { Uri } from "vscode";
import logger from "./logger/logger.js";
import { isUrl } from "./path-utils.js";

export async function tryRepairAndParseJsonFromFile<T>(filePath: string): Promise<T | undefined> {
  const str = await tryReadFile(filePath);
  if (!str) {
    return undefined;
  }
  return tryRepairAndParseJson<T>(str);
}

export function tryRepairAndParseJson<T>(jsonStr: string | undefined): T | undefined {
  if (!jsonStr) {
    return undefined;
  }
  let cleaned = jsonStr.trim();

  // Remove triple backticks at the start and end
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(\w*\n)?/, "");
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.replace(/```$/, "");
  }

  try {
    cleaned = jsonrepair(cleaned);
    const parsed = JSON.parse(cleaned);
    return parsed;
  } catch (e) {
    logger.error(`Error to repare and parsing JSON: ${e}`);
    return undefined;
  }
}

export async function isFolderExist(folderPath: string): Promise<boolean> {
  if (!folderPath) {
    return false;
  }
  try {
    const s = await stat(folderPath);
    return s.isDirectory();
  } catch (error) {
    return false;
  }
}

export async function isFileExist(filePath: string): Promise<boolean> {
  if (!filePath) {
    return false;
  }
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch (error) {
    return false;
  }
}

export function spawnProcessAndLogOutput(command: string, args: string[], cwd: string) {
  logger.info(`Executing command: ${command} ${args.join(" ")} in ${cwd}`);
  return spawnProcess(command, args, cwd, (eventName, data) => {
    if (eventName === "stdout") {
      logger.info(data.toString());
    } else if (eventName === "stderr") {
      logger.info(data.toString());
    } else if (eventName === "close") {
      logger.info(`Process exited with code: ${data}`);
    } else if (eventName === "error") {
      logger.error(`Error: ${data}`);
    }
  });
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdall: string;
  error: any;
}

export const ERROR_EXIT_CODE = 99999;
export function spawnProcess(
  command: string,
  args: string[],
  cwd: string,
  on: (eventName: "stdout" | "stderr" | "close" | "error", data: any) => void = () => {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: true, stdio: "pipe" });

    let stdout = "";
    let stderr = "";
    let stdall = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
      stdall += data.toString();
      on("stdout", data);
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
      stdall += data.toString();
      on("stderr", data);
    });

    child.on("close", (code) => {
      on("close", code);
      resolve({
        exitCode: code,
        stdout,
        stderr,
        stdall,
        error: undefined,
      });
    });

    child.on("error", (error) => {
      on("error", error);
      reject({ exitCode: ERROR_EXIT_CODE, stdout, stderr, stdall, error });
    });
  });
}

export function Retry<T>(fn: () => Promise<T>, retries: number, delayInMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const attempt = (n: number) => {
      fn()
        .then(resolve)
        .catch((error) => {
          if (n === 1) {
            reject(error);
          } else {
            setTimeout(() => attempt(n - 1), delayInMs);
          }
        });
    };
    attempt(retries);
  });
}

export async function tryReadFileOrUrl(
  pathOrUrl: string,
): Promise<{ content: string; url: string } | undefined> {
  if (isUrl(pathOrUrl)) {
    const result = await tryReadUrl(pathOrUrl);
    return result;
  } else {
    const result = await tryReadFile(pathOrUrl);
    return result ? { content: result, url: pathOrUrl } : undefined;
  }
}

export async function tryReadUrl(
  url: string,
): Promise<{ content: string; url: string } | undefined> {
  try {
    const response = await fetch(url, { redirect: "follow" });
    const content = await response.text();
    return { content, url: response.url };
  } catch (e) {
    logger.debug(`Failed to fetch from url: ${url}`, [e]);
    return undefined;
  }
}

export async function tryReadFile(path: string): Promise<string | undefined> {
  try {
    const content = await readFile(path, "utf-8");
    return content;
  } catch (e) {
    logger.debug(`Failed to read file: ${path}`, [e]);
    return undefined;
  }
}

export async function tryWriteFile(path: string, content: string): Promise<boolean> {
  try {
    await writeFile(path, content, "utf-8");
    return true;
  } catch (e) {
    logger.debug(`Failed to write file: ${path}`, [e]);
    return false;
  }
}

export async function tryReadDir(path: string): Promise<string[] | undefined> {
  try {
    return await readdir(path);
  } catch (e) {
    return undefined;
  }
}

/**
 *
 * @param folder
 * @param recursive
 * @param fileFilter
 * @param subFolderFilter subFolderDepth is the index of the subfolder from the given folder: {given folder}/subFolderDepth0/subFolderDepth1/...
 * @returns
 */
export async function listFilesInFolder(
  folder: string,
  recursive: boolean,
  fileFilter: (file: string) => boolean,
  subFolderFilter: (folder: string, subFolderName: string, subFolderDepth: number) => boolean,
): Promise<string[]> {
  return listFilesInFolderInternal(folder, recursive, 0, fileFilter, subFolderFilter);
}

async function listFilesInFolderInternal(
  folder: string,
  recursive: boolean,
  subFolderDepth: number,
  fileFilter: (file: string) => boolean,
  subFolderFilter: (folder: string, subFolderName: string, subFolderDepth: number) => boolean,
) {
  const files: string[] = [];
  try {
    const items = await readdir(folder);
    for (const item of items) {
      const itemPath = join(folder, item);
      const stats = await stat(itemPath);
      if (stats.isDirectory() && recursive && subFolderFilter(itemPath, item, subFolderDepth)) {
        const subFiles = await listFilesInFolderInternal(
          itemPath,
          recursive,
          subFolderDepth + 1,
          fileFilter,
          subFolderFilter,
        );
        files.push(...subFiles);
      } else if (stats.isFile() && fileFilter(item)) {
        files.push(itemPath);
      }
    }
  } catch (e) {
    logger.error(`Error reading directory ${folder}: ${e}`);
  }
  return files;
}

export function normalizeSlash(str: string): string {
  return str.replace(/\\/g, "/");
}

export function wrapBackticks(str: string, lang: string, backticksCount: number = 3): string {
  if (backticksCount < 3) {
    backticksCount = 3;
  }
  const backticks = "`".repeat(backticksCount);
  return `${backticks}${lang}\n${str}\n${backticks}`;
}

export function isMarkdown(str: string): [boolean, string] {
  const match = str.match(/^(`{3,})(markdown)\n([\s\S]*)\n\1$/);
  if (match) {
    // match[3] contains the content inside the markdown block
    return [true, match[3]];
  }
  return [false, str];
}

export async function getCodeSnippetFromFile(file: string, line: number, surroundingLines: number) {
  const content = await tryReadFile(file);
  if (!content) {
    return "";
  }
  const lines = content.split("\n");
  const startLine = Math.max(0, line - surroundingLines - 1);
  const endLine = Math.min(lines.length, line + surroundingLines);
  return lines.slice(startLine, endLine).join("\n");
}

export async function collectFiles(uri: Uri, relativePathPrefix: string = ""): Promise<string[]> {
  const files: string[] = [];
  const entries = await vscode.workspace.fs.readDirectory(uri);
  for (const [name, type] of entries) {
    const itemPath = relativePathPrefix ? `${relativePathPrefix}/${name}` : name;
    if (type === vscode.FileType.File) {
      files.push(itemPath);
    } else if (type === vscode.FileType.Directory) {
      const subFiles = await collectFiles(Uri.joinPath(uri, name), itemPath);
      files.push(...subFiles);
    }
  }
  return files;
}
