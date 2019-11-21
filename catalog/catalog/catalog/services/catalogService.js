/**
 * Catalog service that use mongoose model to perform CRUD and query operations
 *
 * @author: Piyush Vyas
 */

const utils = require('phoenix-common');
const _ = require('lodash');
const async = require('async');
const AWS = require('aws-sdk');
const s3 = new AWS.S3({ region: 'us-west-2' });

const catalogMetaTagsModel = require('../models/catalogMetaTagsModel');
const ProductsUpdateLog = require('../models/productsUpdateLogModel');
const ProductModel = require('../models/productModel');
const StoreProducts = require('../models/storeProducts');

/**
 * @class
 */
class CatalogService {

    /**
     * Constructor with pre-initialized logger
     * @constructor
     * @param {Object} logger
     */
    constructor(logger) {
        this.logger = logger;
    }

    /**
     * Find all catalog meta tags
     *
     * @param {Function} callback
     */
    getCatalogMetaTags(callback) {
        let logger = this.logger;
        logger.info('Getting all catalog meta tags');
        catalogMetaTagsModel.find().lean(true).limit(100).exec((err, result) => {
            if (err) { console.log(err); return callback(err); }
            if (result && result.length > 0) {
                return callback(null, { meta_tags: result, count: result.length });
            } else {
                return callback(null, { meta_tags: [] });
            }
        });
    }

    popPendingProduct(done) {
        ProductsUpdateLog.find({ stores_status: 'pending', product_id : { $ne: null } }).limit(1).lean(true).select('product_id').exec((err, result) => {
            if (err) { console.logerr(); return done(err); }
            if (result && result.length > 0) {
                let product = result[0];
                if(product.product_id) {
                    ProductsUpdateLog.findOneAndUpdate({product_id: product.product_id}, { stores_status: 'updating' }, { upsert: false, new: false }, () => {
                        return done(null, result[0]);
                    });
                }
            } else {
                return done();
            }
        });
    }

    storesUpdateError(productId, errorDetails, done) {
        ProductsUpdateLog.findOneAndUpdate({product_id: productId}, { stores_status: 'error', error: errorDetails }, { upsert: false, new: false }, done);
    }

    storesUpdateComplete(productId, done) {
        ProductsUpdateLog.findOneAndUpdate({product_id: productId}, { stores_status: 'complete' }, { upsert: false, new: false }, done);
    }

    specialsUpdateComplete(productId, done) {
        ProductsUpdateLog.findOneAndUpdate({product_id: productId}, { specials_status: 'complete' }, { upsert: false, new: false }, done);
    }

    invokeRefreshStoreProducts(productId, done) {
        let self = this, req = { product_id: productId };
        console.log('Invoking refreshStoreProducts',  req);
        utils.invokeLambda(process.env.REFRESH_STORE_PRODUCTS, req, (err, result) => {
            if(err) {
                console.log('Error', err);
                self.storesUpdateError(productId, err, done);
            } else {
                console.log(result);
                self.storesUpdateComplete(productId, done);
            }
        });
    }

    syncImages(productId, done) {
        let logger = this.logger;
        logger.info('Image sync in-progress for productId :',  productId);
        ProductModel.find({product_id:productId}).lean(true).exec((err, products)=>{
            if(err){
                console.log('error while fetching product  ');
                return done(err);
            }
            if(!products || products.length<1){
                return done();
            }
            let product = products[0];

            async.series([
                (done) => {
                  s3.listObjects({Bucket:process.env.S3_IMAGE_BUCKET_NAME, Prefix:process.env.S3_IMAGE_BASE_PATH+product.slin},function(err, results){
                            if(err) {console.log(err); return done();}
                            let images=[];
                             _.forEach(results.Contents, (result)=>{
                                let encodeImage = process.env.CLOUDFRONT_URL+result.Key;
                                if(!_.includes(images, encodeImage))images.push(encodeImage);
                                _.forEach(['scroll1', 'hero'], (keyword) => {
                                    if (result.Key.toLowerCase().indexOf(keyword) !== -1) {
                                        product.thumbnail = encodeImage;
                                    }
                                });
                            });
                            product.images=images;
                            return done();
                        });
                    
                },
               
                (done) =>{
                    if( (!_.isUndefined(product.flavor_id)|| !_.isNull(product.flavor_id))   && product.is_active===true){
                        s3.listObjects({Bucket:process.env.S3_IMAGE_BUCKET_NAME, Prefix:process.env.S3_IMAGE_BASE_PATH+product.slin+'-'+product.flavor_id}, function(err, results){
                            if(err) {console.log(err);return done()}
                            if(results && results.Contents && results.Contents.length===0) return done();
                            let images=[];
                            _.forEach(results.Contents, (result)=>{
                               
                                let encodeImage = process.env.CLOUDFRONT_URL+result.Key;
                                if(!_.includes(images, encodeImage)) images.push(encodeImage);
                                _.forEach(['scroll1', 'hero'], (keyword) => {
                                    if (result.Key.toLowerCase().indexOf(keyword) !== -1) {
                                        product.thumbnail = encodeImage;
                                    }
                                });
                            });
                            product.images=images;
                            return done();
                        });

                    }else{
                        return done();
                    }
                },
                (done) => {
                    product.images= _.sortBy(product.images, (image) => {
                        if (image.indexOf('_scroll') !== -1) {
                            return image.substr(image.indexOf('_scroll'), image.length);
                        } else {
                            return image;
                        }
                    });
                    product.thumbnail = product.images && product.images.length > 0?
                                    !_.includes(product.images, product.thumbnail) ? product.images[0]: product.thumbnail
                                    :null;
                    ProductModel.updateMany({ product_id: product.product_id }, { $set: { thumbnail: product.thumbnail, images: product.images } }, done); 
                        

                }
            ], done);
           
        });

    }
}

module.exports = CatalogService;