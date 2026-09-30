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
 *  - The win check keyed off the running score, which also decrements on
 *    mistakes. A player could master every region and still not win.
 *
 * Winning is now defined solely as "every region mastered". Score is a separate,
 * purely cosmetic tally.
 */

/** Correct clicks needed before a region is considered learned. */
export const MASTERY = 2;

/**
 * Correct clicks after which a region stops showing its name.
 *
 * Deliberately lower than MASTERY, and deliberately a separate idea. The first
 * time a student meets a region its name is on the map, so finding it is a
 * search. After that the name is gone, so finding it again is recall. The
 * scaffold is there for the trial that builds the memory and absent for the
 * trial that tests it.
 *
 * An earlier pass treated a half-learned region losing its label as a bug and
 * moved label hiding to MASTERY. That was reasoning about internal consistency
 * rather than teaching, and it meant the label only ever vanished at the moment
 * the region was already finished, which is too late to be worth anything.
 */
export const SCAFFOLD = 1;

/**
 * Turns a region stays out of rotation after it is asked, at most.
 *
 * Classes reported the same country coming back two turns later, sometimes
 * twice. Only an immediate repeat was blocked, and on /world a perfect player
 * met a region again within three turns about four times a game. That is worse
 * than annoying. The second ask is the unaided one, and two turns later the
 * answer is still in mind, so it tests nothing.
 *
 * Half the regions still in play is the cap in a small quiz. A full cap there
 * would leave one choice each turn, and the second round would repeat the
 * first in the same order.
 */
export const SPACING = 10;

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
		/** True once the current target has been shown to the player. See `reveal`. */
		revealed: false,
		/** Names still needing correct clicks. */
		get remaining() {
			return roster.filter((n) => hits.get(n) < MASTERY);
		},
		/** True once a region has been clicked enough; drives the win condition. */
		mastered(name) {
			return (hits.get(name) ?? 0) >= MASTERY;
		},
		/** True while a region should still show its name to the student. */
		scaffolded(name) {
			return (hits.get(name) ?? 0) < SCAFFOLD;
		},
		get total() {
			return roster.length;
		},
		get masteredCount() {
			return roster.length - state.remaining.length;
		}
	};

	/** Every target so far, oldest first. */
	const asked = [];

	/**
	 * Picks the next target from the unmastered regions, leaving out the ones
	 * asked most recently. See SPACING.
	 */
	function pickTarget() {
		const remaining = state.remaining;
		if (!remaining.length) {
			state.target = null;
			state.won = true;
			return;
		}
		const gap = Math.min(SPACING, Math.floor(remaining.length / 2));
		const recent = asked.slice(Math.max(0, asked.length - gap));
		const choices = remaining.filter((n) => !recent.includes(n));
		state.target = choices[Math.floor(random() * choices.length)];
		state.revealed = false;
		asked.push(state.target);
	}

	/**
	 * Shows the player the current target. A click on it then moves on and
	 * counts for nothing.
	 *
	 * The player saw the answer rather than finding it, so it earns no score and
	 * no progress. The region stays in play and comes back after SPACING turns,
	 * to be found for real.
	 *
	 * @returns {string | null} The target that was revealed.
	 */
	function reveal() {
		if (state.won || !state.target) return null;
		state.revealed = true;
		return state.target;
	}

	/**
	 * Records a click on `name`.
	 * @returns {{ correct: boolean, revealed: boolean, clicked: string,
	 *   target: string | null, won: boolean }}
	 */
	function click(name) {
		if (state.won) {
			return { correct: false, revealed: false, clicked: name, target: null, won: true };
		}

		if (state.revealed && name === state.target) {
			pickTarget();
			return { correct: false, revealed: true, clicked: name, target: state.target, won: false };
		}

		const correct = name === state.target;
		if (correct) {
			hits.set(name, Math.min(MASTERY, (hits.get(name) ?? 0) + 1));
			state.score++;
			pickTarget();
		} else {
			// Penalise the running score, never the target's progress. That used
			// to let mistakes inflate how many correct clicks a region demanded.
			state.score = Math.max(0, state.score - 1);
		}
		return { correct, revealed: false, clicked: name, target: state.target, won: state.won };
	}

	pickTarget();
	return { state, click, reveal };
}
