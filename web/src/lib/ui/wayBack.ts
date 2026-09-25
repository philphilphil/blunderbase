/**
 * The colour of a way back to the screen the reader came from — the explorer's "← Back to
 * game", and a game's button back to the game a note link was followed from.
 *
 * One constant because they are one feature on two screens and should look it (owner's
 * call, 2026-09-25). A light orange of its own (`--bb-way-back`), tinted the way the row's
 * other lit chips are: purple in the game's control row is "Back to game" out of a
 * variation into the game's own line, which is a different act, teal there is the row's one
 * affirmative button, and a neutral grey was tried first and sank into the row. Sizing
 * stays with each row.
 */
export const WAY_BACK =
  'rounded-md border border-way-back/30 bg-way-back/10 text-way-back transition-colors hover:border-way-back/50'
