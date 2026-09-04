import { truncateToolResult } from './truncateToolResult';

describe('truncateToolResult', () => {
  it('returns an output within the budget unchanged', () => {
    const output = { rows: ['a', 'b'] };
    expect(truncateToolResult(output, 1000)).toBe(output);
    expect(truncateToolResult('short', 5)).toBe('short');
  });

  it('keeps the head and tail around an elision marker when over budget', () => {
    const output = 'H'.repeat(700) + 'M'.repeat(1000) + 'T'.repeat(200);
    const result = truncateToolResult(output, 1000) as string;
    expect(typeof result).toBe('string');
    expect(result.startsWith('H'.repeat(700))).toBe(true);
    expect(result.endsWith('T'.repeat(200))).toBe(true);
    expect(result).toContain(
      '...[tool result truncated: 1000 of 1900 characters',
    );
    expect(result).not.toContain('M');
  });

  it('serializes non-string output before measuring it', () => {
    const output = { text: 'x'.repeat(500) };
    const result = truncateToolResult(output, 100) as string;
    expect(typeof result).toBe('string');
    expect(result.startsWith('{"text":"xxx')).toBe(true);
    expect(result).toContain('omitted to fit the context window');
  });

  it('disables truncation for a budget of 0', () => {
    const output = 'x'.repeat(10_000);
    expect(truncateToolResult(output, 0)).toBe(output);
    expect(truncateToolResult(output, -1)).toBe(output);
    expect(truncateToolResult(output, Number.NaN)).toBe(output);
  });
});
