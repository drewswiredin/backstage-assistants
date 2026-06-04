import remarkGfm from 'remark-gfm';
import { makeMarkdownText } from '@assistant-ui/react-ui';
import { MermaidDiagram } from './MermaidDiagram';

/**
 * While an assistant message is streaming, a ```mermaid fenced block may not
 * yet have its closing ``` fence. Markdown parsers won't treat the block as a
 * code block until it's closed, so the half-streamed diagram source leaks into
 * the rendered text. This appends a temporary closing fence so the in-progress
 * block is parsed (and handed to the Mermaid renderer) immediately.
 */
export function closeStreamingMermaidFence(text: string) {
  const matches = [...text.matchAll(/```mermaid[^\n]*(?:\n|$)/gi)];
  const last = matches[matches.length - 1];
  if (!last || last.index === undefined) {
    return text;
  }

  const afterFence = text.slice(last.index + last[0].length);
  return afterFence.includes('```') ? text : `${text}\n\`\`\``;
}

export const MarkdownText = makeMarkdownText({
  remarkPlugins: [remarkGfm],
  preprocess: closeStreamingMermaidFence,
  componentsByLanguage: {
    mermaid: { SyntaxHighlighter: MermaidDiagram as any },
  },
});
