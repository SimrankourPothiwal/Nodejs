/**
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */

const mongoose = require('mongoose');
const CategorySchema = require('./categorySchema');

function getModel() {
    if (mongoose.models && mongoose.models.Category) {
        return mongoose.models.Category;
    } else {
        return mongoose.model('Category', new mongoose.Schema(CategorySchema));
    }
}

module.exports = getModel();
