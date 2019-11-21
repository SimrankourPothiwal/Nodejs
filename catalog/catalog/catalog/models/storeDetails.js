const mongoose = require('mongoose');

function getStoreDetailsModel(){
    if (mongoose.models && mongoose.models.StoreDetails) {
        return mongoose.models.StoreDetails;
    } else {
        return mongoose.model('StoreDetails', new mongoose.Schema({
            store_id: { type: String }
        }, { collection: 'store_details', strict: false }));
    }
}

module.exports = getStoreDetailsModel();