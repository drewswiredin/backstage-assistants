// Vendored from @assistant-ui/react-ui@0.2.1 `base/*` (see withDefaults.tsx for
// why). The cva() button-variant helper is replaced with a plain lookup — same
// class output, one less dependency.
// MIT License, Copyright (c) 2025 AgentbaseAI Inc. — full license text in
// THIRD_PARTY_NOTICES.md at the package root.
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type FC,
  type PropsWithChildren,
} from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Primitive } from '@radix-ui/react-primitive';
import classNames from 'classnames';
import { withDefaults } from './withDefaults';

// ---- button ----

const buttonVariantClasses = {
  default: 'aui-button-primary',
  outline: 'aui-button-outline',
  ghost: 'aui-button-ghost',
} as const;

const buttonSizeClasses = {
  default: 'aui-button-medium',
  icon: 'aui-button-icon',
} as const;

export type ButtonProps = ComponentPropsWithoutRef<typeof Primitive.button> & {
  variant?: keyof typeof buttonVariantClasses | undefined;
  size?: keyof typeof buttonSizeClasses | undefined;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <Primitive.button
        className={classNames(
          'aui-button',
          buttonVariantClasses[variant],
          buttonSizeClasses[size],
          className,
        )}
        {...props}
        ref={ref}
      />
    );
  },
);
Button.displayName = 'Button';

// ---- tooltip ----

export const Tooltip: FC<TooltipPrimitive.TooltipProps> = props => {
  return (
    <TooltipPrimitive.Provider>
      <TooltipPrimitive.Root {...props} />
    </TooltipPrimitive.Provider>
  );
};
Tooltip.displayName = 'Tooltip';

export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = withDefaults(TooltipPrimitive.Content, {
  sideOffset: 4,
  className: 'aui-tooltip-content',
});

// ---- tooltip icon button ----

export type TooltipIconButtonProps = ButtonProps & {
  tooltip: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
};

export const TooltipIconButton = forwardRef<
  HTMLButtonElement,
  TooltipIconButtonProps
>(({ children, tooltip, side = 'bottom', ...rest }, ref) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" {...rest} ref={ref}>
          {children}
          <span className="aui-sr-only">{tooltip}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side={side}>{tooltip}</TooltipContent>
    </Tooltip>
  );
});
TooltipIconButton.displayName = 'TooltipIconButton';

// ---- avatar ----

export type AvatarProps = {
  src?: string | undefined;
  alt?: string | undefined;
  fallback?: string | undefined;
};

export const AvatarRoot = withDefaults(AvatarPrimitive.Root, {
  className: 'aui-avatar-root',
});

export const AvatarImage = withDefaults(AvatarPrimitive.Image, {
  className: 'aui-avatar-image',
});

export const AvatarFallback = withDefaults(AvatarPrimitive.Fallback, {
  className: 'aui-avatar-fallback',
});

export const Avatar: FC<AvatarProps> = ({ src, alt, fallback }) => {
  if (src == null && fallback == null) return null;
  return (
    <AvatarRoot>
      {src != null && <AvatarImage src={src} alt={alt} />}
      {fallback != null && <AvatarFallback>{fallback}</AvatarFallback>}
    </AvatarRoot>
  );
};
Avatar.displayName = 'Avatar';

// ---- dialog ----

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogTitle = DialogPrimitive.Title;

const DialogOverlay = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={classNames('aui-dialog-overlay', className)}
    {...props}
  />
));
DialogOverlay.displayName = 'DialogOverlay';

export const DialogContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={classNames('aui-dialog-content', className)}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

// ---- stop icon ----

export const CircleStopIcon: FC<PropsWithChildren> = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      width="16"
      height="16"
    >
      <rect width="10" height="10" x="3" y="3" rx="2" />
    </svg>
  );
};
CircleStopIcon.displayName = 'CircleStopIcon';
