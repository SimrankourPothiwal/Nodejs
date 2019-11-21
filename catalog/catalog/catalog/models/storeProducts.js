const mongoose = require('mongoose');

const store_products = new mongoose.Schema({ 
    slin: String 
}, { 
    strict: false, 
    collection: 'store_products' 
});

function getModel() {
    if (mongoose.models && mongoose.models.store_products) {
        return mongoose.models.store_products;
    } else {
        return mongoose.model('store_products', store_products);
    }
}

module.exports = getModel();
