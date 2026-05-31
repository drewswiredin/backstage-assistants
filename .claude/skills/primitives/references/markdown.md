# Markdown Rendering (`@assistant-ui/react-markdown`)

Render assistant text as Markdown (GFM, code blocks, tables, custom code-fence
components like Mermaid). Verified against `@assistant-ui/react-markdown@0.14.x`.

## There is no `makeMarkdownText`

The old `makeMarkdownText()` factory lived in `@assistant-ui/react-ui`, which is
**deprecated and deleted**. It is NOT exported by `@assistant-ui/react-markdown`.
The current, supported approach is an **owned-source** `MarkdownText` component
built on `MarkdownTextPrimitive`, generated into the repo via the registry.

Public surface of `@assistant-ui/react-markdown@0.14.x`:

- `MarkdownTextPrimitive` (+ `MarkdownTextPrimitiveProps`)
- `unstable_memoizeMarkdownComponents` (alias of `memoizeMarkdownComponents`)
- `useIsMarkdownCodeBlock`
- types: `CodeHeaderProps`, `SyntaxHighlighterProps`

## Generate the owned source

```bash
npx assistant-ui@latest add markdown-text
```

Drops `components/assistant-ui/markdown-text.tsx` (deps: `@assistant-ui/react-markdown`,
`remark-gfm`). You own and theme that file.

## Minimal shape

```tsx
"use client";
import {
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { memo } from "react";

const defaultComponents = memoizeMarkdownComponents({
  // h1..h6, p, a, ul, ol, table, pre, code, CodeHeader, ...
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return <code className={className} {...props} />;
  },
});

const MarkdownTextImpl = () => (
  <MarkdownTextPrimitive
    remarkPlugins={[remarkGfm]}
    className="aui-md"
    components={defaultComponents}
  />
);

export const MarkdownText = memo(MarkdownTextImpl);
```

Wire it into the assistant message as the renderer for `text` parts:

```tsx
<MessagePrimitive.Parts>
  {({ part }) => (part.type === "text" ? <MarkdownText /> : null)}
</MessagePrimitive.Parts>
```

(Or via `components={{ Text: MarkdownText }}` on `MessagePrimitive.Parts`.)

## Custom code-fence components (Mermaid)

Per-language renderers go through `componentsByLanguage` on the primitive — NOT a
custom unregistered part. Add the `mermaid-diagram` component
(`npx assistant-ui@latest add mermaid-diagram`; deps `mermaid` +
`@assistant-ui/react-markdown`), then:

```tsx
const MarkdownTextImpl = () => (
  <MarkdownTextPrimitive
    remarkPlugins={[remarkGfm]}
    className="aui-md"
    components={defaultComponents}
    componentsByLanguage={{
      mermaid: { SyntaxHighlighter: MermaidDiagram },
    }}
  />
);
```

The `SyntaxHighlighter` receives `SyntaxHighlighterProps` (`code`, `language`,
`node`, `components`). The shipped `MermaidDiagram`:

- gates rendering until the fence is complete using
  `useAuiState((s) => /* closing ``` present after this block */)` — avoids
  parsing incomplete diagram code mid-stream;
- renders `await mermaid.render(id, code)` into a `ref`'d `<pre>`;
- calls `mermaid.initialize({ startOnLoad: false, theme })` at module scope.

For this project, the owned `MermaidDiagram` additionally: drops any markdown
fence-balancing preprocess hack, tracks a latest-request id to ignore stale async
renders (the scaffold's cleanup-inside-setTimeout bug), and initializes the
mermaid theme from the active Backstage light/dark theme.

## Syntax highlighting

Not included by default. Add via `npx assistant-ui@latest add` for
`react-shiki` or `react-syntax-highlighter` (see docs `/docs/ui/syntax-highlighting`).
