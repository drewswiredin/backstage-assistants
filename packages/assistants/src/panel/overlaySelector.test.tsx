import { render } from '@testing-library/react';
import { Dialog, Drawer } from '@material-ui/core';
import { ThemeProvider, createTheme } from '@material-ui/core/styles';
import { OVERLAY_SELECTOR, withFreeFocus } from './AssistantsPanel';

// Under the panel's nested theme MUI suffixes its class names
// (`MuiDrawer-modal-12`), so exact class selectors miss the Kubernetes
// plugin's pod drawer and it opens over the panel.
describe('OVERLAY_SELECTOR', () => {
  it.each([
    ['right-hand drawer', <Drawer anchor="right" open />],
    ['dialog', <Dialog open />],
  ])('matches a %s under the panel theme', (_, overlay) => {
    render(
      <ThemeProvider theme={createTheme()}>
        <ThemeProvider theme={withFreeFocus}>{overlay}</ThemeProvider>
      </ThemeProvider>,
    );
    const root = document.querySelector('[role="presentation"]');
    expect(root?.matches(OVERLAY_SELECTOR)).toBe(true);
  });
});
