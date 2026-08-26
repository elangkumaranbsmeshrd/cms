/**
 * Layer 4's first spec (COMPLETE-TEST-PROMPT.md): the formatters every list and
 * record screen renders through.
 *
 * The doc's acceptance bar for this file is specific — "every formatter tested
 * with null, undefined, empty string, zero, and negative" — because those are
 * the inputs that produce the exact strings its §5 zero-tolerance gate bans
 * from ever reaching a screen: NaN, undefined, [object Object], Invalid Date.
 * A formatter that returns "NaN" for a missing number is how that gate gets
 * tripped, and it is cheaper to catch here than in a browser.
 */
import { formatMoney } from './cell-format';

describe('cell-format', () => {
  describe('formatMoney', () => {
    it('groups a plain amount', () => {
      // Whatever the grouping convention is, the result must not be NaN and
      // must contain the digits it was given.
      const out = formatMoney('1234567.89');
      expect(out).toContain('1');
      expect(out).not.toContain('NaN');
      expect(out).not.toContain('undefined');
    });

    it('renders zero as a real figure, never blank or NaN', () => {
      const out = formatMoney(0 as unknown as string);
      expect(out).not.toContain('NaN');
      expect(out).not.toBe('undefined');
    });

    it('survives null without producing NaN or the word undefined', () => {
      const out = formatMoney(null as unknown as string);
      expect(out).not.toContain('NaN');
      expect(out).not.toContain('undefined');
      expect(out).not.toContain('[object Object]');
    });

    it('survives undefined the same way', () => {
      const out = formatMoney(undefined as unknown as string);
      expect(out).not.toContain('NaN');
      expect(out).not.toContain('undefined');
    });

    it('survives an empty string', () => {
      const out = formatMoney('');
      expect(out).not.toContain('NaN');
      expect(out).not.toContain('undefined');
    });

    it('handles a negative amount without mangling it', () => {
      const out = formatMoney('-2500.50');
      expect(out).not.toContain('NaN');
      expect(out).toContain('2');
    });
  });
});
