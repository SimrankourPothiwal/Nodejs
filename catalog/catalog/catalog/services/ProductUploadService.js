'use strict';
const async = require('async');
const mongoose = require('mongoose');
const _ = require('lodash');
const xlsx = require('xlsx');
const common = require('phoenix-common');

const AWS = require('aws-sdk');
const log = require('loglevel');
const request = require('request');
log.setLevel('debug');

//mongoose.set('debug', true);

const CategoryModel = require('./../models/categoryModel');
const CategoryRegionalModel = require('../models/categoryRegionalModel');
const ProductModel = require('./../models/productModel');
const CategoryService = require('./categoryService');
const ProductsUpdateLog = require('./../models/productsUpdateLogModel');
const ProductLocRulesModel = require('./../models/productLocationRulesModel');
const StoreProductsModel = require('../models/storeProducts');
const StoreDetailsModel = require('../models/storeDetails');
const GladsonDataModel = mongoose.model('GladsonData', new mongoose.Schema({ Upc: String }, { strict: false, collection: 'gladson_product_details' }));
const PersonalReco = require('./ProductPersonalization');
const CONST = require('../utilities/constants/constants_en_us');


const estimateSheetName = 'EstimatedTimeModel';
const productSheetName = 'Products';
const categorySheetName = 'Categories';
const nutritionSheetName = '7-11 Product Nutritionals';


const PRODUCT_TYPE_FOR_PREP_TIME = {
    HOT_FOOD: { key: 'Hot Food Orders', value: 'D36' },
    PROP_BEV: { key: 'Prop Bev Items', value: 'E36' },
    MERCH_ITEM: { key: 'Merch Items', value: 'F36' },
    VAULT: { key: 'Items from Vault', value: 'G36' },
    BAKED: { key: 'Baked Goods', value: 'H36' },
    GRILL: { key: 'Roller Grill', value: 'I36' }
};

class ProductUploadService {
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
        this.categoryService = new CategoryService(logger);
        this.equipments = [];
        this.successFile='';
        this.failureFile='';
      }

    uploadData(s3_object, callback) {

        const self = this;
        if (self.debug) mongoose.set('debug', true);
        const logger = self.logger;
        async.series([
            self._readConfig.bind(self),
            self._readFileFromS3.bind(self, s3_object),

            self._readCategoriesFromSheet.bind(self, categorySheetName),
            self._updateCategories.bind(self),
            self._loadCategoriesFromCollection.bind(self),

            self._readEstimatedTimeForProducts.bind(self, estimateSheetName),

            self._readProductsFromSheet.bind(self, productSheetName),
            self._filterUpdateOnlyItems.bind(self),
            self._flattenMultiCategoryProducts.bind(self),

            self._autoResolveProductIdUsingStoreData.bind(self),
            self._autoResolvePriceUsingStoreData.bind(self),
            self._updateProductsToDB.bind(self),
            self._updateEquipment.bind(self),
            self._catalogUpdateSummary.bind(self, s3_object),
            self._loadNutritionsData.bind(self, nutritionSheetName),
            self._updateCalories.bind(self),
            self._initiateUpdateStoreProducts.bind(self),
            
            // self._updateSpecials_v1.bind(self),
            // self._updateSpecials_v2.bind(self),
            // self._updateSpecials_v3.bind(self),
           // self._updateSpecials_v4.bind(self),
            //update store

            self._syncupMultiCategoryMapping.bind(self),
            self._sendEmail.bind(self),
            self._triggerSearchReIndex.bind(self)
            

        ], function (err) {
            if (err) {
                logger.error(err);
                return callback(err);
            }
            return callback(null, { status: 'success' });
        });
    }
    _triggerSearchReIndex(done){
        let options = {
            url: process.env.SEARCH_REINDEX_URL,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            }
        };
        console.log('triggerSearchReIndex---options:',options);
        //iife
        //async retray
        (()=>{
            console.log('Triggering Search Re Index!!!!!!!!!!!!!!');
            request(options, function (error, response) {
            });
            setTimeout(()=>{
                done(null,true);
            }, 3000);

        })();

    }
    _getEqupimentsListFromExcel(products) {
        let equipments = [], finalEquipments = [];
        if (!products && products.length < 0) {
            return null;
        }
        let uniqueEquipments = _.uniq(_.map(products, (product) => {
            if(product.equipment && product.equipment.trim() !== 'N/A')
                return product.equipment.trim();
            else return null;
        }));

        equipments = _.filter(uniqueEquipments, equipmentName => !(equipmentName === null || equipmentName === 'N/A' || equipmentName === '' ));
        if (equipments.length < 1) { return null; }
        equipments.forEach((equipment) => {
            let productsByEquipment = _.filter(products, product => product.equipment === equipment);
            let types = _.filter(_.uniq(_.map(productsByEquipment, (p) => {if(p.type) return p.type.trim();})), p => !(p === null || p === 'N/A' || p === '' ));
            finalEquipments.push({ name: equipment, types: _.map(types, (type) => { return { 'name': type }; } )});
        });
        return finalEquipments;
    }

    _updateEquipment(done) {
        let self = this;
        let equipmentData = self._getEqupimentsListFromExcel(self.products);
        if(equipmentData && equipmentData.length > 0 && process.env.EQUIPMENT_ENABLED==='ON') {
            common.invokeLambdaAsync(process.env.UPDATE_EQUIPMENT_TYPES, equipmentData, () => { done(); });
        } else {
            console.error('ERROR! No equipments found!');
            done();
        }
    }

    _initiateUpdateStoreProducts(done) {
        let self = this;
        async.series([
            (done) => {
                let bulkUpdate = [];
                self.products.forEach((product) => {
                    bulkUpdate.push({
                        updateOne: {
                            filter: { product_id: product.product_id },
                            update: {
                                product_id: product.product_id,
                                stores_status: 'pending',
                                specials_status: 'pending'
                            },
                            upsert: true
                        }
                    });
                    if(product.id!==product.product_id){
                        bulkUpdate.push({
                            updateOne: {
                                filter: { product_id: product.id },
                                update: {
                                    product_id: product.id,
                                    stores_status: 'pending',
                                    specials_status: 'pending'
                                },
                                upsert: true
                            }
                        });
                    }
                });
                ProductsUpdateLog.bulkWrite(bulkUpdate, done);
            },
            (done) => {
                
                let numInstances = process.env.CATALOG_STATE_MACHINE_INSTANCES?parseInt(process.env.CATALOG_STATE_MACHINE_INSTANCES):20
               async.forEach(_.range(numInstances),(i, next)=>{
                new AWS.StepFunctions().startExecution({ stateMachineArn: process.env.CATALOG_STATE_MACHINE }, next);
               }, done);
                
                
            }
        ], () => {
            done();
        });
    }

    updateSpecials(req, callback) {
        const self = this;
        if (self.debug) mongoose.set('debug', true);
        async.series([
            (done) => {
                if (self.products) return done();
                ProductModel.find({}).lean(true).exec((err, result) => {//Update specials needs entire products
                    self.products = result; return done();
                });
            },
            (done) => {
                if (!_.isArray(self.products) || self.products.length < 1) return done();
                async.series([
                    self._loadCategoriesFromCollection.bind(self),
                    self._updateSpecials_v1.bind(self),
                    self._updateSpecials_v2.bind(self),
                    self._updateSpecials_v3.bind(self),
                    //self._updateSpecials_v4.bind(self),
                ], done);
            }
        ], callback);
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
            console.log(`[ProductUploadService > _readFileFromS3] file read from ${params.Key} completed`, console.timeEnd('ReadFileFromS3'));
            done(null);
        }).on('error', (e) => {
            console.error(e, console.timeEnd('ReadFileFromS3'));
            self.errorList.push('Error: error in s3bucket.');
            done(`[ProductUploadService > _readFileFromS3] error s3bucket ${JSON.stringify(e)}`);
        });
    }

    _readCategoriesFromSheet(sheetName = 'Categories', done) {
        let categorySheet, self = this;
        self.wb.SheetNames.forEach((sheet) => { if (sheet === sheetName) categorySheet = self.wb.Sheets[sheet]; });
        if (!categorySheet) {
            return done(`[ ProductUploadService > _readCategoriesFromSheet] : Could not find ${sheetName} sheet in file`);
        }
        self.categories = xlsx.utils.sheet_to_json(categorySheet);
        done();
    }

    _updateCategories(done) {
        let self = this;
        console.time('CategoryUpdates');
        async.each(self.categories, function (category, done) {
            if (!category.id) { console.log('Category ID missing!', category); return done(); }
            if (category.is_active === 'TRUE') category.is_active = true; else category.is_active = false;
            if (category.verify_age === 'TRUE') {
                category.verify_age = true;
                if (category.min_purchase_age) {
                    let min_purchase_age = {};
                    category.min_purchase_age.split(',').forEach((v) => {
                        if (v.indexOf('=') !== -1) {
                            let values = v.split('=');
                            try {
                                min_purchase_age[values[0]] = parseInt(values[1]);
                            } catch (e) { console.log(e); }
                        }
                    });
                    category.min_purchase_age = min_purchase_age;
                }
            }
            self._updateMetaTags(category, category);
            if (category.update && category.update.trim().toUpperCase() === 'X') {
                if (category.delete && category.delete.trim().toUpperCase() === 'X') {
                    console.log('Deleting category', category.id, category.name);
                    self._deleteCategories(category, done);
                } else {
                    console.log('Updating category', category.id, category.name, category.is_active);
                    async.series([
                        (done) => {
                            delete category.update; delete category.delete;
                            let filterQuery = (category.is_active) ? { $set: category, $setOnInsert: { is_new: true } } : category;
                            CategoryModel.findOneAndUpdate({ id: category.id }, filterQuery, { upsert: true }, done);
                        },
                        (done) => {
                            if (_.isArray(category.meta_tags) && category.meta_tags.length > 0) {
                                async.each(category.meta_tags, (metaTag, done) => {
                                    self.categoryService.refreshRegionalCategories({meta_tags:metaTag}, done);
                                }, done);
                            } else {
                                done();
                            }
                        }
                    ], done);
                }
            } else {
                //console.log('Not marked for Update! Skipping', category.id, category.name);
            }
        }, () => {
            CategoryModel.updateMany({ is_new: true }, { $set: { is_active: false } }, () => {
                console.timeEnd('CategoryUpdates');
                done();
            });
        });
    }

    _deleteCategories(category, done) {
        let self = this;
        console.time('Deleting inactive category');
        self.logger.info('Deleting inactive category >>>>>>>>>>>>>', category.id);
        async.series([
            (done) => {
                StoreDetailsModel.find({}).lean(true).exec((err, result) => {
                    if (err) { self.logger.info(err); return done(); }
                    async.forEachLimit(result, 10, (store, done) => {
                        StoreProductsModel.deleteMany({ store_id: store.store_id, category_id: category.id }, done);
                    }, done);
                });
            },
            (done) => { CategoryRegionalModel.deleteMany({ id: category.id }, done); },
            (done) => { CategoryModel.deleteMany({ id: category.id }, done); },
            (done) => {
                self.logger.info('Deleting inactive category completed >>>>>>>>>>>>>', category.id);
                console.timeEnd('Deleting inactive category');
                done();
            }
        ], done);

    }
    _loadCategoriesFromCollection(done) {
        console.time('ReadCategories');
        let self = this;
        console.log('[ProductUploadService > _readCategoriesFromCollection] reading category from collection');
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

    //read the bufferXls and read estimate file
    _readEstimatedTimeForProducts(prepTimeSheet = 'EstimatedTimeModel', done) {
        console.time('ReadingEstimatedTime');
        let self = this;
        let estimatedTimeModelSheet = null;
        self.wb.SheetNames.forEach((sheet) => { if (sheet === prepTimeSheet) estimatedTimeModelSheet = self.wb.Sheets[sheet]; });
        if (!estimatedTimeModelSheet) {
            self.errorList.push(`Error: Could not find ${prepTimeSheet} sheet in uploaded file`);
            return done(`[ ProductUploadService > _readEstimatedTimeForProducts] : Could not find ${prepTimeSheet} sheet in uploaded file`);
        }
        _.forEach(PRODUCT_TYPE_FOR_PREP_TIME, function (mapping) {
            let prepTime = estimatedTimeModelSheet[mapping.value].v;
            prepTime = Math.ceil(prepTime + (5 - (prepTime % 5)));
            self.estimatedPrepTime.set(mapping.key, prepTime);
        });
        console.timeEnd('ReadingEstimatedTime');
        done();
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
                //console.log('Not marked to update! Filtering out', 'slin', p.slin, 'name', p.name, 'update', p.update);
                return false;
            }
        });
        done();
    }

    _flattenMultiCategoryProducts(done) {
        let flatProducts = [];
        _.forEach(this.products, (item) => {
            let tags = this._getTags(item);
            if (tags) item.tags = tags;
            if (item.category.indexOf(',') !== -1) {
                console.log('Multi-Category Product! Flattening', item.slin, item.name, item.category, item.tags);
                let categoryNames = this._convertToArray(item.category);

                
                _.forEach(categoryNames, (category) => {
                    if (_.isString(category) && category.trim().length > 0) {
                        let itemClone = _.cloneDeep(item);
                        if (_.isArray(item.tags) && _.isArray(categoryNames) && item.tags.length === categoryNames.length) {
                            itemClone.tags = [item.tags[_.indexOf(categoryNames, category)]];
                        } else {
                            console.log('WARNING! Uneven number of categories and tags!',
                                'slin-', item.slin, ' | name-', item.name, ' | category-', item.category, ' | tags-', item.tags);
                        }
                        itemClone.category = category;
                        flatProducts.push(itemClone);
                    }
                });
            } else {
                flatProducts.push(item);
            }
        });
        this.flatProducts = flatProducts;
        done();
    }

    _convertToArray(csv) {
        let newArray = csv.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);//Commas within double quotes ignored
        if (newArray && newArray.length > 0) {
            _.forEach(newArray, (value, index) => {
                newArray[index] = value.trim().replace(/"/g, '');
            });
        } else {
            newArray.push(csv.trim().replace(/"/g, ''));
        }
        return newArray;
    }

    _getTags(item) {
        let newTags = item.tags;
        if (newTags && !_.isArray(newTags) && _.isString(newTags)) {
            newTags = newTags.trim();
            if (newTags.indexOf('"') !== -1) {
                item.tags = this._convertToArray(newTags);
            } else {
                let tagsArray = _.split(newTags, ',');
                let tags = [];
                _.forEach(tagsArray, (tag) => { tags.push(tag.trim()); });
                item.tags = tags;
            }
        }
        return item.tags;
    }

    _getCategories(item) {
        if (item.category && item.category.indexOf(',') !== -1) {

            return _.split(item.category, ',');
        } else {
            return item.category;
        }
    }

    _autoResolveProductIdUsingStoreData(done) {
        let self = this;
        async.eachLimit(self.products, 30, (product, done) => {
            product.slin.trim();
            if (!product.id && !product.flavor_id) {//Flavor product auto-resolve not supported
                StoreProductsModel.collection.distinct('product_id', { slin: product.slin }, (err, productIds) => {
                    if (productIds && productIds.length && productIds.length === 1) {
                        product.id = productIds[0];
                        StoreProductsModel.findOne({ product_id: product.id }).lean(true).exec((err, resolvedStoreProduct) => {
                            if (err) {
                                console.log(err);
                            }
                            if (resolvedStoreProduct && resolvedStoreProduct.product_id) {
                                if (_.isString(resolvedStoreProduct.suiid)) product.suiid = resolvedStoreProduct.suiid;
                                if (_.isString(resolvedStoreProduct.size_index)) product.size_index = resolvedStoreProduct.size_index;
                                if (_.isString(resolvedStoreProduct.size_group)) product.size_group = resolvedStoreProduct.size_group;
                                if (_.isString(resolvedStoreProduct.ipq)) product.ipq = resolvedStoreProduct.ipq;
                                if (product.suiid && product.size_index && product.size_group && product.ipq) {
                                    product.id = resolvedStoreProduct.product_id;
                                } else {
                                    addToFailedList(product);
                                }
                            } else {
                                console.log('Error! No record found', product.slin);
                                addToFailedList(product);
                            }
                            done();
                        });
                    } else if (productIds && productIds.length > 1) {
                        console.log('Error! More than one product_id found', productIds);
                        addToFailedList(product);
                        done();
                    } else {
                        console.log('Error! No product_id found', productIds);
                        addToFailedList(product);
                        done();
                    }
                });
            } else {
                if (product.flavor_id && !product.id) {
                    console.log('Error! Flavor product! Please resolve product_id manually!', product.slin, product.name, product.flavor_id);
                    self.failureList.push(product.slin + ' ' + product.name + '(Auto-resolve not supported for flavor products)');
                }
                done();
            }
        }, done);

        function addToFailedList(product) {
            product.update = null;
            product.is_active = false;
            self.failureList.push(product.slin + ' ' + product.name + '(Unable to auto-resolve product id)');
            console.log('Error! Failed resolving product_id', product.slin, product.name);
        }
    }

    _autoResolvePriceUsingStoreData(done) {
        let self = this;
        console.time('PriceAutoResolve');
        let priceAutoResolved = [];
        async.eachLimit(self.products, 10, (product, done) => {
            if (product.original_price) return done();
            priceAutoResolved.push(product);
            StoreProductsModel.collection.distinct('price', { slin: product.slin }, (err, priceList) => {
                if (_.isArray(priceList) && priceList.length > 0) {
                    let originalPrice = _.min(priceList);
                    if (originalPrice > 50) {//I don't think we sell anything less than 50 cents
                        product.original_price = originalPrice;
                    }
                }
                done();
            });
        }, () => {
            console.log('Price AutoResolve');
            priceAutoResolved.forEach((product) => {
                // console.log('>>>', product.slin, product.name, product.original_price);
            });
            console.timeEnd('PriceAutoResolve');
            done();
        });
    }

    _updateProductsToDB(done) {

        let self = this;
        console.time('ProductUpdates');
        let queue = async.queue(self._processSingleRecord.bind(self), 100);
        let deleteQueue = async.queue(self._deleteProducts.bind(self), 100);
        let atleastOneUpdate = false;
        let atleastOneDelete = false;
        self.products.forEach((product) => {
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
                console.log('Removing products', inputData.slin);
                ProductModel.remove({ 'slin': inputData.slin }, (err, result) => {
                    console.log('Products remove result', result);
                    done();
                });
            },
            (done) => {
                console.log('Updating store products', inputData.slin);
                StoreProductsModel.updateMany({ 'slin': inputData.slin }, { $set: { is_active: false } }, (err, result) => {
                    console.log('Store products update result', result);
                    done();
                });
            }
        ], done);

    }

    _processSingleRecord(inputData, done) {

        let self = this;
        let slin = inputData.slin;
        let name = inputData.name;
        let query = ProductModel.find({ slin: slin }).lean(true);
        if (inputData.flavor_id) {
            query.where('flavor_id').equals(inputData.flavor_id.toString());
        }
        query.exec(function (err, products) {
            if (err) {
                self.failureList.push(slin + ' ' + name); return done();
            }
            if (!products || !products.length || products.length < 1) {
                self.addedProducts.push(slin + ' ' + name);
                self._processProduct.call(self, inputData, {}, done);
            } else {
                async.eachSeries(products, function (dbProduct, done) {
                    self._processProduct.call(self, inputData, dbProduct, done);
                }, done);
            }
        });
    }

    _processProduct(productInput, dbProduct, done) {

        let self = this;
        let originalDBProduct = _.cloneDeep(dbProduct);
        dbProduct.id = productInput.id;
        if (dbProduct.id === undefined) {
            self.requireFields.push('id for ' + productInput.name.trim() + ' in xls cant be blank');
            return done(null, null);
        }
        if (productInput.flavor_id) {
            dbProduct.flavor_id = productInput.flavor_id.toString();
            dbProduct.product_id = productInput.id + '-' + dbProduct.flavor_id;
        } else {
            dbProduct.flavor_id = null;
            dbProduct.product_id = productInput.id;
        }
        productInput.product_id = dbProduct.product_id;

        //check for  the country
        if (dbProduct.country === undefined) {
            dbProduct.country = self.country;
        } else if (dbProduct.country !== self.country) {
            self.countryMismatch.push(productInput.slin + ' ' + productInput.name.trim());
            return done(null, null);
        } else {
            dbProduct.country = self.country;
        }
        dbProduct.slin = productInput.slin;
        if (productInput.name) dbProduct.name = productInput.name.trim();
        if (productInput.suiid) dbProduct.suiid = productInput.suiid;
        if (_.isString(productInput.size_index)) dbProduct.size_index = productInput.size_index;
        if (_.isString(productInput.size_group)) dbProduct.size_group = productInput.size_group;
        if (_.isString(productInput.ipq)) dbProduct.ipq = productInput.ipq;

        if (productInput.upc) dbProduct.upc = productInput.upc;
        // if (productInput.department_id) dbProduct.department_id = productInput.department_id;
      
        // if (productInput.popularity) popularites = _.split(productInput.popularity, ",");
        // if (productInput.popularity) dbProduct.popularity = Number.parseInt(productInput.popularity);

        if (_.isString(productInput.specials_slot_of_day)) dbProduct.specials_slot_of_day = productInput.specials_slot_of_day.trim();
        if (_.isString(productInput.specials_id)) dbProduct.specials_id = productInput.specials_id.trim();
        if (_.isString(productInput.specials_title)) dbProduct.specials_title = productInput.specials_title.trim();
        if (_.isString(productInput.category_specials) && productInput.category_specials.toUpperCase() === 'X') dbProduct.category_specials = true; else dbProduct.category_specials = false;

        if (_.isString(productInput.price_group)) dbProduct.price_group = productInput.price_group.trim();
        //alcohol calculation
        if (_.has(productInput, 'volume_beer_wine') && !_.isNull(dbProduct.volume_beer_wine)) {

            dbProduct.volume_beer_wine = productInput.volume_beer_wine;
            if (_.isString(productInput.ipq)) dbProduct.total_volume = productInput.volume_beer_wine;
        }
        if (productInput.unit_measure) dbProduct.unit_measure = productInput.unit_measure;
        if (productInput.abv_liquor) dbProduct.abv_liquor = productInput.abv_liquor;
        if (_.isString(productInput.website_tile) && productInput.website_tile.trim() !== '') dbProduct.website_tile = productInput.website_tile.trim();

        if (productInput.long_desc) dbProduct.long_desc = productInput.long_desc.trim();
        if (productInput.limit_per_order) dbProduct.limit_per_order = Number.parseInt(productInput.limit_per_order);
        // if (productInput.nutrition_source) dbProduct.nutrition_source = productInput.nutrition_source;
        if (productInput.multiplier) {
            if (productInput.promo_price) dbProduct.promo_price = (Number.parseInt(productInput.promo_price) * productInput.multiplier); else dbProduct.promo_price = null;
            if (productInput.original_price) dbProduct.original_price = (productInput.original_price * productInput.multiplier); else dbProduct.original_price = null;
        } else {
            if (productInput.promo_price) dbProduct.promo_price = Number.parseInt(productInput.promo_price); else dbProduct.promo_price = null;
            if (productInput.original_price) dbProduct.original_price = Number.parseInt(productInput.original_price); else dbProduct.original_price = null;
        }
        dbProduct.age_restricted = (productInput.age_restricted) ? true : false;
        if (productInput.multiplier) dbProduct.multiplier = Number.parseInt(productInput.multiplier);
        if (productInput.equipment) dbProduct.equipment = productInput.equipment;
        if (productInput.type_for_time_estimate && self.estimatedPrepTime.get(productInput.type_for_time_estimate)) {
            dbProduct.time_in_seconds = self.estimatedPrepTime.get(productInput.type_for_time_estimate);
        }
        if (productInput.perishable) dbProduct.perishable = true; else dbProduct.perishable = false;

        if (productInput.type) dbProduct.type = productInput.type;
        if (productInput.handling) dbProduct.handling = productInput.handling;
        dbProduct.is_active = (productInput.is_active) ? true : false;
        dbProduct.ignore_quantity = (productInput.ignore_quantity) ? true : false;
        // if (!dbProduct.ignore_quantity) {
        //     dbProduct.apply_carry_status = true; //by default, apply carry status
        // } else {//Conditionally apply carry status for ignore quantity products
        //     dbProduct.apply_carry_status = (productInput.apply_carry_status) ? true : false;
        // }
        dbProduct.apply_carry_status = (productInput.apply_carry_status && productInput.apply_carry_status==='N')?false:true;
        if (productInput.price_cap && Number.parseInt(productInput.price_cap) > 0) {
            dbProduct.price_cap = Number.parseInt(productInput.price_cap);
        }

        if (productInput.dsu_slin) dbProduct.dsu_slin = productInput.dsu_slin;
        dbProduct.order_type = ['delivery'];

        if (_.isString(productInput.minimum_on_hand_quantity))
            dbProduct.minimum_on_hand_quantity = Number.parseInt(productInput.minimum_on_hand_quantity);
        if (productInput.pickup) {
            if (_.isArray(dbProduct.order_type)) {
                if (!_.includes(dbProduct.order_type, 'pickup')) {
                    dbProduct.order_type.push('pickup');
                }
            } else {
                dbProduct.order_type = ['pickup'];
            }
        } else {
            _.remove(dbProduct.order_type, (v) => { return v === 'pickup'; });
        }
        self._updateTags.call(self, productInput, dbProduct);
        self._updateMetaTags.call(self, productInput, dbProduct);
        self._updateMatchingIds.call(self, productInput, dbProduct);
        let delta = self._showDelta.call(self, dbProduct, originalDBProduct);

        if (delta.length > 0) {
                 self.updatedProducts.push({ product: dbProduct, delta: delta });
                
            }
   
        dbProduct.last_updated = new Date();
        let updateCategoryAndSave = async.seq(self._updateProductCategory.bind(self), self._saveProductToDB.bind(self));
        updateCategoryAndSave(productInput, dbProduct, done);
    }

    
   
    _updateProductCategory(productInput, dbProduct, done) {

        let self = this;
        let categoryName = productInput.category;
        if (categoryName) {
            categoryName = categoryName.trim();
            let categoryNames = self._csvProcess('category', productInput);
            _.forEach(categoryNames, (value, index) => { categoryNames[index] = value.trim(); });//Trim trailing space
            if (categoryNames && categoryNames.length > 1) {//Multi category mapping handling
                console.log('MultiCategoryResolve', dbProduct.slin, dbProduct.name, productInput.category, categoryNames);
                async.eachSeries(categoryNames, function (category, done) {

                    let productInputClone = _.cloneDeep(productInput);
                    productInputClone.category = category;
                    let index=_.indexOf(categoryNames, category);

                    let popularites = []// This is to handle diffrent popularities for multi category products 
                    if (productInputClone.popularity) popularites = _.split(productInputClone.popularity, ",");
                    if(popularites.length>0){
                        productInputClone.popularity= (index<popularites.length)?popularites[index]:popularites[0];
                    }
                     

                    if (_.isArray(productInputClone.tags) && productInputClone.tags.length === categoryNames.length) {
                        productInputClone.tags = [productInputClone.tags[_.indexOf(categoryNames, category)]];
                        dbProduct.tags = productInputClone.tags;
                    }
                    let query = { id: dbProduct.id, category: category };
                    if (dbProduct.flavor_id) query.flavor_id = dbProduct.flavor_id;
                    ProductModel.findOne(query).lean(true).exec(function (error, result) {

                        if (result) {
                            result.tags = productInputClone.tags;
                            self._processProduct.call(self, productInputClone, result, done);
                        } else {

                            delete dbProduct._id; delete dbProduct.__v;
                            dbProduct.category = category;
                            let categoryId = self.categoriesMap.get(category);
                            if (!categoryId) {
                                self.errorList.push('Unable to find category', category, dbProduct);
                                self.logger.info('Unable to find category', category, dbProduct);
                                return done();
                            }
                            dbProduct.category_id = self.categoriesMap.get(category).id;
                            if (self.mode === 'update') {
                                ProductModel.findOneAndUpdate(
                                    query,
                                    dbProduct, {
                                        upsert: true,
                                        new: true
                                    }, function (error, newProduct) {
                                        if (error) return done(error);
                                        self._processProduct.call(self, productInputClone, newProduct, done);
                                    });
                            } else {
                                self._processProduct.call(self, productInputClone, dbProduct, done);
                            }
                        }
                    });
                }, function (error) {
                    done(error, null);
                });
            } else {
                dbProduct.category = categoryName;
                let popularites = []// This is to handle diffrent popularities for multi category products 
                if (productInput.popularity) popularites = _.split(productInput.popularity, ",");
                if(popularites.length>0){
                    dbProduct.popularity= Number.parseInt(popularites[0]);
                }
                let category = self.categoriesMap.get(categoryName);
                if (!category) {
                    console.log('Error! Category Not Found, Product not saved!', dbProduct.name, categoryName, productInput);
                    self.errorList.push('Error! Category Not Found, Product not saved! Category Name : ', categoryName);
                    return done(null, null);
                }
                if (!category.id) {
                    console.log('Category ID cannot be null', category);
                    self.errorList.push('Category ID cannot be null', category);
                }
                // console.log('Single Category Resolve! Assigning category', dbProduct.slin, dbProduct.name, dbProduct.category, category.id);
                dbProduct.category_id = category.id;
                done(null, dbProduct);
            }
        } else {
            done();
        }
    }

    _saveProductToDB(dbProduct, done) {
        let self = this;
        if (self.mode === 'update' && dbProduct) {
            let query = { product_id: dbProduct.product_id, category_id: dbProduct.category_id };
            if (dbProduct.flavor_id) query.flavor_id = dbProduct.flavor_id;
            ProductModel.findOneAndUpdate(query, dbProduct, { upsert: true, new: true }, function (error, newDoc) {
                if (error) { self.errorList.push('Failed saving product', error); }
                // console.log('SavedDoc', newDoc);
                return done();
            });
        } else {
            return done();
        }
    }

    _updateTags(productInput, dbProduct) {
        this._readTags('tags', productInput, dbProduct);
        if (productInput.category === 'Beer' && !_.includes(dbProduct.tags, 'Beer')) {
            dbProduct.tags.push('Beer');
        }
    }

    _updateMetaTags(productInput, dbProduct) {
        this._readTags('meta_tags', productInput, dbProduct);
    }

    _readTags(fieldName, productInput, dbProduct) {
        let newTags = productInput[fieldName];
        if (newTags && !_.isArray(newTags) && _.isString(newTags)) {
            newTags = newTags.trim();
            if (newTags.indexOf('"') !== -1) {
                let newTagsArray = newTags.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);//Commas within double quotes ignored
                if (newTagsArray && newTagsArray.length > 0) {
                    _.forEach(newTagsArray, (value, index) => {
                        newTagsArray[index] = value.trim().replace(/"/g, '');
                    });
                } else {
                    newTagsArray.push(newTags.trim().replace(/"/g, ''));
                }
                dbProduct[fieldName] = newTagsArray;
                productInput[fieldName] = newTagsArray;
                // console.log(`Updating ${fieldName} for ${productInput.name} with ${newTagsArray}`);
            } else {
                let tagsArray = _.split(newTags, ',');
                let tags = [];
                _.forEach(tagsArray, (tag) => { tags.push(tag.trim()); });
                dbProduct[fieldName] = tags;
                productInput[fieldName] = tags;
                // console.log(`Updating ${fieldName} for ${productInput.name} with ${tags}`);
            }
        } else {
            dbProduct[fieldName] = productInput[fieldName];
            // console.log('Error! Invalid tag', newTags, ' | ', productInput.name);
        }
    }

    _csvProcess(fieldName, productInput) {
        let newTags = productInput[fieldName];
        if (newTags && !_.isArray(newTags) && _.isString(newTags)) {
            newTags = newTags.trim();
            if (newTags.indexOf('"') !== -1) {
                let newTagsArray = newTags.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);//Commas within double quotes ignored
                if (newTagsArray && newTagsArray.length > 0) {
                    _.forEach(newTagsArray, (value, index) => {
                        newTagsArray[index] = value.trim().replace(/"/g, '');
                    });
                } else {
                    newTagsArray.push(newTags.trim().replace(/"/g, ''));
                }
                // console.log('csv result 1', newTagsArray);
                return newTagsArray;
            } else {
                let tagsArray = _.split(newTags, ',');
                let tags = [];
                _.forEach(tagsArray, (tag) => { tags.push(tag.trim()); });
                // console.log('csv result 2', tags);
                return tags;
            }
        } else {
            if (productInput[fieldName]) {
                // console.log('csv result 3', [productInput[fieldName]]);
                return [productInput[fieldName]];
            } else {
                // console.log('csv result 4', []);
                return [];
            }
        }
    }

    _updateMatchingIds(productInput, dbProduct) {

        if (_.isArray(dbProduct.matching_ids)) {
            if (!_.includes(dbProduct.matching_ids, productInput.product_id)) {
                dbProduct.matching_ids.push(productInput.product_id);
            }    
        } else {
            dbProduct.matching_ids = [productInput.product_id];
        }
        if (!_.includes(dbProduct.matching_ids, productInput.id)) {
            dbProduct.matching_ids.push(productInput.id);
        } 
        if (_.isArray(dbProduct.matching_slins)) {
            if (!_.includes(dbProduct.matching_slins, productInput.slin)) {
                dbProduct.matching_slins.push(productInput.slin);
            }
        } else {
            dbProduct.matching_slins = [productInput.slin];
        }
    }

    _syncupMultiCategoryMapping(done) {
        let productGroups = _.groupBy(this.flatProducts, 'product_id');
        async.each(Object.keys(productGroups), (productId, done) => {
            if (!productId) return done();
            let srcCategories = _.uniq(_.map(productGroups[productId], p => p.category.trim()));
            ProductModel.collection.distinct('category', { product_id: productId }, (err, dbcats) => {
                let catDiff = _.difference(dbcats, srcCategories);
                console.log('INFO! CatDiff!', catDiff, 'product_id', productId, 'Src Cats', srcCategories, 'DB Cats', dbcats);
                if (catDiff.length > 0) {
                    console.log('Removing duplicate records');
                    async.each(catDiff, (cat, done) => {
                        let query = { product_id: productId, category: cat };
                        async.parallel([
                            (done) => {
                                //console.log('Removing products', query);
                                ProductModel.remove(query, (err, result) => {
                                   // console.log('Products remove result', result);
                                    done();
                                });
                            },
                            (done) => {
                                console.log('Removing store products', query);
                                StoreProductsModel.remove(query, (err, result) => {
                                    console.log('Store products remove result', result);
                                    done();
                                });
                            }
                        ], done);
                    }, done);
                } else if (srcCategories.length !== dbcats.length) {
                    console.log('product_id', productId, 'Src Cats', srcCategories, 'DB Cats', dbcats);
                    done();
                } else {
                    done();
                }
            });
        }, done);
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
                        bufferSuccess.push(`${p.product.id}, ${p.product.slin}, ${p.product.category}, ${p.product.name}, ${p.delta}`);
                }
            });
        }

        if (self.addedProducts.length === 0 && self.updatedProducts.length === 0) {
            bufferError.push('No products updated!');
        }

        let date = new Date();
        const s3 = new AWS.S3();
        var specialChars = '!@#$^&%*()+=`~[]\/{}|:<>?"\', ';
        async.parallel([
            (done) => {
                if (bufferError.length < 1) return done();
                self.failureFile = file_name + '_alert_' +date.toISOString() + '.txt';
              
            for (var i = 0; i < specialChars.length; i++) {
                self.failureFile = self.failureFile.replace(new RegExp('\\' + specialChars[i], 'gi'), '_');
            }
            self.failureFile = dir_path + self.failureFile
                let params = {
                    Bucket: s3_object.bucket.name,
                    Key: self.failureFile,
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
                self.successFile=file_name + '_success_' + date.getTime() + '.txt';
                
         
            for (var i = 0; i < specialChars.length; i++) {
                self.successFile= self.successFile.replace(new RegExp('\\' + specialChars[i], 'gi'), '_');
            }
            self.successFile=dir_path +self.successFile;
                let params = {
                    Bucket: s3_object.bucket.name,
                    Key: self.successFile,
                    Body: bufferSuccess.join('\n'),
                    ContentType: ' text/plain;charset=utf-8',
                    ServerSideEncryption: 'AES256',
                    StorageClass: 'REDUCED_REDUNDANCY'
                };
                s3.putObject(params, (err, data) => {
                    if (err) {
                        console.log(`['ProductUploadService > _catalogUpdateSummary'] error encountered for bufferSuccess while writing file ${JSON.stringify(err)}`);
                    }
                    console.log(`['ProductUploadService > _catalogUpdateSummary'] file uploaded for bufferSuccess ${JSON.stringify(data)}`);
                    done();
                });
            }
        ], done);
    }

    _showDelta(object, base) {
  
        function changes(newObj, oldObj) {
            return _.transform(newObj, function (result, value, key) {
                if (!_.isUndefined(value) && value!=oldObj[key]) {
                    (_.isObject(value) && _.isObject(oldObj[key])) ? changes(value, oldObj[key]) : result.push(key+"="+value);
                }
                
            }, []);
        }
        return changes(object, base);
    }

     

    _loadNutritionsData(nutritionSheetName, done) {
        let self = this;
        let nutritionSheet;
        self.wb.SheetNames.forEach((sheet) => { if (sheet === nutritionSheetName) nutritionSheet = self.wb.Sheets[sheet]; });
        if (!nutritionSheet) { console.log(`\nERROR: Could not find ${nutritionSheetName} sheet in`, filePath); done() }
        let nutritions = xlsx.utils.sheet_to_json(nutritionSheet);
        console.log('Nutritional Data Count', nutritions.length);
        let notFoundInCatalog = [], products = [], nutritionsMap = {}, productsMap = {};
        async.eachLimit(nutritions, 10, (n, done) => {
            if (n.name && n.update) {
                n.name = n.name.trim();
                nutritionsMap[n.name+' '+n.slin] = n;
                ProductModel.find({ name: n.name, slin: n.slin }).lean(true).exec((e, r) => {
                    if (e) { console.log(e); done(); }
                    if (r && r.length > 0) {
                        let product = r[0];
                            if (product.upc) {
                                products.push(product);
                                console.log(product.upc, product.name);
                                done();
                            } else {
                                StoreProductsModel.distinct('upcs').where({ slin: product.slin }).lean(true).exec((err, result) => {
                                    if (result && result.length > 0) {
                                        let upc = result[0];
                                        product.upc = upc;
                                        products.push(product);
                                        console.log(product.upc, product.name, ' (newly resolved UPC)');
                                        ProductModel.collection.update({ slin: product.slin }, { $set: { upc: upc } }, { multi: true }, done);
                                    } else {
                                        console.log('Could not find UPC', product.slin, product.name);
                                        done();
                                    }
                                });
                            }
                    } else {
                        notFoundInCatalog.push(n.name);
                        done();
                    }
                });
            } else {
                done();
            }
        }, (e) => {
            if (e) { console.log(e); done(); }
            if (notFoundInCatalog.length > 0) {
                console.log('Not Found in Catalog');
                notFoundInCatalog.forEach((p) => { console.log(p); });
            }
            let alreadyFound = [], noConflictProducts = [];
            async.eachLimit(products, 10, (p, done) => {
                GladsonDataModel.find({ Upc: p.upc, Source: 'Internal' }).lean(true).exec((e, r) => {
                    if (e) { console.log(e); done(); }
                    if (r && r.length > 0) {
                        alreadyFound.push(p);
                        productsMap[p.name+' '+p.slin] = p;
                    }
                    else {
                        noConflictProducts.push(p);
                        productsMap[p.name+' '+p.slin] = p;
                    }
                    done();
                });
            }, (e) => {
                if (e) { console.log(e); done(); }
                if (alreadyFound.length > 0) {
                    console.log('Products Also Found in Gladson (conflict)');
                    alreadyFound.forEach((p) => { console.log(p.name+' '+p.slin); });
                }
                self.saveNutritionData(nutritionsMap, productsMap, () => {
                    console.log('All Done!');
                    done();
                });
            });
        });
    }

    saveNutritionData(nutritionsMap, productsMap, done) {
        console.log('Saving to product details');
        async.eachLimit(nutritionsMap, 10, (n, done) => {
            let uniqueKey = n.name.trim()+' '+n.slin;
            if (!_.has(productsMap, uniqueKey)) return done();
            let nutritionData = {
                Source: 'Internal',
                Upc: productsMap[uniqueKey].upc,
                NutritionFacts: { Variant: [{ Nutrient: [] }] },
                Ingredients: { Ingredient: [] }
            };
            let nutritions = {};
            _.forEach(n, (v, k) => {
                if (!v) return;
                if (_.startsWith(k, 'nutrition_')) {
                    let name = k.replace('nutrition_', '');
                    name = name.trim();
                    if (name === 'Servings Per Container') {
                        nutritionData.NutritionFacts.Variant[0].ServingsPerContainer = v;
                        return;
                    }
                    if (name === 'Serving Size') {
                        nutritionData.NutritionFacts.Variant[0].ServingSizeText = v;
                        return;
                    }
                    if (_.endsWith(k, '_UOM')) {
                        name = name.replace('_UOM', '');
                        if (!_.has(nutritions, name)) nutritions[name] = {};
                        nutritions[name].UOM = v;
                    } else {
                        if (!_.has(nutritions, name)) nutritions[name] = {};
                        nutritions[name].Quantity = v;
                    }
                    nutritions[name].Name = name;
                } else if (_.startsWith(k, 'contains_')) {
                    let name = k.replace('contains_', '');
                    nutritions[name] = { Name: name, IsOrContains: true };
                }
            });

            let nutritionArray = nutritionData.NutritionFacts.Variant[0].Nutrient;
            _.forEach(nutritions, (v) => {
                if (v.Quantity || _.has(v, 'IsOrContains')) nutritionArray.push(v);
            });

            if (n.Ingredients) {
                let ings = n.Ingredients.split(/,(?![^()]*(?:\([^()]*\))?\))/g);
                ings.forEach((i) => { nutritionData.Ingredients.Ingredient.push(i.trim()); });
            }
            GladsonDataModel.findOneAndUpdate({ Upc: nutritionData.Upc , Source : nutritionData.Source}, nutritionData, { upsert: true }, done);
        }, done);
    }

    _updateCalories(done) {
        console.log('Updating Calories');
        let notUpdatedList = [];
        ProductModel.find().lean(true).exec(function (e, r) {
            if (e || !r) return done(e, r);
            async.eachLimit(r, 5, (product, done) => {
                GladsonDataModel.find({ Upc: product.upc, Source : 'Internal' }).lean(true).exec(function (err, result) {
                    if (err) {
                        console.error(err); return;
                    }
                    if (result && _.isArray(result) && result.length === 1) {
                        let productDetails = result[0];
                        if (_.has(productDetails, 'NutritionFacts.Variant')) {
                            let variant = _.find(productDetails.NutritionFacts.Variant, function (o) {
                                return (o.Nutrient) ? true : false;
                            });
                            if (variant) {
                                let calorieObject = _.find(variant.Nutrient, function (o) {
                                    return (o.Name === 'Calories');
                                });
                                if (calorieObject) {
                                    
                                    let caloriesValue = Number.parseInt(calorieObject.Quantity);
                                    // if (caloriesValue < 0) caloriesValue = Math.abs(caloriesValue);
                                    let calories = { calories: caloriesValue + '' };
                                    async.parallel([
                                        (done) => {
                                            ProductModel.findOneAndUpdate({ _id: product._id }, calories, done);
                                        },
                                       /*  // (done) => {
                                        //     StoreProductsModel.updateMany({ slin: product.slin }, { $set: calories }, { upsert: false, multi: true }, done);
                                        // } */
                                    ], done);
                                } else {
                                    done();
                                }
                            } else {
                                done();
                            }
                        } else {
                            done();
                        }
                    } else {
                        notUpdatedList.push(product);
                        done();
                    }
                });
            }, () => {
                if (notUpdatedList && notUpdatedList.length > 0) {
                    console.log('Product Not Updated');
                    notUpdatedList.forEach((prod) => { console.log(prod.slin, prod.upc, prod.name); });
                }
                done();
            });
        });
    }

    _updateSpecials_v1(done) {
        let self = this;
        console.log('V1 Specials update...');
        let timeOfDayMap = self._getTimeOfDayGroup(self.products);
        async.eachLimit(timeOfDayMap.keys(), 5, function (timeOfDay, done) {
            let allSpecialsForTheTimeSlot = timeOfDayMap.get(timeOfDay);
            self._resolveRequestForTimeslot(timeOfDay, allSpecialsForTheTimeSlot, 1, null, (err, request) => {
                self._updateContent(request, self.country, done);
            });
        }, done);
    }

    _updateSpecials_v2(done) {
        let self = this;
        console.log('V2 Specials update...');
        let timeOfDayMap = self._getTimeOfDayGroup(self.products);
        async.eachLimit(timeOfDayMap.keys(), 5, function (timeOfDay, done) {
            let allSpecialsForTheTimeSlot = timeOfDayMap.get(timeOfDay);
            self._resolveRequestForTimeslot(timeOfDay, allSpecialsForTheTimeSlot, 2, null, (err, request) => {
                self._addPreSelectedProductsPerCategory.call(self, request, () => {
                    self._updateContent(request, self.country, done);
                });
            });
        }, done);
    }

    _updateSpecials_v3(done) {

        let self = this;
        console.log('V3 Specials update...');
        async.waterfall([
            //creating Map
            self._getMapForMetaTags.bind(self, self.products),

            //parsing Map
            function (specialTimeOfDayMap, TagRules, CategoriesRuleStateProdMap, done2) {

                console.log('[_updateSpecials_v3] map for Specials', specialTimeOfDayMap);
                console.log('[_updateSpecials_v3] map for TagRules', TagRules);
                console.log('[_updateSpecials_v3] map for CategoriesRuleStateProdMap', JSON.stringify(CategoriesRuleStateProdMap));
                async.eachLimit([...specialTimeOfDayMap.keys()], 2, (keyName, done3) => {

                    let state = null;
                    if (keyName !== 'master') state = keyName;
                    let timeOfDayMap = specialTimeOfDayMap.get(keyName);
                    async.eachLimit([...timeOfDayMap.keys()], 5, function (timeOfDay, done4) {

                        let allSpecialsForTheTimeSlot = timeOfDayMap.get(timeOfDay);
                        console.log('[_updateSpecials_v3_debug] : ', keyName, timeOfDay);
                        self._resolveRequestForTimeslotV3(timeOfDay, allSpecialsForTheTimeSlot, 3, state, (err, request) => {

                            if (err) {
                                console.log('[_updateSpecials_v3] : got error', err);
                                return done4();
                            }
                            self._addPreSelectedProductsPerCategoryV3.call(self, request, CategoriesRuleStateProdMap, () => {

                                //making the content-api call to update the specials
                                self._updateContent(request, self.country, () => {

                                    if (request.parameters) console.log('[_updateSpecials_v3_debug] : request completed', request.parameters);
                                    done4();
                                });
                            });
                        });
                    }, () => {
                        console.log('[_updateSpecials_v3] Special Created', keyName);
                        done3();
                    });
                }, (err) => {
                    if (err) console.log('[_updateSpecials_v3] error for Map Keys', err);
                    done2();
                });
            }
        ], (err) => {
            if (err) console.log('[_updateSpecials_v3] error for waterfall', err);
            done();
        });
    }


    _getCategoriesListForState(stateList, done) {

        let self = this;
        let stateCategory = {};
        log.info('_getCategoriesListForState : starting');
        if (!_.isArray(stateList) || stateList.length === 0) return done (null, null);
        async.forEachLimit(stateList, 5, (state, next) => {

            self.categoryService.getAllCategories( {state: state}, (err, categoryObj)=> {

                if (err) {

                    log.error('_getCategoriesListForState err', err);
                    return next();
                }

                if (!_.has(categoryObj, 'Items') || categoryObj.Items.length === 0 ) {

                    log.info(`_getCategoriesListForState: state ${state} list is empty`);
                    return next();
                }
                stateCategory[state] = categoryObj.Items;
                return next();
             });
        }, (err)=> {

            if (err) return done(null, stateCategory);
            log.info('_getCategoriesListForState : done!');
            return done(null, stateCategory)
        });
    }

    _addRecoEngineProduct(recoEngineProducts, done) {

        let self = this;
        log.info('_addRecoEngineProduct : starting..');
        if (!_.isArray(recoEngineProducts)) recoEngineProducts = [];
        let obj = {
            specialsTitle: CONST.SPECIAL_TITLE,
            specials_id: CONST.SPECIAL_ID,
            products: recoEngineProducts,
            icon: CONST.SPECIAL_ICON
        };
        log.info('_addRecoEngineProduct : end!');
        done(null, [obj]);
    }

    _checkProductMetaTagsRule(metaTag, productTags) {

        if ( _.has(metaTag.sellable , 'false') &&
            _.intersection(metaTag['sellable']['false'] , productTags).length > 0
        ) {

            return false;
        } else if ( _.has(metaTag.sellable , 'true') &&
            _.intersection( metaTag['sellable']['true'] , metaTag).length > 0
        ) {

            return true;
        } else {
            return true;
        }
    }

    _getProductForCategory(categoryArr, state=null, metaTagRule=null, done) {

        let self = this;
        let specials  = [], productsPerCategory = 20;
        log.info('_getProductForCategory : starting ...');
        //log.info('_getProductForCategory : metaTagRule', JSON.stringify(metaTagRule));

        //console.log(`metaTagRule v4: ${JSON.stringify(metaTagRule)}`);
        async.forEachSeries(categoryArr, (catDoc, next)=> {
            if ( !catDoc.name) return next();
            if (!catDoc.id) return next();
            let query = { category_id: catDoc.id, country: self.country };
            
            console.log(`state: ${state} , category_id: ${catDoc.id} , cat name: ${catDoc.name}`);
            ProductModel.find(query)
                .limit(productsPerCategory)
                .sort({ popularity: 1 }).lean(true)
                .exec((err, results) => {

                    if (err) {
                        console.log('_getProductForCategory : ', err);
                        return next(null);
                    }
                    if (results.length === 0 ) return next();

                    //products for filtering using meta_tags
                    let productList = []
                    async.forEachSeries(results, (prod, innerNext)=> {

                        if (prod.meta_tags === null 
                            || (_.isArray(prod.meta_tags) && prod.meta_tags.length === 0) 
                            ||state === null 
                            || metaTagRule === null
                        ) {

                            //log.info(`_getProductForCategory : added product_id', ${prod.product_id} for state ${state}`);
                            productList.push(prod);
                            return innerNext();
                        }
                        if (_.has(metaTagRule, state)  && _.has(metaTagRule[state],'sellable') ) {

                            if ( self._checkProductMetaTagsRule(metaTagRule[state], prod.meta_tags) ) {
                                
                                console.log(`state: ${state}, product:  ${prod.name}, prod metaTag: ${prod.meta_tags} , cat name: ${catDoc.name}`);
                                //log.info(`_getProductForCategory : added product_id', ${prod.product_id} for state ${state}`);
                                productList.push(prod);
                            } else {
                                console.log(`removed !!!state: ${state}, product:  ${prod.name}, prod metaTag: ${prod.meta_tags} , cat name: ${catDoc.name}`);

                                log.info(`_getProductForCategory : removed product_id', ${prod.product_id} for state ${state}`);
                            }
                        }
                        return innerNext();
                    }, () => {

                        specials.push({
                            specialsTitle: catDoc.name,
                            specials_id: catDoc.id,
                            products: productList,
                            icon: catDoc.icon ? catDoc.icon : ''
                        });
                        next();
                    });
            });

        }, (err)=> {

            if (err) {
                console.log('_getProductForCategory', err);
            }
            return done(null, specials);
        });
    }

    _buildSpecialsRequestV4(categoryArr, version, timeOfDay, state=null, metaTagRule=null, recoEngineProducts, done) {

        let self = this;

        log.info('_buildSpecialsRequestV4 : starting ...' );
        let request = {
            parameters: { src: 'home-page', version: version , timeOfDay: timeOfDay},
            content: { specials: [] },
            isActive: true
        };
        if (state) request.parameters.state = state;
        if (categoryArr.length === 0) return done(null, null);

        async.parallel({

            reco_engine_specials: self._addRecoEngineProduct.bind(self, recoEngineProducts),
            other_specials: self._getProductForCategory.bind(self,categoryArr, state, metaTagRule)
        }, (err, results)=> {

            log.info('_buildSpecialsRequestV4 : reco_engine_specials ', results.reco_engine_specials.length);
            log.debug('_buildSpecialsRequestV4 : other_specials ', results.other_specials.length);
            request.content.specials = results.reco_engine_specials.concat(results.other_specials);
            log.info('_buildSpecialsRequestV4 : end!' );
            done(null, request);
        });

    }

    _productListFromSlin(slinArr, categoryList, done) {

        let query = {slin: {$in: slinArr}};
        if (categoryList.length !== 0 ) query.category_id = {$in: categoryList};

        log.debug('_productListFromSlin query', query);
        ProductModel.find(query).limit(20).lean(true).exec((err, results)=> {

            if (err) {
                console.error('_productListFromSlin err', err);
                done();
            }
            return done(null, results);
        });
    }

    _buildSpecialsGlobalV4(recoEngineData, version, done) {

        let self = this;
        log.info('_buildSpecialsGlobalV4 : started...');

        let timeOfDayList = Object.keys(recoEngineData);
        self.categoryService.getAllCategories(null,(err, globalCategory)=> {


            if (err) {
                log.error('_buildSpecialsGlobalV4 : err', err);
                return done();
            }
            let categoryList = _.map(globalCategory.Items, (o)=> { return o.id; });

            log.info('_buildSpecialsGlobalV4: categoryList', categoryList.length);
            log.debug('_buildSpecialsGlobalV4: categoryList', categoryList);
            async.forEachLimit(timeOfDayList, 1, (timeOfDay, next)=> {

                log.info('_buildSpecialsGlobalV4: timeOfDayList', timeOfDay);
                async.autoInject({

                    reco_engine_product: self._productListFromSlin.bind(self, recoEngineData[timeOfDay], categoryList),
                    global_cat_request: ['reco_engine_product', (reco_engine_product, cb) => {

                        self._buildSpecialsRequestV4.call(self, globalCategory.Items, version, timeOfDay, null, null, reco_engine_product, cb);
                    }],
                    build_specials: [ 'global_cat_request', (global_cat_request, cb)=> {
                        self._updateContent.call(self, global_cat_request, self.country, cb);
                    }],
                }, () => {

                    log.info(`_buildSpecialsGlobalV4 : completed for ${timeOfDay}`);
                    next()
                });
            }, () =>{

                log.info('_buildSpecialsGlobalV4 : completed the global build!');
                done();
            });
        });
    }

    _getUniqStateList(metaTagRule, done){

        let stateList = [];
        if (_.isNull(metaTagRule)) return done(null, null);
        if (!_.isObject(metaTagRule)) return done(null, null);
        stateList = Object.keys(metaTagRule);
        if (stateList.length === 0) return done(null, null);
        return done(null, stateList);
    }


    _buildCategorySpecials(metaTagRule, stateList, stateCategoryMap, recoEngineData, version, done) {

        let self = this;
        if(_.isNull(metaTagRule)) return done(null, null);
        if(_.isNull(stateList)) return done(null, null);
        if(_.isNull(stateCategoryMap)) return done(null, null);
        if (Object.keys(stateCategoryMap).length ===0) return done(null, null);

        let timeOfDayList = Object.keys(recoEngineData);
        if (timeOfDayList.length === 0) return done(null, null);
        log.info('_buildCategorySpecials : started...');
        log.info('_buildCategorySpecials :' , JSON.stringify(stateCategoryMap));


        async.forEachLimit(stateList, 4, (stateName, next)=> {

            let categoryListIds = _.map(stateCategoryMap[stateName], (o)=> { return o.id; });
            log.debug(`categoryListIds for state ${stateName} : ${categoryListIds.length}`);
            async.forEachLimit(timeOfDayList , 4, (timeOfDay, innerNext)=> {

                async.autoInject({

                    reco_engine_product: self._productListFromSlin.bind(self, recoEngineData[timeOfDay], categoryListIds),
                    special_request: ['reco_engine_product', (reco_engine_product, cb) => {

                        log.info(`reco_engine_product ${reco_engine_product.length}`);
                        self._buildSpecialsRequestV4.call(self, stateCategoryMap[stateName], version, timeOfDay, stateName, metaTagRule,reco_engine_product, cb);
                    }],
                    build_specials: [ 'special_request', (special_request, cb)=> {
                        self._updateContent.call(self,special_request, self.country, cb);
                    }],
                }, () => {

                    log.info(`_buildCategorySpecials : completed for ${timeOfDay}`);
                    innerNext()
                });
            }, ()=> {
                next();
            });
        }, ()=> {
            done();
        });
    }

    _buildSpecialsStateV4(recoEngineData, version, done) {

        let self = this;

        log.info('_buildSpecialsStateV4 starting..');
        async.autoInject({
            meta_tag_rule: self._getMetaTagRuleForState.bind(self),
            state_list: ['meta_tag_rule', (meta_tag_rule, cb)=>{
                self._getUniqStateList.call(self,meta_tag_rule, cb);
            }],
            state_category_map: ['state_list', (state_list, cb) => {
                self._getCategoriesListForState.call(self,state_list, cb);
            }],
            build_specials: [ 'meta_tag_rule','state_list','state_category_map', (meta_tag_rule, state_list , state_category_map, cb)=> {

                self._buildCategorySpecials.call(self,meta_tag_rule, state_list, state_category_map, recoEngineData, version,cb);
            }]
        }, ()=> {
            log.info('_buildSpecialsStateV4 completed');
            done();
        });
    }

    _getMetaTagRuleForState( done) {

        let self = this;
        log.info('_getMetaTagRuleForState started..');
        let aggregateQuery = [
            {
                $match: {
                    meta_tag: {$ne: null},
                    is_active: true,
                    sellable: {$exists: true, $ne: null},
                    state: {$exists: true, $ne: null},
                    $and: [
                           { $or: [
                               {city: {$exists: false}},
                               {city: {$exists: true, $eq: null}}
                            ]},
                            {
                                $or: [
                                 {store_id: {$exists: false}},
                                 {store_id: {$exists: true, $eq: null}}

                            ]}
                     ]
                }
            },
            {$project: {meta_tag: 1, state: 1, sellable: 1}},
            {
                $group: {
                    _id: {state: "$state",sellable: "$sellable"},
                    meta_tags_list: {$addToSet: "$meta_tag"}
                }
            }
        ];

        log.info(`_getMetaTagRuleForState : aggregateQuery: ${aggregateQuery}`);
        let tagMap = {};
        ProductLocRulesModel.aggregate(aggregateQuery).exec((err, results)=> {

            if (err) {
                log.error('_getMetaTagRuleForState : err', err);
                done(null, null);
            }
            if (results.length === 0) return done(null, null);

            results.forEach((doc, index) => {

                if (_.has(doc, '_id') && _.has(doc._id, 'state') && _.has(doc._id, 'sellable')) {

                    if ( !tagMap[doc._id.state] ) tagMap[doc._id.state] = {};
                    if ( !tagMap[doc._id.state]['sellable']) tagMap[doc._id.state]['sellable'] = {};
                    if ( !tagMap[doc._id.state]['sellable'][doc._id.sellable.toString()]) {

                        tagMap[doc._id.state]['sellable'][doc._id.sellable.toString()] = doc.meta_tags_list;
                    }
                }
                if ((results.length -1) === index) {
                    log.debug('_getMetaTagRuleForState : tagMap', tagMap);
                    return done(null, tagMap);
                }
            });

        });
    }


    _getSlinListFromProductReco(done) {

        let self = this;
        let  timeDaySlinMap = {};
        console.log('_getSlinListFromProductReco :  msg : started');
        let request = {
            //timeOfDay: params['timeOfDay'],
            correlationid: new Date().getTime().toString()
                + Math.floor(Math.random() * 1000).toString(),
            loyaltyid: Math.floor(Math.random() * Math.pow(10, 5)).toString()
        };


        async.forEachLimit(Object.keys(CONST.TIME_OF_DAY.range), 5, (timeOfDay, next) => {

            let arr = CONST['TIME_OF_DAY']['range'][timeOfDay];
            let randTimeOfDayVal = arr[Math.floor(Math.random() * arr.length)];
            request.timeOfDay = randTimeOfDayVal;

            console.log('_getSlinListFromProductReco : request', request);
            let personalRecoService = new PersonalReco();
            personalRecoService.getProductRecommendation(request, (err, slinArr) => {

                if (err) {

                    return next(null, null);
                }

                let slinList = [];
                slinList = slinArr.map(slin => slin.toString());
                timeDaySlinMap[timeOfDay] = slinList;
                next()
            });
        }, ()=> {

            log.debug('_getSlinListFromProductReco : timeDaySlinMap', timeDaySlinMap);
            done(null, timeDaySlinMap);
        });
    }

    _updateSpecials_v4(done) {

        let self = this;
        let version = '4';
        log.info('V4 Specials update...');

        async.autoInject( {

            reco_engine_data: self._getSlinListFromProductReco.bind(self),
            global_category_build: ['reco_engine_data', (reco_engine_data, next)=> {

                self._buildSpecialsGlobalV4.call(self,reco_engine_data, version,next)
            }],
            state_category_build: ['reco_engine_data', (reco_engine_data, next)=> {

                self._buildSpecialsStateV4.call(self,reco_engine_data, version, next)
            }]
        }, (err, results)=> {
            done();
        });
    }

    _getMapForMetaTags(products, done) {

        if (products.length === 0) return done();

        let self = this;
        let specialTimeOfDayMap = new Map();
        specialTimeOfDayMap.set('master', new Map());
        let TagRules = {
            rules: {}
        }; // Object to save the product_rule
        let specialIdProdMap = {}; // Object to store which product to add or remove for state based on product rule
        let CategoriesRuleStateProdMap = {
            'state_list': []
        };
        //step 1.
        let queueCat = async.queue(queueCategoriesRuleStateProdMap.bind(self), 10);
        queueCat.drain = function () {

            console.log('[_getMapForMetaTags]: category depended state', CategoriesRuleStateProdMap);
            let queueTag = async.queue(queueSpecialTimeOfDayMap.bind(self), 5);
            queueTag.drain = function () {

                processAllStateFromCatAndSpecials(() => {

                    console.log('[_getMapForMetaTags : specialIdProdMap', JSON.stringify(specialIdProdMap));
                    console.log('[_getMapForMetaTags : specialTimeOfDayMap', specialTimeOfDayMap);
                    addStateLevelMap(() => {
                        console.log('[_getMapForMetaTags : Map', specialTimeOfDayMap);
                        console.log('TagRules', JSON.stringify(TagRules));
                        //return done();
                        done(null, specialTimeOfDayMap, TagRules, CategoriesRuleStateProdMap);
                    });
                });

            };
            products.forEach((product) => {
                queueTag.push(product);
            });
        };
        //due stack out of range : this flow has been implement
        products.forEach((product) => {
            queueCat.push(product);
        });

        function queueSpecialTimeOfDayMap(product, done) {

            let self = this;
            console.log('[queueSpecialTimeOfDayMap] : started for product', product.product_id);
            if (!product.original_price) {
                if (product.product_id) self.specialFail.push(`${product.product_id} does not have original_price.`);
                return done();
            }
            if (!product.specials_slot_of_day) {

                if (product.product_id) self.specialFail.push(`${product.product_id} does not have specials_slot_of_day.`);
                return done();
            }
            let asyncJob = [];
            asyncJob.push(fillTagRuleAndSpeIdProdMap.bind(self, product));
            asyncJob.push(processUniqMetaTag.bind(self));
            asyncJob.push(processStateTagHash.bind(self));
            async.series(
                [
                    copyProductToMapSuper.bind(null, 'master', product.specials_slot_of_day, product),
                    function (done2) {
                        async.waterfall(
                            asyncJob,
                            () => { console.log('checking the status'); done2(); }
                        );
                    }
                ],
                () => {
                    console.log('[queueSpecialTimeOfDayMap] : ...completed');
                    done();
                }
            );
        }

        function queueCategoriesRuleStateProdMap(product, done) {

            let self = this;
            if (!product.original_price) {
                if (product.product_id) self.specialFail.push(`${product.product_id} does not have original_price.`);
                return done();
            }
            if (!product.meta_tags) {
                return done();
            }
            console.log('[queueCategoriesRuleStateProdMap] : category check started', product.product_id);
            fillCategoriesRuleStateProdMap.call(self, product, () => {

                let uniqState = _.uniq(CategoriesRuleStateProdMap['state_list']);
                CategoriesRuleStateProdMap['state_list'] = uniqState;
                done();
            });
        }

        function getProductObjFromMasterMap(specialSlotOfDay, stateName, specialId, productId) {
            let prodObjList = specialTimeOfDayMap.get('master').get(specialSlotOfDay).get(specialId);
            let filterObj = _.filter(prodObjList, { product_id: productId });
            return filterObj[0];
        }

        function addStateLevelMap(done) {

            let uniqStateList = [];
            uniqStateList = _.without(Object.keys(specialIdProdMap), 'all_meta_tag');
            if (uniqStateList.length === 0) return done();
            let q = async.queue(addProductIdToMap, 4);
            q.drain = function () {
                return done();
            };

            //q push Flow
            async.forEach(uniqStateList, (state, next) => {

                let timeSlots = Object.keys(specialIdProdMap[state]);
                if (timeSlots.length === 0) return next();
                async.forEach(timeSlots, (timeSlot, innerNext) => {

                    let specialIds = Object.keys(specialIdProdMap[state][timeSlot]);
                    if (specialIds.length === 0) return innerNext();
                    async.forEach(specialIds, (specialID, nextInner2) => {

                        let productGlobal = Array.from(specialIdProdMap['all_meta_tag'][timeSlot]['special_ids'][specialID]['product_ids']);
                        let addListProdId = [], removeListProdId = [];
                        let currentList = Array.from(productGlobal);
                        if (specialIdProdMap[state][timeSlot][specialID]['add']) {

                            addListProdId = specialIdProdMap[state][timeSlot][specialID]['add'];
                            currentList = _.union(currentList, addListProdId);
                        }
                        if (specialIdProdMap[state][timeSlot][specialID]['remove']) {

                            removeListProdId = specialIdProdMap[state][timeSlot][specialID]['remove'];
                            currentList = _.pullAll(currentList, removeListProdId);
                        }
                        if (currentList.length === 0) return nextInner2();
                        currentList.forEach((product_id, index) => {

                            //console.log('--------------->', specialSlotOfDay , stateName, specialId, product_id);
                            q.push({ time_slot: timeSlot, state: state, special_id: specialID, product_id: product_id });
                            if (index === currentList.length - 1) return nextInner2();
                        });
                    }, innerNext);
                }, next);

            }, () => {
                if (q.length() === 0) {
                    //killing the queue if no object is inserted
                    q.kill();
                    return done();
                } // else queue drain function will call the done
            });
        }

        function addProductIdToMap(specialObj, done) {

            let prodObj = getProductObjFromMasterMap(specialObj.time_slot, specialObj.state, specialObj.special_id, specialObj.product_id);
            if (_.isObject(prodObj)) {
                copyProductToMapSuper(specialObj.state, specialObj.time_slot, prodObj, done);
            } else {
                done();
            }
        }

        function fillTagRuleAndSpeIdProdMap(product, done) {

            let self = this;
            console.log('fillTagRuleAndSpeIdProdMap');
            let metaTagList = _.split(product.meta_tags, ',');

            if (!specialIdProdMap['all_meta_tag']) specialIdProdMap['all_meta_tag'] = {};

            if (!specialIdProdMap['all_meta_tag'][product.specials_slot_of_day])
                specialIdProdMap['all_meta_tag'][product.specials_slot_of_day] = { 'state': [], 'special_ids': {} };

            if (!specialIdProdMap['all_meta_tag'][product.specials_slot_of_day]['special_ids'][product.specials_id])
                specialIdProdMap['all_meta_tag'][product.specials_slot_of_day]['special_ids'][product.specials_id] = { 'product_ids': [] };

            if (!specialIdProdMap['all_meta_tag'][product.specials_slot_of_day]['special_ids'][product.specials_id]['product_ids'])
                specialIdProdMap['all_meta_tag'][product.specials_slot_of_day]['special_ids'][product.specials_id]['product_ids'] = [];

            specialIdProdMap['all_meta_tag'][product.specials_slot_of_day]['special_ids'][product.specials_id]['product_ids'].push(product.product_id);

            if (!product.meta_tags || !_.isArray(metaTagList) || metaTagList.length === 0) {
                console.log('@@---> fillTagRuleAndSpeIdProdMap : empty meta tags');
                return done(null, { uniq_arr: metaTagList }, product);
            }
            console.log('@@---> fillTagRuleAndSpeIdProdMap : meta tags', metaTagList);
            let metaTagListForProd = [];
            async.forEachLimit(metaTagList, 4, (metaTag, next) => {

                metaTag = metaTag.replace(/ /g, '');
                if (TagRules[metaTag]) {
                    metaTagListForProd.push(metaTag);
                    return next();
                }
                //MongoQuery will only run if the rule is missing in TagRules
                ProductLocRulesModel.find({ 'meta_tag': metaTag, 'is_active': true }, (err, rules) => {

                    if (err) {
                        self.specialFail.push(`${metaTag} gave error: ${err}`);
                        console.log('[fillTagRuleAndUniqTag]: error encountered', err);
                        return next();
                    }
                    if (rules.length === 0) {
                        self.specialFail.push(`${metaTag} does not have entry in mongoDB`);
                        console.log('[fillTagRuleAndUniqTag]: no meta tag found', metaTag);
                        return next();
                    }
                    async.forEachLimit(rules, 3, (rule, innerNext) => {

                        let ruleLocal = JSON.parse(JSON.stringify(rule));

                        //No need to capture the rule
                        if (!_.has(ruleLocal, 'sellable') || ruleLocal['sellable'] === null) return innerNext();
                        if (_.has(ruleLocal, 'city') && ruleLocal['city'] !== null) return innerNext();
                        if (_.has(ruleLocal, 'store_id') && ruleLocal['store_id'] !== null) return innerNext();

                        metaTagListForProd.push(metaTag);
                        //Save the rule
                        if (!TagRules[metaTag]) TagRules[metaTag] = {};
                        if (ruleLocal.state && !TagRules[metaTag]['state']) TagRules[metaTag]['state'] = {};
                        if (ruleLocal.state && !TagRules[metaTag]['state'][ruleLocal.state]) TagRules[metaTag]['state'][ruleLocal.state] = {};
                        if (ruleLocal.state && !TagRules[metaTag]['state'][ruleLocal.state]['sellable']) TagRules[metaTag]['state'][ruleLocal.state] = { sellable: ruleLocal.sellable };
                        innerNext();
                    }, next);
                });
            }, () => {


                metaTagListForProd = _.uniq(metaTagListForProd);
                console.log('metaTagList debug:', metaTagListForProd);
                done(null, { uniq_arr: metaTagListForProd }, product);
            });
        }

        function processAllStateFromCatAndSpecials(done) {
            //this function create copy of state
            let uniqStateList = [];
            uniqStateList = _.without(Object.keys(specialIdProdMap), 'all_meta_tag');
            uniqStateList = _.union(uniqStateList, CategoriesRuleStateProdMap['state_list']);
            console.log('[processAllStateFromCatAndSpecials] new state list', uniqStateList);
            if (uniqStateList.length === 0) return done();
            //iterate over the state

            async.forEachLimit(uniqStateList, 1, (state, next) => {
                console.log('@@#---------> state', state);
                if (!specialIdProdMap['all_meta_tag']) return next();
                if (!specialIdProdMap[state]) specialIdProdMap[state] = {};
                if (Object.keys(specialIdProdMap['all_meta_tag']).length === 0) return next();

                async.forEachLimit(Object.keys(specialIdProdMap['all_meta_tag']), 3, (time_slot, innerNext) => {

                    if (Object.keys(specialIdProdMap['all_meta_tag'][time_slot]['special_ids']).length === 0) return innerNext();
                    //creating the state level key value NY Afternoon
                    if (!specialIdProdMap[state][time_slot]) specialIdProdMap[state][time_slot] = {};
                    async.forEachLimit(
                        Object.keys(specialIdProdMap['all_meta_tag'][time_slot]['special_ids']),
                        3,
                        (special_id, deepNext) => {

                            if (!specialIdProdMap[state][time_slot][special_id]) specialIdProdMap[state][time_slot][special_id] = {};
                            if (!specialIdProdMap[state][time_slot][special_id]['product_ids']) {
                                specialIdProdMap[state][time_slot][special_id]['product_ids'] = { add: [] };
                                specialIdProdMap[state][time_slot][special_id]['product_ids']['add'] = Array.from(specialIdProdMap['all_meta_tag'][time_slot]['special_ids'][special_id]['product_ids']);
                                specialIdProdMap['all_meta_tag'][time_slot]['state'].push(state);
                            } // no else it means state has already rules
                            deepNext();
                        },
                        () => {
                            innerNext();
                        });
                }, () => {
                    next();
                });
            }, () => {
                done();
            });
            //all_meta_tag Lunch state
            //TX Afternoon 3345 product_ids
        }

        function fillCategoriesRuleStateProdMap(product, done) {

            let self = this;
            let metaTagList = _.split(product.meta_tags, ',');
            if (!product.meta_tags || !_.isArray(metaTagList) || metaTagList.length === 0) {
                return done(null);
            }

            let metaTagListForProd = [];
            async.forEachLimit(metaTagList, 1, (metaTag, next) => {

                metaTag = metaTag.replace(/ /g, '');
                if (TagRules[metaTag]) {
                    metaTagListForProd.push(metaTag);
                    return next();
                }
                //MongoQuery will only run if the rule is missing in TagRules
                ProductLocRulesModel.find({ 'meta_tag': metaTag, 'is_active': true }, (err, rules) => {

                    if (err) {
                        self.specialFail.push(`${metaTag} gave error: ${err}`);
                        console.log('[fillTagRuleAndUniqTag]: error encountered', err);
                        return next();
                    }
                    if (rules.length === 0) {
                        self.specialFail.push(`${metaTag} does not have entry in mongoDB`);
                        console.log('[fillTagRuleAndUniqTag]: no meta tag found', metaTag);
                        return next();
                    }
                    async.forEachLimit(rules, 1, (rule, innerNext) => {


                        let ruleLocal = JSON.parse(JSON.stringify(rule));

                        //No Need to capture the rule
                        if (!_.has(ruleLocal, 'sellable') || ruleLocal['sellable'] === null) return innerNext();
                        if (_.has(ruleLocal, 'city') && ruleLocal['city'] !== null) return innerNext();
                        if (_.has(ruleLocal, 'store_id') && ruleLocal['store_id'] !== null) return innerNext();

                        //Create The Rule Copy in Hash
                        metaTagListForProd.push(metaTag);
                        if (!TagRules[metaTag]) TagRules[metaTag] = {};
                        if (ruleLocal.state && !TagRules[metaTag]['state']) TagRules[metaTag]['state'] = {};
                        if (ruleLocal.state && !TagRules[metaTag]['state'][ruleLocal.state]) TagRules[metaTag]['state'][ruleLocal.state] = {};
                        if (ruleLocal.state && !TagRules[metaTag]['state'][ruleLocal.state]['sellable']) TagRules[metaTag]['state'][ruleLocal.state] = { sellable: ruleLocal.sellable };
                        return innerNext();
                    }, () => {
                        return next();
                    });
                });
            }, () => {

                metaTagListForProd = _.uniq(metaTagListForProd);
                if (metaTagListForProd.length === 0) return done();
                async.forEachLimit(metaTagListForProd, 1, (meta_tag, next) => {

                    if (!TagRules[meta_tag]) return next();
                    if (!TagRules[meta_tag]['state']) return next();
                    if (Object.keys(TagRules[meta_tag]['state']).length === 0) return next();
                    Object.keys(TagRules[meta_tag]['state']).forEach((state, index) => {

                        CategoriesRuleStateProdMap['state_list'].push(state);
                        if (!CategoriesRuleStateProdMap[state]) CategoriesRuleStateProdMap[state] = {};
                        let categoryList = self._csvProcess('category', product);
                        async.forEach(categoryList, (categoryName, innerNext) => {

                            if (TagRules[meta_tag]['state'][state]['sellable']) {

                                if (!CategoriesRuleStateProdMap[state][categoryName])
                                    CategoriesRuleStateProdMap[state][categoryName] = { 'add': [], 'remove': [] };
                                CategoriesRuleStateProdMap[state][categoryName]['add'].push(product.product_id);
                            } else if (!TagRules[meta_tag]['state'][state]['sellable']) {

                                if (!CategoriesRuleStateProdMap[state][categoryName])
                                    CategoriesRuleStateProdMap[state][categoryName] = { 'add': [], 'remove': [] };
                                CategoriesRuleStateProdMap[state][categoryName]['remove'].push(product.product_id);
                            }
                            innerNext();
                        }, () => {
                            if ((Object.keys(TagRules[meta_tag]['state']).length - 1) === index) return next();
                        });
                    });
                }, () => {

                    //now CategoryRule

                    done();
                });
            });
        }

        function processUniqMetaTag(uniqProdTags, product, done) {

            let self = this;
            let stateTagHash = {};
            console.log('[processUniqMetaTag]: creating stateTag');
            console.log(`[processUniqMetaTag] : metaTag list ${uniqProdTags.uniq_arr} for ${product.product_id}`);
            if (uniqProdTags.uniq_arr.length === 0) return done(null, stateTagHash, product);
            async.forEachLimit(uniqProdTags.uniq_arr, 3, (metaTag, next) => {

                //fail check
                if (!TagRules[metaTag]
                    || !TagRules[metaTag]['state']
                    || Object.keys(TagRules[metaTag]['state']).length === 0
                ) {
                    self.specialFail.push(`${metaTag} does not have state`);
                    return next();
                }

                let stateList = Object.keys(TagRules[metaTag]['state']);
                if (stateList.length === 0) return next();

                async.forEachLimit(
                    stateList,
                    2,
                    (stateName, next1) => {
                        if (!stateTagHash[stateName]) {
                            stateTagHash[stateName] = [];
                            stateTagHash[stateName].push(TagRules[metaTag]['state'][stateName]['sellable']);
                            next1();
                        } else {
                            stateTagHash[stateName].push(TagRules[metaTag]['state'][stateName]['sellable']);
                            next1();
                        }
                    },
                    next);
            }, () => {
                console.log('[processUniqMetaTag] :  stateTagHash data fill ...completed', stateTagHash);
                done(null, _.cloneDeep(stateTagHash), product);
            });
        }

        function processStateTagHash(stateTagHash, product, done) {

            let stateList = Object.keys(stateTagHash);
            if (stateList.length === 0) return done();
            async.forEachLimit(
                stateList,
                2,
                (stateName, next) => {

                    let checkAlltruthy = _.every(stateTagHash[stateName]);
                    let checkAllFalsey = _.every(stateTagHash[stateName], (k) => { return k !== true; });
                    //add all truthy condition to add the item
                    if (checkAlltruthy) {

                        if (!specialIdProdMap[stateName]) specialIdProdMap[stateName] = {};

                        if (!specialIdProdMap[stateName][product.specials_slot_of_day])
                            specialIdProdMap[stateName][product.specials_slot_of_day] = {};

                        if (!specialIdProdMap[stateName][product.specials_slot_of_day][product.specials_id])
                            specialIdProdMap[stateName][product.specials_slot_of_day][product.specials_id] = { product_ids: { add: [] } };

                        if (!specialIdProdMap[stateName][product.specials_slot_of_day][product.specials_id]['product_ids']['add'])
                            specialIdProdMap[stateName][product.specials_slot_of_day][product.specials_id]['product_ids']['add'] = [];

                        specialIdProdMap[stateName][product.specials_slot_of_day][product.specials_id]['product_ids']['add'].push(product.product_id);
                        //specialIdProdMap['no_meta_tag'][product.specials_slot_of_day]['state'].push(stateName);
                        specialIdProdMap['all_meta_tag'][product.specials_slot_of_day]['state'].push(stateName);
                        //copyProductToMapSuper(stateName, product.specials_slot_of_day, product , next);
                        next();
                    } else if (checkAllFalsey) {
                        if (!specialIdProdMap[stateName]) specialIdProdMap[stateName] = {};

                        if (!specialIdProdMap[stateName][product.specials_slot_of_day])
                            specialIdProdMap[stateName][product.specials_slot_of_day] = {};

                        if (!specialIdProdMap[stateName][product.specials_slot_of_day][product.specials_id])
                            specialIdProdMap[stateName][product.specials_slot_of_day][product.specials_id] = { product_ids: { remove: [] } };

                        if (!specialIdProdMap[stateName][product.specials_slot_of_day][product.specials_id]['product_ids']['remove'])
                            specialIdProdMap[stateName][product.specials_slot_of_day][product.specials_id]['product_ids']['remove'] = [];

                        specialIdProdMap[stateName][product.specials_slot_of_day][product.specials_id]['product_ids']['remove'].push(product.product_id);
                        //specialIdProdMap['no_meta_tag'][product.specials_slot_of_day]['state'].push(stateName);
                        specialIdProdMap['all_meta_tag'][product.specials_slot_of_day]['state'].push(stateName);
                        next();
                    } else {
                        next();
                    }
                },
                () => {
                    console.log('[processStateTagHash] : completed');
                    return done();
                }
            );
        }

        function copyProductToMapSuper(key, specialSlotOfDay, product, done) {
            console.log('+--------------->', specialSlotOfDay, key, product.specials_id, product.product_id);
            if (!specialTimeOfDayMap.get(key)) specialTimeOfDayMap.set(key, new Map());
            let superMap = specialTimeOfDayMap.get(key);
            if (!superMap.get(specialSlotOfDay)) {
                superMap.set(specialSlotOfDay, new Map());
            }

            let contentMap = superMap.get(specialSlotOfDay);
            if (!contentMap.get(product.specials_id)) {
                contentMap.set(product.specials_id, []);
            }
            contentMap.get(product.specials_id).push(product);
            //console.log(specialTimeOfDayMap);
            console.log('+--------------->', 'returned');
            return done(null);
        }
    }

    _resolveRequestForTimeslotV3(timeOfDay, specialsGroup, version, state = null, done) {
        let self = this;
        console.log('Time of day:', timeOfDay);
        let request = {
            parameters: { src: 'home-page', timeOfDay: timeOfDay, version: version },
            content: { specials: [] },
            isActive: true
        };
        if (state) request.parameters.state = state;
        let oneProduct;

        async.each([...specialsGroup.keys()], function (specialsId, done) {

            console.log('[_resolveRequestForTimeslotV3] : timeOfDay state version', timeOfDay, version, state, specialsId);
            let specialProducts = specialsGroup.get(specialsId);
            oneProduct = specialProducts[0];
            self._resolveAndAddSpecial(request.content.specials, specialProducts, specialsId, 1, done);
        }, () => {
            if (!request.content.backgroundImage) {
                request.content.backgroundImage = oneProduct.specials_background;
            }
            done(null, request);
        });
    }

    _resolveRequestForTimeslot(timeOfDay, specialsGroup, version, state = null, done) {
        let self = this;
        console.log('Time of day:', timeOfDay);
        let request = {
            parameters: { src: 'home-page', timeOfDay: timeOfDay, version: version },
            content: { specials: [] },
            isActive: true
        };
        if (state) request.parameters.state = state;
        let oneProduct;
        async.each(specialsGroup.keys(), function (specialsId, done) {
            let specialProducts = specialsGroup.get(specialsId);
            oneProduct = specialProducts[0];
            self._resolveAndAddSpecial(request.content.specials, specialProducts, specialsId, 1, done);
        }, () => {
            if (!request.content.backgroundImage) {
                request.content.backgroundImage = oneProduct.specials_background;
            }
            done(null, request);
        });
    }

    _resolveAndAddSpecial(specials, specialProducts, specialsId, version, done) {
        let self = this;
        let products = [], oneProduct = specialProducts[0];
        async.each(specialProducts, function (product, done) {
            self._resolveAndAddProduct(products, product, done);
        }, function () {
            specials.push({
                specials_id: specialsId,
                specialsTitle: oneProduct.specials_title,
                products: _.uniqBy(products, 'name')
            });
            done();
        });
    }

    _resolveAndAddProduct(products, product, done) {
        let catalogReq = { id: product.id, is_active: true };
        if (product.flavor_id) catalogReq.flavor_id = product.flavor_id;
        ProductModel.find(catalogReq).lean(true).exec((err, result) => {
            if (result && result.length > 0) {
                let product = result[0];
                if (product) {
                    if (product.flavor_id) {
                        product.id = product.id + '-' + product.flavor_id;
                    }
                    products.push(product);
                }
            }
            done();
        });
    }

    _updateContent(request, country, done) {

        console.log('[_updateContent] : request', request);
        let lambda = new AWS.Lambda({ region: process.env.REGION });
        let event = {
            headers: { 'X-711-Locale': CONST.X_711_LOCALE_HEADER[country] },
            body: request
        };
        lambda.invoke({
            FunctionName: process.env.SPECIALS_UPDATE,
            Payload: JSON.stringify(event)
        }, function (err) {
            if (err) { console.error(err); }
            done();
        });
    }

    _getTimeOfDayGroup(products) {
        let timeOfDayMap = new Map();
        _.forEach(products, function (product) {
            if (product.original_price) {
                if (product.specials_slot_of_day) {
                    if (!timeOfDayMap.get(product.specials_slot_of_day)) {
                        timeOfDayMap.set(product.specials_slot_of_day, new Map());
                    }
                    let contents = timeOfDayMap.get(product.specials_slot_of_day);
                    if (!contents.get(product.specials_id)) {
                        contents.set(product.specials_id, []);
                    }
                    contents.get(product.specials_id).push(product);
                }
            }
        });
        return timeOfDayMap;
    }

    _addPreSelectedProductsPerCategory(request, done) {

        let self = this;
        console.time('CategorySpecials');
        let categorySpecials = new Map();
        _.forEach(self.products, (product) => {
            if (product.category_specials) {
                let categoryNames = self._csvProcess('category', product);
                categoryNames.forEach((categoryName) => {
                    if (!categorySpecials.get(categoryName)) { categorySpecials.set(categoryName, []); }
                    categorySpecials.get(categoryName).push(product);
                });
            }
        });
        let categoryNames = [];
        categorySpecials.forEach((value, key) => categoryNames.push(key));
        console.log('Category Specials', categoryNames);
        CategoryModel.find({ is_active: true, name: { $in: categoryNames } }).sort({ popularity: 1 }).lean(true).exec((err, cats) => {
            if (cats && cats.length > 0) {
                async.each(cats, (category, done) => {
                    let categoryName = category.name;
                    let products = _.sortBy(categorySpecials.get(categoryName), ['popularity']);
                    let productIds = _.map(products, product => product.product_id);
                    console.log('Category specials:', categoryName);
                    ProductModel.find({ product_id: { $in: productIds }, is_active: true, category_id: category.id}).sort({ popularity: 1 }).lean(true).exec((err, result) => {
                        // console.log('Category special products count', result.length);
                        if (result && result.length > 0 && self.categoriesMap.get(categoryName)) {
                            let category = self.categoriesMap.get(categoryName);
                            let specialsObj = {
                                specialsTitle: categoryName,
                                specials_id: category.id,
                                products: _.uniqBy(result, 'name')
                            };
                            if (_.isBoolean(category.verify_age)) specialsObj.verify_age = category.verify_age;
                            if (_.isObject(category.min_purchase_age)) specialsObj.min_purchase_age = category.min_purchase_age;
                            request.content.specials.push(specialsObj);
                        }
                        done();
                    });
                }, () => {
                    console.timeEnd('CategorySpecials');
                    done();
                });
            } else {
                done();
            }
        });
    }
    //
    _addPreSelectedProductsPerCategoryV3(request, CategoriesRuleStateProdMap, done) {

        let self = this, req = null;
        if (request.parameters) req = JSON.parse(JSON.stringify(request)).parameters;
        let query = {};
        if (req.hasOwnProperty('state')) query.state = req.state;
        // will fetch the local category
        self.categoryService.getAllCategories(query, (err, output) => {

            if (err) { console.log(err); }
            if (!output || !output.Items || output.Items.length === 0) return done();

            //creating catMap category_name and category
            mapCategoryBasedOnName.call(self, JSON.parse(JSON.stringify(output)), (catMap) => {

                processCategories.call(self, JSON.parse(JSON.stringify(output)), catMap, () => {
                    done();
                });
            });
        });

        function mapCategoryBasedOnName(categoryItems, innerDone) {

            let catMap = {};
            if (categoryItems.Items.length === 0) return innerDone();
            categoryItems.Items.forEach((category, index) => {

                if (!catMap[category.name]) {
                    catMap[category.name] = category;
                } else {
                    console.log('[mapCategoryBasedOnName]: category name repeated', category.name);
                }

                if (index === (categoryItems.Items.length - 1)) innerDone(catMap);
            });
        }

        function processCategories(categoryItems, catMap, innerDone) {

            let self = this;
            if (categoryItems.Items.length === 0) return innerDone();
            let categorySpecials = new Map();
            async.forEach(self.products, (product, next) => {

                if (!product.category_specials) return next();

                let categoryNames = self._csvProcess('category', product);
                async.forEach(categoryNames, (categoryName, innerNext) => {

                    console.log('categoryName v3', query, categoryName, product.product_id, catMap[categoryName]);
                    if (!catMap[categoryName]) return next();
                    if (!categorySpecials.get(categoryName)) { categorySpecials.set(categoryName, []); }
                    categorySpecials.get(categoryName).push(product);
                    innerNext();
                }, () => {
                    next();
                });
            }, () => {

                console.log('Category Specials v3', Object.keys(catMap));
                async.eachSeries(categoryItems.Items, (categoryDb, next) => {

                    let categoryName = categoryDb.name;
                    console.log('categoryName v3:', categoryName);
                    let products = _.sortBy(categorySpecials.get(categoryName), ['popularity']);
                    let productIds = _.map(products, product => product.product_id);

                    if (!categorySpecials.has(categoryName) || !_.isArray(categorySpecials.get(categoryName)) || categorySpecials.get(categoryName).length === undefined) {
                        console.log('Category specials: not available v3 in xls sheet', categoryName);
                        return next();
                    } else {
                        console.log('Category specials v3:', categoryName, categorySpecials.get(categoryName).length, query);
                    }

                    //items may be added or deleted category wise
                    if (query.state && CategoriesRuleStateProdMap[query.state]
                        && CategoriesRuleStateProdMap[query.state][categoryName]) {

                        let addList = [], removeList = [];
                        if (CategoriesRuleStateProdMap[query.state][categoryName]['add']) addList = CategoriesRuleStateProdMap[query.state][categoryName]['add'];
                        if (CategoriesRuleStateProdMap[query.state][categoryName]['remove']) removeList = CategoriesRuleStateProdMap[query.state][categoryName]['remove'];
                        productIds = _.union(productIds, addList);
                        productIds = _.pullAll(productIds, removeList);

                    } // else continue the flow\
                    //
                    productIds = _.pullAll(productIds, [null, undefined]);
                    ProductModel.find({ product_id: { $in: productIds } , category_id: categoryDb.id}).sort({ popularity: 1 }).lean(true).exec((err, result) => {

                        if (err) {
                            console.log('[processCategories] error: ', err);
                            return next();
                        }
                        console.log('Category special products count', categoryName, query, result.length, productIds);
                        if (result && result.length > 0 && self.categoriesMap.get(categoryName)) {

                            let categoryXls = self.categoriesMap.get(categoryName);
                            let specialsObj = {
                                specialsTitle: categoryName,
                                specials_id: categoryXls.id,
                                products: _.uniqBy(result, 'name'),
                                meta_tags: []
                            };
                            if (_.isBoolean(categoryXls.verify_age)) specialsObj.verify_age = categoryXls.verify_age;
                            if (_.isObject(categoryXls.min_purchase_age)) specialsObj.min_purchase_age = categoryXls.min_purchase_age;
                            if (_.has(categoryDb, 'meta_tags')) {
                                //Shold I merge the xls and DB tags???

                                let metaTagList = [];
                                if (_.has(categoryDb, 'meta_tags') && Array.isArray(categoryDb['meta_tags']) && categoryDb['meta_tags'].length > 0) metaTagList = _.union(metaTagList, categoryDb['meta_tags']);
                                metaTagList = _.pullAll(metaTagList, [null, undefined]);
                                specialsObj['meta_tags'] = _.uniq(metaTagList);
                            }
                            request.content.specials.push(specialsObj);
                            next();
                        } else {

                            next();
                        }
                    });
                }, () => {
                    console.timeEnd('CategorySpecials');
                    innerDone();
                });
            });
        }
    }

    //NOT USED - replaced by _addPreSelectedProductsPerCategory
    _addCategorySpecials(request, done) {
        let self = this;
        let productsPerCategory = self.config.find((o => o.id === 'specials_products_per_category')).current_value;
        if (!productsPerCategory) {
            console.log('Invalid specials_products_per_category value! Please check config!');
            productsPerCategory = 15;//Default if not found in config
        }
        CategoryModel.find({ is_active: true }).sort({ popularity: 1 }).lean(true).exec((err, result) => {
            async.each(result, (category, done) => {
                ProductModel.find({ category: category.name, country: self.country, is_active: true }).limit(productsPerCategory).sort({ popularity: 1 }).lean(true).exec((err, result) => {
                    if (result && result.length > 0) {
                        request.content.specials.push({
                            specialsTitle: category.name,
                            specials_id: category.id,
                            products: result
                        });
                    }
                    done();
                });
            }, done);
        });
    }
    _sendEmail(done){
            console.log('Calling Send mail Method');
           // this.productChanges = _.uniqWith(this.productChanges, _.isEqual);
            let source = process.env.DEPLOYMENT_STAGE==='prod'?'noreply@7now.io':'advaith.nandelli@7-11.com'
            let distList = process.env.EMAIL_DISTLIST?_.split(process.env.EMAIL_DISTLIST, ','):['bandla.pakeeraiah@7-11.com']
           let cloudFrontURL= process.env.DEPLOYMENT_STAGE==='prod'? 'https://d2ho11qqpg0ll0.cloudfront.net/':'https://d21c9usmdrkboa.cloudfront.net/'
           let data ="";

           if(this.successFile.trim().length>0)
                    data = data+ "<a href="+cloudFrontURL+this.successFile+">Updated Products</a>";
           if(this.failureFile.trim().length>0)
                    data = data+ "<br/>" +"<a href="+cloudFrontURL+this.failureFile+"> Failure Products</a>";
           var params = {
                Destination: {
                    ToAddresses: distList
                },
                Message: {
                    Body: {
                        Html: {
                            Charset: "UTF-8",
                            Data: data
                        }
                    },
                    Subject: {
                        Charset: "UTF-8",
                        Data: `Product upload completed  - ${process.env.DEPLOYMENT_STAGE}`
                    }
                },
                Source: source
            };
            console.log('params:',params);
            let ses = new AWS.SES({region: process.env.REGION});
            ses.sendEmail(params, function (err, data) {
                if (err) {
                    console.log("Error while sending email>>>>>>>>>>",err, err.stack);
                    return done(err);
                } // an error occurred
                else {
                    console.log("Email Sent >>>>>>>>>>>>>",data);      // successful response
                    return done(null, 'success');
                }
            });
        }
}

module.exports = ProductUploadService;
