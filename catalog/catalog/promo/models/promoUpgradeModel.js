const Joi = require('joi');

let promoSchema = {
    order_id: Joi.string().required(),
};

module.exports = {promoSchema};