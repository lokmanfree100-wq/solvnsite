/**
 * What is open, and what is not.
 *
 * Anime and Cartoons are the whole site. Movies & Series are parked: no page, no
 * shelves, no tab, no rail entry and no "Soon" chip on every visit. Their three
 * addresses still land somewhere sensible — home, behind one short session note
 * (components/films-gate.js) — and the old views stay untouched in views/films/
 * for the day they open.
 *
 * One switch, so opening them is one line rather than a hunt: set FILMS_LOCKED
 * to false, put the film views back into app.js's route table, restore the
 * categories in components/cats.js, and re-add styles/movies.css to index.html.
 */
export const FILMS_LOCKED = true;
