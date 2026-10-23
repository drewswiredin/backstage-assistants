import { render, screen, waitFor } from '@testing-library/react';
import { WritePreview } from './WritePreview';

const previewApproval = jest.fn();
jest.mock('../toolGuards', () => ({
  useToolGuards: () => ({ previewApproval }),
}));

const preview = {
  type: 'file' as const,
  fields: {
    repo: '{owner}/{repo}',
    branch: 'branch',
    path: 'path',
    content: 'content',
    message: 'message',
  },
  diff: true,
};
const input = {
  owner: 'acme',
  repo: 'pylon',
  branch: 'backstage-assistant/scale',
  path: 'deploy.yaml',
  content: 'replicas: 2\n',
  message: 'Scale to two replicas',
};

// Room for the lazy-loaded diff viewer's first import under a full run.
jest.setTimeout(20_000);

beforeEach(() => previewApproval.mockReset());

describe('WritePreview', () => {
  it('shows the target, the message, and a diff against the current content', async () => {
    previewApproval.mockResolvedValue({
      files: [{ path: 'deploy.yaml', exists: true, content: 'replicas: 1\n' }],
    });
    const { container } = render(
      <WritePreview
        preview={preview}
        toolName="github__create_or_update_file"
        assistantId="ops"
        input={input}
      />,
    );
    expect(
      screen.getByText('acme/pylon · backstage-assistant/scale · deploy.yaml'),
    ).toBeTruthy();
    expect(screen.getByText('Scale to two replicas')).toBeTruthy();
    // Changed lines are split into word-level spans, so match the text. The
    // viewer is lazy-loaded, which can take a few seconds in a busy test run.
    await waitFor(
      () => {
        expect(container.textContent).toContain('replicas: 1');
        expect(container.textContent).toContain('replicas: 2');
      },
      { timeout: 10_000 },
    );
    expect(previewApproval).toHaveBeenCalledWith(
      'ops',
      'github__create_or_update_file',
      input,
    );
  });

  it('marks a file the write creates', async () => {
    previewApproval.mockResolvedValue({
      files: [{ path: 'deploy.yaml', exists: false }],
    });
    render(
      <WritePreview
        preview={preview}
        toolName="github__create_or_update_file"
        assistantId="ops"
        input={input}
      />,
    );
    expect(await screen.findByText('New file')).toBeTruthy();
  });

  it('shows the new content alone when the server has no read tool', async () => {
    render(
      <WritePreview
        preview={{ ...preview, diff: false }}
        toolName="github__create_or_update_file"
        assistantId="ops"
        input={input}
      />,
    );
    expect(
      await screen.findByText('replicas: 2', undefined, { timeout: 10_000 }),
    ).toBeTruthy();
    await waitFor(() => expect(previewApproval).not.toHaveBeenCalled());
  });
});
