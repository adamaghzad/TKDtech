'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronLeft, CircleStop, Clock3, ExternalLink, History, Keyboard, Minus, Pause, Play, Plus, QrCode, Radio, RotateCcw, ShieldAlert, Stethoscope, Swords, Undo2, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react';
import type { MatchCommand } from '../../../local-server/src/types';
import type { MatchSnapshot, PointType, Side } from '@tkd/contracts';
import { useMatchCloud } from '@/lib/use-match-cloud';
import { useTimerAudio } from '@/lib/use-timer-audio';
import type { PreviewableProSound } from '@/lib/pro-arena-synth';
import { openPublicTv } from '@/lib/public-tv';
import { useApi } from '@/lib/use-api';
import { post } from '@/lib/api';
import { formatTime, isRoundClosingSeconds, titleCase } from '@/lib/utils';
import { ScoreboardView } from './scoreboard-view';
import { VideoReviewManager } from './video-review-manager';
import { PairingManager } from './pairing-manager';
import { KeybindSettingsDialog, Keycap } from './keybind-settings-dialog';
import {
  defaultKeybindMap,
  isEditableTarget,
  loadKeybindPreferences,
  normalizeKeyboardToken,
  resolveOperatorAction,
  saveKeybindPreferences,
  type OperatorActionId,
  type OperatorKeybindPreferences,
} from './operator-keybinds';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Loading, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/ui/toast';

interface EventRow {
  event_id: string;
  sequence: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
  actor_id: string | null;
}

const pointButtons: Array<{
  label: string;
  type: PointType;
  description: string;
  blueAction: OperatorActionId;
  redAction: OperatorActionId;
}> = [
  { label: '+1', type: 'BODY_PUNCH', description: 'Punch', blueAction: 'BLUE_PUNCH', redAction: 'RED_PUNCH' },
  { label: '+2', type: 'BODY_KICK', description: 'Body kick', blueAction: 'BLUE_BODY_KICK', redAction: 'RED_BODY_KICK' },
  { label: '+3', type: 'HEAD_KICK', description: 'Head kick', blueAction: 'BLUE_HEAD_KICK', redAction: 'RED_HEAD_KICK' },
  { label: '+4', type: 'TURNING_BODY_KICK', description: 'Turning body', blueAction: 'BLUE_TURNING_BODY', redAction: 'RED_TURNING_BODY' },
  { label: '+6', type: 'TURNING_HEAD_KICK', description: 'Turning head', blueAction: 'BLUE_TURNING_HEAD', redAction: 'RED_TURNING_HEAD' },
];

const proSoundButtons: ReadonlyArray<{ id: PreviewableProSound; label: string; sub: string; accent?: string }> = [
  { id: 'ROUND_HORN', label: 'Arena Horn', sub: 'Round end', accent: 'border-red/50 bg-red/15 text-[#ff9aa3] hover:bg-red/25' },
  { id: 'REST_HORN', label: 'Rest Horn', sub: '2-pulse break', accent: 'border-timer/50 bg-timer/15 text-timer hover:bg-timer/25' },
  { id: 'ROUND_START', label: 'Fight Bell', sub: 'Shi-jak start', accent: 'border-success/40 bg-success/15 text-success hover:bg-success/25' },
  { id: 'PAUSE_WHISTLE', label: 'Kal-yeo', sub: 'Pause chirp' },
  { id: 'BODY_HIT', label: 'Body +1/+2', sub: 'PSS hogu hit' },
  { id: 'HEAD_KICK', label: 'Head +3', sub: 'Rising PSS' },
  { id: 'TURNING_KICK', label: 'Spin +4/+6', sub: 'Power sting', accent: 'border-primary/50 bg-primary/15 text-[#9bc0ff] hover:bg-primary/25' },
  { id: 'GAM_JEOM', label: 'Gam-Jeom', sub: 'Penalty buzz' },
  { id: 'COUNTDOWN', label: 'Final Pip', sub: '5s countdown' },
  { id: 'VIDEO_REPLAY', label: 'IVR Sting', sub: 'Video replay' },
  { id: 'MEDICAL', label: 'Doctor Call', sub: 'Medical chime' },
  { id: 'VICTORY', label: 'Victory', sub: 'Winner fanfare', accent: 'border-timer/50 bg-timer/15 text-timer hover:bg-timer/25' },
];

export function OperatorScoreboard({ matchId }: { matchId: string }) {
  const router = useRouter();
  const { snapshot, remainingMs, connection, error, refresh, cloudConfigured } = useMatchCloud(matchId);
  const audio = useTimerAudio(snapshot, remainingMs);
  const events = useApi<EventRow[]>(`/api/v1/matches/${matchId}/events`);
  const [pending, setPending] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [soundDeckOpen, setSoundDeckOpen] = useState(false);
  const [keybindDialogOpen, setKeybindDialogOpen] = useState(false);
  const [keybindPrefs, setKeybindPrefs] = useState<OperatorKeybindPreferences>(() => ({
    enabled: true,
    bindings: defaultKeybindMap(),
  }));
  const [confirm, setConfirm] = useState<'RESET' | 'UNDO' | 'COMPLETE' | 'PREVIOUS' | 'SUPERIORITY_BLUE' | 'SUPERIORITY_RED' | null>(null);
  const [pointMode, setPointMode] = useState<'ADD' | 'REMOVE'>('ADD');
  const { toast } = useToast();

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      setKeybindPrefs(loadKeybindPreferences());
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  const updateKeybindPrefs = useCallback((next: OperatorKeybindPreferences) => {
    setKeybindPrefs(next);
    saveKeybindPreferences(next);
  }, []);

  const execute = useCallback(async (type: MatchCommand['type'], side?: Side, pointType?: PointType, reason?: string, details: Partial<MatchCommand> = {}) => {
    if (!snapshot) return;
    setPending(true);
    try {
      await post<MatchSnapshot>(`/api/v1/matches/${matchId}/commands`, { ...details, type, side, pointType, reason, expectedVersion: snapshot.version });
      await Promise.all([refresh(), events.refresh()]);
      toast(`${titleCase(type)} accepted`, 'Persisted before broadcast.');
    } catch (reason: unknown) {
      toast('Command rejected', (reason as Error).message, 'error');
      await refresh();
    } finally {
      setPending(false);
    }
  }, [events, matchId, refresh, snapshot, toast]);

  const startNextGeneralBout = useCallback(async () => {
    if (!snapshot) return;
    setPending(true);
    try {
      const created = await post<{ matchId: string; matchNumber: string }>(
        `/api/v1/tournaments/${snapshot.tournamentId}/general-matches`,
        {
          blueName: 'CHUNG',
          redName: 'HONG',
          blueCountryCode: snapshot.blue.countryCode || 'MAR',
          redCountryCode: snapshot.red.countryCode || 'MAR',
          categoryName: snapshot.categoryName || 'General Match',
          matId: snapshot.matId ?? undefined,
          previousMatchId: snapshot.matchId,
          carryOverDevices: true,
        },
      );
      toast(`Match #${created.matchNumber} ready`, 'Next Chung vs Hong bout created (connected judges carried over).');
      router.push(`/scoreboard/${created.matchId}`);
    } catch (err) {
      toast('Could not create next bout', (err as Error).message, 'error');
    } finally {
      setPending(false);
    }
  }, [router, snapshot, toast]);

  const scoringOpen = snapshot ? ['IN_PROGRESS', 'PAUSED', 'GOLDEN_POINT'].includes(snapshot.state) : false;
  const canStart = snapshot ? ['READY', 'CALLED'].includes(snapshot.state) : false;
  const currentRound = snapshot?.rounds.find(round => round.number === snapshot.currentRound);
  const endedRound = snapshot?.timer.kind === 'BREAK' ? snapshot.rounds.find(round => round.number === snapshot.currentRound - 1 && round.endedAt !== null) : undefined;
  const displayRound = endedRound ?? currentRound;
  const superiorityRequired = Boolean(snapshot && displayRound?.endedAt && displayRound.blueScore === displayRound.redScore && !displayRound.winner && (snapshot.state === 'ROUND_BREAK' || snapshot.timer.kind === 'BREAK' || (snapshot.state === 'PAUSED' && snapshot.timer.kind === 'ROUND' && remainingMs <= 0)));
  const canResume = Boolean(snapshot && ['PAUSED', 'ROUND_BREAK'].includes(snapshot.state) && !superiorityRequired);
  const breakPaused = Boolean(snapshot && snapshot.state === 'ROUND_BREAK' && !snapshot.timer.running && remainingMs > 0);
  const canNextRound = Boolean(snapshot && !superiorityRequired && (snapshot.state === 'ROUND_BREAK' ? breakPaused : snapshot.state === 'PAUSED' && snapshot.timer.kind !== 'BREAK' && snapshot.currentRound < snapshot.totalRounds));
  const canMedical = Boolean(snapshot && (['IN_PROGRESS', 'PAUSED'].includes(snapshot.state) || snapshot.timer.kind === 'MEDICAL'));
  const canRequestReview = Boolean(snapshot && ['IN_PROGRESS', 'PAUSED', 'GOLDEN_POINT', 'ROUND_BREAK'].includes(snapshot.state));
  const canUndo = Boolean(snapshot && !['COMPLETED', 'WALKOVER', 'DISQUALIFIED', 'WITHDRAWN'].includes(snapshot.state));
  const canComplete = Boolean(snapshot && ['IN_PROGRESS', 'PAUSED', 'ROUND_BREAK', 'GOLDEN_POINT', 'UNDER_REVIEW'].includes(snapshot.state));

  useEffect(() => {
    if (!snapshot) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (confirm !== null || pairing || keybindDialogOpen) return;
      if (typeof document !== 'undefined' && document.querySelector('[role="dialog"]')) return;

      const token = normalizeKeyboardToken(event);
      if (token === 'Help:?') {
        event.preventDefault();
        setKeybindDialogOpen(true);
        return;
      }
      if (!keybindPrefs.enabled || !token) return;

      const action = resolveOperatorAction(token, keybindPrefs.bindings);
      if (!action) return;

      // While the active Instant Video Replay form is open, let it own point/Gam-Jeom/X selection keys
      if (
        snapshot.state === 'UNDER_REVIEW' &&
        typeof document !== 'undefined' &&
        document.querySelector('[data-testid="video-review-manager"]') &&
        ['BLUE_PUNCH', 'BLUE_BODY_KICK', 'BLUE_HEAD_KICK', 'BLUE_TURNING_BODY', 'BLUE_TURNING_HEAD', 'BLUE_GAM_JEOM', 'RED_PUNCH', 'RED_BODY_KICK', 'RED_HEAD_KICK', 'RED_TURNING_BODY', 'RED_TURNING_HEAD', 'RED_GAM_JEOM', 'TOGGLE_POINT_MODE'].includes(action)
      ) {
        return;
      }

      // Always prevent default on matched shortcut keys (critical for Space so focused buttons never double-click or scroll)
      event.preventDefault();

      if (action === 'TOGGLE_SOUND') {
        void audio.toggle();
        return;
      }
      if (action === 'MANUAL_HORN') {
        void audio.preview('ROUND_HORN');
        return;
      }
      if (action === 'OPEN_PAIRING') {
        setPairing(true);
        return;
      }
      if (pending) return;

      const scoreOrUndo = (side: Side, pt: PointType) => {
        if (!scoringOpen) return;
        if (pointMode === 'ADD') void execute('SCORE', side, pt);
        else setConfirm('UNDO');
      };
      const gamJeomOrUndo = (side: Side) => {
        if (!scoringOpen) return;
        if (pointMode === 'ADD') void execute('GAM_JEOM', side);
        else setConfirm('UNDO');
      };

      switch (action) {
        case 'TOGGLE_CLOCK':
          if (canStart) void execute('START');
          else if (snapshot.state === 'IN_PROGRESS') void execute('PAUSE');
          else if (canResume) void execute('RESUME');
          break;
        case 'NEXT_ROUND':
          if (canNextRound) void execute('NEXT_ROUND');
          break;
        case 'MEDICAL_TIMEOUT':
          if (canMedical) void execute('MEDICAL_TIMEOUT');
          break;
        case 'RESET_TIMER':
          if (snapshot.state !== 'IN_PROGRESS') setConfirm('RESET');
          break;
        case 'PREVIOUS_ROUND':
          if (snapshot.currentRound > 1 && snapshot.state !== 'IN_PROGRESS') setConfirm('PREVIOUS');
          break;
        case 'BLUE_PUNCH':
          scoreOrUndo('BLUE', 'BODY_PUNCH');
          break;
        case 'BLUE_BODY_KICK':
          scoreOrUndo('BLUE', 'BODY_KICK');
          break;
        case 'BLUE_HEAD_KICK':
          scoreOrUndo('BLUE', 'HEAD_KICK');
          break;
        case 'BLUE_TURNING_BODY':
          scoreOrUndo('BLUE', 'TURNING_BODY_KICK');
          break;
        case 'BLUE_TURNING_HEAD':
          scoreOrUndo('BLUE', 'TURNING_HEAD_KICK');
          break;
        case 'BLUE_TECHNICAL':
          scoreOrUndo('BLUE', 'BODY_PUNCH');
          break;
        case 'BLUE_GAM_JEOM':
          gamJeomOrUndo('BLUE');
          break;
        case 'RED_PUNCH':
          scoreOrUndo('RED', 'BODY_PUNCH');
          break;
        case 'RED_BODY_KICK':
          scoreOrUndo('RED', 'BODY_KICK');
          break;
        case 'RED_HEAD_KICK':
          scoreOrUndo('RED', 'HEAD_KICK');
          break;
        case 'RED_TURNING_BODY':
          scoreOrUndo('RED', 'TURNING_BODY_KICK');
          break;
        case 'RED_TURNING_HEAD':
          scoreOrUndo('RED', 'TURNING_HEAD_KICK');
          break;
        case 'RED_TECHNICAL':
          scoreOrUndo('RED', 'BODY_PUNCH');
          break;
        case 'RED_GAM_JEOM':
          gamJeomOrUndo('RED');
          break;
        case 'VIDEO_REVIEW_BLUE':
          if (canRequestReview) void execute('VIDEO_REVIEW', 'BLUE');
          break;
        case 'VIDEO_REVIEW_RED':
          if (canRequestReview) void execute('VIDEO_REVIEW', 'RED');
          break;
        case 'TOGGLE_POINT_MODE':
          setPointMode(prev => (prev === 'ADD' ? 'REMOVE' : 'ADD'));
          break;
        case 'UNDO':
          if (canUndo) setConfirm('UNDO');
          break;
        case 'COMPLETE_MATCH':
          if (canComplete) setConfirm('COMPLETE');
          break;
        case 'SUPERIORITY_BLUE':
          if (superiorityRequired) setConfirm('SUPERIORITY_BLUE');
          break;
        case 'SUPERIORITY_RED':
          if (superiorityRequired) setConfirm('SUPERIORITY_RED');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    audio,
    canComplete,
    canMedical,
    canNextRound,
    canRequestReview,
    canResume,
    canStart,
    canUndo,
    confirm,
    execute,
    keybindDialogOpen,
    keybindPrefs,
    pairing,
    pending,
    pointMode,
    scoringOpen,
    snapshot,
    superiorityRequired,
  ]);

  if (!snapshot) return error ? <ErrorState error={error} retry={refresh} /> : <Loading label="Loading operator scoreboard…" />;
  const onlineJudges = snapshot.judges.filter(judge => judge.role !== 'REFEREE' && judge.status === 'ONLINE').length;
  const oneJudgeMode = onlineJudges === 1;
  const tvPath = snapshot.matId ? `/display/mat/${snapshot.matId}` : `/display/${matchId}`;
  const kb = keybindPrefs.bindings;
  const kbOn = keybindPrefs.enabled;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 animate-enter">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/matches"><ArrowLeft /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">Match {snapshot.matchNumber}</h2>
              <StatusBadge status={snapshot.state} />
            </div>
            <p className="mt-1 text-xs text-muted">{snapshot.categoryName} · {snapshot.matName} · version {snapshot.version}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={connection === 'ONLINE' ? 'green' : cloudConfigured ? 'yellow' : 'yellow'}>
            {connection === 'ONLINE' ? <Wifi /> : <WifiOff />}{connection}{cloudConfigured ? ' · Cloud' : ' · Local'}
          </Badge>
          <Button
            variant={kbOn ? 'secondary' : 'ghost'}
            onClick={() => setKeybindDialogOpen(true)}
            data-testid="open-keybinds-button"
            className={kbOn ? 'border-primary/40 text-white' : 'text-muted'}
          >
            <Keyboard /> {kbOn ? 'Keybinds ON' : 'Keybinds OFF'} <Keycap token="?" enabled />
          </Button>
          <Button variant={audio.ready ? 'success' : 'secondary'} aria-label={audio.ready ? 'Mute match sounds' : 'Enable match sounds'} aria-pressed={audio.ready} onClick={() => void audio.toggle()}>
            {audio.ready ? <Volume2 /> : <VolumeX />}{audio.ready ? 'Pro sound on' : audio.enabled ? 'Enable pro sound' : 'Sound off'} <Keycap token={kb.TOGGLE_SOUND} enabled={kbOn} />
          </Button>
          <Button variant={soundDeckOpen ? 'default' : 'secondary'} data-testid="toggle-sound-deck" onClick={() => setSoundDeckOpen(open => !open)}>
            <Radio /> Pro FX
          </Button>
          {snapshot.phase === 'GENERAL' && (
            <Button
              variant={['COMPLETED', 'WALKOVER', 'DISQUALIFIED'].includes(snapshot.state) ? 'default' : 'secondary'}
              disabled={pending}
              data-testid="next-general-match"
              onClick={() => void startNextGeneralBout()}
            >
              <Swords /> Next Chung vs Hong
            </Button>
          )}
          <Button variant="secondary" onClick={() => setPairing(true)}>
            <QrCode /> Pair devices <Keycap token={kb.OPEN_PAIRING} enabled={kbOn} />
          </Button>
          <Button asChild variant="secondary">
            <Link href={tvPath} target="_blank" rel="noopener noreferrer" onClick={event => { if (openPublicTv(tvPath)) event.preventDefault(); }}>
              <ExternalLink /> Public TV
            </Link>
          </Button>
        </div>
      </div>
      {soundDeckOpen && (
        <div className="rounded-2xl border border-primary/35 bg-sidebar/90 p-3.5 shadow-lg animate-enter" data-testid="pro-sound-deck">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-white">Competitive Pro Arena Soundboard &amp; Speaker Test</p>
              <p className="text-[10px] text-muted">Mastered KPNP / WT broadcast synthesis (compressor + stadium hall ambience). All cues also trigger automatically during live matches on Operator &amp; Public TV.</p>
            </div>
            <Badge tone={audio.ready ? 'green' : 'yellow'}>{audio.ready ? 'ARENA AUDIO LIVE' : 'CLICK ANY PAD TO ARM'}</Badge>
          </div>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
            {proSoundButtons.map((pad) => (
              <button
                key={pad.id}
                type="button"
                onClick={() => void audio.preview(pad.id)}
                className={`flex flex-col items-center justify-center rounded-lg border px-2 py-2 text-center transition ${pad.accent ?? 'border-line bg-background/75 text-white hover:border-primary/50 hover:bg-primary/10'}`}
              >
                <span className="text-[11px] font-extrabold leading-tight">{pad.label}</span>
                <span className="mt-0.5 text-[9px] opacity-75">{pad.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-line/60">
        <ScoreboardView snapshot={snapshot} remainingMs={remainingMs} />
      </div>
      <div className="grid gap-5 2xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock3 className="size-4 text-primary" /> Time control
              </CardTitle>
              <span className={`numeric rounded-md px-2.5 py-0.5 text-2xl font-bold transition-colors ${isRoundClosingSeconds(snapshot.timer.kind, remainingMs) ? 'bg-[#e60019] text-white' : ''}`}>{formatTime(remainingMs)}</span>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {canStart ? (
                  <Button variant="success" disabled={pending} onClick={() => void execute('START')}>
                    <Play /> Start <Keycap token={kb.TOGGLE_CLOCK} enabled={kbOn} />
                  </Button>
                ) : snapshot.state === 'IN_PROGRESS' ? (
                  <Button variant="yellow" disabled={pending} onClick={() => void execute('PAUSE')}>
                    <Pause /> Pause <Keycap token={kb.TOGGLE_CLOCK} enabled={kbOn} />
                  </Button>
                ) : (
                  <Button variant="success" disabled={pending || !canResume} onClick={() => void execute('RESUME')}>
                    <Play /> {snapshot.state === 'ROUND_BREAK' ? (breakPaused ? 'Resume rest' : 'Start next round') : 'Resume'} <Keycap token={kb.TOGGLE_CLOCK} enabled={kbOn} />
                  </Button>
                )}
                <Button variant="secondary" disabled={pending || !canNextRound} onClick={() => void execute('NEXT_ROUND')}>
                  {snapshot.state === 'ROUND_BREAK' ? 'Start next round' : 'End round & rest'} <Keycap token={kb.NEXT_ROUND} enabled={kbOn} />
                </Button>
                <Button variant="secondary" disabled={pending || snapshot.state === 'IN_PROGRESS'} onClick={() => setConfirm('RESET')}>
                  <RotateCcw /> Reset timer <Keycap token={kb.RESET_TIMER} enabled={kbOn} />
                </Button>
                <Button variant="secondary" disabled={pending || snapshot.currentRound <= 1 || snapshot.state === 'IN_PROGRESS'} onClick={() => setConfirm('PREVIOUS')}>
                  <ChevronLeft /> Previous <Keycap token={kb.PREVIOUS_ROUND} enabled={kbOn} />
                </Button>
                <Button variant="secondary" disabled={pending || !canMedical} onClick={() => void execute('MEDICAL_TIMEOUT')}>
                  <Stethoscope /> {snapshot.timer.kind === 'MEDICAL' ? 'End medical' : 'Medical'} <Keycap token={kb.MEDICAL_TIMEOUT} enabled={kbOn} />
                </Button>
              </div>
              <p className="mt-3 text-[10px] leading-5 text-muted">
                Server time is authoritative. Browser countdown is a display estimate and reconciles with each snapshot. Restart recovery pauses uncertain running timers.
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {(['BLUE', 'RED'] as const).map((side) => {
              const athlete = side === 'BLUE' ? snapshot.blue : snapshot.red;
              const gamJeomKey = side === 'BLUE' ? kb.BLUE_GAM_JEOM : kb.RED_GAM_JEOM;
              const techKey = side === 'BLUE' ? kb.BLUE_TECHNICAL : kb.RED_TECHNICAL;
              return (
                <Card key={side} className={side === 'BLUE' ? 'border-blue/40' : 'border-red/40'}>
                  <CardHeader className={side === 'BLUE' ? 'bg-blue/10' : 'bg-red/10'}>
                    <CardTitle>
                      <span className={side === 'BLUE' ? 'text-[#8baeff]' : 'text-[#ff8b96]'}>{side}</span> · {athlete.name}
                    </CardTitle>
                    <span className="numeric text-2xl font-black">{side === 'BLUE' ? snapshot.blueScore : snapshot.redScore}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {/* Row 1: 5 point buttons + Gam-Jeom + +/- toggle */}
                      <div className="grid grid-cols-7 gap-1.5">
                        {pointButtons.map((point) => {
                          const actionKey = side === 'BLUE' ? kb[point.blueAction] : kb[point.redAction];
                          return (
                            <button
                              key={point.type}
                              disabled={pending || !scoringOpen}
                              onClick={() => void (pointMode === 'ADD' ? execute('SCORE', side, point.type) : setConfirm('UNDO'))}
                              className={`relative flex h-16 flex-col items-center justify-center rounded-lg px-1 text-white transition disabled:cursor-not-allowed disabled:opacity-30 ${side === 'BLUE' ? 'bg-blue hover:bg-[#155de9]' : 'bg-red hover:bg-[#dd2637]'}`}
                              title={pointMode === 'ADD' ? point.description : 'Cancel last scoring event'}
                            >
                              <span className="numeric text-sm font-black">{point.label}</span>
                              <span className="mt-0.5 text-[7px] uppercase leading-3 opacity-80">{pointMode === 'ADD' ? point.description : 'Cancel'}</span>
                              <Keycap token={actionKey} enabled={kbOn} className="mt-1 px-1 py-0 text-[9px]" />
                            </button>
                          );
                        })}
                        <button
                          key="gam-jeom"
                          disabled={pending || !scoringOpen}
                          onClick={() => void (pointMode === 'ADD' ? execute('GAM_JEOM', side) : setConfirm('UNDO'))}
                          className={`relative flex h-16 flex-col items-center justify-center rounded-lg px-1 text-white transition disabled:cursor-not-allowed disabled:opacity-30 ${side === 'BLUE' ? 'bg-blue/80 hover:bg-blue' : 'bg-red/80 hover:bg-red'}`}
                          title={pointMode === 'ADD' ? 'Gam-Jeom' : 'Cancel last scoring event'}
                        >
                          <ShieldAlert className="size-4" />
                          <span className="mt-0.5 text-[7px] uppercase leading-3 opacity-80">{pointMode === 'ADD' ? 'Gam-Jeom' : 'Cancel'}</span>
                          <Keycap token={gamJeomKey} enabled={kbOn} className="mt-1 px-1 py-0 text-[9px]" />
                        </button>
                        <button
                          key="toggle"
                          disabled={pending}
                          onClick={() => setPointMode(pointMode === 'ADD' ? 'REMOVE' : 'ADD')}
                          className={`relative flex h-16 flex-col items-center justify-center rounded-lg border-2 px-1 transition disabled:cursor-not-allowed disabled:opacity-30 ${pointMode === 'ADD' ? 'bg-white/[.1] border-primary/50 text-primary hover:bg-white/[.2]' : 'bg-white/[.1] border-red/50 text-red hover:bg-red/10'}`}
                          title={pointMode === 'ADD' ? 'Switch to remove points' : 'Switch to add points'}
                        >
                          {pointMode === 'ADD' ? <Minus className="size-4" /> : <Plus className="size-4" />}
                          <span className="mt-0.5 text-[7px] uppercase leading-3 opacity-80">{pointMode === 'ADD' ? 'Mode +' : 'Mode -'}</span>
                          <Keycap token={kb.TOGGLE_POINT_MODE} enabled={kbOn} className="mt-1 px-1 py-0 text-[9px]" />
                        </button>
                      </div>

                      {/* Row 2: Technical point + Cancel point */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          key="technical"
                          disabled={pending || !scoringOpen}
                          onClick={() => void (pointMode === 'ADD' ? execute('SCORE', side, 'BODY_PUNCH') : setConfirm('UNDO'))}
                          className={`flex h-14 items-center justify-center gap-2 rounded-lg px-2 text-white transition disabled:cursor-not-allowed disabled:opacity-30 ${side === 'BLUE' ? 'bg-blue hover:bg-[#155de9]' : 'bg-red hover:bg-[#dd2637]'}`}
                          title={pointMode === 'ADD' ? 'Technical point' : 'Cancel last scoring event'}
                        >
                          <div className="flex flex-col items-center">
                            <span className="numeric text-sm font-black">+1</span>
                            <span className="mt-0.5 text-[7px] uppercase leading-3 opacity-80">{pointMode === 'ADD' ? 'Technical' : 'Cancel'}</span>
                          </div>
                          <Keycap token={techKey} enabled={kbOn} />
                        </button>
                        <button
                          key="cancel"
                          disabled={pending || !scoringOpen}
                          onClick={() => setConfirm('UNDO')}
                          className={`flex h-14 items-center justify-center gap-2 rounded-lg border-2 px-2 text-white transition disabled:cursor-not-allowed disabled:opacity-30 ${side === 'BLUE' ? 'border-blue/50 hover:bg-blue/20' : 'border-red/50 hover:bg-red/20'}`}
                          title="Cancel last scoring event"
                        >
                          <div className="flex flex-col items-center">
                            <Undo2 className="size-4" />
                            <span className="mt-0.5 text-[7px] uppercase leading-3 opacity-80">Cancel</span>
                          </div>
                          <Keycap token={kb.UNDO} enabled={kbOn} />
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Review, correction & completion</CardTitle>
            </CardHeader>
            <CardContent>
              <VideoReviewManager
                snapshot={snapshot}
                pending={pending}
                onCommand={(command) => execute(command.type, command.side, undefined, command.reason, command)}
                keybindsEnabled={kbOn}
                blueReviewKey={kb.VIDEO_REVIEW_BLUE}
                redReviewKey={kb.VIDEO_REVIEW_RED}
              />
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Button variant="secondary" disabled={pending || !canUndo} onClick={() => setConfirm('UNDO')}>
                  <Undo2 /> Undo / correct <Keycap token={kb.UNDO} enabled={kbOn} />
                </Button>
                <Button variant="danger" disabled={pending || !canComplete} onClick={() => setConfirm('COMPLETE')}>
                  <CircleStop /> Complete match <Keycap token={kb.COMPLETE_MATCH} enabled={kbOn} />
                </Button>
              </div>
              <p className="mt-3 text-[10px] leading-5 text-muted">
                Undo appends a correction event; it never deletes the original score. Completion is blocked for unresolved ties and advances the bracket in the same transaction.
              </p>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Judge connections</CardTitle>
              <Badge tone={snapshot.judges.filter(j => j.status === 'ONLINE').length >= 2 ? 'green' : 'yellow'}>
                {snapshot.judges.filter(j => j.status === 'ONLINE').length}/3 online
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              {(['J1', 'J2', 'J3', 'REFEREE'] as const).map((role) => {
                const judge = snapshot.judges.find(item => item.role === role);
                return (
                  <div key={role} className="flex items-center justify-between rounded-lg border border-line/60 p-3">
                    <div className="flex items-center gap-2">
                      {judge?.status === 'ONLINE' ? <Wifi className="size-4 text-success" /> : <WifiOff className="size-4 text-muted" />}
                      <span className="text-xs font-semibold">{role}</span>
                    </div>
                    <Badge tone={judge?.status === 'ONLINE' ? 'green' : 'neutral'}>
                      {judge?.status ?? 'NOT ASSIGNED'}
                    </Badge>
                  </div>
                );
              })}
              <div className="mt-3 rounded-lg bg-primary/5 p-3 text-[10px] leading-5 text-muted">
                <strong className={oneJudgeMode ? 'text-timer' : 'text-[#a7bfea]'}>
                  {onlineJudges === 0 ? 'Waiting for an online corner judge.' : oneJudgeMode ? 'ONE-JUDGE MODE: the only online judge&apos;s authorized input is accepted immediately.' : 'TWO-JUDGE CONSENSUS: matching input from two distinct online judges is required.'}
                </strong>
                <br />
                Duplicate deliveries never award extra points. The mode switches automatically with fresh device presence.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="size-4 text-primary" /> {endedRound ? 'Round ended' : 'Current round'}
              </CardTitle>
              <Badge>R{displayRound?.number ?? snapshot.currentRound}</Badge>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg bg-blue/10 p-3">
                <p className="text-[10px] text-muted">Blue / penalties</p>
                <p className="numeric mt-1 text-xl font-bold">{displayRound?.blueScore ?? 0} <span className="text-sm text-muted">/ {displayRound?.bluePenalties ?? 0}</span></p>
              </div>
              <div className="rounded-lg bg-red/10 p-3">
                <p className="text-[10px] text-muted">Red / penalties</p>
                <p className="numeric mt-1 text-xl font-bold">{displayRound?.redScore ?? 0} <span className="text-sm text-muted">/ {displayRound?.redPenalties ?? 0}</span></p>
              </div>
              {superiorityRequired && (
                <div className="col-span-2 rounded-lg border border-timer/30 bg-timer/5 p-3 text-left">
                  <p className="text-xs font-bold text-timer">Superiority decision required</p>
                  <p className="mt-1 text-[10px] leading-5 text-muted">
                    Points are equal. After the officials complete their procedure, record their final round winner. This does not change the points.
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button variant="secondary" disabled={pending} onClick={() => setConfirm('SUPERIORITY_BLUE')}>
                      Blue wins by superiority <Keycap token={kb.SUPERIORITY_BLUE} enabled={kbOn} />
                    </Button>
                    <Button variant="secondary" disabled={pending} onClick={() => setConfirm('SUPERIORITY_RED')}>
                      Red wins by superiority <Keycap token={kb.SUPERIORITY_RED} enabled={kbOn} />
                    </Button>
                  </div>
                </div>
              )}
              {displayRound?.decisionMethod === 'SUPERIORITY' && (
                <p className="col-span-2 rounded-lg bg-timer/10 p-2 text-[10px] font-bold text-timer">
                  {displayRound.winner} won this tied round by superiority.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Append-only event history</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => void events.refresh()}>
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="max-h-[420px] space-y-2 overflow-y-auto">
              {events.data?.length ? [...events.data].reverse().slice(0, 40).map((event) => (
                <div key={event.event_id} className="rounded-lg border border-line/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold">{titleCase(event.event_type)}</span>
                    <Badge>SEQ {event.sequence}</Badge>
                  </div>
                  <p className="mt-1 break-words font-mono text-[9px] leading-4 text-muted">{JSON.stringify(event.payload)}</p>
                </div>
              )) : (
                <p className="py-6 text-center text-xs text-muted">No events recorded.</p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      <PairingManager matchId={matchId} open={pairing} onOpenChange={setPairing} />
      <KeybindSettingsDialog open={keybindDialogOpen} onOpenChange={setKeybindDialogOpen} preferences={keybindPrefs} onChange={updateKeybindPrefs} />
      <ConfirmDialog open={confirm === 'RESET'} onOpenChange={() => setConfirm(null)} title="Reset the authoritative timer?" description="Pause is required. This correction is written to the audit log with your reason." confirmLabel="Reset timer" requireReason onConfirm={(reason) => execute('RESET_TIMER', undefined, undefined, reason)} />
      <ConfirmDialog open={confirm === 'UNDO'} onOpenChange={() => setConfirm(null)} title="Correct the latest scoring event?" description="The original event remains immutable. A compensating correction will be appended." confirmLabel="Append correction" requireReason danger onConfirm={(reason) => execute('UNDO', undefined, undefined, reason)} />
      <ConfirmDialog open={confirm === 'PREVIOUS'} onOpenChange={() => setConfirm(null)} title="Return to the previous round?" description="Administrator correction only. Provide a reason for the permanent audit trail." confirmLabel="Correct round" requireReason onConfirm={(reason) => execute('PREVIOUS_ROUND', undefined, undefined, reason)} />
      <ConfirmDialog open={confirm === 'SUPERIORITY_BLUE' || confirm === 'SUPERIORITY_RED'} onOpenChange={() => setConfirm(null)} title={`Record ${confirm === 'SUPERIORITY_BLUE' ? 'Blue' : 'Red'} superiority win?`} description="Use only after the officials have decided the tied round. Equal points remain unchanged, and the authoritative decision cannot be overwritten through this action." confirmLabel="Record officials&apos; decision" requireReason onConfirm={(reason) => execute('ROUND_SUPERIORITY', confirm === 'SUPERIORITY_BLUE' ? 'BLUE' : 'RED', undefined, reason)} />
      <ConfirmDialog open={confirm === 'COMPLETE'} onOpenChange={() => setConfirm(null)} title="Confirm winner and complete match?" description="The server will validate round results and tie policy. An unresolved tie cannot produce a winner. Bracket advancement commits atomically." confirmLabel="Validate & complete" danger onConfirm={() => execute('COMPLETE')} />
    </div>
  );
}
