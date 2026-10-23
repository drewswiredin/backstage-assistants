/**
 * Open questions from MCP servers (elicitation), so the user's answer can
 * reach the replica running the tool call. Once the question is settled the
 * row keeps only the action (the answer's values are dropped) until it
 * expires, so a late answer gets 410; expired rows are swept.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('mcp_elicitations', table => {
    table.string('id', 64).primary();
    table.string('user_ref', 255).notNullable();
    table.string('thread_id', 255).nullable();
    table.string('server_id', 255).notNullable();
    table.string('tool', 255).notNullable();
    table.text('requested_schema_json').notNullable();
    table.integer('attempts').notNullable().defaultTo(0);
    table.text('response_json').nullable();
    table.timestamp('expires_at').notNullable();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mcp_elicitations');
};
