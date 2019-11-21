/**
 * Category service that use mongoose model to perform CRUD and query operations
 * 
 * @author: Murali Ramachari <murali.ramachari@7-11.com>
 */

const CategoryModel = require('../models/categoryModel');
const CategoryRegionalModel = require('../models/categoryRegionalModel');
const ProductModel = require('../models/productModel');
const RulesModel = require('../models/productLocationRulesModel');
const CategoryQueryModel = require('../models/request/categoryQueryModel');
const StoreDetailsModel = require('../models/storeDetails')

const _ = require('lodash');
const async = require('async');
const Joi = require('joi');

/**
 * @class
 */
class CategoryService {

    /**
     * Constructor with pre-initialized logger
     * @constructor
     * @param {Object} logger 
     */
    constructor(logger) {
        this.logger = logger;
    }

    /**
     * Get a single category details
     * @param {String} categoryId 
     * @param {Function} callback 
     */
    getCategory(categoryId, callback) {
        let logger = this.logger;
        logger.info('Querying for category id %s', categoryId);

        CategoryModel.findOne({ id: categoryId }).exec(function (err, result) {
            if (err) {
                logger.error(err, 'Error querying for a category');
                return callback(err);
            }
            logger.info('Get category success!');
            return callback(null, result);
        });
    }

    /**
     * Returns all active categories
     * 
     * @param {Function} callback 
     */
    getAllCategories(queryParams, callback) {
        let logger = this.logger;
        logger.info('Getting all categories');
        let queries = {
            global: (done) => { CategoryModel.find({ is_active: true }).lean(true).sort({ popularity: 1 }).exec(done); }
        };
        if (_.keys(queryParams).length > 0) {
            let requestValidation = Joi.validate(queryParams, CategoryQueryModel, { allowUnknown: true });
            if (requestValidation.error) {
                console.log('Query params validation failed!', requestValidation.error);
            } else {
                queries.regional = (done) => {
                    this._getRegionalQuery(queryParams, (result) => {
                        if (!result) return done(null, []);
                        CategoryRegionalModel.find(result).lean(true).sort({ state: -1, city: -1, store_id: -1 }).exec(done);
                    })
                };
            }
        }
        console.log('running queries');
        async.parallel(queries, (err, result) => {
            if (err) {
                logger.error(err, 'Error querying for category list');
                return callback(err);
            }
            result.regional = this._filterRegional(result.regional);
            let response = this._applyRegionalOverlay(result.global, result.regional);
            return callback(null, response);
        });
    }

    _getRegionalQuery(queryParams, done) {
        let state = queryParams.state;
        let city = queryParams.city;
        let store_id = queryParams.store ? queryParams.store : queryParams.store_id;
        let query = {};
        query.$or = []
        if (!state) return done();
        if (city && store_id) { // All 3 - State, City and StoreID
            query.$or.push({ state: state, city: city, store_id: store_id });
            query.$or.push({ state: state, city: city, store_id: null });
            query.$or.push({ state: state, city: null, store_id: null });
            return done(query);
        } else if (city) { // State and City
            query.$or.push({ state: state, city: city, store_id: null });
            query.$or.push({ state: state, city: null, store_id: null });
            return done(query);
        } else if (store_id) { // State and StoreID
            StoreDetailsModel.find({ store_id: store_id }).lean(true).exec((err, result) => {
                if (result && result.length > 0) {
                    query.$or.push({ state: state, city: result[0].city, store_id: store_id });
                    query.$or.push({ state: state, city: result[0].city, store_id: null });
                    query.$or.push({ state: state, city: null, store_id: null });
                    return done(query);
                }
                query.$or.push({ state: state, city: null, store_id: store_id });
                query.$or.push({ state: state, city: null, store_id: null });
                return done(query);
            });
        } else { //Only state
            query.$or.push({ state: state, city: null, store_id: null });
            return done(query);
        }
    }

    _filterRegional(regionalCats) {
        let refionalCatsCopy = _.cloneDeep(regionalCats);
        let filtertedRegional = [];
        _.forEach(refionalCatsCopy, (category) => {
            let filteredCat = (regionalCats.filter((cat) => { return cat.id === category.id; }))[0];
            _.pull(filtertedRegional, filteredCat);
            filteredCat.is_active ? filtertedRegional.push(filteredCat) : '';
        })
        return filtertedRegional;

    }
    _applyRegionalOverlay(globalCats, regionalCats) {
        let response = { Items: [] };
        if (globalCats && globalCats.length > 0) {
            response.Items = globalCats;
        }
        if (regionalCats && regionalCats.length > 0) {
            let ids = _.map(regionalCats, (c) => c.id);
            response.Items = _.filter(response.Items, (i) => !_.includes(ids, i.id));
            response.Items = _.concat(response.Items, regionalCats);
        }
        response.Items = _.filter(response.Items, (i) => i.is_active);
        response.Items = _.sortBy(response.Items, ['popularity']);
        response.Count = response.Items.length;
        return response;
    }

    refreshRegionalCategories(req, done) {
        let self = this;
        if (!(req && req.meta_tags)) return done();
        if (_.isString(req.meta_tags)) req.meta_tags = [req.meta_tags];
        async.each(req.meta_tags, (metaTag, done) => {
            RulesModel.find({ meta_tag: metaTag }).lean(true).exec((err, rules) => {
                async.each(rules, (rule, done) => {
                    self.updateRegionalCategories(rule, done);
                }, done);
            });
        }, done);
    }

    updateRegionalCategories(rule, done) {
        if (!rule || !rule.meta_tag) return done();
        let self = this;
        CategoryModel.find({ meta_tags: rule.meta_tag }).lean(true).exec((err, cats) => {
            if (!cats || cats.length < 1) return done();
            let regionalcats = self._createRegionalCategories(rule, cats);
            async.each(regionalcats, (rcat, done) => {
                CategoryRegionalModel.findOneAndUpdate({ id: rcat.id, state: rcat.state, city: rcat.city, store_id: rcat.store_id }, rcat, { upsert: true }, done);
            }, done);
        });
    }

    _createRegionalCategories(rule, cats) {
        _.forEach(cats, (cat) => {
            if (_.isBoolean(rule.sellable)) {
                delete cat._id; delete cat.__v;
                cat.state = (rule.state) ? rule.state : null;
                cat.city = (rule.city) ? rule.city : null;
                cat.store_id = (rule.store_id) ? rule.store_id : null;
                cat.is_active = (rule.sellable) ? true : false;
            }
        });
        return cats;
    }

    /**
     * Returns list of tags for the given category
     * 
     * For example,
     * 
     * {
     *   "tags": [
     *     "Pizza",
     *      "Hot",
     *     "Chicken",
     *     "Sub",
     *     "Sandwich",
     *     "Salad",
     *     "Taquito",
     *     "Burger",
     *     "Italian"
     *   ]
     * }
     * 
     * @param {String} categoryId 
     * @param {Function} callback 
     */
    getTagsByCategory(categoryId, callback) {
        let self = this;
        self.logger.info('Fetching tags for category %s', categoryId);

        CategoryModel.findOne({ id: categoryId }).exec(function (err, category) {
            if (err) {
                self.logger.error(err, 'Error querying for a category');
                return callback(err);
            }
            if (category.tags && category.tags.length > 0) {
                return callback(null, { tags: category.tags });
            } else {
                //Eventually the below code has to go into a batch process and 
                //also part of product update flow
                let tags = [];
                ProductModel.find({
                    category_id: categoryId
                }).exec(function (err, result) {
                    if (err) {
                        self.logger.error(err, 'Error querying for tags');
                        return callback(err);
                    }
                    if (result && result.length && result.length > 0) {
                        _.forEach(result, function (value) {
                            if (_.isArray(value.tags)) {
                                console.log(value.tags);
                                _.forEach(value.tags, function (tagval) {
                                    tags.push(tagval);
                                });
                            }
                        });
                    }
                    let uniqueTags = _.uniq(tags);
                    category.tags = uniqueTags;
                    self.createOrUpdate(category, function (error) {
                        if (error) {
                            self.logger.error('Unable to update tags into category ' + categoryId);
                        }
                        self.logger.info('Returning tags %s for category %s', JSON.stringify(uniqueTags), categoryId);
                        return callback(null, {
                            tags: uniqueTags
                        });
                    });
                });
            }
        });
    }

    /**
     * Returns categories for the given list of department ids
     * 
     * Recommended Index
     * db.products.createIndex({category_id: 1, department_id: 1, tags: 1})
     * 
     * @param {Array} departmentIds Array of department ids
     * @param {Function} callback 
     */
    getCategoriesByDepartmentIds(departmentIds, callback) {
        let logger = this.logger;
        logger.info('Querying for category using department ids', departmentIds);
        ProductModel.find().where('department_id').in(departmentIds).exec(function (error, result) {
            if (error) return callback(error);
            let categoryIds = [];
            _.forEach(result, function (value) {
                categoryIds.push(value.category_id); //Unique category ids
            });
            let uniqueCategories = _.uniq(categoryIds);
            CategoryModel
                .find()
                .where('id').in(uniqueCategories)
                .where('is_active').equals(true)
                .exec(function (error, result) {
                    if (error) {
                        logger.error(error, 'Error querying for Categories using Department ids');
                        return callback(error);
                    }
                    if (result && result.length && result.length > 0) {
                        logger.info('Returning ' + result.length + ' categories');
                        return callback(null, {
                            Items: result,
                            Count: result.length
                        });
                    } else {
                        return callback(null, { Items: [] });
                    }
                });
        });
    }

    /**
     * Find categories by its attributes 
     * 
     * @param {JSON} request { attributes: { <any attributes of category> }, limit: 20, lastKey: 10 } 
     * @param {Function} callback 
     */
    findCategories(request, callback) {
        let self = this;
        let query = CategoryModel.find();
        if (request.attributes) {
            _.forEach(request.attributes, function (value, key) {
                if (_.isArray(value)) {
                    query = query.where(key).in(value);
                } else {
                    query = query.where(key).equals(value);
                }
            });
        }

        self.limit = 10, self.skip = 0;
        if (request.limit && _.isNumber(request.limit)) self.limit = Number.parseInt(request.limit);
        if (request.lastKey && _.isNumber(request.lastKey)) self.skip = Number.parseInt(request.lastKey);
        query = query.limit(self.limit).skip(self.skip);

        let response = { Items: [] };

        query.lean(true).exec(function (error, result) {
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
     * Create a new category or update an existing one
     * 
     * @param {Object} category Category object to be saved
     * @param {Function} callback 
     */
    createOrUpdate(category, callback) {
        let logger = this.logger;
        logger.info('Saving category %s', category);
        let model = new CategoryModel(category);
        let modelError = model.validateSync();
        if (modelError) {
            return callback(modelError);
        } else {
            CategoryModel.findOneAndUpdate({ id: category.id }, category, { new: true, upsert: true }, function (err, savedValue) {
                if (err) {
                    return callback(err);
                } else {
                    return callback(null, savedValue);
                }
            });
        }
    }
}

module.exports = CategoryService;