/**
 * Server-side conversation persistence: per-user threads + their messages.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('threads', table => {
    table.string('id', 255).primary();
    table.string('assistant_id', 255).notNullable();
    table.string('user_ref', 255).notNullable();
    table.string('title', 512).notNullable().defaultTo('New Chat');
    table.string('model', 255).nullable();
    table.boolean('pinned').notNullable().defaultTo(false);
    table.boolean('archived').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.timestamp('last_read_at').nullable();

    // Primary access path: a user's threads for one assistant, by recency.
    table.index(['user_ref', 'assistant_id'], 'threads_user_assistant_idx');
  });

  await knex.schema.createTable('messages', table => {
    table.string('id', 255).primary();
    table.string('thread_id', 255).notNullable();
    table.string('parent_id', 255).nullable();
    table.string('role', 64).notNullable();
    table.text('content_json').notNullable();
    table.integer('sort_order').notNullable().defaultTo(0);
    table.timestamp('created_at').notNullable();

    table.index('thread_id', 'messages_thread_idx');
    table
      .foreign('thread_id')
      .references('threads.id')
      .onDelete('CASCADE');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('messages');
  await knex.schema.dropTableIfExists('threads');
};
