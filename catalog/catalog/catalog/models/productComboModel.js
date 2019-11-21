const mongoose = require('mongoose');

const ProductComboSchema = new mongoose.Schema({
    product_id: { type: String}, //B-slin1-slin2-flavor1-flavor2

    matching_ids: { type: Array, required: false },//A product may have more than one matching SLINs so are the IDs
    flavor_id: String,
    
    name: { type: String, required: true },
    desc: { type: String },
    long_desc: { type: String },
    
    category_id: { type: String, required: true },
    category: { type: String, required: true },
    
    is_active: { type: Boolean },
    
    thumbnail: { type: String, required: true },
    
    promo_price: { type: Number },//Overrides store price
    original_price: { type: Number },//Sum up individual items
    
    handling: { type: String },//Hot, Cold, etc.
    equipment: { type: String },//'Turbo Chef Oven', 'Sanden Case', etc.
    time_in_seconds: { type: Number },//Sum of individual items prep time
    perishable: { type: Boolean, required: false }, //Perishable = true even if one is perishable
    
    upcs: { type: Array, required: true },//A single product may map to more than one UPC
    calories: { type: String },//Sum up each item
    
    type: { type: String },//Flavor types. Coke, Diet Coke, etc.
    popularity: { type: Number },

    age_restricted: { type: Boolean },//true 

    tags: { type: Array },
    minimum_on_hand_quantity: { type: Number , default: 0},
    limit_per_order: { type: Number },
    images: { type: Array },
    country: { type: String, required: true },
    last_updated: { type: Date },

    meta_tags: { type: Array }

}, { collection: 'product_combos', strict: false });

function getModel() {
    if (mongoose.models && mongoose.models.ProductCombo) {
        return mongoose.models.ProductCombo;
    }
    else {
        return mongoose.model('ProductCombo', ProductComboSchema);
    }
}

module.exports = getModel();