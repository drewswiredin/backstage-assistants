/**
 * In-flight turn state, shared by every backend replica.
 *
 * `threads.turn_heartbeat_at` is set while a turn runs and refreshed by the
 * replica running it; a stale heartbeat means that replica is gone.
 * `threads.turn_cancel_requested` carries a Stop from whichever replica
 * received it to the one running the turn.
 *
 * `stream_chunks` buffers each running turn's UI message stream, so a client
 * on any replica can replay it and follow the live tail. Rows are a throwaway
 * buffer: replaced when the thread's next turn starts and deleted shortly after
 * the turn ends. `data` is `LONGTEXT` on MySQL, since one batch can carry a
 * whole tool result.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('threads', table => {
    table.timestamp('turn_heartbeat_at').nullable();
    table.boolean('turn_cancel_requested').notNullable().defaultTo(false);
  });
  await knex.schema.createTable('stream_chunks', table => {
    table.bigIncrements('id');
    table.string('thread_id', 255).notNullable();
    table.string('turn_id', 255).notNullable();
    table.text('data', 'longtext').notNullable();
    table.boolean('done').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable();

    table.index(['thread_id', 'id'], 'stream_chunks_thread_idx');
    table.index('created_at', 'stream_chunks_created_idx');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('stream_chunks');
  await knex.schema.alterTable('threads', table => {
    table.dropColumn('turn_heartbeat_at');
    table.dropColumn('turn_cancel_requested');
  });
};
