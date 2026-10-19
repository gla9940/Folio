import { describe, expect, it, vi } from 'vitest';
import { diagnoseGeminiFailure } from './geminiDiagnostics';
const metrics = { paragraphCount: 31, targetCharacters: 3927, contextCharacters: 700, schemaBytes: 223, requestBytes: 9000 };
describe('safe Gemini diagnostics', () => {
  it('uses only allowlisted categories for known provider errors and never echoes unknown messages', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const [message, reason] of [
        ['Unknown name response_json_schema', 'unsupported_parameter'],
        ['API key not valid. PRIVATE-CREDENTIAL', 'credentials'],
        ['Input token limit exceeded. PRIVATE-SOURCE', 'input_size'],
        ['Free tier is not available in your country', 'billing_or_region'],
        ['UNEXPECTED PRIVATE-SOURCE PRIVATE-CREDENTIAL', 'invalid_argument'],
      ]) {
        const result = await diagnoseGeminiFailure(new Response(JSON.stringify({ error: { status: 'INJECTED-STATUS-PRIVATE', message } }), { status: 400 }), metrics, 5);
        expect(result.reason).toBe(reason);
        expect(result.message).not.toMatch(/PRIVATE|INJECTED/);
      }
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|INJECTED/);
      for (const [line] of log.mock.calls) expect(JSON.parse(line).apiStatus).toBe('UNKNOWN');
    } finally { log.mockRestore(); }
  });
  it('bounds provider error reads and tolerates HTML/non-JSON errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const body of ['private-content'.repeat(2000), '<html>private-content</html>']) {
        expect((await diagnoseGeminiFailure(new Response(body, { status: 400 }), metrics, 3)).reason).toBe('invalid_argument');
      }
      expect(JSON.stringify(log.mock.calls)).not.toContain('private-content');
    } finally { log.mockRestore(); }
  });
});
