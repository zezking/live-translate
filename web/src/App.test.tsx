import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
describe('App', () => {
  it('renders the home route text', () => {
    const { getByText } = render(<MemoryRouter><App /></MemoryRouter>);
    expect(getByText('v2 web — route mounted')).toBeTruthy();
  });
  it('/conversation renders the admin password step', () => {
    const { getByText } = render(<MemoryRouter initialEntries={['/conversation']}><App /></MemoryRouter>);
    expect(getByText(/Admin password/i)).toBeTruthy();
  });
});
