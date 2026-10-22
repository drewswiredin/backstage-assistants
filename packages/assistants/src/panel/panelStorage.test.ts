import {
  clampPanelWidth,
  DEFAULT_PANEL_WIDTH,
  loadPanelAssistant,
  loadPanelThread,
  loadPanelWidth,
  MIN_PANEL_WIDTH,
  resolvePanelAssistant,
  savePanelAssistant,
  savePanelThread,
  savePanelWidth,
} from './panelStorage';

const a = { id: 'a' };
const b = { id: 'b' };
const c = { id: 'c' };

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

  it('remembers the picked assistant', () => {
    expect(loadPanelAssistant()).toBeUndefined();
    savePanelAssistant('b');
    expect(loadPanelAssistant()).toBe('b');
    savePanelAssistant(undefined);
    expect(loadPanelAssistant()).toBeUndefined();
  });

  it('opens the pick, else the default, else the first accessible', () => {
    expect(resolvePanelAssistant([a, b, c], 'c', 'b')).toBe(c);
    expect(resolvePanelAssistant([a, b, c], 'gone', 'b')).toBe(b);
    expect(resolvePanelAssistant([a, b, c], undefined, undefined)).toBe(a);
    expect(resolvePanelAssistant([a, b, c], 'gone', 'gone')).toBe(a);
    expect(resolvePanelAssistant([], 'a', 'a')).toBeUndefined();
  });

  it('never exceeds half the viewport, nor drops below the minimum', () => {
    expect(clampPanelWidth(500, 800)).toBe(400);
    expect(clampPanelWidth(500, 500)).toBe(MIN_PANEL_WIDTH);
    expect(clampPanelWidth(Number.NaN, 2000)).toBe(DEFAULT_PANEL_WIDTH);
  });
});
