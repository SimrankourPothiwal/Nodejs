const _ = require('lodash');
const utils = require('phoenix-common');
const CatalogService = require('../services/catalogService');
const CategoryModel = require('./../models/categoryModel');

const TASK = {
    JumpToStep: 'JumpToStep',
    FetchPendingProduct: 'FetchPendingProduct',
    ProcessStoreProducts: 'ProcessStoreProducts',
    UpdateNutritionalInfo: 'UpdateNutritionalInfo',
    SyncImages: 'SyncImages',
    UpdateSpecials_v1: 'UpdateSpecials_v1',
    UpdateSpecials_v2: 'UpdateSpecials_v2',
    UpdateSpecials_v3: 'UpdateSpecials_v3'
}

const catalogUpdateStateMachine = function (event, context, callback) {
    let logger = utils.initLogger(event, context);
    let stats = { hrstart: process.hrtime() };
    try {
        context.callbackWaitsForEmptyEventLoop = false;
        console.log('Event');
        console.log(JSON.stringify(event, null, 2));
        console.log('Context');
        console.log(JSON.stringify(context, null, 2));
        utils.dbClient(null, function (error) {
            return utils.createResponse(error, null, logger, stats, callback);
        }).then(function () {
            let service = new CatalogService(logger);
            if(!event.NextTask) event.NextTask = 'FetchPendingProduct';
            switch (event.NextTask) {
                case TASK.JumpToStep: {

                    break;
                }
                case TASK.FetchPendingProduct: {
                    service.popPendingProduct((error, result) => {
                        if (result) {
                            //Pending product update found
                            let response = _.assign({
                                NextTask: TASK.SyncImages
                               // NextTask: 'ProcessStoreProducts'
                            }, result);
                            return callback(null, response);
                        } else {
                            //No more products to update end the Step Function loop
                            CategoryModel.updateMany({is_new:true},{$set: {is_active: true}, $unset : {is_new: ""}},(err, res)=>{
                                if(err){console.log('Err in category updateMany:',err)}
                                return callback(null, {
                                    NextTask: 'EndStep'
                                });
                            });
                        }
                    });
                    break;
                }
                case TASK.SyncImages : {
                    if(event.product_id) {
                        service.syncImages(event.product_id, (err, result)=>{
                            if(err){
                                console.log(" error while syncing the images", err);
                            }
                            event.NextTask= TASK.ProcessStoreProducts;
                            return callback(null, event);
                        });
                    } else {
                        event.NextTask= TASK.ProcessStoreProducts;
                        return callback(null, event);
                    }
                    break;
                }
                case TASK.ProcessStoreProducts: {
                    if(event.product_id) {
                        service.invokeRefreshStoreProducts(event.product_id, callback);
                    } else {
                       return callback();
                    }
                    break;
                }

                case TASK.UpdateNutritionalInfo: {

                    break;
                }
                case TASK.UpdateSpecials_v1: {

                    break;
                }
                case TASK.UpdateSpecials_v2: {

                    break;
                }
                case TASK.UpdateSpecials_v3: {

                    break;
                }
            }
        }, function (error) {
            return utils.createResponse(error, null, logger, stats, callback);
        });
    } catch (e) {
        return utils.createResponse(e, null, logger, stats, callback);
    }
}

module.exports = {
    catalogUpdateStateMachine
};