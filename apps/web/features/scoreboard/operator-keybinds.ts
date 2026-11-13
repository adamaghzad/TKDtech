export type OperatorActionId =
  | 'TOGGLE_CLOCK'
  | 'NEXT_ROUND'
  | 'MEDICAL_TIMEOUT'
  | 'RESET_TIMER'
  | 'PREVIOUS_ROUND'
  | 'BLUE_PUNCH'
  | 'BLUE_BODY_KICK'
  | 'BLUE_HEAD_KICK'
  | 'BLUE_TURNING_BODY'
  | 'BLUE_TURNING_HEAD'
  | 'BLUE_TECHNICAL'
  | 'BLUE_GAM_JEOM'
  | 'BLUE_CANCEL_SCORE_GAM_JEOM'
  | 'RED_PUNCH'
  | 'RED_BODY_KICK'
  | 'RED_HEAD_KICK'
  | 'RED_TURNING_BODY'
  | 'RED_TURNING_HEAD'
  | 'RED_TECHNICAL'
  | 'RED_GAM_JEOM'
  | 'RED_CANCEL_SCORE_GAM_JEOM'
  | 'VIDEO_REVIEW_BLUE'
  | 'VIDEO_REVIEW_RED'
  | 'TOGGLE_POINT_MODE'
  | 'UNDO'
  | 'COMPLETE_MATCH'
  | 'SUPERIORITY_BLUE'
  | 'SUPERIORITY_RED'
  | 'MANUAL_HORN'
  | 'TOGGLE_TV_WAITING'
  | 'TOGGLE_SOUND'
  | 'OPEN_PAIRING';

export type OperatorKeybindGroup = 'TIME' | 'BLUE' | 'RED' | 'CONTROL';

export interface OperatorActionMeta {
  id: OperatorActionId;
  group: OperatorKeybindGroup;
  label: string;
  description: string;
  defaultKey: string;
  secondaryKeys?: readonly string[];
}

export const OPERATOR_ACTIONS: readonly OperatorActionMeta[] = [
  // Time & Round Control
  { id: 'TOGGLE_CLOCK', group: 'TIME', label: 'Start / Pause / Resume', description: 'Starts match, pauses running clock, or resumes rest/round', defaultKey: 'Space' },
  { id: 'NEXT_ROUND', group: 'TIME', label: 'End Round & Rest / Next Round', description: 'Ends paused round into rest or starts the next round', defaultKey: 'Key:N' },
  { id: 'MEDICAL_TIMEOUT', group: 'TIME', label: 'Medical / Doctor Call', description: 'Starts or ends medical timeout clock', defaultKey: 'Key:M' },
  { id: 'RESET_TIMER', group: 'TIME', label: 'Reset Timer', description: 'Opens audited timer reset dialog (when paused)', defaultKey: 'Key:R' },
  { id: 'PREVIOUS_ROUND', group: 'TIME', label: 'Previous Round', description: 'Opens audited previous-round correction dialog', defaultKey: 'Key:B' },

  // Chung / Blue Scoring (Left hand — Digit codes work on both QWERTY & French AZERTY without Shift)
  { id: 'BLUE_PUNCH', group: 'BLUE', label: 'Blue +1 Punch', description: 'Awards +1 punch to Chung (or Undo in - mode)', defaultKey: 'Digit1' },
  { id: 'BLUE_BODY_KICK', group: 'BLUE', label: 'Blue +2 Body Kick', description: 'Awards +2 body kick to Chung', defaultKey: 'Digit2' },
  { id: 'BLUE_HEAD_KICK', group: 'BLUE', label: 'Blue +3 Head Kick', description: 'Awards +3 head kick to Chung', defaultKey: 'Digit3' },
  { id: 'BLUE_TURNING_BODY', group: 'BLUE', label: 'Blue +4 Turning Body', description: 'Awards +4 turning body kick to Chung', defaultKey: 'Digit4' },
  { id: 'BLUE_TURNING_HEAD', group: 'BLUE', label: 'Blue +6 Turning Head', description: 'Awards +6 turning head kick to Chung', defaultKey: 'Digit6' },
  { id: 'BLUE_TECHNICAL', group: 'BLUE', label: 'Blue +1 Technical', description: 'Awards +1 technical point to Chung', defaultKey: 'Key:T' },
  { id: 'BLUE_GAM_JEOM', group: 'BLUE', label: 'Blue Gam-Jeom', description: 'Gives Gam-Jeom penalty to Chung (+1 opponent; 5 in round = PUN)', defaultKey: 'Key:G' },
  { id: 'BLUE_CANCEL_SCORE_GAM_JEOM', group: 'BLUE', label: 'Blue Annuler Pt + Gam-Jeom', description: 'Cancels Chung last point in round + gives Gam-Jeom (+1 Hong)', defaultKey: 'Key:F' },

  // Hong / Red Scoring (Right hand + Numpad secondary keys)
  { id: 'RED_PUNCH', group: 'RED', label: 'Red +1 Punch', description: 'Awards +1 punch to Hong (also Numpad 1)', defaultKey: 'Key:U', secondaryKeys: ['Numpad1'] },
  { id: 'RED_BODY_KICK', group: 'RED', label: 'Red +2 Body Kick', description: 'Awards +2 body kick to Hong (also Numpad 2)', defaultKey: 'Key:I', secondaryKeys: ['Numpad2'] },
  { id: 'RED_HEAD_KICK', group: 'RED', label: 'Red +3 Head Kick', description: 'Awards +3 head kick to Hong (also Numpad 3)', defaultKey: 'Key:O', secondaryKeys: ['Numpad3'] },
  { id: 'RED_TURNING_BODY', group: 'RED', label: 'Red +4 Turning Body', description: 'Awards +4 turning body kick to Hong (also Numpad 4)', defaultKey: 'Key:P', secondaryKeys: ['Numpad4'] },
  { id: 'RED_TURNING_HEAD', group: 'RED', label: 'Red +6 Turning Head', description: 'Awards +6 turning head kick to Hong (also Numpad 6)', defaultKey: 'Key:L', secondaryKeys: ['Numpad6'] },
  { id: 'RED_TECHNICAL', group: 'RED', label: 'Red +1 Technical', description: 'Awards +1 technical point to Hong (also Numpad 0)', defaultKey: 'Key:Y', secondaryKeys: ['Numpad0'] },
  { id: 'RED_GAM_JEOM', group: 'RED', label: 'Red Gam-Jeom', description: 'Gives Gam-Jeom penalty to Hong (+1 opponent; 5 in round = PUN)', defaultKey: 'Key:H', secondaryKeys: ['NumpadDecimal'] },
  { id: 'RED_CANCEL_SCORE_GAM_JEOM', group: 'RED', label: 'Red Annuler Pt + Gam-Jeom', description: 'Cancels Hong last point in round + gives Gam-Jeom (+1 Chung)', defaultKey: 'Key:J', secondaryKeys: ['NumpadSubtract'] },

  // Video Replay, Corrections, Completion & Utilities
  { id: 'VIDEO_REVIEW_BLUE', group: 'CONTROL', label: 'IVR — Chung / Blue', description: 'Requests Instant Video Replay for Blue & pauses timer', defaultKey: 'Key:V' },
  { id: 'VIDEO_REVIEW_RED', group: 'CONTROL', label: 'IVR — Hong / Red', description: 'Requests Instant Video Replay for Red & pauses timer', defaultKey: 'Key:K' },
  { id: 'TOGGLE_POINT_MODE', group: 'CONTROL', label: 'Switch + Add / - Remove', description: 'Toggles point buttons between Add (+) and Cancel (-)', defaultKey: 'Key:X' },
  { id: 'UNDO', group: 'CONTROL', label: 'Undo / Cancel Last Score', description: 'Opens audited score correction dialog (also Backspace)', defaultKey: 'Key:Z', secondaryKeys: ['Backspace'] },
  { id: 'COMPLETE_MATCH', group: 'CONTROL', label: 'Complete Match', description: 'Opens winner validation & match completion dialog', defaultKey: 'Key:C' },
  { id: 'SUPERIORITY_BLUE', group: 'CONTROL', label: 'Blue Superiority Win', description: 'Records Blue superiority win when a round ends tied', defaultKey: 'F1' },
  { id: 'SUPERIORITY_RED', group: 'CONTROL', label: 'Red Superiority Win', description: 'Records Red superiority win when a round ends tied', defaultKey: 'F2' },
  { id: 'MANUAL_HORN', group: 'CONTROL', label: 'Manual Arena Horn', description: 'Blasts the stadium air-horn on demand', defaultKey: 'F8' },
  { id: 'TOGGLE_TV_WAITING', group: 'CONTROL', label: 'Public TV Waiting Screen', description: 'Switches Public TV between Waiting screen and Scoreboard / Result', defaultKey: 'Key:W' },
  { id: 'TOGGLE_SOUND', group: 'CONTROL', label: 'Toggle Match Sound', description: 'Mutes or enables scoreboard horn & countdown audio', defaultKey: 'Key:S' },
  { id: 'OPEN_PAIRING', group: 'CONTROL', label: 'Pair Devices (QR)', description: 'Opens judge & referee QR pairing modal', defaultKey: 'Key:D' },
] as const;

export type OperatorKeybindMap = Record<OperatorActionId, string>;

export interface OperatorKeybindPreferences {
  enabled: boolean;
  bindings: OperatorKeybindMap;
}

export const KEYBIND_STORAGE_KEY = 'tkd.operatorKeybinds.v1';

export function defaultKeybindMap(): OperatorKeybindMap {
  const map = {} as OperatorKeybindMap;
  for (const action of OPERATOR_ACTIONS) {
    map[action.id] = action.defaultKey;
  }
  return map;
}

const CODE_TOKENS = new Set([
  'Space',
  'Backspace',
  'Tab',
  'Enter',
  'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
  'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9',
  'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadEnter',
  'F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9', 'F10',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

export interface MinimalKeyboardEvent {
  key: string;
  code: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
}

/**
 * Normalizes a DOM KeyboardEvent into a layout-resilient token:
 * - Physical top-row digits (`Digit0`..`Digit9`), Numpad keys, `Space`, `Backspace`, Function keys, and Arrows
 *   use `event.code` so French AZERTY and English QWERTY laptops both trigger `1 2 3 4 6` without holding Shift.
 * - Printable letters (`A`..`Z`) use `Key:<UPPER>` based on `event.key` so `M`, `Z`, `A`, `Q`, etc. match the
 *   letter printed on the operator's physical keycaps regardless of QWERTY vs AZERTY layout.
 */
export function normalizeKeyboardToken(event: MinimalKeyboardEvent): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === '?' || (event.shiftKey && event.code === 'Slash')) return 'Help:?';
  if (CODE_TOKENS.has(event.code)) return event.code;
  if (event.key && event.key.length === 1) {
    const upper = event.key.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') return `Key:${upper}`;
    if (upper >= '0' && upper <= '9') return `Digit${upper}`;
  }
  return null;
}

export function formatKeyToken(token: string | undefined): string {
  if (!token) return '—';
  if (token === 'Space') return 'Space';
  if (token === 'Backspace') return '⌫';
  if (token.startsWith('Key:')) return token.slice(4);
  if (token.startsWith('Digit')) return token.slice(5);
  if (token.startsWith('Numpad')) {
    const rest = token.slice(6);
    const symbols: Record<string, string> = {
      Add: 'Num+',
      Subtract: 'Num-',
      Multiply: 'Num*',
      Divide: 'Num/',
      Decimal: 'Num.',
      Enter: 'Num↵',
    };
    return symbols[rest] ?? `Num${rest}`;
  }
  const arrows: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  return arrows[token] ?? token;
}

export function resolveOperatorAction(
  token: string | null,
  bindings: OperatorKeybindMap,
): OperatorActionId | null {
  if (!token) return null;
  for (const action of OPERATOR_ACTIONS) {
    if (bindings[action.id] === token) return action.id;
  }
  for (const action of OPERATOR_ACTIONS) {
    if (action.secondaryKeys?.includes(token)) return action.id;
  }
  return null;
}

/**
 * Assigns `newToken` to `targetAction`. If another action already uses `newToken`,
 * swaps that other action onto `targetAction`'s previous key so bindings stay conflict-free.
 */
export function assignKeybind(
  bindings: OperatorKeybindMap,
  targetAction: OperatorActionId,
  newToken: string,
): OperatorKeybindMap {
  const next: OperatorKeybindMap = { ...bindings };
  const previousToken = next[targetAction];
  for (const action of OPERATOR_ACTIONS) {
    if (action.id !== targetAction && next[action.id] === newToken) {
      next[action.id] = previousToken;
    }
  }
  next[targetAction] = newToken;
  return next;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: string; isContentEditable?: boolean; closest?: (selector: string) => unknown };
  const tag = el.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (typeof el.closest === 'function' && el.closest('[contenteditable="true"]')) return true;
  return false;
}

export function loadKeybindPreferences(): OperatorKeybindPreferences {
  const defaults = defaultKeybindMap();
  if (typeof window === 'undefined') return { enabled: true, bindings: defaults };
  try {
    const raw = window.localStorage.getItem(KEYBIND_STORAGE_KEY);
    if (!raw) return { enabled: true, bindings: defaults };
    const parsed = JSON.parse(raw) as Partial<OperatorKeybindPreferences>;
    const merged: OperatorKeybindMap = { ...defaults };
    if (parsed.bindings && typeof parsed.bindings === 'object') {
      for (const action of OPERATOR_ACTIONS) {
        const candidate = parsed.bindings[action.id];
        if (typeof candidate === 'string' && candidate.length > 0) {
          merged[action.id] = candidate;
        }
      }
    }
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      bindings: merged,
    };
  } catch {
    return { enabled: true, bindings: defaults };
  }
}

export function saveKeybindPreferences(prefs: OperatorKeybindPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEYBIND_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota / privacy errors in kiosk browsers
  }
}
