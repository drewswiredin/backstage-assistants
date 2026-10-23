import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AssignList, type AssignOption } from './AssignList';

const all: AssignOption[] = Array.from({ length: 30 }, (_, i) => ({
  id: `tool-${i}`,
  label: `tool-${i}`,
  group: i < 15 ? 'a' : 'b',
}));

function Harness() {
  const [assigned, setAssigned] = useState<string[]>([]);
  return (
    <AssignList
      rows={assigned.map(id => ({ id, label: id }))}
      options={all.filter(o => !assigned.includes(o.id))}
      onAdd={id => setAssigned(a => [...a, id])}
      onRemove={id => setAssigned(a => a.filter(x => x !== id))}
      addLabel="Add tool"
      grouped
    />
  );
}

describe('AssignList picker', () => {
  it('keeps the same open list after an add, so its scroll position holds', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add tool' }));
    const listbox = screen.getByRole('listbox');
    listbox.scrollTop = 400;

    fireEvent.click(screen.getByText('tool-20'));

    expect(screen.getByRole('listbox')).toBe(listbox);
    expect(listbox.scrollTop).toBe(400);
    expect(screen.queryByRole('option', { name: 'tool-20' })).toBeNull();
    expect(screen.getByRole('option', { name: 'tool-21' })).toBeTruthy();
  });

  it('keeps the search after an add, ready for the next match', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add tool' }));
    const input = screen.getByPlaceholderText('Search…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'tool-1' } });

    fireEvent.click(screen.getByText('tool-12'));

    expect(input.value).toBe('tool-1');
    expect(screen.getByRole('option', { name: 'tool-13' })).toBeTruthy();
  });
});
