const mongoose = require('mongoose');
const expect = require('chai').expect;
const CONFIG_TEST_MONGODB = require('./../../test/config.js').dev.DB_CONNECTION_URL;
const PromoService = require('./PromoService');
const userModel = require('./../models/userPromos');
const promoModel = require('./../models/promoModel');
const async = require('async');

/* global it, describe, before, after */
describe('promo service test', () => {

    let service;

    before((done) => {
        let logger = {
            error: function () { },
            info: function () { },
            debug: function () { }
        };
        process.env.DEPLOYMENT_STAGE = 'dev';
        process.env.DB_CONNECTION_URL = CONFIG_TEST_MONGODB;
        require('./../../catalog/dbClient')();
        let promoDef = require('./../../test/fixtures/promo/promo_data/7FreeShippingNew.json');
        service = new PromoService(logger);
        let currentDate = new Date();
        let previousDate = new Date(currentDate);
        let nextDate = new Date(currentDate);
        previousDate.setDate(currentDate.getDate() - 1);
        nextDate.setDate(currentDate.getDate() + 1);
        async.series([
            function (doneCall) {
                userModel.findOneAndUpdate({
                    'customer_id': '17b22f29-bd4f-4dc9-83ec-8fc1fb00034',
                    'promo_id': '5af1c07d5542fc9307847a6a'
                }, {
                    'customer_id': '17b22f29-bd4f-4dc9-83ec-8fc1fb00034',
                    'promo_id': '5af1c07d5542fc9307847a6a',
                    'promo_code': '7FreeShipping',
                    'description': 'You got free shipping...! Order today!',
                    'start_date': previousDate.toISOString(),
                    'end_date': nextDate.toISOString(),
                    'priority': 10,
                    'usage_limit': {
                            'max': -1,
                            'max_per_user': 7,
                            'used_count': 121411
                        },
                    'available_count': 4
                }, () => {
                        doneCall();
                    });
            },
            function (doneCall) {
                //7 Free promo
                promoDef.start_date = previousDate.toISOString();
                promoDef.end_date = nextDate.toISOString();
                promoModel.findOneAndUpdate({
                    'promo_id': '5af1c07d5542fc9307847a6a'
                }, promoDef, () => {
                    doneCall();
                });
            },
            function (doneCall) {
                //399 Free promo
                promoDef = require('./../../test/fixtures/promo/promo_data/399DeliveryNew.json');
                promoDef.start_date = previousDate.toISOString();
                promoDef.end_date = nextDate.toISOString();
                promoModel.findOneAndUpdate({
                    'promo_id': '5af1c1005542fc7fe3847a6c'
                }, promoDef, () => {
                    doneCall();
                });
            },
        ], () => {
            done();
        });
    });

    after((done) => { if (mongoose.connection) { console.log('Closing db connection'); mongoose.connection.close(); } done(); });

    it(' user claims ', (done) => {
        let res = {
            user_claims: {
                customer_id: 'd0f76ddf-0ee5-4d1c-a26b-c55768df9187',
                scope: ['guest'],
                iat: 1525884044
            }
        };
        service._parseUserClaimForType(res)((err, res) => {
            expect(err).to.be.null;
            expect(res).to.be.not.null;
            done();
        });//Valid setup - full discount

    });

    it('parse user profile guest', (done) => {
        let res = {
            user_profile: {
                customer_id: 'd0f76ddf-0ee5-4d1c-a26b-c55768df9187',
                is_guest: 'Y'
            },
            user_claims: null
        };
        service._parseUserClaimForType(res)((err, res) => {
            expect(err).to.be.null;
            expect(res).to.be.not.null;
            done();
        });
    });

    it('parse user profile not guest', (done) => {
        let res = {
            user_profile: {
                customer_id: 'd0f76ddf-0ee5-4d1c-a26b-c55768df9187',
                is_guest: 'N'
            },
            user_claims: null
        };
        service._parseUserClaimForType(res)((err, res) => {
            expect(err).to.be.null;
            expect(res).to.be.not.null;
            done();
        });
    });

    it('parse req with no user_claims or user_profile', (done) => {
        let res = {
        };
        service._parseUserClaimForType(res)((err, res) => {
            expect(err).to.be.null;
            expect(res).to.be.not.null;
            done();
        });
    });

    it('applySingleValueDiscount - value_type = value_override', (done) => {
        let result = service.singleValueDiscount({ value_type: 'value_override', value: 0 }, 5);//Valid setup - full discount
        expect(result).to.be.eq(0);

        result = service.singleValueDiscount({ value_type: 'value_override', value: 2 }, 5);//Valid setup - flat fee
        expect(result).to.be.eq(2);

        result = service.singleValueDiscount({ value_type: 'value_override', value: -1 }, 5);//Wrong setup - no discount applied
        expect(result).to.be.eq(5);

        result = service.singleValueDiscount({ value_type: 'unknown type', value: -1 }, 5);//Unknown type - no discount applied
        expect(result).to.be.eq(5);

        done();
    });

    it('applySingleValueDiscount - value_type = percentage_off', (done) => {
        let result = service.singleValueDiscount({ value_type: 'percentage_off', value: 10 }, 500);//Valid setup - 10% discount
        expect(result).to.be.eq(450);

        result = service.singleValueDiscount({ value_type: 'percentage_off', value: 100 }, 500);//Valid setup - 100% discount
        expect(result).to.be.eq(0);

        result = service.singleValueDiscount({ value_type: 'percentage_off', value: -1 }, 5);//Wrong setup - no discount applied
        expect(result).to.be.eq(5);

        result = service.singleValueDiscount({ value_type: 'unknown type', value: -1 }, 5);//Unknown type - no discount applied
        expect(result).to.be.eq(5);

        done();
    });

    it('applySingleValueDiscount - value_type = value_off', (done) => {
        let result = service.singleValueDiscount({ value_type: 'value_off', value: 100 }, 500);//Valid setup - $1 off
        expect(result).to.be.eq(400);

        result = service.singleValueDiscount({ value_type: 'value_off', value: 1000 }, 500);//Valid setup - more $ off than price
        expect(result).to.be.eq(0);

        result = service.singleValueDiscount({ value_type: 'value_off', value: -1 }, 5);//Wrong setup - no discount applied
        expect(result).to.be.eq(5);

        result = service.singleValueDiscount({ value_type: 'unknown type', value: -1 }, 5);//Unknown type - no discount applied
        expect(result).to.be.eq(5);

        done();
    });

    it('getUserPromoUpdatePayload - New User', (done) => {
        let req = { action: 'block' };
        let promo = { usage_limit: { max_per_user: 7 } };
        let result = service.getUserPromoUpdatePayload(req, promo, null);
        expect(result).to.be.not.null;
        expect(result.available_count).to.be.eq(6);

        promo.usage_limit.max_per_user = -1;//Wrong setup
        result = service.getUserPromoUpdatePayload(req, promo, null);
        expect(result).to.be.null;

        promo.usage_limit.max_per_user = 7;
        result = service.getUserPromoUpdatePayload(req, promo, { available_count: 0 });//Wrong invoke
        expect(result).to.be.null;

        result = service.getUserPromoUpdatePayload(req, promo, { available_count: 6 });//Usual
        expect(result).to.be.not.null;
        expect(result.available_count).to.be.eq(5);

        req = { action: 'credit back' };
        result = service.getUserPromoUpdatePayload(req, promo, { available_count: 6 });//Usual
        expect(result.available_count).to.be.eq(7);

        req = { action: 'credit back' };
        result = service.getUserPromoUpdatePayload(req, promo, { available_count: 7 });//No change
        expect(result).to.be.null;

        req = { action: 'credit back' };
        result = service.getUserPromoUpdatePayload(req, promo, { available_count: 0 });//Credit back edge
        expect(result).to.be.not.null;
        expect(result.available_count).to.be.eq(1);

        done();
    });

    it('getUserPromoUpdatePayload - New User', (done) => {
        let req = { action: 'block' };
        let promo = { usage_limit: { max_per_user: 7 } };
        let result = service.getUserPromoUpdatePayload(req, promo, null);
        expect(result).to.be.not.null;
        done();
    });

    it('_queryTagBuilderForPromoSearch check the query builder', (done) => {

        let req = {};
        service._queryTagBuilderForPromoSearch(req, (err, res) => {
            expect(res).to.have.property('query_tags');
            expect(res.query_tags).to.be.an('array').that.is.not.empty;
            expect(res).to.have.property('value');
            expect(err).to.be.null;
            done();
        });
    });

    it('_queryTagBuilderForPromoSearch check tag store_id', (done) => {

        let req = {
            store_id: 123456
        };
        service._queryTagBuilderForPromoSearch(req, (err, res) => {
            expect(res).to.have.property('query_tags');
            expect(res.query_tags).to.be.an('array').that.is.not.empty;
            expect(res.query_tags).to.include('store_id');
            expect(res).to.have.property('value');
            expect(err).to.be.null;
            done();
        });
    });

    /*
    it(' _getQueryCondition for empty request', (done) => {
        let req = {};
        service._getQueryCondition(req, (err, res) => {

            expect(err).to.be.null;
            expect(res).to.have.property('$match');
            expect(res).to.have.property('$reduct');
            done();
        });
    });
    */
    it('getUserPromos with existing user input and output for 7Free', (done) => {

        service.getUserPromos('17b22f29-bd4f-4dc9-83ec-8fc1fb00034', false, (err, res) => {
            expect(res).to.have.property('promos');
            expect(res.promos[0].promo_id).to.be.equal('5af1c07d5542fc9307847a6a');
            expect(res.promos[0].available_count).to.be.equal(4);
            done();
        });
    });

    it('getUserPromos with new user for 7Free', (done) => {
        service.getUserPromos('qweqeeqewqeqweqeeq', false, (err, res) => {
            console.log(res);
            expect(res.promos[0].customer_id).to.be.equal('qweqeeqewqeqweqeeq');
            expect(res.promos[0].promo_id).to.be.equal('5af1c07d5542fc9307847a6a');
            expect(res.promos[0].available_count).to.be.equal(7);
            done();
        });
    });

    it('getUserPromos with  guest user', (done) => {
        service.getUserPromos('qweqeeqewqeqweqeeq', true, (err, res) => {
            expect(res.promos.length).to.be.equal(0);
            done();
        });
    });

    it('getUserPromos with existing user input and output for 7Free with all used', (done) => {
        async.series([
            (done1) => {

                userModel.findOneAndUpdate({
                    'customer_id': '17b22f29-bd4f-4dc9-83ec-8fc1fb00034',
                    'promo_id': '5af1c07d5542fc9307847a6a'
                }, { 'available_count': 0 }, () => {
                    done1();
                });
            },
            (done1) => {
                service.getUserPromos('17b22f29-bd4f-4dc9-83ec-8fc1fb00034', false, (err, res) => {
                    expect(res.promos.length).to.be.equal(0);
                    done1();
                });
            }
        ], () => {
            done();
        });

    });

    it('getUserPromos with existing // guest user input and output for 399', (done) => {
        async.series([
            (done1) => {

                promoModel.findOneAndUpdate({
                    'promo_id': '5af1c1005542fc7fe3847a6c'
                }, { is_active: true }, () => {
                    done1();
                });
            },
            (done1) => {
                //existing user
                service.getUserPromos('17b22f29-bd4f-4dc9-83ec-8fc1fb00034', false, (err, res) => {
                    expect(res.promos.length).to.be.equal(1);
                    done1();
                });
            },
            (done1) => {
                //guest user
                service.getUserPromos('qweqeeqewqeqweqeeq', true, (err, res) => {
                    expect(res.promos.length).to.be.equal(1);
                    done1();
                });
            }
        ], () => {
            done();
        });
    });



    it('getUserPromoUpdatePayload with empty user data', (done) => {
        let req = {
            action: 'block'
        };
        let promo = require('./../../test/fixtures/promo/promo_data/7FreeShippingNew.json');
        let userData = null;
        let updateQuery = service.getUserPromoUpdatePayload(req, promo, userData);
        expect(updateQuery).to.have.property('is_active');
        expect(updateQuery).to.have.property('promo_type');
        expect(updateQuery).to.have.property('entitled_user');
        expect(updateQuery.entitled_user).to.have.property('existing_user');
        expect(updateQuery.entitled_user.existing_user).to.be.equal(true);
        done();
    });

    it('getUserPromoUpdatePayload with empty user data', (done) => {
        let req = {
            action: 'block'
        };
        let promo = require('./../../test/fixtures/promo/promo_data/7FreeShippingNew.json');
        let userData = require('./../../test/fixtures/promo/user_data/user1.json');
        let updateQuery = service.getUserPromoUpdatePayload(req, promo, userData);
        expect(updateQuery).to.have.property('is_active');
        expect(updateQuery).to.have.property('promo_type');
        expect(updateQuery).to.have.property('entitled_user');
        expect(updateQuery.entitled_user).to.have.property('existing_user');
        expect(updateQuery.entitled_user.existing_user).to.be.equal(true);
        expect(updateQuery.available_count).to.be.equal(3);
        done();
    });

    it('getUserPromoUpdatePayload with user data for block', (done) => {
        let req = {
            action: 'credit back'
        };
        let promo = require('./../../test/fixtures/promo/promo_data/7FreeShippingNew.json');
        let userData = require('./../../test/fixtures/promo/user_data/user1.json');
        let updateQuery = service.getUserPromoUpdatePayload(req, promo, userData);
        expect(updateQuery).to.have.property('is_active');
        expect(updateQuery).to.have.property('promo_type');
        expect(updateQuery).to.have.property('entitled_user');
        expect(updateQuery.entitled_user).to.have.property('existing_user');
        expect(updateQuery.entitled_user.existing_user).to.be.equal(true);
        expect(updateQuery.available_count).to.be.equal(5);
        done();
    });

    it('getUserPromoUpdatePayload with credit back', (done) => {
        let req = {
            action: 'credit back'
        };
        let promo = require('./../../test/fixtures/promo/promo_data/7FreeShippingNew.json');
        let userData = require('./../../test/fixtures/promo/user_data/user1.json');
        let updateQuery = service.getUserPromoUpdatePayload(req, promo, userData);
        expect(updateQuery).to.have.property('is_active');
        expect(updateQuery).to.have.property('promo_type');
        expect(updateQuery).to.have.property('entitled_user');
        expect(updateQuery.entitled_user).to.have.property('existing_user');
        expect(updateQuery.entitled_user.existing_user).to.be.equal(true);
        expect(updateQuery.available_count).to.be.equal(5);
        done();
    });

    it('getUserPromoUpdatePayload with credit back', (done) => {
        let req = {
            action: 'block'
        };
        let promo = require('./../../test/fixtures/promo/promo_data/7FreeShippingNew.json');
        let userData = require('./../../test/fixtures/promo/user_data/user1.json');
        userData.available_count = 0;
        let updateQuery = service.getUserPromoUpdatePayload(req, promo, userData);
        expect(updateQuery).to.be.null;
        done();
    });

    it('Global and User promo merge - available count = 1', (done) => {
        service._mergeGlobalAndUserPromos('customerId', [
            { promo_id: '12345', available_count: 7 }
        ], [
                { promo_id: '12345', customer_id: 'customerId', available_count: 1 }
        ], (error, result) => {
                if (error) {
                    console.error(error);
                }
                expect(error).to.be.null;
                expect(result).to.be.not.null;
                expect(result.promos.length).to.be.greaterThan(0);
                expect(result.promos[0].available_count).to.be.eq(1);
                done();
            });
    });

    it('Global and User promo merge - available count = 0', (done) => {
        service._mergeGlobalAndUserPromos('customerId', [
            { promo_id: '12345', available_count: 7 }
        ], [
                { promo_id: '12345', customer_id: 'customerId', available_count: 0 }
        ], (error, result) => {
                if (error) {
                    console.error(error);
                }
                expect(error).to.be.null;
                expect(result).to.be.not.null;
                expect(result.promos.length).to.be.eq(0);
                done();
            });
    });

    it('Global and User promo merge - available count = 0 and new global promo', (done) => {
        service._mergeGlobalAndUserPromos('customerId', [
            { promo_id: '12345', available_count: 7 },
            { promo_id: '22222', available_count: 7, usage_limit: { max_per_user: 7 } },
        ], [
                { promo_id: '12345', customer_id: 'customerId', available_count: 0 }
        ], (error, result) => {
                if (error) {
                    console.error(error);
                }
                expect(error).to.be.null;
                expect(result).to.be.not.null;
                expect(result.promos.length).to.be.eq(1);
                done();
            });
    });


});
