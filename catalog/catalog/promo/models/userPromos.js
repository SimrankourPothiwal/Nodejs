const mongoose = require('mongoose');

/**
 * Customer's Promotions
 * @type {mongoose}
 */

const userPromoModel = new mongoose.Schema({
    'customer_id': {
        type: String, 
        required: true
    },
    'promo_id': {
        type: String
    }
}, { collection: 'promotions_user', strict: false });

function getUserPromoModel() {
    if (mongoose.models && mongoose.models.UserPromos) {
        return mongoose.models.UserPromos;
    }
    else {
        return mongoose.model('UserPromos', userPromoModel);
    }
}

module.exports = getUserPromoModel();