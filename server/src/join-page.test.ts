import { describe, it, expect } from 'vitest';
import { renderJoinPage } from './join-page.js';

describe('renderJoinPage', () => {
  it('renders HTML with the conversation LAN url and a base64 QR image', async () => {
    const html = await renderJoinPage(4000);
    expect(html).toContain(':4000/conversation');
    expect(html).toContain('/conversation');
    expect(html).toMatch(/<img[^>]*src="data:image\/png;base64,/);
  });

  it('uses the port passed in', async () => {
    const html = await renderJoinPage(1234);
    expect(html).toContain(':1234/conversation');
  });
});
