const Ajv2020 = require('ajv/dist/2020');

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  coerceTypes: true,
  useDefaults: true,
});

function formatErrors(errors = []) {
  return errors.map((err) => ({
    path: err.instancePath || err.schemaPath,
    message: err.message,
    keyword: err.keyword,
  }));
}

function validateSchema(schema, location = 'body') {
  const validate = ajv.compile(schema);
  return (req, res, next) => {
    const data = req[location] || {};
    const ok = validate(data);
    if (!ok) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        details: formatErrors(validate.errors),
      });
    }
    return next();
  };
}

module.exports = {
  validateBody: (schema) => validateSchema(schema, 'body'),
  validateQuery: (schema) => validateSchema(schema, 'query'),
  validateParams: (schema) => validateSchema(schema, 'params'),
};
