/**
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */

const mongoose = require('mongoose');
const CategorySchema = require('./categorySchema');

const CategoryRegionalSchema = new mongoose.Schema(Object.assign({
    state: {
        type: String
    },
    city: {
        type: String
    },
    store_id: {
        type: String
    }
}, CategorySchema), { collection: 'categories_regional' } );

CategoryRegionalSchema.index({ state: 1, city: 1, store_id: 1 });

function getModel() {
    if (mongoose.models && mongoose.models.categories_regional) {
        return mongoose.models.categories_regional;
    } else {
        return mongoose.model('categories_regional', CategoryRegionalSchema);
    }
}

module.exports = getModel();
