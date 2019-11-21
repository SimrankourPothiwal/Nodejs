const mongoose = require('mongoose');

const rulesSchema = new mongoose.Schema({

    'discount_type': {
        type: String,
        required: true,
        enum: ['item_single', 'time_of_day', 'item_combo', 'shipping', 'pick_up', 'current_basket', 'end_date']
    },
    'value_type': {
        type: String,
        required: true,
        enum: ['value_off', 'percentage_off', 'value_override', 'days_to_expire']
    },
    value: Number,
    allocation_method: {
        type: String,
        required: true,
        enum: ['each', 'across'],
    }
});

const promoSchema = new mongoose.Schema({
    promo_id: { type: String, required: true },
    promo_code: { type: String, required: true }, 
    name: { type: String, required: true},//Marketing friendly name
    description: { type: String, required: true }, // description
    promo_type: {
        type: String,
        enum: ['item', 'basket', 'checkout', 'order', 'user_coupon']
    },//item or basket or checkout
    country: String,
    is_active: Boolean,
    priority: Number,
    start_date: Date,
    end_date: Date,

    entitle_order: {
        min_quantity: { type: Number, default: 0 },
        min_total: { type: Number, default: 0 },
    },

    entitled_product: {
        all: Boolean,
        product_id: Boolean
    },
    prerequisite_product_id: Array,
    //prerequisite_product_matching: { type: String, required: true , enum: ['any' , 'all']}, //Any or all

    usage_limit: {
        max: { type: Number, required: true , default: -1 },
        max_per_user: { type: Number, required: true, default: 0 },
        used_count: { type: Number, required: true , default: 0}, //stat of the promotion used
        //once_per_customer: { type: Boolean, required: true, default: true },
    },

    entitled_user: {
        all: Boolean,
        guest_user: Boolean,
        existing_user: Boolean,
        new_user: Boolean,
        user_id: Boolean,
    },
    prerequisite_user_id: Array,

    entitled_store: {
        all: Boolean,
        store_id: Boolean
    },
    prerequisite_store_id: Array,

    entitled_store_state: {
        all: Boolean,
        store_state: Boolean
    },
    prerequisite_store_state: [],

    entitle_user_promo: {
        promo_code_not_permitted : Boolean,
        promo_code_permitted: Boolean
    },
    prerequisite_promo_code_not_permitted: Array,
    prerequisite_promo_code_permitted: Array,

    rules: [ rulesSchema ]

}, { collection: 'promos', timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'} } );

function promoModel() {
    if (mongoose.models && mongoose.models.promo) {
        return mongoose.models.promo;
    } else {
        return mongoose.model('promo', promoSchema);
    }
}

module.exports = promoModel();