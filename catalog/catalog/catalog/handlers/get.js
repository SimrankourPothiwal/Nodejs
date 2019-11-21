/**
 * Lambda handlers to query category and its attributes
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */
const _ = require('lodash');

const utils = require('phoenix-common');
const constants = require('../utilities/constants/constants_en_us');

const CategoryService = require('../services/categoryService');
const CatalogService = require('../services/catalogService');
const ProductService = require('../services/productService');
const errorCodes = require('../utilities/errorHandlers/errorCode');

/**
 * List all active categories
 * 
 * @param {Object} event 
 * @param {Object} context 
 * @param {Function} callback 
 */
const catalog = function(event, context, callback) {
    let logger = utils.initLogger(event, context);
    let stats = {
        hrstart: process.hrtime()
    };
    try {
        context.callbackWaitsForEmptyEventLoop = false;
        let connectionPromise = utils.dbClient(null, function(error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
        connectionPromise.then(function() {
            let service = new CategoryService(logger);
            console.log(event.pathParameters);
            let entity = event.pathParameters.entity;
            if (entity === 'categories') {
                if (event.pathParameters.id) {
                    if (event.pathParameters.tags === 'tags') {
                        service.getTagsByCategory(event.pathParameters.id, function(error, result) {
                            return utils.createResponse(error, result, logger, stats, callback);
                        });
                    } else {
                        service.getCategory(event.pathParameters.id, function(error, result) {
                            return utils.createResponse(error, result, logger, stats, callback);
                        });
                    }
                } else {
                    service.getAllCategories(event.queryStringParameters, function(error, result) {
                        return utils.createResponse(error, result, logger, stats, callback);
                    });
                }
            } else if (entity === 'products') {
                let req = {};
                req.lastKey = {}, req.attributes = {};
                req.lastKey = (event.queryStringParameters && event.queryStringParameters.lastKey) ? event.queryStringParameters.lastKey : 0;
                req.limit = (event.queryStringParameters && event.queryStringParameters.limit) ? event.queryStringParameters.limit : 10;
                const productService = new ProductService();
                productService.findProducts(req, function(error, result) {
                    utils.createResponse(error, result, logger, stats, callback);
                });
            } else if (entity === 'meta') {
                if (event.pathParameters.id === 'tags') {
                    let catalogService = new CatalogService(logger);
                    catalogService.getCatalogMetaTags(function(error, result) {
                        return utils.createResponse(error, result, logger, stats, callback);
                    });
                } else {
                    return utils.createResponse({ message: 'Unknown entity ' + entity }, null, logger, stats, callback);
                }
            } else {
                return utils.createResponse({ message: 'Unknown entity ' + entity }, null, logger, stats, callback);
            }
        }, function(error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
    } catch (e) {
        return utils.createResponse(e, null, logger, stats, callback);
    }
};

/**
 * Get product details using its UPC.
 * The function expects the UPC to be passed as path parameter.
 *
 * @param {Object} event
 * @param {Object} context
 * @param {Function} callback
 */
const productDetails = function(event, context, callback) {
    let logger = utils.initLogger(event, context);
    let stats = {
        hrstart: process.hrtime()
    };
    try {
        context.callbackWaitsForEmptyEventLoop = false;
        let connectionPromise = utils.dbClient(null, function(error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
        connectionPromise.then(function() {
            if (event.pathParameters && event.pathParameters.id) {
                let req = {
                    attributes: {
                        Upc: event.pathParameters.id
                    },
                    limit: 1,
                    lastKey: 0,
                    reqfor: 'productDetail'
                };
                console.log('Upc at get', req.attributes.Upc);
                const productService = new ProductService();
                productService.findProducts(req, function(error, result) {
                    if (result.Items && result.Items.length > 0) {
                        let info = productService.transformProductDetails(result.Items[0]);
                        result.Items[0].displayNutritionInfo = info;
                        if (_.isObject(info) && Object.keys(info) && Object.keys(info).length > 0) {
                            result.Items[0].rdiMessages = constants.RDI_MSG['us-en'];
                        }
                    }
                    utils.createResponse(error, result, logger, stats, callback);
                });
            } else {
                console.log('no product Upc provided');
                utils.createResponse(new Error('Missing input - Product Upc Code'), null, logger, stats, callback);
            }
        }, function(error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
    } catch (e) {
        utils.createResponse(e, null, logger, stats, callback);
    }
};

/**
 * Accepts an array of product ids and returns unique tags associated with those products
 *
 * Request Format - { product_id; [] }
 *
 * @param {Object} event
 * @param {Object} context
 * @param {Function} callback
 */
const productTags = function(event, context, callback) {
    let logger = utils.initLogger(event, context);
    let stats = {
        hrstart: process.hrtime()
    };
    try {
        context.callbackWaitsForEmptyEventLoop = false;
        let connectionPromise = utils.dbClient(null, function(error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
        connectionPromise.then(function() {
            let requestBody = (_.isObject(event.body)) ? event.body : JSON.parse(event.body);
            if (!requestBody.product_id) {
                logger.error(errorCodes.INVALID_INPUT, requestBody);
                return utils.createResponse(errorCodes.INVALID_INPUT, null, logger, stats, callback);
            }
            const productService = new ProductService();
            productService.getTags(requestBody.product_id, function(error, result) {
                if (error) {
                    return utils.createResponse({ error: errorCodes.SERVICE_FAILURE, details: error }, null, logger, stats, callback);
                }
                return utils.createResponse(null, result, logger, stats, callback);
            });
        }, function(error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });

    } catch (e) {
        return utils.createResponse(e, null, logger, stats, callback);
    }
};

/**
 * Find Product ETA mappings for an array of slins
 * 
 * @param {Object} event 
 * @param {Object} context 
 * @param {Function} callback 
 */
const getETAForProducts = function(event, context, callback) {
    let logger = utils.initLogger(event, context);
    let stats = {
        hrstart: process.hrtime()
    };
    try {
        context.callbackWaitsForEmptyEventLoop = false;
        let connectionPromise = utils.dbClient(null, function(error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });

        connectionPromise.then(function() {
            let requestBody = (_.isObject(event.body)) ? event.body : JSON.parse(event.body);
            if (!requestBody.productIds) {
                logger.error(errorCodes.INVALID_INPUT, requestBody);
                return utils.createResponse(errorCodes.INVALID_INPUT, null, logger, stats, callback);
            }
            const productService = new ProductService(logger);
            productService.getETAForProducts(requestBody.productIds, function(error, result) {
                if (error) {
                    utils.createResponse(error, null, logger, stats, function() {
                        callback(error);
                    });
                    return;
                }
                return utils.createResponse(null, result, logger, stats, callback);
            });
        }, function(error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
    } catch (e) {
        return utils.createResponse(e, null, logger, stats, callback);
    }
};


/**
 * Find all catalog_meta_tags
 * 
 * @param {Object} event 
 * @param {Object} context 
 * @param {Function} callback 
 */
const getCatalogMetaTags = function(event, context, callback) {
    let logger = utils.initLogger(event, context);
    let stats = {
        hrstart: process.hrtime()
    };
    try {
        context.callbackWaitsForEmptyEventLoop = false;
        let connectionPromise = utils.dbClient(null, function(error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });

        connectionPromise.then(function() {
            let catalogService = new CatalogService(logger);
            catalogService.getCatalogMetaTags(function(error, result) {
                return utils.createResponse(error, result, logger, stats, callback);
            });
        }, function(error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });

    } catch (e) {
        return utils.createResponse(e, null, logger, stats, callback);
    }
};

module.exports = {
    catalog: catalog,
    productDetails: productDetails,
    productTags: productTags,
    getETAForProducts: getETAForProducts,
    getCatalogMetaTags: getCatalogMetaTags
};