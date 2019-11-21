//currently supported 
module.exports = { 
    search1: { 
        "page_per_limit" : 5,
        "page" : 1,

        "created_at_min" : "2017-03-25T16: 15: 47-04: 00",
        "created_at_max " : "2017-03-25T16: 15: 47-04: 00",
        "updated_at_min" : "2017-03-25T16: 15: 47-04: 00",
        "updated_at_max" : "2017-03-25T16: 15: 47-04: 00",
        "starts_at_min" : "2017-03-25T16: 15: 47-04: 00",
        "starts_at_max" :  "2017-03-25T16: 15: 47-04: 00",
        "ends_at_min" :  "2017-03-25T16: 15: 47-04: 00",
        "ends_at_max" : "2017-03-25T16: 15: 47-04: 00",
        "times_used_at_min" : 10,
        "times_used_at_max": 10,

        "is_active" : true,
        "states" : [],
        "country": null,

        "name" : null,


        "promo_type": "delivery",
        "entitled_order": "all or prerequisite",
        "prerequisite_order_type": ["delivery" "pickup"],

        "entitled_product": "all or entitle",
        "prerequisite_product_id": [],
        "prerequisite_product_matching": ["any" , "all"],

        "rules_attribute": {
            "value_type": "perc",
            "type": "delivery"
        }
    },

    search2: {
        "limit": 5,
        "page": 1,
        "created_at_min": "2017-03-25T16: 15: 47-04: 00",
        "created_at_max ": "2017-03-25T16: 15: 47-04: 00",
        "country": "US",
        "is_active": true
    }
};