// Kito's Canvas renderer. Its shell, lens expressions, state choreography and
// outfit anchors follow docs/KITO_DESIGN.md; the public engine API stays stable.

import { Ease, lerp, type EaseFn } from "../core/anim";
import { Sound } from "../core/sound";
import type { BotEmoteName, BotStateName } from "../core/layout";
import { drawOutfitBehind, drawOutfitFront, makeHead } from "./outfits";
import type { Outfit } from "./wardrobe";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EyeShape =
  | "pill" | "wide" | "dot" | "line" | "flat" | "happy" | "closed"
  | "spiral" | "heart" | "star" | "tired" | "wink" | "cup";

export type BadgeKind = "dots" | "bang" | "question" | "dot" | "arrow";

export interface Badge {
  kind: BadgeKind;
  color: RGB;
}

export type RGB = readonly [number, number, number]; // components 0…1

export type TweenKey = readonly [target: number, durationMs: number, ease: EaseFn];

interface Tween {
  prop: PropKey;
  keys: TweenKey[];
  index: number;
  from: number;
  startMs: number;
  onComplete?: () => void;
}

type PropKey =
  | "yaw" | "pitch" | "roll" | "tilt" | "open" | "sx" | "sy"
  | "oy" | "ox" | "tint" | "morph" | "hands" | "blush" | "es" | "badgeS"
  | "outfitPresence";

interface BotStateCfg {
  color: RGB;
  tint: number;
  eye: EyeShape;
  badge: Badge | null;
  bounces: boolean;
  scans: boolean;
  breathes: boolean;
  zz: boolean;
  sweat: boolean;
  look: readonly [number, number] | null;
  tilt: number;
}

interface Particle {
  type: "heart" | "star" | "spark" | "sweat" | "z";
  x: number; y: number; vx: number; vy: number;
  age: number; life: number; rot: number; size: number;
}

// ── Constants (KitoConst / PISTES.kito) ─────────────────────────────────────

const EYE_W = 0.18;
const EYE_H = 0.34;
const EYE_SP = 0.30;
const EYE_P = -0.05;
const BASE_TOP: RGB = [0.655, 0.667, 0.69]; // slate shell top
const BASE_BOTTOM: RGB = [0.467, 0.478, 0.506]; // slate shell underside

const C = {
  idle: [1, 0.541, 0.502] as RGB,
  working: [0.373, 0.839, 1] as RGB,
  thinking: [0.545, 0.361, 0.965] as RGB,
  searching: [0.388, 0.396, 0.949] as RGB,
  approval: [1, 0.694, 0.231] as RGB,
  question: [0.133, 0.827, 0.933] as RGB,
  error: [0.957, 0.314, 0.369] as RGB,
  finished: [0.31, 0.878, 0.627] as RGB,
  ratelimit: [0.984, 0.573, 0.235] as RGB,
  sleeping: [0.478, 0.498, 0.529] as RGB,
  dizzy: [0.957, 0.447, 0.714] as RGB,
};

const base = {
  bounces: false, scans: false, breathes: false, zz: false, sweat: false,
  look: null, tilt: 0,
};

export const BOT_STATES: Record<BotStateName, BotStateCfg> = {
  idle: { ...base, color: C.idle, tint: 0, eye: "pill", badge: null },
  working: { ...base, color: C.working, tint: 0, eye: "wide", badge: { kind: "dots", color: C.working } },
  thinking: { ...base, color: C.thinking, tint: 0, eye: "dot", badge: { kind: "dots", color: C.thinking }, look: [0.42, -0.38] },
  searching: { ...base, color: C.searching, tint: 0, eye: "line", badge: { kind: "dots", color: C.searching }, scans: true },
  approval: { ...base, color: C.approval, tint: 0, eye: "wide", badge: { kind: "bang", color: C.approval } },
  question: { ...base, color: C.question, tint: 0, eye: "cup", badge: { kind: "question", color: C.question } },
  error: { ...base, color: C.error, tint: 0, eye: "flat", badge: { kind: "dot", color: C.error } },
  finished: { ...base, color: C.finished, tint: 0, eye: "happy", badge: { kind: "dot", color: C.finished } },
  ratelimit: { ...base, color: C.ratelimit, tint: 0, eye: "tired", badge: { kind: "dot", color: C.ratelimit }, sweat: true },
  sleeping: { ...base, color: C.sleeping, tint: 0, eye: "closed", badge: null, breathes: true, zz: true },
  dizzy: { ...base, color: C.dizzy, tint: 0, eye: "spiral", badge: null },
};

/** State → sound, as in BotStateCfg.sound. */
export const STATE_SOUND: Partial<Record<BotStateName, string>> = {
  working: "work", thinking: "think", searching: "search", approval: "approval",
  question: "question", error: "error", finished: "finish", ratelimit: "rate",
  sleeping: "sleep", dizzy: "dizzy",
};

const EMOTE_EYE: Record<BotEmoteName, EyeShape> = {
  love: "heart", surprised: "wide", proud: "star", wink: "wink",
  yawn: "cup", happy: "happy", annoyed: "flat",
};

// ── Small helpers ─────────────────────────────────────────────────────────────

const now = () => performance.now() / 1000;

export function hexToRGB(hex: string): RGB {
  const h = hex.replace("#", "");
  const v = parseInt(h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const rgba = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

const mix3 = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t),
];

function roundRectPath(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number) {
  const r = Math.max(0, Math.min(R, W / 2, H / 2));
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}

function heartPath(x: CanvasRenderingContext2D, s: number) {
  x.beginPath();
  x.moveTo(0, s * 0.38);
  x.bezierCurveTo(-s * 1.05, -s * 0.15, -s * 0.5, -s * 0.95, 0, -s * 0.38);
  x.bezierCurveTo(s * 0.5, -s * 0.95, s * 1.05, -s * 0.15, 0, s * 0.38);
  x.closePath();
}

function starPath(x: CanvasRenderingContext2D, ro: number, ri: number) {
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath();
}

const FONT = `system-ui, "Segoe UI Variable Text", "Segoe UI", sans-serif`;

// ── Dance (BotEngine.applyDance, macOS) ──────────────────────────────────────

/** The dance fades in over 0.3 s and out over 0.5 s. */
export function stepDanceLevel(level: number, dancing: boolean, dt: number): number {
  const target = dancing ? 1 : 0;
  if (level < target) return Math.min(target, level + dt / 0.3);
  if (level > target) return Math.max(target, level - dt / 0.5);
  return level;
}

/**
 * The 112-BPM bounce at `seconds`, for a body of radius R and a dance `level`
 * (0…1): a sideways sway, a hop, a tilt, and a squash on landing.
 */
export function danceTransform(seconds: number, level: number, R: number) {
  const beat = (seconds * 112) / 60;
  const hop = Math.abs(Math.sin(Math.PI * beat));
  const land = Math.pow(1 - hop, 6);
  return {
    dx: 0.08 * R * Math.sin(Math.PI * beat) * level,
    dy: -0.2 * R * hop * level,
    rotate: 0.1 * Math.sin(Math.PI * beat) * level,
    sx: 1 + 0.045 * land * level,
    sy: 1 - 0.06 * land * level,
  };
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class BotEngine {
  isMini = false;
  /** Solid body colour for mini bots / integration pills (null = Kito gradient). */
  bodyColor: RGB | null = null;
  /**
   * A new JichoBot waits (whats-new/whats-new.ts): while Kito is idle or asleep
   * he wears the up-arrow badge. The island turns his body blue alongside.
   */
  private updateHint: RGB | null = null;

  // Animated state (BotEngine `s`)
  yaw = 0; pitch = 0; roll = 0; tilt = 0; open = 1;
  sx = 1; sy = 1; oy = 0; ox = 0;
  tint = 0; morph = 0; hands = 0; blush = 0; es = 1; badgeS = 0;

  // Outfit (the main Kito only — minis never wear one). `outfit` is what is
  // drawn; it changes only once the previous one has left.
  outfit: Outfit = "none";
  /** 0 = gone, 1 = fully on. */
  outfitPresence = 0;
  private outfitTarget: Outfit = "none";

  // Spring lag of the soft parts (pompoms, hat tips, scarf end), −1…1.
  physDx = 0;
  physDy = 0;
  private physVx = 0;
  private physVy = 0;
  private prevYaw = 0;
  private prevOy = 0;
  private prevRoll = 0;

  // Targets
  tgYaw = 0; tgPitch = 0; tgTilt = 0; tgSy = 1; tgSx = 1; tgEs = 1;

  /** Extra canvas height above the body so hearts can fly out without clipping. */
  particleOverhang = 0;

  /** Dancing to music; `dancingLevel` follows it, 0→1 in 0.3 s, 1→0 in 0.5 s. */
  isDancing = false;
  dancingLevel = 0;

  // Mouth spring (fraction of R)
  slotH = 0; slotHTarget = 0; slotHVel = 0; isChewing = false;

  col: RGB = C.idle;
  colT: RGB = C.idle;

  state: BotStateName = "idle";
  cfg: BotStateCfg = BOT_STATES.idle;
  private stateSince = now();

  eyeOverride: EyeShape | null = null;
  eyeOverrideUntil = 0;
  permanentEye: EyeShape | null = null;
  permanentEmote: BotEmoteName | null = null;
  miniNextBehavior = 0;

  badge: Badge | null = null;
  private badgeKey = "none";
  private badgeToken = 0;

  private tweens = new Map<PropKey, Tween>();
  private locks = new Set<PropKey>();
  private particles: Particle[] = [];

  lookX = 0;
  lookY = 0;

  lastTime = now();
  private t0 = now() - Math.random() * 5;
  private nextBlink = now() + 1.5 + Math.random() * 2;
  waveUntil = 0;
  waveStart = 0;
  private greetToken = 0;
  private lastAmbient = 0;
  private greetUntil = 0;
  private slapTimes: number[] = [];
  private miniLookTarget = { x: 0, y: 0 };
  private miniLookNextTime = 0;

  /** Fired when three slaps land inside 1.7 s (→ dizzy + confused view). */
  onDizzy: (() => void) | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────

  setState(next: BotStateName, force = false) {
    if (this.state === next && !force) return;
    const prev = this.state;
    this.state = next;
    this.stateSince = now();
    this.cfg = BOT_STATES[next];
    this.colT = this.cfg.color;
    if (!this.locks.has("tint")) this.tint = this.cfg.tint;
    if (!this.locks.has("tilt")) this.tgTilt = this.cfg.tilt;
    this.setBadge(this.stateBadge());

    switch (next) {
      case "working":
        this.anim("es", [[0.88, 130, Ease.out], [1.14, 170, Ease.inOut], [0.96, 120, Ease.out], [1, 210, Ease.inOut]]);
        break;
      case "thinking":
        this.anim("yaw", [[-0.18, 220, Ease.out], [0.11, 310, Ease.inOut], [-0.04, 170, Ease.out], [0, 200, Ease.inOut]]);
        break;
      case "searching":
        this.anim("tilt", [[0.11, 190, Ease.out], [-0.09, 300, Ease.inOut], [0.035, 170, Ease.out], [0, 210, Ease.inOut]]);
        break;
      case "approval":
        this.anim("es", [[1.04, 90, Ease.out], [1.3, 110, Ease.back], [0.88, 100, Ease.inOut], [1.22, 90, Ease.out], [1, 240, Ease.inOut]]);
        this.anim("oy", [[-0.16, 160, Ease.out], [0.04, 150, Ease.inOut], [0, 230, Ease.out]]);
        break;
      case "question":
        this.anim("tilt", [[0.16, 160, Ease.out], [-0.05, 230, Ease.inOut], [0.02, 120, Ease.out], [0, 240, Ease.inOut]]);
        break;
      case "finished":
        this.anim("sy", [[0.89, 120, Ease.out], [1.1, 170, Ease.back], [0.97, 100, Ease.inOut], [1, 240, Ease.out]]);
        this.anim("es", [[0.82, 110, Ease.inOut], [1.24, 150, Ease.out], [1, 260, Ease.inOut]]);
        setTimeout(() => this.emit("spark", 3), 340);
        break;
      case "error":
        this.anim("ox", [
          [-0.12, 95, Ease.out], [0.06, 100, Ease.inOut], [-0.02, 115, Ease.inOut], [0, 230, Ease.out],
        ]);
        this.anim("tilt", [[0.16, 115, Ease.out], [-0.1, 170, Ease.inOut], [0.03, 120, Ease.out], [0, 230, Ease.inOut]]);
        break;
      case "ratelimit":
        this.anim("sy", [[0.94, 130, Ease.out], [1.08, 240, Ease.inOut], [0.99, 180, Ease.out], [1, 250, Ease.inOut]]);
        this.anim("es", [[1.16, 130, Ease.out], [0.88, 180, Ease.inOut], [1, 240, Ease.out]]);
        this.emit("sweat", 1);
        break;
      case "dizzy":
        this.anim("yaw", [[0.28, 150, Ease.out], [-0.31, 170, Ease.inOut], [0.18, 150, Ease.inOut], [-0.06, 170, Ease.inOut], [0, 210, Ease.out]]);
        this.anim("tilt", [[-0.18, 150, Ease.out], [0.13, 180, Ease.inOut], [-0.08, 160, Ease.out], [0, 240, Ease.inOut]]);
        break;
      default:
        if (prev !== "idle" || next !== "idle") this.blink();
    }
  }

  /** The update badge (blue arrow) while one waits, else nothing. Asked every frame; cheap. */
  setUpdateHint(color: RGB | null) {
    const was = this.updateHint;
    const same = color === was || (color != null && was != null && color.every((c, i) => c === was[i]));
    if (same) return;
    this.updateHint = color;
    this.setBadge(this.stateBadge());
  }

  /** Whether the update hint shows now: only over an idle or sleeping Kito. */
  get showsUpdateHint(): boolean {
    return this.updateHint != null && (this.state === "idle" || this.state === "sleeping");
  }

  private stateBadge(): Badge | null {
    if (this.showsUpdateHint && this.updateHint) return { kind: "arrow", color: this.updateHint };
    return this.cfg.badge;
  }

  setBadge(b: Badge | null) {
    const key = b ? `${b.kind}-${b.color.join(",")}` : "none";
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    const tok = ++this.badgeToken;
    this.anim("badgeS", [[0, 90, Ease.inOut]]);
    setTimeout(() => {
      if (tok !== this.badgeToken) return;
      this.badge = b;
      if (b) this.anim("badgeS", [[1, 280, Ease.back]]);
    }, 100);
  }

  blink() {
    if (this.locks.has("open")) return;
    this.anim("open", [[0.06, 70, Ease.inOut], [1, 130, Ease.out]]);
  }

  squash() {
    this.physVy += 0.6;
    this.anim("sy", [[0.78, 70, Ease.out], [1.1, 130, Ease.out], [1, 170, Ease.inOut]]);
    this.anim("sx", [[1.16, 70, Ease.out], [0.95, 130, Ease.out], [1, 170, Ease.inOut]]);
  }

  /** Mailbox swallow — opens the slot, chews, then closes. */
  gulp() {
    this.slotHTarget = 0.42;
    setTimeout(() => {
      this.slotHTarget = 0;
      this.isChewing = true;
      setTimeout(() => { this.isChewing = false; }, 800);
    }, 460);
    this.anim("sy", [[0.78, 80, Ease.out], [1.18, 130, Ease.out], [1, 220, Ease.back]]);
    this.anim("sx", [[1.28, 80, Ease.out], [0.92, 130, Ease.out], [1, 220, Ease.back]]);
    this.blink();
  }

  slap() {
    this.interruptGreet();
    if (this.state === "dizzy") return;
    const t = now();
    this.slapTimes = this.slapTimes.filter((s) => t - s < 1.7);
    this.slapTimes.push(t);
    Sound.play("slap");
    this.squash();
    this.physVy -= 1.2;
    this.physVx += Math.random() < 0.5 ? 0.7 : -0.7;
    if (this.slapTimes.length >= 3) {
      this.slapTimes = [];
      this.onDizzy?.();
    } else {
      this.eyeOverride = "line";
      this.eyeOverrideUntil = t + 0.8;
      setTimeout(() => Sound.play("annoyed"), 60);
    }
  }

  doRoll(durationMs: number, turns: number) {
    this.roll = 0;
    this.anim("roll", [[Math.PI * 2 * turns, durationMs, Ease.inOut]], () => { this.roll = 0; });
  }

  /** Eye salute: left core wakes, right answers, both glance and the visor nods. */
  greet() {
    const t = now();
    const tok = ++this.greetToken;
    this.waveStart = 0;
    this.waveUntil = 0;
    this.greetUntil = t + 1.45;
    this.hands = 0;
    this.eyeOverride = "closed";
    this.eyeOverrideUntil = t + 0.18;
    this.anim("yaw", [[-0.19, 160, Ease.out], [0.09, 210, Ease.inOut], [0, 240, Ease.out]]);
    this.anim("tilt", [[0.12, 140, Ease.out], [-0.04, 210, Ease.inOut], [0, 190, Ease.out]]);
    this.anim("es", [[0.64, 100, Ease.inOut], [1.24, 150, Ease.out], [0.92, 130, Ease.inOut], [1, 220, Ease.out]]);
    setTimeout(() => { if (this.greetToken === tok) { this.eyeOverride = "wide"; this.eyeOverrideUntil = now() + 0.19; } }, 140);
    setTimeout(() => { if (this.greetToken === tok) { this.eyeOverride = "pill"; this.eyeOverrideUntil = now() + 0.28; } }, 330);
    setTimeout(() => { if (this.greetToken === tok) { this.eyeOverride = "wink"; this.eyeOverrideUntil = now() + 0.26; } }, 610);
    setTimeout(() => { if (this.greetToken === tok) Sound.play("greet"); }, 80);
    setTimeout(() => {
      if (this.greetToken !== tok) return;
      this.eyeOverride = "happy";
      this.eyeOverrideUntil = now() + 0.24;
    }, 910);
    setTimeout(() => { if (this.greetToken === tok) this.greetUntil = 0; }, 1450);
  }

  interruptGreet() {
    if (this.hands <= 0.01 && now() >= this.waveUntil && now() >= this.greetUntil) return;
    this.greetToken++;
    this.greetUntil = 0;
    this.waveUntil = 0;
    this.waveStart = 0;
    this.eyeOverride = this.permanentEye;
    this.eyeOverrideUntil = this.permanentEye ? Number.POSITIVE_INFINITY : 0;
    this.anim("hands", [[0, 150, Ease.inOut]]);
  }

  setPermanentEmote(emote: BotEmoteName | null) {
    this.permanentEmote = emote;
    if (emote === "wink") {
      this.miniNextBehavior = now() + 0.8 + Math.random() * 1.7;
      return;
    }
    this.permanentEye = emote ? EMOTE_EYE[emote] : null;
    if (this.permanentEye) {
      this.eyeOverride = this.permanentEye;
      this.eyeOverrideUntil = Number.POSITIVE_INFINITY;
    } else if (this.eyeOverrideUntil === Number.POSITIVE_INFINITY) {
      this.eyeOverride = null;
      this.eyeOverrideUntil = 0;
    }
    this.miniNextBehavior = now() + 0.8 + Math.random() * 1.7;
  }

  triggerEmote(emote: BotEmoteName, duration = 1.8) {
    const t = now();
    const hold = Math.max(80, (duration - 0.62) * 1000);
    this.eyeOverride = EMOTE_EYE[emote];
    this.eyeOverrideUntil = t + duration;

    switch (emote) {
      case "love":
        this.anim("blush", [
          [0.7, 120, Ease.out], [1.1, 260, Ease.inOut], [0.4, hold, Ease.lin], [0, 280, Ease.inOut],
        ]);
        this.emit("heart", 2);
        this.anim("es", [[0.75, 100, Ease.out], [1.2, 140, Ease.back], [1, 240, Ease.inOut]]);
        this.anim("tilt", [[-0.12, 180, Ease.out], [0.06, 260, Ease.inOut], [0, 220, Ease.out]]);
        break;
      case "surprised":
        this.anim("oy", [[0.12, 90, Ease.out], [-0.04, 150, Ease.inOut], [0, 220, Ease.out]]);
        this.anim("es", [[0.72, 80, Ease.inOut], [1.35, 110, Ease.out], [0.96, 140, Ease.inOut], [1, 260, Ease.out]]);
        break;
      case "proud":
        this.emit("star", 2);
        this.anim("sy", [[0.92, 120, Ease.out], [1.09, 200, Ease.back], [1, 200, Ease.inOut]]);
        this.anim("tilt", [[0.14, 180, Ease.out], [0.14, hold, Ease.lin], [0, 280, Ease.inOut]]);
        break;
      case "wink":
        this.anim("yaw", [[-0.14, 160, Ease.out], [0.06, 230, Ease.inOut], [0, 260, Ease.out]]);
        break;
      case "yawn":
        this.anim("sy", [[1.1, 250, Ease.out], [0.91, 350, Ease.inOut], [0.96, 180, Ease.out], [1, 320, Ease.inOut]]);
        this.anim("es", [[0.64, 240, Ease.inOut], [0.78, 200, Ease.out], [1.1, 180, Ease.out], [1, 300, Ease.inOut]]);
        setTimeout(() => { this.emit("z", 1); }, Math.min(500, duration * 350));
        break;
      case "happy":
        this.anim("oy", [[-0.11, 110, Ease.out], [0.03, 180, Ease.inOut], [0, 210, Ease.out]]);
        this.anim("sx", [[1.12, 140, Ease.out], [0.95, 180, Ease.inOut], [1, 220, Ease.out]]);
        this.anim("es", [[1.1, 100, Ease.out], [1, 220, Ease.inOut]]);
        break;
      case "annoyed":
        this.anim("tilt", [[-0.16, 100, Ease.out], [0.12, 160, Ease.inOut], [-0.05, 120, Ease.out], [0, 250, Ease.inOut]]);
        this.anim("ox", [[0.05, 90, Ease.out], [-0.02, 110, Ease.inOut], [0, 190, Ease.out]]);
        setTimeout(() => Sound.play("annoyed"), 90);
        break;
    }
  }

  emit(type: Particle["type"], count: number) {
    for (let i = 0; i < count; i++) {
      const isZ = type === "z";
      this.particles.push({
        type,
        x: (Math.random() - 0.5) * 0.9 + (isZ ? 0.55 : 0),
        y: -0.7 - Math.random() * 0.2,
        vx: (Math.random() - 0.5) * 0.35 + (isZ ? 0.18 : 0),
        vy: -(0.45 + Math.random() * 0.35),
        age: -i * 0.14,
        life: 1.3 + Math.random() * 0.5,
        rot: Math.random() * Math.PI * 2,
        size: 0.15 + Math.random() * 0.08,
      });
    }
  }

  animateMorph(target: number, durationMs?: number) {
    const dur = durationMs ?? (target > 0.5 ? 550 : 650);
    this.anim("morph", [[target, dur, Ease.inOut]]);
  }

  resetMorph() {
    this.tweens.delete("morph");
    this.locks.delete("morph");
    this.morph = 0;
  }

  /**
   * Dresses Kito. Animated: the old outfit leaves (180 ms), the new one drops
   * in (350 ms) and Kito does a little squash — BotEngine.setOutfit on macOS.
   */
  setOutfit(next: Outfit, animated = true) {
    if (next === this.outfitTarget) return;
    this.outfitTarget = next;
    this.tweens.delete("outfitPresence");
    this.locks.delete("outfitPresence");
    const enter = () => {
      this.outfit = next;
      this.anim("outfitPresence", [[1, 350, Ease.inOut]], () => this.squash());
    };
    if (!animated) {
      this.outfit = next;
      this.outfitPresence = next !== "none" ? 1 : 0;
    } else if (next === "none") {
      this.anim("outfitPresence", [[0, 180, Ease.inOut]], () => { this.outfit = "none"; });
    } else if (this.outfit === "none") {
      this.outfitPresence = 0;
      enter();
    } else {
      this.anim("outfitPresence", [[0, 180, Ease.inOut]], enter);
    }
  }

  /** Wearing something visible: the body then turns as one piece when it rolls. */
  private get rigidRoll(): boolean {
    return !this.isMini && this.outfit !== "none" && this.outfitPresence > 0.05;
  }

  /** True while anything is still moving — lets the island stop its RAF loop. */
  get busy(): boolean {
    return (
      this.tweens.size > 0 ||
      this.particles.length > 0 ||
      this.cfg.bounces || this.cfg.scans || this.cfg.breathes || this.cfg.zz || this.cfg.sweat ||
      this.isMini ||
      this.isDancing || this.dancingLevel > 0.001 ||
      Math.abs(this.tgYaw - this.yaw) > 0.002 ||
      Math.abs(this.tgPitch - this.pitch) > 0.002 ||
      Math.abs(this.tgTilt - this.tilt) > 0.002 ||
      Math.abs(this.tgSy - this.sy) > 0.002 ||
      Math.abs(this.tgSx - this.sx) > 0.002 ||
      Math.abs(this.tgEs - this.es) > 0.002 ||
      this.slotH > 0.001 || Math.abs(this.slotHVel) > 0.001 ||
      Math.abs(this.col[0] - this.colT[0]) > 0.003 ||
      Math.abs(this.col[1] - this.colT[1]) > 0.003 ||
      Math.abs(this.col[2] - this.colT[2]) > 0.003 ||
      (this.outfit !== "none" && (Math.abs(this.physVx) > 0.01 || Math.abs(this.physVy) > 0.01))
    );
  }

  // ── Tweens ──────────────────────────────────────────────────────────────────

  anim(prop: PropKey, keys: TweenKey[], onComplete?: () => void) {
    this.tweens.set(prop, {
      prop, keys, index: 0, from: this[prop], startMs: performance.now(), onComplete,
    });
    this.locks.add(prop);
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  update(dt: number) {
    const n = now();
    const nowMs = performance.now();

    for (const tw of [...this.tweens.values()]) {
      const k = tw.keys[tw.index];
      const p = Math.min(1, Math.max(0, (nowMs - tw.startMs) / k[1]));
      this[tw.prop] = tw.from + (k[0] - tw.from) * k[2](p);
      if (p >= 1) {
        tw.from = k[0];
        tw.index += 1;
        tw.startMs = nowMs;
        if (tw.index >= tw.keys.length) {
          this.tweens.delete(tw.prop);
          this.locks.delete(tw.prop);
          tw.onComplete?.();
        }
      }
    }

    const t = n - this.t0;
    let ty = this.lookX * 0.62;
    let tp = this.lookY * 0.5;

    if (this.cfg.look) {
      ty = ty * 0.35 + this.cfg.look[0] * 0.55;
      tp = tp * 0.3 + this.cfg.look[1] * 0.5;
    }
    if (this.cfg.scans) {
      ty = Math.sin(t * 2.6) * 0.6;
      tp = -0.06;
    }
    if (this.state === "sleeping") { ty = 0; tp = -0.14; }
    if (this.state === "dizzy") { ty = Math.sin(t * 9) * 0.25; }

    // Mini bots never follow the mouse — they wander.
    if (this.isMini && !this.cfg.look && !this.cfg.scans && this.state !== "sleeping" && this.state !== "dizzy") {
      if (n > this.miniLookNextTime) {
        this.miniLookTarget = {
          x: -0.88 + Math.random() * 1.76,
          y: -0.55 + Math.random() * 1.0,
        };
        this.miniLookNextTime = n + 0.5 + Math.random() * 1.5;
      }
      ty = this.miniLookTarget.x * 0.62;
      tp = this.miniLookTarget.y * 0.5;
    }

    this.tgYaw = ty;
    this.tgPitch = tp;
    this.tgTilt = this.cfg.tilt;

    if (n > this.waveStart && n < this.waveUntil) {
      const wt = n - this.waveStart;
      this.tgTilt = -0.06 + Math.sin(2 * Math.PI * 1.2 * wt) * 0.07;
    }

    const bounce = this.cfg.bounces ? -Math.abs(Math.sin(t * 5.2)) * 0.07 : 0;
    const kGen = 1 - Math.pow(0.0008, dt);
    if (!this.locks.has("oy")) this.oy += (bounce - this.oy) * kGen;

    if (this.cfg.breathes) {
      const amp = this.isMini ? 0.07 : 0.025;
      const breath = Math.sin(t * 1.1);
      this.tgSy = 1 + breath * amp;
      this.tgSx = 1 - breath * amp * 0.5;
    } else if (this.isMini) {
      this.tgSy = 1 + Math.sin(t * 2.2) * 0.04;
      this.tgSx = 1 - Math.sin(t * 2.2) * 0.02;
    } else {
      this.tgSy = 1;
      this.tgSx = 1;
    }

    if (this.isMini && n > this.miniNextBehavior) this.doMiniBehaviorLoop();

    const kLook = 1 - Math.pow(0.0025, dt);
    if (!this.locks.has("yaw")) this.yaw += (this.tgYaw - this.yaw) * kLook;
    if (!this.locks.has("pitch")) this.pitch += (this.tgPitch - this.pitch) * kLook;
    if (!this.locks.has("tilt")) this.tilt += (this.tgTilt - this.tilt) * kGen;
    if (!this.locks.has("sy")) this.sy += (this.tgSy - this.sy) * kGen;
    if (!this.locks.has("sx")) this.sx += (this.tgSx - this.sx) * kGen;
    if (!this.locks.has("es")) this.es += (this.tgEs - this.es) * kGen;

    this.col = mix3(this.col, this.colT, 1 - Math.pow(0.002, dt));

    if (n > this.nextBlink) {
      if (this.state !== "sleeping" && this.state !== "dizzy") {
        this.blink();
        if (Math.random() < 0.22) setTimeout(() => this.blink(), 230);
      }
      this.nextBlink = n + 2.2 + Math.random() * 3.2;
    }

    if (this.eyeOverride && n > this.eyeOverrideUntil) {
      this.eyeOverride = this.permanentEye;
      if (this.permanentEye) this.eyeOverrideUntil = Number.POSITIVE_INFINITY;
    }

    if (n - this.lastAmbient > 1.3) {
      this.lastAmbient = n;
      if (this.cfg.zz) this.emit("z", 1);
      if (!this.isMini && this.cfg.sweat && Math.random() < 0.5) this.emit("sweat", 1);
    }

    for (const p of this.particles) p.age += dt;
    this.particles = this.particles.filter((p) => p.age < p.life);

    // Mouth slot spring — ω₀ = 2π/0.25, ζ = 0.6
    const omega = (2 * Math.PI) / 0.25;
    const zeta = 0.6;
    const acc = omega * omega * (this.slotHTarget - this.slotH) - 2 * zeta * omega * this.slotHVel;
    this.slotHVel += acc * dt;
    this.slotH = Math.max(0, this.slotH + this.slotHVel * dt);

    this.dancingLevel = stepDanceLevel(this.dancingLevel, this.isDancing, dt);

    // Soft-part spring: lags behind head turns, hops and rolls (stiffness 60, damping 9).
    if (dt > 0) {
      const yawVel = (this.yaw - this.prevYaw) / dt;
      const oyVel = (this.oy - this.prevOy) / dt;
      // A finished roll snaps from 2π·turns back to 0: that jump is not motion.
      const dRoll = this.roll - this.prevRoll;
      const rollVel = Math.abs(dRoll) > Math.PI ? 0 : dRoll / dt;
      const centrifugal = this.rigidRoll ? rollVel * 0.18 : 0;
      const tDx = Math.max(-1, Math.min(1, -yawVel * 0.35 - this.tilt * 2 + centrifugal));
      const tDy = Math.max(-1, Math.min(1, oyVel * 0.5));
      this.physVx += (60 * (tDx - this.physDx) - 9 * this.physVx) * dt;
      this.physVy += (60 * (tDy - this.physDy) - 9 * this.physVy) * dt;
      this.physDx += this.physVx * dt;
      this.physDy += this.physVy * dt;
    }
    this.prevYaw = this.yaw;
    this.prevOy = this.oy;
    this.prevRoll = this.roll;

    this.lastTime = n;
  }

  private doMiniBehaviorLoop() {
    const n = now();
    switch (this.permanentEmote) {
      case "happy":
        if (this.locks.has("oy")) { this.miniNextBehavior = n + 0.4; return; }
        this.anim("oy", [[-0.18, 100, Ease.out], [0.04, 150, Ease.inOut], [0, 220, Ease.back]]);
        this.anim("sy", [[0.94, 80, Ease.out], [1.22, 140, Ease.out], [0.92, 150, Ease.inOut], [1, 210, Ease.back]]);
        this.anim("sx", [[1.2, 80, Ease.out], [0.91, 140, Ease.out], [1.04, 150, Ease.inOut], [1, 210, Ease.back]]);
        this.miniNextBehavior = n + 2.2 + Math.random() * 1.2;
        break;
      case "annoyed":
        if (this.locks.has("yaw")) { this.miniNextBehavior = n + 0.5; return; }
        this.anim("yaw", [[0.42, 80, Ease.out], [-0.5, 120, Ease.inOut], [0.32, 100, Ease.inOut], [-0.18, 120, Ease.inOut], [0, 190, Ease.out]]);
        this.miniNextBehavior = n + 3.0 + Math.random() * 2.5;
        break;
      case "wink":
        this.eyeOverride = "wink";
        this.eyeOverrideUntil = n + 0.46;
        this.anim("tilt", [[-0.17, 140, Ease.out], [-0.17, 240, Ease.lin], [0, 260, Ease.inOut]]);
        this.miniNextBehavior = n + 2.2 + Math.random() * 2.0;
        break;
      case "love":
        this.emit("heart", 2);
        this.anim("tilt", [[-0.16, 140, Ease.out], [0.1, 300, Ease.inOut], [0, 260, Ease.inOut]]);
        this.miniNextBehavior = n + 2.6 + Math.random() * 1.5;
        break;
      default:
        this.miniNextBehavior = n + 3.0 + Math.random() * 2.0;
    }
  }

  // ── Dancing ─────────────────────────────────────────────────────────────────

  setDancing(dancing: boolean) {
    if (this.isDancing !== dancing) this.isDancing = dancing;
  }

  /**
   * Applies the dance bounce and sway around the bottom of the body. Call it on
   * a saved context, before draw(), with the same size (BotEngine.applyDance).
   */
  applyDance(x: CanvasRenderingContext2D, W: number, H: number) {
    if (this.dancingLevel <= 0.001) return;
    const R = W * 0.3;
    const px = W / 2 + this.ox * R;
    const py = H / 2 + this.particleOverhang / 2 + this.oy * R + R * 0.06 + R * 0.88;
    const d = danceTransform(now(), this.dancingLevel, R);
    x.translate(px + d.dx, py + d.dy);
    x.rotate(d.rotate);
    x.scale(d.sx, d.sy);
    x.translate(-px, -py);
  }

  // ── Draw ────────────────────────────────────────────────────────────────────

  /**
   * Draws hands, body, blush, eyes, mouth, badge and particles into a canvas of
   * `w`×`h` CSS pixels (the caller has already applied the DPR transform).
   */
  draw(x: CanvasRenderingContext2D, W: number, H: number) {
    const R = W * 0.3;
    const rx = R * 1.06;
    const ry = R * 1.0;
    const cx = W / 2 + this.ox * R;
    const cy = H / 2 + this.particleOverhang / 2 + this.oy * R + R * 0.06;

    // With an outfit on, a roll turns the whole character — hat included — as
    // one piece instead of rolling the eyes over the body (BotCanvasView, macOS).
    x.save();
    if (this.rigidRoll && Math.abs(this.roll) > 0.001) {
      x.translate(cx, cy);
      x.rotate(this.roll);
      x.translate(-cx, -cy);
    }

    this.drawHandsBehind(x, R, rx, ry, cx, cy);

    x.save();
    x.translate(cx, cy);
    if (this.tilt !== 0) x.rotate(this.tilt);
    x.scale(this.sx, this.sy);

    const dressed = !this.isMini && this.outfit !== "none";
    const head = dressed ? makeHead(R, this.yaw, this.pitch, this.physDx, this.physDy) : null;
    const outfitState = { presence: this.outfitPresence, morph: this.morph };
    if (head) drawOutfitBehind(x, this.outfit, head, outfitState);

    const body = this.bodyPath(rx, ry, R);
    this.drawBody(x, body, R, rx, ry);

    this.drawShellAndVisor(x, body, R);
    this.drawEyes(x, body, R, rx, ry);
    if (this.morph > 0.05) this.drawMouth(x, body, R);

    if (head) drawOutfitFront(x, this.outfit, head, outfitState);

    x.restore();
    x.restore();

    if (this.badge && this.badgeS > 0.01 && this.morph < 0.25) {
      this.drawBadge(x, this.badge, R, cx, cy);
    }
    this.drawParticles(x, R, cx, cy);
  }

  private bodyPath(rx: number, ry: number, R: number): Path2D {
    const n = 72;
    const expN = 2.0 / 2.7;
    const tw = R * 1.0;
    const th = R * 0.94;
    const tr = R * 0.42;
    const p = new Path2D();
    const m = this.morph;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const px0 = rx * (ca >= 0 ? Math.pow(ca, expN) : -Math.pow(-ca, expN));
      const py0 = ry * (sa >= 0 ? Math.pow(sa, expN) : -Math.pow(-sa, expN));
      let px = px0;
      let py = py0;
      if (m >= 0.005) {
        const rr = rrPoint(ca, sa, tw, th, tr);
        px = lerp(px0, rr.x, m);
        py = lerp(py0, rr.y, m);
      }
      if (i === 0) p.moveTo(px, py);
      else p.lineTo(px, py);
    }
    p.closePath();
    return p;
  }

  private drawShellAndVisor(x: CanvasRenderingContext2D, body: Path2D, R: number) {
    x.save();
    x.strokeStyle = "#343B45"; x.lineWidth = R * (this.isMini ? 0.035 : 0.045); x.stroke(body);
    if (this.morph < 0.95) {
      x.globalAlpha = 1 - this.morph;
      const rim = new Path2D();
      rim.ellipse(0, -R * 0.12, R * 0.83, R * 0.73, 0, 0, Math.PI * 2);
      const ring = x.createLinearGradient(0, -R * 0.84, 0, R * 0.58);
      ring.addColorStop(0, "#737881"); ring.addColorStop(1, "#555A62");
      x.fillStyle = ring; x.fill(rim);
      x.strokeStyle = "#A7AAB0"; x.lineWidth = R * 0.035; x.stroke(rim);

      const visor = new Path2D(); visor.roundRect(-R * 0.62, -R * 0.36, R * 1.24, R * 0.58, R * 0.24);
      const glass = x.createLinearGradient(-R * 0.4, -R * 0.36, R * 0.42, R * 0.24);
      glass.addColorStop(0, "#23252B"); glass.addColorStop(1, "#0B0C0F");
      x.fillStyle = glass; x.fill(visor);
      x.strokeStyle = "rgba(194,205,211,.62)"; x.lineWidth = R * 0.027; x.stroke(visor);
      x.beginPath(); x.ellipse(-R * 0.32, -R * 0.285, R * 0.17, R * 0.043, -0.12, 0, Math.PI * 2);
      x.fillStyle = "rgba(255,255,255,.09)"; x.fill();
    }
    x.restore();
  }

  private drawBody(x: CanvasRenderingContext2D, body: Path2D, R: number, rx: number, ry: number) {
    if (this.bodyColor) {
      x.fillStyle = rgba(this.bodyColor);
      x.fill(body);
    } else {
      const shell = x.createLinearGradient(rx * 0.7, -ry * 0.85, -rx * 0.8, ry * 0.9);
      shell.addColorStop(0, "#A7AAB0");
      shell.addColorStop(1, "#777A81");
      x.fillStyle = shell;
      x.fill(body);
    }
    if (this.isMini) return;

    x.save();
    x.clip(body);
    const shoulder = new Path2D();
    shoulder.moveTo(-R * 0.84, R * 0.97);
    shoulder.bezierCurveTo(-R * 0.82, R * 0.64, -R * 0.58, R * 0.45, -R * 0.28, R * 0.43);
    shoulder.lineTo(R * 0.28, R * 0.43);
    shoulder.bezierCurveTo(R * 0.58, R * 0.45, R * 0.82, R * 0.64, R * 0.84, R * 0.97);
    shoulder.closePath();
    const bust = x.createLinearGradient(0, R * 0.4, 0, R);
    bust.addColorStop(0, "#858990"); bust.addColorStop(1, "#646970");
    x.fillStyle = bust; x.fill(shoulder);
    x.strokeStyle = "rgba(35,40,48,.42)"; x.lineWidth = R * 0.018; x.stroke(shoulder);
    x.strokeStyle = "#E8B9A0"; x.lineWidth = Math.max(1, R * 0.035); x.lineCap = "round";
    for (const side of [-1, 1]) {
      x.beginPath(); x.moveTo(side * R * 0.31, R * 0.45); x.lineTo(side * R * 0.29, R * 0.61); x.stroke();
    }
    const shade = x.createRadialGradient(0, 0, R * 0.3, 0, 0, R * 1.2);
    shade.addColorStop(0, "rgba(0,0,0,0)"); shade.addColorStop(1, "rgba(0,0,0,.13)");
    x.fillStyle = shade; x.fill(body);
    x.restore();
  }

  private drawEyes(x: CanvasRenderingContext2D, body: Path2D, R: number, rx: number, ry: number) {
    let shape: EyeShape = this.eyeOverride ?? this.cfg.eye;
    if (this.isDancing && this.dancingLevel > 0.15 && !this.isMini && (this.state === "idle" || this.state === "finished")) shape = "happy";
    if (this.morph > 0.5) {
      if (this.isChewing) shape = "happy";
      else if (this.slotHTarget > 0.05 || this.slotH > 0.1) shape = "cup";
    }

    x.save();
    x.clip(body);
    const ink = rgba(this.col);
    const stateAge = now() - this.stateSince;
    for (const sd of [-1, 1]) {
      const eyeYaw = sd * EYE_SP + this.yaw;
      let eyePitch = EYE_P + this.pitch + (this.rigidRoll ? 0 : this.roll);
      eyePitch = (((eyePitch + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const cp = Math.cos(eyePitch);
      if (Math.cos(eyeYaw) * cp <= 0.04) continue;
      const ex = Math.sin(eyeYaw) * cp * rx;
      const ey = -Math.sin(eyePitch) * ry + (this.morph > 0 ? ry * 0.14 * this.morph : 0);
      const fx = lerp(Math.max(0.18, Math.cos(eyeYaw)), 1, this.morph * 0.7);
      const fy = lerp(Math.max(0.18, cp), 1, this.morph * 0.7);
      const eyeMult = this.isMini ? 1.9 : 1.0;
      const ew = R * EYE_W * this.es * eyeMult;
      const eh = R * EYE_H * this.es * eyeMult;
      x.save(); x.translate(ex, ey); x.scale(fx, fy);
      let eyeShape = shape;
      if (this.eyeOverride == null) {
        if (this.state === "thinking") eyeShape = sd < 0 ? "dot" : "pill";
        else if (this.state === "question") eyeShape = sd < 0 ? "pill" : stateAge < 0.72 ? "spiral" : "dot";
        else if (this.state === "error") eyeShape = stateAge < 0.21 ? (sd < 0 ? "flat" : "line") : stateAge < 0.42 ? (sd < 0 ? "line" : "flat") : "flat";
        else if (this.state === "finished") eyeShape = sd < 0 ? "happy" : stateAge < 0.32 ? "pill" : "happy";
      }
      this.drawEyeShape(x, eyeShape, ew, eh, sd, ink);
      x.restore();
    }
    x.restore();
  }

  private drawEyeShape(x: CanvasRenderingContext2D, shape: EyeShape, w: number, h: number, sd: number, ink: string) {
    const t = now();
    const core = "#FFE3DF";
    const bloom = 0.82 + this.blush * 0.45 + (this.state === "idle" ? 0.08 * (0.5 + 0.5 * Math.sin(t * 1.7)) : 0);
    const capsule = (width: number, height: number, coreX = 0) => {
      const hh = Math.max(height * this.open, width * 0.42);
      x.save();
      x.shadowColor = ink; x.shadowBlur = width * bloom;
      roundRectPath(x, -width / 2, -hh / 2, width, hh, Math.min(width / 2, hh / 2));
      x.fillStyle = ink; x.fill();
      x.shadowBlur = 0;
      roundRectPath(x, coreX - width * 0.19, -hh * 0.29, width * 0.38, hh * 0.58, width * 0.19);
      x.fillStyle = core; x.globalAlpha = 0.9; x.fill();
      x.restore();
    };
    const workPhase = stateAge % 1.5;
    const workDrift = workPhase < 0.55 ? lerp(-0.24 * w, 0.24 * w, workPhase / 0.55)
      : workPhase < 0.75 ? 0.24 * w
      : workPhase < 1.30 ? lerp(0.24 * w, -0.24 * w, (workPhase - 0.75) / 0.55)
      : -0.24 * w;
    const scanPhase = stateAge % 1.7;
    const scanDrift = scanPhase < 1.05 ? sd * lerp(-0.25 * w, 0.25 * w, scanPhase / 1.05)
      : scanPhase < 1.2 ? sd * 0.25 * w : 0;
    const coreDrift = this.state === "working" ? workDrift
      : this.state === "searching" ? scanDrift
      : this.state === "thinking" ? (sd < 0 || stateAge >= 0.24 ? w * 0.12 : 0) : 0;

    switch (shape) {
      case "wide": capsule(w * 1.12, h * 1.16, coreDrift); break;
      case "pill": capsule(w, h, coreDrift); break;
      case "dot": {
        const pulse = 0.92 + 0.08 * Math.sin(t * 2.4);
        x.save(); x.shadowColor = ink; x.shadowBlur = w * bloom;
        x.beginPath(); x.arc(0, 0, w * 0.48 * pulse, 0, Math.PI * 2); x.fillStyle = ink; x.fill();
        x.shadowBlur = 0; x.beginPath(); x.arc(coreDrift, 0, w * 0.18, 0, Math.PI * 2); x.fillStyle = core; x.fill(); x.restore();
        break;
      }
      case "line":
        x.save(); x.rotate(-sd * 0.12); capsule(w * 1.5, h * 0.58, coreDrift); x.restore();
        break;
      case "flat":
        x.save(); x.rotate(sd * 0.1); capsule(w * 1.35, h * 0.4); x.restore();
        break;
      case "happy":
        x.save(); x.strokeStyle = ink; x.lineWidth = w * 0.32; x.lineCap = "round"; x.shadowColor = ink; x.shadowBlur = w * bloom;
        x.beginPath(); x.arc(0, h * 0.15, w * 0.7, Math.PI * 1.13, Math.PI * 1.87); x.stroke();
        x.shadowBlur = 0; x.strokeStyle = core; x.lineWidth = w * 0.11;
        x.beginPath(); x.arc(0, h * 0.15, w * 0.7, Math.PI * 1.28, Math.PI * 1.72); x.stroke(); x.restore();
        break;
      case "closed":
        x.save(); x.strokeStyle = ink; x.lineWidth = w * 0.3; x.lineCap = "round";
        x.beginPath(); x.moveTo(-w * 0.48, 0); x.quadraticCurveTo(0, h * 0.12, w * 0.48, 0); x.stroke();
        x.strokeStyle = core; x.lineWidth = w * 0.1; x.beginPath(); x.moveTo(-w * 0.25, h * 0.01); x.lineTo(w * 0.25, h * 0.01); x.stroke(); x.restore();
        break;
      case "spiral": {
        x.save(); x.strokeStyle = ink; x.lineWidth = w * 0.14;
        x.beginPath(); x.arc(0, 0, w * 0.46, t * 1.7, t * 1.7 + Math.PI * 1.62); x.stroke();
        const a = t * 2.2 + sd * Math.PI; x.beginPath(); x.arc(Math.cos(a) * w * 0.42, Math.sin(a) * w * 0.42, w * 0.12, 0, Math.PI * 2); x.fillStyle = core; x.fill(); x.restore();
        break;
      }
      case "heart":
        x.fillStyle = "#FF6B88"; heartPath(x, w * 1.08); x.fill();
        x.beginPath(); x.arc(-w * 0.12, -w * 0.18, w * 0.11, 0, Math.PI * 2); x.fillStyle = core; x.fill();
        break;
      case "star":
        x.save(); x.rotate(t * 0.65 * sd); x.shadowColor = ink; x.shadowBlur = w * bloom;
        starPath(x, w * 0.88, w * 0.48); x.fillStyle = ink; x.fill();
        x.shadowBlur = 0; x.beginPath(); x.arc(0, 0, w * 0.13, 0, Math.PI * 2); x.fillStyle = core; x.fill(); x.restore();
        break;
      case "tired":
        capsule(w, h * 0.55);
        x.fillStyle = "#0B0C0F"; roundRectPath(x, -w * 0.62, -h * 0.52 + Math.min(1, stateAge / 0.42) * h * 0.22, w * 1.24, h * 0.48, w * 0.2); x.fill();
        break;
      case "wink":
        if (sd < 0) capsule(w, h, coreDrift);
        else { x.strokeStyle = ink; x.lineWidth = w * 0.3; x.lineCap = "round"; x.beginPath(); x.moveTo(-w * 0.5, h * 0.06); x.quadraticCurveTo(0, -h * 0.4, w * 0.5, h * 0.06); x.stroke(); }
        break;
      case "cup": {
        const hh = Math.max(h * this.open, w * 0.42);
        const cr = Math.min(w / 2, hh / 2);
        x.shadowColor = ink; x.shadowBlur = w * bloom;
        x.beginPath(); x.moveTo(-w / 2, -hh / 2); x.lineTo(w / 2, -hh / 2); x.lineTo(w / 2, hh / 2 - cr);
        x.quadraticCurveTo(w / 2, hh / 2, w / 2 - cr, hh / 2); x.lineTo(-w / 2 + cr, hh / 2);
        x.quadraticCurveTo(-w / 2, hh / 2, -w / 2, hh / 2 - cr); x.closePath(); x.fillStyle = ink; x.fill();
        x.shadowBlur = 0; roundRectPath(x, -w * 0.14, hh * 0.06, w * 0.28, hh * 0.43, w * 0.13); x.fillStyle = core; x.fill();
        break;
      }
    }
  }

  /** Mailbox slot: dark pill cut into the box face, with rim and lip highlights. */
  private drawMouth(x: CanvasRenderingContext2D, body: Path2D, R: number) {
    const m = this.morph;
    const hW = R * 1.8 * m;
    const hH = this.slotH * R * m;
    const hX = -hW / 2;
    const boxTop = -R * (0.88 + 0.06 * m);
    const hY = boxTop + R * 0.08 * m;

    x.save();
    x.clip(body);

    x.strokeStyle = `rgba(255,255,255,${0.55 * m})`;
    x.lineWidth = 1;
    x.lineCap = "round";
    x.beginPath();
    x.moveTo(-R * 0.9 * m, boxTop + 1);
    x.lineTo(R * 0.9 * m, boxTop + 1);
    x.stroke();

    if (hH > 0.8) {
      const hR = Math.min(hW / 2, hH / 2);
      const g = x.createLinearGradient(0, hY, 0, hY + hH);
      g.addColorStop(0, "rgb(7,8,10)");
      g.addColorStop(1, "rgb(16,19,26)");
      roundRectPath(x, hX, hY, hW, hH, hR);
      x.fillStyle = g;
      x.fill();
      if (hH > 4) {
        const lipR = Math.min(hR, (hW - 2) / 2);
        x.strokeStyle = `rgba(255,255,255,${0.28 * m})`;
        x.beginPath();
        x.moveTo(hX + lipR, hY + hH - 0.5);
        x.lineTo(hX + hW - lipR, hY + hH - 0.5);
        x.stroke();
      }
    }
    x.restore();
  }

  /** Hands sit behind the body — drawn before it, in world coordinates. */
  private drawHandsBehind(
    x: CanvasRenderingContext2D,
    R: number, rx: number, ry: number, cx: number, cy: number,
  ) {
    if (this.hands <= 0.01 || this.isMini) return;
    if (R <= 14) return; // meaningless at compact/peek sizes

    const n = now();
    const bodyH = 2 * ry;
    const hew = 0.3 * ry * this.hands;
    const heh = 0.26 * ry * this.hands;
    const hwB = rx * this.sx;
    const hhB = ry * this.sy;
    const isWaving = n >= this.waveStart && this.waveStart > 0 && n < this.waveUntil;

    for (const sd of [-1, 1]) {
      let localX: number;
      let localY: number;
      let handRot = 0;

      if (sd > 0 && isWaving) {
        const wt = n - this.waveStart;
        const rise = Math.min(1, wt / 0.18);
        const riseEased = 1 - Math.pow(1 - rise, 3);
        const restX = hwB * 1.08;
        const restY = hhB * 0.7;
        const oscX = Math.cos(13 * wt) * 0.06 * bodyH;
        const oscY = -Math.sin(13 * wt) * 0.14 * bodyH;
        const waveX = hwB * 1.1 + oscX;
        const waveY = -hhB * 0.15 + oscY;
        localX = restX + (waveX - restX) * riseEased;
        localY = restY + (waveY - restY) * riseEased;
        handRot = (-0.5 + Math.sin(13 * wt) * 0.35) * riseEased;
      } else if (sd < 0 && isWaving) {
        const wt = n - this.waveStart;
        localX = -hwB * 1.08;
        localY = hhB * 0.7 + Math.sin(6 * wt) * 0.04 * bodyH;
      } else {
        localX = sd * hwB * 1.08;
        localY = hhB * 0.7;
      }

      const cosT = Math.cos(this.tilt);
      const sinT = Math.sin(this.tilt);
      const worldX = cx + cosT * localX - sinT * localY;
      const worldY = cy + sinT * localX + cosT * localY;

      x.save();
      x.translate(worldX, worldY);
      if (handRot !== 0) x.rotate(handRot);
      const g = x.createLinearGradient(hew * 0.7, -heh * 0.85, -hew * 0.8, heh * 0.9);
      if (this.bodyColor) {
        g.addColorStop(0, rgba(mix3(this.bodyColor, [1, 1, 1], 0.35)));
        g.addColorStop(1, rgba(this.bodyColor));
      } else {
        g.addColorStop(0, rgba(BASE_TOP));
        g.addColorStop(1, rgba(BASE_BOTTOM));
      }
      x.beginPath();
      x.ellipse(0, 0, hew, heh, 0, 0, Math.PI * 2);
      x.fillStyle = g;
      x.fill();
      x.strokeStyle = "rgba(0,0,0,0.08)";
      x.lineWidth = 1;
      x.stroke();
      x.restore();
    }
  }

  private drawBadge(x: CanvasRenderingContext2D, badge: Badge, R: number, cx: number, cy: number) {
    const bs = this.badgeS * (this.isMini ? 1.25 : 1);
    const bx = cx - R * 0.72 * this.sx;
    const by = cy - R * 0.72 * this.sy;
    const t = now();

    x.save();
    x.translate(bx, by);
    x.scale(bs, bs);
    const col = rgba(badge.color);

    if (badge.kind === "dots") {
      if (this.isMini) {
        const phase = (t * 2.4) % 1;
        const dotR = R * 0.22 * (1 + 0.25 * Math.sin(phase * Math.PI * 2));
        x.fillStyle = "#000";
        x.beginPath();
        x.arc(0, 0, R * 0.2, 0, Math.PI * 2);
        x.fill();
        x.fillStyle = col;
        x.beginPath();
        x.arc(0, 0, dotR, 0, Math.PI * 2);
        x.fill();
      } else {
        const pw = R * 0.72;
        const ph = R * 0.36;
        roundRectPath(x, -pw / 2, -ph / 2, pw, ph, ph / 2);
        x.fillStyle = col;
        x.fill();
        for (let i = 0; i < 3; i++) {
          const phase = (((t * 2.4 - i * 0.22) % 1) + 1) % 1;
          const dotR = R * 0.055 * (1 + 0.4 * Math.max(0, Math.sin(phase * Math.PI * 2)));
          x.fillStyle = "#fff";
          x.beginPath();
          x.arc((i - 1) * R * 0.18, 0, dotR, 0, Math.PI * 2);
          x.fill();
        }
      }
    } else if (badge.kind === "arrow") {
      // The "!" badge's ring and disc, with a white up-arrow: a new JichoBot is out.
      x.fillStyle = "#000";
      x.beginPath();
      x.arc(0, 0, R * 0.3, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = col;
      x.beginPath();
      x.arc(0, 0, R * 0.23, 0, Math.PI * 2);
      x.fill();
      if (!this.isMini) {
        const a = R * 0.12;
        x.strokeStyle = "#fff";
        x.lineWidth = R * 0.055;
        x.lineCap = "round";
        x.lineJoin = "round";
        x.beginPath();
        x.moveTo(0, a);
        x.lineTo(0, -a);
        x.moveTo(-a * 0.8, -a * 0.2);
        x.lineTo(0, -a);
        x.lineTo(a * 0.8, -a * 0.2);
        x.stroke();
      }
    } else if (badge.kind === "bang" || badge.kind === "question") {
      x.fillStyle = "#000";
      x.beginPath();
      x.arc(0, 0, R * 0.3, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = col;
      x.beginPath();
      x.arc(0, 0, R * 0.23, 0, Math.PI * 2);
      x.fill();
      if (!this.isMini) {
        x.fillStyle = "#fff";
        x.font = `900 ${R * 0.32}px ${FONT}`;
        x.textAlign = "center";
        x.textBaseline = "middle";
        x.fillText(badge.kind === "bang" ? "!" : "?", 0, R * 0.02);
      }
    } else {
      x.fillStyle = "#000";
      x.beginPath();
      x.arc(0, 0, R * 0.2, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = col;
      x.beginPath();
      x.arc(0, 0, R * 0.135, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }

  private drawParticles(x: CanvasRenderingContext2D, R: number, cx: number, cy: number) {
    for (const p of this.particles) {
      if (p.age <= 0) continue;
      const k = p.age / p.life;
      const a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      const px = cx + (p.x + p.vx * p.age) * R * 1.3;
      const py = cy + (p.y + p.vy * p.age) * R * 1.3;
      const sz = R * p.size * (1 + k * 0.4);

      x.save();
      x.translate(px, py);
      x.globalAlpha = Math.min(1, Math.max(0, a));
      switch (p.type) {
        case "heart":
          x.rotate(Math.sin(p.age * 6) * 0.3);
          x.fillStyle = "#FF4D6D";
          heartPath(x, sz);
          x.fill();
          break;
        case "star":
          x.rotate(p.rot + p.age * 2);
          x.fillStyle = "#F7B32B";
          starPath(x, sz, sz * 0.45);
          x.fill();
          break;
        case "spark":
          x.rotate(p.rot);
          x.fillStyle = "#fff";
          starPath(x, sz * 0.8, sz * 0.18);
          x.fill();
          break;
        case "sweat":
          x.fillStyle = "#7CC7FF";
          x.beginPath();
          x.moveTo(0, -sz);
          x.quadraticCurveTo(sz * 0.8, sz * 0.2, 0, sz * 0.6);
          x.quadraticCurveTo(-sz * 0.8, sz * 0.2, 0, -sz);
          x.fill();
          break;
        case "z":
          x.fillStyle = "rgb(209,219,235)";
          x.font = `700 ${sz * 1.9}px ${FONT}`;
          x.textAlign = "center";
          x.textBaseline = "middle";
          x.fillText("z", 0, 0);
          break;
      }
      x.restore();
    }
  }
}

/** Ray → rounded-rect boundary intersection, for the mailbox morph. */
function rrPoint(ca: number, sa: number, W: number, H: number, cr: number): { x: number; y: number } {
  const eps = 1e-6;
  const kx = ca >= 0 ? 1 : -1;
  const ky = sa >= 0 ? 1 : -1;
  const cx = kx * (W - cr);
  const cy = ky * (H - cr);

  const dot = ca * cx + sa * cy;
  const disc = dot * dot - (cx * cx + cy * cy - cr * cr);
  if (disc >= 0) {
    const t = dot + Math.sqrt(disc);
    if (t > eps) {
      const px = ca * t;
      const py = sa * t;
      if (Math.abs(px) >= W - cr - eps && Math.abs(py) >= H - cr - eps) return { x: px, y: py };
    }
  }
  if (Math.abs(sa) > eps) {
    const t = (ky * H) / sa;
    if (t > eps) {
      const px = ca * t;
      if (Math.abs(px) <= W - cr + eps) return { x: px, y: ky * H };
    }
  }
  if (Math.abs(ca) > eps) {
    const t = (kx * W) / ca;
    if (t > eps) {
      const py = sa * t;
      if (Math.abs(py) <= H - cr + eps) return { x: kx * W, y: py };
    }
  }
  return { x: kx * W, y: ky * H };
}
