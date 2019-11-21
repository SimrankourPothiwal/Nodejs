const mongoose = require('mongoose');
const expect = require('chai').expect;
const CONFIG_TEST_MONGODB = require('./../../test/config.js').test.DB_CONNECTION_URL;
const PromoModel = require('./promoModel');

describe('used case for promo', () => {

    before(() => {
        //mongoose.set('debug', true);
        process.env.DEPLOYMENT_STAGE = 'test';
        process.env.DB_CONNECTION_URL = CONFIG_TEST_MONGODB;
        require('./../../catalog/dbClient')();
    });
    after(() => {

        if (mongoose.connection) {
            console.log('Closing db connection');
            mongoose.connection.close();
        }
    });

    it('delivery fees waived between start date and end date' , (done) => {

        let data = {
            type: 'delivery',
            user_usage_limit_flag: true,
            usage_limit_per_user: 200,
            product_id: ['100052-3-5-18', '101538-4-2-6', '100090-1-0-1' ],
            product_matching: 'any',
            name: 'HappyPartyWeak',
            desc: 'Let Celeberate',
            usage_limit: 2000,
            used_count: 0,
            entitled_store_state: ['Global'],
            entitled_country: 'USA',
            is_active: true,
            start_date: new Date,
            end_date: new Date,
            update_at: new Date,
            rules: [
                {
                    type: 'item_single',
                    value_type: 'percentage',
                    discount_value: 100,
                    trigger_quantity: 1,
                    trigger_sub_total: 1,
                    allocation_method: null
                }
            ],
        };

        PromoModel.findOneAndUpdate({ name: 'HappyPartyWeak'}, data, {new: true, upsert: true} , (err, res) => {

            expect(err).to.be.null;
            console.log('--*' + res);
            done();
        });
    });

    it('delivery fees waived between start date and end date, remove new product', (done) => {

        mongoose.set('debug', true);
        PromoModel.update(
            { _id: '5ad7b278da68a8bc9a680db4'},
            { $pull: { product_id: '100052-3-5-18'}}, 
            (err, res) => {
            expect(err).to.be.null;
            console.log('---->' + JSON.stringify(res));
            done();
        });
    });

    it('delivery fees waived between start date and end date, add new product', (done) => {

        mongoose.set('debug', true);
        PromoModel.update(
            { _id: '5ad7b278da68a8bc9a680db4' },
            { $push: { product_id: '100052-3-5-18' } },
            (err, res) => {
                expect(err).to.be.null;
                console.log('---->' + JSON.stringify(res));
                done();
            });
    });

    it('delivery fees waived , if Spend $xx.yy', (done) => {

        let data = {
            type: 'delivery',
            user_usage_limit_flag: true,
            usage_limit_per_user: 1,
            product_id: [],
            product_matching: 'any',
            name: 'HappyDelivery',
            desc: 'Let Cool down',
            usage_limit: 2000,
            used_count: 0,
            entitled_store_state: ['Global'],
            entitled_country: 'USA',
            is_active: true,
            start_date: new Date,
            end_date: new Date,
            update_at: new Date,
            rules: [
                {
                    type: 'item_single',
                    value_type: 'percentage',
                    discount_value: 100,
                    trigger_quantity: 1,
                    trigger_sub_total: 19.99,
                    allocation_method: null
                }
            ],
        };

        PromoModel.findOneAndUpdate({ name: 'HappyDelivery' }, data, { new: true, upsert: true }, (err, res) => {

            expect(err).to.be.null;
            console.log('---->' + res);
            done();
        });
    });


    it('FAIL: if you order more than one product, you get something for free eg buy 2 pizza get one coke free', (done) => {

        let data = {
            type: 'item',
            user_usage_limit_flag: true,
            usage_limit_per_user: 1,
            product_id: ['100052-3-5-18', ''],
            product_matching: 'all',
            name: 'HappyEaster',
            desc: 'Coke',
            usage_limit: 2000,
            used_count: 0,
            entitled_store_state: ['Global'],
            entitled_country: 'USA',
            is_active: true,
            start_date: new Date,
            end_date: new Date,
            update_at: new Date,
            rules: [
                {
                    type: 'item_single',
                    value_type: '',
                    discount_value: 0,
                    trigger_quantity: 4,
                    trigger_sub_total: 0,
                    allocation_method: null,
                    product_id: [],
                    product_matching: 'any',
                }
            ],
        };

        PromoModel.findOneAndUpdate({ name: 'HappyEaster' }, data, { new: true, upsert: true }, (err, res) => {

            expect(err).to.be.null;
            console.log('---->' + res);
            done();
        });
    });

    it('Bundle Items', (done) => {

        let data = {
            type: 'item',
            user_usage_limit_flag: true,
            usage_limit_per_user: 1,
            product_id: ['100052-3-5-18', '101538-4-2-6'],
            product_matching: 'all',
            name: 'HappyBundle',
            desc: 'Coke',
            usage_limit: 2000,
            used_count: 0,
            entitled_store_state: ['Global'],
            entitled_country: 'USA',
            is_active: true,
            start_date: new Date,
            end_date: new Date,
            update_at: new Date,
            rules: [
                {
                    type: 'item_single',
                    value_type: 'actual_value',
                    discount_value: -0.50,
                    trigger_quantity: 1,
                    trigger_sub_total: 0,
                    allocation_method: null
                }
            ],
        };

        PromoModel.findOneAndUpdate({ name: 'HappyBundle' }, data, { new: true, upsert: true }, (err, res) => {

            expect(err).to.be.null;
            console.log('---->' + res);
            done();
        });
    });
});

describe('various post request', () => {

    before(() => {
        //mongoose.set('debug', true);
        process.env.DEPLOYMENT_STAGE = 'test';
        process.env.DB_CONNECTION_URL = CONFIG_TEST_MONGODB;
        require('./../../catalog/dbClient')();
    });
    after(() => {

        if (mongoose.connection) {
            console.log('Closing db connection');
            mongoose.connection.close();
        }
    });

    it(' post request to create new promo `flat fee off $5 for new user sign up for 5 times`' , (done) => {

        let post = {

            'type': 'delivery', //apply on order

            'entitled_order': 'all',
            'entitled_order_type': [],
            

            'entitled_product': 'all',
            'prerequisite_product_id': [],
            'prerequisite_product_matching': ['any'],

            'name': 'SHIP5OFF',
            'desc': 'flat fee off $5 for new user sign up for 5 times',
            'usage_limit': 50000,
            'used_count': 0,

            //user based
            'entitled_user_rule': 'all',
            'once_per_user': false,
            'usage_limit_per_user': 7,

            //location based
            'entitled_store_selection_rule': 'all',
            'prerequisite_store_id': [],
            'prerequisite_store_state': [],
            'entitled_country': 'US',

            'is_active': true,
            'start_date': new Date(),
            'end_date': new Date(),
            'update_at': new Date(),
            'rules': [
                { 
                    type: 'delivery',
                    value_type: 'actual_value',
                    trigger_quantity: 1,
                    trigger_sub_total: 1,
                    discount_value: -5
                }
            ]
        };

        //engine if the order is entitled
        //engine if the product is eligble
        //engine depending based on the rule
        //will update the product and rule map collection
        //order type and rule

        return Object;
    });

    it(' get promo details admin page', (done) => {

        let post = {
            name: '',
        };

        //engine if the order is entitled
        //engine if the product is eligble
        //engine depending based on the rule
        //will update the product and rule map collection
        //order type and rule

        return Object;
    });

    it('search promo details admin page', (done) => {

        let post = {
            query: {
                promo_type: 'delivery'
            },
        };

        let post = {
            query: {
                'promo_type': 'delivery',
                'entitled_product': 'all'
            },
        };


        //engine if the order is entitled
        //engine if the product is eligble
        //engine depending based on the rule
        //will update the product and rule map collection
        //order type and rule

        return Object;
    });


});