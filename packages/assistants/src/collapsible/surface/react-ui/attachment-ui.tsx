// Vendored from @assistant-ui/react-ui@0.2.1 `attachment-ui.tsx` (see
// withDefaults.tsx for why). Deviations: the legacy `useAttachment(selector)`
// hook (removed on the 0.15 line) is replaced with equivalent `useAuiState`
// selectors, and zustand's `useShallow` is dropped by selecting the file and
// src separately instead of as one shallow-compared object.
import { forwardRef, useEffect, useState } from 'react';
import { CircleXIcon, FileIcon } from 'lucide-react';
import { AttachmentPrimitive, useAuiState } from '@assistant-ui/react';
import { withDefaults } from './withDefaults';
import { useThreadConfig } from './thread-config';
import {
  AvatarFallback,
  AvatarImage,
  AvatarRoot,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  Tooltip,
  TooltipContent,
  TooltipIconButton,
  TooltipTrigger,
} from './base';

const AttachmentRoot = withDefaults(AttachmentPrimitive.Root, {
  className: 'aui-attachment-root',
});

const AttachmentContent = withDefaults('div', {
  className: 'aui-attachment-content',
});

const useFileSrc = (file: File | undefined) => {
  const [src, setSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!file) {
      setSrc(undefined);
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file);
    setSrc(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  return src;
};

const useAttachmentSrc = () => {
  const file = useAuiState(s =>
    s.attachment.type === 'image' ? s.attachment.file : undefined,
  );
  const contentSrc = useAuiState(s => {
    if (s.attachment.type !== 'image' || s.attachment.file) return undefined;
    const image = s.attachment.content?.filter(c => c.type === 'image')[0];
    return image?.image;
  });
  return useFileSrc(file) ?? contentSrc;
};

const AttachmentPreview = ({ src }: { src: string }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  return (
    <img
      src={src}
      style={{
        width: 'auto',
        height: 'auto',
        maxWidth: '75dvh',
        maxHeight: '75dvh',
        display: isLoaded ? 'block' : 'none',
        overflow: 'clip',
      }}
      onLoad={() => setIsLoaded(true)}
      alt="Preview"
    />
  );
};

const AttachmentPreviewDialog = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const src = useAttachmentSrc();
  if (!src) return <>{children}</>;
  return (
    <Dialog>
      <DialogTrigger className="aui-attachment-preview-trigger" asChild>
        {children}
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="aui-sr-only">
          Image Attachment Preview
        </DialogTitle>
        <AttachmentPreview src={src} />
      </DialogContent>
    </Dialog>
  );
};

const AttachmentThumb = () => {
  const isImage = useAuiState(s => s.attachment.type === 'image');
  const src = useAttachmentSrc();
  return (
    <AvatarRoot className="aui-attachment-thumb">
      <AvatarFallback delayMs={isImage ? 200 : 0}>
        <FileIcon />
      </AvatarFallback>
      <AvatarImage src={src} />
    </AvatarRoot>
  );
};

const AttachmentUI = () => {
  // `source` is on the attachment state at runtime but missing from the typed
  // `Attachment` union, hence the cast.
  const canRemove = useAuiState(
    s => (s.attachment as { source?: string }).source !== 'message',
  );
  const typeLabel = useAuiState(s => {
    switch (s.attachment.type) {
      case 'image':
        return 'Image';
      case 'document':
        return 'Document';
      case 'file':
        return 'File';
      default:
        throw new Error(
          `Unknown attachment type: ${(s.attachment as { type: string }).type}`,
        );
    }
  });
  return (
    <Tooltip>
      <AttachmentRoot>
        <AttachmentPreviewDialog>
          <TooltipTrigger asChild>
            <AttachmentContent>
              <AttachmentThumb />
              <div className="aui-attachment-text">
                <p className="aui-attachment-name">
                  <AttachmentPrimitive.Name />
                </p>
                <p className="aui-attachment-type">{typeLabel}</p>
              </div>
            </AttachmentContent>
          </TooltipTrigger>
        </AttachmentPreviewDialog>
        {canRemove && <AttachmentRemove />}
      </AttachmentRoot>
      <TooltipContent side="top">
        <AttachmentPrimitive.Name />
      </TooltipContent>
    </Tooltip>
  );
};
AttachmentUI.displayName = 'Attachment';

const AttachmentRemove = forwardRef<
  HTMLButtonElement,
  Partial<React.ComponentPropsWithoutRef<typeof TooltipIconButton>>
>((props, ref) => {
  const {
    strings: {
      composer: { removeAttachment: { tooltip = 'Remove file' } = {} } = {},
    } = {},
  } = useThreadConfig();
  return (
    <AttachmentPrimitive.Remove asChild>
      <TooltipIconButton
        tooltip={tooltip}
        className="aui-attachment-remove"
        side="top"
        {...props}
        ref={ref}
      >
        {props.children ?? <CircleXIcon />}
      </TooltipIconButton>
    </AttachmentPrimitive.Remove>
  );
});
AttachmentRemove.displayName = 'AttachmentRemove';

export const Attachment = Object.assign(AttachmentUI, {
  Root: AttachmentRoot,
  Remove: AttachmentRemove,
});
