/**
 * The colours both plots of the graph pane are drawn in. Flat, opaque fills, one per side:
 * white above the axis and black below it, read against the mid-grey plot ground
 * (`--bb-graph-bg`) — lichess's treatment, and the reason that ground is its own token
 * rather than the pane's surface.
 *
 * They used to be mixed down to 55 % / 85 % against a background that was nearly the same
 * value as the fill in each theme, which left both halves as tints of the ground and the
 * curve doing all the work. Solid, the side that is winning is legible at a glance from
 * across the desk, which is the whole job of this chart.
 *
 * A file of its own rather than a corner of `graphParts`, so that module exports only
 * components and keeps fast refresh.
 */
export const FILL_WHITE = 'var(--bb-side-white)'
export const FILL_BLACK = 'var(--bb-side-black)'
/** Only the bars wear these: a rim is what keeps a black column from reading as a hole. */
export const EDGE_WHITE = 'var(--bb-side-white-edge)'
export const EDGE_BLACK = 'var(--bb-side-black-edge)'
export const GRAPH_BG = 'var(--bb-graph-bg)'
