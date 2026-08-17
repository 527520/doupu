// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ClientReadyMarker from './ClientReadyMarker';

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.doupuHydrated;
});

describe('ClientReadyMarker', () => {
  it('marks the document only after the client effect has run', async () => {
    render(<ClientReadyMarker />);
    await waitFor(() => expect(document.documentElement.dataset.doupuHydrated).toBe('true'));
  });
});
