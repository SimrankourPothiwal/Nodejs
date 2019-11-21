/**
 * Lambda handlers for various category and product update operations
 * 
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */

const _ = require('lodash');
const async = require('async');
const utils = require('phoenix-common');
const ProductImageDetails = require('../models/productImagesModel');
const ProductModel = require('../models/productModel');
const StoreProducts = require('../models/storeProducts');
const ProductComboModel = require('../models/productComboModel');
const ProductUploadService = require('../services/ProductUploadService');
const ProductComboUploadService = require('../services/ProductComboUploadService');
const CategoriesModel = require('../models/categoryModel');
const CategoriesRegionalModel = require('../models/categoryRegionalModel');
const AWS = require('aws-sdk');
const s3 = new AWS.S3({ region: 'us-west-2' });

function updateImageUrls(event, context, callback) {
    console.log(event, context);
    let logger = utils.initLogger(event, context);
    context.callbackWaitsForEmptyEventLoop = false;
    let stats = {
        hrstart: process.hrtime()
    };
    console.log(JSON.stringify(event));
    if (event && event.Records && event.Records.length > 0) {
        let record = event.Records[0];
        let eventName = record.eventName;
        if (record.s3 && record.s3.object && record.s3.object.key) {
            
            let s3Base = record.s3.bucket.name;
            let s3FilePath = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

            let indexOfLastSlash = s3FilePath.lastIndexOf('/');
            let fileName = s3FilePath.substr(indexOfLastSlash + 1, s3FilePath.length);
            var specialChars = '!@#$^&%*()+=`~[]\/{}|:<>?"\', ';
            let modifiedFileName = fileName;
            for (var i = 0; i < specialChars.length; i++) {
                modifiedFileName = modifiedFileName.replace(new RegExp('\\' + specialChars[i], 'gi'), '_');
            }
            if(modifiedFileName!==fileName && eventName === 'ObjectCreated:Put'){
                                
                async.parallel([
                    (done)=> { copyImagestoS3(s3Base, s3FilePath, s3FilePath.replace(fileName, modifiedFileName), done)},
                    (done)=> { removeImagesfromS3(s3Base, s3FilePath, done)}
                ],
                ()=>{
                    let message = {
                        message: 'images has special characters'
                    };
                    console.log("IMAGE WITH SPECIAL Chars >>>>", message);
                    return utils.createResponse(null, message, logger, stats, callback);

                })    
            }else if (fileName.indexOf('_') !== -1) {
                
                let slin = fileName.split('_')[0];
                let flavor_id = slin.indexOf('-') !== -1 ? slin.substring(slin.indexOf('-') + 1, slin.length) : null;
                let imgPath = process.env.CLOUDFRONT_URL + s3FilePath;
                console.log('Slin:', slin, 'File:', fileName, 'S3 Bucket:', s3Base, 'FullPath', s3FilePath, 'CloudFront Path:', imgPath);
                let connectionPromise = utils.dbClient(null, function (error) {
                    return utils.createResponse(error, null, logger, stats, callback);
                });
                connectionPromise.then(function () {
                    if (eventName === 'ObjectCreated:Put') { //Upload
                        console.log('Event', eventName);
                        let isCombo = slin.startsWith('B');
                        slin = isCombo ? slin : slin.indexOf('-') !== -1 ? slin.substring(0, slin.indexOf('-')) : slin;


                        let query = isCombo ? ProductComboModel.find({ product_id: slin }).lean(true) : ProductModel.find({ slin: slin }).lean(true);
                        query.exec((err, products) => {
                            console.log(products);
                            if (err) {
                                let message = {
                                    message: 'Error reading products'
                                };
                                console.log(message);
                                return utils.createResponse(null, message, logger, stats, callback);
                            }
                            if (!products || products.length < 1) {
                                let message = {
                                    message: 'Product with slin ' + slin + ' not found!'
                                };
                                console.log(message);
                                return utils.createResponse(null, message, logger, stats, callback);
                            }
                            async.each(products, (product, done) => {
                                console.log('===============BEFORE================');
                                console.log('Before update', product);
                                console.log('=====================================');
                                let isHeroImage = false;
                                console.log(product.flavor_id, flavor_id, product.flavor_id !== flavor_id);
                                if (product.flavor_id !== flavor_id && !isCombo) return done();
                                _.forEach(['scroll1', 'hero'], (keyword) => {
                                    if (!isHeroImage && fileName.toLowerCase().indexOf(keyword) !== -1) {
                                        isHeroImage = true;
                                    }
                                });
                                if (isHeroImage) {
                                    product.thumbnail = imgPath;
                                    if (_.isArray(product.images)) {
                                        if (!_.includes(product.images, imgPath)) {
                                            product.images.unshift(imgPath);
                                        } else if (product.images[0] !== imgPath) {
                                            _.pull(product.images, imgPath);
                                            product.images.unshift(imgPath);
                                        } else {
                                            console.log('Already exists as first element');
                                        }
                                    } else {
                                        product.images = [imgPath];
                                    }
                                } else {

                                    if (!product.thumbnail || product.thumbnail.trim().length === 0) {
                                        product.thumbnail = imgPath;
                                    }
                                    if (_.isArray(product.images)) {
                                        if (!_.includes(product.images, imgPath)) {
                                            product.images.push(imgPath);
                                        } else {
                                            console.log('Already exists as first element');
                                        }
                                    } else {
                                        product.images = [imgPath];
                                    }
                                }
                                product.images = _.sortBy(product.images, (image) => {
                                    if (image.indexOf('_scroll') !== -1) {
                                        return image.substr(image.indexOf('_scroll'), image.length);
                                    } else {
                                        return image;
                                    }
                                });
                                console.log('===============AFTER================');
                                console.log('After update', product);
                                console.log('====================================');
                                async.parallel([
                                    (done) => {

                                        isCombo ? ProductComboModel.findOneAndUpdate({ _id: product._id, }, product, { upsert: false, new: false }, done) :
                                            ProductModel.findOneAndUpdate({ _id: product._id, }, product, { upsert: false, new: false }, done);
                                    }, (done) => {
                                        let criteria = isCombo ? { product_id: slin } : { slin: slin };
                                        StoreProducts.collection.updateMany(criteria, {
                                            $set: {
                                                thumbnail: product.thumbnail,
                                                images: product.images
                                            }
                                        }, done);
                                    }, (done) => {
                                        if (isCombo) return done();
                                        utils.invokeLambdaAsync(process.env.SPECIALS_UPDATE, {
                                            action: 'RefreshProducts',
                                            products: [product]
                                        }, done);
                                    }
                                ], done);
                            }, () => {
                                let message = {
                                    message: 'Update complete!'
                                };
                                console.log(message);
                                return utils.createResponse(null, message, logger, stats, callback);
                            });
                        });
                    } else if (eventName === 'ObjectRemoved:Delete') { //Delete

                        let isCombo = slin.startsWith('B');
                        slin = isCombo ? slin : slin.indexOf('-') !== -1 ? slin.substring(0, slin.indexOf('-')) : slin;


                        let query = isCombo ? ProductComboModel.find({ product_id: slin }).lean(true) : ProductModel.find({ slin: slin }).lean(true);

                        query.exec((err, products) => {
                            if (err) {
                                let message = {
                                    message: 'Error reading products'
                                };
                                console.log(message);
                                return utils.createResponse(null, message, logger, stats, callback);
                            }
                            if (!products || products.length < 1) {
                                let message = {
                                    message: 'Product with slin ' + slin + ' not found!'
                                };
                                console.log(message);
                                return utils.createResponse(null, message, logger, stats, callback);
                            }
                            async.each(products, (product, done) => {
                                if (_.includes(product.images, imgPath)) {
                                    _.pull(product.images, imgPath);
                                    if (product.images.length > 0) {
                                        if (!_.includes(product.images, product.thumbnail)) product.thumbnail = product.images[0];
                                    } else {
                                        product.thumbnail = null;
                                    }
                                    async.parallel([
                                        (done) => {
                                            isCombo ? ProductComboModel.findOneAndUpdate({ _id: product._id }, product, { upsert: false, new: false }, done) :
                                                ProductModel.findOneAndUpdate({ _id: product._id }, product, { upsert: false, new: false }, done);
                                        }, (done) => {
                                            let criteria = isCombo ? { product_id: slin } : { slin: slin };
                                            StoreProducts.collection.updateMany(criteria, {
                                                $set: {
                                                    thumbnail: product.thumbnail,
                                                    images: product.images
                                                }
                                            }, done);
                                        }, (done) => {
                                            if (isCombo) return done();
                                            utils.invokeLambdaAsync(process.env.SPECIALS_UPDATE, {
                                                action: 'RefreshProducts',
                                                products: [product]
                                            }, done);
                                        }
                                    ], () => {
                                        let message = {
                                            message: 'Removed URL references!'
                                        };
                                        console.log(message);
                                        return utils.createResponse(null, message, logger, stats, callback);
                                    });
                                } else {
                                    done();
                                }
                            });
                        });
                    } else if (eventName === 'ObjectCreated:Copy') { console.log('will be implimented'); }
                });
            } else {
                let message = {
                    message: 'Bad file name! File name should prefix slin number',
                    event: JSON.stringify(event, null, 2)
                };
                console.log(message);
                return utils.createResponse(null, message, logger, stats, callback);
            }
        } else {
            let message = {
                message: 'Unknown event!',
                event: JSON.stringify(event, null, 2)
            };
            console.log(message);
            return utils.createResponse(null, message, logger, stats, callback);
        }
    } else {
        let message = {
            message: 'Nothing to update!'
        };
        console.log(message);
        return utils.createResponse(null, message, logger, stats, callback);
    }
}


function copyImagestoS3(s3Bucket, actualimage, image, done){
    console.log('Adding images from S3 ',image)
    var params = {
        Bucket: s3Bucket, 
        Key: actualimage
       };
    s3.getObject(params,  function(err, data) {
        if (err) {console.log(err, err.stack);return done()} // an error occurred
        else     console.log('Object Get Data',data);           // successful response
        var putParams = {
            Body: data.Body, 
            Bucket: s3Bucket, 
            Key: image,
            ContentType:'image/png'
           
        };
        s3.putObject(putParams, function(err, data) {
            if (err) console.log(err, err.stack); 
            else     console.log(data); 
            done();
         
        });
      });
}
function removeImagesfromS3(s3Bucket, image, done){
    console.log('Removing images from S3 ',image)
    var params = {
                Bucket: s3Bucket, 
                Key: image
            };
            s3.deleteObject(params, function(err, data) {
                if (err) console.log(err, err.stack); 
                else     console.log(data);           
                done();
            });
    
         
}


/* Fetch image Urls from S3 to icon in categories */
function updateCategoryImageUrls(event, context, callback) {

    let logger = utils.initLogger(event, context);
    context.callbackWaitsForEmptyEventLoop = false;
    let stats = {
        hrstart: process.hrtime()
    };
    if (event && event.Records && event.Records.length > 0) {
        let record = event.Records[0];
        let eventName = record.eventName;
        if (record.s3 && record.s3.object && record.s3.object.key) {
            let s3Base = record.s3.bucket.name;
            let s3FilePath = record.s3.object.key;
            let indexOfLastSlash = s3FilePath.lastIndexOf('/');
            let fileName = s3FilePath.substr(indexOfLastSlash + 1, s3FilePath.length);
            if (fileName.indexOf('_') !== -1) {
                let id = fileName.split('_')[0];
                let imgPath = process.env.CLOUDFRONT_URL + s3FilePath;
                console.log('id:', id, 'File:', fileName, 'S3 Bucket:', s3Base, 'FullPath', s3FilePath, 'CloudFront Path:', imgPath);
                let connectionPromise = utils.dbClient(null, function (error) {
                    return utils.createResponse(error, null, logger, stats, callback);
                });
                connectionPromise.then(function () {
                    if (eventName === 'ObjectCreated:Put') { //Upload

                        let query = CategoriesModel.findOne({ id: id }).lean(true);
                        query.exec((err, category) => {
                            if (err) {
                                let message = {
                                    message: 'Error reading category'
                                };
                                console.log(message);
                                return utils.createResponse(null, message, logger, stats, callback);
                            }
                            if (_.isEmpty(category)) {
                                let message = {
                                    message: 'category with id ' + id + ' not found!'
                                };
                                console.log(message);
                                return utils.createResponse(null, message, logger, stats, callback);
                            }
                            if (category.icon === imgPath) {
                                let message = {
                                    message: 'Same icon link already exists - no Db update needed'
                                };
                                console.log(message);
                                return utils.createResponse(null, message, logger, stats, callback);
                            }
                            CategoriesModel.update({ id: category.id, }, {$set:{'icon' : imgPath}}, { upsert: false, new: false }, (err, obj) => {

                                if (err) {
                                    let message = {
                                        message: 'Error updating category'
                                    };
                                    console.log(message);
                                    return utils.createResponse(null, message, logger, stats, callback);
                                }

                                CategoriesRegionalModel.updateMany({ id: category.id, }, {$set:{'icon' : imgPath}}, { upsert: false, new: false }, (err, obj) => {

                                    if (err) {
                                        let message = {
                                            message: 'Error updating Category Regional'
                                        };
                                        console.log(message);
                                        return utils.createResponse(null, message, logger, stats, callback);
                                    }
                                    let message = {
                                        message: 'Update complete in Put Operation!'
                                    };
                                    console.log(message);
                                    return utils.createResponse(null, message, logger, stats, callback);
                                });
                            });
                        });
                    } else if (eventName === 'ObjectRemoved:Delete') { //Delete

                        let query = CategoriesModel.findOne({ id: id }).lean(true);

                        query.exec((err, category) => {
                            if (err) {
                                let message = {
                                    message: 'Error reading category'
                                };
                                console.log(message);
                                return utils.createResponse(null, message, logger, stats, callback);
                            }
                            if (_.isEmpty(category)) {
                                let message = {
                                    message: 'Category with id ' + id + ' not found!'
                                };
                                console.log(message);
                                return utils.createResponse(null, message, logger, stats, callback);
                            }
                            if (category.icon != imgPath) {
                                let message = {
                                    message: 'User deleted duplicate record from S3 - no Db update needed'
                                };
                                console.log(message);
                                return utils.createResponse(null, message, logger, stats, callback);
                            }
                            CategoriesModel.update({ id: category.id }, { $unset: { icon: 1 } }, { upsert: false, new: false }, (err, obj) => {
                                if (err) {
                                    let message = {
                                        message: 'Error updating Category'
                                    };
                                    console.log(message);
                                    return utils.createResponse(null, message, logger, stats, callback);
                                }
                                CategoriesRegionalModel.updateMany({ id: category.id }, { $unset: { icon: 1 } }, { upsert: false, new: false }, (err, resp) => {
                                    if (err) {
                                        let message = {
                                            message: 'Error updating Category Regional'
                                        };
                                        console.log(message);
                                        return utils.createResponse(null, message, logger, stats, callback);
                                    }
                                    let message = {
                                        message: 'Removed icon attribute as part of delete image url Operation!'
                                    };
                                    console.log(message);
                                    return utils.createResponse(null, message, logger, stats, callback);
                                })
                            });
                        });
                    } else if (eventName === 'ObjectCreated:Copy') { console.log('will be implimented'); }
                });
            } else {
                let message = {
                    message: 'Bad file name! File name should prefix category id number',
                    event: JSON.stringify(event, null, 2)
                };
                console.log(message);
                return utils.createResponse(null, message, logger, stats, callback);
            }
        } else {
            let message = {
                message: 'Unknown event!',
                event: JSON.stringify(event, null, 2)
            };
            console.log(message);
            return utils.createResponse(null, message, logger, stats, callback);
        }
    } else {
        let message = {
            message: 'Nothing to update!'
        };
        console.log(message);
        return utils.createResponse(null, message, logger, stats, callback);
    }
}


//sample event structure https://docs.aws.amazon.com/AmazonS3/latest/dev/notification-content-structure.html
function updateProductFromXls(event, context, callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    const logger = utils.initLogger(event, context);
    const stats = {
        hrstart: process.hrtime()
    };
    console.log(`[In updateProductFromXls ] ${JSON.stringify(event)}`);

    if (event && event.Records && event.Records.length > 0) {
        const recordObj = event.Records.shift();
        const eventName = recordObj.eventName;
        if (recordObj.s3) {
            const connectionPromise = utils.dbClient(null, (error) => {
                return utils.createResponse(error, null, logger, stats, callback);
            });
            connectionPromise.then(() => {
                if (eventName === 'ObjectCreated:Put') {
                    let service = new ProductUploadService(logger);
                    service.uploadData(recordObj.s3, (err, res) => {
                        if (err) { return utils.createResponse(err, null, logger, stats, callback); }
                        return utils.createResponse(null, res, logger, stats, callback);
                    });
                } else {
                    return utils.createResponse('Object event not supported', null, logger, stats, callback);
                }
            }, (err) => {
                return utils.createResponse(err, null, logger, stats, callback);
            });
        } else {
            return utils.createResponse(null, null, logger, stats, callback);
        }
    } else {
        return utils.createResponse('empty event', null, logger, stats, callback);
    }
}

function updateSpecials(event, context, callback) {
    console.log(`[In updateSpecials Step ] ${JSON.stringify(event)}`);
    let logger = utils.initLogger(event, context);
    let stats = { hrstart: process.hrtime() };
    try {
        context.callbackWaitsForEmptyEventLoop = false;
        const connectionPromise = utils.dbClient(null, (error) => {
            return utils.createResponse(error, null, logger, stats, callback);
        });
        connectionPromise.then(function () {
            let req = (_.isObject(event.body)) ? event.body : JSON.parse(event.body);
            let service = new ProductUploadService(logger);
            console.log('update specials request' + req);
            service.updateSpecials(req, function (error, result) {
                return utils.createResponse(error, result, logger, stats, callback);
            });
        }, function (error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
    } catch (e) {
        return utils.createResponse(e, null, logger, stats, callback);
    }
}

function updateProductImageUrls(event, context, callback) {
    let logger = utils.initLogger(event, context);
    context.callbackWaitsForEmptyEventLoop = false;
    let stats = {
        hrstart: process.hrtime()
    };

    if (event && event.Records && event.Records.length > 0) {
        let record = event.Records[0];
        let eventName = record.eventName;
        console.log('eventName ' + eventName);
        if (record.s3 && record.s3.object && record.s3.object.key) {
            let s3FilePath = record.s3.object.key;
            let indexOfLastSlash = s3FilePath.lastIndexOf('/');
            let fileName = s3FilePath.substr(indexOfLastSlash + 1, s3FilePath.length);

            let productFileName = createProductUPC(fileName, 18);
            let upc = productFileName.split('.')[0];
            console.log('UPC = ' + upc);
            let imgPath = encodeURI(process.env.CLOUDFRONT_URL + s3FilePath);
            console.log('img path = ' + imgPath);
            let connectionPromise = utils.dbClient(null, function (error) {
                console.log('Error' + error);
                return utils.createResponse(error, null, logger, stats, callback);
            });
            connectionPromise.then(function () {
                if (eventName === 'ObjectCreated:Put') {
                    console.log('Event', eventName);
                    ProductImageDetails.findOneAndUpdate({ upc: upc }, { $set: { thumbnail: imgPath, upc: upc, details: false } }, { upsert: true }, function (err, doc) {
                        if (err)
                            console.log('Error in updating the product images');
                        else
                            console.log('doc ' + doc);
                        console.log('Update done for product images');

                    });

                    StoreProducts.collection.updateMany(
                        { upc: upc, thumbnail: null },
                        { $set: { thumbnail: imgPath, upc: upc } }
                    ).then(result => {
                        return result;
                    });

                }
            });

        } else {
            let message = { message: 'Unknown event!', event: JSON.stringify(event, null, 2) };
            return utils.createResponse(null, message, logger, stats, callback);
        }
    } else {
        let message = { message: 'Nothing to update!' };
        return utils.createResponse(null, message, logger, stats, callback);
    }
}

function updateProductCombosFromXls(event, context, callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    const logger = utils.initLogger(event, context);
    const stats = {
        hrstart: process.hrtime()
    };
    console.log(`[In updateProductCombosFromXls ] ${JSON.stringify(event)}`);

    if (event && event.Records && event.Records.length > 0) {
        const recordObj = event.Records.shift();
        const eventName = recordObj.eventName;
        if (recordObj.s3) {
            const connectionPromise = utils.dbClient(null, (error) => {
                return utils.createResponse(error, null, logger, stats, callback);
            });
            connectionPromise.then(() => {
                if (eventName === 'ObjectCreated:Put') {
                    let service = new ProductComboUploadService(logger);
                    service.uploadData(recordObj.s3, (err, res) => {
                        if (err) { return utils.createResponse(err, null, logger, stats, callback); }
                        return utils.createResponse(null, res, logger, stats, callback);
                    });
                } else {
                    return utils.createResponse('Object event not supported', null, logger, stats, callback);
                }
            }, (err) => {
                return utils.createResponse(err, null, logger, stats, callback);
            });
        } else {
            return utils.createResponse(null, null, logger, stats, callback);
        }
    } else {
        return utils.createResponse('empty event', null, logger, stats, callback);
    }
}

function createProductUPC(number, length) {
    var num = '' + number;
    while (num.length < length) {
        num = '0' + num;
    }
    return num;
}

module.exports = {
    updateImageUrls,
    updateProductFromXls,
    updateProductImageUrls,
    updateSpecials,
    updateProductCombosFromXls,
    updateCategoryImageUrls
};