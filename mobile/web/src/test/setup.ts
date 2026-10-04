import '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest runs with globals:false, so RTL's auto-cleanup never registers —
// unmount each render between tests or later getByText queries see duplicates.
afterEach(cleanup);

// jsdom does not implement scrollIntoView; stub it so components that
// auto-scroll (e.g. RiverTranscript) can mount in tests.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
