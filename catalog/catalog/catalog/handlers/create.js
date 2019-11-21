/**
 * Lambda handler to create or update a category
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */
const _ = require('lodash');

const CategoryService = require('../services/categoryService');
const ProductService = require('../services/productService');
const ProductUploadService = require('../services/ProductUploadService');
const utils = require('phoenix-common');
const constants = require('../utilities/constants/constants_en_us');

/**
 * Create or update a Category
 * @param {Object} event
 * @param {Object} context
 * @param {Function} callback
 */
function createOrUpdate(event, context, callback) {
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
            console.log(event.pathParameters);
            let entity = event.pathParameters.entity;
            let data = (_.isObject(event.body) ? event.body : JSON.parse(event.body));
            console.log(data);
            if (entity === 'categories') {
                let service = new CategoryService(logger);
                if (event.pathParameters.id === 'regional') {
                    service.refreshRegionalCategories(data, function (error, result) {
                        return utils.createResponse(error, result, logger, stats, callback);
                    });
                } else {
                    service.createOrUpdate(data, function (error, result) {
                        return utils.createResponse(error, result, logger, stats, callback);
                    });
                }
            } else if (entity === 'products') {
                let productService = new ProductService();
                productService.createOrUpdate(data, function (error, result) {
                    utils.createResponse(error, result, logger, stats, callback);
                });
            } else if(entity === 'specials') {
                let service = new ProductUploadService(logger);
                console.log('Update specials');
                service.updateSpecials(data, function (error, result) {
                    return utils.createResponse(error, result, logger, stats, callback);
                });
            }
        }, function (error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
    } catch (e) {
        return utils.createResponse(e, null, logger, stats, callback);
    }
}

module.exports = {
    createOrUpdate: createOrUpdate
};