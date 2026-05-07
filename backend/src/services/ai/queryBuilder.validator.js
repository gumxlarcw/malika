const Ajv2020 = require('ajv/dist/2020');
const schema = require('./queryBuilder.schema.json');

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
const validate = ajv.compile(schema);

function validateQueryBuilderOutput(data) {
  const ok = validate(data);
  return { ok: Boolean(ok), errors: validate.errors || [] };
}

module.exports = {
  validateQueryBuilderOutput,
};
