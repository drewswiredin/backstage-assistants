/**
 * Download chip — a compact file pill with a download link + (for text) a copy
 * button. Shared by two callers:
 *  - {@link AttachmentChip}: renders a user's uploaded-file attachment in a sent
 *    message (the data URL is persisted in the message, so it survives reloads).
 *  - the `download_file` generative tool ({@link DownloadFileTool}): renders a file
 *    the assistant produced.
 *
 * Everything is self-contained in a `data:` URL, so download is a plain anchor and
 * needs no blob store; copy decodes the URL back to text for text-like files.
 */
import { useState, type ReactNode } from 'react';
import {
  ButtonBase,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import GetAppIcon from '@material-ui/icons/GetApp';
import FileCopyIcon from '@material-ui/icons/FileCopy';
import CheckIcon from '@material-ui/icons/Check';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import InsertDriveFileIcon from '@material-ui/icons/InsertDriveFile';
import { useAuiState } from '@assistant-ui/react';
import { PanZoomDialog } from './PanZoomViewer';

const useStyles = makeStyles(theme => ({
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    maxWidth: 320,
    margin: theme.spacing(0.5, 0),
    padding: theme.spacing(0.75, 0.75, 0.75, 1.25),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.background.paper,
  },
  thumb: {
    width: 32,
    height: 32,
    borderRadius: theme.shape.borderRadius,
    objectFit: 'cover',
    flexShrink: 0,
  },
  // The clickable region of an image chip (thumb + label) that opens the viewer.
  // The kebab menu is a sibling, so its clicks never reach here.
  previewButton: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flex: 1,
    minWidth: 0,
    textAlign: 'left',
    borderRadius: theme.shape.borderRadius,
    padding: theme.spacing(0.25, 0.5),
    margin: theme.spacing(-0.25, -0.5),
    cursor: 'zoom-in',
    '&:hover': { backgroundColor: theme.palette.action.hover },
    // Keyboard focus ring — the ripple alone is too subtle over a thumbnail.
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 2,
    },
  },
  icon: {
    color: theme.palette.text.secondary,
    flexShrink: 0,
  },
  text: {
    minWidth: 0,
    flex: 1,
  },
  name: {
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    color: theme.palette.text.secondary,
  },
  action: {
    padding: theme.spacing(0.5),
    flexShrink: 0,
  },
  menuIcon: {
    minWidth: 32,
  },
}));

const isImageMime = (m?: string) => !!m && m.startsWith('image/');

/** Decode a `data:` URL back to text (for copy). Handles base64 and plain. */
function dataUrlToText(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return '';
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const bin = atob(payload);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  try {
    return decodeURIComponent(payload);
  } catch {
    return payload;
  }
}

/** Build a base64 `data:` URL from text (used by the artifact tool). */
export function textToDataUrl(text: string, mimeType: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return `data:${mimeType};base64,${btoa(bin)}`;
}

/** Short human label for the chip's second line. */
function typeLabel(name: string, mimeType?: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : '';
  if (ext) return ext;
  if (mimeType) return mimeType;
  return 'File';
}

/**
 * Presentational download chip. `dataUrl` is a self-contained `data:` URL; the
 * download is a plain anchor, and copy is offered for non-image (text) files.
 */
export function DownloadChip({
  name,
  mimeType,
  dataUrl,
}: {
  name: string;
  mimeType?: string;
  dataUrl: string;
}) {
  const classes = useStyles();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  // Natural image size, read once it loads — gives the pan/zoom viewport a definite
  // box to fit/center against (and re-fits when it lands; see PanZoomDialog.fitKey).
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const image = isImageMime(mimeType);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(dataUrlToText(dataUrl));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
    // Keep the menu open briefly so the "Copied" confirmation is visible.
  };

  let thumb: ReactNode;
  if (image) {
    thumb = <img src={dataUrl} alt="" className={classes.thumb} />;
  } else {
    thumb = <InsertDriveFileIcon className={classes.icon} fontSize="small" />;
  }

  const body = (
    <>
      {thumb}
      <span className={classes.text}>
        <Typography variant="body2" className={classes.name} title={name}>
          {name}
        </Typography>
        <Typography variant="caption" className={classes.meta}>
          {typeLabel(name, mimeType)}
        </Typography>
      </span>
    </>
  );

  return (
    <div className={classes.chip}>
      {/* Images: the chip body is a button that opens the full-size viewer.
          Other files: a plain, non-interactive label (actions live in the menu). */}
      {image ? (
        <ButtonBase
          className={classes.previewButton}
          onClick={() => setViewerOpen(true)}
          focusRipple
          aria-label={`View ${name}`}
        >
          {body}
        </ButtonBase>
      ) : (
        body
      )}
      <Tooltip title="File actions">
        <IconButton
          className={classes.action}
          size="small"
          aria-label="File actions"
          aria-haspopup="true"
          onClick={e => setAnchorEl(e.currentTarget)}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        getContentAnchorEl={null}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          component="a"
          href={dataUrl}
          download={name}
          onClick={() => setAnchorEl(null)}
        >
          <ListItemIcon className={classes.menuIcon}>
            <GetAppIcon fontSize="small" />
          </ListItemIcon>
          Download
        </MenuItem>
        {!image && (
          <MenuItem onClick={onCopy}>
            <ListItemIcon className={classes.menuIcon}>
              {copied ? (
                <CheckIcon fontSize="small" />
              ) : (
                <FileCopyIcon fontSize="small" />
              )}
            </ListItemIcon>
            {copied ? 'Copied' : 'Copy contents'}
          </MenuItem>
        )}
      </Menu>
      {image && (
        <PanZoomDialog
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          width={imgDims?.w}
          height={imgDims?.h}
          fitKey={imgDims}
          ariaLabel={name}
        >
          <img
            src={dataUrl}
            alt={name}
            draggable={false}
            onLoad={e =>
              setImgDims({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
          />
        </PanZoomDialog>
      )}
    </div>
  );
}

/**
 * Custom attachment renderer for SENT messages — a {@link DownloadChip} built from
 * the attachment's persisted `data:` URL. Wire via
 * `<UserMessage.Attachments components={{ Attachment: AttachmentChip }} />`.
 * (Composer-side pending attachments have no content yet, so it falls back to a
 * plain name chip there.)
 */
export function AttachmentChip() {
  const classes = useStyles();
  const name = useAuiState(s => s.attachment.name) || 'attachment';
  const dataUrl = useAuiState(s => {
    const part = (s.attachment.content ?? []).find(
      c => c.type === 'file' || c.type === 'image',
    ) as { type?: string; data?: string; image?: string } | undefined;
    if (!part) return undefined;
    return part.type === 'image' ? part.image : part.data;
  });
  const mimeType = useAuiState(s => {
    const part = (s.attachment.content ?? []).find(
      c => c.type === 'file' || c.type === 'image',
    ) as { type?: string; mimeType?: string } | undefined;
    if (part?.type === 'file') return part.mimeType;
    return s.attachment.contentType;
  });

  if (!dataUrl) {
    // Pending (composer) attachment — content not materialized yet.
    return (
      <div className={classes.chip}>
        <InsertDriveFileIcon className={classes.icon} fontSize="small" />
        <Typography variant="body2" className={classes.name} title={name}>
          {name}
        </Typography>
      </div>
    );
  }

  return <DownloadChip name={name} mimeType={mimeType} dataUrl={dataUrl} />;
}
