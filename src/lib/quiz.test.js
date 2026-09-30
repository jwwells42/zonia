import { describe, it, expect } from 'vitest';
import { createQuiz, MASTERY, SCAFFOLD, SPACING } from './quiz.js';

/** Deterministic RNG so target selection is reproducible. */
const seeded = (values) => {
	let i = 0;
	return () => values[i++ % values.length];
};

/** Plays perfectly until the quiz is won, guarding against a runaway loop. */
function playThrough(quiz, limit = 500) {
	let clicks = 0;
	while (!quiz.state.won && clicks < limit) {
		quiz.click(quiz.state.target);
		clicks++;
	}
	return clicks;
}

describe('createQuiz', () => {
	it('starts with a target drawn from the roster', () => {
		const quiz = createQuiz(['Alpha', 'Beta', 'Gamma']);
		expect(['Alpha', 'Beta', 'Gamma']).toContain(quiz.state.target);
		expect(quiz.state.score).toBe(0);
		expect(quiz.state.won).toBe(false);
	});

	it('deduplicates the roster', () => {
		const quiz = createQuiz(['Alpha', 'Alpha', 'Beta']);
		expect(quiz.state.total).toBe(2);
	});

	it('rejects an empty roster', () => {
		expect(() => createQuiz([])).toThrow();
	});

	it('needs MASTERY correct clicks before a region counts as learned', () => {
		const quiz = createQuiz(['Alpha']);
		expect(quiz.state.mastered('Alpha')).toBe(false);
		for (let i = 0; i < MASTERY; i++) quiz.click('Alpha');
		expect(quiz.state.mastered('Alpha')).toBe(true);
	});

	it('does not master a region on one correct click', () => {
		const quiz = createQuiz(['Alpha']);
		quiz.click('Alpha');
		expect(quiz.state.mastered('Alpha')).toBe(false);
		expect(quiz.state.remaining).toContain('Alpha');
	});

	it('shows a name until the region has been found once', () => {
		const quiz = createQuiz(['Alpha']);
		expect(quiz.state.scaffolded('Alpha')).toBe(true);
		quiz.click('Alpha');
		expect(quiz.state.scaffolded('Alpha')).toBe(false);
	});

	it('drops the scaffold before mastery, not with it', () => {
		// The whole point of the progression: one unaided click has to remain
		// after the name goes away, or the label never helps anyone.
		expect(SCAFFOLD).toBeLessThan(MASTERY);
		const quiz = createQuiz(['Alpha']);
		quiz.click('Alpha');
		expect(quiz.state.scaffolded('Alpha')).toBe(false);
		expect(quiz.state.mastered('Alpha')).toBe(false);
	});

	it('keeps the name up after a wrong answer', () => {
		// Wrong answers cost score and nothing else. Taking the scaffold away for
		// guessing would punish the student exactly when they need the help.
		const quiz = createQuiz(['Alpha', 'Beta']);
		const wrong = quiz.state.target === 'Alpha' ? 'Beta' : 'Alpha';
		quiz.click(wrong);
		expect(quiz.state.scaffolded('Alpha')).toBe(true);
		expect(quiz.state.scaffolded('Beta')).toBe(true);
	});

	it('scaffolds each region independently', () => {
		const quiz = createQuiz(['Alpha', 'Beta'], seeded([0]));
		const first = quiz.state.target;
		quiz.click(first);
		const other = first === 'Alpha' ? 'Beta' : 'Alpha';
		expect(quiz.state.scaffolded(first)).toBe(false);
		expect(quiz.state.scaffolded(other)).toBe(true);
	});

	it('wins only when every region is mastered', () => {
		const quiz = createQuiz(['Alpha', 'Beta', 'Gamma']);
		const clicks = playThrough(quiz);
		expect(quiz.state.won).toBe(true);
		expect(clicks).toBe(3 * MASTERY);
		expect(quiz.state.masteredCount).toBe(3);
	});

	it('still wins after mistakes, which the old score-based check could not', () => {
		// Score used to drive the win condition while also decrementing on errors,
		// so a careless player could master everything and never be told they won.
		const quiz = createQuiz(['Alpha', 'Beta']);
		for (let i = 0; i < 10; i++) {
			const wrong = quiz.state.target === 'Alpha' ? 'Beta' : 'Alpha';
			quiz.click(wrong);
		}
		expect(quiz.state.score).toBe(0);
		playThrough(quiz);
		expect(quiz.state.won).toBe(true);
	});

	it('never lets wrong answers add work to the quiz', () => {
		// A wrong click used to decrement the target's own progress with no floor,
		// so mistakes silently inflated how many correct clicks a region demanded.
		// The invariant: winning always costs exactly total * MASTERY correct
		// clicks, no matter how badly the player flails first.
		const quiz = createQuiz(['Alpha', 'Beta', 'Gamma']);
		for (let i = 0; i < 30; i++) {
			const wrong = quiz.state.remaining.find((n) => n !== quiz.state.target);
			quiz.click(wrong);
		}
		expect(playThrough(quiz)).toBe(3 * MASTERY);
	});

	it('floors the score at zero', () => {
		const quiz = createQuiz(['Alpha', 'Beta']);
		const wrong = quiz.state.target === 'Alpha' ? 'Beta' : 'Alpha';
		quiz.click(wrong);
		quiz.click(wrong);
		expect(quiz.state.score).toBe(0);
	});

	it('clears the target on winning instead of leaving it undefined', () => {
		// Emptying the roster used to leave target undefined, and the next click
		// threw on a lookup of that undefined name.
		const quiz = createQuiz(['Alpha']);
		playThrough(quiz);
		expect(quiz.state.target).toBeNull();
		expect(() => quiz.click('Alpha')).not.toThrow();
	});

	it('ignores clicks after the win', () => {
		const quiz = createQuiz(['Alpha']);
		playThrough(quiz);
		const result = quiz.click('Alpha');
		expect(result.won).toBe(true);
		expect(quiz.state.score).toBe(MASTERY);
	});

	it('avoids repeating the target while others remain', () => {
		const quiz = createQuiz(['Alpha', 'Beta', 'Gamma'], seeded([0]));
		const first = quiz.state.target;
		quiz.click(first);
		expect(quiz.state.target).not.toBe(first);
	});

	it('keeps a region away for SPACING turns once it has been asked', () => {
		const names = Array.from({ length: 60 }, (_, i) => `Region ${i}`);
		for (let game = 0; game < 50; game++) {
			const quiz = createQuiz(names);
			const last = new Map();
			let turn = 0;
			while (!quiz.state.won) {
				const target = quiz.state.target;
				// The cap shrinks to half of what is left, so only check while the
				// full spacing is still on offer.
				if (last.has(target) && quiz.state.remaining.length >= 2 * SPACING) {
					expect(turn - last.get(target)).toBeGreaterThan(SPACING);
				}
				last.set(target, turn++);
				quiz.click(target);
			}
		}
	});

	it('does not repeat the first round in order in a small quiz', () => {
		// Spacing by the full cap would leave one choice a turn here, and the
		// second round would be the first again.
		const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
		let sameOrder = 0;
		for (let game = 0; game < 200; game++) {
			const quiz = createQuiz(names);
			const order = [];
			while (!quiz.state.won) {
				order.push(quiz.state.target);
				quiz.click(quiz.state.target);
			}
			if (order.slice(0, 5).join() === order.slice(5).join()) sameOrder++;
		}
		expect(sameOrder).toBeLessThan(200);
	});

	it('moves on from a revealed target without counting it', () => {
		const quiz = createQuiz(['Alpha', 'Beta', 'Gamma']);
		const shown = quiz.state.target;
		expect(quiz.reveal()).toBe(shown);
		const result = quiz.click(shown);
		expect(result).toMatchObject({ correct: false, revealed: true, clicked: shown });
		expect(quiz.state.score).toBe(0);
		expect(quiz.state.masteredCount).toBe(0);
		// Still unfound, so its name still shows next time.
		expect(quiz.state.scaffolded(shown)).toBe(true);
		expect(quiz.state.remaining).toContain(shown);
		expect(quiz.state.target).not.toBe(shown);
	});

	it('does not change the target by revealing it, and forgets it on the next one', () => {
		const quiz = createQuiz(['Alpha', 'Beta', 'Gamma']);
		const shown = quiz.state.target;
		quiz.reveal();
		expect(quiz.state.target).toBe(shown);
		expect(quiz.state.revealed).toBe(true);
		quiz.click(shown);
		expect(quiz.state.revealed).toBe(false);
	});

	it('treats a wrong click as wrong while a target is revealed', () => {
		const quiz = createQuiz(['Alpha', 'Beta']);
		quiz.click(quiz.state.target);
		expect(quiz.state.score).toBe(1);
		quiz.reveal();
		const wrong = quiz.state.target === 'Alpha' ? 'Beta' : 'Alpha';
		expect(quiz.click(wrong)).toMatchObject({ correct: false, revealed: false });
		expect(quiz.state.score).toBe(0);
	});

	it('never lets reveals change what winning costs', () => {
		// The same invariant as for wrong answers: winning always takes exactly
		// total * MASTERY correct clicks, however many answers were shown first.
		const quiz = createQuiz(['Alpha', 'Beta', 'Gamma']);
		for (let i = 0; i < 10; i++) {
			quiz.reveal();
			quiz.click(quiz.state.target);
		}
		expect(quiz.state.score).toBe(0);
		expect(playThrough(quiz)).toBe(3 * MASTERY);
	});

	it('reveals nothing once won', () => {
		const quiz = createQuiz(['Alpha']);
		playThrough(quiz);
		expect(quiz.reveal()).toBeNull();
		expect(quiz.state.revealed).toBe(false);
	});

	it('repeats the target when it is the only one left', () => {
		const quiz = createQuiz(['Alpha']);
		const first = quiz.state.target;
		quiz.click(first);
		expect(quiz.state.target).toBe(first);
	});

	it('reports progress as regions are learned', () => {
		const quiz = createQuiz(['Alpha', 'Beta']);
		const seen = [quiz.state.masteredCount];
		while (!quiz.state.won) {
			quiz.click(quiz.state.target);
			seen.push(quiz.state.masteredCount);
		}
		// Four correct clicks over two regions: 0 learned, then 1, then both.
		expect(seen).toEqual([0, 0, 0, 1, 2]);
	});
});
