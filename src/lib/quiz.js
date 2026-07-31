/**
 * Quiz state, with no dependency on the globe or the DOM.
 *
 * This used to live inside Globe.svelte's onMount, where it could not be tested
 * and carried several bugs that are fixed here:
 *
 *  - Emptying the roster left `target` undefined, and the next click threw on
 *    `stateData[undefined].score--`.
 *  - A wrong answer decremented the target's score with no floor, so a region
 *    could silently come to require many more correct clicks than intended.
 *  - Labels hid at score >= 1 while mastery needed 2, so a half-learned region
 *    lost its label.
 *  - The win check keyed off the running score, which also decrements on
 *    mistakes — so a player could master every region and still not win.
 *
 * Winning is now defined solely as "every region mastered". Score is a separate,
 * purely cosmetic tally.
 */

/** Correct clicks needed before a region is considered learned. */
export const MASTERY = 2;

/**
 * @param {string[]} names Region names, in any order.
 * @param {() => number} [random] Injectable RNG, for deterministic tests.
 */
export function createQuiz(names, random = Math.random) {
	const roster = [...new Set(names)];
	if (!roster.length) throw new Error('Cannot create a quiz with no regions');

	/** @type {Map<string, number>} correct clicks per region, floored at 0 */
	const hits = new Map(roster.map((n) => [n, 0]));

	const state = {
		score: 0,
		target: null,
		won: false,
		/** Names still needing correct clicks. */
		get remaining() {
			return roster.filter((n) => hits.get(n) < MASTERY);
		},
		/** True once a region has been clicked enough; drives label hiding. */
		mastered(name) {
			return (hits.get(name) ?? 0) >= MASTERY;
		},
		get total() {
			return roster.length;
		},
		get masteredCount() {
			return roster.length - state.remaining.length;
		}
	};

	/**
	 * Picks the next target from the unmastered regions, avoiding an immediate
	 * repeat unless it is the only one left.
	 */
	function pickTarget() {
		const remaining = state.remaining;
		if (!remaining.length) {
			state.target = null;
			state.won = true;
			return;
		}
		const choices = remaining.length > 1 ? remaining.filter((n) => n !== state.target) : remaining;
		state.target = choices[Math.floor(random() * choices.length)];
	}

	/**
	 * Records a click on `name`.
	 * @returns {{ correct: boolean, clicked: string, target: string | null, won: boolean }}
	 */
	function click(name) {
		if (state.won) return { correct: false, clicked: name, target: null, won: true };

		const correct = name === state.target;
		if (correct) {
			hits.set(name, Math.min(MASTERY, (hits.get(name) ?? 0) + 1));
			state.score++;
			pickTarget();
		} else {
			// Penalise the running score, never the target's progress — that used
			// to let mistakes inflate how many correct clicks a region demanded.
			state.score = Math.max(0, state.score - 1);
		}
		return { correct, clicked: name, target: state.target, won: state.won };
	}

	pickTarget();
	return { state, click };
}
