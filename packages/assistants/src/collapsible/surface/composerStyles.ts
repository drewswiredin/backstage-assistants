/**
 * The assistant-ui theme variables and the composer's two-row layout, shared
 * by every surface that shows the composer: the conversation surface (page
 * and panel) and the homepage composer, which has no runtime behind it but
 * must look the same.
 */
import { makeStyles, type Theme } from '@material-ui/core/styles';
import type { CSSProperties } from 'react';

/** The `--aui-*` variables the vendored assistant-ui CSS reads, per theme mode. */
export function auiThemeVars(theme: Theme): Record<string, string> {
  const dark = theme.palette.type === 'dark';
  return {
    '--aui-background': dark ? '0 0% 18%' : '0 0% 100%',
    '--aui-foreground': dark ? '0 0% 98%' : '240 10% 3.9%',
    '--aui-muted': dark ? '0 0% 24%' : '240 4.8% 95.9%',
    '--aui-muted-foreground': dark ? '0 0% 70%' : '240 3.8% 46.1%',
    '--aui-accent': dark ? '0 0% 24%' : '240 4.8% 95.9%',
    '--aui-accent-foreground': dark ? '0 0% 98%' : '240 5.9% 10%',
    '--aui-border': dark ? '0 0% 40%' : '240 5.9% 90%',
    '--aui-input': dark ? '0 0% 40%' : '240 5.9% 90%',
    '--aui-ring': dark ? '207 90% 68%' : '210 90% 45%',
    '--aui-primary': dark ? '0 0% 98%' : '240 5.9% 10%',
    '--aui-primary-foreground': dark ? '240 5.9% 10%' : '0 0% 98%',
  };
}

export const useComposerStyles = makeStyles(theme => ({
  // `aui-composer-root` border + focus glow (withDefaults merges classNames).
  //
  // The `&&` doubles the generated class selector (→ 0,2,0 specificity) so these
  // overrides beat the stock `.aui-composer-root` / `.aui-composer-input` rules
  // (0,1,0) REGARDLESS of stylesheet injection order. Without it the two rules
  // tie, and on hosts where the vendored assistant-ui CSS is injected after our
  // makeStyles, the stock `align-items: flex-end` wins — collapsing the textarea
  // to its default width and floating it right (the layout looks broken).
  composerRoot: {
    '&&': {
      flexDirection: 'column',
      flexWrap: 'nowrap',
      alignItems: 'stretch',
    },
  },
  composerInput: {
    // A touch taller so the input reads as a full first row.
    '&&': {
      minHeight: 44,
      paddingTop: theme.spacing(1.25),
      paddingBottom: theme.spacing(1),
    },
  },
  composerRow2: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    // Full-width separator between the two rows: pull out to the box edges
    // (cancel the root's 0.625rem side padding) for the border, then re-indent
    // the row content.
    marginLeft: '-0.625rem',
    marginRight: '-0.625rem',
    paddingLeft: '0.625rem',
    paddingRight: '0.625rem',
    paddingTop: theme.spacing(0.75),
    paddingBottom: theme.spacing(0.75),
    borderTop: `1px solid ${theme.palette.divider}`,
    // The stock attach/send/cancel buttons carry vertical margins for the
    // single-row layout; drop them so the second row stays compact.
    '& .aui-composer-attach, & .aui-composer-send, & .aui-composer-cancel': {
      margin: 0,
    },
  },
  composerRow2Spacer: {
    flex: 1,
  },
  // A little breathing room between the usage gauge and the send/stop button.
  gaugeSlot: {
    display: 'inline-flex',
    alignItems: 'center',
    marginRight: theme.spacing(1),
  },
  overWarning: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.palette.error.main,
    whiteSpace: 'nowrap',
  },
}));

/** Inline style that sets the composer's focus tint to the assistant color. */
export function composerFocusStyle(color: string): CSSProperties {
  return { '--aui-composer-focus': color } as CSSProperties;
}
