/**
 * Gladson data format
 * @author: Murali Ramachari <murali.ramachari@7-11.com>
 */
const mongoose = require('mongoose');

/**
 * 
 */
const ProductDetailsSchema = new mongoose.Schema({
    'Upc': {
        type: String,
        required: true
    },
    'Description': {
        type: String,
        required: true
    },
    'Productdetails': {
        type: String,
        required: true
    },
    'Itemname': {
        type: String,
        required: true
    },
    'Directions': {
        type: String,
        required: false
    },
    'ecom_Brand': {
        type: String,
        required: true
    },
    'Brand': {
        type: String,
        required: false
    },
    'Address': {
        type: String,
        required: false
    },
    'ecom_Code': {
        type: String,
        required: false
    },
    'Productweight': {
        type: String,
        required: false
    },
    'Ingredients': {
        'Ingredient': {
            type: Array,
            required: false
        }
    },
    'Extendedsize': {
        type: String,
        required: false
    },
    'EcomPostDate': {
        type: String,
        required: false
    },
    'ecom_Upcstructure': {
        type: String,
        required: false
    },
    'ecom_Depth': {
        type: String,
        required: false
    },
    'ecom_Legacyupc': {
        type: String,
        required: false
    },
    'ecom_Height': {
        type: String,
        required: false
    },
    'ecom_Width': {
        type: String,
        required: false
    },
    'Hasnutrition': {
        type: String,
        required: true
    },
    'ecom_Manufacturer': {
        type: String,
        required: false
    },
    'Itemsize': {
        type: String,
        required: false
    },
    'Phone': {
        type: String,
        required: false
    },
    'Itemmeasure': {
        type: String,
        required: false
    },
    'Manufacturer': {
        type: String,
        required: false
    },
    'Kosher1': {
        type: String,
        required: false
    },
    'Valuepreparedcount': {
        type: String,
        required: false
    },
    'Assets': [
        {
            'AssetType': {
                type: String,
                required: false
            },
            'AssetSubType': {
                type: String,
                required: false
            },
            'FileFormat': {
                type: String,
                required: false
            },
            'MaxQuality': {
                type: String,
                required: false
            }
        }
    ],
    'NutritionFacts': {
        'Variant': {
            type: mongoose.Schema.Types.Mixed,
            required: false
        }
    },
    'Categories': {
        'Category': {
            type: Array,
            required: false
        }
    }
});

function getModel() {
    if (mongoose.models && mongoose.models.gladson_product_details) {
        return mongoose.models.gladson_product_details;
    }
    else {
        return mongoose.model('gladson_product_details', ProductDetailsSchema);
    }
}

module.exports = getModel();