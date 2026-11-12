'use client';

import { useEffect, useState } from 'react';
import { Keyboard, Power, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  OPERATOR_ACTIONS,
  assignKeybind,
  defaultKeybindMap,
  formatKeyToken,
  normalizeKeyboardToken,
  type OperatorActionId,
  type OperatorKeybindGroup,
  type OperatorKeybindPreferences,
} from './operator-keybinds';

export function Keycap({
  token,
  enabled = true,
  className,
}: {
  token: string | undefined;
  enabled?: boolean;
  className?: string;
}) {
  if (!enabled || !token) return null;
  return (
    <kbd
      aria-hidden="true"
      className={cn(
        'pointer-events-none inline-flex min-w-5 items-center justify-center rounded border border-white/25 bg-black/35 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none tracking-tight text-white/90 shadow-inner',
        className,
      )}
    >
      {formatKeyToken(token)}
    </kbd>
  );
}

const GROUP_TITLES: Record<OperatorKeybindGroup, { title: string; subtitle: string; accent: string }> = {
  TIME: {
    title: 'Time & Round Control',
    subtitle: 'Instant clock start, stop/pause, resume, next round & medical timeout',
    accent: 'border-primary/35 bg-primary/5',
  },
  BLUE: {
    title: 'Chung · Blue Scoring (Left Hand)',
    subtitle: 'Top number row works on both QWERTY and French AZERTY without Shift',
    accent: 'border-blue/40 bg-blue/10',
  },
  RED: {
    title: 'Hong · Red Scoring (Right Hand + Numpad)',
    subtitle: 'Right-hand keys plus automatic Numpad 1/2/3/4/6/0/. aliases',
    accent: 'border-red/40 bg-red/10',
  },
  CONTROL: {
    title: 'Video Replay, Corrections & Match Control',
    subtitle: 'IVR requests, +/- mode switch, audited undo, superiority & match completion',
    accent: 'border-line bg-white/[.03]',
  },
};

export function KeybindSettingsDialog({
  open,
  onOpenChange,
  preferences,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preferences: OperatorKeybindPreferences;
  onChange: (next: OperatorKeybindPreferences) => void;
}) {
  const [listeningFor, setListeningFor] = useState<OperatorActionId | null>(null);

  useEffect(() => {
    if (!open || !listeningFor) return;
    const handleCapture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setListeningFor(null);
        return;
      }
      const token = normalizeKeyboardToken(event);
      if (!token || token === 'Help:?') return;
      onChange({
        ...preferences,
        bindings: assignKeybind(preferences.bindings, listeningFor, token),
      });
      setListeningFor(null);
    };
    window.addEventListener('keydown', handleCapture, true);
    return () => window.removeEventListener('keydown', handleCapture, true);
  }, [open, listeningFor, preferences, onChange]);

  const handleOpenChange = (nextOpen: boolean) => {
    setListeningFor(null);
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-3xl"
        title="Operator Keyboard Shortcuts"
        description="Control every match timer, point, Gam-Jeom, Video Replay, and audited action from the keyboard. Click any key badge below to customize it."
      >
        <div className="space-y-5" data-testid="keybind-settings-dialog">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-background/70 p-3.5">
            <div className="flex items-center gap-3">
              <div className={cn('flex size-9 items-center justify-center rounded-lg', preferences.enabled ? 'bg-success/20 text-success' : 'bg-white/5 text-muted')}>
                <Keyboard className="size-5" />
              </div>
              <div>
                <p className="text-sm font-bold">
                  Keyboard shortcuts are {preferences.enabled ? 'ENABLED' : 'DISABLED'}
                </p>
                <p className="text-xs text-muted">
                  Automatically paused while typing in inputs, audit reason boxes, or modal dialogs.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setListeningFor(null);
                  onChange({ enabled: preferences.enabled, bindings: defaultKeybindMap() });
                }}
              >
                <RotateCcw className="size-3.5" /> Reset defaults
              </Button>
              <Button
                variant={preferences.enabled ? 'success' : 'secondary'}
                size="sm"
                onClick={() => onChange({ ...preferences, enabled: !preferences.enabled })}
              >
                <Power className="size-3.5" /> {preferences.enabled ? 'Enabled' : 'Disabled'}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {(['TIME', 'CONTROL', 'BLUE', 'RED'] as const).map((group) => {
              const meta = GROUP_TITLES[group];
              const items = OPERATOR_ACTIONS.filter((action) => action.group === group);
              return (
                <div key={group} className={cn('rounded-xl border p-3.5', meta.accent)}>
                  <p className="text-xs font-black uppercase tracking-wider">{meta.title}</p>
                  <p className="mt-0.5 text-[10px] leading-4 text-muted">{meta.subtitle}</p>
                  <div className="mt-3 space-y-1.5">
                    {items.map((item) => {
                      const activeToken = preferences.bindings[item.id];
                      const isListening = listeningFor === item.id;
                      return (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-line/60 bg-background/70 px-2.5 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold">{item.label}</p>
                            <p className="truncate text-[10px] text-muted">{item.description}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {item.secondaryKeys?.map((sec) => (
                              <span
                                key={sec}
                                className="rounded border border-white/10 bg-white/5 px-1.5 py-1 font-mono text-[10px] text-muted"
                                title="Built-in secondary key"
                              >
                                {formatKeyToken(sec)}
                              </span>
                            ))}
                            <button
                              type="button"
                              onClick={() => setListeningFor(isListening ? null : item.id)}
                              className={cn(
                                'min-w-14 rounded-md border px-2.5 py-1 font-mono text-xs font-black transition',
                                isListening
                                  ? 'animate-pulse border-timer bg-timer/20 text-timer'
                                  : 'border-white/25 bg-white/10 text-white hover:border-primary hover:bg-primary/20',
                              )}
                              title="Click then press any key to rebind (Esc to cancel)"
                            >
                              {isListening ? 'Press key…' : formatKeyToken(activeToken)}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-line/60 bg-background/50 p-3 text-[11px] leading-5 text-muted">
            <strong className="text-white">Fast dialog tips:</strong> When an audited dialog opens (Undo, Reset Timer, Previous Round, Superiority), the reason field focuses automatically — type your reason and press <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white">Ctrl+Enter</kbd> to confirm immediately, or <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white">Esc</kbd> to cancel. During an active Instant Video Replay panel, press <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white">A</kbd> (Accept), <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white">J</kbd> (Reject), <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white">1/2/3/4/6/G</kbd> (correction), and <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white">Enter</kbd> (Apply).
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
