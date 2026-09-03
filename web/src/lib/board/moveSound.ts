/**
 * The click the board makes as a move lands, synthesised rather than sampled.
 *
 * No audio files. A move click is a filtered noise burst under a short low body — about
 * forty lines of Web Audio — and generating it costs nothing at build time, nothing at load
 * time, and settles the licensing question that comes with any sample set worth shipping.
 * It also lets the four sounds be relatives of one another by construction: capture is the
 * move click brighter and harder, castling is the same click twice, check is the click with
 * a small bell over it. A reader learns three variations of one sound rather than four.
 *
 * The kind is read off SAN, not off the board. `Nxe5+` says everything needed and is already
 * in hand at both call sites — the game's move rows and the analysis line's `sans` — where
 * asking a position what just happened would mean diffing two boards. Check outranks
 * capture on purpose: a checking capture is a check first, and the check is the sound worth
 * hearing.
 *
 * Nothing here runs where there is no `AudioContext` (jsdom, an old browser): every entry
 * point falls through to silence rather than throwing, so a test that steps a board does not
 * need to know this file exists.
 */
import { useEffect, useRef } from 'react'

import { getMoveSoundPrefs } from './moveSoundPrefs'

export type MoveSoundKind = 'move' | 'capture' | 'castle' | 'check'

/**
 * What `san` should sound like, or null when there is nothing to play — the starting
 * position, or a move list that never carried SAN.
 */
export function moveSoundKind(san: string | null | undefined): MoveSoundKind | null {
  if (!san) return null
  if (san.endsWith('+') || san.endsWith('#')) return 'check'
  if (san.startsWith('O-O')) return 'castle'
  if (san.includes('x')) return 'capture'
  return 'move'
}

/**
 * The slider's 0-100 as a gain. Squared, not linear: loudness is roughly the square of
 * amplitude, so a linear slider spends its top half on differences nobody can hear and its
 * bottom half falling off a cliff. Squaring puts the audible range across the whole travel,
 * which is what makes the middle of the slider sound like the middle.
 *
 * The voices below are scaled so the loudest of them — a capture — peaks just under 1 at
 * full travel, and the master gain never has to be trimmed to keep the sum from clipping.
 */
function gainFor(volume: number): number {
  const fraction = Math.min(100, Math.max(0, volume)) / 100
  return fraction * fraction
}

/**
 * Two clicks inside 40 ms are one click as far as the ear is concerned, and an arrow key on
 * auto-repeat fires far faster than that. The floor keeps a held key sounding like a run
 * through the game rather than like a swarm.
 */
const FLOOR_SECONDS = 0.04

type AudioContextCtor = new () => AudioContext

let context: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
let lastPlayed = -Infinity

function ctor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const scope = window as typeof window & { webkitAudioContext?: AudioContextCtor }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

/**
 * The one context, opened on the first sound rather than at import: a context created before
 * the page has been interacted with starts suspended and stays a live audio device for a
 * reader who has the sound switched off and will never hear anything from it.
 */
function open(): AudioContext | null {
  if (context) return context
  const Ctor = ctor()
  if (!Ctor) return null
  try {
    context = new Ctor()
    master = context.createGain()
    master.connect(context.destination)
  } catch {
    // No audio device, or the browser refused: silence, permanently.
    context = null
    master = null
  }
  return context
}

/** 200 ms of white noise, made once and re-read by every click. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise) return noise
  const frames = Math.floor(ctx.sampleRate * 0.2)
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const channel = buffer.getChannelData(0)
  for (let i = 0; i < frames; i += 1) channel[i] = Math.random() * 2 - 1
  noise = buffer
  return buffer
}

/** The attack: a band of noise struck and let go. This is what reads as wood on wood. */
function click(
  ctx: AudioContext,
  out: GainNode,
  at: number,
  { level, cutoff, q, decay }: { level: number; cutoff: number; q: number; decay: number },
): void {
  const source = ctx.createBufferSource()
  source.buffer = noiseBuffer(ctx)
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.setValueAtTime(cutoff, at)
  band.Q.setValueAtTime(q, at)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(level, at)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  source.connect(band).connect(gain).connect(out)
  source.start(at)
  source.stop(at + decay + 0.02)
}

/** The body under the attack: a sine dropping in pitch as it dies, which is weight. */
function body(
  ctx: AudioContext,
  out: GainNode,
  at: number,
  { level, from, decay }: { level: number; from: number; decay: number },
): void {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(from, at)
  osc.frequency.exponentialRampToValueAtTime(from * 0.6, at + decay)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.linearRampToValueAtTime(level, at + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  osc.connect(gain).connect(out)
  osc.start(at)
  osc.stop(at + decay + 0.02)
}

/** Check's marker: one quiet triangle note over the click, high enough to sit above it. */
function bell(ctx: AudioContext, out: GainNode, at: number): void {
  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(1046, at)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.linearRampToValueAtTime(0.14, at + 0.006)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18)
  osc.connect(gain).connect(out)
  osc.start(at)
  osc.stop(at + 0.2)
}

const PIECE = { level: 0.5, cutoff: 1500, q: 1.1, decay: 0.055 }
const HARD = { level: 0.7, cutoff: 2600, q: 0.7, decay: 0.1 }

/**
 * Play one move sound now. Silent where there is no audio, where the last sound was inside
 * `FLOOR_SECONDS`, or where the context refuses to resume — never throwing, because the
 * caller is a board that has already moved.
 */
export function playMoveSound(kind: MoveSoundKind, volume: number): void {
  const ctx = open()
  if (!ctx || !master) return
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)

  const at = ctx.currentTime
  if (at - lastPlayed < FLOOR_SECONDS) return
  lastPlayed = at
  master.gain.setValueAtTime(gainFor(volume), at)

  try {
    switch (kind) {
      case 'capture':
        click(ctx, master, at, HARD)
        body(ctx, master, at, { level: 0.25, from: 150, decay: 0.11 })
        break
      case 'castle':
        // Two men, a beat apart: the rook lands after the king, as it does on a real set.
        click(ctx, master, at, PIECE)
        body(ctx, master, at, { level: 0.2, from: 190, decay: 0.07 })
        click(ctx, master, at + 0.075, PIECE)
        body(ctx, master, at + 0.075, { level: 0.2, from: 190, decay: 0.07 })
        break
      case 'check':
        click(ctx, master, at, PIECE)
        body(ctx, master, at, { level: 0.22, from: 190, decay: 0.08 })
        bell(ctx, master, at)
        break
      default:
        click(ctx, master, at, PIECE)
        body(ctx, master, at, { level: 0.22, from: 190, decay: 0.08 })
    }
  } catch {
    // A node the browser would not build: this move goes unheard, the next one tries again.
  }
}

/**
 * Sound one click whenever `key` names a different position than it did last render.
 *
 * `key` is the position the *board* stands on, which is why the caller builds it rather than
 * this hook: stepping the game and walking an analysis line are both moves and both sound,
 * and hovering a line in a panel scrubs the board without being one — the preview is a
 * question, not a move, and is deliberately left out of the key.
 *
 * The first render is silent whatever the key: opening a game at ply 40, or coming back to
 * one, is arriving at a position rather than playing to it. The prefs are read here rather
 * than subscribed to, so a browser with the sound off does no work beyond this comparison.
 */
export function useMoveSound(key: string, san: string | null | undefined): void {
  const previous = useRef<string | null>(null)

  useEffect(() => {
    const was = previous.current
    previous.current = key
    if (was === null || was === key) return
    const kind = moveSoundKind(san)
    if (!kind) return
    const prefs = getMoveSoundPrefs()
    if (!prefs.enabled) return
    playMoveSound(kind, prefs.volume)
  }, [key, san])
}

/** Test seam: drop the context and the throttle, so the next play starts from nothing. */
export function resetMoveSound(): void {
  context = null
  master = null
  noise = null
  lastPlayed = -Infinity
}
