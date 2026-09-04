// Vendored from @assistant-ui/react-ui@0.2.1 `markdown/*` (markdown-text,
// code-header, useCopyToClipboard — see withDefaults.tsx for why).
// MIT License, Copyright (c) 2025 AgentbaseAI Inc. — full license text in
// THIRD_PARTY_NOTICES.md at the package root.
import { memo, useState, type FC } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import classNames from 'classnames';
import {
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
  type CodeHeaderProps,
  type MarkdownTextPrimitiveProps,
} from '@assistant-ui/react-markdown';
import { INTERNAL } from '@assistant-ui/react';
import { TooltipIconButton } from './base';
import { useThreadConfig } from './thread-config';

const { withSmoothContextProvider, useSmoothStatus } = INTERNAL;

const useCopyToClipboard = ({
  copiedDuration = 3000,
}: { copiedDuration?: number } = {}) => {
  const [isCopied, setIsCopied] = useState(false);
  const copyToClipboard = (value: string) => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), copiedDuration);
    });
  };
  return { isCopied, copyToClipboard };
};

export const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const {
    strings: {
      code: { header: { copy: { tooltip = 'Copy' } = {} } = {} } = {},
    } = {},
  } = useThreadConfig();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };
  return (
    <div className="aui-code-header-root">
      <span className="aui-code-header-language">{language}</span>
      <TooltipIconButton tooltip={tooltip} onClick={onCopy}>
        {!isCopied && <CopyIcon />}
        {isCopied && <CheckIcon />}
      </TooltipIconButton>
    </div>
  );
};

const defaultComponents = unstable_memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1 className={classNames('aui-md-h1', className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={classNames('aui-md-h2', className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={classNames('aui-md-h3', className)} {...props} />
  ),
  h4: ({ className, ...props }) => (
    <h4 className={classNames('aui-md-h4', className)} {...props} />
  ),
  h5: ({ className, ...props }) => (
    <h5 className={classNames('aui-md-h5', className)} {...props} />
  ),
  h6: ({ className, ...props }) => (
    <h6 className={classNames('aui-md-h6', className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={classNames('aui-md-p', className)} {...props} />
  ),
  a: ({ className, ...props }) => (
    <a className={classNames('aui-md-a', className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={classNames('aui-md-blockquote', className)}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul className={classNames('aui-md-ul', className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={classNames('aui-md-ol', className)} {...props} />
  ),
  hr: ({ className, ...props }) => (
    <hr className={classNames('aui-md-hr', className)} {...props} />
  ),
  table: ({ className, ...props }) => (
    <table className={classNames('aui-md-table', className)} {...props} />
  ),
  th: ({ className, ...props }) => (
    <th className={classNames('aui-md-th', className)} {...props} />
  ),
  td: ({ className, ...props }) => (
    <td className={classNames('aui-md-td', className)} {...props} />
  ),
  tr: ({ className, ...props }) => (
    <tr className={classNames('aui-md-tr', className)} {...props} />
  ),
  sup: ({ className, ...props }) => (
    <sup className={classNames('aui-md-sup', className)} {...props} />
  ),
  pre: ({ className, ...props }) => (
    <pre className={classNames('aui-md-pre', className)} {...props} />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={classNames(!isCodeBlock && 'aui-md-inline-code', className)}
        {...props}
      />
    );
  },
  CodeHeader,
});

export type MakeMarkdownTextProps = MarkdownTextPrimitiveProps;

export const makeMarkdownText = ({
  className,
  components: userComponents,
  ...rest
}: MakeMarkdownTextProps = {}) => {
  const components = {
    ...defaultComponents,
    ...Object.fromEntries(
      // ignore undefined values, so undefined values do not override default components
      Object.entries(userComponents ?? {}).filter(([, v]) => v !== undefined),
    ),
  };
  const MarkdownTextImpl = () => {
    const status = useSmoothStatus();
    return (
      <MarkdownTextPrimitive
        components={components}
        {...rest}
        className={classNames(
          status.type === 'running' && 'aui-md-running',
          className,
        )}
      />
    );
  };
  MarkdownTextImpl.displayName = 'MarkdownText';
  return memo(withSmoothContextProvider(MarkdownTextImpl), () => true);
};
