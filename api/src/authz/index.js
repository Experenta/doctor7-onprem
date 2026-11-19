'use strict';

const { can, listScope, ROLES, RESOURCES, ACTIONS, MATRIX } = require('./policy');
const { createAuthzGate, ROUTE_RULES } = require('./gate');

module.exports = { can, listScope, ROLES, RESOURCES, ACTIONS, MATRIX, createAuthzGate, ROUTE_RULES };
