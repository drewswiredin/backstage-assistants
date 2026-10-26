import { act, render } from '@testing-library/react';
import { Dialog } from '@material-ui/core';
import { ThemeProvider, createTheme } from '@material-ui/core/styles';
import { withFreeFocus } from './AssistantsPanel';

// A field outside an open MUI dialog, like the panel's composer beside the
// pod view: MUI's focus trap pulls focus back unless the theme turns it off.
function focusOutsideDialog(free: boolean) {
  jest.useFakeTimers();
  const base = createTheme();
  render(
    <ThemeProvider theme={base}>
      <ThemeProvider theme={free ? withFreeFocus : base}>
        <input aria-label="composer" />
        <Dialog open>
          <button>in dialog</button>
        </Dialog>
      </ThemeProvider>
    </ThemeProvider>,
  );
  const composer = document.querySelector('input') as HTMLInputElement;
  act(() => {
    composer.focus();
    jest.advanceTimersByTime(200);
  });
  const kept = document.activeElement === composer;
  jest.useRealTimers();
  return kept;
}

describe('withFreeFocus', () => {
  it('lets focus stay outside an open MUI dialog', () => {
    expect(focusOutsideDialog(true)).toBe(true);
  });

  it('is what stops the trap (without it, the dialog takes focus back)', () => {
    expect(focusOutsideDialog(false)).toBe(false);
  });
});
