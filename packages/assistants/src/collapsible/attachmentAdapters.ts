/**
 * Composer attachment adapter — file + image upload.
 *
 * A single {@link AttachmentAdapter} for everything the composer can attach. Every
 * file is sent as a `file` content part (a base64 data URL) carrying its real mime
 * type:
 *  - Images preview as a thumbnail (attachment `type: 'image'`) and are forwarded
 *    to the model as-is. We deliberately do NOT use `SimpleImageAttachmentAdapter`
 *    (an `image` content part): the AI-SDK bridge hardcodes `image/png` for that
 *    path, mislabelling JPEG/WebP/GIF. A `file` part preserves the true mime type.
 *  - Everything else previews as a compact chip (attachment `type: 'document'`).
 *    The backend re-inlines non-image file parts as text before the model (see
 *    inlineTextFileAttachments in the backend router), so text/code files work on
 *    every model.
 *
 * No per-model capability gating: we always attach and always send. If a model
 * can't read an image, the provider's own error surfaces in the thread — one less
 * thing to configure, and the source of truth is the provider, not our config.
 * The only client-side guard is a size cap (a clean error instead of an opaque
 * 413); rejections are surfaced to the user, not swallowed (see ConversationSurface
 * — it listens for `composer.attachmentAddError` and posts an alert).
 */
import type {
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
} from '@assistant-ui/react';

/**
 * ~7 MB raw cap. A base64 data URL inflates ~33%, and the backend `/chat` body
 * limit defaults to 10 MB — so this leaves headroom and gives a clean client-side
 * error instead of an opaque 413.
 */
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;

/**
 * File extensions the picker offers alongside images. Code/data files often have
 * an empty or non-`text/*` MIME type, so the file-picker `accept` needs an explicit
 * extension list (paste ignores `accept` and routes by the file itself).
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

const isImage = (file: { type?: string }) => (file.type ?? '').startsWith('image/');

/**
 * Sends any attachment as a `file` content part with its real mime type. Images
 * preview as a thumbnail; everything else as a chip and is re-inlined as text by
 * the backend. No capability gate — the provider is the source of truth.
 */
class FileAttachmentAdapter implements AttachmentAdapter {
  accept = [...TEXT_FILE_EXTENSIONS, 'image/*'].join(',');

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    assertSize(file);
    return {
      id: file.name,
      type: isImage(file) ? 'image' : 'document',
      name: file.name,
      contentType: file.type,
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
          mimeType:
            attachment.contentType ||
            (attachment.type === 'image' ? 'image/png' : 'text/plain'),
          filename: attachment.name,
          data,
        },
      ],
    };
  }

  async remove(): Promise<void> {}
}

/** Build the composer attachment adapter for a thread. */
export function createAttachmentAdapter(): AttachmentAdapter {
  return new FileAttachmentAdapter();
}
