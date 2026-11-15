/**
 * Admins set the order assistants are listed in. Each assistant gets a
 * position; existing ones are numbered in title order, the order the editor
 * showed them in before. The default assistant is always listed first,
 * whatever its position.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('assistants', table => {
    table.integer('sort_order').nullable();
  });
  const rows = await knex('assistants').select('id').orderBy('title', 'asc');
  for (const [index, row] of rows.entries()) {
    await knex('assistants')
      .where({ id: row.id })
      .update({ sort_order: index });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('assistants', table => {
    table.dropColumn('sort_order');
  });
};
