const _ = require('lodash');
const utils = require('phoenix-common');
const CONST = require('./../utilities/constants/constants_en_us');
const PromoService = require('./../service/PromoService');


const createOrUpdatePromo = function createPromo(event, context, callback) {

    let logger = utils.initLogger(event, context);
    let stats = {
        hrstart: process.hrtime()
    };
    try {

        context.callbackWaitsForEmptyEventLoop = false;
        let connectionPromise = utils.dbClient(null, function (error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
        connectionPromise
            .then(function () {

                console.log(event);
                let payload = (_.isObject(event.body) ? event.body : JSON.parse(event.body));
                let headerObj = utils.helper.parseHeader(event.headers);
                if (payload.hasOwnProperty('country') &&
                    CONST.X_711_LOCALE[headerObj.country]
                ) {
                    payload.country = CONST.X_711_LOCALE[headerObj.country];
                } else {
                    //default
                    payload.country = CONST.X_711_LOCALE['default_country'];
                }
                console.log('[createOrUpdatePromo] calling Promo service');
                let service = new PromoService(logger);
                service.createOrUpdatePromo(payload, (error, result) => {

                    utils.createResponse(error, result, logger, stats, callback);
                });
            }, function (error) {

                utils.createResponse(error, null, logger, stats, callback);
            });

    } catch (e) {
        return utils.createResponse(e, null, logger, stats, callback);
    }
};

const promoUsage = function (event, context, callback) {
    let logger = utils.initLogger(event, context);
    let stats = { hrstart: process.hrtime() };
    try {
        context.callbackWaitsForEmptyEventLoop = false;
        let connectionPromise = utils.dbClient(null, function (error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
        connectionPromise
            .then(function () {
                console.log(event);
                let payload = (_.isObject(event.body) ? event.body : JSON.parse(event.body));
                let headerObj = utils.helper.parseHeader(event.headers);
                if (payload.hasOwnProperty('country') &&
                    CONST.X_711_LOCALE[headerObj.country]
                ) {
                    payload.country = CONST.X_711_LOCALE[headerObj.country];
                } else {
                    payload.country = CONST.X_711_LOCALE['default_country'];
                }
                console.log('[searchPromo > promoUsage] calling Promo service');
                console.log(JSON.stringify(payload));
                let userClaims = utils.helper.readTokenClaims(event);
                let service = new PromoService(logger);
                if ( _.isObject(userClaims) && userClaims.hasOwnProperty('customer_id')) {
                    payload.customer_id = userClaims.customer_id;
                }
                service.promoUsage(payload, (err, res) => {
                    console.log('Got promos!!!', res);
                    utils.createResponse(null, res, logger, stats, callback);
                });
            }, function (error) {
                utils.createResponse(error, null, logger, stats, callback);
            });

    } catch (e) {
        return utils.createResponse(e, null, logger, stats, callback);
    }
};


/**
 * This is to handle promotions publisehd by promo engine
 * @param {Object} event
 * @param {Object} context
 * @param {Function} callback
 */
const updatePromosFromPromoEngine = function updatePromosFromPromoEngine(event, context, callback) {
    let logger = utils.initLogger(event, context);
    let stats = {
        hrstart: process.hrtime()
    };
    try {
        context.callbackWaitsForEmptyEventLoop = false;
        let connectionPromise = utils.dbClient(null, function (error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
        connectionPromise.then(function () {
 
            let data;
            try {
                data = (_.isObject(event.body) ? event.body : JSON.parse(event.body));
            } catch(err) {
                return utils.createResponse(err, null,logger, stats, callback)
            }
            console.log(" Data from  promo engine>>>>", data);
            let promoService = new PromoService(logger);
            promoService.updatePromos(data, (err, result)=>{
                return utils.createResponse(err, result,logger, stats, callback)
            })
        }, function (error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
    } catch (e) {
        return utils.createResponse(e, null, logger, stats, callback);
    }
}

module.exports = {
    createOrUpdatePromo,
    promoUsage,
    updatePromosFromPromoEngine
};