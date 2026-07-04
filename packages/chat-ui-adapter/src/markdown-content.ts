import { marked } from "marked";

marked.use({ breaks: true, gfm: true });

const CODE_FENCE_PATTERN = /```/;

/**
 * 为 markdown-block 预处理助手/用户文本。
 *
 * - marked 默认会把单个 `\n` 折叠为空格，需开启 breaks。
 * - 部分模型会返回完全不含换行的长段中文，需在句末标点处补换行。
 */
export function prepareMarkdownContent(content: string): string {
  if (!content || CODE_FENCE_PATTERN.test(content)) {
    return content;
  }

  if (!content.includes("\n")) {
    return content.replace(/([。！？；])(?=\S)/gu, "$1\n");
  }

  return content;
}
