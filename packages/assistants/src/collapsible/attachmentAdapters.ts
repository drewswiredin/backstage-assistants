/**
 * Composer attachment adapters — file + image upload.
 *
 * A {@link CompositeAttachmentAdapter} over two adapters:
 *  - Text/code/data files (matched by EXTENSION) are sent as a FILE content part
 *    (a base64 data URL) so the chat renders them as a compact chip rather than
 *    dumping the contents into the message. The backend then decodes each non-image
 *    file part back into a text block before the model (see inlineTextFileAttachments
 *    in the backend router), so they still work on every model regardless of vision
 *    support. (The built-in text adapter matches a few MIME types only and misses
 *    code files whose `File.type` is empty/non-text — hence the extension list.)
 *  - Images are sent as a FILE content part carrying the real mime type, and are
 *    GATED on the selected model's `vision` capability. We deliberately do NOT use
 *    `SimpleImageAttachmentAdapter` (an `image` content part): the AI-SDK bridge
 *    hardcodes `image/png` for that path, mislabelling JPEG/WebP/GIF to the model.
 *    The `file` content part preserves the true mime type (image still previews as
 *    a thumbnail because the attachment `type` is `"image"`).
 *
 * Capability is read LIVE from `getModel()` (the currently-selected model option)
 * inside add()/send(), so switching models mid-thread is honored without rebuilding
 * the runtime (a rebuild would drop an in-flight stream — see useAssistantRuntime).
 */
import {
  CompositeAttachmentAdapter,
  type AttachmentAdapter,
  type CompleteAttachment,
  type PendingAttachment,
} from '@assistant-ui/react';
import type { ModelOption } from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * ~7 MB raw cap. A base64 data URL inflates ~33%, and the backend `/chat` body
 * limit defaults to 10 MB — so this leaves headroom and gives a clean client-side
 * error instead of an opaque 413.
 */
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;

/**
 * Text/code/data files we inline as text, matched by extension (code files often
 * have an empty or non-`text/*` MIME type, so an extension list is required).
 */
const TEXT_FILE_EXTENSIONS = [
  '.txt', '.text', '.md', '.markdown', '.rst', '.log',
  '.csv', '.tsv', '.json', '.jsonc', '.ndjson', '.yaml', '.yml', '.toml', '.ini',
  '.env', '.xml', '.html', '.htm', '.css', '.scss', '.less',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.kts', '.rb', '.php', '.pl',
  '.c', '.h', '.cpp', '.cc', '.hpp', '.cs', '.swift', '.scala', '.dart',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat',
  '.sql', '.graphql', '.gql', '.proto', '.dockerfile', '.makefile',
  '.gradle', '.tf', '.hcl', '.vue', '.svelte', '.lua', '.r',
];

const readAsDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const assertSize = (file: File) => {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — ` +
        `attachments are limited to 7 MB.`,
    );
  }
};

/**
 * Sends text/code/data files as a FILE content part (a chip in the chat). The
 * backend re-inlines non-image file parts as text before the model, so this works
 * on every model. Always on, no capability gate.
 */
class TextFileAttachmentAdapter implements AttachmentAdapter {
  accept = TEXT_FILE_EXTENSIONS.join(',');

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    assertSize(file);
    return {
      id: file.name,
      type: 'document',
      name: file.name,
      contentType: file.type || 'text/plain',
      file,
      status: { type: 'requires-action', reason: 'composer-send' },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const data = await readAsDataURL(attachment.file);
    return {
      ...attachment,
      status: { type: 'complete' },
      content: [
        {
          type: 'file',
          mimeType: attachment.contentType || 'text/plain',
          filename: attachment.name,
          data,
        },
      ],
    };
  }

  async remove(): Promise<void> {}
}

/** Sends images as a file part (real mime type), gated on the model's vision flag. */
class VisionImageAttachmentAdapter implements AttachmentAdapter {
  accept = 'image/*';

  constructor(private readonly getModel: () => ModelOption | undefined) {}

  private assertVision() {
    if (!this.getModel()?.vision) {
      throw new Error(
        'This model can’t accept images. Switch to a vision-capable model, ' +
          'or attach a text/code file instead.',
      );
    }
  }

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    this.assertVision();
    assertSize(file);
    return {
      id: file.name,
      type: 'image',
      name: file.name,
      contentType: file.type,
      file,
      status: { type: 'requires-action', reason: 'composer-send' },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    // Re-check at send: the selected model may have changed since attach time.
    this.assertVision();
    const data = await readAsDataURL(attachment.file);
    return {
      ...attachment,
      status: { type: 'complete' },
      content: [
        {
          type: 'file',
          mimeType: attachment.contentType || 'image/png',
          filename: attachment.name,
          data,
        },
      ],
    };
  }

  async remove(): Promise<void> {}
}

/**
 * Build the composer attachment adapter for a thread. `getModel` returns the
 * currently-selected model option, read live so a mid-thread model switch is
 * honored at attach/send without rebuilding the runtime.
 */
export function createAttachmentAdapter(
  getModel: () => ModelOption | undefined,
): CompositeAttachmentAdapter {
  return new CompositeAttachmentAdapter([
    new TextFileAttachmentAdapter(),
    new VisionImageAttachmentAdapter(getModel),
  ]);
}
