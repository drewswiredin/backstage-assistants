/**
 * Assistant message action bar. Mirrors assistant-ui's stock bar (same root class
 * + autohide behavior, with Copy + Regenerate) and adds a "Copy as rich text"
 * action: it converts the message's markdown to HTML and writes BOTH `text/html`
 * and `text/plain` to the clipboard, so pasting into Teams / Outlook / email / Word
 * lands as formatted rich text instead of raw markdown. (The stock Copy still
 * copies the raw markdown.)
 */
import {
  forwardRef,
  useState,
  type ButtonHTMLAttributes,
} from 'react';
import {
  ActionBarPrimitive,
  MessagePrimitive,
  useAuiState,
} from '@assistant-ui/react';
import FileCopyOutlinedIcon from '@material-ui/icons/FileCopyOutlined';
import CheckIcon from '@material-ui/icons/Check';
import RefreshIcon from '@material-ui/icons/Refresh';
import SubjectIcon from '@material-ui/icons/Subject';
import { marked } from 'marked';

/** Ghost icon button matching assistant-ui's stock action-bar buttons. */
const BarButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function BarButtonImpl(props, ref) {
  return (
    <button
      type="button"
      ref={ref}
      className="aui-button aui-button-ghost aui-button-icon"
      {...props}
    />
  );
});

/** Concatenate the message's text parts back into markdown (what Copy copies). */
function messageMarkdown(
  content: ReadonlyArray<{ type?: string; text?: string }>,
): string {
  return content
    .filter(p => p.type === 'text' && typeof p.text === 'string')
    .map(p => p.text as string)
    .join('\n\n');
}

function RichCopyButton() {
  const [copied, setCopied] = useState(false);
  const markdown = useAuiState(s =>
    messageMarkdown(
      (s.message.content ?? []) as ReadonlyArray<{
        type?: string;
        text?: string;
      }>,
    ),
  );

  const onClick = async () => {
    const md = markdown.trim();
    if (!md) return;

    let html: string;
    try {
      html = marked.parse(md, { async: false, gfm: true }) as string;
    } catch {
      html = md;
    }

    try {
      // Write rich (text/html) + plain (the markdown) so rich-text targets (Teams,
      // Outlook, Word, Gmail) paste formatted, while plain targets get the source.
      const ClipItem = (
        window as unknown as { ClipboardItem?: typeof ClipboardItem }
      ).ClipboardItem;
      if (navigator.clipboard?.write && typeof ClipItem === 'function') {
        await navigator.clipboard.write([
          new ClipItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([md], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(md);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable / blocked */
    }
  };

  return (
    <BarButton
      onClick={onClick}
      title="Copy as rich text (paste into Teams, Outlook, email)"
      aria-label="Copy as rich text"
    >
      {copied ? (
        <CheckIcon fontSize="small" />
      ) : (
        <SubjectIcon fontSize="small" />
      )}
    </BarButton>
  );
}

export function AssistantActionBar() {
  const allowReload = useAuiState(s => s.thread.capabilities.reload);

  return (
    <ActionBarPrimitive.Root
      className="aui-assistant-action-bar-root"
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
    >
      <ActionBarPrimitive.Copy asChild>
        <BarButton title="Copy" aria-label="Copy">
          <MessagePrimitive.If copied>
            <CheckIcon fontSize="small" />
          </MessagePrimitive.If>
          <MessagePrimitive.If copied={false}>
            <FileCopyOutlinedIcon fontSize="small" />
          </MessagePrimitive.If>
        </BarButton>
      </ActionBarPrimitive.Copy>

      <RichCopyButton />

      {allowReload && (
        <ActionBarPrimitive.Reload asChild>
          <BarButton title="Regenerate" aria-label="Regenerate">
            <RefreshIcon fontSize="small" />
          </BarButton>
        </ActionBarPrimitive.Reload>
      )}
    </ActionBarPrimitive.Root>
  );
}
