/**
 * Search implementation using ElasticSearch
 * 
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */
const ElasticSearch = require('aws-es');
const _ = require('lodash');

/**
 * @class
 */
class ProductSearch {
    
    /**
     * @constructor
     */
    constructor(logger) {
        //AWS Signature Version 4 Utility
        //See https://www.npmjs.com/package/aws-es
        //AWS User Account: elasticsearch-user
        this.es = new ElasticSearch({
            accessKeyId: 'AKIAIR25UY3PR6GYZCTQ',
            secretAccessKey: '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',
            service: 'es',
            region: 'us-west-2',
            host: 'search-products-src4cgx43ahaefbg65uttzmjde.us-west-2.es.amazonaws.com'
        });
        this.logger = logger;
    }

    /**
     * 
     * @param {JSON} req ElasticSearch compliant search query JSON object 
     * @param {Function} callback 
     */
    search(req, callback) {
        let self = this;
        self.es.search({
            index: 'catalog',
            type: 'product',
            body: req
        }, function (err, data) {
            if(data && data.hits && data.hits.total && data.hits.total > 0) {
                let upcs = [];
                _.forEach(data.hits.hits, function(value){
                    upcs.push(value._source.upc);
                });
                //TODO
                return callback(null, data);
            } else {
                return callback(null, data);
            }
        });
    }
}

module.exports = ProductSearch;