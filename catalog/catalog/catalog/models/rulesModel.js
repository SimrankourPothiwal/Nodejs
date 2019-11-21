/**
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */

const mongoose = require('mongoose');

const CatalogRulesSchema = new mongoose.Schema({
    is_active: { type: Boolean, required: true },
    meta_tag: { type: String, required: true },
    state: { type: String, required: false },
    county: { type: String, required: false },
    city: { type: String, required: false },
    store_id: { type: String, required: false },
    sellable: { type: Boolean, required: true },
    order_type: [{ type: String }],
    sale_hours: [
        {
            day: {
                type: String,
                enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
            },
            sale_hours: [
                {
                    start_time: { type: String },
                    end_time: { type: String }
                }
            ]
        }
    ],
    notes: [
        new mongoose.Schema({
            update: { type: Date, required: true },
            name: { type: String, required: true },
            comments: { type: String, required: true }
        }, { strict: false })
    ]
}, { collection: 'catalog_rules' });

function getModel() {
    if (mongoose.models && mongoose.models.CatalogRules) {
        return mongoose.models.CatalogRules;
    } else {
        return mongoose.model('CatalogRules', CatalogRulesSchema);
    }
}

module.exports = getModel();
