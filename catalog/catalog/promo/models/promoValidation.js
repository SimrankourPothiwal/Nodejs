const Joi = require('joi');

const promoQueryModel = Joi.object().keys({

    // promo_code: Joi.string().required(),
    // name: Joi.string().required(),
    promo_type: Joi.string().required().valid(['item', 'basket', 'checkout']),
    country: Joi.string().required(),
    is_active: Joi.boolean().valid([true, false]).required(),

    // created_at_min: Joi.date().iso(),
    // created_at_max : Joi.date().iso(),
    // updated_at_min: Joi.date().iso(),
    // updated_at_max: Joi.date().iso(),

    starts_at_min: Joi.date().iso(),
    starts_at_max: Joi.date().iso(),
    ends_at_min: Joi.date().iso(),
    ends_at_max: Joi.date().iso(),
    // times_used_at_min: Joi.number().integer(),
    // times_used_at_max: Joi.number().integer(),
    // user_id: Joi.string()
});

const RuleModel = Joi.object({
    value_type: Joi.string().required().valid(['value_off', 'percentage_off', 'value_override']),
    discount_type: Joi.string().valid(['item_single', 'time_of_day', 'item_combo', 'shipping', 'pick_up']),
    trigger_quantity: Joi.number(),
    trigger_sub_total: Joi.number(),
    value: Joi.number(),
    allocation_method: Joi.string().valid(['each', 'across', null])
});

const promoRequestModel = Joi.object().keys({

    promo_id: Joi.string(),
    promo_code: Joi.string().required(),
    name: Joi.string().required(),
    description:  Joi.string().required(),
    promo_type: Joi.string().required().valid(['item', 'basket', 'checkout', 'order', 'user_coupon']), //'user_basket', 'user_checkout'
    country: Joi.string().required(),
    is_active: Joi.boolean().valid([true, false]).required(),
    priority: Joi.number().required(),

    entitle_order: Joi.object({
        min_quantity: Joi.number(),
        min_total: Joi.number()
    }),
    //product
    // entitled_product: Joi.string().required().valid(['all', 'prerequisite']),
    // prerequisite_product_id: Joi.array().when('entitled_product', {
    //     is: 'prerequisite',
    //     then: Joi.array().min(1)
    // }),
    // prerequisite_product_matching: Joi.string().valid(['any', 'all']),

    entitled_product: Joi.object({
        all: Joi.boolean(),
        product_id: Joi.boolean(),
    }),
    prerequisite_product_id: Joi.array(),

    usage_limit: Joi.object({
        max: Joi.number(),
        max_per_user: Joi.number(),
        used_count: Joi.number()
    }),
    available_count: Joi.number(),
    entitled_user: Joi.object({
        all: Joi.boolean(),
        guest_user: Joi.boolean(),
        existing_user: Joi.boolean(),
        new_user: Joi.boolean(),
        user_id: Joi.boolean(),
    }),
    prerequisite_user_id: Joi.array(),

    entitled_store: Joi.object({
        all: Joi.boolean(),
        store_id: Joi.boolean()
    }),
    prerequisite_store_id: Joi.array(),

    entitled_state: Joi.object({
        all: Joi.boolean(),
        state: Joi.boolean()
    }),
    prerequisite_state: Joi.array(),

    rules: Joi.array().items(RuleModel),

    start_date: Joi.string().isoDate(),
    end_date: Joi.string().isoDate(),
    user_usage_data: Joi.array()

});

const promoFindQuery = Joi.object().keys({

    is_active: Joi.boolean().valid([true, false]),
    country: Joi.string().required(),
    user_id: Joi.string(),
    promo_id: Joi.string().required(),
    promo_code: Joi.string(),
    starts_at_min: Joi.string().isoDate()
});

module.exports = {
    promoQueryModel,
    promoRequestModel,
    promoFindQuery
};