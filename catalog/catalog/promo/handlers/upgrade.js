// Title: Promo upgrade for cancelled orders
// Description : Provide promo upgrade for cancelled orders
// Author : Vikram 
// Created date : Oct 2018
// Last modified date : Oct 2018

const PromoUpgradeService = require('../service/promoUpgrade');
const utils = require('phoenix-common');

const upgrade = function (event, context, callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    let stats = { hrstart: process.hrtime() };    
    let logger = utils.initLogger(event, context);
    let connectionPromise = utils.dbClient(null, function (error) {
        return utils.createResponse(error, null, logger, stats, callback);
    });
    connectionPromise.then(function () {        
        let payload = event.body;
        const promoSvc = new PromoUpgradeService(logger);
        try {
            promoSvc.promoUpgrade(payload, function (error, getValue) {
                let response = {};
                if (error) {
                    utils.createResponse({
                        message: error.message,
                        errorCode: error.errorCode
                    }, null, logger, stats, callback);
                } else {
                    utils.createResponse(error, getValue, logger, stats, callback);
                }
            });
        }
        catch (error) {
            console.log('AlcoholError', error);
            return utils.createResponse(error, null, logger, stats, callback);
        }
    }, function (error) {
        return utils.createResponse(error, null, logger, stats, callback);
    });   
};

// Export Check
module.exports = {
    upgrade: upgrade
};
