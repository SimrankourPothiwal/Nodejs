'use strict';
const async = require('async');
const mongoose = require('mongoose');
const _ = require('lodash');
const xlsx = require('xlsx');
const common = require('phoenix-common');
const AWS = require('aws-sdk');

const CategoryModel = require('./../models/categoryModel');
const ProductModel = require('./../models/productModel');
const ProductComboModel = require('./../models/productComboModel');

const StoreProductsModel = require('../models/storeProducts');

//const CONST = require('../utilities/constants/constants_en_us');

const productSheetName = 'Products';


class ProductComboUploadService {
    constructor(logger, debug = false, country = 'US', mode = 'update') {
        this.logger = logger;
        this.debug = debug; //default
        this.country = country;
        this.mode = mode;

        this.categoriesMap = new Map(); //will be populated from mongoDb collection
        this.estimatedPrepTime = new Map(); // will be populated from xls sheet

        this.failureList = []; //will capture failed items
        this.notFound = []; //update the 
        this.categoryNotFound = [];
        this.countryMismatch = [];
        this.requireFields = [];

        this.updatedProducts = [];
        this.addedProducts = [];

        this.errorList = [];
        this.bufferXls = null; //fill the xlsx concat buffer
        this.specialFail = [];
        //this.categoryService = new CategoryService(logger);
    }

    uploadData(s3_object, callback) {

        const self = this;
        if (self.debug) mongoose.set('debug', true);
        const logger = self.logger;
        async.series([
            self._readFileFromS3.bind(self, s3_object),
            self._readProductsFromSheet.bind(self, productSheetName),
            self._filterUpdateOnlyItems.bind(self),
            self._loadCategoriesFromCollection.bind(self),
            self._resolveProducts.bind(self),
            self._updateProductsToDB.bind(self),
        ], function (err) {
            if (err) {
                logger.error(err);
                return callback(err);
            }
            return callback(null, { status: 'success' });
        });
    }

    _resolveProducts(done) {
        let self = this;
        async.eachLimit(self.products, 30, (product, done) => {
            //product.flavor_id= product;
            console.log('product.flavor_id', product.flavor_id);
            product.category=product.category.trim(); 
            product.name = product.name.trim();
            product.long_desc= product.long_desc.trim();
            product.slin_1= product.slin_1.trim();
            product.slin_2= product.slin_2.trim();
            product.product_id = 'B-' + product.slin_1 + '-' + product.slin_2 + (product.flavor_id ? '-' + product.flavor_id : '');
            let categoryId = self.categoriesMap.get(product.category);
            if (!categoryId) {
                self.errorList.push('Unable to find category', product.category);
                self.logger.info('Unable to find category', product.category);
                return done();
            }
            product.category_id = self.categoriesMap.get(product.category).id;
            product.desc= product.long_desc;
            product.is_active = true;
            product.matching_ids = [];
            product.original_price = 0;
            product.thumbnail = ' ';
            product.handling = null;
            product.equipment = '';
            product.time_in_seconds = 0;
            product.perishable = false;
            product.upcs = [];
            product.calories = 0;
            product.type = '';
            if(product.popularity) product.popularity = parseInt(product.popularity);
            product.age_restricted = false;
            product.tags = [];
            product.minimum_on_hand_quantity = 0;
            product.limit_per_order = 100;
            product.images = [];
            product.country = self.country;
            product.last_updated = new Date();
            product.meta_tags = [];
            async.series([
                (done) => {
                    let query = { slin: product.slin_1 };
                    if (!_.isUndefined(product.flavor_id_1) && !_.isNull(product.flavor_id_1)) query.flavor_id = product.flavor_id_1;
                    self._updateProductUsingSlin.bind(self, query, product, done)();
                },
                (done) => {
                    let query = { slin: product.slin_2 };
                    if (!_.isUndefined(product.flavor_id_1) && !_.isNull(product.flavor_id_2)) query.flavor_id = product.flavor_id_2;
                    self._updateProductUsingSlin.bind(self, query, product, done)();
                }
            ], done);
        }, done);
    }

    _updateProductUsingSlin(query, product, done) {
        ProductModel.find(query).exec((err, result) => {
            if (err) { this.logger.info(err); return done(); }
            if (result.length === 0) { this.logger.info('No catalog for this slin', product.slin_1, product.flavor_id_1);  product.delete='x'; return done(); }
            let dbProduct = result[0];
            product.matching_ids = product.matching_ids.concat([dbProduct.product_id]);
            product.original_price = product.original_price + dbProduct.original_price;
            if (!_.isUndefined(dbProduct.handling) && dbProduct.handling !== 'N/A') product.handling = !_.isNull(product.handling) ? (product.handling + '&' + dbProduct.handling) : dbProduct.handling;
            if(dbProduct.equipment && dbProduct.equipment !== 'N/A'){
                product.equipment = (product.equipment) ? product.equipment + ',' + dbProduct.equipment : dbProduct.equipment;
            }
            product.time_in_seconds = product.time_in_seconds + dbProduct.time_in_seconds;
            product.perishable = dbProduct.perishable ? dbProduct.perishable : product.perishable;
            product.upcs = product.upcs.concat(dbProduct.upcs);
            if (!_.isUndefined(dbProduct.calories) && !_.isNull(dbProduct.calories) && !_.isNull(product.calories)) product.calories = product.calories + parseInt(dbProduct.calories);
            else product.calories = null;
            if (!_.isUndefined(dbProduct.type)) {
                product.type = (product.type) ? product.type + ',' + dbProduct.type : dbProduct.type;
            }
            product.age_restricted = dbProduct.age_restricted ? dbProduct.age_restricted : product.age_restricted;
            product.tags = product.tags.concat(dbProduct.tags);
            product.minimum_on_hand_quantity = dbProduct.minimum_on_hand_quantity > product.minimum_on_hand_quantity ? dbProduct.minimum_on_hand_quantity : product.minimum_on_hand_quantity;
            product.limit_per_order = dbProduct.limit_per_order < product.limit_per_order ? dbProduct.limit_per_order : product.limit_per_order;
            if (!_.isNull(dbProduct.meta_tags)) product.meta_tags = product.meta_tags.concat(dbProduct.meta_tags);
            done();
        });
    }

    _readConfig(done) {
        console.time('ReadConfiguration');
        let self = this;
        common.configFetch.fetchConfigByFeature({ app: '7NOW', version: '1.0', country: 'US', feature: 'catalog', type: 'api' }, (err, result) => {
            console.log(result);
            self.config = result;
            console.log('Read Configuration Complete');
            console.timeEnd('ReadConfiguration');
            done();
        });
    }

    //read the S3 file from bucket and join the chunk
    _readFileFromS3(s3_object, done) {
        console.time('ReadFileFromS3');
        const self = this;
        const s3 = new AWS.S3();
        console.log('s3_object', s3_object);
        let objectKey = s3_object.object.key;
        objectKey = objectKey.replace(/\+/g, ' ');
        let params = {
            Bucket: s3_object.bucket.name,
            Key: objectKey
        };

        if (/_CA\.xlsx/.test(s3_object.object.key)) self.country = 'CA';
        let chunks = [];
        let file = s3.getObject(params).createReadStream();
        file.on('data', (data) => {
            chunks.push(data);
        }).on('end', () => {
            self.bufferXls = Buffer.concat(chunks);
            self.wb = xlsx.read(self.bufferXls);
            console.log(`[ProductComboUploadService > _readFileFromS3] file read from ${params.Key} completed`, console.timeEnd('ReadFileFromS3'));
            done(null);
        }).on('error', (e) => {
            console.error(e, console.timeEnd('ReadFileFromS3'));
            self.errorList.push('Error: error in s3bucket.');
            done(`[ProductComboUploadService > _readFileFromS3] error s3bucket ${JSON.stringify(e)}`);
        });
    }


    _loadCategoriesFromCollection(done) {
        console.time('ReadCategories');
        let self = this;
        console.log('[ProductComboUploadService > _readCategoriesFromCollection] reading category from collection');
        CategoryModel.find().exec(function (error, result) {
            if (error) return done(error);
            _.forEach(result, function (category) {
                self.categoriesMap.set(category.name, category);
            });
            console.log('Read Categories Complete');
            console.timeEnd('ReadCategories');
            done();
        });
    }

    _readProductsFromSheet(sheetName = 'Products', done) {
        let self = this;
        let productsSheet;
        self.wb.SheetNames.forEach((sheet) => { if (sheet === sheetName) productsSheet = self.wb.Sheets[sheet]; });
        if (!productsSheet) {
            return done(`[ ProductUploadService > _updateProducts] : Could not find ${sheetName} sheet in file`);
        }
        self.products = xlsx.utils.sheet_to_json(productsSheet);
        done();
    }

    _filterUpdateOnlyItems(done) {
        this.products = _.filter(this.products, (p) => {
            if (_.isString(p.update) && p.update.trim().toUpperCase() === 'X') {
                if (_.isString(p.category) && p.category.trim().length > 0) {
                    return true;
                } else {
                    console.log('Category cannot be empty! Filtering out', 'slin', p.slin, 'name', p.name, 'category', p.category);
                    return false;
                }
            } else {
                console.log('Not marked to update! Filtering out', 'slin', p.slin, 'name', p.name, 'update', p.update);
                return false;
            }
        });
        done();
    }

    _updateProductsToDB(done) {
        let self = this;
        console.time('ProductUpdates');
        let queue = async.queue(self._processSingleRecord.bind(self), 100);
        let deleteQueue = async.queue(self._deleteProducts.bind(self), 100);
        let atleastOneUpdate = false;
        let atleastOneDelete = false;
        self.products.forEach((product) => {
            console.log('Updatating to DB', product);
            if (product.delete) {
                atleastOneDelete = true;
                deleteQueue.push(product);
            } else if (product.update) {
                atleastOneUpdate = true;
                queue.push(product);
            }
        });
        async.series([
            (done) => {
                if (atleastOneDelete) {
                    deleteQueue.drain = function () { console.timeEnd('Productdeletes'); done(); };
                } else {
                    done();
                }
            },
            (done) => {
                if (atleastOneUpdate) {
                    queue.drain = function () { console.timeEnd('ProductUpdates'); done(); };
                } else {
                    console.log('No products marked as update!!!');
                    done();
                }
            }
        ], done);
    }

    _deleteProducts(inputData, done) {
        async.parallel([
            (done) => {
                console.log('Removing products', inputData.product_id);
                ProductComboModel.remove({ 'product_id': inputData.product_id }, (err, result) => {
                    console.log('Products remove result', result);
                    done();
                });
            },
            (done) => {
                console.log('Updating store products', inputData.product_id);
                StoreProductsModel.updateMany({ 'product_id': inputData.product_id }, { $set: { is_active: false } }, (err, result) => {
                    console.log('Store products update result', result);
                    done();
                });
            }
        ], done);

    }
    _processSingleRecord(inputData, done) {
        let self = this;
        let productId = inputData.product_id;
        let name = inputData.name;
        delete inputData.update;
        console.log('>>>>>>>>>>>>>>>> productId', productId);
        let query = ProductComboModel.find({ product_id: productId }).lean(true);
        // if (inputData.flavor_id) {
        //     query.where('flavor_id').equals(inputData.flavor_id.toString());
        // }
        query.exec(function (err, products) {
            if (err) {
                console.log('Error>>>>>>>>>>>>>>>>', err);
                self.failureList.push(productId + ' ' + name); return done();
            }
            if (!products || !products.length || products.length < 1) {
                self.addedProducts.push(productId + ' ' + name);
                var model = new ProductComboModel(inputData);
                model.save(function (err, data) {
                    if (err) {
                        console.log('InputData', inputData);
                        console.log('Error while saving>>>>>>>>>>>>>>>>', err); self.failureList.push(productId + ' ' + name);
                        return done();
                    }
                    self.logger.info('Inserted record for ' + productId + ' ' + name);
                    return done();
                });
            } else {
                let query = { product_id: productId };
                // if (inputData.flavor_id) query.flavor_id =inputData.flavor_id;
                ProductComboModel.findOneAndUpdate(query, inputData, { upsert: true, new: true }, function (error, newDoc) {
                    if (error) { self.errorList.push('Failed saving product', error); }
                    // console.log('SavedDoc', newDoc);
                    return done();
                });
            }
        });
    }

    _catalogUpdateSummary(s3_object, done) {
        let self = this;
        let bufferError = [], bufferSuccess = [], file_name = null, dir_path = null;

        s3_object.object.key.replace(/(.+)\/(.+)\.xlsx/, (match, $1, $2) => {
            dir_path = $1 + '/log/';
            file_name = $2;
        });

        if (self.failureList.length > 0) {
            bufferError.push('Update failure');
            _.forEach(self.failureList, (value) => { bufferError.push(value); });
        }
        if (self.notFound.length > 0) {
            bufferError.push('Products - NOT FOUND!');
            _.forEach(self.notFound, function (value) { bufferError.push(value); });
        }
        if (self.categoryNotFound.length > 0) {
            bufferError.push('Category - NOT FOUND!');
            _.forEach(self.categoryNotFound, function (value) { bufferError.push(value); });
        }

        if (self.countryMismatch.length > 0) {
            bufferError.push('Country - MISMATCH FOUND!');
            _.forEach(self.countryMismatch, function (value) { bufferError.push(value); });
        }
        if (self.requireFields.length > 0) {
            bufferError.push('REQUIRED - FIELD MISSING!');
            _.forEach(self.requireFields, function (value) { bufferError.push(value); });
        }
        if (self.addedProducts.length > 0) {
            bufferSuccess.push('New Product added');
            _.forEach(self.addedProducts, (product) => {
                bufferSuccess.push(product);
            });
        }
        if (self.updatedProducts.length > 0) {
            bufferSuccess.push('Updated Products');
            _.forEach(self.updatedProducts, (p) => {
                if (_.includes(self.addedProducts, `${p.product.slin} ${p.product.name}`) === false) {
                    bufferSuccess.push(`${p.product.id}, ${p.product.slin}, ${p.product.category}, ${p.product.name}`);
                }
            });
        }

        if (self.addedProducts.length === 0 && self.updatedProducts.length === 0) {
            bufferError.push('No products updated!');
        }

        let date = new Date();
        const s3 = new AWS.S3();
        async.parallel([
            (done) => {
                if (bufferError.length < 1) return done();
                let params = {
                    Bucket: s3_object.bucket.name,
                    Key: dir_path + file_name + '_alert_' + date.toISOString() + '.txt',
                    Body: bufferError.join('\n'),
                    ContentType: ' text/plain;charset=utf-8'
                };
                s3.putObject(params, (err, data) => {
                    if (err) {
                        console.log(`[ProductUploadService > _catalogUpdateSummary] error encountered for bufferError while writing file ${JSON.stringify(err)}`);
                    }
                    console.log(`[ProductUploadService > _catalogUpdateSummary] for bufferError file uploaded ${JSON.stringify(data)}`);
                    done();
                });
            },
            (done) => {
                if (bufferSuccess.length < 1) return done();
                let params = {
                    Bucket: s3_object.bucket.name,
                    Key: dir_path + file_name + '_success_' + date.toISOString() + '.txt',
                    Body: bufferSuccess.join('\n'),
                    ContentType: ' text/plain;charset=utf-8',
                    ServerSideEncryption: 'AES256',
                    StorageClass: 'REDUCED_REDUNDANCY'
                };
                s3.putObject(params, (err, data) => {
                    if (err) {
                        console.log(`['ProductComboUploadService > _catalogUpdateSummary'] error encountered for bufferSuccess while writing file ${JSON.stringify(err)}`);
                    }
                    console.log(`['ProductComboUploadService > _catalogUpdateSummary'] file uploaded for bufferSuccess ${JSON.stringify(data)}`);
                    done();
                });
            }
        ], done);
    }
}

module.exports = ProductComboUploadService;
