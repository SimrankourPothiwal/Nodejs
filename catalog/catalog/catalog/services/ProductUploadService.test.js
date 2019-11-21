const expect = require('chai').expect;
const async = require('async');

/* global it, describe, before, after */
describe('ProductUploadService unit test cases', () => {

    let service = null;
    before((done) => {
        let logger = { error: function () { }, info: function () { }, debug: function () { } };
        const ProductUploadService = require('./ProductUploadService');
        service = new ProductUploadService(logger, true);
        done();
    });

    after((done) => {
        done();
    });

    it('Get Tags', (done) => {
        let tags = service._getTags({ tags: '"Ice & Cooler"' });
        expect(tags).to.be.an('array').that.includes('Ice & Cooler');

        tags = service._getTags({ tags: '"Ice & Cooler", "Ice"' });
        expect(tags).to.be.an('array').that.includes('Ice & Cooler').and.includes('Ice');
        expect(tags).to.have.lengthOf(2);

        done();
    });

    it('csvProcess', (done) => {
        let output = service._csvProcess('category', { name: 'test', category: 'Beer, Beverages, "Love Snacktually"'});
        console.log(output.length);
        done();
    });

    it('equipment processing', (done) => {
        let products = [ 
            { equipment: 'e1', type: 't1' },
            { equipment: 'e1', type: 'N/A' },
            { equipment: 'N/A', type: null },
            { equipment: 'e1', type: 't1' },
            { equipment: null, type: 't1' },
            { equipment: 'e2', type: 't2' }
        ];
        let equipmentTypeMap = service._getEqupimentsListFromExcel(products);
        console.log(JSON.stringify(equipmentTypeMap, null, 2));
        done();
    });
    it('triggering search reindex ', (done) => {
    process.env.SEARCH_REINDEX_URL = "http://internal-search-index-qa-1821686909.us-west-2.elb.amazonaws.com/product/index-search/v2/addtoindex";
        let searchReIndex = service._triggerSearchReIndex(done);
         
    });
});