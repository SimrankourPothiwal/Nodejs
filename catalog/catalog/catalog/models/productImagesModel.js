/**
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */
const mongoose = require('mongoose');

const productImagesSchema = new mongoose.Schema({

    slin: { type: String },
    upc: { type: String, required: true },
    thumbnail: { type: String, required: true },
    images: { type: Array, required: true }
    
}, { collection: 'product_images' });

function getProductImagesModel() {
    if (mongoose.models && mongoose.models.productImages) {
        return mongoose.models.productImages;
    } else {
        return mongoose.model('productImages', productImagesSchema);
    }
}

module.exports = getProductImagesModel();
