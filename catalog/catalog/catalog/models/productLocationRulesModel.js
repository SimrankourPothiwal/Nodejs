/**
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */
const mongoose = require('mongoose');

const StoreProductResSchema = new mongoose.Schema({
    meta_tag: { type: String, required: true },
    state: { type: String, required: false },
    store_id: { type: String, required: false },
    notes: [
        new mongoose.Schema({
            update: { type: Date, required: true },
            name: { type: String, required: true },
            comments: { type: String, required: true }
        }, { strict: false })
    ]
}, { collection: 'product_location_rules' }, {strict: false});

function getModel() {
    if (mongoose.models && mongoose.models.product_location_rules) {
        return mongoose.models.product_location_rules;
    } else {
        return mongoose.model('product_location_rules', StoreProductResSchema);
    }
}

module.exports = getModel();
