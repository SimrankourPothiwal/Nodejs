/**
 * Product model which includes presentable name, description and images.
 * It has other mapping / relational attributes with Category and Department.
 * 
 * @author: Murali Ramachari <murali.ramachari@7-11.com>
 */
const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    id: { type: String, required: true },//id = suiid + size_index + size_group + ipq
    matching_ids: { type: Array, required: false },//A product may have more than one matching SLINs so are the IDs

    slin: { type: String, required: true },
    matching_slins: { type: Array, required: false },//A product may have more than one matching SLINs

    suiid: { type: String, required: true },//Composite keys
    size_index: { type: String, required: true },//Composite keys
    size_group: { type: String, required: true },//Composite keys
    ipq: { type: String, required: true },//Composite keys
    product_id: { type: String},
    
    department_id: { type: String, required: true },//A single product maps to a single department
    upc: { type: String, required: true },//Primary UPC picked from one of the UPCs. See upcs array.
    upcs: { type: Array, required: true },//A single product may map to more than one UPC

    name: { type: String, required: true },
    desc: { type: String, required: true },
    long_desc: { type: String, required: true },
    
    category_id: { type: String, required: true },
    category: { type: String, required: true },
    
    thumbnail: { type: String, required: true },
    
    promo_price: { type: Number },
    original_price: { type: Number },

    dsu_slin: { type: String },

    multiplier: { type: Number, required: false },
    handling: { type: String },//Hot, Cold, etc.
    equipment: { type: String },//'Turbo Chef Oven', 'Sanden Case', etc.
    time_in_seconds: { type: Number },//Preparation / cooking time
    perishable: { type: Boolean, required: false },
    
    calories: { type: String },//Gladson + Internal source
    ignore_quantity: { type: Boolean },//Always mark these products as available irrespective of quantity
    //Makes the ignore_quantity truly ignore only the quantity, without this flag ignore_quantity ignore both carry_status and quantity.
    apply_carry_status: { type: Boolean }, 
    
    flavor_id: String,
    type: { type: String },//Flavor types. Coke, Diet Coke, etc.
    popularity: { type: Number, default: 0 },

    //Specials original data needed to refresh specials when location rule change
    specials_slot_of_day: { type: String },
    specials_id: { type: String },
    specials_title: { type: String },
    category_specials: { type: Boolean },

    price_group: { type: String },//Price Optimization

    volume_beer_wine: { type: Number },//Alcohol Tax purpose
    total_volume: { type: Number },//Alcohol Tax purpose
    abv_liquor: { type: Number },//Alcohol Tax purpose
    unit_measure: { type: String }, //Alcohol Tax purpose
    website_tile: { type: String },
    price_cap: { type: Number },//Max item price after optimization

    age_restricted: { type: Boolean },
    is_active: { type: Boolean },

    tags: { type: Array },
    order_type: { type: Array },//pickup, delivery, etc.
    minimum_on_hand_quantity: { type: Number , default: 0},
    limit_per_order: { type: Number },
    images: { type: Array },
    country: { type: String, required: true},
    last_updated: { type: Date },

    meta_tags: { type: Array }

}, { collection: 'products' });

function getModel() {
    if (mongoose.models && mongoose.models.Product) {
        return mongoose.models.Product;
    }
    else {
        return mongoose.model('Product', ProductSchema);
    }
}

module.exports = getModel();