/**
 * The event catalog — the contract between the API side (which sends) and the
 * worker (which consumes).
 *
 * ## Why this lives outside `src/worker/`
 * Both sides import it and neither owns it. `src/worker/**` is under a lint
 * boundary that forbids anything outside it from importing in; if the catalog
 * lived there, every producer would violate that rule and the boundary would be
 * dropped within a week. Keeping the contract in a neutral place is what lets
 * the worker be lifted into its own package (or its own container) without
 * touching a single producer.
 */
export * from './email.events';
export * from './mailer.events';
