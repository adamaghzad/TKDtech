import { describe, expect, it } from 'vitest';
import { formatTime, isRoundClosingSeconds } from '../../apps/web/lib/utils';

describe('authoritative timer formatting & final-10s red state', () => {
  it('keeps the existing minute/second display at 10 seconds and above', () => {
    expect(formatTime(120000)).toBe('2:00');
    expect(formatTime(60000)).toBe('1:00');
    expect(formatTime(10001)).toBe('0:11');
    expect(formatTime(10000)).toBe('0:10');
  });

  it('shows seconds and hundredths without a minute prefix below 10 seconds', () => {
    expect(formatTime(9999)).toBe('9.99');
    expect(formatTime(9850)).toBe('9.85');
    expect(formatTime(9500)).toBe('9.50');
    expect(formatTime(5050)).toBe('5.05');
    expect(formatTime(1000)).toBe('1.00');
    expect(formatTime(999)).toBe('0.99');
    expect(formatTime(10)).toBe('0.01');
    expect(formatTime(9)).toBe('0.00');
    expect(formatTime(0)).toBe('0.00');
    expect(formatTime(-1)).toBe('0.00');
  });

  it('switches round and golden-point timers from yellow to red at 10.00 seconds and below', () => {
    expect(isRoundClosingSeconds('ROUND', 10001)).toBe(false);
    expect(isRoundClosingSeconds('ROUND', 10000)).toBe(true);
    expect(isRoundClosingSeconds('ROUND', 6510)).toBe(true);
    expect(isRoundClosingSeconds('ROUND', 0)).toBe(true);
    expect(isRoundClosingSeconds('GOLDEN_POINT', 10000)).toBe(true);
    expect(isRoundClosingSeconds('GOLDEN_POINT', 12000)).toBe(false);
    // Rest and medical timers remain yellow
    expect(isRoundClosingSeconds('BREAK', 6000)).toBe(false);
    expect(isRoundClosingSeconds('MEDICAL', 5000)).toBe(false);
  });
});
