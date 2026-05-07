function createMockSequelize() {
  return {
    query: jest.fn(),
    QueryTypes: { SELECT: 'select', INSERT: 'insert', UPDATE: 'update' },
  };
}

function createMockModel(overrides = {}) {
  return {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    ...overrides,
  };
}

module.exports = {
  createMockSequelize,
  createMockModel,
};
