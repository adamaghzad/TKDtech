import { describe, expect, it } from 'vitest';
import {
  OPERATOR_ACTIONS,
  assignKeybind,
  defaultKeybindMap,
  formatKeyToken,
  isEditableTarget,
  normalizeKeyboardToken,
  resolveOperatorAction,
} from '../../apps/web/features/scoreboard/operator-keybinds';

describe('operator scoreboard keybinds', () => {
  it('assigns unique default primary keys to every operator action', () => {
    const defaults = defaultKeybindMap();
    const tokens = OPERATOR_ACTIONS.map((a) => defaults[a.id]);
    expect(new Set(tokens).size).toBe(OPERATOR_ACTIONS.length);
  });

  it('normalizes Space, QWERTY digits, French AZERTY unshifted digits, and printed letters cleanly', () => {
    const bindings = defaultKeybindMap();

    // Space toggles start / pause / resume
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: ' ', code: 'Space' }), bindings)).toBe('TOGGLE_CLOCK');

    // French AZERTY top row without Shift sends key='&' / 'é' / '"' / "'" / '-' with code='Digit1'..'Digit6'
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: '&', code: 'Digit1' }), bindings)).toBe('BLUE_PUNCH');
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: 'é', code: 'Digit2' }), bindings)).toBe('BLUE_BODY_KICK');
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: '"', code: 'Digit3' }), bindings)).toBe('BLUE_HEAD_KICK');
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: "'", code: 'Digit4' }), bindings)).toBe('BLUE_TURNING_BODY');
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: '-', code: 'Digit6' }), bindings)).toBe('BLUE_TURNING_HEAD');

    // French AZERTY printed letters M (Semicolon) and Z (KeyW) match the physical keycap label
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: 'm', code: 'Semicolon' }), bindings)).toBe('MEDICAL_TIMEOUT');
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: 'z', code: 'KeyW' }), bindings)).toBe('UNDO');
  });

  it('supports Numpad aliases for Red scoring and Backspace for Undo', () => {
    const bindings = defaultKeybindMap();
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: '1', code: 'Numpad1' }), bindings)).toBe('RED_PUNCH');
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: '2', code: 'Numpad2' }), bindings)).toBe('RED_BODY_KICK');
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: '3', code: 'Numpad3' }), bindings)).toBe('RED_HEAD_KICK');
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: '4', code: 'Numpad4' }), bindings)).toBe('RED_TURNING_BODY');
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: '6', code: 'Numpad6' }), bindings)).toBe('RED_TURNING_HEAD');
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: '0', code: 'Numpad0' }), bindings)).toBe('RED_TECHNICAL');
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: '.', code: 'NumpadDecimal' }), bindings)).toBe('RED_GAM_JEOM');
    expect(resolveOperatorAction(normalizeKeyboardToken({ key: 'Backspace', code: 'Backspace' }), bindings)).toBe('UNDO');
  });

  it('ignores modifier shortcuts and editable form fields', () => {
    expect(normalizeKeyboardToken({ key: 'r', code: 'KeyR', ctrlKey: true })).toBeNull();
    expect(normalizeKeyboardToken({ key: 'r', code: 'KeyR', metaKey: true })).toBeNull();
    expect(normalizeKeyboardToken({ key: '1', code: 'Digit1', altKey: true })).toBeNull();
    expect(normalizeKeyboardToken({ key: '?', code: 'Slash', shiftKey: true })).toBe('Help:?');

    expect(isEditableTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
  });

  it('swaps conflicting bindings cleanly when customizing keys and formats readable keycaps', () => {
    const initial = defaultKeybindMap();
    const updated = assignKeybind(initial, 'MEDICAL_TIMEOUT', 'Space');
    expect(updated.MEDICAL_TIMEOUT).toBe('Space');
    expect(updated.TOGGLE_CLOCK).toBe('Key:M');
    expect(new Set(Object.values(updated)).size).toBe(OPERATOR_ACTIONS.length);

    expect(formatKeyToken('Space')).toBe('Space');
    expect(formatKeyToken('Digit3')).toBe('3');
    expect(formatKeyToken('Key:U')).toBe('U');
    expect(formatKeyToken('Numpad6')).toBe('Num6');
    expect(formatKeyToken('Backspace')).toBe('⌫');
  });
});
