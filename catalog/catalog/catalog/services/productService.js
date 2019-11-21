/**
 * Product service for basic CRUD operations, filtering and get detailed information on product
 * including nutrition information.
 *
 * @author: Murali Ramachari <murali.ramachari@7-11.com>
 */
const async = require('async');
const _ = require('lodash');
const Joi = require('joi');
const utils = require('phoenix-common');

const ProductModel = require('../models/productModel');
const CategoryModel = require('../models/categoryModel');
const ProductDetailsModel = require('../models/productDetailsModel');
const ProductSearchQueryModel = require('../models/productSearchQueryModel');
const NutritionFactsMeta = require('../models/nutritionFactsMeta');
const constants = require('../utilities/constants/constants_en_us');
const errorObjects = require('../utilities/errorHandlers/error');
const ProductPersonalization = require('./ProductPersonalization');

/**
 * @class
 */
class ProductService {

    /**
     * @constructor
     */
    constructor(logger) {
        this.logger = logger;
        this.limit = (process.env.RECORD_LIMIT) ?
            Number.parseInt(process.env.RECORD_LIMIT) : 20;
    }

    /**
     * Find / filter products based on its attributes.
     *
     * Example request:
     *
     * {
     *      attributes: {
     *          "category": "Drinks"
     *      }
     * }
     *
     * @param {Object} req request object with attributes to filter
     * @param {Function} callback
     */
    findProducts(req, callback) {
        var query;
        this.limit = 10;
        this.skip = 0;

        let self = this;
        self.limit = (req && req.attributes && req.limit) ? Number.parseInt(req.limit) : self.limit;
        self.skip = (req && req.lastKey) ? Number.parseInt(req.lastKey) : self.skip;

        if (req && req.reqfor && req.reqfor === 'productDetail') {
            query = ProductDetailsModel.find();
        } else {
            query = ProductModel.find({ is_active: true });
        }

        if (req.attributes) {//Adding optional attribute filters
            _.forEach(req.attributes, function (value, key) {
                if (_.isArray(value)) {
                    query = query.where(key).in(value);
                } else {
                    query = query.where(key).equals(value);
                }
            });
        }
        if (req.projection) {
            query.select(req.projection);
        }

        let sortOptions = { popularity: 1 };
        if (req.sort) {
            _.forEach(req.sort, function (sortAttribute) {
                if (_.isString(sortAttribute)) {
                    sortOptions[sortAttribute] = 1;
                } else if (_.isObject(sortAttribute)) {
                    _.forEach(sortAttribute, (v, k) => {
                        sortOptions[k] = v;
                    });
                }
            });
        }
        query = query.sort(sortOptions);

        query.limit(self.limit).skip(self.skip).lean().exec(function (err, result) {
            if (err) return callback(err);
            let response = { Items: [] };
            if (result && result.length > 0) {
                response.Items = result;
                response.Count = result.length;
                if (result.length === self.limit) {
                    response.LastEvaluatedKey = {
                        id: self.skip + result.length
                    };
                }
            }
            callback(null, response);
        });
    }

    /**
     * Free form search using MongoDB text index.
     *
     * MongoDB Text Index search always tokenize incoming query and returns result
     * only when whole word match occurs. This doesn't work well for prefix search,
     * few characters search requirement in case of suggestion lookup. In cases
     * where there is no white space available (unable to use Text Index), it falls back
     * to a simple regex search.
     *
     * Below is the definition of index which includes attributes - name, desc, category and tags
     * db.products.createIndex({name: "text", desc: "text", category: "text", tags: "text"})
     *
     * Request Object:
     * {
     *      query: <String> (required),
     *      limit: <Number> (optional),
     *      lastKey: <Number> (optional)
     * }
     *
     * @param {Object} query
     * @param {Function} callback
     */
    search(searchRequest, callback) {
        let self = this;
        this.logger.info(searchRequest, 'incoming search request');
        var result = Joi.validate(searchRequest, ProductSearchQueryModel);
        if (result.error) {
            return callback(result.error);
        }


        if (searchRequest.query) {
            //Strip out everything other than alphabets and numbers
            searchRequest.query = searchRequest.query.trim().replace(/[^a-zA-Z0-9 -]/g, ' ');
            while (searchRequest.query.indexOf('  ') !== -1) {
                searchRequest.query = searchRequest.query.replace('  ', ' ');
            }
            if (searchRequest.query.indexOf(' ') !== -1) {
                searchRequest.terms = _.split(searchRequest.query, ' ');
            }
            if (searchRequest.query.indexOf(' ') !== -1) {
                searchRequest.query = '\"' + searchRequest.query.split(' ').join('\" \"') + '\"';
            }
        } else {
            searchRequest.query = '';
        }

        console.log("SearchQuery Request--------------------", searchRequest,",F_SEARCH_FLAG:",process.env.F_SEARCH_FLAG);

        //Feature Flag ON - For New Search Mechanism
        if (searchRequest.query && process.env.F_SEARCH_FLAG === 'ON') {
            utils.getSearchResults(searchRequest, (err, productResults) => {
                if (err) {
                    console.log("Error getting response for the Search Results::::", err);
                    return callback(err);
                }

              //  console.log('Initial Search Response:::::::',productResults);

                let items = _.isEmpty(productResults) ? [] : productResults.items;

                let lastKeyVal =  !_.isEmpty(productResults) && (productResults.lastkey) ? productResults.lastkey : 0;

                if (!_.isArray(items) || items.length < 1) {
                    return callback(null, { Items: [] });
                }
                let productIds = _.uniq(_.map(items, item => item.product_id));

           // projection added for catalog search
           let projection;
           if (searchRequest.suggest) {
               projection = {$project:{ name: 1, id: 1, product_id: 1, category: 1 ,'__order':1 }};
           }
           /*
           * added __order for projection and search to make sure get the results in the same order.
           */
           let sortOptions = { '__order': 1,available: -1 };
           if (searchRequest.sort) {
               _.forEach(searchRequest.sort, function (sortAttribute) {
                   if (_.isString(sortAttribute)) {//Array of field names [ 'name', 'price' ]
                       sortOptions[sortAttribute] = 1;//Defaults to ascending
                   } else if (_.isObject(sortAttribute)) {//Array of objects [{name: 1}, {price:1}]
                       _.forEach(sortAttribute, (v, k) => {
                           sortOptions[k] = v;
                       });
                   }
               });
           }
           let search_attributes ={};
           if (searchRequest.attributes) {
               _.forEach(searchRequest.attributes, function (value, key) {
                   if(Array.isArray(value)){
                       search_attributes[key] = {$in: value};
                   }
                   else{
                       search_attributes[key] = value;
                   }
               });
           }
           console.info('search_attributes:',search_attributes);
           // preparing the match object for the aggregate search
           let match = {
               $match: {
                   product_id: { $in: productIds },...search_attributes,
                    is_active: true, original_price: { $gt: 0 }
               }
           };

           let query_search = [ match,
               { $addFields: { '__order': { $indexOfArray: [productIds, '$product_id'] } } },
               { $sort: sortOptions },
           ];
           if(!_.isEmpty(projection)){
               query_search.push(projection);
           }
           ProductModel.aggregate(query_search, (err, result) => {
               if (err) {
                        console.log('Error while getting the Products. ', err);
                        return callback(err);
                    }
                    console.log("Total Record count:", result.length);
                    if (!result || result.length < 0) {
                        return callback(null, { Items: [] });
                    }
                    let finalResult = self.constructSearchResult(result,lastKeyVal);
                    return callback(null, finalResult);
                });
            });
        }else {            //Existing search logic if the Feature Flag is off
        async.parallel([
            self.runIndexAndRegExSearch.bind(self, searchRequest),
            self.aggregateCategories.bind(self, searchRequest)
        ], function (err, result) {//Combine both product result and category result
            let finalResult = {};
            _.forEach(result, function (value) {
                _.assign(finalResult, value);
            });
            callback(null, finalResult);
        });

    }
    }

    constructSearchResult(spResult,last_key) {
        let finalResult = { Items: [], Count: 0, categories: [] };
        finalResult.Items = _.uniqBy(spResult, 'product_id');
        finalResult.categories = _.uniq(_.map(spResult, item => item.category));
        finalResult.Items = this.removeDuplicates(finalResult);
        finalResult.Count = finalResult.Items.length;
        if(last_key > 0){
            finalResult.LastEvaluatedKey = { id: last_key };
        }
         return finalResult;
    }

    removeDuplicates(result){
        let self = this;
        let finalResult = { Items: [] };
        let uniqueProductNames = new Set();
        _.forEach(result.Items, function (product) {
            if (!uniqueProductNames.has(product.name)) {
                finalResult.Items.push(product);
                uniqueProductNames.add(product.name);
            }
        });
        _.assign(finalResult.Items, result.Items);
        return finalResult.Items;
    }

    getRegExSearchCondition(searchRequest) {
        if (searchRequest.query) {
            let conditions = [];
            if (searchRequest.terms && searchRequest.terms.length > 0) {
                _.forEach(searchRequest.terms, (term) => {
                    conditions.push({ name: { $regex: '\\b' + term, $options: 'i' }, country: searchRequest.attributes.country });
                    conditions.push({ name: { $regex: term, $options: 'i' }, country: searchRequest.attributes.country });
                });
            }
            conditions.push({ name: { $regex: '\\b' + searchRequest.query, $options: 'i' }, country: searchRequest.attributes.country });
            conditions.push({ name: { $regex: searchRequest.query, $options: 'i' }, country: searchRequest.attributes.country });
            conditions.push({ tags: { $regex: searchRequest.query, $options: 'i' }, country: searchRequest.attributes.country });
            conditions.push({ category: { $regex: searchRequest.query, $options: 'i' }, country: searchRequest.attributes.country });
            let regexQuery = _.cloneDeep({ $or: conditions });
            return regexQuery;
        } else {
            return {};
        }
    }

    /**
     * Run prefix search and index search in parallel and aggregates the result of each in the same order
     *
     * @param {JSON} searchRequest
     * @param {Function} callback
     */
    runIndexAndRegExSearch(searchRequest, callback) {
        let self = this;
        let parallelSearch = [];

        //Prefix search
        if (searchRequest.suggest) {
            parallelSearch.push(function (callback) {
                ProductModel.find({
                    is_active: true,
                    original_price: { $gt: 0 },
                    name: { $regex: '^' + searchRequest.query, $options: 'i' },
                    country: searchRequest.attributes.country
                }).select('name product_id').lean(true).exec(function (err, result) {
                    if (result && result.length > 0) {
                        callback(null, { Items: result });
                    } else {
                        callback(null, { Items: [] });
                    }
                });
            }.bind(self));
        }

        //Index and RegEx search
        parallelSearch.push(function (callback) {
            async.tryEach([
                //1) Try run Text Index search first
                function runIndexSearch(done) {
                    searchRequest.indexSearchFlag = true;
                    self.runSearch(searchRequest, function (err, result) {
                        if (err || !result || !result.Count || result.Count === 0) {
                            done(new Error('fallback to regex search'));
                        } else {
                            done(null, result);
                        }
                    });
                },
                //2) Re-try with RegEx search
                function runRegExSearch(done) {
                    searchRequest.indexSearchFlag = false;
                    self.runSearch(searchRequest, done);
                }
            ], callback);
        }.bind(self));

        async.parallel(parallelSearch, function (err, result) {
            let finalResult = { Items: [] };
            let uniqueProductNames = new Set();
            _.forEach(result, function (value) {
                _.forEach(value.Items, function (product) {

                    if (!uniqueProductNames.has(product.name)) {
                        finalResult.Items.push(product);
                        uniqueProductNames.add(product.name);
                    }
                });
                delete value.Items;
                _.assign(finalResult, value);
            });
            //count Fix
            finalResult.Count = finalResult.Items.length;
            callback(null, finalResult);
        });
    }

    /**
     * Executes search query
     *
     * @param {JSON} searchRequest
     * @param {Function} callback
     */
    runSearch(searchRequest, callback) {
        let self = this; self.limit = 100, self.skip = 0;
        self.limit = (searchRequest.limit) ? Number.parseInt(searchRequest.limit) : self.limit;
        self.skip = (searchRequest.lastKey) ? Number.parseInt(searchRequest.lastKey) : self.skip;
        let query = self.getSearchQuery(searchRequest);
        if (searchRequest.attributes) {//Adding optional attribute files
            _.forEach(searchRequest.attributes, function (value, key) {
                query = (_.isArray(value)) ? query.where(key).in(value) : query.where(key).equals(value);
            });
        }

        query
            .where('is_active').equals(true)
            .where('original_price').gt(0)
            .limit(self.limit)
            .skip(self.skip)
            .lean(true)
            .exec(function (err, result) {
                if (err) return callback(err);
                else callback(null, self.processSearchResult(err, result));
            });
    }

    /**
     * Processes result and returns response in the below format
     *
     * { Items: [], Count: 10, LastEvaluatedKey: { id: 10 } }
     *
     * @param {Error} err
     * @param {Object} result
     */
    processSearchResult(err, result) {
        let response = { Items: [] };
        if (result && result.length > 0) {
            response.Items = result;
            response.Count = result.length;
            if (result.length === this.limit) {
                response.LastEvaluatedKey = {
                    id: this.skip + result.length
                };
            }
        }
        return response;
    }

    /**
     * Switches projection based on suggest flag in the search request.
     * Switches search strategy Text Index vs RegEx based on indexSearchFlag in the search request.
     *
     * @param {JSON} searchRequest see models/productSearchQueryModel
     * @param {Boolean} indexSearchFlag true - text index query, false - regex query
     */
    getSearchQuery(searchRequest) {
        let self = this;
        if (!searchRequest.query) {
            console.log('No query string found! Falling back to attribute filters...');
            return ProductModel.find();
        }

        //Project limited fields for search suggestion
        let projection = (searchRequest.suggest) ? {
            product_id: true,
            name: true
        } : {};

        if (searchRequest.indexSearchFlag) {//Index search
            projection.score = { $meta: constants.SEARCH_SCORE_META };
            return ProductModel.find(
                {
                    $text: {
                        $search: searchRequest.query,
                        $diacriticSensitive: false
                    },
                    country: searchRequest.attributes.country
                },
                projection
            ).sort({ score: { $meta: constants.SEARCH_SCORE_META } });
        } else {//RegEx search
            return ProductModel.find(self.getRegExSearchCondition(searchRequest), projection);
        }
    }


    /**
     * Aggregation pipeline to extract unique Categories matching the search query
     *
     * Note: As it is dependent on Text Index, the limitation of full word hit applies here as well
     */
    aggregateCategories(searchRequest, done) {
        let self = this;
        if (searchRequest.query) {
            let matchingCondition = {};
            if (searchRequest.attributes) _.assign(matchingCondition, searchRequest.attributes);
            _.assign(matchingCondition, { is_active: true, original_price: { $gt: 0 } });
            async.parallel([
                (done) => {
                    let textSearchCondition = _.cloneDeep(matchingCondition);
                    textSearchCondition.$text = { $search: searchRequest.query };
                    textSearchCondition.$text = { $search: searchRequest.query };
                    self.searchProducts(textSearchCondition, { category: 1, score: { $meta: 'textScore' } }, done);
                },
                (done) => {
                    let regExSearchCondition = _.cloneDeep(matchingCondition);
                    regExSearchCondition = _.assign(regExSearchCondition, self.getRegExSearchCondition(searchRequest));
                    self.searchProducts(regExSearchCondition, { category: 1 }, done);
                }
            ], (err, results) => {
                if (err) { return done(err); }
                let categories = [];
                _.forEach(results, (result) => {
                    if (result && result.categories) {
                        categories = _.union(categories, result.categories);
                    }
                });
                return done(null, { categories: categories });
            });
        } else {
            done();
        }
    }

    searchProducts(matchingCondition, projection, done) {
        let aggregattionQuery = [
            { $match: matchingCondition }
            , { $project: projection }
            , { $group: { _id: { category: '$category' } } }
        ];
        ProductModel.aggregate(aggregattionQuery).exec(function (err, result) {
            if (err) { console.log(err); return done(err); }
            if (result && result.length && result.length > 0) {
                return done(null, { categories: _.uniq(_.flattenDeep(_.map(result, function (value) { return value._id.category; }))) });
            } else {
                return done();
            }
        });
    }

    /**
     * Create a new product or update existing product
     *
     * @param {Object} product
     * @param {Function} callback
     */
    createOrUpdate(product, callback) {
        let logger = this.logger;
        logger.info('Saving product %s', product);
        let model = new ProductModel(product);
        let modelError = model.validateSync();
        if (modelError) {
            return callback(modelError);
        } else {
            ProductModel.findOneAndUpdate({ id: product.id }, product, { new: true, upsert: true }, function (err, savedValue) {
                if (err) {
                    return callback(err);
                } else {
                    return callback(null, savedValue);
                }
            });
        }
    }

    /**
     * Create new product details or update existing one
     *
     * @param {JSON} productDetails
     * @param {Function} callback
     */
    createOrUpdateProductDetails(productDetails, callback) {
        let logger = this.logger;
        logger.debug('Saving product details %s', productDetails);
        let model = new ProductDetailsModel(productDetails);
        let modelError = model.validateSync();
        if (modelError) {
            console.log(modelError);
            return callback(modelError);
        } else {
            ProductDetailsModel.findOneAndUpdate({ Upc: productDetails.Upc }, productDetails, { new: true, upsert: true }, function (err, savedValue) {
                if (err) {
                    console.log(err);
                    return callback(err);
                } else {
                    return callback(null, savedValue);
                }
            });
        }
    }

    /**
     * Remove one or more tags across Products
     * @param {Array} tags Array of tags
     * @param {Function} callback 
     */
    removeTags(tags, callback) {
        let logger = this.logger;
        if (tags && tags.length > 0) {
            let saveCalls = [];
            ProductModel.find().where('tags').in(tags).exec(function (err, result) {
                _.forEach(result, function (product) {
                    if (product.tags) {
                        product.set('tags', _.remove(product.tags, function (value) {
                            return !_.includes(tags, value);
                        }));
                    }
                    saveCalls.push(product.save());
                });
                Promise.all(saveCalls).then(function () {
                    //Clearning cached tags data from all categories
                    CategoryModel.update({}, { $unset: { 'tags': '' } }, { multi: true }, function (err) {
                        if (err) return callback(err);
                        return callback();
                    });
                }).catch(function (err) {
                    return callback(err);
                });
            });
        } else {
            logger.error('Invalid input. Tags must be an array of string', tags);
            return callback(new Error('Invalid input. Tags must be an array of string', tags));
        }
    }

    /**
     * Transformes the incoming raw product details into display friendly format using the
     * NutritionFactsMeta data definition
     *
     * @private
     * @param {Object} pd Product details object for transformation
     */
    transformProductDetails(pd) {
        if (!_.has(pd, 'NutritionFacts.Variant[0].Nutrient[0]')) {
            console.log('No nutrition facts available');
            return {};
        }

        let nutrients = pd.NutritionFacts.Variant[0].Nutrient;
        let variant = pd.NutritionFacts.Variant[0];
        let nutritionInfoMap = new Map();
        _.forEach(nutrients, function (value) {
            nutritionInfoMap.set(value.Name, value);
        });

        let resultNutritionInfo = {};
        resultNutritionInfo.servingSize = [];
        if (variant.ServingsPerContainer) {
            resultNutritionInfo.servingSize = [{ name: 'Servings Per Container', value: variant.ServingsPerContainer }];
        }
        let metricSize = '';
        if (variant.ServingSizeText && variant.ServingSizeUOM) {
            metricSize = variant.ServingSizeText + ((variant.ServingSizeUOM === 'oz' || variant.ServingSizeUOM === 'fl oz') ? variant.ServingSizeUOM : ' ' + variant.ServingSizeUOM);
        }
        if (variant.ServingSizeText && !variant.ServingSizeUOM) {
            metricSize = variant.ServingSizeText;
        }
        if (nutritionInfoMap.get('MetricServingSize')) {
            let metricServiceSize = nutritionInfoMap.get('MetricServingSize');
            metricSize += ' (' + metricServiceSize['Quantity'] + metricServiceSize['UOM'] + ')';
        }
        if (metricSize !== '') {
            resultNutritionInfo.servingSize.push({ name: 'Serving Size', value: metricSize });
        }
        _.forOwn(NutritionFactsMeta, function (valueMeta, key) {
            _.forEach(valueMeta, function (singleNutritionMeta) {//Value always an array in meta
                _.forOwn(singleNutritionMeta, function (displayValueKey, nutritionName) {//For each nutrition names in meta
                    let nutritionObject = nutritionInfoMap.get(nutritionName);//Lookup corresponding object from data
                    let displayValue = '';
                    _.forEach(displayValueKey, function (value) {//Append field values to produce display text
                        if (_.has(nutritionObject, value)) {
                            if (value === 'Percentage') {
                                displayValue += nutritionObject[value] + '%';
                            } else if (value === 'Quantity') {
                                let quantity = nutritionObject[value];
                                if (quantity.indexOf('-') === 0) {
                                    quantity = quantity.replace('-', '<');
                                }
                                displayValue += quantity;
                            } else {
                                displayValue += nutritionObject[value];
                            }
                        }
                    });
                    if (!resultNutritionInfo[key]) resultNutritionInfo[key] = [];
                    if (displayValue) {
                        let displayObject = {
                            name: nutritionName,
                            value: displayValue
                        };
                        resultNutritionInfo[key].push(displayObject);
                    }
                });
            });
        });

        return resultNutritionInfo;
    }

    /**
     * Accepts an array of product ids and returns unique list of tags associated with those products
     *
     * @param {Array} productIdArray array of product ids
     * @param {Function} callback
     */
    getTags(productIdArray, callback) {
        if (!(_.isArray(productIdArray) && productIdArray.length > 0)) {
            return callback(new errorObjects.DataFormatError('product ids should be an array and should contain at least one product id'));
        }

        ProductModel.distinct('tags', { id: { $in: productIdArray } }, function (err, result) {
            if (err) {
                return callback(new errorObjects.DBError('error getting unique tags', err));
            }
            return callback(null, { tags: result });
        });
    }

    /**
     * Get ETA for a product
     * @param {array} slins
     * @param {Function} callback
     * @return {Object}
     */
    getETAForProducts(productIds, callback) {
        console.log('productIds .. ', productIds);
        if (!(_.isArray(productIds) && productIds.length > 0)) {
            return callback(new errorObjects.DataFormatError('productIds should be an array and should contain at least one product id'));
        }
        ProductModel.find({
            'id': {
                $in: productIds
            }
        }).select('id equipment time_in_seconds meta_tags').lean(true).exec(function (err, etas) {
            console.log('Catalog getETAForProducts err, etas : ', err, etas);
            if (err) {
                new errorObjects.DataFormatError('Unable to fetch ETAs', err);
                return callback(err);
            }
            return callback(null, etas);
        });
    }
}

module.exports = ProductService;
