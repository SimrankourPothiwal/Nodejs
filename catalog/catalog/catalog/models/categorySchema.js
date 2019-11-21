/**
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */
const mongoose = require('mongoose');

module.exports = {
    id: { type: String, required: true },
    name: { type: String, required: true },
    desc: { type: String, required: true },
    long_desc: { type: String },
    thumbnail: { type: String, required: true },
    is_featured: { type: Boolean },
    is_active: { type: Boolean, required: true },
    slug: { type: String },
    small_image: { type: String },
    full_image: { type: String },
    tags: { type: Array, required: false },
    popularity: { type: Number },
    meta_tags: { type: Array },
    verify_age: { type: Boolean },
    min_purchase_age: { type: mongoose.Schema.Types.Mixed },
    icon: { type: String },
    is_new:{type:Boolean}
};