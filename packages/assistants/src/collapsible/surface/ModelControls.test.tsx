import { render, screen } from '@testing-library/react';
import type {
  ModelId,
  ModelOption,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { ModelControls } from './ModelControls';

const pool: ModelOption[] = [
  {
    id: 'router:anthropic/claude-sonnet-5.5' as ModelId,
    provider: 'router',
    model: 'anthropic/claude-sonnet-5.5',
    reasoning: true,
  },
];

// Report the composer row at a fixed width as soon as it is observed.
function rowWidth(width: number) {
  (globalThis as any).ResizeObserver = class {
    constructor(private readonly callback: () => void) {}
    observe(el: HTMLElement) {
      Object.defineProperty(el, 'clientWidth', { value: width });
      this.callback();
    }
    disconnect() {}
  };
}

function renderControls() {
  render(
    <div>
      <ModelControls
        pool={pool}
        allowed={[pool[0].id]}
        modelId={pool[0].id}
        defaultModel={pool[0].id}
        onModelChange={jest.fn()}
        reasoningLevel="high"
        onReasoningChange={jest.fn()}
      />
    </div>,
  );
}

describe('ModelControls', () => {
  afterEach(() => {
    delete (globalThis as any).ResizeObserver;
  });

  it('names the model and effort in a wide composer', () => {
    rowWidth(600);
    renderControls();
    expect(screen.getByText('claude-sonnet-5.5')).toBeTruthy();
    expect(screen.getByText('Effort: high')).toBeTruthy();
  });

  it('shows icons with the values in tooltips in a narrow composer', () => {
    rowWidth(300);
    renderControls();
    expect(screen.queryByText('claude-sonnet-5.5')).toBeNull();
    expect(screen.queryByText('Effort: high')).toBeNull();
    expect(screen.getByTitle('Model: claude-sonnet-5.5')).toBeTruthy();
    expect(screen.getByTitle('Effort: high')).toBeTruthy();
  });
});
