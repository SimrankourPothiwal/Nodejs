module.exports = [ 
    {
        name: 'SHIP5OFF_NEWCUSTOMER',
        desc: 'flat fee off $5 for new user sign up for 5 times',
        type: 'basket',

        entitled_order: 'all',
        entitled_product: 'all',
        entitled_user_rule: ,

        once_per_user: false,
        entitled_store_selection_rule: 'all',

        entitled_country: 'US',

        is_active: true,
        start_date: '2018-04-27T16: 45: 34.058Z',
        end_date: '2018-04-27T16:45:34.058Z',

        rules: [
            {
                type: 'delivery',
                value_type: 'actual_value',
                trigger_quantity: 1,
                trigger_sub_total: 1,
                discount_value: -5,
                allocation_method: null
            }
        ]

    },

    {
        name: '5OFF_PICKUP',
        desc: 'flat fee off $5 for new user sign up for 2 times',
        type: 'basket',

        entitled_event: 'prequisite',
        prequisite_event: ['new_sign_up', 'affiliate', 'loyalty', 'abandoned_cart'],

        entitled_order: 'all',
        entitled_product: 'all',
        entitled_user_rule: 'all',
        once_per_user: false,
        entitled_store_selection_rule: 'all',
        entitled_country: 'US',
        is_active: true,
        start_date: '2018-04-27T16: 45: 34.058Z',
        end_date: '2018-04-27T16: 45: 34.058Z',

        rules: [
            {
                type: 'pickup',
                value_type: 'actual_value',
                trigger_quantity: 1,
                trigger_sub_total: 1,
                discount_value: -5,
                allocation_method: 'each',
            }
        ]
    },

    {
        name: 'BLACKPOOL_SLURPEE_WEEKEND',
        desc: 'Buy 4 slurpee get 1 free',
        type: 'item',
        entitled_product: 'prerequisite',
        prerequisite_product_id: ['1321321-121-1' , '1321321-121-2'],
        product_matching: 'any',
        entitled_user_rule: 'all',
        once_per_user: true,
        entitled_store_selection_rule: 'all',
        entitled_country: 'US',
        is_active: true,
        start_date: '2018-04-27T16: 45: 34.058Z',
        end_date: '2018-04-27T16: 45: 34.058Z',

        rules: [
            {
                type: 'item_single',
                value_type: 'actual_value',
                trigger_quantity: 4,
                trigger_sub_total: 0.01,
                discount_value: -2,
                allocation_method: 'across'
            }
        ]
    },

    {
        name: 'STATE_COLOUMBUS',
        desc: 'BUY 2 CAKE AND GET 1 COFFEE FREE FOR TEXAS',
        type: 'item',
        entitled_product: 'prerequisite',
        prerequisite_product_id: ['1321321-121-1' , '1321321-121-2'],
        product_matching: 'any',

        entitled_user_rule: 'all',
        once_per_user: true,

        entitled_store_state: 'prerequisite',
        prerequisite_store_state: ['TX' , 'CA'],
        
        entitled_country: 'US',

        is_active: true,
        start_date: '2018-04-27T16: 45: 34.058Z',
        end_date: '2018-04-27T16: 45: 34.058Z',

        rules: [
            {
                type: 'item_single',
                value_type: 'actual_value',
                trigger_quantity: 4,
                trigger_sub_total: 0.01,
                discount_value: -2,
                allocation_method: 'across'
            }
        ]
    },


    {
        name: '10 PERC OFF',
        desc: 'earthDAY for selected',
        type: 'item',
        entitled_product: 'prerequisite',
        prerequisite_product_id: [
            '1321321-121-1',
            '1321321-121-2'
        ],
        product_matching: 'any',
        entitled_user_rule: 'all',
        once_per_user: true,
        entitled_store_state: 'prerequisite',
        prerequisite_store_state: [
            'TX',
            'CA'
        ],
        entitled_country: 'US',
        is_active: true,
        start_date: '2018-04-27T16: 45: 34.058Z',
        end_date: '2018-04-27T16: 45: 34.058Z',
        rules: [
            {
                type: 'item_single',
                value_type: 'percentage',
                trigger_quantity: 1,
                trigger_sub_total: 0,
                discount_value: -2,
                allocation_method: null
            }
        ]
    },

];

