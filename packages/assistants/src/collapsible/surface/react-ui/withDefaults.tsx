// Vendored from @assistant-ui/react-ui@0.2.1 (upstream is unmaintained; its
// components are designed to be scaffolded into consuming apps). Behavior and
// `aui-*` class names are kept identical so the vendored stylesheets under
// `../styles/` continue to apply.
import { forwardRef, type ComponentPropsWithoutRef, type ComponentType, type ElementType } from 'react';
import classNames from 'classnames';

export const withDefaults = <TComponent extends ElementType>(
  Component: TComponent,
  defaultProps: Partial<ComponentPropsWithoutRef<TComponent>> & {
    className?: string;
  },
) => {
  const { className: defaultClassName, ...restDefaults } = defaultProps;
  const WithDefaults = forwardRef<unknown, ComponentPropsWithoutRef<TComponent>>(
    ({ className, ...props }, ref) => {
      const ComponentAsAny = Component as ComponentType<
        Record<string, unknown>
      >;
      return (
        <ComponentAsAny
          className={classNames(defaultClassName, className)}
          {...restDefaults}
          {...props}
          ref={ref}
        />
      );
    },
  );
  WithDefaults.displayName =
    'withDefaults(' +
    (typeof Component === 'string'
      ? Component
      : ((Component as ComponentType).displayName ?? 'Component')) +
    ')';
  return WithDefaults as unknown as TComponent;
};
