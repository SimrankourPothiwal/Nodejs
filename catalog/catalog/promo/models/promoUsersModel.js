const mongoose = require('mongoose');

/**
 * Customer's Promotions
 * @type {mongoose}
 */

const promotions_user = new mongoose.Schema({
    'customer_id': {
        type: String
    },
    'promo_code': {
        type: String
    },
    'available_count': {
        type: Number
    },
    'promo_id': {
        type: String
    },
    'description': {
        'existing_user': {
            type: Boolean
        }
    },
    'is_active': {
        type: Boolean
    },
    'priority': {
        type: Number
    },
    'promo_code': {
        type: String
    },
    'promo_type': {
        type: String
    },
    'start_date': {
        type: String
    },
    'usage_limit': {
        'max': {
            type: Number
        },
        'max_per_user': {
            type: Number
        },
        'used_count': {
            type: Number
        }
    }    
}, { collection: 'promotions_user', strict: false });

function getUserPromoModel() {
    if (mongoose.models && mongoose.models.promotions_user) {
        return mongoose.models.promotions_user;
    }
    else {
        return mongoose.model('promotions_user', promotions_user);
    }
}

module.exports = getUserPromoModel();