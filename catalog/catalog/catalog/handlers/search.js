/**
 * Lambda handlers for find / search product using its attributes 
 * or free form text search using limited attributes on the index
 * 
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */
const _ = require('lodash');
const utils = require('phoenix-common');
const constants = require('../utilities/constants/constants_en_us');
// const dbClient = require('../dbClient');

const CategoryService = require('../services/categoryService');
const ProductService = require('../services/productService');
const ProductSearch = require('../services/productSearch');

/**
 * Find / Filter categories based on specified attribute value(s) in request body.
 * 
 * For example, the below request body filters out inactive categories
 * 
 * {
 *  "attributes": {
 *      is_active: true
 *  }
 * }
 * 
 * @param {Object} event Filter attributes specified in the event body
 * @param {Object} context 
 * @param {Function} callback 
 */
function findCategories(event, context, callback) {
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
            let categoryService = new CategoryService(logger);
            let query = _.isObject(event.body) ? event.body : JSON.parse(event.body);
            logger.debug(query, 'Incoming Category Query');
            if (query.department_id) { //Cross dimensional lookup
                console.log('Querying using department_id ' + JSON.stringify(query.department_id));
                categoryService.getCategoriesByDepartmentIds(query.department_id, function (error, result) {
                    return utils.createResponse(error, result, logger, stats, callback);
                });
            } else if (query.attributes) {
                categoryService.findCategories(query, function (error, result) {
                    return utils.createResponse(error, result, logger, stats, callback);
                });
            } else { //No other type of lookup supported
                categoryService.getAllCategories(event.queryStringParameters, function (error, result) {
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


/**
 * Find / filter products using one or more of its attributes.
 * 
 * The request body should be as below.
 * 
 * {
 *  "attributes": {
 *      "tags": "Hot" //Any attribute of product
 *      "category": ["Snacks", "Drinks"] // It can also be array
 *   }
 * }
 * 
 * Path parameters 'limit' and 'lastKey' serves for pagination.
 * When pagination happens, in other words when there are more products to scan, 
 * the response will include a LastEvaludatedKey to indicate there are more products.
 * "LastEvaluatedKey": {
 *        "id": 10
 * }
 * 
 * @param {Object} event 
 * @param {Object} context 
 * @param {Function} callback 
 */
const findProducts = function (event, context, callback) {
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
            logger.debug(event.body, 'Incoming request body');
            let query = (_.isObject(event.body) ? event.body : JSON.parse(event.body));
            const productService = new ProductService();
            productService.findProducts(query, function (error, result) {
                return utils.createResponse(error, result, logger, stats, callback);
            });
        }, function (error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
    } catch (e) {
        return utils.createResponse(e, null, logger, stats, callback);
    }
};

/**
 * ElasticSearch implementation - NOT IN USE FOR MVP
 * 
 * Free form text search, that use an index on ElasticSearch.
 * The product attributes included on the index are name, category and tags.
 * 
 * Product description and nutrition information may be included in future.
 * 
 * @param {Object} event 
 * @param {Object} context 
 * @param {Function} callback 
 */
const searchProductsElasticSearch = function (event, context, callback) {
    let logger = utils.initLogger(event, context);
    try {
        context.callbackWaitsForEmptyEventLoop = false;
        const productSearch = new ProductSearch(logger);
        let query = (_.isObject(event.body) ? event.body : JSON.parse(event.body));
        productSearch.search(query, function (error, result) {
            return callback(null, utils.createResponse(error, result, logger));
        });
    } catch (e) {
        callback(null, utils.createResponse(e, null, logger));
    }
};

/**
 * Free form text search using MongoDB Text Index on 'products' collection
 * 
 * @param {Object} event expects query to be present in queryStringParameters
 * @param {Object} context 
 * @param {Function} callback 
 */
const searchProducts = function (event, context, callback) {
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
            const productService = new ProductService(logger);
            let searchQuery = (_.isObject(event.body) ? event.body : JSON.parse(event.body));

            //this header fuctionality will be controlled by CA and US feature in mongoDB
            let result = utils.helper.parseHeader(event.headers);

            if (!searchQuery.hasOwnProperty('attributes')) { searchQuery.attributes = {}; }
            //add country property to attribute in searchQuery obj or set it to default value
            if(_.isObject(result) && result.hasOwnProperty('country') && !searchQuery.attributes.hasOwnProperty('country')) {
                searchQuery['attributes']['country'] = constants.X_711_LOCALE[result.country];
            } else {
                searchQuery['attributes']['country'] = constants.X_711_LOCALE.default_country;
            }
            productService.search(searchQuery, function (error, result) {
                return utils.createResponse(error, result, logger, stats, callback);
            });

        }, function (error) {
            return utils.createResponse(error, null, logger, stats, callback);
        })
            .catch(function (err) {
                return utils.createResponse(err, null, logger, stats, callback);
            });
    } catch (e) {
        return utils.createResponse(e, null, logger, stats, callback);
    }
};

module.exports = {
    findCategories: findCategories,
    findProducts: findProducts,
    searchProductsElasticSearch: searchProductsElasticSearch,
    searchProducts: searchProducts
};