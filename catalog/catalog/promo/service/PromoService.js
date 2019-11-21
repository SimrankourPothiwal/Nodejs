
const mongoose = require('mongoose');
const _ = require('lodash');
const Joi = require('joi');
const utils = require('phoenix-common');
const moment = require('moment');

const PromoModel = require('./../models/promoModel');
const UserPromosModel = require('../models/userPromos');
const PromoValidation = require('./../models/promoValidation');
const async = require('async');
mongoose.set('debug', function (collectionName, method, query, doc) {
    console.log(
        'Mongoose: ' +
        collectionName +
        '.' +
        method +
        ' (' +
        JSON.stringify(query, null, 2) + ')');
});

/**
 * 
 * 
 * @class PromoService
 */
class PromoService {

    /**
     * Creates an instance of PromoService.
     * @param {any} logger 
     * @param {boolean} [debug=false] 
     * @memberof PromoService
     */
    constructor(logger, debug = false) {
        this.logger = logger;
        this.debug = debug;
        if (this.debug) {
            mongoose.set('debug', this.debug);
            process.env.LOG_LEVEL = 'info';
        }
    }

    /**
     * 
     * @param {any} payload - { user_claims: {}, store_id, user_profile, items, shipping, subtotal }
     * @param {any} cb -{user_claims: {}, store_id, user_profile, items, shipping, promos , promo_shipping , promo_subtotal}
     * @memberof PromoService
     */
    searchPromo(req, cb) {

        let payload = _.cloneDeep(req);
        console.log('[PromoService > searchPromo :] starting waterfall');
        if (payload.delivery_fee) payload.shipping = payload.delivery_fee;

        let self = this;
        let mongoAggregateRule = [];
        let currentDate = new Date();
        async.waterfall([

            self._parseUserClaimForType(payload),
            self._queryTagBuilderForPromoSearch,
            self._getQueryCondition,
            self._queryAggregatorForCond
        ], function (err, result) {

            if (err) {
                console.log('[searchPromo] waterFall error', err);
                return cb(null, req);
            }
            mongoAggregateRule = result.aggregate_rule;
            console.log(`[PromoService > searchPromo :] ${JSON.stringify(mongoAggregateRule)}`);
            async.waterfall([

                self._getGlobalPromoList.bind(null, mongoAggregateRule, payload),
                self._getUserPromoList
            ], (err, promoHash) => {

                console.log('[searchPromo] status: got the promo list');
                console.log('[searchPromo] debug: promoHash', JSON.stringify(promoHash));
                if (err || promoHash.global_promos.length === 0) {
                    return cb(null, req);
                }
                async.parallel({

                    common_promo: self._commonPromo.bind(null, promoHash),
                    rev_user_promos: self._filterPromoBasedOnUser.bind(null, promoHash, currentDate),
                    rev_condition_rules_promos: self._filterPromoOnUserPromo.bind(null, promoHash)
                }, (err, promoResults) => {

                    if (err) {
                        console.log(' [searchPromo] error encountered: ', err);
                        return cb(null, req);
                    }

                    promoResults.global_promo = promoHash.global_promos;
                    self._getPromoListAfterFilter(promoResults, promoHash, (err, finalPromoList) => {

                        console.log('[_getPromoListAfterFilter] debug finalPromoList ', finalPromoList);
                        if (finalPromoList.length === 0) return cb(null, req);

                        let res = { promos: finalPromoList };
                        async.autoInject({
                            'apply_promo': self.applyPromoOnDeliveryFee.bind(self, payload, res),
                            'special_rule': self._applySpecialRule.bind(self, res, promoHash, currentDate),
                            'cal_promo_price' : self._calPromoShippingPriceForAll.bind(self, payload, res),
                            'original_shipping': ['cal_promo_price', (cal_promo_price,callback) => {

                                //curring
                                self._overWriteOriginalShippingPrice.bind(self, payload, res)(callback);
                            }]
                        }, (err) => {

                            console.log(`[PromoService > applyPromoOnDeliveryFee : result] ${JSON.stringify(res)}`);
                            console.log('[fetchPromosUsingQuery > applyPromoOnDeliveryFee ] : call completed');
                            if (res.promos && res.promos.length >= 1) {

                                //need use the has property to avoid checking the value  
                                if (res.hasOwnProperty('promo_shipping')) req.promo_shipping = res.promo_shipping;
                                if (res.hasOwnProperty('original_shipping')) req.original_shipping = res.original_shipping;
                                
                                let promosList = res.promos;
                                req.promos = [];
                                promosList.forEach((promo, index) => {

                                    let obj = {
                                        promo_id: promo.promo_id,
                                        promo_code: promo.promo_code,
                                        name: promo.name,
                                        description: promo.description,
                                        start_date: promo.start_date,
                                        end_date: promo.end_date
                                    };
                                    if (promo.available_count) obj.available_count = promo.available_count;
                                    if (promo.user_end_date) obj.end_date = promo.user_end_date;

                                    //if (_.has(promo, 'promo_shipping')) obj.promo_shipping = promo.promo_shipping;
                                    req.promos.push(obj);
                                    if (index === (promosList.length - 1)) {
                                        console.log('[PromoService > applyPromoOnDeliveryFee : res] --->', req);
                                        cb(null, req);
                                    }
                                });
                            } else {
                                return cb(null, req);
                            }
                        });
                    });
                });
            });
        });
    }

    applyPromoOnDeliveryFee(req, res, done) {

        let self = this;
        console.log('[applyPromoOnDeliveryFee] In the function');
        if (!_.isArray(res.promos) || res.promos.length < 1) {
            console.log('[applyPromoOnDeliveryFee] return1');
            return done();
        }
        if (!req.shipping || req.shipping < 0) {
            console.log('[applyPromoOnDeliveryFee] return2');
            return done();
        }
        if (res.promos.length === 0) {
            console.log('[applyPromoOnDeliveryFee] return3');
            return done();
        }
        console.log('[applyPromoOnDeliveryFee] computing');
        let promoApplied = false;
        async.forEachLimit(res.promos, 1, (promo, next) => {

            if (promoApplied) return next();
            async.forEachLimit(promo.rules, 1, (rule, nextInner) => {

                if (rule.discount_type === 'shipping') {

                    let newFee = self.singleValueDiscount(rule, req.shipping);
                    if (newFee !== res.shipping) {

                        promoApplied = true;
                        res.promo_shipping = newFee;
                        if(promo.show_original_shipping !== false) {
                            res.original_shipping = req.shipping;
                        }
                        console.log('[applyPromoOnDeliveryFee] return4', newFee);
                        nextInner();
                    } else {
                        nextInner();
                    }
                } else {
                    nextInner();
                }
            }, next);
        }, () => {
            return done();
        });
    }

    _calPromoShippingPriceForAll(req, res, done) {

        //Business req
        //1. Business wants the delivery fee to be 3.99 for fallback price
        let self = this;

        if ( _.has(req, 'avoid_original_shipping_cal') && req.avoid_original_shipping_cal === true) return done();
        if (!_.isArray(res.promos) || res.promos.length < 1) return done();
        if (!req.shipping || req.shipping < 0) return done();
        if (res.promos.length === 0) return done();
        console.log('[_calPromoShippingPrice] computing');

        async.forEachOfLimit(res.promos, 3, (promo, index ,next) => {

            async.forEachLimit(promo.rules, 3, (rule, nextInner) => {

                if (rule.discount_type === 'shipping') {

                    let newFee = self.singleValueDiscount(rule, req.shipping);
                    if (newFee !== res.shipping ) {

                        res.promos[index]['promo_shipping'] = newFee;
                        nextInner();
                    } else {
                        nextInner();
                    }
                } else {
                    nextInner();
                }
            }, next);
        }, () => {
            return done();
        });
    }

    _overWriteOriginalShippingPrice(req, res, done) {

        if (_.has(req, 'avoid_original_shipping_cal') && req.avoid_original_shipping_cal === true) return done();
        if (!_.isArray(res.promos) || res.promos.length < 1) return done();
        if (!req.shipping || req.shipping < 0) return done();
        if (res.promos.length === 0) return done();

        //console.log('[_overWriteOriginalShippingPrice]:', res.promos );
        // if only one Promo is running then original shipping info to keep
        res.original_shipping = req.shipping;
        if (res.promos.length === 1 ) return done();
        let index = 0;
        async.detectSeries(res.promos, (promo,next) => {

            if (index === 0) {

                index += 1;
                next(null);
            } else {

                index += 1;
                if (_.has(promo, 'promo_shipping') && promo.promo_shipping > 0) {
                    next(null, promo)
                } else {
                    next(null);
                }
            }
        }, (err, result) => {

            if (err) return done();
            //one scenario all the promo are making the price 0
            if (result === undefined) return done();

            res.original_shipping = result.promo_shipping;
            return done();
        });
    }

    singleValueDiscount(rule, value) {

        console.log('[singleValueDiscount]', rule, value);
        if (!value || !rule) return value;

        switch (rule.value_type) {
        case 'value_off':
            if (rule.value > 0) {
                let newValue = value - rule.value;
                if (newValue < 0) return 0; else return newValue;
            }
            break;
        case 'percentage_off':
            if (0 < rule.value && rule.value <= 100) {
                return (value - (value * (rule.value / 100)));
            }
            break;
        case 'value_override':
            if (rule.value >= 0 && rule.value < value) {
                return rule.value;
            }
            break;
        default: return value;
        }

        return value;
    }

    getUserPromos(customerId, isGuest, done) {
        let self = this;
        let fields = { promo_id: 1, promo_code: 1, name: 1, description: 1, start_date: 1, end_date: 1, available_count: 1, priority: 1, _id: 0, usage_limit: 1 };

        let currentDate = new Date().toISOString();
        let query = { is_active: true, promo_type: 'user_coupon', start_date: { $lte: new Date(currentDate) }, end_date: { $gt: new Date(currentDate) } };

        if (isGuest) {
            query['entitled_user.guest_user'] = true;
        } else {
            query['entitled_user.existing_user'] = true;
        }
        let tasks = [(done) => {
            PromoModel.find(query).lean(true).sort({ priority: 1 }).select(fields).exec(done);
        }];

        if (customerId) {
            let userPromoQuery = {
                customer_id: customerId,
                is_active: true,
                promo_type: 'user_coupon'
            };

            if (isGuest) {
                userPromoQuery['entitled_user.guest_user'] = true;
            } else {
                userPromoQuery['entitled_user.existing_user'] = true;
            }
            fields.customer_id = 1;
            tasks.push((done) => {
                UserPromosModel.find(userPromoQuery).lean(true).sort({ priority: 1 }).select(fields).exec(done);
            });
        }

        async.parallel(tasks, (err, result) => {
            if (result && result.length && result.length > 1) {
                let gps = result[0], ups = result[1];
                self._mergeGlobalAndUserPromos(customerId, gps, ups, (err, result) => {
                    console.log('Promo result', result);
                    done(null, result);
                });
            } else {
                done(null, { promos: [] });
            }
        });
    }

    _mergeGlobalAndUserPromos(customerId, gps, ups, done) {
        let self = this;
        console.log('Global Promos', gps);
        console.log('User promos', ups);
        if (_.isArray(gps) && gps.length === 0) {
            return done(null, { promos: ups });
        } else if (_.isArray(ups) && ups.length === 0) {
            self._addToUserPromos(customerId, gps, ups, done);
        } else {
            _.forEach(ups, (up) => { //filtering global promos that already exists in user promos
                gps = _.reject(gps, { promo_id: up.promo_id });
            });
            ups = _.filter(ups, (up) => {//filtering the promo that has been used.
                if (up.hasOwnProperty('available_count') && up.available_count === 0) {
                    return false;
                } else {
                    return true;
                }
            });
            if (gps.length > 0) {//After filtering, is there still more global coupons available
                self._addToUserPromos(customerId, gps, ups, done);
            } else {
                return done(null, { promos: ups });
            }
        }
    }

    _addToUserPromos(customerId, gps, ups, done) {
        async.each(gps, (gp, done) => {
            let up = _.assign(gp, { customer_id: customerId });
            if (gp.usage_limit && gp.usage_limit.max_per_user) {
                up.available_count = gp.usage_limit.max_per_user;
                delete up.usage_limit;
            }
            ups.push(up);
            done();
        }, () => {
            return done(null, { promos: _.sortBy(ups, ['priority']) });
        });
    }

    /**
     * 
     * @param {any} payload 
     * @param {any} cb 
     * @returns 
     * @memberof PromoService
     */
    createOrUpdatePromo(payload, cb) {

        let self = this;
        let logger = self.logger;
        let promoId = null;

        logger.info('[PromoService > createOrUpdatePromo]', payload);
        if (self.debug) console.log('[PromoService > createOrUpdatePromo payload]', payload);
        if (self.debug) logger.info('[PromoService > createOrUpdatePromo]', 'payload validation');

        //validation
        let resultVal = Joi.validate(payload, PromoValidation.promoRequestModel);
        if (resultVal.error) {
            console.log(resultVal.error);
            logger.error('[PromoService > createOrUpdatePromo err: ]' + JSON.stringify(resultVal.error));
            return cb(resultVal.error, null);
        }

        if (!payload.hasOwnProperty('promo_id')) {
            promoId = mongoose.Types.ObjectId().toHexString();
            console.log(promoId);
        } else {
            promoId = payload.promo_id;
        }
        if (!payload.hasOwnProperty('entitled_product')) {
            payload.entitled_product = { all: true };
        }
        if (!payload.hasOwnProperty('usage_limit')) {
            payload.usage_limit = { max: -1, used_count: 0 };
        }
        if (!payload.hasOwnProperty('entitle_order')) {
            payload.entitle_order = { min_quantity: 1 };
        }
        if (!payload.hasOwnProperty('entitled_store')) {
            payload.entitled_store = { all: true };
        }

        PromoModel.findOneAndUpdate(

            { promo_id: promoId },
            payload,
            { new: true, upsert: true },
            (err, doc) => {

                if (err) {
                    logger.error('[PromoService > createOrUpdatePromo err: ]' + JSON.stringify(err));
                    return cb(err, null);
                } else {
                    return cb(null, doc);
                }
            });
    }

    /**
     * @param {any} req 
     * @returns 
     * @memberof PromoService
     */
    _parseUserClaimForType(req) {
        return function (done) {
            console.log(`[PromoService > _parseUserClaimForType :] parsing claim ${JSON.stringify(req)}`);
            if (_.isObject(req.user_claims)) {
                if (_.isArray(req.user_claims.scope) && _.includes(req.user_claims.scope, 'guest')) {
                    req.is_guest = true;
                } else {
                    req.is_guest = false;
                }
                console.log('Found user_claims. Just setting up is_guest flag', req.is_guest);
            } else if (req.user_profile) {
                if (req.user_profile.is_guest === 'Y') {
                    req.is_guest = true;
                } else {
                    console.log('Setting up user_claims from user_profile', req.user_profile);
                    req.is_guest = false;
                    req.user_claims = { customer_id: req.user_profile.customer_id };
                }
            } else {
                console.log('No user_claims or user_profile found! Setting as guest user');
                req.is_guest = true;
                req.user_claims = {};
            }
            console.log(req);
            return done(null, req);
        };
    }

    /**
     * @param {any} req 
     * @memberof PromoService
     */
    _queryTagBuilderForPromoSearch(req, done) {

        console.log('[Promoservice > _queryTagBuilderForPromoSearch] building query tag');
        let queryMapperObj = {
            query_tags: [],
            value: {
                promo_type: null,
                total_item_quant: 0,
                product_id_list: [],
                store_id: null,
                country: 'US',
                is_active: true,
                current_date: new Date()
            }
        };

        //default one
        queryMapperObj.query_tags.push('usage_limit');
        queryMapperObj.query_tags.push('country');
        queryMapperObj.query_tags.push('is_active');

        // based on type promo_view
        queryMapperObj.query_tags.push('simple_date_check');
        if (req.hasOwnProperty('promo') && req.promo.hasOwnProperty('current_date')) {
            queryMapperObj.value.current_date = req.promo.current_date;
        }
        if (req.hasOwnProperty('shipping')) {
            queryMapperObj.query_tags.push('promo_checkout_type');
        }
        if (req.hasOwnProperty('store_id')) {
            queryMapperObj.query_tags.push('store_id');
            queryMapperObj.value.store_id = req.store_id;
        }
        if (req.hasOwnProperty('country')) {
            queryMapperObj.value.country = req.country;
        }
        if (req.is_guest === true) {
            queryMapperObj.query_tags.push('entitled_user_guest');
        } else if (req.is_guest === false) {
            queryMapperObj.query_tags.push('entitled_user_exiting');
        } else {
            queryMapperObj.query_tags.push('entitled_user_all');
        }
        done(null, queryMapperObj);
    }

    /**
     * 
     * 
     * @param {any} queryGenObj 
     * @param {any} done 
     * @returns 
     * @memberof PromoService
     */
    _getQueryCondition(queryGenObj, done) {

        let query_mapper = {
            country: {
                1: { 'country': queryGenObj.value.country }
            },
            is_active: {
                1: { 'is_active': queryGenObj.value.is_active }
            },
            simple_date_check: {
                1: {
                    start_date: { $lte: new Date(queryGenObj.value.current_date) },
                    end_date: { $gte: new Date(queryGenObj.value.current_date) }
                }
            },
            usage_limit: {
                // 1: {
                //     '$redact': {
                //         '$cond': {
                //             'if': { '$lt': ['$usage_limit.max', '$usage_limit.used_count'] },
                //             'then': '$$KEEP',
                //             'else': '$$PRUNE'
                //         }
                //     }
                // }
            },
            store_id: {
                1: { 'entitled_store.all': true },
                2: {
                    'entitled_store.store_id': true, 'prerequisite_store_id': { $in: [queryGenObj.value.store_id] },
                },
            },
            promo_checkout_type: {
                1: { 'promo_type': { $in: ['checkout', 'user_coupon'] } }
            },
            promo_basket_type: {
                1: { 'promo_type': { $in: ['basket', 'user_coupon', 'item'] } }
            },
            promo_type: {
                1: { 'promo_type': { $in: ['item', 'basket', 'checkout', 'order', 'user_coupon'] } }
            },
            entitled_product_checkout: {
                // will be enable latter
                // 1: {
                //     'entitled_product.all': true,
                // },
                // 2: {
                //     'entitled_product.product_id': true,
                //     'prerequisite_product_id': { $in: queryGenObj.value.product_id_list }
                // },
                // 3: {
                //     '$redact': {
                //         '$cond': {
                //             'if': { '$gte': [checkoutProdQuantity ,'$entitled_order.min_quantity'] },
                //             'then': '$$KEEP',
                //             'else': '$$PRUNE'
                //         }
                //     }
                // } 
            },
            entitled_user_exiting: {
                1: { 'entitled_user.all': true },
                3: { 'entitled_user.existing_user': true }
            },

            entitled_user_guest: {
                1: { 'entitled_user.all': true },
                3: { 'entitled_user.guest_user': true }
            },
            entitled_user_all: {
                1: { 'entitled_user.all': true }
            }
        };
        let finalQuery = {

            $match: { '$and': [] },
            $reduct: []
        };
        //iterating over the query tags of the query mapper to get and , or and reduct condition
        //and filling in the finalQuery Object
        queryGenObj.query_tags.forEach((queryTag) => {

            // queryBuilder = { entr}
            let queryBuilder = {};

            //queryTag eg entitled_user_exiting country
            if (query_mapper.hasOwnProperty(queryTag)) {

                //sorting in order of number eg country: {1 : {country: 'US'}}
                let tempArr = Object.keys(query_mapper[queryTag]).sort((a, b) => {
                    return a - b;
                });
                tempArr.forEach((ele, index) => {

                    //redact does not required $match condition in mongo  aggregate 
                    if (!query_mapper[queryTag][ele].hasOwnProperty('$redact')) {
                        if (!queryBuilder.hasOwnProperty(queryTag)) queryBuilder[queryTag] = { '$or': [] };
                        queryBuilder[queryTag].$or.push(query_mapper[queryTag][ele]);

                    } else {
                        finalQuery['$reduct'].push(query_mapper[queryTag][ele]);
                    }

                    if (index === tempArr.length - 1 && queryBuilder[queryTag] !== undefined) {
                        finalQuery.$match.$and.push(queryBuilder[queryTag]);
                    }
                });

            }
        });
        console.log(`[ searchPromo > _getQueryCondition: ] ${JSON.stringify(finalQuery)}`);
        done(null, finalQuery);
    }

    /**
     * 
     * 
     * @param {any} queryCond 
     * @param {any} done 
     * @memberof PromoService
     */
    _queryAggregatorForCond(queryCond, done) {

        let queryAggrArr = [];
        //only if $reduct condition are enable
        queryCond.$reduct.forEach((condRule) => {
            queryAggrArr.push(condRule);
        });
        //matching rule
        queryAggrArr.push({ $match: queryCond.$match });
        //priority rule
        queryAggrArr.push({ $sort: { priority: 1 } });
        console.log(`[PromoService > _queryAggregatorForCond : ] ${JSON.stringify(queryAggrArr)}`);
        done(null, { aggregate_rule: queryAggrArr });
    }

    /**
     * 
     * 
     * @param {any} doc 
     * @returns 
     * @memberof PromoService
     */
    _parsePromoDocRules(doc) {
        doc.rule = {
            promo_code: []
        };
        doc.rules.forEach((rule) => {

            if (rule.discount_type === 'shipping') {

                doc.rule.is_delivery_fee_waived = 'Y';
                doc.rule.value_type = rule.value_type;
                doc.rule.discount_type = rule.discount_type;
                doc.rule.value = rule.value;

                doc.rule.promo_code.push(doc.promo_code);
            }
        });
        return doc;
    }

    _applySpecialRule(res, promoHash, currentDate, done) {

        console.log('[_applySpecialRule] status: applying special rule');
        async.forEachOfLimit(res.promos, 3, (promo, indexOuter, next) => {

            async.forEachLimit(promo.rules, 3, (rule, nextInner) => {

                if (rule.discount_type &&
                    rule.discount_type === 'end_date' &&
                    rule.value_type === 'days_to_expire'

                ) {
                    if (promoHash['global_promos_def'][promo.promo_id]['user_end_date']) return nextInner();
                    //let newEndDate = moment(currentDate).add(rule.value, 'days');
                    let newEndDate = moment(currentDate).add(rule.value, 'days');
                    let oldEndDate = moment(promo.end_date);
                    if (newEndDate > oldEndDate) {

                        console.log('[_applySpecialRule] debug: end_date , cal_date', newEndDate, oldEndDate);
                        console.log('[_applySpecialRule] msg: no change in the end date for special rule');
                        return nextInner();
                    }
                    console.log('[_applySpecialRule] debug: end_date , cal_date', newEndDate, oldEndDate);
                    res['promos'][indexOuter]['user_end_date'] = newEndDate.toDate();
                    return nextInner();
                } else {
                    return nextInner();
                }
            }, next);

        }, done);
    }

    _getGlobalPromoList(query, req, done) {

        console.log('[_getGlobalPromoList] :  searching started for Global Promo');
        let globalPromoHash = {
            global_promos: [],
            global_promos_def: {},
            global_promo_code_map: {}
        };
        PromoModel.aggregate(query, function (err, promos) {

            if (err) {
                console.log(err);
                return done(null, req, globalPromoHash);
            }
            if (promos.length >= 1) {
                promos.forEach((promo, index) => {

                    globalPromoHash['global_promos'].push(promo.promo_id);
                    if (!globalPromoHash['global_promos_def'][promo.promo_id]) {

                        globalPromoHash['global_promos_def'][promo.promo_id] = {};
                        globalPromoHash['global_promos_def'][promo.promo_id] = promo;
                        globalPromoHash['global_promo_code_map'][promo.promo_code] = promo.promo_id;
                    }
                    if (index === promos.length - 1) {
                        console.log('[_getGlobalPromoList] : global promo list', globalPromoHash.global_promos);
                        return done(null, req, globalPromoHash);
                    }
                });
            } else {
                console.log('[_getGlobalPromoList] : global promo list', globalPromoHash.global_promos);
                done(null, req, globalPromoHash);
            }
        });
    }

    _getUserPromoList(req, promoHash, done) {

        promoHash.user_promos = [];
        promoHash.user_promos_def = {};
        promoHash.user_promo_code_map = {};

        if (promoHash.global_promos.length === 0) {
            return done(null, promoHash);
        }
        if (!req.user_claims) {
            console.log('[_getUserPromoList] : req.user_claims is missing');
            return done(null, promoHash);
        }
        UserPromosModel.find({
            customer_id: req.user_claims.customer_id
            //promo_id: { $in: promoHash.global_promos }

        }).lean(true).exec(function (err, userPromos) {

            if (err) {
                console.log(' [_getUserPromoList] : err', err);
                return done(null, promoHash);
            }
            if (userPromos.length === 0) return done(null, promoHash);
            userPromos.forEach((promo, index) => {

                promoHash['user_promos'].push(promo.promo_id);
                if (!promoHash['user_promos_def'][promo.promo_id]) {
                    promoHash['user_promos_def'][promo.promo_id] = promo;
                    promoHash['user_promo_code_map'][promo.promo_code] = promo.promo_id;
                }
                if (index === userPromos.length - 1) {
                    console.log('[_getUserPromoList] : user promo list', promoHash.user_promos);
                    return done(null, promoHash);
                }
            });
        });
    }

    _commonPromo(promoHash, done) {
        return done(null, _.intersection(promoHash.global_promos, promoHash.user_promos));
    }

    _filterPromoBasedOnUser(promoHash, currentDate = new Date(), done) {

        if (promoHash.user_promos.length === 0) return done(null, []);

        let promoListForRemoval = [];
        async.forEachLimit(promoHash.user_promos, 3, (promo_id, next) => {

            if (!promoHash['global_promos_def'][promo_id]) return next();

            let globalPromo = promoHash['global_promos_def'][promo_id];
            let promo = promoHash['user_promos_def'][promo_id];
            if (promo.hasOwnProperty('available_count') && promo.available_count <= 0) promoListForRemoval.push(promo_id);
            if (
                moment(currentDate) > moment(promo.end_date) || moment(currentDate) > moment(globalPromo.end_date)
            ) {
                console.log('[_filterPromoBasedOnUser] debug: global_end_date, user_promo_end_date, current_date', globalPromo.end_date, promo.end_date, currentDate);
                promoListForRemoval.push(promo_id);
                next();
            } else {
                next();
            }
        }, () => {
            console.log('[_filterPromoBasedOnUser] promo to be removed ', promoListForRemoval);
            return done(null, promoListForRemoval);
        });
    }

    _filterPromoOnUserPromo(promoHash, done) {

        let promoListForRemoval = [];
        if (promoHash.user_promos.length === 0) return done(null, promoListForRemoval);

        async.forEachLimit(promoHash.global_promos, 3, (promo_id, next) => {

            let promo = promoHash['global_promos_def'][promo_id];
            if (!promo.entitle_user_promo) return next();
            if (!promo.entitle_user_promo.promo_code_not_permitted &&
                !promo.prerequisite_promo_code_not_permitted
            ) return next();
            if (
                promo.prerequisite_promo_code_not_permitted.length === 0
            ) return next();

            async.forEachLimit(promo.prerequisite_promo_code_not_permitted, 3, (promo_code, nextInner) => {

                //user has already used the disallowed promo then push the promo in romval list
                if (promoHash['user_promo_code_map'] && promoHash['user_promo_code_map'][promo_code]) {
                    promoListForRemoval.push(promo_id);
                    nextInner();
                } else {
                    nextInner();
                }
            }, () => {
                return next();
            });
        }, () => {
            console.log('[_filterPromoOnRules] : promo to be removed', promoListForRemoval);
            return done(null, promoListForRemoval);
        });
    }

    _getPromoListAfterFilter(promoHashForArr, promoHashForId, done) {

        let promoList = promoHashForArr.global_promo;
        let removeList = _.union(promoHashForArr.rev_user_promos, promoHashForArr.rev_condition_rules_promos);
        let finalListPromoId = _.pullAll(promoList, removeList);
        console.log('[_getPromoListAfterFilter] final promo list user ', finalListPromoId);
        let finalList = [];
        if (finalListPromoId.length === 0) return done(null, finalList);

        finalListPromoId.forEach((promo_id, index) => {

            if (promoHashForId['global_promos_def'] &&
                promoHashForId['user_promos_def'] &&
                promoHashForId['global_promos_def'][promo_id] &&
                promoHashForId['user_promos_def'][promo_id]
            ) {

                if (promoHashForId['user_promos_def'][promo_id]['available_count']) {
                    promoHashForId['global_promos_def'][promo_id]['available_count'] = promoHashForId['user_promos_def'][promo_id]['available_count'];
                }
                if (promoHashForId['user_promos_def'][promo_id]['end_date']) {
                    promoHashForId['global_promos_def'][promo_id]['user_end_date'] = promoHashForId['user_promos_def'][promo_id]['end_date'];
                }
                let tmpObj = _.cloneDeep(promoHashForId['global_promos_def'][promo_id]);
                finalList.push(tmpObj);
            } else {
                let tmpObj = _.cloneDeep(promoHashForId['global_promos_def'][promo_id]);
                finalList.push(tmpObj);
            }

            if (index === finalListPromoId.length - 1) {

                finalList = _.sortBy(finalList, ['priority']);
                return done(null, finalList);
            }
        });
    }

    //Calls back with promos
    fetchPromosUsingQuery(query, req, done) {

        console.log('[fetchPromosUsingQuery > searching started for Global Promo] : ');
        PromoModel.aggregate(query, function (err, promos) {
            console.log();
            if (err) {
                console.log(err);
                return done(null, []);
            }
            console.log('[fetchPromosUsingQuery > PromoModel Global] : ', promos);
            if (promos.length >= 1) {

                let promoIds = _.map(promos, (promo) => { return promo.promo_id; });
                if (!req.user_claims) {
                    console.log('[fetchPromosUsingQuery] : req.user_claims is missing');
                    return done(null, promos);
                }
                UserPromosModel.find({
                    customer_id: req.user_claims.customer_id,
                    promo_id: { $in: promoIds }
                }).lean(true).exec(function (err, userPromos) {

                    if (err) { console.log(err); return done(); }
                    if (userPromos.length < 1) {
                        console.log('[fetchPromosUsingQuery > User Promo] : 0');
                    } else {
                        console.log('[fetchPromosUsingQuery > User Promo] : ', userPromos);
                    }
                    userPromos.forEach((up) => {
                        if (up.hasOwnProperty('available_count') && up.available_count <= 0) {
                            console.log(`[ fetchPromosUsingQuery : removing promo_id]: ${up.promo_id} , available count: ${up.available_count}`);
                            promos = _.reject(promos, { promo_id: up.promo_id });
                        } else if (up.hasOwnProperty('available_count')) {

                            console.log(`[ fetchPromosUsingQuery : removing promo_id]: ${up.promo_id} , available count: ${up.available_count}`);
                            let index = _.findIndex(promos, { promo_id: up.promo_id });
                            promos[index].available_count = up.available_count;
                        }
                    });
                    console.log('[fetchPromosUsingQuery > Promo being send]: ');
                    console.log(promos);
                    done(null, promos);
                });
            } else {
                done(null, []);
            }
        });
    }
    /**
     * 
     * 
     * @param {any} payload 
     * @returns 
     * @memberof PromoService
     */
    _addRequiredField(payload) {
        if (payload.user_profile) {
            payload.customer_id = payload.user_profile.customer_id;
        }
        if (!payload.action) {
            payload.action = 'block';
        }
        return payload;
    }

    /**
     * 
     * 
     * @param {any} payload 
     * @returns 
     * @memberof PromoService
     */
    _requiredReqVal(payload) {

        if (_.isNull(payload.customer_id)) {
            console.log('[_requiredReqVal] : customer ID is null. Cant be update');
            return false;
        }
        //this short term solution.
        //need to make engine smart to search on order_type
        if (payload.order_type !== 'delivery') {
            console.log('[_requiredReqVal] : order type is not delivery');
            return false;
        }
        return true;
    }
    /**
     * 
     * 
     * @param {any} cb 
     * @memberof PromoService
     */
    _getConfig(cb) {
        let basketConfig = { app: '7NOW', version: '1.0', country: 'US' };
        utils.configFetch.fetchConfig(basketConfig, function (err, doc) {
            if (err) { console.log(err); return cb(err); }
            let config = {};
            if (doc && doc.length > 0) {

                config.apiConfig = doc.find(o => o.type === 'api');
                config.basketApiConfig = config.apiConfig.configurations.find(o => o.feature === 'basket');
                config.deliveryFeeWaiver = config.basketApiConfig.properties.find(o => o.id === 'basket_delivery_fee_waiver').current_value;
                config.guestConfig = config.basketApiConfig.properties.find(o => o.id === 'basket_guest_delivery_fee_waiver').current_value;
            }
            cb(null, config);
        });
    }
    /**
     * 
     * @param {any} req 
     * @param {any} cb 
     * @memberof PromoService
     */
    promoUsage(req, callback) {

        console.log('[promoUsage]');
        let self = this;
        let payload = _.cloneDeep(req);
        payload = parseObjForCustomerId(payload);
        payload = self._addRequiredField(payload);
        console.log('[promoUsage] payload : ', JSON.stringify(payload));

        if (self._requiredReqVal(payload) === false) {

            console.log('[ promoUsage ] :_requiredReqVal is false');
            return callback(null, []);
        }
        self._getConfig((err, config) => {

            if (err) { console.log('[promoUsage] :  error encountered while fetching app config'); }
            if (config.deliveryFeeWaiver === 'Y' || config.guestConfig === 'Y') {

                console.log('[ promoUsage ] : api app config enabled, no promo used');
                return callback(null, []);
            } else {
                if (!req.promo_details) {
                    self.searchPromo(req, (err, result) => {
                        if (err) {
                            console.log('[_promoPayloadBuild > searchPromo err:]');
                            console.log(err);
                        }
                        payload.promo_details = { promos: result.promos };
                        console.log(payload);
                        updateUserPromos(payload, (err, result) => {
                            console.log(result);
                            callback(null, result.update_list);
                        });
                    });
                } else {
                    updateUserPromos(payload, (err, result) => {
                        callback(null, result.update_list);
                    });
                }
            }
        });


        function parseObjForCustomerId(payload) {
            if (payload.user_profile) {
                payload.customer_id = payload.user_profile.customer_id;
            }
            return payload;
        }

        function updateUserPromos(payload, done) {

            if (!(payload.promo_details &&
                payload.promo_details.promos &&
                _.isArray(payload.promo_details.promos) &&
                payload.promo_details.promos.length > 0)
            ) {
                return done(null, { update_list: [] });
            }
            console.log('-------updateUserPromos-----------');
            async.waterfall([
                updateGlobalPromoCount.bind(null, payload),
                updateUserPromoAvailableCount,
            ], function (err, res) {
                if (err) return done(err, null);
                console.log(res);
                done(null, res);
            });
        }

        function updateGlobalPromoCount(req, done) {

            let promoMaster = [];
            let promoUpdateCount = 0;
            async.eachSeries(req.promo_details.promos, (promo, done1) => {

                if (promoUpdateCount === 0) {

                    PromoModel.findOneAndUpdate({ promo_id: promo.promo_id }, {
                        $inc: { 'usage_limit.used_count': getCountGlobal(req) }
                    }, { new: true }, (err, promoDoc) => {

                        if (err) { return done1(err, null); }
                        if (promoDoc === null) {

                            console.log(`promo_id ${promo.promo_id} is not available`);
                            return done1();
                        }
                        if (promoUpdateCount === 0) {
                            if (promoDoc && promoDoc.rules && _.some(promoDoc.rules, { 'discount_type': 'end_date', 'value_type': 'days_to_expire' })) {
                                promoDoc.end_date = promo.end_date;
                            }
                            promoMaster.push(promoDoc);
                            promoUpdateCount++;
                            done1();
                        } else {
                            done1();
                        }
                    });
                } else {
                    done1();
                }
            }, () => {
                console.log('promoMaster');
                console.log(promoMaster);
                done(null, promoMaster, req);
            });
        }

        function getCountGlobal(req) {

            if (req.action && req.action === 'block') {
                return 1;
            } else if (req.action && req.action === 'credit back') {
                return -1;
            } else {
                return 1;
            }
        }


        function updateUserPromoAvailableCount(promoMaster, req, done) {

            let updateList = [];
            console.log('[updateUserCountByPromoID > updateAvailableCount] updating user usage count');
            async.eachSeries(promoMaster, (promo, done2) => {

                let query = { customer_id: req.customer_id, promo_id: promo.promo_id };
                UserPromosModel.findOne(query).lean(true).exec((err, doc) => {

                    if (err) { console.log(err); return done2(); }
                    let updateQuery = self.getUserPromoUpdatePayload(req, promo, doc);
                    if (updateQuery) {

                        UserPromosModel.findOneAndUpdate(query, updateQuery, { upsert: true, new: true }, function (err, updatedDoc) {
                            if (err) return done2(err);
                            updateList.push(updatedDoc);
                            done2();
                        });
                    } else {
                        return done2();
                    }
                });
            }, (err) => {
                if (err) console.log(`updateList : error encountered: ${err}`);
                console.log('------------updateList------------------', updateList);
                done(null, { update_list: updateList });
            });
        }

    }

    getUserPromoUpdatePayload(req, promo, doc) {
        let updateQuery = {
            promo_code: promo.promo_code,
            description: promo.description,
            start_date: promo.start_date,
            end_date: promo.end_date,
            priority: promo.priority,
            usage_limit: promo.usage_limit,
            is_active: promo.is_active,
            promo_type: promo.promo_type
        };
        if (promo.entitled_user) {
            updateQuery.entitled_user = promo.entitled_user;
        }
        if (promo.usage_limit && promo.usage_limit.max_per_user && promo.usage_limit.max_per_user > 0) {

            let availableCount = promo.usage_limit.max_per_user - 1;
            updateQuery.available_count = availableCount;

            if (doc) {

                if (doc.available_count >= 0 && doc.available_count <= promo.usage_limit.max_per_user) {

                    console.log('--------------------------');
                    if (req.action === 'block' && doc.available_count > 0) {
                        updateQuery.available_count = doc.available_count - 1;
                        return updateQuery;
                    } else if (req.action === 'credit back' && doc.available_count < promo.usage_limit.max_per_user) {
                        console.log('-------credit back-----');
                        updateQuery.available_count = doc.available_count + 1;
                        console.log(updateQuery.available_count);
                        console.log('-----------------');
                        return updateQuery;
                    } else {
                        return null;
                    }
                } else {
                    console.log('Error: Cannot use the promo! Bug!', doc);
                    return null;
                }
            } else {
                return updateQuery;
            }
        } else {
            return updateQuery;
        }
    }

    updatePromos(data, callback){
        let PromoCol = mongoose.connection.db.collection('promo_engine_promos');
        if(_.isEmpty(data) || !data.id) {return callback(null, {message: 'please provide validate data'})}

        PromoCol.find({id:data.id}).toArray((err, results)=>{
            if(err) {console.log('error while getting promodetails>>>>>>>>>>>>>>', err); return callback(err)} 
            if(results && results.length>0){
                let values= {};
                Object.keys(data).forEach((key)=>{
                    values[key]=data[key];
                })
                PromoCol.updateOne({_id:results[0]._id}, {$set:values}, { upsert: true, new: false }, (err,data)=>{
                    if(err) {console.log('error while updating data'); return callback(err);}
                    return callback(null, 'Promo updated');
                })
            }else{
                PromoCol.insertOne(data, (err, data)=>{
                    if(err) {console.log('error while inserting data'); return callback(err);}
                    return callback(null, 'Promo inserted')
                })
            }
        })  

    }

}


module.exports = PromoService;
