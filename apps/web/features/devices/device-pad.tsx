"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Pause,
  Play,
  ShieldAlert,
  Smartphone,
  Stethoscope,
  Video,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import type {
  MatchSnapshot,
  PointType,
  ScoreProposalInput,
  Side,
} from "@tkd/contracts";
import { api, post } from "@/lib/api";
import { useMatch } from "@/lib/use-match";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Loading } from "@/components/ui/states";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { flagEmoji, formatTime, titleCase } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import {
  HeadguardIcon,
  HoguIcon,
  PunchFistIcon,
} from "@/features/scoreboard/scoring-activity-icons";
import styles from "./judge-controller.module.css";
interface Session {
  id: string;
  matchId: string;
  role: "J1" | "J2" | "J3" | "REFEREE";
  deviceName: string;
  expiresAt: number;
}
function useDeviceSession(pairingOrSessionToken: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const connect = async () => {
      setLoading(true);
      const saved = localStorage.getItem(`tkd_device_${pairingOrSessionToken}`);
      const candidate = saved || pairingOrSessionToken;
      try {
        const response = await api<{ session: Session }>(
          `/api/v1/device/session?token=${encodeURIComponent(candidate)}`,
        );
        if (!active) return;
        setSession(response.session);
        setToken(candidate);
        localStorage.setItem(`tkd_device_${pairingOrSessionToken}`, candidate);
        localStorage.setItem(`tkd_device_${candidate}`, candidate);
        if (candidate !== pairingOrSessionToken)
          history.replaceState(
            null,
            "",
            `/${response.session.role === "REFEREE" ? "referee" : "judge"}/${candidate}`,
          );
      } catch (firstError) {
        if (saved) {
          setError(firstError as Error);
          setLoading(false);
          return;
        }
        try {
          const response = await post<{
            sessionToken: string;
            session: Session;
          }>("/api/v1/pairing/exchange", {
            token: pairingOrSessionToken,
            deviceName: `${navigator.userAgent.includes("Android") ? "Android" : "Browser"} · ${screen.width}×${screen.height}`,
          });
          if (!active) return;
          setSession(response.session);
          setToken(response.sessionToken);
          localStorage.setItem(
            `tkd_device_${pairingOrSessionToken}`,
            response.sessionToken,
          );
          localStorage.setItem(
            `tkd_device_${response.sessionToken}`,
            response.sessionToken,
          );
          history.replaceState(
            null,
            "",
            `/${response.session.role === "REFEREE" ? "referee" : "judge"}/${response.sessionToken}`,
          );
        } catch (secondError) {
          if (active) setError(secondError as Error);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void connect();
    return () => {
      active = false;
    };
  }, [pairingOrSessionToken]);
  return { session, token, error, loading };
}
const points: Array<{
  type: PointType;
  label: string;
  short: string;
  slot: "punch" | "body" | "head" | "turnBody" | "turnHead";
  icon?: "punch" | "body" | "head";
}> = [
  { type: "HEAD_KICK", label: "+3", short: "Head", slot: "head", icon: "head" },
  {
    type: "TURNING_BODY_KICK",
    label: "+4",
    short: "Turn body",
    slot: "turnBody",
  },
  { type: "BODY_KICK", label: "+2", short: "Body", slot: "body", icon: "body" },
  {
    type: "TURNING_HEAD_KICK",
    label: "+6",
    short: "Turn head",
    slot: "turnHead",
  },
  {
    type: "BODY_PUNCH",
    label: "+1",
    short: "Punch",
    slot: "punch",
    icon: "punch",
  },
];
export function DevicePad({
  pairingOrSessionToken,
  expectedRole,
}: {
  pairingOrSessionToken: string;
  expectedRole: "JUDGE" | "REFEREE";
}) {
  const { session, token, error, loading } = useDeviceSession(
    pairingOrSessionToken,
  );
  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loading label="Validating device assignment…" />
      </div>
    );
  if (error || !session)
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
        <div className="rounded-2xl border border-red/30 bg-red/5 p-5">
          <XCircle className="mx-auto size-10 text-[#ff7b88]" />
          <h1 className="mt-4 text-xl font-bold">Device could not be paired</h1>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
            {error?.message ?? "Invalid session."}
          </p>
          <p className="mt-4 text-xs text-muted">
            Ask the mat operator for a new QR code. Never use an administrator
            login on a public judge device.
          </p>
        </div>
      </main>
    );
  if (
    (expectedRole === "REFEREE" && session.role !== "REFEREE") ||
    (expectedRole === "JUDGE" && session.role === "REFEREE")
  )
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
        <AlertTriangle className="size-8 text-timer" />
        <h1 className="mt-3 text-xl font-bold">Wrong device role</h1>
        <p className="mt-2 text-sm text-muted">
          This session is assigned to {session.role}. Open the correct
          interface.
        </p>
      </main>
    );
  return session.role === "REFEREE" ? (
    <RefereePad session={session} token={token} />
  ) : (
    <JudgePad session={session} token={token} />
  );
}
function DeviceHeader({
  session,
  snapshot,
  remainingMs,
  connection,
}: {
  session: Session;
  snapshot: MatchSnapshot;
  remainingMs: number;
  connection: string;
}) {
  return (
    <>
      <header className="flex items-center gap-3 border-b border-line/60 bg-sidebar px-4 py-3">
        <BrandMark className="size-8" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold">
            {snapshot.tournamentName}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-muted">
            Match {snapshot.matchNumber} · {snapshot.categoryName}
          </p>
        </div>
        <Badge tone={connection === "ONLINE" ? "green" : "yellow"}>
          {connection === "ONLINE" ? <Wifi /> : <WifiOff />}
          {connection}
        </Badge>
        <Badge tone="blue">{session.role}</Badge>
      </header>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-line/60 bg-[#090e18] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-[#8baeff]">
            {flagEmoji(snapshot.blue.countryCode)} {snapshot.blue.name}
          </p>
          <p className="numeric mt-1 text-3xl font-black">
            {snapshot.blueScore}
          </p>
        </div>
        <div className="rounded-lg bg-timer px-4 py-2 text-center text-black">
          <p className="numeric text-3xl font-black">
            {formatTime(remainingMs)}
          </p>
          <p className="text-[9px] font-black">
            ROUND {snapshot.currentRound}/{snapshot.totalRounds}
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="truncate text-xs font-semibold text-[#ff8b96]">
            {snapshot.red.name} {flagEmoji(snapshot.red.countryCode)}
          </p>
          <p className="numeric mt-1 text-3xl font-black">
            {snapshot.redScore}
          </p>
        </div>
      </div>
    </>
  );
}
function JudgePad({ session, token }: { session: Session; token: string }) {
  const { snapshot, remainingMs, connection, refresh } = useMatch(
    session.matchId,
    token,
  );
  const [response, setResponse] = useState<{
    status: string;
    reason: string;
    points?: number;
    diagnostics?: {
      consensusWindowMs: number;
      consensusThreshold: number;
      matchingJudgeCount: number;
      expiredPriorCount: number;
    };
  } | null>(null);
  const [lastInput, setLastInput] = useState<{
    side: Side;
    pointType: PointType;
  } | null>(null);
  const sequence = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);
  const { toast } = useToast();
  useEffect(() => {
    sequence.current = Number(
      localStorage.getItem(`tkd_sequence_${session.id}`) || 0,
    );
  }, [session.id]);
  const prepareFeedback = () => {
    if (navigator.vibrate) navigator.vibrate(15);
    const AudioContextClass =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!audioContext.current && AudioContextClass)
      audioContext.current = new AudioContextClass();
    if (audioContext.current?.state === "suspended")
      void audioContext.current.resume();
  };
  const playTone = (frequency: number, duration: number, delay = 0) => {
    const context = audioContext.current;
    if (!context || context.state !== "running") return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.055, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  };
  const sendFeedback = (status: string) => {
    if (navigator.vibrate)
      navigator.vibrate(
        status === "ACCEPTED"
          ? [30, 35, 30]
          : status === "PENDING"
            ? 35
            : [80, 40, 80],
      );
    if (status === "ACCEPTED") {
      playTone(880, 0.07);
      playTone(1320, 0.09, 0.08);
    } else if (status === "PENDING") playTone(620, 0.08);
    else playTone(220, 0.15);
  };
  const submit = async (
    side: Side,
    pointType: PointType,
    submittedAt: number,
  ) => {
    if (!snapshot) return;
    const round = snapshot.rounds.find(
      (item) => item.number === snapshot.currentRound,
    );
    if (!round) return;
    prepareFeedback();
    setLastInput({ side, pointType });
    setResponse({ status: "SENDING", reason: "Judge input sent" });
    sequence.current += 1;
    localStorage.setItem(
      `tkd_sequence_${session.id}`,
      String(sequence.current),
    );
    const proposal: ScoreProposalInput = {
      eventId: crypto.randomUUID(),
      matchId: snapshot.matchId,
      roundId: round.id,
      judgeSessionId: session.id,
      side,
      pointType,
      submittedAt,
      sequence: sequence.current,
      idempotencyKey: crypto.randomUUID(),
    };
    try {
      const result = await api<{
        status: string;
        reason: string;
        points: number;
      }>("/api/v1/judge/proposals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(proposal),
      });
      setResponse(result);
      sendFeedback(result.status);
      await refresh();
    } catch (error) {
      setResponse({ status: "REJECTED", reason: (error as Error).message });
      sendFeedback("REJECTED");
      toast("Proposal not accepted", (error as Error).message, "error");
    }
  };
  if (!snapshot) return <Loading />;
  const enabled =
    connection === "ONLINE" &&
    ["IN_PROGRESS", "GOLDEN_POINT"].includes(snapshot.state);
  const onlineJudges = snapshot.judges.filter(
    (judge) => judge.role !== "REFEREE" && judge.status === "ONLINE",
  ).length;
  const oneJudgeMode = onlineJudges === 1;
  const modeDescription =
    onlineJudges === 0
      ? "Connecting judge presence…"
      : oneJudgeMode
        ? "One-judge scoring · immediate acceptance"
        : "Two-judge consensus · matching input required";
  const inputPoint = lastInput
    ? points.find((point) => point.type === lastInput.pointType)
    : undefined;
  const inputLabel =
    lastInput && inputPoint
      ? `${lastInput.side} ${inputPoint.short} ${inputPoint.label}`
      : "";
  const statusText = !response
    ? enabled
      ? modeDescription
      : connection !== "ONLINE"
        ? "Disconnected — do not score. Reconnecting to the server…"
        : "Scoring is closed until the referee starts the round."
    : response.status === "SENDING"
      ? "Input sent"
      : response.status === "ACCEPTED"
        ? `Accepted +${response.points}`
        : response.status === "PENDING"
          ? "Proposal pending consensus"
          : "Proposal rejected";
  const feedbackClass =
    response?.status === "ACCEPTED"
      ? styles.accepted
      : response?.status === "PENDING" || response?.status === "SENDING"
        ? styles.pending
        : response
          ? styles.rejected
          : "";
  const responseReason =
    response && response.status !== "SENDING" ? titleCase(response.reason) : "";
  const diagnosticTitle = response?.diagnostics
    ? `Consensus ${response.diagnostics.matchingJudgeCount}/${response.diagnostics.consensusThreshold} · ${response.diagnostics.consensusWindowMs} ms${response.diagnostics.expiredPriorCount > 0 ? " · Earlier matching input expired" : ""}`
    : modeDescription;
  const renderPad = (side: Side) => (
    <section
      className={`${styles.pad} ${side === "BLUE" ? styles.blue : styles.red}`}
      aria-label={`${side} scoring controls`}
    >
      <div className={styles.sideLabel}>
        <span>{side}</span>
        <small>{side === "BLUE" ? "LEFT" : "RIGHT"} THUMB ZONE</small>
      </div>
      <div className={styles.padGrid}>
        {points.map((point) => (
          <button
            key={point.type}
            data-testid={`judge-${side.toLowerCase()}-${point.type.toLowerCase()}`}
            disabled={!enabled}
            onClick={() => void submit(side, point.type, Date.now())}
            className={`${styles.hitButton} ${styles[point.slot]}`}
            aria-label={`${side} ${point.short} ${point.label}`}
          >
            {(point.slot === "turnBody" || point.slot === "turnHead") && (
              <span className={styles.turnBadge}>TURN</span>
            )}
            {point.icon === "head" ? (
              <HeadguardIcon />
            ) : point.icon === "body" ? (
              <HoguIcon />
            ) : point.icon === "punch" ? (
              <PunchFistIcon />
            ) : null}
            <span className={styles.label}>
              {point.short}
              {point.type === "HEAD_KICK" && (
                <span className={styles.sub}>KICK</span>
              )}
            </span>
            <span className={`${styles.points} numeric`}>{point.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
  return (
    <main className={styles.controller} data-testid="judge-controller">
      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <span className={styles.role} data-testid="judge-role">
            {session.role}
          </span>
          <span
            className={`${styles.online} ${connection === "ONLINE" ? "" : styles.offline}`}
          >
            <i className={styles.dot} />
            {connection === "ONLINE" ? "ONLINE" : "OFFLINE"}
          </span>
        </div>
        <div className={styles.timer}>
          <strong className="numeric">{formatTime(remainingMs)}</strong>
          <span>
            ROUND
            <br />
            {snapshot.currentRound} / {snapshot.totalRounds}
          </span>
        </div>
        <div className={styles.topRight}>
          <div className={styles.mode} data-testid="judge-consensus-mode">
            {onlineJudges === 0
              ? "CONNECTING JUDGES"
              : oneJudgeMode
                ? "ONE-JUDGE MODE"
                : "2-JUDGE CONSENSUS"}
            <small>
              {oneJudgeMode
                ? "IMMEDIATE ACCEPTANCE"
                : "MATCHING INPUT REQUIRED"}
            </small>
          </div>
          <span className={`${styles.online} ${styles.feedbackBadge}`}>
            ◉ FEEDBACK
          </span>
        </div>
      </header>
      <div className={styles.controls}>
        {renderPad("BLUE")}
        <div className={styles.centerDivider}>
          <span />
        </div>
        {renderPad("RED")}
      </div>
      <footer className={styles.feedback}>
        <span className={styles.feedbackLeft}>Corner judge {session.role}</span>
        <span
          className={`${styles.last} ${feedbackClass}`}
          role="status"
          aria-live="polite"
          data-testid="judge-feedback"
          title={`${inputLabel} · ${responseReason || modeDescription} · ${diagnosticTitle}`}
        >
          <i className={styles.dot} />
          <span>
            {inputLabel && response ? `${inputLabel} · ` : ""}
            {statusText}
            {responseReason ? ` · ${responseReason}` : ""}
          </span>
        </span>
        <span className={styles.feedbackRight}>VIBRATION + DISTINCT TONE</span>
      </footer>
    </main>
  );
}
function RefereePad({ session, token }: { session: Session; token: string }) {
  const { snapshot, remainingMs, connection, refresh } = useMatch(
    session.matchId,
    token,
  );
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [superiority, setSuperiority] = useState<Side | null>(null);
  const { toast } = useToast();
  const command = useCallback(
    async (type: string, side?: Side, reason?: string) => {
      if (!snapshot) return;
      setPending(true);
      try {
        await api("/api/v1/referee/commands", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            type,
            side,
            reason,
            expectedVersion: snapshot.version,
          }),
        });
        await refresh();
        toast("Referee command accepted");
      } catch (error) {
        toast("Command rejected", (error as Error).message, "error");
      } finally {
        setPending(false);
      }
    },
    [snapshot, token, refresh, toast],
  );
  if (!snapshot) return <Loading />;
  const currentRound = snapshot.rounds.find(
    (round) => round.number === snapshot.currentRound,
  );
  const endedRound =
    snapshot.timer.kind === "BREAK"
      ? snapshot.rounds.find(
          (round) =>
            round.number === snapshot.currentRound - 1 &&
            round.endedAt !== null,
        )
      : undefined;
  const decisionRound = endedRound ?? currentRound;
  const superiorityRequired = Boolean(
    decisionRound?.endedAt &&
    decisionRound.blueScore === decisionRound.redScore &&
    !decisionRound.winner &&
    (snapshot.state === "ROUND_BREAK" ||
      snapshot.timer.kind === "BREAK" ||
      (snapshot.state === "PAUSED" &&
        snapshot.timer.kind === "ROUND" &&
        remainingMs <= 0)),
  );
  return (
    <main className="safe-bottom min-h-screen bg-background">
      <DeviceHeader
        session={session}
        snapshot={snapshot}
        remainingMs={remainingMs}
        connection={connection}
      />
      <section className="mx-auto max-w-xl space-y-4 p-4">
        <div className="rounded-xl border border-line/60 bg-panel p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold">Center referee controls</p>
              <p className="mt-1 text-[10px] text-muted">
                Server-authorized match actions
              </p>
            </div>
            <StatusBadge status={snapshot.state} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {["READY", "CALLED"].includes(snapshot.state) ? (
              <Button
                size="xl"
                variant="success"
                disabled={pending || connection !== "ONLINE"}
                onClick={() => void command("START")}
              >
                <Play />
                Start round
              </Button>
            ) : snapshot.state === "IN_PROGRESS" ? (
              <Button
                size="xl"
                variant="yellow"
                disabled={pending}
                onClick={() => void command("PAUSE")}
              >
                <Pause />
                Pause
              </Button>
            ) : (
              <Button
                size="xl"
                variant="success"
                disabled={
                  pending ||
                  superiorityRequired ||
                  !["PAUSED", "ROUND_BREAK"].includes(snapshot.state)
                }
                onClick={() => void command("RESUME")}
              >
                <Play />
                {snapshot.state === "ROUND_BREAK"
                  ? !snapshot.timer.running && remainingMs > 0
                    ? "Resume rest"
                    : "Start next round"
                  : "Resume"}
              </Button>
            )}
            <Button
              size="xl"
              variant="secondary"
              disabled={
                pending ||
                (!["IN_PROGRESS", "PAUSED"].includes(snapshot.state) &&
                  snapshot.timer.kind !== "MEDICAL")
              }
              onClick={() => void command("MEDICAL_TIMEOUT")}
            >
              <Stethoscope />
              Medical
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(["BLUE", "RED"] as const).map((side) => (
            <button
              key={side}
              disabled={
                pending ||
                !["IN_PROGRESS", "PAUSED", "GOLDEN_POINT"].includes(
                  snapshot.state,
                )
              }
              onClick={() => void command("GAM_JEOM", side)}
              className={`min-h-24 rounded-xl border p-4 text-left disabled:opacity-30 ${side === "BLUE" ? "border-blue/40 bg-blue/10" : "border-red/40 bg-red/10"}`}
            >
              <ShieldAlert
                className={
                  side === "BLUE" ? "text-[#8baeff]" : "text-[#ff8b96]"
                }
              />
              <p className="mt-2 text-sm font-bold">Gam-Jeom {side}</p>
              <p className="mt-1 text-[10px] text-muted">
                +1 point to opponent
              </p>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button
            size="lg"
            variant="secondary"
            disabled={
              pending ||
              ![
                "IN_PROGRESS",
                "PAUSED",
                "GOLDEN_POINT",
                "ROUND_BREAK",
              ].includes(snapshot.state)
            }
            onClick={() => void command("VIDEO_REVIEW")}
          >
            <Video />
            Video review
          </Button>
          <Button
            size="lg"
            variant="secondary"
            disabled={pending || snapshot.state !== "UNDER_REVIEW"}
            onClick={() => void command("END_REVIEW")}
          >
            <CheckCircle2 />
            End review
          </Button>
        </div>
        {superiorityRequired && (
          <div className="rounded-xl border border-timer/30 bg-timer/10 p-4 text-center">
            <p className="text-sm font-bold text-timer">
              Round {decisionRound?.number} tied · superiority required
            </p>
            <p className="mt-1 text-[10px] leading-5 text-muted">
              After the officials decide, record their final winner. Equal
              points remain unchanged.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => setSuperiority("BLUE")}
              >
                Blue wins
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => setSuperiority("RED")}
              >
                Red wins
              </Button>
            </div>
          </div>
        )}
        <Button
          size="lg"
          variant="danger"
          className="w-full"
          disabled={
            pending ||
            superiorityRequired ||
            ![
              "IN_PROGRESS",
              "PAUSED",
              "ROUND_BREAK",
              "GOLDEN_POINT",
              "UNDER_REVIEW",
            ].includes(snapshot.state)
          }
          onClick={() => setComplete(true)}
        >
          <Clock3 />
          Request match completion
        </Button>
        <div className="rounded-lg border border-line/60 p-3 text-center text-[10px] leading-5 text-muted">
          <Smartphone className="mr-1 inline size-3" />
          Keep this page open for presence heartbeats. Reconnection always loads
          a complete authoritative snapshot before further commands.
        </div>
      </section>
      <ConfirmDialog
        open={complete}
        onOpenChange={setComplete}
        title="Confirm match completion?"
        description="The server validates round results and tie policy before saving the winner. Unresolved ties are rejected."
        confirmLabel="Confirm completion"
        danger
        onConfirm={() => command("COMPLETE")}
      />
      <ConfirmDialog
        open={superiority !== null}
        onOpenChange={() => setSuperiority(null)}
        title={`Confirm ${superiority ?? ""} superiority win?`}
        description="Record this only after the officials have decided the tied round. The server keeps the equal points and stores an audited decision."
        confirmLabel="Record round winner"
        onConfirm={() =>
          command(
            "ROUND_SUPERIORITY",
            superiority ?? undefined,
            `Officials' superiority decision for round ${decisionRound?.number ?? snapshot.currentRound}`,
          )
        }
      />
    </main>
  );
}
