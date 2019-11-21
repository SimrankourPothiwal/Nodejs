/**
 * Lambda handler to manage tags
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */
const _ = require('lodash');

const ProductService = require('../services/productService');
const utils = require('phoenix-common');
const constants = require('../../utilities/constants/constants_en_us');
// const dbClient = require('../../dbClient');

/**
 * Remove tags association with products and categories
 * 
 * @param {Object} event 
 * @param {Object} context 
 * @param {Function} callback 
 */
const removeTags = function (event, context, callback) {
    let logger = utils.initLogger(event, context);
    let stats = {
        hrstart: process.hrtime()
    };
    try {
        context.callbackWaitsForEmptyEventLoop = false;
        let connectionPromise = utils.dbClient(null, function (error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });

        connectionPromise.then(function(){
            let data = (_.isObject(event.body) ? event.body : JSON.parse(event.body));
            let productService = new ProductService();
            productService.removeTags(data.tags, function (error, result) {
                return utils.createResponse(error, result, logger, stats, callback);
            });
        }, function(error){
            return utils.createResponse(error, null, logger, stats, callback);
        });

    } catch (e) {
        return utils.createResponse(e, null, logger, stats, callback);
    }
};

module.exports = {
    removeTags: removeTags
};