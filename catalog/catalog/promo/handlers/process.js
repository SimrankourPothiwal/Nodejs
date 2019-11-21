const _ = require('lodash');
const utils = require('phoenix-common');
const PromoService = require('../service/PromoService');
const CONST = require('./../utilities/constants/constants_en_us');

const applyPromo2 = function (event, context, callback) {

    let logger = utils.initLogger(event, context);
    let stats = { hrstart: process.hrtime() };
    try {
        context.callbackWaitsForEmptyEventLoop = false;
        let connectionPromise = utils.dbClient(null, function (error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
        connectionPromise.then(function () {
            console.log('[post > searchPromo] calling Promo service');
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
            console.log(payload);
            if (payload.hasOwnProperty('user_claims')) {
                let userClaims = utils.helper.readTokenClaims(event);
                payload.user_claims = userClaims;
            }
            console.log('[post > searchPromo] calling Promo service');
            let service = new PromoService(logger, true);
            service.searchPromo(payload, (err, res) => {
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

module.exports = {
    applyPromo2
};