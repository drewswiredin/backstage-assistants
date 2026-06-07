/**
 * Per-thread token tally for the composer's context-usage gauge: the total
 * (input + output) of the most recent completed turn. Persisted so the gauge
 * survives backend restarts — unlike the in-memory tally it replaces. Written by
 * `replaceMessages` from the assistant message's usage metadata; surfaced via
 * `GET /threads/status`.
 *
 * Backfills existing threads from their latest assistant message that already
 * carries usage metadata, so conversations that predate this column show their
 * gauge immediately rather than after their next turn.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('threads', table => {
    table.integer('last_tokens').nullable();
  });

  const threads = await knex('threads').select('id');
  for (const t of threads) {
    // Latest assistant message for the thread; first one carrying usage wins.
    const rows = await knex('messages')
      .where({ thread_id: t.id, role: 'assistant' })
      .orderBy('sort_order', 'desc')
      .select('content_json');
    for (const row of rows) {
      let usage;
      try {
        usage = JSON.parse(row.content_json)?.metadata?.usage;
      } catch {
        usage = undefined;
      }
      if (
        usage &&
        (typeof usage.inputTokens === 'number' ||
          typeof usage.outputTokens === 'number')
      ) {
        await knex('threads')
          .where({ id: t.id })
          .update({ last_tokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) });
        break;
      }
    }
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('threads', table => {
    table.dropColumn('last_tokens');
  });
};
