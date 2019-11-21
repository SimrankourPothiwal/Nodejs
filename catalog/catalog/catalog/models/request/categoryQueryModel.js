/**
 * Query parameters validation for categories endpoint
 * 
 * @author: Murali Ramachari <murali.ramachari@7-11.com>
 */

const Joi = require('joi');

module.exports = {
    state: Joi.string(),
    city: Joi.string(),
    store_id: Joi.string()
};