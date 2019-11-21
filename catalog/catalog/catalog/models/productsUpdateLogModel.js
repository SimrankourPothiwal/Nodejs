/**
 * A model to track catalog products update propagation to Store Products, Specials or
 * in general any other derived data
 */
const mongoose = require('mongoose');

const ENUM_STATUS = ['pending', 'updating', 'complete'];

const ProductsUpdateLogSchema = new mongoose.Schema({

    product_id: { 
        type: String, 
        required: true
    },

    //Specials
    specials_status: { 
        type: String, 
        default: 'pending', 
        enum: ENUM_STATUS
    },
    specials_update_duration_in_sec: {
        type: Number
    },
    specials_update_count: {
        type: Number
    },
    specials_last_updated: { 
        type: Date, 
        default: Date 
    },

    //Store Products
    stores_status: { 
        type: String, 
        default: 'pending', 
        enum: ENUM_STATUS
    },
    stores_update_duration_in_sec: {
        type: Number
    },
    stores_update_count: {
        type: Number
    },
    stores_last_updated: { 
        type: Date, 
        default: Date 
    }

}, { collection: 'products_update_log', strict: false });

ProductsUpdateLogSchema.index({ stores_status: 1 });
ProductsUpdateLogSchema.index({ specials_status: 1 });
ProductsUpdateLogSchema.index({ product_id: 1 });

ProductsUpdateLogSchema.set('autoIndex', true);

function getModel() {
    if (mongoose.models && mongoose.models.ProductsUpdateLog) {
        return mongoose.models.ProductsUpdateLog;
    } else {
        return mongoose.model('ProductsUpdateLog', ProductsUpdateLogSchema);
    }
}

module.exports = getModel();