import remarkGfm from 'remark-gfm';
import { makeMarkdownText } from './react-ui';
import { MermaidDiagram } from './MermaidDiagram';

/**
 * While an assistant message is streaming, a ```mermaid fenced block may not
 * yet have its closing ``` fence. Markdown parsers won't treat the block as a
 * code block until it's closed, so the half-streamed diagram source leaks into
 * the rendered text. This appends a temporary closing fence so the in-progress
 * block is parsed (and handed to the Mermaid renderer) immediately.
 *
 * It also normalizes an opening fence whose language keyword is still streaming
 * (e.g. `"```me"` before the word `mermaid` finishes). Without this, the block
 * isn't routed to the Mermaid renderer until the full keyword lands, so the
 * diagram element mounts/unmounts as the keyword forms char by char — its height
 * flickers between the placeholder and ~0 at the start of the stream. Matching a
 * ≥2-char prefix of `mermaid` ("me".."mermai") can't collide with any other
 * fenced language (js, py, yaml, markdown, …), so it's safe.
 */
export function closeStreamingMermaidFence(text: string) {
  const matches = [...text.matchAll(/```mermaid[^\n]*(?:\n|$)/gi)];
  const last = matches[matches.length - 1];
  if (last && last.index !== undefined) {
    const afterFence = text.slice(last.index + last[0].length);
    return afterFence.includes('```') ? text : `${text}\n\`\`\``;
  }

  // Opening fence still mid-keyword at the end of the stream → treat as mermaid
  // now, so the block mounts the diagram renderer once and holds a steady height.
  const opening = text.match(/```([a-z]+)$/i);
  if (opening && opening.index !== undefined) {
    const lang = opening[1].toLowerCase();
    if (lang.length >= 2 && lang.length < 'mermaid'.length && 'mermaid'.startsWith(lang)) {
      return `${text.slice(0, opening.index)}\`\`\`mermaid\n\`\`\``;
    }
  }
  return text;
}

export const MarkdownText = makeMarkdownText({
  // Smooth (character-by-character) streaming must be OFF for this renderer.
  // `closeStreamingMermaidFence` appends a synthetic closing ``` after the still-
  // growing diagram body, so each streamed frame is NOT a prefix of the next.
  // assistant-ui's useSmooth treats a non-prefix update as a stream reset
  // (`!text.startsWith(displayedText)` → re-reveal from empty), which re-parses the
  // markdown and tears down + rebuilds the diagram subtree on nearly every frame —
  // that remount churn (not our placeholder) is what made the diagram area flash.
  // With smooth off, useSmooth returns the full text each frame, so the fence stays
  // closed and the subtree is stable. Trade-off: text appears in model-sized chunks
  // rather than a typewriter reveal — purely cosmetic, no layout/correctness change.
  smooth: false,
  remarkPlugins: [remarkGfm],
  preprocess: closeStreamingMermaidFence,
  componentsByLanguage: {
    mermaid: { SyntaxHighlighter: MermaidDiagram as any },
  },
});
