/**
 * The colours a region can take on the globe. Both renderers draw from here.
 *
 * Hues are from Okabe and Ito's Color Universal Design palette (2008). It was
 * chosen so the states stay distinct for colour-blind players. The old green
 * for right and red for wrong came out as the same khaki under deuteranopia,
 * and that affects up to 8% of boys. Blue against vermillion is the pair Okabe and Ito
 * recommend in place of green against red. `palette.test.js` holds that line.
 *
 * Greys are USWDS system tokens, named in the comments. A USWDS grade runs from
 * 0 (white) to 100 (black), and the gap between two grades fixes their WCAG
 * contrast. https://designsystem.digital.gov/design-tokens/color/overview/
 *
 * The page's own colours are CSS custom properties in `routes/styles.css`.
 */

/** A region not yet answered. USWDS gray-cool-50. 3.5:1 against `HOVER`. */
export const LAND = '#71767a';

/** The region under the pointer or finger, and the hold ring. Okabe-Ito yellow. */
export const HOVER = '#f0e442';

/** A right answer. Okabe-Ito blue. */
export const CORRECT = '#0072b2';

/** A wrong answer. Okabe-Ito vermillion. */
export const WRONG = '#d55e00';

/**
 * A mastered region, dimmed so progress shows. USWDS gray-cool-70. Only MapLibre
 * draws it. It differs from `LAND` in lightness alone, which no kind of colour
 * blindness removes.
 */
export const LEARNED = '#3d4551';

/** Region borders. */
export const BORDER = '#111111';
