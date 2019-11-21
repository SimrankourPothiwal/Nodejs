/**
 * Product search query model directly used with MongoDB's find API
 * 
 * Other filtering based on store, all other criterias are passed on to the search 
 * implementation in catalog-api.
 * 
 * Pagination is based on the inventory data though majority of product data is coming from
 * product search in catalog-api.
 * 
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */

const Joi = require('joi');

module.exports = {

    //One or more attributes of product schema
    //Refer Product model in catalog-api
    attributes: Joi.object(),

    //Free form text with alphabets, numbers and hypen
    //Everything else will be stripped out
    //The condition is not expressed in this schema definition 
    //as it is not a hard stop to perform search
    query: Joi.string().max(100),

    //Sort attributes array
    sort: Joi.array(),

    //When true the search returns fewer attributes 
    suggest: Joi.boolean(),

    //Limit projected attributes. Projects all attributes when empty or none specified.
    projection: Joi.object(),
    
    //Used only during development time.
    //App just relies on API defined default value of 10.
    limit: Joi.number().max(500),

    //Used for pagination / scrolling
    lastKey: Joi.number()
};