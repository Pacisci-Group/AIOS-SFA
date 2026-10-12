import confetti from "canvas-confetti";
import popUrl from "@/assets/celebration-pop.wav";

/**
 * A short confetti burst and a party-popper pop, for the one moment in the app worth
 * celebrating (PAC-65 #12 + PAC-158 — booking a sale).
 *
 * ## Why this exists as a module
 *
 * One import site for the dependency, and one place the reduced-motion check
 * lives. Calling `confetti()` inline at the call site would work and would put
 * the accessibility guard somewhere it can be forgotten the second time
 * somebody wants a celebration. The sound lives here too, for the same reason:
 * the two always fire together, and nobody has to remember a second call.
 *
 * ## Why it survives an immediate navigate
 *
 * `canvas-confetti` appends its own fixed-position canvas to `document.body`,
 * outside React's tree, and removes it when the animation finishes. That is
 * what lets the sold flow fire this and then `navigate(..., { replace: true })`
 * on the same tick — a React-rendered animation would unmount mid-burst. The
 * pop is a module-level `Audio` element, never rendered, so it outlives the
 * route change the same way.
 *
 * ## The ticket said "lead review completion"
 *
 * There is no lead-review concept in this product; that was an error in the
 * 08-10 scrum notes, confirmed with Asad. The moment meant is **mark as sold**,
 * which is also the one the Aug-4 sold-notification precedent points at.
 */
export function celebrate(): void {
  // The sound is not motion: it plays whatever the reduced-motion setting
  // says, and is muted only by its own toggle below.
  playCelebrationSound();

  // Someone who has asked their OS to reduce motion has asked for this
  // specifically. Nothing depends on the burst, so skipping it costs nothing.
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  // Two bursts from the lower corners rather than one from the centre: a
  // centred burst lands over the content the user is being navigated to.
  const shared = { particleCount: 60, spread: 70, startVelocity: 45, ticks: 120 };
  void confetti({ ...shared, origin: { x: 0.15, y: 0.9 }, angle: 60 });
  void confetti({ ...shared, origin: { x: 0.85, y: 0.9 }, angle: 120 });
}

/* ------------------------------------------------------------------------- */
/* The sound (PAC-158)                                                        */
/* ------------------------------------------------------------------------- */

/*
 * The clip is a party-popper pop Asad generated with ElevenLabs sound effects
 * (licensed to the account that made it), chosen to match the confetti rather
 * than a chime: the burst is the thing being celebrated, the sound is its
 * "pop". Converted from the 2-second stereo Ogg Opus original to a quarter
 * second of mono 22.05 kHz 16-bit WAV — the pop itself lasts ~170 ms and the
 * rest of the original is silence — with the peak normalised to 0.9. WAV
 * rather than Opus because Safari cannot decode Ogg, and because a PCM clip
 * has no encoder delay, so it starts the instant the confetti does.
 */

/**
 * Persisted across logout by the allowlist in `lib/api-client.ts` — it
 * describes the device, not the account. Keep the two in step.
 */
export const CELEBRATION_SOUND_STORAGE_KEY = "celebration:sound";

/** Office environment, shared desks: audible, not startling. */
const CELEBRATION_SOUND_VOLUME = 0.5;

/**
 * Whether the pop plays on this device. **Defaults on**; only an explicit
 * `"false"` mutes it, so a value this code never wrote reads as the default.
 */
export function isCelebrationSoundEnabled(): boolean {
  try {
    return localStorage.getItem(CELEBRATION_SOUND_STORAGE_KEY) !== "false";
  } catch {
    // Storage unavailable (Safari private mode): behave as the default.
    return true;
  }
}

export function setCelebrationSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(CELEBRATION_SOUND_STORAGE_KEY, String(enabled));
  } catch {
    // Ignore — the preference simply won't survive a reload.
  }
}

/**
 * Created when the module loads — which, because the only production importer
 * is the sold wizard's lazy chunk, is when the wizard mounts. `preload="auto"`
 * fetches the clip then, so the first sale of a session hears it at the same
 * instant as the confetti rather than after a round trip. The asset is
 * imported through Vite so it is content-hashed and cached like any other.
 *
 * `Audio` is missing under Node (tests, tooling); `null` there and the sound
 * is simply skipped.
 */
const pop = typeof Audio === "undefined" ? null : createPop();

function createPop(): HTMLAudioElement {
  const audio = new Audio(popUrl);
  audio.preload = "auto";
  audio.volume = CELEBRATION_SOUND_VOLUME;
  return audio;
}

/**
 * Plays the pop if the device has not muted it.
 *
 * Booking a sale is a click, so the browser has the user gesture autoplay
 * policy wants — but `play()` can still reject (blocked, no output device, a
 * tab the browser has muted) and that must never surface in the sold flow. A
 * rejection here is swallowed; the toast and the navigate carry on regardless.
 */
export function playCelebrationSound(): void {
  if (!isCelebrationSoundEnabled()) return;
  play();
}

/**
 * The profile page's "Preview" — plays even when the toggle is off, so a rep
 * can hear what they are muting (or un-muting) without booking a sale.
 */
export function previewCelebrationSound(): void {
  play();
}

function play(): void {
  if (!pop) return;
  try {
    // Rewind so two sales in quick succession both sound, rather than the
    // second call being a no-op on an element that is already playing.
    pop.currentTime = 0;
    void pop.play().catch(() => {});
  } catch {
    // Older engines throw synchronously instead of rejecting; same answer.
  }
}
