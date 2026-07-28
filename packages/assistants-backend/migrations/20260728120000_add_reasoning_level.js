/**
 * Per-thread reasoning effort, alongside the thread's model. A conversation
 * keeps the level it was set to, so reopening it resumes at the same effort
 * rather than silently dropping back to the provider default.
 *
 * Nullable with no backfill: null means "never chosen", which the backend reads
 * as send-nothing — existing threads keep behaving exactly as they do today.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('threads', table => {
    table.string('reasoning_level').nullable();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('threads', table => {
    table.dropColumn('reasoning_level');
  });
};
