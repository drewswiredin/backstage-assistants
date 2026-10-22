import {
  clampPanelWidth,
  DEFAULT_PANEL_WIDTH,
  loadPanelThread,
  loadPanelWidth,
  MIN_PANEL_WIDTH,
  savePanelThread,
  savePanelWidth,
} from './panelStorage';

describe('panelStorage', () => {
  beforeEach(() => localStorage.clear());

  it('remembers and forgets the panel conversation', () => {
    expect(loadPanelThread()).toBeUndefined();
    savePanelThread('t-1');
    expect(loadPanelThread()).toBe('t-1');
    savePanelThread(undefined);
    expect(loadPanelThread()).toBeUndefined();
  });

  it('defaults the width and clamps it to the viewport', () => {
    expect(loadPanelWidth(1400)).toBe(DEFAULT_PANEL_WIDTH);
    savePanelWidth(900);
    expect(loadPanelWidth(1400)).toBe(700);
    savePanelWidth(10);
    expect(loadPanelWidth(1400)).toBe(MIN_PANEL_WIDTH);
  });

  it('never exceeds half the viewport, nor drops below the minimum', () => {
    expect(clampPanelWidth(500, 800)).toBe(400);
    expect(clampPanelWidth(500, 500)).toBe(MIN_PANEL_WIDTH);
    expect(clampPanelWidth(Number.NaN, 2000)).toBe(DEFAULT_PANEL_WIDTH);
  });
});
