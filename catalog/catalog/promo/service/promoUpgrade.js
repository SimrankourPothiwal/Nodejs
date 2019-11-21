// Required files and modulues
//const mongoose = require('mongoose'); mongoose.set('debug', true);
const Joi = require('joi');
const constants = require('../../catalog/utilities/constants/constants_en_us');
const promoModel = require('../models/promoModel');
const promoUpgradeModel = require('../models/promoUpgradeModel');
const promoUsersModel = require('../models/promoUsersModel');
const Validator = require('../utilities/validators/validator');
const orderModel = require('../models/orderModel');

// Alcohol Service Class
class PromoService {
    constructor(logger) {
        this.logger = logger;
        this.validator = new Validator(logger);
    }

    promoUpgrade(body, callback) {
        // Validation 
        let payload;
        let self = this;
        const validator = this.validator;
        payload = validator.validatePayload(body);
        if (payload instanceof Error) {
            return callback(payload);
        }

        let promoValidation;
        promoValidation = Joi.validate(payload, promoUpgradeModel.promoSchema);

        if (promoValidation.error) {
            console.log('PromoRequestValidationError--------->', promoValidation.error);
            let error = { ErrorDetails: promoValidation.error };
            return callback(null, error);
        }

        let orderID;
        if (payload.order_id) {
            orderID = payload.order_id.trim();
        }

        orderModel.findOne({ 'order_id': orderID }).lean(true).exec(function (err, orderDoc) {
            let customerID;
            let promoCode;
            console.log('orderDoc--------->', orderDoc);
            if (orderDoc && orderDoc.user_profile && orderDoc.promo_details) {
                customerID = orderDoc.user_profile.customer_id;
                promoCode = orderDoc.promo_details.promos[0].promo_code;
                console.log('promoCode--------->', promoCode);
                promoUsersModel.findOneAndUpdate({ 'promo_code': promoCode, 'available_count': { $lt: 2 }, 'customer_id': { $in: [customerID] } }, { $inc: { 'available_count': 1 } }, { new: true}, (err, promoDoc) => {
                    console.log('promoDoc--------->', promoDoc, 'promoDocErr--------->', err);
                    if (err) {
                        return callback(null, err);
                    }
                    else if (promoDoc) {
                        return callback(null, promoDoc);
                    }
                    else {
                        let message = promoCode + ' could not be applied for the order';
                        let displayObject = {error_message: message}; 
                        return callback(null, displayObject);
                    }
                });
            }
            else {
                let displayObject = {};
                displayObject.error_message = 'No promotions found for the ORDER ID';
                return callback(null, displayObject);
            }
        });
    }
}
// Export Alcohol Service Module
module.exports = PromoService;
