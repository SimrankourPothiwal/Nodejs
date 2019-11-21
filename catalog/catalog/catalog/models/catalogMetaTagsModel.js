/**
 * @author: Vivek Injal
 */

const mongoose = require('mongoose');

const catalogMetaTagsSchema = new mongoose.Schema({
    id: { type: String, required: true },
    meta_tags: { type: String, required: true },
    display: { type: String, required: true },
    desc: { type: String }
});

function getModel() {
    if (mongoose.models && mongoose.models.catalog_meta_tags) {
        return mongoose.models.catalog_meta_tags;
    } else {
        return mongoose.model('catalog_meta_tags', catalogMetaTagsSchema);
    }
}

module.exports = getModel();
